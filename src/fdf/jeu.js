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
  const NET = window.NET || { mode: 'solo', cmd() {}, log() {}, joueurs: {} };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const hm = t => { const m = Math.floor(t / 60); return String(Math.floor(m / 60) % 24).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };

  const PHASES = [
    ['zi', 'Analyse ZI'], ['dpif', 'DPIF'], ['transit', 'En transit'], ['arrivee', 'Arrivée'],
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
    { nom: 'Belin-Béliet', p: [12500, 2600], delai: 4 * 60 },
    { nom: 'Le Barp', p: [12500, 9400], delai: 3.5 * 60 },
    { nom: 'Mios', p: [9000, 10750], delai: 3.5 * 60 },
    { nom: 'Sanguinet', p: [150, 2200], delai: 5 * 60 },
    { nom: 'Biganos', p: [6400, 10750], delai: 6 * 60 },
    { nom: 'Marcheprime', p: [12000, 10750], delai: 6 * 60 },
    { nom: 'Saint-Magne', p: [12500, 6000], delai: 5.5 * 60 },
  ];
  const CCF_L = 6000, DEBIT_LDV = 250;           // litres par CCF (6 000 L par defaut au SDIS 33), L/min par lance de tourelle (LDV 250)

  // niveaux de difficulte
  const NIVEAUX = {
    debutant: { nom: 'Débutant', vents: [3, 4, 5], ha0: [0.4, 0.7], erreurTicket: 0, vue: 450, aides: true, retour: true, detresses: 0, tol: 1.5 },
    intermediaire: { nom: 'Intermédiaire', vents: [4, 5, 6, 7], ha0: [0.6, 1], erreurTicket: 0.35, vue: 300, aides: false, retour: false, detresses: 1, tol: 1 },
    expert: { nom: 'Expert', vents: [5, 6, 7, 8], ha0: [0.8, 1.3], erreurTicket: 0.5, vue: 250, aides: false, retour: false, detresses: 2, tol: 0.7 },
  };
  // risque du jour : secheresse des vegetaux et composition du depart (PROVISOIRE, en attente du tableau SDIS 33)
  const RISQUES = [
    { k: 'faible', nom: 'Faible', sech: 'moderee', uiff: 2, hr: [45, 60] },
    { k: 'modere-bas', nom: 'Modéré bas', sech: 'moderee', uiff: 2, hr: [35, 50] },
    { k: 'modere-haut', nom: 'Modéré haut', sech: 'forte', uiff: 3, hr: [28, 40] },
    { k: 'severe', nom: 'Sévère', sech: 'forte', uiff: 3, hr: [22, 32] },
    { k: 'tres-severe', nom: 'Très sévère', sech: 'extreme', uiff: 4, hr: [16, 26] },
    { k: 'exceptionnel', nom: 'Exceptionnel', sech: 'extreme', uiff: 4, hr: [12, 20] },
  ];
  const RISQUES_NIV = { debutant: ['faible', 'modere-bas', 'modere-haut'], intermediaire: ['modere-bas', 'modere-haut', 'severe'], expert: ['modere-haut', 'severe', 'tres-severe'] };
  // cinetique d'exercice : les engins roulent plus vite que la realite pour que les moyens arrivent en jeu
  const CINE = 2.4;
  // surface maximale d'un feu de chef de groupe (au-dela, montee en puissance)
  const HA_MAX_CDG = 6;
  // praticabilite hors piste d'un CCF par peuplement (part de 6 km/h), d'apres la presentation du massif
  const PRATIC = [1, 1, 1, 0.6, 0.45, 0.4, 0.12, 0.15, 0.5, 0.6, 0.08, 0.3, 0.3, 0.05];
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
    $('#go').onclick = () => demarre(confAccueil());
    bindUI();
    if (window.NET) { NET.prepareAccueil(); NET.pret(); }
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

  // parametres de la partie (identiques chez l'hote et les clients : meme graine, meme carte inventee)
  function confAccueil() { return { seed: (Date.now() & 0xffff) || 7, niv: $('#c-niv').value, vent: $('#c-vent').value, dir: $('#c-dir').value, hygro: $('#c-hygro').value, risque: $('#c-risque').value, lieu: $('#c-lieu').value }; }
  function demarre(conf) {
    const seed = conf.seed, R = rng(seed);
    const nivK = conf.niv, niv = NIVEAUX[nivK];
    const vent = !conf.vent || conf.vent === 'alea' ? niv.vents[Math.floor(R() * niv.vents.length)] : +conf.vent;
    const dirs = [270, 250, 225, 300, 315, 0, 45, 90, 200];
    const dir = !conf.dir || conf.dir === 'alea' ? dirs[Math.floor(R() * dirs.length)] + Math.round((R() - 0.5) * 20) : +conf.dir;
    const rks = RISQUES_NIV[nivK];
    const rkAlea = rks[Math.floor(R() * rks.length)];
    const risque = RISQUES.find(r => r.k === conf.risque) || RISQUES.find(r => r.k === rkAlea);
    const hygro = !conf.hygro || conf.hygro === 'alea' ? risque.hr[0] + Math.floor(R() * (risque.hr[1] - risque.hr[0])) : +conf.hygro;
    const sech = conf.sech || risque.sech;
    const [ix, iy] = choisitDepart(R, conf.lieu);
    Object.assign(G, {
      seed, R, vent, dir, sech, hygro, risque, ix, iy, t: 0, heure0: (14 * 60 + 5 + Math.floor(R() * 90)) * 60, age: 0, ha0: niv.ha0[0] + R() * (niv.ha0[1] - niv.ha0[0]), niv, nivK, mesMsgs: [],
      phase: 0, faites: {}, evals: [], radio: [], dessins: [], unites: [], pe: {}, reflexes: {}, cr: 0, msgs: {}, vu: new Uint8Array(carte.w * carte.h),
      dirtyFond: true, sel: null, outil: null, crayon: null, demandes: [], lignes: [], fin: false, etatFeu: 'en cours', tFixe: null, tMaitrise: null,
    });
    G.inv = INV.genere(carte, R, nivK);
    initReserves();
    F = G.feu = new FEU.Feu(carte, { vent, dir, secheresse: sech, hygro, graine: seed });
    F.allume(ix, iy, 0);
    // feu deja developpe a l'alerte : surface cible selon le niveau (dimension chef de groupe)
    for (let a = 60; a <= 90 * 60; a += 60) { F.avance(a); G.age = a; if (F.bilan().ha >= G.ha0) break; }
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
    // composition du depart selon le risque du jour
    ajouteUIFF(CIS[0], 60);
    const autres = CIS.slice(1, 4).sort(() => R() - 0.5).concat(CIS.slice(4));
    for (let k = 1; k < risque.uiff; k++) { const c = autres[k - 1]; ajouteUIFF(c, 60 + c.delai); }
    // ticket de depart : la tour de guet peut se tromper d'un carre
    const off = R() < niv.erreurTicket ? [(R() < 0.5 ? -1 : 1) * 400, 0] : [0, 0];
    G.ticketXY = [ix + off[0], iy + off[1]];
    G.ticket = { commune: CARTE.commune(ix, iy), ld: CARTE.lieuDit(ix + off[0], iy), coord: CARTE.dfci(ix + off[0], iy + off[1]), source: 'tour de guet de Salles' };
    radio('CODIS 33', 'CDG Salles', `Départ feu de forêt. Commune de ${G.ticket.commune}, lieu-dit ${G.ticket.ld}, coordonnées ${G.ticket.coord}. Fumée signalée par la ${G.ticket.source}. Départ : CDG Salles, ${G.unites.map(u => u.label).join(', ')}.`, 'GRP 272', 'codis');
    document.body.classList.remove('accueil');
    vue.centre(G.cdg.x - 1500, G.cdg.y - 1500, 0.09);
    renderPhases(); renderPhase(); renderMoyens(); renderMemento(); renderTicket(); renderCrayons(); majHUD();
    API.carte = carte; AVIONS.init(API); DETRESSE.init();
    G.conf = conf;
    enCours = true; last = performance.now(); requestAnimationFrame(boucle);
  }

  // moyens : UIFF (2 CCF + VLHR), GPF (gros porteur 12 m3 : point d'eau mobile), chenillette (tout terrain),
  // lot EGL (etablissement de grande longueur), bulldozer (creation d'acces ou de bande), Charlie 33
  const TYPES_MOYENS = {
    UIFF: { cap: 2 * CCF_L, delai: 0, ordres: null },
    GPF: { cap: 12000, delai: 12 * 60, ordres: [['alpha', 'Point d\'eau mobile ici'], ['aller', 'Aller à…'], ['eau', 'Se remplir']] },
    Chenillette: { cap: 2000, delai: 15 * 60, pratic: 0.7, ordres: [['front', 'Attaque de front'], ['flancG', 'Attaque flanc gauche'], ['flancD', 'Attaque flanc droit'], ['percee', 'Percée de flanc'], ['lisiere', 'Traitement des lisières'], ['eau', 'Au point d\'eau'], ['aller', 'Aller à…']] },
    'Lot EGL': { cap: 0, delai: 15 * 60, ordres: [['egl', 'Établir vers…'], ['aller', 'Aller à…'], ['attente', 'Replier']] },
    Bulldozer: { cap: 0, delai: 20 * 60, ordres: [['bande', 'Tracer une bande…'], ['aller', 'Aller à…'], ['attente', 'Arrêt']] },
  };
  let nType = {};
  function ajouteMoyen(type, cis, tArrivee) {
    if (type === 'UIFF') return ajouteUIFF(cis, tArrivee);
    nType[type] = (nType[type] || 0) + 1;
    const T = TYPES_MOYENS[type], n = nType[type];
    const u = { id: type.replace(/\W/g, '') + n, type, label: `${type} ${n} ${cis.nom}`, cis: cis.nom, ca: `CA ${type} ${n}`, x: null, y: null, eau: T.cap, cap: T.cap, etat: 'alerte', tDispo: G.t + tArrivee, mission: null, path: null, journal: [] };
    G.unites.push(u); return u;
  }
  function ajouteUIFF(cis, tArrivee) {
    const n = G.unites.filter(u => !u.type || u.type === 'UIFF').length + 1;
    const u = { id: 'U' + n, type: 'UIFF', label: `UIFF ${n} ${cis.nom}`, cis: cis.nom, ca: `CA UIFF ${n}`, x: null, y: null, eau: 2 * CCF_L, cap: 2 * CCF_L, etat: 'alerte',
      tDispo: G.t + tArrivee, mission: null, path: null, msg: '', cible: null, auPE: null, journal: [] };
    G.unites.push(u); return u;
  }

  // =============================================================== temps
  function boucle(now) {
    if (!enCours) return;
    const dt = Math.min(0.25, (now - last) / 1000); last = now;
    if (NET.mode === 'client') clientTick(now);
    else {
      if (rythme > 0 && !G.fin) {
        G.acc = (G.acc || 0) + dt * rythme;
        while (G.acc >= 2) { pas(2); G.acc -= 2; }
      }
      if (NET.mode === 'hote') publieHote(now);
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
    AVIONS.pas(dt); DETRESSE.pas();
    if (G.besoinReseed && G.t - (G.tReseed || 0) > 8) { F.reseed(); G.besoinReseed = false; G.tReseed = G.t; }
    if (Math.floor(G.t) % 10 === 0) observe();
    evenements();
    if (Math.floor(G.t) % 4 === 0) { G.dirtyFeu = true; majHUD(); }
  }

  // =============================================================== deplacements
  function allerA(o, x, y, horsPiste) {
    const r = CARTE.route(o.x, o.y, x, y); if (!r) return false;
    // sans ordre d'engagement, on reste sur les pistes : arret au point de piste le plus proche
    if (!horsPiste && r.pts.length > 2) { const fin = r.pts[r.pts.length - 1], av = r.pts[r.pts.length - 2]; const dHP = Math.hypot(fin.x - av.x, fin.y - av.y); r.pts.pop(); r.L -= dHP; r.t -= dHP / 1.4; }
    // le dernier tronçon (de la piste au point vise) se fait hors piste
    r.pts[r.pts.length - 1].hp = !!horsPiste; r.pts[1].hp = Math.hypot(r.pts[1].x - o.x, r.pts[1].y - o.y) > 30;
    let Lr = 0; for (let i = 2; i < r.pts.length - 1; i++) Lr += Math.hypot(r.pts[i].x - r.pts[i - 1].x, r.pts[i].y - r.pts[i - 1].y);
    o.path = r.pts; o.pi = 1; o.dest = [x, y]; o.vit = Math.max(4, Lr / Math.max(1, r.t - (r.L - Lr) / 1.4)) * CINE; o.tTrajet = r.t / CINE; return r;
  }
  function vitesseHPu(o, x, y) { const v = vitesseHP(x, y); return o && o.type === 'Chenillette' ? Math.max(v, 6 / 3.6 * 0.7) : v; }
  function vitesseHP(x, y) {
    const i = CARTE.idx(x, y); if (i < 0) return 0.5;
    const f = carte.fuel[i], brule = F.ta[i] <= F.t;
    return (6 / 3.6) * (brule ? 0.6 : PRATIC[f]);
  }
  // crastes et fosses : franchissement tres lent hors des passages busés
  function crasteEntre(x0, y0, x1, y1) {
    for (const h of carte.hydro) for (let i = 0; i < h.p.length - 1; i++) {
      const [ax, ay] = h.p[i], [bx, by] = h.p[i + 1];
      const d = (x1 - x0) * (by - ay) - (y1 - y0) * (bx - ax); if (Math.abs(d) < 1e-9) continue;
      const t = ((ax - x0) * (by - ay) - (ay - y0) * (bx - ax)) / d, u = ((ax - x0) * (y1 - y0) - (ay - y0) * (x1 - x0)) / d;
      if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return true;
    }
    return false;
  }
  function deplace(o, dt) {
    if (!o.path) return false;
    if (o.bloque > 0) { o.bloque -= dt; return false; }
    let d = (o.path[o.pi].hp ? vitesseHPu(o, o.x, o.y) : (o.vit || 8)) * dt;
    while (d > 0 && o.path) {
      const p = o.path[o.pi], dx = p.x - o.x, dy = p.y - o.y, L = Math.hypot(dx, dy);
      if (p.hp && !p.crasteVue && o !== G.cdg && (p.crasteVue = true) && crasteEntre(o.x, o.y, p.x, p.y)) { o.bloque = 240; if (o.ca) radio(o.ca, 'CDG Salles', `${o.label} : craste sur le cheminement, je cherche un passage.`, 'DIR 654'); return false; }
      if (L <= d) { o.x = p.x; o.y = p.y; d -= L; o.pi++; if (o.pi >= o.path.length) { o.path = null; return true; } }
      else { o.x += dx / L * d; o.y += dy / L * d; d = 0; }
    }
    return false;
  }

  // =============================================================== observation (brouillard)
  function observe() {
    const obs = [G.cdg, ...G.unites.filter(u => u.x != null)];
    const c = carte, R = Math.round(G.niv.vue / c.res);
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
    if (u.etat === 'hors service') return;
    if (u.etat === 'alerte' && G.t >= u.tDispo) {
      const cis = CIS.find(c => c.nom === u.cis);
      u.x = cis.p[0]; u.y = cis.p[1]; u.etat = 'transit';
      const dest = G.ptEngagement || G.ticketXY || [G.cdg.x, G.cdg.y];
      allerA(u, dest[0], dest[1]);
      radio(u.ca, 'CODIS 33', `${u.label} en route.`, 'GRP 272');
    }
    if (u.x == null) return;
    const arrive = deplace(u, dt);
    if (arrive && u.etat === 'transit') {
      u.etat = 'attente'; u.tAttente = G.t;
      radio(u.ca, 'CDG Salles', `${u.label} au point d'engagement, ${Math.round(u.eau)} litres, j'attends vos ordres.`, G.dir654 ? 'DIR 654' : 'GRP 272');
    }
    if (arrive && u.surPlace) { u.surPlace(); u.surPlace = null; }
    if (arrive && u.etat === 'vers_pe') { u.etat = 'remplissage'; u.tRemp = G.t; }
    if (u.etat === 'remplissage') {
      const pe = G.pe[u.auPE], debit = pe ? pe.debit : 30;    // m3/h
      const q = Math.min(u.cap - u.eau, debit * 1000 / 3600 * dt, pe && pe.gpf ? pe.gpf.eau : 1e9, pe && pe.reserve ? pe.volume : 1e9);
      u.eau += q; if (pe && pe.reserve) { pe.volume -= q; if (pe.volume <= 0) { radio(u.ca, 'CDG Salles', `Réserve ${pe.n} vide.`, 'DIR 654', 'alerte'); delete G.pe[pe.n]; u.eau = Math.max(u.eau, u.cap - 1); } } if (pe && pe.gpf) { pe.gpf.eau -= q; if (pe.gpf.eau < 1000) { u.eau = Math.max(u.eau, u.cap - 1); radio(pe.gpf.ca, 'CDG Salles', `${pe.gpf.label} vide, je pars me remplir.`, 'DIR 654'); delete G.pe[u.auPE]; pe.gpf.mission = null; pe.gpf.eau = Math.max(0, pe.gpf.eau); gereEau(pe.gpf); } }
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
    if (u.type === 'GPF') return;                 // point d'eau mobile : rien a faire sur place
    if (u.type === 'Lot EGL') return actionEGL(u, dt);
    if (u.type === 'Bulldozer') return actionBull(u, dt);
    if (u.eau <= 0) { gereEau(u); return; }
    if (m === 'ligne') return actionLigne(u, dt);
    if (m === 'defense') return actionDefense(u, dt);
    if (m === 'attente') return;
    // attaques : rejoindre le front puis eteindre en progressant
    const cib = cibleFront(u); if (!cib) return;
    const d = Math.hypot(cib[0] - u.x, cib[1] - u.y);
    const vMarche = { front: 10, flancG: 30, flancD: 30, percee: 40, lisiere: 25 }[m] / 60;   // m/s en action
    const vApproche = vitesseHPu(u, u.x, u.y);
    const v = d > 40 ? vApproche : Math.min(vMarche, vApproche * 1.5 + 0.05);
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

  // lot EGL : lance au bout d'un etablissement de 300 m maximum, alimente par l'engin le plus proche (UIFF ou GPF)
  function actionEGL(u, dt) {
    if (!u.cible) return;
    const alim = G.unites.filter(v => v !== u && v.x != null && v.eau > 500 && (v.type === 'UIFF' || v.type === 'GPF') && Math.hypot(v.x - u.x, v.y - u.y) < 150).sort((a, b) => b.eau - a.eau)[0];
    if (!alim) { if (!u.alerteAlim) { u.alerteAlim = true; radio(u.ca, 'CDG Salles', 'Établissement prêt, pas d\'engin d\'alimentation à moins de 150 m.', 'DIR 654', 'alerte'); } return; }
    u.alerteAlim = false;
    const [x, y] = u.cible, cells = frontPres(x, y, 60); if (!cells.length) return;
    const n = F.traite(x, y, 25, 'eteint'); F.traite(x, y, 35, 'mouille', 120); if (n) G.besoinReseed = true;
    alim.eau = Math.max(0, alim.eau - 500 / 60 * dt); u.actif = G.t;
  }
  // bulldozer : bande de 6 m mise a nu, a 1,5 km/h
  function actionBull(u, dt) {
    if (!u.bande) return;
    const [a, b] = u.bande, L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    u.av = Math.min(L, (u.av || 0) + 1.5 / 3.6 * dt);
    const t = u.av / L, x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t;
    u.x = x; u.y = y;
    for (let k = -1; k <= 1; k++) { const i = CARTE.idx(x + (b[1] - a[1]) / L * k * 3, y - (b[0] - a[0]) / L * k * 3); if (i >= 0 && F.ta[i] > F.t) { carte.fuel[i] = 0; } }
    G.dirtyFond = true; u.actif = G.t; G.besoinReseed = true;
    if (u.av >= L) { u.bande = null; u.mission = 'attente'; radio(u.ca, 'CDG Salles', `Bande terminée (${Math.round(L)} m).`, 'DIR 654'); }
  }
  function gereEau(u) {
    // permanence de l'eau : un CCF part au point d'eau pendant que l'autre poursuit (ou l'UIFF entiere si vide)
    const actifs = Object.values(G.pe).filter(p => p.actif && (!p.gpf || p.gpf.eau > 1000));
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
    // feu hors dimension chef de groupe
    if (!G.horsDim && G.bilan && G.bilan.ha > HA_MAX_CDG && G.etatFeu === 'en cours') {
      G.horsDim = true;
      radio('CODIS 33', 'CDG Salles', `CDG Salles, le feu dépasse ${HA_MAX_CDG} ha : nous engageons un chef de colonne et un deuxième groupe. Poursuivez votre action et préparez votre compte rendu pour son arrivée.`, 'GRP 272', 'codis');
      evalue('rto', 'Feu contenu dans la dimension chef de groupe', `${G.bilan.ha.toFixed(1)} ha à ${heure()}`, 'ko', `Un feu de chef de groupe se traite sous ${HA_MAX_CDG} ha : engagement immédiat de la 1re UIFF sur la tête ou le flanc dangereux, demande de renforts dès le message d'ambiance.`);
    }
    // points d'eau en cours d'activation
    for (const p of Object.values(G.pe)) if (!p.actif && G.t >= p.tActif && p.sec) { delete G.pe[p.n]; radio('Point Alpha', 'CDG Salles', `Point d'eau ${p.n} : niveau insuffisant, impossible d'amorcer. Point d'eau non pérenne, à sec.`, 'DIR 654', 'alerte'); evalue('rto', `Point d'eau ${p.n} non pérenne`, 'à sec à l\'activation', 'mi', 'Triangle à moitié bleu : point d\'eau non pérenne, prévoir une solution de repli.'); }
    for (const p of Object.values(G.pe)) if (!p.actif && G.t >= p.tActif) { p.actif = true; radio('Point Alpha', 'CDG Salles', `Point d'eau ${p.n} opérationnel (${p.moyen}, ${p.debit} m³/h).`, 'DIR 654'); }
    // renforts
    for (const d of G.demandes) if (!d.fait && G.t >= d.t) {
      d.fait = true; const type = d.type || 'UIFF';
      if (type === 'Charlie 33') { G.c33Prevu = true; G.tC33 = G.t + 16 * 60; radio('CODIS 33', 'CDG Salles', 'Charlie 33 engagé, sur zone dans une quinzaine de minutes. Contact sur votre fréquence air-sol.', 'GRP 272', 'codis'); continue; }
      if (type === 'Canadair' || type === 'Dash 8') { if (window.AVIONS) AVIONS.demande(type, d.n || 1); continue; }
      for (let k = 0; k < d.n; k++) { const cis = CIS[1 + ((G.unites.length + k) % (CIS.length - 1))]; ajouteMoyen(type, cis, cis.delai + (TYPES_MOYENS[type] ? TYPES_MOYENS[type].delai : 0) + k * 60); }
      radio('CODIS 33', 'CDG Salles', `${d.n} ${type} engagé(s) vers votre point d'engagement.`, 'GRP 272', 'codis'); renderMoyens();
    }
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
  // actions reflexes relevees d'apres les messages et les ordres
  function reflexe(k) { if (G.reflexes[k] == null && (G.tArrivee || G.cdgArrive)) { G.reflexes[k] = G.t; if (G.phase === 4) setPhase('reflexes'); } }
  function detecteReflexes(txt, canal) {
    const t = txt.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (canal === 'DIR 654') { if (!G.dir654) { G.dir654 = true; G.unites.filter(u => u.x != null && u.etat !== 'alerte' && !u.uid).slice(0, 3).forEach(u => setTimeout(() => radio(u.ca, 'CDG Salles', 'Reçu 5 sur 5.', 'DIR 654'), 400)); } reflexe('radio'); }
    if (/repli|cheminement|securite|3 ?p\b|autoprotection|zone refuge/.test(t)) reflexe('securite');
    if (/observat|guetteur|charlie 33/.test(t)) reflexe('observation');
    if (/gendarmerie|police|elus?\b|maire|enedis|rte\b|dfci/.test(t)) reflexe('autorites');
    if (/protection|defense|defendez|evacu|confin/.test(t)) reflexe('sensibles');
  }
  // o.humain : message dit par un joueur (chef d'agres, formateur)
  function radio(de, a, txt, canal, cls, o) {
    // engin tenu par un joueur : ce que le moteur lui fait « dire » devient une situation que lui seul voit
    if (NET.mode === 'hote' && !(o && o.humain)) { const hu = G.unites.find(x => x.uid && x.ca === de); if (hu) { NET.log({ k: 'radio', r: { t: G.t, de: 'Situation', a: hu.label, txt, canal: 'situation', cls: cls || 'info', pour: hu.uid } }); return; } }
    if (de === 'CDG Salles') { detecteReflexes(txt, canal); if (window.DETRESSE && G.feu) DETRESSE.message(canal, txt); }
    if (de === 'CDG Salles' && canal === 'GRP 272') G.mesMsgs.push({ t: G.t, txt });
    const r = { t: G.t, de, a, txt, canal, cls: cls || (de === 'CDG Salles' ? 'moi' : '') };
    if (NET.mode === 'hote') NET.log({ k: 'radio', r });
    recoitRadio(r, de !== 'CDG Salles' && de !== 'COS ' + CARTE.commune(G.ix, G.iy));
  }
  function recoitRadio(r, notifie) {
    G.radio.push(r);
    renderRadio(); const nb = $('#nb-radio'); if (nb && $('#o-radio').hidden) nb.textContent = '•';
    const { de, txt, canal, cls } = r;
    if (notifie && /alerte|codis|humain|info/.test(cls || '')) info(`${de === 'Situation' ? 'Situation' : de} : ${txt}`);
    if (notifie) { const b = document.querySelector(`.poste[data-poste="${canal === 'situation' ? 'DIR 654' : canal}"]`); if (b && (cls === 'alerte' || canal === 'Canal 18' || cls === 'codis' || cls === 'humain' || cls === 'info')) b.classList.add('appel'); }
  }
  function journal(txt) { const r = { t: G.t, de: 'Journal', a: '', txt, canal: 'journal', cls: '' }; G.radio.push(r); renderRadio(); if (NET.mode === 'hote') NET.log({ k: 'radio', r: Object.assign({ pour: 'formateur' }, r) }); }
  function evalue(phase, item, detail, res, conseil) {
    G.evals.push({ phase, item, detail, res, conseil, t: G.t });
    if (G.niv && G.niv.retour) { G.retourBuf = (G.retourBuf || []).concat({ item, detail, res, conseil }); clearTimeout(evalue.k); evalue.k = setTimeout(montreRetour, 50); }
  }
  function montreRetour() {
    const L = G.retourBuf || []; G.retourBuf = []; if (!L.length) return;
    G.dernierRetour = `<div class="note"><b>Retour immédiat (niveau débutant)</b><div class="eval">${L.map(e => `<div class="${e.res}"><span>${esc(e.item)}<small>${esc(e.detail)}${e.conseil ? ' — ' + esc(e.conseil) : ''}</small></span></div>`).join('')}</div></div>`;
    const z = $('#zone-msg'); if (z) { z.innerHTML = G.dernierRetour; G.dernierRetour = null; } else { $('#o-phase').insertAdjacentHTML('afterbegin', G.dernierRetour); G.dernierRetour = null; }
  }
  function info(txt) { const el = $('#info'); el.textContent = txt; clearTimeout(info.k); info.k = setTimeout(() => { el.textContent = ''; }, 9000); }

  // =============================================================== verite terrain
  function categorieFeu() {
    // categorie dominante autour du point de depart (rayon 80 m)
    const cnt = {}; for (let a = 0; a < 24; a++) for (const r of [0, 40, 80]) { const c = CARTE.categorie(CARTE.fuelAt(G.ix + Math.cos(a) * r, G.iy + Math.sin(a) * r)); cnt[c] = (cnt[c] || 0) + 1; }
    return Object.entries(cnt).sort((a, b) => b[1] - a[1]).map(e => e[0]);
  }
  function prevision(minutes) {
    // simulation sans lutte a partir de l'etat actuel (dimensionnement, surface menacee)
    const P = new FEU.Feu(carte, { vent: G.vent, dir: G.dir, secheresse: G.sech, hygro: G.hygro, graine: 1 });
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
  // au-dela de 7 000 kW/m (hors domaine du memento) on majore de moitie : manoeuvres defensives, ligne d'appui renforcee
  function besoinUIFF(frontM, I) { return Math.min(14, Math.max(2, Math.ceil(frontM / 40 * (I > 7000 ? 1.5 : 1)))); }

  // =============================================================== PHASES (panneau)
  function setPhase(k) { G.phase = Math.max(G.phase, PHASES.findIndex(p => p[0] === k)); renderPhases(); renderPhase(); }
  function distSeg(p, a, b) { const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy || 1, t = clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L, 0, 1); return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy); }
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

  const PH = {}, ENVOI = {};
  // ---------------- DPIF
  PH.dpif = () => `
    <h2>DPIF</h2>
    <p class="aide">Départ pour intervention feu. Votre analyse de la ZI est faite : préparez le départ avec le ticket et le bulletin du jour (onglet Ticket), avant de quitter le CIS.</p>
    <div class="ticket">${esc(G.radio[0].txt)}</div>
    <form class="form" id="f-dpif">
      <fieldset><legend>Conditions astro-météo</legend>
        <label class="ligne">Taux d'hygrométrie <span><input type="number" name="hygro" min="0" max="100" style="width:80px"> %</span></label>
        <label>Vent du <select name="ventdu"><option value="">—</option>${opt(DIRS)}</select></label>
        <label>Risque du jour <select name="risque"><option value="">—</option>${RISQUES.map(r => `<option value="${r.k}">${r.nom}</option>`).join('')}</select></label>
      </fieldset>
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
      const hy = f.get('hygro') === '' ? null : +f.get('hygro'), okH = hy != null && Math.abs(hy - G.hygro) <= 3, okV = f.get('ventdu') === CARTE.rose(G.dir), okR = f.get('risque') === G.risque.k;
      evalue('dpif', 'Conditions astro-météo', `HR ${hy == null ? '—' : hy + ' %'}, vent du ${f.get('ventdu') || '—'}, risque ${(RISQUES.find(r => r.k === f.get('risque')) || { nom: '—' }).nom} (bulletin : HR ${G.hygro} %, vent du ${CARTE.rose(G.dir)}, risque ${G.risque.nom})`, okH && okV && okR ? 'ok' : (okH + okV + okR) >= 2 ? 'mi' : 'ko', 'L\'hygrométrie et le risque du jour conditionnent la vitesse du feu et le départ type.');
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
      setPhase('transit');
    };
  };
  // ---------------- Analyse ZI
  PH.zi = () => `
    <h2>Analyse de la ZI</h2>
    <p class="aide">Alerte reçue (onglet Ticket : ticket de départ et bulletin du jour). Avant le DPIF, analysez la zone d'intervention sur la carte avec les crayons (barre d'outils de la carte). Tracez à main levée ; un trait fermé délimite une zone.</p>
    <ol class="form" style="padding-left:0;list-style:none">${CRAYONS.map(c => `<li style="display:flex;gap:8px;align-items:center"><i style="width:14px;height:14px;border-radius:50%;background:${c.c};border:2px solid #fff;display:inline-block"></i> ${c.n}/ ${esc(c.nom)} <small class="aide">(${G.dessins.filter(d => d.n === c.n).length})</small></li>`).join('')}</ol>
    <form class="form" id="f-zi">
      <fieldset><legend>4/ Nature de la végétation dans l'axe du feu</legend><div class="cases">${CATS.map(c => `<label><input type="checkbox" name="veg" value="${esc(c)}"> ${esc(c)}</label>`).join('')}</div></fieldset>
      <div class="btns"><button class="btn" type="submit">Analyse terminée</button></div>
    </form>
    `;
  PH.zi_bind = el => {
    $('#f-zi').onsubmit = e => {
      e.preventDefault(); const f = new FormData(e.target);
      evalueZI(f.getAll('veg'));
      G.crayon = null; renderCrayons(); cvD.classList.remove('crayon');
      setPhase('dpif');
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
    const lignes = men.filter(m => /ligne|Relais|relais/.test(m));
    const obsMarques = carte.elec.filter(e => G.dessins.some(d => d.n === 6 && d.pts.some(q => e.p.some((a, i) => i < e.p.length - 1 && distSeg(q, a, e.p[i + 1]) < 250)))).length;
    if (lignes.length) evalue('zi', '6/ Obstacles pour les avions (POMAR)', `${obsMarques} ligne(s) repérée(s) ; dans la zone : ${lignes.join(', ')}`, obsMarques ? 'ok' : 'ko', 'Lignes HT, pylônes, relais : à transmettre aux pilotes lors de la prise en compte.');
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
  function peLabel(p) { return `n° ${p.n} (${p.dfci}) · ${CARTE.typePE(p).nom}`; }
  function activePE(n, moyen) {
    const q = carte.points_eau.find(p => p.n === n); if (!q) return;
    const T = CARTE.typePE(q);
    if (G.pe[n] && G.pe[n].reserve) { radio('CODIS 33', 'CDG Salles', `Le point d'eau ${n} est une réserve de 60 m³ : utilisable directement par aspiration, sans activation.`, 'GRP 272', 'codis'); evalue('messages', 'Activation d\'une réserve', `point d'eau ${n}`, 'mi', 'Les réserves de 60 m³ (rond bleu) ne s\'activent pas : on y aspire directement.'); return; }
    if (G.pe[n]) return;
    reflexe('eau');
    if (T.moyen !== 'aspiration' && moyen && moyen !== T.moyen && !(T.moyen === 'MPR' && moyen === 'MPRI')) evalue('messages', `Moyen d'activation du point d'eau ${n}`, `${moyen} demandée (${T.nom})`, 'ko', 'Triangle : MPR ; losange (puits foré) : MPRI ; rond : réserve 60 m³ sans activation.');
    const m = T.moyen === 'aspiration' ? 'MPF' : T.moyen, debit = { MPF: 30, MPR: 55, MPRI: 55, MPRGP: 120 }[m] || 30;
    G.pe[n] = { n, x: q.p[0], y: q.p[1], moyen: m, debit, actif: false, tActif: G.t + (m === 'MPF' ? 8 : 18) * 60, tDemande: G.t };
    if (T.incertain && G.R() < 0.5) G.pe[n].sec = true;    // point d'eau non perenne : peut etre a sec
    radio('CODIS 33', 'CDG Salles', `Reçu, activation du point d'eau ${n} par une ${m} en cours.`, 'GRP 272', 'codis');
    G.dirtyFond = true;
  }
  // reserves de 60 m3 : disponibles d'emblee, volume limite
  function initReserves() {
    for (const q of carte.points_eau) if (q.forme === 'rond') G.pe[q.n] = { n: q.n, x: q.p[0], y: q.p[1], moyen: 'réserve 60 m³', debit: 60, actif: true, tActif: 0, reserve: true, volume: 60000 };
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
    ENVOI.arrivee = f => {
      
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
  PH.arrivee_bind = () => { 
    const f0 = $('#f-arr'); if (!f0) return;
    f0.onsubmit = e => { e.preventDefault(); ENVOI.arrivee(new FormData(e.target)); };
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
    ${G.niv.aides ? `<div class="note">Réflexes à l'arrivée (aide débutant) : passer sur la DIR 654 avec les chefs d'agrès, cheminement de repli, point d'engagement, points sensibles, point d'eau, dimensionnement, autorités, observation. Ils sont relevés d'après vos messages et vos ordres.</div>` : ''}
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
    $$('[data-msg]').forEach(b => b.onclick = () => { $('#zone-msg').innerHTML = FORM[b.dataset.msg](); FORM[b.dataset.msg + '_bind'](); bindCalc($('#zone-msg')); });
    if (G.dernierRetour) { $('#zone-msg').innerHTML = G.dernierRetour; G.dernierRetour = null; }
    $('#b-fin').onclick = () => termine();
  }

  // ---------------- formulaires de messages
  const FORM = {};
  FORM.ambiance = () => `<form class="form" id="f-msg">
    <p class="aide">Message de reconnaissance (ambiance), T+3 à 5 min.</p>
    <label>Feu de <select name="cat">${opt(['', ...CATS])}</select></label>
    <label>Superficie détruite <span><input type="number" step="0.1" name="ha" style="width:100px"> ha</span></label>
    <label>Longueur du front de feu <span><input type="number" name="front" style="width:100px"> m</span></label>
    ${aideCalc()}
    <label>Situation <select name="sit">${opt(['', 'Favorable', 'Défavorable', 'Très défavorable'])}</select></label>
    <label>Surface menacée <input type="text" name="menace" placeholder="ex. 50 ha, hameau de …"></label>
    <fieldset><legend>Difficultés particulières</legend><div class="cases"><label><input type="checkbox" name="diff" value="Terrain inaccessible, fossés, chablis"> Terrain inaccessible, fossés, chablis</label><label><input type="checkbox" name="diff" value="Points sensibles à défendre"> Points sensibles à défendre</label></div></fieldset>
    <label>Moyens sur les lieux <input type="text" name="sur" value="CDG Salles, ${G.unites.filter(u => u.etat !== 'alerte' && u.etat !== 'transit').map(u => u.label).join(', ')}"></label>
    <label>Le feu nécessite <span><input type="number" name="nuiff" style="width:80px"> UIFF sur les lieux (nombre total)</span></label>
    <fieldset><legend>Autres moyens</legend><div class="cases">${['GPF', 'Lot EGL', 'Chenillette', 'Bulldozer', 'Canadair', 'Dash 8', 'Charlie 33'].map(m => `<label><input type="checkbox" name="autres" value="${m}"> ${m}</label>`).join('')}</div></fieldset>
    <fieldset><legend>Demande d'autorités ou services</legend><div class="cases">${['Élus, conseiller technique DFCI', 'Police ou gendarmerie', 'Énergie (Enedis, RTE)'].map(m => `<label><input type="checkbox" name="aut" value="${m}"> ${m}</label>`).join('')}</div></fieldset>
    <label>Point d'engagement des moyens <input type="text" name="pteng" value="${G.ptEngagement ? CARTE.dfci(...G.ptEngagement) : ''}"></label>
    <label>Je demande l'activation du point d'eau <select name="pe"><option value="">—</option>${carte.points_eau.map(p => `<option value="${p.n}">${peLabel(p)}</option>`).join('')}</select></label>
    <label>au moyen de <select name="moyen">${opt(['MPF', 'MPR', 'MPRI', 'MPRGP'])}</select></label>
    <div class="btns"><button class="btn" type="submit">Transmettre (GRP 272)</button></div></form>`;
    ENVOI.ambiance = f => {
      const b = F.bilan(); G.bilan = b;
      const cats = categorieFeu(), sit = situationVraie(b);
      const tAmb = G.t - (G.tArrivee || G.t);
      evalue('messages', 'Ambiance : délai', `${Math.round(tAmb / 60)} min après l'arrivée`, tAmb <= 5 * 60 ? 'ok' : tAmb <= 8 * 60 ? 'mi' : 'ko', 'T+3 à 5 min maximum.');
      evalue('messages', 'Ambiance : feu de', `${f.get('cat') || '—'} (${cats[0]})`, cats.slice(0, 2).includes(f.get('cat')) ? 'ok' : 'ko');
      const ha = +f.get('ha'); evalue('messages', 'Ambiance : superficie', `${ha || '—'} ha (réel ${b.ha.toFixed(1)} ha)`, ha && Math.abs(ha - b.ha) <= Math.max(0.5, b.ha * 0.4) ? 'ok' : ha && Math.abs(ha - b.ha) <= b.ha ? 'mi' : 'ko', 'Surface ≈ profondeur × front / 2.');
      const fr = +f.get('front'); evalue('messages', 'Ambiance : longueur du front', `${fr || '—'} m (réel ${b.front} m)`, fr && Math.abs(fr - b.front) <= Math.max(30, b.front * 0.4) ? 'ok' : fr ? 'mi' : 'ko');
      evalue('messages', 'Ambiance : situation', `${f.get('sit') || '—'} (attendu : ${sit.v}${sit.menaces.length ? ' — menacés dans l\'heure : ' + sit.menaces.join(', ') : ''})`, f.get('sit') === sit.v ? 'ok' : 'ko', 'C\'est la situation générale (enjeux, surface menacée) qui compte, pas la difficulté d\'accès.');
      const nReq = besoinUIFF(prevision(30).bilan ? frontPrevu() : b.front, b.Imax), nDem = +f.get('nuiff');
      const ecartD = nDem - nReq, tropD = ecartD > Math.max(2, Math.round(nReq * 0.4));
      evalue('messages', 'Ambiance : demande de moyens', `${nDem || '—'} UIFF au total (mémento : ≈ ${nReq} pour ${frontPrevu()} m de front à +30 min, intensité ${Math.round(b.Imax)} kW/m)`, nDem && Math.abs(ecartD) <= Math.max(1, Math.round(nReq * 0.25)) ? 'ok' : ecartD > Math.max(2, Math.round(nReq * 0.4)) ? 'ko' : nDem && ecartD >= -2 ? 'mi' : 'ko', tropD ? `Demande excessive (+${ecartD} UIFF) : ces moyens manquent sur les autres feux du département.` : 'Nombre TOTAL, moyens déjà sur place compris. 1 UIFF par 40 m de front à tenir.');
      if (tropD) radio('CODIS 33', 'CDG Salles', `Reçu. Activité forte sur le département, merci de confirmer le besoin de ${nDem} UIFF.`, 'GRP 272', 'codis');
      const peDem = f.get('pe');
      evalue('messages', 'Ambiance : point d\'eau', peDem ? `n° ${peDem} au moyen d'une ${f.get('moyen')}` : 'non demandé', peDem ? (nDem > 3 && f.get('moyen') === 'MPF' ? 'mi' : 'ok') : 'ko', 'Mémento : jusqu\'à 3 UIFF une MPF ; au-delà une MPR ou MPRI.');
      radio('CDG Salles', 'CODIS 33', `Message d'ambiance. Feu de ${f.get('cat')}, ${ha} ha, front de ${fr} m. Situation ${(f.get('sit') || '').toLowerCase()}. ${f.getAll('diff').join(', ')}. Surface menacée : ${f.get('menace') || '—'}. Le feu nécessite ${nDem} UIFF sur les lieux${f.getAll('autres').length ? ' et ' + f.getAll('autres').join(', ') : ''}. ${f.getAll('aut').length ? 'Je demande ' + f.getAll('aut').join(', ') + '. ' : ''}Point d'engagement : ${f.get('pteng')}. ${peDem ? `Je demande l'activation du point d'eau ${peDem} au moyen d'une ${f.get('moyen')}.` : ''}`, 'GRP 272');
      G.msgs.ambiance = { t: G.t }; G.tDernierMsg = G.t;
      if (nDem) reflexe('moyens'); if (peDem) reflexe('eau'); if (f.getAll('aut').length) reflexe('autorites');
      const manquant = nDem - nbUIFF();
      if (manquant > 0) G.demandes.push({ n: manquant, t: G.t + 4 * 60 });
      if (peDem) activePE(+peDem, f.get('moyen'));
      demandeAutres(f.getAll('autres'));
      setPhase('messages'); renderPhase();
  };
  FORM.ambiance_bind = () => { 
    $('#f-msg').onsubmit = e => { e.preventDefault(); ENVOI.ambiance(new FormData(e.target)); };
  };
  function aideCalc() {
    return `<details class="memo"><summary>Mémo de calcul</summary>
      <p>Profondeur P = vitesse (m/h) × durée (h). Règle : vent m/s × 100 = m/h.<br>Front FF ≈ P / 3. Surface ≈ P × FF / 2. 1 ha = 100 m × 100 m = 10 000 m².</p>
      <div class="calc">Vitesse <input type="number" class="c-v" value="${G.vent * 100}"> m/h × durée <input type="number" class="c-t" value="${Math.round((G.age + G.t) / 60)}"> min
      → P = <b class="c-p"></b> m, FF ≈ <b class="c-f"></b> m, S ≈ <b class="c-s"></b> ha</div>
      ${G.niv.aides ? '<p class="aide">Aide débutant : la durée est celle depuis l\'éclosion estimée (heure de l\'alerte moins quelques minutes).</p>' : ''}</details>`;
  }
  function bindCalc(root) {
    root.querySelectorAll('.memo').forEach(m => {
      const f = () => { const P = (+m.querySelector('.c-v').value || 0) * (+m.querySelector('.c-t').value || 0) / 60; m.querySelector('.c-p').textContent = Math.round(P); m.querySelector('.c-f').textContent = Math.round(P / 3); m.querySelector('.c-s').textContent = (P * P / 6 / 10000).toFixed(1); };
      m.querySelectorAll('input').forEach(i => i.oninput = f); f();
    });
  }
  function nbUIFF() { return G.unites.filter(u => u.type === 'UIFF').length; }
  function demandeAutres(liste) {
    const nb = {};
    for (let m of liste) { if (m === 'ABE') m = 'Canadair'; nb[m] = (nb[m] || 0) + 1; }
    for (const m in nb) G.demandes.push({ type: m, n: nb[m], t: G.t + 3 * 60 });
  }
  function frontPrevu() { const P = prevision(30), b = P.bilan(); return b.front; }
  FORM.cr = () => `<form class="form" id="f-msg">
    <p class="aide">Message de compte rendu n° ${G.cr + 1} (toutes les 20 à 30 min).</p>
    <label>Changement de phase de lutte <select name="phase">${opt(['', 'Feu fixé', 'Feu maîtrisé'])}</select></label>
    <label>Évolution de la situation <select name="sit">${opt(['', 'Favorable', 'Défavorable', 'Très défavorable'])}</select></label>
    <label>Superficie détruite <span><input type="number" step="0.1" name="ha" style="width:100px"> ha</span></label>
    <label>Longueur du front de feu <span><input type="number" name="front" style="width:100px"> m</span></label>
    ${aideCalc()}
    <label>Texte libre (actions en cours, prévisibles) <textarea name="txt"></textarea></label>
    <label>Le feu nécessite <span><input type="number" name="nuiff" style="width:80px" value="${nbUIFF()}"> UIFF sur les lieux (total)</span></label>
    <fieldset><legend>Autres moyens</legend><div class="cases">${['GPF', 'Lot EGL', 'Chenillette', 'Bulldozer', 'Canadair', 'Dash 8', 'Charlie 33'].map(m => `<label><input type="checkbox" name="autres" value="${m}"> ${m}</label>`).join('')}</div></fieldset>
    <div class="btns"><button class="btn" type="submit">Transmettre (GRP 272)</button></div></form>`;
    ENVOI.cr = f => {
      const b = F.bilan(); G.bilan = b; G.cr++;
      const ecart = G.t - (G.tDernierMsg || G.t);
      evalue('messages', `CR n° ${G.cr} : cadence`, `${Math.round(ecart / 60)} min après le message précédent`, ecart >= 15 * 60 && ecart <= 32 * 60 ? 'ok' : 'mi');
      const ph = f.get('phase'), vraie = G.etatFeu === 'fixé' ? 'Feu fixé' : G.etatFeu === 'maîtrisé' ? 'Feu maîtrisé' : '';
      evalue('messages', `CR n° ${G.cr} : phase de lutte`, `${ph || 'aucun changement'} (réel : ${vraie || 'feu non fixé'})`, ph === vraie ? 'ok' : 'ko');
      const ha = +f.get('ha'); evalue('messages', `CR n° ${G.cr} : superficie`, `${ha || '—'} ha (réel ${b.ha.toFixed(1)} ha)`, ha && Math.abs(ha - b.ha) <= Math.max(0.5, b.ha * 0.35) ? 'ok' : 'mi');
      radio('CDG Salles', 'CODIS 33', `Message de compte rendu n° ${G.cr}. ${ph || ''} Situation ${(f.get('sit') || '').toLowerCase()}. ${ha} ha, front ${f.get('front')} m. ${f.get('txt')} Le feu nécessite ${f.get('nuiff')} UIFF.`, 'GRP 272');
      const manquant = +f.get('nuiff') - nbUIFF() - G.demandes.filter(d => !d.fait && (!d.type || d.type === 'UIFF')).reduce((a, d) => a + d.n, 0);
      if (manquant > 0) G.demandes.push({ n: manquant, t: G.t + 4 * 60 });
      demandeAutres(f.getAll('autres'));
      G.tDernierMsg = G.t; G.rappelCR = false; renderPhase();
  };
  FORM.cr_bind = () => { 
    $('#f-msg').onsubmit = e => { e.preventDefault(); ENVOI.cr(new FormData(e.target)); };
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
    ENVOI.eteint = f => {
      const b = F.bilan();
      evalue('messages', 'Feu éteint : coordonnées', `${f.get('coord') || '—'} (point de départ : ${CARTE.dfci(G.ix, G.iy)})`, (f.get('coord') || '').toUpperCase().replace(/\s+/g, ' ').trim() === CARTE.dfci(G.ix, G.iy) ? 'ok' : 'ko', 'Coordonnées du point de départ du feu.');
      evalue('messages', 'Feu éteint : superficie', `${f.get('ha')} ha (réel ${b.ha.toFixed(1)} ha)`, Math.abs(+f.get('ha') - b.ha) <= Math.max(0.3, b.ha * 0.25) ? 'ok' : 'mi');
      evalue('messages', 'Feu éteint : cause et origine', `${f.get('cause')} / ${f.get('orig')} (indices : ${G.indiceVu ? G.cause.indice : 'point de départ non reconnu'})`, f.get('cause') === G.cause.cause && (!G.cause.origine || f.get('orig') === G.cause.origine) ? 'ok' : 'ko', 'Reconnaître le point de départ pour rechercher la cause.');
      radio('CDG Salles', 'CODIS 33', `Message de feu éteint. Commune de ${f.get('commune')}, lieu-dit ${f.get('ld')}, coordonnées ${f.get('coord')}. ${f.get('ha')} ha de ${f.get('cat')}. Cause ${(f.get('cause') || '').toLowerCase()}, ${f.get('orig')}. Surveillance assurée par ${f.get('surv')}.`, 'GRP 272');
      termine();
  };
  FORM.eteint_bind = () => { 
    $('#f-msg').onsubmit = e => { e.preventDefault(); ENVOI.eteint(new FormData(e.target)); };
  };

  // =============================================================== MOYENS (ordres)
  const ORDRES = [['front', 'Attaque de front'], ['flancG', 'Attaque flanc gauche'], ['flancD', 'Attaque flanc droit'], ['percee', 'Percée de flanc'], ['ligne', 'Ligne d\'appui'], ['defense', 'Défense point sensible'], ['lisiere', 'Traitement des lisières'], ['eau', 'Au point d\'eau'], ['attente', 'Attente'], ['aller', 'Aller à…']];
  const LIB = Object.fromEntries(ORDRES);
  function renderMoyens() {
    if (NET.mode === 'client') return renderMoyensClient();
    const el = $('#o-moyens'); if (!el) return;
    el.innerHTML = `<h2>Moyens</h2>
      <div class="unite"><header><b>CDG Salles (vous)</b><span class="st">${G.cdg && G.cdg.path ? 'en déplacement' : 'sur les lieux'}</span></header></div>
      ${G.unites.map(u => `<div class="unite ${G.sel === u.id ? 'sel' : ''}" data-u="${u.id}">
        <header><b>${esc(u.label)}</b><span class="st">${etatTxt(u)}</span></header>
        <div class="jauge" title="Eau"><i style="width:${Math.round(u.eau / u.cap * 100)}%"></i></div>
        <small class="aide">${Math.round(u.eau)} L ${u.Ivu && G.t - (u.actif || 0) < 30 ? '· intensité ' + Math.round(u.Ivu) + ' kW/m' : ''}</small>
        ${u.joueur ? `<small class="joueur">Chef d'agrès : ${esc(u.joueur)} (joueur)${u.ordreRecu ? ' · ordre transmis, en attente d\'exécution' : ''}</small>` : ''}
        <div class="ordres">${u.x == null ? '' : ((TYPES_MOYENS[u.type] && TYPES_MOYENS[u.type].ordres) || ORDRES).map(([k, t]) => `<button data-ordre="${k}" data-u="${u.id}">${t}</button>`).join('')}</div>
      </div>`).join('')}
      ${AVIONS.panneau()}
      <h3>Points d'eau activés</h3>
      <p class="aide">${Object.values(G.pe).filter(p => !p.reserve).map(p => `n° ${p.n} (${p.moyen}) : ${p.actif ? 'opérationnel' : 'en cours, ' + hm(G.heure0 + p.tActif)}`).join('<br>') || 'aucun'}<br>Réserves 60 m³ (sans activation) : ${Object.values(G.pe).filter(p => p.reserve).map(p => `n° ${p.n} (${Math.round(p.volume / 1000)} m³)`).join(', ') || 'aucune'}</p>
      <div class="btns"><select id="pe-sel">${carte.points_eau.map(p => `<option value="${p.n}">${peLabel(p)}</option>`).join('')}</select><select id="pe-moy">${opt(['MPF', 'MPR', 'MPRI', 'MPRGP'])}</select><button class="btn sec" id="b-pe">Demander l'activation</button></div>`;
    $$('#o-moyens [data-ordre]').forEach(b => b.onclick = () => ordre(G.unites.find(u => u.id === b.dataset.u), b.dataset.ordre));
    $$('#o-moyens .unite[data-u]').forEach(d => d.onclick = e => { if (e.target.tagName !== 'BUTTON') { G.sel = d.dataset.u; const u = G.unites.find(x => x.id === G.sel); if (u.x != null) vue.centre(u.x, u.y); G.dirtyFond = true; renderMoyens(); } });
    AVIONS.bindPanneau(el);
    $('#b-pe').onclick = () => { const n = +$('#pe-sel').value, m = $('#pe-moy').value; radio('CDG Salles', 'CODIS 33', `Je demande l'activation du point d'eau ${n} au moyen d'une ${m}.`, 'GRP 272'); activePE(n, m); renderMoyens(); };
  }
  function etatTxt(u) {
    if (u.etat === 'alerte') return 'départ ' + hm(G.heure0 + u.tDispo);
    if (u.etat === 'transit') return 'en route' + (u.path ? '' : '');
    if (u.etat === 'attente') return 'au point d\'engagement';
    if (u.etat === 'vers_pe') return 'vers point d\'eau ' + u.auPE;
    if (u.etat === 'remplissage') return 'remplissage';
    if (u.etat === 'hors service') return 'hors service';
    if (u.detresse) return 'DÉTRESSE';
    return LIB[u.mission] || 'engagé';
  }
  // ordre depuis le panneau (chef de groupe, ou chef d'agres pour son engin) : collecte de la cible puis ordonne()
  function ordre(u, k) {
    if (!u) return;
    G.sel = u.id;
    if (k === 'aller') { G.outil = 'allerU'; cvD.classList.add('crayon'); info(`Cliquez la destination de ${u.label}.`); return; }
    if (k === 'ligne') { G.outil = 'ligne'; G.ligneEnCours = { pts: [], u: u.id }; cvD.classList.add('crayon'); info('Tracez la ligne d\'appui : cliquez ses deux extrémités, de préférence le long d\'une piste.'); return; }
    if (k === 'defense') { G.outil = 'defense'; cvD.classList.add('crayon'); info('Cliquez le point sensible à défendre.'); return; }
    if (k === 'alpha') { G.outil = 'alpha'; cvD.classList.add('crayon'); info(`Cliquez l'emplacement du point d'eau mobile (${u.label}), en bord de piste.`); return; }
    if (k === 'egl') { G.outil = 'egl'; cvD.classList.add('crayon'); info('Cliquez le bout de l\'établissement (300 m maximum depuis l\'engin).'); return; }
    if (k === 'bande') { G.outil = 'bande'; G.bandeEnCours = []; cvD.classList.add('crayon'); info('Cliquez le début puis la fin de la bande à tracer.'); return; }
    ordonne(u, k, null);
  }
  // client (chef d'agres) : l'ordre part a l'hote ; hote (chef de groupe) : donneOrdre
  function ordonne(u, k, cible) {
    if (NET.mode === 'client') { NET.cmd({ type: 'ordre', u: u.id, k, cible }); info(`${LIBO(k)} : en cours.`); return; }
    donneOrdre(u, k, cible);
  }
  const LIBO = k => ({ alpha: 'Point d\'eau mobile', egl: 'Établissement', bande: 'Bande', aller: 'Déplacement', eau: 'Au point d\'eau' }[k] || LIB[k] || k);
  function texteOrdre(u, k, c) {
    if (k === 'aller') return `${u.label}, faites mouvement vers ${CARTE.dfci(c[0], c[1])}, ${CARTE.lieuDit(c[0], c[1])}.`;
    if (k === 'eau') return `${u.label}, allez faire le plein.`;
    if (k === 'alpha') return `${u.label}, point d'eau mobile en ${CARTE.dfci(c[0], c[1])}.`;
    if (k === 'egl') return `${u.label}, établissement de ${Math.round(Math.hypot(c[0] - u.x, c[1] - u.y))} m vers ${CARTE.dfci(c[0], c[1])}.`;
    if (k === 'bande') return `${u.label}, bande de ${Math.round(Math.hypot(c[1][0] - c[0][0], c[1][1] - c[0][1]))} m.`;
    if (k === 'defense') return `${u.label}, défense du point sensible ${CARTE.lieuDit(c[0], c[1])}, ${CARTE.dfci(c[0], c[1])}.`;
    if (k === 'ligne') return `${u.label}, ligne d'appui de ${Math.round(Math.hypot(c[1][0] - c[0][0], c[1][1] - c[0][1]))} m entre ${CARTE.dfci(...c[0])} et ${CARTE.dfci(...c[1])}, ouverture des lances sur ordre.`;
    return `${u.label}, ${(LIB[k] || k).toLowerCase()}${k === 'percee' ? ', progression dans le brûlé, cheminement de repli par l\'arrière' : ''}.`;
  }
  const canalCA = () => (G.dir654 ? 'DIR 654' : 'GRP 272');
  // o.parCA : execute par le chef d'agres (joueur) ; o.voix : l'ordre a deja ete dit a la radio
  function donneOrdre(u, k, cible, o) {
    o = o || {};
    if (!o.parCA) {
      if (!o.voix) radio('CDG Salles', u.ca, texteOrdre(u, k, cible), canalCA());
      if (k === 'defense') reflexe('sensibles');
      if (k === 'ligne') { const len = Math.hypot(cible[1][0] - cible[0][0], cible[1][1] - cible[0][1]), nReq = Math.ceil(len / 40); if (nReq > 1) evalue('rto', 'Ligne d\'appui : dimensionnement', `${Math.round(len)} m tenus par 1 UIFF (mémento : ${nReq} UIFF pour ${Math.round(len)} m)`, 'ko', '1 UIFF / 40 m, 2 / 80 m, 3 / 120 m. Penser à équilibrer U3 / U12 / GPF.'); }
      // engin tenu par un joueur : il recoit l'ordre et l'execute lui-meme
      if (u.uid) { u.ordreRecu = { k, cible, t: G.t, txt: texteOrdre(u, k, cible) }; renderMoyens(); return; }
    }
    if (!execOrdre(u, k, cible)) return;
    if (o.parCA) u.ordreRecu = null;
    else if (!['aller', 'eau', 'alpha', 'egl', 'bande', 'ligne'].includes(k)) radio(u.ca, 'CDG Salles', 'Reçu.', canalCA());
  }
  // mecanique de l'ordre sur le moteur
  function execOrdre(u, k, cible) {
    if (u.x == null || u.etat === 'hors service') return false;
    if (k === 'aller') { allerA(u, cible[0], cible[1], true); u.etat = u.mission ? 'engage' : 'transit'; renderMoyens(); return true; }
    if (k === 'eau') { u.eau = Math.min(u.eau, Math.min(CCF_L, u.cap) - 1); gereEau(u); renderMoyens(); return true; }
    if (k === 'alpha') {
      const [x, y] = cible; allerA(u, x, y); u.etat = 'engage'; u.mission = 'alpha';
      const id = 'GPF' + u.id; G.pe[id] = { n: id, x, y, moyen: u.label, debit: 60, actif: false, tActif: G.t + 1e9, gpf: u, mobile: true };
      u.surPlace = () => { G.pe[id].actif = true; G.pe[id].tActif = G.t; radio(u.ca, 'CDG Salles', `${u.label} en place, point d'eau mobile opérationnel.`, 'DIR 654'); };
      renderMoyens(); return true;
    }
    if (k === 'egl') {
      const d = Math.hypot(cible[0] - u.x, cible[1] - u.y);
      if (d > 300) { radio(u.ca, 'CDG Salles', `Établissement impossible : ${Math.round(d)} m, 300 m maximum depuis l'engin.`, 'DIR 654'); return false; }
      u.cible = cible; u.mission = 'egl'; u.etat = 'engage'; u.path = null; renderMoyens(); return true;
    }
    if (k === 'bande') { u.bande = cible; u.av = 0; u.mission = 'bande'; u.etat = 'engage'; allerA(u, cible[0][0], cible[0][1], true); renderMoyens(); return true; }
    if (k === 'defense') { u.mission = 'defense'; u.cible = cible; u.etat = 'engage'; allerA(u, cible[0], cible[1], true); renderMoyens(); return true; }
    if (k === 'ligne') {
      const L = { id: 'L' + (G.lignes.length + 1), pts: cible }; G.lignes.push(L);
      const [a, b] = L.pts;
      u.mission = 'ligne'; u.ligne = L.id; u.segLigne = L.pts; u.etat = 'engage'; allerA(u, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      G.dirtyFond = true; renderMoyens(); return true;
    }
    // attaques, lisieres, attente
    if (u.tAttente != null && u.tEngage == null) {
      u.tEngage = G.t; const att = G.t - u.tAttente;
      if (u === G.unites[0] || !G.unites.some(x => x !== u && x.tEngage != null)) evalue('rto', 'Engagement de la 1re UIFF', `${Math.round(att / 60)} min d'attente au point d'engagement`, att <= 180 ? 'ok' : att <= 420 ? 'mi' : 'ko', 'Attaque initiale : la première UIFF s\'engage dès son arrivée, sans attendre la suivante.');
    }
    if (G.tEngage1 == null && k !== 'attente') G.tEngage1 = G.t;
    u.mission = k; u.etat = 'engage'; u.alerteSecu = false;
    const cib = cibleFront(u);
    if (cib && k !== 'attente') { const r = allerA(u, cib[0], cib[1], true); if (r && r.L > 400) u.path = r.pts; else u.path = null; }
    if (!G.reflexes.securite && !u.avertiSecu && k !== 'attente') { u.avertiSecu = true; evalue('rto', 'Engagement sans consignes de sécurité', `${u.label} engagée à ${heure()} avant les réflexes sécurité`, 'mi', 'Règle des 3 P et cheminement de repli avant l\'engagement.'); }
    if (G.phase < 7) setPhase('rto');
    G.dirtyFond = true; renderMoyens(); return true;
  }

  // =============================================================== radios : voix -> texte, message libre
  const Reco = window.SpeechRecognition || window.webkitSpeechRecognition;
  let ecoute = null;
  function ouvreParole(canal, texte) {
    $('#parole').hidden = false; $('#parole-canal').value = canal; $('#parole-txt').textContent = texte || ''; $('#parole-txt').focus(); majIdentites();
  }
  function parler(canal, btn) {
    if (ecoute) { ecoute.stop(); return; }
    if (!Reco) { ouvreParole(canal); info('Reconnaissance vocale non disponible dans ce navigateur (utilisez Chrome ou Edge) : écrivez le message.'); return; }
    const r = new Reco(); r.lang = 'fr-FR'; r.interimResults = true; r.continuous = true;
    let final = '';
    ouvreParole(canal, ''); btn.classList.add('emet');
    r.onresult = e => { let tmp = ''; for (let i = e.resultIndex; i < e.results.length; i++) { if (e.results[i].isFinal) final += e.results[i][0].transcript + ' '; else tmp += e.results[i][0].transcript; } $('#parole-txt').textContent = (final + tmp).trim(); };
    r.onerror = e => { info('Micro : ' + (e.error === 'not-allowed' ? 'accès refusé. Autorisez le micro pour ce site.' : e.error)); };
    r.onend = () => { btn.classList.remove('emet'); ecoute = null; };
    ecoute = r; r.start();
  }
  // dictee simple (air-sol)
  function dicte(cb) {
    if (!Reco) { info('Reconnaissance vocale non disponible : utilisez Chrome ou Edge, ou écrivez.'); return; }
    const r = new Reco(); r.lang = 'fr-FR'; r.interimResults = true; let fin = '';
    r.onresult = e => { let tmp = ''; for (let i = e.resultIndex; i < e.results.length; i++) { if (e.results[i].isFinal) fin += e.results[i][0].transcript + ' '; else tmp += e.results[i][0].transcript; } cb((fin + tmp).trim()); };
    r.start();
  }
  function ctxParole() { return { communes: carte.communes.map(c => c.n), lieux: carte.lieux.map(l => l.n), categories: CATS }; }
  // champ de formulaire simule a partir du message analyse
  function pseudoForm(o) { return { get: k => (o[k] == null ? '' : Array.isArray(o[k]) ? o[k][0] : o[k]), getAll: k => (o[k] == null ? [] : Array.isArray(o[k]) ? o[k] : [o[k]]) }; }
  function transmetLibre() {
    const txt = $('#parole-txt').textContent.trim(), canal = $('#parole-canal').value;
    if (!txt) return;
    if (ecoute) ecoute.stop();
    $('#parole').hidden = true;
    if (NET.mode === 'client') { if (NET.role === 'ca' && !maUnite()) { info('Choisissez d\'abord votre engin.'); return; } NET.cmd({ type: 'radio', canal, txt, de: $('#parole-de').value }); return; }
    const r = PARLE.analyse(txt, ctxParole());
    const dest = canal === 'GRP 272' ? 'CODIS 33' : (r.unite ? `CA UIFF ${r.unite}` : 'Chefs d\'agrès');
    if (canal === 'DIR 654') { radio('CDG Salles', dest, txt, canal); return ordreParole(r); }
    // GRP 272 : message au CODIS, au format attendu si on le reconnait
    const pe = r.pe && carte.points_eau.some(p => p.n === r.pe) ? r.pe : '';
    if (r.type === 'arrivee' && G.phase <= 3 && G.cdgArrive) { G.radioDejaFait = true; ENVOI.arrivee(pseudoForm({ commune: r.commune, ld: r.lieuDit, cat: r.categorie, reco: /reconnaissance/i.test(txt) ? 'on' : '' })); return remplaceDernier(txt); }
    if (r.type === 'ambiance' && !G.msgs.ambiance) { ENVOI.ambiance(pseudoForm({ cat: r.categorie, ha: r.ha, front: r.front, sit: r.situation, nuiff: r.uiff, autres: r.moyens, aut: r.autorites, pteng: r.coord || '', pe, moyen: r.pompe || 'MPF', menace: '', diff: [], sur: '' })); return remplaceDernier(txt); }
    if (r.type === 'cr' && G.msgs.ambiance) { ENVOI.cr(pseudoForm({ phase: r.phase, sit: r.situation, ha: r.ha, front: r.front, txt: '', nuiff: r.uiff || nbUIFF(), autres: r.moyens })); return remplaceDernier(txt); }
    if (r.type === 'eteint') { ENVOI.eteint(pseudoForm({ commune: r.commune, ld: r.lieuDit, coord: r.coord, ha: r.ha, cat: r.categorie, cause: '', orig: '', surv: '' })); return remplaceDernier(txt); }
    radio('CDG Salles', dest, txt, canal);
    // demandes contenues dans un message libre
    if (r.moyens.length) demandeAutres(r.moyens);
    if (pe) activePE(pe, r.pompe || 'MPF');
    if (r.uiff && /necessite|demande|besoin/.test(txt.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''))) { const manq = r.uiff - nbUIFF(); if (manq > 0) G.demandes.push({ n: manq, t: G.t + 4 * 60 }); }
    if (r.moyens.length || pe || r.uiff) radio('CODIS 33', 'CDG Salles', 'Reçu, je traite votre demande.', 'GRP 272', 'codis');
  }
  // le message structure genere par ENVOI est remplace par ce qui a ete dit
  function remplaceDernier(txt) { for (let i = G.radio.length - 1; i >= 0; i--) if (G.radio[i].de === 'CDG Salles' && G.radio[i].canal === 'GRP 272') { G.radio[i].txt = txt + '  [transcrit]'; break; } G.mesMsgs[G.mesMsgs.length - 1] = { t: G.t, txt }; renderRadio(); }
  function ordreParole(r) {
    const u = r.unite ? G.unites.filter(x => x.type === 'UIFF')[r.unite - 1] : null;
    if (r.ordre === 'repli') { for (const v of (u ? [u] : G.unites.filter(x => x.x != null))) { if (v.uid) { v.ordreRecu = { k: 'attente', t: G.t, txt: 'Repli' }; continue; } v.mission = 'attente'; v.etat = 'engage'; if (G.ptEngagement) allerA(v, ...G.ptEngagement); radio(v.ca, 'CDG Salles', 'Reçu, repli.', 'DIR 654'); } return; }
    if (!u) { if (r.ordre && !G.unites.some(x => x.uid)) radio('Chefs d\'agrès', 'CDG Salles', 'Pour quelle unité ?', 'DIR 654'); return; }
    if (u.x == null) { radio('CODIS 33', 'CDG Salles', `${u.label} n'est pas encore sur les lieux.`, 'GRP 272', 'codis'); return; }
    if (r.ordre === 'defense') {
      const l = r.lieuDit && carte.lieux.find(q => q.n === r.lieuDit);
      const cible = l ? l.p : (carte.sensibles.map(q => q.p).sort((a, b) => Math.hypot(a[0] - G.ix, a[1] - G.iy) - Math.hypot(b[0] - G.ix, b[1] - G.iy))[0]);
      donneOrdre(u, 'defense', cible, { voix: true }); if (!u.uid) radio(u.ca, 'CDG Salles', 'Reçu, défense du point sensible.', 'DIR 654'); return;
    }
    if (r.ordre && !['aller', 'ligne', 'alpha', 'egl', 'bande'].includes(r.ordre)) donneOrdre(u, r.ordre, null, { voix: true }); else if (!u.uid) radio(u.ca, 'CDG Salles', 'Reçu.', 'DIR 654');
  }

  // =============================================================== carte : interactions
  function bindUI() {
    $$('.rythme button').forEach(b => b.onclick = () => { if (NET.mode === 'client') { NET.cmd({ type: 'rythme', v: +b.dataset.v }); return; } setRythme(+b.dataset.v); });
    $$('[data-fond]').forEach(b => b.onclick = () => { vue.fond = b.dataset.fond; $$('[data-fond]').forEach(x => x.setAttribute('aria-pressed', x === b)); G.dirtyFond = true; renderLegende(); });
    $$('[data-onglet]').forEach(b => b.onclick = () => { $$('[data-onglet]').forEach(x => x.setAttribute('aria-selected', x === b)); $$('.contenu').forEach(c => c.hidden = c.id !== 'o-' + b.dataset.onglet); if (b.dataset.onglet === 'radio') $('#nb-radio').textContent = ''; if (b.dataset.onglet === 'moyens') renderMoyens(); });
    $$('[data-outil]').forEach(b => b.onclick = () => { const o = b.dataset.outil; G.outil = G.outil === o ? null : o; G.crayon = null; renderCrayons(); $$('[data-outil]').forEach(x => x.setAttribute('aria-pressed', x.dataset.outil === G.outil)); cvD.classList.toggle('crayon', !!G.outil); G.mesure = null; });
    $('#b-feu').onclick = () => { if (!G.fumeeVue) { info('La fumée n\'est pas encore en vue : rapprochez-vous du lieu indiqué par le ticket.'); return; } const b = G.bilan || F.bilan(); const e = b.emprise; vue.centre((e[0] + e[2]) / 2 || G.ix, (e[1] + e[3]) / 2 || G.iy, Math.max(vue.s, 0.35)); G.dirtyFond = true; };
    $$('.poste[data-poste]').forEach(b => b.onclick = () => {
      b.classList.remove('appel');
      if (b.dataset.poste === 'Canal 18' && NET.mode !== 'client') { AVIONS.ouvreChat(); return; }
      if (b.dataset.poste === 'DIR 654' && DETRESSE.actif()) DETRESSE.vu();
      parler(b.dataset.poste, b);
    });
    $('#b-libre').onclick = () => { if (ecoute) ecoute.stop(); $('#parole-txt').focus(); };
    let couleurNote = '#111111';
    $$('[data-bc]').forEach(b => b.onmousedown = e => { e.preventDefault(); couleurNote = b.dataset.bc; $$('[data-bc]').forEach(x => x.setAttribute('aria-pressed', x === b)); $('#notes').focus(); document.execCommand('styleWithCSS', false, true); document.execCommand('foreColor', false, couleurNote); });
    $('#notes').addEventListener('focus', () => { document.execCommand('styleWithCSS', false, true); document.execCommand('foreColor', false, couleurNote); });
    $('#b-ticket').onclick = () => $('[data-onglet="ticket"]').click();
    $('#parole-ok').onclick = transmetLibre;
    $('#parole-canal').onchange = majIdentites;
    $('#parole-x').onclick = () => { if (ecoute) ecoute.stop(); $('#parole').hidden = true; };
    $('#b-regle').onclick = () => {
      REGLE.on = !REGLE.on; $('#b-regle').setAttribute('aria-pressed', REGLE.on); $('#regle-p').hidden = !REGLE.on;
      if (REGLE.on && !REGLE.place) { REGLE.place = true; REGLE.pose(vue.cx, vue.cy, 90, 700); }
      renderRegle();
    };
    $('#saisie').onkeydown = e => {
      if (e.key === 'Enter') { const t = e.target.value.trim(); if (t) G.dessins.push({ n: G.crayonTexte || 4, texte: t, pts: [G.posTexte] }); e.target.hidden = true; e.target.value = ''; if (G.phase === 0) renderPhase(); }
      if (e.key === 'Escape') { e.target.hidden = true; e.target.value = ''; }
    };
    let drag = null, trait = null;
    cvD.addEventListener('pointerdown', e => {
      cvD.setPointerCapture(e.pointerId);
      const r = cvD.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top, x = vue.mx(px), y = vue.my(py);
      if (e.button === 2) { if (NET.mode !== 'client') allerCDG(x, y); return; }
      if (REGLE.down(px, py)) return;
      if (G.crayon) { trait = { n: G.crayon, pts: [[x, y]] }; G.dessins.push(trait); return; }
      if (G.outil) { clicOutil(x, y); return; }
      drag = { px, py, cx: vue.cx, cy: vue.cy, moved: false };
    });
    cvD.addEventListener('pointermove', e => {
      const r = cvD.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
      G.souris = [vue.mx(px), vue.my(py)];
      if (REGLE.move(px, py, vue)) { renderRegle(); return; }
      if (trait) { const p = [vue.mx(px), vue.my(py)], q = trait.pts[trait.pts.length - 1]; if (Math.hypot(p[0] - q[0], p[1] - q[1]) * vue.s > 3) trait.pts.push(p); return; }
      if (drag) { const dx = px - drag.px, dy = py - drag.py; if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true; vue.cx = drag.cx - dx / vue.s; vue.cy = drag.cy + dy / vue.s; G.dirtyFond = true; }
    });
    cvD.addEventListener('pointerup', () => {
      if (REGLE.up()) return;
      if (trait) { const a = trait.pts[0], b = trait.pts[trait.pts.length - 1]; trait.ferme = trait.pts.length > 6 && Math.hypot(a[0] - b[0], a[1] - b[1]) * vue.s < 30; trait = null; if (G.phase === 0) renderPhase(); }
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
    if (o === 'point') { G.ptAtteindre = [x, y]; const r = CARTE.route(G.cdg.x, G.cdg.y, x, y); if ($('#pt-txt')) $('#pt-txt').textContent = `${CARTE.dfci(x, y)} · ${CARTE.lieuDit(x, y)}`; if ($('#itin')) $('#itin').value = r ? `${(r.L / 1000).toFixed(1)} km par routes et pistes, environ ${Math.round(r.t / CINE / 60)} min` : 'pas d\'itinéraire'; G.itin = r; finOutil(); return; }
    if (o === 'aller') { allerCDG(x, y); finOutil(); return; }
    if (o === 'engagement') { G.ptEngagement = [x, y]; reflexe('engagement'); radio('CDG Salles', 'Chefs d\'agrès', `Point d'engagement des moyens : ${CARTE.dfci(x, y)}, ${CARTE.lieuDit(x, y)}.`, G.dir654 ? 'DIR 654' : 'GRP 272'); for (const u of G.unites) if (u.etat === 'transit') allerA(u, x, y); finOutil(); renderPhase(); return; }
    const u = G.unites.find(u => u.id === G.sel);
    if (o === 'allerU' && u) { ordonne(u, 'aller', [x, y]); finOutil(); return; }
    if (o === 'alpha' && u) { ordonne(u, 'alpha', [x, y]); finOutil(); return; }
    if (o === 'egl' && u) {
      const d = Math.hypot(x - u.x, y - u.y);
      if (d > 300) { info(`Trop loin : ${Math.round(d)} m (300 m maximum). Rapprochez l'engin.`); return; }
      ordonne(u, 'egl', [x, y]); finOutil(); return;
    }
    if (o === 'bande' && u) {
      G.bandeEnCours.push([x, y]);
      if (G.bandeEnCours.length === 2) { const c = G.bandeEnCours; G.bandeEnCours = null; ordonne(u, 'bande', c); finOutil(); }
      return;
    }
    if (o === 'defense' && u) { ordonne(u, 'defense', [x, y]); finOutil(); return; }
    if (o === 'ligne' && u) {
      G.ligneEnCours.pts.push([x, y]);
      if (G.ligneEnCours.pts.length === 2) { const c = G.ligneEnCours.pts; G.ligneEnCours = null; ordonne(u, 'ligne', c); finOutil(); }
      return;
    }
    if (o === 'saute') { NET.cmd({ type: 'saute', x, y }); info('Saute de feu injectée.'); finOutil(); return; }
    if (o === 'numero') {
      const n = G.crayonPrec || 6, k = G.dessins.filter(d => d.num && d.n === n).length + 1;
      G.dessins.push({ n, num: k, pts: [[x, y]] }); if (G.phase === 0) renderPhase(); return;
    }
    if (o === 'texte') {
      const r = cvD.getBoundingClientRect(), inp = $('#saisie');
      G.posTexte = [x, y]; G.crayonTexte = G.crayonPrec || 4;
      inp.style.left = (vue.sx(x)) + 'px'; inp.style.top = (vue.sy(y) - 14) + 'px'; inp.hidden = false; inp.focus(); return;
    }
    if (o === 'largage') { if (AVIONS.clic(x, y)) finOutil(); return; }

    if (o === 'peuplement') { vuePeuplement(x, y); return; }
    if (o === 'mesure') { if (!G.mesure || G.mesure.length === 2) G.mesure = [[x, y]]; else { G.mesure.push([x, y]); const [a, b] = G.mesure; info(`Distance : ${Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]))} m, direction ${CARTE.rose(CARTE.cap(b[0] - a[0], b[1] - a[1]))}.`); } return; }
    if (o === 'gomme') { let bi = -1, bd = 40 / vue.s; G.dessins.forEach((d, i) => d.pts.forEach(p => { const dd = Math.hypot(p[0] - x, p[1] - y); if (dd < bd) { bd = dd; bi = i; } })); if (bi >= 0) G.dessins.splice(bi, 1); return; }
  }
  // vue de terrain du peuplement : il faut avoir vu le secteur (reconnaissance), sauf en debutant
  const AGES = [['', '—'], ['0', 'Pas de pins'], ['5', 'Semis'], ['6', 'Moins de 10 ans'], ['7', '10 à 20 ans'], ['8', '20 à 40 ans'], ['9', 'Plus de 40 ans'], ['11', 'Âges divers'], ['10', 'Feuillus']];
  function vuePeuplement(x, y) {
    const i = CARTE.idx(x, y); if (i < 0) return;
    const proche = [G.cdg, ...G.unites.filter(u => u.x != null)].some(o => Math.hypot(o.x - x, o.y - y) < G.niv.vue + 150);
    if (!G.niv.aides && !proche && NET.role !== 'formateur') { info('Pas de vue sur ce secteur : un engin ou vous-même devez être sur place (reconnaissance).'); return; }
    const m = PEUPLEMENT.mesure(carte, x, y), q = PEUPLEMENT.params(m), t = PEUPLEMENT.texte(q);
    const attendu = [3, 1, 2, 12, 13, 4, 0].includes(q.f) ? '0' : String(q.f);
    const rendu = (rep) => {
      $('#fenetre').innerHTML = `<h2>Vue de terrain · ${esc(CARTE.dfci(x, y))}</h2>
        <p class="aide">${esc(CARTE.lieuDit(x, y))}. Estimez l'âge du peuplement et la continuité des strates. Le personnage mesure 1,80 m.</p>
        <canvas id="pp-cv" width="540" height="320" style="width:100%;border-radius:6px;display:block"></canvas>
        ${rep ? `<div class="note"><b>${esc(t.nom)}</b><br>${esc(t.detail)}${rep.txt ? '<br><i>' + esc(rep.txt) + '</i>' : ''}</div>`
          : `<form class="form" id="pp-f"><label>Âge des pins <select name="age">${AGES.map(([k, n]) => `<option value="${k}">${n}</option>`).join('')}</select></label>
             <label>Strates <select name="cont"><option value="">—</option><option value="1">Continuité sous-bois / houppiers</option><option value="0">Discontinuité verticale</option></select></label>
             <div class="btns"><button class="btn" type="submit">Vérifier</button><button class="btn sec" type="button" id="pp-x">Fermer</button></div></form>`}
        ${rep ? '<div class="btns"><button class="btn sec" id="pp-x">Fermer</button></div>' : ''}`;
      PEUPLEMENT.dessine($('#pp-cv'), m, { reponse: !!rep });
      $('#pp-x').onclick = () => AVIONS.fen.ferme();
      const f = $('#pp-f');
      if (f) f.onsubmit = e => {
        e.preventDefault(); const d = new FormData(f), age = d.get('age'), cont = d.get('cont');
        const okA = age === attendu || (attendu === '11' && ['7', '8', '9'].includes(age)), okC = cont !== '' && (cont === '1') === q.continu;
        G.nbLectures = (G.nbLectures || 0) + 1;
        if (G.nbLectures <= 3 && NET.mode !== 'client') evalue('reco', 'Lecture du peuplement', `${(AGES.find(a => a[0] === age) || ['', '—'])[1]}, ${cont === '1' ? 'continuité' : cont === '0' ? 'discontinuité' : '—'} (réel : ${t.nom}, ${q.continu ? 'continuité' : 'discontinuité'} verticale)`, okA && okC ? 'ok' : okA || okC ? 'mi' : 'ko', 'Hauteur et élagage des pins donnent l\'âge ; la continuité sous-bois / houppiers conditionne le passage en cimes.');
        rendu({ txt: okA && okC ? 'Bonne lecture.' : `Votre estimation : ${(AGES.find(a => a[0] === age) || ['', '—'])[1]}${okA ? ' (juste)' : ' (à revoir)'}, ${cont === '' ? 'strates non estimées' : okC ? 'strates justes' : 'strates à revoir'}.` });
      };
    };
    AVIONS.fen.ouvre('peuplement', () => rendu(null));
  }
  function finOutil() { G.outil = null; cvD.classList.remove('crayon'); $$('[data-outil]').forEach(x => x.setAttribute('aria-pressed', false)); G.dirtyFond = true; }
  function renderCrayons() {
    $('#crayons').innerHTML = CRAYONS.map(c => `<button data-cr="${c.n}" aria-pressed="${G.crayon === c.n}" title="${esc(c.nom)}"><i style="background:${c.c}"></i>${esc(c.court)}</button>`).join('');
    $$('[data-cr]').forEach(b => b.onclick = () => { const n = +b.dataset.cr; G.crayonPrec = n; G.crayon = G.crayon === n ? null : n; G.outil = null; cvD.classList.toggle('crayon', !!G.crayon); renderCrayons(); info(G.crayon ? CRAYONS[n - 1].nom : ''); });
  }
  function renderRegle() {
    const el = $('#regle-p'); if (!REGLE.on) return;
    if (!el.dataset.fait) {
      el.dataset.fait = '1';
      el.innerHTML = `<b>Règle feu de forêt</b> <span class="aide">déplacez par le centre, orientez par la pastille rouge</span>
        <label>Vent du <select id="rg-vent">${['nord', 'nord-est', 'est', 'sud-est', 'sud', 'sud-ouest', 'ouest', 'nord-ouest'].map((d, i) => `<option value="${i * 45}">${d}</option>`).join('')}</select></label>
        <label>Propagation vers <b id="rg-az"></b></label>
        <label>Vitesse (m/h) <input type="number" id="rg-v"></label>
        <label>Demi-angle du cône (°) <input type="number" id="rg-cone"></label>
        <label>Grille 1 ha <input type="checkbox" id="rg-g" checked style="width:auto"></label>
        <div id="rg-info"></div><div id="rg-tab"></div>`;
      $('#rg-vent').onchange = e => { REGLE.az = ((+e.target.value || 0) + 180) % 360; renderRegle(); };
      $('#rg-v').oninput = e => { REGLE.v = +e.target.value || 0; renderRegle(); };
      $('#rg-cone').oninput = e => { REGLE.cone = clamp(+e.target.value || 20, 5, 60); renderRegle(); };
      $('#rg-g').onchange = e => { REGLE.grille = e.target.checked; };
      $('#rg-tab').innerHTML = REGLE.tableau();
    }
    const set = (id, v) => { const i = $(id); if (document.activeElement !== i) i.value = v; };
    set('#rg-vent', (Math.round((REGLE.az + 180) % 360 / 45) % 8) * 45); $('#rg-az').textContent = 'le ' + CARTE.rose(REGLE.az); set('#rg-v', REGLE.v); set('#rg-cone', REGLE.cone);
    const P = REGLE.v, FF = P / 3;
    $('#rg-info').innerHTML = `Centre : <b>${REGLE.coord(REGLE.x, REGLE.y)}</b><br>En 1 h : profondeur ${Math.round(P)} m, front ≈ ${Math.round(FF)} m, surface ≈ ${(P * FF / 2 / 10000).toFixed(1)} ha`;
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
    if (!G.fumeeVue && (G.tArrivee || Math.hypot(G.cdg.x - fx, G.cdg.y - fy) < 3000)) G.fumeeVue = true;
    if (G.etatFeu !== 'maîtrisé' && G.fumeeVue) {
      const L = 900 + G.vent * 250, w0 = 40, w1 = 300 + G.vent * 40;
      for (let k = 0; k < 14; k++) {
        const t = k / 13, x = fx + F.wx * L * t, y = fy + F.wy * L * t, r = (w0 + (w1 - w0) * t) * s;
        ctx.fillStyle = `rgba(60,60,64,${0.16 * (1 - t) + 0.03})`; ctx.beginPath(); ctx.arc(sx(x), sy(y), Math.max(4, r), 0, Math.PI * 2); ctx.fill();
      }
    }
    REGLE.dessine(ctx, vue);
    AVIONS.dessine(ctx, vue);
    // dessins ZI
    for (const d of G.dessins.concat(NET.mode === 'client' ? MP.ds : [])) {
      if (d.num) { const c = CRAYONS[d.n - 1].c, X = sx(d.pts[0][0]), Y = sy(d.pts[0][1]); ctx.fillStyle = '#fff'; ctx.strokeStyle = c; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(X, Y, 11, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.fillStyle = c; ctx.font = '700 12px "IBM Plex Sans"'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(d.num, X, Y + 1); ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic'; continue; }
      if (d.texte) { const c = CRAYONS[d.n - 1].c; ctx.font = '700 14px "IBM Plex Sans"'; ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.strokeText(d.texte, sx(d.pts[0][0]), sy(d.pts[0][1])); ctx.fillStyle = c; ctx.fillText(d.texte, sx(d.pts[0][0]), sy(d.pts[0][1])); continue; }
      const c = CRAYONS[d.n - 1].c; ctx.strokeStyle = c; ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.beginPath(); d.pts.forEach((p, i) => i ? ctx.lineTo(sx(p[0]), sy(p[1])) : ctx.moveTo(sx(p[0]), sy(p[1]))); if (d.ferme) { ctx.closePath(); ctx.fillStyle = c + '22'; ctx.fill(); } ctx.stroke();
      if (d.pts.length === 1) { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(sx(d.pts[0][0]), sy(d.pts[0][1]), 5, 0, Math.PI * 2); ctx.fill(); }
    }
    // lignes d'appui
    for (const L of G.lignes) { ctx.strokeStyle = '#1d4ed8'; ctx.lineWidth = 6; ctx.setLineDash([10, 6]); ctx.beginPath(); ctx.moveTo(sx(L.pts[0][0]), sy(L.pts[0][1])); ctx.lineTo(sx(L.pts[1][0]), sy(L.pts[1][1])); ctx.stroke(); ctx.setLineDash([]); }
    // points d'eau actives
    for (const p of Object.values(G.pe)) { if (p.reserve) continue; const q = p.mobile ? { n: 'GPF', forme: 'rond', p: [p.x, p.y], perenne: true } : carte.points_eau.find(z => z.n === p.n); if (!q) continue; CARTE.symbolePE(ctx, sx(q.p[0]), sy(q.p[1]), q, 1.3, true); ctx.fillStyle = '#1d4ed8'; ctx.font = '700 11px "IBM Plex Sans"'; ctx.fillText(p.actif ? p.moyen : p.moyen + ' …', sx(q.p[0]) + 16, sy(q.p[1]) - 14); }
    // point a atteindre, point d'engagement
    if (G.ptAtteindre) marqueur(ctx, sx(G.ptAtteindre[0]), sy(G.ptAtteindre[1]), '#9a72ff', 'PA');
    if (G.ptEngagement && G.ptEngagement !== G.ptAtteindre) marqueur(ctx, sx(G.ptEngagement[0]), sy(G.ptEngagement[1]), '#16a34a', 'PE');
    // itineraires
    for (const o of [G.cdg, ...G.unites]) if (o.path) { ctx.strokeStyle = o === G.cdg ? 'rgba(154,114,255,.8)' : 'rgba(37,99,235,.6)'; ctx.lineWidth = 3; ctx.setLineDash([6, 5]); ctx.beginPath(); ctx.moveTo(sx(o.x), sy(o.y)); for (let i = o.pi; i < o.path.length; i++) ctx.lineTo(sx(o.path[i].x), sy(o.path[i].y)); ctx.stroke(); ctx.setLineDash([]); }
    // engins
    for (const u of G.unites) if (u.x != null) engin(ctx, sx(u.x), sy(u.y), u.label.split(' ').slice(0, 2).join(' ') + (u.joueur ? ' · ' + u.joueur : ''), G.sel === u.id ? '#f08c2a' : u.detresse ? '#facc15' : '#e2373f', u);
    const mu = NET.mode === 'client' && maUnite();
    if (mu && mu.ordreRecu && mu.ordreRecu.cible) { const c = mu.ordreRecu.cible, pts = Array.isArray(c[0]) ? c : [c]; ctx.strokeStyle = '#9a72ff'; ctx.lineWidth = 3; ctx.setLineDash([6, 4]); ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(sx(p[0]), sy(p[1])) : ctx.moveTo(sx(p[0]), sy(p[1]))); ctx.stroke(); ctx.setLineDash([]); pts.forEach(p => marqueur(ctx, sx(p[0]), sy(p[1]), '#9a72ff', 'OR')); }
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
    $('#meteo').textContent = `Vent du ${CARTE.rose(G.dir)}, ${G.vent} m/s · HR ${G.hygro} % · risque ${G.risque.nom.toLowerCase()}`;
    // arrivee du CDG au point a atteindre
    if (NET.mode === 'client') return;
    if (G.phase >= 2 && !G.cdg.path && G.ptAtteindre && !G.cdgArrive) { G.cdgArrive = true; G.tArriveeCDG = G.t; if (G.phase >= 3) renderPhase(); info('Vous êtes arrivé au point à atteindre.'); }
    if (G.phase === 3 && G.cdgArrive && !$('#f-arr')) renderPhase();
    if (G.c33Prevu && G.t >= G.tC33 && !G.c33) { G.c33 = true; radio('Charlie 33', 'CDG Salles', 'Charlie 33 sur zone, je vous transmets la situation.', 'Air/Air'); observe(); }
    if (!$('#o-moyens').hidden && Math.floor(G.t) % 8 === 0) renderMoyens();
  }
  let filtre = 'tous';
  function renderRadio() {
    const can = ['tous', 'mes messages', ...new Set(G.radio.map(r => r.canal))];
    $('#filtres').innerHTML = can.map(c => `<button data-f="${c}" aria-pressed="${filtre === c}">${c}</button>`).join('');
    $$('#filtres button').forEach(b => b.onclick = () => { filtre = b.dataset.f; renderRadio(); });
    $('#radio').innerHTML = G.radio.filter(r => filtre === 'tous' || r.canal === filtre || (filtre === 'mes messages' && r.de === (NET.mode === 'client' ? MP.moi() : 'CDG Salles'))).slice().reverse().map(r => `<li class="${r.cls}"><small>${hm(G.heure0 + r.t)} · ${esc(r.canal)} · ${esc(r.de)}${r.a ? ' → ' + esc(r.a) : ''}</small>${esc(r.txt)}</li>`).join('');
  }
  function renderTicket() {
    const t = G.ticket;
    $('#o-ticket').innerHTML = `<h2>Ticket de départ</h2>
      <div class="ticket">BIP ${hm(G.heure0)} — DÉPART FEU DE FORÊT
Commune : ${esc(t.commune)}
Lieu-dit : ${esc(t.ld)}
Coordonnées DFCI : ${esc(t.coord)} (${CARTE.dfciPhon(t.coord)})
Source : ${esc(t.source)}
Départ : CDG Salles, ${G.unites.slice(0, G.risque.uiff).map(u => esc(u.label)).join(', ')}
Transmissions : GRP 272 (CODIS), DIR 654 (chefs d'agrès), canal 18 (air-sol)</div>
      <h3>Bulletin astro-météo du jour</h3>
      <div class="ticket">Vent du ${CARTE.rose(G.dir)}, ${G.vent} m/s (${Math.round(G.vent * 3.6)} km/h)
Taux d'hygrométrie : ${G.hygro} %
Risque feux de forêt : ${G.risque.nom}
Départ type associé : CDG + ${G.risque.uiff} UIFF</div>
      <p class="aide">Niveau ${G.niv.nom}.</p>`;
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
    $('#o-phase').innerHTML = `<h2>Débriefing · niveau ${G.niv.nom}</h2>
      <p>${ok} points acquis, ${mi} partiels, ${tot - ok - mi} à revoir. Surface brûlée : ${b.ha.toFixed(1)} ha. Feu ${G.etatFeu}${G.tFixe ? ', fixé à ' + hm(G.heure0 + G.tFixe) : ''}.</p>
      <p class="aide">Toute la surface brûlée est maintenant affichée sur la carte (y compris les zones non reconnues).</p>
      ${parPhase}<h3>Éléments ajoutés pour cette partie</h3><p class="aide">${G.inv.sensibles.map(x => esc(x.n) + ' (' + CARTE.dfci(...x.p) + ')').join(', ')}. Lignes : ${G.inv.lignes.map(l => l.v).join(', ')}. Points d'eau : ${G.inv.pe.map(p => 'n° ' + p.n + ' ' + p.activation + (p.perenne ? '' : ' (non pérenne)')).join(', ')}.</p><h3>Actions réflexes</h3><div class="eval">${refl}</div>${G.unites.some(u => u.joueur) ? `<h3>Chefs d'agrès joueurs</h3><p class="aide">${G.unites.filter(u => u.joueur).map(u => esc(u.label) + ' : ' + esc(u.joueur)).join('<br>')}</p>` : ''}
      <div class="btns"><button class="btn" onclick="location.reload()">Nouvelle intervention</button></div>`;
    $$('[data-onglet]')[0].click();
  }

  // =============================================================== MULTIJOUEUR
  // Hote : le navigateur du chef de groupe simule et publie. Clients : chefs d'agres et formateur.
  const MP = { dernier: 0, dernier2: 0, envoi: null, sig2: '', e: null, e2: null, recu: 0, sig: '', choixManuel: false, ds: [] };
  const R0 = v => Math.round(v);
  function setRythme(v) { rythme = v; $$('.rythme button').forEach(x => x.setAttribute('aria-pressed', +x.dataset.v === v)); }

  function lanceHote() {
    const conf = confAccueil();
    demarre(conf);
    NET.T.set('conf', Object.assign({ hote: NET.nom, cree: Date.now() }, conf));
    MP.envoi = new Uint8Array(carte.w * carte.h);
    NET.T.onAdd('cmd', (k, c) => { NET.T.del('cmd/' + k); try { commande(c); } catch (e) { console.error('commande', e); } });
    NET.T.on('joueurs', j => { NET.joueurs = j || {}; majJoueurs(); });
    document.body.classList.add('multi');
    badgePartie();
  }
  function majJoueurs() {
    const J = NET.joueurs; let change = false;
    for (const u of G.unites) {
      const c = Object.entries(J).filter(([, j]) => j && j.role === 'ca' && j.unite === u.id).sort((a, b) => (a[1].ts || 0) - (b[1].ts || 0))[0];
      const nu = c ? c[0] : null, nom = c ? c[1].nom : '';
      if (nu !== (u.uid || null)) {
        change = true;
        if (nu) journal(`${u.label} : chef d'agrès ${nom} (joueur) aux commandes.`); else journal(`${u.label} : ${u.joueur || 'le joueur'} s'est déconnecté, l'engin repasse en automatique.`);
        u.uid = nu; u.joueur = nom; if (!nu) u.ordreRecu = null;
      }
    }
    if (change) renderMoyens();
    badgePartie();
  }
  function badgePartie() {
    const el = $('#partie'); if (!el || NET.mode === 'solo') return;
    el.hidden = false;
    const J = Object.values(NET.joueurs || {}).filter(Boolean);
    if (NET.mode === 'hote') {
      el.innerHTML = `<b>Partie ${esc(NET.code)}</b><small>${J.length - 1 > 0 ? (J.length - 1) + ' joueur(s) connecté(s)' : 'en attente de joueurs'}</small><button class="btn sec petit" id="b-lien" title="Copier le lien d'invitation">Inviter</button>`;
      $('#b-lien').onclick = () => { const l = NET.lien(); (navigator.clipboard ? navigator.clipboard.writeText(l) : Promise.reject()).then(() => info('Lien copié : ' + l), () => info('Lien : ' + l)); };
    } else {
      const vieux = MP.recu && performance.now() - MP.recu > 6000;
      el.innerHTML = `<b>Partie ${esc(NET.code)}</b><small class="${vieux ? 'err' : ''}">${vieux ? 'Chef de groupe en pause ou déconnecté' : NET.role === 'formateur' ? 'Formateur · ' + esc(NET.nom) : 'Chef d\'agrès · ' + esc(NET.nom)}</small>`;
    }
  }
  // ------------------------------------------------------------- hote : publication
  function publieHote(now) {
    if (now - MP.dernier < 1000) return; MP.dernier = now;
    const N = carte.w * carte.h, b = [], e = [], env = MP.envoi, ta = F.ta, ext = F.ext, t = F.t;
    for (let i = 0; i < N; i++) {
      const v = env[i]; if (v === 3) continue;
      if (!(v & 1) && ta[i] <= t) { b.push(i, R0(ta[i])); env[i] |= 1; }
      if (!(v & 2) && ext[i] === 1) { e.push(i); env[i] |= 2; }
    }
    if (b.length || e.length) NET.log({ k: 'feu', b: NET.b64(Int32Array.from(b)), e: NET.b64(Int32Array.from(e)) });
    NET.T.set('etat', etatCompact());
    if (now - MP.dernier2 > 4000) {
      MP.dernier2 = now; majJoueurs();
      const e2 = { ph: G.phase, ev: G.evals.slice(-80), rf: G.reflexes, ds: G.dessins.map(d => Object.assign({}, d, { pts: d.pts.map(p => [R0(p[0]), R0(p[1])]) })), ha: G.bilan ? +G.bilan.ha.toFixed(1) : 0, front: G.bilan ? R0(G.bilan.front) : 0 };
      const sg = JSON.stringify(e2); if (sg !== MP.sig2) { MP.sig2 = sg; NET.T.set('etat2', e2); }
    }
  }
  function etatCompact() {
    const b = G.bilan;
    return {
      t: Math.round(G.t * 10) / 10, r: rythme, v: G.vent, d: G.dir, ef: G.etatFeu, fin: !!G.fin, ts: Date.now(),
      cdg: [R0(G.cdg.x), R0(G.cdg.y)], pa: G.ptAtteindre ? G.ptAtteindre.map(R0) : null, pg: G.ptEngagement ? G.ptEngagement.map(R0) : null, arr: G.tArrivee || 0, d654: !!G.dir654,
      em: b ? b.emprise.map(R0) : null, na: b ? b.actifs.length : 0,
      u: G.unites.map(u => ({ id: u.id, type: u.type, label: u.label, ca: u.ca, cis: u.cis, x: u.x == null ? null : R0(u.x), y: u.y == null ? null : R0(u.y), eau: R0(u.eau), cap: u.cap, etat: u.etat, m: u.mission || '', td: u.tDispo, det: !!u.detresse, act: u.actif || 0, I: u.Ivu ? R0(u.Ivu) : 0, j: u.joueur || '', uid: u.uid || '', or: u.ordreRecu || null, pe: u.auPE || '', p: u.path ? u.path.slice(u.pi).map(q => [R0(q.x), R0(q.y)]) : null, ci: u.cible ? u.cible.map(R0) : null })),
      pe: Object.values(G.pe).map(p => ({ n: p.n, x: R0(p.x), y: R0(p.y), moyen: p.moyen, debit: p.debit, actif: !!p.actif, tActif: p.tActif, reserve: !!p.reserve, volume: R0(p.volume || 0), mobile: !!p.mobile })),
      lg: G.lignes.map(L => ({ id: L.id, pts: L.pts.map(q => q.map(R0)) })),
      av: AVIONS.avions.map(a => ({ id: a.id, type: a.type, etat: a.etat, x: R0(a.x), y: R0(a.y), cap: a.cap || 0, largages: a.largages, tRetour: a.tRetour || 0, tFin: a.tFin || 0, ordre: !!a.ordre })),
      al: AVIONS.largages.map(l => ({ a0: l.a0.map(R0), a1: l.a1.map(R0), t: l.t, retardant: !!l.retardant })),
    };
  }
  // ------------------------------------------------------------- hote : commandes des clients
  function commande(c) {
    if (!c || !G.feu) return;
    if (c.type === 'ordre') { const u = G.unites.find(x => x.id === c.u); if (!u || u.uid !== c.uid) return; donneOrdre(u, c.k, c.cible, { parCA: true }); return; }
    if (c.type === 'radio') {
      const txt = String(c.txt || '').slice(0, 800).trim(); if (!txt) return;
      if (c.role === 'ca') { const u = G.unites.find(x => x.uid === c.uid); if (!u) return; radio(u.ca, c.canal === 'GRP 272' ? 'CODIS 33' : 'CDG Salles', txt, c.canal === 'GRP 272' ? 'GRP 272' : 'DIR 654', 'humain', { humain: true }); DETRESSE.messageCA(u, txt); return; }
      if (c.role === 'formateur') {
        if (c.canal === 'Canal 18') { AVIONS.dire(c.de, txt); return; }
        radio(c.de || 'CODIS 33', 'CDG Salles', txt, c.canal, c.de === 'CODIS 33' ? 'codis' : 'humain', { humain: true }); return;
      }
      return;
    }
    if (c.role !== 'formateur') return;
    if (c.type === 'rythme') setRythme(+c.v);
    if (c.type === 'detresse') { if (!DETRESSE.force(c.u, c.k)) journal('Formateur : détresse impossible (engin pas sur le feu, ou détresse déjà en cours).'); else journal(`Formateur : détresse injectée sur ${c.u}.`); }
    if (c.type === 'vent') {
      G.vent = +c.vent; G.dir = +c.dir; F.setMeteo(G.vent, G.dir, G.sech); majHUD();
      journal(`Formateur : vent ${G.vent} m/s du ${CARTE.rose(G.dir)}.`);
      if (c.annonce) radio('CODIS 33', 'CDG Salles', `Information météo : le vent forcit et tourne, ${G.vent} m/s de secteur ${CARTE.rose(G.dir)}.`, 'GRP 272', 'codis');
    }
    if (c.type === 'saute') { const i = F.idx(c.x, c.y); if (i >= 0 && F.ta[i] > F.t) { F.allume(c.x, c.y, F.t); journal(`Formateur : saute de feu en ${CARTE.dfci(c.x, c.y)}.`); } }
    if (c.type === 'fin' && !G.fin) termine();
  }

  // ------------------------------------------------------------- client : chef d'agres, formateur
  function lanceClient(conf) {
    demarre(conf);
    G.radio = []; G.unites = []; G.mesMsgs = []; G.evals = []; G.sel = null;
    F.ta.fill(Infinity); F.ext.fill(0); F.heap = [];
    G.vu.fill(NET.role === 'formateur' ? 1 : 0); G.dirtyFeu = true;
    AVIONS.avions.length = 0; G.fumeeVue = true;
    document.body.classList.add('multi', 'client', 'role-' + NET.role);
    const t0 = $('[data-onglet="phase"]'); t0.textContent = NET.role === 'formateur' ? 'Formateur' : 'Mon engin';
    $('#parole-canal').innerHTML = NET.role === 'formateur' ? '<option>GRP 272</option><option>DIR 654</option><option>Canal 18</option>' : '<option>DIR 654</option><option>GRP 272</option>';
    $('#o-phase').innerHTML = '<p class="aide">Connexion à la partie…</p>';
    NET.T.onAdd('log', (k, o) => { try { recoitLog(o); } catch (e) { console.error('log', e); } });
    NET.T.on('etat', e => { if (e) appliqueEtat(e); });
    NET.T.on('etat2', e => { if (!e) return; MP.e2 = e; MP.ds = e.ds || []; if (NET.role === 'formateur') { G.phase = e.ph || 0; G.evals = e.ev || []; G.reflexes = e.rf || {}; renderPhases(); MP.sig = ''; } });
    NET.T.on('joueurs', j => { NET.joueurs = j || {}; MP.sig = ''; badgePartie(); });
    $('[data-onglet="phase"]').click();
    badgePartie();
  }
  function maUnite() { return G.unites.find(u => u.id === NET.unite) || null; }
  MP.moi = () => { const u = maUnite(); return NET.role === 'ca' ? (u ? u.ca : '') : ''; };
  function recoitLog(o) {
    if (o.k === 'feu') {
      if (o.b) { const b = NET.deb64(o.b); for (let i = 0; i < b.length; i += 2) F.ta[b[i]] = b[i + 1]; }
      if (o.e) { const e = NET.deb64(o.e); for (let i = 0; i < e.length; i++) F.ext[e[i]] = 1; }
      G.dirtyFeu = true; return;
    }
    if (o.k === 'radio') {
      const r = o.r, u = maUnite();
      const voit = r.pour ? (r.pour === NET.uid || (r.pour === 'formateur' && NET.role === 'formateur'))
        : NET.role === 'formateur' || r.canal === 'DIR 654' || (u && (r.a === u.ca || r.de === u.ca || /chefs d.agr/i.test(r.a)));
      if (!voit) return;
      if (r.pour === NET.uid) r.cls = r.cls === 'alerte' ? 'alerte situ' : 'info situ';
      const recent = MP.e && r.t >= MP.e.t - 15;
      recoitRadio(r, recent && r.de !== MP.moi());
    }
  }
  function appliqueEtat(e) {
    const prem = !MP.e; MP.e = e; MP.recu = performance.now();
    G.t = e.t; F.t = G.age + G.t; setRythme(e.r);
    if (e.v !== G.vent || e.d !== G.dir) { G.vent = e.v; G.dir = e.d; F.setMeteo(G.vent, G.dir, G.sech); }
    G.etatFeu = e.ef; G.cdg.x = e.cdg[0]; G.cdg.y = e.cdg[1]; G.ptAtteindre = e.pa || null; G.ptEngagement = e.pg || null; G.tArrivee = e.arr || null; G.dir654 = !!e.d654;
    G.bilan = e.em ? { emprise: e.em, actifs: { length: e.na || 0 } } : null;
    G.unites = (e.u || []).map(q => Object.assign(G.unites.find(x => x.id === q.id) || {}, {
      id: q.id, type: q.type, label: q.label, ca: q.ca, cis: q.cis, x: q.x ?? null, y: q.y ?? null, eau: q.eau || 0, cap: q.cap || 1, etat: q.etat, mission: q.m || null, tDispo: q.td || 0,
      detresse: !!q.det, actif: q.act || 0, Ivu: q.I || 0, joueur: q.j || '', uid: q.uid || '', ordreRecu: q.or || null, auPE: q.pe || '', path: q.p ? q.p.map(([x, y]) => ({ x, y })) : null, pi: 0, cible: q.ci || null,
    }));
    G.pe = {}; for (const p of e.pe || []) G.pe[p.n] = p;
    G.lignes = e.lg || [];
    AVIONS.avions.length = 0; (e.av || []).forEach(a => AVIONS.avions.push(a));
    AVIONS.largages.length = 0; (e.al || []).forEach(l => AVIONS.largages.push(l));
    // chef d'agres : engin attribue (le premier arrive garde l'engin)
    if (NET.role === 'ca') {
      const u = maUnite();
      if (u && u.uid && u.uid !== NET.uid) { NET.unite = null; NET.majPresence(); info(`${u.label} est déjà tenue par ${u.joueur}. Choisissez un autre engin.`); }
      if (!NET.unite && !MP.choixManuel) { const libre = G.unites.find(x => x.type === 'UIFF' && !x.uid && x.etat !== 'hors service'); if (libre) choisitUnite(libre.id); }
      G.sel = NET.unite;
      observeClient();
    }
    if (prem && NET.role === 'formateur') { const b = G.bilan; vue.centre(b ? (b.emprise[0] + b.emprise[2]) / 2 : G.ix, b ? (b.emprise[1] + b.emprise[3]) / 2 : G.iy, 0.25); G.dirtyFond = true; }
    if (e.fin && !G.fin) { G.fin = true; G.dirtyFeu = true; MP.sig = ''; }
    majHUD(); renderClient(); badgePartie();
    if (!$('#o-moyens').hidden) renderMoyens();
  }
  function choisitUnite(id) {
    NET.unite = id; G.sel = id; NET.majPresence(); MP.sig = '';
    const u = maUnite(); if (u && u.x != null) { vue.centre(u.x, u.y, Math.max(vue.s, 0.3)); G.dirtyFond = true; }
  }
  function observeClient() {
    const u = maUnite(); if (!u || u.x == null) return;
    const c = carte, R = Math.round(G.niv.vue / c.res), c0 = Math.floor(u.x / c.res), r0 = c.h - 1 - Math.floor(u.y / c.res);
    for (let dr = -R; dr <= R; dr++) for (let dc = -R; dc <= R; dc++) {
      if (dc * dc + dr * dr > R * R) continue; const cc = c0 + dc, rr = r0 + dr; if (cc < 0 || cc >= c.w || rr < 0 || rr >= c.h) continue;
      if (!G.vu[rr * c.w + cc]) { G.vu[rr * c.w + cc] = 1; G.dirtyFeu = true; }
    }
  }
  function clientTick(now) { if (Math.floor(now / 2000) !== MP.tb) { MP.tb = Math.floor(now / 2000); badgePartie(); } }

  // panneaux des clients (re-rendus seulement si le contenu change)
  function renderClient() {
    if (NET.role === 'ca') return panneauCA();
    return panneauFormateur();
  }
  function panneauCA() {
    const u = maUnite(), el = $('#o-phase');
    const sig = JSON.stringify([NET.unite, u && [u.etat, u.mission, Math.round(u.eau / 200), u.ordreRecu && u.ordreRecu.t, u.x == null, u.detresse], G.unites.map(x => x.id + x.uid), G.fin]);
    if (sig === MP.sig) return; MP.sig = sig;
    $('#phases').innerHTML = `<li class="encours">Chef d'agrès${u ? ' · ' + esc(u.label) : ''}</li>`;
    if (G.fin) { el.innerHTML = '<h2>Exercice terminé</h2><p class="aide">Le chef de groupe a mis fin à l\'intervention. Débriefing avec le formateur.</p>'; return; }
    if (!u) {
      const libres = G.unites.filter(x => !x.uid && x.etat !== 'hors service');
      el.innerHTML = `<h2>Choisissez votre engin</h2>${libres.length ? `<div class="ordres">${libres.map(x => `<button data-pris="${x.id}">${esc(x.label)}</button>`).join('')}</div>` : '<p class="aide">Aucun engin libre pour le moment. Les renforts demandés par le chef de groupe apparaîtront ici.</p>'}`;
      $$('[data-pris]').forEach(b => b.onclick = () => { MP.choixManuel = true; choisitUnite(b.dataset.pris); });
      return;
    }
    const or = u.ordreRecu, ordresU = (TYPES_MOYENS[u.type] && TYPES_MOYENS[u.type].ordres) || ORDRES;
    el.innerHTML = `<h2>${esc(u.label)}</h2>
      <div class="unite sel"><header><b>${esc(u.ca)} (vous)</b><span class="st">${etatTxt(u)}</span></header>
        <div class="jauge" title="Eau"><i style="width:${Math.round(u.eau / u.cap * 100)}%"></i></div>
        <small class="aide">${Math.round(u.eau)} L${u.x != null ? ' · ' + CARTE.dfci(u.x, u.y) + ' · ' + esc(CARTE.lieuDit(u.x, u.y)) : ''}</small></div>
      ${or ? `<div class="note ordre-recu"><b>Ordre du chef de groupe</b> <small>${hm(G.heure0 + or.t)}</small><p>${esc(or.txt || LIBO(or.k))}</p><div class="btns"><button class="btn" id="ca-exec">Exécuter</button>${or.cible ? '<button class="btn sec" id="ca-voir">Voir sur la carte</button>' : ''}</div></div>` : ''}
      ${u.x == null ? `<p class="aide">Départ du CIS de ${esc(u.cis)} à ${hm(G.heure0 + u.tDispo)}.</p>` : `<h3>Mes actions</h3><div class="ordres">${ordresU.map(([k, t]) => `<button data-mo="${k}">${t}</button>`).join('')}</div>`}
      <p class="aide">Rendez compte au chef de groupe sur la <b>DIR 654</b> (radio verte en bas) : arrivée, position, eau, difficultés. Les lignes « Situation » de la radio ne sont visibles que par vous : c'est à vous de les transmettre.</p>
      <div class="btns"><button class="btn sec" id="ca-centre">Centrer sur mon engin</button><button class="btn sec" id="ca-change">Changer d'engin</button></div>`;
    if (or) {
      $('#ca-exec').onclick = () => { NET.cmd({ type: 'ordre', u: u.id, k: or.k, cible: or.cible || null }); info('Ordre exécuté.'); };
      if (or.cible) $('#ca-voir').onclick = () => { const c = Array.isArray(or.cible[0]) ? or.cible[0] : or.cible; vue.centre(c[0], c[1], Math.max(vue.s, 0.3)); G.dirtyFond = true; };
    }
    $$('[data-mo]').forEach(b => b.onclick = () => ordre(u, b.dataset.mo));
    $('#ca-centre').onclick = () => { if (u.x != null) { vue.centre(u.x, u.y, Math.max(vue.s, 0.3)); G.dirtyFond = true; } };
    $('#ca-change').onclick = () => { MP.choixManuel = true; NET.unite = null; NET.majPresence(); MP.sig = ''; panneauCA(); };
  }
  const DETR = [['encercle', 'CCF pris par le feu'], ['embourbe', 'CCF embourbé devant le feu'], ['blesse', 'Équipier blessé'], ['malaise', 'Coup de chaleur']];
  function panneauFormateur() {
    const el = $('#o-phase');
    if (!el.querySelector('#f-inj')) {
      el.innerHTML = `<h2>Formateur · partie ${esc(NET.code)}</h2>
        <div id="f-joueurs"></div><div id="f-cdg"></div>
        <h3>Injections</h3>
        <div class="form" id="f-inj">
          <label>Détresse <span class="lig"><select id="f-du"></select><select id="f-dk">${DETR.map(([k, t]) => `<option value="${k}">${t}</option>`).join('')}</select><button class="btn sec" id="f-det">Déclencher</button></span></label>
          <label>Vent <span class="lig"><select id="f-vf">${[3, 5, 7, 8, 10, 12, 14, 17, 20].map(v => `<option>${v}</option>`).join('')}</select> m/s du <select id="f-vd">${DIRS.map((d, i) => `<option value="${i * 45}">${d}</option>`).join('')}</select><button class="btn sec" id="f-vent">Appliquer</button></span></label>
          <label class="ligne"><input type="checkbox" id="f-van" checked style="width:auto"> Annoncé au chef de groupe par le CODIS</label>
          <div class="btns"><button class="btn sec" id="f-saute">Saute de feu (cliquer sur la carte)</button><button class="btn sec" id="f-fin">Terminer l'exercice</button></div>
          <p class="aide">Pour jouer le CODIS, un pilote ou un engin non tenu par un joueur : radios en bas, choisissez l'identité dans la fenêtre de message.</p>
        </div>
        <h3>Évaluation du chef de groupe (en direct)</h3><div id="f-eval"></div>`;
      $('#f-det').onclick = () => { if (!$('#f-du').value) { info('Aucun engin sur le feu.'); return; } NET.cmd({ type: 'detresse', u: $('#f-du').value, k: $('#f-dk').value }); };
      $('#f-vent').onclick = () => NET.cmd({ type: 'vent', vent: +$('#f-vf').value, dir: +$('#f-vd').value, annonce: $('#f-van').checked });
      $('#f-saute').onclick = () => { G.outil = 'saute'; cvD.classList.add('crayon'); info('Cliquez l\'emplacement de la saute de feu.'); };
      $('#f-fin').onclick = () => { if (confirm('Terminer l\'exercice pour tous les joueurs ?')) NET.cmd({ type: 'fin' }); };
      $('#f-vf').value = String(G.vent); $('#f-vd').value = String(Math.round(G.dir / 45) % 8 * 45);
    }
    const sur = G.unites.filter(u => u.x != null && u.etat !== 'hors service'), fdu = $('#f-du'), opts = sur.map(u => `<option value="${u.id}">${esc(u.label)}${u.joueur ? ' (' + esc(u.joueur) + ')' : ''}</option>`).join('');
    if (fdu.dataset.o !== opts) { const v = fdu.value; fdu.innerHTML = opts; fdu.dataset.o = opts; if (v) fdu.value = v; }
    const J = Object.values(NET.joueurs || {}).filter(Boolean);
    $('#f-joueurs').innerHTML = `<h3>Joueurs</h3><p class="aide">${J.map(j => `${esc(j.nom)} : ${j.role === 'cdg' ? 'chef de groupe (hôte)' : j.role === 'formateur' ? 'formateur' : 'chef d\'agrès ' + esc((G.unites.find(u => u.id === j.unite) || {}).label || '(sans engin)')}`).join('<br>')}</p>`;
    const e2 = MP.e2 || {};
    $('#f-cdg').innerHTML = `<p class="aide">Phase du chef de groupe : <b>${PHASES[G.phase] ? PHASES[G.phase][1] : '—'}</b> · feu ${esc(G.etatFeu)} · ${e2.ha || 0} ha · front ${e2.front || 0} m · vent ${G.vent} m/s du ${CARTE.rose(G.dir)}${G.fin ? ' · <b>exercice terminé</b>' : ''}</p>`;
    const sigE = G.evals.length + ':' + Object.keys(G.reflexes || {}).length;
    if ($('#f-eval').dataset.s !== sigE) {
      $('#f-eval').dataset.s = sigE;
      $('#f-eval').innerHTML = `<div class="eval">${G.evals.slice().reverse().map(e => `<div class="${e.res}"><span>${esc(e.item)}<small>${hm(G.heure0 + (e.t || 0))} · ${esc(e.detail)}${e.conseil ? ' — ' + esc(e.conseil) : ''}</small></span></div>`).join('') || '<p class="aide">Rien pour l\'instant.</p>'}</div>
        <h3>Actions réflexes relevées</h3><div class="eval">${REFLEXES.map(([k, t]) => `<div class="${G.reflexes[k] != null ? 'ok' : 'ko'}"><span>${esc(t)}<small>${G.reflexes[k] != null ? hm(G.heure0 + G.reflexes[k]) : 'pas encore'}</small></span></div>`).join('')}</div>`;
    }
  }
  function renderMoyensClient() {
    const el = $('#o-moyens');
    el.innerHTML = `<h2>Moyens</h2>${G.unites.map(u => `<div class="unite" data-u="${u.id}"><header><b>${esc(u.label)}</b><span class="st">${etatTxt(u)}</span></header>
      <div class="jauge"><i style="width:${Math.round(u.eau / u.cap * 100)}%"></i></div><small class="aide">${Math.round(u.eau)} L${u.joueur ? ' · joué par ' + esc(u.joueur) : ' · automatique'}${u.ordreRecu ? ' · ordre en attente : ' + esc(LIBO(u.ordreRecu.k)) : ''}</small></div>`).join('')}
      <h3>Avions</h3><p class="aide">${AVIONS.avions.map(a => `${esc(a.id)} (${esc(a.type)}, ${esc(a.etat)}, ${a.largages || 0} largage(s))`).join('<br>') || 'aucun'}</p>
      <h3>Points d'eau</h3><p class="aide">${Object.values(G.pe).filter(p => !p.reserve).map(p => `n° ${p.n} (${esc(p.moyen)}) : ${p.actif ? 'opérationnel' : 'en cours'}`).join('<br>') || 'aucun activé'}</p>`;
    $$('#o-moyens .unite[data-u]').forEach(d => d.onclick = () => { const u = G.unites.find(x => x.id === d.dataset.u); if (u && u.x != null) { vue.centre(u.x, u.y); G.dirtyFond = true; } });
  }
  // identites possibles du formateur a la radio
  function identites(canal) {
    if (canal === 'GRP 272') return ['CODIS 33'];
    if (canal === 'Canal 18') return AVIONS.avions.filter(a => a.etat !== 'engage' && a.etat !== 'parti').map(a => a.id).concat(['Charlie 33']);
    return G.unites.filter(u => !u.uid && u.x != null).map(u => u.ca).concat(['Point Alpha', 'Chefs d\'agrès']);
  }
  function majIdentites() {
    const s = $('#parole-de'); if (!s) return;
    s.hidden = !(NET.mode === 'client' && NET.role === 'formateur');
    if (s.hidden) return;
    s.innerHTML = identites($('#parole-canal').value).map(i => `<option>${esc(i)}</option>`).join('');
  }

  // interface fournie aux modules avions et detresses
  const API = {
    G, carte: null, F: () => F, radio: (...a) => radio(...a), evalue: (...a) => evalue(...a), info: t => info(t),
    outil: (o, msg) => { G.outil = o; cvD.classList.add('crayon'); info(msg); }, finOutil: () => finOutil(),
    allerA: (...a) => allerA(...a), dicte: cb => dicte(cb), dfci: (x, y) => CARTE.dfci(x, y), cap: (dx, dy) => CARTE.cap(dx, dy), hm: t => hm(G.heure0 + t),
    commune: () => CARTE.commune(G.ix, G.iy),
    obstaclesProches: r => {
      const out = [], b = G.bilan || F.bilan(), cx = b.actifs.length ? (b.emprise[0] + b.emprise[2]) / 2 : G.ix, cy = b.actifs.length ? (b.emprise[1] + b.emprise[3]) / 2 : G.iy;
      for (const e of carte.elec) if (e.p.some((a, i) => i < e.p.length - 1 && distSeg([cx, cy], a, e.p[i + 1]) < r)) out.push({ n: `Ligne électrique ${e.v || ''} (${CARTE.dfci(...e.p[0])} → ${CARTE.dfci(...e.p[e.p.length - 1])})`, danger: true });
      for (const s2 of carte.sensibles) if (s2.obstacle && Math.hypot(s2.p[0] - cx, s2.p[1] - cy) < r) out.push({ n: `${s2.n} en ${CARTE.dfci(...s2.p)}`, danger: true });
      return out;
    },
  };
  // acces pour les essais automatiques
  window.FDFJ = { vue: () => vue, pas, ordre, clicOutil, renderPhase, termine, setPhase, F: () => F, lanceHote, lanceClient, MP };
  init();
})();
