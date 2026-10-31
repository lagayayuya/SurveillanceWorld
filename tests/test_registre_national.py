"""The national public procurement (lot R3 §§ 2-3) on a real extract: the DECP's rows of the
Rhône's video-surveillance candidates, read from data.gouv.fr's tabular API on 2026-10-30
(file of 2026-10-26, no holder's name), and the communes of France around them.

- the selection, ported from the exploration, finds the same contracts as the pilot in the
  Rhône, with the same dates, amounts, communes and holders;
- `lacarte-registre collecter` against a fake server serving these rows (the tabular API,
  the Parquet forbidden by robots.txt as data.gouv.fr's is), synthetic BOAMP records, the
  communes and SIRENE answers: all or nothing, resumable, then construire merges it with the
  pilot (the national sources win)."""

from __future__ import annotations

import gzip
import http.server
import json
import re
import threading
import urllib.parse
from collections.abc import Iterator
from datetime import date
from pathlib import Path

import pytest

from lacarte_registre import collecter, construire, couverture, decp, fetch, importer, national

FIXTURE = Path(__file__).parent / "fixtures" / "registre"
NATIONAL = FIXTURE / "national"
MIONS, SERFIM = "69283", "431903954"
# The one contract whose flag differs: the pilot read it « to check » against its BOAMP
# notice's estimated value; without the BOAMP (unreachable from the session that froze the
# extract) the rule has nothing to compare.
NEEDS_BOAMP = "21690029000018201914904_32323500~0"


def rows() -> list[dict]:
    with gzip.open(NATIONAL / "decp-rhone.jsonl.gz", "rt", encoding="utf-8") as g:
        return [json.loads(line) for line in g]


def pilot() -> dict:
    t = (FIXTURE / "prototype-v4" / "registre.js").read_text(encoding="utf-8")
    return json.loads(t[t.index("=") + 1 :].strip().rstrip(";"))


def test_the_selection_finds_the_pilot_s_contracts_of_the_rhone():
    kept = national.sans_doublons(decp.contracts(rows()))
    reg = pilot()
    rhone = {e["affaire"] for e in reg["evenements"]
             if e["t"] == "attribution" and e.get("dep") == "69"}  # fmt: skip
    assert {c["uid"] for c in kept} == rhone
    assert len(rhone) == 238


def test_the_same_dates_amounts_communes_and_holders(tmp_path):
    (tmp_path / "national").mkdir()
    decp.write(tmp_path / "national" / "decp.jsonl.gz", decp.contracts(rows()))
    (tmp_path / "national" / "communes.json").write_bytes((NATIONAL / "communes.json").read_bytes())
    nat = {e["id"]: e for e in national.assembler(tmp_path)["evenements"]}
    old = {e["id"]: e for e in pilot()["evenements"] if e["t"] == "attribution"}
    same = set(old) & set(nat)
    assert len(same) == 238
    for i in same:
        a, b = old[i], nat[i]
        for k in ("date", "montant", "insee", "dep", "entreprises", "affaire"):
            assert a.get(k) == b.get(k), (i, k, a.get(k), b.get(k))
        if i != NEEDS_BOAMP:
            assert (a.get("hors_totaux") or "") == (b.get("hors_totaux") or ""), i


def test_a_national_row_without_its_day_keeps_the_pilot_s():
    """The DECP lost some days since the pilot's file: the merge keeps the pilot's day for the
    same contract (2175000160001920191370000106_50324100, Paris, 2019-02-11 on 2026-10-31)."""
    from lacarte_registre import fusion
    from lacarte_registre.regles import Pilote

    pil = {"id": "c~0", "t": "attribution", "affaire": "c", "date": "2019-02-11"}
    nat = {"id": "c~0", "t": "attribution", "affaire": "c", "date": ""}
    p = Pilote(reg={"evenements": [pil], "affaires": {"c": {"events": ["c~0"]}}}, globals={})
    n = {"evenements": [nat], "affaires": {"c": {"events": []}}, "entreprises": {},
         "communes": {}, "ACHETEURS": {}, "EPCIS": {}, "DEP": {}, "LOTS_GROUPES": {}}  # fmt: skip
    merged, summary = fusion.fusionner(p, n)
    assert merged.reg["evenements"][0]["date"] == "2019-02-11"
    assert summary["dates_du_pilote"] == 1


def test_a_contract_published_without_its_day_is_kept_and_compared_to_none(tmp_path):
    """54 of the real DECP's rows have no notification day (2026-10-31): the build keeps them,
    and the amount checks that compare days skip them."""
    data = rows()
    # one amount shared by contracts of several buyers, one of them without its day
    for r in data[:5]:
        r["montant"] = 1_234_567
    data[0]["dateNotification"] = ""
    # a day no contract can have (the DECP hold « 0029-12-22 » for a 2021 contract)
    data[1]["dateNotification"] = "0029-12-22"
    (tmp_path / "national").mkdir()
    decp.write(tmp_path / "national" / "decp.jsonl.gz", decp.contracts(data))
    (tmp_path / "national" / "communes.json").write_bytes((NATIONAL / "communes.json").read_bytes())
    evs = national.assembler(tmp_path)["evenements"]
    assert len(evs) >= 238 and any(not e["date"] for e in evs)
    assert all(not e["date"] or e["date"] >= "1990" for e in evs)


