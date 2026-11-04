// « Carte et drones »'s pure helpers: the slots are the build's (the commune file's `drones`,
// pipeline drones.py, DECISIONS 2026-10-29), never regrouped here; these only cut the time into
// weeks and months for « Heures de vol autorisées, par semaine », add up what a period, a week or a
// site shows, and count the tickets. Times are the pilot's: ms, read in UTC (the acts' local hours
// stored as such, as the prototype reads them).
import type { Donnees } from "../commun.ts";
import { count, fr, longDate } from "../format.ts";
import { has, t } from "../i18n.ts";

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
/** A place the act names (lot R4.2): its words, its kind, the shape that draws it (drones.formes);
 * none: cited, never drawn. */
export type Lieu = { texte: string; genre: string; forme?: string };
/** An act listed without a drawn zone. The fields after `raisons` are the R4.2 contract's: one not
 * published is absent, and the view shows nothing in its place. */
export type NonDeduit = {
  acte: string;
  kind: string;
  /** the first day of flight published, else the recueil's date */
  date: string | null;
  url: string | null;
  ref?: string | null;
  page: string | null;
  raisons: string[];
  /** « plan_annexe » (the act sends to an annexed plan) or « non_lue » */
  zone?: string;
  /** « publies », « non_publies » (read, their accuracy being measured) or « absents » */
  horaires_etat?: string;
  /** the days of flight read (YYYY-MM-DD); a period may have only its first and last day */
  jours?: string[];
  /** « 07h30-15h30 », « 20h00-fin » */
  horaires?: string[];
  cameras?: number;
  n_perimetres?: number;
  /** the act's number as written */
  numero?: string;
  /** the administration's id: « ppparis », « pref75 », … */
  autorite?: string;
  /** the act's title: never shown raw */
  titre?: string;
  service?: string;
  motif?: { categorie: string | null; libelle: string | null };
  finalites?: string[];
  lieux?: Lieu[];
};
/** A cited place's shape, approximate: an arrondissement's outline, a widened street, a circle. */
export type Forme = {
  genre?: string;
  geometry: { type: "Polygon" | "MultiPolygon"; coordinates: unknown };
  approximatif?: boolean;
};
export type Drones = {
  creneaux: Creneau[];
  non_deduits: NonDeduit[];
  formes: Record<string, Forme>;
};
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

/** The tickets over a period (board B): the acts of the kind shown (drones by default) that
 * authorise a flight or an analysis in it; those whose hours were read (a slot's stated hours, an
 * act's `horaires_etat` other than « absents »: published or not yet); those with a drawn zone (a
 * slot over a site); those without one, « zones non lues » (a slot without a site, an act listed
 * without a slot). Each act once. */
export function tickets(
  T: Creneau[],
  ND: NonDeduit[],
  r: Periode,
  k: Genre = "drone",
): { actes: number; horairesLus: number; tracees: number; nonLues: number } {
  const cs = T.filter((c) => deGenre(k, c.kind) && inPeriod(c, r));
  const ns = ND.filter((a) => deGenre(k, a.kind) && ndDans(a, r));
  const n = (xs: string[]) => new Set(xs).size;
  return {
    actes: n([...cs.flatMap((c) => c.actes), ...ns.map((a) => a.acte)]),
    horairesLus: n([
      ...cs.filter((c) => c.heures != null).flatMap((c) => c.actes),
      ...ns.filter((a) => a.horaires_etat && a.horaires_etat !== "absents").map((a) => a.acte),
    ]),
    tracees: n(cs.filter((c) => c.sites.length).flatMap((c) => c.actes)),
    nonLues: n([
      ...cs.filter((c) => !c.sites.length).flatMap((c) => c.actes),
      ...ns.map((a) => a.acte),
    ]),
  };
}

// --- « Jours de vol autorisés » (lot R4.2, board B) ---------------------------------------------

