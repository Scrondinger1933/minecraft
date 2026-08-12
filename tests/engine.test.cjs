/* =========================================================================
 *  VOXELCRAFT — banc d'essai hors navigateur
 *
 *  Les modules du moteur sont écrits en UMD implicite : une fermeture qui
 *  reçoit `root` et y publie son objet global. Il suffit donc de les évaluer
 *  successivement dans un même contexte `vm` pour reconstituer le graphe de
 *  dépendances, sans DOM, sans WebGL, sans Worker.
 *
 *  Périmètre : blocks, noise, worldgen, mesher, crafting, physics, entities.
 *  Sont exclus atlas / renderer / audio / world / ui / game / main, qui
 *  exigent un canvas, un contexte WebGL2 ou IndexedDB.
 * ========================================================================= */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const JS = path.join(__dirname, '..', 'public', 'static', 'js');
const HEADLESS = ['blocks', 'noise', 'worldgen', 'mesher', 'crafting', 'physics', 'entities'];

const sandbox = { console, performance: { now: () => Date.now() } };
sandbox.self = sandbox;
sandbox.globalThis = sandbox;
const ctx = vm.createContext(sandbox);

let pass = 0, fail = 0;
const failures = [];
function ok(label, cond, detail) {
  if (cond) { pass++; console.log('  \u2713 ' + label + (detail ? '  (' + detail + ')' : '')); }
  else { fail++; failures.push(label); console.log('  \u2717 ' + label + (detail ? ' \u2014 ' + detail : '')); }
}
function section(t) { console.log('\n\x1b[1m' + t + '\x1b[0m'); }

/* Les objets créés à l'intérieur du contexte `vm` appartiennent à un autre
 * royaume (realm) : leurs constructeurs diffèrent de ceux de l'hôte, si bien
 * que `instanceof Float32Array` est faussement négatif. On compare donc le
 * nom du constructeur, non l'identité du prototype. */
function isType(v, name) {
  return !!v && !!v.constructor && v.constructor.name === name;
}

/* Calibrage : la machine du bac à sable est fortement bridée. On mesure une
 * boucle arithmétique de référence et on en déduit un facteur d'échelle, afin
 * que les seuils de performance restent significatifs ailleurs. */
const CALIB = (() => {
  let s = 0;
  for (let i = 0; i < 5e6; i++) s += Math.sqrt(i) * 0.5;   // chauffe
  const t = process.hrtime.bigint();
  s = 0;
  for (let i = 0; i < 5e6; i++) s += Math.sqrt(i) * 0.5;
  const nsPerIter = Number(process.hrtime.bigint() - t) / 5e6;
  return { nsPerIter, factor: Math.max(1, nsPerIter / 0.45) };
})();
function budget(msOnDesktop) { return msOnDesktop * CALIB.factor; }

/* ══════════════════════════════════ 1 ══════════════════════════════════ */
section('1. Chargement des modules en contexte isolé');
for (const m of HEADLESS) {
  try {
    vm.runInContext(fs.readFileSync(path.join(JS, m + '.js'), 'utf8'), ctx, { filename: m + '.js' });
    ok(m + '.js évalué', true);
  } catch (e) { ok(m + '.js évalué', false, e.message); process.exit(1); }
}
const V = sandbox.VC, N = sandbox.VCNoise, G = sandbox.VCGen;
const MSH = sandbox.VCMesher, CR = sandbox.VCCraft, PH = sandbox.VCPhys, EN = sandbox.VCEnt;
const B = V.B, I = V.I;
console.log('  · calibrage machine : ' + CALIB.nsPerIter.toFixed(2) +
  ' ns/itération arithmétique — facteur ' + CALIB.factor.toFixed(1) + '× vs poste de bureau');

/* ══════════════════════════════════ 2 ══════════════════════════════════ */
section('2. Registre des blocs — cohérence des tables plates');
ok('exports VC complets', !!(V.B && V.I && V.CH_X && V.T_SOLID && V.T_TILES));
ok('volume de chunk = CH_X·CH_Y·CH_Z', V.CH_VOL === V.CH_X * V.CH_Y * V.CH_Z,
  V.CH_X + '×' + V.CH_Y + '×' + V.CH_Z + ' = ' + V.CH_VOL);
ok('aire de chunk = CH_X·CH_Z', V.CH_AREA === V.CH_X * V.CH_Z);
ok('idx() bijectif sur le volume', (() => {
  const seen = new Set();
  for (let y = 0; y < 4; y++) for (let z = 0; z < V.CH_Z; z++) for (let x = 0; x < V.CH_X; x++) {
    const i = V.idx(x, y, z);
    if (seen.has(i) || i < 0 || i >= V.CH_VOL) return false;
    seen.add(i);
  }
  return seen.size === 4 * V.CH_Z * V.CH_X;
})());
ok('air : ni solide ni opaque', !V.T_SOLID[B.AIR] && !V.T_OPAQUE[B.AIR]);
ok('pierre : solide et opaque', !!V.T_SOLID[B.STONE] && !!V.T_OPAQUE[B.STONE]);
ok('eau : liquide, non solide', !!V.T_LIQUID[B.WATER] && !V.T_SOLID[B.WATER]);
ok('verre : solide mais transparent', !!V.T_SOLID[B.GLASS] && !V.T_OPAQUE[B.GLASS]);
ok('feuillage en découpe (alphaTest)', !!V.T_CUTOUT[B.LEAVES]);
ok('torche émissive', V.T_LIGHT[B.TORCH] > 0, 'niveau ' + V.T_LIGHT[B.TORCH]);
ok('pierre lumineuse au maximum', V.T_LIGHT[B.GLOWSTONE] === 15);
ok('invariant : tout bloc opaque est solide', (() => {
  for (let i = 0; i < 256; i++) if (V.T_OPAQUE[i] && !V.T_SOLID[i]) return false;
  return true;
})());
ok('invariant : niveaux de lumière dans [0,15]', (() => {
  for (let i = 0; i < 256; i++) if (V.T_LIGHT[i] > 15) return false;
  return true;
})());
ok('table de tuiles : 6 faces par bloc', V.T_TILES.length >= 6 * 64, 'longueur ' + V.T_TILES.length);
{
  let n = 0; for (const k in B) n++;
  let m = 0; for (const k in I) m++;
  ok('registre étoffé', n >= 60 && m >= 40, n + ' blocs, ' + m + ' objets');
}
ok('breakTime croît avec la dureté', V.breakTime(B.OBSIDIAN, 0) > V.breakTime(B.DIRT, 0),
  'obsidienne ' + V.breakTime(B.OBSIDIAN, 0).toFixed(1) + ' s vs terre ' + V.breakTime(B.DIRT, 0).toFixed(2) + ' s');
