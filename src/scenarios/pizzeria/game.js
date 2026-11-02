// ===========================================================================
// FEU DE PIZZERIA - Kaysersberg (d'apres l'exercice ENSOSP GOC 4001)
// Le joueur est chef du groupe incendie (CDG) : feu de restaurant de 900 m2 en
// rez-de-chaussee, 34 evacues dont un brule grave, station-service avec un stock
// de bouteilles de gaz a l'ouest, HLM R+3 a l'est. Le chef de colonne arrive en
// cours d'operation : point de situation, puis le joueur devient chef du secteur
// incendie. Meme API que le scenario R+3 (window.GAME), lue par l'interface.
// ===========================================================================
(function () {
'use strict';
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const DT = 0.25;
const T0_CLOCK = 19 * 3600 + 30 * 60;        // 19h30 : appel du gerant de la station
const T_ARRIVEE = 7 * 60;                     // 19h37 : arrivee du CDG et du groupe incendie
const T_FIN_MAX = T_ARRIVEE + 65 * 60;        // 20h42
const T_VENT = 27 * 60;                       // 19h57 : le vent forcit a 40 km/h, rabat les fumees sur le HLM
const T_GSAP = 15 * 60;                       // 19h45 : groupe secours a personnes
const T_CDC = 18 * 60;                        // 19h48 : chef de colonne (informe par le CODIS)
const T_HLM_PRV = 32 * 60;                    // 20h02 : les locataires du HLM affluent
const T_POLLU = 40 * 60;                      // 20h10 : pollution de la Weiss si rien n'est fait
const T_MUR = 55 * 60;                        // 20h25 : effondrement du mur nord
const CANAUX = { TAC: 'DIR 633', OPE: 'GRP 270', CDT: 'GRP 275', ARI: 'DIR 654' };
const CANAL_LABEL = { 'DIR 633': 'DIR 633 · tactique groupement', 'GRP 270': 'GRP 270 · OPE2 DEP', 'GRP 275': 'GRP 275 · CDT', 'DIR 654': 'DIR 654 · sécurité ARI', 'DIR 602': 'DIR 602 · PC ↔ secteurs' };

// ---------------------------------------------------------------- geographie (plan : x vers l'est, y vers le nord, en m)
// Pizzeria : x -15..15, y 0..30. RN 415 : y -4..-12. Station a l'ouest, HLM a l'est, Weisbach au nord.
const POS = {
  ENGIN: [0, -8], S: [0, -3], O: [-20, 14], E: [21, 15], N: [0, 35], N_LOIN: [0, 44], GAZ: [-21, 6], HLM_F: [24, 12],
  INT: [0, 12], HLM: [40, 18], TROTTOIR: [6, -2.5], PI: [-20, -3], AVAL: [-6, -4.5], RN: [-30, -8], STATION: [-40, 10],
  PRV_SO: [-32, -22], PRV_E: [38, 4], UA: [9, -2.5], EPA: [0, -6], GSAP: [24, -8],
};
const LOC_NAMES = { ENGIN: 'à l\'engin', S: 'façade sud', O: 'façade ouest', E: 'façade est', N: 'façade nord', N_LOIN: 'côté nord, hors zone d\'effondrement',
  GAZ: 'stock de bouteilles', HLM_F: 'pignon du HLM', INT: 'intérieur du restaurant', HLM: 'dans le HLM', TROTTOIR: 'trottoir sud', PI: 'poteau incendie',
  AVAL: 'avaloirs de la RN', RN: 'RN 415', STATION: 'station-service', PRV_SO: 'PRV parking sud-ouest', PRV_E: 'parking du HLM', ABSENT: 'en route' };
// grille du feu : 3 x 3 volumes de 100 m2 (i : ouest -> est, j : sud -> nord)
const CELL_NAMES = [['salle sud-ouest', 'entrée et caisse', 'salle sud-est'], ['salle ouest', 'salle centrale', 'salle est'], ['bureau et vestiaires', 'cuisine', 'réserve']];
const cellXY = (i, j) => [-10 + 10 * i, 5 + 10 * j];

// ===========================================================================
const G = window.G = {};
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function newGame() {
  const cells = [];
  for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) cells.push({ i, j, q: 0, fuel: 1, heat: 0, wet: 0, on: false, known: null });
  Object.assign(G, {
    W: { t: 0, cells, wind: 10, events: [] }, started: false, paused: false, speed: 1, pauses: 0, pausedTime: 0, ended: false,
    radio: [], msgNo: 0, journal: [], ambiance: null, crs: [], requests: {}, safety: [], timers: [], dirty: true,
    K: { facts: {}, cells: {} }, asked: {}, actors: [], victims: [], busy: null, observations: [],
    fire: { cur: 'developpement', cand: null, candT: 0, lastSpread: 0, log: [] },
    phase: 'arrivee', oi: null, sitacUser: [], crFeed: [], cosT: null, incident: null, vpos: {}, moves: {}, chanErr: 0, urgents: [], orderLog: [],
    rng: mulberry32((Math.random() * 1e9) | 0),
    hyd: { FPT1: { tank: 3000, alim: false }, FPT2: { tank: 3000, alim: false }, FPT3: { tank: 3000, alim: false }, FPT4: { tank: 3000, alim: false }, galim: false, used: 0 },
    gaz: { T: 28, soupape: false, bleve: false, hot: 0 }, hlm: { T: 25, fire: false, smoke: 0, reco: false, pmrOut: false, residentsPRV: false },
    tiers: { loc: 'TROTTOIR', dose: 0, nearMiss: false, accident: false, count: 34, moving: null }, circulation: false, stationEvac: false, pompesCoupees: false,
    perimetre: false, avaloirs: false, pollution: false, murDown: false, generalise: null, reserveBoom: false, plongeuse: 'inconnue',
    passation: null, secteur: false, gsapMission: null,
    witnesses: WITNESSES.map(w => ({ id: w.id, present: false, appearT: w.appear, arrivedT: null })),
  });
  for (const w of G.witnesses) G.timers.push({ t: w.appearT, fn: () => { w.present = true; w.arrivedT = G.W.t; G.dirty = true; const d = witnessDef(w.id); radio(d.short, 'CDG', d.hello, 'temoin'); G.journal.push({ t: G.W.t, text: d.short + ' se présente au CDG.' }); } });
  // groupe incendie : VLCG, 2 FPT, EPA (arrivent ensemble)
  G.actors.push(binome('BAT1', 'BAT', 'FPT 1'), binome('BAL1', 'BAL', 'FPT 1'), binome('BAT2', 'BAT', 'FPT 2'), binome('BAL2', 'BAL', 'FPT 2'));
  G.actors.push({ id: 'PA', kind: 'echelle', label: 'EPA 30', engin: 'EPA 30', loc: 'ENGIN', plan: [], status: 'Sur les lieux, en attente d\'ordres', mission: null });
  G.actors.push({ id: 'GSAP', kind: 'gsap', label: 'G SAP (Ltn Collier)', engin: 'G SAP', loc: 'ABSENT', plan: [], status: 'En route', mission: null });
  G.victims.push({ id: 'UA', name: 'Karim, cuisinier, brûlé au 3e degré', loc: 'UA', atRue: true, found: true, pec: false, fed: 0.6, burn: true, cooled: false, sev: 0.6 });
  G.victims.push({ id: 'PMR', name: 'Locataire du 2e en fauteuil roulant (HLM)', loc: 'HLM', atRue: false, found: false, pec: false, fed: 0, sev: 0 });
  G.vpos.PA = 'sud'; G.vpos.GSAP = 'est';
  // evenements programmes
  G.timers.push({ t: T_GSAP, fn: () => { const a = act('GSAP'); a.loc = 'ENGIN'; a.status = 'Sur les lieux, en attente d\'ordres'; radio('CDG LM', 'CDG', 'Ltn Collier, groupe secours à personnes sur les lieux : 2 VSAV et le VLI. Je me présente au VLCG, quelle mission ?', 'alerte'); G.dirty = true; } });
  G.timers.push({ t: T_CDC, fn: cdcArrive });
  G.timers.push({ t: T_VENT, fn: () => { G.W.wind = 40; G.journal.push({ t: G.W.t, text: 'Le vent d\'ouest forcit à 40 km/h : fumées et particules enflammées rabattues sur le HLM.' }); radio('CA FPT 2', 'CDG', 'Le vent se lève fort, les fumées et des brandons partent sur le HLM !', 'alerte'); G.dirty = true; } });
  G.timers.push({ t: T_HLM_PRV, fn: () => { if (!G.hlm.reco) { G.hlm.residentsPRV = true; radio('CDG LM', G.secteur ? 'PC' : 'CDG', 'Une cinquantaine de locataires du HLM arrivent au PRV, très inquiets. Il en reste peut-être dans les étages.', 'alerte'); } } });
  G.timers.push({ t: T_POLLU, fn: () => { if (!G.avaloirs) { G.pollution = true; radio('Gendarmerie', G.secteur ? 'PC' : 'CDG', 'Un riverain signale de la mousse et une pellicule irisée sur la Weiss, sur plusieurs centaines de mètres.', 'alerte'); G.journal.push({ t: G.W.t, text: 'Pollution de la Weiss par les eaux d\'extinction (avaloirs non obturés).' }); } } });
  G.timers.push({ t: T_MUR - 6 * 60, fn: () => { const n = G.actors.find(a => a.loc === 'N' && a.kind === 'binome'); if (n) report(n, 'Le mur nord bombe et se fissure en partie haute, ça craque fort !'); } });
  G.timers.push({ t: T_MUR, fn: murNord });
  G.timers.push({ t: T_ARRIVEE + 240, fn: () => { if (!G.ambiance) radio('CODIS', 'CDG', 'CODIS pour chef de groupe Lapoutroie, j\'attends votre message d\'ambiance.', 'msg'); } });
  // pre-feu : depuis 19h20 dans la cuisine (13 min avant l'arrivee)
  const k = cell(1, 2); k.on = true; k.q = 0.25;
  G.pre = true;
  G.W.t = -420;
  while (G.W.t < T_ARRIVEE) { if (G.W.t >= 0) runTimers(); stepFire(DT); G.W.t += DT; }
  G.W.events.length = 0; G.pre = false;
}
function binome(id, role, engin) {
  return { id, kind: 'binome', role, label: role === 'BAT' ? "Binôme d'attaque" : "Binôme d'alimentation", engin, loc: 'ENGIN', plan: [], status: 'Disponible à l\'engin',
    air: 1500, ari: false, lance: null, flowing: false, flow: 0, mission: null, hurt: false };
}
const act = id => G.actors.find(a => a.id === id);
const cell = (i, j) => G.W.cells[j * 3 + i];
function clock(t) { const s = Math.floor(T0_CLOCK + t), h = Math.floor(s / 3600) % 24, m = Math.floor(s / 60) % 60, ss = ((s % 60) + 60) % 60; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`; }
function hhmm(t) { return clock(t).slice(0, 5).replace(':', 'h'); }
function fmtDur(s) { s = Math.max(0, Math.round(s)); return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`; }
function radio(from, to, text, kind, ch) {
  G.msgNo++;
  if (!ch) ch = /CODIS/.test(from + to) ? (G.cosT != null ? CANAUX.CDT : CANAUX.OPE) : /PC/.test(from + to) ? 'DIR 602' : CANAUX.TAC;
  G.radio.push({ n: G.msgNo, t: G.W.t, from, to, text, kind: kind || '', ch });
  G.dirtyRadio = true;
  if (window.UI && UI.toast && (['alerte', 'urgent', 'temoin', 'obs'].includes(kind) || from === 'CODIS')) UI.toast(`${from} → ${to} : ${text}`, kind || 'msg');
}
function know(key, label) { if (G.K.facts[key]) return; G.K.facts[key] = { t: G.W.t, label }; G.dirty = true; }
function penalty(pts, text) { if (G.safety.some(p => p.text === text)) return; G.safety.push({ t: G.W.t, pts, text }); }
function crIcon(t) {
  t = t.toLowerCase();
  if (/détresse|blessé|effondr|explos|danger|à sec|brûl/.test(t)) return 'alerte';
  if (/victime|personne|impliqu|évacu|pmr|locataire/.test(t)) return 'victime';
  if (/flamme|feu|embras|torchère/.test(t)) return 'feu';
  if (/en manœuvre|établi|alimenté|terminé|coupé|en place|obtur|reçu/.test(t)) return 'ok';
  if (/fumée/.test(t)) return 'fumee';
  return 'info';
}
function report(a, text) {
  a.lastCR = { t: G.W.t, text, icon: crIcon(text) };
  G.crFeed.unshift({ t: G.W.t, id: a.id, text, icon: a.lastCR.icon });
  radio(a.kind === 'binome' ? `CA ${a.engin}` : a.engin, G.secteur && a.kind === 'gsap' ? 'PC' : 'CDG', (a.kind === 'binome' ? `${a.label} : ` : '') + text, 'cr');
}

// ===========================================================================
// FEU : 9 volumes, propagation poussee par le vent d'ouest, eau appliquee par facade
// ===========================================================================
function windW(di) { const w = G.W.wind >= 30 ? 1 : 0; return di > 0 ? 1.25 + 0.6 * w : di < 0 ? 0.65 - 0.2 * w : 1.0; }
function stepFire(dt) {
  const W = G.W, C = W.cells;
  // eau appliquee par volume (L/min)
  const water = new Array(9).fill(0);
  for (const a of G.actors) if (a.flowing && a.flow > 0 && a.target) for (const [i, j, f] of a.target) water[j * 3 + i] += a.flow * f;
  W.water = water;
  for (let n = 0; n < 9; n++) {
    const c = C[n], w = water[n];
    c.wet = clamp(w / 150, 0, 1);
    if (c.on) {
      const grow = (1 / 170) * (1 - c.q) * (c.fuel > 0.15 ? 1 : 0);
      const knock = w / 250 / 600;   // un volume embrase demande longtemps 250 L/min et plus
      c.q = clamp(c.q + (grow - knock) * dt * (c.q > 0.02 ? 1 : 0.3), 0, 1);
      if (c.fuel < 0.15) c.q = Math.max(0, c.q - dt / 300);
      c.fuel = Math.max(0, c.fuel - dt * c.q / 2700);
      if (c.q < 0.02 && w > 0) { c.on = false; c.heat = 0.4; W.events.push({ type: 'abattu', n }); }
    }
  }
  // propagation aux volumes voisins
  for (const c of C) {
    if (!c.on || c.q < 0.35) continue;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const i = c.i + di, j = c.j + dj; if (i < 0 || i > 2 || j < 0 || j > 2) continue;
      const d = cell(i, j); if (d.on || d.fuel < 0.2) continue;
      d.heat += dt * c.q * windW(di) / 400 * (1 - 0.85 * d.wet);
      if (d.heat >= 1) { d.on = true; d.q = 0.12; d.heat = 0; W.events.push({ type: 'propagation', n: d.j * 3 + d.i }); }
    }
  }
}
const burning = () => G.W.cells.filter(c => c.on && c.q > 0.05);
const areaOnFire = () => Math.round(burning().reduce((s, c) => s + 100 * Math.min(1, c.q * 1.3), 0) / 10) * 10;
const colQ = i => (cell(i, 0).q + cell(i, 1).q + cell(i, 2).q) / 3;
const rowQ = j => (cell(0, j).q + cell(1, j).q + cell(2, j).q) / 3;

