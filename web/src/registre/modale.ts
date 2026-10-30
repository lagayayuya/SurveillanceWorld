// The register over the map (design/registre/v2, every board): on a wide screen a modal, the map
// visible on its edges (56 px left and right, 24 px top and bottom), its offset shadow the colour of
// the open fiche's type; on a phone a sheet that rises over the map, with a handle, the map still
// seen at the top. Its head: « ← Carte », the breadcrumb with the types' pictograms, the search,
// the theme, the close. Inside, the view of the path, rendered by the template engine (dc.ts) from
// the mockups' markup; each view is a module of its own, loaded when its path is opened (its logic,
// its template, its data). The addresses are the register's (/registre/…); hote.ts follows them.
// While it is open as a modal the map behind is inert and the focus stays in the register; Escape
// closes it, the browser's back goes up one step, the focus goes back where it came from.
import catalogue from "virtual:registre-catalogue";
import { render } from "../messages.ts";
import { mode, toggleMode } from "../theme.ts";
import { mapAddress } from "../url.ts";
import "./registre.css";
import "./cadre.css";
import { type Format, type Mounted, mount, parseParts, type View } from "./dc.ts";
import { Absent, load } from "./donnees.ts";
import { fermer, OUVERTURE, pas, retenir, retour, retourPossible } from "./hote.ts";
import { setMessages, t } from "./i18n.ts";
import { listeHref, TYPE_DE } from "./listes.ts";
import { boutonPartage, fermerPartage } from "./partage.ts";
// « Signaler une erreur »: its form opens over any page that links to it
import "./signaler.ts";
import { type Route, route } from "./routes.ts";
import { couleur, icone, pluriel, type TypeCle } from "./types.ts";
import { type Partage, setWords } from "./vue.ts";
import formats from "./vues/formats.json";
import socle from "./vues/socle.html?raw";

setMessages(catalogue);
setWords(catalogue);

/** One step of the breadcrumb: its type's pictogram and colour, its words, its page. */
export type Miette = { k: TypeCle; l: string; href: string };

/** What the frame asks of a view, beside its template: its tab title, the type of the fiche it
 * shows (the frame's colour), the breadcrumb above it. */
export type VueCadre = View<Record<string, unknown>> & {
  titre?(): string;
  /** true: the register shrinks to a panel beside the map, which stays live (Carte et drones) */
  panneau?(): boolean;
  partage?(): Partage | null;
  type?(): TypeCle;
  fil?(): Miette[];
};

/** A view's module: its class, its template, and the data it needs before it is drawn. */
export type VueModule = {
  Vue: new (props: Record<string, unknown>) => VueCadre;
  template: string;
  donnees?: (r: Route) => Promise<Record<string, unknown>>;
};
const VUES: Partial<Record<Route["view"], () => Promise<{ default: VueModule }>>> = {
  registre: () => import("./vues/sommaire.ts"),
  // the old « Chiffres et classements »: the summary's module replaces it with its list (listes.ts)
  chiffres: () => import("./vues/sommaire.ts"),
  liste: () => import("./vues/liste.ts"),
  commune: () => import("./vues/commune.ts"),
  documents: () => import("./vues/documents.ts"),
  autorisations: () => import("./vues/autorisations.ts"),
  carte: () => import("./vues/carte.ts"),
  couverture: () => import("./vues/couverture.ts"),
  departement: () => import("./vues/departement.ts"),
  glossaire: () => import("./vues/glossaire.ts"),
  entreprise: () => import("./vues/entreprise.ts"),
  acheteur: () => import("./vues/acheteur.ts"),
  contrat: () => import("./vues/contrat.ts"),
  introuvable: () => import("./vues/introuvable.ts"),
};

/** A fiche's type from its path, until its view says better (a document's record). */
function typeDe(r: Route): TypeCle {
  switch (r.view) {
    case "commune":
    case "documents":
    case "autorisations":
    case "carte":
      return "commune";
    case "departement":
      return "departement";
    case "entreprise":
      return "entreprise";
    case "acheteur":
      return "acheteur";
    case "contrat":
      return "con";
    case "liste":
      return TYPE_DE[r.liste];
    default:
      return "registre";
  }
}

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

