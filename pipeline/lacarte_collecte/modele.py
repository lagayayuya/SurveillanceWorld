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

from lacarte_collecte import nouveaux, parse_raa, references

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
    """The first fields' instruction and schema's fingerprint: a change reads every act again.
    The complementary fields have theirs (nouveaux.empreinte): the two are read apart."""
    raw = CONSIGNE + ARBITRER + json.dumps(SCHEMA, sort_keys=True)
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


# the first fields Opus arbitrates (lot R4.2): a disagreement on any other leaves it empty
ARBITRES = ("commune", "n_interieur", "n_exterieur", "n_voie_publique", "n_total",
            "n_cameras_drone", "dates", "horaires")  # fmt: skip


def consigne_complete(conf: dict[str, Any]) -> str:
    """An act never read: the first fields and the complementary ones in one request."""
    return CONSIGNE + "\n\n" + nouveaux.consigne(conf)


def schema_complet(conf: dict[str, Any]) -> dict[str, Any]:
    return {
        **SCHEMA,
        "properties": {**SCHEMA["properties"], **nouveaux.proprietes(conf)},
        "required": [*SCHEMA["required"], *nouveaux.proprietes(conf)],
    }


def sans_citation(lu: dict[str, Any], text: str) -> list[str]:
    """The first fields given a value whose passage is missing or not in the text: the reading
    is reread for them (lot R4.2)."""
    return [
        k
        for k in CHAMPS
        if ((lu.get(k) or {}).get("valeur") not in (None, [], ""))
        and not _in_text((lu.get(k) or {}).get("citation"), text)
    ]


def _phase(conf: dict[str, Any], phase: str) -> tuple[str, dict[str, Any]]:
    """The instruction and the schema of a phase."""
    if phase == "complement":
        return nouveaux.consigne_seule(conf), nouveaux.schema_seul(conf)
    # the first fields and the complementary ones cannot share a request: the API refuses the
    # whole schema, « the compiled grammar is too large » (2026-11-04); an act never read gets
    # both requests in the same sending (envoyer), on the same lighter window
    return CONSIGNE, SCHEMA


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
            # « 09/07 » shows the 9th: the passage's numbers compared as numbers
            nums = {int(x) for x in re.findall(r"\d{1,2}", c)}
            shown = all(d.day in nums for d in days[:1] + days[-1:])
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
                    # « 09h00 » shows 9 h (before 2026-11-04 compared as text, every hour
                    # before 10 h was dropped)
                    and int(m.group(1)) in {int(x) for x in re.findall(r"\d{1,2}", c)}
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


def requete(
    i: int,
    act: dict[str, Any],
    model: str,
    extra: str = "",
    system: str = CONSIGNE,
    schema: dict[str, Any] | None = None,
) -> Any:
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
            system=[{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
            messages=[{"role": "user", "content": user}],
            output_config={
                "effort": "medium",
                "format": {"type": "json_schema", "schema": schema or SCHEMA},
            },
        ),
    )


def _texte(ctx: Any, a: dict[str, Any], leger: bool = True) -> dict[str, Any] | None:
    from lacarte_collecte import textes
    from lacarte_collecte.cache import Cache

    d = Cache(ctx.root).get(a["recueil"])
    if not d:
        return None
    number = a["acte"].rsplit(":", 1)[-1]
    w = textes.fenetre(d["content"], number, marge=textes.MARGE_LEGERE if leger else textes.MARGE)
    # the « Vu » of form, the appeal, the signature: out (`leger`; a reading made before
    # 2026-11-04 is checked again on the whole window it was made on)
    w = textes.alleger(w) if w and leger else w
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


def a_completer(
    ctx: Any, admin: str | None = None, types: tuple[str, ...] | None = None
) -> list[dict]:
    """The acts read already by the current instruction whose complementary fields are not
    (lot R4.2, step 2): asked alone, on the lighter window."""
    from lacarte_collecte.etat import Store

    fp, fp2 = empreinte(), nouveaux.empreinte(nouveaux.regles(ctx.rules_dir))
    done = {r["id"]: r for r in Store(ctx.root, "champs").records()}
    out = []
    for a in Store(ctx.root, "actes").records():
        if admin and a["administration"] != admin or types and a["type"] not in types:
            continue
        r = done.get(a["id"])
        if r and r.get("empreinte") == fp and r.get("empreinte_nouveaux") != fp2:
            out.append(a)
    return out


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


def envoi_automatique(ctx: Any) -> bool:
    """Whether a run sends the acts not yet read at its end (rules/collecte_seuils.yaml,
    `references.envoi_automatique`): off while a new instruction is calibrated."""
    import yaml

    conf = yaml.safe_load((ctx.rules_dir / "collecte_seuils.yaml").read_text("utf-8"))
    return bool(conf["references"].get("envoi_automatique", True))


