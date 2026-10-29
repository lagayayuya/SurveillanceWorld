// A sole trader in the register's pages (DECISIONS 2026-10-29): the build gives its token « ei »
// for its SIREN; the pages name it « entreprise individuelle, nom non publié », link to no page
// and count it in no ranking.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { entHref, entName, figures, type Recherche } from "../src/registre/corpus.ts";
import { EI, type Evenement } from "../src/registre/donnees.ts";
import { setMessages } from "../src/registre/i18n.ts";

const catalogue: Record<string, string> = JSON.parse(readFileSync(new URL("../src/locales/fr.json", import.meta.url), "utf8"));
setMessages(Object.fromEntries(Object.entries(catalogue).filter(([k]) => k.startsWith("registre."))));

const R = {
  v: 1,
  entreprises: { [EI]: { nom: null, entrepreneur_individuel: true }, "431903954": { nom: "SERFIM T.I.C." } },
  acheteurs: {},
  communes: {},
  affaires: {},
  evenements: [
    { id: "a~0", t: "attribution", affaire: "a", entreprises: [EI], compte: true, montant: 1000, acheteur_siren: "216900001" },
    { id: "b~0", t: "attribution", affaire: "b", entreprises: ["431903954", EI], compte: true, montant: 2000, acheteur_siren: "216900001" },
  ] as Evenement[],
} as unknown as Recherche;

test("a sole trader is named as such, has no page, and no ranking counts it", () => {
  assert.equal(entName(R, EI), "entreprise individuelle, nom non publié");
  assert.equal(entHref(EI), null);
  assert.equal(entHref("431903954"), "/registre/entreprise/431903954");
  const f = figures(R);
  assert.deepEqual(Object.keys(f.ents), ["431903954"]);
  assert.deepEqual([...f.buyers["216900001"].ents], ["431903954"]);
  // the contracts still count in their buyer's amount
  assert.equal(f.buyers["216900001"].montant, 3000);
});
