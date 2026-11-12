// « Combien en manque-t-il ? »'s arithmetic (gap.ts draws it): the authorised cameras read, and
// the gap with the map's, said « au moins » when part of it is not read. Pure (the tests read it).

/** How far the place's acts are read: `lu` (0 means none), `non_rattache` (the département is
 * read, its acts not all tied to their commune: a commune's count is a minimum), `non_lu` (not
 * read). `partiel`, an older build's, reads as `non_rattache`. */
export type Etat = "lu" | "partiel" | "non_rattache" | "non_lu";

/** The register's categories of beneficiaries, in the board's order. */
export const CATEGORIES = ["mairie", "commerces", "autres"] as const;
export type Categorie = (typeof CATEGORIES)[number];

export type Autorisees = {
  /** Per category; null: not read. */
  rows: { cle: Categorie; n: number | null }[];
  /** Cameras filming the public street; null: not read (or the acts do not say). */
  voiePublique: number | null;
  /** First and last act counted (AAAA-MM-JJ), when served. */
  periode: [string, string] | null;
  /** Cameras whose holder is not read (`non_classees`): in the total, in no category. */
  nonClassees?: number | null;
  /** Some files' numbers are not read (`dossiers_non_lus` > 0): the total is a minimum. */
  incomplet?: boolean;
};

/** A count in the display font: its thousands with a no-break space (the font has no thin one). */
export const nb = (n: number): string =>
  new Intl.NumberFormat("fr", { maximumFractionDigits: 1 }).format(n).replace(/\u202f/g, "\u00a0");

/** Not tied to its commune: an older build's `partiel` is the same minimum. */
export const nonRattache = (etat: Etat): boolean => etat === "non_rattache" || etat === "partiel";

export type Ecart =
  | { kind: "plus"; n: number; auMoins: boolean }
  | { kind: "moins"; n: number }
  | { kind: "non_lu" }
  | { kind: "non_rattache" }
  | { kind: "incomplet" };

/** The sum of the categories read and of the cameras whose holder is not read, and whether it is
 * the whole (every category read, every file's numbers read, every act tied to the place). */
export function totalAut(
  aut: Autorisees | null,
  etat: Etat,
): { n: number; entier: boolean } | null {
  if (!aut) return null;
  const lus = aut.rows.filter((r) => r.n !== null);
  const nc = aut.nonClassees ?? null;
  if (!lus.length && nc === null) return null;
  const n = lus.reduce((s, r) => s + (r.n ?? 0), 0) + (nc ?? 0);
  return { n, entier: lus.length === aut.rows.length && etat === "lu" && !aut.incomplet };
}

/** The big line: « + N », « au moins + N » when part of it is not read, the other way round when
 * the map knows more than the acts read authorise (said only when they are the whole). Acts not
 * tied to their commune that give nothing here say « non rattaché », never 0. */
export function ecart(input: { carte: number | null; aut: Autorisees | null; etat: Etat }): Ecart {
  const total = totalAut(input.aut, input.etat);
  if (nonRattache(input.etat) && (!total || total.n === 0)) return { kind: "non_rattache" };
  if (!total || input.carte === null) return { kind: "non_lu" };
  const d = total.n - input.carte;
  if (d > 0) return { kind: "plus", n: d, auMoins: !total.entier };
  if (total.entier) return { kind: "moins", n: -d };
  return { kind: "incomplet" };
}
