/* =========================================================================
 *  VOXELCRAFT — Web Worker : génération + éclairage + maillage
 *  Communique par messages ; les géométries repartent en transferables
 *  (zéro-copie) pour ne jamais bloquer le thread de rendu.
 * ========================================================================= */
'use strict';

self.importScripts('blocks.js', 'noise.js', 'worldgen.js', 'mesher.js');

const V = self.VC;
const { CH_X, CH_Z, CH_AREA, CH_VOL } = V;

let gen = null;
let seed = 0;
const chunks = new Map();          // "cx,cz" -> {blocks, biomes, heights, dirty}
const spillStore = new Map();      // débordements de structures en attente
let biomeColors = null;

function key(cx, cz) { return cx + ',' + cz; }

/* ---------------------------------------------------- Table de couleurs */
function buildBiomeColors() {
  const arr = [];
  const BD = self.VCGen.BIOME_DATA;
  for (let i = 0; i < 32; i++) {
    const b = BD[i];
    arr[i] = b
      ? { grass: b.grass, foliage: b.foliage, water: b.water }
      : { grass: [0.5, 0.7, 0.3], foliage: [0.4, 0.65, 0.25], water: [0.17, 0.44, 0.72] };
  }
  return arr;
}

/* ------------------------------------------------- Obtention d'un chunk */
function ensureChunk(cx, cz) {
  const k = key(cx, cz);
  let c = chunks.get(k);
  if (c) return c;

  const data = gen.generateChunk(cx, cz);
  c = { cx, cz, blocks: data.blocks, biomes: data.biomes, heights: data.heights, decorated: false };
  chunks.set(k, c);

  // décoration + report des débordements
  const spill = gen.decorate(cx, cz, c);
  c.decorated = true;
  for (let i = 0; i < spill.length; i++) {
    const [wx, y, wz, b] = spill[i];
    const tcx = Math.floor(wx / CH_X), tcz = Math.floor(wz / CH_Z);
    const tk = key(tcx, tcz);
    const target = chunks.get(tk);
    const lx = wx - tcx * CH_X, lz = wz - tcz * CH_Z;
    if (target) {
      const idx = V.idx(lx, y, lz);
      if (target.blocks[idx] === 0) {
        target.blocks[idx] = b;
        target.dirty = true;
      }
    } else {
      let lst = spillStore.get(tk);
      if (!lst) { lst = []; spillStore.set(tk, lst); }
      lst.push([lx, y, lz, b]);
    }
  }
  // applique les débordements reçus antérieurement
  const pend = spillStore.get(k);
  if (pend) {
    for (let i = 0; i < pend.length; i++) {
      const [lx, y, lz, b] = pend[i];
      const idx = V.idx(lx, y, lz);
      if (c.blocks[idx] === 0) c.blocks[idx] = b;
    }
    spillStore.delete(k);
  }
  // recalcul du heightmap après décoration
  recomputeHeights(c);
  return c;
}

function recomputeHeights(c) {
  const { blocks, heights } = c;
  for (let z = 0; z < CH_Z; z++) {
    for (let x = 0; x < CH_X; x++) {
      let top = 0;
      for (let y = V.CH_Y - 1; y >= 0; y--) {
        if (blocks[V.idx(x, y, z)] !== 0) { top = y; break; }
      }
      heights[z * CH_X + x] = top;
    }
  }
  let mx = 0;
  for (let i = 0; i < CH_AREA; i++) if (heights[i] > mx) mx = heights[i];
  c.maxHeight = mx;
}

/* ------------------------------------------------------------ Maillage */
function buildMesh(cx, cz) {
  const c = ensureChunk(cx, cz);
  const neigh = {};
  let maxH = c.maxHeight || 100;
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const n = ensureChunk(cx + dx, cz + dz);
      neigh[dx + ',' + dz] = n.blocks;
      if (n.maxHeight > maxH) maxH = n.maxHeight;
    }
  }
  return self.VCMesher.meshChunk(cx, cz, neigh, c.biomes, biomeColors, maxH);
}

