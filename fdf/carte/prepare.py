#!/usr/bin/env python3
"""Prepare la carte du jeu FDF a partir des donnees IGN telechargees.

Usage : python3 prepare.py <dossier_ign> <dossier_sortie>

Sorties (dans <dossier_sortie>) :
  carte.json      : emprise, resolution, legende des combustibles, vecteurs (routes et pistes DFCI,
                    crastes et cours d'eau, bati, lieux-dits, points sensibles, lignes electriques)
  raster.bin.gz   : grille 10 m, 3 couches uint8 [combustible, hauteur vegetation (dm), altitude (x5 m)]
  ortho.jpg       : photo aerienne (5 m/pixel)
Coordonnees locales en metres : x vers l'est depuis X0, y vers le nord depuis Y0 (Lambert-93).
"""
import sys, os, json, gzip, math, shutil
import numpy as np
from PIL import Image, ImageDraw

X0, X1, Y0, Y1 = 381000, 393600, 6382000, 6392800
RES = 10
W, H = (X1 - X0) // RES, (Y1 - Y0) // RES

# combustibles : categories du memento FDF SDIS 33 (message d'arrivee), affinees par la hauteur LiDAR
FUELS = [
    # id, code, libelle memento, couleur carte
    (0, 'INC', 'Non combustible (route, eau, bâti)', '#d8d4cc'),
    (1, 'AGR', 'Espace agricole', '#e9e2a6'),
    (2, 'PRA', 'Prairie / bord de route', '#cfe3a0'),
    (3, 'LAN', 'Landes', '#c9b27c'),
    (4, 'COU', 'Landes (coupe rase)', '#d9c79c'),
    (5, 'SEM', 'Pins de - 20 ans (semis 0-5 ans)', '#a8d08d'),
    (6, 'P10', 'Pins de - 20 ans (5-10 ans)', '#7dbb69'),
    (7, 'P20', 'Pins de - 20 ans (10-20 ans)', '#5aa152'),
    (8, 'P40', 'Pins de 20 à 40 ans', '#3d8445'),
    (9, 'P99', 'Pins de + 40 ans', '#2a6638'),
    (10, 'FEU', 'Taillis / Feuillus', '#7fa86a'),
    (11, 'MIX', 'Pins d\'âges divers', '#4f8f5a'),
    (12, 'JAR', 'Jardins, abords des habitations', '#d6e6c2'),
    (13, 'MAR', 'Marais', '#9fc7b8'),
]
F = {c: i for i, c, _, _ in FUELS}


def walk_rings(geom):
    t, c = geom['type'], geom['coordinates']
    if t == 'Polygon': return [c]
    if t == 'MultiPolygon': return c
    return []


def walk_lines(geom):
    t, c = geom['type'], geom['coordinates']
    if t == 'LineString': return [c]
    if t == 'MultiLineString': return c
    return []


def px(x, y): return ((x - X0) / RES, (Y1 - y) / RES)        # pixel (colonne, ligne), ligne 0 au nord


def load(d, n):
    p = os.path.join(d, n + '.geojson')
    return json.load(open(p))['features'] if os.path.exists(p) else []


def raster_polys(feats, value_fn, img=None, fill_default=None):
    img = img or Image.new('L', (W, H), 0)
    dr = ImageDraw.Draw(img)
    for f in feats:
        v = value_fn(f)
        if v is None: continue
        for poly in walk_rings(f['geometry']):
            dr.polygon([px(*p[:2]) for p in poly[0]], fill=v)
            for hole in poly[1:]: dr.polygon([px(*p[:2]) for p in hole], fill=fill_default if fill_default is not None else 0)
    return img


def simplify(pts, tol):
    if len(pts) < 3: return pts
    a, b = np.array(pts[0]), np.array(pts[-1]); ab = b - a; L = np.hypot(*ab) or 1e-9
    d = [abs(ab[0] * (p[1] - a[1]) - ab[1] * (p[0] - a[0])) / L for p in pts[1:-1]]
    i = int(np.argmax(d)) + 1
    if d[i - 1] > tol: return simplify(pts[:i + 1], tol)[:-1] + simplify(pts[i:], tol)
    return [pts[0], pts[-1]]


def loc(p): return [round(p[0] - X0, 1), round(p[1] - Y0, 1)]


