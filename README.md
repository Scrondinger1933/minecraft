# VOXELCRAFT

## Présentation

- **Nom** : VOXELCRAFT
- **Nature** : moteur de jeu voxel **original**, écrit intégralement à la main en JavaScript et WebGL 2 (GLSL ES 3.00), sans moteur tiers ni dépendance d'exécution.
- **Objectif** : explorer les techniques réelles d'un moteur de type « monde de blocs » — génération procédurale multi-bruits, maillage par élision de faces, propagation de lumière par parcours en largeur, physique AABB à résolution séparée par axe — plutôt que d'assembler des briques préexistantes.

> **Avertissement juridique.** Ce projet n'est pas un clone de *Minecraft* et ne peut pas l'être : les textures, sons, modèles et le code de Mojang sont protégés par le droit d'auteur. Tous les visuels sont ici **générés par code** (atlas de textures dessiné procéduralement au chargement), tous les sons sont **synthétisés** par la Web Audio API. Aucune ressource de Mojang n'est utilisée, ni reproduite, ni redistribuée.

## Adresses

| Ressource | Adresse |
|---|---|
| Développement (bac à sable) | `http://localhost:3000` |
| Auto-test des entrées | `/?selftest=1` — résultats en console et dans `window.VCSELFTEST` |
| Production Cloudflare Pages | *non déployé* |

## Architecture technique

### Pile

Hono (routage) · Vite (build) · Cloudflare Pages (cible de déploiement) · WebGL 2 · Web Worker · IndexedDB.

Le serveur ne rend qu'**une seule page** ; toute la simulation se déroule côté client. Aucune donnée ne transite vers le serveur.

### Modules (`public/static/js/`)

