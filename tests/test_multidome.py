"""The multi-dome (DECISIONS 2026-10-23, rules/optics.yaml assemblies): several domes around
one housing, one object. OSM camera:type=dome with camera:count >= 2; its domes' optics,
its field the full circle; counted and filtered as its own kind."""

import json

import geopandas as gpd
import pandas as pd
import pytest
import shapely

from lacarte import aggregate, camerafield, camerafilters, direction, optics, tiles
from lacarte import normalize as n
from lacarte.viewshed import ObstacleIndex

DOME = {"man_made": "surveillance", "camera:type": "dome"}


@pytest.mark.parametrize(
    ("tags", "kind", "count"),
    [
        ({**DOME, "camera:count": "4"}, "multidome", 4),
        ({**DOME, "camera:count": " 2 "}, "multidome", 2),
        ({**DOME, "camera:count": "1"}, "dome", None),
        (DOME, "dome", None),
        # camera:number is an id as often as a count; suffixed keys describe other cameras.
        ({**DOME, "camera:number": "3"}, "dome", None),
        ({**DOME, "camera:type:2": "dome", "camera:type:3": "dome"}, "dome", None),
        # A list, a range or words are no count.
        ({**DOME, "camera:count": "2;3"}, "dome", None),
        ({**DOME, "camera:count": "2-4"}, "dome", None),
        ({**DOME, "camera:count": "many"}, "dome", None),
        # Only domes: several tubes or PTZ at one place are not a multi-dome.
        ({"camera:type": "fixed", "camera:count": "3"}, "fixed", None),
        ({"camera:type": "panning", "camera:count": "2"}, "ptz", None),
        ({"camera:count": "2"}, "unknown", None),
    ],
)
def test_osm_reads_a_multidome_from_a_dome_and_its_count(tags, kind, count):
    assert n.classify_kind(tags) == (kind, n.DEFAULT if kind == "unknown" else n.ESTIMATED)
    row, caps = n.normalize_row("n1", 1, "2026-10-01T00:00:00Z", json.dumps(tags))
    assert row["kind"] == kind and row["dome_count"] == count
    names = {c.name for c in caps}
    assert ("dome_count" in names) == (kind == "multidome")


def test_a_tagged_multidome_has_a_dome_s_optics_and_a_full_circle():
    tags = {**DOME, "camera:count": "4", "camera:direction": "270"}
    row, caps = n.normalize_row("n1", 1, "2026-10-01T00:00:00Z", json.dumps(tags))
    dome, _ = n.normalize_row("n2", 1, "2026-10-01T00:00:00Z", json.dumps(DOME))
    c = {cap.name: cap for cap in caps}
    # The count is a count, read from OSM: identified.
    assert (c["dome_count"].value, c["dome_count"].certainty) == (4, n.IDENTIFIED)
    assert c["dome_count"].source == "osm:camera:count"
    # Each dome is a dome: the same optics and reach, from the dome's catalogue rule.
    for key in ("res_lo", "res_hi", "fov_lo", "fov_hi", "range_m", "night_vision"):
        assert row[key] == dome[key], key
    assert c["hfov_deg"].source == f"rule:optics@{optics.rules()['version']}:distributions.dome"
    assert optics.samples("multidome") == optics.samples("dome")
    # Its opening is the full circle; the one tagged direction is kept, not drawn.
    assert row["fov_deg"] == 360.0 and dome["fov_deg"] < 180
    assert row["directions"] == [270.0] and row["direction_certainty"] == n.ESTIMATED
    assert optics.full_circle("multidome") and not optics.full_circle("dome")
    # Never drawn light: its domes face every way, as a panorama.
    assert "multidome" not in direction.kinds()
    assert not direction.undirected("multidome", [])


def test_an_answer_s_count_is_estimated_and_an_unknown_one_keeps_osm_s():
    tags = json.dumps({**DOME, "camera:count": "5"})
    row, caps = n.normalize_row("n1", 1, None, tags, n.Overrides(kind="multidome", dome_count=3))
    assert (row["kind"], row["kind_certainty"]) == ("multidome", n.ESTIMATED)
    assert (row["dome_count"], row["dome_count_certainty"]) == (3, n.ESTIMATED)
    # « Je ne sais pas » erases nothing: OSM's identified count stays.
    row, _ = n.normalize_row("n1", 1, None, tags, n.Overrides(kind="multidome"))
    assert (row["dome_count"], row["dome_count_certainty"]) == (5, n.IDENTIFIED)
    # Unknown: no number, certainty default, the field still the full circle.
    row, caps = n.normalize_row("c0123456789ab", None, None, "{}", n.Overrides(kind="multidome"))
    c = {cap.name: cap for cap in caps}
    assert (row["dome_count"], row["dome_count_certainty"]) == (None, n.DEFAULT)
    assert c["dome_count"].source == f"rule:optics@{optics.rules()['version']}:assemblies"
    assert row["fov_deg"] == 360.0
    # Another shape over a tagged multi-dome: no count any more.
    row, _ = n.normalize_row("n1", 1, None, tags, n.Overrides(kind="fixed"))
    assert (row["kind"], row["dome_count"], row["dome_count_certainty"]) == ("fixed", None, None)


