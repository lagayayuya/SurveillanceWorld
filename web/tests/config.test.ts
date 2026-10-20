// GET /api/config as the page reads it (src/config.ts parseConfig): the contract's fields;
// anything missing or of another type takes the defaults the page starts with offline
// (contributions and sign-ups open, no publishing, no publisher).
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_CONFIG, parseConfig } from "../src/config.ts";

test("the contract's answer reads as sent", () => {
  assert.deepEqual(
    parseConfig({
      contributions: false,
      signups: false,
      publish: true,
      sync: true,
      publisher: "Jo Exemple",
    }),
    { contributions: false, signups: false, publish: true, sync: true, publisher: "Jo Exemple" },
  );
  assert.deepEqual(
    parseConfig({ contributions: true, signups: true, publish: false, publisher: null }),
    { contributions: true, signups: true, publish: false, sync: false, publisher: null },
  );
});

test("sign-ups: closed when the API says so, or when contributions are; open by default", () => {
  assert.equal(parseConfig({ contributions: true, signups: false }).signups, false);
  assert.equal(parseConfig({ contributions: false, signups: true }).signups, false);
  assert.equal(parseConfig({ contributions: true }).signups, true);
});

test("missing or malformed fields take the defaults", () => {
  for (const bad of [null, undefined, "x", 3, [], {}])
    assert.deepEqual(parseConfig(bad), DEFAULT_CONFIG);
  assert.deepEqual(parseConfig({ contributions: "no", publish: "yes", sync: 1, publisher: 7 }), DEFAULT_CONFIG);
});

test("an empty or blank publisher shows nothing", () => {
  assert.equal(parseConfig({ publisher: "" }).publisher, null);
  assert.equal(parseConfig({ publisher: "   " }).publisher, null);
  assert.equal(parseConfig({ publisher: " Jo " }).publisher, "Jo");
});
