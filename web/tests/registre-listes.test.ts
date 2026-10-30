// The register's lists and its summary's search (src/registre/listes.ts) on a SYNTHETIC corpus
// shaped as the build writes recherche.json and couverture.json: made-up communes, buyers,
// companies and documents, no source's data. A list's count is its rows; a filter's counts leave
// its own filter out; the state is in the address and back; the old addresses open their list.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { Recherche } from "../src/registre/corpus.ts";
import { richText } from "../src/registre/dc.ts";
import { EI, type Evenement } from "../src/registre/donnees.ts";
import { setMessages } from "../src/registre/i18n.ts";
import {
  adresse,
  appliquer,
  chercherApi,
  chercherLocal,
  comptes,
  corpus,
  type CouvertureX,
  csv,
  DEFS,
  etatDe,
  grouper,
  listeHref,
  rangs,
  redirection,
} from "../src/registre/listes.ts";
import { route } from "../src/registre/routes.ts";

const catalogue: Record<string, string> = JSON.parse(
  readFileSync(new URL("../src/locales/fr.json", import.meta.url), "utf8"),
);
setMessages(Object.fromEntries(Object.entries(catalogue).filter(([k]) => k.startsWith("registre."))));

const doc = (x: Partial<Evenement> & { id: string; t: string }): Evenement =>
  ({ affaire: x.id.split("~")[0], ...x }) as Evenement;

/** SYNTHETIC: two communes of the Rhône in one intercommunality that buys, one of the Essonne. */
const R = {
  v: 1,
  communes: {
    "69001": { nom: "Alphaville", dep: "69", epci: "200000001", carte: 12 },
    "69002": { nom: "Betaville", dep: "69", epci: "200000001" },
    "91001": { nom: "Gammaville", dep: "91", epci: "200000002" },
  },
  acheteurs: {
    "216900011": { nom: "Commune d'Alphaville", categorie: "commune", insee_siege: "69001", dep: "69" },
    "200000001": { nom: "Métropole Alpha", categorie: "metropole", dep: "69" },
    "130000001": { nom: "Préfecture Alpha", categorie: "etat", dep: "69" },
    "300000001": { nom: "Habitat Gamma", categorie: "bailleur", dep: "91" },
    "400000001": { nom: "Hôpital Beta", categorie: "sante", dep: "69" },
    "500000001": {},
  },
  entreprises: {
    "100000001": { nom: "ACME VIDEO", naf_libelle: "Installation" },
    "100000002": { nom: "OMEGA SURVEILLANCE" },
    [EI]: { nom: null, entrepreneur_individuel: true },
  },
  affaires: {},
  evenements: [
    doc({ id: "c1~0", t: "attribution", date: "2024-03-01", insee: "69001", dep: "69", acheteur_siren: "216900011", entreprises: ["100000001"], montant: 1000, compte: true, objet: "VIDEOPROTECTION" }),
    // the same contract published twice: counted once
    doc({ id: "c1~1", t: "attribution", date: "2024-03-01", insee: "69001", dep: "69", acheteur_siren: "216900011", entreprises: ["100000001"], montant: 1000, copie: true }),
    doc({ id: "c2~0", t: "attribution", date: "2025-06-01", insee: "91001", dep: "91", acheteur_siren: "300000001", entreprises: ["100000001", EI], montant: 5000, compte: true, objet: "CAMERAS" }),
    doc({ id: "c3~0", t: "attribution", date: "2023-01-10", insee: "69002", dep: "69", acheteur_siren: "200000001", entreprises: ["100000002"], montant: 9000, compte: true, objet: "CENTRE DE SUPERVISION", dispositif: "csu" }),
    doc({ id: "a1~0", t: "arrete", date: "2025-02-02", insee: "69001", dep: "69", cameras: 8, beneficiaire: "Commune d'Alphaville" }),
    doc({ id: "a2~0", t: "arrete_drone", date: "2026-01-05", insee: "69002", dep: "69", partage: ["69001"], beneficiaire: "Police nationale" }),
    doc({ id: "s1~0", t: "subvention_region", date: "2024-01-01", date_annee: true, insee: "91001", dep: "91", montant: 300, beneficiaire: "GAMMAVILLE" }),
  ],
} as unknown as Recherche;

const couverture = {
  maj: "2026-10-23",
  sources: [],
  non_lus: {},
  departements: {
    "69": { etat: "collecte", nom: "Rhône", dernier_recueil: "2026-10-21" },
    "91": { etat: "impossible", nom: "Essonne", raison: "ferme_aux_robots" },
  },
} as unknown as CouvertureX;

const C = corpus(R, couverture, "2026-10-23");

