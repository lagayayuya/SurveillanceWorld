"""« Signaler une erreur » in the register (lot R1b, migration 026): no one reviews the
register's documents (DECISIONS 2026-10-28), so a reader's report is how it gets corrected.
A reader reports; a reviewer accepts or refuses in /revue (« Registre »); an accepted
correction is applied by the next `lacarte-registre construire` (`lacarte-registre
corrections exporter` reads the accepted ones).

POST /api/registre/signalement — a reader reports an error in a document. No account needed
and none kept: nothing about the sender is stored (no address, no user agent, no account,
even signed in; the day only, never a time), and nothing is logged of a report.

    Request: Origin the site's own, Content-Type application/json (the API's guard), body
    {
      "evenement": "216902833000132020_32323500~0",  the document's id (the register's
                     evenement id): [A-Za-z0-9._~-], 1 to 80 characters
      "affaire": "216902833000132020_32323500",     its affaire, whose page is
                     /registre/contrat/<affaire>: the same format
      "category": "montant",   what is wrong: montant, date, entreprise, commune, nom,
                     lien, cameras, zone or autre
      "correction": "…",       what the reader says it should be: 1 to 1000 characters once
                     trimmed (lines kept, other control characters become spaces)
      "source": "https://…",   optional (absent, null or ""): where it is written; an https
                     address, at most 500 characters, no space, no user name
      "contact": "…"           optional (absent, null or ""): how to reach the reader, one
                     line, at most 200 characters; erased when the report is decided, at the
                     latest after 90 days (rules/stats.yaml report_contact_days)
    }
    Answers:
      201 {"ok": true}                          received
      403 {"error": "origin"}                   not the site's Origin (the guard)
      415 {"error": "content_type"}             not JSON (the guard)
      403 {"error": "closed"}                   contributions closed (/revue « Réglages »:
                                                the route is in app.CLOSED_ROUTES)
      403 {"error": "robot"}                    a User-Agent that says it is a robot, or none
                                                (rules/stats.yaml bots, as POST /api/hit)
      422 {"error": "invalid", "fields": [...]} a field missing or wrong: the fields' names
      429 {"error": "rate"}                     over limits.reports_per_minute
                                                (rules/participation.yaml): one bucket for
                                                every reader not signed in (nothing tells
                                                them apart), one per account signed in
      500 {"error": "internal"}

/revue « Registre » (a reviewer's or an administrator's privileged session, app.staff;
anything else 401 privileged, as every /api/review/* route):

GET /api/review/registre — the reports waiting, one row per reported document, the one
waiting longest first:
    200 {"pending": 3,                         reports waiting, every document
         "documents": [{
           "evenement": "…~0", "affaire": "…",   the page: /registre/contrat/<affaire>
           "age_days": 12,                     its oldest report's age, in days
           "reports": [{"id": "<uuid>", "category": "date", "correction": "…",
                        "source": "https://…" | null, "contact": "…" | null,
                        "received_on": "2026-10-17", "age_days": 12}, …]  oldest first
         }, …],
         "fields": ["montant", "date", …]}     what an acceptance may change (FIELDS)

POST /api/review/registre — a decision on one report (Origin and JSON, as every write):
    {"id": "<uuid>", "decision": "accept" | "refuse",
     "field": "montant",      accept only: what the build changes on the document — montant,
                              date, entreprises, insee, beneficiaire, cameras or affaire
     "value": 12000,          accept only: what it puts there, by field: a number of euros
                              (0 to 1e11), "YYYY-MM-DD", a list of SIREN (9 digits each,
                              distinct, at most 50), an INSEE code, a name (one line, 200
                              characters), a whole number of cameras, an affaire's id
     "reason": "…"}           accept only: why (1 to 500 characters, one line), the
                              correction's rationale in the build
    Answers:
      200 {"id": …, "state": "accepted", "field": …, "value": …}  (the value as kept)
      200 {"id": …, "state": "refused"}
      the reader's contact is erased by either; the decision is journalled
      (registre_accept with {report, field}, registre_refuse with {report}; the document's
      id as target, never the reader's text)
      422 {"error": "invalid", "fields": [...]}  a field missing or wrong (an acceptance
                                                 without field, value or reason names them)
      422 {"error": "value"}                     the value does not fit the field
      422 {"error": "uuid"} / {"error": "uuid_v4_only"}
      404 {"error": "unknown_report"}            no such report (or deleted since)
      409 {"error": "decided"}                   decided already (by someone else)
      429 {"error": "rate"}                      limits.review_per_minute, the bucket every
                                                 review decision shares
An accepted report is a correction: `lacarte-registre corrections exporter` writes it to
data/registre/corrections.yaml (db/export_registre_corrections.sql), which `lacarte-registre
construire` applies.
"""

