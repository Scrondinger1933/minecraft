/* ===========================================================================
 * L'ARÈNE ÉTEINTE — entités : joueur, créatures, boss
 *
 * Quatre faunes, trois familles d'IA :
 *   · LA MAIN BLANCHE  — flotte, traque à la vue et au bruit ; meurt si elle
 *     reste trop longtemps dans le faisceau frontal (jauge d'exposition) ;
 *   · LE GARDE D'OS    — garde d'arène, course à la vue, frappe courte ;
 *   · LE SOUFFLE       — mimetique : il ne vous trouve que par VOTRE bruit ;
 *   · ENTERRÉ-VIVANT   — le boss de la crypte, scripté par hstory.
 *
 * Tous partagent le même moteur de collision que le joueur (HC), la même
 * ligne de vue (DDA), et les bruits émis par le joueur (événements).
 *
 * Publie l'objet global : HE. Dépend de HW, HC, HR.
 * ========================================================================= */
(function () {
  'use strict';

  var API = {};
  globalThis.HE = API;

  API.creatures = [];
  API.pickups = [];      /* badges/flacons {x,y,z,taken,kind} */

  /* --------------------------------------------------------------- joueur -- */
  var player = null;
  API.player = function () { return player; };

  API.initPlayer = function (x, y, z) {
    player = {
      body: globalThis.HC.makeBody(0.6, 1.8),
      hp: 100, battery: 100, stamina: 100,
      fear: 0, hurt: 0,
      yaw: Math.PI, pitch: 0,
      flashOn: true, flashPower: 0,
      hidden: null,          /* cachette occupée {x,y,z} */
      bobPhase: 0, duck: 0,
      lastNoise: 0, dead: false, invulnT: 0,
      footDist: 0, stepPhase: 0
    };
    var b = player.body;
    b.x = x; b.y = y; b.z = z;
    API.player = function () { return player; };
    return player;
  };

  var REGEN = 6, DRAIN_SPRINT = 14, DRAIN_FLASH = 2.2;

  API.updatePlayer = function (dt, input, cam) {
    var p = player, b = p.body;
    if (p.dead) { return; }
    p.invulnT = Math.max(0, p.invulnT - dt);

    var wishX = 0, wishZ = 0;
    var fwd = 0, side = 0;
    if (input.keys.KeyW || input.keys.ArrowUp) fwd += 1;
    if (input.keys.KeyS || input.keys.ArrowDown) fwd -= 1;
    if (input.keys.KeyA || input.keys.ArrowLeft) side -= 1;
    if (input.keys.KeyD || input.keys.ArrowRight) side += 1;
    var sprinting = input.keys.ShiftLeft && fwd > 0 && p.stamina > 4 && !p.hidden;
    var crouching = input.keys.ControlLeft || input.keys.ControlRight;
    var speed = crouching ? 1.7 : (sprinting ? 6.8 : 4.1);
    if (p.hidden) speed = 0;

    var len = Math.sqrt(fwd * fwd + side * side) || 1;
    fwd /= len; side /= len;
    var yaw = p.yaw;
    wishX = (-Math.sin(yaw) * fwd + Math.cos(yaw) * side) * speed;
    wishZ = (-Math.cos(yaw) * fwd - Math.sin(yaw) * side) * speed;

    /* inertie douce (fluidité de la caméra) */
    var acc = b.onGround ? 14 : 5;
    b.vx += (wishX - b.vx) * Math.min(1, acc * dt);
    b.vz += (wishZ - b.vz) * Math.min(1, acc * dt);
    b.vy -= 22 * dt;
    if (b.vy < -40) b.vy = -40;
    if (input.jump && b.onGround && !p.hidden) { b.vy = 8.2; b.onGround = false; }

    globalThis.HC.step(b, dt);

    /* fatigue / endurance */
    if (sprinting && (Math.abs(b.vx) + Math.abs(b.vz)) > 3) p.stamina -= DRAIN_SPRINT * dt;
    else p.stamina = Math.min(100, p.stamina + REGEN * dt);
    if (p.stamina < 0) p.stamina = 0;

    /* torche frontale */
    var wantPow = (p.flashOn && !p.hidden) ? 1 : 0;
    p.flashPower += (wantPow - p.flashPower) * Math.min(1, 9 * dt);
    if (p.flashPower > 0.02) {
      p.battery = Math.max(0, p.battery - DRAIN_FLASH * p.flashPower * dt);
      if (p.battery <= 0) { p.flashOn = false; globalThis.HSTATE.flashOut = true; }
    }

    /* bruit du joueur */
    var spd = Math.sqrt(b.vx * b.vx + b.vz * b.vz);
    p.footDist += spd * dt;
    if (p.footDist > (sprinting ? 1.7 : 2.2)) {
      p.footDist = 0;
      p.stepPhase = 1;
      var noiseR = crouching ? 0 : (sprinting ? 26 : 9);
      if (noiseR > 0) API.emitNoise(b.x + b.w / 2, b.y, b.z + b.w / 2, noiseR, 'pas');
      globalThis.HAUDIO.footstep(p.stepPhase, spd);
    }
    p.stepPhase = Math.max(0, p.stepPhase - dt * 5);
    p.bobPhase += spd * dt * 1.9;

    /* la peur : éloignement de la lumière et proximité des créatures */
    var nearFear = 0;
    for (var i = 0; i < API.creatures.length; i++) {
      var c = API.creatures[i];
      if (c.dead) continue;
      var d = API.distBody(p.body, c.body);
      var seen = API.seesCreature(p, c);
      var closeness = Math.max(0, 1 - d / 16);
      nearFear = Math.max(nearFear, closeness * (c.state === 'chase' ? 1 : 0.6) * (seen ? 1 : 0.7));
    }
    var litZone = globalThis.HAUDIO.fearZone(p.battery);
    var target = Math.min(1, nearFear * 0.9 + (1 - p.battery / 100) * 0.25);
    if (litZone < 0.3 && p.flashPower < 0.2) target += 0.12;
    p.fear += (target - p.fear) * Math.min(1, (target > p.fear ? 2.4 : 0.55) * dt);
    p.hurt = Math.max(0, p.hurt - dt * 0.7);
  };

  API.emitNoise = function (x, y, z, radius, kind) {
    API.noises.push({ x: x, y: y, z: z, r: radius, t: 0, kind: kind });
  };
  API.noises = [];

  /* ---------------------------------------------------------- créatures --- */
  API.spawnCreature = function (kind, x, y, z, opts) {
    opts = opts || {};
    var dims = {
      main: [0.55, 1.1], garde: [0.62, 2.05], souffle: [0.5, 1.9], boss: [1.35, 3.1]
    }[kind] || [0.6, 2];
    var c = {
      kind: kind, body: globalThis.HC.makeBody(dims[0], dims[1]),
      hp: opts.hp || 999,
      state: (opts.state || 'lurk'),
      target: null,               /* point vers lequel on va */
      lastSeen: null,
      seeingT: 0, memoryT: 0,
      speed: opts.speed || ({ main: 2.6, garde: 3.4, souffle: 2.2, boss: 3.1 }[kind] || 2.5),
      lungeT: 0, coolT: 0, phase: Math.random() * 7,
      exposure: 0,                /* Main Blanche : lumière reçue          */
      dead: false, anim: 0, yaw: 0,
      anchor: opts.anchor || null, /* est-ce qu'on reste près de ça ?       */
      vulnerableLight: !!opts.vulnerableLight,
      copyNoise: !!opts.copyNoise,
      onCatch: opts.onCatch || null
    };
    c.body.x = x; c.body.y = y; c.body.z = z;
    API.creatures.push(c);
    return c;
  };

  API.removeCreature = function (c) {
    var i = API.creatures.indexOf(c);
    if (i >= 0) API.creatures.splice(i, 1);
    c.dead = true;
  };

  API.clearCreatures = function () {
    API.creatures.length = 0;
  };

  API.distBody = function (a, b) {
    var dx = (a.x + a.w / 2) - (b.x + b.w / 2);
    var dy = a.y - b.y, dz = (a.z + a.w / 2) - (b.z + b.w / 2);
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  };

  API.eyeOf = function (body) {
    return [body.x + body.w / 2, body.y + body.h * 0.85, body.z + body.w / 2];
  };

  API.seesCreature = function (p, c) {
    var eye = API.eyeOf(p.body);
    var ce = API.eyeOf(c.body);
    var dx = ce[0] - eye[0], dy = ce[1] - eye[1], dz = ce[2] - eye[2];
    var d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d > 34) return false;
    return globalThis.HC.los(eye[0], eye[1], eye[2], ce[0], ce[1], ce[2]);
  };

  /* ----------------------------------------------------------- update IA -- */
  API.updateCreatures = function (dt, cam) {
    var p = player;
    var pe = API.eyeOf(p.body);
    for (var i = 0; i < API.creatures.length; i++) updateCreature(API.creatures[i], dt, pe, cam);
    /* événements de bruit */
    for (var n2 = API.noises.length - 1; n2 >= 0; n2--) {
      API.noises[n2].t += dt;
      if (API.noises[n2].t > 0.4) API.noises.splice(n2, 1);
    }
  };

  function steer(cc, tx, tz, dt, speedMult) {
    var b = cc.body;
    var dx = tx - (b.x + b.w / 2), dz = tz - (b.z + b.w / 2);
    var d = Math.sqrt(dx * dx + dz * dz);
    if (d < 0.25) { b.vx *= 0.8; b.vz *= 0.8; return true; }
    dx /= d; dz /= d;
    var sp = cc.speed * (speedMult || 1);
    b.vx += (dx * sp - b.vx) * Math.min(1, 8 * dt);
    b.vz += (dz * sp - b.vz) * Math.min(1, 8 * dt);
    cc.yaw = Math.atan2(dx, dz);
    return false;
  }

  function updateCreature(c, dt, pe, cam) {
    if (c.dead) return;
    var b = c.body;
    b.vy -= 22 * dt;
    var ce = API.eyeOf(b);
    var toPlayerD = Math.sqrt(
      Math.pow(pe[0] - ce[0], 2) + Math.pow(pe[1] - ce[1], 2) + Math.pow(pe[2] - ce[2], 2));

    /* ---- La Main Blanche : vulnerable au faisceau ---- */
    if (c.kind === 'main' && c.vulnerableLight) {
      var fp = globalThis.HE.player();
      var fd = [pe[0] - ce[0], pe[1] - ce[1], pe[2] - ce[2]];
      var dlen = Math.max(0.01, Math.sqrt(fd[0] * fd[0] + fd[1] * fd[1] + fd[2] * fd[2]));
      if (fp.flashPower > 0.5 && toPlayerD < 16) {
        var cyv = Math.cos(fp.yaw), syv = Math.sin(fp.yaw);
        var cp = Math.cos(fp.pitch), sp = Math.sin(fp.pitch);
        var beam = [syv * cp, sp, -cyv * cp];
        var dotto = (beam[0] * fd[0] + beam[1] * fd[1] + beam[2] * fd[2]) / dlen;
        var inCone = dotto > 0.88;
        if (inCone) {
          c.exposure += dt * 34;
          if (c.exposure >= 100) { c.dead = true; if (c.onKillLight) c.onKillLight(c); }
        } else {
          c.exposure = Math.max(0, c.exposure - dt * 8);
        }
      } else {
        c.exposure = Math.max(0, c.exposure - dt * 10);
      }
      c.LightHurt = c.exposure / 100;
      if (c.dead) { globalThis.HAUDIO.ev('banish'); return; }
    }

    /* ---- détection : vue + audition + immersion ---- */
    var sees = false;
    if (!p.hidden) {
      if (toPlayerD < (c.kind === 'boss' ? 42 : 30)) {
        sees = globalThis.HC.los(ce[0], ce[1], ce[2], pe[0], pe[1], pe[2]);
        if (sees && c.kind !== 'main' && c.kind !== 'boss') {
          var fx = Math.sin(c.yaw), fz = Math.cos(c.yaw);
          var nd = [pe[0] - ce[0], pe[2] - ce[2]];
          var nl = Math.sqrt(nd[0] * nd[0] + nd[1] * nd[1]) || 1;
          var dot = (fx * nd[0] / nl + fz * nd[1] / nl);
          if (dot < 0.1 && toPlayerD > 3.5) sees = false;
        }
      }
    }
    if (sees) { c.lastSeen = [pe[0], pe[2]]; c.memoryT = 4.5; c.seeingT += dt; }
    else c.seeingT = Math.max(0, c.seeingT - dt);
    if (c.memoryT > 0) c.memoryT -= dt;

    /* audition */
    if (!p.hidden) {
      for (var ni = 0; ni < API.noises.length; ni++) {
        var nn = API.noises[ni];
        var ndx = nn.x - ce[0], ndy = nn.y - ce[1], ndz = nn.z - ce[2];
        var nd2 = Math.sqrt(ndx * ndx + ndy * ndy + ndz * ndz);
        if (nd2 < nn.r) {
          if (c.state !== 'chase' && c.state !== 'lunge') c.state = 'hunt';
          c.target = [nn.x, nn.z];
        }
      }
    }

    /* ---- machine à états ---- */
    var arrived = false;
    if (c.state === 'lurk') {
      if (!c.target && c.anchor && Math.random() < dt * 0.7) {
        var aa = Math.random() * Math.PI * 2, ar = 4 + Math.random() * 5;
        c.target = [c.anchor[0] + Math.cos(aa) * ar, c.anchor[1] + Math.sin(aa) * ar];
      }
      if (c.target) arrived = steer(c, c.target[0], c.target[1], dt, 0.55);
      if (arrived) c.target = null;
      if (sees && toPlayerD < 22) c.state = 'hunt';
    } else if (c.state === 'hunt') {
      if (c.target) arrived = steer(c, c.target[0], c.target[1], dt, 0.85);
      if (arrived) c.target = null;
      if (sees && toPlayerD < (c.kind === 'garde' ? 16 : 18)) c.state = 'chase';
      else if (!c.target && c.memoryT <= 0) c.state = 'lurk';
    } else if (c.state === 'chase') {
      var tl = c.lastSeen || [pe[0], pe[2]];
      var useP = (!p.hidden && sees) ? pe : (c.lastSeen ? [c.lastSeen[0], c.lastSeen[1]] : null);
      if (useP) arrived = steer(c, useP[0], useP[1], dt, 1.0);
      if (arrived && c.memoryT <= 0) { c.state = 'hunt'; c.target = null; }
      var dtouch = toPlayerD < (c.kind === 'boss' ? 2.6 : 1.5);
      if (dtouch) {
        c.state = 'lunge';
        c.lungeT = 0;
      }
    } else if (c.state === 'lunge') {
      c.lungeT += dt;
      var nice = steer(c, pe[0], pe[2], dt, 1.6);
      if (c.lungeT > 0.6) {
        if (toPlayerD < (c.kind === 'boss' ? 2.8 : 1.7) && !p.hidden && p.invulnT <= 0 && !p.dead) {
          damagePlayer(c);
        }
        c.coolT = 0.8;
        c.state = sees ? 'chase' : 'hunt';
      }
    }
    if (c.coolT > 0) c.coolT -= dt;

    /* chute, collision, frénésie */
    globalThis.HC.step(b, dt);
    c.anim += Math.sqrt(b.vx * b.vx + b.vz * b.vz) * dt * 2.4;
    /* les créatures ne quittent jamais ETH leur niveau (ancre) */
    if (c.anchor) {
      var aDist = Math.max(Math.abs(b.x - c.anchor[0]), Math.abs(b.z + .3 - c.anchor[1]));
      if (aDist > 13) {
        steer(c, c.anchor[0], c.anchor[1], dt, 1.1);
      }
    }
  }

  function damagePlayer(c) {
    var p = player;
    var dmg = c.kind === 'boss' ? 100 : (c.kind === 'garde' ? 40 : 30);
    p.hp -= dmg;
    p.hurt = 1;
    p.invulnT = 1.2;
    globalThis.HAUDIO.ev(c.kind === 'boss' ? 'roar' : 'bite');
    var b = p.body, cb = c.body;
    var dx = (b.x + b.w / 2) - (cb.x + cb.w / 2), dz = (b.z + b.w / 2) - (cb.z + cb.w / 2);
    var dl = Math.sqrt(dx * dx + dz * dz) || 1;
    b.vx += dx / dl * 7; b.vz += dz / dl * 7;
    if (p.hp <= 0) { p.dead = true; if (API.onPlayerDead) API.onPlayerDead(c); }
  }

  /* ------------------------------------------------------------- pickups -- */
  API.spawnPickup = function (x, y, z, kind) {
    API.pickups.push({ x: x, y: y, z: z, kind: kind || 'badge', taken: false, t: Math.random() * 10 });
  };

  API.updatePickups = function (dt) {
    var b = player.body;
    for (var i = 0; i < API.pickups.length; i++) {
      var it = API.pickups[i];
      if (it.taken) continue;
      it.t += dt;
      var dx = it.x - (b.x + b.w / 2), dy = it.y - (b.y + 0.9), dz = it.z - (b.z + b.w / 2);
      if (dx * dx + dy * dy + dz * dz < 1.2) {
        it.taken = true;
        if (API.onPickup) API.onPickup(it);
      }
    }
  };

  /* ------------------------------------------------------------- rigs ----- */
  /* partir d'une transformation locale (matrice) — HR.mat fournit l'outillage */
  function limb(list, mat, color, em) {
    list.push({ mat: mat, color: color, em: em || 0 });
  }

  function boneRig(e, t) {
    var m = [];
    var b = e.body;
    var M = globalThis.HR.mat;
    var walk = Math.sin(e.anim * 2.4) * 0.5;
    if (e.kind === 'main') {
      /* le palmier flottant */
      var hover = b.y + 0.55 + Math.sin(t * 2.1 + e.phase) * 0.12;
      var base = M.m4();
      base = M.translate(base, b.x + b.w / 2, hover, b.z + b.w / 2);
      base = M.rotY(base, Math.sin(t * 0.8 + e.phase) * 0.9);
      var palm = M.scale(M.m4(), 0.46, 0.13, 0.44);
      limb(m, M.mul(base, M.translate(palm, 0, 0, 0)), [0.86, 0.85, 0.78], 0.10);
      for (var f = 0; f < 5; f++) {
        var fh = (e.state === 'chase' || e.state === 'lunge') ? 0.55 : 0.4;
        var ang = -0.55 + f * 0.27 + Math.sin(t * 3 + f) * 0.06;
        var ff = M.m4();
        ff = M.translate(base, (f - 2) * 0.09, 0.1 + fh / 2, -0.18);
        ff = M.rotX(ff, ang);
        ff = M.mul(ff, M.scale(M.m4(), 0.07, fh, 0.07));
        limb(m, ff, [0.88, 0.87, 0.80], 0.12);
      }
      return m;
    }
    if (e.kind === 'garde') {
      var base2 = M.m4();
      base2 = M.translate(base2, b.x + b.w / 2, b.y, b.z + b.w / 2);
      base2 = M.rotY(base2, e.yaw || 0);
      /* jambes */
      for (var l = 0; l < 2; l++) {
        var leg = M.m4();
        leg = M.translate(base2, 0, 0.45, 0);
        leg = M.rotX(leg, l ? walk : -walk);
        leg = M.mul(leg, M.scale(M.m4(), 0.16, 0.9, 0.16));
        leg = M.mul(leg, M.translate(M.m4(), 0, -0.45, 0));
        limb(m, leg, [0.55, 0.5, 0.42], 0.02);
      }
      /* torse — os protégé d'un vieux pbanquier */
      var tor = M.mul(base2, M.scale(M.translate(M.m4(), 0, 1.05, 0), 0.55, 0.65, 0.32));
      limb(m, tor, [0.80, 0.75, 0.66], 0.03);
      /* crâne avec l'avant-masque de la mort */
      var head = M.mul(base2, M.scale(M.translate(M.m4(), 0, 1.65, 0.02), 0.32, 0.34, 0.32));
      limb(m, head, [0.92, 0.90, 0.84], 0.06);
      /* bras + massue d'os */
      for (var ar = 0; ar < 2; ar++) {
        var arm = M.m4();
        arm = M.translate(base2, ar ? 0.36 : -0.36, 1.35, 0);
        arm = M.rotX(arm, (ar ? -1 : 1) * (walk * 0.9 + 0.15));
        arm = M.mul(arm, M.scale(M.m4(), 0.13, 0.75, 0.13));
        arm = M.mul(arm, M.translate(M.m4(), 0, -0.37, 0));
        limb(m, arm, [0.7, 0.66, 0.58], 0.02);
        var club = M.mul(base2, M.scale(M.translate(M.m4(), ar ? 0.5 : -0.5, 1.05, 0.35), 0.09, 0.7, 0.09));
        limb(m, club, [0.95, 0.93, 0.86], 0.05);
      }
      return m;
    }
    if (e.kind === 'souffle') {
      var base3 = M.m4();
      base3 = M.translate(base3, b.x + b.w / 2, b.y, b.z + b.w / 2);
      base3 = M.rotY(base3, e.yaw || 0);
      var veil = M.mul(base3, M.scale(M.translate(M.m4(), 0, 0.95 + Math.sin(t * 2.7) * 0.05, 0), 0.5, 1.9, 0.14));
      limb(m, veil, [0.05, 0.05, 0.06], 0.0);
      var headS = M.mul(base3, M.scale(M.translate(M.m4(), 0, 1.85, 0.02), 0.26, 0.26, 0.12));
      limb(m, headS, [0.02, 0.02, 0.02], 0.0);
      return m;
    }
    if (e.kind === 'boss') {
      var base4 = M.m4();
      base4 = M.translate(base4, b.x + b.w / 2, b.y, b.z + b.w / 2);
      base4 = M.rotY(base4, e.yaw || 0);
      var torb = M.mul(base4, M.scale(M.translate(M.m4(), 0, 1.5, 0), 1.5, 1.4, 1.0));
      limb(m, torb, [0.42, 0.30, 0.28], 0.04);
      var headB = M.mul(base4, M.scale(M.translate(M.m4(), 0, 2.55, 0.12), 0.6, 0.66, 0.6));
      limb(m, headB, [0.5, 0.42, 0.40], 0.05);
      for (var ab = 0; ab < 2; ab++) {
        var armB = M.m4();
        armB = M.translate(base4, ab ? 0.95 : -0.95, 2.0, 0);
        armB = M.rotX(armB, Math.sin(e.anim * 1.4 + ab * 3) * 0.4 - 0.4);
        armB = M.mul(armB, M.scale(M.m4(), 0.38, 1.6, 0.38));
        armB = M.mul(armB, M.translate(M.m4(), 0, -0.8, 0));
        limb(m, armB, [0.45, 0.34, 0.31], 0.03);
      }
      return m;
    }
    return m;
  }
  API.rigOf = boneRig;

  /* recommencer au dernier checkpoint */
  API.onPlayerDead = null;
})();
