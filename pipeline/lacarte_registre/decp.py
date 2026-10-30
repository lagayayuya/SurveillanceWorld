"""The consolidated DECP (données essentielles de la commande publique, data.gouv.fr): the
video-surveillance contracts of France and their modifications.

Where it reads (rules/registre_sources.yaml `sources.decp`): the dataset's page gives the
Parquet file (~250 MB) and the CSV's row API. The Parquet is downloaded (fetch.download) when
its host's robots.txt allows it, and read by batches of rows, two passes, only the columns
used: never the whole file in memory. Otherwise the rows come from data.gouv.fr's tabular
API: the server filters the rows that may take a path (a CPV of the selection, a video,
camera, supervision, plates or drone word in the objet: a superset of the paths, matched by
substring), then every row of each candidate contract, asked by uid. Either way the
selection (selection.select) runs here on all the rows of each candidate: the same contracts.

What is kept (brut/decp/, not versioned): the downloaded file, or the API's pages. Never a
holder's name (`titulaire_nom` is not asked for, nor read): a holder is its SIREN.

Out: <root>/national/decp.jsonl.gz, one contract per line (`contrat`), and decp.json (the
file's version, the counts): {uid, chemin, acheteur_id, acheteur_nom, acheteur_categorie,
acheteur_commune_code, acheteur_departement_code, codeCPV, objet, techniques,
idAccordCadre, sourceDataset, offres, lignes: [{modification_id, dateNotification, montant,
dureeMois, titulaires: [SIREN or SIRET], sourceFile}]}.
"""

from __future__ import annotations

import gzip
import json
from collections import defaultdict
from collections.abc import Iterable, Iterator
from pathlib import Path
from typing import Any

from lacarte_registre import fetch, selection

SOURCE = "decp"
# The columns read: what the selection and the registre need, never a holder's name.
COLUMNS = (
    "uid",
    "id",
    "acheteur_id",
    "acheteur_nom",
    "acheteur_categorie",
    "acheteur_commune_code",
    "acheteur_departement_code",
    "titulaire_id",
    "titulaire_typeIdentifiant",
    "objet",
    "montant",
    "codeCPV",
    "techniques",
    "dureeMois",
    "offresRecues",
    "dateNotification",
    "idAccordCadre",
    "modification_id",
    "sourceDataset",
    "sourceFile",
)
# The objet's substrings that may start a path (selection.row_path), as the tabular API
# matches them (ILIKE: case-insensitive, accent-sensitive; the upper-case accented forms in
# case the server folds only ASCII).
OBJET_WORDS = (
    "vidéo",
    "video",
    "VIDÉO",
    "caméra",
    "camera",
    "CAMÉRA",
    "csu",
    "supervision",
    "plaques",
    "lapi",
    "drone",
)


def resources(f: fetch.Fetcher) -> dict[str, Any]:
    """The dataset's Parquet and CSV resources (url, id, last modified)."""
    src = f.conf["sources"][SOURCE]
    ds = f.get_json(src["dataset"], cache=False)
    out = {}
    for r in ds.get("resources", []):
        for kind in ("parquet", "csv"):
            if r.get("title") == src[f"{kind}_title"]:
                out[kind] = {
                    "url": r["url"],
                    "id": r["id"],
                    "modifie": (r.get("last_modified") or "")[:10],
                }
    return out


