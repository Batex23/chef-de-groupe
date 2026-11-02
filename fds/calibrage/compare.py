"""Compare les grandeurs du moteur du jeu avec les DEVC FDS d'un cas.
Usage : python3 compare.py <devc_fds.csv> <jeu.csv> [figure.png]"""
import sys, json
import pandas as pd, numpy as np
f = pd.read_csv(sys.argv[1], skiprows=1)
g = pd.read_csv(sys.argv[2])
t = g['Time'].values
def F(col):
    return np.interp(t, f['Time'].values, f[col].values)
SERIES = []
for r in ['SEJ', 'COU', 'CH2', 'CUI', 'CH1', 'CH3', 'SDB']:
    SERIES.append((f'{r} T couche haute (°C)', F(f'{r}_T_COUCHE_HAUTE'), g[f'{r}_T_COUCHE_HAUTE'].values, 'T', r))
    SERIES.append((f'{r} hauteur de couche (m)', F(f'{r}_HAUTEUR_COUCHE'), g[f'{r}_HAUTEUR_COUCHE'].values, 'H', r))
    SERIES.append((f'{r} O2 à 1,5 m (%)', F(f'{r}_O2_150') * 100, g[f'{r}_O2_150'].values, 'O2', r))
    SERIES.append((f'{r} visibilité à 1,5 m (m)', np.minimum(F(f'{r}_VISIBILITE_150'), 30), g[f'{r}_VISIBILITE_150'].values, 'V', r))
for l in ['RDC', 'R1', 'R2', 'R3', 'R4']:
    SERIES.append((f'Cage {l} T (°C)', F(f'CAGE_{l}_T'), g[f'CAGE_{l}_T'].values, 'T', 'CAGE_' + l))
    SERIES.append((f'Cage {l} visibilité (m)', np.minimum(F(f'CAGE_{l}_VISIBILITE'), 30), g[f'CAGE_{l}_VISIBILITE'].values, 'V', 'CAGE_' + l))
    SERIES.append((f'Cage {l} CO (ppm)', F(f'CAGE_{l}_CO') * 1e6, g[f'CAGE_{l}_CO'].values, 'CO', 'CAGE_' + l))
res = {}
for name, a, b, k, z in SERIES:
    err = b - a
    res[name] = dict(k=k, z=z, rmse=float(np.sqrt(np.mean(err ** 2))), biais=float(np.mean(err)), fds_max=float(np.max(a)), jeu_max=float(np.max(b)))
if len(sys.argv) > 3:
    import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
    pick = ['SEJ T couche haute (°C)', 'SEJ hauteur de couche (m)', 'COU T couche haute (°C)', 'COU hauteur de couche (m)',
            'CH1 T couche haute (°C)', 'CH2 T couche haute (°C)', 'Cage R3 T (°C)', 'Cage R3 visibilité (m)',
            'Cage R4 visibilité (m)', 'Cage R2 visibilité (m)', 'Cage R4 CO (ppm)', 'SEJ O2 à 1,5 m (%)']
    fig, ax = plt.subplots(4, 3, figsize=(15, 13)); ax = ax.ravel()
    for i, name in enumerate(pick):
        s = next(x for x in SERIES if x[0] == name)
        ax[i].plot(t, s[1], color='#e2373f', lw=2, label='FDS'); ax[i].plot(t, s[2], color='#3a8eea', lw=2, ls='--', label='jeu')
        ax[i].set_title(name, fontsize=11); ax[i].grid(alpha=.3); ax[i].set_xlabel('temps (s)', fontsize=9)
        for x in (540, 600): ax[i].axvline(x, color='#888', lw=.8, ls=':')
    ax[0].legend()
    fig.suptitle(sys.argv[4] if len(sys.argv) > 4 else 'FDS (rouge) et moteur du jeu (bleu)', fontsize=14)
    fig.tight_layout(); fig.savefig(sys.argv[3], dpi=90)
print(json.dumps(res))
