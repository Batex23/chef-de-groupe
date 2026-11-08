"""Generateur des cas FDS de calibrage - Feu d'appartement R+3 (T4).

Produit un fichier .fds par scenario. Toute la geometrie est en multiples de 0,2 m
(taille de maille). Les ouvertures sont des segments de mur laisses vides ; les
ouvrants (portes, vitrages, exutoire) sont des OBST supprimes quand leur DEVC
passe de T a F (INITIAL_STATE=T, cf. guide FDS 'Creating and Removing Obstructions').
"""
import os, sys

OUT = sys.argv[1] if len(sys.argv) > 1 else "."
RAPIDE = len(sys.argv) > 2 and sys.argv[2] == "rapide"
NEVER = 1.0e6
T_END = 1800.0
if len(sys.argv) > 2 and sys.argv[2] == "rapide": T_END = 1200.0

# --------------------------------------------------------------------------
# Scenarios de calibrage (temps en s depuis l'eclosion)
# --------------------------------------------------------------------------
BASE = dict(
    t_porte_paliere=600.0,   # ouverture par les SP pour l'attaque
    t_porte_immeuble=540.0,  # arrivee SP au RDC
    t_porte_ch1=NEVER,       # chambre 1 fermee (victime confinee)
    t_porte_ch2=0.0,         # chambre 2 ouverte
    t_porte_ch3=NEVER,       # chambre 3 fermee
    t_exutoire=NEVER,        # pas de desenfumage
    tmp_bris_vitre=400.0,    # critere simplifie de bris des vitrages (degC gaz)
    t_attaque=None,          # pas d'extinction
    t_vpp=None,              # pas de ventilation operationnelle
    vpp_vel=10.0,            # m/s au soufflage du ventilateur (face 0,8 x 0,8 m => 6,4 m3/s souffles)
)
SCENARIOS = {
    "R0_BASE": dict(),
    "R1_PORTE_PALIERE_OUVERTE": dict(t_porte_paliere=90.0),
    "R2_PORTE_OUVERTE_EXUTOIRE": dict(t_porte_paliere=90.0, t_exutoire=660.0),
    "R3_SOUS_VENTILE": dict(tmp_bris_vitre=NEVER),
    "R4_ATTAQUE": dict(t_attaque=660.0),
    "R5_CHAMBRE1_OUVERTE": dict(t_porte_ch1=0.0),
    # Ventilation operationnelle (VPP thermique devant la porte d'immeuble)
    "R6_VPP_APRES_ATTAQUE": dict(t_porte_paliere=90.0, t_attaque=660.0, t_exutoire=720.0, t_vpp=840.0),
    "R7_VPP_ATTAQUE": dict(t_porte_paliere=90.0, t_attaque=720.0, t_exutoire=640.0, t_vpp=660.0),
    "R8_VPP_SANS_EXUTOIRE": dict(t_porte_paliere=90.0, t_attaque=660.0, t_vpp=840.0),
}

# --------------------------------------------------------------------------
# Geometrie (z=0 : plancher du R+3 ; hauteur sous plafond 2,6 m ; RDC a z=-7,8)
# --------------------------------------------------------------------------
H = 2.6
DOOR_H = 2.0

def f(v):
    return f"{v:.2f}"

def xb(x1, x2, y1, y2, z1, z2):
    return ",".join(f(v) for v in (x1, x2, y1, y2, z1, z2))

def wall_x(y1, y2, x1, x2, z1, z2, openings):
    """Mur parallele a l'axe x (epaisseur y1-y2), de x1 a x2, avec ouvertures
    [(xa, xb, za, zb)]. Renvoie des boites pleines."""
    boxes, cur = [], x1
    for (a, b, za, zb) in sorted(openings):
        if a > cur:
            boxes.append((cur, a, y1, y2, z1, z2))
        if za > z1:
            boxes.append((a, b, y1, y2, z1, za))
        if zb < z2:
            boxes.append((a, b, y1, y2, zb, z2))
        cur = b
    if cur < x2:
        boxes.append((cur, x2, y1, y2, z1, z2))
    return boxes

