"""The register's corrections accepted in /revue (lot R1b « Signaler une erreur »): exported from
the database (`lacarte-registre corrections exporter`, db/export_registre_corrections.sql) to
data/registre/corrections.yaml, then applied by `lacarte-registre construire` on the frozen
extract (tests/fixtures/registre): the value replaced, `corrige` recording the value as
published and the day, the flags and counts that depend on the field following it.

The corrections below are SYNTHETIC (written for these tests, not true of the documents);
the reports in the throwaway database are fictitious."""

from __future__ import annotations

import json
from pathlib import Path

import psycopg
import pytest
import yaml

from lacarte_registre import cli, construire, exporter, importer, regles

FIXTURE = Path(__file__).parent / "fixtures" / "registre"
MIONS, LYON = "69283", "69123"
CONTRACT_2020 = "216902833000132020_32323500~0"  # 200 000 €, its date read by the rules file
CONTRACT_2025 = "21690283300013202520240600_32323500~0"  # 215 000 €, 2025-01-30
ACT = "69-2025-11-18-00015"  # a video-protection act of Mions, its own
UNREADABLE = "69-2025-10-29-00049"  # a video-protection act whose number is unreadable
DAY = "2026-10-29"


def synthetic(*rows: tuple[str, str, object]) -> list[dict]:
    return [{"id": f"registre_reports:test-{i}", "evenement": ev, "field": field,
             "value": value, "source": "synthetic, for the tests", "rationale": "synthetic",
             "le": DAY} for i, (ev, field, value) in enumerate(rows)]  # fmt: skip


def build(root: Path, entries: list[dict] | None) -> Path:
    importer.run(FIXTURE, root)
    if entries is not None:
        exporter.write(root / exporter.FILE, entries)
    construire.run(root)
    return root / "site"


def read(site: Path, rel: str) -> dict:
    return json.loads((site / rel).read_text(encoding="utf-8"))


def doc(f: dict, ev: str) -> dict:
    [e] = [e for e in f["evenements"] if e["id"] == ev]
    return e


@pytest.fixture(scope="module")
def corrected(tmp_path_factory) -> Path:
    return build(tmp_path_factory.mktemp("registre"), synthetic(
        (CONTRACT_2020, "montant", 250000),
        (CONTRACT_2025, "date", "2025-01-31"),
        (ACT, "insee", LYON),
        (UNREADABLE, "cameras", 14),
    ))  # fmt: skip


def test_an_amount_is_replaced_and_its_source_recorded(corrected):
    f = read(corrected, f"commune/{MIONS}.json")
    e = doc(f, CONTRACT_2020)
    assert e["montant"] == 250000
    assert e["corrige"] == {"montant": {"source": 200000.0, "le": DAY}}
    # the rules file's reading stays as it was: the date read, no correction of the date
    assert (e["date"], e["date_lue"]) == ("2020-02-05", "2021-02-05")
    assert f["stats"]["communes"][MIONS]["montant"] == 415_000 + 50_000


def test_a_date_is_replaced_and_read(corrected):
    e = doc(read(corrected, f"commune/{MIONS}.json"), CONTRACT_2025)
    assert (e["date"], e["date_lue"]) == ("2025-01-31", "2025-01-31")
    assert e["corrige"] == {"date": {"source": "2025-01-30", "le": DAY}}


def test_a_commune_corrected_moves_the_document_and_its_counts(corrected):
    mions = read(corrected, f"commune/{MIONS}.json")
    lyon = read(corrected, f"commune/{LYON}.json")
    assert ACT not in {e["id"] for e in mions["evenements"] if e["insee"] == MIONS}
    e = doc(lyon, ACT)
    assert (e["insee"], e["dep"]) == (LYON, "69")
    assert e["corrige"] == {"insee": {"source": MIONS, "le": DAY}}
    m, ly = mions["stats"]["communes"][MIONS], lyon["stats"]["communes"][LYON]
    assert (m["docs"], m["arr"], m["cam"]) == (19 - 1, 11 - 1, 9 - 1)
    assert (ly["docs"], ly["arr"], ly["cam"]) == (88 + 1, 1 + 1, 0 + 1)


def test_a_number_of_cameras_read_leaves_the_unread(corrected):
    e = doc(read(corrected, "commune/69044.json"), UNREADABLE)
    assert e["cameras"] == 14 and "non_lu" not in e
    assert e["corrige"] == {"cameras": {"source": None, "le": DAY}}
    assert UNREADABLE not in json.dumps(read(corrected, "non_lus.json"))


