"""The BOAMP from the DILA's archives, on a day of 2026 and a yearly file of 2024 recorded from the
server (cleaned: no natural person)."""

from __future__ import annotations

import datetime as dt
import json
from pathlib import Path

from collecte_fake import COMMUNES, FIX, KINDS, communes, ctx_for, raa  # noqa: F401

from lacarte_collecte import dila
from lacarte_collecte.etat import Store


def test_a_day_of_the_dila_its_notices_cleaned_with_their_mention(collecte_server, tmp_path):
    ctx = ctx_for(collecte_server, tmp_path, dt.date(2026, 10, 15))
    f = ctx.fetcher("dila")
    store = Store(tmp_path, "avis")
    st = dila.collect_day(ctx, dila.Http(f), dt.date(2026, 10, 14), store)
    assert st["termine"] is True and st["fichiers"] == 3
    got = {n["idweb"]: n for n in store.records()}
    # Vanves says video in its body only; the Euralille shuttle is not about video
    assert set(got) == {"26-98610", "26-98743"}
    vanves = got["26-98610"]
    assert vanves["departements"] == ["92"] and vanves["nature"] == "avis"
    assert vanves["mention"]["source"] == "DILA" and vanves["mention"]["fichier"] == "26-98610.xml"
    assert vanves["mention"]["adresse"].endswith("/dila/2026/10/14/26-98610.xml")
    assert vanves["mention"]["date_fichier"] == "Wed, 14 Oct 2026 22:15:00 GMT"
    text = json.dumps(list(got.values()), ensure_ascii=False)
    assert "@" not in text.replace("@type", "")
    # the same day again: nothing asked but the folder, no duplicate
    before = len(collecte_server.asked)
    dila.collect_day(ctx, dila.Http(f), dt.date(2026, 10, 14), store)
    assert len(collecte_server.asked) - before == 1 and len(list(store.records())) == 2


def test_a_cut_day_resumes_where_it_stopped(collecte_server, tmp_path):
    ctx = ctx_for(collecte_server, tmp_path, dt.date(2026, 10, 15))
    ticks = iter(range(100))
    ctx.clock, ctx.deadline = (lambda: next(ticks)), 1  # out of time after the first notice
    store = Store(tmp_path, "avis")
    st = dila.collect_day(ctx, dila.Http(ctx.fetcher("dila")), dt.date(2026, 10, 14), store)
    assert st["statut"] == "en_cours" and len(st["lus"]) == 1
    ctx.deadline = float("inf")
    st = dila.collect_day(ctx, dila.Http(ctx.fetcher("dila")), dt.date(2026, 10, 14), store)
    assert st["termine"] and len(st["lus"]) == 3 and len({n["id"] for n in store.records()}) == 2


def test_a_yearly_file_of_the_former_schema_read_then_deleted(collecte_server, tmp_path):
    ctx = ctx_for(collecte_server, tmp_path, dt.date(2026, 10, 15))
    store = Store(tmp_path, "avis")
    st = dila.collect_yearly(ctx, ctx.fetcher("dila"), 2024, store)
    assert st["termine"] and st["avis_video"] == 1
    [n] = store.records()
    assert n["idweb"] == "24-4689" and n["mention"]["fichier"].startswith("MAPA-AO.tar.gz/")
    assert not any((tmp_path / "tmp").iterdir())  # the archive is gone
    # 2024's day folders are read day by day, not as yearly files
    assert not any("/2024/01/" in a for a in collecte_server.asked)


class FakeFtp:
    """An FTP connection over the recorded day: NLST, RETR, MDTM, as ftplib's."""

    def __init__(self, root: Path) -> None:
        self.root = root
        self.asked: list[str] = []

    def nlst(self, path: str) -> list[str]:

        self.asked.append(f"NLST {path}")
        local = self.root / path.removeprefix("/BOAMP/")
        if not local.is_dir():
            return []  # the DILA's server: an empty list, no 550
        return [f"{path}{p.name}" for p in sorted(local.iterdir())]

    def retrbinary(self, cmd: str, callback, blocksize: int = 8192) -> str:
        path = cmd.removeprefix("RETR ")
        self.asked.append(f"RETR {path}")
        data = (self.root / path.removeprefix("/BOAMP/")).read_bytes()
        for i in range(0, len(data), blocksize):
            callback(data[i : i + blocksize])
        return "226 Transfer complete"

    def sendcmd(self, cmd: str) -> str:
        return "213 20261014221500"


