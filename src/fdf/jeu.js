// =============================================================================
// Feu de foret FDF3 : deroulement de l'intervention du chef de groupe.
// Phases : DPIF, analyse de la ZI sur carte, transit (« je vois »), message
// d'arrivee, reconnaissance, actions reflexes, messages (ambiance, CR, feu
// eteint) et raisonnement tactique (ordres aux UIFF). Debriefing a la fin.
// Doctrine et formats : memento FDF SDIS 33 (2025), fiches GOP 1.2.1 a 1.2.3,
// transmissions FDF (GRP 272, DIR 654, DIR du groupement, canaux air-sol 18 / 23).
// =============================================================================
(function () {
  'use strict';
  const $ = s => document.querySelector(s), $$ = s => Array.from(document.querySelectorAll(s));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const hm = t => { const m = Math.floor(t / 60); return String(Math.floor(m / 60) % 24).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };

  const PHASES = [
    ['dpif', 'DPIF'], ['zi', 'Analyse ZI'], ['transit', 'En transit'], ['arrivee', 'Arrivée'],
    ['reco', 'Reconnaissance'], ['reflexes', 'Réflexes'], ['messages', 'Messages'], ['rto', 'RTO'], ['debrief', 'Débriefing'],
  ];
  // crayons de l'analyse ZI : couleurs conventionnelles SDIS 33 (rouge incendie, bleu eau, vert points sensibles,
  // orange points a preserver et obstacles aeriens POMAR, violet commandement et points de passage)
  const CRAYONS = [
    { n: 1, nom: 'Dimensionnement sommaire, zone du feu, panache (rouge : incendie)', court: 'Incendie', c: '#e2202a' },
    { n: 2, nom: 'Points sensibles à protéger, habitations (vert)', court: 'Points sensibles', c: '#16a34a' },
    { n: 3, nom: 'Accès, rocades, pénétrantes, points de passage (violet : commandement)', court: 'Accès, commandement', c: '#8b2fc9' },
    { n: 4, nom: 'Nature de la végétation (noir : annotations)', court: 'Végétation', c: '#111111' },
    { n: 5, nom: 'Points d\'eau, DECI (bleu : eau)', court: 'Eau', c: '#2563eb' },
    { n: 6, nom: 'Points à préserver, obstacles pour les avions (POMAR), enjeux (orange)', court: 'Préserver, obstacles', c: '#f08c2a' },
  ];
  const REFLEXES = [
    ['securite', 'Sécurité des personnels : cheminement de repli, zone refuge, EPI, autoprotection'],
    ['radio', 'Bascule sur la DIR 654 et contrôle radio avec les chefs d\'agrès'],
    ['engagement', 'Point d\'engagement des moyens désigné et transmis'],
    ['sensibles', 'Points sensibles menacés identifiés, protection ou mise en sécurité des personnes'],
    ['eau', 'Point d\'eau à activer identifié (permanence de l\'eau)'],
    ['moyens', 'Dimensionnement et demande de moyens'],
    ['autorites', 'Information des autorités et services (élus, DFCI, gendarmerie, Enedis)'],
    ['observation', 'Permanence de l\'observation : un observateur sur la tête du feu'],
  ];
  // CIS et accès au secteur (les CIS hors carte entrent par la route indiquee)
  const CIS = [
    { nom: 'Salles', p: null, delai: 0 },
    { nom: 'Belin-Béliet', p: [12500, 2600], delai: 9 * 60 },
    { nom: 'Le Barp', p: [12500, 9400], delai: 8 * 60 },
    { nom: 'Mios', p: [9000, 10750], delai: 8 * 60 },
    { nom: 'Sanguinet', p: [150, 2200], delai: 12 * 60 },
    { nom: 'Biganos', p: [6400, 10750], delai: 14 * 60 },
    { nom: 'Marcheprime', p: [12000, 10750], delai: 15 * 60 },
    { nom: 'Saint-Magne', p: [12500, 6000], delai: 13 * 60 },
  ];
  const CCF_L = 6000, DEBIT_LDV = 250;           // litres par CCF (6 000 L par defaut au SDIS 33), L/min par lance de tourelle (LDV 250)

  const G = window.G = {};
  let vue, ctxD, cvD, carte, F;
  let rythme = 1, last = 0, enCours = false;

  // =============================================================== demarrage
  async function init() {
    carte = await CARTE.charge();
    vue = new CARTE.Vue($('#fond'));
    cvD = $('#dessus'); ctxD = cvD.getContext('2d');
    for (const l of carte.lieux.filter(l => l.k !== 'hameau').map(l => l.n).sort()) { const o = document.createElement('option'); o.value = l; o.textContent = 'Près de ' + l; $('#c-lieu').appendChild(o); }
    $('#go').disabled = false; $('#go').textContent = 'Prendre l\'alerte';
    $('#go').onclick = demarre;
    bindUI();
    window.addEventListener('resize', resize); resize();
  }
  function resize() { vue.resize(); cvD.width = vue.cv.width; cvD.height = vue.cv.height; G.dirtyFond = true; }

  function rng(seed) { let a = seed | 0; return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  function choisitDepart(R, lieu) {
    const c = carte, ok = f => f >= 3 && f <= 11 && f !== 10;
    if (lieu !== 'alea') {
      const l = c.lieux.find(l => l.n === lieu);
      for (let k = 0; k < 400; k++) { const x = l.p[0] + (R() - 0.5) * 600, y = l.p[1] + (R() - 0.5) * 600; if (ok(CARTE.fuelAt(x, y))) return [x, y]; }
    }
    for (let k = 0; k < 5000; k++) {
      const x = 1200 + R() * (c.W - 2400), y = 1200 + R() * (c.H - 2400);
      if (!ok(CARTE.fuelAt(x, y))) continue;
      // pas en plein bourg
      let jar = 0; for (let a = 0; a < 12; a++) { const f = CARTE.fuelAt(x + Math.cos(a) * 250, y + Math.sin(a) * 250); if (f === 12 || f === 0) jar++; }
      if (jar < 4) return [x, y];
    }
    return [6000, 5000];
  }

  function demarre() {
    const seed = (Date.now() & 0xffff) || 7, R = rng(seed);
    const vent = $('#c-vent').value === 'alea' ? [3, 5, 6, 7, 8, 10, 12][Math.floor(R() * 7)] : +$('#c-vent').value;
    const dirs = [270, 250, 225, 300, 315, 0, 45, 90, 200];
    const dir = dirs[Math.floor(R() * dirs.length)] + Math.round((R() - 0.5) * 20);
    const sech = $('#c-sech').value;
    const [ix, iy] = choisitDepart(R, $('#c-lieu').value);
    Object.assign(G, {
      seed, R, vent, dir, sech, ix, iy, t: 0, heure0: (14 * 60 + 5 + Math.floor(R() * 90)) * 60, age: (12 + Math.floor(R() * 14)) * 60,
      phase: 0, faites: {}, evals: [], radio: [], dessins: [], unites: [], pe: {}, reflexes: {}, cr: 0, msgs: {}, vu: new Uint8Array(carte.w * carte.h),
      dirtyFond: true, sel: null, outil: null, crayon: null, demandes: [], lignes: [], fin: false, etatFeu: 'en cours', tFixe: null, tMaitrise: null,
    });
    F = G.feu = new FEU.Feu(carte, { vent, dir, secheresse: sech, graine: seed });
    F.allume(ix, iy, 0);
    F.avance(G.age);
    // cause du feu (indice a decouvrir pres de l'origine)
    const nearRoad = carte.routes.some(r => r.k === 'route' && r.p.some(p => Math.hypot(p[0] - ix, p[1] - iy) < 60));
    const f0 = CARTE.fuelAt(ix, iy);
    G.cause = nearRoad ? { cause: 'Accidentelle', origine: 'Jet d\'objet incandescent', indice: 'Mégot et traces de pneus sur l\'accotement, au bord de la route.' }
      : f0 === 4 ? { cause: 'Accidentelle', origine: 'Travaux forestiers', indice: 'Broyeur forestier encore chaud dans la coupe, le conducteur est sur place.' }
      : R() < 0.5 ? { cause: 'Inconnue', origine: '', indice: 'Aucun indice visible au point de départ.' }
      : { cause: 'Malveillance', origine: 'Pyromanie', indice: 'Deux départs distincts à 30 m l\'un de l\'autre, aucune activité à proximité.' };
    // depart : CDG (joueur) + 2 UIFF
    const casSalles = carte.sensibles.find(s => /Incendie et de Secours de Salles/.test(s.n));
    CIS[0].p = casSalles ? casSalles.p : [11000, 9300];
    G.cdg = { id: 'CDG', label: 'CDG Salles', x: CIS[0].p[0], y: CIS[0].p[1], path: null, v: 60 };
    const autre = CIS[1 + Math.floor(R() * 3)];
    ajouteUIFF(CIS[0], 60); ajouteUIFF(autre, 60 + autre.delai);
    // ticket de depart : la tour de guet peut se tromper d'un carre
    const off = R() < 0.35 ? [(R() < 0.5 ? -1 : 1) * 400, 0] : [0, 0];
    G.ticket = { commune: CARTE.commune(ix, iy), ld: CARTE.lieuDit(ix + off[0], iy), coord: CARTE.dfci(ix + off[0], iy + off[1]), source: 'tour de guet de Salles' };
    radio('CODIS 33', 'CDG Salles', `Départ feu de forêt. Commune de ${G.ticket.commune}, lieu-dit ${G.ticket.ld}, coordonnées ${G.ticket.coord}. Fumée signalée par la ${G.ticket.source}. Départ : CDG Salles, ${G.unites.map(u => u.label).join(', ')}.`, 'GRP 272', 'codis');
    document.body.classList.remove('accueil');
    vue.centre(G.cdg.x - 1500, G.cdg.y - 1500, 0.09);
    renderPhases(); renderPhase(); renderMoyens(); renderMemento(); renderCrayons(); majHUD();
    enCours = true; last = performance.now(); requestAnimationFrame(boucle);
  }

  function ajouteUIFF(cis, tArrivee) {
    const n = G.unites.length + 1;
    const u = { id: 'U' + n, label: `UIFF ${n} ${cis.nom}`, cis: cis.nom, ca: `CA UIFF ${n}`, x: null, y: null, eau: 2 * CCF_L, cap: 2 * CCF_L, etat: 'alerte',
      tDispo: G.t + tArrivee, mission: null, path: null, msg: '', cible: null, auPE: null, journal: [] };
    G.unites.push(u); return u;
  }

  // =============================================================== temps
  function boucle(now) {
    if (!enCours) return;
    const dt = Math.min(0.25, (now - last) / 1000); last = now;
    if (rythme > 0 && !G.fin) {
      G.acc = (G.acc || 0) + dt * rythme;
      while (G.acc >= 2) { pas(2); G.acc -= 2; }
    }
    dessine(now);
    requestAnimationFrame(boucle);
  }
  function heure() { return hm(G.heure0 + G.t); }

  function pas(dt) {
    G.t += dt;
    F.avance(G.age + G.t);
    deplace(G.cdg, dt);
    for (const u of G.unites) majUnite(u, dt);
    if (G.besoinReseed && G.t - (G.tReseed || 0) > 8) { F.reseed(); G.besoinReseed = false; G.tReseed = G.t; }
    if (Math.floor(G.t) % 10 === 0) observe();
    evenements();
    if (Math.floor(G.t) % 4 === 0) { G.dirtyFeu = true; majHUD(); }
  }

  // =============================================================== deplacements
  function allerA(o, x, y) {
    const r = CARTE.route(o.x, o.y, x, y); if (!r) return false;
    o.path = r.pts; o.pi = 1; o.dest = [x, y]; o.tTrajet = r.t; o.vit = r.L / r.t; return r;
  }
  function deplace(o, dt) {
    if (!o.path) return false;
    let d = (o.vit || 8) * dt;
    while (d > 0 && o.path) {
      const p = o.path[o.pi], dx = p.x - o.x, dy = p.y - o.y, L = Math.hypot(dx, dy);
      if (L <= d) { o.x = p.x; o.y = p.y; d -= L; o.pi++; if (o.pi >= o.path.length) { o.path = null; return true; } }
      else { o.x += dx / L * d; o.y += dy / L * d; d = 0; }
    }
    return false;
  }

  // =============================================================== observation (brouillard)
  function observe() {
    const obs = [G.cdg, ...G.unites.filter(u => u.x != null)];
    const c = carte, R = 300 / c.res;
    for (const o of obs) {
      const c0 = Math.floor(o.x / c.res), r0 = c.h - 1 - Math.floor(o.y / c.res);
      for (let dr = -R; dr <= R; dr++) for (let dc = -R; dc <= R; dc++) {
        if (dc * dc + dr * dr > R * R) continue; const cc = c0 + dc, rr = r0 + dr; if (cc < 0 || cc >= c.w || rr < 0 || rr >= c.h) continue;
        G.vu[rr * c.w + cc] = 1;
      }
    }
    if (G.c33) G.vu.fill(1);
    // indice de la cause
    if (!G.indiceVu && Math.hypot(G.cdg.x - G.ix, G.cdg.y - G.iy) < 120) { G.indiceVu = true; info('Point de départ du feu : ' + G.cause.indice); journal('Indice au point de départ : ' + G.cause.indice); }
  }

  // =============================================================== unites
  function majUnite(u, dt) {
    if (u.etat === 'alerte' && G.t >= u.tDispo) {
      const cis = CIS.find(c => c.nom === u.cis);
      u.x = cis.p[0]; u.y = cis.p[1]; u.etat = 'transit';
      const dest = G.ptEngagement || [G.cdg.x, G.cdg.y];
      allerA(u, dest[0], dest[1]);
      radio(u.ca, 'CODIS 33', `${u.label} en route.`, 'GRP 272');
    }
    if (u.x == null) return;
    const arrive = deplace(u, dt);
    if (arrive && u.etat === 'transit') {
      u.etat = 'attente';
      radio(u.ca, 'CDG Salles', `${u.label} au point d'engagement, ${Math.round(u.eau)} litres, j'attends vos ordres.`, G.dir654 ? 'DIR 654' : 'GRP 272');
    }
    if (arrive && u.etat === 'vers_pe') { u.etat = 'remplissage'; u.tRemp = G.t; }
    if (u.etat === 'remplissage') {
      const pe = G.pe[u.auPE], debit = pe ? pe.debit : 30;    // m3/h
      u.eau = Math.min(u.cap, u.eau + debit * 1000 / 3600 * dt);
      if (u.eau >= u.cap - 1) { u.etat = 'engage'; radio(u.ca, 'CDG Salles', `${u.label} plein, je réintègre ma mission.`, 'DIR 654'); u.path = null; if (u.retour) allerA(u, u.retour[0], u.retour[1]); }
      return;
    }
    if (!u.mission || u.etat !== 'engage') return;
    if (u.path) return;   // encore en approche
    action(u, dt);
  }

  // cellules de front actives proches d'un point
  function frontPres(x, y, r) {
    const c = carte, out = [], R = Math.ceil(r / c.res), c0 = Math.floor(x / c.res), r0 = c.h - 1 - Math.floor(y / c.res);
    for (let dr = -R; dr <= R; dr++) for (let dc = -R; dc <= R; dc++) {
      if (dc * dc + dr * dr > R * R) continue; const cc = c0 + dc, rr = r0 + dr; if (cc < 0 || cc >= c.w || rr < 0 || rr >= c.h) continue;
      const i = rr * c.w + cc; if (F.etat(i) === 1) out.push(i);
    }
    return out;
  }
  function intensiteLocale(cells) { let I = 0; for (const i of cells) I = Math.max(I, F.headIntensity(carte.fuel[i])); return I; }

  // cible de l'unite selon sa mission : point du front a rejoindre
  function cibleFront(u) {
    const b = F.bilan(); if (!b.actifs.length) return null;
    const wx = F.wx, wy = F.wy;
    // repere : axe du feu (sens du vent), gauche / droite en regardant vers la tete
    let best = null, bv = -1e18;
    for (const i of b.actifs) {
      const [x, y] = F.xy(i), ax = x * wx + y * wy, lat = x * wy - y * wx;   // lat > 0 : droite
      const d = Math.hypot(x - u.x, y - u.y);
      let v;
      if (u.mission === 'front' || u.mission === 'percee') v = ax * 3 - d * 0.6;
      else if (u.mission === 'flancG') v = -lat * 2 + ax * 0.5 - d * 0.8;
      else if (u.mission === 'flancD') v = lat * 2 + ax * 0.5 - d * 0.8;
      else if (u.mission === 'lisiere') v = -d;
      else v = -d;
      if (v > bv) { bv = v; best = [x, y]; }
    }
    return best;
  }

  function action(u, dt) {
    const m = u.mission;
    if (u.eau <= 0) { gereEau(u); return; }
    if (m === 'ligne') return actionLigne(u, dt);
    if (m === 'defense') return actionDefense(u, dt);
    if (m === 'attente') return;
    // attaques : rejoindre le front puis eteindre en progressant
    const cib = cibleFront(u); if (!cib) return;
    const d = Math.hypot(cib[0] - u.x, cib[1] - u.y);
    const vMarche = { front: 10, flancG: 30, flancD: 30, percee: 40, lisiere: 25 }[m] / 60;   // m/s en action
    const vApproche = 6 / 3.6;
    const v = d > 40 ? vApproche : vMarche;
    if (d > 5) { u.x += (cib[0] - u.x) / d * Math.min(d, v * dt); u.y += (cib[1] - u.y) / d * Math.min(d, v * dt); }
    if (d > 60) return;
    const cells = frontPres(u.x, u.y, 35);
    if (!cells.length) return;
    const I = intensiteLocale(cells);
    // memento : 1 UIFF tient 40 m de front (attaque de front / ligne d'appui) pour une intensite <= 7000 kW/m
    const eff = clamp(7000 / Math.max(I, 1), 0.08, 1);
    const portee = { front: 20, flancG: 15, flancD: 15, percee: 18, lisiere: 12 }[m] * Math.sqrt(eff) + 5;
    const n = F.traite(u.x, u.y, portee, 'eteint');
    F.traite(u.x, u.y, portee + 10, 'mouille', 90);
    if (n) G.besoinReseed = true;
    const conso = 2 * DEBIT_LDV / 60 * dt * (m === 'lisiere' ? 0.5 : 1);
    u.eau = Math.max(0, u.eau - conso);
    u.Ivu = I; u.actif = G.t;
    // securite : attaque de front sur un feu trop intense
    if ((m === 'front') && I > 12000 && !u.alerteSecu) {
      u.alerteSecu = true;
      radio(u.ca, 'CDG Salles', `Attaque de front impossible, intensité trop forte, flammes au-dessus des pins. Je me replie sur le flanc.`, 'DIR 654', 'alerte');
      evalue('rto', 'Attaque de front sur un front trop intense', `${Math.round(I)} kW/m (mémento : données valables jusqu'à 7 000 kW/m)`, 'ko', 'Préférer la ligne d\'appui, la percée de flanc ou le jalonnement.');
      u.mission = 'flancD';
    }
    if (u.eau < CCF_L && !u.alerteEau) gereEau(u);
  }

  function gereEau(u) {
    // permanence de l'eau : un CCF part au point d'eau pendant que l'autre poursuit (ou l'UIFF entiere si vide)
    const actifs = Object.values(G.pe).filter(p => p.actif);
    if (!actifs.length) {
      if (!u.alerteEau) { u.alerteEau = true; radio(u.ca, 'CDG Salles', `${u.label} : ${u.eau > 0 ? 'un CCF bientôt à sec' : 'à sec'}, aucun point d'eau activé.`, 'DIR 654', 'alerte'); }
      if (u.eau <= 0 && !u.penEau) { u.penEau = true; evalue('rto', 'Permanence de l\'eau', `${u.label} à sec à ${heure()} sans point d'eau activé`, 'ko', 'Activer un point d\'eau dès le message d\'ambiance (MPF jusqu\'à 3 UIFF, MPR ou MPRI au-delà).'); }
      return;
    }
    if (u.eau > 0 && u.eau >= CCF_L) return;
    let best = null, bt = 1e18;
    for (const p of actifs) { const r = CARTE.route(u.x, u.y, p.x, p.y); if (r && r.t < bt) { bt = r.t; best = p; } }
    if (!best) return;
    u.retour = [u.x, u.y]; u.auPE = best.n; u.etat = 'vers_pe'; allerA(u, best.x, best.y); u.alerteEau = false;
    radio(u.ca, 'CDG Salles', `${u.label} au point d'eau ${best.n} pour remplissage, ${Math.round(bt / 60)} min de trajet.`, 'DIR 654');
  }

  function actionLigne(u, dt) {
    const L = G.lignes.find(l => l.id === u.ligne); if (!L) return;
    const seg = u.segLigne; if (!seg) return;
    const [a, b] = seg, mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    if (Math.hypot(mx - u.x, my - u.y) > 30) { const d = Math.hypot(mx - u.x, my - u.y); u.x += (mx - u.x) / d * Math.min(d, 4 * dt); u.y += (my - u.y) / d * Math.min(d, 4 * dt); return; }
    // le feu approche : on noie la bande et on abat les flammes qui l'atteignent
    const cells = frontPres(mx, my, 120);
    if (!cells.length) return;
    const I = intensiteLocale(cells), eff = clamp(7000 / Math.max(I, 1), 0.08, 1);
    const Lt = Math.hypot(b[0] - a[0], b[1] - a[1]), Lc = Math.min(Lt, 40 * eff * (u.renfort || 1));
    const k = Math.max(1, Math.ceil(Lc / 10));
    for (let j = 0; j <= k; j++) {
      const t = 0.5 + (j / k - 0.5) * (Lc / Math.max(Lt, 1));
      const x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t;
      F.traite(x, y, 14, 'mouille', 240); const n = F.traite(x, y, 25, 'eteint'); if (n) G.besoinReseed = true;
    }
    G.besoinReseed = true;
    u.eau = Math.max(0, u.eau - 2 * DEBIT_LDV / 60 * dt); u.Ivu = I; u.actif = G.t;
    if (u.eau < CCF_L) gereEau(u);
  }
  function actionDefense(u, dt) {
    const [x, y] = u.cible; const d = Math.hypot(x - u.x, y - u.y);
    if (d > 20) { u.x += (x - u.x) / d * Math.min(d, 4 * dt); u.y += (y - u.y) / d * Math.min(d, 4 * dt); return; }
    const cells = frontPres(x, y, 160); if (!cells.length) return;
    for (let a = 0; a < 16; a++) F.traite(x + Math.cos(a / 16 * 2 * Math.PI) * 50, y + Math.sin(a / 16 * 2 * Math.PI) * 50, 15, 'mouille', 240);
    const n = F.traite(x, y, 70, 'eteint'); if (n) G.besoinReseed = true;
    G.besoinReseed = true;
    u.eau = Math.max(0, u.eau - 2 * DEBIT_LDV / 60 * dt); u.actif = G.t;
    if (u.eau < CCF_L) gereEau(u);
  }

  // =============================================================== evenements, etat du feu
  function evenements() {
    // points d'eau en cours d'activation
    for (const p of Object.values(G.pe)) if (!p.actif && G.t >= p.tActif) { p.actif = true; radio('Point Alpha', 'CDG Salles', `Point d'eau ${p.n} opérationnel (${p.moyen}, ${p.debit} m³/h).`, 'DIR 654'); }
    // renforts
    for (const d of G.demandes) if (!d.fait && G.t >= d.t) { d.fait = true; for (let k = 0; k < d.n; k++) { const cis = CIS[1 + ((G.unites.length + k) % (CIS.length - 1))]; ajouteUIFF(cis, cis.delai + k * 120); } radio('CODIS 33', 'CDG Salles', `${d.n} UIFF supplémentaire(s) engagée(s) vers votre point d'engagement.`, 'GRP 272', 'codis'); renderMoyens(); }
    // etat du feu : fixe (la tete n'avance plus), maitrise (plus de front actif), eteint (lisieres traitees)
    if (Math.floor(G.t) % 20 !== 0) return;
    const b = F.bilan(); G.bilan = b;
    G.histo = G.histo || []; G.histo.push({ t: G.t, ha: b.ha, front: b.front });
    if (G.etatFeu === 'en cours') {
      const h = G.histo, k = h.findIndex(e => e.t >= G.t - 300);
      if (G.tArrivee && b.front <= 20 && k >= 0 && b.ha - h[k].ha < 0.15) { G.etatFeu = 'fixé'; G.tFixe = G.t; journal('Le feu est fixé (la tête ne progresse plus).'); }
    }
    if (G.etatFeu === 'fixé' && b.actifs.length === 0) { G.etatFeu = 'maîtrisé'; G.tMaitrise = G.t; journal('Le feu est maîtrisé (plus de front actif).'); }
    if ((G.etatFeu === 'fixé' && b.front > 40) || (G.etatFeu === 'maîtrisé' && b.actifs.length > 3)) { G.etatFeu = 'en cours'; G.tFixe = null; journal('Reprise : le feu repart.'); radio('Chefs d\'agrès', 'CDG Salles', 'Reprise de feu en lisière !', 'DIR 654', 'alerte'); }
    // rappel des CR (toutes les 20 a 30 min)
    if (G.msgs.ambiance && !G.fin) {
      const dernier = G.tDernierMsg || G.msgs.ambiance.t;
      if (G.t - dernier > 30 * 60 && !G.rappelCR) { G.rappelCR = true; radio('CODIS 33', 'CDG Salles', 'Nous attendons votre message de compte rendu.', 'GRP 272', 'codis'); evalue('messages', 'Cadence des comptes rendus', 'plus de 30 min sans CR', 'ko', 'Mémento : un CR toutes les 20 à 30 min.'); }
    }
    // ambiance attendue 3 a 5 min apres l'arrivee
    if (G.tArrivee && !G.msgs.ambiance && G.t - G.tArrivee > 6 * 60 && !G.rappelAmb) { G.rappelAmb = true; radio('CODIS 33', 'CDG Salles', 'CDG Salles, nous attendons votre message d\'ambiance.', 'GRP 272', 'codis'); }
  }

  // =============================================================== radio, journal, evaluation
  function radio(de, a, txt, canal, cls) {
    G.radio.push({ t: G.t, de, a, txt, canal, cls: cls || (de === 'CDG Salles' ? 'moi' : '') });
    renderRadio(); const nb = $('#nb-radio'); if (nb && $('#o-radio').hidden) nb.textContent = '•';
    if (cls === 'alerte' || cls === 'codis') info(`${de} : ${txt}`);
  }
  function journal(txt) { G.radio.push({ t: G.t, de: 'Journal', a: '', txt, canal: 'journal', cls: '' }); renderRadio(); }
  function evalue(phase, item, detail, res, conseil) { G.evals.push({ phase, item, detail, res, conseil, t: G.t }); }
  function info(txt) { const el = $('#info'); el.textContent = txt; clearTimeout(info.k); info.k = setTimeout(() => { el.textContent = ''; }, 9000); }

  // =============================================================== verite terrain
  function categorieFeu() {
    // categorie dominante autour du point de depart (rayon 80 m)
    const cnt = {}; for (let a = 0; a < 24; a++) for (const r of [0, 40, 80]) { const c = CARTE.categorie(CARTE.fuelAt(G.ix + Math.cos(a) * r, G.iy + Math.sin(a) * r)); cnt[c] = (cnt[c] || 0) + 1; }
    return Object.entries(cnt).sort((a, b) => b[1] - a[1]).map(e => e[0]);
  }
  function prevision(minutes) {
    // simulation sans lutte a partir de l'etat actuel (dimensionnement, surface menacee)
    const P = new FEU.Feu(carte, { vent: G.vent, dir: G.dir, secheresse: G.sech, graine: 1 });
    P.ta.set(F.ta); P.ext.set(F.ext); P.t = F.t; P.reseed(); P.avance(F.t + minutes * 60);
    return P;
  }
  function situationVraie(b) {
    const I = b.Imax;
    const P = prevision(60), menaces = pointsMenaces(P, 300);
    if (I > 10000 || menaces.length >= 3) return { v: 'Très défavorable', menaces };
    if (I > 4000 || menaces.length) return { v: 'Défavorable', menaces };
    return { v: 'Favorable', menaces };
  }
  function pointsMenaces(P, marge) {
    const out = [];
    const brule = (x, y) => { for (let a = 0; a < 8; a++) { const i = CARTE.idx(x + Math.cos(a) * marge, y + Math.sin(a) * marge); if (i >= 0 && P.ta[i] <= P.t) return true; } const i = CARTE.idx(x, y); return i >= 0 && P.ta[i] <= P.t; };
    for (const l of carte.lieux) if (l.k === 'hameau' && brule(l.p[0], l.p[1])) out.push(l.n);
    for (const s of carte.sensibles) if (brule(s.p[0], s.p[1])) out.push(s.n);
    for (const e of carte.elec) if (e.p.some(p => brule(p[0], p[1]))) out.push('ligne électrique ' + (e.v || ''));
    return [...new Set(out)];
  }
  // dimensionnement du memento : 1 UIFF par 40 m de front (attaque de front / ligne d'appui), donnees valables jusqu'a 7000 kW/m
  function besoinUIFF(frontM, I) { const eff = Math.min(1, 7000 / Math.max(I, 1)); return Math.max(2, Math.ceil(frontM / (40 * eff))); }

  // =============================================================== PHASES (panneau)
  function setPhase(k) { G.phase = Math.max(G.phase, PHASES.findIndex(p => p[0] === k)); renderPhases(); renderPhase(); }
  function renderPhases() {
    $('#phases').innerHTML = PHASES.map((p, i) => `<li class="${i < G.phase ? 'fait' : i === G.phase ? 'encours' : ''}">${p[1]}</li>`).join('');
  }
  function renderPhase() {
    const k = PHASES[G.phase][0], el = $('#o-phase');
    el.innerHTML = (PH[k] || (() => ''))();
    if (PH[k + '_bind']) PH[k + '_bind'](el);
  }
  const opt = (arr, v) => arr.map(a => `<option ${a === v ? 'selected' : ''}>${esc(a)}</option>`).join('');
  const DIRS = ['nord', 'nord-est', 'est', 'sud-est', 'sud', 'sud-ouest', 'ouest', 'nord-ouest'];
  const CATS = ['Broussailles', 'Landes', 'Taillis/feuillus', 'Pins d’âges divers', 'Marais', 'Pins de - 20 ans', 'Prairie / Bord de route', 'Pins de 20 à 40 ans', 'Espace agricole', 'Pins de + 40 ans'];

  const PH = {};
  // ---------------- DPIF
  PH.dpif = () => `
    <h2>DPIF</h2>
    <p class="aide">Départ pour intervention feu. Préparez votre départ avec le ticket et la carte, avant de quitter le CIS.</p>
    <div class="ticket">${esc(G.radio[0].txt)}\nMétéo : vent ${G.vent} m/s (${Math.round(G.vent * 3.6)} km/h), venant du ${CARTE.rose(G.dir)} (${Math.round(G.dir)}°). Sécheresse ${G.sech}.</div>
    <form class="form" id="f-dpif">
      <fieldset><legend>CGI</legend>
        <label>Coordonnées (carré DFCI) <input type="text" name="coord" value="${esc(G.ticket.coord)}"></label>
        <label class="ligne">Vent <span>${G.vent} m/s × 100 = <input type="number" name="vprop" style="width:90px"> m/h</span></label>
        <label>Nombre d'UIFF engagées <input type="number" name="nuiff" value="${G.unites.length}"></label>
      </fieldset>
      <label>Direction de propagation <select name="dir"><option value="">—</option>${opt(DIRS.map(d => 'vers le ' + d))}</select></label>
      <label>Point à atteindre <span class="aide">Cliquez sur la carte (bouton ci-dessous), de préférence un carrefour de pistes.</span>
        <span><button type="button" class="btn sec" id="b-pt">Choisir sur la carte</button> <span id="pt-txt"></span></span></label>
      <label>Itinéraire <input type="text" name="itin" id="itin" readonly placeholder="calculé à partir du point à atteindre"></label>
      <label>Formation sécurité <select name="secu"><option value="">—</option><option>Rappel 3P (eau, observation, liaisons), cheminement de repli, EPI</option><option>Aucune</option></select></label>
      <div class="cases"><label><input type="checkbox" name="radio"> Contrôles radio</label><label><input type="checkbox" name="codis"> Départ transmis au CODIS</label></div>
      <div class="btns"><button class="btn" type="submit">Partir</button></div>
    </form>`;
  PH.dpif_bind = el => {
    $('#b-pt').onclick = () => { G.outil = 'point'; cvD.classList.add('crayon'); info('Cliquez le point à atteindre sur la carte.'); };
    $('#f-dpif').onsubmit = e => {
      e.preventDefault(); const f = new FormData(e.target);
      if (!G.ptAtteindre) { info('Choisissez d\'abord le point à atteindre sur la carte.'); return; }
      const vraieDir = 'vers le ' + CARTE.rose(G.dir + 180), vp = +f.get('vprop');
      evalue('dpif', 'Coordonnées', `${f.get('coord')} (ticket ${G.ticket.coord}, réel ${CARTE.dfci(G.ix, G.iy)})`, f.get('coord').toUpperCase().replace(/\s+/g, ' ').trim() === G.ticket.coord ? 'ok' : 'mi');
      evalue('dpif', 'Vitesse de propagation estimée', `${vp || '—'} m/h (règle du mémento : ${G.vent * 100} m/h)`, vp && Math.abs(vp - G.vent * 100) <= G.vent * 20 ? 'ok' : 'ko', 'Vent en m/s × 100 = vitesse de propagation en m/h.');
      evalue('dpif', 'Direction de propagation', `${f.get('dir') || '—'} (attendu : ${vraieDir})`, f.get('dir') === vraieDir ? 'ok' : 'ko', 'Le feu part à l\'opposé d\'où vient le vent.');
      const [px, py] = G.ptAtteindre, dF = Math.hypot(px - G.ix, py - G.iy);
      const ax = (px - G.ix) * F.wx + (py - G.iy) * F.wy, lat = Math.abs((px - G.ix) * F.wy - (py - G.iy) * F.wx);
      const devant = ax > 200 && lat < 600;
      evalue('dpif', 'Point à atteindre', `${CARTE.dfci(px, py)}, à ${Math.round(dF)} m du départ ${devant ? '— dans l\'axe, devant la tête du feu' : ''}`, dF < 1500 && !devant ? 'ok' : 'mi', devant ? 'Ne pas se présenter devant la tête : on s\'engage par l\'arrière ou les flancs, cheminement de repli assuré.' : dF >= 1500 ? 'Point trop éloigné du feu.' : '');
      evalue('dpif', 'Formation sécurité', f.get('secu') || '—', /3P/.test(f.get('secu') || '') ? 'ok' : 'ko');
      evalue('dpif', 'Contrôles radio', f.get('radio') ? 'faits' : 'non faits', f.get('radio') ? 'ok' : 'ko');
      evalue('dpif', 'Départ transmis au CODIS', f.get('codis') ? 'oui' : 'non', f.get('codis') ? 'ok' : 'ko');
      if (f.get('codis')) radio('CDG Salles', 'CODIS 33', `CDG Salles quitte le CIS pour ${G.ticket.commune}, ${G.ticket.ld}.`, 'GRP 272');
      G.ptEngagement = G.ptAtteindre;
      allerA(G.cdg, px, py);
      for (const u of G.unites) if (u.path && u.etat === 'transit') allerA(u, px, py);
      G.tDepart = G.t;
      setPhase('zi');
    };
  };
  // ---------------- Analyse ZI
  PH.zi = () => `
    <h2>Analyse de la ZI</h2>
    <p class="aide">En transit, analysez la zone d'intervention sur la carte avec les crayons (barre d'outils de la carte). Tracez à main levée ; un trait fermé délimite une zone.</p>
    <ol class="form" style="padding-left:0;list-style:none">${CRAYONS.map(c => `<li style="display:flex;gap:8px;align-items:center"><i style="width:14px;height:14px;border-radius:50%;background:${c.c};border:2px solid #fff;display:inline-block"></i> ${c.n}/ ${esc(c.nom)} <small class="aide">(${G.dessins.filter(d => d.n === c.n).length})</small></li>`).join('')}</ol>
    <form class="form" id="f-zi">
      <fieldset><legend>4/ Nature de la végétation dans l'axe du feu</legend><div class="cases">${CATS.map(c => `<label><input type="checkbox" name="veg" value="${esc(c)}"> ${esc(c)}</label>`).join('')}</div></fieldset>
      <div class="btns"><button class="btn" type="submit">Analyse terminée</button></div>
    </form>
    <p class="aide">Transit en cours : arrivée prévue vers ${G.cdg.path ? hm(G.heure0 + G.t + (G.cdg.tTrajet || 0)) : '—'}.</p>`;
  PH.zi_bind = el => {
    $('#f-zi').onsubmit = e => {
      e.preventDefault(); const f = new FormData(e.target);
      evalueZI(f.getAll('veg'));
      G.crayon = null; renderCrayons(); cvD.classList.remove('crayon');
      setPhase('transit');
    };
  };
  function evalueZI(veg) {
    const P = prevision(60), c = carte;
    const zone = G.dessins.filter(d => d.n === 1 && d.ferme);
    // 1/ dimensionnement : part de la surface prevue a 1 h couverte par les zones rouges
    let tot = 0, inn = 0;
    for (let i = 0; i < P.ta.length; i += 3) { if (P.ta[i] > P.t) continue; tot++; const [x, y] = P.xy(i); if (zone.some(z => CARTE.inPoly(x, y, z.pts))) inn++; }
    const rec = tot ? inn / tot : 0;
    evalue('zi', '1/ Dimensionnement sommaire (zone à 1 h)', zone.length ? `${Math.round(rec * 100)} % de la zone prévue à 1 h couverte` : 'pas de zone tracée', rec > 0.6 ? 'ok' : rec > 0.3 ? 'mi' : 'ko', 'Zone de développement du feu dans l\'axe du vent : longueur ≈ vitesse × durée, front ≈ 1/3 de la profondeur.');
    // 2/ points sensibles
    const men = pointsMenaces(prevision(120), 400);
    const marque = n => { const l = c.lieux.find(l => l.n === n) || c.sensibles.find(s => s.n === n); if (!l) return true; return G.dessins.some(d => d.n === 2 && d.pts.some(p => Math.hypot(p[0] - l.p[0], p[1] - l.p[1]) < 350)); };
    const vus = men.filter(m => !/ligne/.test(m) && marque(m));
    const attendus = men.filter(m => !/ligne/.test(m));
    evalue('zi', '2/ Points sensibles', attendus.length ? `${vus.length} / ${attendus.length} repérés (${attendus.join(', ')})` : 'aucun point sensible menacé dans les 2 h', !attendus.length || vus.length / attendus.length >= 0.6 ? 'ok' : vus.length ? 'mi' : 'ko');
    // 3/ acces
    const acces = G.dessins.filter(d => d.n === 3); let surRoute = 0, n3 = 0;
    for (const d of acces) for (const p of d.pts) { n3++; const k = CARTE.nearestNode(p[0], p[1]), q = c.gN[k]; if (Math.hypot(q[0] - p[0], q[1] - p[1]) < 60) surRoute++; }
    evalue('zi', '3/ Accès, rocades, pénétrantes', acces.length ? `${Math.round(surRoute / Math.max(1, n3) * 100)} % du tracé sur des pistes ou routes` : 'non tracés', acces.length && surRoute / n3 > 0.6 ? 'ok' : acces.length ? 'mi' : 'ko', 'Repérer les pistes DFCI qui encadrent le feu (rocades) et celles qui y mènent (pénétrantes).');
    // 4/ vegetation
    const cats = {}; for (let i = 0; i < P.ta.length; i += 7) if (P.ta[i] <= P.t) { const k = CARTE.categorie(c.fuel[i]); cats[k] = (cats[k] || 0) + 1; }
    const top = Object.entries(cats).sort((a, b) => b[1] - a[1]).slice(0, 2).map(e => e[0]);
    const okv = top.filter(t => veg.includes(t)).length;
    evalue('zi', '4/ Nature de la végétation', `${veg.join(', ') || '—'} (dans l'axe : ${top.join(', ')})`, okv === top.length ? 'ok' : okv ? 'mi' : 'ko');
    // 5/ points d'eau
    const pe = c.points_eau.map(p => ({ p, d: Math.hypot(p.p[0] - G.ix, p.p[1] - G.iy) })).sort((a, b) => a.d - b.d).slice(0, 3);
    const peVus = pe.filter(e => G.dessins.some(d => d.n === 5 && d.pts.some(q => Math.hypot(q[0] - e.p.p[0], q[1] - e.p.p[1]) < 150)));
    evalue('zi', '5/ Points d\'eau', `${peVus.length} / 3 des plus proches repérés (n° ${pe.map(e => e.p.n).join(', ')})`, peVus.length >= 2 ? 'ok' : peVus.length ? 'mi' : 'ko');
    // 6/ divers
    const six = G.dessins.filter(d => d.n === 6).length;
    const lignes = men.filter(m => /ligne/.test(m));
    evalue('zi', '6/ Éléments divers, obstacles, aériens', six ? `${six} élément(s) noté(s)${lignes.length ? ' ; lignes électriques dans la zone : ' + lignes.length : ''}` : 'rien de noté', six ? 'ok' : lignes.length ? 'ko' : 'mi', 'Lignes électriques, crastes et fossés, voie ferrée, zones de largage, chablis.');
  }
  // ---------------- transit : « je vois »
  PH.transit = () => `
    <h2>En transit</h2>
    <p class="aide">Vous apercevez le panache. Décrivez-le au CODIS si nécessaire.</p>
    <canvas class="vois" id="vois" width="380" height="170"></canvas>
    <form class="form" id="f-vois">
      <label>Couleur de la fumée <select name="coul"><option value="">—</option>${opt(['blanche', 'grise', 'noire'])}</select></label>
      <label>Inclinaison <select name="incl"><option value="">—</option>${opt(['verticale', 'inclinée', 'couchée'])}</select></label>
      <label>Panache <select name="pan"><option value="">—</option>${opt(['peu développé', 'développé', 'très développé, pyrocumulus'])}</select></label>
      <label>Je demande l'activation du point d'eau (facultatif) <select name="pe"><option value="">—</option>${carte.points_eau.map(p => `<option value="${p.n}">${peLabel(p)}</option>`).join('')}</select></label>
      <label>au moyen de <select name="moyen">${opt(['MPF', 'MPR', 'MPRI', 'MPRGP'])}</select></label>
      <div class="btns"><button class="btn" type="submit">Transmettre « je vois »</button><button class="btn sec" type="button" id="b-rien">Rien à transmettre</button></div>
    </form>
    <p class="aide" id="eta"></p>`;
  function verite_fumee() {
    const b = G.bilan || F.bilan(), f = CARTE.fuelAt(G.ix, G.iy);
    const coul = b.Imax > 6000 || [6, 7, 11].includes(f) ? 'noire' : b.Imax > 1500 ? 'grise' : 'blanche';
    const incl = G.vent >= 9 ? 'couchée' : G.vent >= 4 ? 'inclinée' : 'verticale';
    const pan = b.ha > 8 || b.Imax > 12000 ? 'très développé, pyrocumulus' : b.ha > 1.5 ? 'développé' : 'peu développé';
    return { coul, incl, pan };
  }
  PH.transit_bind = () => {
    const v = verite_fumee(), cv = $('#vois'), x = cv.getContext('2d');
    const g = x.createLinearGradient(0, 0, 0, 170); g.addColorStop(0, '#7fb2e0'); g.addColorStop(1, '#d6e7f2'); x.fillStyle = g; x.fillRect(0, 0, 380, 170);
    const col = v.coul === 'noire' ? [40, 38, 38] : v.coul === 'grise' ? [120, 118, 116] : [225, 225, 222];
    const inc = v.incl === 'couchée' ? 1.6 : v.incl === 'inclinée' ? 0.7 : 0.12, h = v.pan.startsWith('très') ? 150 : v.pan === 'développé' ? 115 : 70;
    const side = Math.sin((G.dir + 180 - CARTE.cap(G.ix - G.cdg.x, G.iy - G.cdg.y)) * Math.PI / 180) || 0.5;
    for (let k = 0; k < 60; k++) { const t = k / 60, px = 190 + side * inc * t * h * 1.4 + Math.sin(k) * 4, py = 150 - t * h; x.fillStyle = `rgba(${col.join(',')},${0.08 + 0.1 * (1 - t)})`; x.beginPath(); x.arc(px, py, 6 + t * 30, 0, Math.PI * 2); x.fill(); }
    x.fillStyle = '#26401f'; x.fillRect(0, 140, 380, 30); for (let i = 0; i < 38; i++) { x.fillStyle = '#1d3318'; x.beginPath(); x.moveTo(i * 10, 142); x.lineTo(i * 10 + 5, 118 - (i * 7 % 13)); x.lineTo(i * 10 + 10, 142); x.fill(); }
    $('#b-rien').onclick = () => { evalue('transit', '« Je vois »', 'non transmis', 'mi', 'Le message « je vois » aide le CODIS à dimensionner avant votre arrivée.'); setPhase('arrivee'); };
    $('#f-vois').onsubmit = e => {
      e.preventDefault(); const f = new FormData(e.target);
      const n = ['coul', 'incl', 'pan'].filter(k => f.get(k) === v[k]).length;
      evalue('transit', '« Je vois » : fumée', `${f.get('coul')}, ${f.get('incl')}, ${f.get('pan')} (observé : ${v.coul}, ${v.incl}, ${v.pan})`, n === 3 ? 'ok' : n >= 2 ? 'mi' : 'ko');
      radio('CDG Salles', 'CODIS 33', `Je vois une fumée ${f.get('coul')}, ${f.get('incl')}, panache ${f.get('pan')}.${f.get('pe') ? ` Je demande l'activation du point d'eau n° ${f.get('pe')} au moyen d'une ${f.get('moyen')}.` : ''}`, 'GRP 272');
      if (f.get('pe')) activePE(+f.get('pe'), f.get('moyen'));
      setPhase('arrivee');
    };
  };
  // legende du cartoguide : rond = reserve ; moyen d'activation et perennite a completer (formateur)
  function peLabel(p) { return `n° ${p.n} (${p.dfci})${p.forme === 'rond' ? ' réserve' : ''}${p.activation ? ' · ' + p.activation : ''}`; }
  function activePE(n, moyen) {
    const q = carte.points_eau.find(p => p.n === n); if (!q || G.pe[n]) return;
    const debit = { MPF: 30, MPR: 55, MPRI: 55, MPRGP: 120 }[moyen] || 30;
    G.pe[n] = { n, x: q.p[0], y: q.p[1], moyen, debit, actif: false, tActif: G.t + (moyen === 'MPF' ? 8 : 18) * 60, tDemande: G.t };
    radio('CODIS 33', 'CDG Salles', `Reçu, activation du point d'eau ${n} (${moyen}) en cours.`, 'GRP 272', 'codis');
    G.dirtyFond = true;
  }
  // ---------------- arrivee
  PH.arrivee = () => {
    const dist = Math.hypot(G.cdg.x - G.ix, G.cdg.y - G.iy);
    if (G.cdg.path) return `<h2>Arrivée sur les lieux</h2><p class="aide">Encore en route : ${Math.round(dist)} m du point de départ du feu. Le message d'arrivée sera disponible à l'arrivée au point à atteindre.</p><p class="aide">Vous pouvez poursuivre l'analyse de la ZI sur la carte en attendant.</p>`;
    return `<h2>Message d'arrivée à l'adresse indiquée</h2>
    <p class="aide">T0 (+ status 2). Seul le premier moyen sur les lieux passe ce message.</p>
    <form class="form" id="f-arr">
      <label>Commune sinistrée (départ du feu) <input type="text" name="commune" value=""></label>
      <label>Lieu-dit (cartoguide 25 000ᵉ) <input type="text" name="ld" list="l-ld"></label>
      <datalist id="l-ld">${carte.lieux.map(l => `<option value="${esc(l.n)}">`).join('')}</datalist>
      <fieldset><legend>Feu de</legend><div class="cases">${CATS.map(c => `<label><input type="radio" name="cat" value="${esc(c)}"> ${esc(c)}</label>`).join('')}</div></fieldset>
      <label class="ligne"><input type="checkbox" name="reco"> Reconnaissance en cours</label>
      <div class="btns"><button class="btn" type="submit">Transmettre au CODIS (GRP 272)</button></div>
    </form>`;
  };
  PH.arrivee_bind = () => {
    const f0 = $('#f-arr'); if (!f0) return;
    f0.onsubmit = e => {
      e.preventDefault(); const f = new FormData(e.target);
      const commune = CARTE.commune(G.ix, G.iy), ldv = CARTE.lieuDit(G.ix, G.iy), cats = categorieFeu();
      const ldPos = carte.lieux.find(l => l.n.toLowerCase() === (f.get('ld') || '').toLowerCase());
      evalue('arrivee', 'Commune', `${f.get('commune') || '—'} (${commune})`, (f.get('commune') || '').toLowerCase().trim() === commune.toLowerCase() ? 'ok' : 'ko');
      evalue('arrivee', 'Lieu-dit', `${f.get('ld') || '—'} (le plus proche : ${ldv})`, ldPos && Math.hypot(ldPos.p[0] - G.ix, ldPos.p[1] - G.iy) < 1200 ? 'ok' : 'ko');
      evalue('arrivee', 'Feu de', `${f.get('cat') || '—'} (au départ : ${cats.slice(0, 2).join(' / ')})`, f.get('cat') === cats[0] ? 'ok' : cats.includes(f.get('cat')) ? 'mi' : 'ko', 'C\'est la configuration de la parcelle qui compte, pas l\'âge réel du boisement.');
      evalue('arrivee', 'Reconnaissance en cours', f.get('reco') ? 'annoncée' : 'non annoncée', f.get('reco') ? 'ok' : 'mi');
      evalue('arrivee', 'Délai', `message à ${heure()}`, 'ok');
      radio('CDG Salles', 'CODIS 33', `CDG Salles arrivé à l'adresse indiquée. Commune de ${f.get('commune')}, lieu-dit ${f.get('ld')}. Feu de ${f.get('cat') || '—'}. ${f.get('reco') ? 'Reconnaissance en cours.' : ''}`, 'GRP 272');
      G.msgs.arrivee = { t: G.t }; G.tArrivee = G.tArrivee || G.t;
      setPhase('reco');
    };
  };
  // ---------------- reconnaissance, reflexes, messages, RTO : panneau commun de conduite
  PH.reco = () => conduite();
  PH.reflexes = () => conduite();
  PH.messages = () => conduite();
  PH.rto = () => conduite();
  PH.reco_bind = PH.reflexes_bind = PH.messages_bind = PH.rto_bind = () => bindConduite();
  function conduite() {
    const b = G.bilan || F.bilan(), nb = Object.keys(G.reflexes).length;
    const prochain = !G.msgs.ambiance ? 'ambiance' : G.etatFeu === 'maîtrisé' && G.tLisiere ? 'eteint' : 'cr';
    return `
    <h2>${G.phase <= 4 ? 'Reconnaissance' : G.phase === 5 ? 'Actions réflexes' : G.phase === 6 ? 'Messages' : 'Raisonnement tactique'}</h2>
    <p class="aide">Déplacez votre VLCG (clic droit ou « Aller à » puis clic sur la carte) : vous voyez le feu à 300 m autour de vous et de vos engins. Feu ${esc(G.etatFeu)}.</p>
    <div class="btns"><button class="btn sec" id="b-aller">Aller à…</button><button class="btn sec" id="b-c33">Demander Charlie 33</button></div>
    <h3>Actions réflexes (${nb}/${REFLEXES.length})</h3>
    <div class="form">${REFLEXES.map(([k, t]) => `<label class="ligne"><input type="checkbox" data-refl="${k}" ${G.reflexes[k] ? 'checked disabled' : ''}> ${esc(t)}${G.reflexes[k] ? ` <small class="aide">${hm(G.heure0 + G.reflexes[k])}</small>` : ''}</label>`).join('')}</div>
    <div class="btns"><button class="btn sec" id="b-pteng">Désigner le point d'engagement sur la carte</button></div>
    <h3>Messages au CODIS</h3>
    <div class="btns">
      <button class="btn ${prochain === 'ambiance' ? '' : 'sec'}" data-msg="ambiance" ${G.msgs.ambiance ? 'disabled' : ''}>Message d'ambiance</button>
      <button class="btn ${prochain === 'cr' ? '' : 'sec'}" data-msg="cr" ${!G.msgs.ambiance ? 'disabled' : ''}>Compte rendu n° ${G.cr + 1}</button>
      <button class="btn ${prochain === 'eteint' ? '' : 'sec'}" data-msg="eteint" ${G.etatFeu !== 'maîtrisé' ? 'disabled' : ''}>Feu éteint</button>
    </div>
    <div id="zone-msg"></div>
    <h3>Raisonnement tactique</h3>
    <p class="aide">Ordres aux UIFF dans l'onglet <b>Moyens</b>. Mémento : 1 UIFF tient 40 m de front en attaque de front ou ligne d'appui (2 → 80 m, 3 → 120 m), 100 m en percée de flanc ; données valables jusqu'à 7 000 kW/m.</p>
    <div class="btns"><button class="btn rouge" id="b-fin">Terminer et débriefer</button></div>`;
  }
  function bindConduite() {
    $('#b-aller').onclick = () => { G.outil = 'aller'; cvD.classList.add('crayon'); info('Cliquez la destination de votre VLCG.'); };
    $('#b-c33').onclick = () => { if (G.c33 != null) return; G.c33 = G.t; radio('CDG Salles', 'CODIS 33', 'Je demande l\'engagement de Charlie 33 pour reconnaissance.', 'GRP 272'); setTimeout(() => {}, 0); G.tC33 = G.t + 20 * 60; G.c33 = null; G.c33Prevu = true; };
    $('#b-pteng').onclick = () => { G.outil = 'engagement'; cvD.classList.add('crayon'); info('Cliquez le point d\'engagement des moyens.'); };
    $$('[data-refl]').forEach(c => c.onchange = () => {
      const k = c.dataset.refl; G.reflexes[k] = G.t; c.disabled = true;
      if (k === 'radio') { G.dir654 = true; radio('CDG Salles', 'Chefs d\'agrès', 'De CDG Salles, je prends le COS, basculez sur la DIR 654, contrôle radio.', 'DIR 654'); G.unites.filter(u => u.x != null).forEach(u => radio(u.ca, 'CDG Salles', 'Reçu 5 sur 5.', 'DIR 654')); }
      if (G.phase < 5) setPhase('reflexes'); else renderPhase();
    });
    $$('[data-msg]').forEach(b => b.onclick = () => { $('#zone-msg').innerHTML = FORM[b.dataset.msg](); FORM[b.dataset.msg + '_bind'](); });
    $('#b-fin').onclick = () => termine();
  }

  // ---------------- formulaires de messages
  const FORM = {};
  FORM.ambiance = () => `<form class="form" id="f-msg">
    <p class="aide">Message de reconnaissance (ambiance), T+3 à 5 min.</p>
    <label>Feu de <select name="cat">${opt(['', ...CATS])}</select></label>
    <label>Superficie détruite <span><input type="number" step="0.1" name="ha" style="width:100px"> ha</span></label>
    <label>Longueur du front de feu <span><input type="number" name="front" style="width:100px"> m</span></label>
    <label>Situation <select name="sit">${opt(['', 'Favorable', 'Défavorable', 'Très défavorable'])}</select></label>
    <label>Surface menacée <input type="text" name="menace" placeholder="ex. 50 ha, hameau de …"></label>
    <fieldset><legend>Difficultés particulières</legend><div class="cases"><label><input type="checkbox" name="diff" value="Terrain inaccessible, fossés, chablis"> Terrain inaccessible, fossés, chablis</label><label><input type="checkbox" name="diff" value="Points sensibles à défendre"> Points sensibles à défendre</label></div></fieldset>
    <label>Moyens sur les lieux <input type="text" name="sur" value="CDG Salles, ${G.unites.filter(u => u.etat !== 'alerte' && u.etat !== 'transit').map(u => u.label).join(', ')}"></label>
    <label>Le feu nécessite <span><input type="number" name="nuiff" style="width:80px"> UIFF sur les lieux (nombre total)</span></label>
    <fieldset><legend>Autres moyens</legend><div class="cases">${['GPF', 'Lot EGL', 'ABE', 'Chenillette'].map(m => `<label><input type="checkbox" name="autres" value="${m}"> ${m}</label>`).join('')}</div></fieldset>
    <fieldset><legend>Demande d'autorités ou services</legend><div class="cases">${['Élus, conseiller technique DFCI', 'Police ou gendarmerie', 'Énergie (Enedis, RTE)'].map(m => `<label><input type="checkbox" name="aut" value="${m}"> ${m}</label>`).join('')}</div></fieldset>
    <label>Point d'engagement des moyens <input type="text" name="pteng" value="${G.ptEngagement ? CARTE.dfci(...G.ptEngagement) : ''}"></label>
    <label>Je demande l'activation du point d'eau <select name="pe"><option value="">—</option>${carte.points_eau.map(p => `<option value="${p.n}">${peLabel(p)}</option>`).join('')}</select></label>
    <label>au moyen de <select name="moyen">${opt(['MPF', 'MPR', 'MPRI', 'MPRGP'])}</select></label>
    <div class="btns"><button class="btn" type="submit">Transmettre (GRP 272)</button></div></form>`;
  FORM.ambiance_bind = () => {
    $('#f-msg').onsubmit = e => {
      e.preventDefault(); const f = new FormData(e.target), b = F.bilan(); G.bilan = b;
      const cats = categorieFeu(), sit = situationVraie(b);
      const tAmb = G.t - (G.tArrivee || G.t);
      evalue('messages', 'Ambiance : délai', `${Math.round(tAmb / 60)} min après l'arrivée`, tAmb <= 5 * 60 ? 'ok' : tAmb <= 8 * 60 ? 'mi' : 'ko', 'T+3 à 5 min maximum.');
      evalue('messages', 'Ambiance : feu de', `${f.get('cat') || '—'} (${cats[0]})`, cats.slice(0, 2).includes(f.get('cat')) ? 'ok' : 'ko');
      const ha = +f.get('ha'); evalue('messages', 'Ambiance : superficie', `${ha || '—'} ha (réel ${b.ha.toFixed(1)} ha)`, ha && Math.abs(ha - b.ha) <= Math.max(0.5, b.ha * 0.4) ? 'ok' : ha && Math.abs(ha - b.ha) <= b.ha ? 'mi' : 'ko', 'Surface ≈ profondeur × front / 2.');
      const fr = +f.get('front'); evalue('messages', 'Ambiance : longueur du front', `${fr || '—'} m (réel ${b.front} m)`, fr && Math.abs(fr - b.front) <= Math.max(30, b.front * 0.4) ? 'ok' : fr ? 'mi' : 'ko');
      evalue('messages', 'Ambiance : situation', `${f.get('sit') || '—'} (attendu : ${sit.v}${sit.menaces.length ? ' — menacés dans l\'heure : ' + sit.menaces.join(', ') : ''})`, f.get('sit') === sit.v ? 'ok' : 'ko', 'C\'est la situation générale (enjeux, surface menacée) qui compte, pas la difficulté d\'accès.');
      const nReq = besoinUIFF(prevision(30).bilan ? frontPrevu() : b.front, b.Imax), nDem = +f.get('nuiff');
      evalue('messages', 'Ambiance : demande de moyens', `${nDem || '—'} UIFF au total (mémento : ≈ ${nReq} pour ${frontPrevu()} m de front à +30 min, intensité ${Math.round(b.Imax)} kW/m)`, nDem && Math.abs(nDem - nReq) <= 1 ? 'ok' : nDem && nDem >= nReq - 2 ? 'mi' : 'ko', 'Nombre TOTAL, moyens déjà sur place compris. 1 UIFF par 40 m de front à tenir.');
      const peDem = f.get('pe');
      evalue('messages', 'Ambiance : point d\'eau', peDem ? `n° ${peDem} au moyen d'une ${f.get('moyen')}` : 'non demandé', peDem ? (nDem > 3 && f.get('moyen') === 'MPF' ? 'mi' : 'ok') : 'ko', 'Mémento : jusqu\'à 3 UIFF une MPF ; au-delà une MPR ou MPRI.');
      radio('CDG Salles', 'CODIS 33', `Message d'ambiance. Feu de ${f.get('cat')}, ${ha} ha, front de ${fr} m. Situation ${(f.get('sit') || '').toLowerCase()}. ${f.getAll('diff').join(', ')}. Surface menacée : ${f.get('menace') || '—'}. Le feu nécessite ${nDem} UIFF sur les lieux${f.getAll('autres').length ? ' et ' + f.getAll('autres').join(', ') : ''}. ${f.getAll('aut').length ? 'Je demande ' + f.getAll('aut').join(', ') + '. ' : ''}Point d'engagement : ${f.get('pteng')}. ${peDem ? `Je demande l'activation du point d'eau ${peDem} au moyen d'une ${f.get('moyen')}.` : ''}`, 'GRP 272');
      G.msgs.ambiance = { t: G.t }; G.tDernierMsg = G.t;
      const manquant = nDem - G.unites.length;
      if (manquant > 0) G.demandes.push({ n: manquant, t: G.t + 4 * 60 });
      if (peDem) activePE(+peDem, f.get('moyen'));
      if (f.getAll('autres').includes('ABE')) radio('CODIS 33', 'CDG Salles', 'Demande d\'ABE transmise au COZ, pas de moyen disponible dans l\'immédiat.', 'GRP 272', 'codis');
      setPhase('messages'); renderPhase();
    };
  };
  function frontPrevu() { const P = prevision(30), b = P.bilan(); return b.front; }
  FORM.cr = () => `<form class="form" id="f-msg">
    <p class="aide">Message de compte rendu n° ${G.cr + 1} (toutes les 20 à 30 min).</p>
    <label>Changement de phase de lutte <select name="phase">${opt(['', 'Feu fixé', 'Feu maîtrisé'])}</select></label>
    <label>Évolution de la situation <select name="sit">${opt(['', 'Favorable', 'Défavorable', 'Très défavorable'])}</select></label>
    <label>Superficie détruite <span><input type="number" step="0.1" name="ha" style="width:100px"> ha</span></label>
    <label>Longueur du front de feu <span><input type="number" name="front" style="width:100px"> m</span></label>
    <label>Texte libre (actions en cours, prévisibles) <textarea name="txt"></textarea></label>
    <label>Le feu nécessite <span><input type="number" name="nuiff" style="width:80px" value="${G.unites.length}"> UIFF sur les lieux (total)</span></label>
    <div class="btns"><button class="btn" type="submit">Transmettre (GRP 272)</button></div></form>`;
  FORM.cr_bind = () => {
    $('#f-msg').onsubmit = e => {
      e.preventDefault(); const f = new FormData(e.target), b = F.bilan(); G.bilan = b; G.cr++;
      const ecart = G.t - (G.tDernierMsg || G.t);
      evalue('messages', `CR n° ${G.cr} : cadence`, `${Math.round(ecart / 60)} min après le message précédent`, ecart >= 15 * 60 && ecart <= 32 * 60 ? 'ok' : 'mi');
      const ph = f.get('phase'), vraie = G.etatFeu === 'fixé' ? 'Feu fixé' : G.etatFeu === 'maîtrisé' ? 'Feu maîtrisé' : '';
      evalue('messages', `CR n° ${G.cr} : phase de lutte`, `${ph || 'aucun changement'} (réel : ${vraie || 'feu non fixé'})`, ph === vraie ? 'ok' : 'ko');
      const ha = +f.get('ha'); evalue('messages', `CR n° ${G.cr} : superficie`, `${ha || '—'} ha (réel ${b.ha.toFixed(1)} ha)`, ha && Math.abs(ha - b.ha) <= Math.max(0.5, b.ha * 0.35) ? 'ok' : 'mi');
      radio('CDG Salles', 'CODIS 33', `Message de compte rendu n° ${G.cr}. ${ph || ''} Situation ${(f.get('sit') || '').toLowerCase()}. ${ha} ha, front ${f.get('front')} m. ${f.get('txt')} Le feu nécessite ${f.get('nuiff')} UIFF.`, 'GRP 272');
      const manquant = +f.get('nuiff') - G.unites.length - G.demandes.filter(d => !d.fait).reduce((a, d) => a + d.n, 0);
      if (manquant > 0) G.demandes.push({ n: manquant, t: G.t + 4 * 60 });
      G.tDernierMsg = G.t; G.rappelCR = false; renderPhase();
    };
  };
  FORM.eteint = () => `<form class="form" id="f-msg">
    <p class="aide">Message de feu éteint (surface > 1 m²), quand les moyens s'apprêtent à quitter le chantier.</p>
    <label>Commune sinistrée <input type="text" name="commune"></label>
    <label>Lieu-dit <input type="text" name="ld" list="l-ld2"></label><datalist id="l-ld2">${carte.lieux.map(l => `<option value="${esc(l.n)}">`).join('')}</datalist>
    <label>Coordonnées <input type="text" name="coord" placeholder="ex. GT 634"></label>
    <label>Superficie détruite <span><input type="number" step="0.1" name="ha" style="width:100px"> ha</span></label>
    <label>Type de végétation <select name="cat">${opt(['', ...CATS])}</select></label>
    <label>Cause <select name="cause">${opt(['', 'Inconnue', 'Naturelle', 'Accidentelle', 'Malveillance'])}</select></label>
    <label>Origine <select name="orig">${opt(['', 'Activités de loisirs', 'Dépôts d\'ordures', 'Feux et travaux agricoles', 'Installations électriques', 'Jet d\'objet incandescent', 'Pyromanie', 'Trains', 'Travaux de particulier', 'Travaux forestiers', 'Travaux industriels', 'Véhicules routiers', 'Foudre', 'Autre'])}</select></label>
    <label>Surveillance du feu assurée par <select name="surv">${opt(['', 'ASA DFCI', 'Propriétaire', 'Sapeurs-pompiers', 'Autre'])}</select></label>
    <div class="btns"><button class="btn" type="submit">Transmettre (GRP 272)</button></div></form>`;
  FORM.eteint_bind = () => {
    $('#f-msg').onsubmit = e => {
      e.preventDefault(); const f = new FormData(e.target), b = F.bilan();
      evalue('messages', 'Feu éteint : coordonnées', `${f.get('coord') || '—'} (point de départ : ${CARTE.dfci(G.ix, G.iy)})`, (f.get('coord') || '').toUpperCase().replace(/\s+/g, ' ').trim() === CARTE.dfci(G.ix, G.iy) ? 'ok' : 'ko', 'Coordonnées du point de départ du feu.');
      evalue('messages', 'Feu éteint : superficie', `${f.get('ha')} ha (réel ${b.ha.toFixed(1)} ha)`, Math.abs(+f.get('ha') - b.ha) <= Math.max(0.3, b.ha * 0.25) ? 'ok' : 'mi');
      evalue('messages', 'Feu éteint : cause et origine', `${f.get('cause')} / ${f.get('orig')} (indices : ${G.indiceVu ? G.cause.indice : 'point de départ non reconnu'})`, f.get('cause') === G.cause.cause && (!G.cause.origine || f.get('orig') === G.cause.origine) ? 'ok' : 'ko', 'Reconnaître le point de départ pour rechercher la cause.');
      radio('CDG Salles', 'CODIS 33', `Message de feu éteint. Commune de ${f.get('commune')}, lieu-dit ${f.get('ld')}, coordonnées ${f.get('coord')}. ${f.get('ha')} ha de ${f.get('cat')}. Cause ${(f.get('cause') || '').toLowerCase()}, ${f.get('orig')}. Surveillance assurée par ${f.get('surv')}.`, 'GRP 272');
      termine();
    };
  };

  // =============================================================== MOYENS (ordres)
  const ORDRES = [['front', 'Attaque de front'], ['flancG', 'Attaque flanc gauche'], ['flancD', 'Attaque flanc droit'], ['percee', 'Percée de flanc'], ['ligne', 'Ligne d\'appui'], ['defense', 'Défense point sensible'], ['lisiere', 'Traitement des lisières'], ['eau', 'Au point d\'eau'], ['attente', 'Attente'], ['aller', 'Aller à…']];
  const LIB = Object.fromEntries(ORDRES);
  function renderMoyens() {
    const el = $('#o-moyens'); if (!el) return;
    el.innerHTML = `<h2>Moyens</h2>
      <div class="unite"><header><b>CDG Salles (vous)</b><span class="st">${G.cdg && G.cdg.path ? 'en déplacement' : 'sur les lieux'}</span></header></div>
      ${G.unites.map(u => `<div class="unite ${G.sel === u.id ? 'sel' : ''}" data-u="${u.id}">
        <header><b>${esc(u.label)}</b><span class="st">${etatTxt(u)}</span></header>
        <div class="jauge" title="Eau"><i style="width:${Math.round(u.eau / u.cap * 100)}%"></i></div>
        <small class="aide">${Math.round(u.eau)} L ${u.Ivu && G.t - (u.actif || 0) < 30 ? '· intensité ' + Math.round(u.Ivu) + ' kW/m' : ''}</small>
        <div class="ordres">${u.x == null ? '' : ORDRES.map(([k, t]) => `<button data-ordre="${k}" data-u="${u.id}">${t}</button>`).join('')}</div>
      </div>`).join('')}
      <h3>Points d'eau activés</h3>
      <p class="aide">${Object.values(G.pe).map(p => `n° ${p.n} (${p.moyen}) : ${p.actif ? 'opérationnel' : 'en cours, ' + hm(G.heure0 + p.tActif)}`).join('<br>') || 'aucun'}</p>
      <div class="btns"><select id="pe-sel">${carte.points_eau.map(p => `<option value="${p.n}">${peLabel(p)}</option>`).join('')}</select><select id="pe-moy">${opt(['MPF', 'MPR', 'MPRI', 'MPRGP'])}</select><button class="btn sec" id="b-pe">Demander l'activation</button></div>`;
    $$('#o-moyens [data-ordre]').forEach(b => b.onclick = () => ordre(G.unites.find(u => u.id === b.dataset.u), b.dataset.ordre));
    $$('#o-moyens .unite[data-u]').forEach(d => d.onclick = e => { if (e.target.tagName !== 'BUTTON') { G.sel = d.dataset.u; const u = G.unites.find(x => x.id === G.sel); if (u.x != null) vue.centre(u.x, u.y); G.dirtyFond = true; renderMoyens(); } });
    $('#b-pe').onclick = () => { const n = +$('#pe-sel').value, m = $('#pe-moy').value; radio('CDG Salles', 'CODIS 33', `Je demande l'activation du point d'eau ${n} au moyen d'une ${m}.`, 'GRP 272'); activePE(n, m); renderMoyens(); };
  }
  function etatTxt(u) {
    if (u.etat === 'alerte') return 'départ ' + hm(G.heure0 + u.tDispo);
    if (u.etat === 'transit') return 'en route' + (u.path ? '' : '');
    if (u.etat === 'attente') return 'au point d\'engagement';
    if (u.etat === 'vers_pe') return 'vers point d\'eau ' + u.auPE;
    if (u.etat === 'remplissage') return 'remplissage';
    return LIB[u.mission] || 'engagé';
  }
  function ordre(u, k) {
    if (!u) return;
    G.sel = u.id;
    if (k === 'aller') { G.outil = 'allerU'; cvD.classList.add('crayon'); info(`Cliquez la destination de ${u.label}.`); return; }
    if (k === 'ligne') { G.outil = 'ligne'; G.ligneEnCours = { pts: [], u: u.id }; cvD.classList.add('crayon'); info('Tracez la ligne d\'appui : cliquez ses deux extrémités, de préférence le long d\'une piste.'); return; }
    if (k === 'defense') { G.outil = 'defense'; cvD.classList.add('crayon'); info('Cliquez le point sensible à défendre.'); return; }
    if (k === 'eau') { u.eau = Math.min(u.eau, CCF_L - 1); gereEau(u); renderMoyens(); return; }
    u.mission = k; u.etat = 'engage'; u.alerteSecu = false;
    const cib = cibleFront(u);
    if (cib && k !== 'attente') { const r = allerA(u, cib[0], cib[1]); if (r && r.L > 400) u.path = r.pts; else u.path = null; }
    radio('CDG Salles', u.ca, `${u.label}, ${LIB[k].toLowerCase()}${k === 'percee' ? ', progression dans le brûlé, cheminement de repli par l\'arrière' : ''}.`, G.dir654 ? 'DIR 654' : 'GRP 272');
    radio(u.ca, 'CDG Salles', 'Reçu.', G.dir654 ? 'DIR 654' : 'GRP 272');
    if (!G.reflexes.securite && !u.avertiSecu) { u.avertiSecu = true; evalue('rto', 'Engagement sans consignes de sécurité', `${u.label} engagée à ${heure()} avant les réflexes sécurité`, 'mi', 'Règle des 3 P et cheminement de repli avant l\'engagement.'); }
    if (G.phase < 7) setPhase('rto');
    G.dirtyFond = true; renderMoyens();
  }

  // =============================================================== carte : interactions
  function bindUI() {
    $$('.rythme button').forEach(b => b.onclick = () => { rythme = +b.dataset.v; $$('.rythme button').forEach(x => x.setAttribute('aria-pressed', x === b)); });
    $$('[data-fond]').forEach(b => b.onclick = () => { vue.fond = b.dataset.fond; $$('[data-fond]').forEach(x => x.setAttribute('aria-pressed', x === b)); G.dirtyFond = true; renderLegende(); });
    $$('[data-onglet]').forEach(b => b.onclick = () => { $$('[data-onglet]').forEach(x => x.setAttribute('aria-selected', x === b)); $$('.contenu').forEach(c => c.hidden = c.id !== 'o-' + b.dataset.onglet); if (b.dataset.onglet === 'radio') $('#nb-radio').textContent = ''; if (b.dataset.onglet === 'moyens') renderMoyens(); });
    $$('[data-outil]').forEach(b => b.onclick = () => { const o = b.dataset.outil; G.outil = G.outil === o ? null : o; G.crayon = null; renderCrayons(); $$('[data-outil]').forEach(x => x.setAttribute('aria-pressed', x.dataset.outil === G.outil)); cvD.classList.toggle('crayon', !!G.outil); G.mesure = null; });
    $('#b-feu').onclick = () => { const b = G.bilan || F.bilan(); const e = b.emprise; vue.centre((e[0] + e[2]) / 2 || G.ix, (e[1] + e[3]) / 2 || G.iy, Math.max(vue.s, 0.35)); G.dirtyFond = true; };
    let drag = null, trait = null;
    cvD.addEventListener('pointerdown', e => {
      cvD.setPointerCapture(e.pointerId);
      const r = cvD.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top, x = vue.mx(px), y = vue.my(py);
      if (e.button === 2) { allerCDG(x, y); return; }
      if (G.crayon) { trait = { n: G.crayon, pts: [[x, y]] }; G.dessins.push(trait); return; }
      if (G.outil) { clicOutil(x, y); return; }
      drag = { px, py, cx: vue.cx, cy: vue.cy, moved: false };
    });
    cvD.addEventListener('pointermove', e => {
      const r = cvD.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
      G.souris = [vue.mx(px), vue.my(py)];
      if (trait) { const p = [vue.mx(px), vue.my(py)], q = trait.pts[trait.pts.length - 1]; if (Math.hypot(p[0] - q[0], p[1] - q[1]) * vue.s > 3) trait.pts.push(p); return; }
      if (drag) { const dx = px - drag.px, dy = py - drag.py; if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true; vue.cx = drag.cx - dx / vue.s; vue.cy = drag.cy + dy / vue.s; G.dirtyFond = true; }
    });
    cvD.addEventListener('pointerup', () => {
      if (trait) { const a = trait.pts[0], b = trait.pts[trait.pts.length - 1]; trait.ferme = trait.pts.length > 6 && Math.hypot(a[0] - b[0], a[1] - b[1]) * vue.s < 30; trait = null; if (G.phase === 1) renderPhase(); }
      drag = null;
    });
    cvD.addEventListener('contextmenu', e => e.preventDefault());
    cvD.addEventListener('wheel', e => { e.preventDefault(); const r = cvD.getBoundingClientRect(); vue.zoom(e.deltaY < 0 ? 1.2 : 1 / 1.2, e.clientX - r.left, e.clientY - r.top); G.dirtyFond = true; }, { passive: false });
    // pincement (tablette)
    const pts = new Map(); let pinch = null;
    cvD.addEventListener('touchstart', e => { if (e.touches.length === 2) { const [a, b] = e.touches; pinch = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY); drag = null; } }, { passive: true });
    cvD.addEventListener('touchmove', e => { if (e.touches.length === 2 && pinch) { const [a, b] = e.touches, d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), r = cvD.getBoundingClientRect(); vue.zoom(d / pinch, (a.clientX + b.clientX) / 2 - r.left, (a.clientY + b.clientY) / 2 - r.top); pinch = d; G.dirtyFond = true; } }, { passive: true });
    cvD.addEventListener('touchend', () => { pinch = null; pts.clear(); });
  }
  function allerCDG(x, y) { const r = allerA(G.cdg, x, y); if (r) info(`VLCG : ${Math.round(r.L)} m, ${Math.max(1, Math.round(r.t / 60))} min.`); }
  function clicOutil(x, y) {
    const o = G.outil;
    if (o === 'point') { G.ptAtteindre = [x, y]; const r = CARTE.route(G.cdg.x, G.cdg.y, x, y); $('#pt-txt').textContent = `${CARTE.dfci(x, y)} · ${CARTE.lieuDit(x, y)}`; $('#itin').value = r ? `${(r.L / 1000).toFixed(1)} km par routes et pistes, environ ${Math.round(r.t / 60)} min` : 'pas d\'itinéraire'; G.itin = r; finOutil(); return; }
    if (o === 'aller') { allerCDG(x, y); finOutil(); return; }
    if (o === 'engagement') { G.ptEngagement = [x, y]; G.reflexes.engagement = G.reflexes.engagement || G.t; radio('CDG Salles', 'Chefs d\'agrès', `Point d'engagement des moyens : ${CARTE.dfci(x, y)}, ${CARTE.lieuDit(x, y)}.`, G.dir654 ? 'DIR 654' : 'GRP 272'); for (const u of G.unites) if (u.etat === 'transit') allerA(u, x, y); finOutil(); renderPhase(); return; }
    const u = G.unites.find(u => u.id === G.sel);
    if (o === 'allerU' && u) { allerA(u, x, y); u.etat = u.mission ? 'engage' : 'transit'; finOutil(); return; }
    if (o === 'defense' && u) { u.mission = 'defense'; u.cible = [x, y]; u.etat = 'engage'; allerA(u, x, y); radio('CDG Salles', u.ca, `${u.label}, défense du point sensible ${CARTE.lieuDit(x, y)}.`, 'DIR 654'); finOutil(); renderMoyens(); return; }
    if (o === 'ligne') {
      G.ligneEnCours.pts.push([x, y]);
      if (G.ligneEnCours.pts.length === 2) {
        const L = { id: 'L' + (G.lignes.length + 1), pts: G.ligneEnCours.pts }; G.lignes.push(L);
        const [a, b] = L.pts, len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        u.mission = 'ligne'; u.ligne = L.id; u.segLigne = L.pts; u.etat = 'engage'; allerA(u, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
        // autres UIFF deja sur cette ligne : chacune tient sa portion de 40 m
        radio('CDG Salles', u.ca, `${u.label}, ligne d'appui de ${Math.round(len)} m entre ${CARTE.dfci(...a)} et ${CARTE.dfci(...b)}, ouverture des lances sur ordre.`, 'DIR 654');
        const nReq = Math.ceil(len / 40);
        if (nReq > 1) evalue('rto', 'Ligne d\'appui : dimensionnement', `${Math.round(len)} m tenus par 1 UIFF (mémento : ${nReq} UIFF pour ${Math.round(len)} m)`, 'ko', '1 UIFF / 40 m, 2 / 80 m, 3 / 120 m. Penser à équilibrer U3 / U12 / GPF.');
        G.ligneEnCours = null; finOutil(); renderMoyens();
      }
      return;
    }
    if (o === 'mesure') { if (!G.mesure || G.mesure.length === 2) G.mesure = [[x, y]]; else { G.mesure.push([x, y]); const [a, b] = G.mesure; info(`Distance : ${Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]))} m, cap ${Math.round(CARTE.cap(b[0] - a[0], b[1] - a[1]))}°.`); } return; }
    if (o === 'gomme') { let bi = -1, bd = 40 / vue.s; G.dessins.forEach((d, i) => d.pts.forEach(p => { const dd = Math.hypot(p[0] - x, p[1] - y); if (dd < bd) { bd = dd; bi = i; } })); if (bi >= 0) G.dessins.splice(bi, 1); return; }
  }
  function finOutil() { G.outil = null; cvD.classList.remove('crayon'); $$('[data-outil]').forEach(x => x.setAttribute('aria-pressed', false)); G.dirtyFond = true; }
  function renderCrayons() {
    $('#crayons').innerHTML = CRAYONS.map(c => `<button data-cr="${c.n}" aria-pressed="${G.crayon === c.n}" title="${esc(c.nom)}"><i style="background:${c.c}"></i>${esc(c.court)}</button>`).join('');
    $$('[data-cr]').forEach(b => b.onclick = () => { const n = +b.dataset.cr; G.crayon = G.crayon === n ? null : n; G.outil = null; cvD.classList.toggle('crayon', !!G.crayon); renderCrayons(); info(G.crayon ? CRAYONS[n - 1].nom : ''); });
  }
  function renderLegende() {
    const el = $('#legende'); el.hidden = vue.fond !== 'peuplements';
    el.innerHTML = carte.combustibles.slice(1).map(c => `<div><i style="background:${c.couleur}"></i>${esc(c.nom)}</div>`).join('');
  }

  // =============================================================== rendu
  let cvFeu = null, ctxFeu = null, imFeu = null;
  function majFeuImage() {
    const c = carte;
    if (!cvFeu) { cvFeu = document.createElement('canvas'); cvFeu.width = c.w; cvFeu.height = c.h; ctxFeu = cvFeu.getContext('2d'); imFeu = ctxFeu.createImageData(c.w, c.h); }
    const d = imFeu.data, N = c.w * c.h, voir = G.fin;
    d.fill(0);
    for (let i = 0; i < N; i++) {
      if (F.ta[i] > F.t) continue;
      if (!voir && !G.vu[i]) continue;
      const e = F.etat(i), k = i * 4;
      if (e === 1) { d[k] = 255; d[k + 1] = 70 + ((i * 7) % 60); d[k + 2] = 0; d[k + 3] = 235; }
      else if (e === 3) { d[k] = 70; d[k + 1] = 90; d[k + 2] = 120; d[k + 3] = 200; }
      else { d[k] = 45; d[k + 1] = 38; d[k + 2] = 36; d[k + 3] = 190; }
    }
    ctxFeu.putImageData(imFeu, 0, 0);
  }
  function dessine(now) {
    if (G.dirtyFond) { vue.dessineFond(); G.dirtyFond = false; }
    if (G.dirtyFeu) { majFeuImage(); G.dirtyFeu = false; }
    const ctx = ctxD, dpr = vue.dpr, W = cvD.width / dpr, H = cvD.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    if (!G.feu) return;
    const sx = x => vue.sx(x), sy = y => vue.sy(y), s = vue.s;
    // feu (cellules vues)
    ctx.imageSmoothingEnabled = false;
    if (cvFeu) ctx.drawImage(cvFeu, sx(0), sy(carte.H), carte.W * s, carte.H * s);
    // panache de fumee (toujours visible)
    const b = G.bilan;
    const fx = b && b.actifs.length ? (b.emprise[0] + b.emprise[2]) / 2 : G.ix, fy = b && b.actifs.length ? (b.emprise[1] + b.emprise[3]) / 2 : G.iy;
    if (G.etatFeu !== 'maîtrisé') {
      const L = 900 + G.vent * 250, w0 = 40, w1 = 300 + G.vent * 40;
      for (let k = 0; k < 14; k++) {
        const t = k / 13, x = fx + F.wx * L * t, y = fy + F.wy * L * t, r = (w0 + (w1 - w0) * t) * s;
        ctx.fillStyle = `rgba(60,60,64,${0.16 * (1 - t) + 0.03})`; ctx.beginPath(); ctx.arc(sx(x), sy(y), Math.max(4, r), 0, Math.PI * 2); ctx.fill();
      }
    }
    // dessins ZI
    for (const d of G.dessins) {
      const c = CRAYONS[d.n - 1].c; ctx.strokeStyle = c; ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.beginPath(); d.pts.forEach((p, i) => i ? ctx.lineTo(sx(p[0]), sy(p[1])) : ctx.moveTo(sx(p[0]), sy(p[1]))); if (d.ferme) { ctx.closePath(); ctx.fillStyle = c + '22'; ctx.fill(); } ctx.stroke();
      if (d.pts.length === 1) { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(sx(d.pts[0][0]), sy(d.pts[0][1]), 5, 0, Math.PI * 2); ctx.fill(); }
    }
    // lignes d'appui
    for (const L of G.lignes) { ctx.strokeStyle = '#1d4ed8'; ctx.lineWidth = 6; ctx.setLineDash([10, 6]); ctx.beginPath(); ctx.moveTo(sx(L.pts[0][0]), sy(L.pts[0][1])); ctx.lineTo(sx(L.pts[1][0]), sy(L.pts[1][1])); ctx.stroke(); ctx.setLineDash([]); }
    // points d'eau actives
    for (const p of Object.values(G.pe)) { const q = carte.points_eau.find(z => z.n === p.n); CARTE.symbolePE(ctx, sx(q.p[0]), sy(q.p[1]), q, 1.3, true); ctx.fillStyle = '#1d4ed8'; ctx.font = '700 11px "IBM Plex Sans"'; ctx.fillText(p.actif ? p.moyen : p.moyen + ' …', sx(q.p[0]) + 16, sy(q.p[1]) - 14); }
    // point a atteindre, point d'engagement
    if (G.ptAtteindre) marqueur(ctx, sx(G.ptAtteindre[0]), sy(G.ptAtteindre[1]), '#9a72ff', 'PA');
    if (G.ptEngagement && G.ptEngagement !== G.ptAtteindre) marqueur(ctx, sx(G.ptEngagement[0]), sy(G.ptEngagement[1]), '#16a34a', 'PE');
    // itineraires
    for (const o of [G.cdg, ...G.unites]) if (o.path) { ctx.strokeStyle = o === G.cdg ? 'rgba(154,114,255,.8)' : 'rgba(37,99,235,.6)'; ctx.lineWidth = 3; ctx.setLineDash([6, 5]); ctx.beginPath(); ctx.moveTo(sx(o.x), sy(o.y)); for (let i = o.pi; i < o.path.length; i++) ctx.lineTo(sx(o.path[i].x), sy(o.path[i].y)); ctx.stroke(); ctx.setLineDash([]); }
    // engins
    for (const u of G.unites) if (u.x != null) engin(ctx, sx(u.x), sy(u.y), u.label.split(' ').slice(0, 2).join(' '), G.sel === u.id ? '#f08c2a' : '#e2373f', u);
    engin(ctx, sx(G.cdg.x), sy(G.cdg.y), 'CDG', '#9a72ff');
    // mesure
    if (G.mesure && G.mesure.length) { const a = G.mesure[0], b2 = G.mesure[1] || G.souris; if (b2) { ctx.strokeStyle = '#111'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(sx(a[0]), sy(a[1])); ctx.lineTo(sx(b2[0]), sy(b2[1])); ctx.stroke(); ctx.fillStyle = '#111'; ctx.font = '700 13px "IBM Plex Sans"'; ctx.fillText(Math.round(Math.hypot(b2[0] - a[0], b2[1] - a[1])) + ' m', sx(b2[0]) + 8, sy(b2[1])); } }
    if (G.ligneEnCours && G.ligneEnCours.pts.length === 1 && G.souris) { const a = G.ligneEnCours.pts[0]; ctx.strokeStyle = '#1d4ed8'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(sx(a[0]), sy(a[1])); ctx.lineTo(sx(G.souris[0]), sy(G.souris[1])); ctx.stroke(); }
    // rose des vents
    ctx.save(); ctx.translate(W - 60, H - 70); ctx.fillStyle = 'rgba(11,19,34,.85)'; ctx.beginPath(); ctx.arc(0, 0, 40, 0, Math.PI * 2); ctx.fill();
    ctx.rotate((G.dir + 180) * Math.PI / 180); ctx.fillStyle = '#e8eef4'; ctx.beginPath(); ctx.moveTo(0, -28); ctx.lineTo(9, 10); ctx.lineTo(0, 4); ctx.lineTo(-9, 10); ctx.closePath(); ctx.fill(); ctx.restore();
    ctx.fillStyle = '#e8eef4'; ctx.font = '600 11px "IBM Plex Mono"'; ctx.textAlign = 'center'; ctx.fillText(G.vent + ' m/s', W - 60, H - 16); ctx.fillText('N ↑', W - 60, H - 118 + 0); ctx.textAlign = 'start';
    // echelle
    const m = [100, 200, 500, 1000, 2000].find(v => v * s > 80) || 2000; ctx.fillStyle = 'rgba(11,19,34,.85)'; ctx.fillRect(10, H - 74, m * s + 20, 26); ctx.fillStyle = '#fff'; ctx.fillRect(20, H - 58, m * s, 4); ctx.font = '600 11px "IBM Plex Mono"'; ctx.fillText(m + ' m', 20, H - 62);
  }
  function marqueur(ctx, x, y, c, t) { ctx.fillStyle = c; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 9, y - 18); ctx.lineTo(x + 9, y - 18); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.fillStyle = '#fff'; ctx.font = '700 9px "IBM Plex Sans"'; ctx.textAlign = 'center'; ctx.fillText(t, x, y - 9); ctx.textAlign = 'start'; }
  function engin(ctx, x, y, t, c, u) {
    ctx.fillStyle = c; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(x - 11, y - 8, 22, 16, 3); ctx.fill(); ctx.stroke();
    if (u && u.actif && G.t - u.actif < 6) { ctx.strokeStyle = '#38bdf8'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, 16 + (performance.now() / 80) % 8, 0, Math.PI * 2); ctx.stroke(); }
    ctx.font = '700 11px "IBM Plex Sans"'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.strokeText(t, x + 14, y + 4); ctx.fillStyle = '#111'; ctx.fillText(t, x + 14, y + 4);
  }

  // =============================================================== HUD, radio, memento
  function majHUD() {
    $('#heure').textContent = heure();
    $('#meteo').textContent = `Vent ${G.vent} m/s du ${CARTE.rose(G.dir)} · ${G.sech}`;
    // arrivee du CDG au point a atteindre
    if (G.phase >= 1 && !G.cdg.path && G.ptAtteindre && !G.cdgArrive) { G.cdgArrive = true; G.tArriveeCDG = G.t; if (G.phase >= 3) renderPhase(); info('Vous êtes arrivé au point à atteindre.'); }
    if (G.phase === 3 && G.cdgArrive && !$('#f-arr')) renderPhase();
    if (G.c33Prevu && G.t >= G.tC33 && !G.c33) { G.c33 = true; radio('Charlie 33', 'CDG Salles', 'Charlie 33 sur zone, je vous transmets la situation.', 'Air/Air'); observe(); }
    if (!$('#o-moyens').hidden && Math.floor(G.t) % 8 === 0) renderMoyens();
  }
  let filtre = 'tous';
  function renderRadio() {
    const can = ['tous', ...new Set(G.radio.map(r => r.canal))];
    $('#filtres').innerHTML = can.map(c => `<button data-f="${c}" aria-pressed="${filtre === c}">${c}</button>`).join('');
    $$('#filtres button').forEach(b => b.onclick = () => { filtre = b.dataset.f; renderRadio(); });
    $('#radio').innerHTML = G.radio.filter(r => filtre === 'tous' || r.canal === filtre).slice().reverse().map(r => `<li class="${r.cls}"><small>${hm(G.heure0 + r.t)} · ${esc(r.canal)} · ${esc(r.de)}${r.a ? ' → ' + esc(r.a) : ''}</small>${esc(r.txt)}</li>`).join('');
  }
  function renderMemento() {
    $('#o-memento').innerHTML = `<div class="mem"><h2>Mémento FDF</h2>
      <h3>Bases de dimensionnement</h3>
      <table><tr><th>Ligne d'appui / attaque de front</th><th>40 m</th><th>80 m</th><th>120 m</th></tr><tr><td>UIFF</td><td>1</td><td>2</td><td>3</td></tr></table>
      <table><tr><th>Percée de flanc</th><th>100 m</th><th>200 m</th><th>300 m</th></tr><tr><td>UIFF</td><td>1</td><td>2</td><td>3</td></tr></table>
      <table><tr><th>Jalonnement</th><th></th></tr><tr><td>U3 LDV FDF (6/8 bars)</td><td>100 m</td></tr><tr><td>U3 lance 40/10 (6 bars)</td><td>200 m</td></tr><tr><td>U12 LDV FDF</td><td>200 m</td></tr><tr><td>U12 lance 40/10</td><td>400 m</td></tr></table>
      <table><tr><th>Largage</th><th>120 m</th><th>150 m</th></tr><tr><td>Canadairs</td><td>1</td><td>2</td></tr><tr><td>Dash 8</td><td></td><td>1</td></tr></table>
      <p>Alimentation : jusqu'à 3 UIFF → MPF ; au-delà → 1 MPR ou MPRI. Traitement des lisières : 1 UIFF / 200 m. Données valables jusqu'à 7 000 kW/m, eau sans additif.</p>
      <h3>Vitesse de propagation (fiche 1.2.2)</h3>
      <table><tr><th>Vent</th><th>Propagation</th><th>Attaque de front</th><th>Ligne d'appui</th></tr>
      <tr><td>≤ 7 m/s</td><td>≤ 700 m/h</td><td>Oui</td><td>Oui</td></tr><tr><td>7 à 14 m/s</td><td>700 à 1 400 m/h</td><td>Oui</td><td>Oui</td></tr><tr><td>14 à 21 m/s</td><td>1 400 à 2 100 m/h</td><td>Initiative COS</td><td>Oui (échelonnée)</td></tr><tr><td>> 21 m/s</td><td>> 2 100 m/h</td><td>Non</td><td>Non</td></tr></table>
      <p>Règle rapide : vent en m/s × 100 = vitesse en m/h. Surface ≈ profondeur × front / 2, front ≈ 1/3 de la profondeur.</p>
      <h3>Transmissions</h3>
      <p>GRP 272 : CODIS (messages). DIR 654 : CDG ↔ chefs d'agrès (dès 4 moyens, niveau 1). DIR du groupement : chefs d'agrès ↔ engins. Canal 18 (sud) ou 23 (nord) : air-sol avec les ABE. Charlie 33 : hélicoptère de commandement.</p>
      <h3>Règle des 3 P</h3><p>Permanence de l'eau, de l'observation, des liaisons radio. Cheminement de repli systématique.</p></div>`;
  }

  // =============================================================== fin, debriefing
  function termine() {
    G.fin = true; G.dirtyFeu = true; setPhase('debrief');
    const tot = G.evals.length, ok = G.evals.filter(e => e.res === 'ok').length, mi = G.evals.filter(e => e.res === 'mi').length;
    const b = F.bilan();
    const parPhase = PHASES.slice(0, 8).map(([k, n]) => {
      const L = G.evals.filter(e => e.phase === k); if (!L.length) return '';
      return `<h3>${n}</h3><div class="eval">${L.map(e => `<div class="${e.res}"><span>${esc(e.item)}<small>${esc(e.detail)}${e.conseil ? ' — ' + esc(e.conseil) : ''}</small></span></div>`).join('')}</div>`;
    }).join('');
    const refl = REFLEXES.map(([k, t]) => `<div class="${G.reflexes[k] != null ? 'ok' : 'ko'}"><span>${esc(t)}<small>${G.reflexes[k] != null ? hm(G.heure0 + G.reflexes[k]) : 'non fait'}</small></span></div>`).join('');
    $('#o-phase').innerHTML = `<h2>Débriefing</h2>
      <p>${ok} points acquis, ${mi} partiels, ${tot - ok - mi} à revoir. Surface brûlée : ${b.ha.toFixed(1)} ha. Feu ${G.etatFeu}${G.tFixe ? ', fixé à ' + hm(G.heure0 + G.tFixe) : ''}.</p>
      <p class="aide">Toute la surface brûlée est maintenant affichée sur la carte (y compris les zones non reconnues).</p>
      ${parPhase}<h3>Actions réflexes</h3><div class="eval">${refl}</div>
      <div class="btns"><button class="btn" onclick="location.reload()">Nouvelle intervention</button></div>`;
    $$('[data-onglet]')[0].click();
  }

  // acces pour les essais automatiques
  window.FDFJ = { vue: () => vue, pas, ordre, clicOutil, renderPhase, termine, setPhase, F: () => F };
  init();
})();