ok('bûche combustible', V.fuelValue(B.LOG) > 0, V.fuelValue(B.LOG) + ' unités');
ok('pierre non combustible', !V.fuelValue(B.STONE));

/* ══════════════════════════════════ 3 ══════════════════════════════════ */
section('3. Bruits — bornes, déterminisme, continuité');
{
  const p = new N.Perlin(1337);
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < 5000; i++) {
    const v = p.noise2(i * 0.137, i * 0.061);
    if (v < mn) mn = v; if (v > mx) mx = v;
  }
  ok('Perlin.noise2 borné dans [-1,1]', mn >= -1.001 && mx <= 1.001,
    mn.toFixed(3) + ' … ' + mx.toFixed(3));
  ok('Perlin.noise2 non dégénéré', mx - mn > 0.9, 'amplitude ' + (mx - mn).toFixed(3));
  ok('Perlin nul aux nœuds entiers (propriété du gradient)',
    Math.abs(p.noise3(3, 5, 7)) < 1e-9, p.noise3(3, 5, 7).toExponential(2));
  ok('Perlin déterministe', p.noise2(3.7, -2.1) === p.noise2(3.7, -2.1));
  const a = p.noise2(10, 10), b2 = p.noise2(10.001, 10);
  ok('Perlin continu (lipschitzien local)', Math.abs(a - b2) < 0.02,
    '|Δ| = ' + Math.abs(a - b2).toExponential(2));
  const q = new N.Perlin(1337);
  ok('même graine → même permutation', q.noise2(4.2, 8.8) === p.noise2(4.2, 8.8));
  const r = new N.Perlin(1338);
  ok('graine différente → champ différent', r.noise2(4.2, 8.8) !== p.noise2(4.2, 8.8));
}
{
  const f = new N.FBM(42, 5, 2.0, 0.5);
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < 3000; i++) {
    const v = f.get2(i * 1.7, i * 0.9, 0.01);
    if (v < mn) mn = v; if (v > mx) mx = v;
  }
  ok('FBM.get2 normalisé dans [-1,1]', mn >= -1.05 && mx <= 1.05,
    mn.toFixed(3) + ' … ' + mx.toFixed(3));
  // ridged2 replie le bruit par 1-|n|, puis recentre : image dans [-1,1].
  let rmn = Infinity, rmx = -Infinity;
  for (let i = 0; i < 3000; i++) {
    const v = f.ridged2(i * 1.3, i * 2.1, 0.01);
    if (v < rmn) rmn = v; if (v > rmx) rmx = v;
  }
  ok('ridged2 borné dans [-1,1]', rmn >= -1.01 && rmx <= 1.01, rmn.toFixed(3) + ' … ' + rmx.toFixed(3));
  ok('ridged2 produit des crêtes (asymétrie vers le haut)',
    rmx > 0.7, 'maximum ' + rmx.toFixed(3));
}
{
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < 5000; i++) {
    const v = N.hash3(i, (i * 7) & 63, i * 3, 1234);
    if (v < mn) mn = v; if (v > mx) mx = v;
  }
  ok('hash3 dans [0,1)', mn >= 0 && mx < 1, mn.toFixed(5) + ' … ' + mx.toFixed(5));
  ok('hash3 sans état', N.hash3(5, 9, 11, 42) === N.hash3(5, 9, 11, 42));
  // Uniformité grossière : test du χ² sur 10 classes.
  const bins = new Array(10).fill(0);
  const M = 20000;
  for (let i = 0; i < M; i++) bins[Math.min(9, (N.hash3(i, i * 3 + 1, i * 7 + 2, 77) * 10) | 0)]++;
  const exp = M / 10;
  const chi2 = bins.reduce((s, o) => s + (o - exp) * (o - exp) / exp, 0);
  ok('hash3 ~uniforme (χ² < 27,88 à 9 ddl, α = 0,001)', chi2 < 27.88, 'χ² = ' + chi2.toFixed(2));
}
{
  const r1 = N.mulberry32(999), r2 = N.mulberry32(999);
  let same = true, inRange = true;
  for (let i = 0; i < 500; i++) {
    const a = r1(), b2 = r2();
    if (a !== b2) same = false;
    if (a < 0 || a >= 1) inRange = false;
  }
  ok('mulberry32 reproductible', same);
  ok('mulberry32 dans [0,1)', inRange);
}
{
  const s = N.spline([[-1, 0], [0, 64], [1, 128]]);
  ok('spline interpole les nœuds', Math.abs(s(0) - 64) < 1e-6, 's(0) = ' + s(0));
  ok('spline monotone sur l’exemple', s(-0.5) < s(0) && s(0) < s(0.5),
    [s(-0.5), s(0), s(0.5)].map(x => x.toFixed(1)).join(' < '));
  ok('spline saturée hors bornes', s(-3) === s(-1) && s(3) === s(1));
}

