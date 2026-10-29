// A commune's Documents (/registre/commune/<insee>/documents; mockup Documents-grand, prototype
// vues/documents.js): every document of the commune in one table, its filters (type, who, year) kept in
// the path's query (?t=…&qui=…&y=…), the panel of the row hovered, focused or touched, the selection
// downloaded as CSV or JSON. The rules (the commune's own, a masked name, a decree not read entirely, a
// reviewed date) are the build's flags, read here, never recomputed.

import {
  benefLabel,
  commune,
  communeHref,
  type Donnees,
  filCommune,
  isArr,
  sortKey,
  tete,
} from "../commun.ts";
import type { Rich } from "../dc.ts";
import type { Evenement } from "../donnees.ts";
import { addMonths, count, docDate, fr, money, shortDate } from "../format.ts";
import { t } from "../i18n.ts";
import type { VueModule } from "../main.ts";
import type { Route } from "../routes.ts";
import { signaler } from "../signaler.ts";
import { plain, sentence, tidy, titleCase } from "../texte.ts";
import { type BaseState, Vue } from "../vue.ts";
import template from "./documents.html?raw";

type Props = Extract<Route, { view: "documents" }> & { d: Donnees };
type Facet = "type" | "qui" | "an";
type Filters = Record<Facet, Record<string, boolean>>;
type State = BaseState & {
  sort: "date" | "fig";
  dir: number;
  f: Filters;
  /** « Copier la référence »: "" until clicked, then copied or only selected. */
  copied: "" | "copiee" | "selectionnee";
};
type Row = {
  e: Evenement;
  id: string;
  g: string;
  qk: string;
  an: string;
  qui: string;
  quiR: Rich;
  ent: string;
  entR: Rich;
  objet: string;
  amt: number | null;
  cam: number | null;
};

const AO = /^(avis|resultat|rectificatif)$/;
/** The families of the « Type » filter, one word per perimeter (the kit, § 3). */
const FAMS = ["con", "mod", "ao", "aut", "dr", "arr", "sub"];
/** Who: the mairie, another public buyer, the State (a decree's beneficiary), a company or a shop, a
 * name not published. */
const QUIS = ["m", "o", "e", "p", "n"];
/** The query's keys, as the other pages link here (prototype: ?qui=p,n&t=aut, ?y=2026). */
const QUERY: Record<Facet, string> = { type: "t", qui: "qui", an: "y" };

const fam = (e: Evenement): string =>
  e.t === "attribution"
    ? "con"
    : e.t === "modification"
      ? "mod"
      : AO.test(e.t)
        ? "ao"
        : e.t === "arrete"
          ? "aut"
          : e.t === "arrete_drone"
            ? "dr"
            : e.t.startsWith("arrete")
              ? "arr"
              : "sub";
/** The kit's five badges (§ 4): a result or a correction is a call for tenders, an act an authorisation. */
const badge = (e: Evenement): string =>
  e.t === "attribution"
    ? "con"
    : e.t === "modification"
      ? "mod"
      : AO.test(e.t)
        ? "ao"
        : e.t.startsWith("arrete")
          ? "aut"
          : "sub";
const BADGE: Record<string, string> = {
  con: "background: var(--fg); color: var(--bg)",
  mod: "background: transparent; color: var(--fg)",
  ao: "background: var(--ao); color: var(--ao-ink); border-color: var(--ao)",
  aut: "background: var(--aut); color: var(--aut-ink); border-color: var(--aut)",
  sub: "background: var(--sub); color: var(--sub-ink); border-color: var(--sub)",
};
const typeLabel = (e: Evenement): string =>
  t(
    `documents.type_${e.t.startsWith("arrete") ? "arrete" : e.t.startsWith("subvention") ? "subvention" : e.t}`,
  );

