"""Every mention that has its fiche is a link (design/registre/v2, the owner's rule, « partout et
sans exception »): every page of the register rendered on the fixture's build by its own view
(web/tests/registre-liens/rendre.ts: Node, no browser), every text outside a link searched for the
name of a fiche the build holds (a commune, a département, a buyer, a company). The result is
printed view by view; the test fails on any name left as text, or a page that does not render."""

import json
import shutil
import subprocess
from collections import defaultdict
from pathlib import Path

import pytest

from lacarte_registre import construire, importer

ROOT = Path(__file__).resolve().parent.parent
FIXTURE = ROOT / "tests" / "fixtures" / "registre"
WEB = ROOT / "web"
NODE = shutil.which("node")


@pytest.fixture(scope="module")
def built(tmp_path_factory) -> Path:
    root = tmp_path_factory.mktemp("registre-liens")
    importer.run(FIXTURE, root)
    construire.main(root, sans_corrections=True)
    return root / "site"


def pages(site: Path) -> list[str]:
    """Every page the build holds: the register's own pages, the lists, every fiche."""
    out = ["/registre/", "/registre/glossaire", "/registre/couverture"]
    out += [
        f"/registre/{k}"
        for k in (
            "communes",
            "intercommunalites",
            "departements",
            "acheteurs",
            "entreprises",
            "contrats",
            "modifications",
            "appels-d-offres",
            "arretes",
            "subventions",
        )
    ]
    for f in sorted((site / "commune").glob("*.json")):
        c = f.stem
        out += [f"/registre/commune/{c}", f"/registre/commune/{c}/documents"]
        out += [f"/registre/commune/{c}/autorisations", f"/registre/commune/{c}/carte"]
    for folder, page in (
        ("departement", "departement"),
        ("entreprise", "entreprise"),
        ("acheteur", "acheteur"),
        ("document", "contrat"),
    ):
        out += [f"/registre/{page}/{f.stem}" for f in sorted((site / folder).glob("*.json"))]
    return out


@pytest.mark.skipif(NODE is None, reason="node is not installed")
def test_every_mention_that_has_its_fiche_is_a_link(built, capsys):
    run = subprocess.run(
        [
            NODE,
            "--experimental-strip-types",
            "--no-warnings",
            "--import",
            "./tests/registre-liens/enregistrer.mjs",
            "tests/registre-liens/rendre.ts",
            str(built),
            *pages(built),
        ],
        cwd=WEB,
        capture_output=True,
        text=True,
        check=True,
    )
    results = json.loads(run.stdout)
    by_view: dict[str, dict[str, int]] = defaultdict(lambda: {"pages": 0, "textes": 0, "non": 0})
    for r in results:
        v = by_view[r["vue"]]
        v["pages"] += 1
        v["textes"] += r["textes"]
        v["non"] += len(r["nonLies"])
    with capsys.disabled():
        print("\nToute mention qui a sa fiche est un lien — vue par vue (fixture) :")
        for name, v in sorted(by_view.items()):
            nb, lus, non = v["pages"], v["textes"], v["non"]
            print(f"  {name:14} {nb:4} pages {lus:6} textes lus  {non:3} non liés")
    errors = [f"{r['chemin']}: {r['erreur']}" for r in results if r.get("erreur")]
    assert not errors, "\n".join(errors[:20])
    unlinked = [
        f"{r['chemin']}: « {x['nom']} » ({x['quoi']}) dans « {x['texte']} »"
        for r in results
        for x in r["nonLies"]
    ]
    assert not unlinked, f"{len(unlinked)} mentions non liées:\n" + "\n".join(unlinked[:40])
