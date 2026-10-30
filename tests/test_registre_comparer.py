"""`lacarte-registre comparer`: the pilot's control table, before and after a build (lot R3
§ 3), on two builds of the extract, one of them with a Rhône contract's amount changed."""

from __future__ import annotations

import json
from pathlib import Path

from lacarte_registre import cli, construire, importer

FIXTURE = Path(__file__).parent / "fixtures" / "registre"


def build(root: Path) -> Path:
    importer.run(FIXTURE, root)
    construire.run(root, accepted=False)
    return root / "site"


def test_the_table_says_what_moved(tmp_path, capsys):
    before = build(tmp_path / "avant")
    after_root = tmp_path / "apres"
    importer.run(FIXTURE, after_root)
    reg = after_root / "pilote" / "REG.json"
    data = json.loads(reg.read_text(encoding="utf-8"))
    [e] = [e for e in data["evenements"] if e["id"] == "216902833000132020_32323500~0"]
    e["montant"] += 1000
    reg.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    construire.run(after_root, accepted=False)
    cli.main(["comparer", str(before), str(after_root / "site")])
    out = capsys.readouterr().out
    assert "| `commune/69283` | montant compté (€) | 415 000 | 416 000 | +1 000 |" in out
    assert "| `entreprise/431903954` | contrats | 64 | 64 | +0 |" in out
    assert "| `commune/75056` | (aucune fiche) | — | — | — |" in out
