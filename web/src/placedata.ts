// What the map's sheets read of the register (board 12 · Fiches de la carte v3): one file per
// département, `/data/registre/departement/<d>.json` (44 to 86 kB, asked once and kept), feeds the
// commune's line, its rank in its intercommunality, the département's « Où sont-elles ? », the
// doors and the « manque » block (gap.ts). A commune's own file is not read: Paris's or
// Marseille's weigh 2.6 to 2.9 MB. Municipal arrondissements, the map's units in Paris, Lyon and
// Marseille, are their commune's in the register (parentCommune). Pure but for loadDep.
import { isArrondissement, parentCommune } from "./arrondissements.ts";
import { type Autorisees, CATEGORIES, type Etat } from "./gapcalc.ts";

export { isArrondissement, parentCommune };

type Couverture = { cam?: string; dr?: string };
export type CommuneStats = {
  docs?: number;
  con?: number;
  cam?: number;
  dr?: number;
  montant?: number;
  carte?: number;
  couverture_actes?: Couverture;
  /** Served by session A when ready (message-session-A-rattachement, 10/11); read by autOf. */
  cam_aut?: unknown;
};
export type DepFile = {
  departement: { code: string; nom: string; pop?: number; n_communes?: number };
  communes: Record<string, { nom: string; pop?: number; epci?: string; dep?: string }>;
  acheteurs?: Record<string, { nom?: string; nom_court?: string; categorie?: string }>;
  stats: {
    depStats?: CommuneStats & { dr_commune?: number; dr_autorite?: number };
    communes: Record<string, CommuneStats>;
  };
  couverture?: { etat?: string; depuis?: string };
};

// --- loading -------------------------------------------------------------------------------------
const files = new Map<string, Promise<DepFile | null>>();
const ready = new Map<string, DepFile | null>();
/** The département's file, or null when the register has none (or it cannot be read). */
export function loadDep(code: string): Promise<DepFile | null> {
  let p = files.get(code);
  if (!p) {
    p = fetch(
      `${window.location.origin}/data/registre/departement/${encodeURIComponent(code)}.json`,
    )
      .then((r) => (r.ok ? (r.json() as Promise<DepFile>) : null))
      .catch(() => null)
      .then((f) => {
        ready.set(code, f);
        return f;
      });
    files.set(code, p);
  }
  return p;
}
/** The file when already in (undefined: not asked yet or still on its way). */
export const depNow = (code: string): DepFile | null | undefined => ready.get(code);

// --- places --------------------------------------------------------------------------------------
/** « À Lyon », « Au Havre », « Aux Lilas », « À La Rochelle ». */
export function aCommune(nom: string): string {
  if (/^Le /.test(nom)) return `Au ${nom.slice(3)}`;
  if (/^Les /.test(nom)) return `Aux ${nom.slice(4)}`;
  return `À ${nom}`;
}

const etatOf = (v: string | undefined): Etat =>
  v === "lu" || v === "partiel" || v === "non_rattache" ? v : "non_lu";

/** How far the commune's camera acts are read; non_lu when the register does not list it. */
export function etatCam(dep: DepFile | null, insee: string): Etat {
  return etatOf(dep?.stats.communes[insee]?.couverture_actes?.cam);
}

/** The commune's camera acts in the register, when they can be counted: read (`lu`), or some
 * of them tied to it (`partiel` with at least one); undefined otherwise (« non lu », never 0). */
export function actesCam(dep: DepFile | null, insee: string): number | undefined {
  const s = dep?.stats.communes[insee];
  const etat = etatCam(dep, insee);
  const n = s?.cam ?? 0;
  if (etat === "lu" || (etat === "partiel" && n > 0)) return n;
  return undefined;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** The authorised cameras, from `cam_aut` once served: an object of the categories (`mairie`,
 * `commerces`, `autres`), `voie_publique` and `periode` ([first, last] or {de, a}); a missing
 * category is null, « non lu ». Null while nothing is served. */
export function autOf(raw: unknown): Autorisees | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const rows = CATEGORIES.map((cle) => ({ cle, n: num(o[cle]) }));
  if (rows.every((r) => r.n === null)) return null;
  const p = o.periode;
  const periode: [string, string] | null = Array.isArray(p)
    ? typeof p[0] === "string" && typeof p[1] === "string"
      ? [p[0], p[1]]
      : null
    : p && typeof p === "object" && typeof (p as { de?: unknown }).de === "string"
      ? [
          String((p as { de: string }).de),
          String((p as { a?: string }).a ?? (p as { de: string }).de),
        ]
      : null;
  return { rows, voiePublique: num(o.voie_publique), periode };
}