/** A document's title: a decree by what it authorises, anything else by its published object. */
function titre(e: Evenement): string {
  if (e.t === "arrete_drone") {
    const n = e.partage?.length ?? 0;
    return n
      ? `${t("documents.titre_drones")} · ${t("documents.partage", { n })}`
      : t("documents.titre_drones");
  }
  if (e.t === "arrete_pietons") return t("documents.titre_pietons");
  if (e.t === "arrete_vsa") return t("documents.titre_vsa");
  if (e.t === "arrete")
    return e.cameras != null
      ? t("documents.titre_cameras", { n: e.cameras })
      : t("documents.titre_cameras_nc");
  return sentence(e.objet) || t("documents.objet_non_publie");
}

/** A document's own page in the register: a decree its dossier in the Autorisations tab, anything else
 * its record (lot R1b). */
function docHref(e: Evenement, insee: string): string {
  const a = encodeURIComponent(e.affaire);
  return e.t.startsWith("arrete")
    ? `${communeHref(insee, "autorisations")}/${a}`
    : `/registre/contrat/${a}`;
}

/** Why a decree could not be read entirely, in words. */
const nonLu = (e: Evenement): string[] => (e.non_lu ?? []).map((c) => t(`non_lu.${c}`));

/** The filters a query asks for (?t=aut&qui=p,n&y=2026). */
function filtersOf(q: Record<string, string> = {}): Filters {
  const pre = (k: string) =>
    Object.fromEntries(
      (q[k] ?? "")
        .split(",")
        .filter(Boolean)
        .map((v) => [v, true]),
    );
  return { type: pre(QUERY.type), qui: pre(QUERY.qui), an: pre(QUERY.an) };
}
/** The same filters back in the path's query. */
function queryOf(f: Filters): string {
  const q = new URLSearchParams();
  for (const k of ["type", "qui", "an"] as Facet[]) {
    const on = Object.keys(f[k]).filter((v) => f[k][v]);
    if (on.length) q.set(QUERY[k], on.join(","));
  }
  const s = q.toString().replace(/%2C/g, ",");
  return s ? `?${s}` : "";
}

class Documents extends Vue<Props, State> {
  private _rows: Row[] | null = null;

  protected init(p: Props): Partial<State> {
    return { sort: "date", dir: -1, f: filtersOf(p.q), copied: "" };
  }

  titre(): string {
    return t("documents.titre", { nom: this.props.d.f.commune.nom });
  }

  private rows(): Row[] {
    if (this._rows) return this._rows;
    const d = this.props.d;
    const insee = d.insee;
    const nom = d.f.commune.nom;
    this._rows = d.all.map((e) => {
      const isA = isArr(e);
      const isSub = e.t.startsWith("subvention");
      const masked = e.beneficiaire === "[non retenu]" || e.nom_publie === false;
      const qk = isA
        ? e.communal
          ? "m"
          : masked
            ? "n"
            : e.type_beneficiaire === "etat"
              ? "e"
              : "p"
        : isSub || e.communal
          ? "m"
          : "o";
      const buyer = !isA && !isSub ? d.buyer(e) : null;
      const qui =
        qk === "m"
          ? isA && e.type_beneficiaire === "epci"
            ? benefLabel(e)
            : t("documents.mairie_de", { nom })
          : qk === "n"
            ? t("commun.nom_non_publie")
            : isA
              ? benefLabel(e)
              : buyer
                ? d.buyerNom(buyer)
                : tidy(titleCase(String(e.acheteur ?? "")));
      // names are links (the buyer when it is not the mairie, the companies); the panel keeps the text
      const link = (href: string, text: string): Rich => [{ a: { href, text, cls: "nom" } }];
      const quiR: Rich =
        qk === "o" && buyer
          ? link(d.buyerHref(buyer), qui)
          : qk === "m"
            ? link(communeHref(insee), qui)
            : qui;
      const sirens =
        (e.t === "attribution" || e.t === "modification") && e.entreprises?.length
          ? e.entreprises
          : [];
      const entR: Rich = sirens.length
        ? [
            "→ ",
            ...sirens.flatMap((s, i) => [
              ...(i ? [", "] : []),
              { a: { href: `/registre/entreprise/${s}`, text: d.entName(s), cls: "nom" } },
            ]),
          ]
        : "";
      return {
        e,
        id: e.id,
        g: fam(e),
        qk,
        an: (e.date ?? "").slice(0, 4),
        qui,
        quiR,
        ent: sirens.map((s) => d.entName(s)).join(", "),
        entR,
        objet: titre(e),
        amt: e.t === "attribution" || e.t === "modification" || isSub ? (e.montant ?? null) : null,
        cam: e.t === "arrete" ? (e.cameras ?? null) : null,
      };
    });
    return this._rows;
  }

