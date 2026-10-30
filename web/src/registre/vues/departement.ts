// View 10 · Département and intercommunalité (/registre/departement/<code>, `?ic=<epci>` for an
// intercommunality; content: mockup Departement-grand, the prototype's vues/departement.js; frame:
// design/registre/v2, V2-Entreprise): a territory's fiche on the skeleton — L'essentiel, Dans le
// temps, Avec qui, Documents, Sources. A collectivité has one fiche: its territory and its own
// purchases (its buyer's file, when it signed a contract) together; its buyer's path comes here.
// From the build's departement/<code>.json: its figures only (no document); a total adds `montant`
// of counted contracts (`compte`), never recomputed here. A département whose decrees are not
// collected says so and shows « — » instead of their figures: a missing figure is not zero.

import { etatDepartement } from "../collecte.ts";
import { depGroup, type Lexique, buyerNom as nomAcheteur } from "../corpus.ts";
import type { Handler, RichItem } from "../dc.ts";
import type { Couverture } from "../donnees.ts";
import { Absent, load } from "../donnees.ts";
import { count, fr, longMonth, money, moneyFull, shortDate } from "../format.ts";
import { has, t } from "../i18n.ts";
import {
  departementHref,
  lien,
  lienAcheteur,
  lienCommune,
  lienDepartement,
  lienDocument,
  lienEntreprise,
} from "../liens.ts";
import type { Miette, VueModule } from "../modale.ts";
import type { Route } from "../routes.ts";
import { couverture, sources } from "../sources.ts";
import { capital } from "../texte.ts";
import { pluriel } from "../types.ts";
import { type BaseState, type Col, large, type Partage, partageDe, Vue } from "../vue.ts";
import {
  appels,
  buyerNom,
  type Contrat,
  contrats,
  type FichierAcheteur,
  lexique,
  parAnnee,
  titreCourt,
  total,
  vendeurs,
} from "./acheteur-outils.ts";
import "./departement.css";
import template from "./departement.html?raw";
import {
  achatsPropres,
  aides,
  annees,
  type ComRow,
  communes,
  type EtatCollecte,
  enLigne,
  epciDe,
  epciHref,
  epciLa,
  type FichierDepartement,
  filtrer,
  intercommunalites,
  type Ligne,
  lienEpci,
  montant,
  noms,
  part,
  sourcesIds,
  trier,
  typeDe,
  vide,
} from "./departement-outils.ts";

type Props = {
  dep: string;
  f: FichierDepartement;
  ic: string;
  achats: FichierAcheteur[];
  couverture?: Couverture;
};
type State = BaseState & {
  sortI: string;
  dirI: number;
  sortC: string;
  dirC: number;
  q: string;
  allC: boolean;
  sortV: "n" | "amt";
  sortB: "n" | "amt";
  yt: "con" | "ao" | "cam";
  allD: boolean;
};
type Detail = {
  kicker: string;
  title: string;
  rows: [string, string][];
  /** rows that name a company or a territory: rich, each mention a link */
  corr?: [string, RichItem[]][];
  link?: [string, string];
  foot?: string;
};

const SHOWN = 15;
const DOCS = 8;
const nameFirst = (k: string) => (k === "nom" ? 1 : -1);
const SIREN = (s: string) => s.replace(/(\d{3})(\d{3})(\d{3})/, "$1 $2 $3");
const TODAY = new Date().toISOString().slice(0, 10);
// one colour for the measure: a territory's own colour is yellow, so its measure is the ink, as a
// commune's (DECISIONS 2026-10-30); the mark chosen is full of ink with a thick outline (v2.1: yellow
// never says the selection), the outline the kit's (cadre.css .yb)
const BAR = "var(--fg)";
const ON = "var(--fg)";
/** An amount in millions, one decimal, as the bars write them; below 100 000 € in euros. */
const meur = (n: number): string =>
  !n ? "—" : n < 1e5 ? money(n) : t("format.meur", { n: (n / 1e6).toFixed(1).replace(".", ",") });

/** A contract of the territory's own purchases, with the buyer file that holds it. */
type Achat = { c: Contrat; f: FichierAcheteur };

class Departement extends Vue<Props, State> {
  private cache?: ReturnType<Departement["build"]>;

