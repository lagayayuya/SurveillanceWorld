// « Carte et drones »'s pure helpers: the slots are the build's (the commune file's `drones`,
// pipeline drones.py, DECISIONS 2026-10-29), never regrouped here; these only cut the time into
// weeks and months for « Heures de vol autorisées, par semaine », add up what a period, a week or a
// site shows, and count the tickets. Times are the pilot's: ms, read in UTC (the acts' local hours
// stored as such, as the prototype reads them).
import type { Donnees } from "../commun.ts";
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
  /** The sites it flies over; none: its zone was not deduced from the act (listed, not drawn). */
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
/** A period [start, end[ in ms; null: every date. */
export type Periode = [number, number] | null;

const NBSP = " ";
const DAY = 86_400_000;
const WEEK = 7 * DAY;
const MONTH = Array.from({ length: 12 }, (_, m) =>
  new Intl.DateTimeFormat("fr-FR", { month: "short", timeZone: "UTC" }).format(
    Date.UTC(2026, m, 15),
  ),
);
const hours = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });

/** The chart's start when the commune has no slot (the prototype's: the first collected acts). */
export const DEBUT = Date.UTC(2025, 10, 1);

/** The day of the month, « 1er » for the first (format.ts longDate's). */
const quantieme = (d: Date): string =>
  d.getUTCDate() === 1 ? t("format.premier") : String(d.getUTCDate());

/** « 23 oct. 2026 », « 1er nov. 2025 »; with the hour: « 23 oct. 2026, 19 h 00 ». */
export function dateTxt(ms: number, withHour = false): string {
  const d = new Date(ms);
  const day = `${quantieme(d)}${NBSP}${MONTH[d.getUTCMonth()]}${NBSP}${d.getUTCFullYear()}`;
  if (!withHour) return day;
  const pad = (n: number) => String(n).padStart(2, "0");
  return t("carte.date_heure", { date: day, h: pad(d.getUTCHours()), m: pad(d.getUTCMinutes()) });
}
/** « 23 oct. », the year left out (a week's tooltip, whose year the axis gives). */
export function jourTxt(ms: number): string {
  const d = new Date(ms);
  return `${quantieme(d)}${NBSP}${MONTH[d.getUTCMonth()]}`;
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

/** ?semaine=YYYY-MM-DD (its Monday): that week, [start, end[ in ms. */
export function semaineDe(s: string | null | undefined): [number, number] | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const t0 = Date.parse(`${s}T00:00:00Z`);
  if (Number.isNaN(t0) || lundi(t0) !== t0) return null;
  return [t0, t0 + WEEK];
}

export const overlaps = (c: Creneau, r0: number, r1: number): boolean => c.t1 > r0 && c.t0 < r1;
const inPeriod = (c: Creneau, r: Periode): boolean => !r || overlaps(c, r[0], r[1]);

/** The Monday (00:00 UTC) of the week that holds `ms`. */
export function lundi(ms: number): number {
  const d = new Date(ms);
  const day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return day - ((d.getUTCDay() + 6) % 7) * DAY;
}

/** The chart's span: from the Monday of the first slot's week to the end of the week that holds
 * today or the last slot's end, whichever is later. */
export function span(T: Creneau[], today: number): { A: number; B: number } {
  const first = T.length ? Math.min(...T.map((c) => c.t0)) : DEBUT;
  const end = Math.max(today, ...T.map((c) => c.t1));
  const A = lundi(first);
  return { A, B: lundi(end - 1) + WEEK };
}

/** The hours of the slots shown: each slot whole for every date, its share of a chosen period
 * otherwise (the prototype's); a slot without its hours counts none. */
export function sumHours(T: Creneau[], r: Periode): number {
  return T.reduce((s, c) => {
    if (!r) return s + lues(c);
    const part = (Math.min(c.t1, r[1]) - Math.max(c.t0, r[0])) / Math.max(1, c.t1 - c.t0);
    return s + lues(c) * Math.max(0, Math.min(1, part));
  }, 0);
}

export type Semaine = { t0: number; t1: number; heures: number; actes: number };
/** One bar per week from A to B: the hours its slots authorise in it (their share, as a period
 * takes it: the bars add up to the period's ticket) and how many acts authorise them. */
export function semaines(T: Creneau[], A: number, B: number): Semaine[] {
  const out: Semaine[] = [];
  for (let t0 = A; t0 < B; t0 += WEEK) {
    const t1 = t0 + WEEK;
    const ins = T.filter((c) => overlaps(c, t0, t1));
    out.push({
      t0,
      t1,
      heures: sumHours(ins, [t0, t1]),
      actes: new Set(ins.flatMap((c) => c.actes)).size,
    });
  }
  return out;
}

