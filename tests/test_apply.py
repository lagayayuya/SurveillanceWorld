"""The `apply` stage (rules/contributions.yaml): the rules on synthetic rows, a build
without contribution identical to the one before the stage, and frozen cases on the La
Défense pipeline with tests/fixtures/contrib-ci.jsonl (synthetic contributions on real
cameras of the extract):

  a1        a camera flagged "position ou direction à vérifier" moved 12 m onto a facade
  b1, b2    two moves: the later observation wins
  c1, c2    "introuvable", then "elle est là" observed later: the camera stays
  d1, d2    "elle est là", then "introuvable": gone (verified)
  e1        made on OSM version 2, the extract has 3: conflict
  f1        an element no longer in the extract: conflict
  91        free placement inside a building's footprint (an arcade)
  h1, h2    two moves of the same rank: both conflict, the OSM position stays
  i1, i2    "introuvable", then a move observed later: back, at its new position
  j1        "elle est là" alone, on a camera never surveyed
  k1        "Compléter" (phase D2): shape "Tube" on a public camera of unknown type
  k2        a direction (180 degrees) on a public dome without one, on a pole
  k3        "Particulier" on a private camera carrying the CNIL signal
  k4        "Public" with "Ville de Courbevoie" chosen, on a camera of unknown operator
  l1-l4     phase D3: a dome without tags made a tube (shape), aimed east, "1er étage"
            (on site) and "un peu vers le bas": a blind zone under it
  l5        "1er étage" on k1's tube ("Je ne sais pas" for its tilt is never exported):
            the height alone changes no field
  l6, l7    a dome on a street lamp made a tube, "un peu vers le bas" without any
            height: left validated, reason no_height, no effect
  add0000*  adds (phase "Ajouter"), checked in tests/test_add.py
"""

import dataclasses
import gzip
import hashlib
import json

import geopandas as gpd
import pandas as pd
import psycopg
import pytest
import shapely
from conftest import run_pipeline
from pmtiles.reader import MmapSource, Reader, all_tiles

from lacarte import apply, camerafield, db, normalize, regions
from lacarte.api import live

FIXTURE = regions.ROOT / "tests" / "fixtures" / "contrib-ci.jsonl"


def U(s: str) -> str:
    return f"00000000-0000-4000-8000-{s:0>12}"


def C(uid, what, rank, month="2026-09", camera="n1", version=1, x=None, y=None):
    kind, answer = ("move", None) if what == "move" else ("verify", what)
    if kind == "move" and x is None:
        x, y = float(rank), 0.0
    return apply.Contribution(U(uid), kind, camera, version, month, rank, answer, x, y)


# --- rules --------------------------------------------------------------------------------


def results(rows, versions=None):
    outcome, states = apply.settle(rows, versions or {"n1": 1})
    return {u[-2:]: (o["result"], o.get("reason")) for u, o in outcome.items()}, states


def test_the_latest_move_wins_and_the_older_is_superseded():
    got, states = results([C("b2", "move", 2, x=5.0, y=6.0), C("b1", "move", 1)])
    assert got == {"b1": ("superseded", None), "b2": ("applied", None)}
    s = states["n1"]
    assert (s.position, s.position_month, s.seen_month, s.gone_month) == (
        (5.0, 6.0), "2026-09", "2026-09", None)  # fmt: skip


def test_an_older_observation_validated_later_does_not_win():
    # The rank comes from the day of observation first (db/export_contributions.sql): the
    # move observed in August ranks first even if the review decided it last.
    got, states = results([C("b1", "move", 2, "2026-09", x=9.0, y=9.0),
                           C("b2", "move", 1, "2026-08")])  # fmt: skip
    assert got["b1"] == ("applied", None) and got["b2"] == ("superseded", None)
    assert states["n1"].position == (9.0, 9.0)


def test_not_found_then_present_keeps_the_camera_and_the_reverse_marks_it_gone():
    got, states = results([C("c1", "not_found", 1), C("c2", "present", 2, "2026-10")])
    assert got == {"c1": ("superseded", None), "c2": ("applied", None)}
    assert states["n1"].gone_month is None and states["n1"].seen_month == "2026-10"
    got, states = results([C("d1", "present", 1), C("d2", "not_found", 2)])
    assert got == {"d1": ("superseded", None), "d2": ("applied", None)}
    assert states["n1"].gone_month == "2026-09" and states["n1"].seen_month is None


def test_a_later_move_brings_a_gone_camera_back():
    got, states = results([C("i1", "not_found", 1), C("i2", "move", 2, x=3.0, y=4.0)])
    assert got == {"i1": ("superseded", None), "i2": ("applied", None)}
    s = states["n1"]
    assert (s.gone_month, s.position, s.seen_month) == (None, (3.0, 4.0), "2026-09")


