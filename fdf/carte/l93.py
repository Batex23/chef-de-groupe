"""Conversion WGS84 <-> Lambert-93 (formules IGN, sans dependance)."""
import math
A, E = 6378137.0, 0.0818191910428158
N0, C, XS, YS, L0 = 0.7256077650532670, 11754255.426096, 700000.0, 12655612.049876, math.radians(3)
def _lat_iso(phi): return math.log(math.tan(math.pi / 4 + phi / 2) * ((1 - E * math.sin(phi)) / (1 + E * math.sin(phi))) ** (E / 2))
def to_l93(lon, lat):
    L = _lat_iso(math.radians(lat)); R = C * math.exp(-N0 * L); g = N0 * (math.radians(lon) - L0)
    return XS + R * math.sin(g), YS - R * math.cos(g)
def to_wgs(x, y):
    R = math.hypot(x - XS, y - YS); g = math.atan((x - XS) / (YS - y)); lon = L0 + g / N0
    L = -math.log(R / C) / N0; phi = 2 * math.atan(math.exp(L)) - math.pi / 2
    for _ in range(10): phi = 2 * math.atan(((1 + E * math.sin(phi)) / (1 - E * math.sin(phi))) ** (E / 2) * math.exp(L)) - math.pi / 2
    return math.degrees(lon), math.degrees(phi)
