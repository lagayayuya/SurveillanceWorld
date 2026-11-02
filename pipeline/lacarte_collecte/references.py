"""The reference readings of the threshold, through Anthropic's Message Batches API, on the Mac
only (`lacarte-collecte seuil lire`). They measure our reader, they never fill a published
field (DECISIONS 2026-11-02).

- The key: ~/.config/la-carte/anthropic.env (outside the repository, never an exported
  variable), its first `name=value` line; given to the client, never printed.
- The texts: asked from the server (`lacarte-collecte textes` over ssh: Attrap's text of each
  act's recueil, a window wider than our cut), held in memory, never written.
- One batch: per act, the short instruction (a cached system prompt, the same for every
  act), the act's text and its number; the answer constrained by a JSON schema (kind,
  commune, numbers of cameras, dates, hours, perimeter). The answers are written in the
  blind reading's columns (LECTURE-AVEUGLE), with their source (« texte Attrap ») and the
  model, under data/registre/references/.
- The cost: each answer's usage (input, cache written and read, output), at the batch's
  price (half the standard price; rules/collecte_seuils.yaml `references.prix`).
- `comparer`: the readings against a reference file, on the commune, the numbers of cameras,
  the dates and the hours (Ju's calibration criterion).
"""

from __future__ import annotations

import csv
import json
import time
import unicodedata
from collections.abc import Iterable
from pathlib import Path
from typing import Any

KEY_FILE = Path.home() / ".config" / "la-carte" / "anthropic.env"
COLUMNS = (
    "acte",
    "dispositif",
    "sous_type",
    "commune",
    "insee",
    "n_interieur",
    "n_exterieur",
    "n_voie_publique",
    "n_total",
    "dates",
    "horaires",
    "n_cameras_drone",
    "zone_mot",
    "lisible",
    "remarque",
    "source",
    "modele",
)

CONSIGNE = """\
Tu lis un arrêté préfectoral français dans le texte d'un recueil des actes administratifs \
(texte issu d'un PDF, parfois d'une reconnaissance de caractères : coquilles, mots coupés, \
pieds de page et en-têtes mêlés au texte). On te donne un extrait plus large que l'acte et le \
numéro de l'acte à lire. Lis cet acte-là seulement, et dans cet acte, son dispositif (ce qu'il \
décide : « ARRÊTE », les articles), pas les visas (« Vu… », « Considérant… »).

Réponds par le schéma JSON demandé :
- trouve : l'acte est-il dans l'extrait ;
- dispositif : videoprotection (système de vidéoprotection, articles L.252-1 et suivants du \
code de la sécurité intérieure), drone (caméras installées sur des aéronefs, L.242-5), \
cameras_pietons (caméras individuelles des agents, L.241-1 et L.241-2), vsa (traitement \
algorithmique des images), autre (rien de cela) ;
- sous_type : autorisation, renouvellement, modification, abrogation, refus ou provisoire ;
- commune : la commune où le dispositif est installé ou opère (pour un drone, celle de \
l'événement ; s'il y en a plusieurs, la première citée dans le dispositif), son nom seul ;
- vidéoprotection : nombres de caméras intérieures, extérieures, visionnant la voie publique, \
et n_total, le total des caméras autorisées ; quand l'acte n'écrit pas de total, n_total est \
la somme des nombres qu'il écrit (intérieures + extérieures + voie publique énoncées à part) ; \
si l'acte dit « dont N visionnant la voie publique », la voie publique est comprise dans les \
extérieures et n_total = intérieures + extérieures ; relis chaque nombre de l'article qui les \
énumère, n'en omets aucun ; un nombre que l'acte n'écrit pas est null ;
- drone : dates, chaque jour autorisé au format AAAA-MM-JJ (une période : son premier et son \
dernier jour) ; horaires, chaque plage au format HHhMM-HHhMM (24 h ; une plage qui finit le \
lendemain garde son heure de fin, 18h00-03h00 ; une plage sans heure de fin écrite, « jusqu'à \
la fin du dispositif », s'écrit HHhMM-fin) ; n_cameras_drone, le nombre maximal de caméras \
ou d'aéronefs autorisé tel qu'il est écrit, null s'il n'est pas écrit (un modèle d'appareil \
cité sans nombre : null) ;
- caméras-piétons : n_total, le nombre de caméras autorisées s'il est écrit ;
- perimetre : un nom de lieu court, pris dans le dispositif, qui caractérise le périmètre \
autorisé (« Stade de France », « centre-ville »), null s'il n'y en a pas ;
- lisible : oui, partiel (une partie manque ou est illisible) ou non.

N'écris aucun nom de personne physique, nulle part. N'invente rien : ce que l'acte ne dit pas \
est null ou une liste vide."""

SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "trouve": {"type": "boolean"},
        "dispositif": {
            "type": "string",
            "enum": ["videoprotection", "drone", "cameras_pietons", "vsa", "autre"],
        },
        "sous_type": {
            "type": "string",
            "enum": [
                "autorisation",
                "renouvellement",
                "modification",
                "abrogation",
                "refus",
                "provisoire",
            ],
        },
        "commune": {"type": ["string", "null"]},
        "n_interieur": {"type": ["integer", "null"]},
        "n_exterieur": {"type": ["integer", "null"]},
        "n_voie_publique": {"type": ["integer", "null"]},
        "n_total": {"type": ["integer", "null"]},
        "dates": {"type": "array", "items": {"type": "string"}},
        "horaires": {"type": "array", "items": {"type": "string"}},
        "n_cameras_drone": {"type": ["integer", "null"]},
        "perimetre": {"type": ["string", "null"]},
        "lisible": {"type": "string", "enum": ["oui", "partiel", "non"]},
    },
    "required": [
        "trouve",
        "dispositif",
        "sous_type",
        "commune",
        "n_interieur",
        "n_exterieur",
        "n_voie_publique",
        "n_total",
        "dates",
        "horaires",
        "n_cameras_drone",
        "perimetre",
        "lisible",
    ],
    "additionalProperties": False,
}


