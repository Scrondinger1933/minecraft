/* =========================================================================
 *  VOXELCRAFT — Bruit procédural
 *  Perlin amélioré (Ken Perlin 2002) + FBM + ridged + domain warping,
 *  splines de terrain façon 1.18 (continentalité / érosion / peaks-valleys).
 * ========================================================================= */
(function (root) {
  'use strict';

  /* ------------------------------------------------- PRNG : mulberry32 --- */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  /** Hachage entier 32 bits — déterministe, sans état (features aléatoires). */
  function hash3(x, y, z, seed) {
    let h = seed | 0;
    h = Math.imul(h ^ (x | 0), 0x27d4eb2d);
    h = Math.imul(h ^ (y | 0), 0x165667b1);
    h = Math.imul(h ^ (z | 0), 0x9e3779b1);
    h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
  }

  /* --------------------------------------------------------- Perlin 3D --- */
  function Perlin(seed) {
    const rnd = mulberry32(seed);
    const p = new Uint8Array(512);
    const perm = new Uint8Array(256);
    for (let i = 0; i < 256; i++) perm[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = (rnd() * (i + 1)) | 0;
      const t = perm[i]; perm[i] = perm[j]; perm[j] = t;
    }
    for (let i = 0; i < 512; i++) p[i] = perm[i & 255];
    this.p = p;
  }
  function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function grad3(h, x, y, z) {
    switch (h & 15) {
      case 0: return x + y; case 1: return -x + y; case 2: return x - y;
      case 3: return -x - y; case 4: return x + z; case 5: return -x + z;
      case 6: return x - z; case 7: return -x - z; case 8: return y + z;
      case 9: return -y + z; case 10: return y - z; case 11: return -y - z;
      case 12: return x + y; case 13: return -y + z; case 14: return -x + y;
      default: return -y - z;
    }
  }

  Perlin.prototype.noise3 = function (x, y, z) {
    const p = this.p;
    let X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
    x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
    const u = fade(x), v = fade(y), w = fade(z);
    const A = p[X] + Y, AA = p[A] + Z, AB = p[A + 1] + Z;
    const Bb = p[X + 1] + Y, BA = p[Bb] + Z, BB = p[Bb + 1] + Z;
    return lerp(
      lerp(
        lerp(grad3(p[AA], x, y, z), grad3(p[BA], x - 1, y, z), u),
        lerp(grad3(p[AB], x, y - 1, z), grad3(p[BB], x - 1, y - 1, z), u), v),
      lerp(
        lerp(grad3(p[AA + 1], x, y, z - 1), grad3(p[BA + 1], x - 1, y, z - 1), u),
        lerp(grad3(p[AB + 1], x, y - 1, z - 1), grad3(p[BB + 1], x - 1, y - 1, z - 1), u), v),
      w);
  };
  Perlin.prototype.noise2 = function (x, z) { return this.noise3(x, 0.137, z); };

  /* ------------------------------------------------------------- FBM ----- */
  function FBM(seed, octaves, lacunarity, gain) {
    this.oct = [];
    for (let i = 0; i < octaves; i++) this.oct.push(new Perlin(seed + i * 7919));
    this.lac = lacunarity || 2.0;
    this.gain = gain || 0.5;
    // normalisation pour rester dans [-1,1]
    let amp = 1, sum = 0;
    for (let i = 0; i < octaves; i++) { sum += amp; amp *= this.gain; }
    this.norm = 1 / sum;
  }
  FBM.prototype.get2 = function (x, z, freq) {
    let a = 1, f = freq, s = 0;
    for (let i = 0; i < this.oct.length; i++) {
      s += a * this.oct[i].noise2(x * f, z * f);
      a *= this.gain; f *= this.lac;
    }
    return s * this.norm;
  };
  FBM.prototype.get3 = function (x, y, z, freq) {
    let a = 1, f = freq, s = 0;
    for (let i = 0; i < this.oct.length; i++) {
      s += a * this.oct[i].noise3(x * f, y * f, z * f);
      a *= this.gain; f *= this.lac;
    }
    return s * this.norm;
  };
  /** Ridged multifractal — crêtes acérées (montagnes, canyons). */
  FBM.prototype.ridged2 = function (x, z, freq) {
    let a = 1, f = freq, s = 0;
    for (let i = 0; i < this.oct.length; i++) {
      const n = 1 - Math.abs(this.oct[i].noise2(x * f, z * f));
      s += a * n * n;
      a *= this.gain; f *= this.lac;
    }
    return s * this.norm * 2 - 1;
  };

  /* ------------------------------------------------------------ Spline --- */
  /** Interpolation linéaire par morceaux sur des points de contrôle triés. */
  function spline(pts) {
    return function (t) {
      if (t <= pts[0][0]) return pts[0][1];
      const n = pts.length;
      if (t >= pts[n - 1][0]) return pts[n - 1][1];
      for (let i = 1; i < n; i++) {
        if (t <= pts[i][0]) {
          const a = pts[i - 1], b = pts[i];
          const k = (t - a[0]) / (b[0] - a[0]);
          // lissage cubique (smoothstep) pour éviter les cassures visibles
          const s = k * k * (3 - 2 * k);
          return a[1] + (b[1] - a[1]) * s;
        }
      }
      return pts[n - 1][1];
    };
  }

  /* --------------------------------------------------------- Voronoï 2D -- */
  /** Retourne {d1, d2, cellX, cellZ} — utile pour les régions de biomes. */
  function voronoi2(x, z, seed) {
    const cx = Math.floor(x), cz = Math.floor(z);
    let d1 = 1e9, d2 = 1e9, bx = 0, bz = 0;
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const px = cx + i, pz = cz + j;
        const ox = hash3(px, pz, 0, seed);
        const oz = hash3(px, pz, 1, seed);
        const dx = px + ox - x, dz = pz + oz - z;
        const d = dx * dx + dz * dz;
        if (d < d1) { d2 = d1; d1 = d; bx = px; bz = pz; }
        else if (d < d2) { d2 = d; }
      }
    }
    return { d1: Math.sqrt(d1), d2: Math.sqrt(d2), cellX: bx, cellZ: bz };
  }

  root.VCNoise = { mulberry32, hash3, Perlin, FBM, spline, voronoi2, lerp, fade };
})(typeof self !== 'undefined' ? self : this);
