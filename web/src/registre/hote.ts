// The register's doors on the map's page (design/registre/v2): the page answers every /registre path
// (Caddy, Vite) and the register opens over the map, which stays behind. This small module rides in
// the map's bundle: it follows the address, opens the register (registre/modale.ts, a chunk of its
// own, asked only then) when it names a register page, closes it when it no longer does, and turns
// every link to a register page, on the map or inside the register, into a move of the page's
// history. The map keeps its own address aside while the register holds the page's (url.ts).
import type { Map as MlMap } from "maplibre-gl";
import { t } from "../i18n.ts";
import { isAside, lastMapAddress, mapAddress, setAside, takeBack } from "../url.ts";

export const REGISTRE = /^\/registre(\/|$)/;

/** Said on the window as the register opens over the map (modale.ts): one modal at a time, the
 * site's own (the welcome, the legal pages, the account's sheet, « Vos contributions ») close
 * (main.ts). */
export const OUVERTURE = "lacarte:registre";

let carte: MlMap | null = null;
let modale: Promise<typeof import("./modale.ts")> | null = null;
const charger = () => {
  modale ??= import("./modale.ts");
  return modale;
};

/** The site's map, behind the register (Carte et drones draws on it). */
export const carteDuSite = (): MlMap | null => carte;

// --- the register's steps (v2.1 A4) --------------------------------------------------------------
/** A register page's step of the history: `rg`, its rank among the register's steps since the map
 * (1: the first page opened from the map); `froid`: the page was opened cold (its address typed or
 * followed from elsewhere), with no step of the register nor of the map before it in this page;
 * `prec`: the title of the page before (the back button's name); `haut`: where the frame was
 * scrolled when it was left, given back when one comes back to it. A section of the page is not a
 * step: its link replaces the step's address (clic). */
export type Pas = { rg: number; froid?: boolean; prec?: string; haut?: number };

/** The step shown, when it is a register's step this page made (else null: a cold one). */
export function pas(): Pas | null {
  const s = history.state as Partial<Pas> | null;
  return s && typeof s.rg === "number" ? (s as Pas) : null;
}

/** What the frame keeps of the page it leaves (modale.ts: its scroll, its title). */
let memoire: (() => { haut: number; titre: string }) | null = null;
export function retenir(f: () => { haut: number; titre: string }): void {
  memoire = f;
}

/** A step of the register before this one, in this page: the back button goes back to it. */
export function retourPossible(): boolean {
  const s = pas();
  return s !== null && (s.rg > 1 || !s.froid);
}

/** The register's back button: one step back in the register's history, with that page's search,
 * filters and section (its address and its step carry them); from the first page opened from the
 * map, the map (the step before); from a page opened cold, the map too (fermer: nothing before). */
export function retour(): void {
  if (retourPossible()) history.back();
  else fermer();
}

/** Is the register closing (cacher under way)? A view that moved the map leaves it there then
 * (Drones et algorithmes, A5), and puts it back only when another register page replaces it. */
let fermeture = false;
export const seFerme = (): boolean => fermeture;

/** Asked as early as the page opens on a register path, beside the map's own code. */
export function prefetchRegistre(): void {
  if (!REGISTRE.test(location.pathname)) return;
  // a page opened cold: its step is the register's first, with nothing of it before
  if (!pas()) history.replaceState({ ...(history.state ?? {}), rg: 1, froid: true }, "");
  // a register page opened cold shows at once, without waiting for the map to boot; Carte et drones
  // draws on the map, and waits for it (brancher)
  void charger().then((m) => {
    if (!/\/carte$/.test(location.pathname)) m.afficher();
  });
}

/** The map exists: the register follows the address from now on. */
export function brancher(map: MlMap): void {
  carte = map;
  document.addEventListener("click", clic);
  addEventListener("popstate", () => void suivre(true));
  void suivre(false);
}

