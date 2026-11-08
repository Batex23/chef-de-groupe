// =============================================================================
// Fumee volumique issue des calculs FDS (Plot3D convertis par fds/fds2jeu.py).
// Chaque maillage FDS devient une boite rendue par lancer de rayons dans une
// texture 3D : visibilite -> opacite, puissance volumique -> flammes,
// temperature -> lueur. Le calcul affiche est celui dont les choix de
// ventilation et d'attaque ressemblent le plus a ceux du joueur.
// =============================================================================
const BASE = 'data/fds/';
const FADE = 12;           // s de jeu pour passer d'un calcul a l'autre

// echeancier des calculs (instants FDS des actions cles, cf. fds/gen_fds.py)
const CASES = {
  R0_BASE: { label: 'porte palière fermée', key: null },
  R1_PORTE_PALIERE_OUVERTE: { label: 'porte palière ouverte', key: null },
  R2_PORTE_OUVERTE_EXUTOIRE: { label: 'exutoire ouvert', key: 660 },
  R4_ATTAQUE: { label: 'attaque', key: 660 },
  R6_VPP_APRES_ATTAQUE: { label: 'VPP après attaque', key: 840 },
  R7_VPP_ATTAQUE: { label: 'VPP avant attaque', key: 660 },
  R8_VPP_SANS_EXUTOIRE: { label: 'VPP sans exutoire', key: 840 },
};

// choix du calcul et de l'instant FDS equivalent : t_fds = t_cle_fds + (t - t_cle_joueur)
export function pickCase(ev, t) {
  let id, tp = null;
  if (ev.vpp != null) { tp = ev.vpp; id = ev.exu == null || ev.exu > ev.vpp ? 'R8_VPP_SANS_EXUTOIRE' : (ev.attack != null && ev.attack < ev.vpp ? 'R6_VPP_APRES_ATTAQUE' : 'R7_VPP_ATTAQUE'); }
  else if (ev.attack != null) { tp = ev.attack; id = 'R4_ATTAQUE'; }
  else if (ev.exu != null) { tp = ev.exu; id = 'R2_PORTE_OUVERTE_EXUTOIRE'; }
  else id = ev.paliereClosed != null ? 'R0_BASE' : 'R1_PORTE_PALIERE_OUVERTE';
  const k = CASES[id].key;
  return { id, tf: k != null && tp != null ? k + (t - tp) : t };
}

async function gunzip(buf) {
  const u = new Uint8Array(buf);
  if (u[0] !== 0x1f || u[1] !== 0x8b) return u;       // deja decompresse par le serveur
  const ds = new DecompressionStream('gzip');
  return new Uint8Array(await new Response(new Blob([u]).stream().pipeThrough(ds)).arrayBuffer());
}

