// =============================================================================
// Carte FDF : chargement des donnees (IGN + cartoguide), rendu facon cartoguide
// DFCI, carroyage, itineraires routiers et pistes, conversion de coordonnees.
// Repere local : metres, x vers l'est, y vers le nord (origine = coin sud-ouest).
// =============================================================================
(function () {
  'use strict';
  const CARTE = {};
  const BASE = 'data/fdf/salles/';

  async function gunzip(buf) {
    const u = new Uint8Array(buf);
    if (u[0] !== 0x1f || u[1] !== 0x8b) return u;
    const ds = new DecompressionStream('gzip');
    return new Uint8Array(await new Response(new Blob([u]).stream().pipeThrough(ds)).arrayBuffer());
  }

  CARTE.charge = async function () {
    const [meta, raw] = await Promise.all([
      fetch(BASE + 'carte.json').then(r => r.json()),
      fetch(BASE + 'raster.bin.gz').then(r => r.arrayBuffer()).then(gunzip),
    ]);
    const N = meta.w * meta.h;
    const c = CARTE.c = Object.assign(meta, { fuel: raw.subarray(0, N), haut: raw.subarray(N, 2 * N), alt: raw.subarray(2 * N, 3 * N), W: meta.w * meta.res, H: meta.h * meta.res });
    c.ortho = new Image(); c.ortho.src = BASE + 'ortho.jpg';
    buildGraph(c);
    buildFuelCanvas(c);
    return c;
  };

  // ---------------------------------------------------------------- coordonnees
  CARTE.dfci = function (x, y) {        // carre DFCI du cartoguide (ex. « GT 634 »)
    const c = CARTE.c, [ox, oy] = c.dfci.origine_l93, p = c.dfci.pas;
    const X = c.lambert93[0] + x, Y = c.lambert93[1] + y;
    const col = Math.floor((X - ox) / p), row = Math.floor((Y - oy) / p);
    return String.fromCharCode(65 + Math.floor(col / 26), 65 + (col % 26)) + ' ' + row;
  };
  CARTE.dfciPhon = function (s) {
    const NATO = { A: 'Alpha', B: 'Bravo', C: 'Charlie', D: 'Delta', E: 'Echo', F: 'Foxtrot', G: 'Golf', H: 'Hotel', I: 'India', J: 'Juliet', K: 'Kilo', L: 'Lima', M: 'Mike', N: 'November', O: 'Oscar', P: 'Papa', Q: 'Quebec', R: 'Romeo', S: 'Sierra', T: 'Tango', U: 'Uniform', V: 'Victor', W: 'Whiskey', X: 'X-ray', Y: 'Yankee', Z: 'Zulu' };
    return s.slice(0, 2).split('').map(l => NATO[l]).join(' ') + ' ' + s.slice(3);
  };
  CARTE.idx = function (x, y) { const c = CARTE.c, col = Math.floor(x / c.res), r = c.h - 1 - Math.floor(y / c.res); return col >= 0 && col < c.w && r >= 0 && r < c.h ? r * c.w + col : -1; };
  CARTE.fuelAt = function (x, y) { const i = CARTE.idx(x, y); return i < 0 ? 0 : CARTE.c.fuel[i]; };
  CARTE.fuelName = function (f) { return CARTE.c.combustibles[f].nom; };
  // categorie « Feu de » du message d'arrivee (memento SDIS 33)
  CARTE.categorie = function (f) {
    return ['Prairie / Bord de route', 'Espace agricole', 'Prairie / Bord de route', 'Landes', 'Landes', 'Pins de - 20 ans', 'Pins de - 20 ans', 'Pins de - 20 ans',
      'Pins de 20 à 40 ans', 'Pins de + 40 ans', 'Taillis/feuillus', 'Pins d’âges divers', 'Prairie / Bord de route', 'Marais'][f];
  };
  CARTE.lieuDit = function (x, y) {          // lieu-dit le plus proche (cartoguide 25 000)
    let best = null, bd = 1e12;
    for (const l of CARTE.c.lieux) { const d = (l.p[0] - x) ** 2 + (l.p[1] - y) ** 2; if (d < bd) { bd = d; best = l; } }
    return best ? best.n : '';
  };
  CARTE.commune = function (x, y) {
    for (const k of CARTE.c.communes) if (inPoly(x, y, k.p)) return k.n;
    return 'Salles';
  };
  function inPoly(x, y, P) { let ins = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [xi, yi] = P[i], [xj, yj] = P[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) ins = !ins; } return ins; }
  CARTE.inPoly = inPoly;
  CARTE.cap = function (dx, dy) { const a = (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360; return a; };
  CARTE.rose = function (deg) { return ['nord', 'nord-est', 'est', 'sud-est', 'sud', 'sud-ouest', 'ouest', 'nord-ouest'][Math.round(((deg % 360) + 360) % 360 / 45) % 8]; };

  // ---------------------------------------------------------------- reseau routier (itineraires)
  const SPEED = { route: 50, dfci: 30, piste: 25, chemin: 15 };      // km/h pour un CCF
  function buildGraph(c) {
    const key = p => Math.round(p[0]) + ',' + Math.round(p[1]);
    const nodes = new Map(), N = [], E = [];
    const node = p => { const k = key(p); let n = nodes.get(k); if (n == null) { n = N.length; nodes.set(k, n); N.push([p[0], p[1]]); E.push([]); } return n; };
    c.routes.forEach((r, ri) => {
      const v = SPEED[r.k]; if (!v) return;
      for (let i = 0; i < r.p.length - 1; i++) {
        const a = node(r.p[i]), b = node(r.p[i + 1]);
        const d = Math.hypot(r.p[i + 1][0] - r.p[i][0], r.p[i + 1][1] - r.p[i][1]);
        const t = d / (v / 3.6);
        E[a].push([b, t, d, ri]); E[b].push([a, t, d, ri]);
      }
    });
    c.gN = N; c.gE = E;
  }
  CARTE.nearestNode = function (x, y) {
    const N = CARTE.c.gN; let b = 0, bd = 1e18;
    for (let i = 0; i < N.length; i++) { const d = (N[i][0] - x) ** 2 + (N[i][1] - y) ** 2; if (d < bd) { bd = d; b = i; } }
    return b;
  };
  // itineraire le plus rapide : [{x,y}], duree (s), longueur (m)
  CARTE.route = function (x0, y0, x1, y1) {
    const c = CARTE.c, a = CARTE.nearestNode(x0, y0), b = CARTE.nearestNode(x1, y1);
    const n = c.gN.length, T = new Float64Array(n).fill(Infinity), P = new Int32Array(n).fill(-1), done = new Uint8Array(n);
    T[a] = 0; const H = [[0, a]];
    while (H.length) {
      let m = 0; for (let i = 1; i < H.length; i++) if (H[i][0] < H[m][0]) m = i;
      const [t, u] = H.splice(m, 1)[0]; if (done[u]) continue; done[u] = 1; if (u === b) break;
      for (const [v, dt] of c.gE[u]) if (t + dt < T[v]) { T[v] = t + dt; P[v] = u; H.push([T[v], v]); }
    }
    if (T[b] === Infinity) return null;
    const pts = []; for (let u = b; u !== -1; u = P[u]) pts.push({ x: c.gN[u][0], y: c.gN[u][1] });
    pts.reverse();
    const dIn = Math.hypot(pts[0].x - x0, pts[0].y - y0), dOut = Math.hypot(pts[pts.length - 1].x - x1, pts[pts.length - 1].y - y1);
    pts.unshift({ x: x0, y: y0 }); pts.push({ x: x1, y: y1 });
    let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    return { pts, t: T[b] + (dIn + dOut) / (5 / 3.6), L };
  };

  // ---------------------------------------------------------------- rendu
  function buildFuelCanvas(c) {
    const cv = document.createElement('canvas'); cv.width = c.w; cv.height = c.h;
    const ctx = cv.getContext('2d'), im = ctx.createImageData(c.w, c.h);
    const pal = c.combustibles.map(f => [parseInt(f.couleur.slice(1, 3), 16), parseInt(f.couleur.slice(3, 5), 16), parseInt(f.couleur.slice(5, 7), 16)]);
    // fond facon cartoguide : vert clair partout ou il y a de la vegetation, gris pour le non combustible
    const cg = [214, 210, 202];
    const cv2 = document.createElement('canvas'); cv2.width = c.w; cv2.height = c.h;
    const ctx2 = cv2.getContext('2d'), im2 = ctx2.createImageData(c.w, c.h);
    for (let i = 0; i < c.w * c.h; i++) {
      const f = c.fuel[i], p = pal[f];
      im.data[i * 4] = p[0]; im.data[i * 4 + 1] = p[1]; im.data[i * 4 + 2] = p[2]; im.data[i * 4 + 3] = 255;
      const q = f === 0 ? cg : f === 12 ? [236, 236, 230] : f === 1 ? [246, 240, 200] : [196, 244, 186];
      im2.data[i * 4] = q[0]; im2.data[i * 4 + 1] = q[1]; im2.data[i * 4 + 2] = q[2]; im2.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(im, 0, 0); ctx2.putImageData(im2, 0, 0);
    c.cvFuel = cv; c.cvGuide = cv2;
  }

  // vue : centre (cx, cy) en metres, echelle en pixels par metre
  CARTE.Vue = function (canvas) {
    this.cv = canvas; this.ctx = canvas.getContext('2d');
    this.cx = 6300; this.cy = 5400; this.s = 0.12; this.fond = 'cartoguide';
    this.couches = { grille: true, pe: true, lieux: true, bati: true };
  };
  const V = CARTE.Vue.prototype;
  V.sx = function (x) { return (x - this.cx) * this.s + this.cv.width / this.dpr / 2; };
  V.sy = function (y) { return (this.cy - y) * this.s + this.cv.height / this.dpr / 2; };
  V.mx = function (px) { return (px - this.cv.width / this.dpr / 2) / this.s + this.cx; };
  V.my = function (py) { return this.cy - (py - this.cv.height / this.dpr / 2) / this.s; };
  V.resize = function () {
    const r = this.cv.getBoundingClientRect(); this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.cv.width = Math.round(r.width * this.dpr); this.cv.height = Math.round(r.height * this.dpr);
  };
  V.zoom = function (f, px, py) {
    const x = this.mx(px), y = this.my(py);
    this.s = Math.max(0.04, Math.min(4, this.s * f));
    this.cx = x - (px - this.cv.width / this.dpr / 2) / this.s; this.cy = y + (py - this.cv.height / this.dpr / 2) / this.s;
  };
  V.centre = function (x, y, s) { this.cx = x; this.cy = y; if (s) this.s = s; };

  V.dessineFond = function () {
    const c = CARTE.c, ctx = this.ctx, W = this.cv.width / this.dpr, H = this.cv.height / this.dpr;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#c4f4ba'; ctx.fillRect(0, 0, W, H);
    const img = this.fond === 'ortho' ? c.ortho : this.fond === 'peuplements' ? c.cvFuel : c.cvGuide;
    ctx.imageSmoothingEnabled = this.fond === 'ortho' || this.s < 0.3;
    if (img && (img.complete === undefined || img.complete)) ctx.drawImage(img, this.sx(0), this.sy(c.H), c.W * this.s, c.H * this.s);
    const s = this.s, sx = x => this.sx(x), sy = y => this.sy(y);
    const line = (pts) => { ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(sx(p[0]), sy(p[1])) : ctx.moveTo(sx(p[0]), sy(p[1]))); };
    // eau
    ctx.strokeStyle = this.fond === 'ortho' ? 'rgba(90,170,255,.8)' : '#58c8e0'; ctx.lineWidth = Math.max(0.6, s * 2);
    ctx.setLineDash(s > 0.25 ? [4, 3] : []);
    for (const h of c.hydro) { line(h.p); ctx.stroke(); }
    ctx.setLineDash([]);
    // lignes electriques
    ctx.strokeStyle = '#8a5cff'; ctx.lineWidth = 1.2;
    for (const e of c.elec) { line(e.p); ctx.stroke(); }
    // bati
    if (this.couches.bati && s > 0.18) {
      ctx.fillStyle = '#7d7f86';
      for (const b of c.bati) { line(b.p); ctx.closePath(); ctx.fill(); }
    }
    // routes et pistes (style cartoguide : routes blanches bordees, pistes DFCI rouge et noir, chemins noirs)
    const order = ['sentier', 'chemin', 'piste', 'dfci', 'route'];
    for (const k of order) {
      for (const r of c.routes) {
        if (r.k !== k) continue;
        if (k === 'sentier' && s < 0.3) continue;
        if (k === 'route') { line(r.p); ctx.strokeStyle = '#555'; ctx.lineWidth = Math.max(3, s * 9); ctx.stroke(); ctx.strokeStyle = r.n && /^D/.test(r.n) ? '#f5e04a' : '#fff'; ctx.lineWidth = Math.max(2, s * 7); ctx.stroke(); }
        else if (k === 'dfci') { line(r.p); ctx.strokeStyle = '#111'; ctx.lineWidth = Math.max(2, s * 5); ctx.stroke(); ctx.strokeStyle = '#e8202a'; ctx.setLineDash([Math.max(3, s * 18), Math.max(3, s * 18)]); ctx.stroke(); ctx.setLineDash([]); }
        else if (k === 'piste') { line(r.p); ctx.strokeStyle = '#333'; ctx.lineWidth = Math.max(2, s * 5); ctx.stroke(); ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(1, s * 3); ctx.setLineDash([Math.max(2, s * 10), Math.max(2, s * 8)]); ctx.stroke(); ctx.setLineDash([]); }
        else { line(r.p); ctx.strokeStyle = '#1b1b1b'; ctx.lineWidth = Math.max(1, s * 2.5); ctx.stroke(); }
      }
    }
    // carroyage DFCI
    if (this.couches.grille) {
      const [ox, oy] = c.dfci.origine_l93, p = c.dfci.pas, X0 = c.lambert93[0], Y0 = c.lambert93[1];
      const x0 = this.mx(0), x1 = this.mx(W), y0 = this.my(H), y1 = this.my(0);
      const k0 = Math.floor((X0 + x0 - ox) / p), k1 = Math.ceil((X0 + x1 - ox) / p), j0 = Math.floor((Y0 + y0 - oy) / p), j1 = Math.ceil((Y0 + y1 - oy) / p);
      ctx.strokeStyle = 'rgba(190,110,200,.75)'; ctx.lineWidth = 1;
      for (let k = k0; k <= k1; k++) { const x = sx(ox + k * p - X0); ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
      for (let j = j0; j <= j1; j++) { const y = sy(oy + j * p - Y0); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
      if (s > 0.09) {
        ctx.fillStyle = '#a21caf'; ctx.font = `600 ${Math.min(13, Math.max(9, s * 40))}px "IBM Plex Sans", sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        for (let k = k0; k < k1; k++) for (let j = j0; j < j1; j++) {
          const lab = String.fromCharCode(65 + Math.floor(k / 26), 65 + (k % 26)) + ' ' + j;
          ctx.fillText(lab, sx(ox + (k + 0.5) * p - X0), sy(oy + (j + 0.5) * p - Y0));
        }
      }
    }
    // lieux-dits
    if (this.couches.lieux && s > 0.07) {
      ctx.font = `600 ${Math.min(13, Math.max(10, s * 45))}px "IBM Plex Sans", sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (const l of c.lieux) {
        const x = sx(l.p[0]), y = sy(l.p[1]); if (x < -80 || x > W + 80 || y < -20 || y > H + 20) continue;
        const t = (l.k === 'hameau' ? '' : 'LIEU DIT ') + l.n.toUpperCase();
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.strokeText(t, x, y); ctx.fillStyle = '#2a1f14'; ctx.fillText(t, x, y);
      }
    }
    // points d'eau du cartoguide
    if (this.couches.pe) for (const q of c.points_eau) CARTE.symbolePE(ctx, sx(q.p[0]), sy(q.p[1]), q, Math.max(0.7, Math.min(1.4, s * 4)));
  };

  CARTE.symbolePE = function (ctx, x, y, q, k, actif) {
    ctx.save(); ctx.translate(x, y); ctx.scale(k, k);
    ctx.strokeStyle = '#2a6df0'; ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 2.5;
    ctx.beginPath();
    if (q.forme === 'triangle') { ctx.moveTo(0, -11); ctx.lineTo(9, 5); ctx.lineTo(-9, 5); ctx.closePath(); }
    else if (q.forme === 'losange') { ctx.moveTo(0, -10); ctx.lineTo(10, 0); ctx.lineTo(0, 10); ctx.lineTo(-10, 0); ctx.closePath(); }
    else if (q.forme === 'rond') ctx.arc(0, 0, 8.5, 0, Math.PI * 2);
    if (q.forme !== 'point') { ctx.fill(); ctx.stroke(); }
    ctx.fillStyle = '#e8202a'; ctx.beginPath(); ctx.arc(0, 0, 4.2, 0, Math.PI * 2); ctx.fill();
    ctx.font = '700 12px "IBM Plex Sans", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.lineWidth = 3; ctx.strokeStyle = '#fff'; ctx.strokeText(q.n, 0, 9); ctx.fillStyle = '#e8202a'; ctx.fillText(q.n, 0, 9);
    if (actif) { ctx.strokeStyle = '#2a6df0'; ctx.lineWidth = 2; ctx.setLineDash([3, 2]); ctx.beginPath(); ctx.arc(0, 0, 16, 0, Math.PI * 2); ctx.stroke(); }
    ctx.restore();
  };

  window.CARTE = CARTE;
})();