export type Mois = { t0: number; t1: number; l: string; heures: number };
/** The months under the bars, each [start, end[ clipped to the chart; a month's word carries its
 * year in January, and the first one too when no January is shown (« nov. », …, « janv. 2026 »). */
export function moisAxe(T: Creneau[], A: number, B: number): Mois[] {
  const out: (Mois & { m: number; y: number })[] = [];
  const a = new Date(A);
  for (let k = 0; ; k++) {
    const t0 = Date.UTC(a.getUTCFullYear(), a.getUTCMonth() + k, 1);
    if (t0 >= B) break;
    const t1 = Date.UTC(a.getUTCFullYear(), a.getUTCMonth() + k + 1, 1);
    const d = new Date(t0);
    out.push({
      t0,
      t1,
      l: MONTH[d.getUTCMonth()],
      m: d.getUTCMonth(),
      y: d.getUTCFullYear(),
      heures: sumHours(
        T.filter((c) => overlaps(c, t0, t1)),
        [t0, t1],
      ),
    });
  }
  const january = out.some((o) => o.m === 0);
  return out.map((o, i) => ({
    t0: o.t0,
    t1: o.t1,
    heures: o.heures,
    l: o.m === 0 || (i === 0 && !january) ? `${o.l} ${String(o.y).slice(2)}` : o.l,
  }));
}

/** The reference line: the highest week rounded up to 1, 2 or 5 times a power of ten (« 450 h »
 * on the board is 500 h here), so that the tallest bar stays under it; 10 h at least. */
export function repere(max: number): number {
  if (max <= 10) return 10;
  const p = 10 ** Math.floor(Math.log10(max));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= max) return m * p;
  return 10 * p;
}

/** The kinds of act the view shows: drones, algorithmic analysis, or both (null). */
export type Genre = "drone" | "vsa" | null;
/** ?genre=: « drone » or « vsa », else both. */
export const genre = (s: string | null | undefined): Genre =>
  s === "drone" || s === "vsa" ? s : null;
export const deGenre = (k: Genre, kind: string): boolean => !k || kind === k;

/** The tickets over a period: the acts of the kind shown (drones by default) that authorise a
 * flight or an analysis in it, the hours they authorise there (the slots whose act states them:
 * the others count none), the slots whose act does not state the hours (B2: what the board's
 * « zones non déduites · 21 » counted, its acts' `heures_sures` false), and the acts whose zone was
 * not deduced (a slot without a site, or an act the build lists without a slot, dated in the
 * period), shown only when there are some. */
export function tickets(
  T: Creneau[],
  ND: NonDeduit[],
  r: Periode,
  k: Genre = "drone",
): { actes: number; heures: number; sansHoraires: number; nonDeduites: number } {
  const drones = T.filter((c) => deGenre(k, c.kind) && inPeriod(c, r));
  const ndIn = ND.filter((a) => deGenre(k, a.kind) && dansPeriode(a.date, r));
  return {
    actes: new Set([...drones.flatMap((c) => c.actes), ...ndIn.map((a) => a.acte)]).size,
    heures: sumHours(drones, r),
    sansHoraires: drones.filter((c) => c.heures == null).length,
    nonDeduites: new Set([
      ...drones.filter((c) => !c.sites.length).flatMap((c) => c.actes),
      ...ndIn.map((a) => a.acte),
    ]).size,
  };
}

/** A listed act's date (YYYY-MM-DD) in a period; an act without a date is in every period. */
export function dansPeriode(date: string | null, r: Periode): boolean {
  if (!r || !date) return true;
  const ms = Date.parse(`${date}T00:00:00Z`);
  return ms < r[1] && ms + DAY > r[0];
}

/** The map's volumes: for each site, the hours of the slots shown over it (a slot once, however
 * many acts authorise it; its share of a chosen period, as the bars take it) and the number of
 * acts; a site whose slots state no hours keeps the lowest volume (volumeHeight for 0 h). */
export function sitesHours(
  T: Creneau[],
  r: Periode = null,
): Record<string, { heures: number; n: number }> {
  const out = new Map<string, { heures: number; actes: Set<string> }>();
  for (const c of T)
    for (const s of c.sites) {
      const x = out.get(s) ?? { heures: 0, actes: new Set<string>() };
      x.heures += sumHours([c], r);
      for (const a of c.actes) x.actes.add(a);
      out.set(s, x);
    }
  return Object.fromEntries([...out].map(([k, x]) => [k, { heures: x.heures, n: x.actes.size }]));
}

