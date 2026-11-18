/* ===========================================================================
 * L'ARÈNE ÉTEINTE — boucle de jeu, entrées, UI, cinématique d'ouverture
 *
 * Simulation à pas fixe 120 Hz (accumulateur), rendu rAF, caméra à
 * interpolation douce, HUD 2D, journal, cinématiques d'intro et d'événements.
 *
 * Publie : HSTATE (état global), UI (interface), HMAIN.
 * Dépend de : HNoise, HW, HM, HR, HC, HE, HAUDIO, HSTORY.
 * ========================================================================= */
(function () {
  'use strict';

  var API = {};
  globalThis.HMAIN = API;

  globalThis.HSTATE = {
    quality: 1,           /* résolution interne : 0.5 | 0.85 | 1            */
    dawn: 0, dawnTarget: 0,
    flashOut: false,
    shake: 0
  };

  /* ------------------------------------------------------------------ UI -- */
  var UI = {};
  globalThis.UI = UI;

  UI.toast = function (text, secs) {
    var el = document.getElementById('h-toast');
    el.textContent = text;
    el.style.opacity = '1';
    clearTimeout(UI._toastT);
    UI._toastT = setTimeout(function () { el.style.opacity = '0'; }, (secs || 3) * 1000);
  };

  UI.objective = function (text) {
    document.getElementById('h-objective').textContent = text;
  };

  UI.setBadges = function (n) {
    var dots = '';
    for (var i = 0; i < 4; i++) dots += '<i class="' + (i < n ? 'on' : '') + '"></i>';
    document.getElementById('h-badges').innerHTML = dots;
  };

  UI.setLetterbox = function (on) {
    document.getElementById('h-cine').classList.toggle('active', !!on);
  };

  UI.showCineLine = function (text) {
    var el = document.getElementById('h-cine-line');
    if (!text) { el.textContent = ''; return; }
    if (UI._cineLine === text) return;
    UI._cineLine = text;
    typewriter(el, text, 26);
  };

  function typewriter(el, text, cps) {
    clearInterval(UI._tw);
    el.textContent = '';
    var i = 0;
    UI._tw = setInterval(function () {
      i += 1;
      el.textContent = text.slice(0, i);
      if (i >= text.length) clearInterval(UI._tw);
    }, 1000 / cps);
  }

  UI.journalChanged = function () { /* badge visuel sur le bouton */ };

  UI.updateMeters = function (p) {
    document.getElementById('m-battery').style.width = p.battery + '%';
    document.getElementById('m-stamina').style.width = p.stamina + '%';
    document.getElementById('m-fear').style.width = (p.fear * 100) + '%';
    document.getElementById('m-hp').style.width = Math.max(0, p.hp) + '%';
  };

  UI.journalTag = function (n) {
    document.getElementById('h-tab-journal').textContent = 'Journal (' + n + ')';
  };

  UI.shake = function (amount) { globalThis.HSTATE.shake = Math.max(globalThis.HSTATE.shake, amount); };

  UI.showInteract = function (text) {
    var el = document.getElementById('h-interact');
    if (text) { el.textContent = text; el.style.opacity = '1'; }
    else { el.style.opacity = '0'; }
  };

  UI.altarProgress = function (pct) {
    var el = document.getElementById('h-altar-fill');
    if (!el) return;
    el.style.width = (pct * 100).toFixed(1) + '%';
    document.getElementById('h-altar').style.display = pct > 0.01 ? 'block' : 'none';
  };

  UI.gameOver = function (good, title, text) {
    var el = document.getElementById('h-end');
    document.getElementById('h-end-title').textContent = title;
    document.getElementById('h-end-text').textContent = text;
    el.classList.add('active');
    el.dataset.good = good ? '1' : '0';
    document.exitPointerLock && document.exitPointerLock();
  };

  /* -------------------------------------------------------------- entrées -- */
  var input = { keys: {}, jump: false, interact: false, interactHold: false };

  document.addEventListener('keydown', function (e) {
    if (e.repeat) { return; }
    input.keys[e.code] = true;
    if (e.code === 'Space') input.jump = true;
    if (e.code === 'KeyF') toggleFlash();
    if (e.code === 'KeyE') input.interact = true;
    if (e.code === 'KeyJ') toggleJournal();
    if (e.code === 'Enter' || e.code === 'Escape') {
      if (globalThis.HSTORY.cine) globalThis.HSTORY.cineSkip();
      else if (e.code === 'Escape') togglePause();
    }
  });
  document.addEventListener('keyup', function (e) { input.keys[e.code] = false; });

  var canvas = null;
  function lockPointer() { canvas && canvas.requestPointerLock && canvas.requestPointerLock(); }
  document.addEventListener('pointerlockchange', function () {
    var locked = document.pointerLockElement === canvas;
    if (!locked && globalThis.HMAIN.state === 'play') togglePause(true);
  });
  document.addEventListener('mousemove', function (e) {
    if (document.pointerLockElement !== canvas) return;
    var p = globalThis.HE.player();
    if (!p) return;
    var s = (globalThis.HMAIN.sens || 1) * 0.0022;
    p.yaw -= e.movementX * s;
    p.pitch -= e.movementY * s;
    p.pitch = Math.max(-1.4, Math.min(1.4, p.pitch));
  });
  document.addEventListener('mousedown', function (e) {
    if (globalThis.HMAIN.state !== 'play') return;
    if (document.pointerLockElement !== canvas) { lockPointer(); return; }
    if (e.button === 2) { /* clic droit : torche, comme F */ toggleFlash(); }
  });
  document.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  function toggleFlash() {
    var p = globalThis.HE.player();
    if (!p || p.battery <= 0) return;
    p.flashOn = !p.flashOn;
    globalThis.HAUDIO.ev('glitch');
  }

  /* -------------------------------------------------------------- journal -- */
  function toggleJournal(force) {
    var el = document.getElementById('h-journal');
    var show = (force !== undefined) ? force : !el.classList.contains('active');
    el.classList.toggle('active', show);
    if (show) renderJournal();
  }

  function renderJournal() {
    var entries = globalThis.HSTORY.journal;
    var html = '';
    for (var i = entries.length - 1; i >= 0; i--) {
      html += '<div class="jr-entry"><h3>' + esc(entries[i].title) + '</h3><p>' +
        esc(entries[i].text).replace(/\n/g, '<br>') + '</p></div>';
    }
    document.getElementById('h-journal-list').innerHTML = html || '<p>Le journal est vierge.</p>';
    UI.journalTag(entries.length);
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* --------------------------------------------------------------- pause -- */
  function togglePause(force) {
    var el = document.getElementById('h-pause');
    var show = (force !== undefined) ? force : !el.classList.contains('active');
    el.classList.toggle('active', show);
    if (show) document.exitPointerLock && document.exitPointerLock();
    if (!show) lockPointer();
  }

  /* ------------------------------------------------------------- boot ------- */
  API.state = 'boot';  /* boot | menu | intro | play | pause | dead | end */

  var camPos = [0, 30, 0], camYaw = 0, camPitch = 0;

  API.boot = function () {
    canvas = document.getElementById('h-gl');
    globalThis.HW.init(1996);
    globalThis.HM.init();
    globalThis.HR.init(canvas);
    globalThis.HE.initPlayer(globalThis.HW.spawn.x, globalThis.HW.spawn.y, globalThis.HW.spawn.z);
    /* événements de jeu */
    globalThis.HE.onPickup = function (it) {
      if (it.kind === 'badge') globalThis.HSTORY.badgeCollected(globalThis.HSTORY.activeArena() ? globalThis.HSTORY.activeArena().lvl : currentArenaGuess());
    };
    globalThis.HW.onBlockChanged = function (x, y, z) {
      globalThis.HM.markDirty(x, y, z);
    };
    API.state = 'menu';
    document.getElementById('h-menu').classList.add('active');
    document.getElementById('h-loadbar').style.width = '100%';
    requestAnimationFrame(loop);
  };

  function currentArenaGuess() {
    var b = globalThis.HE.player().body;
    return globalThis.HW.levelOf(b.y);
  }

  /* menu */
  document.getElementById('btn-jouer').addEventListener('click', function () {
    document.getElementById('h-menu').classList.remove('active');
    startIntro();
  });
  document.getElementById('btn-rejouer').addEventListener('click', function () {
    document.getElementById('h-end').classList.remove('active');
    location.reload();
  });
  document.getElementById('btn-resume').addEventListener('click', function () { togglePause(false); });
  document.getElementById('btn-quit').addEventListener('click', function () { location.reload(); });
  document.getElementById('btn-retry').addEventListener('click', function () {
    document.getElementById('h-death').classList.remove('active');
    globalThis.HSTORY.respawn();
    lockPointer();
  });
  document.getElementById('btn-sens').addEventListener('input', function (e) {
    globalThis.HMAIN.sens = parseFloat(e.target.value);
  });
  document.getElementById('btn-vol').addEventListener('input', function (e) {
    globalThis.HAUDIO.setVolume(parseFloat(e.target.value));
  });

  /* -------------------------------------------------------- cinématique --- */
  function startIntro() {
    API.state = 'intro';
    globalThis.HAUDIO.start();
    globalThis.HAUDIO.resume();
    globalThis.HSTORY.playCinematic({
      dur: 17,
      steps: [
        { t0: 0.0, t1: 5.0,  text: 'Kanto, 1996. La Ligue a condamné la Maison des Arènes après Lavanville.' },
        { t0: 5.0, t1: 10.0, text: 'Huit salles. Huit badges. Un maître. Quatre-vingt-onze victoires.' },
        { t0: 10.0, t1: 15.0, text: 'Ils ont scellé la crypte avec un pensionnaire de trop.' },
        { t0: 15.0, t1: 17.0, text: 'Vous êtes l\'expert en sceaux. Le premier sceau est au premier étage.' }
      ],
      onStart: function () { API.cineT = 0; globalThis.HSTORY.setPhase('play'); },
      onEnd: function () {
        API.state = 'play';
        globalThis.HW.setSigil(1, true);   /* le premier sceau se défait */
        globalThis.HAUDIO.ev('sigil');
        globalThis.UI.objective(globalThis.HSTORY.objectiveText(null));
        globalThis.UI.setBadges(0);
        globalThis.UI.journalTag(0);
        lockPointer();
      }
    });
    /* points de caméra : au-dessus des ruines jusqu'au portail sud */
    API.cineCam = {
      a: { pos: [globalThis.HW.CX + 26, 52, globalThis.HW.CZ + 34], yaw: Math.PI * 0.75, pitch: -0.32 },
      b: { pos: [globalThis.HW.CX + 0.5, 26.4, globalThis.HW.CZ + 16], yaw: Math.PI, pitch: -0.05 }
    };
  }

  /* ------------------------------------------------------- interactions --- */
  function findInteract() {
    var p = globalThis.HE.player();
    if (!p) return null;
    var eye = globalThis.HE.eyeOf(p.body);
    var cy = Math.cos(p.yaw), sy = Math.sin(p.yaw);
    var cp = Math.cos(p.pitch), sp = Math.sin(p.pitch);
    var dir = [sy * cp, sp, -cy * cp];
    /* 1) un objet interact à portée de clic ? */
    var best = null, bestD = 2.8;
    var hw = globalThis.HW;
    function consider(x, y, z, kind, data) {
      var dx = x - eye[0], dy = y - eye[1], dz = z - eye[2];
      var d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > bestD) return;
      /* dans le champ ? */
      var dl = Math.max(0.01, d);
      var dot = (dir[0] * dx / dl + dir[1] * dy / dl + dir[2] * dz / dl);
      if (dot < 0.75) return;
      best = { x: x, y: y, z: z, kind: kind, data: data, d: d };
      bestD = d;
    }
    var i;
    for (i = 0; i < hw.candles.length; i++) {
      var c = hw.candles[i];
      if (!c.lit) consider(c.x + 0.5, c.y + 0.5, c.z + 0.5, 'candle', c);
    }
    for (i = 0; i < hw.hideSpots.length; i++) {
      var hs = hw.hideSpots[i];
      consider(hs.x + 0.5, hs.y + 0.5, hs.z + 0.5, 'hide', hs);
    }
    for (i = 0; i < hw.murals.length; i++) {
      var m = hw.murals[i];
      consider(m.x + 0.5, m.y + 0.5, m.z + 0.5, 'mural', m);
    }
    for (i = 0; i < hw.graves.length; i++) {
      var g = hw.graves[i];
      consider(g.x + 0.5, g.y + 0.5, g.z + 0.5, 'grave', g);
    }
    /* autel de l'arène active (progression maintien) */
    var arena = globalThis.HSTORY.activeArena();
    if (arena && arena.state === 'active' && globalThis.HSTORY.TRIALS[arena.kind].altarHold > 0) {
      consider(arena.altar.x + 0.5, arena.altar.y + 0.5, arena.altar.z + 0.5, 'altar', arena);
    }
    /* sceaux proches (message de blocage) */
    if (!best) {
      var hit = globalThis.HC.raycast(eye[0], eye[1], eye[2], dir[0], dir[1], dir[2], 2.6);
      if (hit.hit && hw.get(hit.x, hit.y, hit.z) === hw.B.SCEAU) {
        best = { kind: 'sigil', data: hit };
      }
    }
    return best;
  }

  function handleInteract(dt) {
    var target = (input.interact || input.keys.KeyE) ? findInteract() : currentInteract;
    currentInteract = target;
    window.HINTERACT = target;
    if (!target) {
      UI.showInteract('');
      UI.altarProgress(0);
      return;
    }
    var label = '';
    switch (target.kind) {
      case 'candle': label = '[E] Allumer la bougie'; break;
      case 'hide': label = '[E] Se cacher dans les rideaux'; break;
      case 'mural': label = '[E] Lire la fresque'; break;
      case 'grave': label = '[E] Lire la pierre'; break;
      case 'altar': label = '[E MAINTENU] Retirer le badge'; break;
      case 'sigil': label = 'Le sceau est scellé.'; break;
    }
    UI.showInteract(label);
    var p = globalThis.HE.player();

    if (target.kind === 'altar') {
      /* l'autel exige de te tenir proche ET que le garde ne te touche pas */
      var arena = target.data;
      var dist = Math.abs(target.x - (p.body.x + p.body.w / 2)) +
                 Math.abs(target.z - (p.body.z + p.body.w / 2));
      var closeOk = dist < 3.0;
      var hold = !!input.keys.KeyE && closeOk;
      var res = globalThis.HSTORY.updateAltarHold(dt, hold);
      UI.altarProgress(res.pct);
      if (res.pct >= 1) input.interact = false;
      return;
    }
    if (!input.interact) { UI.altarProgress(0); return; }

    switch (target.kind) {
      case 'candle':
        target.data.lit = true;
        globalThis.HW.lamps.push({
          x: target.data.x + 0.5, y: target.data.y + 0.7, z: target.data.z + 0.5,
          rad: 12, gl: 1.1, color: [1.0, 0.7, 0.35], phase: Math.random() * 100, flicker: 1
        });
        globalThis.HW.set(target.data.x, target.data.y, target.data.z, globalThis.HW.B.CANDLE);
        globalThis.HAUDIO.ev('candle');
        globalThis.HE.emitNoise(target.data.x, target.data.y, target.data.z, 24, 'bougie');
        if (target.data.arena) globalThis.HSTORY.onCandleLit(target.data.arena);
        break;
      case 'hide':
        if (p.hidden) { p.hidden = null; UI.toast('Vous sortez.', 1.5); }
        else {
          p.hidden = target.data;
          p.body.x = target.data.x + 0.5 - p.body.w / 2;
          p.body.z = target.data.z + 0.5 - p.body.w / 2;
          p.body.vx = 0; p.body.vz = 0;
          UI.toast('Caché. Respirez doucement.', 2.5);
        }
        globalThis.HAUDIO.ev('door');
        break;
      case 'mural':
        UI.toast(target.data.text.replace(/\n/g, ' — '), 6);
        break;
      case 'grave':
        UI.toast('« Revenez quand l\'aube sera sûre. » Ils n\'ont jamais dit qui.', 5);
        globalThis.HSTORY.addJournal('Une pierre du cimetière', '« Revenez quand l\'aube sera sûre. »');
        break;
      case 'sigil':
        var need = globalThis.HSTORY.badges;
        UI.toast(need >= 4 ? 'Le sceau tremble…' : 'Le sceau réclame les quatre badges (' + need + '/4).', 3);
        globalThis.HAUDIO.ev('door');
        break;
    }
    input.interact = false;
  }
  var currentInteract = null;

  /* --------------------------------------------------- détection d'arène -- */
  var cryptTriggered = false;
  function checkZones() {
    var st = globalThis.HSTORY;
    if (st.phase() !== 'play' && st.phase() !== 'arena' && st.phase() !== 'crypt') return;
    var b = globalThis.HE.player().body;
    var lvl = globalThis.HW.levelOf(b.y);
    var ars = globalThis.HW.arenas;
    for (var i = 0; i < ars.length; i++) {
      var a = ars[i];
      if (a.lvl !== lvl || a.state !== 'sealed') continue;
      var dx = b.x - globalThis.HW.CX, dz = b.z - globalThis.HW.CZ;
      if (dx * dx + dz * dz < 64) globalThis.HSTORY.onEnterArena(a);
    }
    /* crypte : déclenche la séquence finale */
    if (lvl === -1 && st.badges >= 4 && !cryptTriggered && st.phase() !== 'crypt') {
      cryptTriggered = true;
      globalThis.HSTORY.cryptSequence();
      globalThis.HSTORY.checkpoint();
    }
    if (st.phase() === 'crypt' || st.boss) globalThis.HSTORY.updateBoss();
  }

  /* ----------------------------------------------------------- lampes ----- */
  var lampSelTimer = 0, lampsNear = [];
  function gatherLamps(dt) {
    lampSelTimer -= dt;
    if (lampSelTimer > 0) return;
    lampSelTimer = 0.25;
    var p = globalThis.HE.player();
    var cp = camPos;
    var ls = globalThis.HW.lamps;
    var scored = [];
    for (var i = 0; i < ls.length; i++) {
      var L = ls[i];
      var dx = L.x - cp[0], dy = L.y - cp[1], dz = L.z - cp[2];
      var d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > 26 * 26) continue;
      scored.push([d2, L]);
    }
    scored.sort(function (a, b) { return a[0] - b[0]; });
    lampsNear = [];
    for (var j = 0; j < scored.length && j < 14; j++) lampsNear.push(scored[j][1]);
  }

  /* ------------------------------------------------------- particules ----- */
  var dust = [];
  function initDust() {
    dust = [];
    for (var i = 0; i < 46; i++) {
      dust.push({
        x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 999,
        seed: Math.random() * 1000, active: false
      });
    }
  }
  function updateDust(dt) {
    var cp = camPos;
    var n = globalThis.HNoise;
    for (var i = 0; i < dust.length; i++) {
      var d = dust[i];
      if (!d.active) {
        if (Math.random() < dt * 2.0) {
          d.active = true; d.life = 6 + Math.random() * 4;
          d.x = cp[0] + (Math.random() - 0.5) * 10;
          d.y = cp[1] + (Math.random() - 0.5) * 6;
          d.z = cp[2] + (Math.random() - 0.5) * 10;
          d.vx = (Math.random() - 0.5) * 0.14;
          d.vy = -0.05 - Math.random() * 0.1;
          d.vz = (Math.random() - 0.5) * 0.14;
        }
        continue;
      }
      d.life -= dt;
      if (d.life <= 0 || globalThis.HW.solidAt(d.x, d.y, d.z)) { d.active = false; continue; }
      d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
    }
  }
  function dustEntities() {
    var out = [];
    var M = globalThis.HR.mat;
    var s = 0.035;
    for (var i = 0; i < dust.length; i++) {
      var d = dust[i];
      if (!d.active) continue;
      var m = M.m4();
      m = M.translate(m, d.x, d.y, d.z);
      m = M.mul(m, M.scale(M.m4(), s, s, s));
      out.push({ mat: m, color: [0.75, 0.73, 0.7], em: 0.32 });
    }
    return out;
  }

  /* ------------------------------------------------------------ pickups -- */
  function pickupEntities(list) {
    var pks = globalThis.HE.pickups;
    var M = globalThis.HR.mat;
    for (var i = 0; i < pks.length; i++) {
      var it = pks[i];
      if (it.taken) continue;
      var m = M.m4();
      m = M.translate(m, it.x, it.y + 0.35 + Math.sin(it.t * 2.2) * 0.12, it.z);
      m = M.rotY(m, it.t * 1.8);
      m = M.mul(m, M.scale(M.m4(), 0.24, 0.05, 0.16));
      list.push({ mat: m, color: [1.0, 0.78, 0.28], em: 1.1 });
      var m2 = M.m4();
      m2 = M.translate(m2, it.x, it.y + 0.35 + Math.sin(it.t * 2.2) * 0.12, it.z);
      m2 = M.rotY(m2, -it.t * 1.1);
      m2 = M.mul(m2, M.scale(M.m4(), 0.05, 0.24, 0.05));
      list.push({ mat: m2, color: [1.0, 0.85, 0.5], em: 1.3 });
    }
  }

  /* ------------------------------------------------------------- boucle --- */
  var lastT = 0, acc = 0;
  var FIXED = 1 / 120;

  function loop(nowMs) {
    requestAnimationFrame(loop);
    var now = nowMs / 1000;
    if (!lastT) lastT = now;
    var dt = Math.min(0.05, now - lastT);
    lastT = now;

    /* cinématique en cours ? */
    var cine = globalThis.HSTORY.updateCinematic();

    var simOn = (API.state === 'play') || (API.state === 'intro' && globalThis.HSTORY.cine);
    var pausing = document.getElementById('h-pause').classList.contains('active');

    if (!pausing && simOn) {
      var p = globalThis.HE.player();
      if (API.state === 'play') {
        acc += dt;
        while (acc >= FIXED) {
          globalThis.HE.updatePlayer(FIXED, input);
          globalThis.HE.updateCreatures(FIXED);
          globalThis.HE.updatePickups(FIXED);
          acc -= FIXED;
        }
        handleInteract(dt);
        checkZones();
        input.jump = false;
      }
      globalThis.HAUDIO.update(dt, {
        fear: p.fear,
        chase: chaseActive()
      });
    }

    updateDust(dt);
    gatherLamps(dt);

    /* caméra */
    var p2 = globalThis.HE.player();
    camPos = [p2.body.x + p2.body.w / 2, p2.body.y + 1.62 - (p2.hidden ? 0.6 : 0) + Math.sin(p2.bobPhase * 2) * 0.035, p2.body.z + p2.body.w / 2];
    camYaw = p2.yaw; camPitch = p2.pitch;
    if (cine && API.cineCam && API.cineCam.a) {
      var tC = (cine.t) / Math.max(0.01, globalThis.HSTORY.cine.spec.dur);
      var cp = globalThis.HSTORY.lerpCam(API.cineCam.a, API.cineCam.b, tC);
      camPos = cp.pos; camYaw = cp.yaw; camPitch = cp.pitch;
    }
    if (globalThis.HSTORY.cineCam === 'boss') {
      var boss = globalThis.HSTORY.boss;
      if (boss) {
        var bb = boss.body;
        var dx = camPos[0] - (bb.x + 0.5), dz = camPos[2] - (bb.z + 0.5);
        camYaw = Math.atan2(dx, dz);
        camPitch = -0.18;
      }
    }
    /* secousse (choc sceau, boss) */
    if (globalThis.HSTATE.shake > 0) {
      globalThis.HSTATE.shake = Math.max(0, globalThis.HSTATE.shake - dt * 1.6);
      var sh = globalThis.HSTATE.shake;
      camPos[0] += (Math.random() - 0.5) * sh * 0.5;
      camPos[1] += (Math.random() - 0.5) * sh * 0.5;
    }
    /* aube progressive */
    globalThis.HSTATE.dawn += (globalThis.HSTATE.dawnTarget - globalThis.HSTATE.dawn) * Math.min(1, dt * 0.35);
    var dawn = globalThis.HSTATE.dawn;
    var fogC = [0.006 + 0.55 * dawn, 0.007 + 0.30 * dawn, 0.012 + 0.25 * dawn];
    var fogK = 0.0035 - 0.0024 * dawn;
    var amb = 0.035 + 0.22 * dawn;

    /* entités */
    var ents = [];
    var crs = globalThis.HE.creatures;
    for (var i2 = 0; i2 < crs.length; i2++) {
      if (crs[i2].dead) continue;
      var rig = globalThis.HE.rigOf(crs[i2], now);
      for (var r2 = 0; r2 < rig.length; r2++) ents.push(rig[r2]);
    }
    pickupEntities(ents);
    var de = dustEntities();
    for (var d2 = 0; d2 < de.length; d2++) ents.push(de[d2]);

    UI.updateMeters(p2);
    globalThis.HR.render({
      camPos: camPos, yaw: camYaw, pitch: camPitch,
      fov: 1.22 + p2.fear * 0.10,
      lamps: lampsNear,
      flashPow: p2.flashPower * (p2.battery / 100 < 0.2 ? 0.35 : 1),
      fear: p2.fear, hurt: p2.hurt,
      fogC: fogC, fogK: fogK, ambient: amb,
      time: now,
      entities: ents
    });
  }

  function chaseActive() {
    var crs = globalThis.HE.creatures;
    for (var i = 0; i < crs.length; i++) {
      var c = crs[i];
      if (c.dead || !c.state) continue;
      if (c.state === 'chase' || c.state === 'lunge') return true;
    }
    return false;
  }

  /* écran de mort non-boss (créatures des arènes) */
  globalThis.HSTATE.onDeath = null;

  UI.showDeath = function (cause) {
    document.getElementById('h-death').classList.add('active');
    document.getElementById('h-death-cause').textContent = cause || '—';
  };

  if (globalThis.HE) {
    globalThis.HE.onPlayerDead = function (c) {
      var boss = c && c.kind === 'boss';
      setTimeout(function () {
        if (boss) globalThis.HSTORY.badEnding();
        else UI.showDeath(c ? 'Touché par ' + c.kind : 'La tour a eu votre fatigue.');
      }, 700);
    };
  }

  /* boot après chargement des modules */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', API.boot);
  } else {
    API.boot();
  }

  initDust();
})();
