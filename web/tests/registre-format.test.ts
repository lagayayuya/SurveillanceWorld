// The register's pure helpers: numbers, amounts and dates as its kit writes them, the singular of
// one (« 1 contrat signé », never « 1 contrats signés »: the Ain's département page wrote it, the
// 12th pass's « Ces 1 arrêtés » too), the published texts cleaned for display, its paths and the way
// back to the map.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { count, fr, longDate, longMonth, money, moneyFull, shortDate, signed } from "../src/registre/format.ts";
import { setMessages } from "../src/registre/i18n.ts";
import { backToMap, documentHref, nouvelleAdresse, route } from "../src/registre/routes.ts";
import { signalerHref } from "../src/registre/signaler.ts";
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
  // the old « Chiffres et classements », replaced by a list (listes.ts redirection)
  assert.deepEqual(route("/registre/chiffres"), { view: "chiffres" });
  assert.deepEqual(route("/registre/entreprises", "?tri=amt"), {
    view: "liste",
    liste: "entreprises",
    q: { tri: "amt" },
  });
  assert.deepEqual(route("/registre/couverture"), { view: "couverture" });
  assert.deepEqual(route("/registre/commune/69283"), { view: "commune", insee: "69283" });
  assert.deepEqual(route("/registre/commune/2A004/documents"), { view: "documents", insee: "2A004", q: {} });
  assert.deepEqual(route("/registre/commune/69283/autorisations/69-20083300"), {
    view: "autorisations",
    insee: "69283",
    dossier: "69-20083300",
  });
  assert.deepEqual(route("/registre/commune/abc"), { view: "introuvable" });
  assert.deepEqual(route("/registre/commune/69123/carte"), { view: "carte", insee: "69123", mois: "" });
  assert.deepEqual(route("/registre/commune/69123/carte", "?mois=2026-03"), {
    view: "carte",
    insee: "69123",
    mois: "2026-03",
  });
  assert.deepEqual(route("/registre/commune/69123/carte", "?mois=2026-13"), { view: "carte", insee: "69123", mois: "" });
  assert.deepEqual(route("/registre/contrat/21690283300013 2020~1"), {
    view: "contrat",
    id: "21690283300013 2020~1",
    type: "contrat",
  });
  // each type of document its address, the same record's view
  assert.deepEqual(route("/registre/avis/avis-26-71981"), { view: "contrat", id: "avis-26-71981", type: "avis" });
  assert.deepEqual(route("/registre/subvention/detr-69-2025-6"), {
    view: "contrat",
    id: "detr-69-2025-6",
    type: "subvention",
  });
  assert.deepEqual(route("/registre/arrete/69-20083026"), { view: "contrat", id: "69-20083026", type: "arrete" });
  assert.deepEqual(route("/registre/avis/a/b"), { view: "introuvable" });
  assert.deepEqual(route("/registre/entreprise/431903954"), { view: "entreprise", siren: "431903954" });
  assert.deepEqual(route("/registre/acheteur/256900994"), { view: "acheteur", siren: "256900994" });
  assert.deepEqual(route("/registre/departement/69"), { view: "departement", dep: "69" });
  assert.deepEqual(route("/registre/departement/2A"), { view: "departement", dep: "2A" });
  assert.deepEqual(route("/registre/glossaire"), { view: "glossaire" });
  assert.deepEqual(route("/registre/entreprise/4319"), { view: "introuvable" });
  assert.deepEqual(route("/registre/departement/690"), { view: "introuvable" });
  assert.deepEqual(route("/registre/contrat/a/b"), { view: "introuvable" });
});

test("a document's address by its type; the old ones answer the new", () => {
  assert.equal(documentHref("21690283300013202520240600_32323500"), "/registre/contrat/21690283300013202520240600_32323500");
  assert.equal(documentHref("avis-26-71981"), "/registre/avis/avis-26-71981");
  assert.equal(documentHref("sub-EX077568"), "/registre/subvention/sub-EX077568");
  assert.equal(
    documentHref("region-sud-CP 23-0209 du 24 mars 2023-0"),
    "/registre/subvention/region-sud-CP%2023-0209%20du%2024%20mars%202023-0",
  );
  assert.equal(documentHref("69-2025-11-03-00003"), "/registre/arrete/69-2025-11-03-00003");
  assert.equal(documentHref("2A-20250101"), "/registre/arrete/2A-20250101");
  // the old addresses (contrat/ for every type): the new one, encoded as asked
  assert.equal(nouvelleAdresse("/registre/contrat/avis-26-71981"), "/registre/avis/avis-26-71981");
  assert.equal(
    nouvelleAdresse("/registre/contrat/region-sud-CP%2023-0209"),
    "/registre/subvention/region-sud-CP%2023-0209",
  );
  assert.equal(nouvelleAdresse("/registre/contrat/69-20083026"), "/registre/arrete/69-20083026");
  assert.equal(nouvelleAdresse("/registre/contrat/21690283300013202520240600_32323500"), null);
  assert.equal(nouvelleAdresse("/registre/avis/avis-26-71981"), null);
  assert.equal(signalerHref({ id: "26-71981", affaire: "avis-26-71981" }), "/registre/avis/avis-26-71981?doc=26-71981#signaler");
});

test("the way back to the map", () => {
  assert.equal(backToMap(`?carte=${encodeURIComponent("?f=3#13/45.70/4.95")}`), "/?f=3#13/45.70/4.95");
  assert.equal(backToMap("", "69283"), "/?insee=69283");
  assert.equal(backToMap(""), "/");
  // only the map's own query or fragment, never another address
  assert.equal(backToMap(`?carte=${encodeURIComponent("//evil.example/")}`), "/");
  assert.equal(backToMap(`?carte=${encodeURIComponent('#"><script>')}`, "69283"), "/?insee=69283");
});

test("a published objet's slips are tidied for display (v2.3): « Accord- cadre », « ,…. »", () => {
  assert.equal(tidy("Accord- cadre à bons de commande"), "Accord-cadre à bons de commande");
  assert.equal(tidy("installations anti intrusion,…."), "installations anti intrusion…");
  assert.equal(tidy("maintenance, ..."), "maintenance…");
  // a dash between spaces stays (« Lot 1 - Vidéo »), a hyphen before a capital too
  assert.equal(tidy("Lot 1 - Vidéoprotection"), "Lot 1 - Vidéoprotection");
  assert.equal(tidy("Rhône- Alpes"), "Rhône- Alpes");
});
