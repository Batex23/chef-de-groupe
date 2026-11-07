// ===========================================================================
// MOTEUR FEU PAR ZONES (deux couches par piece) - prototype
// Chaque piece : couche chaude (haut) / couche froide (bas). Echanges par les
// ouvertures (portes, fenetres, exutoire) par difference de masse volumique.
// Les parametres marques [CAL] sont ajustes sur les calculs FDS (fds/calibrage, cas R0 du 02/11/2026).
// ===========================================================================
const CFG = {
  dt: 0.1,            // pas de temps (s)
  Tamb: 293,          // K
  cp: 1.0,            // kJ/kg/K
  g: 9.81,
  Cd: 0.65,            // coefficient de decharge des ouvertures [CAL]
  dHc: 25000,         // kJ/kg chaleur de combustion du mobilier
  EO2: 13100,         // kJ par kg d'O2 consomme
  radLoss: 0.30,      // part de la puissance perdue par rayonnement vers les parois [CAL]
  hConv: 0.019,       // kW/m2/K echange couche chaude-parois [CAL]
  wallC: 112,          // kJ/m2/K inertie de paroi (premiers cm de beton) [CAL]
  yCO: 0.04, yCOsv: 0.20, ySoot: 0.10,   // rendements (sv = sous-ventile)
  Km: 8700,           // m2/kg coefficient d'extinction massique des suies
  glassBreakK: 462,   // 400 degC en partie haute -> bris vitrage (comme les cas FDS)
  flashK: 823,        // 550 degC couche chaude -> embrasement generalise [CAL]
  igniteK: 873,       // 600 degC -> inflammation d'une piece voisine [CAL]
  roomHRRperM2: 250,  // kW/m2 puissance d'une piece embrasee (limitee ensuite par l'air)
  waterEff: 0.35,     // part de l'eau qui vaporise utilement [CAL]
  knockCoef: 0.0035,  // vitesse d'abattement des flammes par l'eau [CAL]
  smoulderKW: 30,     // foyer residuel (braises sous les debris) apres abattement [CAL]
  repriseMin: 360,    // delai mini de reprise d'un foyer residuel non deblaye (s) [CAL]
  repriseVar: 300,    // dispersion du delai de reprise (s) [CAL]
  vppCage: 4.3,       // kg/s extraits de la cage par le VPP (porte d'immeuble ouverte + exutoire) [CAL]
  vppApt: 0.5,        // kg/s extraits du logement (porte paliere + fenetre ouvertes) [CAL]
  flashHold: 45,
  extIgnK: 450,       // temperature de sortie minimale pour que les imbrules brulent en facade (K) [CAL]      // s au-dela du seuil de Thomas avant embrasement generalise [CAL]
  entK: 1.85,          // multiplicateur de l'entrainement d'air du panache (Heskestad) [CAL]
  leakK: 0.43,         // multiplicateur des fuites des ouvrants fermes [CAL]
};
const RHO = T => 353 / T;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function makeZone(id, name, A, H, floor, fuelMJm2) {
  const V = A * H;
  return {
    id, name, A, H, floor, V, per: 4 * Math.sqrt(A),
    Mu: 0.001, Tu: CFG.Tamb, Tw: CFG.Tamb, TL: CFG.Tamb,
    MO2: 0.001 * 0.232, MCO: 0, MSoot: 0, MFuel: 0,
    YO2L: 0.232,
    fuelMJ: A * fuelMJm2, burnedMJ: 0,
    flashed: false, fireQ: 0, extQ: 0,
  };
}

