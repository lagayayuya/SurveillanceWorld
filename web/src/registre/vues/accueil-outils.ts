// The home's rules that read data (board Accueil-Registre-A), pure, for the tests: « Cette semaine »'s
// latest documents (their tab, never a date after the build's), a buyer named so that one knows
// where it is (« CCAS de Nice »), a published object in ordinary case.

import type { Lexique } from "../corpus.ts";
import type { Evenement } from "../donnees.ts";
import { tidy } from "../texte.ts";

/** « Cette semaine »'s tabs. */
export const ONGLETS = ["tous", "contrats", "arretes", "drones"] as const;
export type Onglet = (typeof ONGLETS)[number];

/** A tab's documents asked of the search API, the latest first (its `date`): one question or two.
 * A drone decree's `date` is its first day of flight; its publication is `publie` (A, b272a68),
 * which the API does not sort on. Its drones are asked apart, more of them, and sorted here on
 * `publie` (jourDoc), so that « Tous » holds the contracts, the notices and the decrees published
 * last, whatever day they fly. */
export const QUESTION: Record<Onglet, Record<string, string>[]> = {
  tous: [{ p: "vp,csu,pi,vsa,vv,lapi,na" }, { t: "aut", p: "dr", n: "60" }],
  contrats: [{ t: "con,mod,ao" }],
  arretes: [{ t: "aut", p: "vp,csu,pi,vsa,vv,lapi" }],
  drones: [{ t: "aut", p: "dr", n: "60" }],
};

/** A document in a tab (the build's `recents`, when the API does not answer). */
export function dansOnglet(o: Onglet, t: string): boolean {
  if (o === "drones") return t === "arrete_drone";
  if (o === "arretes") return t.startsWith("arrete") && t !== "arrete_drone";
  if (o === "contrats") return /^(attribution|modification|avis|resultat|rectificatif)$/.test(t);
  return true;
}

/** The day a document is dated and sorted by on the home: its publication. A drone decree's is
 * `publie`, never its `date` (a flight's day); without `publie` (a build before b272a68) its tab
 * still dates it by `date` when that day is past, and « Tous » leaves it out. */
export function jourDoc(e: Evenement, o: Onglet): string | null {
  if (e.t !== "arrete_drone") return e.date ? e.date.slice(0, 10) : null;
  const pub = (e as { publie?: string | null }).publie;
  if (pub) return pub.slice(0, 10);
  return o === "drones" && e.date ? e.date.slice(0, 10) : null;
}

/** The latest documents of a tab: none dated after the build (`maj`, YYYY-MM-DD), the latest
 * published first, `n` at most. */
export function recentes(evts: Evenement[], maj: string, o: Onglet, n = 6): Evenement[] {
  const vus = new Set<string>();
  return evts
    .map((e) => ({ e, j: dansOnglet(o, e.t) ? jourDoc(e, o) : null }))
    .filter((x): x is { e: Evenement; j: string } => !!x.j && x.j <= maj)
    .filter((x) => !vus.has(x.e.id) && !!vus.add(x.e.id))
    .sort((a, b) => b.j.localeCompare(a.j))
    .slice(0, n)
    .map((x) => x.e);
}

/** A buyer's name whose words do not say where it is (« Centre Communal d'Action Sociale »,
 * « Commune », « Métropole », « Syndicat »). */
const GENERIQUE =
  /^(centre (inter)?communal d'action sociale|c\.?c\.?a\.?s\.?|c\.?i\.?a\.?s\.?|commune|mairie|ville|m[ée]tropole|syndicat( mixte)?|sivu|sivom|office public de l'habitat|oph)$/i;
const CCAS = /^(centre communal d'action sociale|c\.?c\.?a\.?s\.?)$/i;
const CIAS = /^(centre intercommunal d'action sociale|c\.?i\.?a\.?s\.?)$/i;

/** A buyer's name, its place added when its name alone says none: « CCAS de Nice », « Commune de
 * Mions », « Syndicat mixte (Isère) ». The place is its seat's commune, else its département. */
export function nomAcheteur(
  a:
    | {
        nom?: string | null;
        nom_court?: string | null;
        insee_siege?: string | null;
        dep?: string | null;
      }
    | undefined,
  L: Pick<Lexique, "communes">,
  nomDep: (code: string) => string,
  repli = "",
): string {
  const nom = tidy(a?.nom_court || a?.nom || repli).replace(/[’]/g, "'");
  if (!GENERIQUE.test(nom.trim())) return nom;
  const com = a?.insee_siege ? L.communes[a.insee_siege]?.nom : undefined;
  const lieu = com ?? (a?.dep ? nomDep(a.dep) : "");
  if (!lieu) return nom;
  if (CCAS.test(nom)) return `CCAS de ${lieu}`;
  if (CIAS.test(nom)) return `CIAS de ${lieu}`;
  if (/^(commune|mairie|ville)$/i.test(nom))
    return `${nom[0].toUpperCase()}${nom.slice(1).toLowerCase()} de ${lieu}`;
  return `${nom} (${lieu})`;
}

/** A published object in ordinary case: one mostly in capitals (« LOT 1 - ACHAT, INSTALLATION… »)
 * lowered, its first letter up; its spaces tidied. */
export function casseNormale(s: string | null | undefined): string {
  const t = tidy(s ?? "");
  const lettres = t.replace(/[^A-Za-zÀ-ÖØ-öø-ÿŒœ]/g, "");
  const hautes = lettres.replace(/[^A-ZÀ-ÖØ-ÞŒ]/g, "").length;
  const u = lettres.length && hautes / lettres.length > 0.5 ? t.toLowerCase() : t;
  return u ? u[0].toUpperCase() + u.slice(1) : u;
}

/** index.json `drones.publication` (A, 3b330c5): the drone acts whose recueil's day is before, on
 * or after their first published day of flight; `non_lus` the acts without both days; `deps` (when
 * served) the départements counted. */
export type Publication = {
  avant: number;
  jour_meme: number;
  apres: number;
  total: number;
  non_lus?: number;
  deps?: string[];
};
export type AvantVol = {
  /** nothing counted: « non lu », never « 0 % » */
  nonLu: boolean;
  total: number;
  parts: { k: "avant" | "jour_meme" | "apres"; n: number; pct: number }[];
  deps: string[];
  /** more acts without days of flight than with: the card says the others do not publish them */
  ailleurs: boolean;
};
/** « Publiés avant le vol ? »: the three shares in whole percents summing to 100 (the largest
 * remainders rounded up), on the acts counted; « non lu » when none is. */
export function avantVol(p: Publication | null | undefined): AvantVol {
  const total = p?.total ?? 0;
  if (!p || total <= 0) return { nonLu: true, total: 0, parts: [], deps: [], ailleurs: false };
  const ks = ["avant", "jour_meme", "apres"] as const;
  const brut = ks.map((k) => (100 * (p[k] ?? 0)) / total);
  const pct = brut.map(Math.floor);
  let reste = 100 - pct.reduce((a, b) => a + b, 0);
  const ordre = brut.map((b, i) => [b - Math.floor(b), i] as const).sort((a, b) => b[0] - a[0]);
  for (const [, i] of ordre) {
    if (reste <= 0) break;
    pct[i]++;
    reste--;
  }
  return {
    nonLu: false,
    total,
    parts: ks.map((k, i) => ({ k, n: p[k] ?? 0, pct: pct[i] })),
    deps: p.deps ?? [],
    ailleurs: (p.non_lus ?? 0) > total,
  };
}