/** « 4,0 »: a ratio to the tenth, its decimal always written (the board's « 4,0 »). */
export const tenth = (v: number): string =>
  new Intl.NumberFormat("fr", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(v);

/** Cameras per 1 000 inhabitants, to the tenth; null without a population. */
export const per1000 = (n: number, pop: number | undefined): number | null =>
  pop && pop > 0 ? Math.round((10000 * n) / pop) / 10 : null;

/** The commune's rank by cameras per 1 000 inhabitants among the communes of its
 * intercommunality that the département's file lists (its own count, `n`, the map's; the others'
 * the register's `carte`). Null without an intercommunality or a population. */
export function rankInEpci(
  dep: DepFile,
  insee: string,
  n: number,
): { r: number; sur: number } | null {
  const me = dep.communes[insee];
  if (!me?.epci || !me.pop) return null;
  const mine = n / me.pop;
  let r = 1;
  let sur = 0;
  for (const [k, c] of Object.entries(dep.communes)) {
    if (c.epci !== me.epci || !c.pop) continue;
    sur++;
    if (k === insee) continue;
    if ((dep.stats.communes[k]?.carte ?? 0) / c.pop > mine) r++;
  }
  return sur > 1 ? { r, sur } : null;
}

/** The intercommunality is a métropole (« 5e sur 51 de la Métropole », the board's words). */
export const isMetropole = (dep: DepFile, insee: string): boolean => {
  const epci = dep.communes[insee]?.epci;
  return Boolean(epci && dep.acheteurs?.[epci]?.categorie === "metropole");
};

/** The intercommunality's short name, for the line. */
export function epciNom(dep: DepFile, insee: string): string | null {
  const epci = dep.communes[insee]?.epci;
  if (!epci) return null;
  const a = dep.acheteurs?.[epci];
  return a?.nom_court ?? a?.nom ?? null;
}

export type Top = { insee: string; nom: string; carte: number; per1000: number | null };
/** The communes with the most cameras on the map, and the département's total. */
export function tops(dep: DepFile, k = 6): { rows: Top[]; total: number; communes: number } {
  const all = Object.entries(dep.stats.communes).map(([insee, s]) => ({
    insee,
    nom: dep.communes[insee]?.nom ?? insee,
    carte: s.carte ?? 0,
    per1000: per1000(s.carte ?? 0, dep.communes[insee]?.pop),
  }));
  const total = all.reduce((s, x) => s + x.carte, 0);
  const rows = all
    .filter((x) => x.carte > 0)
    .sort((a, b) => b.carte - a.carte || a.nom.localeCompare(b.nom, "fr"))
    .slice(0, k);
  return {
    rows,
    total,
    communes: all.filter((x) => (dep.stats.communes[x.insee].docs ?? 0) > 0).length,
  };
}

/** « depuis 2025 »: the year the département's collection starts, when it is collected. */
export const depuis = (dep: DepFile): string | null =>
  dep.couverture?.etat === "collecte" && dep.couverture.depuis
    ? dep.couverture.depuis.slice(0, 4)
    : null;

/** « 1,4 M€ », « 54 810 € », the register's way (amounts as contracted). */
export function euros(v: number): string {
  const f = (x: number, d: number) =>
    new Intl.NumberFormat("fr", { maximumFractionDigits: d })
      .format(x)
      .replace(/\u202f/g, "\u00a0");
  if (v >= 1e6) return `${f(v / 1e6, 1)}\u00a0M€`;
  if (v >= 1e4) return `${f(Math.round(v / 1000), 0)}\u00a0k€`;
  return `${f(v, 0)}\u00a0€`;
}
