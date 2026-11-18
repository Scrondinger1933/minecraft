/* ===========================================================================
 * L'ARÈNE ÉTEINTE — histoire, cinématiques, journal, fins
 *
 * Une tour d'arènes condamnée où huit entraîneurs scellèrent un badge que
 * personne n'a jamais décroché honnêtement : le Maître y a gagné quatre-
 * vingt-dix fois, la quatre-vingt-onzième l'a détruit. Le jeu reprend les
 * grandes lignes de la lore urbaine de Lavanville (1996) — le désespoir,
 * la tour-cimetière, « l'enterré vivant », la main blanche — sans jamais
 * reproduire textes, musiques ou personnages déposés (cités en sources
 * dans docs/HORREUR.md). Toutes les créatures sont originales.
 *
 * Publie l'objet global : HSTORY.
 * ========================================================================= */
(function () {
  'use strict';

  var API = {};
  globalThis.HSTORY = API;
  var phase = 'boot';

  API.phase = function () { return phase; };
  API.setPhase = function (p) { phase = p; };

  /* ------------------------------------------------------------- journal -- */
  API.journal = [];
  API.badges = 0;

  API.addJournal = function (title, text) {
    API.journal.push({ title: title, text: text, t: Date.now() });
    if (globalThis.UI) globalThis.UI.journalChanged();
  };

  API.notes = [
    ['Entrée 1 — Le dernier décret',
     'Ligue Pokémon, région de Kanto, 1996. Après les événements de Lavanville, la Ligue a fait sceller la Maison des Arènes : huit salles, huit badges jamais homologués, un Maître qui gagnait quatre-vingt-dix fois de suite.',
     'La quatre-vingt-onzième l\'a détruit. Personne n\'a jamais dit comment.'],
    ['Entrée 2 — Le sceau de la crypte',
     'Le rapport mentionne un douzième pensionnaire laissé sur place. On ne l\'a pas compté dans les huit. On ne l\'a pas remonté non plus.',
     '« Le sceau tient tant que personne ne lui apporte les badges. Pas l\'inverse. »'],
    ['Entrée 3 — La Main Blanche',
     'Un item d\'inventaire figurait dans la liste : WhitHand.gif. Le sprite « a rendu[testeurs violemment malades] »凍. La Ligue parle d\'un échantillon de conservation.',
     'Elle prélève la lueur des torches. Ne la laissez pas respirer à la lumière. Ou plutôt : si.'],
    ['Entrée 4 — Le Garde d\'Os',
     'Le gardien de l\'arène II n\'est pas un entraîneur. Il a un os qui a appartenu à quelqu\'un. Refuser le combat ne fonctionne pas : il attend près de l\'autel.'],
    ['Entrée 5 — Le Souffle',
     'Il court exactement là où le bruit va. Les notes de test disent : « marcher. Ne jamais courir. » Nous avons couru.'],
    ['Entrée 6 — La Nuit Métronomique',
     'L\'arène IV n\'a pas de lumière. Elle a un rythme : quatre bougies, un réveil, et quelque chose qui apprend dans l\'obscurité.'],
    ['Entrée 7 — Le serment d\'aube',
     '« Le toit est le seul endroit où l\'aube entre. » Si quelque chose descendait du toit, ce n\'est pas le soleil qui ferait la différence. C\'est vous.'],
    ['Entrée 8 — Non datée',
     'Enfin… viande fraîche.'],
    ['Entrée 9 — Le douzième pensionnaire',
     'Vous avez relu les quatre-vingt-onze combats. Vous avez compté les perdants : quatre-vingt-onze. Personne n\'a jamais dit combien d\'entre eux étaient remontés.']
  ];

  /* ------------------------------------------------------- cinématiques --- */
  /* Une cinématique est une liste d'étapes {t0,t1,cam(text|fn),text}. La
   * caméra surcharge le joueur ; le joueur peut sauter avec Entrée/Échap.  */
  var cine = null;      /* {dur, start, steps, onStart, onEnd} */
  API.cine = null;

  API.playCinematic = function (spec) {
    cine = { spec: spec, start: performance.now() / 1000 };
    if (spec.onStart) spec.onStart();
    API.cine = cine;
    globalThis.UI.setLetterbox(true);
    globalThis.UI.showCineLine(spec.steps[0].text || '');
  };

  API.cineSkip = function () {
    if (!cine) return;
    var end = cine.spec.onEnd;
    cine = null; API.cine = null;
    globalThis.UI.setLetterbox(false);
    globalThis.UI.showCineLine('');
    if (end) end();
  };

  API.updateCinematic = function () {
    if (!cine) return null;
    var t = performance.now() / 1000 - cine.start;
    var steps = cine.spec.steps;
    var cur = null;
    for (var i = 0; i < steps.length; i++) {
      var s = steps[i];
      if (t >= s.t0 && t < s.t1) { cur = s; break; }
    }
    if (cur) {
      globalThis.UI.showCineLine(cur.text);
      if (cur.cam && !cur._entered) { cur._entered = true; if (cur.cam.enter) cur.cam.enter(); }
    }
    if (t >= cine.spec.dur) { API.cineSkip(); return null; }
    return { t: t, current: cur };
  };

  /* Caméra interpolée entre deux points et deux orientations. */
  API.lerpCam = function (a, b, t) {
    var tt = Math.max(0, Math.min(1, t));
    tt = tt * tt * (3 - 2 * tt);
    return {
      pos: [a.pos[0] + (b.pos[0] - a.pos[0]) * tt,
            a.pos[1] + (b.pos[1] - a.pos[1]) * tt,
            a.pos[2] + (b.pos[2] - a.pos[2]) * tt],
      yaw: a.yaw + (b.yaw - a.yaw) * tt,
      pitch: a.pitch + (b.pitch - a.pitch) * tt
    };
  };

  /* ------------------------------------------------------------- arènes --- */
  var TRIALS = {
    'main':   { needCandles: 0, killLight: true,  altarHold: 0 },
    'os':     { needCandles: 0, killLight: false, altarHold: 4 },
    'souffle':{ needCandles: 4, killLight: false, altarHold: 3 },
    'noir':   { needCandles: 4, killLight: true,  altarHold: 0 }
  };
  API.TRIALS = TRIALS;

  var activeArena = null;      /* le niveau actif */
  var altarHoldT = 0;

  API.activeArena = function () { return activeArena; };

  API.onEnterArena = function (arena) {
    if (arena.state !== 'sealed') return;
    if (phase !== 'play') return;
    arena.state = 'active';
    activeArena = arena;
    var trial = TRIALS[arena.kind];
    API.setPhase('arena');
    globalThis.HAUDIO.ev('sigil');
    globalThis.UI.toast('ARÈNE ' + arena.lvl + ' — TROIS CRIS, UNE LUEUR', 4.5);
    globalThis.UI.objective(API.objectiveText(arena));
    API.addJournal('Sceau de l\'arène ' + arena.lvl,
      'L\'arène ' + arena.lvl + ' est ' +
      (arena.kind === 'main' ? 'la Main Blanche' : arena.kind === 'os' ? 'le Garde d\'Os' :
        arena.kind === 'souffle' ? 'le Souffle' : 'la Nuit Métronomique') + '.');
    /* créatures de l'arène */
    var y = arena.base + 2.2, cx = arena.cx, cz = arena.cz;
    if (typeof cx !== 'number') cx = globalThis.HW.CX;
    if (typeof cz !== 'number') cz = globalThis.HW.CZ;
    if (arena.kind === 'main') {
      var m = globalThis.HE.spawnCreature('main', cx + 4, y + 2, cz + 4, {
        anchor: [cx, cz], vulnerableLight: true, state: 'lurk', speed: 2.7
      });
      m.onKillLight = function (c) { globalThis.HE.removeCreature(c); arenaTrialDone(); };
    } else if (arena.kind === 'os') {
      globalThis.HE.spawnCreature('garde', cx - 5, y, cz - 5, {
        anchor: [cx, cz], state: 'lurk', speed: 3.6
      });
    } else if (arena.kind === 'souffle') {
      globalThis.HE.spawnCreature('souffle', cx + 6, y, cz + 6, { anchor: [cx, cz], state: 'lurk' });
      globalThis.HE.spawnCreature('souffle', cx - 6, y, cz - 6, { anchor: [cx, cz], state: 'lurk' });
      globalThis.HE.emitNoise(cx, y, cz, 20, 'éveil');
    } else if (arena.kind === 'noir') {
      var m2 = globalThis.HE.spawnCreature('main', cx - 4, y + 2, cz + 5, {
        anchor: [cx, cz], vulnerableLight: true, state: 'lurk', speed: 3.6
      });
      m2.onKillLight = function (c) { globalThis.HE.removeCreature(c); arenaTrialDone(); };
      /* les torches du niveau s'éteignent d'elles-mêmes */
      globalThis.HE.player().battery = Math.min(globalThis.HE.player().battery, 45);
      globalThis.HE.emitNoise(cx, y, cz, 26, 'éveil');
      globalThis.HAUDIO.ev('glitch');
    }
  };

  API.objectiveText = function (arena) {
    if (!arena) {
      if (API.badges >= 4) return 'Descendre à la crypte. Le sceau est tombé.';
      if (phase === 'crypt') return 'Monter. Tout droit. Sans regarder en dessous.';
      if (phase === 'roof') return 'Sortir. L\'aube est déjà en retard.';
      return 'Monter par la colonne de l\'escalier. Le premier sceau est au premier étage.';
    }
    var t = TRIALS[arena.kind];
    var done = arena.candlesLit || 0;
    if (t.needCandles > done) return 'Allumer les quatre bougies (' + done + '/4). Elles vont faire du bruit.';
    if (t.killLight) return 'Tenir la Main dans le faisceau jusqu\'à ce qu\'elle céde.';
    return 'Retirer le badge à l\'autel (maintenir E) sans être touché.';
  };

  var candleLitCount = {};
  API.onCandleLit = function (arenaLvl) {
    candleLitCount[arenaLvl] = (candleLitCount[arenaLvl] || 0) + 1;
    var a = API.arenaByLevel(arenaLvl);
    if (a) {
      a.candlesLit = candleLitCount[arenaLvl];
      globalThis.UI.objective(API.objectiveText(a));
      if (a.candlesLit >= 4 && TRIALS[a.kind].needCandles > 0) {
        globalThis.HAUDIO.ev('sigil');
        globalThis.UI.toast('Les quatre bougies brûlent. La salle a retenu son souffle.', 4);
      }
    }
  };

  API.arenaByLevel = function (l) {
    var ars = globalThis.HW.arenas;
    for (var i = 0; i < ars.length; i++) if (ars[i].lvl === l) return ars[i];
    return null;
  };

  API.updateAltarHold = function (dt, holding) {
    var arena = activeArena;
    if (!arena || arena.state !== 'active') return { pct: 0 };
    var t = TRIALS[arena.kind];
    if (t.altarHold <= 0) return { pct: 0 };
    if (holding) {
      altarHoldT += dt;
      if (altarHoldT >= t.altarHold) {
        altarHoldT = 0;
        arenaTrialDone();
        return { pct: 1 };
      }
    } else {
      /* le garde-oos interrompt le retrait : régression douce */
      altarHoldT = Math.max(0, altarHoldT - dt * 0.6);
    }
    return { pct: altarHoldT / t.altarHold };
  };

  function arenaTrialDone() {
    var arena = activeArena;
    if (!arena || arena.state !== 'active') return;
    arena.state = 'cleared';
    /* le badge attend à l'autel */
    globalThis.HE.spawnPickup(arena.altar.x + 0.5, arena.altar.y + 0.9, arena.altar.z + 0.5,
      'badge');
    globalThis.UI.toast('Un badge t\'attend à l\'autel.', 4);
    globalThis.UI.objective('Ramasser le badge.');
  }

  API.badgeCollected = function (arenaLvl) {
    API.badges++;
    globalThis.HAUDIO.ev('badge');
    globalThis.UI.setBadges(API.badges);
    var arena = API.arenaByLevel(arenaLvl);
    if (arena) {
      API.addJournal('Badge ' + API.badges + ' — arène ' + arenaLvl,
        API.badgeLore(API.badges));
      /* libérer l'accès au niveau suivant : le goulotte au plancher de l+1 */
      globalThis.HW.setSigil(arenaLvl + 1, true);
      globalThis.HW.setSigil(arenaLvl, false);
    }
    activeArena = null;
    globalThis.UI.objective(API.objectiveText(null));
    API.checkpoint();
    if (API.badges >= 4) {
      globalThis.HW.setSigil(0, false);    /* la crypte s'ouvre */
      globalThis.UI.toast('Le sceau de la crypte tombe, quatre étages plus bas.', 6);
      API.addJournal('Crypte ouverte', 'Quatre badges. La Ligue n\'a jamais dit ce que la crypte faisait des trois autres.');
      globalThis.HAUDIO.ev('uroboros');
    }
    /* les torches du hall se rallument : la tour respire à nouveau */
    var ars = globalThis.HW.arenas;
    for (var i = 0; i < ars.length; i++) if (ars[i].state === 'sealed') return;
  };

  API.badgeLore = function (n) {
    var texts = [
      'Badge de la SOUFRANCE : « La main ne mourait pas. Elle s\'épuisait. »',
      'Badge de l\'OSEILLE : le garde sublime : « Il pleurait en avançant. »',
      'Badge de la SOUFFLE : « Il a marché. Il n\'a jamais couru. »',
      'Badge de la NUIT : quatre bougies, quatre cires, un réveil au fond du noir.',
      'Badge du TOIT : il n\'y a pas de badge du toit. Vous l\'avez rêvé.'
    ];
    return texts[Math.min(n - 1, texts.length - 1)];
  };

  /* ------------------------------------------------------------- crypte --- */
  API.cryptSequence = function () {
    phase = 'crypt';
    API.setPhase('crypt');
    var hw = globalThis.HW;
    var he = globalThis.HE;
    var boss = he.spawnCreature('boss', hw.CX, hw.CRYPT_Y + 2, hw.CZ, {
      state: 'chase', speed: 3.4
    });
    boss.onCatch = function () { API.badEnding(); };
    API.boss = boss;
    API.bossLevel = -1;
    globalThis.HAUDIO.ev('roar');
    globalThis.UI.toast('ENTERRÉ-VIVANT — « Enfin… viande fraîche… »', 5);
    API.addJournal('Enterré-Vivant', 'Le douzième pensionnaire. Il a goûté la peur comme un vin trop jeune.');
    API.playCinematic({
      dur: 5.2, steps: [
        { t0: 0, t1: 2.6, text: 'Il se lève. Il a les genoux cendre et les mains si longues.' },
        { t0: 2.6, t1: 5.2, text: '« ENFIN… VIANDE FRAÎCHE. »' }
      ],
      onStart: function () { /* caméra vers le boss */ API.cineCam = 'boss'; },
      onEnd: function () { API.cineCam = null; globalThis.UI.objective('Monter. Tout gauche. ROULER.'); }
    });
  };

  /* Quand le boss gagne un niveau : on referme la vis derrière lui. */
  API.updateBoss = function () {
    if (!API.boss || API.boss.dead) return;
    var l = globalThis.HW.levelOf(API.boss.body.y);
    if (l !== API.bossLevel) {
      var prev = API.bossLevel;
      API.bossLevel = l;
      if (prev >= 0 && prev <= 5) {
        globalThis.HW.setSigil(prev, false);
        globalThis.HAUDIO.ev('glitch');
        globalThis.UI.shake(0.5);
      }
    }
    /* le toit : c'est la fin */
    var p = globalThis.HE.player();
    if (p.body.y >= globalThis.HW.ROOF_Y + 2 && !API.ending) {
      API.ending = true;
      API.goodEndingStart();
    }
  };

  /* ---------------------------------------------------------------- fins -- */
  API.badEnding = function () {
    if (API.ending) return;
    API.ending = true;
    phase = 'dead';
    globalThis.UI.gameOver(false,
      'Enfin… viande fraîche.',
      'L\'Enterré-Vivant vous a ramené là où personne ne remonte.');
  };

  API.goodEndingStart = function () {
    globalThis.UI.objective('');
    var hw = globalThis.HW;
    API.playCinematic({
      dur: 14,
      steps: [
        { t0: 0,   t1: 4.0,  text: 'L\'Enterré-Vivant surgit du goulotte. La nuit se lève comme un rideau fatigué.' },
        { t0: 4.0, t1: 8.0,  text: 'Le premier rayon touche la toiture. Il ne crie pas : il s\'invente une poussière.' },
        { t0: 8.0, t1: 12.0, text: 'Quatre-vingt-onze victoires, un pensionnaire. Vous êtes le premier try à descendre sans lui.' },
        { t0: 12.0, t1: 14.0, text: 'L\'Arène Éteinte. Fin.' }
      ],
      onStart: function () {
        globalThis.HSTATE.dawn = 0;
        globalThis.HSTATE.dawnTarget = 1;
        globalThis.HE.clearCreatures();
        globalThis.HAUDIO.ev('badge');
      },
      onEnd: function () {
        globalThis.UI.gameOver(true,
          'Vous sortez plus vivant que les quatre-vingt-onze.',
          'Huit salles, quatre badges, une aube. La tour reste debout.');
      }
    });
  };

  /* --------------------------------------------------------- checkpoints -- */
  API.checkpointData = null;
  API.checkpoint = function () {
    var p = globalThis.HE.player();
    var b = p.body;
    API.checkpointData = {
      x: b.x + 0.3, y: b.y + 0.1, z: b.z + 0.3,
      badges: API.badges,
      litCandles: candleLitCount
    };
  };

  API.respawn = function () {
    var p = globalThis.HE.player();
    var d = API.checkpointData || {};
    p.dead = false; p.hp = 100; p.invulnT = 2; p.fear = 0.3;
    p.battery = Math.max(p.battery, 55);
    p.body.x = d.x || globalThis.HW.spawn.x; p.body.y = d.y || globalThis.HW.spawn.y;
    p.body.z = d.z || globalThis.HW.spawn.z;
    p.body.vx = p.body.vy = p.body.vz = 0;
    globalThis.HE.clearCreatures();
    candleLitCount = d.litCandles || candleLitCount;
    /* replacer la bougie du sceau tombée si nécessaire */
    API.ending = false;
    if (activeArena && activeArena.state === 'active') {
      /* repartir l'arène proprement */
      activeArena.state = 'sealed';
      activeArena = null;
      for (var i = 0; i < globalThis.HW.arenas.length; i++) {
        if (globalThis.HW.arenas[i].lvl === (d.badges || 0) + 1) {
          /* relance via entrée de zone */
        }
      }
    }
    globalThis.UI.objective(API.objectiveText(null));
  };

  API.reset = function () {
    API.badges = 0;
    API.journal.length = 0;
    API.ending = false;
    candleLitCount = {};
    altarHoldT = 0;
    activeArena = null;
    API.boss = null;
    API.setPhase('play');
  };
})();
