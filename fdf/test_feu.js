// Essai de propagation sur la carte reelle : node fdf/test_feu.js [vent m/s] [dir deg] [minutes] [x] [y]
const fs = require('fs'), zlib = require('zlib'), FEU = require('../src/fdf/feu.js');
const meta = JSON.parse(fs.readFileSync('data/fdf/salles/carte.json'));
const raw = zlib.gunzipSync(fs.readFileSync('data/fdf/salles/raster.bin.gz')), N = meta.w * meta.h;
const carte = { w: meta.w, h: meta.h, res: meta.res, fuel: raw.subarray(0, N), haut: raw.subarray(N, 2 * N), alt: raw.subarray(2 * N, 3 * N) };
const [v, dir, mins, x, y] = process.argv.slice(2).map(Number);
const F = new FEU.Feu(carte, { vent: v || 7, dir: dir || 225, secheresse: 'forte', graine: 3 });
F.allume(x || 6000, y || 4000, 0);
const t0 = Date.now();
for (let m = 10; m <= (mins || 60); m += 10) { F.avance(m * 60); const b = F.bilan(); console.log(`t=${m} min  ${b.ha.toFixed(1)} ha  front ${b.front} m  Imax ${Math.round(b.Imax)} kW/m  emprise ${Math.round(b.emprise[2] - b.emprise[0])} x ${Math.round(b.emprise[3] - b.emprise[1])} m  sautes ${F.spots.length}`); }
console.log('calcul', Date.now() - t0, 'ms');
// image
const { createCanvas } = (() => { try { return require('canvas'); } catch (e) { return {}; } })();
const out = new Uint8Array(N); for (let i = 0; i < N; i++) out[i] = F.etat(i) === 1 ? 1 : F.etat(i) === 2 ? 2 : 0;
fs.writeFileSync('/tmp/claude-0/-home-claude/11b3bce1-fe7a-55d4-a347-171b30f62ab8/scratchpad/feu_etat.bin', out);