  protected init(): Partial<State> {
    return {
      sortI: "docs",
      dirI: -1,
      sortC: "docs",
      dirC: -1,
      q: "",
      allC: false,
      sortV: "n",
      sortB: "n",
      yt: "con",
      allD: false,
    };
  }

  private build() {
    const { f, dep, ic: asked, achats } = this.props;
    const ic = epciDe(f, asked);
    const coms = communes(f);
    const L: Lexique = { entreprises: f.entreprises, acheteurs: f.acheteurs, communes: f.communes };
    const IC = intercommunalites(f, coms);
    const N = noms(dep, f.departement.nom);
    // its own purchases: every contract of its buyer files, the most recent first
    const A: Achat[] = achats
      .flatMap((x) => contrats(x, x.stats).map((c) => ({ c, f: x })))
      .sort((a, b) => b.c.d.localeCompare(a.c.d));
    const ep = ic ? IC.find((o) => o.code === ic) : undefined;
    return { ic, coms, L, IC, N, A, ep };
  }
  private data() {
    if (!this.cache) this.cache = this.build();
    return this.cache;
  }

  titre(): string {
    const { N, ep } = this.data();
    return ep ? ep.nom : N.nom;
  }
  type() {
    return this.data().ic ? ("epci" as const) : ("departement" as const);
  }
  /** Registre › Départements › <département> (› <intercommunalité>, the page itself). */
  fil(): Miette[] {
    const { ic, N } = this.data();
    return [
      { k: "registre", l: t("types.registre.l"), href: "/registre/" },
      { k: "departement", l: pluriel("departement"), href: "/registre/" },
      ...(ic
        ? [{ k: "departement" as const, l: N.nom, href: departementHref(this.props.dep) }]
        : []),
    ];
  }
  partage(): Partage | null {
    return partageDe(this.titre(), this.props.f.partage);
  }

  renderVals() {
    const S = this.state;
    const { f, dep } = this.props;
    const { ic, coms: allComs, L, IC, N, A, ep } = this.data();
    const st = f.stats.depStats;
    const couv = f.couverture;
    const col = couv.etat === "collecte";
    const etat = col ? "" : etatDepartement(dep, N.nom, couv);
    const DET: Record<string, Detail> = {};
    const v = (n: number) => (col ? fr(n) : "—");
    const carte = (n: number | null) => (n == null ? "—" : fr(n));
    const wide = large();
    const nom = ep ? ep.nom : N.nom;
    // the communes of the fiche: the intercommunality's, or every one of the département
    const coms = ep ? ep.list : allComs;

    // --- Avec qui: the intercommunalities (the département's fiche), each a link to its fiche
    const ics = ic
      ? []
      : trier(IC, S.sortI, S.dirI).map((o) => {
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
            link: o.code
              ? [t("departement.voir_intercommunalite"), epciHref(dep, o.code)]
              : undefined,
          };
          return {
            nom: o.code ? lienEpci(f, o.code, o.nom, true) : o.nom,
            n: fr(o.n),
            docs: fr(o.docs),
            con: fr(o.con),
            aut: v(o.aut),
            dr: v(o.dr),
            cams: carte(o.cams),
            ...this.ligne(k, "epci"),
          };
        });
    const icCols = aides(
      this.cols(
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
      ),
      [
        undefined,
        t("departement.aide_communes"),
        t("departement.aide_documents"),
        t("departement.aide_contrats"),
        t("departement.aide_autorisations"),
        t("departement.aide_drones"),
        t("departement.aide_carte"),
      ],
    );