def test_the_history_over_one_ftps_connection_at_a_capped_rate(collecte_server, tmp_path):
    from lacarte_collecte import ftps

    ctx = ctx_for(collecte_server, tmp_path, dt.date(2026, 10, 15))
    ftp = FakeFtp(FIX / "dila")
    clock = {"t": 0.0}
    slept: list[float] = []

    def sleep(s: float) -> None:
        slept.append(s)
        clock["t"] += s

    canal = ftps.Ftps(ftp, "/BOAMP/", rate_kb=64, sleep=sleep, clock=lambda: clock["t"])
    store = Store(tmp_path, "avis")
    st = dila.collect_day(ctx, canal, dt.date(2026, 10, 14), store)
    assert st["termine"] and st["canal"] == "ftps"
    got = {n["idweb"]: n for n in store.records()}
    assert set(got) == {"26-98610", "26-98743"}
    # the mention cites the archive's public address, and says the channel
    m = got["26-98610"]["mention"]
    assert m["adresse"].endswith("/2026/10/14/26-98610.xml") and m["canal"] == "ftps"
    assert m["date_fichier"] == "20261014221500"
    # the rate: ~110 KB read at 64 KB/s take at least ~1.7 s of waiting, no request made
    assert sum(slept) >= 1.5 and not any("/2026/10/14/" in a for a in collecte_server.asked)
    # a folder FTPS lists empty is unknown to it (collect() asks HTTP then)
    assert canal.files("2026/10/13/") is None and canal.files("FluxHistorique/x/") is None


AWARD = b"""<?xml version='1.0' encoding='utf-8'?>
<ns0:ann xmlns:ns0="http://boamp.journal-officiel.gouv.fr/XML/3.2.5"
 xmlns:ns1="urn:boamp:names:specification:ubl:schema:xsd:CommonExtensionComponents-2"
 xmlns:ns2="http://data.europa.eu/p27/eforms-ubl-extensions/1"
 xmlns:ns3="http://data.europa.eu/p27/eforms-ubl-extension-aggregate-components/1"
 xmlns:ns4="urn:boamp:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
 xmlns:ns5="urn:boamp:names:specification:ubl:schema:xsd:CommonAggregateComponents-2">
 <GESTION><REFERENCE><IDWEB>26-1</IDWEB></REFERENCE>
  <TYPE_AVIS><NATURE><ATTRIBUTION/></NATURE></TYPE_AVIS></GESTION>
 <DONNEES><EFORMS><ContractAwardNotice><ns1:UBLExtensions><ns1:UBLExtension>
  <ns1:ExtensionContent><ns2:EformsExtension>
   <ns3:NoticeResult>
    <ns3:SettledContract><ns4:IssueDate>2026-01-06+01:00</ns4:IssueDate></ns3:SettledContract>
    <ns3:TenderingParty><ns3:Tenderer><ns4:ID>ORG-0002</ns4:ID></ns3:Tenderer></ns3:TenderingParty>
   </ns3:NoticeResult>
   <ns3:Organizations><ns3:Organization><ns3:Company>
    <ns5:PartyIdentification><ns4:ID>ORG-0002</ns4:ID></ns5:PartyIdentification>
    <ns5:PartyName><ns4:Name>Video Exemple SAS</ns4:Name></ns5:PartyName>
    <ns5:PartyLegalEntity><ns4:CompanyID>100000009</ns4:CompanyID></ns5:PartyLegalEntity>
   </ns3:Company></ns3:Organization></ns3:Organizations>
  </ns2:EformsExtension></ns1:ExtensionContent></ns1:UBLExtension></ns1:UBLExtensions>
 </ContractAwardNotice></EFORMS></DONNEES></ns0:ann>"""


