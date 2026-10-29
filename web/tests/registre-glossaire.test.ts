// The register's glossary (/registre/glossaire): every word has its words in the catalogue and an
// example that is a page of the register, the filter ignores accents and case, an address #g-<id>
// names a word, and no word says what the register's rules (DECISIONS 2026-10-28) forbid.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { setMessages, t } from "../src/registre/i18n.ts";
import { route } from "../src/registre/routes.ts";
import { ancre, cle, filtrer, MOTS, mots } from "../src/registre/vues/glossaire-mots.ts";

const catalogue: Record<string, string> = JSON.parse(readFileSync(new URL("../src/locales/fr.json", import.meta.url), "utf8"));
setMessages(Object.fromEntries(Object.entries(catalogue).filter(([k]) => k.startsWith("registre."))));
const all = mots(t);

test("every word has its three texts, and the catalogue no word without its entry", () => {
  const ids = MOTS.map(([id]) => id);
  assert.equal(new Set(ids).size, ids.length);
  const keys = new Set<string>();
  for (const id of ids)
    for (const part of ["terme", "definition", "exemple"]) {
      const k = `registre.glossaire.mot.${cle(id)}.${part}`;
      assert.ok(catalogue[k]?.trim(), `${k} is missing`);
      keys.add(k);
    }
  const extra = Object.keys(catalogue).filter((k) => k.startsWith("registre.glossaire.mot.") && !keys.has(k));
  assert.deepEqual(extra, []);
});

test("the words the owner found missing are there, and the anchors other views link", () => {
  for (const id of ["decp", "data-gouv", "affaire", "groupement", "accord-cadre"])
    assert.ok(MOTS.some(([m]) => m === id), id);
  assert.match(t("glossaire.mot.decp.terme"), /^DECP/);
  assert.match(t("glossaire.mot.decp.definition"), /data\.gouv\.fr/);
});

test("every example is a page the register answers", () => {
  for (const [id, href] of MOTS) {
    assert.match(href, /^\/registre\//, id);
    const url = new URL(href, "https://exemple.invalid");
    assert.notEqual(route(url.pathname, url.search).view, "introuvable", `${id}: ${href}`);
  }
});

test("the words in French alphabetical order, accents and case aside", () => {
  const terms = all.map((m) => m.terme);
  assert.equal(terms[0], "Accord-cadre");
  const at = (s: string) => terms.findIndex((x) => x.startsWith(s));
  assert.ok(at("CSV") < at("data.gouv.fr") && at("data.gouv.fr") < at("DECP"));
  assert.ok(at("DECP") < at("Délibération"));
  assert.ok(at("Durée") < at("Élections") && at("Élections") < at("Groupement"));
  assert.ok(at("Caméras sur la voie publique") < at("Caméras-piétons"));
});

test("the filter: in the word or its definition, accents and case ignored", () => {
  const ids = (q: string) => filtrer(all, q).map((m) => m.id);
  assert.equal(filtrer(all, "  ").length, all.length);
  assert.ok(ids("PREFECTURE DE ZONE").includes("prefecture-zone"));
  assert.ok(ids("elections").includes("elections"));
  assert.ok(ids("decp").includes("decp") && ids("decp").includes("data-gouv"));
  assert.ok(ids("plafond partagé").includes("groupement"));
  assert.deepEqual(ids("zzzz"), []);
});

test("an address names a word of the page, or none", () => {
  assert.equal(ancre("#g-accord-cadre"), "accord-cadre");
  assert.equal(ancre("g-groupement"), "groupement");
  assert.equal(ancre("#g-inconnu"), "");
  assert.equal(ancre("#s-argent"), "");
  assert.equal(ancre("#g-%E9"), "");
  assert.equal(ancre(""), "");
});

test("counts in the singular for one", () => {
  assert.equal(t("glossaire.n_trouves", { n: 1 }), "1 mot trouvé (dans le mot ou sa définition)");
  assert.equal(t("glossaire.n_trouves", { n: 3 }), "3 mots trouvés (dans le mot ou sa définition)");
  assert.match(t("glossaire.entrees_chaque_mot_renvoie_vers", { total: 1 }), /^1 entrée ·/);
  assert.match(t("glossaire.entrees_chaque_mot_renvoie_vers", { total: 56 }), /^56 entrées ·/);
});

test("no word says what the register's rules forbid", () => {
  // no human review; an amount alone, an envelope; « signés avec », not « versés à »
  const banned = [/relu/i, /relecture/i, /à la main/i, /maximum/i, /vérifié/i, /versée?s?\b/i, /prototype/i];
  for (const [k, v] of Object.entries(catalogue))
    if (k.startsWith("registre.glossaire.")) for (const re of banned) assert.doesNotMatch(v, re, k);
});
