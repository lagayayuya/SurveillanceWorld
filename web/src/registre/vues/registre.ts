// View 1 · Registre · Documents (mockup Registre.dc.html, the prototype's vues/registre.js). The
// page opens on the build's index.json alone (counts, facets, the ten latest and ten largest
// documents); every document (recherche.json) comes when the reader searches, picks a filter, the
// second sort or more rows. The phone folds the filters behind « Filtres (N) » into a sheet.

import { communeHref } from "../commun.ts";
import {
  BADGE,
  badge,
  buyerHref,
  buyerNom,
  DEPS,
  DISPS,
  date,
  depNom,
  entName,
  type Figures,
  FK,
  figures,
  type Index,
  KINDS,
  type Kind,
  type Lexique,
  type Ligne,
  ligne,
  type Recherche,
} from "../corpus.ts";
import type { Rich } from "../dc.ts";
import { EI, load } from "../donnees.ts";
import { count, fr, money } from "../format.ts";
import { t } from "../i18n.ts";
import type { VueModule } from "../main.ts";
import type { Route } from "../routes.ts";
import { signaler } from "../signaler.ts";
import { plain } from "../texte.ts";
import { type BaseState, Vue } from "../vue.ts";
import template from "./registre.html?raw";

const WIDE = matchMedia("(min-width: 960px)");
const YEARS = ["2026", "2025", "2024", "2023", "2022", "2021", "2020", "2019", "2018", "<2018"];
type Fam = (typeof FK)[number];
type Filters = Record<Fam, string[]>;
const NONE: Filters = { t: [], d: [], y: [], p: [] };

type Tout = { R: Recherche; rows: Ligne[]; fig: Figures; byId: Map<string, Ligne> };
type Props = { q: Record<string, string>; index: Index };
type State = BaseState & {
  q: string;
  f: Filters;
  sort: "date" | "amt";
  lim: number;
  fOpen: boolean;
  tout: Tout | null;
  echec: boolean;
};

const label = (k: Fam, v: string): string =>
  k === "t"
    ? t(`registre.type_${v}`)
    : k === "d"
      ? v === "xx"
        ? t("registre.dep_autres")
        : depNom(v)
      : k === "p"
        ? t(`registre.disp_${v}`)
        : v === "<2018"
          ? t("registre.annee_avant_2018")
          : v;

/** The CSV's and the JSON's columns: the pilot's fields and the build's flags, as published. */
const COLS = [
  "id",
  "date",
  "date_precision",
  "nature",
  "objet",
  "montant_eur",
  "compte",
  "hors_totaux",
  "cameras",
  "cameras_voie_publique",
  "entreprises_siren",
  "entreprises",
  "beneficiaire",
  "beneficiaire_siren",
  "acheteur",
  "acheteur_siren",
  "commune_insee",
  "commune",
  "departement",
  "publie_par",
  "partage",
  "non_lu",
  "affaire",
  "reference",
  "url",
] as const;
type Col = (typeof COLS)[number];

function flat(L: Lexique, r: Ligne): Record<Col, string | number | boolean | null> {
  const e = r.e;
  const b = e.acheteur_siren ?? L.affaires?.[e.affaire]?.acheteur_siren ?? null;
  return {
    id: e.id,
    date: e.date_annee ? (e.date ?? "").slice(0, 4) : (e.date ?? null),
    date_precision: e.date_annee ? "annee" : "jour",
    nature: badge(e),
    objet: e.objet ?? null,
    montant_eur: e.montant ?? null,
    compte: !!e.compte,
    hors_totaux: e.hors_totaux || (e.national ? "national" : null),
    cameras: e.cameras ?? null,
    cameras_voie_publique: e.cameras_vp ?? null,
    entreprises_siren: (e.entreprises ?? []).filter((s) => s !== EI).join(" ") || null,
    entreprises: (e.entreprises ?? []).map((s) => entName(L, s)).join(" ; ") || null,
    beneficiaire: e.beneficiaire ? r.qui || null : null,
    beneficiaire_siren: e.beneficiaire_siren ?? null,
    acheteur: e.acheteur ?? (b ? buyerNom(L, b) : null),
    acheteur_siren: b,
    commune_insee: e.insee ?? null,
    commune: r.com || null,
    departement: e.dep ?? null,
    publie_par: e.publie_par ?? null,
    partage: (e.partage ?? []).join(" ") || null,
    non_lu: (e.non_lu ?? []).join(" ") || null,
    affaire: e.affaire,
    reference: e.ref ?? null,
    url: e.url ?? null,
  };
}

