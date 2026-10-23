"""Frozen cases for the tile features."""

import geopandas as gpd
import numpy as np
import pytest
import shapely
from shapely import LineString

from lacarte import camerafilters, optics, tiles

CRS = "EPSG:2154"


def portions_frame(rows):
    """rows: (e, band, level, cameras, line)."""
    return gpd.GeoDataFrame(
        {"e": [r[0] for r in rows], "band": [r[1] for r in rows], "level": [r[2] for r in rows],
         "cameras": [r[3] for r in rows]},
        geometry=[r[4] for r in rows], crs=CRS,
    )  # fmt: skip


def test_contiguous_portions_of_one_level_and_bits_merge_and_keep_their_length():
    portions = portions_frame([
        (0, 1, 1, ["a:1"], LineString([(0, 0), (60, 0)])),
        (1, 1, 1, ["a:1"], LineString([(60, 0), (100, 3)])),  # same level and bits, touching
        (1, 1, 3, ["a:1"], LineString([(100, 3), (120, 3)])),  # another level
        (2, 1, 1, ["a:1"], LineString([(200, 0), (260, 0)])),  # same, apart: its own line
        (3, 1, 1, ["b:1"], LineString([(260, 0), (300, 0)])),  # touching, other bits
        (4, 1, 1, ["a:1"], LineString([(0, 10), (50, 10)])),  # a sidewalk: not below z16
        (0, 2, 1, ["a:1"], LineString([(0, 0), (80, 0)])),  # the other estimate, apart
    ])  # fmt: skip
    fb = tiles.portion_filter_bits(portions, {"a": 1, "b": 32})
    axis = np.array([True, True, True, True, False])
    m = tiles.merged_portions(portions, fb, axis, tolerance_m=0.0)
    got = sorted((r.b, r.lv, r.fb, shapely.get_num_geometries(r.geometry), round(r.geometry.length))
                 for r in m.itertuples())  # fmt: skip
    assert got == [(1, 1, 1, 2, 160), (1, 1, 32, 1, 40), (1, 3, 1, 1, 20), (2, 1, 1, 1, 80)]


def test_portion_bits_are_read_per_estimate():
    # A camera identifying far with the prudent estimate only sets that bit on prudent
    # portions (camerafilters.estimate_mask).
    far2 = 1 << camerafilters.SEGMENT_BITS["identifies_far_2"]
    portions = portions_frame([
        (0, 1, 1, ["a:1"], LineString([(0, 0), (1, 0)])),
        (0, 2, 1, ["a:1"], LineString([(0, 0), (1, 0)])),
    ])  # fmt: skip
    assert list(tiles.portion_filter_bits(portions, {"a": 1 | far2})) == [1, 1 | far2]


def test_segments_are_grey_lines_axes_from_z14_the_rest_from_z16():
    import json

    edges = gpd.GeoDataFrame(
        {"axis": [True, False], "highway": ["residential", "footway"]},
        geometry=[LineString([(0, 0), (1, 0)]), LineString([(0, 1), (1, 1)])], crs=CRS,
    )  # fmt: skip
    every = np.ones(2, dtype=bool)
    feats = [json.loads(f) for f in tiles._edge_features(edges, ["minor", "other"], [False] * 2,
                                                         every)]  # fmt: skip
    assert [f["tippecanoe"]["minzoom"] for f in feats] == [14, 16]
    # The default class is no property (rules/streets.yaml tile_class).
    assert [f["properties"] for f in feats] == [{"c": "minor"}, {}]
    assert all("id" not in f for f in feats)


def test_unfilmed_tracks_leave_the_tiles():
    # rule:streets@3.1:unfilmed_not_drawn: a track's segment is in the tiles only where
    # filmed (the basemap draws the others); a footway's stays, filmed or not.
    import json

    edges = gpd.GeoDataFrame(
        {"axis": [True] * 3, "highway": ["track", "track", "footway"]},
        geometry=[LineString([(0, i), (1, i)]) for i in range(3)], crs=CRS,
    )  # fmt: skip
    feats = tiles._edge_features(edges, np.array(["other"] * 3), np.array([True, False, False]),
                                 np.ones(3, dtype=bool))  # fmt: skip
    got = [json.loads(f)["geometry"]["coordinates"][0][1] for f in feats]
    assert len(got) == 2 and got[0] < got[1]  # the filmed track and the footway