def test_osm_version_and_deleted_element_are_conflicts():
    got, states = results([C("e1", "move", 1, version=2), C("f1", "present", 1, camera="n9")],
                          {"n1": 3})  # fmt: skip
    assert got == {"e1": ("conflict", "osm_version"), "f1": ("conflict", "osm_deleted")}
    assert states == {}


def test_a_tie_between_two_moves_is_a_same_day_conflict():
    got, states = results([C("h1", "move", 2), C("h2", "move", 2), C("h0", "move", 1)])
    assert got == {"h1": ("conflict", "same_day"), "h2": ("conflict", "same_day"),
                   "h0": ("superseded", None)}  # fmt: skip
    assert "n1" not in states


def test_a_tie_on_presence_conflicts_only_when_the_answers_disagree():
    got, states = results([C("p1", "present", 1), C("p2", "present", 1)])
    assert got == {"p1": ("applied", None), "p2": ("applied", None)}
    got, states = results([C("p1", "present", 1), C("n1", "not_found", 1)])
    assert got == {"p1": ("conflict", "same_day"), "n1": ("conflict", "same_day")}
    assert "n1" not in states
    # A move and "elle est là" of the same rank agree: both applied.
    got, _ = results([C("m1", "move", 1), C("p1", "present", 1)])
    assert got == {"m1": ("applied", None), "p1": ("applied", None)}


def test_the_file_refuses_any_key_the_build_does_not_read(tmp_path):
    row = json.loads(FIXTURE.read_text().splitlines()[0])
    path = tmp_path / "ci.jsonl"
    for extra in ({"author": "ivo"}, {"day": "2026-09-30"}, {"decided_on": "2026-09-30"}):
        path.write_text(json.dumps({**row, **extra}) + "\n")
        with pytest.raises(ValueError, match="unexpected keys"):
            apply.read(path)
    path.write_text(json.dumps({**row, "month": "2026-09-30"}) + "\n")
    with pytest.raises(ValueError, match="YYYY-MM"):
        apply.read(path)


# --- a build without contribution is the build before the stage ---------------------------


def _digests(region) -> dict[str, str]:
    """Every file of a build; a .pmtiles by its tiles and metadata with the build folder
    blanked: tippecanoe writes its command line, output path included, into the metadata
    (two builds in the same folder, as `make build` does, are identical file for file)."""
    root = region.build_dir
    out = {}
    for p in sorted(root.rglob("*")):
        if not p.is_file() or p.name == "timings.json":
            continue
        h = hashlib.sha256()
        if p.suffix == ".pmtiles":
            with p.open("rb") as f:
                src = MmapSource(f)
                meta = json.dumps(Reader(src).metadata(), sort_keys=True)
                h.update(meta.replace(str(root), "<build>").encode())
                for key, data in all_tiles(src):
                    h.update(repr(key).encode() + data)
        else:
            h.update(p.read_bytes())
        out[str(p.relative_to(root))] = h.hexdigest()
    return out


def test_no_file_and_an_empty_file_give_the_same_build_byte_for_byte(ci_pipeline, tmp_path_factory):
    empty = run_pipeline(tmp_path_factory, "empty", b"\n")
    a, b = _digests(ci_pipeline), _digests(empty)
    assert a == b
    assert {"bands.parquet", "views.parquet", "street_portions.parquet", "areas.parquet",
            "tiles/streets.pmtiles", "tiles/detail.pmtiles", "tiles/admin.pmtiles",
            "tiles/meta.json"} <= a.keys()  # fmt: skip
    d = ci_pipeline.build_dir
    assert (d / apply.CAMERAS).read_bytes() == (d / "cameras_norm.parquet").read_bytes()
    assert not (d / apply.OUTCOME).exists()


# --- frozen cases on the La Défense pipeline ------------------------------------------------


@pytest.fixture(scope="module")
def contributed(ci_contrib_pipeline):
    b = ci_contrib_pipeline.build_dir
    cams = gpd.read_parquet(b / apply.CAMERAS).set_index("camera_id")
    outcome = json.loads((b / apply.OUTCOME).read_text())
    return ci_contrib_pipeline, cams, {o["uuid"][-2:]: o for o in outcome["contributions"]}


