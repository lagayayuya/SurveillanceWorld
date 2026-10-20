// The account routes of the lot « comptes » answered by the page itself (Playwright route
// mocks), for the account screen, the leaderboard (board 26a): smoke-profile.mjs,
// the states catalogue and the fidelity captures. The data is the boards' example (ju_93,
// « 38 acceptées », the ten places of 26a) on cameras of the CI extract, so that their
// sheets open; the lot's contract (GET /api/me, /api/me/score,
// /api/leaderboard with its scale, PUT /api/me/leaderboard, GET /api/me/export, POST
// /api/me/delete, DELETE
// /api/session, GET /api/me/contributions). Nothing leaves the browser: a send to
// POST /api/contributions fails as offline, so that what waits on the phone stays there.

/** GET /api/me/export's file name and an answer of its shape (the launch lot's contract). */
export const EXPORT_FILE = "surveillance-world-mes-donnees.json";
export const EXPORT = {
  exported_on: "2026-10-13",
  account: { pseudonym: "", since: "2026-03", role: "contributor", password: true },
  contributions: [{ uuid: "4c2f0d8e-1d2a-4b6e-9f3a-5b7c8d9e0f1a", kind: "verify" }],
  points: { by_month: [], pending: 0 },
  sessions: { count: 1, expires_on: ["2026-11-12"] },
};

/** CI cameras near the extract's cluster (states/catalogue.mjs). */
export const CAMS = {
  dome: "n1925222790", // moved and seen on site
  fixed: "n1879237466", // public wall tube
  ptz: "n1923568277", // verified gone, on site
  shop: "n1925180657",
  old: "n2001235418",
  queued: "n1864927349",
};
/** The cluster of the extract, where the profile is opened (its cameras' tiles loaded). */
export const AT = "#17.6/48.8963/2.2386";
export const PASSWORD = "correct horse battery staple";

const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
/** « Mes caméras » (lot U): the cameras of the mock's contributions as the CI extract has
 * them (their kind, the nearest named street, where they stand), and an add the review
 * refused. GET /api/me/contributions' `cameras`. */
export const DOME_CAM = "n998633844"; // a dome of the Ville de Courbevoie
export const UNKNOWN_CAM = "n9622344410";
export const REFUSED_ADD = "c5eed0a0f0001";
const lab = (kind, operator, street, commune, at, extra = {}) => ({
  label: {
    ...{ add: false, built: true, kind, operator },
    ...{ operator_class: operator ? "public" : null, street, commune },
    ...extra,
  },
  at,
});
const PLACES = {
  [CAMS.dome]: lab("fixed", null, "Avenue de l'Arche", "Courbevoie", [2.237693, 48.896031]),
  [CAMS.fixed]: lab(
    "fixed",
    null,
    "Boulevard de la Mission Marchand",
    "Courbevoie",
    [2.239968, 48.896425],
  ),
  [CAMS.ptz]: lab("fixed", null, "Place Samuel de Champlain", "Courbevoie", [2.239842, 48.895771]),
  [CAMS.shop]: lab("fixed", null, "Avenue de l'Arche", "Puteaux", [2.238198, 48.896119]),
  [CAMS.old]: lab("fixed", null, "Avenue de l'Arche", "Puteaux", [2.238238, 48.896392]),
  [CAMS.queued]: lab("fixed", null, "Rue Alexis Séon", "Courbevoie", [2.239254, 48.897241]),
  [DOME_CAM]: lab(
    "dome",
    "Ville de Courbevoie",
    "Place des Trois Frères Lebeuf",
    "Courbevoie",
    [2.238583, 48.897281],
  ),
  [UNKNOWN_CAM]: lab(
    "unknown",
    null,
    "Boulevard de la Mission Marchand",
    "Courbevoie",
    [2.239971, 48.897761],
  ),
  [REFUSED_ADD]: lab(
    "dome",
    null,
    "Place des Trois Frères Lebeuf",
    "Courbevoie",
    [2.2381, 48.8975],
    { add: true, built: false },
  ),
};
export const LABELS = Object.fromEntries(Object.entries(PLACES).map(([k, v]) => [k, v.label]));
/** Where a contribution stands in « Mes caméras », as the API says it (app.py
 * collection_state), from its status and its publication. */