// ---------------------------------------------------------------- cibles : bouteilles, HLM, tiers
function lanceAt(loc) { return G.actors.filter(a => a.loc === loc && a.flowing && a.flow > 0); }
function stepTargets(dt) {
  const W = G.W, g = G.gaz, h = G.hlm, ti = G.tiers;
  // rayonnement sur le stock de bouteilles (8 a 11 m de la facade ouest)
  const rid = lanceAt('GAZ').reduce((s, a) => s + a.flow, 0);
  const fluxG = 22 * colQ(0) * (W.wind >= 30 ? 0.75 : 1) * (rid >= 450 ? 0.22 : rid > 0 ? 0.45 : 1) + 4 * colQ(1);
  g.flux = fluxG;
  g.T += (0.012 * fluxG - 0.0035 * (g.T - 28) - (rid > 0 ? 0.01 : 0)) * dt;
  if (g.T > 70 && !g.soupape) { g.soupape = true; radio(G.actors.some(a => a.loc === 'GAZ') ? 'CA FPT 1' : 'Gérant station', 'CDG', 'Une soupape de bouteille s\'ouvre : torchère sur le stock de gaz !', 'alerte'); G.journal.push({ t: W.t, text: 'Ouverture d\'une soupape sur le stock de bouteilles (torchère).' }); know('torchere', 'Torchère sur le stock de bouteilles'); }
  if (g.T > 92) g.hot += dt; else g.hot = Math.max(0, g.hot - dt);
  if (g.hot > 90 && !g.bleve) bleve();
  // facade du HLM (13 m a l'est)
  const ridH = lanceAt('HLM_F').reduce((s, a) => s + a.flow, 0) + (G.actors.some(a => a.id === 'PA' && a.mission === 'LANCE_EPA_HLM' && a.flowing) ? 600 : 0);
  const fluxH = 16 * colQ(2) * (W.wind >= 30 ? 1.9 : 1) * (ridH >= 450 ? 0.25 : ridH > 0 ? 0.5 : 1);
  h.flux = fluxH;
  h.T += (0.01 * fluxH - 0.003 * (h.T - 25)) * dt;
  if (h.T > 110 && !h.fire) { h.fire = true; G.fire.lastSpread = W.t; radio('CA FPT 2', 'CDG', 'Les vitrages du HLM côté pizzeria ont cédé, le feu prend dans un appartement du 1er !', 'alerte'); G.journal.push({ t: W.t, text: 'Propagation au HLM par rayonnement et brandons.' }); know('feu_hlm', 'Propagation au HLM'); }
  if (W.wind >= 30) h.smoke = Math.min(1, h.smoke + dt / 240 * (colQ(2) + colQ(1)) / 2);
  const pmr = G.victims.find(v => v.id === 'PMR');
  if (!pmr.atRue && h.smoke > 0.3) pmr.fed += dt * h.smoke * 0.0012 * (h.fire ? 3 : 1);
  // tiers : sur le trottoir sud ou au PRV
  if (ti.moving) { ti.moving.t += dt; if (ti.moving.t >= ti.moving.d) { ti.loc = ti.moving.to; ti.moving = null; G.dirty = true; } }
  let exp = 0;
  if (ti.loc === 'TROTTOIR') exp = 6 * rowQ(0) + 2 * colQ(1);
  if (ti.loc === 'PRV_E' && W.wind >= 30) exp = 2.5 * (colQ(1) + colQ(2));
  if (exp > 3) ti.dose += dt * (exp - 3) / 3000;
  if (ti.loc === 'TROTTOIR' && !G.circulation) {
    if (W.t > T_ARRIVEE + 420 && !ti.nearMiss) { ti.nearMiss = true; radio('CA FPT 1', 'CDG', 'Un véhicule vient de frôler les évacués sur le trottoir, la circulation n\'est pas coupée sur la RN !', 'alerte'); }
    if (W.t > T_ARRIVEE + 900 && !ti.accident) { ti.accident = true; penalty(15, 'Un client évacué percuté par un véhicule : circulation non coupée sur la RN 415, tiers laissés au bord de la route.'); radio('CA FPT 1', 'CDG', 'Un client vient d\'être renversé par une voiture sur la RN ! Blessé à la jambe, conscient.', 'urgent'); G.victims.push({ id: 'CLIENT', name: 'Client renversé sur la RN', loc: 'UA', atRue: true, found: true, pec: false, fed: 0.4, sev: 0.4 }); G.dirty = true; }
  }
  // UA brule : s'aggrave sans refroidissement ni medicalisation
  const ua = G.victims.find(v => v.id === 'UA');
  if (!ua.evac) { const rate = ua.pec ? (G.requests.SMUR && G.requests.SMUR.onSite ? 0 : 0.00012) : ua.cooled ? 0.00018 : 0.0004; ua.fed = Math.min(2.6, ua.fed + rate * dt); }
}
function bleve() {
  const g = G.gaz; g.bleve = true;
  const near = G.actors.filter(a => ['GAZ', 'O', 'STATION'].includes(a.loc) && a.kind === 'binome');
  G.journal.push({ t: G.W.t, text: 'Éclatement d\'une bouteille de propane du stock de la station (BLEVE) : boule de feu, projections.' });
  radio('CA FPT 1', 'CDG', 'EXPLOSION au stock de bouteilles ! Boule de feu, des bouteilles projetées sur la station !', 'urgent');
  penalty(35, 'Explosion du stock de bouteilles de gaz : stock ni refroidi par un rideau d\'eau, ni protégé à temps.');
  for (const a of near) { a.hurt = true; a.plan = [{ type: 'move', to: 'ENGIN', d: 60 }, { type: 'done' }]; a.flowing = false; penalty(20, `${a.label} (${a.engin}) blessé par l'explosion du stock de gaz.`); }
  if (!G.stationEvac) { G.victims.push({ id: 'STA', name: 'Clients et caissière de la station (3 brûlés)', loc: 'UA', atRue: true, found: true, pec: false, fed: 1.1, sev: 1.1 }); penalty(20, 'Station-service non évacuée : 3 personnes brûlées par l\'explosion.'); }
  G.fire.lastSpread = G.W.t; G.dirty = true;
}
function murNord() {
  if (G.murDown) return; G.murDown = true;
  const caught = G.actors.filter(a => a.kind === 'binome' && (a.loc === 'N' || a.loc === 'INT'));
  G.journal.push({ t: G.W.t, text: 'Effondrement d\'une partie du mur nord du restaurant.' });
  if (caught.length) {
    for (const a of caught) { a.hurt = true; a.flowing = false; a.plan = [{ type: 'move', to: 'ENGIN', d: 120 }, { type: 'done' }]; a.mission = null; }
    penalty(30, `Effondrement du mur nord : ${caught.length * 2} sapeurs-pompiers blessés, engagés dans la zone d'effondrement.`);
    radio('CA ' + caught[0].engin, 'CDG', `Une partie du mur nord vient de s'écrouler ! ${caught.length * 2} SP pris dessous, dont 2 gravement. Je demande des moyens SAP !`, 'urgent');
    G.victims.push({ id: 'SPN', sp: true, name: `Sapeurs-pompiers blessés (mur nord) : ${caught.length * 2}`, loc: 'UA', atRue: true, found: true, pec: false, fed: 1.2, sev: 1.2, grave: true });
  } else radio(G.perimetre ? 'CA FPT 2' : 'CA FPT 1', 'CDG', `Une partie du mur nord vient de s'écrouler${G.perimetre ? ', dans la zone balisée : personne dessous' : ', personne n\'était dessous'}.`, 'alerte');
  G.dirty = true;
}

// ===========================================================================
// HYDRAULIQUE : citernes, PI 150 limite a 1000 L/min, aspiration sur la Weisbach (G ALIM)
// ===========================================================================
const PI_MAX = 1000, GALIM_FLOW = 2000;
function fptOf(a) { if (a.id === 'PA') return 'FPT2'; return 'FPT' + a.engin.replace(/\D/g, ''); }
function stepHydro(dt) {
  const H = G.hyd;
  const alimented = Object.keys(H).filter(k => H[k] && H[k].alim);
  const piShare = alimented.length ? PI_MAX / alimented.length : 0;
  const galimShare = H.galim && alimented.length ? GALIM_FLOW / alimented.length : 0;
  let demandTot = 0, supplyTot = 0;
  for (const f of ['FPT1', 'FPT2', 'FPT3', 'FPT4']) {
    const h = H[f]; if (!h) continue;
    const users = G.actors.filter(a => a.lanceOn && fptOf(a) === f);
    const demand = users.reduce((s, a) => s + a.nominal, 0);
    const supply = h.alim ? piShare + galimShare : 0;
    h.supply = supply; h.demand = demand;
    h.tank = clamp(h.tank + (supply - demand) / 60 * dt, 0, 3000);
    const k = h.tank > 1 ? 1 : demand > 0 ? Math.min(1, supply / demand) : 1;
    for (const a of users) { a.flow = a.nominal * k; a.flowing = a.flow > 20; }
    if (k < 0.99 && demand > 0 && !h.warned) { h.warned = true; const u = users[0]; radio(`CA FPT ${f.slice(3)}`, 'CDG', `Citerne du FPT ${f.slice(3)} vide${h.alim ? ', le débit du poteau ne suit pas' : ', je ne suis pas alimenté'} : lances en débit réduit !`, 'alerte'); penalty(8, `Rupture d'eau sur le FPT ${f.slice(3)} : ${h.alim ? 'ressource insuffisante (PI limité à 1000 L/min)' : 'engin non alimenté'}.`); void u; }
    if (k >= 0.99) h.warned = false;
    demandTot += demand; supplyTot += supply;
    G.hyd.used += demand / 60 * dt;
  }
  H.demand = demandTot; H.supply = supplyTot;
}

