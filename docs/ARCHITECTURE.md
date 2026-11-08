# Architecture

## Principes

1. **La simulation décide, le rendu montre.** `src/core/sim.js` et `src/core/game.js` ne dépendent ni du navigateur ni de Three.js. Le rendu (`src/render/`) et l'interface (`src/ui/`) lisent l'état du jeu à chaque image sans jamais le modifier. Seuls les ordres, questions et messages passent par l'API `GAME`.
2. **Le joueur ne voit que ce qu'il sait.** La SITAC et la vue en coupe affichent les renseignements obtenus (comptes rendus, témoignages, observations) avec leur heure, pas la vérité du moteur. Seules les façades montrent l'état réel du feu en direct, comme sur le terrain.
3. **Pas d'outil de compilation.** Three.js est chargé depuis jsDelivr par une carte d'imports (`index.html`). Le dépôt se sert tel quel par GitHub Pages ou par n'importe quel serveur de fichiers.

## Moteur feu (`src/core/sim.js`)

Chaque pièce est un volume à deux couches : une couche chaude en haut, une couche d'air frais en bas. Le moteur calcule :

- l'entraînement d'air par le panache, selon la corrélation de Heskestad ;
- les échanges par les ouvertures, entraînés par la différence de masse volumique ;
- la limitation de la combustion par l'oxygène, et les imbrûlés qui brûlent en façade ;
- les pertes de chaleur aux parois ;
- les seuils de bris des vitrages et d'embrasement généralisé (critère de Thomas) ;
- l'abattement des flammes et le refroidissement par l'eau des lances ;
- la dose toxique (FED, ISO 13571) reçue par les victimes.

Les paramètres marqués `[CAL]` sont recalés sur les calculs FDS du dossier `fds/`. Les sorties FDS utilisées sont la hauteur de couche, la température haute et basse, l'O₂, le CO, la dose toxique, la visibilité et les débits aux ouvertures.

La cage d'escalier est pour l'instant un volume unique avec un profil vertical provisoire. Elle sera découpée par niveau une fois les arbres de température FDS disponibles.

## Rendu (`src/render/`)

- **`materials.js`** génère des matériaux PBR complets (couleur, relief, rugosité) à partir de bruit procédural. Il n'y a aucun fichier image, donc aucune question de droits. Des textures photo pourront les remplacer (voir `assets/textures/README.md`).
- **`building.js`** est le kit de façade. Il construit des murs épais avec embrasures, menuiseries, appuis, coffres et volets roulants, balcons et acrotères. Les pièces répétées sont fusionnées par matériau pour limiter les appels de rendu. Ce kit servira l'éditeur de scénarios du mode formateur.
- **`scene.js`** assemble la scène : immeuble du scénario et voisins, R+3 complet avec cloisons, mobilier et brouillard de reconnaissance, engins, personnages, fumées, flammes et lumières pilotées par le moteur. La vue en coupe utilise un plan de découpe.
- **Qualité « Standard »** : ombres, ombrage de contact (GTAO), halo lumineux (bloom), anticrénelage. **Qualité « Léger »**, pour les portables de caserne : rendu direct, textures en 256 px, moins de particules.

## Plusieurs interventions

Chaque intervention fournit sa logique (`window.GAME`) et sa scène 3D (`window.S3`). L'interface (`src/ui/app.js`) est commune : elle lit les mêmes fonctions (ordres, témoins, messages, ordre initial, SITAC, débriefing) et des crochets facultatifs propres à l'intervention :
- `drawPlanBase` et `PLAN` : fond de SITAC et échelle ;
- `hudWater` et `waterPill` : état de l'eau ;
- `onStart` : début de partie ;
- `debriefTruth` : situation réelle au débriefing ;
- `META` : ticket, textes, vues, moyens de la SITAC.

L'intervention est choisie par l'adresse (`?s=pizzeria`), et `index.html` charge les fichiers correspondants. Le R+3 utilise le moteur à zones (`sim.js`). La pizzeria, feu de grand volume vu de l'extérieur, utilise un modèle plus simple : 9 volumes de 100 m², propagation poussée par le vent, eau appliquée par façade, rayonnement sur les cibles (stock de gaz, HLM, évacués) et hydraulique (citernes, PI limité, aspiration). C'est la base du futur mode formateur : une intervention décrite par des données.

## Multijoueur (en préparation)

Décisions prises avec le formateur référent (novembre 2026) :

- **Jusqu'à 10 joueurs**, réunis dans la même salle de formation ou à distance (chacun dans sa caserne).
- **Une salle par séance** : le formateur (ou le premier joueur) crée la salle et obtient un code ; les autres le saisissent et choisissent leur rôle. Pas de compte.
- **Hôte qui fait foi** : le navigateur de l'hôte fait tourner `sim.js` et `game.js` et publie l'état ; les autres envoient des événements horodatés (ordres, questions, messages). Synchronisation par **Firebase Realtime Database** (offre gratuite).
- **Cloisonnement de l'information** : chaque rôle ne voit que ce que son rôle voit. Le CA tient le suivi de ses binômes ; le CDG ne connaît que les comptes rendus et ses propres observations ; le PC voit la SITAC et le tableau des messages.
- **Rôles** : CA (FPT, PA, VSAV), CDG, CDC, officier renseignements, officier moyens, CDS. Les rôles sans joueur sont tenus par l'ordinateur.
- **CODIS** : joué par le formateur s'il y en a un (il injecte aussi les événements) ; sinon tenu par l'ordinateur.
- **Radio vocale** en alternat, canal par canal (DIR 614, GRP 275, DIR 602…) : on n'entend que les canaux veillés. **Chaque message est enregistré** et réécoutable dans le tableau des messages et au débriefing. Transport : WebRTC quand le réseau le permet, sinon messages enregistrés transmis par la base (quelques secondes de décalage). Les clips audio (Opus, environ 3 Ko/s) sont stockés dans la base de la séance.
- **Débriefing commun** avec chronologie, réécoute des messages radio et SITAC de chaque rôle.
- **SITAC** dessinée par chaque officier avec les six couleurs conventionnelles (noir, rouge, vert, bleu, orange, violet), symboles, traits libres, zones et textes ; une charte graphique et un outil de type Crimson viendront compléter.

Avant le développement, `test-reseau.html` vérifie sur un portable de caserne : accès à Firebase (simple et WebSocket), bibliothèque Firebase, WebRTC (sortie UDP), micro et enregistrement.

Comme `sim.js` est en JavaScript pur, la même simulation pourra plus tard tourner sur un petit serveur si nécessaire, sans réécriture.

## Modèles 3D

Les engins et les personnages sont aujourd'hui construits par le code. Ils seront remplacés par des modèles glTF déposés dans `assets/models/`, selon les critères de `assets/models/README.md`. Le code garde les éléments animés à part : gyrophares, bras d'échelle, portes de coffres.
