// « Chemin entre deux » (board Chemin-entre-deux of the redesign v3, lot 4): what it computes, pure,
// for the tests. The graph is the build's national one (graphe/aretes.json): an edge is a buyer and
// a company, with the whole amount and the number of their contracts. The shortest paths between
// two of its nodes are found breadth first, from both ends; all of them are counted, the few with
// the largest amounts kept. No word of the interface here: the view says it.

/** At most this many steps: beyond, nearly everything is tied to everything (the board's « Au plus
 * 6 étapes »). */
export const MAX_ETAPES = 6;
/** The paths shown, the largest amounts first; the others are counted. */
export const MAX_CHEMINS = 5;

/** graphe/aretes.json's edge: the buyer's SIREN, the company's, the amount (whole €), the contracts. */
export type Arete = [acheteur: string, siren: string, montant: number, n: number];
/** An edge as the paths read it: its amount, its contracts, which of its two ends is the buyer. */
export type Lien = { m: number; n: number; ach: string };
export type Graphe = Map<string, Map<string, Lien>>;

/** The adjacency of the edges, both ways; an edge given twice adds up (the build gives one). */
export function graphe(aretes: readonly Arete[]): Graphe {
  const G: Graphe = new Map();
  const mettre = (u: string, v: string, l: Lien) => {
    let m = G.get(u);
    if (!m) {
      m = new Map();
      G.set(u, m);
    }
    const old = m.get(v);
    m.set(v, old ? { m: old.m + l.m, n: old.n + l.n, ach: old.ach } : l);
  };
  for (const [a, e, m, n] of aretes) {
    if (!a || !e || a === e) continue;
    const l = { m: Math.max(0, m || 0), n: Math.max(0, n || 0), ach: a };
    mettre(a, e, l);
    mettre(e, a, l);
  }
  return G;
}

/** Each node's distance from `s`, breadth first, up to `max` steps. */
export function distances(
  G: Graphe,
  s: string,
  max = Number.POSITIVE_INFINITY,
): Map<string, number> {
  const D = new Map<string, number>([[s, 0]]);
  if (!G.has(s)) return D;
  const file = [s];
  for (let i = 0; i < file.length; i++) {
    const u = file[i];
    const du = D.get(u) ?? 0;
    if (du >= max) continue;
    for (const v of G.get(u)?.keys() ?? [])
      if (!D.has(v)) {
        D.set(v, du + 1);
        file.push(v);
      }
  }
  return D;
}

/** A path: its nodes from `de` to `a`, the edge of each step, the sum of their amounts. */
export type Chemin = { noeuds: string[]; liens: Lien[]; somme: number };
export type Resultat =
  /** the same node twice */
  | { k: "meme" }
  /** a node the graph does not hold (no contract with a company, or the reverse) */
  | { k: "absent"; qui: ("de" | "a")[] }
  /** no path of `max` steps at most: `d` the true distance, null when they are not tied at all */
  | { k: "aucun"; d: number | null }
  /** `etapes` the length; `total` every shortest path, counted; `chemins` the largest amounts
   * first; `couches[i]` the nodes at step i + 1 of any shortest path (the ends left out) */
  | { k: "trouve"; etapes: number; total: number; chemins: Chemin[]; couches: string[][] };

/** The shortest paths from `de` to `a`, of `max` steps at most: all counted, the `cap` whose
 * amounts sum highest kept (exactly: the best per node, from `a` back to `de`), ties by their
 * nodes' ids, so that the order never changes from one load to the next. */
export function plusCourts(
  G: Graphe,
  de: string,
  a: string,
  max = MAX_ETAPES,
  cap = MAX_CHEMINS,
): Resultat {
  if (de === a) return { k: "meme" };
  const qui = (["de", "a"] as const).filter((x) => !G.has(x === "de" ? de : a));
  if (qui.length) return { k: "absent", qui: [...qui] };
  const Dd = distances(G, de);
  const k = Dd.get(a);
  if (k === undefined) return { k: "aucun", d: null };
  if (k > max) return { k: "aucun", d: k };
  const Da = distances(G, a, k);
  // the nodes on a shortest path, layer by layer
  const couche: string[][] = Array.from({ length: k + 1 }, () => []);
  for (const [v, d] of Dd) if (d <= k && Da.get(v) === k - d) couche[d].push(v);
  for (const c of couche) c.sort();
  const suivants = (v: string, d: number): string[] =>
    [...(G.get(v)?.keys() ?? [])].filter((w) => Dd.get(w) === d + 1 && Da.get(w) === k - d - 1);
  // from `a` back: each node's count of paths to `a`, and its best `cap` suffixes
  type Suite = { s: number; p: string[] };
  const nb = new Map<string, number>([[a, 1]]);
  const best = new Map<string, Suite[]>([[a, [{ s: 0, p: [a] }]]]);
  const avant = (x: Suite, y: Suite) => y.s - x.s || (x.p.join() < y.p.join() ? -1 : 1);
  for (let d = k - 1; d >= 0; d--)
    for (const v of couche[d]) {
      let n = 0;
      const cand: Suite[] = [];
      for (const w of suivants(v, d)) {
        n += nb.get(w) ?? 0;
        const m = G.get(v)?.get(w)?.m ?? 0;
        for (const x of best.get(w) ?? []) cand.push({ s: x.s + m, p: [v, ...x.p] });
      }
      nb.set(v, n);
      best.set(v, cand.sort(avant).slice(0, cap));
    }
  const chemins = (best.get(de) ?? []).map(({ s, p }) => ({
    noeuds: p,
    liens: p.slice(1).map((w, i) => G.get(p[i])?.get(w) as Lien),
    somme: s,
  }));
  return { k: "trouve", etapes: k, total: nb.get(de) ?? 0, chemins, couches: couche.slice(1, k) };
}

