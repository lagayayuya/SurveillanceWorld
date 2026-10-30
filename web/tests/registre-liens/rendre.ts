// Every mention that has its fiche is a link (design/registre/v2, the owner's rule, « partout et sans
// exception »): each register path given is rendered once by its view (dc.ts rendre, no browser) on
// the files of a build (a site directory, as `lacarte-registre construire` writes it), then every
// text outside a link is searched for the name of a fiche the build holds — a commune, a
// département, a buyer, a company. Printed as JSON, one record per path: its view, how many texts
// were read, the names found unlinked with their text. tests/test_registre_liens.py runs it on the
// fixture's build and fails on any.
//
// usage, from web/: node --experimental-strip-types --import ./tests/registre-liens/enregistrer.mjs
//                   tests/registre-liens/rendre.ts <site dir> <path>...
//
// Not a mention: the fiche's own name (its h1, its band), a control's words (a button, an option, a
// field), what is hidden from everyone (aria-hidden: the cut-out letters, the pictograms), and what
// a template marks `data-mention="non"`: a source's name (« Arrêtés du Rhône » names a publication,
// not the département's fiche).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import catalogue from "virtual:registre-catalogue";

const [site, ...paths] = process.argv.slice(2);

// --- what the views need of a browser ---------------------------------------------------------
// a file of /data/registre/ is the build's
globalThis.fetch = (async (u: string | URL) => {
  const file = decodeURIComponent(String(u).replace(/^\/data\/registre\//, "").split("?")[0]);
  try {
    return new Response(readFileSync(join(site, file)), { status: 200 });
  } catch {
    return new Response("", { status: 404, statusText: "Not Found" });
  }
}) as typeof fetch;
// a wide screen; no document beyond what a module touches when it is imported
(globalThis as Record<string, unknown>).matchMedia = (q: string) => ({
  matches: /min-width: 960px/.test(q),
  addEventListener() {},
  removeEventListener() {},
});
(globalThis as Record<string, unknown>).document = {
  addEventListener() {},
  removeEventListener() {},
  querySelector: () => null,
  querySelectorAll: () => [],
  getElementById: () => null,
};
(globalThis as Record<string, unknown>).addEventListener = () => {};
// a page that is another's (a commune buyer, a decree with a commune) replaces its address: noted,
// and that page is checked by its own path
let ailleurs = "";
(globalThis as Record<string, unknown>).history = {
  replaceState(_s: unknown, _t: string, u: string) {
    ailleurs = String(u);
  },
  pushState() {},
};
(globalThis as Record<string, unknown>).dispatchEvent = () => true;
const g = globalThis as Record<string, unknown>;

const { render } = await import("../../src/messages.ts");
const { parseParts, rendre } = await import("../../src/registre/dc.ts");
type Rendu = import("../../src/registre/dc.ts").Rendu;
const { setMessages } = await import("../../src/registre/i18n.ts");
const { setWords } = await import("../../src/registre/vue.ts");
const { route } = await import("../../src/registre/routes.ts");
const { Absent } = await import("../../src/registre/donnees.ts");
const { buyerNom, depNom, entName } = await import("../../src/registre/corpus.ts");
setMessages(catalogue);
setWords(catalogue);

const SRC = new URL("../../src/registre/vues/", import.meta.url);
const parts = parseParts(readFileSync(new URL("socle.html", SRC), "utf8"));
const FORMATS = JSON.parse(readFileSync(new URL("formats.json", SRC), "utf8")) as Record<
  string,
  Record<string, string>
>;
const format = (key: string, read: (path: string) => unknown) => {
  const message = (catalogue as Record<string, string>)[`registre.${key}`];
  if (message === undefined) return `registre.${key}`;
  const params: Record<string, string | number> = {};
  for (const [name, path] of Object.entries(FORMATS[key] ?? {})) {
    const v = read(path);
    params[name] = typeof v === "number" ? v : v == null ? "" : String(v);
  }
  return render(message, params);
};

// --- the names of the fiches the build holds ---------------------------------------------------
type Dico = {
  entreprises: Record<string, { nom?: string | null; entrepreneur_individuel?: boolean }>;
  acheteurs: Record<string, { nom?: string; categorie?: string; insee_siege?: string | null }>;
  communes: Record<string, { nom: string; dep: string }>;
};
// the whole lexicon (recherche.json): every buyer, company and commune of the register
const L = JSON.parse(readFileSync(join(site, "recherche.json"), "utf8")) as Dico;
const noms = new Map<string, string>();
const ajoute = (nom: string | undefined | null, quoi: string) => {
  // a name of two letters or less is a word of every sentence
  if (nom && nom.trim().length > 2) noms.set(nom.trim(), quoi);
};
for (const [insee, c] of Object.entries(L.communes)) {
  ajoute(c.nom, `commune ${insee}`);
  ajoute(depNom(c.dep), `département ${c.dep}`);
}
for (const [s, e] of Object.entries(L.entreprises))
  if (!e.entrepreneur_individuel) ajoute(entName(L, s), `entreprise ${s}`);
for (const s of Object.keys(L.acheteurs)) ajoute(buyerNom(L, s), `acheteur ${s}`);
// the longest first: « Commune de Lyon » before « Lyon »
const liste = [...noms.entries()].sort((a, b) => b[0].length - a[0].length);
const motif = (nom: string) =>
  new RegExp(`(?<![\\p{L}\\p{N}])${nom.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "u");
const motifs = liste.map(([nom, quoi]) => ({ nom, quoi, re: motif(nom) }));

const HORS = new Set(["a", "button", "option", "select", "textarea", "input", "title", "script", "style"]);

/** The texts outside a link and outside a control, each with the element that holds it. */
function textes(nodes: Rendu[], out: string[], dedans = false): void {
  // the texts of one element, joined: a name split by the template is read whole
  let suite = "";
  const flush = () => {
    if (suite.trim()) out.push(suite.replace(/\s+/g, " ").trim());
    suite = "";
  };
  for (const n of nodes) {
    if (typeof n === "string") {
      if (!dedans) suite += n;
      continue;
    }
    if (n.attrs["aria-hidden"] === "true" || n.attrs["data-mention"] === "non") continue;
    const tag = n.name.toLowerCase();
    if (tag === "strong" || tag === "em" || tag === "b" || tag === "span" || tag === "sup") {
      // inline: part of the same sentence
      const inner: string[] = [];
      textes(n.kids, inner, dedans || HORS.has(tag));
      suite += ` ${inner.join(" ")} `;
      continue;
    }
    flush();
    textes(n.kids, out, dedans || HORS.has(tag));
  }
  flush();
}

type Trouve = { nom: string; quoi: string; texte: string };
const resultats: { chemin: string; vue: string; textes: number; nonLies: Trouve[]; erreur?: string }[] = [];
for (const chemin of paths) {
  const [p, q = ""] = chemin.split("?");
  const r = route(p, q ? `?${q}` : "");
  g.location = { origin: "http://localhost", pathname: p, search: q ? `?${q}` : "", hash: "" };
  try {
    let m = (await import(`../../src/registre/vues/${r.view}.ts`)).default;
    let props: Record<string, unknown>;
    ailleurs = "";
    try {
      props = { ...r, ...(m.donnees ? await m.donnees(r) : {}) };
    } catch (e) {
      if (ailleurs) {
        resultats.push({ chemin, vue: "redirection", textes: 0, nonLies: [] });
        continue;
      }
      if (!(e instanceof Absent)) throw e;
      m = (await import("../../src/registre/vues/introuvable.ts")).default;
      props = { view: "introuvable" };
    }
    if (ailleurs) {
      resultats.push({ chemin, vue: "redirection", textes: 0, nonLies: [] });
      continue;
    }
    const { view, nodes } = rendre(m.Vue, props, m.template, { parts, format });
    // its own names: its title and its h1 (a page of a fiche, « Documents », names its fiche there)
    const propres = new Set([(view as { titre?(): string }).titre?.() ?? ""]);
    const h1 = (ns: Rendu[]): void => {
      for (const n of ns)
        if (typeof n !== "string") {
          if (n.name === "h1") propres.add(n.kids.filter((k) => typeof k === "string").join("").trim());
          h1(n.kids);
        }
    };
    h1(nodes);
    const lus: string[] = [];
    textes(nodes, lus);
    const nonLies: Trouve[] = [];
    for (const texte of lus) {
      let reste = texte;
      for (const { nom, quoi, re } of motifs) {
        if (!re.test(reste)) continue;
        // its own name is not a mention (its h1, its band); it hides no shorter name either
        if (!propres.has(nom)) nonLies.push({ nom, quoi, texte: texte.slice(0, 160) });
        reste = reste.replace(new RegExp(re.source, "gu"), " ");
      }
    }
    resultats.push({ chemin, vue: r.view, textes: lus.length, nonLies });
  } catch (e) {
    resultats.push({ chemin, vue: r.view, textes: 0, nonLies: [], erreur: String(e) });
  }
}
process.stdout.write(`${JSON.stringify(resultats, null, 1)}\n`);
