# Feu de forêt FDF3 (Salles, Gironde)

Page de jeu : `fdf.html`. Code : `src/fdf/` (feu.js propagation, carte.js carte et itinéraires, jeu.js phases et commandement).

## Carte (`data/fdf/salles/`)
- Emprise Lambert-93 381 000 – 393 600 / 6 382 000 – 6 392 800 (12,6 × 10,8 km), grille 10 m.
- Peuplements : BD Forêt V2 (essences) et hauteur LiDAR HD (âge des pins : < 2,5 m semis, < 7 m 5-10 ans, < 13 m 10-20 ans, < 20 m 20-40 ans, au-delà + 40 ans).
- Routes et pistes BD TOPO ; pistes DFCI du cartoguide relevées sur les captures recalées (`carte/pistes_dfci_cartoguide.json`).
- Carroyage DFCI du cartoguide SDIS 33 : carrés de 400 m, origine Lambert-93 (317 977 ; 6 135 925), recalé sur les captures (écart < 30 m).
- Points d'eau du cartoguide : `carte/points_eau_cartoguide.json` (numéro, forme, position). À compléter : pérennité, moyen d'activation.
- Régénérer : `python3 carte/telecharge_ign.py <dir>`, `python3 carte/telecharge_raster.py <dir>`, `python3 carte/prepare.py <dir> ../data/fdf/salles`.

## Propagation (`src/fdf/feu.js`)
Rothermel (modèles Anderson / Scott & Burgan) par peuplement. Le facteur de calage `k` ramène la vitesse de tête à la règle du mémento (vent m/s × 100 = m/h) à 7 m/s en sécheresse forte (`node calage.js`).
Forme elliptique (Anderson 1983), pente, passage en cimes (Van Wagner), sautes, intensité de Byram en kW/m.
Essai : `node test_feu.js 7 225 60`.
