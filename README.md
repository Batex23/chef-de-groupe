# Chef de groupe

Simulateur de gestion opérationnelle et de commandement pour sapeurs-pompiers. Le joueur arrive sur l'intervention, lit le feu, fait ses reconnaissances par ses binômes, commande ses chefs d'agrès et rend compte (message d'ambiance, comptes rendus), pendant que le feu évolue selon ses décisions.

Le jeu tourne entièrement dans le navigateur : rien à installer, ce qui permet de l'utiliser sur les portables de caserne. Il est conçu pour une diffusion gratuite entre collègues.

**Jouer :** https://batex23.github.io/chef-de-groupe/

## Ce qui existe aujourd'hui

- Scénario « Feu d'appartement R+3 », Mérignac, de nuit : 1 FPT, 1 PA 18, 1 VSAV et le chef de groupe (doctrine de référence SDIS 33).
- Moteur feu en temps réel, calculé pièce par pièce : couche de fumée, température, O₂ et CO, embrasement, bris des vitrages, effet de l'eau, dose toxique des victimes. Il est calé sur des calculs FDS (voir `fds/`).
- Scène 3D : bâtiments construits avec un kit de façade (murs épais, fenêtres en creux, volets, balcons), vue en coupe du niveau sinistré qui se dévoile au fil des reconnaissances, fumées et flammes pilotées par le moteur.
- Intervention découpée en phases selon l'algorithme du GOC : arrivée et réactions immédiates, raisonnement tactique, conduite.
- Raisonnement tactique guidé (SAOIECL). L'ordre initial distribue les missions aux engins, puis il est corrigé et comparé à un ordre type.
- SITAC dessinée par le joueur avec les symboles conventionnels (feu, fumées, victimes, dangers, attaque, sauvetage, reconnaissance, établissements, moyens), superposée aux renseignements et évaluée au débriefing.
- Rythme très lent par défaut (temps divisé par 4) pour laisser le temps du raisonnement. Lent, réel ou rapide au choix, par exemple pendant les attentes.
- L'intervention ne s'arrête pas quand les flammes tombent. Après l'attaque, il reste des foyers résiduels sous les débris : sans déblai, ils reprennent quelques minutes plus tard. Le feu passe par les états réglementaires : circonscrit, maîtrisé (flammes abattues), éteint (déblai fait et contrôle à la caméra thermique sans point chaud).
- Reconnaissance à la caméra thermique : elle localise le foyer à travers les fumées, repère les victimes et surtout les points chauds cachés (cloisons, doublages, faux plafonds) que le déblai à l'œil ne trouve pas. Un point chaud caché non détecté finit par percer et reprendre 20 à 25 min plus tard.
- Commandement par les chefs d'agrès : l'ordre part au CA sur la DIR 614 (missions de ses binômes et consignes de sécurité), le CA collationne puis répartit. Il signale l'absence de binôme de sécurité.
- Tableau de suivi des engagements (contrôle ARI) : pression, temps sous ARI, heure de sortie prévue et dernier compte rendu de chaque binôme. Les comptes rendus s'affichent aussi en bulle au-dessus des binômes.
- Incidents de sécurité aléatoires : malaise, défaillance d'ARI, binôme désorienté. Message de détresse sur la DIR 654, marche à suivre affichée, sauvetage par le binôme de sécurité, message urgent au CODIS, évaluation au débriefing.
- Radio par canaux SDIS 33 (groupement Centre) : DIR 614 tactique, GRP 269 opérationnel, GRP 275 commandement pour les comptes rendus du COS, DIR 654 sécurité ARI. Tableau des messages filtrable par canal.
- Engins placés par défaut et déplaçables : point de transit, façade, aval. L'échelle hors de portée ne peut plus manœuvrer, un engin au point de transit allonge la marche d'approche et le brancardage.
- Victimes : bilan du VSAV, demande de SMUR, évacuation (le VSAV quitte les lieux), sans alourdir l'intervention. Une recherche à tâtons dans une fumée opaque peut passer à côté d'une victime.
- Propagation par la façade : si les flammes sortent trop longtemps par les fenêtres du séjour, le feu gagne l'appartement du R+4. L'échelle peut protéger la façade avec une lance.
- Ventilation opérationnelle : VPP devant la porte d'immeuble, efficace seulement avec un exutoire ouvert. Une ventilation lancée sur un feu non attaqué est sanctionnée.
- Durée réaliste des actions : capelage ARI, établissement dans l'escalier, recherche pièce par pièce, changement de bouteille. Les binômes s'épuisent, la relève se prépare.
- Ordres de conduite par clic sur les engins et les binômes, témoins qui arrivent au fil de l'intervention, message d'ambiance chronométré (5 min) et corrigé, débriefing.

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
