// « Chargement » (the author's point 1 of 2026-10-12; board 2c of « Chargement punk »): the
// cute camera on its articulated arm over « Chargement » in ransom letters and a line, « de
// la carte » or « de votre compte ». One component, two uses: the punk interface's first
// load, over the page until the map's first display (shown by index.html's inline script,
// which also builds it: the page is blank until the scripts have run, measured in
// bench/loading-timeline.mjs), and the account's sheet on a return from OpenStreetMap
// (account/index.ts). Its markup is index.html's template, its strings the catalogue's
// (loading.*), its look loading.css, imported here so that it comes with the page's first
// stylesheet. role="status", its words said a moment after it appears.
import "./loading.css";
import { t } from "./i18n";

export type Line = "map" | "account";

declare global {
  interface Window {
    /** index.html's builder of the component (absent from a page without its template). */
    __loading?: (line: Line) => HTMLElement;
  }
}

/** One « Chargement », its line `line`. Without index.html's template (another page), a
 * bare status with its words. */
export function loading(line: Line): HTMLElement {
  const built = window.__loading?.(line);
  if (built) return built;
  const e = document.createElement("div");
  e.className = "loading";
  e.setAttribute("role", "status");
  setTimeout(() => {
    e.textContent = t(`loading.said.${line}`);
  }, 150);
  return e;
}

/** The first load is over (the map's first display, or the account's sheet taking over a
 * return from OpenStreetMap): its screen gone, and not shown if its wait had not yet
 * passed. */
export function endFirstLoad(): void {
  delete document.documentElement.dataset.loading;
  document.getElementById("loading")?.remove();
}
