// View 5 · Commune · Autorisations (mockup Autorisations-grand, prototype v12 vues/autorisations.js): the
// commune's prefectoral decrees grouped by dossier; the mairie's main dossier first (its step chart, its
// table, what it allows, what came before), then the shops and companies, then drones and the other
// devices. The rules are the build's flags (communal, partage, non_lu); a decree whose number of cameras
// could not be read counts among the decrees and never in the cameras; a drone zone not deduced is
// listed with its source, never drawn.

import { etatDepartement } from "../collecte.ts";
import {
  type Autorisation,
  commune,
  communeHref,
  type Donnees,
  filCommune,
  tete,
} from "../commun.ts";
import type { Rich } from "../dc.ts";
import type { Evenement } from "../donnees.ts";
import "../demande.ts";
import { fr, longDate, longMonth, MONTHS_LONG, shortDate, shortMonth, signed } from "../format.ts";
import { has, t } from "../i18n.ts";
import type { VueModule } from "../main.ts";
import type { Route } from "../routes.ts";
import { signaler } from "../signaler.ts";
import { capital, proper, tidy, titleCase } from "../texte.ts";
import { type BaseState, Vue } from "../vue.ts";
import template from "./autorisations.html?raw";

type Props = { insee: string; dossier: string; d: Donnees };
type State = BaseState & { allPriv: boolean };
type Dossier = {
  id: string;
  es: Evenement[];
  /** Its last decree. */
  last: Evenement;
  /** Its last decree whose number of cameras was read (the count that holds). */
  lu: Evenement | null;
  a: ReturnType<Donnees["affaire"]>;
};
type Detail = {
  kicker: string;
  title: string;
  rows: [string, string][];
  note?: string;
  foot: string;
  links: { l: string; href: string }[];
};

const PRIVES_D_ABORD = 15;
const dash = (v: number | null | undefined): string => (v == null ? "—" : fr(v));
const ym = (d: string): string => d.slice(0, 7);
const lu = (e: Evenement): boolean => e.cameras != null && !e.non_lu?.includes("nombre_illisible");
const nonDeduite = (e: Evenement): boolean => !!e.non_lu?.includes("zone_non_deduite");
/** « 18 nov. 2025 », a decree's page added: « Acte 69-2025-11-18-00015, p. 8 ». */
const acte = (e: Evenement): string =>
  e.page
    ? t("autorisations.acte_page", { id: e.id, page: String(e.page) })
    : t("autorisations.acte", { id: e.id });

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

/** A decree's two links: its source, and the report of an error. */
function liens(e: Evenement): { l: string; href: string }[] {
  const s = signaler(e.id);
  return [...(e.url ? [{ l: t("arretes.voir"), href: e.url }] : []), ...(s ? [s] : [])];
}

/** A shop's or a company's category, from the decree's type of beneficiary. */
function categorie(e: Evenement): string {
  if (/pharmacie/i.test(String(e.beneficiaire ?? ""))) return t("autorisations.cat.pharmacie");
  const k = e.type_beneficiaire || "commerce";
  return has(`registre.autorisations.cat.${k}`) ? t(`autorisations.cat.${k}`) : capital(k);
}

/** A beneficiary's published name, or null for « nom non publié » (the build's nom_publie). */
function nomPublie(e: Evenement): string | null {
  if (e.beneficiaire === "[non retenu]" || e.nom_publie === false || !e.beneficiaire) return null;
  if (e.beneficiaire === "[non précisé]") return t("commun.non_precise");
  return proper(tidy(titleCase(e.beneficiaire)));
}

class Autorisations extends Vue<Props, State> {
  private cache: ReturnType<Autorisations["build"]> | null = null;

  protected init(): Partial<State> {
    return { allPriv: false };
  }

  titre(): string {
    return t("autorisations.titre_onglet", { nom: this.props.d.f.commune.nom });
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
    const autres = L.filter((e) => e.t !== "arrete");
    // decrees of drones or algorithmic analysis naming the commune among others, not among its own
    const ids = new Set(L.map((e) => e.id));
    const dep = d.f.commune.dep;
    const multi = (d.f.zones?.autorisations ?? []).filter(
      (a: Autorisation) =>
        a.insee.includes(d.insee) && !ids.has(a.acte) && a.acte.startsWith(`${dep}-`),
    );
    return { L, mairie, prives, autres, multi };
  }

  private data() {
    if (!this.cache) this.cache = this.build();
    return this.cache;
  }

