// =============================================================================
// Kit de façade modulaire : murs épais avec embrasures, menuiseries, appuis,
// coffres et volets roulants, balcons, acrotères. Sert à l'immeuble du
// scénario et aux immeubles voisins ; servira à l'éditeur du mode formateur.
// Repère monde : x = x du plan, y = hauteur, z = -y du plan (rue côté z > 0).
// =============================================================================
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { pbr, plain, roomCard } from './materials.js';

export const LV = 2.6;          // hauteur d'étage
export const R3 = 3 * LV;       // plancher du R+3
export const CLIP = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e4); // vue en coupe

// ---------------------------------------------------------------- lots fusionnés
export class Batch {
  constructor() { this.parts = new Map(); }
  add(geom, mat, matrix) {
    const g = geom.index ? geom.toNonIndexed() : geom.clone();
    if (matrix) g.applyMatrix4(matrix);
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!this.parts.has(mat)) this.parts.set(mat, []);
    this.parts.get(mat).push(g);
  }
  flush(parent, shadows) {
    const out = [];
    for (const [mat, list] of this.parts) {
      const m = new THREE.Mesh(mergeGeometries(list, false), mat);
      m.castShadow = m.receiveShadow = !!shadows;
      parent.add(m); out.push(m);
    }
    this.parts.clear();
    return out;
  }
}

// ---------------------------------------------------------------- mur épais
// Mur le long de +x local (0..L), hauteur H, épaisseur T vers -z.
// openings : [x1, x2, y1, y2] ; UV en mètres décalés de (uo, vo).
export function wallGeometry(L, H, T, openings, uo = 0, vo = 0, opts = {}) {
  const P = [], N = [], U = [];
  const quad = (o, u, v, w, h, n, uu, vv) => {
    const c = [o, o.clone().addScaledVector(u, w), o.clone().addScaledVector(u, w).addScaledVector(v, h), o.clone().addScaledVector(v, h)];
    const uvs = [[uu, vv], [uu + w, vv], [uu + w, vv + h], [uu, vv + h]];
    for (const i of [0, 1, 2, 0, 2, 3]) { P.push(c[i].x, c[i].y, c[i].z); N.push(n.x, n.y, n.z); U.push(uvs[i][0], uvs[i][1]); }
  };
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const X = V3(1, 0, 0), Y = V3(0, 1, 0), Z = V3(0, 0, 1);
  const ops = openings.map(o => [Math.max(0, o[0]), Math.min(L, o[1]), Math.max(0, o[2]), Math.min(H, o[3])]);
  const xs = [...new Set([0, L, ...ops.flatMap(o => [o[0], o[1]])])].sort((a, b) => a - b);
  const faceRects = [];
  for (let i = 0; i < xs.length - 1; i++) {
    const a = xs[i], b = xs[i + 1]; if (b - a < 1e-4) continue;
    const cov = ops.filter(o => o[0] <= a + 1e-6 && o[1] >= b - 1e-6).map(o => [o[2], o[3]]).sort((p, q) => p[0] - q[0]);
    let y = 0;
    for (const [y1, y2] of cov) { if (y1 > y) faceRects.push([a, b, y, y1]); y = Math.max(y, y2); }
    if (y < H) faceRects.push([a, b, y, H]);
  }
  for (const [a, b, c, d] of faceRects) {
    if (!opts.noFront) quad(V3(a, c, 0), X, Y, b - a, d - c, Z, a + uo, c + vo);
    if (!opts.noBack) quad(V3(b, c, -T), V3(-1, 0, 0), Y, b - a, d - c, V3(0, 0, -1), L - b + uo, c + vo);
  }
  for (const [x1, x2, y1, y2] of ops) {
    quad(V3(x1, y1, 0), V3(0, 0, -1), Y, T, y2 - y1, X, 0, y1 + vo);                 // tableau gauche
    quad(V3(x2, y1, -T), Z, Y, T, y2 - y1, V3(-1, 0, 0), 0, y1 + vo);                 // tableau droit
    if (y2 < H - 1e-4) quad(V3(x1, y2, -T), X, Z, x2 - x1, T, V3(0, -1, 0), x1 + uo, 0); // linteau
    if (y1 > 1e-4) quad(V3(x1, y1, 0), X, V3(0, 0, -1), x2 - x1, T, Y, x1 + uo, 0);     // appui
  }
  if (!opts.noTop) quad(V3(0, H, 0), X, V3(0, 0, -1), L, T, Y, uo, 0);
  if (!opts.noEnds) { quad(V3(0, 0, -T), Z, Y, T, H, V3(-1, 0, 0), 0, vo); quad(V3(L, 0, 0), V3(0, 0, -1), Y, T, H, X, 0, vo); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  return g;
}
// matrice de pose d'un mur : origine (x, y, z) monde, rotation autour de y
export function wallMatrix(x, y, z, rot) {
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot), new THREE.Vector3(1, 1, 1));
}

