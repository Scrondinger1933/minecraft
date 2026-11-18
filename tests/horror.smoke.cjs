'use strict';
/* Smoke-test hors navigateur : émule WebGL2 + DOM + Web Audio, puis
 * démarre HMAIN.boot(), traverse l'intro et simule des entrées clavier. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let fakeNow = 1000;
const ctx = { console, Math, performance: { now: () => fakeNow } };
ctx.globalThis = ctx; ctx.window = ctx;
vm.createContext(ctx);

let failures = 0;
function check(name, cond, detail) {
  process.stdout.write((cond ? '  \u2713 ' : '  \u2717 ') + name + (detail ? ' (' + detail + ')' : '') + '\n');
  if (!cond) failures++;
}

/* ----------------------------------------------------------- fake WebGL2 */
function makeGL() {
  let idc = 1;
  const consts = {};
  const handler = {
    get(t, prop) {
      if (prop in t) return t[prop];
      if (typeof prop === 'string' && /^[A-Z][A-Z0-9_]*$/.test(prop)) {
        if (!(prop in consts)) consts[prop] = (Object.keys(consts).length + 1) * 7919;
        return consts[prop];
      }
      const fn = function (...args) {
        const n = prop;
        if (n === 'getContext') return makeGL();
        if (n === 'createShader' || n === 'createProgram' || n === 'createBuffer' ||
            n === 'createTexture' || n === 'createFramebuffer' || n === 'createRenderbuffer' ||
            n === 'createVertexArray' || n === 'getUniformLocation') return { id: idc++ };
        if (n === 'getAttribLocation') return idc++;
        if (n === 'getShaderParameter' || n === 'getProgramParameter') {
          /* COMPILE_STATUS / LINK_STATUS : vrai (l'index v sera mappé) */
          return true;
        }
        if (n === 'checkFramebufferStatus') return consts.FRAMEBUFFER_COMPLETE || 1;
        if (n === 'getShaderInfoLog' || n === 'getProgramInfoLog') return '';
        if (n === 'getExtension') return null;
        if (n === 'getSupportedExtensions') return [];
        if (n === 'getError') return 0;
        if (n === 'getActiveUniform' || n === 'getActiveAttrib') return { name: 'u0', size: 1, type: 5126 };
        if (n === 'drawElements' || n === 'drawArrays') { t.__draws = (t.__draws || 0) + 1; return; }
        return undefined;
      };
      return fn;
    }
  };
  return new Proxy({ __draws: 0 }, handler);
}