def _record(kind, directions, x=0.0, y=0.0):
    return {
        "camera_id": "n1", "x": x, "y": y, "directions": directions,
        "fov_deg": optics.opening_deg(kind), "range_m": optics.max_reach(kind),
        "geom_certainty": "default", "kind": kind, "mount": None, "placed": False,
    }  # fmt: skip


def test_a_multidome_s_field_is_the_union_of_its_domes_the_full_circle():
    """With or without a direction, a multi-dome films what a dome of unknown direction
    may film: every way around, each dome's reach, cut by the same buildings."""
    x0, y0 = 646300.0, 6867400.0
    blds = [
        shapely.box(x0 + 5, y0 - 10, x0 + 25, y0 + 10),
        shapely.box(x0 - 40, y0 + 30, x0 - 20, y0 + 50),
    ]
    around = camerafield.field(_record("dome", [], x0, y0), ObstacleIndex(blds), with_qa=False)
    for dirs in ([], [90.0], [0.0, 180.0]):
        got = camerafield.field(_record("multidome", dirs, x0, y0), ObstacleIndex(blds),
                                with_qa=False)  # fmt: skip
        assert got["view"].equals(around["view"]), dirs
        assert [(b["level"], b["band"]) for b in got["bands"]] == [
            (b["level"], b["band"]) for b in around["bands"]
        ]
        for a, b in zip(got["bands"], around["bands"], strict=True):
            assert shapely.from_wkb(a["wkb"]).equals(shapely.from_wkb(b["wkb"]))
    # A dome with that direction films a sector only.
    one = camerafield.field(_record("dome", [90.0], x0, y0), ObstacleIndex(blds), with_qa=False)
    assert one["view"].area < 0.5 * around["view"].area


def test_areas_count_multidomes_as_their_own_kind():
    assert aggregate.KINDS[:2] == ["dome", "multidome"]
    cams = pd.DataFrame({
        "camera_id": ["n1", "n2", "n3", "n4"], "commune": "92062",
        "kind": ["dome", "multidome", "multidome", "fixed"],
        "operator_class": ["public"] * 4, "fresh": 1.0, "dir_known": False,
        "type_known": True, "recent": True,
    })  # fmt: skip
    roads = pd.DataFrame({"road_m": [100.0], **dict.fromkeys(aggregate.FILMED, 0.0)},
                         index=pd.Index(["92062"], name="commune"))  # fmt: skip
    df = aggregate.summarise(roads, cams, "commune")
    assert (df.n_kind_dome.iloc[0], df.n_kind_multidome.iloc[0]) == (1, 2)
    assert "multidome" in camerafilters.KIND_ORDER
    mask = camerafilters.camera_mask("public", "multidome", 3)
    on = {k for k, bit in camerafilters.SEGMENT_BITS.items() if (mask >> bit) & 1}
    assert on == {"op:pub", "kind:multidome", "fresh_never"}


def test_a_multidome_s_tile_feature_carries_its_count_and_its_certainty():
    rows = [n.normalize_row(i, 1, "2026-10-01T00:00:00Z", json.dumps(t))[0] for i, t in (
        ("n1", {**DOME, "camera:count": "4"}), ("n2", DOME))]  # fmt: skip
    cams = gpd.GeoDataFrame(rows, geometry=[shapely.Point(0, 0), shapely.Point(1, 0)])
    views = pd.DataFrame({"camera_id": ["n1", "n2"], "snapped": False,
                          "inside_building": False, "area_m2": 500.0})  # fmt: skip
    street = pd.DataFrame({"cnil_signal": []}, index=pd.Index([], name="camera_id"))
    filters = {"n1": {"fl": 0}, "n2": {"fl": 0}}
    feats = [json.loads(f)["properties"] for f in tiles._camera_features(
        cams, views, street, filters, {"n1": 0, "n2": 1})]  # fmt: skip
    assert (feats[0]["k"], feats[0]["dn"], feats[0]["dnc"]) == ("multidome", 4, 2)
    assert feats[0]["fov"] == feats[1]["fov"]  # a dome's, per lens
    assert "dn" not in feats[1] and "dnc" not in feats[1]


def test_the_meta_says_what_a_multidome_is_made_of():
    areas = pd.DataFrame({"level": [], "camera_count": [], **{
        f"filmed_ratio_{e}{s}": [] for e in tiles.ESTIMATES for s in ("", "_pub")}})  # fmt: skip
    m = tiles.meta(areas)
    assert m["assemblies"] == {"multidome": {"optics_of": "dome", "opening_deg": 360}}
