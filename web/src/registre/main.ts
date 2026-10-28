// The register's page (registre.html, every /registre path): the kit's header, drawn once, and the
// view of the path, rendered by the template engine (dc.ts) from the mockups' markup. Each view is a
// module of its own, loaded when its path is opened (its logic, its template, its data); the map's
// code comes only with a view that shows a map. Moving between the register's pages keeps the page
// (history.pushState); a link out of the register (the map) leaves it.
import catalogue from "virtual:registre-catalogue";
import { render } from "../messages.ts";
import { type Format, type Mounted, mount, parseParts, type View } from "./dc.ts";
import { load } from "./donnees.ts";
import { setMessages, t } from "./i18n.ts";
import "./registre.css";
import { backToMap, type Route, route } from "./routes.ts";
import { setWords } from "./vue.ts";
import formats from "./vues/formats.json";
import socle from "./vues/socle.html?raw";

setMessages(catalogue);
setWords(catalogue);

/** A view's module: its class, its template, and the data it needs before it is drawn. */
export type VueModule = {
  Vue: new (props: Record<string, unknown>) => View<Record<string, unknown>> & { titre?(): string };
  template: string;
  donnees?: (r: Route) => Promise<Record<string, unknown>>;
};
// each view's commit adds its line
const VUES: Partial<Record<Route["view"], () => Promise<{ default: VueModule }>>> = {
  registre: () => import("./vues/registre.ts"),
  chiffres: () => import("./vues/chiffres.ts"),
  documents: () => import("./vues/documents.ts"),
  introuvable: () => import("./vues/introuvable.ts"),
};

const parts = parseParts(socle);
const FORMATS = formats as Record<string, Record<string, string>>;
/** {{f.<view>.<key>}}: the message, its placeholders read from the template's scope. */
const format: Format = (key, read) => {
  const message = catalogue[`registre.${key}`];
  if (message === undefined) return `registre.${key}`;
  const params: Record<string, string | number> = {};
  for (const [name, path] of Object.entries(FORMATS[key] ?? {})) {
    const v = read(path);
    params[name] = typeof v === "number" ? v : v == null ? "" : String(v);
  }
  return render(message, params);
};

// --- the header ------------------------------------------------------------------------------
const WIDE = matchMedia("(min-width: 960px)");
const root = document.getElementById("vue") as HTMLElement;
const kit = document.getElementById("kit") as HTMLElement;
const CARTE = "registre.carte";

/** The map's address the register was opened from (?carte=), kept for the visit. */
function keepCarte(): string {
  const q = new URLSearchParams(location.search).get("carte");
  try {
    if (q) sessionStorage.setItem(CARTE, q);
    return q ?? sessionStorage.getItem(CARTE) ?? "";
  } catch {
    return q ?? "";
  }
}

