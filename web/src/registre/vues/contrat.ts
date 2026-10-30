// A document's record (/registre/contrat/<affaire>[?doc=<id>]; v2 skeleton as V2-Entreprise, content of
// mockup Contrat-grand): one template for a contract, a call for tenders without a contract, a subsidy
// and a decree the register cannot place in a commune (the model: contrat-outils.ts). Its type is the
// document it shows: the one `?doc=` names in the dossier (a modification: « Modification »), else its
// main one. A decree that has its commune opens there, in the commune's Autorisations at its dossier:
// donnees() decides before anything is drawn, so the record never shows. An affaire the register does
// not hold: Absent, the router's « introuvable ».

import type { Handler, Rich, RichItem } from "../dc.ts";
import { Absent, type Couverture, load } from "../donnees.ts";
import { shortDate } from "../format.ts";
import { t } from "../i18n.ts";
import { lien } from "../liens.ts";
import type { VueModule } from "../modale.ts";
import type { Route } from "../routes.ts";
import { HASH, ouvrir, signaler } from "../signaler.ts";
import { couverture, sources } from "../sources.ts";
import { couleur, icone, repere, type TypeCle } from "../types.ts";
import { type BaseState, large, type Partage, Vue } from "../vue.ts";
import "./contrat.css";
import template from "./contrat.html?raw";
import {
  docMontre,
  type Fiche,
  type Fichier,
  fiche,
  lienFiche,
  ouvreAilleurs,
  type Step,
  TYPE_ETAPE,
} from "./contrat-outils.ts";
import { motsDecoupes } from "./decoupe-outils.ts";

type Props = Extract<Route, { view: "contrat" }> & { F: Fiche; couverture?: Couverture };
type State = BaseState & { copied: "" | "copiee" | "selectionnee" };

/** A discreet mark (DECISIONS 2026-10-28) inside a rich line: « ? », its words for screen readers. */
const marque = (m: string): RichItem[] =>
  m
    ? [
        { span: "?", cls: "rep" },
        { span: ` (${m})`, cls: "sr" },
      ]
    : [];

/** The document `?doc=` names, read from the address (the router passes the path only). */
const docDemande = (): string | null =>
  typeof location === "undefined" ? null : new URLSearchParams(location.search).get("doc");

class Contrat extends Vue<Props, State> {
  /** the document shown, when the address names one of the dossier's */
  private readonly montre: Step | null = docMontre(this.props.F, docDemande());

  protected init(props: Props): Partial<State> {
    // opened on a document of the dossier: its row is the one in the panel
    const d = docMontre(props.F, docDemande());
    return { copied: "", sel: d ? `d${props.F.docs.indexOf(d)}` : null };
  }

  titre(): string {
    return this.props.F.titreDoc;
  }

  type(): TypeCle {
    const d = this.montre;
    return d && d.k !== "fin" ? TYPE_ETAPE[d.k] : this.props.F.type;
  }

  partage(): Partage | null {
    return { titre: this.titre() };
  }

  /** Opened at its form's address (a panel's link followed without the script, or shared): the
   * form over the record, on the document `doc` names. */
  componentDidMount(): void {
    if (location.hash !== HASH) return;
    const doc = docDemande() || this.props.F.main.id;
    ouvrir(doc, this.props.id);
  }

  /** « Copier la référence »: the citation to the clipboard, else the reference selected on the page. */
  private copy(text: string): void {
    const select = () => {
      const el = document.querySelector(".v-contrat .idline");
      const sel = getSelection();
      if (el && sel) {
        sel.selectAllChildren(el);
        this.setState({ copied: "selectionnee" });
      }
    };
    try {
      if (!navigator.clipboard) throw new Error("no clipboard");
      navigator.clipboard.writeText(text).then(() => this.setState({ copied: "copiee" }), select);
    } catch {
      select();
    }
  }

  /** The step or document selected: `s<i>` a step of the parcours, `d<i>` a document of the list. */
  private choisi(): Step | undefined {
    const k = this.state.sel;
    if (!k) return undefined;
    const i = Number(k.slice(1));
    return k[0] === "s" ? this.props.F.steps[i] : this.props.F.docs[i];
  }

