// A company's fiche in theme A (board Entreprise-Electriox-A, redesign v3 lot 3): what it computes
// from the company's file, listes.json and graphe/aretes.json, pure, for the tests. Every figure is
// the build's (one source per figure, Ju 07/11): its contracts (`stats.contrats`, a copy never),
// the amounts a total adds (`compte`), the planned ends (`page.fins`), the running ones
// (`page.en_cours`), the offers (`page.faits.offres`), the buyer–company edges of the national graph.

/** A contract as the fiche reads it (entreprise-outils.ts `Ct`, the fields used here). */
export type ContratA = {
  d: string;
  fin: string | null;
  b: string | null;
  amt: number;
  offres?: number | null;
  entreprises?: string[];
};

/** The colour a buyer's contracts take in the chart, the frieze and the clients' bars (the
 * board's three: Lyon, « autres communes du Rhône », « Annecy et Vienne »), as a rule: s1 its
 * largest client, s2 the other buyers of that client's département, s3 the buyers elsewhere. */
export type Serie = "s1" | "s2" | "s3";
export const SERIES: Serie[] = ["s1", "s2", "s3"];
export function seriesDe(
  clients: { s: string; amt: number }[],
  depOf: (s: string) => string,
): { top: string | null; dep: string; de: (s: string | null) => Serie } {
  const top = clients.slice().sort((a, b) => b.amt - a.amt || a.s.localeCompare(b.s))[0]?.s ?? null;
  const dep = top ? depOf(top) : "";
  return {
    top,
    dep,
    de: (s) => (s && s === top ? "s1" : s && dep && depOf(s) === dep ? "s2" : "s3"),
  };
}

/** The contracts signed each year, from `y0` to `y1` (every year shown, an empty one too): each
 * series' amount (the counted ones, `amt`) and count. */
export type AnneeA = {
  an: string;
  m: Record<Serie, number>;
  n: Record<Serie, number>;
  total: number;
  nb: number;
};
export function parAnnee(
  contrats: ContratA[],
  de: (s: string | null) => Serie,
  y0: number,
  y1: number,
): AnneeA[] {
  const out: AnneeA[] = [];
  for (let y = y0; y <= y1; y++)
    out.push({
      an: String(y),
      m: { s1: 0, s2: 0, s3: 0 },
      n: { s1: 0, s2: 0, s3: 0 },
      total: 0,
      nb: 0,
    });
  for (const c of contrats) {
    const a = out[Number(c.d.slice(0, 4)) - y0];
    if (!a) continue;
    const k = de(c.b);
    a.m[k] += c.amt;
    a.n[k]++;
    a.total += c.amt;
    a.nb++;
  }
  return out;
}

/** A chart's scale: the grid's step (at most four lines under the largest value) and the value
 * the plot's full height stands for (the largest, so that the tallest bar fills it). */
export function echelle(max: number): { pas: number; lignes: number; haut: number } {
  if (!(max > 0)) return { pas: 1, lignes: 0, haut: 1 };
  const base = 10 ** Math.floor(Math.log10(max));
  const pas =
    [0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10].map((k) => k * base).find((p) => max / p <= 4.1) ??
    10 * base;
  return { pas, lignes: Math.floor(max / pas + 1e-9), haut: max };
}

/** The offers its contracts received, when the notice publishes them: the fewest and the most,
 * over how many contracts. */
export function offresPubliees(contrats: ContratA[]): { min: number; max: number; n: number } {
  const v = contrats.map((c) => c.offres).filter((x): x is number => typeof x === "number");
  return v.length
    ? { min: Math.min(...v), max: Math.max(...v), n: v.length }
    : { min: 0, max: 0, n: 0 };
}

/** The contracts it signed with other companies: one row per partner and contract, the largest
 * contract first. `ei` is the build's token for a sole trader (never named, never a row). */
export function groupements<C extends ContratA>(
  contrats: C[],
  siren: string,
  ei: (s: string) => boolean,
): { siren: string; c: C }[] {
  return contrats
    .filter((c) => (c.entreprises ?? []).length > 1)
    .flatMap((c) =>
      (c.entreprises ?? []).filter((s) => s !== siren && !ei(s)).map((s) => ({ siren: s, c })),
    )
    .sort((a, b) => b.c.amt - a.c.amt || a.siren.localeCompare(b.siren));
}

/** Its clients' other suppliers (graphe/aretes.json: [buyer, company, amount, contracts], never
 * added up, A's warning): how many other companies each client has, and the companies that
 * worked for its clients, the most clients shared first, its partners in a joint contract left
 * out of that list (they are « En groupement »). */