def test_the_pilot_s_own_corrige_is_dropped_and_a_correction_still_recorded(tmp_path):
    # The pilot export marks every BOAMP notice `corrige` (prototype v4: « identifiant de
    # l'acheteur corrigé », true on 9 of 2,616); the extract has none, so a copy gets it
    # (SYNTHETIC: false on every document, true on the one corrected below).
    importer.run(FIXTURE, tmp_path)
    reg = tmp_path / "pilote" / "REG.json"
    data = json.loads(reg.read_text(encoding="utf-8"))
    for e in data["evenements"]:
        e["corrige"] = e["id"] == CONTRACT_2020
    reg.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    exporter.write(tmp_path / exporter.FILE, synthetic((CONTRACT_2020, "montant", 250000)))
    construire.run(tmp_path)
    site = tmp_path / "site"
    e = doc(read(site, f"commune/{MIONS}.json"), CONTRACT_2020)
    assert e["corrige"] == {"montant": {"source": 200000.0, "le": DAY}}
    for p in site.rglob("*.json"):
        text = p.read_text(encoding="utf-8")
        assert '"corrige":true' not in text and '"corrige":false' not in text, p.name


def test_without_accepted_corrections_nothing_is_marked(tmp_path):
    site = build(tmp_path, None)
    f = read(site, f"commune/{MIONS}.json")
    assert not any("corrige" in e for e in f["evenements"])
    assert doc(f, CONTRACT_2020)["date_lue"] == "2021-02-05"


@pytest.mark.parametrize(("entries", "said"), [
    (synthetic(("69-0000-00-00-00000", "montant", 1)), "no document '69-0000-00-00-00000'"),
    ([{**synthetic((ACT, "montant", 1))[0], "field": "prix"}], "unknown field 'prix'"),
    (synthetic((ACT, "insee", "99999")), "no commune 99999"),
    (synthetic((ACT, "affaire", "nowhere")), "no affaire 'nowhere'"),
    (synthetic((ACT, "montant", "beaucoup")), "an amount is a number"),
    ([{**synthetic((ACT, "montant", 1))[0], "le": None}], "no acceptance day"),
])  # fmt: skip
def test_a_correction_the_build_cannot_apply_stops_it(tmp_path, entries, said):
    with pytest.raises(regles.CorrectionError, match=said):
        build(tmp_path, entries)
    assert not (tmp_path / "site").exists()


def test_the_cli_says_why_it_stops(monkeypatch, tmp_path, capsys):
    import lacarte_registre as registre

    monkeypatch.setattr(registre, "ROOT", tmp_path)
    cli.main(["importer-pilote", str(FIXTURE)])

    def export(dsn, ssh, root):  # the database, as if it held that correction
        exporter.write(root / exporter.FILE, synthetic(("e-unknown", "cameras", 3)))
        return {"file": exporter.FILE, "corrections": 1}

    monkeypatch.setattr(exporter, "export", export)
    with pytest.raises(SystemExit) as stop:
        cli.main(["construire", "--dsn", "dbname=none"])
    assert stop.value.code == 2
    assert "no document 'e-unknown' in the register" in capsys.readouterr().err


# --- the export, from the database ----------------------------------------------------------


@pytest.fixture
def reports(pg_loaded, pg_dsn):
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        conn.execute("DELETE FROM registre_reports")

        def add(state: str, decided: str | None = None, **row) -> str:
            row = {"evenement": CONTRACT_2020, "affaire": "216902833000132020_32323500",
                   "category": "montant", "correction": "Lecteur : 250 000 €",
                   "contact": None if state != "pending" else "lecteur@example.org",
                   "state": state, **row}  # fmt: skip
            if state != "pending":
                row |= {"decided_on": decided, "decided_by": "rvw"}
            return conn.execute(
                f"INSERT INTO registre_reports ({', '.join(row)}) VALUES"
                f" ({', '.join(['%s'] * len(row))}) RETURNING id::text",
                [psycopg.types.json.Jsonb(v) if k == "value" else v for k, v in row.items()],
            ).fetchone()[0]

        ids = {
            "later": add("accepted", "2026-10-28", field="date", value="2021-02-05",
                         reason="BOAMP 21-16838", source="https://www.boamp.fr/x"),
            "first": add("accepted", "2026-10-02", field="montant", value=250000,
                         reason="Avis d'attribution"),
            "refused": add("refused", "2026-10-03"),
            "pending": add("pending"),
        }  # fmt: skip
    yield ids
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        conn.execute("DELETE FROM registre_reports")


