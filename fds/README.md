# Calibrage FDS

`gen_fds.py` génère les cas FDS qui servent à caler le moteur feu du jeu : un appartement T4 au R+3, la cage d'escalier du RDC au R+4 et l'extérieur devant la façade.

```bash
python3 gen_fds.py sortie            # version complète : 3 maillages, 30 min simulées
python3 gen_fds.py sortie rapide     # version rapide : 5 maillages (6 avec VPP), 20 min simulées
python3 check_fds.py 'sortie/*.fds'  # vérifie mots-clés et grandeurs contre les sources de FDS
```

Les scénarios :

| Cas | Situation |
|---|---|
| R0 | référence : porte palière fermée jusqu'à l'arrivée des sapeurs-pompiers |
| R1 | porte palière laissée ouverte par l'occupante (scénario du jeu) |
| R2 | R1 avec ouverture de l'exutoire |
| R3 | vitrages qui tiennent, feu sous-ventilé |
| R4 | attaque à la LDV 500 |
| R5 | porte de la chambre de la victime ouverte |
| R6 | ventilation opérationnelle après l'attaque : VPP devant la porte d'immeuble, exutoire ouvert |
| R7 | ventilation en attaque : VPP et exutoire ouverts juste avant l'attaque |
| R8 | VPP après l'attaque, exutoire fermé (pas d'exutoire pour les fumées) |

Les cas R6 à R8 ajoutent un petit maillage `PARVIS` devant la porte d'immeuble : il faut un processus MPI de plus (6 en version rapide, 4 en version complète). Le VPP est un caisson de 0,8 × 0,8 m posé à 2 m de la porte, qui souffle à 10 m/s ; FDS calcule l'air entraîné autour du cône. La puissance du foyer reste imposée : ces cas mesurent le désenfumage (débits par les ouvertures, visibilité et CO dans la cage et le logement), pas l'activation du feu par l'apport d'air. Pour la ventilation offensive, il faudra plus tard un foyer à pyrolyse calculée.

Fichiers à récupérer pour chaque cas, rangés dans `fds/resultats/<CHID>/` :
- pour le calage : `<CHID>_devc.csv`, `<CHID>_hrr.csv`, `<CHID>.out` ;
- pour la fumée et les conditions 3D dans le jeu : `<CHID>.smv` (description du calcul), tous les `<CHID>_*.q` (volumes Plot3D toutes les 20 s : température, visibilité, CO, O₂, puissance volumique), tous les `<CHID>_*.xyz` (grilles), tous les `<CHID>_*.s3d` et `.s3d.sz` (fumée 3D, comme Smokeview).

Ordre de grandeur : environ 1,3 Mo par instant Plot3D, soit 75 à 115 Mo de `.q` par cas, plus la fumée 3D. Un dossier partagé (Google Drive) est plus pratique qu'une pièce jointe.

`check_fds.py` attend une copie des sources de FDS (https://github.com/firemodels/fds) : adapter les chemins en tête du script.

## Lancer plus vite

Chaque cas a plusieurs maillages : 3 en version complète, 5 en version rapide, un de plus avec le VPP. FDS peut calculer un maillage par cœur du processeur. Lancé avec un seul processus, R0 a duré 8 h 36 min. Dans l'invite de commandes de FDS (CMDfds) :

```
fds_local -p 3 R1_PORTE_PALIERE_OUVERTE.fds
```

`-p 3` pour la version complète, `-p 5` pour la rapide (6 pour R6 à R8), si l'ordinateur a au moins autant de cœurs. Le calcul va alors 2 à 4 fois plus vite.

## Calage du moteur du jeu

```bash
node calibrage/jeu_r0.js R0_BASE resultats/R0_BASE/R0_BASE_hrr_10s.csv jeu.csv     # moteur du jeu, mêmes conditions, même puissance
python3 calibrage/compare.py resultats/R0_BASE/R0_BASE_devc_5s.csv jeu.csv figure.png  # écarts et graphique
node calibrage/cale.js resultats/R0_BASE/R0_BASE_devc_5s.csv resultats/R0_BASE/R0_BASE_hrr_10s.csv 1500  # recherche des paramètres
```

**R0_BASE (version complète, 1800 s, FDS 6.7.6)** : moteur calé le 2 novembre 2026. Écarts moyens après calage :

| Grandeur | Avant calage | Après calage |
|---|---|---|
| Couloir, couche haute | +118 °C | 16 °C |
| Chambre 2, couche haute | +44 °C | 13 °C |
| Séjour, couche haute | +126 °C | 50 °C (le jeu est un peu plus froid) |
| Séjour, hauteur de couche | +0,7 m | 0,4 m |
| Cage au R+3, température | 28 °C | 12 °C |
| CO dans la cage au R+4 | 690 ppm | 305 ppm |

Paramètres retenus :

| Paramètre | Valeur | Rôle |
|---|---|---|
| `radLoss` | 0,30 | pertes par rayonnement |
| `hConv` | 0,019 | échanges avec les parois |
| `wallC` | 112 | inertie des parois |
| `entK` | 1,85 | entraînement d'air du panache |
| `Cd` | 0,65 | coefficient des ouvertures |
| `leakK` | 0,43 | fuites des portes fermées |
| `glassBreakK` | 462 K | bris des vitrages (189 °C de couche haute moyenne, l'équivalent de vos 400 °C au droit de la fenêtre) |

**Vérification sur R1_PORTE_PALIERE_OUVERTE** (version rapide, 1200 s) : sans changer aucun réglage, le moteur calé sur R0 reproduit R1. Écarts moyens :
- couloir : 16 °C ;
- chambre 2 : 10 °C ;
- cage au R+3 : 12 °C ;
- CO dans la cage au R+3 : 144 ppm.

Une recherche commune sur R0 et R1 ne trouve pas mieux : le calage est conservé.

**Limites connues**
- Cage d'escalier : dans R1, FDS amène des fumées jusqu'au R+2 (CO jusqu'à 400 ppm), le jeu non ; et le R+4 est trop froid de 24 °C dans le jeu. Il faut découper la cage par niveau.
- La cage d'escalier reste un seul volume : la température y tombe d'un coup quand la couche remonte, là où FDS décroît en douceur. Le découpage par niveau est prévu.
- La puissance du canapé est imposée dans FDS : l'embrasement des autres meubles se cale à part. Dans le jeu, il est déclenché quand la puissance dépasse le seuil de Thomas pendant 45 s.
