// The participation data the captures are made on, written through the API as the accounts
// would (ana, bob, cara contribute; rev reviews; tess is a test account), then settled as a
// deploy of the CI build would. Every id is fixed, so that docs/interface.md can name them.
//   empty  no contribution at all;
//   full   the proposals, opinions, answers and decisions below, then the fixture's history
//          (tests/fixtures/contrib-ci.jsonl) posted with its own uuids where they are uuids,
//          validated, and settled with the CI build's outcome: applied, superseded, conflict.
import {
  api,
  BUILD,
  madeOnVersion,
  resetContributions,
  restore,
  settle,
  snapshot,
  testAuthor,
} from "./harness.mjs";

/** A point `dx` metres east and `dy` metres north of (lat, lon), as [lon, lat]. */
export function offset([lat, lon], dx, dy) {
  return [lon + dx / (111320 * Math.cos((lat * Math.PI) / 180)), lat + dy / 111320];
}

// Cameras of the CI extract (lat, lon) the seed speaks of.
export const CAM = {
  m1: { id: "n1925222793", at: [48.896012, 2.237935] }, // ana's move, no opinion
  m2: { id: "n1925222796", at: [48.896204, 2.237745] }, // ana's move, bob agrees, cara not
  n1: { id: "n1988182438", at: [48.896022, 2.237129] }, // bob: not found
  v1: { id: "n1925180682", at: [48.896503, 2.23823] }, // cara's move, validated
  x2: { id: "n2001233184", at: [48.896226, 2.238792] }, // ana's move and bob's not found
  rj: { id: "n1879237395", at: [48.895799, 2.240062] }, // bob's move, rejected
  wd: { id: "n1945922096", at: [48.899834, 2.240058] }, // cara's not found, withdrawn
  ts: { id: "n1879237460", at: [48.895992, 2.240031] }, // tess (test account): present
  dir: { id: "n5442645358", at: [48.898154, 2.237327] }, // ana: direction 120
  op: { id: "n9622344410", at: [48.897761, 2.239971] }, // bob: business
  ht: { id: "n13610509865", at: [48.900309, 2.241589] }, // cara: height, no tilt known
  e1: { id: "n1891366478", at: [48.895472, 2.238987] }, // fixture e1: conflict osm_version
};
// Adds (lat, lon of the requested point).
export const ADD = {
  a1: { uuid: "5eed0a01-0000-4000-8000-000000000001", at: [48.8981364, 2.2403746] }, // ana
  a2: { uuid: "5eed0a02-0000-4000-8000-000000000002", at: [48.8985, 2.2385] }, // bob, on site
  a3: { uuid: "5eed0a03-0000-4000-8000-000000000003", at: [48.899, 2.2405] }, // cara, validated
  dup: { uuid: "add00003-0000-4000-8000-000000000003", at: [48.8967592, 2.2384309] }, // bob
};
export const addedId = (uuid) => `c${uuid.replaceAll("-", "").slice(0, 12)}`;
export const U = {
  m1: "5eed0001-0000-4000-8000-000000000001",
  m2: "5eed0002-0000-4000-8000-000000000002",
  m2agree: "5eed0003-0000-4000-8000-000000000003",
  m2disagree: "5eed0004-0000-4000-8000-000000000004",
  n1: "5eed0005-0000-4000-8000-000000000005",
  v1: "5eed0006-0000-4000-8000-000000000006",
  x2move: "5eed0007-0000-4000-8000-000000000007",
  x2gone: "5eed0008-0000-4000-8000-000000000008",
  rj: "5eed0009-0000-4000-8000-000000000009",
  wd: "5eed000a-0000-4000-8000-00000000000a",
  ts: "5eed000b-0000-4000-8000-00000000000b",
  dir: "5eed000c-0000-4000-8000-00000000000c",
  op: "5eed000d-0000-4000-8000-00000000000d",
  ht: "5eed000e-0000-4000-8000-00000000000e",
  blank: "5eed000f-0000-4000-8000-00000000000f",
};

const base = (day, extra = {}) => ({
  build_id: BUILD,
  day,
  on_site: null,
  ...extra,
});
const post = (who, body) => api(who, "POST", "/api/contributions", body);
const decide = (uuid, decision) => api("rev", "POST", "/api/review/decide", { uuid, decision });
const move = (who, uuid, cam, [lon, lat], placement, day, extra = {}) =>
  post(who, { ...base(day, extra), uuid, kind: "move", camera: cam, lon, lat, placement });
const verify = (who, uuid, cam, answer, day, extra = {}) =>
  post(who, { ...base(day, extra), uuid, kind: "verify", camera: cam, answer });
const add = (who, a, placement, day, extra = {}) =>
  post(who, {
    ...base(day, extra),
    uuid: a.uuid,
    kind: "add",
    lon: a.at[1],
    lat: a.at[0],
    placement,
  });

