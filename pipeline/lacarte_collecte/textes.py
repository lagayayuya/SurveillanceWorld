"""The texts the reference readings need, on the server (`lacarte-collecte textes`): for each act
asked (JSON lines on stdin: id, administration, recueil, acte), its recueil's text from Attrap,
then a window around the act — the act as our reader cuts it, widened by `MARGE` characters on
each side, so that the reference reader is not held to our cut (Ju, 2026-11-02). Written to
stdout only (JSON lines: id, recueil_nom, date, texte), never to a file: the texts name natural
persons, and nothing of them is kept on the server or on the Mac.

Every request goes through fetch.py (robots.txt, the pace per address): the command refuses
to start while the collection's unit runs, whose queue for attrap.fr it would not share.
"""

from __future__ import annotations

import datetime as dt
import json
import re
import sys
from collections.abc import Iterable, Iterator
from pathlib import Path
from typing import Any

from lacarte_collecte import parse_raa
from lacarte_registre import fetch

MARGE = 2000
# the margin of the lighter window (lot R4.2): the cut is good enough on its own for most acts;
# the calibration measures it (25 of 25 kept, or it goes back)
MARGE_LEGERE = 600
# when our reader does not find the act: the text around its first mention
REPLI = 8000


def fenetre(
    text: str, acte: str, pieces: list[parse_raa.Morceau] | None = None, marge: int = MARGE
) -> str | None:
    """The act's window in its recueil's text: our cut widened by MARGE on each side, else
    the text around the act's number. `pieces`: the recueil's cut, made once for its acts."""
    for m in pieces if pieces is not None else parse_raa.split_acts(text):
        key = re.sub(r"[^\w.~:-]", "-", m.acte)
        if acte in (m.acte, key):
            start = text.find(m.texte)
            if start >= 0:
                return text[max(0, start - marge) : start + len(m.texte) + marge]
    hit = re.search(re.escape(acte.rsplit(":", 1)[-1]), text)
    if hit:
        return text[max(0, hit.start() - REPLI // 4) : hit.start() + REPLI]
    return None


# What the reading never needs (lot R4.2): the « Vu » of pure form (codes, laws, decrees, the
# appointments and delegations), the ways and delays of appeal, the formulas of signature and
# execution. « Vu la demande… », the considerations and the articles stay: the purpose and the
# places are there. Each is one clause, up to its « ; » or its sentence's end.
# a « Vu » ends at its « ; », or where the next clause starts when the text layer lost it
FIN_VU = (
    r"(?:;|(?=\s*(?:Vu|VU|Consid[ée]rant|CONSID[ÉE]RANT|Sur (?:la )?proposition"
    r"|ARR[ÊE]TE|Arr[êée]te)\b))"
)
FORME = [
    re.compile(p, re.I)
    for p in (
        r"\bVu (?:le |la |l['’]|les )?(?:code|loi|constitution|ordonnance|r[èe]glement"
        r"|d[ée]cret|directive)\b[^;]{0,700}?" + FIN_VU,
        r"\bVu (?:l['’]|les? )arr[êe]t[ée]s?\b[^;]{0,500}?(?:d[ée]l[ée]gation|nomm|nomination"
        r"|organisation|attributions?)[^;]{0,300}?" + FIN_VU,
        r"[^.;]{0,300}?\b(?:recours (?:gracieux|hi[ée]rarchique|contentieux)|t[ée]l[ée]recours"
        r"|tribunal administratif|d[ée]lai de deux mois)\b[^.]{0,500}\.",
        r"[^.;]{0,300}?\bcharg[ée]s?,? (?:chacun en ce qui (?:le|les) concerne,? )?"
        r"de l['’]ex[ée]cution\b[^.]{0,500}\.",
        r"\bFait [àa] [A-ZÉ][\w' -]{1,40},? le \d{1,2}(?:er)? \w+ 20\d\d",
        r"\bPour le pr[ée]fet(?: de police)?(?:,| et) par d[ée]l[ée]gation\b[^\n]{0,120}",
    )
]


def alleger(w: str) -> str:
    """The window without what the reading never needs (FORME)."""
    for p in FORME:
        w = p.sub(" ", w)
    return re.sub(r"[ \t]{2,}", " ", w)


def lire(f: fetch.Fetcher, asked: Iterable[dict[str, Any]], api: str) -> Iterator[dict[str, Any]]:
    by_recueil: dict[str, list[dict[str, Any]]] = {}
    for a in asked:
        by_recueil.setdefault(a["recueil"], []).append(a)
    for rid, acts in by_recueil.items():
        d = f.get_json(f"{api}raa/{rid}", cache=False)
        text = d.get("content") or ""
        pieces = parse_raa.split_acts(text)  # once per recueil, whatever its acts asked
        for a in acts:
            # the act's own number in its recueil: the national id, or the heading's
            number = a["acte"].rsplit(":", 1)[-1]
            yield {
                "id": a["id"],
                "recueil_nom": parse_raa.mask(d.get("name") or ""),
                "date": d.get("date"),
                "acte": number,
                "texte": fenetre(text, number, pieces),
            }


def main(root: Path, contact: str | None) -> None:
    f = fetch.Fetcher("textes", root, contact=contact)
    asked = [json.loads(line) for line in sys.stdin if line.strip()]
    api = f.conf["sources"]["attrap"]["api"]
    for row in lire(f, asked, api):
        sys.stdout.write(json.dumps(row, ensure_ascii=False) + "\n")
    sys.stdout.flush()
    sys.stderr.write(f"{len(asked)} actes, {f.requests} requêtes, {dt.datetime.now(dt.UTC)}\n")
