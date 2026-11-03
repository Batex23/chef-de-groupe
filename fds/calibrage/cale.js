// Recherche des parametres [CAL] du moteur qui reproduisent au mieux un cas FDS.
// Usage : node cale.js <CAS1,CAS2,...> [n_essais]   (fichiers lus dans resultats/<CAS>/)
const fs = require('fs'), path = require('path');
const SIM = require(path.join(__dirname, '../../src/core/sim.js'));
const BASE = Object.assign({}, SIM.CFG);
const [casArg, nArg] = process.argv.slice(2);
const OUV = { R0_BASE: { PALIERE: 600, IMMEUBLE: 540, EXUTOIRE: null }, R1_PORTE_PALIERE_OUVERTE: { PALIERE: 90, IMMEUBLE: 540, EXUTOIRE: null },
  R2_PORTE_OUVERTE_EXUTOIRE: { PALIERE: 90, IMMEUBLE: 540, EXUTOIRE: 660 } };
const csv = f => { const L = fs.readFileSync(f, 'utf8').trim().split('\n'); const h = L[1].split(','); const rows = L.slice(2).map(l => l.split(',').map(Number)); const col = n => rows.map(r => r[h.indexOf(n)]); return { h, rows, col }; };
const TARGETS = [
  ['SEJ', 'T', 1], ['COU', 'T', 1], ['CH2', 'T', 0.7], ['CH1', 'T', 0.4], ['SEJ', 'H', 120], ['COU', 'H', 120], ['CH2', 'H', 60],
  ['CAGE_R3', 'T', 0.8], ['CAGE_R4', 'T', 0.6], ['CAGE_R2', 'T', 0.5], ['CAGE_R4', 'CO', 0.05], ['CAGE_R3', 'CO', 0.05], ['CAGE_R2', 'CO', 0.05],
];
const CASES = casArg.split(',').map(cas => {
  const dir = path.join(__dirname, '../resultats', cas);
  const D = csv(path.join(dir, cas + '_devc_5s.csv')), H = csv(path.join(dir, cas + '_hrr_10s.csv'));
  const ref = {};
  for (const [z, k] of TARGETS) {
    const name = z.startsWith('CAGE') ? `${z}_${k === 'T' ? 'T' : 'CO'}` : `${z}_${k === 'T' ? 'T_COUCHE_HAUTE' : 'HAUTEUR_COUCHE'}`;
    ref[z + k] = D.col(name).map(v => k === 'CO' ? v * 1e6 : v);
  }
  return { cas, ouv: OUV[cas], tF: D.col('Time'), ramp: H.rows.map(r => [r[0], r[1]]), ref };
});
function runCase(C) {
  const W = SIM.createWorld();
  W.fires = [{ zone: 'SEJ', t0: 0, ramp: C.ramp, peak: 4000, energy: 1e9, burned: 0, k: 1, base: 0.4, out: false, kind: 'canape' }];
  for (const id in W.Z) W.Z[id].fuelMJ = 0;
  const O = id => W.O.find(o => o.id === id);
  const out = {}; for (const k in C.ref) out[k] = [];
  let i = 0;
  while (i < C.tF.length) {
    for (const id in C.ouv) if (C.ouv[id] != null && W.t >= C.ouv[id]) O(id).open = true;
    if (W.t >= C.tF[i] - 1e-6) {
      for (const [z, k] of TARGETS) {
        let v;
        if (z.startsWith('CAGE')) { const l = ['RDC', 'R1', 'R2', 'R3', 'R4'].indexOf(z.slice(5)), c = SIM.conditionsAt(W, 'CAGE', l * 2.6 + 1.5); v = k === 'T' ? c.T - 273.15 : c.CO; }
        else v = k === 'T' ? W.Z[z].Tu - 273.15 : SIM.layerRel(W.Z[z]);
        out[z + k].push(v);
      }
      i++;
    }
    SIM.step(W); W.events.length = 0;
  }
  let J = 0;
  for (const [z, k, w] of TARGETS) { const a = C.ref[z + k], b = out[z + k]; let s = 0; for (let j = 0; j < a.length; j++) s += (b[j] - a[j]) ** 2; J += w * Math.sqrt(s / a.length); }
  return J;
}
function run(p) { Object.assign(SIM.CFG, BASE, p); return CASES.reduce((s, C) => s + runCase(C), 0) / CASES.length; }
const SPACE = { radLoss: [0.3, 0.6], hConv: [0.006, 0.03], wallC: [40, 160], entK: [0.8, 4], Cd: [0.6, 0.85], leakK: [0.05, 0.8], glassBreakK: [450, 560] };
let best = { J: run({}), p: {} };
console.log('depart', best.J.toFixed(1));
const N = +(nArg || 300);
const rnd = (a, b) => a + Math.random() * (b - a);
for (let n = 0; n < N; n++) {
  const p = {};
  for (const k in SPACE) {
    const [a, b] = SPACE[k];
    p[k] = n < N * 0.4 || !best.p[k] ? rnd(a, b) : Math.min(b, Math.max(a, best.p[k] + (Math.random() - 0.5) * (b - a) * 0.15));
  }
  const J = run(p);
  if (J < best.J) { best = { J, p }; console.log(n, J.toFixed(1), JSON.stringify(Object.fromEntries(Object.entries(p).map(([k, v]) => [k, +v.toFixed(4)])))); }
}
console.log('MEILLEUR', JSON.stringify(Object.fromEntries(Object.entries(best.p).map(([k, v]) => [k, +v.toFixed(4)]))), best.J.toFixed(1));
