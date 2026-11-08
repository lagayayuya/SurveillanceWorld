// The graph centred on a company or a buyer (redesign v3, lot 4; boards Graphe-plein and
// Graphe-grammaire): what it computes from the build's graph (graphe/aretes.json), pure, for the
// tests. Its grammar is the board's four signs: a round is a public buyer, a square a company; the
// size is the money; a line is at least one contract; a node between two is shared, with its
// count. The first circle is the centre's partners; the second, their other partners. The drawing
// caps what it shows (« +N » groups them, in the shape of what they group); the table view gives
// every link of the first circle it draws, the CSV export every link of the neighbourhood.
// The layout ports the board's own (its generator's sectors): one sector per first-circle node,
// weighed by the second-circle nodes it alone holds, these at the edge, the shared ones between
// their partners. An edge's amount is never summed with another's (a contract with several holders
// carries its whole amount on each holder's edge: A's note of 07/11): a node's size is its largest
// edge to the first circle.

/** One edge of the build: [buyer's SIREN, company's SIREN, amount in whole euros, contracts]. */
export type Arete = [acheteur: string, entreprise: string, montant: number, n: number];
export type AcheteurG = { nom_court?: string; nom?: string; nom_inconnu?: boolean; ref?: string };
export type FichierGraphe = {
  v?: number;
  maj?: string;
  aretes: Arete[];
  acheteurs: Record<string, AcheteurG>;
};

/** A side of an edge: `a` a buyer (a round), `e` a company (a square). */
export type Role = "a" | "e";
export type Lien = { m: number; n: number };
/** Each SIREN's partners on the other side, by its role. */
export type Index = { a: Map<string, Map<string, Lien>>; e: Map<string, Map<string, Lien>> };

export function indexer(aretes: Arete[]): Index {
  const I: Index = { a: new Map(), e: new Map() };
  const put = (m: Map<string, Map<string, Lien>>, k: string, o: string, l: Lien) => {
    let x = m.get(k);
    if (!x) {
      x = new Map();
      m.set(k, x);
    }
    x.set(o, l);
  };
  for (const [a, e, m, n] of aretes) {
    const l = { m: m || 0, n: n || 0 };
    put(I.a, a, e, l);
    put(I.e, e, a, l);
  }
  return I;
}

/** The centre's role: the one asked (`?role=`) when it has edges in it; else the one with more
 * partners (six SIRENs are both a buyer and a company: a transport company, a central purchaser),
 * a company on a tie; null when the SIREN has no edge. */
export function role(I: Index, siren: string, demande?: string): Role | null {
  const na = I.a.get(siren)?.size ?? 0;
  const ne = I.e.get(siren)?.size ?? 0;
  if (demande === "acheteur" && na) return "a";
  if (demande === "entreprise" && ne) return "e";
  if (!na && !ne) return null;
  return na > ne ? "a" : "e";
}
export const autre = (r: Role): Role => (r === "a" ? "e" : "a");

export type Premier = { id: string; m: number; n: number };
export type Second = {
  id: string;
  /** its edges to the first circle, by first-circle node */
  liens: Map<string, Lien>;
  /** its partners in the whole register (the first circle's included) */
  degre: number;
};
export type Voisinage = { centre: string; role: Role; premiers: Premier[]; seconds: Second[] };

const parMontant = <T extends { id: string; m: number }>(a: T, b: T): number =>
  b.m - a.m || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** The centre's first circle (its partners, the most money first) and second circle (their other
 * partners, the centre left out). */
export function voisinage(I: Index, centre: string, r: Role): Voisinage {
  const mine = (r === "a" ? I.a : I.e).get(centre) ?? new Map<string, Lien>();
  const theirs = r === "a" ? I.e : I.a;
  const premiers = [...mine].map(([id, l]) => ({ id, m: l.m, n: l.n })).sort(parMontant);
  const by = new Map<string, Second>();
  for (const p of premiers) {
    for (const [o, l] of theirs.get(p.id) ?? []) {
      if (o === centre) continue;
      let s = by.get(o);
      if (!s) {
        s = { id: o, liens: new Map(), degre: (r === "a" ? I.a : I.e).get(o)?.size ?? 0 };
        by.set(o, s);
      }
      s.liens.set(p.id, l);
    }
  }
  return { centre, role: r, premiers, seconds: [...by.values()] };
}

