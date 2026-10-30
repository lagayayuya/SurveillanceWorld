// A commune's family of pages on the v2 skeleton (src/registre/vues/commune-outils.ts) on a SYNTHETIC
// file shaped as the build writes commune/<insee>.json: made-up communes, buyers, companies and
// documents, no source's data. The identity line links the département and the intercommunality;
// the band's other pages are « Fiche » and « Carte et drones »; the breadcrumb ends on the commune;
// every name with a fiche is a typed link, the commune's own name not on its own fiche, a sole trader
// never.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Donnees, type FichierCommune } from "../src/registre/commun.ts";
import { type Rich, richText } from "../src/registre/dc.ts";
import type { Evenement } from "../src/registre/donnees.ts";
import { setMessages } from "../src/registre/i18n.ts";
import {
  filCommune,
  ligneCommune,
  liensBande,
  quiDocument,
  titreDocument,
} from "../src/registre/vues/commune-outils.ts";

const catalogue: Record<string, string> = JSON.parse(readFileSync(new URL("../src/locales/fr.json", import.meta.url), "utf8"));
setMessages(Object.fromEntries(Object.entries(catalogue).filter(([k]) => k.startsWith("registre."))));
const N = "\u00a0";

/** SYNTHETIC: « Villeneuve » (99001) in « CC du Val » and the département 99. */
function donnees(evenements: Evenement[] = []): Donnees {
  return new Donnees({
    v: 1,
    commune: { insee: "99001", nom: "Villeneuve", dep: "99", pop: 12345, epci: "200000001" },
    evenements,
    affaires: {},
    entreprises: {
      "100000001": { nom: "ACME VIDEO" },
      "100000002": { nom: null, entrepreneur_individuel: true },
    },
    acheteurs: {
      "210000001": { nom: "Commune de Villeneuve", categorie: "commune", insee_siege: "99001" },
      "200000001": { nom: "CC du Val", categorie: "epci" },
    },
    communes: { "99001": { nom: "Villeneuve", dep: "99" }, "99002": { nom: "Bourg", dep: "99" } },
    lots: {},
    libelles: {},
    stats: {
      communes: {},
      epci: { code: "200000001", nom: "CC du Val", communes: ["99001", "99002"], uniq: {} },
      dep: { code: "99", nom: "Testshire", uniq: {}, depStats: {} },
    },
    carte: { n: 3, pub: 2, all: 3 },
    zones: { autorisations: [], zones: [], sites: [], unites: [] },
    mandats: [],
    couverture: {
      maj: "2026-10-23",
      departement: { etat: "collecte" },
      sources: [],
    },
  } as unknown as FichierCommune);
}

const json = (r: Rich) => JSON.stringify(r);

test("the head's identity line: the département and the intercommunality as typed links", () => {
  const l = ligneCommune(donnees());
  assert.equal(richText(l), `Testshire · CC du Val · 12${N}345 habitants · code INSEE 99001`);
  assert.match(json(l), /"href":"\/registre\/departement\/99","text":"Testshire".*"c":"var\(--type-territoire\)"/);
  // the intercommunality has no fiche: its row on its département's page
  assert.match(json(l), /"href":"\/registre\/departement\/99\?ic=200000001","text":"CC du Val"/);
});

test("the band: the fiche's sections then « Carte et drones »; « Fiche » first elsewhere", () => {
  const secs = [{ k: "documents", n: 1, l: "Documents", href: "#documents" }];
  assert.deepEqual(
    liensBande(secs, "99001", true).map((s) => [s.k, s.href]),
    [
      ["documents", "#documents"],
      ["carte", "/registre/commune/99001/carte"],
    ],
  );
  assert.deepEqual(
    liensBande(secs, "99001", false).map((s) => [s.k, s.l]),
    [
      ["fiche", "Fiche"],
      ["documents", "Documents"],
      ["carte", "Drones et algorithmes"],
    ],
  );
});

test("the breadcrumb of Documents and Autorisations ends on the commune", () => {
  assert.deepEqual(
    filCommune(donnees()).map((m) => [m.k, m.l, m.href]),
    [
      ["registre", "Registre", "/registre/"],
      ["commune", "Communes", "/registre/"],
      ["commune", "Villeneuve", "/registre/commune/99001"],
    ],
  );
});

test("a document's title: a decree by what it authorises", () => {
  const e = (x: Partial<Evenement>) => ({ id: "x", affaire: "a", t: "arrete", ...x }) as Evenement;
  assert.equal(titreDocument(e({ cameras: 1 })), "Autorisation de 1 caméra");
  assert.equal(titreDocument(e({ t: "arrete_drone", partage: ["99002"] })), "Autorisation de drones · partagé avec 1 commune");
  assert.equal(titreDocument(e({ t: "attribution", objet: "VIDEOPROTECTION URBAINE" })), "Videoprotection urbaine");
});

test("who a document concerns: typed links, never the fiche to itself, never a sole trader", () => {
  const con: Evenement = {
    id: "c~0",
    t: "attribution",
    date: "2025-01-02",
    insee: "99001",
    affaire: "c",
    communal: true,
    entreprises: ["100000001", "100000002"],
    acheteur_siren: "210000001",
  } as Evenement;
  const d = donnees([con]);
  const q = quiDocument(d, con);
  assert.equal(q.qk, "m");
  assert.equal(q.qui, "Mairie de Villeneuve");
  assert.match(json(q.quiR), /"href":"\/registre\/commune\/99001"/);
  // on the commune's own fiche, its name is not a link to itself
  assert.equal(quiDocument(d, con, true).quiR, "Mairie de Villeneuve");
  assert.equal(richText(q.entR), "→ Acme Video, entreprise individuelle, nom non publié");
  assert.match(json(q.entR), /"href":"\/registre\/entreprise\/100000001"/);
  assert.doesNotMatch(json(q.entR), /100000002/);
  // another buyer: its fiche
  const autre = { ...con, communal: false, acheteur_siren: "200000001" } as Evenement;
  assert.match(json(quiDocument(d, autre).quiR), /"href":"\/registre\/acheteur\/200000001".*"c":"var\(--type-acheteur\)"/);
});
