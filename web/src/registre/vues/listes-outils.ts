// The lists' rules that read data (boards Liste-Communes-A, Liste-Entreprises-A), pure, for the
// tests: which départements are real, the « Comparer » choice.

/** A real département's code: 01–95 (the Corse's 2A and 2B, never 20), the overseas 971–978 and
 * 984–989. The build's listes.json and couverture.json also hold keys that are not (« 1 »…« 9 »
 * without their zero, « 20A », « 20B », « 97 », « 98 », « 99 »: recette 04): their row would lead to
 * no fiche, and their count would add to France's 101. */
export const vraiDepartement = (code: string): boolean =>
  /^(0[1-9]|1\d|2[1-9AB]|[3-8]\d|9[0-5]|97[1-8]|98[4-9])$/.test(code);
