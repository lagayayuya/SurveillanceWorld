# ruff: noqa: E501  (the phrases' calls, one per line, as the catalogue's keys read)
"""Each record's share (lot R3 § 6): the text that goes with its link, its preview's three
figures and its entry page, computed by construire.

- `partage` in each record's file (commune/, departement/, acheteur/, entreprise/, document/):
  {"url": "/registre/<ref>" (the site's address before it: VITE_SITE_URL, never written
  here), "titre", "description" (the preview's line), "texte" (the text shared: facts with
  their figures, the sentence on the amount set by contract, its sources, the register's
  update day and the record's address), "image" (/data/registre/apercu/…png), "chiffres"
  (the image's three: [{"n", "libelle"}]), "identite" (the image's line under the name)};
- site/entree/<ref>.html: the record's entry page as two parts, its head's tags and its body,
  readable without JavaScript (pages.py puts them into the register's page at the deploy);
- the words come from the web catalogue (web/src/locales/fr.json, `registre.partage.*`), as
  every word the site shows; the same rules as the register's pages: figures and their
  sources, no judgement.

The three figures, always the same for a type (DECISIONS 2026-10-30):
- commune: documents, arrêtés, contrats;  département: documents, communes, contrats;
- acheteur: contrats, entreprises, prévus au contrat;
- entreprise: contrats, acheteurs publics, prévus au contrat;
- a document's type (one image per type: contrat, modification, appel d'offres, arrêté,
  subvention): documents of that type, communes, départements.
A sole trader has no record: no text, no page, no image.
"""

from __future__ import annotations

import functools
import html
import json
import re
from collections import Counter
from collections.abc import Iterable
from pathlib import Path
from typing import Any

from lacarte import regions
from lacarte_registre.regles import EI, Event, typ

CATALOGUE = regions.ROOT / "web" / "src" / "locales" / "fr.json"
NBSP = " "
APERCU = "/data/registre/apercu"
DOC_TYPES = {"con": "contrat", "mod": "modification", "ao": "appel_offres", "aut": "arrete",
             "sub": "subvention"}  # fmt: skip
SOURCE_OF = {"con": "contrats", "mod": "contrats", "ao": "avis", "aut": "arretes",
             "sub": "subventions"}  # fmt: skip
# Words a share never says: a judgement, not a fact (the register's rule of writing).
JUGEMENT = re.compile(
    r"\b(énorme|massi(f|ve)|scandal|inquiétant|alarmant|choquant|record|explos|colossal"
    r"|exorbitant|incroyable|faramineu|vertigineu|abusi(f|ve)|opaque|douteu)",
    re.I,
)


@functools.cache
def _catalogue() -> dict[str, str]:
    return json.loads(CATALOGUE.read_text(encoding="utf-8"))


def t(key: str, **kw: Any) -> str:
    s = _catalogue()[f"registre.partage.{key}"]
    return s.format(**kw)


def nombre(n: float) -> str:
    return f"{round(n):,}".replace(",", NBSP)


def plural(key: str, n: float) -> str:
    one, many = t(key, n=nombre(n)).split("|")
    return one if abs(n) < 2 else many


def money(v: float) -> str:
    """« 215 000 € », « 44,7 M€ »: one decimal in millions, as the mockup's preview."""
    if v >= 1e6:
        m = f"{v / 1e6:.1f}".replace(".", ",").removesuffix(",0")
        return f"{m}{NBSP}M€"
    return f"{nombre(v)}{NBSP}€"


SMALL = {"DE", "DES", "DU", "LA", "LE", "LES", "ET", "EN", "AUX", "AU", "SUR", "SOUS"}


def nom(name: str) -> str:
    """A name in capitals in title case, as the register's pages write it (texte.ts titleCase):
    its small words in lower case after the first, « T.I.C. » and legal forms kept; a name
    already in mixed case as published."""
    name = re.sub(r"\s+", " ", str(name or "")).strip().replace("'", "’")
    if name != name.upper() or not re.search(r"[A-Z]{4}", name):
        return name
    words = re.split(r"(\s+|-)", name)
    return "".join(
        w.lower() if i and w in SMALL
        else w if re.search(r"\.|^(SA|SAS|SARL|SNC|EI|II|III)$", w) or len(w) < 2
        else w[0] + w[1:].lower()
        for i, w in enumerate(words)
    )  # fmt: skip


def jour(d: str | None) -> str:
    return "/".join(reversed(d.split("-"))) if d else ""


def _sources(events: Iterable[Event]) -> str:
    kinds = dict.fromkeys(SOURCE_OF.get(typ(e)) for e in events)
    names = [t(f"source.{k}") for k in kinds if k]
    return t("sources", liste=", ".join(names or [t("source.registre")]))


def _texte(phrase: str, montant: float, events: Iterable[Event], maj: str, url: str) -> str:
    parts = [phrase]
    if montant > 0:
        parts.append(t("prevu", montant=money(montant)))
    parts += [_sources(events), t("maj", date=jour(maj)), url]
    return " ".join(parts)


