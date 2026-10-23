"""Rules of the participation prototype (rules/participation.yaml, rules/questions.yaml,
rules/contributions.yaml), shared by the API, the `apply` stage, `lacarte db load` and the
tiles' meta. Light: yaml only."""

from __future__ import annotations

import re
import unicodedata
from functools import cache

import yaml

from lacarte import regions


@cache
def rules() -> dict:
    return yaml.safe_load((regions.ROOT / "rules" / "participation.yaml").read_text())


@cache
def contributions() -> dict:
    """rules/contributions.yaml: how the build applies contributions (the add's duplicate
    distance is the phone's and the API's too)."""
    return yaml.safe_load((regions.ROOT / "rules" / "contributions.yaml").read_text())


# Phase "Ajouter": an added camera has no OSM element; its id is `c` + the first 12 hex
# digits of the add's uuid (migration 007), outside OSM's n, w, r.
ADDED_ID = re.compile(r"c[0-9a-f]{12}")


def is_added(camera_id: str) -> bool:
    return ADDED_ID.fullmatch(camera_id) is not None


def added_id(add_uuid: str) -> str:
    """The id of the camera an add creates: stable, no time, no author."""
    return "c" + add_uuid.replace("-", "")[:12]


def default_placement(mount_group: str) -> str | None:
    """ "facade" or "free" preselected for a mount group; None: the tester chooses."""
    p = rules()["placement"]
    for placement in ("facade", "free"):
        if mount_group in p[placement]:
            return placement
    return None


@cache
def questions() -> dict:
    """rules/questions.yaml: the "Compléter" questions (phase D2)."""
    return yaml.safe_load((regions.ROOT / "rules" / "questions.yaml").read_text())


def tilt_kinds() -> list[str]:
    """The kinds a validated tilt applies to (rules/questions.yaml tilt)."""
    return list(questions()["tilt"]["kinds"])


def dome_count_ok(kind: str, answer: str | None, count) -> bool:
    """A number of domes only on a « Multi-boules » shape answer (multidome), a whole number
    within rules/questions.yaml dome_count; none is always fine (« Je ne sais pas »). The
    API checks a body with it, the `apply` stage an exported line."""
    if count is None:
        return True
    rule = questions()["dome_count"]
    return (kind == "shape" and answer == "multidome" and type(count) is int
            and rule["min"] <= count <= rule["max"])  # fmt: skip


def tilt_class(deg) -> str | None:
    """The class a tilt in degrees falls in (rules/questions.yaml tilt.bounds): the sheet and
    /revue never show a tilt in degrees."""
    if deg is None or deg != deg:  # None or NaN
        return None
    low, high = questions()["tilt"]["bounds"]
    return "horizon" if deg < low else "slight" if deg < high else "steep"


def fold(text: str) -> str:
    """Lower case without accents, punctuation as single spaces: operator spellings compared
    and names sorted alphabetically as a French reader expects ("École" with the "E")."""
    ascii_text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", " ", ascii_text).strip()


@cache
def listed_operators() -> dict[str, str]:
    """Normalised operator names that may be offered in the "who films" list, with their
    class in rules/operators.yaml (public | private); the names questions.yaml leaves out
    (a private individual, an unnamed town) are not."""
    names = yaml.safe_load((regions.ROOT / "rules" / "operators.yaml").read_text())["names"]
    left_out = set(questions()["operator"]["list_excludes"])
    return {e["name"]: e["class"] for e in names if e["name"] not in left_out}


# rules/operators.yaml's class -> the operator answer it goes with (a private operator is
# "Commerce ou entreprise": a private individual is never a listed name).
ANSWER_OF_CLASS = {"public": "public", "private": "business"}


def all_operators() -> list[dict]:
    """Every listed name with its answer class (public | business), sorted as a French reader
    expects (fold): the punk editor's and /revue's search (lot of 2026-10-12)."""
    names = [{"name": n, "class": ANSWER_OF_CLASS[c]} for n, c in listed_operators().items()]
    return sorted(names, key=lambda e: (fold(e["name"]), e["name"]))


def height_class(answer: str) -> str:
    """The class a height answer is stored as: the classique's « sur un poteau » as
    rules/questions.yaml height.legacy says (migration 017 moved the stored ones)."""
    return questions()["height"].get("legacy", {}).get(answer, answer)


def proposed_operator(text: str) -> str | None:
    """A name the contributor typed, as stored (rules/questions.yaml operator.proposed):
    Unicode NFC, trimmed, inner spaces collapsed; None when it is not a name (length, first
    character, a character neither letter, digit nor the punctuation allowed)."""
    rule = questions()["operator"]["proposed"]
    name = re.sub(r"\s+", " ", unicodedata.normalize("NFC", text)).strip()
    if not rule["min_chars"] <= len(name) <= rule["max_chars"] or not name[0].isalnum():
        return None
    if any(not (c.isalnum() or c in rule["punctuation"]) for c in name):
        return None
    return name
