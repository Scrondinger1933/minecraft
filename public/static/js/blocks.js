/* =========================================================================
 *  VOXELCRAFT — Registre des matériaux (partagé main-thread / worker)
 *  Aucune dépendance DOM : chargeable via <script> ou importScripts().
 * ========================================================================= */
(function (root) {
  'use strict';

  /* ---------------------------------------------------------------- Monde */
  const CH_X = 16, CH_Y = 128, CH_Z = 16;
  const CH_AREA = CH_X * CH_Z;
  const CH_VOL = CH_X * CH_Y * CH_Z;
  const SEA_LEVEL = 62;

  // index linéaire : y-major (colonnes contiguës en x)
  function idx(x, y, z) { return (y * CH_Z + z) * CH_X + x; }

  /* --------------------------------------------------------------- Tuiles */
  // L'ordre définit l'index dans l'atlas 16×16 (256 tuiles de 16 px).
  const TILES = [
    'grass_top', 'grass_side', 'dirt', 'stone', 'cobblestone', 'bedrock',
    'sand', 'sandstone_top', 'sandstone_side', 'gravel',
    'log_oak_side', 'log_oak_top', 'leaves_oak', 'planks_oak',
    'log_birch_side', 'log_birch_top', 'leaves_birch', 'planks_birch',
    'log_spruce_side', 'log_spruce_top', 'leaves_spruce', 'planks_spruce',
    'water', 'lava',
    'coal_ore', 'iron_ore', 'gold_ore', 'diamond_ore', 'redstone_ore',
    'emerald_ore', 'lapis_ore',
    'snow', 'grass_snow_side', 'ice', 'clay', 'glass',
    'crafting_top', 'crafting_side', 'crafting_front',
    'furnace_front', 'furnace_front_on', 'furnace_side', 'furnace_top',
    'chest_front', 'chest_side', 'chest_top',
    'bookshelf', 'obsidian', 'cactus_side', 'cactus_top',
    'tallgrass', 'flower_red', 'flower_yellow', 'sapling', 'sugarcane',
    'mushroom_red', 'mushroom_brown', 'dead_bush',
    'wool_white', 'brick', 'stone_bricks', 'glowstone', 'torch',
    'pumpkin_side', 'pumpkin_top', 'tnt_side', 'tnt_top', 'tnt_bottom',
    'iron_block', 'gold_block', 'diamond_block', 'emerald_block',
    'podzol_top', 'andesite', 'granite', 'diorite', 'deepslate',
    'red_sand', 'terracotta',
    // ---- icônes d'objets (non-blocs) ----
    'i_stick', 'i_coal', 'i_iron_ingot', 'i_gold_ingot', 'i_diamond',
    'i_emerald', 'i_redstone', 'i_lapis', 'i_apple', 'i_bread', 'i_wheat',
    'i_porkchop', 'i_porkchop_cooked', 'i_beef', 'i_steak',
    'i_chicken', 'i_chicken_cooked', 'i_leather', 'i_feather', 'i_string',
    'i_gunpowder', 'i_bone', 'i_flesh', 'i_arrow', 'i_bow', 'i_bucket',
    'i_bucket_water', 'i_pick_wood', 'i_pick_stone', 'i_pick_iron',
    'i_pick_diamond', 'i_axe_wood', 'i_axe_stone', 'i_axe_iron',
    'i_axe_diamond', 'i_shovel_wood', 'i_shovel_stone', 'i_shovel_iron',
    'i_shovel_diamond', 'i_sword_wood', 'i_sword_stone', 'i_sword_iron',
    'i_sword_diamond', 'i_flint', 'i_clay_ball', 'i_brick_item',
    'i_paper', 'i_book', 'i_seeds', 'i_charcoal'
  ];
  const TILE_INDEX = {};
  TILES.forEach((n, i) => { TILE_INDEX[n] = i; });
  const ATLAS_COLS = 16;

  /* ------------------------------------------------------- Types de rendu */
  const RENDER = { NONE: 0, CUBE: 1, CROSS: 2, LIQUID: 3, TORCH: 4 };
  // Familles de teinte (colorées par biome au moment du maillage)
  const TINT = { NONE: 0, GRASS: 1, FOLIAGE: 2, WATER: 3 };

  /* -------------------------------------------------------------- Outils  */
  const TOOL = { NONE: 0, PICKAXE: 1, AXE: 2, SHOVEL: 3, SWORD: 4, SHEARS: 5 };
  const MAT = { NONE: 0, WOOD: 1, STONE: 2, IRON: 3, DIAMOND: 4 };

  /* -------------------------------------------------------------- Blocs   */
  const B = {
    AIR: 0, STONE: 1, GRASS: 2, DIRT: 3, COBBLE: 4, PLANKS: 5, SAPLING: 6,
    BEDROCK: 7, WATER: 8, LAVA: 9, SAND: 10, GRAVEL: 11, LOG: 12, LEAVES: 13,
    GLASS: 14, COAL_ORE: 15, IRON_ORE: 16, GOLD_ORE: 17, DIAMOND_ORE: 18,
    REDSTONE_ORE: 19, LAPIS_ORE: 20, EMERALD_ORE: 21, SANDSTONE: 22,
    TALLGRASS: 23, FLOWER_RED: 24, FLOWER_YELLOW: 25, CRAFTING: 26,
    FURNACE: 27, FURNACE_LIT: 28, CHEST: 29, TORCH: 30, GLOWSTONE: 31,
    SNOW: 32, SNOW_GRASS: 33, ICE: 34, CLAY: 35, OBSIDIAN: 36, BOOKSHELF: 37,
    BRICKS: 38, STONE_BRICKS: 39, CACTUS: 40, SUGARCANE: 41, DEADBUSH: 42,
    PUMPKIN: 43, TNT: 44, IRON_BLOCK: 45, GOLD_BLOCK: 46, DIAMOND_BLOCK: 47,
    LOG_BIRCH: 48, LEAVES_BIRCH: 49, PLANKS_BIRCH: 50, LOG_SPRUCE: 51,
    LEAVES_SPRUCE: 52, PLANKS_SPRUCE: 53, ANDESITE: 54, GRANITE: 55,
    DIORITE: 56, DEEPSLATE: 57, RED_SAND: 58, TERRACOTTA: 59, WOOL: 60,
    MUSHROOM_RED: 61, MUSHROOM_BROWN: 62, PODZOL: 63, EMERALD_BLOCK: 64
  };

  const blocks = new Array(256).fill(null);

  /** Déclare un bloc. t = tuiles : string | [all] | {top,bottom,side} */
  function def(id, name, t, o) {
    o = o || {};
    let top, bottom, side;
    if (typeof t === 'string') { top = bottom = side = t; }
    else { top = t.top || t.all; bottom = t.bottom || t.all || top; side = t.side || t.all; }
    blocks[id] = {
      id, name,
      label: o.label || name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      tiles: [
        TILE_INDEX[side], TILE_INDEX[side],   // +X, -X
        TILE_INDEX[top], TILE_INDEX[bottom],  // +Y, -Y
        TILE_INDEX[side], TILE_INDEX[side]    // +Z, -Z
      ],
      render: o.render !== undefined ? o.render : RENDER.CUBE,
      solid: o.solid !== undefined ? o.solid : true,   // collision
      opaque: o.opaque !== undefined ? o.opaque : true,// bloque la lumière + culling
      cutout: !!o.cutout,                              // alphaTest
      liquid: !!o.liquid,
      light: o.light || 0,                             // émission 0..15
      filter: o.filter !== undefined ? o.filter : (o.opaque === false ? 1 : 15), // atténuation
      tint: o.tint || TINT.NONE,
      hardness: o.hardness !== undefined ? o.hardness : 1.0,
      tool: o.tool || TOOL.NONE,
      minMat: o.minMat || MAT.NONE,   // matériau minimal pour drop
      drop: o.drop !== undefined ? o.drop : id,
      dropCount: o.dropCount || 1,
      flammable: !!o.flammable,
      sound: o.sound || 'stone',
      climbable: !!o.climbable,
      hurt: o.hurt || 0
    };
    return blocks[id];
  }

  // --- air ---------------------------------------------------------------
  def(B.AIR, 'air', 'stone', { render: RENDER.NONE, solid: false, opaque: false, filter: 0, hardness: 0 });

  // --- terrain -----------------------------------------------------------
  def(B.STONE, 'stone', 'stone', { hardness: 1.5, tool: TOOL.PICKAXE, minMat: MAT.WOOD, drop: B.COBBLE, sound: 'stone' });
  def(B.GRASS, 'grass_block', { top: 'grass_top', bottom: 'dirt', side: 'grass_side' },
    { hardness: 0.6, tool: TOOL.SHOVEL, drop: B.DIRT, tint: TINT.GRASS, sound: 'grass' });
  def(B.DIRT, 'dirt', 'dirt', { hardness: 0.5, tool: TOOL.SHOVEL, sound: 'gravel' });
  def(B.PODZOL, 'podzol', { top: 'podzol_top', bottom: 'dirt', side: 'dirt' }, { hardness: 0.5, tool: TOOL.SHOVEL, drop: B.DIRT, sound: 'gravel' });
  def(B.COBBLE, 'cobblestone', 'cobblestone', { hardness: 2.0, tool: TOOL.PICKAXE, minMat: MAT.WOOD });
  def(B.BEDROCK, 'bedrock', 'bedrock', { hardness: -1, drop: -1 });
  def(B.SAND, 'sand', 'sand', { hardness: 0.5, tool: TOOL.SHOVEL, sound: 'sand' });
  def(B.RED_SAND, 'red_sand', 'red_sand', { hardness: 0.5, tool: TOOL.SHOVEL, sound: 'sand' });
  def(B.GRAVEL, 'gravel', 'gravel', { hardness: 0.6, tool: TOOL.SHOVEL, sound: 'gravel' });
  def(B.CLAY, 'clay', 'clay', { hardness: 0.6, tool: TOOL.SHOVEL, drop: 260 + 15, dropCount: 4, sound: 'gravel' });
  def(B.SANDSTONE, 'sandstone', { top: 'sandstone_top', bottom: 'sandstone_top', side: 'sandstone_side' }, { hardness: 0.8, tool: TOOL.PICKAXE, minMat: MAT.WOOD });
  def(B.ANDESITE, 'andesite', 'andesite', { hardness: 1.5, tool: TOOL.PICKAXE, minMat: MAT.WOOD });
  def(B.GRANITE, 'granite', 'granite', { hardness: 1.5, tool: TOOL.PICKAXE, minMat: MAT.WOOD });
  def(B.DIORITE, 'diorite', 'diorite', { hardness: 1.5, tool: TOOL.PICKAXE, minMat: MAT.WOOD });
  def(B.DEEPSLATE, 'deepslate', 'deepslate', { hardness: 3.0, tool: TOOL.PICKAXE, minMat: MAT.WOOD, drop: B.COBBLE });
  def(B.TERRACOTTA, 'terracotta', 'terracotta', { hardness: 1.25, tool: TOOL.PICKAXE, minMat: MAT.WOOD });
  def(B.OBSIDIAN, 'obsidian', 'obsidian', { hardness: 50, tool: TOOL.PICKAXE, minMat: MAT.DIAMOND });
  def(B.SNOW, 'snow_block', 'snow', { hardness: 0.2, tool: TOOL.SHOVEL, sound: 'snow' });
  def(B.SNOW_GRASS, 'snowy_grass', { top: 'snow', bottom: 'dirt', side: 'grass_snow_side' }, { hardness: 0.6, tool: TOOL.SHOVEL, drop: B.DIRT, sound: 'grass' });
  def(B.ICE, 'ice', 'ice', { hardness: 0.5, tool: TOOL.PICKAXE, drop: -1, opaque: false, filter: 3, cutout: false });

  // --- minerais ----------------------------------------------------------
  def(B.COAL_ORE, 'coal_ore', 'coal_ore', { hardness: 3, tool: TOOL.PICKAXE, minMat: MAT.WOOD, drop: 257 });
  def(B.IRON_ORE, 'iron_ore', 'iron_ore', { hardness: 3, tool: TOOL.PICKAXE, minMat: MAT.STONE });
  def(B.GOLD_ORE, 'gold_ore', 'gold_ore', { hardness: 3, tool: TOOL.PICKAXE, minMat: MAT.IRON });
  def(B.DIAMOND_ORE, 'diamond_ore', 'diamond_ore', { hardness: 3, tool: TOOL.PICKAXE, minMat: MAT.IRON, drop: 260 });
  def(B.REDSTONE_ORE, 'redstone_ore', 'redstone_ore', { hardness: 3, tool: TOOL.PICKAXE, minMat: MAT.IRON, drop: 262, dropCount: 4 });
  def(B.LAPIS_ORE, 'lapis_ore', 'lapis_ore', { hardness: 3, tool: TOOL.PICKAXE, minMat: MAT.STONE, drop: 263, dropCount: 5 });
  def(B.EMERALD_ORE, 'emerald_ore', 'emerald_ore', { hardness: 3, tool: TOOL.PICKAXE, minMat: MAT.IRON, drop: 261 });

  // --- bois & feuillage --------------------------------------------------
  def(B.LOG, 'oak_log', { top: 'log_oak_top', bottom: 'log_oak_top', side: 'log_oak_side' }, { hardness: 2, tool: TOOL.AXE, flammable: true, sound: 'wood' });
  def(B.LOG_BIRCH, 'birch_log', { top: 'log_birch_top', bottom: 'log_birch_top', side: 'log_birch_side' }, { hardness: 2, tool: TOOL.AXE, flammable: true, sound: 'wood' });
  def(B.LOG_SPRUCE, 'spruce_log', { top: 'log_spruce_top', bottom: 'log_spruce_top', side: 'log_spruce_side' }, { hardness: 2, tool: TOOL.AXE, flammable: true, sound: 'wood' });
  def(B.LEAVES, 'oak_leaves', 'leaves_oak', { hardness: 0.2, opaque: false, cutout: true, filter: 2, tint: TINT.FOLIAGE, drop: B.SAPLING, dropCount: 0, flammable: true, sound: 'grass' });
  def(B.LEAVES_BIRCH, 'birch_leaves', 'leaves_birch', { hardness: 0.2, opaque: false, cutout: true, filter: 2, tint: TINT.FOLIAGE, drop: -1, flammable: true, sound: 'grass' });
  def(B.LEAVES_SPRUCE, 'spruce_leaves', 'leaves_spruce', { hardness: 0.2, opaque: false, cutout: true, filter: 2, drop: -1, flammable: true, sound: 'grass' });
  def(B.PLANKS, 'oak_planks', 'planks_oak', { hardness: 2, tool: TOOL.AXE, flammable: true, sound: 'wood' });
  def(B.PLANKS_BIRCH, 'birch_planks', 'planks_birch', { hardness: 2, tool: TOOL.AXE, flammable: true, sound: 'wood' });
  def(B.PLANKS_SPRUCE, 'spruce_planks', 'planks_spruce', { hardness: 2, tool: TOOL.AXE, flammable: true, sound: 'wood' });
  def(B.BOOKSHELF, 'bookshelf', { top: 'planks_oak', bottom: 'planks_oak', side: 'bookshelf' }, { hardness: 1.5, tool: TOOL.AXE, flammable: true, sound: 'wood' });

  // --- liquides ----------------------------------------------------------
  def(B.WATER, 'water', 'water', {
    render: RENDER.LIQUID, solid: false, opaque: false, filter: 2,
    liquid: true, hardness: -1, drop: -1, tint: TINT.WATER, sound: 'none'
  });
  def(B.LAVA, 'lava', 'lava', {
    render: RENDER.LIQUID, solid: false, opaque: false, filter: 1,
    liquid: true, light: 15, hardness: -1, drop: -1, hurt: 4, sound: 'none'
  });

  // --- végétation (croix) -------------------------------------------------
  const crossOpts = { render: RENDER.CROSS, solid: false, opaque: false, cutout: true, filter: 0, hardness: 0.05, sound: 'grass' };
  def(B.TALLGRASS, 'tall_grass', 'tallgrass', Object.assign({}, crossOpts, { tint: TINT.GRASS, drop: 306, dropCount: 0 }));
  def(B.FLOWER_RED, 'poppy', 'flower_red', crossOpts);
  def(B.FLOWER_YELLOW, 'dandelion', 'flower_yellow', crossOpts);
  def(B.SAPLING, 'oak_sapling', 'sapling', Object.assign({}, crossOpts, { tint: TINT.FOLIAGE }));
  def(B.DEADBUSH, 'dead_bush', 'dead_bush', Object.assign({}, crossOpts, { drop: 256 }));
  def(B.MUSHROOM_RED, 'red_mushroom', 'mushroom_red', crossOpts);
  def(B.MUSHROOM_BROWN, 'brown_mushroom', 'mushroom_brown', Object.assign({}, crossOpts, { light: 1 }));
  def(B.SUGARCANE, 'sugar_cane', 'sugarcane', Object.assign({}, crossOpts, { hardness: 0.1 }));

  // --- fonctionnels -------------------------------------------------------
  def(B.GLASS, 'glass', 'glass', { hardness: 0.3, opaque: false, cutout: true, filter: 0, drop: -1, sound: 'glass' });
  def(B.CRAFTING, 'crafting_table', { top: 'crafting_top', bottom: 'planks_oak', side: 'crafting_side' }, { hardness: 2.5, tool: TOOL.AXE, flammable: true, sound: 'wood' });
  def(B.FURNACE, 'furnace', { top: 'furnace_top', bottom: 'furnace_top', side: 'furnace_side' }, { hardness: 3.5, tool: TOOL.PICKAXE, minMat: MAT.WOOD });
  blocks[B.FURNACE].tiles[5] = TILE_INDEX['furnace_front'];   // -Z = face avant
  def(B.FURNACE_LIT, 'furnace', { top: 'furnace_top', bottom: 'furnace_top', side: 'furnace_side' }, { hardness: 3.5, tool: TOOL.PICKAXE, minMat: MAT.WOOD, light: 13, drop: B.FURNACE });
  blocks[B.FURNACE_LIT].tiles[5] = TILE_INDEX['furnace_front_on'];
  def(B.CHEST, 'chest', { top: 'chest_top', bottom: 'chest_top', side: 'chest_side' }, { hardness: 2.5, tool: TOOL.AXE, flammable: true, sound: 'wood' });
  blocks[B.CHEST].tiles[5] = TILE_INDEX['chest_front'];
  def(B.TORCH, 'torch', 'torch', {
    render: RENDER.TORCH, solid: false, opaque: false, cutout: true,
    filter: 0, light: 14, hardness: 0.05, sound: 'wood'
  });
  def(B.GLOWSTONE, 'glowstone', 'glowstone', { hardness: 0.3, light: 15, sound: 'glass' });
  def(B.BRICKS, 'bricks', 'brick', { hardness: 2, tool: TOOL.PICKAXE, minMat: MAT.WOOD });
  def(B.STONE_BRICKS, 'stone_bricks', 'stone_bricks', { hardness: 1.5, tool: TOOL.PICKAXE, minMat: MAT.WOOD });
  def(B.WOOL, 'white_wool', 'wool_white', { hardness: 0.8, flammable: true, sound: 'cloth' });
  def(B.CACTUS, 'cactus', { top: 'cactus_top', bottom: 'cactus_top', side: 'cactus_side' }, { hardness: 0.4, hurt: 1, opaque: false, filter: 15, sound: 'grass' });
  def(B.PUMPKIN, 'pumpkin', { top: 'pumpkin_top', bottom: 'pumpkin_top', side: 'pumpkin_side' }, { hardness: 1, tool: TOOL.AXE, sound: 'wood' });
  def(B.TNT, 'tnt', { top: 'tnt_top', bottom: 'tnt_bottom', side: 'tnt_side' }, { hardness: 0, sound: 'grass' });
  def(B.IRON_BLOCK, 'iron_block', 'iron_block', { hardness: 5, tool: TOOL.PICKAXE, minMat: MAT.STONE, sound: 'metal' });
  def(B.GOLD_BLOCK, 'gold_block', 'gold_block', { hardness: 3, tool: TOOL.PICKAXE, minMat: MAT.IRON, sound: 'metal' });
  def(B.DIAMOND_BLOCK, 'diamond_block', 'diamond_block', { hardness: 5, tool: TOOL.PICKAXE, minMat: MAT.IRON, sound: 'metal' });
  def(B.EMERALD_BLOCK, 'emerald_block', 'emerald_block', { hardness: 5, tool: TOOL.PICKAXE, minMat: MAT.IRON, sound: 'metal' });

  /* ------------------------------------------------- Tables « plates » ---
   * Accès O(1) sans déréférencement d'objet dans les boucles chaudes
   * (maillage + éclairage traitent ~10⁶ voxels/seconde).
   * --------------------------------------------------------------------- */
  const N = 256;
  const T_OPAQUE = new Uint8Array(N);
  const T_SOLID = new Uint8Array(N);
  const T_RENDER = new Uint8Array(N);
  const T_LIGHT = new Uint8Array(N);
  const T_FILTER = new Uint8Array(N);
  const T_LIQUID = new Uint8Array(N);
  const T_CUTOUT = new Uint8Array(N);
  const T_TINT = new Uint8Array(N);
  const T_TILES = new Uint16Array(N * 6);
  for (let i = 0; i < N; i++) {
    const b = blocks[i];
    if (!b) { T_RENDER[i] = 0; continue; }
    T_OPAQUE[i] = b.opaque ? 1 : 0;
    T_SOLID[i] = b.solid ? 1 : 0;
    T_RENDER[i] = b.render;
    T_LIGHT[i] = b.light;
    T_FILTER[i] = b.filter;
    T_LIQUID[i] = b.liquid ? 1 : 0;
    T_CUTOUT[i] = b.cutout ? 1 : 0;
    T_TINT[i] = b.tint;
    for (let f = 0; f < 6; f++) T_TILES[i * 6 + f] = b.tiles[f];
  }

  /* ------------------------------------------------------------- Objets  */
  // Les objets purs (id ≥ 256) : outils, nourriture, ressources.
  const items = {};
  function item(id, name, tile, o) {
    o = o || {};
    items[id] = {
      id, name,
      label: o.label || name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      tile: TILE_INDEX[tile],
      stack: o.stack || 64,
      tool: o.tool || TOOL.NONE,
      mat: o.mat || MAT.NONE,
      speed: o.speed || 1,        // multiplicateur de minage
      damage: o.damage || 1,      // dégâts d'attaque
      durability: o.durability || 0,
      food: o.food || 0,          // points de faim restaurés
      saturation: o.saturation || 0,
      fuel: o.fuel || 0           // ticks de combustion (fourneau)
    };
    return items[id];
  }

  const I = {
    STICK: 256, COAL: 257, IRON_INGOT: 258, GOLD_INGOT: 259, DIAMOND: 260,
    EMERALD: 261, REDSTONE: 262, LAPIS: 263, APPLE: 264, BREAD: 265,
    WHEAT: 266, PORKCHOP: 267, PORKCHOP_COOKED: 268, BEEF: 269, STEAK: 270,
    CHICKEN: 271, CHICKEN_COOKED: 272, LEATHER: 273, FEATHER: 274,
    STRING: 275, GUNPOWDER: 276, BONE: 277, FLESH: 278, ARROW: 279,
    BOW: 280, BUCKET: 281, BUCKET_WATER: 282,
    PICK_WOOD: 283, PICK_STONE: 284, PICK_IRON: 285, PICK_DIAMOND: 286,
    AXE_WOOD: 287, AXE_STONE: 288, AXE_IRON: 289, AXE_DIAMOND: 290,
    SHOVEL_WOOD: 291, SHOVEL_STONE: 292, SHOVEL_IRON: 293, SHOVEL_DIAMOND: 294,
    SWORD_WOOD: 295, SWORD_STONE: 296, SWORD_IRON: 297, SWORD_DIAMOND: 298,
    FLINT: 299, CLAY_BALL: 275 + 0, BRICK_ITEM: 301, PAPER: 302, BOOK: 303,
    SEEDS: 304, CHARCOAL: 305, GRASS_ITEM: 306
  };
  I.CLAY_BALL = 300;

  item(I.STICK, 'stick', 'i_stick', { fuel: 100 });
  item(I.COAL, 'coal', 'i_coal', { fuel: 1600 });
  item(I.CHARCOAL, 'charcoal', 'i_charcoal', { fuel: 1600 });
  item(I.IRON_INGOT, 'iron_ingot', 'i_iron_ingot');
  item(I.GOLD_INGOT, 'gold_ingot', 'i_gold_ingot');
  item(I.DIAMOND, 'diamond', 'i_diamond');
  item(I.EMERALD, 'emerald', 'i_emerald');
  item(I.REDSTONE, 'redstone', 'i_redstone');
  item(I.LAPIS, 'lapis_lazuli', 'i_lapis');
  item(I.APPLE, 'apple', 'i_apple', { food: 4, saturation: 2.4 });
  item(I.BREAD, 'bread', 'i_bread', { food: 5, saturation: 6 });
  item(I.WHEAT, 'wheat', 'i_wheat');
  item(I.PORKCHOP, 'raw_porkchop', 'i_porkchop', { food: 3, saturation: 1.8 });
  item(I.PORKCHOP_COOKED, 'cooked_porkchop', 'i_porkchop_cooked', { food: 8, saturation: 12.8 });
  item(I.BEEF, 'raw_beef', 'i_beef', { food: 3, saturation: 1.8 });
  item(I.STEAK, 'steak', 'i_steak', { food: 8, saturation: 12.8 });
  item(I.CHICKEN, 'raw_chicken', 'i_chicken', { food: 2, saturation: 1.2 });
  item(I.CHICKEN_COOKED, 'cooked_chicken', 'i_chicken_cooked', { food: 6, saturation: 7.2 });
  item(I.LEATHER, 'leather', 'i_leather');
  item(I.FEATHER, 'feather', 'i_feather');
  item(I.STRING, 'string', 'i_string');
  item(I.GUNPOWDER, 'gunpowder', 'i_gunpowder');
  item(I.BONE, 'bone', 'i_bone');
  item(I.FLESH, 'rotten_flesh', 'i_flesh', { food: 2, saturation: 0.4 });
  item(I.ARROW, 'arrow', 'i_arrow');
  item(I.BOW, 'bow', 'i_bow', { stack: 1, durability: 384 });
  item(I.BUCKET, 'bucket', 'i_bucket', { stack: 1 });
  item(I.BUCKET_WATER, 'water_bucket', 'i_bucket_water', { stack: 1 });
  item(I.FLINT, 'flint', 'i_flint');
  item(I.CLAY_BALL, 'clay_ball', 'i_clay_ball');
  item(I.BRICK_ITEM, 'brick', 'i_brick_item');
  item(I.PAPER, 'paper', 'i_paper');
  item(I.BOOK, 'book', 'i_book');
  item(I.SEEDS, 'wheat_seeds', 'i_seeds');
  item(I.GRASS_ITEM, 'grass', 'tallgrass');

  // Outils : (tool, mat, vitesse, dégâts, durabilité)
  const toolDef = [
    [I.PICK_WOOD, 'wooden_pickaxe', 'i_pick_wood', TOOL.PICKAXE, MAT.WOOD, 2, 2, 59, 200],
    [I.PICK_STONE, 'stone_pickaxe', 'i_pick_stone', TOOL.PICKAXE, MAT.STONE, 4, 3, 131, 0],
    [I.PICK_IRON, 'iron_pickaxe', 'i_pick_iron', TOOL.PICKAXE, MAT.IRON, 6, 4, 250, 0],
    [I.PICK_DIAMOND, 'diamond_pickaxe', 'i_pick_diamond', TOOL.PICKAXE, MAT.DIAMOND, 8, 5, 1561, 0],
    [I.AXE_WOOD, 'wooden_axe', 'i_axe_wood', TOOL.AXE, MAT.WOOD, 2, 3, 59, 200],
    [I.AXE_STONE, 'stone_axe', 'i_axe_stone', TOOL.AXE, MAT.STONE, 4, 4, 131, 0],
    [I.AXE_IRON, 'iron_axe', 'i_axe_iron', TOOL.AXE, MAT.IRON, 6, 5, 250, 0],
    [I.AXE_DIAMOND, 'diamond_axe', 'i_axe_diamond', TOOL.AXE, MAT.DIAMOND, 8, 6, 1561, 0],
    [I.SHOVEL_WOOD, 'wooden_shovel', 'i_shovel_wood', TOOL.SHOVEL, MAT.WOOD, 2, 2, 59, 200],
    [I.SHOVEL_STONE, 'stone_shovel', 'i_shovel_stone', TOOL.SHOVEL, MAT.STONE, 4, 3, 131, 0],
    [I.SHOVEL_IRON, 'iron_shovel', 'i_shovel_iron', TOOL.SHOVEL, MAT.IRON, 6, 4, 250, 0],
    [I.SHOVEL_DIAMOND, 'diamond_shovel', 'i_shovel_diamond', TOOL.SHOVEL, MAT.DIAMOND, 8, 5, 1561, 0],
    [I.SWORD_WOOD, 'wooden_sword', 'i_sword_wood', TOOL.SWORD, MAT.WOOD, 1.5, 4, 59, 200],
    [I.SWORD_STONE, 'stone_sword', 'i_sword_stone', TOOL.SWORD, MAT.STONE, 1.5, 5, 131, 0],
    [I.SWORD_IRON, 'iron_sword', 'i_sword_iron', TOOL.SWORD, MAT.IRON, 1.5, 6, 250, 0],
    [I.SWORD_DIAMOND, 'diamond_sword', 'i_sword_diamond', TOOL.SWORD, MAT.DIAMOND, 1.5, 7, 1561, 0]
  ];
  toolDef.forEach(t => item(t[0], t[1], t[2], {
    stack: 1, tool: t[3], mat: t[4], speed: t[5], damage: t[6], durability: t[7], fuel: t[8]
  }));

  /* ------------------------------------------------------------ Helpers  */
  function isBlock(id) { return id >= 0 && id < 256; }
  function itemLabel(id) {
    if (isBlock(id)) return blocks[id] ? blocks[id].label : '?';
    return items[id] ? items[id].label : '?';
  }
  function itemTile(id) {
    if (isBlock(id)) return blocks[id] ? blocks[id].tiles[2] : 0;
    return items[id] ? items[id].tile : 0;
  }
  function maxStack(id) {
    if (isBlock(id)) return 64;
    return items[id] ? items[id].stack : 64;
  }
  /** Combustible pour le fourneau (en ticks). */
  function fuelValue(id) {
    if (isBlock(id)) {
      const b = blocks[id];
      if (!b) return 0;
      if (b.flammable) return b.name.indexOf('log') >= 0 || b.name.indexOf('planks') >= 0 ? 300 : 100;
      return 0;
    }
    return items[id] ? items[id].fuel : 0;
  }
  /** Durée de minage en secondes (formule dérivée de la mécanique vanilla). */
  function breakTime(blockId, itemId) {
    const b = blocks[blockId];
    if (!b || b.hardness < 0) return Infinity;
    if (b.hardness === 0) return 0;
    const it = (!isBlock(itemId) && items[itemId]) ? items[itemId] : null;
    let speed = 1, canHarvest = b.minMat === MAT.NONE;
    if (it && it.tool !== TOOL.NONE) {
      if (it.tool === b.tool) { speed = it.speed; canHarvest = it.mat >= b.minMat; }
      else if (it.tool === TOOL.SWORD && b.name.indexOf('leaves') >= 0) speed = 15;
    }
    const base = b.hardness * (canHarvest ? 1.5 : 5.0);
    return base / speed;
  }
  function canHarvest(blockId, itemId) {
    const b = blocks[blockId];
    if (!b) return false;
    if (b.minMat === MAT.NONE) return true;
    const it = (!isBlock(itemId) && items[itemId]) ? items[itemId] : null;
    return !!(it && it.tool === b.tool && it.mat >= b.minMat);
  }

  root.VC = root.VC || {};
  Object.assign(root.VC, {
    CH_X, CH_Y, CH_Z, CH_AREA, CH_VOL, SEA_LEVEL, idx,
    TILES, TILE_INDEX, ATLAS_COLS, RENDER, TINT, TOOL, MAT,
    B, I, blocks, items,
    T_OPAQUE, T_SOLID, T_RENDER, T_LIGHT, T_FILTER, T_LIQUID, T_CUTOUT, T_TINT, T_TILES,
    isBlock, itemLabel, itemTile, maxStack, fuelValue, breakTime, canHarvest
  });
})(typeof self !== 'undefined' ? self : this);
