"""« Carte et drones »: a commune's slots of flight and its acts whose zone was not deduced
(drones.py, the commune file's `drones` key), on the frozen extract and on a synthetic case."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

import pytest

from lacarte_registre import construire, drones, importer

FIXTURE = Path(__file__).parent / "fixtures" / "registre"
MIONS, LYON = "69283", "69123"
DRONES_6, DRONES_3 = "69-2026-03-06-00003", "69-2026-10-15-00005"
LYON_ACT = "69-2026-10-02-00002"  # placed in Lyon by its zone
NO_ZONE = "75-2025-06-19-00003"  # a drone act of the police prefecture, no zone drawn


def read(site: Path, rel: str) -> dict:
    return json.loads((site / rel).read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def built(tmp_path_factory) -> Path:
    root = tmp_path_factory.mktemp("registre")
    importer.run(FIXTURE, root)
    construire.main(root, sans_corrections=True)
    return root / "site"


# --- the extract: its acts have no periods and its zones no sites --------------------------------


def test_mions_two_shared_drone_acts_deduced_but_no_slot_read(built):
    f = read(built, f"commune/{MIONS}.json")
    acts = {a["acte"] for a in f["zones"]["autorisations"]}
    assert acts == {DRONES_6, DRONES_3}
    # both have a zone drawn (indicatif, relu): not listed as non-deduced; the extract keeps no
    # period, so there is no slot to place on the frieze
    assert f["drones"] == {"creneaux": [], "non_deduits": []}


def test_every_commune_file_has_its_drones(built):
    for path in (built / "commune").glob("*.json"):
        d = read(built, f"commune/{path.name}")["drones"]
        assert set(d) == {"creneaux", "non_deduits"}
        assert d["creneaux"] == []  # no period in the extract
        assert NO_ZONE not in {r["acte"] for r in d["non_deduits"]}


def test_the_police_prefecture_act_without_a_zone_is_listed_not_drawn(built):
    events = read(built, "recherche.json")["evenements"]
    rows = {r["acte"]: r for r in drones.non_deduits(events)}
    r = rows[NO_ZONE]
    assert r["kind"] == "drone" and r["date"] == "2025-06-19"
    assert set(r["raisons"]) == {"zone_non_deduite", "commune_introuvable"}
    assert r["url"].startswith("https://") and r["ref"]
    # it names no commune: no commune's page lists or draws it
    assert all(e.get("insee") is None for e in events if e["id"] == NO_ZONE)


def test_finalite_is_one_line_without_dans_le_cadre():
    assert drones.finalite("dans le cadre du  maintien\nde l'ordre") == "maintien de l'ordre"
    assert drones.finalite("Dans le cadre d'une manifestation") == "une manifestation"
    assert drones.finalite("") is None and drones.finalite(None) is None


# --- SYNTHETIC: the extract imported, then periods, sites and a zone under review added here -----
# Nothing below is a real act's period or site: the extract has none (its AUTORISATIONS keep no
# `periodes`, its ZONES no outline, SITES is absent). The case freezes the grouping rule.

S6, SL = "s-synthetique-6", "s-synthetique-lyon"


def ms(day: str, hour: int) -> int:
    t = datetime.fromisoformat(f"{day}T{hour:02d}:00").replace(tzinfo=UTC)
    return int(t.timestamp() * 1000)


P1 = {"t0": ms("2026-01-10", 8), "t1": ms("2026-01-10", 12), "heures": 4, "heures_sures": True}
P2 = {"t0": ms("2026-02-01", 9), "t1": ms("2026-02-03", 9), "heures": None, "heures_sures": False}
P3 = {"t0": ms("2026-03-01", 6), "t1": ms("2026-03-01", 18), "heures": 6, "heures_sures": False}
P4 = {"t0": ms("2026-04-02", 20), "t1": ms("2026-04-02", 22), "heures": 2, "heures_sures": True}
P5 = {"t0": ms("2026-05-01", 8), "t1": ms("2026-05-01", 20), "heures": 12, "heures_sures": True}


@pytest.fixture(scope="module")
def synthetic(tmp_path_factory) -> Path:
    root = tmp_path_factory.mktemp("registre-synthetique")
    importer.run(FIXTURE, root)
    pilote = root / "pilote"

    def edit(name: str, change) -> None:
        path = pilote / f"{name}.json"
        value = json.loads(path.read_text(encoding="utf-8")) if path.exists() else []
        path.write_text(json.dumps(change(value)), encoding="utf-8")

    def autorisations(auts: list[dict]) -> list[dict]:
        extra = {
            DRONES_6: {
                "periodes": [P3, P1, P2],
                "service": "Gendarmerie nationale",
                "finalite": "dans le cadre de la  sécurisation\nd'un événement",
                "url": "https://example.invalid/synthetique-6.pdf",
            },
            DRONES_3: {"periodes": [P1, P4], "service": "Police nationale", "finalite": None},
            LYON_ACT: {"periodes": [P5], "service": "Police nationale"},
        }
        return [{**a, **extra.get(a["acte"], {})} for a in auts]

    def zones(zs: list[dict]) -> list[dict]:
        site = {DRONES_6: S6, DRONES_3: S6, LYON_ACT: SL}  # both Mions acts over one site
        out = [{**z, "site": site[z["acte"]]} for z in zs]
        # the Lyon act's only zone under review: not deduced
        return [{**z, "statut": "relecture"} if z["acte"] == LYON_ACT else z for z in out]

    edit("AUTORISATIONS", autorisations)
    edit("ZONES", zones)
    edit(
        "SITES",
        lambda _: [
            {"id": S6, "kind": "drone", "parts": {MIONS: {}, "69288": {}}},
            {"id": SL, "kind": "drone", "parts": {LYON: {}}},
        ],
    )
    construire.main(root, sans_corrections=True)
    return root / "site"


def test_synthetic_slots_are_grouped_by_period_sites_and_kind(synthetic):
    slots = read(synthetic, f"commune/{MIONS}.json")["drones"]["creneaux"]
    # five periods over two acts, P1 in both: four slots, by start
    assert [(s["t0"], s["t1"]) for s in slots] == [(p["t0"], p["t1"]) for p in (P1, P2, P3, P4)]
    one = slots[0]
    assert one["actes"] == [DRONES_6, DRONES_3]  # the same flights, authorised twice
    assert one["sites"] == [S6] and one["kind"] == "drone"
    # the first act read gives the slot its service, purpose and link
    assert one["service"] == "Gendarmerie nationale"
    assert one["finalite"] == "sécurisation d'un événement"
    assert one["url"] == "https://example.invalid/synthetique-6.pdf"
    # zones indicatif (DRONES_6) and relu (DRONES_3): indicatif; DRONES_3 alone: relu
    assert [s["statut"] for s in slots] == ["indicatif", "indicatif", "indicatif", "relu"]
    # the act's own url when the authorisation gives none
    assert slots[3]["url"] and slots[3]["finalite"] is None


def test_synthetic_hours_read_or_horaires_non_precises(synthetic):
    slots = read(synthetic, f"commune/{MIONS}.json")["drones"]["creneaux"]
    # P1 and P4 state their hours; P2 states none; P3 has hours the act does not state for sure
    assert [s["heures"] for s in slots] == [4, None, None, 2]


def test_synthetic_a_zone_under_review_is_not_deduced(synthetic):
    f = read(synthetic, f"commune/{LYON}.json")
    assert f["drones"]["creneaux"] == []  # its period is never drawn
    [row] = [r for r in f["drones"]["non_deduits"] if r["acte"] == LYON_ACT]
    assert row["raisons"] == ["zone_non_deduite"] and row["kind"] == "drone"
    assert row["url"].startswith("https://") and row["date"] == "2026-10-02"


def test_synthetic_a_site_outside_the_commune_is_not_its(synthetic):
    # 69288 shares DRONES_6 (and its site); 69290 shares DRONES_3, whose site is not cut for it
    s88 = read(synthetic, "commune/69288.json")["drones"]["creneaux"]
    assert {tuple(s["sites"]) for s in s88} == {(S6,)}
    s90 = read(synthetic, "commune/69290.json")["drones"]["creneaux"]
    assert s90 and all(s["sites"] == [] for s in s90)
