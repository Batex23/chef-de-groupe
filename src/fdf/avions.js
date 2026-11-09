// =============================================================================
// Moyens aeriens (air-sol, canal 18) et appels de detresse.
// - ABE : l'avion se presente sur la radio air-sol (notification), le COS ouvre
//   la conversation et parle en texte libre (ou a la voix). Le pilote repond
//   « reçu » point par point (position, obstacles, situation, objectif, mission,
//   personnel en securite / autorisation de largage, silence radio, rotation).
//   Les 10 points de la prise en compte sont evalues d'apres ce qui a ete dit.
// - Detresses : appel d'un chef d'agres sur la DIR 654 ; le COS doit le prendre
//   en compte (accuse de reception, ordre de protection) et passer le message au
//   CODIS. Pas de liste a cocher : tout passe par la radio.
// =============================================================================
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, ' ');
  let A;
  const AV = { avions: [], largages: [], chat: [], points: {}, pecFaite: false };
  const TYPES = {
    Canadair: { ind: 'Pélican', delai: [35, 50], rotation: 12, autonomie: 150, long: 100, larg: 25, retardant: false, cap: '6 tonnes d\'eau' },
    'Dash 8': { ind: 'Milan', delai: [20, 30], rotation: 45, autonomie: 240, long: 150, larg: 30, retardant: true, cap: '10 tonnes de retardant' },
  };
  const DIRS = ['nord', 'nord-est', 'est', 'sud-est', 'sud', 'sud-ouest', 'ouest', 'nord-ouest'];
  AV.init = function (api) { A = api; };

  // ------------------------------------------------------------- fenetre unique (file d'attente)
  const FEN = { file: [], ouverte: null };
  function ouvreFen(id, rendu, prio) {
    if (FEN.ouverte === id) { rendu(); return; }
    if (FEN.ouverte) { if (!FEN.file.some(f => f.id === id)) { if (prio) FEN.file.unshift({ id, rendu }); else FEN.file.push({ id, rendu }); } return; }
    FEN.ouverte = id; rendu(); $('#fenetre').hidden = false;
  }
  function fermeFen() { $('#fenetre').hidden = true; FEN.ouverte = null; const n = FEN.file.shift(); if (n) setTimeout(() => ouvreFen(n.id, n.rendu), 50); }

  // ------------------------------------------------------------- demande, arrivee
  AV.demande = function (type, n) {
    const T = TYPES[type], G = A.G, k = AV.avions.filter(a => a.type === type).length;
    for (let i = 0; i < (n || 1); i++) AV.avions.push({ id: `${T.ind} ${31 + k + i}`, type, etat: 'engage', tArrivee: G.t + (T.delai[0] + G.R() * (T.delai[1] - T.delai[0])) * 60 + i * 45, x: A.carte.W + 3000, y: -2000, largages: 0 });
    A.radio('CODIS 33', 'CDG Salles', `${n || 1} ${type} engagé(s) par le COZ, indicatif ${T.ind}. Ils vous contacteront sur le canal 18. Arrivée estimée dans ${T.delai[0]} à ${T.delai[1]} min.`, 'GRP 272', 'codis');
  };
  function pilote(a, txt) { AV.chat.push({ de: a ? a.id : 'Pilote', txt, t: A.G.t, pil: true }); A.radio(a ? a.id : 'Pilote', 'COS ' + A.commune(), txt, 'Canal 18'); if (FEN.ouverte === 'air') rendChat(); }
  AV.pas = function (dt) {
    const G = A.G;
    for (const a of AV.avions) {
      if (a.etat === 'engage' && G.t >= a.tArrivee - 5 * 60) {
        a.etat = 'approche';
        pilote(a, `COS ${A.commune()} de ${a.id}, ${a.type}, ${TYPES[a.type].cap}, à 5 minutes de votre zone, j'écoute.`);
      }
      if (a.etat === 'approche' && G.t >= a.tArrivee) { a.etat = 'zone'; a.tFin = G.t + TYPES[a.type].autonomie * 60; if (!a.ordre) pilote(a, AV.pecFaite ? `${a.id} sur zone, j'ai les obstacles de mon leader. Même objectif ou nouvel objectif ?` : `${a.id} sur zone, en orbite, j'attends vos consignes.`); }
      if (a.etat === 'zone' && a.ordre && G.t >= a.ordre.t) largue(a);
      if (a.etat === 'rotation' && G.t >= a.tRetour) { a.etat = 'zone'; pilote(a, `${a.id} de retour sur zone, j'attends un objectif.`); }
      if ((a.etat === 'zone' || a.etat === 'rotation') && a.tFin && G.t > a.tFin) { a.etat = 'parti'; pilote(a, `${a.id} en limite d'autonomie, je quitte la zone.`); }
      const cible = a.ordre ? a.ordre.milieu : a.etat === 'rotation' || a.etat === 'parti' ? [A.carte.W + 4000, -3000] : [G.ix + 400 * Math.cos(G.t / 40), G.iy + 400 * Math.sin(G.t / 40)];
      if (a.etat !== 'engage') { const dx = cible[0] - a.x, dy = cible[1] - a.y, d = Math.hypot(dx, dy), v = 75 * dt; if (d > 1) { a.x += dx / d * Math.min(d, v); a.y += dy / d * Math.min(d, v); a.cap = Math.atan2(dx, dy); } }
    }
  };

  // ------------------------------------------------------------- conversation air-sol
  AV.ouvreChat = function () {
    if (!AV.avions.some(a => a.etat !== 'engage' && a.etat !== 'parti')) { A.info('Aucun avion sur la fréquence air-sol pour le moment.'); return; }
    ouvreFen('air', rendChat);
  };
  function rendChat() {
    const el = $('#fenetre');
    const actifs = AV.avions.filter(a => a.etat !== 'engage' && a.etat !== 'parti');
    const brouillon = $('#air-txt') ? $('#air-txt').textContent : '';
    el.innerHTML = `<h2>Air-sol · canal 18</h2>
      <p class="aide">${actifs.map(a => `${esc(a.id)} (${esc(a.type)}, ${{ approche: 'en approche', zone: a.ordre ? 'largage programmé' : 'sur zone', rotation: 'en rotation' }[a.etat] || a.etat})`).join(' · ')}</p>
      <div class="chat" id="chat">${AV.chat.slice(-30).map(m => `<div class="${m.pil ? 'pil' : 'cos'}"><small>${esc(m.de)} · ${A.hm(m.t)}</small>${esc(m.txt)}</div>`).join('')}</div>
      <div class="form"><div id="air-txt" class="transcrit" contenteditable="true" aria-label="Votre message au pilote">${esc(brouillon)}</div>
      <div class="btns"><button class="btn" id="air-ok">Transmettre</button><button class="btn sec" id="air-voix">Parler</button><button class="btn sec" id="air-carte">Montrer l'objectif sur la carte</button><button class="btn sec" id="air-x">Fermer</button></div></div>`;
    const c = $('#chat'); c.scrollTop = c.scrollHeight;
    $('#air-ok').onclick = () => { const t = $('#air-txt').textContent.trim(); if (t) { $('#air-txt').textContent = ''; cos(t); } };
    $('#air-txt').onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#air-ok').click(); } };
    $('#air-x').onclick = fermeFen;
    $('#air-carte').onclick = () => { AV.ligne = []; A.outil('largage', 'Cliquez le début puis la fin de la zone de largage.'); };
    $('#air-voix').onclick = () => A.dicte(t => { const z = $('#air-txt'); if (z) z.textContent = t; });
    setTimeout(() => { const t = $('#air-txt'); if (t && document.activeElement !== t) t.focus(); }, 30);
  }
  AV.clic = function (x, y) {
    AV.ligne = AV.ligne || []; AV.ligne.push([x, y]);
    if (AV.ligne.length < 2) return false;
    AV.ligneCarte = AV.ligne; AV.ligne = null;
    A.info('Zone de largage désignée : décrivez l\'objectif au pilote puis donnez l\'autorisation.');
    return true;
  };
  // objectif decrit en mots -> ligne de largage sur le feu
  function objectifDepuisTexte(t, a) {
    const F = A.F(), b = F.bilan(); if (!b.actifs.length) return null;
    const wx = F.wx, wy = F.wy;
    let tete = null, ax = -1e18;
    const pts = b.actifs.map(i => F.xy(i));
    for (const [x, y] of pts) { const v = x * wx + y * wy; if (v > ax) { ax = v; tete = [x, y]; } }
    let cx = 0, cy = 0; pts.forEach(([x, y]) => { cx += x; cy += y; }); cx /= pts.length; cy /= pts.length;
    const lat = (x, y) => (x - cx) * wy - (y - cy) * wx;       // > 0 : a droite en regardant la tete
    const T = TYPES[a ? a.type : 'Canadair'], L = T.long;
    let m, dir;
    const g = /gauche|\bavg\b|\bfg\b/.test(t), d = /droit|\bavd\b|\bfd\b/.test(t);
    if (/tete|front/.test(t)) {
      const off = g ? -L * 0.6 : d ? L * 0.6 : 0;
      m = [tete[0] + wy * off + (T.retardant ? wx * 200 : 0), tete[1] - wx * off + (T.retardant ? wy * 200 : 0)]; dir = [wy, -wx];
    } else if (/flanc|milieu/.test(t)) {
      const side = pts.filter(([x, y]) => (d ? lat(x, y) > 0 : lat(x, y) < 0));
      const ref = side.length ? side : pts; let sx = 0, sy = 0; ref.forEach(([x, y]) => { sx += x; sy += y; });
      m = [sx / ref.length, sy / ref.length]; dir = [wx, wy];
    } else if (/origine|queue|arriere/.test(t)) {
      m = [A.G.ix, A.G.iy]; dir = [wy, -wx];
    } else return null;
    return { p: [m[0] - dir[0] * L / 2, m[1] - dir[1] * L / 2], q: [m[0] + dir[0] * L / 2, m[1] + dir[1] * L / 2], obj: (/tete|front/.test(t) ? 'tête' : /flanc|milieu/.test(t) ? 'flanc' : 'origine') + (g ? ' gauche' : d ? ' droit' : '') };
  }
  function distSeg(p, a, b) { const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L)); return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy); }

  // ------------------------------------------------------------- pilote a regles : prise en compte du POMAR
  const ORDRE_PTS = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 'p10'];
  const RELANCE = {
    p2: 'Vous avez un adjoint sur le chantier ?', p3: 'Donnez-moi votre position.', p5: 'Des obstacles sur zone ?',
    p6: 'Quelle est la situation ?', p7: 'Quel objectif et quelle mission ?', p8: 'J\'attends « personnel en sécurité, autorisation de largage ».',
  };
  const pris = () => ['Pris en compte', 'Reçu, pris en compte', 'Bien reçu'][Math.floor(A.G.R() * 3)];
  function avionVise(t) {
    const m = t.match(/(pelican|milan) ?(\d+)/);
    if (m) { const a = AV.avions.find(x => norm(x.id).replace(/\s+/g, ' ') === `${m[1]} ${m[2]}`); if (a) return a; }
    return AV.avions.find(x => x.etat === 'zone' && !x.ordre) || AV.avions.find(x => x.etat === 'zone' || x.etat === 'approche') || AV.avions.find(x => x.etat === 'rotation') || AV.avions[0];
  }
  // position du COS : orientation + distance, carre DFCI, ou lieu-dit
  function lirePosition(t) {
    const G = A.G;
    const vrai = A.cap(G.cdg.x - G.ix, G.cdg.y - G.iy), dv = Math.hypot(G.cdg.x - G.ix, G.cdg.y - G.iy), dirVraie = DIRS[Math.round(vrai / 45) % 8];
    const dirM = DIRS.slice().sort((x, y) => y.length - x.length).find(x => new RegExp(`\\b${x.replace('-', '[- ]')}\\b`).test(t));
    const distM = t.match(/(\d+(?:[.,]\d+)?) ?(m|metres?|km|kilometres?)\b/);
    if (dirM && distM) {
      const dist = parseFloat(distM[1].replace(',', '.')) * (/^k/.test(distM[2]) ? 1000 : 1), i0 = DIRS.indexOf(dirVraie);
      const ok = [dirVraie, DIRS[(i0 + 1) % 8], DIRS[(i0 + 7) % 8]].includes(dirM) && Math.abs(dist - dv) < Math.max(250, dv * 0.4);
      return { dit: `${dirM} du feu, ${Math.round(dist)} m`, vrai: `${dirVraie}, ${Math.round(dv)} m de l'origine`, ok };
    }
    const car = t.match(/\b([a-z]{2}) ?(\d{3})\b/);
    if (car && /suis|position|trouve|sommes/.test(t)) { const c = (car[1] + ' ' + car[2]).toUpperCase(), vr = A.dfci(G.cdg.x, G.cdg.y); return { dit: `carré ${c}`, vrai: `carré ${vr}`, ok: c === vr }; }
    for (const l of A.carte.lieux) { const n = norm(l.n); if (n.length > 4 && t.includes(n) && /suis|position|trouve|sommes/.test(t)) { const d = Math.hypot(l.p[0] - G.cdg.x, l.p[1] - G.cdg.y); return { dit: `lieu-dit ${l.n}`, vrai: `à ${Math.round(d)} m de ${l.n}`, ok: d < 700 }; } }
    return null;
  }
  function cos(txt) {
    const G = A.G, t = norm(txt), P = AV.points, rep = [], niv = G.nivK;
    AV.chat.push({ de: 'COS ' + A.commune(), txt, t: G.t }); A.radio('COS ' + A.commune(), 'Air-sol', txt, 'Canal 18');
    const a = avionVise(t);
    const nouveau = k => { if (P[k] == null) P[k] = G.t; };
    let compris = false;
    if (/repete|repetez|pas compris/.test(t) && AV.dernier) { pilote(a, AV.dernier); return; }
    if (/annul|stop|arret(ez)? (le )?largage|ne larguez pas|interdi/.test(t)) {
      const vis = AV.avions.filter(x => x.ordre); vis.forEach(x => { x.ordre = null; });
      return dit(a, vis.length ? 'Largage annulé, pris en compte. Je reste en orbite, j\'attends vos consignes.' : 'Pris en compte, aucun largage programmé.');
    }
    if (/fin de mission|liberez|vous pouvez rentrer|vous etes libere/.test(t)) { AV.avions.filter(x => x.etat !== 'parti').forEach(x => { x.etat = 'parti'; x.ordre = null; }); return dit(a, 'Pris en compte, fin de mission, je quitte la zone. Bon courage au sol.'); }
    if (/bonjour|salut|de cos/.test(t)) { nouveau('p1'); rep.push('Bonjour COS'); compris = true; }
    if (/delegu|adjoint|je confie|veille (le )?codis|mon second/.test(t)) { nouveau('p2'); rep.push('adjoint pris en compte'); compris = true; }
    const pos = lirePosition(t.replace(/\b(de |du )?cos [a-z-]+( [a-z-]+)?/g, ' ').replace(/^\s*\w+( \d+)? de\b/, ' '));
    if (pos) { nouveau('p3'); AV.evPos = pos; rep.push(pos.ok ? 'position prise en compte, je vous ai en visuel' : 'position prise en compte… je ne vous vois pas, confirmez votre position'); compris = true; }
    if (/guid/.test(t)) { nouveau('p4'); rep.push('guidage pris en compte'); compris = true; }
    if (/obstacle|ligne|pylone|relais|antenne|eolienne|cable|neant|r ?a ?s\b|rien a signaler/.test(t) && !/ligne d appui/.test(t)) {
      nouveau('p5'); AV.obsDits = AV.obsDits || [];
      for (const o of A.obstaclesProches(2500)) if ((/ligne|haute tension|\bht\b|hta|kv/.test(t) && /ligne/i.test(o.n)) || (/relais|antenne|pylone/.test(t) && /relais/i.test(o.n))) if (!AV.obsDits.includes(o.n)) AV.obsDits.push(o.n);
      const rien = /pas d obstacle|aucun obstacle|neant|rien a signaler|\br ?a ?s\b/.test(t);
      AV.obsRien = rien;
      rep.push(rien ? 'pas d\'obstacle, pris en compte' : 'obstacles pris en compte' + (AV.obsDits.length ? ', je les ai en visuel' : ''));
      compris = true;
    }
    if (/vent|hectare|\bha\b|propag|uiff|engins|moyens|feu de|situation/.test(t) && !/tete|flanc|origine/.test(t)) { nouveau('p6'); rep.push('situation prise en compte'); compris = true; }
    if (/tete|flanc|origine|milieu|queue|\bavg\b|\bavd\b/.test(t)) {
      let obj = objectifDepuisTexte(t.replace(/\bavg\b/, 'tete gauche').replace(/\bavd\b/, 'tete droit'), a);
      if (AV.ligneCarte) { obj = Object.assign(obj || { obj: 'zone désignée' }, { p: AV.ligneCarte[0], q: AV.ligneCarte[1] }); AV.ligneCarte = null; }
      if (obj) {
        nouveau('p7');
        const mission = /appui|barriere|retardant/.test(t) ? 'ligne d\'appui au retardant' : /attaque|noy|eteindre|directe/.test(t) ? 'attaque directe' : a && TYPES[a.type].retardant ? 'ligne d\'appui au retardant' : 'attaque directe';
        obj.mission = mission; AV.objectif = obj;
        rep.push(`objectif ${obj.obj}, mission ${mission}, pris en compte`);
      } else rep.push(A.F().bilan().actifs.length ? 'je ne vois pas de feu actif à cet endroit, précisez l\'objectif' : 'je ne vois plus de front actif, le feu semble fixé. Voulez-vous un largage de noyage ou fin de mission ?');
      compris = true;
    } else if (/meme objectif|suivez (le )?leader|comme (le|votre) leader/.test(t) && AV.dernierObjectif) { AV.objectif = Object.assign({}, AV.dernierObjectif); rep.push('même objectif que le leader, pris en compte'); compris = true; }
    if (/silence radio/.test(t)) { nouveau('p9'); rep.push('silence radio pris en compte'); compris = true; }
    if (/rotation|autonomie|retour|combien de temps/.test(t)) { nouveau('p10'); if (a) rep.push(`rotation ${TYPES[a.type].rotation} minutes, autonomie ${String(Math.round(TYPES[a.type].autonomie / 6) / 10).replace('.', ',')} heures`); compris = true; }
    if (/evolution|effet|resultat/.test(t) && AV.dernierEffet) { rep.push(AV.dernierEffet); compris = true; }
    const autorise = /personnel en securite/.test(t) && /autoris/.test(t);
    if (/autoris/.test(t) && !autorise) { rep.push('confirmez « personnel en sécurité, autorisation de largage »'); compris = true; }
    if (autorise) {
      nouveau('p8'); compris = true;
      if (!AV.objectif) rep.push('je n\'ai pas d\'objectif, précisez');
      else {
        const o = AV.objectif, dans = G.unites.filter(u => u.x != null && distSeg([u.x, u.y], o.p, o.q) < 80);
        if (dans.length) AV.touches = dans;
        const libres = AV.avions.filter(x => x.etat === 'zone' && !x.ordre), cand = libres.length ? libres : AV.avions.filter(x => x.etat === 'approche');
        cand.forEach((x, i) => { x.ordre = { p: o.p, q: o.q, obj: o.obj, milieu: [(o.p[0] + o.q[0]) / 2, (o.p[1] + o.q[1]) / 2], t: Math.max(G.t + 90 + i * 40, x.tArrivee || 0) }; });
        rep.push(libres.length ? 'autorisation de largage prise en compte, je largue dans 2 minutes' : 'autorisation prise en compte, je largue dès mon arrivée sur zone');
        if (!AV.pecFaite) evaluePEC();
        AV.dernierObjectif = o; AV.objectif = null;
      }
    }
    if (!compris) return dit(a, 'Je n\'ai pas compris, répétez.');
    // relance sur le point suivant (guidee en debutant, minimale en expert)
    let suite = '';
    if (!autorise || !AV.objectif) {
      const manque = ORDRE_PTS.find(k => P[k] == null && RELANCE[k] && (niv === 'debutant' || (niv === 'intermediaire' && ['p3', 'p5', 'p7', 'p8'].includes(k)) || (k === 'p7' && P.p6 != null) || (k === 'p8' && P.p7 != null)));
      if (manque && !(autorise && AV.dernierObjectif)) suite = ' ' + RELANCE[manque];
      if (AV.objectif && P.p8 != null && !autorise) suite = ' ' + RELANCE.p8;
      if (AV.objectif && P.p8 == null) suite = ' ' + RELANCE.p8;
    }
    if (autorise && AV.dernierObjectif && !AV.objectif && AV.avions.some(x => x.ordre)) suite = ' Je passe en silence radio jusqu\'au largage.';
    const phrase = rep.join(', ');
    dit(a, phrase.charAt(0).toUpperCase() + phrase.slice(1) + '.' + suite);
  }
  function dit(a, txt) { const m = `${a ? a.id + ', ' : ''}${txt}`; AV.dernier = m; pilote(a, m); }
  function evaluePEC() {
    AV.pecFaite = true;
    const P = AV.points, ev = A.evalue;
    const it = [['p1', 'ABE 1. Accueil', 'mi'], ['p2', 'ABE 2. Délégation du chantier à un adjoint', 'ko'], ['p4', 'ABE 4. Guidage si nécessaire', null], ['p6', 'ABE 6. Situation (feu, moyens, vent)', 'mi'], ['p7', 'ABE 7. Objectif et mission', 'ko']];
    for (const [k, n, sinon] of it) if (P[k] != null) ev('rto', n, 'annoncé', 'ok'); else if (sinon) ev('rto', n, 'non annoncé', sinon);
    if (AV.evPos) ev('rto', 'ABE 3. Position du COS', `${AV.evPos.dit} (réel : ${AV.evPos.vrai})`, AV.evPos.ok ? 'ok' : 'ko', 'Orientation et distance par rapport à un point remarquable ou à l\'origine du feu.');
    else ev('rto', 'ABE 3. Position du COS', 'non donnée', 'ko');
    const obs = A.obstaclesProches(2500);
    if (obs.length) ev('rto', 'ABE 5. Obstacles', P.p5 != null ? `annoncés (${(AV.obsDits || []).length} / ${obs.length} identifiés)` : `non annoncés : ${obs.map(o => o.n).join(', ')}`, P.p5 != null && (AV.obsDits || []).length ? 'ok' : P.p5 != null ? 'mi' : 'ko', 'Lignes HT, pylônes, relais : position, distance, orientation.');
    const ordre = ['p1', 'p3', 'p5', 'p7', 'p8'].filter(k => P[k] != null).map(k => P[k]);
    if (ordre.some((v, i) => i && v < ordre[i - 1])) ev('rto', 'ABE : ordre des 10 points', 'ordre non respecté', 'mi', 'Accueil, délégation, position, guidage, obstacles, situation, objectif, sécurité, silence, rotation.');
    if (AV.touches && AV.touches.length) ev('rto', 'ABE 8. Personnel en sécurité', `autorisation donnée avec ${AV.touches.map(u => u.label).join(', ')} dans la zone de largage`, 'ko', 'Faire dégager la zone avant d\'autoriser.');
    else ev('rto', 'ABE 8. Personnel en sécurité, autorisation de largage', 'donnée, zone dégagée', 'ok');
  }
  function largue(a) {
    const T = TYPES[a.type], { p, q } = a.ordre, F = A.F();
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
    if (!AV.pec910) { AV.pec910 = true; const P = AV.points; A.evalue('rto', 'ABE 9. Silence radio', P.p9 != null ? 'demandé' : 'non demandé', P.p9 != null ? 'ok' : 'mi'); A.evalue('rto', 'ABE 10. Évolution, rotation, autonomie', P.p10 != null ? 'demandées' : 'non demandées', P.p10 != null ? 'ok' : 'mi'); }
    const actifsPres = F.bilan().actifs.filter(i => { const [x, y] = F.xy(i); return distSeg([x, y], a0, a1) < 120; }).length;
    AV.dernierEffet = T.retardant ? `ligne de retardant posée sur ${Math.round(l)} mètres, ${actifsPres ? 'le front est à moins de 120 mètres' : 'le front n\'est pas encore au contact'}` : n > 8 ? `largage au contact, flammes abattues sur ${Math.round(l)} mètres` : n > 0 ? 'largage partiellement au contact' : 'largage hors du front actif, peu d\'effet';
    pilote(a, `${a.id}, largage effectué, ${a.ordre.obj} : ${AV.dernierEffet}. Je pars en rotation, retour dans ${T.rotation} minutes.`);
    if (AV.touches && AV.touches.length) {
      for (const u of AV.touches) A.radio(u.ca, 'CDG Salles', 'Nous avons pris le largage ! Pare-brise étoilé, un équipier contusionné, personnel choqué.', 'DIR 654', 'alerte');
      AV.touches = null;
    }
    a.ordre = null; a.etat = 'rotation'; a.tRetour = A.G.t + T.rotation * 60;
  }
  AV.panneau = function () {
    if (!AV.avions.length) return '';
    return `<h3>Moyens aériens (canal 18)</h3>${AV.avions.map(a => `<div class="unite"><header><b>${esc(a.id)}</b><span class="st">${esc(a.type)} · ${{ engage: 'en route', approche: 'en approche', zone: a.ordre ? 'largage programmé' : 'sur zone', rotation: 'rotation, retour ' + A.hm(a.tRetour), parti: 'reparti' }[a.etat]}</span></header><small class="aide">${a.largages} largage(s)${a.tFin ? ' · autonomie jusqu\'à ' + A.hm(a.tFin) : ''}</small></div>`).join('')}<div class="btns"><button class="btn sec" id="b-air">Ouvrir l'air-sol</button></div>`;
  };
  AV.bindPanneau = function (root) { const b = root.querySelector('#b-air'); if (b) b.onclick = AV.ouvreChat; };
  AV.dessine = function (ctx, vue) {
    for (const l of AV.largages) {
      const age = A.G.t - l.t; if (age > (l.retardant ? 3600 : 900)) continue;
      ctx.strokeStyle = l.retardant ? 'rgba(220,38,38,.55)' : 'rgba(59,130,246,.55)'; ctx.lineWidth = Math.max(4, 28 * vue.s); ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(vue.sx(l.a0[0]), vue.sy(l.a0[1])); ctx.lineTo(vue.sx(l.a1[0]), vue.sy(l.a1[1])); ctx.stroke(); ctx.lineCap = 'butt';
    }
    const zl = AV.ligneCarte || (AV.ligne && AV.ligne.length === 1 && A.G.souris ? [AV.ligne[0], A.G.souris] : null);
    if (zl) { ctx.strokeStyle = '#2563eb'; ctx.lineWidth = 3; ctx.setLineDash([8, 5]); ctx.beginPath(); ctx.moveTo(vue.sx(zl[0][0]), vue.sy(zl[0][1])); ctx.lineTo(vue.sx(zl[1][0]), vue.sy(zl[1][1])); ctx.stroke(); ctx.setLineDash([]); }
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

  // ============================================================= appels de detresse (par la radio)
  const DT = {
    encercle: { titre: 'CCF pris par le feu', mayday: true, msg: (u, c) => `Mayday, Mayday, Mayday ! De ${u.ca}, CCF pris par le feu en ${c}, saute de feu derrière nous, nous passons en autoprotection !`, gravite: 'Équipage brûlé, CCF détruit.' },
    blesse: { titre: 'Sapeur-pompier blessé', msg: (u, c) => `Urgent, urgent ! De ${u.ca}, un équipier a chuté du CCF dans les souches en ${c}, suspicion de fracture de jambe.`, gravite: 'Évacuation retardée, état du blessé aggravé.' },
    embourbe: { titre: 'CCF immobilisé devant le feu', msg: (u, c) => `Urgent ! De ${u.ca}, CCF embourbé dans une craste en ${c}, le front arrive sur nous à 150 mètres !`, gravite: 'CCF détruit, équipage évacué à pied in extremis.' },
    malaise: { titre: 'Coup de chaleur', msg: (u, c) => `De ${u.ca}, un équipier fait un malaise en ${c}, coup de chaleur probable, il est confus.`, gravite: 'Aggravation, hospitalisation en réanimation.' },
  };
  const DE = { prevues: [], encours: null };
  DE.init = function () {
    const G = A.G, n = G.nivK === 'expert' ? (G.R() < 0.7 ? 1 : 0) : G.nivK === 'intermediaire' ? (G.R() < 0.4 ? 1 : 0) : 0;
    for (let i = 0; i < n; i++) DE.prevues.push(20 * 60 + G.R() * 30 * 60);
  };
  DE.pas = function () {
    const G = A.G;
    if (DE.encours) { if (G.t - DE.encours.t > 6 * 60) conclut(); return; }
    if (!DE.prevues.length || G.tEngage1 == null || G.t - G.tEngage1 < DE.prevues[0]) return;
    const engages = G.unites.filter(u => u.x != null && u.type === 'UIFF' && u.etat === 'engage' && u.mission && u.mission !== 'attente');
    if (!engages.length) return;
    DE.prevues.shift();
    const u = engages[Math.floor(G.R() * engages.length)], ks = Object.keys(DT), k = ks[Math.floor(G.R() * ks.length)], c = A.dfci(u.x, u.y);
    DE.encours = { k, u, t: G.t, c, ar: null, prot: null, codis: null };
    u.mission = 'attente'; u.detresse = true;
    if (k === 'encercle' || k === 'embourbe') A.F().traite(u.x, u.y, 25, 'mouille', 150);
    A.radio(u.ca, 'CDG Salles', DT[k].msg(u, c), 'DIR 654', 'alerte');
  };
  DE.vu = function () {};
  // chaque message du COS est examine pendant une detresse
  DE.message = function (canal, txt) {
    const d = DE.encours; if (!d) return;
    const t = norm(txt), G = A.G, num = (d.u.label.match(/UIFF (\d+)/) || [])[1];
    if (canal === 'DIR 654' && d.ar == null && (/recu|compris|j arrive|on arrive|precisez|etat/.test(t) || (num && new RegExp(`uiff ?${num}\\b`).test(t)))) d.ar = G.t;
    if (canal === 'DIR 654' && d.prot == null && /protection|portez|degag|secours|rejoignez|appui|arrosez|ouvrez/.test(t)) {
      d.prot = G.t; if (d.ar == null) d.ar = G.t;
      const n = (t.match(/uiff ?(\d+)/g) || []).map(x => +x.replace(/\D/g, '')).find(x => String(x) !== num);
      const v = (n && G.unites.filter(x => x.type === 'UIFF')[n - 1]) || G.unites.filter(x => x !== d.u && x.x != null && x.type === 'UIFF' && !x.detresse).sort((a, b) => Math.hypot(a.x - d.u.x, a.y - d.u.y) - Math.hypot(b.x - d.u.x, b.y - d.u.y))[0];
      if (v && v !== d.u && v.x != null) { v.mission = 'defense'; v.cible = [d.u.x, d.u.y]; v.etat = 'engage'; A.allerA(v, d.u.x, d.u.y, true); setTimeout(() => A.radio(v.ca, 'CDG Salles', `Reçu, je me porte en protection de ${d.u.label}.`, 'DIR 654'), 300); }
    }
    if (canal === 'GRP 272' && d.codis == null && /mayday|urgent|detresse|blesse|vsav|smur|secours|accident|malaise|evacu/.test(t)) d.codis = G.t;
    if (d.ar != null && d.codis != null && (d.prot != null || d.k === 'malaise' || d.k === 'blesse')) conclut();
  };
  function conclut() {
    const d = DE.encours, T = DT[d.k];
    const dAR = d.ar != null ? d.ar - d.t : null, dP = d.prot != null ? d.prot - d.t : null, dC = d.codis != null ? d.codis - d.t : null;
    const besoinProt = d.k === 'encercle' || d.k === 'embourbe';
    const bon = dAR != null && dAR < 90 && dC != null && dC < 240 && (!besoinProt || (dP != null && dP < 180));
    const det = [`accusé de réception ${dAR != null ? 'en ' + Math.round(dAR) + ' s' : 'absent'}`, besoinProt ? `protection ${dP != null ? 'ordonnée en ' + Math.round(dP) + ' s' : 'non ordonnée'}` : null, `message au CODIS ${dC != null ? 'en ' + Math.round(dC) + ' s' : 'non passé'}`].filter(Boolean).join(' ; ');
    A.evalue('rto', `Détresse : ${T.titre}`, det, bon ? 'ok' : (dAR != null && dC != null) ? 'mi' : 'ko', `Prendre en compte immédiatement sur la DIR 654 (« reçu », position, état), engager un moyen en protection si l'équipage est menacé, passer un message ${T.mayday ? 'Mayday' : 'urgent'} au CODIS avec la demande de secours.`);
    A.radio(d.u.ca, 'CDG Salles', bon ? 'Situation rétablie, équipage en sécurité.' : T.gravite, 'DIR 654', bon ? '' : 'alerte');
    if (bon && (d.k === 'blesse' || d.k === 'malaise')) A.radio('CODIS 33', 'CDG Salles', 'VSAV et SMUR engagés vers votre point d\'engagement.', 'GRP 272', 'codis');
    d.u.detresse = false;
    if (!bon && besoinProt) { d.u.eau = 0; d.u.etat = 'hors service'; d.u.mission = null; }
    DE.encours = null;
  }
  DE.actif = () => !!DE.encours;
  window.AVIONS = AV; window.DETRESSE = DE;
})();
