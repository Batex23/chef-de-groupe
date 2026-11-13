// =============================================================================
// Lecture des messages passes a la voix ou en texte libre. S'appuie sur NLU
// (nombres en lettres, sigles epeles, fautes de dictee, noms propres flous).
// Renvoie une structure, sans effet sur le jeu :
//  - reseau : demande de reseau (« CODIS de COS Salles pour message d'ambiance »)
//  - type : arrivee / ambiance / cr / eteint / vois / libre
//  - rubriques des messages du memento FDF (commune, lieu-dit, nature, surface,
//    front, situation, difficultes, surface menacee, moyens, autorites, point
//    d'engagement, point d'eau, phase, cause, origine, surveillance)
//  - question : renforts / meteo / heure / repetez / aerien ; annulation, liberation
//  - ordres aux UIFF (« UIFF 2 attaque flanc gauche »)
// =============================================================================
(function () {
  'use strict';
  const N = typeof module !== 'undefined' ? require('./nlu.js') : window.NLU;
  const NATO = { alpha: 'A', alfa: 'A', bravo: 'B', charlie: 'C', delta: 'D', echo: 'E', foxtrot: 'F', golf: 'G', hotel: 'H', india: 'I', juliet: 'J', juliett: 'J', juliette: 'J', kilo: 'K', lima: 'L', mike: 'M', november: 'N', oscar: 'O', papa: 'P', quebec: 'Q', romeo: 'R', sierra: 'S', tango: 'T', uniform: 'U', victor: 'V', whisky: 'W', whiskey: 'W', xray: 'X', 'x-ray': 'X', yankee: 'Y', zulu: 'Z', zoulou: 'Z' };
  const CAT = [[/ages divers|age divers|ages varies/, 'Pins d’âges divers'], [/(moins de|inferieurs? a|< ?|- de|-) ?20 ans|jeunes pins|semis/, 'Pins de - 20 ans'], [/(de )?20 (a|-) ?40 ans|entre 20 et 40/, 'Pins de 20 à 40 ans'], [/(plus de|superieurs? a|> ?|\+ de|\+) ?40 ans|vieux pins|vieille futaie/, 'Pins de + 40 ans'],
    [/landes?\b/, 'Landes'], [/broussailles?/, 'Broussailles'], [/taillis|feuillus/, 'Taillis/feuillus'], [/marais/, 'Marais'], [/prairie|bord de route|accotement/, 'Prairie / Bord de route'], [/agricole|culture|chaume|champ de/, 'Espace agricole']];
  const ORIGINES = [[/loisirs?|barbecue|bbq|feu de camp|artifice/, 'Activités de loisirs'], [/ordures|decharge|detritus/, 'Dépôts d\'ordures'], [/agricoles?|ecobuage|pastoral/, 'Feux et travaux agricoles'], [/electri|ligne|transformateur|enedis/, 'Installations électriques'],
    [/megot|incandescent|cigarette|fusee/, 'Jet d\'objet incandescent'], [/pyroman/, 'Pyromanie'], [/train|voie ferree|sncf/, 'Trains'], [/particulier|incineration|debroussaill|tondeuse/, 'Travaux de particulier'],
    [/forestiers?|debardage|abatteuse|broyeur/, 'Travaux forestiers'], [/industriel|publics|chantier/, 'Travaux industriels'], [/vehicule|voiture|pot d echappement|camion/, 'Véhicules routiers'], [/foudre|orage/, 'Foudre']];

  const PARLE = {};
  PARLE.analyse = function (brut, ctx) {
    const t = N.prepare(brut);
    const r = { brut, t, type: 'libre', moyens: [], autorites: [], diff: [] };
    let m;
    // ---- demande de reseau et qualite du message
    const pourMsg = /\bpour (un |1 )?(message|compte rendu|cr\b)/.test(t) || /^(codis|cos|cdg)\b.{0,40}\b(de|ici)\b.{0,40}\bpour\b/.test(t);
    if (/\bje vois\b/.test(t)) r.type = 'vois';
    if (/arrivee? (a|sur) l adresse|arrivee? sur (les )?lieux|message d arrivee/.test(t)) r.type = 'arrivee';
    if (/ambiance|message de reconnaissance/.test(t)) r.type = 'ambiance';
    if (/compte rendu|\bcr\b|message de renseignements?/.test(t)) r.type = 'cr';
    if (/feu (est )?eteint|message de feu\b|message d extinction/.test(t)) r.type = 'eteint';
    // ---- chiffres : surface detruite, surface menacee, front
    const surf = [];
    t.replace(/(\d+(?:\.\d+)?) ?(ha|m2)\b/g, (x, v, u, pos) => { surf.push({ v: +v * (u === 'm2' ? 1e-4 : 1), avant: t.slice(Math.max(0, pos - 32), pos), apres: t.slice(pos, pos + x.length + 14) }); return x; });
    for (const s of surf) { if (/menac/.test(s.avant) || /menac/.test(s.apres)) { if (r.menace == null) r.menace = s.v; } else if (r.ha == null) r.ha = s.v; }
    if ((m = t.match(/(\d+(?:\.\d+)?) ?(km|m) de front/)) || (m = t.match(/front[^\d]{0,30}(\d+(?:\.\d+)?) ?(km|m)?\b/))) r.front = +m[1] * (m[2] === 'km' ? 1000 : 1);
    // ---- moyens de lutte : total, ou supplement
    if (/secours suffisants?|moyens suffisants?|pas de (demande|renfort)/.test(t)) r.suffisant = true;
    if ((m = t.match(/(\d+) ?(uiff|unites?|moyens de lutte|ccf|groupes?)( de lutte)? (supplementaires?|en renforts?|de plus|en plus)/)) || (m = t.match(/renforts? de (\d+) ?(uiff|unites?|moyens)/))) r.uiffSup = +m[1];
    else if ((m = t.match(/necessite (\d+)/)) || (m = t.match(/(\d+) ?(uiff|unites?|moyens de lutte)( de lutte)?( sur les lieux| au total| en tout)?/))) r.uiff = +m[1];
    // ---- situation, phase
    if (/tres defavorable/.test(t)) r.situation = 'Très défavorable'; else if (/defavorable/.test(t)) r.situation = 'Défavorable'; else if (/favorable/.test(t)) r.situation = 'Favorable';
    if (/feu (est |declare )?fixe\b/.test(t)) r.phase = 'Feu fixé';
    if (/feu (est |declare )?maitrise|\bmaitrise\b/.test(t)) r.phase = 'Feu maîtrisé';
    if ((m = t.match(/(compte rendu|cr) (numero )?(\d+)/))) r.numero = +m[3];
    // ---- difficultes
    if (/inaccessible|non porteur|impraticable/.test(t)) r.diff.push('Terrain inaccessible');
    if (/fosses?|crastes?/.test(t)) r.diff.push('Fossés');
    if (/chablis/.test(t)) r.diff.push('Chablis');
    if (/points? sensibles?|habitations? menacees?|maisons? menacees?|camping/.test(t)) r.diff.push('Points sensibles à défendre');
    // ---- point d'eau et moyen de pompage
    if ((m = t.match(/point d eau (numero )?(\d+)/)) || (m = t.match(/activation du (numero )?(\d+)/)) || (m = t.match(/\bpe (numero )?(\d+)/))) r.pe = +m[2];
    if ((m = t.match(/\b(mprgp|mpri|mpr|mpf)\b/))) r.pompe = m[1].toUpperCase();
    // ---- moyens specifiques
    const nb = re => { const q = t.match(re); return q && q[1] ? Math.min(6, +q[1]) : 1; };
    const neg = re => new RegExp('(pas de|sans|aucun|annul\\w*( la demande)?( de| du| des)?) (\\d+ )?' + re.source).test(t);
    const ajoute = (re, nom, reNb) => { if (re.test(t) && !neg(re)) for (let k = nb(reNb); k > 0; k--) r.moyens.push(nom); };
    ajoute(/\bgpf\b/, 'GPF', /(\d+) gpf/); ajoute(/chenillettes?/, 'Chenillette', /(\d+) chenillettes?/); ajoute(/\begl\b/, 'Lot EGL', /(\d+) (lots? )?egl/); ajoute(/bulldozer/, 'Bulldozer', /(\d+) bulldozers?/);
    ajoute(/canadair|pelican/, 'Canadair', /(\d+) (canadair|pelican)/); ajoute(/\bdash\b|milan/, 'Dash 8', /(\d+) (dash|milan)/);
    if (/\babe\b|bombardiers? d eau|moyens? aeriens?/.test(t) && !/disponib|\?/.test(brut) && !r.moyens.some(x => x === 'Canadair' || x === 'Dash 8') && /demande|necessite|engage|besoin|envoy/.test(t)) r.moyens.push('Canadair');
    if (/charlie 33/.test(t) && /demande|necessite|engage|besoin|envoy/.test(t)) r.moyens.push('Charlie 33');
    // ---- autorites
    if (/gendarmerie|police|forces de l ordre/.test(t)) r.autorites.push('Police ou gendarmerie');
    if (/\belus?\b|maire|conseiller technique|\bdfci\b/.test(t)) r.autorites.push('Élus, conseiller technique DFCI');
    if (/enedis|\brte\b|energie|\bedf\b|coupure (de la )?ligne/.test(t)) r.autorites.push('Énergie (Enedis, RTE)');
    // ---- coordonnees : « golf victor 626 », « GV 626 », « golf victor six deux six »
    const mots = t.split(' ');
    for (let i = 0; i < mots.length - 2 && !r.coord; i++) if (NATO[mots[i]] && NATO[mots[i + 1]]) {
      const reste = mots.slice(i + 2, i + 5);
      if (/^\d{3}$/.test(reste[0])) r.coord = NATO[mots[i]] + NATO[mots[i + 1]] + ' ' + reste[0];
      else if (reste.length === 3 && reste.every(x => /^\d$/.test(x))) r.coord = NATO[mots[i]] + NATO[mots[i + 1]] + ' ' + reste.join('');
      if (r.coord && /^[1-5]$/.test(mots[i + (reste[0].length === 3 ? 3 : 5)] || '') && /carre|sous/.test(mots.slice(i, i + 9).join(' '))) r.sousCarre = +mots[i + (reste[0].length === 3 ? 3 : 5)];
    }
    if (!r.coord && (m = String(brut).match(/\b([A-Z]{2}) ?(\d{3})\b/))) r.coord = m[1] + ' ' + m[2];
    if (r.coord && /point d engagement|engagement (des moyens )?(en|au|:)/.test(t)) r.pteng = r.coord;
    // ---- commune, lieu-dit (reconnaissance floue)
    if (ctx) {
      r.commune = N.meilleurNom(brut, ctx.communes || []) || undefined;
      r.lieuDit = N.meilleurNom(brut, (ctx.lieux || []).filter(n => N.norm(n) !== N.norm(r.commune || ''))) || undefined;
      if (!r.pteng && r.lieuDit && /point d engagement/.test(t)) r.pteng = r.lieuDit;
    }
    // ---- nature du feu
    { const z = t.replace(/feux? de forets?/g, ''); for (const [re, c] of CAT) if (re.test(z)) { r.categorie = c; break; } }
    if (/reconnaissance en cours|je (debute|commence|poursuis) (la |ma )?reconnaissance/.test(t)) r.reco = true;
    // ---- feu eteint : cause, origine, surveillance
    if (/cause inconnue|origine inconnue|cause indeterminee/.test(t)) r.cause = 'Inconnue'; else if (/malveillance|volontaire|criminel/.test(t)) r.cause = 'Malveillance'; else if (/naturelle|foudre/.test(t)) r.cause = 'Naturelle'; else if (/accidentelle?|involontaire|imprudence/.test(t)) r.cause = 'Accidentelle';
    if (r.type === 'eteint' || r.cause) for (const [re, o] of ORIGINES) if (re.test(t)) { r.origine = o; break; }
    if (/surveillance/.test(t)) r.surv = /asa|dfci/.test(t.slice(t.indexOf('surveillance'))) ? 'ASA DFCI' : /proprietaire/.test(t) ? 'Propriétaire' : /pompiers|uiff|ccf|nos soins|mes soins/.test(t) ? 'Sapeurs-pompiers' : 'Autre';
    // ---- questions et demandes de service
    const interro = /\?/.test(brut) || /^(ou|quand|quel|quelle|combien|avez|est ce|pouvez|donnez)\b/.test(t) || /\b(ou en (est|sont)|quel(le)? (est|sont)|dans combien|a quelle heure|delai)\b/.test(t);
    if (/repetez|repeter|pas compris|mal recu/.test(t)) r.question = 'repetez';
    else if (interro && /renforts?|uiff|unites?|moyens|delai|arrive/.test(t)) r.question = 'renforts';
    else if (interro && /meteo|vent|hygro|risque|temperature/.test(t)) r.question = 'meteo';
    else if (interro && /heure|top horaire/.test(t)) r.question = 'heure';
    else if (interro && /aerien|canadair|dash|abe|pelican|milan/.test(t)) r.question = 'aerien';
    else if (interro && /point d eau|mpr|mpf|motopompe/.test(t)) r.question = 'eau';
    if (/annul/.test(t)) r.annule = true;
    if ((m = t.match(/(je )?libere (l |la |le |les )?(uiff|unite) ?(\d+)/)) || (m = t.match(/(uiff|unite) ?(\d+) (est )?(liberee?|disponible)/))) r.libere = +(m[4] && /^\d+$/.test(m[4]) ? m[4] : m[2]);
    // demande de reseau seule : pas encore de contenu
    const contenu = r.ha != null || r.front != null || r.uiff != null || r.uiffSup != null || r.situation || r.categorie || r.pe || r.phase || r.cause || r.coord || r.lieuDit || r.suffisant || r.moyens.length;
    if (pourMsg && r.type !== 'libre' && !contenu) r.reseau = true;
    r.annonce = pourMsg && r.type !== 'libre';
    // ---- ordres aux unites (DIR 654)
    if ((m = t.match(/\b(uiff|unite|u) ?(\d+)\b/))) r.unite = +m[2];
    if (/attaque de front|attaqu\w* .{0,20}de front|engag\w* .{0,20}de front|sur la tete|a la tete/.test(t)) r.ordre = 'front';
    else if (/flanc gauche/.test(t)) r.ordre = 'flancG';
    else if (/flanc droit/.test(t)) r.ordre = 'flancD';
    else if (/percee/.test(t)) r.ordre = 'percee';
    else if (/lisieres?|noyage/.test(t)) r.ordre = 'lisiere';
    else if (/defense|defendez|protegez|protection/.test(t)) r.ordre = 'defense';
    else if (/ravitaill|remplir|remplissage|au point d eau|faire le plein/.test(t) && r.unite) r.ordre = 'eau';
    else if (/attente|attendez|restez/.test(t)) r.ordre = 'attente';
    if (/repli|repliez|evacuez|degagez/.test(t)) r.ordre = 'repli';
    if (/responsable (du |de l )?(point d eau|point alpha|alimentation)|point alpha/.test(t)) r.alpha = true;
    if (/mouillant/.test(t)) r.mouillant = !/sans mouillant|pas de mouillant|arret(ez)? (du |le )?mouillant/.test(t);
    if (/largage|en securite|dans les cabines|regagnez (les |vos )?cabines/.test(t)) r.securiteLargage = true;
    return r;
  };
  if (typeof module !== 'undefined') module.exports = PARLE; else window.PARLE = PARLE;
})();
