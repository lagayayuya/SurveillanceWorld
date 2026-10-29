"""What a correction of the register may be, in one place: the API (lacarte.api.registre:
a reader's report, a reviewer's decision in /revue) and the build (regles.py) read it.

A reader says what is wrong in one of CATEGORIES; a reviewer who accepts the report says
which FIELDS the build changes and the value it puts there, checked by `value()` here and
again by the build. Pure: no I/O, the standard library only (the API imports it).
"""

from __future__ import annotations

import math
import re
from datetime import date
from typing import Any

# What a reader may say is wrong (migration 026, registre_reports.category).
CATEGORIES = (
    "montant", "date", "entreprise", "commune", "nom", "lien", "cameras", "zone", "autre",
)  # fmt: skip
# What a correction may change on a document (migration 026, registre_reports.field): the
# amount, the date, the companies (their SIREN), the commune (its INSEE code), the
# beneficiary's name, the number of cameras, the affaire it belongs to (the link between
# documents).
FIELDS = ("montant", "date", "entreprises", "insee", "beneficiaire", "cameras", "affaire")
# A document's or an affaire's id, as the pilot writes them (migration 026's CHECK).
ID = re.compile(r"[A-Za-z0-9._~-]{1,80}")
SIREN = re.compile(r"\d{9}")
INSEE = re.compile(r"\d{5}|2[AB]\d{3}")
DAY = re.compile(r"\d{4}-\d{2}-\d{2}")
AMOUNT_MAX = 1e11  # euros: above every public contract, below a typing slip of 1 000 times
CAMERAS_MAX = 100_000
COMPANIES_MAX = 50
NAME_MAX = 200
FIRST_YEAR, LAST_YEAR = 1990, 2100


def value(field: str, raw: Any) -> Any:
    """The value a correction of `field` puts on the document, checked and normalised (an
    amount that is a whole number an int); ValueError says what is wrong."""
    if field not in FIELDS:
        raise ValueError(f"no such field: {field!r}")
    if field == "montant":
        if isinstance(raw, bool) or not isinstance(raw, int | float) or not math.isfinite(raw):
            raise ValueError("an amount is a number")
        if not 0 <= raw <= AMOUNT_MAX:
            raise ValueError("an amount is between 0 and 100 billion euros")
        return int(raw) if float(raw).is_integer() else float(raw)
    if field == "cameras":
        if isinstance(raw, bool) or not isinstance(raw, int) or not 0 <= raw <= CAMERAS_MAX:
            raise ValueError(f"a number of cameras is a whole number from 0 to {CAMERAS_MAX}")
        return raw
    if field == "entreprises":
        if not isinstance(raw, list) or len(raw) > COMPANIES_MAX:
            raise ValueError(f"companies are a list of at most {COMPANIES_MAX} SIREN")
        if not all(isinstance(s, str) and SIREN.fullmatch(s) for s in raw):
            raise ValueError("a company is its SIREN, 9 digits")
        if len(set(raw)) != len(raw):
            raise ValueError("a company is listed once")
        return list(raw)
    if not isinstance(raw, str):
        raise ValueError(f"{field} is a text")
    if field == "date":
        if not DAY.fullmatch(raw):
            raise ValueError("a date is YYYY-MM-DD")
        day = date.fromisoformat(raw)  # ValueError on 2021-02-30
        if not FIRST_YEAR <= day.year <= LAST_YEAR:
            raise ValueError(f"a date is between {FIRST_YEAR} and {LAST_YEAR}")
        return raw
    if field == "insee":
        if not INSEE.fullmatch(raw):
            raise ValueError("a commune is its INSEE code, 5 characters")
        return raw
    if field == "affaire":
        if not ID.fullmatch(raw):
            raise ValueError("an affaire is its id")
        return raw
    # beneficiaire: one line, as the act names it.
    name = " ".join(raw.split())
    if not 1 <= len(name) <= NAME_MAX or any(ord(c) < 32 for c in name):
        raise ValueError(f"a name is one line of 1 to {NAME_MAX} characters")
    return name