| Module | Rôle |
|---|---|
| `blocks.js` | Registre des blocs et objets : identifiants, tables de propriétés (`T_SOLID`, `T_LIQUID`, `T_FILTER`), recettes d'outils |
| `noise.js` | Perlin (formulation de 2002), FBM, *ridged multifractal*, `mulberry32`, `hash3`, FNV-1a |
| `worldgen.js` | Génération : *domain warping* (±60 blocs), splines de continentalité/érosion/*peaks & valleys*, 20 biomes, grottes (*cheese*, *spaghetti*, ravins), 7 familles de minerais |
| `mesher.js` | Maillage par élision de faces, occlusion ambiante par sommet, trois passes (opaque, découpe, translucide) |
| `worker.js` | Fil d'exécution distinct : génération + maillage hors du fil principal, transfert par `postMessage` à propriété transférée |
| `atlas.js` | Atlas de textures dessiné procéduralement (canvas 2D) puis téléversé en GPU avec chaîne de mipmaps |
| `renderer.js` | WebGL 2 : VAO, écrêtage par volume de vue (Gribb–Hartmann), brouillard, cycle jour/nuit |
| `physics.js` | AABB balayée, résolution séparée par axe, franchissement de marche, lancer de rayon DDA (Amanatides & Woo) |
| `world.js` | Gestion des chunks, propagation de lumière par parcours en largeur, persistance IndexedDB |
| `entities.js` | Créatures, objets au sol, particules en *structure de tableaux* |
| `crafting.js` | Grilles d'artisanat 2×2 et 3×3, four, coffres |
| `audio.js` | Synthèse sonore (Web Audio API), aucun fichier audio |
| `ui.js` | Inventaire, glisser-déposer, panneaux |
| `game.js` | Boucle logique à pas fixe (20 Hz), joueur, interactions, entrées |
| `main.js` | Menus, rendu, ATH, cycle de vie, auto-test |

### Modèle de données

```
Chunk         { blocks: Uint8Array(16·128·16), biomes: Uint8Array(256),
                heights: Uint8Array(256), skyLight, blockLight }
Sommet        pos(3) · uv(2) · lgt(3 : ciel, bloc, occlusion) · tnt(3 : teinte)
Sauvegarde    { id, name, seed, savedAt, player, stats, edits: Map }
```

- **Stockage** : **IndexedDB** (côté client). Seules les **modifications** du joueur sont enregistrées, non le terrain : celui-ci est reconstruit à l'identique depuis la graine, la génération étant purement déterministe. Une partie occupe donc quelques kilo-octets au lieu de plusieurs mégaoctets.
- Aucun service Cloudflare (D1, KV, R2) n'est requis : l'application est entièrement statique.

## Guide d'utilisation

### Commandes

| Touche | Effet |
|---|---|
| **Z Q S D** / **W A S D** / flèches | Se déplacer |
| **Espace** | Sauter · double appui en créatif : voler |
| **Maj gauche** | S'accroupir · descendre en vol |
| **Ctrl gauche** | Courir |
| **Clic gauche** | Miner · attaquer |
| **Clic droit** | Poser · utiliser |
| **Clic molette** | Prélever le bloc visé |
| **Molette** / **1–9** | Choisir l'emplacement actif |
| **E** | Inventaire · **Q** : jeter · **T** : changer de mode |
| **F3** | Informations de débogage · **Échap** : pause |

### Souris — deux régimes

1. **Verrou du pointeur** (nominal) : cliquez sur la vue ; la souris est capturée et la caméra suit son mouvement librement.
2. **Repli** : si le navigateur refuse le verrou — page dans un cadre `<iframe>` sans `allow="pointer-lock"`, ou permission bloquée —, **maintenez le clic gauche** pour orienter la vue. Un message le signale en jeu. Le déplacement au clavier fonctionne dans les deux régimes.

## Fonctionnalités réalisées

- Génération procédurale déterministe : 20 biomes, grottes, ravins, minerais stratifiés, arbres et végétation
- Maillage par élision de faces avec occlusion ambiante ; trois passes de rendu ordonnées
- Éclairage voxel (ciel et blocs) par parcours en largeur, avec atténuation dans l'eau
- Physique AABB, franchissement de marche, nage, dégâts de chute, noyade, faim et régénération
- Minage avec vitesses dépendant de l'outil, butin, expérience
- Artisanat 2×2 et 3×3, four à combustion, coffres
- Créatures avec recherche de chemin élémentaire, cycle jour/nuit, apparition nocturne
- Sauvegarde et chargement multi-mondes (IndexedDB), modes survie et créatif
- Sons entièrement synthétisés ; interface complète (menus, inventaire, ATH, écran de mort)

## Limites connues

- **Redstone**, portails et dimensions alternatives : non implémentés
- **Multijoueur** : hors de portée de la cible Cloudflare Pages (pas de serveur persistant ni de WebSocket)
- Le rendu logiciel (absence d'accélération matérielle) reste jouable mais peu fluide
- Recherche de chemin des créatures volontairement rudimentaire

## Pistes de développement

1. Maillage à *faces fusionnées* (*greedy meshing*) pour réduire le nombre de sommets
2. Éclairage incrémental : ne recalculer que le voisinage modifié
3. Simulation d'écoulement des fluides
4. Circuits logiques (redstone)
5. Sauvegarde de la position des créatures

## Vérification

```bash
npm run build            # compilation Vite
node tests/engine.test.cjs   # 175 assertions : bruit, génération, maillage,
                             # lumière, physique, artisanat, contrat DOM
```

Ouvrir `/?selftest=1` exécute en outre **18 assertions d'entrées dans le navigateur réel** : registre de touches, progression du joueur, exécution effective de `tick()`, rotation de la caméra (avec et sans verrou), bornage du tangage, absence de mise en pause abusive, relâchement des touches à la perte de focus.

Le banc d'essai **calibre la machine hôte** (régimes arithmétique et mémoire) avant d'appliquer ses budgets temporels : un bac à sable lent ne produit donc pas de faux échec.

## Déploiement

- **Plateforme** : Cloudflare Pages
- **État** : local (PM2 + `wrangler pages dev`) — non publié
- **Pile** : Hono · Vite · WebGL 2 · IndexedDB · aucune dépendance d'exécution
- **Dernière mise à jour** : 13 août 2026
</content>
</invoke>
