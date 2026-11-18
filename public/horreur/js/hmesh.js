/* ===========================================================================
 * L'ARÈNE ÉTEINTE — maillage de chunks (élision de faces + AO par sommet)
 *
 * Chunks 16×8×16. Une face n'est émise que si son voisin n'est pas opaque —
 * l'intérieur de la tour est ainsi invisible et gratuit. Chaque sommet porte
 * (x,y,z · u,v · ao · em). Le basculement de la diagonale (flip) évite
 * l'anisotropie de l'occlusion ambiante. Un chunk souillé est maillé dans
 * une file bornée par budget (pas de freeze quand un sceau se dissout).
 *
 * Publie l'objet global : HM. Dépend de HW.
 * ========================================================================= */
(function () {
  'use strict';

  var API = {};
  globalThis.HM = API;
  var CHX = 16, CHY = 8, CHZ = 16;
  API.CHX = CHX; API.CHY = CHY; API.CHZ = CHZ;
  API.NCX = HW.W / CHX; API.NCY = HW.H / CHY; API.NCZ = HW.D / CHZ;

  API.chunks = [];      /* {posArr,count,dirty,empty} par id de chunk   */
  var dirtyQueue = [];

  function ci(x, y, z) { return x + z * API.NCX + y * API.NCX * API.NCZ; }

  API.init = function () {
    API.chunks = [];
    dirtyQueue = [];
    for (var cy = 0; cy < API.NCY; cy++)
      for (var cz = 0; cz < API.NCZ; cz++)
        for (var cx = 0; cx < API.NCX; cx++)
          API.chunks[ci(cx, cy, cz)] = { posArr: null, count: 0, dirty: true, id: ci(cx, cy, cz) };
    /* file initiale : seuls les chunks non vides au sens du compteur */
    for (var i = 0; i < API.chunks.length; i++) {
      var c = API.chunks[i];
      var cx2 = i % API.NCX, cz2 = ((i / API.NCX) | 0) % API.NCZ, cy2 = (i / (API.NCX * API.NCZ)) | 0;
      if (HW.chunkSolid(cx2, cy2, cz2) > 0) dirtyQueue.push(c.id);
      else c.dirty = false;
    }
  };

  API.markDirty = function (x, y, z) {
    var cx = (x / CHX) | 0, cy = (y / CHY) | 0, cz = (z / CHZ) | 0;
    var ids = [ci(cx, cy, cz)];
    if (x % CHX === 0) ids.push(ci(cx - 1, cy, cz));
    if (x % CHX === CHX - 1) ids.push(ci(cx + 1, cy, cz));
    if (y % CHY === 0) ids.push(ci(cx, cy - 1, cz));
    if (y % CHY === CHY - 1) ids.push(ci(cx, cy + 1, cz));
    if (z % CHZ === 0) ids.push(ci(cx, cy, cz - 1));
    if (z % CHZ === CHZ - 1) ids.push(ci(cx, cy, cz + 1));
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i];
      if (id < 0 || id >= API.chunks.length) continue;
      var c = API.chunks[id];
      if (c && !c.dirty) { c.dirty = true; dirtyQueue.push(id); }
    }
  };

  API.listDirty = function (budget) {
    var out = [];
    while (out.length < (budget || Infinity) && dirtyQueue.length) {
      var id = dirtyQueue.shift();
      var c = API.chunks[id];
      if (c && c.dirty) out.push(id);
    }
    return out;
  };

  API.dirtyCount = function () { return dirtyQueue.length; };

  /* ----------------------------------------------------------- AO locaux --- */
  function aoAt(p1, p2, p3) {
    var s1 = HW.opaqueAt(p1[0], p1[1], p1[2]) ? 1 : 0;
    var s2 = HW.opaqueAt(p2[0], p2[1], p2[2]) ? 1 : 0;
    var cnr = HW.opaqueAt(p3[0], p3[1], p3[2]) ? 1 : 0;
    if (s1 && s2) return 0;
    return 3 - (s1 + s2 + cnr);
  }

  /* Faces : +X, −X, +Y, −Y, +Z, −Z */
  var FACES = [
    { n: [1, 0, 0], v: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]], uv: [[0, 1], [0, 0], [1, 0], [1, 1]] },
    { n: [-1, 0, 0], v: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]], uv: [[0, 1], [0, 0], [1, 0], [1, 1]] },
    { n: [0, 1, 0], v: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]], uv: [[0, 0], [0, 1], [1, 1], [1, 0]] },
    { n: [0, -1, 0], v: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], uv: [[0, 0], [1, 0], [1, 1], [0, 1]] },
    { n: [0, 0, 1], v: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], uv: [[0, 1], [1, 1], [1, 0], [0, 0]] },
    { n: [0, 0, -1], v: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], uv: [[0, 1], [1, 1], [1, 0], [0, 0]] }
  ];

  /* Par face f, sommet vi (0..3) : triplets AO (side1, side2, corner)
   * dérivés directement du sommet : les voisins d'arête et le coin.       */
  var AO_QUAD = null;
  function buildAOQuad() {
    AO_QUAD = [];
    for (var f = 0; f < 6; f++) {
      var face = FACES[f], per = [];
      var other = [];
      for (var d2 = 0; d2 < 3; d2++) if (face.n[d2] === 0) other.push(d2);
      for (var vi = 0; vi < 4; vi++) {
        var vpos = face.v[vi];
        function mk(a, b) {
          var p = [vpos[0], vpos[1], vpos[2]];
          p[other[0]] = a; p[other[1]] = b;
          return [p[0] * 2 - 1, p[1] * 2 - 1, p[2] * 2 - 1];
        }
        /* signes le long des deux axes perpendiculaires à la normale */
        var sa = vpos[other[0]] === 1 ? 1 : -1;
        var sb = vpos[other[1]] === 1 ? 1 : -1;
        per.push([mk(sa, 0), mk(0, sb), mk(sa, sb)]);
      }
      AO_QUAD.push(per);
    }
  }

  function tilesFor(bid) {
    var B = HW.B;
    switch (bid) {
      case B.STONE: return { side: 0, top: 1, bot: 1 };
      case B.STONE_CRACK: return { side: 2, top: 2, bot: 2 };
      case B.STONE_MOSS: return { side: 3, top: 3, bot: 3 };
      case B.FLOOR: return { side: 4, top: 5, bot: 4 };
      case B.FLOOR_CRACK: return { side: 6, top: 7, bot: 6 };
      case B.WOOD: return { side: 8, top: 8, bot: 8 };
      case B.WOOD_DARK: return { side: 9, top: 9, bot: 9 };
      case B.STATUE: return { side: 10, top: 10, bot: 10 };
      case B.ALTAR: return { side: 11, top: 12, bot: 11 };
      case B.SCEAU: return { side: 13, top: 13, bot: 13 };
      case B.TORCH: return { side: 14, top: 14, bot: 14 };
      case B.BONE: return { side: 15, top: 15, bot: 15 };
      case B.BLOOD: return { side: 16, top: 16, bot: 16 };
      case B.DIRT: return { side: 17, top: 17, bot: 17 };
      case B.GRASS_DEAD: return { side: 18, top: 19, bot: 17 };
      case B.TREE_DEAD: return { side: 20, top: 20, bot: 20 };
      case B.MURAL: return { side: 21, top: 21, bot: 21 };
      case B.DOOR_WOOD: return { side: 22, top: 22, bot: 22 };
      case B.FLESH: return { side: 23, top: 23, bot: 23 };
      case B.GRAVE: return { side: 24, top: 24, bot: 24 };
      case B.CANDLE: return { side: 25, top: 25, bot: 25 };
      case B.BATTLEMENT: return { side: 26, top: 26, bot: 26 };
      case B.RUBBLE: return { side: 27, top: 27, bot: 27 };
      default: return { side: 0, top: 0, bot: 0 };
    }
  }
  API.tilesFor = tilesFor;

  var TILE_N = 6;   /* atlas 6 colonnes × 6 rangées ; 28 tiles utilisés */
  API.TILE_N = TILE_N;

  function pushFace(out, f, x, y, z, tile, ao4, em) {
    var face = FACES[f];
    var u0 = (tile % TILE_N) / TILE_N, v0 = Math.floor(tile / TILE_N) / TILE_N;
    var du = 1 / TILE_N, dv = 1 / TILE_N;
    var pad = 0.4 / (TILE_N * 32);   /* demi-pixel d'un atlas 6×6×32px */
    var idxs = [0, 1, 2, 0, 2, 3];
    for (var i = 0; i < 6; i++) {
      var vi = idxs[i];
      var p = face.v[vi];
      out.push(
        x + p[0], y + p[1], z + p[2],
        u0 + pad + face.uv[vi][0] * (du - 2 * pad),
        v0 + pad + face.uv[vi][1] * (dv - 2 * pad),
        ao4[vi] / 3.0,
        em);
    }
  }

  API.buildChunkData = function (cx, cy, cz) {
    if (!AO_QUAD) buildAOQuad();
    var out = [];
    var x0 = cx * CHX, y0 = cy * CHY, z0 = cz * CHZ;
    for (var y = y0; y < y0 + CHY; y++) {
      for (var z = z0; z < z0 + CHZ; z++) {
        for (var x = x0; x < x0 + CHX; x++) {
          var bid = HW.get(x, y, z);
          if (bid === HW.B.AIR) continue;
          var def = HW.BLOCK_DEF[bid];
          var tiles = tilesFor(bid);
          for (var f = 0; f < 6; f++) {
            var nrm = FACES[f].n;
            if (HW.opaqueAt(x + nrm[0], y + nrm[1], z + nrm[2])) continue;
            var ao = [3, 3, 3, 3];
            var quads = AO_QUAD[f];
            for (var vi = 0; vi < 4; vi++) {
              var row = quads[vi];
              ao[vi] = aoAt(
                [x + nrm[0] + row[0][0], y + nrm[1] + row[0][1], z + nrm[2] + row[0][2]],
                [x + nrm[0] + row[1][0], y + nrm[1] + row[1][1], z + nrm[2] + row[1][2]],
                [x + nrm[0] + row[2][0], y + nrm[1] + row[2][1], z + nrm[2] + row[2][2]]);
            }
            var tile = (f === 2) ? tiles.top : (f === 3 ? tiles.bot : tiles.side);
            pushFace(out, f, x, y, z, tile, ao, def.e);
          }
        }
      }
    }
    if (out.length === 0) return null;
    return new Float32Array(out);
  };

  API.stats = { verts: 0, chunkBuilt: 0 };
})();
