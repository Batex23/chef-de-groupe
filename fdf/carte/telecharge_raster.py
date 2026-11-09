#!/usr/bin/env python3
"""Rasters IGN du secteur (WMS-R Geoplateforme, Lambert-93) : hauteur de vegetation LiDAR HD (MNH),
altitude (MNT) et photo aerienne.
Usage : python3 telecharge_raster.py <dossier_sortie>"""
import sys, os, urllib.request, urllib.parse
import numpy as np
X0, X1, Y0, Y1 = 381000, 393600, 6382000, 6392800      # emprise du jeu (12,6 x 10,8 km)
URL = 'https://data.geopf.fr/wms-r'

def getmap(layer, x0, y0, x1, y1, w, h, fmt, style=''):
    q = {'SERVICE': 'WMS', 'VERSION': '1.3.0', 'REQUEST': 'GetMap', 'LAYERS': layer, 'STYLES': style, 'CRS': 'EPSG:2154',
         'BBOX': f'{x0},{y0},{x1},{y1}', 'WIDTH': w, 'HEIGHT': h, 'FORMAT': fmt}
    with urllib.request.urlopen(URL + '?' + urllib.parse.urlencode(q), timeout=300) as r: return r.read()

def grid(layer, res, nt=2):
    W, H = round((X1 - X0) / res), round((Y1 - Y0) / res)
    out = np.zeros((H, W), np.float32)
    for ty in range(nt):
        for tx in range(nt):
            c0, c1 = tx * W // nt, (tx + 1) * W // nt; r0, r1 = ty * H // nt, (ty + 1) * H // nt
            b = getmap(layer, X0 + c0 * res, Y1 - r1 * res, X0 + c1 * res, Y1 - r0 * res, c1 - c0, r1 - r0, 'image/x-bil;bits=32')
            out[r0:r1, c0:c1] = np.frombuffer(b, '<f4').reshape(r1 - r0, c1 - c0)
    return out          # ligne 0 = nord

if __name__ == '__main__':
    out = sys.argv[1]; os.makedirs(out, exist_ok=True)
    mnh = grid('IGNF_LIDAR-HD_MNH_ELEVATION.ELEVATIONGRIDCOVERAGE.LAMB93', 5, 2); np.save(os.path.join(out, 'mnh_5m.npy'), mnh)
    print('MNH', mnh.shape, np.nanpercentile(mnh, [1, 50, 99]))
    mnt = grid('ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES', 20, 1); np.save(os.path.join(out, 'mnt_20m.npy'), mnt)
    print('MNT', mnt.shape, np.nanpercentile(mnt, [1, 50, 99]))
    W, H = round((X1 - X0) / 5), round((Y1 - Y0) / 5)
    open(os.path.join(out, 'ortho_5m.jpg'), 'wb').write(getmap('HR.ORTHOIMAGERY.ORTHOPHOTOS', X0, Y0, X1, Y1, W, H, 'image/jpeg'))
    print('ortho ok')