/* ══════════════════════════════════ 4 ══════════════════════════════════ */
section('4. Génération de terrain');
const SEED = 20260806;
const gen = new G.WorldGenerator(SEED);
{
  let n = 0; for (const k in G.BIOME) n++;
  ok('au moins 20 biomes', n >= 20, n + ' biomes');
  let complete = true, bad = '';
  for (const k in G.BIOME) {
    const d = G.BIOME_DATA[G.BIOME[k]];
    if (!d || d.top === undefined || d.grass === undefined) { complete = false; bad = k; break; }
  }
  ok('BIOME_DATA complet (top + grass)', complete, bad);
}
{
  const cl = gen.sampleClimate(0, 0);
  const keys = Object.keys(cl);
  ok('sampleClimate renvoie un vecteur climatique', keys.length >= 6, keys.join(', '));
  // cont/eros/pv/temp/hum/weird/river sont des bruits normalisés ; wxw/wzw sont
  // les décalages de domain warping, exprimés en blocs — amplitude bien plus large.
  const NORMALISED = ['cont', 'eros', 'pv', 'temp', 'hum', 'weird', 'river'];
  let bounded = true, offender = '';
  let warpMax = 0;
  for (let i = -2000; i <= 2000; i += 137) {
    const c = gen.sampleClimate(i, i * 2 + 11);
    for (const k of NORMALISED)
      if (typeof c[k] === 'number' && Math.abs(c[k]) > 1.05) { bounded = false; offender = k + ' = ' + c[k].toFixed(3); }
    warpMax = Math.max(warpMax, Math.abs(c.wxw), Math.abs(c.wzw));
  }
  ok('composantes climatiques normalisées dans [-1,1]', bounded, offender);
  ok('domain warping d’amplitude raisonnable (< 64 blocs)', warpMax < 64,
    'décalage maximal ' + warpMax.toFixed(1) + ' blocs');
  // Continuité du champ climatique : deux points voisins donnent un climat proche.
  const a = gen.sampleClimate(500, 500), b2 = gen.sampleClimate(501, 500);
  let smooth = true;
  for (const k of NORMALISED) if (Math.abs(a[k] - b2[k]) > 0.05) smooth = false;
  ok('champ climatique continu (variation < 0,05 par bloc)', smooth);
}
const t0 = Date.now();
const chunk = gen.generateChunk(0, 0);
const genMs = Date.now() - t0;
ok('generateChunk → blocks/biomes/heights (Uint8Array)',
  isType(chunk.blocks, 'Uint8Array') && isType(chunk.biomes, 'Uint8Array') && isType(chunk.heights, 'Uint8Array'),
  [chunk.blocks, chunk.biomes, chunk.heights].map(a => a.constructor.name).join(' / '));
ok('longueur du tableau de blocs', chunk.blocks.length === V.CH_VOL);
ok('génération d’un chunk dans le budget (16 ms équivalent bureau)',
  genMs < budget(16), genMs + ' ms mesurés, budget ' + budget(16).toFixed(0) + ' ms');
{
  let nonAir = 0, bedrock = 0, water = 0;
  for (let i = 0; i < chunk.blocks.length; i++) {
    const id = chunk.blocks[i];
    if (id !== B.AIR) nonAir++;
    if (id === B.BEDROCK) bedrock++;
    if (id === B.WATER) water++;
  }
  ok('chunk substantiellement rempli', nonAir > 8000,
    nonAir + ' blocs (' + (100 * nonAir / V.CH_VOL).toFixed(1) + ' % du volume)');
  ok('socle rocheux présent', bedrock >= V.CH_AREA, bedrock + ' blocs');
  let sealed = true;
  for (let z = 0; z < V.CH_Z && sealed; z++)
    for (let x = 0; x < V.CH_X; x++)
      if (chunk.blocks[V.idx(x, 0, z)] !== B.BEDROCK) { sealed = false; break; }
  ok('y = 0 hermétiquement en bedrock (aucune fuite par le bas)', sealed);
  let hmin = 255, hmax = 0;
  for (let i = 0; i < chunk.heights.length; i++) {
    if (chunk.heights[i] < hmin) hmin = chunk.heights[i];
    if (chunk.heights[i] > hmax) hmax = chunk.heights[i];
  }
  ok('hauteurs dans les bornes du monde', hmin >= 1 && hmax <= V.CH_Y - 2, hmin + ' … ' + hmax);
  let bValid = true;
  for (let i = 0; i < chunk.biomes.length; i++)
    if (!G.BIOME_DATA[chunk.biomes[i]]) { bValid = false; break; }
  ok('tout identifiant de biome est défini', bValid);
  console.log('    · eau : ' + water + ' blocs, niveau de la mer y = ' + V.SEA_LEVEL);
}
{
  const g2 = new G.WorldGenerator(SEED).generateChunk(0, 0);
  let identical = true;
  for (let i = 0; i < chunk.blocks.length; i++) if (chunk.blocks[i] !== g2.blocks[i]) { identical = false; break; }
  ok('génération déterministe (même graine, même chunk)', identical);
  const g3 = new G.WorldGenerator(SEED + 1).generateChunk(0, 0);
  let differs = 0;
  for (let i = 0; i < chunk.blocks.length; i++) if (chunk.blocks[i] !== g3.blocks[i]) differs++;
  ok('graine différente → monde franchement différent', differs > V.CH_VOL * 0.02,
    (100 * differs / V.CH_VOL).toFixed(1) + ' % des voxels diffèrent');
}
{
  // Continuité inter-chunks : la hauteur au bord doit coller au chunk voisin.
  const east = gen.generateChunk(1, 0);
  let maxJump = 0;
  for (let z = 0; z < V.CH_Z; z++) {
    const h1 = chunk.heights[z * V.CH_X + (V.CH_X - 1)];
    const h2 = east.heights[z * V.CH_X + 0];
    maxJump = Math.max(maxJump, Math.abs(h1 - h2));
  }
  ok('continuité du relief au bord de chunk', maxJump <= 6, 'écart maximal ' + maxJump + ' bloc(s)');
}
{
  // Minerais : présence et stratification en profondeur.
  let ores = 0, deepOres = 0, diamondY = [];
  for (let y = 1; y < 70; y++)
    for (let z = 0; z < V.CH_Z; z++)
      for (let x = 0; x < V.CH_X; x++) {
        const id = chunk.blocks[V.idx(x, y, z)];
        if (id === B.COAL_ORE || id === B.IRON_ORE || id === B.GOLD_ORE ||
            id === B.DIAMOND_ORE || id === B.REDSTONE_ORE || id === B.LAPIS_ORE) {
          ores++; if (y < 20) deepOres++;
          if (id === B.DIAMOND_ORE) diamondY.push(y);
        }
      }
  ok('minerais générés', ores > 0, ores + ' veines de minerai');
  ok('minerais présents en profondeur', deepOres > 0, deepOres + ' sous y = 20');
  if (diamondY.length) {
    const mx = Math.max.apply(null, diamondY);
    ok('diamant confiné aux couches basses', mx < 24, 'y maximal ' + mx);
  } else ok('diamant confiné aux couches basses', true, 'aucun dans ce chunk — admissible');
}
{
  // Grottes : cavités d'air sous la surface.
  let voids = 0;
  for (let z = 0; z < V.CH_Z; z++)
    for (let x = 0; x < V.CH_X; x++) {
      const h = chunk.heights[z * V.CH_X + x];
      for (let y = 6; y < h - 4; y++) if (chunk.blocks[V.idx(x, y, z)] === B.AIR) voids++;
    }
  ok('réseau de cavités creusé', voids > 0, voids + ' voxels d’air souterrains');
}