def test_unfilmed_segments_only_where_a_camera_stands():
    # rule:streets@3.2:unfilmed_only_where_cameras: an unfilmed segment is drawn when its
    # midpoint lies in a unit with a camera; outside every unit, or in a unit without one,
    # the basemap's road alone (_edge_features draws a filmed one anyway).
    import json

    from shapely.geometry import box

    areas = gpd.GeoDataFrame(
        {"level": ["commune", "commune", "departement"], "camera_count": [2, 0, 2]},
        geometry=[box(0, 0, 10, 10), box(10, 0, 20, 10), box(0, 0, 20, 10)], crs=CRS,
    ).to_crs("EPSG:4326")  # fmt: skip
    edges = gpd.GeoDataFrame(
        {"axis": [True] * 4, "highway": ["residential"] * 4},
        geometry=[LineString([(1, 5), (9, 5)]), LineString([(11, 5), (19, 5)]),
                  LineString([(8, 2), (14, 2)]), LineString([(30, 5), (40, 5)])], crs=CRS,
    )  # fmt: skip
    drawn = tiles.unfilmed_drawn(edges, areas, CRS)
    # The third's midpoint (11, 2) is in the commune without a camera.
    assert drawn.tolist() == [True, False, False, False]
    filmed = np.array([False, True, False, False])
    feats = tiles._edge_features(edges, np.array(["other"] * 4), filmed, drawn | filmed)
    starts = [round(json.loads(f)["geometry"]["coordinates"][0][0], 6) for f in feats]
    want = [round(g.coords[0][0], 6) for g in edges.to_crs("EPSG:4326").geometry[:2]]
    assert starts == want  # the first (unfilmed, a camera's commune) and the filmed second


def test_width_classes_follow_the_basemaps_roads():
    # rule:streets@3.1:tile_class: the basemap's class for the type; a service way with a
    # service=* value is a minor road there; a type not listed is drawn as a path.
    edges = gpd.GeoDataFrame({
        "highway": ["motorway", "motorway_link", "trunk_link", "tertiary", "residential",
                    "service", "service", "living_street", "busway", "track", "footway"],
        "service": [None] * 6 + ["alley", None, None, None, None],
    })  # fmt: skip
    assert list(tiles.street_classes(edges)) == [
        "highway", "link", "major", "major", "minor", "minor_service", "minor", "other",
        "other", "other", "other",
    ]  # fmt: skip


def test_pixel_size():
    # One CSS pixel at z11 over Paris is about 25 m.
    assert tiles.pixel_m(11, 48.85) == pytest.approx(25.2, abs=0.1)


def test_filter_flags_layout():
    # The front decodes these bits (web/src/advanced.ts): keep them in sync.
    bits = camerafilters.FLAG_BITS
    assert min(bits.values()) == 2  # bits 0-1 hold the freshness bucket
    assert sorted(bits.values()) == list(range(2, 2 + len(bits)))
    assert [bits[f"identifies_far_{i}"] for i in range(len(tiles.ESTIMATES))] == [12, 13, 14]


def test_class_breaks_strictly_increase():
    assert tiles.unique_breaks([31.5, 31.5, 31.5, 40.0]) == [31.5, 40.0]


def test_camera_bands_key_uses_compact_numbers():
    compact = tiles.compact_ids(["w5", "n12", "n3"])
    assert compact == {"n12": 0, "n3": 1, "w5": 2}
    assert tiles.camera_bands_key(["n12:1", "w5:0"], compact) == ";1;6;"
    assert tiles.base36(0) == "0" and tiles.base36(35) == "z" and tiles.base36(36 * 3 + 2) == "32"


def test_label_metres_rounds_up():
    assert optics.label_m(5.64) == 6 and optics.label_m(55.2) == 56
    assert optics.label_m(6.0) == 6 and optics.label_m(6.0000000001) == 6
    assert optics.label_m(0.04) == 1 and optics.label_m(0) == 0


