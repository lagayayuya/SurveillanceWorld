// A département's state of collection of its prefecture's decrees, in words: collected, not yet collected,
// or impossible to collect (and why, and whether the documents were asked for). The state is the build's
// (couverture.json, a commune file's couverture); the Autorisations tab and the coverage page say it alike.
import { has, t } from "./i18n.ts";

export type EtatDepartement = {
  etat: "collecte" | "non_collecte" | "impossible" | string;
  raison?: string;
  documents_demandes?: boolean;
  depuis?: string;
  dernier_recueil?: string;
};

/** « le Rhône », « la Seine-Saint-Denis », « le département 01 ». */
export function departementArt(dep: string, nom?: string | null): string {
  return has(`registre.departement.art_${dep}`)
    ? t(`departement.art_${dep}`)
    : t("departement.art", { nom: nom ?? dep });
}

/** Why the decrees cannot be collected, or "" for a reason the catalogue does not know. */
export function raison(code: string | undefined): string {
  return code && has(`registre.couverture.raison.${code}`) ? t(`couverture.raison.${code}`) : "";
}

/** The sentence for a département whose decrees are not collected (not yet, or impossible). */
export function etatDepartement(
  dep: string,
  nom: string | null | undefined,
  e: EtatDepartement,
): string {
  const art = departementArt(dep, nom);
  if (e.etat === "impossible") {
    const why = raison(e.raison);
    const s = t(why ? "couverture.etat_impossible_raison" : "couverture.etat_impossible", {
      dep: art,
      raison: why,
    });
    return e.documents_demandes ? `${s} ${t("couverture.documents_demandes")}` : s;
  }
  return t("couverture.etat_non_collecte", { dep: art });
}
