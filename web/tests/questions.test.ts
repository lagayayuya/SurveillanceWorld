// Which "Compléter" questions a camera gets (src/participate/questions.ts), with the rules
// the build writes into meta.json (tiles.questions_rules, from rules/questions.yaml).
//   node --test --experimental-strip-types tests/
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type Asked,
  answerableFacts,
  asksOperator,
  editorAnswerable,
  editorAssumed,
  editorParts,
  fold,
  mountParts,
  questionsFor,
} from "../src/participate/questions.ts";

const Q = {
  shape_kinds: { dome: "dome", bullet: "fixed", ptz: "ptz", multi: "panorama" },
  direction_kinds: ["dome", "fixed", "unknown", "alpr"],
  operator_codes: ["unk", "pro", "pri"],
  category_unknown: ["private", "syndic d immeuble", "yes"],
  min_target_m: 5,
  height_m: { ground: 3, first: 5, upper: 8, pole: 5 },
  tilt_classes: ["horizon", "slight", "steep"],
  tilt_kinds: ["fixed"],
  editor_tilt_kinds: ["fixed", "dome"],
};
const cam = (over: Partial<Asked> = {}): Asked => ({ k: "dome", kc: 1, d: 90, o: "pro", ...over });

test("who films: asked for an unknown operator, never for a public one", () => {
  assert.equal(asksOperator(cam({ o: "unk" }), Q), true);
  assert.equal(asksOperator(cam({ o: "unk", opName: "Franprix" }), Q), true);
  assert.equal(asksOperator(cam({ o: "pub" }), Q), false);
});

test("who films: a private camera only while business or private individual is unknown", () => {
  assert.equal(asksOperator(cam(), Q), true); // private, no name
  assert.equal(asksOperator(cam({ o: "pri" }), Q), true);
  // A validated answer says it (tiles `ok`).
  assert.equal(asksOperator(cam({ ok: "h" }), Q), false);
  assert.equal(asksOperator(cam({ ok: "b" }), Q), false);
  // OSM says it: a name is a business, "Particulier" a private individual.
  assert.equal(asksOperator(cam({ opName: "BNP Paribas" }), Q), false);
  assert.equal(asksOperator(cam({ opName: "Particulier" }), Q), false);
  // Names that tell neither, compared folded.
  assert.equal(asksOperator(cam({ opName: "Syndic d'immeuble" }), Q), true);
  assert.equal(asksOperator(cam({ opName: "Privé" }), Q), false); // "prive" is not listed here
  assert.equal(asksOperator(cam({ opName: "PRIVATE" }), Q), true);
});

test("the three questions follow what is missing, the shape answer included", () => {
  const unknown = cam({ k: "unknown", kc: 0, d: -1, o: "unk" });
  assert.deepEqual(questionsFor(unknown, Q), ["shape", "direction", "operator"]);
  assert.deepEqual(questionsFor(unknown, Q, "ptz"), ["shape", "operator"]);
  assert.deepEqual(questionsFor(unknown, Q, "unknown"), ["shape", "direction", "operator"]);
  assert.deepEqual(questionsFor(cam({ d: -1, opName: "La Poste" }), Q), ["direction"]);
  assert.deepEqual(questionsFor(cam({ k: "ptz", d: -1, o: "pub" }), Q), []);
});

test("fold matches normalize.name_key", () => {
  assert.equal(fold("Syndic d'immeuble"), "syndic d immeuble");
  assert.equal(fold("  Crédit Agricole CIB "), "credit agricole cib");
});

test("height and tilt: a tube by default gets the height, then the tilt once one is chosen", () => {
  const tube = cam({ k: "fixed", o: "pub", hc: 0 });
  assert.deepEqual(questionsFor(tube, Q), ["mount"]);
  assert.deepEqual(mountParts(tube, Q, "fixed"), { height: true, tilt: false });
  assert.deepEqual(mountParts(tube, Q, "fixed", "first"), { height: true, tilt: true });
  // "Je ne sais pas" for the height: no tilt (it would change nothing).
  assert.deepEqual(mountParts(tube, Q, "fixed", "unknown"), { height: true, tilt: false });
  // An OSM height: the tilt alone; a known tilt too: no screen.
  assert.deepEqual(mountParts(cam({ k: "fixed", hc: 1 }), Q, "fixed"), {
    height: false,
    tilt: true,
  });
  assert.deepEqual(questionsFor(cam({ k: "fixed", o: "pub", hc: 1, t: "slight" }), Q), []);
});