def test_an_eforms_award_keeps_its_prefixes_and_says_its_holder_and_date():
    # the eForms namespaces end in /1: read without their prefix, the holder was lost
    rec = dila.record(AWARD)
    ext = rec["donnees"]["ext:UBLExtensions"]["ext:UBLExtension"]["ext:ExtensionContent"]
    assert set(ext["efext:EformsExtension"]) == {"efac:NoticeResult", "efac:Organizations"}
    got = dila.boamp._resultat(dila.boamp.clean(rec)["donnees"])
    assert got["titulaires"] == ["100000009"] and got["date_attribution"] == "2026-01-06"
    assert got["cles"]  # the holder's name, as its fingerprint only


# A notice of the shape of the DILA's eForms awards (names and ids invented): the platform
# that sends it first (ORG-0001, another town), the buyer (ORG-0002), two lots, one awarded to
# a company with 2 tenders, one awarded to a person (NaturalPersonIndicator, efac:Organization's
# child, their name and address efac:Company's) with 1 tender, a beneficial owner.
LOTS = """<?xml version='1.0' encoding='utf-8'?>
<ns0:ann xmlns:ns0="http://boamp.journal-officiel.gouv.fr/XML/3.2.5"
 xmlns:e="urn:boamp:names:specification:ubl:schema:xsd:CommonExtensionComponents-2"
 xmlns:x="http://data.europa.eu/p27/eforms-ubl-extensions/1"
 xmlns:a="http://data.europa.eu/p27/eforms-ubl-extension-aggregate-components/1"
 xmlns:b="http://data.europa.eu/p27/eforms-ubl-extension-basic-components/1"
 xmlns:cbc="urn:boamp:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
 xmlns:cac="urn:boamp:names:specification:ubl:schema:xsd:CommonAggregateComponents-2">
 <GESTION><REFERENCE><IDWEB>26-2</IDWEB></REFERENCE>
  <TYPE_AVIS><NATURE><ATTRIBUTION/></NATURE></TYPE_AVIS>
  <INDEXATION><RESUME_OBJET>Extension du système de vidéoprotection urbaine</RESUME_OBJET>
  </INDEXATION></GESTION>
 <DONNEES><EFORMS><ContractAwardNotice><e:UBLExtensions><e:UBLExtension>
  <e:ExtensionContent><x:EformsExtension>
   <a:NoticeResult>
    <a:LotResult><cbc:TenderResultCode>selec-w</cbc:TenderResultCode>
     <a:ReceivedSubmissionsStatistics><b:StatisticsCode>tenders</b:StatisticsCode>
      <b:StatisticsNumeric>2</b:StatisticsNumeric></a:ReceivedSubmissionsStatistics>
     <a:TenderLot><cbc:ID>LOT-0001</cbc:ID></a:TenderLot></a:LotResult>
    <a:LotResult><cbc:TenderResultCode>selec-w</cbc:TenderResultCode>
     <a:ReceivedSubmissionsStatistics><b:StatisticsCode>tenders</b:StatisticsCode>
      <b:StatisticsNumeric>1</b:StatisticsNumeric></a:ReceivedSubmissionsStatistics>
     <a:TenderLot><cbc:ID>LOT-0002</cbc:ID></a:TenderLot></a:LotResult>
    <a:SettledContract><cbc:IssueDate>2026-03-02+01:00</cbc:IssueDate></a:SettledContract>
    <a:TenderingParty><a:Tenderer><cbc:ID>ORG-0003</cbc:ID></a:Tenderer></a:TenderingParty>
    <a:TenderingParty><a:Tenderer><cbc:ID>ORG-0004</cbc:ID></a:Tenderer></a:TenderingParty>
   </a:NoticeResult>
   <a:Organizations>
    <a:Organization><a:Company>
     <cac:PartyIdentification><cbc:ID>ORG-0001</cbc:ID></cac:PartyIdentification>
     <cac:PartyName><cbc:Name>Plateforme Exemple</cbc:Name></cac:PartyName>
     <cac:PostalAddress><cbc:CityName>Seyssinet-Pariset</cbc:CityName>
      <cbc:PostalZone>38170</cbc:PostalZone></cac:PostalAddress></a:Company></a:Organization>
    <a:Organization><a:Company>
     <cac:PartyIdentification><cbc:ID>ORG-0002</cbc:ID></cac:PartyIdentification>
     <cac:PostalAddress><cbc:CityName>Lyon Cedex 02</cbc:CityName>
      <cbc:PostalZone>69205</cbc:PostalZone></cac:PostalAddress></a:Company></a:Organization>
    <a:Organization><a:UltimateBeneficialOwner><cbc:ID>UBO-0001</cbc:ID>
      <cbc:FamilyName>Exemple</cbc:FamilyName></a:UltimateBeneficialOwner><a:Company>
     <cac:PartyIdentification><cbc:ID>ORG-0003</cbc:ID></cac:PartyIdentification>
     <cac:PartyName><cbc:Name>Video Exemple SAS</cbc:Name></cac:PartyName>
     <cac:PartyLegalEntity><cbc:CompanyID>100000009</cbc:CompanyID></cac:PartyLegalEntity>
    </a:Company></a:Organization>
    <a:Organization><b:NaturalPersonIndicator>true</b:NaturalPersonIndicator><a:Company>
     <cac:PartyIdentification><cbc:ID>ORG-0004</cbc:ID></cac:PartyIdentification>
     <cac:PartyName><cbc:Name>Jeanne Exemple</cbc:Name></cac:PartyName>
     <cac:PostalAddress><cbc:StreetName>1 rue Exemple</cbc:StreetName>
      <cbc:CityName>Villeexemple</cbc:CityName></cac:PostalAddress>
     <cac:PartyLegalEntity><cbc:CompanyID>100000017</cbc:CompanyID></cac:PartyLegalEntity>
    </a:Company></a:Organization>
   </a:Organizations>
  </x:EformsExtension></e:ExtensionContent></e:UBLExtension></e:UBLExtensions>
  <cac:ContractingParty><cac:Party><cac:PartyIdentification><cbc:ID>ORG-0002</cbc:ID>
   </cac:PartyIdentification></cac:Party></cac:ContractingParty>
  <cac:TenderingProcess><cbc:ProcedureCode>open</cbc:ProcedureCode></cac:TenderingProcess>
  <cac:ProcurementProject><cbc:Name>Vidéoprotection</cbc:Name></cac:ProcurementProject>
  <cac:ProcurementProjectLot><cbc:ID>LOT-0001</cbc:ID>
   <cac:TenderingTerms><cac:AwardingTerms><cac:AwardingCriterion>
    <cac:SubordinateAwardingCriterion><e:UBLExtensions><e:UBLExtension><e:ExtensionContent>
     <x:EformsExtension><a:AwardCriterionParameter><b:ParameterCode>per-exa</b:ParameterCode>
      <b:ParameterNumeric>60</b:ParameterNumeric></a:AwardCriterionParameter></x:EformsExtension>
     </e:ExtensionContent></e:UBLExtension></e:UBLExtensions>
     <cbc:AwardingCriterionTypeCode>quality</cbc:AwardingCriterionTypeCode>
    </cac:SubordinateAwardingCriterion>
    <cac:SubordinateAwardingCriterion><e:UBLExtensions><e:UBLExtension><e:ExtensionContent>
     <x:EformsExtension><a:AwardCriterionParameter><b:ParameterCode>per-exa</b:ParameterCode>
      <b:ParameterNumeric>40</b:ParameterNumeric></a:AwardCriterionParameter></x:EformsExtension>
     </e:ExtensionContent></e:UBLExtension></e:UBLExtensions>
     <cbc:AwardingCriterionTypeCode>price</cbc:AwardingCriterionTypeCode>
    </cac:SubordinateAwardingCriterion>
   </cac:AwardingCriterion></cac:AwardingTerms></cac:TenderingTerms>
   <cac:ProcurementProject><cbc:Name>Caméras</cbc:Name>
    <cac:PlannedPeriod><cbc:DurationMeasure unitCode="MONTH">12</cbc:DurationMeasure>
    </cac:PlannedPeriod>
    <cac:ContractExtension><cbc:MaximumNumberNumeric>3</cbc:MaximumNumberNumeric>
    </cac:ContractExtension>
    <cac:RealizedLocation><cac:Address><cbc:CityName>Lyon</cbc:CityName>
     <cbc:PostalZone>69001</cbc:PostalZone></cac:Address></cac:RealizedLocation>
   </cac:ProcurementProject></cac:ProcurementProjectLot>
  <cac:ProcurementProjectLot><cbc:ID>LOT-0002</cbc:ID>
   <cac:ProcurementProject><cbc:Name>Maintenance</cbc:Name>
    <cac:PlannedPeriod><cbc:StartDate>2026-04-01+02:00</cbc:StartDate>
     <cbc:EndDate>2028-03-31+02:00</cbc:EndDate></cac:PlannedPeriod>
   </cac:ProcurementProject></cac:ProcurementProjectLot>
 </ContractAwardNotice></EFORMS></DONNEES></ns0:ann>""".encode()


