# Registre test extract

A small extract of the registre's pilot export, in its own layout and format (files of
`window.NAME = <JSON>;` assignments), read by `tests/test_registre_*.py` through
`lacarte-registre importer-pilote` then `lacarte-registre construire`.

What it holds, its records trimmed to the fields the rules read:
- every contract of the Rhône (238, of which 194 counted for 108,7 M€), Serfim T.I.C.'s
  contracts elsewhere and the Sytral's;
- Mions' documents (19, of which 11 acts and two drone acts it shares with other communes),
  the originals of those two acts, the affaires of Mions and their documents;
- one video-protection act whose number of cameras is unreadable, one drone act of the
  police prefecture with no zone drawn, one drone act placed by its zone (Lyon), the
  State's grants listed by the préfecture du Rhône;
- the lots and doublons, buyers, companies, communes, intercommunalities and drone zones
  (ids and review status only, no outline) these documents name; Mions' and the Sytral's
  short labels, written for the project.

Every beneficiary of an act that is not a public body is masked (`[non retenu]`); companies
are legal persons as named in SIRENE.

Sources and licences:
- contracts and their modifications: données essentielles de la commande publique (DECP,
  data.gouv.fr); notices: BOAMP (DILA); prefectoral acts: recueils des actes administratifs
  of the préfecture du Rhône and the préfecture de police; grants: the préfecture du
  Rhône's DETR and DPV lists; companies: SIRENE (INSEE); communes and intercommunalities:
  Code officiel géographique (INSEE) and geo.api.gouv.fr — all under the Licence Ouverte 2.0
  (Etalab).
- map counts (`geo/cartes.js`): cameras mapped per commune, from OpenStreetMap,
  © OpenStreetMap contributors, ODbL.
- Mions' tilted map layers (`prototype-v10/carte/69283.json`: its outline, cameras, filmed
  streets and fields of view, cut from the map's build): from OpenStreetMap, © OpenStreetMap
  contributors, ODbL; the outline from IGN Admin Express COG Carto 2026, Licence Ouverte 2.0.