  renderVals() {
    const F = this.props.F;
    const S = this.state;
    const k = this.type();
    const d = this.montre;
    const wide = large();

    // the identity line: the document shown (its date, its reference), who issues it
    const ligne: Rich = [
      ...(d
        ? [d.what, " · ", d.date, ...marque(d.dm), d.ref ? ` · ${d.ref}` : ""]
        : [F.sous.a, ...marque(F.sous.m), F.sous.b]),
      ...(F.emetteur ? [" · ", F.emetteur] : []),
    ].filter((x) => x !== "");

    const steps = F.steps.map((s, i) => ({
      type: s.type,
      date: s.date,
      dm: s.dm,
      what: s.what,
      lm: s.lm,
      ghost: s.ghost,
      doc: !s.ghost,
      r: s.k === "fin" ? null : repere(TYPE_ETAPE[s.k]),
      next: i < F.steps.length - 1,
      cls: `st${s.ghost ? " ghostst" : ""}${S.sel === `s${i}` ? " on" : ""}`,
      on: String(S.sel === `s${i}`),
      hover: this.pick(`s${i}`),
    }));

    const docs = F.docs.map((s, i) => {
      const tk = s.k === "fin" ? F.type : TYPE_ETAPE[s.k];
      return {
        cls: `drow${S.sel === `d${i}` ? " on" : ""}`,
        c: `--c: ${couleur(tk)}`,
        i: icone(tk),
        date: s.date,
        dm: s.dm,
        // « Modification n° 2 » says its type already
        what: s.what.startsWith(s.type) ? s.what : `${s.type} · ${s.what}`,
        lm: s.lm,
        // another record of the register (a probable call for tenders or contract): a link of its type
        fiche: s.href ? lien(tk, s.href.href, s.ref || s.href.l) : "",
        ref: s.href ? "" : s.ref,
        url: s.href ? "" : s.url,
        texte: !s.href && !s.url && !!s.ref,
        hover: this.pick(`d${i}`),
      };
    });

    const secs = this.sections({
      essentiel: true,
      temps: F.steps.length > 1 || !!F.prec || !!F.suiv,
      avecqui: F.qui.length > 0,
      documents: F.docs.length > 0,
      sources: true,
    });

    const sel = this.choisi();
    const citation = t("contrat.citation", {
      ref: d?.ref || F.ref || F.titre,
      date: d ? d.date : shortDate(F.main.date),
      adresse: `${location.origin}${location.pathname}${location.search}`,
    });
    const docId = d?.id || F.main.id;
    return {
      ...this.base("contrat"),
      ...this.info("par", "max"),
      tete: this.tete(k, F.titreDoc, ligne),
      mots: motsDecoupes(F.titreDoc),
      band: this.bandeau(k, F.titreDoc, secs),
      secs,
      lay: {
        inner: wide ? "inner" : "tin",
        tickets: wide ? "tickets" : "tickets t2",
        steps: wide ? "par" : "par un",
      },
      lead: F.lead,
      kpis: F.kpis,
      argent: F.argent,
      ditTitre: F.ditTitre,
      maxNote: F.ditNote,
      dl: F.dl,
      parTitre: F.parTitre,
      steps,
      prec: F.prec ? { lien: lienFiche(F.prec), m: F.prec.m } : null,
      suiv: F.suiv ? { lien: lienFiche(F.suiv), m: F.suiv.m } : null,
      liens: !!(F.prec || F.suiv),
      qui: F.qui,
      docs,
      // the companies' names are SIRENE's (as on Entreprise)
      sources: sources(this.props.couverture, F.sources, !!F.main.entreprises?.length),
      arretes: F.arretes,
      det: sel ? this.panel(F, sel) : this.rest(F),
      copier: () => this.copy(citation),
      sig: {
        l: t("signaler.lien"),
        ouvrir: (() => ouvrir(docId, this.props.id)) as Handler,
      },
      copierL:
        S.copied === "copiee"
          ? t("contrat.reference_copiee")
          : S.copied === "selectionnee"
            ? t("contrat.reference_selectionnee")
            : t("contrat.copier_la_reference"),
    };
  }

  /** The panel at rest: the document in four lines, whom it names (links), its marks, its source. */
  private rest(F: Fiche) {
    return {
      kicker: F.sum.kicker,
      title: F.sum.title,
      rows: F.sum.rows.map(([k, v]) => ({ k, v })),
      // the mentions that have their fiche, as links, unless a row above says them already
      corr: F.qui
        .filter((x) => JSON.stringify(x.v).includes('"a":') && !F.sum.rows.some(([k]) => k === x.k))
        .map((x) => ({ k: x.k, v: x.v })),
      foot: [t("contrat.survolez"), ...F.reperes].join(" "),
      links: [
        ...(F.source ? [{ l: t("arretes.voir"), href: F.source }] : []),
        signaler({ id: F.main.id, affaire: this.props.id }),
      ],
    };
  }

  /** The panel of a step: its facts, the companies and the record it links to, its source, the report. */
  private panel(F: Fiche, s: Step) {
    const foot = [s.ref ? `${s.ref} ·` : "", ...s.foot].filter(Boolean).join(" ");
    const tk = s.k === "fin" ? null : TYPE_ETAPE[s.k];
    return {
      kicker: `${s.type} · ${s.date}`,
      title: s.what,
      rows: s.rows.map(([k, v]) => ({ k, v })),
      corr: [
        ...(s.qui ? [{ k: t("contrat.d_entreprise"), v: s.qui }] : []),
        ...(s.href && tk
          ? [{ k: t("contrat.p_fiche"), v: [lien(tk, s.href.href, s.href.l)] }]
          : []),
      ],
      foot,
      links: [
        ...(s.url
          ? [{ l: s.k === "aut" ? t("arretes.voir") : t("contrat.voir_document"), href: s.url }]
          : []),
        signaler({ id: s.id || F.main.id, affaire: this.props.id }),
      ],
    };
  }
}

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
      // a decree with its commune: its dossier in the commune's Autorisations, in place of this path.
      // The router answers the new path at once (popstate) and drops this one, which a later path
      // replaced (main.ts show: « a later path was asked meanwhile »): the record is never drawn.
      history.replaceState(history.state, "", ailleurs);
      dispatchEvent(new PopStateEvent("popstate"));
    }
    const F = fiche(f);
    if (!F) throw new Absent(id);
    return { F, couverture: await cv };
  },
} satisfies VueModule;