// ---------------------------------------------------------------- menuiserie
const _box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const _m = (x, y, z) => new THREE.Matrix4().makeTranslation(x, y, z);
const CARDS = [];
function cardMat(lit, k) {
  const key = (lit ? 'L' : 'D') + (k % 3);
  if (!CARDS[key]) CARDS[key] = new THREE.MeshBasicMaterial({ map: roomCard(lit, k % 3 + (lit ? 0 : 10)), toneMapped: true, color: lit ? '#ffffff' : '#9aa0aa' });
  return CARDS[key];
}
// Ajoute une fenêtre complète dans l'ouverture [x1,x2,y1,y2] d'un mur (repère local du mur, épaisseur T).
// opts : lit (pièce éclairée), shutter (fermeture 0..1), card (intérieur simulé), glass (matériau propre), setback
export function windowKit(batch, M, o, T, opts = {}) {
  const [x1, x2, y1, y2] = o, w = x2 - x1, h = y2 - y1, cx = (x1 + x2) / 2;
  const sb = opts.setback != null ? opts.setback : 0.11;               // retrait de la menuiserie
  const fz = -sb, f = 0.065, d = 0.07;
  const pvc = plain('#eeece6', { roughness: 0.45 });
  const add = (g, mat, m) => batch.add(g, mat, new THREE.Matrix4().multiplyMatrices(M, m));
  add(_box(w, f, d), pvc, _m(cx, y2 - f / 2, fz));
  add(_box(w, f, d), pvc, _m(cx, y1 + f / 2, fz));
  add(_box(f, h, d), pvc, _m(x1 + f / 2, (y1 + y2) / 2, fz));
  add(_box(f, h, d), pvc, _m(x2 - f / 2, (y1 + y2) / 2, fz));
  if (w > 0.9 && !opts.door) add(_box(0.06, h - 2 * f, d), pvc, _m(cx, (y1 + y2) / 2, fz));
  // appui saillant avec goutte d'eau
  if (!opts.door) add(new RoundedBoxGeometry(w + 0.16, 0.06, 0.24, 2, 0.015), pbr('concrete'), _m(cx, y1 - 0.02, 0.05));
  // coffre de volet roulant dans le linteau
  add(_box(w, 0.2, T - sb - 0.02), plain('#dedad2', { roughness: 0.6 }), _m(cx, y2 - 0.1, fz - (T - sb) / 2 + 0.02));
  // volet roulant partiellement baissé
  const sh = opts.shutter || 0;
  if (sh > 0.02) {
    const sg = new THREE.PlaneGeometry(w - 0.02, h * sh);
    const uv = sg.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (w - 0.02), uv.getY(i) * h * sh);
    add(sg, pbr('shutter'), _m(cx, y2 - 0.2 - h * sh / 2 + 0.1, fz + d / 2 + 0.015));
  }
  // intérieur simulé (carte au fond de la pièce)
  if (opts.card !== false) {
    const cm = cardMat(!!opts.lit, opts.seed || 0);
    add(new THREE.PlaneGeometry(w + 1.2, h + 0.9), cm, _m(cx, (y1 + y2) / 2 + 0.1, fz - 1.1));
  }
  // vitrage
  const glass = opts.glass || plain('#1a2430', { roughness: 0.04, metalness: 0.1, transparent: true, opacity: opts.card === false ? 0.85 : 0.32, envMapIntensity: 1.6 });
  const gl = new THREE.PlaneGeometry(w - 2 * f, h - 2 * f);
  if (opts.glass) return { glassGeo: gl, matrix: new THREE.Matrix4().multiplyMatrices(M, _m(cx, (y1 + y2) / 2, fz)) };
  add(gl, glass, _m(cx, (y1 + y2) / 2, fz));
  return null;
}

