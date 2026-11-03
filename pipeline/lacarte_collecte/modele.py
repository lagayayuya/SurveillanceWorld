"""The acts read by a language model, each field checked against the act's text, on the server
(DECISIONS 2026-11-03).

- Reading: Claude Haiku 5.5, then its own rereading, through the Message Batches API; the
  short instruction cached; the answer constrained by a JSON schema where every field carries
  the exact passage that proves it (`citation`); the act's text with a margin of context
  (textes.fenetre), from the server's cache.
- Check (`controler`), deterministic: a field is kept only if its passage is in the text word
  for word (whitespace normalised); its number is in the passage (or is the sum of the
  numbers the passage writes); its dates and hours parse and stay within the act's bounds;
  its commune is in the COG, in the act's départements. Else it is empty.
- Agreement with the rules, field by field (`accorder`): the same value, or the rules read
  nothing and the model's field passed its check, is published; a disagreement goes to
  Claude Opus 5.5 with both values, whose answer passes the same check, else the field stays
  empty. Each field keeps its value, its origin (regles, modele, accord, arbitrage), the
  model and its version, the instruction's fingerprint.
- One run sends a batch, the next one fetches it (`etat`: the batches in flight); an act is
  read again only when the instruction or the model changes; without the API, the
  collection goes on with the rules alone.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import re
import unicodedata
from typing import Any

from lacarte_collecte import parse_raa, references

LECTEUR = "claude-haiku-5-5"
ARBITRE = "claude-opus-5-5"
KEY_ENV = "LACARTE_ANTHROPIC_KEY"
CHAMPS = (
    "commune",
    "n_interieur",
    "n_exterieur",
    "n_voie_publique",
    "n_total",
    "n_cameras_drone",
    "dates",
    "horaires",
    "perimetre",
)
CITER = (
    "\n\nPour chaque champ, donne sa valeur et la citation exacte du texte qui la prouve : le "
    "passage tel qu'il est écrit dans l'extrait, mot pour mot, sans le corriger ni le résumer "
    "(une phrase ou un fragment). Un champ que le texte ne prouve pas : valeur null (ou liste "
    "vide) et citation null."
)
CONSIGNE = references.CONSIGNE + CITER
ARBITRER = (
    "Deux lectures de cet acte ne sont pas d'accord sur certains champs :\n<lectures>\n{deux}\n"
    "</lectures>\nLis l'acte et rends la lecture juste, au même schéma, chaque champ avec sa "
    "citation exacte."
)


def _champ(kind: dict[str, Any]) -> dict[str, Any]:
    return {
        "type": "object",
        "properties": {"valeur": kind, "citation": {"type": ["string", "null"]}},
        "required": ["valeur", "citation"],
        "additionalProperties": False,
    }


SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "trouve": {"type": "boolean"},
        "dispositif": references.SCHEMA["properties"]["dispositif"],
        "commune": _champ({"type": ["string", "null"]}),
        **{
            k: _champ({"type": ["integer", "null"]})
            for k in ("n_interieur", "n_exterieur", "n_voie_publique", "n_total", "n_cameras_drone")
        },
        "dates": _champ({"type": "array", "items": {"type": "string"}}),
        "horaires": _champ({"type": "array", "items": {"type": "string"}}),
        "perimetre": _champ({"type": ["string", "null"]}),
    },
    "required": ["trouve", "dispositif", *CHAMPS],
    "additionalProperties": False,
}


def empreinte() -> str:
    """The instruction's and schema's fingerprint: a change reads every act again."""
    raw = CONSIGNE + ARBITRER + json.dumps(SCHEMA, sort_keys=True)
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


# --- the deterministic check ------------------------------------------------------------------
def _ws(s: str) -> str:
    s = s.replace("’", "'").replace(" ", " ")
    return re.sub(r"\s+", " ", s).strip()


def _plain(s: str) -> str:
    s = unicodedata.normalize("NFKD", s)
    return "".join(c for c in s if not unicodedata.combining(c)).lower()


def _numbers(s: str) -> list[int]:
    t = _plain(s)
    out = [int(x) for x in re.findall(r"(?<![\d/.-])\d{1,4}(?![\d/])", t)]
    out += [n for w, n in parse_raa.WORDS.items() if re.search(rf"\b{w}\b", t)]
    return out


def _in_text(citation: str | None, text: str) -> bool:
    return bool(citation) and _ws(citation) in _ws(text)


def controler(
    lu: dict[str, Any], text: str, communes: parse_raa.Communes, when: dt.date
) -> dict[str, Any]:
    """Each field kept only when its passage proves it; {field: value or None}, and the
    commune's INSEE code."""
    out: dict[str, Any] = {k: None for k in CHAMPS}
    for k in CHAMPS:
        f = lu.get(k) or {}
        v, c = f.get("valeur"), f.get("citation")
        if v in (None, [], "") or not _in_text(c, text):
            continue
        if k.startswith("n_"):
            nums = _numbers(c)
            if v in nums or (len(nums) > 1 and sum(nums) == v):
                out[k] = v
        elif k == "dates":
            try:
                days = sorted(dt.date.fromisoformat(d) for d in v)
            except ValueError:
                continue
            near = all(abs((d - when).days) <= 400 for d in days)
            shown = all(str(d.day) in re.findall(r"\d{1,2}", c) for d in days[:1] + days[-1:])
            if near and shown:
                out[k] = [d.isoformat() for d in days]
        elif k == "horaires":
            ok = []
            for h in v:
                m = re.fullmatch(r"(\d{2})h(\d{2})-(?:(\d{2})h(\d{2})|fin)", h)
                if (
                    m
                    and int(m.group(1)) < 25
                    and int(m.group(2)) < 60
                    and (m.group(3) is None or (int(m.group(3)) < 25 and int(m.group(4)) < 60))
                    and str(int(m.group(1))) in re.findall(r"\d{1,2}", c)
                ):
                    ok.append(h)
            out[k] = ok or None
        elif k == "commune":
            hit = communes.first(str(v))
            if hit and parse_raa.loose(hit[0]) == parse_raa.loose(str(v)):
                out[k] = hit[0]
                out["insee"] = hit[1]
        elif k == "perimetre" and _plain(str(v)) in _plain(c):
            out[k] = str(v)
    return out