def _fig_word(n: float, key: str) -> dict[str, str]:
    one, many = _catalogue()[f"registre.partage.chiffre.{key}"].split("|")
    return {"n": nombre(n), "libelle": one if abs(n) < 2 else many}


def commune(ctx: Any, insee: str, events: list[Event]) -> dict[str, Any]:
    c = ctx.reg.communes[insee]
    st = ctx.commune_stats(insee)
    dep = ctx.dep_names.get(c.get("dep")) or c.get("dep")
    epci = ctx.epcis.get(c.get("epci") or "")
    ref = f"commune/{insee}"
    phrase = t("commune", nom=c["nom"], departement=dep, documents=plural("n.document", st["docs"]),
               arretes=plural("n.arrete", st["arr"]), contrats=plural("n.contrat", st["con"]))  # fmt: skip
    return _fiche(ctx, ref, c["nom"], " · ".join(x for x in (dep, epci) if x), phrase,
                  st.get("montant") or 0, events,
                  [_fig_word(st["docs"], "document"), _fig_word(st["arr"], "arrete"),
                   _fig_word(st["con"], "contrat")], "commune")  # fmt: skip


def departement(
    ctx: Any, dep: str, events: list[Event], communes: int, montant: float
) -> dict[str, Any]:
    nom = ctx.dep_names.get(dep) or dep
    con = sum(1 for e in events if e["t"] == "attribution")
    phrase = t("departement", nom=nom, documents=plural("n.document", len(events)),
               communes=plural("n.commune", communes), contrats=plural("n.contrat", con))  # fmt: skip
    return _fiche(ctx, f"departement/{dep}", nom, t("departement_code", code=dep), phrase, montant,
                  events, [_fig_word(len(events), "document"), _fig_word(communes, "commune"),
                           _fig_word(con, "contrat")], "departement")  # fmt: skip


def entreprise(ctx: Any, siren: str, name: str, events: list[Event]) -> dict[str, Any] | None:
    st = ctx.ent_stats.get(siren)
    if not st or siren == EI:
        return None
    deps = Counter(st.get("deps") or {})
    dont = ""
    if len(deps) > 1:
        d, n = deps.most_common(1)[0]
        dont = t("entreprise_dont", n=nombre(n), code=d, departement=ctx.dep_names.get(d) or d)
    y0 = st.get("y0") or ""
    phrase = t("entreprise", nom=name, contrats=plural("n.contrat", st["n"]),
               acheteurs=plural("n.acheteur", len(st["clientes"])), annee=y0, dont=dont)  # fmt: skip
    x = ctx.reg.pilote.reg.get("entreprises", {}).get(siren) or {}
    ident = " · ".join(v for v in (x.get("naf_libelle"), t("depuis", annee=y0) if y0 else "") if v)
    return _fiche(ctx, f"entreprise/{siren}", name, ident, phrase, st["montant"], events,
                  [_fig_word(st["n"], "contrat"), _fig_word(len(st["clientes"]), "acheteur"),
                   {"n": money(st["montant"]), "libelle": t("chiffre.prevu")}], "entreprise")  # fmt: skip


def acheteur(ctx: Any, siren: str, name: str, events: list[Event]) -> dict[str, Any]:
    st = ctx.buy_stats.get(siren) or {"n": 0, "montant": 0.0, "ents": []}
    a = ctx.acheteurs.get(siren) or {}
    y0 = min((e["date"][:4] for e in events if e.get("date")), default="")
    phrase = t("acheteur", nom=name, contrats=plural("n.contrat", st["n"]),
               entreprises=plural("n.entreprise", len(st["ents"])), annee=y0)  # fmt: skip
    cat = _catalogue().get(f"registre.chiffres.cat_{a.get('categorie')}", "")
    cat = cat[:1].upper() + cat[1:]
    ident = " · ".join(v for v in (cat, ctx.dep_names.get(a.get("dep") or "")) if v)
    return _fiche(ctx, f"acheteur/{siren}", name, ident, phrase, st["montant"], events,
                  [_fig_word(st["n"], "contrat"), _fig_word(len(st["ents"]), "entreprise"),
                   {"n": money(st["montant"]), "libelle": t("chiffre.prevu")}], "acheteur")  # fmt: skip


def document(
    ctx: Any, affaire: dict[str, Any], events: list[Event], names: dict[str, str]
) -> dict[str, Any]:
    """A document's record: its own text, its type's image."""
    first = events[0]
    kind = DOC_TYPES.get(typ(first), "contrat")
    sign = next((e for e in events if e["t"] == "attribution"), first)
    titre = affaire.get("titre") or first.get("objet") or first.get("ref") or affaire["id"]
    nature = _catalogue().get(f"registre.partage.nature.{affaire.get('kind')}") or t(f"type.{kind}")
    buyer = names.get("acheteur") or t("nom_non_publie")
    ents = names.get("entreprises")
    phrase = t("contrat", titre=titre, nature=nature, date=jour(sign.get("date")), acheteur=buyer,
               entreprises=t("contrat_entreprises", noms=ents) if ents else "")  # fmt: skip
    montant = (sign.get("montant") or 0) if sign.get("compte") else 0
    ref = f"contrat/{affaire['id']}"
    ident = " · ".join(
        x for x in (t("signe", date=jour(sign.get("date"))), names.get("commune"), ents) if x
    )
    out = _fiche(ctx, ref, titre, ident, phrase, montant, events, [], None)
    out["image"] = f"{APERCU}/document/{kind}.png"
    return out