    // --- every commune, filtered by name; each a link, its intercommunality a link under it
    for (const c of coms)
      DET[`c${c.insee}`] = {
        kicker: t("departement.k_commune"),
        title: c.nom,
        rows: [
          [t("departement.p_habitants"), c.pop ? fr(c.pop) : "—"],
          [t("departement.p_documents"), fr(c.docs)],
          [t("departement.p_contrats"), fr(c.con)],
          [t("departement.p_autorisations"), v(c.aut)],
          [t("departement.p_drones"), v(c.dr)],
          [t("departement.p_carte"), carte(c.cams)],
        ],
        // its intercommunality, a link to its fiche (the panel's rich line)
        corr: c.epci
          ? [[t("departement.k_intercommunalite"), [lienEpci(f, c.epci, c.ep, true)]]]
          : undefined,
        link: [t("departement.voir_commune"), `/registre/commune/${c.insee}`],
      };
    const q = S.q.trim();
    const filtered = trier(filtrer(coms, q), S.sortC, S.dirC);
    const shown = q || S.allC ? filtered : filtered.slice(0, SHOWN);
    const mxd = Math.max(1, ...coms.map((c) => c.docs));
    const comsV = shown.map((c: ComRow) => ({
      nom: lienCommune(L, c.insee, c.nom, true),
      // on an intercommunality's fiche its own name is not repeated under each commune
      ep: c.epci && !ic ? lienEpci(f, c.epci, c.ep, true) : "",
      docs: fr(c.docs),
      con: fr(c.con),
      aut: v(c.aut),
      dr: v(c.dr),
      cams: carte(c.cams),
      ...this.ligne(`c${c.insee}`, "commune"),
      // linear (R1's was a square root, a hidden scale: v2 § 8)
      bar: `display: inline-block; height: 10px; width: ${Math.max(2, Math.round((c.docs / mxd) * 110))}px; background: ${this.on(`c${c.insee}`) ? ON : BAR}; border: 1px solid #111`,
    }));
    const comCols = aides(
      this.cols(
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
      ),
      [
        undefined,
        t("departement.aide_documents"),
        t("departement.aide_contrats"),
        t("departement.aide_autorisations"),
        t("departement.aide_drones"),
        t("departement.aide_carte"),
      ],
    );
    const nC = coms.length;
    const comCount = q
      ? t("departement.com_trouvees", { n: filtered.length })
      : S.allC || nC <= SHOWN
        ? t("n.commune", { n: nC })
        : t("departement.com_sur", { k: SHOWN, communes: t("n.commune", { n: nC }) });

    // --- who sells, who buys: the contracts placed in the département (its fiche)
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
    /** A link's address, when the mention is one (a sole trader's is not). */
    const hrefDe = (x: RichItem): string | undefined =>
      typeof x === "object" && "a" in x ? x.a.href : undefined;
    const sellers = ic
      ? []
      : lignes(f.stats.vendeurs, S.sortV).map((o) => {
          const k = `s${o.siren}`;
          const lk = lienEntreprise(L, o.siren);
          const ei = !!L.entreprises[o.siren]?.entrepreneur_individuel;
          const href = hrefDe(lk);
          DET[k] = {
            kicker: ei
              ? t("departement.k_entreprise")
              : t("departement.k_entreprise_siren", { siren: SIREN(o.siren) }),
            title: typeof lk === "object" && "a" in lk ? String(lk.a.text) : String(lk),
            rows: moneyRows(o),
            link: href ? [t("departement.voir_entreprise"), href] : undefined,
          };
          return {
            nom: enLigne(lk),
            n: fr(o.n),
            amt: montant(o),
            ...this.ligne(k, "entreprise"),
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
        ac: k === "amt" ? "aide" : "",
        aide: k === "amt" ? t("departement.aide_montant") : "",
        sort: cur === k ? "descending" : "none",
        arrow: cur === k ? "↓" : "",
        pick: (() => this.setState({ [key]: k } as Partial<State>)) as Handler,
      }));
    const cat = (o: Ligne) => {
      const c = f.acheteurs[o.siren]?.categorie;
      if (o.centrale) return t("departement.cat_centrale");
      return c && has(`registre.departement.cat_${c}`)
        ? t(`departement.cat_${c}`)
        : t("departement.cat_acheteur");
    };
    // a buyer named here: the département itself is not a link to its own fiche, an
    // intercommunality with its row links to its fiche, any other buyer to its own
    const propres = new Set(achatsPropres(f, ""));
    const lienBuyer = (s: string): RichItem =>
      propres.has(s)
        ? { strong: nomAcheteur(L, s) }
        : f.stats.epcis[s]
          ? lienEpci(f, s, nomAcheteur(L, s))
          : lienAcheteur(L, s);
    const buyers = ic
      ? []
      : lignes(f.stats.acheteurs, S.sortB).map((o) => {
          const k = `b${o.siren}`;
          const lk = lienBuyer(o.siren);
          const href = hrefDe(lk);
          DET[k] = {
            kicker: t("departement.k_acheteur", { cat: cat(o) }),
            title: nomAcheteur(L, o.siren),
            rows: moneyRows(o),
            link: href
              ? [
                  t(
                    href.startsWith("/registre/commune/")
                      ? "departement.voir_commune"
                      : f.stats.epcis[o.siren]
                        ? "departement.voir_intercommunalite"
                        : "departement.voir_acheteur",
                  ),
                  href,
                ]
              : undefined,
          };
          return {
            nom: enLigne(lk),
            cat: cat(o),
            n: fr(o.n),
            amt: montant(o),
            ...this.ligne(k, typeDe(lk)),
          };
        });

