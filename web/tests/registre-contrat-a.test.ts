// A document's record in theme A (board Contrat-Lyon-2026-A, lot 3): what it computes from the
// document's file and its buyer's (vues/contrat-a.ts). Every file below is SYNTHETIC, shaped as
// the build writes document/<affaire>.json and acheteur/<siren>.json; no source's data.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Evenement } from "../src/registre/donnees.ts";
import {
  aVerifier,
  acheteurStats,
  ajouteMois,
  avancement,
  avant,
  communDebut,
  cpvDe,
  documents,
  dureeAnnoncee,
  ecart,
  avecAujourdhui,
  etapes,
  type FichierAcheteur,
  hote,
  jours,
  lotsAvis,
  mixte,
  modifs,
  naturesDe,
  offres,
  procedure,
  refCourte,
} from "../src/registre/vues/contrat-a.ts";
import type { Fichier } from "../src/registre/vues/contrat-outils.ts";

const ev = (e: Partial<Evenement> & { id: string; t: string }): Evenement =>
  ({ affaire: "C1", insee: "69999", dep: "69", entreprises: [], copie: false, ...e }) as Evenement;
const vide = { fin_prevue: null, precedent: null, suivant: null, entreprises: {}, contrat: null };

/** A framework agreement as the board draws it: call for tenders, contract, one modification,
 * award notice, planned end. */
function fichier(more: { evenements?: Evenement[]; affaire?: Record<string, unknown> } = {}): Fichier {
  const evenements = more.evenements ?? [
    ev({ id: "A1", t: "avis", date: "2025-06-27", ref: "BOAMP 25-1", url: "https://www.boamp.fr/a1", procedure: "open", duree_mois: 24 }),
    ev({ id: "C1~0", t: "attribution", date: "2026-01-06", montant: 2e7, duree: "48", ref: "DECP 21699999900012026Q0001A_50324100", url: "https://www.data.gouv.fr/x", compte: true }),
    ev({ id: "C1~1", t: "modification", date: "2026-01-08", montant: 2e7, duree: "48", modif_n: 1, changements: [] }),
    ev({ id: "R1", t: "resultat", date: "2026-01-18", ref: "BOAMP 26-2", offres: 2, procedure: "open" }),
  ];
  const a = {
    id: "C1",
    kind: "contrat",
    events: evenements.filter((e) => e.affaire === "C1").map((e) => e.id),
    ...more.affaire,
  };
  return {
    v: 1,
    affaire: a,
    evenements,
    affaires: { C1: a },
    entreprises: {},
    acheteurs: {},
    communes: {},
    libelles: {},
    parcours: { ...vide, fin_prevue: { date: "2030-01-06", signature: "2026-01-06", mois: 48 } },
  } as unknown as Fichier;
}

test("the parcours: each document in its order, its real gap from the one before, the planned end", () => {
  const E = etapes(fichier());
  assert.deepEqual(
    E.map((s) => [s.k, s.date, s.ecart && `${s.ecart.n} ${s.ecart.u}`]),
    [
      ["avis", "2025-06-27", null],
      ["contrat", "2026-01-06", "193 jours"],
      ["modif", "2026-01-08", "2 jours"],
      ["attr", "2026-01-18", "10 jours"],
      ["fin", "2030-01-06", "4 ans"],
    ],
  );
  assert.equal(E[2].n, 1, "the modification's number");
  assert.equal(E[4].n, 48, "the planned end: signature + the published months");
});

test("a step drawn before one it follows in time (the planned end before the last modification): no gap", () => {
  const evs = [
    ev({ id: "C1~0", t: "attribution", date: "2022-08-01", montant: 1e6, duree: "12" }),
    ...[1, 2, 3].map((n) => ev({ id: `C1~${n}`, t: "modification", date: `2023-0${n + 6}-01`, modif_n: n })),
  ];
  const f = fichier({ evenements: evs });
  (f.parcours as { fin_prevue: unknown }).fin_prevue = { date: "2023-08-01", signature: "2022-08-01", mois: 12 };
  const E = etapes(f);
  assert.deepEqual(E.map((s) => s.k), ["contrat", "modif", "fin"]);
  assert.equal(E[2].ecart, null, "the end comes before the last modification (2023-09-01)");
});

