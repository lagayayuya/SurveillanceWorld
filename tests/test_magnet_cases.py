"""Frozen magnet cases shared with the phone: Python (buildings.magnet) is the reference,
tests/fixtures/magnet-cases.json holds its inputs and results, and web/tests/magnet.test.ts
checks that web/src/participate/magnet.ts gives the same results (1e-6 m).

    UPDATE_MAGNET_CASES=1 uv run pytest tests/test_magnet_cases.py   # regenerate the file
"""

import json
import os
import random
import zlib
from pathlib import Path

import pytest
from shapely import Polygon, box

from lacarte import buildings

FILE = Path(__file__).parent / "fixtures" / "magnet-cases.json"
CAPTURE = 3.0

HOUSE = box(0, 0, 10, 10)
STREET = [box(0, 0, 10, 10), box(13, 0, 20, 10)]  # a 3 m street between two blocks
HALL = [box(0, 0, 60, 60)]
COURTYARD = [
    Polygon([(0, 0), (30, 0), (30, 30), (0, 30)], [[(10, 10), (20, 10), (20, 20), (10, 20)]])
]
ELL = [Polygon([(0, 0), (20, 0), (20, 8), (8, 8), (8, 20), (0, 20)])]
GAP = [box(0, 0, 10, 10), box(10.6, 0, 20, 10)]  # 60 cm apart: the offset point is not clear
TILTED = [Polygon([(0, 0), (8.66, 5), (3.66, 13.66), (-5, 8.66)])]  # a square turned 30 deg

SCENES = {
    "house": [HOUSE],
    "street": STREET,
    "hall": HALL,
    "courtyard": COURTYARD,
    "ell": ELL,
    "gap": GAP,
    "tilted": TILTED,
    "empty": [],
}
DROPS = {
    "house": [
        (12, 5),
        (10.3, 5),
        (10, 5),
        (8, 5),
        (5, -2.5),
        (13.5, 5),
        (11, 11),
        (10, 10),
        (-1, -1),
        (5, 5.0001),
    ],
    "street": [(12, 5), (11, 5), (11.5, 5), (16, 11.5)],
    "hall": [(30, 30), (55, 30), (61, 30)],
    "courtyard": [(15, 15), (15, 11), (11, 11), (25, 15), (15, 31)],
    "ell": [(9, 9), (10, 10), (7, 12), (12, 7), (21, 4), (4, 21)],
    "gap": [(9.9, 5), (10.3, 5), (9, 5), (10.7, 5)],
    "tilted": [(10, 8), (0, 0), (3, 7), (-6, 9), (9, 1)],
    "empty": [(1, 2)],
}


def random_drops(scene, n, seed):
    rnd = random.Random(seed)
    return [(round(rnd.uniform(-8, 35), 3), round(rnd.uniform(-8, 35), 3)) for _ in range(n)]


def rings(poly: Polygon):
    return [
        list(map(list, poly.exterior.coords)),
        *(list(map(list, h.coords)) for h in poly.interiors),
    ]


def compute() -> dict:
    cases = []
    for name, polys in SCENES.items():
        drops = DROPS[name] + (random_drops(name, 10, zlib.crc32(name.encode())) if polys else [])
        for x, y in drops:
            rx, ry, pulled, facade = buildings.magnet(x, y, polys, CAPTURE)
            cases.append({
                "scene": name, "drop": [x, y], "x": rx, "y": ry, "pulled": pulled,
                "facade": [list(c) for c in facade.coords] if facade is not None else None,
            })  # fmt: skip
    return {
        "capture_m": CAPTURE,
        "offset_m": buildings.SNAP_OFFSET_M,
        "max_snap_m": buildings.MAX_SNAP_M,
        "scenes": {name: [rings(p) for p in polys] for name, polys in SCENES.items()},
        "cases": cases,
    }


def test_the_shared_cases_are_python_s_results():
    expected = compute()
    if os.environ.get("UPDATE_MAGNET_CASES") == "1":
        FILE.write_text(json.dumps(expected, indent=1) + "\n")
    stored = json.loads(FILE.read_text())
    assert stored["scenes"] == json.loads(json.dumps(expected["scenes"]))
    assert len(stored["cases"]) == len(expected["cases"])
    for got, want in zip(stored["cases"], expected["cases"], strict=True):
        assert got["drop"] == list(want["drop"]) and got["pulled"] == want["pulled"], got
        assert (got["x"], got["y"]) == pytest.approx((want["x"], want["y"]), abs=1e-9), got


def test_the_cases_cover_every_branch():
    cases = compute()["cases"]
    pulled = [c for c in cases if c["pulled"]]
    assert len(pulled) >= 20 and len(cases) - len(pulled) >= 10
    assert any(c["scene"] == "gap" and c["pulled"] for c in cases)  # the 72-direction ring
    assert any(c["scene"] == "courtyard" and c["pulled"] for c in cases)  # a hole's outline