// --- the frame ---------------------------------------------------------------------------------
const WIDE = matchMedia("(min-width: 960px)");
const SVG = "http://www.w3.org/2000/svg";

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...kids: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const x = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) x.setAttribute(k, v);
  x.append(...kids);
  return x;
}

/** A stroked 24 × 24 pictogram (the boards' svg), hidden from screen readers. */
function picto(d: string, width = "2", size?: number): SVGSVGElement {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", width);
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  if (size) {
    svg.setAttribute("width", String(size));
    svg.setAttribute("height", String(size));
  }
  for (const p of d.split("|")) {
    const path = document.createElementNS(SVG, "path");
    path.setAttribute("d", p);
    svg.append(path);
  }
  return svg;
}

/** The type's little square (.mini), its pictogram on its colour. */
function mini(k: TypeCle): HTMLElement {
  const s = el("span", { class: "mini" }, picto(icone(k)));
  s.style.setProperty("--c", couleur(k));
  return s;
}

const MOON = "M20.5 14.5A8.5 8.5 0 1 1 9.5 3.5a7 7 0 0 0 11 11z";
const SUN =
  "M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8|M7.5 12a4.5 4.5 0 1 0 9 0a4.5 4.5 0 1 0 -9 0";
const LOUPE = "M4 11a7 7 0 1 0 14 0a7 7 0 1 0 -14 0|m20 20-4-4";

const rg = el("div", { class: "rg", id: "registre" });
rg.hidden = true;
const th = el("div", { class: "th" });
const cadre = el("section", { class: "modal", role: "dialog", "aria-modal": "true" });
const haut = el("div", { class: "mtop" });
const scroll = el("div", { class: "scroll" });
const root = el("div", { id: "vue", tabindex: "-1" });
scroll.append(root);
cadre.append(haut, scroll);
th.append(cadre);
rg.append(th);
document.body.append(rg);

/** The theme's button: the other mode than the one shown, the map's own choice (theme.ts). */
function boutonTheme(): HTMLButtonElement {
  const dark = mode() === "dark";
  const b = el("button", {
    class: "sq",
    type: "button",
    "aria-label": t(dark ? "entete.theme_clair" : "entete.theme_sombre"),
  });
  b.append(picto(dark ? SUN : MOON, "2.2", 18));
  b.addEventListener("click", () => {
    toggleMode();
    mounted?.update();
    entete(courant);
    dispatchEvent(new Event("themechange"));
  });
  return b;
}

function boutonFermer(): HTMLAnchorElement {
  return el(
    "a",
    { class: "sq", href: mapAddress(), "data-fermer": "", "aria-label": t("cadre.fermer") },
    "✕",
  );
}

/** The head's back button (v2.1 A4, the boards' « ← Carte »): one step back in the register's
 * history, « ← Retour », named after the page it goes back to; with no register step before (the
 * first page opened from the map, or opened cold) it is the way to the map, « ← Carte ». */
function boutonRetour(): HTMLButtonElement {
  const avant = retourPossible() && (pas()?.rg ?? 1) > 1;
  const prec = pas()?.prec;
  const b = el(
    "button",
    {
      class: "mback",
      type: "button",
      "aria-label": avant
        ? prec
          ? t("cadre.retour_a", { page: prec })
          : t("cadre.retour_page")
        : t("cadre.retour_carte"),
    },
    t(avant ? "cadre.retour" : "cadre.carte"),
  );
  b.addEventListener("click", retour);
  return b;
}