def envoyer(
    ctx: Any,
    acts: list[dict[str, Any]],
    phase: str = "lecture",
    premieres: dict[str, Any] | None = None,
    model: str = LECTEUR,
) -> str | None:
    from lacarte_collecte.etat import Etat

    if phase in ("lecture", "complement") and depense(ctx) >= budget(ctx):
        return None  # the budget Ju set is spent: no new reading, ask him
    rows = [t for a in acts if (t := _texte(ctx, a))]
    system, schema = _phase(nouveaux.regles(ctx.rules_dir), phase)
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
        reqs.append(requete(i, t, model, extra, system, schema))
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
            "empreinte_nouveaux": nouveaux.empreinte(nouveaux.regles(ctx.rules_dir)),
            "le": dt.datetime.now(dt.UTC).isoformat(),
        }
    )
    st.save(lots=lots)
    if phase == "lecture":
        envoyer(ctx, acts, "complement")
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


def _verifier(ctx: Any, a: dict[str, Any], lu: dict[str, Any]) -> tuple[dict, dict, str]:
    """A reading checked: the first fields, the complementary ones, and the text."""
    text = (_texte(ctx, a) or {}).get("texte") or ""
    com = _communes(ctx, a["administration"])
    when = dt.date.fromisoformat(a["recueil_date"])
    conf = nouveaux.regles(ctx.rules_dir)
    return (
        controler(lu, text, com, when),
        nouveaux.controler(lu, text, com, when, conf, a["type"]),
        text,
    )


def premiere_lecture(
    a: dict[str, Any], lu: dict[str, Any], m: dict[str, Any], text: str
) -> tuple[dict[str, Any], list[str], bool]:
    """(fields, disputes, reread): the first reading agreed with the rules; it is reread only
    when they disagree or a field's passage is missing (lot R4.2)."""
    fields, disputed = accorder(regles(a), m)
    return fields, disputed, bool(disputed or sans_citation(lu, text))


def suivre(ctx: Any) -> dict[str, Any]:
    """Every batch in flight: an ended one moves its acts to the next phase; the readings
    checked and agreed are kept field by field (Store « champs »); the cost journaled.
    lecture → (relecture when the rules disagree or a passage is missing) → arbitrage of the
    first fields Opus arbitrates; complement: the complementary fields alone, kept as read."""
    from lacarte_collecte.etat import Etat, Store

    st = Etat(ctx.root, "modele")
    lots = st.get().get("lots") or []
    if not lots:
        return {"lots": 0}
    c = client()
    acts = {a["id"]: a for a in Store(ctx.root, "actes").records()}
    olds = {r["id"]: r for r in Store(ctx.root, "champs").records()}
    keep: list[dict[str, Any]] = []
    done = {"lecture": 0, "relecture": 0, "arbitrage": 0, "complement": 0}
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
        done[lot["phase"]] = done.get(lot["phase"], 0) + len(res)
        todo = [acts[k] for k in res if k in acts]
        if lot["phase"] in ("lecture", "relecture"):
            again, disputes = {}, {}
            for a in todo:
                lu = res[a["id"]]["lecture"] or {}
                m, nv, text = _verifier(ctx, a, lu)
                fields, disputed, reread = premiere_lecture(a, lu, m, text)
                if lot["phase"] == "lecture" and reread:
                    again[a["id"]] = lu
                    continue
                # the complementary fields come from their own request (complement)
                _garder(ctx, a, fields, m, res[a["id"]]["modele"], olds=olds)
                disputed = [k for k in disputed if k in ARBITRES]
                if disputed:
                    r = regles(a)
                    disputes[a["id"]] = {
                        "regles": {k: r[k] for k in disputed},
                        "modele": {k: m[k] for k in disputed},
                    }
            if again:
                envoyer(ctx, [acts[k] for k in again], "relecture", again)
            if disputes:
                envoyer(ctx, [acts[k] for k in disputes], "arbitrage", disputes, ARBITRE)
        elif lot["phase"] == "complement":
            for a in todo:
                _, nv, _t = _verifier(ctx, a, res[a["id"]]["lecture"] or {})
                old = olds.get(a["id"]) or {}
                fields = {
                    k: (v["valeur"], v["origine"]) for k, v in (old.get("champs") or {}).items()
                }
                _garder(ctx, a, fields, {}, old.get("modele"), old.get("arbitre"), olds, nv,
                        res[a["id"]]["modele"], keep_disputes=True)  # fmt: skip
        else:  # arbitrage: Opus's answer, checked, for the disputed fields only
            for a in todo:
                m, _nv, _t = _verifier(ctx, a, res[a["id"]]["lecture"] or {})
                old = olds.get(a["id"]) or {}
                fields = {
                    k: (v["valeur"], v["origine"]) for k, v in (old.get("champs") or {}).items()
                }
                for k in old.get("disputes") or []:
                    if k in ARBITRES and m.get(k) is not None:
                        fields[k] = (m[k], "arbitrage")
                _garder(ctx, a, fields, m, old.get("modele"), res[a["id"]]["modele"], olds)
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
    olds: dict[str, Any] | None = None,
    nouv: dict[str, Any] | None = None,
    modele_nouveaux: str | None = None,
    keep_disputes: bool = False,
) -> None:
    """One act's record: the first fields with their origins, and the complementary ones
    (`nouveaux`, the model's, checked); the part not given here is the record's before."""
    from lacarte_collecte.etat import Store

    old = (olds or {}).get(a["id"]) or {}
    r = regles(a)
    disputed = (
        old.get("disputes") or []
        if keep_disputes
        else [
            k for k in CHAMPS if k not in fields and r.get(k) is not None and m.get(k) is not None
        ]
    )
    if keep_disputes:
        insee = old.get("insee")
    else:
        insee = (
            m.get("insee")
            if "commune" in fields and fields["commune"][1] != "regles"
            else r.get("insee")
        )
        insee = insee if "commune" in fields else None
    rec = {
        "id": a["id"],
        "lecteur": a.get("lecteur"),
        "empreinte": empreinte() if not keep_disputes else old.get("empreinte"),
        "modele": modele,
        "arbitre": arbitre,
        "insee": insee,
        "champs": {k: {"valeur": v, "origine": o} for k, (v, o) in fields.items()},
        "disputes": disputed,
    }
    if nouv is not None:
        rec["nouveaux"] = {k: v for k, v in nouv.items() if v not in (None, [], "")}
        rec["empreinte_nouveaux"] = nouveaux.empreinte(nouveaux.regles(ctx.rules_dir))
        rec["modele_nouveaux"] = modele_nouveaux or modele
    else:
        for k in ("nouveaux", "empreinte_nouveaux", "modele_nouveaux"):
            if k in old:
                rec[k] = old[k]
    if "qui" in old and keep_disputes:
        rec["qui"] = old["qui"]
    Store(ctx.root, "champs").add([rec])
    if olds is not None:
        olds[a["id"]] = rec


