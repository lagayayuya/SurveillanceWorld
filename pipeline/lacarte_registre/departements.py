"""A département's code as the COG writes it, the one form every page and route reads.

The sources write it their own way: BOAMP's notices without a leading zero (« 1 », « 6 ») and
Corsica as « 20A », « 20B »; a code cut from a commune's INSEE code gives « 97 » or « 98 »
overseas. Every document's `dep` and `departements` are written again here, before the
rules; a code the commune reference does not hold is dropped (counted, said in the build's
summary), never served as a page.
"""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any

CORSE = {"20A": "2A", "20B": "2B", "2A": "2A", "2B": "2B"}


def officiel(code: Any, insee: str | None = None) -> str | None:
    """The COG form of `code` (« 1 » → « 01 », « 20A » → « 2A »), its overseas code from
    `insee` when it was cut to two digits (« 97 » + 97411 → « 974 »)."""
    c = str(code).strip().upper() if code not in (None, "") else ""
    c = CORSE.get(c, c)
    if c.isdigit() and len(c) == 1:
        c = "0" + c
    if insee and (not c or c in ("97", "98")):
        i = str(insee)
        c = i[:3] if i[:2] in ("97", "98") else CORSE.get(i[:2], i[:2])
    return c or None


def normaliser(events: Iterable[dict[str, Any]], officiels: set[str]) -> dict[str, Any]:
    """Every document's `dep` and `departements` in the COG form; a code outside `officiels`
    (the commune reference's départements) dropped. Returns what was changed and dropped."""
    fixed = 0
    dropped: dict[str, int] = {}
    for e in events:
        if e.get("dep") not in (None, ""):
            d = officiel(e["dep"], e.get("insee"))
            if d not in officiels:
                dropped[str(e["dep"])] = dropped.get(str(e["dep"]), 0) + 1
                d = None
            if d != e["dep"]:
                fixed += 1
                e["dep"] = d
        if e.get("departements"):
            ds = [d for x in e["departements"] if (d := officiel(x)) in officiels]
            e["departements"] = list(dict.fromkeys(ds))
    return {"corriges": fixed, "ecartes": dropped}
