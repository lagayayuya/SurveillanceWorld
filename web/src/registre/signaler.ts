// « Signaler une erreur »: no one reviews the register, so a reader's report is its correction
// (DECISIONS 2026-10-28). A document's panel and its record link to the record's form
// (/registre/contrat/<affaire>?doc=<id>#signaler: a page of its own without the script); a click
// opens the form in a dialog over the page instead, built node by node (.modal of registre.css),
// every word from the catalogue. It posts to the API (POST /api/registre/signalement,
// pipeline/lacarte/api/registre.py): what is wrong, the correction, an optional source and an
// optional contact; no account. A reviewer accepts or refuses it in /revue; an accepted one is
// applied at the next build.

import type { Evenement } from "./donnees.ts";
import { t } from "./i18n.ts";

/** What is wrong, as the API names it (registre.py CATEGORIES), in the form's order. */
export const CATEGORIES = [
  "montant",
  "date",
  "entreprise",
  "commune",
  "nom",
  "lien",
  "cameras",
  "zone",
  "autre",
] as const;
export type Categorie = (typeof CATEGORIES)[number];

export const HASH = "#signaler";

/** The link to a document's form: its record's address, the document named by `doc`. */
export function signalerHref(e: Pick<Evenement, "id" | "affaire">): string {
  return `/registre/contrat/${encodeURIComponent(e.affaire)}?doc=${encodeURIComponent(e.id)}${HASH}`;
}

/** The panel's link « Signaler une erreur ». */
export function signaler(e: Pick<Evenement, "id" | "affaire">): { href: string; l: string } {
  return { href: signalerHref(e), l: t("signaler.lien") };
}

/** The document a form link names: { evenement, affaire }, or null for any other address. */
export function cible(
  href: string,
  base = "http://x/",
): { evenement: string; affaire: string } | null {
  let url: URL;
  try {
    url = new URL(href, base);
  } catch {
    return null;
  }
  if (url.origin !== new URL(base).origin) return null;
  const m = /^\/registre\/contrat\/([^/]+)$/.exec(url.pathname);
  if (!m || url.hash !== HASH) return null;
  const affaire = decodeURIComponent(m[1]);
  return { evenement: url.searchParams.get("doc") || affaire, affaire };
}

export type Envoi = {
  evenement: string;
  affaire: string;
  category: Categorie;
  correction: string;
  source?: string;
  contact?: string;
};

/** The request's body: the optional fields left out when empty. */
export function corps(x: Envoi): Record<string, string> {
  const out: Record<string, string> = {
    evenement: x.evenement,
    affaire: x.affaire,
    category: x.category,
    correction: x.correction.trim(),
  };
  const source = x.source?.trim();
  const contact = x.contact?.trim();
  if (source) out.source = source;
  if (contact) out.contact = contact;
  return out;
}

/** The sentence an answer gets: « envoye » when received, else why not. */
export function issue(status: number, error?: string, fields: string[] = []): string {
  if (status === 201) return "envoye";
  if (status === 429) return "rythme";
  if (status === 403 && error === "closed") return "ferme";
  if (status === 422 && fields.includes("source")) return "source";
  if (status === 422 && fields.includes("contact")) return "contact";
  if (status === 422) return "invalide";
  return "echec";
}

async function envoyer(x: Envoi): Promise<string> {
  try {
    const r = await fetch("/api/registre/signalement", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(corps(x)),
    });
    const body = (await r.json().catch(() => ({}))) as { error?: string; fields?: string[] };
    return issue(r.status, body.error, body.fields);
  } catch {
    return "echec";
  }
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...kids: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...kids);
  return node;
}

/** A labelled field: its label above, an optional hint under the label. */
function champ(id: string, label: string, input: HTMLElement, hint?: string): HTMLElement {
  input.id = id;
  const l = el("label", { htmlFor: id, className: "lbl" }, label);
  const wrap = el("p", { className: "champ" }, l);
  if (hint) {
    const h = el("span", { id: `${id}-aide`, className: "aide" }, hint);
    input.setAttribute("aria-describedby", h.id);
    wrap.append(h);
  }
  wrap.append(input);
  return wrap;
}