/** The search of the head: the register's search page with what was typed. */
function recherche(): HTMLElement {
  const input = el("input", { type: "search", placeholder: t("cadre.chercher_exemple") });
  input.value = courant.view === "registre" ? (courant.q.q ?? "") : "";
  const form = el("form", { class: "msearch", role: "search" });
  form.append(
    picto(LOUPE, "2.4", 18),
    el("label", { class: "sr", for: "rg-chercher" }, t("cadre.chercher")),
    input,
  );
  input.id = "rg-chercher";
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const q = input.value.trim();
    const a = el("a", { href: `/registre/${q ? `?q=${encodeURIComponent(q)}` : ""}` });
    rg.append(a);
    a.click();
    a.remove();
  });
  return form;
}

let courant: Route = { view: "registre", q: {} };
let fil: Miette[] = [];
let ici = "";
// the page left for another keeps where it was scrolled and its title (hote.ts ouvrir)
retenir(() => ({ haut: scroll.scrollTop, titre: ici }));

/** The head: on a wide screen the boards' black bar, on a phone the sheet's handle and top. */
function entete(r: Route): void {
  const k = mounted?.view.type?.() ?? typeDe(r);
  cadre.style.setProperty("--tc", couleur(k));
  cadre.setAttribute(
    "aria-label",
    ici && r.view !== "registre" ? t("cadre.registre_de", { nom: ici }) : t("cadre.registre"),
  );
  if (WIDE.matches) {
    const crumbs = el("nav", { class: "crumbs", "aria-label": t("cadre.fil") });
    for (const m of fil) {
      crumbs.append(
        // a row of the contract (v2.1 A2): its pictogram and its words one target (registre.css)
        el("span", { class: "r" }, el("a", { class: "crumb rl", href: m.href }, mini(m.k), m.l)),
        el("span", { class: "sep", "aria-hidden": "true" }, "›"),
      );
    }
    crumbs.append(
      el("span", { class: "here", "aria-current": "page" }, ici || t("cadre.registre")),
    );
    haut.className = "mtop";
    // the panel beside the map (V2-CarteDrones): its breadcrumb, the theme, ✕; the map is there
    const cote = mounted?.view.panneau?.() ?? false;
    haut.replaceChildren(
      ...(cote ? [crumbs] : [boutonRetour(), crumbs, recherche()]),
      boutonTheme(),
      boutonFermer(),
    );
    return;
  }
  // the phone: up one step (« ‹ Entreprises »), or the register's sticker on its summary
  const up = fil[fil.length - 1];
  const debut = up
    ? el(
        "nav",
        { class: "crumbs", "aria-label": t("cadre.fil") },
        el(
          "span",
          { class: "r" },
          el("a", { class: "crumb rl", href: up.href }, mini(up.k), `‹ ${up.l}`),
        ),
      )
    : (() => {
        const s = el("span", { class: "stk" }, picto(icone("registre")), t("cadre.registre"));
        s.style.setProperty("--c", couleur("registre"));
        s.style.setProperty("font-size", "12px");
        return s;
      })();
  haut.className = "ttop";
  const vue = mounted?.view;
  const share = vue?.partage ? boutonPartage(vue as { partage(): Partage | null }) : null;
  haut.replaceChildren(
    debut,
    // the step up takes the room; the summary's sticker leaves it to a spacer
    ...(up ? [] : [el("span", { class: "flex" })]),
    ...(share ? [share] : []),
    boutonTheme(),
    boutonFermer(),
  );
}

/** The phone's sheet: its handle (dragged or touched) lowers it to half the screen, the map seen
 * above; dragged far down, the register closes. Its top stays where the boards put it. */
