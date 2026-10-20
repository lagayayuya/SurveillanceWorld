import pytest
import yaml

from lacarte import participation, regions


def mount_groups():
    conf = yaml.safe_load((regions.ROOT / "rules" / "mounts.yaml").read_text())
    return [*conf["groups"], "other", "unknown"]


def test_every_mount_group_has_exactly_one_placement_rule():
    p = participation.rules()["placement"]
    for group in mount_groups():
        assert [group in p[k] for k in ("facade", "free", "choose")].count(True) == 1, group
    assert set(p["facade"] + p["free"] + p["choose"]) == set(mount_groups())


@pytest.mark.parametrize(
    ("group", "placement"),
    [("wall", "facade"), ("doorbell", "facade"), ("pole", "free"), ("street_lamp", "free"),
     ("traffic_signals", "free"), ("gantry", "free"), ("unknown", None), ("other", None)],
)  # fmt: skip
def test_default_placements(group, placement):
    assert participation.default_placement(group) == placement


def test_the_phone_gets_the_names_that_do_not_tell_a_category():
    """tiles.questions_rules: folded names (rules/questions.yaml category_unknown and
    rules/operators.yaml no_information) for which "who films" is still asked on a private
    camera; every value a string (YAML read a bare `yes` as a boolean)."""
    from lacarte import tiles

    q = tiles.questions_rules()
    names = q["category_unknown"]
    assert all(isinstance(n, str) for n in names)
    assert {"syndic d immeuble", "yes", "private"} <= set(names)
    assert "particulier" not in names  # "Particulier" says a private individual
    assert q["operator_codes"] == ["unk", "pro", "pri"]


def test_the_punk_editor_offers_a_height_to_every_kind_but_the_big_ball():
    """DECISIONS 2026-10-08: the height classes for every shape but the big ball; the tilt
    for a tube and, since questions@5, a small dome (rules/questions.yaml
    height.modify_excludes, tilt.kinds)."""
    from lacarte import tiles

    q = tiles.questions_rules()
    assert q["height_excluded_kinds"] == [q["shape_kinds"]["ptz"]] == ["ptz"]
    assert q["editor_tilt_kinds"] == [q["shape_kinds"]["bullet"], q["shape_kinds"]["dome"]]
    assert q["editor_tilt_kinds"] == ["fixed", "dome"]
    # The frozen classique keeps the tube alone, under the name it reads.
    assert q["tilt_kinds"] == ["fixed"]
