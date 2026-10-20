from dataclasses import replace

from lacarte.api.confirm import Row, agreements, d2_agreements, on_site_confirmers, statuses


def v(uuid, author, answer, status="pending", decided=False):
    return Row(uuid, "verify", author, status, answer=answer, decided=decided)


def m(uuid, author, x, y=0.0, status="pending"):
    return Row(uuid, "move", author, status, x=x, y=y)


def op(uuid, author, kind, target, status="pending"):
    return Row(uuid, kind, author, status, target=target)


# --- counting (both modes) ---------------------------------------------------------------


def test_not_found_is_agreed_by_other_not_found_and_disputed_by_present():
    rows = [v("p", "ana", "not_found"), v("a", "bob", "not_found"), v("b", "cy", "present"),
            v("c", "dee", "unsure")]  # fmt: skip
    assert agreements(rows, 3) == {"p": (1, 1), "a": (1, 1)}


def test_moves_agree_within_the_distance_and_opinions_count():
    rows = [m("p", "ana", 0.0), m("near", "bob", 2.9), m("far", "cy", 10.0),
            op("o1", "dee", "agree", "p"), op("o2", "eve", "disagree", "p")]  # fmt: skip
    got = agreements(rows, 3)
    assert got["p"] == (2, 1)  # bob's move, dee's opinion; eve disagrees; cy is elsewhere
    assert got["far"] == (0, 0)


def test_authors_count_once_and_never_for_their_own_proposal():
    rows = [m("p", "ana", 0.0), op("o1", "ana", "agree", "p"), op("o2", "bob", "agree", "p"),
            op("o3", "bob", "agree", "p"), m("again", "bob", 1.0)]  # fmt: skip
    assert agreements(rows, 3)["p"] == (1, 0)


def test_rejected_contributions_count_for_nothing():
    rows = [m("p", "ana", 0.0), op("o1", "bob", "agree", "p", status="rejected")]
    assert agreements(rows, 3) == {"p": (0, 0)}


def test_a_disabled_account_s_voice_counts_for_nothing():
    """Lot 2: an account an administrator disabled or suspended agrees and disagrees with
    nothing any more; its own proposal is still counted."""
    off = lambda row: replace(row, disabled=True)  # noqa: E731
    rows = [m("p", "ana", 0.0), off(op("o1", "bob", "agree", "p")), off(m("near", "cy", 1.0)),
            op("o2", "dee", "disagree", "p"), off(m("q", "eve", 50.0)),
            op("o3", "fay", "agree", "q")]  # fmt: skip
    got = agreements(rows, 3)
    assert got["p"] == (0, 1) and got["q"] == (1, 0)
    d = lambda u, a, deg: Row(u, "direction", a, "pending", direction_deg=deg)  # noqa: E731
    answers = [d("d1", "ana", 90), off(d("d2", "bob", 95)), off(d("d3", "cy", 200))]
    assert d2_agreements(answers, 20)["d1"] == (0, 0)
    assert statuses([v("a", "ana", "present"), off(v("b", "bob", "present"))], 3) == {
        "a": "pending", "b": "validated"}  # fmt: skip


def test_a_present_verify_is_not_a_proposal():
    assert agreements([v("a", "ana", "present"), v("b", "bob", "present")], 3) == {}


# --- peer mode ---------------------------------------------------------------------------


def test_peer_mode_validates_with_another_author_s_agreement():
    rows = [m("p", "ana", 0.0), op("o", "bob", "agree", "p")]
    assert statuses(rows, 3) == {"p": "validated"}
    assert statuses([m("p", "ana", 0.0)], 3) == {"p": "pending"}


def test_peer_mode_present_and_unsure():
    rows = [v("a", "ana", "present"), v("b", "bob", "present"), v("c", "cy", "unsure"),
            v("d", "dee", "unsure")]  # fmt: skip
    assert statuses(rows, 3) == {"a": "validated", "b": "validated", "c": "pending",
                                 "d": "pending"}  # fmt: skip


def test_peer_mode_never_overrides_a_review_decision():
    rows = [
        v("a", "ana", "not_found", status="rejected", decided=True),
        v("b", "bob", "not_found"),
        v("c", "cy", "present", status="validated", decided=True),
    ]
    got = statuses(rows, 3)
    assert got["a"] == "rejected" and got["c"] == "validated"
    assert got["b"] == "pending"  # ana's rejected not_found no longer agrees


# --- /revue's « confirmée sur place » ------------------------------------------------------


def here(row, on_site=True, disabled=False):
    return replace(row, on_site=on_site, disabled=disabled)


def test_on_site_confirmers_are_other_accounts_agreeing_from_the_spot():
    """A move within the distance, an agree opinion, the same answer to a question: each
    counts once per other account, only made on site, never a disabled account's, a closed
    one's, a disagreement or a verify."""
    d = lambda u, a, deg: Row(u, "direction", a, "pending", direction_deg=deg)  # noqa: E731
    rows = [here(m("p", "ana", 0.0)), here(m("near", "bob", 2.9)), here(m("far", "cy", 10.0)),
            here(op("o1", "dee", "agree", "p")), here(op("o2", "eve", "agree", "p"), None),
            here(op("o3", "fay", "disagree", "p")), here(op("o4", "gil", "agree", "p"),
                                                       disabled=True),
            here(op("o5", "hal", "agree", "p", status="rejected")),
            here(v("nf", "ana", "not_found")), here(v("nf2", "bob", "not_found")),
            here(d("d1", "ana", 90)), here(d("d2", "bob", 105)),
            here(d("d3", "cy", 200))]  # fmt: skip
    got = on_site_confirmers(rows, 3, 20)
    assert got["p"] == {"bob", "dee"}
    assert got["near"] == {"ana"} and got["far"] == set()
    assert got["d1"] == {"bob"} and got["d2"] == {"ana"} and got["d3"] == set()
    # « Introuvable » seconded from the spot (lot 2); a present verify seconds nothing.
    assert got["nf"] == {"bob"} and got["nf2"] == {"ana"}
    assert "o1" not in got  # an opinion is no piece
