from datetime import date

import pandas as pd
import pytest

from lacarte import aggregate


def test_camera_freshness():
    today = date(2026, 9, 27)
    cams = pd.DataFrame([
        {"stale_flags": [], "survey_date": "2026-01-01", "osm_timestamp": None},   # fresh survey
        {"stale_flags": [], "survey_date": "2020-09-27", "osm_timestamp": None},   # 6 y: half way
        {"stale_flags": [], "survey_date": "2010-01-01", "osm_timestamp": None},   # too old
        {"stale_flags": [], "survey_date": None, "osm_timestamp": "2026-05-01T00:00:00+00:00"},
        {"stale_flags": ["fixme_maybe_gone"], "survey_date": "2026-01-01", "osm_timestamp": None},
        {"stale_flags": [], "survey_date": None, "osm_timestamp": None},
    ])  # fmt: skip
    f = aggregate.camera_freshness(cams, today)
    assert f[0] == 1.0
    assert f[1] == pytest.approx(0.5, abs=0.01)
    assert f[2] == 0.0
    assert f[3] == 0.5  # only an edit date: half weight
    assert f[4] == 0.0
    assert f[5] == 0.0


@pytest.mark.parametrize(
    ("survey", "bucket"),
    [("2026-01-01", 0), ("2025-01-01", 1), ("2023-09-01", 2), ("2019-05-01", 2), (None, 3)],
)  # fmt: skip
def test_freshness_bucket(survey, bucket):
    today = date(2026, 9, 27)
    assert aggregate.freshness_bucket(survey, today) == bucket