def test_every_contribution_gets_its_outcome(contributed):
    _, _, out = contributed
    assert {k: (o["result"], o.get("reason")) for k, o in out.items()} == {
        "a1": ("applied", None),
        "b1": ("superseded", None), "b2": ("applied", None),
        "c1": ("superseded", None), "c2": ("applied", None),
        "d1": ("superseded", None), "d2": ("applied", None),
        "e1": ("conflict", "osm_version"),
        "f1": ("conflict", "osm_deleted"),
        "91": ("applied", None),
        "h1": ("conflict", "same_day"), "h2": ("conflict", "same_day"),
        "i1": ("superseded", None), "i2": ("applied", None),
        "j1": ("applied", None),
        "k1": ("applied", None), "k2": ("applied", None),
        "k3": ("applied", None), "k4": ("applied", None),
        # Phase D3: height and tilt.
        "l1": ("applied", None), "l2": ("applied", None), "l3": ("applied", None),
        "l4": ("applied", None), "l5": ("applied", None), "l6": ("applied", None),
        "l7": ("validated", "no_height"),
        # Phase "Ajouter" (tests/test_add.py): an add alone, an add with its three answers,
        # an add an OSM camera was mapped beside since.
        "01": ("applied", None),
        "02": ("applied", None), "21": ("applied", None), "22": ("applied", None),
        "23": ("applied", None),
        "03": ("conflict", "duplicate"),
    }  # fmt: skip
    # The version the deploy writes: the extract's; the element's state now for conflicts.
    assert out["e1"]["osm_version"] == 3 and out["e1"]["now"]["tags"]["man_made"]
    assert out["f1"]["osm_version"] is None and "now" not in out["f1"]
    assert out["a1"]["osm_version"] == 2 and "now" not in out["a1"]


def test_the_contributed_build_changes_its_id(contributed, ci_pipeline):
    region, _, _ = contributed
    a = json.loads((region.build_dir / "tiles" / "meta.json").read_text())["build_id"]
    b = json.loads((ci_pipeline.build_dir / "tiles" / "meta.json").read_text())["build_id"]
    assert a != b and a.rsplit("-", 1)[0] == b.rsplit("-", 1)[0]


def test_moved_cameras_are_at_their_final_position(contributed):
    _, cams, _ = contributed
    for cid, uid in (("n1925222790", "a1"), ("n1923568246", "b2"), ("n1925167449", "91"),
                     ("n1933603476", "i2")):  # fmt: skip
        row = next(r for r in _fixture() if r["uuid"].endswith(uid))
        p = cams.loc[cid].geometry
        assert (p.x, p.y) == (row["x"], row["y"]), cid
        assert cams.loc[cid].position_certainty == "identified"
        assert cams.loc[cid].position_source == "contribution"
        assert cams.loc[cid].position_month == "2026-09"
    # Conflicts and ties leave the OSM position.
    for cid in ("n1891366478", "n1923568269"):
        assert pd.isna(cams.loc[cid].position_source), cid


def test_gone_camera_films_nothing_counts_nothing_and_keeps_its_pictogram(contributed, ci_pipeline):
    region, cams, _ = contributed
    b = region.build_dir
    assert bool(cams.loc["n1923568277"].gone) and cams.loc["n1923568277"].gone_month == "2026-09"
    for cid in ("n1925180657", "n1933603476"):  # brought back
        assert not cams.loc[cid].gone, cid
    views = gpd.read_parquet(b / "views.parquet")
    bands = gpd.read_parquet(b / "bands.parquet")
    assert "n1923568277" not in set(views.camera_id) | set(bands.camera_id)
    portions = gpd.read_parquet(b / "street_portions.parquet")
    assert not any("n1923568277" in c for c in portions.cameras)
    before = pd.read_parquet(ci_pipeline.build_dir / "areas.parquet")
    after = pd.read_parquet(b / "areas.parquet")
    for level in ("commune", "departement"):  # one camera fewer, two added (add00001, 2)
        n = [int(t[t.level == level].camera_count.sum()) for t in (before, after)]
        assert n[1] == n[0] - 1 + 2, level
    feats = _camera_features(region)
    assert feats["n1923568277"]["gm"] == "2026-09"


def test_tiles_carry_months_only(contributed):
    region, _, _ = contributed
    feats = _camera_features(region)
    assert feats["n1925222790"]["pm"] == "2026-09" and feats["n1925222790"]["vm"] == "2026-09"
    assert feats["n1925180657"]["vm"] == "2026-10" and "pm" not in feats["n1925180657"]
    assert feats["n1925222795"]["vm"] == "2026-09"
    assert not {"pm", "vm", "gm"} & feats["n1891366478"].keys()
    for f in feats.values():
        for k in ("pm", "vm", "gm"):
            assert k not in f or len(f[k]) == 7


