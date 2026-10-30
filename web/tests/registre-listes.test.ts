// The register's lists and its summary's search (src/registre/listes.ts) on SYNTHETIC data shaped
// as the build writes listes.json and couverture.json, and as the search API answers: made-up
// communes, buyers, companies and documents, no source's data. A list of names filters, sorts and
// counts its rows, each filter's counts leaving its own filter out; a list of documents asks the
// API for its state; the state is in the address and back; the old addresses open their list.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { Lexique } from "../src/registre/corpus.ts";
import { richText } from "../src/registre/dc.ts";
import { EI, type Evenement } from "../src/registre/donnees.ts";
import { setMessages } from "../src/registre/i18n.ts";
import {
  adresse,
  appliquer,
  chercherDocuments,
  chercherNoms,
  comptesPage,
  corpus,
  type CouvertureX,
  csv,
  DEFS,
  etatDe,
  grouper,
  type Listes,
  listeHref,
  type Page,
  question,
  rangDocument,
  rangs,
  redirection,
  toutDemander,
} from "../src/registre/listes.ts";
import { route } from "../src/registre/routes.ts";

const catalogue: Record<string, string> = JSON.parse(
  readFileSync(new URL("../src/locales/fr.json", import.meta.url), "utf8"),
);
setMessages(Object.fromEntries(Object.entries(catalogue).filter(([k]) => k.startsWith("registre."))));

const doc = (x: Partial<Evenement> & { id: string; t: string }): Evenement =>
  ({ affaire: x.id.split("~")[0], ...x }) as Evenement;

/** SYNTHETIC: two communes of the Rhône in one intercommunality that buys, one of the Essonne; every
 * name with its fiche's reference, as the build writes them (a sole trader none). */
const L = {
  communes: {
    "69001": { nom: "Alphaville", dep: "69", epci: "200000001", ref: "commune/69001" },
    "69002": { nom: "Betaville", dep: "69", epci: "200000001", ref: "commune/69002" },
    "91001": { nom: "Gammaville", dep: "91", epci: "200000002", ref: "commune/91001" },
  },
  acheteurs: {
    "216900011": { nom: "Commune d'Alphaville", categorie: "commune", insee_siege: "69001", dep: "69", ref: "acheteur/216900011" },
    "200000001": { nom: "Métropole Alpha", categorie: "metropole", dep: "69", ref: "acheteur/200000001" },
    "130000001": { nom: "Préfecture Alpha", categorie: "etat", dep: "69", ref: "acheteur/130000001" },
    "300000001": { nom: "Habitat Gamma", categorie: "bailleur", dep: "91", ref: "acheteur/300000001" },
    "400000001": { nom: "Hôpital Beta", categorie: "sante", dep: "69", ref: "acheteur/400000001" },
    "500000001": {},
  },
  entreprises: {
    "100000001": { nom: "ACME VIDEO", naf_libelle: "Installation", ref: "entreprise/100000001" },
    "100000002": { nom: "OMEGA SURVEILLANCE", ref: "entreprise/100000002" },
    [EI]: { nom: null, entrepreneur_individuel: true },
  },
  affaires: {},
} as unknown as Lexique;

/** SYNTHETIC: the documents those names come from (the API's pages serve them). */
const DOCS = [
  doc({ id: "c1~0", t: "attribution", date: "2024-03-01", insee: "69001", dep: "69", acheteur_siren: "216900011", entreprises: ["100000001"], montant: 1000, compte: true, objet: "VIDEOPROTECTION" }),
  doc({ id: "c2~0", t: "attribution", date: "2025-06-01", insee: "91001", dep: "91", acheteur_siren: "300000001", entreprises: ["100000001", EI], montant: 5000, compte: true, objet: "CAMERAS" }),
  doc({ id: "c3~0", t: "attribution", date: "2023-01-10", insee: "69002", dep: "69", acheteur_siren: "200000001", entreprises: ["100000002"], montant: 9000, compte: true, objet: "CENTRE DE SUPERVISION", dispositif: "csu" }),
  doc({ id: "a1~0", t: "arrete", date: "2025-02-02", insee: "69001", dep: "69", cameras: 8, beneficiaire: "Commune d'Alphaville" }),
  doc({ id: "a2~0", t: "arrete_drone", date: "2026-01-05", insee: "69002", dep: "69", partage: ["69001"], beneficiaire: "Police nationale" }),
];