// The fixture's history (tests/fixtures/contrib-ci.jsonl), where its ids are uuids: the
// requested points converted to lon/lat (EPSG:2154 -> 4326, pyproj), e1's brought within
// the 50 m a move allows (the fixture's is 48.6 m away, the API refuses beyond).
const FIXTURE = [
  ["ana", "move", "00000000-0000-4000-8000-0000000000a1", "n1925222790", [2.2376927, 48.8960306], "facade", "2026-09-12", true],
  ["bob", "move", "00000000-0000-4000-8000-0000000000b1", "n1923568246", [2.2399205, 48.8958845], "facade", "2026-09-10"],
  ["bob", "move", "00000000-0000-4000-8000-0000000000b2", "n1923568246", [2.239954, 48.8957409], "facade", "2026-09-14"],
  ["cara", "move", "00000000-0000-4000-8000-000000000091", "n1925167449", [2.2398567, 48.8958217], "free", "2026-09-15"],
  ["ana", "move", "00000000-0000-4000-8000-0000000000e1", "n1891366478", [2.23896, 48.8956], "free", "2026-09-20"],
  ["cara", "verify", "00000000-0000-4000-8000-0000000000c1", "n1925180657", "not_found", null, "2026-09-16"],
  ["ana", "verify", "00000000-0000-4000-8000-0000000000c2", "n1925180657", "present", null, "2026-10-01"],
  ["ana", "verify", "00000000-0000-4000-8000-0000000000d1", "n1923568277", "present", null, "2026-09-11"],
  ["bob", "verify", "00000000-0000-4000-8000-0000000000d2", "n1923568277", "not_found", null, "2026-09-18", true],
]; // biome-ignore format: a table

export const SEEDS = {
  async empty() {
    resetContributions();
  },

  async full() {
    // Made once through the API, then put back from its snapshot.
    if (restore("full")) return "restored";
    resetContributions();
    // Proposals waiting: moves, "not found", opinions.
    await move("ana", U.m1, CAM.m1.id, offset(CAM.m1.at, 6, -4), "facade", "2026-10-03");
    await move("ana", U.m2, CAM.m2.id, offset(CAM.m2.at, -7, 3), "free", "2026-10-02");
    await post("bob", {
      ...base("2026-10-04"),
      uuid: U.m2agree,
      kind: "agree",
      target: U.m2,
      camera: CAM.m2.id,
    });
    await post("cara", {
      ...base("2026-10-04"),
      uuid: U.m2disagree,
      kind: "disagree",
      target: U.m2,
      camera: CAM.m2.id,
    });
    await verify("bob", U.n1, CAM.n1.id, "not_found", "2026-10-03");
    await move("cara", U.v1, CAM.v1.id, offset(CAM.v1.at, 5, 5), "facade", "2026-10-01");
    await move("ana", U.x2move, CAM.x2.id, offset(CAM.x2.at, 8, 0), "free", "2026-10-04");
    await verify("bob", U.x2gone, CAM.x2.id, "not_found", "2026-10-05");
    await move("bob", U.rj, CAM.rj.id, offset(CAM.rj.at, 0, 10), "free", "2026-10-01");
    await verify("cara", U.wd, CAM.wd.id, "not_found", "2026-10-02");
    // Adds: ana's waits, bob's was made on site, cara's is validated.
    await add("ana", ADD.a1, "facade", "2026-10-04");
    await add("bob", ADD.a2, "free", "2026-10-03", { on_site: true });
    await add("cara", ADD.a3, "free", "2026-10-02");
    // "Compléter" answers (sheet and /revue only, never on the map).
    await post("ana", {
      ...base("2026-10-04"),
      uuid: U.dir,
      kind: "direction",
      camera: CAM.dir.id,
      direction: 120,
    });
    await post("bob", {
      ...base("2026-10-04"),
      uuid: U.op,
      kind: "operator",
      camera: CAM.op.id,
      answer: "business",
    });
    await post("cara", {
      ...base("2026-10-05"),
      uuid: U.ht,
      kind: "height",
      camera: CAM.ht.id,
      answer: "first",
    });
    await post("ana", {
      ...base("2026-10-05"),
      uuid: U.blank,
      kind: "shape",
      camera: CAM.op.id,
      answer: "unknown",
    });
    // A test account's contribution (marked "test" in /revue).
    testAuthor("tess");
    await verify("tess", U.ts, CAM.ts.id, "present", "2026-10-05");
    // The review: one validated, one rejected; the author withdraws one.
    await decide(U.v1, "validated");
    await decide(ADD.a3.uuid, "validated");
    await decide(U.rj, "rejected");
    await api("cara", "POST", "/api/contributions/withdraw", { uuid: U.wd });
    // The fixture's history, validated, then settled as the deploy of the CI build did.
    for (const [who, kind, uuid, camera, x, y, day, onSite] of FIXTURE) {
      const extra = onSite ? { on_site: true } : {};
      if (kind === "move") await move(who, uuid, camera, x, y, day, extra);
      else await verify(who, uuid, camera, x, day, extra);
      await decide(uuid, "validated");
    }
    await add("bob", ADD.dup, "free", "2026-10-03");
    await decide(ADD.dup.uuid, "validated");
    madeOnVersion("00000000-0000-4000-8000-0000000000e1", 2);
    const settled = settle();
    snapshot("full");
    return settled;
  },
};
