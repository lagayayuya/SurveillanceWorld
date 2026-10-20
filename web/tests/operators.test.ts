// Who films in the punk editor (src/participate/questions.ts searchOperators, listedAs,
// proposedProblem): the search over every listed name, the ones around first, and the
// proposed name checked as the API checks it (the contract of the lot of 2026-10-12).
//   node --test --experimental-strip-types tests/
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  listedAs,
  type Operators,
  proposedProblem,
  searchOperators,
  tidy,
} from "../src/participate/questions.ts";

const OPS: Operators = {
  near: [
    { name: "Ville de Courbevoie", class: "public" },
    { name: "Carrefour", class: "business" },
  ],
  all: [
    { name: "Carrefour", class: "business" },
    { name: "Pôle universitaire Léonard de Vinci", class: "public" },
    { name: "RATP", class: "public" },
    { name: "SNCF", class: "public" },
    { name: "Ville de Courbevoie", class: "public" },
  ],
};
const names = (l: { name: string }[]) => l.map((n) => n.name);

test("no query: the names around only", () => {
  assert.deepEqual(names(searchOperators(OPS, "", 8)), ["Ville de Courbevoie", "Carrefour"]);
});

test("« ratp » finds RATP and its class; case and accents do not matter", () => {
  const [ratp] = searchOperators(OPS, "ratp", 8);
  assert.deepEqual(ratp, { name: "RATP", class: "public" });
  assert.deepEqual(names(searchOperators(OPS, "LEONARD", 8)), [
    "Pôle universitaire Léonard de Vinci",
  ]);
  assert.deepEqual(names(searchOperators(OPS, "pôle", 8)), ["Pôle universitaire Léonard de Vinci"]);
});

test("the names around first, each once, at most max", () => {
  assert.deepEqual(names(searchOperators(OPS, "c", 8)), [
    "Ville de Courbevoie",
    "Carrefour",
    "Pôle universitaire Léonard de Vinci",
    "SNCF",
  ]);
  assert.equal(searchOperators(OPS, "e", 2).length, 2);
});

test("a text that folds to a listed name is that name", () => {
  assert.equal(listedAs(OPS, "r.a.t.p")?.name, undefined);
  assert.equal(listedAs(OPS, " Ratp ")?.name, "RATP");
  assert.equal(listedAs(OPS, "ville de COURBEVOIE")?.class, "public");
});

test("a proposed name: tidied as the API does, 2 to 60 characters, the contract's characters", () => {
  assert.equal(tidy("  Boulangerie   du\tCoin "), "Boulangerie du Coin");
  assert.equal(proposedProblem("Boulangerie du Coin"), null);
  assert.equal(proposedProblem("L'Œil & Cie (Paris), 3/4 - Sud."), null);
  assert.equal(proposedProblem("Café’s"), null);
  assert.equal(proposedProblem("A"), "length");
  assert.equal(proposedProblem(" A "), "length");
  assert.equal(proposedProblem("x".repeat(60)), null);
  assert.equal(proposedProblem("x".repeat(61)), "length");
  assert.equal(proposedProblem("-Boulangerie"), "chars");
  assert.equal(proposedProblem("<script>"), "chars");
  assert.equal(proposedProblem("Boulangerie #1"), "chars");
  assert.equal(proposedProblem("Boulangerie@coin"), "chars");
});
