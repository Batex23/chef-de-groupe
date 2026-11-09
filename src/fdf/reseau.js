// =============================================================================
// Multijoueur : le navigateur du chef de groupe fait tourner la simulation (hote)
// et publie l'etat ; les chefs d'agres et le formateur (clients) l'affichent et
// envoient des commandes (ordres a leur engin, messages radio, injections).
// Deux transports, meme protocole :
//  - « firebase » : Firebase Realtime Database (Internet, caserne)
//  - « local »    : BroadcastChannel (plusieurs fenetres sur le meme poste)
// Noeuds : conf (parametres de la partie), etat (1 s), etat2 (5 s, formateur),
// log (deltas du feu, radio), cmd (commandes des clients), joueurs (presence).
// =============================================================================
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const propre = v => JSON.parse(JSON.stringify(v, (k, x) => (typeof x === 'number' && !isFinite(x) ? null : x)));
  const NET = { mode: 'solo', role: 'cdg', uid: Math.random().toString(36).slice(2, 10), nom: '', code: '', unite: null, joueurs: {}, T: null };

  // ------------------------------------------------------------- transport local (meme poste)
  function transportLocal(code, autorite) {
    const bc = new BroadcastChannel('fdf-' + code);
    const store = {}, listes = {}, ecV = {}, ecA = {};
    const get = p => p.split('/').reduce((o, k) => (o == null ? undefined : o[k]), store);
    const fireV = p => { for (const q in ecV) if (p === q || p.startsWith(q + '/') || q.startsWith(p + '/')) ecV[q].forEach(cb => cb(propre(get(q) ?? null))); };
    const setP = (p, v) => { const ks = p.split('/'); let o = store; ks.slice(0, -1).forEach(k => { o = o[k] = (o[k] && typeof o[k] === 'object') ? o[k] : {}; }); if (v == null) delete o[ks[ks.length - 1]]; else o[ks[ks.length - 1]] = propre(v); fireV(p); };
    const pushP = (p, k, v) => { (listes[p] = listes[p] || []).push([k, v]); (ecA[p] || []).forEach(cb => cb(k, v)); };
    const delA = (p, k) => { if (listes[p]) listes[p] = listes[p].filter(e => e[0] !== k); };
    bc.onmessage = e => {
      const m = e.data;
      if (m.op === 'set') setP(m.p, m.v);
      else if (m.op === 'push') pushP(m.p, m.k, m.v);
      else if (m.op === 'del') { const i = m.p.lastIndexOf('/'), base = m.p.slice(0, i); if (listes[base]) delA(base, m.p.slice(i + 1)); else setP(m.p, null); }
      else if (m.op === 'hello' && autorite) bc.postMessage({ op: 'dump', store, listes });
      else if (m.op === 'dump' && !autorite) {
        for (const k in m.store) setP(k, m.store[k]);
        for (const p in m.listes) for (const [k, v] of m.listes[p]) if (!(listes[p] || []).some(e => e[0] === k)) pushP(p, k, v);
      }
    };
    const T = {
      set(p, v) { setP(p, v); bc.postMessage({ op: 'set', p, v: propre(v) }); },
      push(p, v) { const k = Date.now().toString(36) + Math.random().toString(36).slice(2, 6); v = propre(v); pushP(p, k, v); bc.postMessage({ op: 'push', p, k, v }); return k; },
      del(p) { const i = p.lastIndexOf('/'), base = p.slice(0, i); if (listes[base]) delA(base, p.slice(i + 1)); else setP(p, null); bc.postMessage({ op: 'del', p }); },
      on(p, cb) { (ecV[p] = ecV[p] || []).push(cb); const v = get(p); if (v !== undefined) cb(propre(v)); },
      onAdd(p, cb) { (ecA[p] = ecA[p] || []).push(cb); (listes[p] || []).forEach(([k, v]) => cb(k, v)); },
      presence(p, v) { T.set(p, v); if (!T.pres) { T.pres = true; const bye = () => T.del('joueurs/' + NET.uid); window.addEventListener('pagehide', bye); window.addEventListener('beforeunload', bye); } },
    };
    if (!autorite) bc.postMessage({ op: 'hello' });
    return T;
  }

  // ------------------------------------------------------------- transport Firebase
  async function transportFirebase(code, url) {
    const V = '10.12.2';
    const { initializeApp } = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`);
    const D = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-database.js`);
    // http://localhost:9000 : emulateur Firebase (essais hors ligne)
    const emu = /^http:\/\/(localhost|127\.0\.0\.1):(\d+)/.exec(url);
    const app = initializeApp({ databaseURL: emu ? 'https://demo-fdf-default-rtdb.firebaseio.com' : url }, 'fdf-' + code + '-' + NET.uid);
    const db = D.getDatabase(app); if (emu) D.connectDatabaseEmulator(db, emu[1], +emu[2]);
    const r = p => D.ref(db, `fdf/${code}/${p}`);
    return {
      set(p, v) { return D.set(r(p), propre(v)); },
      push(p, v) { return D.push(r(p), propre(v)).key; },
      del(p) { return D.remove(r(p)); },
      on(p, cb) { D.onValue(r(p), s => cb(s.val())); },
      onAdd(p, cb) { D.onChildAdded(r(p), s => cb(s.key, s.val())); },
      presence(p, v) { D.set(r(p), propre(v)); D.onDisconnect(r(p)).remove(); },
    };
  }

  NET.ouvre = async function (code, net, url, autorite) {
    NET.code = code; NET.net = net;
    NET.T = net === 'local' ? transportLocal(code, autorite) : await transportFirebase(code, url);
    return NET.T;
  };

  // ------------------------------------------------------------- encodage des mailles du feu
  NET.b64 = function (arr) {
    const u8 = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength); let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  };
  NET.deb64 = function (s) { const b = atob(s), u8 = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u8[i] = b.charCodeAt(i); return new Int32Array(u8.buffer); };

  // ------------------------------------------------------------- API de jeu
  NET.cmd = function (c) { if (NET.T) NET.T.push('cmd', Object.assign({ uid: NET.uid, role: NET.role, nom: NET.nom, unite: NET.unite }, c)); };
  NET.log = function (o) { if (NET.T && NET.mode === 'hote') NET.T.push('log', o); };
  NET.majPresence = function () { if (NET.T) NET.T.presence('joueurs/' + NET.uid, { nom: NET.nom, role: NET.role, unite: NET.unite || '', ts: Date.now() }); };

  // ------------------------------------------------------------- ecran d'accueil
  const CFG = window.FDF_RESEAU || {};
  function dbUrl() { return ($('#m-db') && $('#m-db').value.trim()) || CFG.databaseURL || ''; }
  function code4() { const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s = ''; for (let i = 0; i < 4; i++) s += A[Math.floor(Math.random() * A.length)]; return s; }
  function etatM(t, err) { const e = $('#m-etat'); if (e) { e.textContent = t; e.classList.toggle('err', !!err); } }
  function lien() {
    const u = new URL(location.href.split('?')[0]); u.searchParams.set('partie', NET.code); if (NET.net === 'local') u.searchParams.set('net', 'local'); else if (dbUrl() !== CFG.databaseURL) u.searchParams.set('db', dbUrl());
    return u.toString();
  }
  NET.lien = lien;

  NET.prepareAccueil = function () {
    const q = new URLSearchParams(location.search);
    const mem = k => { try { return localStorage.getItem('fdf-' + k) || ''; } catch (e) { return ''; } };
    const memo = (k, v) => { try { localStorage.setItem('fdf-' + k, v); } catch (e) { /* stockage indisponible */ } };
    $('#m-nom').value = mem('nom');
    $('#m-db').value = q.get('db') || mem('db') || CFG.databaseURL || '';
    $('#m-net').value = q.get('net') === 'local' ? 'local' : 'firebase';
    if (q.get('partie')) { $('#m-code').value = q.get('partie').toUpperCase(); $('#m-role').value = q.get('role') === 'formateur' ? 'formateur' : 'ca'; $('#multi').open = true; }
    const majNet = () => { $('#m-db-zone').hidden = $('#m-net').value !== 'firebase' || !!CFG.databaseURL && !q.get('db'); };
    $('#m-net').onchange = majNet; majNet();
    const prerequis = () => {
      NET.nom = $('#m-nom').value.trim(); if (!NET.nom) { etatM('Indiquez votre nom.', true); $('#m-nom').focus(); return false; }
      memo('nom', NET.nom);
      if ($('#m-net').value === 'firebase') { if (!/^https:\/\/.+(firebaseio\.com|firebasedatabase\.app)\/?$|^http:\/\/(localhost|127\.0\.0\.1):\d+\/?$/.test(dbUrl())) { etatM('Adresse de la base Firebase manquante ou invalide (voir fdf/MULTIJOUEUR.md).', true); $('#m-db-zone').hidden = false; return false; } memo('db', dbUrl()); }
      return true;
    };
    $('#m-creer').onclick = async () => {
      if (!prerequis()) return;
      try {
        etatM('Création de la partie…');
        NET.mode = 'hote'; NET.role = 'cdg';
        await NET.ouvre(code4(), $('#m-net').value, dbUrl(), true);
        NET.majPresence();
        window.FDFJ.lanceHote();
      } catch (e) { NET.mode = 'solo'; etatM('Connexion impossible : ' + e.message, true); }
    };
    $('#m-rejoindre').onclick = async () => {
      if (!prerequis()) return;
      const code = $('#m-code').value.trim().toUpperCase(); if (!/^[A-Z0-9]{4}$/.test(code)) { etatM('Code de partie : 4 caractères.', true); return; }
      try {
        etatM('Connexion à la partie ' + code + '…');
        NET.mode = 'client'; NET.role = $('#m-role').value;
        const T = await NET.ouvre(code, $('#m-net').value, dbUrl(), false);
        let fait = false;
        const to = setTimeout(() => { if (!fait) etatM(`Partie ${code} introuvable. Vérifiez le code, et que le chef de groupe l'a bien créée${$('#m-net').value === 'local' ? ' dans une autre fenêtre de ce navigateur' : ''}.`, true); }, 8000);
        T.on('conf', conf => {
          if (!conf || fait) return; fait = true; clearTimeout(to);
          NET.majPresence();
          window.FDFJ.lanceClient(conf);
        });
      } catch (e) { NET.mode = 'solo'; etatM('Connexion impossible : ' + e.message, true); }
    };
  };
  NET.pret = function () { ['#m-creer', '#m-rejoindre'].forEach(s => { const b = $(s); if (b) b.disabled = false; }); };

  window.NET = NET;
})();
