// A document's record (/registre/contrat/<affaire>; mockup Contrat-grand, prototype vues/contrat.js): one
// model for its four kinds — a contract (call for tenders → contract → modifications → planned end), a
// call for tenders without a contract, a subsidy, a decree without a commune — read from the build's
// document/<affaire>.json. What the whole corpus says around it (the previous contract, the next call for
// tenders, the company's contracts and buyers, the planned end, the contract that followed) is the build's
// « parcours » (pipeline/lacarte_registre/parcours.py), read here, never recomputed. Pure: the view
// (contrat.ts) adds its state and handlers, the tests read it.
//
// The v2 skeleton (design/registre/v2): the fiche's type is its main document's (a contract, a call for
// tenders, a subsidy, a decree), its name the short « Contrat de juin 2022 »; what it says (`dl`) and
// whom it names (`qui`) are apart, for L'essentiel and Avec qui; `docs` lists each document of the
// dossier, every modification on its own row; every mention that has its fiche is a typed link
// (liens.ts).

import { benefLabel, byDateAsc, communeHref, emetteur, isArr } from "../commun.ts";
import { BADGE, buyerNom, depNom, disp, entName, type Lexique, titre, typ } from "../corpus.ts";
import { corrections } from "../corrige.ts";
import type { Rich, RichItem } from "../dc.ts";
import type { Acheteur, Affaire, Commune, Entreprise, Evenement } from "../donnees.ts";
import { EI } from "../donnees.ts";
import { docDate, fr, longDate, longMonth, money, shortDate, shortMonth } from "../format.ts";
import { has, t } from "../i18n.ts";
import { lien, lienAcheteur, lienCommune, lienDepartement, lienEntreprise } from "../liens.ts";
import { capital, sentence, tidy } from "../texte.ts";
import type { TypeCle } from "../types.ts";
import { lierDepartement, lierLieux } from "./mention-outils.ts";

export type Parcours = {
  fin_prevue: { date: string; signature: string; mois: number } | null;
  precedent: {
    affaire: string;
    date: string;
    date_a_verifier: boolean;
    entreprises: string[];
    montant: number | null;
  } | null;
  suivant: { affaire: string; date: string } | null;
  entreprises: Record<string, { contrats: number; collectivites: number }>;
  contrat: "probable" | "attendu" | "non_retrouve" | "non_designe" | null;
};
export type Fichier = {
  v: number;
  affaire: Affaire & { id: string };
  evenements: Evenement[];
  affaires: Record<string, Affaire & { id?: string }>;
  entreprises: Record<string, Entreprise>;
  acheteurs: Record<string, Acheteur>;
  communes: Record<string, Commune>;
  libelles: Record<string, { court?: string; titre?: string }>;
  parcours: Parcours;
};

export type Kind = "con" | "ao" | "sub" | "aut";
/** A discreet mark beside a datum (DECISIONS 2026-10-28): its accessible name, or "" for none. */
export type Mark = string;
export type Step = {
  k: "ao" | "con" | "mod" | "fin" | "aut" | "sub";
  /** the document it shows (signaler, the sources' row) */
  id: string;
  type: string;
  date: string;
  dm: Mark;
  what: string;
  lm: Mark;
  ghost: boolean;
  ref: string;
  url: string;
  rows: [string, string][];
  foot: string[];
  /** another record of the register it opens (a probable contract or call for tenders) */
  href?: { l: string; href: string };
  /** the companies it names, as links (a rich row of the panel) */
  qui?: Rich;
  /** `what` with those companies as links (a document's row) */
  whatLien?: Rich;
};
export type Ligne = { k: string; v: Rich; note: string; m: Mark };
/** A link to another record (the previous contract, the next call for tenders), with its type. */
export type Lien = { href: string; l: string; m: Mark; k: TypeCle };
export type Fiche = {
  kind: Kind;
  /** its main document's type: the fiche's (types.ts) */
  type: TypeCle;
  /** the objet (R1's title) */
  titre: string;
  /** the fiche's name: « Contrat de juin 2022 », « Arrêté du 19 juin 2025 » */
  titreDoc: string;
  badge: { l: string; s: string };
  sous: { a: string; m: Mark; b: string };
  lead: Rich;
  kpis: { v: string; l: string; m: Mark }[];
  steps: Step[];
  prec: Lien | null;
  suiv: Lien | null;
  parTitre: string;
  ditTitre: string;
  ditNote: string;
  /** what the document says (L'essentiel), its corrections last */
  dl: Ligne[];
  /** whom it names (Avec qui): buyer, companies, commune, beneficiary, funder, département */
  qui: Ligne[];
  /** each document of the dossier (and a probable one of another), in order; no planned end */
  docs: Step[];
  /** who issues it, for the identity line: the buyer as a link, the funder, the préfecture */
  emetteur: RichItem;
  /** couverture.json's sources it reads (sources.ts) */
  sources: string[];
  /** its département's code, when the build knows it */
  dep: string | null;
  /** where it is: its commune, else its département, as a link (the panel at rest) */
  ou: Ligne | null;
  /** the money line under the amounts (a contract) */
  argent: boolean;
  /** the line on decrees read by a program (a decree) */
  arretes: boolean;
  sum: { kicker: string; title: string; rows: [string, string][] };
  /** what the marks of the page mean, said in the panel at rest */
  reperes: string[];
  /** the document « Signaler une erreur » and « Copier la référence » name */
  main: Evenement;
  ref: string;
  /** the decree's source, linked from the panel at rest */
  source: string;
};

