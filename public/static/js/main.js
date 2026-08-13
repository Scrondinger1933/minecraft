/* =========================================================================
 *  VOXELCRAFT — Boucle de rendu, HUD, menus
 *
 *  Architecture temporelle : découplage strict entre la simulation (20 Hz,
 *  déterministe, dans Game.tick) et l'affichage (libre, borné par le taux de
 *  rafraîchissement). L'accumulateur borne le rattrapage à 5 ticks afin
 *  d'éviter la « spirale de la mort » après un gel d'onglet.
 *
 *  Trois passes de terrain, dans l'ordre imposé par le test de profondeur :
 *    1. opaque      — écriture de profondeur, sans mélange, proche → loin
 *    2. cutout      — alphaTest, écriture de profondeur (feuillage, torches)
 *    3. translucide — mélange, profondeur en lecture seule, loin → proche
 * ========================================================================= */
(function (root) {
  'use strict';

  const V = root.VC;
  const P = root.VCPhys;
  const RND = root.VCRender;
  const M4 = RND.M4;
  const B = V.B;
  const TICK = root.VCGame.TICK;
  const DAY_LENGTH = root.VCGame.DAY_LENGTH;

  const ATLAS_COLS = 16;

  let game = null;
  let glCanvas, hudCanvas, hud;
  let lastT = 0, acc = 0, rafId = 0;
  let dpr = 1;
  let bobPhase = 0;

  /* ===================================================================
   *  Matrices de travail et UV
   * =================================================================== */
  const mA = M4.create(), mB = M4.create(), mProj = M4.create(), mView = M4.create();
  const uvScratch = new Float32Array(48);
  const COL = new Float32Array(4);

  /** Remplit les 48 UV du pavé sprite avec une tuile unique de l'atlas. */
  function fillTileUV(out, tile) {
    const s = 1 / ATLAS_COLS;
    const tx = (tile % ATLAS_COLS) * s, ty = ((tile / ATLAS_COLS) | 0) * s;
    const pad = 0.0016 * s;
    const u0 = tx + pad, u1 = tx + s - pad;
    const v0 = ty + pad, v1 = ty + s - pad;
    for (let f = 0; f < 6; f++) {
      const o = f * 8;
      out[o] = u0; out[o + 1] = v1;
      out[o + 2] = u1; out[o + 3] = v1;
      out[o + 4] = u1; out[o + 5] = v0;
      out[o + 6] = u0; out[o + 7] = v0;
    }
    return out;
  }

  /**
   * MVP d'un pavé : base · T(px,py,pz) · Ry(yaw) · T(ox,oy,oz) · S(sx,sy,sz)
   * Le pavé du renderer occupe [0,1]³ ; les offsets sont donc exprimés dans
   * le repère local du modèle, avant mise à l'échelle.
   */
  function boxMVP(out, base, px, py, pz, yaw, ox, oy, oz, sx, sy, sz) {
    out.set(base);
    M4.translate(out, out, [px, py, pz]);
    if (yaw) M4.rotateY(out, out, yaw);
    M4.translate(out, out, [ox, oy, oz]);
    M4.scale(out, out, [sx, sy, sz]);
    return out;
  }

  function setCol(c, k, a) {
    COL[0] = c[0] * k; COL[1] = c[1] * k; COL[2] = c[2] * k;
    COL[3] = a === undefined ? 1 : a;
    return COL;
  }

  /** Lumière approchée d'une entité : exposition au ciel ou lueur ambiante. */
  function entityLight(x, y, z, env) {
    const sky = game.world.isSkyExposed(Math.floor(x), Math.floor(y), Math.floor(z));
    return sky ? (0.28 + 0.72 * env.sunLight) : 0.36;
  }

  /* ===================================================================
   *  Rendu d'un mob — assemblage de pavés colorés
   * =================================================================== */
  function drawMob(r, m, env) {
    const d = m.def;
    const vp = r.viewProj;
    const biped = d.h > 1.5;
    const k = entityLight(m.x, m.y + d.h * 0.5, m.z, env);
    const flash = m.hurtTime > 0;
    const burn = m.burning;

    const tint = flash ? [1.0, 0.40, 0.40] : (burn ? [1.0, 0.58, 0.22] : d.color);
    const tint2 = flash ? [1.0, 0.40, 0.40] : (burn ? [1.0, 0.70, 0.32] : d.color2);

    const bw = d.body[0], bh = d.body[1], bd = d.body[2];
    const hw = d.head[0], hh = d.head[1], hd = d.head[2];
    const swing = Math.sin(m.walkPhase * 2.2) * 0.4;

    if (biped) {
      const legH = d.h - bh - hh;
      // torse
      boxMVP(mA, vp, m.x, m.y + legH, m.z, m.yaw, -bw / 2, 0, -bd / 2, bw, bh, bd);
      r.drawCube(mA, null, setCol(tint, k), false, 0);
      // tête
      boxMVP(mA, vp, m.x, m.y + legH + bh, m.z, m.yaw, -hw / 2, 0, -hd / 2, hw, hh, hd);
      r.drawCube(mA, null, setCol(tint, k * 1.14), false, 0);
      // jambes — le balancement est simulé par un décalage vertical/longitudinal
      for (let s = -1; s <= 1; s += 2) {
        const sw = swing * s;
        boxMVP(mA, vp, m.x, m.y, m.z, m.yaw,
          s * bw * 0.24 - bw * 0.15, Math.abs(sw) * 0.12, -bd * 0.2 + sw * 0.16,
          bw * 0.30, legH, bd * 0.42);
        r.drawCube(mA, null, setCol(tint2, k * 0.84), false, 0);
      }
      // bras — tendus vers l'avant pour le zombie
      const armF = m.type === 'zombie' ? 0.42 : 0;
      for (let s = -1; s <= 1; s += 2) {
        const sw = -swing * s;
        boxMVP(mA, vp, m.x, m.y + legH + bh * 0.08, m.z, m.yaw,
          s * (bw * 0.5) - bw * 0.12, 0, -bd * 0.16 - armF * 0.34 + sw * 0.12,
          bw * 0.24, bh * 0.92, bd * 0.34 + armF * 0.38);
        r.drawCube(mA, null, setCol(tint, k * 0.96), false, 0);
      }
    } else {
      const legH = Math.max(0.06, d.h - bh);
      // corps
      boxMVP(mA, vp, m.x, m.y + legH, m.z, m.yaw, -bw / 2, 0, -bd / 2, bw, bh, bd);
      r.drawCube(mA, null, setCol(tint, k), false, 0);
      // tête, vers l'avant local (+Z, car yaw = atan2(mx, mz))
      boxMVP(mA, vp, m.x, m.y + legH + bh * 0.38, m.z, m.yaw,
        -hw / 2, 0, bd / 2 - hd * 0.2, hw, hh, hd);
      r.drawCube(mA, null, setCol(tint, k * 1.12), false, 0);
      // museau / bec
      boxMVP(mA, vp, m.x, m.y + legH + bh * 0.38, m.z, m.yaw,
        -hw * 0.20, hh * 0.14, bd / 2 + hd * 0.76, hw * 0.40, hh * 0.38, hd * 0.28);
      r.drawCube(mA, null, setCol(tint2, k * 1.06), false, 0);
      // quatre pattes en diagonale opposée
      let li = 0;
      for (let sx = -1; sx <= 1; sx += 2)
        for (let sz = -1; sz <= 1; sz += 2) {
          const ph = ((li++ % 3) === 0) ? swing : -swing;
          boxMVP(mA, vp, m.x, m.y, m.z, m.yaw,
            sx * bw * 0.30 - bw * 0.085, Math.abs(ph) * 0.07,
            sz * bd * 0.30 - bd * 0.085, bw * 0.17, legH, bd * 0.17);
          r.drawCube(mA, null, setCol(tint2, k * 0.78), false, 0);
        }
      // toison du mouton, crête du poulet
      if (m.type === 'sheep') {
        boxMVP(mA, vp, m.x, m.y + legH - 0.02, m.z, m.yaw,
          -bw * 0.56, bh * 0.06, -bd * 0.56, bw * 1.12, bh * 1.02, bd * 1.12);
        r.drawCube(mA, null, setCol(tint, k * 1.04), false, 0);
      }
    }

    // halo d'amorçage du creeper
    if (m.fuse > 0) {
      const g = 0.5 + 0.5 * Math.sin(game.time * 34);
      boxMVP(mA, vp, m.x, m.y, m.z, m.yaw,
        -d.w * 0.58, -0.01, -d.w * 0.58, d.w * 1.16, d.h * 1.04, d.w * 1.16);
      COL[0] = COL[1] = COL[2] = 1; COL[3] = 0.18 + g * 0.40;
      const gl = r.gl;
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      r.drawCube(mA, null, COL, false, 0);
      gl.disable(gl.BLEND);
    }
  }

  /* ===================================================================
   *  Item tenu en main — rendu dans l'espace vue
   * =================================================================== */
  function drawHeldItem(r, env, aspect, fov, hspeed) {
    const p = game.player;
    const gl = r.gl;
    const held = p.heldItem();

    M4.perspective(mProj, fov, aspect, 0.02, 8);

    const sw = p.swingT > 0 ? Math.sin((1 - p.swingT / 0.25) * Math.PI) : 0;
    const bx = Math.sin(bobPhase) * (hspeed > 0.6 ? 0.014 : 0);
    const by = Math.abs(Math.cos(bobPhase)) * (hspeed > 0.6 ? 0.012 : 0);

    M4.identity(mView);
    // repère vue : X droite, Y haut, −Z devant
    M4.translate(mView, mView, [0.40 + bx - sw * 0.10, -0.40 - by + sw * 0.15, -0.60 + sw * 0.13]);
    M4.rotateY(mView, mView, -0.44 - sw * 0.48);
    M4.rotateX(mView, mView, -0.16 - sw * 0.88);

    const k = 0.44 + 0.56 * env.sunLight;
    gl.clear(gl.DEPTH_BUFFER_BIT);   // l'objet en main n'est jamais coupé par le décor

    M4.multiply(mB, mProj, mView);
    if (held) {
      fillTileUV(uvScratch, V.itemTile(held.id));
      const isBlk = V.isBlock(held.id);
      const s = isBlk ? 0.30 : 0.28;
      mA.set(mB);
      M4.translate(mA, mA, [-s / 2, -s / 2, -s / 2]);
      M4.scale(mA, mA, [s, s, isBlk ? s : s * 0.16]);
      COL[0] = COL[1] = COL[2] = k; COL[3] = 1;
      r.drawCube(mA, uvScratch, COL, true, 0.5);
    } else {
      mA.set(mB);
      M4.translate(mA, mA, [-0.055, -0.30, -0.055]);
      M4.scale(mA, mA, [0.115, 0.36, 0.115]);
      COL[0] = 0.86 * k; COL[1] = 0.66 * k; COL[2] = 0.51 * k; COL[3] = 1;
      r.drawCube(mA, null, COL, false, 0);
    }
  }

  /* ===================================================================
   *  Rendu d'une image complète
   * =================================================================== */
  function render(dt) {
    const r = game.renderer;
    const gl = r.gl;
    const p = game.player;
    const w = game.world;

    /* ------------------------------------------------- Redimension ---- */
    dpr = Math.min(2, root.devicePixelRatio || 1);
    const pw = Math.max(1, Math.floor(glCanvas.clientWidth * dpr));
    const ph = Math.max(1, Math.floor(glCanvas.clientHeight * dpr));
    if (glCanvas.width !== pw || glCanvas.height !== ph) { glCanvas.width = pw; glCanvas.height = ph; }
    if (hudCanvas.width !== pw || hudCanvas.height !== ph) { hudCanvas.width = pw; hudCanvas.height = ph; }

    /* ----------------------------------------------------- Caméra ----- */
    const hspeed = Math.hypot(p.vx, p.vz);
    if (p.onGround) bobPhase += dt * hspeed * 1.85;
    const bobA = (game.settings.viewBob && p.onGround) ? Math.min(0.052, hspeed * 0.0098) : 0;
    const bobX = Math.cos(bobPhase) * bobA;
    const bobY = Math.abs(Math.sin(bobPhase)) * bobA * 0.85;

    const eyeH = p.eye - (p.sneaking ? 0.24 : 0) - bobY;
    const eye = [p.x + bobX * 0.5, p.y + eyeH, p.z];

    let fov = game.settings.fov * Math.PI / 180;
    if (p.sprinting) fov *= 1.055;
    const headId = w.getBlock(Math.floor(p.x), Math.floor(p.y + eyeH), Math.floor(p.z));
    if (headId === B.WATER) fov *= 0.955;
    const far = Math.max(96, game.settings.renderDistance * 16 * 1.4);
    const dir = r.setCamera(eye, p.yaw, p.pitch, fov, pw / ph, 0.08, far);
    game.camDir = dir;

    /* -------------------------------------------------- Sélection ----- */
    if (!game.dead && !game.ui.open && !game.paused) {
      const reach = p.mode === 'creative' ? 5.5 : 4.5;
      game.selection = P.raycast(w, eye[0], eye[1], eye[2], dir[0], dir[1], dir[2], reach, false);
    } else game.selection = null;

    /* ---------------------------------------------- Environnement ----- */
    const env = game.environment();
    let fog = env.fogColor, fogStart = env.fogStart, fogEnd = env.fogEnd;
    if (headId === B.WATER) {
      fog = [0.07 + 0.11 * env.sunLight, 0.21 + 0.24 * env.sunLight, 0.40 + 0.30 * env.sunLight];
      fogStart = 0.4; fogEnd = 20;
    } else if (headId === B.LAVA) {
      fog = [0.74, 0.24, 0.03]; fogStart = 0.05; fogEnd = 2.0;
    }
    const envR = {
      sunDir: env.sunDir, sunLight: env.sunLight, day: env.day,
      skyTop: env.skyTop, skyHorizon: env.skyHorizon,
      fogColor: fog, fogStart, fogEnd, sunTint: env.sunTint,
      time: env.time, underwater: headId === B.WATER
    };

    r.beginFrame(pw, ph, fog);
    if (headId !== B.WATER && headId !== B.LAVA) r.drawSky(envR);

    /* -------------------------------------- Sélection des chunks ------ */
    const visible = [];
    let nMeshes = 0;
    w.chunks.forEach(c => {
      if (c.state !== 'ready') return;
      if (!c.meshes.solid && !c.meshes.cutout && !c.meshes.water) return;
      nMeshes++;
      const ox = c.cx * 16, oz = c.cz * 16;
      const top = Math.min(V.CH_Y, c.maxY + 2);
      if (!r.aabbVisible(ox, 0, oz, ox + 16, top, oz + 16)) return;
      const dx = (ox + 8) - p.x, dz = (oz + 8) - p.z;
      visible.push({ c, ox, oz, d2: dx * dx + dz * dz });
    });
    visible.sort((a, b) => a.d2 - b.d2);
    w.stats.visible = visible.length;

    r.beginTerrain(envR);
    gl.disable(gl.BLEND);
    gl.depthMask(true);

    /* --- passe 1 : opaque, proche → loin (rejet early-Z maximal) ------ */
    for (let i = 0; i < visible.length; i++) {
      const v = visible[i];
      r.drawChunkLayer(v.c.meshes.solid, v.ox, 0, v.oz, { alphaTest: 0, alpha: 1, wave: false });
    }
    /* --- passe 2 : cutout (feuillage, herbe, fleurs, torches) --------- */
    gl.disable(gl.CULL_FACE);
    for (let i = 0; i < visible.length; i++) {
      const v = visible[i];
      r.drawChunkLayer(v.c.meshes.cutout, v.ox, 0, v.oz, { alphaTest: 0.5, alpha: 1, wave: false });
    }
    gl.enable(gl.CULL_FACE);

    /* -------------------------------------------------- Entités ------- */
    for (let i = 0; i < game.mobs.length; i++) {
      const m = game.mobs[i];
      const dx = m.x - p.x, dz = m.z - p.z;
      if (dx * dx + dz * dz > 88 * 88) continue;
      if (!r.aabbVisible(m.x - 1.2, m.y - 0.3, m.z - 1.2, m.x + 1.2, m.y + m.def.h + 0.3, m.z + 1.2)) continue;
      drawMob(r, m, env);
    }

    // objets au sol : petit cube texturé en rotation lente
    for (let i = 0; i < game.items.length; i++) {
      const e = game.items[i];
      const dx = e.x - p.x, dz = e.z - p.z;
      if (dx * dx + dz * dz > 64 * 64) continue;
      fillTileUV(uvScratch, V.itemTile(e.item));
      const s = V.isBlock(e.item) ? 0.27 : 0.23;
      const bob = Math.sin(game.time * 2.3 + e.id) * 0.05;
      boxMVP(mA, r.viewProj, e.x, e.y + 0.05 + bob, e.z,
        game.time * 1.4 + e.id, -s / 2, 0, -s / 2, s, s, s);
      const k = entityLight(e.x, e.y, e.z, env);
      COL[0] = COL[1] = COL[2] = k; COL[3] = 1;
      r.drawCube(mA, uvScratch, COL, true, 0.5);
    }

    /* ------------------------------------------------ Particules ------ */
    const ps = game.particles;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    for (let i = 0; i < ps.n; i++) {
      const life = ps.life[i];
      if (life <= 0) continue;
      const fade = Math.min(1, life / (ps.maxLife[i] * 0.32));
      const s = ps.size[i] * (0.45 + 0.55 * Math.min(1, life / (ps.maxLife[i] * 0.5)));
      const t = ps.tile[i];
      boxMVP(mA, r.viewProj, ps.x[i], ps.y[i], ps.z[i], 0, -s / 2, -s / 2, -s / 2, s, s, s);
      if (t >= 0) {
        fillTileUV(uvScratch, t);
        const k = 0.42 + 0.58 * env.sunLight;
        COL[0] = COL[1] = COL[2] = k; COL[3] = fade;
        r.drawCube(mA, uvScratch, COL, true, 0.3);
      } else {
        COL[0] = ps.r[i]; COL[1] = ps.g[i]; COL[2] = ps.b[i]; COL[3] = fade;
        r.drawCube(mA, null, COL, false, 0);
      }
    }
    gl.disable(gl.BLEND);

    /* --------------------------------------- Boîte de sélection ------- */
    if (game.selection) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      r.drawSelection(game.selection.x, game.selection.y, game.selection.z, game.time);
      gl.disable(gl.BLEND);
    }

    /* --- passe 3 : translucide (eau), loin → proche ------------------- */
    r.beginTerrain(envR);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    for (let i = visible.length - 1; i >= 0; i--) {
      const v = visible[i];
      r.drawChunkLayer(v.c.meshes.water, v.ox, 0, v.oz, { alphaTest: 0, alpha: 0.74, wave: true });
    }
    gl.enable(gl.CULL_FACE);
    gl.depthMask(true);
    gl.disable(gl.BLEND);

    /* ----------------------------------------------- Item en main ----- */
    drawHeldItem(r, env, pw / ph, fov, hspeed);

    game.renderStats = {
      drawCalls: r.drawCalls, triangles: r.triangles | 0,
      meshes: nMeshes, visible: visible.length
    };

    drawHUD(env);
  }

  /* ===================================================================
   *  HUD — canvas 2D superposé au contexte WebGL
   * =================================================================== */
  function heartShape(ctx, x, y, s, fill) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(x + s * 0.5, y + s * 0.88);
    ctx.bezierCurveTo(x - s * 0.16, y + s * 0.46, x + s * 0.10, y + s * 0.02, x + s * 0.5, y + s * 0.30);
    ctx.bezierCurveTo(x + s * 0.90, y + s * 0.02, x + s * 1.16, y + s * 0.46, x + s * 0.5, y + s * 0.88);
    ctx.closePath();
    ctx.fill();
  }
  function drumstickShape(ctx, x, y, s, fill) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(x + s * 0.34, y + s * 0.40, s * 0.31, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x + s * 0.48, y + s * 0.50);
    ctx.lineTo(x + s * 0.94, y + s * 0.90);
    ctx.lineTo(x + s * 0.76, y + s * 0.99);
    ctx.lineTo(x + s * 0.34, y + s * 0.64);
    ctx.closePath();
    ctx.fill();
  }
  /** Jauge en dix unités, remplissage par demi-unité (clipping horizontal). */
  function gauge(ctx, shape, value, x0, dirRight, y, size, gap, color) {
    for (let i = 0; i < 10; i++) {
      const x = dirRight ? x0 + i * (size + gap) : x0 - size - i * (size + gap);
      shape(ctx, x, y, size, 'rgba(0,0,0,0.45)');
      const v = value - i * 2;
      if (v >= 2) shape(ctx, x, y, size, color);
      else if (v > 0) {
        ctx.save();
        ctx.beginPath(); ctx.rect(x, y, size * 0.52, size); ctx.clip();
        shape(ctx, x, y, size, color);
        ctx.restore();
      }
    }
  }

  function drawHUD(env) {
    const ctx = hud;
    const W = hudCanvas.width, H = hudCanvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.scale(dpr, dpr);
    const w = W / dpr, h = H / dpr;
    const p = game.player;

    /* ---------------------------------------------- Voiles d'écran ---- */
    if (p.hurtTimer > 0) {
      ctx.fillStyle = 'rgba(170,18,18,' + (p.hurtTimer * 0.40).toFixed(3) + ')';
      ctx.fillRect(0, 0, w, h);
    }
    if (p.headInWater) { ctx.fillStyle = 'rgba(28,86,148,0.22)'; ctx.fillRect(0, 0, w, h); }
    if (p.mode === 'survival' && p.hp > 0 && p.hp <= 6) {
      ctx.fillStyle = 'rgba(130,0,0,' + (0.09 + 0.055 * Math.sin(game.time * 5)).toFixed(3) + ')';
      ctx.fillRect(0, 0, w, h);
    }
    // vignette permanente : concentre le regard, atténue les bords
    const vg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.36, w / 2, h / 2, Math.max(w, h) * 0.72);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.30)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, w, h);

    /* ------------------------------------------------- Réticule ------- */
    const active = !game.dead && !game.ui.open && !game.paused;
    if (active) {
      const cx = w / 2, cy = h / 2;
      ctx.save();
      ctx.globalCompositeOperation = 'difference';
      ctx.fillStyle = '#fff';
      ctx.fillRect(cx - 8, cy - 1, 16, 2);
      ctx.fillRect(cx - 1, cy - 8, 2, 16);
      ctx.restore();

      if (game.mining) {
        const pr = Math.min(1, game.mining.progress / game.mining.total);
        ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(cx, cy, 18, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.92)'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(cx, cy, 18, -Math.PI / 2, -Math.PI / 2 + pr * Math.PI * 2); ctx.stroke();
      }
      // libellé du bloc visé
      if (game.selection && game.debug) {
        const id = game.world.getBlock(game.selection.x, game.selection.y, game.selection.z);
        const lbl = V.itemLabel(id) + '  (' + game.selection.x + ', ' + game.selection.y + ', ' + game.selection.z + ')';
        ctx.font = '12px "Segoe UI", system-ui, sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
        const tw = ctx.measureText(lbl).width;
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(cx - tw / 2 - 6, cy + 26, tw + 12, 17);
        ctx.fillStyle = '#e6eef2';
        ctx.fillText(lbl, cx, cy + 39);
      }
    }

    /* -------------------------------------------------- Jauges -------- */
    const barW = 9 * 46 + 8 * 4;              // doit correspondre au CSS de la hotbar
    const x0 = (w - barW) / 2;
    const yBase = h - 12 - 48 - 8;

    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    if (p.mode === 'survival') {
      const hs = 17;
      gauge(ctx, heartShape, p.hp, x0, true, yBase - hs, hs, 2, '#e03131');
      gauge(ctx, drumstickShape, p.food, x0 + barW, false, yBase - hs, hs, 2, '#c8862e');

      if (p.breathe < 10) {
        const n = Math.ceil(p.breathe);
        for (let i = 0; i < n; i++) {
          const x = x0 + barW - 8 - i * 16, y = yBase - hs - 14;
          ctx.beginPath(); ctx.arc(x, y, 5.5, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(255,255,255,0.92)'; ctx.fill();
          ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 1.2; ctx.stroke();
        }
      }
      // barre d'expérience — seuil 7 + 2·niveau
      const need = 7 + p.level * 2;
      const xr = Math.max(0, Math.min(1, p.xp / need));
      const xy = yBase - hs - 12;
      ctx.fillStyle = 'rgba(0,0,0,0.58)'; ctx.fillRect(x0, xy, barW, 7);
      ctx.fillStyle = '#7ce23a'; ctx.fillRect(x0, xy, barW * xr, 7);
      ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1;
      ctx.strokeRect(x0 + 0.5, xy + 0.5, barW - 1, 6);
      if (p.level > 0) {
        ctx.font = 'bold 15px "Segoe UI", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#000'; ctx.fillText(String(p.level), w / 2 + 1, xy - 5);
        ctx.fillStyle = '#8bef46'; ctx.fillText(String(p.level), w / 2, xy - 6);
        ctx.textAlign = 'left';
      }
    } else {
      ctx.font = '12px "Segoe UI", system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fillText('MODE CRÉATIF' + (p.flying ? ' — vol activé' : ''), x0, yBase - 8);
    }

    /* ------------------------------------------------- Messages ------- */
    ctx.font = '13px "Segoe UI", system-ui, sans-serif';
    let my = yBase - 92;
    for (let i = game.messages.length - 1; i >= 0; i--) {
      const m = game.messages[i];
      const age = game.time - m.time;
      if (age > 7) continue;
      const a = Math.min(1, (7 - age) / 1.4);
      const tw = ctx.measureText(m.t).width;
      ctx.fillStyle = 'rgba(0,0,0,' + (0.44 * a).toFixed(3) + ')';
      ctx.fillRect(10, my - 13, tw + 14, 19);
      ctx.fillStyle = 'rgba(255,255,255,' + a.toFixed(3) + ')';
      ctx.fillText(m.t, 17, my);
      my -= 21;
    }

    /* ---------------------------------------------- Panneau debug ----- */
    if (game.settings.showFps || game.debug) {
      const rs = game.renderStats || {};
      const lines = ['VOXELCRAFT · ' + game.fps + ' img/s'];
      if (game.debug) {
        const bi = game.world.getBlock(Math.floor(p.x), Math.floor(p.y - 0.2), Math.floor(p.z));
        const biome = game.world.getBiome(Math.floor(p.x), Math.floor(p.z));
        const bd = root.VCGen.BIOME_DATA[biome];
        const t = (game.worldTime % DAY_LENGTH) / DAY_LENGTH;
        const hourF = ((t * 24) + 6) % 24;
        const hh = Math.floor(hourF), mm = Math.floor((hourF % 1) * 60);
        lines.push(
          'XYZ  ' + p.x.toFixed(2) + ' / ' + p.y.toFixed(2) + ' / ' + p.z.toFixed(2),
          'Chunk  ' + (Math.floor(p.x) >> 4) + ', ' + (Math.floor(p.z) >> 4) +
          '   local ' + (((Math.floor(p.x) % 16) + 16) % 16) + ', ' + (((Math.floor(p.z) % 16) + 16) % 16),
          'Biome  ' + (bd ? bd.name : '?') + '  (id ' + biome + ')',
          'Sol  ' + V.itemLabel(bi) + '   colonne h=' + game.world.getHeight(Math.floor(p.x), Math.floor(p.z)),
          'Heure  ' + String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0') +
          '   soleil ' + env.sunLight.toFixed(2) + '   ciel ' + (game.world.isSkyExposed(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)) ? 'oui' : 'non'),
          'Chunks  ' + game.world.chunks.size + '  maillés ' + (rs.meshes || 0) + '  visibles ' + (rs.visible || 0),
          'Dessin  ' + (rs.drawCalls || 0) + ' appels, ' + (rs.triangles || 0).toLocaleString('fr-FR') + ' triangles',
          'Entités  ' + game.mobs.length + ' mobs, ' + game.items.length + ' objets, ' + game.particles.n + ' particules',
          'Worker  ' + game.world.inFlight + ' en vol, ' + game.world.remeshQueue.length + ' à re-mailler',
          'Diffs persistées  ' + game.world.edits.size,
          'Vitesse  ' + Math.hypot(p.vx, p.vz).toFixed(2) + ' m/s   vy ' + p.vy.toFixed(2) +
          (p.onGround ? '  (sol)' : '  (air)'),
          'Graine  ' + game.seed
        );
      }
      ctx.font = '12px ui-monospace, SFMono-Regular, Consolas, monospace';
      ctx.textAlign = 'left';
      let ty = 19;
      for (let i = 0; i < lines.length; i++) {
        const tw = ctx.measureText(lines[i]).width;
        ctx.fillStyle = 'rgba(0,0,0,0.48)';
        ctx.fillRect(8, ty - 12, tw + 11, 17);
        ctx.fillStyle = i === 0 ? '#9fe870' : '#dde6ea';
        ctx.fillText(lines[i], 13, ty);
        ty += 17;
      }
      if (game.debug) {
        const help = [
          'ZQSD / WASD déplacer · Espace sauter · Maj accroupir · Ctrl courir',
          'Clic gauche casser · Clic droit poser / utiliser · Molette hotbar',
          'E inventaire · Q lâcher (Ctrl+Q : la pile) · Clic milieu copier le bloc',
          'T survie ⇄ créatif · G faire apparaître un mob (créatif) · F3 debug',
          'Double-Espace : activer le vol en créatif · Échap : pause'
        ];
        let hy = h - 14;
        for (let i = help.length - 1; i >= 0; i--) {
          const tw = ctx.measureText(help[i]).width;
          ctx.fillStyle = 'rgba(0,0,0,0.45)';
          ctx.fillRect(w - tw - 18, hy - 12, tw + 12, 16);
          ctx.fillStyle = '#b9c6cc';
          ctx.fillText(help[i], w - tw - 12, hy);
          hy -= 17;
        }
      }
    }
  }

  /* ===================================================================
   *  Boucle principale — accumulateur à pas fixe
   * =================================================================== */
  function frame(now) {
    rafId = requestAnimationFrame(frame);
    if (!game || !game.ready) return;

    const dtReal = Math.min(0.25, (now - lastT) / 1000);
    lastT = now;
    game.time += dtReal;

    game.frames++;
    game.fpsT += dtReal;
    if (game.fpsT >= 0.5) {
      game.fps = Math.round(game.frames / game.fpsT);
      game.frames = 0; game.fpsT = 0;
    }

    if (!game.paused && !game.dead) {
      acc += dtReal;
      let n = 0;
      while (acc >= TICK && n < 5) { game.tick(); acc -= TICK; n++; }
      if (acc > TICK * 5) acc = 0;          // rattrapage abandonné : on ne spirale pas
    } else acc = 0;

    game.world.update(game.player.x, game.player.z, dtReal);
    render(dtReal);
  }

  /* ===================================================================
   *  Menus, réglages, cycle de vie
   * =================================================================== */
  const $ = id => document.getElementById(id);
  function show(id, on) { const e = $(id); if (e) e.style.display = on ? 'flex' : 'none'; }

  function randomSeed() { return (Math.random() * 0xffffffff) >>> 0; }
  /** Graine numérique ou hachage FNV-1a d'une chaîne (reproductible). */
  function parseSeed(s) {
    s = (s || '').trim();
    if (!s) return randomSeed();
    if (/^\d+$/.test(s)) return (parseInt(s, 10) % 0xffffffff) >>> 0;
    let hsh = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { hsh ^= s.charCodeAt(i); hsh = (hsh * 0x01000193) >>> 0; }
    return hsh >>> 0;
  }
  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  const menuSettings = {
    renderDistance: 8, fov: 70, mouseSens: 0.0022,
    sound: 0.55, showFps: true, viewBob: true, mipmap: true
  };
  let pendingMode = 'survival';

  const RANGES = [
    ['renderDistance', 'Distance de rendu', 2, 14, 1, ' chunks'],
    ['fov', 'Champ de vision', 50, 110, 1, '°'],
    ['mouseSens', 'Sensibilité souris', 0.0006, 0.0060, 0.0002, ''],
    ['sound', 'Volume général', 0, 1, 0.05, '']
  ];
  const TOGGLES = [
    ['showFps', 'Compteur d\'images par seconde'],
    ['viewBob', 'Balancement de la vue'],
    ['mipmap', 'Mipmaps (textures lointaines)']
  ];
  function fmtSetting(k, v) {
    if (k === 'mouseSens') return (v * 1000).toFixed(1);
    if (k === 'sound') return Math.round(v * 100) + ' %';
    return String(Math.round(v));
  }
  function buildSettings(target, settings, onChange) {
    let h = '';
    RANGES.forEach(d => {
      h += '<label class="setting"><span>' + d[1] + '</span>' +
        '<input type="range" data-k="' + d[0] + '" min="' + d[2] + '" max="' + d[3] +
        '" step="' + d[4] + '" value="' + settings[d[0]] + '">' +
        '<b data-v="' + d[0] + '">' + fmtSetting(d[0], settings[d[0]]) + d[5] + '</b></label>';
    });
    TOGGLES.forEach(t => {
      h += '<label class="setting toggle"><span>' + t[1] + '</span>' +
        '<input type="checkbox" data-k="' + t[0] + '"' + (settings[t[0]] ? ' checked' : '') + '></label>';
    });
    target.innerHTML = h;
    target.querySelectorAll('input[type=range]').forEach(inp => {
      inp.addEventListener('input', () => {
        const k = inp.dataset.k;
        settings[k] = parseFloat(inp.value);
        const def = RANGES.find(d => d[0] === k);
        const lbl = target.querySelector('[data-v="' + k + '"]');
        if (lbl) lbl.textContent = fmtSetting(k, settings[k]) + def[5];
        if (onChange) onChange(k);
      });
    });
    target.querySelectorAll('input[type=checkbox]').forEach(inp => {
      inp.addEventListener('change', () => {
        settings[inp.dataset.k] = inp.checked;
        if (onChange) onChange(inp.dataset.k);
      });
    });
  }

  /* ------------------------------------------------- Lancement de partie */
  function startGame(worldId, name, seed, saveData) {
    show('main-menu', false);
    show('loading', true);
    const bar = $('loading-bar'), txt = $('loading-text');

    try {
      game = new root.VCGame.Game(glCanvas);
    } catch (err) {
      show('loading', false); show('main-menu', true);
      alert('Initialisation WebGL 2 impossible : ' + err.message);
      return;
    }
    root.VCGAME = game;                 // point d'entrée pour l'inspection console
    Object.assign(game.settings, menuSettings);
    game.worldId = worldId;
    game.worldName = name;
    game.bindInput();
    bindGameButtons();

    game.boot(seed, saveData,
      ratio => {
        if (bar) bar.style.width = (ratio * 100).toFixed(0) + '%';
        if (txt) txt.textContent = 'Génération du terrain — ' + (ratio * 100).toFixed(0) + ' %';
      },
      () => {
        if (!saveData) {
          game.player.mode = pendingMode;
          game.spawnPoint = [game.player.x, game.player.y, game.player.z];
          if (pendingMode === 'creative') {
            [B.STONE, B.PLANKS, B.GLASS, B.LOG, B.TORCH, B.COBBLE, B.SAND, B.WOOL, B.GLOWSTONE]
              .forEach((id, i) => game.player.inv.set(i, { id, n: 64 }));
          }
        }
        game.ui.refreshHotbar();
        show('loading', false);
        show('ui-root', true);
        game.msg('Monde « ' + name + ' » — graine ' + seed);
        game.msg('F3 : informations de débogage · T : changer de mode');
        lastT = performance.now();
        acc = 0;
        game.paused = false;              // la simulation doit tourner d'emblée
        game.updatePauseUI();
        game.save(true);

        /* Le verrou de pointeur exige une activation transitoire : on ne peut
         * pas le demander ici (callback asynchrone). On amène simplement le
         * focus clavier sur le canvas — ZQSD/WASD fonctionnent aussitôt — et
         * on invite au clic, qui acquerra le verrou dans son propre geste. */
        glCanvas.setAttribute('tabindex', '0');
        glCanvas.focus({ preventScroll: true });
        game.msg('Cliquez sur la vue pour capturer la souris.');
      });
  }

  /* --------------------------------------------------- Liste des mondes */
  function refreshWorldList() {
    const box = $('world-list');
    if (!box) return;
    box.innerHTML = '<div class="menu-note">Lecture de la base IndexedDB…</div>';
    root.VCWorld.listWorlds().then(list => {
      if (!list.length) { box.innerHTML = '<div class="menu-note">Aucune partie enregistrée.</div>'; return; }
      list.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
      box.innerHTML = list.map(wd => {
        const d = wd.savedAt ? new Date(wd.savedAt).toLocaleString('fr-FR') : '—';
        const st = wd.stats || {}, pl = wd.player || {};
        return '<div class="world-row"><div class="world-info">' +
          '<b>' + escapeHTML(wd.name || 'Monde') + '</b>' +
          '<span>graine ' + wd.seed + ' · ' + d + '</span>' +
          '<span>' + (st.blocksBroken || 0) + ' blocs cassés · ' + (st.blocksPlaced || 0) + ' posés · ' +
          Math.floor((st.playTime || 0) / 60) + ' min · ' +
          (pl.mode === 'creative' ? 'créatif' : 'survie') + '</span>' +
          '</div><div class="world-act">' +
          '<button class="btn small" data-load="' + wd.id + '">Jouer</button>' +
          '<button class="btn small danger" data-del="' + wd.id + '">Supprimer</button>' +
          '</div></div>';
      }).join('');
      box.querySelectorAll('[data-load]').forEach(b => b.addEventListener('click', () => {
        root.VCWorld.loadWorld(b.dataset.load).then(d => {
          if (d) startGame(d.id, d.name || 'Monde', d.seed, d);
        });
      }));
      box.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => {
        if (!confirm('Supprimer définitivement cette partie ?')) return;
        root.VCWorld.deleteWorld(b.dataset.del).then(refreshWorldList);
      }));
    }).catch(e => { box.innerHTML = '<div class="menu-note">Stockage local inaccessible : ' + e + '</div>'; });
  }

  /* ----------------------------------------------- Boutons en jeu ----- */
  let gameBtnBound = false;
  function bindGameButtons() {
    if (gameBtnBound) return;
    gameBtnBound = true;
    const btn = (id, fn) => { const e = $(id); if (e) e.addEventListener('click', fn); };

    btn('btn-resume', () => game.togglePause());
    btn('btn-save', () => game.save(false).then(() => game.msg('Sauvegarde écrite')));
    btn('btn-settings-game', () => {
      const box = $('pause-settings');
      if (!box) return;
      const on = box.style.display !== 'block';
      box.style.display = on ? 'block' : 'none';
      if (on) buildSettings(box, game.settings, k => {
        if (k === 'renderDistance') game.world.renderDistance = game.settings.renderDistance;
        if (k === 'sound') game.audio.setVolume(game.settings.sound);
        if (k === 'mipmap') game.renderer.uploadAtlas(game.atlasCanvas, game.settings.mipmap);
        Object.assign(menuSettings, game.settings);
      });
    });
    btn('btn-quit', () => { game.save(true).then(() => root.location.reload()); });
    btn('btn-respawn', () => game.respawn());
    btn('panel-close', () => { game.ui.closePanel(); game.grabPointer(true); });

    // Clic sur le voile — mais non sur le panneau lui-même : fermeture.
    const pan = $('panel');
    if (pan) pan.addEventListener('mousedown', e => {
      if (e.target === pan) { game.ui.closePanel(); game.grabPointer(true); }
    });
  }

  /* ============================================================ Amorçage */
  function init() {
    glCanvas = $('gl');
    hudCanvas = $('hud');
    hud = hudCanvas.getContext('2d');

    // sonde WebGL2 avant toute allocation
    const probe = document.createElement('canvas').getContext('webgl2');
    if (!probe) {
      $('menu-home').innerHTML =
        '<h2>WebGL 2 requis</h2><p class="menu-note">Ce moteur exige WebGL 2 ' +
        '(OpenGL ES 3.0 : VAO, indices 32 bits, GLSL 300 es). Utilisez un navigateur ' +
        'récent et vérifiez que l\'accélération matérielle est active.</p>';
      show('main-menu', true); show('menu-home', true);
      return;
    }

    $('btn-new').addEventListener('click', () => {
      show('menu-home', false); show('menu-create', true);
      $('seed').value = randomSeed();
      $('wname').focus();
    });
    $('btn-load').addEventListener('click', () => {
      show('menu-home', false); show('menu-load', true);
      refreshWorldList();
    });
    $('btn-settings').addEventListener('click', () => {
      show('menu-home', false); show('menu-settings', true);
      buildSettings($('menu-settings-body'), menuSettings);
    });
    document.querySelectorAll('[data-back]').forEach(b => b.addEventListener('click', () => {
      show('menu-create', false); show('menu-load', false); show('menu-settings', false);
      show('menu-home', true);
    }));
    $('btn-random-seed').addEventListener('click', () => { $('seed').value = randomSeed(); });
    $('btn-create').addEventListener('click', () => {
      const name = ($('wname').value || 'Nouveau monde').slice(0, 40);
      const seed = parseSeed($('seed').value);
      const m = document.querySelector('input[name=mode]:checked');
      pendingMode = m ? m.value : 'survival';
      const id = 'w_' + Date.now().toString(36) + '_' + ((Math.random() * 1679616) | 0).toString(36);
      startGame(id, name, seed, null);
    });
    $('wname').addEventListener('keydown', e => { if (e.key === 'Enter') $('btn-create').click(); });
    $('seed').addEventListener('keydown', e => { if (e.key === 'Enter') $('btn-create').click(); });

    show('main-menu', true);
    show('menu-home', true);
    rafId = requestAnimationFrame(frame);

    // Banc d'essai des entrées, déclenché par ?selftest=1
    try {
      if (/[?&]selftest=1\b/.test(root.location.search)) setTimeout(selfTest, 400);
    } catch (e) { /* location inaccessible : sans effet */ }

    root.addEventListener('beforeunload', () => { if (game && game.ready) game.save(true); });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && game && game.ready) game.save(true);
    });
  }

  /* =====================================================================
   *  Auto-test des entrées (?selftest=1)
   *
   *  Éprouve la chaîne réelle clavier → tick → position, et souris → yaw,
   *  sans verrou de pointeur (le repli freeLook doit suffire). Les résultats
   *  sont journalisés en console et déposés dans root.VCSELFTEST.
   * ===================================================================== */
  function selfTest() {
    const out = [];
    const ok = (n, c, d) => { out.push((c ? 'PASS' : 'FAIL') + ' — ' + n + (d ? ' :: ' + d : '')); };
    const wait = ms => new Promise(r => setTimeout(r, ms));

    const key = (type, code) =>
      document.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }));
    const mouse = (type, opt) =>
      glCanvas.dispatchEvent(new MouseEvent(type, Object.assign({ bubbles: true, cancelable: true, button: 0 }, opt)));

    console.log('[SELFTEST] démarrage d\'un monde de test…');
    startGame('selftest', 'Banc d\'essai', 1337, null);

    const ready = () => new Promise(r => {
      const t = setInterval(() => { if (game && game.ready) { clearInterval(t); r(); } }, 120);
    });

    return ready().then(async () => {
      await wait(200);
      ok('partie prête (game.ready)', !!game.ready);
      ok('simulation non figée au démarrage (paused === false)', game.paused === false,
        'paused=' + game.paused);
      ok('focus clavier sur le canvas', document.activeElement === glCanvas,
        'activeElement=' + (document.activeElement && document.activeElement.id));

      /* ---- 1. Le clavier remplit bien le registre de touches ---------- */
      key('keydown', 'KeyW');
      ok('KeyW enregistrée dans game.keys', game.keys.KeyW === true);

      /* ---- 2. Avancer modifie réellement la position ------------------ */
      const p = game.player;
      p.yaw = 0; p.pitch = 0; p.vx = p.vy = p.vz = 0;
      const x0 = p.x, z0 = p.z;
      for (let i = 0; i < 20; i++) game.tick();          // 1 s de simulation
      const d = Math.hypot(p.x - x0, p.z - z0);
      ok('avance sur 20 ticks (déplacement > 0.5 bloc)', d > 0.5, 'd=' + d.toFixed(3));
      key('keyup', 'KeyW');
      ok('KeyW relâchée', game.keys.KeyW === false);

      /* ---- 3. Boucle rAF : tick() est bien appelé --------------------- */
      const t0 = game.stats.playTime;
      p.yaw = Math.PI / 2;
      key('keydown', 'KeyW');
      await wait(500);
      key('keyup', 'KeyW');
      ok('la boucle rAF exécute tick() (playTime progresse)',
        game.stats.playTime > t0 + 0.2, 'Δ=' + (game.stats.playTime - t0).toFixed(3));

      /* ---- 4. Souris SANS verrou : le repli freeLook doit agir -------- */
      ok('aucun verrou de pointeur dans ce contexte', document.pointerLockElement !== glCanvas);
      const yaw0 = p.yaw, pitch0 = p.pitch;
      mouse('mousedown', { clientX: 400, clientY: 300 });
      ok('freeLook armé par le clic maintenu', game.freeLook === true);
      document.dispatchEvent(new MouseEvent('mousemove',
        { bubbles: true, clientX: 500, clientY: 260 }));
      ok('yaw modifié par la souris (repli)', Math.abs(p.yaw - yaw0) > 1e-6,
        'Δyaw=' + (p.yaw - yaw0).toFixed(5));
      ok('pitch modifié par la souris (repli)', Math.abs(p.pitch - pitch0) > 1e-6,
        'Δpitch=' + (p.pitch - pitch0).toFixed(5));
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
      ok('freeLook désarmé au relâchement', game.freeLook === false);

      /* ---- 5. pitch borné à ±90° ------------------------------------- */
      mouse('mousedown', { clientX: 400, clientY: 300 });
      for (let i = 0; i < 40; i++)
        document.dispatchEvent(new MouseEvent('mousemove',
          { bubbles: true, clientX: 400, clientY: 300 + (i + 1) * 200 }));
      ok('pitch borné à -90°', p.pitch > -Math.PI / 2 - 1e-6 && p.pitch <= -Math.PI / 2 + 0.01,
        'pitch=' + p.pitch.toFixed(4));
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));

      /* ---- 6. Un refus de verrou ne met PAS la partie en pause -------- */
      game.paused = false;
      game.hadLock = false;
      document.dispatchEvent(new Event('pointerlockchange'));
      ok('refus de verrou sans mise en pause abusive', game.paused === false,
        'paused=' + game.paused);

      /* ---- 7. Perte de focus : aucune touche « collée » -------------- */
      key('keydown', 'KeyA');
      root.dispatchEvent(new Event('blur'));
      ok('les touches sont relâchées à la perte de focus', !game.keys.KeyA);

      /* ---- 8. Échap met en pause et gèle la simulation --------------- */
      key('keydown', 'Escape');
      ok('Échap met en pause', game.paused === true);
      const t1 = game.stats.playTime;
      await wait(300);
      ok('la simulation est gelée en pause', Math.abs(game.stats.playTime - t1) < 1e-9);
      key('keydown', 'Escape');
      ok('Échap reprend la partie', game.paused === false);

      const fails = out.filter(s => s.indexOf('FAIL') === 0);
      out.forEach(s => console.log('[SELFTEST] ' + s));
      console.log('[SELFTEST] BILAN ' + (out.length - fails.length) + '/' + out.length +
        ' — ' + (fails.length ? 'ÉCHECS: ' + fails.length : 'TOUT PASSE'));
      root.VCSELFTEST = { results: out, failures: fails.length };
      return out;
    }).catch(e => {
      console.log('[SELFTEST] EXCEPTION ' + (e && e.stack ? e.stack : e));
      root.VCSELFTEST = { error: String(e) };
    });
  }

  root.VCMain = { render, drawHUD, fillTileUV, boxMVP, startGame, parseSeed, selfTest };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(typeof self !== 'undefined' ? self : this);
