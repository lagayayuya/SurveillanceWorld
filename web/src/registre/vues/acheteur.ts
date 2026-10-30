// View 9 · Acheteur (/registre/acheteur/<siren>; content: mockup Acheteur-grand, the prototype's
// vues/acheteur.js; frame: design/registre/v2, V2-Entreprise): its head, then the skeleton's
// sections — L'essentiel (the lead, its figures), Dans le temps (its contracts' planned amount by
// year), Avec qui (who sells here, where its contracts are, the buyer linked to it), Documents (its
// contracts and its calls for tenders), Sources. Its file is the build's acheteur/<siren>.json; a
// collectivité's path is its territory's page (a commune's, an intercommunality's, a département's),
// replaced before anything is drawn. Amounts: a total adds the contracts the build counts (`compte`).

import type { RichItem } from "../dc.ts";
import { richText } from "../dc.ts";
import type { Couverture } from "../donnees.ts";
import { Absent, load } from "../donnees.ts";
import { count, fr, money, moneyFull, shortDate, shortMonth } from "../format.ts";
import { t } from "../i18n.ts";
import {
  lien,
  lienAcheteur,
  lienCommune,
  lienDepartement,
  lienDocument,
  lienEntreprise,
} from "../liens.ts";
import type { VueModule } from "../modale.ts";
import type { Route } from "../routes.ts";
import { couverture, sources } from "../sources.ts";
import { type BaseState, type Col, large, type Partage, Vue } from "../vue.ts";
import "./acheteur.css";
import template from "./acheteur.html?raw";
import {
  appels,
  buyerNom,
  type Contrat,
  categorie,
  contratHref,
  contrats,
  departementAVerifier,
  enCours,
  entName,
  type FichierAcheteur,
  fin,
  lead,
  lexique,
  lieux,
  parAnnee,
  redirection,
  rt,
  sirenSpaced,
  titreCourt,
  total,
  trier,
  vendeurs,
} from "./acheteur-outils.ts";
import type { FichierDepartement } from "./departement-outils.ts";

type Props = Extract<Route, { view: "acheteur" }> & { f: FichierAcheteur; couverture?: Couverture };
type State = BaseState & {
  sort: string;
  dir: number;
  sortV: string;
  dirV: number;
  sortA: string;
  dirA: number;
};
type Det = {
  kicker: string;
  title: string;
  rows: [string, string][];
  /** rows that name a company or a place: rich, each mention a link */
  corr?: [string, RichItem[]][];
  foot: string;
  link?: { l: string; href: string };
};

const TODAY = new Date().toISOString().slice(0, 10);
const RECENT = (() => {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - 18);
  return d.toISOString().slice(0, 10);
})();
const NUM = new Set(["amt", "dur", "off", "n"]);
// one colour for the measure, the fiche's type's; the mark chosen in ink (v2.1: yellow is the
// territories' colour, never the selection's)
const BAR = "var(--type-acheteur)";
const ON = "var(--fg)";
/** Values are written on the bars up to twelve of them (v2 § 8); beyond, the label and the panel. */
const ECRITES = 12;

/** An amount in millions, one decimal, as the bars write them (« 5,2 M€ »); below 100 000 € in
 * euros; none: « — » (Entreprise's own). */
const meur = (n: number): string =>
  !n ? "—" : n < 1e5 ? money(n) : t("format.meur", { n: (n / 1e6).toFixed(1).replace(".", ",") });

class Acheteur extends Vue<Props, State> {
  protected init(): Partial<State> {
    return { sort: "date", dir: 1, sortV: "amt", dirV: -1, sortA: "date", dirA: 1 };
  }
  titre(): string {
    return titreCourt(buyerNom(this.props.f, this.props.siren));
  }
  type() {
    return "acheteur" as const;
  }
  partage(): Partage | null {
    return { titre: this.titre() };
  }

