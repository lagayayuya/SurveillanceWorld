"""Per-area summary shared by the communes and départements (admin.py): share of street
filmed and data reliability index v0; camera freshness for the filters.

Two aggregate sets: all cameras, and public cameras only (`*_pub`), each for the three reach
estimates (`filmed_ratio_<estimate>[_pub]`).
"""

from __future__ import annotations

from datetime import date, datetime
from functools import cache

import geopandas as gpd
import numpy as np
import pandas as pd
import yaml

from lacarte import apply, normalize, optics, regions

OPERATOR_CLASSES = ["public", "private_outdoor", "private_indoor", "unknown"]
# Camera types (rules/defaults.yaml `kinds`), counted per area as `n_kind_<kind>`: the punk
# area sheet's « Caméras » lists them.
KINDS = list(normalize.rules("defaults")["kinds"])
COUNTS = [f"n_{c}" for c in OPERATOR_CLASSES] + [f"n_kind_{k}" for k in KINDS]
FILMED = [f"filmed_m_{est}{s}" for est in optics.estimates() for s in ("", "_pub")]
# The default estimate filmed by cameras with a surveyed direction only (exposure.
# filmed_intervals `dir`): the low end of the areas' "between X % and Y %".
DIRECTED = [f"filmed_m_{optics.rules()['default_estimate']}_dir{s}" for s in ("", "_pub")]
FILMED = FILMED + DIRECTED


@cache
def _rules() -> dict:
    return yaml.safe_load((regions.ROOT / "rules" / "reliability.yaml").read_text())


def data_date(cams: pd.DataFrame) -> date:
    """Date of the extract: the latest edit it contains."""
    return max(datetime.fromisoformat(t).date() for t in cams.osm_timestamp.dropna())


def last_check(c) -> str | None:
    """A camera's last on-site check, ISO date: the later of its survey date (check_date,
    survey:date) and the month of a validated sighting (rules/contributions.yaml seen, taken
    on the rule's day of that month)."""
    seen = getattr(c, "seen_month", None)
    if not isinstance(seen, str):
        return c.survey_date
    day = f"{seen}-{apply.rules()['seen']['day_of_month']:02d}"
    return c.survey_date if isinstance(c.survey_date, str) and c.survey_date > day else day


def freshness_bucket(survey_date: str | None, today: date) -> int:
    """Last check: 0 < 1 y, 1 = 1-3 y, 2 > 3 y, 3 never (bounds in reliability.yaml)."""
    if not isinstance(survey_date, str):
        return 3
    age = (today - date.fromisoformat(survey_date)).days / 365.25
    short, long = _rules()["freshness"]["bucket_years"]
    return 0 if age < short else 1 if age < long else 2


def camera_freshness(cams: pd.DataFrame, today: date) -> np.ndarray:
    f = _rules()["freshness"]
    out = np.zeros(len(cams))
    for i, c in enumerate(cams.itertuples(index=False)):
        if len(c.stale_flags):
            out[i] = f["stale_weight"]
            continue
        checked = last_check(c)
        if isinstance(checked, str):
            when, weight = date.fromisoformat(checked), 1.0
        elif isinstance(c.osm_timestamp, str):
            when, weight = datetime.fromisoformat(c.osm_timestamp).date(), f["edit_date_weight"]
        else:
            continue
        age = (today - when).days / 365.25
        full, zero = f["full_until_years"], f["zero_after_years"]
        decay = 1.0 if age <= full else max(0.0, 1.0 - (age - full) / (zero - full))
        out[i] = weight * decay
    return out


def prepare_cameras(cams: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """Mapped cameras (not verified gone) with the per-camera parts of the reliability
    index."""
    cams = cams[cams.is_camera & ~apply.gone(cams)].copy()
    cams["fresh"] = camera_freshness(cams, data_date(cams))
    cams["dir_known"] = cams.direction_certainty.ne("default") | cams.indoor
    cams["recent"] = cams.fresh >= 1.0
    return cams


def summarise(roads: pd.DataFrame, cams: pd.DataFrame, key: str) -> pd.DataFrame:
    """Per area (`key`): street lengths (`roads`, indexed by area, `road_m` and FILMED
    summed), filmed shares, camera counts by operator class and by type, and the
    reliability index.
    `cams` comes from prepare_cameras with its area in column `key`. Shared by the H3
    communes and the départements."""
    per_cam = cams.groupby(key).agg(
        camera_count=("camera_id", "size"),
        freshness=("fresh", "mean"),
        direction_known_share=("dir_known", "mean"),
        type_known_share=("type_known", "mean"),
        recent_share=("recent", "mean"),
    )
    by_op = cams.pivot_table(
        index=key, columns="operator_class", values="camera_id", aggfunc="size"
    )
    by_op = by_op.reindex(columns=OPERATOR_CLASSES).fillna(0).astype(int).add_prefix("n_")
    by_kind = cams.pivot_table(index=key, columns="kind", values="camera_id", aggfunc="size")
    by_kind = by_kind.reindex(columns=KINDS).fillna(0).astype(int).add_prefix("n_kind_")
    df = (
        roads.join(per_cam, how="outer")
        .join(by_op, how="left")
        .join(by_kind, how="left")
        .fillna({"road_m": 0.0, "camera_count": 0,
                 **{col: 0.0 for col in FILMED}, **dict.fromkeys(COUNTS, 0)})
    )  # fmt: skip
    road = df.road_m.where(df.road_m > 0, 1)
    for col in FILMED:
        ratio = col.replace("filmed_m_", "filmed_ratio_")
        df[ratio] = np.where(df.road_m > 0, df[col] / road, 0.0)
    w = _rules()["weights"]
    df["reliability"] = (
        w["freshness"] * df.freshness
        + w["direction_known"] * df.direction_known_share
        + w["type_known"] * df.type_known_share
    )  # NaN when the area has no mapped camera
    df["reliability_word"], df["reliability_reason"], df["reliability_reason_pct"] = (
        zip(*[reliability_explained(r) for r in df.itertuples()], strict=True)
        if len(df)
        else ([], [], [])
    )
    df.index.name = key
    return df


def reliability_explained(cell) -> tuple[str | None, str | None, int | None]:
    """A word for the reliability and its main reason: the weakest component.

    Reason codes: `no_direction`, `no_type`, `not_recent` (with the share of cameras
    concerned, in %). None when the cell has no mapped camera.
    """
    if np.isnan(cell.reliability):
        return None, None, None
    r = _rules()["words"]
    word = next(w for w, floor in r.items() if cell.reliability >= floor)
    lacks = {
        "no_direction": 1 - cell.direction_known_share,
        "no_type": 1 - cell.type_known_share,
        "not_recent": 1 - cell.recent_share,
    }
    reason = max(lacks, key=lacks.get)
    return word, reason, round(100 * lacks[reason])
