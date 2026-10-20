from lacarte import review


def summary(**over):
    base = {
        "violations": {"a_outside_sector": 0, "b_building_overlap_over_0_5_m2": 0,
                       "c_block_diff_over_0_01_m2": 0, "c_block_checked": 500},
        "uncut_views": 0,
        "spiky_views": 199,
    }  # fmt: skip
    base.update(over)
    return base


def test_clean_run_passes_even_with_spikes():
    assert review.blocking_failures(summary()) == {}


def test_a_leak_blocks_the_build_but_wedges_do_not():
    assert review.blocking_failures(summary(leaky_views=1)) == {"leaky_views": 1}
    assert review.blocking_failures(summary(spiky_views=500, leaky_views=0)) == {}


def test_violations_and_uncut_views_block_the_build():
    bad = summary(uncut_views=2)
    bad["violations"]["b_building_overlap_over_0_5_m2"] = 1
    assert review.blocking_failures(bad) == {"b_building_overlap_over_0_5_m2": 1, "uncut_views": 2}
