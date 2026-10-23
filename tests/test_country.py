"""Cameras abroad and on the coast (DECISIONS 2026-10-23): France's OSM outline (its
territorial sea included) keeps a jetty's camera and leaves Monaco's; a camera outside
every commune of France goes to the nearest within rules/admin.yaml camera_rescue_max_m.
Tiny synthetic geometries, metres."""

import numpy as np
import pytest
import shapely
from conftest import PinnedRegion
from shapely import LineString, Point, box

from lacarte import admin, extract, regions

CRS = "EPSG:2154"


def commune():
    """One commune, 1 km square, its north edge on the border (y = 1000)."""
    import geopandas as gpd
    import pandas as pd

    df = pd.DataFrame({"code": ["A"], "name": ["Port"], "dep": ["1"], "parent": [None],
                       "town": ["Port"], "geometry": [box(0, 0, 1000, 1000)]})  # fmt: skip
    return gpd.GeoDataFrame(df, geometry="geometry", crs=CRS)


# The country: the commune and its sea to the east (to x = 1800); abroad beyond y = 990 (the
# commune's last 10 m lie abroad by the national outline: generalised IGN limits).
COUNTRY = box(-100, -100, 1800, 990)
CAMERAS = {
    "jetty": Point(1300, 500),  # 300 m off the commune, at sea, in France: attached
    "abroad": Point(500, 1300),  # 300 m off, outside France: left out
    "offshore": Point(1700, 500),  # 700 m off, in France: kept, in no commune
    "in_commune": Point(500, 995),  # in the commune, outside the outline: kept
    "border": Point(500, 1005),  # 5 m off the commune, outside the outline: kept
    "inland": Point(500, 500),
}


def test_the_national_outline_leaves_out_cameras_abroad_only():
    names = list(CAMERAS)
    away = extract.abroad(np.array(list(CAMERAS.values()), dtype=object), COUNTRY, commune(),
                          admin.rescue_max_m())  # fmt: skip
    assert dict(zip(names, away.tolist(), strict=True)) == {
        "jetty": False, "abroad": True, "offshore": False, "in_commune": False,
        "border": False, "inland": False,
    }  # fmt: skip


def test_a_coastal_camera_goes_to_the_nearest_commune_within_500_m():
    kept = [p for n, p in CAMERAS.items() if n != "abroad"]
    rescue = admin._rules()["camera_rescue_max_m"]
    assert rescue == 500
    unit, rescued = admin.assign_points(np.array(kept, dtype=object), commune(), rescue)
    # jetty: attached; offshore (700 m): kept on the map, in no commune
    assert unit.tolist() == [0, -1, 0, 0, 0]
    assert rescued.tolist() == [True, False, False, True, False]


def test_the_coast_s_rescue_is_a_country_s_only():
    # Elsewhere (the Île-de-France alone, the CI fixture) a camera 300 m off its communes
    # may stand in a neighbouring département: the 10 m rescue of the streets.
    assert admin.camera_rescue_m(regions.load("fr-paca")) == 500
    assert admin.camera_rescue_m(regions.load("france")) == 500
    assert admin.camera_rescue_m(regions.load("idf")) == admin.rescue_max_m() == 10
    assert admin.camera_rescue_m(regions.load("ci")) == 10
    assert regions.country(regions.load("fr-paca")) == "FR"
    assert regions.country(regions.load("ci")) is None


def test_outline_closes_rings_from_their_ways_and_cuts_the_inner_ones():
    outer = [LineString([(0, 0), (4, 0), (4, 4)]), LineString([(4, 4), (0, 4), (0, 0)]),
             LineString([(10, 0), (11, 0), (11, 1), (10, 1), (10, 0)])]  # fmt: skip
    inner = [LineString([(1, 1), (2, 1), (2, 2), (1, 2), (1, 1)])]  # an enclave (Llívia)
    shape = extract.outline(outer, inner)
    assert shape.area == pytest.approx(16 - 1 + 1)
    assert not shape.contains(Point(1.5, 1.5)) and shape.contains(Point(3, 3))
    with pytest.raises(ValueError, match="open outer"):
        extract.outline([LineString([(0, 0), (4, 0), (4, 4)])], [])
    with pytest.raises(ValueError, match="no outer"):
        extract.outline([], inner)


