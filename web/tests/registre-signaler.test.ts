// « Signaler une erreur »: the link a document's panel gives, the document a link names, the
// request's body and the sentence each answer of the API gets (pipeline/lacarte/api/registre.py).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { setMessages } from "../src/registre/i18n.ts";
import { CATEGORIES, cible, corps, issue, signaler, signalerHref } from "../src/registre/signaler.ts";

const catalogue: Record<string, string> = JSON.parse(readFileSync(new URL("../src/locales/fr.json", import.meta.url), "utf8"));
setMessages(Object.fromEntries(Object.entries(catalogue).filter(([k]) => k.startsWith("registre."))));

test("a document's link leads to its record's form and names the document", () => {
  const e = { id: "216902833000132020_32323500~0", affaire: "216902833000132020_32323500" };
  const href = signalerHref(e);
  assert.equal(href, "/registre/contrat/216902833000132020_32323500?doc=216902833000132020_32323500~0#signaler");
  assert.deepEqual(cible(href), { evenement: e.id, affaire: e.affaire });
  assert.equal(signaler(e).l, "Signaler une erreur");
  // an affaire's id with a space or an accent survives the round trip
  const odd = { id: "avis 26 é~1", affaire: "avis 26 é" };
  assert.deepEqual(cible(signalerHref(odd)), { evenement: odd.id, affaire: odd.affaire });
});

test("only a record's form link opens the form", () => {
  assert.equal(cible("/registre/contrat/x"), null);
  assert.equal(cible("/registre/commune/69283#signaler"), null);
  assert.equal(cible("https://example.org/registre/contrat/x#signaler", "https://site.example/"), null);
  assert.deepEqual(cible("/registre/contrat/x#signaler"), { evenement: "x", affaire: "x" });
});

test("the body leaves the optional fields out when empty, and trims", () => {
  const base = { evenement: "e", affaire: "a", category: "montant" as const, correction: "  12 000 €  " };
  assert.deepEqual(corps({ ...base, source: " ", contact: "" }), {
    evenement: "e",
    affaire: "a",
    category: "montant",
    correction: "12 000 €",
  });
  assert.deepEqual(corps({ ...base, source: "https://x.fr/a", contact: "moi" }).source, "https://x.fr/a");
});

test("each answer has its sentence, and every category its label", () => {
  assert.equal(issue(201), "envoye");
  assert.equal(issue(429, "rate"), "rythme");
  assert.equal(issue(403, "closed"), "ferme");
  assert.equal(issue(403, "robot"), "echec");
  assert.equal(issue(422, "invalid", ["source"]), "source");
  assert.equal(issue(422, "invalid", ["contact"]), "contact");
  assert.equal(issue(422, "invalid", ["correction"]), "invalide");
  assert.equal(issue(500, "internal"), "echec");
  for (const k of ["envoye", "rythme", "ferme", "source", "contact", "invalide", "echec", "incomplet", "envoi"])
    assert.ok(catalogue[`registre.signaler.etat.${k}`], k);
  for (const c of CATEGORIES) assert.ok(catalogue[`registre.signaler.cat.${c}`], c);
});
