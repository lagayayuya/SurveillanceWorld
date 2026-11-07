"""The outlines of the home's map (geo.py): three made-up départements around Lyon that share
their borders, an islet, an overseas one."""

from __future__ import annotations

import re

import geopandas as gpd
import shapely

import lacarte_registre as registre
from lacarte_registre import geo

CONF = geo.rules(registre.RULES / "registre_geo.yaml")


def _layer() -> gpd.GeoDataFrame:
    a = shapely.box(4.0, 45.0, 5.0, 46.0)
    b = shapely.box(5.0, 45.0, 6.0, 46.0)
    c = shapely.MultiPolygon([shapely.box(4.0, 44.0, 6.0, 45.0),
                              shapely.box(3.0, 44.0, 3.0001, 44.0001)])  # fmt: skip
    over = shapely.box(55.2, -21.4, 55.8, -20.9)
    return gpd.GeoDataFrame(
        {"code_insee": ["69", "01", "38", "974"],
         "nom_officiel": ["Rhône", "Ain", "Isère", "La Réunion"]},
        geometry=[a, b, c, over], crs="OGC:CRS84",
    )  # fmt: skip


def test_the_departements_drawn_in_the_home_map_with_france_and_the_overseas_listed():
    out = geo.departements(_layer(), CONF)
    assert set(out["departements"]) == {"01", "38", "69"}
    assert out["outre_mer"] == [{"code": "974", "nom": "La Réunion"}]
    assert (out["largeur"], out["hauteur"]) == (660, 640)
    assert out["licence"] == "Licence Ouverte 2.0" and "IGN" in out["attribution"]
    nums = [
        float(x) for d in out["departements"].values() for x in re.findall(r"-?\d+\.\d", d["d"])
    ]
    assert min(nums) >= 0 and max(nums) <= 660
    # the islet, far smaller than a pixel and touching no one, is not drawn: one ring
    assert out["departements"]["38"]["d"].count("M") == 1
    # France is one outline: the three share their borders
    assert out["france"].count("M") == 1
    assert out["departements"]["69"]["nom"] == "Rhône"


def test_a_part_on_a_neighbour_s_border_stays_however_small():
    a = shapely.box(0, 0, 10, 10)
    tiny = shapely.box(10, 0, 10.001, 0.001)  # touches a, smaller than the bound
    b = shapely.MultiPolygon([shapely.box(20, 0, 30, 10), tiny])
    kept = geo.sans_ilots([a, b], min_area=1.0)
    assert len(kept[1].geoms) == 2
    alone = shapely.MultiPolygon([shapely.box(20, 0, 30, 10), shapely.box(50, 50, 50.1, 50.1)])
    assert kept[0] == a and geo.sans_ilots([a, alone], 1.0)[1].geom_type == "Polygon"