/** SYNTHETIC listes.json: the build's rows for those documents (a copy of c1~0 counted once). */
const X = {
  v: 1,
  maj: "2026-10-23",
  lignes: {
    communes: {
      "69001": { docs: 4, con: 2, cam: 1, dr: 1, carte: 12 },
      "69002": { docs: 2, con: 1, cam: 0, dr: 1, carte: null },
      "91001": { docs: 2, con: 1, cam: 0, dr: 0, carte: null },
    },
    acheteurs: {
      "216900011": { n: 1, amt: 1000, ents: 1, centrale: false },
      "300000001": { n: 1, amt: 5000, ents: 1, centrale: false },
      "200000001": { n: 1, amt: 9000, ents: 1, centrale: false },
    },
    entreprises: {
      "100000001": { n: 2, clientes: 2, amt: 6000, y0: "2024", deps: { "69": 1, "91": 1 } },
      "100000002": { n: 1, clientes: 1, amt: 9000, y0: "2023", deps: { "69": 1 } },
    },
    departements: {
      "69": { n: 5, con: 2, aut: 2, amt: 10000 },
      "91": { n: 2, con: 1, aut: 0, amt: 5000 },
    },
  },
  comptes: {
    listes: {
      communes: 3, intercommunalites: 2, departements: 2, acheteurs: 3, entreprises: 2,
      contrats: 4, modifications: 0, "appels-d-offres": 0, arretes: 2, subventions: 1,
    },
    categories: { etat: 1, bailleur: 1, transports: 0, autres: 1 },
  },
  dico: L,
} as unknown as Listes;

const couverture = {
  maj: "2026-10-23",
  sources: [],
  non_lus: {},
  departements: {
    "69": { etat: "collecte", nom: "Rhône", dernier_recueil: "2026-10-21" },
    "91": { etat: "impossible", nom: "Essonne", raison: "ferme_aux_robots" },
  },
} as unknown as CouvertureX;

const C = corpus(X, couverture);

/** A page of the search API as it answers (pipeline/lacarte/api/registre.py). */
const page = (evenements: Evenement[], over: Partial<Page> = {}): Page => ({
  total: evenements.length,
  page: 1,
  n: 20,
  facettes: { t: {}, d: {}, p: {}, y: {} },
  par_type: {},
  evenements,
  dico: L,
  ...over,
});
const repond = (f: (u: URL) => unknown) =>
  (async (u: string | URL) =>
    new Response(JSON.stringify(f(new URL(String(u), "http://x"))), {
      headers: { "content-type": "application/json" },
    })) as typeof fetch;

