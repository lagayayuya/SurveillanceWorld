"""Each record's share (lot R3 § 6) on the frozen extract: its text with its figures, its
sources, the update day and its address, no judgement; an entry page per record with its
share tags, readable without JavaScript, put into the register's page with the site's
address; a preview image per territory, buyer, company and type of document, drawn again
only when what it shows changed."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from lacarte_registre import apercu, construire, importer, pages, partage

FIXTURE = Path(__file__).parent / "fixtures" / "registre"
MIONS, SERFIM, SYTRAL = "69283", "431903954", "256900994"
SHELL = """<!doctype html><html lang="fr"><head><meta charset="utf-8" />
<title>Le registre · Surveillance World</title>
<meta name="robots" content="noindex" />
<meta name="description" content="Les documents publics" />
<meta property="og:site_name" content="Surveillance World" />
<meta property="og:title" content="La carte" />
<meta property="og:image" content="https://example.org/og.jpg" />
<meta property="og:image:width" content="1200" />
<meta name="twitter:card" content="summary_large_image" />
<meta property="og:url" content="https://example.org/" />
<script type="module" src="/assets/registre-abc123.js"></script></head>
<body class="x"><div id="kit"></div></body></html>"""
TAGS = ("og:title", "og:description", "og:image", "og:url", "twitter:card", "canonical")


@pytest.fixture(scope="module")
def built(tmp_path_factory) -> Path:
    root = tmp_path_factory.mktemp("registre")
    importer.run(FIXTURE, root)
    construire.main(root, sans_corrections=True)
    return root


def read(root: Path, rel: str) -> dict:
    return json.loads((root / "site" / rel).read_text(encoding="utf-8"))


def records(root: Path) -> list[Path]:
    kinds = ("commune", "departement", "acheteur", "entreprise", "document")
    return [p for k in kinds for p in sorted((root / "site" / k).glob("*.json"))]


def test_a_company_s_text_says_its_figures_sources_day_and_address(built):
    p = read(built, f"entreprise/{SERFIM}.json")["partage"]
    assert p["texte"].startswith("Serfim T.I.C. : 64 contrats de vidéosurveillance avec 44 "
                                 "acheteurs publics depuis 2018")  # fmt: skip
    assert "prévus au contrat (une enveloppe, pas forcément dépensée en entier)" in p["texte"]
    assert "Sources : données essentielles de la commande publique" in p["texte"]
    assert "Registre mis à jour le 24/10/2026." in p["texte"]
    assert p["texte"].endswith(f"/registre/entreprise/{SERFIM}")
    assert [f["libelle"] for f in p["chiffres"]] == ["contrats", "acheteurs publics",
                                                     "prévus au contrat"]  # fmt: skip
    assert p["image"] == f"/data/registre/apercu/entreprise/{SERFIM}.png"


def test_the_three_figures_are_the_same_for_a_type(built):
    # each label back to its catalogue key, whatever its number (« contrat », « contrats »)
    key = {w: k.rsplit(".", 1)[1] for k, v in partage._catalogue().items()
           if k.startswith("registre.partage.chiffre.") for w in v.split("|")}  # fmt: skip
    labels = {}
    for path in records(built):
        p = json.loads(path.read_text(encoding="utf-8"))["partage"]
        kind = path.parent.name
        if kind == "document":
            assert p["image"].startswith("/data/registre/apercu/document/")
            continue
        shown = [key[f["libelle"]] for f in p["chiffres"]]
        labels.setdefault(kind, shown)
        assert shown == labels[kind], (path.name, shown)
    assert labels["commune"] == ["document", "arrete", "contrat"]
    assert labels["departement"] == ["document", "commune", "contrat"]
    assert labels["acheteur"] == ["contrat", "entreprise", "prevu"]
    assert labels["entreprise"] == ["contrat", "acheteur", "prevu"]


def test_no_text_judges(built):
    for path in records(built):
        p = json.loads(path.read_text(encoding="utf-8"))["partage"]
        assert not partage.JUGEMENT.search(p["texte"]), (path.name, p["texte"])
        # the address is the record's own, the site's before it (VITE_SITE_URL at the deploy)
        assert p["url"] == "/registre/" + path.relative_to(built / "site").with_suffix(
            ""
        ).as_posix().replace("document/", "contrat/")  # noqa: E501


def test_an_entry_page_per_record_with_its_share_tags(built):
    entree = built / "site" / "entree"
    for path in records(built):
        ref = path.relative_to(built / "site").with_suffix("").as_posix()
        ref = ref.replace("document/", "contrat/")
        frag = (entree / f"{ref}.html").read_text(encoding="utf-8")
        for tag in TAGS:
            assert tag in frag, (ref, tag)
        assert '<meta name="robots" content="noindex" />' in frag
        assert "summary_large_image" in frag
        assert f'href="%site%/registre/{ref}"' in frag


def test_the_page_served_is_the_register_s_with_the_record_s_tags(built, tmp_path):
    shell = tmp_path / "index.html"
    shell.write_text(SHELL, encoding="utf-8")
    n = pages.run(shell, built / "site", tmp_path / "dist", "https://example.org")
    assert n == len(records(built))
    html = (tmp_path / "dist" / "registre" / "commune" / f"{MIONS}.html").read_text("utf-8")
    assert "<title>Mions · Le registre · Surveillance World</title>" in html
    assert html.count("<title>") == 1 and html.count('name="robots"') == 1
    assert html.count('name="description"') == 1
    # the map's share tags gone, one set: the record's (og:site_name kept)
    assert "og.jpg" not in html and 'content="La carte"' not in html
    for tag in ("og:title", "og:image", "og:url", "og:image:width", "twitter:card", "canonical"):
        assert html.count(f'"{tag}"') == 1, tag
    assert 'property="og:site_name"' in html
    assert 'content="https://example.org/data/registre/apercu/commune/69283.png"' in html
    assert '<link rel="canonical" href="https://example.org/registre/commune/69283" />' in html
    assert "%site%" not in html
    # the app as built, and the record readable without it
    assert '<script type="module" src="/assets/registre-abc123.js">' in html
    body = html.split("<noscript>", 1)[1].split("</noscript>", 1)[0]
    assert "<h1>Mions</h1>" in body and "19</b> documents" in body
    assert 'href="/registre/' in body  # its neighbours' records
    with pytest.raises(ValueError):
        pages.run(shell, built / "site", tmp_path / "x", "http://not-https")


def test_a_preview_per_territory_buyer_company_and_document_type(built):
    from PIL import Image

    site = built / "site"
    have = {p.relative_to(site / "apercu").with_suffix("").as_posix()
            for p in (site / "apercu").rglob("*.png")}  # fmt: skip
    for kind in ("commune", "departement", "acheteur", "entreprise"):
        for path in (site / kind).glob("*.json"):
            assert f"{kind}/{path.stem}" in have
    assert {"document/contrat", "document/arrete", "document/subvention"} <= have
    with Image.open(site / "apercu" / "entreprise" / f"{SERFIM}.png") as img:
        assert img.size == (1200, 630) and img.format == "PNG"


def test_a_preview_is_drawn_again_only_when_it_changed(built):
    again = construire.main(built, sans_corrections=True)["apercus"]
    assert again["dessinees"] == 0 and again["images"] > 200
    spec = {"ref": "x", "titre": "Mions", "identite": "Rhône", "etiquette": "commune",
            "chiffres": [{"n": "19", "libelle": "documents"}]}  # fmt: skip
    changed = {**spec, "chiffres": [{"n": "20", "libelle": "documents"}]}
    assert apercu.empreinte(spec) != apercu.empreinte(changed)
    assert apercu.empreinte(spec) == apercu.empreinte(dict(spec))


def test_the_share_s_words_are_texts_never_groups_too():
    """The register's catalogue loader refuses a key that is both a text and a group (its
    page would not open)."""
    keys = [k for k in partage._catalogue() if k.startswith("registre.")]
    both = [k for k in keys if any(o.startswith(k + ".") for o in keys)]
    assert both == []
