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

/** A commune's figures, all from its row of listes.json: the cameras on the map and per 1 000
 * inhabitants, the camera decrees, the public money the commune engaged itself and per
 * inhabitant, the contracts of every buyer, the drone decrees, the documents. The decrees are null
 * (« non lu ») where its département's decrees are not read; a figure divided by an unknown
 * population is null; no contract in its name gives 0 € and no amount per inhabitant. */
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
  lu: boolean,
): FiguresCommune {
  const carte = row?.carte ?? null;
  const p = pop ?? 0;
  const amt = row?.amt ?? 0;
  return {
    carte,
    p1000: carte !== null && p > 0 ? (1000 * carte) / p : null,
    cam: lu ? (row?.cam ?? 0) : null,
    amt,
    eph: amt > 0 && p > 0 ? amt / p : null,
    con: row?.con ?? 0,
    dr: lu ? (row?.dr ?? 0) : null,
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
