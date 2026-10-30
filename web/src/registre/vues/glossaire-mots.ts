// The glossary's terms (/registre/glossaire, view 11; the prototype's glossaire11.js): each one's
// anchor (#g-<id>, which the other views link, e.g. /registre/glossaire#g-accord-cadre) and the
// path of its example, a page of the register. Its words are the catalogue's
// registre.glossaire.mot.<key>.{terme,definition,exemple}, <key> the id with « _ » for « - ». The
// order on the page is the terms' alphabetical order, whatever this list's. A term that names a type of
// fiche wears its sticker (TYPES_MOTS); an example that is a fiche is a link of its type (typeExemple).
// Pure: the tests read it.

import { plain } from "../texte.ts";
import type { TypeCle } from "../types.ts";

export const MOTS: readonly (readonly [id: string, href: string])[] = [
  ["accord-cadre", "/registre/commune/69290/documents?t=con"],
  ["acheteur", "/registre/acheteur/200046977"],
  ["acheteur-national", "/registre/?d=75&t=con"],
  ["acte", "/registre/commune/69283/autorisations/69-20083300"],
  ["affaire", "/registre/contrat/21690283300013202520240600_32323500"],
  ["analyse-algorithmique", "/registre/commune/93066/carte"],
  ["appel-offres", "/registre/contrat/avis-26-71981"],
  ["drones", "/registre/commune/69282/carte"],
  ["autorisation", "/registre/commune/69290"],
  ["beneficiaire", "/registre/commune/69283"],
  ["boamp", "/registre/contrat/avis-26-71981"],
  ["cada", "/registre/commune/69283#s-introuvables"],
  ["carte", "/registre/commune/69123"],
  ["voie-publique", "/registre/commune/69283/autorisations/69-20083300"],
  ["pietons", "/registre/?t=aut&p=pi&d=69"],
  ["totaux", "/registre/commune/94018"],
  ["centrale", "/registre/?t=con"],
  ["csu", "/registre/?p=csu"],
  ["contrat", "/registre/contrat/21690283300013202520240600_32323500"],
  ["contrat-mixte", "/registre/commune/69123/documents?t=con"],
  ["formats", "/registre/commune/69283/documents"],
  ["data-gouv", "/registre/contrat/21690283300013202520240600_32323500"],
  ["decp", "/registre/entreprise/431903954"],
  ["deliberation", "/registre/contrat/sub-EX077568"],
  ["detr", "/registre/?t=sub&d=69"],
  ["dispositif", "/registre/?p=vsa"],
  ["dossier-prefectoral", "/registre/commune/69283/autorisations/69-20083300"],
  ["duree", "/registre/commune/69283/autorisations/69-20083300"],
  ["elections", "/registre/commune/69283#s-temps"],
  ["groupement", "/registre/commune/94018/documents?t=con"],
  ["historique", "/registre/commune/69283/autorisations/69-20083300"],
  ["insee", "/registre/commune/69283"],
  ["lapi", "/registre/?p=lapi"],
  ["licence-ouverte", "/registre/commune/69283/documents"],
  ["lien-probable", "/registre/contrat/avis-20-142345"],
  ["avenant", "/registre/contrat/200054807000172024Z240006F00_45000000"],
  ["montant-prevu", "/registre/commune/69283#s-argent"],
  ["montant-a-verifier", "/registre/commune/94018/documents?t=con"],
  ["nom-non-publie", "/registre/commune/69283/documents?qui=p,n&t=aut"],
  ["odbl", "/registre/commune/69283"],
  ["offres-recues", "/registre/contrat/21690283300013202520240600_32323500"],
  ["openstreetmap", "/registre/commune/69283"],
  ["couverture", "/registre/couverture"],
  ["plafond-partage", "/registre/commune/94018/documents?t=con"],
  ["prefecture-zone", "/registre/?t=aut&d=xx"],
  ["recueil", "/registre/commune/69283/autorisations#a-autres"],
  ["region-sud", "/registre/?t=sub&d=13"],
  ["resultat", "/registre/contrat/avis-20-142345"],
  ["siren", "/registre/entreprise/899832901"],
  ["sirene", "/registre/commune/69283/autorisations/69-20252465"],
  ["subvention", "/registre/commune/91386"],
  ["titulaire", "/registre/entreprise/431903954"],
  ["trace-indicatif", "/registre/commune/69282/carte"],
  ["videoverbalisation", "/registre/commune/69283"],
  ["vsa", "/registre/commune/93066/carte"],
  ["zone-collectee", "/registre/couverture"],
];

/** The terms that name a type of fiche (V2-Types): each wears that type's sticker on the page. */
export const TYPES_MOTS: Readonly<Record<string, TypeCle>> = {
  acheteur: "acheteur",
  titulaire: "entreprise",
  contrat: "con",
  avenant: "mod",
  "appel-offres": "ao",
  acte: "aut",
  subvention: "sub",
};

/** The type of the fiche an example opens (its path), null for a page that is no fiche (a list, the
 * coverage). A document's record by its id's kind: a call for tenders `avis-`, a subsidy `sub-` or
 * `region-`, else a contract; a dossier in a commune's Autorisations opens the commune's fiche. */
export function typeExemple(href: string): TypeCle | null {
  const [, vue, id] = href.split(/[?#]/)[0].split("/").filter(Boolean);
  switch (vue) {
    case "commune":
      return "commune";
    case "departement":
      return "departement";
    case "acheteur":
      return "acheteur";
    case "entreprise":
      return "entreprise";
    case "contrat":
      return /^avis-/.test(id ?? "") ? "ao" : /^(sub|region)-/.test(id ?? "") ? "sub" : "con";
    default:
      return null;
  }
}

/** A term's catalogue key under registre.glossaire.mot (a template path takes no hyphen). */
export const cle = (id: string): string => id.replace(/-/g, "_");

/** A term as the page shows it. */
export type Mot = { id: string; terme: string; definition: string; exemple: string; href: string };

/** The terms with their words (`words(key)` gives registre.glossaire.mot.<key>), alphabetically. */
export function mots(words: (key: string) => string): Mot[] {
  const order = new Intl.Collator("fr");
  return MOTS.map(([id, href]) => {
    const k = `glossaire.mot.${cle(id)}`;
    return {
      id,
      terme: words(`${k}.terme`),
      definition: words(`${k}.definition`),
      exemple: words(`${k}.exemple`),
      href,
    };
  }).sort((a, b) => order.compare(a.terme, b.terme));
}

/** The terms whose word or definition holds the query, accents and case ignored. */
export function filtrer(list: Mot[], query: string): Mot[] {
  const q = plain(query.trim());
  return q
    ? list.filter((m) => plain(m.terme).includes(q) || plain(m.definition).includes(q))
    : list;
}

/** The term an address points at (#g-<id>), "" when none. */
export function ancre(hash: string): string {
  let id = hash.replace(/^#/, "");
  try {
    id = decodeURIComponent(id);
  } catch {
    return "";
  }
  return id.startsWith("g-") && MOTS.some(([m]) => `g-${m}` === id) ? id.slice(2) : "";
}
