/* =========================================================================
 *  VOXELCRAFT — Atlas de textures procédural
 *  256 tuiles 16×16 dessinées au canvas avec un bruit à valeur déterministe.
 *  Aucune ressource externe : textures 100 % originales, style pixel-art.
 * ========================================================================= */
(function (root) {
  'use strict';
  const V = root.VC;
  const TS = 16;                       // taille d'une tuile
  const COLS = V.ATLAS_COLS;           // 16
  const SIZE = TS * COLS;              // 256 px

  /* ------------------------------------------------------------ Aléa --- */
  function rnd32(x, y, s) {
    let h = (s | 0);
    h = Math.imul(h ^ (x | 0), 0x27d4eb2d);
    h = Math.imul(h ^ (y | 0), 0x165667b1);
    h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
  }
  function hexToRgb(h) {
    return [(h >> 16) & 255, (h >> 8) & 255, h & 255];
  }
  function clamp255(v) { return v < 0 ? 0 : v > 255 ? 255 : v | 0; }

  /* ---------------------------------------------------------- Painter -- */
  function Painter(data, tileIndex) {
    this.d = data;
    this.ox = (tileIndex % COLS) * TS;
    this.oy = ((tileIndex / COLS) | 0) * TS;
  }
  Painter.prototype.px = function (x, y, r, g, b, a) {
    if (x < 0 || x >= TS || y < 0 || y >= TS) return;
    const i = ((this.oy + y) * SIZE + (this.ox + x)) * 4;
    const d = this.d;
    a = a === undefined ? 255 : a;
    if (a >= 255) { d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255; }
    else {
      const k = a / 255, ik = 1 - k;
      d[i] = clamp255(d[i] * ik + r * k);
      d[i + 1] = clamp255(d[i + 1] * ik + g * k);
      d[i + 2] = clamp255(d[i + 2] * ik + b * k);
      d[i + 3] = Math.max(d[i + 3], a);
    }
  };
  Painter.prototype.rect = function (x0, y0, w, h, r, g, b, a) {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) this.px(x, y, r, g, b, a);
  };
  Painter.prototype.clear = function () { this.rect(0, 0, TS, TS, 0, 0, 0, 0); };

  /** Remplit avec une couleur bruitée (aspect granuleux type Minecraft). */
  Painter.prototype.noiseFill = function (hex, amp, seed, bias) {
    const [r, g, b] = hexToRgb(hex);
    for (let y = 0; y < TS; y++) {
      for (let x = 0; x < TS; x++) {
        let n = (rnd32(x, y, seed) - 0.5) * 2;
        // léger bruit basse fréquence pour éviter le « sel & poivre » pur
        const n2 = (rnd32(x >> 1, y >> 1, seed + 77) - 0.5) * 2;
        n = n * 0.6 + n2 * 0.4;
        const k = n * amp + (bias || 0);
        this.px(x, y, clamp255(r + k), clamp255(g + k), clamp255(b + k));
      }
    }
  };
  /** Éclaboussures de couleur (minerais, mousse, taches). */
  Painter.prototype.speckle = function (hex, count, seed, size) {
    const [r, g, b] = hexToRgb(hex);
    for (let i = 0; i < count; i++) {
      const x = (rnd32(i, 0, seed) * TS) | 0;
      const y = (rnd32(i, 1, seed) * TS) | 0;
      const s = size || 1;
      for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) {
        const k = (rnd32(i, dx * 3 + dy, seed + 5) - 0.5) * 26;
        this.px(x + dx, y + dy, clamp255(r + k), clamp255(g + k), clamp255(b + k));
      }
    }
  };
  /** Contour d'ombrage 3D (blocs métalliques, coffres). */
  Painter.prototype.bevel = function (light, dark) {
    for (let i = 0; i < TS; i++) {
      this.px(i, 0, 255, 255, 255, light);
      this.px(0, i, 255, 255, 255, light);
      this.px(i, TS - 1, 0, 0, 0, dark);
      this.px(TS - 1, i, 0, 0, 0, dark);
    }
  };
  Painter.prototype.line = function (x0, y0, x1, y1, hex, a) {
    const [r, g, b] = hexToRgb(hex);
    const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx - dy, x = x0, y = y0;
    for (let n = 0; n < 64; n++) {
      this.px(x, y, r, g, b, a);
      if (x === x1 && y === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x += sx; }
      if (e2 < dx) { err += dx; y += sy; }
    }
  };

  /* ------------------------------------------------- Peintres de tuiles */
  const PAINT = {};

  // --- terrain ---
  PAINT.stone = p => { p.noiseFill(0x7f7f7f, 16, 11); p.speckle(0x6e6e6e, 26, 12, 2); p.speckle(0x8c8c8c, 18, 13); };
  PAINT.cobblestone = p => {
    p.noiseFill(0x6d6d6d, 10, 21);
    // pavés : grille irrégulière avec joints sombres
    const cells = [[0, 0, 7, 6], [8, 0, 7, 4], [0, 7, 4, 8], [5, 5, 5, 5], [11, 5, 4, 6], [5, 11, 6, 4], [11, 12, 4, 3]];
    cells.forEach((c, i) => {
      const shade = (rnd32(i, 0, 22) - 0.5) * 30;
      for (let y = c[1]; y < c[1] + c[3] && y < 16; y++)
        for (let x = c[0]; x < c[0] + c[2] && x < 16; x++) {
          const n = (rnd32(x, y, 23) - 0.5) * 20;
          const v = clamp255(0x86 + shade + n);
          p.px(x, y, v, v, v);
        }
    });
    p.speckle(0x4a4a4a, 40, 24);
  };
  PAINT.dirt = p => { p.noiseFill(0x866043, 18, 31); p.speckle(0x6f4f36, 30, 32, 2); p.speckle(0x9a7150, 20, 33); };
  PAINT.grass_top = p => { p.noiseFill(0x91b23e, 16, 41); p.speckle(0x7fa036, 30, 42, 2); p.speckle(0xa4c44a, 24, 43); };
  PAINT.grass_side = p => {
    PAINT.dirt(p);
    for (let x = 0; x < 16; x++) {
      const h = 3 + ((rnd32(x, 0, 51) * 3) | 0);
      for (let y = 0; y < h; y++) {
        const n = (rnd32(x, y, 52) - 0.5) * 26;
        p.px(x, y, clamp255(0x91 + n), clamp255(0xb2 + n), clamp255(0x3e + n));
      }
    }
  };
  PAINT.grass_snow_side = p => {
    PAINT.dirt(p);
    for (let x = 0; x < 16; x++) {
      const h = 3 + ((rnd32(x, 0, 53) * 3) | 0);
      for (let y = 0; y < h; y++) { const n = (rnd32(x, y, 54) - 0.5) * 16; p.px(x, y, clamp255(238 + n), clamp255(244 + n), clamp255(250 + n)); }
    }
  };
  PAINT.podzol_top = p => { p.noiseFill(0x6b4c2a, 16, 55); p.speckle(0x8a6535, 26, 56, 2); p.speckle(0x51391f, 22, 57); };
  PAINT.snow = p => { p.noiseFill(0xf2f7ff, 8, 61); p.speckle(0xffffff, 24, 62); };
  PAINT.ice = p => { p.noiseFill(0x8fbcf0, 12, 71); p.speckle(0xb6d8ff, 20, 72, 2); p.line(2, 13, 12, 2, 0xd8ecff, 160); p.line(6, 15, 15, 6, 0xd8ecff, 110); };
  PAINT.sand = p => { p.noiseFill(0xdbd0a0, 12, 81); p.speckle(0xcdc08c, 28, 82); p.speckle(0xeae0b8, 18, 83); };
  PAINT.red_sand = p => { p.noiseFill(0xbe6b30, 12, 84); p.speckle(0xa85a26, 26, 85); };
  PAINT.sandstone_top = p => { p.noiseFill(0xdcd2a4, 8, 86); p.speckle(0xc9bd8d, 20, 87); };
  PAINT.sandstone_side = p => {
    p.noiseFill(0xdcd2a4, 6, 88);
    for (let y = 0; y < 16; y++) { if (y % 5 === 0) p.rect(0, y, 16, 1, 0xc1, 0xb4, 0x82, 200); }
    p.speckle(0xcbbf8f, 16, 89);
  };
  PAINT.gravel = p => { p.noiseFill(0x8b8683, 20, 91); p.speckle(0x6c6764, 34, 92, 2); p.speckle(0xa6a19d, 24, 93, 2); };
  PAINT.clay = p => { p.noiseFill(0xa4a8b8, 10, 94); p.speckle(0x9498a8, 22, 95, 2); };
  PAINT.terracotta = p => { p.noiseFill(0x975d43, 12, 96); p.speckle(0x855039, 24, 97, 2); };
  PAINT.bedrock = p => { p.noiseFill(0x565656, 26, 101); p.speckle(0x2a2a2a, 40, 102, 2); p.speckle(0x7a7a7a, 22, 103, 2); };
  PAINT.andesite = p => { p.noiseFill(0x8a8a8a, 12, 104); p.speckle(0x757575, 30, 105, 2); };
  PAINT.granite = p => { p.noiseFill(0x9a6a58, 14, 106); p.speckle(0xb08070, 26, 107, 2); p.speckle(0x845646, 18, 108); };
  PAINT.diorite = p => { p.noiseFill(0xcfcfcf, 14, 109); p.speckle(0xb0b0b0, 28, 110, 2); };
  PAINT.deepslate = p => { p.noiseFill(0x4a4a50, 14, 111); p.speckle(0x3a3a40, 28, 112, 2); p.speckle(0x5c5c64, 18, 113); };
  PAINT.obsidian = p => {
    p.noiseFill(0x1a1024, 10, 121); p.speckle(0x33235a, 22, 122, 2);
    p.speckle(0x0d0714, 26, 123, 2); p.speckle(0x4b3a80, 8, 124);
  };

  // --- minerais ---
  function ore(base, oreHex, seedn, blobs) {
    return p => {
      PAINT[base](p);
      const [r, g, b] = hexToRgb(oreHex);
      const spots = blobs || [[3, 3], [9, 2], [5, 9], [11, 10], [2, 12]];
      spots.forEach((s, i) => {
        const sz = 2 + ((rnd32(i, 0, seedn) * 2) | 0);
        for (let dy = 0; dy < sz; dy++) for (let dx = 0; dx < sz; dx++) {
          if (rnd32(dx + s[0], dy + s[1], seedn) < 0.18) continue;
          const k = (rnd32(dx, dy, seedn + i) - 0.5) * 34;
          p.px(s[0] + dx, s[1] + dy, clamp255(r + k), clamp255(g + k), clamp255(b + k));
        }
      });
    };
  }
  PAINT.coal_ore = ore('stone', 0x232323, 131);
  PAINT.iron_ore = ore('stone', 0xc9a186, 132);
  PAINT.gold_ore = ore('stone', 0xf5d33c, 133);
  PAINT.diamond_ore = ore('stone', 0x4ce6df, 134);
  PAINT.redstone_ore = ore('stone', 0xd42020, 135);
  PAINT.lapis_ore = ore('stone', 0x2653b8, 136);
  PAINT.emerald_ore = ore('stone', 0x18d05a, 137);

  // --- bois ---
  function logSide(hex, dark, seedn) {
    return p => {
      p.noiseFill(hex, 10, seedn);
      for (let x = 0; x < 16; x++) {
        if (rnd32(x, 0, seedn + 1) < 0.30) {
          const [r, g, b] = hexToRgb(dark);
          for (let y = 0; y < 16; y++) {
            const k = (rnd32(x, y, seedn + 2) - 0.5) * 16;
            p.px(x, y, clamp255(r + k), clamp255(g + k), clamp255(b + k));
          }
        }
      }
      p.rect(0, 0, 16, 1, 0, 0, 0, 40);
    };
  }
  function logTop(hex, ring, seedn) {
    return p => {
      p.noiseFill(hex, 8, seedn);
      const [r, g, b] = hexToRgb(ring);
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const dx = x - 7.5, dy = y - 7.5;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (Math.abs((d % 2.6) - 1.3) < 0.55) {
          const k = (rnd32(x, y, seedn + 3) - 0.5) * 16;
          p.px(x, y, clamp255(r + k), clamp255(g + k), clamp255(b + k));
        }
      }
    };
  }
  PAINT.log_oak_side = logSide(0x9a7a4d, 0x6d5636, 141);
  PAINT.log_oak_top = logTop(0xb08d5c, 0x86673f, 142);
  PAINT.log_birch_side = logSide(0xd7cdbf, 0x3b3b38, 143);
  PAINT.log_birch_top = logTop(0xc8b98f, 0xa2916a, 144);
  PAINT.log_spruce_side = logSide(0x60452a, 0x452f1c, 145);
  PAINT.log_spruce_top = logTop(0x7b5c39, 0x5c4227, 146);
  function planks(hex, dark, seedn) {
    return p => {
      p.noiseFill(hex, 10, seedn);
      for (let y = 0; y < 16; y++) if (y % 4 === 3) p.rect(0, y, 16, 1, ...hexToRgb(dark), 220);
      // nœuds et veines
      for (let i = 0; i < 6; i++) {
        const x = (rnd32(i, 0, seedn + 4) * 16) | 0, y = (rnd32(i, 1, seedn + 4) * 16) | 0;
        p.px(x, y, ...hexToRgb(dark), 170);
        p.px(x + 1, y, ...hexToRgb(dark), 120);
      }
      const seam = (rnd32(0, 0, seedn + 9) * 8 + 4) | 0;
      for (let y = 0; y < 16; y++) if (y % 8 < 4) p.px(seam, y, ...hexToRgb(dark), 200);
    };
  }
  PAINT.planks_oak = planks(0xb08a52, 0x86673c, 151);
  PAINT.planks_birch = planks(0xd8cb9a, 0xb0a377, 152);
  PAINT.planks_spruce = planks(0x7a5a36, 0x5b4227, 153);
  PAINT.bookshelf = p => {
    PAINT.planks_oak(p);
    p.rect(0, 1, 16, 6, 0x6a, 0x50, 0x2e, 255);
    p.rect(0, 9, 16, 6, 0x6a, 0x50, 0x2e, 255);
    const cols = [0xa03030, 0x3050a0, 0x30a050, 0xc0a030, 0x8030a0];
    [1, 9].forEach((oy, si) => {
      let x = 0;
      while (x < 16) {
        const w = 1 + ((rnd32(x, si, 161) * 2) | 0);
        const c = hexToRgb(cols[(rnd32(x, si, 162) * cols.length) | 0]);
        const h = 4 + ((rnd32(x, si, 163) * 2) | 0);
        for (let y = oy; y < oy + h && y < 16; y++) for (let dx = 0; dx < w && x + dx < 16; dx++) p.px(x + dx, y, c[0], c[1], c[2]);
        x += w + 1;
      }
    });
  };

  // --- feuillage (cutout) ---
  function leaves(hex, seedn, density) {
    return p => {
      p.clear();
      const [r, g, b] = hexToRgb(hex);
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const n = rnd32(x, y, seedn);
        if (n < (density || 0.20)) continue;   // trous
        const k = (rnd32(x, y, seedn + 1) - 0.5) * 46;
        const dark = rnd32(x >> 1, y >> 1, seedn + 2) < 0.35 ? -22 : 0;
        p.px(x, y, clamp255(r + k + dark), clamp255(g + k + dark), clamp255(b + k + dark), 255);
      }
    };
  }
  PAINT.leaves_oak = leaves(0x4e8f36, 171, 0.22);
  PAINT.leaves_birch = leaves(0x6da042, 172, 0.24);
  PAINT.leaves_spruce = leaves(0x3d6b3a, 173, 0.20);

  // --- liquides ---
  PAINT.water = p => {
    p.noiseFill(0x3b6fd4, 10, 181);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const w = Math.sin((x + y * 0.6) * 0.9) * 8 + Math.sin(x * 0.4 - y) * 5;
      const i = ((p.oy + y) * SIZE + (p.ox + x)) * 4;
      p.d[i] = clamp255(p.d[i] + w * 0.4);
      p.d[i + 1] = clamp255(p.d[i + 1] + w * 0.7);
      p.d[i + 2] = clamp255(p.d[i + 2] + w);
    }
  };
  PAINT.lava = p => {
    p.noiseFill(0xd84a12, 22, 191);
    p.speckle(0xf7c948, 30, 192, 2);
    p.speckle(0x8a1c05, 26, 193, 2);
    p.speckle(0xffe98a, 10, 194);
  };

  // --- fonctionnels ---
  PAINT.glass = p => {
    p.clear();
    p.rect(0, 0, 16, 1, 210, 232, 245, 190); p.rect(0, 15, 16, 1, 210, 232, 245, 190);
    p.rect(0, 0, 1, 16, 210, 232, 245, 190); p.rect(15, 0, 1, 16, 210, 232, 245, 190);
    p.line(2, 11, 10, 3, 0xffffff, 90);
    p.line(4, 13, 12, 5, 0xffffff, 55);
    for (let y = 1; y < 15; y++) for (let x = 1; x < 15; x++) if (rnd32(x, y, 201) > 0.985) p.px(x, y, 255, 255, 255, 70);
  };
  PAINT.glowstone = p => {
    p.noiseFill(0xb98a4b, 12, 211);
    for (let i = 0; i < 20; i++) {
      const x = (rnd32(i, 0, 212) * 14) | 0, y = (rnd32(i, 1, 212) * 14) | 0;
      p.rect(x, y, 2, 2, 0xff, 0xe8, 0x9a, 255);
      p.px(x, y, 255, 255, 220);
    }
  };
  PAINT.torch = p => {
    p.clear();
    p.rect(7, 6, 2, 10, 0x8a, 0x6a, 0x3c, 255);
    p.px(7, 15, 0x6a, 0x50, 0x2c); p.px(8, 15, 0x6a, 0x50, 0x2c);
    p.rect(7, 3, 2, 3, 0xff, 0xc8, 0x4a, 255);
    p.rect(6, 4, 1, 2, 0xff, 0x9a, 0x30, 210);
    p.rect(9, 4, 1, 2, 0xff, 0x9a, 0x30, 210);
    p.rect(7, 2, 2, 1, 0xff, 0xf0, 0xb0, 255);
  };
  PAINT.crafting_top = p => {
    PAINT.planks_oak(p);
    p.rect(0, 0, 16, 16, 0x9a, 0x74, 0x42, 90);
    for (let i = 0; i <= 3; i++) { p.rect(i * 5, 0, 1, 16, 0x5c, 0x42, 0x24, 220); p.rect(0, i * 5, 16, 1, 0x5c, 0x42, 0x24, 220); }
  };
  PAINT.crafting_side = p => { PAINT.planks_oak(p); p.rect(0, 0, 16, 4, 0x6d, 0x50, 0x2c, 200); p.rect(2, 6, 5, 3, 0x86, 0x67, 0x3c, 180); p.rect(9, 9, 5, 3, 0x86, 0x67, 0x3c, 180); };
  PAINT.crafting_front = p => { PAINT.crafting_side(p); };
  PAINT.furnace_side = p => { PAINT.stone(p); p.bevel(30, 60); };
  PAINT.furnace_top = p => { PAINT.stone(p); p.rect(3, 3, 10, 10, 0x5a, 0x5a, 0x5a, 130); };
  PAINT.furnace_front = p => {
    PAINT.stone(p);
    p.rect(3, 6, 10, 7, 0x3a, 0x3a, 0x3a, 255);
    p.rect(4, 7, 8, 5, 0x1e, 0x1e, 0x1e, 255);
    p.rect(3, 4, 10, 2, 0x6a, 0x6a, 0x6a, 200);
    p.bevel(24, 50);
  };
  PAINT.furnace_front_on = p => {
    PAINT.furnace_front(p);
    p.rect(4, 9, 8, 3, 0xff, 0x8a, 0x20, 255);
    p.rect(5, 8, 6, 1, 0xff, 0xc0, 0x40, 235);
    p.rect(6, 7, 4, 1, 0xff, 0xe8, 0x90, 200);
  };
  PAINT.chest_side = p => { PAINT.planks_oak(p); p.rect(0, 0, 16, 1, 0x5c, 0x42, 0x24, 220); p.rect(0, 4, 16, 1, 0x5c, 0x42, 0x24, 200); };
  PAINT.chest_top = p => { PAINT.planks_oak(p); p.rect(0, 0, 16, 16, 0x8a, 0x66, 0x38, 60); p.bevel(24, 48); };
  PAINT.chest_front = p => {
    PAINT.chest_side(p);
    p.rect(6, 5, 4, 5, 0x3a, 0x3a, 0x3a, 255);
    p.rect(7, 6, 2, 3, 0xd8, 0xb0, 0x40, 255);
    p.px(7, 7, 0x2a, 0x2a, 0x2a);
  };
  PAINT.brick = p => {
    p.noiseFill(0x9a4a3a, 8, 221);
    for (let y = 0; y < 16; y++) { if (y % 4 === 3) p.rect(0, y, 16, 1, 0xc8, 0xc0, 0xb8, 235); }
    for (let row = 0; row < 4; row++) {
      const off = (row % 2) * 4;
      for (let x = off; x < 16; x += 8) p.rect(x, row * 4, 1, 3, 0xc8, 0xc0, 0xb8, 235);
    }
  };
  PAINT.stone_bricks = p => {
    p.noiseFill(0x7a7a7a, 10, 231);
    p.rect(0, 7, 16, 1, 0x54, 0x54, 0x54, 235);
    p.rect(0, 15, 16, 1, 0x54, 0x54, 0x54, 235);
    p.rect(7, 0, 1, 8, 0x54, 0x54, 0x54, 235);
    p.rect(3, 8, 1, 8, 0x54, 0x54, 0x54, 235);
    p.rect(11, 8, 1, 8, 0x54, 0x54, 0x54, 235);
    p.speckle(0x646464, 18, 232);
  };
  PAINT.wool_white = p => { p.noiseFill(0xeeeeee, 8, 241); p.speckle(0xdcdcdc, 40, 242, 2); };
  PAINT.iron_block = p => { p.noiseFill(0xd8d8d8, 8, 251); p.bevel(70, 60); p.rect(3, 3, 10, 10, 0xe8, 0xe8, 0xe8, 70); };
  PAINT.gold_block = p => { p.noiseFill(0xf2cf3c, 8, 252); p.bevel(80, 60); p.rect(3, 3, 10, 10, 0xff, 0xe0, 0x60, 80); };
  PAINT.diamond_block = p => { p.noiseFill(0x4fe3dd, 8, 253); p.bevel(80, 60); p.speckle(0x9ff5f0, 16, 254); };
  PAINT.emerald_block = p => { p.noiseFill(0x2fd66a, 8, 255); p.bevel(80, 60); p.speckle(0x86f0ab, 16, 256); };
  PAINT.cactus_side = p => {
    p.noiseFill(0x2f6d2a, 10, 261);
    p.rect(0, 0, 1, 16, 0x24, 0x54, 0x20, 255); p.rect(15, 0, 1, 16, 0x24, 0x54, 0x20, 255);
    for (let i = 0; i < 5; i++) { const y = 2 + i * 3; p.px(4, y, 220, 220, 190); p.px(11, y + 1, 220, 220, 190); }
  };
  PAINT.cactus_top = p => { p.noiseFill(0x3d7f34, 10, 262); p.rect(3, 3, 10, 10, 0x2f, 0x6d, 0x2a, 200); };
  PAINT.pumpkin_side = p => {
    p.noiseFill(0xdc7d19, 10, 271);
    for (let x = 2; x < 16; x += 4) p.rect(x, 0, 1, 16, 0xb4, 0x62, 0x10, 220);
  };
  PAINT.pumpkin_top = p => { p.noiseFill(0xc9761b, 10, 272); p.rect(6, 6, 4, 4, 0x6d, 0x8a, 0x30, 255); };
  PAINT.tnt_side = p => { p.rect(0, 0, 16, 16, 0xc0, 0x30, 0x28, 255); p.rect(0, 5, 16, 6, 0xf0, 0xf0, 0xf0, 255); p.rect(2, 6, 3, 4, 0x30, 0x30, 0x30, 255); p.rect(6, 6, 3, 4, 0x30, 0x30, 0x30, 255); p.rect(10, 6, 4, 4, 0x30, 0x30, 0x30, 255); };
  PAINT.tnt_top = p => { p.rect(0, 0, 16, 16, 0xc0, 0x30, 0x28, 255); p.rect(4, 4, 8, 8, 0x9a, 0x24, 0x1c, 255); p.rect(6, 6, 4, 4, 0xe0, 0xe0, 0xe0, 255); };
  PAINT.tnt_bottom = p => { p.rect(0, 0, 16, 16, 0x8a, 0x22, 0x1a, 255); p.speckle(0x70, 20, 273); };

  // --- plantes (cutout) ---
  PAINT.tallgrass = p => {
    p.clear();
    for (let i = 0; i < 22; i++) {
      const x = 1 + ((rnd32(i, 0, 281) * 14) | 0);
      const h = 5 + ((rnd32(i, 1, 281) * 9) | 0);
      const g = 0x55 + ((rnd32(i, 2, 281) * 50) | 0);
      for (let y = 15; y > 15 - h; y--) {
        const bend = ((15 - y) * 0.18 * (rnd32(i, 3, 281) - 0.5)) | 0;
        p.px(x + bend, y, 0x4a, g + 0x40, 0x28, 255);
      }
    }
  };
  PAINT.flower_red = p => {
    p.clear();
    for (let y = 8; y < 16; y++) p.px(7, y, 0x3f, 0x7a, 0x2f, 255);
    p.px(5, 11, 0x3f, 0x7a, 0x2f); p.px(9, 12, 0x3f, 0x7a, 0x2f);
    p.rect(5, 4, 5, 4, 0xd8, 0x2a, 0x2a, 255);
    p.px(7, 5, 0x2a, 0x2a, 0x2a); p.px(7, 6, 0x2a, 0x2a, 0x2a);
    p.px(4, 5, 0xd8, 0x2a, 0x2a); p.px(10, 6, 0xd8, 0x2a, 0x2a);
  };
  PAINT.flower_yellow = p => {
    p.clear();
    for (let y = 8; y < 16; y++) p.px(7, y, 0x3f, 0x7a, 0x2f, 255);
    p.px(5, 11, 0x3f, 0x7a, 0x2f); p.px(10, 12, 0x3f, 0x7a, 0x2f);
    p.rect(5, 4, 5, 4, 0xf2, 0xd8, 0x2a, 255);
    p.px(7, 5, 0xc8, 0x9a, 0x10); p.px(8, 6, 0xc8, 0x9a, 0x10);
  };
  PAINT.sapling = p => {
    p.clear();
    for (let y = 10; y < 16; y++) p.px(7, y, 0x6a, 0x4a, 0x28, 255);
    for (let i = 0; i < 16; i++) {
      const x = 3 + ((rnd32(i, 0, 291) * 10) | 0), y = 3 + ((rnd32(i, 1, 291) * 8) | 0);
      p.px(x, y, 0x3f, 0x7a + ((rnd32(i, 2, 291) * 40) | 0), 0x2a, 255);
    }
  };
  PAINT.dead_bush = p => {
    p.clear();
    for (let y = 6; y < 16; y++) p.px(7, y, 0x7a, 0x5a, 0x28, 255);
    p.line(7, 10, 3, 6, 0x8a6a30, 255); p.line(7, 12, 12, 8, 0x8a6a30, 255);
    p.line(7, 8, 11, 4, 0x7a5a28, 255);
  };
  PAINT.sugarcane = p => {
    p.clear();
    p.rect(6, 0, 4, 16, 0x8a, 0xc0, 0x6a, 255);
    p.rect(6, 0, 1, 16, 0x6f, 0xa0, 0x52, 255);
    for (let y = 3; y < 16; y += 5) p.rect(6, y, 4, 1, 0x64, 0x94, 0x48, 255);
  };
  PAINT.mushroom_red = p => {
    p.clear();
    p.rect(7, 9, 2, 6, 0xe0, 0xd8, 0xc8, 255);
    p.rect(4, 5, 8, 4, 0xc8, 0x2a, 0x2a, 255);
    p.px(5, 6, 0xf0, 0xf0, 0xf0); p.px(9, 7, 0xf0, 0xf0, 0xf0); p.px(7, 5, 0xf0, 0xf0, 0xf0);
  };
  PAINT.mushroom_brown = p => {
    p.clear();
    p.rect(7, 9, 2, 6, 0xd8, 0xd0, 0xc0, 255);
    p.rect(4, 6, 8, 3, 0x9a, 0x6a, 0x48, 255);
  };

  /* ------------------------------------------------------- Icônes items */
  function toolIcon(headHex, handleHex, kind) {
    return p => {
      p.clear();
      const hh = hexToRgb(handleHex), hd = hexToRgb(headHex);
      // manche diagonal
      for (let i = 0; i < 9; i++) p.px(5 + ((i * 0.55) | 0), 14 - i, hh[0], hh[1], hh[2], 255);
      for (let i = 0; i < 9; i++) p.px(6 + ((i * 0.55) | 0), 14 - i, clamp255(hh[0] * 0.8), clamp255(hh[1] * 0.8), clamp255(hh[2] * 0.8), 255);
      if (kind === 'pick') {
        p.rect(6, 3, 7, 2, hd[0], hd[1], hd[2], 255);
        p.px(5, 4, hd[0], hd[1], hd[2]); p.px(13, 4, hd[0], hd[1], hd[2]);
        p.px(4, 5, hd[0], hd[1], hd[2]); p.px(14, 5, hd[0], hd[1], hd[2]);
        p.rect(8, 5, 3, 1, hd[0], hd[1], hd[2], 255);
      } else if (kind === 'axe') {
        p.rect(8, 2, 5, 5, hd[0], hd[1], hd[2], 255);
        p.rect(7, 3, 1, 4, hd[0], hd[1], hd[2], 255);
        p.px(13, 3, hd[0], hd[1], hd[2]); p.px(13, 5, hd[0], hd[1], hd[2]);
      } else if (kind === 'shovel') {
        p.rect(9, 2, 4, 5, hd[0], hd[1], hd[2], 255);
        p.px(9, 7, hd[0], hd[1], hd[2]); p.px(12, 7, hd[0], hd[1], hd[2]);
      } else { // sword
        p.clear();
        for (let i = 0; i < 5; i++) p.px(5 + i, 14 - i, hh[0], hh[1], hh[2], 255);
        p.px(4, 12, hh[0], hh[1], hh[2]); p.px(3, 13, hh[0], hh[1], hh[2]);
        p.px(7, 12, hh[0], hh[1], hh[2]); p.px(8, 11, hh[0], hh[1], hh[2]);
        for (let i = 0; i < 9; i++) { p.px(7 + i, 8 - i, hd[0], hd[1], hd[2], 255); p.px(8 + i, 8 - i, clamp255(hd[0] * 1.15), clamp255(hd[1] * 1.15), clamp255(hd[2] * 1.15), 255); }
      }
    };
  }
  const MATC = { wood: [0xa07a48, 0x8a6a3c], stone: [0x8a8a8a, 0x8a6a3c], iron: [0xd8d8d8, 0x8a6a3c], diamond: [0x4fe3dd, 0x8a6a3c] };
  ['wood', 'stone', 'iron', 'diamond'].forEach(m => {
    PAINT['i_pick_' + m] = toolIcon(MATC[m][0], MATC[m][1], 'pick');
    PAINT['i_axe_' + m] = toolIcon(MATC[m][0], MATC[m][1], 'axe');
    PAINT['i_shovel_' + m] = toolIcon(MATC[m][0], MATC[m][1], 'shovel');
    PAINT['i_sword_' + m] = toolIcon(MATC[m][0], MATC[m][1], 'sword');
  });

  function blob(hex, shape) {
    return p => {
      p.clear();
      const c = hexToRgb(hex);
      shape.forEach(s => p.rect(s[0], s[1], s[2], s[3], c[0], c[1], c[2], 255));
    };
  }
  PAINT.i_stick = p => { p.clear(); for (let i = 0; i < 10; i++) { p.px(5 + ((i * 0.5) | 0), 13 - i, 0x8a, 0x6a, 0x3c, 255); p.px(6 + ((i * 0.5) | 0), 13 - i, 0x6d, 0x52, 0x2c, 255); } };
  PAINT.i_coal = blob(0x232323, [[5, 5, 6, 6], [4, 6, 8, 4], [6, 4, 4, 8]]);
  PAINT.i_charcoal = blob(0x2f2b28, [[5, 5, 6, 6], [4, 6, 8, 4]]);
  function ingot(hex) {
    return p => {
      p.clear(); const c = hexToRgb(hex);
      p.rect(4, 6, 8, 5, c[0], c[1], c[2], 255);
      p.rect(5, 5, 6, 1, clamp255(c[0] * 1.2), clamp255(c[1] * 1.2), clamp255(c[2] * 1.2), 255);
      p.rect(4, 11, 8, 1, clamp255(c[0] * 0.7), clamp255(c[1] * 0.7), clamp255(c[2] * 0.7), 255);
    };
  }
  PAINT.i_iron_ingot = ingot(0xd8d8d8);
  PAINT.i_gold_ingot = ingot(0xf2cf3c);
  PAINT.i_brick_item = ingot(0x9a4a3a);
  function gem(hex) {
    return p => {
      p.clear(); const c = hexToRgb(hex);
      p.rect(6, 4, 4, 1, c[0], c[1], c[2], 255);
      p.rect(5, 5, 6, 2, c[0], c[1], c[2], 255);
      p.rect(4, 7, 8, 3, c[0], c[1], c[2], 255);
      p.rect(5, 10, 6, 1, c[0], c[1], c[2], 255);
      p.rect(6, 11, 4, 1, c[0], c[1], c[2], 255);
      p.rect(6, 5, 2, 2, 255, 255, 255, 120);
    };
  }
  PAINT.i_diamond = gem(0x4fe3dd);
  PAINT.i_emerald = gem(0x2fd66a);
  PAINT.i_lapis = p => { p.clear(); for (let i = 0; i < 7; i++) { const x = 3 + ((rnd32(i, 0, 301) * 9) | 0), y = 4 + ((rnd32(i, 1, 301) * 8) | 0); p.rect(x, y, 2, 2, 0x26, 0x53, 0xb8, 255); } };
  PAINT.i_redstone = p => { p.clear(); for (let i = 0; i < 8; i++) { const x = 3 + ((rnd32(i, 0, 302) * 9) | 0), y = 4 + ((rnd32(i, 1, 302) * 8) | 0); p.rect(x, y, 2, 2, 0xd4, 0x20, 0x20, 255); } };
  PAINT.i_apple = p => { p.clear(); p.rect(4, 5, 8, 8, 0xd0, 0x28, 0x28, 255); p.rect(5, 4, 6, 1, 0xd0, 0x28, 0x28, 255); p.rect(5, 13, 6, 1, 0xa8, 0x1e, 0x1e, 255); p.px(7, 3, 0x5a, 0x3c, 0x1e); p.px(8, 2, 0x3f, 0x7a, 0x2f); p.rect(5, 6, 2, 2, 255, 160, 160, 150); };
  PAINT.i_bread = p => { p.clear(); p.rect(3, 6, 10, 6, 0xc8, 0x92, 0x4a, 255); p.rect(4, 5, 8, 1, 0xd8, 0xa8, 0x60, 255); p.rect(4, 12, 8, 1, 0xa0, 0x70, 0x36, 255); p.px(6, 7, 0xe8, 0xc0, 0x80); p.px(9, 8, 0xe8, 0xc0, 0x80); };
  PAINT.i_wheat = p => { p.clear(); for (let y = 4; y < 15; y++) p.px(8, y, 0x6a, 0x8a, 0x30, 255); for (let i = 0; i < 5; i++) { const y = 4 + i * 2; p.px(6, y, 0xd8, 0xc0, 0x48); p.px(10, y, 0xd8, 0xc0, 0x48); p.px(7, y + 1, 0xc0, 0xa8, 0x38); p.px(9, y + 1, 0xc0, 0xa8, 0x38); } };
  PAINT.i_seeds = p => { p.clear(); for (let i = 0; i < 9; i++) { const x = 3 + ((rnd32(i, 0, 303) * 10) | 0), y = 5 + ((rnd32(i, 1, 303) * 7) | 0); p.px(x, y, 0x8a, 0x9a, 0x3c); p.px(x, y + 1, 0x6a, 0x7a, 0x2c); } };
  function meat(hex, cooked) {
    return p => {
      p.clear(); const c = hexToRgb(hex);
      p.rect(4, 5, 8, 7, c[0], c[1], c[2], 255);
      p.rect(3, 7, 1, 3, c[0], c[1], c[2], 255);
      p.rect(12, 6, 1, 4, c[0], c[1], c[2], 255);
      const f = cooked ? [0x8a, 0x5a, 0x30] : [0xf0, 0xa8, 0xa8];
      p.px(6, 7, f[0], f[1], f[2]); p.px(9, 9, f[0], f[1], f[2]); p.px(7, 10, f[0], f[1], f[2]);
    };
  }
  PAINT.i_porkchop = meat(0xf09a9a, false);
  PAINT.i_porkchop_cooked = meat(0xc07a3c, true);
  PAINT.i_beef = meat(0xd05050, false);
  PAINT.i_steak = meat(0xa05a2c, true);
  PAINT.i_chicken = meat(0xf0c0a0, false);
  PAINT.i_chicken_cooked = meat(0xc89050, true);
  PAINT.i_leather = blob(0xa07040, [[3, 4, 10, 8], [4, 3, 8, 1], [4, 12, 8, 1]]);
  PAINT.i_feather = p => { p.clear(); for (let i = 0; i < 10; i++) p.px(5 + ((i * 0.4) | 0), 13 - i, 0xd8, 0xd8, 0xd8, 255); for (let i = 0; i < 6; i++) { p.px(4 + ((i * 0.4) | 0), 10 - i, 0xf0, 0xf0, 0xf0, 255); p.px(7 + ((i * 0.4) | 0), 10 - i, 0xf0, 0xf0, 0xf0, 255); } };
  PAINT.i_string = p => { p.clear(); p.line(3, 3, 12, 6, 0xe8e8e8, 255); p.line(12, 6, 4, 10, 0xe8e8e8, 255); p.line(4, 10, 11, 13, 0xe8e8e8, 255); };
  PAINT.i_gunpowder = p => { p.clear(); for (let i = 0; i < 10; i++) { const x = 3 + ((rnd32(i, 0, 311) * 10) | 0), y = 4 + ((rnd32(i, 1, 311) * 8) | 0); p.rect(x, y, 2, 2, 0x5a, 0x5a, 0x5a, 255); } };
  PAINT.i_bone = p => { p.clear(); p.rect(6, 4, 4, 8, 0xe8, 0xe8, 0xd8, 255); p.rect(4, 3, 3, 3, 0xf0, 0xf0, 0xe0, 255); p.rect(9, 3, 3, 3, 0xf0, 0xf0, 0xe0, 255); p.rect(4, 10, 3, 3, 0xf0, 0xf0, 0xe0, 255); p.rect(9, 10, 3, 3, 0xf0, 0xf0, 0xe0, 255); };
  PAINT.i_flesh = blob(0x8a4a4a, [[4, 5, 8, 7], [3, 7, 1, 3]]);
  PAINT.i_arrow = p => { p.clear(); for (let i = 0; i < 11; i++) p.px(4 + i, 12 - i, 0x8a, 0x6a, 0x3c, 255); p.rect(2, 11, 3, 3, 0xe0, 0xe0, 0xe0, 255); p.px(13, 2, 0xd0, 0xd0, 0xd0); p.px(12, 2, 0xd0, 0xd0, 0xd0); p.px(13, 3, 0xd0, 0xd0, 0xd0); };
  PAINT.i_bow = p => { p.clear(); p.line(4, 2, 11, 8, 0x8a6a3c, 255); p.line(11, 8, 4, 14, 0x8a6a3c, 255); p.line(4, 2, 4, 14, 0xe8e8e8, 200); };
  PAINT.i_bucket = p => { p.clear(); p.rect(4, 6, 8, 8, 0xc0, 0xc0, 0xc0, 255); p.rect(3, 5, 10, 1, 0xd8, 0xd8, 0xd8, 255); p.rect(5, 13, 6, 1, 0x9a, 0x9a, 0x9a, 255); };
  PAINT.i_bucket_water = p => { PAINT.i_bucket(p); p.rect(5, 7, 6, 4, 0x3b, 0x6f, 0xd4, 255); };
  PAINT.i_flint = blob(0x3a3a3a, [[4, 6, 8, 5], [5, 5, 5, 1], [6, 11, 4, 1]]);
  PAINT.i_clay_ball = blob(0xa4a8b8, [[5, 5, 6, 6], [4, 6, 8, 4]]);
  PAINT.i_paper = p => { p.clear(); p.rect(3, 3, 10, 10, 0xf0, 0xf0, 0xe8, 255); p.rect(5, 6, 6, 1, 0xc0, 0xc0, 0xb8, 255); p.rect(5, 9, 6, 1, 0xc0, 0xc0, 0xb8, 255); };
  PAINT.i_book = p => { p.clear(); p.rect(3, 3, 10, 11, 0x8a, 0x3a, 0x2a, 255); p.rect(4, 4, 8, 9, 0xf0, 0xf0, 0xe0, 255); p.rect(3, 3, 2, 11, 0x6a, 0x2a, 0x1a, 255); };

  /* ------------------------------------------------------------ Build -- */
  function buildAtlas() {
    const cv = document.createElement('canvas');
    cv.width = SIZE; cv.height = SIZE;
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(SIZE, SIZE);
    const data = img.data;
    // fond magenta transparent pour repérer les tuiles manquantes
    for (let i = 0; i < data.length; i += 4) { data[i] = 255; data[i + 1] = 0; data[i + 2] = 255; data[i + 3] = 0; }

    V.TILES.forEach((name, i) => {
      const p = new Painter(data, i);
      const fn = PAINT[name];
      if (fn) fn(p);
      else { p.noiseFill(0x808080, 20, i * 13 + 7); }   // fallback gris
    });
    ctx.putImageData(img, 0, 0);
    return cv;
  }

  root.VCAtlas = { buildAtlas, TS, SIZE, COLS };
})(typeof self !== 'undefined' ? self : this);
