"""The places a drone act cites, placed from local data (lot R4.2): an arrondissement by its
outline, a street widened by 50 m, a square a circle of 250 m; a name found far apart in the
commune, or outside it, is cited only. Small frames stand for Admin Express and the map's
OSM build."""

from __future__ import annotations

import geopandas as gpd
import pytest
import shapely
from shapely.geometry import LineString, Point, box

import lacarte_registre as registre
from lacarte_registre import lieux

L93 = "EPSG:2154"
CONF = lieux.regles(registre.RULES)


@pytest.fixture
def local(monkeypatch):
    town = box(650000, 6860000, 660000, 6870000)  # a 10 km square commune, Lambert-93
    wgs = gpd.GeoSeries([town], crs=L93).to_crs("OGC:CRS84").iloc[0]
    arr = gpd.GeoDataFrame(
        {"code_insee": ["75114"], "geometrie": [wgs]}, geometry="geometrie", crs="OGC:CRS84"
    ).set_index("code_insee")
    com = gpd.GeoDataFrame(
        {"code_insee": ["75056"], "geometrie": [wgs]}, geometry="geometrie", crs="OGC:CRS84"
    ).set_index("code_insee")
    ways = gpd.GeoDataFrame(
        {
            "name": [
                "Boulevard Raspail",
                "Boulevard Raspail",
                "Rue Double",
                "Rue Double",
                "Place Denfert-Rochereau",
                "Rue Dehors",
            ],
            "highway": ["secondary"] * 6,
        },  # fmt: skip
        geometry=[
            LineString([(651000, 6861000), (651000, 6862000)]),
            LineString([(651000, 6862000), (651100, 6863000)]),
            LineString([(650100, 6860100), (650200, 6860100)]),
            LineString([(659800, 6869800), (659900, 6869800)]),  # 9.7 km from the other
            LineString([(652000, 6862000), (652050, 6862050)]),
            LineString([(700000, 6900000), (700100, 6900000)]),
        ],
        crs=L93,
    )
    ways = ways.assign(cle=ways["name"].map(lieux.loose))
    monkeypatch.setattr(lieux, "_admin", lambda: (arr, com))
    monkeypatch.setattr(lieux, "_ways", lambda dep: ways)
    monkeypatch.setattr(lieux, "_pois", lambda dep: None)


def _area_m2(geometry):
    return gpd.GeoSeries([shapely.geometry.shape(geometry)], crs="OGC:CRS84").to_crs(L93).area[0]


def test_an_arrondissement_by_its_outline(local):
    f = lieux.placer({"texte": "14e arrondissement", "genre": "arrondissement"}, "75056", CONF)
    assert f["id"] == "75114" and f["geometry"]["type"] == "Polygon"
    assert lieux.arrondissement("2e arrondissement", "13055") == "13202"
    assert lieux.arrondissement("3e arrondissement", "69123") == "69383"
    assert lieux.arrondissement("25e arrondissement", "75056") is None


def test_a_street_widened_a_square_a_circle(local):
    f = lieux.placer({"texte": "boulevard Raspail", "genre": "rue"}, "75056", CONF)
    # ~2 km of street × 100 m, the caps included
    assert 1.9e5 < _area_m2(f["geometry"]) < 2.4e5
    f = lieux.placer({"texte": "place Denfert-Rochereau", "genre": "place"}, "75056", CONF)
    assert abs(_area_m2(f["geometry"]) - 3.14159 * 250**2) < 3000


def test_an_ambiguous_or_absent_place_is_cited_only(local):
    rows = [
        {
            "lieux": [
                {"texte": "rue Double", "genre": "rue"},  # two streets 6 km apart
                {"texte": "rue Dehors", "genre": "rue"},  # outside the commune
                {"texte": "aux abords des lycées", "genre": "autre"},
                {"texte": "boulevard Raspail", "genre": "rue"},
            ]
        }
    ]
    shapes = lieux.formes(rows, "75056", CONF)
    assert list(shapes) == ["75056:rue:boulevard-raspail"]
    assert [x.get("forme") for x in rows[0]["lieux"]] == [
        None,
        None,
        None,
        "75056:rue:boulevard-raspail",
    ]
    assert shapes["75056:rue:boulevard-raspail"]["approximatif"] is True
    _ = Point