/** A day's ms (00:00 UTC) from YYYY-MM-DD. */
export const jourMs = (s: string): number => Date.parse(`${s}T00:00:00Z`);
/** YYYY-MM-DD of a day's ms. */
export const jourIso = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
/** ?jour=YYYY-MM-DD: that day, [start, end[ in ms. */
export function jourDe(s: string | null | undefined): [number, number] | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const t0 = jourMs(s);
  if (Number.isNaN(t0) || jourIso(t0) !== s) return null;
  return [t0, t0 + DAY];
}
/** The days an act listed without a slot authorises: its `jours` as read (never filled in between:
 * a period read as its first and last day shows those two), else its date for an older file. */
export const joursDe = (a: NonDeduit): string[] => a.jours ?? (a.date ? [a.date] : []);
/** An act listed without a slot in a period: one of its days in it; an act without any day (an
 * older file's undated act) is in every period. */
export function ndDans(a: NonDeduit, r: Periode): boolean {
  if (!r) return true;
  const js = joursDe(a);
  if (!js.length) return a.jours == null;
  return js.some((d) => {
    const ms = jourMs(d);
    return ms < r[1] && ms + DAY > r[0];
  });
}
/** The calendar's first day: 1 January 2024, a Monday (the brief: « de 2024 à aujourd'hui »). */
export const DEBUT_CAL = Date.UTC(2024, 0, 1);

/** For each day of [A, B[, how many acts of the kind shown authorise a flight on it: the days an
 * act listed without a slot reads (joursDe), every day a slot meets; an act once a day, its hours
 * read or not. Days without any act are left out. */
export function joursComptes(
  T: Creneau[],
  ND: NonDeduit[],
  k: Genre,
  A: number,
  B: number,
): Map<number, number> {
  const out = new Map<number, Set<string>>();
  const add = (d: number, acte: string) => {
    if (d < A || d >= B) return;
    const s = out.get(d) ?? new Set<string>();
    s.add(acte);
    out.set(d, s);
  };
  for (const c of T) {
    if (!deGenre(k, c.kind)) continue;
    for (let d = Math.floor(c.t0 / DAY) * DAY; d < c.t1; d += DAY)
      for (const a of c.actes) add(d, a);
  }
  for (const a of ND) if (deGenre(k, a.kind)) for (const j of joursDe(a)) add(jourMs(j), a.acte);
  return new Map([...out].map(([d, s]) => [d, s.size]));
}
/** A day's shade: none, 1, 2, 3, 4 acts or more (the board's legend shows 0, 1, 3 and 4+). */
export const niveau = (n: number): 0 | 1 | 2 | 3 | 4 =>
  n >= 4 ? 4 : n <= 0 ? 0 : (n as 1 | 2 | 3);
/** The fill's opacity of the ink for each shade (the board's .28, .5, .72 and full ink). */
export const TEINTE_JOUR = [0, 0.28, 0.5, 0.72, 1] as const;

export type Case = { t: number; n: number; col: number; row: number };
/** The wide screen's calendar: one column per week from A's Monday, one row per weekday (Monday
 * at the top), every day of [A, B[. */
export function grilleSemaines(
  counts: Map<number, number>,
  A: number,
  B: number,
): { cols: number; cases: Case[] } {
  const a = lundi(A);
  const cases: Case[] = [];
  for (let t = A; t < B; t += DAY)
    cases.push({
      t,
      n: counts.get(t) ?? 0,
      col: Math.floor((t - a) / WEEK),
      row: Math.round((t - lundi(t)) / DAY),
    });
  return { cols: cases.length ? cases[cases.length - 1].col + 1 : 0, cases };
}
export type LigneMois = { t0: number; l: string };
/** The phone's calendar (the brief): one row per month, the most recent at the top, one column per
 * day of the month (31), every day of [A, B[; a month's word carries its year on the first row
 * and on each December (the top of its year). */