function createWorld() {
  const Z = {};
  const add = z => (Z[z.id] = z);
  const F = 7.8; // plancher du R+3 (m, depuis le RDC)
  add(makeZone('SEJ', 'Sejour', 23.8, 2.6, F, 600));
  add(makeZone('CUI', 'Cuisine', 10.6, 2.6, F, 450));
  add(makeZone('CH1', 'Chambre 1', 10.6, 2.6, F, 600));
  add(makeZone('COU', 'Couloir', 10.6, 2.6, F, 120));
  add(makeZone('CH2', 'Chambre 2', 8.6, 2.6, F, 600));
  add(makeZone('SDB', 'Salle de bains', 4.8, 2.6, F, 80));
  add(makeZone('CH3', 'Chambre 3', 11.0, 2.6, F, 600));
  add(makeZone('CAGE', "Cage d'escalier", 10.8, 13.2, 0, 0));
  // ouvertures : zb/zt en altitude absolue (m) ; leak = largeur equivalente fermee
  const O = [
    { id: 'SEJ_COU', a: 'SEJ', b: 'COU', w: 1.6, zb: F, zt: F + 2.0, open: true, leak: 0 },
    { id: 'CUI_COU', a: 'CUI', b: 'COU', w: 0.8, zb: F, zt: F + 2.0, open: true, leak: 0 },
    { id: 'CH1_COU', a: 'CH1', b: 'COU', w: 0.8, zb: F, zt: F + 2.0, open: false, leak: 0.02, label: 'porte chambre 1' },
    { id: 'CH2_COU', a: 'CH2', b: 'COU', w: 0.8, zb: F, zt: F + 2.0, open: true, leak: 0.012 },
    { id: 'SDB_COU', a: 'SDB', b: 'COU', w: 0.8, zb: F, zt: F + 2.0, open: true, leak: 0.012 },
    { id: 'CH3_COU', a: 'CH3', b: 'COU', w: 0.8, zb: F, zt: F + 2.0, open: false, leak: 0.012, label: 'porte chambre 3' },
    { id: 'PALIERE', a: 'COU', b: 'CAGE', w: 0.8, zb: F, zt: F + 2.0, open: false, leak: 0.01, label: 'porte paliere' },
    { id: 'W_SEJ1', a: 'SEJ', b: 'EXT', w: 1.4, zb: F + 0.8, zt: F + 2.2, open: false, leak: 0.003, glass: true },
    { id: 'W_SEJ2', a: 'SEJ', b: 'EXT', w: 1.4, zb: F + 0.8, zt: F + 2.2, open: false, leak: 0.003, glass: true },
    { id: 'W_CUI', a: 'CUI', b: 'EXT', w: 1.2, zb: F + 1.0, zt: F + 2.2, open: false, leak: 0.003, glass: true },
    { id: 'W_CH1', a: 'CH1', b: 'EXT', w: 1.2, zb: F + 0.8, zt: F + 2.2, open: false, leak: 0.003, glass: true },
    { id: 'W_CH2', a: 'CH2', b: 'EXT', w: 1.4, zb: F + 0.8, zt: F + 2.2, open: false, leak: 0.003, glass: true, rear: true },
    { id: 'W_SDB', a: 'SDB', b: 'EXT', w: 0.8, zb: F + 1.4, zt: F + 2.1, open: false, leak: 0.003, glass: true, rear: true },
    { id: 'W_CH3', a: 'CH3', b: 'EXT', w: 1.6, zb: F + 0.8, zt: F + 2.2, open: false, leak: 0.003, glass: true, rear: true },
    { id: 'IMMEUBLE', a: 'CAGE', b: 'EXT', w: 1.2, zb: 0, zt: 2.2, open: false, leak: 0.02, label: "porte d'immeuble" },
    { id: 'EXUTOIRE', a: 'CAGE', b: 'EXT', horiz: true, area: 1.0, open: false, label: 'exutoire' },
  ];
  const fires = [
    // canape du sejour : t2 rapide, pic 3 MW, ~ 500 MJ
    { zone: 'SEJ', t0: 0, alpha: 0.047, peak: 3000, energy: 1200, burned: 0, k: 1, base: 0.4, out: false, kind: 'canape' },
  ];
  // foyers caches (doublages, cloisons, faux plafonds) : invisibles a l'oeil, detectables a la camera thermique
  const pockets = { SEJ: ['CUI', 'la cloison séjour / cuisine'], CUI: ['CH1', 'la cloison cuisine / chambre 1'], COU: ['COU', 'le faux plafond du couloir'],
    CH1: ['CH1', 'le doublage de la façade'], CH2: ['COU', 'le faux plafond du couloir'], CH3: ['CH3', 'le doublage de la façade'], SDB: ['COU', 'la gaine technique'] };
  return { t: 0, Z, O, fires, smoulder: [], pockets, vpp: false, events: [], log: [], flags: {}, water: {}, ext: {} };
}