  componentDidMount(): void {
    const id = this.props.dossier;
    if (!id) return;
    const d = this.data();
    const i = d.prives.findIndex((x) => x.id === id);
    const j = d.mairie.findIndex((x) => x.id === id);
    // two frames: the router scrolls to the top in the next one
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (j === 0) document.getElementById("mairie")?.scrollIntoView({ block: "start" });
        else if (j > 0) {
          this.setState({ sel: d.mairie[j].last.id });
          document.getElementById(`dos-${id}`)?.scrollIntoView({ block: "center" });
        } else if (i >= 0) {
          this.setState({
            sel: d.prives[i].last.id,
            allPriv: i >= PRIVES_D_ABORD || this.state.allPriv,
          });
          requestAnimationFrame(() =>
            document.querySelectorAll("#prives tbody tr")[i]?.scrollIntoView({ block: "center" }),
          );
        }
      }),
    );
  }

  renderVals() {
    const S = this.state;
    const D = this.props.d;
    const d = this.data();
    const insee = D.insee;
    const nom = D.f.commune.nom;
    const couv = D.f.couverture.departement as Donnees["f"]["couverture"]["departement"] & {
      documents_demandes?: boolean;
    };
    const DET: Record<string, Detail> = {};

    // the lead, the line on the collection under it, the four figures
    const nM = d.mairie.reduce((s, x) => s + x.es.length, 0);
    const nP = d.prives.reduce((s, x) => s + x.es.length, 0);
    const nA = d.autres.length;
    const etat = etatDepartement(D.f.commune.dep, D.f.stats.dep.nom, couv);
    let lead: Rich;
    let couverture = "";
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
    const main = d.mairie.find((x) => x.es.some(lu));
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
        DET[e.id] = {
          kicker: t("autorisations.kicker_arrete", { date: shortDate(date) }),
          title: t("autorisations.titre_mairie", { n }),
          rows: [
            [t("autorisations.sur_la_rue"), dash(e.cameras_vp)],
            [t("autorisations.abords_des_batiments"), dash(e.cameras_ext)],
            [t("autorisations.dans_les_batiments"), dash(e.cameras_int)],
            [t("autorisations.ecart"), ecart],
            [t("autorisations.duree"), e.duree || t("autorisations.non_precisee")],
          ],
          foot: `${change(e, es[i - 1], a)} ${acte(e)}`,
          links: liens(e),
        };
        const x = X(date);
        const close = x - lastX < 13;
        if (!close) lastX = x;
        return {
          n: fr(n),
          delta: i ? ecart : t("autorisations.premier_publie"),
          d: shortMonth(date),
          cls: `mk${S.sel === e.id ? " on" : ""}`,
          pos: `left: ${x.toFixed(1)}%; top: 79px`,
          lpos: `position: absolute; left: ${x.toFixed(1)}%; transform: translateX(-50%); white-space: nowrap`,
          lcls: close ? "tk-o" : "",
          aria: t("autorisations.mark_aria", {
            date: shortDate(date),
            cameras: t("n.camera", { n }),
          }),
          hover: this.pick(e.id),
        };
      });
      // the table lists every decree of the dossier; one whose number could not be read shows none
      rows = main.es.map((e) => {
        const p = es[es.indexOf(e) - 1];
        if (!lu(e))
          DET[e.id] = {
            kicker: t("autorisations.kicker_arrete", { date: shortDate(e.date) }),
            title: t("autorisations.titre_mairie_illisible"),
            rows: [[t("autorisations.duree"), e.duree || t("autorisations.non_precisee")]],
            note: t("autorisations.note_illisible"),
            foot: acte(e),
            links: liens(e),
          };
        return {
          date: shortDate(e.date),
          n: lu(e) ? fr(e.cameras ?? 0) : "—",
          vp: dash(e.cameras_vp),
          ext: dash(e.cameras_ext),
          int: dash(e.cameras_int),
          delta: lu(e) && p ? signed((e.cameras ?? 0) - (p.cameras ?? 0)) : "—",
          url: e.url ?? "",
          cls: `r${S.sel === e.id ? " on" : ""}`,
          hover: this.pick(e.id),
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
        DET[e.id] = {
          kicker: t("autorisations.kicker_dossier", { no: x.id.split("-")[1] ?? x.id }),
          title:
            n == null
              ? t("autorisations.titre_mairie_illisible")
              : t("autorisations.titre_mairie", { n }),
          rows: [
            [t("autorisations.arretes_publies"), fr(x.es.length)],
            [t("autorisations.dernier_arrete"), shortDate(e.date)],
            [t("autorisations.sur_la_rue"), dash(x.lu?.cameras_vp)],
            [t("autorisations.duree"), e.duree || t("autorisations.non_precisee")],
          ],
          note: lu(e) ? undefined : t("autorisations.note_illisible"),
          foot: acte(e),
          links: liens(e),
        };
        return {
          no: x.id.split("-")[1] ?? x.id,
          date: shortDate(e.date),
          url: e.url ?? "",
          na: fr(x.es.length),
          n: dash(n),
          vp: dash(x.lu?.cameras_vp),
          ancre: `dos-${x.id}`,
          cls: `r${S.sel === e.id ? " on" : ""}`,
          hover: this.pick(e.id),
        };
      });

    // shops and companies: one row per dossier (its last decree)
    const pv = S.allPriv ? d.prives : d.prives.slice(0, PRIVES_D_ABORD);
    const priv = pv.map((x) => {
      const e = x.last;
      const nm = nomPublie(e);
      const cat = categorie(e);
      const illisible = !lu(e);
      DET[e.id] = {
        kicker: t("autorisations.kicker_arrete", { date: shortDate(e.date) }),
        title: `${nm ?? capital(t("commun.nom_non_publie"))} · ${
          illisible ? t("non_lu.nombre_illisible") : t("n.camera", { n: e.cameras ?? 0 })
        }`,
        rows: [
          [t("autorisations.categorie"), cat],
          [t("autorisations.abords"), dash(e.cameras_ext)],
          [t("autorisations.interieur"), dash(e.cameras_int)],
          [t("autorisations.duree"), e.duree || t("autorisations.non_precisee")],
        ],
        note: illisible ? t("autorisations.note_illisible") : undefined,
        foot: acte(e),
        links: liens(e),
      };
      return {
        date: shortDate(e.date),
        nom: nm ?? t("commun.nom_non_publie"),
        nomStyle: nm ? "font-weight: 700" : "font-style: italic; color: var(--muted)",
        cat,
        n: illisible ? "—" : fr(e.cameras ?? 0),
        ext: dash(e.cameras_ext),
        int: dash(e.cameras_int),
        url: e.url ?? "",
        cls: `r${S.sel === e.id ? " on" : ""}`,
        hover: this.pick(e.id),
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
    const carte = `/?insee=${insee}`;
    const list = d.autres
      .slice()
      .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
      .slice(0, 12)
      .map((e) => {
        const kind = has(`registre.autorisations.type.${e.t}`)
          ? t(`autorisations.type.${e.t}`)
          : t("autorisations.type.autre");
        const txt: Rich = [`${kind} · ${tidy(nomPublie(e) ?? t("commun.nom_non_publie"))}`];
        const partage = (e.partage ?? []) as string[];
        if (partage.length) {
          txt.push(` · ${t("autorisations.partage", { n: partage.length })} : `);
          partage.forEach((k, i) => {
            if (i) txt.push(", ");
            txt.push({ a: { href: communeHref(k), text: D.commune(k).nom } });
          });
        }
        const zone = /^arrete_(drone|vsa)$/.test(e.t);
        if (zone && nonDeduite(e)) txt.push(` · ${t("arretes.zone_non_deduite")}`);
        const surCarte = zone && !nonDeduite(e);
        return {
          d: shortDate(e.date),
          t: txt,
          href: surCarte ? carte : (e.url ?? carte),
          l: t(surCarte ? "autorisations.sur_la_carte" : "autorisations.l_arrete"),
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
          { a: { href: carte, text: t("autorisations.voir_sur_la_carte") } },
        ]
      : "";
    const autresArr = {
      // a département not collected says so in the lead: no « aucun arrêté » here
      show: couv.etat === "collecte" || d.L.length > 0 || d.multi.length > 0,
      none: couv.etat === "collecte" && !list.length && !d.multi.length,
      ex:
        lyonDr && insee !== "69123"
          ? t("autorisations.exemple_lyon", { arr: t("n.arrete", { n: lyonDr }) })
          : "",
      exHref: "/?insee=69123",
      list,
      multi,
    };

    const d0 = S.sel ? DET[S.sel] : undefined;
    const nDr = d.autres.filter((e) => e.t === "arrete_drone").length + d.multi.length;
    const det = d0
      ? { ...d0, rows: d0.rows.map(([k, v]) => ({ k, v })), note: d0.note ?? "" }
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
            kicker: t("autorisations.repos_kicker", { nom }),
            title: t("autorisations.repos_titre", { n: camM + camP }),
            rows: [
              { k: t("autorisations.mairie"), v: fr(camM) },
              { k: t("autorisations.dont_rue"), v: vpM == null ? "—" : fr(vpM) },
              { k: t("autorisations.commerces_et_entreprises"), v: fr(camP) },
              {
                k: t("autorisations.drones"),
                v: nDr ? t("n.arrete", { n: nDr }) : t("autorisations.aucun"),
              },
            ],
            note: "",
            foot: t("autorisations.repos_foot"),
            links: [],
          };

    const nDocs = D.all.length;
    const elide = /^[aeiouyéèêâîôûh]/i.test(nom);
    return {
      ...this.base("autorisations"),
      ...this.info("dos", "nom"),
      ...filCommune(D, t("autorisations.fil_ici")),
      com: tete(D, "aut"),
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
      docsTxt: t(elide ? "autorisations.docs_d" : "autorisations.docs_de", { n: nDocs, nom }),
      lien: { ici: location.pathname, documents: communeHref(insee, "documents") },
    };
  }
}

export default {
  // the router gives the route and donnees() together (main.ts): { insee, dossier, d }
  Vue: Autorisations as unknown as VueModule["Vue"],
  template,
  donnees: async (r: Route) => ({ d: await commune((r as { insee: string }).insee) }),
} satisfies VueModule;