const stateOf = (status, osm) =>
  ({
    pending: "pending",
    conflict: "pending",
    validated: "validated",
    superseded: "validated",
    applied: osm?.state === "published" ? "osm" : "map",
    rejected: "refused",
  })[status] ?? null;
const c = (n, kind, camera, day, status, extra = {}) => ({
  uuid: uuid(n),
  kind,
  camera,
  day,
  status,
  answer: null,
  move_m: null,
  apply_build: null,
  direction: null,
  operator_name: null,
  batch: null,
  // GET /api/me/contributions: the camera's commune, where it stands, the others'
  // agreement; « Mes caméras » (lot U): on site, its publication, where it stands.
  commune: "Courbevoie",
  lng: PLACES[camera]?.at[0] ?? null,
  lat: PLACES[camera]?.at[1] ?? null,
  agree: null,
  disagree: null,
  on_site: true,
  osm: null,
  ...extra,
  state: stateOf(status, extra.osm),
});

/** 25b's journal on the CI cameras. */
export const CONTRIBUTIONS = [
  c(1, "move", CAMS.dome, "2026-10-04", "pending", { move_m: 7.2 }),
  c(2, "verify", CAMS.dome, "2026-09-18", "applied", {
    answer: "present",
    // Published on the test server, as GET /api/osm/sync's HISTORY says (changeset 12345).
    osm: { server: "dev", state: "published", month: "2026-10", changeset: 12345 },
  }),
  c(3, "direction", CAMS.fixed, "2026-10-02", "validated", { answer: null, direction: 0 }),
  c(4, "verify", CAMS.ptz, "2026-09-12", "conflict", { answer: "not_found" }),
  c(5, "add", CAMS.shop, "2026-08-21", "applied", { answer: null, commune: "Puteaux" }),
  c(6, "height", CAMS.shop, "2026-08-21", "applied", { answer: "first", commune: "Puteaux" }),
  c(7, "operator", CAMS.old, "2026-07-08", "superseded", {
    answer: "public",
    operator_name: "Ville de Paris",
    commune: "Puteaux",
  }),
];
/** The move others disputed: « Contestée ». */
export const CONTESTED = CONTRIBUTIONS[0];
/** « Mes caméras »' fuller collection (lot U): a dome checked on site and published on OSM,
 * an unknown kind's shape waiting, an add the review refused. */
export const COLLECTION = [
  ...CONTRIBUTIONS,
  c(8, "verify", DOME_CAM, "2026-10-09", "applied", {
    answer: "present",
    osm: { server: "live", state: "published", month: "2026-10", changeset: 98765 },
  }),
  c(9, "shape", UNKNOWN_CAM, "2026-10-11", "pending", { answer: "dome" }),
  c(10, "add", REFUSED_ADD, "2026-09-27", "rejected", { commune: null }),
];
/** GET /api/history's answer for the cameras of the mock (lot U): DOME_CAM's check,
 * published on OSM's live server. */
