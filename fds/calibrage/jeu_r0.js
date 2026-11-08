// Fait tourner le moteur feu du jeu dans les conditions d'un cas FDS et ecrit
// les memes grandeurs que les DEVC FDS (CSV), pour comparaison.
// Usage : node jeu_r0.js <cas> <hrr_fds.csv> <sortie.csv> [parametres JSON]
const fs = require('fs'), path = require('path');
const SIM = require(path.join(__dirname, '../../src/core/sim.js'));
const [cas, hrrFile, outFile, pjson] = process.argv.slice(2);
const params = pjson ? JSON.parse(pjson) : {};
Object.assign(SIM.CFG, params);
// conditions des cas (temps en s depuis l'eclosion)
const OUV = {
  R0_BASE: { PALIERE: 600, IMMEUBLE: 540 },
  R1_PORTE_PALIERE_OUVERTE: { PALIERE: 90, IMMEUBLE: 540 },
  R2_PORTE_OUVERTE_EXUTOIRE: { PALIERE: 90, IMMEUBLE: 540, EXUTOIRE: 660 },
  R3_SOUS_VENTILE: { PALIERE: 600, IMMEUBLE: 540, _noGlass: true },
  R4_ATTAQUE: { PALIERE: 600, IMMEUBLE: 540 },
  R5_CHAMBRE1_OUVERTE: { PALIERE: 600, IMMEUBLE: 540, CH1_COU: 0 },
  R6_VPP_APRES_ATTAQUE: { PALIERE: 90, IMMEUBLE: 540, EXUTOIRE: 720, _vpp: 840 },
  R7_VPP_ATTAQUE: { PALIERE: 90, IMMEUBLE: 540, EXUTOIRE: 640, _vpp: 660 },
  R8_VPP_SANS_EXUTOIRE: { PALIERE: 90, IMMEUBLE: 540, _vpp: 840 },
};
// conditions communes : chambre 2 ouverte des le debut, chambres 1 et 3 fermees
function applyOuv(W, ouv) {
  for (const o of W.O) if (o.id === 'CH2_COU') o.open = true;
  for (const id in ouv) {
    if (id === '_noGlass') { for (const o of W.O) if (o.glass) o.noBreak = true; continue; }
    if (id === '_vpp') { if (W.t >= ouv[id]) W.vpp = true; continue; }
    const o = W.O.find(x => x.id === id); if (o && W.t >= ouv[id]) o.open = true;
  }
}
const CAS = OUV[cas];
const W = SIM.createWorld();
// puissance imposee : la HRR mesuree par FDS
const lines = fs.readFileSync(hrrFile, 'utf8').trim().split('\n').slice(2).map(l => l.split(',').map(Number));
const ramp = lines.map(r => [r[0], r[1]]);
W.fires = [{ zone: 'SEJ', t0: 0, ramp, peak: 4000, energy: 1e9, burned: 0, k: 1, base: 0.4, out: false, kind: 'canape' }];
for (const id in W.Z) W.Z[id].fuelMJ = 0;   // pas d'embrasement des autres volumes : FDS impose la puissance
const ROOMS = ['SEJ', 'CUI', 'CH1', 'COU', 'CH2', 'SDB', 'CH3'];
const LV = ['RDC', 'R1', 'R2', 'R3', 'R4'];
const head = ['Time'];
for (const r of ROOMS) head.push(`${r}_HAUTEUR_COUCHE`, `${r}_T_COUCHE_HAUTE`, `${r}_O2_150`, `${r}_CO_150`, `${r}_VISIBILITE_150`);
LV.forEach(l => head.push(`CAGE_${l}_T`, `CAGE_${l}_VISIBILITE`, `CAGE_${l}_CO`));
head.push('CAGE_HAUTEUR_COUCHE', 'HRR', 'BRIS');
const out = [head.join(',')];
const dt = SIM.CFG.dt; let next = 0; const bris = {};
while (W.t <= 1800 + 1e-6) {
  applyOuv(W, CAS);
  SIM.step(W);
  for (const e of W.events) if (e.type === 'vitre') bris[e.id] = W.t;
  W.events.length = 0;
  if (W.t >= next - 1e-9) {
    next += 5;
    const row = [W.t.toFixed(1)];
    for (const r of ROOMS) {
      const z = W.Z[r], c = SIM.conditionsAt(W, r, 1.5);
      row.push(SIM.layerRel(z).toFixed(3), (z.Tu - 273.15).toFixed(1), (c.O2).toFixed(2), (c.CO).toFixed(0), c.vis.toFixed(2));
    }
    LV.forEach((l, i) => { const c = SIM.conditionsAt(W, 'CAGE', i * 2.6 + 1.5); row.push((c.T - 273.15).toFixed(1), c.vis.toFixed(2), c.CO.toFixed(0)); });
    row.push(SIM.layerRel(W.Z.CAGE).toFixed(2), W.Z.SEJ.fireQ.toFixed(0), JSON.stringify(bris).replace(/,/g, ';'));
    out.push(row.join(','));
  }
}
fs.writeFileSync(outFile, out.join('\n'));
