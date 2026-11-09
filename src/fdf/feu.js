// =============================================================================
// Propagation d'un feu de foret sur la carte reelle (grille 10 m).
// - Vitesse de propagation de surface : modele de Rothermel (1972) avec les
//   modeles de combustible standard (Anderson 1982, Scott & Burgan 2005)
//   associes aux peuplements landais du memento SDIS 33.
// - Forme elliptique selon le vent (Anderson 1983), effet de la pente.
// - Passage en cimes (Van Wagner 1977), sautes de feu sous le vent.
// - Arrivee du feu en chaque maille : temps de parcours minimal (Dijkstra, 16 voisins).
// - Intensite du front (Byram, kW/m) : sert au dimensionnement du memento.
// Utilisable dans le navigateur (window.FEU) et sous Node (module.exports).
// =============================================================================
(function (root) {
  'use strict';
  const TA = 0.224169;          // t/acre -> lb/ft2
  // modeles de combustible : charges (t/acre) 1h, 10h, 100h, herbacee vivante, ligneux vivant ;
  // SAV (1/ft) 1h, herbacee, ligneux ; hauteur du lit (ft) ; humidite d'extinction (%)
  const MODELS = {
    GR1: { w: [0.1, 0, 0, 0.3, 0], s: [2200, 2000, 1500], d: 0.4, mx: 15, dyn: true },
    GR2: { w: [0.1, 0, 0, 1.0, 0], s: [2000, 1800, 1500], d: 1.0, mx: 15, dyn: true },
    GS2: { w: [0.5, 0.5, 0, 0.6, 1.0], s: [2000, 1800, 1800], d: 1.5, mx: 15, dyn: true },
    SH2: { w: [1.35, 2.4, 0.75, 0, 3.85], s: [2000, 1800, 1600], d: 1.0, mx: 15 },
    SH5: { w: [3.6, 2.1, 0, 0, 2.9], s: [750, 1800, 1600], d: 6.0, mx: 15 },
    SH7: { w: [3.5, 5.3, 2.2, 0, 3.4], s: [750, 1800, 1600], d: 6.0, mx: 15 },
    FM4: { w: [5.01, 4.01, 2.0, 0, 5.01], s: [2000, 1800, 1500], d: 6.0, mx: 20 },
    TL6: { w: [2.4, 1.2, 1.2, 0, 0], s: [2000, 1800, 1500], d: 0.3, mx: 25 },
    FM10: { w: [3.01, 2.0, 5.01, 0, 2.0], s: [2000, 1800, 1500], d: 1.0, mx: 25 },
  };
  // peuplements (index = code combustible de la carte) : modele, coefficient de reduction du vent,
  // hauteur de base du houppier (m), densite apparente du houppier (kg/m3), facteur de calage k :
  // k ramene la vitesse de Rothermel a la regle du memento SDIS 33 (vent m/s x 100 = m/h) a 7 m/s, secheresse forte,
  // en gardant la hierarchie de la presentation du massif (fdf/calage.js)
  const PEUP = [
    null,                                                       // 0 non combustible
    { m: 'GR1', waf: 0.5, k: 0.44 },                            // 1 espace agricole
    { m: 'GR2', waf: 0.5, k: 0.31 },                            // 2 prairie, bord de route
    { m: 'SH5', waf: 0.4, k: 0.22 },                            // 3 landes
    { m: 'GS2', waf: 0.5, k: 0.49 },                            // 4 coupe rase
    { m: 'SH5', waf: 0.5, k: 0.16 },                            // 5 semis 0-5 ans
    { m: 'FM4', waf: 0.45, k: 0.19 },                           // 6 pins 5-10 ans
    { m: 'FM4', waf: 0.4, k: 0.21, cbh: 1.5, cbd: 0.2 },        // 7 pins 10-20 ans
    { m: 'SH5', waf: 0.25, k: 0.23, cbh: 5, cbd: 0.13 },        // 8 pins 20-40 ans
    { m: 'SH2', waf: 0.2, k: 5.7, cbh: 9, cbd: 0.1 },           // 9 pins + 40 ans
    { m: 'TL6', waf: 0.15, k: 7.7 },                            // 10 taillis, feuillus
    { m: 'SH7', waf: 0.3, k: 0.38, cbh: 3, cbd: 0.15 },         // 11 pins d'ages divers
    { m: 'GR1', waf: 0.4, k: 0.23 },                            // 12 jardins
    { m: 'GR2', waf: 0.5, k: 0.15 },                            // 13 marais
  ];
  // etats hydriques (teneur en eau %, 1h/10h/100h/herbacee/ligneux) selon la secheresse (indicateurs Griffon)
  const SECHERESSE = {
    moderee: [9, 10, 12, 90, 120],
    forte: [6, 7, 9, 60, 90],
    extreme: [4, 5, 7, 30, 70],
  };

  function rothermel(M, mois, uMid, slope) {
    // uMid : vent a mi-flamme (m/s), slope : tan(pente). Renvoie vitesse (m/min), intensite de reaction (kW/m2), temps de residence (min)
    const w = M.w.map(v => v * TA), sav = [M.s[0], 109, 30, M.s[1], M.s[2]];
    const md = mois.map(v => v / 100);
    let wl = w.slice();
    if (M.dyn) { const cure = Math.min(1, Math.max(0, -1.11 * md[3] + 1.33)); wl[0] += w[3] * cure; wl[3] = w[3] * (1 - cure); }
    const rhoP = 32, St = 0.0555, Se = 0.01, h = 8000, delta = M.d;
    const dead = [0, 1, 2], live = [3, 4];
    const A = wl.map((x, i) => x * sav[i] / rhoP);
    const Ad = dead.reduce((a, i) => a + A[i], 0), Al = live.reduce((a, i) => a + A[i], 0), At = Ad + Al;
    if (At <= 0) return { R: 0, IR: 0, tr: 1 };
    const fij = wl.map((x, i) => (i < 3 ? (Ad ? A[i] / Ad : 0) : (Al ? A[i] / Al : 0)));
    const fd = Ad / At, fl = Al / At;
    const sd = dead.reduce((a, i) => a + fij[i] * sav[i], 0), sl = live.reduce((a, i) => a + fij[i] * sav[i], 0);
    const sigma = fd * sd + fl * sl;
    const wnd = dead.reduce((a, i) => a + fij[i] * wl[i] * (1 - St), 0), wnl = live.reduce((a, i) => a + fij[i] * wl[i] * (1 - St), 0);
    const mfd = dead.reduce((a, i) => a + fij[i] * md[i], 0);
    // humidite d'extinction des vivants
    const Wr = dead.reduce((a, i) => a + wl[i] * Math.exp(-138 / sav[i]), 0) / (live.reduce((a, i) => a + wl[i] * Math.exp(-500 / sav[i]), 0) || 1e-9);
    const mfdW = dead.reduce((a, i) => a + wl[i] * Math.exp(-138 / sav[i]) * md[i], 0) / (dead.reduce((a, i) => a + wl[i] * Math.exp(-138 / sav[i]), 0) || 1e-9);
    const mxd = M.mx / 100, mxl = Math.max(mxd, 2.9 * Wr * (1 - mfdW / mxd) - 0.226);
    const mfl = live.reduce((a, i) => a + fij[i] * md[i], 0);
    const damp = (m, mx) => { const r = Math.min(1, m / mx); return Math.max(0, 1 - 2.59 * r + 5.11 * r * r - 3.52 * r * r * r); };
    const etaS = Math.min(1, 0.174 * Math.pow(Se, -0.19));
    const wo = wl.reduce((a, b) => a + b, 0);
    const rhoB = wo / delta, beta = rhoB / rhoP, betaOp = 3.348 * Math.pow(sigma, -0.8189), rat = beta / betaOp;
    const Amax = Math.pow(sigma, 1.5) / (495 + 0.0594 * Math.pow(sigma, 1.5)), Aa = 133 * Math.pow(sigma, -0.7913);
    const gamma = Amax * Math.pow(rat, Aa) * Math.exp(Aa * (1 - rat));
    const IR = gamma * (wnd * h * damp(mfd, mxd) * etaS + wnl * h * damp(mfl, mxl) * etaS);   // BTU/ft2/min
    const xi = Math.exp((0.792 + 0.681 * Math.sqrt(sigma)) * (beta + 0.1)) / (192 + 0.2595 * sigma);
    const C = 7.47 * Math.exp(-0.133 * Math.pow(sigma, 0.55)), B = 0.02526 * Math.pow(sigma, 0.54), E = 0.715 * Math.exp(-3.59e-4 * sigma);
    const U = uMid * 196.85;                                       // ft/min
    const phiW = C * Math.pow(U, B) * Math.pow(rat, -E), phiS = 5.275 * Math.pow(beta, -0.3) * slope * slope;
    const eps = Math.exp(-138 / sigma), Qig = 250 + 1116 * mfd;
    const R = IR * xi * (1 + phiW + phiS) / (rhoB * eps * Qig);   // ft/min
    return { R: R * 0.3048, IR: IR * 0.1893, tr: 384 / sigma };
  }

  // rapport longueur / largeur de l'ellipse (Anderson 1983), vent a mi-flamme en m/s
  function LB(uMid) { const mph = uMid * 2.237; return Math.max(1, 0.936 * Math.exp(0.2566 * mph) + 0.461 * Math.exp(-0.1548 * mph) - 0.397); }

  // ---------------------------------------------------------------------------
  function Feu(carte, opts) {
    this.c = carte; this.W = carte.w; this.H = carte.h; this.res = carte.res;
    this.fuel = carte.fuel; this.alt = carte.alt; this.haut = carte.haut;
    this.cal = opts.calage || 1;
    this.setMeteo(opts.vent || 5, opts.dir || 270, opts.secheresse || 'forte', opts.hygro);
    const N = this.W * this.H;
    this.ta = new Float64Array(N).fill(Infinity);   // instant d'arrivee du feu (s)
    this.ext = new Uint8Array(N);                    // 1 : eteint par les secours, 2 : barriere (eau, retardant, bande noyee)
    this.wet = new Float32Array(N);                  // mouillage (s restant) : la maille ne brule pas
    this.t = 0; this.heap = []; this.spots = []; this.rng = mulberry(opts.graine || 1);
    this.burnt = 0;
  }
  // teneur en eau d'equilibre des combustibles morts fins (Simard 1968) selon l'humidite de l'air, a 30 °C
  function emc(rh, T) {
    T = T == null ? 30 : T;
    return rh < 10 ? 0.03229 + 0.281073 * rh - 0.000578 * rh * T : rh < 50 ? 2.22749 + 0.160107 * rh - 0.01478 * T : 21.0606 + 0.005565 * rh * rh - 0.00035 * rh * T - 0.483199 * rh;
  }
  Feu.prototype.setMeteo = function (vent, dirDeg, sech, hygro) {
    // vent : vitesse a 10 m (m/s), dirDeg : direction d'ou vient le vent (degres, 0 = nord)
    // hygro : humidite relative (%) ; fixe la teneur en eau des combustibles morts (la secheresse fixe celle du vivant)
    if (hygro == null) hygro = this.hygro;
    this.vent = vent; this.dir = dirDeg; this.sech = sech; this.hygro = hygro; this.mois = SECHERESSE[sech].slice();
    if (hygro != null) { const m = Math.max(3, emc(hygro)); this.mois[0] = m; this.mois[1] = m + 1.5; this.mois[2] = m + 3; }
    const to = (dirDeg + 180) * Math.PI / 180;           // direction vers laquelle souffle le vent
    this.wx = Math.sin(to); this.wy = Math.cos(to);      // repere carte : x est, y nord
    this.tab = PEUP.map(p => {
      if (!p) return null;
      const M = MODELS[p.m], u = vent * p.waf;
      const r = rothermel(M, this.mois, u, 0);
      const r0 = rothermel(M, this.mois, 0, 0);
      // combustible consomme par le front (kg/m2) : fins morts, moitie des 100 h et des ligneux vivants
      const wc = (M.w[0] + M.w[1] + 0.5 * M.w[2] + M.w[3] + 0.5 * M.w[4]) * 0.2242;
      return { R: r.R * p.k * this.cal, R0: r0.R * p.k * this.cal, IR: r.IR, tr: r.tr, wc, lb: LB(u), p };
    });
    if (this.heap && this.heap.length) this.reseed();
  };
  // vitesse (m/min) dans la direction (dx, dy) normalisee, et intensite de front (kW/m) en tete
  Feu.prototype.rosDir = function (f, dx, dy) {
    const T = this.tab[f]; if (!T) return 0;
    const cos = dx * this.wx + dy * this.wy, lb = T.lb;
    const e = Math.sqrt(1 - 1 / (lb * lb));
    return T.R * (1 - e) / (1 - e * cos);
  };
  Feu.prototype.headIntensity = function (f) {
    const T = this.tab[f]; if (!T) return 0;
    let I = 18000 * T.wc * T.R / 60;                // Byram : chaleur de combustion (kJ/kg) x combustible consomme (kg/m2) x vitesse (m/s)
    if (this.crown(f)) I += 18000 * T.p.cbd * 6 * T.R / 60 * 0.6;   // houppiers brules (6 m de houppier)
    return I;
  };
  Feu.prototype.crown = function (f) {
    const T = this.tab[f]; if (!T || T.p.cbh == null) return 0;
    const I0 = Math.pow(0.01 * T.p.cbh * (460 + 25.9 * 100), 1.5);
    const I = 18000 * T.wc * T.R / 60;
    if (I < I0) return 0;
    const Rcrit = 3 / T.p.cbd;                          // m/min (Van Wagner) : feu de cimes actif
    const Ra = 3.34 * rothermel(MODELS.FM10, this.mois, this.vent * 0.4, 0).R * this.cal;
    return Ra >= Rcrit ? 2 : 1;                        // 1 passif, 2 actif
  };

  // allumage
  Feu.prototype.allume = function (x, y, t) {
    const i = this.idx(x, y); if (i < 0) return;
    this.ta[i] = t || this.t; this.push(i, this.ta[i]);
  };
  Feu.prototype.idx = function (x, y) {      // x, y en metres locaux (y vers le nord)
    const c = Math.floor(x / this.res), r = this.H - 1 - Math.floor(y / this.res);
    return c >= 0 && c < this.W && r >= 0 && r < this.H ? r * this.W + c : -1;
  };
  Feu.prototype.xy = function (i) { const r = Math.floor(i / this.W), c = i % this.W; return [(c + 0.5) * this.res, (this.H - 1 - r + 0.5) * this.res]; };

  // tas binaire (instant d'arrivee)
  Feu.prototype.push = function (i, t) {
    const h = this.heap; h.push([t, i]); let k = h.length - 1;
    while (k > 0) { const p = (k - 1) >> 1; if (h[p][0] <= h[k][0]) break; [h[p], h[k]] = [h[k], h[p]]; k = p; }
  };
  Feu.prototype.pop = function () {
    const h = this.heap, top = h[0], last = h.pop();
    if (h.length) { h[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < h.length && h[l][0] < h[m][0]) m = l; if (r < h.length && h[r][0] < h[m][0]) m = r; if (m === k) break; [h[m], h[k]] = [h[k], h[m]]; k = m; } }
    return top;
  };
  // apres un changement de vent ou d'action des secours : on repart du front actuel
  Feu.prototype.reseed = function () {
    this.heap = [];
    const N = this.W * this.H, t = this.t;
    for (let i = 0; i < N; i++) {
      const a = this.ta[i];
      if (a <= t && !this.ext[i]) this.push(i, a);
      else if (a > t && a !== Infinity) this.ta[i] = Infinity;
    }
  };

  const NB = [];
  for (const [dc, dr] of [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1], [2, 1], [1, 2], [-1, 2], [-2, 1], [-2, -1], [-1, -2], [1, -2], [2, -1]])
    NB.push([dc, dr, Math.hypot(dc, dr), dc / Math.hypot(dc, dr), -dr / Math.hypot(dc, dr)]);

  // fait avancer le feu jusqu'a l'instant t (s)
  Feu.prototype.avance = function (t) {
    const W = this.W, H = this.H, res = this.res;
    while (this.heap.length && this.heap[0][0] <= t) {
      const [ti, i] = this.pop();
      if (ti > this.ta[i] || this.ext[i]) continue;
      const r = Math.floor(i / W), c = i % W, f0 = this.fuel[i];
      const T0 = this.tab[f0];
      for (const [dc, dr, d, ux, uy] of NB) {
        const cc = c + dc, rr = r + dr; if (cc < 0 || cc >= W || rr < 0 || rr >= H) continue;
        const j = rr * W + cc; if (this.ext[j] || this.ta[j] <= ti) continue;
        let fj = this.fuel[j], ros;
        if (!this.tab[fj]) {
          // maille non combustible (piste, route, eau) : franchie seulement par un front intense (flammes > largeur)
          if (!T0) continue;
          const I = this.headIntensity(f0), Lf = 0.0775 * Math.pow(I, 0.46);
          if (Lf < 2.5 * res / 10 * 2 || this.wet[j] > ti) continue;
          ros = this.rosDir(f0, ux, uy) * 0.3;
        } else {
          if (this.wet[j] > ti) continue;
          // vitesse moyenne entre les deux mailles, pente, cimes
          const rj = this.rosDir(fj, ux, uy), ri = T0 ? this.rosDir(f0, ux, uy) : rj;
          ros = 2 * ri * rj / (ri + rj || 1);
          const dz = (this.alt[j] - this.alt[i]) / 5, sl = dz / (d * res);
          ros *= Math.max(0.3, 1 + (sl > 0 ? 6 : 2) * sl);
          const cr = this.crown(fj); if (cr === 2) ros *= 1.6; else if (cr === 1) ros *= 1.15;
        }
        if (ros <= 1e-4) continue;
        const tj = ti + d * res / ros * 60;
        if (tj < this.ta[j]) { this.ta[j] = tj; this.push(j, tj); }
      }
      this.burnt++;
      // sautes de feu : feux de cimes sous vent soutenu
      if (this.vent > 6 && this.crown(f0) && this.rng() < 0.0015 * this.vent / 10) {
        const dist = 60 + this.rng() * 30 * this.vent, ang = (this.rng() - 0.5) * 0.5;
        const ca = Math.cos(ang), sa = Math.sin(ang), dx = this.wx * ca - this.wy * sa, dy = this.wx * sa + this.wy * ca;
        const [x, y] = this.xy(i), k = this.idx(x + dx * dist, y + dy * dist);
        if (k >= 0 && this.tab[this.fuel[k]] && !this.ext[k] && this.ta[k] > ti + 60) {
          const tk = ti + 60 + this.rng() * 120; this.ta[k] = tk; this.push(k, tk); this.spots.push({ i: k, t: tk });
        }
      }
    }
    this.t = t;
  };

  // etat d'une maille a l'instant t : 0 intacte, 1 front actif (flammes), 2 brule (fumerons), 3 eteinte
  Feu.prototype.etat = function (i) {
    if (this.ext[i] === 1) return 3;
    const a = this.ta[i]; if (a > this.t) return 0;
    const T = this.tab[this.fuel[i]]; const dur = T ? Math.max(90, T.tr * 60 * 8) : 60;
    return this.t - a < dur ? 1 : 2;
  };
  // eteint ou mouille un disque (actions de lutte). mode 'eteint' : flammes abattues ; 'mouille' : barriere temporaire
  Feu.prototype.traite = function (x, y, rayon, mode, duree) {
    const r0 = Math.ceil(rayon / this.res); const c0 = Math.floor(x / this.res), rw = this.H - 1 - Math.floor(y / this.res);
    let n = 0;
    for (let dr = -r0; dr <= r0; dr++) for (let dc = -r0; dc <= r0; dc++) {
      if (dc * dc + dr * dr > r0 * r0) continue;
      const c = c0 + dc, r = rw + dr; if (c < 0 || c >= this.W || r < 0 || r >= this.H) continue;
      const i = r * this.W + c;
      if (mode === 'eteint' && this.ta[i] <= this.t) { if (!this.ext[i]) n++; this.ext[i] = 1; }
      else if (mode === 'mouille') this.wet[i] = Math.max(this.wet[i], this.t + (duree || 600));
    }
    return n;
  };

  // grandeurs pour les messages : surface brulee (ha), longueur du front (tete) et des flancs (m), intensite max
  Feu.prototype.bilan = function () {
    const N = this.W * this.H, a = this.res * this.res, W = this.W;
    let s = 0, front = 0, flanc = 0, Imax = 0, x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    const sx = Math.round(this.wx * 2), sy = -Math.round(this.wy * 2);    // deux mailles sous le vent (colonne, ligne)
    const actifs = [];
    for (let i = 0; i < N; i++) {
      if (this.ta[i] > this.t) continue;
      s++;
      const r = Math.floor(i / W), c = i % W;
      if (this.etat(i) === 1) {
        let edge = false;
        for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const j = (r + dr) * W + c + dc; if (j >= 0 && j < N && this.ta[j] > this.t && this.tab[this.fuel[j]] && !this.ext[j]) edge = true; }
        if (edge) {
          const j = (r + sy) * W + c + sx;
          if (j >= 0 && j < N && this.ta[j] > this.t && this.tab[this.fuel[j]]) { front++; Imax = Math.max(Imax, this.headIntensity(this.fuel[i])); }
          else flanc++;
          actifs.push(i);
        }
      }
      const x = (c + 0.5) * this.res, y = (this.H - 1 - r + 0.5) * this.res;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    // longueur du front : etendue des mailles de tete perpendiculairement au vent
    return { ha: s * a / 1e4, front: front * this.res, flancs: flanc * this.res, Imax, emprise: [x0, y0, x1, y1], actifs };
  };

  function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  const FEU = { Feu, rothermel, MODELS, PEUP, SECHERESSE, LB, emc };
  if (typeof module !== 'undefined' && module.exports) module.exports = FEU; else root.FEU = FEU;
})(typeof window !== 'undefined' ? window : globalThis);
