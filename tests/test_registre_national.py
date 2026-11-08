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
import threading
import urllib.parse
from collections import Counter
from collections.abc import Iterator
from datetime import date
from pathlib import Path

import pytest

from lacarte_registre import (
    boamp,
    collecter,
    construire,
    couverture,
    decp,
    fetch,
    importer,
    national,
    selection,
    sirene,
)

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
    data[2]["dateNotification"] = "2021-02-30"
    (tmp_path / "national").mkdir()
    decp.write(tmp_path / "national" / "decp.jsonl.gz", decp.contracts(data))
    (tmp_path / "national" / "communes.json").write_bytes((NATIONAL / "communes.json").read_bytes())
    evs = national.assembler(tmp_path)["evenements"]
    assert len(evs) >= 238 and any(not e["date"] for e in evs)
    assert all(not e["date"] or e["date"] >= "1990" for e in evs)


PENITENTIAIRE, PREFECTURE_REGION = "176901205", "176900009"
ESP = "176\u202f900\u202f009"  # its SIREN as the build writes it, by threes


def test_a_buyer_the_decp_do_not_name_is_named_by_sirene_else_flagged(tmp_path):
    """The DECP leave some buyers' name empty (130001902, 25 contracts, on 2026-10-31): SIRENE's
    name for a legal person then; with none, no name and `nom_inconnu` (never its SIREN as its
    name), and the build counts them (SYNTHETIC: two buyers' names blanked)."""
    data = rows()
    for r in data:
        if r["acheteur_id"][:9] in (PENITENTIAIRE, PREFECTURE_REGION):
            r["acheteur_nom"] = ""
    nat = tmp_path / "national"
    nat.mkdir()
    decp.write(nat / "decp.jsonl.gz", decp.contracts(data))
    (nat / "communes.json").write_bytes((NATIONAL / "communes.json").read_bytes())
    unit = sirene.unite("7172", None, "84.23Z", True, "DIRECTION INTERREGIONALE DES SERVICES "
                        "PENITENTIAIRES DE LYON")  # fmt: skip
    (nat / "sirene.json").write_text(json.dumps({"version": None, "mode": "api", "unites": {
        PENITENTIAIRE: unit, PREFECTURE_REGION: {"introuvable": True}}}), "utf-8")  # fmt: skip
    buyers = national.assembler(tmp_path)["ACHETEURS"]
    assert buyers[PENITENTIAIRE]["nom"] == unit["nom"]
    assert "nom_inconnu" not in buyers[PENITENTIAIRE]
    assert buyers[PREFECTURE_REGION]["nom"] == ""
    assert buyers[PREFECTURE_REGION]["nom_inconnu"] is True
    # a possible natural person is never named, even as a buyer
    assert national._buyer_name(Counter(), "999999998", national.Reference({}, {}, {}),
                                sirene.unite("1000", None, None, True, "DUPONT")) == ""  # fmt: skip
    # the build: the flag in the dictionaries, the share's name, the summary's count
    importer.run(FIXTURE, tmp_path)
    # the pilot names it (its own list of buyers wins the merge): not here
    path = tmp_path / "pilote" / "ACHETEURS.json"
    pilot_buyers = json.loads(path.read_text("utf-8"))
    del pilot_buyers[PREFECTURE_REGION]
    path.write_text(json.dumps(pilot_buyers, ensure_ascii=False), "utf-8")
    summary = construire.run(tmp_path)
    assert summary["acheteurs_sans_nom"] == 1
    site = tmp_path / "site"
    f = json.loads((site / "acheteur" / f"{PREFECTURE_REGION}.json").read_text("utf-8"))
    assert f["acheteur"]["nom_inconnu"] is True
    assert f["partage"]["titre"] == f"Un acheteur public (SIREN {ESP})"
    assert f["partage"]["texte"].startswith(f"Un acheteur public (SIREN {ESP}) : 14 contrats")
    doc = next(json.loads(p.read_text("utf-8")) for p in (site / "document").glob("*.json")
               if json.loads(p.read_text("utf-8"))["affaire"].get("acheteur_siren")
               == PREFECTURE_REGION)  # fmt: skip
    assert doc["acheteurs"][PREFECTURE_REGION]["nom_inconnu"] is True
    assert f", acheteur SIREN {ESP}" in doc["partage"]["texte"]


