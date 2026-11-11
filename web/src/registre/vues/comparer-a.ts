// Comparer in theme A (boards Comparer-communes and Comparer-entreprises, redesign v3 lot 4): what
// the view computes from listes.json, pure, for the tests. Every figure is the build's row of the
// lists (one source per figure, Ju 07/11): no commune's or company's file is read. Words are the
// view's (comparer.ts); here only ids, numbers and their order.

import type { Listes } from "../listes.ts";

/** At most four columns (the boards' « jusqu'à 4 »). */
export const MAX = 4;

/** The ids of the address (?communes=a,b or ?entreprises=a,b): its order kept, an unknown id or a
 * repeated one dropped, four at most. */
export function idsDe(q: string | undefined, connu: (id: string) => boolean, max = MAX): string[] {
  const out: string[] = [];
  for (const s of (q ?? "").split(",")) {
    const id = s.trim();
    if (id && connu(id) && !out.includes(id)) out.push(id);
    if (out.length >= max) break;
  }
  return out;
}

/** A row's highest values (the boards' yellow): every column at the maximum, ties included; none
 * when fewer than two columns have a figure or when the maximum is 0. */
export function hauts(vals: (number | null)[]): boolean[] {
  const ns = vals.filter((v): v is number => v !== null);
  const max = Math.max(...ns);
  const ok = ns.length >= 2 && max > 0;
  return vals.map((v) => ok && v === max);
}

/** A row's bars, in % of its maximum (the bars compare within a row only); a figure above 0 keeps
 * 1 % at least, so that it shows; no figure, no bar (null). */
export function barres(vals: (number | null)[]): (number | null)[] {
  const max = Math.max(0, ...vals.filter((v): v is number => v !== null));
  return vals.map((v) =>
    v === null ? null : max > 0 ? (v > 0 ? Math.max(1, Math.round((100 * v) / max)) : 0) : 0,
  );
}

/** The columns from the highest to the lowest figure (the lead's « a le plus… devant… »), those
 * without a figure left out; ties keep the address's order. */
export function classement(vals: (number | null)[]): number[] {
  return vals
    .map((v, i) => ({ v, i }))
    .filter((x): x is { v: number; i: number } => x.v !== null)
    .sort((a, b) => b.v - a.v || a.i - b.i)
    .map((x) => x.i);
}

/** A commune's reading of the prefectoral acts, per family, the cameras' (`cam`) and the drones'
 * (`dr`), as the build serves it (`couverture_actes`, rule:registre_couverture@1:actes_commune,
 * three states since 93e98a8): « non_lu » when its département's acts are not collected;
 * « non_rattache » when they are read but not enough of the family is attached to its commune, the
 * commune's count then a minimum; « lu » otherwise, a 0 then meaning none. Until it is served, the
 * same rule on what a page has: a collected département with acts of the family placed in no
 * commune makes every count of it a minimum. */
export type EtatActes = "lu" | "non_rattache" | "non_lu";
export type CouvActes = { cam: EtatActes; dr: EtatActes };
export function etatActes(collecte: boolean, sansCommune: number): EtatActes {
  if (!collecte) return "non_lu";
  return sansCommune > 0 ? "non_rattache" : "lu";
}

/** How a page writes a family's count (Ju, 11/11), from its state and its number: « lu », the
 * number alone (`n`); « non_rattache », « au moins N » (`au_moins`), or « aucun encore rattaché »
 * when N is 0 (`aucun_rattache`), never « au moins 0 »; « non_lu », « pas encore lus », never a
 * number. The words are the views' (actes-mots.ts). */
export type FormeActes = "n" | "au_moins" | "aucun_rattache" | "non_lu";
export const formeActes = (e: EtatActes, n: number): FormeActes =>
  e === "non_lu" ? "non_lu" : e === "lu" ? "n" : n > 0 ? "au_moins" : "aucun_rattache";

/** A row of a commune's figures that may carry the build's reading (listes.json rows, a commune's
 * or a département's `stats.communes`; served from 580f7cf on). */
export type RowActes = { cam?: number; dr?: number; couverture_actes?: Partial<CouvActes> };
type ListesActes = {
  lignes: {
    communes: Record<string, RowActes>;
    departements: Record<
      string,
      { cam?: number; dr?: number; couverture_actes_communes?: Partial<CouvActes> }
    >;
  };
  dico: { communes: Record<string, { dep?: string } | undefined> };
};
const servi = (c: Partial<CouvActes> | undefined): CouvActes | null =>
  c?.cam && c.dr ? { cam: c.cam, dr: c.dr } : null;

/** The acts of each family a département's file counts but places in no commune: its count less
 * its acts placed in a commune, each once (the build's `depStats` and `uniq`). */
export function horsCommune(
  depStats: Record<string, number> | undefined,
  uniq: Record<string, number> | undefined,
): { cam: number; dr: number } | undefined {
  if (!depStats || !uniq) return undefined;
  return {
    cam: Math.max(0, (depStats.cam ?? 0) - (uniq.cam ?? 0)),
    dr: Math.max(0, (depStats.dr ?? 0) - (uniq.dr ?? 0)),
  };
}

