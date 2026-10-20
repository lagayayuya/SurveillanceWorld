"""rules/direction.yaml: which cameras are drawn light ("direction non relevée")."""

from lacarte import direction


def test_the_rule_marks_domes_fixed_unknown_and_alpr_without_direction_only():
    assert direction.rules()["unknown_direction"]["id"] == "rule:direction@3:unknown_direction"
    for kind in ("dome", "fixed", "unknown", "alpr"):
        assert direction.undirected(kind, [])
        assert not direction.undirected(kind, [90.0])
    for kind in ("ptz", "panorama", "doorbell"):
        assert not direction.undirected(kind, [])
