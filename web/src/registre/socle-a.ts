// Theme A's shared pieces (the register's redesign v3, socle-a.css): the name cut out as the boards
// cut it, a card that folds on a phone (a button[aria-expanded] heading its body), a thin visual
// opened full screen (« ⤢ Plein écran »). Words from the catalogue; the DOM a view's own, except the
// full-screen dialog, built here node by node (no markup string, the register's strict CSP).

import type { Handler } from "./dc.ts";
import { fr } from "./format.ts";
import { t } from "./i18n.ts";

/** A letter of a name cut out: the boards cut in turn c0 (black), c1 (pink), c2 (sky, typewriter),
 * c3 (paper, tilted); a space is a gap (`sp`). */
export type Coupe = { ch: string; cls: string };
export function coupe(nom: string): Coupe[] {
  let i = 0;
  return [...nom.toLocaleUpperCase("fr")].map((ch) =>
    ch === " " ? { ch: "", cls: "sp" } : { ch, cls: `cut c${i++ % 4}` },
  );
}

/** An amount as the boards write it: one decimal in millions and billions (« 80,0 M€ », « 1,8 Md€ »),
 * whole euros below (« 220 000 € »); the unit after a no-break space. */
export function montantA(n: number): string {
  const d = (x: number) => x.toFixed(1).replace(".", ",");
  if (n >= 1e9) return t("socle_a.mde", { n: d(n / 1e9) });
  if (n >= 1e6) return t("socle_a.me", { n: d(n / 1e6) });
  return t("socle_a.e", { n: fr(n) });
}

/** A card folded on a phone (the boards' « repliés » : its title, « N lignes », a 52 px target);
 * open or not is the view's state (`open[k]`), the wide screen shows its body always. */
export type Repli = {
  cls: string;
  titre: string;
  lignes: string;
  exp: "true" | "false";
  id: string;
  basculer: Handler;
};
export function repli(
  open: Record<string, boolean>,
  k: string,
  titre: string,
  n: number,
  basculer: (k: string) => void,
  cls = "card",
): Repli {
  const o = !!open[k];
  return {
    cls: `${cls} repli${o ? " open" : ""}`,
    titre,
    lignes: n > 0 ? t("socle_a.lignes", { n }) : "",
    exp: o ? "true" : "false",
    id: `repli-${k}`,
    basculer: () => basculer(k),
  };
}

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...kids: (Node | string)[]
): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  e.append(...kids);
  return e;
};

/** « ⤢ Plein écran »: the visual next to the button (its `.zw`'s svg) copied into a dialog over the
 * whole screen, wide enough to read, scrolled sideways if need be; ✕ or Escape closes it and gives
 * the focus back to the button. */
export const pleinEcran: Handler = (ev) => {
  const btn = ev.currentTarget as HTMLElement;
  const svg = btn.closest(".zw")?.querySelector("svg");
  // outside the view's own DOM (its renders patch it node by node), in the register's root
  const scope = document.getElementById("registre");
  if (!svg || !scope) return;
  const titre = svg.getAttribute("aria-label") ?? "";
  const fermer = el(
    "button",
    { type: "button", class: "btn", "aria-label": t("socle_a.fermer_plein") },
    "✕",
  );
  const copie = svg.cloneNode(true) as SVGElement;
  const d = el(
    "div",
    { class: "plein", role: "dialog", "aria-modal": "true", "aria-label": titre },
    el("div", { class: "plein-h" }, el("span", {}, titre), fermer),
    el("div", { class: "plein-b" }, copie),
  );
  const wrap = el("div", { class: "th va" }, d);
  const close = () => {
    wrap.remove();
    btn.focus();
  };
  fermer.addEventListener("click", close);
  d.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === "Tab") {
      // one control: the focus stays on it
      e.preventDefault();
      fermer.focus();
    }
  });
  scope.append(wrap);
  fermer.focus();
};