# --- agreement with the rules ------------------------------------------------------------------
def regles(a: dict[str, Any]) -> dict[str, Any]:
    """The rules' value of each field, from parse_raa's act."""
    f = a.get("champs") or {}
    return {
        "commune": a.get("commune"),
        "insee": a.get("insee"),
        **{
            k: f.get(k)
            for k in ("n_interieur", "n_exterieur", "n_voie_publique", "n_total", "n_cameras_drone")
        },
        "dates": f.get("dates") or None,
        "horaires": f.get("horaires") or None,
        "perimetre": None,
    }


def _same(k: str, a: Any, b: Any) -> bool:
    if k == "commune":
        return parse_raa.loose(str(a)) == parse_raa.loose(str(b))
    if k == "dates":
        return sorted(a)[:1] + sorted(a)[-1:] == sorted(b)[:1] + sorted(b)[-1:]
    if k == "horaires":
        return sorted(a) == sorted(b)
    return a == b


def accorder(r: dict[str, Any], m: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    """{field: (value, origin)} and the fields in disagreement (for the arbitration)."""
    out: dict[str, Any] = {}
    disputed = []
    for k in CHAMPS:
        rv, mv = r.get(k), m.get(k)
        if rv is None and mv is None:
            continue
        if rv is not None and mv is not None:
            if _same(k, rv, mv):
                out[k] = (mv, "accord")
            else:
                disputed.append(k)
        elif mv is not None:
            out[k] = (mv, "modele")
        else:
            out[k] = (rv, "regles")
    return out, disputed


# --- the batches, on the server ------------------------------------------------------------------
def client() -> Any:
    import os

    import anthropic

    key = os.environ.get(KEY_ENV, "").strip()
    if not key:
        raise RuntimeError(f"{KEY_ENV} vide : la lecture par le modèle attend sa clé")
    return anthropic.Anthropic(api_key=key)


def requete(i: int, act: dict[str, Any], model: str, extra: str = "") -> Any:
    from anthropic.types.message_create_params import MessageCreateParamsNonStreaming
    from anthropic.types.messages.batch_create_params import Request

    user = (
        f"Recueil : {act['recueil_nom']} (publié le {act['date']}).\n"
        f"Acte à lire : n° {act['acte']}.\n\n<extrait>\n{act['texte']}\n</extrait>{extra}"
    )
    return Request(
        custom_id=f"a{i}",
        params=MessageCreateParamsNonStreaming(
            model=model,
            max_tokens=16000,
            system=[{"type": "text", "text": CONSIGNE, "cache_control": {"type": "ephemeral"}}],
            messages=[{"role": "user", "content": user}],
            output_config={"effort": "medium", "format": {"type": "json_schema", "schema": SCHEMA}},
        ),
    )


def _texte(ctx: Any, a: dict[str, Any]) -> dict[str, Any] | None:
    from lacarte_collecte import textes
    from lacarte_collecte.cache import Cache

    d = Cache(ctx.root).get(a["recueil"])
    if not d:
        return None
    number = a["acte"].rsplit(":", 1)[-1]
    w = textes.fenetre(d["content"], number)
    return (
        {
            "id": a["id"],
            "acte": number,
            "recueil_nom": a["recueil_nom"],
            "date": a["recueil_date"],
            "texte": w,
        }
        if w
        else None
    )


def _communes(ctx: Any, admin: str) -> parse_raa.Communes:
    from lacarte_collecte import arretes

    conf = arretes.administrations(ctx)[admin]
    deps = set(conf.get("communes") or ([conf["code"]] if conf["genre"] != "region" else []))
    path = ctx.root / "communes.json"
    return parse_raa.Communes.load(path, deps) if path.is_file() else parse_raa.Communes({}, set())


def a_lire(ctx: Any, admin: str | None = None, actes: set[str] | None = None) -> list[dict]:
    """The surveillance acts without a reading by the current instruction and rules."""
    from lacarte_collecte.etat import Store

    done = {r["id"]: r for r in Store(ctx.root, "champs").records()}
    fp = empreinte()
    out = []
    for a in Store(ctx.root, "actes").records():
        if admin and a["administration"] != admin or actes and a["id"] not in actes:
            continue
        r = done.get(a["id"])
        if r and r.get("empreinte") == fp and r.get("lecteur") == a.get("lecteur"):
            continue
        out.append(a)
    return out


def depense(ctx: Any) -> float:
    """Dollars spent on the API so far (every batch's usage, journaled), at the batch's price."""
    import yaml

    from lacarte_collecte.etat import Store

    prix = yaml.safe_load((ctx.rules_dir / "collecte_seuils.yaml").read_text("utf-8"))
    rows = list(Store(ctx.root, "couts").records())
    return float(references.cout(rows, prix["references"]["prix"])["dollars"])


def budget(ctx: Any) -> float:
    import yaml

    conf = yaml.safe_load((ctx.rules_dir / "collecte_seuils.yaml").read_text("utf-8"))
    return float(conf["references"].get("budget_dollars", 0))


def envoyer(
    ctx: Any,
    acts: list[dict[str, Any]],
    phase: str = "lecture",
    premieres: dict[str, Any] | None = None,
    model: str = LECTEUR,
) -> str | None:
    from lacarte_collecte.etat import Etat

    if phase == "lecture" and depense(ctx) >= budget(ctx):
        return None  # the budget Ju set is spent: no new reading, ask him
    rows = [t for a in acts if (t := _texte(ctx, a))]
    reqs = []
    for i, t in enumerate(rows):
        extra = ""
        if phase == "relecture":
            extra = "\n\n" + references.RELIRE.format(
                lecture=json.dumps(premieres[t["id"]], ensure_ascii=False)
            )
        elif phase == "arbitrage":
            extra = "\n\n" + ARBITRER.format(
                deux=json.dumps(premieres[t["id"]], ensure_ascii=False)
            )
        reqs.append(requete(i, t, model, extra))
    if not reqs:
        return None
    bid = str(client().messages.batches.create(requests=reqs).id)
    st = Etat(ctx.root, "modele")
    lots = st.get().get("lots") or []
    lots.append(
        {
            "lot": bid,
            "phase": phase,
            "modele": model,
            "actes": [t["id"] for t in rows],
            "empreinte": empreinte(),
            "le": dt.datetime.now(dt.UTC).isoformat(),
        }
    )
    st.save(lots=lots)
    return bid


def _resultats(c: Any, lot: dict[str, Any]) -> dict[str, Any]:
    out = {}
    for r in c.messages.batches.results(lot["lot"]):
        aid = lot["actes"][int(r.custom_id[1:])]
        if r.result.type != "succeeded":
            continue
        msg = r.result.message
        text = next((x.text for x in msg.content if x.type == "text"), "")
        u = msg.usage
        out[aid] = {
            "lecture": json.loads(text) if text and msg.stop_reason == "end_turn" else None,
            "modele": msg.model,
            "usage": {
                "input": u.input_tokens,
                "output": u.output_tokens,
                "cache_write": u.cache_creation_input_tokens or 0,
                "cache_read": u.cache_read_input_tokens or 0,
            },
        }
    return out


def suivre(ctx: Any) -> dict[str, Any]:
    """Every batch in flight: an ended one moves its acts to the next phase; the readings
    checked and agreed are kept field by field (Store « champs »); the cost journaled."""
    from lacarte_collecte.etat import Etat, Store

    st = Etat(ctx.root, "modele")
    lots = st.get().get("lots") or []
    if not lots:
        return {"lots": 0}
    c = client()
    acts = {a["id"]: a for a in Store(ctx.root, "actes").records()}
    keep, done = [], {"lecture": 0, "relecture": 0, "arbitrage": 0}
    for lot in lots:
        if c.messages.batches.retrieve(lot["lot"]).processing_status != "ended":
            keep.append(lot)
            continue
        res = _resultats(c, lot)
        Store(ctx.root, "couts").add(
            {
                "id": f"{lot['lot']}:{k}",
                "phase": lot["phase"],
                "modele": lot["modele"],
                "usage": v["usage"],
            }
            for k, v in res.items()
        )
        done[lot["phase"]] += len(res)
        todo = [acts[k] for k in res if k in acts]
        if lot["phase"] == "lecture":
            envoyer(ctx, todo, "relecture", {k: v["lecture"] for k, v in res.items()})
        elif lot["phase"] == "relecture":
            disputes: dict[str, Any] = {}
            for a in todo:
                lu = res[a["id"]]["lecture"] or {}
                text = (_texte(ctx, a) or {}).get("texte") or ""
                m = controler(
                    lu,
                    text,
                    _communes(ctx, a["administration"]),
                    dt.date.fromisoformat(a["recueil_date"]),
                )
                r = regles(a)
                fields, disputed = accorder(r, m)
                _garder(ctx, a, fields, m, res[a["id"]]["modele"])
                if disputed:
                    disputes[a["id"]] = {
                        "regles": {k: r[k] for k in disputed},
                        "modele": {k: m[k] for k in disputed},
                    }
            if disputes:
                envoyer(ctx, [acts[k] for k in disputes], "arbitrage", disputes, ARBITRE)
        else:  # arbitrage: Opus's answer, checked, for the disputed fields only
            for a in todo:
                lu = res[a["id"]]["lecture"] or {}
                text = (_texte(ctx, a) or {}).get("texte") or ""
                m = controler(
                    lu,
                    text,
                    _communes(ctx, a["administration"]),
                    dt.date.fromisoformat(a["recueil_date"]),
                )
                old = {r["id"]: r for r in Store(ctx.root, "champs").records()}.get(a["id"]) or {}
                fields = {
                    k: (v["valeur"], v["origine"]) for k, v in (old.get("champs") or {}).items()
                }
                for k in old.get("disputes") or []:
                    if m.get(k) is not None:
                        fields[k] = (m[k], "arbitrage")
                _garder(ctx, a, fields, m, old.get("modele"), arbitre=res[a["id"]]["modele"])
    # the batches this call sent (relecture, arbitrage) were appended meanwhile: keep them,
    # remove only the ones processed here
    processed = {lot["lot"] for lot in lots} - {lot["lot"] for lot in keep}
    current = [x for x in st.get().get("lots") or [] if x["lot"] not in processed]
    st.save(lots=current)
    return {"lots_en_cours": len(current), **done}


def _garder(
    ctx: Any,
    a: dict[str, Any],
    fields: dict[str, Any],
    m: dict[str, Any],
    modele: str | None,
    arbitre: str | None = None,
) -> None:
    from lacarte_collecte.etat import Store

    r = regles(a)
    disputed = [
        k for k in CHAMPS if k not in fields and r.get(k) is not None and m.get(k) is not None
    ]
    insee = (
        m.get("insee")
        if "commune" in fields and fields["commune"][1] != "regles"
        else r.get("insee")
    )
    Store(ctx.root, "champs").add(
        [
            {
                "id": a["id"],
                "lecteur": a.get("lecteur"),
                "empreinte": empreinte(),
                "modele": modele,
                "arbitre": arbitre,
                "insee": insee if "commune" in fields else None,
                "champs": {k: {"valeur": v, "origine": o} for k, (v, o) in fields.items()},
                "disputes": disputed,
            }
        ]
    )


# --- synchronous: the calibration and the reference readings -------------------------------------
def _lot(
    c: Any,
    rows: list[dict[str, Any]],
    model: str,
    extras: dict[str, str] | None = None,
    wait_s: float = 30,
) -> dict[str, Any]:
    """One batch for `rows` (each with its text), waited for: {id: result}."""
    import time

    reqs = [requete(i, t, model, (extras or {}).get(t["id"], "")) for i, t in enumerate(rows)]
    bid = str(c.messages.batches.create(requests=reqs).id)
    while c.messages.batches.retrieve(bid).processing_status != "ended":
        time.sleep(wait_s)
    return _resultats(c, {"lot": bid, "actes": [t["id"] for t in rows]}) | {"_lot": bid}


def traiter(
    ctx: Any,
    acts: list[dict[str, Any]],
    com: dict[str, parse_raa.Communes],
    texts: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    """Read, reread, check, agree, arbitrate, waiting for each batch: {id: fields}, the cost."""
    c = client()
    rows = [texts[a["id"]] for a in acts if a["id"] in texts]
    first = _lot(c, rows, LECTEUR)
    second = _lot(
        c,
        rows,
        LECTEUR,
        {
            i: "\n\n"
            + references.RELIRE.format(lecture=json.dumps(v["lecture"], ensure_ascii=False))
            for i, v in first.items()
            if i != "_lot"
        },
    )
    out, disputes = {}, {}
    for a in acts:
        if a["id"] not in second:
            continue
        t = texts[a["id"]]["texte"]
        m = controler(
            second[a["id"]]["lecture"] or {},
            t,
            com[a["id"]],
            dt.date.fromisoformat(a["recueil_date"]),
        )
        fields, disputed = accorder(regles(a), m)
        out[a["id"]] = {"champs": fields, "m": m}
        if disputed:
            disputes[a["id"]] = {
                "regles": {k: regles(a)[k] for k in disputed},
                "modele": {k: m[k] for k in disputed},
            }
    third: dict[str, Any] = {}
    if disputes:
        third = _lot(
            c,
            [texts[i] for i in disputes],
            ARBITRE,
            {
                i: "\n\n" + ARBITRER.format(deux=json.dumps(v, ensure_ascii=False))
                for i, v in disputes.items()
            },
        )
        for i, v in disputes.items():
            a = next(x for x in acts if x["id"] == i)
            m = controler(
                (third.get(i) or {}).get("lecture") or {},
                texts[i]["texte"],
                com[i],
                dt.date.fromisoformat(a["recueil_date"]),
            )
            for k in v["regles"]:
                if m.get(k) is not None:
                    out[i]["champs"][k] = (m[k], "arbitrage")
    usage = [
        {"modele": x["modele"], "usage": x["usage"]}
        for lot in (first, second, third)
        for k, x in lot.items()
        if k != "_lot"
    ]
    return {
        "actes": out,
        "usage": usage,
        "disputes": len(disputes),
        "lots": [x["_lot"] for x in (first, second, third) if x],
    }


def calibrer(ctx: Any, data: dict[str, Any]) -> dict[str, Any]:
    """The calibration acts (stdin: actes, verite), read by the whole chain on the server, their
    final fields compared with the references on the commune, the numbers, the dates and the
    hours; their recueils' texts asked through the collection's own queue when not cached."""
    import yaml

    from lacarte_collecte import arretes, textes
    from lacarte_collecte.cache import Cache

    kinds = parse_raa.types(ctx.rules_dir / "collecte_actes.yaml")
    f = ctx.fetcher("attrap")
    api = f.conf["sources"]["attrap"]["api"]
    acts, texts, com = [], {}, {}
    for a in data["actes"]:
        d = Cache(ctx.root).get(a["recueil"])
        if d is None:
            d = f.get_json(f"{api}raa/{a['recueil']}", cache=False)
            d = {**d, "id": a["recueil"], "administration": a["administration"]}
            Cache(ctx.root).put(d, d.get("content") or "")
        c = _communes(ctx, a["administration"])
        number = a["acte"].rsplit(":", 1)[-1]
        read = [
            x
            for x in parse_raa.lire(d["content"], c, kinds, dt.date.fromisoformat(d["date"]))
            if x.acte == number
        ]
        act = {
            **(read[0].as_dict() if read else {"champs": {}}),
            "id": a["id"],
            "recueil_date": d["date"],
            "administration": a["administration"],
        }
        acts.append(act)
        com[a["id"]] = c
        texts[a["id"]] = {
            "id": a["id"],
            "acte": number,
            "recueil_nom": parse_raa.mask(d["name"]),
            "date": d["date"],
            "texte": textes.fenetre(d["content"], number),
        }
    res = traiter(ctx, acts, com, texts)
    from lacarte_collecte.etat import Store

    Store(ctx.root, "couts").add(
        {"id": f"calibration:{i}", "phase": "calibration", **u} for i, u in enumerate(res["usage"])
    )
    refs = {r["acte"]: r for r in data["verite"]}
    per = {}
    for a in acts:
        got = {k: v[0] for k, v in (res["actes"].get(a["id"], {}).get("champs") or {}).items()}
        days = got.get("dates") or []
        col = {
            **got,
            "dates": " au ".join(dict.fromkeys([days[0], days[-1]])) if days else "",
            "horaires": " ; ".join(got.get("horaires") or []),
        }
        ref = refs.get(a["id"].rsplit(":", 1)[-1]) or refs.get(a["id"])
        if ref:
            per[a["id"]] = references.comparer(col, ref)
    prix = yaml.safe_load((ctx.rules_dir / "collecte_seuils.yaml").read_text("utf-8"))
    fields = ("commune", "nombres", "dates", "horaires")
    origins: dict[str, int] = {}
    for v in res["actes"].values():
        for _k, (_val, o) in v["champs"].items():
            origins[o] = origins.get(o, 0) + 1
    _ = arretes  # (the administrations' rules, through _communes)
    return {
        "tout_juste": f"{sum(all(v.values()) for v in per.values())}/{len(per)}",
        "justes": {
            f: f"{sum(v[f] for v in per.values() if f in v)}/"
            f"{sum(1 for v in per.values() if f in v)}"
            for f in fields
        },
        "ecarts": {
            k: [x for x, ok in v.items() if not ok] for k, v in per.items() if not all(v.values())
        },
        "origines": origins,
        "desaccords": res["disputes"],
        "lots": res["lots"],
        "cout": references.cout(res["usage"], prix["references"]["prix"]),
    }


# --- the threshold, field by field: blind references by Opus on a new draw ----------------------
MESURES = ("commune", "nombre", "dates", "horaires", "perimetre")


def references_lot(
    ctx: Any, deps_types: list[tuple[str, str]], graine: int, exclure: set[str], n: int = 30
) -> dict[str, Any]:
    """Opus reads blind (neither the rules nor the reading model shown) `n` acts drawn per
    département and kind with `graine`, never an act in `exclure` (those that tuned the reader
    or the instruction); the readings, checked, kept as references (Store « references »)."""
    from lacarte_collecte import seuil
    from lacarte_collecte.etat import Store

    acts = [a for a in Store(ctx.root, "actes").records() if a["id"] not in exclure]
    picks = []
    for dep, kind in deps_types:
        picks += [p["acte"] for p in seuil.tirer(acts, dep, kind, n, seed=graine)]
    by = {a["id"]: a for a in acts}
    rows = {i: t for i in picks if (t := _texte(ctx, by[i]))}
    res = _lot(client(), list(rows.values()), ARBITRE)
    keep = []
    for i, r in res.items():
        if i == "_lot":
            continue
        a = by[i]
        m = controler(
            r.get("lecture") or {},
            rows[i]["texte"],
            _communes(ctx, a["administration"]),
            dt.date.fromisoformat(a["recueil_date"]),
        )
        keep.append(
            {
                "id": i,
                "departement": a["departement"],
                "type": a["type"],
                "graine": graine,
                "reference": m,
                "modele": r["modele"],
            }
        )
        Store(ctx.root, "couts").add(
            [
                {
                    "id": f"{res['_lot']}:{i}",
                    "phase": "reference",
                    "modele": r["modele"],
                    "usage": r["usage"],
                }
            ]
        )
    Store(ctx.root, "references").add(keep)
    return {"references": len(keep), "lot": res["_lot"]}


def _juste(k: str, got: Any, ref: Any) -> tuple[bool, bool]:
    """(right, a wrong number) for one field."""
    if got in (None, [], "") and ref in (None, [], ""):
        return True, False
    if got in (None, [], ""):
        return False, False  # absent: not right, not wrong either
    if ref in (None, [], ""):
        return False, k.startswith("n_")
    if k.startswith("n_"):
        return got == ref, got != ref
    if k == "dates":
        return _same(k, got, ref), False
    if k in ("commune", "perimetre"):
        return parse_raa.loose(str(got)) == parse_raa.loose(str(ref)), False
    return sorted(got) == sorted(ref), False


def mesurer(ctx: Any) -> dict[str, Any]:
    """Per département, kind and field: the final readings against the references; a field is
    published at its kind's rate with no wrong number (rules/collecte_seuils.yaml)."""
    import yaml

    from lacarte_collecte.etat import Store

    conf = yaml.safe_load((ctx.rules_dir / "collecte_seuils.yaml").read_text("utf-8"))
    final = {r["id"]: r for r in Store(ctx.root, "champs").records()}
    tally: dict[str, dict[str, list[int]]] = {}
    for ref in Store(ctx.root, "references").records():
        got = {
            k: v["valeur"] for k, v in ((final.get(ref["id"]) or {}).get("champs") or {}).items()
        }
        key = f"{ref['departement']}-{ref['type']}"
        counts = (
            ("n_total", "n_interieur", "n_exterieur", "n_voie_publique")
            if ref["type"] != "drone"
            else ("n_cameras_drone",)
        )
        groups = {
            "commune": ("commune",),
            "nombre": counts,
            "dates": ("dates",),
            "horaires": ("horaires",),
            "perimetre": ("perimetre",),
        }
        if ref["type"] != "drone":
            groups = {g: v for g, v in groups.items() if g in ("commune", "nombre")}
        for g, ks in groups.items():
            res = [_juste(k, got.get(k), ref["reference"].get(k)) for k in ks]
            t = tally.setdefault(key, {}).setdefault(g, [0, 0, 0])
            t[0] += all(r for r, _ in res)
            t[1] += 1
            t[2] += any(w for _, w in res)
    out = {}
    for key, gs in tally.items():
        kind = key.split("-", 1)[1]
        need = float(conf["types"].get(kind, {}).get("taux", 1.0))
        out[key] = {
            g: {
                "justes": a,
                "mesures": b,
                "taux": round(a / b, 3) if b else 0.0,
                "nombres_faux": w,
                "publie": bool(b) and a / b >= need and w == 0,
            }
            for g, (a, b, w) in gs.items()
        }
    return out
