"""Every name leads to its record when the record exists (lot R3 § 5), on the frozen extract:
each name served that has a record carries its reference, no reference leads to a record that
is not written; and the rule for a name read in a free text, on cases of its own."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from lacarte_registre import construire, importer, refs
from lacarte_registre.regles import EI

FIXTURE = Path(__file__).parent / "fixtures" / "registre"
KINDS = {"commune": "commune", "departement": "departement", "acheteur": "acheteur",
         "entreprise": "entreprise", "contrat": "document"}  # fmt: skip


@pytest.fixture(scope="module")
def built(tmp_path_factory) -> tuple[Path, dict]:
    root = tmp_path_factory.mktemp("registre")
    importer.run(FIXTURE, root)
    summary = construire.main(root, sans_corrections=True)
    return root / "site", summary


def record(site: Path, ref: str) -> Path:
    kind, key = ref.split("/", 1)
    return site / KINDS[kind] / f"{key}.json"


def walk(v, path=""):
    """Every reference in a file: (where, ref)."""
    if isinstance(v, dict):
        for k, x in v.items():
            if k in ("ref", "epci_ref", "dep_ref") or (k.endswith("_ref") and isinstance(x, str)):
                if x is not None:
                    yield f"{path}.{k}", x
            elif k.endswith("_refs") and isinstance(x, list):
                yield from ((f"{path}.{k}", r) for r in x if r)
            else:
                yield from walk(x, f"{path}.{k}")
    elif isinstance(v, list):
        for i, x in enumerate(v):
            yield from walk(x, f"{path}[{i}]")


def served(site: Path) -> list[Path]:
    return [p for p in site.rglob("*.json") if p.parent.name != "carte"]


def test_no_reference_leads_to_a_missing_record(built):
    site, _ = built
    seen = 0
    for p in served(site):
        data = json.loads(p.read_text(encoding="utf-8"))
        for where, ref in walk(data):
            if where.endswith(".url") or "/" not in ref:
                continue
            assert ref.split("/", 1)[0] in KINDS, (p.name, where, ref)
            assert record(site, ref).is_file(), (p.relative_to(site), where, ref)
            seen += 1
    assert seen > 5000


def test_every_name_with_a_record_carries_its_reference(built):
    site, _ = built
    for p in served(site):
        data = json.loads(p.read_text(encoding="utf-8"))
        for kind, dico in (("entreprise", "entreprises"), ("acheteur", "acheteurs"),
                           ("commune", "communes")):  # fmt: skip
            for key, entry in (data.get(dico) or {}).items():
                if not isinstance(entry, dict):
                    continue
                exists = key != EI and record(site, f"{kind}/{key}").is_file()
                assert (entry.get("ref") == f"{kind}/{key}") is exists, (p.name, dico, key)
        for e in data.get("evenements") or []:
            if e.get("insee") and record(site, f"commune/{e['insee']}").is_file():
                assert e["commune_ref"] == f"commune/{e['insee']}"
            for s, r in zip(
                e.get("entreprises") or [], e.get("entreprises_refs") or [], strict=True
            ):
                assert (r is None) is (s == EI or not record(site, f"entreprise/{s}").is_file())
    # a sole trader never has one
    lyon = json.loads((site / "commune" / "69123.json").read_text(encoding="utf-8"))
    assert "ref" not in lyon["entreprises"].get(EI, {})


def test_the_build_reports_the_names_without_a_reference(built):
    _, summary = built
    missing = summary["sans_reference"]
    assert all("/" in k and n > 0 for k, n in missing.items())
    assert "commune/commune_inconnue" in missing  # the drone act of the police prefecture


@pytest.fixture
def lecteur():
    class Reg:
        communes = {
            "69283": {"nom": "Mions", "dep": "69"},
            "69123": {"nom": "Lyon", "dep": "69"},
            "69001": {"nom": "Saint-Didier", "dep": "69"},
            "69002": {"nom": "Saint-Didier", "dep": "69"},  # homonyms: never linked
            "69003": {"nom": "Y", "dep": "69"},  # too short
            "13055": {"nom": "Marseille", "dep": "13"},
            "69004": {"nom": "Corbas", "dep": "69"},  # no document, no record
        }

    f = refs.Fiches(communes={"69283", "69123", "69001", "69002", "69003", "13055"},
                    entreprises={"431903954"}, acheteurs={"216902833"})  # fmt: skip
    return refs.Lecteur(Reg(), f)


def linked(lecteur, text, dep="69"):
    return [(text[m["debut"] : m["fin"]], m["ref"]) for m in lecteur.mentions(text, dep)]


def test_a_commune_s_exact_and_unique_name_in_its_departement(lecteur):
    assert linked(lecteur, "Vidéoprotection de MIONS et de Lyon") == [
        ("MIONS", "commune/69283"), ("Lyon", "commune/69123")]  # fmt: skip
    # a homonym in the département, a name too short, a commune without a record: text
    assert linked(lecteur, "Saint-Didier, Y, Corbas") == []
    # in another département's document, Mions is not this one
    assert linked(lecteur, "Marseille et Mions", dep="13") == [("Marseille", "commune/13055")]
    # whole words only
    assert linked(lecteur, "Lyonnais") == []


def test_a_siren_or_an_insee_code_written_as_such(lecteur):
    assert linked(lecteur, "titulaire SIRET 431 903 954 00003") == [
        ("431 903 954 00003", "entreprise/431903954")]  # fmt: skip
    assert linked(lecteur, "acheteur 216902833") == [("216902833", "acheteur/216902833")]
    assert linked(lecteur, "code INSEE : 69283") == [("69283", "commune/69283")]
    # a bare five-digit number is a postal code more often than not
    assert linked(lecteur, "69780 Mions") == [("Mions", "commune/69283")]
    # a number that fails Luhn's check is no SIREN
    assert linked(lecteur, "lot 431903955") == []
