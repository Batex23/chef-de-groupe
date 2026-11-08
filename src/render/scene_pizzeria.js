// ===========================================================================
// SCENE 3D - Feu de pizzeria (Kaysersberg). Fin de journee d'ete, vent d'ouest.
// Meme interface S3 que la scene du R+3. Les aides de construction (engins,
// personnages, fumees) reprennent celles de scene.js.
// ===========================================================================
import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { pbr, plain, setTextureResolution } from './materials.js';
import { genericBuilding } from './building.js';
void RoundedBoxGeometry;
const GAME = window.GAME;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const S3 = window.S3 = {};
let renderer, scene, camera, controls, quality = 'standard', composer = null;
const pickables = [];
const TEAM_COLORS = { BAT1: '#ff8a3d', BAL1: '#35c4e0', BAT2: '#f5c542', BAL2: '#4fd1a5', BAT3: '#ff5fa2', BAL3: '#9be15d', BAT4: '#c39bff', BAL4: '#ffd2a1' };
S3.TEAM_COLORS = TEAM_COLORS;
const W2 = (p, y) => new T.Vector3(p[0], y || 0, -p[1]);   // plan (x, y nord) -> monde (x, z sud)

// ------------------------------------------------------------------ aides reprises de scene.js
function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; t.anisotropy = 4;
  if (repeat) { t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}
