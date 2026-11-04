"""The complementary fields (lot R4.2): each kept only when its passage is in the text and its
value in its closed list; a sole trader's address never kept; the lighter window keeps the
requests, the considerations and the articles; an act is reread only when the rules
disagree or a passage is missing; an act read already gets its complementary fields alone."""

from __future__ import annotations

import datetime as dt

from collecte_fake import COMMUNES, raa

import lacarte_registre as registre
from lacarte_collecte import modele, nouveaux, parse_raa, textes

CONF = nouveaux.regles(registre.RULES)
WHEN = dt.date(2026, 11, 3)
PARIS = parse_raa.Communes(
    {
        "75056": {"nom": "Paris", "dep": "75"},
        "93066": {"nom": "Saint-Denis", "dep": "93"},
        "94028": {"nom": "Créteil", "dep": "94"},
    },
    {"75", "93", "94"},
)
TEXT = (
    "Vu la demande du 2 novembre 2026 de la direction de la sécurité de proximité de "
    "l'agglomération parisienne ; Considérant le mouvement social lycéen et étudiant annoncé "
    "aux abords des lycées et des universités du 14e arrondissement ; Considérant les risques "
    "pour la sécurité des rassemblements de personnes ; ARRÊTE Article 1 : la captation est "
    "autorisée à Paris et à Saint-Denis, dans trois périmètres figurant en annexe, place "
    "Denfert-Rochereau et boulevard Raspail."
)


def f(v, c):
    return {"valeur": v, "citation": c}


def test_a_drone_act_s_complementary_fields_checked():
    lu = {
        "motif": f("manifestation", "le mouvement social lycéen et étudiant annoncé"),
        "motif_libelle": f(
            "mouvement social lycéen et étudiant", "le mouvement social lycéen et étudiant annoncé"
        ),
        "service": f(
            "direction de la sécurité de proximité de l'agglomération parisienne",
            "de la direction de la sécurité de proximité de l'agglomération parisienne",
        ),
        "finalites": f(["rassemblements", "pas_dans_la_liste"], "la sécurité des rassemblements"),
        "lieux": [
            {
                "texte": "14e arrondissement",
                "genre": "arrondissement",
                "citation": "du 14e arrondissement",
            },  # noqa: E501
            {
                "texte": "place Denfert-Rochereau",
                "genre": "place",
                "citation": "place Denfert-Rochereau",
            },  # noqa: E501
            {"texte": "rue inventée", "genre": "rue", "citation": "rue inventée"},
        ],
        "n_perimetres": f(3, "dans trois périmètres figurant en annexe"),
        "communes": f(["Paris", "Saint-Denis", "Créteil"], "autorisée à Paris et à Saint-Denis"),
    }
    m = nouveaux.controler(lu, TEXT, PARIS, WHEN, CONF, "drone")
    assert m["motif"] == "manifestation" and m["finalites"] == ["rassemblements"]
    assert m["motif_libelle"] == "mouvement social lycéen et étudiant"
    assert [p["texte"] for p in m["lieux"]] == ["14e arrondissement", "place Denfert-Rochereau"]
    assert m["n_perimetres"] == 3 and m["communes"] == ["75056", "93066"]
    # a category outside the list, a label not in its passage: empty
    lu["motif"] = f("emeute", "le mouvement social lycéen et étudiant annoncé")
    lu["motif_libelle"] = f("grève", "le mouvement social lycéen et étudiant annoncé")
    m = nouveaux.controler(lu, TEXT, PARIS, WHEN, CONF, "drone")
    assert m["motif"] is None and m["motif_libelle"] is None


def test_a_sole_trader_s_address_is_never_kept():
    text = (
        "Article 1 : M. X, EI, est autorisé à installer au 12 rue de la Paix un système de "
        "vidéoprotection. La SARL Boulangerie du Centre, 4 avenue Foch, est autorisée. Les "
        "images sont conservées 15 jours. L'autorisation vaut jusqu'au 3 novembre 2031."
    )
    lu = {
        "adresse": f("12 rue de la Paix", "au 12 rue de la Paix"),
        "petitionnaire": f("personne_morale", "M. X, EI,"),
        "conservation_jours": f(15, "Les images sont conservées 15 jours"),
        "echeance": f("2031-11-03", "jusqu'au 3 novembre 2031"),
        "nature": f("nouvelle", "est autorisé à installer"),
        "etablissement": f("commerce", "La SARL Boulangerie du Centre"),
    }
    m = nouveaux.controler(lu, text, PARIS, WHEN, CONF, "videoprotection")
    assert m["adresse"] is None and "petitionnaire" not in m
    assert (m["conservation_jours"], m["echeance"], m["nature"]) == (15, "2031-11-03", "nouvelle")
    lu["adresse"] = f("4 avenue Foch", "4 avenue Foch")
    lu["petitionnaire"] = f("personne_morale", "La SARL Boulangerie du Centre")
    assert nouveaux.controler(lu, text, PARIS, WHEN, CONF, "videoprotection")["adresse"] == (
        "4 avenue Foch"
    )
    # a petitioner not proved a company: the commune alone
    lu["petitionnaire"] = f("personne_morale", "M. X, EI,")
    assert nouveaux.controler(lu, text, PARIS, WHEN, CONF, "videoprotection")["adresse"] is None