test("today, the build's day, among the steps: before the first one after it, its gaps the real ones", () => {
  const E = avecAujourdhui(etapes(fichier()), "2026-11-10T05:11:00Z");
  assert.deepEqual(
    E.map((s) => [s.k, s.date, s.ecart && `${s.ecart.n} ${s.ecart.u}`]),
    [
      ["avis", "2025-06-27", null],
      ["contrat", "2026-01-06", "193 jours"],
      ["modif", "2026-01-08", "2 jours"],
      ["attr", "2026-01-18", "10 jours"],
      ["auj", "2026-11-10", "296 jours"],
      ["fin", "2030-01-06", "38 mois"],
    ],
  );
  // past the planned end: today at the end
  const fini = avecAujourdhui(etapes(fichier()), "2031-01-06");
  assert.deepEqual(fini.slice(-2).map((s) => [s.k, s.ecart && `${s.ecart.n} ${s.ecart.u}`]), [
    ["fin", "4 ans"],
    ["auj", "1 ans"],
  ]);
  assert.equal(avecAujourdhui(etapes(fichier()), "").length, 5, "no build day: unchanged");
});

test("a gap under a year in days, then whole years or months", () => {
  assert.equal(jours("2025-06-27", "2026-01-06"), 193);
  assert.deepEqual(ecart(147), { n: 147, u: "jours" });
  assert.deepEqual(ecart(jours("2026-01-18", "2030-01-06")), { n: 4, u: "ans" });
  assert.deepEqual(ecart(548), { n: 18, u: "mois" });
  assert.deepEqual(ecart(-3), { n: 0, u: "jours" }, "never a negative gap");
});

test("more than two modifications are one step, from the first to the last; the documents keep each", () => {
  const evs = [
    ev({ id: "C1~0", t: "attribution", date: "2022-03-10", montant: 1e6, duree: "36" }),
    ...[1, 2, 3, 4].map((n) =>
      ev({ id: `C1~${n}`, t: "modification", date: `2023-0${n}-01`, montant: 1e6, modif_n: n }),
    ),
  ];
  const f = fichier({ evenements: evs });
  const E = etapes(f);
  assert.deepEqual(E.map((s) => s.k), ["contrat", "modif", "fin"]);
  assert.equal(E[1].n, 4);
  assert.equal(E[1].date, "2023-01-01");
  assert.equal(E[1].jusqu, "2023-04-01");
  assert.equal(E[1].id, "C1~4", "the step opens the last one");
  assert.deepEqual(documents(f).map((s) => s.id), ["C1~0", "C1~1", "C1~2", "C1~3", "C1~4"]);
});

test("a copy and a re-sent contract are not steps; a probable call for tenders is, marked", () => {
  const evs = [
    ev({ id: "P1", t: "avis", date: "2021-09-01", affaire: "avis-P" }),
    ev({ id: "C1~0", t: "attribution", date: "2022-03-10", montant: 1e6 }),
    ev({ id: "C1~0b", t: "attribution", date: "2022-03-12", montant: 1e6 }),
    ev({ id: "X", t: "modification", date: "2022-04-01", copie: true }),
  ];
  const f = fichier({ evenements: evs, affaire: { avis_probables: ["avis-P"] } });
  (f.affaires as Record<string, unknown>)["avis-P"] = { id: "avis-P", events: ["P1"] };
  const E = etapes(f);
  assert.deepEqual(E.map((s) => [s.k, s.id, s.probable]), [
    ["avis", "P1", true],
    ["contrat", "C1~0", false],
    ["fin", "", false],
  ]);
  assert.equal(E[0].affaire, "avis-P");
});

