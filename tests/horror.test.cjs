/* ===========================================================================
 * L'ARÈNE ÉTEINTE — tests unitaires hors navigateur (node)
 * Charge hnoise, hworld, hmesh, hcollide dans un contexte vm et vérifie :
 *   · le monde se génère et le spawn est praticable ;
 *   · l'axe vertical amortit la chute sans traverser la dalle (tunneling) ;
 *   · le corps repose sans jitter ;
 *   · le step-assist monte la rampe de la crypte sans saut ;
 *   · les sceaux se dissolvent (blocs disparaissent) ;
 *   · le maillage produit des sommets et l'élision évite les faces cachées.
 * Usage : node tests/horror.test.cjs
 * ========================================================================= */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const ctx = { console, Math, performance: { now: () => Date.now() } };
ctx.globalThis = ctx; ctx.window = ctx;
vm.createContext(ctx);

for (const f of ['hnoise.js', 'hworld.js', 'hmesh.js', 'hcollide.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'public/horreur/js', f), 'utf8'),
    ctx, { filename: f });
}

let failures = 0;
function check(name, cond, detail) {
  process.stdout.write((cond ? '  \u2713 ' : '  \u2717 ') + name + (detail ? ' (' + detail + ')' : '') + '\n');
  if (!cond) failures++;
}

vm.runInContext('globalThis.HW.init(1996); globalThis.HM.init();', ctx);
const HW = ctx.HW, HC = ctx.HC, HM = ctx.HM, HNoise = ctx.HNoise;

/* ------------------------------------------------ 1. monde génération --- */
const spawn = HW.spawn;
check('spawn dans le vide (hall)', !HW.solidAt(spawn.x, spawn.y + 0.4, spawn.z));
check('spawn au-dessus du sol du hall', HW.solidAt(spawn.x, HW.HALL_Y, spawn.z));
check('niveaux 0..5 définis', HW.levelBase(0) === 24 && HW.levelBase(5) === 64);
check('la crypte est plus basse que le hall', HW.levelBase(-1) === 16);

/* sculpte : rampe pocket(1) ouest — x=CX-11..CX-10, z=CZ-3+k, y=25+k */
let rampFound = 0;
for (let k = 0; k <= 6; k++) {
  const z = HW.CZ - 3 + k, y = 25 + k;
  if (HW.solidAt(HW.CX - 11, y, z) && HW.solidAt(HW.CX - 10, y, z)) rampFound++;
}
check('la rampe hall→arène I est continue (pocket 1 ouest)', rampFound >= 6, rampFound + '/7 crans');

/* le goulotte couvre les 4 dernières colonnes de marches à travers la dalle */
const mouth0 = HW.sigilsOf(0);
check('goulotte pocket(0) = 8 cellules dans la dalle du hall',
  mouth0.length === 8 && mouth0.every(c => c[1] === HW.HALL_Y),
  mouth0.length + ' cellules');

/* ---------------------------------------------------------------- sceaux */
vm.runInContext('HW.setSigil(1, true);', ctx);
const cells = HW.sigilsOf(1);
let open = cells.every(c => HW.get(c[0], c[1], c[2]) === HW.B.AIR);
check('setSigil(1, true) dissout le goulotte', open);
vm.runInContext('HW.setSigil(2, true);', ctx);
check('setSigil(2, true) dissout l\'arène II', HW.sigilsOf(2).every(c => HW.get(c[0], c[1], c[2]) === HW.B.AIR));

/*------------------------------------------------------------- collision --*/
/* 2a. chute sans tunneling : départ bien au-dessus, vitesse 50 m/s */
{
  const b = HC.makeBody(0.6, 1.8);
  b.x = spawn.x - 0.3; b.y = 59; b.z = spawn.z - 0.3;
  b.vy = -50;
  for (let i = 0; i < 240; i++) HC.step(b, 1 / 120);
  check('chute 50 m/s : la dalle arrête le corps', b.onGround === true, 'y=' + b.y.toFixed(3));
  check('corps au sol sans tunneling (atterri au niveau IV)', b.y > 56.5 && b.y < 57.5, 'y=' + b.y.toFixed(3));
}

