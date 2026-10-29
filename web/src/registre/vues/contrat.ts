// A document's record (/registre/contrat/<affaire>; mockup Contrat-grand, prototype vues/contrat.js): one
// template for a contract, a call for tenders without a contract, a subsidy and a decree the register
// cannot place in a commune (the model: contrat-outils.ts). A decree that has its commune opens there, in
// the commune's Autorisations at its dossier: donnees() decides before anything is drawn, so the record
// never shows. An affaire the register does not hold: Absent, the router's « introuvable ».

import type { Handler } from "../dc.ts";
import { Absent, load } from "../donnees.ts";
import { shortDate } from "../format.ts";
import { t } from "../i18n.ts";
import type { VueModule } from "../main.ts";
import type { Route } from "../routes.ts";
import { HASH, ouvrir, signaler } from "../signaler.ts";
import { type BaseState, Vue } from "../vue.ts";
import template from "./contrat.html?raw";
import {
  type Fiche,
  type Fichier,
  fiche,
  ouvreAilleurs,
  type Step,
  stepStyle,
} from "./contrat-outils.ts";

type Props = Extract<Route, { view: "contrat" }> & { F: Fiche };
type State = BaseState & { copied: "" | "copiee" | "selectionnee" };

/** « Signaler une erreur » on a document of this record (signaler.ts: its form). */
function signalement(id: string, affaire: string): { l: string; href: string }[] {
  return [signaler({ id, affaire })];
}

class Contrat extends Vue<Props, State> {
  protected init(): Partial<State> {
    return { copied: "" };
  }

  titre(): string {
    return this.props.F.titre;
  }

  /** Opened at its form's address (a panel's link followed without the script, or shared): the
   * form over the record, on the document `doc` names. */
  componentDidMount(): void {
    if (location.hash !== HASH) return;
    const doc = new URLSearchParams(location.search).get("doc") || this.props.F.main.id;
    ouvrir(doc, this.props.id);
  }

  /** « Copier la référence »: the citation to the clipboard, else the reference selected on the page. */
  private copy(text: string): void {
    const select = () => {
      const el = document.querySelector(".v-contrat h1 ~ p.tw");
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

  renderVals() {
    const F = this.props.F;
    const base = { ...this.base("contrat"), ...this.info("par", "max") };
    const S = this.state;
    const sel = S.sel != null ? F.steps[Number(S.sel)] : undefined;
    const pick = (i: number) => () => {
      if (S.sel !== String(i)) this.setState({ sel: String(i) });
    };
    const steps = F.steps.map((s, i) => ({
      type: s.type,
      date: s.date,
      dm: s.dm,
      what: s.what,
      lm: s.lm,
      badge: stepStyle(s.k),
      next: i < F.steps.length - 1,
      cls: `st${s.ghost ? " ghostst" : ""}${S.sel === String(i) ? " on" : ""}`,
      hover: pick(i),
    }));
    const src = F.steps
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => s.ref)
      .map(({ s, i }) => ({
        date: s.date,
        dm: s.dm,
        type: s.type,
        badge: stepStyle(s.k),
        ref: s.ref,
        url: s.url,
        texte: !s.url,
        cls: `r${S.sel === String(i) ? " on" : ""}`,
        hover: pick(i),
      }));
    const citation = t("contrat.citation", {
      ref: F.ref || F.titre,
      date: shortDate(F.main.date),
      adresse: `${location.origin}${location.pathname}`,
    });
    return {
      ...base,
      fil: F.fil,
      filIci: F.titreDoc,
      badge: F.badge,
      titre: F.titre,
      sous: F.sous,
      lead: F.lead,
      kpis: F.kpis,
      parTitre: F.parTitre,
      steps,
      grille: F.steps.map(() => "minmax(0, 1fr)").join(" 28px "),
      prec: F.prec,
      noPrec: !F.prec,
      suiv: F.suiv,
      ditTitre: F.ditTitre,
      maxNote: F.ditNote,
      dl: F.dl,
      argent: F.argent,
      arretes: F.arretes,
      src,
      det: sel ? this.panel(F, sel) : this.rest(F),
      copier: () => this.copy(citation),
      sig: {
        l: t("signaler.lien"),
        ouvrir: (() => ouvrir(F.main.id, this.props.id)) as Handler,
      },
      copierL:
        S.copied === "copiee"
          ? t("contrat.reference_copiee")
          : S.copied === "selectionnee"
            ? t("contrat.reference_selectionnee")
            : t("contrat.copier_la_reference"),
    };
  }

  /** The panel at rest: the document in four lines, what its marks mean, its source, the report. */
  private rest(F: Fiche) {
    return {
      kicker: F.sum.kicker,
      title: F.sum.title,
      rows: F.sum.rows.map(([k, v]) => ({ k, v })),
      foot: [t("contrat.survolez"), ...F.reperes].join(" "),
      links: [
        ...(F.source ? [{ l: t("arretes.voir"), href: F.source }] : []),
        ...signalement(F.main.id, this.props.id),
      ],
    };
  }

  /** The panel of a step: its facts, its source, the record it links to, the report. */
  private panel(F: Fiche, s: Step) {
    const foot = [s.ref ? `${s.ref} ·` : "", ...s.foot].filter(Boolean).join(" ");
    return {
      kicker: `${s.type} · ${s.date}`,
      title: s.what,
      rows: s.rows.map(([k, v]) => ({ k, v })),
      foot,
      links: [
        ...(s.href ? [s.href] : []),
        ...(s.url
          ? [{ l: s.k === "aut" ? t("arretes.voir") : t("contrat.voir_document"), href: s.url }]
          : []),
        ...signalement(s.id || F.main.id, this.props.id),
      ],
    };
  }
}

export default {
  Vue: Contrat as unknown as VueModule["Vue"],
  template,
  donnees: async (r: Route) => {
    const id = (r as Props).id;
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
    return { F };
  },
} satisfies VueModule;