export const CAMERA_HISTORY = {
  [DOME_CAM]: [
    {
      what: "seen",
      month: "2026-10",
      on_site: true,
      by: null,
      osm: `https://www.openstreetmap.org/node/${DOME_CAM.slice(1)}/history`,
    },
  ],
};
// 26a's people: [pseudonym, this month's counts, every month's] by sort (add, info,
// correction, verification), its scale 50 / 10 / 20 / 10.
const PEOPLE = [
  ["rat_des_halles", [4, 30, 5, 14], [21, 140, 30, 88]],
  ["k.lenoir", [2, 41, 3, 9], [8, 212, 22, 30]],
  ["pigeon_vif", [6, 12, 2, 15], [30, 51, 12, 70]],
  ["ostinato", [1, 25, 6, 2], [4, 120, 40, 10]],
  ["ju_93", [3, 19, 2, 6], [12, 64, 9, 22]],
  ["nadia.r", [0, 14, 3, 3], [3, 80, 14, 12]],
  ["la_fouine", [5, 6, 0, 8], [19, 20, 3, 41]],
  ["vigie_nord", [0, 4, 2, 0], [1, 58, 20, 2]],
  ["mmbr_041", [0, 11, 1, 0], [0, 77, 5, 0]],
  ["bzh_cam", [2, 9, 1, 1], [9, 40, 6, 5]],
  ["grain", [1, 3, 0, 4], [2, 9, 2, 12]],
  ["cyclope", [1, 1, 0, 2], [3, 4, 1, 8]],
];
export const SCALE = {
  add: 50,
  info: 10,
  complete_bonus: 10,
  correction: 20,
  verification: 10,
  verification_on_site_only: true,
};
const KINDS = ["add", "info", "correction", "verification"];
const W = [SCALE.add, SCALE.info, SCALE.correction, SCALE.verification];
export const ME = "ju_93";

/** The OSM synchronisation (16/10): the write server (OSM's test server) and GET
 * /api/osm/sync's history, one contribution in each state « Compte » says, on the CI
 * cameras (labels as the API's: kind, operator, street, commune). The first five are
 * CONTRIBUTIONS' (the camera sheet's « Vos contributions » matches them by uuid). */
export const WRITE_URL = "https://master.apis.dev.openstreetmap.org";
const label = (kind, operator, street, extra = {}) => ({
  add: false,
  built: true,
  kind,
  operator,
  operator_class: operator ? "public" : null,
  street,
  commune: "Courbevoie",
  ...extra,
});
const DOME = label("dome", "Ville de Courbevoie", "Rue de Bezons");
const FIXED = label("fixed", "Ville de Courbevoie", "Boulevard de Verdun");
const SHOP = label("fixed", null, "Rue de Bezons", { operator_class: "private_outdoor" });
const h = (n, camera, lab, kind, status, state, month, extra = {}) => ({
  uuid: uuid(n),
  camera,
  label: lab,
  kind,
  status,
  state,
  changeset: null,
  reason: null,
  month,
  ...extra,
});
export const HISTORY = [
  h(1, CAMS.dome, DOME, "move", "pending", "waiting", "2026-10"),
  h(3, CAMS.fixed, FIXED, "direction", "validated", "waiting", "2026-10"),
  h(2, CAMS.dome, DOME, "verify", "applied", "gone", "2026-10", { changeset: 12345 }),
  h(201, CAMS.queued, FIXED, "shape", "applied", "waiting", "2026-10"),
  h(202, CAMS.fixed, FIXED, "shape", "applied", "gone", "2026-10"),
  h(203, CAMS.shop, SHOP, "operator", "applied", "conflict", "2026-10", { reason: "osm_value" }),
  h(
    5,
    CAMS.shop,
    label(null, null, "Rue de Bezons", { add: true, built: false }),
    "add",
    "applied",
    "conflict",
    "2026-10",
    { reason: "osm_duplicate" },
  ),
  h(204, CAMS.old, DOME, "move", "applied", "uncertain", "2026-10"),
  h(205, CAMS.ptz, FIXED, "direction", "applied", "sending", "2026-10"),
  h(206, CAMS.old, DOME, "operator", "applied", "kept_edited", "2026-10"),
  h(207, CAMS.ptz, FIXED, "verify", "applied", "kept_before", "2026-09"),
];
/** GET /api/osm/sync's answer: writing offered on the test server, the choice off. */
export const SYNC = {
  offered: true,
  server: "dev",
  url: WRITE_URL,
  suspended: false,
  on: false,
  since: null,
  last_error: null,
  history: [],
};
/** The choice on since October, its history. */
export const SYNC_ON = { ...SYNC, on: true, since: "2026-10", history: HISTORY };