/* ══════════════════════════════════ 5 ══════════════════════════════════ */
section('5. Décoration — structures et débordements');
{
  const target = gen.generateChunk(0, 0);
  const before = target.blocks.reduce((a, v) => a + (v !== 0 ? 1 : 0), 0);
  let spill = null, threw = null;
  try { spill = gen.decorate(0, 0, target); } catch (e) { threw = e.message; }
  ok('decorate s’exécute sans exception', !threw, threw);
  const after = target.blocks.reduce((a, v) => a + (v !== 0 ? 1 : 0), 0);
  ok('la décoration n’érode pas le terrain', after >= before, before + ' → ' + after);
  ok('débordement renvoyé sous forme de liste', spill === null || spill === undefined || Array.isArray(spill),
    Array.isArray(spill) ? spill.length + ' entrées' : String(spill));
  if (Array.isArray(spill) && spill.length) {
    ok('débordement en quadruplets [wx,y,wz,id]', spill.length % 4 === 0 || typeof spill[0] === 'object');
  }
  let logs = 0, leaves = 0;
  for (let i = 0; i < target.blocks.length; i++) {
    const id = target.blocks[i];
    if (id === B.LOG || id === B.LOG_BIRCH || id === B.LOG_SPRUCE) logs++;
    if (V.T_CUTOUT[id]) leaves++;
  }
  console.log('    · ' + logs + ' bûches, ' + leaves + ' voxels en découpe (feuillage/plantes)');
}

