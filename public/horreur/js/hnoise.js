/* ===========================================================================
 * L'ARÈNE ÉTEINTE — module de bruits & aléa déterministe
 * Reprend la grammaire du moteur VOXELCRAFT (public/static/js/noise.js)
 * pour ce mode autonome : Perlin 2002, FBM, ridged, PRNG mulberry32.
 * Publie un objet global : HNoise.
 * ========================================================================= */
(function () {
  'use strict';

  var API = {};

  /* ------------------------------------------------------------- PRNG ---- */
  API.mulberry32 = function (seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  API.fnv1a = function (text) {
    var h = 0x811c9dc5;
    for (var i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  };

  API.hash2 = function (x, y, seed) {
    var h = seed ^ 0x9e3779b9;
    h = Math.imul(h ^ x, 0x85ebca6b);
    h = Math.imul(h ^ y, 0xc2b2ae35);
    h ^= h >>> 13;
    return (h >>> 0) / 4294967296;
  };

  API.hash3 = function (x, y, z, seed) {
    var h = seed ^ 0x9e3779b9;
    h = Math.imul(h ^ x, 0x85ebca6b);
    h = Math.imul(h ^ y, 0xc2b2ae35);
    h = Math.imul(h ^ z, 0x27d4eb2f);
    h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
  };

  var fade = function (t) { return t * t * t * (t * (t * 6 - 15) + 10); };
  var lerp = function (a, b, t) { return a + (b - a) * t; };

  API.lerp = lerp;
  API.clamp = function (v, a, b) { return v < a ? a : (v > b ? b : v); };
  API.smooth = function (v) { return v * v * (3 - 2 * v); };

  /* ----------------------------------------------------- Perlin 3D ------- */
  function grad3(ix, iy, iz, seed) {
    var h = Math.imul(ix, 0x1f1f1f1f) ^ Math.imul(iy, 0x27d4eb2d) ^ Math.imul(iz, 0x1654535b) ^ (seed | 0);
    h ^= h >>> 15;
    /* 12 directions d'arête du cube */
    var u = (h < 8) ? h >>> 1 : 4;
    var v = (h < 4) ? 0 : (h < 12 ? h - 8 : 3);
    var sign = (h & 0x100) ? -1 : 1;
    return { x: u * sign, y: v * sign, z: (2 - u - v) * sign };
  }

  API.perlin3 = function (x, y, z, seed) {
    var X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
    var fx = x - X, fy = y - Y, fz = z - Z;
    var u = fade(fx), v = fade(fy), w = fade(fz);
    function g(ix, iy, iz) {
      var gr = grad3(ix, iy, iz, seed);
      return gr.x * (fx - (ix - X)) + gr.y * (fy - (iy - Y)) + gr.z * (fz - (iz - Z));
    }
    var n000 = g(X, Y, Z),     n100 = g(X + 1, Y, Z);
    var n010 = g(X, Y + 1, Z), n110 = g(X + 1, Y + 1, Z);
    var n001 = g(X, Y, Z + 1), n101 = g(X + 1, Y, Z + 1);
    var n011 = g(X, Y + 1, Z + 1), n111 = g(X + 1, Y + 1, Z + 1);
    return lerp(
      lerp(lerp(n000, n100, u), lerp(n010, n110, u), v),
      lerp(lerp(n001, n101, u), lerp(n011, n111, u), v), w);
  };

  API.fbm3 = function (x, y, z, seed, octaves, lacunarity, gain) {
    var amp = 1, freq = 1, sum = 0, norm = 0;
    for (var i = 0; i < (octaves || 4); i++) {
      sum += amp * API.perlin3(x * freq, y * freq, z * freq, seed + i * 131);
      norm += amp;
      amp *= (gain === undefined ? 0.5 : gain);
      freq *= (lacunarity === undefined ? 2 : lacunarity);
    }
    return sum / norm;
  };

  globalThis.HNoise = API;
})();
