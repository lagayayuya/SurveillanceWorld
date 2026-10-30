// View 5 · Commune · Autorisations (mockup Autorisations-grand, prototype v12 vues/autorisations.js): the
// commune's prefectoral decrees grouped by dossier; the mairie's main dossier first (its step chart, its
// table, what it allows, what came before), then the shops and companies, then drones and the other
// devices. The rules are the build's flags (communal, partage, non_lu); a decree whose number of cameras
// could not be read counts among the decrees and never in the cameras; a drone zone not deduced is
// listed with its source, never drawn.

import { etatDepartementLie } from "../collecte.ts";
import { type Autorisation, commune, communeHref, type Donnees } from "../commun.ts";
import { docHref } from "../corpus.ts";
import { corrections, nomsDe } from "../corrige.ts";
import type { Handler, Rich } from "../dc.ts";
import type { Evenement } from "../donnees.ts";
import "../demande.ts";
import { fr, longDate, longMonth, MONTHS_LONG, shortDate, shortMonth, signed } from "../format.ts";
import { has, t } from "../i18n.ts";
import { lien, lienCommune } from "../liens.ts";
import type { Miette, VueModule } from "../modale.ts";
import type { Route } from "../routes.ts";
import { capital } from "../texte.ts";
import { repere, typeDocument } from "../types.ts";
import { arriver, type BaseState, large, type Partage, Vue } from "../vue.ts";
import "./commune.css";
import "./autorisations.css";
import template from "./autorisations.html?raw";
import {
  acteArrete,
  beneficiaireArrete,
  categorieArrete,
  filCommune,
  lexique,
  liensBande,
  ligneCommune,
  panneauArrete,
  type ZoneArrete,
} from "./commune-outils.ts";

type Props = { insee: string; dossier: string; d: Donnees };
type State = BaseState & { allPriv: boolean; allAut: boolean };
type Dossier = {
  id: string;
  es: Evenement[];
  /** Its last decree. */
  last: Evenement;
  /** Its last decree whose number of cameras was read (the count that holds). */
  lu: Evenement | null;
  a: ReturnType<Donnees["affaire"]>;
};
/** What a row adds to its decree's panel (panneauArrete): its dossier's words, its change. */
type Ajout = { kicker?: string; avant?: [string, Rich][]; apres?: [string, Rich][]; foot?: string };

const PRIVES_D_ABORD = 15;
const AUTRES_D_ABORD = 12;
const dash = (v: number | null | undefined): string => (v == null ? "—" : fr(v));
const ym = (d: string): string => d.slice(0, 7);
const lu = (e: Evenement): boolean => e.cameras != null && !e.non_lu?.includes("nombre_illisible");
const nonDeduite = (e: Evenement): boolean => !!e.non_lu?.includes("zone_non_deduite");
/** What a decree changes from the previous one of its dossier, in words (the prototype's change()). */
function change(a: Evenement, p: Evenement | undefined, dossier: Dossier["a"]): string {
  if (!p) return t("autorisations.change_premier");
  const parts: string[] = [];
  for (const [k, lab] of [
    ["cameras_vp", "vp"],
    ["cameras_int", "int"],
    ["cameras_ext", "ext"],
  ] as const) {
    const x = a[k];
    const y = p[k];
    if (x != null && y != null && x !== y)
      parts.push(
        t(x > y ? "autorisations.change_plus" : "autorisations.change_moins", {
          n: fr(Math.abs(x - y)),
          lab: t(`autorisations.lab_${lab}`),
        }),
      );
  }
  const n = a.cameras ?? 0;
  const m = p.cameras ?? 0;
  let s = parts.length
    ? `${capital(parts.join(", "))}.`
    : n !== m
      ? t(n > m ? "autorisations.change_cam_plus" : "autorisations.change_cam_moins", {
          n: Math.abs(n - m),
        })
      : t("autorisations.change_meme");
  if (dossier?.echeance_source === a.id && dossier.echeance)
    s += ` ${t("autorisations.change_fin", { date: longDate(dossier.echeance) })}`;
  return s;
}