// ===========================================================================
// RENFORTS ET EMPLACEMENTS
// ===========================================================================
const RENFORTS = {
  GINC: { label: 'Groupe incendie (2 FPT)', delay: 18 * 60 }, GALIM: { label: 'Groupe alimentation (aspiration Weisbach)', delay: 22 * 60 },
  GEND: { label: 'Gendarmerie', delay: 8 * 60 }, GRDF: { label: 'GRDF et ENEDIS', delay: 20 * 60 }, CEPOL: { label: 'Cellule dépollution', delay: 25 * 60 },
  SMUR: { label: 'SMUR', delay: 14 * 60 }, GSAP2: { label: 'Groupe SAP supplémentaire', delay: 18 * 60 }, CUMP: { label: 'CUMP', delay: 30 * 60 },
  CDC: { label: 'Chef de colonne', delay: 0 }, FPT2: { label: 'Groupe incendie (2 FPT)', delay: 18 * 60, alias: 'GINC' }, VSAV2: { label: 'Groupe SAP supplémentaire', delay: 18 * 60, alias: 'GSAP2' },
  POLICE: { label: 'Gendarmerie', delay: 8 * 60, alias: 'GEND' }, ENEDIS: { label: 'GRDF et ENEDIS', delay: 20 * 60, alias: 'GRDF' },
};
function requestRenforts(keys) {
  const got = [];
  for (let k of keys) {
    if (RENFORTS[k] && RENFORTS[k].alias) k = RENFORTS[k].alias;
    if (!RENFORTS[k] || G.requests[k] || k === 'CDC') continue;
    G.requests[k] = { t: G.W.t, arrive: G.W.t + RENFORTS[k].delay };
    G.timers.push({ t: G.W.t + RENFORTS[k].delay, fn: () => renfortArrive(k) });
    got.push(RENFORTS[k].label);
  }
  if (got.length) radio('CODIS', 'CDG', `Reçu. Engagement : ${got.join(', ')}.`, 'msg');
}
function renfortArrive(k) {
  G.requests[k].onSite = true;
  const to = G.secteur ? 'PC' : 'CDG';
  if (k === 'GINC') {
    G.actors.push(binome('BAT3', 'BAT', 'FPT 3'), binome('BAL3', 'BAL', 'FPT 3'), binome('BAT4', 'BAT', 'FPT 4'), binome('BAL4', 'BAL', 'FPT 4'));
    radio('CDG Centre', to, 'Groupe incendie Centre au point de transit : FPT 3 et FPT 4, 4 binômes. Quelle mission ?', 'alerte');
  } else if (k === 'GALIM') {
    radio('CDG Alim', to, 'Groupe alimentation sur les lieux. Je pars en aspiration sur la Weisbach, rue de Geisbourg : 2000 L/min disponibles dans 8 minutes.', 'alerte');
    G.timers.push({ t: G.W.t + 480, fn: () => { G.hyd.galim = true; radio('CDG Alim', to, 'Aspiration en place sur la Weisbach, 2000 L/min vers les FPT alimentés.', 'cr'); know('galim', 'Aspiration sur la Weisbach en place'); G.dirty = true; } });
  } else if (k === 'GEND') { G.circulation = true; radio('Gendarmerie', to, 'Gendarmerie sur place : circulation coupée sur la RN 415, périmètre de sécurité en cours.', 'cr'); G.journal.push({ t: G.W.t, text: 'Circulation coupée sur la RN 415 par la gendarmerie.' }); }
  else if (k === 'GRDF') { G.pompesCoupees = true; radio('GRDF', to, 'GRDF et ENEDIS sur place : gaz et électricité coupés sur le restaurant et la station.', 'cr'); }
  else if (k === 'CEPOL') { G.avaloirs = true; radio('Cellule dépollution', to, 'Cellule dépollution sur place : avaloirs obturés, barrage flottant sur la Weiss.', 'cr'); }
  else radio(RENFORTS[k].label, to, `${RENFORTS[k].label} sur les lieux.`, 'cr');
  G.dirty = true;
}
const SLOTS = {
  PA: { sud: { label: 'Façade sud, sur la RN (feu en vue)', xz: [6, 8] }, est: { label: 'Entre la pizzeria et le HLM', xz: [22, -2] }, transit: { label: 'Point de transit (RN, à l\'ouest)', xz: [-70, 8] } },
};
const DEFAULT_SLOT = { PA: 'sud' };
function moveVehicle(id, slot) {
  if (!SLOTS[id] || !SLOTS[id][slot] || G.vpos[id] === slot) return false;
  const a = act(id);
  if (a && a.mission) { radio('EPA 30', 'CDG', 'Échelle en manœuvre : repliez-la avant de la déplacer.', 'cr'); return false; }
  G.moves[id] = { from: G.vpos[id], to: slot, t0: G.W.t, t1: G.W.t + 60 };
  radio('CDG', 'EPA 30', `Repositionnez-vous : ${SLOTS[id][slot].label.toLowerCase()}.`, 'ordre', CANAUX.TAC);
  G.timers.push({ t: G.W.t + 60, fn: () => { G.vpos[id] = slot; delete G.moves[id]; G.dirty = true; } });
  return true;
}