const poignee = el("div", { class: "handle", "aria-hidden": "true" }, el("span"));
let bas = false;
function placerFeuille(): void {
  const top = courant.view === "registre" ? 64 : 44;
  cadre.style.setProperty("top", bas ? "50%" : `${top}px`);
}
{
  let depart: { y: number; id: number; top: number } | null = null;
  poignee.addEventListener("pointerdown", (e) => {
    depart = { y: e.clientY, id: e.pointerId, top: cadre.getBoundingClientRect().top };
    poignee.setPointerCapture(e.pointerId);
    cadre.classList.add("tire");
  });
  poignee.addEventListener("pointermove", (e) => {
    if (!depart || e.pointerId !== depart.id) return;
    cadre.style.setProperty("top", `${Math.max(24, depart.top + e.clientY - depart.y)}px`);
  });
  const fin = (e: PointerEvent) => {
    if (!depart || e.pointerId !== depart.id) return;
    const dy = e.clientY - depart.y;
    depart = null;
    cadre.classList.remove("tire");
    if (Math.abs(dy) < 6) bas = !bas;
    else if (cadre.getBoundingClientRect().top > innerHeight * 0.8) {
      fermer();
      return;
    } else bas = dy > 0;
    placerFeuille();
  };
  poignee.addEventListener("pointerup", fin);
  poignee.addEventListener("pointercancel", fin);
}

/** A panel beside the map (V2-CarteDrones: about 470 px on the right, the map live behind it) or
 * the modal; on a phone the sheet, lowered to half the screen over a live map. */
let panneau = false;
function disposer(): void {
  if (WIDE.matches) {
    cadre.className = panneau ? "side" : "modal";
    poignee.remove();
    cadre.style.removeProperty("top");
  } else {
    cadre.className = "sheet";
    cadre.prepend(poignee);
    placerFeuille();
  }
}

/** The panel's map is live: nothing inert, no trap, a region rather than a dialog. */
function regler(p: boolean): void {
  if (p !== panneau) bas = p;
  panneau = p;
  if (p) {
    for (const x of inertes.splice(0)) x.inert = false;
    cadre.setAttribute("role", "region");
    cadre.removeAttribute("aria-modal");
  } else {
    // every panel of the map, those it made after the register opened too (a cold open)
    inerter();
    cadre.setAttribute("role", "dialog");
    cadre.setAttribute("aria-modal", "true");
  }
  document.body.classList.toggle("registre-panneau", p);
  disposer();
}

// --- open, inert, focus, Escape ---------------------------------------------------------------
let ouvert = false;
let avant: HTMLElement | null = null;
let titreCarte = "";
const inertes: HTMLElement[] = [];

function focusables(): HTMLElement[] {
  return [
    ...cadre.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
    ),
  ].filter((x) => x.offsetParent !== null || x === document.activeElement);
}

rg.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && !ev.defaultPrevented) {
    ev.preventDefault();
    ev.stopPropagation();
    fermer();
    return;
  }
  if (ev.key !== "Tab" || panneau) return;
  // the focus stays in the register
  const f = focusables();
  if (!f.length) return;
  const first = f[0];
  const last = f[f.length - 1];
  if (ev.shiftKey && (document.activeElement === first || document.activeElement === root)) {
    ev.preventDefault();
    last.focus();
  } else if (!ev.shiftKey && document.activeElement === last) {
    ev.preventDefault();
    first.focus();
  }
});

function ouvrirCadre(): void {
  if (ouvert) return;
  ouvert = true;
  // one modal at a time (v2.1 A9): the site's own close first (main.ts), their focus given back
  dispatchEvent(new Event(OUVERTURE));
  avant = document.activeElement as HTMLElement | null;
  titreCarte = document.title;
  inerter();
  document.body.classList.add("registre-ouvert");
  rg.hidden = false;
}

/** What opens over the register (registre.css, the order of the layers): its own dialogs (« Signaler
 * une erreur », a request, the sources: .dialogue) and the site's legal pages (a link in one). */
const DESSUS = ".dialogue, #legal, #welcome";

/** The map behind a modal is inert; a dialog over the register never is (it is drawn again, a
 * view's later render or a cold open, with the dialog open). */
function inerter(): void {
  for (const x of document.body.children) {
    if (x === rg || !(x instanceof HTMLElement) || x.inert || x.matches(DESSUS)) continue;
    x.inert = true;
    inertes.push(x);
  }
}