  /** The companies of a contract, each a link to its fiche (a sole trader's words only). */
  private ents(sirens: string[], sep = " + "): RichItem[] {
    const { f } = this.props;
    if (!sirens.length) return [t("acheteur.ent_non_publiee")];
    return sirens.flatMap((s, i) =>
      i ? [sep, lienEntreprise(lexique(f), s)] : [lienEntreprise(lexique(f), s)],
    );
  }

  private dur(c: Contrat): string {
    if (c.d0 && c.d1) return t("acheteur.duree_change", { a: fr(c.d0), b: fr(c.d1) });
    return c.d0 ? t("acheteur.duree_mois", { n: fr(c.d0) }) : "";
  }

  renderVals() {
    const S = this.state;
    const { f, siren } = this.props;
    const A = f.acheteur;
    const full = buyerNom(f, siren);
    const nom = titreCourt(full);
    const C = contrats(f, f.stats);
    const LC = A.lie ? contrats(f, f.stats_lie) : [];
    const T = total(C);
    const DET: Record<string, Det> = {};
    const entsAll = [...new Set(C.flatMap((c) => c.ents))];
    const mixtes = T.hors.filter((c) => c.mixte);
    const wide = large();

    // L'essentiel: the total is the counted contracts' (compte), the others said beside it
    const montantL = !T.comptes
      ? t("acheteur.kpi_aucun_compte")
      : T.hors.length && mixtes.length === T.hors.length
        ? t("acheteur.kpi_montant_hors_mixte", { n: mixtes.length })
        : T.hors.length
          ? t("acheteur.kpi_montant_hors", { n: T.hors.length })
          : t("acheteur.kpi_montant");
    const totalV = T.comptes ? money(T.montant) : "—";
    const nMod = C.filter((c) => c.mods.length).length;
    const kpis = [
      { v: fr(C.length), l: t("acheteur.kpi_contrats", { n: C.length }) },
      { v: fr(entsAll.length), l: t("acheteur.kpi_entreprises", { n: entsAll.length }) },
      { v: totalV, l: montantL },
      { v: fr(nMod), l: t("acheteur.kpi_modifies", { n: nMod }) },
    ];

    // a contract in the panel
    for (const [i, c] of C.entries()) {
      const rows: [string, string][] = [[t("acheteur.c_montant"), moneyFull(c.m0)]];
      if (c.m1) rows.push([t("acheteur.c_apres"), moneyFull(c.m1)]);
      rows.push([t("acheteur.c_duree"), this.dur(c) || t("acheteur.c_non_publiee")]);
      const end = fin(c);
      if (end) rows.push([t("acheteur.c_fin"), shortDate(end)]);
      rows.push([t("acheteur.c_offres"), c.off == null ? t("format.non_publie") : fr(c.off)]);
      if (c.mods.length) rows.push([t("acheteur.c_modifs"), c.mods.map(shortDate).join(", ")]);
      DET[`c${i}`] = {
        kicker: t(c.mixte ? "acheteur.c_kicker_mixte" : "acheteur.c_kicker", {
          date: shortDate(c.d),
        }),
        title: c.objet,
        rows,
        // its companies, each a link (the panel's rich line)
        corr: [[t("acheteur.entreprise"), this.ents(c.ents)]],
        foot: [c.ref, c.avis?.ref ? t("acheteur.c_ao", { ref: c.avis.ref }) : ""]
          .filter(Boolean)
          .join(" · "),
        link: { l: t("acheteur.c_lien"), href: contratHref(c.affaire) },
      };
    }

    // Dans le temps: the planned amount of the contracts signed each year (in place of R1's frieze,
    // v2 § 8: one measure on one axis from zero, the years in a row, the detail in the panel)
    const Y = parAnnee(C, Number(TODAY.slice(0, 4)));
    const mxs = Math.max(1, ...Y.map((y) => y.montant));
    const ecrites = Y.length <= ECRITES;
    const years = Y.map((a) => {
      const k = `y${a.y}`;
      const on = this.on(k);
      DET[k] = {
        kicker: t("acheteur.det_annee"),
        title: a.y,
        rows: [
          [t("acheteur.p_contrats"), fr(a.cs.length)],
          [t("acheteur.col_montant"), a.montant ? money(a.montant) : "—"],
          [t("acheteur.det_plus_gros"), a.max ? money(a.max) : "—"],
          [t("acheteur.p_entreprises"), fr(new Set(a.cs.flatMap((c) => c.ents)).size)],
        ],
        foot: a.cs.length > a.cs.filter((c) => c.compte).length ? t("acheteur.det_hors") : "",
        link: a.cs.length
          ? {
              l: t("acheteur.det_voir_annee", { y: a.y }),
              href: `/registre/?${new URLSearchParams({ q: full, t: "con", y: a.y })}`,
            }
          : undefined,
      };
      return {
        y: a.y,
        v: ecrites ? meur(a.montant) : "",
        n: count(a.cs.length, "contrat"),
        label: t("acheteur.annee_label", { y: a.y, v: meur(a.montant), n: a.cs.length }),
        on: String(on),
        // a year without a counted amount draws no bar (its « — » says it), not a sliver
        bar: a.montant
          ? `height: ${Math.max(3, Math.round((a.montant / mxs) * 150))}px; background: ${on ? ON : BAR}`
          : "height: 0; border-width: 0",
        hover: this.survol(k),
        pick: this.choisir(k),
      };
    });

    const run = enCours(C, TODAY);
    const tempsPhrase: RichItem[] = [];
    if (C.length && run.connus) {
      tempsPhrase.push(
        t(C.length === 1 ? "acheteur.temps_un" : "acheteur.temps_en_cours", { n: run.n }),
      );
      if (run.connus < C.length)
        tempsPhrase.push(" ", t("acheteur.temps_sans_duree", { n: C.length - run.connus }));
    } else if (C.length) tempsPhrase.push(t("acheteur.temps_aucune_duree", { n: C.length }));
    if (A.lie && LC.length) {
      const l0 = LC[0].d.slice(0, 4);
      const l1 = LC[LC.length - 1].d.slice(0, 4);
      const quand =
        l0 === l1
          ? t("acheteur.quand_en", { y0: l0 })
          : t("acheteur.quand_de_a", { y0: l0, y1: l1 });
      const after = !C.length || LC[0].d >= C[C.length - 1].d;
      if (tempsPhrase.length) tempsPhrase.push(" ");
      tempsPhrase.push(
        ...rt(after ? "acheteur.temps_lie_suivants" : "acheteur.temps_lie_autres", {
          quand,
          lie: lienAcheteur(lexique(f), A.lie),
        }),
      );
    }

    // Avec qui: who sells here, the counted amounts, the contracts out of the total and the shared
    const SE = vendeurs(C);
    const mxv = Math.max(1, ...SE.map((x) => x.montant));
    const notes = SE.map((x) => {
      const parts: RichItem[][] = [];
      const mix = x.hors.filter((c) => c.mixte);
      if (mix.length === 1 && x.hors.length === 1)
        parts.push([t("acheteur.vend_mixte", { objet: mix[0].label })]);
      else if (x.hors.length) parts.push([t("acheteur.vend_hors", { n: x.hors.length })]);
      if (x.partages.length) {
        const avec = this.ents(x.avec, ", ");
        parts.push(
          x.partages.length === x.cs.length
            ? rt("acheteur.vend_avec", { ents: avec })
            : rt("acheteur.vend_dont_avec", { n: fr(x.partages.length), ents: avec }),
        );
      }
      return parts.flatMap((p, i) => (i ? [t("acheteur.note_sep"), ...p] : p));
    });
    const vkey: Record<string, (i: number) => string | number> = {
      nom: (i) => entName(f, SE[i].s),
      n: (i) => SE[i].n,
      amt: (i) => SE[i].montant,
    };
    const first = (k: string) => (NUM.has(k) ? -1 : 1);
    const sellers = trier(
      SE.map((_, i) => i),
      vkey[S.sortV] ?? vkey.amt,
      S.dirV,
    ).map((i) => {
      const x = SE[i];
      const k = `s${i}`;
      const rowsS: [string, string][] = [
        [t("acheteur.s_contrats", { nom }), fr(x.n)],
        [t("acheteur.col_montant"), x.montant ? moneyFull(x.montant) : "—"],
      ];
      const note = notes[i];
      if (note.length) rowsS.push([t("acheteur.s_note"), richText(note)]);
      const link = lienEntreprise(lexique(f), x.s);
      DET[k] = {
        kicker: t("acheteur.entreprise"),
        title: entName(f, x.s),
        rows: rowsS,
        foot: t("acheteur.s_foot"),
        link:
          typeof link === "object" && "a" in link
            ? { l: t("acheteur.s_lien"), href: link.a.href }
            : undefined,
      };
      return {
        nom: link,
        n: fr(x.n),
        amt: x.montant ? money(x.montant) : "—",
        note,
        bar: `display: inline-block; height: 10px; width: ${x.montant ? Math.max(3, Math.round((x.montant / mxv) * (wide ? 160 : 60))) : 0}px; background: ${this.on(k) ? ON : BAR}; border: 1px solid #111`,
        ...this.ligne(k, "entreprise"),
      };
    });
    const colsV = this.cols(
      [
        ["nom", t("acheteur.entreprise"), "", ""],
        ["n", t("acheteur.contrats"), "num", ""],
        ["amt", t("acheteur.col_montant"), "num", ""],
      ] as Col[],
      "sortV",
      "dirV",
      first,
    );

    // where its contracts are placed, and its département
    const ou = lieux(C).map((x) => ({
      lien: lienCommune(lexique(f), x.insee),
      n: t("acheteur.n_contrats_ici", { n: x.n }),
    }));
    const dep = A.dep ?? "";

    // the linked buyer
    const lie =
      A.lie && LC.length
        ? {
            lien: lienAcheteur(lexique(f), A.lie),
            nom: buyerNom(f, A.lie),
            sous: t("acheteur.lie_sous", {
              siren: sirenSpaced(A.lie),
              contrats: t("n.contrat", { n: LC.length }),
              y0: LC[0].d.slice(0, 4),
              y1: LC[LC.length - 1].d.slice(0, 4),
            }),
          }
        : null;
    const mob = LC.map((c) => ({
      date: shortDate(c.d),
      objet: lienDocument(lexique(f), c.e, c.label, true),
      ent: this.ents(c.ents),
      amt: money(c.m0),
    }));

    // Documents: the contracts' table, sortable
    const keyf: Record<string, (c: Contrat) => string | number> = {
      date: (c) => c.d,
      objet: (c) => c.label,
      ent: (c) => (c.ents[0] ? entName(f, c.ents[0]) : ""),
      amt: (c) => c.m0 ?? 0,
      dur: (c) => c.d1 ?? c.d0 ?? 0,
      off: (c) => c.off ?? -1,
    };
    const idx = new Map(C.map((c, i) => [c, i]));
    const rows = trier(C, keyf[S.sort] ?? keyf.date, S.dir).map((c) => {
      const i = idx.get(c) ?? 0;
      return {
        date: shortDate(c.d),
        flag: c.flag,
        objet: lienDocument(lexique(f), c.e, c.label, true),
        mixte: c.mixte,
        ents: c.ents.length
          ? c.ents.map((s) => ({ lien: lienEntreprise(lexique(f), s) }))
          : [{ lien: t("acheteur.ent_non_publiee") }],
        amt: moneyFull(c.m0),
        amt2: c.m1 ? t("acheteur.apres_modif", { eur: moneyFull(c.m1) }) : "",
        dur: this.dur(c) || "—",
        off: c.off == null ? t("format.non_publie") : fr(c.off),
        ...this.ligne(`c${i}`, "con"),
      };
    });
    const cols = this.cols(
      [
        ["date", t("acheteur.col_signature"), "", "width: 120px"],
        ["objet", t("acheteur.objet"), "", ""],
        ["ent", t("acheteur.entreprise"), "", "width: 180px"],
        ["amt", t("acheteur.col_montant"), "num", ""],
        ["dur", t("acheteur.col_duree"), "num", ""],
        ["off", t("acheteur.col_offres"), "num", ""],
      ] as Col[],
      "sort",
      "dir",
      first,
    );

    // the calls for tenders: those of its contracts, and those no contract was found for
    const AO = appels(f, C);
    const aoRows = AO.map((a, i) => {
      const k = `o${i}`;
      // the contract that followed: its date a link to its record, its companies each a link
      const contrat: RichItem[] = a.contrat
        ? [
            lien("con", contratHref(a.contrat), shortMonth(a.dContrat), true),
            " · ",
            ...this.ents(a.ents),
          ]
        : [];
      const manque = a.d >= RECENT ? t("acheteur.pas_encore_publie") : t("acheteur.non_retrouve");
      DET[k] = {
        kicker: t("acheteur.o_kicker", { date: shortDate(a.d) }),
        title: a.objet,
        rows: [[t("acheteur.publications"), a.refs || "—"]],
        corr: [
          [
            t("acheteur.contrat"),
            contrat.length
              ? a.probable
                ? [...contrat, ` (${t("repere.lien")})`]
                : contrat
              : [manque],
          ],
        ],
        foot: t("acheteur.o_foot"),
        link: a.contrat ? { l: t("acheteur.c_lien"), href: contratHref(a.contrat) } : undefined,
      };
      return { a, i, k, contrat, manque };
    });
    const akey: Record<string, (x: (typeof aoRows)[number]) => string> = {
      date: (x) => x.a.d,
      objet: (x) => x.a.objet,
      pub: (x) => x.a.refs,
      contrat: (x) => x.a.dContrat,
    };
    const aos = trier(aoRows, akey[S.sortA] ?? akey.date, S.dirA).map((x) => ({
      date: shortDate(x.a.d),
      objet: lien("ao", x.a.href, x.a.objet, true),
      refs: x.a.refs,
      contrat: x.contrat,
      found: x.contrat.length > 0,
      missing: !x.contrat.length,
      probable: x.a.probable,
      manque: x.manque,
      ...this.ligne(x.k, "ao"),
    }));
    const colsA = this.cols(
      [
        ["date", t("acheteur.date"), "", "width: 120px"],
        ["objet", t("acheteur.objet"), "", ""],
        ["pub", t("acheteur.publications"), "", ""],
        ["contrat", t("acheteur.contrat"), "", ""],
      ] as Col[],
      "sortA",
      "dirA",
    );
    const nMods = C.reduce((s, c) => s + c.mods.length, 0);

    // the money's note under « i »: what the total leaves out
    const mt: string[] = [];
    if (mixtes.length === 1)
      mt.push(t("acheteur.mt_mixte", { objet: mixtes[0].label, total: totalV }));
    else if (mixtes.length) mt.push(t("acheteur.mt_mixtes", { n: mixtes.length, total: totalV }));
    const why = (re: (c: Contrat) => boolean) => T.hors.filter((c) => !c.mixte && re(c)).length;
    const nCentrale = why((c) => c.e.hors_totaux === "centrale");
    const nVerif = why((c) => c.e.hors_totaux === "a_verifier");
    const nNational = why((c) => !c.e.hors_totaux && !!c.e.national);
    if (nCentrale) mt.push(t("acheteur.mt_centrale", { n: nCentrale }));
    if (nVerif) mt.push(t("acheteur.mt_a_verifier", { n: nVerif }));
    if (nNational) mt.push(t("acheteur.mt_national", { n: nNational }));

    // the panel: the row hovered or focused, else the one chosen (A3)
    const vu = this.affiche();
    const d0 = vu ? DET[vu] : undefined;
    const det = d0
      ? {
          kicker: d0.kicker,
          title: d0.title,
          rows: d0.rows.map(([k, v]) => ({ k, v })),
          corr: (d0.corr ?? []).map(([k, v]) => ({ k, v })),
          foot: d0.foot,
          links: d0.link ? [d0.link] : [],
        }
      : {
          // at rest: what to hover or choose, never the figures beside it (B3)
          kicker: t("acheteur.det_detail"),
          title: t("acheteur.p_survol"),
          rows: [],
          corr: [],
          foot: "",
          links: [],
        };

    // the identity line: its published name when the title shortens it, its kind, its SIREN, its
    // seat and its département, each place a link
    const siege = A.insee_siege && f.communes[A.insee_siege] ? A.insee_siege : "";
    const ligne: RichItem[] = [
      ...(A.nom && A.nom !== nom && A.nom !== full ? [A.nom, " · "] : []),
      categorie(f),
      " · ",
      t("acheteur.sous_siren", { siren: sirenSpaced(siren) }),
      ...(siege ? [" · ", lienCommune(lexique(f), siege)] : []),
      ...(dep ? [siege ? ", " : " · ", lienDepartement(dep, A.dep_nom ?? undefined)] : []),
    ];

    const secs = this.sections({
      essentiel: true,
      temps: C.length > 0,
      avecqui: SE.length > 0 || ou.length > 0 || !!lie,
      documents: C.length > 0 || AO.length > 0,
      sources: true,
    });
    return {
      ...this.base("acheteur"),
      ...this.info("mt"),
      tete: this.tete("acheteur", nom, ligne),
      band: this.bandeau("acheteur", nom, secs),
      secs,
      lay: {
        inner: wide ? "inner" : "tin",
        tickets: wide ? "tickets" : "tickets t2",
        yb: wide ? "yb" : "yb t",
        yl: wide ? "yl" : "yl t",
      },
      sources: sources(this.props.couverture, ["contrats", "avis"], true),
      cat: categorie(f),
      nom,
      lead: lead(f, C, nom),
      kpis,
      years,
      yearAlt: Y.length ? t("acheteur.annees_alt", { de: Y[0].y, a: Y[Y.length - 1].y }) : "",
      tempsPhrase,
      conTitre: t("acheteur.con_titre", { n: C.length }),
      rows,
      cols,
      mtNote: mt.join(" "),
      nEnts: t("n.entreprise", { n: entsAll.length }),
      sellers,
      colsV,
      ou,
      depLien: dep ? lienDepartement(dep, A.dep_nom ?? undefined) : "",
      aoSous: AO.length
        ? t("acheteur.ao_sous", {
            consultations: t("acheteur.n_consultation", { n: AO.length }),
            y: AO[0].d.slice(0, 4),
          })
        : t("acheteur.ao_aucune"),
      aos,
      colsA,
      docsPhrase: t("acheteur.docs_phrase", {
        contrats: count(C.length, "contrat"),
        mods: nMods,
        ao: AO.length,
      }),
      parcourir: `/registre/?${new URLSearchParams({ q: full })}`,
      lie,
      mob,
      det,
      quitter: this.quitter(),
    };
  }
}

