// =============================================================================
// Regle feu de foret virtuelle (inspiree de la regle TANIT) posee sur la carte :
// 1/ coordonnees DFCI (sous-carres 1 a 5), 2/ rapporteur « vent du » et axe de
// propagation, 3/ cone de propagation, 4/ distances parcourues (vitesse x temps),
// 5/ grille de surface (carres de 1 ha). Deplacable (centre) et orientable (poignee).
// =============================================================================
(function () {
  'use strict';
  const RG = { on: false, x: 0, y: 0, az: 90, cone: 20, v: 700, durees: [15, 30, 60, 90, 120], grille: true, prise: null };
  const rad = d => d * Math.PI / 180;
  RG.pose = function (x, y, az, v) { RG.on = true; RG.x = x; RG.y = y; if (az != null) RG.az = az; if (v) RG.v = v; };
  // sous-carre DFCI (1 NO, 2 NE, 3 SE, 4 SO, 5 centre) comme sur la regle
  RG.sousCarre = function (x, y) {
    const c = CARTE.c, [ox, oy] = c.dfci.origine_l93, p = c.dfci.pas;
    const X = c.lambert93[0] + x - ox, Y = c.lambert93[1] + y - oy;
    const u = (X % p) / p, v = (Y % p) / p;
    if (Math.abs(u - 0.5) < 0.25 && Math.abs(v - 0.5) < 0.25) return 5;
    return v >= 0.5 ? (u < 0.5 ? 1 : 2) : (u < 0.5 ? 4 : 3);
  };
  RG.coord = function (x, y) { return CARTE.dfci(x, y) + ' ' + RG.sousCarre(x, y); };

  RG.dessine = function (ctx, vue) {
    if (!RG.on) return;
    const s = vue.s, cx = vue.sx(RG.x), cy = vue.sy(RG.y), a = rad(RG.az);
    const ux = Math.sin(a), uy = -Math.cos(a);            // axe de propagation a l'ecran
    const Lmax = RG.v * RG.durees[RG.durees.length - 1] / 60;
    ctx.save();
    // 3/ cone de propagation
    ctx.fillStyle = 'rgba(226,32,42,.08)'; ctx.strokeStyle = 'rgba(226,32,42,.7)'; ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]);
    ctx.beginPath(); ctx.moveTo(cx, cy);
    for (const k of [-1, 1]) { const b = a + k * rad(RG.cone); ctx.lineTo(cx + Math.sin(b) * Lmax * s, cy - Math.cos(b) * Lmax * s); }
    ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
    // 4/ regle graduee sur l'axe + distances parcourues
    ctx.strokeStyle = '#111'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + ux * Lmax * s, cy + uy * Lmax * s); ctx.stroke();
    ctx.font = '600 10px "IBM Plex Mono", monospace'; ctx.fillStyle = '#111'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const pas = s > 0.3 ? 100 : 500;
    for (let d = pas; d <= Lmax; d += pas) {
      const px = cx + ux * d * s, py = cy + uy * d * s, k = d % 500 === 0 ? 7 : 4;
      ctx.beginPath(); ctx.moveTo(px - uy * k, py + ux * k); ctx.lineTo(px + uy * k, py - ux * k); ctx.stroke();
      if (d % 500 === 0) { ctx.lineWidth = 3; ctx.strokeStyle = '#fff'; ctx.strokeText(d, px - uy * 16, py + ux * 16); ctx.fillText(d, px - uy * 16, py + ux * 16); ctx.strokeStyle = '#111'; ctx.lineWidth = 2; }
    }
    for (const t of RG.durees) {
      const d = RG.v * t / 60, px = cx + ux * d * s, py = cy + uy * d * s;
      const lat = Math.tan(rad(RG.cone)) * d * s;
      ctx.strokeStyle = 'rgba(226,32,42,.9)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(px - uy * lat, py + ux * lat); ctx.lineTo(px + uy * lat, py - ux * lat); ctx.stroke();
      ctx.fillStyle = '#b91c1c'; ctx.lineWidth = 3; ctx.strokeStyle = '#fff'; const tx = px + uy * (lat + 22), ty = py - ux * (lat + 22);
      ctx.strokeText(`${t} min`, tx, ty); ctx.fillText(`${t} min`, tx, ty);
    }
    // 5/ grille de surface : 10 x 10 carres de 1 ha (100 ha) dans l'axe
    if (RG.grille && s > 0.08) {
      ctx.strokeStyle = 'rgba(17,17,17,.35)'; ctx.lineWidth = 1;
      const g = 100 * s, n = 10, ox = cx - uy * n * g / 2, oy = cy + ux * n * g / 2;
      for (let i = 0; i <= n; i++) {
        ctx.beginPath(); ctx.moveTo(ox + uy * i * g, oy - ux * i * g); ctx.lineTo(ox + uy * i * g + ux * n * g, oy - ux * i * g + uy * n * g); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(ox + ux * i * g, oy + uy * i * g); ctx.lineTo(ox + ux * i * g + uy * n * g, oy + uy * i * g - ux * n * g); ctx.stroke();
      }
    }
    // 2/ rapporteur
    const R = 70;
    ctx.fillStyle = 'rgba(255,255,255,.82)'; ctx.strokeStyle = '#111'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
    for (let d = 0; d < 360; d += 10) { const b = rad(d), k = d % 90 === 0 ? 12 : d % 30 === 0 ? 8 : 4; ctx.beginPath(); ctx.moveTo(cx + Math.sin(b) * R, cy - Math.cos(b) * R); ctx.lineTo(cx + Math.sin(b) * (R - k), cy - Math.cos(b) * (R - k)); ctx.stroke(); }
    ctx.fillStyle = '#111'; ctx.font = '700 12px "IBM Plex Sans"';
    [['N', 0], ['E', 90], ['S', 180], ['O', 270]].forEach(([t, d]) => ctx.fillText(t, cx + Math.sin(rad(d)) * (R - 22), cy - Math.cos(rad(d)) * (R - 22)));
    // fleche « propagation du feu » et « vent du »
    const fl = (ang, col, txt, out) => {
      const b = rad(ang), ex = cx + Math.sin(b) * (R + (out ? 26 : -8)), ey = cy - Math.cos(b) * (R + (out ? 26 : -8));
      ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.beginPath(); ctx.arc(ex, ey, 6, 0, 2 * Math.PI); ctx.fill();
      ctx.font = '700 10px "IBM Plex Sans"'; ctx.lineWidth = 3; ctx.strokeStyle = '#fff'; const tx = cx + Math.sin(b) * (R + 46), ty = cy - Math.cos(b) * (R + 46);
      ctx.strokeText(txt, tx, ty); ctx.fillText(txt, tx, ty);
    };
    fl(RG.az + 180, '#475569', `VENT DU ${Math.round((RG.az + 180) % 360)}°`, false);
    fl(RG.az, '#e2202a', `PROPAGATION ${Math.round(RG.az)}°`, true);
    // 1/ coordonnees du centre
    ctx.font = '700 12px "IBM Plex Mono"'; ctx.fillStyle = '#5b21b6'; ctx.lineWidth = 3; ctx.strokeStyle = '#fff';
    const lab = RG.coord(RG.x, RG.y); ctx.strokeText(lab, cx, cy + R + 14); ctx.fillText(lab, cx, cy + R + 14);
    ctx.restore();
    RG.poignee = [cx + ux * (R + 26), cy + uy * (R + 26)]; RG.centreEcran = [cx, cy];
  };
  // interactions : prendre le centre (deplacer) ou la poignee rouge (orienter)
  RG.down = function (px, py) {
    if (!RG.on) return false;
    if (RG.poignee && Math.hypot(px - RG.poignee[0], py - RG.poignee[1]) < 14) { RG.prise = 'orient'; return true; }
    if (RG.centreEcran && Math.hypot(px - RG.centreEcran[0], py - RG.centreEcran[1]) < 60) { RG.prise = 'centre'; return true; }
    return false;
  };
  RG.move = function (px, py, vue) {
    if (RG.prise === 'centre') { RG.x = vue.mx(px); RG.y = vue.my(py); return true; }
    if (RG.prise === 'orient') { RG.az = Math.round((Math.atan2(px - RG.centreEcran[0], -(py - RG.centreEcran[1])) * 180 / Math.PI + 360) % 360); return true; }
    return false;
  };
  RG.up = function () { const p = RG.prise; RG.prise = null; return !!p; };
  // tableau des distances parcourues (comme sur la regle)
  RG.tableau = function () {
    const V = [300, 500, 700, 1000, 1400, 2100], T = [15, 30, 60, 90, 120];
    return `<table><tr><th>m/h</th>${T.map(t => `<th>${t} min</th>`).join('')}</tr>${V.map(v => `<tr><td>${v}</td>${T.map(t => `<td>${Math.round(v * t / 60)}</td>`).join('')}</tr>`).join('')}</table>`;
  };
  window.REGLE = RG;
})();
