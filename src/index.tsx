import { Hono } from 'hono'

const app = new Hono()

/* ---------------------------------------------------------------------------
 * Ordre de chargement des modules — il est significatif : chaque module
 * publie un objet global (VC, VCNoise, …) que les suivants capturent au
 * moment de leur exécution, dans la fermeture de tête. Toute permutation
 * provoque un ReferenceError à l'amorçage.
 * ------------------------------------------------------------------------- */
const MODULES = [
  'blocks',   // registre des blocs et objets, tables plates
  'noise',    // Perlin 2002, FBM, ridged, splines, Voronoï, PRNG
  'worldgen', // climat multi-bruits, 20 biomes, grottes, minerais
  'mesher',   // propagation de lumière BFS, maillage AO / smooth lighting
  'atlas',    // atlas de textures procédural (aucun asset externe)
  'crafting', // recettes façonnées / informes, fusion
  'renderer', // WebGL2 : 4 programmes GLSL ES 3.00, frustum culling
  'physics',  // AABB balayée, raycast DDA d'Amanatides & Woo
  'entities', // mobs à automate fini, items au sol, particules SoA
  'audio',    // synthèse WebAudio procédurale
  'world',    // streaming de chunks, Web Worker, persistance IndexedDB
  'ui',       // inventaire glisser-déposer, établi, fourneau, coffre
  'game',     // état, entrées, simulation 20 Hz, sauvegarde
  'main'      // boucle rAF, rendu 3 passes, HUD, menus
]

const TIPS = [
  'Le terrain repose sur trois bruits indépendants — continentalité, érosion et « peaks & valleys » — combinés par splines.',
  'L’occlusion ambiante est calculée par sommet à partir des trois voisins de chaque coin, puis interpolée bilinéairement.',
  'La lumière se propage par parcours en largeur sur un volume élargi de 16 blocs, afin que les bords de chunk restent cohérents.',
  'La simulation avance à pas fixe de 20 Hz ; le rendu, lui, est libre. Un accumulateur borné évite la spirale de la mort.',
  'Les textures ne sont pas des fichiers : l’atlas 256 × 256 est dessiné au canvas à chaque lancement.',
  'Seules les différences de blocs sont sauvegardées — le terrain de base étant redéductible de la graine.',
  'Le maillage des chunks se fait dans un Web Worker, transféré sans copie via des ArrayBuffer.'
]

