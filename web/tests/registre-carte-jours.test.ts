// « Jours de vol autorisés » and the rows of acts without a drawn zone (lot R4.2, board B): the
// calendar's counts and grids, the day's filter and sentence, the rows' words in every state, the
// absent-field rule, the panel's lines. Two rows: one shaped as Paris's published rows are today
// (no service, motif, finalités nor places: not published yet), the other the brief's example
// completed as the board draws it. Both SYNTHETIC (example.org links).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { hachuresSecteur, pave, poseBord } from "../src/registre/drones.ts";
import { setMessages } from "../src/registre/i18n.ts";
import {
  autoriteTxt,
  camerasTxt,
  type Creneau,
  DEBUT_CAL,
  dateActe,
  enTete,
  finalitesTxt,
  grilleMois,
  grilleSemaines,
  horaireTxt,
  jourDe,
  jourLong,
  joursComptes,
  motsLigne,
  type NonDeduit,
  ndDans,
  niveau,
  phraseJour,
  reperesCal,
  secteurPanneau,
  tickets,
  zonePanneau,
} from "../src/registre/vues/carte-outils.ts";

const catalogue: Record<string, string> = JSON.parse(
  readFileSync(new URL("../src/locales/fr.json", import.meta.url), "utf8"),
);
setMessages(Object.fromEntries(Object.entries(catalogue).filter(([k]) => k.startsWith("registre."))));
const N = " ";
const DAY = 86_400_000;
const d = (s: string) => Date.parse(`${s}T00:00:00Z`);

/** As Paris's rows are published today: hours read but not published, the zone on annexed plans. */
const aujourdhui: NonDeduit = {
  acte: "75-2026-11-03-00006",
  kind: "drone",
  date: "2026-11-04",
  url: "https://example.org/recueil.pdf",
  ref: "préfecture (Paris), recueil-75-2026-661 du 03.11.2026, acte 75-2026-11-03-00006",
  page: null,
  raisons: ["zone_non_deduite"],
  zone: "plan_annexe",
  horaires_etat: "non_publies",
  jours: ["2026-11-04"],
  cameras: 6,
  numero: "2026-1518",
  autorite: "ppparis",
  titre: "Arrêté 2026-01518 du 03 novembre 2026 autorisant la captation…",
};
/** The brief's example row, every field published (the board's). */
const complet: NonDeduit = {
  ...aujourdhui,
  horaires_etat: "publies",
  horaires: ["07h30-15h30"],
  n_perimetres: 3,
  numero: "2026-01518",
  service: "Direction de la sécurité de proximité de l'agglomération parisienne",
  motif: { categorie: "manifestation", libelle: "mouvement social lycéen et étudiant" },
  finalites: ["atteintes_personnes_biens", "rassemblements"],
  lieux: [
    { texte: "14e arrondissement", genre: "arrondissement", forme: "75114" },
    { texte: "aux abords des lycées et des universités", genre: "autre" },
  ],
};
const slot = (o: Partial<Creneau> & { t0: number; t1: number }): Creneau => ({
  heures: null,
  kind: "drone",
  service: null,
  finalite: null,
  url: null,
  actes: ["a1"],
  sites: ["s1"],
  statut: "relu",
  ...o,
});

test("the calendar's counts: each act once a day, its read days only, a slot every day it meets", () => {
  const ND: NonDeduit[] = [
    aujourdhui,
    { ...aujourdhui, acte: "b", jours: ["2026-11-04", "2026-11-05"] },
    // a period read as its first and last day: those two days, nothing filled in between
    { ...aujourdhui, acte: "c", jours: ["2026-10-10", "2026-10-30"] },
    // an older file's row: its date
    { acte: "e", kind: "drone", date: "2026-11-05", url: null, page: null, raisons: [] },
    { ...aujourdhui, acte: "v", kind: "vsa" },
  ];
  const T = [
    // 20 h → 3 h: two days
    slot({ t0: d("2026-11-04") + 20 * 3600_000, t1: d("2026-11-05") + 3 * 3600_000, actes: ["s", "b"] }),
  ];
  const c = joursComptes(T, ND, "drone", DEBUT_CAL, d("2026-11-09"));
  assert.equal(c.get(d("2026-11-04")), 3); // aujourd'hui, b, s (b once)
  assert.equal(c.get(d("2026-11-05")), 3); // b, e, s
  assert.equal(c.get(d("2026-10-10")), 1);
  assert.equal(c.get(d("2026-10-20")), undefined);
  assert.equal(c.get(d("2026-10-30")), 1);
  assert.equal(joursComptes(T, ND, null, DEBUT_CAL, d("2026-11-09")).get(d("2026-11-04")), 4);
  // before the calendar: left out
  assert.equal(joursComptes([], [{ ...aujourdhui, jours: ["2018-09-28"] }], "drone", DEBUT_CAL, d("2026-11-09")).size, 0);
  assert.deepEqual([0, 1, 2, 3, 4, 9].map(niveau), [0, 1, 2, 3, 4, 4]);
});