def main():
    src, out = sys.argv[1], sys.argv[2]
    os.makedirs(out, exist_ok=True)

    # ---------------- hauteur de vegetation (LiDAR HD) a 10 m
    mnh = np.load(os.path.join(src, 'mnh_5m.npy'))
    mnh = np.clip(np.nan_to_num(mnh), 0, 40)
    h10 = mnh.reshape(H, 2, W, 2).max(axis=(1, 3))            # sommet du couvert dans la maille
    # hauteur "de peuplement" : mediane sur 50 m (lisse les trouees et les cimes isolees)
    from numpy.lib.stride_tricks import sliding_window_view
    pad = np.pad(h10, 2, mode='edge')
    win = sliding_window_view(pad, (5, 5))
    hst = np.median(win, axis=(2, 3))
    hsd = win.std(axis=(2, 3))

    # ---------------- formations vegetales (BD Foret V2)
    def bdf(f):
        c = f['properties'].get('code_tfv') or ''
        if c.startswith('LA'): return 1
        if c == 'FF0': return 2
        if c.startswith('FF2') or c == 'FO2' or c == 'FF32': return 3
        if c.startswith('FF1') or c == 'FO1' or c == 'FP': return 4
        if c in ('FF31', 'FO3'): return 5
        return None
    bd = np.array(raster_polys(load(src, 'foret'), bdf))

    fuel = np.full((H, W), F['PRA'], np.uint8)
    pine = (bd == 3) | (bd == 2) | (bd == 5)
    def pine_class(h):
        return np.select([h < 1.0, h < 2.5, h < 7, h < 13, h < 20], [F['COU'], F['SEM'], F['P10'], F['P20'], F['P40']], F['P99'])
    pc = pine_class(hst)
    fuel = np.where(pine, pc, fuel)
    fuel = np.where(pine & (hsd > 5.5) & (hst > 4), F['MIX'], fuel)               # parcelles heterogenes
    fuel = np.where(bd == 1, np.where(hst > 4, pc, F['LAN']), fuel)
    fuel = np.where(bd == 4, F['FEU'], fuel)
    fuel = np.where(bd == 5, np.where(hst > 12, F['MIX'], pc), fuel)
    # hors BD Foret : cultures (photo claire, pas de couvert), haies et bosquets
    ortho = Image.open(os.path.join(src, 'ortho_5m.jpg')).convert('RGB')
    o = np.asarray(ortho.resize((W, H), Image.BILINEAR)).astype(np.float32)
    bright = o.mean(axis=2)
    nofor = bd == 0
    fuel = np.where(nofor & (hst < 0.6) & (bright > 95), F['AGR'], fuel)
    fuel = np.where(nofor & (hst >= 4), F['FEU'], fuel)

    # ---------------- habitat, bati, eau, routes
    hab = np.array(raster_polys(load(src, 'habitat'), lambda f: 1))
    fuel = np.where((hab == 1) & (fuel != F['FEU']), F['JAR'], fuel)
    bat = np.array(raster_polys(load(src, 'batiments'), lambda f: 1))
    eau = np.array(raster_polys(load(src, 'hydro_surfaces') + load(src, 'plans_eau'), lambda f: 1))
    fuel = np.where((bat == 1) | (eau == 1), F['INC'], fuel)

    roads = load(src, 'routes')
    WID = {'Route à 2 chaussées': 14, 'Route à 1 chaussée': 7, 'Rond-point': 10, 'Route empierrée': 5, 'Chemin': 3, 'Sentier': 1}
    rimg = Image.new('L', (W, H), 0); dr = ImageDraw.Draw(rimg)
    for f in roads:
        w = WID.get(f['properties']['nature'], 3)
        if f['properties'].get('piste_dfci'): w = max(w, 6)        # piste DFCI : bande de roulement + accotements
        if w < 5: continue
        for line in walk_lines(f['geometry']):
            dr.line([px(*p[:2]) for p in line], fill=1, width=max(1, round(w / RES)))
    road = np.array(rimg)
    fuel = np.where(road == 1, F['INC'], fuel)

    # ---------------- altitude 20 m -> 10 m
    mnt = np.load(os.path.join(src, 'mnt_20m.npy'))
    alt = np.asarray(Image.fromarray(mnt.astype(np.float32)).resize((W, H), Image.BILINEAR))
    alt8 = np.clip(np.round(alt * 5), 0, 255).astype(np.uint8)
    h8 = np.clip(np.round(h10 * 10), 0, 255).astype(np.uint8)

    with gzip.open(os.path.join(out, 'raster.bin.gz'), 'wb', compresslevel=9) as g:
        g.write(fuel.astype(np.uint8).tobytes()); g.write(h8.tobytes()); g.write(alt8.tobytes())

    # ---------------- vecteurs
    def kind(p):
        n = p['nature']
        if n in ('Route à 2 chaussées', 'Route à 1 chaussée', 'Rond-point'): return 'route'
        if p.get('piste_dfci'): return 'dfci'
        if n == 'Route empierrée': return 'piste'
        if n == 'Sentier': return 'sentier'
        return 'chemin'
    R = []
    for f in roads:
        p = f['properties']
        nom = p.get('cpx_numero') or p.get('nom_voie_ban_gauche') or p.get('nom_collaboratif_gauche') or ''
        for line in walk_lines(f['geometry']):
            pts = simplify([loc(q) for q in line], 2.0)
            R.append({'k': kind(p), 'n': nom, 'g': p.get('gabarit_dfci') or '', 'acc': p.get('acces_vehicule_leger') or '', 'p': pts})
    # pistes DFCI du cartoguide (traits rouge et noir releves sur les captures recalees) : score >= 0,35
    sc_p = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'pistes_dfci_cartoguide.json')
    if os.path.exists(sc_p):
        sc = json.load(open(sc_p))
        for i, r in enumerate(R):
            if sc.get(str(i), 0) >= 0.35 and r['k'] != 'route': r['k'] = 'dfci'
    HY = []
    for f in load(src, 'hydro_lignes'):
        p = f['properties']
        for line in walk_lines(f['geometry']):
            HY.append({'k': 'canal' if p['nature'] == 'Canal' else 'ruisseau', 'n': p.get('cpx_toponyme_de_cours_d_eau') or '', 'p': simplify([loc(q) for q in line], 2.0)})
    B = []
    for f in load(src, 'batiments'):
        for poly in walk_rings(f['geometry']):
            ring = simplify([loc(q) for q in poly[0]], 1.0)
            if len(ring) >= 3: B.append({'u': f['properties'].get('usage_1') or '', 'p': ring})
    LD = []
    for f in load(src, 'lieux_dits') + load(src, 'habitat'):
        p = f['properties']; g = f['geometry']
        if g['type'] == 'Point': c = g['coordinates']
        else:
            pts = [q for poly in walk_rings(g) for q in poly[0]]
            c = [sum(q[0] for q in pts) / len(pts), sum(q[1] for q in pts) / len(pts)]
        if p.get('toponyme'): LD.append({'n': p['toponyme'], 'k': 'hameau' if 'importance' in p or p.get('nature') in ('Lieu-dit habité', 'Hameau', 'Quartier', 'Ville', 'Village') else 'lieu-dit', 'p': loc(c)})
    PS = []
    for f in load(src, 'activites'):
        p = f['properties']; g = f['geometry']
        pts = [q for poly in walk_rings(g) for q in poly[0]] or [g['coordinates']]
        c = [sum(q[0] for q in pts) / len(pts), sum(q[1] for q in pts) / len(pts)]
        PS.append({'n': p.get('toponyme') or p.get('nature'), 'k': p.get('nature'), 'p': loc(c)})
    EL = []
    for f in load(src, 'lignes_elec'):
        for line in walk_lines(f['geometry']):
            EL.append({'v': f['properties'].get('voltage'), 'p': simplify([loc(q) for q in line], 5.0)})
    PE = []
    for f in load(src, 'detail_hydro') + load(src, 'reservoirs'):
        g = f['geometry']; pts = [q for poly in walk_rings(g) for q in poly[0]] or [g['coordinates']]
        c = [sum(q[0] for q in pts) / len(pts), sum(q[1] for q in pts) / len(pts)]
        PE.append({'k': f['properties'].get('nature'), 'p': loc(c)})
    COM = []
    for f in load(src, 'communes'):
        for poly in walk_rings(f['geometry']):
            COM.append({'n': f['properties'].get('nom_officiel'), 'p': simplify([loc(q) for q in poly[0]], 10.0)})

    # points d'eau du cartoguide DFCI (releves sur les captures recalees, cf. fdf/carte/README.md)
    pe_cg = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'points_eau_cartoguide.json')
    PEC = [{'n': q['n'], 'forme': q['forme'], 'p': [q['X'] - X0, q['Y'] - Y0], 'dfci': q['dfci']} for q in json.load(open(pe_cg))] if os.path.exists(pe_cg) else []
    meta = {'nom': 'Salles sud (Gironde) – Caudos, Bilos, Lugos', 'lambert93': [X0, Y0, X1, Y1], 'res': RES, 'w': W, 'h': H,
            'couches': ['combustible', 'hauteur_dm', 'altitude_x5'],
            'combustibles': [{'id': i, 'code': c, 'nom': n, 'couleur': col} for i, c, n, col in FUELS],
            'sources': 'IGN BD Forêt V2, BD TOPO V3, LiDAR HD (MNH), RGE ALTI, BD ORTHO – Géoplateforme',
            'dfci': {'origine_l93': [317977, 6135925], 'pas': 400, 'note': 'carroyage du cartoguide SDIS 33 : colonne = 2 lettres (AA = 0), rangee = nombre'},
            'points_eau': PEC, 'routes': R, 'hydro': HY, 'bati': B, 'lieux': LD, 'sensibles': PS, 'elec': EL, 'eau': PE, 'communes': COM}
    json.dump(meta, open(os.path.join(out, 'carte.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
    ortho.save(os.path.join(out, 'ortho.jpg'), quality=72)
    # apercu des combustibles
    pal = np.array([[int(c[1:3], 16), int(c[3:5], 16), int(c[5:7], 16)] for _, _, _, c in FUELS], np.uint8)
    Image.fromarray(pal[fuel]).save(os.path.join(out, '_apercu_combustibles.png'))
    cnt = np.bincount(fuel.ravel(), minlength=len(FUELS))
    for i, c, n, _ in FUELS: print(f'{c} {n:40s} {cnt[i] / fuel.size * 100:5.1f} %')
    for n in ['carte.json', 'raster.bin.gz', 'ortho.jpg']: print(n, round(os.path.getsize(os.path.join(out, n)) / 1e6, 2), 'Mo')


if __name__ == '__main__':
    main()
