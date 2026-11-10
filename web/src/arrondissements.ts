// The three communes the map draws by municipal arrondissement (Paris, Lyon, Marseille: the
// tiles' units, pipeline/lacarte/tiles.py) and the register by commune. Pure.

/** A municipal arrondissement's commune (Paris 751xx, Lyon 6938x, Marseille 13201–13216), the
 * register's unit, which the tiles split into its arrondissements; any other code is its own. */
export function parentCommune(code: string): string {
  if (/^751\d\d$/.test(code)) return "75056";
  if (/^6938\d$/.test(code)) return "69123";
  if (/^132(0[1-9]|1[0-6])$/.test(code)) return "13055";
  return code;
}
export const isArrondissement = (code: string): boolean => parentCommune(code) !== code;