// ===========================================================================
// MISSIONS
// ===========================================================================
// lance : ou elle se tient et quels volumes elle arrose ([i, j, part])
const LANCES = {
  ATTAQUE_S: { pos: 'S', d: 100, target: [[0, 0, 0.3], [1, 0, 0.4], [2, 0, 0.3]] },
  ATTAQUE_O: { pos: 'O', d: 130, target: [[0, 0, 0.3], [0, 1, 0.4], [0, 2, 0.3]] },
  ATTAQUE_E: { pos: 'E', d: 140, target: [[2, 0, 0.3], [2, 1, 0.4], [2, 2, 0.3]] },
  ATTAQUE_N: { pos: 'N', d: 220, target: [[0, 2, 0.3], [1, 2, 0.4], [2, 2, 0.3]] },
  RIDEAU_GAZ: { pos: 'GAZ', d: 110, target: [[0, 1, 0.1]] },
  RIDEAU_HLM: { pos: 'HLM_F', d: 160, target: [[2, 1, 0.1]] },
};
const MISSIONS = {
  ATTAQUE_S: { label: 'Attaque façade sud (côté RN)', who: ['binome'] },
  ATTAQUE_O: { label: 'Attaque façade ouest (entre restaurant et station)', who: ['binome'] },
  ATTAQUE_E: { label: 'Attaque façade est (entre restaurant et HLM)', who: ['binome'] },
  ATTAQUE_N: { label: 'Attaque façade nord (côté Weisbach)', who: ['binome'] },
  RIDEAU_GAZ: { label: 'Rideau d\'eau sur le stock de bouteilles de gaz', who: ['binome'] },
  RIDEAU_HLM: { label: 'Rideau d\'eau en protection du HLM', who: ['binome'] },
  ALIM: { label: 'Alimenter l\'engin sur le PI 150 (40 m)', who: ['binome'] },
  TIERS_SO: { label: 'Mettre les tiers en sécurité au PRV, parking sud-ouest (au vent)', who: ['binome'] },
  TIERS_E: { label: 'Mettre les tiers en sécurité au parking du HLM (à l\'est)', who: ['binome'] },
  SECOURS_UA: { label: 'Premiers secours au brûlé : refroidissement, couverture, surveillance', who: ['binome'] },
  STATION: { label: 'Évacuer la station-service et couper les pompes (arrêt d\'urgence)', who: ['binome'] },
  BALISAGE_RN: { label: 'Couper provisoirement la circulation sur la RN 415 (balisage)', who: ['binome'] },
  RECO_HLM: { label: 'Reconnaissance du HLM sous ARI, mise en sécurité des occupants', who: ['binome'] },
  RECO_INT: { label: 'Reconnaissance intérieure du restaurant sous ARI (recherche de la plongeuse)', who: ['binome'] },
  PERIMETRE: { label: 'Baliser la zone d\'effondrement (1,5 × la hauteur), reculer les lances', who: ['binome'] },
  AVALOIRS: { label: 'Obturer les avaloirs de la RN (eaux d\'extinction)', who: ['binome'] },
  SECURITE: { label: 'Binôme de sécurité : ARI capelé, en attente au VLCG', who: ['binome'] },
  REPLI: { label: 'Repli à l\'engin', who: ['binome'] },
  LANCE_EPA: { label: 'Lance sur échelle : attaque du foyer par le dessus', who: ['echelle'] },
  LANCE_EPA_HLM: { label: 'Lance sur échelle en protection du HLM', who: ['echelle'] },
  RECO_EPA: { label: 'Reconnaissance par le dessus (étendue, toiture, arrière)', who: ['echelle'] },
  GSAP_UA: { label: 'Prendre en charge le brûlé grave (UA), médicalisation, évacuation', who: ['gsap'] },
  GSAP_PRV: { label: 'Ouvrir et tenir le PRV, recenser les impliqués', who: ['gsap'] },
  GSAP_HLM: { label: 'Accueillir les locataires du HLM au PRV, demander un lieu d\'accueil', who: ['gsap'] },
};
function availableMissions(a) {
  const out = [];
  if (a.loc === 'ABSENT' || a.hurt) return out;
  for (const [k, m] of Object.entries(MISSIONS)) {
    if (!m.who.includes(a.kind)) continue;
    if (k === 'ALIM' && (G.hyd[fptOf(a)] || {}).alim) continue;
    if (k === 'ATTAQUE_N' && G.perimetre) continue;
    if ((k === 'TIERS_SO' || k === 'TIERS_E') && (G.tiers.loc !== 'TROTTOIR' || G.tiers.moving)) continue;
    if (k === 'SECOURS_UA' && G.victims[0].cooled) continue;
    if (k === 'STATION' && G.stationEvac) continue;
    if (k === 'BALISAGE_RN' && G.circulation) continue;
    if (k === 'RECO_HLM' && G.hlm.reco) continue;
    if (k === 'PERIMETRE' && G.perimetre) continue;
    if (k === 'AVALOIRS' && G.avaloirs) continue;
    if (k === 'SECURITE' && a.mission === 'SECURITE') continue;
    if (a.kind === 'echelle' && G.vpos.PA === 'transit') continue;
    if (k === 'LANCE_EPA' && G.vpos.PA !== 'sud') continue;
    if (k === 'LANCE_EPA_HLM' && G.vpos.PA !== 'est') continue;
    if (a.kind === 'gsap' && a.mission === k) continue;
    out.push(k);
  }
  return out;
}
function order(a, key, opts) {
  opts = opts || {};
  if (!a || a.loc === 'ABSENT' || a.hurt) return;
  const m = MISSIONS[key]; if (!m) return;
  if (!opts.viaCA) radio('CDG', a.kind === 'binome' ? 'CA ' + a.engin : a.engin, `${a.kind === 'binome' ? a.label + ' : ' : ''}${m.label}${opts.lance ? ' (' + opts.lance + ')' : ''}.`, 'ordre', a.kind === 'gsap' && G.secteur ? 'DIR 602' : CANAUX.TAC);
  stopLance(a);
  a.mission = key; a.plan = []; a.cons = opts.consignes || a.cons;
  const P = a.plan;
  if (a.kind === 'binome') {
    P.push({ type: 'act', d: 8, label: 'Ordre transmis par le chef d\'agrès' });
    if (LANCES[key]) {
      const L = LANCES[key];
      a.nominal = opts.lance === 'LDV 250' ? 250 : 500; a.lanceName = opts.lance || 'LDV 500';
      P.push({ type: 'move', to: L.pos, d: L.d * (a.loc === 'ENGIN' ? 1 : 0.6), label: `Établissement ${a.lanceName}, ${LOC_NAMES[L.pos]}` });
      P.push({ type: 'lance', key });
    } else if (key === 'ALIM') {
      P.push({ type: 'move', to: 'PI', d: 60, label: 'Vers le poteau incendie' });
      P.push({ type: 'act', d: 150, label: 'Établissement sur le PI 150', fn: () => { G.hyd[fptOf(a)].alim = true; report(a, `FPT ${a.engin.slice(4)} alimenté sur le PI. Attention, le réseau ne donne pas plus de 1000 L/min au total.`); know('pi_limite', 'Réseau limité à 1000 L/min'); } });
      P.push({ type: 'move', to: 'ENGIN', d: 40 }); P.push({ type: 'done' });
    } else if (key === 'TIERS_SO' || key === 'TIERS_E') {
      const dest = key === 'TIERS_SO' ? 'PRV_SO' : 'PRV_E';
      P.push({ type: 'move', to: 'TROTTOIR', d: 30 });
      P.push({ type: 'act', d: 30, label: 'Regroupement des évacués', fn: () => {
        const cross = dest === 'PRV_SO';
        G.tiers.moving = { to: dest, t: 0, d: cross ? 200 : 150 };
        if (cross && !G.circulation) { penalty(6, 'Évacués conduits de l\'autre côté de la RN 415 sans coupure de la circulation.'); report(a, 'Je fais traverser les évacués vers le parking sud-ouest. La RN n\'est pas coupée, c\'est très chaud avec les voitures.'); }
        else report(a, `J'emmène les 34 évacués ${cross ? 'au parking sud-ouest, au vent' : 'au parking du HLM'}.`);
      } });
      P.push({ type: 'move', to: dest, d: 190 }); P.push({ type: 'act', d: 1, label: '', fn: () => report(a, `Évacués regroupés ${LOC_NAMES[dest]}, 34 personnes. Je reste avec eux en attendant le groupe SAP.`) });
      P.push({ type: 'standby', label: 'Encadrement des évacués au PRV' });
    } else if (key === 'SECOURS_UA') {
      P.push({ type: 'move', to: 'UA', d: 30 }); P.push({ type: 'act', d: 120, label: 'Refroidissement des brûlures, couverture, surveillance', fn: () => { G.victims[0].cooled = true; report(a, 'Brûlé refroidi et couvert : brûlures des deux bras et du visage, conscient, il souffre beaucoup. Il lui faut une médicalisation.'); know('ua_bilan', 'Bilan du brûlé : 3e degré bras et visage'); } });
      P.push({ type: 'standby', label: 'Surveillance du brûlé' });
    } else if (key === 'STATION') {
      P.push({ type: 'move', to: 'STATION', d: 70 }); P.push({ type: 'act', d: 90, label: 'Évacuation de la station, arrêt d\'urgence des pompes', fn: () => { G.stationEvac = true; G.pompesCoupees = true; report(a, 'Station évacuée : le gérant, la caissière et 2 clients. Pompes coupées à l\'arrêt d\'urgence. Le stock de bouteilles est à 9 m du restaurant.'); know('bouteilles', 'Stock d\'une quarantaine de bouteilles à 9 m de la façade ouest'); } });
      P.push({ type: 'move', to: 'ENGIN', d: 60 }); P.push({ type: 'done' });
    } else if (key === 'BALISAGE_RN') {
      P.push({ type: 'move', to: 'RN', d: 60 }); P.push({ type: 'act', d: 90, label: 'Balisage, cônes et flash, déviation', fn: () => { G.circulation = true; report(a, 'Circulation coupée sur la RN 415 de part et d\'autre, déviation par la rue de Geisbourg. Il faudra nous relever (gendarmerie).'); } });
      P.push({ type: 'standby', label: 'Maintien de la coupure de la RN' });
    } else if (key === 'RECO_HLM') {
      P.push({ type: 'act', d: 45, label: 'Capelage ARI', fn: () => { a.ari = true; a.engT = G.W.t; } });
      P.push({ type: 'move', to: 'HLM', d: 150 }); P.push({ type: 'act', d: 300, label: 'Reconnaissance des 12 logements, portes, fumées', fn: () => {
        G.hlm.reco = true; const pmr = G.victims.find(v => v.id === 'PMR');
        if (!pmr.atRue) { pmr.found = true; pmr.atRue = true; pmr.loc = 'PRV_SO'; pmr.fed = Math.max(pmr.fed, 0.1); report(a, `HLM reconnu : ${G.hlm.smoke > 0.3 ? 'fumées dans la cage et les logements côté pizzeria' : 'peu de fumée'}. Une dame en fauteuil roulant au 2e, évacuée par la cage. Les autres logements sont vides, portes fermées.`); }
        else report(a, 'HLM reconnu, plus personne dans les logements.');
        know('hlm_reco', 'HLM reconnu et mis en sécurité');
      } });
      P.push({ type: 'move', to: 'ENGIN', d: 120 }); P.push({ type: 'done' });
    } else if (key === 'RECO_INT') {
      P.push({ type: 'act', d: 45, label: 'Capelage ARI', fn: () => { a.ari = true; a.engT = G.W.t; } });
      P.push({ type: 'move', to: 'INT', d: 60 }); P.push({ type: 'recoInt' });
    } else if (key === 'PERIMETRE') {
      P.push({ type: 'move', to: 'N_LOIN', d: 160 }); P.push({ type: 'act', d: 90, label: 'Balisage de la zone d\'effondrement', fn: () => {
        G.perimetre = true;
        for (const x of G.actors.filter(x => x.loc === 'N' && x.lanceOn)) { x.loc = 'N_LOIN'; x.target = LANCES.ATTAQUE_N.target.map(([i, j, f]) => [i, j, f * 0.5]); report(x, 'Lance reculée hors de la zone d\'effondrement, efficacité réduite.'); }
        report(a, 'Zone d\'effondrement balisée au nord et à l\'est (12 m), plus personne dedans.');
      } });
      P.push({ type: 'move', to: 'ENGIN', d: 120 }); P.push({ type: 'done' });
    } else if (key === 'AVALOIRS') {
      P.push({ type: 'move', to: 'AVAL', d: 50 }); P.push({ type: 'act', d: 150, label: 'Obturation des avaloirs (bâches, boudins)', fn: () => { G.avaloirs = true; report(a, 'Avaloirs de la RN obturés, les eaux d\'extinction stagnent sur la chaussée.'); } });
      P.push({ type: 'move', to: 'ENGIN', d: 40 }); P.push({ type: 'done' });
    } else if (key === 'SECURITE') {
      if (a.loc !== 'ENGIN') P.push({ type: 'move', to: 'ENGIN', d: 60 });
      P.push({ type: 'act', d: 45, label: 'Capelage ARI', fn: () => { a.ari = true; } });
      P.push({ type: 'standby', label: 'Binôme de sécurité, ARI capelé, au VLCG' });
    } else if (key === 'REPLI') { P.push({ type: 'move', to: 'ENGIN', d: 60 }); P.push({ type: 'done' }); }
  } else if (a.kind === 'echelle') {
    P.push({ type: 'act', d: 180, label: 'Mise en station de l\'échelle', fn: () => { a.stationed = true; } });
    if (key === 'LANCE_EPA' || key === 'LANCE_EPA_HLM') { a.nominal = 600; a.lanceName = 'lance-canon 600 L/min'; P.push({ type: 'lance', key }); }
    else { P.push({ type: 'act', d: 60, label: 'Reconnaissance par le dessus', fn: () => { recoDessus(a); a.stationed = false; } }); P.push({ type: 'done' }); }
  } else if (a.kind === 'gsap') {
    P.push({ type: 'gsap', key });
  }
  G.dirty = true;
}
function orderCA(engin, list, cons) {
  if (G.ended) return null;
  list = list.filter(e => e.mission); if (!list.length) return null;
  const mis = list.map(e => `${e.id.replace(/\d/, '')} : ${MISSIONS[e.mission].label.toLowerCase()}${e.opts && e.opts.lance ? ' (' + e.opts.lance + ')' : ''}`);
  const consTxt = [cons.lance && 'eau avant toute progression', cons.cr && 'compte rendu en place', cons.ari && 'sortie à 100 bar'].filter(Boolean);
  radio('CDG', 'CA ' + engin, `ORDRE — Missions : ${mis.join(' ; ')}. Sécurité : ${consTxt.join(', ') || 'aucune consigne'}.`, 'ordre', CANAUX.TAC);
  G.orderLog.push({ t: G.W.t, engin, list, cons });
  G.timers.push({ t: G.W.t + 6, fn: () => { radio('CA ' + engin, 'CDG', `Je collationne : ${mis.join(' ; ')}.`, 'cr', CANAUX.TAC); for (const e of list) order(act(e.id), e.mission, Object.assign({}, e.opts || {}, { viaCA: true, consignes: cons })); } });
  return true;
}
function stopLance(a) { a.lanceOn = false; a.flowing = false; a.flow = 0; a.target = null; }
function recoDessus(a) {
  const n = burning().length;
  for (const c of G.W.cells) G.K.cells[c.j * 3 + c.i] = { t: G.W.t, q: c.q, on: c.on };
  know('etendue', `Étendue reconnue par le dessus : ${areaOnFire()} m² en feu`);
  report(a, `Vue du dessus : ${areaOnFire()} m² en feu sur 900, ${n >= 7 ? 'toiture effondrée par endroits' : 'toiture en bac acier qui se déforme'}. Côté ouest, le stock de bouteilles est ${G.gaz.T > 60 ? 'brûlant, la peinture cloque' : 'exposé au rayonnement'}. ${G.W.wind >= 30 ? 'Le panache se couche sur le HLM.' : 'Panache vertical, léger vent d\'ouest.'}`);
  know('bouteilles', 'Stock d\'une quarantaine de bouteilles à 9 m de la façade ouest');
}
function tickActor(a, dt) {
  if (a.loc === 'ABSENT') return;
  if (a.ari && a.loc !== 'ENGIN' && a.kind === 'binome') {
    a.air -= dt * 1.1;
    if (a.air < 300 && !a.lowAir) { a.lowAir = true; report(a, 'Sifflet, je ressors.'); a.plan = [{ type: 'move', to: 'ENGIN', d: 90 }, { type: 'act', d: 300, label: 'Changement de bouteille', fn: () => { a.air = 1500; a.lowAir = false; a.ari = false; } }, { type: 'done' }]; a.mission = null; }
  }
  const s = a.plan[0];
  if (!s) return;
  if (s.type === 'act') { s.t = (s.t || 0) + dt; a.status = s.label || a.status; if (s.t >= s.d) { a.plan.shift(); s.fn && s.fn(); G.dirty = true; } return; }
  if (s.type === 'move') {
    s.t = (s.t || 0) + dt; a.next = s.to; a.prog = s.t / s.d; a.status = s.label || `Vers : ${LOC_NAMES[s.to] || s.to}`;
    if (s.t >= s.d) { a.loc = s.to; a.next = null; a.prog = 0; a.plan.shift(); G.dirty = true; }
    return;
  }
  if (s.type === 'lance') {
    if (!a.lanceOn) {
      a.lanceOn = true; a.target = (LANCES[s.key] || {}).target || (s.key === 'LANCE_EPA' ? [[1, 0, 0.5], [1, 1, 0.5]] : [[2, 1, 0.1]]);
      if (s.key === 'LANCE_EPA_HLM') a.target = [];
      const c = s.key.startsWith('ATTAQUE') ? (() => { const L = LANCES[s.key]; const qs = L.target.map(([i, j]) => cell(i, j).q); const mx = Math.max(...qs); return mx > 0.6 ? 'feu violent, rayonnement très fort' : mx > 0.2 ? 'flammes visibles' : 'pas de flammes de ce côté pour l\'instant'; })() : '';
      report(a, `${a.lanceName || 'Lance'} en manœuvre, ${LOC_NAMES[(LANCES[s.key] || {}).pos] || 'sur l\'échelle'}${c ? ' : ' + c : ''}.`);
      for (const [i, j] of (a.target || [])) G.K.cells[j * 3 + i] = { t: G.W.t, q: cell(i, j).q, on: cell(i, j).on };
    }
    a.status = `${a.lanceName} en manœuvre${a.flow < a.nominal * 0.95 ? ` (débit réduit : ${Math.round(a.flow)} L/min)` : ''}`;
    if (G.W.t - (a.lastSeen || 0) > 120) { a.lastSeen = G.W.t; for (const [i, j] of (a.target || [])) G.K.cells[j * 3 + i] = { t: G.W.t, q: cell(i, j).q, on: cell(i, j).on }; }
    return;
  }
  if (s.type === 'standby') { a.status = s.label; return; }
  if (s.type === 'recoInt') {
    s.t = (s.t || 0) + dt; a.status = 'Reconnaissance intérieure sous ARI';
    if (!s.warned && areaOnFire() > 300) { s.warned = true; penalty(25, 'Binôme engagé à l\'intérieur d\'un restaurant de 900 m² en feu, toiture bac acier, bouteilles de propane dans la réserve : engagement non justifié.'); }
    if (areaOnFire() > 500 && s.t > 40 && !a.hurt) { a.hurt = true; report(a, 'Chaleur insoutenable, chute de faux plafond enflammé ! Repli, un équipier brûlé.'); penalty(20, `${a.label} (${a.engin}) brûlé lors de la reconnaissance intérieure.`); a.plan = [{ type: 'move', to: 'ENGIN', d: 90 }, { type: 'done' }]; a.mission = null; return; }
    if (s.t > 120) { a.plan.shift(); report(a, 'Reconnaissance intérieure : visibilité nulle, pas de victime trouvée dans la partie accessible. Je ressors.'); a.plan.unshift({ type: 'move', to: 'ENGIN', d: 80 }); a.plan.push({ type: 'done' }); }
    return;
  }
  if (s.type === 'gsap') {
    const k = s.key;
    if (k === 'GSAP_UA') { a.status = 'Prise en charge du brûlé'; G.timers.push({ t: G.W.t + 240, fn: () => { const v = G.victims[0]; v.pec = true; v.bilan = 'Brûlures 3e degré, 25 % de la surface corporelle, conscient, douloureux'; report(a, 'Brûlé grave pris en charge : 25 % de surface brûlée au 3e degré. Je demande un SMUR, évacuation vers le centre de brûlés de Metz après médicalisation.'); if (!G.requests.SMUR) requestRenforts(['SMUR']); G.timers.push({ t: G.W.t + 900, fn: () => { v.evac = { t: G.W.t, dest: 'CHU, centre de brûlés', medic: !!(G.requests.SMUR && G.requests.SMUR.onSite) }; report(a, `Brûlé évacué vers le centre de brûlés${v.evac.medic ? ', médicalisé' : ''}.`); } }); } }); }
    if (k === 'GSAP_PRV') { a.status = 'Gestion du PRV et recensement'; G.gsapMission = 'PRV'; G.timers.push({ t: G.W.t + 300, fn: () => { G.prv = true; report(a, `PRV ouvert ${G.tiers.loc === 'TROTTOIR' ? 'sur le trottoir (les évacués y sont encore)' : LOC_NAMES[G.tiers.loc]} : 30 clients et 4 employés recensés, dont la plongeuse retrouvée derrière la station. Quelques malaises, rien de grave.`); setPlongeuse('retrouvée'); } }); }
    if (k === 'GSAP_HLM') { a.status = 'Accueil des locataires du HLM'; G.timers.push({ t: G.W.t + 300, fn: () => { G.accueilHLM = true; report(a, 'Locataires du HLM accueillis au PRV. Il faut une structure d\'accueil : demande au maire (gymnase).'); } }); }
    a.plan.shift(); a.plan.push({ type: 'standby', label: MISSIONS[k].label });
    return;
  }
  if (s.type === 'done') { a.plan.shift(); a.mission = null; a.status = a.loc === 'ENGIN' ? 'Disponible à l\'engin' : `Disponible (${LOC_NAMES[a.loc] || a.loc})`; G.dirty = true; }
}
function setPlongeuse(st) { if (G.plongeuse === 'retrouvée') return; G.plongeuse = st; know('tous_sortis', 'Tous les occupants du restaurant sont sortis (plongeuse retrouvée)'); G.journal.push({ t: G.W.t, text: 'La plongeuse est retrouvée : tous les occupants sont sortis.' }); }

