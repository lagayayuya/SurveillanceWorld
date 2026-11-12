// A département's fiche in theme A (board Departement-Rhone-A, redesign v3 lot 3): what it computes
// from the département's file, listes.json and the IGN outlines, pure, for the tests. Every figure
// is the build's (one source per figure, Ju 07/11): the ranks among the départements
// (`lignes.departements`), who pays (the buyers' counted amounts by their served category), the
// communes on the map (their town hall's point, projected as the outlines are drawn).

// --- the communes' points on the IGN drawing ----------------------------------------------------

/** Lambert-93 (EPSG:2154, the conic conformal of the IGN: GRS80, standard parallels 44° and 49°,
 * origin 46°30′ N 3° E, false easting 700 000 m, false northing 6 600 000 m), in metres. */
const A = 6378137;
const F = 1 / 298.257222101;
const E = Math.sqrt(2 * F - F * F);
const RAD = Math.PI / 180;
const mm = (p: number) => Math.cos(p) / Math.sqrt(1 - E * E * Math.sin(p) ** 2);
const tt = (p: number) =>
  Math.tan(Math.PI / 4 - p / 2) / ((1 - E * Math.sin(p)) / (1 + E * Math.sin(p))) ** (E / 2);
const P1 = 44 * RAD;
const P2 = 49 * RAD;
const N = (Math.log(mm(P1)) - Math.log(mm(P2))) / (Math.log(tt(P1)) - Math.log(tt(P2)));
const FF = mm(P1) / (N * tt(P1) ** N);
const RHO0 = A * FF * tt(46.5 * RAD) ** N;
export function lambert93(lon: number, lat: number): [number, number] {
  const rho = A * FF * tt(lat * RAD) ** N;
  const th = N * (lon - 3) * RAD;
  return [700000 + rho * Math.sin(th), 6600000 + RHO0 - rho * Math.cos(th)];
}

/** geo/departements.json draws metropolitan France in Lambert-93 scaled into its box, its west
 * edge at the drawing's left, its north edge at its top (pipeline geo.py `departements`). The
 * bounds of that France are not served: measured on the build of 2026-11-08 (5 065 communes'
 * points, `listes.json` `ll`, against their département's outline: 98 % inside, the others
 * within 6 px at a fiche's scale, coastal communes of the simplified outline). */
export const L93 = { x0: 99888, largeur: 1143000, y1: 7110500 };

/** A path's numbers as points (the outlines' paths are absolute M/L/Z). */
export function points(d: string): [number, number][] {
  const n = d.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < n.length; i += 2) out.push([n[i], n[i + 1]]);
  return out;
}
export type Boite = [number, number, number, number];
export function boite(d: string): Boite {
  const b: Boite = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of points(d)) {
    b[0] = Math.min(b[0], x);
    b[1] = Math.min(b[1], y);
    b[2] = Math.max(b[2], x);
    b[3] = Math.max(b[3], y);
  }
  return b;
}

/** A town hall's point ([lon, lat]) in the drawing's pixels, from France's outline's box. */
export function projection(france: Boite): (ll: [number, number]) => [number, number] {
  const s = (france[2] - france[0]) / L93.largeur;
  return (ll) => {
    const [x, y] = lambert93(ll[0], ll[1]);
    return [france[0] + (x - L93.x0) * s, france[1] + (L93.y1 - y) * s];
  };
}

/** The département's box fitted into w × h (its width or its height filling it), `m` around:
 * the drawing's point to the fiche's map, and the map's size. */
export function cadrer(
  b: Boite,
  w: number,
  h: number,
  m = 12,
): { z: number; W: number; H: number; f: (p: [number, number]) => [number, number] } {
  const z = Math.min(
    (w - 2 * m) / Math.max(1e-9, b[2] - b[0]),
    (h - 2 * m) / Math.max(1e-9, b[3] - b[1]),
  );
  return {
    z,
    W: Math.round((b[2] - b[0]) * z + 2 * m),
    H: Math.round((b[3] - b[1]) * z + 2 * m),
    f: ([x, y]) => [m + (x - b[0]) * z, m + (y - b[1]) * z],
  };
}

/** A path redrawn through a point's change (the outline at the fiche's scale). */
export function recadrer(d: string, f: (p: [number, number]) => [number, number]): string {
  return d.replace(
    /M[^Z]*Z/g,
    (sub) =>
      `M${points(sub)
        .map((p) =>
          f(p)
            .map((v) => v.toFixed(1))
            .join(" "),
        )
        .join("L")}Z`,
  );
}