def type_document(ctx: Any, kind: str, events: list[Event]) -> dict[str, Any]:
    """The preview of a type of document (every record of that type points to it)."""
    communes = {e["insee"] for e in events if e.get("insee")}
    deps = {e["dep"] for e in events if e.get("dep")}
    nom = t(f"type.{kind}")
    return {
        "titre": nom,
        "identite": t("france"),
        "chiffres": [
            _fig_word(len(events), "document"),
            _fig_word(len(communes), "commune"),
            _fig_word(len(deps), "departement"),
        ],  # fmt: skip
        "etiquette": kind,
        "image": f"{APERCU}/document/{kind}.png",
    }


def _fiche(
    ctx: Any,
    ref: str,
    nom: str,
    ident: str,
    phrase: str,
    montant: float,
    events: Iterable[Event],
    chiffres: list[dict[str, str]],
    etiquette: str | None,
) -> dict[str, Any]:
    url = f"/registre/{ref}"
    texte = _texte(phrase, montant, events, ctx.couverture["maj"], url)
    return {
        "url": url,
        "titre": nom,
        "description": phrase,
        "texte": texte,
        "identite": ident,
        "chiffres": chiffres,
        "etiquette": etiquette,
        "image": f"{APERCU}/{ref}.png" if etiquette else None,
    }


# --- the entry page ------------------------------------------------------------------------
HEAD, BODY = "<!--entree:tete-->", "<!--entree:corps-->"


def entree(p: dict[str, Any], liens: list[tuple[str, str]]) -> str:
    """The record's entry page's two parts: its head's tags (title, description, Open Graph,
    Twitter, canonical, noindex while the site is not open) and its body, plain HTML. The
    site's address is `%site%`, written in at the deploy (pages.py, VITE_SITE_URL)."""
    e = html.escape
    tags = [
        f"<title>{e(p['titre'])} · {e(_catalogue()['registre.page.titre_seul'])}</title>",
        '<meta name="robots" content="noindex" />',
        f'<meta name="description" content="{e(p["description"])}" />',
        f'<link rel="canonical" href="%site%{e(p["url"])}" />',
        '<meta property="og:type" content="website" />',
        f'<meta property="og:title" content="{e(p["titre"])}" />',
        f'<meta property="og:description" content="{e(p["description"])}" />',
        f'<meta property="og:url" content="%site%{e(p["url"])}" />',
        f'<meta property="og:image" content="%site%{e(p["image"])}" />' if p.get("image") else "",
        '<meta property="og:image:width" content="1200" />',
        '<meta property="og:image:height" content="630" />',
        '<meta property="og:locale" content="fr_FR" />',
        '<meta name="twitter:card" content="summary_large_image" />',
        f'<meta name="twitter:title" content="{e(p["titre"])}" />',
        f'<meta name="twitter:description" content="{e(p["description"])}" />',
    ]
    figs = "".join(
        f"<li><b>{e(f['n'])}</b> {e(f['libelle'])}</li>" for f in p.get("chiffres") or []
    )
    links = "".join(f'<li><a href="/registre/{e(r)}">{e(n)}</a></li>' for r, n in liens)
    body = (
        f'<article class="entree"><h1>{e(p["titre"])}</h1>'
        + (f"<p>{e(p['identite'])}</p>" if p.get("identite") else "")
        + (f"<ul>{figs}</ul>" if figs else "")
        + f"<p>{e(p['texte'].rsplit(' ', 1)[0])}</p>"
        + (f"<h2>{e(t('liens'))}</h2><ul>{links}</ul>" if links else "")
        + f'<p><a href="{e(p["url"])}">{e(t("voir"))}</a></p>'
        + f"<p>{e(t('sans_js'))}</p></article>"
    )
    return f"{HEAD}\n{''.join(x for x in tags if x)}\n{BODY}\n{body}\n"


def write_entree(site: Path, ref: str, page: str) -> None:
    path = site / "entree" / f"{ref}.html"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(page, encoding="utf-8")


def liens(data: dict[str, Any], own: str, n: int = 8) -> list[tuple[str, str]]:
    """The records a file names, for its entry page: its dictionaries' entries that have one."""
    out: dict[str, str] = {}
    for kind in ("acheteurs", "entreprises", "communes"):
        for entry in (data.get(kind) or {}).values():
            r = entry.get("ref")
            if r and r != own and r not in out:
                out[r] = entry.get("nom_court") or entry.get("nom") or r
    return list(out.items())[:n]