    // --- its own purchases (an intercommunality's, a département's buyer files)
    const C = A.map((a) => a.c);
    const T = total(C);
    const nomPropre = (x: FichierAcheteur) => titreCourt(buyerNom(x, x.acheteur.siren));
    for (const [i, a] of A.entries())
      DET[`a${i}`] = {
        kicker: t("departement.k_achat", { date: shortDate(a.c.d) }),
        title: a.c.objet,
        rows: [
          [t("departement.p_acheteur"), nomPropre(a.f)],
          [t("departement.p_montant"), moneyFull(a.c.m0)],
          [t("departement.p_offres"), a.c.off == null ? t("format.non_publie") : fr(a.c.off)],
        ],
        // its companies, each a link (the panel's rich line)
        corr: [
          [
            t("departement.p_entreprises"),
            a.c.ents.length
              ? a.c.ents.flatMap((s, j) => {
                  const lk = lienEntreprise(lexique(a.f), s);
                  return j ? [" + ", lk] : [lk];
                })
              : [t("acheteur.ent_non_publiee")],
          ],
        ],
        link: [
          t("departement.voir_contrat"),
          `/registre/contrat/${encodeURIComponent(a.c.affaire)}`,
        ],
      };
    const docs = (S.allD ? A : A.slice(0, DOCS)).map((a, i) => {
      const k = `a${i}`;
      const lx = lexique(a.f);
      return {
        ...this.ligne(k, "con", "drow r"),
        d: shortDate(a.c.d),
        objet: lienDocument(lx, a.c.e, a.c.label, true),
        ents: a.c.ents.length
          ? a.c.ents.flatMap((s, j) =>
              j ? [" + ", lienEntreprise(lx, s)] : [lienEntreprise(lx, s)],
            )
          : [t("acheteur.ent_non_publiee")],
        amt: money(a.c.m0),
      };
    });
    // its calls for tenders (its buyer files'): those of its contracts and those no contract was
    // found for, each a link to its record, the contract that followed a link too
    const { achats } = this.props;
    const AO = achats
      .flatMap((x) => appels(x, contrats(x, x.stats)).map((o) => ({ o, f: x })))
      .sort((a, b) => b.o.d.localeCompare(a.o.d));
    const RECENT = (() => {
      const d = new Date();
      d.setUTCMonth(d.getUTCMonth() - 18);
      return d.toISOString().slice(0, 10);
    })();
    const aos = AO.map(({ o, f: x }, i) => {
      const k = `o${i}`;
      const lx = lexique(x);
      const suite: RichItem[] = o.contrat
        ? [
            lien(
              "con",
              `/registre/contrat/${encodeURIComponent(o.contrat)}`,
              shortDate(o.dContrat),
              true,
            ),
            ...o.ents.flatMap((s) => [" · ", lienEntreprise(lx, s)]),
          ]
        : [o.d >= RECENT ? t("acheteur.pas_encore_publie") : t("acheteur.non_retrouve")];
      DET[k] = {
        kicker: t("acheteur.o_kicker", { date: shortDate(o.d) }),
        title: o.objet,
        rows: [[t("acheteur.publications"), o.refs || "—"]],
        corr: [[t("acheteur.contrat"), suite]],
        link: [t("departement.voir_appel"), o.href],
      };
      return {
        ...this.ligne(k, "ao", "drow r"),
        d: shortDate(o.d),
        objet: lien("ao", o.href, o.objet, true),
        suite,
      };
    });
    // who sold to the intercommunality (its own purchases): each company a link
    const SE = ic && A.length ? vendeurs(C) : [];
    const ventes = SE.map((x, i) => {
      const k = `v${i}`;
      const fx = A.find((a) => a.c.ents.includes(x.s))?.f ?? A[0].f;
      const lk = lienEntreprise(lexique(fx), x.s);
      const href = hrefDe(lk);
      DET[k] = {
        kicker: t("departement.k_entreprise"),
        title: buyerEnt(fx, x.s),
        rows: [
          [t("departement.p_contrats_avec", { nom }), fr(x.n)],
          [t("departement.p_montant"), x.montant ? moneyFull(x.montant) : "—"],
        ],
        link: href ? [t("departement.voir_entreprise"), href] : undefined,
      };
      return {
        nom: enLigne(lk),
        n: fr(x.n),
        amt: x.montant ? money(x.montant) : "—",
        ...this.ligne(k, "entreprise"),
      };
    });