test("the execution at the build's day: whole months gone, the share of its days, never past the end", () => {
  const a = avancement("2026-01-06", 48, "2026-11-08");
  assert.deepEqual(
    { fin: a?.fin, ecoules: a?.ecoules, total: a?.total, etat: a?.etat },
    { fin: "2030-01-06", ecoules: 10, total: 48, etat: "cours" },
  );
  assert.ok(a && a.pct > 20 && a.pct < 21.5);
  assert.equal(avancement("2020-01-01", 12, "2026-11-08")?.pct, 100);
  assert.equal(avancement("2020-01-01", 12, "2026-11-08")?.etat, "fini");
  assert.equal(avancement("2027-01-01", 12, "2026-11-08")?.etat, "avant");
  assert.equal(avancement("2027-01-01", 12, "2026-11-08")?.pct, 0);
  assert.equal(avancement("2026-01-06", 0, "2026-11-08"), null);
  assert.equal(ajouteMois("2024-01-31", 1), "2024-02-29", "a month without the day: its last");
});

test("the offers: the contract's own, else the award notice's, else its lots' range", () => {
  const f = fichier();
  const evs = f.evenements;
  const att = evs[1];
  assert.deepEqual(offres(evs, att), { n: 2, min: 2, max: 2, lots: 0, source: "avis", ref: "BOAMP 26-2" });
  assert.equal(offres(evs, { ...att, offres: 5 } as Evenement)?.source, "decp");
  const lots = [ev({ id: "R", t: "resultat", resultats_lots: [{ lot: 1, offres: 1 }, { lot: 2, offres: 4 }, { lot: 3 }] })];
  assert.deepEqual(offres(lots, null), { n: 4, min: 1, max: 4, lots: 2, source: "avis", ref: "" });
  assert.equal(offres([], null), null);
});

test("the procedure and the duration the notices publish", () => {
  const evs = fichier().evenements;
  assert.deepEqual(procedure(evs), { code: "open", ref: "BOAMP 25-1" });
  assert.deepEqual(dureeAnnoncee(evs), { mois: 24, ref: "BOAMP 25-1" });
  assert.equal(procedure([evs[1]]), null);
  assert.equal(dureeAnnoncee([]), null);
});

test("a mixed contract by its `mixte`; out of the totals only when not counted for it", () => {
  assert.equal(mixte(ev({ id: "a", t: "attribution" })), null);
  assert.deepEqual(
    mixte(ev({ id: "a", t: "attribution", mixte: "surete", compte: false, hors_totaux: "mixte_surete" })),
    { famille: "surete", horsTotaux: true },
  );
  assert.deepEqual(mixte(ev({ id: "a", t: "attribution", mixte: "autres", compte: true, hors_totaux: "" })), {
    famille: "autres",
    horsTotaux: false,
  });
});

test("a rise to check: the signature's amount and the highest after it", () => {
  const evs = [
    ev({ id: "c", t: "attribution", montant: 176883, a_verifier: "erreur_saisie_probable" }),
    ev({ id: "m", t: "modification", montant: 4e6, a_verifier: "erreur_saisie_probable" }),
  ];
  assert.deepEqual(aVerifier(evs), { de: 176883, a: 4e6 });
  assert.equal(aVerifier(fichier().evenements), null);
});

test("what the modifications change: nothing readable, or the amount and duration after the last", () => {
  const evs = fichier().evenements;
  const m = modifs(evs, evs[1]);
  assert.equal(m.n, 1);
  assert.ok(m.muettes);
  assert.equal(m.derniere, "2026-01-08");
  const plus = [
    evs[1],
    ev({ id: "m2", t: "modification", date: "2026-05-01", montant: 2.4e7, duree: "48", changements: ["montant"] }),
  ];
  const p = modifs(plus, evs[1]);
  assert.ok(!p.muettes);
  assert.equal(p.montant, 2.4e7);
  assert.deepEqual(p.changements, ["montant"]);
  assert.equal(modifs([evs[1]], evs[1]).muettes, false, "no modification: nothing to say");
});

test("a DECP reference without the buyer's SIRET and the CPV code; the source's site", () => {
  assert.equal(refCourte("DECP 216901231000112026Q7321A_50324100"), "DECP 2026Q7321A");
  assert.equal(
    refCourte("DECP 216901231000112026Q7321A_50324100, modification 1"),
    "DECP 2026Q7321A, modification 1",
  );
  assert.equal(refCourte("BOAMP 25-71998"), "BOAMP 25-71998");
  assert.equal(hote("https://www.boamp.fr/pages/avis/?q=1"), "boamp.fr");
  assert.equal(hote("https://www.data.gouv.fr/datasets/x"), "data.gouv.fr");
  assert.equal(hote(""), "");
});