const AO = /^(avis|resultat|rectificatif)$/;
const GHOST =
  "background: transparent; color: var(--muted); border-style: dashed; border-color: var(--muted)";
const STYLE: Record<Step["k"], string> = { ...BADGE, fin: GHOST } as Record<Step["k"], string>;

/** A catalogue message whose placeholders may be rich (bold, a link), put back in place: each rich
 * one is held by a private-use mark while the message is filled, so a digit of the text stays text. */
type Param = string | number | Exclude<RichItem, string>;
export function rt(key: string, params: Record<string, Param> = {}): RichItem[] {
  const holes: RichItem[] = [];
  const flat: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(params)) {
    if (typeof v === "object") {
      flat[k] = `\ue000${holes.length}\ue000`;
      holes.push(v);
    } else flat[k] = v;
  }
  return t(key, flat)
    .split(/\ue000(\d+)\ue000/)
    .map((x, i) => (i % 2 ? holes[Number(x)] : x))
    .filter((x) => x !== "");
}

/** The date the timelines use: the reviewed one when the build has one (regles.py date_lue). */
const lue = (e: Evenement): string => e.date_lue ?? e.date ?? "";
/** A date to check: the review read another date than the source's. */
const aVerifier = (e: Evenement): boolean => !!e.date_lue && e.date_lue !== e.date;
const fd = (e: Evenement): string => docDate(e.date, e.date_annee);
const months = (v: unknown): number | null => {
  const n = Math.round(Number(v));
  return v != null && v !== "" && Number.isFinite(n) && n > 0 ? n : null;
};
/** « 3 ans », « 18 mois ». */
const duree = (m: number): string =>
  m % 12 === 0 ? t("contrat.ans", { n: m / 12 }) : t("contrat.mois", { n: m });

/** A document's reference: the source's, else as the mockup writes it (« DECP <id> », « BOAMP <no> »). */
export function reference(e: Evenement, modifNo?: number): string {
  if (e.ref) return String(e.ref);
  if (e.t === "attribution") return t("contrat.ref_decp", { id: e.affaire });
  if (e.t === "modification")
    return t("contrat.ref_decp_modif", { id: e.affaire, n: modifNo ?? 1 });
  if (AO.test(e.t)) return t("contrat.ref_boamp", { id: e.id });
  if (e.t === "subvention_region") return t("contrat.source_region");
  if (e.t.startsWith("subvention")) return t("contrat.source_etat");
  return "";
}

/** Where a decree opens when the register knows its commune: the commune's Autorisations, at its
 * dossier (corpus.ts docHref's rule); null for anything else. */
export function ouvreAilleurs(f: Fichier): string | null {
  const e = f.affaire.events.map((id) => f.evenements.find((x) => x.id === id)).find(Boolean);
  if (!e || !isArr(e) || !e.insee || !f.communes[e.insee]) return null;
  return `${communeHref(e.insee, "autorisations")}/${encodeURIComponent(f.affaire.id)}`;
}

const contractHref = (id: string) => `/registre/contrat/${encodeURIComponent(id)}`;

