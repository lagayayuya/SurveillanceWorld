"""Frozen fields: the view, the PTZ outline and every band (with its reach) of a few
cameras computed by camerafield.field, the batch's and the API's per-camera work, frozen at
commit c5725cf, before the direction rule (fixed_first_floor_slight: phase D3). A change
to a camera's field shows up here.

Bands are compared vertex by vertex within one step of their 1 mm grid, not byte for byte:
the same code on Linux x86_64 moved one vertex of one band by a grid step (0.84 mm) against
macOS arm64 (float noise in the arc before snapping). Views within a micrometre.

    UPDATE_FROZEN_FIELDS=1 uv run pytest tests/test_frozen_fields.py   # regenerate
"""

import gzip
import json
import os
from pathlib import Path

import pytest
import shapely
from shapely import Polygon, box

from lacarte import camerafield, normalize, optics
from lacarte.viewshed import ObstacleIndex

FILE = Path(__file__).parent / "fixtures" / "band-fields.json.gz"
GRID_STEP_M = 0.0011  # one step of the 1 mm grid, plus float slack
VIEW_TOLERANCE_M = 1e-6

# Lambert-93 coordinates, as in the pipeline (GEOS behaves differently near 6.8e6 m).
X0, Y0 = 646300.0, 6867400.0
BLOCK = box(X0, Y0, X0 + 30, Y0 + 40)  # a block; its west facade at x = X0
CORNER = Polygon([(X0, Y0), (X0 + 20, Y0), (X0 + 20, Y0 + 8), (X0 + 8, Y0 + 8),
                  (X0 + 8, Y0 + 20), (X0, Y0 + 20)])  # fmt: skip
FAR = box(X0 + 60, Y0 - 50, X0 + 80, Y0 + 50)
# A garage 8 m deep on a street 20 m wide (its facade at y = Y0), the row across the street.
GARAGE = box(X0, Y0, X0 + 20, Y0 + 8)
ACROSS = box(X0 - 20, Y0 - 32, X0 + 40, Y0 - 20)
# A block 60 m deep (a prepared footprint is a whole merged block), its west facade at x = X0.
DEEP = box(X0, Y0 - 20, X0 + 60, Y0 + 60)

# name -> (kind, directions, mount (height, tilt) or None, position, buildings)
CASES = {
    "dome_directed": ("dome", [270.0], None, (X0 - 0.5, Y0 + 20), [BLOCK, FAR]),
    "fixed_directed_tilted": ("fixed", [70.0], (4.0, 12.0), (X0 - 20, Y0 + 5), [BLOCK, FAR]),
    # Phase D3: a tube at 5 m ("1er étage") tilted 25 degrees ("un peu vers le bas"),
    # aimed at the facade 20 m east: a blind zone under it.
    "fixed_first_floor_slight": (
        "fixed",
        [90.0],
        (5.0, 25.0),
        (X0 - 20, Y0 + 30),
        [BLOCK, FAR],
    ),  # fmt: skip
    # Questions@5: dome_directed at « ~4 m », tilted « un peu vers le bas » (25 degrees).
    "dome_directed_tilted": ("dome", [270.0], (4.0, 25.0), (X0 - 0.5, Y0 + 20), [BLOCK, FAR]),
    "dome_two_directions": ("dome", [0.0, 180.0], None, (X0 - 6, Y0 + 20), [BLOCK]),
    "alpr_directed": ("alpr", [200.0], None, (X0 + 40, Y0 + 20), [BLOCK, FAR]),
    "ptz_no_direction": ("ptz", [], None, (X0 - 0.5, Y0 + 10), [BLOCK, FAR]),
    "ptz_directed": ("ptz", [90.0], None, (X0 + 45, Y0), [BLOCK, FAR]),
    "panorama_no_direction": ("panorama", [], None, (X0 + 45, Y0 + 60), [BLOCK, FAR]),
    # DECISIONS 2026-10-23: a multi-dome at dome_directed's place, its one OSM direction not
    # drawn: the full circle, each dome's reach.
    "multidome_one_direction": ("multidome", [270.0], None, (X0 - 0.5, Y0 + 20), [BLOCK, FAR]),
    "dome_wall_no_direction": ("dome", [], None, (X0 + 1, Y0 + 20), [BLOCK, FAR]),
    "dome_pole_no_direction": ("dome", [], None, (X0 - 8, Y0 + 20), [BLOCK, FAR]),
    "dome_corner_no_direction": ("dome", [], (3.0, 20.0), (X0 + 7, Y0 + 7), [CORNER, FAR]),
    "fixed_no_direction": ("fixed", [], None, (X0 - 0.2, Y0 + 5), [BLOCK]),
    "unknown_no_direction": ("unknown", [], None, (X0 + 45, Y0 + 20), [BLOCK, FAR]),
    "alpr_no_direction": ("alpr", [], None, (X0 - 3, Y0 - 5), [BLOCK, FAR]),
    # DECISIONS 2026-10-08 (« Placing a camera is always free… »): placed by a participant
    # under the garage's entrance, 5 m in, nearer its back wall, aimed at the street.
    "garage_entrance_placed": ("fixed", [180.0], None, (X0 + 10, Y0 + 5), [GARAGE, ACROSS]),
    # DECISIONS 2026-10-08 (« A camera placed by a participant… »): placed in a porch 3 m
    # into a deep block, no direction: the block is no obstacle within 10 m of it only.
    "porch_deep_block_placed": ("dome", [], None, (X0 + 3, Y0 + 20), [DEEP]),
}
# Positions a participant placed (an add, a move).
PLACED = {"garage_entrance_placed", "porch_deep_block_placed"}


