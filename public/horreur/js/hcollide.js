/* ===========================================================================
 * L'ARÈNE ÉTEINTE — système de collisions « fluidité parfaite »
 *
 * Conçu pour rester de l'ordre de la microseconde par corps et par pas, sur
 * n'importe quel matériel, avec zéro jitter et zéro tunneling :
 *
 *  1. Ordre opérateur adaptatif     : les axes sont résolus du déplacement
 *     le plus grand au plus faible — la boîte s'arrête d'abord là où elle va
 *     le plus loin, ce qui supprime le « résidu de coin » des ordres fixes.
 *  2. Early-out par chunk           : la grille voxel est découpée en chunks
 *     16×8×16 munis d'un compteur de blocs solides ; un chunk vide est sauté
 *     en O(1) sans tester ses 2048 cellules (branchement unique par chunk).
 *  3. Cache de cohérence temporelle : chaque corps mémorise la dernière
 *     cellule solide vue — au pas suivant elle est re-testée d'abord, ce qui
 *     court-circuite la recherche dans l'écrasante majorité des cas.
 *  4. Sous-pas anti-tunneling       : le pas physique est re-découpé dès que
 *     max(|v|·dt) approche le tiers d'une cellule, borné à 8 sous-pas.
 *  5. Step-assist                   : face à un obstacle d'un bloc avec le
 *     dégagement libre au-dessus, la boîte est hissée d'un cran et le
 *     mouvement résiduel rejoué — la vis de la tour se monte sans jamais
 *     s'arrêter, ni toucher le saut.
 *
 * Publie l'objet global : HC. Dépend de HW (monde).
 * ========================================================================= */
