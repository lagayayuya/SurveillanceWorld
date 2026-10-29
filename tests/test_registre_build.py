"""The registre's build on its frozen extract (tests/fixtures/registre): the counting rules
of the pilot, the shared acts, the unread acts, the coverage and the all-or-nothing write."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from lacarte import lock
from lacarte_registre import cli, construire, fermetures, importer, regles

FIXTURE = Path(__file__).parent / "fixtures" / "registre"
MIONS, LYON = "69283", "69123"
SERFIM, SYTRAL = "431903954", "256900994"
DRONES_6, DRONES_3 = "69-2026-03-06-00003", "69-2026-10-15-00005"
UNREADABLE = "69-2025-10-29-00049"  # a video-protection act whose number is unreadable
NO_ZONE = "75-2025-06-19-00003"  # a drone act of the police prefecture, no zone drawn


@pytest.fixture(scope="module")
def built(tmp_path_factory) -> Path:
    root = tmp_path_factory.mktemp("registre")
    importer.run(FIXTURE, root)
    construire.main(root, sans_corrections=True)
    return root / "site"


def read(site: Path, rel: str) -> dict:
    return json.loads((site / rel).read_text(encoding="utf-8"))


def own(f: dict, insee: str) -> list[dict]:
    return [e for e in f["evenements"] if e["insee"] == insee]


def test_mions_counts_415000_euros_19_documents_and_11_acts(built):
    f = read(built, f"commune/{MIONS}.json")
    docs = own(f, MIONS)
    assert len(docs) == 19
    assert sum(e["t"].startswith("arrete") for e in docs) == 11
    assert f["stats"]["communes"][MIONS]["montant"] == 415_000
    shared = {e["id"]: e for e in docs if e.get("partage")}
    assert set(shared) == {DRONES_6, DRONES_3}
    assert len(shared[DRONES_6]["partage"]) + 1 == 6
    assert len(shared[DRONES_3]["partage"]) + 1 == 3
    # the commune's copies of acts placed elsewhere say where the original is
    assert all(e["insee0"] != MIONS for e in shared.values())
    assert f["commune"]["nom"] == "Mions"


def test_the_reviewed_date_is_beside_the_source_date(built):
    f = read(built, f"commune/{MIONS}.json")
    [e] = [e for e in f["evenements"] if e["id"] == "216902833000132020_32323500~0"]
    assert (e["date"], e["date_lue"]) == ("2020-02-05", "2021-02-05")
    assert sum("date_lue" in e for e in f["evenements"]) == 1


def test_a_shared_act_is_in_each_of_its_communes_files_and_counted_once(built):
    for act in (DRONES_6, DRONES_3):
        [orig] = [e for e in read(built, "recherche.json")["evenements"] if e["id"] == act]
        communes = [orig["insee"], *orig["partage"]]
        for k in communes:
            [e] = [e for e in read(built, f"commune/{k}.json")["evenements"] if e["id"] == act]
            assert e["insee"] == k
            assert sorted(e["partage"]) == sorted(set(communes) - {k})
            assert e.get("insee0", k) == orig["insee"]
    dep = read(built, f"commune/{MIONS}.json")["stats"]["dep"]
    # the territory counts each document once, the communes each their copy
    per_commune = sum(
        s["docs"] for s in read(built, "departement/69.json")["stats"]["communes"].values()
    )
    assert dep["uniq"]["docs"] == per_commune - (6 - 1) - (3 - 1)


def test_serfim_has_64_contracts_its_doublon_once(built):
    f = read(built, f"entreprise/{SERFIM}.json")
    assert f["entreprise"]["nom"] == "SERFIM T.I.C."
    assert (f["stats"]["n"], f["stats"]["copies"]) == (64, 1)
    copies = [e for e in f["evenements"] if e["t"] == "attribution" and e["copie"]]
    assert len(copies) == 1 and not copies[0]["compte"]


def test_sytral_works_with_5_companies(built):
    f = read(built, f"acheteur/{SYTRAL}.json")
    assert len(f["stats"]["ents"]) == 5
    assert f["acheteur"]["nom_court"] == "Sytral (transports lyonnais)"


def test_the_rhone_counts_108_7_million_over_194_contracts(built):
    events = read(built, "recherche.json")["evenements"]
    rhone = [e for e in events if e["dep"] == "69" and e["t"] == "attribution"]
    counted = [e for e in rhone if e["compte"]]
    assert (len(rhone), len(counted)) == (238, 194)
    assert round(sum(e["montant"] or 0 for e in counted)) == 108_674_707
    out = [e for e in rhone if not e["compte"]]
    assert sum(e.get("hors_totaux") == "centrale" for e in out) == 2
    assert sum(str(e.get("hors_totaux")).startswith("mixte") for e in out) == 33
    assert sum(e.get("hors_totaux") == "a_verifier" for e in out) == 3
    assert sum(e["copie"] for e in out) == 6
    stats = read(built, "departement/69.json")["stats"]["depStats"]
    assert round(stats["montant"]) == 108_674_707


def test_an_unreadable_count_is_an_act_not_cameras(built):
    rows = {r["id"]: r for r in read(built, "non_lus.json")["non_lus"]}
    assert rows[UNREADABLE]["raisons"] == ["nombre_illisible"]
    assert rows[UNREADABLE]["ref"] and rows[UNREADABLE]["url"]
    insee = rows[UNREADABLE]["insee"]
    f = read(built, f"commune/{insee}.json")
    [e] = [e for e in f["evenements"] if e["id"] == UNREADABLE]
    assert e.get("cameras") is None and e["non_lu"] == ["nombre_illisible"]
    s = f["stats"]["communes"][insee]
    assert s["cam"] == s["arr"] == sum(x["t"] == "arrete" for x in own(f, insee))


def test_a_drone_zone_not_deduced(built):
    rows = {r["id"]: r for r in read(built, "non_lus.json")["non_lus"]}
    assert set(rows[NO_ZONE]["raisons"]) == {"zone_non_deduite", "commune_introuvable"}
    cov = read(built, "couverture.json")
    assert cov["non_lus"] == {
        "nombre_illisible": sum("nombre_illisible" in r["raisons"] for r in rows.values()),
        "commune_introuvable": sum("commune_introuvable" in r["raisons"] for r in rows.values()),
        "zone_non_deduite": sum("zone_non_deduite" in r["raisons"] for r in rows.values()),
    }
    assert read(built, "index.json")["non_lus"] == len(rows)


def test_an_act_without_a_commune_is_placed_by_its_zones(built):
    f = read(built, f"commune/{LYON}.json")
    assert "69-2026-10-02-00002" in {e["id"] for e in own(f, LYON)}


def test_coverage_from_the_data_and_the_rules(built):
    cov = read(built, "couverture.json")
    deps = cov["departements"]
    assert deps["69"]["etat"] == "collecte" and deps["69"]["depuis"] == "2025-09-30"
    assert (deps["75"]["etat"], deps["75"]["raison"]) == ("impossible", "defi_anti_robot")
    assert cov["defaut"] == {"etat": "non_collecte"}
    src = {s["id"]: s for s in cov["sources"]}
    acts = [
        e for e in read(built, "recherche.json")["evenements"]
        if e["t"].startswith("arrete") and e["dep"] == "69"
    ]  # fmt: skip
    # the last collection read, the date in its file name: published after its last act
    last = max(acts, key=lambda e: e["date"])
    assert (last["date"], last["url"][-11:]) == ("2026-10-20", "-211026.pdf")
    assert src["arretes_69"]["jusqu_au"] == deps["69"]["dernier_recueil"] == "2026-10-21"
    assert src["arretes_69"]["jusqu_au"] >= max(e["date"] for e in acts)
    # a subsidy list dated by its year only gives no date
    assert src["subventions_etat_69"]["jusqu_au"] is None
    assert cov["maj"] == max(s["collecte_le"] for s in cov["sources"] if s["documents"])
    # a source whose documents the pilot lists has their collection date, else its build date
    assert src["arretes_69"]["collecte_le"] == "2026-10-23"
    assert src["contrats"]["collecte_le"] == "2026-10-24"  # the extract keeps no contract url
    assert read(built, f"commune/{MIONS}.json")["couverture"]["departement"] == deps["69"]


def test_the_home_is_small_and_complete(built):
    idx = read(built, "index.json")
    docs = read(built, "recherche.json")["evenements"]
    assert idx["totaux"]["docs"] == len(docs) == sum(idx["facettes"]["t"].values())
    assert len(idx["recents"]) == len(idx["gros"]) == 10
    assert all(e["compte"] for e in idx["gros"])
    named = {s for e in idx["recents"] + idx["gros"] for s in e["entreprises"]}
    assert named <= set(idx["dico"]["entreprises"])
    assert (built / "index.json").stat().st_size < 50_000


def test_masked_names_stay_masked(built):
    docs = read(built, "recherche.json")["evenements"]
    masked = [e for e in docs if e.get("beneficiaire") == regles.MASQUE]
    assert masked and all(e["nom_publie"] is False for e in masked)


def test_an_interrupted_build_leaves_the_previous_site(built, monkeypatch, tmp_path):
    root = tmp_path / "r"
    importer.run(FIXTURE, root)
    construire.run(root)
    before = sorted(p.relative_to(root).as_posix() for p in (root / "site").rglob("*"))
    stamp = (root / "site" / "index.json").read_bytes()

    def boom(ctx, insee):
        raise RuntimeError("killed")

    monkeypatch.setattr(fermetures, "commune_file", boom)
    with pytest.raises(RuntimeError):
        construire.run(root)
    assert sorted(p.relative_to(root).as_posix() for p in (root / "site").rglob("*")) == before
    assert (root / "site" / "index.json").read_bytes() == stamp
    assert sorted(p.name for p in root.iterdir()) == ["pilote", "site"]


def test_the_build_takes_the_lock(tmp_path):
    root = tmp_path / "r"
    importer.run(FIXTURE, root)
    token = lock.acquire("another build")
    try:
        with pytest.raises(lock.Busy):
            construire.main(root, sans_corrections=True)
    finally:
        lock.release(token)
    assert not (root / "site").exists()


def test_the_cli_builds(monkeypatch, tmp_path, capsys):
    import lacarte_registre as registre

    monkeypatch.setattr(registre, "ROOT", tmp_path)
    cli.main(["importer-pilote", str(FIXTURE)])
    cli.main(["construire", "--sans-corrections"])
    out = capsys.readouterr().out
    assert '"commune":' in out and (tmp_path / "site" / "commune" / f"{MIONS}.json").exists()


def test_the_commune_maps_layers_are_served_as_imported(built):
    """Mions' tilted map (cameras, filmed streets, fields of view, outline) is served beside the
    register's files, byte for byte as the export gave it."""
    assert (built / "carte" / "69283.json").read_bytes() == (
        FIXTURE / "prototype-v10" / "carte" / "69283.json"
    ).read_bytes()


