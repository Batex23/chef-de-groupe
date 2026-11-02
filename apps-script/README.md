# Publier le jeu par Google Apps Script

1. Va sur https://script.google.com et crée un **Nouveau projet**.
2. Remplace le contenu de `Code.gs` par celui de `apps-script/Code.gs`.
3. Ajoute un fichier HTML nommé exactement `Index` (menu +, HTML) et colles-y le contenu de `apps-script/Index.html`.
4. Déployer, puis Nouveau déploiement, type **Application Web** :
   - Exécuter en tant que : moi
   - Accès : tout le monde (ou tout le monde dans ton domaine Google, si tu en as un)
5. L'adresse fournie (`https://script.google.com/macros/s/.../exec`) ouvre le jeu.

Le jeu lui-même reste servi par GitHub Pages. Chaque mise à jour du dépôt est donc visible tout de suite, sans redéployer Apps Script.

**À vérifier avec la DSI du SDIS** : les postes doivent pouvoir joindre `script.google.com`, `batex23.github.io` et `cdn.jsdelivr.net` (bibliothèque 3D).
