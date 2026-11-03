"""The model's fields checked against the act's text (the Moselle's fixture), and the agreement
with the rules, field by field: a passage not in the text, a number not in its passage, a
commune outside the act's département are never kept."""

from __future__ import annotations

import datetime as dt

from collecte_fake import COMMUNES, raa

from lacarte_collecte import modele, parse_raa

TEXT = raa("pref57")["content"]
WHEN = dt.date(2026, 7, 8)
METZ = parse_raa.Communes(COMMUNES["communes"], {"57"})


def f(v, c):
    return {"valeur": v, "citation": c}


def reading(**kw):
    base = {k: f(None, None) for k in modele.CHAMPS}
    return {"trouve": True, "dispositif": "drone", **base, **kw}


def test_a_field_is_kept_only_when_its_passage_proves_it():
    lu = reading(
        commune=f("Metz", "sur cinq secteurs de Metz et de Woippy"),
        n_cameras_drone=f(2, "au moyen de deux caméras installées sur des drones"),
        dates=f(
            ["2026-07-09", "2026-07-19"],
            "les 9, 10 et 11 juillet, 14 et 15 juillet, 18 et 19 juillet",
        ),
        horaires=f(["18h00-03h00"], "de 18h a 3h du matin le lendemain"),
        perimetre=f("Metz centre ville", "Metz centre ville: rue des Alliés"),
    )
    m = modele.controler(lu, TEXT, METZ, WHEN)
    assert (m["commune"], m["insee"], m["n_cameras_drone"]) == ("Metz", "57463", 2)
    assert m["dates"] == ["2026-07-09", "2026-07-19"] and m["horaires"] == ["18h00-03h00"]
    assert m["perimetre"] == "Metz centre ville"


def test_an_invented_passage_a_wrong_number_or_a_far_date_is_dropped():
    lu = reading(
        n_cameras_drone=f(3, "au moyen de deux caméras installées sur des drones"),
        n_total=f(5, "cinq caméras dans un passage qui n'est pas dans le texte"),
        dates=f(["2027-12-01"], "les 9, 10 et 11 juillet"),
        horaires=f(["25h00-03h00"], "de 18h a 3h du matin le lendemain"),
        commune=f("Lyon", "sur cinq secteurs de Metz et de Woippy"),
    )
    m = modele.controler(lu, TEXT, METZ, WHEN)
    assert all(m[k] is None for k in ("n_cameras_drone", "n_total", "dates", "horaires", "commune"))


def test_a_total_may_be_the_sum_the_passage_writes():
    text = "un système de vidéoprotection constitué de 6 caméras intérieures, 1 caméra extérieure."
    lu = reading(n_total=f(7, "constitué de 6 caméras intérieures, 1 caméra extérieure"))
    assert modele.controler(lu, text, METZ, WHEN)["n_total"] == 7


def test_the_agreement_field_by_field():
    rules = {
        "commune": "Metz",
        "insee": "57463",
        "n_cameras_drone": 2,
        "dates": ["2026-07-09"],
        "horaires": None,
        "n_total": None,
    }
    model = {
        "commune": "Metz",
        "n_cameras_drone": 3,
        "dates": ["2026-07-09"],
        "horaires": ["18h00-03h00"],
        "n_total": None,
    }
    fields, disputed = modele.accorder(rules, model)
    assert fields["commune"] == ("Metz", "accord") and fields["horaires"][1] == "modele"
    assert disputed == ["n_cameras_drone"] and "n_total" not in fields
    assert modele.accorder({"n_total": 4}, {})[0] == {"n_total": (4, "regles")}
    # the instruction's fingerprint changes with it: every act read again
    assert len(modele.empreinte()) == 16


def test_no_new_reading_once_the_budget_is_spent(tmp_path):
    import lacarte_registre as registre
    from lacarte_collecte.contexte import Contexte
    from lacarte_collecte.etat import Store

    ctx = Contexte(root=tmp_path, sortie=tmp_path / "s", rules_dir=registre.RULES)
    assert modele.budget(ctx) == 110 and modele.depense(ctx) == 0
    # 100 million Opus output tokens at the batch's price: $1 000
    Store(tmp_path, "couts").add(
        [
            {
                "id": "x",
                "modele": "claude-opus-5-5",
                "usage": {"input": 0, "output": 100_000_000, "cache_write": 0, "cache_read": 0},
            }
        ]
    )
    assert modele.depense(ctx) == 1000
    assert modele.envoyer(ctx, [{"id": "a"}]) is None  # no client asked: nothing sent


def test_the_threshold_field_by_field(tmp_path):
    import lacarte_registre as registre
    from lacarte_collecte.contexte import Contexte
    from lacarte_collecte.etat import Store

    ctx = Contexte(root=tmp_path, sortie=tmp_path / "s", rules_dir=registre.RULES)
    final, refs = [], []
    for i in range(20):
        final.append(
            {
                "id": f"a{i}",
                "champs": {
                    "commune": {"valeur": "Metz", "origine": "accord"},
                    "n_cameras_drone": {"valeur": 2 if i else 3, "origine": "modele"},
                    "horaires": {"valeur": ["18h00-03h00"], "origine": "regles"},
                },
            }
        )
        refs.append(
            {
                "id": f"a{i}",
                "departement": "57",
                "type": "drone",
                "reference": {
                    "commune": "Metz",
                    "n_cameras_drone": 2,
                    "horaires": ["18h00-03h00"],
                    "dates": ["2026-07-09"] if i < 5 else None,
                },
            }
        )
    Store(tmp_path, "champs").add(final)
    Store(tmp_path, "references").add(refs)
    m = modele.mesurer(ctx)["57-drone"]
    assert m["commune"]["publie"] and m["horaires"]["publie"]
    # 19 of 20 right but one number wrong: never published
    assert (m["nombre"]["justes"], m["nombre"]["nombres_faux"], m["nombre"]["publie"]) == (
        19,
        1,
        False,
    )
    assert m["dates"]["justes"] == 15 and not m["dates"]["publie"]  # 75 % < 85 %