test("the day's filter: ?jour=, an act on one of its read days, an undated old act everywhere", () => {
  assert.deepEqual(jourDe("2026-11-04"), [d("2026-11-04"), d("2026-11-04") + DAY]);
  assert.equal(jourDe("2026-02-30"), null);
  assert.equal(jourDe("4 nov."), null);
  const r = jourDe("2026-11-04");
  assert.equal(ndDans(aujourdhui, r), true);
  assert.equal(ndDans(aujourdhui, jourDe("2026-11-05")), false);
  assert.equal(ndDans({ ...aujourdhui, jours: ["2026-10-10", "2026-10-30"] }, jourDe("2026-10-20")), false);
  assert.equal(ndDans({ ...aujourdhui, jours: [] }, r), false);
  assert.equal(ndDans({ ...aujourdhui, jours: undefined, date: null }, r), true);
  assert.equal(ndDans(aujourdhui, null), true);
});

test("the tickets of board B: acts, hours read, drawn zones, zones not read", () => {
  const ND = [
    aujourdhui,
    { ...aujourdhui, acte: "x", horaires_etat: "absents", jours: ["2026-11-01"] },
  ];
  const T = [
    slot({ t0: d("2026-11-04"), t1: d("2026-11-04") + 3600_000, heures: 1, actes: ["s1"] }),
    slot({ t0: d("2026-11-04"), t1: d("2026-11-04") + 3600_000, actes: ["s2"], sites: [] }),
  ];
  assert.deepEqual(tickets(T, ND, null), { actes: 4, horairesLus: 2, tracees: 1, nonLues: 3 });
  assert.deepEqual(tickets(T, ND, jourDe("2026-11-01")), { actes: 1, horairesLus: 0, tracees: 0, nonLues: 1 });
});

test("the wide grid: a column per week from 1 January 2024, Monday on top; its year and quarter marks", () => {
  const B = d("2026-11-09");
  const g = grilleSemaines(new Map([[d("2026-11-04"), 2]]), DEBUT_CAL, B);
  assert.equal(g.cols, 149); // the board's 149 columns, 2024 → the week of 4 Nov 2026
  const c = g.cases.find((x) => x.t === d("2026-11-04"));
  assert.deepEqual(c, { t: d("2026-11-04"), n: 2, col: 148, row: 2 });
  assert.deepEqual(g.cases[0], { t: DEBUT_CAL, n: 0, col: 0, row: 0 });
  const m = reperesCal(DEBUT_CAL, B);
  assert.deepEqual(m.slice(0, 5), [
    { col: 0, l: "2024", an: true },
    { col: 13, l: "avr.", an: false },
    { col: 26, l: "juil.", an: false },
    { col: 39, l: "oct.", an: false },
    { col: 52, l: "2025", an: true },
  ]);
});

test("the phone's grid: a row per month, the latest on top, a column per day of the month", () => {
  const g = grilleMois(new Map([[d("2026-11-04"), 1]]), DEBUT_CAL, d("2026-11-05"));
  assert.equal(g.mois.length, 35);
  assert.deepEqual(g.mois[0], { t0: d("2026-11-01"), l: `nov.${N}2026` });
  assert.equal(g.mois[1].l, "oct.");
  assert.equal(g.mois[11].l, `déc.${N}2025`);
  assert.deepEqual(g.mois[34], { t0: DEBUT_CAL, l: "janv." });
  assert.deepEqual(
    g.cases.find((x) => x.t === d("2026-11-04")),
    { t: d("2026-11-04"), n: 1, col: 3, row: 0 },
  );
  assert.deepEqual(g.cases.find((x) => x.t === d("2024-01-31")), { t: d("2024-01-31"), n: 0, col: 30, row: 34 });
  // never more than 31 columns, never a day after the end
  assert.ok(g.cases.every((x) => x.col < 31 && x.t < d("2026-11-05")));
});

test("the sentence on the chosen day, as the board writes it, and with today's data", () => {
  const p = phraseJour(d("2026-11-04"), [], [complet], "drone");
  assert.equal(p.date, `Mer.${N}4${N}nov.${N}2026`);
  assert.equal(p.reste, "1 arrêté · 7 h 30 – 15 h 30 · secteur cité : 14e arrondissement · zone non lue");
  assert.equal(
    phraseJour(d("2026-11-04"), [], [aujourdhui], "drone").reste,
    "1 arrêté · horaires non publiés (justesse en cours de mesure) · zone non lue",
  );
  assert.equal(phraseJour(d("2026-11-03"), [], [aujourdhui], "drone").reste, "aucun arrêté");
  assert.equal(jourLong(d("2026-11-01")), `Dim.${N}1er${N}nov.${N}2026`);
});

