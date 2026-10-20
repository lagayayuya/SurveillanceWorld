// The legal pages of the punk interface (the launch lot, the author's point 6): « Mentions
// légales », « Confidentialité et traceurs », « Conditions d'utilisation et de
// contribution », « Sources et licences », each at its own address (`?page=<slug>`, a link
// that opens it, indexable text). No board draws them: they take the welcome panel's dark
// ticket as it is (theme/punk/welcome.css: its backdrop, torn paper, ×, foot and « Voir la
// carte »), its labels for their headings and its typewriter for their text, with a few rules
// of their own (theme/punk/legal.css). A dialog over the map, or over the welcome panel or
// a sheet that links to it: Escape, ×, a tap outside or « Voir la carte » close it, the
// focus back on the link that opened it; the four pages linked at its top, one replacing the
// other. Their texts are fr.json's (`legal.*`, pages.ts says which shows when): the parts that
// speak of accounts only while contributions are open, the publisher's identity only when
// the API gives one (config.ts), the contact address the deploy gives the build (contact.ts).
import { siteConfig } from "../config";
import { t } from "../i18n";
import { readParam, writeParams } from "../url";
import { CONTACT } from "./contact";
import { isSlug, page, type Shown, SLUGS, type Slug, shownSections } from "./pages";

const CNIL = "https://www.cnil.fr/fr/plaintes";
const OSM_COPYRIGHT = "https://www.openstreetmap.org/copyright";
/** The third-party licence notices, a text file the build writes beside the page
 * (web/scripts/licences.mjs). */
const NOTICES = `${import.meta.env.BASE_URL}licences.txt`;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls = "",
  text = "",
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

/** An external link: « ↗ » seen, « (nouvelle fenêtre) » said. */
function outLink(href: string, text: string): HTMLAnchorElement {
  const a = el("a", "legal-link", text);
  a.href = href;
  a.target = "_blank";
  a.rel = "noopener";
  const arrow = el("span", "", " ↗");
  arrow.setAttribute("aria-hidden", "true");
  a.append(arrow, el("span", "welcome-sr", ` ${t("sheet.punk.new_window")}`));
  return a;
}

/** The contact address, a mailto: link (a build without it says « l'adresse de contact »,
 * never shipped: deploy.sh requires it). */
function contactLink(): HTMLAnchorElement {
  const a = el("a", "legal-link", CONTACT || t("legal.contact.fallback"));
  a.href = `mailto:${CONTACT}`;
  return a;
}

/** The page's own address. */
export const pageHref = (slug: Slug): string => `${window.location.pathname}?page=${slug}`;

/** A link to a legal page, opened in place (a new tab or window follows the address). */
export function legalLink(slug: Slug, text = t(`${page(slug).key}.nav`), cls = ""): HTMLElement {
  const a = el("a", cls || "legal-link", text);
  a.href = pageHref(slug);
  a.addEventListener("click", (e) => {
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    openLegal(slug, a);
  });
  return a;
}

/** The four pages' links, as a list named « Pages légales » (the welcome, « Compte »). */
export function legalLinks(cls: string, linkCls = ""): HTMLElement {
  const nav = el("nav", cls);
  nav.setAttribute("aria-label", t("legal.nav"));
  const list = el("ul");
  for (const slug of SLUGS) {
    const li = el("li");
    li.append(legalLink(slug, undefined, linkCls));
    list.append(li);
  }
  nav.append(list);
  return nav;
}

/** The placeholders a legal text may hold, each given back as itself by t() (which
 * would otherwise empty them): paragraph() makes them links or text. */
const PLACES = Object.fromEntries(
  ["contact", "publisher", "cnil", "osm", "notices", ...SLUGS].map((n) => [n, `{${n}}`]),
);

/** A key's text, its placeholders kept as they are written. */
export const template = (key: string): string => t(key, PLACES);

/** A paragraph's text with its placeholders made links or text: {contact}, {publisher},
 * {cnil}, {osm}, {notices}, and a page's slug for a link to it. */
function paragraph(key: string): HTMLParagraphElement {
  const p = el("p", "legal-p");
  for (const part of template(key).split(/(\{[a-z-]+\})/)) {
    const name = /^\{([a-z-]+)\}$/.exec(part)?.[1];
    if (!name) {
      if (part) p.append(part);
    } else if (name === "contact") p.append(contactLink());
    else if (name === "publisher") p.append(siteConfig().publisher ?? "");
    else if (name === "cnil") p.append(outLink(CNIL, t("legal.link.cnil")));
    else if (name === "osm") p.append(outLink(OSM_COPYRIGHT, t("legal.link.osm")));
    else if (name === "notices") p.append(outLink(NOTICES, t("legal.link.notices")));
    else if (isSlug(name)) p.append(legalLink(name));
    else p.append(part);
  }
  return p;
}

