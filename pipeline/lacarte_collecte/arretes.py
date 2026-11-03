"""The prefectoral acts of all of France: found and read through Attrap, with our own slow crawl
where Attrap does not read (rules/collecte_administrations.yaml).

Attrap (attrap.fr, La Quadrature du Net) indexes the recueils of 109 administrations and
gives each one's full text (OCR included) and its official PDF's address. Its API, read on
2026-10-31: `/api/v1/search` (full text, by administration and dates, 10 results a page,
at most 10 000 results), `/api/v1/raa/<id>` (the text, the address, the dates),
`/api/v1/administration/<id>` (the list, newest first). A recueil's id is the SHA-256 of
its PDF's address, percent-decoded (`recueil_id`): what is already read is known without a
request. Attrap is asked at collection time only, never by the site; its code (CeCILL) is
not used, only these facts.

For each administration, in the waves' order, since `depuis` (2024-01-01): every act kind
of rules/collecte_actes.yaml is searched once over the whole period (cut in two only past
Attrap's 10 000 results; then from a month before the last search); each recueil found is
read once (`texte`: Attrap's text by default; `pdf`, or Attrap's text missing or
unreadable: the official PDF, downloaded then deleted, never on a host behind an
anti-robot check, `defi`) by parse_raa.lire. A recueil whose act is kept has its official
link checked once (its first bytes), except on a `defi` host. The administration's
newest recueil in Attrap, whatever its acts, is its freshness (`dernier_recueil`).

Nothing of a text is kept: the acts' fields, their titles (civilities masked), the recueil's
name, date and official address.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import re
import urllib.parse
from typing import Any

from lacarte_collecte import parcours, parse_raa, pdf
from lacarte_collecte.cache import Cache
from lacarte_collecte.contexte import Contexte, rules
from lacarte_collecte.etat import Etat, Store
from lacarte_registre import fetch

SOURCE = "attrap"
CAP = 10_000


def recueil_id(url: str) -> str:
    return hashlib.sha256(urllib.parse.unquote(url).encode()).hexdigest()


def administrations(ctx: Contexte) -> dict[str, dict[str, Any]]:
    all_ = rules("collecte_administrations.yaml", ctx.rules_dir)
    head = {a: i for i, a in enumerate(all_.get("en_tete") or [])}
    conf = all_["administrations"]
    return dict(
        sorted(
            conf.items(),
            key=lambda kv: (head.get(kv[0], len(head)), kv[1]["vague"], -kv[1]["actes_12_mois"]),
        )
    )


def search(f: fetch.Fetcher, base: str, aid: str, words: str, a: dt.date, b: dt.date) -> list[dict]:
    """Every hit of `words` in `aid`'s recueils between a and b (both included); a period with
    more than Attrap's 10 000 results is cut in two."""
    hits: list[dict] = []
    page = 1
    while True:
        params = {
            "s": words,
            "administration": aid,
            "start_date": a.isoformat(),
            "end_date": b.isoformat(),
            "sort": "desc",
            "page": page,
        }
        d = f.get_json(base + "search", params, cache=False)
        total = int(d.get("total") or 0)
        if total >= CAP and b > a:
            mid = a + (b - a) // 2
            return search(f, base, aid, words, a, mid) + search(
                f, base, aid, words, mid + dt.timedelta(days=1), b
            )
        hits += d.get("elements") or []
        if not d.get("elements") or len(hits) >= total:
            return hits
        page += 1


def is_read(rec: dict[str, Any] | None) -> bool:
    """Read already, by the current reader (an older one's reading is done again)."""
    return bool(rec) and rec.get("statut") == "lu" and rec.get("lecteur") == parse_raa.VERSION


def safe_id(key: str) -> str:
    """An act's id as the site can name a file and a route by it: a heading's number may hold
    a « / » (« 24-08/322 », the Eure-et-Loir's)."""
    return re.sub(r"[^\w.~:-]", "-", key)


def _act_id(admin: str, rid: str, a: parse_raa.Acte) -> str:
    key = a.acte if a.gabarit == "identifiants" else f"{admin}:{rid[:12]}:{a.acte}"
    return safe_id(key)


