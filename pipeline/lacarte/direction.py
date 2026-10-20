"""Cameras whose direction is not surveyed (rules/direction.yaml): which ones the map draws
light, "direction non relevée". Their bands are computed like every other camera's; a
direction taken at random never reaches the probable threshold, so the drawing says the
direction is unknown instead of hiding the field."""

from __future__ import annotations

from functools import cache

from lacarte import regions


@cache
def rules() -> dict:
    import yaml

    return yaml.safe_load((regions.ROOT / "rules" / "direction.yaml").read_text())


def kinds() -> list[str]:
    return list(rules()["unknown_direction"]["kinds"])


def undirected(kind: str, directions) -> bool:
    """No surveyed direction, and a kind the rule lists (not PTZ, panorama nor doorbell)."""
    return not len(directions) and kind in kinds()
