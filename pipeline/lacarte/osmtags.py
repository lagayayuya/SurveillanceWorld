"""OSM tag parsers shared by the pipeline (normalize) and the participation API (the
leaderboard tells a known value from these): pure functions, the standard library only, so
that the API's dependency group (the only one installed on the server) can import them."""

from __future__ import annotations

import re

IDENTIFIED, ESTIMATED, DEFAULT = "identified", "estimated", "default"

CARDINALS = {
    "n": 0, "nne": 22.5, "ne": 45, "ene": 67.5, "e": 90, "ese": 112.5, "se": 135, "sse": 157.5,
    "s": 180, "ssw": 202.5, "sw": 225, "wsw": 247.5, "w": 270, "wnw": 292.5, "nw": 315,
    "nnw": 337.5,
    # French initials seen in the data (o = ouest)
    "o": 270, "no": 315, "so": 225, "ono": 292.5, "oso": 247.5, "nno": 337.5, "sso": 202.5,
}  # fmt: skip


def _values(v: str | None) -> set[str]:
    return {p.strip().lower() for p in (v or "").split(";") if p.strip()}


def parse_direction(value: str | None) -> tuple[list[float], str]:
    """camera:direction -> (bearings in degrees, parse status).

    Status: ok, cardinal, multi, range (full circle), invalid, missing.
    """
    if value is None or not value.strip():
        return [], "missing"
    raw = value.strip().lower()
    if raw in {"both", "all", "360", "0-360", "0-359"} or re.fullmatch(r"0\s*-\s*36[09]", raw):
        return [], "range"
    parts = [p.strip() for p in raw.split(";") if p.strip()]
    out, statuses = [], set()
    for p in parts:
        if p in CARDINALS:
            out.append(float(CARDINALS[p]))
            statuses.add("cardinal")
            continue
        m = re.fullmatch(r"(-?\d+(?:[.,]\d+)?)\s*°?", p)
        if m:
            out.append(float(m.group(1).replace(",", ".")) % 360.0)
            statuses.add("ok")
            continue
        m = re.fullmatch(r"(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)", p)
        if m:  # a range a-b: aim at its middle, clockwise from a to b
            a, b = float(m.group(1)) % 360, float(m.group(2)) % 360
            span = (b - a) % 360
            if span >= 350:
                return [], "range"
            out.append((a + span / 2) % 360)
            statuses.add("range_mid")
            continue
        return [], "invalid"
    if len(out) > 1:
        return out, "multi"
    return out, statuses.pop()


def parse_height(value: str | None) -> float | None:
    if not value:
        return None
    m = re.match(r"\s*(\d+(?:[.,]\d+)?)\s*(m|meters?|mètres?)?\s*$", value.lower())
    if not m:
        return None
    h = float(m.group(1).replace(",", "."))
    return h if 0 < h < 200 else None


def classify_kind(tags: dict) -> tuple[str, str]:
    """-> (kind, certainty)."""
    stype = _values(tags.get("surveillance:type"))
    ctype = [v for v in (tags.get("camera:type") or "").lower().split(";") if v.strip()]
    mount = (tags.get("camera:mount") or "").strip().lower()
    if "alpr" in stype or "alpr" in ctype:
        return "alpr", ESTIMATED
    if "doorbell" in ctype or mount == "doorbell":
        return "doorbell", ESTIMATED
    mapping = {
        "dome": "dome", "fixed": "fixed", "static": "fixed", "panning": "ptz", "ptz": "ptz",
        "rotating": "ptz", "panorama_with_ptz": "ptz", "panorama": "panorama",
        "omnidirectional": "panorama", "360": "panorama",
    }  # fmt: skip
    for v in ctype:
        if v.strip() in mapping:
            return mapping[v.strip()], ESTIMATED
    return "unknown", DEFAULT


def parse_tilt(value: str | None) -> float | None:
    """camera:angle is the tilt from the horizon; its sign is used both ways in the data,
    so only the magnitude is kept, and only when plausible for a downward camera."""
    try:
        a = abs(float((value or "").replace(",", ".")))
    except ValueError:
        return None
    return a if 5 <= a <= 80 else None