// ===========================================================================
// CHEF DE COLONNE : point de situation puis prise de COS
// ===========================================================================
function cdcArrive() {
  G.passation = { t: G.W.t, done: false };
  radio('Cne Flamme (CDC)', 'CDG', 'Chef de colonne sur les lieux avec le PC. Je vous rejoins au VLCG : faites-moi un point de situation.', 'alerte');
  G.journal.push({ t: G.W.t, text: 'Arrivée du chef de colonne : point de situation attendu.' });
  G.timers.push({ t: G.W.t + 420, fn: () => { if (!G.passation.done) { radio('Cne Flamme (CDC)', 'CDG', 'J\'attends toujours votre point de situation, je prends le COS sans lui.', 'alerte'); passationDone(null); } } });
  G.dirty = true;
}
const hasW = (s, re) => re.test((s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''));
function sendPassation(f) {
  if (!G.passation || G.passation.done) return null;
  const all = [f.vois, f.prevois, f.victimes, f.fais, f.demande].join(' ');
  const out = []; let pts = 0;
  const ok = (c, good, bad, p) => { out.push({ ok: !!c, text: c ? good : bad }); if (c) pts += p; };
  ok(hasW(f.vois, /900|restaurant|pizzeria/) && hasW(f.vois, /generalis|embras|totalit|entier|tout le/), 'Nature et ampleur : restaurant de 900 m² embrasé.', 'Ampleur du feu non donnée (900 m², embrasement).', 15);
  ok(hasW(all, /bouteille|gaz|station/), 'Risque du stock de bouteilles de gaz et de la station signalé.', 'Le stock de bouteilles de gaz et la station ne sont pas évoqués.', 15);
  ok(hasW(all, /hlm|immeuble|habitation/), 'Menace sur le HLM signalée.', 'Le HLM sous le vent n\'est pas évoqué.', 10);
  ok(hasW(f.victimes + ' ' + f.vois, /brule|ua|urgence absolue|grave/) && hasW(f.victimes + ' ' + f.vois, /34|30|clients|evacu|impliqu/), 'Victimes : le brûlé grave et les 34 évacués.', 'Bilan des victimes incomplet (1 UA brûlé, 34 évacués).', 15);
  ok(hasW(all, /1000|debit|alimentation|aspiration|weisbach|g ?alim|eau/), 'Problème d\'alimentation en eau exposé.', 'La limite du réseau (1000 L/min) et le besoin d\'aspiration ne sont pas exposés.', 15);
  ok(hasW(f.fais, /rideau|protection|ldv|lance|attaque/), 'Actions hydrauliques engagées décrites.', 'Actions engagées non décrites.', 10);
  ok(hasW(f.demande, /groupe|g ?inc|g ?alim|sap|gendarm|police|grdf|cepol|renfort/), 'Besoins en renforts exprimés.', 'Pas de besoins exprimés.', 10);
  ok(hasW(all, /effondr|mur|structure|toiture|bac acier/) || hasW(all, /pollution|avaloir|weiss/), 'Risque d\'effondrement ou de pollution anticipé.', 'Ni effondrement ni pollution anticipés.', 10);
  const ev = { pts: Math.min(100, pts), out };
  G.passation.f = f; G.passation.ev = ev;
  radio('CDG', 'Cne Flamme (CDC)', `POINT DE SITUATION — ${f.vois} / Risques : ${f.prevois} / Victimes : ${f.victimes} / Actions : ${f.fais} / Besoins : ${f.demande}`, 'msg', CANAUX.TAC);
  const c = { type: 'pds', t: G.W.t, f, ev, model: modelPassation() };
  G.lastCorrection = c;
  passationDone(ev);
  return c;
}
function modelPassation() {
  return {
    vois: `Feu du restaurant « pizzeria » route de Lapoutroie, bâtiment simple rez-de-chaussée de 900 m², ${areaOnFire()} m² en feu, structure charpente bois et toiture bac acier.`,
    prevois: 'Embrasement de la totalité et effondrement de la toiture et des murs ; rayonnement sur le stock d\'une quarantaine de bouteilles de gaz de la station (risque d\'explosion) ; fumées et brandons sur le HLM R+3 si le vent tourne ou forcit ; pollution de la Weiss par les eaux d\'extinction.',
    victimes: '1 employé brûlé au 3e degré (UA) ; 30 clients et 4 employés évacués, regroupés ; plongeuse d\'abord manquante puis retrouvée.',
    fais: 'Rideau d\'eau sur le stock de bouteilles, protection du HLM, attaque par les façades en LDV 500, évacuation de la station et coupure des pompes, tiers au PRV au vent, premiers secours au brûlé.',
    demande: 'Réseau limité à 1000 L/min : groupe alimentation en aspiration sur la Weisbach ; 1 groupe incendie ; gendarmerie pour la RN 415 et le périmètre ; GRDF et ENEDIS ; groupe SAP pour le PRV ; cellule dépollution.',
  };
}
function passationDone(ev) {
  G.passation.done = true; G.passation.doneT = G.W.t; G.secteur = true; G.phase = 'conduite';
  G.timers.push({ t: G.W.t + 20, fn: () => {
    radio('Cne Flamme (CDC)', 'CDG', 'Je prends le COS, PC au parking sud-ouest. Vous êtes chef du secteur incendie, sur la DIR 633 pour vos binômes et la DIR 602 avec le PC. Mission : protéger la station et le HLM, puis éteindre. Le Ltn Collier prend le secteur SAP et le PRV.', 'ordre', 'DIR 602');
    const gs = act('GSAP');
    if (gs && gs.loc !== 'ABSENT' && !gs.mission) order(gs, 'GSAP_PRV', { viaCA: true });
    if (!G.requests.GALIM) { requestRenforts(['GALIM']); G.journal.push({ t: G.W.t, text: 'Le chef de colonne demande lui-même le groupe alimentation.' }); }
    G.dirty = true;
  } });
  G.journal.push({ t: G.W.t, text: ev ? `Point de situation au chef de colonne (${ev.pts} %), passation du COS.` : 'Passation du COS sans point de situation.' });
}

// ===========================================================================
// BOUCLE
// ===========================================================================
function runTimers() { for (let i = G.timers.length - 1; i >= 0; i--) if (G.timers[i].t <= G.W.t) { const f = G.timers[i].fn; G.timers.splice(i, 1); f(); } }
function tick(dt) {
  dt = dt || DT;
  const W = G.W;
  runTimers();
  if (G.busy && W.t >= G.busy.until) { const b = G.busy; G.busy = null; b.done(); G.dirty = true; }
  for (const a of G.actors) tickActor(a, dt);
  stepHydro(dt);
  stepFire(dt);
  stepTargets(dt);
  for (const e of W.events) onEvent(e);
  W.events.length = 0;
  updateFireStatus();
  if (!G.generalise && burning().filter(c => c.q > 0.5).length >= 8) { G.generalise = W.t; G.journal.push({ t: W.t, text: 'Embrasement généralisé de l\'ensemble des 900 m².' }); know('generalise', 'Embrasement généralisé des 900 m²'); }
  if (!G.reserveBoom && cell(2, 2).q > 0.7) { G.reserveBoom = true; G.journal.push({ t: W.t, text: 'Éclatement des deux bouteilles de propane de la réserve (dans le volume en feu).' }); if (!G.pre) radio('CA FPT 2', 'CDG', 'Deux détonations dans le restaurant, côté réserve !', 'alerte'); const inside = G.actors.filter(a => a.loc === 'INT'); if (inside.length) { penalty(20, 'Binôme à l\'intérieur lors de l\'éclatement des bouteilles de la réserve.'); for (const a of inside) a.hurt = true; } }
  W.t += dt;
  if (W.t >= T_FIN_MAX && !G.ended) endGame('Arrivée du chef de site, fin de l\'exercice');
}
function onEvent(e) {
  const c = G.W.cells[e.n];
  if (e.type === 'propagation') { G.fire.lastSpread = G.W.t; G.journal.push({ t: G.W.t, text: `Propagation : ${CELL_NAMES[c.j][c.i]}.` }); }
  if (e.type === 'abattu') G.journal.push({ t: G.W.t, text: `Flammes abattues : ${CELL_NAMES[c.j][c.i]}.` });
}
const FIRE_STATES = [['developpement', 'En développement'], ['non_maitrise', 'Non maîtrisé'], ['circonscrit', 'Circonscrit'], ['maitrise', 'Maîtrisé'], ['eteint', 'Éteint']];
function updateFireStatus() {
  const W = G.W, F = G.fire;
  const tot = W.cells.reduce((s, c) => s + c.q, 0);
  const threats = (G.gaz.flux > 6 && !lanceAt('GAZ').length) || (G.hlm.flux > 6 && !lanceAt('HLM_F').length) || G.hlm.fire;
  let cand;
  // l'extinction complete demande des heures de deblai (engins de travaux publics) : hors du temps de l'exercice
  if (tot < 1.2 && W.t - F.lastSpread > 300) cand = 'maitrise';
  else if (!threats && W.t - F.lastSpread > 300 && G.hyd.demand >= 1500) cand = 'circonscrit';
  else if (W.t - F.lastSpread < 240) cand = 'developpement';
  else cand = 'non_maitrise';
  if (cand === F.cur) { F.cand = null; return; }
  if (F.cand !== cand) { F.cand = cand; F.candT = W.t; return; }
  if (W.t - F.candT >= 30) { F.cur = cand; F.cand = null; F.log.push({ t: W.t, s: cand }); G.journal.push({ t: W.t, text: 'Situation du feu : ' + FIRE_STATES.find(x => x[0] === cand)[1] }); }
}

// ===========================================================================
// TEMOINS ET OBSERVATIONS
// ===========================================================================
const WITNESSES = [
  { id: 'GER', short: 'Gérant station', name: 'M. Muller, gérant de la station-service (requérant)', appear: T_ARRIVEE + 30,
    hello: 'Le gérant de la station arrive en courant : « C\'est moi qui ai appelé ! J\'ai tout mon stock de gaz juste à côté ! »',
    questions: [
      { id: 'g1', q: 'Combien de bouteilles de gaz, et où ?', a: 'Une quarantaine, butane et propane, des pleines et des vides, dans la cage grillagée contre le mur, à 9 mètres du restaurant.', fact: ['bouteilles', 'Stock d\'une quarantaine de bouteilles à 9 m de la façade ouest'] },
      { id: 'g2', q: 'Reste-t-il du monde dans la station ?', a: 'Ma caissière et deux clients, et les pompes tournent encore.', fact: ['station_occupee', 'Station encore occupée, pompes en service'] },
      { id: 'g3', req: 'g2', q: 'Pouvez-vous couper les pompes ?', a: 'Il y a l\'arrêt d\'urgence à la caisse. Je n\'ai pas osé y retourner, il fait trop chaud.' },
      { id: 'g4', q: 'Qu\'avez-vous vu au début ?', a: 'De la fumée noire par le toit côté cuisine, au fond. Puis les clients sont tous sortis en courant par la grande porte.' },
    ] },
  { id: 'PAT', short: 'Patron pizzeria', name: 'M. Rinaldi, patron de la pizzeria', appear: T_ARRIVEE + 70,
    hello: 'Le patron, en tablier, les mains noires : « Mon restaurant ! Karim est brûlé, il est là-bas ! »',
    questions: [
      { id: 'p1', q: 'Tout le monde est-il sorti ?', a: 'Les 30 clients oui, on les a comptés sur le trottoir. Les employés… je ne vois pas Sonia, la plongeuse ! Elle était en cuisine.', fact: ['doute_plongeuse', 'Doute : la plongeuse n\'est pas retrouvée'], fn: () => G.timers.push({ t: G.W.t + 330, fn: () => { if (G.plongeuse !== 'retrouvée') { radio('Patron pizzeria', 'CDG', 'Sonia est là ! Elle était partie fumer derrière la station, elle n\'a rien.', 'temoin'); setPlongeuse('retrouvée'); } } }) },
      { id: 'p2', q: 'Où le feu a-t-il pris ?', a: 'À la friteuse, sous la hotte, en cuisine. Karim a voulu l\'éteindre avec un torchon.', fact: ['origine', 'Départ de feu en cuisine (friteuse)'] },
      { id: 'p3', q: 'Y a-t-il du gaz dans le restaurant ?', a: 'Le gaz de ville pour la cuisine. Et deux bouteilles de propane dans la réserve, au fond à droite, pour la terrasse chauffée.', fact: ['gaz_reserve', 'Gaz de ville et 2 bouteilles de propane dans la réserve'] },
      { id: 'p4', q: 'Comment est construit le bâtiment ?', a: 'C\'est un ancien entrepôt : murs en parpaing, charpente en bois, faux plafond, toit en bac acier. 900 m² d\'un seul tenant, pas de mur coupe-feu.', fact: ['structure', 'Bâtiment de 900 m² sans recoupement, charpente bois, toiture bac acier'] },
      { id: 'p5', q: 'Où est le blessé, comment va-t-il ?', a: 'Assis sur le trottoir, devant. Il a les bras et le visage brûlés, il tremble.', fact: ['ua', 'Un employé brûlé grave sur le trottoir'] },
    ] },
  { id: 'LOC', short: 'Locataire HLM', name: 'Mme Klein, locataire du HLM', appear: T_VENT + 90,
    hello: 'Une femme sort du HLM en toussant : « La fumée rentre partout chez nous ! »',
    questions: [
      { id: 'h1', q: 'Qu\'est-ce qui se passe dans l\'immeuble ?', a: 'La fumée rentre par les fenêtres côté restaurant, il tombe des braises sur les balcons. Ma voisine du 2e est en fauteuil roulant, elle ne peut pas descendre !', fact: ['pmr', 'Une personne en fauteuil roulant au 2e étage du HLM'] },
      { id: 'h2', q: 'Combien de personnes dans l\'immeuble ?', a: 'Douze logements, une cinquantaine de personnes. Beaucoup sont déjà sortis.', fact: ['hlm_occupants', 'HLM : 12 logements, une cinquantaine d\'occupants'] },
    ] },
];
function witnessDef(id) { return WITNESSES.find(w => w.id === id); }
function availableQuestions(wid) { const d = witnessDef(wid); return d.questions.filter(q => !G.asked[q.id] && (!q.req || G.asked[q.req])); }
function ask(wid, qid) {
  if (G.busy || G.ended) return false;
  const d = witnessDef(wid), q = d.questions.find(x => x.id === qid);
  G.busy = { until: G.W.t + 12, start: G.W.t, label: `Échange avec ${d.short.toLowerCase()}`, q: q.q, done: () => {
    G.asked[q.id] = { t: G.W.t }; if (q.fact) know(q.fact[0], q.fact[1]); if (q.fn) q.fn();
    G.journal.push({ t: G.W.t, text: `${d.short} : ${q.q} → ${q.a}` });
    G.observations.unshift({ t: G.W.t, kind: 'temoin', who: d.short, text: `« ${q.a} »`, q: q.q });
    if (window.UI && UI.toast) UI.toast(`${d.short} : « ${q.a} »`, 'temoin');
  } };
  return true;
}
function observeText(what) {
  const W = G.W, n = burning().length;
  if (what === 'TOIT' || what.startsWith('FACADE')) {
    const side = { FACADE_S: [[0, 0], [1, 0], [2, 0]], FACADE_O: [[0, 0], [0, 1], [0, 2]], FACADE_E: [[2, 0], [2, 1], [2, 2]], TOIT: [[1, 1], [1, 2], [0, 2], [2, 2]] }[what] || [];
    for (const [i, j] of side) G.K.cells[j * 3 + i] = { t: W.t, q: cell(i, j).q, on: cell(i, j).on };
    const qs = side.map(([i, j]) => cell(i, j).q), mx = Math.max(...qs);
    const lab = { FACADE_S: 'Façade sud', FACADE_O: 'Façade ouest', FACADE_E: 'Façade est', TOIT: 'Toiture' }[what];
    if (what === 'TOIT') know('etendue_partielle', 'Feu visible en toiture');
    return `${lab} : ${mx > 0.7 ? 'flammes hautes, vitrages tombés, rayonnement qui empêche l\'approche' : mx > 0.3 ? 'flammes par les ouvertures, fumées noires sous pression' : mx > 0.05 ? 'fumées épaisses, lueurs' : 'fumées, pas de flammes visibles de ce côté'}. ${n >= 7 ? 'Le feu tient presque tout le bâtiment.' : ''}`;
  }
  if (what === 'GAZ') { know('bouteilles', 'Stock d\'une quarantaine de bouteilles à 9 m de la façade ouest'); const T = G.gaz.T; return `Stock de bouteilles de la station, à 9 m du restaurant : ${G.gaz.bleve ? 'stock éclaté, bouteilles projetées' : G.gaz.soupape ? 'une soupape crache une torchère, les bouteilles sont brûlantes' : T > 55 ? 'la peinture des bouteilles côté restaurant cloque' : T > 40 ? 'les bouteilles chauffent, on sent le rayonnement' : 'pour l\'instant à l\'abri du rayonnement'}${lanceAt('GAZ').length ? ', rideau d\'eau en place' : ''}.`; }
  if (what === 'HLM') { know('hlm', 'HLM R+3 à 13 m à l\'est'); return `HLM R+3 à 13 m à l'est : ${G.hlm.fire ? 'feu dans un appartement du 1er côté restaurant' : G.hlm.smoke > 0.3 ? 'façade noyée dans les fumées, des brandons tombent sur les balcons' : G.hlm.T > 60 ? 'la façade côté restaurant chauffe, des habitants aux fenêtres' : 'des habitants regardent aux fenêtres'}${lanceAt('HLM_F').length ? ', rideau d\'eau en place' : ''}.`; }
  if (what === 'TIERS') { know('tiers', '34 évacués dont 1 brûlé grave'); return G.tiers.loc === 'TROTTOIR' ? `Une trentaine d'évacués sur le trottoir, au bord de la RN 415 ${G.circulation ? 'coupée' : 'où les voitures passent encore'}, à 5 m de la façade. Le brûlé est assis parmi eux.` : `Évacués regroupés ${LOC_NAMES[G.tiers.loc]}.`; }
  return '';
}
function observe(what) {
  if (G.busy || G.ended) return false;
  G.busy = { until: G.W.t + 6, start: G.W.t, label: 'Lecture du feu', done: () => { const t = observeText(what); G.observations.unshift({ t: G.W.t, kind: 'obs', text: t }); G.journal.push({ t: G.W.t, text: 'Observation : ' + t }); if (window.UI && UI.toast) UI.toast(t, 'obs'); } };
  return true;
}

