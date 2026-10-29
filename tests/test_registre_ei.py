"""A sole trader in the register (DECISIONS 2026-10-29): a natural person, so no page, no link
and its SIREN nowhere in what the build serves — not in a file's name, not in a document, a
dictionary, a correction's source value, the search file or the rankings; its documents say
« entreprise individuelle, nom non publié » (the token regles.EI).

The CI extract holds no sole trader: two of its companies are made sole traders here, in a
copy of the imported pilot (SYNTHETIC, for this test only), as the pilot export gives them
(entrepreneur_individuel, the name masked); one of their contracts gets a correction that
names another company instead, so that the masked SIREN would also be the correction's
source value."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from lacarte_registre import construire, exporter, importer, regles

FIXTURE = Path(__file__).parent / "fixtures" / "registre"
SERFIM = "431903954"
# two companies of a single contract each in Lyon, made sole traders (synthetic)
EI_A, EI_B = "393040571", "508837564"
CONTRACT_A = "176901205000112569036_45110000~0"
CONTRACT_B = "176901205000112021151043296700_71000000~0"


@pytest.fixture(scope="module")
def site(tmp_path_factory) -> Path:
    root = tmp_path_factory.mktemp("registre")
    importer.run(FIXTURE, root)
    reg = root / "pilote" / "REG.json"
    data = json.loads(reg.read_text(encoding="utf-8"))
    for s in (EI_A, EI_B):
        data["entreprises"][s].update(entrepreneur_individuel=True, nom=None)
    reg.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    exporter.write(root / exporter.FILE, [{
        "id": "registre_reports:test-ei", "evenement": CONTRACT_B, "field": "entreprises",
        "value": [SERFIM], "source": "synthetic, for the tests", "rationale": "synthetic",
        "le": "2026-10-29",
    }])  # fmt: skip
    construire.run(root)
    return root / "site"


def read(site: Path, rel: str) -> dict:
    return json.loads((site / rel).read_text(encoding="utf-8"))


def test_no_served_file_holds_a_sole_trader_s_siren(site):
    files = [p for p in site.rglob("*") if p.is_file()]
    assert len(files) > 100
    for p in files:
        assert EI_A not in p.name and EI_B not in p.name, p
        text = p.read_text(encoding="utf-8")
        assert EI_A not in text and EI_B not in text, p.relative_to(site)
    assert not (site / "entreprise" / f"{EI_A}.json").exists()
    assert not (site / "entreprise" / f"{regles.EI}.json").exists()


def test_its_documents_say_a_sole_trader_whose_name_is_not_published(site):
    rech = read(site, "recherche.json")
    [a] = [e for e in rech["evenements"] if e["id"] == CONTRACT_A]
    assert a["entreprises"] == [regles.EI]
    assert rech["entreprises"][regles.EI] == {"nom": None, "entrepreneur_individuel": True}
    # the correction's source value, as published, is masked too
    [b] = [e for e in rech["evenements"] if e["id"] == CONTRACT_B]
    assert b["entreprises"] == [SERFIM]
    assert b["corrige"]["entreprises"] == {"source": [regles.EI], "le": "2026-10-29"}


def test_no_ranking_or_seller_list_counts_it(site):
    dep = read(site, "departement/69.json")
    assert regles.EI not in {o["siren"] for o in dep["stats"]["vendeurs"]}
    assert regles.EI not in dep["entreprises"]
    lyon = read(site, "commune/69123.json")
    assert regles.EI in lyon["entreprises"]  # the dictionary says what the token is
    assert lyon["entreprises"][regles.EI]["entrepreneur_individuel"] is True
