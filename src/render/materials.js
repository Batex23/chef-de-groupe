// =============================================================================
// Matériaux PBR procéduraux : couleur, relief (normal map) et rugosité générés
// par le code. Aucune image externe, donc aucun souci de droits.
// Chaque texture est définie pour une taille réelle (en mètres) : les UV des
// géométries sont exprimées en mètres et la répétition vaut 1 / taille.
// Pour remplacer par des textures photo (Poly Haven, ambientCG), voir
// assets/textures/README.md.
// =============================================================================
import * as THREE from 'three';

let RES = 512;
export function setTextureResolution(r) { RES = r; }

// ---------------------------------------------------------------- bruit
function hash(x, y, s) { let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967295; }
function vnoise(x, y, s, per) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const w = (a) => ((a % per) + per) % per;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(w(xi), w(yi), s), b = hash(w(xi + 1), w(yi), s), c = hash(w(xi), w(yi + 1), s), d = hash(w(xi + 1), w(yi + 1), s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
// fBm périodique (la texture se répète sans couture)
function fbm(x, y, oct, base, seed) {
  let s = 0, a = 0.5, f = base;
  for (let i = 0; i < oct; i++) { s += a * vnoise(x * f, y * f, seed + i * 17, f); f *= 2; a *= 0.5; }
  return s;
}

// ---------------------------------------------------------------- outils canvas
function field(fn) {
  const n = RES, h = new Float32Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) h[y * n + x] = fn(x / n, y / n);
  return h;
}
function toTexture(n, fill, srgb) {
  const c = document.createElement('canvas'); c.width = c.height = n;
  const ctx = c.getContext('2d'); const img = ctx.createImageData(n, n);
  for (let i = 0; i < n * n; i++) { const [r, g, b] = fill(i); img.data[i * 4] = r; img.data[i * 4 + 1] = g; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = 255; }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  return t;
}
function normalFrom(h, strength) {
  const n = RES;
  return toTexture(n, i => {
    const x = i % n, y = (i / n) | 0;
    const l = h[y * n + ((x - 1 + n) % n)], r = h[y * n + ((x + 1) % n)], u = h[((y - 1 + n) % n) * n + x], d = h[((y + 1) % n) * n + x];
    let nx = (l - r) * strength, ny = (d - u) * strength, nz = 1;
    const k = 1 / Math.hypot(nx, ny, nz);
    return [(nx * k * 0.5 + 0.5) * 255, (ny * k * 0.5 + 0.5) * 255, (nz * k * 0.5 + 0.5) * 255];
  }, false);
}
const hex = c => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// ---------------------------------------------------------------- recettes
const RECIPES = {
  // Crépi gratté des immeubles des années 60-70
  plaster: { size: 2.0, build() {
    const h = field((u, v) => fbm(u, v, 5, 32, 1) * 0.7 + fbm(u, v, 3, 4, 9) * 0.3);
    const stain = field((u, v) => fbm(u, v, 4, 2, 31));
    const c1 = hex('#b5a791'), c2 = hex('#8f846f'), c3 = hex('#c6baa5');
    const map = toTexture(RES, i => { const s = stain[i]; let c = mixc(c1, c2, Math.max(0, s - 0.45) * 1.6); c = mixc(c, c3, Math.max(0, 0.42 - s) * 1.5); const g = (h[i] - 0.5) * 30; return [c[0] + g, c[1] + g, c[2] + g]; }, true);
    return { map, normalMap: normalFrom(h, 9), roughnessMap: toTexture(RES, i => { const r = 215 + (h[i] - 0.5) * 50; return [r, r, r]; }), normalScale: 1.0 };
  } },
  // Béton des dalles, bandeaux et balcons
  concrete: { size: 1.5, build() {
    const h = field((u, v) => fbm(u, v, 5, 16, 3) * 0.6 + (hash((u * 300) | 0, (v * 300) | 0, 5) > 0.985 ? -0.5 : 0));
    const s = field((u, v) => fbm(u, v, 3, 3, 41));
    const c1 = hex('#a39d92'), c2 = hex('#7e796f');
    return { map: toTexture(RES, i => { const c = mixc(c1, c2, s[i] * 0.8); const g = (h[i] - 0.4) * 22; return [c[0] + g, c[1] + g, c[2] + g]; }, true), normalMap: normalFrom(h, 5), roughnessMap: toTexture(RES, i => { const r = 200 + s[i] * 40; return [r, r, r]; }) };
  } },
  // Soubassement en pierre agrafée (RDC)
  stone: { size: 2.4, build() {
    const rows = 4, cols = 3;
    const h = field((u, v) => { const r = Math.floor(v * rows), off = r % 2 ? 0.5 / cols : 0; const uu = (u + off) % 1; const cx = (uu * cols) % 1, cy = (v * rows) % 1; const j = Math.min(cx, 1 - cx, cy * (cols / rows), (1 - cy) * (cols / rows)); return (j < 0.012 ? 0.0 : 0.7) + fbm(u, v, 4, 16, 7) * 0.3; });
    const tone = field((u, v) => { const r = Math.floor(v * rows), off = r % 2 ? 0.5 / cols : 0; const ci = Math.floor(((u + off) % 1) * cols); return hash(ci, r, 77); });
    const c1 = hex('#9b9283'), c2 = hex('#7f776a');
    return { map: toTexture(RES, i => { const c = mixc(c1, c2, tone[i]); const k = h[i] < 0.3 ? -45 : (h[i] - 0.8) * 30; return [c[0] + k, c[1] + k, c[2] + k]; }, true), normalMap: normalFrom(h, 6), roughnessMap: toTexture(RES, i => [225, 225, 225]) };
  } },
  // Brique (immeubles voisins)
  brick: { size: 1.2, build() {
    const rows = 16, cols = 5;
    const h = field((u, v) => { const r = Math.floor(v * rows), off = r % 2 ? 0.5 / cols : 0; const cx = (((u + off) % 1) * cols) % 1, cy = (v * rows) % 1; return (cx < 0.04 || cy < 0.12 ? 0.1 : 0.75) + fbm(u, v, 3, 32, 2) * 0.25; });
    const tone = field((u, v) => { const r = Math.floor(v * rows), off = r % 2 ? 0.5 / cols : 0; return hash(Math.floor(((u + off) % 1) * cols), r, 13); });
    const c1 = hex('#8a4a36'), c2 = hex('#6a3526'), m = hex('#8c8579');
    return { map: toTexture(RES, i => h[i] < 0.4 ? m : mixc(c1, c2, tone[i]).map(x => x + (h[i] - 0.8) * 40), true), normalMap: normalFrom(h, 7), roughnessMap: toTexture(RES, () => [230, 230, 230]) };
  } },
  asphalt: { size: 3.0, build() {
    const h = field((u, v) => fbm(u, v, 6, 32, 11));
    const s = field((u, v) => fbm(u, v, 3, 2, 51));
    const c1 = hex('#34373b'), c2 = hex('#26282b');
    return { map: toTexture(RES, i => { const c = mixc(c1, c2, s[i]); const g = (h[i] - 0.5) * 36 + (hash(i % 997, i % 991, 3) > 0.993 ? 30 : 0); return [c[0] + g, c[1] + g, c[2] + g]; }, true), normalMap: normalFrom(h, 4), roughnessMap: toTexture(RES, i => { const r = 205 + s[i] * 40; return [r, r, r]; }) };
  } },
  pavement: { size: 1.6, build() {
    const g = 4;
    const h = field((u, v) => { const cx = (u * g) % 1, cy = (v * g) % 1; return (cx < 0.025 || cy < 0.025 ? 0.15 : 0.7) + fbm(u, v, 4, 16, 21) * 0.3; });
    const tone = field((u, v) => hash(Math.floor(u * g), Math.floor(v * g), 9));
    const c1 = hex('#7b7972'), c2 = hex('#67655f');
    return { map: toTexture(RES, i => { const c = mixc(c1, c2, tone[i] * 0.7); const k = h[i] < 0.3 ? -30 : (h[i] - 0.8) * 30; return [c[0] + k, c[1] + k, c[2] + k]; }, true), normalMap: normalFrom(h, 5), roughnessMap: toTexture(RES, () => [220, 220, 220]) };
  } },
  gravel: { size: 1.0, build() {
    const h = field((u, v) => Math.pow(fbm(u, v, 4, 48, 33), 1.5));
    return { map: toTexture(RES, i => { const g = 70 + h[i] * 80; return [g, g * 0.98, g * 0.94]; }, true), normalMap: normalFrom(h, 8), roughnessMap: toTexture(RES, () => [240, 240, 240]) };
  } },
  grass: { size: 2.0, build() {
    const h = field((u, v) => fbm(u, v, 6, 32, 61));
    const s = field((u, v) => fbm(u, v, 3, 3, 71));
    const c1 = hex('#2f4a26'), c2 = hex('#46542c');
    return { map: toTexture(RES, i => mixc(c1, c2, s[i]).map(x => x + (h[i] - 0.5) * 40), true), normalMap: normalFrom(h, 6), roughnessMap: toTexture(RES, () => [245, 245, 245]) };
  } },
  parquet: { size: 1.2, build() {
    const rows = 10;
    const h = field((u, v) => { const r = Math.floor(v * rows); const len = 0.33, off = hash(r, 0, 5) * len; const cx = ((u + off) / len) % 1, cy = (v * rows) % 1; return (cx < 0.01 || cy < 0.03 ? 0.2 : 0.7) + fbm(u * 0.2, v * 6, 3, 8, 3) * 0.2; });
    const tone = field((u, v) => hash(Math.floor(v * rows), Math.floor(u * 3), 4));
    const c1 = hex('#8b6544'), c2 = hex('#6f4e33');
    return { map: toTexture(RES, i => mixc(c1, c2, tone[i]).map(x => x + (h[i] - 0.6) * 40), true), normalMap: normalFrom(h, 3), roughnessMap: toTexture(RES, () => [150, 150, 150]) };
  } },
  tiles: { size: 1.2, build() {
    const g = 4;
    const h = field((u, v) => ((u * g) % 1 < 0.03 || (v * g) % 1 < 0.03 ? 0.2 : 0.8));
    return { map: toTexture(RES, i => h[i] < 0.5 ? [120, 118, 112] : [196, 192, 184], true), normalMap: normalFrom(h, 3), roughnessMap: toTexture(RES, i => h[i] < 0.5 ? [230, 230, 230] : [90, 90, 90]) };
  } },
  shutter: { size: 0.6, build() {
    const h = field((u, v) => 0.5 + 0.5 * Math.sin(v * Math.PI * 2 * 12));
    return { map: toTexture(RES, i => { const g = 196 + h[i] * 20; return [g, g * 0.98, g * 0.94]; }, true), normalMap: normalFrom(h, 4), roughnessMap: toTexture(RES, () => [170, 170, 170]) };
  } },
};