/* 2b. repos sans jitter */
{
  const b = HC.makeBody(0.6, 1.8);
  b.x = spawn.x - 0.3; b.y = spawn.y + 2; b.z = spawn.z - 0.3;
  for (let i = 0; i < 360; i++) {
    b.vy -= 22 * (1 / 120);
    HC.step(b, 1 / 120);
  }
  const y = b.y, y2 = (() => { HC.step(b, 1 / 120); return b.y; })();
  check('repos stable (drift < 1e-3)', Math.abs(y2 - y) < 1e-3, Math.abs(y2 - y).toExponential(1));
}

/* 2c. step-assist : la crypte se remonte sans saut */
{
  const b = HC.makeBody(0.6, 1.8);
  /* la rampe crypte : pocket(0), marches x=CX-3+k (k=0..6), z=CZ+10, y=17+k */
  const startX = HW.CX - 3.7, startZ = 58 + 0.5;
  b.x = startX; b.z = startZ;
  /* le sceau de la vis crypte↔hall doit être ouvert pour grimper */
  vm.runInContext('HW.setSigil(0, true);', ctx);
  const rampOpen = HW.sigilsOf(0).every(c => HW.get(c[0], c[1], c[2]) === HW.B.AIR);
  check('la rampe est franchissable une fois le milieu SCEAU dissous', rampOpen);
  b.y = 17.2;
  /* force le contact sol + avance vers l'est */
  b.onGround = true;
  let maxY = b.y;
  for (let i = 0; i < 480; i++) {
    b.vx = 2.4;                       /* pousse vers l'est        */
    b.vy -= 22 * (1 / 120);           /* gravité : le corps tombe, contact sol */
    HC.step(b, 1 / 120);
    maxY = Math.max(maxY, b.y);
  }
  check('step-assist : grimper la rampe sans saut', maxY >= 23.5, 'y=' + maxY.toFixed(2));
}

/* 2d. rayon DDT de ligne de vue : un mur bloque, l'air libre passe */
{
  const eyeX = HW.CX, eyeY = 25.5, eyeZ = HW.CZ - 4;
  const r1 = HC.raycast(eyeX, eyeY, eyeZ, 0, 1, 0, 20);  /* vers l'haut : doit frapper plafond/dalle */
  const r2 = HC.raycast(eyeX, eyeY, eyeZ, 1, 0, 0, 0.5); /* vers +x : 0.5 m intérieur        */
  check('raycast vertical frappe la dalle du dessus', r1.hit === true, 'dist=' + r1.dist.toFixed(2));
  check('raycast court ne heurte rien (vide)', r2.hit === false);
}

/* --------------------------------------------------------------- maillage */
{
  let chunks = 0, verts = 0;
  for (let id = 0; id < HM.chunks.length; id++) {
    const cx = id % HM.NCX, cz = ((id / HM.NCX) | 0) % HM.NCZ, cy = (id / (HM.NCX * HM.NCZ)) | 0;
    const d = HM.buildChunkData(cx, cy, cz);
    if (d) { chunks++; verts += d.length / 7; }
  }
  check('maillage émis', verts > 10000, verts + ' sommets / ' + chunks + ' chunks');
  const elisionOk = chunks < HM.NCX * HM.NCY * HM.NCZ;
  check('élision (pas de chunk vide émis)', elisionOk);
}

/* ------------------------------------------------------------- résumé --- */
console.log('\u2550'.repeat(64));
console.log(' ' + (failures ? failures + ' \u00e9chec(s)' : 'Tous les tests passent'));
console.log('\u2550'.repeat(64));
process.exit(failures ? 1 : 0);
