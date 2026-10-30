// « Ce que couvre le registre » (/registre/couverture): no mockup draws it. From the build's couverture.json
// and non_lus.json: the date of the last update, each source's last document and collection, each
// département's state for its prefecture's decrees, and the decrees the program could not read entirely
// (what failed, where to read them). Every date is the data's; the words are the catalogue's.
// v2 (design/registre/v2): a page of the register in its frame (its pink, its breadcrumb), its title in
// cut-out letters as the summary's; each département (every one listed here has its fiche), each
// commune of the register and each decree whose dossier it holds is a typed link (liens.ts).

import { departementArt, raison } from "../collecte.ts";
import type { Lexique } from "../corpus.ts";
import type { RichItem } from "../dc.ts";
import type { Couverture, Dico, Evenement, NonLu } from "../donnees.ts";
import { load } from "../donnees.ts";
import { fr, longDate, shortDate } from "../format.ts";
import { has, t } from "../i18n.ts";
import { lienCommune, lienDepartement, lienDocument } from "../liens.ts";
import type { VueModule } from "../modale.ts";
import { capital } from "../texte.ts";
import type { TypeCle } from "../types.ts";
import { large, Vue } from "../vue.ts";
import "./couverture.css";
import template from "./couverture.html?raw";
import { motsDecoupes } from "./decoupe-outils.ts";
import { lierDepartement } from "./mention-outils.ts";

type CouvertureFichier = Couverture & {
  sources: (Couverture["sources"][number] & { libelle?: string })[];
  departements: Record<
    string,
    Couverture["departements"][string] & { documents_demandes?: boolean }
  >;
};
type Props = {
  couv: CouvertureFichier;
  nonLus: NonLu[];
  communes: Dico["communes"];
};

const RAISONS = ["nombre_illisible", "commune_introuvable", "zone_non_deduite"];
/** The order of the states: collected, impossible, not yet. */
const RANG: Record<string, number> = { collecte: 0, impossible: 1, non_collecte: 2 };

/** A source's label: its catalogue key (the build gives it), else its id. */
function source(s: CouvertureFichier["sources"][number]): string {
  const key = s.libelle?.replace(/^registre\./, "") ?? `source.${s.id}`;
  return has(`registre.${key}`) ? t(key) : s.id;
}

/** A département's state in a few words: since when collected, or why not. */
function etat(e: CouvertureFichier["departements"][string]): string {
  if (e.etat === "collecte") {
    const parts = [
      e.depuis
        ? t("couverture.etat_collecte_depuis", { date: longDate(e.depuis) })
        : t("couverture.etat_collecte"),
      e.dernier_recueil
        ? t("couverture.etat_dernier_recueil", { date: longDate(e.dernier_recueil) })
        : "",
    ];
    return parts.filter(Boolean).join(" · ");
  }
  if (e.etat === "impossible") {
    const why = raison(e.raison);
    const s = why
      ? t("couverture.etat_impossible_court_raison", { raison: why })
      : t("couverture.etat_impossible_court");
    return e.documents_demandes ? `${s} · ${t("couverture.etat_documents_demandes")}` : s;
  }
  return t("couverture.etat_non_collecte_court");
}

class Couverture_ extends Vue<Props> {
  titre(): string {
    return t("couverture.titre");
  }

  type(): TypeCle {
    return "registre";
  }