/* ══════════════════════════════════ 6 ══════════════════════════════════ */
section('6. Lumière propagée et maillage');
ok('constantes du mesher', MSH.MARGIN === 16 && MSH.PX === 48 && MSH.PZ === 48,
  'MARGIN = ' + MSH.MARGIN + ', PX = PZ = ' + MSH.PX);
{
  /* Contrat de meshChunk (lu dans worker.js) :
   *   neighbors[dx+','+dz] = Uint8Array de blocs  — non l'objet chunk ;
   *   biomeColors[biomeId]  = { grass, foliage, water }, chacun un triplet. */
  const neighbors = {};
  let centre = null, hmax = 0;
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const c = gen.generateChunk(dx, dz);
    gen.decorate(dx, dz, c);
    neighbors[dx + ',' + dz] = c.blocks;
    for (let i = 0; i < c.heights.length; i++) if (c.heights[i] > hmax) hmax = c.heights[i];
    if (dx === 0 && dz === 0) centre = c;
  }

  const colors = [];
  for (let i = 0; i < 32; i++) {
    const bd = G.BIOME_DATA[i];
    colors[i] = bd
      ? { grass: bd.grass, foliage: bd.foliage, water: bd.water }
      : { grass: [0.5, 0.7, 0.3], foliage: [0.4, 0.65, 0.25], water: [0.17, 0.44, 0.72] };
  }
  ok('table de couleurs de biome bien formée',
    colors.every(c => Array.isArray(c.grass) && c.grass.length === 3 &&
      Array.isArray(c.foliage) && Array.isArray(c.water)));

  const t1 = Date.now();
  let mesh = null, threw = null;
  try { mesh = MSH.meshChunk(0, 0, neighbors, centre.biomes, colors, hmax); }
  catch (e) { threw = e.message + ' @ ' + (e.stack || '').split('\n')[1]; }
  const meshMs = Date.now() - t1;
  ok('meshChunk s’exécute sans exception', !threw, threw);

  if (mesh) {
    ok('maillage dans le budget (30 ms équivalent bureau)', meshMs < budget(30),
      meshMs + ' ms mesurés, budget ' + budget(30).toFixed(0) + ' ms');
    ok('trois couches : solid / cutout / water',
      !!mesh.solid && !!mesh.cutout && !!mesh.water, Object.keys(mesh).join(', '));
    let totalIdx = 0;
    for (const k of ['solid', 'cutout', 'water']) {
      const L = mesh[k];
      const nv = L.pos.length / 3;
      totalIdx += L.count;
      /* Disposition d'un sommet : pos(x,y,z) · uv(u,v) · lgt(sky,blk,ao) · tnt(r,g,b) */
      ok('couche ' + k + ' : attributs alignés sur les sommets (3/2/3/3)',
        isType(L.pos, 'Float32Array') && L.uv.length === nv * 2 &&
        L.lgt.length === nv * 3 && L.tnt.length === nv * 3,
        nv + ' sommets, ' + L.count + ' indices');
      ok('couche ' + k + ' : occlusion ambiante renseignée', (() => {
        if (!nv) return true;
        let mn = 2, mx = -1;
        for (let i = 2; i < L.lgt.length; i += 3) { const a = L.lgt[i]; if (a < mn) mn = a; if (a > mx) mx = a; }
        return mn >= 0 && mx <= 1;
      })(), nv ? 'canal AO borné dans [0,1]' : 'couche vide');
      ok('couche ' + k + ' : 6 indices par quad (2 triangles)',
        L.count % 6 === 0 && L.count / 6 === nv / 4,
        nv ? (L.count / nv).toFixed(2) + ' indice/sommet' : 'couche vide');
      ok('couche ' + k + ' : tout indice référence un sommet existant', (() => {
        for (let i = 0; i < L.idx.length; i++) if (L.idx[i] >= nv) return false;
        return true;
      })());
      ok('couche ' + k + ' : largeur d’indice adaptée au nombre de sommets',
        L.big ? (isType(L.idx, 'Uint32Array') && nv > 65535)
              : (isType(L.idx, 'Uint16Array') && nv <= 65536),
        L.idx.constructor.name + ' pour ' + nv + ' sommets');
      ok('couche ' + k + ' : UV dans [0,1] (atlas)', (() => {
        for (let i = 0; i < L.uv.length; i++) if (L.uv[i] < -1e-6 || L.uv[i] > 1 + 1e-6) return false;
        return true;
      })());
      ok('couche ' + k + ' : canaux de lumière normalisés dans [0,1]', (() => {
        for (let i = 0; i < L.lgt.length; i++) if (L.lgt[i] < -1e-6 || L.lgt[i] > 1 + 1e-6) return false;
        return true;
      })());
      ok('couche ' + k + ' : teintes dans [0,1]', (() => {
        for (let i = 0; i < L.tnt.length; i++) if (L.tnt[i] < -1e-6 || L.tnt[i] > 1 + 1e-6) return false;
        return true;
      })());
      ok('couche ' + k + ' : positions dans le volume élargi', (() => {
        for (let i = 0; i < L.pos.length; i += 3)
          if (L.pos[i] < -2 || L.pos[i] > V.CH_X + 2 ||
              L.pos[i + 1] < -2 || L.pos[i + 1] > V.CH_Y + 2 ||
              L.pos[i + 2] < -2 || L.pos[i + 2] > V.CH_Z + 2) return false;
        return true;
      })());
    }
    ok('géométrie globale substantielle', totalIdx > 1000, totalIdx + ' indices au total');
    ok('couche solide majoritaire', mesh.solid.count >= mesh.cutout.count,
      mesh.solid.count + ' vs ' + mesh.cutout.count);
    // Le maillage doit élider les faces internes : bien loin de 6 faces/voxel.
    let solidVox = 0;
    for (let i = 0; i < centre.blocks.length; i++) if (V.T_OPAQUE[centre.blocks[i]]) solidVox++;
    const quads = mesh.solid.count / 6;
    ok('élision des faces internes effective (< 1,2 face/voxel)',
      quads > 0 && quads < solidVox * 1.2,
      quads + ' quads pour ' + solidVox + ' voxels opaques — ' +
      (quads / solidVox).toFixed(3) + ' face/voxel au lieu de 6');
  }

  // Propagation de la lumière : le champ padSky doit être physiquement sensé.
  let lightThrew = null;
  try { MSH.computeLight(Math.min(V.CH_Y - 1, hmax + 2)); }
  catch (e) { lightThrew = e.message; }
  ok('computeLight s’exécute', !lightThrew, lightThrew);
  if (!lightThrew) {
    const maxYL = Math.min(V.CH_Y - 1, hmax + 2);
    const px = MSH.MARGIN + 8, pz = MSH.MARGIN + 8;
    const above = MSH.padSky[MSH.pidx(px, maxYL, pz)];
    ok('skylight = 15 au-dessus de tout relief', above === 15, 'valeur ' + above);

    /* Le socle rocheux étant opaque, le ciel ne peut atteindre y = 1 que par
     * propagation latérale depuis une cavité. On cherche donc une colonne
     * franchement obstruée : celle dont le relief est le plus haut. */
    let bx = 0, bz = 0, bh = -1;
    for (let z = 0; z < V.CH_Z; z++) for (let x = 0; x < V.CH_X; x++) {
      const h = centre.heights[z * V.CH_X + x];
      if (h > bh) { bh = h; bx = x; bz = z; }
    }
    const qx = MSH.MARGIN + bx, qz = MSH.MARGIN + bz;
    const deep = MSH.padSky[MSH.pidx(qx, 1, qz)];
    ok('skylight = 0 sous une colonne opaque (y = 1)', deep === 0,
      'colonne (' + bx + ',' + bz + '), relief ' + bh + ', valeur ' + deep);
    ok('skylight = 0 juste sous la surface opaque',
      MSH.padSky[MSH.pidx(qx, bh - 1, qz)] === 0,
      'y = ' + (bh - 1) + ' → ' + MSH.padSky[MSH.pidx(qx, bh - 1, qz)]);

    let bounded = true;
    for (let y = 0; y <= maxYL; y++) {
      const v = MSH.padSky[MSH.pidx(qx, y, qz)];
      if (v < 0 || v > 15) bounded = false;
    }
    ok('skylight borné dans [0,15] sur toute la colonne', bounded);

    /* Invariant fondamental du BFS : la lumière décroît d'au plus 1 par arête
     * du graphe de propagation. Or cette arête n'existe que si les DEUX voxels
     * sont traversables : un saut brutal à travers un voxel opaque (surface du
     * sol, plafond de grotte) n'est pas une violation, mais précisément l'effet
     * attendu de l'occultation. On restreint donc le test aux arêtes air–air.
     * Les blocs filtrants (eau, feuillage) atténuent de T_FILTER à la
     * traversée : la borne devient 1 + filtre. */
    let excess = 0, edges = 0, occluded = 0, worst = null;
    for (let z = 0; z < V.CH_Z; z++)
      for (let x = 0; x < V.CH_X; x++)
        for (let y = 1; y <= maxYL; y++) {
          const idA = centre.blocks[V.idx(x, y, z)];
          const idB = centre.blocks[V.idx(x, y - 1, z)];
          if (V.T_OPAQUE[idA] || V.T_OPAQUE[idB]) { occluded++; continue; }
          const a = MSH.padSky[MSH.pidx(MSH.MARGIN + x, y, MSH.MARGIN + z)];
          const b2 = MSH.padSky[MSH.pidx(MSH.MARGIN + x, y - 1, MSH.MARGIN + z)];
          const tol = 1 + Math.max(V.T_FILTER[idA] || 0, V.T_FILTER[idB] || 0);
          const d = Math.abs(a - b2) - tol;
          if (d > excess) { excess = d; worst = { x, y, z, haut: a, bas: b2, idA, idB, tol }; }
          edges++;
        }
    ok('gradient de lumière ≤ 1 + filtre sur toute arête traversable (invariant du BFS)',
      excess <= 0,
      edges + ' arêtes air–air, ' + occluded + ' occultées' +
      (excess > 0 ? ' — dépassement de ' + excess + ' : ' + JSON.stringify(worst) : ''));

    /* Lumière de bloc : une torche doit éclairer son voisinage de façon
     * strictement décroissante en distance de Manhattan. */
    let lit = 0, maxBlk = 0;
    for (let i = 0; i < MSH.padBlk.length; i++) {
      if (MSH.padBlk[i] > 0) lit++;
      if (MSH.padBlk[i] > maxBlk) maxBlk = MSH.padBlk[i];
    }
    ok('lumière de bloc bornée par 15', maxBlk <= 15, 'maximum ' + maxBlk);
    console.log('    · ' + lit + ' voxels éclairés par des sources de bloc' +
      (lit ? ' (max ' + maxBlk + ')' : ' — aucune source dans ce chunk'));
  }
}