def test_camera_table_is_indexed_by_compact_number():
    cams = gpd.GeoDataFrame(
        {"camera_id": ["n2", "n1"], "operator_class": ["public", "unknown"],
         "kind": ["dome", "fixed"]},
        geometry=[shapely.Point(0, 0)] * 2,
    )  # fmt: skip
    compact = tiles.compact_ids(cams.camera_id)
    filters = {"n1": {"fl": 5}, "n2": {"fl": 8, "op": 3}}
    t = tiles.camera_table(cams, filters, compact)
    assert compact == {"n1": 0, "n2": 1}
    assert t["kinds"] == ["dome", "fixed"]
    assert [t["ops"][o] for o in t["o"]] == ["unk", "pub"]
    assert [t["kinds"][k] for k in t["k"]] == ["fixed", "dome"]
    assert t["fl"] == [5, 8] and t["op"] == [-1, 3]


def test_camera_mask_sets_one_bit_per_category():
    fl = (
        3
        + (1 << camerafilters.FLAG_BITS["ptz"])
        + (1 << camerafilters.FLAG_BITS["identifies_far_2"])
    )
    mask = camerafilters.camera_mask("public", "dome", fl)
    on = {name for name, bit in camerafilters.SEGMENT_BITS.items() if (mask >> bit) & 1}
    assert on == {"op:pub", "kind:dome", "fresh_never", "ptz", "identifies_far_2"}
    assert max(camerafilters.SEGMENT_BITS.values()) < 31  # fits a positive 32-bit integer


def test_communes_and_departements_get_their_own_quantile_breaks():
    import pandas as pd

    def frame(level, shares):
        # Breaks come from the high end Y (cautious, every camera); the others are halved.
        return pd.DataFrame({
            "level": level, "camera_count": 1,
            **{f"filmed_ratio_{e}{s}": [v / 2 for v in shares]
               for e in tiles.ESTIMATES for s in ("", "_pub")},
            **{f"filmed_ratio_cautious{s}": shares for s in ("", "_pub")},
        })  # fmt: skip

    areas = pd.concat([frame("commune", [0.01, 0.02, 0.03, 0.04, 0.05, 0.06]),
                       frame("departement", [0.5, 0.6])])  # fmt: skip
    m = tiles.meta(areas)
    assert m["communes"]["hi"]["max"] == 6 and m["departements"]["hi"]["max"] == 60
    assert m["communes"]["hi"]["breaks"] == [2.0, 3.0, 4.0, 5.0]
    # The punk map's classes are fixed, whatever the areas (rules/admin.yaml).
    assert m["area_classes"] == [5.0, 15.0, 30.0, 50.0]
    assert "cells" not in m
    # The map opens on "Standard", the pipeline's reference estimate too.
    names = tiles.ESTIMATES
    assert names[m["opening_estimate"]] == "probable" and names[m["default_estimate"]] == "probable"
    assert m["unknown_direction"] == {"kinds": ["dome", "fixed", "unknown", "alpr"]}
    assert m["max_range_m"] == 180 and m["ptz_hfov_p50"] == 58


def test_bands_and_portions_carry_only_what_the_map_reads():
    # Lot P (2026-10-17): no `u` (no style reads it); the portions with their cameras from
    # the street level (z15, tiles.PORTIONS_MIN), z12-14 being merged.
    import json

    from shapely import LineString, box

    cams = gpd.GeoDataFrame(
        {"camera_id": ["n1", "n2", "n3"], "kind": ["dome", "ptz", "fixed"],
         "directions": [[], [], [90.0]], "direction_certainty": ["default", "default", "estimated"],
         "operator_class": ["public"] * 3},
        geometry=gpd.points_from_xy([0, 1, 2], [0, 0, 0]), crs="EPSG:4326",
    )  # fmt: skip
    bands = gpd.GeoDataFrame(
        {"camera_id": ["n1", "n2", "n3"], "level": "detection", "band": 1, "reach_m": 10.0},
        geometry=[box(0, 0, 1, 1)] * 3, crs="EPSG:4326",
    )  # fmt: skip
    filters = {c: {"fl": 0} for c in ("n1", "n2", "n3")}
    feats = [json.loads(f) for f in tiles._band_features(bands, cams, filters)]
    assert all("u" not in f["properties"] for f in feats)
    assert [f["properties"]["c"] for f in feats] == [0, 0, 1]  # the classique's hatching
    portions = gpd.GeoDataFrame(
        {"e": [0, 1, 2], "band": 1, "level": 1,
         "cameras": [["n1:1"], ["n1:1", "n3:1"], ["n3:0"]]},
        geometry=[LineString([(0, 0), (1, 0)])] * 3, crs="EPSG:4326",
    )  # fmt: skip
    compact = tiles.compact_ids(["n1", "n2", "n3"])
    axis = np.array([True, True, False])
    classes = np.array(["major", "minor", "other"])
    feats = [json.loads(f) for f in tiles._portion_features(portions, compact, axis, classes)]
    assert all("u" not in f["properties"] and "cs" in f["properties"] for f in feats)
    # Each part carries its segment's width class.
    assert [f["properties"].get("c", "other") for f in feats] == [classes[e] for e in portions.e]
    assert "c" not in feats[2]["properties"]
    # From the street level; a sidewalk's portions with the sidewalk, from z16.
    assert [f["tippecanoe"]["minzoom"] for f in feats] == [15, 15, 16]
    assert tiles.MERGED_ZOOMS == (11, 12, 13, 14)


