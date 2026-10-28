// The register's paths (one page, registre.html, served for every /registre/… path by Caddy):
// /registre/, /registre/chiffres, /registre/couverture, /registre/commune/<insee>, …/documents,
// …/autorisations[/<dossier>]. What is not a register path yet is « introuvable ». Pure: the tests
// read it, the page's router (main.ts) uses it.

export type Route =
  | { view: "registre"; q: Record<string, string> }
  | { view: "chiffres" }
  | { view: "couverture" }
  | { view: "commune"; insee: string }
  | { view: "documents"; insee: string; q: Record<string, string> }
  | { view: "autorisations"; insee: string; dossier: string }
  | { view: "introuvable" };

const INSEE = /^(\d[\dAB]\d{3})$/;

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
  if (a === "couverture" && !b) return { view: "couverture" };
  if (a === "commune" && b && INSEE.test(b)) {
    if (!c) return { view: "commune", insee: b };
    if (c === "documents" && !d) return { view: "documents", insee: b, q };
    if (c === "autorisations") return { view: "autorisations", insee: b, dossier: d ?? "" };
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
