// The lists' rules that read data (boards Liste-Communes-A, Liste-Entreprises-A), pure, for the
// tests: which départements are real, the « Comparer » choice.

/** A real département's code: 01–95 (the Corse's 2A and 2B, never 20), the overseas 971–978 and
 * 984–989. The build's listes.json and couverture.json also hold keys that are not (« 1 »…« 9 »
 * without their zero, « 20A », « 20B », « 97 », « 98 », « 99 »: recette 04): their row would lead to
 * no fiche, and their count would add to France's 101. */
export const vraiDepartement = (code: string): boolean =>
  /^(0[1-9]|1\d|2[1-9AB]|[3-8]\d|9[0-5]|97[1-8]|98[4-9])$/.test(code);

/** The lists whose rows can be chosen to compare (Comparer, lot 4: communes or companies). */
export const COMPARABLES = ["communes", "entreprises"] as const;
export type Comparable = (typeof COMPARABLES)[number];
export const comparable = (liste: string): liste is Comparable =>
  (COMPARABLES as readonly string[]).includes(liste);
/** At most this many in Comparer (comparer-a.ts MAX). */
export const MAX_COMPARER = 4;

/** A row chosen, or chosen again (left out); never more than `max`: a fifth is refused. */
export function basculer(ids: string[], id: string, max = MAX_COMPARER): string[] {
  if (ids.includes(id)) return ids.filter((x) => x !== id);
  return ids.length >= max ? ids : [...ids, id];
}

/** Comparer with the rows chosen: /registre/comparer?communes=69123,69029 (or ?entreprises=). */
export const comparerHref = (liste: Comparable, ids: string[]): string =>
  `/registre/comparer?${liste}=${ids.map(encodeURIComponent).join(",")}`;

/** The département whose page shows an intercommunality (its v2 fiche, `?ic=`): its buyer's when
 * the build knows it, else the one most of its communes are in (the first met on a tie). Every
 * one of the 1 012 is a row of that département's file (measured 09/11, recette 19). */
export function depEpci(acheteurDep: string | null | undefined, depsCommunes: string[]): string {
  if (acheteurDep) return acheteurDep;
  const n = new Map<string, number>();
  for (const d of depsCommunes) n.set(d, (n.get(d) ?? 0) + 1);
  let best = "";
  for (const [d, k] of n) if (k > (n.get(best) ?? 0)) best = d;
  return best;
}
