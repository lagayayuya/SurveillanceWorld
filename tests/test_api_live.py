"""Frozen case of the live field: at its served position, every La Défense camera gets from
the API's path (prepared buildings read from PostGIS, camerafield) exactly the batch's
field, band for band on the 1 mm grid."""

import geopandas as gpd
import psycopg
import pytest
import shapely

from lacarte import views
from lacarte.api import live


@pytest.fixture(scope="module")
def batch(ci_build):
    cams = gpd.read_parquet(ci_build.build_dir / "cameras_norm.parquet")
    outdoor = cams[cams.is_camera & ~cams.indoor].reset_index(drop=True)
    raw = gpd.read_parquet(ci_build.build_dir / "buildings.parquet").geometry.values
    view_rows, band_rows = views.compute(outdoor, raw, ci_build.crs, workers=2)
    return view_rows.set_index("camera_id"), band_rows


def test_live_field_at_the_served_position_is_the_batch_field(batch, pg_loaded, pg_dsn):
    view_rows, band_rows = batch
    by_camera = {cid: g for cid, g in band_rows.groupby("camera_id")}
    compared = 0
    with psycopg.connect(pg_dsn) as conn:
        for cid, v in view_rows.iterrows():
            cam = live.camera(conn, cid)
            polys = live.buildings_near(conn, cam.x, cam.y, live.fetch_radius(cam))
            placed = live.place(cam, cam.x, cam.y, magnet=False, polys=polys)
            assert (placed.x, placed.y, placed.move_m) == (cam.x, cam.y, 0.0)
            f = live.field(cam, placed.x, placed.y, polys)
            assert f["snapped"] == v.snapped and f["snap_m"] == v.snap_m, cid
            assert shapely.equals(f["view"], v.geometry) or f["view"].is_empty, cid
            want = by_camera.get(cid)
            want = {} if want is None else {
                (r.level, r.band): (r.geometry, r.reach_m) for r in want.itertuples()
            }  # fmt: skip
            got = {(b["level"], b["band"]): (shapely.from_wkb(b["wkb"]), b["reach_m"])
                   for b in f["bands"]}  # fmt: skip
            assert got.keys() == want.keys(), cid
            for key, (geom, reach) in got.items():
                assert shapely.to_wkb(geom) == shapely.to_wkb(want[key][0]), (cid, key)
                assert reach == want[key][1], (cid, key)
                compared += 1
    assert compared == len(band_rows) > 1000


def test_a_point_within_a_millimetre_is_the_served_position(pg_loaded, pg_dsn):
    with psycopg.connect(pg_dsn) as conn:
        cid = conn.execute("SELECT camera_id FROM cameras WHERE NOT indoor LIMIT 1").fetchone()[0]
        cam = live.camera(conn, cid)
        lon, lat = live.TO_LL.transform(cam.x, cam.y)
        x, y = live.to_metres(lon, lat)
        placed = live.place(cam, x, y, magnet=False, polys=[])
        assert (placed.x, placed.y) == (cam.x, cam.y)
