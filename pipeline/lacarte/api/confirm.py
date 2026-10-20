"""Agreement on proposals, and validation (DECISIONS.md 2026-09-29).

A proposal is a move, a "not found" verify, or an add (phase "Ajouter": a camera the map
does not have). Other contributors agree or disagree with it
through their own contributions and through opinions (kinds agree / disagree, `target` =
the proposal). Counted per distinct author other than the proposal's:

- not found: agree = other "not found" verifies + agree opinions;
             disagree = other "present" verifies + disagree opinions;
- move:      agree = other moves within `move_within_m` + agree opinions;
             disagree = disagree opinions (a move elsewhere is another proposal);
- add:       agree = agree opinions; disagree = disagree opinions (another add nearby is
             another proposal, the phone shows it before sending).

A "Compléter" answer (phase D2: shape, direction, operator) is agreed by another author's
answer to the same question (rules/participation.yaml confirm): the same shape, the same
operator (class, and the name when both give one), a direction within `direction_within_deg`;
another answer disagrees. "Je ne sais pas" and "Je ne vois pas" neither agree nor disagree.
A disabled account's contributions (lot 2: an administrator disabled or suspended it)
neither agree nor disagree with anything; its own proposals are still counted.

In `review` mode (the default) the counts are a signal for the review account, which alone
validates or rejects. In `peer` mode a proposal with another author's agreement is
validated; a present verify agreed by another author too. Rejected contributions and the
review account's decisions are never counted against or overridden.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

PROPOSAL_ANSWERS = ("not_found",)
D2_KINDS = ("shape", "direction", "operator", "height", "tilt")  # height, tilt: phase D3
NO_ANSWER = ("unknown", "not_visible")  # "Je ne sais pas", "Je ne vois pas"
# Statuses peer mode never changes: rejected, and those the deploy writes (migration 005).
# Statuses after which a contribution says nothing any more (rejected; withdrawn by its
# author, migration 008).
CLOSED = ("rejected", "withdrawn")
SETTLED = (*CLOSED, "applied", "superseded", "conflict")


@dataclass(frozen=True)
class Row:
    uuid: str
    kind: str  # verify | move | add | agree | disagree | shape | direction | operator
    author: str
    status: str  # pending | validated | rejected | applied | superseded | conflict | withdrawn
    answer: str | None = None  # verify
    x: float = math.nan  # move: new position, metres
    y: float = math.nan
    target: str | None = None  # agree / disagree: the proposal; on an added camera: its add
    decided: bool = False  # the review account decided it
    direction_deg: int | None = None  # direction
    operator_name: str | None = None  # operator
    on_site: bool | None = None  # made on site, as the phone said (true / false / unknown)
    disabled: bool = False  # its author's account is disabled: its voice never counts


def answered(r: Row) -> bool:
    """A D2 contribution that says something: not "Je ne sais pas" nor "Je ne vois pas"."""
    return r.kind in D2_KINDS and r.answer not in NO_ANSWER


def angle_between(a: float, b: float) -> float:
    return abs((a - b + 180) % 360 - 180)


def same_answer(a: Row, b: Row, within_deg: float) -> bool:
    """Two answers to the same D2 question agree (both answered)."""
    if a.kind == "direction":
        return angle_between(a.direction_deg, b.direction_deg) <= within_deg
    if a.kind == "operator" and a.operator_name and b.operator_name:
        return a.answer == b.answer and a.operator_name == b.operator_name
    return a.answer == b.answer


def d2_agreements(rows: list[Row], within_deg: float) -> dict[str, tuple[int, int]]:
    """(agree, disagree) for every answered D2 contribution of one camera: distinct other
    authors answering the same question the same way, or another way."""
    live = [r for r in rows if r.status not in CLOSED and answered(r)]
    out = {}
    for p in live:
        agree, disagree = set(), set()
        for o in live:
            if o.kind != p.kind or o.author == p.author or o.disabled:
                continue
            (agree if same_answer(p, o, within_deg) else disagree).add(o.author)
        out[p.uuid] = (len(agree), len(disagree))
    return out


OPINIONS = ("agree", "disagree")


def is_proposal(r: Row) -> bool:
    return r.kind in ("move", "add") or (r.kind == "verify" and r.answer in PROPOSAL_ANSWERS)


def agreements(rows: list[Row], move_within_m: float) -> dict[str, tuple[int, int]]:
    """(agree, disagree) for every proposal of one camera: distinct other authors."""
    live = [r for r in rows if r.status not in CLOSED]
    out = {}
    for p in live:
        if not is_proposal(p):
            continue
        agree, disagree = set(), set()
        for o in live:
            if o.author == p.author or o.uuid == p.uuid or o.disabled:
                continue
            if o.kind in OPINIONS and o.target == p.uuid:
                (agree if o.kind == "agree" else disagree).add(o.author)
            elif p.kind == "move" and o.kind == "move":
                if math.hypot(o.x - p.x, o.y - p.y) <= move_within_m:
                    agree.add(o.author)
            elif p.kind == "verify" and o.kind == "verify":
                if o.answer == p.answer:
                    agree.add(o.author)
                elif o.answer == "present":
                    disagree.add(o.author)
        out[p.uuid] = (len(agree), len(disagree))
    return out


def on_site_confirmers(
    rows: list[Row], move_within_m: float, within_deg: float
) -> dict[str, set[str]]:
    """/revue's « confirmée sur place » (lot 1): for every contribution of one camera but
    the opinions, the distinct other authors whose agreement with it was made on site — an
    agree opinion on it, the same answer to the same "Compléter" question (same_answer), a
    move within `move_within_m` — each itself on site, not closed, its account not
    disabled. A signal that puts the camera first in the queue; the decision stays the
    reviewer's (peer validation is off). Since lot 2 also another « introuvable » (a
    not_found verify) for a not_found verify."""
    voices = [o for o in rows if o.on_site is True and not o.disabled and o.status not in CLOSED]
    out = {}
    for p in rows:
        if p.kind in OPINIONS:
            continue
        who = set()
        for o in voices:
            if o.author == p.author or o.uuid == p.uuid:
                continue
            if o.kind == "agree" and o.target == p.uuid:
                who.add(o.author)
            elif p.kind == "move" and o.kind == "move":
                if math.hypot(o.x - p.x, o.y - p.y) <= move_within_m:
                    who.add(o.author)
            elif p.kind == o.kind == "verify" and p.answer == o.answer == "not_found":
                who.add(o.author)  # « introuvable » seconded from the spot (lot 2)
            elif (answered(p) and answered(o) and o.kind == p.kind
                  and same_answer(p, o, within_deg)):  # fmt: skip
                who.add(o.author)
        out[p.uuid] = who
    return out


def statuses(rows: list[Row], move_within_m: float) -> dict[str, str]:
    """`peer` mode: the new status of every verify and move of one camera. A proposal with
    another author's agreement is validated, as is a present verify matched by another
    author's; unsure never; the review account's decisions and rejections stay."""
    agreed = agreements(rows, move_within_m)
    out = {}
    for r in rows:
        if r.kind not in ("verify", "move", "add"):
            continue
        if r.decided or r.status in SETTLED:
            out[r.uuid] = r.status
        elif r.uuid in agreed:
            out[r.uuid] = "validated" if agreed[r.uuid][0] >= 1 else "pending"
        elif r.kind == "verify" and r.answer == "present":
            same = any(
                o.kind == "verify" and o.answer == "present" and o.author != r.author
                and o.status not in CLOSED and not o.disabled
                for o in rows
            )  # fmt: skip
            out[r.uuid] = "validated" if same else "pending"
        else:
            out[r.uuid] = "pending"
    return out