export function fiche(f: Fichier): Fiche | null {
  const L = f as unknown as Lexique;
  const a = f.affaire;
  const P = f.parcours;
  const byId = new Map(f.evenements.map((e) => [e.id, e]));
  const eventsOf = (id: string) =>
    (f.affaires[id]?.events ?? [])
      .map((x) => byId.get(x))
      .filter((e): e is Evenement => !!e)
      .sort(byDateAsc);
  const evs = eventsOf(a.id);
  const e0 = evs[0];
  if (!e0) return null;
  const insee = [a.insee, e0?.insee].find((k): k is string => !!k && !!f.communes[k]) ?? null;
  const c = insee ? f.communes[insee] : null;
  const dep = a.dep ?? e0?.dep ?? (c ? c.dep : null);
  const depCode = typeof dep === "string" && dep ? dep : null;
  const depName = depCode ? depNom(depCode) : "";
  const buyer = (a.acheteur_siren as string | undefined) ?? e0?.acheteur_siren ?? null;
  const ach = buyer ? f.acheteurs[buyer] : undefined;
  const communal = ach?.categorie === "commune" && !!ach.insee_siege;
  const buyerTxt = buyer
    ? communal
      ? capital(
          t("contrat.la_mairie_de", {
            nom: f.communes[ach?.insee_siege ?? ""]?.nom ?? buyerNom(L, buyer),
          }),
        )
      : buyerNom(L, buyer)
    : capital(t("contrat.l_acheteur"));
  const buyerLink: Rich = buyer ? [lienAcheteur(L, buyer)] : t("format.non_publie");
  // the buyer at the head of a sentence (« La mairie de Vénissieux »), a link to its fiche
  const buyerLead: RichItem = buyer ? lienAcheteur(L, buyer, buyerTxt) : buyerTxt;
  // a sole trader is never a link (liens.ts)
  const entLinks = (sirens: string[]): RichItem[] =>
    sirens.flatMap((s, i) => [
      ...(i ? [", "] : []),
      s === EI ? entName(L, s) : lienEntreprise(L, s),
    ]);
  // the source's own words (the objet) naming the dossier's commune or département: those links
  const lier = (s: string): Rich => (s ? lierLieux(s, L, insee, depCode) : t("format.non_publie"));
  // the commune the dossier names, when it is not already its buyer (a mairie)
  const communeLigne = (): Ligne[] =>
    c && insee && !(communal && ach?.insee_siege === insee)
      ? [line(t("contrat.d_commune"), [lienCommune(L, insee)])]
      : [];
  const entNames = (sirens: string[]) =>
    sirens.length
      ? sirens.map((s) => entName(L, s)).join(", ")
      : t("contrat.entreprise_non_publiee");
  const lib = f.libelles[a.id];
  const objet = (e?: Evenement) => sentence(e?.objet ?? a.titre ?? "");
  const markD = (e: Evenement): Mark => (aVerifier(e) ? t("repere.date") : "");
  const LIEN = t("repere.lien");
  const explainDate = (e: Evenement): string =>
    aVerifier(e)
      ? t("contrat.repere_date", { source: shortDate(e.date), lue: shortDate(e.date_lue) })
      : "";

  const steps: Step[] = [];
  let kind: Kind;
  let kpis: Fiche["kpis"];
  let lead: Rich;
  let dl: Ligne[];
  let qui: Ligne[];
  let docs: Step[] | null = null;
  let emet: RichItem = "";
  let srcs: string[];
  let sum: Fiche["sum"];
  let titreDoc: string;
  let prec: Lien | null = null;
  let suiv: Lien | null = null;
  let main: Evenement = e0;
  let argent = false;
  let arretes = false;
  const line = (k: string, v: Rich, note = "", m: Mark = ""): Ligne => ({ k, v, note, m });

  if (a.kind === "contrat" && evs.some((e) => e.t === "attribution")) {
    kind = "con";
    const att = evs.find((e) => e.t === "attribution") as Evenement;
    main = att;
    const mods = evs.filter((e) => e.t === "modification");
    const avis = evs.filter((e) => e.t === "avis");
    const probAvis = ((a.avis_probables as string[] | undefined) ?? [])
      .map((x) => eventsOf(x)[0])
      .filter((e): e is Evenement => !!e);
    const aoE = avis[0] ?? probAvis[0];
    const aoProb = !avis[0] && !!probAvis[0];
    const lastM = mods[mods.length - 1] ?? att;
    const dur = months(lastM.duree) ?? months(att.duree);
    const fin = P.fin_prevue;
    const sirens = att.entreprises ?? [];
    const offres = att.offres != null ? Number(att.offres) : null;
    const signe = sirens.length
      ? t("contrat.signe_avec", { ents: entNames(sirens) })
      : t("contrat.signe_avec", { ents: t("contrat.entreprise_non_publiee") });
    if (aoE) {
      const results = (f.affaires[aoE.affaire]?.events ?? [])
        .map((x) => byId.get(x))
        .filter((x): x is Evenement => x?.t === "resultat");
      steps.push({
        k: "ao",
        id: aoE.id,
        type: t("contrat.type_avis"),
        date: fd(aoE),
        dm: markD(aoE),
        what: communal ? t("contrat.ao_mairie") : t("contrat.ao_acheteur"),
        lm: aoProb ? LIEN : "",
        ghost: false,
        ref: reference(aoE),
        url: aoE.url ?? "",
        rows: [
          [t("contrat.p_objet"), lib?.court ?? (objet(aoE) || t("format.non_publie"))],
          [t("contrat.p_resultat"), results.map((x) => fd(x)).join(", ") || t("format.non_publie")],
        ],
        foot: [t("contrat.source_boamp"), explainDate(aoE), aoProb ? t("contrat.repere_lien") : ""],
        href:
          aoProb && aoE.affaire !== a.id
            ? { l: t("contrat.fiche_ao"), href: contractHref(aoE.affaire) }
            : undefined,
      });
    }
    steps.push({
      k: "con",
      id: att.id,
      type: t("contrat.type_attribution"),
      date: fd(att),
      dm: markD(att),
      what: offres != null ? `${signe}, ${t("contrat.offres_recues", { n: offres })}` : signe,
      lm: "",
      ghost: false,
      ref: reference(att),
      url: att.url ?? "",
      rows: [
        [t("contrat.p_montant"), money(att.montant)],
        [
          t("contrat.p_duree"),
          months(att.duree)
            ? t("contrat.mois", { n: months(att.duree) ?? 0 })
            : t("contrat.non_publiee"),
        ],
        [t("contrat.p_offres"), offres != null ? fr(offres) : t("format.non_publie")],
        [t("contrat.p_forme"), formeTxt(a)],
      ],
      foot: [t("contrat.source_decp"), explainDate(att)],
      qui: sirens.length ? entLinks(sirens) : undefined,
      whatLien: sirens.length
        ? [
            ...rt("contrat.signe_avec", { ents: { span: entLinks(sirens), cls: "" } }),
            offres != null ? `, ${t("contrat.offres_recues", { n: offres })}` : "",
          ]
        : undefined,
    });
    const modStep = (m: Evenement, i: number): Step => {
      const ch = (m.changements as string[] | undefined) ?? [];
      const n = Number(m.modif_n) || i + 1;
      return {
        k: "mod",
        id: m.id,
        type: t("contrat.type_modification"),
        date: fd(m),
        dm: markD(m),
        what: t("contrat.modification_no", { n }),
        lm: "",
        ghost: false,
        ref: reference(m, n),
        url: m.url ?? "",
        rows: [
          [
            t("contrat.p_montant"),
            m.montant === att.montant && m.montant != null
              ? t("contrat.inchange", { v: money(m.montant) })
              : money(m.montant),
          ],
          [
            t("contrat.p_duree"),
            months(m.duree)
              ? months(m.duree) === months(att.duree)
                ? t("contrat.inchangee", { v: t("contrat.mois", { n: months(m.duree) ?? 0 }) })
                : t("contrat.mois", { n: months(m.duree) ?? 0 })
              : "—",
          ],
          [t("contrat.p_changements"), ch.length ? ch.join(" ; ") : t("format.non_publie")],
        ],
        foot: [
          t("contrat.source_decp"),
          explainDate(m),
          ch.length ? "" : t("contrat.avenant_muet"),
        ],
      };
    };
    if (mods.length > 2) {
      const last = mods[mods.length - 1];
      steps.push({
        k: "mod",
        id: last.id,
        type: t("contrat.type_modification"),
        date: `${fd(mods[0])} → ${fd(last)}`,
        dm: "",
        what: t("contrat.modifications_n", { n: mods.length }),
        lm: "",
        ghost: false,
        ref: reference(last, Number(last.modif_n) || mods.length),
        url: last.url ?? "",
        rows: mods.map((m) => [fd(m), money(m.montant)]),
        foot: [t("contrat.source_decp"), t("contrat.avenants_muets")],
      });
    } else for (const [i, m] of mods.entries()) steps.push(modStep(m, i));
    // the documents: the call for tenders and the contract, then every modification on its own row
    docs = [...steps.filter((s) => s.k !== "mod"), ...mods.map(modStep)];
    if (fin) {
      steps.push({
        k: "fin",
        id: "",
        type: t("contrat.type_fin"),
        date: t("contrat.fin_date", { date: shortMonth(fin.date) }),
        dm: "",
        what: t("contrat.fin_calcul", { n: fin.mois }),
        lm: "",
        ghost: true,
        ref: "",
        url: "",
        rows: [
          [
            t("contrat.p_calcul"),
            t("contrat.fin_calcul_detail", { date: shortDate(fin.signature), n: fin.mois }),
          ],
          ...(P.suivant
            ? ([
                [
                  t("contrat.p_nouvel_ao"),
                  t("contrat.publie_des", { mois: longMonth(P.suivant.date) }),
                ],
              ] as [string, string][])
            : []),
        ],
        foot: [t("contrat.fin_calculee")],
      });
    }
    if (P.precedent) {
      const p = P.precedent;
      prec = {
        href: contractHref(p.affaire),
        l: t("contrat.precedent", {
          an: p.date.slice(0, 4),
          ent: p.entreprises.length
            ? entName(L, p.entreprises[0])
            : t("contrat.entreprise_non_publiee"),
          montant: money(p.montant),
        }),
        m: p.date_a_verifier ? t("repere.date") : "",
        k: "con",
      };
    }
    if (P.suivant)
      suiv = {
        href: contractHref(P.suivant.affaire),
        l: t("contrat.suivant", { mois: longMonth(P.suivant.date) }),
        m: "",
        k: "ao",
      };
    kpis = [
      att.montant != null
        ? { v: money(att.montant), l: t("contrat.kpi_hors_taxes"), m: "" }
        : { v: "—", l: t("contrat.kpi_montant_non_publie"), m: "" },
      dur
        ? {
            v: t("contrat.mois", { n: dur }),
            l: fin ? t("contrat.kpi_fin", { mois: shortMonth(fin.date) }) : t("contrat.kpi_duree"),
            m: "",
          }
        : { v: "—", l: t("contrat.kpi_duree_non_publiee"), m: "" },
      offres != null
        ? { v: fr(offres), l: t("contrat.kpi_offres", { n: offres }), m: "" }
        : { v: "—", l: t("contrat.kpi_offres_non_publiees"), m: "" },
      { v: fr(mods.length), l: t("contrat.kpi_modifications", { n: mods.length }), m: "" },
    ];
    const ents: RichItem = sirens.length
      ? { span: entLinks(sirens), cls: "" }
      : t("contrat.entreprise_non_publiee");
    const court = lib?.court ?? objet(att).toLowerCase();
    lead = rt(att.montant != null ? "contrat.lead_con" : "contrat.lead_con_sans_montant", {
      acheteur: buyerLead,
      entreprises: ents,
      montant: { strong: money(att.montant) },
      duree: dur ? t("contrat.lead_duree", { d: duree(dur) }) : "",
      objet: court ? t("contrat.lead_objet", { o: court }) : "",
    });
    const st = sirens.length ? P.entreprises[sirens[0]] : undefined;
    const sameAmount = lastM.montant === att.montant;
    const sameDur = months(lastM.duree) == null || months(lastM.duree) === months(att.duree);
    qui = [
      line(t("contrat.d_acheteur"), buyerLink),
      line(
        t("contrat.d_entreprise"),
        sirens.length ? entLinks(sirens) : t("contrat.non_publiee"),
        st ? `· ${t("contrat.ent_stats", { n: st.contrats, k: st.collectivites })}` : "",
      ),
      ...communeLigne(),
    ];
    emet = buyer ? lienAcheteur(L, buyer) : "";
    srcs = [...(aoE ? ["avis"] : []), "contrats"];
    dl = [
      line(t("contrat.d_objet"), lier(objet(att))),
      line(t("contrat.d_forme"), formeRich(a)),
      line(t("contrat.d_dispositif"), dispositif(att)),
      line(t("contrat.d_montant"), [
        { strong: money(lastM.montant ?? att.montant) },
        mods.length
          ? sameAmount
            ? t("contrat.inchange_par", { n: mods.length })
            : t("contrat.a_la_signature", { v: money(att.montant) })
          : "",
      ]),
      line(
        t("contrat.d_duree"),
        dur
          ? `${t("contrat.mois", { n: dur })}${
              mods.length && months(att.duree)
                ? sameDur
                  ? t("contrat.inchangee_par", { n: mods.length })
                  : t("contrat.a_la_signature", {
                      v: t("contrat.mois", { n: months(att.duree) ?? 0 }),
                    })
                : ""
            }`
          : t("contrat.non_publiee"),
      ),
      line(t("contrat.d_offres"), offres != null ? fr(offres) : t("format.non_publie")),
    ];
    if (att.hors_totaux || att.national)
      dl.push(
        line(
          t("contrat.d_hors_totaux"),
          t(`commune.hors_${att.national && !att.hors_totaux ? "national" : att.hors_totaux}`),
        ),
      );
    argent = att.montant != null;
    sum = {
      // the panel's kicker and title are text: the place and the company are its rows, as links
      kicker: t("contrat.type_attribution"),
      title: money(att.montant),
      rows: [
        [t("contrat.p_signe"), shortDate(att.date)],
        [t("contrat.p_fin"), fin ? t("contrat.fin_date", { date: shortMonth(fin.date) }) : "—"],
        [t("contrat.p_offres"), offres != null ? fr(offres) : t("format.non_publie")],
        [t("contrat.p_modifications"), fr(mods.length)],
      ],
    };
    titreDoc = t("contrat.doc_contrat", { mois: longMonth(lue(att)) });
  } else if (a.kind === "contrat_non_retrouve" || (e0 && AO.test(e0.t))) {
    kind = "ao";
    const res = evs.filter((e) => e.t === "resultat");
    const avis = evs.filter((e) => e.t === "avis");
    const rect = evs.filter((e) => e.t === "rectificatif");
    const probId = typeof a.contrat_probable === "string" ? a.contrat_probable : "";
    const pe = probId ? eventsOf(probId).find((e) => e.t === "attribution") : undefined;
    for (const e of evs)
      steps.push({
        k: "ao",
        id: e.id,
        type: t(`contrat.type_${e.t}`),
        date: fd(e),
        dm: markD(e),
        what:
          e.t === "resultat"
            ? t("contrat.ao_resultat")
            : e.t === "rectificatif"
              ? t("contrat.ao_rectificatif")
              : communal
                ? t("contrat.ao_mairie")
                : t("contrat.ao_acheteur"),
        lm: "",
        ghost: false,
        ref: reference(e),
        url: e.url ?? "",
        rows: [[t("contrat.p_objet"), objet(e) || lib?.titre || t("format.non_publie")]],
        foot: [t("contrat.source_boamp"), explainDate(e)],
      });
    if (pe) {
      steps.push({
        k: "con",
        id: pe.id,
        type: t("contrat.type_attribution"),
        date: fd(pe),
        dm: markD(pe),
        what: t("contrat.signe_avec", { ents: entNames(pe.entreprises ?? []) }),
        lm: LIEN,
        ghost: false,
        ref: reference(pe),
        url: pe.url ?? "",
        rows: [
          [t("contrat.p_montant"), money(pe.montant)],
          [
            t("contrat.p_regle"),
            String(
              (a.lien_probable as { regle?: string } | undefined)?.regle ??
                t("contrat.regle_defaut"),
            ),
          ],
        ],
        foot: [explainDate(pe), t("contrat.repere_lien")],
        href: { l: t("contrat.fiche_contrat"), href: contractHref(probId) },
        qui: pe.entreprises?.length ? entLinks(pe.entreprises) : undefined,
        whatLien: pe.entreprises?.length
          ? rt("contrat.signe_avec", { ents: { span: entLinks(pe.entreprises), cls: "" } })
          : undefined,
      });
      suiv = { href: contractHref(probId), l: t("contrat.contrat_suivi"), m: LIEN, k: "con" };
    } else
      steps.push({
        k: "fin",
        id: "",
        type: t("contrat.type_attribution"),
        date: P.contrat === "attendu" ? t("contrat.pas_encore_publie") : t("contrat.non_retrouve"),
        dm: "",
        what:
          P.contrat === "attendu" ? t("contrat.aucun_contrat_encore") : t("contrat.aucun_contrat"),
        lm: "",
        ghost: true,
        ref: "",
        url: "",
        rows: [[t("contrat.p_cherche"), t("contrat.cherche")]],
        foot: [t("contrat.peut_etre")],
      });
    const debut = e0 ? lue(e0) : "";
    kpis = [
      { v: e0 ? fd(e0) : "—", l: t("contrat.kpi_publiee"), m: e0 ? markD(e0) : "" },
      res.length
        ? { v: fd(res[0]), l: t("contrat.kpi_resultat"), m: "" }
        : { v: "—", l: t("contrat.kpi_resultat_non_publie"), m: "" },
      pe
        ? { v: shortMonth(lue(pe)), l: t("contrat.kpi_contrat_suivi"), m: LIEN }
        : {
            v: "—",
            l:
              P.contrat === "attendu"
                ? t("contrat.kpi_contrat_attendu")
                : t("contrat.kpi_contrat_non_retrouve"),
            m: "",
          },
      { v: fr(evs.length), l: t("contrat.kpi_avis", { n: evs.length }), m: "" },
    ];
    const court = lib?.court ?? objet(e0).toLowerCase();
    lead = [
      ...rt("contrat.lead_ao", {
        acheteur: buyerLead,
        date: debut ? longDate(debut) : t("format.date_non_publiee"),
        objet: court ? t("contrat.lead_objet", { o: court }) : "",
      }),
      ...(pe
        ? []
        : [
            " ",
            P.contrat === "attendu"
              ? t("contrat.lead_ao_attendu")
              : t("contrat.lead_ao_non_retrouve"),
          ]),
    ];
    const refs = (es: Evenement[]) => es.map((x) => reference(x)).join(", ");
    dl = [
      line(t("contrat.d_objet"), lier(objet(e0) || lib?.titre || "")),
      line(t("contrat.d_avis"), avis.length ? refs(avis) : "—"),
      line(t("contrat.d_resultat"), res.length ? refs(res) : t("format.non_publie")),
      ...(rect.length ? [line(t("contrat.d_rectificatifs"), refs(rect))] : []),
    ];
    emet = buyer ? lienAcheteur(L, buyer) : "";
    srcs = ["avis", ...(pe ? ["contrats"] : [])];
    qui = [
      line(t("contrat.d_acheteur"), buyerLink),
      ...communeLigne(),
      line(
        t("contrat.d_contrat"),
        pe
          ? entLinks(pe.entreprises ?? []).concat(
              pe.entreprises?.length ? [] : [t("contrat.entreprise_non_publiee")],
            )
          : P.contrat === "attendu"
            ? t("contrat.pas_encore_publie")
            : t("contrat.non_retrouve"),
        "",
        pe ? LIEN : "",
      ),
    ];
    sum = {
      kicker: t("contrat.type_avis"),
      title: lib?.titre ?? (objet(e0) || t("format.non_publie")),
      rows: [
        [t("contrat.p_publie"), e0 ? fd(e0) : "—"],
        [t("contrat.p_resultat"), res.length ? fd(res[0]) : t("format.non_publie")],
        [
          t("contrat.p_contrat"),
          pe
            ? entNames(pe.entreprises ?? [])
            : P.contrat === "attendu"
              ? t("contrat.pas_encore_publie")
              : t("contrat.non_retrouve"),
        ],
      ],
    };
    titreDoc = t("contrat.doc_ao", { mois: debut ? longMonth(debut) : "" });
  } else if (a.kind === "subvention" || e0?.t.startsWith("subvention")) {
    kind = "sub";
    const region = e0?.t === "subvention_region";
    const financeur = region
      ? t(e0?.dep === "13" ? "contrat.financeur_sud" : "contrat.financeur_idf")
      : t("contrat.financeur_etat");
    // the beneficiary as the source names it; a name not published stays « nom non publié »
    const benef = benefLabel(e0);
    const named =
      e0.beneficiaire !== "[non retenu]" && e0.nom_publie !== false && !!e0.beneficiaire;
    const commune: RichItem | null = c && insee ? lienCommune(L, insee) : null;
    for (const e of evs)
      steps.push({
        k: "sub",
        id: e.id,
        type: t("contrat.type_subvention"),
        date: fd(e),
        dm: markD(e),
        what: t("contrat.sub_accorde", { qui: financeur, montant: money(e.montant) }),
        lm: "",
        ghost: false,
        ref: reference(e),
        url: e.url ?? "",
        rows: [
          [t("contrat.p_montant"), money(e.montant)],
          [t("contrat.p_cameras"), e.cameras != null ? fr(e.cameras) : t("contrat.non_precise")],
          [t("contrat.p_base"), e.base != null ? money(Number(e.base)) : "—"],
          [
            t("contrat.p_taux"),
            e.taux != null ? t("contrat.pourcent", { n: fr(Number(e.taux)) }) : "—",
          ],
        ],
        foot: [region ? t("contrat.source_region") : t("contrat.source_etat"), explainDate(e)],
      });
    const probId = typeof a.contrat_probable === "string" ? a.contrat_probable : "";
    const pe = probId ? eventsOf(probId).find((e) => e.t === "attribution") : undefined;
    if (pe) {
      steps.push({
        k: "con",
        id: pe.id,
        type: t("contrat.type_attribution"),
        date: fd(pe),
        dm: markD(pe),
        what: t("contrat.sub_finance"),
        lm: LIEN,
        ghost: false,
        ref: reference(pe),
        url: pe.url ?? "",
        rows: [[t("contrat.p_montant"), money(pe.montant)]],
        foot: [explainDate(pe), t("contrat.repere_lien")],
        href: { l: t("contrat.fiche_contrat"), href: contractHref(probId) },
        qui: pe.entreprises?.length ? entLinks(pe.entreprises) : undefined,
      });
      suiv = { href: contractHref(probId), l: t("contrat.contrat_finance"), m: LIEN, k: "con" };
    }
    const tot = evs.reduce((s, e) => s + (e.montant ?? 0), 0);
    const cams = evs.reduce((s, e) => s + (e.cameras ?? 0), 0);
    kpis = [
      { v: money(tot), l: t("contrat.kpi_accordes"), m: "" },
      { v: cams ? fr(cams) : "—", l: t("contrat.kpi_cameras_financees"), m: "" },
      {
        v: e0?.taux != null ? t("contrat.pourcent", { n: fr(Number(e0.taux)) }) : "—",
        l: t("contrat.kpi_taux"),
        m: "",
      },
      { v: fr(evs.length), l: t("contrat.kpi_documents", { n: evs.length }), m: "" },
    ];
    lead = rt(named || !commune ? "contrat.lead_sub" : "contrat.lead_sub_commune", {
      financeur,
      montant: { strong: money(tot) },
      beneficiaire: benef,
      commune: commune ?? "",
      cameras: cams ? t("contrat.lead_cameras", { n: cams }) : "",
    });
    qui = [
      line(t("contrat.d_beneficiaire"), benef),
      ...(commune ? [line(t("contrat.d_commune"), [commune])] : []),
      line(t("contrat.d_financeur"), financeur),
      line(
        t("contrat.d_contrat"),
        pe ? entLinks(pe.entreprises ?? []) : t("contrat.non_designe"),
        "",
        pe ? LIEN : "",
      ),
    ];
    dl = [
      line(t("contrat.d_objet"), lier(objet(e0))),
      line(t("contrat.d_montant"), [{ strong: money(tot) }]),
      line(t("contrat.d_cameras"), cams ? fr(cams) : t("contrat.non_precise")),
    ];
    emet = financeur;
    srcs = [
      region
        ? `subventions_region_${e0.dep === "13" ? "sud" : "idf"}`
        : `subventions_etat_${String(dep ?? "")}`,
      ...(pe ? ["contrats"] : []),
    ];
    sum = {
      kicker: t("contrat.type_subvention"),
      title: money(tot),
      rows: [
        [t("contrat.p_accordee"), e0 ? fd(e0) : "—"],
        [t("contrat.p_cameras"), cams ? fr(cams) : "—"],
        [t("contrat.p_contrat"), pe ? entNames(pe.entreprises ?? []) : t("contrat.non_designe")],
      ],
    };
    titreDoc = t("contrat.doc_sub", { date: e0.date_annee ? fd(e0) : longMonth(lue(e0)) });
  } else {
    // a decree the register cannot place in a commune: what the préfecture authorises
    kind = "aut";
    arretes = true;
    for (const e of evs) {
      const why = (e.non_lu ?? []).map((x) => t(`non_lu.${x}`));
      steps.push({
        k: "aut",
        id: e.id,
        type: t("contrat.type_arrete"),
        date: fd(e),
        dm: markD(e),
        what: titre(e),
        lm: "",
        ghost: false,
        ref: reference(e),
        url: e.url ?? "",
        rows: [
          [t("contrat.p_beneficiaire"), benefLabel(e)],
          [
            e.t === "arrete_drone" ? t("contrat.p_appareils") : t("contrat.p_cameras"),
            e.cameras != null ? fr(e.cameras) : t("contrat.non_precise"),
          ],
          [t("contrat.p_periode"), e.periode ? String(e.periode) : t("contrat.non_precisee")],
          ...(why.length ? ([[t("contrat.p_non_lu"), why.join(" · ")]] as [string, string][]) : []),
        ],
        foot: [emetteur(e), explainDate(e)],
      });
    }
    const why = (e0?.non_lu ?? []).map((x) => t(`non_lu.${x}`));
    kpis = [
      {
        v: e0?.cameras != null ? fr(e0.cameras) : "—",
        l: e0?.t === "arrete_drone" ? t("contrat.kpi_appareils") : t("contrat.kpi_cameras"),
        m: "",
      },
      { v: e0 ? fd(e0) : "—", l: t("contrat.kpi_date_arrete"), m: e0 ? markD(e0) : "" },
      e0?.periode
        ? { v: t("contrat.oui"), l: t("contrat.kpi_periode"), m: "" }
        : { v: "—", l: t("contrat.kpi_periode_non"), m: "" },
      { v: fr(evs.length), l: t("contrat.kpi_arretes", { n: evs.length }), m: "" },
    ];
    lead = [
      ...rt("contrat.lead_aut", {
        quoi: e0 ? titre(e0) : "",
        beneficiaire: e0 ? benefLabel(e0) : "",
        emetteur: e0 ? { span: lierDepartement(emetteur(e0), depCode), cls: "" } : "",
      }),
      ...(why.length ? [" ", t("contrat.lead_non_lu", { raisons: why.join(", ") })] : []),
    ];
    qui = [
      line(t("contrat.d_beneficiaire"), e0 ? benefLabel(e0) : "—"),
      line(t("contrat.d_publie_par"), e0 ? lierDepartement(emetteur(e0), depCode) : "—"),
      line(
        t("contrat.d_departement"),
        typeof dep === "string" && dep && depName
          ? [lienDepartement(dep, depName)]
          : t("format.non_publie"),
      ),
    ];
    emet = e0 ? { span: lierDepartement(emetteur(e0), depCode), cls: "" } : "";
    srcs = typeof dep === "string" && dep ? [`arretes_${dep}`] : [];
    dl = [
      line(t("contrat.d_periode"), e0?.periode ? String(e0.periode) : t("contrat.non_precisee")),
      line(t("contrat.d_lieu"), e0?.objet ? tidy(e0.objet) : t("contrat.non_precise")),
      ...(why.length ? [line(t("contrat.d_non_lu"), why.join(" · "))] : []),
    ];
    sum = {
      kicker: t("contrat.type_arrete"),
      title: e0 ? titre(e0) : "",
      rows: [
        [t("contrat.p_date"), e0 ? fd(e0) : "—"],
        [t("contrat.p_beneficiaire"), e0 ? benefLabel(e0) : "—"],
        ...(why.length ? ([[t("contrat.p_non_lu"), why.join(" · ")]] as [string, string][]) : []),
      ],
    };
    titreDoc = t("contrat.doc_aut", { date: e0 ? shortDate(e0.date) : "" });
  }

  // the corrections accepted in /revue: when, what the page reads now, the source's value struck
  const noms = {
    entreprise: (siren: string) => entName(L, siren),
    commune: (k: string) => f.communes[k]?.nom ?? k,
  };
  for (const e of [main, ...f.evenements.filter((x) => x !== main)])
    if (e)
      for (const c of corrections(e, noms))
        dl.push({
          k: c.k,
          v: e === main ? c.v : [`${reference(e)} · `, ...(c.v as RichItem[])],
          note: "",
          m: "",
        });

  // what the page's marks mean, said once in the panel at rest
  const marks = [
    ...steps.flatMap((s) => [s.dm, s.lm]),
    ...kpis.map((k) => k.m),
    ...dl.map((x) => x.m),
    ...qui.map((x) => x.m),
    prec?.m ?? "",
    suiv?.m ?? "",
    markD(main),
  ];
  const reperes = [
    ...(marks.includes(t("repere.date")) ? [t("contrat.repere_date_seul")] : []),
    ...(marks.includes(LIEN) ? [t("contrat.repere_lien")] : []),
  ];
  const head =
    kind === "aut"
      ? e0
        ? titre(e0)
        : t("contrat.document")
      : (lib?.titre ??
        (objet(main) ||
          (kind === "sub" && c ? t("contrat.titre_sub", { nom: c.nom }) : t("format.non_publie"))));
  const mainRef = reference(main);
  return {
    kind,
    type: TYPE_ETAPE[kind],
    titre: head,
    titreDoc,
    badge: { l: t(`contrat.badge_${kind}`), s: BADGE[kind === "aut" ? "aut" : kind] },
    sous:
      kind === "con"
        ? {
            a: t("contrat.sous_signe", { date: fd(main) }),
            m: markD(main),
            b: mainRef ? ` · ${mainRef}` : "",
          }
        : {
            a: main ? fd(main) : "",
            m: main ? markD(main) : "",
            b: mainRef ? ` · ${mainRef}` : "",
          },
    lead,
    kpis,
    steps,
    prec,
    suiv,
    parTitre: t(`contrat.par_titre_${kind}`),
    ditTitre: t(`contrat.dit_titre_${kind}`),
    ditNote: t(`contrat.dit_note_${kind}`),
    dl,
    qui,
    docs: docs ?? steps.filter((s) => s.k !== "fin"),
    emetteur: emet,
    sources: srcs,
    dep: depCode,
    ou:
      c && insee
        ? line(t("contrat.d_commune"), [lienCommune(L, insee)])
        : typeof dep === "string" && dep && depName
          ? line(t("contrat.d_departement"), [lienDepartement(dep, depName)])
          : null,
    argent,
    arretes,
    sum,
    reperes,
    main,
    ref: mainRef,
    source: kind === "aut" ? (e0?.url ?? "") : "",
  };

  function formeTxt(x: Affaire): string {
    const tech = typeof x.techniques === "string" ? x.techniques : "";
    return tech && tech !== "Sans objet" ? tidy(tech) : t("contrat.non_publiee");
  }
  function formeRich(x: Affaire): Rich {
    const tech = formeTxt(x);
    if (tech === t("contrat.non_publiee")) return tech;
    return /accord-cadre/i.test(tech)
      ? [{ a: { href: "/registre/glossaire#g-accord-cadre", text: capital(tech) } }]
      : capital(tech);
  }
  function dispositif(e: Evenement): string {
    const k = typ(e) === "?" ? "na" : disp(e);
    return has(`registre.registre.disp_${k}`) ? t(`registre.disp_${k}`) : t("format.non_publie");
  }
}

/** A step's badge style: the kit's badges, the planned end's dashed one. */
export const stepStyle = (k: Step["k"]): string => STYLE[k];

/** A step's type (types.ts): each document its own; the planned end is none, it is computed. */
export const TYPE_ETAPE: Record<Exclude<Step["k"], "fin">, TypeCle> = {
  ao: "ao",
  con: "con",
  mod: "mod",
  aut: "aut",
  sub: "sub",
};

/** A link to another record, of its type (liens.ts). */
export const lienFiche = (x: Lien): RichItem => lien(x.k, x.href, x.l);

/** The document an address names (`?doc=<id>`), among the dossier's; null for none or another. */
export const docMontre = (F: Fiche, id: string | null): Step | null =>
  (id && F.docs.find((d) => d.id === id && !d.href)) || null;
