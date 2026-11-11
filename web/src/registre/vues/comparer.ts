// Up to four communes or companies side by side (/registre/comparer?communes=<insee>,… or
// ?entreprises=<siren>,…; boards Comparer-communes and Comparer-entreprises of the redesign v3, lot
// 4, their phone and dark variants): the sticker « Comparer » and the word cut out, the columns
// compared as chips (✕ removes one, « + Ajouter » searches the register's names), a sentence of
// their figures (the most, the least), « Partager », « Exporter (CSV) », and for two companies
// « Chemin entre les deux »; then the table, a row per figure, the highest of each row in yellow,
// a bar per value against its row's maximum; for communes « Ce que ces chiffres ne disent pas ».
// Every figure is listes.json's row (one source per figure: the lists', the build's); each value
// leads to its column's fiche. The address follows the columns, so that a comparison is shared.

import { remplacerAdresse } from "../adresse.ts";
import { communeHref } from "../commun.ts";
import { depNom, entName } from "../corpus.ts";
import type { Handler, RichItem } from "../dc.ts";
import { load } from "../donnees.ts";
import { fr } from "../format.ts";
import { has, t } from "../i18n.ts";
import { departementHref, phrase } from "../liens.ts";
import { type CouvertureX, etapeListe, type Listes, nomDep, TOUTES } from "../listes.ts";
import type { Miette, VueModule } from "../modale.ts";
import { partager } from "../partage.ts";
import type { Route } from "../routes.ts";
import { coupeMots, montantA, repli } from "../socle-a.ts";
import { plain } from "../texte.ts";
import type { TypeCle } from "../types.ts";
import { type BaseState, type Partage, Vue } from "../vue.ts";
import { ditActes } from "./actes-mots.ts";
import { contracte } from "./commune-a.ts";
import {
  barres,
  type CouvActes,
  classement,
  couvertureActes,
  csvComparaison,
  depsCommuns,
  type FiguresCommune,
  type FiguresEntreprise,
  figuresCommune,
  figuresEntreprise,
  hauts,
  idsDe,
  type Lecture,
  LIGNES_COMMUNE,
  LIGNES_ENTREPRISE,
  lecture,
  MAX,
} from "./comparer-a.ts";
import "./comparer.css";
import template from "./comparer.html?raw";

type Mode = "communes" | "entreprises";
type Props = Extract<Route, { view: "comparer" }> & { X: Listes; couv: CouvertureX };
type State = BaseState & {
  ids: string[];
  /** « + Ajouter » open: the head's chip's (`picks`) or the table head's (`tete`) */
  menu: "" | "picks" | "tete";
  q: string;
  /** the phone's « ⋯ »: the actions it hides, shown */
  plus: boolean;
};
/** A column: its id, its name, its fiche. */
type Col = { id: string; nom: string; href: string | null };
type KC = (typeof LIGNES_COMMUNE)[number];
type KE = (typeof LIGNES_ENTREPRISE)[number];
/** A cell of the table, as the template reads it. */
type Cell = {
  cls: string;
  span: number | null;
  nom: string;
  tab: string | null;
  bh: string;
  bl: string;
  bc: string;
  go: string;
  txt: string;
  nonLu: boolean;
  /** the state said in place of a figure: « non lu », « hors carte » */
  etat: string;
  bar: string;
  sub: string;
  liste:
    | { href: string; l: string; sep: string; fin: string; bh: string; bl: string; bc: string }[]
    | null;
};
type Groupe = { l: string; lignes: { l: string; s: string; vals: Cell[] }[] };

const SCOPE = ".v-comparer";
/** Where each figure leads in a commune's fiche (its section). */
const ANCRE: Record<KC, string> = {
  carte: "#cameras",
  p1000: "#cameras",
  cam: "#cameras",
  amt: "#argent",
  eph: "#argent",
  con: "#argent",
  dr: "#drones",
  docs: "#documents",
};
const GROUPES_C: [string, KC[]][] = [
  ["g_cameras", ["carte", "p1000", "cam"]],
  ["g_argent", ["amt", "eph", "con"]],
  ["g_drones", ["dr", "docs"]],
];
const GROUPES_E: [string, KE[]][] = [
  ["g_contrats", ["amt", "n", "moy"]],
  ["g_clients", ["clientes", "deps"]],
];
/** The départements in common the cell names before « … » (the board's 14). */
const DEPS_MONTRES = 14;