app.get('/', (c) => {
  return c.html(`<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <meta name="description" content="VOXELCRAFT — moteur voxel original en WebGL 2 : génération procédurale multi-bruits, éclairage propagé, occlusion ambiante, physique AABB, artisanat et créatures.">
  <meta name="theme-color" content="#0b0d10">
  <title>VOXELCRAFT — moteur voxel WebGL 2</title>
  <link href="/static/css/style.css" rel="stylesheet">
</head>
<body>

  <!-- ============================================================ Rendu -->
  <canvas id="gl"></canvas>
  <canvas id="hud"></canvas>

  <!-- ====================================================== UI de jeu -->
  <div id="ui-root">
    <div id="hotbar"></div>

    <div id="panel">
      <div id="panel-inner">
        <div id="panel-head">
          <span id="panel-title">Inventaire</span>
          <button id="panel-close" type="button" title="Fermer (Échap)">&times;</button>
        </div>
        <div id="panel-body"></div>
      </div>
    </div>

    <div id="drag-cursor"></div>
    <div id="tooltip"></div>
  </div>

  <!-- ======================================================= Menu principal -->
  <div id="main-menu" class="screen">

    <!-- ------------------------------------------------------- Accueil -->
    <div id="menu-home" class="card" style="display:none">
      <h1 class="brand">VOXELCRAFT</h1>
      <p class="tagline">Moteur voxel original · WebGL 2 · génération procédurale</p>
      <button id="btn-new" class="btn primary" type="button">Nouveau monde</button>
      <button id="btn-load" class="btn" type="button">Charger une partie</button>
      <button id="btn-settings" class="btn" type="button">Réglages</button>
      <p class="menu-note">
        Œuvre originale : aucun élément graphique ou sonore n’est emprunté à
        Mojang. Terrain, textures et sons sont synthétisés à l’exécution.
        <br>
        <b>Commandes</b> — ZQSD/WASD : déplacement · Espace : saut · Maj : accroupi ·
        Ctrl : sprint · clic gauche : miner · clic droit : poser ou utiliser ·
        E : inventaire · 1–9 : barre rapide · molette : sélection ·
        T : basculer survie/créatif · F3 : débogage · Échap : pause.
      </p>
    </div>

    <!-- ------------------------------------------------ Création monde -->
    <div id="menu-create" class="card" style="display:none">
      <h2>Nouveau monde</h2>

      <div class="field">
        <label for="wname">Nom du monde</label>
        <input id="wname" type="text" maxlength="40" placeholder="Nouveau monde" value="Nouveau monde" autocomplete="off">
      </div>

      <div class="field">
        <label for="seed">Graine</label>
        <div class="field-row">
          <input id="seed" type="text" maxlength="48" placeholder="entier ou texte" autocomplete="off">
          <button id="btn-random-seed" class="btn small" type="button">Aléatoire</button>
        </div>
        <p class="hint">
          Un texte est réduit à un entier 32 bits par hachage FNV-1a : la même
          chaîne redonne exactement le même monde.
        </p>
      </div>

      <div class="field">
        <label>Mode de jeu</label>
        <div class="modes">
          <label class="mode-opt">
            <input type="radio" name="mode" value="survival" checked>
            <b>Survie</b>
            <span>Points de vie, faim, chutes, noyade, créatures hostiles, minage progressif.</span>
          </label>
          <label class="mode-opt">
            <input type="radio" name="mode" value="creative">
            <b>Créatif</b>
            <span>Vol libre, ressources illimitées, destruction instantanée, invulnérabilité.</span>
          </label>
        </div>
      </div>

      <button id="btn-create" class="btn primary" type="button">Créer et jouer</button>
      <button class="btn ghost" type="button" data-back>Retour</button>
    </div>

    <!-- --------------------------------------------------- Chargement -->
    <div id="menu-load" class="card wide" style="display:none">
      <h2>Parties enregistrées</h2>
      <div id="world-list"></div>
      <button class="btn ghost" type="button" data-back>Retour</button>
    </div>

    <!-- ------------------------------------------------------ Réglages -->
    <div id="menu-settings" class="card" style="display:none">
      <h2>Réglages</h2>
      <div id="menu-settings-body"></div>
      <p class="menu-note">
        La distance de rendu gouverne le nombre de chunks tenus en mémoire :
        son coût croît en O(d²) pour le maillage et la mémoire graphique.
      </p>
      <button class="btn ghost" type="button" data-back>Retour</button>
    </div>
  </div>

  <!-- ============================================================ Chargement -->
  <div id="loading" class="screen dark">
    <div class="brand">VOXELCRAFT</div>
    <div id="loading-track"><div id="loading-bar"></div></div>
    <div id="loading-text">Initialisation…</div>
    <div id="loading-tip">${TIPS[0]}</div>
  </div>

  <!-- ================================================================ Pause -->
  <div id="pause-menu" class="screen dark">
    <div class="card">
      <h2>Partie en pause</h2>
      <button id="btn-resume" class="btn primary" type="button">Reprendre</button>
      <button id="btn-save" class="btn" type="button">Sauvegarder maintenant</button>
      <button id="btn-settings-game" class="btn" type="button">Réglages</button>
      <div id="pause-settings"></div>
      <button id="btn-quit" class="btn danger" type="button">Sauvegarder et quitter</button>
      <p class="menu-note">
        La sauvegarde est également automatique toutes les 45 secondes ainsi
        qu’à la fermeture de l’onglet.
      </p>
    </div>
  </div>

  <!-- ================================================================= Mort -->
  <div id="death-screen" class="screen">
    <div class="card">
      <h2>Vous êtes mort</h2>
      <p id="death-cause" class="menu-note">—</p>
      <button id="btn-respawn" class="btn primary" type="button">Réapparaître</button>
    </div>
  </div>

  <noscript>
    <div class="screen" style="display:flex">
      <div class="card">
        <h2>JavaScript requis</h2>
        <p class="menu-note">Ce moteur s’exécute intégralement côté client.</p>
      </div>
    </div>
  </noscript>

  <script>
    // Rotation des notes techniques pendant la génération du terrain.
    (function () {
      var tips = ${JSON.stringify(TIPS)};
      var el, i = 0;
      setInterval(function () {
        el = el || document.getElementById('loading-tip');
        if (el && el.offsetParent !== null) { i = (i + 1) % tips.length; el.textContent = tips[i]; }
      }, 4200);
    })();
  </script>

${MODULES.map((m) => `  <script src="/static/js/${m}.js"></script>`).join('\n')}

</body>
</html>`)
})

export default app
