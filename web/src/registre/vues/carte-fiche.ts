// The live map's panel, tab « Fiche » (board Vue3D-Paris-fiche, redesign v3 lot 5): the commune's
// four figures with their rank, its lead sentence, the cameras its decrees authorise. Pure, for the
// tests; every figure is the one the commune's fiche shows (the same build, the same rules:
// commune-a.ts), so the panel and the fiche never disagree.

import type { Donnees } from "../commun.ts";
import { ess, lastArretes } from "../commun.ts";
import type { Listes } from "../listes.ts";
import { camerasAutorisees, joursDeVol, rang, strate } from "./commune-a.ts";
import { type CouvActes, couvertureActes, lecture, type RowActes } from "./comparer-a.ts";

export type Rang = { r: number; n: number } | null;
export type FichePanneau = {
  /** cameras on the map (`carte.n`), its rank in its size; null: not read */
  cameras: number | null;
  rCameras: Rang;
  /** the commune's own counted contracts: their sum, their count, per inhabitant and its rank */
  eur: number;
  contrats: number;
  eph: number | null;
  rEph: Rang;
  /** days of flight over twelve months (`jv`, else the acts' own days), its rank */
  jours: number;
  rJours: Rang;
  /** its contracts on one offer among those that publish their offers */
  uneOffre: number;
  offresPubliees: number;
  /** the size class, for the ranks' words */
  strate: number;
  /** the camera decrees: read (its département collected, one decree here with its cameras),
   * and what they authorise */
  arretesLus: boolean;
  autorisees: number;
  /** the drone decrees are read here (its département collected, « drone » above its threshold:
   * `lecture`, as Comparer and the lists read it); unread, a commune without any act is « non lu »,
   * never « 0 arrêté » (Ju 09/11, recette 12) */
  dronesLus: boolean;
  /** the build's state of each family (Ju 11/11): « non_rattache », its counts are minimums and
   * carry no rank */
  couv: CouvActes;
  /** the first year of its counted contracts */
  depuis: string;
};

export function fichePanneau(d: Donnees, X: Listes | null): FichePanneau {
  const c = d.f.commune;
  const pop = c.pop ?? 0;
  const st = strate(pop);
  const s = ess(d);
  const pairs = X
    ? Object.entries(X.lignes.communes).filter(([k]) => strate(X.dico.communes[k]?.pop ?? 0) === st)
    : [];
  const popDe = (k: string) => X?.dico.communes[k]?.pop ?? 0;
  const cameras = d.carte;
  const eph = pop > 0 && s.eur > 0 ? s.eur / pop : null;
  const jv = X?.lignes.communes[c.insee]?.jv;
  const jours = jv ?? joursDeVol(d.all, d.f.couverture.maj).size;
  const pub = s.counted.filter((e) => typeof e.offres === "number");
  const arr = lastArretes(d.all);
  // the build's reading of the commune's acts, as the fiche and Comparer read it (comparer-a.ts)
  const stA = (
    d.f as {
      stats?: {
        communes?: Record<string, RowActes>;
        dep?: { depStats?: { cam?: number; dr?: number } };
      };
    }
  ).stats;
  const couv = couvertureActes({
    insee: c.insee,
    dep: String((c as { dep?: string }).dep ?? ""),
    etat: d.f.couverture.departement.etat,
    X: X as never,
    propre: stA?.communes?.[c.insee],
    depTotal: stA?.dep?.depStats,
  });
  const lu = lecture(couv);
  // read only where a decree says its cameras: a département collected but none read here
  // (Paris: no video decree served) is « pas encore lus », never « 0 caméras »
  const lus = arr.some((e) => e.t === "arrete" && !e.copie && typeof e.cameras === "number");
  return {
    cameras,
    rCameras: X
      ? rang(
          cameras,
          pairs.map(([, v]) => v.carte ?? -1),
        )
      : null,
    eur: s.eur,
    contrats: s.counted.length,
    eph,
    rEph: X
      ? rang(
          eph,
          pairs.map(([k, v]) => ((v.amt ?? 0) > 0 && popDe(k) > 0 ? (v.amt ?? 0) / popDe(k) : -1)),
        )
      : null,
    jours,
    // a minimum (« au moins N ») has no rank
    rJours:
      X && jours > 0 && couv.dr !== "non_rattache"
        ? rang(
            jours,
            pairs.map(([, v]) => ((v.jv ?? 0) > 0 ? (v.jv ?? 0) : -1)),
          )
        : null,
    uneOffre: pub.filter((e) => e.offres === 1).length,
    offresPubliees: pub.length,
    strate: st,
    arretesLus: lu.cam && lus,
    autorisees: camerasAutorisees(arr).total,
    dronesLus: lu.dr,
    couv,
    depuis: s.counted[0]?.date?.slice(0, 4) ?? "",
  };
}

/** What the Drones tab says of the acts over the period (recette 12): « lu » with a count, « aucun »
 * when the decrees are read and none falls in it, « non_lu » when they are not read and the commune
 * has no act at all (an act listed below the threshold is still counted). */
export type EtatDrones = "lu" | "aucun" | "non_lu";
export function etatDrones(lus: boolean, actesPeriode: number, actesTous: number): EtatDrones {
  if (actesPeriode > 0) return "lu";
  return lus || actesTous > 0 ? "aucun" : "non_lu";
}