def test_an_eforms_award_says_its_lots_tenders_criteria_buyer_and_never_a_person():
    n = dila.notice(LOTS, {})
    ef = n["eforms"]
    # where: the buyer's own address, not the platform that sent the notice
    assert n["lieu"] == {"cp": "69205", "ville": "Lyon"}
    assert ef["lieu_execution"]["ville"] == "Lyon" and ef["procedure"] == "open"
    assert [(r["lot"], r["issue"], r["offres"]) for r in ef["resultats"]] == [
        ("LOT-0001", "attribue", 2),
        ("LOT-0002", "attribue", 1),
    ]
    assert ef["issue"] == "attribue" and ef["offres"] is None  # two lots: per lot only
    one, two = ef["lots"]
    assert (one["duree_mois"], one["reconductions"], one["poids_prix"]) == (12.0, 3, 40)
    assert [c["type"] for c in one["criteres"]] == ["quality", "price"]
    assert two["duree_mois"] == 24.0 and two["criteres"] == [] and two["poids_prix"] is None
    # the company is a holder; the person is counted, never named, placed or identified
    assert n["resultat"]["titulaires"] == ["100000009"]
    assert n["resultat"]["titulaires_personnes"] == 1
    cleaned = json.dumps(dila.boamp.clean(dila.record(LOTS)), ensure_ascii=False)
    for s in ("Jeanne", "1 rue Exemple", "Villeexemple", "100000017", "UBO-0001"):
        assert s not in cleaned and s not in json.dumps(n, ensure_ascii=False)


