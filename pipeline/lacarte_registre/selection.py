"""Which DECP contracts are video surveillance, and the text rules every source shares.

The rules are rules/registre_selection.yaml (§ 1 to 5), ported from the exploration
(design/registre/collecte/decp_select.py, dispositifs_decp.py, build_registre.py, faits.py,
sanitize.py) and matched as its DuckDB did: on the lower-cased text, `\\b` an ASCII word
boundary (RE2). A row is a dict with the DECP's column names.

- `row_path(row)`: the path one row would give its contract (or None);
- `select(rows)`: {uid: path} of the contracts kept, from all their rows;
- `dispositif(objet)`: the device a contract is about;
- `texte(s)`: a free text without a natural person (e-mail, phone, civility or rank and a
  name), as every free text the registre serves;
- `norm`, `tokens`, `jaccard`: the comparisons of buyers' names and objets.
"""

from __future__ import annotations

import functools
import re
import unicodedata
from collections.abc import Iterable
from pathlib import Path
from typing import Any

import yaml

import lacarte_registre as registre

Row = dict[str, Any]


@functools.cache
def rules(path: Path | None = None) -> dict[str, Any]:
    return yaml.safe_load((path or registre.RULES / "registre_selection.yaml").read_text("utf-8"))


def _rx(pattern: str) -> re.Pattern[str]:
    return re.compile(pattern, re.ASCII)


@functools.cache
def _compiled() -> dict[str, Any]:
    r = rules()
    w = r["words"]
    roles = {code: role for role in ("coeur", "large", "drone", "exclu") for code in r["cpv"][role]}
    d = r["dispositifs"]
    return {
        "roles": roles,
        **{k: _rx(w[k]["rx"]) for k in w},
        "devices": [(k, _rx(d["rx"][k])) for k in d["order"]],
        "device_ctx": _rx(d["context"]["rx"]),
        "ctx_devices": frozenset(d["context"]["devices"]),
        "order": r["paths"]["order"],
    }


def role(cpv: str | None) -> str | None:
    return _compiled()["roles"].get((cpv or "")[:8])


def row_path(row: Row) -> str | None:
    """The path one row gives its contract, as decp_select.py's CASE (None: no path)."""
    c = _compiled()
    objet = (row.get("objet") or "").lower()
    buyer = (row.get("acheteur_nom") or "").lower()
    r = role(row.get("codeCPV"))
    if r == "exclu":
        return None
    if c["strong"].search(objet):
        return "mot_fort"
    if r == "coeur" and (c["video_any"].search(objet) or c["weak"].search(objet)):
        return "cpv_coeur+mot"
    if r == "coeur":
        return "cpv_coeur_seul"
    if c["drone_context"].search(objet):
        return "drone"
    if r == "drone" and c["drone_buyer"].search(buyer):
        return "drone"
    if r == "large" and c["weak"].search(objet):
        return "cpv_large+mot_faible"
    return None


def select(rows: Iterable[Row]) -> dict[str, str]:
    """{uid: path} of the contracts kept, given every row of each candidate contract: the best
    path of its rows; dropped when its path is neither mot_fort nor drone and one of its rows'
    objet is noise (decp_select.py)."""
    c = _compiled()
    rank = {p: i for i, p in enumerate(c["order"])}
    best: dict[str, str] = {}
    noisy: set[str] = set()
    for row in rows:
        uid = row["uid"]
        p = row_path(row)
        if p is not None and (uid not in best or rank[p] < rank[best[uid]]):
            best[uid] = p
        if row.get("objet") and c["noise"].search(row["objet"].lower()):
            noisy.add(uid)
    return {u: p for u, p in best.items() if p in ("mot_fort", "drone") or u not in noisy}


def dispositif(objet: str | None) -> str:
    """The device a contract is about, from its objet (dispositifs_decp.py); else
    « videoprotection »."""
    c = _compiled()
    o = (objet or "").lower()
    for name, rx in c["devices"]:
        if rx.search(o) and (name not in c["ctx_devices"] or c["device_ctx"].search(o)):
            return name
    return "videoprotection"


def video_notice(text: str) -> bool:
    return bool(re.search(rules()["liens"]["video_notice"], text, re.I))


