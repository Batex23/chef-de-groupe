/**
 * Chef de groupe : point d'entrée Google Apps Script.
 * Affiche le jeu, hébergé sur GitHub Pages, en plein écran.
 * Déploiement : Déployer > Nouveau déploiement > Application Web,
 * « Exécuter en tant que : moi », « Accès : tout le monde ».
 */
var URL_JEU = 'https://batex23.github.io/chef-de-groupe/';

function doGet() {
  var t = HtmlService.createTemplateFromFile('Index');
  t.urlJeu = URL_JEU;
  return t.evaluate()
    .setTitle('Chef de groupe')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
