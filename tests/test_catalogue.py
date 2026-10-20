"""Schema of catalogue/models.csv: one row per camera model, from manufacturer datasheets."""

import csv
import re
from datetime import date

import pytest

from lacarte import regions

PATH = regions.ROOT / "catalogue" / "models.csv"
COLUMNS = [
    "manufacturer", "model", "kind", "market", "release_year", "release_year_source",
    "resolution_px", "sensor", "focal_min_mm", "focal_max_mm", "hfov_min_deg", "hfov_max_deg",
    "optical_zoom", "ir_range_m", "plate_reading", "analytics", "url_source", "url_archive",
    "consulted", "visual_cues",
]  # fmt: skip
KINDS = {"dome", "fixed", "ptz", "panorama", "alpr", "doorbell"}
MARKETS = {"pro", "consumer"}
# Where the release year comes from: the datasheet or a manufacturer announcement, else the
# first archived copy of the manufacturer's page (an upper bound).
YEAR_SOURCES = {"datasheet", "announcement", "first_archive"}
ANALYTICS = {"none", "motion", "classification", "face", "plate", "unknown"}


def rows() -> list[dict]:
    with PATH.open(newline="") as fh:
        reader = csv.DictReader(fh)
        assert reader.fieldnames == COLUMNS
        return list(reader)


def _num(v: str) -> float | None:
    return float(v) if v != "" else None


@pytest.mark.parametrize("row", rows(), ids=lambda r: f"{r['manufacturer']} {r['model']}")
def test_row(row):
    assert row["manufacturer"] and row["model"]
    assert row["kind"] in KINDS
    assert row["market"] in MARKETS
    year = int(row["release_year"])
    assert 2005 <= year <= date.today().year
    assert row["release_year_source"] in YEAR_SOURCES
    # Optics are left empty when the manufacturer does not publish them (such rows do not
    # enter the calibration).
    res = _num(row["resolution_px"])
    assert res is None or 320 <= res <= 16384
    lo, hi = _num(row["hfov_min_deg"]), _num(row["hfov_max_deg"])
    assert (lo is None) == (hi is None)
    if lo is not None:
        assert 0 < lo <= hi <= 360
    f_lo, f_hi = _num(row["focal_min_mm"]), _num(row["focal_max_mm"])
    assert (f_lo is None) == (f_hi is None)
    if f_lo is not None:
        assert 0 < f_lo <= f_hi
    zoom = _num(row["optical_zoom"])
    assert zoom is None or zoom >= 1
    ir = _num(row["ir_range_m"])
    assert ir is None or 0 <= ir <= 1000
    assert row["plate_reading"] in {"yes", "no"}
    assert set(row["analytics"].split(";")) <= ANALYTICS
    assert row["url_source"].startswith("https://")
    assert row["url_archive"] == "" or row["url_archive"].startswith("https://web.archive.org/")
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}", row["consulted"])


def test_models_are_unique():
    keys = [(r["manufacturer"].lower(), r["model"].lower()) for r in rows()]
    assert len(keys) == len(set(keys))


TENDERS = regions.ROOT / "catalogue" / "tenders.csv"
TENDER_COLUMNS = [
    "buyer", "department", "year", "document_type", "camera_kind", "min_resolution_px",
    "focal_or_zoom", "min_ir_range_m", "analytics_required", "brand_or_model_named", "quantity",
    "url", "consulted", "notes",
]  # fmt: skip


def test_tenders_schema():
    with TENDERS.open(newline="") as fh:
        reader = csv.DictReader(fh)
        assert reader.fieldnames == TENDER_COLUMNS
        tenders = list(reader)
    assert tenders
    for t in tenders:
        assert re.fullmatch(r"\d{2}|2[AB]", t["department"])
        assert 2005 <= int(t["year"]) <= date.today().year
        assert t["camera_kind"] in KINDS | {"multi"}
        assert t["min_resolution_px"] == "" or 320 <= int(t["min_resolution_px"]) <= 16384
        assert t["url"].startswith("https://")
        assert set(t["analytics_required"].split(";")) <= ANALYTICS