// --- the map's measures ---------------------------------------------------------------------------

/** The map's four measures (the board's « Caméras · € / hab. · Arrêtés · Drones ») and their five
 * classes: the board's for the cameras (for 1 000 inhabitants: under 0.5, 0.5 to 1.5, 1.5 to 3,
 * 3 to 5, 5 and more); for the others the board draws none, so breaks of the same spread, the first
 * class the communes with little or none (€ per inhabitant: under 1, 1 to 5, 5 to 15, 15 to 40, 40
 * and more; decrees: none, 1 to 2, 3 to 9, 10 to 29, 30 and more). */
export type Mesure = "cameras" | "eph" | "aut" | "dr";
export const MESURES: Mesure[] = ["cameras", "eph", "aut", "dr"];
export const SEUILS: Record<Mesure, [number, number, number, number]> = {
  cameras: [0.5, 1.5, 3, 5],
  eph: [1, 5, 15, 40],
  aut: [1, 3, 10, 30],
  dr: [1, 3, 10, 30],
};
/** A value's class, 0 to 4 (the map's q0 to q4); none when the value is unknown. */
export function classe(v: number | null, seuils: readonly number[]): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  let k = 0;
  while (k < seuils.length && v >= seuils[k]) k++;
  return k;
}
/** A commune's value for a measure: cameras on the map for 1 000 inhabitants, its own contracts'
 * amount per inhabitant (both unknown without its population), its decrees. */
export function valeur(
  m: Mesure,
  c: { pop?: number | null; carte?: number | null; montant?: number; cam?: number; dr?: number },
): number | null {
  const pop = c.pop ?? 0;
  if (m === "cameras") return pop > 0 && c.carte != null ? (1000 * c.carte) / pop : null;
  if (m === "eph") return pop > 0 ? (c.montant ?? 0) / pop : null;
  return m === "aut" ? (c.cam ?? 0) : (c.dr ?? 0);
}

// --- ranks among the départements ----------------------------------------------------------------

/** Under this many ranked, a rank says nothing (Ju 08/11, as the communes' `rang`). */
export const RANG_MIN = 5;
/** A département's rank among others (1 the largest; ties share the better rank), how many, the
 * leader and the ones just ahead (the board's « derrière les Alpes-Maritimes et le Nord »). */
export type Rang = { r: number; n: number; tete: string; devant: string[] };
export function rangDep(
  code: string,
  vals: Record<string, number>,
  univers: readonly string[],
): Rang | null {
  const v = vals[code];
  if (v == null || !univers.includes(code)) return null;
  const rows = univers
    .map((k) => ({ k, v: vals[k] ?? 0 }))
    .sort((a, b) => b.v - a.v || a.k.localeCompare(b.k));
  if (rows.length < RANG_MIN) return null;
  const r = rows.filter((x) => x.v > v).length + 1;
  return {
    r,
    n: rows.length,
    tete: rows[0].k,
    devant: rows.filter((x) => x.v > v).map((x) => x.k),
  };
}
/** A ranking's rows as the board shows them: the first five, then « … » and the département when it
 * is further (its rank its own). */
export type LigneRang = { k: string; r: number; v: number; me: boolean; gap?: boolean };
export function tete(
  code: string,
  vals: Record<string, number>,
  univers: readonly string[],
  n = 5,
): LigneRang[] {
  const rows = univers
    .map((k) => ({ k, v: vals[k] ?? 0 }))
    .sort((a, b) => b.v - a.v || a.k.localeCompare(b.k));
  const rangDe = (v: number) => rows.filter((x) => x.v > v).length + 1;
  const out: LigneRang[] = rows
    .slice(0, n)
    .map((x) => ({ k: x.k, r: rangDe(x.v), v: x.v, me: x.k === code }));
  const i = rows.findIndex((x) => x.k === code);
  if (i >= n) {
    out.push({ k: "", r: 0, v: 0, me: false, gap: true });
    out.push({ k: code, r: rangDe(rows[i].v), v: rows[i].v, me: true });
  }
  return out;
}

// --- who pays -------------------------------------------------------------------------------------

/** The board's « Qui paie » classes: the communes, the transports, the social landlords, the State,
 * the département, every other category (health, education, intercommunalities, the
 * métropole, the region, others) together. */
