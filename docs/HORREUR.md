# L'ARÈNE ÉTEINTE — mode horreur autonome de VOXELCRAFT

*Prototype WebGL 2 jouable à `/horreur/` — 100 % procédural, zéro asset externe,
zéro dépendance d'exécution. Hommage original à la mythologie de la tour de
Lavanville, sans aucun contenu sous droit.*

---

## 1. Le jeu (GDD synthétique)

**Vous êtes l'expert en sceaux.** En 1996, la Ligue a condamné la Maison des
Arènes après l'affaire de Lavanville : huit salles, huit badges, un maître —
quatre-vingt-onze victoires. Ils ont scellé la crypte avec un pensionnaire de
trop. La tour est éteinte depuis. Elle attend un déscelleur.

### Structure — une tour octogonale de 7 niveaux

| Niveau | Nom | Épreuve | Gardien |
|---|---|---|---|
| Crypte (y 16) | La Dalle de Chair | Boss final | **L'Enterré-Vivant** |
| Grand hall (y 24) | Salle des Huit | Tutoriel : sceaux, torches, cachettes | — |
| Arène I (y 32) | La Main | S'exposer le moins possible | **La Main Blanche** (faisceau) |
| Arène II (y 40) | L'Autel d'Os | Tenir l'autel 4 s sous la dent | **Le Garde d'Os** |
| Arène III (y 48) | Le Souffle | Rallumer 4 bougies | **Le Souffle** + son Ombre |
| Arène IV (y 56) | La Nuit | Obscurité + 4 bougies + faisceau | **La Main** (variante rapide) |
| Toiture (y 64) | Le Ciel | Remontée finale | L'aube |

### Boucle de jeu

1. Chaque plateau d'arène = une **épreuve** ; réussite = **badge** (4 losanges du HUD).
2. Un badge **dissout le SCEAU** de la poche d'escalier suivante (goulotte lumineuse
   qui devient un trou dans la dalle — une morsure dans la pierre).
3. 4 badges → la **crypte** s'ouvre : boss, puis remontée de la tour **sceaux
   refermés derrière vous** (le boss re-scelle chaque niveau traversé).
4. Toiture : aube progressive → **fin bonne**. Mourir dans la crypte → **fin mauvaise**.

### Les créatures (originales, hommage assumé)

- **La Main Blanche** — main gigantesque suspendue, tueuse au faisceau : elle
  n'attaque que si vous **restez dans son halo**. Jauge d'exposition (HUD).
- **Le Garde d'Os** — humanoïde osseux qui patrouille autour de l'autel ; il
  interrompt l'épreuve dès qu'il voit (cône de vue) ou entend (pas, sprint).
- **Le Souffle et son Ombre** — voile noir imitatif : prend la forme de votre
  silhouette à distance, inhale avant de fondre sur vous.
- **L'Enterré-Vivant** — boss de crypte : géant d'os dressé de la dalle de chair,
  rugissement d'ouverture, re-scelle la tour à votre passage.

### Systèmes d'horreur

- **Haine par la lumière** : la torche frontale rassure mais révèle votre position ;
  l'éteindre (**F**) vous rend quasi invisible… dans le noir total.
- **PEUR** : jauge montante (obscurité, proximité, rugissements) — désature l'image,
  accélère le cœur (audio), pousse l'aberration chromatique.
- **Cachettes** : rideaux du hall, alcôves des arènes — 5 s hors de la ligne de vue.
- **Bruit** : sprinter émet du bruit que les gardiens entendent à travers les murs.

---

## 2. Techniques d'ingénierie

Tout est écrit pour ce mode, dans `public/horreur/js/` (9 modules ES5 en IIFE
publiant des globaux `H*`, cohérents avec les conventions du repo) :

| Module | Rôle |
|---|---|
| `hnoise.js` | PRNG mulberry32, FNV-1a, Perlin 3D (2002), FBM |
| `hworld.js` | Génération déterministe de la tour : 7 niveaux, 24 types de blocs, poches d'escalier, sceaux, extérieur |
| `hmesh.js` | Maillage chunk 16×8×16, élision de faces, AO par sommet, flip de diagonale |
| `hcollide.js` | Collision « moteur dédié » (détail ci-dessous) |
| `hrender.js` | Rendu WebGL 2 (3 programmes), atlas procédural, post-traitement |
| `hent.js` | IA des créatures (FSM lurk/hunt/chase/lunge), joueur, peur |
| `haudio.js` | Synthèse Web Audio procédurale (nappe, vent, cœur, événements) |
| `hstory.js` | Phases, cinématiques caméra A→B, journal, épreuves, fins |
| `hmain.js` | Boucle rAF à pas fixe, entrées ZQSD (AZERTY auto), pointer-lock, HUD |

### Le système de collision « fluidité parfaite » (`hcollide.js`)

Cinq techniques combinées, documentées en tête du module :

1. **Ordre des axes adaptatif** — l'axe à plus grande vitesse est résolu en
   premier, puis vertical, puis l'axe le plus lent : les « coins qui accrochent »
   à grande vitesse disparaissent.