test("height and tilt: a known tilt waiting for a height asks the height alone, any kind", () => {
  for (const k of ["fixed", "dome", "ptz", "unknown"]) {
    const c = cam({ k, d: -1, o: "pub", hc: 0, t: "steep" });
    assert.deepEqual(mountParts(c, Q, k), { height: true, tilt: false }, k);
    assert.ok(questionsFor(c, Q).includes("mount"), k);
  }
});

// The classique stays frozen: it reads tilt_kinds, the tube alone (tilt.classique_kinds);
// the punk editor reads editor_tilt_kinds, a small dome too (questions@5).
test("height and tilt: no screen for a dome, a PTZ, a panorama, a doorbell, an unknown kind", () => {
  for (const k of ["dome", "ptz", "panorama", "doorbell", "unknown"])
    assert.ok(!questionsFor(cam({ k, d: 90, o: "pub", hc: 0 }), Q).includes("mount"), k);
  // An unknown kind goes through the shape first; a tube answered brings the screen.
  const unknown = cam({ k: "unknown", kc: 0, d: -1, o: "pub", hc: 0 });
  assert.deepEqual(questionsFor(unknown, Q), ["shape", "direction"]);
  assert.deepEqual(questionsFor(unknown, Q, "bullet"), ["shape", "direction", "mount"]);
  assert.deepEqual(questionsFor(unknown, Q, "dome"), ["shape", "direction"]);
});

test("the sheet's « ? »: only on the facts a question can answer, whatever the shape", () => {
  const sorted = (c: Asked) => answerableFacts(c, Q).sort();
  // A public dome with a direction and a known height: nothing (its field of view and night
  // vision, defaults, are never asked).
  assert.deepEqual(sorted(cam({ o: "pub", hc: 1 })), []);
  // A public dome without a direction: the direction only.
  assert.deepEqual(sorted(cam({ o: "pub", d: -1, hc: 0 })), ["direction"]);
  // A fixed camera with a default height: height, then the tilt once it is known.
  assert.deepEqual(sorted(cam({ k: "fixed", o: "pub", hc: 0 })), ["height", "tilt"]);
  // Unknown type and operator, default height: a tube answered brings height and tilt.
  assert.deepEqual(sorted(cam({ k: "unknown", kc: 0, d: -1, o: "unk", hc: 0 })), [
    "direction",
    "height",
    "operator",
    "status",
    "tilt",
    "type",
  ]);
});

test("the punk editor: a height for every kind but the big ball, the tilt for a tube and a small dome", () => {
  const q = { ...Q, height_excluded_kinds: ["ptz"] };
  assert.deepEqual(editorParts(q, "dome"), { height: true, tilt: true });
  // A build made before questions@5 (no editor_tilt_kinds): no tilt for a dome.
  assert.deepEqual(editorParts({ ...q, editor_tilt_kinds: undefined }, "dome"), {
    height: true,
    tilt: false,
  });
  assert.deepEqual(editorParts(q, "unknown"), { height: true, tilt: false });
  assert.deepEqual(editorParts(q, "fixed"), { height: true, tilt: true });
  assert.deepEqual(editorParts(q, "ptz"), { height: false, tilt: false });
  // A build made before the rule: the height for every kind.
  assert.deepEqual(editorParts(Q, "ptz"), { height: true, tilt: false });
});

test("the punk « ? »: as soon as a value is assumed and the editor asks it", () => {
  const q = { ...Q, height_excluded_kinds: ["ptz"] };
  const sorted = (c: Asked) => editorAnswerable(c, q).sort();
  // A public dome with a direction and a default height: its height, which « Compléter »
  // never asks (a dome's height changes nothing computed alone).
  assert.deepEqual(sorted(cam({ o: "pub", hc: 0 })), ["height"]);
  assert.deepEqual(answerableFacts(cam({ o: "pub", hc: 0 }), Q), []);
  // Everything known: nothing.
  assert.deepEqual(sorted(cam({ o: "pub", hc: 1 })), []);
  // A private camera whose category nobody says: « Compléter » asks, the status is not
  // assumed (OSM says private).
  assert.deepEqual(sorted(cam({ hc: 1 })), []);
  // The big ball: no height, no direction asked.
  assert.deepEqual(sorted(cam({ k: "ptz", d: -1, o: "pub", hc: 0 })), []);
  // Unknown everything.
  assert.deepEqual(editorAssumed(cam({ k: "unknown", kc: 0, d: -1, o: "unk", hc: 0 }), q), [
    "shape",
    "direction",
    "mount",
    "operator",
  ]);
  assert.deepEqual(sorted(cam({ k: "unknown", kc: 0, d: -1, o: "unk", hc: 0 })), [
    "direction",
    "height",
    "operator",
    "status",
    "type",
  ]);
});