/** Opens a register page from wherever the page is (a door on the map, a link in the register). */
export function ouvrir(url: string | URL): void {
  const u = new URL(url, location.href);
  let etat: Pas = { rg: 1 };
  if (REGISTRE.test(location.pathname)) {
    // the page left keeps where it was scrolled, for the way back
    const m = memoire?.();
    const avant = pas() ?? { rg: 1, froid: true };
    history.replaceState({ ...(history.state ?? {}), ...avant, haut: m?.haut ?? 0 }, "");
    etat = { rg: avant.rg + 1, ...(m?.titre ? { prec: m.titre } : {}) };
  } else setAside(mapAddress());
  history.pushState(etat, "", `${u.pathname}${u.search}${u.hash}`);
  void suivre(false, true);
}

/** ✕, Escape (and the back button with no step before it): the map again, at its own address, as
 * a new step of the history. */
export function fermer(): void {
  if (!REGISTRE.test(location.pathname)) return;
  history.pushState(null, "", takeBack());
  void suivre(false);
}

async function suivre(retour: boolean, force = false): Promise<void> {
  if (REGISTRE.test(location.pathname)) {
    // back or forward onto a register page from the map's: the map's address goes aside
    if (retour && !isAside()) setAside(lastMapAddress());
    (await charger()).afficher(force);
    return;
  }
  if (!modale) return;
  const m = await modale;
  fermeture = true;
  try {
    m.cacher();
  } finally {
    fermeture = false;
  }
  // back from the register onto the map's step: the map's latest address, not the step's
  if (retour && isAside()) history.replaceState(null, "", takeBack());
}

function clic(ev: MouseEvent): void {
  if (
    ev.defaultPrevented ||
    ev.button !== 0 ||
    ev.metaKey ||
    ev.ctrlKey ||
    ev.shiftKey ||
    ev.altKey
  )
    return;
  const a = (ev.target as Element).closest("a");
  if (!a || a.target || a.hasAttribute("download")) return;
  if (a.hasAttribute("data-fermer")) {
    ev.preventDefault();
    fermer();
    return;
  }
  const url = new URL(a.href, location.href);
  if (url.origin !== location.origin || !REGISTRE.test(url.pathname)) return;
  // a section of the page shown is not a step of the history (the back button goes to the page
  // before, not to the section before): the step's address says it, the frame scrolls to it
  if (url.pathname === location.pathname && url.search === location.search && url.hash) {
    if (!REGISTRE.test(location.pathname)) return;
    ev.preventDefault();
    const avant = location.href;
    history.replaceState(history.state, "", url.hash);
    const id = decodeURIComponent(url.hash.slice(1));
    document.getElementById(id)?.scrollIntoView({ block: "start" });
    // what a followed anchor says (the glossary marks its word on it)
    dispatchEvent(new HashChangeEvent("hashchange", { oldURL: avant, newURL: location.href }));
    return;
  }
  ev.preventDefault();
  ouvrir(url);
}

// --- the doors on the map ------------------------------------------------------------------------
/** « Le registre → », a link of the map's ticket under « Filtres et légende », in its face (17a's
 * links, theme/punk/map.css .ticket-link; the ticket's row of squares has no room for a fifth):
 * the register's summary over the map. */
export function porteRegistre(): HTMLAnchorElement {
  const a = document.createElement("a");
  a.className = "ticket-link registre-link";
  a.href = "/registre/";
  a.title = t("door.registre");
  a.append(t("door.registre_court"));
  return a;
}

/** A commune's or a département's page in the register, when the register holds one (its file is
 * there): the link of its sheet on the map, else null (a page the register does not hold would say
 * « Page introuvable »). */
export async function porteLieu(
  code: string,
  departement: boolean,
): Promise<HTMLAnchorElement | null> {
  const page = departement ? `departement/${code}` : `commune/${code}`;
  try {
    const r = await fetch(`/data/registre/${page}.json`, { method: "HEAD" });
    if (!r.ok) return null;
  } catch {
    return null;
  }
  const a = document.createElement("a");
  a.className = "sheet-link registre-door";
  a.href = `/registre/${page}`;
  a.textContent = t("door.registre_lieu");
  return a;
}
