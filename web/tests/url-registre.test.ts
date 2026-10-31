// Where the map behind a register page opened cold starts (url.ts mapAtStart).
import assert from "node:assert/strict";
import { test } from "node:test";

// url.ts reads the page's address as it loads
(globalThis as { window?: unknown }).window ??= { location: new URL("http://localhost/") };
const { mapAtStart } = await import("../src/url.ts");

test("a commune's page shows its area on the map, its drone view frames it itself", () => {
  assert.equal(mapAtStart("/registre/commune/94081", ""), "/?insee=94081");
  assert.equal(mapAtStart("/registre/commune/2A004/autorisations/x", ""), "/?insee=2A004");
  // the drone view: no area asked of the map (no areas.json, no framing of the site's)
  assert.equal(mapAtStart("/registre/commune/94081/carte", "?mois=2026-10"), "/");
  assert.equal(mapAtStart("/registre/commune/94081/carte/", ""), "/");
  // the map's own address kept aside wins, only a query or a fragment
  assert.equal(mapAtStart("/registre/commune/94081/carte", `?carte=${encodeURIComponent("#13/45.7/4.9")}`), "/#13/45.7/4.9");
  assert.equal(mapAtStart("/registre/communes", `?carte=${encodeURIComponent("//evil.example/")}`), "/");
  assert.equal(mapAtStart("/registre/", ""), "/");
});
