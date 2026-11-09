// =============================================================================
// Moyens aeriens et appels de detresse.
// - ABE : demande au CODIS, engagement (COZ), contact sur le canal air-sol,
//   prise en compte en 10 points (memento SDIS 33), objectif et ligne de largage,
//   « personnel en securite, autorisation de largage », effet du largage
//   (eau : Canadair, retardant : Dash 8), rotations et autonomie.
// - Detresses : appels realistes d'un chef d'agres, marche a suivre attendue,
//   consequences selon la rapidite et la justesse de la reponse.
// =============================================================================
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  let A;                       // acces au jeu (fourni par jeu.js)
  const AV = { avions: [], largages: [] };
  const TYPES = {
    Canadair: { ind: 'Pélican', delai: [35, 50], rotation: 12, autonomie: 150, long: 100, larg: 25, retardant: false, cap: '6 t d\'eau' },
    'Dash 8': { ind: 'Milan', delai: [20, 30], rotation: 45, autonomie: 240, long: 150, larg: 30, retardant: true, cap: '10 t de retardant' },
  };
  const OBJ = ['Tête AvG', 'Tête', 'Tête AvD', 'Milieu FG', 'Milieu FD', 'Origine FG', 'Origine FD'];
  const PTS10 = [
    'Accueil sur la fréquence air-sol (« Bonjour »)',
    'Délégation de la gestion du chantier à un adjoint (veille CODIS et fréquence chantier)',
    'Position du COS et environnement (azimut et distance d\'un point remarquable ou de l\'origine du feu)',
    'Guidage si nécessaire',
    'Obstacles : lignes HT (position, distance, orientation), pylônes, relais, autres aéronefs',
    'Situation : dynamique du feu, moyens engagés, vent sur zone',
    'Objectif et mission avec orientation (tête AvG / AvD, milieu, origine, flanc gauche / droit)',
    '« Personnel en sécurité, autorisation de largage »',
    'Silence radio avant la reprise de contact par le pilote',
    'Évolution après largage, renforts, délai de rotation, autonomie sur zone',
  ];

  AV.init = function (api) { A = api; };
  // une seule fenetre a la fois : les suivantes attendent (detresse prioritaire)
  const FEN = { file: [], ouverte: null };
  function ouvreFen(id, rendu, prioritaire) {
    if (FEN.ouverte) { if (prioritaire) FEN.file.unshift({ id, rendu }); else FEN.file.push({ id, rendu }); return; }
    FEN.ouverte = id; rendu(); $('#fenetre').hidden = false;
  }
  function fermeFen() { $('#fenetre').hidden = true; FEN.ouverte = null; const n = FEN.file.shift(); if (n) setTimeout(() => ouvreFen(n.id, n.rendu), 50); }

  // ------------------------------------------------------------- demande et arrivee
  AV.demande = function (type, n) {
    const T = TYPES[type], G = A.G;
    const k = AV.avions.filter(a => a.type === type).length;
    for (let i = 0; i < (n || 1); i++) {
      const id = `${T.ind} ${31 + k + i}`;
      AV.avions.push({ id, type, etat: 'engage', tArrivee: G.t + (T.delai[0] + G.R() * (T.delai[1] - T.delai[0])) * 60 + i * 60, tFin: null, x: A.carte.W + 3000, y: -2000, pec: false, largages: 0 });
    }
    const cap = Math.round((A.carte.lambert93[0] + A.carte.W / 2 - 417000) / 1000), dist = Math.round(Math.hypot(A.carte.lambert93[0] + A.carte.W / 2 - 417000, A.carte.lambert93[1] + A.carte.H / 2 - 6421000) / 1000);
    A.radio('CODIS 33', 'CDG Salles', `${n || 1} ${type} engagé(s) par le COZ. Ils vous contacteront sur le canal 18, indicatif COS ${A.commune()}. Arrivée estimée dans ${TYPES[type].delai[0]} à ${TYPES[type].delai[1]} min (azimut ${210}°, ${dist} km de Mérignac).`, 'GRP 272', 'codis');
  };

  AV.pas = function (dt) {
    const G = A.G;
    for (const a of AV.avions) {
      if (a.etat === 'engage' && G.t >= a.tArrivee - 5 * 60 && !a.contact) {
        a.contact = true; a.etat = 'approche';
        A.radio(a.id, 'COS ' + A.commune(), `COS ${A.commune()} de ${a.id}, ${a.type}, ${TYPES[a.type].cap}, à 5 minutes de votre zone, j'écoute.`, 'Canal 18', 'alerte');
        if (!AV.pecFaite) AV.ouvrePEC(a); else A.info(`${a.id} sur zone : donnez-lui un objectif (onglet Moyens > Moyens aériens).`);
      }
      if (a.etat === 'approche' && G.t >= a.tArrivee) { a.etat = 'zone'; a.tFin = G.t + TYPES[a.type].autonomie * 60; }
      if (a.etat === 'zone' && a.ordre && G.t >= a.ordre.t) largue(a);
      if (a.etat === 'rotation' && G.t >= a.tRetour) { a.etat = 'zone'; A.radio(a.id, 'COS ' + A.commune(), `${a.id} de retour sur zone, en attente d'objectif.`, 'Canal 18'); }
      if ((a.etat === 'zone' || a.etat === 'rotation') && a.tFin && G.t > a.tFin) { a.etat = 'parti'; A.radio(a.id, 'COS ' + A.commune(), `${a.id} en limite d'autonomie, je quitte la zone.`, 'Canal 18'); }
      // position (animation)
      const cible = a.ordre ? a.ordre.milieu : a.etat === 'rotation' || a.etat === 'parti' ? [A.carte.W + 4000, -3000] : [G.ix, G.iy];
      if (a.etat !== 'engage') { const dx = cible[0] - a.x, dy = cible[1] - a.y, d = Math.hypot(dx, dy), v = 80 * dt; if (d > 1) { a.x += dx / d * Math.min(d, v); a.y += dy / d * Math.min(d, v); a.cap = Math.atan2(dx, dy); } }
    }
  };

  // ------------------------------------------------------------- prise en compte en 10 points
  AV.ouvrePEC = function (a) { ouvreFen('pec', () => { if (AV.pecFaite) { A.info(`${a.id} sur zone : donnez-lui un objectif (onglet Moyens).`); setTimeout(fermeFen, 0); return; } rendPEC(a); }); };
  function rendPEC(a) {
    const G = A.G, el = $('#fenetre');
    const adj = G.unites.filter(u => u.x != null && u.type === 'UIFF');
    const obs = A.obstaclesProches(2500);
    el.innerHTML = `<h2>Prise en compte de ${esc(a.id)} (${esc(a.type)})</h2>
      <p class="aide">Canal air-sol 18. Les 10 points du mémento, dans l'ordre. Indicatif : COS ${esc(A.commune())}.</p>
      <form class="form" id="f-pec">
        <label class="ligne"><input type="checkbox" name="p1"> 1. ${PTS10[0]}</label>
        <label>2. ${PTS10[1]} <select name="adj"><option value="">—</option>${adj.map(u => `<option>${esc(u.ca)}</option>`).join('')}</select></label>
        <label>3. Position du COS : azimut <span><input type="number" name="az" style="width:80px">° et distance <input type="number" name="dist" style="width:90px"> m de l'origine du feu</span></label>
        <label class="ligne"><input type="checkbox" name="p4"> 4. ${PTS10[3]}</label>
        <fieldset><legend>5. Obstacles signalés au pilote</legend><div class="cases">${obs.map((o, i) => `<label><input type="checkbox" name="obs" value="${i}"> ${esc(o.n)}</label>`).join('') || '<span class="aide">Repérez-les sur la carte.</span>'}<label><input type="checkbox" name="obs" value="aucun"> Aucun obstacle</label></div></fieldset>
        <label>6. Situation <textarea name="sit" placeholder="dynamique du feu, moyens engagés, vent sur zone"></textarea></label>
        <label>7. Objectif <select name="obj">${OBJ.map(o => `<option>${o}</option>`).join('')}</select></label>
        <p class="aide">Tracez ensuite la ligne de largage sur la carte (2 clics) avec le bouton ci-dessous.</p>
        <div class="btns"><button type="button" class="btn sec" id="b-lig">Tracer la ligne de largage</button> <span id="lig-txt" class="aide"></span></div>
        <label class="ligne"><input type="checkbox" name="p8"> 8. ${PTS10[7]}</label>
        <label class="ligne"><input type="checkbox" name="p9"> 9. ${PTS10[8]}</label>
        <label>10. Rotation : retour prévu dans <span><input type="number" name="rot" style="width:70px"> min, autonomie <input type="number" name="auto" style="width:70px"> min</span></label>
        <div class="btns"><button class="btn" type="submit">Transmettre au pilote (canal 18)</button></div>
      </form>`;
    $('#b-lig').onclick = () => A.outil('largage', 'Cliquez le début puis la fin de la ligne de largage.');
    $('#f-pec').onsubmit = e => { e.preventDefault(); validePEC(a, new FormData(e.target), obs); };
  }
  AV.clic = function (x, y) {
    AV.ligne = AV.ligne && AV.ligne.length < 2 ? AV.ligne : [];
    AV.ligne.push([x, y]);
    if (AV.ligne.length === 2) { const L = Math.round(Math.hypot(AV.ligne[1][0] - AV.ligne[0][0], AV.ligne[1][1] - AV.ligne[0][1])); const t = $('#lig-txt'); if (t) t.textContent = `ligne de ${L} m`; A.finOutil(); return true; }
    return false;
  };
  function validePEC(a, f, obs) {
    const G = A.G, ev = A.evalue;
    if (!AV.ligne || AV.ligne.length < 2) { A.info('Tracez d\'abord la ligne de largage.'); return; }
    ev('rto', 'ABE 1. Accueil', f.get('p1') ? 'fait' : 'oublié', f.get('p1') ? 'ok' : 'mi');
    ev('rto', 'ABE 2. Délégation du chantier', f.get('adj') || 'non déléguée', f.get('adj') ? 'ok' : 'ko', 'Pendant la prise en compte, un adjoint veille le CODIS et la fréquence chantier.');
    const az = A.cap(G.cdg.x - G.ix, G.cdg.y - G.iy), dist = Math.hypot(G.cdg.x - G.ix, G.cdg.y - G.iy);
    const dAz = Math.abs(((+f.get('az') - az + 540) % 360) - 180);
    ev('rto', 'ABE 3. Position du COS', `${f.get('az') || '—'}° / ${f.get('dist') || '—'} m (réel ${Math.round(az)}° / ${Math.round(dist)} m de l'origine)`, f.get('az') && dAz < 25 && Math.abs(+f.get('dist') - dist) < Math.max(200, dist * 0.35) ? 'ok' : 'ko', 'Azimut depuis l\'origine du feu vers le COS, et distance.');
    const cochés = f.getAll('obs'), dangereux = obs.filter(o => o.danger);
    const oubli = dangereux.filter(o => !cochés.includes(String(obs.indexOf(o))));
    ev('rto', 'ABE 5. Obstacles', oubli.length ? `non signalés : ${oubli.map(o => o.n).join(', ')}` : (dangereux.length ? 'tous signalés' : 'aucun obstacle proche'), oubli.length ? 'ko' : 'ok', 'Lignes HT, pylônes, relais : position, distance, orientation.');
    ev('rto', 'ABE 6. Situation', f.get('sit') ? 'transmise' : 'non transmise', f.get('sit') ? 'ok' : 'mi');
    // personnel dans la zone de largage
    const [p, q] = AV.ligne;
    const dans = G.unites.filter(u => u.x != null && distSeg([u.x, u.y], p, q) < 80);
    if (f.get('p8') && dans.length) { ev('rto', 'ABE 8. Personnel en sécurité', `autorisation donnée avec ${dans.map(u => u.label).join(', ')} sous la ligne de largage`, 'ko', 'Faire dégager les engins de la zone de largage avant d\'autoriser.'); AV.touches = dans; }
    else ev('rto', 'ABE 8. Personnel en sécurité', f.get('p8') ? 'autorisation après vérification' : 'pas d\'autorisation : le pilote ne largue pas', f.get('p8') ? 'ok' : 'ko');
    ev('rto', 'ABE 9. Silence radio', f.get('p9') ? 'demandé' : 'oublié', f.get('p9') ? 'ok' : 'mi');
    ev('rto', 'ABE 10. Rotation et autonomie', f.get('rot') ? `${f.get('rot')} min (réel ≈ ${TYPES[a.type].rotation} min)` : 'non demandées', f.get('rot') ? 'ok' : 'mi');
    // objectif coherent : la ligne doit toucher le feu ou etre devant la tete
    const b = A.F().bilan(); const proche = b.actifs.some(i => { const [x, y] = A.F().xy(i); return distSeg([x, y], p, q) < 150; });
    ev('rto', 'ABE 7. Objectif', `${f.get('obj')}, ligne de ${Math.round(Math.hypot(q[0] - p[0], q[1] - p[1]))} m ${proche ? 'au contact du front' : 'loin du front actif'}`, proche ? 'ok' : 'mi', 'Le largage d\'eau agit au contact ; le retardant se pose devant la tête, sur une zone d\'appui.');
    A.radio('COS ' + A.commune(), a.id, `${a.id} de COS ${A.commune()}, bonjour. Objectif ${f.get('obj')}, ligne de ${Math.round(Math.hypot(q[0] - p[0], q[1] - p[1]))} m en ${A.dfci(...p)}. ${f.get('p8') ? 'Personnel en sécurité, autorisation de largage.' : ''}`, 'Canal 18');
    AV.pecFaite = true;
    fermeFen();
    if (!f.get('p8')) { A.radio(a.id, 'COS ' + A.commune(), 'J\'attends votre autorisation de largage.', 'Canal 18', 'alerte'); a.attenteAuto = { p, q, obj: f.get('obj') }; AV.ligne = null; return; }
    for (const av of AV.avions.filter(x => x.etat === 'zone' || x.etat === 'approche')) programme(av, p, q, f.get('obj'));
    AV.ligne = null;
  }
  function programme(a, p, q, obj, delai) {
    a.ordre = { p, q, obj, milieu: [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2], t: Math.max(A.G.t + (delai || 90), a.tArrivee || 0) };
  }
  function largue(a) {
    const T = TYPES[a.type], { p, q } = a.ordre, F = A.F();
    // la ligne effective est limitee a la longueur d'un largage, centree sur le milieu demande
    const L = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1, ux = (q[0] - p[0]) / L, uy = (q[1] - p[1]) / L, m = a.ordre.milieu, l = Math.min(L, T.long);
    const a0 = [m[0] - ux * l / 2, m[1] - uy * l / 2], a1 = [m[0] + ux * l / 2, m[1] + uy * l / 2];
    let n = 0;
    for (let d = 0; d <= l; d += 10) {
      const x = a0[0] + ux * d, y = a0[1] + uy * d;
      if (!T.retardant) n += F.traite(x, y, T.larg / 2, 'eteint');
      F.traite(x, y, T.larg / 2 + 5, 'mouille', T.retardant ? 3600 : 900);
    }
    A.G.besoinReseed = true;
    AV.largages.push({ a0, a1, t: A.G.t, retardant: T.retardant });
    a.largages++;
    A.radio(a.id, 'COS ' + A.commune(), `${a.id}, largage effectué ${a.ordre.obj.toLowerCase()}. Rotation, retour dans ${T.rotation} minutes.`, 'Canal 18');
    if (AV.touches && AV.touches.length) {
      for (const u of AV.touches) A.radio(u.ca, 'CDG Salles', `Nous avons pris le largage ! Pare-brise étoilé, un équipier contusionné. Personnel choqué.`, 'DIR 654', 'alerte');
      A.evalue('rto', 'Largage sur du personnel', AV.touches.map(u => u.label).join(', '), 'ko', 'Accident évitable : vérifier la zone avant « personnel en sécurité, autorisation de largage ».');
      AV.touches = null;
    }
    a.ordre = null; a.etat = 'rotation'; a.tRetour = A.G.t + T.rotation * 60;
  }
  function distSeg(p, a, b) { const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L)); return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy); }

  // nouvel objectif apres la premiere prise en compte (points 7 et 8)
  AV.panneau = function () {
    if (!AV.avions.length) return '';
    return `<h3>Moyens aériens (canal 18)</h3>${AV.avions.map(a => `<div class="unite"><header><b>${esc(a.id)}</b><span class="st">${esc(a.type)} · ${{ engage: 'en route', approche: 'en approche', zone: a.ordre ? 'largage programmé' : 'sur zone, en attente', rotation: 'rotation, retour ' + A.hm(a.tRetour), parti: 'reparti' }[a.etat]}</span></header>
      <small class="aide">${a.largages} largage(s)${a.tFin ? ' · autonomie jusqu\'à ' + A.hm(a.tFin) : ''}</small>
      ${a.etat === 'zone' && !a.ordre ? `<div class="ordres"><button data-av="${esc(a.id)}">Nouvel objectif…</button></div>` : ''}${a.attenteAuto ? `<div class="ordres"><button data-auto="${esc(a.id)}">Personnel en sécurité, autorisation de largage</button></div>` : ''}</div>`).join('')}`;
  };
  AV.bindPanneau = function (root) {
    root.querySelectorAll('[data-av]').forEach(b => b.onclick = () => {
      const a = AV.avions.find(x => x.id === b.dataset.av); AV.cible = a; AV.ligne = [];
      A.outil('largage2', `Objectif de ${a.id} : cliquez le début puis la fin de la ligne de largage.`);
    });
    root.querySelectorAll('[data-auto]').forEach(b => b.onclick = () => {
      const a = AV.avions.find(x => x.id === b.dataset.auto), o = a.attenteAuto; a.attenteAuto = null;
      const dans = A.G.unites.filter(u => u.x != null && distSeg([u.x, u.y], o.p, o.q) < 80);
      if (dans.length) { AV.touches = dans; A.evalue('rto', 'Autorisation de largage', `${dans.map(u => u.label).join(', ')} sous la ligne`, 'ko'); }
      A.radio('COS ' + A.commune(), a.id, 'Personnel en sécurité, autorisation de largage.', 'Canal 18'); programme(a, o.p, o.q, o.obj, 30);
    });
  };
  AV.clic2 = function (x, y) {
    AV.ligne.push([x, y]);
    if (AV.ligne.length < 2) return false;
    const a = AV.cible, [p, q] = AV.ligne;
    const dans = A.G.unites.filter(u => u.x != null && distSeg([u.x, u.y], p, q) < 80);
    A.radio('COS ' + A.commune(), a.id, `${a.id}, nouvel objectif en ${A.dfci(...p)}. ${dans.length ? '' : 'Personnel en sécurité, autorisation de largage.'}`, 'Canal 18');
    if (dans.length) { a.attenteAuto = { p, q, obj: 'Objectif' }; A.info(`Engins dans la zone de largage : ${dans.map(u => u.label).join(', ')}. Faites-les dégager avant d'autoriser.`); }
    else programme(a, p, q, 'Objectif', 60);
    AV.ligne = null; A.finOutil(); return true;
  };

  AV.dessine = function (ctx, vue) {
    for (const l of AV.largages) {
      const age = A.G.t - l.t; if (age > (l.retardant ? 3600 : 900)) continue;
      ctx.strokeStyle = l.retardant ? 'rgba(220,38,38,.55)' : 'rgba(59,130,246,.55)'; ctx.lineWidth = Math.max(4, 28 * vue.s); ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(vue.sx(l.a0[0]), vue.sy(l.a0[1])); ctx.lineTo(vue.sx(l.a1[0]), vue.sy(l.a1[1])); ctx.stroke(); ctx.lineCap = 'butt';
    }
    if (AV.ligne && AV.ligne.length === 1 && A.G.souris) { ctx.strokeStyle = '#2563eb'; ctx.lineWidth = 3; ctx.setLineDash([8, 5]); ctx.beginPath(); ctx.moveTo(vue.sx(AV.ligne[0][0]), vue.sy(AV.ligne[0][1])); ctx.lineTo(vue.sx(A.G.souris[0]), vue.sy(A.G.souris[1])); ctx.stroke(); ctx.setLineDash([]); }
    for (const a of AV.avions) {
      if (a.etat === 'engage' || a.etat === 'parti') continue;
      const x = vue.sx(a.x), y = vue.sy(a.y);
      ctx.save(); ctx.translate(x, y); ctx.rotate(a.cap || 0);
      ctx.fillStyle = a.type === 'Canadair' ? '#facc15' : '#ef4444'; ctx.strokeStyle = '#111'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(0, -14); ctx.lineTo(3, -4); ctx.lineTo(14, 0); ctx.lineTo(3, 2); ctx.lineTo(2, 10); ctx.lineTo(6, 13); ctx.lineTo(-6, 13); ctx.lineTo(-2, 10); ctx.lineTo(-3, 2); ctx.lineTo(-14, 0); ctx.lineTo(-3, -4); ctx.closePath();
      ctx.fill(); ctx.stroke(); ctx.restore();
      ctx.font = '700 11px "IBM Plex Sans"'; ctx.lineWidth = 3; ctx.strokeStyle = '#fff'; ctx.strokeText(a.id, x + 16, y); ctx.fillStyle = '#111'; ctx.fillText(a.id, x + 16, y);
    }
  };

  // ============================================================= appels de detresse
  const DT = {
    encercle: {
      titre: 'CCF pris par le feu',
      msg: (u, c) => `Mayday, Mayday, Mayday ! De ${u.ca}, CCF ${1 + (A.G.R() < 0.5 ? 1 : 0)} pris par le feu en ${c}, saute de feu derrière nous, nous passons en autoprotection !`,
      attendu: ['silence', 'ar', 'protection', 'codis', 'repli', 'largage'],
      gravite: 'Équipage brûlé, CCF détruit',
    },
    blesse: {
      titre: 'Sapeur-pompier blessé',
      msg: (u, c) => `Urgent, urgent ! De ${u.ca}, un équipier chuté du CCF dans une souche, suspicion de fracture de jambe, en ${c}.`,
      attendu: ['ar', 'codis', 'vsav', 'rencontre', 'protection'],
      gravite: 'Évacuation retardée, aggravation de l\'état du blessé',
    },
    embourbe: {
      titre: 'CCF immobilisé devant le feu',
      msg: (u, c) => `Urgent ! De ${u.ca}, CCF embourbé dans une craste en ${c}, le front arrive sur nous à 150 m !`,
      attendu: ['ar', 'protection', 'repli', 'codis', 'largage'],
      gravite: 'CCF détruit, équipage évacué à pied in extremis',
    },
    malaise: {
      titre: 'Coup de chaleur',
      msg: (u, c) => `De ${u.ca}, un équipier fait un malaise, coup de chaleur probable, il est conscient mais confus.`,
      attendu: ['ar', 'vsav', 'codis', 'sso', 'rencontre'],
      gravite: 'Aggravation, hospitalisation en réanimation',
    },
    liaison: {
      titre: 'Perte de liaison',
      msg: (u) => `(${u.ca} ne répond plus depuis plusieurs minutes.)`,
      attendu: ['appel', 'observation', 'protection', 'codis'],
      gravite: 'Engin isolé sans soutien pendant de longues minutes',
    },
  };
  const ACTIONS = [
    ['silence', 'Imposer le silence radio, priorité au message de détresse'],
    ['ar', 'Accuser réception, faire préciser la position et l\'état'],
    ['appel', 'Appeler l\'engin sur toutes les fréquences, faire tenter la liaison par un autre engin'],
    ['protection', 'Engager l\'engin le plus proche en protection (ouvrir un passage, arroser)'],
    ['codis', 'Transmettre au CODIS (GRP 272) : message de détresse ou d\'urgence'],
    ['vsav', 'Demander VSAV et SMUR'],
    ['sso', 'Activer le soutien sanitaire (SSO), hydratation et rotation des équipages'],
    ['rencontre', 'Désigner un point de rencontre accessible aux secours'],
    ['repli', 'Faire replier les engins exposés sur le cheminement de repli'],
    ['largage', 'Demander un largage d\'appui ou l\'arrêt des largages dans le secteur selon le cas'],
    ['observation', 'Envoyer un observateur ou Charlie 33 vers la dernière position connue'],
    ['continuer', 'Poursuivre la manœuvre en cours sans changement'],
  ];
  const DE = { prevues: [], encours: null };
  DE.init = function () {
    const G = A.G, n = G.niv.detresses;
    for (let i = 0; i < n; i++) DE.prevues.push(15 * 60 + G.R() * 35 * 60);
    DE.prevues.sort((a, b) => a - b);
  };
  DE.pas = function () {
    const G = A.G;
    if (DE.encours) { if (G.t - DE.encours.t > 8 * 60 && !DE.encours.fini) conclut(true); return; }
    if (!DE.prevues.length || !G.tEngage1) return;
    if (G.t - G.tEngage1 < DE.prevues[0]) return;
    const engages = G.unites.filter(u => u.x != null && u.type === 'UIFF' && u.etat === 'engage' && u.mission && u.mission !== 'attente');
    if (!engages.length) return;
    DE.prevues.shift();
    const u = engages[Math.floor(G.R() * engages.length)];
    const types = Object.keys(DT), k = types[Math.floor(G.R() * types.length)], T = DT[k];
    const c = A.dfci(u.x, u.y);
    DE.encours = { k, u, t: G.t, c };
    u.mission = 'attente'; u.detresse = true;
    if (k === 'encercle' || k === 'embourbe') A.F().traite(u.x, u.y, 25, 'mouille', 120);   // autoprotection
    A.radio(u.ca, 'CDG Salles', T.msg(u, c), 'DIR 654', 'alerte');
    ouvreFen('det', ouvre, true);
  };
  function ouvre() {
    const d = DE.encours, T = DT[d.k], el = $('#fenetre');
    el.innerHTML = `<h2 style="color:#ff6b6b">${esc(T.titre)}</h2><div class="ticket" style="background:#3a0d10;border-color:#8b1a1f;color:#ffd5d5">${esc(T.msg(d.u, d.c))}</div>
      <p class="aide">Cochez vos actions, dans l'ordre où vous les feriez, puis validez. Le temps continue de courir.</p>
      <form class="form" id="f-det">${ACTIONS.map(([k, t]) => `<label class="ligne"><input type="checkbox" name="a" value="${k}"> ${esc(t)}</label>`).join('')}
      <div class="btns"><button class="btn rouge" type="submit">Exécuter</button></div></form>`;
    $('#f-det').onsubmit = e => {
      e.preventDefault(); const choix = new FormData(e.target).getAll('a');
      d.choix = choix; d.tRep = A.G.t; fermeFen();
      // effets concrets
      if (choix.includes('protection')) { const v = A.G.unites.filter(x => x !== d.u && x.x != null && x.type !== 'Bulldozer').sort((a, b) => Math.hypot(a.x - d.u.x, a.y - d.u.y) - Math.hypot(b.x - d.u.x, b.y - d.u.y))[0]; if (v) { v.mission = 'defense'; v.cible = [d.u.x, d.u.y]; v.etat = 'engage'; A.allerA(v, d.u.x, d.u.y, true); A.radio('CDG Salles', v.ca, `${v.label}, priorité absolue, portez-vous en protection de ${d.u.label} en ${d.c}.`, 'DIR 654'); } }
      if (choix.includes('codis')) A.radio('CDG Salles', 'CODIS 33', `${d.k === 'encercle' ? 'Mayday' : 'Urgent'}, de CDG Salles : ${T.titre.toLowerCase()}, ${d.u.label} en ${d.c}. ${choix.includes('vsav') ? 'Je demande VSAV et SMUR. ' : ''}${choix.includes('rencontre') ? 'Point de rencontre au point d\'engagement.' : ''}`, 'GRP 272');
      if (choix.includes('repli')) for (const v of A.G.unites) if (v.x != null && v !== d.u && Math.hypot(v.x - d.u.x, v.y - d.u.y) < 400) { v.mission = 'attente'; if (A.G.ptEngagement) A.allerA(v, ...A.G.ptEngagement); }
      if (choix.includes('silence')) A.radio('CDG Salles', 'Tous', 'Silence radio sur la DIR 654, priorité au message de détresse.', 'DIR 654');
      conclut(false);
    };
  }
  function conclut(expire) {
    const d = DE.encours, T = DT[d.k], ch = d.choix || [];
    d.fini = true;
    const manquees = T.attendu.filter(k => !ch.includes(k)), erreurs = ch.filter(k => !T.attendu.includes(k) && k === 'continuer');
    const delai = expire ? 480 : d.tRep - d.t;
    const bon = !expire && manquees.length <= 1 && !erreurs.length && delai < 150;
    A.evalue('rto', `Détresse : ${T.titre}`, expire ? 'pas de réponse' : `réponse en ${Math.round(delai)} s ; oublié : ${manquees.map(k => ACTIONS.find(a => a[0] === k)[1].split(',')[0]).join(' ; ') || 'rien'}`, bon ? 'ok' : manquees.length <= 2 && !erreurs.length && !expire ? 'mi' : 'ko', 'Priorité absolue : sécurité des personnels avant la lutte.');
    if (!bon) A.radio(d.u.ca, 'CDG Salles', `${T.gravite}.`, 'DIR 654', 'alerte');
    else A.radio(d.u.ca, 'CDG Salles', 'Situation rétablie, équipage en sécurité.', 'DIR 654');
    d.u.detresse = false;
    if (!bon && (d.k === 'encercle' || d.k === 'embourbe')) { d.u.eau = 0; d.u.etat = 'hors service'; d.u.mission = null; }
    if (expire) { if (FEN.ouverte === 'det') fermeFen(); else FEN.file = FEN.file.filter(f => f.id !== 'det'); }
    DE.encours = null;
  }
  DE.actif = () => !!DE.encours;

  window.AVIONS = AV; window.DETRESSE = DE;
})();