async function donnees(r: Route): Promise<Record<string, unknown>> {
  if (r.view !== "acheteur") return {};
  const cv = couverture().catch(() => undefined);
  let f: FichierAcheteur;
  try {
    f = await load<FichierAcheteur>(`acheteur/${r.siren}.json`);
  } catch (e) {
    // a buyer the register does not hold has no file (404; the dev server answers its page
    // instead, not JSON): the page says « introuvable »
    if (e instanceof SyntaxError || /: 404$/.test(String((e as Error).message)))
      throw new Absent(r.siren);
    throw e;
  }
  // an intercommunality or a département: its territory's page, when the build holds it
  const d = departementAVerifier(f);
  const dep = d
    ? await load<FichierDepartement>(`departement/${encodeURIComponent(d)}.json`).catch(() => null)
    : null;
  const to = redirection(f, dep);
  if (to) {
    // a collectivité has one fiche, its territory's. The path is replaced (no new entry in the
    // history) and the router asked again: it draws the territory and drops this view unmounted.
    history.replaceState(null, "", `${to}${location.hash}`);
    dispatchEvent(new PopStateEvent("popstate"));
  }
  return { f, couverture: await cv };
}

export default {
  Vue: Acheteur as unknown as VueModule["Vue"],
  template,
  donnees,
} satisfies VueModule;