const un = (n: number): string => n.toFixed(1).replace(".", ",");
const euros = (n: number): string => t("socle_a.e", { n: fr(n) });
const jourCourt = (d: string): string =>
  new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${d.slice(0, 10)}T12:00:00Z`));
/** A figure as written: a tenth per 1 000 inhabitants, whole euros per inhabitant or contract. */
const comme = (k: string, v: number): number =>
  k === "p1000" ? Math.round(v * 10) / 10 : k === "eph" || k === "moy" ? Math.round(v) : v;
const enPhrase = (parts: RichItem[]): RichItem => ({ span: parts, cls: "" });

/** « A, B et C »: the catalogue's comma and « et ». */
function enumerer(items: RichItem[], et = true): RichItem[] {
  return items.flatMap((x, i) =>
    i === 0
      ? [x]
      : [et && i === items.length - 1 ? t("comparer_a.et") : t("comparer_a.virgule"), x],
  );
}

export class Comparer extends Vue<Props, State> {
  protected init(p: Props): Partial<State> {
    const m = modeDe(p.q);
    return { ids: idsDe(p.q[m], (id) => connu(p.X, m, id)), menu: "", q: "", plus: false };
  }

  private get mode(): Mode {
    return modeDe(this.props.q);
  }
  titre(): string {
    return t("comparer_a.titre");
  }
  type(): TypeCle {
    return this.mode === "communes" ? "commune" : "entreprise";
  }
  fil(): Miette[] {
    return [
      { k: "registre", l: t("types.registre.l"), href: "/registre/" },
      etapeListe(this.type()),
    ];
  }
  partage(): Partage | null {
    const noms = this.colonnes().map((c) => c.nom);
    return {
      titre: noms.length ? t("comparer_a.titre_tab", { noms: noms.join(", ") }) : this.titre(),
    };
  }

  componentDidMount(): void {
    document.addEventListener("pointerdown", this.dehors, true);
    // the address says the columns kept (an unknown or repeated id dropped)
    this.adresse(this.state.ids);
  }
  componentWillUnmount(): void {
    document.removeEventListener("pointerdown", this.dehors, true);
  }

  /** A pointer down outside the open search closes it. */
  private dehors = (ev: Event): void => {
    if (this.state.menu && !(ev.target as Element).closest?.(`${SCOPE} .dancre`))
      this.setState({ menu: "", q: "" });
  };

  private basculer = (k: string): void =>
    this.setState({ open: { ...this.state.open, [k]: !this.state.open[k] } });

  private colonnes(): Col[] {
    const X = this.props.X;
    return this.state.ids.map((id) => {
      if (this.mode === "communes") {
        const c = X.dico.communes[id];
        return { id, nom: c?.nom ?? id, href: c?.ref ? communeHref(id) : null };
      }
      const e = X.dico.entreprises[id];
      const href = e?.ref && !e.entrepreneur_individuel ? `/registre/entreprise/${id}` : null;
      return { id, nom: entName(X.dico, id), href };
    });
  }

  private adresse(ids: string[]): void {
    const href = `/registre/comparer?${this.mode}=${ids.join(",")}`;
    if (`${location.pathname}${location.search}` !== href) remplacerAdresse(href);
  }

  private poser(ids: string[]): void {
    this.setState({ ids, menu: "", q: "" });
    this.adresse(ids);
  }

  private focus(sel: string): void {
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`${SCOPE} ${sel}`)?.focus());
  }

  private retirer(id: string): void {
    const i = this.state.ids.indexOf(id);
    this.poser(this.state.ids.filter((x) => x !== id));
    // the focus on the chip that took its place, else the last one, else « + Ajouter »
    requestAnimationFrame(() => {
      const chips = document.querySelectorAll<HTMLElement>(`${SCOPE} .picks .chip`);
      chips[Math.min(i, chips.length - 1)]?.focus();
    });
  }

  /** The names « + Ajouter » finds: the register's communes (listes.json's rows) by their name, the
   * largest first, or its companies by their amount, never a sole trader (whose name is not
   * published); those compared already left out; eight at most. */
  private resultats(): { id: string; l: string; d: string }[] {
    const X = this.props.X;
    const q = plain(this.state.q.trim());
    const pris = new Set(this.state.ids);
    const debut = (nom: string) => (q && plain(nom).startsWith(q) ? 0 : 1);
    if (this.mode === "communes") {
      return Object.keys(X.lignes.communes)
        .filter((k) => !pris.has(k) && X.dico.communes[k]?.nom)
        .filter((k) => !q || plain(X.dico.communes[k].nom).includes(q))
        .map((k) => ({ k, c: X.dico.communes[k] }))
        .sort((a, b) => debut(a.c.nom) - debut(b.c.nom) || (b.c.pop ?? 0) - (a.c.pop ?? 0))
        .slice(0, 8)
        .map(({ k, c }) => ({
          id: k,
          l: c.nom,
          d: t("comparer_a.res_c", { dep: c.dep, n: fr(c.pop ?? 0) }),
        }));
    }
    const E = X.lignes.entreprises;
    return Object.keys(E)
      .filter((k) => {
        const e = X.dico.entreprises[k];
        return !pris.has(k) && !!e?.nom && !e.entrepreneur_individuel;
      })
      .map((k) => ({ k, nom: entName(X.dico, k) }))
      .filter((x) => !q || plain(x.nom).includes(q))
      .sort((a, b) => debut(a.nom) - debut(b.nom) || E[b.k].amt - E[a.k].amt)
      .slice(0, 8)
      .map((x) => ({ id: x.k, l: x.nom, d: t("comparer_a.res_e", { n: E[x.k].n }) }));
  }

  /** « + Ajouter »: a button, its search field and the names found as a listbox. The field takes
   * the focus; ↓ goes down the names, ↑ back up to the field, Enter or a click adds (Enter in the
   * field adds the first), Escape closes, the focus back on the button. */
  private ajout(k: "picks" | "tete", l: string) {
    const open = this.state.menu === k;
    const ici = `.dancre.m-${k}`;
    const fermer = () => {
      this.setState({ menu: "", q: "" });
      this.focus(`${ici} > button`);
    };
    const res = open ? this.resultats() : [];
    const ajouter = (id: string) => {
      const ids = [...this.state.ids, id].slice(0, MAX);
      this.poser(ids);
      // the focus back on « + Ajouter » while one may still be added, else on the last chip
      this.focus(ids.length < MAX ? `${ici} > button` : ".picks .chip:last-of-type");
    };
    const m = this.mode === "communes";
    return {
      cls: `dancre m-${k}`,
      l,
      ouvert: open ? "true" : "false",
      menu: open,
      chercher: t(m ? "comparer_a.chercher_c" : "comparer_a.chercher_e"),
      res: res.map((r) => ({ ...r, choisir: (() => ajouter(r.id)) as Handler })),
      vide: open && !res.length ? t(m ? "comparer_a.aucun_c" : "comparer_a.aucun_e") : "",
      basculer: (() => {
        this.setState({ menu: open ? "" : k, q: "" });
        if (!open) this.focus(`${ici} input`);
      }) as Handler,
      clavier: ((ev) => {
        const os = [...document.querySelectorAll<HTMLElement>(`${SCOPE} ${ici} [role=option]`)];
        const actif = document.activeElement as HTMLElement | null;
        const i = os.indexOf(actif as HTMLElement);
        const champ = actif?.tagName === "INPUT";
        if (ev.key === "Escape") fermer();
        else if (ev.key === "ArrowDown") os[Math.min(os.length - 1, i + 1)]?.focus();
        else if (ev.key === "ArrowUp") {
          if (i > 0) os[i - 1].focus();
          else document.querySelector<HTMLElement>(`${SCOPE} ${ici} input`)?.focus();
        } else if (ev.key === "Enter" && champ) {
          if (res[0]) ajouter(res[0].id);
        } else if ((ev.key === " " || ev.key === "Enter") && i >= 0) os[i].click();
        else return;
        ev.nativeEvent.preventDefault();
        ev.stopPropagation();
      }) as Handler,
    };
  }

  private onQ: Handler = (ev) => this.setState({ q: ev.value });

  /** Which of its decrees are read (comparer-a.ts `couvertureActes`, the build's rule): « non
   * lu », never 0, elsewhere. */
  private couvC(insee: string): CouvActes {
    const X = this.props.X;
    const dep = X.dico.communes[insee]?.dep ?? "";
    return couvertureActes({ insee, dep, etat: this.props.couv.departements[dep]?.etat, X });
  }
  private lu(insee: string): Lecture {
    return lecture(this.couvC(insee));
  }
  private figC(insee: string): FiguresCommune {
    const X = this.props.X;
    return figuresCommune(X.lignes.communes[insee], X.dico.communes[insee]?.pop, this.lu(insee));
  }
  private communs(): string[] {
    const X = this.props.X;
    return depsCommuns(this.state.ids.map((id) => X.lignes.entreprises[id]?.deps ?? {}));
  }

  /** « Exporter (CSV) »: a line per column, its figures as the build counts them. */
  private exporter: Handler = () => {
    const X = this.props.X;
    const cols = this.colonnes();
    if (!cols.length) return;
    const m = this.mode === "communes";
    const tete = [
      t("comparer_a.csv_id"),
      t("comparer_a.csv_nom"),
      ...t(m ? "comparer_a.csv_c" : "comparer_a.csv_e").split(","),
    ];
    const communs = m ? "" : this.communs().join(" ");
    const lignes = cols.map((c) => {
      if (m) {
        const x = X.dico.communes[c.id];
        const f = this.figC(c.id);
        return [
          c.id,
          c.nom,
          x?.pop ?? null,
          x?.epci ? (X.dico.epcis?.[x.epci]?.nom ?? null) : null,
          ...LIGNES_COMMUNE.map((k) => f[k]),
        ];
      }
      const f = figuresEntreprise(X.lignes.entreprises[c.id]);
      return [c.id, c.nom, naf(X, c.id) || null, ...LIGNES_ENTREPRISE.map((k) => f[k]), communs];
    });
    const blob = new Blob([csvComparaison(tete, lignes)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `registre-comparer-${this.mode}.csv`;
    a.hidden = true;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  /** A column's name in a sentence: a link to its fiche, bold for the one the sentence is about. */
  private nomLien(c: Col, fort = false): RichItem {
    const cls = this.mode === "communes" ? "ent com" : "ent";
    const x: RichItem = c.href ? { a: { href: c.href, text: c.nom, cls } } : c.nom;
    return fort ? { strong: [x] } : x;
  }

  /** The lead for communes: who has the most cameras on the map per 1 000 inhabitants, ahead of
   * whom; who spends the most per inhabitant, against whom (« aussi » when the same). */
  private leadCommunes(cols: Col[], fs: FiguresCommune[]): RichItem[] {
    const out: RichItem[] = [];
    const p = fs.map((f) => (f.p1000 === null ? null : comme("p1000", f.p1000)));
    const o = classement(p);
    let premier = -1;
    if (o.length >= 2 && (p[o[0]] ?? 0) > 0) {
      const vTop = p[o[0]] ?? 0;
      const tete = o.filter((i) => p[i] === vTop);
      const reste = o.filter((i) => p[i] !== vTop);
      const noms = (l: number[]) => enPhrase(enumerer(l.map((i) => this.nomLien(cols[i], true))));
      if (!reste.length) {
        out.push(...phrase("comparer_a.lead_cam_egal", { autres: noms(tete), v: un(vTop) }));
      } else {
        if (tete.length === 1) premier = tete[0];
        const devant = reste.map((i) =>
          enPhrase(phrase("comparer_a.devant", { nom: this.nomLien(cols[i]), v: un(p[i] ?? 0) })),
        );
        out.push(
          ...phrase(tete.length === 1 ? "comparer_a.lead_cam" : "comparer_a.lead_cam_ex", {
            a: tete.length === 1 ? this.nomLien(cols[tete[0]], true) : noms(tete),
            v: un(vTop),
            autres: enPhrase(enumerer(devant)),
          }),
        );
      }
    }
    const e = fs.map((f) => (f.eph === null ? null : comme("eph", f.eph)));
    const oe = classement(e);
    if (oe.length) {
      const top = oe[0];
      const v: RichItem = { strong: euros(e[top] ?? 0) };
      if (oe.length === 1)
        out.push(...phrase("comparer_a.lead_eph_seule", { a: this.nomLien(cols[top], true), v }));
      else {
        const contre = oe
          .slice(1)
          .map((i) =>
            enPhrase(
              phrase("comparer_a.contre", { nom: this.nomLien(cols[i]), v: euros(e[i] ?? 0) }),
            ),
          );
        const autres = enPhrase(enumerer(contre));
        out.push(
          ...(top === premier
            ? phrase("comparer_a.lead_eph_aussi", { a: this.nomLien(cols[top]), v, autres })
            : phrase("comparer_a.lead_eph", { a: this.nomLien(cols[top], true), v, autres })),
        );
      }
    }
    return out;
  }

  /** The lead for companies: each one's contracts and their amount, in the address's order, then
   * the départements where they all have a client. */
  private leadEntreprises(cols: Col[], fs: FiguresEntreprise[], communs: number): RichItem[] {
    const parts = cols.map((c, i) => {
      const f = fs[i];
      const key = i === 0 ? "comparer_a.lead_ent" : "comparer_a.lead_ent_suite";
      return enPhrase(
        phrase(f.amt > 0 ? key : `${key}_sans`, {
          a: this.nomLien(c, true),
          n: i === 0 ? f.n : fr(f.n),
          m: montantA(f.amt),
        }),
      );
    });
    // the board's two: « A …, B … »; three or four: « A …, B … et C … »
    return [
      ...enumerer(parts, parts.length > 2),
      t("comparer_a.lead_ent_fin"),
      t("comparer_a.lead_deps", { n: communs }),
    ];
  }

  /** A row's cells: a figure per column, its bar against the row's maximum, its yellow; its
   * bubble (the column, the figure, how it is made) and its click (the column's fiche). */
  private cellules(
    k: string,
    label: string,
    vals: (number | null)[],
    txt: (v: number) => string,
    extra: (i: number) => {
      bl?: string;
      sub?: string;
      nonLu?: boolean;
      etat?: string;
      ancre?: string;
      /** the figure in its own words (« au moins 12 »), in place of `txt` */
      vu?: string;
    },
    /** a row that holds a minimum (« au moins N »): no highest value can be said, no yellow */
    sansJaune = false,
  ): Cell[] {
    // the yellow on the figures as written (Lélex's 4,15 and Lyon's 4,07 are both « 4,1 »)
    const top = sansJaune
      ? vals.map(() => false)
      : hauts(vals.map((v) => (v === null ? null : comme(k, v))));
    const bars = barres(vals);
    return this.colonnes().map((c, i) => {
      const v = vals[i];
      const x = extra(i);
      const href = c.href ? `${c.href}${x.ancre ?? ""}` : "";
      const etat = x.nonLu ? (x.etat ?? t("liste.non_lu")) : "";
      const vu = etat || x.vu || (v === null ? "—" : txt(v));
      const lignes = [
        `${label}\u00a0: ${vu}`,
        ...(x.bl ? [x.bl] : []),
        ...(top[i] ? [t("comparer_a.b_haut")] : []),
      ];
      return {
        cls: `v${top[i] ? " top" : ""} k-${k}`,
        span: null,
        nom: c.nom,
        tab: "0",
        bh: c.nom,
        bl: lignes.join("\n"),
        bc: href ? t("comparer_a.b_clic", { nom: c.nom }) : "",
        go: href,
        txt: x.nonLu ? "" : vu,
        nonLu: !!x.nonLu,
        etat,
        bar: bars[i] === null || x.nonLu ? "" : `width: ${bars[i]}%`,
        sub: x.sub ?? "",
        liste: null,
      };
    });
  }

  private groupesCommunes(cols: Col[], fs: FiguresCommune[]): Groupe[] {
    const X = this.props.X;
    const pops = cols.map((c) => X.dico.communes[c.id]?.pop ?? 0);
    const fmt: Record<KC, (v: number) => string> = {
      carte: fr,
      p1000: un,
      cam: fr,
      amt: montantA,
      eph: euros,
      con: fr,
      dr: fr,
      docs: fr,
    };
    const etats = cols.map((c) => this.couvC(c.id));
    const extra = (k: KC) => (i: number) => {
      const f = fs[i];
      // outside the map (overseas: no commune counted), « hors carte », never 0 (recette 10)
      const horsCarte = (k === "carte" || k === "p1000") && f.carte === null;
      const dep = X.dico.communes[cols[i].id]?.dep ?? "";
      // the decrees in the words of their served state (Ju 11/11): « pas encore lus » where its
      // département's are not read, « au moins N » or « aucun encore rattaché » where they are not
      // all attached to a commune, with the sentence that says why
      const dit = k === "cam" || k === "dr" ? ditActes(etats[i][k], f[k] ?? 0, dep) : null;
      // no number to show (not read, none attached yet): the cell's state mark, no bar
      const sansNombre = dit?.forme === "non_lu" || dit?.forme === "aucun_rattache";
      const nonLu = sansNombre || horsCarte;
      const min = dit?.forme === "au_moins" || dit?.forme === "aucun_rattache";
      return {
        ancre: ANCRE[k],
        nonLu,
        etat: horsCarte ? t("comparer_a.hors_carte") : sansNombre ? dit?.v : undefined,
        vu: min ? dit?.v : undefined,
        bl: horsCarte
          ? contracte(t("comparer_a.b_hors_carte", { nom: cols[i].nom }), cols[i].nom)
          : dit?.phrase
            ? `${dit.phrase}.`
            : k === "p1000" && f.carte !== null && pops[i]
              ? t("comparer_a.b_p1000", { n: fr(f.carte), p: fr(pops[i]) })
              : k === "eph" && f.eph !== null
                ? t("comparer_a.b_eph", { m: montantA(f.amt), p: fr(pops[i]) })
                : undefined,
        sub: min
          ? dit?.phrase
          : (k === "amt" || k === "eph") && !f.amt
            ? t("comparer_a.sans_contrat")
            : undefined,
      };
    };
    return GROUPES_C.map(([g, ks]) => ({
      l: t(`comparer_a.${g}`),
      lignes: ks.map((k) => {
        const label = t(`comparer_a.l_${k}`);
        // no contract in its name: « — » and its reason, no 0 € to put in yellow or compare
        const vals = fs.map((f) => (k === "amt" && !f.amt ? null : f[k]));
        return {
          l: label,
          s: t(`comparer_a.s_${k}`),
          vals: this.cellules(
            k,
            label,
            vals,
            fmt[k],
            extra(k),
            (k === "cam" || k === "dr") && etats.some((e) => e[k] === "non_rattache"),
          ),
        };
      }),
    }));
  }

  private groupesEntreprises(fs: FiguresEntreprise[], communs: string[]): Groupe[] {
    const n = fs.length;
    const fmt: Record<KE, (v: number) => string> = {
      amt: montantA,
      n: fr,
      moy: montantA,
      clientes: fr,
      deps: fr,
    };
    const extra = (k: KE) => (i: number) => ({
      bl:
        k === "moy" && fs[i].moy !== null
          ? t("comparer_a.b_moy", { m: montantA(fs[i].amt), n: fs[i].n })
          : undefined,
      sub: (k === "amt" || k === "moy") && !fs[i].amt ? t("comparer_a.sans_montant") : undefined,
    });
    const out: Groupe[] = GROUPES_E.map(([g, ks]) => ({
      l: t(`comparer_a.${g}`),
      lignes: ks.map((k) => {
        const cle = k === "amt" ? "amt_e" : k;
        const label = t(`comparer_a.l_${cle}`);
        const vals = fs.map((f) => (k === "amt" && !f.amt ? null : f[k]));
        return {
          l: label,
          s: t(`comparer_a.s_${cle}`),
          vals: this.cellules(k, label, vals, fmt[k], extra(k)),
        };
      }),
    }));
    if (n < 2) return out;
    // « Où elles se croisent »: their départements in common, each a link to its fiche
    const C = { couverture: this.props.couv };
    const nom = (d: string) => nomDep(C, d) || depNom(d);
    const montres = communs.slice(0, DEPS_MONTRES);
    out.push({
      l: t("comparer_a.g_croisent"),
      lignes: [
        {
          l: t("comparer_a.l_communs"),
          s: t("comparer_a.s_communs", { n }),
          vals: [
            {
              cls: "v span",
              span: n,
              nom: "",
              tab: null,
              bh: "",
              bl: "",
              bc: "",
              go: "",
              txt: fr(communs.length),
              nonLu: false,
              etat: "",
              bar: "",
              sub: "",
              liste: montres.length
                ? montres.map((d, i) => ({
                    href: departementHref(d),
                    l: d,
                    sep: i < montres.length - 1 ? ", " : "",
                    fin: i === montres.length - 1 && communs.length > montres.length ? "…" : "",
                    bh: nom(d),
                    bl: t("comparer_a.b_commun"),
                    bc: has(`registre.departement.du_${d}`)
                      ? t("comparer_a.b_clic_dep", { du: t(`departement.du_${d}`) })
                      : t("comparer_a.b_clic", { nom: nom(d) }),
                  }))
                : null,
            },
          ],
        },
      ],
    });
    return out;
  }

  /** « Ce que ces chiffres ne disent pas »: the map, the money, where the decrees are read. */
  private sources(cols: Col[]) {
    const X = this.props.X;
    const ds = [...new Set(cols.map((c) => X.dico.communes[c.id]?.dep ?? "").filter(Boolean))];
    // each département in the served state of its compared communes' decrees (Ju 11/11): read
    // (« lu »), read but not all attached to a commune (« non_rattache », each family its line),
    // not read (« non_lu »)
    const de = (d: string) => cols.filter((c) => X.dico.communes[c.id]?.dep === d);
    const etat = (d: string, k: "cam" | "dr", e: string) =>
      de(d).some((c) => this.couvC(c.id)[k] === e);
    const non = ds.filter((d) => etat(d, "cam", "non_lu") || etat(d, "dr", "non_lu"));
    const nrCam = ds.filter((d) => !non.includes(d) && etat(d, "cam", "non_rattache"));
    const nrDr = ds.filter((d) => !non.includes(d) && etat(d, "dr", "non_rattache"));
    const lus = ds.filter((d) => !non.includes(d));
    const dans = (l: string[]) => enPhrase(enumerer(l.map(dansDep)));
    const rows: { cls: string; b: string; d: RichItem[] }[] = [
      { cls: "part", b: t("comparer_a.src_carte_b"), d: [t("comparer_a.src_carte")] },
      { cls: "part", b: t("comparer_a.src_argent_b"), d: [t("comparer_a.src_argent")] },
    ];
    if (lus.length)
      rows.push({
        cls: "ok",
        b: t("comparer_a.src_arretes_b"),
        d: phrase("comparer_a.src_lus", { dans: dans(lus) }),
      });
    for (const [k, l] of [
      ["cam", nrCam],
      ["dr", nrDr],
    ] as const)
      if (l.length)
        rows.push({
          cls: "part",
          b: t("comparer_a.src_arretes_b"),
          d: phrase(`comparer_a.src_nr_${k}`, { dans: dans(l) }),
        });
    if (non.length)
      rows.push({
        cls: "part",
        b: t("comparer_a.src_arretes_b"),
        d: phrase("comparer_a.src_pas_lus", { dans: dans(non) }),
      });
    return {
      r: repli(
        this.state.open,
        "srcs",
        t("accueil.voir_detail"),
        rows.length,
        this.basculer,
        "card srcs",
      ),
      rows,
      note: t("comparer_a.sources_note", { d: jourCourt(X.maj) }),
    };
  }

  renderVals() {
    const S = this.state;
    const X = this.props.X;
    const m = this.mode === "communes";
    const cols = this.colonnes();
    const n = cols.length;
    const peut = n < MAX;

    let groupes: Groupe[];
    let lead: RichItem[];
    if (m) {
      const fs = cols.map((c) => this.figC(c.id));
      groupes = this.groupesCommunes(cols, fs);
      lead =
        n === 0
          ? [t("comparer_a.lead_vide_c")]
          : n === 1
            ? phrase("comparer_a.lead_un_c", { a: this.nomLien(cols[0], true) })
            : this.leadCommunes(cols, fs);
    } else {
      const fs = cols.map((c) => figuresEntreprise(X.lignes.entreprises[c.id]));
      const communs = this.communs();
      groupes = this.groupesEntreprises(fs, communs);
      lead =
        n === 0
          ? [t("comparer_a.lead_vide_e")]
          : n === 1
            ? phrase("comparer_a.lead_un_e", { a: this.nomLien(cols[0], true) })
            : this.leadEntreprises(cols, fs, communs.length);
    }

    const chemin = !m && n === 2 ? `/registre/chemin?de=${S.ids[0]}&a=${S.ids[1]}` : "";
    return {
      ...this.base("comparer"),
      lettres: coupeMots(t("comparer_a.titre")),
      choixL: t(m ? "comparer_a.choix_c" : "comparer_a.choix_e"),
      cols: cols.map((c) => ({
        nom: c.nom,
        href: c.href ?? "",
        sansFiche: !c.href,
        cls: m ? "ent com" : "ent",
        sub: m ? sousCommune(X, c.id) : [naf(X, c.id)],
        retirerL: t("comparer_a.retirer", { nom: c.nom }),
        retirer: (() => this.retirer(c.id)) as Handler,
      })),
      ap: peut ? this.ajout("picks", t(m ? "comparer_a.ajouter_c" : "comparer_a.ajouter_e")) : null,
      at: peut && n ? this.ajout("tete", t("comparer_a.ajouter")) : null,
      q: S.q,
      onQ: this.onQ,
      lead,
      // what the yellow means, under the lead (recette, amélioration 5: the table's own note is
      // far below it); only where a row can have a yellow, two columns or more
      // a row holding a minimum has none (« au moins N », Ju 11/11)
      jaune:
        n >= 2
          ? t(
              m &&
                cols.some((c) => Object.values(this.couvC(c.id)).some((e) => e === "non_rattache"))
                ? "comparer_a.jaune_min"
                : "comparer_a.jaune",
            )
          : "",
      actions: {
        cls: `actions${S.plus ? " plus" : ""}`,
        sansExport: n === 0,
        chemin,
        plus: !!chemin,
        plusOuvert: S.plus ? "true" : "false",
        basculer: (() => this.setState({ plus: !S.plus })) as Handler,
      },
      partager: ((ev: { currentTarget: Element }) => partager(this, ev.currentTarget)) as Handler,
      exporter: this.exporter,
      table: n
        ? {
            caption: t("comparer_a.caption", { noms: cols.map((c) => c.nom).join(", ") }),
            max: t(m ? "comparer_a.max_c" : "comparer_a.max_e"),
            span: n + 1 + (peut ? 1 : 0),
            groupes,
            note: t(m ? "comparer_a.note_c" : "comparer_a.note_e"),
          }
        : null,
      srcs: m && n ? this.sources(cols) : null,
    };
  }
}

/** ?entreprises= alone compares companies; anything else, communes. */
function modeDe(q: Record<string, string>): Mode {
  return q.entreprises !== undefined && q.communes === undefined ? "entreprises" : "communes";
}
function connu(X: Listes, m: Mode, id: string): boolean {
  return m === "communes"
    ? !!(X.lignes.communes[id] && X.dico.communes[id])
    : !!(X.lignes.entreprises[id] && X.dico.entreprises[id]);
}
/** « dans le Rhône »: the article's words, the name a plain link to its fiche (theme A's links,
 * not v2's square of the type). */
function dansDep(d: string): RichItem {
  const href = departementHref(d);
  const nom = depNom(d);
  const avec = has(`registre.departement.dans_${d}`) ? t(`departement.dans_${d}`) : nom;
  const i = avec.lastIndexOf(nom);
  return i > 0 && i + nom.length === avec.length
    ? enPhrase([avec.slice(0, i), { a: { href, text: nom } }])
    : { a: { href, text: avec } };
}

/** A company's activity (SIRENE's label of its NAF code), when the build has it. */
const naf = (X: Listes, siren: string): string =>
  (X.dico.entreprises[siren] as { naf_libelle?: string | null } | undefined)?.naf_libelle ?? "";

/** A commune's line under its name: its inhabitants, its intercommunality, a link for every
 * column (Ju 09/11: « uniformise »): to its fiche when it buys, else to the list of its communes
 * (the Métropole du Grand Paris has no fiche: it buys nothing in its name). */
function sousCommune(X: Listes, insee: string): RichItem[] {
  const x = X.dico.communes[insee];
  const e = x?.epci ?? "";
  const nom = e ? (X.dico.epcis?.[e]?.nom ?? X.dico.acheteurs[e]?.nom ?? "") : "";
  const ref = e ? (X.dico.epcis?.[e]?.ref ?? X.dico.acheteurs[e]?.ref) : undefined;
  // every size of commune: the list's own default (a strate) would leave out some of its members
  const href = ref
    ? `/registre/${ref}`
    : `/registre/communes?epci=${encodeURIComponent(e)}&taille=${TOUTES}`;
  return [
    t("comparer_a.hab", { n: fr(x?.pop ?? 0) }),
    ...(nom ? [" · ", { a: { href, text: nom } }] : []),
  ];
}

async function donnees(r: Route): Promise<Record<string, unknown>> {
  if (r.view !== "comparer") return {};
  const [X, couv] = await Promise.all([
    load<Listes>("listes.json"),
    load<CouvertureX>("couverture.json"),
  ]);
  return { X, couv };
}

export default {
  Vue: Comparer as unknown as VueModule["Vue"],
  template,
  donnees,
} satisfies VueModule;
