"""What a change of the streets rules (rules/streets.yaml) does to the figures, between two
builds of one region: drawn and counted length by highway type, the region's shares, named
communes, and the communes whose colour class changes.

    uv run python -m lacarte.sharediff BEFORE_DIR AFTER_DIR [--commune NAME ...]

Each directory holds a build's edges.parquet and areas.parquet (a build directory, or a
copy of those two files). A build from before `counted` (streets rules version 2) counts
its assessed street axes.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow.parquet as pq

from lacarte import admin, optics, tiles

COMMUNES = ["Paris 12e Arrondissement", "Nanterre", "Saint-Denis", "Puteaux",
            "Fontainebleau"]  # fmt: skip
HIGH = list(optics.estimates())[-1]  # the colour and the high end Y: least certain estimate
LOW = f"{optics.rules()['default_estimate']}_dir"  # the low end X


def load_edges(build: Path) -> pd.DataFrame:
    cols = ["highway", "assessed", "axis", "length_m", f"filmed_m_{HIGH}"]
    names = pq.read_schema(build / "edges.parquet").names
    e = pd.read_parquet(build / "edges.parquet", columns=cols + ["counted"] * ("counted" in names))
    if "counted" not in e:
        e["counted"] = e.assessed & e.axis
    return e


def by_highway(before: pd.DataFrame, after: pd.DataFrame) -> pd.DataFrame:
    """km drawn, filmed (least certain estimate) and counted, per highway, both builds."""

    def sums(e: pd.DataFrame) -> pd.DataFrame:
        c = e[e.counted]
        return pd.DataFrame({
            "drawn_km": e.groupby("highway").length_m.sum(),
            "filmed_km": e.groupby("highway")[f"filmed_m_{HIGH}"].sum(),
            "counted_km": c.groupby("highway").length_m.sum(),
            "counted_filmed_km": c.groupby("highway")[f"filmed_m_{HIGH}"].sum(),
        }) / 1000  # fmt: skip

    out = sums(before).join(sums(after), how="outer", lsuffix="_before", rsuffix="_after")
    out = out.fillna(0.0)
    out.loc["total"] = out.sum()
    return out.round(1)


def shares(areas: pd.DataFrame) -> pd.DataFrame:
    """Per area: road km, "between X % and Y %" for every camera and public ones, in %
    rounded as the tiles carry them (tiles._area_features)."""
    out = pd.DataFrame({"level": areas.level, "code": areas.code, "name": areas.name})
    out["road_km"] = areas.road_m / 1000
    for key, col in (("lo", LOW), ("hi", HIGH)):
        for sfx in ("", "_pub"):
            out[f"{key}{sfx}"] = (100 * areas[f"filmed_ratio_{col}{sfx}"]).round(2)
    out["camera_count"] = areas.camera_count
    return out.set_index(["level", "code"])


def region_share(areas: pd.DataFrame) -> dict[str, float]:
    """The region's "between X % and Y %": its départements' sums."""
    d = areas[areas.level == "departement"]
    road = d.road_m.sum()
    out = {"road_km": round(road / 1000, 1)}
    for key, col in (("lo", LOW), ("hi", HIGH)):
        for sfx in ("", "_pub"):
            out[f"{key}{sfx}"] = round(100 * d[f"filmed_m_{col}{sfx}"].sum() / road, 2)
    return out


def classes(values: np.ndarray, breaks: list[float]) -> np.ndarray:
    """Colour class of each value, as MapLibre's `step` reads the breaks."""
    return np.searchsorted(np.asarray(breaks), values, side="right")