def test_area_features_carry_the_low_and_high_shares_and_their_zooms():
    import json

    import pandas as pd
    from shapely import box

    row = {"code": "92062", "name": "Puteaux", "dep": "92", "dep_name": "Hauts-de-Seine",
           "camera_count": 3.0, "n_public": 1.0, "n_private_outdoor": 1.0, "n_private_indoor": 0.0,
           "n_unknown": 1.0, "reliability": 0.5, "reliability_word": "medium",
           "reliability_reason": "no_direction", "reliability_reason_pct": 60.0,
           "road_m": 12345.0, "operators": '[["SNCF", 2]]',
           "n_no_operator_info": 2, "direction_known_share": 0.25}  # fmt: skip
    for i, e in enumerate(tiles.ESTIMATES):
        row[f"filmed_ratio_{e}"] = 0.1 * (i + 1)
        row[f"filmed_ratio_{e}_pub"] = 0.01 * (i + 1)
    row["filmed_ratio_probable_dir"] = 0.05
    row["filmed_ratio_probable_dir_pub"] = 0.005
    row |= {f"n_kind_{k}": 0.0 for k in tiles.KINDS} | {"n_kind_dome": 2.0, "n_kind_unknown": 1.0}
    areas = gpd.GeoDataFrame(pd.DataFrame([row]), geometry=[box(0, 0, 1, 1)], crs="EPSG:4326")
    f = json.loads(next(tiles._area_features(areas, {"minzoom": 8})))
    p = f["properties"]
    assert f["tippecanoe"] == {"minzoom": 8}
    # lo = probable by cameras with a direction, hi = cautious by every camera; no other.
    assert (p["lo"], p["hi"], p["lo_pub"], p["hi_pub"]) == (5, 30, 0.5, 3)
    assert not any(k.startswith("ratio") for k in p)
    assert (p["c"], p["nm"], p["n"], p["n_pub"], p["rel"], p["road_km"]) == (
        "92062",
        "Puteaux",
        3,
        1,
        50,
        12.3,
    )
    assert json.loads(p["ops"]) == [["SNCF", 2]]
    assert (p["n_pro"], p["n_pri"], p["n_unk"], p["nx"]) == (1, 0, 1, 2)
    # Cameras by type, a type without camera left out (the punk sheet's « Caméras »).
    assert {k: v for k, v in p.items() if k.startswith("k_")} == {"k_dome": 2, "k_unknown": 1}
    assert p["nd"] == 75  # % of cameras without a surveyed direction
    assert 0 < p["lx"] < 1 and 0 < p["ly"] < 1  # a point inside the area
    assert tiles.area_index(areas) == {"92062": ["Puteaux", "92", [0, 0, 1, 1]]}


def test_field_extents_are_the_drawn_floor_band_around_the_camera():
    # The map frames a field from this box, not from the loaded pieces nor camera +- reach.
    cams = gpd.GeoDataFrame({"camera_id": ["a"]}, geometry=[shapely.Point(100, 200)], crs=CRS)
    bands = gpd.GeoDataFrame(
        {"camera_id": ["a", "a", "a"], "level": ["detection", "recognition", "detection"],
         "band": [1, 1, 2]},
        geometry=[shapely.box(90.4, 195, 130.2, 201), shapely.box(0, 0, 1, 1),
                  shapely.box(50, 150, 160, 260)],
        crs=CRS,
    )  # fmt: skip
    assert tiles.field_extents(bands, cams) == {"a": {"x1": "-10,-5,31,1", "x2": "-50,-50,60,60"}}