/** A dialog over the register takes the focus and keeps it: the register is inert under it, and
 * the focus comes back to where it was in the register when the dialog goes (its own way back,
 * an element of the register, is refused while the register is still inert). */
let couvert = false;
let dernierFocus: HTMLElement | null = null;
rg.addEventListener("focusin", (ev) => {
  dernierFocus = ev.target as HTMLElement;
});
function regarderDessus(): void {
  const over = ouvert && [...document.body.children].some((x) => x.matches(DESSUS));
  if (over === couvert) return;
  couvert = over;
  rg.inert = over;
  const f = document.activeElement;
  if (!over && ouvert && (!f || f === document.body) && dernierFocus?.isConnected)
    dernierFocus.focus({ preventScroll: true });
}
new MutationObserver(regarderDessus).observe(document.body, { childList: true });

/** The register leaves the page (the map's address again): the map gets its focus back. */
export function cacher(): void {
  // a page still loading when the register closes is not drawn (it would make the map inert again)
  asked++;
  if (!ouvert) return;
  fermerPartage();
  observateur?.disconnect();
  ouvert = false;
  rg.hidden = true;
  // its own dialogs go with it (the browser's back with « Signaler une erreur » open)
  for (const d of document.querySelectorAll("body > .dialogue")) d.remove();
  couvert = false;
  rg.inert = false;
  for (const x of inertes.splice(0)) x.inert = false;
  document.body.classList.remove("registre-ouvert", "registre-panneau");
  panneau = false;
  document.title = titreCarte;
  mounted?.unmount();
  mounted = null;
  shown = "";
  root.replaceChildren();
  (avant?.isConnected ? avant : document.getElementById("map"))?.focus?.();
}