// ===========================================================================
// MESSAGES ET EVALUATION
// ===========================================================================
function evalAmbiance(f) {
  const t = G.W.t - T_ARRIVEE, out = []; let pts = 0;
  const ok = (c, good, bad, p) => { out.push({ ok: !!c, text: c ? good : bad }); if (c) pts += p; };
  ok(t <= 300, `Passé ${fmtDur(t)} après l'arrivée.`, `Passé ${fmtDur(t)} après l'arrivée : au-delà des 5 min.`, 15);
  ok(f.cos || hasW(f.suis, /\bcos\b/), 'Prise de COS annoncée.', 'Prise de COS non annoncée.', 5);
  ok(hasW(f.suis, /lapoutroie|415/) && hasW(f.suis, /kaysersberg/), 'Adresse complète (RN 415, Kaysersberg).', 'Adresse incomplète.', 10);
  ok(hasW(f.vois, /restaurant|pizzeria/) && hasW(f.vois, /900|rez|plain|rdc/), 'Nature et volume : restaurant de plain-pied de 900 m².', 'Nature et volume du bâtiment incomplets.', 10);
  ok(hasW(f.vois + f.prevois, /brule|ua|urgence absolue|grave/), 'Brûlé grave signalé.', 'Le brûlé grave n\'apparaît pas.', 10);
  ok(hasW(f.vois, /30|34|35|clients|evacu|impliqu/), 'Évacués signalés.', 'Les évacués ne sont pas mentionnés.', 10);
  ok(hasW(f.vois + f.prevois, /bouteille|gaz|station/), 'Risque du stock de gaz signalé.', 'Le stock de bouteilles de gaz voisin n\'est pas signalé.', 15);
  ok(hasW(f.prevois, /propag|generalis|hlm|immeuble|explos|effondr/), 'Évolution anticipée.', '« Je prévois » vide ou sans évolution.', 10);
  ok(hasW(f.demande, /groupe|g ?inc|g ?alim|alimentation|sap|gendarm|police|grdf/) || (f.renforts || []).length, 'Renforts demandés.', 'Aucun renfort demandé pour un feu de 900 m².', 15);
  return { pts, out, t };
}
function evalCR(f) {
  const out = []; let pts = 0;
  const ok = (c, good, bad, p) => { out.push({ ok: !!c, text: c ? good : bad }); if (c) pts += p; };
  ok(hasW(f.vois, /900|generalis|embras|m2|m²/), 'Ampleur du feu donnée.', 'Ampleur du feu absente.', 25);
  ok(hasW(f.victimes + f.vois, /brule|ua|impliqu|evacu|34|30/), 'Bilan des victimes et impliqués.', 'Bilan victimes absent.', 25);
  ok(hasW(f.fais, /rideau|ldv|lance|protection|attaque/), 'Dispositif hydraulique décrit.', 'Dispositif non décrit.', 25);
  ok(hasW(f.suis, /lapoutroie|415|kaysersberg/), 'Localisation rappelée.', 'Localisation non rappelée.', 25);
  return { pts, out };
}
function modelMessage(type) {
  const unk = s => `<em class="unk">${s} (non connu à ce moment)</em>`, K = G.K.facts;
  const out = {
    suis: 'Route de Lapoutroie, RN 415, Kaysersberg, restaurant « la pizzeria ». Je prends le COS.',
    vois: `Feu de restaurant de plain-pied de 900 m², ${areaOnFire()} m² en feu, fumées noires abondantes ; un employé brûlé grave et une trentaine de clients et employés évacués sur le trottoir ; ${K.bouteilles ? 'stock d\'une quarantaine de bouteilles de gaz à 9 m, station-service à l\'ouest' : unk('stock de bouteilles de gaz à 9 m')} ; HLM R+3 à 13 m à l'est.`,
    prevois: 'Embrasement des 900 m², effondrement de la toiture, explosion du stock de bouteilles exposé au rayonnement, propagation au HLM sous le vent.',
    fais: 'Mise en sécurité des tiers, premiers secours au brûlé, rideau d\'eau sur le stock de gaz, attaque par les façades, alimentation sur PI, évacuation de la station.',
    demande: '1 groupe incendie, 1 groupe alimentation (réseau limité, aspiration sur la Weisbach), gendarmerie pour la RN 415, GRDF et ENEDIS, chef de colonne.',
  };
  if (type === 'cr') { out.vois = `Feu ${G.fire.cur === 'circonscrit' ? 'circonscrit' : G.fire.cur === 'maitrise' ? 'maîtrisé' : 'non maîtrisé'}, ${areaOnFire()} m² en feu sur 900.`; out.victimes = `1 brûlé grave (${G.victims[0].pec ? 'pris en charge' : 'en attente'}) ; 34 évacués ${G.tiers.loc === 'TROTTOIR' ? 'sur le trottoir' : 'au PRV'}${G.hlm.residentsPRV ? ' ; une cinquantaine de locataires du HLM au PRV' : ''}.`; }
  return out;
}
function sendMessage(type, f) {
  const canal = f.canal || CANAUX.OPE;
  if (f.cos && G.cosT == null) G.cosT = G.W.t;
  const lines = [`JE SUIS : ${f.suis}`, `JE VOIS : ${f.vois}`, type === 'ambiance' ? `JE PRÉVOIS : ${f.prevois}` : `VICTIMES : ${f.victimes}`, `JE FAIS : ${f.fais}`, `JE DEMANDE : ${f.demande || '—'}`];
  const to = G.secteur ? 'PC' : 'CODIS';
  if (type === 'ambiance') {
    if (G.ambiance) return;
    G.ambiance = { t: G.W.t, f, ev: evalAmbiance(f), model: modelMessage('ambiance') };
    G.lastCorrection = { type: 'ambiance', t: G.W.t, f, ev: G.ambiance.ev, model: G.ambiance.model };
    radio('CDG', 'CODIS', `MESSAGE D'AMBIANCE${f.cos ? ' — je prends le COS' : ''}. ` + lines.join(' / '), 'msg', canal);
  } else {
    const ev = evalCR(f);
    const want = G.secteur ? 'DIR 602' : CANAUX.CDT;
    const okCh = canal === want || (G.secteur && canal === 'DIR 602');
    ev.out.push({ ok: okCh, text: okCh ? `Compte rendu passé sur le bon canal (${want}).` : `Compte rendu passé sur ${canal} : ${G.secteur ? 'chef de secteur, vous rendez compte au PC sur la DIR 602' : 'le COS rend compte sur le GRP 275 CDT'}.` });
    if (!okCh) { ev.pts = Math.max(0, ev.pts - 10); G.chanErr++; }
    G.crs.push({ t: G.W.t, f, ev });
    G.lastCorrection = { type: 'cr', t: G.W.t, f, ev, model: modelMessage('cr'), n: G.crs.length };
    radio('CDG', to, `COMPTE RENDU N°${G.crs.length}. ` + lines.join(' / '), 'msg', canal);
  }
  requestRenforts(f.renforts || []);
  G.timers.push({ t: G.W.t + 3, fn: () => radio(to === 'PC' ? 'PC' : 'CODIS', 'CDG', 'Reçu.', 'msg', canal) });
  G.dirty = true;
}
function sendUrgent(text, canal) {
  if (G.ended || !text) return;
  G.urgents.push({ t: G.W.t, text, canal });
  radio('CDG', G.secteur ? 'PC' : 'CODIS', 'MESSAGE URGENT. ' + text, 'urgent', canal);
  const req = [];
  if (/smur|medic/i.test(text)) req.push('SMUR');
  if (/sap|vsav/i.test(text)) req.push('GSAP2');
  requestRenforts(req); G.dirty = true;
}
function victimAction(vid, actn) {
  const v = G.victims.find(x => x.id === vid); if (!v) return;
  if (actn === 'smur') { requestRenforts(['SMUR']); v.smurAsked = G.W.t; }
  if (actn === 'evac' && v.pec) { v.evac = { t: G.W.t, dest: 'centre hospitalier', medic: !!(G.requests.SMUR && G.requests.SMUR.onSite) }; if (vState(v).c === 'ua' && !v.evac.medic) penalty(10, `${v.name} évacué(e) sans médicalisation.`); }
  G.dirty = true;
}
function vState(v) {
  if (v.sp) return v.grave ? { s: 'Urgence absolue', c: 'ua' } : { s: 'Urgence relative', c: 'ur' };
  if (v.fed >= 2.5) return { s: 'Décédé', c: 'dead' };
  if (v.fed >= 1) return { s: 'Urgence absolue, état critique', c: 'ua' };
  if (v.fed >= 0.5) return { s: v.burn ? 'Urgence absolue (brûlé grave)' : 'Urgence relative', c: v.burn ? 'ua' : 'ur' };
  if (v.fed >= 0.2) return { s: 'Urgence relative', c: 'ur' };
  return { s: 'Impliqué, indemne', c: 'ok' };
}