export function grilleMois(
  counts: Map<number, number>,
  A: number,
  B: number,
): { mois: LigneMois[]; cases: Case[] } {
  const firsts: number[] = [];
  const a = new Date(A);
  for (let k = 0; ; k++) {
    const t0 = Date.UTC(a.getUTCFullYear(), a.getUTCMonth() + k, 1);
    if (t0 >= B) break;
    firsts.push(t0);
  }
  firsts.reverse();
  const row = new Map(firsts.map((t0, i) => [t0, i]));
  const mois = firsts.map((t0, i) => {
    const d = new Date(t0);
    const m = MONTH[d.getUTCMonth()];
    return { t0, l: i === 0 || d.getUTCMonth() === 11 ? `${m}${NBSP}${d.getUTCFullYear()}` : m };
  });
  const cases: Case[] = [];
  for (let t = A; t < B; t += DAY) {
    const d = new Date(t);
    cases.push({
      t,
      n: counts.get(t) ?? 0,
      col: d.getUTCDate() - 1,
      row: row.get(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)) ?? 0,
    });
  }
  return { mois, cases };
}
/** The wide calendar's marks under its columns: each year at its first week (bold, its number) and
 * each quarter's month (« avr. », « juil. », « oct. »), at the column of the week that holds the
 * month's first day. */
export function reperesCal(A: number, B: number): { col: number; l: string; an: boolean }[] {
  const a = lundi(A);
  const out: { col: number; l: string; an: boolean }[] = [];
  const d = new Date(A);
  for (let k = 0; ; k++) {
    const t0 = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + k, 1);
    if (t0 >= B) break;
    const m = new Date(t0).getUTCMonth();
    if (m % 3) continue;
    const an = m === 0;
    out.push({
      col: Math.floor((lundi(Math.max(t0, A)) - a) / WEEK),
      l: an ? String(new Date(t0).getUTCFullYear()) : MONTH[m],
      an,
    });
  }
  return out;
}

const WEEKDAY = new Intl.DateTimeFormat("fr-FR", { weekday: "short", timeZone: "UTC" });
/** « Mer. 4 nov. 2026 »: a day with its weekday (the board's calendar sentence and panel title). */
export function jourLong(ms: number): string {
  const w = WEEKDAY.format(ms);
  return `${w.charAt(0).toUpperCase()}${w.slice(1)}${NBSP}${dateTxt(ms)}`;
}
/** « 07h30-15h30 » → « 7 h 30 – 15 h 30 », « 20h00-fin » → « 20 h 00 – fin »; anything else as
 * written. */
export function horaireTxt(h: string): string {
  const m = /^\s*(\d{1,2})\s*h\s*(\d{2})?\s*[-–]\s*(?:(\d{1,2})\s*h\s*(\d{2})?|(fin))\s*$/i.exec(h);
  if (!m) return h;
  const hm = (a: string, b?: string) => t("carte.heure", { h: String(+a), m: b ?? "00" });
  return t("carte.de_a_heure", { de: hm(m[1], m[2]), a: m[5] ? t("carte.h_fin") : hm(m[3], m[4]) });
}
/** An act's hours in words: those published; « horaires non précisés » only when the act gives
 * none; « horaires non publiés (justesse en cours de mesure) » when read but not published;
 * nothing when the file does not say (an older build). */
export function horairesMots(a: NonDeduit): string {
  if (a.horaires?.length) return a.horaires.map(horaireTxt).join(", ");
  if (a.horaires_etat === "absents") return t("carte.horaires_non_precises");
  if (a.horaires_etat === "non_publies") return t("carte.horaires_non_publies");
  return "";
}
/** The act's reason: its words as read, else its category's; nothing when not published. */
export function motifTxt(a: NonDeduit): string {
  const m = a.motif;
  if (!m) return "";
  if (m.libelle) return m.libelle;
  return m.categorie && has(`registre.carte.motif_${m.categorie}`)
    ? t(`carte.motif_${m.categorie}`)
    : "";
}
/** The purposes (CSI L. 242-5) the act ticks, in words, in its order; unknown ids left out. */
export const finalitesTxt = (a: NonDeduit): string[] =>
  (a.finalites ?? [])
    .filter((f) => has(`registre.carte.finalite_${f}`))
    .map((f) => t(`carte.finalite_${f}`));