def _contract(uid: str, rows: list[dict[str, Any]], path: str) -> dict[str, Any]:
    rows = sorted(
        rows, key=lambda r: (int(r.get("modification_id") or 0), r.get("titulaire_id") or "")
    )
    k = rows[0]
    mods: dict[int, dict[str, Any]] = {}
    offres = None
    for r in rows:
        n = int(r.get("modification_id") or 0)
        m = mods.setdefault(
            n,
            {
                "modification_id": n,
                "dateNotification": str(r.get("dateNotification") or "")[:10],
                "montant": r.get("montant"),
                "dureeMois": r.get("dureeMois"),
                "titulaires": [],
                "sourceFile": r.get("sourceFile"),
            },
        )
        if r.get("titulaire_id"):
            m["titulaires"].append(str(r["titulaire_id"]))
        o = r.get("offresRecues")
        if o is not None:
            offres = max(offres or 0, int(o))
    first = {c: k.get(c) for c in COLUMNS if c not in ("titulaire_id", "titulaire_typeIdentifiant")}
    objet = next((r.get("objet") for r in rows if r.get("objet")), None)
    return {
        "uid": uid,
        "chemin": path,
        **{
            c: first[c]
            for c in (
                "acheteur_id",
                "acheteur_nom",
                "acheteur_categorie",
                "acheteur_commune_code",
                "acheteur_departement_code",
                "codeCPV",
                "techniques",
                "idAccordCadre",
                "sourceDataset",
            )
        },  # fmt: skip
        "objet": objet,
        "offres": offres,
        "lignes": [mods[n] for n in sorted(mods)],
    }


def contracts(rows: Iterable[dict[str, Any]]) -> Iterator[dict[str, Any]]:
    """The selected contracts from every row of the candidates (any order)."""
    by_uid: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for r in rows:
        if r.get("uid"):
            by_uid[r["uid"]].append(r)
    kept = selection.select(r for rs in by_uid.values() for r in rs)
    for uid in sorted(kept):
        yield _contract(uid, by_uid[uid], kept[uid])


# --- the Parquet file ---------------------------------------------------------------------
def read_parquet(path: Path, departements: set[str] | None = None) -> Iterator[dict[str, Any]]:
    """Every row of a candidate contract, two passes over the file by batches of rows: the
    uids that may be kept, then their rows."""
    import pyarrow.parquet as pq

    pf = pq.ParquetFile(path)
    cols = [c for c in COLUMNS if c in pf.schema_arrow.names]

    def batches() -> Iterator[dict[str, Any]]:
        for b in pf.iter_batches(batch_size=50_000, columns=cols):
            yield from b.to_pylist()

    cand = set()
    for r in batches():
        if departements and r.get("acheteur_departement_code") not in departements:
            continue
        if selection.row_path(r) is not None:
            cand.add(r["uid"])
    for r in batches():
        if r.get("uid") in cand:
            yield r


# --- the tabular API ----------------------------------------------------------------------
def _tabular_queries(departements: set[str] | None) -> list[dict[str, str]]:
    rules = selection.rules()["cpv"]
    codes = [c for role in ("coeur", "large", "drone") for c in rules[role]]
    qs = [{"codeCPV__contains": c} for c in codes]
    qs += [{"objet__contains": w} for w in OBJET_WORDS]
    if departements:
        qs = [{**q, "acheteur_departement_code__in": ",".join(sorted(departements))} for q in qs]
    return qs


def _pages(
    f: fetch.Fetcher, url: str, params: dict[str, str], size: int, start: int = 1
) -> Iterator[tuple[int, list[dict[str, Any]], int]]:
    page = start
    while True:
        d = f.get_json(url, {**params, "page_size": size, "page": page}, cache=False)
        rows = d.get("data") or []
        yield page, rows, int((d.get("meta") or {}).get("total") or 0)
        if not rows or page * size >= int((d.get("meta") or {}).get("total") or 0):
            return
        page += 1