export function ouvrir(evenement: string, affaire: string): void {
  const opener = document.activeElement as HTMLElement | null;
  const m = el("div", { className: "modal" });
  const box = el("div", { className: "box signaler" });
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-modal", "true");
  box.setAttribute("aria-labelledby", "dlg-signaler");
  const h = el("h2", { id: "dlg-signaler" }, t("signaler.titre"));
  const ref = el("p", { className: "ref" }, t("signaler.document", { id: evenement }));
  const intro = el("p", {}, t("signaler.intro"));

  const quoi = el(
    "fieldset",
    { className: "quoi" },
    el("legend", { className: "lbl" }, t("signaler.quoi")),
  );
  for (const c of CATEGORIES) {
    const input = el("input", { type: "radio", name: "categorie", value: c, required: true });
    quoi.append(el("label", {}, input, ` ${t(`signaler.cat.${c}`)}`));
  }
  const correction = el("textarea", { required: true, maxLength: 1000, rows: 4 });
  const source = el("input", { type: "url", maxLength: 500, inputMode: "url" });
  source.setAttribute("autocomplete", "off");
  const contact = el("input", { type: "text", maxLength: 200 });
  contact.setAttribute("autocomplete", "email");
  const garde = el(
    "p",
    { className: "note" },
    `${t("signaler.garde")} `,
    el("a", { href: "/?page=confidentialite" }, t("signaler.confidentialite")),
  );
  const etat = el("p", { className: "etat" });
  etat.setAttribute("role", "status");
  const envoi = el("button", { type: "submit", className: "btn" }, t("signaler.envoyer"));
  const fermer = el("button", { type: "button", className: "btn" }, t("signaler.annuler"));
  const form = el(
    "form",
    {},
    quoi,
    champ("sig-correction", t("signaler.correction"), correction, t("signaler.correction_aide")),
    champ("sig-source", t("signaler.source"), source, t("signaler.source_aide")),
    champ("sig-contact", t("signaler.contact"), contact, t("signaler.contact_aide")),
    garde,
    etat,
    el("p", { className: "actions" }, envoi, " ", fermer),
  );
  // the catalogue's own message, not the browser's (its words and its language)
  form.noValidate = true;
  box.append(h, ref, intro, form);
  m.append(box);

  const shut = () => {
    m.remove();
    document.removeEventListener("keydown", key);
    opener?.focus?.();
  };
  const key = (ev: KeyboardEvent) => {
    if (ev.key === "Escape") shut();
  };
  m.addEventListener("click", (ev) => {
    if (ev.target === m || ev.target === fermer) shut();
  });
  form.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const choisie = form.querySelector<HTMLInputElement>('input[name="categorie"]:checked');
    if (!choisie || !correction.value.trim()) {
      etat.textContent = t("signaler.etat.incomplet");
      (choisie ? correction : quoi.querySelector("input"))?.focus();
      return;
    }
    envoi.disabled = true;
    etat.textContent = t("signaler.etat.envoi");
    void envoyer({
      evenement,
      affaire,
      category: choisie.value as Categorie,
      correction: correction.value,
      source: source.value,
      contact: contact.value,
    }).then((k) => {
      etat.textContent = t(`signaler.etat.${k}`);
      if (k === "envoye") {
        form.replaceChildren(etat, el("p", { className: "actions" }, fermer));
        fermer.textContent = t("signaler.fermer");
        fermer.focus();
      } else envoi.disabled = false;
    });
  });
  document.addEventListener("keydown", key);
  document.body.append(m);
  quoi.querySelector("input")?.focus();
}

// before the router's own listener (main.ts), which would open the record's page (no document
// in the tests)
if (typeof document !== "undefined")
  document.addEventListener(
    "click",
    (ev) => {
      if (ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
      const a = (ev.target as Element | null)?.closest?.<HTMLAnchorElement>("a[href]");
      const x = a ? cible(a.href, location.href) : null;
      if (!x) return;
      ev.preventDefault();
      ev.stopPropagation();
      ouvrir(x.evenement, x.affaire);
    },
    true,
  );