/** A volume's words: « 6 h · 1 arrêté »; « horaires non précisés · 1 arrêté » without hours. */
export function volLabel(v: { heures: number; n: number }): string {
  return t("carte.vol_label", {
    h: v.heures ? heuresTxt(v.heures) : t("carte.horaires_non_precises"),
    n: v.n,
  });
}

/** The commune file's slots (an older file has none: no slot). */
export function drones(d: Donnees): Drones {
  const x = (d.f as { drones?: Partial<Drones> }).drones;
  return { creneaux: x?.creneaux ?? [], non_deduits: x?.non_deduits ?? [] };
}

// --- a slot's keys, its zones, its words (v2.1 A4, A8) -----------------------------------------

/** Each slot's key in the view's state and address: its act's id, « ~n » for the act's n-th slot
 * by start (n > 1); an act listed without a slot is its id alone. */
export function cles(T: Creneau[]): string[] {
  const rang = new Map<string, number>();
  const ordre = T.map((_, i) => i).sort((a, b) => T[a].t0 - T[b].t0 || a - b);
  const out: string[] = new Array(T.length);
  for (const i of ordre) {
    const a = T[i].actes[0] ?? "";
    const n = (rang.get(a) ?? 0) + 1;
    rang.set(a, n);
    out[i] = n > 1 ? `${a}~${n}` : a;
  }
  return out;
}
/** A key to the address's ?acte= and ?creneau= (the n-th slot, when not the first). */
export function versAdresse(k: string): { acte: string; creneau: string | null } {
  const m = /^(.*)~(\d+)$/.exec(k);
  return m ? { acte: m[1], creneau: m[2] } : { acte: k, creneau: null };
}
export const deAdresse = (acte: string | null, creneau: string | null): string | null =>
  acte ? (creneau && /^\d+$/.test(creneau) && +creneau > 1 ? `${acte}~${+creneau}` : acte) : null;

/** A zone of the commune file (zones.zones), as the panel reads it. */
export type ZoneLue = {
  acte: string;
  t0: number;
  t1: number;
  detail?: string | null;
  site?: string | null;
  statut?: string | null;
  cameras?: number | null;
  hauteur?: number | null;
  hauteur_lue?: boolean;
  alerte?: string | null;
};
/** The zones a slot comes from: its acts' zones whose time meets it (the build merges the zones
 * of one act and one time into one slot, drones.py). */
export function zonesDe(c: Creneau, zones: ZoneLue[]): ZoneLue[] {
  return zones.filter((z) => c.actes.includes(z.acte) && z.t0 < c.t1 && z.t1 > c.t0);
}
/** The places the act names, each once, in its order, with the site that draws it (none: not
 * drawn). */
export function lieux(zs: ZoneLue[]): { l: string; site: string | null }[] {
  const out = new Map<string, string | null>();
  for (const z of zs) {
    const l = (z.detail ?? "").replace(/\s+/g, " ").trim();
    if (!l) continue;
    if (!out.has(l) || (!out.get(l) && z.site)) out.set(l, z.site ?? null);
  }
  return [...out].map(([l, site]) => ({ l, site }));
}
/** The devices the act authorises for the slot: the most its zones state, else the act's own
 * figure; null: not stated. */
export function appareils(zs: ZoneLue[], acte: number | null | undefined): number | null {
  const n = zs.map((z) => z.cameras).filter((x): x is number => typeof x === "number" && x > 0);
  return n.length ? Math.max(...n) : typeof acte === "number" && acte > 0 ? acte : null;
}
/** « 11 nov. 2025, 7 h 00 → 11 h 00 », the end's date too when it is another day; the date
 * alone when the act states no hours. */
export function plage(c: Creneau): string {
  if (c.heures == null) return t("carte.plage_sans_heures", { date: dateTxt(c.t0) });
  const a = new Date(c.t0);
  const b = new Date(c.t1 - 1);
  const memeJour = a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);
  const pad = (n: number) => String(n).padStart(2, "0");
  const fin = new Date(c.t1);
  return t("carte.plage", {
    de: dateTxt(c.t0, true),
    a: memeJour
      ? t("carte.heure", { h: pad(fin.getUTCHours()), m: pad(fin.getUTCMinutes()) })
      : dateTxt(c.t1, true),
  });
}