// ===========================================================================
// JAUGES, ORDRE INITIAL, SITAC, DEBRIEFING
// ===========================================================================
function gauges() {
  const W = G.W;
  const ua = G.victims[0], pmr = G.victims.find(v => v.id === 'PMR');
  const vict = clamp(100 - (ua.fed - 0.6) * 50 - G.tiers.dose * 30 - (G.tiers.accident ? 15 : 0) - pmr.fed * 30 - (G.gaz.bleve && !G.stationEvac ? 25 : 0), 0, 100);
  const securite = clamp(100 - G.safety.reduce((s, p) => s + p.pts, 0), 0, 100);
  let cmd = 100; const since = W.t - T_ARRIVEE;
  if (G.ambiance) cmd -= (100 - G.ambiance.ev.pts) * 0.4; else if (since > 300) cmd -= Math.min(50, 20 + (since - 300) / 12);
  if (G.oi) cmd -= (100 - G.oi.ev.pts) * 0.25; else if (since > 660) cmd -= Math.min(25, (since - 660) / 24);
  if (G.passation && G.passation.done) cmd -= G.passation.ev ? (100 - G.passation.ev.pts) * 0.2 : 20;
  cmd -= G.pauses * 3 + G.pausedTime / 10;
  const facts = ['bouteilles', 'station_occupee', 'doute_plongeuse', 'tous_sortis', 'origine', 'gaz_reserve', 'structure', 'ua', 'pmr', 'hlm_occupants', 'etendue'];
  const connaissance = Math.round(facts.filter(k => G.K.facts[k]).length / facts.length * 100);
  return { victimes: vict, securite, commandement: clamp(cmd, 0, 100), connaissance, situation: clamp(100 - areaOnFire() / 9, 0, 100) };
}
const OBJECTIFS = [
  ['o_secours', 'Secourir le brûlé grave'],
  ['o_tiers', 'Protéger les tiers : clients, employés, station, voisins'],
  ['o_gaz', 'Éviter la propagation et l\'explosion au stock de gaz et à la station'],
  ['o_hlm', 'Éviter la propagation au HLM'],
  ['o_eteindre', 'Éteindre l\'incendie'],
  ['o_secu', 'Assurer la sécurité des intervenants (engagement minimum)'],
  ['o_alim', 'Pérenniser l\'alimentation en eau'],
  ['o_pollu', 'Limiter la pollution de la Weiss'],
];
const IDEES = [
  ['im_ua', 'Premiers secours au brûlé puis prise en charge par le G SAP', ['SECOURS_UA', 'GSAP_UA'], 'o_secours'],
  ['im_tiers', 'Mettre les tiers au PRV au vent, couper la circulation', ['TIERS_SO', 'TIERS_E', 'BALISAGE_RN', 'GSAP_PRV'], 'o_tiers'],
  ['im_station', 'Évacuer la station et couper les pompes', ['STATION'], 'o_tiers'],
  ['im_gaz', 'Rideau d\'eau sur le stock de bouteilles', ['RIDEAU_GAZ'], 'o_gaz'],
  ['im_hlm', 'Protéger le HLM (rideau, échelle) et le reconnaître', ['RIDEAU_HLM', 'LANCE_EPA_HLM', 'RECO_HLM'], 'o_hlm'],
  ['im_attaque', 'Attaquer depuis l\'extérieur avec des moyens importants (LDV 500, échelle)', ['ATTAQUE_S', 'ATTAQUE_O', 'ATTAQUE_E', 'ATTAQUE_N', 'LANCE_EPA'], 'o_eteindre'],
  ['im_alim', 'Alimenter sur le PI et mettre en aspiration sur la Weisbach', ['ALIM'], 'o_alim'],
  ['im_secu', 'Pas de pénétration, baliser la zone d\'effondrement', ['PERIMETRE'], 'o_secu'],
  ['im_pollu', 'Obturer les avaloirs', ['AVALOIRS'], 'o_pollu'],
];
function startRT() { if (G.phase === 'arrivee') { G.phase = 'rt'; G.rtStart = G.W.t; G.journal.push({ t: G.W.t, text: 'Début du raisonnement tactique.' }); G.dirty = true; } }
function giveOI(oi) {
  if (G.oi || G.ended) return null;
  startRT();
  const ev = evalOI(oi);
  G.oi = Object.assign({ t: G.W.t, ev, model: modelOI() }, oi);
  if (G.phase !== 'conduite') G.phase = 'conduite';
  radio('CDG', 'Chefs d\'agrès', `ORDRE INITIAL. Situation : ${oi.S || '—'}. Objectifs : ${oi.obj.map(k => OBJECTIFS.find(o => o[0] === k)[1].toLowerCase()).join(' ; ') || '—'}.`, 'ordre', CANAUX.TAC);
  for (const e of oi.exe) { const a = act(e.id); if (a && e.mission) order(a, e.mission, Object.assign({}, e.opts || {}, { viaCA: true })); }
  G.lastCorrection = { type: 'oi', t: G.W.t, f: oi, ev, model: G.oi.model };
  G.journal.push({ t: G.W.t, text: 'Ordre initial donné.' }); G.dirty = true;
  return G.lastCorrection;
}
function evalOI(oi) {
  const out = []; let pts = 0;
  const ok = (c, good, bad, p) => { out.push({ ok: !!c, text: c ? good : bad }); if (c) pts += p; };
  const t = G.W.t - T_ARRIVEE, has = k => oi.obj.includes(k), ms = oi.exe.filter(e => e.mission).map(e => e.mission);
  ok(t <= 600, `Ordre initial donné ${fmtDur(t)} après l'arrivée.`, `Ordre initial tardif : ${fmtDur(t)}.`, 8);
  ok((oi.S || '').length > 15, 'Situation exprimée.', 'Situation non exprimée.', 6);
  ok((oi.A || '').length > 10, 'Anticipation exprimée.', 'Anticipation absente.', 6);
  ok(has('o_secours'), 'Secours au brûlé en objectif.', 'Le brûlé grave doit être un objectif.', 8);
  ok(has('o_tiers'), 'Protection des tiers en objectif.', 'Protection des tiers oubliée.', 8);
  ok(has('o_gaz'), 'Stock de gaz en objectif.', 'Le stock de bouteilles de gaz devait être un objectif prioritaire.', 12);
  ok(has('o_secu'), 'Sécurité des intervenants affichée.', 'Sécurité des intervenants (engagement minimum) absente.', 6);
  ok(ms.includes('RIDEAU_GAZ'), 'Rideau d\'eau sur le stock de gaz engagé.', 'Aucun rideau d\'eau sur le stock de bouteilles.', 14);
  ok(ms.includes('TIERS_SO') || ms.includes('TIERS_E') || ms.includes('BALISAGE_RN'), 'Action sur les tiers et la RN engagée.', 'Tiers laissés au bord de la RN.', 8);
  ok(ms.includes('ALIM') || Object.values(G.hyd).some(h => h && h.alim), 'Alimentation engagée.', 'Aucune alimentation : les citernes tiennent 6 minutes par LDV 500.', 8);
  ok(!ms.includes('RECO_INT'), 'Pas de pénétration dans le volume en feu.', 'Reconnaissance intérieure dans 900 m² en feu : engagement non justifié.', 8);
  const orphans = oi.im.filter(k => { const d = IDEES.find(x => x[0] === k); return !d[2].some(m => ms.includes(m)); });
  ok(oi.im.length && !orphans.length, 'Chaque idée de manœuvre a des moyens.', orphans.length ? `Idées sans moyens : ${orphans.map(k => IDEES.find(x => x[0] === k)[1].toLowerCase()).join(' ; ')}.` : 'Aucune idée de manœuvre.', 8);
  return { pts: Math.min(100, pts), out, t };
}
function modelOI() {
  return {
    S: 'Feu d\'un restaurant de plain-pied de 900 m² en cours d\'embrasement, charpente bois et bac acier ; un employé brûlé grave et 34 évacués sur le trottoir de la RN 415 ; stock d\'une quarantaine de bouteilles de gaz à 9 m à l\'ouest, HLM R+3 à 13 m à l\'est ; réseau limité à 1000 L/min.',
    A: 'Embrasement de la totalité, explosion du stock de gaz sous le rayonnement, propagation au HLM si le vent forcit, effondrement des murs, pollution de la Weiss.',
    O: 'Secourir le brûlé ; protéger les tiers ; éviter l\'explosion du stock de gaz et la propagation au HLM ; sécurité des intervenants ; pérenniser l\'alimentation ; éteindre ; limiter la pollution.',
    I: 'Rideau d\'eau sur les bouteilles ; évacuer la station ; tiers au PRV au vent et RN coupée ; protection du HLM ; attaque extérieure en LDV 500 et lance sur échelle ; alimentation sur PI puis aspiration ; pas de pénétration.',
    E: 'FPT 1 : BAT rideau d\'eau sur le stock de gaz, BAL alimentation sur PI puis évacuation de la station. FPT 2 : BAT attaque façade sud ou protection du HLM, BAL tiers au PRV et coupure de la RN. EPA : lance sur échelle. G SAP à son arrivée : brûlé et PRV.',
    C: 'COS chef de groupe au VLCG sur la RN ; DIR 633 avec les CA ; GRP 275 vers le CODIS.',
    L: 'PRV au parking sud-ouest, au vent ; demande G ALIM, G INC, gendarmerie, GRDF.',
  };
}
function sitacAdd(el) { el.t = G.W.t; G.sitacUser.push(el); G.dirty = true; }
function sitacRemoveNear(x, y, r) {
  let best = -1, bd = r || 6;
  G.sitacUser.forEach((e, i) => { const d = e.pts ? Math.min(...e.pts.map(q => Math.hypot(q[0] - x, q[1] - y))) : Math.hypot((e.x2 != null ? (e.x + e.x2) / 2 : e.x) - x, (e.y2 != null ? (e.y + e.y2) / 2 : e.y) - y); if (d < bd) { bd = d; best = i; } });
  if (best >= 0) G.sitacUser.splice(best, 1);
}
function evalSitac() {
  const U = G.sitacUser, out = [];
  if (!U.length) return [{ ok: false, text: 'Aucune SITAC dessinée.' }];
  const ok = (c, g, b) => out.push({ ok: !!c, text: c ? g : b });
  const inRect = (x, y, x1, x2, y1, y2) => x >= x1 && x <= x2 && y >= y1 && y <= y2;
  const end = e => [e.x2 != null ? e.x2 : e.x, e.y2 != null ? e.y2 : e.y];
  ok(U.some(e => e.k === 'feu' && inRect(e.x, e.y, -17, 17, -2, 32)), 'Sinistre placé sur le restaurant.', 'Le sinistre n\'est pas placé sur le restaurant.');
  ok(U.some(e => (e.k === 'danger' || (e.col === 'orange')) && inRect(e.x, e.y, -35, -18, -2, 22)), 'Risque gaz représenté à la station.', 'Le stock de bouteilles de gaz n\'est pas représenté en risque particulier.');
  ok(U.some(e => e.k === 'eau'), 'Établissements représentés.', 'Aucun établissement représenté.');
  ok(U.some(e => e.k === 'victime'), 'Victimes et impliqués représentés.', 'Victimes et impliqués absents.');
  ok(U.some(e => e.k === 'fumee' || (e.k === 'trait' && e.col === 'noir')) || U.some(e => e.k === 'attaque' && inRect(...end(e), -17, 17, -2, 32)), 'Fumées ou actions sur le feu représentées.', 'Ni fumées ni actions sur le feu.');
  ok(U.some(e => e.k === 'moyen'), 'Moyens représentés.', 'Aucun moyen représenté.');
  return out;
}
function debriefData() {
  const g = gauges(), pts = [];
  if (!G.ambiance) pts.push({ ok: false, text: 'Aucun message d\'ambiance transmis.' }); else G.ambiance.ev.out.forEach(o => pts.push(o));
  if (!G.oi) pts.push({ ok: false, text: 'Aucun ordre initial formalisé.' }); else G.oi.ev.out.filter(o => !o.ok).forEach(o => pts.push({ ok: false, text: 'Ordre initial : ' + o.text }));
  if (G.passation) pts.push(G.passation.ev ? { ok: G.passation.ev.pts >= 60, text: `Point de situation au chef de colonne : ${G.passation.ev.pts} %.` } : { ok: false, text: 'Pas de point de situation au chef de colonne.' });
  evalSitac().forEach(o => pts.push({ ok: o.ok, text: 'SITAC : ' + o.text }));
  pts.push({ ok: !G.gaz.bleve, text: G.gaz.bleve ? 'Le stock de bouteilles a explosé.' : `Stock de bouteilles préservé (température maximale atteinte ${Math.round(G.gaz.T)} °C${G.gaz.soupape ? ', soupape ouverte' : ''}).` });
  pts.push({ ok: G.stationEvac, text: G.stationEvac ? 'Station évacuée et pompes coupées.' : 'Station-service ni évacuée ni coupée.' });
  pts.push({ ok: !G.hlm.fire, text: G.hlm.fire ? 'Propagation au HLM.' : 'HLM préservé.' });
  pts.push({ ok: G.hlm.reco || G.W.wind < 30, text: G.hlm.reco ? 'HLM reconnu, personne en fauteuil évacuée.' : 'HLM enfumé non reconnu : la locataire en fauteuil est restée au 2e.' });
  pts.push({ ok: G.tiers.loc === 'PRV_SO', text: G.tiers.loc === 'PRV_SO' ? 'Évacués regroupés au PRV, au vent.' : G.tiers.loc === 'PRV_E' ? 'Évacués regroupés au parking du HLM, sous le vent quand il a forci : intoxications légères.' : 'Évacués laissés sur le trottoir de la RN, au rayonnement et à la circulation.' });
  pts.push({ ok: G.circulation, text: G.circulation ? 'Circulation coupée sur la RN 415.' : 'Circulation jamais coupée sur la RN 415.' });
  pts.push({ ok: G.victims[0].cooled || G.victims[0].pec, text: G.victims[0].cooled ? 'Premiers secours au brûlé avant l\'arrivée du G SAP.' : G.victims[0].pec ? 'Brûlé pris en charge par le G SAP.' : 'Brûlé grave jamais pris en charge.' });
  pts.push({ ok: !!G.requests.GALIM && G.requests.GALIM.t < T_CDC, text: G.requests.GALIM ? `Groupe alimentation demandé à ${hhmm(G.requests.GALIM.t)}.` : 'Groupe alimentation jamais demandé : le PI ne donne que 1000 L/min.' });
  pts.push({ ok: !!G.requests.GINC, text: G.requests.GINC ? 'Groupe incendie de renfort demandé.' : 'Pas de renfort incendie pour 900 m².' });
  pts.push({ ok: !G.murDown || G.perimetre || !G.safety.some(p => /mur nord/.test(p.text)), text: G.perimetre ? 'Zone d\'effondrement balisée avant la chute du mur.' : G.murDown ? 'Zone d\'effondrement non balisée.' : 'Mur nord encore debout en fin d\'exercice.' });
  pts.push({ ok: G.avaloirs, text: G.avaloirs ? 'Avaloirs obturés : pas de pollution de la Weiss.' : 'Eaux d\'extinction parties à la Weiss.' });
  pts.push({ ok: G.hyd.demand >= 2000, text: `Débit en manœuvre en fin d'exercice : ${Math.round(G.hyd.demand)} L/min (il en faut environ 2500 pour 900 m²).` });
  G.safety.forEach(p => pts.push({ ok: false, text: `Sécurité : ${p.text}` }));
  if (G.chanErr) pts.push({ ok: false, text: `${G.chanErr} message(s) sur le mauvais canal.` });
  if (G.pauses) pts.push({ ok: false, text: `${G.pauses} pause(s), ${fmtDur(G.pausedTime)} au total.` });
  return { g, pts };
}
function debriefTruth() {
  return [
    `Feu : ${areaOnFire()} m² en feu sur 900${G.generalise ? `, embrasement généralisé à ${hhmm(G.generalise)}` : ''}${G.murDown ? ', mur nord effondré' : ''}.`,
    `Stock de bouteilles : ${G.gaz.bleve ? 'explosion' : `préservé, ${Math.round(G.gaz.T)} °C`}. HLM : ${G.hlm.fire ? 'feu dans un appartement' : G.hlm.smoke > 0.3 ? 'enfumé' : 'intact'}.`,
    `Eau : ${Math.round(G.hyd.demand)} L/min en manœuvre, ${Math.round(G.hyd.supply)} L/min de ressource, ${Math.round(G.hyd.used / 1000)} m³ utilisés.`,
    ...G.victims.map(v => `${v.name} : ${vState(v).s.toLowerCase()}${v.evac ? ', évacué(e)' : v.pec ? ', pris(e) en charge' : ''}.`),
    `Évacués : ${LOC_NAMES[G.tiers.loc]}${G.tiers.dose > 0.3 ? ', plusieurs intoxications légères' : ''}.`,
  ];
}
function endGame(reason) { if (G.ended) return; G.ended = true; G.endReason = reason; if (window.UI && UI.showDebrief) UI.showDebrief(); }
function startUI() {
  if (window.UI && UI.toast) UI.toast('Vous arrivez avec le groupe incendie. Fumées noires, flammes en toiture côté cuisine, des dizaines de personnes sur le trottoir.', 'cr');
  setTimeout(() => radio('CA FPT 1', 'CDG', 'Point de situation : restaurant en feu côté cuisine, flammes qui percent la toiture. Les clients sont sur le trottoir au bord de la RN, un employé brûlé. Station-service et son stock de gaz juste à l\'ouest. J\'attends vos ordres.', 'alerte', CANAUX.TAC), 1500);
}
function locName(l) { return LOC_NAMES[l] || l; }
function hudWater() {
  const H = G.hyd, d = Math.round(H.demand || 0), s = Math.round(H.supply || 0);
  const minTank = Math.min(...['FPT1', 'FPT2', 'FPT3', 'FPT4'].filter(k => H[k] && G.actors.some(a => a.lanceOn && fptOf(a) === k)).map(k => H[k].tank), 3000);
  return { text: `Eau : ${d} L/min en manœuvre · ressource ${s} L/min${H.galim ? ' (aspiration)' : ''}${d > s ? ` · citernes ${Math.round(minTank)} L` : ''}`, cls: d > s && minTank < 800 ? 'low' : d <= s && d > 0 ? 'ok' : '' };
}
function waterPill(engin) {
  const h = G.hyd['FPT' + engin.replace(/\D/g, '')]; if (!h) return '';
  return h.alim ? `<span class="pill ok">Alimenté sur PI${G.hyd.galim ? ' + aspiration' : ''}</span>` : `<span class="pill ${h.tank < 800 ? 'bad' : 'warn'}">Citerne ${Math.round(h.tank)} L, non alimenté</span>`;
}

