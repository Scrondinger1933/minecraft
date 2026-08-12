/* =========================================================================
 *  VOXELCRAFT — Synthèse sonore procédurale (Web Audio API)
 *  Aucun fichier audio : tout est généré (bruit filtré, oscillateurs,
 *  enveloppes ADSR). Les sons de pas/casse varient par matériau.
 * ========================================================================= */
(function (root) {
  'use strict';

  function AudioEngine() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
    this.volume = 0.55;
    this.noiseBuf = null;
    this.lastStep = 0;
  }

  AudioEngine.prototype.init = function () {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.enabled = false; return; }
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    // compresseur : évite la saturation quand plusieurs sons se superposent
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.knee.value = 24; comp.ratio.value = 8;
    this.master.connect(comp);
    comp.connect(this.ctx.destination);
    this.buildNoise();
  };
  AudioEngine.prototype.resume = function () {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  };
  AudioEngine.prototype.setVolume = function (v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  };

  AudioEngine.prototype.buildNoise = function () {
    const ctx = this.ctx;
    const len = ctx.sampleRate * 1.2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    // bruit brownien léger : plus « naturel » que le blanc pur
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      d[i] = w * 0.72 + last * 4.5;
    }
    this.noiseBuf = buf;
  };

  /** Salve de bruit filtré. */
  AudioEngine.prototype.noise = function (o) {
    if (!this.enabled || !this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = o.rate || 1;
    const flt = ctx.createBiquadFilter();
    flt.type = o.type || 'bandpass';
    flt.frequency.value = o.freq || 800;
    flt.Q.value = o.q || 1.1;
    const g = ctx.createGain();
    const vol = (o.vol === undefined ? 0.4 : o.vol);
    const dur = o.dur || 0.12;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + (o.attack || 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    if (o.sweep) flt.frequency.exponentialRampToValueAtTime(Math.max(60, o.sweep), t + dur);
    src.connect(flt); flt.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + dur + 0.02);
  };

  /** Note d'oscillateur avec enveloppe. */
  AudioEngine.prototype.tone = function (o) {
    if (!this.enabled || !this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime + (o.delay || 0);
    const osc = ctx.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.freq || 440, t);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t + (o.dur || 0.2));
    const g = ctx.createGain();
    const vol = o.vol === undefined ? 0.16 : o.vol;
    const dur = o.dur || 0.2;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + (o.attack || 0.01));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(this.master);
    osc.start(t); osc.stop(t + dur + 0.02);
  };

  /* ------------------------------------------------ Sons de matériaux -- */
  const MAT_SOUND = {
    stone: { freq: 620, q: 1.4, rate: 1.0, type: 'bandpass' },
    wood: { freq: 420, q: 2.2, rate: 1.1, type: 'bandpass' },
    grass: { freq: 1900, q: 0.8, rate: 1.4, type: 'bandpass' },
    sand: { freq: 2600, q: 0.6, rate: 1.6, type: 'highpass' },
    gravel: { freq: 900, q: 1.0, rate: 1.2, type: 'bandpass' },
    glass: { freq: 3400, q: 3.5, rate: 1.5, type: 'bandpass' },
    metal: { freq: 1500, q: 4.0, rate: 1.0, type: 'bandpass' },
    cloth: { freq: 700, q: 0.7, rate: 1.0, type: 'lowpass' },
    snow: { freq: 1400, q: 0.7, rate: 1.3, type: 'bandpass' },
    none: null
  };

  AudioEngine.prototype.step = function (mat, moving) {
    const now = performance.now();
    if (now - this.lastStep < 260) return;
    this.lastStep = now;
    const m = MAT_SOUND[mat] || MAT_SOUND.stone;
    if (!m) return;
    const v = 0.10 + Math.random() * 0.05;
    this.noise({ freq: m.freq * (0.85 + Math.random() * 0.3), q: m.q, rate: m.rate, type: m.type, vol: v, dur: 0.085 });
  };
  AudioEngine.prototype.dig = function (mat) {
    const m = MAT_SOUND[mat] || MAT_SOUND.stone;
    if (!m) return;
    this.noise({ freq: m.freq * (0.7 + Math.random() * 0.4), q: m.q, rate: m.rate * 0.9, type: m.type, vol: 0.09, dur: 0.07 });
  };
  AudioEngine.prototype.breakBlock = function (mat) {
    const m = MAT_SOUND[mat] || MAT_SOUND.stone;
    if (!m) return;
    this.noise({ freq: m.freq, q: m.q * 0.7, rate: m.rate, type: m.type, vol: 0.26, dur: 0.26, sweep: m.freq * 0.35 });
    if (mat === 'glass') {
      for (let i = 0; i < 4; i++) this.tone({ type: 'triangle', freq: 2200 + Math.random() * 2600, to: 900, dur: 0.14, vol: 0.06, delay: i * 0.03 });
    }
  };
  AudioEngine.prototype.place = function (mat) {
    const m = MAT_SOUND[mat] || MAT_SOUND.stone;
    if (!m) return;
    this.noise({ freq: m.freq * 1.1, q: m.q, rate: m.rate, type: m.type, vol: 0.20, dur: 0.13 });
  };

  /* ------------------------------------------------------ Sons de jeu -- */
  AudioEngine.prototype.hurt = function () {
    this.tone({ type: 'square', freq: 300, to: 110, dur: 0.22, vol: 0.16 });
    this.noise({ freq: 500, q: 0.8, vol: 0.16, dur: 0.18 });
  };
  AudioEngine.prototype.hitMob = function () {
    this.noise({ freq: 380, q: 1.1, vol: 0.20, dur: 0.11, sweep: 150 });
    this.tone({ type: 'square', freq: 180, to: 90, dur: 0.10, vol: 0.10 });
  };
  AudioEngine.prototype.pickup = function () {
    this.tone({ type: 'sine', freq: 780, to: 1180, dur: 0.10, vol: 0.10 });
  };
  AudioEngine.prototype.craft = function () {
    this.tone({ type: 'triangle', freq: 520, to: 880, dur: 0.13, vol: 0.12 });
    this.tone({ type: 'triangle', freq: 780, to: 1180, dur: 0.12, vol: 0.09, delay: 0.06 });
  };
  AudioEngine.prototype.splash = function () {
    this.noise({ freq: 900, q: 0.5, type: 'lowpass', vol: 0.24, dur: 0.4, sweep: 200, rate: 0.8 });
  };
  AudioEngine.prototype.explode = function () {
    this.noise({ freq: 180, q: 0.4, type: 'lowpass', vol: 0.6, dur: 1.1, sweep: 40, rate: 0.5 });
    this.tone({ type: 'sawtooth', freq: 90, to: 28, dur: 0.9, vol: 0.24 });
  };
  AudioEngine.prototype.mobSound = function (type) {
    const cfg = {
      pig: { f: 320, t: 'sawtooth', d: 0.22 },
      cow: { f: 180, t: 'sawtooth', d: 0.55 },
      sheep: { f: 420, t: 'square', d: 0.34 },
      chicken: { f: 900, t: 'square', d: 0.12 },
      zombie: { f: 130, t: 'sawtooth', d: 0.7 },
      skeleton: { f: 700, t: 'square', d: 0.2 },
      spider: { f: 1100, t: 'square', d: 0.13 },
      creeper: { f: 250, t: 'sawtooth', d: 0.5 }
    }[type];
    if (!cfg) return;
    this.tone({ type: cfg.t, freq: cfg.f * (0.9 + Math.random() * 0.2), to: cfg.f * 0.65, dur: cfg.d, vol: 0.09 });
  };
  AudioEngine.prototype.fuse = function () {
    this.noise({ freq: 3000, q: 1.6, vol: 0.16, dur: 0.5, type: 'highpass' });
  };
  AudioEngine.prototype.levelUp = function () {
    [523, 659, 784, 1047].forEach((f, i) => this.tone({ type: 'sine', freq: f, dur: 0.22, vol: 0.10, delay: i * 0.075 }));
  };

  root.VCAudio = { AudioEngine, MAT_SOUND };
})(typeof self !== 'undefined' ? self : this);
