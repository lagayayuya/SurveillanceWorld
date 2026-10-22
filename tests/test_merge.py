"""A region built in parts and merged (merge.py) gives the build of the whole: the La
Défense fixture with its communes in two départements (tests/fixtures/ci-admin-split), built
whole (ci-split) and as two parts (ci-parts: ci-east, ci-west), with the synthetic
contributions."""

import gzip
import json

import geopandas as gpd
import numpy as np
import pandas as pd
import pytest
import shapely
from conftest import pinned

from lacarte import apply, cli, db, merge, optics, regions

CONTRIB = regions.ROOT / "tests" / "fixtures" / "contrib-ci.jsonl"


@pytest.fixture(scope="session")
def split_builds(tmp_path_factory):
    """(whole, merged), each in its own build root with the contributions."""
    data = CONTRIB.read_bytes()
    whole_contrib = tmp_path_factory.mktemp("whole-contrib")
    (whole_contrib / "ci-split.jsonl").write_bytes(data)
    whole = pinned("ci-split", tmp_path_factory.mktemp("whole"), whole_contrib)
    for stage in cli.STAGES.values():
        stage(whole)
    parts_contrib = tmp_path_factory.mktemp("parts-contrib")
    (parts_contrib / "ci-parts.jsonl").write_bytes(data)
    merged = pinned("ci-parts", tmp_path_factory.mktemp("parts"), parts_contrib)
    merge.build(merged, isolate=False, log=lambda *_: None)
    return whole, merged


def _lines(path, drop=("id",)):
    """A source file's features as sorted JSON texts, without the keys in `drop`."""
    out = []
    for line in path.read_text().splitlines():
        f = json.loads(line)
        for k in drop:
            f.pop(k, None)
        out.append(json.dumps(f, sort_keys=True))
    return sorted(out)


def test_each_part_is_cut_and_built(split_builds):
    _, merged = split_builds
    parts = regions.parts(merged)
    assert [p.name for p in parts] == ["ci-east", "ci-west"]
    for p in parts:
        assert p.source_pbf.exists()
        own = gpd.read_parquet(p.build_dir / "areas.parquet")
        # A part reports its own units only, though it sees its neighbours' (admin).
        deps = {"ci-east": {"92"}, "ci-west": {"9W"}}[p.name]
        assert set(own.dep) == deps
        assert p.data_date() == merged.data_date()


def test_areas_are_the_whole_build_s(split_builds):
    whole, merged = split_builds
    a = gpd.read_parquet(whole.build_dir / "areas.parquet").set_index(["level", "code"])
    b = gpd.read_parquet(merged.build_dir / "areas.parquet").set_index(["level", "code"])
    assert sorted(a.index) == sorted(b.index)
    b = b.loc[a.index]
    assert a.geometry.geom_equals_exact(b.geometry, 1e-9).all()
    for col in a.columns.drop("geometry"):
        x, y = a[col], b[col]
        if pd.api.types.is_numeric_dtype(x):
            np.testing.assert_allclose(x.astype(float), y.astype(float), rtol=1e-9, atol=1e-6,
                                       equal_nan=True, err_msg=col)  # fmt: skip
        else:
            assert x.fillna("").astype(str).tolist() == y.fillna("").astype(str).tolist(), col


def test_cameras_and_meta_are_the_whole_build_s(split_builds):
    whole, merged = split_builds
    wt, mt = whole.build_dir / "tiles", merged.build_dir / "tiles"
    assert (wt / "cameras.json").read_text() == (mt / "cameras.json").read_text()
    assert (wt / "areas.json").read_text() == (mt / "areas.json").read_text()
    wm, mm = json.loads((wt / "meta.json").read_text()), json.loads((mt / "meta.json").read_text())
    assert wm.pop("build_id").startswith("ci-split-")
    assert mm.pop("build_id").startswith("ci-parts-")
    assert wm == mm
    a = gpd.read_parquet(whole.build_dir / apply.CAMERAS).set_index("camera_id").sort_index()
    b = gpd.read_parquet(merged.build_dir / apply.CAMERAS).set_index("camera_id").sort_index()
    assert list(a.index) == list(b.index)


@pytest.mark.parametrize("layer", ["edges", "portions", "bands", "cameras"])
def test_tile_features_are_the_whole_build_s(split_builds, layer):
    """Feature for feature, but the merged runs of z12-14 (tiles.merged_portions): each part
    merges its own, so a run across the parts' limit is two features there, drawn the same
    (the same lines per zoom, estimate, level and filter bits)."""
    whole, merged = split_builds
    a = _lines(whole.build_dir / "tiles_src" / f"{layer}.geojsonl")
    b = _lines(merged.build_dir / "tiles_src" / f"{layer}.geojsonl")
    if layer == "portions":
        a, a_runs = _split_runs(a)
        b, b_runs = _split_runs(b)
        assert a_runs.keys() == b_runs.keys()
        for key, lines in a_runs.items():
            assert shapely.equals(lines, b_runs[key]), key
    assert len(a) == len(b)
    assert a == b