// ---------------------------------------------------------------- balcon
export function balcony(batch, x1, x2, y, z0, depth, metal) {
  const w = x2 - x1, cx = (x1 + x2) / 2;
  batch.add(new RoundedBoxGeometry(w, 0.16, depth, 2, 0.03), pbr('concrete'), _m(cx, y - 0.08, z0 + depth / 2));
  const rail = metal || plain('#2c3036', { metalness: 0.7, roughness: 0.4 });
  batch.add(_box(w, 0.05, 0.05), rail, _m(cx, y + 1.0, z0 + depth - 0.03));
  batch.add(_box(w, 0.04, 0.04), rail, _m(cx, y + 0.12, z0 + depth - 0.03));
  for (const sx of [x1 + 0.03, x2 - 0.03]) { batch.add(_box(0.05, 1.0, depth), rail, _m(sx, y + 0.5, z0 + depth / 2)); }
  for (let x = x1 + 0.12; x < x2 - 0.08; x += 0.12) batch.add(_box(0.022, 0.88, 0.022), rail, _m(x, y + 0.56, z0 + depth - 0.03));
  for (let z = z0 + 0.12; z < z0 + depth - 0.08; z += 0.12) for (const sx of [x1 + 0.03, x2 - 0.03]) batch.add(_box(0.022, 0.88, 0.022), rail, _m(sx, y + 0.56, z));
}

// ---------------------------------------------------------------- immeuble générique (voisins)
export function genericBuilding(parent, o) {
  // o : { x, z, w, d, levels, mat, bays, seed, roofMat }
  const b = new Batch(), H = o.levels * LV, mat = pbr(o.mat || 'plaster');
  const rnd = k => Math.abs(Math.sin((o.seed || 1) * 91.7 + k * 12.31) * 43758.5) % 1;
  const sides = [
    { L: o.w, M: wallMatrix(o.x, 0, o.z, 0) },
    { L: o.d, M: wallMatrix(o.x + o.w, 0, o.z, Math.PI / 2) },
    { L: o.w, M: wallMatrix(o.x + o.w, 0, o.z - o.d, Math.PI) },
    { L: o.d, M: wallMatrix(o.x, 0, o.z - o.d, -Math.PI / 2) },
  ];
  sides.forEach((s, si) => {
    const n = Math.max(1, Math.floor(s.L / (o.bay || 3.0)));
    const ops = [];
    for (let L = 0; L < o.levels; L++) for (let i = 0; i < n; i++) {
      const cx = (i + 0.5) * s.L / n; ops.push([cx - 0.65, cx + 0.65, L * LV + 0.9, L * LV + 2.25]);
    }
    b.add(wallGeometry(s.L, H, 0.3, ops, 0, 0), mat, s.M);
    ops.forEach((op, k) => windowKit(b, s.M, op, 0.3, { lit: rnd(k + si * 50) > 0.62, shutter: rnd(k * 3 + si) > 0.55 ? rnd(k * 7) * 0.9 : 0, seed: k }));
    for (let L = 1; L < o.levels; L++) b.add(_box(s.L, 0.12, 0.05), pbr('concrete'), new THREE.Matrix4().multiplyMatrices(s.M, _m(s.L / 2, L * LV, 0.025)));
  });
  b.add(_box(o.w, 0.3, o.d), pbr('gravel'), _m(o.x + o.w / 2, H - 0.05, o.z - o.d / 2));
  // acrotère
  for (const [w, d, x, z] of [[o.w, 0.3, o.x + o.w / 2, o.z - 0.15], [o.w, 0.3, o.x + o.w / 2, o.z - o.d + 0.15], [0.3, o.d, o.x + 0.15, o.z - o.d / 2], [0.3, o.d, o.x + o.w - 0.15, o.z - o.d / 2]])
    b.add(_box(w, 0.7, d), mat, _m(x, H + 0.35, z));
  // plancher intérieur opaque (évite de voir au travers)
  b.add(_box(Math.max(1, o.w - 3.2), H - 0.2, Math.max(1, o.d - 3.2)), plain('#0b0d10'), _m(o.x + o.w / 2, H / 2, o.z - o.d / 2));
  return b.flush(parent, true);
}