def cle(path: Path = KEY_FILE) -> str:
    for line in path.read_text("utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            return line.split("=", 1)[1].strip().strip("'\"")
    raise RuntimeError(f"{path}: no key")


def client() -> Any:
    import anthropic

    return anthropic.Anthropic(api_key=cle())


RELIRE = (
    "Une première lecture de cet acte, au même schéma :\n<lecture>\n{lecture}\n</lecture>\n"
    "Vérifie chaque champ contre le dispositif de l'acte, dans l'extrait, et rends la lecture "
    "juste, corrigée là où elle se trompe, au même schéma."
)


def requete(
    i: int, act: dict[str, Any], model: str, effort: str, premiere: dict[str, Any] | None = None
) -> Any:
    """One act's request; with `premiere` (a first reading), a rereading: the model checks it
    against the act and answers the corrected reading."""
    from anthropic.types.message_create_params import MessageCreateParamsNonStreaming
    from anthropic.types.messages.batch_create_params import Request

    user = (
        f"Recueil : {act['recueil_nom']} (publié le {act['date']}).\n"
        f"Acte à lire : n° {act['acte']}.\n\n<extrait>\n{act['texte']}\n</extrait>"
    )
    if premiere is not None:
        user += "\n\n" + RELIRE.format(lecture=json.dumps(premiere, ensure_ascii=False))
    return Request(
        custom_id=f"a{i}",
        params=MessageCreateParamsNonStreaming(
            model=model,
            max_tokens=16000,
            system=[{"type": "text", "text": CONSIGNE, "cache_control": {"type": "ephemeral"}}],
            messages=[{"role": "user", "content": user}],
            output_config={"effort": effort, "format": {"type": "json_schema", "schema": SCHEMA}},
        ),
    )


def soumettre(
    c: Any,
    acts: list[dict[str, Any]],
    model: str,
    effort: str,
    premieres: list[dict[str, Any] | None] | None = None,
) -> str:
    """One batch; its id. `premieres`: the first readings to reread, act by act (an act
    without one is not sent)."""
    reqs = [
        requete(i, a, model, effort, premieres[i] if premieres else None)
        for i, a in enumerate(acts)
        if premieres is None or premieres[i] is not None
    ]
    return str(c.messages.batches.create(requests=reqs).id)


def recuperer(
    c: Any, batch_id: str, acts: list[dict[str, Any]], model: str, wait_s: float = 30
) -> list[dict[str, Any]]:
    """The batch, waited for: each act's answer and usage, by its custom_id."""
    while c.messages.batches.retrieve(batch_id).processing_status != "ended":
        time.sleep(wait_s)
    rows: list[dict[str, Any]] = [{"id": a["id"], "statut": "absent"} for a in acts]
    for r in c.messages.batches.results(batch_id):
        i = int(r.custom_id[1:])
        if r.result.type != "succeeded":
            rows[i] = {"id": acts[i]["id"], "statut": r.result.type}
            continue
        msg = r.result.message
        text = next((x.text for x in msg.content if x.type == "text"), "")
        u = msg.usage
        rows[i] = {
            "id": acts[i]["id"],
            "statut": "refus" if msg.stop_reason == "refusal" else msg.stop_reason,
            "lecture": json.loads(text) if text and msg.stop_reason == "end_turn" else None,
            "usage": {
                "input": u.input_tokens,
                "output": u.output_tokens,
                "cache_write": u.cache_creation_input_tokens or 0,
                "cache_read": u.cache_read_input_tokens or 0,
            },
        }
    return [{**r, "lot": batch_id, "modele": model} for r in rows]


def lire(
    acts: list[dict[str, Any]],
    model: str,
    effort: str = "medium",
    wait_s: float = 30,
    out: Any = None,
) -> list[dict[str, Any]]:
    """One batch for `acts` (each with its text), waited for."""
    c = client()
    bid = soumettre(c, acts, model, effort)
    if out:
        out(f"lot {bid} : {len(acts)} actes, {model}")
    return recuperer(c, bid, acts, model, wait_s)


def cout(rows: Iterable[dict[str, Any]], prix: dict[str, Any]) -> dict[str, Any]:
    """The readings' cost in dollars, at the batch's price: per million tokens, input, output;
    a cache write 1.25 times the input, a read 0.1 times."""
    tokens = {"input": 0, "output": 0, "cache_write": 0, "cache_read": 0}
    dollars = 0.0
    for r in rows:
        u = r.get("usage")
        if not u:
            continue
        p = prix[r["modele"]]
        rate = float(prix.get("remise_lot", 0.5))
        for k in tokens:
            tokens[k] += u[k]
        dollars += (
            rate
            * (
                u["input"] * p["entree"]
                + u["output"] * p["sortie"]
                + u["cache_write"] * p["entree"] * 1.25
                + u["cache_read"] * p["entree"] * 0.1
            )
            / 1e6
        )
    return {"jetons": tokens, "dollars": round(dollars, 4)}


def _span(days: list[str]) -> str:
    days = sorted(d for d in days if d)
    return "" if not days else days[0] if len(days) == 1 else f"{days[0]} au {days[-1]}"


def en_colonnes(r: dict[str, Any], acte: str) -> dict[str, Any]:
    x = r.get("lecture") or {}
    return {
        "acte": acte,
        "dispositif": x.get("dispositif"),
        "sous_type": x.get("sous_type"),
        "commune": x.get("commune"),
        "insee": "",
        **{
            k: x.get(k)
            for k in ("n_interieur", "n_exterieur", "n_voie_publique", "n_total", "n_cameras_drone")
        },
        "dates": _span(x.get("dates") or []),
        "horaires": " ; ".join(x.get("horaires") or []),
        "zone_mot": x.get("perimetre"),
        "lisible": x.get("lisible") if x.get("trouve") else "non",
        "remarque": r["statut"] if r["statut"] != "end_turn" else "",
        "source": "texte Attrap",
        "modele": r["modele"],
    }


def ecrire(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as fh:
        w = csv.DictWriter(fh, COLUMNS)
        w.writeheader()
        for r in rows:
            w.writerow({k: "" if r.get(k) is None else r[k] for k in COLUMNS})


# --- the calibration: readings against a reference file ------------------------------------
def _norm(s: Any) -> str:
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode().lower()
    return " ".join(s.replace("-", " ").replace("'", " ").split())


def _num(x: Any) -> int | None:
    try:
        return int(float(str(x).strip()))
    except ValueError:
        return None


def _hours(s: Any) -> list[str]:
    import re

    return sorted({h.zfill(5) for h in re.findall(r"\d{1,2}h\d{2}", str(s or "").replace(" ", ""))})


def comparer(lu: dict[str, Any], ref: dict[str, str]) -> dict[str, bool]:
    """Per field of Ju's criterion: commune, numbers of cameras, dates, hours (a field the
    reference leaves empty and the reading too is right)."""
    kind = ref["dispositif"]
    counts = {
        "videoprotection": ("n_interieur", "n_exterieur", "n_voie_publique", "n_total"),
        "cameras_pietons": ("n_total",),
        "drone": ("n_cameras_drone",),
    }.get(kind, ())
    out = {
        "commune": not ref.get("commune") or _norm(lu.get("commune")) == _norm(ref["commune"]),
        "nombres": all(_num(lu.get(k, "")) == _num(ref.get(k, "")) for k in counts),
    }
    if kind == "drone":
        out["dates"] = _norm(lu.get("dates")) == _norm(ref.get("dates"))
        out["horaires"] = _hours(lu.get("horaires")) == _hours(ref.get("horaires"))
    return out