def test_the_home_names_its_rows_buyers_and_the_search_the_map_counts(built):
    """The home's latest and largest documents come with their affaires (a contract's buyer is
    often its affaire's), and the search's communes with their map count (the rankings)."""
    index = read(built, "index.json")
    rows = index["recents"] + index["gros"]
    assert {e["affaire"] for e in rows if e.get("affaire")} <= set(index["dico"]["affaires"])
    recherche = read(built, "recherche.json")
    assert (
        recherche["communes"][MIONS]["carte"] == read(built, f"commune/{MIONS}.json")["carte"]["n"]
    )


def test_the_unread_decrees_name_their_commune_and_the_coverage_its_departements(built):
    """The coverage page writes names, not codes, where the export gives them."""
    rows = read(built, "non_lus.json")["non_lus"]
    assert all(r["commune"] for r in rows if r.get("insee"))
    assert read(built, "couverture.json")["departements"]["69"]["nom"] == "Rhône"


def test_a_commune_file_says_whether_its_map_is_served(built):
    """The page asks for a map's layers only when they are served: no 404 for an uncut map."""
    assert read(built, f"commune/{MIONS}.json")["carte"]["decoupee"] is True
    others = [f for f in (built / "commune").glob("*.json") if f.stem != MIONS]
    assert others and all(
        read(built, f"commune/{f.name}")["carte"]["decoupee"] is False for f in others
    )