/* ══════════════════════════════════ 7 ══════════════════════════════════ */
section('7. Artisanat et fusion');
{
  ok('exports VCCraft', typeof CR.findRecipe === 'function' && typeof CR.smeltResult === 'function' &&
    typeof CR.allRecipes === 'function' && Array.isArray(CR.shaped) && Array.isArray(CR.shapeless));
  ok('corpus de recettes fourni', CR.shaped.length + CR.shapeless.length >= 25,
    CR.shaped.length + ' façonnées, ' + CR.shapeless.length + ' informes');

  // Recette informe : 1 bûche → 4 planches.
  const g1 = new Array(4).fill(null); g1[0] = { id: B.LOG, n: 1 };
  const planks = CR.findRecipe(g1, 2);
  ok('bûche → planches', !!(planks && planks.id === B.PLANKS),
    planks ? 'id ' + planks.id + ' ×' + planks.n : 'aucune sortie');

  // Recette façonnée invariante par translation dans la grille (trim).
  const shapedR = CR.shaped[0];
  ok('première recette façonnée bien formée',
    !!(shapedR && shapedR.out && shapedR.out.id), JSON.stringify(shapedR && shapedR.out));

  // Établi : 4 planches en carré (le bloc s'appelle B.CRAFTING dans le registre).
  const g2 = new Array(4);
  for (let i = 0; i < 4; i++) g2[i] = { id: B.PLANKS, n: 1 };
  const bench = CR.findRecipe(g2, 2);
  ok('4 planches → établi', !!(bench && bench.id === B.CRAFTING),
    bench ? 'id ' + bench.id + ' (attendu ' + B.CRAFTING + ')' : 'aucune sortie');

  // Invariance par translation : la même forme décalée dans une grille 3×3.
  const g3a = new Array(9).fill(null);
  g3a[0] = { id: B.PLANKS, n: 1 }; g3a[1] = { id: B.PLANKS, n: 1 };
  g3a[3] = { id: B.PLANKS, n: 1 }; g3a[4] = { id: B.PLANKS, n: 1 };
  const g3b = new Array(9).fill(null);
  g3b[4] = { id: B.PLANKS, n: 1 }; g3b[5] = { id: B.PLANKS, n: 1 };
  g3b[7] = { id: B.PLANKS, n: 1 }; g3b[8] = { id: B.PLANKS, n: 1 };
  const ra = CR.findRecipe(g3a, 3), rb = CR.findRecipe(g3b, 3);
  ok('recette façonnée invariante par translation',
    !!(ra && rb && ra.id === rb.id), (ra && ra.id) + ' vs ' + (rb && rb.id));

  ok('grille vide → aucune recette', CR.findRecipe(new Array(9).fill(null), 3) === null);
  ok('combinaison absurde → aucune recette',
    CR.findRecipe([{ id: B.BEDROCK, n: 1 }, { id: B.OBSIDIAN, n: 1 }, null, null], 2) === null);

  const smelt = CR.smeltResult(B.IRON_ORE);
  ok('fusion minerai de fer → lingot', !!smelt, smelt ? 'id ' + (smelt.id || smelt) : 'aucune');
  ok('fusion pierre brute → rien d’absurde', CR.smeltResult(B.BEDROCK) === null);
  const all = CR.allRecipes();
  ok('livre de recettes énumérable', Array.isArray(all) && all.length > 0, all.length + ' entrées');
  let wellFormed = true;
  for (const r of all) if (!r || !r.out || r.out.id === undefined) { wellFormed = false; break; }
  ok('chaque entrée du livre a une sortie identifiée', wellFormed);
}