def wall_y(x1, x2, y1, y2, z1, z2, openings):
    """Mur parallele a l'axe y (epaisseur x1-x2), ouvertures [(ya, yb, za, zb)]."""
    boxes, cur = [], y1
    for (a, b, za, zb) in sorted(openings):
        if a > cur:
            boxes.append((x1, x2, cur, a, z1, z2))
        if za > z1:
            boxes.append((x1, x2, a, b, z1, za))
        if zb < z2:
            boxes.append((x1, x2, a, b, zb, z2))
        cur = b
    if cur < y2:
        boxes.append((x1, x2, cur, y2, z1, z2))
    return boxes

# Fenetres facade sud (y=0..0.2) : (id, x1, x2, z1, z2, piece)
WINDOWS = [
    ("VITRE_SEJ1", 1.0, 2.4, 0.8, 2.2, "SEJ"),
    ("VITRE_SEJ2", 3.4, 4.8, 0.8, 2.2, "SEJ"),
    ("VITRE_CUI", 6.4, 7.6, 1.0, 2.2, "CUI"),
    ("VITRE_CH1", 9.0, 10.2, 0.8, 2.2, "CH1"),
]
# Portes interieures sur mur A (y 4.6-4.8) et mur B (y 5.8-6.0)
# (id, x1, x2, y_mur1, y_mur2, cle_scenario ou None = baie libre)
DOORS = [
    ("PORTE_SEJ", 3.6, 5.2, 4.6, 4.8, None),
    ("PORTE_CUI", 6.4, 7.2, 4.6, 4.8, None),
    ("PORTE_CH1", 9.0, 9.8, 4.6, 4.8, "t_porte_ch1"),
    ("PORTE_CH2", 2.6, 3.4, 5.8, 6.0, "t_porte_ch2"),
    ("PORTE_SDB", 4.4, 5.2, 5.8, 6.0, None),
    ("PORTE_CH3", 7.0, 7.8, 5.8, 6.0, "t_porte_ch3"),
]
# Pieces : (code, nom, x1, x2, y1, y2, point de mesure x, y)
ROOMS = [
    ("SEJ", "Sejour (foyer)", 0.2, 5.6, 0.2, 4.6, 4.0, 3.0),
    ("CUI", "Cuisine", 5.8, 8.2, 0.2, 4.6, 7.0, 2.6),
    ("CH1", "Chambre 1 (victime)", 8.4, 10.8, 0.2, 4.6, 9.6, 2.6),
    ("COU", "Couloir / entree", 0.2, 10.8, 4.8, 5.8, 6.1, 5.3),
    ("CH2", "Chambre 2", 0.2, 3.8, 6.0, 8.4, 1.9, 7.3),
    ("SDB", "Salle de bains", 4.0, 6.0, 6.0, 8.4, 5.1, 7.3),
    ("CH3", "Chambre 3", 6.2, 10.8, 6.0, 8.4, 8.5, 7.3),
]
# Cage d'escalier (palier + volee, sans marches modelisees)
SH_X1, SH_X2, SH_Y1, SH_Y2, SH_Z1, SH_Z2 = -3.0, 0.0, 5.0, 8.6, -7.8, 5.4
LEVELS = [("RDC", -7.8), ("R1", -5.2), ("R2", -2.6), ("R3", 0.0), ("R4", 2.6)]
EXU = (-2.0, -1.0, 6.4, 7.4)          # exutoire 1 m2 en tete de cage
ENTREE = (-2.0, -0.8, -7.8, -5.6)      # porte d'immeuble RDC (x1,x2,z1,z2)
PALIER = (5.0, 5.8, 0.0, DOOR_H)       # porte paliere (y1,y2,z1,z2) sur mur x=0..0.2