def _osm(path, ways_present=("1", "2", "3"), frame=(0, 0, 1, 1)):
    """A tiny .osm: France (2 outer ways around the square `frame`, 1 inner, 1 overseas way
    absent from the file) and Belgium's relation; lon/lat degrees."""
    unit = {1: (0, 0), 2: (1, 0), 3: (1, 1), 4: (0, 1), 5: (0.4, 0.4), 6: (0.6, 0.4),
            7: (0.6, 0.6), 8: (0.4, 0.6)}  # fmt: skip
    x0, y0, x1, y1 = frame
    nodes = {i: (x0 + (x1 - x0) * u, y0 + (y1 - y0) * v) for i, (u, v) in unit.items()}
    ways = {"1": [1, 2, 3], "2": [3, 4, 1], "3": [5, 6, 7, 8, 5]}
    xml = ['<?xml version="1.0" encoding="UTF-8"?>', '<osm version="0.6" generator="test">']
    for i, (lon, lat) in nodes.items():
        xml.append(f'<node id="{i}" version="1" lat="{lat}" lon="{lon}"/>')
    for w, refs in ways.items():
        if w in ways_present:
            nd = "".join(f'<nd ref="{r}"/>' for r in refs)
            xml.append(f'<way id="{w}" version="1">{nd}<tag k="boundary" v="administrative"/>'
                       '<tag k="admin_level" v="2"/></way>')  # fmt: skip
    fr = (
        '<member type="way" ref="1" role="outer"/><member type="way" ref="2" role="outer"/>'
        '<member type="way" ref="3" role="inner"/><member type="way" ref="99" role="outer"/>'
    )
    be = '<member type="way" ref="2" role="outer"/>'
    for rid, iso, members in ((10, "FR", fr), (11, "BE", be)):
        xml.append(f'<relation id="{rid}" version="1">{members}<tag k="type" v="boundary"/>'
                   '<tag k="boundary" v="administrative"/><tag k="admin_level" v="2"/>'
                   f'<tag k="ISO3166-1" v="{iso}"/></relation>')  # fmt: skip
    xml.append("</osm>")
    path.write_text("\n".join(xml))
    return path


def test_the_country_outline_is_derived_once_from_the_region_s_extract(tmp_path):
    pbf = _osm(tmp_path / "country.osm")
    region = PinnedRegion(name="t", crs=CRS, pbf=pbf, country="FR", root=tmp_path,
                          contrib_root=tmp_path)  # fmt: skip
    shape = extract.country_outline(region)
    assert shape.area == pytest.approx(1 - 0.04)  # the square less the enclave
    assert shape.contains(Point(0.2, 0.2)) and not shape.contains(Point(0.5, 0.5))
    path = region.build_dir / extract.COUNTRY
    stamp = path.stat().st_mtime_ns
    assert shapely.equals(extract.country_outline(region), shape)
    assert path.stat().st_mtime_ns == stamp  # not derived again
    assert extract.country_outline(PinnedRegion(name="u", crs=CRS, pbf=pbf, root=tmp_path,
                                                contrib_root=tmp_path)) is None  # fmt: skip


def test_a_ring_with_a_way_missing_stops_the_build(tmp_path):
    pbf = _osm(tmp_path / "broken.osm", ways_present=("1", "3"))
    with pytest.raises(ValueError, match="open outer"):
        extract.derive_country(pbf, "FR", tmp_path / "out.geojson")
    with pytest.raises(ValueError, match="0 admin_level=2"):
        extract.derive_country(_osm(tmp_path / "ok.osm"), "DE", tmp_path / "out.geojson")


def test_the_extract_leaves_out_the_cameras_abroad_of_a_country_s_region(tmp_path):
    # The CI communes (La Défense) in a "country" ending at 2.25° E: Puteaux's and
    # Courbevoie's east lies outside it, as a generalised commune may cross the border.
    import geopandas as gpd

    pbf = _osm(tmp_path / "country.osm", frame=(2.0, 48.8, 2.25, 49.0))
    ci = regions.load("ci")
    region = PinnedRegion(name="t", crs=CRS, pbf=pbf, country="FR", admin=ci.admin,
                          root=tmp_path, contrib_root=tmp_path)  # fmt: skip
    units, _ = admin.region_units(region)
    towns = shapely.union_all(units.to_crs("EPSG:4326").geometry.values)
    in_commune_abroad = towns.intersection(box(2.25, 48.8, 3, 49)).representative_point()
    pts = {"inland": Point(2.20, 48.89), "in_commune_abroad": in_commune_abroad,
           "abroad": Point(2.40, 48.89)}  # fmt: skip
    cams = gpd.GeoDataFrame({"camera_id": list(pts)}, geometry=list(pts.values()),
                            crs="EPSG:4326").to_crs(CRS)  # fmt: skip
    assert extract.camera_abroad(cams, region).tolist() == [False, False, True]
    # Inland only: no commune loaded, none abroad; outside a country's region: none.
    assert not extract.camera_abroad(cams.iloc[:1], region).any()
    assert not extract.camera_abroad(cams, ci).any()
