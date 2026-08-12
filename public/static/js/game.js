/* =========================================================================
 *  VOXELCRAFT — Boucle de jeu, joueur, interactions
 *
 *  Pas de simulation fixe (20 Hz logique, rendu libre) avec accumulateur :
 *  la physique reste déterministe quelle que soit la fréquence d'affichage.
 * ========================================================================= */
(function (root) {
  'use strict';
  const V = root.VC;
  const P = root.VCPhys;
  const E = root.VCEnt;
  const C = root.VCCraft;
  const RND = root.VCRender;
  const B = V.B, I = V.I;

  const TICK = 1 / 20;               // 20 ticks/s
  const DAY_LENGTH = 20 * 60;        // 20 min par cycle complet

  /* =============================================================== Joueur */
  function Player() {
    this.x = 0; this.y = 80; this.z = 0;
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.yaw = 0; this.pitch = 0;
    this.onGround = false;
    this.sneaking = false;
    this.sprinting = false;
    this.inWater = false;
    this.headInWater = false;
    this.height = 1.8;
    this.eye = 1.62;
    this.half = 0.3;
    this.hp = 20; this.maxHp = 20;
    this.food = 20; this.saturation = 5;
    this.xp = 0; this.level = 0;
    this.mode = 'survival';          // survival | creative
    this.flying = false;
    this.selected = 0;
    this.inv = new root.VCUI.Inventory(36);
    this.fallStart = null;
    this.hurtTimer = 0;
    this.breathe = 10;
    this.swingT = 0;
    this.regenTimer = 0;
    this.starveTimer = 0;
    this.exhaustion = 0;
  }
  Player.prototype.heldItem = function () { return this.inv.get(this.selected); };
  Player.prototype.heldId = function () { const s = this.inv.get(this.selected); return s ? s.id : -1; };

  /* ================================================================ Game */
  function Game(canvas) {
    this.canvas = canvas;
    this.renderer = new RND.Renderer(canvas);
    this.audio = new root.VCAudio.AudioEngine();
    this.player = new Player();
    this.ui = new root.VCUI.UI(this);
    this.particles = new E.ParticleSystem(1200);
    this.mobs = [];
    this.items = [];
    this.furnaces = new Map();
    this.chests = new Map();
    this.keys = {};
    this.mouse = { left: false, right: false };
    this.acc = 0;
    this.lastT = 0;
    this.time = 0;
    this.worldTime = DAY_LENGTH * 0.28;
    this.fps = 0; this.frames = 0; this.fpsT = 0;
    this.mining = null;
    this.selection = null;
    this.paused = false;
    this.dead = false;
    this.camDir = [0, 0, -1];
    this.settings = {
      renderDistance: 8, fov: 70, mouseSens: 0.0022,
      sound: 0.55, showFps: true, viewBob: true, mipmap: true
    };
    this.stats = { blocksPlaced: 0, blocksBroken: 0, distance: 0, deaths: 0, mobsKilled: 0, playTime: 0 };
    this.spawnCd = 0;
    this.saveCd = 0;
    this.worldId = null;
    this.ready = false;
    this.messages = [];
    this.debug = false;
  }

  /* --------------------------------------------------------- Démarrage - */
  Game.prototype.boot = function (seed, saveData, onProgress, onDone) {
    const self = this;
    const atlasCanvas = root.VCAtlas.buildAtlas();
    this.atlasCanvas = atlasCanvas;
    this.renderer.uploadAtlas(atlasCanvas, this.settings.mipmap);
    this.ui.setAtlasURL(atlasCanvas.toDataURL());
    this.ui.init(atlasCanvas);
    this.audio.init();
    this.audio.setVolume(this.settings.sound);

    this.seed = seed;
    this.world = new root.VCWorld.World(this.renderer, seed);
    this.world.renderDistance = this.settings.renderDistance;

    if (saveData) this.applySave(saveData);

    this.world.start('/static/js/worker.js', () => {
      self.world.pushEdits(() => {
        self.spawnPlayer(!!saveData, onProgress, onDone);
      });
    });
  };

  Game.prototype.spawnPlayer = function (hasSave, onProgress, onDone) {
    const self = this;
    const p = this.player;
    const tick = () => {
      self.world.update(p.x, p.z, 16);
      const ratio = self.world.readyRatio(p.x, p.z, 3);
      onProgress(ratio);
      if (ratio >= 0.999) {
        if (!hasSave) {
          let found = false;
          for (let r = 0; r < 12 && !found; r++) {
            for (let a = 0; a < 12 && !found; a++) {
              const ang = a / 12 * Math.PI * 2;
              const x = Math.round(Math.cos(ang) * r * 3);
              const z = Math.round(Math.sin(ang) * r * 3);
              const h = self.world.getHeight(x, z);
              if (h > V.SEA_LEVEL && h < 110) {
                const top = self.world.getBlock(x, h, z);
                if (top !== B.WATER && top !== B.LAVA && V.T_SOLID[top]) {
                  p.x = x + 0.5; p.z = z + 0.5; p.y = h + 1.05; found = true;
                }
              }
            }
          }
          if (!found) { p.y = Math.max(V.SEA_LEVEL + 2, self.world.getHeight(0, 0) + 2); p.x = 0.5; p.z = 0.5; }
          p.inv.add(B.TORCH, 8);
          p.inv.add(B.PLANKS, 12);
        }
        self.ready = true;
        self.ui.refreshHotbar();
        onDone();
      } else requestAnimationFrame(tick);
    };
    tick();
  };

  /* ----------------------------------------------------------- Entrées - */
  /**
   * Acquisition du verrou de pointeur.
   *
   * `requestPointerLock()` exige une *activation transitoire* : appelé hors
   * d'un gestionnaire de geste utilisateur (ou dans une iframe dépourvue de
   * `allow="pointer-lock"`), il est rejeté par le navigateur. On ne peut donc
   * pas faire dépendre la rotation de vue de sa réussite : la promesse est
   * traitée, l'échec est mémorisé, et un repli « souris libre » prend le
   * relais. Le focus clavier est systématiquement rapatrié sur le canvas,
   * faute de quoi les touches partent au dernier <input> du menu.
   */
  Game.prototype.grabPointer = function (fromGesture) {
    const cv = this.canvas;
    if (document.activeElement && document.activeElement !== cv &&
        document.activeElement.blur) document.activeElement.blur();
    if (cv.focus) cv.focus({ preventScroll: true });
    if (document.pointerLockElement === cv) { this.lockOk = true; return; }
    if (this.lockDenied && !fromGesture) return;   // inutile de réessayer sans geste
    let r;
    try { r = cv.requestPointerLock(); } catch (err) { this.lockDenied = true; return; }
    if (r && typeof r.then === 'function') {
      const self = this;
      r.then(() => { self.lockOk = true; self.lockDenied = false; })
       .catch(() => {
         self.lockDenied = true;
         if (!self._lockWarned) {
           self._lockWarned = true;
           self.msg('Verrou du pointeur refusé — repli : maintenez le clic gauche pour tourner la vue.');
         }
       });
    }
  };

  Game.prototype.bindInput = function () {
    const self = this, cv = this.canvas;
    this.lockOk = false;
    this.lockDenied = false;
    this.freeLook = false;                 // repli : rotation au clic maintenu
    this._lastMX = 0; this._lastMY = 0;

    // Le canvas doit pouvoir recevoir le focus clavier.
    if (!cv.hasAttribute('tabindex')) cv.setAttribute('tabindex', '0');

    document.addEventListener('keydown', e => {
      const tn = e.target && e.target.tagName;
      if (tn === 'INPUT' || tn === 'TEXTAREA' || tn === 'SELECT') return;
      const k = e.code;
      if (e.repeat) { self.keys[k] = true; return; }
      self.keys[k] = true;

      if (self.dead) { if (k === 'Enter' || k === 'Space') self.respawn(); return; }

      if (self.ui.open) {
        if (k === 'Escape' || k === 'KeyE') { self.ui.closePanel(); self.grabPointer(true); e.preventDefault(); }
        return;
      }
      if (k === 'Escape') { self.togglePause(); e.preventDefault(); return; }
      if (k === 'KeyE') { self.ui.openPanel('inventory'); e.preventDefault(); return; }
      if (k.indexOf('Digit') === 0) {
        const n = +k.slice(5);
        if (n >= 1 && n <= 9) { self.player.selected = n - 1; self.ui.refreshHotbar(); }
      }
      if (k === 'F3') { self.debug = !self.debug; e.preventDefault(); }
      if (k === 'KeyG' && self.player.mode === 'creative') self.spawnTestMob();
      if (k === 'KeyQ') self.dropHeld(e.ctrlKey);
      if (k === 'KeyT') self.toggleMode();
      if (k === 'Space' && self.player.mode === 'creative') {
        const now = performance.now();
        if (now - (self._lastSpace || 0) < 300) { self.player.flying = !self.player.flying; self.player.vy = 0; }
        self._lastSpace = now;
      }
      if (k === 'ShiftLeft' && self.player.mode === 'creative' && self.player.flying) e.preventDefault();
    });
    document.addEventListener('keyup', e => { self.keys[e.code] = false; });
    // Perte de focus (Alt+Tab, changement d'onglet) : on relâche tout, sinon
    // une touche reste « collée » et le joueur dérive indéfiniment.
    root.addEventListener('blur', () => { self.keys = {}; self.mouse.left = false; self.mouse.right = false; self.mining = null; self.freeLook = false; });

    cv.addEventListener('mousedown', e => {
      if (self.ui.open || self.dead) return;
      const locked = document.pointerLockElement === cv;

      // Premier clic (ou reprise) : on tente le verrou DANS le geste utilisateur.
      if (!locked) {
        self.audio.resume();
        self.grabPointer(true);
        self.paused = false;
        self.updatePauseUI();
        // Repli immédiat : si le verrou est refusé, le clic gauche maintenu
        // fait tourner la vue. Aucun aller-retour asynchrone requis.
        if (e.button === 0) { self.freeLook = true; self._lastMX = e.clientX; self._lastMY = e.clientY; }
        e.preventDefault();
        return;
      }

      if (e.button === 0) { self.mouse.left = true; if (!self.attack()) self.startMining(); }
      if (e.button === 2) { self.mouse.right = true; self.useItem(); }
      if (e.button === 1) { self.pickBlock(); e.preventDefault(); }
    });
    document.addEventListener('mouseup', e => {
      if (e.button === 0) { self.mouse.left = false; self.mining = null; self.freeLook = false; }
      if (e.button === 2) self.mouse.right = false;
    });
    document.addEventListener('contextmenu', e => e.preventDefault());

    document.addEventListener('mousemove', e => {
      const locked = document.pointerLockElement === cv;
      let dx, dy;
      if (locked) {
        // movementX/Y peut être absent sur certaines implémentations : on
        // retombe alors sur le différentiel de position client.
        dx = (e.movementX === undefined) ? (e.clientX - self._lastMX) : e.movementX;
        dy = (e.movementY === undefined) ? (e.clientY - self._lastMY) : e.movementY;
      } else if (self.freeLook) {
        dx = e.clientX - self._lastMX;
        dy = e.clientY - self._lastMY;
      } else { self._lastMX = e.clientX; self._lastMY = e.clientY; return; }
      self._lastMX = e.clientX; self._lastMY = e.clientY;
      if (!dx && !dy) return;
      // garde-fou contre les sauts aberrants rapportés par certains pilotes
      if (Math.abs(dx) > 400) dx = 0;
      if (Math.abs(dy) > 400) dy = 0;

      const s = self.settings.mouseSens;
      self.player.yaw -= dx * s;
      self.player.pitch -= dy * s;
      const lim = Math.PI / 2 - 0.001;
      if (self.player.pitch > lim) self.player.pitch = lim;
      if (self.player.pitch < -lim) self.player.pitch = -lim;
      // yaw borné pour éviter la dérive de précision sur de longues parties
      const TAU = Math.PI * 2;
      if (self.player.yaw > TAU || self.player.yaw < -TAU) self.player.yaw %= TAU;
    });

    cv.addEventListener('wheel', e => {
      if (self.ui.open) return;
      const d = e.deltaY > 0 ? 1 : -1;
      self.player.selected = (self.player.selected + d + 9) % 9;
      self.ui.refreshHotbar();
      e.preventDefault();
    }, { passive: false });

    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement === cv) {
        self.lockOk = true; self.lockDenied = false; self.hadLock = true;
        return;
      }
      // Sortie du verrou : on ne met en pause que si le verrou avait été
      // réellement obtenu (hadLock). Sans ce garde-fou, un refus du navigateur
      // met la partie en pause dès le démarrage et `tick()` ne tourne jamais.
      self.lockOk = false;
      if (self.hadLock && !self.ui.open && self.ready && !self.dead && !self._exitByUI) {
        self.paused = true;
        self.updatePauseUI();
      }
      self.hadLock = false;
    });
  };

  Game.prototype.togglePause = function () {
    this.paused = !this.paused;
    if (!this.paused) this.grabPointer(true);
    else if (document.pointerLockElement) { this._exitByUI = true; document.exitPointerLock(); this._exitByUI = false; }
    this.updatePauseUI();
  };
  Game.prototype.updatePauseUI = function () {
    const el = document.getElementById('pause-menu');
    if (el) el.style.display = this.paused ? 'flex' : 'none';
  };
  Game.prototype.toggleMode = function () {
    const p = this.player;
    p.mode = p.mode === 'survival' ? 'creative' : 'survival';
    p.flying = false;
    this.msg('Mode : ' + (p.mode === 'creative' ? 'Créatif' : 'Survie'));
  };
  Game.prototype.msg = function (t) {
    this.messages.push({ t, time: this.time });
    if (this.messages.length > 6) this.messages.shift();
  };

  /* ----------------------------------------------------- Cycle jour/nuit */
  Game.prototype.dayFactor = function () {
    const t = (this.worldTime % DAY_LENGTH) / DAY_LENGTH;
    return Math.max(0, Math.sin((t - 0.25) * Math.PI * 2));
  };
  Game.prototype.environment = function () {
    const t = (this.worldTime % DAY_LENGTH) / DAY_LENGTH;
    const ang = (t - 0.25) * Math.PI * 2;
    const sunY = Math.sin(ang), sunX = Math.cos(ang);
    const sunLight = Math.pow(Math.max(0, Math.min(1, sunY * 2.2 + 0.16)), 0.85);
    const dusk = Math.max(0, 1 - Math.abs(sunY) * 6);

    const dayTop = [0.34, 0.55, 0.92], dayHor = [0.68, 0.82, 0.98];
    const nightTop = [0.016, 0.022, 0.060], nightHor = [0.048, 0.058, 0.128];
    const duskCol = [0.92, 0.45, 0.22];
    const mix = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];

    let top = mix(nightTop, dayTop, sunLight);
    let hor = mix(nightHor, dayHor, sunLight);
    hor = mix(hor, duskCol, dusk * 0.62 * Math.min(1, sunLight * 3 + 0.15));

    const sunTint = mix([0.55, 0.60, 0.85], [1.0, 0.98, 0.94], Math.min(1, sunLight * 1.4));
    const sunsetTint = mix(sunTint, [1.0, 0.72, 0.45], dusk * 0.5);
    const rd = this.settings.renderDistance * 16;

    const l = Math.hypot(sunX * 0.6, sunY, 0.35) || 1;
    return {
      sunDir: [sunX * 0.6 / l, sunY / l, 0.35 / l],
      sunLight, day: Math.max(0, sunY),
      skyTop: top, skyHorizon: hor,
      fogColor: mix(hor, top, 0.25),
      fogStart: rd * 0.52, fogEnd: rd * 0.97,
      sunTint: sunsetTint,
      time: this.time,
      underwater: this.player.headInWater
    };
  };

  /* ---------------------------------------------------------- Minage --- */
  Game.prototype.startMining = function () {
    const s = this.selection;
    if (!s) return;
    if (this.player.mode === 'creative') { this.breakBlock(s.x, s.y, s.z); return; }
    const id = this.world.getBlock(s.x, s.y, s.z);
    const total = V.breakTime(id, this.player.heldId());
    if (!isFinite(total)) return;
    if (total <= 0) { this.breakBlock(s.x, s.y, s.z); return; }
    this.mining = { x: s.x, y: s.y, z: s.z, progress: 0, total, id };
  };

  Game.prototype.breakBlock = function (x, y, z) {
    const id = this.world.getBlock(x, y, z);
    if (id === 0 || id === B.BEDROCK) return;
    const bl = V.blocks[id];
    this.world.setBlock(x, y, z, 0);
    this.stats.blocksBroken++;
    this.particles.blockBreak(x, y, z, bl.tiles[2], 22);
    this.audio.breakBlock(bl.sound);

    const above = this.world.getBlock(x, y + 1, z);
    if (above && (V.T_RENDER[above] === V.RENDER.CROSS || above === B.TORCH ||
      above === B.CACTUS || above === B.SUGARCANE)) this.breakBlock(x, y + 1, z);

    const k = x + ',' + y + ',' + z;
    if (this.furnaces.has(k)) {
      const f = this.furnaces.get(k);
      [f.input, f.fuelSlot, f.output].forEach(s => { if (s) this.spawnItem(x, y, z, s.id, s.n); });
      this.furnaces.delete(k);
    }
    if (this.chests.has(k)) {
      const c = this.chests.get(k);
      c.items.forEach(s => { if (s) this.spawnItem(x, y, z, s.id, s.n); });
      this.chests.delete(k);
    }

    if (this.player.mode === 'creative') return;

    if (V.canHarvest(id, this.player.heldId())) {
      const dropId = bl.drop;
      let n = bl.dropCount === 0 ? (Math.random() < 0.06 ? 1 : 0) : (bl.dropCount || 1);
      if (id === B.LEAVES && Math.random() < 0.02) this.spawnItem(x, y, z, I.APPLE, 1);
      if (dropId >= 0 && n > 0) this.spawnItem(x, y, z, dropId, n);
    }
    const held = this.player.heldItem();
    if (held) {
      const it = V.items[held.id];
      if (it && it.durability) {
        held.dur = (held.dur || 0) + 1;
        if (held.dur >= it.durability) { this.player.inv.set(this.player.selected, null); this.audio.breakBlock('wood'); }
        this.ui.refreshHotbar();
      }
    }
    this.player.exhaustion += 0.005;
  };

  Game.prototype.spawnItem = function (x, y, z, id, n) {
    this.items.push(new E.ItemEntity(x + 0.5, y + 0.4, z + 0.5, id, n));
  };

  /* ------------------------------------------------------ Utilisation -- */
  Game.prototype.useItem = function () {
    const p = this.player;
    const held = p.heldItem();
    const s = this.selection;

    if (s && !this.keys.ShiftLeft) {
      const id = this.world.getBlock(s.x, s.y, s.z);
      const k = s.x + ',' + s.y + ',' + s.z;
      if (id === B.CRAFTING) { this.ui.openPanel('crafting'); return; }
      if (id === B.FURNACE || id === B.FURNACE_LIT) {
        let f = this.furnaces.get(k);
        if (!f) { f = { x: s.x, y: s.y, z: s.z, input: null, fuelSlot: null, output: null, fuel: 0, fuelMax: 0, progress: 0, cookTime: 10 }; this.furnaces.set(k, f); }
        this.ui.openPanel('furnace', f); return;
      }
      if (id === B.CHEST) {
        let c = this.chests.get(k);
        if (!c) { c = { items: new Array(27).fill(null) }; this.chests.set(k, c); }
        this.ui.openPanel('chest', c); return;
      }
    }

    if (!held) { p.swingT = 0.25; return; }

    const it = V.items[held.id];
    if (it && it.food && p.food < 20) {
      p.food = Math.min(20, p.food + it.food);
      p.saturation = Math.min(p.food, p.saturation + it.saturation);
      p.inv.remove(p.selected, 1);
      this.ui.refreshHotbar();
      this.audio.tone({ type: 'sine', freq: 240, to: 180, dur: 0.2, vol: 0.09 });
      this.msg('Vous mangez : ' + V.itemLabel(held.id));
      return;
    }

    if (V.isBlock(held.id) && held.id > 0 && s) {
      const nx = s.x + s.nx, ny = s.y + s.ny, nz = s.z + s.nz;
      const target = this.world.getBlock(nx, ny, nz);
      if (target !== 0 && !V.T_LIQUID[target]) return;
      const px0 = p.x - p.half, px1 = p.x + p.half, pz0 = p.z - p.half, pz1 = p.z + p.half;
      const overlap = (px1 > nx && px0 < nx + 1 && pz1 > nz && pz0 < nz + 1 &&
        p.y + p.height > ny && p.y < ny + 1);
      if (overlap && V.T_SOLID[held.id]) return;
      if (V.T_RENDER[held.id] === V.RENDER.CROSS || held.id === B.TORCH) {
        if (!V.T_SOLID[this.world.getBlock(nx, ny - 1, nz)]) return;
      }
      this.world.setBlock(nx, ny, nz, held.id);
      this.stats.blocksPlaced++;
      this.audio.place(V.blocks[held.id].sound);
      if (p.mode !== 'creative') { p.inv.remove(p.selected, 1); this.ui.refreshHotbar(); }
      p.swingT = 0.25;
      return;
    }
    p.swingT = 0.25;
  };

  Game.prototype.pickBlock = function () {
    const s = this.selection;
    if (!s) return;
    const id = this.world.getBlock(s.x, s.y, s.z);
    if (!id) return;
    const p = this.player;
    for (let i = 0; i < 9; i++) { const st = p.inv.get(i); if (st && st.id === id) { p.selected = i; this.ui.refreshHotbar(); return; } }
    if (p.mode === 'creative') { p.inv.set(p.selected, { id, n: 1 }); this.ui.refreshHotbar(); }
  };

  Game.prototype.dropHeld = function (all) {
    const p = this.player;
    const s = p.heldItem();
    if (!s) return;
    const n = all ? s.n : 1;
    p.inv.remove(p.selected, n);
    const d = this.camDir;
    const e = new E.ItemEntity(p.x + d[0] * 0.6, p.y + 1.3, p.z + d[2] * 0.6, s.id, n);
    e.vx = d[0] * 7; e.vy = d[1] * 5 + 2.2; e.vz = d[2] * 7;
    e.pickupDelay = 1.2;
    this.items.push(e);
    this.ui.refreshHotbar();
  };

  function rayAABB(ox, oy, oz, dx, dy, dz, x0, y0, z0, x1, y1, z1) {
    let tmin = 0, tmax = 1e9;
    const o = [ox, oy, oz], d = [dx, dy, dz], lo = [x0, y0, z0], hi = [x1, y1, z1];
    for (let i = 0; i < 3; i++) {
      if (Math.abs(d[i]) < 1e-8) { if (o[i] < lo[i] || o[i] > hi[i]) return null; }
      else {
        let t1 = (lo[i] - o[i]) / d[i], t2 = (hi[i] - o[i]) / d[i];
        if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
        if (t1 > tmin) tmin = t1;
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) return null;
      }
    }
    return tmin;
  }

  Game.prototype.attack = function () {
    const p = this.player;
    const d = this.camDir;
    let best = null, bestT = 4.0;
    for (let i = 0; i < this.mobs.length; i++) {
      const m = this.mobs[i], def = m.def;
      const t = rayAABB(p.x, p.y + p.eye, p.z, d[0], d[1], d[2],
        m.x - def.w * 0.5, m.y, m.z - def.w * 0.5,
        m.x + def.w * 0.5, m.y + def.h, m.z + def.w * 0.5);
      if (t !== null && t < bestT) { bestT = t; best = m; }
    }
    // un bloc plus proche bloque l'attaque
    if (best && this.selection && this.selection.dist < bestT) return false;
    if (!best) return false;
    p.swingT = 0.25;
    const held = p.heldItem();
    const it = held ? V.items[held.id] : null;
    const dmg = it ? it.damage : 1;
    if (best.hurt(dmg, best.x - p.x, best.z - p.z)) {
      this.audio.hitMob();
      for (let i = 0; i < 8; i++)
        this.particles.spawn(best.x, best.y + best.def.h * 0.6, best.z,
          (Math.random() - 0.5) * 3, Math.random() * 3, (Math.random() - 0.5) * 3,
          0.5, 0.07, [0.75, 0.08, 0.08], 16, -1);
      if (held && it && it.durability) {
        held.dur = (held.dur || 0) + 1;
        if (held.dur >= it.durability) p.inv.set(p.selected, null);
        this.ui.refreshHotbar();
      }
      p.exhaustion += 0.1;
    }
    return true;
  };

  /* =====================================================================
   *  TICK LOGIQUE — 20 Hz, déterministe
   * ===================================================================== */
  Game.prototype.tick = function () {
    const dt = TICK;
    const p = this.player;
    const w = this.world;

    this.worldTime += dt;
    this.stats.playTime += dt;
    if (p.hurtTimer > 0) p.hurtTimer -= dt;
    if (p.swingT > 0) p.swingT -= dt;

    /* ------------------------------------------------- Repère de caméra */
    const cy = Math.cos(p.yaw), sy = Math.sin(p.yaw);
    // avant projeté sur le plan horizontal, droite orthogonale
    const fx = -sy, fz = -cy;
    const rx = cy, rz = -sy;

    const K = this.keys;
    let ix = 0, iz = 0;
    if (K.KeyW || K.ArrowUp) iz += 1;
    if (K.KeyS || K.ArrowDown) iz -= 1;
    if (K.KeyA || K.ArrowLeft) ix -= 1;
    if (K.KeyD || K.ArrowRight) ix += 1;
    const il = Math.hypot(ix, iz);
    if (il > 0) { ix /= il; iz /= il; }

    p.sneaking = !!K.ShiftLeft && !p.flying;
    p.sprinting = !!K.ControlLeft && il > 0 && !p.sneaking && p.food > 6;

    /* -------------------------------------------------------- Fluides -- */
    const bx = Math.floor(p.x), bz = Math.floor(p.z);
    const feetId = w.getBlock(bx, Math.floor(p.y + 0.1), bz);
    const bodyId = w.getBlock(bx, Math.floor(p.y + 0.9), bz);
    const headId = w.getBlock(bx, Math.floor(p.y + p.eye), bz);
    const inLiquid = !!(V.T_LIQUID[feetId] || V.T_LIQUID[bodyId]);
    const inLava = feetId === B.LAVA || bodyId === B.LAVA;
    const wasInWater = p.inWater;
    p.inWater = inLiquid;
    p.headInWater = !!V.T_LIQUID[headId];
    if (p.inWater && !wasInWater && Math.abs(p.vy) > 4) this.audio.splash();

    /* --------------------------------------------------- Vitesse cible - */
    let speed = 4.317;                                 // m/s, marche
    if (p.sprinting) speed = 5.612;
    if (p.sneaking) speed = 1.31;
    if (p.flying) speed = p.sprinting ? 21.0 : 10.9;
    if (inLiquid && !p.flying) speed *= 0.42;

    const tvx = (fx * iz + rx * ix) * speed;
    const tvz = (fz * iz + rz * ix) * speed;

    if (p.flying) {
      p.vx += (tvx - p.vx) * Math.min(1, 12 * dt);
      p.vz += (tvz - p.vz) * Math.min(1, 12 * dt);
      let vy = 0;
      if (K.Space) vy += speed * 0.8;
      if (K.ShiftLeft) vy -= speed * 0.8;
      p.vy += (vy - p.vy) * Math.min(1, 12 * dt);
      p.fallStart = null;
    } else {
      const accel = p.onGround ? 26 : (inLiquid ? 9 : 5.4);
      p.vx += (tvx - p.vx) * Math.min(1, accel * dt);
      p.vz += (tvz - p.vz) * Math.min(1, accel * dt);

      if (inLiquid) {
        // flottabilité : poussée nette faible, chute très amortie
        p.vy -= 8.4 * dt;
        if (K.Space) p.vy += 22 * dt;
        if (p.vy < -3.0) p.vy = -3.0;
        if (p.vy > 4.2) p.vy = 4.2;
        p.vx *= 0.90; p.vz *= 0.90;
        p.fallStart = null;
      } else {
        p.vy -= 32 * dt;                               // g ≈ 32 blocs/s²
        if (p.vy < -78) p.vy = -78;
        if (K.Space && p.onGround) {
          p.vy = 8.95;                                 // ≈ 1.25 bloc de saut
          p.onGround = false;
          p.fallStart = p.y;
          if (p.sprinting) { p.vx += tvx * 0.22; p.vz += tvz * 0.22; }
          p.exhaustion += p.sprinting ? 0.2 : 0.05;
        }
      }
      // grimpe (échelle / liane) — réservé, aucun bloc climbable pour l'instant
      const climb = V.blocks[bodyId] && V.blocks[bodyId].climbable;
      if (climb) { p.vy = K.Space ? 3.0 : (K.ShiftLeft ? 0 : -1.6); p.fallStart = null; }
    }

    /* ------------------------------------------------------ Collisions - */
    const before = { x: p.x, y: p.y, z: p.z };
    const pos = { x: p.x, y: p.y, z: p.z };
    const step = (p.onGround && !p.flying) ? 0.6 : 0;
    const r = P.moveAABB(w, pos, { x: p.vx * dt, y: p.vy * dt, z: p.vz * dt },
      p.half, p.height, step);

    // garde-fou d'accroupissement : empêche de basculer dans le vide
    if (p.sneaking && p.onGround && !this.groundUnder(pos.x, pos.y, pos.z, p.half)) {
      // on retente axe par axe pour permettre le glissement le long du rebord
      const tryX = this.groundUnder(pos.x, pos.y, before.z, p.half);
      const tryZ = this.groundUnder(before.x, pos.y, pos.z, p.half);
      if (tryX) { pos.z = before.z; p.vz = 0; }
      else if (tryZ) { pos.x = before.x; p.vx = 0; }
      else { pos.x = before.x; pos.z = before.z; p.vx = 0; p.vz = 0; }
    }

    p.x = pos.x; p.y = pos.y; p.z = pos.z;
    if (r.hitX) p.vx = 0;
    if (r.hitZ) p.vz = 0;

    const landed = r.onGround && !p.onGround;
    p.onGround = r.onGround;

    /* ------------------------------------------------- Dégâts de chute - */
    if (!p.onGround && p.vy < 0 && p.fallStart === null && !p.flying && !inLiquid) p.fallStart = p.y;
    if (r.hitY && p.vy < 0) {
      if (p.fallStart !== null && !inLiquid && p.mode === 'survival') {
        const fall = p.fallStart - p.y;
        if (fall > 3.0) this.damagePlayer(Math.floor(fall - 3.0), 'chute');
      }
      p.fallStart = null;
      p.vy = 0;
    } else if (r.hitY) p.vy = 0;
    if (inLiquid || p.flying || p.onGround) p.fallStart = p.onGround ? null : p.fallStart;

    /* ----------------------------------------------- Distance / bruits - */
    const dxm = p.x - before.x, dzm = p.z - before.z;
    const moved = Math.hypot(dxm, dzm);
    this.stats.distance += moved;
    if (p.onGround && moved > 0.02) {
      const gid = w.getBlock(Math.floor(p.x), Math.floor(p.y - 0.15), Math.floor(p.z));
      const bl = V.blocks[gid];
      if (bl && bl.sound !== 'none') this.audio.step(bl.sound, true);
      p.exhaustion += (p.sprinting ? 0.1 : 0.01) * moved;
    }
    if (landed && p.vy < -6) this.audio.step('stone', true);

    /* ----------------------------------------- Asphyxie / contact nocif */
    if (p.mode === 'survival') {
      if (p.headInWater && headId === B.WATER) {
        p.breathe -= dt;
        if (p.breathe <= 0) { p.breathe = 1; this.damagePlayer(2, 'noyade'); }
      } else p.breathe = Math.min(10, p.breathe + dt * 4);

      if (inLava) { if (!this._lavaCd || this._lavaCd <= 0) { this.damagePlayer(4, 'lave'); this._lavaCd = 0.5; } }
      this._lavaCd = (this._lavaCd || 0) - dt;

      // bloc urticant (cactus) au contact horizontal
      const hurtIds = [feetId, bodyId];
      for (let i = 0; i < hurtIds.length; i++) {
        const bl = V.blocks[hurtIds[i]];
        if (bl && bl.hurt && hurtIds[i] !== B.LAVA) {
          if (!this._contactCd || this._contactCd <= 0) { this.damagePlayer(bl.hurt, 'contact'); this._contactCd = 0.6; }
        }
      }
      this._contactCd = (this._contactCd || 0) - dt;

      // suffocation dans un bloc opaque (téléport de sécurité désactivé)
      if (V.T_OPAQUE[headId] && V.T_SOLID[headId]) {
        if (!this._suffCd || this._suffCd <= 0) { this.damagePlayer(1, 'suffocation'); this._suffCd = 0.5; }
        this._suffCd = (this._suffCd || 0) - dt;
      }
      if (p.y < -24) this.damagePlayer(20, 'le vide');
    }

    /* --------------------------------------------- Faim / régénération - */
    if (p.mode === 'survival') {
      if (p.exhaustion >= 4) {
        p.exhaustion -= 4;
        if (p.saturation > 0) p.saturation = Math.max(0, p.saturation - 1);
        else if (p.food > 0) p.food--;
      }
      if (p.food >= 18 && p.hp < p.maxHp) {
        p.regenTimer += dt;
        if (p.regenTimer >= 4) { p.regenTimer = 0; p.hp = Math.min(p.maxHp, p.hp + 1); p.exhaustion += 3; }
      } else p.regenTimer = 0;
      if (p.food === 0) {
        p.starveTimer += dt;
        if (p.starveTimer >= 4) { p.starveTimer = 0; this.damagePlayer(1, 'la faim'); }
      } else p.starveTimer = 0;
    } else {
      p.hp = p.maxHp; p.food = 20;
    }

    /* ------------------------------------------------------- Minage --- */
    if (this.mouse.left && this.mining) {
      const m = this.mining;
      if (w.getBlock(m.x, m.y, m.z) !== m.id) this.mining = null;
      else {
        m.progress += dt;
        if ((m.progress * 20 | 0) % 4 === 0) {
          const bl = V.blocks[m.id];
          if (bl && bl.sound !== 'none') this.audio.dig(bl.sound);
          this.particles.spawn(m.x + Math.random(), m.y + Math.random(), m.z + Math.random(),
            (Math.random() - 0.5) * 1.4, Math.random() * 1.2, (Math.random() - 0.5) * 1.4,
            0.35, 0.06, [1, 1, 1], 16, bl.tiles[2]);
        }
        if (m.progress >= m.total) { this.breakBlock(m.x, m.y, m.z); this.mining = null; }
      }
    } else if (!this.mouse.left) this.mining = null;

    // maintien du clic droit : pose répétée modérée
    if (this.mouse.right) {
      this._placeCd = (this._placeCd || 0) - dt;
      if (this._placeCd <= 0) { this.useItem(); this._placeCd = 0.22; }
    } else this._placeCd = 0;

    /* ------------------------------------------------------ Fourneaux -- */
    const self = this;
    this.furnaces.forEach(f => self.tickFurnace(f, dt));

    /* ---------------------------------------------------------- Mobs --- */
    const isDay = this.dayFactor() > 0.25;
    for (let i = this.mobs.length - 1; i >= 0; i--) {
      const m = this.mobs[i];
      if (!w.isLoaded(Math.floor(m.x), Math.floor(m.z))) {
        // hors chunks chargés : on retire proprement
        if (Math.hypot(m.x - p.x, m.z - p.z) > 96) { this.mobs.splice(i, 1); }
        continue;
      }
      m.update(dt, w, p, isDay);

      if (m.pendingAttack) {
        const dmg = m.pendingAttack;
        m.pendingAttack = 0;
        if (Math.hypot(m.x - p.x, (m.y - p.y) * 0.6, m.z - p.z) < (m.def.reach || 1.6) + 0.6) {
          this.damagePlayer(dmg, m.def.hostile ? 'un ' + m.type : m.type);
          const l = Math.hypot(p.x - m.x, p.z - m.z) || 1;
          p.vx += (p.x - m.x) / l * 5.4; p.vz += (p.z - m.z) / l * 5.4; p.vy = Math.max(p.vy, 3.4);
        }
      }
      if (m.fuse > 0 && !m._fuseSound) { this.audio.fuse(); m._fuseSound = true; }
      if (m.fuse < 0) m._fuseSound = false;
      if (m.exploding) { this.explode(m.x, m.y + 0.6, m.z, 3.0); m.dead = true; m.noDrops = true; }

      if (Math.random() < dt * 0.03) this.audio.mobSound(m.type);

      if (m.dead) {
        if (!m.noDrops) {
          m.rollDrops().forEach(d => self.spawnItem(m.x - 0.5, m.y, m.z - 0.5, d.id, d.n));
          this.addXP(m.def.xp || 1);
        }
        for (let k = 0; k < 12; k++)
          this.particles.spawn(m.x, m.y + m.def.h * 0.5, m.z,
            (Math.random() - 0.5) * 2.6, Math.random() * 2.6, (Math.random() - 0.5) * 2.6,
            0.7, 0.09, [0.62, 0.08, 0.08], 14, -1);
        this.stats.mobsKilled++;
        this.mobs.splice(i, 1);
      }
    }

    /* -------------------------------------------------- Items au sol --- */
    for (let i = this.items.length - 1; i >= 0; i--) {
      const e = this.items[i];
      e.update(dt, w, p);
      if (e.pickupDelay <= 0) {
        const d = Math.hypot(e.x - p.x, (e.y - (p.y + 0.6)), e.z - p.z);
        if (d < 1.05) {
          const left = p.inv.add(e.item, e.count);
          if (left < e.count) {
            this.audio.pickup();
            this.ui.refreshHotbar();
            if (this.ui.open) this.ui.render();
          }
          if (left === 0) { this.items.splice(i, 1); continue; }
          e.count = left; e.pickupDelay = 0.6;
        }
      }
      if (e.dead) this.items.splice(i, 1);
    }

    /* ------------------------------------------------------ Particules - */
    this.particles.update(dt, w);

    /* --------------------------------------------- Spawn / autosave ---- */
    this.spawnCd -= dt;
    if (this.spawnCd <= 0) { this.spawnCd = 4; this.trySpawnMobs(); }

    this.saveCd -= dt;
    if (this.saveCd <= 0) { this.saveCd = 45; this.save(true); }
  };

  /** Y a-t-il du sol solide sous l'empreinte du joueur ? (garde-fou sneak) */
  Game.prototype.groundUnder = function (x, y, z, half) {
    const w = this.world;
    const y0 = Math.floor(y - 0.08);
    for (let bx = Math.floor(x - half); bx <= Math.floor(x + half); bx++)
      for (let bz = Math.floor(z - half); bz <= Math.floor(z + half); bz++)
        if (V.T_SOLID[w.getBlock(bx, y0, bz)]) return true;
    return false;
  };

  /* ------------------------------------------------------- Santé / mort */
  Game.prototype.damagePlayer = function (dmg, cause) {
    const p = this.player;
    if (p.mode === 'creative' || this.dead || dmg <= 0) return;
    if (p.hurtTimer > 0) return;
    p.hp -= dmg;
    p.hurtTimer = 0.5;
    this.audio.hurt();
    this.lastDamageCause = cause || 'des blessures';
    for (let i = 0; i < 6; i++)
      this.particles.spawn(p.x, p.y + 1.0, p.z,
        (Math.random() - 0.5) * 2, Math.random() * 2, (Math.random() - 0.5) * 2,
        0.4, 0.06, [0.8, 0.05, 0.05], 14, -1);
    if (p.hp <= 0) { p.hp = 0; this.die(cause); }
  };

  Game.prototype.die = function (cause) {
    const p = this.player;
    this.dead = true;
    this.stats.deaths++;
    this.mining = null;
    if (document.pointerLockElement) document.exitPointerLock();
    if (this.ui.open) this.ui.closePanel();
    // le contenu de l'inventaire tombe au sol
    for (let i = 0; i < p.inv.size; i++) {
      const s = p.inv.get(i);
      if (s) { this.spawnItem(p.x - 0.5, p.y + 0.5, p.z - 0.5, s.id, s.n); p.inv.set(i, null); }
    }
    p.xp = 0; p.level = 0;
    this.ui.refreshHotbar();
    const el = document.getElementById('death-screen');
    const dc = document.getElementById('death-cause');
    if (dc) dc.textContent = 'Cause : ' + (cause || 'inconnue');
    if (el) el.style.display = 'flex';
  };

  Game.prototype.respawn = function () {
    const p = this.player;
    const sx = this.spawnPoint ? this.spawnPoint[0] : 0.5;
    const sz = this.spawnPoint ? this.spawnPoint[2] : 0.5;
    let h = this.world.getHeight(Math.floor(sx), Math.floor(sz));
    if (h < 0) h = V.SEA_LEVEL;
    p.x = sx; p.z = sz; p.y = h + 1.05;
    p.vx = p.vy = p.vz = 0;
    p.hp = p.maxHp; p.food = 20; p.saturation = 5;
    p.breathe = 10; p.fallStart = null; p.exhaustion = 0;
    p.hurtTimer = 1.0; p.flying = false;
    this.dead = false;
    const el = document.getElementById('death-screen');
    if (el) el.style.display = 'none';
    this.paused = false;
    this.updatePauseUI();
    this.grabPointer(true);
    this.msg('Réapparition');
  };

  /* ---------------------------------------------------------- Expérience */
  Game.prototype.addXP = function (n) {
    const p = this.player;
    p.xp += n;
    // seuil vanilla simplifié : 7 + 2·niveau
    let need = 7 + p.level * 2;
    while (p.xp >= need) {
      p.xp -= need;
      p.level++;
      need = 7 + p.level * 2;
      this.audio.levelUp();
      this.msg('Niveau ' + p.level);
    }
  };

  /* ----------------------------------------------------------- Fourneau */
  Game.prototype.tickFurnace = function (f, dt) {
    const w = this.world;
    const id = w.getBlock(f.x, f.y, f.z);
    if (id !== B.FURNACE && id !== B.FURNACE_LIT) { this.furnaces.delete(f.x + ',' + f.y + ',' + f.z); return; }

    const recipe = f.input ? C.smeltResult(f.input.id) : null;
    const canOutput = recipe && (!f.output || (f.output.id === recipe.id && f.output.n < V.maxStack(recipe.id)));

    // consommation de combustible
    if (f.fuel <= 0 && recipe && canOutput && f.fuelSlot) {
      const fv = V.fuelValue(f.fuelSlot.id);
      if (fv > 0) {
        f.fuelMax = fv / 20;                 // ticks → secondes
        f.fuel = f.fuelMax;
        f.fuelSlot.n--;
        if (f.fuelSlot.n <= 0) f.fuelSlot = null;
      }
    }

    if (f.fuel > 0) {
      f.fuel -= dt;
      if (recipe && canOutput) {
        f.progress += dt;
        if (f.progress >= f.cookTime) {
          f.progress = 0;
          if (f.output) f.output.n += recipe.n;
          else f.output = { id: recipe.id, n: recipe.n };
          f.input.n--;
          if (f.input.n <= 0) f.input = null;
          this.audio.tone({ type: 'sine', freq: 420, to: 620, dur: 0.14, vol: 0.07 });
        }
      } else f.progress = Math.max(0, f.progress - dt * 2);
      // fumée
      if (Math.random() < dt * 6)
        this.particles.spawn(f.x + 0.3 + Math.random() * 0.4, f.y + 1.0, f.z + 0.3 + Math.random() * 0.4,
          (Math.random() - 0.5) * 0.2, 0.7 + Math.random() * 0.4, (Math.random() - 0.5) * 0.2,
          1.4, 0.09, [0.30, 0.29, 0.28], -1.2, -1);
    } else {
      f.fuel = 0;
      f.progress = Math.max(0, f.progress - dt * 2);
    }

    // synchronisation de l'état visuel du bloc
    const lit = f.fuel > 0;
    if (lit && id === B.FURNACE) w.setBlock(f.x, f.y, f.z, B.FURNACE_LIT);
    else if (!lit && id === B.FURNACE_LIT) w.setBlock(f.x, f.y, f.z, B.FURNACE);

    if (this.ui.open === 'furnace' && this.ui.furnace === f) {
      // rafraîchissement léger : uniquement les jauges
      const fl = document.querySelector('#panel-body .flame > i');
      const pr = document.querySelector('#panel-body .fprog > i');
      if (fl) fl.style.height = ((f.fuelMax > 0 ? f.fuel / f.fuelMax : 0) * 100).toFixed(0) + '%';
      if (pr) pr.style.width = ((f.cookTime > 0 ? f.progress / f.cookTime : 0) * 100).toFixed(0) + '%';
      if (this._furnaceSig !== (f.input ? f.input.id + 'x' + f.input.n : '0') + '|' +
        (f.output ? f.output.id + 'x' + f.output.n : '0') + '|' +
        (f.fuelSlot ? f.fuelSlot.id + 'x' + f.fuelSlot.n : '0')) {
        this._furnaceSig = (f.input ? f.input.id + 'x' + f.input.n : '0') + '|' +
          (f.output ? f.output.id + 'x' + f.output.n : '0') + '|' +
          (f.fuelSlot ? f.fuelSlot.id + 'x' + f.fuelSlot.n : '0');
        this.ui.render();
      }
    }
  };

  /* --------------------------------------------------------- Explosion */
  Game.prototype.explode = function (cx, cy, cz, power) {
    const w = this.world;
    const R = Math.ceil(power * 1.3);
    this.audio.explode();

    const removed = [];
    for (let dx = -R; dx <= R; dx++)
      for (let dy = -R; dy <= R; dy++)
        for (let dz = -R; dz <= R; dz++) {
          const d = Math.hypot(dx, dy, dz);
          if (d > power * (0.85 + Math.random() * 0.3)) continue;
          const x = Math.floor(cx) + dx, y = Math.floor(cy) + dy, z = Math.floor(cz) + dz;
          const id = w.getBlock(x, y, z);
          if (!id || id === B.BEDROCK || V.T_LIQUID[id]) continue;
          const bl = V.blocks[id];
          if (bl.hardness < 0 || bl.hardness > 20) continue;   // obsidienne résiste
          removed.push([x, y, z, id]);
        }
    for (let i = 0; i < removed.length; i++) {
      const rr = removed[i];
      w.setBlock(rr[0], rr[1], rr[2], 0);
      if (Math.random() < 0.25) {
        const bl = V.blocks[rr[3]];
        if (bl.drop >= 0) this.spawnItem(rr[0], rr[1], rr[2], bl.drop, bl.dropCount || 1);
      }
      // TNT en chaîne
      if (rr[3] === B.TNT) { const s = this; setTimeout(() => s.explode(rr[0] + 0.5, rr[1] + 0.5, rr[2] + 0.5, power * 0.9), 120); }
    }

    for (let i = 0; i < 70; i++) {
      const a = Math.random() * Math.PI * 2, e = (Math.random() - 0.5) * Math.PI;
      const sp = 3 + Math.random() * 9;
      const g = 0.85 + Math.random() * 0.15;
      this.particles.spawn(cx, cy, cz,
        Math.cos(a) * Math.cos(e) * sp, Math.sin(e) * sp + 3, Math.sin(a) * Math.cos(e) * sp,
        0.6 + Math.random() * 0.9, 0.16 + Math.random() * 0.20,
        [g, g * 0.72, g * 0.5], 8, -1);
    }

    // dégâts et projection
    const p = this.player;
    const pd = Math.hypot(p.x - cx, p.y + 0.9 - cy, p.z - cz);
    if (pd < power * 2.2) {
      const k = 1 - pd / (power * 2.2);
      this.damagePlayer(Math.ceil(k * 18), 'une explosion');
      const l = pd || 1;
      p.vx += (p.x - cx) / l * k * 18; p.vy += (p.y - cy) / l * k * 14 + k * 5; p.vz += (p.z - cz) / l * k * 18;
      p.fallStart = null;
    }
    for (let i = 0; i < this.mobs.length; i++) {
      const m = this.mobs[i];
      const d = Math.hypot(m.x - cx, m.y - cy, m.z - cz);
      if (d < power * 2.2) m.hurt(Math.ceil((1 - d / (power * 2.2)) * 20), m.x - cx, m.z - cz);
    }
  };

  /* ------------------------------------------------------ Spawn de mobs */
  Game.prototype.trySpawnMobs = function () {
    if (this.player.mode === 'creative') return;
    const w = this.world, p = this.player;
    const isDay = this.dayFactor() > 0.25;
    const cap = isDay ? 14 : 26;
    if (this.mobs.length >= cap) return;

    const wantHostile = !isDay || Math.random() < 0.55;
    const pool = wantHostile ? E.HOSTILE : E.PASSIVE;

    for (let attempt = 0; attempt < 24; attempt++) {
      const a = Math.random() * Math.PI * 2;
      const dist = 24 + Math.random() * 32;             // ni trop près, ni hors portée
      const x = Math.floor(p.x + Math.cos(a) * dist);
      const z = Math.floor(p.z + Math.sin(a) * dist);
      if (!w.isLoaded(x, z)) continue;

      let y;
      if (wantHostile) {
        // les hostiles apparaissent dans l'obscurité : surface nocturne ou souterrain
        if (!isDay && Math.random() < 0.6) y = w.getHeight(x, z) + 1;
        else {
          y = 12 + Math.floor(Math.random() * (V.SEA_LEVEL - 14));
          // il faut une poche d'air éclairée faiblement
          if (w.isSkyExposed(x, y, z)) continue;
        }
      } else {
        y = w.getHeight(x, z) + 1;
        if (!isDay) return;                              // passifs le jour uniquement
      }
      if (y <= 1 || y >= V.CH_Y - 3) continue;

      const ground = w.getBlock(x, y - 1, z);
      if (!V.T_SOLID[ground] || V.T_LIQUID[ground]) continue;
      if (ground === B.LEAVES) continue;
      const type = pool[(Math.random() * pool.length) | 0];
      const def = E.MOB_DEF[type];
      // volume libre
      let free = true;
      for (let yy = 0; yy < Math.ceil(def.h); yy++)
        if (V.T_SOLID[w.getBlock(x, y + yy, z)] || V.T_LIQUID[w.getBlock(x, y + yy, z)]) { free = false; break; }
      if (!free) continue;
      if (!wantHostile && ground !== B.GRASS && ground !== B.SNOW_GRASS && ground !== B.PODZOL) continue;

      const n = 1 + ((Math.random() * (wantHostile ? 2 : 3)) | 0);
      for (let i = 0; i < n; i++)
        this.mobs.push(new E.Mob(type, x + 0.5 + (Math.random() - 0.5) * 1.6, y + 0.02,
          z + 0.5 + (Math.random() - 0.5) * 1.6));
      return;
    }
  };

  /** Debug créatif : fait apparaître un mob devant le joueur (touche G). */
  Game.prototype.spawnTestMob = function () {
    const p = this.player, d = this.camDir;
    const types = E.PASSIVE.concat(E.HOSTILE);
    const t = types[(Math.random() * types.length) | 0];
    this.mobs.push(new E.Mob(t, p.x + d[0] * 3, p.y + 0.2, p.z + d[2] * 3));
    this.msg('Apparition : ' + t);
  };

  /* ==================================================== Persistance ==== */
  Game.prototype.save = function (silent) {
    if (!this.ready || !this.worldId) return Promise.resolve(false);
    const p = this.player;
    const edits = [];
    this.world.edits.forEach((id, k) => { const q = k.split(','); edits.push(+q[0], +q[1], +q[2], id); });

    const furnaces = [];
    this.furnaces.forEach(f => furnaces.push({
      x: f.x, y: f.y, z: f.z,
      input: f.input, fuelSlot: f.fuelSlot, output: f.output,
      fuel: f.fuel, fuelMax: f.fuelMax, progress: f.progress, cookTime: f.cookTime
    }));
    const chests = [];
    this.chests.forEach((c, k) => chests.push({ k, items: c.items }));

    const payload = {
      name: this.worldName || 'Monde',
      seed: this.seed,
      version: 1,
      savedAt: Date.now(),
      player: {
        x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch,
        hp: p.hp, food: p.food, saturation: p.saturation,
        xp: p.xp, level: p.level, mode: p.mode, selected: p.selected,
        inv: p.inv.serialize()
      },
      spawnPoint: this.spawnPoint || [p.x, p.y, p.z],
      worldTime: this.worldTime,
      stats: this.stats,
      settings: this.settings,
      edits,
      furnaces,
      chests
    };
    const self = this;
    return root.VCWorld.saveWorld(this.worldId, payload).then(() => {
      if (!silent) self.msg('Partie sauvegardée');
      return true;
    }).catch(err => { console.warn('save', err); return false; });
  };

  Game.prototype.applySave = function (data) {
    const p = this.player;
    this.worldName = data.name || 'Monde';
    if (data.settings) Object.assign(this.settings, data.settings);
    if (typeof data.worldTime === 'number') this.worldTime = data.worldTime;
    if (data.stats) Object.assign(this.stats, data.stats);
    if (data.spawnPoint) this.spawnPoint = data.spawnPoint;

    if (data.player) {
      const s = data.player;
      p.x = s.x; p.y = s.y; p.z = s.z;
      p.yaw = s.yaw || 0; p.pitch = s.pitch || 0;
      p.hp = s.hp === undefined ? 20 : s.hp;
      p.food = s.food === undefined ? 20 : s.food;
      p.saturation = s.saturation || 0;
      p.xp = s.xp || 0; p.level = s.level || 0;
      p.mode = s.mode || 'survival';
      p.selected = s.selected || 0;
      if (s.inv) p.inv.deserialize(s.inv);
    }
    if (data.edits && data.edits.length) {
      for (let i = 0; i < data.edits.length; i += 4)
        this.world.edits.set(data.edits[i] + ',' + data.edits[i + 1] + ',' + data.edits[i + 2], data.edits[i + 3]);
    }
    if (data.furnaces) data.furnaces.forEach(f => this.furnaces.set(f.x + ',' + f.y + ',' + f.z, f));
    if (data.chests) data.chests.forEach(c => this.chests.set(c.k, { items: c.items }));
    this.world.renderDistance = this.settings.renderDistance;
    this.audio.setVolume(this.settings.sound);
  };

  root.VCGame = { Game, Player, TICK, DAY_LENGTH, rayAABB };
})(typeof self !== 'undefined' ? self : this);
