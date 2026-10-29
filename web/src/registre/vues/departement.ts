// View 10 · Département (mockup Departement-grand.dc.html, the prototype's vues/departement.js): by
// intercommunality (a row unfolds on its communes; `?ic=<code>` opens one), every commune with a
// filter by name (accents ignored), who sells and who buys in it with the amount, each year. No map.
// From the build's departement/<code>.json: its figures only; a total adds `montant` of counted
// contracts (`compte`), never recomputed here. A département whose decrees are not collected says so
// and shows « — » instead of their figures: a missing figure is not zero.

import { etatDepartement } from "../collecte.ts";
import { communeHref } from "../commun.ts";
import { buyerHref, buyerNom, depGroup, entName, type Lexique } from "../corpus.ts";
import type { Couverture } from "../donnees.ts";
import { Absent, load } from "../donnees.ts";
import { fr, longDate, longMonth } from "../format.ts";
import { has, t } from "../i18n.ts";
import type { VueModule } from "../main.ts";
import type { Route } from "../routes.ts";
import { capital } from "../texte.ts";
import { type BaseState, type Col, Vue } from "../vue.ts";
import template from "./departement.html?raw";
import {
  annees,
  communes,
  type EtatCollecte,
  epciLa,
  type FichierDepartement,
  filtrer,
  intercommunalites,
  type Ligne,
  montant,
  noms,
  part,
  trier,
  vide,
} from "./departement-outils.ts";

type Props = { dep: string; f: FichierDepartement; ic: string };
type State = BaseState & {
  sortI: string;
  dirI: number;
  openI: string | null;
  sortC: string;
  dirC: number;
  q: string;
  allC: boolean;
  sortV: "n" | "amt";
  sortB: "n" | "amt";
  yt: "con" | "ao" | "cam";
};
type Detail = {
  kicker: string;
  title: string;
  rows: [string, string][];
  link?: [string, string];
};

const SHOWN = 15;
const nameFirst = (k: string) => (k === "nom" ? 1 : -1);
const SIREN = (s: string) => s.replace(/(\d{3})(\d{3})(\d{3})/, "$1 $2 $3");

class Departement extends Vue<Props, State> {
  private cache?: ReturnType<Departement["build"]>;

  protected init(p: Props): Partial<State> {
    return {
      sortI: "docs",
      dirI: -1,
      openI: p.ic && p.f.stats.epcis[p.ic] ? p.ic : null,
      sortC: "docs",
      dirC: -1,
      q: "",
      allC: false,
      sortV: "n",
      sortB: "n",
      yt: "con",
    };
  }

  titre(): string {
    return this.data().noms.nom;
  }

  componentDidMount(): void {
    if (!this.state.openI) return;
    // two frames: the router scrolls to the top in the next one
    requestAnimationFrame(() =>
      requestAnimationFrame(() =>
        document.getElementById("d-ic")?.scrollIntoView({ block: "start" }),
      ),
    );
  }

  private build() {
    const { f, dep } = this.props;
    const coms = communes(f);
    const L: Lexique = { entreprises: f.entreprises, acheteurs: f.acheteurs, communes: f.communes };
    return { coms, ics: intercommunalites(f, coms), L, noms: noms(dep, f.departement.nom) };
  }
  private data() {
    if (!this.cache) this.cache = this.build();
    return this.cache;
  }