  renderVals() {
    const { couv, nonLus, communes } = this.props;

    // the sources; a source dated by its year only has no day to show
    let annee = false;
    const sources = couv.sources.map((s) => {
      if (!s.jusqu_au) annee = true;
      // a source of one département names it: its fiche, a link (« Arrêtés du Rhône »)
      return {
        l: lierDepartement(source(s), /_(\d[\dAB]|97\d)$/.exec(s.id)?.[1]),
        jusqu: s.jusqu_au ? shortDate(s.jusqu_au) : t("couverture.annee_seulement"),
        le: s.collecte_le ? shortDate(s.collecte_le) : "—",
      };
    });

    // the départements: each one the catalogue can name; the others, not yet collected, on one row
    const entries = Object.entries(couv.departements).sort(
      ([a, x], [b, y]) => (RANG[x.etat] ?? 3) - (RANG[y.etat] ?? 3) || a.localeCompare(b),
    );
    const nommes = entries.filter(
      ([k, e]) => e.etat !== "non_collecte" || has(`registre.departement.art_${k}`),
    );
    const autres = entries.filter(
      ([k, e]) => e.etat === "non_collecte" && !has(`registre.departement.art_${k}`),
    );
    // the build writes a fiche for every département couverture.json lists
    const deps: { l: RichItem; codes: RichItem[]; etat: string }[] = nommes.map(([k, e]) => ({
      l: lienDepartement(k, capital(departementArt(k))),
      codes: [],
      etat: etat(e),
    }));
    if (autres.length)
      deps.push({
        l: t("couverture.autres_departements", { n: autres.length }),
        codes: autres.map(([k]) => lienDepartement(k, k)),
        etat: t("couverture.etat_non_collecte_court"),
      });
    // a decree placed in a commune: the build writes that commune's fiche (one per commune of the
    // départements it reads) with the decree's dossier in its Autorisations
    const placees = Object.fromEntries(
      nonLus
        .filter((n) => n.insee)
        .map((n) => [n.insee, { nom: n.commune ?? communes[n.insee ?? ""]?.nom ?? n.insee }]),
    );
    const L = { communes: { ...placees, ...communes } } as unknown as Lexique;

    // the decrees not read entirely, the newest first
    const rows = nonLus
      .slice()
      .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || a.id.localeCompare(b.id))
      .map((n) => {
        const type = has(`registre.couverture.type.${n.t}`) ? t(`couverture.type.${n.t}`) : "";
        const c = n.insee ? communes[n.insee] : undefined;
        const nom = n.insee
          ? (n.commune ?? c?.nom ?? t("commun.code_insee", { insee: n.insee }))
          : "";
        // its dossier in the commune's Autorisations (corpus.ts docHref); without a commune the build
        // does not say whether the register holds it: its number alone
        const acte: RichItem = n.insee
          ? lienDocument(L, { id: n.id, affaire: n.id, t: n.t, insee: n.insee } as Evenement, n.id)
          : n.id;
        return {
          date: shortDate(n.date),
          acte: type ? [`${type} · `, acte] : [acte],
          commune: n.insee ? lienCommune(L, n.insee, nom) : "—",
          raisons: n.raisons
            .map((r) => (has(`registre.non_lu.${r}`) ? t(`non_lu.${r}`) : r))
            .join(" · "),
          url: n.url ?? "",
          source: n.page
            ? t("couverture.recueil_page", { page: String(n.page) })
            : t("couverture.recueil"),
        };
      });
    const counts = couv.non_lus ?? {};
    const kpis = RAISONS.filter((r) => counts[r]).map((r) => ({
      v: fr(counts[r]),
      l: t(`non_lu.${r}`),
    }));

    return {
      ...this.base("couverture"),
      lay: large()
        ? { inner: "inner", cut: "cutout", tickets: "tickets" }
        : { inner: "tin", cut: "cutout s", tickets: "tickets t2" },
      mots: motsDecoupes(t("couverture.titre")),
      maj: t("couverture.maj", { date: longDate(couv.maj) }),
      sources,
      anneeNote: annee ? t("couverture.annee_note") : "",
      deps,
      nonLus: { phrase: t("couverture.non_lus_n", { n: nonLus.length }), kpis, rows },
    };
  }
}

export default {
  // the router gives the route and donnees() together (main.ts)
  Vue: Couverture_ as unknown as VueModule["Vue"],
  template,
  donnees: async () => {
    const [couv, nl, index] = await Promise.all([
      load<CouvertureFichier>("couverture.json"),
      load<{ non_lus: NonLu[] }>("non_lus.json"),
      // the communes' names the register's home already has (index.json's dico): no file per commune
      load<{ dico: Dico }>("index.json"),
    ]);
    return { couv, nonLus: nl.non_lus, communes: index.dico.communes };
  },
} satisfies VueModule;
