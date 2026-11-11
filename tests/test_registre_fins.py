"""The drone acts that are no flight (fins.py, rule:registre_drones@1:fin): bans out of the
register, abrogations and withdrawals without days, the days of the act they cite taken.
Invented snippets, folded as the reader keeps them."""

from __future__ import annotations

import pytest

import lacarte_registre as registre
from lacarte_registre import collecte, drones, fins
from lacarte_registre.regles import is_drone_act

R = fins.regles(registre.RULES)
CAPTE = (
    "article 1er : la captation, l'enregistrement et la transmission d'images par la "
    "direction interdepartementale de la police nationale sont autorises le 5 mai 2026"
)


def act(i: str, titre: str, a1: str = "", adm: str = "pref21", sous_type: str = "autorisation",
        acte: str | None = None, jour: str = "2026-05-02") -> dict:  # fmt: skip
    return {"id": i, "type": "drone", "titre": titre, "sous_type": sous_type,
            "administration": adm, "acte": acte or i, "champs": {"article_1": a1},
            "recueil_date": jour, "date_acte": jour}  # fmt: skip


@pytest.mark.parametrize(
    ("titre", "a1", "sous_type", "want"),
    [
        (
            "Arrêté portant interdiction de survol par des drones",
            "le survol est interdit",
            "autorisation",
            "interdiction",
        ),  # noqa: E501
        (
            "Arrêté portant dérogation de vol de nuit au profit de la société X",
            "une derogation est accordee",
            "autorisation",
            "interdiction",
        ),  # noqa: E501
        # a title of another act, cut with it: its article 1 authorises a flight
        ("Arrêté portant interdiction de la vente de fumigènes", CAPTE, "autorisation", None),
        (
            "Arrêté n° 2026-00063 portant abrogation de l'arrêté n° 2026-00060",
            "",
            "abrogation",
            "abrogation",
        ),  # noqa: E501
        (
            "Arrêté n° 2026-00805 portant retrait de l'arrêté n° 2026-00791",
            "",
            "abrogation",
            "retrait",
        ),  # noqa: E501
        (
            "Arrêté autorisant la captation…",
            "article 1er : l'arrete prefectoral n 822 du 30 avril 2026 est abroge.",
            "autorisation",
            "abrogation",
        ),  # noqa: E501
        (
            "Arrêté autorisant la captation…",
            "article 1er : l'arrete du 7 mars 2025 est abroge et remplace par le present arrete",
            "autorisation",
            None,
        ),  # noqa: E501
        ("Arrêté abrogeant et remplaçant l'arrêté n° 64-2025-02-28-00005", "", "abrogation", None),  # noqa: E501
        # a renewal's article 3 ends the former one: the renewal is a flight
        (
            "Arrêté renouvelant l'autorisation",
            f"{CAPTE} article 2 … article 3 : l'arrete du 1er aout est abroge",
            "renouvellement",
            None,
        ),  # noqa: E501
    ],
)
def test_a_ban_an_abrogation_a_withdrawal_or_a_flight(titre, a1, sous_type, want):
    assert fins.genre(act("x", titre, a1, sous_type=sous_type), R) == want


def test_an_ender_takes_the_act_whose_number_it_cites_and_its_copies():
    acts = [
        act("75-a", "Arrêté n°2026-00580 autorisant la captation", CAPTE, adm="pref75"),
        act("pref92:a", "Arrêté n° 2026-00580autorisant la captation", CAPTE, adm="pref92"),
        act(
            "75-b",
            "Arrêté n°2026-00595 portant abrogation de l'arrêté n° 2026-00580 du 13 mai",
            adm="pref75",
            sous_type="abrogation",
            jour="2026-05-15",
        ),
        act("21-a", "Arrêté préfectoral N° 822 autorisant la captation", CAPTE),
        act("21-b", "Arrêté préfectoral N° 823 autorisant la captation", CAPTE),
        act(
            "21-c",
            "Arrêté autorisant la captation",
            "article 1er : l'arrete prefectoral n822 en date du 30 avril 2026, est abroge.",
        ),
        # two decrees answer « 900 » in two recueils of one prefecture: neither is taken
        act("21-d", "Arrêté N° 900 autorisant la captation", CAPTE),
        act("21-e", "AP 900 autorisant", CAPTE, acte="21-e"),
        act("21-f", "Arrêté portant retrait de l'arrêté n° 900", sous_type="abrogation"),
        act("21-g", "Arrêté portant abrogation d'une autorisation", sous_type="abrogation"),
        act("21-h", "Arrêté portant interdiction de survol"),
    ]
    acts[4]["titre"] += " n 2026-777"  # another number in its head: no match on 822
    f = fins.lire(acts, registre.RULES)
    assert f.interdictions == {"21-h"}
    assert f.fins == {"75-b": "abrogation", "21-c": "abrogation", "21-f": "retrait",
                      "21-g": "abrogation"}  # fmt: skip
    assert f.cible == {"75-b": ["75-a", "pref92:a"], "21-c": ["21-a"]}
    assert f.par["75-a"] == ("75-b", "abrogation", "2026-05-15")


def test_a_withdrawal_takes_every_day_an_abrogation_those_from_its_day():
    days = ["2026-05-14", "2026-05-15", "2026-05-16"]
    assert fins.jours_restants(days, "retrait", "2026-05-15") == []
    assert fins.jours_restants(days, "abrogation", "2026-05-15") == ["2026-05-14"]


def test_the_served_ender_has_no_day_and_the_ended_act_keeps_those_before_it():
    def ev(i, jours):
        return {"id": i, "t": "arrete_drone", "jours": jours, "periode": "x", "date": jours[0],
                "publie": "2026-05-01"}  # fmt: skip

    served = {"a": ev("a", ["2026-05-14", "2026-05-16"]), "b": ev("b", ["2026-05-14"]),
              "c": ev("c", ["2026-05-14"])}  # fmt: skip
    f = fins.Fins(fins={"b": "abrogation", "c": "abrogation"}, cible={"b": ["a"]},
                  par={"a": ("b", "abrogation", "2026-05-15")})  # fmt: skip
    assert collecte._finir(f, served) == 1
    a, b, c = served["a"], served["b"], served["c"]
    assert b["abroge"] == ["a"] and "jours" not in b and b["date"] == "2026-05-01"
    assert b["date_est"] == "recueil"  # its recueil's day, never a flight's
    assert a["abroge_par"] == "b" and a["jours"] == ["2026-05-14"]
    assert a["periode"] == "2026-05-14"
    assert c["abrogation_non_rattachee"] is True and "abroge" not in c
    # an ender is a drone document, not a flight: out of `dr` and « publiés avant le vol »
    assert not is_drone_act(b) and is_drone_act(a)
    assert drones.publication(served.values())["total"] + drones.publication(
        served.values())["non_lus"] == 1  # fmt: skip
