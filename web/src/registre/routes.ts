// The register's paths (the map's page, served for every /registre/… path by Caddy, the register over it):
// /registre/ (the summary, ?q= its search), a list per type (/registre/communes, …/entreprises,
// …/arretes: LISTES), /registre/couverture, /registre/glossaire, /registre/commune/<insee>,
// …/documents, …/autorisations[/<dossier>], …/carte[?mois=YYYY-MM], /registre/contrat/<affaire>,
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

export type Route =
  | { view: "registre"; q: Record<string, string> }
  | { view: "chiffres" }
  | { view: "liste"; liste: Liste; q: Record<string, string> }
  | { view: "couverture" }
  | { view: "commune"; insee: string }
  | { view: "documents"; insee: string; q: Record<string, string> }
  | { view: "autorisations"; insee: string; dossier: string }
  | { view: "carte"; insee: string; mois: string }
  | { view: "contrat"; id: string }
  | { view: "entreprise"; siren: string }
  | { view: "acheteur"; siren: string }
  | { view: "departement"; dep: string }
  | { view: "glossaire" }
  | { view: "introuvable" };

const INSEE = /^(\d[\dAB]\d{3})$/;
const SIREN = /^\d{9}$/;
const DEP = /^(\d[\dAB]|97\d)$/;
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
  if (a === "contrat" && b && !c) return { view: "contrat", id: b };
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