test("the previous contract as the buyer's file groups it: its lots, their sum, their objet, their modifications", () => {
  const P = {
    ...vide,
    precedent: { affaire: "L2", date: "2022-03-10", date_a_verifier: false, entreprises: ["111111111"], montant: 6e6 },
  };
  assert.deepEqual(avant(P, null), {
    affaire: "L2",
    annee: "2022",
    titre: "",
    lots: 1,
    montant: 6e6,
    entreprises: ["111111111"],
    modifs: 0,
  });
  const A: FichierAcheteur = {
    acheteur: { n_contrats: 3, montant: 1.2e7 },
    evenements: [
      ev({ id: "L1~0", t: "attribution", date: "2022-03-10", affaire: "L1" }),
      ev({ id: "L1~1", t: "modification", affaire: "L1" }),
      ev({ id: "L2~0", t: "attribution", date: "2022-03-10", affaire: "L2" }),
      ev({ id: "L2~1", t: "modification", affaire: "L2" }),
      ev({ id: "L2~2", t: "modification", affaire: "L2" }),
      ev({ id: "O~0", t: "attribution", date: "2018-05-02", affaire: "O" }),
    ],
    affaires: { L1: { events: ["L1~0", "L1~1"] }, L2: { events: ["L2~0", "L2~1", "L2~2"] }, O: { events: ["O~0"] } },
    stats: { n: 3, montant: 1.2e7, contrats: ["L1~0", "L2~0", "O~0"] },
    lots: {
      G: {
        somme: 1e7,
        membres: [
          { affaire: "L1", objet: "Fourniture et maintenance des systèmes-Lot 1-Maintenance" },
          { affaire: "L2", objet: "Fourniture et maintenance des systèmes-Lot 2-Fourniture" },
        ],
      },
    },
  };
  const x = avant(P, A);
  assert.equal(x?.titre, "Fourniture et maintenance des systèmes");
  assert.equal(x?.lots, 2);
  assert.equal(x?.montant, 1e7);
  assert.equal(x?.modifs, 3);
  assert.deepEqual(acheteurStats(A), { n: 3, montant: 1.2e7, depuis: "2018" });
  assert.equal(acheteurStats(null), null);
});

test("the words several objets begin with, cut at a whole word", () => {
  assert.equal(communDebut(["Vidéoprotection, lot 1 : caméras", "Vidéoprotection, lot 2 : réseau"]), "Vidéoprotection");
  assert.equal(communDebut(["Maintenance des caméras", "Maintenance des capteurs"]), "Maintenance des");
  assert.equal(communDebut(["Un seul objet"]), "Un seul objet");
  assert.equal(communDebut([]), "");
});

test("the previous call for tenders' lots, as the build lists them: their number, the sum published, their holders", () => {
  const lot = (affaire: string, montant: number | null, entreprises = ["111111111"]) => ({ affaire, date: "2022-03-10", entreprises, montant });
  const P = {
    ...vide,
    precedent: {
      affaire: "L2",
      date: "2022-03-10",
      date_a_verifier: false,
      entreprises: ["111111111"],
      montant: 6e6,
      lots: [lot("L1", 4e6), lot("L2", 6e6, ["111111111", "222222222"])],
    },
  };
  const x = avant(P, null);
  assert.equal(x?.lots, 2);
  assert.equal(x?.montant, 1e7);
  assert.deepEqual(x?.entreprises, ["111111111", "222222222"]);
  // the buyer's file gives the common objet and the modifications, never another sum or count
  const A: FichierAcheteur = {
    acheteur: {},
    evenements: [ev({ id: "L1~1", t: "modification", affaire: "L1" }), ev({ id: "L2~1", t: "modification", affaire: "L2" })],
    affaires: {
      L1: { titre: "Vidéoprotection-Lot 1-Maintenance", events: ["L1~1"] },
      L2: { titre: "Vidéoprotection-Lot 2-Fourniture", events: ["L2~1"] },
    },
    lots: { G: { somme: 9e9, membres: [{ affaire: "L2" }, { affaire: "L9" }, { affaire: "L8" }] } },
  };
  const y = avant(P, A);
  assert.equal(y?.titre, "Vidéoprotection");
  assert.equal(y?.lots, 2);
  assert.equal(y?.montant, 1e7);
  assert.equal(y?.modifs, 2);
  // a lot without a published amount: the sum of the others; none published: not published
  assert.equal(avant({ ...P, precedent: { ...P.precedent, lots: [lot("L1", null), lot("L2", 6e6)] } }, null)?.montant, 6e6);
  assert.equal(avant({ ...P, precedent: { ...P.precedent, lots: [lot("L1", null), lot("L2", null)] } }, null)?.montant, null);
  // [] : the previous contract alone
  assert.equal(avant({ ...P, precedent: { ...P.precedent, lots: [] } }, null)?.lots, 1);
  assert.equal(avant({ ...P, precedent: { ...P.precedent, lots: [] } }, null)?.montant, 6e6);
});

