"""Normalisation on dirty values actually seen in France (taginfo, 2026-09-27)."""

from datetime import date

import pytest

from lacarte import normalize as n


@pytest.mark.parametrize(
    ("raw", "bearings", "status"),
    [
        ("180", [180.0], "ok"),
        ("0", [0.0], "ok"),
        ("360", [], "range"),
        ("both", [], "range"),
        ("0-359", [], "range"),
        ("0-360", [], "range"),
        ("0 - 360", [], "range"),
        ("W", [270.0], "cardinal"),
        ("SE", [135.0], "cardinal"),
        ("s", [180.0], "cardinal"),
        ("o", [270.0], "cardinal"),
        ("ENE", [67.5], "cardinal"),
        ("-70", [290.0], "ok"),
        ("-90", [270.0], "ok"),
        ("0;90;180;270", [0.0, 90.0, 180.0, 270.0], "multi"),
        ("90-180", [135.0], "range_mid"),
        ("12,5", [12.5], "ok"),
        ("towards the church", [], "invalid"),
        (None, [], "missing"),
        ("", [], "missing"),
    ],
)
def test_parse_direction(raw, bearings, status):
    assert n.parse_direction(raw) == (bearings, status)


@pytest.mark.parametrize(
    ("raw", "h"),
    [
        ("5", 5.0),
        ("4.0", 4.0),
        ("3,5", 3.5),
        ("6 m", 6.0),
        ("0", None),
        ("high", None),
        (None, None),
    ],
)
def test_parse_height(raw, h):
    assert n.parse_height(raw) == h


@pytest.mark.parametrize(
    ("raw", "d"),
    [
        ("2025-01-16", date(2025, 1, 16)),
        ("2022-06", date(2022, 6, 1)),
        ("2016", date(2016, 1, 1)),
        ("2010-02-31", None),
        ("unknown", None),
    ],
)
def test_parse_date(raw, d):
    assert n.parse_date(raw) == d


@pytest.mark.parametrize(
    ("tags", "kind"),
    [
        ({"camera:type": "dome"}, "dome"),
        ({"camera:type": "fixed;dome"}, "fixed"),
        ({"camera:type": "panning"}, "ptz"),
        ({"camera:type": "panorama_with_ptz"}, "ptz"),
        ({"surveillance:type": "ALPR"}, "alpr"),
        ({"surveillance:type": "camera", "camera:type": "doorbell"}, "doorbell"),
        ({"camera:mount": "doorbell"}, "doorbell"),
        ({}, "unknown"),
    ],
)
def test_classify_kind(tags, kind):
    assert n.classify_kind(tags)[0] == kind


def test_non_camera_surveillance_is_excluded():
    assert not n.is_camera({"surveillance:type": "guard"})
    assert n.is_camera({"surveillance:type": "camera"})
    assert n.is_camera({})


@pytest.mark.parametrize(
    ("raw", "group"),
    [
        ("pole", "pole"),
        ("Wall", "wall"),
        ("street_light", "street_lamp"),
        ("lighting_pole", "street_lamp"),
        ("traffic_signal", "traffic_signals"),
        ("doorbell", "doorbell"),
        ("tree", "other"),
        (None, "unknown"),
    ],
)
def test_mount_group(raw, group):
    tags = {} if raw is None else {"camera:mount": raw}
    assert n.mount_group(tags) == group


@pytest.mark.parametrize(
    ("tags", "cls"),
    [
        ({"surveillance": "public"}, "public"),
        ({"surveillance": "public", "operator": "DIRIF"}, "public"),
        ({"operator": "Ville de Paris", "surveillance": "outdoor"}, "public"),
        ({"operator": "La Banque Postale", "surveillance": "outdoor"}, "private_outdoor"),
        ({"operator:type": "private"}, "private_outdoor"),
        ({"surveillance": "outdoor"}, "private_outdoor"),
        ({"surveillance": "indoor"}, "private_indoor"),
        ({}, "unknown"),
    ],
)
def test_operator_class(tags, cls):
    assert n.operator_class(tags, n.classify_kind(tags)[0])[0] == cls


def test_doorbell_is_private():
    tags = {"camera:mount": "doorbell"}
    assert n.operator_class(tags, "doorbell")[0] == "private_outdoor"


