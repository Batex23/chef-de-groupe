#!/usr/bin/env python3
"""Convertit les volumes Plot3D d'un calcul FDS en donnees legeres pour le jeu.

Usage : python3 fds2jeu.py <dossier_du_cas> <dossier_de_sortie> [pas]

Lit le .smv (maillages, liste des fichiers .q) et les .q (temperature, visibilite,
CO, O2, puissance volumique), garde un noeud sur <pas> (2 par defaut : maille de
0,4 m), quantifie chaque grandeur sur un octet et ecrit, par maillage :
  <CHID>_<maillage>.bin.gz : octets [instant][grandeur][k][j][i]
et un fichier <CHID>.json qui decrit tout (grilles, instants, decodage).
Les noeuds solides (murs, dalles) sont marques transparents.
"""
import sys, os, re, json, gzip
import numpy as np

# maillages fins et petits gardes a pleine resolution (0,2 m) : panache en facade, cage d'escalier
STEP_MESH = {'EXTERIEUR': 1, 'CAGE': 1}
QTY = ['T', 'VIS', 'CO', 'O2', 'HRR']
# decodage cote jeu : valeur = a + b * (u/255) ** p
DECODE = {
    'T': {'a': 20.0, 'b': 1180.0, 'p': 2.0, 'unite': 'degC'},
    'VIS': {'a': 0.0, 'b': 30.0, 'p': 1.0, 'unite': 'm'},
    'CO': {'a': 0.0, 'b': 20000.0, 'p': 2.0, 'unite': 'ppm'},
    'O2': {'a': 0.0, 'b': 21.0, 'p': 1.0, 'unite': '%'},
    'HRR': {'a': 0.0, 'b': 3000.0, 'p': 2.0, 'unite': 'kW/m3'},
}


def encode(name, v):
    d = DECODE[name]
    x = np.clip((v - d['a']) / d['b'], 0, 1) ** (1 / d['p'])
    return np.round(x * 255).astype(np.uint8)


def read_smv(path):
    L = open(path, errors='replace').read().split('\n')
    meshes, pl3d = [], []
    i = 0
    while i < len(L):
        s = L[i].strip()
        if s.startswith('GRID') and len(s.split()) > 1:
            name = s.split()[1]
            ib, jb, kb = map(int, L[i + 1].split()[:3])
            meshes.append({'nom': name, 'ijk': [ib, jb, kb]})
        elif s.startswith('PDIM'):
            xb = list(map(float, L[i + 1].split()[:6]))
            meshes[-1]['xb'] = xb
        elif s.startswith('PL3D'):
            t, m = L[i].split()[1:3]
            pl3d.append((float(t), int(m), L[i + 1].strip()))
        i += 1
    return meshes, pl3d


def read_q(path, ijk):
    raw = open(path, 'rb').read()
    nx, ny, nz = np.frombuffer(raw[4:16], dtype='<i4')
    assert (nx, ny, nz) == (ijk[0] + 1, ijk[1] + 1, ijk[2] + 1), (path, nx, ny, nz)
    off = 4 + 12 + 4 + 4 + 16 + 4 + 4
    return np.frombuffer(raw[off:off + nx * ny * nz * 5 * 4], dtype='<f4').reshape(5, nz, ny, nx)


def main():
    src, out = sys.argv[1], sys.argv[2]
    step0 = int(sys.argv[3]) if len(sys.argv) > 3 else 2
    smv = [f for f in os.listdir(src) if f.endswith('.smv')][0]
    chid = smv[:-4]
    meshes, pl3d = read_smv(os.path.join(src, smv))
    os.makedirs(out, exist_ok=True)
    times = sorted({round(t) for t, m, f in pl3d})
    meta = {'chid': chid, 'pas_noeuds': step0, 'instants': times, 'grandeurs': QTY, 'decodage': DECODE,
            'repere': 'FDS : x est, y nord (vers l\'arriere), z haut ; z = 0 au plancher du R+3', 'maillages': []}
    for mi, M in enumerate(meshes, start=1):
        ib, jb, kb = M['ijk']
        step = STEP_MESH.get(M['nom'], step0)
        x0, x1, y0, y1, z0, z1 = M['xb']
        sel = lambda n: np.arange(0, n + 1, step) if n % step == 0 else np.append(np.arange(0, n + 1, step), n)
        si, sj, sk = sel(ib), sel(jb), sel(kb)
        frames, have = [], []
        for t in times:
            f = next((f for (tt, m, f) in pl3d if m == mi and round(tt) == t), None)
            p = os.path.join(src, f) if f else None
            if not p or not os.path.exists(p):
                frames.append(None); continue
            q = read_q(p, M['ijk'])[:, sk][:, :, sj][:, :, :, si]
            T, VIS, Y_CO, Y_O2, HRR = q
            solid = (Y_O2 < 1e-6) & (HRR < 1e-3) & (Y_CO < 1e-9)
            VIS = np.where(solid, 30.0, VIS)
            enc = np.stack([encode('T', T), encode('VIS', VIS), encode('CO', Y_CO * 1e6), encode('O2', Y_O2 * 100), encode('HRR', HRR)])
            frames.append(enc); have.append(t)
        if not have:
            print(f'maillage {mi} ({M["nom"]}) : aucun fichier .q present'); continue
        # instants manquants : on recopie le plus proche (signale dans le json)
        filled = []
        for k, fr in enumerate(frames):
            if fr is None:
                j = min(range(len(frames)), key=lambda j: abs(j - k) if frames[j] is not None else 1e9)
                fr = frames[j]
            filled.append(fr)
        data = np.stack(filled).astype(np.uint8)
        fn = f'{chid}_{M["nom"]}.bin.gz'
        with gzip.open(os.path.join(out, fn), 'wb', compresslevel=9) as g:
            g.write(data.tobytes())
        xs = [x0 + (x1 - x0) * i / ib for i in si]; ys = [y0 + (y1 - y0) * j / jb for j in sj]; zs = [z0 + (z1 - z0) * k / kb for k in sk]
        meta['maillages'].append({'nom': M['nom'], 'fichier': fn, 'n': [len(si), len(sj), len(sk)],
                                  'x': [round(v, 3) for v in xs], 'y': [round(v, 3) for v in ys], 'z': [round(v, 3) for v in zs],
                                  'pas_noeuds': step, 'instants_presents': len(have), 'instants_total': len(times)})
        print(f'maillage {mi} ({M["nom"]}) : {len(have)}/{len(times)} instants, grille {len(si)}x{len(sj)}x{len(sk)}, '
              f'{os.path.getsize(os.path.join(out, fn)) / 1e6:.2f} Mo')
    json.dump(meta, open(os.path.join(out, chid + '.json'), 'w'), ensure_ascii=False)


if __name__ == '__main__':
    main()