// interface de couche (altitude absolue)
function ifcAbs(z) { return z.floor + layerRel(z); }
function layerRel(z) {
  const Vu = z.Mu * z.Tu / 353;
  return clamp(z.H - Vu / z.A, 0, z.H);
}
function tempAt(W, zid, zabs) {
  if (zid === 'EXT') return CFG.Tamb;
  const z = W.Z[zid];
  return zabs >= ifcAbs(z) ? z.Tu : z.TL;
}
function visibilityU(z) {
  const Vu = Math.max(z.Mu * z.Tu / 353, 1e-6);
  const K = CFG.Km * z.MSoot / Vu;
  return clamp(3 / Math.max(K, 1e-4), 0, 30);
}
// conditions a une hauteur donnee (relative au plancher de la zone)
// Stratification de la cage (zone unique) : sous le niveau sinistre, les fumees
// se refroidissent et se diluent en descendant. Profil provisoire [CAL : arbre FDS].
function cageFactor(h) { return clamp(0.3 + 0.7 * h / 9.0, 0.3, 1); }
function conditionsAt(W, zid, hrel) {
  if (zid === 'CAGE') {
    const c = conditionsAtRaw(W, zid, hrel), k = cageFactor(hrel);
    if (k < 1 && c.smoke) { c.T = CFG.Tamb + (c.T - CFG.Tamb) * k; c.CO *= k; c.O2 = 20.9 - (20.9 - c.O2) * k; c.vis = Math.min(30, c.vis / k); }
    return c;
  }
  return conditionsAtRaw(W, zid, hrel);
}
function conditionsAtRaw(W, zid, hrel) {
  const z = W.Z[zid];
  const inUpper = hrel >= layerRel(z);
  const Mu = Math.max(z.Mu, 1e-6);
  const YO2u = z.MO2 / Mu, YCOu = z.MCO / Mu;
  if (inUpper) return { T: z.Tu, O2: YO2u * 0.906 * 100, CO: YCOu * 1.035e6, vis: visibilityU(z), smoke: true };
  // couche basse : une fraction des produits y diffuse quand la couche est basse
  const f = clamp(1 - (layerRel(z) - hrel) / 1.0, 0, 1) * 0.25;
  return { T: z.TL, O2: z.YO2L * 0.906 * 100, CO: YCOu * 1.035e6 * f, vis: f > 0.05 ? clamp(visibilityU(z) / f, 0, 30) : 30, smoke: f > 0.05 };
}

function fireHRRpotential(f, t) {
  if (f.out) return 0;
  let q;
  if (f.ramp) {   // puissance imposee [[t, kW], ...] (calibrage sur les cas FDS)
    const R = f.ramp; let i = 0; while (i < R.length - 1 && R[i + 1][0] < t) i++;
    const [t0, q0] = R[i], [t1, q1] = R[Math.min(i + 1, R.length - 1)];
    return (t1 > t0 ? q0 + (q1 - q0) * clamp((t - t0) / (t1 - t0), 0, 1) : q0) * f.k;
  }
  if (f.kind === 'piece') q = f.peak * clamp((t - f.t0) / 60, 0, 1);  // montee en 1 min
  else q = Math.min(f.peak, f.alpha * Math.pow(Math.max(0, t - f.t0), 2));
  const rem = f.energy - f.burned;
  if (rem < f.energy * 0.2) q *= clamp(rem / (f.energy * 0.2), 0, 1); // declin
  return q * f.k;
}

