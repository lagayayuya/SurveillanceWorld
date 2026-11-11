// A family of prefectoral acts in words, wherever a page shows its count (Ju, 11/11): the state
// the build serves (comparer-a.ts `EtatActes`) says how the number reads.

import { depArt } from "../commun.ts";
import { fr } from "../format.ts";
import { t } from "../i18n.ts";
import { type EtatActes, type FormeActes, formeActes } from "./comparer-a.ts";
import { deArt } from "./entreprise-a.ts";

export type DitActes = {
  forme: FormeActes;
  /** the cell: « 12 », « au moins 12 », « aucun encore rattaché », « pas encore lus » */
  v: string;
  /** what the cell means, for its bubble or its note: « Arrêtés de l'Allier pas encore lus », « Une
   * partie des arrêtés du département n'est pas encore rattachée à une commune », « » when read */
  phrase: string;
};

/** A family's count in words: « lu » the number alone (`zero` for its 0 where a page writes « — »),
 * « non_rattache » a minimum, « non_lu » never a number. `dep` names the département (« de
 * l'Allier »). */
export function ditActes(
  etat: EtatActes,
  n: number,
  dep: string,
  o: { nomDep?: string | null; fmt?: (v: number) => string; zero?: string } = {},
): DitActes {
  const forme = formeActes(etat, n);
  const fmt = o.fmt ?? fr;
  if (forme === "n") return { forme, v: n === 0 && o.zero != null ? o.zero : fmt(n), phrase: "" };
  if (forme === "non_lu")
    return {
      forme,
      v: t("socle_a.actes_non_lus_court"),
      phrase: t("socle_a.actes_non_lus", { de: deArt(depArt(dep, o.nomDep)) }),
    };
  return {
    forme,
    v: forme === "au_moins" ? t("socle_a.au_moins", { n: fmt(n) }) : t("socle_a.aucun_rattache"),
    phrase: t("socle_a.partie_non_rattachee"),
  };
}