def test_the_lighter_window_keeps_what_the_reading_needs():
    t = raa("pref57")["content"]
    w = textes.alleger(t)
    assert len(w) < len(t)
    assert "Vu le code" not in w and "sont chargés chacun" not in w
    for kept in (
        "Vu la demande du 6 juillet",
        "Considérant la demande",
        "au moyen de deux caméras",
    ):
        assert kept in w


def test_reread_only_on_a_disagreement_or_a_missing_passage():
    a = {"commune": "Paris", "insee": "75056", "champs": {"n_cameras_drone": 2}}
    text = "au moyen de deux caméras à Paris"
    lu = {
        "commune": f("Paris", "à Paris"),
        "n_cameras_drone": f(2, "au moyen de deux caméras"),
    }
    m = modele.controler(lu, text, PARIS, WHEN)
    assert modele.premiere_lecture(a, lu, m, text)[2] is False
    lu["horaires"] = f(["08h00-20h00"], None)  # a value without its passage
    assert modele.premiere_lecture(a, lu, m, text)[2] is True
    lu.pop("horaires")
    lu["n_cameras_drone"] = f(3, "au moyen de deux caméras")
    m = modele.controler(lu, text, PARIS, WHEN)
    fields, disputed, again = modele.premiere_lecture(
        {**a, "champs": {"n_cameras_drone": 3}}, lu, m, text
    )
    assert not disputed and again is False  # the check dropped the 3: nothing to dispute
    assert "perimetre" not in modele.ARBITRES and "dates" in modele.ARBITRES


def test_an_act_read_already_gets_its_complementary_fields_alone(tmp_path):
    from lacarte_collecte.contexte import Contexte
    from lacarte_collecte.etat import Store

    ctx = Contexte(root=tmp_path, sortie=tmp_path / "s", rules_dir=registre.RULES)
    Store(tmp_path, "actes").add(
        [{"id": i, "administration": "ppparis", "type": "drone"} for i in ("lu", "neuf", "fait")]
    )
    fp2 = nouveaux.empreinte(CONF)
    Store(tmp_path, "champs").add(
        [
            {"id": "lu", "empreinte": modele.empreinte(), "champs": {}},
            {
                "id": "fait",
                "empreinte": modele.empreinte(),
                "empreinte_nouveaux": fp2,
                "champs": {},
            },
        ]
    )
    assert [a["id"] for a in modele.a_completer(ctx)] == ["lu"]
    assert [a["id"] for a in modele.a_lire(ctx)] == ["neuf"]
    # the whole instruction holds the first fields' schema and the complementary ones
    s = modele.schema_complet(CONF)
    assert set(modele.CHAMPS) <= set(s["required"]) and set(nouveaux.CHAMPS) <= set(s["required"])
    seul = nouveaux.schema_seul(CONF)
    assert set(seul["required"]) == set(seul["properties"]) >= {"trouve", *nouveaux.CHAMPS}
    assert set(s["required"]) == set(s["properties"])
    _ = COMMUNES


def test_the_whole_schema_stays_within_the_api_s_16_union_parameters():
    """The batches refused the first whole schema: 39 parameters with unions, the API's limit
    is 16 (the first fields' schema has 16 by itself)."""

    def unions(x):
        if isinstance(x, dict):
            here = int(isinstance(x.get("type"), list) or "anyOf" in x)
            return here + sum(unions(v) for v in x.values())
        if isinstance(x, list):
            return sum(unions(v) for v in x)
        return 0

    assert unions(modele.schema_complet(CONF)) <= 16
    assert unions(nouveaux.schema_seul(CONF)) <= 16
    m = nouveaux.controler(
        {"motif": f("aucun", ""), "n_perimetres": f(0, ""), "service": f("", "")},
        TEXT, PARIS, WHEN, CONF, "drone",
    )  # fmt: skip
    assert m["motif"] is None and m["n_perimetres"] is None and m["service"] is None
