// The way back from OpenStreetMap as the page reads it (src/account/back.ts parseReturn):
// the outcome, the failure's reason (shown only under ?debug=1, never anything the server
// did not name) and the unannounced address of the password form.
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseReturn } from "../src/account/back.ts";

test("a failed return keeps its reason; the codes are the contract's", () => {
  assert.deepEqual(parseReturn("?osm=failed&osm_why=client_refuse"), {
    outcome: "failed",
    why: "client_refuse",
    password: false,
  });
  for (const why of ["flux_inconnu", "echange_refuse", "id_token", "reseau", "droits"])
    assert.equal(parseReturn(`?osm=write_failed&osm_why=${why}`).why, why);
});

test("an unknown reason or outcome is dropped, never shown", () => {
  assert.equal(parseReturn("?osm=failed&osm_why=<b>x</b>").why, null);
  assert.equal(parseReturn("?osm=failed&osm_why=").why, null);
  assert.equal(parseReturn("?osm=nope&osm_why=reseau").outcome, null);
  assert.deepEqual(parseReturn(""), { outcome: null, why: null, password: false });
});

test("the other outcomes read as before, without a reason", () => {
  assert.deepEqual(parseReturn("?cam=n1&osm=signup"), {
    outcome: "signup",
    why: null,
    password: false,
  });
  assert.equal(parseReturn("?osm=signed").outcome, "signed");
  assert.equal(parseReturn("?osm=denied").outcome, "denied");
});

test("a first sign-in while sign-ups are closed comes back as its own outcome", () => {
  assert.deepEqual(parseReturn("?osm=signups_closed"), {
    outcome: "signups_closed",
    why: null,
    password: false,
  });
});

test("?compte=motdepasse asks for the password form, nothing else does", () => {
  assert.equal(parseReturn("?compte=motdepasse").password, true);
  assert.equal(parseReturn("?compte=1").password, false);
  assert.equal(parseReturn("?ui=punk").password, false);
});