/** The selection as a file the browser makes (no dependency: a Blob and its object URL). */
function save(name: string, type: string, body: string): void {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.hidden = true;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function exporter(L: Lexique, rows: Ligne[], fmt: "csv" | "json", maj: string): void {
  const lines = rows.map((r) => flat(L, r));
  if (fmt === "csv") {
    const q = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const body = lines.map((l) => COLS.map((c) => q(l[c])).join(",")).join("\r\n");
    save("registre-selection.csv", "text/csv;charset=utf-8", `﻿${COLS.join(",")}\r\n${body}\r\n`);
  } else {
    const meta = {
      licence: t("registre.export_licence"),
      registre_mis_a_jour_le: maj,
      colonnes: COLS,
    };
    save(
      "registre-selection.json",
      "application/json",
      JSON.stringify({ meta, lignes: lines }, null, 1),
    );
  }
}

class Registre extends Vue<Props, State> {
  private esc = (ev: KeyboardEvent) => {
    if (ev.key === "Escape" && this.state.fOpen) this.setState({ fOpen: false });
  };
  private was = false;
  private asked: Promise<Tout> | null = null;
  private memo: { key: string; list: Ligne[]; facets: Record<Fam, Record<string, number>> } | null =
    null;

  protected init(p: Props): Partial<State> {
    const q = p.q ?? {};
    const split = (s?: string) => (s ? s.split(",").filter(Boolean) : []);
    return {
      q: q.q ?? "",
      f: { t: split(q.t), d: split(q.d), y: split(q.y), p: split(q.p) },
      sort: q.tri === "montant" ? "amt" : "date",
      lim: 10,
      fOpen: false,
      tout: null,
      echec: false,
    };
  }

  /** Every document, asked once; the list is drawn again when it comes. */
  private ensure(): Promise<Tout> {
    if (this.state.tout) return Promise.resolve(this.state.tout);
    if (!this.asked) {
      this.asked = load<Recherche>("recherche.json").then((R) => {
        const rows = R.evenements.map((e) => ligne(R, e));
        const tout = { R, rows, fig: figures(R), byId: new Map(rows.map((r) => [r.id, r])) };
        this.setState({ tout, echec: false });
        return tout;
      });
      this.asked.catch(() => {
        this.asked = null;
        this.setState({ echec: true });
      });
    }
    return this.asked;
  }
  /** A state change that needs every document: asked, and drawn now with what is there. */
  private ask(patch: Partial<State>): void {
    void this.ensure().catch(() => {});
    this.setState(patch);
  }

  componentDidMount(): void {
    addEventListener("keydown", this.esc);
    const S = this.state;
    if (S.q || S.sort === "amt" || FK.some((k) => S.f[k].length))
      void this.ensure().catch(() => {});
  }
  componentWillUnmount(): void {
    removeEventListener("keydown", this.esc);
    release();
  }
  componentDidUpdate(): void {
    // aria-modal says the rest of the page is out of reach: make it so (inert on every sibling up
    // the sheet's ancestors, the page's header included)
    release();
    const sheet = document.getElementById("r-filtres");
    if (this.state.fOpen && sheet && !WIDE.matches)
      for (let n: HTMLElement | null = sheet; n && n !== document.body; n = n.parentElement)
        for (const sib of n.parentElement?.children ?? [])
          if (sib !== n && sib instanceof HTMLElement && !sib.inert) {
            sib.inert = true;
            sib.setAttribute("data-inert-sheet", "");
          }
    if (this.state.fOpen === this.was) return;
    this.was = this.state.fOpen;
    const focus = this.state.fOpen
      ? sheet?.querySelector<HTMLElement>(".sheet-x")
      : document.querySelector<HTMLElement>('[aria-controls="r-filtres"]');
    focus?.focus();
  }

  /** The list, its facets' counts: once per search, filters and sort (not at every hover). */
  private compute(tout: Tout) {
    const S = this.state;
    const key = JSON.stringify([S.q, S.f, S.sort]);
    if (this.memo?.key === key) return this.memo;
    const F = S.f;
    const ok = (r: Ligne, skip: Fam | null) =>
      FK.every((k, i) => k === skip || !F[k].length || F[k].includes(r.key[i]));
    const q = plain(S.q.trim());
    const base = q ? tout.rows.filter((r) => r.words.includes(q)) : tout.rows;
    // each count leaves its own family out
    const facets = { t: {}, d: {}, y: {}, p: {} } as Record<Fam, Record<string, number>>;
    for (const r of base)
      FK.forEach((k, i) => {
        if (ok(r, k)) facets[k][r.key[i]] = (facets[k][r.key[i]] ?? 0) + 1;
      });
    const list = base
      .filter((r) => ok(r, null))
      .sort((a, b) =>
        S.sort === "amt"
          ? b.rank - a.rank || b.date.localeCompare(a.date)
          : b.date.localeCompare(a.date),
      );
    this.memo = { key, list, facets };
    return this.memo;
  }

  renderVals() {
    const S = this.state;
    const F = S.f;
    const I = this.props.index;
    const tout = S.tout;
    const busy = !!(S.q.trim() || S.sort === "amt" || FK.some((k) => F[k].length));
    // at rest, or while every document is on its way: the index's rows and counts
    const L: Lexique = tout?.R ?? I.dico;
    let list: Ligne[];
    let total: number;
    let facetN: (k: Fam, v: string) => number;
    if (tout) {
      const c = this.compute(tout);
      list = c.list;
      total = list.length;
      facetN = (k, v) => c.facets[k][v] ?? 0;
    } else {
      list = (S.sort === "amt" ? I.gros : I.recents).map((e) => ligne(I.dico, e));
      total = I.totaux.docs;
      facetN = (k, v) => I.facettes[k][v] ?? 0;
    }
    const waiting = !tout && busy;

    const tog = (k: Fam, v: string) => () => {
      const cur = F[k];
      const nx = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v];
      this.ask({ f: { ...F, [k]: nx }, lim: 10, sel: null });
    };
    // a filter without result is hidden, unless it is checked
    const mkFacet = (k: Fam, vals: string[]) => ({
      l: t(`registre.facette_${k}`),
      opts: vals
        .map((v) => {
          const on = F[k].includes(v);
          const n = facetN(k, v);
          return {
            on,
            n,
            l: label(k, v),
            pressed: on ? "true" : "false",
            mark: on ? "✓" : "",
            cls: `fopt${n || on ? "" : " zero"}`,
            pick: tog(k, v),
          };
        })
        .filter((o) => o.n || o.on)
        .map((o) => ({ ...o, n: fr(o.n) })),
    });
    const facets = [
      mkFacet("t", KINDS),
      mkFacet("d", [...DEPS, "xx"]),
      mkFacet("p", DISPS),
      mkFacet("y", YEARS),
    ];

    const zone = t("arretes.zone_non_deduite");
    const rows = list.slice(0, S.lim).map((r) => {
      const e = r.e;
      const qui = r.qui && plain(r.qui) !== plain(r.com) ? r.qui : "";
      return {
        date: date(e),
        // the discreet mark: a date the build reads otherwise (date_lue)
        dm: e.date_lue ? t("repere.date") : "",
        type: badge(e),
        badge: BADGE[r.k] ?? "",
        title: r.title,
        amt: r.amt
          ? money(r.amt)
          : e.cameras != null && e.t === "arrete"
            ? count(e.cameras, "camera")
            : "",
        meta: [
          r.com || depNom(e.dep),
          qui,
          r.ents,
          e.non_lu?.includes("zone_non_deduite") ? zone : "",
        ]
          .filter(Boolean)
          .join(" · "),
        href: r.href,
        cls: `res${S.sel === r.id ? " on" : ""}`,
        hover: this.pick(r.id),
      };
    });

    const chips: { l: string; aria: string; drop: () => void }[] = [];
    if (S.q)
      chips.push({
        l: t("registre.chip_q", { q: S.q }),
        aria: t("registre.chip_effacer"),
        drop: () => this.setState({ q: "", lim: 10, sel: null }),
      });
    for (const k of FK)
      for (const v of F[k])
        chips.push({
          l: label(k, v),
          aria: t("registre.chip_retirer", { l: label(k, v) }),
          drop: tog(k, v),
        });

    const countLabel = waiting
      ? t(S.echec ? "registre.echec" : "registre.recherche_en_cours")
      : count(total, "document");
    const sorts = (
      [
        ["date", t("registre.tri_date")],
        ["amt", t("registre.tri_montant")],
      ] as const
    ).map(([k, l]) => ({
      l,
      pressed: S.sort === k ? "true" : "false",
      pick: () => (k === "amt" ? this.ask({ sort: k }) : this.setState({ sort: k })),
      style:
        S.sort === k
          ? "background: var(--fg); color: var(--bg)"
          : "background: var(--bg-2); color: var(--fg)",
    }));

    const sug = tout ? suggestions(tout, plain(S.q.trim())) : [];

    // the panel: the hovered document, else the selection and its download
    const sr = S.sel ? (tout?.byId.get(S.sel) ?? list.find((r) => r.id === S.sel)) : undefined;
    const nT = (k: Kind) =>
      fr(tout ? list.reduce((n, r) => n + (r.k === k ? 1 : 0), 0) : I.totaux[k]);
    const dl = (fmt: "csv" | "json") => ({
      l: t(`registre.telecharger_${fmt}`),
      href: "#",
      act: (ev: { preventDefault(): void }) => {
        ev.preventDefault();
        // a failed load sets echec (ensure), it is not left as an unhandled rejection
        this.ensure()
          .then((all) => exporter(all.R, this.compute(all).list, fmt, I.maj))
          .catch(() => {});
      },
    });
    let det: Record<string, unknown> = {
      kicker: t("registre.panneau_kicker"),
      title: countLabel,
      rows: [
        { k: t("registre.panneau_contrats"), v: nT("con") },
        { k: t("registre.panneau_ao"), v: nT("ao") },
        { k: t("registre.panneau_arretes"), v: nT("aut") },
        { k: t("registre.panneau_subventions"), v: nT("sub") },
      ],
      links: [dl("csv"), dl("json")],
    };
    if (sr) det = detail(L, sr);

    const kpis = KINDS.map((k) => {
      const on = F.t.length === 1 && F.t[0] === k;
      return {
        v: fr(I.totaux[k]),
        l: t(`registre.kpi_${k}`),
        pressed: on ? "true" : "false",
        pick: () => this.ask({ f: { ...F, t: on ? [] : [k] }, lim: 10, sel: null }),
      };
    });
    const nf = FK.reduce((a, k) => a + F[k].length, 0);
    const arretes = list.slice(0, S.lim).some((r) => r.k === "aut");
    const nonLus: Rich = [
      {
        a: { href: "/registre/couverture#non-lus", text: t("registre.non_lus", { n: I.non_lus }) },
      },
    ];

    return {
      ...this.base("registre"),
      ...this.info("scope"),
      maj: I.maj.split("-").reverse().join("/"),
      ndocs: fr(I.totaux.docs),
      kpis,
      q: S.q,
      onQ: (e: { value: string }) => this.ask({ q: e.value, lim: 10, sel: null }),
      sug,
      hasSug: sug.length > 0,
      chips,
      hasChips: chips.length > 0,
      clear: () => this.setState({ q: "", f: NONE, lim: 10, sel: null }),
      // the phone: the filters fold behind « Filtres (N) » and open as a sheet (Escape or « Voir » closes it)
      fOpen: S.fOpen ? "true" : "false",
      fCls: S.fOpen ? "ouvert" : "",
      fRole: S.fOpen ? "dialog" : "region",
      fModal: S.fOpen ? "true" : null,
      nfTxt: nf ? ` (${nf})` : "",
      fOuvrir: () => this.setState({ fOpen: true }),
      fFermer: () => this.setState({ fOpen: false }),
      countLabel,
      sorts,
      facets,
      rows,
      noRows: rows.length === 0 && !waiting,
      hasMore: total > S.lim,
      more: () => this.ask({ lim: S.lim + 10 }),
      arretes,
      nonLus,
      det,
    };
  }
}

