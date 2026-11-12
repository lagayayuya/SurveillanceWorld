// A commune's fiche in theme A (board Lyon-A-theme-actuel, redesign v3 lot 2): what it computes from
// the commune's file, pure, for the tests. Every figure is the build's (one source per figure, Ju
// 07/11): the cameras the decrees authorise by kind of beneficiary, the largest systems, the money
// by year and by buyer, the suppliers, the days of flight, a rank among the communes of its size.

import type { Evenement } from "../donnees.ts";

/** The decrees a commune's latest dossiers give (commun.ts `lastArretes`), camera ones only. */
type Arrete = Pick<
  Evenement,
  | "t"
  | "cameras"
  | "communal"
  | "type_beneficiaire"
  | "beneficiaire"
  | "beneficiaire_siren"
  | "nom_publie"
  | "copie"
>;

/** « Combien de caméras ? »: the cameras the camera decrees authorise, the mairie's (its own
 * dossiers), the shops' and banks', the others' (transports, State, health…). */
export type Parts = { mairie: number; commerces: number; autres: number; total: number };
export function camerasAutorisees(arr: Arrete[]): Parts {
  const p: Parts = { mairie: 0, commerces: 0, autres: 0, total: 0 };
  for (const e of arr) {
    if (e.t !== "arrete" || e.copie || typeof e.cameras !== "number") continue;
    const k = e.communal
      ? "mairie"
      : /^(commerce|banque)$/.test(String(e.type_beneficiaire ?? ""))
        ? "commerces"
        : "autres";
    p[k] += e.cameras;
    p.total += e.cameras;
  }
  return p;
}

/** « Les plus grands systèmes autorisés, hors mairie »: the beneficiaries published by their name
 * (never a private person nor a name not checked: `nom_publie`, « [non retenu] »), by the cameras
 * their decrees authorise, the most first. */
export type Systeme = { nom: string; siren: string | null; arretes: number; cameras: number };
export function grandsSystemes(arr: Arrete[], n = 4): Systeme[] {
  const by = new Map<string, Systeme>();
  for (const e of arr) {
    if (e.t !== "arrete" || e.copie || e.communal || typeof e.cameras !== "number") continue;
    const nom = String(e.beneficiaire ?? "").trim();
    if (!nom || nom.startsWith("[") || e.nom_publie === false) continue;
    const k = e.beneficiaire_siren || nom.toLowerCase();
    const s = by.get(k) ?? { nom, siren: e.beneficiaire_siren ?? null, arretes: 0, cameras: 0 };
    s.arretes++;
    s.cameras += e.cameras;
    by.set(k, s);
  }
  return [...by.values()]
    .sort((a, b) => b.cameras - a.cameras || a.nom.localeCompare(b.nom, "fr"))
    .slice(0, n);
}

/** A contract's buyer as the money's series say it: the commune itself, the transports, the
 * others (its intercommunality, the State, the département…). */
export type Serie = "ville" | "transports" | "autres";
export type Annee = { an: string; ville: number; transports: number; autres: number };
export function argentParAnnee(
  contrats: { date?: string | null; montant?: number | null }[],
  serie: (e: never) => Serie,
  depuis = 2018,
): { annees: Annee[]; totaux: Record<Serie, number> } {
  const by = new Map<string, Annee>();
  const totaux: Record<Serie, number> = { ville: 0, transports: 0, autres: 0 };
  let fin = depuis;
  for (const e of contrats) {
    const an = Number((e.date ?? "").slice(0, 4));
    if (!an || an < depuis || !e.montant) continue;
    fin = Math.max(fin, an);
    const k = serie(e as never);
    const a = by.get(String(an)) ?? { an: String(an), ville: 0, transports: 0, autres: 0 };
    a[k] += e.montant;
    totaux[k] += e.montant;
    by.set(String(an), a);
  }
  const annees: Annee[] = [];
  for (let y = depuis; y <= fin; y++)
    annees.push(by.get(String(y)) ?? { an: String(y), ville: 0, transports: 0, autres: 0 });
  return { annees, totaux };
}

/** « Qui équipe la ville ? »: the companies of the commune's own contracts, by amount. */
export type Fournisseur = { siren: string; montant: number; contrats: number; annees: string[] };
export function fournisseurs(
  contrats: { entreprises?: string[]; montant?: number | null; date?: string | null }[],
): Fournisseur[] {
  const by = new Map<string, Fournisseur>();
  for (const e of contrats)
    for (const s of e.entreprises ?? []) {
      const f = by.get(s) ?? { siren: s, montant: 0, contrats: 0, annees: [] };
      f.montant += e.montant ?? 0;
      f.contrats++;
      const an = (e.date ?? "").slice(0, 4);
      if (an && !f.annees.includes(an)) f.annees.push(an);
      by.set(s, f);
    }
  return [...by.values()]
    .map((f) => ({ ...f, annees: f.annees.sort() }))
    .sort((a, b) => b.montant - a.montant || b.contrats - a.contrats);
}

/** The days a drone decree authorises flights (its `jours`), in a window ending on `fin`
 * (YYYY-MM-DD) and starting `mois` months before, each day once; and the decrees of a day. */