/** The zone's state in a row: « zone non lue (plan annexé) » when the act sends to an annexed plan,
 * « zone non lue » otherwise. */
export const zoneMot = (a: NonDeduit): string =>
  t(a.zone === "plan_annexe" ? "carte.zone_non_lue_plan" : "carte.zone_non_lue");
/** The places a row cites: the named ones (an arrondissement, a street, …), not the free words. */
export const secteurCourt = (a: NonDeduit): string =>
  (a.lieux ?? [])
    .filter((l) => l.genre !== "autre" && l.texte)
    .map((l) => l.texte)
    .join(", ");
/** A row of the list (section 1 of the brief): its hours, its service and reason, its zone's
 * state and cited sector; a field not published is not there and nothing takes its place. */
export function motsLigne(a: NonDeduit): { h: string; svc: string; zst: string } {
  const sec = secteurCourt(a);
  return {
    h: horairesMots(a),
    svc: [a.service ?? "", motifTxt(a)].filter(Boolean).join(" · "),
    zst: [zoneMot(a), sec ? t("carte.secteur_cite_court", { l: sec }) : ""]
      .filter(Boolean)
      .join(" · "),
  };
}
/** « Préfecture de police »; « Préfecture de Paris », « Préfecture du Rhône », « Préfecture des
 * Bouches-du-Rhône » for prefNN; « Préfecture » alone for a code the catalogue lacks. */
export function autoriteTxt(id: string | null | undefined): string {
  if (!id) return "";
  if (id === "ppparis") return t("carte.autorite_ppparis");
  const dep = /^pref([0-9]{2,3}|2[AB])$/i.exec(id)?.[1]?.toUpperCase();
  if (!dep || !has(`registre.departement.art_${dep}`)) return t("carte.autorite_pref_seule");
  const art = t(`departement.art_${dep}`);
  const de = /^le /.test(art)
    ? t("carte.de_le", { x: art.slice(3) })
    : /^les /.test(art)
      ? t("carte.de_les", { x: art.slice(4) })
      : t("carte.de_x", { x: art });
  return t("carte.autorite_pref", { de });
}
/** The act's own date when its id carries it (a recueil's act number, « 75-2026-11-03-00006 »:
 * département, date, rank), else null. */
export function dateActe(acte: string): string | null {
  const m = /^(?:\d{2,3}|2[AB])-(\d{4}-\d{2}-\d{2})-\d+$/.exec(acte);
  return m && jourDe(m[1]) ? m[1] : null;
}
/** The panel's line under its title: « Préfecture de police, arrêté n° 2026-01518 du 3 novembre
 * 2026 », built from the authority, the number and the act's date, each left out when unknown;
 * never the act's ref nor its recueil's file name. */
export function enTete(a: NonDeduit): string {
  const d = dateActe(a.acte);
  const arr = [
    a.numero ? t("carte.arrete_n", { n: a.numero }) : t("carte.arrete_mot"),
    d ? t("carte.du_date", { date: longDate(d) }) : "",
  ]
    .filter(Boolean)
    .join(" ");
  return [autoriteTxt(a.autorite), arr].filter(Boolean).join(", ");
}
/** The panel's « Zone » line: the annexed plans' perimeters, which the register does not read, or
 * a zone not read. */
export function zonePanneau(a: NonDeduit): string {
  if (a.zone !== "plan_annexe") return t("carte.zone_panneau_non_lue");
  return a.n_perimetres
    ? t("carte.zone_panneau_plans", { n: a.n_perimetres })
    : t("carte.zone_panneau_plan");
}
/** The panel's cited sector: the named places, then the free words between guillemets
 * (« 14e arrondissement, « aux abords des lycées et des universités » »); nothing when none. */
