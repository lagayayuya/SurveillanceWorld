// A document's record (/registre/<contrat|avis|subvention|arrete>/<affaire>[?doc=<id>]; board
// Contrat-Lyon-2026-A of the redesign v3, lot 3, its phone and dark variants): the sticker of its
// type, its objet, the buyer's and the holder's chips, its signature and reference, a sentence of
// its figures; the four figures (the ceiling or the amount, the duration and the one the call for
// tenders announced, the competition, the modifications); the yellow table of contents; then
// 1 · Qui achète quoi, et combien ?, 2 · Le parcours du contrat (its documents at equal intervals,
// the real gap written between two, the execution at the build's day), 3 · Avant, après (the
// previous contract, the next call for tenders), « Les documents », « D'où viennent ces
// chiffres ». A section with nothing to say is left out, the others numbered in turn. The board
// draws a contract; a call for tenders, a subsidy, a decree keep the same grammar on the model's
// own lines (contrat-outils.ts). Signals and the « lien à vérifier » decree come later: absent.
// A decree that has its commune opens there, in the commune's Autorisations (donnees() decides
// before anything is drawn); an affaire the register does not hold: Absent.

import { communeHref } from "../commun.ts";
import {
  buyerHref,
  depNom,
  disp as dispositifDe,
  entHref,
  entName,
  type Lexique,
} from "../corpus.ts";
import type { Handler, Rich, RichItem } from "../dc.ts";
import { Absent, type Couverture, EI, type Evenement, load } from "../donnees.ts";
import { fr, longDate, longMonth, shortDate } from "../format.ts";
import { has, t } from "../i18n.ts";
import { etapeListe } from "../listes.ts";
import type { Miette, VueModule } from "../modale.ts";
import { partager } from "../partage.ts";
import { documentHref, type Route } from "../routes.ts";
import { HASH, ouvrir, signalerHref } from "../signaler.ts";
import { montantA, repli } from "../socle-a.ts";
import { couverture, sources } from "../sources.ts";
import type { TypeCle } from "../types.ts";
import { type BaseState, type Partage, partageDe, Vue } from "../vue.ts";
import { casseNormale, nomAcheteur } from "./accueil-outils.ts";
import {
  acheteurStats,
  aVerifier,
  avancement,
  avant,
  avecAujourdhui,
  type Cpv,
  cpvDe,
  documents,
  dureeAnnoncee,
  type Ecart,
  type Etape,
  etapes,
  evenementsDe,
  type FichierAcheteur,
  hote,
  jours,
  type LotsAvis,
  lotsAvis,
  mixte,
  modifs,
  type Nature,
  naturesDe,
  offres,
  procedure,
  refCourte,
} from "./contrat-a.ts";
import {
  docMontre,
  type Fiche,
  type Fichier,
  fiche,
  ouvreAilleurs,
  rt,
  TYPE_ETAPE,
} from "./contrat-outils.ts";
import "./contrat-a.css";
import template from "./contrat.html?raw";

type Props = Extract<Route, { view: "contrat" }> & {
  F: Fiche;
  f: Fichier;
  couverture?: Couverture;
};
/** The holder's file, the part this page reads (entreprise/<siren>.json `stats`). */
type FichierEntreprise = { stats?: { n?: number; clientes?: string[]; montant?: number } };
type State = BaseState & {
  A: FichierAcheteur | null;
  E: FichierEntreprise | null;
  cite: boolean;
  /** the phone's « ⋯ »: the actions it hides, shown */
  plus: boolean;
  /** « Les documents » whole (more than twelve: ten shown first) */
  tous: boolean;
};

/** The document `?doc=` names, read from the address (the router passes the path only). */
const docDemande = (): string | null =>
  typeof location === "undefined" ? null : new URLSearchParams(location.search).get("doc");

/** An amount as the board writes it: « 20 M€ », « 31,7 M€ » (one decimal, none when whole),
 * « 1,8 Md€ »; under a million in whole euros. */
function somme(n: number | null | undefined): string {
  if (n == null) return t("format.non_publie");
  const d = (x: number) => {
    const r = Math.round(x * 10) / 10;
    return (Number.isInteger(r) ? String(r) : r.toFixed(1)).replace(".", ",");
  };
  if (n >= 1e9) return t("socle_a.mde", { n: d(n / 1e9) });
  if (n >= 1e6) return t("socle_a.me", { n: d(n / 1e6) });
  return montantA(n);
}
const months = (v: unknown): number | null => {
  const n = Math.round(Number(v));
  return v != null && v !== "" && Number.isFinite(n) && n > 0 ? n : null;
};
/** « 48 mois », « 2 ans ». */
const duree = (m: number): string =>
  m % 12 === 0 ? t("contrat_a.ecart.ans", { n: m / 12 }) : t("contrat_a.ecart.mois", { n: m });
const ecartTxt = (e: Ecart): string =>
  e.n === 0 && e.u === "jours"
    ? t("contrat_a.ecart.meme_jour")
    : t(`contrat_a.ecart.${e.u}`, { n: e.n });
/** A step's or a row's date: a document dated by its year only (a grant) shows the year, never
 * the build's 31 December. */
const jourDe = (s: Etape): string => (s.e?.date_annee ? s.date.slice(0, 4) : shortDate(s.date));
const premiereMinuscule = (s: string): string =>
  s && /^[A-ZÀ-ÖØ-Þ][a-zà-öø-ÿ]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s;
/** The natures in words, in a line (« Fourniture et installation, maintenance »). */
const natTxt = (ns: Nature[]): string => {
  const x = ns.map((k) => t(`contrat_a.nature.${k}`)).join(", ");
  return x.charAt(0).toUpperCase() + x.slice(1);
};
/** The notices of a call for tenders. */
const AO_T = /^(avis|resultat|rectificatif)$/;
/** The longest objet the lead sentences quote whole (recette 32: Lyon 2026's 137 characters were
 * cut at 118 in the middle of « dispositifs… »); longer, it is cut after a word. */
const OBJET_MAX = 240;
/** What a notice's lots share, in sentences for a step's bubble: how many, the duration and the
 * renewals announced, the price's weight in the award. */
