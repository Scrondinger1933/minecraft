/* =========================================================================
 *  VOXELCRAFT — Artisanat & fusion
 *  Recettes structurées (shaped) avec normalisation/rognage de la grille,
 *  recettes informes (shapeless) et table de cuisson.
 * ========================================================================= */
(function (root) {
  'use strict';
  const V = root.VC;
  const B = V.B, I = V.I;

  const shaped = [];     // {rows:[["A","B"],...], keys:{A:id}, out:{id,n}, mirror}
  const shapeless = [];  // {ing:[ids], out:{id,n}}
  const smelting = {};   // inputId -> {id, n}

  function S(rows, keys, outId, n) {
    shaped.push({ rows, keys, out: { id: outId, n: n || 1 } });
  }
  function SL(ing, outId, n) {
    shapeless.push({ ing: ing.slice().sort((a, b) => a - b), out: { id: outId, n: n || 1 } });
  }
  function SM(inId, outId, n) { smelting[inId] = { id: outId, n: n || 1 }; }

  const WOODS = [
    { log: B.LOG, planks: B.PLANKS },
    { log: B.LOG_BIRCH, planks: B.PLANKS_BIRCH },
    { log: B.LOG_SPRUCE, planks: B.PLANKS_SPRUCE }
  ];

  /* ------------------------------------------------------- Recettes ---- */
  WOODS.forEach(w => SL([w.log], w.planks, 4));
  WOODS.forEach(w => S([['P'], ['P']], { P: w.planks }, I.STICK, 4));

  S([['P', 'P'], ['P', 'P']], { P: B.PLANKS }, B.CRAFTING, 1);
  S([['P', 'P'], ['P', 'P']], { P: B.PLANKS_BIRCH }, B.CRAFTING, 1);
  S([['P', 'P'], ['P', 'P']], { P: B.PLANKS_SPRUCE }, B.CRAFTING, 1);

  S([['C', 'C', 'C'], ['C', '.', 'C'], ['C', 'C', 'C']], { C: B.COBBLE }, B.FURNACE, 1);
  S([['P', 'P', 'P'], ['P', '.', 'P'], ['P', 'P', 'P']], { P: B.PLANKS }, B.CHEST, 1);

  // torches
  S([['C'], ['S']], { C: I.COAL, S: I.STICK }, B.TORCH, 4);
  S([['C'], ['S']], { C: I.CHARCOAL, S: I.STICK }, B.TORCH, 4);

  // outils : matériau × type
  const TOOLMATS = [
    { m: B.PLANKS, pick: I.PICK_WOOD, axe: I.AXE_WOOD, sh: I.SHOVEL_WOOD, sw: I.SWORD_WOOD },
    { m: B.COBBLE, pick: I.PICK_STONE, axe: I.AXE_STONE, sh: I.SHOVEL_STONE, sw: I.SWORD_STONE },
    { m: I.IRON_INGOT, pick: I.PICK_IRON, axe: I.AXE_IRON, sh: I.SHOVEL_IRON, sw: I.SWORD_IRON },
    { m: I.DIAMOND, pick: I.PICK_DIAMOND, axe: I.AXE_DIAMOND, sh: I.SHOVEL_DIAMOND, sw: I.SWORD_DIAMOND }
  ];
  TOOLMATS.forEach(t => {
    S([['M', 'M', 'M'], ['.', 'S', '.'], ['.', 'S', '.']], { M: t.m, S: I.STICK }, t.pick, 1);
    S([['M', 'M'], ['M', 'S'], ['.', 'S']], { M: t.m, S: I.STICK }, t.axe, 1);
    S([['M', 'M'], ['S', 'M'], ['S', '.']], { M: t.m, S: I.STICK }, t.axe, 1);  // miroir
    S([['M'], ['S'], ['S']], { M: t.m, S: I.STICK }, t.sh, 1);
    S([['M'], ['M'], ['S']], { M: t.m, S: I.STICK }, t.sw, 1);
  });

  // blocs de compression
  S([['X', 'X', 'X'], ['X', 'X', 'X'], ['X', 'X', 'X']], { X: I.IRON_INGOT }, B.IRON_BLOCK, 1);
  S([['X', 'X', 'X'], ['X', 'X', 'X'], ['X', 'X', 'X']], { X: I.GOLD_INGOT }, B.GOLD_BLOCK, 1);
  S([['X', 'X', 'X'], ['X', 'X', 'X'], ['X', 'X', 'X']], { X: I.DIAMOND }, B.DIAMOND_BLOCK, 1);
  S([['X', 'X', 'X'], ['X', 'X', 'X'], ['X', 'X', 'X']], { X: I.EMERALD }, B.EMERALD_BLOCK, 1);
  SL([B.IRON_BLOCK], I.IRON_INGOT, 9);
  SL([B.GOLD_BLOCK], I.GOLD_INGOT, 9);
  SL([B.DIAMOND_BLOCK], I.DIAMOND, 9);
  SL([B.EMERALD_BLOCK], I.EMERALD, 9);

  // matériaux de construction
  S([['S', 'S'], ['S', 'S']], { S: B.STONE }, B.STONE_BRICKS, 4);
  S([['B', 'B'], ['B', 'B']], { B: I.BRICK_ITEM }, B.BRICKS, 1);
  S([['S', 'S'], ['S', 'S']], { S: B.SAND }, B.SANDSTONE, 1);
  S([['P', 'P', 'P'], ['B', 'B', 'B'], ['P', 'P', 'P']], { P: B.PLANKS, B: I.BOOK }, B.BOOKSHELF, 1);
  S([['G', 'G', 'G'], ['G', 'G', 'G'], ['G', 'G', 'G']], { G: I.GUNPOWDER }, B.TNT, 1);
  S([['S', 'S', 'S'], ['S', 'S', 'S'], ['S', 'S', 'S']], { S: I.STRING }, B.WOOL, 1);

  // divers
  S([['.', 'I', '.'], ['I', '.', 'I'], ['.', '.', '.']], { I: I.IRON_INGOT }, I.BUCKET, 1);
  S([['W', 'W', 'W']], { W: I.WHEAT }, I.BREAD, 1);
  S([['P', 'P', 'P']], { P: B.SUGARCANE }, I.PAPER, 3);
  S([['P'], ['P'], ['L']], { P: I.PAPER, L: I.LEATHER }, I.BOOK, 1);
  S([['.', 'S', 'T'], ['S', '.', 'T'], ['.', 'S', 'T']], { S: I.STICK, T: I.STRING }, I.BOW, 1);
  S([['F'], ['S'], ['E']], { F: I.FLINT, S: I.STICK, E: I.FEATHER }, I.ARROW, 4);
  SL([B.TALLGRASS], I.SEEDS, 1);
  SL([B.GRAVEL], I.FLINT, 1);

  /* ------------------------------------------------------- Fusion ------ */
  SM(B.IRON_ORE, I.IRON_INGOT);
  SM(B.GOLD_ORE, I.GOLD_INGOT);
  SM(B.SAND, B.GLASS);
  SM(B.RED_SAND, B.GLASS);
  SM(B.COBBLE, B.STONE);
  SM(B.STONE, B.SMOOTH_STONE || B.STONE_BRICKS);
  SM(I.CLAY_BALL, I.BRICK_ITEM);
  SM(B.CLAY, B.TERRACOTTA);
  SM(I.PORKCHOP, I.PORKCHOP_COOKED);
  SM(I.BEEF, I.STEAK);
  SM(I.CHICKEN, I.CHICKEN_COOKED);
  SM(B.LOG, I.CHARCOAL);
  SM(B.LOG_BIRCH, I.CHARCOAL);
  SM(B.LOG_SPRUCE, I.CHARCOAL);

  /* ================================================== Résolution ======== */
  /**
   * Réduit une grille N×N (tableau plat d'ids ou 0) à sa boîte englobante.
   * @returns {rows:[[id]], w, h} ou null si vide
   */
  function trim(grid, size) {
    let minX = size, maxX = -1, minY = size, maxY = -1;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (grid[y * size + x]) {
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return null;
    const rows = [];
    for (let y = minY; y <= maxY; y++) {
      const r = [];
      for (let x = minX; x <= maxX; x++) r.push(grid[y * size + x] || 0);
      rows.push(r);
    }
    return { rows, w: maxX - minX + 1, h: maxY - minY + 1 };
  }

  function matchShaped(rec, tr) {
    const rr = rec.rows;
    if (rr.length !== tr.h) return false;
    if (rr[0].length !== tr.w) return false;
    for (let y = 0; y < tr.h; y++) {
      for (let x = 0; x < tr.w; x++) {
        const sym = rr[y][x];
        const want = (sym === '.' || sym === ' ') ? 0 : rec.keys[sym];
        if ((tr.rows[y][x] || 0) !== (want || 0)) return false;
      }
    }
    return true;
  }

  /**
   * @param grid tableau plat de {id,n} ou null, taille size²
   * @returns {id,n} | null
   */
  function findRecipe(grid, size) {
    const ids = new Array(size * size);
    let count = 0;
    for (let i = 0; i < size * size; i++) {
      ids[i] = grid[i] ? grid[i].id : 0;
      if (ids[i]) count++;
    }
    if (!count) return null;

    const tr = trim(ids, size);
    if (!tr) return null;

    for (let i = 0; i < shaped.length; i++) {
      if (matchShaped(shaped[i], tr)) return shaped[i].out;
    }
    // informes
    const flat = ids.filter(x => x).sort((a, b) => a - b);
    for (let i = 0; i < shapeless.length; i++) {
      const r = shapeless[i];
      if (r.ing.length !== flat.length) continue;
      let ok = true;
      for (let k = 0; k < flat.length; k++) if (r.ing[k] !== flat[k]) { ok = false; break; }
      if (ok) return r.out;
    }
    return null;
  }

  function smeltResult(id) { return smelting[id] || null; }

  /** Liste des recettes réalisables — pour le livre de recettes de l'UI. */
  function allRecipes() {
    const out = [];
    shaped.forEach(r => {
      const grid = [];
      for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) grid.push(0);
      const oh = r.rows.length, ow = r.rows[0].length;
      for (let y = 0; y < oh; y++) for (let x = 0; x < ow; x++) {
        const s = r.rows[y][x];
        grid[y * 3 + x] = (s === '.' || s === ' ') ? 0 : r.keys[s];
      }
      out.push({ type: 'shaped', grid, size: 3, out: r.out });
    });
    shapeless.forEach(r => {
      const grid = new Array(9).fill(0);
      r.ing.forEach((id, i) => { grid[i] = id; });
      out.push({ type: 'shapeless', grid, size: 3, out: r.out });
    });
    return out;
  }

  root.VCCraft = { findRecipe, smeltResult, allRecipes, shaped, shapeless, smelting };
})(typeof self !== 'undefined' ? self : this);
