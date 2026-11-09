// A document's record in theme A (board Contrat-Lyon-2026-A of the redesign v3, lot 3): what the
// page computes from the build's document/<affaire>.json beside the model (contrat-outils.ts):
// the steps of its parcours in their order with the real gap between two, the execution's
// progress at the build's day, the competition and the procedure the notices publish, the
// duration the call for tenders announced, a mixed contract's family, a rise « à vérifier »,
// what the modifications change, the rows of « Les documents », the previous contract as the
// buyer's file groups it. Pure: no words (the view takes them from the catalogue), dates as
// ISO days, amounts in euros.

import type { Evenement } from "../donnees.ts";
import type { Fichier, Parcours } from "./contrat-outils.ts";

const JOUR = 864e5;
const AO = /^(avis|resultat|rectificatif)$/;

/** The day a timeline reads: the reviewed one when the build has one (regles.py date_lue). */
export const jourLu = (e: Pick<Evenement, "date" | "date_lue">): string =>
  String(e.date_lue ?? e.date ?? "").slice(0, 10);

/** Whole days from `a` to `b` (ISO days, UTC). */
export function jours(a: string, b: string): number {
  return Math.round(
    (Date.parse(`${b.slice(0, 10)}T00:00:00Z`) - Date.parse(`${a.slice(0, 10)}T00:00:00Z`)) / JOUR,
  );
}

/** A gap as the board writes it between two steps: days under a year (« 147 jours »), then whole
 * years (« 4 ans ») or months (« 18 mois »). */
export type Ecart = { n: number; u: "jours" | "mois" | "ans" };
export function ecart(d: number): Ecart {
  const n = Math.max(0, d);
  if (n < 365) return { n, u: "jours" };
  const m = Math.round(n / 30.4375);
  return m % 12 === 0 ? { n: m / 12, u: "ans" } : { n: m, u: "mois" };
}