2. **Early-out par chunk** — compteurs de solides précalculés par chunk 16×8×16 :
   les chunks vides coûtent zéro accès à la grille de blocs.
3. **Cache de cohérence temporelle** — les corps mémorisent leur cellule ;
   le balayage AABB ne relit que les blocs changeants.
4. **Sous-pas anti-tunneling bornés** — quand |v|·dt > 0.12 bloc, le mouvement est
   découpé (1 à 8 sous-pas) : un corps à 50 m/s s'arrête sur une dalle d'un bloc
   (vérifié par `tests/horror.test.cjs`).
5. **Step-assist** — corps au sol + mur d'un bloc + espace libre au-dessus ⇒ hisse
   d'un cran et rejoue le mouvement résiduel : les marches se montent **sans saut
   et sans blocage** (testé : la rampe crypte→hall se grimpe du premier coup).

### Rendu « réaliste » sans asset

- **Atlas de textures 100 % procédural** : canvas 2D 6×6 tiles dessiné au boot
  (pierre fissurée, mousse, chair, os, fresques…) — aucune image externe.
- **14 lampes dynamiques** par fragment (les plus proches triées à 4 Hz), flicker
  par bruit, torche frontale en cône doux, brume exponentielle.
- **Post-traitement** via FBO intermédiaire : vignette, grain de pellicule,
  aberration chromatique asservie à la PEUR, désaturation, teinte de dégâts.
- **AO par sommet** + flip de diagonale du quad selon la courbure d'occlusion.

### Performance « sur tout matériel »

- Pas fixe **120 Hz** physique (accumulateur) découplé du rendu : 60, 144 ou
  30 Hz d'écran ⇒ physique identique.
- Culling des chunks par distance (60 m), file de chunks dirty à budget par frame.
- Sous-pas de physique bornés (max 8) : pire frame bornée, pas de « spirale de la
  mort » à basse fréquence de rendu.

---

## 3. Note de recherche : la lore Pokémon qui a inspiré le mode

Recherche internet menée en amont de l'écriture (faits publics) :

- **Lavender Town (Lavanville)** — la tour Pokémon de Kanto, cimetière in-game
  dont la bande-son (tonalités hautes) a nourri la légende urbaine dite
  « *Lavender Town Syndrome* » (prétendus malaises chez de jeunes joueurs au
  Japon, 1996) : mythe jamais attesté académiquement, mais fondateur de
  l'horreur Pokémon.
- **Buried Alive** — dans les données de débogage de *Pokémon Rouge/Bleu*, un
  entraîneur scripté « *Buried Alive* » (sprite « Buryman ») devait figurer au
  sommet de la tour de Lavanville avec, à son combat final, un texte de
  dévorement. Script incomplet laissé dans la ROM, devenu légende.
- **White Hand** — image « WhitHand.gif » propagée dans les creepypastas de
  Lavanville (main blanche grimpant des tombes) : pure fiction d'internet.
- **Marowak / Cubone** — la seule horreur canonique : la mère Cubone tuée par la
  Team Rocket, dont le fantôme hante la tour et que le jeune Cubone, masqué
  d'os, pleure.

**Décision de conception** : plutôt que de reproduire ces éléments (propriété de
Nintendo / Game Freak / Creatures Inc.), le mode les **transforme en créatures
originales** : la Main Blanche (≠ White Hand), le Garde d'Os (≠ Marowak), le
Souffle (≠ Ghost), l'Enterré-Vivant (≠ Buried Alive). Aucun nom, sprite, texte
ni son de la franchise n'est réutilisé ; ce qui est gardé, c'est la stratégie
narrative — la tour interdite, ses arènes, « un pensionnaire de trop » scellé.

---

## 4. Vérification

```bash
node tests/horror.test.cjs    # 17 assertions : génération, rampes, sceaux,
                              # anti-tunneling, repos, step-assist, raycast, maillage
node tests/horror.smoke.cjs   # smoke-test d'intégration : boot→menu→intro→play
                              # (WebGL2/DOM/Audio émulés, horloge factice)
npm run build                 # dist/horreur/ copié
```

Ouvrir `/horreur/` sur la page déployée (ou `npx vite preview`, puis
http://localhost:5173/horreur/). Contrôles : **ZQSD/WASD** (auto), souris,
**E** interagir (bougie, autel, sceau, cachette), **F** torche frontale,
**J** journal, **Maj** courir, **Échap** pause.

Un vrai test navigateur (Playwright + Chromium headless) a été préparé mais
l'environnement de ce bac à sable n'installe pas les bibliothèques système
Chromium (`libglib-2.0.so.0`, pas de droits root) — le smoke-test émulé ci-dessus
couvre la même surface logique (boot, états, clavier, sceaux, simulation).

## 5. Frontière légale

`L'ARÈNE ÉTEINTE` est un jeu **original** : noms, créatures, textes, musiques et
textures sont créés pour ce projet. Il s'affiche comme un hommage à la mythologie
d'horreur apparue autour de Pokémon, et non comme une œuvre dérivée.
