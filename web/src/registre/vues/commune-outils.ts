// The commune's family of pages (its fiche, its Documents, its Autorisations), what they share on the
// v2 skeleton (design/registre/v2): the identity line with its typed links, the band's links to the
// commune's other pages (« Fiche », « Carte et drones », as V2-CarteDrones' band), the breadcrumb,
// a document's title and kind in words; and the prototype's tools (app.js `modal`, `demande`): a
// dialog over the page, the request letter to copy (« Demander à la mairie / à la préfecture »).
// Every node is made with createElement, every word comes from the catalogue: nothing is sent
// anywhere. R1's share image (a canvas, downloaded) is gone: « Partager » is the band's
// (partage.ts), its image the build's (lot R3).
import { communeHref, type Donnees } from "../commun.ts";
import type { Lexique } from "../corpus.ts";
import type { RichItem } from "../dc.ts";
import type { Evenement } from "../donnees.ts";
import { fr } from "../format.ts";
import { t } from "../i18n.ts";
import { lien, lienDepartement } from "../liens.ts";
import type { Miette } from "../modale.ts";
import { sentence } from "../texte.ts";

/** The commune's file read as a lexicon (corpus.ts): its companies, buyers and communes have pages. */
export const lexique = (d: Donnees): Lexique => d.f as unknown as Lexique;

/** The intercommunality's address: it has no fiche of its own, its row on its département's page
 * (`?ic=`, departement.ts) shows it. */
export const epciHref = (dep: string, code: string): string =>
  `/registre/departement/${dep}?ic=${encodeURIComponent(code)}`;

/** The head's identity line: its département and its intercommunality as links, its population,
 * its INSEE code (V2-Entreprise's `idline`). */
export function ligneCommune(d: Donnees): RichItem[] {
  const c = d.f.commune;
  const dep = d.f.stats.dep;
  const epci = d.f.stats.epci;
  const parts: RichItem[][] = [[lienDepartement(c.dep, dep.nom ?? c.dep)]];
  if (epci) parts.push([lien("epci", epciHref(c.dep, epci.code), epci.nom ?? epci.code)]);
  if (c.pop) parts.push([t("commun.habitants", { n: fr(c.pop) })]);
  parts.push([t("commun.code_insee", { insee: d.insee })]);
  return parts.flatMap((p, i) => (i ? [" · ", ...p] : p));
}

/** A band link: one of the page's sections (`k` its id), or another page of the commune. */
export type LienBande = { k: string; n: number; l: string; href: string };

/** The band's links: on the fiche its sections then « Carte et drones »; on Documents and
 * Autorisations « Fiche » first (V2-CarteDrones: « Fiche | Carte et drones »). A link to another
 * page carries a `data-sec` that no section has: the band never marks it current. */
export function liensBande(secs: LienBande[], insee: string, fiche: boolean): LienBande[] {
  return [
    ...(fiche ? [] : [{ k: "fiche", n: 0, l: t("commune.bande_fiche"), href: communeHref(insee) }]),
    ...secs,
    { k: "carte", n: 0, l: t("commune.carte_et_drones"), href: communeHref(insee, "carte") },
  ];
}

/** The breadcrumb of Documents and Autorisations: Registre › Communes › <commune>; the last step,
 * « Documents » or « Autorisations », is the view's title. */
export function filCommune(d: Donnees): Miette[] {
  return [
    { k: "registre", l: t("types.registre.l"), href: "/registre/" },
    { k: "commune", l: t("types.commune.p"), href: "/registre/" },
    { k: "commune", l: d.f.commune.nom, href: communeHref(d.insee) },
  ];
}

/** A document's kind in words (« Contrat », « Arrêté »…), the Documents table's badge. */
export const typeLabel = (e: Evenement): string =>
  t(
    `documents.type_${e.t.startsWith("arrete") ? "arrete" : e.t.startsWith("subvention") ? "subvention" : e.t}`,
  );