/** A commune's reading: the build's when served (its row, else its own file's figures, else, for a
 * commune without a row, its département's row); only when none is served, one rule every page
 * can apply with what it has (its département's count): « non_lu » where the département is not
 * collected, « non_rattache » (a minimum) where it has acts of the family, since every département
 * with acts has some placed in no commune (measured on the build of 09/11: 100 of the 100 collected
 * départements with camera acts, as with drone acts); « lu » where it has none. */
export function couvertureActes(o: {
  insee: string;
  dep: string;
  etat: string | undefined;
  X: ListesActes | null;
  propre?: RowActes;
  /** the département's own counts (its file's `depStats`), else its row of listes.json */
  depTotal?: { cam?: number; dr?: number };
}): CouvActes {
  const row = o.X?.lignes.communes[o.insee];
  const s =
    servi(row?.couverture_actes) ??
    servi(o.propre?.couverture_actes) ??
    (o.X && !row ? servi(o.X.lignes.departements[o.dep]?.couverture_actes_communes) : null);
  if (s) return s;
  const tot = o.depTotal ?? o.X?.lignes.departements[o.dep];
  const col = o.etat === "collecte";
  // without the département's count, its acts placed nowhere are unknown: a count is a minimum
  const k = (f: "cam" | "dr") => etatActes(col, tot ? (tot[f] ?? 0) : 1);
  return { cam: k("cam"), dr: k("dr") };
}

/** Which counts a page has: the read ones (« lu », and « non_rattache » as a minimum); the others
 * say « pas encore lus ». */
export type Lecture = { cam: boolean; dr: boolean };
export const lecture = (c: CouvActes): Lecture => ({
  cam: c.cam !== "non_lu",
  dr: c.dr !== "non_lu",
});

/** A commune's figures, all from its row of listes.json: the cameras on the map and per 1 000
 * inhabitants, the camera decrees, the public money the commune engaged itself and per
 * inhabitant, the contracts of every buyer, the drone decrees, the documents. The decrees are null
 * (« non lu ») where they are not read (`lecture`); a figure divided by an unknown population is
 * null; no contract in its name gives 0 € and no amount per inhabitant. */
export type FiguresCommune = {
  carte: number | null;
  p1000: number | null;
  cam: number | null;
  amt: number;
  eph: number | null;
  con: number;
  dr: number | null;
  docs: number;
};
export const LIGNES_COMMUNE = ["carte", "p1000", "cam", "amt", "eph", "con", "dr", "docs"] as const;
export function figuresCommune(
  row: Listes["lignes"]["communes"][string] | undefined,
  pop: number | undefined,
  lu: Lecture,
): FiguresCommune {
  const carte = row?.carte ?? null;
  const p = pop ?? 0;
  const amt = row?.amt ?? 0;
  return {
    carte,
    p1000: carte !== null && p > 0 ? (1000 * carte) / p : null,
    cam: lu.cam ? (row?.cam ?? 0) : null,
    amt,
    eph: amt > 0 && p > 0 ? amt / p : null,
    con: row?.con ?? 0,
    dr: lu.dr ? (row?.dr ?? 0) : null,
    docs: row?.docs ?? 0,
  };
}

/** A company's figures, from its row of listes.json: the amount of its contracts, their number, the
 * mean amount (amount ÷ contracts, none without an amount), its clients, its départements. */
export type FiguresEntreprise = {
  amt: number;
  n: number;
  moy: number | null;
  clientes: number;
  deps: number;
};
export const LIGNES_ENTREPRISE = ["amt", "n", "moy", "clientes", "deps"] as const;
export function figuresEntreprise(
  row: Listes["lignes"]["entreprises"][string] | undefined,
): FiguresEntreprise {
  const amt = row?.amt ?? 0;
  const n = row?.n ?? 0;
  return {
    amt,
    n,
    moy: amt > 0 && n > 0 ? amt / n : null,
    clientes: row?.clientes ?? 0,
    deps: Object.keys(row?.deps ?? {}).length,
  };
}

/** The départements where every company compared has at least one client (« Où elles se
 * croisent »), in the codes' order (01…95, 2A, 2B, then overseas). */
export function depsCommuns(deps: Record<string, number>[]): string[] {
  if (deps.length < 2) return [];
  const [first, ...rest] = deps;
  const ordre = (d: string) => (d === "2A" ? 20.1 : d === "2B" ? 20.2 : Number(d) || 999);
  return Object.keys(first)
    .filter((d) => rest.every((x) => (x[d] ?? 0) > 0) && first[d] > 0)
    .sort((a, b) => ordre(a) - ordre(b));
}

/** A cell of the CSV as a spreadsheet cannot run it (listes.ts sansFormule's rule): quoted, a
 * leading =, +, -, @ escaped by an apostrophe; a number as it is. */
const cellule = (v: string | number | null): string =>
  v === null
    ? '""'
    : typeof v === "number"
      ? `"${Math.round(v * 100) / 100}"`
      : `"${(/^[=+\-@\t\r]/.test(v) ? `'${v}` : v).replace(/"/g, '""')}"`;

/** « Exporter (CSV) »: a head and one line per column compared (its id, its name, its figures; an
 * unread figure empty), UTF-8 with its mark, CRLF, as the lists' exports. */
export function csvComparaison(tete: string[], lignes: (string | number | null)[][]): string {
  return `﻿${[tete, ...lignes].map((l) => l.map(cellule).join(",")).join("\r\n")}\r\n`;
}