/** `iso` plus `m` months, the day kept (a month without it: its last day). */
export function ajouteMois(iso: string, m: number): string {
  const [y, mo, d] = iso.slice(0, 10).split("-").map(Number);
  const t = new Date(Date.UTC(y, mo - 1 + m, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(d, last));
  return t.toISOString().slice(0, 10);
}

/** The execution at the build's day (never the reader's clock: Ju's « dates never after the
 * build »): whole months gone of the `mois` from `debut`, the share of its days, its state. */
export type Avancement = {
  debut: string;
  fin: string;
  ecoules: number;
  total: number;
  pct: number;
  etat: "avant" | "cours" | "fini";
};
export function avancement(debut: string, mois: number, maj: string): Avancement | null {
  if (!debut || !(mois > 0) || !maj) return null;
  const fin = ajouteMois(debut, mois);
  const total = jours(debut, fin);
  const passe = jours(debut, maj);
  const etat = passe < 0 ? "avant" : passe >= total ? "fini" : "cours";
  let ecoules = 0;
  while (ecoules < mois && ajouteMois(debut, ecoules + 1) <= maj.slice(0, 10)) ecoules++;
  const pct = Math.round((Math.min(Math.max(passe, 0), total) / total) * 1000) / 10;
  return { debut: debut.slice(0, 10), fin, ecoules, total: mois, pct, etat };
}

/** A step of the parcours, in the board's kinds: the call for tenders (`avis`), a corrigendum
 * (`rect`), the contract (`contrat`), its modifications (`modif`, several grouped: `n`, the last
 * day `jusqu`), the award notice (`attr`), a grant (`sub`), a decree (`aut`), the planned end
 * (`fin`, computed). `probable`: a document of another dossier the build links by a rule. */
export type EtapeK = "avis" | "rect" | "contrat" | "modif" | "attr" | "sub" | "aut" | "fin";
export type Etape = {
  k: EtapeK;
  id: string;
  date: string;
  ref: string;
  url: string;
  /** a modification's number, or how many are grouped */
  n: number;
  jusqu: string;
  probable: boolean;
  /** the affaire of a probable document (its own record) */
  affaire: string;
  /** the gap from the step before (null for the first) */
  ecart: Ecart | null;
  e: Evenement | null;
};

const kindOf = (e: Evenement): EtapeK | null =>
  e.t === "avis"
    ? "avis"
    : e.t === "rectificatif"
      ? "rect"
      : e.t === "resultat"
        ? "attr"
        : e.t === "attribution"
          ? "contrat"
          : e.t === "modification"
            ? "modif"
            : e.t.startsWith("subvention")
              ? "sub"
              : e.t.startsWith("arrete")
                ? "aut"
                : null;

/** The events of an affaire of the file, in their order (a copy left out: the same document
 * published by another source). */
export function evenementsDe(f: Fichier, affaire: string): Evenement[] {
  const byId = new Map(f.evenements.map((e) => [e.id, e]));
  return (f.affaires[affaire]?.events ?? [])
    .map((x) => byId.get(x))
    .filter((e): e is Evenement => !!e && !e.copie)
    .sort((a, b) => jourLu(a).localeCompare(jourLu(b)));
}

/** The parcours: every document of the dossier in its order, a probable call for tenders or
 * contract of another dossier in its place, more than two modifications grouped into one step,
 * then the planned end (signature + published duration, the build's `fin_prevue`); each step its
 * real gap from the one before (the board draws them at equal intervals and writes the gap). */
export function etapes(f: Fichier, grouper = true): Etape[] {
  const a = f.affaire;
  const evs = evenementsDe(f, a.id);
  const autres: { e: Evenement; affaire: string }[] = [];
  const probables = [
    ...((a.avis_probables as string[] | undefined) ?? []),
    ...(typeof a.contrat_probable === "string" ? [a.contrat_probable] : []),
  ];
  for (const p of probables) {
    const pe = evenementsDe(f, p);
    // a probable call for tenders: its first notice; a probable contract: its contract
    const e = a.contrat_probable === p ? pe.find((x) => x.t === "attribution") : pe[0];
    if (e) autres.push({ e, affaire: p });
  }
  // the first contract only: a later attribution of the dossier is the same contract re-sent
  let vu = false;
  const propres = evs.filter((e) => {
    if (e.t !== "attribution") return true;
    if (vu) return false;
    vu = true;
    return true;
  });
  const tous = [
    ...propres.map((e) => ({ e, affaire: "" })),
    ...autres.filter((x) => !evs.some((e) => e.t === x.e.t)),
  ].sort((p, q) => jourLu(p.e).localeCompare(jourLu(q.e)));
  const mods = tous.filter((x) => x.e.t === "modification");
  const groupe = grouper && mods.length > 2;
  const out: Etape[] = [];
  for (const x of tous) {
    const k = kindOf(x.e);
    if (!k) continue;
    if (k === "modif" && groupe) {
      if (x !== mods[0]) continue;
      const last = mods[mods.length - 1].e;
      out.push({
        ...step(k, x.e, x.affaire),
        n: mods.length,
        jusqu: jourLu(last),
        id: last.id,
        url: last.url ?? "",
        ref: String(last.ref ?? ""),
        e: last,
      });
      continue;
    }
    out.push({ ...step(k, x.e, x.affaire), n: k === "modif" ? Number(x.e.modif_n) || 1 : 0 });
  }
  const fin = f.parcours.fin_prevue;
  if (grouper && fin && out.some((s) => s.k === "contrat"))
    out.push({
      k: "fin",
      id: "",
      date: fin.date,
      ref: "",
      url: "",
      n: fin.mois,
      jusqu: "",
      probable: false,
      affaire: "",
      ecart: null,
      e: null,
    });
  for (let i = 1; i < out.length; i++) {
    const prev = out[i - 1];
    // a step before the one drawn ahead of it (the planned end before the last modification):
    // no gap written
    const d = jours(prev.jusqu || prev.date, out[i].date);
    out[i].ecart = d < 0 ? null : ecart(d);
  }
  return out;
}
/** « Les documents »: every document of the dossier in its order, each modification its own row,
 * a probable one of another dossier in its place; no planned end. */
export const documents = (f: Fichier): Etape[] => etapes(f, false);

function step(k: EtapeK, e: Evenement, affaire: string): Etape {
  return {
    k,
    id: e.id,
    date: jourLu(e),
    ref: String(e.ref ?? ""),
    url: e.url ?? "",
    n: 0,
    jusqu: "",
    probable: !!affaire,
    affaire,
    ecart: null,
    e,
  };
}

/** The offers received: the contract's own (DECP), else the award notice's (eForms `offres`, one
 * lot), else its lots' (`resultats_lots`: the fewest and the most by lot). */
export type Offres = {
  n: number;
  min: number;
  max: number;
  lots: number;
  source: "decp" | "avis";
  ref: string;
};
export function offres(evs: Evenement[], att?: Evenement | null): Offres | null {
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
  const o = att ? n(att.offres) : null;
  if (o != null)
    return { n: o, min: o, max: o, lots: 0, source: "decp", ref: String(att?.ref ?? "") };
  for (const e of evs.filter((x) => x.t === "resultat")) {
    const r = n(e.offres);
    if (r != null)
      return { n: r, min: r, max: r, lots: 0, source: "avis", ref: String(e.ref ?? "") };
    const lots = ((e.resultats_lots as { offres?: unknown }[] | undefined) ?? [])
      .map((l) => n(l.offres))
      .filter((x): x is number => x != null);
    if (lots.length)
      return {
        n: Math.max(...lots),
        min: Math.min(...lots),
        max: Math.max(...lots),
        lots: lots.length,
        source: "avis",
        ref: String(e.ref ?? ""),
      };
  }
  return null;
}

/** The procedure the notices name (eForms code: `open`, `restricted`, `neg-w-call`…), and the
 * notice that says it. */
export function procedure(evs: Evenement[]): { code: string; ref: string } | null {
  const e = evs.find((x) => AO.test(x.t) && typeof x.procedure === "string" && x.procedure);
  return e ? { code: String(e.procedure), ref: String(e.ref ?? "") } : null;
}

/** The duration the call for tenders announced, in months (eForms `duree_mois`). */
export function dureeAnnoncee(evs: Evenement[]): { mois: number; ref: string } | null {
  const e = evs.find(
    (x) => AO.test(x.t) && typeof x.duree_mois === "number" && (x.duree_mois as number) > 0,
  );
  return e ? { mois: Math.round(e.duree_mois as number), ref: String(e.ref ?? "") } : null;
}

/** A mixed contract (the build's `mixte`, on every one, counted or not: A, 7b51ddb): its family,
 * and whether the register leaves it out of its totals (not counted, for that reason). */
export function mixte(att?: Evenement | null): { famille: string; horsTotaux: boolean } | null {
  const fam = typeof att?.mixte === "string" ? att.mixte : "";
  if (!fam || !att) return null;
  return {
    famille: fam,
    horsTotaux: att.compte === false && /^mixte/.test(String(att.hors_totaux ?? "")),
  };
}

/** A rise of more than 500 % (`a_verifier`, A, 1c0f168): the amount at the signature and the
 * highest one published after it; which of the two is wrong does not show. */
export function aVerifier(evs: Evenement[]): { de: number; a: number } | null {
  const flag = evs.filter(
    (e) => (e.t === "attribution" || e.t === "modification") && !!e.a_verifier,
  );
  if (!flag.length) return null;
  const att = evs.find((e) => e.t === "attribution" && e.montant != null);
  const ms = flag.map((e) => e.montant).filter((m): m is number => typeof m === "number");
  if (!att || !ms.length) return null;
  return { de: att.montant as number, a: Math.max(...ms) };
}

/** What the modifications change against the contract: the amount and the duration after the
 * last one, the changes they publish; `muettes`: nothing readable changes (no change published,
 * the same amount and duration). */
export type Modifs = {
  n: number;
  premiere: string;
  derniere: string;
  montant: number | null;
  duree: number | null;
  changements: string[];
  muettes: boolean;
};
export function modifs(evs: Evenement[], att?: Evenement | null): Modifs {
  const ms = evs.filter((e) => e.t === "modification");
  const mois = (v: unknown) => {
    const n = Math.round(Number(v));
    return v != null && v !== "" && Number.isFinite(n) && n > 0 ? n : null;
  };
  const last = ms[ms.length - 1];
  const changements = [
    ...new Set(ms.flatMap((m) => (m.changements as string[] | undefined) ?? [])),
  ];
  const montant = last?.montant ?? null;
  const duree = last ? mois(last.duree) : null;
  const muettes =
    !!ms.length &&
    !changements.length &&
    ms.every(
      (m) =>
        (m.montant == null || m.montant === att?.montant) &&
        (mois(m.duree) == null || mois(m.duree) === mois(att?.duree)),
    );
  return {
    n: ms.length,
    premiere: last ? jourLu(ms[0]) : "",
    derniere: last ? jourLu(last) : "",
    montant,
    duree,
    changements,
    muettes,
  };
}

/** A DECP reference as the board writes it: the market's own id, without the buyer's SIRET the
 * build puts before it and the CPV code after it (« DECP 216901231000112026Q7321A_50324100,
 * modification 1 » → « DECP 2026Q7321A, modification 1 »); any other reference unchanged. */
export function refCourte(ref: string): string {
  const m = /^DECP (\d{14})(\S+?)(_\d{8})?(,.*)?$/.exec(ref);
  return m ? `DECP ${m[2]}${m[4] ?? ""}` : ref;
}

/** The site a source's address is on (« boamp.fr », « data.gouv.fr »). */
export function hote(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** The buyer's file (acheteur/<siren>.json), the part this page reads. */
export type FichierAcheteur = {
  acheteur: { n_contrats?: number; montant?: number };
  evenements: Evenement[];
  affaires: Record<
    string,
    { titre?: string | null; debut?: string; fin?: string; events?: string[] }
  >;
  stats?: { n?: number; montant?: number; contrats?: string[] };
  lots?: Record<
    string,
    {
      date?: string;
      somme?: number;
      entreprises?: string[];
      membres?: { affaire: string; objet?: string }[];
    }
  >;
};

/** The buyer's contracts as its fiche counts them, and the year of its first. */
export function acheteurStats(
  A: FichierAcheteur | null,
): { n: number; montant: number; depuis: string } | null {
  if (!A) return null;
  const ids = new Set(A.stats?.contrats ?? []);
  const ans = A.evenements
    .filter((e) => ids.has(e.id) && e.date)
    .map((e) => String(e.date).slice(0, 4))
    .sort();
  const n = A.stats?.n ?? A.acheteur.n_contrats ?? ids.size;
  return { n, montant: A.stats?.montant ?? A.acheteur.montant ?? 0, depuis: ans[0] ?? "" };
}

/** The previous contract (the build's `parcours.precedent`) and the lots of its call for tenders
 * (the build's `precedent.lots`, A 1a0da86: every lot, it included, when there were several):
 * their number, the sum of the amounts they publish, their holders. The buyer's file adds what
 * the build does not put there: the lots' common objet and the modifications published on them
 * (without `precedent.lots`, its lots signed the same day as the previous contract). */
export type Avant = {
  affaire: string;
  annee: string;
  titre: string;
  lots: number;
  montant: number | null;
  entreprises: string[];
  modifs: number;
};
export function avant(P: Parcours, A: FichierAcheteur | null): Avant | null {
  const p = P.precedent;
  if (!p) return null;
  const L = p.lots ?? [];
  const publies = L.map((l) => l.montant).filter((m): m is number => typeof m === "number");
  const base: Avant = {
    affaire: p.affaire,
    annee: p.date.slice(0, 4),
    titre: "",
    lots: Math.max(1, L.length),
    montant: L.length ? (publies.length ? publies.reduce((a, b) => a + b, 0) : null) : p.montant,
    entreprises: L.length ? [...new Set(L.flatMap((l) => l.entreprises))] : p.entreprises,
    modifs: 0,
  };
  if (!A) return base;
  const g = L.length
    ? null
    : Object.values(A.lots ?? {}).find((x) =>
        (x.membres ?? []).some((m) => m.affaire === p.affaire),
      );
  const affaires = L.length
    ? L.map((l) => l.affaire)
    : g
      ? (g.membres ?? []).map((m) => m.affaire)
      : [p.affaire];
  const objet = (x: string) =>
    (g?.membres ?? []).find((m) => m.affaire === x)?.objet ?? A.affaires[x]?.titre ?? "";
  const evIds = new Set(affaires.flatMap((x) => A.affaires[x]?.events ?? []));
  return {
    ...base,
    titre: communDebut(affaires.map(objet)),
    lots: L.length ? base.lots : affaires.length,
    montant: L.length ? base.montant : (g?.somme ?? p.montant),
    modifs: A.evenements.filter((e) => e.t === "modification" && evIds.has(e.id) && !e.copie)
      .length,
  };
}

/** The words several objets begin with (« Fourniture et maintenance des systèmes de
 * vidéoprotection-Lot 1-… », « …-Lot 2-… » → « Fourniture et maintenance des systèmes de
 * vidéoprotection »), cut at a word and its separators; a single objet whole. */
export function communDebut(objets: string[]): string {
  const xs = objets.map((s) => s.trim()).filter(Boolean);
  if (xs.length <= 1) return xs[0] ?? "";
  let i = 0;
  while (xs.every((s) => s[i] !== undefined && s[i] === xs[0][i])) i++;
  const debut = xs[0].slice(0, i);
  // back to the end of a whole word, then the separators (« -Lot », « , », « – ») off
  const mot =
    /[\p{L}\p{N}]$/u.test(debut) && /[\p{L}\p{N}]/u.test(xs[0][i] ?? "")
      ? debut.replace(/[\p{L}\p{N}]+$/u, "")
      : debut;
  return mot.replace(/[\s\-–—,;:(]+(lot\s*\d*)?[\s\-–—,;:(]*$/iu, "").trim();
}

/** The natures the build reads for a contract or a notice (rules on its objet and its codes, A,
 * 9715077), in this order: the first ones say the most about what is bought. */
export const NATURES = [
  "fourniture_installation",
  "travaux_genie_civil",
  "maintenance",
  "centre_supervision",
  "lecture_plaques",
  "video_algorithmique",
  "drones",
  "reseau_fibre",
  "conseil_amo",
  "autre",
] as const;
export type Nature = (typeof NATURES)[number];

/** A document's natures: the main document's own (one source), else every nature the dossier's
 * documents carry; known keys only, in NATURES' order, « autre » only when it is alone. */
export function naturesDe(main: Evenement | null | undefined, evs: Evenement[]): Nature[] {
  const de = (e: Evenement | null | undefined): string[] =>
    Array.isArray(e?.natures) ? (e.natures as unknown[]).map(String) : [];
  const own = de(main);
  const tous = new Set(own.length ? own : evs.filter((e) => !e.copie).flatMap(de));
  const xs = NATURES.filter((k) => tous.has(k));
  return xs.length > 1 ? xs.filter((k) => k !== "autre") : xs;
}

/** A CPV code the documents publish (8 digits; the build serves the codes, not their labels):
 * whether the contract (DECP) gives it, and the first notice that does. */
export type Cpv = { code: string; contrat: boolean; avis: string };
/** The CPV codes of a dossier: the contract's first, then the notices' in their order, each once;
 * a modification repeats the contract's. */
export function cpvDe(evs: Evenement[], att?: Evenement | null): Cpv[] {
  const out = new Map<string, Cpv>();
  const codes = (e: Evenement | null | undefined): string[] =>
    (Array.isArray(e?.cpv) ? (e.cpv as unknown[]) : [])
      .map((c) => String(c).trim())
      .filter((c) => /^\d{8}$/.test(c));
  for (const c of codes(att)) out.set(c, { code: c, contrat: true, avis: "" });
  for (const e of evs.filter((x) => AO.test(x.t) && !x.copie))
    for (const c of codes(e)) {
      const x = out.get(c);
      if (!x) out.set(c, { code: c, contrat: false, avis: String(e.ref ?? "") });
      else if (!x.avis) x.avis = String(e.ref ?? "");
    }
  return [...out.values()];
}

/** The lots a notice publishes (eForms, A 9715077: `lots` = [{lot, titre, duree_mois,
 * reconductions, criteres, poids_prix}]): how many, and what they share. A value is null when no
 * lot publishes it or when the lots differ; `duree` in whole months; `prix`: the price's weight in
 * the award, in % (the build's `poids_prix`, never recomputed from `criteres`). */
export type LotsAvis = {
  n: number;
  titres: string[];
  duree: number | null;
  reconductions: number | null;
  prix: number | null;
};
export function lotsAvis(e: Evenement | null | undefined): LotsAvis | null {
  const lots = (Array.isArray(e?.lots) ? e.lots : []) as {
    titre?: unknown;
    duree_mois?: unknown;
    reconductions?: unknown;
    poids_prix?: unknown;
  }[];
  if (!lots.length) return null;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
  // the one value every lot publishes, else null
  const commun = (xs: (number | null)[]): number | null =>
    xs.every((x) => x != null && x === xs[0]) ? xs[0] : null;
  return {
    n: lots.length,
    titres: lots.map((l) => String(l.titre ?? "").trim()).filter(Boolean),
    duree: commun(
      lots.map((l) => {
        const m = num(l.duree_mois);
        return m && Math.round(m) > 0 ? Math.round(m) : null;
      }),
    ),
    reconductions: commun(lots.map((l) => num(l.reconductions))),
    prix: commun(lots.map((l) => num(l.poids_prix))),
  };
}