def test_a_sighting_counts_as_a_check_for_the_freshness(contributed, ci_pipeline):
    # n1925222795 was never surveyed (bucket 3, "jamais"); seen in 2026-09 it is < 1 year.
    before = _camera_features(ci_pipeline)["n1925222795"]["fl"] % 4
    after = _camera_features(contributed[0])["n1925222795"]["fl"] % 4
    assert (before, after) == (3, 0)


def test_the_moved_position_check_camera_gets_a_field(contributed, ci_pipeline):
    # a1 was flagged "position ou direction à vérifier" (a field under 10 m2); moved, its
    # recomputed field says it no longer is.
    assert _camera_features(ci_pipeline)["n1925222790"].get("pv") == 1
    assert "pv" not in _camera_features(contributed[0])["n1925222790"]


def test_applied_field_is_the_live_field_the_contributor_saw(contributed, pg_loaded, pg_dsn):
    # /api/preview at the contribution's position, on the build it was made on (pg_loaded:
    # the La Défense build without contribution), against the contributed build's bands.
    region, _, _ = contributed
    b = region.build_dir
    views = gpd.read_parquet(b / "views.parquet").set_index("camera_id")
    bands = gpd.read_parquet(b / "bands.parquet")
    compared = 0
    with psycopg.connect(pg_dsn) as conn:
        for cid, uid in (("n1925222790", "a1"), ("n1923568246", "b2"),
                         ("n1925167449", "91"), ("n1933603476", "i2")):  # fmt: skip
            row = next(r for r in _fixture() if r["uuid"].endswith(uid))
            cam = live.camera(conn, cid)
            polys = live.buildings_near(conn, row["x"], row["y"], live.fetch_radius(cam))
            f = live.field(cam, row["x"], row["y"], polys)
            v = views.loc[cid]
            assert (f["snapped"], f["snap_m"]) == (v.snapped, v.snap_m), cid
            assert shapely.equals(f["view"], v.geometry), cid
            want = {(r.level, r.band): (shapely.to_wkb(r.geometry), r.reach_m)
                    for r in bands[bands.camera_id == cid].itertuples()}  # fmt: skip
            got = {(x["level"], x["band"]): (x["wkb"], x["reach_m"]) for x in f["bands"]}
            assert got == want, cid
            compared += len(got)
        # The arcade case: the free position lies in a footprint, under its roof: the batch
        # keeps it and that building does not cut the field (camerafield.field).
        v = views.loc["n1925167449"]
        assert v.under_roof and not v.snapped and v.snap_m == 0 and v.area_m2 > 0
    assert compared > 20


def test_the_database_export_carries_the_new_position(contributed, tmp_path):
    region, cams, _ = contributed
    db.export(region, tmp_path, workers=2)
    with gzip.open(tmp_path / "cameras.tsv.gz", "rt") as f:
        rows = {r.split("\t")[0]: r.split("\t") for r in f.read().splitlines()}
    p = cams.loc["n1923568246"].geometry
    want = shapely.to_wkb(shapely.set_srid(p, 2154), hex=True, include_srid=True)
    assert rows["n1923568246"][5] == want
    assert "n1923568277" in rows  # a gone camera stays: "elle est là" brings it back
    # Where the position comes from (migration 013): the API's field at it is the batch's.
    # The column before the street (migration 019, the last one).
    assert rows["n1925167449"][-2] == "contribution" and rows["n1923568277"][-2] == r"\N"


def test_at_the_served_position_of_a_camera_under_a_roof_the_api_draws_the_batch_field(
    contributed, pg_loaded, pg_dsn
):
    # Once the arcade move is applied, the served position is the contribution's: the API
    # (live.field at the served position) keeps it under its roof as the batch did.
    region, cams, _ = contributed
    v = gpd.read_parquet(region.build_dir / "views.parquet").set_index("camera_id")
    v = v.loc["n1925167449"]
    p = cams.loc["n1925167449"].geometry
    with psycopg.connect(pg_dsn) as conn:
        osm = live.camera(conn, "n1925167449")
        polys = live.buildings_near(conn, p.x, p.y, live.fetch_radius(osm))
    served = dataclasses.replace(osm, x=p.x, y=p.y, position_source="contribution")
    f = live.field(served, p.x, p.y, polys)
    assert f["under_roof"] and (f["x"], f["y"]) == (p.x, p.y) and not f["snapped"]
    assert shapely.equals(f["view"], v.geometry)
    # The same position served from OSM is a mapping one: snapped out, as before.
    mapped = live.field(dataclasses.replace(served, position_source=None), p.x, p.y, polys)
    assert mapped["snapped"] and not mapped["under_roof"]


def _fixture() -> list[dict]:
    return [json.loads(line) for line in FIXTURE.read_text().splitlines()]