export function secteurPanneau(a: NonDeduit): string {
  const ls = (a.lieux ?? []).filter((l) => l.texte);
  if (!ls.length) return "";
  const mots = ls.map((l) => (l.genre === "autre" ? t("carte.cite", { x: l.texte }) : l.texte));
  return t("carte.secteur_cite", { l: mots.join(", ") });
}
/** A slot's hours, « 7 h 00 – 11 h 00 » (its end's hour, whatever its day). */
function heuresCreneau(c: Creneau): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const hm = (ms: number) => {
    const d = new Date(ms);
    return t("carte.heure", { h: String(d.getUTCHours()), m: pad(d.getUTCMinutes()) });
  };
  return t("carte.de_a_heure", { de: hm(c.t0), a: hm(c.t1) });
}
/** The sentence under the calendar on a day (board B): « Mer. 4 nov. 2026 » apart (bold), then the
 * acts that authorise a flight on it, their hours (those read, else why there are none), the
 * sectors they cite, the zone's state; a part the acts do not give is left out. */
export function phraseJour(
  d: number,
  T: Creneau[],
  ND: NonDeduit[],
  k: Genre,
): { date: string; reste: string } {
  const r: [number, number] = [d, d + DAY];
  const cs = T.filter((c) => deGenre(k, c.kind) && overlaps(c, r[0], r[1]));
  const ns = ND.filter((a) => deGenre(k, a.kind) && ndDans(a, r));
  const n = new Set([...cs.flatMap((c) => c.actes), ...ns.map((a) => a.acte)]).size;
  const lues = [
    ...cs.filter((c) => c.heures != null).map(heuresCreneau),
    ...ns.flatMap((a) => (a.horaires ?? []).map(horaireTxt)),
  ];
  const heures = lues.length
    ? [...new Set(lues)].join(", ")
    : ns.some((a) => a.horaires_etat === "non_publies")
      ? t("carte.horaires_non_publies")
      : ns.some((a) => a.horaires_etat === "absents") || cs.length
        ? t("carte.horaires_non_precises")
        : "";
  const sec = [...new Set(ns.map(secteurCourt).filter(Boolean))].join(", ");
  const tracees = new Set(cs.filter((c) => c.sites.length).flatMap((c) => c.actes)).size;
  const nonLues = new Set([
    ...cs.filter((c) => !c.sites.length).flatMap((c) => c.actes),
    ...ns.map((a) => a.acte),
  ]).size;
  return {
    date: jourLong(d),
    reste: [
      n ? count(n, "arrete") : t("carte.jour_aucun"),
      heures,
      sec ? t("carte.secteur_cite_jour", { l: sec }) : "",
      tracees ? t("carte.n_zones_tracees", { n: tracees }) : "",
      nonLues ? t("carte.n_zones_non_lues", { n: nonLues }) : "",
    ]
      .filter(Boolean)
      .join(" · "),
  };
}
/** « 6 », « 6, soit 2 par périmètre » when the perimeters share them evenly. */
export function camerasTxt(a: NonDeduit): string {
  const n = a.cameras;
  if (typeof n !== "number" || !(n > 0)) return "";
  const p = a.n_perimetres;
  return p && p > 1 && n % p === 0 ? t("carte.cameras_par", { n: fr(n), k: fr(n / p) }) : fr(n);
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
/** A zone's label on the map, short (v2.3): its hours (« 7,5 h »), or « sans horaires ». */
export function volLabel(v: { heures: number; n: number }): string {
  return t("carte.vol_label", { h: v.heures ? heuresTxt(v.heures) : t("carte.vol_sans_horaires") });
}

/** The commune file's slots (an older file has none: no slot). */
export function drones(d: Donnees): Drones {
  const x = (d.f as { drones?: Partial<Drones> }).drones;
  return {
    creneaux: x?.creneaux ?? [],
    non_deduits: x?.non_deduits ?? [],
    formes: x?.formes ?? {},
  };
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