/* ----------------------------------------------------------- Messages  */
self.onmessage = function (e) {
  const m = e.data;

  switch (m.cmd) {

    case 'init': {
      seed = m.seed | 0;
      gen = new self.VCGen.WorldGenerator(seed);
      biomeColors = buildBiomeColors();
      self.postMessage({ cmd: 'ready' });
      break;
    }

    case 'gen': {
      // Génère et maille un chunk, renvoie tout d'un bloc.
      const { cx, cz, token } = m;
      const c = ensureChunk(cx, cz);
      const mesh = buildMesh(cx, cz);
      const payload = {
        cmd: 'chunk', cx, cz, token,
        blocks: c.blocks.slice().buffer,
        biomes: c.biomes.slice().buffer,
        heights: new Int16Array(c.heights).buffer,
        solid: mesh.solid, cutout: mesh.cutout, water: mesh.water
      };
      const transfer = [payload.blocks, payload.biomes, payload.heights];
      ['solid', 'cutout', 'water'].forEach(kk => {
        const g = mesh[kk];
        transfer.push(g.pos.buffer, g.uv.buffer, g.lgt.buffer, g.tnt.buffer, g.idx.buffer);
      });
      self.postMessage(payload, transfer);
      break;
    }

    case 'remesh': {
      // Re-maille un chunk existant (après modification de blocs).
      const { cx, cz, token } = m;
      if (!chunks.has(key(cx, cz))) { ensureChunk(cx, cz); }
      const mesh = buildMesh(cx, cz);
      const payload = { cmd: 'mesh', cx, cz, token, solid: mesh.solid, cutout: mesh.cutout, water: mesh.water };
      const transfer = [];
      ['solid', 'cutout', 'water'].forEach(kk => {
        const g = mesh[kk];
        transfer.push(g.pos.buffer, g.uv.buffer, g.lgt.buffer, g.tnt.buffer, g.idx.buffer);
      });
      self.postMessage(payload, transfer);
      break;
    }

    case 'setBlock': {
      // Le thread principal a modifié un bloc : synchronise le worker.
      const { wx, wy, wz, id } = m;
      const cx = Math.floor(wx / CH_X), cz = Math.floor(wz / CH_Z);
      const c = chunks.get(key(cx, cz));
      if (c) {
        const lx = wx - cx * CH_X, lz = wz - cz * CH_Z;
        c.blocks[V.idx(lx, wy, lz)] = id;
        const ai = lz * CH_X + lx;
        if (id !== 0 && wy > c.heights[ai]) c.heights[ai] = wy;
        else if (id === 0 && wy === c.heights[ai]) {
          let t = 0;
          for (let y = wy; y >= 0; y--) if (c.blocks[V.idx(lx, y, lz)] !== 0) { t = y; break; }
          c.heights[ai] = t;
        }
        let mx = 0;
        for (let i = 0; i < CH_AREA; i++) if (c.heights[i] > mx) mx = c.heights[i];
        c.maxHeight = mx;
      }
      break;
    }

    case 'patch': {
      // Applique un lot de modifications sauvegardées avant maillage.
      const list = m.list;
      for (let i = 0; i < list.length; i += 4) {
        const wx = list[i], wy = list[i + 1], wz = list[i + 2], id = list[i + 3];
        const cx = Math.floor(wx / CH_X), cz = Math.floor(wz / CH_Z);
        const k = key(cx, cz);
        let c = chunks.get(k);
        if (!c) {
          let lst = spillStore.get(k);
          if (!lst) { lst = []; spillStore.set(k, lst); }
          lst.push([wx - cx * CH_X, wy, wz - cz * CH_Z, id]);
        } else {
          c.blocks[V.idx(wx - cx * CH_X, wy, wz - cz * CH_Z)] = id;
          recomputeHeights(c);
        }
      }
      self.postMessage({ cmd: 'patched' });
      break;
    }

    case 'unload': {
      // Libère la mémoire des chunks éloignés (le terrain est déterministe).
      const list = m.list;
      for (let i = 0; i < list.length; i += 2) chunks.delete(key(list[i], list[i + 1]));
      break;
    }

    case 'column': {
      // Requête de hauteur (spawn du joueur).
      const c = ensureChunk(Math.floor(m.wx / CH_X), Math.floor(m.wz / CH_Z));
      const lx = m.wx - Math.floor(m.wx / CH_X) * CH_X;
      const lz = m.wz - Math.floor(m.wz / CH_Z) * CH_Z;
      self.postMessage({ cmd: 'column', wx: m.wx, wz: m.wz, h: c.heights[lz * CH_X + lx], token: m.token });
      break;
    }
  }
};
