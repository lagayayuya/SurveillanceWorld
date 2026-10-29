"""A company's page (entreprise/<siren>.json, « page »): what its view shows that a rule decides.

Over the company's signed contracts (comptes.entreprises: a copy never), the build gives:
- each contract's planned end: its start (the reviewed date `date_lue`, else the signature's)
  plus its duration in months, the duration of its last modification that gives one, else
  the contract's own; a contract without a published duration has no end;
- the contracts running on the build's date (`maj`): their end after it, the nearest first;
- the number of modifications of these contracts;
- « Ce qui ressort », facts only: the same amount (a counted one, `compte`) signed with
  several buyers (the two that recur most), two contracts of one amount with two buyers
  within 31 days, the contracts with a single offer among those whose number of offers is
  published;
- the lead: what its contracts are (their affaires' categories, when the export gives them)
  and where its buyers are (by département, Île-de-France as one).
No word of the interface here: the view says it.
"""

from __future__ import annotations

from collections import Counter
from datetime import date
from typing import Any

from lacarte_registre.regles import Event, Registre

IDF = frozenset({"75", "77", "78", "91", "92", "93", "94", "95"})
# two contracts of one amount this close (days) are told apart from the recurring amounts
RAPPROCHE_JOURS = 31
IDENTIQUES_MAX = 2


def months(v: Any) -> float | None:
    """A duration in months as published (a number, or a number in a string); else none."""
    if isinstance(v, bool) or v is None:
        return None
    if isinstance(v, int | float):
        return float(v) if v > 0 else None
    try:
        n = float(str(v).replace(",", ".").strip())
    except ValueError:
        return None
    return n if n > 0 else None


def add_months(d: str, n: float) -> str:
    """A date plus n months (rounded half up), the day kept, as the view's addMonths."""
    y, m = int(d[:4]), int(d[5:7])
    total = y * 12 + (m - 1) + int(n + 0.5)
    return f"{total // 12}-{total % 12 + 1:02d}{d[7:]}"


def start(e: Event) -> str:
    return e.get("date_lue") or e.get("date") or ""


def last_duration(reg: Registre, e: Event) -> float | None:
    """The duration as last modified: the latest modification of its affaire that gives one."""
    mods = [
        m
        for i in (reg.affaires.get(e["affaire"]) or {}).get("events") or []
        if (m := reg.by_id.get(i)) and m["t"] == "modification" and months(m.get("duree"))
    ]
    if mods:
        return months(max(mods, key=start).get("duree"))
    return months(e.get("duree"))


def fin(reg: Registre, e: Event) -> dict[str, Any]:
    d0, n = start(e), last_duration(reg, e)
    return {"debut": d0, "duree": n, "fin": add_months(d0, n) if d0 and n else None}


def _days(a: str, b: str) -> int:
    return abs((date.fromisoformat(a[:10]) - date.fromisoformat(b[:10])).days)


def identiques(reg: Registre, contrats: list[Event]) -> list[dict[str, Any]]:
    """Every amount signed with two buyers or more: its contracts (the first of each buyer, by
    date), the closest two of different buyers; the most buyers first, then the largest."""
    by: dict[float, list[Event]] = {}
    for e in contrats:
        if e.get("montant"):
            by.setdefault(e["montant"], []).append(e)
    out = []
    for amount, es in by.items():
        es = sorted(es, key=start)
        first: dict[str, Event] = {}
        for e in es:
            b = reg.buyer(e)
            if b and b not in first:
                first[b] = e
        if len(first) < 2:
            continue
        pairs = [
            (_days(start(a), start(b)), a["id"], b["id"])
            for i, a in enumerate(es)
            for b in es[i + 1 :]
            if reg.buyer(a) != reg.buyer(b) and start(a) and start(b)
        ]
        close = min(pairs) if pairs else None
        out.append(
            {
                "montant": amount,
                "contrats": [e["id"] for e in first.values()],
                "ecart_jours": close[0] if close else None,
                "proches": [close[1], close[2]] if close else [],
            }
        )
    return sorted(out, key=lambda f: (-len(f["contrats"]), -f["montant"]))