  /** The filters changed: drawn, and kept in the path (replaced, not a new step of the history). */
  private setFilters(f: Filters): void {
    this.setState({ f });
    const path = `${location.pathname}${queryOf(f)}${location.hash}`;
    if (path !== `${location.pathname}${location.search}${location.hash}`)
      history.replaceState(history.state, "", path);
  }

  /** « Copier la référence »: the clipboard, else the reference selected in the panel. */
  private copy(ref: string): void {
    const select = () => {
      const el = [...document.querySelectorAll(".panel .prow strong")].find(
        (x) => x.textContent === ref,
      );
      const sel = getSelection();
      if (el && sel) {
        sel.selectAllChildren(el);
        this.setState({ copied: "selectionnee" });
      }
    };
    try {
      if (!navigator.clipboard) throw new Error("no clipboard");
      navigator.clipboard.writeText(ref).then(() => this.setState({ copied: "copiee" }), select);
    } catch {
      select();
    }
  }

  renderVals() {
    const S = this.state;
    const d = this.props.d;
    const insee = d.insee;
    const nom = d.f.commune.nom;
    const all = this.rows();
    const F = S.f;
    const val = (r: Row, k: Facet) => (k === "type" ? r.g : k === "qui" ? r.qk : r.an);
    const pass = (r: Row, skip: Facet | null) =>
      (["type", "qui", "an"] as Facet[]).every((k) => {
        if (k === skip) return true;
        const sel = Object.keys(F[k]).filter((x) => F[k][x]);
        return !sel.length || sel.includes(val(r, k));
      });
    const pick = (k: Facet, v: string) => () => {
      const nf: Filters = { type: { ...F.type }, qui: { ...F.qui }, an: { ...F.an } };
      nf[k][v] = !nf[k][v];
      this.setFilters(nf);
    };
    const present = (k: Facet) => new Set(all.map((r) => val(r, k)));
    const FD: [Facet, string, [string, string][]][] = [
      [
        "type",
        t("documents.facette_type"),
        FAMS.filter((v) => present("type").has(v)).map((v) => [v, t(`documents.fam_${v}`)]),
      ],
      [
        "qui",
        t("documents.facette_qui"),
        QUIS.filter((v) => present("qui").has(v)).map((v) => [v, t(`documents.qui_${v}`)]),
      ],
      [
        "an",
        t("documents.facette_annee"),
        [...present("an")]
          .filter(Boolean)
          .sort()
          .reverse()
          .map((v) => [v, v]),
      ],
    ];
    const facets = FD.map(([k, l, items]) => ({
      l,
      items: items.map(([v, lab]) => {
        const n = all.filter((r) => pass(r, k) && val(r, k) === v).length;
        const c = !!F[k][v];
        return {
          l: lab,
          n: fr(n),
          checked: c ? "true" : "false",
          mark: c ? "✓" : "",
          pick: pick(k, v),
          style: n === 0 && !c ? "opacity: .45" : "",
        };
      }),
    }));

    const list = all.filter((r) => pass(r, null));
    const key =
      S.sort === "fig"
        ? (r: Row) => (r.amt != null ? 1e12 + r.amt : r.cam != null ? r.cam : -1)
        : (r: Row) => sortKey(r.e);
    list.sort((a, b) => {
      const va = key(a);
      const vb = key(b);
      return (va > vb ? 1 : va < vb ? -1 : 0) * S.dir;
    });
    const rows = list.map((r) => {
      const e = r.e;
      const reasons = nonLu(e);
      return {
        date: docDate(e.date, e.date_annee),
        flag: !!e.date_lue && e.date_lue !== e.date,
        type: typeLabel(e),
        bs: BADGE[badge(e)],
        objet: r.objet,
        href: docHref(e, insee),
        qui: r.quiR,
        quiStyle: r.qk === "n" ? "font-style: italic; color: var(--muted)" : "",
        ent: r.entR,
        fig: r.amt != null ? money(r.amt) : r.cam != null ? fr(r.cam) : "—",
        // an amount shows alone (DECISIONS 2026-10-28, discreet mentions); a decree not read entirely,
        // its reason and its source (DECISIONS 2026-10-28, decrees that could not be read)
        figL: (r.amt != null
          ? ""
          : r.cam != null
            ? t("documents.cameras", { n: r.cam })
            : reasons.length
              ? [
                  reasons.join(" · "),
                  ...(e.url
                    ? [{ br: true }, { a: { href: e.url, text: t("documents.source") } }]
                    : []),
                ]
              : "") as Rich,
        cls: `r${S.sel === r.id ? " on" : ""}`,
        hover: () => {
          if (S.sel !== r.id) this.setState({ sel: r.id, copied: "" });
        },
      };
    });
    const cols = this.cols(
      [
        ["date", t("documents.col_date"), "", "width: 112px"],
        ["", t("documents.col_document"), "", ""],
        ["", t("documents.col_qui"), "", "width: 140px"],
        ["fig", t("documents.col_fig"), "num", "width: 120px"],
      ],
      "sort",
      "dir",
    );

    const sel = S.sel ? all.find((x) => x.id === S.sel) : undefined;
    const det = sel ? this.panel(sel) : this.rest(all);

    const nf = Object.values(F).reduce((a, o) => a + Object.values(o).filter(Boolean).length, 0);
    const exp = (fmt: "csv" | "json") => (ev: { preventDefault(): void }) => {
      ev.preventDefault();
      exportRows(
        d,
        list.map((x) => x.e),
        fmt,
        `${plain(nom).replace(/[^a-z0-9]+/g, "-")}-documents`,
      );
    };
    return {
      ...this.base("documents"),
      ...this.info("np", "dl"),
      ...filCommune(d, t("documents.fil")),
      com: tete(d, "doc"),
      facets,
      rows,
      cols,
      det,
      empty: all.length > 0 && list.length === 0,
      aucun: all.length === 0,
      // decrees in the list: the one line on their reading (DECISIONS 2026-10-28, no human review)
      arretes: list.some((r) => isArr(r.e)),
      countLabel: nf
        ? t("documents.compte_sur", { n: list.length, total: fr(all.length) })
        : count(all.length, "document"),
      dlLabel: nf ? t("documents.telecharger_selection") : t("documents.telecharger"),
      dl: { csv: exp("csv"), json: exp("json") },
      clear: () => this.setFilters({ type: {}, qui: {}, an: {} }),
    };
  }