// ---------------------------------------------------------------- SITAC (plan du site, renseignements)
const PLAN = { PS: 5, PX0: 380, PY0: 270 };
function drawPlanBase(ctx, H) {
  const { px, py, css, hatch, unitIcon, victimIcon, now, view } = H;
  const PW = H.PW, PH = H.PH, P = PLAN.PS;
  const R = (x1, y1, x2, y2) => [px(x1), py(y2), (x2 - x1) * P, (y2 - y1) * P];
  ctx.clearRect(0, 0, PW, PH); ctx.fillStyle = css('--board'); ctx.fillRect(0, 0, PW, PH);
  ctx.strokeStyle = css('--grid'); ctx.lineWidth = 1;
  for (let x = -80; x <= 80; x += 10) { ctx.beginPath(); ctx.moveTo(px(x), 0); ctx.lineTo(px(x), PH); ctx.stroke(); }
  for (let y = -30; y <= 60; y += 10) { ctx.beginPath(); ctx.moveTo(0, py(y)); ctx.lineTo(PW, py(y)); ctx.stroke(); }
  const txt = (t, x, y, col, f) => { ctx.fillStyle = col || css('--mute'); ctx.font = f || `600 11px ${css('--f-mono')}`; ctx.fillText(t, px(x), py(y)); };
  // riviere, routes, parkings
  ctx.fillStyle = 'rgba(58,142,234,.35)'; ctx.fillRect(...R(-80, 44, 80, 52)); txt('WEISBACH →', -70, 46.5, css('--eau'));
  ctx.fillStyle = css('--street'); ctx.fillRect(...R(-80, -12, 80, -4)); ctx.fillRect(...R(58, -12, 66, 44)); ctx.fillRect(...R(52, 44, 60, 52));
  txt('RN 415 ROUTE DE LAPOUTROIE', -60, -9); ctx.save(); ctx.translate(px(63), py(36)); ctx.rotate(-Math.PI / 2); ctx.fillStyle = css('--mute'); ctx.font = `600 10px ${css('--f-mono')}`; ctx.fillText('RUE DE GEISBOURG', 0, 0); ctx.restore();
  ctx.strokeStyle = css('--line'); ctx.setLineDash([4, 4]); ctx.strokeRect(...R(-48, -28, -18, -16)); ctx.strokeRect(...R(28, 0, 50, 9)); ctx.setLineDash([]);
  txt('Parking SO', -46, -19); txt('Parking HLM', 29, 2);
  // station, HLM
  ctx.strokeStyle = css('--wallplan'); ctx.lineWidth = 2;
  ctx.strokeRect(...R(-48, 4, -34, 14)); ctx.strokeRect(...R(-55, 18, -46, 28)); txt('STATION', -54, 30, css('--ink-soft'));
  ctx.strokeRect(...R(28, 12, 52, 26)); txt('HLM R+3', 34, 19, css('--ink-soft'));
  if (G.K.facts.bouteilles) { ctx.fillStyle = css('--risk'); ctx.fillRect(...R(-26, 8, -23, 12)); txt('GAZ', -30, 13.5, css('--risk')); }
  if (G.K.facts.feu_hlm) { ctx.fillStyle = css('--inc'); ctx.fillRect(...R(28, 14, 32, 18)); }
  // restaurant et volumes connus
  for (const c of G.W.cells) {
    const [x, y] = cellXY(c.i, c.j), k = view === 'user' ? null : G.K.cells[c.j * 3 + c.i];
    const [X, Y, Wd, Ht] = R(x - 5, y - 5, x + 5, y + 5);
    if (!k) { ctx.fillStyle = css('--unknown'); ctx.fillRect(X, Y, Wd, Ht); hatch(ctx, X, Y, Wd, Ht); }
    else { ctx.globalAlpha = clampA(0.9 - (G.W.t - k.t) / 900); ctx.fillStyle = k.on && k.q > 0.05 ? (k.q > 0.5 ? css('--inc') : css('--risk')) : css('--smoke'); ctx.fillRect(X, Y, Wd, Ht); ctx.globalAlpha = 1; ctx.fillStyle = css('--ink'); ctx.font = `500 9px ${css('--f-mono')}`; ctx.fillText(hhmm(k.t), X + 3, Y + 11); }
    ctx.strokeStyle = 'rgba(159,176,194,.35)'; ctx.lineWidth = 1; ctx.strokeRect(X, Y, Wd, Ht);
  }
  ctx.strokeStyle = css('--ink'); ctx.lineWidth = 3; ctx.strokeRect(...R(-15, 0, 15, 30)); txt('PIZZERIA 900 m²', -14, 31.5, css('--ink'));
  if (G.murDown) { ctx.strokeStyle = css('--inc'); ctx.lineWidth = 4; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(px(-15), py(30)); ctx.lineTo(px(15), py(30)); ctx.stroke(); ctx.setLineDash([]); }
  if (G.perimetre) { ctx.strokeStyle = css('--risk'); ctx.lineWidth = 2; ctx.setLineDash([6, 4]); ctx.strokeRect(...R(-21, 30, 21, 40)); ctx.setLineDash([]); }
  // PI, aspiration
  ctx.fillStyle = css('--eau'); ctx.beginPath(); ctx.arc(px(-20), py(-3), 6, 0, 7); ctx.fill(); txt('PI 150', -24, -6.5, css('--eau'));
  ctx.beginPath(); ctx.arc(px(55), py(44), 6, 0, 7); ctx.fill(); txt('ASP', 51, 41, css('--eau'));
  // vent
  ctx.save(); ctx.strokeStyle = css('--ink-soft'); ctx.fillStyle = css('--ink-soft'); ctx.lineWidth = 2; const wx = px(-74), wy = py(56); ctx.beginPath(); ctx.moveTo(wx, wy); ctx.lineTo(wx + 34, wy); ctx.stroke(); ctx.beginPath(); ctx.moveTo(wx + 40, wy); ctx.lineTo(wx + 32, wy - 5); ctx.lineTo(wx + 32, wy + 5); ctx.fill(); ctx.font = `600 11px ${css('--f-mono')}`; ctx.fillText(`${G.W.wind} km/h`, wx + 46, wy + 4); ctx.restore();
  // tiers et victimes
  const tp = G.tiers.moving ? null : POS[G.tiers.loc];
  if (tp) { victimIcon(ctx, px(tp[0]) - 14, py(tp[1]), 'solid'); victimIcon(ctx, px(tp[0]), py(tp[1]), 'solid'); txt('34', tp[0] + 3, tp[1] + 1.5, css('--pers')); }
  if (!G.victims[0].evac) { victimIcon(ctx, px(POS.UA[0]), py(POS.UA[1]) + 2, 'solid'); txt('UA', POS.UA[0] + 2, POS.UA[1] - 1.5, css('--inc')); }
  // engins et binomes
  const placed = {};
  for (const a of G.actors) {
    if (a.loc === 'ABSENT') continue;
    const p = a.kind === 'echelle' ? POS.EPA : a.kind === 'gsap' ? POS.GSAP : POS[a.loc] || POS.ENGIN;
    const k = placed[a.loc] = (placed[a.loc] || 0) + 1;
    unitIcon(ctx, px(p[0]) + (k - 1) * 22, py(p[1]), a, now, true);
  }
}
const clampA = v => clamp(v, 0.35, 0.9);

window.GAME = {
  newGame, tick, order, orderCA, availableMissions, MISSIONS, sendMessage, sendUrgent, sendPassation, gauges, endGame, debriefData, debriefTruth, clock, hhmm, fmtDur,
  know, vState, startRT, giveOI, OBJECTIFS, IDEES, sitacAdd, sitacRemoveNear, evalSitac, ask, observe, availableQuestions, witnessDef, WITNESSES, FIRE_STATES,
  modelMessage, locName, T_ARRIVEE, RENFORTS, radio, CANAUX, CANAL_LABEL, SLOTS, moveVehicle, victimAction, INCIDENTS: {}, vehicleId: a => a.id,
  ROOMS: [], ROOM_NAMES: {}, LEVELS: [], LEVEL_NAMES: {}, isOpen: () => false, snapshotRoom: () => ({}), roomReportText: () => '',
  DT, PLAN, LANCE_KEYS: Object.keys(LANCES), drawPlanBase, hudWater, waterPill, onStart: startUI, POS, cellXY, CELL_NAMES, areaOnFire, fptOf,
  META: {
    title: 'Chef de groupe · Feu de pizzeria', brand: 'Feu de pizzeria · Kaysersberg', sitacTitle: 'SITAC — Pizzeria, RN 415',
    lead: 'Vous êtes chef du groupe incendie de Lapoutroie. Vous arrivez avec votre groupe à 19h37 ; le chef de colonne est prévenu par le CODIS.',
    ticket: `<div class="tk"><b>CODIS — ORDRE DE DÉPART</b><span>Exercice GOC 4001</span></div>
      <div><b>19h32</b> · FEU DE RESTAURANT</div>
      <div>Pizzeria, route de Lapoutroie (RN 415) — KAYSERSBERG</div>
      <div>Le gérant de la station-service voisine signale un important dégagement de fumée. Restaurant complet : 30 couverts.</div>
      <div>Engagés : 1 groupe incendie (CDG Lapoutroie : FPT 1, FPT 2, EPA 30) · 1 groupe SAP (CDG Lapoutroie-Marché, arrivée vers 19h45)</div>
      <div>Météo : dimanche 22 août, 30 °C, temps sec, vent d'ouest 10 km/h devant forcir en soirée. Coucher du soleil 21h30.</div>
      <div>Eau : réseau public 150 mm ; aspiration possible sur la Weisbach à 500 m, rue de Geisbourg.</div>`,
    howto: `<div><b>Lire le feu</b>Cliquez les façades, la toiture, le stock de gaz, le HLM ou les évacués : 6 s par observation.</div>
      <div><b>Commander</b>Cliquez un FPT : ordre au chef d'agrès pour ses deux binômes. Lances en façade, rideaux d'eau, alimentation, tiers, station.</div>
      <div><b>L'eau</b>Le poteau ne donne que 1000 L/min au total. Pour 900 m², il faut l'aspiration d'un groupe alimentation.</div>
      <div><b>Questionner</b>Gérant de la station, patron, locataire du HLM : chaque question prend 12 s.</div>
      <div><b>Passer la main</b>Le chef de colonne arrive vers 19h48 : point de situation, puis vous devenez chef du secteur incendie.</div>`,
    views: { rue: 'Face RN 415', arriere: 'Côté Weisbach', aerien: 'Vue aérienne', coupe: 'Vue de dessus' },
    oiC: 'COS : chef de groupe au VLCG sur la RN 415 ; DIR 633 avec les chefs d\'agrès ; GRP 275 vers le CODIS.',
    moyens: ['FPT 1', 'FPT 2', 'EPA 30', 'BAT', 'BAL', 'VLCG', 'G SAP', 'VSAV', 'G INC', 'G ALIM', 'PC'],
  },
};
})();
