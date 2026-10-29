// « Carte et drones »'s pure helpers (the prototype's vues/carte.js, its frieze and its sums): the slots
// are the build's (the commune file's `drones`, pipeline drones.py), never regrouped here; these only
// place them on the frieze and add up what a period or a slot shows. Times are the pilot's: ms, read in
// UTC (the acts' local hours stored as such, as the prototype reads them).
import type { Donnees } from "../commun.ts";
import type { RichItem } from "../dc.ts";
import { fr } from "../format.ts";
import { t } from "../i18n.ts";

export type Creneau = {
  t0: number;
  t1: number;
  /** The hours the act states; null: « horaires non précisés dans l'arrêté ». */
  heures: number | null;
  kind: "drone" | "vsa" | string;
  service: string | null;
  finalite: string | null;
  url: string | null;
  actes: string[];
  sites: string[];
  statut: "relu" | "indicatif" | string;
};
export type NonDeduit = {
  acte: string;
  kind: string;
  date: string | null;
  url: string | null;
  ref: string | null;
  page: string | null;
  raisons: string[];
};
export type Drones = { creneaux: Creneau[]; non_deduits: NonDeduit[] };

const NBSP = " ";
const OSM_COPYRIGHT = "https://www.openstreetmap.org/copyright";
const MONTH = Array.from({ length: 12 }, (_, m) =>
  new Intl.DateTimeFormat("fr-FR", { month: "short", timeZone: "UTC" }).format(
    Date.UTC(2026, m, 15),
  ),
);
const hours = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });

/** The frieze's width in its viewBox (1144, 4 of margin each side) and the axis. */
export const W = 1136;
/** The frieze's start when the commune has no slot (the prototype's: the first collected acts). */
export const DEBUT = Date.UTC(2025, 10, 1);

/** « 23 oct. 2026 », with the hour: « 23 oct. 2026, 19 h 00 ». */
export function dateTxt(ms: number, withHour = false): string {
  const d = new Date(ms);
  const day = `${d.getUTCDate()}${NBSP}${MONTH[d.getUTCMonth()]}${NBSP}${d.getUTCFullYear()}`;
  if (!withHour) return day;
  const pad = (n: number) => String(n).padStart(2, "0");
  return t("carte.date_heure", { date: day, h: pad(d.getUTCHours()), m: pad(d.getUTCMinutes()) });
}

/** « 4 h », « 2,5 h », « 1 367 h ». */
export const heuresTxt = (h: number): string =>
  t("carte.heures_n", { n: h >= 1000 ? fr(h) : hours.format(h) });

/** The hours a slot counts on the map and in the sums: those the act states, none otherwise. */
export const lues = (c: Creneau): number => c.heures ?? 0;

/** ?mois=YYYY-MM: that month, [start, end[ in ms. */
export function mois(m: string): [number, number] | null {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) return null;
  const y = +m.slice(0, 4);
  const k = +m.slice(5, 7) - 1;
  return [Date.UTC(y, k, 1), Date.UTC(y, k + 1, 1)];
}

/** The frieze's span: from the first slot's month to today. */
export function span(T: Creneau[], today: number): { A: number; B: number } {
  if (!T.length) return { A: DEBUT, B: Math.max(today, DEBUT + 1) };
  const d = new Date(Math.min(...T.map((c) => c.t0)));
  const A = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  const end = Math.max(today, ...T.map((c) => c.t1));
  return { A, B: Math.max(end, A + 1) };
}

export const overlaps = (c: Creneau, r0: number, r1: number): boolean => c.t1 > r0 && c.t0 < r1;

/** x on the frieze. */
export const xOf = (ms: number, A: number, B: number): number => 4 + ((ms - A) / (B - A)) * W;
/** ms under x on the frieze. */
export const msOf = (x: number, A: number, B: number): number => A + ((x - 4) / W) * (B - A);

/** One bar per slot, at its date and of its real length (4 px at least), stacked in lanes when two
 * would overlap; the first lane at the bottom. */
export function bars(T: Creneau[], A: number, B: number): { x: number; w: number; y: number }[] {
  const ends: number[] = [];
  return T.map((c) => {
    const x = xOf(c.t0, A, B);
    const w = Math.max(4, xOf(c.t1, A, B) - x);
    let lane = 0;
    while (ends[lane] != null && ends[lane] > x - 2) lane++;
    ends[lane] = x + w;
    return { x, w, y: Math.max(4, 112 - lane * 15) };
  });
}

/** The months' ticks; a month's label carries its year in January, and the first one too when no
 * January is on the frieze (« nov. », …, « janv. 2026 »). */
export function months(A: number, B: number): { x: number; tx: number; l: string }[] {
  const out: { x: number; tx: number; l: string; m: number; y: number }[] = [];
  const a = new Date(A);
  for (let k = 0; ; k++) {
    const ms = Date.UTC(a.getUTCFullYear(), a.getUTCMonth() + k, 1);
    if (ms >= B) break;
    const d = new Date(ms);
    const x = xOf(ms, A, B);
    out.push({
      x,
      tx: x + 4,
      l: MONTH[d.getUTCMonth()],
      m: d.getUTCMonth(),
      y: d.getUTCFullYear(),
    });
  }
  const january = out.some((o) => o.m === 0);
  return out.map((o, i) => ({
    x: o.x,
    tx: o.tx,
    l: o.m === 0 || (i === 0 && !january) ? `${o.l} ${o.y}` : o.l,
  }));
}

/** The hours of the slots shown: each slot whole when one is chosen or every date is shown, its
 * share of a chosen period otherwise (the prototype's); a slot without its hours counts none. */
export function sumHours(T: Creneau[], r: [number, number] | null): number {
  return T.reduce((s, c) => {
    if (!r) return s + lues(c);
    const part = (Math.min(c.t1, r[1]) - Math.max(c.t0, r[0])) / Math.max(1, c.t1 - c.t0);
    return s + lues(c) * Math.max(0, Math.min(1, part));
  }, 0);
}

/** The map's volumes: for each site, the hours of the slots shown over it (a slot once, however
 * many acts authorise it) and the number of acts; a site whose slots state no hours keeps the
 * lowest volume (carte3d's volumeHeight for 0 h). */
export function sitesHours(T: Creneau[]): Record<string, { heures: number; n: number }> {
  const out = new Map<string, { heures: number; actes: Set<string> }>();
  for (const c of T)
    for (const s of c.sites) {
      const x = out.get(s) ?? { heures: 0, actes: new Set<string>() };
      x.heures += lues(c);
      for (const a of c.actes) x.actes.add(a);
      out.set(s, x);
    }
  return Object.fromEntries([...out].map(([k, x]) => [k, { heures: x.heures, n: x.actes.size }]));
}

/** The map's credits under its frame, as L'essentiel gives them: the cameras' source (the map
 * file's), then the basemap's, OpenStreetMap linked (ODbL). */
export function attribution(source: string): RichItem[] {
  const [before, after = ""] = t("carte.attribution", { osm: "\uE000" }).split("\uE000");
  return [
    ...(source ? [`${source}. `] : []),
    before,
    { a: { href: OSM_COPYRIGHT, text: t("carte.attribution_osm") } },
    after,
  ].filter((x) => x !== "");
}

/** The commune file's slots (an older file has none: no slot). */
export function drones(d: Donnees): Drones {
  const x = (d.f as { drones?: Partial<Drones> }).drones;
  return { creneaux: x?.creneaux ?? [], non_deduits: x?.non_deduits ?? [] };
}