test("a row's words: hours in each state, service and reason, the zone's state; nothing for a field not published", () => {
  assert.deepEqual(motsLigne(complet), {
    h: "7 h 30 – 15 h 30",
    svc: "Direction de la sécurité de proximité de l'agglomération parisienne · mouvement social lycéen et étudiant",
    zst: "zone non lue (plan annexé) · secteur cité 14e arrondissement",
  });
  // today's Paris row: no service, no motif, no place: none of them shows, nothing in their place
  assert.deepEqual(motsLigne(aujourdhui), {
    h: "horaires non publiés (justesse en cours de mesure)",
    svc: "",
    zst: "zone non lue (plan annexé)",
  });
  assert.equal(motsLigne({ ...aujourdhui, horaires_etat: "absents" }).h, "horaires non précisés");
  assert.equal(motsLigne({ ...aujourdhui, zone: "non_lue" }).zst, "zone non lue");
  // an older file's row says nothing of its hours
  assert.equal(motsLigne({ ...aujourdhui, horaires_etat: undefined }).h, "");
  // the motif's category when its words are not published; an unknown one left out
  assert.equal(motsLigne({ ...aujourdhui, motif: { categorie: "sport", libelle: null } }).svc, "événement sportif");
  assert.equal(motsLigne({ ...aujourdhui, motif: { categorie: "inconnue", libelle: null } }).svc, "");
  // never the raw ref, the title or the recueil's file name
  for (const r of [aujourdhui, complet])
    for (const v of Object.values(motsLigne(r))) assert.ok(!/recueil|préfecture \(|Arrêté 2026/.test(v), v);
  assert.equal(horaireTxt("20h00-fin"), "20 h 00 – fin");
  assert.equal(horaireTxt("18h00-03h00"), "18 h 00 – 3 h 00");
  assert.equal(horaireTxt("toute la journée"), "toute la journée");
});

test("the panel's lines: authority, number and date; where; the cameras; the purposes", () => {
  assert.equal(enTete(complet), "Préfecture de police, arrêté n° 2026-01518 du 3 novembre 2026");
  assert.equal(enTete(aujourdhui), "Préfecture de police, arrêté n° 2026-1518 du 3 novembre 2026");
  assert.equal(
    enTete({ ...aujourdhui, acte: "ppparis:88445d1be87c:2026-01518", numero: undefined, autorite: "pref75" }),
    "Préfecture de Paris, arrêté",
  );
  assert.equal(autoriteTxt("pref13"), "Préfecture des Bouches-du-Rhône");
  assert.equal(autoriteTxt("pref69"), "Préfecture du Rhône");
  assert.equal(autoriteTxt("pref01"), "Préfecture de l'Ain");
  assert.equal(autoriteTxt("prefXX"), "Préfecture");
  assert.equal(dateActe("75-2026-11-03-00006"), "2026-11-03");
  assert.equal(dateActe("2A-2026-02-30-00001"), null);
  assert.equal(
    secteurPanneau(complet),
    "Secteur cité : 14e arrondissement, « aux abords des lycées et des universités »",
  );
  assert.equal(secteurPanneau(aujourdhui), "");
  assert.equal(
    zonePanneau(complet),
    "Zone : 3 périmètres sur des plans annexés à l'arrêté, que le registre ne lit pas",
  );
  assert.equal(zonePanneau(aujourdhui), "Zone : sur un plan annexé à l'arrêté, que le registre ne lit pas");
  assert.equal(zonePanneau({ ...aujourdhui, zone: "non_lue" }), "Zone : non lue, l'arrêté ne permet pas de la tracer");
  assert.equal(camerasTxt(complet), "6, soit 2 par périmètre");
  assert.equal(camerasTxt({ ...complet, n_perimetres: 4 }), "6");
  assert.equal(camerasTxt({ ...complet, cameras: undefined }), "");
  assert.deepEqual(finalitesTxt(complet), [
    "prévention des atteintes à la sécurité des personnes et des biens",
    "sécurité des rassemblements de personnes",
  ]);
  assert.deepEqual(finalitesTxt(aujourdhui), []);
});

test("the map's board B pieces: the label on the free part of the edge, a hatching the map shows through", () => {
  // a rectangle's edge on the screen; the free part leaves out its right side (the panel)
  const pts: [number, number][] = [
    [100, 100],
    [300, 100],
    [500, 100],
    [500, 300],
    [300, 300],
    [100, 300],
  ];
  const cadre = { x0: 50, y0: 50, x1: 350, y1: 350 };
  const p = poseBord(pts, cadre, null);
  assert.equal(p?.i, 0); // the leftmost free point
  assert.ok(p && p.angle > -90 && p.angle <= 90); // read from left to right
  // kept while it stays free (no jump as the map moves), never where the panel is
  assert.equal(poseBord(pts, cadre, 5)?.i, 5);
  assert.equal(poseBord(pts, cadre, 2)?.i, 0);
  assert.equal(poseBord(pts, { x0: 600, y0: 0, x1: 700, y1: 50 }, null), null);
  const h = hachuresSecteur("#2c6f9e");
  assert.equal(h.width, 14);
  const alpha = [...h.data].filter((_, i) => i % 4 === 3);
  // its lines opaque, the rest the board's light blue at 22 %: the cameras under it stay seen
  assert.ok(alpha.every((a) => a === 255 || a === 56));
  assert.ok(alpha.filter((a) => a === 56).length > alpha.length / 2);
  assert.deepEqual([...pave("#2c6f9e", 2).data.slice(0, 4)], [0x2c, 0x6f, 0x9e, 255]);
});
