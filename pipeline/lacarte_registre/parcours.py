"""A document's place among the register's documents (document/<affaire>.json, « parcours »).

The record of a contract, a call for tenders, a subsidy or a decree shows what the whole corpus
says around it; these are rules over every document, so they are decided here, once, and the
page only reads them:
- `fin_prevue`: a contract's planned end, computed (signature + the duration published, the
  last modification's when it gives one): a date the register calculates, never published;
- `precedent`: the same buyer's previous contract for the same device (signed before this one;
  a copy, or a lot of the same tender, never), the latest of them;
- `suivant`: the same buyer's next call for tenders, published after the signature and, when
  the end is known, not before the two years that precede it (a notice whose contract is for
  another device does not count), the first of them;
- `entreprises`: for each company of the contract, its signed contracts and their distinct
  buyers over the whole register (comptes.entreprises: a copy counted once);
- `contrat`: for a call for tenders or a subsidy, the contract that followed: « probable » (the
  pilot's `contrat_probable`, a link by buyer, object and dates, not by an identifier),
  « attendu » (a call of the last 18 months: its contract may not be published yet),
  « non_retrouve », or for a subsidy « non_designe ».
Dates are the reviewed ones when the review has one (`date_lue`, regles.py); « 18 months » is
counted back from the register's update date, never from the day the page is read.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from lacarte_registre.regles import Event, Registre

PENDING_MONTHS = 18
RENEWAL_MONTHS = 24


def add_months(d: str, n: int) -> str:
    """A date plus n months, its day kept (the page's format.ts addMonths)."""
    y, m = int(d[:4]), int(d[5:7])
    total = y * 12 + (m - 1) + n
    return f"{total // 12}-{total % 12 + 1:02d}{d[7:]}"


def date_lue(e: Event) -> str:
    return e.get("date_lue") or e.get("date") or ""


def months(v: Any) -> int | None:
    """A published duration in months; none when absent or unreadable."""
    try:
        n = round(float(v))
    except (TypeError, ValueError):
        return None
    return n if n > 0 else None


@dataclass
class _Affaire:
    id: str
    kind: str
    buyer: str | None
    group: str | None
    signature: Event | None
    avis: str | None
    events: list[Event]


class Parcours:
    """The corpus indexed once by buyer; parcours(affaire) for each document file."""

    def __init__(
        self,
        reg: Registre,
        lots: dict[str, str],
        ent_stats: dict[str, dict[str, Any]],
        maj: str,
    ):
        self.reg = reg
        self.ent_stats = ent_stats
        self.maj = maj
        self.affaires: dict[str, _Affaire] = {}
        self.by_buyer: dict[str, list[_Affaire]] = {}
        for aid, a in reg.affaires.items():
            evs = sorted(
                (reg.by_id[i] for i in a.get("events") or [] if i in reg.by_id), key=date_lue
            )
            b = a.get("acheteur_siren") or next(
                (s for e in evs if (s := e.get("acheteur_siren"))), None
            )
            x = _Affaire(
                id=aid,
                kind=a.get("kind") or "",
                buyer=b,
                group=lots.get(aid),
                signature=next((e for e in evs if e["t"] == "attribution"), None),
                avis=min((date_lue(e) for e in evs if e["t"] == "avis"), default=None),
                events=evs,
            )
            self.affaires[aid] = x
            if b:
                self.by_buyer.setdefault(b, []).append(x)

    def _others(self, a: _Affaire) -> list[_Affaire]:
        """The same buyer's other affaires, not a lot or a copy of the same tender."""
        return [
            x
            for x in self.by_buyer.get(a.buyer or "", [])
            if x.id != a.id and not (a.group and x.group == a.group)
        ]

    @staticmethod
    def _same_contract_kind(a: _Affaire, x: _Affaire) -> bool:
        sig, att = x.signature, a.signature
        return bool(
            sig and att and not sig["copie"] and sig.get("dispositif") == att.get("dispositif")
        )

    def fin_prevue(self, a: _Affaire) -> dict[str, Any] | None:
        att = a.signature
        if not att or not date_lue(att):
            return None
        mods = [e for e in a.events if e["t"] == "modification"]
        dur = months((mods[-1] if mods else att).get("duree")) or months(att.get("duree"))
        if not dur:
            return None
        start = date_lue(att)
        return {"date": add_months(start, dur), "signature": start, "mois": dur}

    def precedent(self, a: _Affaire) -> dict[str, Any] | None:
        if a.kind != "contrat" or not a.signature:
            return None
        signed = date_lue(a.signature)
        found: list[tuple[str, str, Event]] = []
        for x in self._others(a):
            if x.kind != "contrat" or not x.signature or not self._same_contract_kind(a, x):
                continue
            d = date_lue(x.signature)
            if d and d < signed:
                found.append((d, x.id, x.signature))
        if not found:
            return None
        _, aid, sig = max(found, key=lambda f: f[:2])
        best = self.affaires[aid]
        return {
            "affaire": best.id,
            "date": date_lue(sig),
            "date_a_verifier": bool(sig.get("date_lue")) and sig.get("date_lue") != sig.get("date"),
            "entreprises": sig.get("entreprises") or [],
            "montant": sig.get("montant"),
        }

    def suivant(self, a: _Affaire, fin: dict[str, Any] | None) -> dict[str, Any] | None:
        if a.kind != "contrat" or not a.signature:
            return None
        start = date_lue(a.signature)
        if fin:
            start = max(start, add_months(fin["date"], -RENEWAL_MONTHS))
        best: _Affaire | None = None
        for x in self._others(a):
            if x.kind not in ("contrat", "contrat_non_retrouve") or not x.avis:
                continue
            if x.kind == "contrat" and not self._same_contract_kind(a, x):
                continue
            if x.avis > start and (best is None or (x.avis, x.id) < (best.avis or "", best.id)):
                best = x
        return {"affaire": best.id, "date": best.avis} if best else None

    def contrat(self, a: _Affaire) -> str | None:
        if a.kind not in ("contrat_non_retrouve", "subvention"):
            return None
        if self.reg.affaires[a.id].get("contrat_probable") in self.reg.affaires:
            return "probable"
        if a.kind == "subvention":
            return "non_designe"
        debut = date_lue(a.events[0]) if a.events else ""
        recent = debut and self.maj and debut > add_months(self.maj, -PENDING_MONTHS)
        return "attendu" if recent else "non_retrouve"

    def __call__(self, aid: str) -> dict[str, Any]:
        a = self.affaires[aid]
        att = a.signature if a.kind == "contrat" else None
        fin = self.fin_prevue(a) if att else None
        return {
            "fin_prevue": fin,
            "precedent": self.precedent(a),
            "suivant": self.suivant(a, fin),
            "entreprises": {
                s: {"contrats": st["n"], "collectivites": len(st["clientes"])}
                for s in (att or {}).get("entreprises") or []
                if (st := self.ent_stats.get(s))
            },
            "contrat": self.contrat(a),
        }