def _camera_features(region) -> dict[str, dict]:
    path = region.build_dir / "tiles_src" / "cameras.geojsonl"
    out = {}
    for line in path.read_text().splitlines():
        f = json.loads(line.lstrip("\x1e"))
        out[f["properties"]["id"]] = f["properties"]
    return out


def test_the_report_gives_before_and_after_and_the_areas_that_changed(contributed, ci_pipeline):
    from lacarte import contrib

    region, _, _ = contributed
    rep = contrib.report(region, ci_pipeline.build_dir)
    rows = {r["uuid"][-2:]: r for r in rep["contributions"]}
    b2 = rows["b2"]
    assert b2["result"] == "applied" and b2["moved_m"] > 5
    assert b2["before"]["field_m2_standard"] != b2["after"]["field_m2_standard"]
    gone = rows["d2"]
    assert gone["after"]["gone"] and gone["after"]["street_m_prudent"] == 0.0
    assert gone["before"]["street_m_prudent"] > 0
    assert {a["level"] for a in rep["areas"]} == {"commune", "departement"}
    for level in ("commune", "departement"):  # one gone, two added
        diff = [a["camera_count_after"] - a["camera_count_before"] for a in rep["areas"]
                if a["level"] == level]  # fmt: skip
        assert sum(diff) == 1, level
    added = rows["01"]  # an add: no camera before, one after
    assert added["before"] is None and added["after"]["field_m2_prudent"] > 0


# --- "Compléter" (phase D2): rules on synthetic rows ---------------------------------------

TAGS = {"camera:type": "dome", "operator": "X", "surveillance": "outdoor"}


def D(uid, kind, rank, month="2026-10", camera="n1", version=1, tags=None, **kw):
    if kind == "direction":
        kw.setdefault("x", 0.0)
        kw.setdefault("y", 0.0)
    return apply.Contribution(U(uid), kind, camera, version, month, rank,
                              tags=dict(TAGS if tags is None else tags), **kw)  # fmt: skip


def osm(version=1, tags=None, xy=(0.0, 0.0), kind="dome"):
    return {"n1": apply.Osm(version, dict(TAGS if tags is None else tags), xy, kind)}


def test_a_d2_answer_conflicts_only_when_its_own_tags_changed():
    rows = [D("s1", "shape", 1, answer="bullet"), D("o1", "operator", 1, answer="business")]
    # Version 2 changed a tag the operator answer reads, not the shape's.
    got, states = results(rows, osm(2, {**TAGS, "operator": "Y"}))
    assert got == {"s1": ("applied", None), "o1": ("conflict", "osm_tags")}
    assert states["n1"].kind == "fixed" and states["n1"].operator is None
    # A move made on version 1 still conflicts on version 2, whatever changed.
    got, _ = results([C("m1", "move", 1)], osm(2))
    assert got == {"m1": ("conflict", "osm_version")}
    # The shape reads surveillance:type and camera:mount too.
    got, _ = results([D("s2", "shape", 1, answer="dome")],
                     osm(2, {**TAGS, "surveillance:type": "ALPR"}))  # fmt: skip
    assert got == {"s2": ("conflict", "osm_tags")}


def test_a_direction_is_refused_on_a_kind_without_one_or_a_camera_moved_away():
    got, states = results([D("d1", "direction", 1, direction=90)], osm(kind="ptz"))
    assert got == {"d1": ("conflict", "kind")} and states["n1"].direction is None
    # A validated shape makes it a PTZ: same.
    got, _ = results([D("d1", "direction", 1, direction=90), D("s1", "shape", 1, answer="ptz")],
                     osm())  # fmt: skip
    assert got["d1"] == ("conflict", "kind") and got["s1"] == ("applied", None)
    # Aimed from (0, 0); OSM now has the camera 6 m away (rule moved_max_m 5).
    outcome, _ = apply.settle([D("d1", "direction", 1, direction=90)], osm(xy=(6.0, 0.0)))
    assert outcome[U("d1")] == {"result": "conflict", "reason": "moved", "moved_m": 6.0}
    # ...or a validated move puts it there.
    got, _ = results([D("d1", "direction", 2, direction=90), C("m1", "move", 1, x=0.0, y=7.0)],
                     osm())  # fmt: skip
    assert got["d1"] == ("conflict", "moved")
    got, states = results([D("d1", "direction", 1, direction=90)], osm(xy=(4.0, 0.0)))
    assert got == {"d1": ("applied", None)} and states["n1"].direction == 90