class Autorisations extends Vue<Props, State> {
  private cache: ReturnType<Autorisations["build"]> | null = null;

  protected init(): Partial<State> {
    return { allPriv: false, allAut: false };
  }

  /** The breadcrumb's last step, after Registre › Communes › <commune> (fil()). */
  titre(): string {
    return t("autorisations.fil_ici");
  }
  type() {
    return "commune" as const;
  }
  fil(): Miette[] {
    return filCommune(this.props.d);
  }
  partage(): Partage | null {
    return { titre: t("autorisations.titre_onglet", { nom: this.props.d.f.commune.nom }) };
  }

  /** The commune's head and band (its fiche's), its one section « Documents ». */
  private cadre() {
    const d = this.props.d;
    const nom = d.f.commune.nom;
    const secs = this.sections({ documents: true });
    const band = this.bandeau("commune", nom, secs);
    const wide = large();
    return {
      tete: this.tete("commune", nom, ligneCommune(d)),
      band: { ...band, secs: liensBande(band.secs, d.insee, false) },
      secs,
      lay: {
        inner: wide ? "inner" : "tin",
        tickets: wide ? "tickets" : "tickets t2",
        deux: wide ? "deux" : "deux un",
      },
    };
  }

  private build() {
    const d = this.props.d;
    const L = d.all
      .filter((e) => e.t.startsWith("arrete"))
      .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
    const byDos = new Map<string, Evenement[]>();
    for (const e of L)
      if (e.t === "arrete") byDos.set(e.affaire, [...(byDos.get(e.affaire) ?? []), e]);
    const dossiers: (Dossier & { com: boolean })[] = [...byDos.entries()].map(([id, es]) => {
      const last = es[es.length - 1];
      return {
        id,
        es,
        last,
        lu: es.filter(lu).pop() ?? null,
        a: d.affaire(id),
        com: !!last.communal,
      };
    });
    // the mairie's dossiers, the largest first; the main one is the first whose decrees give a number
    const mairie = dossiers
      .filter((x) => x.com)
      .sort((a, b) => (b.lu?.cameras ?? 0) - (a.lu?.cameras ?? 0));
    const prives = dossiers
      .filter((x) => !x.com)
      .sort((a, b) => (a.last.date ?? "").localeCompare(b.last.date ?? ""));
    const autres = L.filter((e) => e.t !== "arrete").sort((a, b) =>
      (b.date ?? "").localeCompare(a.date ?? ""),
    );
    // the main dossier: the mairie's largest whose decrees give a number
    const main = mairie.find((x) => x.es.some(lu));
    // decrees of drones or algorithmic analysis naming the commune among others, not among its own
    const ids = new Set(L.map((e) => e.id));
    const dep = d.f.commune.dep;
    const multi = (d.f.zones?.autorisations ?? []).filter(
      (a: Autorisation) =>
        a.insee.includes(d.insee) && !ids.has(a.acte) && a.acte.startsWith(`${dep}-`),
    );
    return { L, mairie, main, prives, autres, multi };
  }

  private data() {
    if (!this.cache) this.cache = this.build();
    return this.cache;
  }

  /** Where a decree is on the page: its row's id (its section: the mairie, the shops and
   * companies, the drones and other devices), and what must be unfolded for the row to be there. */
  private cible(e: Evenement): { ancre: string; etat: Partial<State> } | null {
    const d = this.data();
    if (e.t !== "arrete") {
      const i = d.autres.indexOf(e);
      return i < 0
        ? null
        : { ancre: `arr-${e.id}`, etat: { allAut: i >= AUTRES_D_ABORD || this.state.allAut } };
    }
    if (d.main?.es.includes(e)) return { ancre: `arr-${e.id}`, etat: {} };
    if (d.mairie.some((x) => x.es.includes(e))) return { ancre: `dos-${e.affaire}`, etat: {} };
    const i = d.prives.findIndex((x) => x.es.includes(e));
    return i < 0
      ? null
      : {
          ancre: `dos-${e.affaire}`,
          etat: { allPriv: i >= PRIVES_D_ABORD || this.state.allPriv },
        };
  }