/** A document's title: a decree by what it authorises, anything else by its published object. */
export function titreDocument(e: Evenement): string {
  if (e.t === "arrete_drone") {
    const n = e.partage?.length ?? 0;
    return n
      ? `${t("documents.titre_drones")} · ${t("documents.partage", { n })}`
      : t("documents.titre_drones");
  }
  if (e.t === "arrete_pietons") return t("documents.titre_pietons");
  if (e.t === "arrete_vsa") return t("documents.titre_vsa");
  if (e.t === "arrete")
    return e.cameras != null
      ? t("documents.titre_cameras", { n: e.cameras })
      : t("documents.titre_cameras_nc");
  return sentence(e.objet) || t("documents.objet_non_publie");
}

// --- the dialog and the request letter ----------------------------------------------------------

type Attrs = Record<string, string>;
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...kids: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const x = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) x.setAttribute(k, v);
  x.append(...kids);
  return x;
}

let seq = 0;
/** A modal dialog (role="dialog", the page behind made inert), closed by its button, Escape or a
 * click outside; the focus goes back to what opened it. */
export function dialogue(titre: string, corps: (Node | string)[], focus?: HTMLElement): void {
  const opener = document.activeElement as HTMLElement | null;
  const id = `dlg-${++seq}`;
  const fermer = el("button", { type: "button", class: "btn" }, t("commune.fermer"));
  const box = el(
    "div",
    { class: "box", role: "dialog", "aria-modal": "true", "aria-labelledby": id },
    el("h2", { id }, titre),
    ...corps,
    el("p", {}, fermer),
  );
  const m = el("div", { class: "dialogue" }, box);
  const behind = [...document.body.children].filter((x): x is HTMLElement => x !== m);
  const close = () => {
    m.remove();
    document.removeEventListener("keydown", key, true);
    for (const x of behind) x.inert = false;
    opener?.focus?.();
  };
  const key = (ev: KeyboardEvent) => {
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      close();
    } else if (ev.key === "Tab") {
      // the focus stays in the dialog
      const f = [...box.querySelectorAll<HTMLElement>("a[href], button, textarea")];
      const first = f[0];
      const last = f[f.length - 1];
      if (ev.shiftKey && document.activeElement === first) {
        ev.preventDefault();
        last.focus();
      } else if (!ev.shiftKey && document.activeElement === last) {
        ev.preventDefault();
        first.focus();
      }
    }
  };
  m.addEventListener("click", (ev) => {
    if (ev.target === m) close();
  });
  fermer.addEventListener("click", close);
  document.addEventListener("keydown", key, true);
  document.body.append(m);
  for (const x of behind) x.inert = true;
  (focus ?? fermer).focus();
}

/** The letter asking a mairie or a préfecture for a document (code des relations entre le public et
 * l'administration, L.311-1), to send oneself. */
export function lettre(objet: string, qui: "mairie" | "prefecture", nom: string, dep: string) {
  const dest =
    qui === "prefecture"
      ? t("commune.demande_dest_prefecture", { dep })
      : t("commune.demande_dest_mairie", { nom });
  return t("commune.demande_lettre", { dest, objet });
}

/** « Demander à la mairie / à la préfecture »: the letter in a field, selected, with a copy button. */
export function demander(objet: string, qui: "mairie" | "prefecture", nom: string, dep: string) {
  const texte = el("textarea", { "aria-label": t("commune.demande_titre"), rows: "12" });
  texte.value = lettre(objet, qui, nom, dep);
  const copier = el("button", { type: "button", class: "btn" }, t("commune.demande_copier"));
  const dit = el("span", { "aria-live": "polite", class: "tw" });
  copier.addEventListener("click", async () => {
    texte.select();
    try {
      await navigator.clipboard.writeText(texte.value);
      dit.textContent = t("commune.demande_copie");
    } catch {
      dit.textContent = t("commune.demande_copie_main");
    }
  });
  const [avant, apres] = t("commune.demande_madada", { lien: "" }).split("");
  const madada = el(
    "a",
    { href: "https://madada.fr/", target: "_blank", rel: "noopener" },
    t("commune.demande_madada_lien"),
  );
  dialogue(
    t("commune.demande_titre"),
    [
      el(
        "p",
        {},
        t("commune.demande_intro", {
          qui: t(qui === "mairie" ? "commune.la_mairie" : "commune.la_prefecture"),
        }),
      ),
      texte,
      el("p", {}, copier, " ", dit),
      el("p", { class: "note" }, t("commune.demande_note")),
      el("p", {}, avant ?? "", madada, apres ?? ""),
    ],
    texte,
  );
  texte.select();
}