def test_the_latest_shape_and_direction_win_and_ties_conflict():
    got, states = results([D("s1", "shape", 1, answer="dome"), D("s2", "shape", 2, answer="ptz"),
                           D("d1", "direction", 1, direction=10),
                           D("d2", "direction", 3, direction=20)], osm())  # fmt: skip
    assert got["s1"][0] == "superseded" and got["s2"] == ("applied", None)
    # The latest shape is a PTZ: no direction applies.
    assert got["d1"] == got["d2"] == ("conflict", "kind")
    assert states["n1"].kind == "ptz"
    got, states = results([D("s1", "shape", 1, answer="dome"),
                           D("s2", "shape", 1, answer="bullet")], osm())  # fmt: skip
    assert got == {"s1": ("conflict", "same_day"), "s2": ("conflict", "same_day")}
    # A tie on a shape does not leave presence undecided: the camera was seen.
    assert states["n1"].kind is None and states["n1"].seen_month == "2026-10"


def test_operator_answers_that_disagree_leave_what_differs_unknown():
    same = [D("o1", "operator", 1, answer="public", operator_name="Ville de A"),
            D("o2", "operator", 2, answer="public")]  # fmt: skip
    got, states = results(same, osm())
    assert got == {"o1": ("applied", None), "o2": ("applied", None)}
    assert states["n1"].operator == ("public", "Ville de A")
    names = [D("o1", "operator", 1, answer="public", operator_name="Ville de A"),
             D("o2", "operator", 2, answer="public", operator_name="RATP")]  # fmt: skip
    got, states = results(names, osm())
    assert got["o1"] == got["o2"] == ("applied", "diverge")
    assert states["n1"].operator == ("public", None)
    classes = [
        D("o1", "operator", 1, answer="business"),
        D("o2", "operator", 1, answer="household"),
    ]
    got, states = results(classes, osm())
    assert got["o1"] == ("applied", "diverge") and states["n1"].operator == (None, None)


def test_the_latest_height_wins_and_a_tie_conflicts():
    got, states = results([D("h1", "height", 1, answer="ground"),
                           D("h2", "height", 2, answer="upper")], osm())  # fmt: skip
    assert got == {"h1": ("superseded", None), "h2": ("applied", None)}
    assert (states["n1"].height, states["n1"].height_month) == ("upper", "2026-10")
    got, states = results([D("h1", "height", 1, answer="ground"),
                           D("h2", "height", 1, answer="first")], osm())  # fmt: skip
    assert got == {"h1": ("conflict", "same_day"), "h2": ("conflict", "same_day")}
    assert states["n1"].height is None


def test_a_tilt_waits_for_a_height_and_needs_a_tube_or_a_small_dome():
    tube = osm(kind="fixed")
    # No height anywhere: kept validated, without effect, until a build has one.
    got, states = results([D("t1", "tilt", 1, answer="slight")], tube)
    assert got == {"t1": ("validated", "no_height")} and states["n1"].tilt is None
    # A height answer, or OSM's height tag, lets it apply.
    got, states = results([D("t1", "tilt", 2, answer="slight"),
                           D("h1", "height", 1, answer="first")], tube)  # fmt: skip
    assert got == {"t1": ("applied", None), "h1": ("applied", None)}
    assert (states["n1"].tilt, states["n1"].height) == ("slight", "first")
    got, _ = results([D("t1", "tilt", 1, answer="steep")],
                     osm(tags={**TAGS, "height": "4"}, kind="fixed"))  # fmt: skip
    assert got == {"t1": ("applied", None)}
    # A small dome takes it too (questions@5), OSM's kind or a validated shape.
    got, states = results([D("t1", "tilt", 1, answer="slight"),
                           D("h1", "height", 1, answer="first")], osm(kind="dome"))  # fmt: skip
    assert got["t1"] == ("applied", None) and states["n1"].tilt == "slight"
    got, _ = results([D("t1", "tilt", 1, answer="steep"), D("h1", "height", 1, answer="first"),
                      D("s1", "shape", 2, answer="dome")], tube)  # fmt: skip
    assert got["t1"] == ("applied", None) and got["s1"] == ("applied", None)
    # A panorama or a PTZ (OSM's, or a validated shape) makes it a conflict, reason kind.
    got, _ = results([D("t1", "tilt", 1, answer="slight"),
                      D("h1", "height", 1, answer="first")], osm(kind="panorama"))  # fmt: skip
    assert got["t1"] == ("conflict", "kind")
    got, _ = results([D("t1", "tilt", 1, answer="slight"), D("h1", "height", 1, answer="first"),
                      D("s1", "shape", 2, answer="ptz")], tube)  # fmt: skip
    assert got["t1"] == ("conflict", "kind") and got["s1"] == ("applied", None)
    # Two classes on a tie conflict.
    got, _ = results([D("t1", "tilt", 1, answer="slight"), D("t2", "tilt", 1, answer="steep"),
                      D("h1", "height", 1, answer="first")], tube)  # fmt: skip
    assert got["t1"] == got["t2"] == ("conflict", "same_day")


