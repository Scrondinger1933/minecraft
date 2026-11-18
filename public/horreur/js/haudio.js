/* ===========================================================================
 * L'ARÈNE ÉTEINTE — audio synthétisé (Web Audio API, aucun fichier)
 *
 * Couches :
 *   · nappe      : deux dents de scie désaccordées + sous-harmonique, LFO lent ;
 *   · vent       : bruit filtré à passe-bande, hauteur dérivant ;
 *   · cœur       : impulsion sinus 55 Hz, cadence liée à la PEUR ;
 *   · poursuite  : cluster dissonant qui n'existe que lorsqu'on est poursuivi ;
 *   · événements : pas, bougie, badge (cloche), sceau, morsure, bannissement,
 *                  hurlement du boss, souffle.
 *
 * Publie l'objet global : HAUDIO.
 * ========================================================================= */
(function () {
  'use strict';

  var API = {};
  globalThis.HAUDIO = API;
  var ctx = null, master = null;
  var layers = {};
  var started = false;

  function noiseBuffer(seconds) {
    var rate = ctx.sampleRate;
    var b = ctx.createBuffer(1, rate * seconds, rate);
    var d = b.getChannelData(0);
    for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  API.start = function () {
    if (started) return;
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch (e) { return; }
    started = true;
    master = ctx.createGain();
    master.gain.value = 0.8;
    master.connect(ctx.destination);

    /* ---- nappe ---- */
    var drone = ctx.createGain(); drone.gain.value = 0.0;
    var dFilter = ctx.createBiquadFilter(); dFilter.type = 'lowpass';
    dFilter.frequency.value = 220; dFilter.Q.value = 3;
    drone.connect(dFilter); dFilter.connect(master);
    var freqs = [55, 82.4, 110];
    for (var i = 0; i < freqs.length; i++) {
      var o = ctx.createOscillator();
      o.type = i < 2 ? 'sawtooth' : 'sine';
      o.frequency.value = freqs[i] * (i === 2 ? 0.5 : 1);
      o.detune.value = (i - 1) * 7;
      var og = ctx.createGain(); og.gain.value = i === 2 ? 0.5 : 0.25;
      o.connect(og); og.connect(drone);
      o.start();
      layers['dosc' + i] = o;
    }
    var lfo = ctx.createOscillator(); lfo.frequency.value = 0.11;
    var lfoG = ctx.createGain(); lfoG.gain.value = 0.35;
    lfo.connect(lfoG); lfoG.connect(drone.gain);
    lfo.start();
    layers.drone = drone;
    layers.droneFilter = dFilter;

    /* ---- vent ---- */
    var wind = ctx.createBufferSource();
    wind.buffer = noiseBuffer(3); wind.loop = true;
    var wf = ctx.createBiquadFilter(); wf.type = 'bandpass';
    wf.frequency.value = 700; wf.Q.value = 0.6;
    var wg = ctx.createGain(); wg.gain.value = 0.05;
    wind.connect(wf); wf.connect(wg); wg.connect(master);
    wind.start();
    layers.windFilter = wf;

    /* ---- poursuite : cluster dissonant ---- */
    var chase = ctx.createGain(); chase.gain.value = 0;
    chase.connect(master);
    var cFreqs = [233.1, 246.9, 370.1];   /* si bémol, si, fa# : cluster */
    for (var c2 = 0; c2 < cFreqs.length; c2++) {
      var co = ctx.createOscillator(); co.type = 'sawtooth';
      co.frequency.value = cFreqs[c2];
      var cov = ctx.createGain(); cov.gain.value = 0.10;
      co.connect(cov); cov.connect(chase);
      co.start();
      /* trémolo nerveux */
      var trem = ctx.createOscillator(); trem.frequency.value = 7 + c2 * 2.3;
      var tremG = ctx.createGain(); tremG.gain.value = 0.04;
      trem.connect(tremG); tremG.connect(cov.gain);
      trem.start();
    }
    layers.chase = chase;
  };

  API.resume = function () { if (ctx && ctx.state === 'suspended') ctx.resume(); };

  API.setVolume = function (v) { if (master) master.gain.value = v; };

  /* Update continu appelé depuis la boucle de jeu. */
  API.update = function (dt, state) {
    if (!started) return;
    var t = ctx.currentTime;
    var fear = state.fear || 0;
    var chase = state.chase ? 1 : 0;
    layers.drone.gain.setTargetAtTime(0.10 + 0.20 * fear, t, 0.6);
    layers.droneFilter.frequency.setTargetAtTime(180 + 320 * fear, t, 0.8);
    layers.chase.gain.setTargetAtTime(chase * 0.55, t, 0.4);
    layers.windFilter.frequency.setTargetAtTime(500 + 400 * Math.sin(t * 0.13), t, 1.0);
    /* cœur : cadence 52 → 140 bpm selon la peur */
    var bpm = 52 + 92 * fear;
    state.heartPeriod = 60 / bpm;
    if (!state._heartT) state._heartT = 0;
    state._heartT -= dt;
    if (state._heartT <= 0) {
      state._heartT = state.heartPeriod;
      var v = fear > 0.08 ? 0.10 + 0.5 * fear : 0.0;
      if (v > 0.01) thump(58, v);
    }
  };

  function thump(freq, vol) {
    if (!ctx) return;
    var t = ctx.currentTime;
    var o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(freq * 0.6, t + 0.12);
    var g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + 0.3);
  }

  function envNoise(dur, vol, type, f0, f1, q) {
    if (!ctx) return;
    var t = ctx.currentTime;
    var src = ctx.createBufferSource();
    src.buffer = noiseBuffer(dur + 0.1);
    var flt = ctx.createBiquadFilter();
    flt.type = type || 'bandpass';
    flt.frequency.setValueAtTime(f0, t);
    flt.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
    flt.Q.value = q || 1;
    var g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(flt); flt.connect(g); g.connect(master);
    src.start(t); src.stop(t + dur + 0.1);
  }

  function tone(freq, dur, vol, type, slideTo) {
    if (!ctx) return;
    var t = ctx.currentTime;
    var o = ctx.createOscillator(); o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    var g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  /* -------------------------------------------------------------- pas ----- */
  API.footstep = function (phase, spd) {
    if (!ctx) return;
    var vol = 0.05 + 0.06 * Math.min(1, spd / 7);
    envNoise(0.09, vol, 'lowpass', 380, 160, 1.2);
    tone(120 + Math.random() * 30, 0.06, vol * 0.4, 'triangle', 80);
  };

  /* -------------------------------------------------------- événements ---- */
  API.ev = function (name) {
    if (!ctx) return;
    switch (name) {
      case 'candle':
        envNoise(0.5, 0.10, 'bandpass', 900, 300, 2);
        tone(880, 0.5, 0.03, 'sine', 660);
        break;
      case 'badge':
        /* cloche brisée : deux partiels inharmoniques */
        tone(1046, 1.4, 0.10, 'sine');
        tone(1571, 1.1, 0.05, 'sine');
        tone(1046 * 1.41, 0.9, 0.04, 'triangle');
        break;
      case 'sigil':
        envNoise(1.2, 0.14, 'lowpass', 600, 90, 4);
        tone(66, 1.6, 0.12, 'sawtooth', 40);
        break;
      case 'door':
        envNoise(0.7, 0.10, 'bandpass', 300, 180, 6);
        break;
      case 'banish':
        envNoise(1.4, 0.20, 'bandpass', 2200, 200, 1.5);
        tone(196, 0.9, 0.08, 'sawtooth', 55);
        break;
      case 'bite':
        envNoise(0.25, 0.32, 'lowpass', 900, 200, 2);
        tone(80, 0.3, 0.18, 'square', 50);
        break;
      case 'roar':
        envNoise(1.8, 0.30, 'lowpass', 400, 60, 3);
        tone(48, 1.8, 0.28, 'sawtooth', 30);
        tone(73, 1.4, 0.16, 'square', 45);
        break;
      case 'whisper':
        envNoise(1.6, 0.05, 'bandpass', 2400, 1400, 8);
        break;
      case 'glitch':
        envNoise(0.12, 0.16, 'bandpass', 3200, 900, 12);
        break;
      case 'uroboros': /* la respiration de la crypte */
        envNoise(2.6, 0.10, 'lowpass', 240, 60, 2);
        break;
    }
  };

  /* niveau de « lumière » vécu (pour la peur) — approximation locale */
  API.fearZone = function (battery) {
    return battery / 100;
  };
})();
