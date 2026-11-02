# Chef de groupe

Simulateur de gestion opérationnelle et de commandement pour sapeurs-pompiers. Le joueur arrive sur l'intervention, lit le feu, fait ses reconnaissances par ses binômes, commande ses chefs d'agrès et rend compte (message d'ambiance, comptes rendus), pendant que le feu évolue selon ses décisions.

Le jeu tourne entièrement dans le navigateur : rien à installer, ce qui permet de l'utiliser sur les portables de caserne. Il est conçu pour une diffusion gratuite entre collègues.

**Jouer :** https://batex23.github.io/chef-de-groupe/

## Ce qui existe aujourd'hui

- Scénario « Feu d'appartement R+3 », Mérignac, de nuit : 1 FPT, 1 PA 18, 1 VSAV et le chef de groupe (doctrine de référence SDIS 33).
- Moteur feu en temps réel, calculé pièce par pièce : couche de fumée, température, O₂ et CO, embrasement, bris des vitrages, effet de l'eau, dose toxique des victimes. Il est calé sur des calculs FDS (voir `fds/`).
- Scène 3D : bâtiments construits avec un kit de façade (murs épais, fenêtres en creux, volets, balcons), vue en coupe du niveau sinistré qui se dévoile au fil des reconnaissances, fumées et flammes pilotées par le moteur.
- Ordres par clic sur les engins et les binômes, témoins qui arrivent au fil de l'intervention, SITAC en temps réel, message d'ambiance chronométré (5 min) et corrigé, débriefing.

## Lancer en local

```bash
python3 -m http.server 8000
# puis ouvrir http://localhost:8000
```

Il faut passer par un petit serveur : les modules JavaScript ne se chargent pas en ouvrant directement le fichier.

## Organisation du code

```
index.html              page unique (accueil, jeu, écrans)
src/core/sim.js         moteur feu par zones (sans dépendance, réutilisable côté serveur)
src/core/game.js        logique d'intervention : engins, binômes, victimes, témoins, messages, évaluation
src/render/scene.js     scène 3D (Three.js r169) : caméra, lumières, engins, personnages, fumées
src/render/building.js  kit de façade modulaire
src/render/materials.js matériaux procéduraux (enduit, béton, pierre, brique, enrobé…)
src/ui/app.js           interface : HUD, menus d'ordres, témoins, messages, SITAC, débriefing
src/ui/style.css        styles de l'interface
assets/                 modèles 3D et textures photo à venir (voir les README)
apps-script/            page Google Apps Script qui ouvre le jeu
fds/                    générateur des cas FDS de calibrage
docs/ARCHITECTURE.md    architecture, calibrage, multijoueur
```

## Hébergement

- **GitHub Pages** sert le jeu (Settings, Pages, branche `main`, dossier racine).
- **Google Apps Script** : `apps-script/` contient une page qui affiche le jeu en plein écran depuis une adresse Apps Script (voir `apps-script/README.md`).
- **Modèles et textures lourds** : déposés dans `assets/`, ils sont servis gratuitement par jsDelivr à partir de ce dépôt.

## Droits sur les contenus

Tous les contenus 3D ajoutés doivent être sous licence CC0 ou CC-BY, ou achetés avec une licence d'utilisation dans un jeu. Chaque ajout est déclaré dans `assets/CREDITS.md`. Ne pas reprendre de modèles extraits d'autres jeux (mods Emergency, GTA, Euro Truck…), même s'ils circulent gratuitement.
