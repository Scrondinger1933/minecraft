/* =========================================================================
 *  VOXELCRAFT — Génération procédurale du monde
 *
 *  Pipeline (inspiré de l'architecture 1.18 « Caves & Cliffs ») :
 *    1. Bruits de climat      : continentalité, érosion, peaks&valleys,
 *                               température, humidité, weirdness
 *    2. Splines               : hauteur de base + facteur d'échelle
 *    3. Densité 3D            : squashing factor -> surplombs possibles
 *    4. Carving               : grottes « cheese » (3D) + « spaghetti » (2 ridged)
 *                               + ravins
 *    5. Surface               : règles par biome (herbe/sable/neige/podzol)
 *    6. Minerais              : distribution par bandes d'altitude
 *    7. Structures            : arbres, cactus, fleurs, citrouilles, lacs
 * ========================================================================= */
(function (root) {
  'use strict';
  const N = root.VCNoise;
  const V = root.VC;
  const B = V.B;
  const { CH_X, CH_Y, CH_Z, SEA_LEVEL, idx } = V;

  /* ------------------------------------------------------------ Biomes -- */
  const BIOME = {
    OCEAN: 0, DEEP_OCEAN: 1, BEACH: 2, PLAINS: 3, FOREST: 4, BIRCH_FOREST: 5,
    TAIGA: 6, SNOWY_PLAINS: 7, SNOWY_TAIGA: 8, DESERT: 9, SAVANNA: 10,
    JUNGLE: 11, SWAMP: 12, MOUNTAINS: 13, SNOWY_PEAKS: 14, BADLANDS: 15,
    STONY_SHORE: 16, RIVER: 17, MUSHROOM: 18, SUNFLOWER_PLAINS: 19
  };

  const BIOME_DATA = {};
  function biome(id, name, o) { BIOME_DATA[id] = Object.assign({ id, name }, o); }

  // grassColor / foliageColor : teintes RGB (0..1) appliquées au maillage
  biome(BIOME.OCEAN, 'Océan', { top: B.SAND, filler: B.SAND, grass: [0.35, 0.60, 0.45], foliage: [0.32, 0.55, 0.32], water: [0.13, 0.32, 0.62], trees: 0, temp: 0.5 });
  biome(BIOME.DEEP_OCEAN, 'Océan profond', { top: B.GRAVEL, filler: B.GRAVEL, grass: [0.35, 0.60, 0.45], foliage: [0.32, 0.55, 0.32], water: [0.10, 0.25, 0.55], trees: 0, temp: 0.5 });
  biome(BIOME.BEACH, 'Plage', { top: B.SAND, filler: B.SAND, grass: [0.55, 0.75, 0.35], foliage: [0.45, 0.70, 0.30], water: [0.16, 0.42, 0.70], trees: 0, temp: 0.8 });
  biome(BIOME.STONY_SHORE, 'Rivage rocheux', { top: B.STONE, filler: B.STONE, grass: [0.45, 0.65, 0.40], foliage: [0.40, 0.60, 0.35], water: [0.15, 0.38, 0.66], trees: 0, temp: 0.2 });
  biome(BIOME.PLAINS, 'Plaines', { top: B.GRASS, filler: B.DIRT, grass: [0.56, 0.79, 0.33], foliage: [0.47, 0.73, 0.27], water: [0.17, 0.44, 0.72], trees: 0.012, grassDensity: 0.22, flowers: 0.03, temp: 0.8 });
  biome(BIOME.SUNFLOWER_PLAINS, 'Plaines fleuries', { top: B.GRASS, filler: B.DIRT, grass: [0.58, 0.81, 0.32], foliage: [0.47, 0.73, 0.27], water: [0.17, 0.44, 0.72], trees: 0.008, grassDensity: 0.3, flowers: 0.18, temp: 0.8 });
  biome(BIOME.FOREST, 'Forêt', { top: B.GRASS, filler: B.DIRT, grass: [0.47, 0.73, 0.27], foliage: [0.36, 0.65, 0.22], water: [0.17, 0.44, 0.72], trees: 0.10, grassDensity: 0.18, flowers: 0.02, temp: 0.7 });
  biome(BIOME.BIRCH_FOREST, 'Forêt de bouleaux', { top: B.GRASS, filler: B.DIRT, grass: [0.51, 0.76, 0.30], foliage: [0.42, 0.70, 0.26], water: [0.17, 0.44, 0.72], trees: 0.09, treeType: 1, grassDensity: 0.15, temp: 0.6 });
  biome(BIOME.TAIGA, 'Taïga', { top: B.GRASS, filler: B.DIRT, grass: [0.34, 0.60, 0.42], foliage: [0.30, 0.55, 0.38], water: [0.13, 0.36, 0.66], trees: 0.09, treeType: 2, grassDensity: 0.08, temp: 0.25 });
  biome(BIOME.SNOWY_TAIGA, 'Taïga enneigée', { top: B.SNOW_GRASS, filler: B.DIRT, grass: [0.32, 0.56, 0.42], foliage: [0.28, 0.52, 0.38], water: [0.12, 0.33, 0.64], trees: 0.07, treeType: 2, snow: true, temp: -0.2 });
  biome(BIOME.SNOWY_PLAINS, 'Plaines enneigées', { top: B.SNOW_GRASS, filler: B.DIRT, grass: [0.50, 0.68, 0.50], foliage: [0.45, 0.62, 0.45], water: [0.12, 0.33, 0.64], trees: 0.004, treeType: 2, snow: true, temp: -0.3 });
  biome(BIOME.DESERT, 'Désert', { top: B.SAND, filler: B.SAND, under: B.SANDSTONE, grass: [0.75, 0.72, 0.33], foliage: [0.68, 0.66, 0.30], water: [0.20, 0.48, 0.72], trees: 0, cactus: 0.02, deadbush: 0.02, temp: 2.0 });
  biome(BIOME.SAVANNA, 'Savane', { top: B.GRASS, filler: B.DIRT, grass: [0.74, 0.72, 0.34], foliage: [0.65, 0.68, 0.30], water: [0.18, 0.46, 0.72], trees: 0.012, grassDensity: 0.25, temp: 1.2 });
  biome(BIOME.JUNGLE, 'Jungle', { top: B.GRASS, filler: B.DIRT, grass: [0.35, 0.75, 0.19], foliage: [0.19, 0.66, 0.11], water: [0.15, 0.50, 0.60], trees: 0.16, treeType: 3, grassDensity: 0.45, temp: 0.95 });
  biome(BIOME.SWAMP, 'Marais', { top: B.GRASS, filler: B.DIRT, grass: [0.42, 0.53, 0.30], foliage: [0.40, 0.51, 0.28], water: [0.24, 0.32, 0.24], trees: 0.05, treeType: 4, grassDensity: 0.3, mushroom: 0.02, temp: 0.8 });
  biome(BIOME.MOUNTAINS, 'Montagnes', { top: B.GRASS, filler: B.DIRT, grass: [0.45, 0.68, 0.38], foliage: [0.40, 0.62, 0.34], water: [0.15, 0.40, 0.70], trees: 0.02, treeType: 2, grassDensity: 0.05, temp: 0.2 });
  biome(BIOME.SNOWY_PEAKS, 'Pics enneigés', { top: B.SNOW, filler: B.STONE, grass: [0.50, 0.68, 0.50], foliage: [0.45, 0.62, 0.45], water: [0.12, 0.33, 0.64], trees: 0, snow: true, temp: -0.7 });
  biome(BIOME.BADLANDS, 'Mesa', { top: B.RED_SAND, filler: B.TERRACOTTA, under: B.TERRACOTTA, grass: [0.62, 0.52, 0.25], foliage: [0.60, 0.50, 0.24], water: [0.20, 0.45, 0.68], trees: 0, deadbush: 0.03, temp: 2.0 });
  biome(BIOME.RIVER, 'Rivière', { top: B.SAND, filler: B.DIRT, grass: [0.50, 0.74, 0.35], foliage: [0.45, 0.70, 0.30], water: [0.17, 0.44, 0.78], trees: 0, temp: 0.6 });
  biome(BIOME.MUSHROOM, 'Îles champignon', { top: B.PODZOL, filler: B.DIRT, grass: [0.55, 0.60, 0.45], foliage: [0.50, 0.55, 0.40], water: [0.17, 0.44, 0.72], trees: 0, mushroom: 0.25, temp: 0.9 });

  /* ================================================== WorldGenerator ===== */
  function WorldGenerator(seed) {
    seed = seed | 0;
    this.seed = seed;

    // --- bruits de climat (basse fréquence, grandes régions) ---
    this.nCont = new N.FBM(seed + 101, 5, 2.0, 0.5);   // continentalité
    this.nEros = new N.FBM(seed + 211, 4, 2.0, 0.5);   // érosion
    this.nPV = new N.FBM(seed + 331, 4, 2.0, 0.5);   // peaks & valleys
    this.nTemp = new N.FBM(seed + 443, 3, 2.0, 0.5);
    this.nHum = new N.FBM(seed + 557, 3, 2.0, 0.5);
    this.nWeird = new N.FBM(seed + 673, 3, 2.0, 0.5);
    this.nRiver = new N.FBM(seed + 787, 2, 2.0, 0.5);

    // --- bruits de terrain ---
    this.nDetail = new N.FBM(seed + 907, 4, 2.0, 0.5);
    this.n3D = new N.FBM(seed + 1013, 4, 2.0, 0.5);   // densité 3D
    this.nWarpX = new N.FBM(seed + 1117, 2, 2.0, 0.5);
    this.nWarpZ = new N.FBM(seed + 1223, 2, 2.0, 0.5);

    // --- grottes ---
    this.nCheese = new N.FBM(seed + 1327, 3, 2.0, 0.5);
    this.nSpagA = new N.FBM(seed + 1447, 2, 2.0, 0.5);
    this.nSpagB = new N.FBM(seed + 1553, 2, 2.0, 0.5);
    this.nCaveY = new N.FBM(seed + 1663, 2, 2.0, 0.5);
    this.nRavine = new N.FBM(seed + 1777, 2, 2.0, 0.5);

    // --- minerais / roches ---
    this.nOre = new N.FBM(seed + 1889, 2, 2.0, 0.5);
    this.nRock = new N.FBM(seed + 1993, 2, 2.0, 0.5);

    /* ---- splines de terrain (continentalité → hauteur) ---- */
    // c ∈ [-1,1] : -1 = abysses, 0 = côte, 1 = intérieur des terres
    this.contSpline = N.spline([
      [-1.00, 20], [-0.60, 34], [-0.30, 48], [-0.12, 58],
      [-0.02, 63], [0.05, 68], [0.25, 78], [0.55, 92], [1.00, 118]
    ]);
    // érosion → amplitude du relief (érosion forte = terrain plat)
    this.erosSpline = N.spline([
      [-1.00, 1.00], [-0.55, 0.85], [-0.20, 0.55], [0.10, 0.30],
      [0.40, 0.15], [0.75, 0.08], [1.00, 0.05]
    ]);
    // peaks & valleys → décalage vertical
    this.pvSpline = N.spline([
      [-1.00, -26], [-0.55, -14], [-0.20, -4], [0.05, 2],
      [0.35, 14], [0.70, 34], [1.00, 56]
    ]);
  }

  /* ----------------------------------------- Échantillonnage du climat -- */
  WorldGenerator.prototype.sampleClimate = function (wx, wz) {
    // domain warping : brise la régularité perceptible du Perlin
    const wxw = wx + this.nWarpX.get2(wx, wz, 0.0025) * 60;
    const wzw = wz + this.nWarpZ.get2(wx, wz, 0.0025) * 60;

    const cont = this.nCont.get2(wxw, wzw, 0.00085);
    const eros = this.nEros.get2(wxw + 4000, wzw - 3000, 0.0014);
    const pvRaw = this.nPV.ridged2(wxw - 7000, wzw + 5000, 0.0032);
    const temp = this.nTemp.get2(wx + 12000, wz + 9000, 0.0011);
    const hum = this.nHum.get2(wx - 15000, wz + 21000, 0.0013);
    const weird = this.nWeird.get2(wx + 3300, wz - 8800, 0.0021);

    // rivières : bande étroite autour du zéro d'un bruit — |n| < seuil
    const rv = this.nRiver.get2(wx + 500, wz - 500, 0.0011);
    const river = 1 - Math.min(1, Math.abs(rv) / 0.055);   // 0..1

    return { cont, eros, pv: pvRaw, temp, hum, weird, river, wxw, wzw };
  };

  /* --------------------------------------------- Hauteur du terrain ----- */
  WorldGenerator.prototype.terrainHeight = function (wx, wz, cl) {
    cl = cl || this.sampleClimate(wx, wz);
    const base = this.contSpline(cl.cont);
    const amp = this.erosSpline(cl.eros);
    const pv = this.pvSpline(cl.pv) * amp;
    const detail = this.nDetail.get2(cl.wxw, cl.wzw, 0.012) * 7 * amp;
    const micro = this.nDetail.get2(cl.wxw, cl.wzw, 0.055) * 2.2 * amp;

    let h = base + pv + detail + micro;

    // creusement des rivières (seulement hors océan profond)
    if (cl.river > 0 && cl.cont > -0.25) {
      const depth = cl.river * cl.river * 9 * Math.min(1, (cl.cont + 0.25) * 3);
      h -= depth;
      if (h < SEA_LEVEL - 6) h = SEA_LEVEL - 6 + (h - (SEA_LEVEL - 6)) * 0.25;
    }
    return h;
  };

  /* ------------------------------------------------ Choix du biome ------ */
  WorldGenerator.prototype.pickBiome = function (h, cl) {
    const t = cl.temp, hu = cl.hum;

    if (h < SEA_LEVEL - 14) return BIOME.DEEP_OCEAN;
    if (h < SEA_LEVEL - 1) {
      if (cl.river > 0.5 && cl.cont > -0.15) return BIOME.RIVER;
      return BIOME.OCEAN;
    }
    if (h < SEA_LEVEL + 2) {
      if (cl.river > 0.5 && cl.cont > -0.15) return BIOME.RIVER;
      if (t < -0.25) return BIOME.SNOWY_PLAINS;
      if (cl.eros < -0.5) return BIOME.STONY_SHORE;
      return BIOME.BEACH;
    }
    // haute altitude
    if (h > 108) return BIOME.SNOWY_PEAKS;
    if (h > 92) return t < -0.15 ? BIOME.SNOWY_PEAKS : BIOME.MOUNTAINS;

    // île champignon rare : très isolée en mer
    if (cl.weird > 0.72 && cl.cont > -0.05 && cl.cont < 0.12 && h < SEA_LEVEL + 12) return BIOME.MUSHROOM;

    // matrice température × humidité
    if (t > 0.45) {
      if (hu < -0.30) return (cl.weird > 0.35) ? BIOME.BADLANDS : BIOME.DESERT;
      if (hu < 0.10) return BIOME.SAVANNA;
      return BIOME.JUNGLE;
    }
    if (t > 0.05) {
      if (hu < -0.35) return BIOME.DESERT;
      if (hu < -0.05) return (cl.weird > 0.3) ? BIOME.SUNFLOWER_PLAINS : BIOME.PLAINS;
      if (hu < 0.35) return (cl.weird > 0.15) ? BIOME.BIRCH_FOREST : BIOME.FOREST;
      return BIOME.SWAMP;
    }
    if (t > -0.35) {
      if (hu < -0.2) return BIOME.PLAINS;
      if (hu < 0.25) return BIOME.FOREST;
      return BIOME.TAIGA;
    }
    return hu > 0 ? BIOME.SNOWY_TAIGA : BIOME.SNOWY_PLAINS;
  };

  /* ---------------------------------------------------- Grottes --------- */
  /** true si le voxel doit être creusé. */
  WorldGenerator.prototype.isCave = function (wx, y, wz, surfaceH) {
    if (y < 4 || y > surfaceH - 3) return false;

    // 1) « Cheese caves » — grandes cavernes, faible fréquence, sous 58
    if (y < 58) {
      const c = this.nCheese.get3(wx, y * 1.6, wz, 0.014);
      // le seuil se resserre près de la surface pour éviter les trous béants
      const depthFactor = Math.min(1, (58 - y) / 26);
      if (Math.abs(c) < 0.085 * depthFactor) return true;
    }

    // 2) « Spaghetti caves » — tunnels : intersection de 2 bruits ridged
    const yScale = 0.55; // tunnels plus horizontaux que verticaux
    const a = this.nSpagA.get3(wx, y * yScale, wz, 0.0165);
    const b = this.nSpagB.get3(wx + 1000, y * yScale, wz - 1000, 0.0165);
    const thick = 0.055 + 0.02 * this.nCaveY.get2(wx, wz, 0.004);
    if (a * a + b * b < thick * thick) return true;

    // 3) Ravins — fentes verticales étroites et profondes
    if (y > 12 && y < surfaceH - 6) {
      const r = this.nRavine.ridged2(wx, wz, 0.0038);
      if (r > 0.80) {
        const width = (r - 0.80) * 5;   // 0..1
        const rr = this.nRavine.get2(wx * 3.1 + 77, wz * 3.1 - 44, 0.02);
        if (Math.abs(rr) < width * 0.35) {
          const top = surfaceH - 8, bot = 14;
          if (y > bot && y < top) return true;
        }
      }
    }
    return false;
  };

  /* ------------------------------------------------------ Minerais ------ */
  WorldGenerator.prototype.oreAt = function (wx, y, wz) {
    const h = N.hash3;
    const s = this.seed;
    // Chaque minerai : bande d'altitude + probabilité + bruit d'amas
    // Amas : bruit haute fréquence seuillé → veines connexes
    function vein(gen, fx, fy, fz, off, thr) {
      return gen.get3(wx * fx + off, y * fy + off, wz * fz + off, 1) > thr;
    }
    const n = this.nOre;

    if (y < 16 && n.get3(wx * 0.09 + 500, y * 0.09, wz * 0.09, 1) > 0.62 && h(wx, y, wz, s + 71) < 0.55) return B.DIAMOND_ORE;
    if (y < 32 && n.get3(wx * 0.10 + 900, y * 0.10, wz * 0.10, 1) > 0.66 && h(wx, y, wz, s + 73) < 0.45) return B.EMERALD_ORE;
    if (y < 24 && n.get3(wx * 0.10 + 1300, y * 0.10, wz * 0.10, 1) > 0.52 && h(wx, y, wz, s + 79) < 0.7) return B.REDSTONE_ORE;
    if (y < 32 && n.get3(wx * 0.10 + 1700, y * 0.10, wz * 0.10, 1) > 0.60 && h(wx, y, wz, s + 83) < 0.6) return B.LAPIS_ORE;
    if (y < 34 && n.get3(wx * 0.10 + 2100, y * 0.10, wz * 0.10, 1) > 0.58 && h(wx, y, wz, s + 89) < 0.6) return B.GOLD_ORE;
    if (y < 60 && n.get3(wx * 0.11 + 2500, y * 0.11, wz * 0.11, 1) > 0.44 && h(wx, y, wz, s + 97) < 0.75) return B.IRON_ORE;
    if (y < 96 && n.get3(wx * 0.11 + 2900, y * 0.11, wz * 0.11, 1) > 0.40 && h(wx, y, wz, s + 101) < 0.8) return B.COAL_ORE;
    return 0;
  };

  /* --------------------------------------- Génération d'un chunk -------- */
  /**
   * @param cx,cz coordonnées de chunk
   * @returns {blocks: Uint8Array, biomes: Uint8Array, heights: Uint8Array}
   */
  WorldGenerator.prototype.generateChunk = function (cx, cz) {
    const blocks = new Uint8Array(V.CH_VOL);
    const biomes = new Uint8Array(V.CH_AREA);
    const heights = new Uint8Array(V.CH_AREA);
    const ox = cx * CH_X, oz = cz * CH_Z;

    // ---------- passe 1 : colonnes (pierre / eau / air) ----------
    for (let z = 0; z < CH_Z; z++) {
      for (let x = 0; x < CH_X; x++) {
        const wx = ox + x, wz = oz + z;
        const cl = this.sampleClimate(wx, wz);
        let hf = this.terrainHeight(wx, wz, cl);
        let h = Math.max(1, Math.min(CH_Y - 2, Math.round(hf)));
        const bid = this.pickBiome(hf, cl);
        const ai = z * CH_X + x;
        biomes[ai] = bid;
        heights[ai] = h;
        const bd = BIOME_DATA[bid];

        for (let y = 0; y <= Math.max(h, SEA_LEVEL); y++) {
          const i = idx(x, y, z);
          if (y === 0) { blocks[i] = B.BEDROCK; continue; }
          if (y <= 3 && N.hash3(wx, y, wz, this.seed + 13) < (4 - y) * 0.28) { blocks[i] = B.BEDROCK; continue; }

          if (y > h) {
            // au-dessus du sol : eau si sous le niveau de la mer
            if (y <= SEA_LEVEL) blocks[i] = (bd.temp < -0.25 && y === SEA_LEVEL) ? B.ICE : B.WATER;
            continue;
          }

          // densité 3D : autorise surplombs et corniches en montagne
          if (y > h - 12 && y > SEA_LEVEL) {
            const d3 = this.n3D.get3(wx, y * 0.7, wz, 0.021);
            const bias = (h - y) / 12;          // 0 en surface → 1 à -12
            if (d3 * 0.55 + bias < 0.16) { if (y <= SEA_LEVEL) blocks[i] = B.WATER; continue; }
          }

          // roche de base + variantes
          let block = B.STONE;
          if (y < 12) block = B.DEEPSLATE;
          else {
            const rk = this.nRock.get3(wx, y * 0.8, wz, 0.028);
            if (rk > 0.52) block = B.ANDESITE;
            else if (rk < -0.56) block = B.GRANITE;
            else if (rk > 0.30 && rk < 0.36) block = B.DIORITE;
          }
          const ore = this.oreAt(wx, y, wz);
          if (ore && block !== B.DEEPSLATE) block = ore;
          else if (ore && y < 12) block = ore;
          blocks[i] = block;
        }
      }
    }

    // ---------- passe 2 : creusement des grottes ----------
    for (let z = 0; z < CH_Z; z++) {
      for (let x = 0; x < CH_X; x++) {
        const wx = ox + x, wz = oz + z;
        const h = heights[z * CH_X + x];
        for (let y = 1; y < h; y++) {
          const i = idx(x, y, z);
          const b = blocks[i];
          if (b === 0 || b === B.BEDROCK || b === B.WATER) continue;
          if (this.isCave(wx, y, wz, h)) {
            // poches de lave dans les profondeurs
            blocks[i] = (y < 11) ? B.LAVA : B.AIR;
          }
        }
      }
    }

    // ---------- passe 3 : surface (règles de biome) ----------
    for (let z = 0; z < CH_Z; z++) {
      for (let x = 0; x < CH_X; x++) {
        const ai = z * CH_X + x;
        const bd = BIOME_DATA[biomes[ai]];
        const wx = ox + x, wz = oz + z;
        // trouve le sommet solide réel (post-grottes)
        let top = -1;
        for (let y = CH_Y - 1; y >= 0; y--) {
          const b = blocks[idx(x, y, z)];
          if (b !== B.AIR && b !== B.WATER && b !== B.ICE) { top = y; break; }
        }
        if (top < 1) continue;
        const submerged = top < SEA_LEVEL;
        const depth = 3 + ((N.hash3(wx, 0, wz, this.seed + 31) * 2) | 0);

        for (let d = 0; d < depth; d++) {
          const y = top - d;
          if (y < 1) break;
          const i = idx(x, y, z);
          const b = blocks[i];
          if (b === B.AIR || b === B.WATER || b === B.BEDROCK) break;
          if (b === B.LAVA) break;
          if (d === 0) {
            if (submerged) blocks[i] = (top < SEA_LEVEL - 6) ? (bd.filler || B.GRAVEL) : B.SAND;
            else blocks[i] = bd.top;
          } else if (d < depth - 1) {
            blocks[i] = submerged ? (bd.filler || B.DIRT) : (bd.filler || B.DIRT);
          } else if (bd.under) {
            blocks[i] = bd.under;
          }
        }
        // bandes de terracotta pour la mesa
        if (biomes[ai] === BIOME.BADLANDS && !submerged) {
          for (let y = top - depth; y > Math.max(1, top - 22); y--) {
            const i = idx(x, y, z);
            if (blocks[i] === B.STONE) blocks[i] = ((y % 7) < 3) ? B.TERRACOTTA : B.SANDSTONE;
          }
        }
        heights[ai] = top;
      }
    }

    return { blocks, biomes, heights };
  };

  /* ------------------------------------------------- Décoration --------- */
  /**
   * Structures (arbres, plantes). Peut écrire hors du chunk : les débordements
   * sont renvoyés dans `spill` sous forme de liste [wx,y,wz,block].
   */
  WorldGenerator.prototype.decorate = function (cx, cz, data) {
    const { blocks, biomes, heights } = data;
    const ox = cx * CH_X, oz = cz * CH_Z;
    const spill = [];
    const self = this;

    function set(x, y, z, b, force) {
      if (y < 0 || y >= CH_Y) return;
      if (x >= 0 && x < CH_X && z >= 0 && z < CH_Z) {
        const i = idx(x, y, z);
        if (force || blocks[i] === B.AIR || blocks[i] === B.LEAVES || blocks[i] === B.LEAVES_BIRCH || blocks[i] === B.LEAVES_SPRUCE) blocks[i] = b;
      } else {
        spill.push([ox + x, y, oz + z, b]);
      }
    }
    function get(x, y, z) {
      if (y < 0 || y >= CH_Y) return B.AIR;
      if (x < 0 || x >= CH_X || z < 0 || z >= CH_Z) return -1; // inconnu
      return blocks[idx(x, y, z)];
    }

    /* ---- arbres ---- */
    function oakTree(x, y, z, r) {
      const th = 4 + ((r * 3) | 0);
      for (let i = 0; i < th; i++) set(x, y + i, z, B.LOG, true);
      const top = y + th;
      for (let dy = -2; dy <= 1; dy++) {
        const rad = (dy <= -1) ? 2 : (dy === 0 ? 2 : 1);
        for (let dx = -rad; dx <= rad; dx++) {
          for (let dz = -rad; dz <= rad; dz++) {
            if (dx === 0 && dz === 0 && dy <= 0) continue;
            const d = Math.abs(dx) + Math.abs(dz);
            if (d > rad + 1) continue;
            if (rad === 2 && Math.abs(dx) === 2 && Math.abs(dz) === 2 && N.hash3(x + dx, top + dy, z + dz, 7) > 0.4) continue;
            set(x + dx, top + dy, z + dz, B.LEAVES);
          }
        }
      }
      set(x, top + 1, z, B.LEAVES);
    }
    function birchTree(x, y, z, r) {
      const th = 5 + ((r * 3) | 0);
      for (let i = 0; i < th; i++) set(x, y + i, z, B.LOG_BIRCH, true);
      const top = y + th;
      for (let dy = -2; dy <= 1; dy++) {
        const rad = (dy <= 0) ? 2 : 1;
        for (let dx = -rad; dx <= rad; dx++)
          for (let dz = -rad; dz <= rad; dz++) {
            if (dx === 0 && dz === 0 && dy <= 0) continue;
            if (Math.abs(dx) === 2 && Math.abs(dz) === 2) continue;
            set(x + dx, top + dy, z + dz, B.LEAVES_BIRCH);
          }
      }
      set(x, top + 1, z, B.LEAVES_BIRCH);
    }
    function spruceTree(x, y, z, r) {
      const th = 6 + ((r * 5) | 0);
      for (let i = 0; i < th; i++) set(x, y + i, z, B.LOG_SPRUCE, true);
      let rad = 0;
      for (let dy = th; dy >= 2; dy--) {
        const layer = th - dy;
        rad = (layer % 4 < 2) ? ((layer / 4) | 0) + 1 : ((layer / 4) | 0);
        if (rad > 3) rad = 3;
        for (let dx = -rad; dx <= rad; dx++)
          for (let dz = -rad; dz <= rad; dz++) {
            if (dx === 0 && dz === 0) continue;
            if (Math.abs(dx) + Math.abs(dz) > rad + 1) continue;
            set(x + dx, y + dy, z + dz, B.LEAVES_SPRUCE);
          }
      }
      set(x, y + th + 1, z, B.LEAVES_SPRUCE);
    }
    function jungleTree(x, y, z, r) {
      const th = 8 + ((r * 8) | 0);
      for (let i = 0; i < th; i++) {
        set(x, y + i, z, B.LOG, true);
        if (th > 12) { set(x + 1, y + i, z, B.LOG, true); set(x, y + i, z + 1, B.LOG, true); set(x + 1, y + i, z + 1, B.LOG, true); }
      }
      const top = y + th;
      for (let dy = -1; dy <= 2; dy++) {
        const rad = dy === 2 ? 1 : 3;
        for (let dx = -rad; dx <= rad; dx++)
          for (let dz = -rad; dz <= rad; dz++) {
            if (dx * dx + dz * dz > rad * rad + 1) continue;
            set(x + dx, top + dy, z + dz, B.LEAVES);
          }
      }
    }
    function swampTree(x, y, z, r) {
      const th = 5 + ((r * 2) | 0);
      for (let i = 0; i < th; i++) set(x, y + i, z, B.LOG, true);
      const top = y + th;
      for (let dy = -2; dy <= 0; dy++)
        for (let dx = -3; dx <= 3; dx++)
          for (let dz = -3; dz <= 3; dz++) {
            if (dx * dx + dz * dz > 9) continue;
            if (dx === 0 && dz === 0 && dy < 0) continue;
            set(x + dx, top + dy, z + dz, B.LEAVES);
          }
    }
    const TREE_FN = [oakTree, birchTree, spruceTree, jungleTree, swampTree];

    for (let z = 0; z < CH_Z; z++) {
      for (let x = 0; x < CH_X; x++) {
        const ai = z * CH_X + x;
        const bd = BIOME_DATA[biomes[ai]];
        const wx = ox + x, wz = oz + z;
        const top = heights[ai];
        if (top < 1 || top >= CH_Y - 20) continue;
        const surface = blocks[idx(x, top, z)];
        const above = top + 1 < CH_Y ? blocks[idx(x, top + 1, z)] : B.AIR;
        if (above !== B.AIR) continue;   // sous l'eau / obstrué
        const isSoil = surface === B.GRASS || surface === B.SNOW_GRASS || surface === B.PODZOL;
        const isSand = surface === B.SAND || surface === B.RED_SAND;

        const r1 = N.hash3(wx, 1, wz, this.seed + 401);
        const r2 = N.hash3(wx, 2, wz, this.seed + 409);
        const r3 = N.hash3(wx, 3, wz, this.seed + 419);

        // arbres
        if (bd.trees && isSoil && r1 < bd.trees) {
          // espacement minimal : évite les forêts « bouillie »
          if (N.hash3(wx >> 1, 0, wz >> 1, this.seed + 421) < 0.62) {
            TREE_FN[bd.treeType || 0](x, top + 1, z, r2);
            continue;
          }
        }
        // cactus
        if (bd.cactus && isSand && r1 < bd.cactus) {
          const ch = 1 + ((r2 * 3) | 0);
          for (let i = 0; i < ch; i++) set(x, top + 1 + i, z, B.CACTUS, true);
          continue;
        }
        // buissons morts
        if (bd.deadbush && isSand && r1 < bd.cactus + bd.deadbush) { set(x, top + 1, z, B.DEADBUSH, true); continue; }
        // champignons
        if (bd.mushroom && isSoil && r1 < bd.mushroom) {
          set(x, top + 1, z, r3 < 0.5 ? B.MUSHROOM_RED : B.MUSHROOM_BROWN, true); continue;
        }
        // fleurs
        if (bd.flowers && isSoil && r1 < bd.trees + bd.flowers) {
          set(x, top + 1, z, r3 < 0.5 ? B.FLOWER_RED : B.FLOWER_YELLOW, true); continue;
        }
        // herbes hautes
        if (bd.grassDensity && isSoil && r1 < bd.trees + (bd.flowers || 0) + bd.grassDensity) {
          set(x, top + 1, z, B.TALLGRASS, true); continue;
        }
        // canne à sucre au bord de l'eau
        if (isSand && top >= SEA_LEVEL - 1 && top <= SEA_LEVEL + 1 && r1 < 0.10) {
          let nearWater = false;
          for (let d = 0; d < 4; d++) {
            const dx = [1, -1, 0, 0][d], dz = [0, 0, 1, -1][d];
            const nb = get(x + dx, top, z + dz);
            if (nb === B.WATER) { nearWater = true; break; }
          }
          if (nearWater) {
            const sh = 1 + ((r2 * 3) | 0);
            for (let i = 0; i < sh; i++) set(x, top + 1 + i, z, B.SUGARCANE, true);
          }
          continue;
        }
        // couche de neige sur les biomes froids
        if (bd.snow && (isSoil || surface === B.STONE) && top > SEA_LEVEL) {
          if (surface === B.STONE) set(x, top, z, B.SNOW, true);
        }
        // citrouilles rares
        if (isSoil && r1 > 0.9985) set(x, top + 1, z, B.PUMPKIN, true);
      }
    }
    return spill;
  };

  root.VCGen = { WorldGenerator, BIOME, BIOME_DATA };
})(typeof self !== 'undefined' ? self : this);