export function joursDeVol(
  actes: { t: string; jours?: string[] | null }[],
  fin: string,
  mois = 12,
): Map<string, number> {
  const d = new Date(`${fin}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - mois);
  const debut = d.toISOString().slice(0, 10);
  const out = new Map<string, number>();
  for (const e of actes) {
    if (e.t !== "arrete_drone") continue;
    for (const j of new Set(e.jours ?? []))
      if (j > debut && j <= fin) out.set(j, (out.get(j) ?? 0) + 1);
  }
  return out;
}

/** A commune's size class for its ranks (« les 11 villes de 200 000 habitants ou plus »). */
export const STRATES = [200000, 100000, 20000, 5000, 0] as const;
export function strate(pop: number): number {
  return STRATES.find((s) => pop >= s) ?? 0;
}

/** Under this many communes ranked, a rank says nothing (« 3e sur 3 », Ju 08/11): none is shown. */
export const RANG_MIN = 5;
/** A value's rank among others (1 the largest), and how many: none when the value is unknown or
 * fewer than RANG_MIN are ranked. */
export function rang(v: number | null, autres: number[]): { r: number; n: number } | null {
  if (v == null || v < 0) return null;
  const vs = autres.filter((x) => x >= 0);
  if (vs.length < RANG_MIN) return null;
  return { r: vs.filter((x) => x > v).length + 1, n: vs.length };
}

/** A drone act's served motive (`motif.categorie`, A 20cf0e6) in the board's classes: sport,
 * concerts and commemorations are « événement »; « stupéfiants » keeps its own row (served, not
 * in the board); « frontière » and « circulation » are purposes of L. 242-5 not read yet, so no
 * served category gives them. None when the act has no motive read. */
export type ClasseMotif = "manifestation" | "evenement" | "stupefiants" | "autre";
export function classeMotif(motif: unknown): ClasseMotif | null {
  const c =
    motif && typeof motif === "object"
      ? (motif as { categorie?: unknown }).categorie
      : typeof motif === "string"
        ? motif
        : null;
  if (typeof c !== "string" || !c) return null;
  if (c === "manifestation") return "manifestation";
  if (/^(sport|concert_fete|commemoration|evenement)$/.test(c)) return "evenement";
  if (c === "stupefiants") return "stupefiants";
  return "autre";
}

// --- a name in a sentence (recette 21): « des Baux-de-Provence », « au Mans », « la CC … » ------

const VOYELLE = /^[AEIOUYÀÂÉÈÊËÎÏÔÖÛÜaeiouyàâéèêëîïôöûü]/;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** « de » before a commune's name, its article contracted: « de Lyon », « d'Aix-en-Provence »,
 * « des Baux-de-Provence », « du Mans », « de La Ciotat », « de L'Haÿ-les-Roses » (the elision as
 * texte.ts `elider` writes it, which t() applies to every sentence; an initial H keeps « de »). */
export function deNom(nom: string): string {
  if (/^Les /.test(nom)) return `des ${nom.slice(4)}`;
  if (/^Le /.test(nom)) return `du ${nom.slice(3)}`;
  if (VOYELLE.test(nom)) return `d'${nom}`;
  return `de ${nom}`;
}
/** « à » before a commune's name: « à Lyon », « aux Baux-de-Provence », « au Mans », « à La
 * Ciotat ». */
export function aNom(nom: string): string {
  if (/^Les /.test(nom)) return `aux ${nom.slice(4)}`;
  if (/^Le /.test(nom)) return `au ${nom.slice(3)}`;
  return `à ${nom}`;
}
/** A sentence written with the plain name (« de {nom} », « à {nom} »), its prepositions contracted
 * with the name's article; a « hab.. » left by a size class ending a sentence made one point. */
export function contracte(s: string, nom: string): string {
  if (!nom) return s;
  const n = esc(nom);
  return s
    .replace(new RegExp(`(^|[\\s(« ])de ${n}(?![\\p{L}\\p{N}-])`, "gu"), (_m, p) => p + deNom(nom))
    .replace(new RegExp(`(^|[\\s(« ])à ${n}(?![\\p{L}\\p{N}-])`, "gu"), (_m, p) => p + aNom(nom))
    .replace(/(hab|etc)\.\.(?=\s|$)/g, "$1.");
}
/** An intercommunality's name with its article, after « dans » or « de »: « la CC Vallée des
 * Baux-Alpilles », « la Métropole de Lyon », « l'EPT Paris Terres d'Envol »; a name without a word
 * that says its kind stays bare (« Grand Paris Seine Ouest »). */
export function articleEpci(nom: string): string {
  if (/^(CC|CA|CU|Communauté|Métropole|Eurométropole)\b/u.test(nom)) return `la ${nom}`;
  if (/^(Établissement|EPT)\b/u.test(nom)) return `l'${nom}`;
  if (/^Syndicat\b/u.test(nom)) return `le ${nom}`;
  return nom;
}

/** The days today's drone acts were published (Ju 10/11: « arrêtés publiés le 6 et le 8 nov. »):
 * each day once, in order, grouped by month so that a month is written once after its last day;
 * a year is kept only when it is not the build's (`an`). */
export type JoursMois = { jours: number[]; mois: string; an: string | null };
export function joursPublies(isos: (string | null | undefined)[], an: string): JoursMois[] {
  const out: JoursMois[] = [];
  for (const d of [
    ...new Set(isos.filter((x): x is string => !!x).map((x) => x.slice(0, 10))),
  ].sort()) {
    const mois = d.slice(0, 7);
    const last = out[out.length - 1];
    if (last && last.mois === mois) last.jours.push(Number(d.slice(8, 10)));
    else
      out.push({
        jours: [Number(d.slice(8, 10))],
        mois,
        an: d.slice(0, 4) === an ? null : d.slice(0, 4),
      });
  }
  return out;
}