import unicodedata
from datetime import date
from types import ModuleType
from typing import Annotated, Any, Literal
from urllib.parse import urlsplit

from fastapi import Depends, Request
from fastapi.responses import JSONResponse
from psycopg.types.json import Jsonb
from pydantic import AfterValidator, BaseModel, BeforeValidator, Field

from lacarte import participation
from lacarte.api import stats
from lacarte.api.auth import Account
from lacarte_registre import corrections

CORRECTION_MAX = 1000
SOURCE_MAX = 500
CONTACT_MAX = 200
REASON_MAX = 500
# The rate limit's key for every reader not signed in: nothing tells them apart, by design.
ANONYMOUS = "registre:anonymous"
ID_PATTERN = rf"^{corrections.ID.pattern}$"


def clean(raw: str, lines: bool) -> str:
    """A reader's text as kept: line breaks as \\n (kept when `lines`), every other control
    or format character a space, trimmed."""
    raw = raw.replace("\r\n", "\n").replace("\r", "\n")
    keep = "\n" if lines else ""
    text = "".join(ch if ch in keep or unicodedata.category(ch)[0] != "C" else " " for ch in raw)
    return text.strip()


def bounded(limit: int, lines: bool):
    def check(raw: str) -> str:
        text = clean(raw, lines)
        if not 1 <= len(text) <= limit:
            raise ValueError(f"1 to {limit} characters")
        return text

    return check


def optional(raw: Any) -> Any:
    """Absent, null and "" (once trimmed) alike: none."""
    return None if raw is None or (isinstance(raw, str) and not raw.strip()) else raw


def https(raw: str) -> str:
    url = raw.strip()
    parts = urlsplit(url)
    if (len(url) > SOURCE_MAX or parts.scheme != "https" or not parts.hostname
            or "@" in parts.netloc or any(ch.isspace() or ord(ch) < 32 for ch in url)):  # fmt: skip
        raise ValueError("an https address")
    return url


# Bounded before cleaning too (a text of control characters would shrink to nothing).
Correction = Annotated[str, Field(max_length=4 * CORRECTION_MAX),
                       AfterValidator(bounded(CORRECTION_MAX, lines=True))]  # fmt: skip
Source = Annotated[str, Field(max_length=2 * SOURCE_MAX), AfterValidator(https)]
Contact = Annotated[str, Field(max_length=4 * CONTACT_MAX),
                    AfterValidator(bounded(CONTACT_MAX, lines=False))]  # fmt: skip


Reason = Annotated[str, Field(max_length=4 * REASON_MAX),
                   AfterValidator(bounded(REASON_MAX, lines=False))]  # fmt: skip


class ReportIn(BaseModel):
    evenement: str = Field(pattern=ID_PATTERN)
    affaire: str = Field(pattern=ID_PATTERN)
    category: Literal[corrections.CATEGORIES]
    correction: Correction
    source: Annotated[Source | None, BeforeValidator(optional)] = None
    contact: Annotated[Contact | None, BeforeValidator(optional)] = None


class DecisionIn(BaseModel):
    id: str = Field(max_length=40)
    decision: Literal["accept", "refuse"]
    field: Literal[corrections.FIELDS] | None = None
    value: Any = None
    reason: Annotated[Reason | None, BeforeValidator(optional)] = None


