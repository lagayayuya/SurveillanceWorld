"""Every document's département in the COG form (departements.py): the recette of
2026-11-09 found « département 1 », « 6 », « 20A », « 97 » in the lists, pages not found."""

from __future__ import annotations

from lacarte_registre import departements

OFFICIELS = {"01", "06", "2A", "2B", "75", "974", "987"}


def test_a_code_is_written_as_the_cog_writes_it():
    assert departements.officiel("1") == "01" and departements.officiel(6) == "06"
    assert departements.officiel("20A") == "2A" and departements.officiel("20b") == "2B"
    assert departements.officiel("97", "97411") == "974"
    assert departements.officiel(None, "98735") == "987"
    assert departements.officiel(None, "2A004") == "2A"
    assert departements.officiel("75") == "75" and departements.officiel("") is None


def test_a_document_keeps_an_official_code_only():
    evs = [
        {"dep": "1"}, {"dep": "20A", "departements": ["20A", "2A", "6"]},
        {"dep": "97", "insee": "97411"}, {"dep": "99"}, {"dep": "75"}, {"dep": None},
    ]  # fmt: skip
    out = departements.normaliser(evs, OFFICIELS)
    assert [e["dep"] for e in evs] == ["01", "2A", "974", None, "75", None]
    assert evs[1]["departements"] == ["2A", "06"]
    assert out == {"corriges": 4, "ecartes": {"99": 1}}
