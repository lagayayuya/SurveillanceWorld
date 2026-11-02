"""The reference readings' plumbing, without the network: the key read from its file, one batch
request per act (the cached instruction, the schema), the cost from the usage, the comparison
on Ju's criterion, and the window around an act (the Moselle's fixture)."""

from __future__ import annotations

import json

import yaml
from collecte_fake import raa

import lacarte_registre as registre
from lacarte_collecte import calibrer, references, textes


def test_the_key_is_read_from_its_file_never_from_the_environment(tmp_path, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    f = tmp_path / "anthropic.env"
    f.write_text("#api\nla-carte=sk-ant-test-0000\n", "utf-8")
    assert references.cle(f) == "sk-ant-test-0000"


def test_one_request_per_act_with_the_cached_instruction_and_the_schema():
    act = {"recueil_nom": "Numéro 150", "date": "2026-07-08", "acte": "371", "texte": "…"}
    r = references.requete(7, act, "claude-haiku-5-5", "medium")
    p = r["params"]
    assert r["custom_id"] == "a7" and p["model"] == "claude-haiku-5-5"
    assert p["system"][0]["cache_control"] == {"type": "ephemeral"}
    assert p["output_config"]["format"]["schema"] is references.SCHEMA
    assert "n° 371" in p["messages"][0]["content"]
    assert set(references.SCHEMA["required"]) == set(references.SCHEMA["properties"])


def test_the_cost_at_the_batch_s_price():
    prix = yaml.safe_load((registre.RULES / "collecte_seuils.yaml").read_text("utf-8"))
    rows = [
        {
            "modele": "claude-sonnet-5-5",
            "usage": {
                "input": 1_000_000,
                "output": 100_000,
                "cache_write": 0,
                "cache_read": 1_000_000,
            },
        }
    ]
    # half of (2 + 1 + 0.2) dollars
    assert references.cout(rows, prix["references"]["prix"])["dollars"] == 1.6


def test_the_comparison_on_the_commune_the_numbers_the_dates_and_the_hours():
    ref = {
        "dispositif": "drone",
        "commune": "Metz",
        "n_cameras_drone": "2",
        "dates": "2026-07-09 au 2026-07-19",
        "horaires": "18h00-03h00",
    }
    lu = references.en_colonnes(
        {
            "statut": "end_turn",
            "modele": "m",
            "lecture": {
                "trouve": True,
                "dispositif": "drone",
                "sous_type": "autorisation",
                "commune": "METZ",
                "n_interieur": None,
                "n_exterieur": None,
                "n_voie_publique": None,
                "n_total": None,
                "dates": ["2026-07-19", "2026-07-09", "2026-07-10"],
                "horaires": ["18h00-03h00"],
                "n_cameras_drone": 2,
                "perimetre": "centre-ville",
                "lisible": "oui",
            },
        },
        "371",
    )
    assert references.comparer(lu, ref) == {
        "commune": True,
        "nombres": True,
        "dates": True,
        "horaires": True,
    }
    assert references.comparer({**lu, "horaires": "8h00-03h00"}, ref)["horaires"] is False
    vp = {
        "dispositif": "videoprotection",
        "commune": "Mions",
        "n_total": "154",
        "n_voie_publique": "125",
        "n_interieur": "9",
        "n_exterieur": "20",
    }
    assert references.comparer(
        {
            "commune": "Mions",
            "n_total": 154,
            "n_voie_publique": 125,
            "n_interieur": 9,
            "n_exterieur": 20,
        },
        vp,
    )["nombres"]
    assert not references.comparer({"commune": "Mions", "n_total": 153}, vp)["nombres"]


def test_an_act_s_window_is_wider_than_our_cut():
    text = raa("pref57")["content"]
    w = textes.fenetre(text, "371")
    assert w and "Cab/PPA n°371" in w and "Article 1" in w
    start = text.index(w)
    assert start < text.index("Cab/PPA n°371") - 100  # context before the heading
    assert textes.fenetre(text, "999999") is None


def test_the_texts_wait_for_the_collection_s_run(monkeypatch):
    class Done:
        stdout = "     Active: activating (start) since Mon 2026-11-02 11:05:30 UTC\n"

    monkeypatch.setattr(calibrer, "_target", lambda: "deploy@example.test")
    monkeypatch.setattr(calibrer.subprocess, "run", lambda *a, **k: Done())
    try:
        calibrer.textes_du_serveur([], "contact")
        raise AssertionError("asked while the unit runs")
    except RuntimeError as e:
        assert "tourne" in str(e)
    Done.stdout = "     Active: inactive (dead) since Sun 2026-11-01 17:04:17 UTC\n"
    calls = []

    def run(*a, **k):
        calls.append(a)

        class R:
            stdout = json.dumps({"id": "x", "texte": "t"}) + "\n"

        return Done() if len(calls) == 1 else R()

    monkeypatch.setattr(calibrer.subprocess, "run", run)
    assert calibrer.textes_du_serveur(
        [{"id": "x", "administration": "a", "recueil": "r", "acte": "1"}], "contact"
    ) == {"x": {"id": "x", "texte": "t"}}


def test_a_rereading_sends_the_first_reading_and_skips_an_act_without_one():
    act = {"recueil_nom": "R", "date": "2026-07-08", "acte": "371", "texte": "…"}
    r = references.requete(0, act, "claude-haiku-5-5", "medium", {"n_total": 39})
    assert '<lecture>\n{"n_total": 39}\n</lecture>' in r["params"]["messages"][0]["content"]

    class Batches:
        def create(self, requests):
            self.sent = requests

            class B:
                id = "msgbatch_x"

            return B()

    class C:
        class messages:  # noqa: N801 (the SDK's attribute)
            batches = Batches()

    bid = references.soumettre(C(), [act, act], "m", "medium", [None, {"n_total": 1}])
    assert bid == "msgbatch_x" and [x["custom_id"] for x in C.messages.batches.sent] == ["a1"]


def test_the_texts_wait_for_an_idle_window(monkeypatch):
    states = iter([(False, 200.0), (True, 5.0), (True, 40.0), (True, 39.0)])
    monkeypatch.setattr(calibrer, "_target", lambda: "deploy@example.test")
    monkeypatch.setattr(calibrer, "libre", lambda t: next(states))
    asked = []

    def fake(acts, contact, timeout=0):
        asked.append([a["id"] for a in acts])
        return {a["id"]: {"id": a["id"], "texte": "t"} for a in acts}

    monkeypatch.setattr(calibrer, "textes_du_serveur", fake)
    slept = []
    acts = [{"id": f"a{i}"} for i in range(30)]
    got = calibrer.textes_en_morceaux(acts, "c", sleep=slept.append)
    # the unit running, then its next run 5 minutes away: two waits; then two chunks
    assert slept == [300, 300] and [len(x) for x in asked] == [20, 10] and len(got) == 30


def test_a_recueil_without_a_summary_is_cut_in_linear_time():
    import time

    from lacarte_collecte import parse_raa

    foot = "\n13_Pref - 13-2026-09-08-{:05d} - Arrêté portant autorisation\n" + "texte " * 40
    txt = "".join(foot.format(i // 3) for i in range(3000))
    t = time.monotonic()
    assert len(parse_raa.split_acts(txt)) == 1000
    assert time.monotonic() - t < 2  # 15 s with the unbounded summary pattern