const pointsOf = (counts) => Object.fromEntries(KINDS.map((k, i) => [k, counts[i] * W[i]]));

/** Install the routes on a page (or a context) before it loads. Options: `optIn`, the
 * account shown in the others' leaderboard (26a: yes); `offline`, every account route
 * fails as offline; `fail`, the paths that fail so ("/api/leaderboard"…); `scale`, the scale
 * the leaderboard's answer carries (the page must show it, not its own); `me`, the
 * account's counts by sort [this month, every month] (a low one puts it after the tenth);
 * `nobody`, no one in the leaderboard; `pending`, its points waiting for the review;
 * `slow`, milliseconds before the contributions answer. OSM lot 1: `osmLogin`, what GET
 * /api/osm/status says (off by default); `account`, `osm` and `password` added to GET
 * /api/me (absent by default, as an older API); POST /api/osm/unlink answers 204 when the
 * account has a password, 409 no_password otherwise, `unlinkFails` as offline. The OSM
 * synchronisation: `sync`, GET /api/osm/sync's answer (SYNC, SYNC_ON…; absent: not
 * offered); POST /api/osm/sync {on: true} asks the password of an account that has one
 * and answers a local stand-in of OSM's page (`enableFails`: offline; `syncError` [status,
 * code] instead), {on: false} turns it off and answers as GET, what may still leave gone
 * from the history (`disableFails`: offline). `syncHold` (on the state), a promise GET
 * /api/osm/sync waits for. `exportStatus` (on the state), GET /api/me/export's error status
 * instead of the file.
 * Lot U: `signed`, the choice GET /api/me says to show the pseudonym in the cameras' history
 * (absent by default: no switch), set by PUT /api/me/history-pseudonym (`signedFails`:
 * offline); `history`, GET /api/history's entries by camera (CAMERA_HISTORY by default);
 * `contributions` (COLLECTION for « Mes caméras »' fuller one).
 * `config`, GET /api/config's answer (contributions open, publishing and the
 * synchronisation offered by default).
 * Returns what the page asked (calls) and the state the routes keep. */
