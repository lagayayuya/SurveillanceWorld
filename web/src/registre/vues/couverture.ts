// « Ce que couvre le registre » (/registre/couverture): no mockup draws it. From the build's couverture.json
// and non_lus.json: the date of the last update, each source's last document and collection, each
// département's state for its prefecture's decrees, and the decrees the program could not read entirely
// (what failed, where to read them). Every date is the data's; the words are the catalogue's.

import { departementArt, raison } from "../collecte.ts";
import { communeHref } from "../commun.ts";
import type { Couverture, Dico, NonLu } from "../donnees.ts";
import { load } from "../donnees.ts";
import { fr, longDate, shortDate } from "../format.ts";
import { has, t } from "../i18n.ts";
import type { VueModule } from "../main.ts";
import { capital } from "../texte.ts";
import { Vue } from "../vue.ts";
import template from "./couverture.html?raw";

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

  renderVals() {
    const { couv, nonLus, communes } = this.props;

    // the sources; a source dated by its year only has no day to show
    let annee = false;
    const sources = couv.sources.map((s) => {
      if (!s.jusqu_au) annee = true;
      return {
        l: source(s),
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
    const deps = nommes.map(([k, e]) => ({
      l: capital(departementArt(k)),
      codes: "",
      etat: etat(e),
    }));
    if (autres.length)
      deps.push({
        l: t("couverture.autres_departements", { n: autres.length }),
        codes: autres.map(([k]) => k).join(", "),
        etat: t("couverture.etat_non_collecte_court"),
      });

    // the decrees not read entirely, the newest first
    const rows = nonLus
      .slice()
      .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || a.id.localeCompare(b.id))
      .map((n) => {
        const type = has(`registre.couverture.type.${n.t}`) ? t(`couverture.type.${n.t}`) : "";
        const c = n.insee ? communes[n.insee] : undefined;
        return {
          date: shortDate(n.date),
          acte: type ? `${type} · ${n.id}` : n.id,
          href: n.insee ? communeHref(n.insee) : "",
          commune: n.insee
            ? (n.commune ?? c?.nom ?? t("commun.code_insee", { insee: n.insee }))
            : "",
          sans: n.insee ? "" : "—",
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
      fil: [{ l: t("commun.fil_registre"), href: "/registre/" }],
      filIci: t("couverture.titre"),
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