def test_the_export_writes_the_accepted_in_their_order(reports, pg_dsn, tmp_path):
    summary = exporter.export(dsn=pg_dsn, root=tmp_path)
    assert summary["corrections"] == 2 and summary["montant"] == summary["date"] == 1
    text = (tmp_path / exporter.FILE).read_text(encoding="utf-8")
    assert text.startswith("# The register's corrections accepted in /revue")
    assert yaml.safe_load(text) == {"version": 1, "corrections": [
        {"id": f"registre_reports:{reports['first']}", "evenement": CONTRACT_2020,
         "field": "montant", "value": 250000, "source": "a reader's report, accepted in /revue",
         "rationale": "Avis d'attribution", "le": "2026-10-02"},
        {"id": f"registre_reports:{reports['later']}", "evenement": CONTRACT_2020,
         "field": "date", "value": "2021-02-05", "source": "https://www.boamp.fr/x",
         "rationale": "BOAMP 21-16838", "le": "2026-10-28"},
    ]}  # fmt: skip
    # nothing about the reader nor the reviewer leaves the database
    for secret in ("lecteur", "rvw", "Lecteur :"):
        assert secret not in text
    # and the build reads it as it is
    corr = regles.corrections(tmp_path / exporter.FILE)
    assert [(c.field, c.value, c.le) for c in corr] == [
        ("montant", 250000, "2026-10-02"), ("date", "2021-02-05", "2026-10-28")]  # fmt: skip


def test_the_export_is_written_also_when_empty(pg_loaded, pg_dsn, tmp_path):
    with psycopg.connect(pg_dsn, autocommit=True) as conn:
        conn.execute("DELETE FROM registre_reports")
    (tmp_path / exporter.FILE).write_text("stale")
    assert exporter.export(dsn=pg_dsn, root=tmp_path) == {"file": exporter.FILE,
                                                          "corrections": 0}  # fmt: skip
    assert yaml.safe_load((tmp_path / exporter.FILE).read_text()) == {
        "version": 1, "corrections": []}  # fmt: skip
    assert regles.corrections(tmp_path / exporter.FILE) == []


def test_the_cli_exports_from_a_local_database(reports, pg_dsn, monkeypatch, tmp_path, capsys):
    import lacarte_registre as registre

    monkeypatch.setattr(registre, "ROOT", tmp_path)
    cli.main(["corrections", "exporter", "--dsn", pg_dsn])
    assert json.loads(capsys.readouterr().out)["corrections"] == 2
    assert (tmp_path / exporter.FILE).exists()


# --- construire exports first; the deploy refuses a build without the database's corrections ---


def test_construire_exports_then_builds_and_marks_it(reports, pg_dsn, tmp_path):
    importer.run(FIXTURE, tmp_path)
    summary = construire.main(tmp_path, dsn=pg_dsn)
    assert summary["corrections"]["corrections"] == "base"
    assert summary["corrections"]["exportees"] == 2
    e = doc(read(tmp_path / "site", "commune/69283.json"), CONTRACT_2020)
    assert e["montant"] == 250000 and e["corrige"]["montant"]["le"] == "2026-10-02"
    assert construire.verifier(tmp_path) is None
    # a site changed since (another build, a hand edit) is not the one marked
    (tmp_path / "site" / "index.json").write_text("{}")
    assert "not the one" in construire.verifier(tmp_path)


def test_construire_without_the_database_stops_or_says_so(tmp_path, monkeypatch, capsys):
    import lacarte_registre as registre

    importer.run(FIXTURE, tmp_path)
    with pytest.raises(construire.NoDatabase):
        construire.main(tmp_path)
    assert not (tmp_path / "site").exists()
    # an older export is never read without the database: --sans-corrections ignores it
    exporter.write(tmp_path / exporter.FILE, synthetic((CONTRACT_2020, "montant", 1)))
    construire.main(tmp_path, sans_corrections=True)
    assert doc(read(tmp_path / "site", "commune/69283.json"), CONTRACT_2020)["montant"] == 200000
    assert "--sans-corrections" in construire.verifier(tmp_path)
    # the command says why, and the deploy's check refuses
    monkeypatch.setattr(registre, "ROOT", tmp_path)
    monkeypatch.delenv("DEPLOY_TARGET", raising=False)
    with pytest.raises(SystemExit) as stop:
        cli.main(["construire"])
    assert stop.value.code == 2 and "--ssh HOST" in capsys.readouterr().err
    with pytest.raises(SystemExit) as stop:
        cli.main(["verifier"])
    assert stop.value.code == 2 and "sans-corrections" in capsys.readouterr().err