// --- the phone: a title shrinks until its longest word fits; a touched row unfolds ----------
function fitTitles(scope: Element): void {
  for (const h of scope.querySelectorAll<HTMLElement>("h1:not(.sr)")) {
    // from the template's own size when it sets one (Contrat-grand: 60 px), else the class's
    if (h.dataset.taille === undefined) h.dataset.taille = h.style.getPropertyValue("font-size");
    const base = h.dataset.taille;
    if (base) h.style.setProperty("font-size", base);
    else h.style.removeProperty("font-size");
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
  marquerSection();
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
addEventListener("resize", () => {
  if (ouvert) fitTitles(root);
});

// --- the band's current section: the one at the top of the frame, read as one scrolls -------------
let observateur: IntersectionObserver | null = null;
let section = "";
/** The band's links say which section is at the top (aria-current), again after each render. */
function marquerSection(): void {
  for (const a of root.querySelectorAll<HTMLElement>("[data-sec]"))
    a.setAttribute("aria-current", String(a.dataset.sec === section));
}
function suivreSections(): void {
  observateur?.disconnect();
  const secs = [...root.querySelectorAll<HTMLElement>("section.sec[id]")];
  section = secs[0]?.id ?? "";
  marquerSection();
  if (!secs.length) return;
  const vus = new Map<string, boolean>();
  observateur = new IntersectionObserver(
    (entries) => {
      for (const e of entries) vus.set(e.target.id, e.isIntersecting);
      const first = secs.find((x) => vus.get(x.id));
      if (first && first.id !== section) {
        section = first.id;
        marquerSection();
      }
    },
    // the band (52 px) covers the frame's top: a section counts once it is under it
    { root: scroll, rootMargin: "-60px 0px -55% 0px" },
  );
  for (const x of secs) observateur.observe(x);
}

// --- the router -------------------------------------------------------------------------------
let mounted: Mounted<VueCadre> | null = null;
let shown = "";
let asked = 0;

/** The default breadcrumb: the register's summary, then the list of the fiche's type. */
function filDe(r: Route, k: TypeCle): Miette[] {
  const m: Miette[] = [{ k: "registre", l: t("types.registre.l"), href: "/registre/" }];
  if (r.view === "registre" || k === "registre") return r.view === "registre" ? [] : m;
  return [...m, { k, l: pluriel(k), href: listeHref(k) }];
}

/** The path's view in the frame, opened over the map when it was not. */
/** `force`: a link was followed — the page is drawn again even when its address is the one shown
 * (a view that replaced its own address, a list's filters, would otherwise keep them). */
export async function afficher(force = false): Promise<void> {
  const r = route(location.pathname, location.search);
  courant = r;
  ouvrirCadre();
  fermerPartage();
  disposer();
  const key = `${location.pathname}${location.search}|${WIDE.matches}`;
  if (key === shown && !force) {
    // the map's own panels may have come since (a page opened cold, before the map booted)
    if (!panneau) inerter();
    entete(r);
    return;
  }
  const ask = ++asked;
  // a commune's file is asked at once, beside its view's code, not after it (Lyon, slow phone:
  // 4.3 s → 3.8 s until its documents show); the view reads it from the same cache
  if ("insee" in r) void load(`commune/${r.insee}.json`).catch(() => {});
  const view = VUES[r.view] ?? VUES.introuvable;
  if (!view || !VUES.introuvable) return;
  const absent = VUES.introuvable;
  try {
    let { default: m } = await view();
    let props: Record<string, unknown>;
    try {
      props = { ...r, ...(m.donnees ? await m.donnees(r) : {}) };
    } catch (e) {
      if (!(e instanceof Absent)) throw e;
      ({ default: m } = await absent());
      props = { view: "introuvable" };
    }
    if (ask !== asked || !ouvert) return; // a later path was asked meanwhile, or the register closed
    mounted?.unmount();
    mounted = mount(root, m.Vue, props, m.template, { parts, afterRender, format });
    suivreSections();
    regler(mounted.view.panneau?.() ?? false);
    shown = key;
    ici = mounted.view.titre?.() ?? "";
    const k = mounted.view.type?.() ?? typeDe(r);
    fil = mounted.view.fil?.() ?? filDe(r, k);
    entete(r);
    document.title = ici ? t("page.titre_vue", { vue: ici }) : t("page.titre_seul");
    const anchor = decodeURIComponent(location.hash.slice(1));
    // back on a page left for another: where it was scrolled (its step kept it, hote.ts ouvrir)
    const haut = force ? undefined : pas()?.haut;
    requestAnimationFrame(() => {
      const target = anchor ? document.getElementById(anchor) : null;
      if (typeof haut === "number") revenirA(haut, ask);
      else if (target) target.scrollIntoView({ block: "start" });
      else scroll.scrollTop = 0;
      if (!cadre.contains(document.activeElement)) root.focus({ preventScroll: true });
    });
  } catch (e) {
    if (ask !== asked || !ouvert) return;
    regler(false);
    mounted?.unmount();
    mounted = null;
    shown = "";
    ici = "";
    fil = filDe(r, "registre");
    entete(r);
    const p = document.createElement("p");
    p.className = "erreur";
    p.textContent = t("page.erreur");
    root.replaceChildren(p);
    console.error(e);
  }
}

/** Back on a page: the frame scrolled where it was left. A view draws some of its parts once their
 * data come (a commune's sections): the scroll is asked again at each frame until the page is tall
 * enough, for 2 s at most, and not once the reader scrolls or another page is asked. */
function revenirA(haut: number, ask: number): void {
  const fin = performance.now() + 2000;
  let lu = false;
  const stop = () => {
    lu = true;
  };
  const opts = { once: true, passive: true } as const;
  scroll.addEventListener("wheel", stop, opts);
  scroll.addEventListener("touchstart", stop, opts);
  scroll.addEventListener("keydown", stop, opts);
  const essai = () => {
    if (lu || ask !== asked || !ouvert) return;
    scroll.scrollTop = haut;
    if (Math.abs(scroll.scrollTop - haut) > 1 && performance.now() < fin)
      requestAnimationFrame(essai);
  };
  essai();
}

WIDE.addEventListener("change", () => {
  if (!ouvert) return;
  shown = "";
  void afficher();
});