export type Payeur = "commune" | "transports" | "bailleur" | "etat" | "departement" | "autres";
export const PAYEURS: Payeur[] = [
  "commune",
  "transports",
  "bailleur",
  "etat",
  "departement",
  "autres",
];
export function payeur(categorie: string | null | undefined): Payeur {
  return (PAYEURS as string[]).includes(categorie ?? "") && categorie !== "autres"
    ? (categorie as Payeur)
    : "autres";
}
/** The counted amounts of the département's buyers by class, the largest classes first and « autres »
 * last, each with its share in whole percents; the classes with nothing left out. */
export type Part = { k: Payeur; montant: number; pct: number; acheteurs: string[] };
export function quiPaie(
  acheteurs: { siren: string; montant: number }[],
  categorie: (siren: string) => string | null | undefined,
): Part[] {
  const by = new Map<Payeur, Part>();
  let tot = 0;
  for (const a of acheteurs) {
    if (!(a.montant > 0)) continue;
    const k = payeur(categorie(a.siren));
    const p = by.get(k) ?? { k, montant: 0, pct: 0, acheteurs: [] };
    p.montant += a.montant;
    p.acheteurs.push(a.siren);
    by.set(k, p);
    tot += a.montant;
  }
  return [...by.values()]
    .map((p) => ({ ...p, pct: Math.round((100 * p.montant) / Math.max(1, tot)) }))
    .sort((a, b) => (a.k === "autres" ? 1 : b.k === "autres" ? -1 : b.montant - a.montant));
}

/** A share in words, as the board's lead says it (« les trois quarts », « près d'un tiers »): the
 * catalogue's key, none when no word fits (under a fifth). */
export function fraction(x: number): string | null {
  if (!(x > 0)) return null;
  if (x >= 0.95) return "presque_tout";
  if (x >= 0.7) return "trois_quarts";
  if (x >= 0.6) return "deux_tiers";
  if (x >= 0.45) return "moitie";
  if (x >= 0.36) return "plus_tiers";
  if (x >= 0.31) return "tiers";
  if (x >= 0.27) return "pres_tiers";
  if (x >= 0.23) return "quart";
  if (x >= 0.2) return "pres_quart";
  return null;
}

// --- the communes ---------------------------------------------------------------------------------

/** « Les plus équipées »: the communes of 10 000 inhabitants or more by cameras on the map for
 * 1 000 inhabitants, the most first; of 1 000 or more when fewer than five reach 10 000 (a village
 * of 90 with five cameras says nothing), all of them when fewer than five reach that. */
export const SEUILS_EQUIPEES = [10000, 1000] as const;
export function plusEquipees<T extends { pop: number; cams: number | null }>(
  rows: T[],
  n = 8,
): { rows: (T & { v: number })[]; seuil: number } {
  const avec = rows.filter((c) => c.pop > 0 && c.cams != null && c.cams > 0);
  const seuil = SEUILS_EQUIPEES.find((s) => avec.filter((c) => c.pop >= s).length >= RANG_MIN) ?? 0;
  return {
    seuil,
    rows: avec
      .filter((c) => c.pop >= seuil)
      .map((c) => ({ ...c, v: (1000 * (c.cams ?? 0)) / c.pop }))
      .sort((a, b) => b.v - a.v || b.pop - a.pop)
      .slice(0, n),
  };
}

/** The drone bars' scale beside the cameras' (« 8 fois plus grandes, pour rester lisibles »): the
 * largest drone bar about half the largest camera bar, a whole factor, 1 when they read alike. */
export function facteurDrones(maxCam: number, maxDr: number): number {
  if (!(maxDr > 0) || !(maxCam > 0)) return 1;
  return Math.max(1, Math.round(maxCam / (2 * maxDr)));
}

/** A CSV of rows (a BOM, quoted cells, a formula's first character neutralised). */
export function csv(head: string[], rows: (string | number)[][]): string {
  const q = (v: string | number) => {
    const s =
      typeof v === "number"
        ? String(Math.round(v * 100) / 100)
        : /^[=+\-@\t\r]/.test(v)
          ? `'${v}`
          : v;
    return `"${s.replace(/"/g, '""')}"`;
  };
  return `﻿${[head, ...rows].map((r) => r.map(q).join(",")).join("\r\n")}\r\n`;
}