function noise(ctx, w, h, base, amp, n) {
  ctx.fillStyle = base; ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < n; i++) {
    const v = (Math.random() - 0.5) * amp;
    ctx.fillStyle = v > 0 ? `rgba(255,255,255,${v})` : `rgba(0,0,0,${-v})`;
    ctx.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 3, 1 + Math.random() * 3);
  }
}
const TEX = {};
function makeTextures() {
  TEX.smoke = canvasTex(128, 128, (c, w, h) => {
    for (let i = 0; i < 6; i++) {
      const x = w / 2 + (Math.random() - 0.5) * 30, y = h / 2 + (Math.random() - 0.5) * 30, r = 30 + Math.random() * 25;
      const g = c.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(255,255,255,0.55)'); g.addColorStop(0.6, 'rgba(255,255,255,0.18)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, 7); c.fill();
    }
  });
  TEX.smoke.colorSpace = T.NoColorSpace;
  TEX.flame = canvasTex(64, 128, (c, w, h) => {
    const g = c.createRadialGradient(w / 2, h * 0.72, 2, w / 2, h * 0.6, h * 0.55);
    g.addColorStop(0, 'rgba(255,245,200,1)'); g.addColorStop(0.25, 'rgba(255,190,60,0.95)'); g.addColorStop(0.6, 'rgba(240,90,20,0.6)'); g.addColorStop(1, 'rgba(120,20,0,0)');
    c.fillStyle = g; c.beginPath(); c.ellipse(w / 2, h * 0.62, w * 0.45, h * 0.6, 0, 0, 7); c.fill();
  });
  TEX.glow = canvasTex(64, 64, (c, w, h) => { const g = c.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = g; c.fillRect(0, 0, 64, 64); });
  TEX.sign = canvasTex(512, 96, (c, w, h) => { c.fillStyle = '#7a1c14'; c.fillRect(0, 0, w, h); c.fillStyle = '#f7e7c4'; c.font = '700 64px "Barlow Condensed", Arial Narrow, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('PIZZERIA', w / 2, h / 2 + 3); });
  TEX.station = canvasTex(512, 96, (c, w, h) => { c.fillStyle = '#0f4c8a'; c.fillRect(0, 0, w, h); c.fillStyle = '#ffffff'; c.font = '700 60px "Barlow Condensed", Arial Narrow, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('STATION-SERVICE', w / 2, h / 2 + 3); });
  TEX.bac = canvasTex(256, 256, (c, w, h) => { noise(c, w, h, '#5d6267', 0.08, 4000); for (let x = 0; x < w; x += 16) { c.fillStyle = 'rgba(255,255,255,0.08)'; c.fillRect(x, 0, 3, h); c.fillStyle = 'rgba(0,0,0,0.18)'; c.fillRect(x + 8, 0, 2, h); } }, [4, 4]);
  TEX.water = canvasTex(256, 256, (c, w, h) => { noise(c, w, h, '#2f5d72', 0.10, 5000); }, [12, 2]);
}
function std(color, o) { return new T.MeshStandardMaterial(Object.assign({ color, roughness: 0.85, metalness: 0.0 }, o || {})); }
function box(w, h, d, mat, x, y, z, parent, bottom) {
  const g = new T.BoxGeometry(w, h, d); if (bottom) g.translate(0, h / 2, 0);
  const m = new T.Mesh(g, mat); m.position.set(x, y, z);
  if (quality === 'standard') { m.castShadow = true; m.receiveShadow = true; }
  (parent || scene).add(m); return m;
}
function label(text, color, opts) {
  opts = opts || {};
  const c = document.createElement('canvas'); const ctx = c.getContext('2d');
  const font = `700 ${opts.size || 44}px "IBM Plex Mono", monospace`; ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + 40; c.width = w; c.height = (opts.size || 44) + 28;
  ctx.font = font;
  ctx.fillStyle = opts.bg || 'rgba(12,18,26,0.85)'; roundRect(ctx, 2, 2, w - 4, c.height - 4, 14); ctx.fill();
  ctx.strokeStyle = color; ctx.lineWidth = 5; roundRect(ctx, 2, 2, w - 4, c.height - 4, 14); ctx.stroke();
  ctx.fillStyle = opts.fg || '#ffffff'; ctx.textBaseline = 'middle'; ctx.fillText(text, 20, c.height / 2 + 2);
  const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace;
  const s = new T.Sprite(new T.SpriteMaterial({ map: t, depthTest: !opts.always, depthWrite: false, transparent: true, sizeAttenuation: false }));
  const hh = (opts.scale || 0.011) * 2.6; s.scale.set(hh * c.width / c.height, hh, 1);
  s.renderOrder = opts.always ? 999 : 10;
  s.layers.set(1);
  return s;
}
function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
function markPick(obj, data) { obj.userData.pick = data; obj.traverse(o => { if (o.isMesh) pickables.push(o); }); }
const GLOWS = [];
function glow(color, size, parent, x, y, z, base) {
  const m = new T.SpriteMaterial({ map: TEX.glow, color, blending: T.AdditiveBlending, depthWrite: false, transparent: true, opacity: base == null ? 0.6 : base });
  const s = new T.Sprite(m); s.scale.set(size, size, 1); s.position.set(x, y, z); (parent || scene).add(s); s.userData.base = m.opacity; GLOWS.push(s); return s;
}
const vehicles = {};
function rbox(w, h, d, r, mat, parent, x, y, z) {
  const b = Math.min(r, w / 4, h / 4, d / 4), W = w - 2 * b, H = h - 2 * b, R = Math.min(r, W / 3, H / 3);
  const sh = new T.Shape();
  sh.moveTo(-W / 2 + R, -H / 2); sh.lineTo(W / 2 - R, -H / 2); sh.quadraticCurveTo(W / 2, -H / 2, W / 2, -H / 2 + R);
  sh.lineTo(W / 2, H / 2 - R); sh.quadraticCurveTo(W / 2, H / 2, W / 2 - R, H / 2); sh.lineTo(-W / 2 + R, H / 2);
  sh.quadraticCurveTo(-W / 2, H / 2, -W / 2, H / 2 - R); sh.lineTo(-W / 2, -H / 2 + R); sh.quadraticCurveTo(-W / 2, -H / 2, -W / 2 + R, -H / 2);
  const g = new T.ExtrudeGeometry(sh, { depth: Math.max(0.01, d - 2 * b), bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 2, curveSegments: 5 });
  g.center();
  const m = new T.Mesh(g, mat); m.position.set(x, y, z);
  if (quality === 'standard') { m.castShadow = true; m.receiveShadow = true; }
  parent.add(m); return m;
}
let SPTEX = null;
function spText() {
  return SPTEX || (SPTEX = canvasTex(512, 64, (c, w, h) => { c.clearRect(0, 0, w, h); c.fillStyle = '#ffffff'; c.font = '700 40px "Barlow Condensed", Arial Narrow, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('SAPEURS-POMPIERS', w / 2, h / 2 + 2); }));
}
function truck(id, o) {
  const g = new T.Group(); scene.add(g);
  const paint = std(o.color, { roughness: 0.42, metalness: 0.15 }); paint.userData.env = 0.3;
  const glass = std('#0e141b', { roughness: 0.04, metalness: 0.85 }); glass.userData.env = 1.2;
  const alu = std('#c8cdd2', { roughness: 0.3, metalness: 0.85 }); alu.userData.env = 1.0;
  const dark = std('#15171a', { roughness: 0.8 });
  const L = o.len, W = 2.45, cabL = 2.3;
  rbox(L - cabL - 0.05, o.h, W, 0.12, paint, g, -cabL / 2, 0.85 + o.h / 2, 0);                  // caisse
  rbox(cabL, 2.15, W, 0.28, paint, g, L / 2 - cabL / 2, 0.85 + 1.07, 0);                         // cabine
  rbox(0.08, 0.95, W - 0.35, 0.05, glass, g, L / 2 + 0.01, 2.35, 0);                               // pare-brise
  for (const sz of [1, -1]) {
    rbox(1.2, 0.7, 0.06, 0.05, glass, g, L / 2 - 0.95, 2.35, sz * (W / 2 + 0.005));              // vitres laterales
    rbox(0.12, 0.3, 0.06, 0.03, dark, g, L / 2 + 0.05, 2.25, sz * (W / 2 + 0.18));               // retroviseurs
    // coffres a rideaux
    const nb = Math.max(2, Math.round((L - cabL) / 1.4));
    for (let k = 0; k < nb; k++) {
      const lw = (L - cabL - 0.4) / nb - 0.08, lx = -L / 2 + 0.25 + (k + 0.5) * ((L - cabL - 0.4) / nb);
      const sh = std(o.locker || '#b9bec4', { roughness: 0.5, metalness: 0.5 }); sh.userData.env = 0.4;
      rbox(lw, Math.min(1.25, o.h - 0.35), 0.04, 0.04, sh, g, lx, 0.95 + Math.min(1.25, o.h - 0.35) / 2 + 0.1, sz * (W / 2 + 0.01));
    }
    // marquage
    const tx = new T.Mesh(new T.PlaneGeometry(3.2, 0.4), new T.MeshBasicMaterial({ map: spText(), transparent: true }));
    tx.position.set(-0.6, 0.85 + o.h + 0.02 - 0.32, sz * (W / 2 + 0.03)); if (sz < 0) tx.rotation.y = Math.PI; g.add(tx);
  }
  // bande reflechissante, pare-chocs, calandre, phares
  box(L + 0.02, 0.16, W + 0.04, std(o.stripe || '#f4f4f4', { roughness: 0.3, emissive: o.stripe || '#f4f4f4', emissiveIntensity: 0.15 }), 0, 1.0, 0, g);
  rbox(0.25, 0.35, W + 0.05, 0.08, dark, g, L / 2 + 0.05, 0.75, 0);
  for (const sz of [0.85, -0.85]) { const hl = new T.Mesh(new T.CircleGeometry(0.13, 16), new T.MeshBasicMaterial({ color: '#fff4dc' })); hl.position.set(L / 2 + 0.03, 1.15, sz); hl.rotation.y = Math.PI / 2; g.add(hl); }
  for (const sz of [0.95, -0.95]) { const rl = new T.Mesh(new T.PlaneGeometry(0.18, 0.26), new T.MeshBasicMaterial({ color: '#c0161c' })); rl.position.set(-L / 2 - 0.01, 1.1, sz); rl.rotation.y = -Math.PI / 2; g.add(rl); }
  box(L - 0.4, 0.3, W - 0.3, dark, 0, 0.55, 0, g, true);                                          // chassis
  // roues
  const tyre = new T.CylinderGeometry(0.52, 0.52, 0.38, 22); tyre.rotateX(Math.PI / 2);
  const rim = new T.CylinderGeometry(0.28, 0.28, 0.4, 16); rim.rotateX(Math.PI / 2);
  const axles = [L / 2 - 1.25, -L / 2 + 1.35, -L / 2 + 2.7].slice(0, o.axles || 2);
  for (const x of axles) for (const sz of [1, -1]) {
    const w = new T.Mesh(tyre, std('#121212', { roughness: 0.95 })); w.position.set(x, 0.52, sz * (W / 2 - 0.12)); g.add(w);
    const r = new T.Mesh(rim, alu); r.position.copy(w.position); g.add(r);
  }
  // rampe de gyrophares + feux de penetration
  const blue = new T.MeshStandardMaterial({ color: '#173a7a', emissive: '#3d7dff', emissiveIntensity: 0, roughness: 0.2 });
  rbox(0.32, 0.16, 1.7, 0.06, blue, g, L / 2 - 0.55, 0.85 + 2.2, 0);
  for (const sz of [0.6, -0.6]) { const fb = new T.Mesh(new T.PlaneGeometry(0.16, 0.08), blue); fb.position.set(L / 2 + 0.035, 1.42, sz); fb.rotation.y = Math.PI / 2; g.add(fb); }
  g.userData.blue = blue;
  g.userData.halos = [glow('#4d8bff', 2.2, g, L / 2 - 0.55, 0.85 + 2.3, 0.75, 0), glow('#4d8bff', 2.2, g, L / 2 - 0.55, 0.85 + 2.3, -0.75, 0)];
  for (const sz of [0.85, -0.85]) glow('#fff1d0', 1.0, g, L / 2 + 0.2, 1.15, sz, 0.35);
  if (o.roofLadder) { // echelle a coulisse sur le toit du FPT
    for (const sz of [0.35, -0.35]) box(L - cabL - 0.6, 0.06, 0.06, alu, -cabL / 2, 0.85 + o.h + 0.12, sz, g);
    for (let i = -L / 2 + 0.6; i < L / 2 - cabL - 0.3; i += 0.35) box(0.04, 0.04, 0.7, alu, i, 0.85 + o.h + 0.12, 0, g);
  }
  const lb = label(o.label, '#e8eef4', { scale: 0.011 }); lb.position.set(0, o.h + 2.6, 0); g.add(lb);
  g.userData.label = lb;
  markPick(g, { type: 'engin', id });
  vehicles[id] = g;
  return g;
}
function cap(r, len, mat, parent, x, y, z) {
  const m = new T.Mesh(new T.CapsuleGeometry(r, len, 4, 10), mat); m.position.set(x, y, z);
  if (quality === 'standard') m.castShadow = true;
  parent.add(m); return m;
}
const PMAT = {};
function pm(c, o) { return PMAT[c + JSON.stringify(o || {})] || (PMAT[c + JSON.stringify(o || {})] = std(c, Object.assign({ roughness: 0.75 }, o || {}))); }
function person(body, skin, lying, helmet, hair) {
  const g = new T.Group();
  const B = pm(body), S = pm(skin || '#d9b9a0'), dark = pm('#1a1c20', { roughness: 0.6 });
  const legs = helmet ? pm('#1f2a38') : pm(body === '#7b3b62' ? '#2b2f3a' : '#3a3f4a');
  for (const sx of [-0.1, 0.1]) {
    const hip = new T.Group(); hip.position.set(sx, 0.84, 0); g.add(hip); hip.userData.leg = sx < 0 ? 1 : -1;
    cap(0.085, 0.56, legs, hip, 0, -0.38, 0);
    const boot = new T.Mesh(new T.BoxGeometry(0.14, 0.12, 0.26), dark); boot.position.set(0, -0.77, 0.04); hip.add(boot);
    if (helmet) { const band = new T.Mesh(new T.CylinderGeometry(0.092, 0.092, 0.05, 12), pm('#d9d94a', { emissive: '#b8b830', emissiveIntensity: 0.4 })); band.position.y = -0.48; hip.add(band); }
  }
  const torso = cap(0.19, 0.32, B, g, 0, 1.13, 0); torso.scale.set(1, 1, 0.72);
  const neck = new T.Mesh(new T.CylinderGeometry(0.055, 0.06, 0.1, 10), S); neck.position.set(0, 1.47, 0); g.add(neck);
  const head = new T.Mesh(new T.SphereGeometry(0.115, 18, 14), S); head.position.set(0, 1.6, 0); head.scale.set(1, 1.08, 1); g.add(head);
  if (!helmet) {
    const h = new T.Mesh(new T.SphereGeometry(0.125, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), pm(hair || '#3b2a20')); h.position.set(0, 1.62, -0.01); g.add(h);
  } else {
    const hm = pm('#e6e8ea', { metalness: 0.75, roughness: 0.22 });
    const shell = new T.Mesh(new T.SphereGeometry(0.155, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), hm); shell.position.set(0, 1.63, 0); shell.scale.set(1, 1.05, 1.1); g.add(shell);
    const brim = new T.Mesh(new T.CylinderGeometry(0.165, 0.175, 0.03, 20), hm); brim.position.set(0, 1.6, -0.01); brim.scale.set(1, 1, 1.12); g.add(brim);
    const visor = new T.Mesh(new T.SphereGeometry(0.135, 16, 8, -Math.PI * 0.42, Math.PI * 0.84, Math.PI * 0.35, Math.PI * 0.32), pm('#c9a24a', { metalness: 0.9, roughness: 0.15 })); visor.position.set(0, 1.62, 0.02); g.add(visor);
    const mask = new T.Mesh(new T.SphereGeometry(0.075, 12, 10), pm('#20242a', { roughness: 0.4 })); mask.position.set(0, 1.55, 0.09); mask.scale.set(1, 0.9, 0.6); g.add(mask);
    for (const y of [0.95, 1.22]) { const r = new T.Mesh(new T.CylinderGeometry(0.2, 0.2, 0.05, 16), pm('#d9d94a', { emissive: '#b8b830', emissiveIntensity: 0.45 })); r.position.set(0, y, 0); r.scale.set(1, 1, 0.74); g.add(r); }
    const ari = cap(0.075, 0.38, pm('#8c9399', { metalness: 0.6, roughness: 0.35 }), g, 0, 1.12, -0.2);
    const plate = new T.Mesh(new T.BoxGeometry(0.26, 0.5, 0.04), dark); plate.position.set(0, 1.12, -0.15); g.add(plate);
  }
  for (const sx of [-1, 1]) {
    const sh = new T.Group(); sh.position.set(sx * 0.25, 1.36, 0); g.add(sh);
    cap(0.06, 0.42, B, sh, 0, -0.26, 0);
    const hand = new T.Mesh(new T.SphereGeometry(0.055, 10, 8), helmet ? dark : S); hand.position.set(0, -0.54, 0); sh.add(hand);
    if (sx > 0) g.userData.arm = sh; else g.userData.arm2 = sh;
  }
  return g;
}

// ------------------------------------------------------------------ init
S3.init = function (canvas, q) {
  quality = q || 'standard';
  renderer = new T.WebGLRenderer({ canvas, antialias: quality !== 'standard', powerPreference: 'high-performance' });
  renderer.setPixelRatio(quality === 'standard' ? Math.min(devicePixelRatio, 1.75) : 1);
  renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.95;
  renderer.shadowMap.enabled = quality === 'standard'; renderer.shadowMap.type = T.PCFSoftShadowMap;
  scene = new T.Scene();
  scene.fog = new T.Fog('#b9c4cf', 140, 420);
  camera = new T.PerspectiveCamera(45, 1, 0.5, 1200); camera.layers.enable(1);
  camera.position.set(28, 16, 48);
  controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 3, -12); controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.minDistance = 10; controls.maxDistance = 260; controls.maxPolarAngle = 1.5; controls.screenSpacePanning = true;
  setTextureResolution(quality === 'standard' ? 512 : 256);
  makeTextures();
  buildLights(); buildSky(); buildGround(); buildPizzeria(); buildStation(); buildHLM(); buildVillage(); buildVehicles(); buildPeople(); buildFx();
  let fxi = ''; try { fxi = localStorage.getItem('cdg-fx') || ''; } catch (e) { }
  if (quality === 'standard' && !fxi.includes('nocomposer')) buildComposer();
  S3.resize(); window.addEventListener('resize', S3.resize);
};
S3.resize = function () {
  const c = renderer.domElement, w = c.clientWidth || innerWidth, h = c.clientHeight || innerHeight;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  if (composer) composer.setSize(w, h);
};
function buildComposer() {
  const size = renderer.getDrawingBufferSize(new T.Vector2());
  let fx0 = ''; try { fx0 = localStorage.getItem('cdg-fx') || ''; } catch (e) { }
  const rt = new T.WebGLRenderTarget(size.x, size.y, { type: T.HalfFloatType, samples: fx0.includes('nomsaa') ? 0 : 4 });
  composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  const gtao = new GTAOPass(scene, camera, size.x, size.y, undefined, { radius: 0.6, distanceExponent: 1.5, thickness: 1.2, scale: 1.0, samples: 12 });
  gtao.blendIntensity = 0.85;
  const ov = gtao.overrideVisibility.bind(gtao);
  gtao.overrideVisibility = function () { ov(); scene.traverse(o => { if (o.isSprite || (o.userData && o.userData.noAO)) o.visible = false; }); };
  let fx = ''; try { fx = localStorage.getItem('cdg-fx') || ''; } catch (e) { }
  if (!fx.includes('noao')) composer.addPass(gtao);
  if (!fx.includes('nobloom')) composer.addPass(new UnrealBloomPass(new T.Vector2(size.x, size.y), 0.35, 0.45, 1.0));
  composer.addPass(new OutputPass());
  S3.linearFx = true;
}
S3.autoRotate = v => { controls.autoRotate = v; controls.autoRotateSpeed = 0.3; S3.labelsOn = !v; if (v) camera.layers.disable(1); else camera.layers.enable(1); };
S3.labelsOn = true;

// ------------------------------------------------------------------ lumiere de fin de journee (soleil bas a l'ouest)
let sun, fireLights = [];
function buildLights() {
  scene.add(new T.HemisphereLight('#cfe0f5', '#5b5444', 1.4));
  sun = new T.DirectionalLight('#ffd9a8', 2.6); sun.position.set(-120, 45, 30); sun.target.position.set(0, 0, -15); scene.add(sun.target);
  if (quality === 'standard') { sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); const sc = sun.shadow.camera; sc.left = -90; sc.right = 90; sc.top = 70; sc.bottom = -70; sc.far = 300; sun.shadow.bias = -0.0005; }
  scene.add(sun);
  for (let k = 0; k < 3; k++) { const L = new T.PointLight('#ff7a2a', 0, 45, 2); scene.add(L); fireLights.push(L); }
}
function buildSky() {
  const mat = new T.ShaderMaterial({
    side: T.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new T.Color('#4f7fb8') }, mid: { value: new T.Color('#a9c3dd') }, warm: { value: new T.Color('#f2c393') } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 mid; uniform vec3 warm; varying vec3 vP; void main(){ float h = clamp(vP.y, 0.0, 1.0); vec3 c = mix(mid, top, pow(h, 0.6)); float w = pow(clamp(-vP.x * 0.5 + 0.5, 0.0, 1.0), 4.0) * pow(1.0 - h, 3.0); c = mix(c, warm, w * 0.8); gl_FragColor = vec4(c, 1.0); }',
  });
  scene.add(new T.Mesh(new T.SphereGeometry(900, 32, 16), mat));
}
function planeUV(w, h, rep) { const g = new T.PlaneGeometry(w, h); const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / (rep || 1), uv.getY(i) * h / (rep || 1)); return g; }
function flat(mat, x1, z1, x2, z2, y) { const m = new T.Mesh(planeUV(x2 - x1, z2 - z1, 4), mat); m.rotation.x = -Math.PI / 2; m.position.set((x1 + x2) / 2, y || 0.02, (z1 + z2) / 2); m.receiveShadow = true; scene.add(m); return m; }
// ------------------------------------------------------------------ sol, routes, riviere
function buildGround() {
  flat(pbr('grass'), -400, -300, 400, 300, 0);
  const asph = pbr('asphalt'), pav = pbr('pavement');
  flat(asph, -300, 4, 300, 12, 0.03);                    // RN 415
  flat(pav, -300, 0, 300, 4, 0.05); flat(pav, -300, 12, 300, 14.5, 0.05);
  flat(asph, 58, -60, 66, 4, 0.03);                      // rue de Geisbourg
  flat(asph, -48, 16, -18, 28, 0.04);                    // parking sud-ouest (PRV)
  flat(asph, 28, -9, 50, 0, 0.04);                       // parking du HLM
  flat(asph, -58, -30, -16, 4, 0.04);                    // aire de la station
  for (let x = -290; x < 290; x += 7) box(3.5, 0.02, 0.18, plain('#d9d6cc'), x, 0.035, 8, null, true);
  for (let k = 0; k < 6; k++) { box(0.15, 0.02, 4.5, plain('#d9d6cc'), -46 + k * 5, 0.045, 22, null, true); box(0.15, 0.02, 4, plain('#d9d6cc'), 30 + k * 4, 0.045, -4.5, null, true); }
  // la Weisbach
  const water = new T.Mesh(planeUV(800, 8, 8), new T.MeshStandardMaterial({ map: TEX.water, color: '#9fc2cf', roughness: 0.12, metalness: 0.2 }));
  water.rotation.x = -Math.PI / 2; water.position.set(0, -0.35, -48); scene.add(water);
  for (const z of [-44, -52]) box(800, 0.6, 1.2, pbr('stone'), 0, -0.45, z, null, true);
  box(10, 0.5, 9, pbr('concrete'), 56, 0.05, -48, null, true);   // pont rue de Geisbourg
  // poteau incendie et avaloirs
  const pi = new T.Group(); pi.position.set(-20, 0.05, 3); scene.add(pi);
  const red = std('#c4161c', { roughness: 0.45, metalness: 0.2 });
  const body = new T.Mesh(new T.CylinderGeometry(0.16, 0.18, 0.9, 16), red); body.position.y = 0.45; pi.add(body);
  const pil = label('PI 150', '#3a8eea', { scale: 0.008 }); pil.position.set(-20, 1.8, 3); scene.add(pil);
  for (const x of [-6, 9, 24]) box(0.9, 0.04, 0.5, plain('#25282c'), x, 0.04, 4.4, null, true);
  const asp = label('Aspiration Weisbach', '#3a8eea', { scale: 0.008 }); asp.position.set(55, 2.2, -44); scene.add(asp);
}
// ------------------------------------------------------------------ la pizzeria (900 m2, plain-pied, toiture bac acier)
const roofs = [], cellFx = [];
function buildPizzeria() {
  const wall = pbr('plaster'), H = 4.6;
  box(30, H, 0.3, wall, 0, 0, -0.15, null, true);       // facade sud
  box(30, H, 0.3, wall, 0, 0, -29.85, null, true);      // facade nord
  box(0.3, H, 30, wall, -14.85, 0, -15, null, true);    // facade ouest
  box(0.3, H, 30, wall, 14.85, 0, -15, null, true);     // facade est
  const glass = std('#1a2129', { roughness: 0.08, metalness: 0.7 }); glass.userData.env = 1;
  for (const x of [-11, -6, 6, 11]) box(3.6, 2.2, 0.08, glass, x, 0.9, 0.05, null, true);
  box(2.4, 2.4, 0.08, std('#2a1e18', { roughness: 0.5 }), 0, 0.05, 0.05, null, true);
  const sign = new T.Mesh(new T.PlaneGeometry(9, 1.6), new T.MeshStandardMaterial({ map: TEX.sign, roughness: 0.6 })); sign.position.set(0, 3.7, 0.12); scene.add(sign);
  box(30.6, 0.35, 30.6, pbr('concrete'), 0, H, -15, null, true).visible = false;
  // toiture en 9 panneaux (un par volume) : ils s'affaissent quand le volume brule
  const bac = std('#7a8086', { map: TEX.bac, roughness: 0.55, metalness: 0.55 });
  for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) {
    const [x, y] = GAME.cellXY(i, j);
    const r = box(10, 0.18, 10, bac, x, H, -y, null, true); r.userData.base = H; roofs.push(r);
    // flammes et halo par volume
    const grp = new T.Group(); grp.position.set(x, H, -y); scene.add(grp);
    const fm = () => new T.SpriteMaterial({ map: TEX.flame, blending: T.AdditiveBlending, depthWrite: false, transparent: true, color: '#ffb47a', opacity: 0.9 });
    const arr = []; for (let k = 0; k < 6; k++) { const s = new T.Sprite(fm()); s.userData.ox = (Math.random() - 0.5) * 7; s.userData.oz = (Math.random() - 0.5) * 7; grp.add(s); arr.push(s); }
    const halo = new T.Sprite(new T.SpriteMaterial({ map: TEX.glow, color: '#ff7a2a', blending: T.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.5 })); halo.position.y = 2; grp.add(halo);
    cellFx.push({ grp, arr, halo, x, z: -y });
  }
  const lb = label('Pizzeria — 900 m²', '#e8eef4', { scale: 0.009 }); lb.position.set(0, 9, -15); scene.add(lb);
  pickPlane(30, 4.6, 0, 2.3, 0.3, 0, { type: 'observe', what: 'FACADE_S' });
  pickPlane(30, 4.6, -15.1, 2.3, -15, Math.PI / 2, { type: 'observe', what: 'FACADE_O' });
  pickPlane(30, 4.6, 15.1, 2.3, -15, Math.PI / 2, { type: 'observe', what: 'FACADE_E' });
  const top = new T.Mesh(new T.BoxGeometry(30, 0.4, 30), new T.MeshBasicMaterial({ colorWrite: false, depthWrite: false })); top.position.set(0, H + 0.4, -15); top.userData.noAO = true; scene.add(top); markPick(top, { type: 'observe', what: 'TOIT' });
}
function pickPlane(w, h, x, y, z, rot, data) {
  const m = new T.Mesh(new T.BoxGeometry(w, h, 0.4), new T.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
  m.position.set(x, y, z); m.rotation.y = rot || 0; m.userData.noAO = true; scene.add(m); markPick(m, data); return m;
}
// ------------------------------------------------------------------ station-service et stock de bouteilles
let bottles, torch, fireball;
function buildStation() {
  const white = std('#e9ecef', { roughness: 0.5 }), blue = std('#0f4c8a', { roughness: 0.5 });
  box(12, 0.8, 10, white, -41, 4.6, -9, null, true);                                   // auvent
  const fr = new T.Mesh(new T.PlaneGeometry(12, 0.8), new T.MeshStandardMaterial({ map: TEX.station })); fr.position.set(-41, 5.0, -3.95); scene.add(fr);
  for (const [x, z] of [[-46, -5], [-36, -5], [-46, -13], [-36, -13]]) box(0.4, 4.6, 0.4, white, x, 0, z, null, true);
  for (const x of [-44, -38]) { box(0.8, 1.6, 0.5, blue, x, 0.15, -9, null, true); box(1.6, 0.15, 4, pbr('concrete'), x, 0, -9, null, true); }
  box(9, 3.6, 10, pbr('brick'), -50.5, 0, -23, null, true);                            // boutique
  box(7, 1.6, 0.08, std('#1a2129', { roughness: 0.08, metalness: 0.7 }), -50.5, 0.6, -17.95, null, true);
  // cage grillagee et une quarantaine de bouteilles
  const cage = new T.Group(); cage.position.set(-24.5, 0.05, -10); scene.add(cage);
  const grid = std('#9aa2a8', { metalness: 0.7, roughness: 0.4, transparent: true, opacity: 0.45 });
  for (const [w, d, x, z] of [[3, 0.05, 0, 2], [3, 0.05, 0, -2], [0.05, 4, 1.5, 0], [0.05, 4, -1.5, 0]]) box(w, 1.9, d, grid, x, 0, z, cage, true);
  const bg = new T.CylinderGeometry(0.17, 0.17, 0.62, 10);
  bottles = new T.InstancedMesh(bg, std('#ffffff', { roughness: 0.45, metalness: 0.3 }), 40);
  const M = new T.Matrix4(), col = new T.Color();
  for (let k = 0; k < 40; k++) { const r = Math.floor(k / 8), c = k % 8; M.makeTranslation(-1.2 + c * 0.34, 0.33 + (r % 2) * 0.66, -1.6 + r * 0.7); bottles.setMatrixAt(k, M); bottles.setColorAt(k, col.set(k % 3 ? '#2f6fd1' : '#e2762a')); }
  cage.add(bottles); markPick(cage, { type: 'observe', what: 'GAZ' });
  const lb = label('Bouteilles de gaz', '#f08c2a', { scale: 0.008 }); lb.position.set(-24.5, 3.2, -10); scene.add(lb);
  torch = new T.Sprite(new T.SpriteMaterial({ map: TEX.flame, blending: T.AdditiveBlending, depthWrite: false, transparent: true, color: '#ffcc88' })); torch.position.set(-24, 2.4, -9.5); torch.scale.set(0.9, 2.6, 1); torch.visible = false; scene.add(torch);
  fireball = new T.Sprite(new T.SpriteMaterial({ map: TEX.glow, color: '#ff9a3c', blending: T.AdditiveBlending, depthWrite: false, transparent: true })); fireball.position.set(-24.5, 6, -10); fireball.visible = false; scene.add(fireball);
}
// ------------------------------------------------------------------ HLM R+3 et environnement
let hlmFire;
function buildHLM() {
  genericBuilding(scene, { x: 28, z: -12, w: 24, d: 14, levels: 4, mat: 'plaster', seed: 5, bay: 3 });
  const lb = label('HLM R+3', '#e8eef4', { scale: 0.009 }); lb.position.set(40, 13.5, -19); scene.add(lb);
  const pk = new T.Mesh(new T.BoxGeometry(24.4, 10.6, 14.4), new T.MeshBasicMaterial({ colorWrite: false, depthWrite: false })); pk.position.set(40, 5.2, -19); pk.userData.noAO = true; scene.add(pk); markPick(pk, { type: 'observe', what: 'HLM' });
  hlmFire = new T.Group(); hlmFire.visible = false; scene.add(hlmFire);
  for (let k = 0; k < 4; k++) { const s = new T.Sprite(new T.SpriteMaterial({ map: TEX.flame, blending: T.AdditiveBlending, depthWrite: false, transparent: true, color: '#ffb47a' })); s.position.set(27.7, 3.8 + (k % 2) * 0.6, -15 - k * 1.2); s.scale.set(1.4, 2.4, 1); hlmFire.add(s); }
}
function buildVillage() {
  const bark = std('#3b2c22'), leaf = std('#3d5a2a', { roughness: 0.9 }), leaf2 = std('#4c6b33', { roughness: 0.9 });
  const tree = (x, z, s) => { const g = new T.Group(); g.position.set(x, 0, z); g.scale.setScalar(s); scene.add(g); const tr = new T.Mesh(new T.CylinderGeometry(0.15, 0.25, 3.2, 8), bark); tr.position.y = 1.6; tr.castShadow = true; g.add(tr); for (let k = 0; k < 5; k++) { const f = new T.Mesh(new T.IcosahedronGeometry(1.2 + Math.random() * 0.7, 1), k % 2 ? leaf : leaf2); f.position.set((Math.random() - 0.5) * 2, 3.6 + Math.random() * 1.6, (Math.random() - 0.5) * 2); if (quality === 'standard') f.castShadow = true; g.add(f); } };
  for (let x = -120; x <= 120; x += 9) { tree(x + Math.random() * 3, -40 + Math.random() * 2, 1 + Math.random() * 0.3); }
  [[-60, 20], [-70, 26], [62, 20], [70, 18], [-30, -38], [20, -38], [-8, -36]].forEach(([x, z]) => tree(x, z, 1.1));
  genericBuilding(scene, { x: -110, z: 30, w: 20, d: 12, levels: 2, mat: 'plaster', seed: 9, bay: 3 });
  genericBuilding(scene, { x: 70, z: 34, w: 18, d: 12, levels: 3, mat: 'brick', seed: 13, bay: 3 });
  genericBuilding(scene, { x: 75, z: -12, w: 16, d: 12, levels: 2, mat: 'plaster', seed: 17, bay: 3 });
  genericBuilding(scene, { x: -95, z: -6, w: 16, d: 14, levels: 2, mat: 'stone', seed: 21, bay: 3 });
}
// ------------------------------------------------------------------ engins
let ladder, turntable, ladderProg = 0;
const PARK = { VLCG: [-4, 13.2], FPT1: [-13, 8.5], FPT2: [11, 8.5], GSAP1: [32, 10.2], GSAP2: [40, 10.2], VLI: [26, 10.6], FPT3: [-60, 10.2], FPT4: [-70, 10.2], PC: [-38, 22], GALIM: [62, -38] };
function buildVehicles() {
  const fpt = (id, lab) => { const g = truck(id, { len: 8.2, h: 2.2, color: '#7f0910', label: lab, axles: 2, roofLadder: true }); g.position.set(PARK[id][0], 0, PARK[id][1]); return g; };
  fpt('FPT1', 'FPT 1'); fpt('FPT2', 'FPT 2');
  const vl = truck('VLCG', { len: 4.8, h: 1.1, color: '#7f0910', label: 'VLCG (vous)', axles: 2 }); vl.position.set(PARK.VLCG[0], 0, PARK.VLCG[1]); vl.scale.set(1, 0.75, 0.85);
  const pa = truck('PA', { len: 10, h: 1.6, color: '#7f0910', label: 'EPA 30', axles: 3 });
  const xz = GAME.SLOTS.PA[(G.vpos && G.vpos.PA) || 'sud'].xz; pa.position.set(xz[0], 0, xz[1]);
  turntable = new T.Group(); turntable.position.set(-3, 2.6, 0); pa.add(turntable);
  box(1.4, 0.5, 1.4, std('#d0d0d0', { metalness: 0.5, roughness: 0.4 }), 0, 0, 0, turntable, true);
  ladder = new T.Group(); ladder.position.set(0, 0.6, 0); turntable.add(ladder);
  const lm = std('#d8dce0', { metalness: 0.7, roughness: 0.35 }), LL = 10;
  box(LL, 0.2, 0.12, lm, LL / 2, 0, 0.45, ladder); box(LL, 0.2, 0.12, lm, LL / 2, 0, -0.45, ladder);
  for (let i = 0.4; i < LL; i += 0.5) box(0.06, 0.06, 0.9, lm, i, 0, 0, ladder);
  ladder.userData.LL = LL;
  for (const [id, lab, x] of [['GSAP1', 'VSAV 1', 0], ['GSAP2', 'VSAV 2', 0]]) { const v = truck(id, { len: 6.4, h: 2.2, color: '#8a0b13', stripe: '#f4f4f4', locker: '#e8e8e8', label: lab, axles: 2 }); v.position.set(PARK[id][0], 0, PARK[id][1]); v.visible = false; void x; }
  const vli = truck('VLI', { len: 4.8, h: 1.1, color: '#8a0b13', label: 'VLI', axles: 2 }); vli.position.set(PARK.VLI[0], 0, PARK.VLI[1]); vli.scale.set(1, 0.75, 0.85); vli.visible = false;
  for (const id of ['FPT3', 'FPT4']) { const g = fpt(id, id.replace('FPT', 'FPT ')); g.visible = false; }
  const pc = truck('PC', { len: 7, h: 2.4, color: '#7f0910', label: 'PC de colonne', axles: 2 }); pc.position.set(PARK.PC[0], 0, PARK.PC[1]); pc.visible = false;
  const ga = truck('GALIM', { len: 9, h: 2.4, color: '#7f0910', label: 'G ALIM (aspiration)', axles: 3 }); ga.position.set(PARK.GALIM[0], 0, PARK.GALIM[1]); ga.rotation.y = Math.PI / 2; ga.visible = false;
}
// ------------------------------------------------------------------ personnages
const teams = {}, witnessFig = {}, crowd = [];
let uaFig;
function teamGroup(a) {
  const g = new T.Group(); scene.add(g);
  const col = TEAM_COLORS[a.id] || '#9a72ff';
  const f1 = person('#1d2836', null, false, true), f2 = person('#1d2836', null, false, true);
  f1.position.set(-0.35, 0, 0); f2.position.set(0.35, 0, -0.3); g.add(f1); g.add(f2);
  for (const f of [f1, f2]) { const band = new T.Mesh(new T.CylinderGeometry(0.205, 0.205, 0.07, 16), new T.MeshBasicMaterial({ color: col })); band.position.y = 1.32; band.scale.set(1, 1, 0.74); f.add(band); }
  const lb = label(`${a.id.replace(/\d/, '')} ${a.engin.replace('FPT ', 'FPT')}`, col, { scale: 0.0095, always: true }); lb.position.set(0, 2.5, 0); g.add(lb);
  markPick(g, { type: 'team', id: a.id });
  teams[a.id] = { group: g, figs: [f1, f2], label: lb, pos: new T.Vector3(), heading: 0, hose: null };
  return teams[a.id];
}
function buildPeople() {
  const cols = ['#7b3b62', '#3b5f7b', '#c9a227', '#55606a', '#2f6d4f', '#a33a2b', '#e4e0d6', '#40444c'];
  const n = quality === 'standard' ? 18 : 10;
  for (let k = 0; k < n; k++) { const f = person(cols[k % cols.length], k % 3 ? '#e2c4a8' : '#b98e6d', false, false, k % 4 ? '#3b2a20' : '#9a9a9a'); f.scale.setScalar(0.95 + Math.random() * 0.1); f.userData.off = [(Math.random() - 0.5) * 8, (Math.random() - 0.5) * 2.5]; scene.add(f); crowd.push(f); }
  const pk = new T.Mesh(new T.BoxGeometry(10, 2, 4), new T.MeshBasicMaterial({ colorWrite: false, depthWrite: false })); pk.userData.noAO = true; scene.add(pk); markPick(pk, { type: 'observe', what: 'TIERS' }); S3.crowdPick = pk;
  uaFig = person('#e4e0d6', '#b98e6d', true); uaFig.rotation.z = Math.PI / 2; scene.add(uaFig);
  const mk = (id, body, hair, pos) => { const f = person(body, '#e2c4a8', false, false, hair); f.visible = false; f.position.set(...pos); scene.add(f); const m = label('?', '#2fb36b', { scale: 0.009, always: true }); m.position.set(0, 2.25, 0); f.add(m); f.userData.marker = m; markPick(f, { type: 'witness', id }); witnessFig[id] = f; return f; };
  mk('GER', '#0f4c8a', '#5a3a22', [-8, 0.05, 15.5]); mk('PAT', '#e9e2d0', '#2b1d14', [-6, 0.05, 16]); mk('LOC', '#7b3b62', '#9a9a9a', [-9.5, 0.05, 16.2]);
}
// ------------------------------------------------------------------ fumees, jets
let smoke, smokeGeo, P;
function buildFx() {
  const N = quality === 'standard' ? 2600 : 1000;
  P = { n: N, pos: new Float32Array(N * 3), vel: new Float32Array(N * 3), size: new Float32Array(N), alpha: new Float32Array(N), shade: new Float32Array(N), life: new Float32Array(N), max: new Float32Array(N), next: 0, kind: new Uint8Array(N) };
  smokeGeo = new T.BufferGeometry();
  smokeGeo.setAttribute('position', new T.BufferAttribute(P.pos, 3)); smokeGeo.setAttribute('size', new T.BufferAttribute(P.size, 1));
  smokeGeo.setAttribute('alpha', new T.BufferAttribute(P.alpha, 1)); smokeGeo.setAttribute('shade', new T.BufferAttribute(P.shade, 1));
  const mat = new T.ShaderMaterial({
    uniforms: { map: { value: TEX.smoke }, scale: { value: 1 }, lin: { value: 0 }, fogColor: { value: new T.Color('#b9c4cf') } },
    vertexShader: `attribute float size; attribute float alpha; attribute float shade; varying float vA; varying float vS; varying float vD;
      uniform float scale; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vA = alpha; vS = shade; vD = -mv.z;
      gl_PointSize = size * scale / -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform sampler2D map; uniform vec3 fogColor; uniform float lin; varying float vA; varying float vS; varying float vD;
      void main(){ vec4 t = texture2D(map, gl_PointCoord); vec3 c = mix(vec3(vS), fogColor, clamp(vD/420.0,0.0,0.7)); float a = t.a * vA;
      if (lin > 0.5) { c = pow(c, vec3(2.2)); a = min(1.0, a * 1.2); } gl_FragColor = vec4(c, a); if (gl_FragColor.a < 0.01) discard; }`,
    transparent: true, depthWrite: false,
  });
  smoke = new T.Points(smokeGeo, mat); smoke.frustumCulled = false; scene.add(smoke);
}
function emit(x, y, z, vx, vy, vz, size, shade, life, kind) {
  const i = P.next; P.next = (P.next + 1) % P.n;
  P.pos[i * 3] = x; P.pos[i * 3 + 1] = y; P.pos[i * 3 + 2] = z; P.vel[i * 3] = vx; P.vel[i * 3 + 1] = vy; P.vel[i * 3 + 2] = vz;
  P.size[i] = size; P.shade[i] = shade; P.life[i] = 0; P.max[i] = life; P.alpha[i] = 0; P.kind[i] = kind || 0;
}
function stepSmoke(dt) {
  const wind = (G.W.wind || 10) / 10 * 1.6;   // m/s vers l'est (vent d'ouest)
  for (let i = 0; i < P.n; i++) {
    if (P.max[i] <= 0) continue;
    P.life[i] += dt; const k = P.life[i] / P.max[i];
    if (k >= 1) { P.max[i] = 0; P.alpha[i] = 0; continue; }
    if (P.kind[i] === 1) {   // eau : trajectoire balistique
      P.vel[i * 3 + 1] -= 9.81 * dt;
      P.alpha[i] = 0.55 * (1 - k);
    } else {
      P.vel[i * 3 + 1] += dt * 1.1 * (1 - k) * (G.W.wind >= 30 ? 0.5 : 1); P.vel[i * 3] += (wind * (0.4 + k) - P.vel[i * 3]) * dt * 0.35;
      P.vel[i * 3 + 2] *= (1 - dt * 0.4);
      P.size[i] += dt * 2.2 * (1 - k * 0.5);
      P.alpha[i] = (k < 0.06 ? k / 0.06 : Math.pow(1 - (k - 0.06) / 0.94, 1.2)) * (P.shade[i] < 0.3 ? 0.9 : 0.6);
    }
    P.pos[i * 3] += P.vel[i * 3] * dt; P.pos[i * 3 + 1] += P.vel[i * 3 + 1] * dt; P.pos[i * 3 + 2] += P.vel[i * 3 + 2] * dt;
  }
  smokeGeo.attributes.position.needsUpdate = true; smokeGeo.attributes.size.needsUpdate = true; smokeGeo.attributes.alpha.needsUpdate = true; smokeGeo.attributes.shade.needsUpdate = true;
}
function tube(points, color) { const curve = new T.CatmullRomCurve3(points); return new T.Mesh(new T.TubeGeometry(curve, 40, 0.06, 6, false), std(color, { roughness: 0.6 })); }

// ------------------------------------------------------------------ mise a jour
let cutOn = false;
S3.setCut = v => { cutOn = v; if (v) S3.view('dessus'); };
S3.isCut = () => cutOn;
function actorWorld(a) {
  const P0 = GAME.POS[a.loc] || GAME.POS.ENGIN;
  let p = P0;
  if (a.next && a.prog > 0) { const Q = GAME.POS[a.next] || P0, k = clamp(a.prog, 0, 1); p = [P0[0] + (Q[0] - P0[0]) * k, P0[1] + (Q[1] - P0[1]) * k]; }
  if (a.loc === 'ENGIN' && !(a.next && a.prog > 0)) { const v = PARK[(GAME.fptOf(a) || 'FPT1')] || PARK.FPT1; const i = a.role === 'BAT' ? 0 : 1; return new T.Vector3(v[0] - 2 + i * 2.4, 0.05, 3.2); }
  const idx = G.actors.indexOf(a) % 4;
  return new T.Vector3(p[0] + (idx - 1.5) * 1.1, a.loc === 'INT' ? 0.05 : 0.05, -p[1] + (idx % 2) * 0.8);
}
S3.update = function (dtReal, now) {
  const W = G.W;
  // feu par volume : flammes, toiture, fumees
  let fl = [];
  W.cells.forEach((c, n) => {
    const fx = cellFx[n], r = roofs[n];
    const q = c.on ? c.q : 0;
    fx.grp.visible = q > 0.05;
    if (fx.grp.visible) {
      const hh = 2 + 7 * q;
      fx.arr.forEach((s, j) => { const f = (0.7 + 0.3 * Math.sin(now / 80 + j * 1.7 + n)); s.position.set(s.userData.ox, hh * 0.35 * f, s.userData.oz); s.scale.set(2.2 + 2.5 * q, hh * f, 1); s.visible = j < 2 + Math.round(q * 4); });
      fx.halo.scale.setScalar(8 + 14 * q); fx.halo.material.opacity = 0.25 + 0.2 * q;
      fl.push([q, fx.x, fx.z]);
      const rate = q * (quality === 'standard' ? 26 : 11) * dtReal;
      for (let k = 0; k < Math.floor(rate + Math.random()); k++) emit(fx.x + (Math.random() - 0.5) * 8, 5 + Math.random() * 2, fx.z + (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 0.6, 3 + Math.random() * 2.5 * q, (Math.random() - 0.5) * 0.6, 3 + Math.random() * 2, 0.05 + Math.random() * 0.07, 16 + Math.random() * 10);
    }
    // toiture qui s'affaisse puis disparait
    const burnt = 1 - c.fuel;
    r.visible = burnt < 0.55 || !c.on && burnt < 0.7;
    r.position.y = r.userData.base - clamp(burnt * 2.2, 0, 1.2);
    r.material.color.setScalar(1 - clamp(burnt * 1.4, 0, 0.8));
  });
  fl.sort((a, b) => b[0] - a[0]);
  fireLights.forEach((L, k) => { const f = fl[k]; if (f) { L.position.set(f[1], 7, f[2]); L.intensity = 900 * f[0] * (0.85 + 0.15 * Math.sin(now / 60 + k)); } else L.intensity = 0; });
  // stock de gaz : torchere, explosion
  torch.visible = G.gaz.soupape && !G.gaz.bleve; torch.scale.set(0.9, 2.6 * (0.8 + 0.2 * Math.sin(now / 50)), 1);
  if (G.gaz.bleve) { if (S3.bleveT == null) S3.bleveT = now; const k = (now - S3.bleveT) / 2500; fireball.visible = k < 1; fireball.scale.setScalar(4 + 30 * Math.sqrt(clamp(k, 0, 1))); fireball.material.opacity = 1 - k; bottles.visible = false; }
  if (G.gaz.soupape && !G.gaz.bleve && Math.random() < dtReal * 3) emit(-24, 3, -9.5, 0.3, 2, 0, 1.5, 0.3, 6);
  hlmFire.visible = G.hlm.fire; hlmFire.children.forEach((s, j) => s.scale.set(1.4, 2.4 * (0.75 + 0.25 * Math.sin(now / 70 + j)), 1));
  if (G.hlm.fire && Math.random() < dtReal * 8) emit(27.5, 5, -16 - Math.random() * 4, 0.5, 1.5, 0, 2, 0.08, 12);
  // engins
  const blink = Math.floor(now / 160) % 3 === 0;
  const vis = { GSAP1: G.actors.some(a => a.id === 'GSAP' && a.loc !== 'ABSENT'), GSAP2: G.actors.some(a => a.id === 'GSAP' && a.loc !== 'ABSENT'), VLI: G.actors.some(a => a.id === 'GSAP' && a.loc !== 'ABSENT'),
    FPT3: G.actors.some(a => a.engin === 'FPT 3'), FPT4: G.actors.some(a => a.engin === 'FPT 4'), PC: !!(G.passation), GALIM: !!(G.requests.GALIM && G.requests.GALIM.onSite) };
  for (const id in vehicles) {
    const g = vehicles[id];
    if (id in vis) { if (vis[id] && !g.visible) { g.visible = true; g.userData.arrive = 0; } if (!vis[id]) g.visible = false; }
    if (g.userData.arrive != null && g.userData.arrive < 1 && PARK[id]) { g.userData.arrive = Math.min(1, g.userData.arrive + dtReal / 4); const k = 1 - Math.pow(1 - g.userData.arrive, 3); g.position.x = PARK[id][0] + 70 * (1 - k); }
    g.userData.blue.emissiveIntensity = blink ? 3 : 0.2;
    g.userData.halos.forEach((h, k) => { h.material.opacity = (k % 2 ? !blink : blink) ? 0.7 : 0.05; });
  }
  // echelle
  const pa = G.actors.find(a => a.id === 'PA'), gpa = vehicles.PA;
  const S = GAME.SLOTS.PA, mv = G.moves.PA;
  let tx, tz;
  if (mv) { const k = clamp((W.t - mv.t0) / (mv.t1 - mv.t0), 0, 1), A = S[mv.from].xz, B = S[mv.to].xz; tx = A[0] + (B[0] - A[0]) * k; tz = A[1] + (B[1] - A[1]) * k; } else [tx, tz] = S[G.vpos.PA].xz;
  gpa.position.x += (tx - gpa.position.x) * Math.min(1, dtReal * 3); gpa.position.z += (tz - gpa.position.z) * Math.min(1, dtReal * 3);
  gpa.rotation.y = G.vpos.PA === 'est' && !mv ? Math.PI / 2 : 0;
  const tgt = pa.mission === 'LANCE_EPA' ? new T.Vector3(0, 7, -10) : pa.mission === 'LANCE_EPA_HLM' ? new T.Vector3(27, 9, -17) : pa.mission === 'RECO_EPA' ? new T.Vector3(0, 12, -14) : null;
  let p = 0; const st = pa.plan[0];
  if (tgt) p = pa.stationed ? 1 : st && st.d ? clamp((st.t || 0) / st.d, 0, 1) : 0;
  ladderProg += (p - ladderProg) * Math.min(1, dtReal * 2);
  if (tgt) {
    const base = new T.Vector3(); turntable.getWorldPosition(base);
    const d = tgt.clone().sub(base); const yaw = Math.atan2(-d.z, d.x) - gpa.rotation.y, hor = Math.hypot(d.x, d.z);
    turntable.rotation.y = yaw * clamp(ladderProg * 2, 0, 1); ladder.rotation.z = Math.atan2(d.y - 0.6, hor) * clamp(ladderProg * 1.6, 0, 1);
    ladder.scale.x = 1 + (Math.min(d.length() * 0.85, 26) / ladder.userData.LL - 1) * clamp((ladderProg - 0.4) / 0.6, 0, 1);
    if (pa.flowing && ladderProg > 0.95) { const tip = new T.Vector3(ladder.userData.LL * ladder.scale.x, 0, 0); ladder.localToWorld(tip); for (let k = 0; k < Math.floor(dtReal * 40 + Math.random()); k++) { const dir = tgt.clone().sub(tip).normalize(); emit(tip.x, tip.y, tip.z, dir.x * 16 + (Math.random() - 0.5), dir.y * 16 + 3, dir.z * 16 + (Math.random() - 0.5), 0.9, 0.92, 1.4, 1); } }
  } else { turntable.rotation.y *= 0.95; ladder.rotation.z *= 0.95; ladder.scale.x += (1 - ladder.scale.x) * 0.05; }
  // binomes, tuyaux et jets
  for (const a of G.actors) {
    if (a.kind !== 'binome') continue;
    const t = teams[a.id] || teamGroup(a);
    const pp = actorWorld(a), prev = t.pos.clone(); t.pos.copy(pp);
    t.group.position.lerp(pp, Math.min(1, dtReal * 6));
    if (prev.distanceTo(pp) > 0.001) t.heading = Math.atan2(pp.x - prev.x, pp.z - prev.z);
    const tc = a.target && a.target.length ? (() => { const [i, j] = a.target[0]; const [x, y] = GAME.cellXY(i, j); return new T.Vector3(x, 2.5, -y); })() : null;
    const face = a.flowing && tc ? Math.atan2(tc.x - pp.x, tc.z - pp.z) : t.heading;
    t.group.rotation.y += (face - t.group.rotation.y) * Math.min(1, dtReal * 5);
    const walking = !!a.next && a.prog > 0;
    t.figs.forEach((f, j) => f.children.forEach(c => { if (c.userData.leg) c.rotation.x = walking ? Math.sin(now / 120 + j) * 0.5 * c.userData.leg : 0; }));
    t.figs.forEach(f => f.visible = a.loc !== 'INT' && a.loc !== 'HLM');
    t.label.visible = S3.labelsOn;
    // tuyau depuis l'engin
    if (a.lanceOn && !t.hose) { const v = PARK[GAME.fptOf(a)] || PARK.FPT1; t.hose = tube([new T.Vector3(v[0], 0.9, v[1] - 1.2), new T.Vector3(v[0], 0.1, v[1] - 3.5), new T.Vector3((v[0] + pp.x) / 2, 0.1, (v[1] + pp.z) / 2 - 1), new T.Vector3(pp.x, 0.1, pp.z + 0.6), new T.Vector3(pp.x, 0.9, pp.z)], '#e9e6dc'); scene.add(t.hose); }
    if (t.hose && !a.lanceOn) { scene.remove(t.hose); t.hose.geometry.dispose(); t.hose = null; }
    // jet de lance
    if (a.flowing && a.flow > 20) {
      const dest = tc || (a.loc === 'GAZ' ? new T.Vector3(-24.5, 2.5, -10) : a.loc === 'HLM_F' ? new T.Vector3(27.5, 6, -16) : null);
      if (dest) { const o = pp.clone().add(new T.Vector3(0, 1.3, 0)), dir = dest.clone().sub(o); const L = dir.length(); dir.normalize(); const v = Math.min(22, Math.sqrt(L * 9.81) * 1.05); const n = Math.floor(dtReal * (a.flow / 15) + Math.random());
        for (let k = 0; k < n; k++) emit(o.x, o.y, o.z, dir.x * v + (Math.random() - 0.5) * 0.8, dir.y * v + v * 0.45, dir.z * v + (Math.random() - 0.5) * 0.8, 0.7 + Math.random() * 0.5, 0.9, 1.6, 1); }
    }
    // bulle de compte rendu
    const cr = a.lastCR;
    if (cr !== t.crRef) { t.crRef = cr; if (t.bubble) { t.group.remove(t.bubble); t.bubble.material.map.dispose(); t.bubble = null; }
      if (cr) { const col = { alerte: '#e2373f', victime: '#2fb36b', feu: '#ff7a2a', ok: '#2fb36b', fumee: '#8d9db0', info: '#9a72ff' }[cr.icon] || '#9a72ff'; let txt = cr.text.replace(/^Binôme d'(attaque|alimentation) : /, '').split(/(?<=[.!])\s/)[0]; if (txt.length > 46) txt = txt.slice(0, 44) + '…'; t.bubble = label(txt, col, { scale: 0.008, always: true, size: 34 }); t.bubble.position.set(0, 3.25, 0); t.group.add(t.bubble); } }
    if (t.bubble) t.bubble.visible = S3.labelsOn && cr && W.t - cr.t < 40;
  }
  // foule des evacues et brule
  const ti = G.tiers, from = GAME.POS[ti.loc] || GAME.POS.TROTTOIR, to = ti.moving ? GAME.POS[ti.moving.to] : from, k = ti.moving ? clamp(ti.moving.t / ti.moving.d, 0, 1) : 0;
  const cx = from[0] + (to[0] - from[0]) * k, cy = from[1] + (to[1] - from[1]) * k;
  crowd.forEach((f, j) => { const tx2 = cx + f.userData.off[0], tz2 = -cy + f.userData.off[1]; const moving = !!ti.moving; f.position.x += (tx2 - f.position.x) * Math.min(1, dtReal * 2); f.position.z += (tz2 - f.position.z) * Math.min(1, dtReal * 2); f.position.y = 0.05; f.children.forEach(c => { if (c.userData.leg) c.rotation.x = moving ? Math.sin(now / 130 + j) * 0.45 * c.userData.leg : 0; }); if (!moving) f.rotation.y = Math.atan2(0 - f.position.x, -15 - f.position.z) * 0.6; });
  S3.crowdPick.position.set(cx, 1, -cy);
  const ua = G.victims[0]; uaFig.visible = !ua.evac; uaFig.position.set(GAME.POS.UA[0], 0.35, -GAME.POS.UA[1]);
  // temoins
  for (const w of G.witnesses) { const f = witnessFig[w.id]; f.visible = w.present; if (w.present) { const m = f.userData.marker; m.visible = GAME.availableQuestions(w.id).length > 0; m.position.y = 2.25 + Math.sin(now / 300) * 0.08; } }
  stepSmoke(dtReal);
  smoke.material.uniforms.lin.value = composer ? 1 : 0;
  smoke.material.uniforms.scale.value = renderer.domElement.height / 2 * camera.projectionMatrix.elements[5];
  controls.update();
  if (composer) composer.render(); else renderer.render(scene, camera);
};
// ------------------------------------------------------------------ selection et vues
const ray = new T.Raycaster(), mouse = new T.Vector2(); ray.layers.enableAll();
S3.pick = function (cx, cy) {
  const r = renderer.domElement.getBoundingClientRect();
  mouse.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(mouse, camera);
  for (const id in teams) { const hit = ray.intersectObject(teams[id].label, false); if (hit.length) return { type: 'team', id }; }
  const hits = ray.intersectObjects(pickables.filter(m => isVisibleChain(m)), false);
  for (const h of hits) { let o = h.object; while (o && !o.userData.pick) o = o.parent; if (o) return o.userData.pick; }
  return null;
};
function isVisibleChain(o) { while (o) { if (!o.visible) return false; o = o.parent; } return true; }
S3.view = function (name) {
  const views = { rue: [[30, 16, 50], [0, 3, -12]], arriere: [[-20, 28, -85], [0, 3, -15]], aerien: [[80, 75, 70], [0, 0, -12]], coupe: [[0, 120, 12], [0, 0, -12]], dessus: [[0, 120, 12], [0, 0, -12]] };
  const v = views[name]; if (!v) return;
  S3.anim = { from: camera.position.clone(), to: new T.Vector3(...v[0]), tf: controls.target.clone(), tt: new T.Vector3(...v[1]), k: 0 };
};
S3.tickCamera = function (dt) {
  const a = S3.anim; if (!a) return;
  a.k = Math.min(1, a.k + dt / 1.2); const e = a.k < 0.5 ? 2 * a.k * a.k : 1 - Math.pow(-2 * a.k + 2, 2) / 2;
  camera.position.lerpVectors(a.from, a.to, e); controls.target.lerpVectors(a.tf, a.tt, e);
  if (a.k >= 1) S3.anim = null;
};
S3.screenOf = function (obj3) { const v = obj3.clone().project(camera); const r = renderer.domElement.getBoundingClientRect(); return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height }; };
S3._dbg = () => ({ scene, camera, renderer, composer, T });