  renderVals() {
    const S = this.state;
    const { f, dep } = this.props;
    const { coms, ics: IC, L, noms: N } = this.data();
    const st = f.stats.depStats;
    const couv = f.couverture;
    const col = couv.etat === "collecte";
    const etat = col ? "" : etatDepartement(dep, N.nom, couv);
    const sel = S.sel;
    const DET: Record<string, Detail> = {};
    const v = (n: number) => (col ? fr(n) : "—");
    const carte = (n: number | null) => (n == null ? "—" : fr(n));

    // the intercommunalities
    const ics = trier(IC, S.sortI, S.dirI).map((o) => {
      const ex = S.openI === o.code;
      const k = `i${o.code}`;
      DET[k] = {
        kicker: t("departement.k_intercommunalite"),
        title: o.nom,
        rows: [
          [t("departement.p_communes"), fr(o.n)],
          [t("departement.p_documents"), fr(o.docs)],
          [t("departement.p_contrats"), fr(o.con)],
          [t("departement.p_autorisations"), v(o.aut)],
          [t("departement.p_drones"), v(o.dr)],
          [t("departement.p_carte"), carte(o.cams)],
        ],
        link: o.acheteur ? [t("departement.voir_acheteur"), buyerHref(L, o.code)] : undefined,
      };
      return {
        nom: o.nom,
        n: fr(o.n),
        docs: fr(o.docs),
        con: fr(o.con),
        aut: v(o.aut),
        dr: v(o.dr),
        cams: carte(o.cams),
        cls: `r${sel === k || ex ? " on" : ""}`,
        ex: ex ? "true" : "false",
        arrow: ex ? "▾" : "▸",
        subStyle: ex ? "" : "display: none",
        subs: ex
          ? o.list
              .slice()
              .sort((a, b) => b.docs - a.docs || a.nom.localeCompare(b.nom, "fr"))
              .map((c) => ({
                nom: c.nom,
                href: communeHref(c.insee),
                v: t("departement.sub_docs", { n: c.docs }),
                hover: this.pick(`c${c.insee}`),
              }))
          : [],
        hover: this.pick(k),
        toggle: () => this.setState({ openI: ex ? null : o.code, sel: k }),
      };
    });
    const icCols = this.cols(
      [
        ["nom", t("departement.col_intercommunalite"), "", "width: 38%"],
        ["n", t("departement.col_communes"), "num"],
        ["docs", t("departement.col_documents"), "num"],
        ["con", t("departement.col_contrats"), "num"],
        ["aut", t("departement.col_autorisations"), "num"],
        ["dr", t("departement.col_drones"), "num"],
        ["cams", t("departement.col_carte"), "num"],
      ] as Col[],
      "sortI",
      "dirI",
      nameFirst,
    );

    // every commune, filtered by name
    for (const c of coms)
      DET[`c${c.insee}`] = {
        kicker: c.ep ? t("departement.k_commune_epci", { epci: c.ep }) : t("departement.k_commune"),
        title: c.nom,
        rows: [
          [t("departement.p_habitants"), c.pop ? fr(c.pop) : "—"],
          [t("departement.p_documents"), fr(c.docs)],
          [t("departement.p_contrats"), fr(c.con)],
          [t("departement.p_autorisations"), v(c.aut)],
          [t("departement.p_drones"), v(c.dr)],
          [t("departement.p_carte"), carte(c.cams)],
        ],
        link: [t("departement.voir_commune"), communeHref(c.insee)],
      };
    const q = S.q.trim();
    const filtered = trier(filtrer(coms, q), S.sortC, S.dirC);
    const shown = q || S.allC ? filtered : filtered.slice(0, SHOWN);
    const mxd = Math.max(1, ...coms.map((c) => c.docs));
    const epHref = (code: string) =>
      f.stats.epcis[code]?.acheteur
        ? buyerHref(L, code)
        : `/registre/departement/${dep}?ic=${encodeURIComponent(code)}#d-ic`;
    const comsV = shown.map((c) => ({
      nom: c.nom,
      ep: c.ep,
      epHref: c.epci ? epHref(c.epci) : "",
      docs: fr(c.docs),
      con: fr(c.con),
      aut: v(c.aut),
      dr: v(c.dr),
      cams: carte(c.cams),
      href: communeHref(c.insee),
      cls: `r${sel === `c${c.insee}` ? " on" : ""}`,
      hover: this.pick(`c${c.insee}`),
      bar: `display: inline-block; height: 10px; width: ${Math.max(2, Math.round(Math.sqrt(c.docs / mxd) * 110))}px; background: var(--blue)`,
    }));
    const comCols = this.cols(
      [
        ["nom", t("departement.col_commune"), "", "width: 34%"],
        ["docs", t("departement.col_documents"), "num"],
        ["con", t("departement.col_contrats"), "num"],
        ["aut", t("departement.col_autorisations"), "num"],
        ["dr", t("departement.col_drones"), "num"],
        ["cams", t("departement.col_carte"), "num"],
      ] as Col[],
      "sortC",
      "dirC",
      nameFirst,
    );
    const nC = coms.length;
    const comCount = q
      ? t("departement.com_trouvees", { n: filtered.length })
      : S.allC || nC <= SHOWN
        ? t("n.commune", { n: nC })
        : t("departement.com_sur", { k: SHOWN, communes: t("n.commune", { n: nC }) });

    // who sells, who buys: the contracts placed in the département
    const lignes = (rows: Ligne[], k: "n" | "amt") =>
      rows
        .slice()
        .sort((a, b) =>
          k === "n" ? b.n - a.n || b.montant - a.montant : b.montant - a.montant || b.n - a.n,
        )
        .slice(0, 10);
    const moneyRows = (o: Ligne): [string, string][] => [
      [t("departement.p_contrats_dans", { dans: N.dans }), fr(o.n)],
      [t("departement.p_montant"), montant(o)],
      ...(o.hors_totaux
        ? [[t("departement.p_hors_totaux"), fr(o.hors_totaux)] as [string, string]]
        : []),
    ];
    const sellers = lignes(f.stats.vendeurs, S.sortV).map((o) => {
      const k = `s${o.siren}`;
      const nom = entName(L, o.siren);
      const ei = !!L.entreprises[o.siren]?.entrepreneur_individuel;
      DET[k] = {
        kicker: ei
          ? t("departement.k_entreprise")
          : t("departement.k_entreprise_siren", { siren: SIREN(o.siren) }),
        title: nom,
        rows: moneyRows(o),
        link: [t("departement.voir_entreprise"), `/registre/entreprise/${o.siren}`],
      };
      return {
        nom,
        href: `/registre/entreprise/${o.siren}`,
        n: fr(o.n),
        amt: montant(o),
        cls: `r${sel === k ? " on" : ""}`,
        hover: this.pick(k),
      };
    });
    const heads = (cur: "n" | "amt", key: "sortV" | "sortB") =>
      (
        [
          ["n", t("departement.col_contrats")],
          ["amt", t("departement.col_montant")],
        ] as const
      ).map(([k, l]) => ({
        l,
        sort: cur === k ? "descending" : "none",
        arrow: cur === k ? "↓" : "",
        pick: () => this.setState({ [key]: k } as Partial<State>),
      }));
    const cat = (o: Ligne) => {
      const c = f.acheteurs[o.siren]?.categorie;
      if (o.centrale) return t("departement.cat_centrale");
      return c && has(`registre.departement.cat_${c}`)
        ? t(`departement.cat_${c}`)
        : t("departement.cat_acheteur");
    };
    const buyers = lignes(f.stats.acheteurs, S.sortB).map((o) => {
      const k = `b${o.siren}`;
      const commune = f.acheteurs[o.siren]?.categorie === "commune";
      DET[k] = {
        kicker: t("departement.k_acheteur", { cat: cat(o) }),
        title: buyerNom(L, o.siren),
        rows: moneyRows(o),
        link: [
          t(commune ? "departement.voir_commune" : "departement.voir_acheteur"),
          buyerHref(L, o.siren),
        ],
      };
      return {
        nom: buyerNom(L, o.siren),
        cat: cat(o),
        n: fr(o.n),
        amt: montant(o),
        href: buyerHref(L, o.siren),
        cls: `r${sel === k ? " on" : ""}`,
        hover: this.pick(k),
      };
    });

    // each year: nine, the last the build's, in progress; the decrees before their collection absent
    const yrs = annees(f.maj);
    const last = yrs[yrs.length - 1];
    const A = f.stats.annees;
    const y0col = (couv.depuis ?? "9999").slice(0, 4);
    const absent = (y: string) => S.yt === "cam" && (!col || y < y0col);
    const vals = yrs.map((y) => A[y]?.[S.yt] ?? 0);
    const mx = Math.max(1, ...vals.filter((_, i) => !absent(yrs[i])));
    const years = yrs.map((y, i) => {
      const k = `y${y}`;
      const fill = sel === k ? "var(--accent-fill)" : "var(--fg)";
      const o = A[y];
      const h = absent(y) ? 0 : Math.max(vals[i] ? 2 : 0, Math.round((vals[i] / mx) * 190));
      DET[k] = {
        kicker: t(y === last ? "departement.k_annee_en_cours" : "departement.k_annee"),
        title: y,
        rows: [
          [t("departement.p_contrats"), fr(o?.con ?? 0)],
          [t("departement.p_modifications"), fr(o?.mod ?? 0)],
          [t("departement.p_appels"), fr(o?.ao ?? 0)],
          [
            t("departement.p_autorisations"),
            !col || y < y0col ? t("departement.non_collectees") : fr(o?.cam ?? 0),
          ],
          [
            t("departement.p_drones"),
            !col || y < y0col ? t("departement.non_collectes") : fr(o?.dr ?? 0),
          ],
          [t("departement.p_subventions"), fr(o?.sub ?? 0)],
        ],
        link: [
          t("departement.documents_de", { y }),
          `/registre/?d=${depGroup(dep)}&y=${encodeURIComponent(y)}`,
        ],
      };
      return {
        y: y === last ? t("departement.annee_en_cours", { y }) : y,
        v: absent(y) ? "—" : fr(vals[i]),
        alt: absent(y)
          ? t("departement.annee_alt_absente", { y })
          : t("departement.annee_alt", { y, n: vals[i] }),
        hover: this.pick(k),
        bar: `display: block; height: ${h}px; background: ${
          y === last && h
            ? `repeating-linear-gradient(45deg, ${fill} 0 3px, transparent 3px 7px); border: 2px solid ${fill}; box-sizing: border-box`
            : fill
        }`,
      };
    });
    const yearTypes = (["con", "ao", "cam"] as const).map((k) => ({
      l: t(`departement.an_${k}`),
      pressed: S.yt === k ? "true" : "false",
      pick: () => this.setState({ yt: k }),
      style:
        S.yt === k
          ? "background: var(--fg); color: var(--bg)"
          : "background: var(--bg-2); color: var(--fg)",
    }));
    const aoAvant = Object.entries(A)
      .filter(([y]) => y < yrs[0])
      .reduce((s, [, o]) => s + o.ao, 0);
    const anNote = [
      col
        ? t("departement.an_note_collecte", { mois: longMonth(couv.depuis ?? f.maj) })
        : `${etat} ${t("departement.an_note_absente")}`,
      t("departement.an_note_en_cours", { y: last }),
      aoAvant ? t("departement.an_note_ao", { n: aoAvant, y: yrs[0] }) : "",
    ]
      .filter(Boolean)
      .join(" ");
    const conY0 = Object.keys(A).find((y) => A[y].con > 0) ?? yrs[0];

    // the lead, in the words of the 11th pass (« autorisations de caméras », « arrêtés de drones »)
    let lead: unknown[];
    if (col) {
      const top = IC.filter((o) => o.code).sort((a, b) => b.aut - a.aut || b.dr - a.dr)[0];
      const pa = top && st.cam ? part(top.aut / st.cam) : null;
      const pd = top && st.dr ? part(top.dr / st.dr) : null;
      lead = [
        t("departement.lead_depuis", { mois: longMonth(couv.depuis ?? f.maj) }),
        { strong: t("departement.n_autorisation", { n: st.cam }) },
        t("departement.lead_et"),
        { strong: t("departement.n_arrete_drone", { n: st.dr }) },
        t("departement.lead_dans", { dans: N.dans }),
        ...(pa
          ? [
              t("departement.lead_part", {
                parts: pd
                  ? t("departement.lead_parts", {
                      aut: t(`departement.part_aut_${pa}`),
                      dr: t(`departement.part_dr_${pd}`),
                    })
                  : t(`departement.part_aut_${pa}`),
              }),
              { strong: epciLa(top.nom) },
            ]
          : []),
        t("departement.lead_fin"),
      ];
    } else {
      const contrats = t("departement.n_contrat_video", { n: st.con, dans: N.dans });
      lead = !st.con
        ? [t("departement.lead_aucun_contrat", { dans: N.dans, etat })]
        : st.montant > 0
          ? [
              t("departement.lead_contrats_pour", { contrats, dans: N.dans }),
              { strong: montant({ montant: st.montant, hors_totaux: 0 }) },
              t("departement.lead_contrats_fin", { etat }),
            ]
          : [t("departement.lead_contrats", { contrats, dans: N.dans, etat })];
    }
    const kpis = [
      { v: fr(st.docs), l: t("departement.kpi_documents", { n: st.docs }) },
      { v: fr(st.con), l: t("departement.kpi_contrats", { n: st.con }) },
      { v: v(st.cam), l: t("departement.kpi_autorisations", { n: col ? st.cam : 2 }) },
      { v: v(st.dr), l: t("departement.kpi_drones", { n: col ? st.dr : 2 }) },
    ];
    const sous = [
      dep,
      t("departement.sous_communes", { communes: t("n.commune", { n: nC }) }),
      col
        ? t("departement.sous_collecte", { mois: longMonth(couv.depuis ?? f.maj) })
        : t(
            couv.etat === "impossible"
              ? "departement.sous_impossible"
              : "departement.sous_non_collecte",
          ),
    ].join(" · ");

    // the panel: the row hovered, focused or touched; the département at rest
    const d0 = sel ? DET[sel] : undefined;
    const det = d0
      ? {
          kicker: d0.kicker,
          title: d0.title,
          rows: d0.rows.map(([k, x]) => ({ k, v: x })),
          links: d0.link ? [{ l: d0.link[0], href: d0.link[1] }] : [],
        }
      : {
          kicker: capital(N.art),
          title: t("departement.repos_titre"),
          rows: [
            { k: t("departement.p_documents"), v: fr(st.docs) },
            { k: t("departement.p_communes"), v: fr(nC) },
            { k: t("departement.p_intercommunalites"), v: fr(IC.filter((o) => o.code).length) },
            { k: t("departement.p_sans_commune"), v: fr(st.sansCommune) },
            ...(col && couv.dernier_recueil
              ? [{ k: t("departement.p_dernier_recueil"), v: longDate(couv.dernier_recueil) }]
              : []),
          ],
          foot: etat,
          links: col ? [] : [{ l: t("departement.voir_couverture"), href: "/registre/couverture" }],
        };

    const sans = st.sansCommune;
    return {
      ...this.base("departement"),
      ...this.info("ic", "qui", "an"),
      fil: [{ l: t("commun.fil_registre"), href: "/registre/" }],
      filIci: N.nom,
      nom: N.nom,
      dans: N.dans,
      du: N.du,
      sous,
      lead,
      kpis,
      nIc: fr(IC.filter((o) => o.code).length),
      nCom: fr(nC),
      icNote: [
        t("departement.ic_note"),
        sans ? t("departement.ic_note_sans", { n: sans, du: N.du }) : "",
        t("departement.ic_note_carte"),
      ]
        .filter(Boolean)
        .join(" "),
      icCols,
      ics,
      noCom: nC === 0,
      comCols,
      coms: comsV,
      comCount,
      q: S.q,
      onQ: (e: { value: string }) => this.setState({ q: e.value }),
      showMore: !q && nC > SHOWN,
      noMatch: !!q && filtered.length === 0,
      more: () => this.setState({ allC: !S.allC }),
      moreLabel: S.allC ? t("departement.reduire") : t("departement.les_n_communes", { n: nC }),
      sellers,
      vCols: heads(S.sortV, "sortV"),
      buyers,
      bCols: heads(S.sortB, "sortB"),
      noMoney: f.stats.vendeurs.length === 0 && f.stats.acheteurs.length === 0,
      conY0,
      enveloppe: t("argent.enveloppe"),
      years,
      yearTypes,
      yearAlt: t("departement.annees_alt", {
        quoi: t(`departement.an_quoi_${S.yt}`),
        dans: N.dans,
        a: yrs[0],
        b: last,
      }),
      anNote,
      det,
    };
  }
}

async function donnees(r: Route): Promise<Record<string, unknown>> {
  const dep = r.view === "departement" ? r.dep : "";
  const ic = new URLSearchParams(location.search).get("ic") ?? "";
  let f: FichierDepartement;
  try {
    f = await load<FichierDepartement>(`departement/${encodeURIComponent(dep)}.json`);
  } catch (e) {
    // a département of the coverage with no document has no file (404; the dev server answers
    // its page instead, not JSON): its page says so all the same
    const couv = await load<Couverture & { departements: Record<string, EtatCollecte> }>(
      "couverture.json",
    );
    const row = couv.departements[dep];
    const absent = e instanceof SyntaxError || /: 404$/.test(String((e as Error).message));
    if (!absent) throw e;
    if (!row) throw new Absent(dep);
    f = vide(dep, couv.maj, row);
  }
  return { dep, f, ic };
}

export default {
  // the shell gives every view its route and its data as one record
  Vue: Departement as unknown as VueModule["Vue"],
  template,
  donnees,
} satisfies VueModule;
