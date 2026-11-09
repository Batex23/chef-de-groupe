# Feu de forêt : multijoueur

## Les rôles

| Rôle | Ce qu'il voit | Ce qu'il fait |
|---|---|---|
| **Chef de groupe** (crée la partie) | Le jeu complet, comme en solo | Son ordinateur fait tourner la simulation. Ses ordres aux UIFF tenues par un joueur sont **transmis**, pas exécutés. |
| **Chef d'agrès UIFF** | Sa zone autour de son engin, la DIR 654 | Reçoit l'ordre (bouton « Exécuter ») ou agit de sa propre initiative. Rend compte à la radio (voix ou clavier). Reçoit en privé les « situations » (eau, craste, détresse) : c'est à lui de les transmettre. |
| **Formateur** | Tout : le feu entier, les tracés ZI du chef de groupe, toutes les radios, l'évaluation en direct | Parle en CODIS, en pilote, en engin non tenu. Injecte une détresse, une saute de feu, un changement de vent. Règle le rythme. Termine l'exercice. |

Les UIFF sans joueur restent automatiques. Si un chef d'agrès se déconnecte, son engin repasse en automatique.

## Jouer sur un seul poste

Choisir **Réseau : Ce poste (plusieurs fenêtres)**. Ouvrir le jeu dans plusieurs fenêtres du même navigateur, par exemple sur deux écrans. Rien à configurer.

## Jouer sur plusieurs postes (caserne) : créer la base une fois (10 minutes, gratuit)

1. Aller sur https://console.firebase.google.com avec un compte Google, puis **Créer un projet** (par exemple `fdf-salles`). Google Analytics n'est pas utile.
2. Dans le menu **Créer**, ouvrir **Realtime Database**, puis **Créer une base de données**. Choisir l'emplacement **Belgique (europe-west1)**, puis **Démarrer en mode verrouillé**.
3. Dans l'onglet **Règles**, coller le texte suivant, puis **Publier** :
   ```json
   {
     "rules": {
       ".read": false,
       ".write": false,
       "fdf": { "$partie": { ".read": true, ".write": true } }
     }
   }
   ```
4. Copier l'adresse affichée en haut de l'onglet **Données**, du type `https://fdf-salles-default-rtdb.europe-west1.firebasedatabase.app`.
5. Pour que personne n'ait à la saisir, la coller dans `src/fdf/reseau-config.js` (`databaseURL: '…'`). Sinon, la coller sur l'écran d'accueil : le lien **Inviter** la transmet aux autres joueurs.

Consommation : environ 15 Mo par heure et par joueur. La formule gratuite (Spark) couvre largement un usage de formation.

Les parties restent stockées sous `fdf/<code>`. On peut les effacer depuis l'onglet **Données** de la console.

## Déroulement

1. Le chef de groupe règle niveau, vent et lieu, ouvre **Multijoueur**, saisit son nom et clique sur **Créer une partie**. Le code (4 caractères) s'affiche en haut ; **Inviter** copie le lien.
2. Les chefs d'agrès et le formateur ouvrent le lien (ou saisissent le code), choisissent leur rôle et cliquent sur **Rejoindre**. Chaque chef d'agrès prend automatiquement une UIFF libre ; il peut en changer.
3. Le chef de groupe garde l'onglet du jeu au premier plan : s'il passe sur un autre onglet, la simulation se met en pause pour tout le monde.
