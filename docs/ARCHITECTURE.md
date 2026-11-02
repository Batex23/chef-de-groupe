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

## Multijoueur (étape suivante)

L'hébergement reste statique (GitHub Pages ou Apps Script). La synchronisation passe par **Firebase Realtime Database**, gratuite jusqu'à 100 connexions simultanées.

- **Hôte qui fait foi** : le navigateur du formateur fait tourner `sim.js` et `game.js`. Il publie un état résumé 2 fois par seconde : positions des binômes, état du feu par pièce, ouvertures, victimes, messages.
- **Clients** : ils envoient leurs ordres, questions et messages comme des événements horodatés. L'hôte les applique et les diffuse.
- **Rôles et ce que voit chacun** :
  - **chef d'agrès** : ses binômes et son engin, ses établissements ;
  - **chef de groupe** : comme aujourd'hui ;
  - **chef de colonne** : SITAC de colonne, OCT, activation du PC ;
  - **officier renseignements** : tableau des messages, SITAC ;
  - **officier moyens** : point de transit, suivi des engins ;
  - **chef de site**.
  Le formateur joue le CODIS et injecte les événements.
- **Radio** : canaux définis par l'OCT. Un message n'est reçu que par les postes à l'écoute de son canal.

Comme `sim.js` est en JavaScript pur, la même simulation pourra plus tard tourner sur un petit serveur si nécessaire, sans réécriture.

## Modèles 3D

Les engins et les personnages sont aujourd'hui construits par le code. Ils seront remplacés par des modèles glTF déposés dans `assets/models/`, selon les critères de `assets/models/README.md`. Le code garde les éléments animés à part : gyrophares, bras d'échelle, portes de coffres.