/** Each node's part on its path: the buyer (`a`, the board's pink circle) or the company (`e`,
 * its lavender square); a SIREN on both sides of the graph takes the part its edges give it here. */
export function roles(c: Pick<Chemin, "noeuds" | "liens">): ("a" | "e")[] {
  return c.noeuds.map((v, i) => {
    const l = c.liens[i - 1] ?? c.liens[i];
    return l?.ach === v ? "a" : "e";
  });
}

/** The sentence that tells a path, as clauses: the first step « X a un contrat avec Y (m) », then
 * by twos « Y a aussi pour fournisseur Z (m), qui travaille pour W (m) » (the board's). `x` and `y`
 * are the nodes' places on the path, `i` the step's; `mot` says which words. */
export type Clause = {
  mot: "contrat" | "fournisseur" | "client" | "qui_fournisseur" | "qui_client";
  x: number;
  y: number;
  i: number;
  /** the clause ends its sentence */
  fin: boolean;
};
export function clauses(c: Pick<Chemin, "noeuds" | "liens">): Clause[] {
  const k = c.liens.length;
  const out: Clause[] = [];
  if (!k) return out;
  out.push({ mot: "contrat", x: 0, y: 1, i: 0, fin: true });
  for (let i = 1; i < k; i += 2) {
    const ach = c.liens[i].ach === c.noeuds[i];
    out.push({ mot: ach ? "fournisseur" : "client", x: i, y: i + 1, i, fin: i + 1 >= k });
    if (i + 1 < k) {
      const ach2 = c.liens[i + 1].ach === c.noeuds[i + 1];
      out.push({
        mot: ach2 ? "qui_fournisseur" : "qui_client",
        x: i + 1,
        y: i + 2,
        i: i + 1,
        fin: true,
      });
    }
  }
  return out;
}

// --- the names --------------------------------------------------------------------------------

/** A name compared without case, accents, hyphens or apostrophes' shapes. */
export function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/[-\s]+/g, " ")
    .trim();
}

/** The communes by their compared name (listes.json `dico.communes`). */
export function indexCommunes(communes: Record<string, { nom: string }>): Map<string, string[]> {
  const idx = new Map<string, string[]>();
  for (const [insee, c] of Object.entries(communes)) {
    const k = norm(c.nom);
    idx.set(k, [...(idx.get(k) ?? []), insee]);
  }
  return idx;
}

/** « Commune de X », « Commune du Havre », « Commune d'Annecy »: the buyer named after its commune
 * in graphe/aretes.json, its commune when one only bears that name (the article given back: du →
 * Le, des → Les, de la → La, de l' → L'); null otherwise (a homonym, another buyer). */
const ARTICLES: [string, string][] = [
  ["de la ", "la "],
  ["de l'", "l'"],
  ["du ", "le "],
  ["des ", "les "],
  ["de ", ""],
  ["d'", ""],
];
export function communeDuNom(nom: string, idx: Map<string, string[]>): string | null {
  const m = /^commune (.+)$/.exec(norm(nom));
  if (!m) return null;
  for (const [p, q] of ARTICLES)
    if (m[1].startsWith(p)) {
      const cand = idx.get(norm(q + m[1].slice(p.length)));
      if (cand) return cand.length === 1 ? cand[0] : null;
    }
  return null;
}
/** The buyer's name is a commune's (« Commune … »), whether or not its commune is known. */
export const estCommune = (nom: string): boolean => /^commune /.test(norm(nom));

// --- the fields' search -----------------------------------------------------------------------

/** A name the fields offer: its id (a SIREN), its words, its kind, its weight (its edges). */
export type Entree = { id: string; nom: string; kind: string; poids: number; cle?: string };

/** The entries that match the words typed: the name starting with them first, then a word of it,
 * then anywhere; among equals the most tied first, then by name. `n` at most. */
export function chercher(entrees: readonly Entree[], q: string, n = 20): Entree[] {
  const w = norm(q);
  if (!w) return [];
  const mots = w.split(" ");
  const notes: { e: Entree; r: number }[] = [];
  for (const e of entrees) {
    const c = e.cle ?? norm(e.nom);
    let r: number;
    if (c.startsWith(w)) r = 0;
    else {
      const cm = c.split(/[ ']/);
      if (mots.every((m) => cm.some((x) => x.startsWith(m)))) r = 1;
      else if (c.includes(w)) r = 2;
      else continue;
    }
    notes.push({ e, r });
  }
  notes.sort((x, y) => x.r - y.r || y.e.poids - x.e.poids || x.e.nom.localeCompare(y.e.nom, "fr"));
  return notes.slice(0, n).map((x) => x.e);
}