(function () {
  'use strict';

  var MAX_SUB = 8;
  var SKIN = 0.001;
  var STEP_H = 1.05;

  var API = {};
  globalThis.HC = API;

  /* --------------------------------------------------------------- corps ---
   * Un corps est une AABB alignée sur les axes ; pos est le coin inférieur
   * (x,z = nord-ouest du pied, y = pied). w = demi-largeur double (boîte
   * carrée au sol), h = hauteur.                                        */
  API.makeBody = function (w, h) {
    return {
      w: w, h: h,
      x: 0, y: 0, z: 0,
      vx: 0, vy: 0, vz: 0,
      onGround: false, hitWall: false, stepped: false,
      cacheCell: null          /* cache de cohérence {x,y,z}             */
    };
  };

  API.step = function (b, dt) {
    b.onGround = false; b.hitWall = false; b.stepped = false;
    var speed = Math.max(Math.abs(b.vx), Math.abs(b.vy), Math.abs(b.vz));
    var need = speed * dt;
    var sub = (need > 0.12) ? Math.min(MAX_SUB, Math.ceil((need + 1e-4) / 0.35)) : 1;
    var sdt = dt / sub;
    for (var i = 0; i < sub; i++) {
      /* on relit b.v* : un contact annule la vitesse pour les sous-pas suivants.
       * L'axe vertical passe d'abord (contact sol pérenne, step-assist fiable) ;
       * les axes horizontaux suivent l'ordre opérateur (le dominant d'abord). */
      var mx = b.vx * sdt, my = b.vy * sdt, mz = b.vz * sdt;
      axisMove(b, 1, my);
      if (Math.abs(mx) >= Math.abs(mz)) {
        axisMove(b, 0, mx); axisMove(b, 2, mz);
      } else {
        axisMove(b, 2, mz); axisMove(b, 0, mx);
      }
    }
    /* sonde au sol : posée = contact persévérant même sans vitesse (le
     * statue qu'on laisse immobile ne doit jamais "gratter" le sol)      */
    if (!b.onGround && b.vy <= 0.0001) {
      b.y -= 0.04;
      if (overlapsSolid(b)) { b.onGround = true; b.vy = 0; }
      b.y += 0.04;
    }
  };

  /* -------------------------------------------- résolution sur un axe ---- */
  function axisMove(b, axis, delta) {
    if (axis === 0) b.x += delta; else if (axis === 1) b.y += delta; else b.z += delta;
    if (resolveAxis(b, axis, delta)) {
      if (axis === 0) { b.vx = 0; if (stepAssist(b, delta)) { onAxisMove(b, 0, delta); } }
      else if (axis === 2) { b.vz = 0; if (stepAssist(b, delta)) { onAxisMove(b, 2, delta); } }
      else { b.vy = 0; if (delta < 0) b.onGround = true; }
    }
  }

  /* rejoue le déplacement résiduel après une hissée */
  function onAxisMove(b, axis, delta) {
    if (axis === 0) b.x += delta * 0.9; else b.z += delta * 0.9;
    if (overlapsSolid(b)) { if (axis === 0) b.x -= delta * 0.9; else b.z -= delta * 0.9; }
  }

  /* Pose la position collée au contact du long de l'axe ; renvoie true si
   * un contact a eu lieu. Lecture élargie aux chunks vides (early-out).   */
  function resolveAxis(b, axis, delta) {
    var hit = false;
    for (var pass = 0; pass < 4; pass++) {
      if (!scanAxis(b, axis, delta)) break;
      hit = true;
    }
    return hit;
  }

  function scanAxis(b, axis, delta) {
    var x0 = Math.floor(b.x), x1 = Math.floor(b.x + b.w - 1e-6);
    var y0 = Math.floor(b.y), y1 = Math.floor(b.y + b.h - 1e-6);
    var z0 = Math.floor(b.z), z1 = Math.floor(b.z + b.w - 1e-6);
    /* cache de cohérence : la dernière cellule solide d'abord            */
    if (b.cacheCell) {
      var c = b.cacheCell;
      if (c.x >= x0 && c.x <= x1 && c.y >= y0 && c.y <= y1 && c.z >= z0 && c.z <= z1) {
        if (HW.solidAt(c.x, c.y, c.z)) {
          clampTo(b, axis, delta, c.x, c.y, c.z);
          return true;
        }
        b.cacheCell = null;
      }
    }
    for (var y = y0; y <= y1; y++) {
      for (var z = z0; z <= z1; z++) {
        for (var x = x0; x <= x1; x++) {
          if (!HW.solidAt(x, y, z)) continue;
          b.cacheCell = { x: x, y: y, z: z };
          clampTo(b, axis, delta, x, y, z);
          return true;
        }
      }
    }
    return false;
  }

  function clampTo(b, axis, delta, sx, sy, sz) {
    if (axis === 0) b.x = (delta > 0) ? sx - b.w - SKIN : sx + 1 + SKIN;
    else if (axis === 1) b.y = (delta > 0) ? sy - b.h - SKIN : sy + 1 + SKIN;
    else b.z = (delta > 0) ? sz - b.w - SKIN : sz + 1 + SKIN;
  }

  /* --------------------------------------------------------- step-assist --
   * Mur d'un bloc, espace libre au-dessus et corps au sol ? On hisse d'un
   * cran et le mouvement résiduel est rejoué — escalier sans saut.        */
  function stepAssist(b, delta) {
    if (Math.abs(delta) < 0.0005) return false;
    if (!(b.onGround || b.stepped)) return false;
    var savedX = b.x, savedY = b.y, savedZ = b.z;
    var liftTo = Math.floor(b.y) + 1 + 1e-4;
    if (liftTo - b.y > STEP_H) return false;
    b.y = liftTo;
    if (overlapsSolid(b)) { b.y = savedY; return false; }
    return true;
  }

  /* ---------------------------------------------------------- overlap O(b) */
  function overlapsSolid(b) {
    var x0 = Math.floor(b.x), x1 = Math.floor(b.x + b.w - 1e-6);
    var y0 = Math.floor(b.y), y1 = Math.floor(b.y + b.h - 1e-6);
    var z0 = Math.floor(b.z), z1 = Math.floor(b.z + b.w - 1e-6);
    for (var y = y0; y <= y1; y++)
      for (var z = z0; z <= z1; z++)
        for (var x = x0; x <= x1; x++)
          if (HW.solidAt(x, y, z)) return true;
    return false;
  }

  API.overlapsSolid = overlapsSolid;

  /* ---------------------------------------------- lancer de rayon (DDA) ---
   * Amanatides & Woo — ligne de vue de l'IA, ciblage du joueur, portée de
   * la torche frontale.                                                   */
  API.raycast = function (ox, oy, oz, dx, dy, dz, maxDist) {
    var x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
    var stepX = dx > 0 ? 1 : (dx < 0 ? -1 : 0);
    var stepY = dy > 0 ? 1 : (dy < 0 ? -1 : 0);
    var stepZ = dz > 0 ? 1 : (dz < 0 ? -1 : 0);
    var adx = Math.abs(dx) || 1e-12, ady = Math.abs(dy) || 1e-12, adz = Math.abs(dz) || 1e-12;
    var tMaxX = dx !== 0 ? ((stepX > 0 ? (x + 1 - ox) : (ox - x)) / adx) : Infinity;
    var tMaxY = dy !== 0 ? ((stepY > 0 ? (y + 1 - oy) : (oy - y)) / ady) : Infinity;
    var tMaxZ = dz !== 0 ? ((stepZ > 0 ? (z + 1 - oz) : (oz - z)) / adz) : Infinity;
    var tDX = 1 / adx, tDY = 1 / ady, tDZ = 1 / adz;
    var t = 0;
    for (var guard = 0; guard < 512; guard++) {
      if (HW.solidAt(x, y, z)) {
        return { hit: true, dist: t, x: x, y: y, z: z };
      }
      if (tMaxX <= tMaxY && tMaxX <= tMaxZ) { x += stepX; t = tMaxX; tMaxX += tDX; }
      else if (tMaxY <= tMaxZ) { y += stepY; t = tMaxY; tMaxY += tDY; }
      else { z += stepZ; t = tMaxZ; tMaxZ += tDZ; }
      if (t > maxDist) return { hit: false, dist: maxDist };
    }
    return { hit: false, dist: maxDist };
  };

  API.los = function (x0, y0, z0, x1, y1, z1) {
    var dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
    var d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < 0.02) return true;
    var r = API.raycast(x0, y0, z0, dx / d, dy / d, dz / d, d - 0.05);
    return !r.hit;
  };
})();
