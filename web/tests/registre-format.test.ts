// The register's pure helpers: numbers, amounts and dates as its kit writes them, the singular of
// one (« 1 contrat signé », never « 1 contrats signés »: the Ain's département page wrote it, the
// 12th pass's « Ces 1 arrêtés » too), the published texts cleaned for display, its paths and the way
// back to the map.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { count, fr, longDate, longMonth, money, moneyFull, shortDate, signed } from "../src/registre/format.ts";
import { setMessages } from "../src/registre/i18n.ts";
import { backToMap, route } from "../src/registre/routes.ts";
import { calm, plain, proper, sentence, tidy, titleCase } from "../src/registre/texte.ts";

const catalogue: Record<string, string> = JSON.parse(readFileSync(new URL("../src/locales/fr.json", import.meta.url), "utf8"));
setMessages(Object.fromEntries(Object.entries(catalogue).filter(([k]) => k.startsWith("registre."))));
const N = "\u00a0"; // thousands apart by a full no-break space, as the kit writes them

test("numbers and amounts", () => {
  assert.equal(fr(1233), `1${N}233`);
  assert.equal(money(415000), `415${N}000 €`);
  assert.equal(money(4_960_000), "5,0 M€");
  assert.equal(money(108_700_000), "109 M€");
  assert.equal(money(0), "non publié");
  assert.equal(money(null), "non publié");
  assert.equal(moneyFull(215000), `215${N}000 €`);
  assert.equal(signed(13), "+13");
  assert.equal(signed(-3), "−3");
  assert.equal(signed(0), "±0");
});

test("one is singular, two and more plural, thousands apart", () => {
  assert.equal(count(1, "contrat_signe"), "1 contrat signé");
  assert.equal(count(2, "contrat_signe"), "2 contrats signés");
  assert.equal(count(1, "arrete"), "1 arrêté");
  assert.equal(count(0, "document"), "0 document");
  assert.equal(count(1233, "document"), `1${N}233 documents`);
});

test("dates", () => {
  assert.equal(shortDate("2025-11-18"), "18 nov. 2025");
  assert.equal(shortDate("2025-11"), "nov. 2025");
  assert.equal(shortDate(null), "date non publiée");
  assert.equal(longMonth("2025-11-18"), "novembre 2025");
  assert.equal(longDate("2026-10-01"), "1er octobre 2026");
  assert.equal(longDate("2031-06-30"), "30 juin 2031");
});

test("published texts, for display only", () => {
  assert.equal(tidy("MISE EN PLACE D UN SYSTEME"), "MISE EN PLACE D’UN SYSTEME");
  assert.equal(tidy("l'arrêté  de   la"), "l’arrêté de la");
  assert.equal(calm("MAINTENANCE DES CAMERAS"), "Maintenance des cameras");
  assert.equal(sentence("VIDEOPROTECTION URBAINE"), "Videoprotection urbaine");
  assert.equal(titleCase("SERFIM T.I.C."), "Serfim T.I.C.");
  assert.equal(titleCase("COMPAGNIE DES SIGNAUX"), "Compagnie des Signaux");
  assert.equal(titleCase("Mairie de Mions"), "Mairie de Mions");
  assert.equal(proper("Pharmacie Des Halles"), "Pharmacie des Halles");
  assert.equal(plain("Île-de-France"), "ile-de-france");
});

test("paths", () => {
  assert.deepEqual(route("/registre/"), { view: "registre", q: {} });
  assert.deepEqual(route("/registre", "?q=drone"), { view: "registre", q: { q: "drone" } });
  assert.deepEqual(route("/registre/chiffres"), { view: "chiffres" });
  assert.deepEqual(route("/registre/couverture"), { view: "couverture" });
  assert.deepEqual(route("/registre/commune/69283"), { view: "commune", insee: "69283" });
  assert.deepEqual(route("/registre/commune/2A004/documents"), { view: "documents", insee: "2A004", q: {} });
  assert.deepEqual(route("/registre/commune/69283/autorisations/69-20083300"), {
    view: "autorisations",
    insee: "69283",
    dossier: "69-20083300",
  });
  assert.deepEqual(route("/registre/commune/abc"), { view: "introuvable" });
  assert.deepEqual(route("/registre/entreprise/431903954"), { view: "introuvable" });
});

test("the way back to the map", () => {
  assert.equal(backToMap(`?carte=${encodeURIComponent("?f=3#13/45.70/4.95")}`), "/?f=3#13/45.70/4.95");
  assert.equal(backToMap("", "69283"), "/?insee=69283");
  assert.equal(backToMap(""), "/");
  // only the map's own query or fragment, never another address
  assert.equal(backToMap(`?carte=${encodeURIComponent("//evil.example/")}`), "/");
  assert.equal(backToMap(`?carte=${encodeURIComponent('#"><script>')}`, "69283"), "/?insee=69283");
});
