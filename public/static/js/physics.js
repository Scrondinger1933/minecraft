/* =========================================================================
 *  VOXELCRAFT — Physique & requêtes spatiales
 *
 *  · Collision AABB par balayage axe-par-axe (résolution séparée x/y/z :
 *    empêche l'accrochage aux arêtes tout en gardant un coût O(voxels touchés))
 *  · Raycast voxel par l'algorithme DDA d'Amanatides & Woo (1987) — exact,
 *    sans échantillonnage, retourne la face frappée.
 * ========================================================================= */
(function (root) {
  'use strict';
  const V = root.VC;
  const T_SOLID = V.T_SOLID, T_LIQUID = V.T_LIQUID;
  const B = V.B;

  /* ------------------------------------------------- Boîtes de collision */
  /** Retourne les AABB du bloc (certains ne sont pas des cubes pleins). */
  function blockBoxes(id, x, y, z, out) {
    out.length = 0;
    if (!T_SOLID[id]) return out;
    if (id === B.CACTUS) { out.push([x + 0.0625, y, z + 0.0625, x + 0.9375, y + 1, z + 0.9375]); return out; }
    out.push([x, y, z, x + 1, y + 1, z + 1]);
    return out;
  }

  /* ================================================== Résolution AABB === */
  /**
   * Déplace une AABB dans le monde avec résolution de collision.
   * @param world  {getBlock(x,y,z)}
   * @param p      {x,y,z} centre au sol (pieds), modifié en place
   * @param v      {x,y,z} vitesse (m/s) × dt déjà appliqué → déplacement
   * @param half   demi-largeur (x/z), height hauteur totale
   * @returns {onGround, hitX, hitY, hitZ}
   */
  const _boxes = [];
  function moveAABB(world, p, d, half, height, stepHeight) {
    const res = { onGround: false, hitX: false, hitY: false, hitZ: false, stepped: false };

    // --- Y ---
    if (d.y !== 0) {
      const ny = p.y + d.y;
      const y0 = Math.floor(Math.min(p.y, ny) - 0.001);
      const y1 = Math.floor(Math.max(p.y + height, ny + height) + 0.001);
      const x0 = Math.floor(p.x - half), x1 = Math.floor(p.x + half);
      const z0 = Math.floor(p.z - half), z1 = Math.floor(p.z + half);
      let best = d.y;
      for (let bx = x0; bx <= x1; bx++)
        for (let bz = z0; bz <= z1; bz++)
          for (let by = y0; by <= y1; by++) {
            const id = world.getBlock(bx, by, bz);
            if (!T_SOLID[id]) continue;
            blockBoxes(id, bx, by, bz, _boxes);
            for (let k = 0; k < _boxes.length; k++) {
              const bb = _boxes[k];
              if (p.x + half <= bb[0] + 1e-7 || p.x - half >= bb[3] - 1e-7) continue;
              if (p.z + half <= bb[2] + 1e-7 || p.z - half >= bb[5] - 1e-7) continue;
              if (d.y < 0) {
                const gap = bb[4] - p.y;
                if (gap <= 1e-7 && gap > best) best = gap;
              } else {
                const gap = bb[1] - (p.y + height);
                if (gap >= -1e-7 && gap < best) best = gap;
              }
            }
          }
      if (best !== d.y) { res.hitY = true; if (d.y < 0) res.onGround = true; }
      p.y += best;
    }

    // --- X ---
    if (d.x !== 0) {
      const nx = p.x + d.x;
      const x0 = Math.floor(Math.min(p.x, nx) - half - 0.001);
      const x1 = Math.floor(Math.max(p.x, nx) + half + 0.001);
      const y0 = Math.floor(p.y + 0.001), y1 = Math.floor(p.y + height - 0.001);
      const z0 = Math.floor(p.z - half), z1 = Math.floor(p.z + half);
      let best = d.x;
      for (let by = y0; by <= y1; by++)
        for (let bz = z0; bz <= z1; bz++)
          for (let bx = x0; bx <= x1; bx++) {
            const id = world.getBlock(bx, by, bz);
            if (!T_SOLID[id]) continue;
            blockBoxes(id, bx, by, bz, _boxes);
            for (let k = 0; k < _boxes.length; k++) {
              const bb = _boxes[k];
              if (p.y + height <= bb[1] + 1e-7 || p.y >= bb[4] - 1e-7) continue;
              if (p.z + half <= bb[2] + 1e-7 || p.z - half >= bb[5] - 1e-7) continue;
              if (d.x > 0) { const gap = bb[0] - (p.x + half); if (gap >= -1e-7 && gap < best) best = gap; }
              else { const gap = bb[3] - (p.x - half); if (gap <= 1e-7 && gap > best) best = gap; }
            }
          }
      if (best !== d.x) res.hitX = true;
      p.x += best;
    }

    // --- Z ---
    if (d.z !== 0) {
      const nz = p.z + d.z;
      const z0 = Math.floor(Math.min(p.z, nz) - half - 0.001);
      const z1 = Math.floor(Math.max(p.z, nz) + half + 0.001);
      const y0 = Math.floor(p.y + 0.001), y1 = Math.floor(p.y + height - 0.001);
      const x0 = Math.floor(p.x - half), x1 = Math.floor(p.x + half);
      let best = d.z;
      for (let by = y0; by <= y1; by++)
        for (let bx = x0; bx <= x1; bx++)
          for (let bz = z0; bz <= z1; bz++) {
            const id = world.getBlock(bx, by, bz);
            if (!T_SOLID[id]) continue;
            blockBoxes(id, bx, by, bz, _boxes);
            for (let k = 0; k < _boxes.length; k++) {
              const bb = _boxes[k];
              if (p.y + height <= bb[1] + 1e-7 || p.y >= bb[4] - 1e-7) continue;
              if (p.x + half <= bb[0] + 1e-7 || p.x - half >= bb[3] - 1e-7) continue;
              if (d.z > 0) { const gap = bb[2] - (p.z + half); if (gap >= -1e-7 && gap < best) best = gap; }
              else { const gap = bb[5] - (p.z - half); if (gap <= 1e-7 && gap > best) best = gap; }
            }
          }
      if (best !== d.z) res.hitZ = true;
      p.z += best;
    }

    return res;
  }

  /** Vérifie si une AABB est libre (pour placer un bloc / faire apparaître un mob). */
  function aabbFree(world, minx, miny, minz, maxx, maxy, maxz) {
    const x0 = Math.floor(minx), x1 = Math.floor(maxx - 1e-6);
    const y0 = Math.floor(miny), y1 = Math.floor(maxy - 1e-6);
    const z0 = Math.floor(minz), z1 = Math.floor(maxz - 1e-6);
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++)
        for (let x = x0; x <= x1; x++)
          if (T_SOLID[world.getBlock(x, y, z)]) return false;
    return true;
  }

  /* ==================================================== Raycast DDA ===== */
  /**
   * @returns {x,y,z,nx,ny,nz,id,dist} ou null
   */
  function raycast(world, ox, oy, oz, dx, dy, dz, maxDist, includeLiquid) {
    let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
    const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
    const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
    const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;

    const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
    const tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
    const tDeltaZ = dz !== 0 ? Math.abs(1 / dz) : Infinity;

    let tMaxX = dx !== 0 ? ((stepX > 0 ? (x + 1 - ox) : (ox - x)) * tDeltaX) : Infinity;
    let tMaxY = dy !== 0 ? ((stepY > 0 ? (y + 1 - oy) : (oy - y)) * tDeltaY) : Infinity;
    let tMaxZ = dz !== 0 ? ((stepZ > 0 ? (z + 1 - oz) : (oz - z)) * tDeltaZ) : Infinity;

    let nx = 0, ny = 0, nz = 0;
    let t = 0;
    const maxSteps = Math.ceil(maxDist * 3) + 3;

    for (let i = 0; i < maxSteps; i++) {
      const id = world.getBlock(x, y, z);
      if (id !== 0 && (includeLiquid || !T_LIQUID[id])) {
        // ignorer les blocs traversables non ciblables ? on garde tout sauf air
        return { x, y, z, nx, ny, nz, id, dist: t };
      }
      if (tMaxX < tMaxY) {
        if (tMaxX < tMaxZ) { x += stepX; t = tMaxX; tMaxX += tDeltaX; nx = -stepX; ny = 0; nz = 0; }
        else { z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; nx = 0; ny = 0; nz = -stepZ; }
      } else {
        if (tMaxY < tMaxZ) { y += stepY; t = tMaxY; tMaxY += tDeltaY; nx = 0; ny = -stepY; nz = 0; }
        else { z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; nx = 0; ny = 0; nz = -stepZ; }
      }
      if (t > maxDist) break;
    }
    return null;
  }

  /* -------------------------------------------------- Test de fluide --- */
  function fluidAt(world, x, y, z) {
    const id = world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z));
    return T_LIQUID[id] ? id : 0;
  }

  root.VCPhys = { moveAABB, raycast, aabbFree, blockBoxes, fluidAt };
})(typeof self !== 'undefined' ? self : this);
