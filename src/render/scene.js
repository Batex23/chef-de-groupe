// =============================================================================
// Rendu 3D de l'intervention (Three.js r169, modules ES).
// Expose window.S3, utilisé par l'interface (src/ui/app.js).
// =============================================================================
import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { pbr, plain, setTextureResolution } from './materials.js';
import { createFdsSmoke } from './fdsvol.js';
import { Batch, wallGeometry, wallMatrix, windowKit, balcony, genericBuilding, CLIP } from './building.js';
const GAME = window.GAME;
const { layerRel, conditionsAt, roomOnFire, clamp } = SIM;
const S3 = window.S3 = {};
let renderer, scene, camera, controls, quality = 'standard', fds = null;
const pickables = [];
const R3 = 7.8, LV = 2.6;
const TEAM_COLORS = { BAT1: '#ff8a3d', BAL1: '#35c4e0', BAT2: '#f5c542', BAL2: '#4fd1a5' };
S3.TEAM_COLORS = TEAM_COLORS;

// ------------------------------------------------------------------ textures
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
  TEX.plaster = canvasTex(256, 256, (c, w, h) => {
    noise(c, w, h, '#a89a86', 0.12, 9000);
    for (let i = 0; i < 14; i++) { // coulures
      const x = Math.random() * w; const g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, 'rgba(60,50,40,0.10)'); g.addColorStop(1, 'rgba(60,50,40,0)');
      c.fillStyle = g; c.fillRect(x, 0, 2 + Math.random() * 4, h * (0.3 + Math.random() * 0.6));
    }
  }, [3, 2]);
  TEX.base = canvasTex(256, 128, (c, w, h) => {
    noise(c, w, h, '#857b70', 0.12, 6000);
    c.strokeStyle = 'rgba(40,35,30,0.35)'; c.lineWidth = 1;
    for (let y = 0; y < h; y += 16) { c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); }
  }, [4, 1]);
  TEX.asphalt = canvasTex(512, 512, (c, w, h) => noise(c, w, h, '#2b2e32', 0.12, 40000), [10, 4]);
  TEX.sidewalk = canvasTex(256, 256, (c, w, h) => {
    noise(c, w, h, '#6a6862', 0.10, 8000);
    c.strokeStyle = 'rgba(30,30,30,0.35)';
    for (let i = 0; i <= w; i += 64) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i, h); c.stroke(); c.beginPath(); c.moveTo(0, i); c.lineTo(w, i); c.stroke(); }
  }, [16, 2]);
  TEX.grass = canvasTex(256, 256, (c, w, h) => noise(c, w, h, '#28351f', 0.18, 14000), [8, 4]);
  TEX.wood = canvasTex(128, 128, (c, w, h) => { noise(c, w, h, '#7a5a3c', 0.08, 3000); c.strokeStyle = 'rgba(40,25,10,0.3)'; for (let y = 0; y < h; y += 12) { c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); } }, [3, 3]);
  TEX.tiles = canvasTex(128, 128, (c, w, h) => { noise(c, w, h, '#a8a69f', 0.06, 2000); c.strokeStyle = 'rgba(60,60,60,0.4)'; for (let i = 0; i <= w; i += 32) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i, h); c.stroke(); c.beginPath(); c.moveTo(0, i); c.lineTo(w, i); c.stroke(); } }, [3, 3]);
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
  TEX.cityWin = canvasTex(256, 256, (c, w, h) => {
    noise(c, w, h, '#2a2c33', 0.06, 3000);
    for (let y = 14; y < h; y += 40) for (let x = 12; x < w; x += 36) {
      c.fillStyle = Math.random() < 0.35 ? `rgba(230,185,110,${0.6 + Math.random() * 0.4})` : '#15181d'; c.fillRect(x, y, 18, 22);
    }
  }, [1, 1]);
}

// ------------------------------------------------------------------ helpers
const MAT = {};
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
// ------------------------------------------------------------------ init
S3.init = function (canvas, q) {
  quality = q || 'standard';
  renderer = new T.WebGLRenderer({ canvas, antialias: quality !== 'standard', powerPreference: 'high-performance' });
  renderer.setPixelRatio(quality === 'standard' ? Math.min(devicePixelRatio, 1.75) : 1);
  renderer.localClippingEnabled = true;
  renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
  renderer.shadowMap.enabled = quality === 'standard'; renderer.shadowMap.type = T.PCFSoftShadowMap;
  scene = new T.Scene();
  scene.background = new T.Color('#0b1322');
  scene.fog = new T.FogExp2('#0b1322', 0.011);
  camera = new T.PerspectiveCamera(42, 1, 0.3, 400); camera.layers.enable(1);
  camera.position.set(15, 7.5, 16.5);
  controls = new OrbitControls(camera, canvas);
  controls.target.set(4, 6, -4); controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.minDistance = 8; controls.maxDistance = 80; controls.maxPolarAngle = 1.48;
  controls.screenSpacePanning = true;
  setTextureResolution(quality === 'standard' ? 512 : 256);
  makeTextures();
  buildLights(); buildSky(); buildGround(); buildBuilding(); buildDetails(); buildR3Interior(); buildVehicles(); buildPeople(); buildFx();
  // reflets d'environnement (carrosseries, vitrages) : intensite faible de nuit
  try {
    const pm = new T.PMREMGenerator(renderer);
    scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.35;
    scene.traverse(o => { const ms = Array.isArray(o.material) ? o.material : [o.material]; for (const m of ms) if (m && m.isMeshStandardMaterial) m.envMapIntensity = m.userData.env != null ? m.userData.env : 0.25; });
  } catch (e) { console.warn('environnement indisponible', e); }
  let fxi = ''; try { fxi = localStorage.getItem('cdg-fx') || ''; } catch (e) { }
  if (quality === 'standard' && !fxi.includes('nocomposer')) buildComposer();
  // fumee des calculs FDS (si les donnees sont publiees avec le jeu)
  if (!fxi.includes('nofds') && typeof DecompressionStream !== 'undefined') {
    fds = S3.fds = createFdsSmoke(T, scene, { R3, light: quality !== 'standard' });
    // les conditions du jeu (victimes, binomes, observations) sont lues dans le calcul FDS affiche
    SIM.FDS_HOOK.fn = (zid, hrel, t) => {
      if (!fds.info().on) return null;
      let p;
      if (zid === 'CAGE') p = [-1.5, hrel, -6.8];
      else if (ROOM_RECT[zid]) { const [x1, x2, y1, y2] = ROOM_RECT[zid]; p = [(x1 + x2) / 2, R3 + Math.min(2.4, Math.max(0.2, hrel)), -(y1 + y2) / 2]; }
      else return null;
      const ev = (window.G && G.fdsEv) || {}; if (window.G) ev.attack = G.attackT, ev.vpp = G.vppT;
      const q = fds.sampleAt(ev, t, ...p); if (!q) return null;
      return { T: q.T + 273.15, O2: q.O2, CO: q.CO, vis: Math.min(30, q.VIS), smoke: q.VIS < 10, fds: true };
    };
    fetch('data/fds/index.json').then(r => r.ok ? r.json() : null).then(ix => {
      if (!ix || !ix.cas || !ix.cas.length) return;
      const first = 'R1_PORTE_PALIERE_OUVERTE', list = ix.cas.includes(first) ? [first, ...ix.cas.filter(c => c !== first)] : ix.cas;
      fds.start(list);
    }).catch(() => {});
  }
  S3.resize();
  window.addEventListener('resize', S3.resize);
};
S3.resize = function () {
  const c = renderer.domElement, w = c.clientWidth || innerWidth, h = c.clientHeight || innerHeight;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  if (composer) { composer.setSize(w, h); }
};
let composer = null;
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
S3.autoRotate = v => { controls.autoRotate = v; controls.autoRotateSpeed = 0.35; S3.labelsOn = !v; if (v) camera.layers.disable(1); else camera.layers.enable(1); };
S3.labelsOn = true;

// ------------------------------------------------------------------ lumieres
let fireLight, fireLight2, strobe;
function buildLights() {
  scene.add(new T.HemisphereLight('#7d90b4', '#2a2620', 1.6));
  // projecteurs d'eclairage de zone (mat du FPT et du VSAV) braques sur la facade
  for (const [x, z, tx] of [[-3.0, 12.5, 2.0], [13.0, 12.5, 7.0]]) {
    const sp = new T.SpotLight('#fff1d6', 160, 70, 0.6, 0.7, 2); sp.position.set(x, 7.5, z); sp.target.position.set(tx, 6.5, -1); scene.add(sp); scene.add(sp.target);
  }
  const moon = new T.DirectionalLight('#a9bde0', 1.3); moon.position.set(-30, 40, 25);
  if (quality === 'standard') { moon.castShadow = true; moon.shadow.mapSize.set(1024, 1024); const sc = moon.shadow.camera; sc.left = -30; sc.right = 30; sc.top = 30; sc.bottom = -20; sc.far = 120; }
  scene.add(moon);
  for (const x of [-9, 19]) {
    const pole = box(0.18, 6.5, 0.18, std('#2d3136', { metalness: 0.6 }), x, 0, 2.6, null, true);
    box(1.4, 0.12, 0.3, std('#2d3136'), x - 0.6, 6.5, 2.6);
    const bulb = new T.Mesh(new T.SphereGeometry(0.16, 10, 8), new T.MeshBasicMaterial({ color: '#ffd59a' })); bulb.position.set(x - 1.1, 6.38, 2.6); scene.add(bulb);
    glow('#ffb46b', 3.2, null, x - 1.1, 6.3, 2.6, 0.5);
    const L = new T.PointLight('#ffb46b', 70, 26, 2); L.position.set(x - 1.1, 6.2, 2.6); scene.add(L);
  }
  fireLight = new T.PointLight('#ff7a2a', 0, 24, 2); fireLight.position.set(2.6, R3 + 1.4, -2.4); scene.add(fireLight);
  fireLight2 = new T.PointLight('#ff6a1a', 0, 16, 2); fireLight2.position.set(2.8, R3 + 2.2, 1.2); scene.add(fireLight2);
  if (quality === 'standard') { strobe = new T.PointLight('#3d7dff', 0, 18, 2); strobe.position.set(-0.5, 3.4, 5.2); scene.add(strobe); }
}