def test_capabilities_certainty():
    tags = {"camera:type": "dome", "camera:direction": "90", "camera:mount": "ceiling"}
    caps = {c.name: c for c in n.capabilities(tags, "dome", n.ESTIMATED, "ceiling")}
    assert caps["direction"].certainty == n.ESTIMATED
    assert caps["hfov_deg"].certainty == n.DEFAULT
    lo, hi = caps["hfov_deg"].value
    assert lo < hi and caps["hfov_deg"].certainty == n.DEFAULT
    cap = n.optics.rules()["max_range_m"]
    assert 0 < caps["range_m"].value <= cap  # capped reach at the lowest drawn level
    assert caps["height_m"].certainty == n.DEFAULT
    no_dir = n.capabilities({}, "unknown", n.DEFAULT, "unknown")
    assert n.geometry_certainty(no_dir) == n.DEFAULT


@pytest.mark.parametrize(
    ("raw", "tilt"),
    [("15", 15.0), ("-10", 10.0), ("0", None), ("360", None), ("-90", None), ("abc", None)],
)
def test_parse_tilt(raw, tilt):
    assert n.parse_tilt(raw) == tilt


@pytest.mark.parametrize(
    ("raw", "name", "cls"),
    [
        ("Préfecture de Police de Paris", "Préfecture de police", "public"),
        ("R.A.T.P.", "RATP", "public"),
        ("  Caisse d'Epargne ", "Caisse d'Épargne", "private"),
        ("Boulangerie  Dupont", "Boulangerie Dupont", None),  # not in the table: kept, cleaned
        (None, None, None),
    ],
)
def test_normalized_operator(raw, name, cls):
    assert n.normalized_operator(raw) == (name, cls)


def test_operator_table_class_beats_the_name_heuristic():
    # A named operator used to be private unless the name matched a public pattern.
    assert n.operator_class({"operator": "OCDE"}, "dome") == ("public", "estimated")
    assert n.operator_class({"operator": "BNP Paribas", "surveillance": "public"}, "dome")[0] == (
        "private_outdoor"
    )
    assert n.operator_class({"operator": "Particulier", "surveillance": "indoor"}, "dome")[0] == (
        "private_indoor"
    )


def test_tagged_capabilities():
    caps = n.tagged_capabilities({"camera:features": "recording;Zoom, nightvision"}, "dome")
    assert caps == {"plate_reading": False, "ptz": True, "night_vision_tag": True,
                    "analytics": False}  # fmt: skip
    assert n.tagged_capabilities({"camera:features": "face_detection"}, "fixed")["analytics"]
    assert n.tagged_capabilities({}, "alpr")["plate_reading"]


# Generic operator names (rules/operators.yaml `generic`), on spellings seen outside the
# Île-de-France (France extract, 2026-10-16), against a few official names.
PLACES = n.Places.of(
    ["Marseille", "Toulouse", "Beauvais", "Albi", "Annecy", "Le Havre", "Nîmes", "Lille",
     "Saint-Étienne-de-Montluc", "Le Val d'Hazey", "La Rochelle", "Touffreville",
     "Touffréville", "Bron", "Les Lilas"],
    ["Alpes-Maritimes", "Côte-d'Or", "Seine-Saint-Denis", "Indre-et-Loire", "Rhône"],
)  # fmt: skip