function step(W) {
  const dt = CFG.dt, Z = W.Z, Ta = CFG.Tamb;
  const acc = {};
  W.ext = {};
  for (const id in Z) acc[id] = { mIn: 0, eIn: 0, mOut: 0, O2: 0, CO: 0, So: 0, Fu: 0, coldIn: 0, coldO2: 0 };
  for (const id in Z) Z[id].extQ = 0;

  // ---- 1. echanges par les ouvertures
  for (const o of W.O) {
    const A = Z[o.a], B = o.b === 'EXT' ? null : Z[o.b];
    if (o.horiz) { // exutoire en toiture
      if (!o.open) continue;
      const depth = A.H - layerRel(A);
      if (depth <= 0.05 || A.Tu <= Ta + 2) continue;
      const imm = W.O.find(x => x.id === 'IMMEUBLE');
      const makeup = imm && imm.open ? 1 : 0.35; // sans amenee d'air basse, peu d'efficacite
      let m = CFG.Cd * o.area * Math.sqrt(2 * CFG.g * RHO(A.Tu) * (RHO(Ta) - RHO(A.Tu)) * depth) * makeup;
      transfer(A, null, m, o);
      continue;
    }
    const w = o.open ? o.w : o.leak * CFG.leakK;
    if (w <= 0) continue;
    for (const [src, dst] of [[A, B], [B, A]]) {
      if (!src) continue;
      const bottom = Math.max(o.zb, ifcAbs(src));
      const depth = o.zt - bottom;
      if (depth <= 0.01) continue;
      const Tdst = tempAt(W, dst ? dst.id : 'EXT', (bottom + o.zt) / 2);
      if (src.Tu <= Tdst + 1) continue;
      const rh = RHO(src.Tu), rc = RHO(Tdst);
      const m = (2 / 3) * CFG.Cd * w * Math.sqrt(2 * CFG.g * rh * (rc - rh)) * Math.pow(depth, 1.5);
      transfer(src, dst, m, o);
    }
  }
  function transfer(src, dst, m, o) {
    m = Math.min(m, 0.25 * src.Mu / dt);
    if (m <= 0) return;
    const Mu = Math.max(src.Mu, 1e-6), a = acc[src.id];
    const fr = m / Mu;
    a.mOut += m;
    const pkt = { m, e: m * CFG.cp * src.Tu, O2: src.MO2 * fr, CO: src.MCO * fr, So: src.MSoot * fr, Fu: src.MFuel * fr };
    a.O2 -= pkt.O2; a.CO -= pkt.CO; a.So -= pkt.So; a.Fu -= pkt.Fu; a.eIn -= pkt.e;
    // air frais en contre-courant vers la couche basse de la source
    const coldO2 = dst ? (ifcAbs(dst) > o.zb + 0.1 ? dst.YO2L : dst.MO2 / Math.max(dst.Mu, 1e-6)) : 0.232;
    a.coldIn += m; a.coldO2 += m * coldO2;
    if (dst && src.Tu >= dst.Tu - 40) {
      const d = acc[dst.id];
      d.mIn += pkt.m; d.eIn += pkt.e; d.O2 += pkt.O2; d.CO += pkt.CO; d.So += pkt.So; d.Fu += pkt.Fu;
    } else if (dst) {
      // gaz plus frais que la couche chaude de destination : il rejoint la couche basse
      const d = acc[dst.id];
      d.coldIn += pkt.m; d.coldO2 += pkt.O2;
      d.CO += pkt.CO * 0.5; d.So += pkt.So * 0.5;
    } else {
      // sortie a l'exterieur : les imbrules brulent en facade (flammes visibles)
      // les imbrules ne s'enflamment dehors que s'ils sortent chauds (sinon : fumee epaisse sans flamme)
      const fq = src.Tu > CFG.extIgnK ? (pkt.Fu / dt) * CFG.dHc : 0;
      src.extQ += fq;
      W.ext[o.id] = { soot: pkt.So / dt, fuelQ: fq, m };
    }
  }

  // ---- 2. foyers
  for (const id in Z) Z[id].fireQ = 0;
  for (const f of W.fires) {
    if (f.out) continue;
    const z = Z[f.zone], a = acc[z.id];
    const Qpot = fireHRRpotential(f, W.t);
    if (Qpot <= 0.5) { if (f.k < 0.03) f.out = true; continue; }
    const zr = layerRel(z);
    let mEnt, YO2e;
    const Qc = Math.max(1, (1 - CFG.radLoss) * Math.max(f.lastQ || 50, 20));
    if (zr > f.base + 0.05) {
      const h = zr - f.base;
      mEnt = CFG.entK * (0.071 * Math.cbrt(Qc) * Math.pow(h, 5 / 3) + 0.0018 * Qc);
      YO2e = z.YO2L;
    } else {
      mEnt = CFG.entK * (0.071 * Math.cbrt(Qc) * Math.pow(0.6, 5 / 3) + 0.0018 * Qc);
      YO2e = z.MO2 / Math.max(z.Mu, 1e-6);
    }
    const eff = clamp((YO2e - 0.10) / 0.06, 0, 1);
    const pyro = Qpot * (0.25 + 0.75 * eff);                 // la pyrolyse ralentit sans flamme
    const Qox = CFG.EO2 * mEnt * Math.max(0, YO2e - 0.06);
    const Q = Math.min(pyro * eff, Qox);
    const svr = pyro > 0 ? 1 - Q / pyro : 0;                   // part sous-ventilee
    f.lastQ = Q; z.fireQ += Q;
    f.burned += pyro * dt / 1000;
    z.burnedMJ += pyro * dt / 1000;
    const mf = pyro / CFG.dHc, mb = Q / CFG.dHc;
    a.mIn += mEnt + mf;
    a.eIn += (1 - CFG.radLoss) * Q + mEnt * CFG.cp * z.TL;
    a.O2 += mEnt * YO2e - Q / CFG.EO2;
    a.CO += mb * (CFG.yCO + CFG.yCOsv * svr);
    a.So += mb * CFG.ySoot;
    a.Fu += (pyro - Q) / CFG.dHc;
    if (f.energy - f.burned <= 0) f.out = true;
  }

  // ---- 2b. foyers residuels (braises, debris) : chaleur faible, CO et suies
  for (const sm of W.smoulder) {
    if (sm.done) continue;
    const z = Z[sm.zone], a = acc[z.id], q = CFG.smoulderKW * (0.6 + 0.4 * Math.sin(W.t / 23 + sm.seed * 6));
    const mf = q / CFG.dHc;
    a.mIn += mf * 4; a.eIn += q * 0.7 + mf * 3 * CFG.cp * z.Tu;
    a.CO += mf * 0.35; a.So += mf * 0.12;
    if ((W.water[sm.zone] || 0) > 0 && (sm.visible || sm.found)) sm.lastWater = W.t;  // l'arrosage retarde la reprise ; il n'atteint pas un foyer cache
    const O2ok = z.YO2L > (sm.visible ? 0.15 : 0.12);   // un foyer cache couve dans la paroi et perce plus tard
    if (O2ok && W.t - sm.lastWater > sm.delay && sm.mj > 40) {
      sm.done = true; sm.reprise = true;
      W.fires.push({ zone: sm.zone, t0: W.t, alpha: 0.02, peak: Math.min(1800, 110 * z.A), energy: sm.mj, burned: 0, k: 1, base: 0.3, out: false, kind: 'reprise' });
      W.events.push({ t: W.t, type: 'reprise', id: sm.zone });
    }
  }
  // ---- 2c. ventilation operationnelle (VPP) : extraction de la couche chaude
  if (W.vpp) {
    const imm = W.O.find(o => o.id === 'IMMEUBLE'), exu = W.O.find(o => o.id === 'EXUTOIRE'), pal = W.O.find(o => o.id === 'PALIERE');
    if (imm.open && exu.open) purge(Z.CAGE, CFG.vppCage);
    const winOpen = W.O.some(o => o.b === 'EXT' && o.glass && o.open && !o.rear) || W.O.some(o => o.b === 'EXT' && o.glass && o.open && o.rear);
    if (imm.open && pal.open && winOpen) {
      const rooms = ['COU', ...W.O.filter(o => o.b === 'COU' && o.open && Z[o.a]).map(o => o.a)];
      for (const r of rooms) purge(Z[r], CFG.vppApt / rooms.length * 2);
    }
  }
  function purge(z, m) {
    const k = clamp(m * dt / Math.max(z.Mu, 1e-6), 0, 0.2);
    z.Mu *= 1 - k; z.MO2 *= 1 - k; z.MCO *= 1 - k; z.MSoot *= 1 - k; z.MFuel *= 1 - k;
    z.Tu += (Ta - z.Tu) * Math.min(0.2, 0.004 * dt * m);
    z.YO2L += (0.232 - z.YO2L) * Math.min(1, 0.05 * dt);
  }

  // ---- 3. bilan par zone
  for (const id in Z) {
    const z = Z[id], a = acc[id];
    let E = z.Mu * CFG.cp * z.Tu + a.eIn * dt;
    z.Mu += (a.mIn - a.mOut) * dt;
    z.MO2 += a.O2 * dt; z.MCO += a.CO * dt; z.MSoot += a.So * dt; z.MFuel += a.Fu * dt;
    // combustion des imbrules dans la couche chaude (s'il reste de l'O2 et que c'est chaud)
    const Mu0 = Math.max(z.Mu, 1e-6);
    if (z.MFuel > 1e-5 && z.Tu > 600) {
      const O2av = Math.max(0, z.MO2 - 0.08 * Mu0);
      const r = Math.min(z.MFuel * 0.5, (O2av / 1.91) * 0.5) * dt;
      if (r > 0) { z.MFuel -= r; z.MO2 -= r * 1.91; E += r * CFG.dHc * (1 - CFG.radLoss); z.fireQ += r * CFG.dHc / dt; }
    }
    // pertes aux parois
    const depth = z.H - layerRel(z);
    const Aw = z.A + z.per * depth;
    const qc = CFG.hConv * Aw * (z.Tu - z.Tw) + 5.67e-11 * 0.9 * (Math.pow(z.Tu, 4) - Math.pow(z.Tw, 4)) * z.A * 0.3;
    E -= qc * dt;
    z.Tw += (qc + CFG.radLoss * z.fireQ * (Aw / (Aw + z.A))) * dt / (CFG.wallC * Aw + 1);
    // refroidissement par l'eau
    const wq = W.water[id] || 0; // kW de vaporisation utile
    if (wq > 0) E -= Math.min(wq * 0.5, Math.max(0, E - z.Mu * CFG.cp * Ta)) * dt;
    if (z.Mu < 0.001) { z.Mu = 0.001; z.MO2 = 0.001 * 0.232; z.MCO = 0; z.MSoot = 0; z.MFuel = 0; E = 0.001 * CFG.cp * Ta; }
    z.Tu = clamp(E / (z.Mu * CFG.cp), Ta, 1500);
    // couche pleine : l'exces s'echappe par les defauts d'etancheite
    const Vu = z.Mu * z.Tu / 353;
    if (Vu > 0.995 * z.V) {
      const s = 0.995 * z.V / Vu;
      z.Mu *= s; z.MO2 *= s; z.MCO *= s; z.MSoot *= s; z.MFuel *= s;
    }
    z.MO2 = clamp(z.MO2, 0, z.Mu * 0.232); z.MCO = Math.max(0, z.MCO); z.MSoot = Math.max(0, z.MSoot); z.MFuel = Math.max(0, z.MFuel);
    // couche basse
    const zr = layerRel(z);
    const ML = Math.max((z.V - z.Mu * z.Tu / 353) * RHO(z.TL), 0.5);
    if (a.coldIn > 0) z.YO2L = (z.YO2L * ML + a.coldO2 * dt) / (ML + a.coldIn * dt);
    if (zr < 0.4) z.YO2L += ((z.MO2 / Math.max(z.Mu, 1e-6)) - z.YO2L) * clamp(0.08 * dt, 0, 1);
    z.TL = Ta + (z.Tu - Ta) * 0.12 * clamp(1 - zr / z.H, 0, 1);
  }

  // ---- 4. evenements physiques
  for (const o of W.O) {
    if (o.glass && !o.open && !o.broken && !o.noBreak) {
      const z = Z[o.a];
      if (ifcAbs(z) < o.zt - 0.2 && z.Tu > CFG.glassBreakK) {
        o.open = true; o.broken = true;
        W.events.push({ t: W.t, type: 'vitre', id: o.id });
      }
    }
  }
  for (const f of W.fires) {
    if (f.out || f.kind !== 'canape') continue;
  }
  for (const id in Z) {
    const z = Z[id];
    // Embrasement : couche tres chaude, ou puissance au-dela du seuil de Thomas tenue assez longtemps
    // pour enflammer le mobilier voisin par rayonnement (FDS impose la puissance du canape et ne le
    // predit pas ; le cale sur R0 donne ~300-390 degC sous 3 MW). [CAL : cas de croissance a venir]
    if (hasFire(W, id) && z.fireQ > thomasQ(W, z) && layerRel(z) < 1.5) z.foT = (z.foT || 0) + dt; else z.foT = Math.max(0, (z.foT || 0) - dt);
    if (!z.flashed && z.fuelMJ > 0 && hasFire(W, id) && layerRel(z) < 1.3 &&
        (z.Tu > CFG.flashK || z.foT > CFG.flashHold)) {
      z.flashed = true;
      W.fires.push({ zone: id, t0: W.t, peak: CFG.roomHRRperM2 * z.A, energy: z.fuelMJ, burned: 0, k: 1, base: 0.2, out: false, kind: 'piece' });
      W.events.push({ t: W.t, type: 'embrasement', id });
    } else if (!z.flashed && z.fuelMJ > 0 && !hasFire(W, id) && z.Tu > CFG.igniteK && layerRel(z) < 1.0) {
      z.flashed = true;
      W.fires.push({ zone: id, t0: W.t, peak: CFG.roomHRRperM2 * z.A, energy: z.fuelMJ, burned: 0, k: 1, base: 0.2, out: false, kind: 'piece' });
      W.events.push({ t: W.t, type: 'propagation', id });
    }
  }
  // ---- 5. extinction par l'eau
  for (const f of W.fires) {
    const wq = W.water[f.zone] || 0;
    if (wq > 0 && !f.out) {
      const Qref = Math.max(500, fireHRRpotential({ ...f, k: 1 }, W.t));
      f.k = Math.max(0, f.k - dt * CFG.knockCoef * wq / Qref);
      if (f.k < 0.03) {
        f.out = true; W.events.push({ t: W.t, type: 'eteint', id: f.zone });
        // les flammes sont abattues mais il reste du combustible en braises : foyer residuel a deblayer
        const rem = f.energy - f.burned;
        if (rem > 30) {
          const prev = W.smoulder.find(x => x.zone === f.zone && !x.done);
          const seed = ((f.zone.charCodeAt(0) * 7 + f.zone.charCodeAt(1) * 13 + W.smoulder.length * 5) % 17) / 17;
          const cap = 15 * Z[f.zone].A;   // braises et debris : quelques dizaines de MJ par m2 au plus
          const prev2 = W.smoulder.find(x => x.zone === f.zone && !x.done && x.visible);
          if (prev2) prev2.mj = Math.min(cap, prev2.mj + rem * 0.6);
          else W.smoulder.push({ zone: f.zone, mj: Math.min(cap, rem * 0.6), t: W.t, lastWater: W.t, delay: CFG.repriseMin + seed * CFG.repriseVar, seed, done: false, visible: true, where: 'les débris' });
          // un volume embrase laisse un foyer cache (cloison, doublage, faux plafond)
          const pk = W.pockets && W.pockets[f.zone];
          if (pk && (Z[f.zone].flashed || f.burned > 300) && !W.smoulder.some(x => x.src === f.zone && !x.visible)) {
            W.smoulder.push({ zone: pk[0], src: f.zone, where: pk[1], mj: Math.min(6 * Z[pk[0]].A + 60, rem * 0.25 + 60), t: W.t, lastWater: W.t,
              delay: CFG.repriseMin + 900 + (1 - seed) * CFG.repriseVar, seed: 1 - seed, done: false, visible: false, found: false });
          }
        }
      }
    }
  }
  W.t += dt;
}
// Puissance critique d'embrasement (Thomas) : 7,8 AT + 378 Ao sqrt(Ho)  [kW]
function thomasQ(W, z) {
  const AT = 2 * z.A + z.per * z.H;
  let s = 0;
  for (const o of W.O) {
    if (o.horiz || !o.open || o.b !== 'EXT' || o.a !== z.id) continue;
    const h = o.zt - o.zb; s += o.w * h * Math.sqrt(h);
  }
  return 7.8 * AT + 378 * s;
}
function hasResidual(W, zid, seenOnly) { return W.smoulder.some(s => !s.done && (!zid || s.zone === zid) && (!seenOnly || s.visible || s.found)); }
function hasFire(W, zid) { return W.fires.some(f => f.zone === zid && !f.out); }
function roomOnFire(W, zid) { return W.fires.some(f => f.zone === zid && !f.out && (f.lastQ || 0) > 50); }

// Dose toxique (ISO 13571 simplifie) : renvoie l'increment de FED sur dt
function fedRate(c) {
  let r = c.CO / 35000 / 60;                       // CO : 35 000 ppm.min
  const Tc = c.T - 273;
  if (Tc > 60) {
    const tmin = 2e31 * Math.pow(Tc, -16.963) + 4.1e8 * Math.pow(Tc, -3.7561);
    r += 1 / (tmin * 60);
  }
  if (c.O2 < 15) r += 1 / (60 * Math.exp(8.13 - 0.54 * (20.9 - c.O2)));
  return r;
}

const SIM = { thomasQ, CFG, createWorld, step, layerRel, ifcAbs, conditionsAt, visibilityU, fedRate, hasFire, hasResidual, roomOnFire, clamp };
if (typeof module !== "undefined") module.exports = SIM;
if (typeof window !== "undefined") window.SIM = SIM;