def read_tabular(
    f: fetch.Fetcher, resource: str, departements: set[str] | None = None, resume: bool = False
) -> Iterator[dict[str, Any]]:
    """Every row of a candidate contract from the tabular API, the pages kept under
    brut/decp/tabulaire/ and the cursor in the state: `resume` goes on where a cut run
    stopped."""
    src = f.conf["sources"][SOURCE]
    url = src["tabular"].format(resource=resource)
    size = int(src["page_size"])
    cols = ",".join(COLUMNS)
    pages = f.dir / "tabulaire"
    st = f.state().get("curseur") or {} if resume else {}
    if not resume and pages.exists():
        for p in pages.glob("*.jsonl"):
            p.unlink()
    pages.mkdir(parents=True, exist_ok=True)
    queries = _tabular_queries(departements)
    done_q = int(st.get("requete", 0))
    for i, q in enumerate(queries):
        if i < done_q:
            continue
        start = int(st.get("page", 0)) + 1 if i == done_q and st.get("phase") == "candidats" else 1
        for page, rows, _total in _pages(f, url, {**q, "columns": cols}, size, start):
            _append(pages / f"candidats-{i:03d}.jsonl", rows)
            f.save_state(
                statut="en_cours", curseur={"phase": "candidats", "requete": i, "page": page}
            )
        f.save_state(curseur={"phase": "candidats", "requete": i + 1, "page": 0})
    cand = sorted({r["uid"] for p in pages.glob("candidats-*.jsonl") for r in _read(p)
                   if selection.row_path(r) is not None})  # fmt: skip
    # every row of each candidate (its modifications may name neither the CPV nor a word)
    st = f.state().get("curseur") or {}
    done_b = int(st.get("lot", 0)) if st.get("phase") == "contrats" else 0
    batch = 40
    for j in range(done_b, (len(cand) + batch - 1) // batch):
        uids = cand[j * batch : (j + 1) * batch]
        rows_j: list[dict[str, Any]] = []
        for _page, rows, _total in _pages(
            f, url, {"uid__in": ",".join(uids), "columns": cols}, size
        ):
            rows_j += rows
        _write(pages / f"contrats-{j:05d}.jsonl", rows_j)
        f.save_state(curseur={"phase": "contrats", "lot": j + 1, "candidats": len(cand)})
    for p in sorted(pages.glob("contrats-*.jsonl")):
        yield from _read(p)


def _append(path: Path, rows: list[dict[str, Any]]) -> None:
    with path.open("a", encoding="utf-8") as out:
        for r in rows:
            out.write(json.dumps(r, ensure_ascii=False) + "\n")


def _write(path: Path, rows: list[dict[str, Any]]) -> None:
    tmp = path.with_suffix(".tmp")
    with tmp.open("w", encoding="utf-8") as out:
        for r in rows:
            out.write(json.dumps(r, ensure_ascii=False) + "\n")
    tmp.replace(path)


def _read(path: Path) -> Iterator[dict[str, Any]]:
    with path.open(encoding="utf-8") as fh:
        for line in fh:
            if line.strip():
                yield json.loads(line)


def write(out: Path, items: Iterable[dict[str, Any]]) -> int:
    """One contract per line, gzip, written whole then renamed (never half a file)."""
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_name(f".{out.name}.tmp")
    n = 0
    with gzip.open(tmp, "wt", encoding="utf-8") as g:
        for c in items:
            g.write(json.dumps(c, ensure_ascii=False, separators=(",", ":")) + "\n")
            n += 1
    tmp.replace(out)
    return n


def load(path: Path) -> Iterator[dict[str, Any]]:
    with gzip.open(path, "rt", encoding="utf-8") as g:
        for line in g:
            yield json.loads(line)


def collect(
    f: fetch.Fetcher, out_dir: Path, departements: set[str] | None = None, resume: bool = False
) -> dict[str, Any]:
    """The collection: the Parquet if robots.txt allows it, else the tabular API; then the
    selection, written to <out_dir>/decp.jsonl.gz. Returns the source's summary."""
    res = resources(f)
    parquet = res.get("parquet")
    mode = "parquet"
    if parquet:
        ok, why = f.allowed(parquet["url"])
        if not ok:
            mode = "tabulaire"
            f.save_state(note_parquet=f"{parquet['url']} : {why}")
    else:
        mode = "tabulaire"
    if mode == "parquet":
        dest = f.dir / "decp.parquet"
        f.download(parquet["url"], dest)
        rows = read_parquet(dest, departements)
        version = parquet["modifie"]
    else:
        csv = res["csv"]
        rows = read_tabular(f, csv["id"], departements, resume)
        version = csv["modifie"]
    n = write(out_dir / "decp.jsonl.gz", contracts(rows))
    summary = {
        "source": SOURCE,
        "mode": mode,
        "version": version,
        "contrats": n,
        "departements": sorted(departements) if departements else None,
        "requetes": f.requests,
    }
    (out_dir / "decp.json").write_text(json.dumps(summary, ensure_ascii=False), encoding="utf-8")
    return summary
