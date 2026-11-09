// =============================================================================
// Lecture des messages passes a la voix ou en texte libre : type de message,
// chiffres (surface, front, UIFF), situation, phase de lutte, point d'eau et
// moyen de pompage, moyens supplementaires, coordonnees DFCI epelees, ordres
// aux UIFF (« UIFF 2 attaque flanc gauche »). Renvoie une structure, sans effet.
// =============================================================================
(function () {
  'use strict';
  const NOMBRES = { zero: 0, un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10, onze: 11, douze: 12, treize: 13, quatorze: 14, quinze: 15, seize: 16, vingt: 20, trente: 30, quarante: 40, cinquante: 50, soixante: 60, cent: 100, mille: 1000 };
  const NATO = { alpha: 'A', alfa: 'A', bravo: 'B', charlie: 'C', delta: 'D', echo: 'E', foxtrot: 'F', golf: 'G', hotel: 'H', india: 'I', juliet: 'J', juliett: 'J', kilo: 'K', lima: 'L', mike: 'M', november: 'N', oscar: 'O', papa: 'P', quebec: 'Q', romeo: 'R', sierra: 'S', tango: 'T', uniform: 'U', victor: 'V', whiskey: 'W', whisky: 'W', xray: 'X', 'x-ray': 'X', yankee: 'Y', zulu: 'Z' };
  const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, ' ').replace(/\s+/g, ' ').trim();
  function chiffres(t) {
    return t.replace(/\b(zero|une?|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze|treize|quatorze|quinze|seize|vingt|trente|quarante|cinquante|soixante|cent|mille)\b/g, m => String(NOMBRES[m]))
      .replace(/(\d+) (\d+)(?= ?(m|metres|ha|hectares))/g, (m, a, b) => +a < 10 && +b >= 100 ? String(+a * 1000 + +b) : m)
      .replace(/(\d+),(\d+)/g, '$1.$2');
  }
  const PARLE = {};
  PARLE.analyse = function (brut, ctx) {
    let t = chiffres(norm(brut));
    const r = { brut, type: 'libre', moyens: [], autorites: [] };
    if (/je vois/.test(t)) r.type = 'vois';
    if (/arrive|arrivee a l adresse/.test(t)) r.type = 'arrivee';
    if (/ambiance|message de reconnaissance/.test(t)) r.type = 'ambiance';
    if (/compte rendu|compte-rendu|\bcr\b/.test(t)) r.type = 'cr';
    if (/feu eteint|message de feu/.test(t)) r.type = 'eteint';
    let m;
    if ((m = t.match(/(\d+(?:\.\d+)?) ?(hectares?|ha)\b/))) r.ha = +m[1];
    if ((m = t.match(/(\d+) ?(metres? carres|m2)/))) r.ha = +m[1] / 10000;
    if ((m = t.match(/front[^\d]{0,25}(\d+(?:\.\d+)?) ?(km|kilometres?|m|metres?)?/))) r.front = +m[1] * (/^k/.test(m[2] || '') ? 1000 : 1);
    if ((m = t.match(/(\d+) ?(uiff|u i f f|unites?|moyens de lutte|groupes?)/))) r.uiff = +m[1];
    if (/tres defavorable/.test(t)) r.situation = 'Très défavorable'; else if (/defavorable/.test(t)) r.situation = 'Défavorable'; else if (/favorable/.test(t)) r.situation = 'Favorable';
    if (/feu (est )?fixe|feu fixe/.test(t)) r.phase = 'Feu fixé';
    if (/maitrise/.test(t)) r.phase = 'Feu maîtrisé';
    if ((m = t.match(/point d eau (n(°|o|umero)? ?)?(\d+)/))) r.pe = +m[3];
    if ((m = t.match(/\b(mprgp|mpri|mpr|mpf)\b/))) r.pompe = m[1].toUpperCase();
    if (/\bgpf\b|gros porteur/.test(t)) r.moyens.push('GPF');
    if (/chenillette/.test(t)) r.moyens.push('Chenillette');
    if (/\begl\b|grande longueur/.test(t)) r.moyens.push('Lot EGL');
    if (/bulldozer|\bbull\b/.test(t)) r.moyens.push('Bulldozer');
    if (/canadair|pelican/.test(t)) r.moyens.push('Canadair');
    if (/dash|milan/.test(t)) r.moyens.push('Dash 8');
    if (/\babe\b|bombardier/.test(t) && !r.moyens.some(x => x === 'Canadair' || x === 'Dash 8')) r.moyens.push('Canadair');
    if (/charlie 33|helicoptere|helico/.test(t)) r.moyens.push('Charlie 33');
    if (/gendarmerie|police/.test(t)) r.autorites.push('Police ou gendarmerie');
    if (/\belus?\b|maire|conseiller technique|dfci/.test(t)) r.autorites.push('Élus, conseiller technique DFCI');
    if (/enedis|rte|energie|edf/.test(t)) r.autorites.push('Énergie (Enedis, RTE)');
    // coordonnees : « golf tango 634 » ou « GT 634 »
    const mots = t.split(' ').map(w => w.replace(/[^a-z0-9-]/g, ''));
    for (let i = 0; i < mots.length - 2; i++) if (NATO[mots[i]] && NATO[mots[i + 1]] && /^\d{3}$/.test(mots[i + 2])) { r.coord = NATO[mots[i]] + NATO[mots[i + 1]] + ' ' + mots[i + 2]; break; }
    if (!r.coord && (m = brut.match(/\b([A-Z]{2}) ?(\d{3})\b/))) r.coord = m[1] + ' ' + m[2];
    // commune, lieu-dit
    if (ctx) {
      for (const n of ctx.communes || []) if (t.includes(norm(n))) r.commune = n;
      let best = ''; for (const n of ctx.lieux || []) { const k = norm(n); if (k.length > 3 && t.includes(k) && k.length > best.length) best = n; } if (best) r.lieuDit = best;
    }
    {
      const CAT = [[/ages divers/, 'Pins d’âges divers'], [/(moins de|- de|-) ?20 ans|jeunes pins|semis/, 'Pins de - 20 ans'], [/20 a 40 ans/, 'Pins de 20 à 40 ans'], [/(plus de|\+ de|\+) ?40 ans|vieux pins/, 'Pins de + 40 ans'],
        [/landes?\b/, 'Landes'], [/broussailles/, 'Broussailles'], [/taillis|feuillus/, 'Taillis/feuillus'], [/marais/, 'Marais'], [/prairie|bord de route/, 'Prairie / Bord de route'], [/agricole|culture|chaume/, 'Espace agricole']];
      const z = t.replace(/feu de (forets?)/, '');
      for (const [re, c] of CAT) if (re.test(z)) { r.categorie = c; break; }
    }
    // ordres aux unites
    if ((m = t.match(/\b(uiff|unite|u) ?(\d+)\b/))) r.unite = +m[2];
    if (/attaque de front|\bde front\b/.test(t)) r.ordre = 'front';
    else if (/flanc gauche/.test(t)) r.ordre = 'flancG';
    else if (/flanc droit/.test(t)) r.ordre = 'flancD';
    else if (/percee/.test(t)) r.ordre = 'percee';
    else if (/lisiere/.test(t)) r.ordre = 'lisiere';
    else if (/defense|defendez|protegez|protection/.test(t)) r.ordre = 'defense';
    else if (/ravitaill|remplir|remplissage|au point d eau/.test(t) && r.unite) r.ordre = 'eau';
    else if (/attente|attendez|restez/.test(t)) r.ordre = 'attente';
    if (/repli|repliez|evacuez/.test(t)) r.ordre = 'repli';
    return r;
  };
  window.PARLE = PARLE;
})();
