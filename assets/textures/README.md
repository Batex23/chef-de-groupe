# Textures photo (optionnel)

Les matériaux sont aujourd'hui générés par le code (`src/render/materials.js`). Pour gagner encore en réalisme, on peut les remplacer par des textures photo libres de droits :

- Poly Haven : https://polyhaven.com/textures (CC0)
- ambientCG : https://ambientcg.com (CC0)

Pour chaque matériau, prendre la version **1K** (1024 px) au format JPG : couleur (`_diff` ou `_Color`), relief (`_nor_gl` ou `_NormalGL`), rugosité (`_rough` ou `_Roughness`). Les ranger ainsi :

```
assets/textures/enduit/couleur.jpg
assets/textures/enduit/relief.jpg
assets/textures/enduit/rugosite.jpg
```

Matériaux utiles : enduit (plaster), béton (concrete), pierre de soubassement, brique, enrobé (asphalt), pavés de trottoir, gravillons de toiture, parquet, carrelage.
