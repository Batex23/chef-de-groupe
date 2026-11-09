// =============================================================================
// Vue de terrain d'un peuplement : dessin procedural a partir du type de
// peuplement (BD Foret) et de la hauteur mesuree au LiDAR (carte.haut, dm).
// Sert a estimer l'age des pins et les strates (continuite verticale) en
// reconnaissance. Un personnage de 1,80 m donne l'echelle.
// Types : 0 INC, 1 AGR, 2 PRA, 3 LAN, 4 COU, 5 SEM, 6 P10, 7 P20, 8 P40, 9 P99,
// 10 FEU, 11 MIX, 12 JAR, 13 MAR.
// =============================================================================
(function () {
  'use strict';
  const P = {};
  function rng(seed) { let a = seed | 0; return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  // hauteur dominante (m) autour du point, sur les mailles du meme type
  P.mesure = function (c, x, y) {
    const i0 = CARTE.idx(x, y); if (i0 < 0) return null;
    const f = c.fuel[i0], hs = [];
    const col = i0 % c.w, row = Math.floor(i0 / c.w);
    for (let dr = -4; dr <= 4; dr++) for (let dc = -4; dc <= 4; dc++) {
      const cc = col + dc, rr = row + dr; if (cc < 0 || rr < 0 || cc >= c.w || rr >= c.h) continue;
      const i = rr * c.w + cc; if (c.fuel[i] === f && c.haut[i] > 0) hs.push(c.haut[i] / 10);
    }
    hs.sort((a, b) => a - b);
    const hd = hs.length ? hs[Math.floor(hs.length * 0.8)] : 0;   // hauteur dominante (80e centile)
    return { f, h: hd, seed: i0 };
  };

  // parametres du peuplement : hauteur, base du houppier, densite, sous-bois
  const DEF = { 5: 1.2, 6: 4, 7: 9, 8: 15, 9: 22, 10: 12, 11: 12 };
  P.params = function (m) {
    const f = m.f; let h = m.h || DEF[f] || 0;
    if (f === 5) h = Math.min(Math.max(h, 0.6), 2.5);
    if (f === 6) h = Math.min(Math.max(h, 2), 7);
    if (f === 7) h = Math.min(Math.max(h, 6), 13);
    if (f === 8) h = Math.min(Math.max(h, 11), 20);
    if (f === 9) h = Math.max(h, 18);
    const base = { 5: 0, 6: 0.05, 7: 0.25, 8: 0.55, 9: 0.68, 10: 0.35, 11: 0.3 }[f];
    const sb = {   // sous-bois : [type, hauteur m, recouvrement]
      3: ['lande', 1.4, 1], 4: ['coupe', 0.6, 0.7], 5: ['lande', 1.0, 0.9], 6: ['ajonc', 1.5, 0.9], 7: ['brande', 1.6, 0.85],
      8: ['fougere', 1.2, 0.75], 9: ['fougere', 1.0, 0.6], 10: ['taillis', 2.5, 0.6], 11: ['brande', 1.4, 0.7],
    }[f] || ['herbe', 0.3, 0.5];
    const n = { 5: 22, 6: 18, 7: 14, 8: 9, 9: 6, 10: 7, 11: 10 }[f] || 0;
    const cbh = base != null ? h * base : 0;
    return { f, h, cbh, sb, n, continu: cbh <= sb[1] + 0.8 };
  };

  P.texte = function (q) {
    const nom = { 0: 'Zone non combustible', 1: 'Espace agricole', 2: 'Prairie, bord de route', 3: 'Lande (ajonc, brande, molinie)', 4: 'Coupe rase avec rémanents', 5: 'Semis de pins (moins de 5 ans)', 6: 'Pins de moins de 10 ans', 7: 'Pins de 10 à 20 ans', 8: 'Pins de 20 à 40 ans', 9: 'Pins de plus de 40 ans', 10: 'Feuillus (chênes), taillis', 11: 'Pins d\'âges divers', 12: 'Jardins, habitat', 13: 'Marais' }[q.f];
    const sbn = { lande: 'lande basse (ajonc, brande, molinie)', coupe: 'herbacées et rémanents', ajonc: 'ajoncs et brande serrés', brande: 'brande et ajonc', fougere: 'fougère aigle et molinie', taillis: 'taillis de chênes', herbe: 'strate herbacée' }[q.sb[0]];
    const arbres = q.n ? `hauteur dominante ≈ ${Math.round(q.h)} m, houppiers à partir de ${q.cbh < 0.5 ? 'du sol' : Math.round(q.cbh) + ' m'}. ` : '';
    const strates = q.n ? `Strates : herbacée, ${sbn} (≈ ${q.sb[1].toFixed(1)} m), arborée. ` : `Strates : ${sbn}. `;
    const cont = !q.n ? 'Feu de surface, propagation rapide par vent.' : q.continu ? 'Continuité verticale : le feu monte dans les houppiers (torchage, feu de cimes possible).' : 'Discontinuité verticale entre sous-bois et houppiers : feu de surface, passage en cimes seulement par vent fort ou forte intensité.';
    return { nom, detail: arbres + strates + cont };
  };

  // ------------------------------------------------------------- dessin
  P.dessine = function (cv, m, o) {
    o = o || {};
    const q = P.params(m), R = rng(m.seed || 1), x = cv.getContext('2d'), W = cv.width, H = cv.height;
    const sol = H - 46, haut = Math.max(q.h * 1.12, q.n ? 6 : 3.2), ppm = (sol - 24) / haut;
    const Y = hm => sol - hm * ppm;
    // ciel et lointain
    let g = x.createLinearGradient(0, 0, 0, sol); g.addColorStop(0, '#9ec4e4'); g.addColorStop(0.75, '#dfe9ee'); g.addColorStop(1, '#ece6d6');
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    x.fillStyle = 'rgba(80,105,90,.35)'; x.beginPath(); x.moveTo(0, sol);
    for (let i = 0; i <= W; i += 8) x.lineTo(i, sol - (q.n ? 0.55 * q.h * ppm : 18) - Math.sin(i * 0.05 + R() * 2) * 6 - R() * 5);
    x.lineTo(W, sol); x.fill();
    // sol (litiere d'aiguilles, sable)
    g = x.createLinearGradient(0, sol, 0, H); g.addColorStop(0, q.f === 13 ? '#6b7a5a' : '#9b8665'); g.addColorStop(1, q.f === 13 ? '#4a5a44' : '#7a6447');
    x.fillStyle = g; x.fillRect(0, sol, W, H - sol);
    for (let i = 0; i < 160; i++) { x.fillStyle = `rgba(${90 + R() * 60},${70 + R() * 40},${40 + R() * 30},.5)`; x.fillRect(R() * W, sol + R() * (H - sol), 2 + R() * 4, 1); }
    if (q.f === 13) for (let i = 0; i < 6; i++) { x.fillStyle = 'rgba(120,160,190,.55)'; x.beginPath(); x.ellipse(R() * W, sol + 8 + R() * 30, 30 + R() * 50, 4 + R() * 4, 0, 0, 7); x.fill(); }

    // deux rangs d'arbres : fond (estompe) puis avant
    const rangs = [{ s: 0.78, a: 0.55, dy: -10 }, { s: 1, a: 1, dy: 0 }];
    for (const rg of rangs) {
      const n = Math.round(q.n * (rg.s < 1 ? 0.8 : 1));
      if (rg.s === 1) sousBois(x, q, R, W, sol, ppm, rg);
      for (let k = 0; k < n; k++) {
        const tx = (k + 0.2 + R() * 0.6) / n * W, hh = q.h * (0.82 + R() * 0.25) * rg.s;
        const feuillu = q.f === 10 || (q.f === 11 && R() < 0.3);
        const hk = q.f === 11 ? hh * (0.45 + R() * 0.6) : hh;
        if (feuillu) chene(x, tx, sol + rg.dy, hk, ppm, R, rg.a);
        else pin(x, tx, sol + rg.dy, hk, q.f === 11 ? hk * (0.2 + R() * 0.5) : q.cbh * rg.s * (0.85 + R() * 0.3), ppm, R, rg.a, q.f);
      }
      if (rg.s < 1) { x.fillStyle = 'rgba(223,233,238,.25)'; x.fillRect(0, 0, W, sol); }
    }
    if (!q.n) sousBois(x, q, R, W, sol, ppm, { s: 1, a: 1, dy: 0 });
    if (q.f === 4) for (let i = 0; i < 14; i++) { const sx = R() * W, sw = 5 + R() * 6; x.fillStyle = '#c9a77a'; x.beginPath(); x.ellipse(sx, sol + 6 + R() * 20, sw, sw * 0.4, 0, 0, 7); x.fill(); x.fillStyle = '#7a5a3a'; x.fillRect(sx - sw, sol + 2 + R() * 20, sw * 2, 2); }
    // personnage de 1,80 m
    const px = W - 46, ph = 1.8 * ppm;
    x.fillStyle = '#c0392b'; x.fillRect(px - ph * 0.12, sol - ph * 0.82, ph * 0.24, ph * 0.42);
    x.fillStyle = '#2c3e50'; x.fillRect(px - ph * 0.1, sol - ph * 0.42, ph * 0.08, ph * 0.42); x.fillRect(px + ph * 0.02, sol - ph * 0.42, ph * 0.08, ph * 0.42);
    x.fillStyle = '#f1c40f'; x.beginPath(); x.arc(px, sol - ph * 0.9, ph * 0.1, 0, 7); x.fill();
    x.fillStyle = '#1b2631'; x.font = '600 11px "IBM Plex Sans", sans-serif'; x.textAlign = 'center'; x.fillText('1,80 m', px, sol + 14);
    // reponse : graduation et strates
    if (o.reponse) {
      x.strokeStyle = 'rgba(20,20,20,.75)'; x.fillStyle = '#111'; x.lineWidth = 1; x.textAlign = 'left'; x.font = '600 11px "IBM Plex Mono", monospace';
      const pas = haut > 14 ? 5 : haut > 6 ? 2 : 1;
      x.beginPath(); x.moveTo(12, sol); x.lineTo(12, Y(Math.floor(haut / pas) * pas)); x.stroke();
      for (let v = 0; v <= haut; v += pas) { x.beginPath(); x.moveTo(8, Y(v)); x.lineTo(16, Y(v)); x.stroke(); x.fillText(v + ' m', 19, Y(v) + 4); }
      const trait = (hm, txt, c) => { x.strokeStyle = c; x.setLineDash([6, 4]); x.lineWidth = 2; x.beginPath(); x.moveTo(60, Y(hm)); x.lineTo(W - 80, Y(hm)); x.stroke(); x.setLineDash([]); x.font = '700 12px "IBM Plex Sans", sans-serif'; x.lineWidth = 3; x.strokeStyle = 'rgba(255,255,255,.85)'; x.strokeText(txt, 64, Y(hm) - 5); x.fillStyle = c; x.fillText(txt, 64, Y(hm) - 5); };
      trait(q.sb[1], `sous-bois ≈ ${q.sb[1].toFixed(1)} m`, '#b45309');
      if (q.n) { trait(q.cbh, `base des houppiers ≈ ${Math.round(q.cbh)} m`, '#7c2d12'); trait(q.h, `hauteur dominante ≈ ${Math.round(q.h)} m (LiDAR)`, '#14532d'); }
    }
  };

  function pin(x, tx, sol, h, cbh, ppm, R, a, f) {
    const Y = v => sol - v * ppm, lean = (R() - 0.5) * 0.08 * h * ppm, tw = Math.max(1.5, (0.012 * h + 0.06) * ppm * 1.2);
    x.globalAlpha = a;
    if (h > 2.5) {
      // tronc ecorce rouge-brun, branches mortes sous le houppier
      x.strokeStyle = '#6b3f26'; x.lineWidth = tw; x.lineCap = 'round';
      x.beginPath(); x.moveTo(tx, sol); x.quadraticCurveTo(tx + lean * 0.3, Y(h * 0.5), tx + lean, Y(h * 0.92)); x.stroke();
      x.strokeStyle = '#4a2c1c'; x.lineWidth = 1;
      for (let v = 1; v < cbh; v += 0.9 + R()) { if (R() < 0.55) { const s = R() < 0.5 ? -1 : 1, l = (0.3 + R() * 0.6) * ppm; const bx = tx + lean * v / h; x.beginPath(); x.moveTo(bx, Y(v)); x.lineTo(bx + s * l, Y(v) - l * 0.25); x.stroke(); } }
    }
    // houppier : touffes d'aiguilles vert sombre (parasol pour les vieux pins, cone pour les jeunes)
    const cb = Math.max(cbh, 0), top = h, hc = Math.max(top - cb, 0.3);
    const large = (f === 9 ? 0.34 : f === 8 ? 0.28 : f === 7 ? 0.24 : 0.36) * h * ppm;
    const r0 = Math.min(18, Math.max(2.5, 0.05 * h * ppm));
    const n = Math.round(Math.max(6, (hc * ppm * large) / (r0 * r0) * 0.9));
    for (let k = 0; k < Math.min(n, 140); k++) {
      const v = cb + Math.pow(R(), f >= 8 ? 0.7 : 1.1) * hc, rel = (v - cb) / hc;
      const prof = f >= 8 && f !== 11 ? Math.sin(Math.PI * Math.min(1, 0.15 + rel * 0.95)) : (1 - rel * 0.9);
      const w = large * (0.2 + prof * 0.8), cx = tx + lean * v / h + (R() - 0.5) * w, cy = Y(v);
      const r = r0 * (0.6 + R() * 0.7), ombre = 1 - rel * 0.35;
      x.fillStyle = `rgb(${Math.round((28 + R() * 22) * ombre + 10)},${Math.round((58 + R() * 30) * ombre + 14)},${Math.round((34 + R() * 14) * ombre + 6)})`;
      x.beginPath(); x.ellipse(cx, cy, r * 1.35, r * 0.75, (R() - 0.5) * 0.7, 0, 7); x.fill();
    }
    x.globalAlpha = 1;
  }
  function chene(x, tx, sol, h, ppm, R, a) {
    const Y = v => sol - v * ppm;
    x.globalAlpha = a;
    x.strokeStyle = '#5d5a52'; x.lineWidth = Math.max(2, 0.025 * h * ppm); x.beginPath(); x.moveTo(tx, sol); x.lineTo(tx + (R() - 0.5) * 6, Y(h * 0.45)); x.stroke();
    for (let k = 0; k < 14; k++) { x.fillStyle = `rgb(${70 + R() * 30},${110 + R() * 30},${50 + R() * 20})`; x.beginPath(); x.arc(tx + (R() - 0.5) * h * ppm * 0.55, Y(h * (0.5 + R() * 0.45)), (0.1 + R() * 0.1) * h * ppm, 0, 7); x.fill(); }
    x.globalAlpha = 1;
  }
  function sousBois(x, q, R, W, sol, ppm, rg) {
    const [t, hh, rec] = q.sb, n = Math.round(W / 9 * rec);
    for (let i = 0; i < n; i++) {
      const sx = R() * W, h = hh * (0.5 + R() * 0.7) * ppm, sy = sol + R() * 8;
      if (t === 'fougere') { x.strokeStyle = `rgb(${80 + R() * 40},${140 + R() * 40},${50 + R() * 20})`; x.lineWidth = 1.5; for (let f = 0; f < 5; f++) { const ang = -Math.PI / 2 + (f - 2) * 0.35; x.beginPath(); x.moveTo(sx, sy); x.quadraticCurveTo(sx + Math.cos(ang) * h * 0.5, sy + Math.sin(ang) * h * 0.9, sx + Math.cos(ang) * h * 0.9, sy + Math.sin(ang) * h * 0.6); x.stroke(); } }
      else if (t === 'ajonc' || t === 'lande' || t === 'brande') {
        const brande = t === 'brande' || (t === 'lande' && R() < 0.4);
        const rr = Math.max(2, h * 0.22);
        for (let b = 0; b < 6; b++) {
          x.fillStyle = brande ? `rgb(${95 + R() * 35},${78 + R() * 22},${72 + R() * 25})` : `rgb(${38 + R() * 22},${78 + R() * 28},${34 + R() * 15})`;
          x.beginPath(); x.ellipse(sx + (R() - 0.5) * h * 0.7, sy - rr - R() * (h - rr * 1.5), rr * (0.8 + R() * 0.5), rr * (0.7 + R() * 0.4), 0, 0, 7); x.fill();
        }
        if (!brande && R() < 0.6) { x.fillStyle = '#e8c21a'; for (let d = 0; d < 6; d++) x.fillRect(sx + (R() - 0.5) * h * 0.7, sy - h * R(), 2, 2); }
        if (t === 'lande' && R() < 0.5) { x.strokeStyle = '#c9b77a'; x.lineWidth = 1; for (let d = 0; d < 7; d++) { x.beginPath(); x.moveTo(sx + 8, sy); x.lineTo(sx + 8 + (R() - 0.5) * 10, sy - h * 0.6); x.stroke(); } }
      }
      else if (t === 'taillis') { x.fillStyle = `rgb(${60 + R() * 30},${100 + R() * 30},${45 + R() * 20})`; x.beginPath(); x.arc(sx, sy - h * 0.6, h * 0.35, 0, 7); x.fill(); x.strokeStyle = '#5d5a52'; x.beginPath(); x.moveTo(sx, sy); x.lineTo(sx, sy - h * 0.4); x.stroke(); }
      else { x.strokeStyle = q.f === 1 ? '#d8c27a' : q.f === 13 ? '#8a9a5a' : '#a9b56a'; x.lineWidth = 1; for (let d = 0; d < 4; d++) { x.beginPath(); x.moveTo(sx, sy); x.lineTo(sx + (R() - 0.5) * 6, sy - h * (q.f === 13 ? 4 : 1)); x.stroke(); } }
    }
  }
  window.PEUPLEMENT = P;
})();