def record(name: str) -> dict:
    kind, directions, mount, (x, y), _ = CASES[name]
    return {
        "camera_id": f"n{name}",
        "x": x,
        "y": y,
        "directions": directions,
        "fov_deg": optics.opening_deg(kind),  # normalize's: the samples' widest, or 360
        "range_m": normalize.max_reach(kind),
        "geom_certainty": "default",
        "kind": kind,
        "mount": mount,
        "placed": name in PLACED,
    }


def hexwkb(geom) -> str | None:
    return None if geom is None else shapely.to_wkb(geom, hex=True)


def fields(name: str) -> dict:
    f = camerafield.field(record(name), ObstacleIndex(CASES[name][4]), with_qa=False)
    bands = {f"{b['level']}:{b['band']}": [b["wkb"].hex(), b["reach_m"]] for b in f["bands"]}
    return {
        "origin": [f["x"], f["y"]],
        "view": hexwkb(f["view"]),
        "reach": hexwkb(f["reach"]),
        "bands": dict(sorted(bands.items())),
    }


def frozen() -> dict:
    return json.loads(gzip.decompress(FILE.read_bytes()))


def same_shape(got_hex: str | None, want_hex: str | None, tolerance: float) -> bool:
    if got_hex is None or want_hex is None:
        return got_hex == want_hex
    got, want = (shapely.normalize(shapely.from_wkb(h)) for h in (got_hex, want_hex))
    return shapely.get_num_coordinates(got) == shapely.get_num_coordinates(want) and bool(
        shapely.equals_exact(got, want, tolerance)
    )


def assert_same_field(got: dict, want: dict) -> None:
    assert got["origin"] == pytest.approx(want["origin"], abs=VIEW_TOLERANCE_M)
    assert same_shape(got["view"], want["view"], VIEW_TOLERANCE_M), "view"
    assert same_shape(got["reach"], want["reach"], VIEW_TOLERANCE_M), "PTZ outline"
    assert set(got["bands"]) == set(want["bands"])
    for key, (wkb, reach) in want["bands"].items():
        assert same_shape(got["bands"][key][0], wkb, GRID_STEP_M), key
        assert got["bands"][key][1] == pytest.approx(reach, abs=GRID_STEP_M), key


def test_regenerate():
    if os.environ.get("UPDATE_FROZEN_FIELDS") != "1":
        pytest.skip("set UPDATE_FROZEN_FIELDS=1 to rewrite the frozen fields")
    data = json.dumps({n: fields(n) for n in CASES}, sort_keys=True).encode()
    FILE.write_bytes(gzip.compress(data, 9, mtime=0))


def test_every_case_is_frozen():
    assert set(frozen()) == set(CASES)


@pytest.mark.parametrize("name", list(CASES))
def test_field_is_unchanged(name):
    assert_same_field(fields(name), frozen()[name])


def test_a_tube_at_5_m_tilted_25_degrees_films_nothing_under_it():
    """The blind zone: no band comes nearer than the lowest ray of the widest sample
    (optics.sample_extent), and without the mount the same tube films from its foot."""
    name = "fixed_first_floor_slight"
    kind, _, (h, tilt), _, _ = CASES[name]
    near = min(optics.sample_extent(r, f, 25.0, optics.Mount(h, tilt), 1e9)[0]
               for r, f, _ in optics.samples(kind))  # fmt: skip
    assert 2.0 < near < h  # metres, for the catalogue's tubes
    got = fields(name)
    origin = shapely.Point(got["origin"])
    for key, (wkb, _) in got["bands"].items():
        assert shapely.from_wkb(wkb).distance(origin) >= near - GRID_STEP_M, key
    flat = camerafield.field({**record(name), "mount": None}, ObstacleIndex(CASES[name][4]),
                             with_qa=False)  # fmt: skip
    assert min(shapely.Point(flat["x"], flat["y"]).distance(b) for b in
               (shapely.from_wkb(b["wkb"]) for b in flat["bands"])) < 0.01  # fmt: skip