test("a document's natures: its own, else the dossier's; known keys in their order, « autre » only alone", () => {
  const att = ev({ id: "C1~0", t: "attribution", natures: ["maintenance", "fourniture_installation"] });
  const avis = ev({ id: "A1", t: "avis", natures: ["drones"] });
  assert.deepEqual(naturesDe(att, [avis, att]), ["fourniture_installation", "maintenance"]);
  assert.deepEqual(naturesDe(ev({ id: "C1~0", t: "attribution" }), [avis, att]), ["fourniture_installation", "maintenance", "drones"]);
  assert.deepEqual(naturesDe(ev({ id: "X", t: "avis", natures: ["autre", "lecture_plaques", "inconnue"] }), []), ["lecture_plaques"]);
  assert.deepEqual(naturesDe(ev({ id: "X", t: "avis", natures: ["autre"] }), []), ["autre"]);
  assert.deepEqual(naturesDe(null, [ev({ id: "Y", t: "avis", natures: ["drones"], copie: true })]), []);
});

test("the CPV codes: the contract's first, then the notices', each once, 8 digits only", () => {
  const att = ev({ id: "C1~0", t: "attribution", cpv: ["50324100"], ref: "DECP x" });
  const evs = [
    ev({ id: "A1", t: "avis", ref: "BOAMP 25-1", cpv: ["35125300", "50324100", "3512"] }),
    att,
    ev({ id: "C1~1", t: "modification", cpv: ["99999999"] }),
    ev({ id: "R1", t: "resultat", ref: "BOAMP 26-2", cpv: ["35125300", "48219700"] }),
  ];
  assert.deepEqual(cpvDe(evs, att), [
    { code: "50324100", contrat: true, avis: "BOAMP 25-1" },
    { code: "35125300", contrat: false, avis: "BOAMP 25-1" },
    { code: "48219700", contrat: false, avis: "BOAMP 26-2" },
  ]);
  assert.deepEqual(cpvDe([], null), []);
});

test("a notice's lots: how many, and the duration, renewals and price weight they all share", () => {
  const l = (o: Record<string, unknown>) => ({ lot: "LOT-1", titre: "Lot", criteres: [], ...o });
  assert.deepEqual(lotsAvis(ev({ id: "R", t: "resultat", lots: [l({ titre: " Caméras ", duree_mois: 24, reconductions: 0, poids_prix: 35 })] })), {
    n: 1,
    titres: ["Caméras"],
    duree: 24,
    reconductions: 0,
    prix: 35,
  });
  const deux = lotsAvis(
    ev({ id: "R", t: "avis", lots: [l({ duree_mois: 47.7, reconductions: 3, poids_prix: 40 }), l({ duree_mois: 48, reconductions: null, poids_prix: 60 })] }),
  );
  assert.equal(deux?.n, 2);
  assert.equal(deux?.duree, 48);
  assert.equal(deux?.reconductions, null);
  assert.equal(deux?.prix, null);
  assert.equal(lotsAvis(ev({ id: "R", t: "avis" })), null);
});
