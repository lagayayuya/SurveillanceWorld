// The register's paths (the map's page, served for every /registre/… path by Caddy, the register over it):
// /registre/ (the summary, ?q= its search), a list per type (/registre/communes, …/entreprises,
// …/arretes: LISTES), /registre/couverture, /registre/glossaire, /registre/commune/<insee>,
// …/documents, …/autorisations[/<dossier>], …/carte[?mois=YYYY-MM], a document's record by its type
// (/registre/contrat/<affaire>, …/avis/<affaire>, …/subvention/<affaire>, …/arrete/<affaire>: DOCUMENTS,
// the old contrat/<affaire> of the others answering their new address, nouvelleAdresse),
// /registre/entreprise/<siren>, /registre/acheteur/<siren>, /registre/departement/<code>. Anything else
// is « introuvable ». Two old addresses stay as routes, to be replaced by a list's (listes.ts
// redirection): /registre/chiffres and the old search of documents, /registre/?t=…&d=…&q=…. Pure: the
// tests read it, the page's router (modale.ts) uses it.

/** The lists' addresses, one per type (design/registre/v2, V2-Liste), in the summary's order. */
export const LISTES = [
  "communes",
  "intercommunalites",
  "departements",
  "acheteurs",
  "entreprises",
  "contrats",
  "modifications",
  "appels-d-offres",
  "arretes",
  "subventions",
] as const;
export type Liste = (typeof LISTES)[number];
const estListe = (s: string): s is Liste => (LISTES as readonly string[]).includes(s);

/** A document's record's address, by its type (the build's refs.DOC_PATHS: a contract and its
 * modifications, a notice whose contract was not found, a grant, a decree). */
export const DOCUMENTS = ["contrat", "avis", "subvention", "arrete"] as const;
export type TypeDocument = (typeof DOCUMENTS)[number];
const estDocument = (s: string): s is TypeDocument => (DOCUMENTS as readonly string[]).includes(s);

/** A document's type by its affaire's id (the build's ids: `avis-<idweb>` a notice without its
 * contract, `sub-`, `detr-`, `region-` a grant, `<département>-<number>` a decree, any other a
 * contract): the rule deploy/preview.caddy's 301 follows; tests/test_registre_partage.py checks it
 * against every affaire's kind. */
export function typeDocument(affaire: string): TypeDocument {
  if (/^avis-/.test(affaire)) return "avis";
  if (/^(sub|detr|region)-/.test(affaire)) return "subvention";
  if (/^(\d{2,3}|2[AB])-\d/.test(affaire)) return "arrete";
  return "contrat";
}

/** A document's record's address: /registre/<type>/<affaire>. */
export const documentHref = (affaire: string): string =>
  `/registre/${typeDocument(affaire)}/${encodeURIComponent(affaire)}`;

/** The address an old path has now, or null: /registre/contrat/<affaire> of a notice, a grant or a
 * decree (before each type had its own), as the server's 301 answers it. */
export function nouvelleAdresse(pathname: string): string | null {
  const m = /^\/registre\/contrat\/([^/]+)\/?$/.exec(pathname);
  if (!m) return null;
  const type = typeDocument(decodeURIComponent(m[1]));
  return type === "contrat" ? null : `/registre/${type}/${m[1]}`;
}

export type Route =
  | { view: "registre"; q: Record<string, string> }
  | { view: "chiffres" }
  | { view: "liste"; liste: Liste; q: Record<string, string> }
  | { view: "couverture" }
  | { view: "commune"; insee: string }
  | { view: "documents"; insee: string; q: Record<string, string> }
  | { view: "autorisations"; insee: string; dossier: string }
  | { view: "carte"; insee: string; mois: string }
  | { view: "contrat"; id: string; type: TypeDocument }
  | { view: "entreprise"; siren: string }
  | { view: "acheteur"; siren: string }
  | { view: "departement"; dep: string }
  | { view: "glossaire" }
  | { view: "introuvable" };

const INSEE = /^(\d[\dAB]\d{3})$/;
const SIREN = /^\d{9}$/;
// a département (01–95, 2A, 2B), an overseas one (971–976) or collectivity (975–988)
const DEP = /^(\d[\dAB]|97\d|98\d)$/;
const MOIS = /^\d{4}-(0[1-9]|1[0-2])$/;

export function route(pathname: string, search = ""): Route {
  const q = Object.fromEntries(new URLSearchParams(search));
  const parts = pathname
    .replace(/^\/registre\/?/, "")
    .split("/")
    .filter(Boolean)
    .map(decodeURIComponent);
  const [a, b, c, d] = parts;
  if (!a) return { view: "registre", q };
  if (a === "chiffres" && !b) return { view: "chiffres" };
  if (estListe(a) && !b) return { view: "liste", liste: a, q };
  if (a === "couverture" && !b) return { view: "couverture" };
  if (a === "glossaire" && !b) return { view: "glossaire" };
  if (estDocument(a) && b && !c) return { view: "contrat", id: b, type: a };
  if (a === "entreprise" && b && SIREN.test(b) && !c) return { view: "entreprise", siren: b };
  if (a === "acheteur" && b && SIREN.test(b) && !c) return { view: "acheteur", siren: b };
  if (a === "departement" && b && DEP.test(b) && !c) return { view: "departement", dep: b };
  if (a === "commune" && b && INSEE.test(b)) {
    if (!c) return { view: "commune", insee: b };
    if (c === "documents" && !d) return { view: "documents", insee: b, q };
    if (c === "autorisations") return { view: "autorisations", insee: b, dossier: d ?? "" };
    if (c === "carte" && !d)
      return { view: "carte", insee: b, mois: MOIS.test(q.mois ?? "") ? q.mois : "" };
  }
  return { view: "introuvable" };
}

/** The way back to the map (plan B1.3): the map's own address when the register was opened from it
 * (?carte=, its query and fragment, encoded), else the territory on the map (/?insee=), else the map. */
export function backToMap(search: string, insee?: string): string {
  const carte = new URLSearchParams(search).get("carte");
  if (carte && /^[?#]/.test(carte) && !/[\s<>"]/.test(carte)) return `/${carte}`;
  return insee ? `/?insee=${encodeURIComponent(insee)}` : "/";
}