def pending(conn, today: date) -> dict:
    """GET /api/review/registre's answer: the reports waiting, by document."""
    rows = conn.execute(
        "SELECT id::text, evenement, affaire, category, correction, source, contact,"
        " received_on FROM registre_reports WHERE state = 'pending'"
        " ORDER BY received_on, evenement, id"
    ).fetchall()
    docs: dict[str, dict] = {}
    for rid, ev, aff, cat, corr, src, contact, day in rows:
        age = (today - day).days
        d = docs.setdefault(ev, {"evenement": ev, "affaire": aff, "age_days": age,
                                 "reports": []})  # fmt: skip
        d["reports"].append({"id": rid, "category": cat, "correction": corr, "source": src,
                             "contact": contact, "received_on": day.isoformat(),
                             "age_days": age})  # fmt: skip
    return {"pending": len(rows), "documents": list(docs.values()),
            "fields": list(corrections.FIELDS)}  # fmt: skip


def install(api: ModuleType) -> None:
    """The routes, added to the API's app with its own guards and helpers (`api`:
    lacarte.api.app, which calls this at its end; its pool and limits read at each request,
    as the pool is made at the start). On the app itself, not an APIRouter included: since
    FastAPI 0.141 an included router is one opaque entry of app.routes, and the tests walk
    app.routes for every route (CLOSED_ROUTES among them)."""
    r = api.app

    @r.post("/api/registre/signalement", status_code=201)
    def report(body: ReportIn, request: Request,
               who: Annotated[Account | None, Depends(api.visitor)]):  # fmt: skip
        """A reader's report (the contract above): received pending, with the day only."""
        if stats.is_bot(request.headers.get("user-agent"), stats.rules()):
            api.fail(403, "robot")
        per_minute = participation.rules()["limits"]["reports_per_minute"]
        if not api.limits.allow(who.id if who else ANONYMOUS, "report", per_minute):
            api.fail(429, "rate")
        with api.pool.connection() as conn:
            conn.execute(
                "INSERT INTO registre_reports (evenement, affaire, category, correction,"
                " source, contact, received_on) VALUES (%s, %s, %s, %s, %s, %s, %s)",
                (body.evenement, body.affaire, body.category, body.correction, body.source,
                 body.contact, date.today()),
            )  # fmt: skip
        return {"ok": True}

    @r.get("/api/review/registre", dependencies=[Depends(api.staff)])
    def review_registre():
        """« Registre » in /revue: the reports waiting (the contract above)."""
        with api.pool.connection() as conn:
            return pending(conn, date.today())

    @r.post("/api/review/registre")
    def review_registre_decide(body: DecisionIn,
                               who: Annotated[Account, Depends(api.staff)]):  # fmt: skip
        """Accept a report (the field and value the build applies, and why) or refuse it;
        either erases the reader's contact (the contract above)."""
        rid = api.v4(body.id)
        accept = body.decision == "accept"
        value = None
        if accept:
            missing = [k for k in ("field", "value", "reason") if getattr(body, k) is None]
            if missing:
                return JSONResponse({"error": "invalid", "fields": missing}, status_code=422)
            try:
                value = corrections.value(body.field, body.value)
            except ValueError:
                api.fail(422, "value")
        api.review_rate(who)
        with api.pool.connection() as conn, conn.transaction():
            row = conn.execute("SELECT evenement, state FROM registre_reports WHERE id = %s"
                               " FOR UPDATE", (rid,)).fetchone()  # fmt: skip
            if row is None:
                api.fail(404, "unknown_report")
            if row[1] != "pending":
                api.fail(409, "decided")
            if accept:
                conn.execute(
                    "UPDATE registre_reports SET state = 'accepted', decided_on = %s,"
                    " decided_by_id = %s, decided_by = %s, field = %s, value = %s,"
                    " reason = %s, contact = NULL WHERE id = %s",
                    (date.today(), who.id, who.pseudonym, body.field, Jsonb(value),
                     body.reason, rid),
                )  # fmt: skip
                api.journal(conn, who, "registre_accept", target=row[0],
                            detail={"report": rid, "field": body.field})  # fmt: skip
                return {"id": rid, "state": "accepted", "field": body.field, "value": value}
            conn.execute(
                "UPDATE registre_reports SET state = 'refused', decided_on = %s,"
                " decided_by_id = %s, decided_by = %s, contact = NULL WHERE id = %s",
                (date.today(), who.id, who.pseudonym, rid),
            )
            api.journal(conn, who, "registre_refuse", target=row[0], detail={"report": rid})
        return {"id": rid, "state": "refused"}
