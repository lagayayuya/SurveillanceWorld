// The commune's family of pages (its fiche, its Documents, its Autorisations), what they share on the
// v2 skeleton (design/registre/v2): the identity line with its typed links, the band's links to the
// commune's other pages (« Fiche », « Carte et drones », as V2-CarteDrones' band), the breadcrumb,
// a document's title and kind in words; and the prototype's tools (app.js `modal`, `demande`): a
// dialog over the page, the request letter to copy (« Demander à la mairie / à la préfecture »).
// Every node is made with createElement, every word comes from the catalogue: nothing is sent
// anywhere. R1's share image (a canvas, downloaded) is gone: « Partager » is the band's
// (partage.ts), its image the build's (lot R3).
import { benefLabel, communeHref, type Donnees, isArr } from "../commun.ts";
import type { Lexique } from "../corpus.ts";
import type { Rich, RichItem } from "../dc.ts";
import type { Evenement } from "../donnees.ts";
import { fr, shortDate } from "../format.ts";
import { has, t } from "../i18n.ts";
import { lien, lienAcheteur, lienDepartement, lienEntreprise } from "../liens.ts";
import type { Miette } from "../modale.ts";
import { signaler } from "../signaler.ts";
import { capital, proper, sentence, tidy, titleCase } from "../texte.ts";

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

/** Who a document is about: the mairie (m), another public buyer (o), the State (e), a company or
 * a shop (p), a name not published (n); its words, and the same as typed links (the buyer, the
 * beneficiary or the companies that have their fiche). `self`: the page is the commune's own
 * fiche, where its name is not a link to itself. */
