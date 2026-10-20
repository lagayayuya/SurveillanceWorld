"""The figures of a streets-rules change between two builds (lacarte.sharediff)."""

import pandas as pd
import pytest

from lacarte import admin, sharediff

HIGH, LOW = sharediff.HIGH, sharediff.LOW


def build(tmp_path, name, edges, areas):
    d = tmp_path / name
    d.mkdir()
    pd.DataFrame(edges).to_parquet(d / "edges.parquet")
    pd.DataFrame(areas).to_parquet(d / "areas.parquet")
    return d


def area(level, code, name, road_m, hi, lo=0.0, cams=1):
    row = {"level": level, "code": code, "name": name, "road_m": road_m,
           "camera_count": cams}  # fmt: skip
    for sfx in ("", "_pub"):
        row[f"filmed_ratio_{HIGH}{sfx}"] = hi
        row[f"filmed_ratio_{LOW}{sfx}"] = lo
        row[f"filmed_m_{HIGH}{sfx}"] = hi * road_m
        row[f"filmed_m_{LOW}{sfx}"] = lo * road_m
    return row


def test_a_version_2_build_counts_its_axes_and_classes_follow_the_punk_breaks(tmp_path):
    before = build(
        tmp_path, "before",
        {"highway": ["residential", "footway"], "assessed": [True, True],
         "axis": [True, False], "length_m": [100.0, 50.0], f"filmed_m_{HIGH}": [10.0, 50.0]},
        [area("commune", "1", "A", 100.0, 0.10), area("departement", "d", "D", 100.0, 0.10)],
    )  # fmt: skip
    after = build(
        tmp_path, "after",
        {"highway": ["residential", "footway", "motorway", "cycleway"],
         "assessed": [True] * 4, "axis": [True, False, True, True],
         "counted": [True, False, False, True], "length_m": [100.0, 50.0, 300.0, 100.0],
         f"filmed_m_{HIGH}": [10.0, 50.0, 300.0, 30.0]},
        [area("commune", "1", "A", 200.0, 0.20), area("departement", "d", "D", 200.0, 0.20)],
    )  # fmt: skip
    hw = sharediff.by_highway(sharediff.load_edges(before), sharediff.load_edges(after))
    assert hw.loc["footway", "counted_km_before"] == 0  # not an axis: not counted
    assert hw.loc["motorway", ["drawn_km_after", "counted_km_after"]].tolist() == [0.3, 0.0]
    assert hw.loc["total", "counted_km_after"] == pytest.approx(0.2)
    assert sharediff.region_share(pd.read_parquet(after / "areas.parquet"))["hi"] == 20.0
    # 10 % -> 20 %: one punk class up with the breaks of 2026-10-09 (5, 15, 30, 50)
    b, a = (int(sharediff.classes([v], admin.class_breaks())[0]) for v in (10.0, 20.0))
    assert a == b + 1
    report = sharediff.report(before, after, ["A"])
    assert "punk: 1 up, 0 down" in report and f"A: {b} -> {a}" in report