let open: {
  backdrop: HTMLElement;
  dialog: HTMLElement;
  opener: HTMLElement | null;
  inerted: HTMLElement[];
  title: string;
} | null = null;

const onKey = (e: KeyboardEvent): void => {
  if (e.key !== "Escape" || !open) return;
  // On the window, in its capture: before the welcome panel or the page behind hear it.
  e.preventDefault();
  e.stopImmediatePropagation();
  closeLegal();
};

/** What the site shows now (config.ts). */
const shown = (): Shown => {
  const c = siteConfig();
  return { open: c.contributions, publisher: c.publisher !== null, publish: c.publish };
};

/** The page's content in the dialog: its title, the four links, its sections. */
function fill(dialog: HTMLElement, slug: Slug): void {
  const p = page(slug);
  const body = dialog.querySelector(".legal-body") as HTMLElement;
  const head = el("div", "welcome-head legal-head");
  const title = el("h2", "legal-title", t(`${p.key}.title`));
  title.id = "legal-title";
  title.tabIndex = -1;
  const close = el("button", "welcome-close");
  close.type = "button";
  close.setAttribute("aria-label", t("legal.close"));
  const cross = el("span", "", "×");
  cross.setAttribute("aria-hidden", "true");
  close.append(cross);
  close.addEventListener("click", () => closeLegal());
  head.append(title, close);
  const nav = legalLinks("legal-nav");
  for (const a of nav.querySelectorAll("a"))
    if (a.getAttribute("href") === pageHref(slug)) a.setAttribute("aria-current", "page");
  const sections = shownSections(p, shown()).map((s) => {
    const box = el("section", "legal-section");
    const h = el("h3", "welcome-label legal-label", t(`${s.key}.h`));
    h.id = `legal-${s.key.split(".").slice(1).join("-")}`;
    box.setAttribute("aria-labelledby", h.id);
    box.append(h, ...s.paragraphs.map((x) => paragraph(x.key)));
    return box;
  });
  body.replaceChildren(head, nav, ...sections);
  body.scrollTop = 0;
  document.title = `${t(`${p.key}.title`)} · ${t("app.name")}`;
}

/** The page `slug` in the dialog, opened over what is shown (or in place of the page shown);
 * `opener` takes the focus back on close. */
export function openLegal(slug: Slug, opener: HTMLElement | null = null): void {
  writeParams({ page: slug });
  if (open) {
    fill(open.dialog, slug);
    (open.dialog.querySelector("#legal-title") as HTMLElement).focus({ preventScroll: true });
    return;
  }
  const backdrop = el("div", "welcome-backdrop legal-backdrop");
  backdrop.id = "legal";
  const dialog = el("div", "welcome legal");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", "legal-title");
  dialog.tabIndex = -1;
  const paper = el("div", "welcome-paper");
  const body = el("div", "welcome-body legal-body");
  const foot = el("div", "welcome-foot");
  const go = el("button", "welcome-go");
  go.type = "button";
  const arrow = el("span", "", "→");
  arrow.setAttribute("aria-hidden", "true");
  go.append(t("legal.go"), " ", arrow);
  go.addEventListener("click", () => closeLegal());
  foot.append(go);
  paper.append(body, foot);
  const drop = el("div", "welcome-drop");
  drop.append(paper);
  dialog.append(drop);
  backdrop.append(dialog);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) closeLegal();
  });
  // Everything else out of reach, the welcome panel included when it is open; given back
  // on close, and only what was taken here.
  const inerted: HTMLElement[] = [];
  for (const child of document.body.children)
    if (child instanceof HTMLElement && !child.inert) {
      child.inert = true;
      inerted.push(child);
    }
  open = { backdrop, dialog, opener, inerted, title: document.title };
  fill(dialog, slug);
  document.body.append(backdrop);
  document.body.classList.add("legal-open");
  window.addEventListener("keydown", onKey, true);
  (dialog.querySelector("#legal-title") as HTMLElement).focus({ preventScroll: true });
}

export function closeLegal(): void {
  if (!open) return;
  const { backdrop, opener, inerted, title } = open;
  open = null;
  window.removeEventListener("keydown", onKey, true);
  for (const child of inerted) child.inert = false;
  backdrop.remove();
  document.body.classList.remove("legal-open");
  document.title = title;
  writeParams({ page: null });
  const back = opener?.isConnected ? opener : document.getElementById("welcome-square");
  back?.focus({ preventScroll: true });
}

export const legalOpen = (): boolean => open !== null;

/** The page the address names (`?page=`), if it is one of the four. */
export function pageAtStart(): Slug | null {
  const p = readParam("page");
  return isSlug(p) ? p : null;
}