def build(name, sc):
    p = dict(BASE); p.update(sc)
    L = []
    w = L.append
    w(f"&HEAD CHID='{name}', TITLE='Calibrage jeu CDG - feu appartement T4 au R+3 - {name}' /")
    w("")
    w("! =====================================================================")
    if RAPIDE:
        w("! MAILLAGES (cellules 0,2 m) - 5 maillages => lancer avec 5 processus MPI")
        w("! Decoupes placees hors de toute porte ou fenetre (x = 5,8 m).")
        w("! =====================================================================")
        w("&MESH ID='APPART_O', IJK=29,43,13, XB=0.0,5.8,0.0,8.6,0.0,2.6 /")
        w("&MESH ID='APPART_E', IJK=26,43,13, XB=5.8,11.0,0.0,8.6,0.0,2.6 /")
        w("&MESH ID='EXT_O', IJK=29,10,26, XB=0.0,5.8,-2.0,0.0,0.0,5.2 /")
        w("&MESH ID='EXT_E', IJK=26,10,26, XB=5.8,11.0,-2.0,0.0,0.0,5.2 /")
        w("&MESH ID='CAGE', IJK=15,18,66, XB=-3.0,0.0,5.0,8.6,-7.8,5.4 /")
        if p["t_vpp"] is not None:
            w("&MESH ID='PARVIS', IJK=15,13,14, XB=-3.0,0.0,8.6,11.2,-7.8,-5.0 / ! devant la porte d'immeuble (VPP) => 6 processus MPI")
    else:
        w("! MAILLAGES (cellules 0,2 m) - 3 maillages => lancer avec 3 processus MPI")
        w("! =====================================================================")
        w("&MESH ID='APPART', IJK=55,43,13, XB=0.0,11.0,0.0,8.6,0.0,2.6 /")
        w("&MESH ID='EXTERIEUR', IJK=55,10,26, XB=0.0,11.0,-2.0,0.0,0.0,5.2 /")
        w("&MESH ID='CAGE', IJK=15,18,66, XB=-3.0,0.0,5.0,8.6,-7.8,5.4 /")
        if p["t_vpp"] is not None:
            w("&MESH ID='PARVIS', IJK=15,13,14, XB=-3.0,0.0,8.6,11.2,-7.8,-5.0 / ! devant la porte d'immeuble (VPP) => 4 processus MPI")
    w("")
    w(f"&TIME T_END={T_END:.1f} /")
    w("&DUMP DT_DEVC=2.0, DT_HRR=2.0, DT_SLCF=10.0, DT_BNDF=30.0," if RAPIDE else "&DUMP DT_DEVC=1.0, DT_HRR=1.0, DT_SLCF=5.0, DT_BNDF=10.0,")
    # Volumes complets pour le jeu (fichiers .q) : toutes les 20 s, temperature, visibilite, CO, O2 et puissance
    # volumique (flammes). Fumee 3D (.s3d) en plus, comme Smokeview.
    w("      SMOKE3D=T, DT_PL3D=20.0, WRITE_XYZ=T,")
    w("      PLOT3D_QUANTITY(1:5)='TEMPERATURE','VISIBILITY','VOLUME FRACTION','VOLUME FRACTION','HRRPUV',")
    w("      PLOT3D_SPEC_ID(3:4)='CARBON MONOXIDE','OXYGEN' /")
    w("&MISC TMPA=20.0, HUMIDITY=50.0 /")
    w("")
    w("! =====================================================================")
    w("! COMBUSTION : mobilier type mousse polyurethane (chimie simplifiee)")
    w("! =====================================================================")
    w("&REAC ID='MOBILIER', FUEL='MOBILIER', C=6.3, H=7.1, O=2.1, N=1.0,")
    w("      HEAT_OF_COMBUSTION=25000.0, SOOT_YIELD=0.10, CO_YIELD=0.04, HCN_YIELD=0.01 /")
    w("")
    w("! =====================================================================")
    w("! MATERIAUX")
    w("! =====================================================================")
    w("&MATL ID='BETON', CONDUCTIVITY=1.4, SPECIFIC_HEAT=0.88, DENSITY=2300.0, EMISSIVITY=0.9 /")
    w("&MATL ID='PLATRE', CONDUCTIVITY=0.25, SPECIFIC_HEAT=1.0, DENSITY=800.0, EMISSIVITY=0.9 /")
    w("&MATL ID='VERRE', CONDUCTIVITY=0.8, SPECIFIC_HEAT=0.84, DENSITY=2500.0, EMISSIVITY=0.9 /")
    w("&MATL ID='BOIS', CONDUCTIVITY=0.15, SPECIFIC_HEAT=1.6, DENSITY=600.0, EMISSIVITY=0.9 /")
    w("&SURF ID='BETON', MATL_ID='BETON', THICKNESS=0.20, COLOR='GRAY 80', DEFAULT=T /")
    w("&SURF ID='CLOISON', MATL_ID='PLATRE', THICKNESS=0.07, COLOR='BEIGE' /")
    w("&SURF ID='VERRE', MATL_ID='VERRE', THICKNESS=0.004, COLOR='CYAN', TRANSPARENCY=0.4 /")
    w("&SURF ID='PORTE', MATL_ID='BOIS', THICKNESS=0.04, COLOR='BROWN' /")
    w("")
    w("! =====================================================================")
    w("! FOYER : canape du sejour, 2 m2, croissance t2 rapide (alpha=0,047 kW/s2)")
    w("! Pic 3 MW atteint vers 250 s (limite ensuite par l'air disponible).")
    w("! La puissance est IMPOSEE : FDS ne predit pas ici l'embrasement des autres")
    w("! objets. On calibre le transport fumees/chaleur ; la croissance du feu")
    w("! sera calibree a part.")
    w("! =====================================================================")
    w("&SURF ID='CANAPE', HRRPUA=1500.0, RAMP_Q='FEU', COLOR='RED' /")
    ramp = [(0, 0.0), (60, 0.056), (120, 0.226), (180, 0.508), (253, 1.0), (900, 1.0), (1500, 0.2), (1800, 0.1)]
    if p["t_attaque"] is not None:
        ta = p["t_attaque"]
        ramp = [r for r in ramp if r[0] < ta] + [(ta, 1.0), (ta + 120, 0.05), (T_END, 0.0)]
        w(f"! Attaque des SP a t={ta:.0f} s : decroissance imposee a 5 % en 120 s")
        w("! (approximation de l'extinction, l'eau n'est pas simulee).")
    for t, v in ramp:
        w(f"&RAMP ID='FEU', T={t:.1f}, F={v:.3f} /")
    w("&OBST ID='CANAPE', XB=0.6,2.6,0.6,1.6,0.0,0.4, SURF_IDS='CANAPE','BETON','BETON' /")
    w("")

    # ---- murs de l'appartement
    w("! =====================================================================")
    w("! APPARTEMENT T4 (80 m2) - murs 0,2 m")
    w("! =====================================================================")
    boxes = []
    boxes += [("FACADE_SUD", b, "BETON") for b in
              wall_x(0.0, 0.2, 0.0, 11.0, 0.0, H, [(a, b, za, zb) for (_, a, b, za, zb, _) in WINDOWS])]
    boxes += [("FACADE_NORD", (0.0, 11.0, 8.4, 8.6, 0.0, H), "BETON")]
    boxes += [("MUR_PALIER", b, "BETON") for b in
              wall_y(0.0, 0.2, 0.2, 8.4, 0.0, H, [PALIER])]
    boxes += [("MUR_EST", (10.8, 11.0, 0.2, 8.4, 0.0, H), "BETON")]
    for (wy1, wy2, label) in [(4.6, 4.8, "CLOISON_A"), (5.8, 6.0, "CLOISON_B")]:
        ops = [(a, b, 0.0, DOOR_H) for (_, a, b, y1, _, _) in DOORS if y1 == wy1]
        boxes += [(label, bx, "CLOISON") for bx in wall_x(wy1, wy2, 0.2, 10.8, 0.0, H, ops)]
    boxes += [("CLOISON_SEJ_CUI", (5.6, 5.8, 0.2, 4.6, 0.0, H), "CLOISON"),
              ("CLOISON_CUI_CH1", (8.2, 8.4, 0.2, 4.6, 0.0, H), "CLOISON"),
              ("CLOISON_CH2_SDB", (3.8, 4.0, 6.0, 8.4, 0.0, H), "CLOISON"),
              ("CLOISON_SDB_CH3", (6.0, 6.2, 6.0, 8.4, 0.0, H), "CLOISON")]
    for (lab, b, s) in boxes:
        w(f"&OBST ID='{lab}', XB={xb(*b)}, SURF_ID='{s}' /")
    w("")

    # ---- ouvrants
    w("! =====================================================================")
    w("! OUVRANTS PILOTES (OBST supprime quand le DEVC passe de T a F)")
    w(f"! Valeur {NEVER:.0e} = ne s'ouvre jamais pendant la simulation")
    w("! =====================================================================")
    def timer(dev_id, t, xyz, comment):
        w(f"&DEVC ID='{dev_id}', QUANTITY='TIME', SETPOINT={t:.1f}, INITIAL_STATE=T, XYZ={xyz} / ! {comment}")
    # porte paliere
    timer("OUV_PORTE_PALIERE", p["t_porte_paliere"], "0.10,5.40,1.00", "porte paliere appartement")
    w(f"&OBST ID='PORTE_PALIERE', XB={xb(0.0, 0.2, PALIER[0], PALIER[1], 0.0, DOOR_H)}, SURF_ID='PORTE', DEVC_ID='OUV_PORTE_PALIERE' /")
    for (did, a, b, y1, y2, key) in DOORS:
        if key is None:
            continue
        timer("OUV_" + did, p[key], f"{(a+b)/2:.2f},{(y1+y2)/2:.2f},1.00", did.lower())
        w(f"&OBST ID='{did}', XB={xb(a, b, y1, y2, 0.0, DOOR_H)}, SURF_ID='PORTE', DEVC_ID='OUV_{did}' /")
    # vitrages : bris sur temperature du gaz cote interieur, en partie haute
    for (vid, a, b, za, zb, room) in WINDOWS:
        w(f"&DEVC ID='BRIS_{vid}', QUANTITY='TEMPERATURE', SETPOINT={p['tmp_bris_vitre']:.1f}, INITIAL_STATE=T, "
          f"XYZ={(a+b)/2:.2f},0.30,{zb-0.1:.2f} / ! bris vitrage {room}")
        w(f"&OBST ID='{vid}', XB={xb(a, b, 0.0, 0.2, za, zb)}, SURF_ID='VERRE', DEVC_ID='BRIS_{vid}' /")
    w("")

    # ---- exterieur
    w("! =====================================================================")
    w("! EXTERIEUR DEVANT LA FACADE (panache sortant par les fenetres)")
    w("! =====================================================================")
    for v in [(0.0, 11.0, -2.0, -2.0, 0.0, 5.2), (0.0, 0.0, -2.0, 0.0, 0.0, 5.2),
              (11.0, 11.0, -2.0, 0.0, 0.0, 5.2), (0.0, 11.0, -2.0, 0.0, 0.0, 0.0),
              (0.0, 11.0, -2.0, 0.0, 5.2, 5.2)]:
        w(f"&VENT XB={xb(*v)}, SURF_ID='OPEN' /")
    w("")

    # ---- cage d'escalier
    w("! =====================================================================")
    w("! CAGE D'ESCALIER RDC -> R+4 (marches non modelisees), palier R+3 inclus")
    w("! Porte d'immeuble au RDC, exutoire 1 m2 en tete de cage.")
    w("! =====================================================================")
    ex1, ex2, ey1, ey2 = EXU
    slab = [(SH_X1, ex1, SH_Y1, SH_Y2), (ex2, SH_X2, SH_Y1, SH_Y2), (ex1, ex2, SH_Y1, ey1), (ex1, ex2, ey2, SH_Y2)]
    for i, (a, b, c, d) in enumerate(slab):
        w(f"&OBST ID='TOITURE_{i+1}', XB={xb(a, b, c, d, 5.2, 5.4)}, SURF_ID='BETON' /")
    timer("OUV_EXUTOIRE", p["t_exutoire"], "-1.50,6.90,5.00", "exutoire de desenfumage")
    w(f"&OBST ID='EXUTOIRE', XB={xb(ex1, ex2, ey1, ey2, 5.2, 5.4)}, SURF_ID='VERRE', DEVC_ID='OUV_EXUTOIRE' /")
    w(f"&VENT ID='EXUTOIRE_OUVERT', XB={xb(ex1, ex2, ey1, ey2, 5.4, 5.4)}, SURF_ID='OPEN' /")
    a, b, za, zb = ENTREE
    for bx in wall_x(8.4, 8.6, SH_X1, SH_X2, -7.8, -5.2, [(a, b, za, zb)]):
        w(f"&OBST ID='MUR_ENTREE', XB={xb(*bx)}, SURF_ID='BETON' /")
    timer("OUV_PORTE_IMMEUBLE", p["t_porte_immeuble"], "-1.40,8.20,-6.80", "porte d'immeuble RDC")
    w(f"&OBST ID='PORTE_IMMEUBLE', XB={xb(a, b, 8.4, 8.6, za, zb)}, SURF_ID='PORTE', DEVC_ID='OUV_PORTE_IMMEUBLE' /")
    if p["t_vpp"] is None:
        w(f"&VENT ID='ENTREE_OUVERTE', XB={xb(a, b, 8.6, 8.6, za, zb)}, SURF_ID='OPEN' /")
    else:
        tv = p["t_vpp"]
        w("")
        w("! ---------------------------------------------------------------------")
        w(f"! VENTILATION OPERATIONNELLE : VPP pose a 2 m de la porte d'immeuble, demarre a t={tv:.0f} s.")
        w("! Ventilateur represente par un caisson de 0,8 x 0,8 m dont la face cote porte souffle")
        w(f"! a {p['vpp_vel']:.0f} m/s (VEL negatif = injection). L'entrainement d'air autour du cone")
        w("! est calcule par FDS dans le maillage PARVIS, ouvert sur l'exterieur.")
        w("! Limite : la puissance du foyer est imposee, l'effet de l'apport d'air sur la combustion")
        w("! (ventilation offensive) n'est donc pas predit ; seul le transport des fumees l'est.")
        w("! ---------------------------------------------------------------------")
        w(f"&SURF ID='VPP', VEL={-p['vpp_vel']:.1f}, RAMP_V='VPP', COLOR='YELLOW' /")
        w(f"&RAMP ID='VPP', T=0.0, F=0.0 /")
        w(f"&RAMP ID='VPP', T={tv:.1f}, F=0.0 /")
        w(f"&RAMP ID='VPP', T={tv + 5:.1f}, F=1.0 /")
        w(f"&RAMP ID='VPP', T={T_END:.1f}, F=1.0 /")
        cx = (a + b) / 2
        w(f"&OBST ID='VPP', XB={xb(cx - 0.4, cx + 0.4, 10.6, 10.8, -7.6, -6.8)}, SURF_IDS='INERT','INERT','INERT' /")
        w(f"&VENT ID='VPP_SOUFFLAGE', XB={xb(cx - 0.4, cx + 0.4, 10.6, 10.6, -7.6, -6.8)}, SURF_ID='VPP' /")
        for v in [(-3.0, 0.0, 11.2, 11.2, -7.8, -5.0), (-3.0, -3.0, 8.6, 11.2, -7.8, -5.0), (0.0, 0.0, 8.6, 11.2, -7.8, -5.0),
                  (-3.0, 0.0, 8.6, 11.2, -5.0, -5.0)]:
            w(f"&VENT XB={xb(*v)}, SURF_ID='OPEN' /")
        # facade (mur) au-dessus et de part et d'autre de la porte : deja donne par MUR_ENTREE en y=8.4-8.6
        w(f"&DEVC ID='VPP_DEBIT_SOUFFLE', QUANTITY='VOLUME FLOW', XB={xb(cx - 0.6, cx + 0.6, 10.4, 10.4, -7.8, -6.6)} /")
    w("")

    # ---- mesures
    w("! =====================================================================")
    w("! MESURES - ce sont ces sorties (fichier _devc.csv) qui calibrent le jeu")
    w("! =====================================================================")
    for (code, nom, x1, x2, y1, y2, mx, my) in ROOMS:
        w(f"! --- {nom}")
        line = f"{mx:.2f},{mx:.2f},{my:.2f},{my:.2f},0.00,{H:.2f}"
        w(f"&DEVC ID='{code}_HAUTEUR_COUCHE', QUANTITY='LAYER HEIGHT', XB={line} /")
        w(f"&DEVC ID='{code}_T_COUCHE_HAUTE', QUANTITY='UPPER TEMPERATURE', XB={line} /")
        w(f"&DEVC ID='{code}_T_COUCHE_BASSE', QUANTITY='LOWER TEMPERATURE', XB={line} /")
        w(f"&DEVC ID='{code}_T_ARBRE', QUANTITY='TEMPERATURE', XB={mx:.2f},{mx:.2f},{my:.2f},{my:.2f},0.30,2.50, POINTS=5, TIME_HISTORY=T /")
        for z, tag in [(1.5, "150"), (0.3, "030")]:
            w(f"&DEVC ID='{code}_O2_{tag}', QUANTITY='VOLUME FRACTION', SPEC_ID='OXYGEN', XYZ={mx:.2f},{my:.2f},{z:.2f} /")
            w(f"&DEVC ID='{code}_CO_{tag}', QUANTITY='VOLUME FRACTION', SPEC_ID='CARBON MONOXIDE', XYZ={mx:.2f},{my:.2f},{z:.2f} /")
            w(f"&DEVC ID='{code}_CO2_{tag}', QUANTITY='VOLUME FRACTION', SPEC_ID='CARBON DIOXIDE', XYZ={mx:.2f},{my:.2f},{z:.2f} /")
            w(f"&DEVC ID='{code}_FED_{tag}', QUANTITY='FED', XYZ={mx:.2f},{my:.2f},{z:.2f} /")
        w(f"&DEVC ID='{code}_VISIBILITE_150', QUANTITY='VISIBILITY', XYZ={mx:.2f},{my:.2f},1.50 /")
        w(f"&DEVC ID='{code}_FLUX_SOL', QUANTITY='GAUGE HEAT FLUX', XYZ={mx:.2f},{my:.2f},0.00, IOR=3 /")
    w("! --- Debits a travers les ouvertures (+ et - selon le sens de l'axe)")
    planes = [(did, f"{a:.2f},{b:.2f},{y1:.2f},{y1:.2f},0.00,{DOOR_H:.2f}") for (did, a, b, y1, y2, _) in DOORS]
    planes.append(("PORTE_PALIERE", f"0.20,0.20,{PALIER[0]:.2f},{PALIER[1]:.2f},0.00,{DOOR_H:.2f}"))
    planes += [(vid, f"{a:.2f},{b:.2f},0.20,0.20,{za:.2f},{zb:.2f}") for (vid, a, b, za, zb, _) in WINDOWS]
    planes.append(("EXUTOIRE", f"{ex1:.2f},{ex2:.2f},{ey1:.2f},{ey2:.2f},5.20,5.20"))
    a, b, za, zb = ENTREE
    planes.append(("PORTE_IMMEUBLE", f"{a:.2f},{b:.2f},8.40,8.40,{za:.2f},{zb:.2f}"))
    for (pid, pxb) in planes:
        w(f"&DEVC ID='DEBIT_{pid}_PLUS', QUANTITY='VOLUME FLOW +', XB={pxb} /")
        w(f"&DEVC ID='DEBIT_{pid}_MOINS', QUANTITY='VOLUME FLOW -', XB={pxb} /")
        w(f"&DEVC ID='CHALEUR_{pid}', QUANTITY='HEAT FLOW', XB={pxb} /")
    w("! --- Cage d'escalier : un point par niveau a 1,5 m + arbre sur toute la hauteur")
    for (lv, z0) in LEVELS:
        z = z0 + 1.5
        w(f"&DEVC ID='CAGE_{lv}_T', QUANTITY='TEMPERATURE', XYZ=-1.50,6.80,{z:.2f} /")
        w(f"&DEVC ID='CAGE_{lv}_VISIBILITE', QUANTITY='VISIBILITY', XYZ=-1.50,6.80,{z:.2f} /")
        w(f"&DEVC ID='CAGE_{lv}_CO', QUANTITY='VOLUME FRACTION', SPEC_ID='CARBON MONOXIDE', XYZ=-1.50,6.80,{z:.2f} /")
        w(f"&DEVC ID='CAGE_{lv}_FED', QUANTITY='FED', XYZ=-1.50,6.80,{z:.2f} /")
    w("&DEVC ID='CAGE_T_ARBRE', QUANTITY='TEMPERATURE', XB=-1.50,-1.50,6.80,6.80,-7.50,5.10, POINTS=26, TIME_HISTORY=T /")
    w("&DEVC ID='CAGE_HAUTEUR_COUCHE', QUANTITY='LAYER HEIGHT', XB=-1.50,-1.50,6.80,6.80,-7.80,5.20 /")
    w("! --- Facade : temperature devant la fenetre du R+4 (propagation exterieure)")
    w("&DEVC ID='FACADE_R4_T', QUANTITY='TEMPERATURE', XYZ=1.70,-0.30,3.80 /")
    w("&DEVC ID='FACADE_R4_FLUX', QUANTITY='GAUGE HEAT FLUX', XYZ=1.70,0.00,3.80, IOR=-2 /")
    w("")
    w("! =====================================================================")
    w("! VISUALISATION (Smokeview) - facultatif pour moi, utile pour toi")
    w("! =====================================================================")
    for q in ["TEMPERATURE", "VISIBILITY"]:
        if RAPIDE and q == "VISIBILITY": continue
        w(f"&SLCF PBZ=1.50, QUANTITY='{q}' /")
        w(f"&SLCF PBY=2.40, QUANTITY='{q}' /")
        w(f"&SLCF PBX=-1.50, QUANTITY='{q}' /")
    w("&SLCF PBZ=1.50, QUANTITY='VOLUME FRACTION', SPEC_ID='CARBON MONOXIDE' /")
    w("&SLCF PBZ=1.50, QUANTITY='VELOCITY', VECTOR=T /")
    w("&SLCF PBY=5.30, QUANTITY='TEMPERATURE', VECTOR=T /")
    if not RAPIDE: w("&BNDF QUANTITY='WALL TEMPERATURE' /")
    w("")
    w("&TAIL /")
    return "\n".join(L) + "\n"


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    for name, sc in SCENARIOS.items():
        with open(os.path.join(OUT, name + ".fds"), "w", encoding="ascii", errors="replace") as fh:
            fh.write(build(name, sc))
        print("ecrit", name)
