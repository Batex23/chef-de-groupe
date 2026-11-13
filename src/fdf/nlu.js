// =============================================================================
// Outils de comprehension du francais parle a la radio, sans service externe :
//  - normalisation (accents, apostrophes, sigles epeles « u i f f », « m p r »)
//  - nombres en lettres (« cent cinquante », « quatre-vingt-dix », « un hectare et demi »)
//  - lexique metier tolerant aux fautes de dictee vocale (distance d'edition)
//  - reconnaissance floue des noms propres (communes, lieux-dits)
// =============================================================================
(function () {
  'use strict';
  const NLU = {};
  NLU.norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’'`]/g, ' ').replace(/œ/g, 'oe').replace(/[-–—_/]/g, ' ').replace(/(\d)[,.](\d)/g, '$1§$2').replace(/[.,;:!?«»"()]/g, ' ').replace(/§/g, '.').replace(/\s+/g, ' ').trim();

  // ------------------------------------------------------------- distance d'edition
  NLU.lev = function (a, b) {
    if (a === b) return 0; const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
    if (Math.abs(m - n) > 3) return 9;
    let p = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) { const c = [i]; for (let j = 1; j <= n; j++) c[j] = Math.min(p[j] + 1, c[j - 1] + 1, p[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); p = c; }
    return p[n];
  };
  const tol = n => (n >= 9 ? 2 : n >= 6 ? 1 : 0);
  NLU.proche = (mot, cible) => mot === cible || NLU.lev(mot, cible) <= Math.min(tol(mot.length), tol(cible.length));

  // ------------------------------------------------------------- sigles et variantes de dictee
  const SIGLES = ['uiff', 'mprgp', 'mpri', 'mpr', 'mpf', 'gpf', 'egl', 'ccf', 'abe', 'dfci', 'vlhr', 'codis', 'cos', 'cdg', 'fpt', 'ccfs', 'ht', 'hta'];
  const VARIANTES = [
    [/\b(codice|codisse|caudis|kodis|cody|co dis)\b/g, 'codis'], [/\b(ambience|embiance|ambians)\b/g, 'ambiance'],
    [/\b(canadaire?s?|canada air|canaders?)\b/g, 'canadair'], [/\b(dache|dach|dash huit|dash 8|dâche)\b/g, 'dash'],
    [/\b(pelicans|pelikan|pelicant)\b/g, 'pelican'], [/\b(milans|mylan)\b/g, 'milan'],
    [/\b(you i ff|u i ff|uif|uïf|oui ff|huit ff|ui ff)\b/g, 'uiff'], [/\bunites? (d intervention )?feux? de forets?\b/g, 'uiff'],
    [/\b(m p r g p|mpr gp|mprg p)\b/g, 'mprgp'], [/\bmotopompes? remorquables?( d intervention)?\b/g, 'mpr'], [/\bmotopompes? flottantes?\b/g, 'mpf'],
    [/\b(gros porteurs?|groupe porteur)\b/g, 'gpf'], [/\b(grande longueur|etablissement grande longueur)\b/g, 'egl'],
    [/\b(bull|bulldozers|boule doseur)\b/g, 'bulldozer'], [/\b(helicoptere|helico)\b/g, 'charlie 33'],
    [/\bh t a?\b/g, 'ht'], [/\bhaute tension\b/g, 'ht'], [/\b(c r)\b/g, 'cr'], [/\bcompte rendus?\b/g, 'compte rendu'],
    [/\b(metre carre|metres carres|m2|m²)\b/g, 'm2'], [/\b(hectare|hectares|ectares?|ha)\b/g, 'ha'], [/\bmetres?\b/g, 'm'], [/\b(kilometres?|km)\b/g, 'km'],
    [/\bnumero\b|\bn°|\bn o\b/g, 'numero'], [/\b(av g|avant gauche)\b/g, 'avant gauche'], [/\b(av d|avant droite?)\b/g, 'avant droit'],
    [/\bf g\b/g, 'flanc gauche'], [/\bf d\b/g, 'flanc droit'], [/\bp s\b/g, 'point sensible'],
  ];
  function sigles(t) {
    for (const s of SIGLES) t = t.replace(new RegExp('\\b' + s.split('').join(' ?') + 's?\\b', 'g'), s);
    for (const [re, v] of VARIANTES) t = t.replace(re, v);
    return t;
  }

  // ------------------------------------------------------------- nombres en lettres
  const PETITS = { zero: 0, un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10, onze: 11, douze: 12, treize: 13, quatorze: 14, quinze: 15, seize: 16, vingt: 20, vingts: 20, trente: 30, quarante: 40, cinquante: 50, soixante: 60, septante: 70, nonante: 90 };
  NLU.nombres = function (t) {
    const mots = t.split(' '), out = [];
    let i = 0;
    const estNb = w => w in PETITS || w === 'cent' || w === 'cents' || w === 'mille';
    while (i < mots.length) {
      const w = mots[i];
      // « un » / « une » isoles devant un mot non numerique restent des articles sauf devant une unite ou un moyen
      if (!estNb(w)) { out.push(w); i++; continue; }
      let total = 0, cur = 0, j = i, lus = 0;
      while (j < mots.length) {
        const m = mots[j];
        if (m === 'et' && lus && j + 1 < mots.length && (mots[j + 1] === 'un' || mots[j + 1] === 'une' || mots[j + 1] === 'onze')) { j++; continue; }
        if (m in PETITS) {
          const v = PETITS[m];
          if (v === 20 && cur % 100 === 4) cur = cur - 4 + 80;                       // quatre-vingt
          else if (lus && v < 10 && cur % 10 !== 0 && cur % 100 < 10) break;          // « deux trois » : deux nombres
          else if (lus && v >= 10 && cur % 100 !== 0 && !(cur % 100 === 60 || cur % 100 === 80)) break;
          else cur += v;
        } else if (m === 'cent' || m === 'cents') cur = (cur % 1000 === 0 ? 1 : cur) * 100;
        else if (m === 'mille') { total += (cur || 1) * 1000; cur = 0; }
        else break;
        j++; lus++;
      }
      out.push(String(total + cur)); i = j;
    }
    let s = out.join(' ');
    s = s.replace(/(\d+) virgule (\d+)/g, '$1.$2').replace(/(\d+),(\d+)/g, '$1.$2');
    s = s.replace(/\b(\d{1,3}) (000|500)\b/g, '$1$2');                           // 5 000 -> 5000
    s = s.replace(/\b(1 )?demi (ha|heure|km)\b/g, '0.5 $2').replace(/(\d+(?:\.\d+)?) (ha|km|heures?|tonnes?) et demie?/g, (m, a, u) => (+a + 0.5) + ' ' + u);
    return s;
  };

  // ------------------------------------------------------------- lexique metier (correction des fautes de dictee)
  const LEXIQUE = ('ambiance reconnaissance arrivee adresse indiquee compte rendu eteint front situation favorable defavorable necessite unites moyens lutte activation engagement commune lieu ' +
    'broussailles landes taillis feuillus marais prairie agricole superficie surface menacee detruite brulee fixe maitrise gendarmerie police canadair pelican chenillette bulldozer renforts renfort suffisants secours ' +
    'inaccessible fosses chablis sensibles sensible coordonnees cause origine inconnue malveillance accidentelle naturelle surveillance proprietaire obstacles obstacle objectif mission largage autorisation securite personnel silence ' +
    'rotation autonomie flanc gauche droit attaque percee lisiere lisieres defense repli position guidage pylone pylones relais retardant barriere supplementaires message parlez repetez annulez annulation ' +
    'delai meteo hygrometrie libere liberes evolution efficacite adjoint delegue delegation bonjour interconnexion foudre pyromanie ordures loisirs electriques vehicules travaux forestiers').split(' ');
  const LEX = new Set(LEXIQUE);
  const COMMUNS = new Set('favoriser moyen moyenne commun communes position positions cause causes secour mission missions attaquer liberer personne personnes relai point points droite droits rendue rendus fixer fixee eteinte eteints message messages'.split(' '));
  NLU.corrige = function (t) {
    return t.split(' ').map(w => {
      if (w.length < 6 || LEX.has(w) || COMMUNS.has(w) || /\d/.test(w)) return w;
      let best = null, bd = 9, egal = false;
      for (const c of LEXIQUE) { if (Math.abs(c.length - w.length) > 2) continue; const d = NLU.lev(w, c); if (d < bd) { bd = d; best = c; egal = false; } else if (d === bd) egal = true; }
      return best && !egal && bd <= Math.min(tol(w.length), tol(best.length)) ? best : w;
    }).join(' ');
  };

  // texte pret pour l'analyse : normalise, sigles, nombres, lexique
  NLU.prepare = brut => NLU.corrige(NLU.nombres(sigles(NLU.norm(brut))));

  // ------------------------------------------------------------- noms propres (communes, lieux-dits)
  // renvoie le nom dont les mots significatifs se retrouvent (a une faute pres) dans le texte
  NLU.meilleurNom = function (brut, noms) {
    const t = NLU.norm(brut).split(' '); let best = null, bs = 0;
    const VIDES = new Set(['le', 'la', 'les', 'de', 'du', 'des', 'l', 'd', 'lieu', 'dit', 'a', 'au', 'aux', 'en', 'sur']);
    for (const n of noms) {
      const mots = NLU.norm(n).split(' ').filter(w => !VIDES.has(w)); if (!mots.length) continue;
      const long = mots.join('').length; if (long < 4) continue;
      let ok = 0, pos = -1, serre = true;
      for (const m of mots) { let k = -1; for (let i = 0; i < t.length; i++) if (t[i] === m || (m.length >= 5 && NLU.lev(t[i], m) <= (m.length >= 9 ? 2 : 1))) { if (pos < 0 || Math.abs(i - pos) <= 3) { k = i; break; } } if (k >= 0) { ok++; pos = k; } else serre = false; }
      const score = ok / mots.length;
      if (score === 1 && serre && long > bs) { best = n; bs = long; }
    }
    return best;
  };

  if (typeof module !== 'undefined') module.exports = NLU; else window.NLU = NLU;
})();