test("each list of names' rows, by the old ranking's rules", () => {
  // each list as many rows as the build counts
  for (const l of ["communes", "intercommunalites", "departements", "acheteurs", "entreprises"] as const)
    assert.equal(rangs(C, l).length, X.comptes.listes[l], l);

  const acme = rangs(C, "entreprises").find((r) => r.id === "100000001");
  assert.ok(acme);
  assert.equal(acme.v.n, 2);
  assert.equal(acme.v.amt, 6000);
  assert.equal(acme.v.cl, 2);
  assert.deepEqual(acme.deps, ["69", "91"]);
  assert.equal(acme.nom, "Acme Video");

  // an uncollected département shows no decree figure
  const alpha = rangs(C, "communes").find((r) => r.id === "69001");
  assert.equal(alpha?.v.docs, 4);
  assert.equal(alpha?.v.dr, 1);
  assert.equal(alpha?.v.carte, 12);
  const gamma = rangs(C, "communes").find((r) => r.id === "91001");
  assert.equal(gamma?.v.aut, -1);
  assert.equal(richText(gamma?.cells[2]), "—");

  // an intercommunality that buys has its name and its buyer's fiche; one that does not, its SIREN
  const epci = rangs(C, "intercommunalites");
  const metro = epci.find((r) => r.id === "200000001");
  assert.equal(metro?.nom, "Métropole Alpha");
  assert.equal(metro?.v.communes, 2);
  assert.equal(metro?.v.con, 1);
  assert.ok(JSON.stringify(metro?.lien).includes("/registre/acheteur/200000001"));
  const sans = epci.find((r) => r.id === "200000002");
  assert.ok(sans?.nom.includes("200000002"));
  assert.ok(!JSON.stringify(sans?.lien).includes("href"));

  const rh = rangs(C, "departements").find((r) => r.id === "69");
  assert.equal(rh?.v.docs, 5);
  assert.equal(rh?.v.con, 2);
  assert.equal(rh?.v.amt, 10000);
  // a list of documents has no rows of its own: the API's
  assert.deepEqual(rangs(C, "contrats"), []);
});