def test_height_and_tilt_conflict_only_when_their_own_tags_changed():
    tags = {**TAGS, "camera:type": "fixed"}
    rows = [D("h1", "height", 1, answer="first", tags=tags),
            D("t1", "tilt", 2, answer="slight", tags=tags)]  # fmt: skip
    got, _ = results(rows, osm(2, {**tags, "operator": "Y"}, kind="fixed"))
    assert got == {"h1": ("applied", None), "t1": ("applied", None)}
    got, _ = results(rows, osm(2, {**tags, "camera:height": "6"}, kind="fixed"))
    assert got["h1"] == ("conflict", "osm_tags")
    assert got["t1"] == ("validated", "no_height")  # its height is gone with h1
    got, _ = results(rows, osm(2, {**tags, "camera:angle": "30"}, kind="fixed"))
    assert got == {"h1": ("applied", None), "t1": ("conflict", "osm_tags")}


def test_height_and_tilt_overrides_take_the_classes_values():
    over = apply.overrides(apply.State(height="upper", tilt="steep"), {})
    assert (over.height_m, over.tilt_deg) == (7.0, 45.0)
    row, _ = normalize.normalize_row("n1", 1, None, json.dumps({"camera:type": "fixed"}), over)
    assert (row["height_m"], row["height_certainty"], row["tilt_deg"]) == (7.0, "estimated", 45.0)
    # An OSM tilt with a default height is unused (no mount); a height answer makes it count.
    tags = json.dumps({"camera:type": "dome", "camera:angle": "-30"})
    plain, _ = normalize.normalize_row("n1", 1, None, tags)
    assert plain["height_certainty"] == "default" and plain["tilt_deg"] == 30.0
    assert camerafield.mount(plain["tilt_deg"], plain["height_m"], "default") is None
    over = apply.overrides(apply.State(height="upper"), json.loads(tags))
    row, _ = normalize.normalize_row("n1", 1, None, tags, over)
    assert camerafield.mount(row["tilt_deg"], row["height_m"], row["height_certainty"]) == (
        7.0, 30.0)  # fmt: skip
    assert apply.overrides(apply.State(), {}) is None


def test_overrides_put_a_private_individual_indoors_when_the_tags_say_so():
    s = apply.State(operator=("household", None))
    over = apply.overrides(s, {"surveillance": "indoor"})
    assert over.operator == ("private_indoor", None, True)
    assert apply.overrides(apply.State(operator=(None, None)), {}).operator == (
        "unknown", None, False)  # fmt: skip
    assert apply.operator_kind(s) == "household"


# --- "Compléter": the frozen cases of tests/fixtures/contrib-ci.jsonl ------------------------


def test_a_shape_answer_changes_the_kind_and_its_optics(contributed, ci_pipeline):
    region, cams, _ = contributed
    before = gpd.read_parquet(ci_pipeline.build_dir / apply.CAMERAS).set_index("camera_id")
    c, b = cams.loc["n5442645359"], before.loc["n5442645359"]
    assert (b.kind, b.kind_certainty) == ("unknown", "default")
    assert (c.kind, c.kind_certainty, c.kind_month) == ("fixed", "estimated", "2026-10")
    assert (c.fov_hi, c.range_m) != (b.fov_hi, b.range_m)
    f = _camera_features(region)["n5442645359"]
    assert (f["k"], f["kc"], f["km"]) == ("fixed", 1, "2026-10")


def test_a_direction_answer_turns_the_full_circle_into_a_sector(contributed, ci_pipeline):
    region, cams, _ = contributed
    c = cams.loc["n998633844"]
    assert list(c.directions) == [180.0] and c.direction_certainty == "estimated"
    f = _camera_features(region)["n998633844"]
    assert (f["d"], f["dc"], f["dm"]) == (180, 1, "2026-10")
    # No longer "direction non relevée": its fields' direction certainty `c` (the classique
    # hatches c == 0) goes from default to estimated.
    assert _bands_certainty(ci_pipeline, "n998633844") == {0}
    assert _bands_certainty(region, "n998633844") == {1}
    a = gpd.read_parquet(region.build_dir / "views.parquet").set_index("camera_id")
    b = gpd.read_parquet(ci_pipeline.build_dir / "views.parquet").set_index("camera_id")
    assert a.loc["n998633844"].area_m2 < b.loc["n998633844"].area_m2