def test_a_small_dome_s_tilt_gives_it_a_blind_zone_and_caps_its_reach():
    """Questions@5: a small dome takes the tilt as a tube does, the same model on its own
    lens samples (optics.sample_extent): at 4 m tilted 25 degrees, the widest lens sees
    nothing within 2.27 m of its foot, the narrowest within 5.55 m, and the upper edge of
    the image, below the horizon, caps the reach on the ground. Same dome, same place
    without the mount: every band from its foot, 177 m of detection."""
    kind, _, (h, tilt), _, _ = CASES["dome_directed_tilted"]
    extents = [optics.sample_extent(r, f, 25.0, optics.Mount(h, tilt), 1e9)
               for r, f, _ in optics.samples(kind)]  # fmt: skip
    near = [n for n, _ in extents]
    assert (min(near), max(near)) == (pytest.approx(2.269, abs=1e-3),
                                      pytest.approx(5.552, abs=1e-3))  # fmt: skip
    flat, tilted = fields("dome_directed"), fields("dome_directed_tilted")
    for got in (flat, tilted):
        origin = shapely.Point(got["origin"])
        nearest = min(shapely.from_wkb(w).distance(origin) for w, _ in got["bands"].values())
        assert nearest == pytest.approx(0.0 if got is flat else min(near), abs=GRID_STEP_M)
    area = {k: shapely.from_wkb(w).area for k, (w, _) in tilted["bands"].items()}
    assert area["detection:2"] == pytest.approx(3990.01, abs=0.01)
    assert shapely.from_wkb(flat["bands"]["detection:2"][0]).area == pytest.approx(
        13410.92, abs=0.01
    )
    assert (flat["bands"]["detection:2"][1], tilted["bands"]["detection:2"][1]) == (
        pytest.approx(177.208, abs=1e-3),
        pytest.approx(68.675, abs=1e-3),
    )
    # At 4 m the slant distance takes the two surest estimates' identification away.
    assert {"identification:0", "identification:1"} <= set(flat["bands"])
    assert not {"identification:0", "identification:1"} & set(tilted["bands"])


def test_placed_under_a_roof_the_field_goes_out_to_the_street():
    """A participant's camera under a garage entrance is under its roof: it stays where it
    was placed and films the street up to the row across; the same position from OSM is a
    mapping one, snapped half a metre out of the nearest outline (the back wall) and aimed
    at the garage it is behind."""
    name = "garage_entrance_placed"
    got = camerafield.field(record(name), ObstacleIndex(CASES[name][4]), with_qa=False)
    assert (got["x"], got["y"]) == CASES[name][3] and not got["snapped"]
    assert got["under_roof"] and not got["inside_building"]
    street = box(X0, Y0 - 20, X0 + 20, Y0)
    assert got["view"].intersection(street).area > 0.9 * street.area
    assert got["view"].intersection(ACROSS).area < 0.01
    mapped = camerafield.field({**record(name), "placed": False},
                               ObstacleIndex(CASES[name][4]), with_qa=False)  # fmt: skip
    assert mapped["snapped"] and mapped["y"] == pytest.approx(Y0 + 8.5)
    assert not mapped["under_roof"] and mapped["view"].intersection(street).area < 0.01


def test_placed_in_a_porch_the_field_stops_after_10_m_of_building():
    """A participant's camera in the porch of a deep block: the block is no obstacle within
    under_roof_m (10 m) of it, so it films the porch and the street, and blocks again
    beyond: nothing of the field lies in the block farther than 10 m."""
    name = "porch_deep_block_placed"
    got = camerafield.field(record(name), ObstacleIndex(CASES[name][4]), with_qa=False)
    assert camerafield.under_roof_m() == 10
    assert (got["x"], got["y"]) == CASES[name][3] and got["under_roof"]
    disc = shapely.Point(CASES[name][3]).buffer(10.0, quad_segs=64)
    inside = got["view"].intersection(DEEP)
    assert inside.area > 0.99 * disc.intersection(DEEP).area  # the porch, seen to 10 m
    assert inside.difference(disc.buffer(0.01)).area < 0.01  # and not a centimetre beyond
    street = box(X0 - 20, Y0 + 10, X0, Y0 + 30)
    assert got["view"].intersection(street).area > 0.99 * street.area
    assert max(b["reach_m"] for b in got["bands"]) > 15  # the street, farther than 10 m


def test_a_multidome_films_all_around_where_its_one_direction_would_give_a_sector():
    """DECISIONS 2026-10-23: the multi-dome's field is the union of its domes, the full
    circle; the same dome aimed west (its OSM direction) films a sector of it."""
    multi = shapely.from_wkb(fields("multidome_one_direction")["view"])
    dome = shapely.from_wkb(fields("dome_directed")["view"])
    # Within the arcs' chords (a sector's ends are not on the full circle's 2-degree grid).
    assert dome.difference(multi).area < 1e-3 * dome.area and multi.area > 1.5 * dome.area
    # West, where the direction points, both film; north along the facade, the multi-dome only.
    x, y = CASES["multidome_one_direction"][3]
    assert multi.intersects(shapely.Point(x - 30, y)) and dome.intersects(shapely.Point(x - 30, y))
    north = shapely.Point(x - 5, y + 15)
    assert multi.intersects(north) and not dome.intersects(north)
