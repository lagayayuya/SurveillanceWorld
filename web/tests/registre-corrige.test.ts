// A correction accepted in /revue on a document's page (corrige.ts): « Corrigé le <date> », the value
// read now, and the source's value struck and named in words; nothing for a correction without its
// day (the reviewed date of rules/registre_corrections.yaml keeps its « ? » mark instead).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { corrections, valeur } from "../src/registre/corrige.ts";
import type { Evenement } from "../src/registre/donnees.ts";
import { setMessages } from "../src/registre/i18n.ts";

const catalogue: Record<string, string> = JSON.parse(readFileSync(new URL("../src/locales/fr.json", import.meta.url), "utf8"));
setMessages(Object.fromEntries(Object.entries(catalogue).filter(([k]) => k.startsWith("registre."))));
const N = " ";
const noms = { entreprise: (s: string) => (s === "431903954" ? "Serfim T.I.C." : s), commune: (k: string) => (k === "69283" ? "Mions" : k) };

test("each corrected field says when, what it reads now, and the source's value struck", () => {
  const e = {
    id: "x~0",
    t: "attribution",
    affaire: "x",
    montant: 230000,
    entreprises: ["431903954"],
    corrige: {
      montant: { source: 215000, le: "2026-10-29" },
      entreprises: { source: [], le: "2026-10-30" },
    },
  } as Evenement;
  const [m, ent] = corrections(e, noms);
  assert.equal(m.k, "Corrigé le 29 octobre 2026");
  assert.deepEqual(m.v, ["Montant : ", { strong: `230${N}000 €` }, " · publié par la source : ", { span: `215${N}000 €`, cls: "barre" }]);
  assert.deepEqual(ent.v, ["Entreprises : ", { strong: "Serfim T.I.C." }, " · publié par la source : ", { span: "—", cls: "barre" }]);
});

test("values as the pages write them", () => {
  assert.equal(valeur("insee", "69283", noms), "Mions");
  assert.equal(valeur("date", "2021-02-05", noms), "5 février 2021");
  assert.equal(valeur("cameras", null, noms), "—");
  assert.equal(valeur("beneficiaire", "Commune de Mions", noms), "Commune de Mions");
});

test("no correction, or one without its day: nothing said", () => {
  assert.deepEqual(corrections({ id: "a", t: "attribution", affaire: "a" } as Evenement, noms), []);
  const lue = { id: "b", t: "attribution", affaire: "b", corrige: { date: { source: "2020-02-05" } } };
  assert.deepEqual(corrections(lue as unknown as Evenement, noms), []);
});
