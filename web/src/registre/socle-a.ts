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

/** The cut-out name in segments: a long name (« Saint-Quentin-la-Motte-Croix-au-Bailly ») wraps
 * after a hyphen or a space, never inside a segment (recette 20); each segment is a `.mot`. */
export function coupeMots(nom: string): Coupe[][] {
  return coupe(nom).reduce<Coupe[][]>(
    (ws, x, i, all) => {
      ws[ws.length - 1].push(x);
      if ((x.ch === "-" || x.cls === "sp") && i < all.length - 1) ws.push([]);
      return ws;
    },
    [[]],
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

/** A chart's value axis (Ju 10/11, every chart of the register): the unit chosen once from the
 * chart's largest value — an amount below 1 M€ in euros (« 25 000 », « 50 000 »), from 1 M€ in
 * millions (« 5 », « 10 ») — and graduations on round values, multiples of one step taken from
 * 1, 2, 2,5 and 5 times a power of ten, written with one decimal at most in their unit (an amount
 * in euros and a count whole). The step is the smallest that needs `lignes` graduations at most to
 * reach the largest value; `haut` is the last graduation (the plot's top), `ticks` every
 * graduation from 0 to it, in the values' own unit (euros, a count), with their label; `val`
 * writes a bar's value in the axis's unit. A per-inhabitant amount (`reel`) or a count (`nb`)
 * keeps its unit (`u` null: the view names it); no value above 0, no graduation. */
export type AxeA = {
  u: "e" | "me" | null;
  pas: number;
  haut: number;
  ticks: { v: number; l: string }[];
  val: (v: number) => string;
};
export function axeA(max: number, sorte: "eur" | "nb" | "reel" = "eur", lignes = 4): AxeA {
  const div = sorte === "eur" && max >= 1e6 ? 1e6 : 1;
  const u = sorte !== "eur" ? null : div > 1 ? "me" : "e";
  // the unit's whole numbers: euros, a count; a million or a per-inhabitant amount takes a decimal
  const entier = sorte === "nb" || (sorte === "eur" && div === 1);
  const net = (x: number) => Math.round(x * 1e6) / 1e6;
  const un = (x: number) => Math.round(x * 10) / 10;
  const ecrit = (x: number) => (entier ? fr(x) : String(un(x)).replace(".", ","));
  const val = (v: number) => {
    const x = v / div;
    return !entier && x > 0 && x < 0.05 ? `< ${ecrit(0.1)}` : ecrit(x);
  };
  const m = max / div;
  if (!(m > 0)) return { u, pas: 0, haut: 0, ticks: [], val };
  let pas = 0;
  for (let e = Math.floor(Math.log10(m / lignes)) - 1; !pas; e++)
    for (const k of [1, 2, 2.5, 5]) {
      const p = net(k * 10 ** e);
      const rond = entier ? Number.isInteger(p) : un(p) === p;
      if (rond && Math.ceil(m / p - 1e-9) <= lignes) {
        pas = p;
        break;
      }
    }
  const n = Math.max(1, Math.ceil(m / pas - 1e-9));
  const ticks = Array.from({ length: n + 1 }, (_, i) => {
    const x = net(i * pas);
    return { v: x * div, l: ecrit(x) };
  });
  return { u, pas: pas * div, haut: n * pas * div, ticks, val };
}

/** The nearest commune of a point (the device's position, never sent): the communes' points
 * (listes.json `dico.communes[].ll`), by the distance on the sphere. */
export function plusProche(
  ll: [number, number],
  communes: Record<string, { ll?: [number, number] }>,
): string | null {
  const rad = Math.PI / 180;
  let best: string | null = null;
  let dmin = Infinity;
  for (const [k, c] of Object.entries(communes)) {
    if (!c.ll) continue;
    const dl = (c.ll[1] - ll[1]) * rad;
    const dg = (c.ll[0] - ll[0]) * rad * Math.cos(((c.ll[1] + ll[1]) / 2) * rad);
    const d = dl * dl + dg * dg;
    if (d < dmin) {
      dmin = d;
      best = k;
    }
  }
  return best;
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
