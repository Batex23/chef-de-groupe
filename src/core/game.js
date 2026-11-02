// ===========================================================================
// LOGIQUE DE JEU - Chef de groupe, feu d'appartement R+3 (SDIS 33)
// ===========================================================================
(function () {
'use strict';
const { CFG, createWorld, step, layerRel, ifcAbs, conditionsAt, fedRate, roomOnFire, hasFire, hasResidual, clamp } = SIM;

const T_ECLOSION_CLOCK = 19 * 3600 + 31 * 60; // 19h31
const T_ARRIVEE = 660;                          // arrivee du CDG (s depuis l'eclosion)
const T_FIN_MAX = T_ARRIVEE + 75 * 60;
const ROOMS = ['COU', 'SEJ', 'CUI', 'CH1', 'CH2', 'SDB', 'CH3'];
const ROOM_NAMES = { SEJ: 'Séjour', CUI: 'Cuisine', CH1: 'Chambre 1', COU: 'Couloir', CH2: 'Chambre 2', SDB: 'Salle de bains', CH3: 'Chambre 3' };
const LEVELS = ['RDC', 'R1', 'R2', 'R3', 'R4'];
const LEVEL_NAMES = { RDC: 'RDC', R1: 'R+1', R2: 'R+2', R3: 'R+3', R4: 'R+4' };

// --- graphe des deplacements (secondes de base)
const EDGES = [
  ['RUE', 'CAGE_RDC', 20], ['CAGE_RDC', 'CAGE_R1', 12], ['CAGE_R1', 'CAGE_R2', 12], ['CAGE_R2', 'CAGE_R3', 12],
  ['CAGE_R3', 'CAGE_R4', 12], ['CAGE_R4', 'TOIT', 25], ['CAGE_R4', 'R4_APT', 10],
  ['CAGE_R3', 'COU', 8], ['COU', 'SEJ', 6], ['COU', 'CUI', 6], ['COU', 'CH1', 8], ['COU', 'CH2', 6], ['COU', 'SDB', 6], ['COU', 'CH3', 8],
];
const ADJ = {};
for (const [a, b, d] of EDGES) { (ADJ[a] = ADJ[a] || []).push([b, d]); (ADJ[b] = ADJ[b] || []).push([a, d]); }
function path(from, to) {
  if (from === to) return [from];
  const prev = { [from]: null }, q = [from];
  while (q.length) { const n = q.shift(); for (const [m] of ADJ[n] || []) if (!(m in prev)) { prev[m] = n; q.push(m); } }
  if (!(to in prev)) return null;
  const p = []; for (let n = to; n; n = prev[n]) p.unshift(n); return p;
}
function edgeTime(a, b) { return (ADJ[a].find(e => e[0] === b) || [0, 10])[1]; }
// lieu -> zone simulee et hauteur d'exposition (accroupi : 1,0 m)
function zoneOf(loc) {
  if (ROOMS.includes(loc)) return { zone: loc, h: 1.0 };
  if (loc && loc.startsWith('CAGE_')) { const i = LEVELS.indexOf(loc.slice(5)); return { zone: 'CAGE', h: i * 2.6 + 1.2 }; }
  return null;
}
const DOOR_ON_EDGE = { 'CAGE_R3|COU': 'PALIERE', 'COU|CH1': 'CH1_COU', 'COU|CH3': 'CH3_COU' };
function doorBetween(a, b) { return DOOR_ON_EDGE[a + '|' + b] || DOOR_ON_EDGE[b + '|' + a] || null; }

// ===========================================================================
const G = window.G = {};
function newGame() {
  Object.assign(G, {
    W: createWorld(), started: false, paused: false, speed: 1, pauses: 0, pausedTime: 0, ended: false,
    radio: [], msgNo: 0, journal: [],
    ambiance: null, crs: [], requests: {}, safety: [], bonus: [], tank: 3000, alim: false,
    K: { layout: false, facts: {}, rooms: {}, cage: {} },
    asked: {}, actors: [], victims: [], timers: [], dirty: true, lastUI: 0, codisRelance: false,
    busy: null, observations: [], fire: { cur: 'developpement', cand: null, candT: 0, hist: [], lastEvt: 0, log: [] },
    phase: 'arrivee', oi: null, sitacUser: [],
    r4: { exp: 0, t0: null, k: 1, q: 0, out: false, residual: 0, deblaye: false, warned: false }, controle: null, reprises: 0,
    witnesses: WITNESSES.map(w => ({ id: w.id, present: false, appearT: w.appear, arrivedT: null })),
  });
  for (const w of G.witnesses) G.timers.push({ t: w.appearT, fn: () => { w.present = true; w.arrivedT = G.W.t; G.dirty = true;
    const d = WITNESSES.find(x => x.id === w.id); radio(d.short, 'CDG', d.hello, 'temoin'); G.journal.push({ t: G.W.t, text: d.short + ' se présente au CDG.' }); } });
  const W = G.W;
  // pre-scenario (avant l'arrivee du CDG)
  G.timers.push({ t: 90, fn: () => setOpen('PALIERE', true) });           // l'occupante fuit sans fermer
  G.timers.push({ t: 610, fn: () => setOpen('IMMEUBLE', true) });         // CA FPT ouvre la porte d'immeuble
  G.timers.push({ t: T_ARRIVEE + 30, fn: () => arrive('PA') });
  G.timers.push({ t: T_ARRIVEE + 60, fn: () => arrive('VSAV') });
  G.timers.push({ t: T_ARRIVEE + 300, fn: neighbourPanics });
  G.timers.push({ t: T_ARRIVEE + 240, fn: () => { if (!G.ambiance) { G.codisRelance = true; radio('CODIS', 'CDG', "CODIS pour chef de groupe, j'attends votre message d'ambiance."); } } });
  G.actors.push(binome('BAT1', 'BAT', 'FPT 1'), binome('BAL1', 'BAL', 'FPT 1'));
  G.actors.push({ id: 'PA', kind: 'echelle', label: 'PA 18', engin: 'PA 18', loc: 'ABSENT', plan: [], status: 'En route' });
  G.actors.push({ id: 'VSAV', kind: 'vsav', label: 'VSAV 1', engin: 'VSAV 1', loc: 'ABSENT', plan: [], status: 'En route', pec: false });
  G.victims.push({ id: 'V1', name: 'Mme Lacoste, 82 ans', loc: 'CH1', h: 0.5, fed: 0, found: false, atRue: false, pec: false, carried: null });
  G.victims.push({ id: 'V2', name: 'M. Ferrand, voisin du R+4', loc: 'R4_APT', h: 1.5, fed: 0, found: false, atRue: false, pec: false, mode: 'fenetre', carried: null });
  // simulation jusqu'a l'arrivee
  while (W.t < T_ARRIVEE) { runTimers(); step(W); updateVictims(CFG.dt); }
  W.events.length = 0;
}
function binome(id, role, engin) {
  return { id, kind: 'binome', role, label: (role === 'BAT' ? "Binôme d'attaque" : "Binôme d'alimentation"), engin, loc: 'RUE', plan: [], status: 'Disponible au pied de l\'engin',
    air: 1500, lance: null, flowing: false, established: false, hazard: 0, hurt: false, visited: {}, mission: null };
}
function setOpen(id, v) { const o = G.W.O.find(x => x.id === id); if (o) o.open = v; }
function isOpen(id) { const o = G.W.O.find(x => x.id === id); return o && o.open; }
function clock(t) {
  const s = Math.floor(T_ECLOSION_CLOCK + t), h = Math.floor(s / 3600) % 24, m = Math.floor(s / 60) % 60, ss = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}
function hhmm(t) { return clock(t).slice(0, 5).replace(':', 'h'); }
function radio(from, to, text, kind) {
  G.msgNo++;
  G.radio.push({ n: G.msgNo, t: G.W.t, from, to, text, kind: kind || '' });
  G.dirtyRadio = true;
  UI.toast && UI.toast(`${from} → ${to} : ${text}`, kind);
}
function know(key, label) {
  if (G.K.facts[key]) return;
  G.K.facts[key] = { t: G.W.t, label };
  G.dirty = true;
}
function penalty(pts, text) { G.safety.push({ t: G.W.t, pts, text }); }

// ===========================================================================
// ARRIVEES / RENFORTS
// ===========================================================================
function arrive(id) {
  const a = G.actors.find(x => x.id === id);
  if (a) { a.loc = 'RUE'; a.status = 'Sur les lieux, en attente d\'ordres'; radio(a.engin, 'CDG', `${a.engin} sur les lieux.`); G.dirty = true; }
}
const RENFORTS = {
  FPT2: { label: 'FPT supplémentaire', delay: 12 * 60 },
  SMUR: { label: 'SMUR', delay: 15 * 60 },
  CDC: { label: 'Chef de colonne', delay: 20 * 60 },
  POLICE: { label: 'Police', delay: 6 * 60 },
  ENEDIS: { label: 'ENEDIS', delay: 25 * 60 },
  VSAV2: { label: 'VSAV supplémentaire', delay: 14 * 60 },
};
function requestRenforts(keys) {
  for (const k of keys) {
    if (G.requests[k]) continue;
    G.requests[k] = { t: G.W.t, arrive: G.W.t + RENFORTS[k].delay };
    G.timers.push({ t: G.W.t + RENFORTS[k].delay, fn: () => renfortArrive(k) });
  }
  if (keys.length) radio('CODIS', 'CDG', `Reçu. Engagement : ${keys.map(k => RENFORTS[k].label).join(', ')}.`);
}
function renfortArrive(k) {
  G.requests[k].onSite = true;
  if (k === 'FPT2') {
    G.actors.push(binome('BAT2', 'BAT', 'FPT 2'), binome('BAL2', 'BAL', 'FPT 2'));
    radio('FPT 2', 'CDG', 'FPT 2 sur les lieux, 2 binômes disponibles.');
  } else if (k === 'VSAV2') {
    G.actors.push({ id: 'VSAV2', kind: 'vsav', label: 'VSAV 2', engin: 'VSAV 2', loc: 'RUE', plan: [], status: 'Sur les lieux', pec: false });
    radio('VSAV 2', 'CDG', 'VSAV 2 sur les lieux.');
  } else radio(RENFORTS[k].label, 'CDG', `${RENFORTS[k].label} sur les lieux.`);
  G.dirty = true;
}

// ===========================================================================
// VICTIMES
// ===========================================================================
function victimCond(v) {
  const zo = zoneOf(v.loc);
  if (!zo) {
    if (v.loc === 'R4_APT' && v.mode !== 'confine') {
      // appartement du R+4 : infiltration de fumees depuis la cage par la porte paliere
      const c = conditionsAt(G.W, 'CAGE', 4 * 2.6 + 1.5);
      return { T: CFG.Tamb, O2: 20.9, CO: c.CO * 0.02, vis: 30 };
    }
    return null;
  }
  if (v.carried) return conditionsAt(G.W, zo.zone, zo.zone === 'CAGE' ? zo.h - 0.8 : 0.4);
  return conditionsAt(G.W, zo.zone, v.h != null && ROOMS.includes(v.loc) ? v.h : zo.h + 0.3);
}
function updateVictims(dt) {
  for (const v of G.victims) {
    if (v.carried) { const c = G.actors.find(x => x.id === v.carried); if (c) v.loc = c.loc; }
    if (v.atRue || v.fed >= 3) continue;
    const c = victimCond(v);
    if (c) v.fed += fedRate(c) * dt;
    if (v.id === 'V2' && v.mode === 'descente' && v.fed >= 0.5) {
      v.mode = 'inconscient';
      G.journal.push({ t: G.W.t, text: 'Le voisin du R+4 s\'est effondré dans la cage d\'escalier (non vu).' });
    }
  }
}
function vState(v) {
  if (v.fed >= 2.5) return { s: 'Décédé', c: 'dead' };
  if (v.fed >= 1) return { s: 'Inconscient (UA)', c: 'ua' };
  if (v.fed >= 0.3) return { s: 'Conscience altérée', c: 'ur' };
  return { s: 'Conscient', c: 'ok' };
}
function neighbourPanics() {
  const v = G.victims.find(x => x.id === 'V2');
  if (v.mode !== 'fenetre') return;
  const helpComing = G.actors.some(a => a.mission === 'PA_R4' || a.mission === 'R4');
  if (helpComing) { G.journal.push({ t: G.W.t, text: 'Le voisin du R+4 voit les secours arriver vers lui et reste à sa fenêtre.' }); return; }
  v.mode = 'descente'; v.loc = 'CAGE_R4'; v.descT = 0;
  G.journal.push({ t: G.W.t, text: 'Sans consigne, le voisin du R+4 quitte sa fenêtre et tente de descendre par la cage enfumée.' });
  G.dirty = true;
}
function updateNeighbour(dt) {
  const v = G.victims.find(x => x.id === 'V2');
  if (v.mode !== 'descente') return;
  v.descT += dt;
  if (v.descT >= 15) {
    v.descT = 0;
    const i = LEVELS.indexOf(v.loc.slice(5));
    if (i <= 0) { v.loc = 'RUE'; v.atRue = true; v.mode = 'sorti'; radio('CA FPT 1', 'CDG', 'Le voisin du 4e vient de sortir seul par la cage, il tousse beaucoup.'); G.dirty = true; }
    else v.loc = 'CAGE_' + LEVELS[i - 1];
  }
}

// ===========================================================================
// ORDRES
// ===========================================================================
const MISSIONS = {
  ATTAQUE: { label: 'Attaque du feu au R+3', who: ['binome'] },
  RECHERCHE: { label: 'Reconnaissance et recherche de victimes au R+3 (LDV en protection)', who: ['binome'] },
  PALIERE: { label: 'Fermer la porte palière du R+3', who: ['binome'] },
  R4: { label: 'Reconnaissance du R+4 et mise en sécurité des occupants', who: ['binome'] },
  EXUTOIRE: { label: "Ouvrir l'exutoire en tête de cage", who: ['binome'] },
  ALIM: { label: 'Alimenter le FPT sur le PI (80 m)', who: ['binome'] },
  ATTAQUE_R4: { label: 'Attaque du feu au R+4 (LDV par la cage)', who: ['binome'] },
  DEBLAI: { label: 'Déblai et dégarnissage des pièces sinistrées (noyage des foyers résiduels)', who: ['binome'] },
  CONTROLE: { label: 'Contrôle à la caméra thermique (points chauds)', who: ['binome'] },
  VPP: { label: 'Ventilation opérationnelle : VPP à la porte d\'immeuble', who: ['binome'] },
  REPLI: { label: 'Repli au pied de l\'immeuble', who: ['binome'] },
  PA_R4: { label: 'Mise en station, sauvetage du voisin du R+4 par la façade', who: ['echelle'] },
  PA_CH1: { label: 'Mise en station, sauvetage par la fenêtre de la chambre 1 (R+3)', who: ['echelle'] },
  PA_RECO: { label: 'Reconnaissance de la façade', who: ['echelle'] },
  PA_PROTEC: { label: 'Lance sur échelle en protection de la façade (R+4)', who: ['echelle'] },
  PEC: { label: 'Prise en charge des victimes au pied de l\'immeuble', who: ['vsav'] },
};
function availableMissions(a) {
  const list = [];
  for (const [k, m] of Object.entries(MISSIONS)) {
    if (!m.who.includes(a.kind)) continue;
    if (k === 'ALIM' && (a.role !== 'BAL' || G.alim)) continue;
    if (k === 'PALIERE' && !isOpen('PALIERE')) continue;
    if (k === 'EXUTOIRE' && isOpen('EXUTOIRE')) continue;
    if (k === 'PA_CH1' && !(G.K.facts.victime_lieu)) continue;
    if (k === 'PEC' && a.pec) continue;
    if (k === 'ATTAQUE_R4' && !(G.r4.t0 != null && !G.r4.out)) continue;
    if (k === 'DEBLAI' && !(G.W.smoulder.length || G.W.fires.some(f => f.out) || G.r4.out)) continue;
    if (k === 'CONTROLE' && !G.W.fires.some(f => f.out)) continue;
    if (k === 'VPP' && (G.W.vpp || G.vppPlanned)) continue;
    list.push(k);
  }
  return list;
}
function order(a, key, opts) {
  opts = opts || {};
  if (a.loc === 'ABSENT') return;
  if (a.carry) { radio(`CA ${a.engin}`, 'CDG', `${a.label} en cours d'extraction d'une victime, ordre impossible.`); return; }
  const m = MISSIONS[key];
  const caName = a.kind === 'binome' ? `CA ${a.engin}` : `CA ${a.engin}`;
  let txt = m.label;
  if (key === 'ATTAQUE') txt += ` (${opts.lance || 'LDV 500'})`;
  if (key === 'RECHERCHE' && opts.priority) txt += `, en priorité ${opts.priority === 'CH1' ? 'la chambre au fond à droite' : ROOM_NAMES[opts.priority]}`;
  radio('CDG', caName, `${a.kind === 'binome' ? a.label + ' : ' : ''}${txt}.`, 'ordre');
  a.mission = key; a.missionOpts = opts; a.plan = []; a.flowing = false; a.searching = null;
  if (a.kind === 'binome') planBinome(a, key, opts);
  else if (a.kind === 'echelle') planPA(a, key);
  else if (a.kind === 'vsav') { a.pec = true; a.status = 'Prise en charge des victimes au pied de l\'immeuble'; }
  G.dirty = true;
  setTimeout(() => radio(caName, 'CDG', 'Reçu.'), 400);
}
function planBinome(a, key, o) {
  const P = a.plan;
  const toR3 = () => { P.push({ type: 'move', to: 'CAGE_R3', hose: true }); };
  a.effort = 1;
  if (['ATTAQUE', 'RECHERCHE', 'PALIERE', 'R4', 'EXUTOIRE', 'DEBLAI', 'CONTROLE', 'ATTAQUE_R4'].includes(key) && !a.ari && a.loc === 'RUE')
    P.push({ type: 'act', d: 45, label: 'Capelage ARI, contrôle de pression et engagement', fn: () => { a.ari = true; } });
  if (key === 'ATTAQUE') {
    a.lance = o.lance || 'LDV 500';
    a.status = `Établissement ${a.lance} par la cage`;
    toR3(); P.push({ type: 'move', to: 'COU' }); P.push({ type: 'attack' });
  } else if (key === 'RECHERCHE') {
    a.lance = 'LDV 500';
    toR3();
    const order = o.priority ? [o.priority, ...['COU', 'CH2', 'SDB', 'CH3', 'CH1', 'CUI', 'SEJ'].filter(r => r !== o.priority)] : ['COU', 'CH2', 'SDB', 'CH3', 'CH1', 'CUI', 'SEJ'];
    for (const r of order) P.push({ type: 'search', room: r });
  } else if (key === 'PALIERE') {
    P.push({ type: 'move', to: 'CAGE_R3' }); P.push({ type: 'act', d: 5, label: 'Fermeture de la porte palière', fn: () => { setOpen('PALIERE', false); report(a, 'Porte palière du R+3 fermée.'); } });
  } else if (key === 'R4') {
    P.push({ type: 'move', to: 'CAGE_R4' }); P.push({ type: 'move', to: 'R4_APT' });
    P.push({ type: 'act', d: 25, label: 'Contact avec les occupants du R+4', fn: () => contactR4(a) });
  } else if (key === 'EXUTOIRE') {
    P.push({ type: 'move', to: 'TOIT' }); P.push({ type: 'act', d: 15, label: "Ouverture de l'exutoire", fn: () => { setOpen('EXUTOIRE', true); report(a, `Exutoire ouvert en tête de cage.${isOpen('IMMEUBLE') ? '' : " La porte d'immeuble est fermée : peu d'amenée d'air."}`); } });
  } else if (key === 'ALIM') {
    P.push({ type: 'act', d: 210, label: 'Établissement sur le PI', fn: () => { G.alim = true; report(a, 'FPT alimenté sur le PI.'); } });
  } else if (key === 'DEBLAI') {
    a.lance = a.lance || 'LDV 250';
    toR3(); P.push({ type: 'deblai' });
  } else if (key === 'CONTROLE') {
    P.push({ type: 'move', to: 'CAGE_R3' }); P.push({ type: 'controle' });
  } else if (key === 'ATTAQUE_R4') {
    a.lance = o.lance || 'LDV 500';
    a.status = `Établissement ${a.lance} au R+4`;
    P.push({ type: 'move', to: 'CAGE_R4', hose: true }); P.push({ type: 'move', to: 'R4_APT' }); P.push({ type: 'attackR4' });
  } else if (key === 'VPP') {
    G.vppPlanned = true;
    P.push({ type: 'move', to: 'RUE' });
    P.push({ type: 'act', d: 150, label: 'Mise en place du VPP devant la porte d\'immeuble', fn: () => startVPP(a) });
  } else if (key === 'REPLI') {
    P.push({ type: 'move', to: 'RUE' }); P.push({ type: 'act', d: 1, label: '', fn: () => report(a, 'Binôme au pied de l\'immeuble.') });
  }
  P.push({ type: 'done' });
}
function planPA(a, key) {
  const P = a.plan;
  P.push({ type: 'act', d: 150, label: 'Mise en station de l\'échelle', fn: () => { a.stationed = key; } });
  if (key === 'PA_R4') P.push({ type: 'act', d: 120, label: 'Sauvetage au R+4', fn: () => {
    const v = G.victims.find(x => x.id === 'V2');
    if (v.mode === 'fenetre' || v.mode === 'confine') { v.loc = 'RUE'; v.atRue = true; v.mode = 'sauve'; v.found = true; report(a, 'Voisin du R+4 descendu par l\'échelle, au pied de l\'immeuble.'); }
    else report(a, 'Plus personne à la fenêtre du R+4.');
  } });
  if (key === 'PA_CH1') P.push({ type: 'act', d: 180, label: 'Ouverture fenêtre chambre 1 et sauvetage', fn: () => {
    const o = G.W.O.find(x => x.id === 'W_CH1'); o.open = true; o.broken = true;
    const v = G.victims.find(x => x.id === 'V1');
    if (!v.atRue && !v.carried && v.loc === 'CH1') { v.loc = 'RUE'; v.atRue = true; v.found = true; report(a, `Victime retrouvée dans la chambre 1 et descendue par l'échelle. ${vState(v).s}.`); }
    else report(a, 'Fenêtre de la chambre 1 ouverte, pas de victime.');
    G.K.rooms.CH1 = snapshotRoom('CH1');
  } });
  if (key === 'PA_PROTEC') P.push({ type: 'act', d: 90, label: 'Établissement de la lance sur l\'échelle', fn: () => { a.protec = true; report(a, 'Lance en manœuvre sur l\'échelle, protection de la façade au droit du R+4.'); } });
  if (key === 'PA_RECO') P.push({ type: 'act', d: 60, label: 'Reconnaissance façade', fn: () => {
    know('feu_sejour', 'Feu localisé au séjour (côté rue)'); know('voisin_r4', 'Voisin du R+4 à sa fenêtre');
    const b = G.W.O.filter(o => o.glass && o.broken).length;
    report(a, `Façade : ${b} fenêtre(s) du R+3 cassée(s), fumées noires sous pression. Fenêtre de la chambre côté rue intacte. ${G.victims[1].mode === 'fenetre' ? 'Un homme appelle à la fenêtre du R+4.' : ''}`);
  } });
  P.push({ type: 'done' });
  a.status = 'Mise en station';
}
function contactR4(a) {
  const v = G.victims.find(x => x.id === 'V2');
  if (v.mode === 'fenetre') { v.mode = 'confine'; report(a, 'R+4 : occupant confiné dans son logement, porte fermée, linge mouillé sous la porte. Appartement peu enfumé.'); know('voisin_r4', 'Voisin du R+4'); }
  else if (v.mode === 'confine') report(a, 'R+4 : occupant déjà confiné.');
  else report(a, 'R+4 : personne dans le logement, porte ouverte.');
}
function report(a, text) {
  radio(a.kind === 'binome' ? `CA ${a.engin}` : a.engin, 'CDG', (a.kind === 'binome' ? `${a.label} : ` : '') + text, 'cr');
}

// ---- etat d'une piece (pour les comptes rendus)
function snapshotRoom(r) {
  const z = G.W.Z[r], c = conditionsAt(G.W, r, 1.0), zr = layerRel(z);
  let smoke;
  if (zr < 0.4) smoke = 'fumées jusqu\'au sol, visibilité nulle';
  else if (zr < 1.2) smoke = `fumées denses à hauteur d'homme`;
  else if (zr < 2.3) smoke = `plafond de fumée à ${zr.toFixed(1).replace('.', ',')} m`;
  else smoke = 'pas de fumée';
  const T = z.Tu - 273;
  let heat = T > 400 ? 'chaleur extrême' : T > 200 ? 'forte chaleur' : T > 80 ? 'chaleur sensible' : 'pas de chaleur notable';
  const onFire = roomOnFire(G.W, r);
  const resid = hasResidual(G.W, r);
  const rep = G.W.fires.some(f => f.zone === r && !f.out && f.kind === 'reprise');
  const fire = onFire ? (rep ? 'reprise de feu sous les débris' : z.flashed ? 'embrasement généralisé' : 'feu en cours') : resid ? 'flammes abattues, foyers résiduels sous les débris' : (G.W.fires.some(f => f.zone === r) ? 'feu éteint, déblayé' : '');
  const v = G.victims.find(v => v.loc === r && !v.atRue && !v.carried);
  return { t: G.W.t, smoke, heat, fire, onFire, T, zr, sev: onFire ? 3 : T > 200 ? 2 : zr < 1.2 ? 1.5 : zr < 2.3 ? 1 : 0, victim: v ? v.id : null };
}
function roomReportText(r, s) {
  return `${ROOM_NAMES[r]} : ${[s.fire, s.smoke, s.heat].filter(Boolean).join(', ')}.`;
}

// ===========================================================================
// EXECUTION DES PLANS
// ===========================================================================
function smokeFactor(loc) {
  const zo = zoneOf(loc); if (!zo) return 1;
  const c = conditionsAt(G.W, zo.zone, zo.h);
  return c.vis < 2 ? 1.6 : c.vis < 6 ? 1.25 : 1;
}
function waterOK() { return G.alim || G.tank > 0; }
function tickActor(a, dt) {
  if (a.loc === 'ABSENT') return;
  const zo = zoneOf(a.loc);
  // air (ARI) et exposition
  if (a.kind === 'binome') {
    if (zo || a.loc === 'TOIT' || a.loc === 'R4_APT') a.air -= dt * (a.carry ? 1.6 : (a.effort || 1));
    if (a.loc === 'R4_APT') exposureR4(a, dt);
    if (zo) exposure(a, dt, zo);
    if (a.air <= 300 && !a.lowAir && a.loc !== 'RUE') {
      a.lowAir = true; report(a, 'Sifflet de fin de bouteille, je me replie.');
      a.plan = [{ type: 'move', to: 'RUE' }, { type: 'act', d: 300, label: 'Changement de bouteille et réhydratation', fn: () => { a.air = 1500; a.lowAir = false; report(a, 'Binôme reconditionné, disponible.'); } }, { type: 'done' }];
      if (a.mission === 'ATTAQUE' || a.mission === 'DEBLAI' || a.mission === 'ATTAQUE_R4') G.journal.push({ t: G.W.t, text: `${a.label} (${a.engin}) en fin de bouteille : sa mission « ${MISSIONS[a.mission].label.toLowerCase()} » est interrompue, relève à organiser.` });
      a.mission = null; a.established = false;
      a.flowing = false; G.dirty = true;
    }
  }
  const s = a.plan[0];
  if (!s) { a.flowing = false; return; }
  if (s.type === 'move') return doMove(a, s, dt);
  if (s.type === 'act') {
    if (s.t == null) s.t = 0;
    a.status = s.label;
    s.t += dt;
    if (s.t >= s.d) { a.plan.shift(); s.fn && s.fn(); G.dirty = true; }
    return;
  }
  if (s.type === 'search') return doSearch(a, s, dt);
  if (s.type === 'attack') return doAttack(a, s, dt);
  if (s.type === 'deblai') return doDeblai(a, s, dt);
  if (s.type === 'controle') return doControle(a, s, dt);
  if (s.type === 'attackR4') return doAttackR4(a, s, dt);
  if (s.type === 'carry') return doCarry(a, s);
  if (s.type === 'drop') return doDrop(a, s);
  if (s.type === 'done') {
    a.plan.shift(); a.mission = null; a.flowing = false; a.effort = 1;
    a.status = a.loc === 'RUE' ? 'Disponible au pied de l\'engin' : `Disponible (${locName(a.loc)})`;
    if (a.kind !== 'binome') a.status = 'Mission terminée, disponible';
    G.dirty = true;
  }
}
function locName(l) {
  if (ROOMS.includes(l)) return ROOM_NAMES[l] + ' R+3';
  if (l.startsWith('CAGE_')) return 'cage ' + LEVEL_NAMES[l.slice(5)];
  return { RUE: 'rue', TOIT: 'toiture', R4_APT: 'logement R+4' }[l] || l;
}
function doMove(a, s, dt) {
  if (!s.path) { s.path = path(a.loc, s.to); s.i = 0; s.p = 0; if (!s.path) { a.plan.shift(); return; } }
  if (s.i >= s.path.length - 1) { a.plan.shift(); a.next = null; return; }
  const from = s.path[s.i], to = s.path[s.i + 1];
  let d = edgeTime(from, to) * smokeFactor(to);
  if (s.hose && !a.established && to.startsWith('CAGE_')) d += 40;      // etablissement dans l'escalier (tuyaux, ARI)
  if (a.carry) d *= 1.7;
  a.next = to; a.prog = s.p / d;
  a.status = `${a.carry ? 'Extraction de la victime' : 'Progression'} vers ${locName(s.to)}`;
  if (s.p === 0) {
    const door = doorBetween(from, to);
    if (door && !isOpen(door)) openDoorBy(a, door);
    if (from === 'RUE' && to === 'CAGE_RDC' && !isOpen('IMMEUBLE')) setOpen('IMMEUBLE', true);
  }
  const zh = zoneOf(a.loc);
  if (a.lance && (a.mission === 'ATTAQUE' || a.mission === 'RECHERCHE') && zh && zh.zone !== 'CAGE')
    a.flowing = waterOK() && G.W.Z[zh.zone].Tu > 473;
  s.p += dt;
  if (s.p >= d) {
    s.p = 0; s.i++; a.loc = to; G.dirty = true;
    if (s.hose && (to === 'CAGE_R3' || to === 'CAGE_R4')) a.established = true;
    onArrive(a, to);
  }
}
function openDoorBy(a, door) {
  const o = G.W.O.find(x => x.id === door);
  const inside = G.W.Z[o.a];
  if (inside.Tu > 700 && inside.MFuel > 0.3 && !(a.lance && waterOK())) {
    penalty(15, `${a.label} (${a.engin}) a ouvert une porte sur un volume sous-ventilé sans lance en eau.`);
    report(a, 'Phénomène thermique à l\'ouverture de la porte ! Binôme projeté, pas de blessé grave.');
  }
  o.open = true;
  if (door !== 'PALIERE') G.timers.push({ t: G.W.t + 8, fn: () => { if (!a.carry) o.open = false; } }); // on referme derriere soi
}
function onArrive(a, loc) {
  // compte rendu de reconnaissance en passant
  if (ROOMS.includes(loc) && a.kind === 'binome') {
    const snap = snapshotRoom(loc);
    const prev = G.K.rooms[loc];
    G.K.rooms[loc] = snap;
    if (!prev || G.W.t - prev.t > 90) { if (a.plan[0] && a.plan[0].type !== 'search') report(a, roomReportText(loc, snap)); }
    if (loc === 'SEJ' && snap.onFire) know('feu_sejour', 'Feu localisé au séjour');
    know('layout', 'Disposition de l\'appartement');
  }
  if (loc.startsWith('CAGE_')) {
    const lv = loc.slice(5), c = conditionsAt(G.W, 'CAGE', LEVELS.indexOf(lv) * 2.6 + 1.5);
    G.K.cage[lv] = { t: G.W.t, vis: c.vis, T: c.T - 273 };
    if (c.vis < 5) know('cage_enfumee', 'Cage d\'escalier enfumée');
    // voisin effondre dans la cage
    const v = G.victims.find(x => x.id === 'V2' && x.loc === loc && x.mode === 'inconscient');
    if (v && !a.carry) {
      v.found = true; report(a, `Victime découverte inanimée dans la cage au ${LEVEL_NAMES[lv]} ! J'extrais.`);
      a.plan.unshift({ type: 'carry', v });
    }
  }
  if (loc === 'COU' && isOpen('PALIERE')) know('porte_ouverte', 'Porte palière restée ouverte');
}
function doSearch(a, s, dt) {
  if (a.loc !== s.room) { a.plan.unshift({ type: 'move', to: s.room }); return; }
  if (s.t == null) { s.t = 0; s.d = 40 * smokeFactor(s.room); }
  a.status = `Recherche : ${ROOM_NAMES[s.room]}`;
  // lance en protection : on refroidit si la chaleur l'impose
  const z = G.W.Z[s.room];
  a.flowing = z.Tu > 473 && waterOK() && !!a.lance;
  s.t += dt;
  if (s.t >= s.d) {
    a.plan.shift();
    const snap = snapshotRoom(s.room); G.K.rooms[s.room] = snap;
    const v = G.victims.find(x => x.loc === s.room && !x.atRue && !x.carried);
    if (v) {
      v.found = true;
      report(a, `${roomReportText(s.room, snap)} Victime découverte : ${vState(v).s.toLowerCase()}. J'extrais.`);
      a.plan = [{ type: 'carry', v }, ...a.plan];
    } else report(a, roomReportText(s.room, snap) + ' Rien à signaler.');
    if (s.room === 'SEJ' && snap.onFire) know('feu_sejour', 'Feu localisé au séjour');
    know('layout', 'Disposition de l\'appartement');
    G.dirty = true;
  }
}
function doCarry(a, s) {
  const v = s.v;
  a.carry = v; v.carried = a.id; v.h = 0.4;
  a.plan.shift();
  a.plan.unshift({ type: 'move', to: 'RUE' }, { type: 'drop', v });
  G.dirty = true;
}
function doDrop(a, s) {
  const v = s.v;
  a.plan.shift(); a.carry = null; v.carried = null; v.loc = 'RUE'; v.atRue = true;
  report(a, `Victime extraite, au pied de l'immeuble (${v.name}).`);
  G.dirty = true;
}
function doAttack(a, s, dt) {
  const zFire = ROOMS.filter(r => roomOnFire(G.W, r) || (hasFire(G.W, r) && G.W.Z[r].fireQ > 30));
  if (!zFire.length) {
    a.plan.shift(); a.flowing = false;
    const res = G.W.smoulder.filter(x => !x.done).map(x => ROOM_NAMES[x.zone]);
    report(a, `Flammes abattues${res.length ? ` (${res.join(', ')}) : il reste des braises et des points chauds sous les débris, fumées encore épaisses. Déblai à prévoir` : ''}. Je reconnais les autres pièces.`);
    const todo = ['CH1', 'CH3', 'CH2', 'SDB', 'CUI', 'SEJ', 'COU'].filter(r => !(G.K.rooms[r] && G.W.t - G.K.rooms[r].t < 30));
    a.plan = [...todo.map(r => ({ type: 'search', room: r })), ...a.plan];
    G.dirty = true; return;
  }
  const target = zFire.includes('SEJ') ? 'SEJ' : zFire[0];
  if (a.loc !== target) {
    // progression en refroidissant les fumees
    a.flowing = waterOK();
    a.plan.unshift({ type: 'move', to: target }); return;
  }
  if (!waterOK()) { a.flowing = false; a.status = 'LANCE À SEC'; return; }
  a.flowing = true; a.status = `Attaque ${a.lance} : ${ROOM_NAMES[target]}`;
  if (!s.announced) { s.announced = true; report(a, `${roomReportText(target, snapshotRoom(target))} J'attaque.`); }
}
// ---- deblai, controle, ventilation, feu du R+4
function burntRooms() { return [...new Set(G.W.fires.map(f => f.zone))]; }
function doDeblai(a, s, dt) {
  const W = G.W;
  a.effort = 1.5;
  const flames = ROOMS.filter(r => hasFire(W, r));
  const target = W.smoulder.find(x => !x.done && !roomOnFire(W, x.zone));
  if (!target && G.r4.out && !G.r4.deblaye) {
    if (a.loc !== 'R4_APT') { a.plan.unshift({ type: 'move', to: 'R4_APT' }); return; }
    if (!waterOK()) { a.flowing = false; a.status = 'Déblai : lance à sec'; return; }
    s.t4 = (s.t4 || 0) + dt; a.flowing = s.t4 % 40 < 18;
    a.status = `Déblai : séjour du R+4 (${Math.round(100 * s.t4 / 300)} %)`;
    if (s.t4 >= 300) { G.r4.deblaye = true; s.n = (s.n || 0) + 1; report(a, 'Déblai terminé au R+4.'); G.dirty = true; }
    return;
  }
  if (!target) {
    if (flames.length) { a.status = `Déblai en attente : feu encore actif (${flames.map(r => ROOM_NAMES[r]).join(', ')})`; a.flowing = false; return; }
    a.plan.shift(); a.flowing = false;
    report(a, s.n ? `Déblai terminé (${s.n} volume(s)). Plus de foyer apparent.` : 'Pas de foyer résiduel trouvé.');
    G.dirty = true; return;
  }
  if (a.loc !== target.zone) { a.plan.unshift({ type: 'move', to: target.zone }); return; }
  if (!waterOK()) { a.flowing = false; a.status = 'Déblai : lance à sec'; return; }
  if (s.cur !== target) { s.cur = target; s.t = 0; s.d = clamp(100 + target.mj * 0.45, 150, 420); }
  a.flowing = s.t % 40 < 18;                 // noyage par impulsions
  a.status = `Déblai : ${ROOM_NAMES[target.zone]} (${Math.round(100 * s.t / s.d)} %)`;
  s.t += dt;
  if (s.t >= s.d) {
    target.done = true; target.deblaye = true; s.n = (s.n || 0) + 1; s.cur = null;
    G.K.rooms[target.zone] = snapshotRoom(target.zone);
    report(a, `Déblai terminé : ${ROOM_NAMES[target.zone]}, débris noyés et dégarnis.`);
    G.dirty = true;
  }
}
function doControle(a, s, dt) {
  const W = G.W;
  if (!s.list) { s.list = burntRooms().concat(['COU']).filter((r, i, l) => l.indexOf(r) === i); s.i = 0; s.t = 0; s.hot = []; }
  if (s.i >= s.list.length) {
    a.plan.shift();
    const flames = ROOMS.some(r => roomOnFire(W, r));
    if (!s.hot.length && !flames && (G.r4.t0 == null || G.r4.deblaye)) { G.controle = W.t; report(a, 'Contrôle à la caméra thermique terminé : aucun point chaud, pas de propagation dans les cloisons ni au plafond.'); }
    else report(a, `Contrôle à la caméra thermique : points chauds dans ${s.hot.map(r => ROOM_NAMES[r]).join(', ') || 'le logement'}. Déblai à poursuivre.`);
    G.dirty = true; return;
  }
  const r = s.list[s.i];
  if (a.loc !== r) { a.plan.unshift({ type: 'move', to: r }); return; }
  a.status = `Caméra thermique : ${ROOM_NAMES[r]}`;
  s.t += dt;
  if (s.t >= 30) {
    s.t = 0; s.i++;
    if (hasResidual(W, r) || roomOnFire(W, r)) { s.hot.push(r); know('points_chauds', 'Points chauds persistants dans les pièces sinistrées'); }
  }
}
function startVPP(a) {
  const W = G.W;
  W.vpp = true; G.vppT = W.t;
  const flames = ROOMS.some(r => roomOnFire(W, r));
  const imm = isOpen('IMMEUBLE'), exu = isOpen('EXUTOIRE');
  report(a, `VPP en fonctionnement devant la porte d'immeuble.${!imm ? ' Porte d\'immeuble fermée : sans effet.' : ''}${!exu ? ' Exutoire fermé : pas d\'exutoire pour la cage.' : ''}`);
  G.journal.push({ t: W.t, text: 'Ventilation opérationnelle (VPP) mise en œuvre.' });
  if (flames && !G.actors.some(x => x.mission === 'ATTAQUE' && x.flowing)) penalty(12, 'VPP mis en œuvre sur un feu non circonscrit, sans attaque en eau : risque d\'activer le foyer.');
}
function flameOutWin(id) {
  const W = G.W, o = W.O.find(x => x.id === id), z = W.Z[o.a], e = W.ext[id];
  if (!o.open) return 0;
  const q = (e ? e.fuelQ : 0) + (z.flashed && roomOnFire(W, o.a) && z.Tu > 700 ? z.fireQ * 0.15 : 0);
  return q > 60 ? q : 0;
}
function updateR4(dt) {
  const W = G.W, R = G.r4;
  if (R.t0 == null) {
    const q = flameOutWin('W_SEJ1') + flameOutWin('W_SEJ2');
    const pa = G.actors.find(x => x.id === 'PA' && x.protec && x.mission === 'PA_PROTEC');
    const prot = (pa && waterOK() ? 0.25 : 1) * (G.actors.some(x => x.loc === 'R4_APT' && x.lance && x.flowing) ? 0.4 : 1);
    if (q > 0) R.exp += dt * clamp(q / 2500, 0.3, 1.2) * prot;
    else R.exp = Math.max(0, R.exp - dt * 0.2);
    if (R.exp > 240 && !R.warned) { R.warned = true; G.journal.push({ t: W.t, text: 'Les flammes sortant des fenêtres du séjour lèchent la façade et chauffent le vitrage du R+4.' }); }
    if (R.exp > 660) {
      R.t0 = W.t; G.fire.lastEvt = W.t; G.controle = null;
      G.journal.push({ t: W.t, text: 'Propagation par la façade : le feu a gagné l\'appartement du R+4 (effet « chandelle »).' });
      radio(G.actors.some(x => x.id === 'PA' && x.loc !== 'ABSENT') ? 'PA 18' : 'CA FPT 1', 'CDG', 'Flammes au R+4 ! Le vitrage au-dessus du séjour a cédé, le feu prend dans l\'appartement du dessus.', 'alerte');
      know('feu_r4', 'Propagation au R+4 par la façade');
      G.dirty = true;
    }
    return;
  }
  if (R.out) return;
  const t = W.t - R.t0;
  const decl = t > 1500 ? clamp(1 - (t - 1500) / 600, 0, 1) : 1;   // combustible du sejour du R+4 consomme
  R.q = Math.min(2500, 0.03 * t * t) * R.k * decl;
  if (decl <= 0) R.k = 0;
  const att = G.actors.filter(x => x.loc === 'R4_APT' && x.flowing && waterOK());
  for (const x of att) { const wq = (x.lance === 'LDV 250' ? 250 : 500) / 60 * 2600 * SIM.CFG.waterEff; R.k = Math.max(0, R.k - dt * SIM.CFG.knockCoef * wq / Math.max(500, Math.min(2500, 0.03 * t * t))); }
  const pa = G.actors.find(x => x.id === 'PA' && x.protec && x.mission === 'PA_PROTEC');
  if (pa && waterOK()) R.k = Math.max(0.35, R.k - dt * 0.0006);   // la lance exterieure freine sans eteindre
  if (R.k < 0.03) {
    R.out = true; R.q = 0; R.residual = 1; G.journal.push({ t: W.t, text: 'Feu du R+4 : flammes abattues.' });
    for (const x of att) report(x, 'Feu du R+4 abattu. Foyers résiduels dans le séjour du R+4, déblai à prévoir.');
    G.dirty = true;
  }
  const v = G.victims[1];
  if (v.loc === 'R4_APT' && !v.atRue && R.q > 150) v.fed += dt * (R.q / 2500) * 0.012;
}
function exposureR4(a, dt) {
  const R = G.r4;
  if (R.t0 == null || R.out) return;
  if (R.q > 800 && !(a.flowing && waterOK())) a.hazard += dt; else a.hazard = Math.max(0, a.hazard - dt * 0.5);
  if (a.hazard > 20 && !a.hurt) {
    a.hurt = true; penalty(30, `${a.label} (${a.engin}) exposé au feu du R+4 sans protection hydraulique : brûlures.`);
    report(a, 'Binôme en difficulté au R+4, repli immédiat, un équipier brûlé.');
    a.plan = [{ type: 'move', to: 'RUE' }, { type: 'done' }]; a.flowing = false; G.dirty = true;
  }
}
function doAttackR4(a, s, dt) {
  const R = G.r4;
  if (R.out || R.t0 == null) {
    a.plan.shift(); a.flowing = false;
    if (R.residual && !R.deblaye) a.plan.unshift({ type: 'act', d: 240, label: 'Déblai du séjour du R+4', fn: () => { R.deblaye = true; report(a, 'Déblai terminé au R+4.'); } });
    G.dirty = true; return;
  }
  if (!waterOK()) { a.flowing = false; a.status = 'LANCE À SEC'; return; }
  a.flowing = true; a.status = `Attaque ${a.lance} : R+4`;
  if (!s.announced) { s.announced = true; report(a, 'R+4 : séjour en feu, fumées jusqu\'au sol. J\'attaque.'); }
}
function exposure(a, dt, zo) {
  const c = conditionsAt(G.W, zo.zone, zo.h);
  const T = c.T - 273;
  const protectedByWater = a.flowing && waterOK();
  if (T > 250 && !protectedByWater) a.hazard += dt; else a.hazard = Math.max(0, a.hazard - dt * 0.5);
  if (T > 120 && !a.lance && !a.warnNoLance && ROOMS.includes(a.loc)) {
    a.warnNoLance = true; penalty(8, `${a.label} (${a.engin}) engagé dans un volume chaud sans établissement.`);
  }
  if (a.hazard > 20 && !a.hurt) {
    a.hurt = true; penalty(30, `${a.label} (${a.engin}) exposé à ${Math.round(T)} °C sans protection hydraulique : brûlures.`);
    report(a, `Binôme en difficulté, chaleur extrême (${locName(a.loc)}). Repli immédiat, un équipier brûlé aux mains.`);
    a.plan = [{ type: 'move', to: 'RUE' }, { type: 'done' }]; a.flowing = false; G.dirty = true;
  }
}

// ===========================================================================
// BOUCLE
// ===========================================================================
function runTimers() {
  const W = G.W;
  for (let i = G.timers.length - 1; i >= 0; i--) if (G.timers[i].t <= W.t) { const f = G.timers[i].fn; G.timers.splice(i, 1); f(); }
}
function tick(dt) {
  const W = G.W;
  runTimers();
  if (G.busy && W.t >= G.busy.until) { const b = G.busy; G.busy = null; b.done(); G.dirty = true; }
  updateFireStatus();
  // eau
  W.water = {};
  for (const a of G.actors) {
    if (a.kind !== 'binome') continue;
    tickActor(a, dt);
    if (a.flowing && waterOK()) {
      const zo = zoneOf(a.loc);
      const q = a.lance === 'LDV 250' ? 250 : 500;
      if (zo && zo.zone !== 'CAGE') W.water[zo.zone] = (W.water[zo.zone] || 0) + (q / 60) * 2600 * CFG.waterEff;
      if (!G.alim) { G.tank = Math.max(0, G.tank - q / 60 * dt); if (G.tank <= 0 && !G.tankWarned) { G.tankWarned = true; radio('CA FPT 1', 'CDG', 'Citerne du FPT vide, la lance est à sec !', 'alerte'); penalty(20, 'Lance à sec : le FPT n\'était pas alimenté.'); } }
    }
  }
  for (const a of G.actors) if (a.kind !== 'binome') tickActor(a, dt);
  const paP = G.actors.find(x => x.id === 'PA' && x.protec && x.mission === 'PA_PROTEC');
  if (paP && !G.alim) G.tank = Math.max(0, G.tank - 500 / 60 * dt);
  updateR4(dt);
  // VSAV
  for (const a of G.actors) if (a.kind === 'vsav' && a.pec && a.loc === 'RUE') {
    for (const v of G.victims) if (v.atRue && !v.pec) {
      v.pecT = (v.pecT || 0) + dt;
      if (v.pecT > 60) { v.pec = true; const st = vState(v); radio(a.engin, 'CDG', `Bilan ${v.name} : ${st.s.toLowerCase()}${v.fed >= 0.3 ? ', intoxication aux fumées. Demande de médicalisation.' : ', intoxication légère.'}`, 'cr'); }
    }
  }
  step(W);
  updateVictims(dt);
  updateNeighbour(dt);
  for (const e of W.events) onSimEvent(e);
  W.events.length = 0;
  if (W.t >= T_FIN_MAX && !G.ended) endGame('Durée maximale atteinte');
}
function onSimEvent(e) {
  if (e.type === 'embrasement' || e.type === 'propagation') {
    G.fire.lastEvt = e.t;
    G.journal.push({ t: e.t, text: `${e.type === 'embrasement' ? 'Embrasement généralisé' : 'Propagation'} : ${ROOM_NAMES[e.id] || e.id}` });
    for (const a of G.actors) if (a.kind === 'binome' && a.loc === e.id && !a.hurt) {
      if (a.flowing) penalty(5, `${a.label} (${a.engin}) exposé à un embrasement, protégé par sa lance.`);
      else { a.hurt = true; penalty(35, `${a.label} (${a.engin}) pris dans un embrasement généralisé.`); report(a, 'Embrasement ! Repli d\'urgence, binôme blessé.'); a.plan = [{ type: 'move', to: 'RUE' }, { type: 'done' }]; }
    }
  }
  if (e.type === 'reprise') {
    G.fire.lastEvt = e.t; G.controle = null; G.reprises++;
    G.journal.push({ t: e.t, text: `Reprise de feu : ${ROOM_NAMES[e.id] || e.id} (foyer résiduel non déblayé).` });
    const here = G.actors.find(a => a.kind === 'binome' && a.loc === e.id);
    if (here) report(here, `Reprise de feu dans ${ROOM_NAMES[e.id].toLowerCase()} ! Les braises sous les débris sont reparties.`);
    else if (G.W.O.some(o => o.a === e.id && o.b === 'EXT' && o.open)) radio('CA FPT 1', 'CDG', `Lueurs et fumées qui reprennent au R+3 (${ROOM_NAMES[e.id].toLowerCase()}) !`, 'alerte');
    G.dirty = true;
  }
  if (e.type === 'vitre') G.journal.push({ t: e.t, text: 'Bris de vitrage : ' + e.id });
  if (e.type === 'eteint') G.journal.push({ t: e.t, text: 'Foyer éteint : ' + (ROOM_NAMES[e.id] || e.id) });
}

// ===========================================================================
// MESSAGES ET EVALUATION
// ===========================================================================
const has = (s, re) => re.test((s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''));
function evalAmbiance(f) {
  const t = G.W.t - T_ARRIVEE, out = [];
  let pts = 0;
  const ok = (c, good, bad, p) => { out.push({ ok: !!c, text: c ? good : bad }); if (c) pts += p; };
  ok(t <= 300, `Passé à ${fmtDur(t)} après l'arrivée (moins de 5 min).`, `Passé à ${fmtDur(t)} : au-delà des 5 min réglementaires.`, 20);
  ok(f.cos || has(f.suis, /\bcos\b/), 'Prise de COS annoncée.', 'Prise de COS non annoncée.', 10);
  ok(has(f.suis, /glycines|14/) && has(f.suis, /merignac/), 'Adresse complète (rue et commune).', 'Adresse incomplète dans « Je suis ».', 10);
  ok(has(f.vois, /feu|incendie|embras/) && has(f.vois, /appart|logement/), 'Nature du sinistre décrite.', 'Nature du sinistre absente de « Je vois ».', 10);
  ok(has(f.vois, /\b3|r\+3|troisieme|3e/), 'Étage précisé.', 'Étage du sinistre non précisé.', 5);
  const vKnown = G.K.facts.victime_existe;
  ok(!vKnown || has(f.vois, /victime|personne|occupant|mere|dame/), vKnown ? 'Victime présumée signalée.' : 'Pas de victime annoncée (non connue à ce stade).', 'Une personne est signalée à l\'intérieur mais n\'apparaît pas dans le message.', 10);
  const cKnown = G.K.facts.cage_enfumee || G.K.facts.porte_ouverte;
  ok(!cKnown || has(f.vois + ' ' + f.prevois, /cage|escalier|parties communes/), cKnown ? 'Enfumage de la cage signalé.' : 'Cage : non reconnue à ce stade.', 'La cage d\'escalier enfumée n\'est pas signalée.', 10);
  ok(has(f.prevois, /propag|etage|cage|r\+4|superieur|embras|aggrav/), 'Évolution prévisible anticipée.', '« Je prévois » vide ou sans évolution prévisible.', 10);
  const engaged = G.actors.filter(a => a.mission || a.kind === 'binome' && a.loc !== 'RUE').length > 0;
  ok(has(f.fais, /reco|sauvet|attaq|ldv|lance|mise en securite|recherche/) && engaged, 'Actions engagées cohérentes avec les ordres donnés.', engaged ? '« Je fais » ne décrit pas les actions engagées.' : 'Actions annoncées alors qu\'aucun ordre n\'a été donné.', 15);
  return { pts, out, t };
}
function evalCR(f) {
  const out = [];
  let pts = 0;
  const ok = (c, good, bad, p) => { out.push({ ok: !!c, text: c ? good : bad }); if (c) pts += p; };
  const vfound = G.victims.filter(v => v.found);
  ok(!vfound.length || has(f.vois + ' ' + f.victimes, /victime|personne|ua|ur|impliqu|blesse|intox/), 'Bilan victimes transmis.', 'Victimes retrouvées non mentionnées.', 30);
  const cur = G.fire.cur, said = has(f.vois, /eteint/) ? 'eteint' : has(f.vois, /maitrise/) && !has(f.vois, /non maitrise/) ? 'maitrise' : has(f.vois, /circonscrit/) ? 'circonscrit' : has(f.vois, /non maitrise|en cours|developpe|attaque|embras|feu/) ? 'actif' : null;
  const okFire = said === cur || (said === 'actif' && (cur === 'developpement' || cur === 'non_maitrise')) || (said === 'circonscrit' && cur === 'maitrise');
  const curL = (FIRE_STATES.find(x => x[0] === cur) || [0, ''])[1].toLowerCase();
  ok(okFire, `Situation du feu exacte (${curL}).`, said === 'eteint' && cur !== 'eteint' ? `Feu annoncé éteint alors qu'il est ${curL} : tant que le déblai et le contrôle ne sont pas faits, on ne déclare pas un feu éteint.` : `L'état du feu annoncé ne correspond pas à la réalité (${curL}).`, 30);
  ok((f.fais || '').length > 10, 'Actions en cours décrites.', '« Je fais » vide.', 20);
  ok(has(f.suis, /glycines|14/), 'Localisation rappelée.', 'Localisation non rappelée.', 20);
  return { pts, out };
}
function fmtDur(s) { s = Math.max(0, Math.round(s)); return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`; }

function sendMessage(type, f) {
  const lines = [`JE SUIS : ${f.suis}`, `JE VOIS : ${f.vois}`, type === 'ambiance' ? `JE PRÉVOIS : ${f.prevois}` : `VICTIMES : ${f.victimes}`, `JE FAIS : ${f.fais}`, `JE DEMANDE : ${f.demande || '—'}`];
  if (type === 'ambiance') {
    if (G.ambiance) return;
    G.ambiance = { t: G.W.t, f, ev: evalAmbiance(f), model: modelMessage('ambiance') };
    G.lastCorrection = { type: 'ambiance', t: G.W.t, f, ev: G.ambiance.ev, model: G.ambiance.model };
    radio('CDG', 'CODIS', `MESSAGE D'AMBIANCE${f.cos ? ' — je prends le COS' : ''}. ` + lines.join(' / '), 'msg');
  } else {
    const ev = evalCR(f);
    G.crs.push({ t: G.W.t, f, ev });
    G.lastCorrection = { type: 'cr', t: G.W.t, f, ev, model: modelMessage('cr'), n: G.crs.length };
    radio('CDG', 'CODIS', `COMPTE RENDU N°${G.crs.length}. ` + lines.join(' / '), 'msg');
  }
  requestRenforts(f.renforts || []);
  setTimeout(() => radio('CODIS', 'CDG', 'Reçu.'), 500);
  G.dirty = true;
}

// ===========================================================================
// JAUGES
// ===========================================================================
function gauges() {
  const W = G.W;
  const Qapt = ROOMS.reduce((s, r) => s + W.Z[r].fireQ, 0);
  const burning = ROOMS.filter(r => roomOnFire(W, r)).length;
  const cageSmoke = LEVELS.filter((l, i) => conditionsAt(W, 'CAGE', i * 2.6 + 1.5).vis < 3).length;
  const situation = clamp(100 - (Qapt + G.r4.q) / 90 - cageSmoke * 6 - Math.max(0, burning - 1) * 12 - (hasResidual(W) ? 8 : 0), 0, 100);
  const victimes = G.victims.reduce((s, v) => s + (v.fed >= 2.5 ? 0 : (1 - Math.min(v.fed, 2.5) / 2.5) * 100), 0) / G.victims.length;
  const securite = clamp(100 - G.safety.reduce((s, p) => s + p.pts, 0), 0, 100);
  let cmd = 100;
  const since = W.t - T_ARRIVEE;
  if (G.ambiance) cmd -= (100 - G.ambiance.ev.pts) * 0.5;
  if (G.oi) cmd -= (100 - G.oi.ev.pts) * 0.25; else if (since > 600) cmd -= Math.min(25, (since - 600) / 24);
  else if (since > 300) cmd -= Math.min(50, 20 + (since - 300) / 12);
  if (G.ambiance && since > 20 * 60 && !G.crs.length) cmd -= 15;
  for (const c of G.crs) cmd += (c.ev.pts - 70) * 0.05;
  cmd -= G.pauses * 3 + G.pausedTime / 10;
  const commandement = clamp(cmd, 0, 100);
  const facts = ['feu_sejour', 'victime_existe', 'victime_lieu', 'voisin_r4', 'porte_ouverte', 'cage_enfumee', 'layout'];
  const kf = facts.filter(k => G.K.facts[k]).length / facts.length;
  const kr = ROOMS.filter(r => G.K.rooms[r]).length / ROOMS.length;
  const connaissance = Math.round((kf * 0.6 + kr * 0.4) * 100);
  return { situation, victimes, securite, commandement, connaissance };
}

// ===========================================================================
// FIN
// ===========================================================================
function endGame(reason) {
  if (G.ended) return;
  G.ended = true; G.endReason = reason;
  UI.showDebrief && UI.showDebrief();
}
function debriefData() {
  const g = gauges(), pts = [], W = G.W;
  const amb = G.ambiance;
  if (!amb) pts.push({ ok: false, text: 'Aucun message d\'ambiance transmis.' });
  else amb.ev.out.forEach(o => pts.push(o));
  if (!G.oi) pts.push({ ok: false, text: 'Aucun ordre initial formalisé.' });
  else G.oi.ev.out.filter(o => !o.ok).forEach(o => pts.push({ ok: false, text: 'Ordre initial : ' + o.text }));
  evalSitac().forEach(o => pts.push({ ok: o.ok, text: 'SITAC : ' + o.text }));
  if (!G.crs.length) pts.push({ ok: false, text: 'Aucun compte rendu transmis.' });
  else G.crs[G.crs.length - 1].ev.out.forEach(o => pts.push(o));
  const v1 = G.victims[0], v2 = G.victims[1];
  pts.push({ ok: v1.atRue, text: v1.atRue ? `Mme Lacoste extraite (${vState(v1).s.toLowerCase()}).` : `Mme Lacoste n'a pas été extraite (${vState(v1).s.toLowerCase()}).` });
  pts.push({ ok: v2.mode === 'confine' || v2.mode === 'sauve', text: v2.mode === 'confine' ? 'Voisin du R+4 mis en sécurité par confinement.' : v2.mode === 'sauve' ? 'Voisin du R+4 sauvé par l\'échelle.' : 'Le voisin du R+4, sans consigne, est descendu par la cage enfumée.' });
  if (G.requests.SMUR || !G.victims.some(v => v.fed >= 0.3)) pts.push({ ok: true, text: G.requests.SMUR ? 'Médicalisation demandée.' : 'Pas de victime nécessitant une médicalisation.' });
  else pts.push({ ok: false, text: 'Victime intoxiquée sans demande de SMUR.' });
  pts.push({ ok: !isOpen('PALIERE') || !ROOMS.some(r => roomOnFire(G.W, r)), text: isOpen('PALIERE') ? 'La porte palière est restée ouverte pendant le feu : la cage s\'est enfumée.' : 'Porte palière maîtrisée.' });
  const burnt = burntRooms();
  if (W.fires.some(f => f.out)) {
    const left = burnt.filter(r => hasResidual(W, r) || hasFire(W, r)).map(r => ROOM_NAMES[r]);
    pts.push({ ok: !left.length, text: left.length ? `Feu ou foyers résiduels encore présents en fin d'exercice : ${left.join(', ')}.` : 'Déblai des pièces sinistrées réalisé.' });
    pts.push({ ok: !!G.controle, text: G.controle ? `Contrôle à la caméra thermique effectué à ${hhmm(G.controle)}.` : 'Pas de contrôle à la caméra thermique avant la fin : le feu ne pouvait pas être déclaré éteint.' });
  }
  if (G.reprises) pts.push({ ok: false, text: `${G.reprises} reprise(s) de feu : foyer résiduel laissé sans déblai.` });
  if (G.r4.t0 != null) pts.push({ ok: false, text: `Propagation au R+4 par la façade à ${hhmm(G.r4.t0)} : flammes sorties trop longtemps par les fenêtres du séjour (attaque tardive ou façade non protégée).` });
  else if (G.r4.exp > 60) pts.push({ ok: true, text: 'Façade exposée aux flammes mais pas de propagation au R+4.' });
  pts.push({ ok: !!W.vpp, text: W.vpp ? `Ventilation opérationnelle mise en œuvre à ${hhmm(G.vppT)}.` : 'Pas de ventilation opérationnelle : logement et cage restés enfumés.' });
  G.safety.forEach(p => pts.push({ ok: false, text: `Sécurité : ${p.text}` }));
  if (G.pauses) pts.push({ ok: false, text: `${G.pauses} pause(s), ${fmtDur(G.pausedTime)} au total.` });
  return { g, pts };
}


// ===========================================================================
// TEMOINS (apparition progressive, chaque question prend du temps au CDG)
// ===========================================================================
const WITNESSES = [
  { id: 'REQ', short: 'Requérante', name: 'Mme Lacoste (fille de l\'occupante)', appear: T_ARRIVEE + 40,
    hello: 'Une femme en pleurs s\'approche du VLCG : « C\'est chez moi, au 3e ! »',
    questions: [
      { id: 'q1', q: 'Y a-t-il encore quelqu\'un à l\'intérieur ?', a: 'Oui ! Ma mère, elle a 82 ans. Elle était déjà couchée.', fact: ['victime_existe', 'Une personne âgée est restée dans l\'appartement'] },
      { id: 'q2', req: 'q1', q: 'Où se trouve-t-elle exactement ?', a: 'Dans sa chambre, tout au fond du couloir à droite, côté rue. Je n\'ai pas pu y aller, il y avait trop de fumée. Sa porte était fermée, je crois.', fact: ['victime_lieu', 'Victime présumée : chambre au fond à droite, côté rue, porte fermée'] },
      { id: 'q3', q: 'Où le feu a-t-il pris ?', a: 'Dans le salon, sur le canapé. Une bougie, je pense.', fact: ['feu_sejour', 'Feu parti du canapé du séjour'] },
      { id: 'q4', req: 'q3', q: 'Avez-vous refermé la porte de l\'appartement en sortant ?', a: 'Non… je suis partie en courant, elle est restée grande ouverte.', fact: ['porte_ouverte', 'Porte palière restée ouverte'] },
      { id: 'q5', req: 'q3', q: 'Comment est disposé l\'appartement ?', a: 'En entrant, un long couloir. Le salon puis la cuisine à droite, côté rue, et la chambre de maman tout au bout. Les deux autres chambres et la salle de bains sont à gauche, côté cour.', fact: ['layout', 'Disposition de l\'appartement'] },
      { id: 'q6', q: 'Y a-t-il du gaz ou des produits dangereux ?', a: 'Non, tout est électrique dans l\'immeuble.' },
    ] },
  { id: 'VOI', short: 'Voisine du R+2', name: 'Mme Petit, voisine du R+2', appear: T_ARRIVEE + 260,
    hello: 'Une voisine sort de l\'immeuble en toussant et vient vers vous.',
    questions: [
      { id: 'v1', q: 'Comment est l\'escalier ?', a: 'Plein de fumée à partir du 3e, je suis descendue en me tenant à la rampe. Au 2e ça commençait à sentir fort.', fact: ['cage_enfumee', 'Cage d\'escalier enfumée à partir du R+3'] },
      { id: 'v2', q: 'Qui habite au-dessus de l\'appartement en feu ?', a: 'M. Ferrand, au 4e. Il a 75 ans, il ne descendra jamais seul dans la fumée, il a peur.', fact: ['voisin_r4', 'Voisin âgé au R+4'] },
      { id: 'v3', req: 'v1', q: 'Reste-t-il des gens dans les étages ?', a: 'Au 1er ils sont partis en vacances. Au 2e il n\'y avait que moi.' },
    ] },
];
function witnessDef(id) { return WITNESSES.find(w => w.id === id); }
function availableQuestions(wid) {
  const d = witnessDef(wid);
  return d.questions.filter(q => !G.asked[q.id] && (!q.req || G.asked[q.req]));
}
function ask(wid, qid) {
  if (G.busy || G.ended) return false;
  const d = witnessDef(wid), q = d.questions.find(x => x.id === qid);
  G.busy = { until: G.W.t + 12, label: `Échange avec ${d.short.toLowerCase()}`, start: G.W.t, done: () => {
    G.asked[q.id] = { t: G.W.t };
    if (q.fact) know(q.fact[0], q.fact[1]);
    G.journal.push({ t: G.W.t, text: `${d.short} : ${q.q} → ${q.a}` });
    G.observations.unshift({ t: G.W.t, kind: 'temoin', who: d.short, text: `« ${q.a} »`, q: q.q });
    UI.toast && UI.toast(`${d.short} : « ${q.a} »`, 'temoin');
  } };
  G.busy.q = q.q;
  return true;
}

// ===========================================================================
// OBSERVATIONS DU CDG (lecture du feu) : 6 s chacune
// ===========================================================================
const WIN_INFO = {
  W_SEJ1: ['SEJ', 'R+3 côté rue, 1re fenêtre'], W_SEJ2: ['SEJ', 'R+3 côté rue, 2e fenêtre'], W_CUI: ['CUI', 'R+3 côté rue, 3e fenêtre'], W_CH1: ['CH1', 'R+3 côté rue, fenêtre de droite'],
  W_CH2: ['CH2', 'R+3 côté cour, fenêtre de gauche'], W_SDB: ['SDB', 'R+3 côté cour, petite fenêtre'], W_CH3: ['CH3', 'R+3 côté cour, fenêtre de droite'],
};
function observeText(what) {
  const W = G.W;
  if (WIN_INFO[what]) {
    const [room, label] = WIN_INFO[what], z = W.Z[room], o = W.O.find(x => x.id === what);
    const zr = layerRel(z), fire = roomOnFire(W, room), soot = z.MSoot / Math.max(z.Mu, 1e-3);
    const p = [o.open ? 'vitrage cassé' : 'vitrage intact'];
    if (zr > 2.1) p.push('pas de fumée visible derrière');
    else if (o.open) p.push(`fumées ${soot > 0.0015 ? 'noires et épaisses' : 'grises'} sortant ${z.Tu > 650 ? 'sous pression, en volutes rapides' : 'lentement'}`);
    else p.push(`vitre noircie, fumées ${zr < 1 ? 'jusqu\'en bas de la fenêtre' : 'en partie haute'}`);
    if (fire && z.flashed) p.push('flammes à l\'ouverture : volume embrasé');
    else if (fire) p.push('lueurs orangées à l\'intérieur');
    if (fire && room === 'SEJ') know('feu_sejour', 'Feu localisé au séjour (côté rue)');
    if (o.rear) know('face_arriere', 'Façade côté cour reconnue');
    return `${label} : ${p.join(', ')}.`;
  }
  if (what === 'R4') {
    const v2 = G.victims[1];
    know('voisin_r4', 'Voisin du R+4 à sa fenêtre');
    if (G.r4.t0 != null && !G.r4.out) return `R+4 au-dessus du feu : vitrage cassé, flammes et fumées noires à la fenêtre du R+4.${v2.loc === 'R4_APT' && !v2.atRue ? ' L\'occupant n\'est plus visible.' : ''}`;
    if (G.r4.exp > 240) return `R+4 : les flammes du R+3 lèchent la façade jusqu'à la fenêtre du R+4, le vitrage noircit.${v2.mode === 'fenetre' ? ' Un homme âgé appelle à l\'aide.' : ''}`;
    return v2.mode === 'fenetre' ? 'R+4 au-dessus du feu : un homme âgé appelle à l\'aide à sa fenêtre et menace de descendre.' : 'R+4 : l\'occupant est à sa fenêtre, plus calme.';
  }
  if (what.startsWith('CAGE_')) {
    const lv = what.slice(5), i = LEVELS.indexOf(lv), c = conditionsAt(W, 'CAGE', i * 2.6 + 1.5);
    if (c.vis < 5) know('cage_enfumee', 'Cage d\'escalier enfumée');
    return `Cage d'escalier, ${LEVEL_NAMES[lv]} : ${c.vis < 2 ? 'vitre opaque, enfumage total' : c.vis < 8 ? 'fumées visibles derrière la vitre' : 'éclairage normal, pas de fumée visible'}.`;
  }
  if (what === 'IMMEUBLE') {
    const c = conditionsAt(W, 'CAGE', 1.8);
    return `Porte d'immeuble ${isOpen('IMMEUBLE') ? 'ouverte' : 'fermée'} ; ${c.smoke ? 'fumées sortant en partie haute' : 'pas de fumée au RDC'}.`;
  }
  if (what === 'TOIT') return `Toiture : exutoire de la cage ${isOpen('EXUTOIRE') ? 'ouvert, fumées évacuées' : 'fermé'}.`;
  return '';
}
function observe(what) {
  if (G.busy || G.ended) return false;
  G.busy = { until: G.W.t + 6, label: 'Lecture du feu', start: G.W.t, done: () => {
    const txt = observeText(what);
    G.observations.unshift({ t: G.W.t, kind: 'obs', text: txt });
    G.journal.push({ t: G.W.t, text: 'Observation : ' + txt });
    UI.toast && UI.toast(txt, 'obs');
  } };
  return true;
}

// ===========================================================================
// SITUATION DU FEU (etats reglementaires, avec hysteresis)
// ===========================================================================
const FIRE_STATES = [['developpement', 'En développement'], ['non_maitrise', 'Non maîtrisé'], ['circonscrit', 'Circonscrit'], ['maitrise', 'Maîtrisé'], ['eteint', 'Éteint']];
function updateFireStatus() {
  const W = G.W, F = G.fire;
  const Q = ROOMS.reduce((s, r) => s + W.Z[r].fireQ, 0) + G.r4.q;
  F.qs = F.qs == null ? Q : F.qs + (Q - F.qs) * 0.01;   // lissage ~10 s
  if (!F.lastHist || W.t - F.lastHist >= 10) { F.hist.push(F.qs); F.lastHist = W.t; if (F.hist.length > 13) F.hist.shift(); }
  const burning = ROOMS.filter(r => hasFire(W, r) && (roomOnFire(W, r) || W.Z[r].fireQ > 30));
  const r4On = G.r4.t0 != null && !G.r4.out;
  if (burning.length || r4On) F.lastFlame = W.t;
  const trend = F.hist.length > 6 ? F.qs - F.hist[F.hist.length - 7] : 0;
  const residual = hasResidual(W) || (G.r4.out && !G.r4.deblaye);
  let cand;
  // Eteint : plus de flammes, deblai fait et controle a la camera thermique effectue.
  // Maitrise : flammes abattues depuis 2 min, sans reprise ; il reste deblai et controle.
  if (!burning.length && !r4On && !residual && G.controle) cand = 'eteint';
  else if (!burning.length && !r4On && W.t - (F.lastFlame || 0) > 120) cand = 'maitrise';
  else if (!burning.length && !r4On) cand = F.cur === 'developpement' ? 'non_maitrise' : 'circonscrit';
  else if (burning.every(r => (W.water[r] || 0) > 0) && (!r4On || G.actors.some(x => x.loc === 'R4_APT' && x.flowing)) && W.t - F.lastEvt > 90) cand = 'circonscrit';
  else if (trend > 400 || W.t - F.lastEvt < 120) cand = 'developpement';
  else cand = 'non_maitrise';
  if (cand === F.cur) { F.cand = null; return; }
  if (F.cand !== cand) { F.cand = cand; F.candT = W.t; return; }
  if (W.t - F.candT >= 20 || cand === 'eteint') { F.cur = cand; F.cand = null; F.log.push({ t: W.t, s: cand }); G.journal.push({ t: W.t, text: 'Situation du feu : ' + FIRE_STATES.find(x => x[0] === cand)[1] }); }
}

// ===========================================================================
// MESSAGE TYPE (correction)
// ===========================================================================
function modelMessage(type) {
  const W = G.W, K = G.K.facts, out = {};
  const burning = ROOMS.filter(r => roomOnFire(W, r));
  const cage = LEVELS.filter((l, i) => conditionsAt(W, 'CAGE', i * 2.6 + 1.5).vis < 5).map(l => LEVEL_NAMES[l]);
  const v1 = G.victims[0], v2 = G.victims[1];
  const unk = s => `<em class="unk">${s} (non connu à ce moment)</em>`;
  out.suis = '14 rue des Glycines, résidence Les Pins, bâtiment B, Mérignac. Je prends le COS, appellation « COS Glycines ».';
  const vois = [`Feu d'appartement au R+3 d'un immeuble R+4${burning.includes('SEJ') && W.Z.SEJ.flashed ? ', séjour embrasé' : ''}, fumées noires par les fenêtres côté rue`];
  if (cage.length) vois.push(K.cage_enfumee || K.porte_ouverte ? `cage d'escalier enfumée (${cage.join(', ')})` : unk(`cage d'escalier enfumée (${cage.join(', ')})`));
  if (!v1.atRue) vois.push(K.victime_existe ? `une personne âgée présumée dans une chambre${K.victime_lieu ? ' côté rue' : ''}` : unk('une personne âgée dans une chambre'));
  if (v2.mode === 'fenetre' || v2.mode === 'confine') vois.push(K.voisin_r4 ? 'un occupant bloqué au R+4' : unk('un occupant bloqué au R+4'));
  out.vois = vois.join(' ; ') + '.';
  out.prevois = 'Propagation au reste de l\'appartement et aux étages supérieurs par la cage d\'escalier et la façade, intoxication des occupants.';
  const fais = [];
  for (const a of G.actors) if (a.mission && MISSIONS[a.mission]) fais.push(MISSIONS[a.mission].label.toLowerCase().replace(' au r+3', ' au R+3').replace(' du r+4', ' du R+4').replace(' (ldv en protection)', ' sous protection d\'une LDV'));
  out.fais = fais.length ? fais.join(' ; ') + '.' : 'Reconnaissances et sauvetages sous protection d\'une LDV, alimentation du FPT.';
  const dem = [];
  if (K.victime_existe || G.victims.some(v => v.fed >= 0.3)) dem.push('SMUR');
  dem.push('1 FPT en renfort'); dem.push('police pour la circulation');
  out.demande = dem.join(', ') + '.';
  if (type === 'cr') {
    const cur = G.fire.cur;
    out.vois = cur === 'eteint' ? 'Feu éteint au R+3 : déblai terminé, contrôle à la caméra thermique sans point chaud.'
      : cur === 'maitrise' ? 'Feu maîtrisé au R+3 : flammes abattues, déblai et ventilation en cours, contrôle à suivre.'
      : cur === 'circonscrit' ? `Feu circonscrit au R+3${G.r4.t0 != null ? ' et au R+4' : ''}, attaque en cours.`
      : `Feu d'appartement au R+3 ${cur === 'developpement' ? 'en développement' : 'non maîtrisé'}${G.r4.t0 != null && !G.r4.out ? ', propagation au R+4 par la façade' : ''}.`;
    const vs = G.victims.filter(v => v.found || v.atRue).map(v => `${v.name} : ${vState(v).s.toLowerCase()}${v.pec ? ', pris(e) en charge par le VSAV' : ''}`);
    out.victimes = vs.length ? vs.join(' ; ') + '.' : 'Aucune victime retrouvée à ce stade.';
  }
  return out;
}

// ===========================================================================
// ORDRE INITIAL (SAOIECL) : objectifs, idees de manoeuvre, execution
// ===========================================================================
const OBJECTIFS = [
  ['o_sauver', 'Sauver les personnes menacées au R+3'],
  ['o_occupants', 'Mettre en sécurité les occupants des étages supérieurs'],
  ['o_propag', 'Éviter la propagation (cage d\'escalier, étages, façade)'],
  ['o_eteindre', 'Éteindre le feu'],
  ['o_intervenants', 'Assurer la sécurité des intervenants'],
  ['o_victimes', 'Prendre en charge les victimes'],
  ['o_alim', 'Pérenniser l\'alimentation en eau'],
];
const IDEES = [
  ['im_sauv', 'Rechercher et extraire la victime sous protection d\'une LDV', ['RECHERCHE', 'PA_CH1'], 'o_sauver'],
  ['im_reco', 'Reconnaître l\'intégralité de l\'appartement', ['RECHERCHE', 'ATTAQUE'], 'o_sauver'],
  ['im_attaque', 'Attaquer le feu par l\'intérieur, LDV 500 par la cage', ['ATTAQUE'], 'o_eteindre'],
  ['im_porte', 'Maîtriser la porte palière du R+3', ['PALIERE', 'ATTAQUE'], 'o_propag'],
  ['im_r4', 'Mettre en sécurité les occupants du R+4 (confinement ou échelle)', ['R4', 'PA_R4'], 'o_occupants'],
  ['im_desenf', 'Désenfumer la cage d\'escalier (exutoire et porte d\'immeuble)', ['EXUTOIRE'], 'o_propag'],
  ['im_alim', 'Alimenter le FPT sur le PI', ['ALIM'], 'o_alim'],
  ['im_pec', 'Regrouper et prendre en charge les victimes au pied de l\'immeuble', ['PEC'], 'o_victimes'],
];
function startRT() { if (G.phase === 'arrivee') { G.phase = 'rt'; G.rtStart = G.W.t; G.journal.push({ t: G.W.t, text: 'Début du raisonnement tactique.' }); G.dirty = true; } }
function giveOI(oi) {
  // oi = { S, A, C, L, obj: [ids], im: [ids], exe: [{ id, mission, opts }] }
  if (G.oi || G.ended) return null;
  startRT();
  const ev = evalOI(oi);
  G.oi = Object.assign({ t: G.W.t, ev, model: modelOI() }, oi);
  G.phase = 'conduite';
  const objTxt = oi.obj.map(k => OBJECTIFS.find(o => o[0] === k)[1].toLowerCase()).join(' ; ');
  radio('CDG', 'Chefs d\'agrès', `ORDRE INITIAL. Situation : ${oi.S || '—'}. Objectifs : ${objTxt || '—'}.`, 'ordre');
  for (const e of oi.exe) {
    const a = G.actors.find(x => x.id === e.id);
    if (a && e.mission) order(a, e.mission, e.opts || {});
  }
  G.lastCorrection = { type: 'oi', t: G.W.t, f: oi, ev, model: G.oi.model };
  G.journal.push({ t: G.W.t, text: 'Ordre initial donné.' });
  G.dirty = true;
  return G.lastCorrection;
}
function evalOI(oi) {
  const out = []; let pts = 0;
  const ok = (c, good, bad, p) => { out.push({ ok: !!c, text: c ? good : bad }); if (c) pts += p; };
  const t = G.W.t - T_ARRIVEE;
  const has = k => oi.obj.includes(k), im = k => oi.im.includes(k);
  const missions = oi.exe.filter(e => e.mission).map(e => e.mission);
  ok(t <= 600, `Ordre initial donné ${fmtDur(t)} après l'arrivée.`, `Ordre initial tardif : ${fmtDur(t)} après l'arrivée.`, 10);
  ok((oi.S || '').length > 15, 'Situation exprimée.', 'Situation non exprimée (où, quoi, contre quoi).', 8);
  ok((oi.A || '').length > 10, 'Anticipation exprimée.', 'Anticipation absente : que se passe-t-il si je ne fais rien ?', 8);
  ok(has('o_sauver'), 'Objectif de sauvetage retenu : une personne est en danger au R+3.', 'Une personne âgée est en danger au R+3 : le sauvetage devait être un objectif.', 14);
  ok(has('o_occupants'), 'Mise en sécurité des étages supérieurs retenue.', 'Le R+4 est menacé par la cage enfumée : objectif de mise en sécurité oublié.', 10);
  ok(has('o_propag') || has('o_eteindre'), 'Objectif sur le feu retenu.', 'Aucun objectif sur le feu lui-même.', 8);
  ok(has('o_intervenants'), 'Sécurité des intervenants affichée.', 'Sécurité des intervenants non affichée dans les objectifs.', 6);
  // chaque idee de manoeuvre doit avoir des moyens
  const orphans = oi.im.filter(k => { const d = IDEES.find(x => x[0] === k); return !d[2].some(m => missions.includes(m)); });
  ok(oi.im.length && !orphans.length, 'Chaque idée de manœuvre a des moyens dans l\'exécution.', orphans.length ? `Idées de manœuvre sans moyens : ${orphans.map(k => IDEES.find(x => x[0] === k)[1].toLowerCase()).join(' ; ')}.` : 'Aucune idée de manœuvre exprimée.', 12);
  // chaque mission doit servir une idee de manoeuvre
  const loose = oi.exe.filter(e => e.mission && !oi.im.some(k => IDEES.find(x => x[0] === k)[2].includes(e.mission)));
  ok(!loose.length, 'Toutes les missions découlent d\'une idée de manœuvre.', `Missions sans idée de manœuvre correspondante : ${loose.map(e => MISSIONS[e.mission].label.toLowerCase()).join(' ; ')}.`, 8);
  ok(im('im_sauv') && (missions.includes('RECHERCHE') || missions.includes('PA_CH1')), 'Moyens engagés au sauvetage.', 'Aucun moyen engagé sur le sauvetage de la victime.', 10);
  ok(!missions.includes('ATTAQUE') || missions.includes('ALIM') || G.alim, 'Attaque appuyée par une alimentation pérenne.', 'Attaque engagée sur la seule citerne du FPT (6 min à 500 l/min) : alimentation oubliée.', 6);
  const subs = new Set(oi.exe.filter(e => e.mission).map(e => (G.actors.find(a => a.id === e.id) || {}).engin));
  ok(subs.size <= 4, `${subs.size} subordonné(s) direct(s) : règle des 4 respectée.`, `${subs.size} subordonnés directs : au-delà de 4, sectorisez ou demandez un chef de colonne.`, 0);
  ok((oi.C || '').length > 5, 'Commandement précisé.', 'Commandement non précisé (COS, PC, canal).', 0);
  return { pts: Math.min(100, pts), out, t };
}
function modelOI() {
  const K = G.K.facts;
  return {
    S: 'Feu d\'appartement au R+3 d\'un immeuble R+4, séjour embrasé côté rue. Cage d\'escalier enfumée, porte palière restée ouverte. Une personne âgée présumée dans la chambre côté rue, voisin âgé bloqué au R+4.',
    A: 'Si je ne fais rien : propagation au reste de l\'appartement, enfumage de toute la cage, intoxication de la victime et du voisin du R+4, voire propagation au R+4 par la façade.',
    O: 'Sauver la personne du R+3 ; mettre en sécurité les occupants du R+4 ; éviter la propagation par la cage ; éteindre ; assurer la sécurité des intervenants ; prendre en charge les victimes ; pérenniser l\'alimentation.',
    I: 'Recherche et extraction sous protection d\'une LDV ; attaque du foyer par la cage avec maîtrise de la porte palière ; confinement du R+4 ou sauvetage par l\'échelle ; alimentation sur PI ; regroupement des victimes au pied de l\'immeuble.',
    E: 'FPT 1 : BAT attaque LDV 500 et maîtrise de la porte palière, BAL alimentation sur PI puis recherche et extraction en priorité chambre côté rue. PA 18 : mise en station façade, sauvetage ou mise en sécurité du R+4. VSAV 1 : prise en charge des victimes au pied de l\'immeuble.',
    C: 'COS : chef de groupe, VLCG au pied de l\'immeuble. Comptes rendus par les chefs d\'agrès sur le canal opérationnel.',
    L: 'Point de regroupement des victimes au pied de l\'immeuble, demande de SMUR, 1 FPT en renfort.',
  };
}

// ===========================================================================
// SITAC DU JOUEUR (dessinee avec les symboles conventionnels)
// ===========================================================================
function sitacAdd(el) { el.t = G.W.t; G.sitacUser.push(el); G.dirty = true; }
function sitacRemoveNear(x, y) {
  let best = -1, bd = 1.2;
  G.sitacUser.forEach((e, i) => { const d = Math.hypot((e.x2 != null ? (e.x + e.x2) / 2 : e.x) - x, (e.y2 != null ? (e.y + e.y2) / 2 : e.y) - y); if (d < bd) { bd = d; best = i; } });
  if (best >= 0) G.sitacUser.splice(best, 1);
}
const RECTS = { SEJ: [0.2, 5.6, 0.2, 4.6], CUI: [5.8, 8.2, 0.2, 4.6], CH1: [8.4, 10.8, 0.2, 4.6], COU: [0.2, 10.8, 4.8, 5.8], CH2: [0.2, 3.8, 6.0, 8.4], SDB: [4.0, 6.0, 6.0, 8.4], CH3: [6.2, 10.8, 6.0, 8.4] };
const inRoom = (x, y, r) => { const R = RECTS[r]; return x >= R[0] - 0.3 && x <= R[1] + 0.3 && y >= R[2] - 0.3 && y <= R[3] + 0.3; };
function evalSitac() {
  const U = G.sitacUser, out = [];
  const ok = (c, good, bad) => out.push({ ok: !!c, text: c ? good : bad });
  if (!U.length) return [{ ok: false, text: 'Aucune SITAC dessinée.' }];
  const end = e => [e.x2 != null ? e.x2 : e.x, e.y2 != null ? e.y2 : e.y];
  ok(U.some(e => e.k === 'feu' && inRoom(e.x, e.y, 'SEJ')), 'Foyer placé au séjour.', 'Le foyer (séjour) n\'est pas représenté au bon endroit.');
  ok(U.some(e => e.k === 'victime' && inRoom(e.x, e.y, 'CH1')), 'Victime représentée dans la chambre côté rue.', 'La victime de la chambre côté rue n\'est pas représentée.');
  ok(U.some(e => e.k === 'attaque' && inRoom(...end(e), 'SEJ')), 'Action d\'attaque dirigée vers le foyer.', 'Pas d\'action d\'attaque dirigée vers le foyer.');
  ok(U.some(e => e.k === 'sauvetage'), 'Action de sauvetage représentée.', 'Pas d\'action de sauvetage représentée.');
  ok(U.some(e => e.k === 'eau'), 'Établissement ou alimentation en eau représenté.', 'Alimentation en eau non représentée.');
  ok(U.some(e => (e.k === 'fumee' || e.k === 'danger') && e.x < 0.3), 'Enfumage ou danger de la cage représenté.', 'L\'enfumage de la cage d\'escalier n\'est pas représenté.');
  ok(U.some(e => e.k === 'moyen'), 'Moyens représentés.', 'Aucun moyen représenté.');
  return out;
}

window.GAME = { newGame, tick, order, availableMissions, MISSIONS, sendMessage, gauges, endGame, debriefData, clock, hhmm, fmtDur,
  know, vState, startRT, giveOI, OBJECTIFS, IDEES, sitacAdd, sitacRemoveNear, evalSitac, ask, observe, availableQuestions, witnessDef, WITNESSES, FIRE_STATES, modelMessage, MISSIONS_LIST: null, snapshotRoom, roomReportText, isOpen, locName, zoneOf, ROOMS, ROOM_NAMES, LEVELS, LEVEL_NAMES, T_ARRIVEE, RENFORTS, radio };
})();
