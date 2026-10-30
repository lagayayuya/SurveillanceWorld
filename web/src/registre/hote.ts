// The register's doors on the map's page (design/registre/v2): the page answers every /registre path
// (Caddy, Vite) and the register opens over the map, which stays behind. This small module rides in
// the map's bundle: it follows the address, opens the register (registre/modale.ts, a chunk of its
// own, asked only then) when it names a register page, closes it when it no longer does, and turns
// every link to a register page, on the map or inside the register, into a move of the page's
// history. The map keeps its own address aside while the register holds the page's (url.ts).
import type { Map as MlMap } from "maplibre-gl";
import { t } from "../i18n.ts";
import { isAside, lastMapAddress, mapAddress, setAside, takeBack } from "../url.ts";
import { icone } from "./types.ts";

export const REGISTRE = /^\/registre(\/|$)/;

let carte: MlMap | null = null;
let modale: Promise<typeof import("./modale.ts")> | null = null;
const charger = () => {
  modale ??= import("./modale.ts");
  return modale;
};

/** The site's map, behind the register (Carte et drones draws on it). */
export const carteDuSite = (): MlMap | null => carte;

/** Asked as early as the page opens on a register path, beside the map's own code. */
export function prefetchRegistre(): void {
  if (REGISTRE.test(location.pathname)) void charger();
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
  if (!REGISTRE.test(location.pathname)) setAside(mapAddress());
  history.pushState(null, "", `${u.pathname}${u.search}${u.hash}`);
  void suivre(false);
}

/** « ← Carte », ✕, Escape: the map again, at its own address, as a new step of the history. */
export function fermer(): void {
  if (!REGISTRE.test(location.pathname)) return;
  history.pushState(null, "", takeBack());
  void suivre(false);
}

async function suivre(retour: boolean): Promise<void> {
  if (REGISTRE.test(location.pathname)) {
    // back or forward onto a register page from the map's: the map's address goes aside
    if (retour && !isAside()) setAside(lastMapAddress());
    (await charger()).afficher();
    return;
  }
  if (!modale) return;
  (await modale).cacher();
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
  // an anchor of the page shown
  if (url.pathname === location.pathname && url.search === location.search && url.hash) return;
  ev.preventDefault();
  ouvrir(url);
}

// --- the doors on the map ------------------------------------------------------------------------
const SVG = "http://www.w3.org/2000/svg";

/** « Le registre », a square under the map's ticket, after the mode's, the account's and the « ? »
 * (theme/punk/map.css .ticket-square): the register's summary over the map. */
export function porteRegistre(): HTMLAnchorElement {
  const a = document.createElement("a");
  a.className = "ticket-square registre-square";
  a.href = "/registre/";
  a.setAttribute("aria-label", t("door.registre"));
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", "account-icon");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(SVG, "path");
  path.setAttribute("d", icone("registre"));
  svg.append(path);
  a.append(svg);
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
