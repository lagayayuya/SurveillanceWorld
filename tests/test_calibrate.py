"""Calibration of the optical distributions from catalogue rows."""

import pytest

from lacarte import calibrate

CAL = {
    "generations": {"old": [None, 2015], "new": [2016, None]},
    "min_models": 3,
}
PROVISIONAL = {"doorbell": {"resolution_px": [1280, 2560], "hfov_deg": [140, 180]}}


def row(kind, year, res, lo, hi):
    return {"kind": kind, "release_year": str(year), "resolution_px": str(res),
            "hfov_min_deg": str(lo), "hfov_max_deg": str(hi)}  # fmt: skip


def test_weighted_quantiles():
    assert calibrate.weighted_quantiles([1, 2, 3], [1, 1, 1], (0.5,)) == [2]
    # a heavy value pulls the median
    assert calibrate.weighted_quantiles([1, 2, 3], [1, 1, 10], (0.5,))[0] > 2.5


def test_varifocal_counts_over_its_range_and_ptz_keeps_its_tele_end():
    res, fills, tele = calibrate.model_points(row("fixed", 2020, 1920, 30, 110))
    assert res == 1920 and tele is None
    assert len(fills) == calibrate.VARIFOCAL_SETTINGS
    assert fills[0][0] == pytest.approx(30) and fills[-1][0] == pytest.approx(110)
    _, fills, tele = calibrate.model_points(row("ptz", 2020, 1920, 2.5, 57.6))
    assert fills == [(57.6, 1.0)] and tele == 2.5


def test_cells_fall_back_to_the_pooled_type_and_types_to_provisional():
    rows = [row("dome", y, r, f, f) for y, r, f in
            [(2018, 1920, 90), (2020, 2560, 100), (2021, 2688, 100), (2022, 3840, 90),
             (2012, 1280, 80)]]  # fmt: skip
    rows.append(row("doorbell", 2021, 1920, 150, 150))
    d = calibrate.distributions(rows, CAL, PROVISIONAL)
    assert d["dome"]["pooled"]["models"] == 5
    assert d["dome"]["generations"]["new"]["models"] == 4
    assert "resolution_px" in d["dome"]["generations"]["new"]
    assert d["dome"]["generations"]["old"] == {"models": 1, "use": "pooled"}
    assert d["doorbell"]["pooled"]["resolution_px"] == [1280, 1810, 2560]
    assert "provisional" in d["doorbell"]["pooled"]["source"]


def test_rows_without_optics_are_ignored():
    rows = [row("dome", 2020, 1920, 90, 90) for _ in range(3)]
    rows.append({**row("dome", 2020, 1920, 90, 90), "resolution_px": ""})
    assert calibrate.distributions(rows, CAL, PROVISIONAL)["dome"]["pooled"]["models"] == 3


def test_default_generations_are_marked_estimated_by_default():
    rows = [row("dome", 2020, 1920, 90, 90) for _ in range(3)]
    cal = {**CAL, "default_generations": ["old"]}
    d = calibrate.distributions(rows, cal, PROVISIONAL)
    assert d["dome"]["generations"]["old"] == {"models": 0, "use": "pooled", "certainty": "default"}
    assert "certainty" not in d["dome"]["generations"]["new"]