def class_changes(before: pd.DataFrame, after: pd.DataFrame, level: str) -> dict:
    """Areas of `level` whose colour class changes: the punk map's fixed classes
    (admin.class_breaks) and the classique's quantiles (tiles.share_breaks, each build its
    own), every camera and public ones."""
    b, a = before.loc[level], after.loc[level]
    both = b.join(a, lsuffix="_b", rsuffix="_a", how="inner")
    out = {}
    for sfx in ("", "_pub"):
        key = f"hi{sfx}"
        punk_b = classes(both[f"{key}_b"].to_numpy(), admin.class_breaks())
        punk_a = classes(both[f"{key}_a"].to_numpy(), admin.class_breaks())
        out[f"punk{sfx}"] = _moves(both, punk_b, punk_a)
        mapped = both[(both.camera_count_b > 0) | (both.camera_count_a > 0)]
        qb = _quantiles(b, key)
        qa = _quantiles(a, key)
        out[f"classique{sfx}"] = {
            "breaks_before": qb,
            "breaks_after": qa,
            **_moves(
                mapped,
                classes(mapped[f"{key}_b"].to_numpy(), qb),
                classes(mapped[f"{key}_a"].to_numpy(), qa),
            ),
        }
    return out


def _quantiles(s: pd.DataFrame, key: str) -> list[float]:
    frame = pd.DataFrame({"camera_count": s.camera_count})
    col = f"filmed_ratio_{HIGH}{key[2:]}"
    frame[col] = s[key] / 100
    other = f"filmed_ratio_{HIGH}" if key == "hi_pub" else f"filmed_ratio_{HIGH}_pub"
    frame[other] = 0.0
    return tiles.share_breaks(frame)["hi" + key[2:]]["breaks"]


def _moves(both: pd.DataFrame, cb: np.ndarray, ca: np.ndarray) -> dict:
    up, down = ca > cb, ca < cb
    changed = both[up | down].assign(before=cb[up | down], after=ca[up | down])
    return {
        "up": int(up.sum()),
        "down": int(down.sum()),
        "areas": [
            (r.name_a, int(r.before), int(r.after))
            for r in changed.sort_values("name_a").itertuples()
        ],
    }


def report(before_dir: Path, after_dir: Path, communes: list[str]) -> str:
    lines = []
    hw = by_highway(load_edges(before_dir), load_edges(after_dir))
    lines.append(f"## km by highway (filmed = {HIGH}, every camera)\n")
    lines.append(hw.to_string())
    ab, aa = (pd.read_parquet(d / "areas.parquet") for d in (before_dir, after_dir))
    lines.append("\n## Region (sum of its départements): X = lo, Y = hi, %\n")
    rb, ra = region_share(ab), region_share(aa)
    lines.append(pd.DataFrame({"before": rb, "after": ra}).T.to_string())
    sb, sa = shares(ab), shares(aa)
    lines.append("\n## Communes\n")
    cols = ["road_km", "lo", "hi", "lo_pub", "hi_pub"]
    for name in communes:
        b = sb[sb.name == name]
        a = sa[sa.name == name]
        if not len(b) or not len(a):
            lines.append(f"{name}: not found")
            continue
        t = pd.DataFrame([b.iloc[0][cols], a.iloc[0][cols]], index=["before", "after"])
        lines.append(f"{name} ({b.index[0][1]})\n{t.round(2).to_string()}\n")
    for level in ("commune", "departement"):
        ch = class_changes(sb, sa, level)
        lines.append(f"\n## Class changes, {level}s\n")
        for key, v in ch.items():
            extra = ""
            if "breaks_before" in v:
                extra = f" breaks {v['breaks_before']} -> {v['breaks_after']}"
            lines.append(f"{key}: {v['up']} up, {v['down']} down{extra}")
            for name, b, a in v["areas"]:
                lines.append(f"    {name}: {b} -> {a}")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("before", type=Path)
    p.add_argument("after", type=Path)
    p.add_argument("--commune", action="append", help="a commune's name (default: five)")
    args = p.parse_args(argv)
    pd.set_option("display.width", 200, "display.max_rows", 200, "display.max_columns", 20)
    print(report(args.before, args.after, args.commune or COMMUNES))


if __name__ == "__main__":
    main()