  /** The panel at rest: the commune's documents by family, and their years. */
  private rest(all: Row[]) {
    const nom = this.props.d.f.commune.nom;
    const c = (k: string) => all.filter((x) => x.g === k).length;
    const ys = all
      .map((x) => x.an)
      .filter(Boolean)
      .sort();
    return {
      kicker: `${nom} · ${count(all.length, "document")}`,
      title: t("documents.survolez"),
      rows: FAMS.filter((k) => c(k))
        .map((k) => ({ k: t(`documents.fam_${k}`), v: fr(c(k)) }))
        .concat(
          ys.length
            ? [
                {
                  k: t("documents.plus_ancien"),
                  v: t("documents.annees", { a: ys[0], b: ys[ys.length - 1] }),
                },
              ]
            : [],
        ),
    };
  }

  /** The panel of one document: its facts, its links, its reference to copy. */
  private panel(r: Row) {
    const d = this.props.d;
    const e = r.e;
    const isA = isArr(e);
    const isSub = e.t.startsWith("subvention");
    const a = d.affaire(e.affaire);
    const rows: [string, string][] = [
      [t("documents.p_date"), docDate(e.date, e.date_annee)],
      [t("documents.p_type"), typeLabel(e)],
      [isA ? t("documents.p_beneficiaire") : t("documents.p_acheteur"), r.qui],
    ];
    if (r.ent) rows.push([t("documents.p_entreprise"), r.ent]);
    if (r.amt != null)
      rows.push([
        isSub ? t("documents.p_montant_subvention") : t("documents.p_montant"),
        money(r.amt),
      ]);
    if (e.t === "attribution") {
      rows.push([
        t("documents.p_duree_publiee"),
        e.duree != null && e.duree !== ""
          ? t("documents.mois", { n: Number(e.duree) })
          : t("documents.non_publiee"),
      ]);
      rows.push([
        t("documents.p_offres"),
        e.offres != null ? String(e.offres) : t("format.non_publie"),
      ]);
    }
    if (e.t === "modification") {
      const ch = (e.changements as string[] | undefined) ?? [];
      rows.push([
        t("documents.p_changements"),
        ch.length ? ch.join(" ; ") : t("documents.aucun_changement"),
      ]);
    }
    if (e.t === "arrete") {
      if (r.cam != null) rows.push([t("documents.p_cameras"), fr(r.cam)]);
      if (e.cameras_vp != null || e.cameras_int != null)
        rows.push([
          t("documents.p_repartition"),
          [e.cameras_vp, e.cameras_int, e.cameras_ext]
            .map((x) => (x == null ? "—" : fr(x)))
            .join(" · "),
        ]);
      rows.push([t("documents.p_duree"), e.duree || t("documents.non_precisee")]);
    }
    const reasons = nonLu(e);
    if (reasons.length) rows.push([t("documents.p_non_lu"), reasons.join(" · ")]);
    const maj = d.f.couverture.maj;
    const probable = typeof a?.contrat_probable === "string" ? a.contrat_probable : "";
    if (e.t === "avis" && a?.kind === "contrat_non_retrouve")
      rows.push([
        t("documents.p_contrat_suivi"),
        probable
          ? t("repere.lien")
          : e.date && maj && e.date > addMonths(maj, -18)
            ? t("documents.pas_encore_publie")
            : t("documents.non_retrouve"),
      ]);
    if (e.ref) rows.push([t("documents.p_reference"), e.ref]);

    const nom = d.f.commune.nom;
    const links: { l: string; href: string }[] = [
      {
        l: isA
          ? t("documents.lien_autorisations", { nom })
          : AO.test(e.t)
            ? t("documents.lien_parcours")
            : isSub
              ? t("documents.lien_subvention")
              : t("documents.lien_contrat"),
        href: docHref(e, d.insee),
      },
    ];
    if (probable)
      links.push({
        l: t("documents.lien_contrat_suivi"),
        href: `/registre/contrat/${encodeURIComponent(probable)}`,
      });
    if (isA) {
      if (e.url) links.push({ l: t("arretes.voir"), href: e.url });
    } else if (e.url) links.push({ l: t("documents.lien_source"), href: e.url });
    links.push(signaler(e));

    // what the panel explains, discreetly: a date to check, the money line
    const foot = [
      e.date_lue && e.date_lue !== e.date
        ? t("documents.date_a_verifier", { date: shortDate(e.date_lue) })
        : "",
      r.amt != null && !isSub ? t("argent.enveloppe") : "",
    ]
      .filter(Boolean)
      .join(" ");
    const ref = e.ref ?? "";
    return {
      kicker: `${typeLabel(e)} · ${docDate(e.date, e.date_annee)}`,
      title: r.objet,
      rows: rows.map(([k, v]) => ({ k, v })),
      foot,
      links,
      btn: ref
        ? {
            l:
              this.state.copied === "copiee"
                ? t("documents.reference_copiee")
                : this.state.copied === "selectionnee"
                  ? t("documents.reference_selectionnee")
                  : t("documents.copier_reference"),
            act: () => this.copy(ref),
          }
        : null,
    };
  }
}

