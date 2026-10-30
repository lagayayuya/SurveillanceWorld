// View 9 · Acheteur (/registre/acheteur/<siren>; mockup Acheteur-grand, prototype vues/acheteur.js):
// its head and lead, the frieze of its contracts with its legend shown, the contracts' sortable
// table, who sells here, its calls for tenders, the buyer linked to it. Its file is the build's
// acheteur/<siren>.json; a commune buyer's path is its commune's page (the build's page_commune),
// replaced before anything is drawn. Amounts: a total adds the contracts the build counts (`compte`).

import { type RichItem, richText } from "../dc.ts";
import { Absent, load } from "../donnees.ts";
import { fr, money, moneyFull, shortDate, shortMonth } from "../format.ts";
import { t } from "../i18n.ts";
import type { VueModule } from "../modale.ts";
import type { Route } from "../routes.ts";
import { type BaseState, type Col, Vue } from "../vue.ts";
import template from "./acheteur.html?raw";
import {
  appels,
  buyerHref,
  buyerNom,
  type Contrat,
  categorie,
  contratHref,
  contrats,
  echelle,
  enCours,
  entHref,
  entName,
  type FichierAcheteur,
  fin,
  lead,
  redirection,
  rt,
  sirenSpaced,
  titreCourt,
  total,
  trier,
  vendeurs,
} from "./acheteur-outils.ts";

type Props = Extract<Route, { view: "acheteur" }> & { f: FichierAcheteur };
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

class Acheteur extends Vue<Props, State> {
  protected init(): Partial<State> {
    return { sort: "date", dir: 1, sortV: "amt", dirV: -1, sortA: "date", dirA: 1 };
  }
  titre(): string {
    return buyerNom(this.props.f, this.props.siren);
  }