  /** Opened at a decree (…/autorisations/<id>, every link to a decree: corpus.ts docHref) or at a
   * dossier (an older address: its last decree): the decree chosen, its section unfolded, its row
   * in view, its content in the panel, the panel's arrival marked (v2.1 A7). */
  componentDidMount(): void {
    const p = this.props.dossier;
    if (!p) return;
    const d = this.data();
    const e = d.L.find((x) => x.id === p) ?? [...d.L].reverse().find((x) => x.affaire === p);
    if (!e) return;
    const c = this.cible(e);
    this.setState({ sel: e.id, ...(c?.etat ?? {}) } as Partial<State>);
    // two frames: the router scrolls to the top in the next one
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const row = c ? document.getElementById(c.ancre) : null;
        // at once: the panel's own scroll (arriver) would stop a smooth one halfway; on a phone
        // the row near the top, above the drawer the panel becomes (60 % of the height)
        const wide = large();
        row?.scrollIntoView({ block: wide ? "center" : "start", behavior: "instant" });
        const sc = row?.closest(".scroll");
        if (sc && !wide) sc.scrollTop -= 140;
        const root = (row ?? document.getElementById("registre"))?.closest(".rg");
        if (root) arriver(root);
      }),
    );
  }

  /** A decree's panel: everything the build gives of it (panneauArrete), its zones from the
   * commune's file, what its row adds (its dossier, its change from the decree before). */
  private detail(e: Evenement, x?: Ajout) {
    const D = this.props.d;
    const zones = ((D.f.zones?.zones ?? []) as unknown as ZoneArrete[]).filter(
      (z) => z.acte === e.id,
    );
    const p = panneauArrete(lexique(D), e, zones);
    return {
      ...p,
      kicker: x?.kicker ?? p.kicker,
      rows: [...(x?.avant ?? []), ...p.rows, ...(x?.apres ?? [])],
      foot: x?.foot ?? p.foot,
    };
  }

  /** A row's click, a tap or Enter (v2.1 A2, A3, A7): the decree chosen here, its own address
   * (docHref) written in the address bar rather than followed (the same view, at another
   * decree); a modified click opens it elsewhere, another link of the row is its own. */
  private prendre(id: string, href: string): Handler {
    const choisir = this.choisir(id);
    return (ev) => {
      const n = ev.nativeEvent as MouseEvent;
      if (n.metaKey || n.ctrlKey || n.shiftKey || n.altKey) return;
      const a = (ev.target as Element | null)?.closest?.("a, button");
      if (a && !a.classList.contains("rl")) return;
      if (a) ev.preventDefault();
      if (href && location.pathname !== href) history.replaceState(history.state, "", href);
      choisir(ev);
    };
  }

  /** A row under the contract (cadre.css « rows »): chosen when one of `ids` is (a dossier's row
   * holds all its decrees), hovered or focused shown in the panel, its type's bar. */
  private rang(e: Evenement, ids: string[] = [e.id]) {
    const on = !!this.state.sel && ids.includes(this.state.sel);
    return {
      cls: on ? "r on" : "r",
      sel: on ? "true" : "false",
      c: repere(typeDocument(e)).c,
      href: docHref(lexique(this.props.d), e),
      hover: this.survol(e.id),
      pick: this.prendre(e.id, docHref(lexique(this.props.d), e)),
    };
  }

  renderVals() {
    const S = this.state;
    const D = this.props.d;
    const L = lexique(D);
    const d = this.data();
    const insee = D.insee;
    const nom = D.f.commune.nom;
    const couv = D.f.couverture.departement as Donnees["f"]["couverture"]["departement"] & {
      documents_demandes?: boolean;
    };
    const AJ: Record<string, Ajout> = {};

    // the lead, the line on the collection under it, the four figures
    const nM = d.mairie.reduce((s, x) => s + x.es.length, 0);
    const nP = d.prives.reduce((s, x) => s + x.es.length, 0);
    const nA = d.autres.length;
    const etat = etatDepartementLie(D.f.commune.dep, D.f.stats.dep.nom, couv);
    let lead: Rich;
    let couverture: Rich = "";
    if (d.L.length) {
      const parts = [
        nM ? t("autorisations.lead_mairie", { n: fr(nM) }) : "",
        nP ? t("autorisations.lead_prives", { n: fr(nP) }) : "",
        nA ? t("autorisations.lead_autres", { n: fr(nA) }) : "",
      ].filter(Boolean);
      lead = [
        t("autorisations.lead_depuis", { mois: longMonth(d.L[0].date ?? "") }),
        { strong: t("n.arrete", { n: d.L.length }) },
        t("autorisations.lead_pour", { nom, parts: parts.join(", ") }),
      ];
      couverture =
        couv.etat === "collecte"
          ? couv.dernier_recueil
            ? t("couverture.dernier_recueil", { date: longDate(couv.dernier_recueil) })
            : ""
          : etat;
    } else if (couv.etat === "collecte") {
      lead = couv.depuis
        ? t("autorisations.lead_aucun_depuis", { nom, mois: longMonth(couv.depuis) })
        : t("autorisations.lead_aucun", { nom });
      couverture = couv.dernier_recueil
        ? t("couverture.dernier_recueil", { date: longDate(couv.dernier_recueil) })
        : "";
    } else lead = etat;

    const camM = d.mairie.reduce((s, x) => s + (x.lu?.cameras ?? 0), 0);
    const avecNombre = d.mairie.filter((x) => x.lu);
    const vpM =
      avecNombre.length && avecNombre.every((x) => x.lu?.cameras_vp != null)
        ? avecNombre.reduce((s, x) => s + (x.lu?.cameras_vp ?? 0), 0)
        : null;
    const camP = d.prives.reduce((s, x) => s + (x.lu?.cameras ?? 0), 0);
    const main = d.main;
    const fin = main?.a?.echeance ?? null;
    // a département whose decrees are not collected: no figure of cameras (they are not known)
    const kpis =
      d.L.length && couv.etat === "collecte"
        ? [
            { v: fr(camM), l: t("autorisations.kpi_mairie") },
            { v: vpM == null ? "—" : fr(vpM), l: t("autorisations.kpi_rue") },
            { v: fr(camP), l: t("autorisations.kpi_prives") },
            { v: fin ? fin.slice(0, 4) : "—", l: t("autorisations.kpi_fin") },
          ]
        : [];

    // the mairie's main dossier: the step chart, the table, what it allows, before
    const mairie: Record<string, unknown> = { show: !!main };
    let marks: Record<string, unknown>[] = [];
    let rows: Record<string, unknown>[] = [];
    let mairieCap = "";
    if (main) {
      const es = main.es.filter(lu);
      const a = main.a;
      const last = main.last;
      // the dossier's first decree published online, read or not (an unread one was published all the same)
      const first = main.es[0].date ?? "";
      const t0 = Date.UTC(+first.slice(0, 4), +first.slice(5, 7) - 2, 1);
      const t1 = Date.now();
      const X = (dd: string) => 24 + ((Date.parse(`${dd}T00:00:00Z`) - t0) / (t1 - t0)) * 62;
      let lastX = -99; // the phone hides a date label closer than 13 % to the one before (they overlapped at 390 px)
      marks = es.map((e, i) => {
        const date = e.date ?? "";
        const n = e.cameras ?? 0;
        const ecart = i ? signed(n - (es[i - 1].cameras ?? 0)) : "—";
        AJ[e.id] = {
          apres: [[t("autorisations.ecart"), ecart]],
          foot: `${change(e, es[i - 1], a)} ${acteArrete(e)}`,
        };
        const x = X(date);
        const close = x - lastX < 13;
        if (!close) lastX = x;
        return {
          n: fr(n),
          delta: i ? ecart : t("autorisations.premier_publie"),
          d: shortMonth(date),
          cls: `mk${S.sel === e.id ? " on" : ""}`,
          pressed: S.sel === e.id ? "true" : "false",
          pos: `left: ${x.toFixed(1)}%; top: 79px`,
          lpos: `position: absolute; left: ${x.toFixed(1)}%; transform: translateX(-50%); white-space: nowrap`,
          lcls: close ? "tk-o" : "",
          aria: t("autorisations.mark_aria", {
            date: shortDate(date),
            cameras: t("n.camera", { n }),
          }),
          hover: this.survol(e.id),
          pick: this.prendre(e.id, docHref(L, e)),
        };
      });
      // the table lists every decree of the dossier; one whose number could not be read shows none
      rows = main.es.map((e) => {
        const p = es[es.indexOf(e) - 1];
        return {
          date: shortDate(e.date),
          n: lu(e) ? fr(e.cameras ?? 0) : "—",
          vp: dash(e.cameras_vp),
          ext: dash(e.cameras_ext),
          int: dash(e.cameras_int),
          delta: lu(e) && p ? signed((e.cameras ?? 0) - (p.cameras ?? 0)) : "—",
          ancre: `arr-${e.id}`,
          ...this.rang(e),
        };
      });
      mairieCap = t("autorisations.cap", { n: main.es.length });
      const no = main.id.split("-")[1] ?? main.id;
      const orig = typeof a?.origine_annee === "number" ? a.origine_annee : null;
      const y0 = +first.slice(0, 4);
      const derniere = main.lu ?? last;
      Object.assign(mairie, {
        n: fr(main.es.length),
        sous: orig
          ? `${t("autorisations.dossier_no", { no })} · ${t("autorisations.ouvert_en", { an: String(orig) })}`
          : t("autorisations.dossier_no", { no }),
        avant: orig
          ? t("autorisations.avant_orig", { a: String(orig), b: String(y0) })
          : t("autorisations.avant_sans", { mois: shortMonth(first) }),
        an0: orig ? String(orig) : "",
        jusquaL: t(fin ? "autorisations.valable_jusqu_au" : "autorisations.fin"),
        jusqua: fin ? longDate(fin) : t("autorisations.non_precisee"),
        arrete: t("autorisations.arrete_du", { date: longDate(derniere.date ?? "") }),
        permet: [
          {
            l: [
              { strong: t("autorisations.permet_verbaliser") },
              derniere.videoverbalisation ? t("autorisations.permet_verbaliser_detail") : "",
            ] as Rich,
            v: t(derniere.videoverbalisation ? "autorisations.oui" : "autorisations.non_mentionne"),
          },
          {
            l: [
              { strong: t("autorisations.permet_transmettre") },
              t("autorisations.permet_transmettre_detail"),
            ] as Rich,
            v: t(derniere.deport_forces ? "autorisations.oui" : "autorisations.non_mentionne"),
          },
          {
            l: [{ strong: t("autorisations.duree") }] as Rich,
            v:
              derniere.duree ||
              String(a?.duree_dernier_arrete ?? "") ||
              t("autorisations.non_precisee"),
          },
        ],
        avantMois: longMonth(first),
        avantQ: orig
          ? t("autorisations.avant_q_orig", { an: String(orig) })
          : t("autorisations.avant_q"),
        demande: t("autorisations.demande_objet", {
          nom,
          no,
          periode: orig
            ? t("autorisations.demande_periode", { a: String(orig), b: String(y0 - 1) })
            : "",
        }),
      });
    }

    // the mairie's other dossiers, one row each (its last decree)
    const autres = d.mairie
      .filter((x) => x !== main)
      .map((x) => {
        const e = x.last;
        const n = x.lu?.cameras ?? null;
        for (const y of x.es)
          AJ[y.id] = {
            kicker: t("autorisations.kicker_dossier", { no: x.id.split("-")[1] ?? x.id }),
            avant: [[t("autorisations.arretes_publies"), fr(x.es.length)]],
          };
        return {
          no: x.id.split("-")[1] ?? x.id,
          date: shortDate(e.date),
          na: fr(x.es.length),
          n: dash(n),
          vp: dash(x.lu?.cameras_vp),
          ancre: `dos-${x.id}`,
          ...this.rang(
            e,
            x.es.map((y) => y.id),
          ),
        };
      });

    // shops and companies: one row per dossier (its last decree)
    const pv = S.allPriv ? d.prives : d.prives.slice(0, PRIVES_D_ABORD);
    const priv = pv.map((x) => {
      const e = x.last;
      const nm = beneficiaireArrete(L, e);
      const publie =
        e.beneficiaire !== "[non retenu]" && e.nom_publie !== false && !!e.beneficiaire;
      const cat = categorieArrete(e);
      const illisible = !lu(e);
      return {
        date: shortDate(e.date),
        // a company that has its fiche (SIRENE-verified beneficiary), a link; else its words
        nomR: nm,
        nomStyle: publie ? "font-weight: 700" : "font-style: italic; color: var(--muted)",
        cat,
        n: illisible ? "—" : fr(e.cameras ?? 0),
        ext: dash(e.cameras_ext),
        int: dash(e.cameras_int),
        ancre: `dos-${x.id}`,
        ...this.rang(
          e,
          x.es.map((y) => y.id),
        ),
      };
    });
    const ds = d.prives.map((x) => x.last.date ?? "").sort();
    let span = "";
    if (ds.length) {
      const [a, b] = [ds[0], ds[ds.length - 1]];
      span =
        ym(a) === ym(b)
          ? t("autorisations.span_en", { mois: longMonth(a) })
          : t("autorisations.span_de_a", {
              de: a.slice(0, 4) === b.slice(0, 4) ? MONTHS_LONG[+a.slice(5, 7) - 1] : longMonth(a),
              a: longMonth(b),
            });
    }
    const prv = {
      cam: t("n.camera", { n: camP }),
      arr: t("n.arrete", { n: nP }),
      span,
      more:
        d.prives.length > PRIVES_D_ABORD
          ? S.allPriv
            ? t("autorisations.reduire")
            : t("autorisations.les_dossiers", { n: fr(d.prives.length) })
          : "",
      moreAct: () => this.setState({ allPriv: !this.state.allPriv }),
    };

    // drones, body cameras, algorithmic analysis
    const lyonDr = D.f.stats.communes["69123"]?.dr ?? 0;
    const carte = communeHref(insee, "carte");
    const list = (S.allAut ? d.autres : d.autres.slice(0, AUTRES_D_ABORD)).map((e) => {
      const kind = has(`registre.autorisations.type.${e.t}`)
        ? t(`autorisations.type.${e.t}`)
        : t("autorisations.type.autre");
      const txt: Rich = [`${kind} · `, ...beneficiaireArrete(L, e)];
      const partage = (e.partage ?? []) as string[];
      if (partage.length) {
        txt.push(` · ${t("autorisations.partage", { n: partage.length })} : `);
        partage.forEach((k, i) => {
          if (i) txt.push(", ");
          txt.push(lienCommune(L, k, D.commune(k).nom));
        });
      }
      const zone = /^arrete_(drone|vsa)$/.test(e.t);
      if (zone && nonDeduite(e)) txt.push(` · ${t("arretes.zone_non_deduite")}`);
      // its zone on the map and its act are in the panel, not on each row (v2.1 B4)
      return {
        ancre: `arr-${e.id}`,
        ...this.rang(e),
        d: shortDate(e.date),
        t: txt,
      };
    });
    const multi: Rich = d.multi.length
      ? [
          `${t("autorisations.multi", {
            arr: t("n.arrete", { n: d.multi.length }),
            kind: t(
              d.multi.every((a) => a.kind === "drone")
                ? "autorisations.multi_drones"
                : "autorisations.multi_mixte",
            ),
            n: d.multi.length,
            nom,
            dates: d.multi.map((a) => shortDate(a.date_acte)).join(", "),
          })} `,
          lien("commune", carte, t("autorisations.voir_sur_la_carte")),
        ]
      : "";
    const autresArr = {
      // a département not collected says so in the lead: no « aucun arrêté » here
      show: couv.etat === "collecte" || d.L.length > 0 || d.multi.length > 0,
      none: couv.etat === "collecte" && !list.length && !d.multi.length,
      ex:
        lyonDr && insee !== "69123"
          ? lien(
              "commune",
              communeHref("69123", "carte"),
              t("autorisations.exemple_lyon", { arr: t("n.arrete", { n: lyonDr }) }),
            )
          : "",
      list,
      multi,
      more:
        d.autres.length > AUTRES_D_ABORD
          ? S.allAut
            ? t("autorisations.reduire")
            : t("autorisations.les_arretes", { n: fr(d.autres.length) })
          : "",
      moreAct: () => this.setState({ allAut: !this.state.allAut }),
    };

    const vu = this.affiche();
    const e1 = vu ? D.ev.get(vu) : undefined;
    const d0 = e1?.t.startsWith("arrete") ? this.detail(e1, AJ[e1.id]) : undefined;
    const e0 = e1;
    const det = d0
      ? {
          ...d0,
          rows: d0.rows.map(([k, v]) => ({ k, v })),
          note: d0.note ?? "",
          // a decree corrected in /revue: « Corrigé le … », the source's value struck
          corr: e0 ? corrections(e0, nomsDe(D)) : [],
        }
      : couv.etat !== "collecte"
        ? {
            kicker: t("autorisations.repos_kicker", { nom }),
            title: t("autorisations.repos_non_collecte"),
            rows: [] as { k: string; v: string }[],
            note: "",
            foot: "",
            links: [{ l: t("autorisations.voir_couverture"), href: "/registre/couverture" }],
          }
        : {
            // at rest it says what to hover or choose, never the figures beside it (v2.1 B3)
            kicker: t("autorisations.repos_kicker", { nom }),
            title: "",
            rows: [] as { k: string; v: string }[],
            note: "",
            foot: t("autorisations.repos_foot"),
            links: [],
          };

    const nDocs = D.all.length;
    const elide = /^[aeiouyéèêâîôûh]/i.test(nom);
    const docsHref = communeHref(insee, "documents");
    return {
      ...this.base("autorisations"),
      ...this.info("dos", "nom"),
      ...this.cadre(),
      com: { nom, insee },
      // the tabs are gone: all the commune's documents, one link away
      voisin: [lien("commune", docsHref, t("commune.tous_documents", { n: nDocs }))],
      lead,
      couverture,
      kpis,
      mairie,
      marks,
      rows,
      mairieCap,
      autres,
      priv,
      prv,
      autresArr,
      det,
      lus: d.L.length ? t("arretes.lus_par_programme") : "",
      // singular and elision (« Cet arrêté figure aussi parmi le document d'Ampuis »)
      cesTxt: d.L.length ? t("autorisations.ces_figurent", { n: d.L.length }) : "",
      docsLien: lien(
        "commune",
        docsHref,
        t(elide ? "autorisations.docs_d" : "autorisations.docs_de", { n: nDocs, nom }),
      ),
      lien: { ici: location.pathname },
      quitter: this.quitter(),
    };
  }
}

export default {
  // the router gives the route and donnees() together (main.ts): { insee, dossier, d }
  Vue: Autorisations as unknown as VueModule["Vue"],
  template,
  donnees: async (r: Route) => ({ d: await commune((r as { insee: string }).insee) }),
} satisfies VueModule;