const lotsTip = (L: LotsAvis | null, dureeDejaDite: boolean): string[] =>
  L
    ? [
        ...(L.n > 1 ? [t("contrat_a.tip.lots", { n: L.n })] : []),
        ...(L.duree && !dureeDejaDite
          ? [t("contrat_a.tip.duree_annoncee", { d: duree(L.duree) })]
          : []),
        ...(L.reconductions === 0
          ? [t("contrat_a.tip.sans_reconduction")]
          : L.reconductions
            ? [t("contrat_a.tip.reconductible", { n: L.reconductions })]
            : []),
        ...(L.prix != null ? [t("contrat_a.tip.prix", { p: fr(L.prix) })] : []),
      ]
    : [];

class Contrat extends Vue<Props, State> {
  private fini = false;

  protected init(props: Props): Partial<State> {
    const d = docMontre(props.F, docDemande());
    return { A: null, E: null, cite: false, plus: false, tous: false, sel: d ? d.id : null };
  }

  /** The document's name is its objet, cut for a tab. */
  titre(): string {
    const n = this.nom();
    return n.length > 70 ? `${n.slice(0, 68).replace(/\s+\S*$/, "")}…` : n;
  }
  /** The objet whole (the model's `titre` cuts it at 120 characters): the libellé the build
   * wrote, else the main document's objet; a decree's title as the model writes it. */
  private nom(): string {
    const F = this.props.F;
    const f = this.props.f;
    const objet =
      F.kind === "aut"
        ? ""
        : String(f.libelles[f.affaire.id]?.titre ?? F.main.objet ?? f.affaire.titre ?? "");
    return casseNormale(objet || F.titre || F.titreDoc);
  }
  /** The breadcrumb's last step: the objet's first words and the year (« Fourniture, installation
   * et maintenance, 2026 »). */
  etape(): string {
    const n = this.nom();
    const court =
      n.length > 44
        ? n
            .slice(0, 44)
            .replace(/\s+\S*$/, "")
            .replace(/[\s,;:–-]+(de|des|du|d'|et|la|le|les|pour|à)?$/i, "")
        : n;
    const an = (this.props.F.main.date ?? "").slice(0, 4);
    return an ? t("contrat_a.etape", { t: court, an }) : court;
  }

  type(): TypeCle {
    const d = docMontre(this.props.F, docDemande());
    return d && d.k !== "fin" ? TYPE_ETAPE[d.k] : this.props.F.type;
  }
  /** Registre › its commune › its kind in the commune's documents (the board's « Registre › Lyon ›
   * Contrats »); without a commune, its type's list in its département. Opened from a fiche, the
   * frame puts it under that fiche instead (modale.ts filParent). */
  fil(): Miette[] {
    const F = this.props.F;
    const f = this.props.f;
    const insee = [f.affaire.insee, F.main.insee].find(
      (k): k is string => !!k && !!f.communes[k]?.ref,
    );
    const reg: Miette = { k: "registre", l: t("types.registre.l"), href: "/registre/" };
    if (!insee) return [reg, etapeListe(F.type, this.props.id, { dep: F.dep })];
    return [
      reg,
      { k: "commune", l: f.communes[insee].nom, href: communeHref(insee) },
      {
        k: F.type,
        l: t(`contrat_a.fil.${F.kind}`),
        href: `${communeHref(insee, "documents")}?t=${F.kind}`,
      },
    ];
  }

  partage(): Partage | null {
    return partageDe(this.titre(), this.props.F.partage);
  }

  componentDidMount(): void {
    // opened at its form's address: the form over the record, on the document `doc` names
    if (location.hash === HASH) ouvrir(docDemande() || this.props.F.main.id, this.props.id);
    // the buyer's and the holder's files (their contracts, the previous lots), once drawn
    const f = this.props.f;
    const siren = this.acheteur();
    if (siren && f.acheteurs[siren]?.ref)
      load<FichierAcheteur>(`acheteur/${siren}.json`).then(
        (A) => !this.fini && this.setState({ A }),
        () => {},
      );
    const s0 = (this.props.F.main.entreprises ?? [])[0];
    if (s0 && s0 !== EI && f.entreprises[s0]?.ref && !f.entreprises[s0]?.entrepreneur_individuel)
      load<FichierEntreprise>(`entreprise/${s0}.json`).then(
        (E) => !this.fini && this.setState({ E }),
        () => {},
      );
  }
  componentWillUnmount(): void {
    this.fini = true;
  }

  private acheteur(): string | null {
    const f = this.props.f;
    return (
      (f.affaire.acheteur_siren as string | undefined) ?? this.props.F.main.acheteur_siren ?? null
    );
  }

  private basculer = (k: string): void =>
    this.setState({ open: { ...this.state.open, [k]: !this.state.open[k] } });

  /** « Citer »: the document's citation, copied. */
  private citer: Handler = () => {
    const F = this.props.F;
    const txt = t("contrat.citation", {
      ref: refCourte(F.ref) || F.titre,
      date: shortDate(F.main.date),
      adresse: `${location.origin}${location.pathname}`,
    });
    void navigator.clipboard?.writeText(txt).then(() => {
      this.setState({ cite: true });
      setTimeout(() => {
        if (!this.fini) this.setState({ cite: false });
      }, 2000);
    });
  };

  /** A section's anchor followed in the frame's scroll, smoothly unless motion is reduced. */
  private allerSection: Handler = (ev) => {
    const href = (ev.currentTarget as HTMLAnchorElement).getAttribute("href") ?? "";
    if (!href.startsWith("#")) return;
    const el = document.getElementById(href.slice(1));
    if (!el) return;
    ev.preventDefault();
    const doux = !matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: doux ? "smooth" : "auto", block: "start" });
  };

  /** What a modification changes, in words: the amount or the duration it brings the contract to. */
  private changeTxt(m: number | null, d: number | null, att: Evenement | null): string {
    const parts = [
      ...(m != null && m !== att?.montant ? [t("contrat_a.change_montant", { m: somme(m) })] : []),
      ...(d != null && d !== months(att?.duree)
        ? [t("contrat_a.change_duree", { d: duree(d) })]
        : []),
    ];
    return parts.length ? parts.join(", ") : t("contrat_a.change_autre");
  }