/** The page's other parts out of reach while the sheet is open, and back after. */
function release(): void {
  for (const n of document.querySelectorAll<HTMLElement>("[data-inert-sheet]")) {
    n.inert = false;
    n.removeAttribute("data-inert-sheet");
  }
}

/** « Aller directement à »: communes, a département, companies, a buyer whose name starts so. */
function suggestions(tout: Tout, q: string) {
  if (q.length < 2) return [];
  const { R, fig } = tout;
  const cs = Object.values(fig.coms)
    .filter((c) => plain(R.communes[c.insee]?.nom).startsWith(q))
    .sort((a, b) => b.docs - a.docs)
    .slice(0, 2)
    .map((c) => {
      const x = R.communes[c.insee];
      return {
        kind: t("registre.sug_commune"),
        tagStyle: "background: #ffe800",
        nom: x.nom,
        meta: `${depNom(x.dep)} · ${count(c.docs, "document")}`,
        href: communeHref(c.insee),
      };
    });
  const ds = DEPS.filter((k) => plain(depNom(k)).startsWith(q))
    .slice(0, 1)
    .map((k) => ({
      kind: t("registre.sug_departement"),
      tagStyle: "background: #ffb36b",
      nom: depNom(k),
      meta: k,
      href: `/registre/departement/${k}`,
    }));
  const es = Object.values(fig.ents)
    .filter((o) => o.n && !R.entreprises[o.siren]?.entrepreneur_individuel)
    .filter((o) => plain(entName(R, o.siren)).includes(q))
    .sort((a, b) => b.n - a.n)
    .slice(0, 2)
    .map((o) => ({
      kind: t("registre.sug_entreprise"),
      tagStyle: "background: #c9b8ff",
      nom: entName(R, o.siren),
      meta: count(o.n, "contrat"),
      href: `/registre/entreprise/${o.siren}`,
    }));
  const bs = Object.values(fig.buyers)
    .filter((o) => o.n && R.acheteurs[o.siren]?.categorie !== "commune")
    .filter((o) => plain(buyerNom(R, o.siren)).includes(q))
    .sort((a, b) => b.n - a.n)
    .slice(0, 1)
    .map((o) => ({
      kind: t("registre.sug_acheteur"),
      tagStyle: "background: #9be7c4",
      nom: buyerNom(R, o.siren),
      meta: count(o.n, "contrat"),
      href: buyerHref(R, o.siren),
    }));
  return [...cs, ...ds, ...es, ...bs].slice(0, 4);
}