def count(v: Any) -> int | None:
    """A published number of offers (a number, or one in a string); else none."""
    if isinstance(v, bool) or v is None:
        return None
    try:
        n = float(str(v).strip())
    except ValueError:
        return None
    return int(n) if n >= 1 and n == int(n) else None


def faits(reg: Registre, contrats: list[Event]) -> dict[str, Any]:
    # the amounts the register adds up (`compte`): not an amount to verify, a ceiling for others
    ids = identiques(reg, [e for e in contrats if e["compte"]])
    tops = ids[:IDENTIQUES_MAX]
    # among the others, the closest two
    near = [
        f
        for f in ids[IDENTIQUES_MAX:]
        if f["ecart_jours"] is not None and f["ecart_jours"] <= RAPPROCHE_JOURS
    ]
    close = min(near, key=lambda f: (f["ecart_jours"], -f["montant"])) if near else None
    offres = [n for e in contrats if (n := count(e.get("offres"))) is not None]
    return {
        "identiques": [{"montant": f["montant"], "contrats": f["contrats"]} for f in tops],
        "rapproche": {
            "montant": close["montant"],
            "contrats": close["proches"],
            "jours": close["ecart_jours"],
        }
        if close
        else None,
        "offres": {"une_offre": offres.count(1), "renseignes": len(offres)} if offres else None,
    }


def activite(reg: Registre, contrats: list[Event]) -> str | None:
    """What its contracts are, from their affaires' categories: installation (or extension)
    and maintenance, one of them, or neither; none when no affaire gives a category."""
    cats = [(reg.affaires.get(e["affaire"]) or {}).get("categorie") for e in contrats]
    if not any(cats):
        return None
    n = Counter(c or "autre" for c in cats)

    def has(k: str) -> bool:
        return n[k] >= 2 or n[k] >= len(contrats) * 0.15

    pose = has("installation") or has("extension")
    if pose and has("maintenance"):
        return "installe_entretient"
    if pose:
        return "installe"
    if has("maintenance"):
        return "entretient"
    return "vend"


def lieux(clientes: list[str], deps: dict[str, str | None]) -> dict[str, Any]:
    """Where its buyers are: Île-de-France as one region, the others by département, the most
    buyers first; `surtout` when the first holds half of them or more, then the second when it
    holds 15 % or more."""
    regions = Counter(
        "idf" if d in IDF else d for s in clientes if (d := deps.get(s))
    ).most_common()
    total = len(clientes) or 1
    if regions and regions[0][1] / total >= 0.5:
        keep = [regions[0][0]]
        if len(regions) > 1 and regions[1][1] / total >= 0.15:
            keep.append(regions[1][0])
        return {"surtout": True, "regions": keep}
    return {"surtout": False, "regions": [r for r, _ in regions[:2]]}


def page(
    reg: Registre, stats: dict[str, Any] | None, maj: str, deps: dict[str, str | None]
) -> dict[str, Any]:
    contrats = [reg.by_id[i] for i in (stats or {}).get("contrats") or []]
    fins = {e["id"]: fin(reg, e) for e in contrats}
    running = sorted(
        (i for i, f in fins.items() if f["fin"] and f["fin"] > maj), key=lambda i: fins[i]["fin"]
    )
    affaires = {e["affaire"] for e in contrats}
    mods = sum(1 for e in reg.evenements if e["t"] == "modification" and e["affaire"] in affaires)
    return {
        "maj": maj,
        "fins": fins,
        "en_cours": running,
        "sans_fin": sum(1 for f in fins.values() if not f["fin"]),
        "modifications": mods,
        "faits": faits(reg, contrats),
        "activite": activite(reg, contrats),
        "lieux": lieux((stats or {}).get("clientes") or [], deps),
    }