def read_recueil(
    ctx: Contexte,
    admin: str,
    conf: dict[str, Any],
    rec: dict[str, Any],
    text: str | None,
    kinds: list[parse_raa.Type],
    communes: parse_raa.Communes,
    mode: str,
) -> dict[str, Any]:
    """One recueil's text (Attrap's, else the official PDF's), read; its acts kept."""
    origin = "attrap"
    if mode == "pdf" or not text or not pdf.readable(text):
        if conf.get("defi"):
            return {**rec, "statut": "non_lu", "raison": "texte absent ou illisible (hôte à défi)"}
        f = ctx.fetcher("pdf")
        try:
            text, info = pdf.read(f, rec["url"], ctx.root / "tmp")
        except (fetch.Blocked, fetch.Forbidden, fetch.Failed) as e:
            return {**rec, "statut": "non_lu", "raison": f"PDF : {e.raison}"}
        origin = "pdf"
        if not text or not pdf.readable(text):
            return {**rec, "statut": "non_lu", "raison": "PDF illisible"}
    acts = parse_raa.lire(text, communes, kinds, dt.date.fromisoformat(rec["date"]))
    rid = rec["id"]
    Store(ctx.root, "actes").add(
        {
            **a.as_dict(),
            "id": _act_id(admin, rid, a),
            "lecteur": parse_raa.VERSION,
            "administration": admin,
            "departement": conf["code"],
            "recueil": rid,
            "recueil_nom": rec["name"],
            "recueil_date": rec["date"],
            "url": rec["url"],
            "texte": origin,
        }
        for a in acts
    )
    return {
        **rec,
        "statut": "lu",
        "texte": origin,
        "actes": len(acts),
        "lecteur": parse_raa.VERSION,
    }


def check_link(ctx: Contexte, conf: dict[str, Any], rec: dict[str, Any]) -> str | None:
    """The official link, checked once: "ok", "absent" (an error status), "refus", or None
    when it is not asked (a host behind an anti-robot check)."""
    if conf.get("defi"):
        return None
    # stopped while the prefectures' platform cuts or refuses us (2026-11-03: 74 cuts and
    # 56 refusals at one request per 10 s): never asked again until the rule says so
    if not ctx.fetcher("liens").conf["sources"]["attrap"].get("verifier_liens", True):
        return None
    try:
        r = ctx.fetcher("liens").first_bytes(rec["url"])
    except (fetch.Blocked, fetch.Forbidden):
        return "refus"
    except fetch.Failed:
        return "injoignable"
    return "ok" if r.status in (200, 206) and r.body[:4] == b"%PDF" else f"HTTP {r.status}"


def collect_admin(
    ctx: Contexte,
    admin: str,
    conf: dict[str, Any],
    kinds: list[parse_raa.Type],
    communes: parse_raa.Communes,
    mode: str,
) -> dict[str, Any]:
    f = ctx.fetcher(SOURCE)
    base = f.conf["sources"]["attrap"]["api"]
    since = dt.date.fromisoformat(str(f.conf["sources"]["attrap"]["depuis"]))
    st = Etat(ctx.root, SOURCE)
    state = st.get(admin)
    aid = conf["attrap"]
    # freshness: the newest recueil Attrap has, whatever it holds
    latest = (
        f.get_json(
            f"{base}administration/{aid}", {"page": 1, "size": 1, "sort": "desc"}, cache=False
        ).get("elements")
        or []
    )
    state = st.save(admin, dernier_recueil=latest[0]["date"] if latest else None)
    store = Store(ctx.root, "recueils")
    known = {r["id"]: r for r in store.records() if r.get("administration") == admin}
    raw = ctx.rules_dir / "collecte_actes.yaml"
    words = {k: v["recherche"] for k, v in rules(raw.name, raw.parent)["types"].items()}
    # {kind: the day its search last went to}: the next search starts a month before it
    # (a recueil indexed late); a state of the former monthly searches starts at its month
    upto = state.get("jusqu_au") or {}
    months_done = state.get("mois") or {}
    for kind, q in words.items():
        if kind in upto:
            start = max(since, dt.date.fromisoformat(upto[kind]) - dt.timedelta(days=31))
        elif kind in months_done:
            start = dt.date.fromisoformat(months_done[kind])
        else:
            start = since
        if ctx.out_of_time():
            return st.save(admin, statut="en_cours", jusqu_au=upto)
        # one search over the whole period, newest first (cut in two only past 10 000)
        for h in search(f, base, aid, q, start, ctx.today):
            rid = h["id"]
            if is_read(known.get(rid)):
                continue
            if ctx.out_of_time():
                return st.save(admin, statut="en_cours", jusqu_au=upto)
            # its text from the server's cache when it is there: no request
            d = Cache(ctx.root).get(rid) or f.get_json(f"{base}raa/{rid}", cache=False)
            rec = {
                "id": rid,
                "administration": admin,
                "date": d.get("date") or h["date"],
                "name": parse_raa.mask(d.get("name") or h.get("name") or ""),
                "url": d.get("url") or h.get("url"),
                "familles": [kind],
            }
            rec = read_recueil(ctx, admin, conf, rec, d.get("content"), kinds, communes, mode)
            if rec.get("actes") and d.get("content"):
                Cache(ctx.root).put(rec, d["content"])  # a surveillance recueil: kept
            if rec.get("actes"):
                rec["lien"] = check_link(ctx, conf, rec)
            store.add([rec])
            known[rid] = rec
        upto[kind] = ctx.today.isoformat()
        st.save(admin, jusqu_au=upto)
    # the recueils read before by an older reader, searched no more (a search starts a month
    # back): their text asked one last time, or taken from the cache, read, and cached
    for rid, old in list(known.items()):
        if is_read(old) or old.get("statut") != "lu" or not old.get("actes"):
            continue
        if ctx.out_of_time():
            return st.save(admin, statut="en_cours", jusqu_au=upto)
        d = Cache(ctx.root).get(rid) or f.get_json(f"{base}raa/{rid}", cache=False)
        rec = {k: old.get(k) for k in ("id", "administration", "date", "name", "url", "familles")}
        rec = read_recueil(ctx, admin, conf, rec, d.get("content"), kinds, communes, mode)
        if rec.get("actes") and d.get("content"):
            Cache(ctx.root).put(rec, d["content"])
        store.add([rec])
        known[rid] = rec
    found = [r["date"] for r in known.values()]
    return st.save(
        admin,
        statut="termine",
        jusqu_au=upto,
        dernier_document=max(found) if found else state.get("dernier_document"),
    )