export type Qui = { qk: string; qui: string; quiR: Rich; ent: string; entR: Rich };
export function quiDocument(d: Donnees, e: Evenement, self = false): Qui {
  const L = lexique(d);
  const insee = d.insee;
  const nom = d.f.commune.nom;
  const isA = isArr(e);
  const isSub = e.t.startsWith("subvention");
  const masked = e.beneficiaire === "[non retenu]" || e.nom_publie === false;
  const qk = isA
    ? e.communal
      ? "m"
      : masked
        ? "n"
        : e.type_beneficiaire === "etat"
          ? "e"
          : "p"
    : isSub || e.communal
      ? "m"
      : "o";
  const buyer = !isA && !isSub ? d.buyer(e) : null;
  const qui =
    qk === "m"
      ? isA && e.type_beneficiaire === "epci"
        ? benefLabel(e)
        : t("documents.mairie_de", { nom })
      : qk === "n"
        ? t("commun.nom_non_publie")
        : isA
          ? benefLabel(e)
          : buyer
            ? d.buyerNom(buyer)
            : tidy(titleCase(String(e.acheteur ?? "")));
  const bs = e.beneficiaire_siren;
  const quiR: Rich =
    qk === "o" && buyer
      ? [lienAcheteur(L, buyer, qui)]
      : qk === "m" && !self
        ? [lien("commune", communeHref(insee), qui)]
        : qk === "p" && bs && L.entreprises[bs]
          ? [lienEntreprise(L, bs, qui)]
          : qui;
  const sirens =
    (e.t === "attribution" || e.t === "modification") && e.entreprises?.length ? e.entreprises : [];
  const entR: Rich = sirens.length
    ? [
        "→ ",
        ...sirens.flatMap((s, i) => [...(i ? [", "] : []), lienEntreprise(L, s, d.entName(s))]),
      ]
    : "";
  return { qk, qui, quiR, ent: sirens.map((s) => d.entName(s)).join(", "), entR };
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

// --- a decree in a panel (v2.1 A8): everything the build gives of it ------------------------------
// Shared by the commune's Autorisations and Documents and by the register's lists: what a decree
// authorises, for whom, where and when, as the pipeline read it; nothing computed here (a field
// the build does not give is asked of a data lot, never derived). Words: registre.autorisations.

/** A drone or algorithmic zone as the build writes it (commune file, zones.zones[]). */
export type ZoneArrete = {
  acte: string;
  creneau?: number;
  t0?: number;
  t1?: number;
  heures_sures?: boolean;
  date_sure?: boolean;
  quotidien?: boolean;
  service?: string;
  finalite?: string;
  detail?: string;
  statut?: string;
  alerte?: string;
  [k: string]: unknown;
};

/** What a panel shows of a decree (socle's panneau): a value may be rich (a link, a long text). */
export type PanneauArrete = {
  kicker: string;
  title: Rich;
  rows: [string, Rich][];
  note?: string;
  foot: string;
  links: { l: string; href: string }[];
};

/** « Acte 69-2025-11-18-00015, p. 8 ». */
export const acteArrete = (e: Evenement): string =>
  e.page
    ? t("autorisations.acte_page", { id: e.id, page: String(e.page) })
    : t("autorisations.acte", { id: e.id });

/** A decree's two links: its source, and the report of an error. */
export function liensArrete(e: Evenement): { l: string; href: string }[] {
  return [...(e.url ? [{ l: t("arretes.voir"), href: e.url }] : []), signaler(e)];
}

/** The beneficiary's category in words, from the decree's type of beneficiary. */
export function categorieArrete(e: Evenement): string {
  if (/pharmacie/i.test(String(e.beneficiaire ?? ""))) return t("autorisations.cat.pharmacie");
  const k = String(e.type_beneficiaire || "commerce").replace(/\s+/g, "_");
  return has(`registre.autorisations.cat.${k}`) ? t(`autorisations.cat.${k}`) : capital(k);
}

/** A beneficiary's published name, or null for « nom non publié » (the build's nom_publie). */
export function nomPublieArrete(e: Evenement): string | null {
  if (e.beneficiaire === "[non retenu]" || e.nom_publie === false || !e.beneficiaire) return null;
  if (e.beneficiaire === "[non précisé]") return t("commun.non_precise");
  return proper(tidy(titleCase(e.beneficiaire)));
}

/** The beneficiary as a mention: a company that has its fiche, the commune for its mairie. */
export function beneficiaireArrete(L: Lexique, e: Evenement): RichItem[] {
  const nm = nomPublieArrete(e);
  if (!nm) return [{ span: t("commun.nom_non_publie"), cls: "np" }];
  const s = e.beneficiaire_siren;
  if (s && L.entreprises[s] && !L.entreprises[s].entrepreneur_individuel)
    return [lienEntreprise(L, s, nm)];
  if (e.type_beneficiaire === "commune" && e.insee && L.communes[e.insee])
    return [lien("commune", communeHref(e.insee), nm)];
  return [nm];
}

/** A device's count with its word: « 2 drones », « 3 caméras-piétons », « 5 caméras ». */
export function appareils(e: Evenement): string {
  const n = e.cameras ?? 0;
  if (e.t === "arrete_drone") return t("autorisations.n_drones", { n });
  if (e.t === "arrete_pietons") return t("autorisations.n_pietons", { n });
  return t("n.camera", { n });
}

const PARIS = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "Europe/Paris",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
/** A slot's bound, in Paris: its day (YYYY-MM-DD) and its hour (« 9 h », « 9 h 30 »). */
function paris(ms: number): { jour: string; h: number; heure: string } {
  const p = Object.fromEntries(PARIS.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const h = Number(p.hour);
  return {
    jour: `${p.year}-${p.month}-${p.day}`,
    h,
    heure:
      p.minute === "00"
        ? t("autorisations.heure", { h })
        : t("autorisations.heure_min", { h, m: p.minute }),
  };
}

/** A slot in words: its date, its hours when the act gives them (heures_sures), every day. */
export function creneauArrete(z: ZoneArrete): string {
  if (z.t0 == null || z.t1 == null) return t("autorisations.creneau_inconnu");
  const a = paris(z.t0);
  const b = paris(z.t1);
  // a slot that ends at midnight ends the same day
  const memeJour =
    a.jour === b.jour || (b.heure === t("autorisations.heure", { h: 0 }) && z.t1 - z.t0 <= 864e5);
  let s: string;
  if (!z.heures_sures)
    s =
      a.jour === b.jour
        ? shortDate(a.jour)
        : t("autorisations.creneau_jours", { d0: shortDate(a.jour), d1: shortDate(b.jour) });
  else
    s = memeJour
      ? t("autorisations.creneau_heures", { date: shortDate(a.jour), de: a.heure, a: b.heure })
      : t("autorisations.creneau_du_au", {
          d0: shortDate(a.jour),
          de: a.heure,
          d1: shortDate(b.jour),
          a: b.heure,
        });
  if (!z.heures_sures) s += ` · ${t("autorisations.horaires_non_precises")}`;
  if (z.date_sure === false) s += ` · ${t("autorisations.date_a_verifier")}`;
  if (z.quotidien) s += ` · ${t("autorisations.chaque_jour")}`;
  return s;
}

/** The act's period as the build writes it (« 2026-10-01 au 2026-10-16 », « 2025-11-11 »), in
 * words; any other wording as it is. */
function periodeArrete(v: unknown): string {
  const p = uneLigne(v);
  const m = /^(\d{4}-\d\d-\d\d)(?: au (\d{4}-\d\d-\d\d))?$/.exec(p);
  if (!m) return p;
  return m[2]
    ? t("autorisations.creneau_jours", { d0: shortDate(m[1]), d1: shortDate(m[2]) })
    : shortDate(m[1]);
}

/** A long value (a place, a purpose): under its label, not squeezed at its right. */
const long = (s: string): RichItem[] => [{ span: s, cls: "long" }];
const uneLigne = (s: unknown): string =>
  String(s ?? "")
    .replace(/\s+/g, " ")
    .trim();
const mot = (ns: string, v: unknown): string => {
  const k = uneLigne(v).replace(/\s+/g, "_");
  return !k
    ? ""
    : has(`registre.autorisations.${ns}.${k}`)
      ? t(`autorisations.${ns}.${k}`)
      : uneLigne(v);
};

/** A decree in the panel: video protection (its beneficiary, its category, its cameras by
 * place, its duration, what it allows) or drones, body cameras, algorithmic analysis (its
 * service, its purpose, its devices, its places and slots as the act names them, its zone's
 * drawing), then its reference; its act and page in the foot. `zones`: the commune file's zones
 * of this act (none in the lists, whose file has no zones). */
export function panneauArrete(L: Lexique, e: Evenement, zones: ZoneArrete[] = []): PanneauArrete {
  const rows: [string, Rich][] = [];
  const add = (k: string, v: Rich | null | undefined | false) => {
    if (v != null && v !== false && v !== "") rows.push([t(`autorisations.p.${k}`), v]);
  };
  const date = shortDate(e.date);
  const lisible = e.cameras != null && !e.non_lu?.includes("nombre_illisible");
  const nature = mot("nature", e.sous_type);
  const qui = beneficiaireArrete(L, e);
  const links = liensArrete(e);
  let note: string | undefined;
  if (e.t === "arrete") {
    // the beneficiary is the title's: not again in a row
    add("categorie", categorieArrete(e));
    add("nature", nature);
    add("cameras", lisible ? fr(e.cameras ?? 0) : t("non_lu.nombre_illisible"));
    add("rue", e.cameras_vp != null && fr(e.cameras_vp));
    add("abords", e.cameras_ext != null && fr(e.cameras_ext));
    add("interieur", e.cameras_int != null && fr(e.cameras_int));
    add("duree", e.duree || t("autorisations.non_precisee"));
    add("periode", periodeArrete(e.periode));
    add("verbalisation", e.videoverbalisation === true && t("autorisations.oui"));
    add("deport", e.deport_forces === true && t("autorisations.oui"));
    add("dossier", e.dossier ? String(e.dossier) : "");
    // where the act puts the place, when the build noted it (no address of the establishment)
    add("lieu_note", e.note_lieu ? long(uneLigne(e.note_lieu)) : "");
    if (!lisible) note = t("autorisations.note_illisible");
  } else {
    // the service is the title's: not again in a row
    const finalite = uneLigne(zones[0]?.finalite);
    add("finalite", finalite && finalite !== uneLigne(e.objet) ? long(finalite) : "");
    add("objet", e.objet ? long(uneLigne(e.objet)) : "");
    add("vol", mot("vol", e.nature_vol));
    // the number of devices, or the act's own words when it gives none (cameras_lib)
    add(
      "appareils",
      e.cameras != null ? appareils(e) : e.cameras_lib ? uneLigne(e.cameras_lib) : "",
    );
    add("periode", zones.length ? "" : periodeArrete(e.periode));
    let lieu = "";
    zones.forEach((z, i) => {
      rows.push([
        zones.length > 1
          ? t("autorisations.p.creneau_n", { n: i + 1 })
          : t("autorisations.p.creneau"),
        creneauArrete(z),
      ]);
      const d = uneLigne(z.detail);
      if (d && d !== lieu) add("lieu", long(d));
      lieu = d;
    });
    const statuts = [...new Set(zones.map((z) => uneLigne(z.statut)).filter(Boolean))];
    add("trace", statuts.map((s) => mot("statut", s)).join(", "));
    const autres = (e.partage ?? []).filter((k) => k !== e.insee);
    if (autres.length)
      add(
        "communes",
        autres.flatMap((k, i) => [
          ...(i ? [", "] : []),
          L.communes[k] ? lien("commune", communeHref(k), L.communes[k].nom) : k,
        ]),
      );
    const noteLieu = uneLigne(e.note_lieu);
    add(
      "lieu_note",
      noteLieu && !zones.some((z) => uneLigne(z.detail) === noteLieu) ? long(noteLieu) : "",
    );
    add("nature", nature);
    const alerte = zones.map((z) => uneLigne(z.alerte)).find(Boolean);
    const sansZone = !!e.non_lu?.includes("zone_non_deduite");
    if (sansZone) note = t("arretes.zone_non_deduite");
    else if (alerte) note = alerte;
    // the zone on the map: the commune's « Drones et algorithmes », at the slot's month when the
    // commune's file gives the slot (the lists' file has no zones: the view at its default)
    const z = zones.find((x) => x.t0 != null);
    if (e.insee && !sansZone && /^arrete_(drone|vsa)$/.test(e.t))
      links.unshift({
        l: t("autorisations.voir_drones"),
        href: `${communeHref(e.insee, "carte")}${z?.t0 != null ? `?mois=${paris(z.t0).jour.slice(0, 7)}` : ""}`,
      });
  }
  add("reference", e.ref ? long(uneLigne(e.ref)) : "");
  add("publie_par", e.publie_par ? String(e.publie_par) : "");
  const kind = has(`registre.autorisations.type.${e.t}`)
    ? t(`autorisations.type.${e.t}`)
    : t("autorisations.type.autre");
  return {
    kicker: e.t === "arrete" ? t("autorisations.kicker_arrete", { date }) : `${kind} · ${date}`,
    title: [
      ...qui,
      e.t === "arrete"
        ? ` · ${lisible ? t("n.camera", { n: e.cameras ?? 0 }) : t("non_lu.nombre_illisible")}`
        : e.cameras != null
          ? ` · ${appareils(e)}`
          : "",
    ].filter((x) => x !== ""),
    rows,
    note,
    foot: acteArrete(e),
    links,
  };
}