def test_a_private_individual_carries_no_cnil_signal(contributed, ci_pipeline):
    region, cams, _ = contributed
    assert _camera_features(ci_pipeline)["n1864927349"]["cnil"] == 1
    f = _camera_features(region)["n1864927349"]
    assert (f["cnil"], f["ok"], f["om"], f["o"]) == (0, "h", "2026-10", "pro")
    assert cams.loc["n1864927349"].operator_kind == "household"


def test_a_public_answer_with_a_name_sets_class_and_name(contributed):
    region, cams, _ = contributed
    c = cams.loc["n9622344411"]
    assert (c.operator_class, c.operator_norm, c.operator_name) == (
        "public", "Ville de Courbevoie", "Ville de Courbevoie")  # fmt: skip
    assert _camera_features(region)["n9622344411"]["o"] == "pub"


def test_the_direction_preview_is_the_field_the_build_draws(contributed, pg_loaded, pg_dsn):
    """/api/preview with a direction, on the build the answer was made on, against the
    contributed build's bands: the contributor saw what the map will draw."""
    region, _, _ = contributed
    bands = gpd.read_parquet(region.build_dir / "bands.parquet")
    row = next(r for r in _fixture() if r["uuid"].endswith("k2"))
    with psycopg.connect(pg_dsn) as conn:
        cam = live.aimed(live.camera(conn, "n998633844"), row["direction"])
        polys = live.buildings_near(conn, cam.x, cam.y, live.fetch_radius(cam))
        f = live.field(cam, cam.x, cam.y, polys)
    want = {(r.level, r.band): (shapely.to_wkb(r.geometry), r.reach_m)
            for r in bands[bands.camera_id == "n998633844"].itertuples()}  # fmt: skip
    got = {(x["level"], x["band"]): (x["wkb"], x["reach_m"]) for x in f["bands"]}
    assert got == want and len(got) > 3


def test_a_height_and_a_tilt_give_a_tube_its_blind_zone(contributed, ci_pipeline):
    region, cams, _ = contributed
    c = cams.loc["n12035135119"]
    assert (c.kind, list(c.directions)) == ("fixed", [90.0])
    assert (c.height_m, c.height_certainty, c.tilt_deg) == (4.0, "estimated", 25.0)
    assert (c.height_class, c.height_month, c.tilt_month) == ("first", "2026-10", "2026-10")
    f = _camera_features(region)["n12035135119"]
    assert (f["hk"], f["hm"], f["t"], f["tm"], f["hc"]) == ("first", "2026-10", "slight",
                                                           "2026-10", 1)  # fmt: skip
    # The height was answered on site (bit 256), the tilt was not (512).
    assert f["os"] & apply.ON_SITE["height"] and not f["os"] & apply.ON_SITE["tilt"]
    # Nothing is filmed within the blind zone in front of it, every band starts beyond.
    o = c.geometry  # its position; the field starts from it snapped at most 0.5 m out
    bands = gpd.read_parquet(region.build_dir / "bands.parquet")
    mine = bands[bands.camera_id == "n12035135119"]
    assert len(mine) > 0
    assert all(g.distance(o) > 2.0 for g in mine.geometry)


def test_a_height_alone_changes_no_field(contributed):
    """l5: "1er étage" on k1's tube without a tilt: the height and its chip only."""
    region, cams, _ = contributed
    c = cams.loc["n5442645359"]
    assert (c.height_m, c.height_certainty, c.height_class) == (4.0, "estimated", "first")
    assert c.tilt_deg != c.tilt_deg  # NaN: no tilt, no mount
    assert camerafield.mount(None, c.height_m, c.height_certainty) is None
    f = _camera_features(region)["n5442645359"]
    assert f["hk"] == "first" and "t" not in f and "tm" not in f


def test_a_tilt_without_a_height_stays_validated_without_effect(contributed):
    region, cams, out = contributed
    c = cams.loc["n13610509865"]
    assert (c.kind, c.height_certainty) == ("fixed", "default")
    assert c.tilt_deg != c.tilt_deg and pd.isna(c.tilt_month)
    assert out["l7"]["result"] == "validated" and out["l7"]["reason"] == "no_height"
    assert "t" not in _camera_features(region)["n13610509865"]


def _bands_certainty(region, camera_id: str) -> set:
    """The direction certainty codes `c` of one camera's field pieces in the detail tiles'
    source."""
    from lacarte import tiles

    path = region.build_dir / "tiles_src" / "bands.geojsonl"
    fid = tiles.numeric_id(camera_id)
    out = set()
    for line in path.read_text().splitlines():
        p = json.loads(line.lstrip("\x1e"))["properties"]
        if p.get("i") == fid:
            out.add(p.get("c"))
    return out