// --- the download: the selection as CSV or JSON (prototype app.js exportRows) ------------------------
const COLS = [
  "id",
  "date",
  "date_precision",
  "nature",
  "objet",
  "acheteur",
  "beneficiaire",
  "beneficiaire_siren",
  "entreprises_siren",
  "entreprises",
  "montant_eur",
  "cameras",
  "cameras_voie_publique",
  "commune_insee",
  "departement",
  "affaire",
  "lecture_incomplete",
  "reference",
  "url",
] as const;

function exportRows(d: Donnees, es: Evenement[], fmt: "csv" | "json", name: string): void {
  const flat = es.map((e): Record<(typeof COLS)[number], string | number> => {
    const isA = isArr(e);
    const b = !isA ? d.buyer(e) : null;
    return {
      id: e.id,
      date: e.date_annee ? (e.date ?? "").slice(0, 4) : (e.date ?? ""),
      date_precision: e.date_annee ? t("documents.export_annee") : t("documents.export_jour"),
      nature: typeLabel(e),
      objet: isA ? titre(e) : (e.objet ?? ""),
      acheteur: isA ? "" : b ? d.buyerNom(b) : (e.acheteur ?? ""),
      beneficiaire: isA ? benefLabel(e) : "",
      beneficiaire_siren: isA && e.nom_publie !== false ? (e.beneficiaire_siren ?? "") : "",
      entreprises_siren: (e.entreprises ?? []).join(" "),
      entreprises: (e.entreprises ?? []).map((s) => d.entName(s)).join(" ; "),
      montant_eur:
        e.t === "attribution" || e.t === "modification" || e.t.startsWith("subvention")
          ? (e.montant ?? "")
          : "",
      cameras: e.cameras ?? "",
      cameras_voie_publique: e.cameras_vp ?? "",
      commune_insee: e.insee ?? "",
      departement: e.dep ?? "",
      affaire: e.affaire,
      lecture_incomplete: nonLu(e).join(" ; "),
      reference: e.ref ?? "",
      url: e.url ?? "",
    };
  });
  let blob: Blob;
  if (fmt === "csv") {
    const q = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [COLS.join(","), ...flat.map((r) => COLS.map((c) => q(r[c])).join(","))];
    blob = new Blob([`﻿${lines.join("\r\n")}\r\n`], { type: "text/csv;charset=utf-8" });
  } else {
    const meta = {
      licence: t("documents.export_licence"),
      extrait: name,
      registre_mis_a_jour_le: d.f.couverture.maj,
      colonnes: COLS,
    };
    const lignes = flat.map((r) =>
      Object.fromEntries(COLS.map((k) => [k, r[k] === "" ? null : r[k]])),
    );
    blob = new Blob([JSON.stringify({ meta, lignes }, null, 1)], { type: "application/json" });
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `registre-${name}.${fmt}`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export default {
  // its props are the route's and the commune's file (donnees), which the shell passes
  Vue: Documents as unknown as VueModule["Vue"],
  template,
  donnees: async (r: Route) => ({ d: await commune((r as Props).insee) }),
} satisfies VueModule;
