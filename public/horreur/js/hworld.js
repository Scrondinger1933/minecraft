/* ===========================================================================
 * L'ARÈNE ÉTEINTE — monde procédural : la Maison des Arènes
 *
 * Une tour octogonale de sept niveaux posée dans des ruines nocturnes :
 *   L-1 (crypte) · L0 (grand hall) · L1..L4 (arènes) · L5 (toiture, ciel).
 * Chaque niveau est joint au suivant par une poche d'escalier droite
 * (rampe trapézoïdale de sept marches contre le mur sud), scellée par un
 * SCEAU au goulotte du plancher supérieur. La crypte n'est pas jointe au
 * toit : elle l'est au hall par la même poche, sceau à quatre badges.
 *
 * Publie l'objet global : HW. Aucune dépendance externe.
 * ========================================================================= */
(function () {
  'use strict';

  var API = {};
  globalThis.HW = API;

  /* ------------------------------------------------------------ dimensions */
  var W = 96, H = 96, D = 96;
  var CX = 48, CZ = 48;                 /* centre de la tour                */
  var TOWER_R = 13.4;                   /* rayon extérieur (norme octog.)  */
  API.W = W; API.H = H; API.D = D; API.CX = CX; API.CZ = CZ;
  API.CRYPT_Y = 16; API.HALL_Y = 24; API.ROOF_Y = 64;

  API.B = {
    AIR: 0, STONE: 1, STONE_CRACK: 2, STONE_MOSS: 3, FLOOR: 4, FLOOR_CRACK: 5,
    WOOD: 6, WOOD_DARK: 7, STATUE: 8, ALTAR: 9, SCEAU: 10, TORCH: 11,
    BONE: 12, BLOOD: 13, DIRT: 14, GRASS_DEAD: 15, TREE_DEAD: 16,
    MURAL: 17, DOOR_WOOD: 18, FLESH: 19, GRAVE: 20, CANDLE: 21,
    BATTLEMENT: 22, RUBBLE: 23
  };

  /* t: tile d'atlas · e: émissif · solid/opaque: pour collision & maillage. */
  API.BLOCK_DEF = [
    { t: -1,            e: 0.00, solid: false, opaque: false },  /* AIR        */
    { t: 0,             e: 0.00, solid: true,  opaque: true  },  /* STONE      */
    { t: 1,             e: 0.00, solid: true,  opaque: true  },  /* STONE_CRACK*/
    { t: 2,             e: 0.00, solid: true,  opaque: true  },  /* STONE_MOSS */
    { t: 3,             e: 0.00, solid: true,  opaque: true  },  /* FLOOR      */
    { t: 4,             e: 0.00, solid: true,  opaque: true  },  /* FLOOR_CRACK*/
    { t: 5,             e: 0.00, solid: true,  opaque: true  },  /* WOOD       */
    { t: 6,             e: 0.00, solid: true,  opaque: true  },  /* WOOD_DARK  */
    { t: 7,             e: 0.05, solid: true,  opaque: true  },  /* STATUE     */
    { t: 8,             e: 0.10, solid: true,  opaque: true  },  /* ALTAR      */
    { t: 9,             e: 0.50, solid: true,  opaque: true  },  /* SCEAU      */
    { t: 10,            e: 1.60, solid: false, opaque: false },  /* TORCH      */
    { t: 11,            e: 0.02, solid: true,  opaque: true  },  /* BONE       */
    { t: 12,            e: 0.00, solid: true,  opaque: true  },  /* BLOOD      */
    { t: 13,            e: 0.00, solid: true,  opaque: true  },  /* DIRT       */
    { t: 14,            e: 0.00, solid: true,  opaque: true  },  /* GRASS_DEAD */
    { t: 15,            e: 0.00, solid: true,  opaque: true  },  /* TREE_DEAD  */
    { t: 16,            e: 0.12, solid: true,  opaque: true  },  /* MURAL      */
    { t: 17,            e: 0.00, solid: true,  opaque: true  },  /* DOOR_WOOD  */
    { t: 18,            e: 0.04, solid: true,  opaque: true  },  /* FLESH      */
    { t: 19,            e: 0.00, solid: true,  opaque: true  },  /* GRAVE      */
    { t: 20,            e: 0.25, solid: false, opaque: false },  /* CANDLE     */
    { t: 21,            e: 0.00, solid: true,  opaque: true  },  /* BATTLEMENT */
    { t: 22,            e: 0.00, solid: true,  opaque: true  }   /* RUBBLE     */
  ];

  var blocks = new Uint8Array(W * H * D);
  API.blocks = blocks;

  var CHX = 16, CHY = 8, CHZ = 16;
  var NCX = W / CHX, NCY = H / CHY, NCZ = D / CHZ;

  API.get = function (x, y, z) {
    if (x < 0 || x >= W || y < 0 || y >= H || z < 0 || z >= D) return API.B.AIR;
    return blocks[x + z * W + y * W * D];
  };

  API.solidAt = function (x, y, z) {
    var b = API.get(Math.floor(x), Math.floor(y), Math.floor(z));
    return API.BLOCK_DEF[b].solid;
  };

  API.opaqueAt = function (x, y, z) {
    if (x < 0 || x >= W || y < 0 || y >= H || z < 0 || z >= D) return false;
    return API.BLOCK_DEF[blocks[x + z * W + y * W * D]].opaque;
  };

  API.set = function (x, y, z, b) {
    if (x < 0 || x >= W || y < 0 || y >= H || z < 0 || z >= D) return;
    if (blocks[x + z * W + y * W * D] === b) return;
    blocks[x + z * W + y * W * D] = b;
    if (API.onBlockChanged) API.onBlockChanged(x, y, z);
  };

  API.rebuildCounts = function () {
    API.chunkCount = new Uint32Array(NCX * NCY * NCZ);
    for (var y = 0; y < H; y++) {
      for (var z = 0; z < D; z++) {
        var rowBase = z * W + y * W * D;
        for (var x = 0; x < W; x++) {
          var b = blocks[rowBase + x];
          if (!API.BLOCK_DEF[b].solid) continue;
          var ci = ((x / CHX) | 0) + ((z / CHZ) | 0) * NCX + ((y / CHY) | 0) * NCX * NCZ;
          API.chunkCount[ci]++;
        }
      }
    }
  };

  API.chunkSolid = function (cx, cy, cz) {
    if (cx < 0 || cy < 0 || cz < 0 || cx >= NCX || cy >= NCY || cz >= NCZ) return 0;
    return API.chunkCount[cx + cz * NCX + cy * NCX * NCZ];
  };

  /* -------------------------------------------------- géométrie octogonale */
  function octoDist(ax, az) {
    ax = Math.abs(ax); az = Math.abs(az);
    return Math.max(Math.max(ax, az), 0.70710678 * (ax + az));
  }

  API.levelBase = function (lvl) { return 24 + 8 * lvl; };
  API.floorSurface = function (lvl) { return 24 + 8 * lvl + 1; };

  API.levelOf = function (y) {
    if (y < 24) return -1;
    return Math.min(Math.floor((y - 24) / 8), 5);
  };

  /* donne le surface (y pouvoir marcher) d'un (x,z) dans la tour */
  API.levelRadius = function (x, z) { return octoDist(x - CX, z - CZ); };

  function fillBox(x0, y0, z0, x1, y1, z1, b) {
    for (var y = y0; y <= y1; y++)
      for (var z = z0; z <= z1; z++)
        for (var x = x0; x <= x1; x++) blocks[x + z * W + y * W * D] = b;
  }

  /* ------------------------------------------------- collections d'objets — */
  API.lamps = [];       /* {x,y,z,rad,gl,color,phase,flicker} */
  API.hideSpots = [];   /* rideaux-cachettes {x,y,z} */
  API.candles = [];     /* bougies d'épreuve {x,y,z,lit,arena} */
  API.murals = [];      /* fresques lisibles {x,y,z,text} */
  API.graves = [];      /* pierres tombales extérieures {x,y,z} */
  API.arenas = [];      /* {lvl,base,state,trial,candles:[key], altarPos} */
  API.roofAltar = null;
  API.spawn = null;

  /* ---------------------------------------------------------------- init --- */
  API.init = function (seed) {
    API.seed = seed >>> 0;
    var n = globalThis.HNoise;
    var rnd = n.mulberry32(API.seed);
    blocks.fill(0);
    API.lamps.length = 0; API.hideSpots.length = 0; API.candles.length = 0;
    API.murals.length = 0; API.graves.length = 0; API.arenas.length = 0;
    sigils.length = 0;

    /* ------- phase 0 : socle enterré jusqu'à y=22 (terre solide) --------- */
    fillBox(0, 0, 0, W - 1, 22, D - 1, API.B.STONE);

    /* ------- phase 1 : volume brutal de la tour (y 16..71) --------------- */
    for (var y = 16; y < 72; y++) {
      for (var z = Math.max(0, CZ - 15); z <= Math.min(D - 1, CZ + 15); z++) {
        for (var x = Math.max(0, CX - 15); x <= Math.min(W - 1, CX + 15); x++) {
          if (octoDist(x - CX, z - CZ) <= TOWER_R + 0.4) blocks[x + z * W + y * W * D] = API.B.STONE;
        }
      }
    }

    /* ------- phase 2 : creuser les intérieurs, 7 niveaux ----------------- */
    for (var lvl = -1; lvl <= 5; lvl++) {
      var base = API.levelBase(lvl);
      if (lvl >= 0 && lvl <= 4) {
        /* dalle propre au niveau */
        for (var z1 = CZ - 15; z1 <= CZ + 15; z1++)
          for (var x1 = CX - 15; x1 <= CX + 15; x1++)
            if (octoDist(x1 - CX, z1 - CZ) <= TOWER_R + 0.4) blocks[x1 + z1 * W + base * W * D] = API.B.STONE;
      }
      /* vide intérieur sous le toit du niveau (crypte : 17..23 ; hall : 25..31) */
      var topY = (lvl === 5) ? 66 : base + 7;
      for (var y2 = base + 1; y2 <= topY; y2++) {
        for (var z2 = Math.max(0, CZ - 15); z2 <= Math.min(D - 1, CZ + 15); z2++) {
          for (var x2 = Math.max(0, CX - 15); x2 <= Math.min(W - 1, CX + 15); x2++) {
            if (octoDist(x2 - CX, z2 - CZ) <= TOWER_R - 1.7) blocks[x2 + z2 * W + y2 * W * D] = API.B.AIR;
          }
        }
      }
    }

    /* ------- phase 3 : sols internes patinés, murs fissurés --------------- */
    for (var y3 = 16; y3 < 72; y3++) {
      for (var z3 = 0; z3 < D; z3++) {
        for (var x3 = 0; x3 < W; x3++) {
          var b = blocks[x3 + z3 * W + y3 * W * D];
          if (b !== API.B.STONE) continue;
          var vn = n.fbm3(x3 * 0.13, y3 * 0.11, z3 * 0.13, API.seed, 3);
          var towerInside = octoDist(x3 - CX, z3 - CZ) <= TOWER_R + 0.4;
          if (!towerInside) continue;
          var isSlab = (y3 === 16 || y3 === 24 || y3 === 32 || y3 === 40 || y3 === 48 || y3 === 56 || y3 === 64);
          var interiorFloor = isSlab && octoDist(x3 - CX, z3 - CZ) <= TOWER_R - 1.7 && y3 < 64;
          if (interiorFloor) {
            blocks[x3 + z3 * W + y3 * W * D] = (vn > 0.30) ? API.B.FLOOR_CRACK : API.B.FLOOR;
          } else if (!isSlab && vn > 0.46) {
            blocks[x3 + z3 * W + y3 * W * D] = API.B.STONE_CRACK;
          }
        }
      }
    }

    /* ------- phase 4 : poches d'escalier + sceaux ------------------------ */
    sigils = [];
    for (var p = 0; p <= 5; p++) buildPocket(p);

    /* ------- phase 5 : aménagement par niveau --------------------------- */
    buildHall();
    buildArena(1, 'main');      /* La Main Blanche                      */
    buildArena(2, 'os');        /* Le Garde d'Os                        */
    buildArena(3, 'souffle');   /* Le Souffle & son Ombre               */
    buildArena(4, 'noir');      /* La Nuit Métronomique                 */
    buildRoof();
    buildCrypt();
    buildExterior(rnd);

    API.rebuildCounts();
    API.spawn = { x: CX + 0.5, y: API.HALL_Y + 1.6, z: CZ - 7.5 };
    return API;
  };

  /* ------------------------------------------------- poches d'escalier ----
   * pocket(l) relie le niveau (l−1) au niveau l : rampe droite de 7 marches
   * (montée de +1 par marche, franchissement auto par la physique), sur le
   * flanc sud intérieur. Le goulotte au plancher du niveau l est scellé
   * d'un SCEAU de 2×3 blocs.                                            */
  var sigils = [];
  API.sigils = sigils;

  function sigilCellsOf(l) {
    var ySlab = API.levelBase(l);
    var cells = [];
    if (l % 2 === 0) {
      /* sud : les 4 dernières marches traversent la dalle du niveau l      */
      for (var x = CX + 1; x <= CX + 4; x++)
        for (var z = CZ + 10; z <= CZ + 11; z++) cells.push([x, ySlab, z]);
    } else {
      /* ouest : idem, direction +z                                         */
      for (var z = CZ + 1; z <= CZ + 4; z++)
        for (var x = CX - 11; x <= CX - 10; x++) cells.push([x, ySlab, z]);
    }
    return cells;
  }
  API.sigilsOf = sigilCellsOf;

  function buildPocket(l) {
    var B = API.B;
    var baseDown = API.levelBase(l - 1);
    var cells = sigilCellsOf(l);
    /* poches alternées : paires au sud (x avance), impaires à l'ouest
     * (z avance) — la colonne d'arrivée d'une poche est toujours dégagée. */
    var even = (l % 2 === 0);
    for (var k = 0; k <= 7; k++) {
      var topStep = baseDown + 1 + k;
      for (var j = 0; j <= 1; j++) {
        var x0 = even ? (CX - 3 + k) : (CX - 11 + j);
        var z0 = even ? (CZ + 10 + j) : (CZ - 3 + k);
        for (var yy = baseDown + 1; yy <= topStep; yy++) {
          API.set(x0, yy, z0, (k === 0 ? B.WOOD : B.STONE));
        }
      }
    }
    /* sceau : remplace la rangée plancher au goulotte (ferme la vis) */
    for (var i = 0; i < cells.length; i++) {
      API.set(cells[i][0], cells[i][1], cells[i][2], B.SCEAU);
    }
    sigils[l] = true;
  }

  /* Sceaux : programmés à l'ouverture par hstory via setSigil. */
  API.placeSigils = function () {
    for (var l = 0; l <= 5; l++) {
      var cells = sigilCellsOf(l);
      for (var i = 0; i < cells.length; i++) {
        API.set(cells[i][0], cells[i][1], cells[i][2], API.B.SCEAU);
      }
      sigils[l] = true;
    }
  };

  API.setSigil = function (l, open) {
    var cells = sigilCellsOf(l);
    var b = open ? API.B.AIR : API.B.SCEAU;
    for (var i = 0; i < cells.length; i++) API.set(cells[i][0], cells[i][1], cells[i][2], b);
    if (sigils[l] !== undefined) sigils[l] = !open;
  };

  API.sigilOpen = function (l) { return sigils[l] === false; };

  /* ---------------------------------------------------------- grand hall --- */
  function buildHall() {
    var B = API.B, base = API.levelBase(0);
    /* socle central orné */
    fillBox(CX - 2, base + 1, CZ - 2, CX + 2, base + 1, CZ + 2, B.ALTAR);
    fillBox(CX - 1, base + 2, CZ - 1, CX + 1, base + 2, CZ + 1, B.STATUE);
    /* fresques murales nord et sud */
    placeMural(base + 3, CX - 8, CZ, 0, 0, "Ils sont entrés huit. Ils ne sont ressortis qu'un.");
    placeMural(base + 3, CX + 8, CZ, 0, 0, 'Huit arènes, huit sceaux,\n et le gardien de l\'aube.');
    /* rideaux-cachettes à quatre ventes */
    var spots = [[CX - 7, CZ - 7], [CX + 7, CZ - 7], [CX - 7, CZ + 7], [CX + 7, CZ + 7]];
    for (var i = 0; i < spots.length; i++) {
      var hx = spots[i][0], hz = spots[i][1];
      API.set(hx, base + 1, hz, B.DOOR_WOOD);
      API.set(hx, base + 2, hz, B.WOOD_DARK);
      API.hideSpots.push({ x: hx, y: base + 1, z: hz });
    }
    /* torches basses éternelles du hall */
    for (var t = 0; t < 8; t++) {
      var a = t * (Math.PI / 4) + Math.PI / 8;
      var lx = Math.round(CX + 9.5 * Math.cos(a)), lz = Math.round(CZ + 9.5 * Math.sin(a));
      API.set(lx, base + 2, lz, B.TORCH);
      API.lamps.push({ x: lx + 0.5, y: base + 2.9, z: lz + 0.5, rad: 10, gl: 0.85,
                       color: [1.0, 0.65, 0.30], phase: (t * 3.1) % 100, flicker: 1 });
    }
  }

  function placeMural(y, x, z, sx, sz, text) {
    API.set(x, y, z, API.B.MURAL);
    API.murals.push({ x: x, y: y, z: z, text: text });
  }

  /* -------------------------------------------------------------- arènes --- */
  function buildArena(lvl, kind) {
    var B = API.B, base = API.levelBase(lvl);
    var arena = {
      lvl: lvl, base: base, kind: kind, state: 'sealed',
      candlesPos: [], altar: { x: CX, y: base + 2, z: CZ },
      spawn: { x: CX, y: base + 2.5, z: CZ - 3.5 }
    };
    /* estrade centrale (3×3 haut 2) + autel au sommet */
    for (var dx = -2; dx <= 2; dx++) {
      for (var dz = -2; dz <= 2; dz++) {
        for (var dy = 1; dy <= 2; dy++) {
          var x = CX + dx, z = CZ + dz, y = base + dy;
          var acc = Math.abs(dx) + Math.abs(dz);
          if (dy === 1 && acc <= 3) API.set(x, y, z, B.ALTAR);
          if (dy === 2 && acc <= 2) API.set(x, y, z, B.ALTAR);
        }
      }
    }
    /* marches d'accès nord et sud de l'estrade */
    for (var d = 3; d <= 4; d++) {
      API.set(CX, base + 1, CZ - d, B.ALTAR);
      API.set(CX, base + 1, CZ + d, B.ALTAR);
    }
    /* autel rituel au sommet (une dalle émissif discrète) */
    API.set(CX, base + 2, CZ, B.ALTAR);

    /* tribunes : couronne de bancs bois r9..r10, percées aux 4 points card. */
    for (var s = 0; s < 48; s++) {
      var a1 = s * (2 * Math.PI / 48);
      var card = Math.round(a1 / (Math.PI / 2)) * (Math.PI / 2);
      if (Math.abs(a1 - card) < 0.30) continue;             /* allées */
      for (var rr = 9; rr <= 10; rr++) {
        var px = Math.round(CX + rr * Math.cos(a1));
        var pz = Math.round(CZ + rr * Math.sin(a1));
        if (API.get(px, base + 1, pz) === B.AIR) API.set(px, base + 1, pz, B.WOOD);
      }
    }
    /* statues d'angle */
    for (var c = 0; c < 4; c++) {
      var ca = c * (Math.PI / 2) + Math.PI / 4;
      var sx = Math.round(CX + 10.4 * Math.cos(ca));
      var sz = Math.round(CZ + 10.4 * Math.sin(ca));
      fillBox(sx - 1, base + 1, sz - 1, sx + 1, base + 4, sz + 1, B.STATUE);
    }
    /* quatre bougies de l'épreuve aux diagonales proches */
    for (var tc = 0; tc < 4; tc++) {
      var ta = tc * (Math.PI / 2) + Math.PI / 4 + 0.55;
      var tx = Math.round(CX + 7.2 * Math.cos(ta));
      var tz = Math.round(CZ + 7.2 * Math.sin(ta));
      API.set(tx, base + 2, tz, B.CANDLE);
      API.candles.push({ x: tx, y: base + 2, z: tz, lit: false, arena: lvl });
      arena.candlesPos.push([tx, base + 2, tz]);
    }
    arena.candleTotal = 4;
    /* rideaux-cachettes (est et ouest seulement, pour pister les allées N/S) */
    var hides = [[CX - 11, CZ], [CX + 11, CZ]];
    for (var u = 0; u < hides.length; u++) {
      var ucx = hides[u][0], ucz = hides[u][1];
      API.set(ucx, base + 1, ucz, B.DOOR_WOOD);
      API.set(ucx, base + 2, ucz, B.WOOD_DARK);
      API.hideSpots.push({ x: ucx, y: base + 1, z: ucz });
    }
    API.arenas.push(arena);
  }

  /* --------------------------------------------------------------- toit ---- */
  function buildRoof() {
    var B = API.B, base = API.levelBase(5);
    /* dalle intérieure plate (y=64 déjà dalle, surface 65) — ciel ouvert :
     * rien ne couvre au-dessus de 66 (le socle initial s'arrête à 71 aux
     * murs); créneaux :
     */
    for (var y = 65; y <= 67; y++) {
      for (var z = CZ - 15; z <= CZ + 15; z++) {
        for (var x = CX - 15; x <= CX + 15; x++) {
          var d = octoDist(x - CX, z - CZ);
          if (d <= TOWER_R + 0.4 && d > TOWER_R - 1.6) {
            var merlon = ((x + z) % 2 === 0);
            if (merlon || y < 66) API.set(x, y, z, y < 66 ? B.STONE : B.BATTLEMENT);
          } else if (d <= TOWER_R - 1.6 && y >= 66) {
            API.set(x, y, z, B.AIR);
          }
        }
      }
    }
    /* autel du toit (scène finale) */
    fillBox(CX - 1, base + 1, CZ - 1, CX + 1, base + 1, CZ + 1, B.ALTAR);
    API.roofAltar = { x: CX, y: base + 1, z: CZ };
  }

  /* -------------------------------------------------------------- crypte --- */
  function buildCrypt() {
    var B = API.B, base = API.levelBase(-1);
    for (var dz = -9; dz <= 9; dz++) {
      for (var dx = -9; dx <= 9; dx++) {
        if (Math.sqrt(dx * dx + dz * dz) <= 9.2) {
          var f = (dx + dz + 200) % 5 < 2 ? B.FLESH : B.FLOOR_CRACK;
          API.set(CX + dx, base, CZ + dz, f);
        }
      }
    }
    /* dalle d'os et flaque de sang au centre (lit d'Enterré-Vivant) */
    fillBox(CX - 3, base + 1, CZ - 3, CX + 3, base + 1, CZ + 3, B.BONE);
    API.set(CX, base + 1, CZ, B.BLOOD);
    /* ossuaires et piliers de chair */
    for (var i = 0; i < 6; i++) {
      var a = i * (Math.PI / 3);
      var px = Math.round(CX + 6.5 * Math.cos(a)), pz = Math.round(CZ + 6.5 * Math.sin(a));
      fillBox(px, base + 1, pz, px, base + 3, pz, i % 2 ? B.BONE : B.FLESH);
    }
    /* torches de vision (faibles, rougeâtres) */
    for (var t = 0; t < 8; t++) {
      var a2 = t * (Math.PI / 4) + Math.PI / 8;
      var lx = Math.round(CX + 8.2 * Math.cos(a2)), lz = Math.round(CZ + 8.2 * Math.sin(a2));
      API.set(lx, base + 2, lz, B.TORCH);
      API.lamps.push({ x: lx + 0.5, y: base + 2.9, z: lz + 0.5, rad: 8, gl: 0.55,
                       color: [0.9, 0.4, 0.32], phase: (t * 2.4) % 100, flicker: 1 });
    }
    placeMural(base + 4, CX - 9, CZ - 2, 0, 0, 'Il a gagné quatre-vingt-dix fois.\n La quatre-vingt-onzième l\'a détruit.');
  }

  /* ----------------------------------------------------------- extérieur --- */
  function buildExterior(rnd) {
    var B = API.B, n = globalThis.HNoise;
    for (var z = 0; z < D; z++) {
      for (var x = 0; x < W; x++) {
        var d = octoDist(x - CX, z - CZ);
        if (d <= TOWER_R + 0.5) continue;
        var vn = n.fbm3(x * 0.09, 3.7, z * 0.09, API.seed, 3);
        API.set(x, 23, z, (vn > 0.05) ? B.GRASS_DEAD : B.DIRT);
        if (vn > 0.42 && rnd() > 0.80) API.set(x, 24, z, B.RUBBLE);
        if (vn > 0.5 && d > 22 && rnd() > 0.94) {
          var th = 3 + (rnd() * 3 | 0);
          for (var ty = 24; ty < 24 + th; ty++) API.set(x, ty, z, B.TREE_DEAD);
        }
      }
    }
    /* cimetière sud-est */
    for (var g = 0; g < 22; g++) {
      var gx = CX + 16 + (rnd() * 22 | 0), gz = CZ + 3 + (rnd() * 26 | 0);
      if (octoDist(gx - CX, gz - CZ) < 18) continue;
      API.set(gx, 24, gz, B.GRAVE);
      API.graves.push({ x: gx, y: 24, z: gz });
    }
    /* colonnes ruinées en anneau */
    for (var p2 = 0; p2 < 10; p2++) {
      var pa = p2 * (2 * Math.PI / 10) + Math.PI / 10;
      var px2 = Math.round(CX + 19 * Math.cos(pa)), pz2 = Math.round(CZ + 19 * Math.sin(pa));
      var hh = 2 + (rnd() * 4 | 0);
      fillBox(px2, 24, pz2, px2, 24 + hh, pz2, B.STONE_CRACK);
    }
    /* butte d'accès devant le portail sud de la tour */
    fillBox(CX - 2, 24, CZ + 12, CX + 2, 24, CZ + 13, B.STONE);
  }
})();
