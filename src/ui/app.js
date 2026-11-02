// ===========================================================================
// APPLICATION : accueil, HUD, menus contextuels, temoins, messages, SITAC
// ===========================================================================
(function () {
'use strict';
const { layerRel, conditionsAt, roomOnFire, clamp } = SIM;
const GM = window.GAME;
const $ = s => document.querySelector(s);
const CSSV = {};
const css = n => CSSV[n] || (CSSV[n] = getComputedStyle(document.documentElement).getPropertyValue(n).trim());
const UI = window.UI = {};
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const WINDOWS_R3 = [
  { id: 'W_SEJ1', x1: 1.0, x2: 2.4 }, { id: 'W_SEJ2', x1: 3.4, x2: 4.8 }, { id: 'W_CUI', x1: 6.4, x2: 7.6 }, { id: 'W_CH1', x1: 9.0, x2: 10.2 }];
const PW = 760, PH = 420;
let pctx;
let mode = 'home';

// ---------------------------------------------------------------- PLAN / SITAC
const PS = 36, PX0 = 150, PY0 = 360; // x=-3.5 -> 24 ; y=-2 -> 432 => origine
const px = x => PX0 + x * PS, py = y => PY0 - y * PS;
const ROOM_RECT = {
  SEJ: [0.2, 5.6, 0.2, 4.6], CUI: [5.8, 8.2, 0.2, 4.6], CH1: [8.4, 10.8, 0.2, 4.6], COU: [0.2, 10.8, 4.8, 5.8],
  CH2: [0.2, 3.8, 6.0, 8.4], SDB: [4.0, 6.0, 6.0, 8.4], CH3: [6.2, 10.8, 6.0, 8.4],
};
const NODE_XY = {
  RUE: [5.5, -1.3], COU: [2.2, 5.3], SEJ: [2.9, 2.6], CUI: [7.0, 2.6], CH1: [9.6, 2.6], CH2: [2.0, 7.2], SDB: [5.0, 7.2], CH3: [8.5, 7.2],
  CAGE_R3: [-1.5, 5.6],
};
function nodeXY(loc) {
  if (NODE_XY[loc]) return NODE_XY[loc];
  return null;
}
function drawPlan(now, ctxArg) {
  const ctx = ctxArg || pctx;
  const view = (document.getElementById('st-view') || {}).value || 'both';
  const K = view === 'user' ? { facts: { layout: true }, rooms: {}, cage: {} } : G.K;
  ctx.clearRect(0, 0, PW, PH);
  ctx.fillStyle = css('--board'); ctx.fillRect(0, 0, PW, PH);
  // trame de fond
  ctx.strokeStyle = css('--grid'); ctx.lineWidth = 1;
  for (let x = -4; x <= 12; x++) { ctx.beginPath(); ctx.moveTo(px(x), py(-2.4)); ctx.lineTo(px(x), py(9.4)); ctx.stroke(); }
  for (let y = -2; y <= 9; y++) { ctx.beginPath(); ctx.moveTo(px(-4), py(y)); ctx.lineTo(px(12), py(y)); ctx.stroke(); }
  // rue
  ctx.fillStyle = css('--street'); ctx.fillRect(px(-4), py(-0.1), px(12) - px(-4), py(-2.4) - py(-0.1));
  ctx.fillStyle = css('--mute'); ctx.font = `600 11px ${css('--f-mono')}`; ctx.fillText('RUE DES GLYCINES', px(7.2), py(-1.9));
  // emprise de l'appartement
  ctx.strokeStyle = css('--ink'); ctx.lineWidth = 3; ctx.strokeRect(px(0), py(8.6), 11 * PS, 8.6 * PS);
  // pieces
  for (const r of GM.ROOMS) {
    const [x1, x2, y1, y2] = ROOM_RECT[r];
    const X = px(x1), Y = py(y2), Wd = (x2 - x1) * PS, Ht = (y2 - y1) * PS;
    const s = K.rooms[r];
    if (!K.facts.layout && !s) continue;
    if (!s) {
      ctx.fillStyle = css('--unknown'); ctx.fillRect(X, Y, Wd, Ht);
      hatch(ctx, X, Y, Wd, Ht);
    } else {
      const age = G.W.t - s.t;
      const base = s.onFire ? css('--inc') : s.sev >= 2 ? css('--risk') : s.sev >= 1 ? css('--smoke') : css('--clear');
      ctx.globalAlpha = clamp(0.85 - age / 900, 0.35, 0.85);
      ctx.fillStyle = base; ctx.fillRect(X, Y, Wd, Ht);
      ctx.globalAlpha = 1;
    }
    ctx.strokeStyle = css('--wallplan'); ctx.lineWidth = 2; ctx.strokeRect(X, Y, Wd, Ht);
    // texte
    ctx.fillStyle = css('--ink'); ctx.font = `600 12px ${css('--f-body')}`;
    const label = K.facts.layout || s ? GM.ROOM_NAMES[r] : '';
    if (r === 'COU') ctx.fillText(label, X + 6, Y + 15);
    else ctx.fillText(label, X + 6, Y + 16);
    if (s) {
      ctx.font = `500 10px ${css('--f-mono')}`; ctx.fillStyle = css('--ink-soft');
      const age = Math.round((G.W.t - s.t) / 60);
      const lines = r === 'COU' ? [`${GM.hhmm(s.t)} · ${s.smoke}`] : [GM.hhmm(s.t) + (age >= 1 ? ` (il y a ${age} min)` : ''), s.fire || s.smoke, s.heat];
      lines.forEach((l, i) => wrapText(ctx, l, X + 6, Y + (r === 'COU' ? 28 : 31) + i * 12, Wd - 10));
    }
  }
  if (!K.facts.layout && !GM.ROOMS.some(r => K.rooms[r])) {
    hatch(ctx, px(0), py(8.6), 11 * PS, 8.6 * PS);
    ctx.fillStyle = css('--ink-soft'); ctx.font = `600 13px ${css('--f-body')}`;
    ctx.fillText('Appartement non reconnu', px(3.6), py(4.6)); ctx.font = `500 11px ${css('--f-body')}`;
    ctx.fillText('Interrogez la requérante ou engagez une reconnaissance.', px(1.6), py(4.0));
  }
  // facade : fenetres
  for (const w of WINDOWS_R3) { ctx.fillStyle = G.W.O.find(o => o.id === w.id).open ? css('--inc') : css('--eau'); ctx.fillRect(px(w.x1), py(0.2), (w.x2 - w.x1) * PS, 0.2 * PS); }
  // porte paliere (connue ?)
  const pal = GM.isOpen('PALIERE');
  ctx.fillStyle = K.facts.porte_ouverte || G.actors.some(a => a.loc === 'CAGE_R3' || a.loc === 'COU') ? (pal ? css('--inc') : css('--pers')) : css('--mute');
  ctx.fillRect(px(-0.05), py(5.8), 0.3 * PS, 0.8 * PS);
  // cage / palier
  ctx.strokeStyle = css('--chem'); ctx.lineWidth = 2; ctx.setLineDash([5, 4]); ctx.strokeRect(px(-3), py(8.6), 3 * PS, 3.6 * PS); ctx.setLineDash([]);
  ctx.fillStyle = css('--chem'); ctx.font = `600 11px ${css('--f-body')}`; ctx.fillText('Palier R+3', px(-2.8), py(8.2));
  // victimes connues
  const v1 = G.victims[0];
  if (!v1.atRue && !v1.carried && (v1.found || K.facts.victime_lieu)) {
    const [x, y] = v1.found ? [9.9, 1.4] : [9.6, 1.6];
    victimIcon(ctx, px(x), py(y), v1.found ? 'solid' : 'dashed');
  }
  // binomes
  const placed = {};
  for (const a of G.actors) {
    if (a.kind !== 'binome' || a.loc === 'ABSENT') continue;
    let xy = nodeXY(a.loc);
    if (!xy && a.loc.startsWith('CAGE_')) continue;
    if (!xy) continue;
    const k = placed[a.loc] = (placed[a.loc] || 0) + 1;
    const X = px(xy[0]) + (k - 1) * 30 + (a.loc === 'RUE' ? (G.actors.indexOf(a) * 32 - 40) : 0), Y = py(xy[1]) + (a.loc === 'RUE' ? 0 : 14);
    unitIcon(ctx, X, Y, a, now);
  }
  // colonne de la cage (tous niveaux)
  const CX = 616, CW = 130;
  ctx.fillStyle = css('--panel2'); ctx.fillRect(CX - 8, 22, CW + 16, 300);
  ctx.fillStyle = css('--mute'); ctx.font = `700 11px ${css('--f-mono')}`; ctx.fillText('CAGE D\'ESCALIER', CX, 38);
  GM.LEVELS.slice().reverse().forEach((lv, j) => {
    const y = 50 + j * 52, info = K.cage[lv];
    ctx.fillStyle = info ? (info.vis < 2 ? css('--smoke') : info.vis < 8 ? css('--smoke-l') : css('--clear')) : css('--unknown');
    ctx.fillRect(CX, y, CW, 44);
    if (!info) hatch(ctx, CX, y, CW, 44);
    ctx.fillStyle = css('--ink'); ctx.font = `700 11px ${css('--f-mono')}`; ctx.fillText(GM.LEVEL_NAMES[lv], CX + 6, y + 14);
    ctx.font = `500 10px ${css('--f-mono')}`; ctx.fillStyle = css('--ink-soft');
    if (info) ctx.fillText(`${GM.hhmm(info.t)} · vis. ${info.vis < 1 ? '<1' : Math.round(info.vis)} m`, CX + 6, y + 27);
    let k = 0;
    for (const a of G.actors) if (a.loc === 'CAGE_' + lv || (lv === 'R4' && (a.loc === 'R4_APT' || a.loc === 'TOIT'))) { unitIcon(ctx, CX + 92 + k * 0, y + 22 + k * 0, a, now, true); k++; }
    const v2 = G.victims[1];
    if (v2.found && !v2.atRue && v2.loc === 'CAGE_' + lv) victimIcon(ctx, CX + 70, y + 26, 'solid');
    if (lv === 'R4' && (G.K.facts.voisin_r4) && (v2.mode === 'fenetre' || v2.mode === 'confine')) { ctx.fillStyle = css('--pers'); ctx.font = `600 10px ${css('--f-body')}`; ctx.fillText(v2.mode === 'confine' ? 'Voisin confiné' : 'Voisin à la fenêtre', CX + 6, y + 39); }
  });
  // legende
  const lg = [['--inc', 'Feu'], ['--risk', 'Chaleur'], ['--smoke', 'Fumées'], ['--clear', 'Reconnu, sain'], ['--unknown', 'Non reconnu']];
  lg.forEach(([c, t], i) => { const y = 340 + i * 15; ctx.fillStyle = css(c); ctx.fillRect(CX, y - 9, 12, 10); ctx.fillStyle = css('--ink-soft'); ctx.font = `500 11px ${css('--f-body')}`; ctx.fillText(t, CX + 18, y); });
  if (view !== 'info') { for (const e of G.sitacUser) drawSym(ctx, e); if (drag && ctx === bigCtx) drawSym(ctx, drag); }
}
// ---------------------------------------------------------------- symboles conventionnels de la SITAC
const SYM_COL = { feu: '--inc', attaque: '--inc', victime: '--pers', sauvetage: '--pers', danger: '--risk', reco: '--cmd', eau: '--eau', fumee: '--smoke-l', moyen: '--cmd' };
function arrow(ctx, x1, y1, x2, y2, col, w, dash) {
  ctx.save(); ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = w; ctx.lineCap = 'round';
  if (dash) ctx.setLineDash([7, 6]);
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.setLineDash([]);
  const a = Math.atan2(y2 - y1, x2 - x1), h = 7 + w * 1.6;
  ctx.beginPath(); ctx.moveTo(x2, y2); ctx.lineTo(x2 - h * Math.cos(a - 0.45), y2 - h * Math.sin(a - 0.45)); ctx.lineTo(x2 - h * Math.cos(a + 0.45), y2 - h * Math.sin(a + 0.45)); ctx.closePath(); ctx.fill();
  ctx.restore();
}
function drawSym(ctx, e) {
  const X = px(e.x), Y = py(e.y), col = css(SYM_COL[e.k] || '--cmd');
  ctx.save();
  if (e.k === 'feu') {
    ctx.fillStyle = col; ctx.globalAlpha = 0.9; ctx.beginPath();
    ctx.moveTo(X, Y - 16); ctx.quadraticCurveTo(X + 13, Y - 2, X + 8, Y + 9); ctx.quadraticCurveTo(X, Y + 13, X - 8, Y + 9); ctx.quadraticCurveTo(X - 13, Y - 2, X, Y - 16); ctx.fill();
    ctx.fillStyle = '#ffd36b'; ctx.beginPath(); ctx.arc(X, Y + 4, 4, 0, 7); ctx.fill();
  } else if (e.k === 'fumee') {
    ctx.fillStyle = col; ctx.globalAlpha = 0.85; for (const [dx, dy, r] of [[-8, 2, 7], [0, -4, 9], [9, 2, 7], [0, 5, 7]]) { ctx.beginPath(); ctx.arc(X + dx, Y + dy, r, 0, 7); ctx.fill(); }
  } else if (e.k === 'victime') {
    ctx.fillStyle = col; ctx.strokeStyle = '#0d141c'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(X, Y - 11); ctx.lineTo(X + 10, Y + 7); ctx.lineTo(X - 10, Y + 7); ctx.closePath(); ctx.fill(); ctx.stroke();
  } else if (e.k === 'danger') {
    ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(X, Y - 12); ctx.lineTo(X + 11, Y + 8); ctx.lineTo(X - 11, Y + 8); ctx.closePath(); ctx.stroke();
    ctx.fillStyle = col; ctx.font = `700 12px ${css('--f-mono')}`; ctx.textAlign = 'center'; ctx.fillText('!', X, Y + 5);
  } else if (e.k === 'moyen') {
    const t = e.label || 'FPT', w = Math.max(30, t.length * 7 + 10);
    const c = /VSAV/.test(t) ? css('--pers') : /VLCG|CDC/.test(t) ? css('--cmd') : css('--inc');
    ctx.fillStyle = 'rgba(13,20,28,0.85)'; ctx.fillRect(X - w / 2, Y - 9, w, 18); ctx.strokeStyle = c; ctx.lineWidth = 2.5; ctx.strokeRect(X - w / 2, Y - 9, w, 18);
    ctx.fillStyle = '#fff'; ctx.font = `700 10px ${css('--f-mono')}`; ctx.textAlign = 'center'; ctx.fillText(t, X, Y + 4);
  } else if (e.x2 != null) {
    const dash = e.k === 'reco', w = e.k === 'eau' ? 2.5 : 4;
    arrow(ctx, X, Y, px(e.x2), py(e.y2), col, w, dash);
  }
  ctx.restore();
}
let tool = null, drag = null;
function planFromEvent(ev) {
  const c = $('#bigplan'), r = c.getBoundingClientRect();
  const lx = (ev.clientX - r.left) * PW / r.width, ly = (ev.clientY - r.top) * PH / r.height;
  return { x: (lx - PX0) / PS, y: (PY0 - ly) / PS };
}
const DRAG_TOOLS = ['attaque', 'sauvetage', 'reco', 'eau'];
function hatch(ctx, x, y, w, h) {
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.strokeStyle = css('--hatch'); ctx.lineWidth = 1;
  for (let i = -h; i < w; i += 9) { ctx.beginPath(); ctx.moveTo(x + i, y + h); ctx.lineTo(x + i + h, y); ctx.stroke(); }
  ctx.restore();
}
function wrapText(ctx, t, x, y, w) {
  if (!t) return;
  let s = t; while (ctx.measureText(s).width > w && s.length > 4) s = s.slice(0, -2);
  ctx.fillText(s === t ? s : s.slice(0, -1) + '…', x, y);
}
function victimIcon(ctx, x, y, style) {
  ctx.strokeStyle = css('--pers'); ctx.fillStyle = style === 'solid' ? css('--pers') : 'transparent'; ctx.lineWidth = 2;
  if (style !== 'solid') ctx.setLineDash([3, 3]);
  ctx.beginPath(); ctx.moveTo(x, y - 10); ctx.lineTo(x + 10, y + 7); ctx.lineTo(x - 10, y + 7); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.setLineDash([]);
}
function unitIcon(ctx, x, y, a, now, small) {
  const r = small ? 9 : 11;
  ctx.fillStyle = a.hurt ? css('--inc') : (S3.TEAM_COLORS[a.id] || css('--cmd'));
  ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
  if (a.flowing) { ctx.strokeStyle = css('--eau'); ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, r + 3 + Math.sin(now / 120) * 1.5, 0, 7); ctx.stroke(); }
  ctx.fillStyle = '#0d141c'; ctx.font = `700 ${small ? 8 : 9}px ${css('--f-mono')}`; ctx.textAlign = 'center';
  ctx.fillText(a.id.replace(/\d/, ''), x, y + 3); ctx.textAlign = 'left';
}



// ---------------------------------------------------------------- HUD
function renderHUD() {
  const W = G.W;
  document.documentElement.style.setProperty('--hudh', $('.hud').offsetHeight + 'px');
  $('#clock').textContent = GM.clock(W.t);
  const since = W.t - GM.T_ARRIVEE, ch = $('#chrono');
  if (G.ambiance) { ch.textContent = `Ambiance transmise à +${GM.fmtDur(G.ambiance.t - GM.T_ARRIVEE)}`; ch.className = 'chrono done'; }
  else { const r = 300 - since; ch.textContent = r >= 0 ? `Message d'ambiance : ${Math.floor(r / 60)}:${String(Math.floor(r % 60)).padStart(2, '0')}` : `Ambiance en retard : +${Math.floor(-r / 60)}:${String(Math.floor(-r % 60)).padStart(2, '0')}`; ch.className = 'chrono ' + (r < 0 ? 'late' : r < 60 ? 'soon' : ''); }
  const PHASES = [['arrivee', 'Arrivée · RI'], ['rt', 'Raisonnement tactique'], ['conduite', 'Conduite']];
  $('#phase').innerHTML = PHASES.map(([k, l]) => `<span class="phz ${k === G.phase ? 'on' : ''}">${l}</span>`).join('');
  $('#btn-oi').textContent = G.oi ? 'Ordre initial donné' : 'Raisonnement tactique';
  // situation du feu
  const cur = G.fire.cur;
  $('#firestate').innerHTML = GM.FIRE_STATES.map(([k, l]) => `<span class="fs ${k === cur ? 'on ' + k : ''}">${l}</span>`).join('');
  // occupation du CDG
  const b = G.busy, bz = $('#busy');
  if (b) { bz.hidden = false; const k = clamp((W.t - b.start) / (b.until - b.start), 0, 1); bz.querySelector('span').textContent = b.label + '…'; bz.querySelector('i').style.width = (k * 100) + '%'; }
  else bz.hidden = true;
  // jauges
  const g = GM.gauges();
  const items = [['victimes', 'Victimes', '--pers'], ['securite', 'Sécurité', '--risk'], ['commandement', 'Commandement', '--cmd'], ['connaissance', 'Connaissance', '--eau']];
  $('#gauges').innerHTML = items.map(([k, l, c]) => `<div class="gauge"><div class="gl"><span>${l}</span><b>${Math.round(g[k])}</b></div><div class="gt"><i style="width:${g[k]}%;background:var(${c})"></i></div></div>`).join('');
  const tank = $('#tankhud'); tank.textContent = G.alim ? 'FPT 1 alimenté sur PI' : `Citerne FPT 1 : ${Math.round(G.tank)} L`; tank.className = 'tank ' + (G.alim ? 'ok' : G.tank < 800 ? 'low' : '');
}

// ---------------------------------------------------------------- MENU CONTEXTUEL
let menu = null; // {pick}
const TEAM_NAME = { BAT: 'Binôme d\'attaque', BAL: 'Binôme d\'alimentation' };
function actorsFor(pick) {
  if (pick.type === 'team') return G.actors.filter(a => a.id === pick.id);
  if (pick.id === 'FPT1') return G.actors.filter(a => a.engin === 'FPT 1');
  if (pick.id === 'FPT2') return G.actors.filter(a => a.engin === 'FPT 2');
  return G.actors.filter(a => a.id === pick.id);
}
function openMenu(pick, x, y) {
  menu = { pick };
  const m = $('#ctx');
  renderMenu();
  m.hidden = false;
  const r = m.getBoundingClientRect();
  m.style.left = Math.max(8, Math.min(x + 14, innerWidth - r.width - 8)) + 'px';
  m.style.top = Math.max(60, Math.min(y - 20, innerHeight - r.height - 8)) + 'px';
}
function closeMenu() { menu = null; $('#ctx').hidden = true; }
function renderMenu() {
  if (!menu) return;
  const p = menu.pick, m = $('#ctx');
  if (p.type === 'engin' && p.id === 'VLCG') {
    m.innerHTML = `<div class="mh"><b>VLCG</b><span>Votre véhicule de commandement</span><button class="x" data-close aria-label="Fermer">×</button></div>
      <div class="msec"><button class="mb" data-go="msg">Rédiger un message (ambiance / compte rendu)</button><button class="mb" data-go="sitac">Ouvrir la SITAC</button><button class="mb" data-go="radio">Tableau des messages</button></div>`;
    return;
  }
  const list = actorsFor(p);
  if (!list.length) { closeMenu(); return; }
  const engin = list[0].engin;
  const html = [`<div class="mh"><b>${esc(p.type === 'team' ? list[0].label : engin)}</b><span>${p.type === 'team' ? esc(engin) + ' — ordre via le chef d\'agrès' : list[0].kind === 'binome' ? 'Ordres via le chef d\'agrès' : 'Chef d\'agrès'}</span><button class="x" data-close aria-label="Fermer">×</button></div>`];
  if (list[0].kind === 'binome') html.push(`<div class="mwater">${G.alim ? '<span class="pill ok">Alimenté sur PI</span>' : `<span class="pill ${G.tank < 800 ? 'bad' : 'warn'}">Citerne ${Math.round(G.tank)} L — non alimenté</span>`}</div>`);
  for (const a of list) {
    const col = S3.TEAM_COLORS[a.id] || 'var(--cmd)';
    html.push(`<div class="msec" style="--tc:${col}">`);
    if (a.kind === 'binome') html.push(`<div class="mt"><span class="tag">${a.id.replace(/\d/, '')}</span><b>${TEAM_NAME[a.role]}</b></div>`);
    html.push(`<div class="mst" id="mst-${a.id}"></div>`);
    if (a.loc === 'ABSENT') html.push('<p class="hint">En route.</p>');
    else if (a.carry) html.push('<p class="hint">Extraction d\'une victime en cours.</p>');
    else {
      for (const k of GM.availableMissions(a)) {
        const lab = GM.MISSIONS[k].label;
        if (k === 'ATTAQUE') html.push(`<div class="mrow"><button class="mb" data-a="${a.id}" data-k="${k}">${lab}</button><select id="lance-${a.id}" aria-label="Lance"><option>LDV 500</option><option>LDV 250</option></select></div>`);
        else if (k === 'RECHERCHE' && G.K.facts.victime_lieu) html.push(`<div class="mrow"><button class="mb" data-a="${a.id}" data-k="${k}">${lab}</button><select id="prio-${a.id}" aria-label="Priorité"><option value="">Sans priorité</option><option value="CH1" selected>Priorité : chambre au fond à droite</option></select></div>`);
        else html.push(`<div class="mrow"><button class="mb" data-a="${a.id}" data-k="${k}">${lab}</button></div>`);
      }
    }
    html.push('</div>');
  }
  m.innerHTML = html.join('');
  updateMenuStatus();
}
function updateMenuStatus() {
  if (!menu) return;
  for (const a of G.actors) {
    const el = document.getElementById('mst-' + a.id); if (!el) continue;
    let s = a.status;
    if (a.kind === 'binome') s += ` · ${GM.locName(a.loc)} · ARI ${Math.max(0, Math.round(a.air / 60))} min${a.flowing ? ' · lance en eau' : ''}${a.hurt ? ' · BLESSÉ' : ''}`;
    el.textContent = s;
  }
}

// ---------------------------------------------------------------- TEMOINS
let dialogW = null;
function openDialog(id) { dialogW = id; renderDialog(); $('#dialog').hidden = false; closeMenu(); }
function renderDialog() {
  if (!dialogW) return;
  const d = GM.witnessDef(dialogW);
  const done = d.questions.filter(q => G.asked[q.id]);
  const avail = GM.availableQuestions(dialogW);
  const busy = !!G.busy;
  $('#dialog').innerHTML = `<div class="dh"><b>${esc(d.name)}</b><button class="x" data-dclose aria-label="Fermer">×</button></div>
    <div class="dlog">${done.map(q => `<div class="qa"><div class="qq">${esc(q.q)}</div><div class="qr">« ${esc(q.a)} »</div></div>`).join('') || `<p class="hint">${esc(d.hello)}</p>`}
    ${busy && G.busy.q && d.questions.some(q => q.q === G.busy.q) ? `<div class="qa"><div class="qq">${esc(G.busy.q)}</div><div class="qr typing">…</div></div>` : ''}</div>
    <div class="dq">${avail.map(q => `<button class="qb" data-q="${q.id}" ${busy ? 'disabled' : ''}>${esc(q.q)}</button>`).join('') || '<p class="hint">Plus rien à demander pour l\'instant.</p>'}</div>`;
}

// ---------------------------------------------------------------- MESSAGES / CORRECTION
function renderMsgState() {
  const amb = G.ambiance;
  $('#amb-state').innerHTML = amb ? `<span class="pill ok">Transmis à ${GM.hhmm(amb.t)}</span> <button class="lnk" data-corr="amb">Voir la correction</button>` : '<span class="pill warn">À transmettre</span>';
  $('#form-amb').hidden = !!amb;
  $('#form-cr').hidden = !amb;
  $('#cr-state').innerHTML = G.crs.length ? `${G.crs.length} compte(s) rendu(s), dernier à ${GM.hhmm(G.crs[G.crs.length - 1].t)} <button class="lnk" data-corr="cr">Voir la correction</button>` : 'Aucun compte rendu transmis';
}
function showCorrection(c) {
  if (!c) return;
  if (c.type === 'oi') return showOICorrection(c);
  const rows = c.type === 'ambiance' ? [['JE SUIS', 'suis'], ['JE VOIS', 'vois'], ['JE PRÉVOIS', 'prevois'], ['JE FAIS', 'fais'], ['JE DEMANDE', 'demande']] : [['JE SUIS', 'suis'], ['JE VOIS', 'vois'], ['VICTIMES', 'victimes'], ['JE FAIS', 'fais'], ['JE DEMANDE', 'demande']];
  const score = c.ev.pts;
  $('#corr-body').innerHTML = `
    <p class="lead">${c.type === 'ambiance' ? 'Message d\'ambiance' : 'Compte rendu n°' + c.n} transmis à ${GM.hhmm(c.t)}. Réussite : <b>${Math.round(score)} %</b></p>
    <ul class="pts">${c.ev.out.map(o => `<li class="${o.ok ? 'ok' : 'ko'}">${esc(o.text)}</li>`).join('')}</ul>
    <div class="cmp"><div class="cmph"><span>Votre message</span><span>Message type (situation réelle à ${GM.hhmm(c.t)})</span></div>
    ${rows.map(([l, k]) => `<div class="cmpr"><b>${l}</b><div>${esc(c.f[k] || '—')}</div><div>${c.model[k] || '—'}</div></div>`).join('')}</div>
    <p class="hint">Les éléments en italique existaient mais n'étaient pas encore connus du COS : ils montrent ce qu'une reconnaissance plus poussée aurait apporté.</p>`;
  $('#corr').hidden = false;
  if (mode === 'game' && !G.ended) { G.corrPause = true; G.paused = true; }
}

function showOICorrection(c) {
  const f = c.f, lab = (L, ids) => ids.map(k => L.find(x => x[0] === k)[1]).join(' ; ') || '—';
  const mine = {
    S: f.S, A: f.A, O: lab(GM.OBJECTIFS, f.obj), I: lab(GM.IDEES, f.im),
    E: f.exe.filter(e => e.mission).map(e => { const a = G.actors.find(x => x.id === e.id); return `${a ? (a.kind === 'binome' ? a.id.replace(/\d/, '') + ' ' + a.engin : a.engin) : e.id} : ${GM.MISSIONS[e.mission].label.toLowerCase()}`; }).join(' ; ') || '—',
    C: f.C, L: f.L,
  };
  const rows = [['S', 'Situation'], ['A', 'Anticipation'], ['O', 'Objectifs'], ['I', 'Idées de manœuvre'], ['E', 'Exécution'], ['C', 'Commandement'], ['L', 'Logistique']];
  $('#corr-body').innerHTML = `
    <p class="lead">Ordre initial donné à ${GM.hhmm(c.t)}. Réussite : <b>${Math.round(c.ev.pts)} %</b></p>
    <ul class="pts">${c.ev.out.map(o => `<li class="${o.ok ? 'ok' : 'ko'}">${esc(o.text)}</li>`).join('')}</ul>
    <div class="cmp"><div class="cmph"><span>Votre ordre initial</span><span>Ordre initial type</span></div>
    ${rows.map(([k, l]) => `<div class="cmpr"><b>${l}</b><div>${esc(mine[k] || '—')}</div><div>${esc(c.model[k] || '—')}</div></div>`).join('')}</div>`;
  $('#corr').hidden = false;
  if (mode === 'game' && !G.ended) { G.corrPause = true; G.paused = true; }
}
// ---------------------------------------------------------------- RAISONNEMENT TACTIQUE / ORDRE INITIAL
function exeOptions(a) {
  const opts = ['<option value="">— pas de mission —</option>'];
  for (const k of GM.availableMissions(a)) {
    const l = GM.MISSIONS[k].label;
    if (k === 'ATTAQUE') { opts.push(`<option value="ATTAQUE|LDV 500">${l} (LDV 500)</option>`, `<option value="ATTAQUE|LDV 250">${l} (LDV 250)</option>`); }
    else if (k === 'RECHERCHE') { opts.push(`<option value="RECHERCHE|">${l}</option>`); if (G.K.facts.victime_lieu) opts.push(`<option value="RECHERCHE|CH1">${l}, priorité chambre côté rue</option>`); }
    else if (k !== 'REPLI') opts.push(`<option value="${k}|">${l}</option>`);
  }
  return opts.join('');
}
function openOI() {
  if (mode !== 'game' || G.ended) return;
  if (G.oi) { showCorrection(Object.assign({ type: 'oi' }, G.lastCorrection && G.lastCorrection.type === 'oi' ? G.lastCorrection : { t: G.oi.t, f: G.oi, ev: G.oi.ev, model: G.oi.model })); return; }
  GM.startRT();
  if (!$('#oi-obj').children.length) {
    $('#oi-obj').innerHTML = GM.OBJECTIFS.map(([k, l]) => `<label><input type="checkbox" name="obj" value="${k}" id="obj-${k}"> ${esc(l)}</label>`).join('');
    $('#oi-im').innerHTML = GM.IDEES.map(([k, l]) => `<label><input type="checkbox" name="im" value="${k}" id="im-${k}"> ${esc(l)}</label>`).join('');
  }
  const keep = {}; document.querySelectorAll('#oi-exe select').forEach(x => keep[x.id] = x.value);
  $('#oi-exe').innerHTML = G.actors.filter(a => a.loc !== 'ABSENT').map(a => {
    const col = S3.TEAM_COLORS[a.id] || 'var(--cmd)';
    const who = a.kind === 'binome' ? `<span class="tag" style="--tc:${col}">${a.id.replace(/\d/, '')}</span> ${esc(a.engin)} — ${esc(a.label.toLowerCase())}` : `<span class="tag" style="--tc:var(--cmd)">${esc(a.engin)}</span> chef d'agrès`;
    return `<div class="exe"><div class="who">${who}</div><select id="exe-${a.id}" aria-label="Mission ${esc(a.engin)}">${exeOptions(a)}</select><span class="hint">${esc(a.mission ? 'en cours : ' + GM.MISSIONS[a.mission].label.toLowerCase() : 'disponible')}</span></div>`;
  }).join('') + (G.actors.some(a => a.loc === 'ABSENT') ? `<p class="hint">En route : ${G.actors.filter(a => a.loc === 'ABSENT').map(a => a.engin).join(', ')}.</p>` : '');
  for (const id in keep) { const el = document.getElementById(id); if (el) el.value = keep[id]; }
  $('#oiwin').hidden = false;
}
function renderRadio() {
  const rows = G.radio.slice().reverse().map(m => `<tr class="${m.kind}"><td>${m.n}</td><td>${GM.hhmm(m.t)}</td><td>${esc(m.from)}</td><td>${esc(m.to)}</td><td>${esc(m.text)}</td></tr>`).join('');
  $('#radio').innerHTML = `<div class="tablewrap"><table><thead><tr><th>N°</th><th>GH</th><th>Origine</th><th>Dest.</th><th>Contenu</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
function renderCarnet() {
  const facts = Object.values(G.K.facts).sort((a, b) => a.t - b.t);
  $('#carnet').innerHTML = `<h4>Renseignements acquis</h4>${facts.length ? `<ul class="facts">${facts.map(f => `<li><b>${GM.hhmm(f.t)}</b> ${esc(f.label)}</li>`).join('')}</ul>` : '<p class="hint">Aucun pour l\'instant.</p>'}
    <h4>Observations et témoignages</h4>${G.observations.length ? `<ul class="obs">${G.observations.map(o => `<li class="${o.kind}"><b>${GM.hhmm(o.t)}</b> ${o.kind === 'temoin' ? `<em>${esc(o.who)}</em> — ${esc(o.q)}<br>${esc(o.text)}` : esc(o.text)}</li>`).join('')}</ul>` : '<p class="hint">Cliquez sur une fenêtre, la cage d\'escalier ou la porte d\'immeuble pour lire le feu (6 s par observation).</p>'}`;
}
UI.toast = (text, kind) => {
  const t = $('#toast');
  const el = document.createElement('div'); el.className = 'ti ' + (kind || ''); el.textContent = text;
  t.prepend(el); while (t.children.length > 4) t.lastChild.remove();
  setTimeout(() => el.classList.add('fade'), 6500); setTimeout(() => el.remove(), 7400);
};

// ---------------------------------------------------------------- DEBRIEF
UI.showDebrief = () => {
  G.paused = true;
  const { g, pts } = GM.debriefData();
  const W = G.W;
  const jg = [['victimes', 'Victimes'], ['securite', 'Sécurité'], ['commandement', 'Commandement'], ['connaissance', 'Connaissance']];
  const truth = GM.ROOMS.map(r => `<li>${esc(GM.roomReportText(r, GM.snapshotRoom(r)))}</li>`).join('');
  const vict = G.victims.map(v => `<li>${esc(v.name)} : ${GM.vState(v).s.toLowerCase()} — dose toxique ${v.fed.toFixed(2).replace('.', ',')}${v.atRue ? ', extrait(e)' : ', non extrait(e)'}</li>`).join('');
  const fstate = (GM.FIRE_STATES.find(f => f[0] === G.fire.cur) || [0, ''])[1];
  $('#debrief-body').innerHTML = `
    <p class="lead">${esc(G.endReason)} — ${GM.clock(W.t).slice(0, 5)}, soit ${GM.fmtDur(W.t - GM.T_ARRIVEE)} après votre arrivée. Situation du feu : <b>${fstate.toLowerCase()}</b>.</p>
    <div class="dgrid">${jg.map(([k, l]) => `<div class="dg"><span>${l}</span><b>${Math.round(g[k])}</b><div class="gt"><i style="width:${g[k]}%"></i></div></div>`).join('')}</div>
    <h3>Points relevés</h3><ul class="pts">${pts.map(p => `<li class="${p.ok ? 'ok' : 'ko'}">${esc(p.text)}</li>`).join('')}</ul>
    ${G.ambiance ? '<p><button class="lnk" data-corr="amb">Revoir la correction du message d\'ambiance</button></p>' : ''}
    <h3>Situation réelle en fin d'exercice</h3><ul class="truth">${truth}</ul><ul class="truth">${vict}</ul>
    <h3>Chronologie</h3><ul class="truth">${G.journal.map(j => `<li><b>${GM.hhmm(j.t)}</b> ${esc(j.text)}</li>`).join('')}</ul>`;
  $('#debrief').hidden = false;
};

// ---------------------------------------------------------------- EVENEMENTS
function bind() {
  const cv = $('#view');
  let down = null;
  cv.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY }; });
  cv.addEventListener('pointerup', e => {
    if (!down || mode !== 'game') return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y); down = null;
    if (moved > 6 || e.button !== 0) return;
    const p = S3.pick(e.clientX, e.clientY);
    if (!p) { closeMenu(); return; }
    if (p.type === 'engin' || p.type === 'team') openMenu(p, e.clientX, e.clientY);
    else if (p.type === 'witness') openDialog(p.id);
    else if (p.type === 'observe') {
      closeMenu();
      if (G.busy) UI.toast('Le CDG est déjà occupé : ' + G.busy.label.toLowerCase() + '.', 'alerte');
      else if (GM.observe(p.what)) UI.toast('Observation en cours…', 'obs');
    }
  });
  cv.addEventListener('pointermove', e => {
    if (mode !== 'game' || down) return;
    const p = S3.pick(e.clientX, e.clientY);
    cv.style.cursor = p ? 'pointer' : 'grab';
  });
  $('#ctx').addEventListener('click', e => {
    if (e.target.closest('[data-close]')) return closeMenu();
    const go = e.target.closest('[data-go]'); if (go) { openTab(go.dataset.go === 'msg' ? 'p-msg' : go.dataset.go === 'sitac' ? 'p-sitac' : 'p-radio'); closeMenu(); return; }
    const b = e.target.closest('.mb[data-a]'); if (!b || G.ended) return;
    const a = G.actors.find(x => x.id === b.dataset.a);
    const opts = {};
    const l = document.getElementById('lance-' + a.id); if (l) opts.lance = l.value;
    const p = document.getElementById('prio-' + a.id); if (p && p.value) opts.priority = p.value;
    GM.order(a, b.dataset.k, opts); closeMenu();
  });
  $('#dialog').addEventListener('click', e => {
    if (e.target.closest('[data-dclose]')) { dialogW = null; $('#dialog').hidden = true; return; }
    const b = e.target.closest('.qb'); if (!b) return;
    if (GM.ask(dialogW, b.dataset.q)) renderDialog();
  });
  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => openTab(t.dataset.p)));
  $('#btn-panel').addEventListener('click', () => { const p = $('#panel'); p.classList.toggle('closed'); $('#btn-panel').setAttribute('aria-expanded', !p.classList.contains('closed')); });
  $('#btn-pause').addEventListener('click', () => {
    if (G.ended || mode !== 'game') return;
    G.paused = !G.paused; if (G.paused) G.pauses++;
    $('#btn-pause').textContent = G.paused ? 'Reprendre' : 'Pause'; $('#btn-pause').setAttribute('aria-pressed', G.paused);
    $('#pausebadge').hidden = !G.paused;
  });
  document.querySelectorAll('.spd').forEach(b => b.addEventListener('click', () => { G.speed = +b.dataset.s; document.querySelectorAll('.spd').forEach(x => x.setAttribute('aria-pressed', x === b)); }));
  document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => {
    const v = b.dataset.view;
    if (v === 'coupe') { const on = !S3.isCut(); S3.setCut(on); b.setAttribute('aria-pressed', on); if (on) S3.view('coupe'); }
    else { S3.setCut(false); $('[data-view="coupe"]').setAttribute('aria-pressed', false); S3.view(v); }
  }));
  const readForm = id => {
    const f = new FormData($(id));
    return { suis: f.get('suis') || '', vois: f.get('vois') || '', prevois: f.get('prevois') || '', fais: f.get('fais') || '', demande: f.get('demande') || '', victimes: f.get('victimes') || '', cos: !!f.get('cos'), renforts: f.getAll('renf') };
  };
  $('#form-amb').addEventListener('submit', e => { e.preventDefault(); if (G.ended) return; GM.sendMessage('ambiance', readForm('#form-amb')); renderMsgState(); showCorrection(G.lastCorrection); });
  $('#form-cr').addEventListener('submit', e => { e.preventDefault(); if (G.ended) return; GM.sendMessage('cr', readForm('#form-cr')); e.target.reset(); renderMsgState(); showCorrection(G.lastCorrection); });
  document.addEventListener('click', e => {
    const c = e.target.closest('[data-corr]'); if (!c) return;
    showCorrection(c.dataset.corr === 'amb' ? Object.assign({ type: 'ambiance' }, G.ambiance) : Object.assign({ type: 'cr', n: G.crs.length }, G.crs[G.crs.length - 1]));
  });
  $('#plan').addEventListener('click', openBig);
  $('#btn-oi').addEventListener('click', openOI);
  $('#oi-close').addEventListener('click', () => { $('#oiwin').hidden = true; });
  $('#form-oi').addEventListener('submit', e => {
    e.preventDefault(); if (G.ended || G.oi) return;
    const f = new FormData(e.target);
    const exe = G.actors.filter(a => a.loc !== 'ABSENT').map(a => { const v = (document.getElementById('exe-' + a.id) || {}).value || ''; const [m, o] = v.split('|'); return { id: a.id, mission: m || null, opts: m === 'ATTAQUE' ? { lance: o } : m === 'RECHERCHE' && o ? { priority: o } : {} }; });
    const c = GM.giveOI({ S: f.get('S') || '', A: f.get('A') || '', C: f.get('C') || '', L: f.get('L') || '', obj: f.getAll('obj'), im: f.getAll('im'), exe });
    $('#oiwin').hidden = true; if (c) showCorrection(c);
  });
  document.querySelectorAll('.st').forEach(b => b.addEventListener('click', () => {
    tool = tool === b.dataset.t ? null : b.dataset.t;
    document.querySelectorAll('.st').forEach(x => x.setAttribute('aria-pressed', x.dataset.t === tool));
  }));
  $('#st-view').addEventListener('change', () => { drawPlan(performance.now(), bigCtx); });
  const bp = $('#bigplan');
  bp.addEventListener('pointerdown', ev => {
    if (!tool || mode !== 'game') return;
    const p = planFromEvent(ev);
    if (tool === 'gomme') { GM.sitacRemoveNear(p.x, p.y); drawPlan(performance.now(), bigCtx); return; }
    if (DRAG_TOOLS.includes(tool)) { drag = { k: tool, x: p.x, y: p.y, x2: p.x, y2: p.y }; bp.setPointerCapture(ev.pointerId); }
    else { GM.sitacAdd({ k: tool, x: p.x, y: p.y, label: tool === 'moyen' ? $('#st-moyen').value : undefined }); drawPlan(performance.now(), bigCtx); }
  });
  bp.addEventListener('pointermove', ev => { if (!drag) return; const p = planFromEvent(ev); drag.x2 = p.x; drag.y2 = p.y; drawPlan(performance.now(), bigCtx); });
  bp.addEventListener('pointerup', () => {
    if (!drag) return;
    if (Math.hypot(drag.x2 - drag.x, drag.y2 - drag.y) > 0.4) GM.sitacAdd(drag);
    drag = null; drawPlan(performance.now(), bigCtx);
  });
  $('#sitac-close').addEventListener('click', () => { $('#sitacbig').hidden = true; });
  $('#corr-close').addEventListener('click', () => { $('#corr').hidden = true; if (G.corrPause && !G.ended) { G.corrPause = false; G.paused = false; } });
  $('#btn-fin').addEventListener('click', () => { if (mode === 'game') GM.endGame('Fin d\'intervention déclarée par le COS'); });
  // accueil
  $('#home').addEventListener('click', e => {
    const b = e.target.closest('[data-play]'); if (!b) return;
    $('#home').hidden = true; $('#intro').hidden = false;
  });
  $('#quality').addEventListener('change', e => { try { localStorage.setItem('cdg-quality', e.target.value); } catch (er) { } location.reload(); });
  $('#btn-start').addEventListener('click', startGame);
  $('#btn-back').addEventListener('click', () => { $('#intro').hidden = true; $('#home').hidden = false; });
  $('#btn-restart').addEventListener('click', () => { $('#debrief').hidden = true; goHome(); });
  window.addEventListener('keydown', e => { if (e.key === 'Escape') { closeMenu(); $('#sitacbig').hidden = true; $('#oiwin').hidden = true; } });
}
function openTab(id) {
  $('#panel').classList.remove('closed');
  document.querySelectorAll('.tab').forEach(x => x.setAttribute('aria-selected', x.dataset.p === id));
  document.querySelectorAll('.tp').forEach(p => p.hidden = p.id !== id);
  dirtyTabs = true;
}
let dirtyTabs = true;
let bigCtx = null;
function openBig() {
  const c = $('#bigplan'), wrap = $('#sitacbig');
  wrap.hidden = false;
  const w = Math.min(innerWidth - 48, 1600), h = w * PH / PW, dpr = Math.min(devicePixelRatio || 1, 2);
  const hh = Math.min(h, innerHeight - 230), ww = hh * PW / PH;
  c.style.width = ww + 'px'; c.style.height = hh + 'px';
  c.width = ww * dpr; c.height = hh * dpr;
  bigCtx = c.getContext('2d'); bigCtx.setTransform(dpr * ww / PW, 0, 0, dpr * ww / PW, 0, 0);
  drawPlan(performance.now(), bigCtx);
}

// ---------------------------------------------------------------- CYCLE DE VIE
function resetUI() {
  closeMenu(); dialogW = null; $('#dialog').hidden = true; $('#corr').hidden = true;
  $('#form-amb').reset(); $('#form-cr').reset(); $('#toast').innerHTML = '';
  $('#btn-pause').textContent = 'Pause'; $('#pausebadge').hidden = true;
  renderMsgState();
}
function goHome() {
  mode = 'home'; GM.newGame(); G.started = true; G.speed = 1; resetUI();
  document.body.classList.add('home'); $('#home').hidden = false;
  S3.autoRotate(true); S3.view('aerien');
}
function startGame() {
  GM.newGame(); G.started = true; G.speed = 0.5; resetUI();
  document.querySelectorAll('.spd').forEach(x => x.setAttribute('aria-pressed', x.dataset.s === '0.5'));
  $('#oi-obj').innerHTML = ''; $('#form-oi').reset();
  mode = 'game'; document.body.classList.remove('home');
  $('#intro').hidden = true; S3.autoRotate(false); S3.view('rue');
  UI.toast('Vous arrivez sur les lieux. Le CA du FPT 1 vous attend au pied de l\'immeuble.', 'cr');
  setTimeout(() => GM.radio('CA FPT 1', 'CDG', 'Point de situation : feu d\'appartement au 3e, fumées noires par les fenêtres côté rue. La cage est enfumée. J\'ai ouvert la porte d\'immeuble. J\'attends vos ordres.', 'cr'), 1500);
}
let last = 0, uiT = 0;
function loop(now) {
  requestAnimationFrame(loop);
  const real = Math.min(0.25, (now - last) / 1000); last = now;
  if (G.started && !G.ended) {
    if (G.paused) G.pausedTime += real;
    else { let simDt = real * (mode === 'home' ? 1 : G.speed), n = 0; while (simDt > 1e-6 && n < 80) { GM.tick(SIM.CFG.dt); simDt -= SIM.CFG.dt; n++; } }
  }
  S3.tickCamera(real);
  S3.update(real, now);
  if (mode === 'game' && now - uiT > 250) {
    uiT = now;
    renderHUD();
    if (G.dirty) { G.dirty = false; if (menu) renderMenu(); renderDialog(); renderMsgState(); dirtyTabs = true; }
    else updateMenuStatus();
    if (dialogW && !G.busy && $('#dialog .typing')) renderDialog();
    if (!$('#p-sitac').hidden) drawPlan(now);
    if (!$('#sitacbig').hidden && bigCtx) drawPlan(now, bigCtx);
    if (dirtyTabs || G.dirtyRadio) {
      dirtyTabs = false; G.dirtyRadio = false;
      if (!$('#p-radio').hidden) renderRadio();
      if (!$('#p-carnet').hidden) renderCarnet();
    }
    if (!$('#p-carnet').hidden && G.observations.length !== (renderCarnet.n || 0)) { renderCarnet.n = G.observations.length; renderCarnet(); }
  }
}
window.addEventListener('DOMContentLoaded', () => {
  let q = 'standard'; try { q = localStorage.getItem('cdg-quality') || 'standard'; } catch (e) { }
  $('#quality').value = q;
  const pc = $('#plan'); const dpr = Math.min(devicePixelRatio || 1, 2); pc.width = PW * dpr; pc.height = PH * dpr; pctx = pc.getContext('2d'); pctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  setTimeout(() => {
    try { S3.init($('#view'), q); }
    catch (err) { $('#loading').hidden = true; $('#nogl').hidden = false; console.error(err); return; }
    $('#loading').hidden = true;
    bind(); goHome();
    requestAnimationFrame(t => { last = t; loop(t); });
  }, 50);
});
})();