// ------------------------------------------------------------------ ciel
function buildSky() {
  const mat = new T.ShaderMaterial({
    side: T.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new T.Color('#03070f') }, mid: { value: new T.Color('#0d1830') }, glow: { value: new T.Color('#3a2a2a') } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 mid; uniform vec3 glow; varying vec3 vP; void main(){ float h = clamp(vP.y, 0.0, 1.0); vec3 c = mix(mid, top, pow(h, 0.55)); c += glow * pow(1.0 - h, 6.0) * 0.9; gl_FragColor = vec4(c, 1.0); }',
  });
  const sky = new T.Mesh(new T.SphereGeometry(320, 32, 16), mat); scene.add(sky);
  const n = 700, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const th = Math.random() * Math.PI * 2, ph = Math.acos(0.15 + Math.random() * 0.85); pos[i * 3] = 300 * Math.sin(ph) * Math.cos(th); pos[i * 3 + 1] = 300 * Math.cos(ph); pos[i * 3 + 2] = 300 * Math.sin(ph) * Math.sin(th); }
  const sg = new T.BufferGeometry(); sg.setAttribute('position', new T.BufferAttribute(pos, 3));
  scene.add(new T.Points(sg, new T.PointsMaterial({ color: '#cfd8ea', size: 1.1, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.8 })));
  scene.background = null;
}
// ------------------------------------------------------------------ details d'immeuble et de rue
function planeUV(w, h) { const g = new T.PlaneGeometry(w, h); const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w, uv.getY(i) * h); return g; }
function buildDetails() {
  // arbres
  const bark = std('#3b2c22'), leaf = std('#1f3320', { roughness: 0.9 }), leaf2 = std('#2a4329', { roughness: 0.9 });
  const tree = (x, z, s) => {
    const g = new T.Group(); g.position.set(x, 0, z); g.scale.setScalar(s); scene.add(g);
    const tr = new T.Mesh(new T.CylinderGeometry(0.12, 0.2, 2.8, 8), bark); tr.position.y = 1.4; tr.castShadow = true; g.add(tr);
    for (let k = 0; k < 6; k++) { const f = new T.Mesh(new T.IcosahedronGeometry(0.9 + Math.random() * 0.6, 2), k % 2 ? leaf : leaf2); f.position.set((Math.random() - 0.5) * 1.8, 3.0 + Math.random() * 1.6, (Math.random() - 0.5) * 1.8); if (quality === 'standard') f.castShadow = true; g.add(f); }
  };
  [[-6, -13, 1.2], [3, -15, 1.4], [12, -12.5, 1.1], [20, -15, 1.3], [-14, -14, 1.2], [26.5, 1.6, 0.9], [-19, 1.6, 0.9]].forEach(t => tree(...t));
  box(16, 0.5, 0.25, pbr('concrete'), 4, 0, -10.5, null, true);
  // mobilier urbain : bancs, potelets, poubelles
  for (let x = -6; x < 16; x += 2.4) box(0.1, 0.9, 0.1, std('#2a2e33', { metalness: 0.6, roughness: 0.4 }), x, 0.14, 3.0, null, true);
}

// ------------------------------------------------------------------ sol / environnement
function buildGround() {
  const road = new T.Mesh(planeUV(160, 12), pbr('asphalt'));
  road.rotation.x = -Math.PI / 2; road.position.set(4, 0, 8.6); road.receiveShadow = true; scene.add(road);
  const walk = new T.Mesh(planeUV(160, 3.2), pbr('pavement')); walk.rotation.x = -Math.PI / 2; walk.position.set(4, 0.14, 1.6); walk.receiveShadow = true; scene.add(walk);
  box(160, 0.14, 3.2, plain('#55534e'), 4, 0, 1.6, null, true).visible = true;
  box(160, 0.16, 0.25, pbr('concrete'), 4, 0, 3.15, null, true);
  const walk2 = new T.Mesh(planeUV(160, 3), pbr('pavement')); walk2.rotation.x = -Math.PI / 2; walk2.position.set(4, 0.14, 16.1); scene.add(walk2);
  box(160, 0.14, 3, plain('#55534e'), 4, 0, 16.1, null, true);
  const yard = new T.Mesh(planeUV(160, 40), pbr('grass')); yard.rotation.x = -Math.PI / 2; yard.position.set(4, 0.01, -29); yard.receiveShadow = true; scene.add(yard);
  const far = new T.Mesh(planeUV(160, 60), pbr('asphalt')); far.rotation.x = -Math.PI / 2; far.position.set(4, -0.02, 47); scene.add(far);
  for (let x = -70; x < 80; x += 6) box(3, 0.02, 0.15, std('#c9c5b8', { roughness: 0.6 }), x, 0.005, 8.6, null, true);
  // passage piéton
  for (let k = 0; k < 6; k++) box(0.5, 0.02, 4.2, std('#c9c5b8', { roughness: 0.6 }), -24 + k * 0.9, 0.006, 8.6, null, true);
  // immeubles voisins (kit de façade)
  genericBuilding(scene, { x: -17, z: 0, w: 12, d: 10, levels: 4, mat: 'brick', seed: 3, bay: 3 });
  genericBuilding(scene, { x: 15, z: 0, w: 12, d: 10, levels: 4, mat: 'plaster', seed: 7, bay: 3 });
  S3.opposite = new T.Group(); scene.add(S3.opposite);
  genericBuilding(S3.opposite, { x: -26, z: 30, w: 30, d: 10, levels: 5, mat: 'plaster', seed: 11, bay: 3 });
  genericBuilding(S3.opposite, { x: 10, z: 30, w: 24, d: 10, levels: 4, mat: 'brick', seed: 19, bay: 3 });
  // PI (poteau incendie)
  const pi = new T.Group(); pi.position.set(13.2, 0.14, 2.6); scene.add(pi);
  const red = std('#c4161c', { roughness: 0.45, metalness: 0.2 });
  const body = new T.Mesh(new T.CylinderGeometry(0.16, 0.18, 0.9, 16), red); body.position.y = 0.45; pi.add(body);
  const cap0 = new T.Mesh(new T.SphereGeometry(0.17, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), red); cap0.position.y = 0.9; pi.add(cap0);
  for (const s of [1, -1]) { const n = new T.Mesh(new T.CylinderGeometry(0.06, 0.06, 0.16, 12), red); n.rotation.z = Math.PI / 2; n.position.set(s * 0.2, 0.62, 0); pi.add(n); }
  const pil = label('PI 150', '#3a8eea', { scale: 0.008 }); pil.position.set(13.2, 1.7, 2.6); scene.add(pil);
  S3.hydrant = new T.Vector3(13.2, 0.6, 2.6);
  // voitures garees
  const car = (x, z, col) => {
    const g = new T.Group(); g.position.set(x, 0, z); scene.add(g);
    const p = std(col, { roughness: 0.3, metalness: 0.5 }); p.userData.env = 0.8;
    const gl = std('#0d1218', { roughness: 0.05, metalness: 0.9 }); gl.userData.env = 1;
    rbox(4.3, 0.7, 1.8, 0.2, p, g, 0, 0.62, 0); rbox(2.3, 0.62, 1.62, 0.25, gl, g, -0.25, 1.2, 0);
    const tyre = new T.CylinderGeometry(0.33, 0.33, 0.22, 16); tyre.rotateX(Math.PI / 2);
    for (const xx of [1.35, -1.35]) for (const zz of [0.82, -0.82]) { const w = new T.Mesh(tyre, std('#111')); w.position.set(xx, 0.33, zz); g.add(w); }
  };
  car(-16, 12.6, '#59626e'); car(24, 12.6, '#7a2e2e'); car(31, 4.4, '#3a4d5e'); car(-30, 4.4, '#d0d0cc');
}

