# Calibrage FDS

`gen_fds.py` génère les cas FDS qui servent à caler le moteur feu du jeu : un appartement T4 au R+3, la cage d'escalier du RDC au R+4 et l'extérieur devant la façade.

```bash
python3 gen_fds.py sortie            # version complète : 3 maillages, 30 min simulées
python3 gen_fds.py sortie rapide     # version rapide : 5 maillages, 20 min simulées
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

Fichiers à récupérer pour chaque cas : `<CHID>_devc.csv`, `<CHID>_hrr.csv`, `<CHID>.out`. Ils se rangent dans `fds/resultats/<CHID>/`.

`check_fds.py` attend une copie des sources de FDS (https://github.com/firemodels/fds) : adapter les chemins en tête du script.