# --- free text without a natural person (sanitize.py) -------------------------------------
EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
PHONE = re.compile(r"(?:\(\+33\)|\+33|\b0)\s*[1-9](?:[\s.-]*\d{2}){4}\b")
CIVILITY = re.compile(
    r"(?:M\.|Mme|MME|Mlle|MLLE|Monsieur|MONSIEUR|Madame|MADAME|Mr)\s+"
    r"(?:[A-ZÉÈÀÂÎÔÛÇ][\w'’-]+\s*){1,3}"
)
RANK = re.compile(
    r"\b((?:adjudant|brigadier)(?:-chef)?|capitaine|lieutenant(?:-colonel)?|commandant|colonel"
    r"|major|gardien de la paix|chef de service|directeur|directrice|interlocuteur"
    r"|interlocutrice)\s+(?:[A-ZÉÈÀÂÎÔÛÇ][\w'’-]+\s+){1,2}",
    re.I,
)
TRIBUTE = re.compile(
    r"\b((?:en\s+)?(?:hommage|m[ée]moire)\s+(?:à|a|de|d['’])\s*)(?:[A-ZÉÈÀÂÎÔÛÇ][\w'’-]+\s*){1,3}"
)
STREET_BEFORE = re.compile(
    r"\b(?:rue|avenue|av\.|boulevard|bd|quai|place|cours|allée|allee|chemin|route|impasse"
    r"|montée|montee|pont|passage|square|esplanade|rond-point|voie|parvis)\s+(?:\S+\s+)?$",
    re.I,
)


def _sans_personne(s: str) -> str:
    s = EMAIL.sub("[courriel retiré]", s)
    s = PHONE.sub("[téléphone retiré]", s)
    s = CIVILITY.sub("[nom retiré] ", s)
    s = TRIBUTE.sub(lambda m: f"{m.group(1)}[nom retiré] ", s)

    def rank(m: re.Match[str]) -> str:
        if STREET_BEFORE.search(s[max(0, m.start() - 40) : m.start()]):
            return m.group(0)
        return f"{m.group(1)} [nom retiré] "

    return RANK.sub(rank, s)


def texte(s: Any, n: int = 300) -> str:
    """A free text as the registre serves it: one line, no natural person, at most n
    characters (build_registre.txt)."""
    if not isinstance(s, str) or not s.strip():
        return ""
    s = _sans_personne(re.sub(r"\s+", " ", s.replace("<br />", " ")).strip())
    return s if len(s) <= n else s[: n - 1].rstrip() + "…"


# --- comparisons --------------------------------------------------------------------------
def plain(s: Any) -> str:
    """Lower case, no accent (the mixte and national rules' text)."""
    return unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode().lower()


def norm(s: Any) -> str:
    """A buyer's name for comparison: no accent, no parenthesis, no « commune de »."""
    s = plain(s)
    s = re.sub(r"\(.*?\)", " ", s)
    s = re.sub(r"\b(commune|ville|mairie|de|d|du|la|le|les|l)\b", " ", s)
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


STOP = frozenset(
    ["de", "la", "le", "les", "des", "du", "et", "en", "a", "au", "aux", "pour", "sur", "dans"]
    + ["un", "une", "d", "l", "lot", "n", "no", "marche", "marches", "accord", "cadre"]
)
STOP_PROBABLE = STOP | {
    "fourniture", "fournitures", "installation", "travaux", "prestations", "prestation",
    "maintenance",
}  # fmt: skip


def words(s: Any, stop: frozenset[str] = STOP) -> set[str]:
    return {w for w in norm(s).split() if len(w) > 2 and w not in stop}


def jaccard(a: Any, b: Any, stop: frozenset[str] = STOP) -> float:
    wa, wb = words(a, stop), words(b, stop)
    return len(wa & wb) / len(wa | wb) if wa and wb else 0.0


def luhn(n: str) -> bool:
    s = 0
    for i, ch in enumerate(reversed(n)):
        d = int(ch) * (2 if i % 2 else 1)
        s += d - 9 if d > 9 else d
    return s % 10 == 0


def siren_of(x: Any) -> str:
    """A SIREN from a SIREN or a SIRET (digits only, Luhn-valid), else ""."""
    d = re.sub(r"\D", "", str(x or ""))
    return d[:9] if len(d) in (9, 14) and luhn(d[:9]) else ""