def test_position_check_flags_tiny_fields_and_cameras_inside_buildings():
    import pandas as pd

    views = pd.DataFrame(
        {"area_m2": [0.0, 9.9, 10.0, 5000.0, None],
         "inside_building": [False, False, False, False, True]},
        index=["wall_facing", "sliver", "small", "street", "inside"],
    )  # fmt: skip
    got = camerafilters.position_check(views)
    assert got.to_dict() == {
        "wall_facing": True, "sliver": True, "small": False, "street": False, "inside": True,
    }  # fmt: skip


def test_merged_intervals_at_z11_go_to_their_own_zooms():
    # Streets one zoom earlier (2026-10-23): z11 is written apart (portions_low) and tiled at
    # a coarser grid; the other merged zooms stay in portions.
    import json

    rows = [(0, 1, 1, ["n1:1"], LineString([(0, 0), (10, 0)])),
            (1, 1, 1, ["n1:1"], LineString([(10, 0), (20, 0)]))]  # fmt: skip
    portions = portions_frame(rows)
    fb, axis = np.zeros(2, dtype=np.int64), np.array([True, True])
    low = [json.loads(f) for f in tiles._merged_features(portions, fb, axis, tiles.LOW_ZOOMS)]
    assert [f["tippecanoe"] for f in low] == [{"minzoom": 11, "maxzoom": 11}]
    assert tiles.LOW_ZOOMS == (11,) and tiles.STREETS_MIN == 11


def test_streets_start_at_z11_and_the_communes_outlines_have_their_own_z7_archive(ci_pipeline):
    import gzip

    from pmtiles.reader import MmapSource, Reader, all_tiles

    from lacarte import basemap as bm

    out = ci_pipeline.build_dir / "tiles"
    assert not [p.name for p in out.glob("streets-*.pmtiles")]  # the two halves, joined
    with open(out / "streets.pmtiles", "rb") as fh:
        zooms = {z for (z, _, _), _ in all_tiles(MmapSource(fh))}
    assert min(zooms) == 11 and max(zooms) == 16
    with open(out / "admin7.pmtiles", "rb") as fh:
        reader = Reader(MmapSource(fh))
        assert (reader.header()["min_zoom"], reader.header()["max_zoom"]) == (7, 7)
        tiles7 = list(all_tiles(MmapSource(fh)))
    assert tiles7
    for _, data in tiles7:
        tile = gzip.decompress(data)
        layers = [tile[v:e] for num, _, _, v, e in bm._fields(tile) if num == 3]
        assert [bm.layer_name(layer) for layer in layers] == ["communes"]
        # Outlines only: no attribute key in the layer (field 3 of a layer message).
        assert not [f for f in bm._fields(layers[0]) if f[0] == 3]


def test_the_region_bounds_are_its_departements_rounded_outward():
    from shapely import box

    areas = gpd.GeoDataFrame(
        {"level": ["departement", "departement", "commune"]},
        geometry=[box(2.1234, 48.5, 2.5, 48.9), box(2.5, 48.7, 3.0001, 49.2), box(9, 9, 10, 10)],
        crs="EPSG:4326",
    )  # fmt: skip
    assert tiles.region_bounds(areas) == [2.123, 48.5, 3.001, 49.2]


def test_the_admin_tiles_start_at_z4_and_meta_gives_the_region_bounds(ci_pipeline):
    import json

    from pmtiles.reader import MmapSource, Reader

    out = ci_pipeline.build_dir / "tiles"
    with open(out / "admin.pmtiles", "rb") as fh:
        assert Reader(MmapSource(fh)).header()["min_zoom"] == tiles.ADMIN_MIN == 4
    west, south, east, north = json.loads((out / "meta.json").read_text())["bounds"]
    assert west < east and south < north


def test_every_segment_row_has_a_bit_of_its_own():
    # kind:multidome (2026-10-23) once put kind:unknown on fresh_lt1's bit 11.
    from lacarte.camerafilters import KIND_ORDER, SEGMENT_BITS

    bits = list(SEGMENT_BITS.values())
    assert len(set(bits)) == len(bits) and sorted(bits) == list(range(len(bits)))
    assert SEGMENT_BITS["kind:unknown"] == 4 + len(KIND_ORDER) - 1
    assert SEGMENT_BITS["fresh_lt1"] == 4 + len(KIND_ORDER)
