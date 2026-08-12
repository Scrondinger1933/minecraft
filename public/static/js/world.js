/* =========================================================================
 *  VOXELCRAFT — Gestion du monde côté thread principal
 *
 *  · Streaming de chunks piloté par distance, en spirale depuis le joueur
 *  · File de requêtes bornée (n en vol) : évite de saturer le worker
 *  · Cache de blocs modifiés persistant (IndexedDB) — le terrain de base
 *    étant déterministe, seules les différences sont sauvegardées.
 * ========================================================================= */
(function (root) {
  'use strict';
  const V = root.VC;
  const { CH_X, CH_Y, CH_Z, CH_AREA } = V;

  function Chunk(cx, cz) {
    this.cx = cx; this.cz = cz;
    this.blocks = null;
    this.biomes = null;
    this.heights = null;
    this.meshes = { solid: null, cutout: null, water: null };
    this.state = 'pending';    // pending | ready
    this.dirty = false;
    this.lastUse = 0;
    this.maxY = 0;
  }

  function World(renderer, seed) {
    this.renderer = renderer;
    this.seed = seed;
    this.chunks = new Map();
    this.pending = new Set();
    this.remeshQueue = [];
    this.inFlight = 0;
    this.maxInFlight = 3;
    this.renderDistance = 8;
    this.edits = new Map();     // "x,y,z" -> id  (modifications joueur)
    this.worker = null;
    this.onChunkReady = null;
    this.stats = { chunks: 0, meshes: 0, visible: 0 };
    this._tok = 1;
  }

  World.prototype.key = function (cx, cz) { return cx + ',' + cz; };

  World.prototype.start = function (workerUrl, onReady) {
    const w = new Worker(workerUrl);
    this.worker = w;
    const self = this;
    w.onmessage = function (e) { self.onWorkerMessage(e.data); };
    w.postMessage({ cmd: 'init', seed: this.seed });
    this._onReady = onReady;
  };

  World.prototype.onWorkerMessage = function (m) {
    switch (m.cmd) {
      case 'ready':
        if (this._onReady) { this._onReady(); this._onReady = null; }
        break;

      case 'chunk': {
        this.inFlight--;
        const k = this.key(m.cx, m.cz);
        this.pending.delete(k);
        let c = this.chunks.get(k);
        if (!c) { c = new Chunk(m.cx, m.cz); this.chunks.set(k, c); }
        c.blocks = new Uint8Array(m.blocks);
        c.biomes = new Uint8Array(m.biomes);
        c.heights = new Int16Array(m.heights);
        c.state = 'ready';
        this.applyMeshes(c, m);
        // applique les éditions locales déjà connues pour ce chunk
        this.reapplyEdits(c);
        if (this.onChunkReady) this.onChunkReady(c);
        break;
      }

      case 'mesh': {
        this.inFlight--;
        const c = this.chunks.get(this.key(m.cx, m.cz));
        if (c) this.applyMeshes(c, m);
        break;
      }

      case 'column':
        if (this._columnCb) { this._columnCb(m.h); this._columnCb = null; }
        break;

      case 'patched':
        if (this._patchCb) { this._patchCb(); this._patchCb = null; }
        break;
    }
  };

  World.prototype.applyMeshes = function (c, m) {
    const r = this.renderer;
    ['solid', 'cutout', 'water'].forEach(layer => {
      if (c.meshes[layer]) r.deleteMesh(c.meshes[layer]);
      c.meshes[layer] = r.createMesh(m[layer]);
    });
    let maxY = 0;
    if (c.heights) for (let i = 0; i < CH_AREA; i++) if (c.heights[i] > maxY) maxY = c.heights[i];
    c.maxY = maxY + 2;
  };

  World.prototype.reapplyEdits = function (c) {
    if (!this.edits.size) return;
    const ox = c.cx * CH_X, oz = c.cz * CH_Z;
    let changed = false;
    this.edits.forEach((id, k) => {
      const p = k.split(',');
      const x = +p[0], y = +p[1], z = +p[2];
      if (x >= ox && x < ox + CH_X && z >= oz && z < oz + CH_Z) {
        c.blocks[V.idx(x - ox, y, z - oz)] = id;
        changed = true;
      }
    });
    if (changed) this.requestRemesh(c.cx, c.cz);
  };

  /* ------------------------------------------------------ Accès blocs -- */
  World.prototype.getBlock = function (x, y, z) {
    if (y < 0 || y >= CH_Y) return 0;
    const cx = x >> 4, cz = z >> 4;
    const c = this.chunks.get(cx + ',' + cz);
    if (!c || !c.blocks) return 0;
    return c.blocks[V.idx(x - (cx << 4), y, z - (cz << 4))];
  };
  World.prototype.getBiome = function (x, z) {
    const cx = x >> 4, cz = z >> 4;
    const c = this.chunks.get(cx + ',' + cz);
    if (!c || !c.biomes) return 3;
    return c.biomes[(z - (cz << 4)) * CH_X + (x - (cx << 4))];
  };
  World.prototype.getHeight = function (x, z) {
    const cx = x >> 4, cz = z >> 4;
    const c = this.chunks.get(cx + ',' + cz);
    if (!c || !c.heights) return -1;
    return c.heights[(z - (cz << 4)) * CH_X + (x - (cx << 4))];
  };
  World.prototype.isLoaded = function (x, z) {
    const c = this.chunks.get((x >> 4) + ',' + (z >> 4));
    return !!(c && c.state === 'ready');
  };
  World.prototype.isSkyExposed = function (x, y, z) {
    for (let yy = y + 1; yy < CH_Y; yy++) {
      const id = this.getBlock(x, yy, z);
      if (V.T_OPAQUE[id]) return false;
    }
    return true;
  };

  /**
   * Modifie un bloc et planifie le re-maillage des chunks concernés.
   */
  World.prototype.setBlock = function (x, y, z, id) {
    if (y < 0 || y >= CH_Y) return false;
    const cx = x >> 4, cz = z >> 4;
    const c = this.chunks.get(cx + ',' + cz);
    if (!c || !c.blocks) return false;
    const lx = x - (cx << 4), lz = z - (cz << 4);
    const i = V.idx(lx, y, lz);
    if (c.blocks[i] === id) return false;
    c.blocks[i] = id;
    this.edits.set(x + ',' + y + ',' + z, id);

    // heightmap
    const ai = lz * CH_X + lx;
    if (id !== 0) { if (y > c.heights[ai]) c.heights[ai] = y; }
    else if (y === c.heights[ai]) {
      let t = 0;
      for (let yy = y; yy >= 0; yy--) if (c.blocks[V.idx(lx, yy, lz)] !== 0) { t = yy; break; }
      c.heights[ai] = t;
    }

    if (this.worker) this.worker.postMessage({ cmd: 'setBlock', wx: x, wy: y, wz: z, id });

    // re-mailler ce chunk + voisins si en bordure (la lumière déborde)
    const need = new Set([cx + ',' + cz]);
    const R = 1;   // la lumière peut se propager loin ; 1 chunk suffit visuellement
    for (let dz = -R; dz <= R; dz++)
      for (let dx = -R; dx <= R; dx++) {
        if (lx >= 2 && lx < CH_X - 2 && lz >= 2 && lz < CH_Z - 2 && (dx || dz)) continue;
        need.add((cx + dx) + ',' + (cz + dz));
      }
    need.forEach(k => {
      const p = k.split(',');
      this.requestRemesh(+p[0], +p[1], true);
    });
    return true;
  };

  World.prototype.requestRemesh = function (cx, cz, priority) {
    const k = this.key(cx, cz);
    const c = this.chunks.get(k);
    if (!c || c.state !== 'ready') return;
    if (this.remeshQueue.indexOf(k) >= 0) return;
    if (priority) this.remeshQueue.unshift(k); else this.remeshQueue.push(k);
  };

  /* ------------------------------------------------------- Streaming --- */
  World.prototype.update = function (px, pz, frameTime) {
    const pcx = Math.floor(px / CH_X), pcz = Math.floor(pz / CH_Z);
    const R = this.renderDistance;

    // 1) traitement des re-maillages en priorité (réactivité de la casse)
    while (this.remeshQueue.length && this.inFlight < this.maxInFlight + 2) {
      const k = this.remeshQueue.shift();
      const p = k.split(',');
      const c = this.chunks.get(k);
      if (!c || c.state !== 'ready') continue;
      this.inFlight++;
      this.worker.postMessage({ cmd: 'remesh', cx: +p[0], cz: +p[1], token: this._tok++ });
    }

    // 2) demande des chunks manquants, du plus proche au plus éloigné
    if (this.inFlight < this.maxInFlight) {
      let best = null, bestD = Infinity;
      for (let dz = -R; dz <= R; dz++) {
        for (let dx = -R; dx <= R; dx++) {
          const d2 = dx * dx + dz * dz;
          if (d2 > R * R) continue;
          const cx = pcx + dx, cz = pcz + dz;
          const k = this.key(cx, cz);
          if (this.chunks.has(k) || this.pending.has(k)) continue;
          if (d2 < bestD) { bestD = d2; best = [cx, cz, k]; }
        }
      }
      if (best) {
        this.pending.add(best[2]);
        this.inFlight++;
        this.worker.postMessage({ cmd: 'gen', cx: best[0], cz: best[1], token: this._tok++ });
      }
    }

    // 3) déchargement des chunks hors portée (+ marge d'hystérésis)
    const unload = [];
    const limit = (R + 3) * (R + 3);
    this.chunks.forEach((c, k) => {
      const dx = c.cx - pcx, dz = c.cz - pcz;
      if (dx * dx + dz * dz > limit) unload.push(k);
    });
    if (unload.length) {
      const list = [];
      unload.forEach(k => {
        const c = this.chunks.get(k);
        ['solid', 'cutout', 'water'].forEach(l => { if (c.meshes[l]) this.renderer.deleteMesh(c.meshes[l]); });
        list.push(c.cx, c.cz);
        this.chunks.delete(k);
      });
      if (this.worker) this.worker.postMessage({ cmd: 'unload', list });
    }

    this.stats.chunks = this.chunks.size;
  };

  /** Pourcentage de chunks prêts dans un rayon donné (écran de chargement). */
  World.prototype.readyRatio = function (px, pz, radius) {
    const pcx = Math.floor(px / CH_X), pcz = Math.floor(pz / CH_Z);
    let total = 0, ready = 0;
    for (let dz = -radius; dz <= radius; dz++)
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dz * dz > radius * radius) continue;
        total++;
        const c = this.chunks.get(this.key(pcx + dx, pcz + dz));
        if (c && c.state === 'ready') ready++;
      }
    return total ? ready / total : 1;
  };

  World.prototype.requestColumn = function (wx, wz, cb) {
    this._columnCb = cb;
    this.worker.postMessage({ cmd: 'column', wx, wz, token: this._tok++ });
  };

  /** Envoie les éditions sauvegardées au worker avant la génération. */
  World.prototype.pushEdits = function (cb) {
    if (!this.edits.size) { if (cb) cb(); return; }
    const list = [];
    this.edits.forEach((id, k) => {
      const p = k.split(',');
      list.push(+p[0], +p[1], +p[2], id);
    });
    this._patchCb = cb;
    this.worker.postMessage({ cmd: 'patch', list });
  };

  /* ================================================== Persistance ======= */
  const DB_NAME = 'voxelcraft', STORE = 'worlds';
  function openDB() {
    return new Promise((res, rej) => {
      const rq = indexedDB.open(DB_NAME, 1);
      rq.onupgradeneeded = () => {
        const db = rq.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      };
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => rej(rq.error);
    });
  }
  function saveWorld(id, payload) {
    return openDB().then(db => new Promise((res, rej) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(Object.assign({ id }, payload));
      tx.oncomplete = () => res(true);
      tx.onerror = () => rej(tx.error);
    }));
  }
  function loadWorld(id) {
    return openDB().then(db => new Promise((res, rej) => {
      const tx = db.transaction(STORE, 'readonly');
      const rq = tx.objectStore(STORE).get(id);
      rq.onsuccess = () => res(rq.result || null);
      rq.onerror = () => rej(rq.error);
    }));
  }
  function listWorlds() {
    return openDB().then(db => new Promise((res, rej) => {
      const tx = db.transaction(STORE, 'readonly');
      const rq = tx.objectStore(STORE).getAll();
      rq.onsuccess = () => res(rq.result || []);
      rq.onerror = () => rej(rq.error);
    }));
  }
  function deleteWorld(id) {
    return openDB().then(db => new Promise((res) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => res(true);
    }));
  }

  root.VCWorld = { World, Chunk, saveWorld, loadWorld, listWorlds, deleteWorld };
})(typeof self !== 'undefined' ? self : this);