/** The panel on a document: what it is, who, how much, and where to read it. */
function detail(L: Lexique, r: Ligne) {
  const e = r.e;
  const aut = r.k === "aut";
  const unread = e.non_lu?.includes("nombre_illisible");
  const commune = !!(e.insee && L.communes[e.insee]);
  const fiche = aut
    ? commune
      ? "l_autorisations"
      : "l_arrete"
    : r.k === "sub"
      ? "l_subvention"
      : r.k === "ao"
        ? "l_ao"
        : "l_contrat";
  const links: { l: string; href: string }[] = [{ l: t(`registre.${fiche}`), href: r.href }];
  if (e.url) links.push({ l: aut ? t("arretes.voir") : t("registre.l_source"), href: e.url });
  links.push(signaler(e));
  return {
    kicker: `${badge(e)} · ${date(e)}`,
    title: r.title,
    rows: [
      { k: t("registre.d_commune"), v: r.com || t("registre.d_non_rattache") },
      {
        k: t(aut ? "registre.d_beneficiaire" : "registre.d_acheteur"),
        v: r.qui || t("registre.d_non_publie"),
      },
      { k: t("registre.d_entreprise"), v: r.ents || "—" },
      aut
        ? {
            k: t(e.t === "arrete_drone" ? "registre.d_appareils" : "registre.d_cameras"),
            v: e.cameras != null ? fr(e.cameras) : unread ? t("registre.d_nombre_non_lu") : "—",
          }
        : { k: t("registre.d_montant"), v: money(e.montant) },
      { k: t("registre.d_dispositif"), v: t(`registre.disp_${r.key[3]}`) },
      { k: t("registre.d_reference"), v: e.ref || "—" },
    ],
    links,
  };
}

async function donnees(_r: Route): Promise<Record<string, unknown>> {
  return { index: await load<Index>("index.json") };
}

export default {
  // the shell gives every view its route and its data as one record
  Vue: Registre as unknown as VueModule["Vue"],
  template,
  donnees,
} satisfies VueModule;
