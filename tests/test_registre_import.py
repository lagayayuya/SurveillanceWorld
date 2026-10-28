"""The registre's importer: the pilot export's assignments read as JSON, never as code."""

from __future__ import annotations

import hashlib
import json

import pytest

from lacarte_registre import cli, importer

REG = 'window.REG = {"meta": {"construit": "2026-10-24"}, "evenements": [], "communes": {}};\n'


def _export(root, files):
    for rel, text in {importer.SOURCES[0]: REG, **files}.items():
        (root / rel).parent.mkdir(parents=True, exist_ok=True)
        (root / rel).write_text(text, encoding="utf-8")
    return root


def test_several_assignments_and_comments():
    text = (
        "// a generated file\n"
        'window.A = {"x": [1, 2]};\n'
        "\n// the second one\n"
        'window.B = ["é", null, true];'
    )
    assert importer.parse(text) == {"A": {"x": [1, 2]}, "B": ["é", None, True]}


def test_keyed_assignments_merge_into_one_object():
    text = 'window.DEP = window.DEP || {};\nwindow.DEP["69"] = {"nom": "Rhône"};\n'
    assert importer.parse(text) == {"DEP": {"69": {"nom": "Rhône"}}}


def test_an_object_literal_with_bare_keys_and_trailing_commas():
    text = (
        "window.LIBELLES = {\n"
        "  // Mions\n"
        '  "avis-1": { court: "pour l\'entretien, des caméras", titre: "Entretien" },\n'
        "};\n"
        'window.NOMS = { "1": "Sytral", };\n'
    )
    assert importer.parse(text) == {
        "LIBELLES": {"avis-1": {"court": "pour l'entretien, des caméras", "titre": "Entretien"}},
        "NOMS": {"1": "Sytral"},
    }


@pytest.mark.parametrize(
    "text",
    [
        "var REG = {};",
        "window.REG = load();",
        'window.REG = {"a": 1}',  # no semicolon
        'window.REG = {"a": 1}; alert(1);',
        "window.REG = {a: compute()};",
        "window.REG = `{}`;",
        "window.A = 1; window.A = 2;",
        'window.X["k"] = {};',  # a key into nothing
    ],
)
def test_anything_but_an_assignment_of_data_is_refused(text):
    with pytest.raises(importer.NotPilotFile):
        importer.parse(text)


def test_run_writes_one_file_per_global_and_the_sources_hashes(tmp_path):
    src = _export(tmp_path / "export", {
        "prototype-v12/zones.js": 'window.ZONES = [];\nwindow.SITES = [{"id": "s"}];\n',
        "prototype-v12/geo/dep-69.js": 'window.DEP = window.DEP || {};\nwindow.DEP["69"] = {};\n',
        "prototype-v12/geo/dep-75.js": 'window.DEP = window.DEP || {};\nwindow.DEP["75"] = {};\n',
        "prototype-v12/site.js": 'window.SITE_URL = "https://example.org";\n',
    })  # fmt: skip
    manifest = importer.run(src, tmp_path / "out")
    out = tmp_path / "out" / "pilote"
    assert sorted(p.name for p in out.iterdir()) == [
        "DEP.json", "REG.json", "SITES.json", "ZONES.json", "pilote.json"]  # fmt: skip
    assert json.loads((out / "DEP.json").read_text()) == {"69": {}, "75": {}}
    reg = (src / importer.SOURCES[0]).read_bytes()
    assert manifest["fichiers"][importer.SOURCES[0]] == {
        "sha256": hashlib.sha256(reg).hexdigest(), "globales": ["REG"]}  # fmt: skip
    assert manifest["construit"] == "2026-10-24"
    assert json.loads((out / "pilote.json").read_text()) == manifest
    # the export's site address is never read
    assert "prototype-v12/site.js" not in manifest["fichiers"]


def test_a_refused_file_leaves_the_previous_import(tmp_path):
    src = _export(tmp_path / "export", {})
    importer.run(src, tmp_path / "out")
    before = (tmp_path / "out" / "pilote" / "pilote.json").read_text()
    (src / "prototype-v12/faits.js").parent.mkdir(parents=True, exist_ok=True)
    (src / "prototype-v12/faits.js").write_text("window.LOTS = fetch('x');\n")
    with pytest.raises(importer.NotPilotFile, match="faits.js"):
        importer.run(src, tmp_path / "out")
    assert (tmp_path / "out" / "pilote" / "pilote.json").read_text() == before
    assert [p.name for p in (tmp_path / "out").iterdir()] == ["pilote"]


def test_the_cli_needs_a_folder(monkeypatch, tmp_path):
    monkeypatch.delenv("LACARTE_REGISTRE_PILOTE", raising=False)
    with pytest.raises(SystemExit) as e:
        cli.main(["importer-pilote"])
    assert e.value.code == 2
    with pytest.raises(SystemExit) as e:
        cli.main(["importer-pilote", str(tmp_path)])  # no registre.js there
    assert e.value.code == 2


def test_a_commune_map_must_carry_its_code_and_layers(tmp_path):
    """A map file is plain JSON named after its commune, with its outline and cameras."""
    folder = tmp_path / "export"
    (folder / "prototype-v4").mkdir(parents=True)
    (folder / "prototype-v4" / "registre.js").write_text('window.REG = {"evenements": []};')
    (folder / "prototype-v10" / "carte").mkdir(parents=True)
    bad = folder / "prototype-v10" / "carte" / "69283.json"
    bad.write_text('{"insee": "69123", "bbox": [], "contour": [], "cams": []}')
    with pytest.raises(importer.NotPilotFile, match="its name is not its commune"):
        importer.run(folder, tmp_path / "out")
    bad.write_text('{"insee": "69283", "bbox": []}')
    with pytest.raises(importer.NotPilotFile, match="needs insee, bbox, contour, cams"):
        importer.run(folder, tmp_path / "out")
    bad.write_text('{"insee": "69283", "bbox": [], "contour": [], "cams": []}')
    importer.run(folder, tmp_path / "out")
    assert (tmp_path / "out" / "pilote" / "carte" / "69283.json").is_file()