def test_a_former_schema_notice_has_no_eforms_fields():
    assert dila.boamp.eforms({"IDENTITE": {"VILLE": "Lyon"}}) is None


def test_a_notice_kept_by_an_older_reading_is_read_again_by_its_address_once(
    collecte_server, tmp_path
):
    ctx = ctx_for(collecte_server, tmp_path, dt.date(2026, 10, 15))
    http = dila.Http(ctx.fetcher("dila"))
    store = Store(tmp_path, "avis")
    base = http.base
    # as the 05/11 reading kept it: no `lecture`, its result empty
    old = {"idweb": "26-98610", "id": "26-98610", "date": "2026-10-14", "nature": "avis",
           "resultat": {"titulaires": []},
           "mention": {"source": "DILA", "adresse": base + "2026/10/14/26-98610.xml",
                       "fichier": "26-98610.xml"}}  # fmt: skip
    gone = {**old, "idweb": "26-1", "id": "26-1",
            "mention": {**old["mention"], "adresse": base + "2026/10/14/26-1.xml",
                        "fichier": "26-1.xml"}}  # fmt: skip
    yearly = {**old, "idweb": "23-1", "id": "23-1",
              "mention": {"adresse": base + "FluxHistorique/2023/x.tar.gz"}}  # fmt: skip
    store.add([old, gone, yearly])
    before = len(collecte_server.asked)
    got = dila.relire(ctx, http, store)
    recs = {n["id"]: n for n in store.records()}
    assert recs["26-98610"]["lecture"] == dila.LECTURE and recs["26-98610"]["eforms"]
    assert recs["26-98610"]["lieu"]["ville"]  # read again: the buyer's place
    # gone from the archive: its former reading kept, marked, never asked again
    assert recs["26-1"]["relecture"] == "absent" and recs["26-1"]["resultat"] == {"titulaires": []}
    assert "lecture" not in recs["23-1"]  # a yearly archive's notice is not read one by one
    assert got["faits"] == {"relu": 1, "absent": 1} and got["restant"] == 0
    asked = len(collecte_server.asked) - before
    dila.relire(ctx, http, store)
    assert len(collecte_server.asked) - before == asked  # nothing asked the second time
