// The map's legend while a commune's or a département's sheet is open (board 12, Carte3-Commune
// and Carte3-Departement): « Couleur d'une commune : la part de ses rues à portée d'au moins une
// caméra relevée », the five fixed classes in the map's colours (--map-area-1…5, filters.ts
// breaks), the hatching of a commune without a camera, and the chosen one: its class, or a
// département's blue outline. Over the map's bottom left on a wide screen; a phone has no room
// for it (theme/punk/area.css hides it under 700 px, as the board's phone mockups do).
import { artDep } from "./gap";
import { t } from "./i18n";

export { artDep };

export type LegendArea = {
  name: string;
  /** A département's « Le Rhône » (gap.ts artDep). */
  art?: string;
  departement: boolean;
  /** Y, the share of streets within reach the map colours by (`hi` or `hi_pub`). */
  y: number;
  /** Cameras in the map's set (`n` or `n_pub`): none, the hatching. */
  n: number;
  /** The level the map colours at its zoom: a département framed whole below the communes'
   * zoom shows the départements' colours (Ju 2026-11-11). Default: communes. */
  level?: "commune" | "departement";
};

function el(tag: string, cls = "", text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** « <5 % », « 5-15 », « 15-30 », « 30-50 », « 50 %+ ». */
export function classLabels(breaks: number[]): string[] {
  const out = [t("legend.area.below", { v: breaks[0] })];
  for (let i = 1; i < breaks.length; i++)
    out.push(t("legend.area.between", { lo: breaks[i - 1], hi: breaks[i] }));
  out.push(t("legend.area.above", { v: breaks[breaks.length - 1] }));
  return out;
}

/** « Vaulx-en-Velin : entre 15 et 30 % », « … : aucune caméra relevée », « Rhône : contour
 * bleu ». */
export function chosenLine(a: LegendArea, breaks: number[]): string {
  if (a.departement) return t("legend.area.chosen_dep", { nom: a.art ?? a.name });
  if (a.n <= 0) return t("legend.area.chosen_none", { nom: a.name });
  const k = breaks.filter((b) => a.y >= b).length;
  const range =
    k <= 0
      ? t("legend.area.chosen_range_below", { v: breaks[0] })
      : k >= breaks.length
        ? t("legend.area.chosen_range_above", { v: breaks[breaks.length - 1] })
        : t("legend.area.chosen_range_between", { lo: breaks[k - 1], hi: breaks[k] });
  return t("legend.area.chosen", { nom: a.name, range });
}

/** The legend's box, drawn again for each area. */
export function legendBox(a: LegendArea, breaks: number[]): HTMLElement {
  const box = el("aside", "mlegend");
  box.setAttribute("aria-label", t("legend.section"));
  box.append(
    // A département's sheet shows its communes (board 12): their colours are the legend's.
    el("h4", "", t(a.level === "departement" ? "legend.area.title_dep" : "legend.area.title")),
    el("p", "lead", t("legend.area.lead")),
  );
  const ramp = el("div", "ramp");
  ramp.setAttribute("aria-hidden", "true");
  const labels = classLabels(breaks);
  labels.forEach((_, i) => {
    const cell = el("span");
    cell.style.background = `var(--map-area-${i + 1})`;
    ramp.append(cell);
  });
  const lab = el("div", "lab");
  for (const l of labels) lab.append(el("span", "", l));
  const none = el("div", "row");
  const hatch = el("i", "h");
  hatch.setAttribute("aria-hidden", "true");
  none.append(hatch, el("span", "", t("legend.area.none")));
  const chosen = el("div", "row");
  const outline = el("i", "s");
  outline.setAttribute("aria-hidden", "true");
  chosen.append(outline, el("span", "", chosenLine(a, breaks)));
  box.append(ramp, lab, none, chosen);
  return box;
}