test("every name is a typed link, the pictogram alone; a name without its fiche is words", () => {
  const docs = DOCS.map((e) => rangDocument(L, C, e));
  for (const r of [...rangs(C, "communes"), ...rangs(C, "acheteurs"), ...rangs(C, "entreprises"), ...docs]) {
    const a = (r.lien as { a?: { cls: string; c: string; i: string } }).a;
    assert.ok(a, r.id);
    assert.equal(a.cls, "rl");
    assert.match(a.c, /^var\(--type-/);
  }
  // a decree's beneficiary is words, never a link (a private person may be named there)
  const drone = docs.find((r) => r.id === "a2~0");
  assert.ok(!JSON.stringify(drone?.cells[1]).includes('"a"'));
  // a commune the build wrote no fiche for (no reference): its name, not a link
  const sansFiche = { ...L, communes: { ...L.communes, "69001": { nom: "Alphaville", dep: "69" } } } as Lexique;
  const c1 = rangDocument(sansFiche, C, DOCS[0]);
  assert.ok(!JSON.stringify(c1.cells[0]).includes("/registre/commune/69001"));
});

test("a filter's counts leave out its own filter; the sort and the words", () => {
  const def = DEFS.entreprises;
  const all = rangs(C, "entreprises");
  const e = etatDe(def, { dep: "91" });
  const { list, comptes: c } = appliquer(def, all, e);
  assert.deepEqual(
    list.map((r) => r.id),
    ["100000001"],
  );
  // « Partout » and each département counted as if no département were picked
  assert.equal(c.dep?.[""], 2);
  assert.equal(c.dep?.["69"], 2);
  assert.equal(c.dep?.["91"], 1);
  // the words narrow every count
  const q = appliquer(def, all, etatDe(def, { q: "omega" }));
  assert.equal(q.list.length, 1);
  assert.equal(q.comptes.dep?.[""], 1);
  assert.equal(q.comptes.dep?.["91"], undefined);
  // by amount, the largest first; by name, A first
  const amt = appliquer(def, all, etatDe(def, { tri: "amt" })).list.map((r) => r.id);
  assert.deepEqual(amt, ["100000002", "100000001"]);
  const nom = appliquer(def, all, etatDe(def, { tri: "nom" })).list.map((r) => r.id);
  assert.deepEqual(nom, ["100000001", "100000002"]);
});

test("a list of documents asks the API for its state, its counts the API's facets", () => {
  const def = DEFS.contrats;
  const e = etatDe(def, { disp: "csu", dep: "69", q: "  vidéo ", tri: "amt", ordre: "asc" });
  assert.equal(
    question(def, e, 2, 20).toString(),
    "q=vid%C3%A9o&t=con&d=69&p=csu&tri=montant&ordre=asc&page=2&n=20",
  );
  assert.equal(question(DEFS.arretes, etatDe(DEFS.arretes, {}), 1, 20).toString(), "t=aut&page=1&n=20");
  // each filter's values as the API counts them without that filter; « every value »: their sum
  // when the filter is set, the selection's total when it is not
  const P = page([DOCS[2]], { total: 1, facettes: { t: {}, d: { "69": 1, "91": 0 }, p: { csu: 1, na: 3 }, y: {} } });
  const c = comptesPage(def, P, etatDe(def, { disp: "csu" }));
  assert.deepEqual(c.disp, { csu: 1, na: 3, "": 4 });
  assert.equal(c.dep?.[""], 1);
});

test("the CSV of a list of documents is every page of its state", async () => {
  const asked: string[] = [];
  const many = Array.from({ length: 501 }, (_, i) => doc({ id: `x${i}~0`, t: "attribution", date: "2024-01-01", insee: "69001", dep: "69" }));
  const rows = await toutDemander(DEFS.contrats, etatDe(DEFS.contrats, {}), C, 20_000, repond((u) => {
    asked.push(u.searchParams.get("page") ?? "");
    const p = Number(u.searchParams.get("page"));
    return page(many.slice((p - 1) * 500, p * 500), { total: 501 });
  }));
  assert.equal(rows.length, 501);
  assert.deepEqual(asked, ["1", "2"]);
});

test("the state is in the address, and back", () => {
  const def = DEFS.entreprises;
  assert.equal(adresse(def, etatDe(def, {})), "/registre/entreprises");
  const e = etatDe(def, { tri: "amt", ordre: "asc", dep: "69", q: "acme", inconnu: "x" });
  assert.equal(adresse(def, e), "/registre/entreprises?tri=amt&ordre=asc&dep=69&q=acme");
  // a value the list does not know is dropped; every département of France is one
  assert.deepEqual(etatDe(def, { dep: "zz", tri: "foo", cat: "etat" }).f, {});
  assert.deepEqual(etatDe(def, { dep: "2A" }).f, { dep: "2A" });
  assert.deepEqual(etatDe(def, { dep: "33" }).f, { dep: "33" });
  assert.deepEqual(etatDe(DEFS.acheteurs, { cat: "etat" }).f, { cat: "etat" });
  // the list's own order needs no word in the address
  assert.equal(adresse(def, etatDe(def, { tri: "y" })), "/registre/entreprises?tri=y");
});

test("the CSV is the list shown, its heads in the catalogue's words", () => {
  const def = DEFS.entreprises;
  const { list } = appliquer(def, rangs(C, "entreprises"), etatDe(def, { tri: "nom" }));
  const text = csv(def, list);
  const [head, first] = text.replace(/^﻿/, "").split("\r\n");
  assert.equal(head.split(",")[0], '"rang"');
  assert.ok(head.includes('"Entreprise"'));
  assert.ok(head.includes('"montant prévu (euros)"'));
  assert.match(first, /^"1","Acme Video","100000001","Installation","69 91","2","2","6000","2024"$/);
  // an amount to the cent, whatever the sum's floats say
  const r = { ...list[0], csv: { ...list[0].csv, montant: 91437049.75000001 } };
  assert.ok(csv(def, [r]).includes('"91437049.75"'));
});

test("the lists' addresses, and the old ones", () => {
  assert.equal(listeHref("entreprise"), "/registre/entreprises");
  assert.equal(listeHref("aut"), "/registre/arretes");
  assert.equal(listeHref("ao"), "/registre/appels-d-offres");
  assert.equal(listeHref("registre"), "/registre/");
  assert.deepEqual(route("/registre/arretes", "?dep=69"), { view: "liste", liste: "arretes", q: { dep: "69" } });
  assert.deepEqual(route("/registre/arretes/x"), { view: "introuvable" });

  const r = (path: string, search = "") => redirection(route(path, search));
  assert.equal(r("/registre/chiffres"), "/registre/entreprises");
  // the summary's own search stays
  assert.equal(r("/registre/", "?q=mions"), null);
  assert.equal(r("/registre/"), null);
  assert.equal(r("/registre/", "?t=aut&d=69&q=drone"), "/registre/arretes?dep=69&q=drone");
  assert.equal(r("/registre/", "?t=con,aut&y=2024&tri=montant"), "/registre/contrats?tri=amt&annee=2024");
  // without a kind, the contracts; a dispositif the list knows
  assert.equal(r("/registre/", "?p=csu"), "/registre/contrats?disp=csu");
  // the pilot's « Autres » (xx) is no département any more: dropped
  assert.equal(r("/registre/", "?d=xx&t=aut"), "/registre/arretes");
  // a calls for tenders' list has no dispositif filter
  assert.equal(r("/registre/", "?t=ao&p=vp"), "/registre/appels-d-offres");
});

test("the search: names by type, a commune whose name starts so first, each with its fiche", () => {
  const g = grouper(chercherNoms(C, "alpha"), "alpha");
  assert.deepEqual(
    g.map((x) => x.k),
    ["commune", "epci", "acheteur"],
  );
  assert.equal(g[0].rows[0].nom, "Alphaville");
  assert.equal(g[0].rows[0].href, "/registre/commune/69001");
  assert.equal(g[1].rows[0].href, "/registre/acheteur/200000001");
  assert.equal(g[0].tout, "/registre/communes?q=alpha");
  // a sole trader is never a result; a name without its fiche neither
  assert.deepEqual(chercherNoms(C, "individuelle"), []);
  const sansFiche = corpus({ ...X, dico: { ...L, communes: { ...L.communes, "69001": { nom: "Alphaville", dep: "69" } } } } as Listes, couverture);
  assert.ok(!chercherNoms(sansFiche, "alphaville").some((x) => x.type === "commune"));
  assert.deepEqual(chercherNoms(C, "a"), []);
});

test("the search: the documents by kind, through the API; none when it does not answer", async () => {
  const asked: string[] = [];
  const groups = await chercherDocuments("alpha", C, 4, repond((u) => {
    asked.push(u.search);
    const t = u.searchParams.get("t");
    if (!t) return page([], { total: 3, par_type: { con: 2, aut: 1 } });
    return page(DOCS.filter((e) => (t === "con" ? e.t === "attribution" : e.t.startsWith("arrete"))).slice(0, 1));
  }));
  assert.deepEqual(
    groups?.map((g) => [g.k, g.n, g.rows.length]),
    [["con", 2, 1], ["aut", 1, 1]],
  );
  assert.equal(groups?.[0].tout, "/registre/contrats?q=alpha");
  assert.equal(groups?.[0].rows[0].href, "/registre/contrat/c1");
  assert.deepEqual(asked, ["?q=alpha&n=1", "?q=alpha&t=con&n=4", "?q=alpha&t=aut&n=4"]);
  // the dev server's page (HTML) is no API
  const html = (async () => new Response("<!doctype html>", { headers: { "content-type": "text/html" } })) as typeof fetch;
  assert.equal(await chercherDocuments("alpha", C, 4, html), null);
});

test("a published text a spreadsheet would read as a formula stays text in the CSV", async () => {
  const { sansFormule } = await import("../src/registre/listes.ts");
  assert.equal(sansFormule('=HYPERLINK("http://x","clic")'), `'=HYPERLINK("http://x","clic")`);
  for (const s of ["+1", "-1", "@SUM(1+1)", "\tx", "\rx"]) assert.equal(sansFormule(s), `'${s}`);
  assert.equal(sansFormule("Vidéoprotection - lot 2"), "Vidéoprotection - lot 2");
  assert.equal(sansFormule(null), "");
});
