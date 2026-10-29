// /revue « Registre » (lot R1b): what a reviewer types as a correction's value, read as the API
// takes it (lacarte_registre/corrections.py checks it again), the field a category points to,
// and every word the view names by a computed key is in fr.json.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  CATEGORIES,
  defaultField,
  FIELDS,
  type Field,
  parseValue,
} from "../src/review/registre-value.ts";

const FR = JSON.parse(
  readFileSync(new URL("../src/locales/fr.json", import.meta.url), "utf8"),
) as Record<string, string>;

const ok = (field: Field, text: string) => {
  const p = parseValue(field, text);
  assert.ok(p.ok, `${field}: ${text}`);
  return p.value;
};
const no = (field: Field, text: string) => assert.equal(parseValue(field, text).ok, false, text);

test("an amount in euros, French or plain", () => {
  assert.equal(ok("montant", "12000"), 12000);
  assert.equal(ok("montant", "12 000,50 €"), 12000.5);
  assert.equal(ok("montant", "415 000"), 415000);
  assert.equal(ok("montant", "0"), 0);
  for (const t of ["", "-5", "12 000 euros", "1e5", "200000000000", "12,000.5"]) no("montant", t);
});

test("a day that exists, ISO or French", () => {
  assert.equal(ok("date", "2021-02-05"), "2021-02-05");
  assert.equal(ok("date", "5/2/2021"), "2021-02-05");
  assert.equal(ok("date", " 05/02/2021 "), "2021-02-05");
  for (const t of ["2021-02-30", "1989-12-31", "2021-2-5", "février 2021", "05-02-2021"])
    no("date", t);
});

test("companies: SIREN, spaces inside allowed, listed once", () => {
  assert.deepEqual(ok("entreprises", "431 903 954, 256900994"), ["431903954", "256900994"]);
  assert.deepEqual(ok("entreprises", "431903954"), ["431903954"]);
  for (const t of ["", "43190395", "431903954, 431903954", "Serfim", "4319039541"])
    no("entreprises", t);
});

test("a commune, an affaire, a name, a number of cameras", () => {
  assert.equal(ok("insee", "69283"), "69283");
  assert.equal(ok("insee", "2a004"), "2A004");
  no("insee", "6928");
  no("insee", "Mions");
  assert.equal(ok("affaire", "216902833000132020_32323500"), "216902833000132020_32323500");
  no("affaire", "a b");
  no("affaire", "../x");
  assert.equal(ok("beneficiaire", "  Commune   de\nMions "), "Commune de Mions");
  no("beneficiaire", "   ");
  no("beneficiaire", "x".repeat(201));
  assert.equal(ok("cameras", "12"), 12);
  assert.equal(ok("cameras", "1 200"), 1200);
  for (const t of ["1.5", "-1", "douze", "100001"]) no("cameras", t);
});

test("each category points to its field, a zone or anything else to none", () => {
  assert.deepEqual(
    CATEGORIES.map((c) => defaultField(c)),
    ["montant", "date", "entreprises", "insee", "beneficiaire", "affaire", "cameras", null, null],
  );
});

test("every word named by a computed key is in fr.json", () => {
  const keys = [
    "review.tab.registre",
    ...CATEGORIES.map((c) => `review.registre.category.${c}`),
    ...FIELDS.flatMap((f) => [`review.registre.field.${f}`, `review.registre.hint.${f}`]),
    ...["decided", "unknown_report", "value"].map((c) => `review.error.${c}`),
    "review.feed.registre_accept",
    "review.feed.registre_refuse",
  ];
  for (const k of keys) assert.ok(k in FR, `fr.json has no ${k}`);
});