    // --- Dans le temps. The département: its documents each year, one kind at a time (R1's,
    // recoloured); the decrees before their collection absent. An intercommunality: the planned
    // amount of the contracts it signed each year (the build has no yearly figures of its
    // territory: lot R3)
    const yrs = annees(f.maj);
    const last = yrs[yrs.length - 1];
    const AN = f.stats.annees;
    const y0col = (couv.depuis ?? "9999").slice(0, 4);
    const absent = (y: string) => S.yt === "cam" && (!col || y < y0col);
    const vals = yrs.map((y) => AN[y]?.[S.yt] ?? 0);
    const mx = Math.max(1, ...vals.filter((_, i) => !absent(yrs[i])));
    const years = ic
      ? []
      : yrs.map((y, i) => {
          const k = `y${y}`;
          const on = this.on(k);
          const fill = on ? ON : BAR;
          const o = AN[y];
          const h = absent(y) ? 0 : Math.max(vals[i] ? 3 : 0, Math.round((vals[i] / mx) * 150));
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
            label: absent(y)
              ? t("departement.annee_alt_absente", { y })
              : t("departement.annee_alt", { y, n: vals[i] }),
            on: String(on),
            hover: this.survol(k),
            pick: this.choisir(k),
            // the year in progress hatched, its one mark (« * » under it says so)
            bar: !h
              ? "height: 0; border-width: 0"
              : y === last
                ? `height: ${h}px; background: repeating-linear-gradient(45deg, ${fill} 0 3px, transparent 3px 7px)`
                : `height: ${h}px; background: ${fill}`,
          };
        });
    const yearTypes = (["con", "ao", "cam"] as const).map((k) => ({
      l: t(`departement.an_${k}`),
      pressed: S.yt === k ? "true" : "false",
      pick: (() => this.setState({ yt: k })) as Handler,
    }));
    const aoAvant = Object.entries(AN)
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
    const conY0 = Object.keys(AN).find((y) => AN[y].con > 0) ?? yrs[0];
    // the intercommunality's own purchases, by year
    const Y = ic ? parAnnee(C, Number(TODAY.slice(0, 4))) : [];
    const mxa = Math.max(1, ...Y.map((y) => y.montant));
    const achatsAn = Y.map((a) => {
      const k = `y${a.y}`;
      const on = this.on(k);
      DET[k] = {
        kicker: t("departement.k_annee"),
        title: a.y,
        rows: [
          [t("departement.p_contrats"), fr(a.cs.length)],
          [t("departement.p_montant"), a.montant ? money(a.montant) : "—"],
        ],
      };
      return {
        y: a.y,
        v: Y.length <= 12 ? meur(a.montant) : "",
        n: count(a.cs.length, "contrat"),
        label: t("departement.achat_annee_label", { y: a.y, v: meur(a.montant), n: a.cs.length }),
        on: String(on),
        hover: this.survol(k),
        pick: this.choisir(k),
        bar: a.montant
          ? `height: ${Math.max(3, Math.round((a.montant / mxa) * 150))}px; background: ${on ? ON : BAR}`
          : "height: 0; border-width: 0",
      };
    });

    // --- L'essentiel
    let lead: RichItem[];
    if (ic && ep) {
      lead = [
        t("departement.ic_lead", { n: ep.n }),
        {
          strong: col
            ? t("departement.n_autorisation", { n: ep.aut })
            : t("departement.autorisations_nc"),
        },
        t("departement.lead_et"),
        { strong: t("departement.n_contrat_video", { n: ep.con, dans: "" }).trim() },
        t("departement.lead_fin"),
      ];
      if (C.length)
        lead.push(
          " ",
          t("departement.ic_achats", {
            nom: capital(epciLa(ep.nom)),
            contrats: count(C.length, "contrat"),
          }),
        );
    } else if (col) {
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
              { strong: [lienEpci(f, top.code, epciLa(top.nom))] },
            ]
          : []),
        t("departement.lead_fin"),
      ];
    } else {
      const contrats_ = t("departement.n_contrat_video", { n: st.con, dans: N.dans });
      lead = !st.con
        ? [t("departement.lead_aucun_contrat", { dans: N.dans, etat })]
        : st.montant > 0
          ? [
              t("departement.lead_contrats_pour", { contrats: contrats_, dans: N.dans }),
              { strong: montant({ montant: st.montant, hors_totaux: 0 }) },
              t("departement.lead_contrats_fin", { etat }),
            ]
          : [t("departement.lead_contrats", { contrats: contrats_, dans: N.dans, etat })];
    }
    // caméras (their authorisations), arrêtés (of drones), contrats, montants
    const kpis =
      ic && ep
        ? [
            { v: v(ep.aut), l: t("departement.kpi_autorisations", { n: col ? ep.aut : 2 }) },
            { v: v(ep.dr), l: t("departement.kpi_drones", { n: col ? ep.dr : 2 }) },
            { v: fr(ep.con), l: t("departement.kpi_contrats", { n: ep.con }) },
            ...(C.length
              ? [
                  {
                    v: T.comptes ? money(T.montant) : "—",
                    l: t("departement.kpi_montant_achats", { n: C.length }),
                  },
                ]
              : [{ v: carte(ep.cams), l: t("departement.kpi_carte") }]),
          ]
        : [
            { v: v(st.cam), l: t("departement.kpi_autorisations", { n: col ? st.cam : 2 }) },
            { v: v(st.dr), l: t("departement.kpi_drones", { n: col ? st.dr : 2 }) },
            { v: fr(st.con), l: t("departement.kpi_contrats", { n: st.con }) },
            {
              v: st.montant > 0 ? money(st.montant) : "—",
              l: t("departement.kpi_montant"),
            },
          ];
    const etatLigne = col
      ? t("departement.sous_collecte", { mois: longMonth(couv.depuis ?? f.maj) })
      : t(
          couv.etat === "impossible"
            ? "departement.sous_impossible"
            : "departement.sous_non_collecte",
        );
    const ligne: RichItem[] =
      ic && ep
        ? [
            t("departement.ic_sous", { siren: SIREN(ic) }),
            " · ",
            t("departement.sous_communes", { communes: t("n.commune", { n: ep.n }) }),
            " · ",
            lienDepartement(dep, N.nom),
          ]
        : [
            dep,
            " · ",
            t("departement.sous_communes", { communes: t("n.commune", { n: nC }) }),
            " · ",
            etatLigne,
          ];

    // --- the panel: the row hovered or focused, else the one chosen (A3); at rest, what to choose
    const vu = this.affiche();
    const d0 = vu ? DET[vu] : undefined;
    const det = d0
      ? {
          kicker: d0.kicker,
          title: d0.title,
          rows: d0.rows.map(([k, x]) => ({ k, v: x })),
          corr: (d0.corr ?? []).map(([k, x]) => ({ k, v: x })),
          links: d0.link ? [{ l: d0.link[0], href: d0.link[1] }] : [],
          foot: d0.foot ?? "",
        }
      : {
          // at rest: what to hover or choose, never the figures beside it (B3)
          kicker: t("departement.det_detail"),
          title: t("departement.repos_titre"),
          rows: [],
          corr: [],
          links: [],
          foot: "",
        };

    const sans = st.sansCommune;
    const nDocs = ic && ep ? ep.docs : st.docs;
    const secs = this.sections({
      essentiel: true,
      temps: ic ? Y.length > 0 : true,
      avecqui: nC > 0 || sellers.length > 0 || buyers.length > 0 || ventes.length > 0,
      // an intercommunality without a contract or a notice of its own: its documents are its
      // communes' (their fiches, listed above), no section of their own
      documents: ic ? A.length > 0 || aos.length > 0 : nDocs > 0 || A.length > 0 || aos.length > 0,
      sources: true,
    });
    const k = ic ? ("epci" as const) : ("departement" as const);
    return {
      ...this.base("departement"),
      ...this.info("ic", "qui", "an"),
      tete: this.tete(k, nom, ligne),
      band: this.bandeau(k, nom, secs),
      secs,
      modeDep: !ic,
      modeIc: !!ic,
      lay: {
        inner: wide ? "inner" : "tin",
        tickets: wide ? "tickets" : "tickets t2",
        yb: wide ? "yb" : "yb t",
        yl: wide ? "yl" : "yl t",
        deux: wide ? "deux" : "deux un",
      },
      sources: sources(this.props.couverture, sourcesIds(dep), sellers.length + ventes.length > 0),
      nom,
      dans: N.dans,
      du: ic ? t("departement.de_ic", { nom: epciLa(nom) }) : N.du,
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
      onQ: ((e: { value: string }) => this.setState({ q: e.value })) as Handler,
      showMore: !q && nC > SHOWN,
      filtre: nC > SHOWN,
      noMatch: !!q && filtered.length === 0,
      more: (() => this.setState({ allC: !S.allC })) as Handler,
      moreLabel: S.allC ? t("departement.reduire") : t("departement.les_n_communes", { n: nC }),
      sellers,
      vCols: heads(S.sortV, "sortV"),
      buyers,
      bCols: heads(S.sortB, "sortB"),
      noMoney: !ic && f.stats.vendeurs.length === 0 && f.stats.acheteurs.length === 0,
      ventes,
      conY0,
      enveloppe: t("argent.enveloppe"),
      years,
      yearTypes,
      yearTitre: t(`departement.an_titre_${S.yt}`),
      yearAlt: t("departement.annees_alt", {
        quoi: t(`departement.an_quoi_${S.yt}`),
        dans: N.dans,
        a: yrs[0],
        b: last,
      }),
      anNote,
      achatsAn,
      achatsAlt: Y.length ? t("departement.achats_alt", { de: Y[0].y, a: Y[Y.length - 1].y }) : "",
      docsPhrase: ic
        ? t("departement.ic_docs", { docs: count(nDocs, "document") })
        : t("departement.dep_docs", { docs: count(nDocs, "document"), dans: N.dans }),
      parcourir: ic ? "" : `/registre/?d=${depGroup(dep)}`,
      achatsSous: A.length
        ? t("departement.achats_sous", {
            contrats: count(A.length, "contrat"),
            nom: [...new Set(A.map((a) => nomPropre(a.f)))].join(", "),
          })
        : "",
      docs,
      aos,
      docsMore: A.length > DOCS,
      docsLabel: S.allD
        ? t("departement.reduire")
        : t("departement.les_n_contrats", { n: A.length }),
      togDocs: (() => this.setState({ allD: !S.allD })) as Handler,
      det,
      quitter: this.quitter(),
    };
  }
}

/** A company's name in a buyer's file (a sole trader is never named). */
function buyerEnt(f: FichierAcheteur, s: string): string {
  const L = lexique(f);
  const lk = lienEntreprise(L, s);
  return typeof lk === "object" && "a" in lk ? String(lk.a.text) : typeof lk === "string" ? lk : "";
}

async function donnees(r: Route): Promise<Record<string, unknown>> {
  const dep = r.view === "departement" ? r.dep : "";
  const ic = new URLSearchParams(location.search).get("ic") ?? "";
  const cv = couverture().catch(() => undefined);
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
  // its own purchases: the buyer files of the territory itself (none read: none shown)
  const achats = (
    await Promise.all(
      achatsPropres(f, epciDe(f, ic)).map((s) =>
        load<FichierAcheteur>(`acheteur/${s}.json`).catch(() => null),
      ),
    )
  ).filter((x): x is FichierAcheteur => !!x);
  return { dep, f, ic, achats, couverture: await cv };
}

export default {
  // the shell gives every view its route and its data as one record
  Vue: Departement as unknown as VueModule["Vue"],
  template,
  donnees,
} satisfies VueModule;