const VS = `out vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const FS = `
precision highp float; precision highp sampler3D;
uniform sampler3D a0, a1, b0, b1; uniform float mt, mc, dens, R3, steps, amax;
uniform vec3 nmin, nmax, cmin, cmax, nres; in vec3 vW; out vec4 oc;
vec4 S(sampler3D t, vec3 c){ return texture(t, c); }
void main(){
  vec3 ro = cameraPosition, rd = normalize(vW - ro);
  vec3 i0 = (cmin - ro) / rd, i1 = (cmax - ro) / rd;
  vec3 tn = min(i0, i1), tx = max(i0, i1);
  float t0 = max(max(tn.x, tn.y), max(tn.z, 0.0)), t1 = min(min(tx.x, tx.y), tx.z);
  if (t1 <= t0) discard;
  float ds = (t1 - t0) / steps;
  float tt = t0 + ds * fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  vec3 col = vec3(0.0); float tr = 1.0;
  for (int i = 0; i < 96; i++) {
    if (float(i) >= steps || tr < 0.02) break;
    vec3 p = ro + rd * tt; tt += ds;
    vec3 f = vec3(p.x, -p.z, p.y - R3);                         // repere FDS
    vec3 u = clamp((f - nmin) / (nmax - nmin), 0.0, 1.0);
    vec3 c = (0.5 + u * (nres - 1.0)) / nres;
    vec4 q = mix(mix(S(a0, c), S(a1, c), mt), mix(S(b0, c), S(b1, c), mt), mc);
    float vis = max(q.r * 30.0, 0.05), T = 20.0 + 1180.0 * q.g * q.g, hrr = 3000.0 * q.b * q.b;
    float K = max(0.0, 3.0 / vis - 0.1) * dens;                 // coefficient d'extinction (C = 3)
    float a = 1.0 - exp(-K * ds);
    float hot = smoothstep(350.0, 850.0, T);
    vec3 sm = vec3(0.075, 0.072, 0.07) + vec3(0.55, 0.20, 0.05) * hot;
    vec3 fl = vec3(4.0, 1.6, 0.35) * smoothstep(40.0, 900.0, hrr);
    col += tr * (a * sm + fl * ds * 1.4);
    tr *= 1.0 - a; tr *= exp(-smoothstep(40.0, 900.0, hrr) * ds * 1.2);
  }
  float al = min(1.0 - tr, amax);
  if (al < 0.004) discard;
  oc = vec4(col / max(al, 1e-3), al);
}`;

export function createFdsSmoke(T, scene, opts) {
  const R3 = opts.R3, steps = opts.light ? 36 : 64;
  const data = {};                 // id -> {meta, meshes:[{tex:[...], n, nmin, nmax}]}
  const st = { on: false, id: null, tf: 0, prev: null, fadeT: 0, cut: false, cutY: 1.15, err: null };
  const boxes = [];                // un objet par nom de maillage
  const geo = new T.BoxGeometry(1, 1, 1);

  function boxFor(name) {
    let b = boxes.find(x => x.name === name);
    if (b) return b;
    const u = {
      a0: { value: null }, a1: { value: null }, b0: { value: null }, b1: { value: null }, mt: { value: 0 }, mc: { value: 0 },
      dens: { value: 1 }, amax: { value: 1 }, R3: { value: R3 }, steps: { value: steps }, nmin: { value: new T.Vector3() }, nmax: { value: new T.Vector3() },
      cmin: { value: new T.Vector3() }, cmax: { value: new T.Vector3() }, nres: { value: new T.Vector3() },
    };
    const mat = new T.ShaderMaterial({ glslVersion: T.GLSL3, uniforms: u, vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false, side: T.FrontSide });
    const m = new T.Mesh(geo, mat); m.frustumCulled = false; m.renderOrder = -1; m.visible = false; m.userData.noAO = true;
    scene.add(m);
    b = { name, m, u }; boxes.push(b); return b;
  }

  async function load(id) {
    if (data[id]) return data[id];
    data[id] = { loading: true };
    try {
      const meta = await (await fetch(BASE + id + '/' + id + '.json')).json();
      const meshes = [];
      for (const M of meta.maillages) {
        const raw = await gunzip(await (await fetch(BASE + id + '/' + M.fichier)).arrayBuffer());
        const [ni, nj, nk] = M.n, nv = ni * nj * nk, nq = meta.grandeurs.length, nt = meta.instants.length;
        const iV = meta.grandeurs.indexOf('VIS'), iT = meta.grandeurs.indexOf('T'), iH = meta.grandeurs.indexOf('HRR'), iC = meta.grandeurs.indexOf('CO');
        const tex = [];
        for (let f = 0; f < nt; f++) {
          const o = f * nq * nv, px = new Uint8Array(nv * 4);
          for (let v = 0; v < nv; v++) { px[v * 4] = raw[o + iV * nv + v]; px[v * 4 + 1] = raw[o + iT * nv + v]; px[v * 4 + 2] = raw[o + iH * nv + v]; px[v * 4 + 3] = raw[o + iC * nv + v]; }
          const t3 = new T.Data3DTexture(px, ni, nj, nk);
          t3.format = T.RGBAFormat; t3.type = T.UnsignedByteType; t3.minFilter = t3.magFilter = T.LinearFilter;
          t3.wrapS = t3.wrapT = t3.wrapR = T.ClampToEdgeWrapping; t3.unpackAlignment = 1; t3.needsUpdate = true;
          tex.push(t3);
        }
        meshes.push({ name: M.nom, tex, n: M.n, raw, nv, nq, x: M.x, y: M.y, z: M.z,
          nmin: [M.x[0], M.y[0], M.z[0]], nmax: [M.x[ni - 1], M.y[nj - 1], M.z[nk - 1]] });
      }
      data[id] = { meta, meshes, times: meta.instants };
      return data[id];
    } catch (e) { data[id] = { failed: true }; st.err = String(e); return null; }
  }

  function ready(id) { const d = data[id]; return d && d.meshes; }
  function frameAt(d, tf) {
    const ts = d.times; if (tf <= ts[0]) return [0, 0, 0];
    if (tf >= ts[ts.length - 1]) return [ts.length - 1, ts.length - 1, 0];
    let i = 0; while (ts[i + 1] < tf) i++;
    return [i, i + 1, (tf - ts[i]) / (ts[i + 1] - ts[i])];
  }

  // lecture des conditions FDS en un point du jeu (repere scene) : utile pour la camera thermique et le debriefing
  function sample(id, tf, sx, sy, sz) {
    const d = data[id]; if (!d || !d.meshes) return null;
    const fx = sx, fy = -sz, fz = sy - R3;
    for (const M of d.meshes) {
      if (fx < M.nmin[0] || fx > M.nmax[0] || fy < M.nmin[1] || fy > M.nmax[1] || fz < M.nmin[2] || fz > M.nmax[2]) continue;
      const near = (arr, v) => { let b = 0; for (let i = 1; i < arr.length; i++) if (Math.abs(arr[i] - v) < Math.abs(arr[b] - v)) b = i; return b; };
      const i = near(M.x, fx), j = near(M.y, fy), k = near(M.z, fz), [fa, fb, w] = frameAt(d, tf);
      const v = (k * M.n[1] + j) * M.n[0] + i, dec = d.meta.decodage, g = d.meta.grandeurs, out = {};
      g.forEach((q, qi) => { const D = dec[q], val = f => D.a + D.b * Math.pow(M.raw[f * M.nq * M.nv + qi * M.nv + v] / 255, D.p); out[q] = val(fa) * (1 - w) + val(fb) * w; });
      return out;
    }
    return null;
  }

  const api = {
    CASES, pickCase, load,
    // lecture a un instant de jeu donne (utilisee par la simulation, y compris pendant le pre-calcul)
    sampleAt(ev, t, sx, sy, sz) { let { id, tf } = pickCase(ev, t); if (!ready(id)) { id = 'R1_PORTE_PALIERE_OUVERTE'; tf = t; if (!ready(id)) return null; } return sample(id, tf, sx, sy, sz); },
    sample: (sx, sy, sz) => st.id ? sample(st.id, st.tf, sx, sy, sz) : null,
    async start(list) {
      st.on = true;
      list = list.filter(id => CASES[id]);      // R3 et R5 : calculs de reference, non selectionnes en jeu
      // le calcul de depart d'abord, les autres ensuite en tache de fond
      const first = list[0]; await load(first);
      for (const id of list.slice(1)) load(id);
    },
    info: () => ({ on: st.on, id: st.id, label: st.id ? CASES[st.id].label : '', tf: st.tf, ok: !!(st.id && ready(st.id)), err: st.err }),
    setCut(on, y) { st.cut = on; st.cutY = y; },
    // ev : instants de jeu des decisions du joueur ; t : temps depuis l'ignition
    update(ev, t, dt) {
      if (!st.on) { for (const b of boxes) b.m.visible = false; return; }
      let { id, tf } = pickCase(ev, t);
      if (!ready(id)) { if (!data[id]) load(id); id = st.id && ready(st.id) ? st.id : (ready('R1_PORTE_PALIERE_OUVERTE') ? 'R1_PORTE_PALIERE_OUVERTE' : null); if (id && id === st.id) tf = st.tf + dt; else if (id) tf = t; }
      if (!id) { for (const b of boxes) b.m.visible = false; return; }
      if (st.id && id !== st.id) { st.prev = { id: st.id, tf: st.tf }; st.fadeT = 0; }
      st.id = id; st.tf = tf;
      if (st.prev) { st.prev.tf += dt; st.fadeT += dt; if (st.fadeT >= FADE) st.prev = null; }
      const d = data[id], P = st.prev && data[st.prev.id];
      const [fa, fb, w] = frameAt(d, tf);
      const pf = P ? frameAt(P, st.prev.tf) : null;
      const mc = P ? 1 - Math.min(1, st.fadeT / FADE) : 0;
      for (const M of d.meshes) {
        const b = boxFor(M.name), u = b.u;
        const PM = P && P.meshes.find(x => x.name === M.name);
        u.a0.value = M.tex[fa]; u.a1.value = M.tex[fb]; u.mt.value = w;
        u.b0.value = PM ? PM.tex[pf[0]] : M.tex[fa]; u.b1.value = PM ? PM.tex[pf[1]] : M.tex[fb]; u.mc.value = PM ? mc : 0;
        const light = M.name === 'APPART' || st.cut;   // en coupe : densite visuelle allegee pour voir binomes et victimes
        u.dens.value = light ? 0.14 : 1; u.amax.value = light ? 0.78 : 1;
        u.nmin.value.set(...M.nmin); u.nmax.value.set(...M.nmax); u.nres.value.set(...M.n);
        // boite de rendu en repere scene, coupee a la hauteur de la vue en coupe
        let [x0, y0, z0] = M.nmin, [x1, y1, z1] = M.nmax;
        const inside = M.name === 'APPART';
        if (st.cut) z1 = Math.min(z1, st.cutY);
        const e = M.name === 'EXTERIEUR' ? 0 : 0.03;   // retrait pour ne pas se confondre avec les murs
        x0 += e; x1 -= e; y0 += e; y1 -= e;
        u.cmin.value.set(x0, R3 + z0, -y1); u.cmax.value.set(x1, R3 + z1, -y0);
        b.m.position.set((x0 + x1) / 2, R3 + (z0 + z1) / 2, -(y0 + y1) / 2);
        b.m.scale.set(x1 - x0, Math.max(0.01, z1 - z0), y1 - y0);
        b.m.visible = z1 > z0 && (inside ? st.cut : true);
      }
    },
  };
  return api;
}