# --- the collection, end to end, on a fake server ------------------------------------------
class Fake(http.server.ThreadingHTTPServer):
    def __init__(self) -> None:
        super().__init__(("127.0.0.1", 0), Handler)
        self.rows = rows()
        self.boamp = json.loads((NATIONAL / "boamp-api.json").read_text("utf-8"))["results"]
        self.communes = json.loads((NATIONAL / "communes.json").read_text("utf-8"))
        self.refuse_boamp = False
        self.asked: list[str] = []

    @property
    def base(self) -> str:
        return f"http://127.0.0.1:{self.server_address[1]}"


def tabular(rows: list[dict], q: dict[str, str]) -> dict:
    out = rows
    for k, v in q.items():
        col, _, op = k.partition("__")
        if op == "contains":
            out = [r for r in out if v.lower() in str(r.get(col) or "").lower()]
        elif op == "in":
            out = [r for r in out if str(r.get(col)) in v.split(",")]
    size, page = int(q.get("page_size", 20)), int(q.get("page", 1))
    cols = q.get("columns", "").split(",")
    data = [{c: r.get(c) for c in cols} for r in out[(page - 1) * size : page * size]]
    return {"data": data, "meta": {"page": page, "page_size": size, "total": len(out)}}


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802
        srv: Fake = self.server  # type: ignore[assignment]
        url = urllib.parse.urlsplit(self.path)
        q = dict(urllib.parse.parse_qsl(url.query))
        srv.asked.append(url.path)
        status, body = 200, None
        if url.path == "/robots.txt":
            status, body = 200, "User-agent: *\nDisallow: /resources\n"
        elif url.path == "/decp-dataset":
            body = {"resources": [
                {"title": "decp.parquet", "id": "pq", "url": f"{srv.base}/resources/decp.parquet",
                 "last_modified": "2026-10-29T05:28:00"},
                {"title": "decp.csv", "id": "csv1", "url": f"{srv.base}/resources/decp.csv",
                 "last_modified": "2026-10-26T05:20:00"}]}  # fmt: skip
        elif url.path == "/tabular/csv1/data/":
            body = tabular(srv.rows, q)
        elif url.path == "/boamp":
            if srv.refuse_boamp:
                status, body = 403, "forbidden"
            else:
                start, end = re.findall(r"date'(\d{4}-\d{2}-\d{2})'", q["where"])
                hits = [r for r in srv.boamp if start <= r["dateparution"] < end]
                off, lim = int(q["offset"]), int(q["limit"])
                body = {"total_count": len(hits), "results": hits[off : off + lim]}
        elif url.path == "/communes":
            body = [{"code": k, "nom": c["nom"], "codeDepartement": c["dep"],
                     "population": c["pop"], "codeEpci": c["epci"], "siren": c["siren"]}
                    for k, c in srv.communes["communes"].items()]  # fmt: skip
        elif url.path == "/epcis":
            body = [{"code": k, "nom": n} for k, n in srv.communes["epcis"].items()]
        elif url.path == "/departements":
            body = [{"code": k, "nom": n} for k, n in srv.communes["departements"].items()]
        elif url.path == "/sirene-dataset":
            title = "Sirene : Fichier StockUniteLegale - 01"
            body = {"data": [{"format": "parquet", "title": title,
                              "url": f"{srv.base}/resources/stock.parquet",
                              "last_modified": "2026-10-01"}]}  # fmt: skip
        elif url.path == "/search":
            s = q["q"]
            nj = "1000" if s == "999999998" else "5710"
            body = {"results": [{"siren": s, "nature_juridique": nj, "nom_raison_sociale":
                                 f"ENTREPRISE {s}", "etat_administratif": "A"}]}  # fmt: skip
        else:
            status, body = 404, "not found"
        raw = (body if isinstance(body, str) else json.dumps(body)).encode()
        self.send_response(status)
        self.send_header(
            "Content-Type", "text/plain" if isinstance(body, str) else "application/json"
        )
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def log_message(self, *args: object) -> None:
        pass


@pytest.fixture
def server(monkeypatch) -> Iterator[Fake]:
    s = Fake()
    t = threading.Thread(target=s.serve_forever, daemon=True)
    t.start()
    conf = fetch.rules()
    conf["hosts"]["default"]["interval_s"] = 0
    conf["retries"].update(attempts=2, first_wait_s=0, timeout_s=10)
    b = s.base
    src = conf["sources"]
    src["decp"].update(dataset=f"{b}/decp-dataset", tabular=f"{b}/tabular/{{resource}}/data/")
    src["boamp"].update(api=f"{b}/boamp", first_year=2017)
    src["sirene"].update(dataset=f"{b}/sirene-dataset", api=f"{b}/search")
    src["communes"].update(communes=f"{b}/communes", epcis=f"{b}/epcis",
                           departements=f"{b}/departements")  # fmt: skip
    monkeypatch.setattr(fetch, "rules", lambda path=None: conf)
    monkeypatch.setenv(fetch.CONTACT_ENV, "https://example.org/contact")
    yield s
    s.shutdown()
    s.server_close()