  /** What one modification says it changes: the build's own words (« montant 60 000 000 →
   * 60 043 354 € », « titulaires »), else the amount or duration it brings, else nothing. */
  private modifTxt(e: Evenement, att: Evenement | null): string {
    const ch = (e.changements as string[] | undefined) ?? [];
    if (ch.length)
      return ch.map((x) => (x === "titulaires" ? t("contrat_a.change_titulaires") : x)).join(" ; ");
    const one = modifs([e], att);
    return one.muettes ? t("contrat_a.fig.rien") : this.changeTxt(one.montant, one.duree, att);
  }

  renderVals() {
    const S = this.state;
    const F = this.props.F;
    const f = this.props.f;
    const L = f as unknown as Lexique;
    const P = f.parcours;
    const con = F.kind === "con";
    const att = con ? F.main : null;
    const evs = evenementsDe(f, f.affaire.id);
    const maj = this.props.couverture?.maj ?? "";

    // --- who ------------------------------------------------------------------------------------
    const siren = this.acheteur();
    const ach = siren ? f.acheteurs[siren] : undefined;
    const communal = ach?.categorie === "commune" && !!ach.insee_siege;
    const ville = communal ? (f.communes[ach?.insee_siege ?? ""]?.nom ?? "") : "";
    const achNom = siren
      ? ville
        ? t("contrat_a.ville_de", { nom: ville })
        : nomAcheteur(ach, L, depNom, String(F.main.acheteur ?? ""))
      : "";
    const achHref = siren ? buyerHref(L, siren) : null;
    const achLien = (text = achNom): RichItem =>
      achHref ? { a: { href: achHref, text, cls: communal ? "ent com" : "ent ach" } } : text;
    const sirens = (att?.entreprises ?? []).filter(Boolean);
    const entHrefDe = (s: string) =>
      s !== EI && f.entreprises[s]?.ref && !f.entreprises[s]?.entrepreneur_individuel
        ? entHref(s)
        : null;
    const entLien = (s: string): RichItem => {
      const h = entHrefDe(s);
      return h ? { a: { href: h, text: entName(L, s), cls: "ent" } } : entName(L, s);
    };
    const entLiens = (ss: string[]): RichItem[] =>
      ss.flatMap((s, i) => [...(i ? [", "] : []), entLien(s)]);
    const entNoms = (ss: string[]) => ss.map((s) => entName(L, s)).join(", ");
    const quiAch = communal ? t("contrat_a.qui_ville") : t("contrat_a.qui_acheteur");

    // --- the contract's facts -------------------------------------------------------------------
    const ac = /accord-cadre/i.test(String(f.affaire.techniques ?? ""));
    // an amount of 0 is one not published (format.ts money)
    const montant = att?.montant ? att.montant : null;
    const dur = months(att?.duree);
    const annonce = dureeAnnoncee(evs);
    const off = offres(evs, att);
    const proc = procedure(evs);
    const mx = mixte(att);
    const av = aVerifier(evs);
    const M = modifs(evs, att);
    // what is bought: the natures the build reads, the CPV codes the documents publish
    const nat = naturesDe(F.main, evs);
    const cpv = cpvDe(evs, att);
    // a call for tenders' lots: the last notice that publishes them (the result adds the criteria)
    const lotsAo = lotsAvis([...evs].reverse().find((e) => AO_T.test(e.t) && lotsAvis(e)));
    // the modifications in a line: the amount or duration they bring, else how many publish a change
    const resumeModifs = (): string => {
      const fin2 = this.changeTxt(M.montant, M.duree, att);
      if (fin2 !== t("contrat_a.change_autre")) return fin2;
      const n2 = evs.filter(
        (e) => e.t === "modification" && ((e.changements as string[] | undefined) ?? []).length,
      ).length;
      return n2 ? t("contrat_a.fig.changes_n", { n: n2 }) : fin2;
    };
    const fin = P.fin_prevue;
    const avc = con && fin ? avancement(fin.signature, fin.mois, maj) : null;
    const signe = att?.date ?? "";
    // an eForms code (« neg-w-call ») as a catalogue key (« neg_w_call »)
    const cle = (c: string) => c.replace(/[^a-z]/gi, "_");
    const procLong = (c: string) =>
      has(`registre.contrat_a.procedure.${cle(c)}`)
        ? t(`contrat_a.procedure.${cle(c)}`)
        : t("liste.non_lu");
    const procCourt = (c: string) =>
      has(`registre.contrat_a.pc.${cle(c)}`) ? t(`contrat_a.pc.${cle(c)}`) : "";
    const titulaires =
      sirens.length === 1
        ? t("contrat_a.fig.titulaires_un")
        : sirens.length > 1
          ? t("contrat_a.fig.titulaires_n", { n: sirens.length })
          : "";

    // --- the sections, numbered in turn ---------------------------------------------------------
    let n = 0;
    const toc: { href: string; l: string; go: Handler }[] = [];
    const entree = (id: string, l: string): string => {
      const k = String(++n);
      toc.push({ href: `#${id}`, l: t("contrat_a.toc_n", { n: k, l }), go: this.allerSection });
      return k;
    };

    // 1 · who buys what, and how much
    // the objet in a sentence: the build's short libellé, else the objet cut at a word near 120
    const objetCourt = casseNormale(
      String(f.libelles[f.affaire.id]?.court ?? F.main.objet ?? f.affaire.titre ?? ""),
    ).replace(
      new RegExp(`^(.{${OBJET_MAX}}).+$`, "s"),
      (_m, d: string) => `${d.replace(/\s+\S*$/, "")}…`,
    );
    // the sentence's full stop, unless the objet ends cut (« … »)
    const point = objetCourt.endsWith("…") ? "" : ".";
    const n1 = entree("combien", t("contrat_a.toc.combien"));
    const dlObjet = F.dl.find((x) => x.k === t("contrat.d_objet"));
    const lieu = evs.find(
      (e) => typeof e.lieu_insee === "string" && !!f.communes[e.lieu_insee as string],
    );
    const lieuK = lieu ? (lieu.lieu_insee as string) : "";
    const avantC = con ? avant(P, S.A) : null;
    const memeTit = !!avantC && avantC.entreprises.some((s) => sirens.includes(s));
    const AS = acheteurStats(S.A);
    const ES = S.E?.stats;
    const pst = sirens.length ? P.entreprises[sirens[0]] : undefined;
    const s1 = {
      n: n1,
      titre: t(`contrat_a.s_combien_${F.kind}`),
      ans: con
        ? [
            ...rt(
              montant == null
                ? "contrat_a.ans_sans"
                : ac
                  ? "contrat_a.ans_ac"
                  : "contrat_a.ans_con",
              {
                qui: communal
                  ? t("contrat_a.qui_ville_maj")
                  : siren
                    ? achLien()
                    : t("contrat_a.qui_acheteur_maj"),
                objet: { strong: premiereMinuscule(objetCourt) || t("format.non_publie") },
                montant: somme(montant),
                point,
              },
            ),
            ...(sirens.length === 1
              ? [
                  " ",
                  ...rt("contrat_a.ans_seul", {
                    ent: { span: [entLien(sirens[0])], cls: "" },
                    seul: { strong: t("contrat_a.seul_titulaire") },
                  }),
                ]
              : sirens.length > 1
                ? [
                    " ",
                    ...rt("contrat_a.ans_n", {
                      n: sirens.length,
                      ents: { span: entLiens(sirens), cls: "" },
                    }),
                  ]
                : []),
          ]
        : null,
      con,
      parties: con
        ? {
            r: repli(S.open, "parties", t("contrat_a.parties"), 0, this.basculer),
            ach: siren ? [achLien()] : [t("format.non_publie")],
            achPs: AS
              ? [
                  AS.depuis
                    ? t("contrat_a.ach_ps", { n: AS.n, y: AS.depuis })
                    : t("contrat_a.ach_ps_sans", { n: AS.n }),
                  ...(AS.montant > 0 ? [somme(AS.montant)] : []),
                ].join(" · ")
              : "",
            fleche: montant != null ? t("contrat_a.fleche", { m: somme(montant) }) : "→",
            titK: sirens.length > 1 ? t("contrat_a.titulaires") : t("contrat_a.titulaire"),
            tit: sirens.length ? entLiens(sirens) : [t("contrat.entreprise_non_publiee")],
            titPs: pst
              ? [
                  t("contrat_a.tit_ps", { n: pst.contrats, k: pst.collectivites }),
                  ...(ES?.montant ? [somme(ES.montant)] : []),
                ].join(" · ")
              : "",
            note:
              avantC && memeTit
                ? rt("contrat_a.note_avant", {
                    ent: {
                      span: entLiens(sirens.filter((s) => avantC.entreprises.includes(s))),
                      cls: "",
                    },
                    lots: avantC.lots,
                    qui: quiAch,
                    an: avantC.annee,
                    m: somme(avantC.montant),
                    n: String(Number(n1) + (etapes(f).length > 1 ? 2 : 1)),
                  })
                : null,
          }
        : null,
      quoi: con
        ? {
            r: repli(S.open, "quoi", t("contrat_a.quoi"), 0, this.basculer),
            rows: [
              // without a code: the objet and the register's own classification, as before
              ...(cpv.length
                ? []
                : [
                    {
                      b: (dlObjet ? dlObjet.v : objetCourt) as Rich,
                      s: t("contrat_a.quoi_objet"),
                    },
                  ]),
              ...(nat.length ? [{ b: natTxt(nat) as Rich, s: t("contrat_a.quoi_nature") }] : []),
              ...(!cpv.length &&
              att?.dispositif &&
              has(`registre.registre.disp_${dispositifDe(att)}`)
                ? [
                    {
                      b: t(`registre.disp_${dispositifDe(att)}`) as Rich,
                      s: t("contrat_a.quoi_disp"),
                    },
                  ]
                : []),
              // recette 32: the build serves the codes, not their labels — the contract's codes in
              // one row and the notices' in another, « libellés non lus » said once each, not
              // once per code (Lyon 2026: five rows « code CPV, libellé non lu »)
              ...([true, false] as const).flatMap((duContrat) => {
                const cs = cpv.filter((c: Cpv) => c.contrat === duContrat);
                return cs.length
                  ? [
                      {
                        b: cs.map((c) => c.code).join(", ") as Rich,
                        s: t(duContrat ? "contrat_a.quoi_cpvs_contrat" : "contrat_a.quoi_cpvs", {
                          n: cs.length,
                        }),
                      },
                    ]
                  : [];
              }),
              ...(lieu
                ? [
                    {
                      b: (f.communes[lieuK]?.ref
                        ? [
                            {
                              a: {
                                href: communeHref(lieuK),
                                text: f.communes[lieuK].nom,
                                cls: "ent com",
                              },
                            },
                          ]
                        : f.communes[lieuK].nom) as Rich,
                      s: t("contrat_a.quoi_lieu", { ref: refCourte(String(lieu.ref ?? "")) }),
                    },
                  ]
                : []),
            ],
            note: [
              t(cpv.length ? "contrat_a.quoi_note_cpv" : "contrat_a.quoi_note_sans_cpv"),
              ...(nat.length ? [t("contrat_a.quoi_note_nature")] : []),
              t("contrat_a.quoi_note_cahier"),
            ].join(" "),
          }
        : null,
      how: {
        r: repli(
          S.open,
          "how",
          con ? t("contrat_a.how") : t("contrat_a.dit_k"),
          0,
          this.basculer,
          "card how",
        ),
        titre: con ? t("contrat_a.how") : t("contrat_a.dit_k"),
        kv: con
          ? [
              {
                k: t("contrat_a.kv.forme"),
                v: (ac
                  ? t(communal ? "contrat_a.forme_ac_ville" : "contrat_a.forme_ac")
                  : (F.dl.find((x) => x.k === t("contrat.d_forme"))?.v ??
                    t("contrat.non_publiee"))) as Rich,
              },
              // the form of the orders and the conditions: not served yet (A, 08/11), one « non
              // lu » per case
              ...(ac ? [{ k: t("contrat_a.kv.commandes"), v: t("liste.non_lu") as Rich }] : []),
              {
                k: t("contrat_a.kv.procedure"),
                v: (proc
                  ? `${procLong(proc.code)}${proc.ref ? t("contrat_a.selon", { ref: refCourte(proc.ref) }) : ""}`
                  : t("liste.non_lu")) as Rich,
              },
              {
                k: t("contrat_a.kv.titulaires"),
                v: (sirens.length === 1
                  ? rt("contrat_a.tit_un", { ent: { span: [entLien(sirens[0])], cls: "" } })
                  : sirens.length > 1
                    ? rt("contrat_a.tit_n", {
                        n: sirens.length,
                        ents: { span: entLiens(sirens), cls: "" },
                      })
                    : t("contrat_a.tit_aucun")) as Rich,
              },
              { k: t("contrat_a.kv.conditions"), v: t("contrat_a.conditions_nl") as Rich },
              {
                k: t("contrat_a.kv.totaux"),
                v: (av
                  ? t("contrat_a.totaux_a_verifier", { de: somme(av.de), a: somme(av.a) })
                  : mx
                    ? t(
                        mx.horsTotaux ? "contrat_a.totaux_mixte" : "contrat_a.totaux_mixte_compte",
                        { famille: t(`contrat_a.mixte.${mx.famille}`) },
                      )
                    : att?.compte === false &&
                        att.hors_totaux &&
                        has(`registre.commune.hors_${att.hors_totaux}`)
                      ? t("contrat_a.totaux_hors", { raison: t(`commune.hors_${att.hors_totaux}`) })
                      : att?.compte === false
                        ? t("contrat_a.totaux_non")
                        : t("contrat_a.totaux_compte")) as Rich,
              },
            ]
          : [
              ...[...F.dl, ...F.qui].map((x) => ({ k: x.k, v: x.v })),
              // a call for tenders: what it buys and its lots, on the same rows' grammar
              ...(F.kind === "ao" && nat.length
                ? [{ k: t("contrat_a.kv.nature"), v: natTxt(nat) as Rich }]
                : []),
              ...(F.kind === "ao" && cpv.length
                ? [
                    {
                      k: t("contrat_a.kv.cpv"),
                      v: t("contrat_a.cpv_liste", {
                        codes: cpv.map((c) => c.code).join(", "),
                        n: cpv.length,
                      }) as Rich,
                    },
                  ]
                : []),
              ...(F.kind === "ao" && lotsAo
                ? [
                    {
                      k: t("contrat_a.kv.lots"),
                      v: [t("contrat_a.lots_n", { n: lotsAo.n }), ...lotsTip(lotsAo, false)].join(
                        " ",
                      ) as Rich,
                    },
                  ]
                : []),
            ],
      },
    };

    // 2 · the parcours
    const E = etapes(f);
    const plafondMot = ac ? t("contrat_a.plafond") : "";
    const etapeTxt = (s: Etape) => {
      const e = s.e;
      // today (the build's day): where the execution stands, when it runs
      if (s.k === "auj")
        return {
          b:
            avc?.etat === "cours"
              ? t("contrat_a.b.auj_cours", { n: avc.ecoules, total: avc.total })
              : t("contrat_a.b.auj"),
          ss: t("contrat_a.ss.auj"),
          bl: t("contrat_a.tip.auj"),
        };
      const groupe = s.k === "modif" && !!s.jusqu;
      const b = groupe
        ? t("contrat_a.b.modifs", { n: s.n })
        : t(`contrat_a.b.${s.k}${s.probable ? "_probable" : ""}`, { n: s.n });
      let ss = "";
      let bl = "";
      if (s.k === "avis") {
        const dm = months(e?.duree_mois);
        ss = [refCourte(s.ref), dm ? t("contrat_a.ss.duree_annoncee", { d: duree(dm) }) : ""]
          .filter(Boolean)
          .join(" · ");
        const pc = typeof e?.procedure === "string" ? procLong(e.procedure) : "";
        const la = lotsAvis(e);
        if (la && la.n > 1) ss = [ss, t("contrat_a.lots", { n: la.n })].filter(Boolean).join(" · ");
        bl = [
          pc,
          dm ? t("contrat_a.tip.duree_annoncee", { d: duree(dm) }) : "",
          ...lotsTip(la, !!dm),
          // the deadline for offers: not served yet (A, 08/11)
          t("contrat_a.tip.date_limite_nl"),
        ]
          .filter(Boolean)
          .join(" ");
      } else if (s.k === "rect") {
        ss = refCourte(s.ref);
      } else if (s.k === "contrat") {
        const ents = e?.entreprises?.length
          ? entNoms(e.entreprises)
          : t("contrat.entreprise_non_publiee");
        ss = [
          ents,
          e?.montant != null ? `${somme(e.montant)}${plafondMot ? ` ${plafondMot}` : ""}` : "",
          months(e?.duree) ? t("contrat_a.ecart.mois", { n: months(e?.duree) ?? 0 }) : "",
        ]
          .filter(Boolean)
          .join(" · ");
        bl = t("contrat_a.tip.contrat");
      } else if (s.k === "modif") {
        if (groupe) {
          ss = `${shortDate(s.date)} → ${shortDate(s.jusqu)}`;
          bl = M.muettes ? t("contrat_a.tip.modif_muette") : resumeModifs();
        } else {
          const one = modifs([e as Evenement], att);
          ss = this.modifTxt(e as Evenement, att);
          bl = one.muettes ? t("contrat_a.tip.modif_muette") : ss;
        }
      } else if (s.k === "attr") {
        const o = offres([e as Evenement], null);
        ss = [refCourte(s.ref), o ? t("contrat_a.ss.offres", { n: o.n }) : ""]
          .filter(Boolean)
          .join(" · ");
        const la = lotsAvis(e);
        bl = [
          o ? t("contrat_a.tip.attr_offres", { n: o.n }) : t("contrat_a.tip.attr"),
          ...(la?.prix != null ? [t("contrat_a.tip.prix", { p: fr(la.prix) })] : []),
        ].join(" ");
      } else if (s.k === "sub") {
        ss = [somme(e?.montant), refCourte(s.ref)].filter(Boolean).join(" · ");
      } else if (s.k === "aut") {
        ss = refCourte(s.ref);
      } else if (s.k === "fin") {
        ss = t("contrat_a.ss.fin", { n: s.n });
        bl = t("contrat_a.tip.fin");
      }
      if (s.probable) bl = [bl, t("contrat_a.tip.probable")].filter(Boolean).join(" ");
      return { b, ss, bl };
    };
    // the parcours with today in its place (recette, improvement 8), as the company's timeline
    const steps = avecAujourdhui(E, maj).map((s) => {
      const x = etapeTxt(s);
      const href = s.probable && s.affaire ? documentHref(s.affaire) : s.url;
      return {
        cls: `sp-st ${s.k}${s.probable ? " prob" : ""}`,
        gap: s.ecart ? ecartTxt(s.ecart) : "",
        k: t(`contrat_a.k.${s.k}`),
        d: jourDe(s),
        b: x.b,
        s: x.ss,
        bh: `${t(`contrat_a.k.${s.k}`)} · ${jourDe(s)}`,
        bl: x.bl,
        url: href,
        sans: !href,
        bc: href ? t(s.probable ? "contrat_a.clic_fiche" : "contrat_a.clic_doc") : "",
      };
    });
    const ao0 = E.find((s) => s.k === "avis");
    const s2 =
      E.length > 1
        ? {
            n: entree("parcours", t("contrat_a.toc.parcours")),
            titre: con ? t("contrat_a.s_parcours") : t("contrat_a.s_parcours_doc"),
            ans: con
              ? [
                  ...(ao0 && signe
                    ? rt("contrat_a.ans_par", {
                        d: { strong: ecartTxt({ n: jours(ao0.date, signe), u: "jours" }) },
                      })
                    : []),
                  ...(avc
                    ? [
                        ...(ao0 && signe ? [" "] : []),
                        ...(avc.etat === "fini"
                          ? rt("contrat_a.ans_fini", { mois: { strong: longMonth(avc.fin) } })
                          : avc.etat === "avant"
                            ? rt("contrat_a.ans_avant", { mois: { strong: longMonth(avc.fin) } })
                            : rt("contrat_a.ans_cours", {
                                mois: { strong: longMonth(avc.fin) },
                                n: avc.ecoules,
                              })),
                      ]
                    : []),
                ]
              : rt("contrat_a.ans_dossier", {
                  n: E.length,
                  d0: jourDe(E[0]),
                  d1: jourDe(E[E.length - 1]),
                }),
            r: repli(S.open, "par", t("accueil.voir_detail"), steps.length, this.basculer),
            ncls: `stepper n${Math.min(steps.length, 8)}`,
            steps,
            prog: avc
              ? {
                  pk: t("contrat_a.prog", { d0: shortDate(avc.debut), d1: shortDate(avc.fin) }),
                  st: `width: ${avc.pct}%`,
                  // the label slides along: left-aligned at the start, right-aligned at the end
                  bst: `left: ${avc.pct}%; transform: translateX(-${avc.pct}%)`,
                  l:
                    avc.etat === "fini"
                      ? t("contrat_a.prog_fini")
                      : avc.etat === "avant"
                        ? t("contrat_a.prog_avant")
                        : t("contrat_a.prog_auj", { n: avc.ecoules, total: avc.total }),
                }
              : null,
            note: fin ? t("contrat_a.note_par") : t("contrat_a.note_par_doc"),
            noteTel: fin ? t("contrat_a.note_par_tel") : t("contrat_a.note_par_doc_tel"),
          }
        : null;

    // 3 · before, after
    const suiv = con ? P.suivant : null;
    const s3 =
      con && (avantC || suiv)
        ? {
            n: entree("suite", t("contrat_a.toc.suite")),
            ans: [
              ...(avantC
                ? rt(memeTit ? "contrat_a.ans_suite_meme" : "contrat_a.ans_suite_autre", {
                    an: avantC.annee,
                    lots: avantC.lots,
                    suite: { strong: t("contrat_a.prend_la_suite") },
                    ent: avantC.entreprises.length
                      ? { span: entLiens(avantC.entreprises), cls: "" }
                      : t("contrat.entreprise_non_publiee"),
                  })
                : []),
              ...(suiv
                ? [
                    ...(avantC ? [" "] : []),
                    ...rt("contrat_a.ans_suite_suiv", { mois: longMonth(suiv.date) }),
                  ]
                : []),
            ],
            avant: avantC
              ? {
                  pk: t("contrat_a.avant_pk", { an: avantC.annee }),
                  b: casseNormale(avantC.titre) || t("contrat_a.avant_titre", { an: avantC.annee }),
                  s: [
                    ...(avantC.lots > 1 ? [`${t("contrat_a.lots", { n: avantC.lots })}, `] : []),
                    ...(avantC.entreprises.length ? entLiens(avantC.entreprises) : []),
                    ` · ${somme(avantC.montant)}`,
                    ...(avantC.modifs
                      ? [` · ${t("contrat_a.modifs_n", { n: avantC.modifs })}`]
                      : []),
                  ] as Rich,
                  href: documentHref(avantC.affaire),
                  lien: t("contrat_a.avant_lien", { an: avantC.annee }),
                }
              : null,
            me: {
              pk: fin
                ? t("contrat_a.me_pk_fin", { a0: signe.slice(0, 4), a1: fin.date.slice(0, 4) })
                : t("contrat_a.me_pk", { a0: signe.slice(0, 4) }),
              b:
                objetCourt.length > 64
                  ? `${objetCourt.slice(0, 62).replace(/[\s,;:]+\S*$/, "")}…`
                  : objetCourt,
              s: [
                sirens.length ? entNoms(sirens) : t("contrat.entreprise_non_publiee"),
                ...(montant != null ? [somme(montant)] : []),
              ].join(" · "),
            },
            apres: suiv
              ? {
                  pk: t("contrat_a.apres_pk"),
                  b: t("contrat_a.apres_ao", { mois: longMonth(suiv.date) }),
                  s: t("contrat_a.apres_ao_s"),
                  href: documentHref(suiv.affaire),
                  lien: t("contrat_a.apres_lien"),
                  cls: "card lk",
                }
              : {
                  pk: t("contrat_a.apres_pk"),
                  b: t("contrat_a.apres_rien"),
                  s: t("contrat_a.apres_rien_s"),
                  href: "",
                  lien: "",
                  cls: "card lk none",
                },
          }
        : null;

    // documents
    const D = documents(f);
    const ditDe = (s: Etape): string => {
      const e = s.e as Evenement;
      const prob = s.probable ? t("contrat_a.dit.probable") : "";
      if (s.k === "avis") {
        const pc = typeof e.procedure === "string" ? procCourt(e.procedure) : "";
        return `${t("contrat_a.dit.avis")}${pc ? `, ${pc}` : ""}${prob}`;
      }
      if (s.k === "contrat") return `${t("contrat_a.dit.contrat")}${prob}`;
      if (s.k === "modif") return this.modifTxt(e, att);
      if (s.k === "attr") {
        const o = offres([e], null);
        return `${t("contrat_a.dit.attr")}${o ? `, ${t("contrat_a.ss.offres", { n: o.n })}` : ""}`;
      }
      if (s.k === "rect") return t("contrat_a.dit.rect");
      if (s.k === "sub") return t("contrat_a.dit.sub", { m: somme(e.montant) });
      return t("contrat_a.dit.aut");
    };
    const docs = {
      r: repli(S.open, "docs", t("accueil.voir_detail"), D.length, this.basculer),
      plus: D.length > 12 && !S.tous ? t("contrat_a.docs_tous", { n: D.length }) : "",
      voirTous: (() => this.setState({ tous: true })) as Handler,
      rows: (D.length > 12 && !S.tous ? D.slice(0, 10) : D).map((s) => ({
        d: jourDe(s),
        k: t(`contrat_a.k.${s.k}`),
        ref: refCourte(s.ref) || t(`contrat_a.k.${s.k}`),
        dit: ditDe(s),
        src: (s.probable && s.affaire
          ? [{ a: { href: documentHref(s.affaire), text: t("contrat_a.sa_fiche") } }]
          : s.url
            ? [{ a: { href: s.url, text: `${hote(s.url) || t("contrat_a.source")} ↗` } }]
            : "—") as Rich,
      })),
      // a row's click opens its document, as its link does
      ligne: ((ev) => {
        const tgt = ev.nativeEvent.target as Element;
        if (tgt.closest("a, button")) return;
        tgt.closest("tr")?.querySelector<HTMLAnchorElement>("td a")?.click();
      }) as Handler,
    };

    // sources
    const hasAvis = evs.some((e) => e.t === "avis");
    const res = evs.filter((e) => e.t === "resultat");
    const srcRows = con
      ? [
          {
            cls: "ok",
            l: t(M.n ? "contrat_a.src.contrat_modifs" : "contrat_a.src.contrat"),
            d: t("contrat_a.src.decp"),
          },
          ...(hasAvis
            ? [
                {
                  cls: "ok",
                  l: t("contrat_a.src.ao"),
                  d: t(proc ? "contrat_a.src.boamp_eforms" : "contrat_a.src.boamp"),
                },
              ]
            : []),
          ...(res.length
            ? [
                {
                  cls: off?.source === "avis" ? "ok" : "part",
                  l: t("contrat_a.src.attr"),
                  d: t(
                    off?.source === "avis"
                      ? res.some((e) => lotsAvis(e)?.prix != null)
                        ? "contrat_a.src.attr_ok_crit"
                        : "contrat_a.src.attr_ok"
                      : "contrat_a.src.attr_part",
                  ),
                },
              ]
            : []),
        ]
      : sources(this.props.couverture, F.sources).map((s) => ({
          cls: "ok",
          l: s.l,
          d: [s.ed, s.date].filter(Boolean).join(" · "),
        }));
    toc.push({ href: "#documents", l: t("contrat_a.toc.documents"), go: this.allerSection });
    toc.push({ href: "#sources", l: t("contrat_a.toc.sources"), go: this.allerSection });
    const nSec = (id: string) => toc.find((x) => x.href === `#${id}`)?.l.split(" · ")[0] ?? "";

    // --- the four figures -----------------------------------------------------------------------
    const mTxt = somme(montant);
    const unite = /(Md€|M€)$/.exec(mTxt)?.[1] ?? "";
    const figs = con
      ? [
          {
            cls: montant == null ? "fig nl" : "fig",
            k: t(ac ? "contrat_a.fig.plafond" : "contrat_a.fig.montant"),
            v:
              montant == null
                ? t("format.non_publie")
                : unite
                  ? mTxt.slice(0, -unite.length).trim()
                  : mTxt,
            u: montant == null ? "" : unite,
            l: t(ac ? "contrat_a.fig.plafond_l" : "contrat_a.fig.montant_l"),
            r: [
              ...(av ? [t("contrat_a.fig.a_verifier", { de: somme(av.de), a: somme(av.a) })] : []),
              ...(!av && M.montant != null && montant != null && M.montant !== montant
                ? [t("contrat_a.fig.signature", { m: somme(montant) })]
                : []),
              ...(mx
                ? [t(mx.horsTotaux ? "contrat_a.fig.mixte" : "contrat_a.fig.mixte_compte")]
                : []),
            ].join(" · "),
            tip: t(ac ? "contrat_a.fig.plafond_tip" : "contrat_a.fig.montant_tip", {
              qui: quiAch,
            }),
            href: "#combien",
          },
          {
            cls: dur ? "fig" : "fig nl",
            k: t("contrat_a.fig.duree"),
            v: dur ? fr(dur) : t("contrat.non_publiee"),
            u: dur ? t("contrat_a.fig.duree_u") : "",
            l: fin ? t("contrat_a.fig.duree_l", { date: longDate(fin.date) }) : "",
            r: annonce ? t("contrat_a.fig.annonce", { d: duree(annonce.mois) }) : "",
            tip: t("contrat_a.fig.duree_tip"),
            href: s2 ? "#parcours" : "#combien",
          },
          {
            cls: off ? "fig" : "fig nl",
            k: t("contrat_a.fig.concurrence"),
            v: off ? (off.lots ? `${fr(off.min)}–${fr(off.max)}` : fr(off.n)) : t("liste.non_lu"),
            u: off ? t("contrat_a.fig.offres_u", { n: off.n }) : "",
            l: off
              ? off.lots
                ? t("contrat_a.fig.offres_lots", { lots: off.lots })
                : off.source === "avis"
                  ? t("contrat_a.fig.offres_l_avis", { ref: refCourte(off.ref) })
                  : t("contrat_a.fig.offres_l_decp")
              : res.length
                ? t("contrat_a.fig.offres_nl_res", { ref: refCourte(String(res[0].ref ?? "")) })
                : t("contrat_a.fig.offres_nl"),
            r: [proc ? procCourt(proc.code) : "", titulaires].filter(Boolean).join(", "),
            tip: off ? t("contrat_a.fig.concurrence_tip") : t("contrat_a.fig.concurrence_tip_nl"),
            href: s2 ? "#parcours" : "#combien",
          },
          {
            cls: "fig",
            k: t("contrat_a.fig.modifs"),
            v: fr(M.n),
            u: "",
            l: !M.n
              ? t("contrat_a.fig.aucune_l")
              : M.n === 1 && signe
                ? t("contrat_a.fig.modif_l_un", {
                    date: longDate(M.derniere),
                    ecart:
                      jours(signe, M.derniere) === 0
                        ? t("contrat_a.fig.jour_meme")
                        : t("contrat_a.fig.apres", {
                            e: ecartTxt(
                              jours(signe, M.derniere) < 365
                                ? { n: jours(signe, M.derniere), u: "jours" }
                                : { n: Math.round(jours(signe, M.derniere) / 30.4375), u: "mois" },
                            ),
                          }),
                  })
                : t("contrat_a.fig.modif_l_n", { date: longDate(M.derniere) }),
            r: !M.n ? "" : M.muettes ? t("contrat_a.fig.rien") : resumeModifs(),
            tip: t("contrat_a.fig.modifs_tip"),
            href: s2 ? "#parcours" : "#documents",
          },
        ]
      : F.kpis.slice(0, 4).map((k) => ({
          cls: "fig",
          k: capital1(k.l),
          v: k.v,
          u: "",
          l: "",
          r: k.m,
          tip: capital1(k.l),
          href: s2 ? "#parcours" : "#combien",
        }));
    const figsB = figs.map((x) => {
      const ns = nSec(x.href.slice(1));
      return { ...x, bc: ns ? t("contrat_a.fig.section", { n: ns }) : "", go: this.allerSection };
    });

    // --- the head -------------------------------------------------------------------------------
    const chips: {
      cls: string;
      href: string;
      sans: boolean;
      p: string;
      l: string;
      bl: string;
      bc: string;
    }[] = [];
    if (siren && (con || F.kind === "ao"))
      chips.push({
        cls: "chip t ach",
        href: achHref ?? "",
        sans: !achHref,
        p: "●",
        l: achNom,
        bl: t("contrat_a.chip_ach"),
        bc: achHref ? t("contrat_a.chip_clic", { nom: ville || achNom }) : "",
      });
    for (const s of sirens) {
      const h = entHrefDe(s);
      chips.push({
        cls: "chip t tit",
        href: h ?? "",
        sans: !h,
        p: "■",
        l: entName(L, s),
        bl: t("contrat_a.chip_tit"),
        bc: h ? t("contrat_a.chip_clic", { nom: entName(L, s) }) : "",
      });
    }
    const meta = con
      ? [
          signe
            ? ac
              ? t("contrat_a.meta_ac", { date: shortDate(signe) })
              : t("contrat_a.meta_signe", { date: shortDate(signe) })
            : "",
          refCourte(F.ref),
        ].filter(Boolean)
      : [F.sous.a, refCourte(F.ref)].filter(Boolean);
    const lead: Rich = con
      ? [
          ...rt("contrat_a.lead_con", {
            acheteur: siren
              ? achLien(communal ? t("contrat_a.la_ville_de", { nom: ville }) : achNom)
              : t("contrat_a.qui_acheteur_maj"),
            ents: sirens.length
              ? { strong: entLiens(sirens) }
              : t("contrat.entreprise_non_publiee"),
            forme: t(ac ? "contrat_a.un_ac" : "contrat_a.un_contrat"),
            objet: { strong: premiereMinuscule(objetCourt) },
            point,
          }),
          ...(montant != null
            ? [
                " ",
                ...rt(ac ? "contrat_a.lead_plafond" : "contrat_a.lead_montant", {
                  m: {
                    strong: dur
                      ? t("contrat_a.sur", {
                          m: somme(montant),
                          d: t("contrat_a.ecart.mois", { n: dur }),
                        })
                      : somme(montant),
                  },
                }),
              ]
            : []),
          ...(annonce
            ? [" ", ...rt("contrat_a.lead_annonce", { d: { strong: duree(annonce.mois) } })]
            : []),
        ]
      : F.lead;

    return {
      ...this.base("contrat-a"),
      kind: t(`contrat_a.kind.${this.type()}`),
      nom: this.nom(),
      // a long objet in smaller capitals (the board's is 70 characters)
      ncls: `ctitle${this.nom().length > 110 ? " long" : this.nom().length > 70 ? " moyen" : ""}`,
      chips,
      meta,
      lead,
      acts: S.plus ? "actions ouvert" : "actions",
      partager: ((ev) => partager(this, ev.currentTarget)) as Handler,
      citer: this.citer,
      citerL: t(S.cite ? "commune_a.cite" : "commune_a.citer"),
      plusExp: S.plus ? "true" : "false",
      basculerPlus: (() => this.setState({ plus: !S.plus })) as Handler,
      allerDocs: this.allerSection,
      figs: figsB,
      toc,
      s1,
      s2,
      s3,
      docs,
      srcs: {
        r: repli(
          S.open,
          "srcs",
          t("accueil.voir_detail"),
          srcRows.length,
          this.basculer,
          "card srcs",
        ),
        rows: srcRows,
        lu: srcRows.length > 0,
        signaler: signalerHref(F.main),
      },
    };
  }
}

const capital1 = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s);

export default {
  Vue: Contrat as unknown as VueModule["Vue"],
  template,
  donnees: async (r: Route) => {
    const id = (r as Props).id;
    const cv = couverture().catch(() => undefined);
    let f: Fichier;
    try {
      f = await load<Fichier>(`document/${encodeURIComponent(id)}.json`);
    } catch (e) {
      // a document the register does not hold (the dev server answers its page for a missing file);
      // any other failure is the page's (main.ts)
      if (e instanceof SyntaxError || /: 404$/.test(String((e as Error)?.message)))
        throw new Absent(id);
      throw e;
    }
    const ailleurs = ouvreAilleurs(f);
    if (ailleurs) {
      // a decree with its commune: its dossier in the commune's Autorisations, in place of this path
      history.replaceState(history.state, "", ailleurs);
      dispatchEvent(new PopStateEvent("popstate"));
    }
    const F = fiche(f);
    if (!F) throw new Absent(id);
    return { F, f, couverture: await cv };
  },
} satisfies VueModule;