test("each list's rows, by the old ranking's rules", () => {
  const n = comptes(C);
  assert.equal(n.listes.communes, 3);
  assert.equal(n.listes.intercommunalites, 2);
  assert.equal(n.listes.departements, 2);
  // a commune and a métropole are territories, an unnamed entry is in no category
  assert.equal(n.listes.acheteurs, 3);
  assert.deepEqual(n.categories, { etat: 1, bailleur: 1, transports: 0, autres: 1 });
  // a sole trader is never in the list
  assert.equal(n.listes.entreprises, 2);
  assert.equal(n.listes.contrats, 4);
  assert.equal(n.listes.arretes, 2);
  assert.equal(n.listes.subventions, 1);

  const acme = rangs(C, "entreprises").find((r) => r.id === "100000001");
  assert.ok(acme);
  // the copy counts once; the amounts the build counts
  assert.equal(acme.v.n, 2);
  assert.equal(acme.v.amt, 6000);
  assert.equal(acme.v.cl, 2);
  assert.deepEqual(acme.deps, ["69", "91"]);
  assert.equal(acme.nom, "Acme Video");

  // a shared decree counts in each commune; an uncollected département shows no decree figure
  const alpha = rangs(C, "communes").find((r) => r.id === "69001");
  assert.equal(alpha?.v.docs, 4);
  assert.equal(alpha?.v.dr, 1);
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

  // a département: its documents, its contracts (a copy once), its counted amount
  const rh = rangs(C, "departements").find((r) => r.id === "69");
  assert.equal(rh?.v.docs, 5);
  assert.equal(rh?.v.con, 2);
  assert.equal(rh?.v.amt, 10000);
});

test("every name is a typed link, the pictogram alone", () => {
  for (const l of ["communes", "acheteurs", "entreprises", "contrats", "arretes"] as const)
    for (const r of rangs(C, l)) {
      const a = (r.lien as { a?: { cls: string; c: string; i: string } }).a;
      assert.ok(a, `${l} ${r.id}`);
      assert.equal(a.cls, "rl");
      assert.match(a.c, /^var\(--type-/);
    }
  // a decree's beneficiary is words, never a link (a private person may be named there)
  const drone = rangs(C, "arretes").find((r) => r.id === "a2~0");
  assert.ok(!JSON.stringify(drone?.cells[1]).includes('"a"'));
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

  const docs = appliquer(DEFS.contrats, rangs(C, "contrats"), etatDe(DEFS.contrats, { disp: "csu" }));
  assert.deepEqual(
    docs.list.map((r) => r.id),
    ["c3~0"],
  );
  // the other contracts publish no dispositif
  assert.equal(docs.comptes.disp?.na, 3);
});

test("the state is in the address, and back", () => {
  const def = DEFS.entreprises;
  assert.equal(adresse(def, etatDe(def, {})), "/registre/entreprises");
  const e = etatDe(def, { tri: "amt", ordre: "asc", dep: "69", q: "acme", inconnu: "x" });
  assert.equal(adresse(def, e), "/registre/entreprises?tri=amt&ordre=asc&dep=69&q=acme");
  // a value the list does not know is dropped
  assert.deepEqual(etatDe(def, { dep: "zz", tri: "foo", cat: "etat" }).f, {});
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
  assert.equal(r("/registre/", "?d=xx&t=aut"), "/registre/arretes?dep=xx");
  // a calls for tenders' list has no dispositif filter
  assert.equal(r("/registre/", "?t=ao&p=vp"), "/registre/appels-d-offres");
});

test("the search: by type, a commune whose name starts so first, each with its list", () => {
  const res = chercherLocal(C, "alpha");
  const g = grouper(res, "alpha");
  assert.deepEqual(
    g.map((x) => x.k),
    ["commune", "epci", "acheteur", "con", "aut"],
  );
  assert.equal(g[0].rows[0].nom, "Alphaville");
  assert.equal(g[0].rows[0].href, "/registre/commune/69001");
  assert.equal(g[1].rows[0].href, "/registre/acheteur/200000001");
  assert.equal(g[0].tout, "/registre/communes?q=alpha");
  // a sole trader is never a result (its contract is, by its words)
  assert.deepEqual(
    chercherLocal(C, "individuelle").map((x) => x.type),
    ["con"],
  );
  assert.deepEqual(chercherLocal(C, "a"), []);
});

test("the API, when it answers as such; else none is asked again", async () => {
  const json = (body: unknown, type = "application/json") =>
    (async () => new Response(JSON.stringify(body), { headers: { "content-type": type } })) as typeof fetch;
  const ok = await chercherApi(
    "acme",
    json({
      resultats: [
        { type: "entreprise", id: "1", nom: "Acme", detail: "", href: "/registre/entreprise/100000001" },
        { type: "entreprise", id: "2", nom: "Ailleurs", detail: "", href: "https://example.org/" },
        { type: "inconnu", id: "3", nom: "X", detail: "", href: "/registre/" },
      ],
    }),
  );
  assert.deepEqual(
    ok?.map((x) => x.nom),
    ["Acme"],
  );
  // the dev server's page (HTML) is no API
  assert.equal(await chercherApi("acme", json("<!doctype html>", "text/html")), null);
  let asked = false;
  const after = await chercherApi("acme", (async () => {
    asked = true;
    return new Response("{}");
  }) as typeof fetch);
  assert.equal(after, null);
  assert.equal(asked, false);
});
