/* =========================================================================
 *  VOXELCRAFT — Éclairage & maillage (exécuté dans un Web Worker)
 *
 *  Éclairage : deux canaux 4 bits (skylight / blocklight) propagés par
 *  parcours en largeur (BFS) sur un volume élargi (chunk + marge d'un chunk),
 *  ce qui garantit la continuité aux frontières sans synchronisation globale.
 *
 *  Maillage  : « greedy-less » par face avec culling voisin, ambient occlusion
 *  de Vaisman (3 voisins par coin) et interpolation bilinéaire de la lumière
 *  aux quatre sommets (smooth lighting). Correction de l'anisotropie du quad
 *  par retournement de diagonale (flip) — évite l'artefact en « escalier ».
 * ========================================================================= */
(function (root) {
  'use strict';
  const V = root.VC;
  const { CH_X, CH_Y, CH_Z, RENDER, TINT } = V;
  const T_OPAQUE = V.T_OPAQUE, T_RENDER = V.T_RENDER, T_LIGHT = V.T_LIGHT,
    T_FILTER = V.T_FILTER, T_LIQUID = V.T_LIQUID, T_CUTOUT = V.T_CUTOUT,
    T_TINT = V.T_TINT, T_TILES = V.T_TILES;
  const B = V.B;

  const MARGIN = 16;                 // 1 chunk de marge : lumière exacte à ±15
  const PX = CH_X + MARGIN * 2;      // 48
  const PZ = CH_Z + MARGIN * 2;      // 48
  const PY = CH_Y;

  function pidx(x, y, z) { return (y * PZ + z) * PX + x; }

  /* ---------------------------------------------------- Buffers réutilisés */
  const padBlocks = new Uint8Array(PX * PY * PZ);
  const padSky = new Uint8Array(PX * PY * PZ);
  const padBlk = new Uint8Array(PX * PY * PZ);
  const queue = new Int32Array(PX * PY * PZ);   // file BFS (indices)
  const heightMap = new Int16Array(PX * PZ);

  /* ================================================== Propagation lumière */
  /**
   * @param maxY hauteur utile (optimisation : on ignore le vide au-dessus)
   */
  function computeLight(maxY) {
    const total = PX * PZ * (maxY + 1);
    padSky.fill(0, 0, PX * PZ * PY);
    padBlk.fill(0, 0, PX * PZ * PY);

    /* ---- 1. Skylight : descente verticale (lumière 15 jusqu'au 1er opaque) */
    let qh = 0, qt = 0;
    for (let z = 0; z < PZ; z++) {
      for (let x = 0; x < PX; x++) {
        let light = 15;
        let hit = -1;
        for (let y = maxY; y >= 0; y--) {
          const i = pidx(x, y, z);
          const b = padBlocks[i];
          const f = T_FILTER[b];
          if (f >= 15) { hit = y; break; }
          if (f > 0) {                       // milieu semi-transparent (eau)
            light -= f;
            if (light < 0) light = 0;
          }
          padSky[i] = light;
          if (light === 0) { hit = y; break; }
        }
        heightMap[z * PX + x] = hit;
        // les colonnes pleinement éclairées alimentent la file BFS
        for (let y = maxY; y > (hit < 0 ? -1 : hit); y--) {
          const i = pidx(x, y, z);
          if (padSky[i] > 1) queue[qt++] = i;
        }
      }
    }

    /* ---- 2. Skylight : diffusion horizontale (BFS) ---- */
    const yStride = PZ * PX;
    while (qh < qt) {
      const i = queue[qh++];
      const l = padSky[i];
      if (l <= 1) continue;
      const y = (i / yStride) | 0;
      const rem = i - y * yStride;
      const z = (rem / PX) | 0;
      const x = rem - z * PX;

      // 6 voisins
      for (let d = 0; d < 6; d++) {
        let nx = x, ny = y, nz = z;
        if (d === 0) nx++; else if (d === 1) nx--;
        else if (d === 2) ny++; else if (d === 3) ny--;
        else if (d === 4) nz++; else nz--;
        if (nx < 0 || nx >= PX || nz < 0 || nz >= PZ || ny < 0 || ny > maxY) continue;
        const ni = pidx(nx, ny, nz);
        const nb = padBlocks[ni];
        const f = T_FILTER[nb];
        if (f >= 15) continue;
        // descente verticale sans perte si déjà à 15
        let nl = (d === 3 && l === 15 && f === 0) ? 15 : l - 1 - f;
        if (nl <= 0) continue;
        if (padSky[ni] < nl) {
          padSky[ni] = nl;
          if (nl > 1) queue[qt++] = ni;
          if (qt >= queue.length) qt = queue.length - 1;
        }
      }
    }

    /* ---- 3. Blocklight : sources puis BFS ---- */
    qh = 0; qt = 0;
    for (let y = 0; y <= maxY; y++) {
      for (let z = 0; z < PZ; z++) {
        const base = (y * PZ + z) * PX;
        for (let x = 0; x < PX; x++) {
          const i = base + x;
          const em = T_LIGHT[padBlocks[i]];
          if (em > 0) { padBlk[i] = em; queue[qt++] = i; }
        }
      }
    }
    while (qh < qt) {
      const i = queue[qh++];
      const l = padBlk[i];
      if (l <= 1) continue;
      const y = (i / yStride) | 0;
      const rem = i - y * yStride;
      const z = (rem / PX) | 0;
      const x = rem - z * PX;
      for (let d = 0; d < 6; d++) {
        let nx = x, ny = y, nz = z;
        if (d === 0) nx++; else if (d === 1) nx--;
        else if (d === 2) ny++; else if (d === 3) ny--;
        else if (d === 4) nz++; else nz--;
        if (nx < 0 || nx >= PX || nz < 0 || nz >= PZ || ny < 0 || ny > maxY) continue;
        const ni = pidx(nx, ny, nz);
        const f = T_FILTER[padBlocks[ni]];
        if (f >= 15) continue;
        const nl = l - 1 - (f > 1 ? f - 1 : 0);
        if (nl <= 0) continue;
        if (padBlk[ni] < nl) {
          padBlk[ni] = nl;
          if (nl > 1 && qt < queue.length - 1) queue[qt++] = ni;
        }
      }
    }
  }

  /* ================================================== Géométrie des faces */
  // Ordre des faces : +X, -X, +Y, -Y, +Z, -Z
  const FACE_DIR = [
    [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]
  ];
  // 4 sommets par face (ordre anti-horaire vu de l'extérieur), coord locales 0..1
  const FACE_VERT = [
    // +X
    [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]],
    // -X
    [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]],
    // +Y
    [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]],
    // -Y
    [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],
    // +Z
    [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]],
    // -Z
    [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]]
  ];
  // UV par sommet (u,v) — v inversé pour l'atlas
  const FACE_UV = [
    [[0, 1], [1, 1], [1, 0], [0, 0]],
    [[0, 1], [1, 1], [1, 0], [0, 0]],
    [[0, 1], [1, 1], [1, 0], [0, 0]],
    [[0, 1], [1, 1], [1, 0], [0, 0]],
    [[0, 1], [1, 1], [1, 0], [0, 0]],
    [[0, 1], [1, 1], [1, 0], [0, 0]]
  ];
  // Pour l'AO : pour chaque face et chaque sommet, les 3 voisins (side1, side2, corner)
  // exprimés en offsets relatifs au voxel adjacent à la face.
  const AO_OFF = buildAOOffsets();
  function buildAOOffsets() {
    const res = [];
    for (let f = 0; f < 6; f++) {
      const [dx, dy, dz] = FACE_DIR[f];
      const verts = FACE_VERT[f];
      const perFace = [];
      for (let v = 0; v < 4; v++) {
        // position du sommet en unités -1/+1 autour du centre de la face
        const vx = verts[v][0] * 2 - 1;
        const vy = verts[v][1] * 2 - 1;
        const vz = verts[v][2] * 2 - 1;
        // axes tangents = les composantes non nulles de la normale exclues
        const t1 = (dx !== 0) ? [0, vy, 0] : [vx, 0, 0];
        const t2 = (dz !== 0) ? [vx, 0, 0] : [0, 0, vz];
        // normalisation : garder seulement les axes ≠ normale
        let a1, a2;
        if (dx !== 0) { a1 = [0, vy, 0]; a2 = [0, 0, vz]; }
        else if (dy !== 0) { a1 = [vx, 0, 0]; a2 = [0, 0, vz]; }
        else { a1 = [vx, 0, 0]; a2 = [0, vy, 0]; }
        perFace.push([
          [dx + a1[0], dy + a1[1], dz + a1[2]],
          [dx + a2[0], dy + a2[1], dz + a2[2]],
          [dx + a1[0] + a2[0], dy + a1[1] + a2[1], dz + a1[2] + a2[2]]
        ]);
      }
      res.push(perFace);
    }
    return res;
  }

  const AO_TABLE = [1.0, 0.78, 0.58, 0.42];  // 0..3 occluders
  // Assombrissement directionnel (« fake normal shading » type Minecraft)
  const FACE_SHADE = [0.80, 0.80, 1.00, 0.55, 0.68, 0.68];

  /* --------------------------------------------- Constructeur de tampon -- */
  function MeshBuf() {
    this.pos = []; this.uv = []; this.lgt = []; this.tnt = []; this.idx = [];
    this.n = 0;
  }
  MeshBuf.prototype.push = function (x, y, z, u, v, sky, blk, ao, r, g, b) {
    this.pos.push(x, y, z); this.uv.push(u, v);
    this.lgt.push(sky, blk, ao); this.tnt.push(r, g, b);
    return this.n++;
  };
  MeshBuf.prototype.quad = function (flip) {
    const n = this.n;
    const a = n - 4, b = n - 3, c = n - 2, d = n - 1;
    if (flip) this.idx.push(a, b, c, a, c, d);
    else this.idx.push(b, c, d, b, d, a);
  };
  MeshBuf.prototype.toTransfer = function () {
    return {
      pos: new Float32Array(this.pos),
      uv: new Float32Array(this.uv),
      lgt: new Float32Array(this.lgt),
      tnt: new Float32Array(this.tnt),
      idx: (this.n > 65535 ? new Uint32Array(this.idx) : new Uint16Array(this.idx)),
      count: this.idx.length,
      big: this.n > 65535
    };
  };

  const ATLAS = V.ATLAS_COLS;
  const TILE_PAD = 0.0015;   // marge anti-bleeding entre tuiles

  function tileUV(tile, u, v) {
    const tx = tile % ATLAS, ty = (tile / ATLAS) | 0;
    const s = 1 / ATLAS;
    const uu = (tx + TILE_PAD + u * (1 - 2 * TILE_PAD)) * s;
    const vv = (ty + TILE_PAD + v * (1 - 2 * TILE_PAD)) * s;
    return [uu, vv];
  }

  /* ================================================ Maillage d'un chunk == */
  /**
   * @param neighbors objet {"dx,dz": Uint8Array} incluant "0,0"
   * @param biomeMap Uint8Array 16×16 du chunk central
   * @param biomeColors {grass:[r,g,b], foliage:[..], water:[..]} par id de biome
   */
  function meshChunk(cx, cz, neighbors, biomeMap, biomeColors, maxHeight) {
    /* ---- assemblage du volume élargi ---- */
    padBlocks.fill(0);
    let maxY = Math.min(CH_Y - 1, (maxHeight | 0) + 2);
    if (maxY < 20) maxY = 20;

    for (let ncz = -1; ncz <= 1; ncz++) {
      for (let ncx = -1; ncx <= 1; ncx++) {
        const src = neighbors[ncx + ',' + ncz];
        if (!src) continue;
        const bx = MARGIN + ncx * CH_X;
        const bz = MARGIN + ncz * CH_Z;
        for (let y = 0; y <= maxY; y++) {
          for (let z = 0; z < CH_Z; z++) {
            const sBase = (y * CH_Z + z) * CH_X;
            const dBase = ((y * PZ) + (bz + z)) * PX + bx;
            for (let x = 0; x < CH_X; x++) padBlocks[dBase + x] = src[sBase + x];
          }
        }
      }
    }

    computeLight(maxY);

    const solid = new MeshBuf();
    const cutout = new MeshBuf();
    const water = new MeshBuf();

    const getB = (x, y, z) => (y < 0 || y >= CH_Y) ? 0 : padBlocks[pidx(x, y, z)];
    const getSky = (x, y, z) => (y < 0 || y >= CH_Y) ? 15 : padSky[pidx(x, y, z)];
    const getBlk = (x, y, z) => (y < 0 || y >= CH_Y) ? 0 : padBlk[pidx(x, y, z)];

    for (let y = 0; y <= maxY; y++) {
      for (let z = 0; z < CH_Z; z++) {
        for (let x = 0; x < CH_X; x++) {
          const px = MARGIN + x, pz = MARGIN + z;
          const id = padBlocks[pidx(px, y, pz)];
          if (id === 0) continue;
          const rt = T_RENDER[id];
          if (rt === RENDER.NONE) continue;

          // couleur de teinte issue du biome
          const bi = biomeMap[z * CH_X + x];
          const tintType = T_TINT[id];
          let tr = 1, tg = 1, tb = 1;
          if (tintType !== TINT.NONE) {
            const bc = biomeColors[bi];
            const c = tintType === TINT.GRASS ? bc.grass
              : tintType === TINT.FOLIAGE ? bc.foliage : bc.water;
            tr = c[0]; tg = c[1]; tb = c[2];
          }

          if (rt === RENDER.CROSS) {
            emitCross(cutout, x, y, z, px, pz, id, tr, tg, tb, getSky, getBlk);
            continue;
          }
          if (rt === RENDER.TORCH) {
            emitTorch(cutout, x, y, z, px, pz, id, getSky, getBlk);
            continue;
          }

          const isLiquid = T_LIQUID[id] === 1;
          const buf = isLiquid ? water : (T_CUTOUT[id] ? cutout : solid);
          const isOpaque = T_OPAQUE[id] === 1;

          // hauteur de la surface du liquide (effet de nappe)
          let topOffset = 0;
          if (isLiquid) {
            const up = getB(px, y + 1, pz);
            if (!T_LIQUID[up]) topOffset = -0.12;
          }

          for (let f = 0; f < 6; f++) {
            const d = FACE_DIR[f];
            const nx = px + d[0], ny = y + d[1], nz = pz + d[2];
            const nb = getB(nx, ny, nz);

            // --- culling ---
            if (isLiquid) {
              if (T_LIQUID[nb] || T_OPAQUE[nb]) continue;
            } else if (isOpaque) {
              if (T_OPAQUE[nb]) continue;
            } else {
              // blocs non opaques : ne pas dessiner entre voisins identiques
              if (nb === id) continue;
              if (T_OPAQUE[nb]) continue;
            }

            const tile = T_TILES[id * 6 + f];
            const shade = FACE_SHADE[f];
            const aoOff = AO_OFF[f];
            const verts = FACE_VERT[f];
            const uvs = FACE_UV[f];

            const vSky = [0, 0, 0, 0], vBlk = [0, 0, 0, 0], vAo = [0, 0, 0, 0];
            for (let v = 0; v < 4; v++) {
              const o = aoOff[v];
              // occlusion
              const s1 = T_OPAQUE[getB(px + o[0][0], y + o[0][1], pz + o[0][2])];
              const s2 = T_OPAQUE[getB(px + o[1][0], y + o[1][1], pz + o[1][2])];
              const co = T_OPAQUE[getB(px + o[2][0], y + o[2][1], pz + o[2][2])];
              const occ = (s1 && s2) ? 3 : (s1 + s2 + co);
              vAo[v] = AO_TABLE[occ] * shade;

              // lumière lissée : moyenne des cellules non opaques du coin
              let sSum = 0, bSum = 0, cnt = 0;
              const cells = [
                [nx, ny, nz],
                [px + o[0][0], y + o[0][1], pz + o[0][2]],
                [px + o[1][0], y + o[1][1], pz + o[1][2]],
                [px + o[2][0], y + o[2][1], pz + o[2][2]]
              ];
              for (let k = 0; k < 4; k++) {
                const c = cells[k];
                if (c[1] < 0 || c[1] >= CH_Y) continue;
                if (T_OPAQUE[getB(c[0], c[1], c[2])]) continue;
                sSum += getSky(c[0], c[1], c[2]);
                bSum += getBlk(c[0], c[1], c[2]);
                cnt++;
              }
              if (cnt === 0) { sSum = getSky(nx, ny, nz); bSum = getBlk(nx, ny, nz); cnt = 1; }
              vSky[v] = (sSum / cnt) / 15;
              vBlk[v] = (bSum / cnt) / 15;
            }

            for (let v = 0; v < 4; v++) {
              const p = verts[v];
              const uv = tileUV(tile, uvs[v][0], uvs[v][1]);
              let vy = y + p[1];
              if (isLiquid && p[1] === 1) vy += topOffset;
              buf.push(x + p[0], vy, z + p[2], uv[0], uv[1],
                vSky[v], vBlk[v], vAo[v], tr, tg, tb);
            }
            // retournement de diagonale si l'AO est anisotrope
            const flip = (vAo[0] + vAo[2]) < (vAo[1] + vAo[3]);
            buf.quad(flip);
          }
        }
      }
    }

    return { solid: solid.toTransfer(), cutout: cutout.toTransfer(), water: water.toTransfer() };
  }

  /* ---- végétation en croix (2 quads diagonaux, double face) ---- */
  function emitCross(buf, x, y, z, px, pz, id, tr, tg, tb, getSky, getBlk) {
    const tile = T_TILES[id * 6 + 2];
    const sky = getSky(px, y, pz) / 15, blk = getBlk(px, y, pz) / 15;
    const k = 0.1464;      // (1 - 1/√2)/2 : inscrit la diagonale dans le cube
    const planes = [
      [[k, 0, k], [1 - k, 0, 1 - k]],
      [[1 - k, 0, k], [k, 0, 1 - k]]
    ];
    for (let p = 0; p < 2; p++) {
      const a = planes[p][0], b = planes[p][1];
      for (let side = 0; side < 2; side++) {
        const A = side ? b : a, Bv = side ? a : b;
        const quadV = [
          [A[0], 0, A[2]], [Bv[0], 0, Bv[2]], [Bv[0], 1, Bv[2]], [A[0], 1, A[2]]
        ];
        const uvv = [[0, 1], [1, 1], [1, 0], [0, 0]];
        for (let v = 0; v < 4; v++) {
          const uv = tileUV(tile, uvv[v][0], uvv[v][1]);
          buf.push(x + quadV[v][0], y + quadV[v][1], z + quadV[v][2],
            uv[0], uv[1], sky, blk, 1.0, tr, tg, tb);
        }
        buf.quad(false);
      }
    }
  }

  /* ---- torche : petit prisme lumineux ---- */
  function emitTorch(buf, x, y, z, px, pz, id, getSky, getBlk) {
    const tile = T_TILES[id * 6 + 2];
    const sky = getSky(px, y, pz) / 15, blk = 1.0;
    const w = 0.0625 * 2, h = 0.625;
    const x0 = 0.5 - w, x1 = 0.5 + w, z0 = 0.5 - w, z1 = 0.5 + w;
    const faces = [
      [[x1, 0, z1], [x1, 0, z0], [x1, h, z0], [x1, h, z1]],
      [[x0, 0, z0], [x0, 0, z1], [x0, h, z1], [x0, h, z0]],
      [[x0, h, z1], [x1, h, z1], [x1, h, z0], [x0, h, z0]],
      [[x0, 0, z1], [x1, 0, z1], [x1, h, z1], [x0, h, z1]],
      [[x1, 0, z0], [x0, 0, z0], [x0, h, z0], [x1, h, z0]]
    ];
    const uvv = [[0.375, 1], [0.625, 1], [0.625, 0.4], [0.375, 0.4]];
    for (let f = 0; f < faces.length; f++) {
      for (let v = 0; v < 4; v++) {
        const uv = tileUV(tile, uvv[v][0], uvv[v][1]);
        buf.push(x + faces[f][v][0], y + faces[f][v][1], z + faces[f][v][2],
          uv[0], uv[1], sky, blk, 1.0, 1, 1, 1);
      }
      buf.quad(false);
    }
  }

  root.VCMesher = { meshChunk, computeLight, MARGIN, PX, PZ, pidx, padSky, padBlk };
})(typeof self !== 'undefined' ? self : this);
