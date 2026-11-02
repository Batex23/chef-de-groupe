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

Fichiers à récupérer pour chaque cas : `<CHID>_devc.csv`, `<CHID>_hrr.csv`, `<CHID>.out`. Ils se rangent dans `fds/resultats/<CHID>/`.

`check_fds.py` attend une copie des sources de FDS (https://github.com/firemodels/fds) : adapter les chemins en tête du script.