  /** The companies of a contract, each a link: in the text's colour (« nom »), or bold as the
   * linked buyer's list shows them (« rowlink », the prototype's entA). */
  private ents(f: FichierAcheteur, sirens: string[], cls = "nom"): RichItem[] {
    if (!sirens.length) return [t("acheteur.ent_non_publiee")];
    return sirens.flatMap((s, i) => {
      const href = entHref(s);
      const a: RichItem = href ? { a: { href, text: entName(f, s), cls } } : entName(f, s);
      return i ? [" + ", a] : [a];
    });
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
    const names = (ss: string[]) => ss.map((s) => entName(f, s)).join(" + ");

    // the figures: the total is the counted contracts' (compte), the others said beside it
    const montantL = !T.comptes
      ? t("acheteur.kpi_aucun_compte")
      : T.hors.length && mixtes.length === T.hors.length
        ? t("acheteur.kpi_montant_hors_mixte", { n: mixtes.length })
        : T.hors.length
          ? t("acheteur.kpi_montant_hors", { n: T.hors.length })
          : t("acheteur.kpi_montant");
    const totalV = T.comptes ? money(T.montant) : "—";
    const kpis = [
      { v: fr(C.length), l: t("acheteur.kpi_contrats", { n: C.length }) },
      { v: fr(entsAll.length), l: t("acheteur.kpi_entreprises", { n: entsAll.length }) },
      { v: totalV, l: montantL },
      {
        v: fr(C.filter((c) => c.mods.length).length),
        l: t("acheteur.kpi_modifies", { n: C.filter((c) => c.mods.length).length }),
      },
    ];

    // the frieze: signature → planned end, the time a change added dashed, the notice, the changes
    const { y0: t0y, P } = echelle(
      [...C.map((c) => c.d), ...C.map((c) => c.avis?.date ?? "")],
      TODAY,
    );
    const gantt = C.map((c, i) => {
      const k = `c${i}`;
      const on = this.on(k);
      const col = on ? "var(--accent-fill)" : "var(--fg)";
      const end = fin(c, false);
      const end2 = c.d1 ? fin(c) : null;
      const a = P(c.d);
      // no published duration: a mark at the signature, not a bar to today
      const b = end ? P(end) : a;
      return {
        label: c.label,
        entH: this.ents(f, c.ents),
        amt: money(c.m0),
        href: contratHref(c.affaire),
        cls: `gl${on ? " on" : ""}`,
        bar: `position: absolute; top: 0; bottom: 0; left: ${a.toFixed(2)}%; width: ${Math.max(0.6, b - a).toFixed(2)}%; background: ${col}`,
        ext: end2
          ? `position: absolute; top: 0; bottom: 0; left: ${b.toFixed(2)}%; width: ${(P(end2) - b).toFixed(2)}%; border: 2px dashed ${col}; border-left: 0; box-sizing: border-box`
          : "display: none",
        avis: c.avis?.date
          ? `position: absolute; top: 2px; left: calc(${P(c.avis.date).toFixed(2)}% - 7px); width: 0; height: 0; border-left: 7px solid transparent; border-right: 7px solid transparent; border-bottom: 13px solid var(--ao)`
          : "display: none",
        mods: c.mods.map((d) => ({
          style: `position: absolute; top: -5px; bottom: -5px; left: ${P(d).toFixed(2)}%; width: 3px; background: var(--blue)`,
        })),
        hover: this.pick(k),
      };
    });
    for (const [i, c] of C.entries()) {
      const rows: [string, string][] = [
        [t("acheteur.entreprise"), names(c.ents) || t("acheteur.ent_non_publiee")],
        [t("acheteur.c_montant"), moneyFull(c.m0)],
      ];
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
        foot: [c.ref, c.avis?.ref ? t("acheteur.c_ao", { ref: c.avis.ref }) : ""]
          .filter(Boolean)
          .join(" · "),
        link: { l: t("acheteur.c_lien"), href: contratHref(c.affaire) },
      };
    }
    // on a phone the axis is a third as wide: a year keeps clear of « auj. » and of the left edge
    const wide = matchMedia("(min-width: 960px)").matches;
    const years: { l: string; style: string }[] = [];
    for (let y = t0y; y <= Number(TODAY.slice(0, 4)); y += 2) {
      const x = P(`${y}-01-01`);
      if (x < (wide ? 92 : 82))
        years.push({
          l: String(y),
          style: `position: absolute; top: 4px; left: ${x.toFixed(2)}%; transform: translateX(${x < 4 ? "0" : "-50%"})`,
        });
    }
    years.push({
      l: t("acheteur.auj"),
      style: "position: absolute; top: 4px; right: 0; color: var(--fg)",
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
          lie: { a: { href: "#lie", text: buyerNom(f, A.lie) } },
        }),
      );
    }

    // the contracts' table, sortable
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
        objet: c.label,
        mixte: c.mixte,
        ents: c.ents.map((s) => ({ nom: entName(f, s), href: entHref(s) })),
        href: contratHref(c.affaire),
        amt: moneyFull(c.m0),
        amt2: c.m1 ? t("acheteur.apres_modif", { eur: moneyFull(c.m1) }) : "",
        dur: this.dur(c) || "—",
        off: c.off == null ? t("format.non_publie") : fr(c.off),
        cls: `r${this.on(`c${i}`) ? " on" : ""}`,
        hover: this.pick(`c${i}`),
      };
    });
    const first = (k: string) => (NUM.has(k) ? -1 : 1);
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

    // who sells here: the counted amounts, the contracts out of the total and the shared ones said
    const SE = vendeurs(C);
    const mxs = Math.max(1, ...SE.map((x) => x.montant));
    const notes = SE.map((x) => {
      const parts: RichItem[][] = [];
      const mix = x.hors.filter((c) => c.mixte);
      if (mix.length === 1 && x.hors.length === 1)
        parts.push([t("acheteur.vend_mixte", { objet: mix[0].label })]);
      else if (x.hors.length) parts.push([t("acheteur.vend_hors", { n: x.hors.length })]);
      if (x.partages.length) {
        const avec = this.ents(f, x.avec).map((r) => (r === " + " ? ", " : r));
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
      DET[k] = {
        kicker: t("acheteur.entreprise"),
        title: entName(f, x.s),
        rows: rowsS,
        foot: t("acheteur.s_foot"),
        link: entHref(x.s) ? { l: t("acheteur.s_lien"), href: entHref(x.s) as string } : undefined,
      };
      return {
        nom: entName(f, x.s),
        href: entHref(x.s),
        n: fr(x.n),
        amt: x.montant ? money(x.montant) : "—",
        note,
        bar: `display: inline-block; height: 10px; width: ${x.montant ? Math.max(3, Math.round((x.montant / mxs) * (wide ? 160 : 60))) : 0}px; background: var(--blue)`,
        cls: `r${this.on(k) ? " on" : ""}`,
        hover: this.pick(k),
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

    // the calls for tenders: those of its contracts, and those no contract was found for
    const AO = appels(f, C);
    const aoRows = AO.map((a, i) => {
      const k = `o${i}`;
      const contrat = a.contrat ? `${shortMonth(a.dContrat)} · ${names(a.ents)}` : "";
      const manque = a.d >= RECENT ? t("acheteur.pas_encore_publie") : t("acheteur.non_retrouve");
      DET[k] = {
        kicker: t("acheteur.o_kicker", { date: shortDate(a.d) }),
        title: a.objet,
        rows: [
          [t("acheteur.publications"), a.refs || "—"],
          [
            t("acheteur.contrat"),
            contrat ? (a.probable ? `${contrat} (${t("repere.lien")})` : contrat) : manque,
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
      objet: x.a.objet,
      refs: x.a.refs,
      contrat: x.contrat,
      chref: x.a.contrat ? contratHref(x.a.contrat) : "",
      href: x.a.href,
      found: !!x.contrat,
      missing: !x.contrat,
      probable: x.a.probable,
      manque: x.manque,
      cls: `r${this.on(x.k) ? " on" : ""}`,
      hover: this.pick(x.k),
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

    // the linked buyer
    const lie =
      A.lie && LC.length
        ? {
            nom: buyerNom(f, A.lie),
            href: buyerHref(f, A.lie),
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
      objet: c.label,
      ent: this.ents(f, c.ents, "rowlink"),
      amt: money(c.m0),
    }));

    const tabs = [
      ["#temps", t("acheteur.tab_temps")],
      ["#contrats", t("acheteur.tab_contrats", { n: fr(C.length) })],
      ["#vend", t("acheteur.tab_vend", { n: fr(entsAll.length) })],
      ["#ao", t("acheteur.tab_ao", { n: fr(AO.length) })],
      ...(lie ? [["#lie", lie.nom]] : []),
    ].map(([href, l], i) => ({ href, l, cur: i === 0 ? "page" : null }));

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

    const d0 = S.sel ? DET[S.sel] : undefined;
    const det = d0
      ? {
          kicker: d0.kicker,
          title: d0.title,
          rows: d0.rows.map(([k, v]) => ({ k, v })),
          foot: d0.foot,
          links: d0.link ? [d0.link] : [],
        }
      : {
          kicker: t("acheteur.acheteur", { cat: categorie(f) }),
          title: nom,
          rows: [
            { k: t("acheteur.p_contrats"), v: fr(C.length) },
            { k: t("acheteur.p_entreprises"), v: fr(entsAll.length) },
            { k: t("acheteur.col_montant"), v: totalV },
            ...(C.length
              ? [
                  { k: t("acheteur.p_premier"), v: shortDate(C[0].d) },
                  { k: t("acheteur.p_dernier"), v: shortDate(C[C.length - 1].d) },
                ]
              : []),
          ],
          foot: t("acheteur.p_survol"),
          links: [],
        };

    const dep = A.dep ?? "";
    const siege = A.insee_siege ? f.communes[A.insee_siege]?.nom : "";
    const sous = [
      A.nom && A.nom !== nom && A.nom !== full ? A.nom : "",
      t("acheteur.sous_siren", { siren: sirenSpaced(siren) }),
      siege ? t("acheteur.sous_siege", { commune: siege, dep: A.dep_nom ?? dep }) : "",
    ]
      .filter(Boolean)
      .join(" · ");

    return {
      ...this.base("acheteur"),
      ...this.info("tps", "mt"),
      fil: [
        { l: t("commun.fil_registre"), href: "/registre/" },
        ...(dep ? [{ l: A.dep_nom ?? dep, href: `/registre/departement/${dep}` }] : []),
      ],
      filIci: nom,
      cat: categorie(f),
      nom,
      sous,
      lead: lead(f, C, nom),
      kpis,
      tabs,
      gantt,
      years,
      tempsPhrase,
      conTitre: t("acheteur.con_titre", { n: C.length }),
      rows,
      cols,
      mtNote: mt.join(" "),
      nEnts: t("n.entreprise", { n: entsAll.length }),
      sellers,
      colsV,
      aoSous: AO.length
        ? t("acheteur.ao_sous", {
            consultations: t("acheteur.n_consultation", { n: AO.length }),
            y: AO[0].d.slice(0, 4),
          })
        : t("acheteur.ao_aucune"),
      aos,
      colsA,
      lie,
      mob,
      det,
    };
  }
}

async function donnees(r: Route): Promise<Record<string, unknown>> {
  if (r.view !== "acheteur") return {};
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
  const to = redirection(f);
  if (to) {
    // a commune buys for itself: its page is the commune's. The path is replaced (no new entry in
    // the history) and the router asked again: it draws the commune and drops this view unmounted.
    history.replaceState(null, "", `${to}${location.hash}`);
    dispatchEvent(new PopStateEvent("popstate"));
  }
  return { f };
}

export default {
  Vue: Acheteur as unknown as VueModule["Vue"],
  template,
  donnees,
} satisfies VueModule;