/** A second-circle node's largest edge among the first-circle nodes given (all when none). */
export function plusGros(s: Second, parmi?: Set<string>): number {
  let m = 0;
  for (const [k, l] of s.liens) if ((!parmi || parmi.has(k)) && l.m > m) m = l.m;
  return m;
}

/** The first circle's order around the centre (the board's): the most money first, then each
 * time the node sharing the most second-circle nodes with the last one placed, the most money on
 * a tie. Shared nodes then sit between neighbours. */
export function ordre(premiers: Premier[], seconds: Second[]): string[] {
  const commun = new Map<string, number>();
  const cle = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  for (const s of seconds) {
    const ks = [...s.liens.keys()];
    for (let i = 0; i < ks.length; i++)
      for (let j = i + 1; j < ks.length; j++)
        commun.set(cle(ks[i], ks[j]), (commun.get(cle(ks[i], ks[j])) ?? 0) + 1);
  }
  const reste = [...premiers].sort(parMontant);
  const out: string[] = [];
  while (reste.length) {
    const last = out.at(-1);
    let best = 0;
    if (last) {
      let n = 0;
      reste.forEach((p, i) => {
        const c = commun.get(cle(last, p.id)) ?? 0;
        if (c > n) {
          n = c;
          best = i;
        }
      });
    }
    out.push(reste.splice(best, 1)[0].id);
  }
  return out;
}

/** The share of a budget each count gets (water filling): every count up to the same level, the
 * remainder to the first ones still above it. */
export function quotas(counts: number[], budget: number): number[] {
  const tot = counts.reduce((s, c) => s + c, 0);
  if (tot <= budget) return [...counts];
  let lo = 0;
  let hi = Math.max(0, ...counts);
  const sum = (q: number) => counts.reduce((s, c) => s + Math.min(c, q), 0);
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (sum(mid) <= budget) lo = mid;
    else hi = mid - 1;
  }
  const out = counts.map((c) => Math.min(c, lo));
  let r = budget - sum(lo);
  for (let i = 0; i < out.length && r > 0; i++)
    if (counts[i] > out[i]) {
      out[i]++;
      r--;
    }
  return out;
}

/** A buyer's name as the drawing writes it: « Commune de Lyon » is « Lyon » (the commune's
 * name), the panel and the table keep the whole name. */