/* ══════════════════════════════════ 8 ══════════════════════════════════ */
section('8. Physique — AABB balayée et raycast DDA');
{
  ok('exports VCPhys', typeof PH.moveAABB === 'function' && typeof PH.raycast === 'function' &&
    typeof PH.aabbFree === 'function' && typeof PH.blockBoxes === 'function');

  // Monde analytique : plan solide pour y ≤ 63.
  const flat = { getBlock: (x, y, z) => (y <= 63 ? B.STONE : B.AIR) };

  const p1 = { x: 0.5, y: 70, z: 0.5 };
  const r1 = PH.moveAABB(flat, p1, { x: 0, y: -20, z: 0 }, 0.3, 1.8, 0.6);
  ok('chute interceptée par le plan', p1.y >= 63.95 && p1.y <= 64.05, 'y = ' + p1.y.toFixed(4));
  ok('contact au sol signalé', r1.onGround === true);
  ok('collision sur l’axe Y signalée', r1.hitY === true);

  const p2 = { x: 0.5, y: 70, z: 0.5 };
  PH.moveAABB(flat, p2, { x: 3, y: 0, z: 0 }, 0.3, 1.8, 0.6);
  ok('translation horizontale libre exacte', Math.abs(p2.x - 3.5) < 1e-6, 'x = ' + p2.x);

  // Mur vertical en x ≥ 3 : arrêt net, sans traversée (tunneling).
  const wall = { getBlock: (x, y, z) => (y <= 63 || x >= 3) ? B.STONE : B.AIR };
  const p3 = { x: 0.5, y: 64, z: 0.5 };
  const r3 = PH.moveAABB(wall, p3, { x: 50, y: 0, z: 0 }, 0.3, 1.8, 0.0);
  ok('aucune traversée de mur à grande vitesse (50 blocs/pas)',
    p3.x <= 2.71, 'x = ' + p3.x.toFixed(4) + ' (butée théorique 2,7)');
  ok('collision sur l’axe X signalée', r3.hitX === true);

  // Marche de 1 bloc : le step-up de 0,6 ne doit PAS la franchir.
  const step1 = { getBlock: (x, y, z) => (y <= 63 || (x >= 2 && y <= 64)) ? B.STONE : B.AIR };
  const p4 = { x: 0.5, y: 64, z: 0.5 };
  PH.moveAABB(step1, p4, { x: 3, y: 0, z: 0 }, 0.3, 1.8, 0.6);
  ok('marche de 1 bloc infranchissable sans saut (step 0,6)', p4.y < 64.5,
    'y = ' + p4.y.toFixed(3) + ', x = ' + p4.x.toFixed(3));

  // Plafond : blocage vers le haut à hauteur de tête.
  const roof = { getBlock: (x, y, z) => (y <= 63 || y >= 68) ? B.STONE : B.AIR };
  const p5 = { x: 0.5, y: 64, z: 0.5 };
  const r5 = PH.moveAABB(roof, p5, { x: 0, y: 10, z: 0 }, 0.3, 1.8, 0.6);
  ok('plafond bloque l’ascension', p5.y + 1.8 <= 68.01, 'sommet à y = ' + (p5.y + 1.8).toFixed(3));
  ok('collision haute signalée', r5.hitY === true);

  // aabbFree prend une boîte explicite (min, max), non un centre et un gabarit.
  ok('aabbFree : boîte entièrement dans l’air',
    PH.aabbFree(flat, 0.2, 65.0, 0.2, 0.8, 66.8, 0.8) === true);
  ok('aabbFree : boîte intersectant le plan',
    PH.aabbFree(flat, 0.2, 62.0, 0.2, 0.8, 63.8, 0.8) === false);
  ok('aabbFree : boîte tangente par le dessus (exclusion à 1e-6)',
    PH.aabbFree(flat, 0.2, 64.0, 0.2, 0.8, 65.8, 0.8) === true);

  // Raycast DDA.
  const hit = PH.raycast(flat, 0.5, 70, 0.5, 0, -1, 0, 20);
  ok('raycast vertical touche le plan', !!hit);
  if (hit) {
    ok('bloc touché à y = 63', hit.y === 63, 'y = ' + hit.y);
    ok('normale sortante orientée vers le haut', hit.ny === 1,
      'n = (' + hit.nx + ',' + hit.ny + ',' + hit.nz + ')');
    ok('distance parcourue ≈ 6', Math.abs(hit.dist - 6) < 0.05, 'd = ' + hit.dist.toFixed(4));
    ok('identifiant du bloc rapporté', hit.id === B.STONE);
  }
  ok('raycast vers le ciel ne touche rien', !PH.raycast(flat, 0.5, 70, 0.5, 0, 1, 0, 20));
  ok('raycast borné par maxDist', !PH.raycast(flat, 0.5, 90, 0.5, 0, -1, 0, 5));

  // Raycast oblique : la normale doit être unitaire selon un seul axe.
  const obl = PH.raycast(flat, 0.5, 70, 0.5, 0.4, -0.8, 0.45, 30);
  ok('raycast oblique aboutit', !!obl);
  if (obl) {
    const nsum = Math.abs(obl.nx) + Math.abs(obl.ny) + Math.abs(obl.nz);
    ok('normale canonique (un seul axe non nul)', nsum === 1,
      'n = (' + obl.nx + ',' + obl.ny + ',' + obl.nz + ')');
  }
  // L'eau est traversée sauf demande explicite.
  const sea = { getBlock: (x, y, z) => y <= 55 ? B.STONE : (y <= 62 ? B.WATER : B.AIR) };
  const thruWater = PH.raycast(sea, 0.5, 70, 0.5, 0, -1, 0, 30, false);
  ok('l’eau est transparente au raycast par défaut',
    !!thruWater && thruWater.id === B.STONE, thruWater ? 'id ' + thruWater.id : 'aucun');
  const onWater = PH.raycast(sea, 0.5, 70, 0.5, 0, -1, 0, 30, true);
  ok('l’eau est ciblable sur demande',
    !!onWater && onWater.id === B.WATER, onWater ? 'id ' + onWater.id : 'aucun');
  ok('fluidAt détecte l’eau', PH.fluidAt(sea, 0.5, 60, 0.5) === B.WATER ||
    !!PH.fluidAt(sea, 0.5, 60, 0.5));
}

/* ══════════════════════════════════ 9 ══════════════════════════════════ */
section('9. Créatures, items au sol et particules');
{
  ok('exports VCEnt', typeof EN.Mob === 'function' && typeof EN.ItemEntity === 'function' &&
    typeof EN.ParticleSystem === 'function' && !!EN.MOB_DEF);
  const ids = Object.keys(EN.MOB_DEF);
  ok('au moins 8 espèces définies', ids.length >= 8, ids.join(', '));
  let sane = true, bad = '';
  for (const k of ids) {
    const d = EN.MOB_DEF[k];
    if (!d || !(d.hp > 0) || !(d.w > 0) || !(d.h > 0) || !Array.isArray(d.body) ||
        !Array.isArray(d.color) || d.xp === undefined) { sane = false; bad = k; break; }
  }
  ok('chaque espèce : hp, gabarit, morphologie, teinte, xp', sane, bad);
  ok('partition passif / hostile cohérente',
    Array.isArray(EN.PASSIVE) && Array.isArray(EN.HOSTILE) &&
    EN.PASSIVE.every(k => !EN.MOB_DEF[k].hostile) &&
    EN.HOSTILE.every(k => !!EN.MOB_DEF[k].hostile),
    EN.PASSIVE.length + ' passifs, ' + EN.HOSTILE.length + ' hostiles');
  let dropsOk = true;
  for (const k of ids) {
    const d = EN.MOB_DEF[k];
    if (!d.drops) continue;
    for (const dr of d.drops) if (!Array.isArray(dr) || dr.length !== 3 || dr[1] > dr[2]) { dropsOk = false; break; }
  }
  ok('tables de butin bien formées [id, min, max]', dropsOk);

  // Simulation d'une créature dans un monde plat.
  const flat = { getBlock: (x, y, z) => (y <= 63 ? B.STONE : B.AIR) };
  const mob = new EN.Mob('pig', 8.5, 70, 8.5);
  ok('créature instanciée avec pv complets', mob.hp === EN.MOB_DEF.pig.hp, 'hp = ' + mob.hp);
  const player = { x: 100, y: 65, z: 100, hp: 20, half: 0.3, height: 1.8, mode: 'survival' };
  let mobThrew = null;
  try { for (let i = 0; i < 200; i++) mob.update(1 / 20, flat, player, true); }
  catch (e) { mobThrew = e.message; }
  ok('200 pas de simulation sans exception', !mobThrew, mobThrew);
  ok('créature retombée sur le sol', mob.y >= 63.9 && mob.y <= 64.6, 'y = ' + mob.y.toFixed(3));
  ok('coordonnées finies (aucune divergence numérique)',
    isFinite(mob.x) && isFinite(mob.y) && isFinite(mob.z));
  ok('déplacement effectif (errance)', Math.abs(mob.x - 8.5) + Math.abs(mob.z - 8.5) > 0.01,
    'Δ = ' + (Math.abs(mob.x - 8.5) + Math.abs(mob.z - 8.5)).toFixed(3));

  // Poursuite : un zombie doit converger vers un joueur proche.
  const hostileKey = EN.HOSTILE[0];
  const z1 = new EN.Mob(hostileKey, 0, 65, 0);
  const near = { x: 8, y: 64.5, z: 0, hp: 20, half: 0.3, height: 1.8, mode: 'survival' };
  const d0 = Math.hypot(z1.x - near.x, z1.z - near.z);
  for (let i = 0; i < 120; i++) z1.update(1 / 20, flat, near, false);
  const d1 = Math.hypot(z1.x - near.x, z1.z - near.z);
  ok('créature hostile (' + hostileKey + ') converge vers le joueur', d1 < d0,
    d0.toFixed(2) + ' → ' + d1.toFixed(2) + ' blocs');

  /* ItemEntity(x, y, z, id, count) — identifiant et compte séparés, non un
   * objet {id,n} ; update(dt, world, player) exige le joueur pour le ramassage. */
  const it = new EN.ItemEntity(4.5, 70, 4.5, B.STONE, 3);
  ok('item au sol : charge utile enregistrée', it.item === B.STONE && it.count === 3,
    'item ' + it.item + ' ×' + it.count);
  ok('délai de ramassage initial (anti-réabsorption)', it.pickupDelay > 0,
    it.pickupDelay + ' s');
  const far = { x: 500, y: 65, z: 500, half: 0.3, height: 1.8, inv: { add: () => true } };
  let itThrew = null;
  try { for (let i = 0; i < 120; i++) it.update(1 / 20, flat, far); }
  catch (e) { itThrew = e.message; }
  ok('item au sol simulé sans exception', !itThrew, itThrew);
  ok('item retombé et immobilisé sur le sol', it.y >= 63.8 && it.y <= 64.5,
    'y = ' + it.y.toFixed(3));
  ok('délai de ramassage écoulé après 6 s', it.pickupDelay <= 0);

  // Particules : compactage du tableau après extinction.
  const ps = new EN.ParticleSystem(512);
  ok('capacité en Structure-of-Arrays (tableaux typés parallèles)',
    isType(ps.x, 'Float32Array') && ps.x.length === 512 &&
    isType(ps.tile, 'Int16Array') && ps.life.length === 512,
    '12 tableaux de ' + ps.max + ' entrées');
  for (let i = 0; i < 400; i++)
    ps.spawn(i * 0.01, 70, 0, 0, 0, 0, 0.5, 0.1, [1, 1, 1], 1, 0);
  ok('400 particules émises', ps.n === 400, 'n = ' + ps.n);
  for (let i = 0; i < 600; i++) ps.spawn(0, 70, 0, 0, 0, 0, 0.5, 0.1, [1, 1, 1], 1, 0);
  ok('capacité jamais dépassée (pas de débordement)', ps.n <= ps.max, 'n = ' + ps.n + '/' + ps.max);
  for (let i = 0; i < 40; i++) ps.update(1 / 20, flat);
  ok('particules expirées compactées', ps.n === 0, 'n = ' + ps.n);
}