@pytest.mark.parametrize(
    ("raw", "name", "cls"),
    [
        # 3. a municipal prefix and a commune: "Ville de <official name>"
        ("Ville de Marseille", "Ville de Marseille", "public"),
        ("ville de marseille", "Ville de Marseille", "public"),
        ("VILLE DE MARSEILLE", "Ville de Marseille", "public"),
        ("Mairie de Toulouse", "Ville de Toulouse", "public"),
        ("Mairie Beauvais", "Ville de Beauvais", "public"),
        ("Commune d'Albi", "Ville d'Albi", "public"),
        ("Ville d’Annecy", "Ville d'Annecy", "public"),  # a typographic apostrophe
        ("ville du havre", "Ville du Havre", "public"),
        ("Hôtel de Ville des Lilas", "Ville des Lilas", "public"),
        ("Ville de La Rochelle", "Ville de La Rochelle", "public"),
        ("Municipalité du Val d'Hazey", "Ville du Val d'Hazey", "public"),
        ("Mairie de Saint Etienne de Montluc", "Ville de Saint-Étienne-de-Montluc", "public"),
        ("Ville de Nîmes (CSU)", "Ville de Nîmes", "public"),  # a remark in brackets
        ("Ville de Nîmes (CSU ?)", "Ville de Nîmes", "public"),
        # 1. the town unnamed: admin.py names it from where the camera stands
        ("mairie", "Ville (sans précision)", "public"),
        ("Municipalité", "Ville (sans précision)", "public"),
        ("Police Municipale", "Police municipale (sans précision)", "public"),
        ("Police municipale ?", "Police municipale (sans précision)", "public"),
        # 2. the municipal police of a commune
        ("Police municipale de Lille", "Police municipale de Lille", "public"),
        ("police municipale de toulouse", "Police municipale de Toulouse", "public"),
        # not a commune, or a key two communes share: left as written (its class from
        # public_operator_patterns, operator_class)
        ("Ville de Brive", "Ville de Brive", None),
        ("Mairie de Touffreville", "Mairie de Touffreville", None),
        ("Ville de Paris Habitat", "Ville de Paris Habitat", None),
        # several operators: none chosen
        ("Ville de Bron ou Sytral", "Ville de Bron ou Sytral", None),
        ("Ville de Lille / MEL", "Ville de Lille / MEL", None),
        ("Mairie de Toulouse;Toulouse Métropole", "Mairie de Toulouse;Toulouse Métropole", None),
        # a bare town name is not a pattern (communes named like brands: Orange, Mars)
        ("Beauvais", "Beauvais", None),
        ("Orange", "Orange", None),
        # 4. a département by its official name, its article as written
        ("Département des Alpes-Maritimes", "Département des Alpes-Maritimes", "public"),
        ("Conseil Départemental de Côte d'Or", "Département de Côte-d'Or", "public"),
        ("Conseil général Seine-Saint-Denis", "Département de Seine-Saint-Denis", "public"),
        ("Conseil Général d'Indre & Loire", "Département d'Indre-et-Loire", "public"),
        ("conseil general du rhone", "Département du Rhône", "public"),
        ("Département ?", "Département ?", None),
        ("Service Départemental d'Incendie et de Secours du Rhône",
         "Service Départemental d'Incendie et de Secours du Rhône", None),
        # 5. a région, as written
        ("Région Centre", "Région Centre", "public"),
        ("Conseil régional Paca", "Conseil régional Paca", "public"),
        ("Régional Express", "Régional Express", None),
        # 6. a métropole: as written, the frequent ones under their table name
        ("Toulouse Métropole", "Toulouse Métropole", "public"),
        ("Lille Métropole Habitat", "Lille Métropole Habitat", "public"),
        ("Métropolitain", "Métropolitain", None),
        ("Clermont Auvergne Metropole", "Clermont Auvergne Métropole", "public"),
        ("Clermont-Auvergne-Métropole", "Clermont Auvergne Métropole", "public"),
        ("Le Grand Lyon", "Métropole de Lyon", "public"),
        ("codah", "Le Havre Seine Métropole", "public"),
        # transport networks (table)
        ("SYTRAL", "SYTRAL Mobilités", "public"),
        ("Sytral?", "SYTRAL Mobilités", "public"),
        ("Kéolis Rennes", "STAR (Keolis Rennes)", "public"),
        ("Star Bijoux", "Star Bijoux", None),
        ("tisseo", "Tisséo", "public"),
        ("Sûreté Ferroviaire SNCF", "SNCF", "public"),
        # the table wins over the patterns
        ("Mairie de Paris", "Ville de Paris", "public"),
        ("Ville (sans précision)", "Ville (sans précision)", "public"),
    ],
)  # fmt: skip
def test_generic_operator_names(raw, name, cls):
    assert n.normalized_operator(raw, PLACES) == (name, cls)


def test_generic_names_that_need_a_place_wait_for_one():
    assert n.normalized_operator("Mairie de Toulouse") == ("Mairie de Toulouse", None)
    assert n.normalized_operator("Mairie") == ("Ville (sans précision)", "public")
    assert n.normalized_operator("Nantes Métropole") == ("Nantes Métropole", "public")


def test_a_generic_name_gives_its_class():
    # Neither "métropole" nor "SYTRAL" is in public_operator_patterns: private before.
    tags = {"operator": "Toulouse Métropole", "surveillance": "outdoor"}
    assert n.operator_class(tags, "dome") == ("public", "estimated")
    tags = {"operator": "SYTRAL", "surveillance": "outdoor"}
    assert n.operator_class(tags, "dome", PLACES) == ("public", "estimated")


def test_typographic_apostrophes_separate_words():
    assert n.name_key("Ville d’Annecy") == n.name_key("Ville d'Annecy") == "ville d annecy"


def test_the_stage_and_its_rerun_name_alike():
    # apply.py normalises a contributed camera again: with the same places, the same name.
    tags = '{"operator": "Mairie de Toulouse"}'
    row, _ = n.normalize_row("n1", 1, None, tags, places=PLACES)
    over = n.Overrides(directions=[90.0])
    again, _ = n.normalize_row("n1", 1, None, tags, over, PLACES)
    assert row["operator_norm"] == again["operator_norm"] == "Ville de Toulouse"
    assert row["operator_name"] == "Mairie de Toulouse"
