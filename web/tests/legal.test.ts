// The legal pages' texts (src/legal/pages.ts and fr.json's legal.*): every key a page can
// show exists, none is left unused; what shows when contributions are closed speaks of no
// account; the publisher's lines only when the API gives one; no address, host or domain
// of the site in a text (the contact comes from the build, the publisher from the API).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { PAGES, type Shown, shownSections } from "../src/legal/pages.ts";

const FR = JSON.parse(
  readFileSync(new URL("../src/locales/fr.json", import.meta.url), "utf8"),
) as Record<string, string>;
const STATES: Shown[] = [true, false].flatMap((open) =>
  [true, false].flatMap((publisher) =>
    [true, false].map((publish) => ({ open, publisher, publish })),
  ),
);
const text = (s: Shown) =>
  PAGES.flatMap((p) => [
    FR[`${p.key}.title`],
    ...shownSections(p, s).flatMap((sec) => [FR[`${sec.key}.h`], ...sec.paragraphs.map((x) => FR[x.key])]),
  ]).join("\n");

test("every key a page can show is in fr.json, and every legal.<page>.* key is used", () => {
  const used = new Set<string>();
  for (const p of PAGES) {
    used.add(`${p.key}.title`);
    used.add(`${p.key}.nav`);
    for (const sec of p.sections) {
      used.add(`${sec.key}.h`);
      for (const x of sec.paragraphs) used.add(x.key);
    }
  }
  for (const k of used) assert.ok(k in FR, `fr.json has no ${k}`);
  const pages = PAGES.map((p) => `${p.key}.`);
  const unused = Object.keys(FR).filter((k) => pages.some((p) => k.startsWith(p)) && !used.has(k));
  assert.deepEqual(unused, []);
});

test("closed contributions: no word of an account, a contribution's rules or a cookie", () => {
  for (const s of STATES.filter((x) => !x.open)) {
    const all = text(s);
    assert.doesNotMatch(all, /compte|pseudonyme|cookie|classement|session/i);
    assert.match(all, /\{contact\}/, "the contact stays");
  }
});

test("open contributions: the account's parts, deletion and the CC0 licence", () => {
  const all = text({ open: true, publisher: false, publish: false });
  for (const words of ["Supprimer mon compte", "CC0", "30 jours", "14 jours", "pseudonyme"])
    assert.ok(all.includes(words), words);
});

test("the legal bases: the terms (6.1 b) for accounts and contributions, a legitimate interest (6.1 f) for the cameras, always", () => {
  for (const s of STATES) {
    const all = text(s);
    assert.equal(all.includes("article 6.1\u00a0b"), s.open);
    assert.match(all, /intérêt légitime[^\n]*article 6\.1\u00a0f[^\n]*opposer[^\n]*\{contact\}/);
  }
});

test("the transfer: sign-in through OpenStreetMap in the United Kingdom, nothing else out of the EU", () => {
  for (const s of STATES) {
    const all = text(s);
    assert.equal(all.includes("OSM Foundation, au Royaume-Uni"), s.open);
    assert.equal(all.includes("Rien d'autre ne sort de l'Union européenne"), s.open);
  }
});

test("the export: everything the site keeps of the account, its secrets only signalled", () => {
  const all = text({ open: true, publisher: false, publish: false });
  const said =
    "tout ce que le site garde de votre compte\u00a0; les secrets techniques (empreintes, jetons) y sont seulement signalés";
  assert.ok(all.includes(said));
});

test("the sources: the basemap's data, style, icons and fonts, ESA WorldCover's attribution verbatim", () => {
  const all = text({ open: false, publisher: false, publish: false });
  for (const words of [
    "Natural Earth (domaine public)",
    "CC BY 4.0",
    "© ESA WorldCover project 2020 / Contains modified Copernicus Sentinel data (2020) processed by ESA WorldCover consortium",
    "licence CC0",
    "licence MIT",
    "Noto Sans",
    "BSD à 3 clauses",
  ])
    assert.ok(all.includes(words), words);
});

test("the sources link the third-party licence notices (licences.txt), whatever the state", () => {
  for (const s of STATES) assert.match(text(s), /en texte complet\u00a0: \{notices\}/);
});

test("the publisher's lines only when the API gives one; the write authorisation only when offered", () => {
  for (const s of STATES) {
    assert.equal(text(s).includes("{publisher}"), s.publisher);
    assert.equal(text(s).includes("chiffrée"), s.open && s.publish);
  }
});

test("the OSM synchronisation (16/10): said only while offered — what leaves, when, check_date, public and permanent, deletion here keeps it there, what the site keeps; the terms' authorisation", () => {
  const words = [
    "Publier aussi sur OpenStreetMap en mon nom",
    "sans autre geste",
    "acceptée par la relecture puis appliquée à la prochaine mise à jour de la carte",
    "check_date",
    "Jamais une caméra de particulier",
    "sous votre nom OSM",
    "au Royaume-Uni, publique et permanente",
    "supprimer votre compte ici ne la retire pas d'OpenStreetMap",
    "le mois de votre choix",
    "le numéro de son changeset",
    "vous autorisez Surveillance World à envoyer en votre nom",
    "Contributor Terms",
    "peut suspendre les envois",
    "n'efface jamais rien sur OpenStreetMap",
  ];
  for (const s of STATES) {
    const all = text(s).replaceAll("\u00a0", " ");
    for (const w of words) assert.equal(all.includes(w), s.open && s.publish, `${w} ${JSON.stringify(s)}`);
  }
});

test("the site's counters said in every state (lot 4): what, where, nothing on the device, 13 months; no answering time", () => {
  for (const s of STATES) {
    const all = text(s);
    for (const words of [
      "combien de fois la carte a été chargée",
      "combien de fois l'accueil s'est affiché",
      "Rien n'est lu ni écrit sur votre appareil",
      "aucun identifiant ni aucune adresse",
      "Les robots qui se déclarent",
      "gardés 13\u00a0mois, puis fondus en totaux par mois",
    ])
      assert.ok(all.includes(words), words);
    assert.doesNotMatch(all, /mesure pas l'audience|temps mis à répondre|durée du geste/);
  }
});

test("the counters by the hour (the « go » of 17/10): 7 days, then the day 13 months, then the month; sign-ins counted, never who; the administrators' feed of contributions", () => {
  for (const s of STATES) {
    const all = text(s);
    assert.ok(all.includes("heure par heure"));
    assert.ok(all.includes("gardés 7\u00a0jours, puis fondus dans ceux du jour"));
    assert.equal(all.includes("sans rien garder de qui se connecte"), s.open);
    assert.equal(
      all.includes("les contributions reçues\u00a0: qui, quoi, quel jour"),
      s.open,
    );
    assert.doesNotMatch(all, /deux nombres par jour/);
  }
});

test("no address, host or domain of the site in the texts", () => {
  const all = Object.entries(FR)
    // The outward links' words name other sites (cnil.fr, openstreetmap.org/copyright).
    .filter(([k]) => k.startsWith("legal.") && !k.startsWith("legal.link."))
    .map(([, v]) => v)
    .join("\n");
  assert.doesNotMatch(all, /@|https?:|www\.|\.(org|fr|com|net|eu)\b/i);
});