# --- synchronous: the calibration and the reference readings -------------------------------------
def _lot(
    c: Any,
    rows: list[dict[str, Any]],
    model: str,
    extras: dict[str, str] | None = None,
    wait_s: float = 30,
    system: str = CONSIGNE,
    schema: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """One batch for `rows` (each with its text), waited for: {id: result}."""
    import time

    if not rows:
        return {}
    reqs = [
        requete(i, t, model, (extras or {}).get(t["id"], ""), system, schema)
        for i, t in enumerate(rows)
    ]
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
    """The chain of suivre, waiting for each batch: read (the first fields and the
    complementary ones), reread only when the rules disagree or a passage is missing, check,
    agree, arbitrate the fields Opus arbitrates: {id: fields}, the usage per phase."""
    c = client()
    conf = nouveaux.regles(ctx.rules_dir)
    seule = (nouveaux.consigne_seule(conf), nouveaux.schema_seul(conf))
    rows = [texts[a["id"]] for a in acts if a["id"] in texts]
    first = _lot(c, rows, LECTEUR)
    comp = _lot(c, rows, LECTEUR, system=seule[0], schema=seule[1])
    by = {a["id"]: a for a in acts}

    def check(i: str, lu: dict[str, Any]) -> tuple[dict, dict]:
        a = by[i]
        when = dt.date.fromisoformat(a["recueil_date"])
        t = texts[i]["texte"]
        return controler(lu, t, com[i], when), nouveaux.controler(
            lu, t, com[i], when, conf, a["type"]
        )

    again = {}
    for i, v in first.items():
        if i == "_lot":
            continue
        lu = v["lecture"] or {}
        m, _ = check(i, lu)
        if premiere_lecture(by[i], lu, m, texts[i]["texte"])[2]:
            again[i] = lu
    second = _lot(
        c,
        [texts[i] for i in again],
        LECTEUR,
        {
            i: "\n\n" + references.RELIRE.format(lecture=json.dumps(lu, ensure_ascii=False))
            for i, lu in again.items()
        },
    )
    out, disputes = {}, {}
    for a in acts:
        src = second if a["id"] in again else first
        if a["id"] not in src:
            continue
        m, _ = check(a["id"], src[a["id"]]["lecture"] or {})
        _, nv = check(a["id"], (comp.get(a["id"]) or {}).get("lecture") or {})
        fields, disputed = accorder(regles(a), m)
        out[a["id"]] = {"champs": fields, "m": m, "nouveaux": nv}
        disputed = [k for k in disputed if k in ARBITRES]
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
            m, _ = check(i, (third.get(i) or {}).get("lecture") or {})
            for k in v["regles"]:
                if m.get(k) is not None:
                    out[i]["champs"][k] = (m[k], "arbitrage")
    usage = [
        {"phase": ph, "modele": x["modele"], "usage": x["usage"]}
        for ph, lot in (
            ("lecture", first),
            ("complement", comp),
            ("relecture", second),
            ("arbitrage", third),
        )
        for k, x in lot.items()
        if k != "_lot"
    ]
    return {
        "actes": out,
        "usage": usage,
        "disputes": len(disputes),
        "relus": len(again),
        "lots": [x["_lot"] for x in (first, comp, second, third) if x],
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
            "texte": textes.alleger(
                textes.fenetre(d["content"], number, marge=textes.MARGE_LEGERE) or ""
            ),
        }
    res = traiter(ctx, acts, com, texts)
    from lacarte_collecte.etat import Store

    Store(ctx.root, "couts").add(
        {"id": f"calibration:{res['lots'][0]}:{i}", **u, "phase": f"calibration:{u['phase']}"}
        for i, u in enumerate(res["usage"])
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
        "relus": res["relus"],
        "lots": res["lots"],
        "cout": references.cout(res["usage"], prix["references"]["prix"]),
        "cout_par_phase": {
            ph: references.cout(
                [u for u in res["usage"] if u["phase"] == ph], prix["references"]["prix"]
            )
            for ph in ("lecture", "complement", "relecture", "arbitrage")
        },
        "nouveaux": {k: v["nouveaux"] for k, v in res["actes"].items()},
        "nouveaux_opus": _opus_nouveaux(ctx, acts, com, texts, set(data.get("opus") or []), res),
    }


def _pareil(k: str, a: Any, b: Any) -> bool:
    if a in (None, [], "") or b in (None, [], ""):
        return a in (None, [], "") and b in (None, [], "")
    if k == "lieux":
        return {parse_raa.loose(x["texte"]) for x in a} == {parse_raa.loose(x["texte"]) for x in b}
    if k in ("finalites", "communes"):
        return sorted(map(str, a)) == sorted(map(str, b))
    if k in ("motif_libelle", "service", "adresse"):
        x, y = parse_raa.loose(str(a)), parse_raa.loose(str(b))
        return x in y or y in x
    return a == b


def _opus_nouveaux(
    ctx: Any,
    acts: list[dict[str, Any]],
    com: dict[str, parse_raa.Communes],
    texts: dict[str, dict[str, Any]],
    ids: set[str],
    res: dict[str, Any],
) -> dict[str, Any]:
    """The complementary fields of `ids` read by Opus with the whole instruction, checked, and
    compared field by field with the chain's (lot R4.2's calibration: 15 acts, 10 of Paris)."""
    if not ids:
        return {}
    conf = nouveaux.regles(ctx.rules_dir)
    rows = [texts[a["id"]] for a in acts if a["id"] in ids and a["id"] in texts]
    got = _lot(
        client(),
        rows,
        ARBITRE,
        system=nouveaux.consigne_seule(conf),
        schema=nouveaux.schema_seul(conf),
    )
    from lacarte_collecte.etat import Store

    Store(ctx.root, "couts").add(
        {"id": f"calibration:{got.get('_lot')}:{i}", "phase": "calibration:reference",
         "modele": v["modele"], "usage": v["usage"]}
        for i, v in got.items() if i != "_lot"
    )  # fmt: skip
    by = {a["id"]: a for a in acts}
    per: dict[str, list[int]] = {}
    ecarts = []
    for i, v in got.items():
        if i == "_lot":
            continue
        a = by[i]
        ref = nouveaux.controler(
            v["lecture"] or {}, texts[i]["texte"], com[i],
            dt.date.fromisoformat(a["recueil_date"]), conf, a["type"],
        )  # fmt: skip
        mine = (res["actes"].get(i) or {}).get("nouveaux") or {}
        own = nouveaux.DRONE if a["type"] != "videoprotection" else nouveaux.VIDEO
        for k in own:
            if k == "petitionnaire":
                continue
            ok = _pareil(k, mine.get(k), ref.get(k))
            t = per.setdefault(k, [0, 0])
            t[0] += ok
            t[1] += 1
            if not ok:
                ecarts.append({"id": i, "champ": k, "chaine": mine.get(k), "opus": ref.get(k)})
    import yaml

    prix = yaml.safe_load((ctx.rules_dir / "collecte_seuils.yaml").read_text("utf-8"))
    return {
        "justes": {k: f"{a}/{b}" for k, (a, b) in per.items()},
        "ecarts": ecarts,
        "cout": references.cout(
            [{"modele": v["modele"], "usage": v["usage"]} for i, v in got.items() if i != "_lot"],
            prix["references"]["prix"],
        ),
    }


def schemas(ctx: Any) -> dict[str, Any]:
    """Each phase's schema submitted to the API's token counting (free): « ok » or the API's
    error, to find a schema the batches refuse."""
    conf = nouveaux.regles(ctx.rules_dir)
    c, out = client(), {}
    for ph in ("lecture", "complement", "arbitrage"):
        system, schema = _phase(conf, ph)
        try:
            c.messages.count_tokens(
                model=LECTEUR,
                system=system,
                messages=[
                    {"role": "user", "content": "Acte à lire : n° 1.\n\n<extrait>\n…\n</extrait>"}
                ],
                extra_body={"output_config": {"format": {"type": "json_schema", "schema": schema}}},
            )
            out[ph] = "ok"
        except Exception as e:  # noqa: BLE001 (the API's refusal, said as it is)
            out[ph] = f"{type(e).__name__}: {e}"[:800]
    return out


def essai(ctx: Any) -> dict[str, Any]:
    """One real request per phase on a few lines (Haiku, a fraction of a cent), synchronous:
    « ok » or the API's error. The token count does not compile a schema; this does."""
    conf = nouveaux.regles(ctx.rules_dir)
    c, out = client(), {}
    user = (
        "Acte à lire : n° 1.\n\n<extrait>\nArrêté n° 1. Article 1 : autorisé à Paris.\n</extrait>"
    )
    for ph in ("lecture", "complement", "arbitrage"):
        system, schema = _phase(conf, ph)
        try:
            msg = c.messages.create(
                model=LECTEUR,
                max_tokens=4000,
                system=system,
                messages=[{"role": "user", "content": user}],
                output_config={
                    "effort": "low",
                    "format": {"type": "json_schema", "schema": schema},
                },
            )
            u = msg.usage
            from lacarte_collecte.etat import Store

            Store(ctx.root, "couts").add(
                [{"id": f"essai:{msg.id}", "phase": "essai", "modele": msg.model,
                  "usage": {"input": u.input_tokens, "output": u.output_tokens,
                            "cache_write": u.cache_creation_input_tokens or 0,
                            "cache_read": u.cache_read_input_tokens or 0}}]
            )  # fmt: skip
            out[ph] = f"ok ({msg.stop_reason})"
        except Exception as e:  # noqa: BLE001 (the API's refusal, said as it is)
            out[ph] = f"{type(e).__name__}: {e}"[:600]
    return out


def erreurs(lot: str, n: int = 3) -> dict[str, Any]:
    """A batch's results by type, and its first errors as the API gives them (no new call)."""
    c, kinds, errs = client(), {}, []
    for r in c.messages.batches.results(lot):
        kinds[r.result.type] = kinds.get(r.result.type, 0) + 1
        if r.result.type != "succeeded" and len(errs) < n:
            errs.append(str(getattr(r.result, "error", r.result))[:800])
    return {"types": kinds, "erreurs": errs}


def couts(ctx: Any) -> dict[str, Any]:
    """The real cost per phase (the journaled usage at the batch's price): the requests, the
    dollars, the dollars per request."""
    import yaml

    from lacarte_collecte.etat import Store

    prix = yaml.safe_load((ctx.rules_dir / "collecte_seuils.yaml").read_text("utf-8"))
    by: dict[str, list[dict[str, Any]]] = {}
    for r in Store(ctx.root, "couts").records():
        by.setdefault(r.get("phase") or "?", []).append(r)
    out = {}
    for ph, rows in sorted(by.items()):
        d = float(references.cout(rows, prix["references"]["prix"])["dollars"])
        out[ph] = {
            "requetes": len(rows),
            "dollars": round(d, 4),
            "par_requete": round(d / len(rows), 5),
        }
    return out


def jetons(ctx: Any, n: int = 50, graine: int = 20261104) -> dict[str, Any]:
    """The input tokens of `n` cached acts, the old request (whole window, first fields) against
    the new ones (lighter window, every field; the complementary fields alone): counted by the
    API's token counting, which costs nothing."""
    import random

    from lacarte_collecte import textes
    from lacarte_collecte.cache import Cache
    from lacarte_collecte.etat import Store

    conf = nouveaux.regles(ctx.rules_dir)
    acts = [a for a in Store(ctx.root, "actes").records()]
    random.Random(graine).shuffle(acts)
    c, tot, k = client(), {"avant": 0, "apres": 0, "complement": 0}, 0
    for a in acts:
        if k >= n:
            break
        d = Cache(ctx.root).get(a["recueil"])
        number = a["acte"].rsplit(":", 1)[-1]
        w = textes.fenetre(d["content"], number) if d else None
        leger = textes.fenetre(d["content"], number, marge=textes.MARGE_LEGERE) if d else None
        if not w or not leger:
            continue
        k += 1
        for key, system, text in (
            ("avant", CONSIGNE, w),
            ("apres", CONSIGNE, textes.alleger(leger)),
            ("complement", nouveaux.consigne_seule(conf), textes.alleger(leger)),
        ):
            user = f"Acte à lire : n° {number}.\n\n<extrait>\n{text}\n</extrait>"
            r = c.messages.count_tokens(
                model=LECTEUR, system=system, messages=[{"role": "user", "content": user}]
            )
            tot[key] += r.input_tokens
    per = {f"{x}_par_acte": round(v / max(k, 1)) for x, v in tot.items()}
    # an act never read: the first fields' request and the complement's, on the same window
    per["nouvel_acte_par_acte"] = per["apres_par_acte"] + per["complement_par_acte"]
    return {"actes": k, **per}


# --- the threshold, field by field: blind references by Opus on a new draw ----------------------
MESURES = ("commune", "nombre", "dates", "horaires", "perimetre")


def references_lot(
    ctx: Any,
    deps_types: list[tuple[str, str]],
    graine: int,
    exclure: set[str],
    n: int = 30,
    seul_nouveaux: bool = False,
) -> dict[str, Any]:
    """Opus reads blind (neither the rules nor the reading model shown) `n` acts drawn per
    département and kind with `graine`, never an act in `exclure` (those that tuned the reader
    or the instruction); the readings, checked, kept as references (Store « references »)."""
    from lacarte_collecte import seuil
    from lacarte_collecte.etat import Store

    # a new draw: never an act already a reference either
    exclure = exclure | Store(ctx.root, "references").ids()
    acts = [a for a in Store(ctx.root, "actes").records() if a["id"] not in exclure]
    picks = []
    for dep, kind in deps_types:
        picks += [p["acte"] for p in seuil.tirer(acts, dep, kind, n, seed=graine)]
    by = {a["id"]: a for a in acts}
    rows = {i: t for i in picks if (t := _texte(ctx, by[i]))}
    conf = nouveaux.regles(ctx.rules_dir)
    c = client()
    # the complementary fields alone (lot R4.2, step 3): the first ones are measured already
    res = {} if seul_nouveaux else _lot(c, list(rows.values()), ARBITRE)
    comp = _lot(
        c,
        list(rows.values()),
        ARBITRE,
        system=nouveaux.consigne_seule(conf),
        schema=nouveaux.schema_seul(conf),
    )
    for i, r in comp.items():
        if i != "_lot":
            Store(ctx.root, "couts").add(
                [{"id": f"{comp['_lot']}:{i}", "phase": "reference", "modele": r["modele"],
                  "usage": r["usage"]}]
            )  # fmt: skip
    keep = []
    for i, r in (comp if seul_nouveaux else res).items():
        if i == "_lot":
            continue
        a = by[i]
        m = (
            {}
            if seul_nouveaux
            else controler(
                r.get("lecture") or {},
                rows[i]["texte"],
                _communes(ctx, a["administration"]),
                dt.date.fromisoformat(a["recueil_date"]),
            )
        )
        keep.append(
            {
                "id": i,
                "departement": a["departement"],
                "type": a["type"],
                "graine": graine,
                "reference": m,
                "reference_nouveaux": nouveaux.controler(
                    (comp.get(i) or {}).get("lecture") or {},
                    rows[i]["texte"],
                    _communes(ctx, a["administration"]),
                    dt.date.fromisoformat(a["recueil_date"]),
                    conf,
                    a["type"],
                ),
                "empreinte_nouveaux": nouveaux.empreinte(conf),
                "modele": r["modele"],
                **({"seulement_nouveaux": True} if seul_nouveaux else {}),
            }
        )
        if seul_nouveaux:
            continue  # its cost is journaled with the complement's above
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
    return {"references": len(keep), "lot": (res or comp).get("_lot")}


def couverture(slots: list[str]) -> frozenset[int] | None:
    """The minutes of a day the slots cover (« 18h00-03h00 » runs past midnight; « 23h59 » as
    an end is midnight; slots repeated or cut at midnight cover the same minutes), or None when
    one does not parse or ends « fin »."""
    out: set[int] = set()
    for h in slots:
        m = re.fullmatch(r"(\d{2})h(\d{2})-(\d{2})h(\d{2})", h)
        if not m:
            return None
        a = int(m.group(1)) % 24 * 60 + int(m.group(2))
        b = int(m.group(3)) * 60 + int(m.group(4))
        b = 1440 if b in (1439, 1440) or (b == 0 and a > 0) else b % 1440
        if b <= a:
            out |= set(range(a, 1440)) | set(range(0, b))
        else:
            out |= set(range(a, b))
    return frozenset(out)


def recontroler_references(ctx: Any) -> dict[str, Any]:
    """The reference readings checked again by the current check, from their batches' results
    as the API keeps them (29 days): no new call to a model. The references whose batch is no
    longer served stay as they were."""
    from lacarte_collecte.etat import Store

    lots = sorted(
        {r["id"].split(":", 1)[0] for r in Store(ctx.root, "couts").records()
         if r.get("phase") == "reference"}
    )  # fmt: skip
    acts = {a["id"]: a for a in Store(ctx.root, "actes").records()}
    refs = {r["id"]: r for r in Store(ctx.root, "references").records()}
    conf = nouveaux.regles(ctx.rules_dir)
    c, changed, seen, missing = client(), 0, 0, []
    for lot in lots:
        try:
            results = list(c.messages.batches.results(lot))
        except Exception:  # noqa: BLE001 (expired or unknown: kept as it was)
            missing.append(lot)
            continue
        # the act of each result: the one whose journaled usage is the result's, exactly (the
        # request's order is not kept)
        by_usage = {}
        for row in Store(ctx.root, "couts").records():
            if row["id"].startswith(lot + ":"):
                u = row["usage"]
                key = (u["input"], u["output"], u["cache_write"], u["cache_read"])
                by_usage.setdefault(key, []).append(row["id"].split(":", 1)[1])
        for r in results:
            if r.result.type != "succeeded":
                continue
            msg = r.result.message
            text = next((x.text for x in msg.content if x.type == "text"), "")
            if not text or msg.stop_reason != "end_turn":
                continue
            u = msg.usage
            key = (u.input_tokens, u.output_tokens, u.cache_creation_input_tokens or 0,
                   u.cache_read_input_tokens or 0)  # fmt: skip
            match = by_usage.get(key) or []
            if len(match) != 1 or match[0] not in refs:
                continue  # two acts of the same usage: left as they were
            i = match[0]
            lu = json.loads(text)
            a, t = acts.get(i), _texte(ctx, acts[i], leger=False) if i in acts else None
            if not a or not t:
                continue
            seen += 1
            when = dt.date.fromisoformat(a["recueil_date"])
            com = _communes(ctx, a["administration"])
            m = controler(lu, t["texte"], com, when)
            rec = {**refs[i], "reference": m, "recontrole": dt.date.today().isoformat()}
            if "reference_nouveaux" in refs[i]:
                rec["reference_nouveaux"] = nouveaux.controler(
                    lu, t["texte"], com, when, conf, a["type"]
                )
            if rec["reference"] != refs[i]["reference"]:
                changed += 1
            Store(ctx.root, "references").add([rec])
    return {"lots": len(lots), "relus": seen, "changes": changed, "lots_expires": missing}


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
    if k == "horaires":
        # the same minutes of the day written otherwise (a slot repeated, cut at midnight,
        # « 23h59 » for midnight): the same hours; anything else is a difference
        a, b = couverture(got), couverture(ref)
        if a is not None and b is not None:
            return a == b, False
    return sorted(got) == sorted(ref), False


def mesurer(ctx: Any, ecarts: str | None = None) -> Any:
    """Per département, kind and field: the final readings against the references; a field is
    published at its kind's rate with no wrong number (rules/collecte_seuils.yaml). With
    `ecarts` (« 75-drone:horaires »), the pairs that differ instead, to classify them."""
    import yaml

    from lacarte_collecte.etat import Store

    conf = yaml.safe_load((ctx.rules_dir / "collecte_seuils.yaml").read_text("utf-8"))
    final = {r["id"]: r for r in Store(ctx.root, "champs").records()}
    tally: dict[str, dict[str, list[int]]] = {}
    diffs: list[dict[str, Any]] = []
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
        if ref.get("seulement_nouveaux"):
            groups = {}  # its first fields were not read again: not measured on it
        if "reference_nouveaux" in ref:
            # the complementary fields, each its own group, against Opus's blind reading
            mine = (final.get(ref["id"]) or {}).get("nouveaux") or {}
            own = nouveaux.DRONE if ref["type"] != "videoprotection" else nouveaux.VIDEO
            for k in own:
                if k == "petitionnaire":
                    continue
                ok = _pareil(k, mine.get(k), ref["reference_nouveaux"].get(k))
                t = tally.setdefault(key, {}).setdefault(k, [0, 0, 0])
                t[0] += ok
                t[1] += 1
                if ecarts == f"{key}:{k}" and not ok:
                    diffs.append(
                        {
                            "id": ref["id"],
                            "lu": mine.get(k),
                            "reference": ref["reference_nouveaux"].get(k),
                        }
                    )
        for g, ks in groups.items():
            res = [_juste(k, got.get(k), ref["reference"].get(k)) for k in ks]
            if ecarts == f"{key}:{g}" and not all(r for r, _ in res):
                mine = (final.get(ref["id"]) or {}).get("champs") or {}
                diffs.append(
                    {
                        "id": ref["id"],
                        "lu": {k: got.get(k) for k in ks},
                        "origine": {k: (mine.get(k) or {}).get("origine") for k in ks},
                        "reference": {k: ref["reference"].get(k) for k in ks},
                    }
                )
            t = tally.setdefault(key, {}).setdefault(g, [0, 0, 0])
            t[0] += all(r for r, _ in res)
            t[1] += 1
            t[2] += any(w for _, w in res)
    if ecarts:
        return diffs
    # the sample due: 30 acts (rules), or every act of the kind when it has fewer; a smaller
    # sample (texts not yet cached, say) publishes nothing
    n_due = int(conf.get("echantillon", 30))
    avail: dict[str, int] = {}
    for a in Store(ctx.root, "actes").records():
        k = f"{a['departement']}-{a['type']}"
        avail[k] = avail.get(k, 0) + 1
    out = {}
    for key, gs in tally.items():
        kind = key.split("-", 1)[1]
        need = float(conf["types"].get(kind, {}).get("taux", 1.0))
        due = min(n_due, avail.get(key, 0))
        out[key] = {
            g: {
                "justes": a,
                "mesures": b,
                "taux": round(a / b, 3) if b else 0.0,
                "nombres_faux": w,
                "du": due,
                "publie": b >= due > 0 and a / b >= need and w == 0,
            }
            for g, (a, b, w) in gs.items()
        }
    return out


def statut(ctx: Any) -> dict[str, Any]:
    """Where the reading stands: the cache per administration, the acts read by the model,
    the batches in flight, the dollars spent and the budget."""
    from lacarte_collecte.cache import Cache
    from lacarte_collecte.etat import Etat, Store

    cached: dict[str, int] = {}
    for d in Cache(ctx.root).all():
        cached[d["administration"]] = cached.get(d["administration"], 0) + 1
    acts: dict[str, int] = {}
    for a in Store(ctx.root, "actes").records():
        acts[a["administration"]] = acts.get(a["administration"], 0) + 1
    read = {r["id"] for r in Store(ctx.root, "champs").records()}
    per_read: dict[str, int] = {}
    for a in Store(ctx.root, "actes").records():
        if a["id"] in read:
            per_read[a["administration"]] = per_read.get(a["administration"], 0) + 1
    return {
        "cache": Cache(ctx.root).taille(),
        "recueils_en_cache": cached,
        "actes": acts,
        "actes_lus_par_le_modele": per_read,
        "references": sum(1 for _ in Store(ctx.root, "references").records()),
        "lots_en_cours": len(Etat(ctx.root, "modele").get().get("lots") or []),
        "depense": depense(ctx),
        "budget": budget(ctx),
    }


# --- reading on the Mac once the API's budget is spent (DECISIONS 2026-11-04) ---
def exporter(ctx: Any, n: int, admin: str | None = None) -> list[dict[str, Any]]:
    """Up to `n` acts not yet read, with their text window, for a lot read on the Mac; each
    transfer journaled (Store « transferts »: the act, the day, never the text)."""
    from lacarte_collecte.etat import Store

    conf = nouveaux.regles(ctx.rules_dir)
    out = []
    for a in a_lire(ctx, admin):
        t = _texte(ctx, a)
        if t:
            out.append(
                {
                    **t,
                    "type": a["type"],
                    "consigne": consigne_complete(conf),
                    "schema": schema_complet(conf),
                }
            )
        if len(out) >= n:
            break
    Store(ctx.root, "transferts").add(
        {
            "id": f"{x['id']}:{dt.date.today()}",
            "acte": x["id"],
            "le": dt.datetime.now(dt.UTC).isoformat(),
        }
        for x in out
    )
    return out


def importer(ctx: Any, rows: list[dict[str, Any]], qui: str = "local") -> dict[str, Any]:
    """Readings made on the Mac ({id, lecture}: the schema's answer), checked and agreed with
    the rules exactly as the API's; a disagreement keeps the rules' value out (no arbitrator
    here): the field stays empty."""
    from lacarte_collecte.etat import Store

    acts = {a["id"]: a for a in Store(ctx.root, "actes").records()}
    kept = 0
    for r in rows:
        a = acts.get(r["id"])
        t = _texte(ctx, a) if a else None
        if not a or not t:
            continue
        m, nv, _text = _verifier(ctx, a, r.get("lecture") or {})
        fields, _disputed = accorder(regles(a), m)
        # the model that read it on the Mac, said by the reader (« local:claude-opus-5-5 »)
        _garder(ctx, a, fields, m, r.get("modele") or qui, nouv=nv)
        kept += 1
    return {"importes": kept, "recus": len(rows)}