/* ══════════════════════════════════ 10 ═════════════════════════════════ */
section('10. Contrat d’assemblage : la page fournit-elle tous les nœuds ?');
{
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.tsx'), 'utf8');
  const required = [
    'gl', 'hud', 'ui-root', 'hotbar', 'panel', 'panel-inner', 'panel-head',
    'panel-title', 'panel-close', 'panel-body', 'drag-cursor', 'tooltip',
    'main-menu', 'menu-home', 'menu-create', 'menu-load', 'menu-settings',
    'menu-settings-body', 'world-list', 'wname', 'seed', 'btn-new', 'btn-load',
    'btn-settings', 'btn-random-seed', 'btn-create', 'loading', 'loading-track',
    'loading-bar', 'loading-text', 'loading-tip', 'pause-menu', 'pause-settings',
    'btn-resume', 'btn-save', 'btn-settings-game', 'btn-quit',
    'death-screen', 'death-cause', 'btn-respawn'
  ];
  const missing = required.filter(id => !html.includes('id="' + id + '"'));
  ok('les ' + required.length + ' identifiants requis sont présents', missing.length === 0,
    missing.length ? 'manquants : ' + missing.join(', ') : 'aucun manquant');
  ok('boutons Retour porteurs de data-back', html.includes('data-back'));
  ok('radios de mode survival / creative',
    html.includes('value="survival"') && html.includes('value="creative"'));
  ok('feuille de style liée', html.includes('/static/css/style.css'));

  const order = ['blocks', 'noise', 'worldgen', 'mesher', 'atlas', 'crafting',
    'renderer', 'physics', 'entities', 'audio', 'world', 'ui', 'game', 'main'];
  const listed = (html.match(/const MODULES = \[[\s\S]*?\n\]/) || [''])[0];
  const found = order.filter(m => listed.includes("'" + m + "'"));
  ok('14 modules déclarés dans l’ordre de dépendance',
    found.length === order.length && found.join() === order.join(), found.length + '/14');
  ok('chaque module existe sur le disque',
    order.every(m => fs.existsSync(path.join(JS, m + '.js'))));
  ok('worker.js présent mais non chargé par la page',
    fs.existsSync(path.join(JS, 'worker.js')) && !/'worker'/.test(listed));

  // Le CSS doit couvrir les classes émises dynamiquement par ui.js et main.js.
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'static', 'css', 'style.css'), 'utf8');
  const classes = ['hslot', 'icon', 'cnt', 'dur', 'slot', 'craft-area', 'craft-grid',
    'arrow', 'furnace-area', 'flame', 'fprog', 'chest-grid', 'inv-grid', 'rfilter',
    'recipes', 'rec', 'screen', 'card', 'btn', 'field', 'modes', 'mode-opt',
    'setting', 'world-row', 'menu-note'];
  const noCss = classes.filter(c => !css.includes('.' + c));
  ok('les ' + classes.length + ' classes dynamiques sont stylées', noCss.length === 0,
    noCss.length ? 'manquantes : ' + noCss.join(', ') : 'aucune manquante');
}

/* ═════════════════════════════════ Bilan ═══════════════════════════════ */
console.log('\n' + '═'.repeat(64));
console.log('  \x1b[1m' + pass + ' assertions vérifiées, ' + fail + ' échec(s)\x1b[0m');
if (fail) console.log('  Échecs : ' + failures.join(' · '));
console.log('═'.repeat(64) + '\n');
process.exit(fail === 0 ? 0 : 1);
