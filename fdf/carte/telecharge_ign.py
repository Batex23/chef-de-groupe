#!/usr/bin/env python3
"""Telecharge les couches IGN du secteur (WFS Geoplateforme) en GeoJSON, coordonnees Lambert-93.

Usage : python3 telecharge_ign.py <dossier_sortie>
Secteur : sud de Salles (Caudos, Bilos, Lugos, Le Pont de l'Eyre).
"""
import sys, os, json, urllib.request, urllib.parse

BBOX = (44.468, -1.010, 44.563, -0.857)       # lat min, lon min, lat max, lon max
COUCHES = {
    'foret': 'LANDCOVER.FORESTINVENTORY.V2:formation_vegetale',
    'vegetation': 'BDTOPO_V3:zone_de_vegetation',
    'routes': 'BDTOPO_V3:troncon_de_route',
    'batiments': 'BDTOPO_V3:batiment',
    'hydro_lignes': 'BDTOPO_V3:troncon_hydrographique',
    'hydro_surfaces': 'BDTOPO_V3:surface_hydrographique',
    'plans_eau': 'BDTOPO_V3:plan_d_eau',
    'reservoirs': 'BDTOPO_V3:reservoir',
    'detail_hydro': 'BDTOPO_V3:detail_hydrographique',
    'lignes_elec': 'BDTOPO_V3:ligne_electrique',
    'habitat': 'BDTOPO_V3:zone_d_habitation',
    'lieux_dits': 'BDTOPO_V3:lieu_dit_non_habite',
    'activites': 'BDTOPO_V3:zone_d_activite_ou_d_interet',
    'erp': 'BDTOPO_V3:erp',
    'voies_ferrees': 'BDTOPO_V3:troncon_de_voie_ferree',
    'communes': 'BDTOPO_V3:commune',
    'foret_publique': 'BDTOPO_V3:foret_publique',
}
URL = 'https://data.geopf.fr/wfs/ows'


def fetch(layer):
    feats, start = [], 0
    while True:
        q = {'SERVICE': 'WFS', 'VERSION': '2.0.0', 'REQUEST': 'GetFeature', 'TYPENAMES': layer,
             'OUTPUTFORMAT': 'application/json', 'SRSNAME': 'EPSG:2154', 'COUNT': 5000, 'STARTINDEX': start,
             'BBOX': '%f,%f,%f,%f,urn:ogc:def:crs:EPSG::4326' % BBOX}
        with urllib.request.urlopen(URL + '?' + urllib.parse.urlencode(q), timeout=180) as r:
            d = json.load(r)
        feats += d['features']
        if len(d['features']) < 5000: break
        start += 5000
    return feats


if __name__ == '__main__':
    out = sys.argv[1]; os.makedirs(out, exist_ok=True)
    for k, layer in COUCHES.items():
        try:
            f = fetch(layer)
            json.dump({'type': 'FeatureCollection', 'features': f}, open(os.path.join(out, k + '.geojson'), 'w'))
            print(k, len(f))
        except Exception as e:
            print(k, 'ECHEC', e)
