"""« Carte et drones »: a commune's slots of flight and its acts whose zone was not deduced
(drones.py, the commune file's `drones` key), on the frozen extract and on a synthetic case."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

import pytest
import yaml
from registre_docs import documents

from lacarte_registre import construire, drones, importer

ROOT = Path(__file__).resolve().parent.parent
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
    assert f["drones"]["creneaux"] == [] and f["drones"]["non_deduits"] == []
    # the pilot's acts have no recueil: in none of the three
    assert f["drones"]["publication"] == {"avant": 0, "jour_meme": 0, "apres": 0, "total": 0,
                                          "non_lus": 2, "deps": []}  # fmt: skip


def test_every_commune_file_has_its_drones(built):
    for path in (built / "commune").glob("*.json"):
        d = read(built, f"commune/{path.name}")["drones"]
        assert set(d) == {"creneaux", "non_deduits", "publication"}
        assert d["creneaux"] == []  # no period in the extract
        assert NO_ZONE not in {r["acte"] for r in d["non_deduits"]}


def test_the_police_prefecture_act_without_a_zone_is_listed_not_drawn(built):
    events = documents(built)
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


# --- a zone over the whole commune (rules/registre_drones.yaml, v2.1 B1) -------------------------


def _carre(x: float, y: float, d: float) -> dict:
    return {
        "type": "Polygon",
        "coordinates": [[[x, y], [x + d, y], [x + d, y + d], [x, y + d], [x, y]]],
    }


def test_a_zone_over_four_fifths_of_its_commune_is_the_whole_commune():
    commune = _carre(4.8, 45.7, 0.1)["coordinates"][0]
    part = yaml.safe_load((ROOT / "rules" / "registre_drones.yaml").read_text())["commune_entiere"]
    assert part["part"] == 0.8 and part["id"] == "rule:registre_drones@1:commune_entiere"

    def site(d: float) -> dict:
        return {"id": "s", "parts": {"69123": {"in": _carre(4.8, 45.7, d)}}}

    # shares of 100 %, 81 %, 64 % and 1 % of the commune's area
    got = [drones.commune_entiere(site(d), "69123", commune, 0.8) for d in (0.1, 0.09, 0.08, 0.01)]
    assert got == [True, True, False, False]
    # no outline, no way to tell; a site cut elsewhere, no part here
    assert drones.commune_entiere(site(0.1), "69123", None, 0.8) is False
    assert drones.commune_entiere(site(0.1), "69001", commune, 0.8) is False


def test_every_site_and_zone_says_whether_it_is_the_whole_commune(built):
    for path in (built / "commune").glob("*.json"):
        z = read(built, f"commune/{path.name}")["zones"]
        assert all(isinstance(s["commune_entiere"], bool) for s in z["sites"])
        assert all(isinstance(x["commune_entiere"], bool) for x in z["zones"])


# --- « Publiés avant le vol ? » (rule:registre_drones@1:publication) --------------------------


def _vol(i: str, publie: str | None, jours: list[str] | None) -> dict:
    e = {"id": i, "t": "arrete_drone", "publie": publie, "jours": jours}
    return {k: v for k, v in e.items() if v is not None}


def test_an_act_is_published_before_the_same_day_or_after_its_first_flight():
    events = [
        _vol("a", "2026-10-01", ["2026-10-03", "2026-10-02"]),  # before its first day, 02
        _vol("b", "2026-10-02", ["2026-10-02"]),
        _vol("c", "2026-10-05", ["2026-10-04", "2026-10-06"]),  # during: after its first day
        _vol("d", "2026-10-05", None),  # days not published
        _vol("e", None, ["2026-10-01"]),  # the pilot's: no recueil
        {"id": "f", "t": "arrete", "publie": "2026-10-01", "jours": ["2026-10-09"]},
    ]
    shared = {**events[0], "insee": "69259", "partage": ["69123"]}  # its other commune's copy
    assert drones.publication([*events, shared]) == {
        "avant": 1, "jour_meme": 1, "apres": 1, "total": 3, "non_lus": 2, "deps": []}  # fmt: skip


def test_a_pilot_act_counts_by_its_period_and_the_authorities_are_named():
    pilot = {"id": "69-p", "t": "arrete_drone", "dep": "69", "periode": "2025-11-14 au 2025-11-17",
             "publie": "2025-11-14"}  # fmt: skip
    paris = {**_vol("pp", "2026-10-01", ["2026-10-03"]), "autorite": "ppparis", "dep": "93"}
    marseille = {**_vol("13", "2026-10-04", ["2026-10-03"]), "autorite": "pref13", "dep": "13"}
    unread = {**_vol("33", "2026-10-04", None), "autorite": "pref33", "dep": "33"}
    out = drones.publication([pilot, paris, marseille, unread],
                             {"ppparis": "75", "pref13": "13", "pref33": "33"})  # fmt: skip
    assert out == {"avant": 1, "jour_meme": 1, "apres": 1, "total": 3, "non_lus": 1,
                   "deps": ["13", "69", "75"]}  # fmt: skip


def test_a_collected_drone_act_carries_its_recueils_day():
    from lacarte_registre import collecte

    act = {"id": "pref57:0123456789ab:12", "type": "drone", "sous_type": None, "titre": "Arrêté",
           "acte": "12", "champs": {"dates": ["2026-10-04"]}, "administration": "pref57",
           "recueil": "r", "recueil_nom": "Recueil spécial", "recueil_date": "2026-10-02",
           "url": "u", "gabarit": "numero", "commune": None, "insee": None}  # fmt: skip
    admin = {"code": "57", "genre": "departement", "nom": "Moselle"}
    e = collecte.act_event(act, admin, {"dates"}, None, None)
    assert e["publie"] == "2026-10-02" and e["jours"] == ["2026-10-04"]
    assert drones.publication([e])["avant"] == 1
    # its days not published in its département: counted in none
    e = collecte.act_event(act, admin, set(), None, None)
    assert "jours" not in e and drones.publication([e])["non_lus"] == 1


def test_the_home_counts_every_drone_act_of_france(built):
    pub = read(built, "index.json")["drones"]["publication"]
    assert set(pub) == {"avant", "jour_meme", "apres", "total", "non_lus", "deps"}
    assert pub["total"] == pub["avant"] + pub["jour_meme"] + pub["apres"]


def test_a_pilot_drone_act_takes_the_day_of_the_recueil_the_collection_read_it_in():
    from lacarte_registre import collecte

    pilot = [{"id": "69-2025-11-07-00001", "t": "arrete_drone", "periode": "2025-11-11"},
             {"id": "69-2025-11-07-00002", "t": "arrete_drone", "periode": "2025-11-12"},
             {"id": "69-2025-11-07-00003", "t": "arrete", "periode": ""}]  # fmt: skip
    acts = [{"id": "69-2025-11-07-00001", "recueil_date": "2025-11-10"},
            {"id": "69-2025-11-07-00003", "recueil_date": "2025-11-10"}]  # fmt: skip
    out = collecte.publies_pilote(pilot, acts)
    assert [e.get("publie") for e in out] == ["2025-11-10", None, None]
    assert "publie" not in pilot[0]  # the pilot's events are not changed


def test_a_drone_act_sorts_by_its_publication_not_its_first_flight():
    from lacarte_registre.regles import sort_key

    drone = {"t": "arrete_drone", "date": "2026-12-01", "publie": "2026-11-02"}
    contrat = {"t": "contrat", "date": "2026-11-05"}
    assert sort_key(drone) == "2026-11-02"
    assert sorted([drone, contrat], key=sort_key, reverse=True)[0] is contrat
    assert sort_key({"t": "arrete_drone", "date": "2026-12-01"}) == "2026-12-01"  # not read


def test_the_recents_sort_drone_acts_by_publication(built):
    from lacarte_registre.regles import sort_key

    recents = read(built, "index.json")["recents"]
    assert [sort_key(e) for e in recents] == sorted(map(sort_key, recents), reverse=True)


def test_a_helicopter_s_captation_is_served_apart_never_counted_as_a_drone():
    """rule:registre_drones@1:aeronef (Ju, 2026-11-09): the aircraft read on the title and
    article 1, then on the act's sentences naming one; a helicopter's act out of `dr`, the
    days and « publiés avant le vol », counted in `helico`; an act naming none stays a drone's."""
    import lacarte_registre as registre
    from lacarte_registre import collecte, comptes, lecture_drones, regles

    rules = registre.RULES
    assert lecture_drones.aeronef(["… caméras installées sur deux hélicoptères …"], rules) == (
        "helicoptere"
    )
    assert lecture_drones.aeronef(["… sur des aéronefs …", "aéronefs télé-pilotés"], rules) == (
        "drone"
    )
    assert lecture_drones.aeronef(["1 hélicoptère et trois drones"], rules) == "drone"
    assert lecture_drones.aeronef(["… sur des aéronefs …", ""], rules) == "non_lu"
    act = {"id": "ppparis:ab:2026-01165", "type": "drone", "sous_type": None, "acte": "2026-01165",
           "titre": "Arrêté n°2026-01165 autorisant la captation … caméras installées sur deux "
                    "hélicoptères", "champs": {"dates": ["2026-09-25"], "article_1": "Article 1er"},
           "administration": "ppparis", "recueil": "r", "recueil_nom": "Arrêté",
           "recueil_date": "2026-09-18", "url": "u", "gabarit": "en-tete", "commune": None,
           "insee": None}  # fmt: skip
    admin = {"code": "75", "genre": "departement", "nom": "Paris"}
    heli = collecte.act_event(act, admin, {"dates"}, None, None)
    plain = {**act, "titre": "Arrêté autorisant la captation … sur des aéronefs", "acte": "2"}
    drone = collecte.act_event(plain, admin, {"dates"}, None, None)
    assert (heli["aeronef"], drone["aeronef"]) == ("helicoptere", "non_lu")
    assert not regles.is_drone_act(heli) and regles.is_helico_act(heli)
    assert regles.is_drone_act(drone) and not regles.is_helico_act(drone)
    c = comptes._counts([heli, drone])
    assert (c["dr"], c["helico"]) == (1, 1)
    assert drones.publication([heli, drone])["avant"] == 1  # the drone's only


def test_a_slot_without_hours_says_its_days_in_paris(synthetic):
    """B (2026-11-10): 23 Rhône slots without hours start at 22:00 or 23:00 UTC, midnight in
    Paris, and fell on the day before; such a slot serves its days as written."""
    import datetime as dt

    from lacarte_registre import drones

    utc = dt.UTC
    winter = dt.datetime(2025, 11, 13, 23, 0, tzinfo=utc).timestamp() * 1000
    summer = dt.datetime(2026, 10, 13, 22, 0, tzinfo=utc).timestamp() * 1000
    assert (drones.jour_paris(winter), drones.jour_paris(summer)) == ("2025-11-14", "2026-10-14")
    slots = read(synthetic, f"commune/{MIONS}.json")["drones"]["creneaux"]
    assert [s.get("jours") for s in slots if s["heures"] is None] == [
        ["2026-02-01", "2026-02-03"], ["2026-03-01"]]  # fmt: skip
    assert all("jours" not in s for s in slots if s["heures"] is not None)