def collect(ctx: Contexte, vagues: set[int] | None = None) -> dict[str, Any]:
    kinds = parse_raa.types(ctx.rules_dir / "collecte_actes.yaml")
    f = ctx.fetcher(SOURCE)
    mode = str(f.conf["sources"]["attrap"].get("texte", "attrap"))
    path = ctx.root / "communes.json"
    summary: dict[str, Any] = {"source": SOURCE, "administrations": {}}
    for admin, conf in administrations(ctx).items():
        if vagues and conf["vague"] not in vagues:
            continue
        if ctx.out_of_time():
            break
        # the départements whose communes its acts name: its own, or the rule's (the
        # Préfecture de police acts in the inner suburbs, Paris's recueils for the airports)
        deps = set(conf.get("communes") or ([conf["code"]] if conf["genre"] != "region" else []))
        communes = (
            parse_raa.Communes.load(path, deps) if path.is_file() else parse_raa.Communes({}, set())
        )
        try:
            if conf.get("attrap") and not conf.get("collecteur_arrete"):
                s = collect_admin(ctx, admin, conf, kinds, communes, mode)
            elif conf.get("parcours") and conf.get("index"):
                s = parcours.collect_admin(ctx, admin, conf, kinds, communes)
            else:
                s = Etat(ctx.root, SOURCE).save(admin, statut="non_couvert")
        except (fetch.Blocked, fetch.Forbidden) as e:
            s = Etat(ctx.root, SOURCE).save(admin, statut="ferme_aux_robots", raison=e.raison)
        except fetch.Failed as e:
            s = Etat(ctx.root, SOURCE).save(admin, statut="echec", raison=e.raison)
        summary["administrations"][admin] = s.get("statut")
    summary["requetes"] = ctx.requetes()
    return summary


def relire(
    ctx: Contexte, admin: str | None = None, actes: set[str] | None = None
) -> dict[str, Any]:
    """The cached recueils read again by the code sent (`lacarte-collecte relire`): no request,
    derived fields only; `admin` or `actes` narrow it."""
    kinds = parse_raa.types(ctx.rules_dir / "collecte_actes.yaml")
    admins = administrations(ctx)
    store, recs = Store(ctx.root, "actes"), Store(ctx.root, "recueils")
    by_rec = {a["recueil"] for a in store.records() if actes and a["id"] in actes}
    path = ctx.root / "communes.json"
    done, n_acts = [], 0
    for d in Cache(ctx.root).all():
        if admin and d["administration"] != admin or actes and d["id"] not in by_rec:
            continue
        conf = admins[d["administration"]]
        deps = set(conf.get("communes") or ([conf["code"]] if conf["genre"] != "region" else []))
        com = (
            parse_raa.Communes.load(path, deps) if path.is_file() else parse_raa.Communes({}, set())
        )
        rec = {k: d.get(k) for k in ("id", "administration", "date", "name", "url")}
        rec = read_recueil(ctx, d["administration"], conf, rec, d["content"], kinds, com, "attrap")
        recs.add([rec])
        done.append(d["id"])
        n_acts += rec.get("actes") or 0
    return {"recueils": len(done), "actes": n_acts, "lecteur": parse_raa.VERSION}