function header(r: Route): void {
  const insee = "insee" in r ? r.insee : undefined;
  const carte = keepCarte();
  const back = backToMap(carte ? `?carte=${encodeURIComponent(carte)}` : "", insee);
  for (const a of kit.querySelectorAll<HTMLAnchorElement>("[data-nav]")) {
    const k = a.dataset.nav;
    if (k === "carte" || k === "carte-ic") a.href = back;
    if (k === "registre" && r.view !== "introuvable") a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
  const dark = document.documentElement.dataset.mode === "dark";
  const button = kit.querySelector<HTMLButtonElement>("[data-theme-btn]");
  if (button) {
    button.setAttribute("aria-label", t(dark ? "entete.theme_clair" : "entete.theme_sombre"));
    for (const svg of button.querySelectorAll<SVGElement>("svg"))
      svg.toggleAttribute("hidden", (svg.dataset.mode === "dark") !== dark);
  }
}

kit.querySelector("[data-theme-btn]")?.addEventListener("click", () => {
  const dark = document.documentElement.dataset.mode !== "dark";
  document.documentElement.dataset.mode = dark ? "dark" : "light";
  // the map's own choice (theme.ts, lacarte.mode): the same origin, one choice for both pages
  try {
    localStorage.setItem("lacarte.mode", dark ? "sombre" : "clair");
  } catch {
    // private mode: kept for the page only
  }
  header(route(location.pathname, location.search));
  mounted?.update();
  dispatchEvent(new Event("themechange"));
});

// --- the phone: a title shrinks until its longest word fits; a touched row unfolds ----------
function fitTitles(scope: Element): void {
  for (const h of scope.querySelectorAll<HTMLElement>("h1")) {
    h.style.removeProperty("font-size");
    let px = Number.parseFloat(getComputedStyle(h).fontSize);
    while (h.scrollWidth > h.clientWidth + 1 && px > 22) {
      px -= 2;
      h.style.setProperty("font-size", `${px}px`, "important");
    }
  }
}
const unfolded = new WeakSet<Element>();
function afterRender(scope: Element): void {
  fitTitles(scope);
  if (WIDE.matches) return;
  for (const table of scope.querySelectorAll("table.t")) {
    const heads = [...table.querySelectorAll("thead th")].map((th) =>
      (th.textContent ?? "").replace(/[↑↓]/g, "").trim(),
    );
    for (const tr of table.querySelectorAll("tbody tr:not(.sub)")) {
      // no aria-expanded on a row (not allowed outside a treegrid): a folded cell is clipped, still read
      tr.classList.toggle("ouvert", unfolded.has(tr));
      [...tr.children].forEach((td, i) => {
        if (i && heads[i]) td.setAttribute("data-l", heads[i]);
      });
    }
  }
}
root.addEventListener("click", (ev) => {
  const target = ev.target as Element;
  if (WIDE.matches || target.closest("a, button, input")) return;
  const tr = target.closest("table.t tbody tr");
  if (!tr) return;
  if (unfolded.has(tr)) unfolded.delete(tr);
  else unfolded.add(tr);
  tr.classList.toggle("ouvert", unfolded.has(tr));
});
addEventListener("resize", () => fitTitles(root));

// --- the router -------------------------------------------------------------------------------
let mounted: Mounted<View<Record<string, unknown>> & { titre?(): string }> | null = null;
let shown = "";
let asked = 0;

async function show(): Promise<void> {
  const r = route(location.pathname, location.search);
  const key = `${location.pathname}${location.search}|${WIDE.matches}`;
  header(r);
  if (key === shown) return;
  const ask = ++asked;
  // a commune's file is asked at once, beside its view's code, not after it (Lyon, slow phone:
  // 4.3 s → 3.8 s until its documents show); the view reads it from the same cache
  if ("insee" in r) void load(`commune/${r.insee}.json`).catch(() => {});
  const view = VUES[r.view] ?? VUES.introuvable;
  if (!view) return;
  try {
    const { default: m } = await view();
    const props = { ...r, ...(m.donnees ? await m.donnees(r) : {}) } as Record<string, unknown>;
    if (ask !== asked) return; // a later path was asked meanwhile
    mounted?.unmount();
    mounted = mount(root, m.Vue, props, m.template, { parts, afterRender, format });
    shown = key;
    const vue = mounted.view.titre?.() ?? "";
    document.title = vue ? t("page.titre_vue", { vue }) : t("page.titre_seul");
    const anchor = location.hash.slice(1);
    requestAnimationFrame(() => {
      const el = anchor ? document.getElementById(anchor) : null;
      if (el) el.scrollIntoView({ block: "start" });
      else scrollTo(0, 0);
    });
  } catch (e) {
    if (ask !== asked) return;
    mounted?.unmount();
    mounted = null;
    shown = "";
    const p = document.createElement("p");
    p.className = "erreur";
    p.textContent = t("page.erreur");
    root.replaceChildren(p);
    console.error(e);
  }
}

/** A link inside the register opens its page without leaving this one; any other leaves. */
document.addEventListener("click", (ev) => {
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
  const url = new URL(a.href, location.href);
  if (url.origin !== location.origin || !/^\/registre(\/|$)/.test(url.pathname)) return;
  if (url.pathname === location.pathname && url.search === location.search && url.hash) return; // an anchor
  ev.preventDefault();
  history.pushState(null, "", url);
  void show();
});
addEventListener("popstate", () => void show());
WIDE.addEventListener("change", () => {
  shown = "";
  void show();
});
void show();
