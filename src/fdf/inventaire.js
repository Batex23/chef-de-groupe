// =============================================================================
// Elements inventes a chaque partie pour l'analyse de la ZI : points sensibles
// (maisons isolees, camping, rucher, ferme, centrale solaire, depot de bois),
// obstacles pour les avions (lignes HTA avec pylones, relais) et points d'eau
// complementaires. Places de facon plausible : en lisiere de piste, dans les
// clairieres, hors des bourgs. Ils s'ajoutent aux donnees reelles de la carte.
// =============================================================================
(function () {
  'use strict';
  const INV = {};
  const TYPES = [
    { k: 'maison', n: 'Maison isolée', nb: [2, 5], bati: [12, 9] },
    { k: 'camping', n: 'Camping', nb: [0, 1], bati: [30, 20], surface: 90 },
    { k: 'rucher', n: 'Rucher', nb: [1, 2] },
    { k: 'ferme', n: 'Ferme, bergerie', nb: [0, 2], bati: [25, 12] },
    { k: 'solaire', n: 'Centrale photovoltaïque', nb: [0, 1], surface: 140 },
    { k: 'depot', n: 'Dépôt de bois (débardage)', nb: [1, 2] },
    { k: 'chasse', n: 'Cabane de chasse', nb: [0, 2], bati: [6, 5] },
  ];

  function pisteProche(c, R, filtre) {
    const rs = c.routes.filter(filtre);
    const r = rs[Math.floor(R() * rs.length)], i = Math.floor(R() * (r.p.length - 1));
    const a = r.p[i], b = r.p[i + 1], t = R();
    const x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t, L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return { x, y, nx: -(b[1] - a[1]) / L, ny: (b[0] - a[0]) / L };
  }
  function loinDesBourgs(c, x, y) {
    for (const l of c.lieux) if (l.k === 'hameau' && Math.hypot(l.p[0] - x, l.p[1] - y) < 700) return false;
    return x > 400 && y > 400 && x < c.W - 400 && y < c.H - 400;
  }

  // genere et ajoute aux donnees de la carte ; renvoie la liste pour le debriefing
  INV.genere = function (c, R, niveau) {
    const out = { sensibles: [], lignes: [], pe: [] };
    const mult = niveau === 'expert' ? 1.4 : niveau === 'debutant' ? 0.7 : 1;
    for (const T of TYPES) {
      const n = Math.round((T.nb[0] + R() * (T.nb[1] - T.nb[0])) * mult);
      for (let k = 0; k < n; k++) {
        for (let essai = 0; essai < 60; essai++) {
          const q = pisteProche(c, R, r => r.k === 'chemin' || r.k === 'piste' || r.k === 'dfci');
          const d = 25 + R() * 40, x = q.x + q.nx * d, y = q.y + q.ny * d;
          if (!loinDesBourgs(c, x, y)) continue;
          const s = { n: T.n, k: T.k, p: [x, y], invente: true };
          out.sensibles.push(s); c.sensibles.push(s);
          if (T.bati) { const [w, h] = T.bati, a = Math.atan2(q.ny, q.nx); const co = Math.cos(a), si = Math.sin(a); const pts = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(([u, v]) => [x + u * co - v * si, y + u * si + v * co]); c.bati.push({ u: T.n, p: pts, invente: true }); }
          break;
        }
      }
    }
    // lieux-dits complementaires (toponymie landaise) dans les zones sans repere
    const NOMS = ['Lande de Peyrot', 'Le Tuc', 'Haut-Barrail', 'La Craste Neuve', 'Pinada de Lartigue', 'Les Arrouillats', 'Capbern', 'Lagunot', 'Hourcade', 'Le Pas de Lou Pin', 'Darrigade', 'La Lagune Ronde', 'Lande de Tastet', 'Le Sablot', 'Les Esteys', 'Bos de Mounet', 'Le Gourguet', 'La Pièce du Moulin', 'Lande du Broc', 'Cap de Lande', 'Le Lugan', 'Las Hountas', 'Pey de Hourc', 'La Cabanasse Vieille', 'Le Bernet', 'Lande de Pujeau', 'Les Tachoueres', 'Le Grand Bos', 'La Pinède de Bordessoules', 'Le Courneau'];
    const nld = niveau === 'debutant' ? 30 : 22;
    const pris = new Set(c.lieux.map(l => l.n));
    for (let k = 0, e = 0; k < nld && e < 3000; e++) {
      const x = 500 + R() * (c.W - 1000), y = 500 + R() * (c.H - 1000);
      if (c.lieux.some(l => Math.hypot(l.p[0] - x, l.p[1] - y) < 750)) continue;
      const n = NOMS.filter(m => !pris.has(m))[0]; if (!n) break;
      pris.add(n); c.lieux.push({ n, k: 'lieu-dit', p: [x, y], invente: true }); k++;
    }
    // ligne HTA inventee (obstacle pour les ABE) : 2 a 4 km, pylones tous les 200 m
    const nl = niveau === 'debutant' ? 1 : 1 + Math.floor(R() * 2);
    for (let k = 0; k < nl; k++) {
      const x0 = 1500 + R() * (c.W - 3000), y0 = 1500 + R() * (c.H - 3000), a = R() * Math.PI, L = 2000 + R() * 2000;
      const p = [[x0 - Math.cos(a) * L / 2, y0 - Math.sin(a) * L / 2], [x0 + Math.cos(a) * L / 2, y0 + Math.sin(a) * L / 2]];
      const pyl = []; for (let d = 0; d <= L; d += 200) pyl.push([p[0][0] + Math.cos(a) * d, p[0][1] + Math.sin(a) * d]);
      const ln = { v: 'HTA 20 kV', p, pylones: pyl, invente: true };
      out.lignes.push(ln); c.elec.push(ln);
    }
    // relais de telephonie (obstacle vertical)
    const q = pisteProche(c, R, r => r.k === 'dfci' || r.k === 'piste');
    const relais = { n: 'Relais radiotéléphonie (pylône 40 m)', k: 'relais', p: [q.x + q.nx * 20, q.y + q.ny * 20], invente: true, obstacle: true };
    out.sensibles.push(relais); c.sensibles.push(relais);
    // points d'eau complementaires (numerotes 200 et plus)
    const npe = niveau === 'expert' ? 1 + Math.floor(R() * 2) : 2 + Math.floor(R() * 3);
    for (let k = 0; k < npe; k++) {
      const q2 = pisteProche(c, R, r => r.k === 'dfci' || r.k === 'piste');
      const forme = ['rond', 'triangle', 'triangle', 'losange'][Math.floor(R() * 4)];
      const pe = { n: 200 + Math.floor(R() * 90), forme, p: [q2.x + q2.nx * 12, q2.y + q2.ny * 12], perenne: forme === 'triangle' ? R() > 0.35 : true, invente: true };
      pe.dfci = CARTE.dfci(pe.p[0], pe.p[1]);
      out.pe.push(pe); c.points_eau.push(pe);
    }
    return out;
  };

  // pictogrammes des points sensibles et pylones (cartoguide)
  INV.dessine = function (ctx, vue) {
    const c = CARTE.c, s = vue.s;
    for (const e of c.elec) if (e.pylones && s > 0.12) for (const p of e.pylones) { const x = vue.sx(p[0]), y = vue.sy(p[1]); ctx.strokeStyle = '#8a5cff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x - 4, y + 4); ctx.lineTo(x, y - 5); ctx.lineTo(x + 4, y + 4); ctx.moveTo(x - 3, y); ctx.lineTo(x + 3, y); ctx.stroke(); }
    if (s < 0.1) return;
    ctx.font = `600 ${Math.min(12, Math.max(9, s * 40))}px "IBM Plex Sans", sans-serif`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    for (const p of c.sensibles) {
      if (!p.invente) continue;
      const x = vue.sx(p.p[0]), y = vue.sy(p.p[1]);
      const g = { maison: '⌂', camping: '⛺', rucher: '✿', ferme: '⌂', solaire: '▦', depot: '≡', chasse: '⌂', relais: '⚲' }[p.k] || '•';
      ctx.fillStyle = '#3a2a1a'; ctx.font = `700 ${Math.min(16, Math.max(11, s * 50))}px sans-serif`; ctx.fillText(g, x - 5, y);
      if (s > 0.25 || p.k !== 'maison') { ctx.font = `600 ${Math.min(12, Math.max(9, s * 40))}px "IBM Plex Sans", sans-serif`; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.strokeText(p.n, x + 9, y); ctx.fillStyle = '#3a2a1a'; ctx.fillText(p.n, x + 9, y); }
    }
  };
  window.INV = INV;
})();