export async function mockProfile(target, opts = {}) {
  const state = {
    account: opts.account ? { ...opts.account } : null,
    optIn: opts.optIn ?? true,
    contributions: (opts.contributions ?? CONTRIBUTIONS).map((x) => ({ ...x })),
    contested: opts.contested ?? true,
    signed: opts.signed,
    deleted: false,
    sync: opts.sync ? { ...opts.sync, history: [...(opts.sync.history ?? [])] } : null,
    calls: [],
  };
  const month = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  };
  const people = PEOPLE.map((p) => (p[0] === ME && opts.me ? [ME, ...opts.me] : p));
  const board = (period, kind) => {
    const all = period === "all";
    const rows = people
      .filter(([p]) => !opts.nobody && (p !== ME || state.optIn))
      .map(([p, m, a]) => {
        const by = pointsOf(all ? a : m);
        const points = kind === "total" ? KINDS.reduce((s, k) => s + by[k], 0) : by[kind];
        return { pseudonym: p, points, me: p === ME };
      })
      .filter((r) => r.points > 0)
      .sort((x, y) => y.points - x.points || x.pseudonym.localeCompare(y.pseudonym))
      .map((r, i) => ({ rank: i + 1, ...r }));
    const top = rows.slice(0, 10);
    const mine = rows.find((r) => r.me && r.rank > 10);
    return {
      period,
      kind,
      rows: mine ? [...top, mine] : top,
      periods: [month(), "2026-09", "2026-08"],
      scale: opts.scale ?? SCALE,
    };
  };
  const score = (period) => {
    const [, m, a] = people.find(([p]) => p === ME);
    const counts = period === "all" ? a : m;
    const by = pointsOf(counts);
    const total = KINDS.reduce((s, k) => s + by[k], 0);
    const rank = state.optIn ? (board(period, "total").rows.find((r) => r.me)?.rank ?? null) : null;
    return {
      period,
      total,
      by,
      counts: Object.fromEntries(KINDS.map((k, i) => [k, counts[i]])),
      accepted: period === "all" ? 38 : 9,
      communes: 3,
      pending: opts.pending ?? 90,
      rank,
    };
  };
  await target.route("**/api/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    const method = req.method();
    let body = null;
    try {
      body = req.postDataJSON();
    } catch {}
    state.calls.push({ method, path, query: url.search, body });
    const json = (data, status = 200) => route.fulfill({ status, json: data });
    if (opts.offline && path !== "/api/proposals") return route.abort("internetdisconnected");
    if (opts.fail?.includes(path)) return route.abort("internetdisconnected");
    // GET /api/config (src/config.ts, the launch lot) offers publishing: OSM's write server
    // and the account are what the checks vary; `config` answers another site.
    if (path === "/api/config")
      return json(
        opts.config ?? { contributions: true, publish: true, sync: true, publisher: null },
      );
    if (path === "/api/me" && method === "GET")
      return state.deleted
        ? json({ error: "session" }, 401)
        : json({
            author: ME,
            pseudonym: ME,
            reviewer: false,
            role: "contributor",
            since: "2026-03",
            leaderboard: state.optIn,
            validation: "review",
            // Lot U: the choice to show one's pseudonym in the cameras' history, when the
            // options give it (absent by default, as an older API: no switch).
            ...(state.signed === undefined ? {} : { history_pseudonym: state.signed }),
            ...(state.account ?? {}),
          });
    if (path === "/api/me/history-pseudonym" && method === "PUT") {
      if (opts.signedFails) return route.abort("internetdisconnected");
      state.signed = Boolean(body?.on);
      return route.fulfill({ status: 204 });
    }
    // A camera's public history (lot U): `history` by camera, else none.
    if (path === "/api/history")
      return route.fulfill({
        status: 200,
        headers: { "Cache-Control": "no-store" },
        json: {
          camera: url.searchParams.get("camera"),
          history: (opts.history ?? CAMERA_HISTORY)[url.searchParams.get("camera")] ?? [],
        },
      });
    if (path === "/api/osm/status")
      return json({
        login: opts.osmLogin ?? false,
        server: opts.osmServer ?? "dev",
        write: Boolean(state.sync?.offered),
        write_server: state.sync?.server ?? null,
        write_url: state.sync?.url ?? null,
      });
    // The OSM synchronisation: the setting and its history.
    if (path === "/api/osm/sync" && method === "GET") {
      if (state.syncHold) await state.syncHold;
      return json(state.sync ?? { offered: false, history: [] });
    }
    if (path === "/api/osm/sync" && method === "POST") {
      if (body?.on === false) {
        if (opts.disableFails) return route.abort("internetdisconnected");
        if (state.sync) {
          state.sync.on = false;
          state.sync.since = null;
          state.sync.last_error = null;
          // What may still leave is listed only while the choice is on.
          state.sync.history = state.sync.history.filter((x) =>
            ["gone", "conflict", "uncertain", "sending"].includes(x.state),
          );
        }
        if (state.account) {
          state.account.sync = false;
          state.account.publish = false;
        }
        return json(state.sync ?? { offered: false, history: [] });
      }
      if (opts.enableFails) return route.abort("internetdisconnected");
      if (state.account?.password !== false && body?.password !== PASSWORD)
        return json({ error: "credentials" }, 401);
      if (opts.syncError) return json({ error: opts.syncError[1] }, opts.syncError[0]);
      return json({ url: "/fake-osm/authorize?state=write" });
    }
    // « Relier à OpenStreetMap »: the password again; OSM's page stood in by a local path.
    if (path === "/api/osm/link" && method === "POST") {
      if (body?.password !== PASSWORD) return json({ error: "credentials" }, 401);
      return json({ url: "/fake-osm/authorize?state=fictitious" });
    }
    if (path === "/api/osm/unlink" && method === "POST") {
      if (opts.unlinkFails) return route.abort("internetdisconnected");
      if (state.account?.password === false) return json({ error: "no_password" }, 409);
      if (state.account) state.account.osm = false;
      return route.fulfill({ status: 204 });
    }
    if (path === "/api/me/contributions") {
      if (opts.slow) await new Promise((r) => setTimeout(r, opts.slow));
      // « Contestée »: one opinion against the move, none for (as /revue counts it).
      const contributions = state.contributions.map((x) =>
        x.uuid === CONTESTED.uuid && state.contested ? { ...x, agree: 0, disagree: 1 } : x,
      );
      const cameras = Object.fromEntries(
        contributions.filter((x) => LABELS[x.camera]).map((x) => [x.camera, LABELS[x.camera]]),
      );
      return json({ author: ME, contributions, cameras });
    }
    if (path === "/api/me/score") return json(score(url.searchParams.get("period") ?? "all"));
    if (path === "/api/leaderboard")
      return json(
        board(url.searchParams.get("period") ?? month(), url.searchParams.get("kind") ?? "total"),
      );
    if (path === "/api/me/leaderboard" && method === "PUT") {
      state.optIn = Boolean(body?.on);
      return route.fulfill({ status: 204 });
    }
    if (path === "/api/me/password" && method === "POST") {
      if (body?.current !== PASSWORD) return json({ error: "credentials" }, 401);
      if ((body?.new ?? "").length < 12) return json({ error: "password_short" }, 400);
      return route.fulfill({ status: 204 });
    }
    // « Télécharger mes données »: the API's attachment (EXPORT), or `exportStatus`'s error.
    if (path === "/api/me/export" && method === "GET")
      return state.exportStatus
        ? json({ error: "session" }, state.exportStatus)
        : route.fulfill({
            status: 200,
            contentType: "application/json",
            headers: { "Content-Disposition": `attachment; filename="${EXPORT_FILE}"` },
            body: JSON.stringify({ ...EXPORT, account: { ...EXPORT.account, pseudonym: ME } }),
          });
    if (path === "/api/me/delete" && method === "POST") {
      // An account without a password (signed in with OSM) retypes its pseudonym.
      if (state.account?.password === false) {
        if (body?.pseudonym !== ME) return json({ error: "confirmation" }, 400);
      } else if (body?.password !== PASSWORD) return json({ error: "credentials" }, 401);
      state.deleted = true;
      return route.fulfill({ status: 204 });
    }
    if (path === "/api/session" && method === "DELETE") return route.fulfill({ status: 204 });
    if (path === "/api/proposals") {
      const camera = url.searchParams.get("camera");
      const features =
        state.contested && camera === CONTESTED.camera
          ? [
              {
                type: "Feature",
                geometry: { type: "Point", coordinates: [2.237693, 48.896031] },
                properties: {
                  ...{ u: CONTESTED.uuid, c: camera, k: "move", ck: "dome", s: "pending" },
                  ...{ month: CONTESTED.day.slice(0, 7), n: 0, d: 1, m: true, o: null, mv: 7.2 },
                },
              },
            ]
          : [];
      return json({ type: "FeatureCollection", features });
    }
    if (path === "/api/contributions/withdraw" && method === "POST") {
      const taken = state.contributions.find((x) => x.uuid === body?.uuid);
      if (taken) taken.status = "withdrawn";
      return json({ uuid: body?.uuid, status: "withdrawn", withdrawn: [] });
    }
    // A send: as offline, so that what waits on the phone stays there.
    if (path === "/api/contributions" && method === "POST")
      return route.abort("internetdisconnected");
    if (path === "/api/contributions") return json({ type: "FeatureCollection", features: [] });
    return json({ error: "not_found" }, 404);
  });
  return state;
}