const CACHE = {};
// Renvoie un matériau PBR. Les options surchargent celles du MeshStandardMaterial.
export function pbr(name, opts) {
  const key = name + JSON.stringify(opts || {});
  if (CACHE[key]) return CACHE[key];
  const R = RECIPES[name];
  if (!CACHE['_t_' + name]) CACHE['_t_' + name] = R.build();
  const t = CACHE['_t_' + name];
  const rep = 1 / R.size;
  for (const k of ['map', 'normalMap', 'roughnessMap']) t[k].repeat.set(rep, rep);
  const m = new THREE.MeshStandardMaterial(Object.assign({ map: t.map, normalMap: t.normalMap, roughnessMap: t.roughnessMap, roughness: 1, metalness: 0, normalScale: new THREE.Vector2(1, 1) }, opts || {}));
  return (CACHE[key] = m);
}
export function plain(color, opts) {
  const key = 'p' + color + JSON.stringify(opts || {});
  return CACHE[key] || (CACHE[key] = new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.8, metalness: 0 }, opts || {})));
}
// Texture « intérieur de logement » vue à travers une vitre (éclairé ou non)
export function roomCard(lit, seed) {
  const c = document.createElement('canvas'); c.width = 128; c.height = 128; const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, 128);
  if (lit) { g.addColorStop(0, '#f2cf8f'); g.addColorStop(0.7, '#b78a52'); g.addColorStop(1, '#5a4029'); }
  else { g.addColorStop(0, '#1a1d22'); g.addColorStop(1, '#0c0e11'); }
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  // rideaux et silhouettes de mobilier
  const r = (k) => (Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453) % 1;
  x.fillStyle = lit ? 'rgba(120,70,40,0.55)' : 'rgba(40,40,46,0.8)';
  x.fillRect(0, 0, 18 + Math.abs(r(1)) * 20, 128); x.fillRect(110 - Math.abs(r(2)) * 20, 0, 40, 128);
  x.fillStyle = lit ? 'rgba(60,40,25,0.7)' : 'rgba(10,10,12,0.9)';
  x.fillRect(30 + Math.abs(r(3)) * 30, 80, 50, 48);
  if (lit) { const lg = x.createRadialGradient(64, 20, 2, 64, 20, 40); lg.addColorStop(0, 'rgba(255,240,200,0.9)'); lg.addColorStop(1, 'rgba(255,240,200,0)'); x.fillStyle = lg; x.fillRect(0, 0, 128, 70); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