# --- the collection, end to end, on a fake server ------------------------------------------
# Mions' box as the API Découpage administratif gives it (`fields=bbox`: a polygon, 6 decimals)
MIONS_BBOX = {"type": "Polygon", "coordinates": [[
    [4.936126, 45.630214], [4.991243, 45.630214], [4.991243, 45.674681],
    [4.936126, 45.674681], [4.936126, 45.630214]]]}  # fmt: skip


class Fake(http.server.ThreadingHTTPServer):
    def __init__(self) -> None:
        super().__init__(("127.0.0.1", 0), Handler)
        self.rows = rows()
        self.boamp = json.loads((NATIONAL / "boamp-api.json").read_text("utf-8"))["results"]
        self.communes = json.loads((NATIONAL / "communes.json").read_text("utf-8"))
        self.refuse_decp = False
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
                {"title": "decp.csv.gz", "id": "csv1", "url": f"{srv.base}/resources/decp.csv",
                 "last_modified": "2026-10-26T05:20:00"}]}  # fmt: skip
        elif url.path == "/tabular/csv1/data/":
            status, body = (403, "forbidden") if srv.refuse_decp else (200, tabular(srv.rows, q))
        elif url.path == "/communes":
            body = [{"code": k, "nom": c["nom"], "codeDepartement": c["dep"],
                     "population": c["pop"], "codeEpci": c["epci"], "siren": c["siren"],
                     **({"bbox": MIONS_BBOX} if k == MIONS else {})}
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
    src["sirene"].update(dataset=f"{b}/sirene-dataset", api=f"{b}/search")
    src["communes"].update(communes=f"{b}/communes", epcis=f"{b}/epcis",
                           departements=f"{b}/departements")  # fmt: skip
    monkeypatch.setattr(fetch, "rules", lambda path=None: conf)
    monkeypatch.setenv(fetch.CONTACT_ENV, "https://example.org/contact")
    yield s
    s.shutdown()
    s.server_close()


def collect(root: Path, **kw) -> dict:
    # the notices collected before the DILA's API was given up: kept, never asked again
    nat = root / "national"
    if not (nat / "boamp.jsonl.gz").is_file():
        nat.mkdir(parents=True, exist_ok=True)
        recs = json.loads((NATIONAL / "boamp-api.json").read_text("utf-8"))["results"]
        hits = [boamp.clean(r) for r in recs if r["dateparution"].startswith("2017")]
        boamp.write(nat / "boamp.jsonl.gz", boamp.notices_of(hits))
        (nat / "boamp.json").write_text(
            json.dumps(
                {"source": "boamp", "avis": 1, "departements": ["69"], "collecte_le": "2017-12-31"}
            ),
            "utf-8",
        )
    return collecter.run(root, departements={"69"}, today=date(2017, 12, 31), **kw)


def test_the_collection_then_construire_on_the_pilot(server, tmp_path):
    summary = collect(tmp_path)
    nat = tmp_path / "national"
    assert summary["decp"]["mode"] == "tabulaire" and summary["decp"]["contrats"] > 238
    assert "boamp" not in summary  # the DILA's API: never asked again
    assert "/boamp" not in server.asked
    assert summary["communes"]["communes"] == 276
    assert sorted(p.name for p in nat.iterdir()) == [
        "boamp.json", "boamp.jsonl.gz", "communes.json", "decp.json", "decp.jsonl.gz",
        "sirene.json"]  # fmt: skip
    # the Parquet's path is forbidden by robots.txt: never asked, the reason kept
    assert "/resources/decp.parquet" not in server.asked
    assert "robots.txt interdit" in fetch.Fetcher("decp", tmp_path).state()["note_parquet"]
    sir = json.loads((nat / "sirene.json").read_text("utf-8"))
    assert sir["mode"] == "api" and sir["unites"][SERFIM]["nom"] == f"ENTREPRISE {SERFIM}"
    # the buyers are asked too: the contracts' and the notices' (a buyer the DECP do not name)
    asked = {r["acheteur_id"][:9] for r in server.rows}
    asked |= {s[:9] for n in boamp.load(nat / "boamp.jsonl.gz") for s in n["sirets"]}
    assert asked and asked <= set(sir["unites"])
    # then the build, offline, merged with the pilot
    importer.run(FIXTURE, tmp_path)
    built = construire.main(tmp_path, sans_corrections=True)
    assert built["fusion"]["remplaces"] >= 238
    site = tmp_path / "site"
    mions = json.loads((site / "commune" / f"{MIONS}.json").read_text("utf-8"))
    assert mions["stats"]["communes"][MIONS]["montant"] == 415_000
    # its box, as the API's polygon gave it (the drone view frames it); a commune without one
    # has none, and the box stays out of the other communes' dictionary
    assert mions["commune"]["bbox"] == [4.93613, 45.63021, 4.99124, 45.67468]
    other = next(p for p in (site / "commune").glob("*.json") if p.stem != MIONS)
    assert "bbox" not in json.loads(other.read_text("utf-8"))["commune"]
    assert all("bbox" not in c for c in mions["communes"].values())
    notice = [e for e in mions["evenements"] if e["id"] == "17-164514"]
    assert notice and notice[0]["origine"] == "boamp"
    cov = json.loads((site / "couverture.json").read_text("utf-8"))
    [contrats] = [s for s in cov["sources"] if s["id"] == "contrats"]
    assert contrats["perimetre"] == "69" and contrats["collecte_le"] == "2017-12-31"
    # the summary's sentence: the Rhône's collection, its decrees, the pilot's subsidies
    first = cov["resume"][0]
    assert (first["familles"], first["zone"]) == (["contrats", "avis", "arretes"], ["69"])
    # and the police prefecture's drone act the pilot's exploration read in Paris
    assert first["arretes_hors_collecte"]["provenances"] == {"exploration": 1}


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
    server.refuse_decp = True
    with pytest.raises(fetch.Blocked):
        collect(tmp_path)
    # nothing half-collected in place: the previous outputs, untouched
    assert {p.name: p.read_bytes() for p in nat.iterdir() if p.is_file()} == before
    st = fetch.Fetcher("decp", tmp_path).state()
    assert st["statut"] == "bloque" and st["raison"] == "refus HTTP 403"
    server.refuse_decp = False
    again = collect(tmp_path, resume=True)
    assert again["decp"]["contrats"] > 238
    assert fetch.Fetcher("decp", tmp_path).state()["statut"] == "termine"


def test_no_contact_no_collection(tmp_path, monkeypatch):
    monkeypatch.delenv(fetch.CONTACT_ENV, raising=False)
    with pytest.raises(fetch.NoContact):
        collecter.run(tmp_path, sources=("communes",))
    assert not (tmp_path / "national" / "communes.json").exists()


def test_an_eforms_result_serves_its_tenders_procedure_and_duration(tmp_path):
    """26-5489's 2 tenders were read and not served (R5.2 §3): a result says the tenders it
    received, its lots' when it has several, its procedure and its duration."""
    import copy

    from test_collecte_dila import LOTS

    from lacarte_collecte import dila

    two = dila.notice(LOTS, {})
    one = copy.deepcopy(two)
    one["idweb"], one["eforms"]["offres"] = "26-0001", 2
    (tmp_path / "national").mkdir()
    decp.write(tmp_path / "national" / "decp.jsonl.gz", decp.contracts(rows()))
    (tmp_path / "national" / "communes.json").write_bytes((NATIONAL / "communes.json").read_bytes())
    boamp.write(tmp_path / "national" / "boamp.jsonl.gz", [one, two])
    evs = {e["id"]: e for e in national.assembler(tmp_path)["evenements"]}
    a, b = evs["26-0001"], evs[two["idweb"]]
    assert a["t"] == "resultat" and a["offres"] == 2 and "resultats_lots" not in a
    assert a["procedure"] == "open" and a["duree_mois"] == 24.0
    assert "offres" not in b
    assert [(r["lot"], r["offres"]) for r in b["resultats_lots"]] == [
        ("LOT-0001", 2),
        ("LOT-0002", 1),
    ]


def test_an_increase_over_five_hundred_percent_is_a_probable_typing_error(tmp_path):
    """Sciez's 176 883 → 4 000 000 €: one of the two amounts is wrong, which we cannot tell;
    the affaire leaves the totals and each of its documents says so (Ju, 2026-11-07). A
    smaller increase, or a decrease, does not."""
    data = rows()
    base = {**data[0], "montant": 176883}
    data = [
        base,
        {**base, "modification_id": 1, "montant": 4_000_000, "dateNotification": "2026-10-20"},
    ]
    other = {**rows()[1]}
    data += [other, {**other, "modification_id": 1, "montant": other["montant"] * 5}]  # +400 %
    (tmp_path / "national").mkdir()
    decp.write(tmp_path / "national" / "decp.jsonl.gz", decp.contracts(data))
    (tmp_path / "national" / "communes.json").write_bytes((NATIONAL / "communes.json").read_bytes())
    nat = national.assembler(tmp_path)
    evs = [e for e in nat["evenements"] if e["affaire"] == base["uid"]]
    assert len(evs) == 2
    assert all(e["a_verifier"] == "erreur_saisie_probable" for e in evs)
    assert all(e["hors_totaux"] in ("a_verifier", "centrale") for e in evs)
    assert "hausse de 2 161 %" in nat["affaires"][base["uid"]]["montant_a_verifier"]
    assert not any(e.get("a_verifier") for e in nat["evenements"] if e["affaire"] == other["uid"])


@pytest.mark.parametrize(
    ("objet", "famille"),
    [
        ("Lot 8 - Travaux de réseaux de communication, d’équipements urbains, de vidéoprotection "
         "et de solutions de flexibilité électrique - Morbihan", "autres"),
        ("Modernisation des réseaux secs et vidéoprotection", "autres"),
        ("RESEAUX DE COMMUNICATION ET SOUS-SYSTEMES CONCOURANT A LA SURETE", "surete"),
        ("Extension du système de vidéo protection et de son réseau de communication", ""),
    ],
)  # fmt: skip
def test_a_mixed_contract_s_objet(objet, famille):
    """Urban works whose video is one part leave the totals; a video network alone does not."""
    import re

    from lacarte_registre import selection

    mix, ob = selection.rules()["mixte"], selection.plain(objet)
    got = (
        "autres"
        if re.search(mix["autres"], ob)
        else "surete"
        if re.search(mix["surete"], ob)
        else ""
    )
    assert got == famille


def test_a_mixed_contract_carries_its_family_counted_or_not(tmp_path):
    (tmp_path / "national").mkdir()
    decp.write(tmp_path / "national" / "decp.jsonl.gz", decp.contracts(rows()))
    (tmp_path / "national" / "communes.json").write_bytes((NATIONAL / "communes.json").read_bytes())
    ev = national.assembler(tmp_path)["evenements"]
    mixed = [e for e in ev if e.get("mixte")]
    assert mixed and {e["mixte"] for e in mixed} <= {"surete", "autres"}
    out = set(selection.rules()["mixte"]["hors_totaux"])
    for e in mixed:
        if e.get("hors_totaux") not in ("centrale", "a_verifier"):
            assert (e["hors_totaux"] == f"mixte_{e['mixte']}") == (e["mixte"] in out), e["id"]


def test_a_legal_persons_sirene_profile_is_served_never_a_sole_traders(tmp_path):
    nat = tmp_path / "national"
    nat.mkdir()
    decp.write(nat / "decp.jsonl.gz", decp.contracts(rows()))
    (nat / "communes.json").write_bytes((NATIONAL / "communes.json").read_bytes())
    firm, person = sorted(national.assembler(tmp_path)["entreprises"])[:2]
    prof = {"creation": "1958-01-01", "effectif": "32", "effectif_annee": "2024",
            "siege_departement": "80"}  # fmt: skip
    units = {
        firm: sirene.unite("5710", "GE", "43.21A", True, "ENTREPRISE", profil=prof),
        person: sirene.unite("1000", "PME", "43.21A", True, "DUPONT", profil=prof),
    }
    (nat / "sirene.json").write_text(json.dumps({"version": None, "mode": "api",
                                                 "unites": units}), "utf-8")  # fmt: skip
    ents = national.assembler(tmp_path)["entreprises"]
    assert {k: ents[firm][k] for k in ("categorie", "creation", "effectif", "effectif_annee",
                                       "siege_departement")} == {
        "categorie": "GE", "creation": 1958, "effectif": "250 à 499 salariés",
        "effectif_annee": "2024", "siege_departement": "80"}  # fmt: skip
    assert ents[person]["nom"] is None
    assert not {"categorie", "creation", "effectif", "siege_departement"} & set(ents[person])


def test_a_contract_carries_its_cpv_code(tmp_path):
    nat = tmp_path / "national"
    nat.mkdir()
    decp.write(nat / "decp.jsonl.gz", decp.contracts(rows()))
    (nat / "communes.json").write_bytes((NATIONAL / "communes.json").read_bytes())
    firsts = [e for e in national.assembler(tmp_path)["evenements"] if e["t"] == "attribution"]
    assert firsts and all(len(c) == 8 and c.isdigit() for e in firsts for c in e.get("cpv", []))
    assert sum("cpv" in e for e in firsts) > len(firsts) / 2