def collect(root: Path, **kw) -> dict:
    return collecter.run(root, departements={"69"}, today=date(2017, 12, 31), **kw)


def test_the_collection_then_construire_on_the_pilot(server, tmp_path):
    summary = collect(tmp_path)
    nat = tmp_path / "national"
    assert summary["decp"]["mode"] == "tabulaire" and summary["decp"]["contrats"] > 238
    assert summary["boamp"]["avis"] == 1  # the call for tenders of 2017, read
    assert summary["communes"]["communes"] == 276
    assert sorted(p.name for p in nat.iterdir()) == [
        "boamp.json", "boamp.jsonl.gz", "communes.json", "decp.json", "decp.jsonl.gz",
        "sirene.json"]  # fmt: skip
    # the Parquet's path is forbidden by robots.txt: never asked, the reason kept
    assert "/resources/decp.parquet" not in server.asked
    assert "robots.txt interdit" in fetch.Fetcher("decp", tmp_path).state()["note_parquet"]
    sir = json.loads((nat / "sirene.json").read_text("utf-8"))
    assert sir["mode"] == "api" and sir["unites"][SERFIM]["nom"] == f"ENTREPRISE {SERFIM}"
    # then the build, offline, merged with the pilot
    importer.run(FIXTURE, tmp_path)
    built = construire.main(tmp_path, sans_corrections=True)
    assert built["fusion"]["remplaces"] >= 238
    site = tmp_path / "site"
    mions = json.loads((site / "commune" / f"{MIONS}.json").read_text("utf-8"))
    assert mions["stats"]["communes"][MIONS]["montant"] == 415_000
    notice = [e for e in mions["evenements"] if e["id"] == "17-164514"]
    assert notice and notice[0]["origine"] == "boamp"
    cov = json.loads((site / "couverture.json").read_text("utf-8"))
    [contrats] = [s for s in cov["sources"] if s["id"] == "contrats"]
    assert contrats["perimetre"] == "69" and contrats["collecte_le"] == "2017-12-31"
    # the summary's sentence: the Rhône's collection, its decrees, the pilot's subsidies
    assert cov["resume"][0] == {"familles": ["contrats", "avis", "arretes"], "zone": ["69"]}


def test_the_coverage_in_one_sentence_family_by_family():
    """« Contrats : toute la France. Avis et subventions : (the pilot). Arrêtés : Rhône. »"""
    src = [
        {"id": "contrats", "perimetre": "france", "documents": 9},
        {"id": "avis", "perimetre": "pilote", "documents": 4},
        {"id": "subventions_region_idf", "perimetre": "pilote", "documents": 2},
        {"id": "subventions_etat_13", "perimetre": "pilote", "documents": 0},
        {"id": "arretes_69", "perimetre": "pilote", "documents": 7},
    ]
    deps = {"69": {"etat": "collecte"}, "75": {"etat": "non_collecte"}}
    assert couverture.resume(src, deps) == [
        {"familles": ["contrats"], "zone": "france"},
        {"familles": ["avis", "subventions"], "zone": "pilote"},
        {"familles": ["arretes"], "zone": ["69"]},
    ]
    # the notices collected for all of France too: one sentence for both; no decree, no family
    src[1]["perimetre"] = "france"
    assert couverture.resume(src[:2], {})[0] == {"familles": ["contrats", "avis"], "zone": "france"}
    assert couverture.resume(src, {"69": {"etat": "non_collecte"}})[-1]["familles"] == [
        "subventions"
    ]


def test_a_refused_source_leaves_the_previous_outputs_and_resumes(server, tmp_path):
    collect(tmp_path)
    nat = tmp_path / "national"
    before = {p.name: p.read_bytes() for p in nat.iterdir() if p.is_file()}
    server.refuse_boamp = True
    with pytest.raises(fetch.Blocked):
        collect(tmp_path)
    # nothing half-collected in place: the previous outputs, untouched
    assert {p.name: p.read_bytes() for p in nat.iterdir() if p.is_file()} == before
    st = fetch.Fetcher("boamp", tmp_path).state()
    assert st["statut"] == "bloque" and st["raison"] == "refus HTTP 403"
    server.refuse_boamp = False
    again = collect(tmp_path, resume=True)
    assert again["boamp"]["avis"] == 1
    assert fetch.Fetcher("boamp", tmp_path).state()["statut"] == "termine"


def test_no_contact_no_collection(tmp_path, monkeypatch):
    monkeypatch.delenv(fetch.CONTACT_ENV, raising=False)
    with pytest.raises(fetch.NoContact):
        collecter.run(tmp_path, sources=("communes",))
    assert not (tmp_path / "national" / "communes.json").exists()