// ------------------------------------------------------------------ immeuble (kit de facade)
const FRONT_WIN = [['W_SEJ1', 1.0, 2.4, 0.8, 2.2], ['W_SEJ2', 3.4, 4.8, 0.8, 2.2], ['W_CUI', 6.4, 7.6, 1.0, 2.2], ['W_CH1', 9.0, 10.2, 0.8, 2.2]];
const BACK_WIN = [['W_CH2', 1.2, 2.6, 0.8, 2.2], ['W_SDB', 4.6, 5.4, 1.4, 2.1], ['W_CH3', 7.8, 9.4, 0.8, 2.2]];
const LIT = { 0: [1, 0, 1, 0, 0, 1, 0], 1: [0, 1, 1, 0, 1, 0, 0], 2: [1, 0, 0, 1, 0, 0, 1], 4: [1, 1, 0, 1, 1, 0, 0] };
const SHUT = { 0: [0, 0.6, 0, 1, 0.3, 0, 0], 1: [0.4, 0, 0, 0.8, 0, 0.5, 1], 2: [0, 0.3, 0.9, 0, 0, 1, 0], 4: [0, 0, 0.7, 0.2, 0, 0.6, 0.4] };
const upper = [];      // objets masques en vue en coupe
const winR3 = {};      // vitrages du R+3 pilotes par la simulation
const cageWins = {};
let cageDoor, exuLid, neighbourFig, r3WinGroup, upperGroup, r3Int;
const levelGroups = [], winGroups = [];   // un groupe par niveau (coupe a n'importe quel etage)
const clipCache = new Map();
function clipped(m) {
  if (clipCache.has(m)) return clipCache.get(m);
  const c = m.clone(); c.clippingPlanes = [CLIP]; c.clipShadows = true; c.side = T.DoubleSide; clipCache.set(m, c); return c;
}
function pickBox(x1, x2, y1, y2, z, data, parent) {
  const m = new T.Mesh(new T.BoxGeometry(x2 - x1, y2 - y1, 0.3), new T.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
  m.position.set((x1 + x2) / 2, (y1 + y2) / 2, z); (parent || scene).add(m); m.userData.noAO = true; markPick(m, data); return m;
}
function buildBuilding() {
  const T0 = 0.2;
  upperGroup = new T.Group(); scene.add(upperGroup); upper.push(upperGroup);
  r3WinGroup = new T.Group(); scene.add(r3WinGroup);
  const bUp = new Batch(), bR3w = new Batch(), bL = [], bW = [];
  for (let L = 0; L < 5; L++) {
    bL.push(new Batch()); bW.push(new Batch());
    const g = new T.Group(); scene.add(g); levelGroups.push(g);
    const gw = L === 3 ? r3WinGroup : new T.Group(); if (L !== 3) scene.add(gw); winGroups.push(gw);
  }
  const inner = plain('#e2dccf', { roughness: 0.95 });
  const facade = pbr('plaster'), base = pbr('stone'), cageMat = pbr('plaster', { color: '#cfc6b4' });
  const concrete = pbr('concrete');
  for (let L = 0; L < 5; L++) {
    const y0 = L * LV, isR3 = L === 3;
    const B = bL[L];
    const BW = isR3 ? bR3w : bW[L];
    const ext = L === 0 ? base : facade, M = m => clipped(m);
    // facade rue
    const fo = FRONT_WIN.map(w => [w[1], w[2], w[3], w[4]]);
    const Mf = wallMatrix(0, y0, 0, 0);
    B.add(wallGeometry(11, LV, T0, fo, 0, y0), M(ext), Mf);
    // facade cour
    const bo = BACK_WIN.map(w => [11 - w[2], 11 - w[1], w[3], w[4]]);
    const Mb = wallMatrix(11, y0, -8.6, Math.PI);
    B.add(wallGeometry(11, LV, T0, bo, 0, y0), M(ext), Mb);
    // pignons (ouest : porte paliere ; est : aveugle)
    B.add(wallGeometry(8.6, LV, T0, [[2.8, 3.6, 0, 2.05]], 0, y0), M(ext), wallMatrix(0, y0, -8.6, -Math.PI / 2));
    B.add(wallGeometry(8.6, LV, T0, [], 0, y0), M(ext), wallMatrix(11, y0, 0, Math.PI / 2));
    // menuiseries
    FRONT_WIN.forEach((w, k) => {
      const op = [w[1], w[2], w[3], w[4]];
      if (isR3) {
        const mat = std('#131b26', { roughness: 0.05, metalness: 0.4, emissive: '#000000', transparent: true, opacity: 0.9 }); mat.userData.env = 1.4;
        const r = windowKit(bR3w, Mf, op, T0, { glass: mat, card: false });
        const gm = new T.Mesh(r.glassGeo, mat); gm.applyMatrix4(r.matrix); r3WinGroup.add(gm);
        winR3[w[0]] = { group: r3WinGroup, glass: gm };
        pickBox(w[1], w[2], R3 + w[3], R3 + w[4], 0.05, { type: 'observe', what: w[0] }, r3WinGroup);
      } else windowKit(BW, Mf, op, T0, { lit: LIT[L][k], shutter: SHUT[L][k], seed: L * 7 + k });
    });
    BACK_WIN.forEach((w, k) => {
      const op = [11 - w[2], 11 - w[1], w[3], w[4]];
      if (isR3) {
        const mat = std('#131b26', { roughness: 0.05, metalness: 0.4, emissive: '#000000', transparent: true, opacity: 0.9 }); mat.userData.env = 1.4;
        const r = windowKit(bR3w, Mb, op, T0, { glass: mat, card: false });
        const gm = new T.Mesh(r.glassGeo, mat); gm.applyMatrix4(r.matrix); r3WinGroup.add(gm);
        winR3[w[0]] = { group: r3WinGroup, glass: gm };
        pickBox(w[1], w[2], R3 + w[3], R3 + w[4], -8.65, { type: 'observe', what: w[0] }, r3WinGroup);
      } else windowKit(BW, Mb, op, T0, { lit: LIT[L][4 + k], shutter: SHUT[L][4 + k], seed: L * 11 + k });
    });
    // bandeaux d'etage et dalles
    if (L > 0) {
      B.add(new T.BoxGeometry(11.1, 0.14, 0.06), M(concrete), new T.Matrix4().makeTranslation(5.5, y0, 0.03));
      B.add(new T.BoxGeometry(11.1, 0.14, 0.06), M(concrete), new T.Matrix4().makeTranslation(5.5, y0, -8.63));
    }
    const slab = new T.BoxGeometry(10.6, 0.2, 8.2);
    B.add(slab, clipped(concrete), new T.Matrix4().makeTranslation(5.5, y0 + LV - 0.1, -4.3));
    // logements des autres niveaux : meme plan que le R+3 (cloisons et sols), visibles en coupe
    if (!isR3) genericFlat(B, y0, inner);
    // balcons filants devant le sejour
    if (L === 1 || L === 2 || L === 4) balcony(bW[L], 0.7, 5.1, y0, 0, 1.1);
    // cage d'escalier (travee gauche, facade en retrait)
    const BC = bL[L];
    const co = L === 0 ? [[1.0, 2.2, 0, 2.3]] : [[1.1, 1.9, 0.9, 2.0]];
    const Mc = wallMatrix(-3, y0, -0.15, 0);
    BC.add(wallGeometry(3, LV, T0, co, -3, y0), clipped(cageMat), Mc);
    BC.add(wallGeometry(8.45, LV, T0, [], 0, y0), clipped(cageMat), wallMatrix(-3, y0, -8.6, -Math.PI / 2));
    BC.add(wallGeometry(3, LV, T0, [[1.1, 1.9, 0.9, 2.0]], 0, y0), clipped(cageMat), wallMatrix(0, y0, -8.6, Math.PI));
    if (L > 0) {
      const lv = GAME.LEVELS[L];
      const cm = std('#2a2116', { emissive: '#e8dcc0', emissiveIntensity: 0.9, roughness: 0.3 }); cm.clippingPlanes = [CLIP];
      const r = windowKit(bW[L], Mc, co[0], T0, { glass: cm, card: false });
      const gm = new T.Mesh(r.glassGeo, cm); gm.applyMatrix4(r.matrix); levelGroups[L].add(gm);
      cageWins[lv] = cm;
      pickBox(-1.9, -1.1, y0 + 0.9, y0 + 2.0, -0.05, { type: 'observe', what: 'CAGE_' + lv }, levelGroups[L]);
    }
  }
  // hall d'entree : porte vitree aluminium, hall eclaire, auvent, plaques
  const alu = std('#9aa3ab', { metalness: 0.8, roughness: 0.35 }); alu.userData.env = 1;
  cageDoor = new T.Group(); scene.add(cageDoor);
  for (const s of [0, 1]) {
    const leaf = new T.Group(); leaf.position.set(-2.0 + s * 1.2, 0.14, -0.27); cageDoor.add(leaf);
    const dir = s ? -1 : 1;
    box(0.6, 0.06, 0.05, alu, dir * 0.3, 0, 0, leaf, true); box(0.6, 0.06, 0.05, alu, dir * 0.3, 2.1, 0, leaf, true); box(0.05, 2.16, 0.05, alu, dir * 0.575, 0, 0, leaf, true);
    const gl = new T.Mesh(new T.PlaneGeometry(0.52, 2.0), std('#1b2630', { roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.45 })); gl.position.set(dir * 0.3, 1.08, 0); leaf.add(gl);
    leaf.userData.dir = dir; cageDoor.userData['leaf' + s] = leaf;
  }
  const hall = new T.Mesh(new T.PlaneGeometry(2.6, 2.4), new T.MeshBasicMaterial({ map: roomCardLit(), toneMapped: true, clippingPlanes: [CLIP] })); hall.position.set(-1.5, 1.3, -1.6); scene.add(hall);
  box(2.2, 0.14, 1.3, pbr('concrete'), -1.6, 2.55, 0.5, null, true);
  glow('#ffd9a0', 2.4, null, -1.6, 2.3, 0.4, 0.25);
  markPick(cageDoor, { type: 'observe', what: 'IMMEUBLE' });
  pickBox(-2.2, -1.0, 0.1, 2.3, -0.1, { type: 'observe', what: 'IMMEUBLE' });
  const st = canvasTex(512, 128, (c, w, h) => { c.fillStyle = '#1d4f91'; c.fillRect(0, 0, w, h); c.strokeStyle = '#ffffff'; c.lineWidth = 8; c.strokeRect(8, 8, w - 16, h - 16); c.fillStyle = '#ffffff'; c.font = '700 52px "Barlow Condensed", Arial Narrow, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('RUE DES GLYCINES', w / 2, h / 2 + 2); });
  const sign = new T.Mesh(new T.PlaneGeometry(1.4, 0.35), new T.MeshStandardMaterial({ map: st, roughness: 0.5, emissive: '#ffffff', emissiveMap: st, emissiveIntensity: 0.3 }));
  sign.position.set(-2.4, 3.2, -0.13); scene.add(sign);
  const num = canvasTex(128, 128, (c, w, h) => { c.fillStyle = '#1d4f91'; c.fillRect(0, 0, w, h); c.fillStyle = '#fff'; c.font = '700 80px Arial'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('14', w / 2, h / 2 + 4); });
  const nm = new T.Mesh(new T.PlaneGeometry(0.35, 0.35), new T.MeshStandardMaterial({ map: num, emissive: '#ffffff', emissiveMap: num, emissiveIntensity: 0.3 })); nm.position.set(-0.6, 2.3, -0.13); scene.add(nm);
  // toiture : etancheite gravillonnee, acrotere avec couvertine, edicule, cheminees, antenne
  const top = 5 * LV;
  bUp.add(new T.BoxGeometry(14, 0.2, 8.6), pbr('gravel'), new T.Matrix4().makeTranslation(4, top + 0.1, -4.3));
  for (const [w, d, x, z] of [[14.2, 0.22, 4, -0.04], [14.2, 0.22, 4, -8.6 + 0.11], [0.22, 8.6, -3 + 0.11, -4.3], [0.22, 8.6, 11 - 0.11, -4.3]]) {
    bUp.add(new T.BoxGeometry(w, 0.8, d), facade, new T.Matrix4().makeTranslation(x, top + 0.4, z));
    bUp.add(new T.BoxGeometry(w + 0.08, 0.06, d + 0.08), alu, new T.Matrix4().makeTranslation(x, top + 0.83, z));
  }
  bUp.add(new T.BoxGeometry(2.4, 1.9, 2.6), facade, new T.Matrix4().makeTranslation(-1.5, top + 0.95 + 0.2, -3.2));
  for (const [x, z] of [[3.2, -2.2], [7.8, -6.4]]) bUp.add(new T.BoxGeometry(0.6, 1.3, 0.9), pbr('brick'), new T.Matrix4().makeTranslation(x, top + 0.85, z));
  const metal = std('#3b3f45', { metalness: 0.7, roughness: 0.4 });
  bUp.add(new T.BoxGeometry(0.05, 2.6, 0.05), metal, new T.Matrix4().makeTranslation(6.5, top + 1.5, -4));
  bUp.add(new T.BoxGeometry(1.2, 0.03, 0.03), metal, new T.Matrix4().makeTranslation(6.5, top + 2.5, -4));
  bUp.add(new T.BoxGeometry(0.9, 0.03, 0.03), metal, new T.Matrix4().makeTranslation(6.5, top + 2.1, -4));
  // descente d'eaux pluviales
  bUp.add(new T.CylinderGeometry(0.06, 0.06, top, 10), metal, new T.Matrix4().makeTranslation(10.95, top / 2, 0.1));
  const exu = new T.Group(); exu.position.set(-1.5, top + 0.2, -6.9); upperGroup.add(exu);
  box(1.2, 0.3, 1.2, pbr('concrete'), 0, 0, 0, exu, true);
  exuLid = new T.Group(); exuLid.position.set(0, 0.32, -0.6); exu.add(exuLid);
  box(1.2, 0.06, 1.2, std('#9fb7c9', { roughness: 0.2, metalness: 0.3, transparent: true, opacity: 0.8 }), 0, 0, 0.6, exuLid, true);
  markPick(exu, { type: 'observe', what: 'TOIT' });
  // voisin du R+4 : zone cliquable
  pickBox(1.0, 2.4, 4 * LV + 0.8, 4 * LV + 2.2, 0.08, { type: 'observe', what: 'R4' }, winGroups[4]);
  const sh = quality === 'standard';
  bUp.flush(upperGroup, sh); bR3w.flush(r3WinGroup, sh);
  for (let L = 0; L < 5; L++) { bL[L].flush(levelGroups[L], sh); if (L !== 3) bW[L].flush(winGroups[L], sh); }
}
const PARTITIONS = [
  [10.6, [[3.4, 5.0, 0, 2.0], [6.2, 7.0, 0, 2.0], [8.8, 9.6, 0, 2.0]], 0.2, -4.6, 0], [10.6, [[2.4, 3.2, 0, 2.0], [4.2, 5.0, 0, 2.0], [6.8, 7.6, 0, 2.0]], 0.2, -5.8, 0],
  [4.4, [], 5.6, -4.6, -Math.PI / 2], [4.4, [], 8.2, -4.6, -Math.PI / 2], [2.4, [], 3.8, -8.4, -Math.PI / 2], [2.4, [], 6.0, -8.4, -Math.PI / 2]];
function genericFlat(B, y0, inner) {
  for (const [L, ops, x, z, r] of PARTITIONS) B.add(wallGeometry(L, LV, 0.2, ops, 0, 0), clipped(inner), wallMatrix(x, y0, z, r));
  const par = clipped(plain('#8a6a4c', { roughness: 0.8 })), til = clipped(plain('#b9b4aa', { roughness: 0.6 })), fur = clipped(plain('#6e6458', { roughness: 0.9 }));
  for (const r in ROOM_RECT) {
    const [x1, x2, y1, y2] = ROOM_RECT[r];
    B.add(new T.BoxGeometry(x2 - x1, 0.02, y2 - y1), r === 'SDB' || r === 'CUI' ? til : par, new T.Matrix4().makeTranslation((x1 + x2) / 2, y0 + 0.01, -(y1 + y2) / 2));
  }
  // quelques meubles pour lire les pieces
  for (const [x1, x2, y1, y2, h] of [[0.6, 2.6, 0.6, 1.5, 0.8], [2.3, 3.7, 2.5, 3.5, 0.75], [5.9, 8.1, 0.25, 0.85, 0.9], [8.6, 10.6, 1.0, 3.0, 0.55], [0.4, 2.2, 6.6, 8.2, 0.55], [8.8, 10.6, 6.4, 8.2, 0.55]])
    B.add(new T.BoxGeometry(x2 - x1, h, y2 - y1), fur, new T.Matrix4().makeTranslation((x1 + x2) / 2, y0 + h / 2, -(y1 + y2) / 2));
}
function roomCardLit() {
  return canvasTex(256, 256, (c, w, h) => { const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#f6e2b8'); g.addColorStop(1, '#a7865a'); c.fillStyle = g; c.fillRect(0, 0, w, h); c.fillStyle = '#6b5a45'; c.fillRect(150, 90, 70, 110); c.fillStyle = '#8c7a62'; for (let i = 0; i < 6; i++) c.fillRect(20 + i * 20, 60, 16, 30); });
}

// ------------------------------------------------------------------ R+3 (interieur + brouillard)
const ROOM_RECT = { SEJ: [0.2, 5.6, 0.2, 4.6], CUI: [5.8, 8.2, 0.2, 4.6], CH1: [8.4, 10.8, 0.2, 4.6], COU: [0.2, 10.8, 4.8, 5.8], CH2: [0.2, 3.8, 6.0, 8.4], SDB: [4.0, 6.0, 6.0, 8.4], CH3: [6.2, 10.8, 6.0, 8.4] };
const fog = {}, smokeVol = {};
let v1Fig;
function planBox(b, mat, rounded) { // b = [x1,x2,y1,y2,z1,z2] (plan, hauteurs relatives au R+3)
  const [x1, x2, y1, y2, z1, z2] = b;
  const g = rounded ? new RoundedBoxGeometry(x2 - x1, z2 - z1, y2 - y1, 2, Math.min(0.05, (z2 - z1) / 3)) : new T.BoxGeometry(x2 - x1, z2 - z1, y2 - y1);
  const m = new T.Mesh(g, clipped(mat));
  m.position.set((x1 + x2) / 2, R3 + (z1 + z2) / 2, -(y1 + y2) / 2);
  if (quality === 'standard') { m.castShadow = true; m.receiveShadow = true; }
  r3Int.add(m); return m;
}
function buildR3Interior() {
  r3Int = new T.Group(); scene.add(r3Int);
  const H = 2.6, inner = plain('#e2dccf', { roughness: 0.95 }), b = new Batch();
  const W = (L, ops, M) => b.add(wallGeometry(L, H, 0.2, ops, 0, 0), clipped(inner), M);
  W(10.6, [[3.4, 5.0, 0, 2.0], [6.2, 7.0, 0, 2.0], [8.8, 9.6, 0, 2.0]], wallMatrix(0.2, R3, -4.6, 0));
  W(10.6, [[2.4, 3.2, 0, 2.0], [4.2, 5.0, 0, 2.0], [6.8, 7.6, 0, 2.0]], wallMatrix(0.2, R3, -5.8, 0));
  W(4.4, [], wallMatrix(5.6, R3, -4.6, -Math.PI / 2));
  W(4.4, [], wallMatrix(8.2, R3, -4.6, -Math.PI / 2));
  W(2.4, [], wallMatrix(3.8, R3, -8.4, -Math.PI / 2));
  W(2.4, [], wallMatrix(6.0, R3, -8.4, -Math.PI / 2));
  b.flush(r3Int, quality === 'standard');
  // portes pilotees par la simulation
  const wood = std('#7b5a3e', { roughness: 0.6 });
  S3.doors = {
    CH1_COU: planBox([9.0, 9.8, 4.66, 4.74, 0, 2.0], wood),
    CH3_COU: planBox([7.0, 7.8, 5.86, 5.94, 0, 2.0], wood),
    PALIERE: planBox([0.06, 0.14, 5.0, 5.8, 0, 2.0], std('#4a3022', { roughness: 0.5 })),
  };
  // sols
  for (const r in ROOM_RECT) {
    const [x1, x2, y1, y2] = ROOM_RECT[r];
    const f = new T.Mesh(planeUV(x2 - x1, y2 - y1), pbr(r === 'SDB' || r === 'CUI' ? 'tiles' : 'parquet'));
    f.rotation.x = -Math.PI / 2; f.position.set((x1 + x2) / 2, R3 + 0.01, -(y1 + y2) / 2); f.receiveShadow = true; r3Int.add(f);
  }
  // mobilier
  const F = (x1, x2, y1, y2, z1, z2, col, rough) => planBox([x1, x2, y1, y2, z1, z2], std(col, { roughness: rough || 0.8 }), true);
  F(0.6, 2.6, 0.6, 1.5, 0.0, 0.42, '#5a4636'); F(0.6, 2.6, 0.55, 0.8, 0.0, 0.85, '#5a4636'); F(0.55, 0.8, 0.6, 1.5, 0, 0.6, '#5a4636'); F(2.4, 2.65, 0.6, 1.5, 0, 0.6, '#5a4636');
  F(0.75, 1.6, 0.85, 1.45, 0.42, 0.55, '#6d5644'); F(1.65, 2.45, 0.85, 1.45, 0.42, 0.55, '#6d5644');
  F(2.3, 3.7, 2.5, 3.5, 0.7, 0.76, '#6b4f36'); for (const [x, y] of [[2.4, 2.6], [3.6, 2.6], [2.4, 3.4], [3.6, 3.4]]) F(x - 0.03, x + 0.03, y - 0.03, y + 0.03, 0, 0.7, '#4a3726');
  for (const [x, y] of [[2.0, 3.0], [4.0, 3.0]]) F(x - 0.22, x + 0.22, y - 0.22, y + 0.22, 0, 0.46, '#3d2f24');
  F(4.7, 5.5, 0.4, 2.6, 0, 0.5, '#2a2a2e'); F(5.0, 5.08, 0.9, 2.1, 0.5, 1.15, '#0d0f12', 0.2);
  F(5.9, 8.1, 0.25, 0.85, 0, 0.9, '#c9c3b6'); F(7.5, 8.1, 0.25, 3.0, 0, 0.9, '#c9c3b6'); F(5.9, 8.1, 0.25, 0.6, 1.5, 2.2, '#c9c3b6');
  F(6.4, 7.4, 2.2, 3.2, 0.72, 0.76, '#8a6a4a');
  F(8.6, 10.6, 1.0, 3.0, 0, 0.45, '#7a6050'); F(8.7, 10.5, 1.05, 2.95, 0.45, 0.6, '#d8d2e4'); F(8.8, 10.4, 1.05, 1.5, 0.6, 0.72, '#f2efe8'); F(8.6, 10.6, 0.85, 1.0, 0, 1.0, '#6b4f36');
  F(10.2, 10.75, 3.4, 4.5, 0, 2.0, '#8c7058');
  F(0.4, 2.2, 6.6, 8.2, 0, 0.55, '#9fb0c4'); F(8.8, 10.6, 6.4, 8.2, 0, 0.55, '#c4a59f'); F(6.4, 7.2, 7.6, 8.35, 0, 1.9, '#8c7058');
  F(4.2, 5.8, 7.4, 8.25, 0, 0.55, '#ecebe6', 0.3); F(4.2, 4.8, 6.1, 6.5, 0, 0.85, '#ecebe6', 0.3);
  // brouillard de reconnaissance + volumes de fumee connus
  for (const r in ROOM_RECT) {
    const [x1, x2, y1, y2] = ROOM_RECT[r];
    const fm = new T.Mesh(new T.BoxGeometry(x2 - x1 + 0.02, 1.2, y2 - y1 + 0.02), new T.MeshBasicMaterial({ color: '#0a0f16', transparent: true, opacity: 0.93, depthWrite: false }));
    fm.position.set((x1 + x2) / 2, R3 + 0.6, -(y1 + y2) / 2); fm.visible = false; fm.userData.noAO = true; r3Int.add(fm); fog[r] = fm;
    const sv = new T.Mesh(new T.BoxGeometry(x2 - x1 - 0.02, 1, y2 - y1 - 0.02), new T.MeshBasicMaterial({ color: '#2b2b2e', transparent: true, opacity: 0.5, depthWrite: false }));
    sv.visible = false; sv.userData.noAO = true; r3Int.add(sv); smokeVol[r] = sv;
    const q = label('?', '#8d9db0', { scale: 0.008, always: false }); q.position.set((x1 + x2) / 2, R3 + 1.5, -(y1 + y2) / 2); q.visible = false; r3Int.add(q); fog[r].userData.q = q;
  }
  v1Fig = person('#c9c2d6', '#d9b9a0', true, false, '#d8d8d8'); v1Fig.position.set(9.6, R3 + 0.62, -2.0); v1Fig.rotation.z = Math.PI / 2; v1Fig.rotation.y = Math.PI / 2; r3Int.add(v1Fig);
}

// ------------------------------------------------------------------ vehicules
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
let ladder, turntable, ladderTarget = null, ladderProg = 0;
const PARK = { FPT1: [-2.6, 5.4], PA: [7.8, 5.0], VSAV: [18.2, 5.6], VLCG: [-11.2, 4.9], FPT2: [-21, 5.6], VSAV2: [44, 9.4] };
function buildVehicles() {
  const fpt = truck('FPT1', { len: 8.2, h: 2.2, color: '#7f0910', label: 'FPT 1', axles: 2, roofLadder: true });
  fpt.position.set(PARK.FPT1[0], 0, PARK.FPT1[1]);
  
  const pa = truck('PA', { len: 9.0, h: 1.5, color: '#7f0910', label: 'PA 18', axles: 3 });
  pa.position.set(60, 0, PARK.PA[1]); pa.visible = false;
  turntable = new T.Group(); turntable.position.set(-2.6, 2.45, 0); pa.add(turntable);
  box(1.4, 0.5, 1.4, std('#d0d0d0', { metalness: 0.5, roughness: 0.4 }), 0, 0, 0, turntable, true);
  ladder = new T.Group(); ladder.position.set(0, 0.6, 0); turntable.add(ladder);
  const lm = std('#d8dce0', { metalness: 0.7, roughness: 0.35 });
  const LL = 8;
  box(LL, 0.18, 0.12, lm, LL / 2, 0, 0.4, ladder); box(LL, 0.18, 0.12, lm, LL / 2, 0, -0.4, ladder);
  for (let i = 0.4; i < LL; i += 0.5) box(0.06, 0.06, 0.8, lm, i, 0, 0, ladder);
  ladder.userData.LL = LL; ladder.rotation.z = 0.02; turntable.rotation.y = 0;
  const vs = truck('VSAV', { len: 6.4, h: 2.2, color: '#8a0b13', stripe: '#f4f4f4', locker: '#e8e8e8', label: 'VSAV 1', axles: 2 });
  vs.position.set(60, 0, PARK.VSAV[1]); vs.visible = false;
  const vl = truck('VLCG', { len: 4.8, h: 1.1, color: '#7f0910', label: 'VLCG (vous)', axles: 2 });
  vl.position.set(PARK.VLCG[0], 0, PARK.VLCG[1]);
  vl.scale.set(1, 0.75, 0.85);
}

// ------------------------------------------------------------------ personnages
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
const teams = {}; // id -> {group, figs, label}
const witnessFig = {};
function teamGroup(a) {
  const g = new T.Group(); scene.add(g);
  const col = TEAM_COLORS[a.id] || '#9a72ff';
  const f1 = person('#1d2836', null, false, true), f2 = person('#1d2836', null, false, true);
  f1.position.set(-0.35, 0, 0); f2.position.set(0.35, 0, -0.3); g.add(f1); g.add(f2);
  for (const f of [f1, f2]) { const band = new T.Mesh(new T.CylinderGeometry(0.205, 0.205, 0.07, 16), new T.MeshBasicMaterial({ color: col })); band.position.y = 1.32; band.scale.set(1, 1, 0.74); f.add(band); }
  const lb = label(`${a.id.replace(/\d/, '')} ${a.engin.replace('FPT ', 'FPT')}`, col, { scale: 0.0105, always: true });
  lb.position.set(0, 2.4, 0); g.add(lb);
  markPick(g, { type: 'team', id: a.id });
  teams[a.id] = { group: g, figs: [f1, f2], label: lb, pos: new T.Vector3(), heading: 0 };
  return teams[a.id];
}
function buildPeople() {
  // voisin du R+4
  neighbourFig = person('#6d7f99', '#e0c0a6', false, false, '#bfbfbf'); neighbourFig.position.set(1.7, 4 * LV + 0.45, 0.12); neighbourFig.scale.setScalar(0.92); neighbourFig.rotation.y = 0; scene.add(neighbourFig);
  S3.help = label('Au secours !', '#e2373f', { scale: 0.011 }); S3.help.position.set(1.7, 4 * LV + 2.6, 0.2); scene.add(S3.help);
  // temoins
  const mk = (id, body, hair) => { const f = person(body, '#e2c4a8', false, false, hair); f.visible = false; scene.add(f); const m = label('?', '#2fb36b', { scale: 0.009, always: true }); m.position.set(0, 2.25, 0); f.add(m); f.userData.marker = m; markPick(f, { type: 'witness', id }); witnessFig[id] = f; return f; };
  mk('REQ', '#7b3b62', '#5a3a22'); mk('VOI', '#55606a', '#9a9a9a');
  // equipage PA / VSAV (decor)
  S3.crew = [];
}

// ------------------------------------------------------------------ fumees / flammes
let smoke, smokeGeo, P, flames = [];
function buildFx() {
  const N = quality === 'standard' ? 1600 : 650;
  P = { n: N, pos: new Float32Array(N * 3), vel: new Float32Array(N * 3), size: new Float32Array(N), alpha: new Float32Array(N), shade: new Float32Array(N), life: new Float32Array(N), max: new Float32Array(N), next: 0 };
  smokeGeo = new T.BufferGeometry();
  smokeGeo.setAttribute('position', new T.BufferAttribute(P.pos, 3));
  smokeGeo.setAttribute('size', new T.BufferAttribute(P.size, 1));
  smokeGeo.setAttribute('alpha', new T.BufferAttribute(P.alpha, 1));
  smokeGeo.setAttribute('shade', new T.BufferAttribute(P.shade, 1));
  const mat = new T.ShaderMaterial({
    uniforms: { map: { value: TEX.smoke }, scale: { value: 1 }, lin: { value: 0 }, fogColor: { value: new T.Color('#0b1322') }, glow: { value: new T.Color('#ff7a2a') } },
    vertexShader: `attribute float size; attribute float alpha; attribute float shade; varying float vA; varying float vS; varying float vD;
      uniform float scale; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vA = alpha; vS = shade; vD = -mv.z;
      gl_PointSize = size * scale / -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform sampler2D map; uniform vec3 fogColor; uniform float lin; varying float vA; varying float vS; varying float vD;
      void main(){ vec4 t = texture2D(map, gl_PointCoord); vec3 c = mix(vec3(vS), fogColor, clamp(vD/140.0,0.0,0.6));
      float a = t.a * vA;
      if (lin > 0.5) { c = pow(c, vec3(2.2)); a = min(1.0, a * 1.2); }
      gl_FragColor = vec4(c, a); if (gl_FragColor.a < 0.01) discard; }`,
    transparent: true, depthWrite: false,
  });
  smoke = new T.Points(smokeGeo, mat); smoke.frustumCulled = false; scene.add(smoke);
  for (let i = 0; i < N; i++) P.alpha[i] = 0;
  // flammes : 7 jeux de sprites (une par fenetre) + le canape
  const fm = () => new T.SpriteMaterial({ map: TEX.flame, blending: T.AdditiveBlending, depthWrite: false, transparent: true, color: '#ffb47a', opacity: 0.85 });
  for (const id of Object.keys(winR3).concat(['SOFA', 'R4W'])) {
    const grp = new T.Group(); scene.add(grp); const arr = [];
    for (let k = 0; k < 4; k++) { const s = new T.Sprite(fm()); grp.add(s); arr.push(s); }
    const halo = new T.Sprite(new T.SpriteMaterial({ map: TEX.glow, color: '#ff7a2a', blending: T.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.5 })); grp.add(halo);
    flames.push({ id, grp, arr, halo });
  }
}
function emit(x, y, z, vx, vy, vz, size, shade, life) {
  const i = P.next; P.next = (P.next + 1) % P.n;
  P.pos[i * 3] = x; P.pos[i * 3 + 1] = y; P.pos[i * 3 + 2] = z;
  P.vel[i * 3] = vx; P.vel[i * 3 + 1] = vy; P.vel[i * 3 + 2] = vz;
  P.size[i] = size; P.shade[i] = shade; P.life[i] = 0; P.max[i] = life; P.alpha[i] = 0.0;
}
function stepSmoke(dt) {
  const wind = 0.9;
  for (let i = 0; i < P.n; i++) {
    if (P.max[i] <= 0) continue;
    P.life[i] += dt; const k = P.life[i] / P.max[i];
    if (k >= 1) { P.max[i] = 0; P.alpha[i] = 0; continue; }
    P.vel[i * 3 + 1] += dt * 0.6 * (1 - k); P.vel[i * 3] += (wind - P.vel[i * 3]) * dt * 0.25;
    P.vel[i * 3 + 2] *= (1 - dt * 0.5);
    P.pos[i * 3] += P.vel[i * 3] * dt; P.pos[i * 3 + 1] += P.vel[i * 3 + 1] * dt; P.pos[i * 3 + 2] += P.vel[i * 3 + 2] * dt;
    P.size[i] += dt * 0.7 * (1 - k * 0.5);
    P.alpha[i] = (k < 0.08 ? k / 0.08 : Math.pow(1 - (k - 0.08) / 0.92, 1.3)) * (P.shade[i] < 0.3 ? 0.85 : 0.55);
  }
  smokeGeo.attributes.position.needsUpdate = true; smokeGeo.attributes.size.needsUpdate = true; smokeGeo.attributes.alpha.needsUpdate = true; smokeGeo.attributes.shade.needsUpdate = true;
}

// ------------------------------------------------------------------ mise a jour depuis l'etat du jeu
let acc = 0, cut = false, cutK = 0, cutLevel = 3;
S3.setCut = v => { cut = v; };
S3.setCutLevel = L => { cutLevel = Math.max(0, Math.min(4, L)); };
S3.cutLevel = () => cutLevel;
S3.isCut = () => cut;
const tmpV = new T.Vector3();
function locWorld(loc, a) {
  const NODE = { COU: [2.2, 5.3], SEJ: [3.0, 2.8], CUI: [7.0, 2.4], CH1: [9.6, 3.6], CH2: [2.0, 7.2], SDB: [5.0, 7.0], CH3: [8.5, 7.2] };
  if (loc === 'RUE') { const i = ['BAT1', 'BAL1', 'BAT2', 'BAL2'].indexOf(a.id); const base = a.engin === 'FPT 2' ? PARK.FPT2 : PARK.FPT1; return tmpV.set(base[0] - 2 + (i % 2) * 2.2, 0.14, 3.0).clone(); }
  if (NODE[loc]) return new T.Vector3(NODE[loc][0], R3 + 0.02, -NODE[loc][1]);
  if (loc.startsWith('CAGE_')) { const L = GAME.LEVELS.indexOf(loc.slice(5)); return new T.Vector3(-1.5, L * LV + 0.05, -6.6); }
  if (loc === 'TOIT') return new T.Vector3(-1.5, 5 * LV + 0.7, -6.0);
  if (loc === 'R4_APT') return new T.Vector3(2.2, 4 * LV + 0.02, -5.3);
  return new T.Vector3(0, 0, 3);
}
const DOORPT = new T.Vector3(-1.4, 0.14, 0.9);
function actorPos(a) {
  const p = locWorld(a.loc, a);
  if (a.next && a.prog > 0) {
    const q = locWorld(a.next, a), k = clamp(a.prog, 0, 1);
    if ((a.loc === 'RUE' && a.next === 'CAGE_RDC') || (a.loc === 'CAGE_RDC' && a.next === 'RUE')) {
      const A = a.loc === 'RUE' ? p : q, B = a.loc === 'RUE' ? q : p, kk = a.loc === 'RUE' ? k : 1 - k;
      return kk < 0.7 ? A.clone().lerp(DOORPT, kk / 0.7) : DOORPT.clone().lerp(B, (kk - 0.7) / 0.3);
    }
    return p.lerp(q, k);
  }
  return p;
}
S3.update = function (dtReal, now) {
  const W = G.W;
  // vue en coupe (animation)
  cutK += ((cut ? 1 : 0) - cutK) * Math.min(1, dtReal * 5);
  const showUpper = cutK < 0.5, isCut = cutK > 0.5;
  for (const o of upper) o.visible = showUpper;
  CLIP.constant = isCut ? cutLevel * LV + 1.15 : 1e4;
  for (let L = 0; L < 5; L++) { levelGroups[L].visible = !isCut || L <= cutLevel; winGroups[L].visible = !isCut || L < cutLevel; }
  r3Int.visible = !isCut || cutLevel >= 3;
  const cutR3 = isCut && cutLevel === 3;
  // portes
  for (const id in S3.doors) S3.doors[id].visible = !GAME.isOpen(id);
  for (const s of [0, 1]) { const lf = cageDoor.userData['leaf' + s]; const tgt = GAME.isOpen('IMMEUBLE') ? lf.userData.dir * 1.35 : 0; lf.rotation.y += (tgt - lf.rotation.y) * Math.min(1, dtReal * 3); }
  exuLid.rotation.x = GAME.isOpen('EXUTOIRE') ? -1.2 : 0;
  // calcul FDS le plus proche des decisions du joueur
  let fdsOK = false;
  if (fds) {
    const ev = G.fdsEv || (G.fdsEv = {});
    if (ev.exu == null && GAME.isOpen('EXUTOIRE')) ev.exu = W.t;
    if (ev.paliereClosed == null && W.t > 100 && !GAME.isOpen('PALIERE')) ev.paliereClosed = W.t;
    ev.attack = G.attackT; ev.vpp = G.vppT;
    fds.setCut(isCut, cutLevel * LV + 1.15 - R3);
    fds.update(ev, W.t, dtReal * (G.speed || 1));
    const fi = fds.info(); fdsOK = fi.ok;
    // lecture FDS en coupe : les fumees et flammes decoratives du jeu s'effacent devant la coupe du calcul
    const lecture = fdsOK && isCut && fds.mode().mode > 0; if (smoke) smoke.visible = !lecture; S3._lecture = lecture;
    const bd = document.getElementById('fds-badge');
    if (bd) { bd.hidden = !fdsOK; if (fdsOK) { const txt = `<b>FDS</b> ${fi.id.slice(0, 2)} · ${fi.label} · t = ${Math.floor(fi.tf / 60)} min`; if (bd._t !== txt) { bd.innerHTML = txt; bd._t = txt; } } }
  }
  // brouillard / connaissance du R+3 (visible seulement en coupe)
  for (const r in fog) {
    const s = G.K.rooms[r];
    fog[r].visible = cutR3 && !s; fog[r].userData.q.visible = cutR3 && !s;
    const sv = smokeVol[r];
    if (s && cutR3 && s.zr < 2.4 && !fdsOK) {
      const [x1, x2, y1, y2] = ROOM_RECT[r]; const top = Math.min(2.6, 1.15 + 0.1), bot = Math.min(s.zr, top - 0.05);
      sv.visible = true; sv.scale.y = Math.max(0.05, top - bot); sv.position.set((x1 + x2) / 2, R3 + bot + (top - bot) / 2, -(y1 + y2) / 2);
      sv.material.opacity = s.onFire ? 0.35 : clamp(0.25 + s.sev * 0.18, 0.2, 0.75);
      sv.material.color.set(s.onFire ? '#5a2a14' : '#2b2b2e');
    } else sv.visible = false;
  }
  // vitrages du R+3
  for (const id in winR3) {
    const o = W.O.find(x => x.id === id), room = o.a, z = W.Z[room], wm = winR3[id];
    const zr = layerRel(z), smokeK = clamp((2.2 - zr) / 1.6, 0, 1), fire = roomOnFire(W, room);
    wm.glass.visible = !o.open;
    const m = wm.glass.material;
    const glow = clamp((z.Tu - 520) / 450, 0, 1) + (fire ? 0.4 : 0);
    m.color.setRGB(0.07 + smokeK * 0.06, 0.09 + smokeK * 0.03, 0.12 - smokeK * 0.05);
    m.emissive.setRGB(glow * 1.0, glow * 0.38, glow * 0.08); m.emissiveIntensity = 0.6 + 0.4 * Math.sin(now / 90 + id.length);
    // emission de fumee par les ouvertures
    const e = W.ext[id];
    const w = FRONT_WIN.concat(BACK_WIN).find(x => x[0] === id), front = !o.rear;
    if (o.open && e && e.m > 0.02) {
      const rate = clamp(e.m * 14, 4, 60) * (quality === 'standard' ? 1 : 0.45) * (fdsOK ? 0.3 : 1);
      const nEm = rate * dtReal + (Math.random() < (rate * dtReal) % 1 ? 1 : 0);
      const dark = e.soot / Math.max(e.m, 1e-3) > 0.0015;
      for (let k = 0; k < Math.floor(nEm); k++) {
        const x = w[1] + Math.random() * (w[2] - w[1]), y = R3 + w[4] - 0.15 - Math.random() * 0.4, zz = front ? 0.1 : -8.7;
        emit(x, y, zz, (Math.random() - 0.5) * 0.4, 0.9 + Math.random() * 0.8, (front ? 1 : -1) * (0.8 + Math.random() * 1.2), 1.0 + Math.random() * 0.6, dark ? 0.06 + Math.random() * 0.06 : 0.38 + Math.random() * 0.12, 9 + Math.random() * 6);
      }
    }
    // flammes a l'ouverture
    const fl = flames.find(f => f.id === id);
    let flameOn = o.open && (((e && e.fuelQ > 60)) || (z.flashed && fire && z.Tu > 700)), k = clamp(z.fireQ / 6000, 0.35, 1);
    // facade rue : flammes lues dans le calcul FDS (puissance et temperature juste devant l'ouverture)
    if (fdsOK && front) {
      const xm = (w[1] + w[2]) / 2;
      const qa = fds.sample(xm, R3 + w[4] - 0.1, 0.25), qb = fds.sample(xm, R3 + w[4] + 0.5, 0.35);
      if (qa && qb) { const h = Math.max(qa.HRR, qb.HRR), Tm = Math.max(qa.T, qb.T); flameOn = h > 40 || Tm > 550; k = clamp(h / 1500 + (Tm - 400) / 1200, 0.35, 1); }
    }
    fl.grp.visible = flameOn && !S3._lecture;
    if (flameOn) {
      fl.arr.forEach((s, j) => {
        const x = w[1] + (j + 0.5) * (w[2] - w[1]) / fl.arr.length;
        const hh = (0.55 + 0.9 * k) * (0.7 + 0.3 * Math.sin(now / 70 + j * 1.9));
        s.position.set(x, R3 + w[4] + hh * 0.3 - 0.25, front ? 0.3 : -8.9); s.scale.set(0.45 + 0.2 * k, hh, 1);
      });
      fl.halo.position.set((w[1] + w[2]) / 2, R3 + w[4] + 0.1, front ? 0.45 : -9.05); const hs = 4 + 3 * k; fl.halo.scale.set(hs, hs, 1);
      fl.halo.material.opacity = 0.35 + 0.15 * Math.sin(now / 80);
    }
  }
  // propagation au R+4 par la facade (fenetre au-dessus du sejour)
  const r4 = G.r4 || {}, r4f = flames.find(f => f.id === 'R4W'), r4On = r4.t0 != null && !r4.out && r4.q > 80;
  r4f.grp.visible = r4On && !S3._lecture;
  if (r4On) {
    const k = clamp(r4.q / 2500, 0.3, 1), y0 = 4 * LV + 2.2;
    r4f.arr.forEach((sp, j) => { const hh = (0.5 + 0.9 * k) * (0.7 + 0.3 * Math.sin(now / 65 + j * 1.7)); sp.position.set(1.0 + (j + 0.5) * 0.35, y0 + hh * 0.3 - 0.25, 0.3); sp.scale.set(0.45 + 0.2 * k, hh, 1); });
    r4f.halo.position.set(1.7, y0 + 0.1, 0.45); r4f.halo.scale.set(4 + 3 * k, 4 + 3 * k, 1); r4f.halo.material.opacity = 0.35 + 0.15 * Math.sin(now / 80);
    const n = clamp(r4.q / 120, 3, 25) * dtReal * (quality === 'standard' ? 1 : 0.45);
    for (let k2 = 0; k2 < Math.floor(n + Math.random()); k2++) emit(1.0 + Math.random() * 1.4, y0 - 0.2, 0.1, (Math.random() - 0.5) * 0.4, 1.0 + Math.random() * 0.8, 0.8 + Math.random(), 1.0 + Math.random() * 0.6, 0.07, 10);
  }
  // feu interieur (canape / piece) visible en coupe
  const sofa = flames.find(f => f.id === 'SOFA');
  const sejFire = roomOnFire(W, 'SEJ');
  sofa.grp.visible = sejFire && cutR3 && !!G.K.rooms.SEJ && !S3._lecture;
  if (sofa.grp.visible) sofa.arr.forEach((s, j) => { const hh = 1.2 * (0.7 + 0.3 * Math.sin(now / 60 + j * 2.3)); s.position.set(0.8 + j * 0.45, R3 + 0.5 + hh * 0.4, -1.1 - (j % 2) * 0.3); s.scale.set(0.9, hh, 1); });
  // lumiere du feu
  const Qs = W.Z.SEJ.fireQ + W.Z.CUI.fireQ * 0.6 + W.Z.CH1.fireQ * 0.6;
  fireLight.intensity = 60 * clamp(Qs / 3500, 0, 2.6) * (0.85 + 0.15 * Math.sin(now / 55) * Math.sin(now / 37));
  fireLight2.intensity = 45 * (W.O.find(o => o.id === 'W_SEJ1').open ? 1 : 0) * clamp(Qs / 4000, 0, 1.8) * (0.8 + 0.2 * Math.sin(now / 45));
  // cage d'escalier
  GAME.LEVELS.forEach((lv, i) => {
    if (!cageWins[lv]) return;
    const c = conditionsAt(W, 'CAGE', i * LV + 1.5), d = clamp(1 - c.vis / 10, 0, 1);
    cageWins[lv].emissiveIntensity = 0.6 * (1 - d) + 0.05;
    cageWins[lv].color.setRGB(0.16 - d * 0.08, 0.13 - d * 0.07, 0.09 - d * 0.05);
  });
  // fumees : porte d'immeuble, exutoire, fuites
  const cBottom = conditionsAt(W, 'CAGE', 1.8);
  if (GAME.isOpen('IMMEUBLE') && cBottom.smoke && Math.random() < dtReal * 6) emit(-1.4 + (Math.random() - 0.5), 2.2, 0.3, 0.1, 0.4, 0.9, 0.8, 0.3, 7);
  const ex = W.ext.EXUTOIRE;
  if (GAME.isOpen('EXUTOIRE') && ex && ex.m > 0.05) for (let k = 0; k < Math.floor(clamp(ex.m * 6, 1, 20) * dtReal + Math.random()); k++) emit(-1.5 + (Math.random() - 0.5) * 0.8, 5 * LV + 0.9, -6.9 + (Math.random() - 0.5) * 0.8, 0, 2.2, 0, 1.0, 0.12, 10);
  stepSmoke(dtReal);
  smoke.material.uniforms.lin.value = composer ? 1 : 0;
  smoke.material.uniforms.scale.value = renderer.domElement.height / 2 * camera.projectionMatrix.elements[5];
  // vehicules : arrivee, gyrophares
  const blink = Math.floor(now / 160) % 3 === 0;
  for (const id in vehicles) {
    const g = vehicles[id];
    const act = id === 'FPT1' || id === 'VLCG' ? true : (G.actors.find(a => a.id === id) || {}).loc !== 'ABSENT';
    if (id === 'FPT2') { g.visible = G.actors.some(a => a.engin === 'FPT 2'); continue; }
    if (!act) { g.visible = false; g.position.x = 60; g.userData.arrive = null; continue; }
    if (act && !g.visible) { g.visible = true; g.userData.arrive = 0; }
    if (g.visible && g.userData.arrive != null && g.userData.arrive < 1) { g.userData.arrive = Math.min(1, g.userData.arrive + dtReal / 4); const k = 1 - Math.pow(1 - g.userData.arrive, 3); g.position.x = 60 + (PARK[id][0] - 60) * k; }
    g.userData.blue.emissiveIntensity = blink ? 3 : 0.2;
    g.userData.halos.forEach((h, k) => { h.material.opacity = (k % 2 ? !blink : blink) ? 0.85 : 0.05; });
  }
  if (strobe) strobe.intensity = blink ? 60 : 0;
  // renfort FPT 2
  if (G.actors.some(a => a.engin === 'FPT 2') && !vehicles.FPT2) { const xz = GAME.SLOTS.FPT2[G.vpos.FPT2 || 'transit'].xz; const f2 = truck('FPT2', { len: 8.2, h: 2.2, color: '#7f0910', label: 'FPT 2', roofLadder: true }); f2.position.set(xz[0], 0, xz[1]); }
  if (G.actors.some(a => a.id === 'VSAV2') && !vehicles.VSAV2) { const v2 = truck('VSAV2', { len: 6.4, h: 2.2, color: '#8a0b13', stripe: '#f4f4f4', locker: '#e8e8e8', label: 'VSAV 2', axles: 2 }); v2.position.set(60, 0, PARK.VSAV2[1]); v2.visible = false; }
  // emplacements choisis par le joueur (deplacement anime)
  for (const id in vehicles) {
    const g = vehicles[id], S = GAME.SLOTS[id]; if (!S || !g.visible) continue;
    const mv = G.moves && G.moves[id], slot = G.vpos && G.vpos[id];
    let tx, tz;
    if (mv) { const k = clamp((W.t - mv.t0) / (mv.t1 - mv.t0), 0, 1), A = S[mv.from].xz, B = S[mv.to].xz; tx = A[0] + (B[0] - A[0]) * k; tz = A[1] + (B[1] - A[1]) * k; }
    else if (slot && S[slot]) [tx, tz] = S[slot].xz; else continue;
    if (g.userData.arrive != null && g.userData.arrive < 1) { PARK[id] = [tx, tz]; g.position.z = tz; continue; }
    g.position.x += (tx - g.position.x) * Math.min(1, dtReal * 3); g.position.z += (tz - g.position.z) * Math.min(1, dtReal * 3);
  }
  // echelle
  const pa = G.actors.find(a => a.id === 'PA');
  if (pa && pa.loc !== 'ABSENT') {
    const step = pa.plan[0];
    const mission = pa.mission || pa.stationed;
    const tgt = mission === 'PA_R4' ? new T.Vector3(1.7, 4 * LV + 0.7, 0.3) : mission === 'PA_CH1' ? new T.Vector3(9.6, R3 + 0.7, 0.3) : null;
    let p = 0;
    if (tgt) p = pa.stationed ? 1 : step && step.d ? clamp((step.t || 0) / step.d, 0, 1) : 0;
    ladderProg += (p - ladderProg) * Math.min(1, dtReal * 2);
    const g = vehicles.PA, base = new T.Vector3(); turntable.getWorldPosition(base);
    if (tgt) {
      const d = tgt.clone().sub(base); const yaw = Math.atan2(-d.z, d.x) - g.rotation.y; const hor = Math.hypot(d.x, d.z);
      turntable.rotation.y = yaw * clamp(ladderProg * 2, 0, 1);
      ladder.rotation.z = Math.atan2(d.y - 0.6, hor) * clamp(ladderProg * 1.6, 0, 1);
      ladder.scale.x = 1 + (d.length() / ladder.userData.LL - 1) * clamp((ladderProg - 0.4) / 0.6, 0, 1);
    } else { turntable.rotation.y *= 0.95; ladder.rotation.z *= 0.95; ladder.scale.x += (1 - ladder.scale.x) * 0.05; }
  }
  // equipes
  for (const a of G.actors) {
    if (a.kind !== 'binome') continue;
    const t = teams[a.id] || teamGroup(a);
    const p = actorPos(a);
    const prev = t.pos.clone(); t.pos.copy(p);
    t.group.position.lerp(p, Math.min(1, dtReal * 8));
    const mv = prev.distanceTo(p);
    if (mv > 0.001) t.heading = Math.atan2(p.x - prev.x, p.z - prev.z);
    t.group.rotation.y += (t.heading - t.group.rotation.y) * Math.min(1, dtReal * 6);
    const walking = !!a.next && a.prog > 0;
    t.figs.forEach((f, j) => f.children.forEach(c => { if (c.userData.leg) c.rotation.x = walking ? Math.sin(now / 120 + j) * 0.5 * c.userData.leg : 0; }));
    t.figs.forEach((f, j) => { if (f.userData.arm) f.userData.arm.rotation.x = walking ? -Math.sin(now / 120 + j) * 0.4 : -0.3; if (f.userData.arm2) f.userData.arm2.rotation.x = walking ? Math.sin(now / 120 + j) * 0.4 : -0.3; });
    const inside = a.loc !== 'RUE' || (a.next && a.prog > 0.75);
    const lvA = GAME.ROOMS.includes(a.loc) ? 3 : a.loc.startsWith('CAGE_') ? GAME.LEVELS.indexOf(a.loc.slice(5)) : a.loc === 'R4_APT' ? 4 : -1;
    const seen = cutK > 0.5 && lvA >= 0 && lvA <= cutLevel;
    t.figs.forEach(f => f.visible = !inside || seen);
    t.label.material.opacity = inside && !seen ? 0.75 : 1;
    t.label.visible = S3.labelsOn;
    // victime portee
    t.carry = a.carry;
    // bulle de compte rendu au-dessus du binome
    const cr = a.lastCR;
    if (cr !== t.crRef) {
      t.crRef = cr;
      if (t.bubble) { t.group.remove(t.bubble); t.bubble.material.map.dispose(); t.bubble = null; }
      if (cr) {
        const col = { alerte: '#e2373f', victime: '#2fb36b', feu: '#ff7a2a', chaud: '#f08c2a', ok: '#2fb36b', fumee: '#8d9db0', info: '#9a72ff' }[cr.icon] || '#9a72ff';
        let txt = cr.text.replace(/^Binôme d'(attaque|alimentation) : /, '').split(/(?<=[.!])\s/)[0];
        if (txt.length > 46) txt = txt.slice(0, 44) + '…';
        t.bubble = label(txt, col, { scale: 0.0085, always: true, size: 34 }); t.bubble.position.set(0, 3.15, 0); t.group.add(t.bubble);
      }
    }
    if (t.bubble) t.bubble.visible = S3.labelsOn && (cr && (W.t - cr.t < 40 || a.distress));
    // detresse : balise rouge clignotante
    if (a.distress && !t.sos) { t.sos = glow('#ff2030', 5, t.group, 0, 1.2, 0, 0.9); t.sosLb = label('DÉTRESSE', '#e2373f', { scale: 0.012, always: true, bg: 'rgba(80,8,12,0.92)' }); t.sosLb.position.set(0, 4.5, 0); t.group.add(t.sosLb); }
    if (t.sos) { const on = !!a.distress; t.sos.visible = on && Math.floor(now / 350) % 2 === 0; t.sosLb.visible = on; }
  }
  // victime 1
  const v1 = G.victims[0];
  if (v1.carried && teams[v1.carried]) { const tp = teams[v1.carried].group.position; v1Fig.position.set(tp.x, tp.y + 0.55, tp.z); v1Fig.visible = !(v1.loc !== 'RUE' && !(cutK > 0.5 && cutLevel >= 3 && (GAME.ROOMS.includes(v1.loc) || v1.loc.startsWith('CAGE_')))); }
  else if (v1.atRue) { v1Fig.position.set(14.2, 0.45, 2.4); v1Fig.visible = true; }
  else { v1Fig.position.set(9.6, R3 + 0.62, -2.0); v1Fig.visible = cutR3 && !!G.K.rooms.CH1; }
  // voisin du R+4
  const v2 = G.victims[1];
  neighbourFig.visible = (v2.mode === 'fenetre' || v2.mode === 'confine') && showUpper;
  if (neighbourFig.userData.arm) neighbourFig.userData.arm.rotation.z = v2.mode === 'fenetre' ? 2.5 + Math.sin(now / 160) * 0.45 : 0;
  S3.help.visible = v2.mode === 'fenetre' && showUpper;
  if (!S3.v2Street) { S3.v2Street = person('#6d7f99', '#e0c0a6'); S3.v2Street.rotation.z = Math.PI / 2; S3.v2Street.visible = false; scene.add(S3.v2Street); }
  S3.v2Street.visible = v2.atRue; if (v2.atRue) S3.v2Street.position.set(15.6, 0.45, 2.2);
  // temoins
  for (const w of G.witnesses) {
    const f = witnessFig[w.id];
    if (!w.present) { f.visible = false; continue; }
    if (!f.visible) { f.visible = true; f.position.copy(DOORPT); f.userData.walk = 0; }
    const dest = w.id === 'REQ' ? new T.Vector3(-7.4, 0.14, 2.3) : new T.Vector3(-8.8, 0.14, 1.5);
    if (f.position.distanceTo(dest) > 0.05) { f.position.lerp(dest, Math.min(1, dtReal * 0.6)); f.rotation.y = Math.atan2(dest.x - f.position.x, dest.z - f.position.z); f.children.forEach(c => { if (c.userData.leg) c.rotation.x = Math.sin(now / 120) * 0.4 * c.userData.leg; }); }
    else { f.rotation.y += (0.6 - f.rotation.y) * 0.05; f.children.forEach(c => { if (c.userData.leg) c.rotation.x = 0; }); }
    const m = f.userData.marker; m.visible = GAME.availableQuestions(w.id).length > 0; m.position.y = 2.25 + Math.sin(now / 300) * 0.08;
  }
  // tuyaux
  updateHoses();
  if (S3.opposite) S3.opposite.visible = camera.position.z < 19.5;
  controls.update();
  if (composer) composer.render(); else renderer.render(scene, camera);
};
// ------------------------------------------------------------------ tuyaux (etablissements visibles)
let hoseAtt = null, hoseAlim = null;
function tube(points, color) {
  const curve = new T.CatmullRomCurve3(points);
  return new T.Mesh(new T.TubeGeometry(curve, 48, 0.05, 6, false), std(color, { roughness: 0.6 }));
}
function updateHoses() {
  const att = G.actors.some(a => a.kind === 'binome' && a.established && a.engin === 'FPT 1' && a.lance && a.loc !== 'RUE');
  if (att && !hoseAtt) {
    hoseAtt = tube([new T.Vector3(-1.2, 1.0, 4.15), new T.Vector3(-1.0, 0.16, 3.0), new T.Vector3(-1.3, 0.16, 1.2), new T.Vector3(-1.4, 0.18, -0.3), new T.Vector3(-1.6, 0.2, -2.0)], '#e9e6dc');
    scene.add(hoseAtt);
  }
  if (hoseAtt) hoseAtt.visible = att;
  if (hoseAlim) hoseAlim.visible = G.alim;
  if (G.alim && !hoseAlim) {
    hoseAlim = tube([S3.hydrant.clone(), new T.Vector3(15, 0.17, 3.45), new T.Vector3(6, 0.17, 3.5), new T.Vector3(0, 0.17, 3.6), new T.Vector3(1.3, 0.8, 4.2)], '#cfd8e3');
    scene.add(hoseAlim);
  }
}

// ------------------------------------------------------------------ selection
const ray = new T.Raycaster(), mouse = new T.Vector2(); ray.layers.enableAll();
// lecture du calcul FDS sous le curseur, en vue en coupe (a la hauteur de lecture choisie)
S3.fdsProbe = function (cx, cy) {
  if (!fds || !cut || !fds.info().ok) return null;
  const r = renderer.domElement.getBoundingClientRect();
  mouse.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(mouse, camera);
  const o = ray.ray.origin, d = ray.ray.direction, py = cutLevel * LV + 1.15, tp = (py - o.y) / d.y;
  if (!(tp > 0)) return null;
  const h = fds.mode().h, q = fds.sample(o.x + d.x * tp, cutLevel * LV + h, o.z + d.z * tp);
  return q ? Object.assign({ h }, q) : null;
};
S3.pick = function (cx, cy) {
  const r = renderer.domElement.getBoundingClientRect();
  mouse.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(mouse, camera);
  // les etiquettes d'equipes sont prioritaires (toujours visibles)
  for (const id in teams) { const lb = teams[id].label; const hit = ray.intersectObject(lb, false); if (hit.length) return { type: 'team', id }; }
  // temoins : tolerance a l'ecran autour de la silhouette et de son repere « ? » (figurines petites, souvent masquees)
  let bw = null, bd = 30;
  for (const id in witnessFig) {
    const f = witnessFig[id]; if (!isVisibleChain(f)) continue;
    for (const hy of [0.5, 1.1, 1.7, 2.25]) {
      const p = f.localToWorld(new T.Vector3(0, hy, 0)).project(camera); if (p.z > 1) continue;
      const sx = r.left + (p.x + 1) / 2 * r.width, sy = r.top + (1 - p.y) / 2 * r.height, d = Math.hypot(sx - cx, sy - cy);
      if (d < bd) { bd = d; bw = id; }
    }
  }
  if (bw) return { type: 'witness', id: bw };
  const hits = ray.intersectObjects(pickables.filter(m => m.visible && isVisibleChain(m)), false);
  for (const h of hits) { let o = h.object; while (o && !o.userData.pick) o = o.parent; if (o) return o.userData.pick; }
  return null;
};
function isVisibleChain(o) { while (o) { if (!o.visible) return false; o = o.parent; } return true; }
S3.view = function (name) {
  const views = { rue: [[15, 7.5, 16.5], [4, 6.5, -3]], arriere: [[-6, 14, -34], [4, 6, -5]], coupe: [[6, cutLevel * LV + 18.2, 10], [5, cutLevel * LV, -4.3]], aerien: [[30, 34, 26], [4, 5, -4]] };
  const v = views[name]; if (!v) return;
  S3.anim = { from: camera.position.clone(), to: new T.Vector3(...v[0]), tf: controls.target.clone(), tt: new T.Vector3(...v[1]), k: 0 };
};
S3.tickCamera = function (dt) {
  const a = S3.anim; if (!a) return;
  a.k = Math.min(1, a.k + dt / 1.2); const e = a.k < 0.5 ? 2 * a.k * a.k : 1 - Math.pow(-2 * a.k + 2, 2) / 2;
  camera.position.lerpVectors(a.from, a.to, e); controls.target.lerpVectors(a.tf, a.tt, e);
  if (a.k >= 1) S3.anim = null;
};
S3._cam = () => ({ camera, controls });
S3._dbg = () => ({ composer, scene, renderer, smoke, camera, T, P });
S3._smoke = () => { let n = 0, a = 0; for (let i = 0; i < P.n; i++) if (P.max[i] > 0) { n++; a += P.alpha[i]; } return { n, a, ext: Object.keys(G.W.ext), scale: smoke.material.uniforms.scale.value, vis: smoke.visible }; };
S3._lad = () => { const v = new T.Vector3(); ladder.getWorldPosition(v); return { v, s: ladder.scale.toArray(), r: [turntable.rotation.y, ladder.rotation.z], vis: ladder.visible, pav: vehicles.PA.visible, pax: vehicles.PA.position.toArray() }; };
S3._fig = id => witnessFig[id].position.clone();
S3.screenOf = function (obj3) { const v = obj3.clone().project(camera); const r = renderer.domElement.getBoundingClientRect(); return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height }; };
