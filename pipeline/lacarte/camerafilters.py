"""What the filters know of a camera, shared by the exposure stage (street portions are
cut where the filterable categories of their cameras change) and the tiles stage (camera
attributes, filter bits, cameras.json). The front decodes the same layouts."""

from __future__ import annotations

from datetime import date

import geopandas as gpd
import pandas as pd
import yaml

from lacarte import aggregate, normalize, optics, regions

OP_CODE = {"public": "pub", "private_outdoor": "pro", "private_indoor": "pri", "unknown": "unk"}
SHOWN = optics.shown_estimates()
# Advanced-filter attributes of a camera, packed in one integer `fl` (also on its bands and
# PTZ outline, so that a view is filtered with its camera). Bits 0-1: last check (0 < 1 y,
# 1 = 1-3 y, 2 > 3 y, 3 never); then one bit each. The front decodes the same layout.
FLAG_BITS = {
    "maybe_gone": 2, "legacy_import": 3, "direction_unknown": 4, "type_unknown": 5,
    "height_unknown": 6, "in_building": 7, "plate_reading": 8, "ptz": 9, "night_vision": 10,
    "analytics": 11, "identifies_far_0": 12, "identifies_far_1": 13, "identifies_far_2": 14,
}  # fmt: skip

# Filters on merged axes (z11-13): per axis and shown estimate, one bit per filter box set
# when at least one camera filming it (with that estimate or a more certain one) is in
# that category: who, type, freshness, maybe gone, import, completeness, capabilities,
# identification beyond identify_beyond_m for that estimate. The browser tests the bits;
# exact with one group of criteria, approximate when groups combine. Same layout in
# meta.json (segment_bits).
KIND_ORDER = ["dome", "fixed", "ptz", "panorama", "alpr", "doorbell", "unknown"]
FRESH_ROWS = ["fresh_lt1", "fresh_1to3", "fresh_gt3", "fresh_never"]  # fl % 4
FLAG_ROWS = [
    "maybe_gone", "legacy_import", "direction_unknown", "type_unknown", "height_unknown",
    "in_building", "plate_reading", "ptz", "night_vision", "analytics",
]  # fmt: skip
SEGMENT_BITS = {
    **{f"op:{code}": i for i, code in enumerate(OP_CODE.values())},
    **{f"kind:{k}": 4 + i for i, k in enumerate(KIND_ORDER)},
    **{row: 11 + i for i, row in enumerate(FRESH_ROWS)},
    **{row: 15 + i for i, row in enumerate(FLAG_ROWS)},
    **{f"identifies_far_{e}": 25 + i for i, e in enumerate(SHOWN)},
}


def camera_filters(
    cams: gpd.GeoDataFrame, views: pd.DataFrame, today: date | None = None
) -> tuple[dict, dict]:
    """Per camera id: {"fl": flags, "op": operator index}; and the list the index points
    into (operators by frequency, table names first), plus the "identifies beyond"
    distance, for meta.json. Freshness from `today` (a part's: its aggregate's data date),
    else the cameras' own data date. `views` needs camera_id, snapped, inside_building and
    area_m2 only."""
    today = today or aggregate.data_date(cams)
    snapped = views.set_index("camera_id")
    # "Position ou direction à corriger": drawn on or in a building, or a field too small to
    # be real (rules/reliability.yaml position_check).
    in_building = (snapped.snapped | snapped.inside_building | position_check(snapped)).to_dict()
    table = {e["name"] for e in normalize.rules("operators")["names"]}
    counts = cams.operator_norm.value_counts()
    operators = sorted(counts.index, key=lambda n: (n not in table, -counts[n], n))
    op_index = {n: i for i, n in enumerate(operators)}
    far = normalize.rules("capabilities")["identify_beyond_m"]
    ppm = optics.rules()["levels"]["identification"]
    out = {}
    for c in cams.itertuples(index=False):
        samples = optics.samples(c.kind)
        bits = {
            "maybe_gone": "fixme_maybe_gone" in c.stale_flags,
            "legacy_import": "legacy_import" in c.stale_flags,
            "direction_unknown": c.direction_certainty == "default",
            "type_unknown": c.kind == "unknown",
            "height_unknown": c.height_certainty == "default",
            "in_building": bool(in_building.get(c.camera_id, False)),
            "plate_reading": bool(c.cap_plate_reading),
            "ptz": bool(c.cap_ptz),
            "night_vision": bool(c.cap_night_vision_tag),
            "analytics": bool(c.cap_analytics),
        }
        for i, t in enumerate(optics.thresholds()):
            bits[f"identifies_far_{i}"] = optics.reach_at_share(samples, ppm, t) > far
        fl = aggregate.freshness_bucket(aggregate.last_check(c), today)
        fl += sum(1 << FLAG_BITS[k] for k, on in bits.items() if on)
        props = {"fl": fl}
        if isinstance(c.operator_norm, str):
            props["op"] = op_index[c.operator_norm]
        out[c.camera_id] = props
    lists = {
        "operators": operators,
        "flag_bits": FLAG_BITS,
        "segment_bits": SEGMENT_BITS,
        "identify_beyond_m": far,
    }
    return out, lists


def camera_mask(operator_class: str, kind: str, fl: int) -> int:
    """The SEGMENT_BITS a camera sets on the axes it films."""
    bits = [SEGMENT_BITS[f"op:{OP_CODE[operator_class]}"], SEGMENT_BITS[f"kind:{kind}"]]
    bits.append(SEGMENT_BITS[FRESH_ROWS[fl % 4]])
    bits += [SEGMENT_BITS[r] for r in FLAG_ROWS if (fl >> FLAG_BITS[r]) & 1]
    bits += [
        SEGMENT_BITS[f"identifies_far_{e}"]
        for e in SHOWN
        if (fl >> FLAG_BITS[f"identifies_far_{e}"]) & 1
    ]
    return sum(1 << b for b in set(bits))


def camera_masks(
    cams: gpd.GeoDataFrame, views: pd.DataFrame, today: date | None = None
) -> dict[str, int]:
    """camera id -> camera_mask."""
    filters, _ = camera_filters(cams, views, today)
    return {
        c.camera_id: camera_mask(c.operator_class, c.kind, filters[c.camera_id]["fl"])
        for c in cams.itertuples(index=False)
    }


def estimate_mask(mask: int, est: int) -> int:
    """A camera's mask as the filters of estimate `est` read it: without the bits of the
    other estimates' "identifies far"."""
    for e in SHOWN:
        if e != est:
            mask &= ~(1 << SEGMENT_BITS[f"identifies_far_{e}"])
    return mask


def position_check(views: pd.DataFrame) -> pd.Series:
    """Per camera (views indexed by camera id): its position or direction must be checked
    on site — drawn more than 10 m inside a building (no field), or a drawn field smaller
    than rules/reliability.yaml position_check.min_field_m2."""
    rule = yaml.safe_load((regions.ROOT / "rules" / "reliability.yaml").read_text())
    small = views.area_m2.fillna(0) < rule["position_check"]["min_field_m2"]
    return views.inside_building.astype(bool) | small