export function etiquette(nom: string): string {
  const m = /^(?:commune|ville|mairie)\s+d(?:e\s+|['’]\s*)(.+)$/i.exec(nom.trim());
  return m ? m[1] : nom.trim();
}
/** A buyer named as a commune (« Commune de … »), or whose dictionary says so. */
export const estCommune = (nom: string, categorie?: string | null): boolean =>
  categorie === "commune" || /^(?:commune|ville|mairie)\s+d(?:e\s|['’])/i.test(nom.trim());

/** A label cut to `n` characters, its end an ellipsis. */
export function couper(s: string, n: number): string {
  const t = s.trim();
  if (t.length <= n) return t;
  return n <= 1 ? "…" : `${t.slice(0, n - 1).trimEnd()}…`;
}

// --- the drawing --------------------------------------------------------------------------------

export const W = 1000;
export const H = 940;
const CX = 500;
const CY = 450;
const R1X = 190;
const R1Y = 160;
const R2X = 385;
const R2Y = 320;
const BORD = 6;

export type Opts = {
  /** first-circle nodes drawn; the others are one « +N » */
  max1: number;
  /** second-circle nodes drawn alone at the edge, for the whole drawing */
  budget: number;
  /** shared nodes drawn between their partners; the others join their partners' « +N » */
  maxPonts: number;
};
export const OPTS: Opts = { max1: 12, budget: 40, maxPonts: 8 };

/** `p` a first-circle node, `b` a shared second-circle one (between its partners), `s` one with a
 * single partner (at the edge), `g1` the first circle's « +N », `g2` a first-circle node's. */
export type Sorte = "p" | "b" | "s" | "g1" | "g2";
export type Etiquette = {
  x: number;
  y: number;
  anc: "start" | "end" | "middle";
  /** the rotation of a radial label (degrees), its origin (x, y); null: horizontal */
  rot: number | null;
  txt: string;
};
export type NoeudG = {
  /** a SIREN, or `+` (the first circle's group), `+<first-circle id>` (a node's group) */
  k: string;
  sorte: Sorte;
  forme: Role;
  x: number;
  y: number;
  /** half its side, its radius */
  z: number;
  /** the amount its size says (its edge to the centre, its largest edge to the first circle) */
  m: number;
  /** a shared node's partners in the whole first circle; a group's nodes */
  n: number;
  /** the first-circle nodes it is drawn linked to (a group: its own node) */
  vers: string[];
  lab: Etiquette | null;
};
export type TraitG = {
  /** the two ends' keys (the centre is « c ») */
  a: string;
  b: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  more: boolean;
};
export type Dessin = {
  noeuds: NoeudG[];
  traits: TraitG[];
  /** the first-circle nodes drawn, in their order around the centre */
  colonnes: string[];
  /** the first-circle nodes not drawn (in « + ») */
  caches: string[];
  /** a first-circle node's second-circle nodes not drawn (in its « +N ») */
  groupes: Map<string, string[]>;
  centre: { x: number; y: number; w: number; txt: string };
};

const r1 = (m: number, mx: number) => 9 + 13 * Math.sqrt(mx > 0 ? m / mx : 0);
const zS = (m: number, mx: number) => 4.5 + 9 * Math.sqrt(mx > 0 ? m / mx : 0);
const zB = (m: number, mx: number) => 8 + 9 * Math.sqrt(mx > 0 ? m / mx : 0);
const zG = (txt: string) => Math.max(14, 5 + 3.9 * txt.length);
const rd = (v: number) => Math.round(v * 10) / 10;

/** How far a label can run from (x, y) in direction `a` before the drawing's edge. */
function place(x: number, y: number, a: number): number {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const ts = [
    c > 1e-6 ? (W - BORD - x) / c : Infinity,
    c < -1e-6 ? (BORD - x) / c : Infinity,
    s > 1e-6 ? (H - BORD - y) / s : Infinity,
    s < -1e-6 ? (BORD - y) / s : Infinity,
  ];
  return Math.max(0, Math.min(...ts));
}

/** The drawing of a neighbourhood: every node's place and size, its label placed and cut to the
 * room it has, every line. `nom` gives a node's words (the buyer's drawn name, the company's). */
export function disposer(v: Voisinage, nom: (siren: string) => string, opts: Opts = OPTS): Dessin {
  const f1: Role = autre(v.role);
  const f2: Role = v.role;
  const tri = ordre(v.premiers, v.seconds);
  const pm = new Map(v.premiers.map((p) => [p.id, p]));
  // the first circle drawn: the most money, in the order around the centre
  const gardes = new Set(
    [...v.premiers]
      .sort(parMontant)
      .slice(0, opts.max1)
      .map((p) => p.id),
  );
  const colonnes = tri.filter((k) => gardes.has(k));
  const caches = tri.filter((k) => !gardes.has(k));
  // second circle: shared (two partners drawn or more), single (one), unseen (none drawn)
  const vus = v.seconds.filter((s) => [...s.liens.keys()].some((k) => gardes.has(k)));
  const partenaires = (s: Second) => [...s.liens.keys()].filter((k) => gardes.has(k));
  const partages = vus
    .filter((s) => partenaires(s).length > 1)
    .sort(
      (a, b) => b.liens.size - a.liens.size || plusGros(b) - plusGros(a) || (a.id < b.id ? -1 : 1),
    );
  const ponts = partages.slice(0, opts.maxPonts);
  const pontSet = new Set(ponts.map((s) => s.id));
  // each first-circle node's own: its single ones, and the shared ones not drawn as such
  const propres = new Map<string, Second[]>(colonnes.map((k) => [k, []]));
  for (const s of vus) {
    if (pontSet.has(s.id)) continue;
    const ps = partenaires(s);
    if (ps.length === 1) propres.get(ps[0])?.push(s);
  }
  const surplus = new Map<string, Second[]>(colonnes.map((k) => [k, []]));
  for (const s of partages.slice(opts.maxPonts))
    for (const k of partenaires(s)) surplus.get(k)?.push(s);
  for (const [k, xs] of propres)
    xs.sort(
      (a, b) => plusGros(b, new Set([k])) - plusGros(a, new Set([k])) || (a.id < b.id ? -1 : 1),
    );
  // the budget at the edge, shared out; a node over its share keeps share − 1 and one « +N »
  const counts = colonnes.map((k) => (propres.get(k)?.length ?? 0) + (surplus.get(k)?.length ?? 0));
  // more first-circle nodes, fewer at the edge: their labels need the room
  const q = quotas(counts, Math.max(16, opts.budget - 3 * Math.max(0, colonnes.length - 8)));
  const montres = new Map<string, Second[]>();
  const groupes = new Map<string, string[]>();
  colonnes.forEach((k, i) => {
    const own = propres.get(k) ?? [];
    const extra = surplus.get(k) ?? [];
    if (counts[i] <= q[i] && !extra.length) {
      montres.set(k, own);
      return;
    }
    const keep = Math.max(0, Math.min(own.length, q[i] - 1));
    montres.set(k, own.slice(0, keep));
    groupes.set(
      k,
      [...own.slice(keep), ...extra].map((s) => s.id),
    );
  });
  // sectors: a unit per node at the edge, a gap for a node without any, a gap between nodes
  type Pas = { k: string | null; c: string | null; w: number };
  const seq: Pas[] = [];
  for (const c of colonnes) {
    const xs = montres.get(c) ?? [];
    const n = xs.length + (groupes.has(c) ? 1 : 0);
    // a node with few or none at the edge still gets the room of its label (the board: 1.8)
    const pad = n && colonnes.length > 8 ? Math.max(0, 2.2 - n) / 2 : 0;
    if (pad) seq.push({ k: null, c, w: pad });
    for (const s of xs) seq.push({ k: s.id, c, w: 1 });
    if (groupes.has(c)) seq.push({ k: `+${c}`, c, w: 1 });
    if (!n) seq.push({ k: null, c, w: 1.8 });
    if (pad) seq.push({ k: null, c, w: pad });
    seq.push({ k: null, c: null, w: 1.1 });
  }
  if (caches.length) {
    seq.push({ k: "+", c: "+", w: 1.8 });
    seq.push({ k: null, c: null, w: 1.1 });
  }
  const U = seq.reduce((s, x) => s + x.w, 0) || 1;
  const ang2 = new Map<string, number>();
  const span = new Map<string, number[]>();
  let u = 0;
  for (const p of seq) {
    const a = -Math.PI / 2 + ((u + p.w / 2) / U) * 2 * Math.PI;
    if (p.k && p.c !== "+") ang2.set(p.k, a);
    if (p.c) span.set(p.c, [...(span.get(p.c) ?? []), a]);
    u += p.w;
  }
  const ang1 = new Map<string, number>();
  for (const [c, xs] of span) ang1.set(c, (Math.min(...xs) + Math.max(...xs)) / 2);
  const p1 = (c: string) => {
    const a = ang1.get(c) ?? 0;
    return { x: CX + R1X * Math.cos(a), y: CY + R1Y * Math.sin(a), a };
  };
  const p2 = (a: number) => ({ x: CX + R2X * Math.cos(a), y: CY + R2Y * Math.sin(a) });
  // shared ones between their partners, a little farther than them; spread apart when they meet
  const angB = new Map<string, number>();
  for (const s of ponts) {
    const ps = partenaires(s);
    const sx = ps.reduce((t, k) => t + Math.cos(ang1.get(k) ?? 0), 0);
    const sy = ps.reduce((t, k) => t + Math.sin(ang1.get(k) ?? 0), 0);
    // partners face to face: beside the strongest one
    const fort = ps.reduce((b, k) => ((s.liens.get(k)?.m ?? 0) > (s.liens.get(b)?.m ?? 0) ? k : b));
    angB.set(
      s.id,
      Math.hypot(sx, sy) < 0.3 * ps.length ? (ang1.get(fort) ?? 0) + 0.3 : Math.atan2(sy, sx),
    );
  }
  ecarter(angB, 0.21);
  // shared ones close to each other: one nearer the centre, the next farther, in turn
  const loin = new Map<string, number>();
  const parAngle = [...angB].sort((a, b) => a[1] - b[1]);
  parAngle.forEach(([k, a], i) => {
    const prev = parAngle[i - 1];
    const serre = prev && a - prev[1] < 0.32;
    loin.set(k, serre && loin.get(prev[0]) === 1.45 ? 1.68 : 1.45);
  });
  const mx1 = Math.max(0, ...colonnes.map((k) => pm.get(k)?.m ?? 0));
  const drawn2 = [...ponts, ...[...montres.values()].flat()];
  const gk = new Set(colonnes);
  const mx2 = Math.max(0, ...drawn2.map((s) => plusGros(s, gk)));
  const noeuds: NoeudG[] = [];
  const traits: TraitG[] = [];
  const pos = new Map<string, { x: number; y: number }>();
  // the first circle
  for (const c of colonnes) {
    const { x, y } = p1(c);
    const p = pm.get(c) as Premier;
    pos.set(c, { x, y });
    noeuds.push({
      k: c,
      sorte: "p",
      forme: f1,
      x: rd(x),
      y: rd(y),
      z: rd(r1(p.m, mx1)),
      m: p.m,
      n: 1,
      vers: [c],
      lab: null,
    });
    traits.push({ a: "c", b: c, x1: CX, y1: CY, x2: rd(x), y2: rd(y), more: false });
  }
  if (caches.length) {
    const a = ang1.get("+") ?? 0;
    const x = CX + R1X * Math.cos(a);
    const y = CY + R1Y * Math.sin(a);
    const txt = `+${caches.length}`;
    noeuds.push({
      k: "+",
      sorte: "g1",
      forme: f1,
      x: rd(x),
      y: rd(y),
      z: rd(zG(txt)),
      m: 0,
      n: caches.length,
      vers: [],
      lab: null,
    });
    traits.push({ a: "c", b: "+", x1: CX, y1: CY, x2: rd(x), y2: rd(y), more: true });
  }
  // the shared ones
  for (const s of ponts) {
    const a = angB.get(s.id) ?? 0;
    const f = loin.get(s.id) ?? 1.45;
    const x = CX + R1X * f * Math.cos(a);
    const y = CY + R1Y * f * Math.sin(a);
    const m = plusGros(s, gk);
    pos.set(s.id, { x, y });
    noeuds.push({
      k: s.id,
      sorte: "b",
      forme: f2,
      x: rd(x),
      y: rd(y),
      z: rd(zB(m, mx2)),
      m,
      n: s.liens.size,
      vers: partenaires(s),
      lab: null,
    });
  }
  // the single ones, at the edge, and the groups
  for (const c of colonnes) {
    for (const s of montres.get(c) ?? []) {
      const { x, y } = p2(ang2.get(s.id) ?? 0);
      const m = plusGros(s, gk);
      pos.set(s.id, { x, y });
      noeuds.push({
        k: s.id,
        sorte: "s",
        forme: f2,
        x: rd(x),
        y: rd(y),
        z: rd(zS(m, mx2)),
        m,
        n: s.liens.size,
        vers: [c],
        lab: null,
      });
    }
    const g = groupes.get(c);
    if (g) {
      const { x, y } = p2(ang2.get(`+${c}`) ?? 0);
      const txt = `+${g.length}`;
      noeuds.push({
        k: `+${c}`,
        sorte: "g2",
        forme: f2,
        x: rd(x),
        y: rd(y),
        z: rd(zG(txt)),
        m: 0,
        n: g.length,
        vers: [c],
        lab: null,
      });
    }
  }
  // the lines from the first circle to the second
  for (const n of noeuds) {
    if (n.sorte === "p" || n.sorte === "g1") continue;
    for (const c of n.vers) {
      const o = pos.get(c);
      if (!o) continue;
      traits.push({
        a: c,
        b: n.k,
        x1: rd(o.x),
        y1: rd(o.y),
        x2: n.x,
        y2: n.y,
        more: n.sorte === "g2",
      });
    }
  }
  const ct = couper(nom(v.centre), 28);
  const cw = Math.max(148, Math.round(36 + largeur(ct, "tc")));
  etiqueter(noeuds, nom, cw, (k) => ang1.get(k) ?? angB.get(k) ?? ang2.get(k) ?? 0);
  return { noeuds, traits, colonnes, caches, groupes, centre: { x: CX, y: CY, w: cw, txt: ct } };
}

// --- the labels: each where it meets neither a shape nor a label already placed ------------------

const FS = { t0: 14 * 0.85 * 1.06, t1: 12.8, t2: 15 * 0.85 * 1.06, tc: 16 * 0.78 * 1.08 };
type Cls = keyof typeof FS;
/** A label's width in the drawing's units: Archivo's widths by kind of character, near enough to
 * keep labels apart and inside the drawing. */
export function largeur(txt: string, cls: Cls): number {
  let em = 0;
  for (const ch of cls === "tc" ? txt.toLocaleUpperCase("fr") : txt) {
    if (ch === " ") em += 0.25;
    else if (/[iIljtf.,;:'’!|()-]/.test(ch)) em += 0.28;
    else if (/[mwMW]/.test(ch)) em += 0.82;
    else if (/\d/.test(ch)) em += 0.56;
    else if (ch !== ch.toLocaleLowerCase("fr")) em += 0.66;
    else em += 0.52;
  }
  return em * FS[cls];
}
/** As many characters as `room` holds, `max` at most (22: the board's cut). */
export function tenir(nom: string, room: number, cls: Cls, max = 22): string {
  let s = couper(nom, max);
  while (s.length > 4 && largeur(s, cls) > room) s = couper(nom, s.length - 1);
  return s;
}

type Boite = { x0: number; y0: number; x1: number; y1: number };
const croise = (a: Boite, b: Boite): boolean =>
  a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
const dedans = (b: Boite): boolean =>
  b.x0 >= BORD - 1 && b.y0 >= 2 && b.x1 <= W - BORD + 1 && b.y1 <= H - 2;
/** A horizontal label's box. */
function boite(x: number, y: number, anc: Etiquette["anc"], w: number, fs: number): Boite {
  const x0 = anc === "start" ? x : anc === "end" ? x - w : x - w / 2;
  return { x0: x0 - 1, y0: y - 0.8 * fs, x1: x0 + w + 1, y1: y + 0.25 * fs };
}
/** A radial label's boxes: squares along its line, from its origin outward. */
function boitesRadiales(tx: number, ty: number, a: number, w: number): Boite[] {
  const out: Boite[] = [];
  for (let s = 4; s < w + 4; s += 5) {
    const x = tx + s * Math.cos(a);
    const y = ty + s * Math.sin(a);
    out.push({ x0: x - 4.5, y0: y - 4.5, x1: x + 4.5, y1: y + 4.5 });
  }
  return out;
}

function etiqueter(
  noeuds: NoeudG[],
  nom: (siren: string) => string,
  cw: number,
  angle: (k: string) => number,
): void {
  const obst: { b: Boite; k: string }[] = [
    { b: { x0: CX - cw / 2 - 3, y0: CY - 24, x1: CX + cw / 2 + 3, y1: CY + 24 }, k: "c" },
  ];
  for (const n of noeuds) {
    obst.push({
      b: { x0: n.x - n.z - 2, y0: n.y - n.z - 2, x1: n.x + n.z + 2, y1: n.y + n.z + 2 },
      k: n.k,
    });
    if (n.sorte === "b") {
      const bx = n.x + n.z;
      const by = n.y - n.z;
      obst.push({ b: { x0: bx - 11, y0: by - 11, x1: bx + 11, y1: by + 11 }, k: n.k });
    }
  }
  const libre = (bs: Boite[], k: string): boolean =>
    bs.every((b) => dedans(b) && !obst.some((o) => o.k !== k && croise(o.b, b)));
  const poser = (bs: Boite[]): void => {
    for (const b of bs) obst.push({ b, k: "" });
  };
  type Choix = { lab: Etiquette; bs: Boite[] };
  const heurts = (bs: Boite[], k: string): number =>
    bs.reduce(
      (t, b) => t + (dedans(b) ? 0 : 9) + obst.filter((o) => o.k !== k && croise(o.b, b)).length,
      0,
    );
  /** The first free place; none: the one that meets the fewest. */
  const choisir = (n: NoeudG, cs: Choix[]): void => {
    let c = cs.find((x) => libre(x.bs, n.k));
    if (!c) {
      const hs = cs.map((x) => heurts(x.bs, n.k));
      c = cs[hs.indexOf(Math.min(...hs))];
    }
    n.lab = c.lab;
    poser(c.bs);
  };
  const horiz = (x: number, y: number, anc: Etiquette["anc"], txt: string, cls: Cls): Choix => {
    const w = largeur(txt, cls);
    // a centred label kept inside the drawing
    const xx = anc === "middle" ? Math.min(Math.max(x, BORD + w / 2), W - BORD - w / 2) : x;
    return {
      lab: { x: rd(xx), y: rd(y), anc, rot: null, txt },
      bs: [boite(xx, y, anc, w, cls === "t1" ? 12 : 15)],
    };
  };
  const room = (x: number, anc: Etiquette["anc"]) =>
    anc === "start" ? W - BORD - x : anc === "end" ? x - BORD : W - 2 * BORD;
  // the first circle: above when it stands in the upper half, below otherwise, else the other
  for (const n of noeuds) {
    if (n.sorte !== "p") continue;
    const a = angle(n.k);
    const txt = tenir(nom(n.k), W - 2 * BORD, "t0");
    const up = horiz(n.x, n.y - n.z - 8, "middle", txt, "t0");
    const down = horiz(n.x, n.y + n.z + 16, "middle", txt, "t0");
    const sa: Etiquette["anc"] = Math.cos(a) >= 0 ? "start" : "end";
    const sx = n.x + (n.z + 6) * (sa === "start" ? 1 : -1);
    const side = horiz(sx, n.y + 5, sa, tenir(nom(n.k), room(sx, sa), "t0"), "t0");
    choisir(n, Math.sin(a) < -0.2 ? [up, down, side] : [down, up, side]);
  }
  // the shared ones: outward beside it (the board), else above, below, inward
  for (const n of noeuds) {
    if (n.sorte !== "b") continue;
    const a = angle(n.k);
    const c = Math.cos(a);
    const out: Etiquette["anc"] = c > 0.2 ? "start" : c < -0.2 ? "end" : "middle";
    const cs: Choix[] = [];
    for (const max of [24, 14]) {
      const full = tenir(nom(n.k), W - 2 * BORD, "t2", max);
      const up = horiz(n.x, n.y - n.z - 14, "middle", full, "t2");
      const down = horiz(n.x, n.y + n.z + 20, "middle", full, "t2");
      const cote = (anc: "start" | "end") => {
        const x = n.x + (n.z + 16) * (anc === "start" ? 1 : -1);
        return horiz(x, n.y + 5, anc, tenir(nom(n.k), room(x, anc), "t2", max), "t2");
      };
      if (out === "middle") cs.push(Math.sin(a) < 0 ? up : down, Math.sin(a) < 0 ? down : up);
      else cs.push(cote(out), up, down, cote(out === "start" ? "end" : "start"));
    }
    choisir(n, cs);
  }
  // the edge: horizontal on the sides, radial at the top and the bottom (the board); shortened
  // until it is free
  for (const n of noeuds) {
    if (n.sorte !== "s") continue;
    const a = angle(n.k);
    const c = Math.cos(a);
    const nm = nom(n.k);
    const cs: Choix[] = [];
    if (Math.abs(c) < 0.55) {
      const off = n.z + 5;
      const tx = n.x + off * Math.cos(a);
      const ty = n.y + off * Math.sin(a);
      const rot = rd((a * 180) / Math.PI + (c >= 0 ? 0 : 180));
      let txt = tenir(nm, place(tx, ty, a) - 10, "t1");
      for (;;) {
        cs.push({
          lab: { x: rd(tx), y: rd(ty), anc: c >= 0 ? "start" : "end", rot, txt },
          bs: boitesRadiales(tx, ty, a, largeur(txt, "t1")),
        });
        if (txt.length <= 6) break;
        txt = couper(nm, txt.length - 2);
      }
    } else {
      const anc: Etiquette["anc"] = c > 0 ? "start" : "end";
      const lx = n.x + (n.z + 6) * (anc === "start" ? 1 : -1);
      let txt = tenir(nm, room(lx, anc), "t1");
      for (;;) {
        cs.push(horiz(lx, n.y + 4, anc, txt, "t1"));
        if (txt.length <= 6) break;
        txt = couper(nm, txt.length - 2);
      }
    }
    choisir(n, cs);
  }
}

/** Angles on a circle pushed apart until two neighbours are `d` apart at least. */
export function ecarter(angles: Map<string, number>, d: number): void {
  const ks = [...angles.keys()];
  if (ks.length < 2 || ks.length * d >= 2 * Math.PI) return;
  for (let it = 0; it < 80; it++) {
    ks.sort((a, b) => (angles.get(a) as number) - (angles.get(b) as number));
    let moved = false;
    for (let i = 0; i < ks.length; i++) {
      const a = ks[i];
      const b = ks[(i + 1) % ks.length];
      const va = angles.get(a) as number;
      let vb = angles.get(b) as number;
      if (i === ks.length - 1) vb += 2 * Math.PI;
      const gap = vb - va;
      if (gap < d - 1e-6) {
        const push = (d - gap) / 2;
        angles.set(a, va - push);
        angles.set(b, (angles.get(b) as number) + push);
        moved = true;
      }
    }
    if (!moved) return;
  }
}

// --- the table view and the export -----------------------------------------------------------------

/** A row of the table view: a second-circle node, its edge to each first-circle node drawn (null:
 * none), the number of first-circle nodes it works with in all. */
export type LigneT = { id: string; n: number; max: number; cells: (Lien | null)[]; pont: boolean };

/** The table view (Graphe-grammaire, « Vue tableau »): one row per second-circle node linked to a
 * column, one column per first-circle node drawn; the shared ones first, then by money. */
export function tableau(v: Voisinage, colonnes: string[]): LigneT[] {
  const set = new Set(colonnes);
  return v.seconds
    .filter((s) => [...s.liens.keys()].some((k) => set.has(k)))
    .map((s) => ({
      id: s.id,
      n: s.liens.size,
      max: plusGros(s, set),
      cells: colonnes.map((k) => s.liens.get(k) ?? null),
      pont: s.liens.size > 1,
    }))
    .sort((a, b) => b.n - a.n || b.max - a.max || (a.id < b.id ? -1 : 1));
}

/** A dot's diameter in the table (the board's): 8 to 24 px, by the square root of the money. */
export const point = (m: number, mx: number): number =>
  Math.round(8 + 16 * Math.sqrt(mx > 0 ? m / mx : 0));

const sansFormule = (v: unknown): string => {
  const s = String(v ?? "");
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
};

/** The neighbourhood's edges as CSV: the centre's (circle 1), then the first circle's with the
 * second (circle 2), each once; the heads in the catalogue's words. */
export function csvGraphe(
  v: Voisinage,
  tetes: string[],
  nomA: (s: string) => string,
  nomE: (s: string) => string,
): string {
  const q = (x: unknown) =>
    `"${(typeof x === "number" ? String(x) : sansFormule(x)).replace(/"/g, '""')}"`;
  const ligne = (cercle: number, a: string, e: string, l: Lien) =>
    [cercle, a, nomA(a), e, nomE(e), l.m, l.n].map(q).join(",");
  const ae = (x: string, y: string): [string, string] => (v.role === "a" ? [x, y] : [y, x]);
  const out = [tetes.map(q).join(",")];
  for (const p of v.premiers) out.push(ligne(1, ...ae(v.centre, p.id), p));
  for (const s of [...v.seconds].sort((a, b) => (a.id < b.id ? -1 : 1)))
    for (const p of v.premiers) {
      const l = s.liens.get(p.id);
      if (l) out.push(ligne(2, ...ae(p.id, s.id), l));
    }
  return `﻿${out.join("\r\n")}\r\n`;
}

/** The most connected, for the graph's page without a centre: the SIRENs with the most partners
 * in a role. */
export function plusRelies(I: Index, r: Role, n: number): { id: string; d: number }[] {
  return [...(r === "a" ? I.a : I.e)]
    .map(([id, m]) => ({ id, d: m.size }))
    .sort((a, b) => b.d - a.d || (a.id < b.id ? -1 : 1))
    .slice(0, n);
}