/* --------------------------------------------------------------- fake DOM */
function makeCtx2D(cv) { return new Proxy({}, {
  get(t, p) {
    if (p === 'canvas') return cv;
    if (p === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
    if (p === 'createImageData') return (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
    if (p === 'measureText') return () => ({ width: 10 });
    if (p === 'createLinearGradient') return () => ({ addColorStop() {} });
    if (!(p in t)) t[p] = function () {};
    return t[p];
  },
  set(t, p, v) { t[p] = v; return true; }
}); }

function makeCanvas() {
  const cv = {
    width: 300, height: 150, style: {}, listeners: {},
    addEventListener(type, fn) { cv.__ev.push([type, fn]); },
    removeEventListener() {}, setPointerCapture() {}, releasePointerCapture() {},
    requestPointerLock() { cv.__ev.push(['pointerlockchange', () => {}]); },
    getContext(kind) {
      if (kind === '2d') {
        if (!cv.__ctx2d) cv.__ctx2d = makeCtx2D(cv);
        return cv.__ctx2d;
      }
      if (!cv.__gl) cv.__gl = makeGL();
      return cv.__gl;
    },
    __ev: []
  };
  return cv;
}

const elements = new Map();
function el(id) {
  if (elements.has(id)) return elements.get(id);
  const e = makeCanvas();
  e.classList = { add() {}, remove() {}, toggle() {}, contains() { return false; } };
  e.style = { setProperty() {}, opacity: '', display: '', transform: '' };
  e.__ev = [];
  e.addEventListener = (type, fn) => { e.__ev.push([type, fn]); };
  e.appendChild = () => {}; e.removeChild = () => {};
  e.textContent = ''; e.innerHTML = '';
  elements.set(id, e);
  return e;
}

function makeAudioNode() {
  const n = { params: {}, listeners: {} };
  return new Proxy(n, {
    get(t, p) {
      if (p === 'frequency' || p === 'gain' || p === 'detune' || p === 'Q') {
        if (typeof t[p] !== 'object') t[p] = makeAudioNode();
        return t[p];
      }
      if (p in t) return t[p];
      if (p === 'currentTime') return Date.now() / 1000;
      if (p === 'state') return 'running';
      if (p === 'sampleRate') return 44100;
      if (p === 'destination') return (t[p] = makeAudioNode());
      if (p === 'resume' || p === 'suspend' || p === 'close') return async () => {};
      if (/^create/.test(p)) {
        return function () {
          if (p === 'createBuffer') return { getChannelData: () => new Float32Array(1024), duration: 0.02 };
          if (p === 'createBufferSource') {
            const src = makeAudioNode();
            src.buffer = { sampleRate: 44100, getChannelData: () => new Float32Array(1024) };
            return src;
          }
          return makeAudioNode();
        };
      }
      if (p === 'getChannelData') return () => new Float32Array(1024);
      return function () { return makeAudioNode(); };
    },
    set(t, p, v) { t[p] = v; return true; }
  });
}
function FakeAudio() { return makeAudioNode(); }

ctx.document = {
  readyState: 'complete',
  createElement(tag) { return makeCanvas(); },
  createElementNS(ns, tag) { return makeCanvas(); },
  getElementById(id) { return el(id); },
  addEventListener(type, fn) { ctx.__docEvents = ctx.__docEvents || {}; ctx.__docEvents[type] = fn; },
  removeEventListener() {},
  exitPointerLock() {},
  pointerLockElement: null,
  body: el('body'),
  documentElement: el('doc')
};
ctx.requestAnimationFrame = (fn) => { ctx.__raf = fn; return 1; };
ctx.cancelAnimationFrame = () => {};
ctx.window.AudioContext = FakeAudio;
ctx.window.webkitAudioContext = FakeAudio;
ctx.window.devicePixelRatio = 1;
ctx.window.innerWidth = 1280;
ctx.window.innerHeight = 720;
ctx.window.addEventListener = (type, fn) => {};
ctx.window.setTimeout = setTimeout;
ctx.window.clearTimeout = clearTimeout;
ctx.window.setInterval = setInterval;
ctx.window.clearInterval = clearInterval;

for (const f of ['hnoise.js', 'hworld.js', 'hmesh.js', 'hcollide.js', 'hrender.js',
                 'hent.js', 'haudio.js', 'hstory.js', 'hmain.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'public/horreur/js', f), 'utf8'), ctx, { filename: f });
}

vm.runInContext('HMAIN.boot();', ctx);
check('HMAIN.boot() sans exception', true, 'state=' + vm.runInContext('HMAIN.state', ctx));
check('menu atteint', vm.runInContext('HMAIN.state', ctx) === 'menu', vm.runInContext('HMAIN.state', ctx));

const clickBtn = (id) => {
  const e = elements.get(id);
  if (e) for (const [t, fn] of e.__ev) if (t === 'click') fn({ target: e, preventDefault() {} });
};
clickBtn('btn-jouer');
const st1 = vm.runInContext('HMAIN.state', ctx);
check('démarrage accepté (intro)', ['intro', 'play'].includes(st1), st1);

/* pompe ~24 s de frames (intro 17 s + 7 s de jeu) */
function pump(n) {
  for (let i = 0; i < n; i++) {
    fakeNow += 50;
    if (ctx.__raf) { const fn = ctx.__raf; ctx.__raf = null; fn(fakeNow); }
  }
}
pump(480); /* 24 s virtuels @ 20 fps : intro (17 s) terminée */
const st2 = vm.runInContext('({ state: HMAIN.state, phase: HSTORY.phase() })', ctx);
check('intro terminée → phase play', st2.state === 'play' && st2.phase === 'play', JSON.stringify(st2));
check('l\'intro a dénoué le sceau 1', !!vm.runInContext('HW.sigilOpen(1)', ctx));

/* touches : déplacements + interaction E pendant 4 s */
const dq = ctx.__docEvents;
const key = (type, code) => {
  if (dq && dq[type]) dq[type]({ code, preventDefault() {}, repeat: false });
};
key('keydown', 'KeyW');
key('keydown', 'KeyE');
pump(80); /* 4 s de jeu */
key('keyup', 'KeyW'); key('keyup', 'KeyE');
const st3 = vm.runInContext('(() => { const p = HE.player(); const b = p.body; return { x: +b.x.toFixed(1), y: +b.y.toFixed(1), z: +b.z.toFixed(1), hp: p.hp, fear: +p.fear.toFixed(2) }; })()', ctx);
check('le joueur vit et est simulé', st3.hp > 0, JSON.stringify(st3));

console.log(failures === 0 ? '\nSmoke-test émulé : OK' : '\n' + failures + ' échec(s)');
process.exit(failures ? 1 : 0);