export type Arete = [string, string, number, number];
export function voisins(
  aretes: Arete[],
  clients: string[],
  siren: string,
  nom: (s: string) => string,
  partenaires: Set<string> = new Set(),
): { parClient: Map<string, number>; ent: { siren: string; clients: string[] }[] } {
  const cl = new Set(clients);
  const parClient = new Map<string, number>(clients.map((c) => [c, 0]));
  const by = new Map<string, Set<string>>();
  for (const [b, s] of aretes) {
    if (!cl.has(b) || s === siren) continue;
    parClient.set(b, (parClient.get(b) ?? 0) + 1);
    const x = by.get(s) ?? new Set<string>();
    x.add(b);
    by.set(s, x);
  }
  const ent = [...by.entries()]
    .filter(([s]) => !partenaires.has(s))
    .map(([s, bs]) => ({ siren: s, clients: [...bs] }))
    .sort(
      (a, b) =>
        b.clients.length - a.clients.length || nom(a.siren).localeCompare(nom(b.siren), "fr"),
    );
  return { parClient, ent };
}

/** « Le même métier, dans les mêmes départements »: the companies of the same NAF code (SIRENE,
 * listes.json `dico.entreprises`) with contracts in its départements (`lignes.entreprises[].deps`),
 * the most contracts there first. Not the contracts' nature, which the build does not serve. */
export function memeMetier(
  lignes: Record<string, { deps?: Record<string, number> }>,
  dico: Record<string, { naf?: string | null; entrepreneur_individuel?: boolean }>,
  naf: string,
  deps: string[],
  siren: string,
  n = 5,
): { siren: string; n: number }[] {
  if (!naf || !deps.length) return [];
  return Object.entries(lignes)
    .filter(([k]) => k !== siren && dico[k]?.naf === naf && !dico[k]?.entrepreneur_individuel)
    .map(([k, v]) => ({ siren: k, n: deps.reduce((s, d) => s + (v.deps?.[d] ?? 0), 0) }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n || a.siren.localeCompare(b.siren))
    .slice(0, n);
}

/** A date's place on the frieze's axis: `x0` at 1 January of `y0`, `x1` at 1 January after
 * `y1`, by days. */
export function axe(y0: number, y1: number, x0: number, x1: number): (d: string) => number {
  const t0 = Date.UTC(y0, 0, 1);
  const t1 = Date.UTC(y1 + 1, 0, 1);
  return (d: string) =>
    x0 + ((Date.parse(`${d.slice(0, 10)}T00:00:00Z`) - t0) / (t1 - t0)) * (x1 - x0);
}

/** The frieze's rows: its contracts grouped by client (the client with the most money first), in
 * a group the oldest first; more than `max`: the running ones (the largest first) and the
 * largest of the others, the rest left to « Tous les documents ». */
export function friseLignes<C extends ContratA>(
  contrats: C[],
  enCours: (c: C) => boolean,
  max = 18,
): { groupes: { b: string | null; rows: C[] }[]; caches: number } {
  let pris = contrats;
  if (contrats.length > max) {
    const run = contrats.filter(enCours).sort((a, b) => b.amt - a.amt);
    const autres = contrats
      .filter((c) => !enCours(c))
      .sort((a, b) => b.amt - a.amt)
      .slice(0, Math.max(0, max - run.length));
    const keep = new Set([...run.slice(0, max), ...autres]);
    pris = contrats.filter((c) => keep.has(c));
  }
  const tot = new Map<string, number>();
  for (const c of contrats) tot.set(c.b ?? "", (tot.get(c.b ?? "") ?? 0) + c.amt);
  const by = new Map<string, C[]>();
  for (const c of pris) by.set(c.b ?? "", [...(by.get(c.b ?? "") ?? []), c]);
  const groupes = [...by.entries()]
    .sort((a, b) => (tot.get(b[0]) ?? 0) - (tot.get(a[0]) ?? 0) || a[0].localeCompare(b[0]))
    .map(([b, rows]) => ({
      b: b || null,
      rows: rows.slice().sort((p, q) => p.d.localeCompare(q.d)),
    }));
  return { groupes, caches: contrats.length - pris.length };
}

/** The same contract published twice (`lots`, nature « doublon »): the communes where it happens,
 * counted once (the build's rule), for the money's note. */
export function doublons(
  lots: Record<string, { insee?: string; nature?: string; entreprises?: string[] }> | undefined,
  siren: string,
): string[] {
  return [
    ...new Set(
      Object.values(lots ?? {})
        .filter((l) => l.nature === "doublon" && (l.entreprises ?? []).includes(siren) && l.insee)
        .map((l) => l.insee as string),
    ),
  ];
}

/** « du Rhône », « de la Haute-Savoie », « de l'Isère », « des Yvelines »: « de » before the
 * département's article (« le Rhône »), contracted. */
export function deArt(art: string): string {
  if (/^le /i.test(art)) return `du ${art.slice(3)}`;
  if (/^les /i.test(art)) return `des ${art.slice(4)}`;
  return `de ${art}`;
}