def _split_runs(lines):
    """(the features of z15+, {(zoom, b, lv, fb): the lines of the merged runs})."""
    rest, runs = [], {}
    for text in lines:
        f = json.loads(text)
        z = f["tippecanoe"].get("maxzoom")
        if z is None:
            rest.append(text)
            continue
        p = f["properties"]
        key = (z, p["b"], p["lv"], p["fb"])
        runs.setdefault(key, []).append(shapely.geometry.shape(f["geometry"]))
    return rest, {k: shapely.line_merge(shapely.union_all(v)) for k, v in runs.items()}


def test_outcome_is_the_whole_build_s(split_builds):
    whole, merged = split_builds
    a = json.loads((whole.build_dir / apply.OUTCOME).read_text())["contributions"]
    b = json.loads((merged.build_dir / apply.OUTCOME).read_text())
    assert b["build_id"].startswith("ci-parts-")
    assert a == b["contributions"]
    assert {o["result"] for o in a} >= {"applied"}


def test_database_export_is_the_whole_build_s(split_builds, tmp_path):
    whole, merged = split_builds
    wa, ma = db.export(whole, tmp_path / "w", workers=2), db.export(merged, tmp_path / "m", 2)
    assert (wa["cameras"], wa["buildings"]) == (ma["cameras"], ma["buildings"])

    def rows(folder, name, first=0):
        """Sorted rows from column `first` (buildings: their ids follow the parts' order)."""
        with gzip.open(folder / name, "rt") as f:
            return sorted(tuple(line.rstrip("\n").split("\t")[first:]) for line in f)

    w, m = tmp_path / "w", tmp_path / "m"
    assert rows(w, "buildings.tsv.gz", 1) == rows(m, "buildings.tsv.gz", 1)
    assert rows(w, "cameras.tsv.gz") == rows(m, "cameras.tsv.gz")
    assert ma["build_id"].startswith("ci-parts-")


def test_owner_takes_the_lowest_rank_inside_and_the_nearest_outside():
    shapes = gpd.GeoDataFrame(
        {"part": ["a", "b"]},
        geometry=[shapely.box(0, 0, 10, 10), shapely.box(5, 0, 20, 10)],
        crs="EPSG:2154",
    )
    pts = shapely.points([(1, 1), (7, 5), (15, 5), (25, 5), (-3, 5)])
    assert merge.owner(pts, shapes).tolist() == [0, 0, 1, 1, 0]


def test_an_added_camera_refused_where_it_stands_belongs_to_no_part():
    # Every part applies an add, wherever it stands; the part of its position refused it (a
    # duplicate there): no other part may carry it to the map.
    assert merge.choose("n123", 1, [0, 1]) == 1
    assert merge.choose("n123", 2, [0, 1]) == 0  # an OSM camera beyond a buffer
    assert merge.choose("c0123456789ab", 1, [0, 1]) == 1
    assert merge.choose("c0123456789ab", 2, [0, 1]) is None


def test_a_contribution_no_part_applied_leaves_the_outcome(split_builds, tmp_path):
    """A hidden camera's contributions are applied by no part (apply.run leaves them out):
    the merged outcome skips them instead of failing."""
    import dataclasses

    _, merged = split_builds
    text = merged.contrib_file.read_text()
    first = json.loads(text.splitlines()[0])
    uid = "00000000-0000-4000-8000-00000000abcd"
    extra = {"answer": "present", "camera_id": "n1", "kind": "verify", "month": "2026-10",
             "osm_version": 1, "rank": 1, "uuid": uid}  # fmt: skip
    (tmp_path / "ci-parts.jsonl").write_text(text + json.dumps(extra) + "\n")
    region = dataclasses.replace(merged, contrib_root=tmp_path)
    shapes = gpd.read_parquet(merged.build_dir / merge.OWNERS)
    rank = pd.read_parquet(merged.build_dir / merge.CAMERA_OWNERS)
    owners = dict(zip(rank.camera_id, rank["rank"], strict=True))
    path = merge.merge_outcome(region, regions.parts(merged), owners, shapes)
    uuids = {o["uuid"] for o in json.loads(path.read_text())["contributions"]}
    assert extra["uuid"] not in uuids and first["uuid"] in uuids


def test_a_part_s_buffer_exceeds_the_longest_reach():
    # The buffer gives a part's cameras the buildings they see and its segments the cameras
    # that film them: more than the farthest filled field (rules/optics.yaml max_range_m),
    # with the 300 m margin of DECISIONS 2026-10-22.
    reach = optics.rules()["max_range_m"]
    for name in ("france", "ci-parts"):
        for part in regions.parts(regions.load(name)):
            assert part.buffer_m >= reach + 300, part.name
