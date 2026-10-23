// How each state of docs/interface.md is produced on the CI extract. `id` is the
// catalogue's (same order, by screen); `run(k, fx)` leaves the page in that state (k:
// states/kit.mjs; fx: tests/apiserver.py's fixtures, a camera near a facade and the
// "Compléter" cameras); `seed`: the participation data it needs (states/seed.mjs, `empty`
// by default); `writes`: it sends something to the API (the data is set again after it);
// `who`: the account (ana by default); `devices`: only on these; `landscape`: the phone held
// in landscape; `ui`: only in this interface; `cnil`: only with --cnil, from a build made
// with VITE_CNIL_SIGNAL=true (the private preview's); `geolocation`: the position the
// browser gives, with its permission.
// Journeys that would send but are captured before or without it answer the API's
// POST /api/contributions themselves (`fakeSend`): nothing is stored, the screens behave as
// online.
import {
  COLLECTION,
  DOME_CAM,
  mockProfile,
  PASSWORD,
  AT as PROFILE_AT,
  CAMS as PROFILE_CAMS,
  SYNC,
  SYNC_ON,
} from "../profile-mock.mjs";
import { holdAt, mockPoints } from "../score-kit.mjs";
import { api, BUILD } from "./harness.mjs";
import { ADD, addedId, CAM } from "./seed.mjs";

const hash = ([lat, lon], z = 18) => `#${z}/${lat}/${lon}`;
const cam = (c, extra = "", z = 18) => `?cam=${c.id}${extra}${hash(c.at, z)}`;
const C = (id, lat, lon) => ({ id, at: [lat, lon] });

// Cameras of the CI extract (tests/fixtures/ci.osm.pbf, contributions applied by the CI
// build from tests/fixtures/contrib-ci.jsonl).
const FIXED = C("n1879237466", 48.896425, 2.239968); // public wall tube, checked 2022
const NEVER = C("n1835838252", 48.896952, 2.239633); // no check date
const DOME = C("n5442645358", 48.898154, 2.237327); // public dome, no direction, default height
const UNKNOWN = C("n9622344410", 48.897761, 2.239971); // type and operator unknown
const HOUSEHOLD = C("n1864927349", 48.897241, 2.239254); // answer: a private individual
const INDOOR = C("n2001235418", 48.896392, 2.238238); // private indoor: no field at all
const NOFIELD = C("n1925222794", 48.8960185, 2.23791); // field under 10 m2 (tiles `pv`)
const CHECK = C("n1932117216", 48.896421, 2.239843); // the same, and an OSM check date
const OSM_MOUNT = C("n1925222792", 48.895987, 2.237501); // OSM height 6 m, camera:angle 45, CNIL
const ANSWERED_MOUNT = C("n12035135119", 48.897946, 2.233871); // height + tilt answered
const LAMP = C("n13610509865", 48.900309, 2.241589); // tube on a street lamp, default height
const GONE = C("n1923568277", 48.895771, 2.239842); // validated "introuvable", on site
const MOVED_ON_SITE = C("n1925222790", 48.896031, 2.237693);
const MOVED_OFF_SITE = C("n1923568246", 48.895741, 2.239954);
const SEEN_OFF_SITE = C("n1925180657", 48.896119, 2.238198);
const DIRECTION_ANSWERED = C("n998633844", 48.897282, 2.238582);
const OPERATOR_ANSWERED = C("n9622344411", 48.897581, 2.240147);
const ADDED_ON_SITE = C("cadd000010000", 48.895957, 2.240695);
const ADDED_ANSWERED = C("cadd000020000", 48.897519, 2.234453);
const STREET = [48.8963, 2.2382]; // the cluster of the extract
const FREE = [48.8981364, 2.2403746]; // a facade, no camera within 20 m
const NEAR = [48.8967635, 2.2384109]; // 1.8 m from n1925222797

// --- gestures shared by the states ---------------------------------------------------

const sheetBtn = (k, text) => k.page.locator("#sheet button", { hasText: text }).first();
// The sheet's facts: its rows (lot 3.2) and its box of
// default values.
const ROWS = "#sheet .sheet-facts";
const ASSUMED = "#sheet .sheet-assumed";

/** The punk sheet's paper scrolled by `px` (a phone's half-open sheet scrolls under its
 * head). */
const scrollPaper = async (k, px = 120) => {
  await k.page.evaluate((by) => {
    document.querySelector("#sheet .sheet-paper").scrollTop = by;
  }, px);
  await k.page.waitForTimeout(200);
};

/** The camera's sheet, opened by its ?cam= link (the phone at half height). */
const sheet = (k, c, extra = "") => k.open(cam(c, extra), { sheet: true });

/** Lot U: cara's validated move's camera (seed full), its sheet at its full height and its
 * « Historique » in view, once the API has answered. */
async function historySheet(k) {
  await sheet(k, CAM.v1);
  await k.page.waitForSelector('#sheet .sheet-history-slot[data-history="shown"]', {
    state: "attached",
    timeout: 15000,
  });
  await k.fullSheet();
  await k.show("#sheet .sheet-history");
}

/** Whether the build served shows the CNIL box (VITE_CNIL_SIGNAL=true): the sheet of a CI
 * camera whose tiles carry the signal, left open. Fails when its tiles no longer carry it
 * (`cnil`, what sheet.ts reads): no build would show the box there, and a preview build
 * would pass for one without it. */
export async function cnilShown(k) {
  await sheet(k, OSM_MOUNT);
  const signal = await k.page.evaluate(
    (id) =>
      window.__map
        .querySourceFeatures("detail", { sourceLayer: "cameras" })
        .find((c) => c.properties.id === id)?.properties.cnil,
    OSM_MOUNT.id,
  );
  if (Number(signal) !== 1)
    throw new Error(
      `${OSM_MOUNT.id} has no CNIL signal in the tiles served (cnil: ${signal}): the probe ` +
        "cannot tell a VITE_CNIL_SIGNAL=true build, give it a camera that has the signal",
    );
  return (await k.page.locator("#sheet .cnil").count()) > 0;
}

/** The filters panel: a full-screen layer opened by its button on a phone, always there on
 * a wide screen; punk: the machine (machine.ts), opened by the ticket's « Filtres et
 * légende » on both. */
async function filters(k) {
  await k.tap("#fab-filters");
  await k.page.waitForTimeout(500);
}

/** Punk: the machine closed again (its ×), the map seen whole. */
async function closeFilters(k) {
  await k.tap("#filters .panel-close");
  await k.page.waitForTimeout(500);
}

async function openFilters(k, target) {
  await k.open(target);
  await filters(k);
}

/** The street view without a sheet: on a wide screen the open sheet covers the floating
 * buttons. */
const street = (k) => k.open(hash(STREET, 16.5));
const PRUDENT = '#estimate button[aria-pressed="false"]';

/** Offline once the page and its tiles are in (no service worker: a page cannot load
 * offline). */
const offline = async (k) => {
  await k.context.setOffline(true);
  await k.page.waitForTimeout(300);
};

/** "Toujours là ?" then "Je ne la trouve pas" (twice: it asks to confirm). */
async function notFound(k) {
  await k.tap(sheetBtn(k, "Toujours là"));
  await k.tap(sheetBtn(k, "Je ne la trouve pas"));
  await k.tap(sheetBtn(k, "J'ai bien cherché"));
  await k.page.waitForSelector(".part-done");
  // Punk on site: 8a's ticket on the map, the sheet gone (held at rest); from afar (no
  // position here) it earns nothing: no scene, the sheet says so.
  if (await k.page.$("#score")) await scene(k);
  else await k.page.waitForTimeout(800);
}

// Punk (DECISIONS 2026-10-08): adding and « Modifier » are one component (modify.ts).
const editView = (k, view) =>
  k.page.waitForSelector(`#modify-panel[data-view="${view}"]`, { timeout: 20000 });
/** A step of the editor: [field] unfolds its line in « Modifier » when it is folded
 * (« position »: the position ticket; « direction »: then « Viser sur la carte »), [answer]
 * or [answer, part] taps a choice. */
async function editSteps(k, steps) {
  for (const [what, part] of steps) {
    if (what === "position" && !part) await k.tap('#modify-panel [data-field="position"]');
    else if (["shape", "direction", "mount", "tilt", "operator"].includes(what) && !part) {
      const line = k.page.locator(`#modify-panel .modify-line[data-field="${what}"]`);
      if (await line.evaluate((e) => e.tagName === "BUTTON")) await k.tap(line);
      if (what === "direction") await k.tap("#modify-aim-open");
    } else
      await k.tap(
        `#modify-panel :is(.modify-tile, .modify-chip)[data-answer="${what}"]${part ? `[data-part="${part}"]` : ""}`,
      );
    await k.page.waitForTimeout(400);
  }
}
/** « Modifier » on a camera (punk), from its sheet, then `steps` (editSteps). */
async function modify(k, c, steps = []) {
  await sheet(k, c);
  await k.tap("#part-modify");
  await editView(k, "sheet");
  await editSteps(k, steps);
  await k.page.waitForTimeout(1500);
}
/** The field the editor's send gives, drawn once the pin or the target stops. */
const editField = (k) =>
  k.page
    .waitForFunction(() => window.__map.querySourceFeatures("edit-field").length > 0, null, {
      timeout: 20000,
    })
    .catch(() => {});
/** « Modifier »'s position view on fx.camera, the map slid to `to` (lon, lat). */
async function editPosition(k, fx, to) {
  await modify(k, { id: fx.camera, at: [fx.at[1], fx.at[0]] }, [["position"]]);
  await editView(k, "position");
  if (to) await k.jump({ center: to }, 400);
  await editField(k);
  await k.page.waitForTimeout(1200);
}
/** « ＋ Ajouter » (punk) at (lat, lon): the position view; `here`: past it to the sheet
 * (or the duplicates). */
async function editAdd(k, at, here = false) {
  await k.open(hash(at, 18));
  await k.page.waitForSelector("#fab-add:not([hidden]):not([aria-disabled='true'])", {
    timeout: 30000,
  });
  await k.tap("#fab-add");
  await editView(k, "position");
  await editField(k);
  if (here) {
    await k.tap("#modify-here");
    await k.page.waitForSelector('#modify-panel:is([data-view="sheet"], [data-view="duplicates"])');
  }
  await k.page.waitForTimeout(1200);
}
/** The punk add at FREE filled: a dome aimed 15 m east, at the first floor, public. */
async function editAddFilled(k) {
  await editAdd(k, FREE, true);
  await editSteps(k, [["dome"], ["direction"]]);
  await editView(k, "aim");
  // A phone's tap brings the point under the fixed crosshair: « Valider » once its bearing is in.
  await k.tapAt(offsetLngLat(FREE, 15, 0));
  await k.page.waitForSelector("#aim-submit:not([disabled])", { timeout: 10000 });
  await k.tap("#aim-submit");
  await editView(k, "sheet");
  await editSteps(k, [
    ["first", "height"],
    ["public", "operator"],
  ]);
  await k.page.waitForSelector("#modify-panel [data-operator]", { timeout: 15000 }).catch(() => {});
  if (await k.page.locator("#modify-panel [data-operator]").count())
    await k.tap(k.page.locator("#modify-panel [data-operator]").first());
  await editView(k, "sheet");
  await k.page.waitForTimeout(1200);
}

/** Punk: « Modifier », its position slid to fx.target, « Ici », « Envoyer 1 modification »
 * (offline first when `queued`), « Terminer ». */
async function editMove(k, fx, queued = false) {
  await editPosition(k, fx, fx.target);
  await k.tap("#modify-here");
  await editView(k, "sheet");
  if (queued) await offline(k);
  await k.tap("#modify-send");
  await k.page.waitForSelector('#modify-panel[data-view="sent"]', { state: "attached" });
  await k.page.keyboard.press("Escape");
  await k.page.waitForFunction(() => !document.getElementById("modify-panel"));
}

/** 8a's scene after « Envoyer » (participate/score.ts), the points from score-kit.mjs's
 * mock of GET /api/me/points, held at its rest (the confetti fallen, « Voir le classement »
 * in). */
async function scene(k) {
  await k.page.waitForSelector("#score #modify-done", { state: "attached" });
  await k.page.waitForTimeout(1500);
  await holdAt(k.page, 6000);
  await k.page.waitForTimeout(300);
}

/** The real API's answer to a « Multi-boules » sent without its number, as it answers
 * someone who publishes on OSM (`osm: "kept"`, `osm_reason`): the bench's accounts do not
 * publish (smoke-score.mjs adds `will_publish` the same way). */
async function keptMultidome(page) {
  await page.route("**/api/contributions", async (route) => {
    const body = route.request().postDataJSON();
    const real = await route.fetch();
    const answer = await real.json().catch(() => ({}));
    const kept = body?.kind === "shape" && body.answer === "multidome" && !body.dome_count;
    return route.fulfill({
      response: real,
      json: kept ? { ...answer, osm: "kept", osm_reason: "multidome_count_unknown" } : answer,
    });
  });
}

/** The CI extract has no multi-dome (tests/fixtures/ci.osm.pbf): the camera `id`'s tile
 * attributes read as one's (`k` multidome and `extra`), for the sheet only (the map still
 * draws its tile's sticker). From the next page load: set as main.ts names the map. */
async function asMultidome(page, id, extra) {
  await page.addInitScript(
    ([camera, more]) => {
      let map = null;
      Object.defineProperty(window, "__map", {
        configurable: true,
        get: () => map,
        set(m) {
          map = m;
          const own = m.querySourceFeatures.bind(m);
          m.querySourceFeatures = (source, options) =>
            own(source, options).map((f) =>
              String(f.properties?.id) === camera
                ? Object.assign(f, { properties: { ...f.properties, k: "multidome", ...more } })
                : f,
            );
        },
      });
    },
    [id, extra],
  );
}

/** An add sent (offline first when `queued`): the filled sheet's « Envoyer », « Terminer ». */
async function addSent(k, queued = false) {
  await editAddFilled(k);
  if (queued) await offline(k);
  await k.tap("#modify-send");
  await k.page.waitForSelector('#modify-panel[data-view="sent"]', { state: "attached" });
  await k.page.keyboard.press("Escape");
  await k.page.waitForFunction(() => !document.getElementById("modify-panel"));
}
const offsetLngLat = ([lat, lon], dx, dy) => [
  lon + dx / (111320 * Math.cos((lat * Math.PI) / 180)),
  lat + dy / 111320,
];

/** A pending add's sheet, opened by its id (?cam=c…: no build has it yet). */
const pendingAdd = (k, uuid, at) =>
  k.open(`?cam=${addedId(uuid)}${hash(at, 18.5)}`, { sheet: true });

/** "Vos contributions", from a camera's sheet. */
async function mine(k) {
  await sheet(k, FIXED);
  await k.tap(k.page.locator("#sheet .part-link").first());
  await k.page.waitForSelector("#mine");
  await k.page.waitForTimeout(1500);
}

/** /revue as `rev` (the proxy serves it to that account only). */
const revue = (k, query = "") => k.open(`revue${query ? `?${query}` : ""}`, { map: false });
/** A camera's view in /revue (`query`: the queue's filter kept), its small map at rest;
 * `scroll`: on a phone, scrolled to that part (below the map). */
async function reviewCamera(k, camera, { query = "", scroll = null } = {}) {
  await revue(k, `camera=${camera}${query ? `&${query}` : ""}`);
  await k.page.waitForSelector(".review-foot .review-bar", { timeout: 20000 });
  await k.page.waitForTimeout(2500);
  if (scroll && k.phone) await k.show(scroll);
}

/** The API's answer at `pattern` read and changed by `change` before the page gets it. */
async function patchJson(k, pattern, change) {
  await k.page.route(pattern, async (r) => {
    if (r.request().method() !== "GET") return r.fallback();
    const real = await r.fetch();
    return r.fulfill({ response: real, json: change(await real.json()) });
  });
}

/** « Fiche utilisateur » of the bench account `name` (its id asked of the API as rev). */
async function accountSheet(k, name) {
  const { accounts } = await api("rev", "GET", `/api/review/accounts?q=${name}`);
  const id = accounts.find((a) => a.pseudonym === name)?.id;
  if (!id) throw new Error(`no account ${name}`);
  await revue(k, `compte=${id}`);
  await k.page.waitForSelector("#review-account");
  await k.page.waitForTimeout(800);
}
/** Today, as the API dates (Europe/Paris on this machine). */
const TODAY = new Date().toLocaleDateString("sv");

/** The hour `back` hours before this one, as S6 gives it: the start of a Paris hour with
 * its offset (« 2026-10-17T14:00:00+02:00 »). */
function parisHour(back) {
  const at = new Date(Date.now() - back * 3600_000);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Paris",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
      timeZoneName: "longOffset",
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  const offset = parts.timeZoneName.replace("GMT", "") || "+00:00";
  return {
    at: `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:00:00${offset}`,
    h: Number(parts.hour),
  };
}

/** GET /api/review/stats as a site of a few months would answer, in the shape of the « go »
 * of 17/10 (S6: `hours`, `days`, `weeks`, `months` replace `usage`, each a block with its
 * rows; the board P6's figures otherwise: about 412 map loads a day, 48 sends in and 35
 * decided this week, 23 waiting, 17 active accounts), dated from TODAY and this hour;
 * publishing not offered; « Retraits » under its threshold (`hiddenLow`). The bench's own
 * loads never count (navigator.webdriver, a headless User-Agent), so `enough` needs this.
 * `low`: a site just opened (lot M: counts shown from the first one): a few loads today,
 * the computed values (median wait, shares) under their threshold, « peu de données ». */
export function statsMock({ low = false, hiddenLow = true } = {}) {
  const day = dayBack;
  // A slow rise, weekends lower, a little noise that is the same at every run.
  const weekend = (back) => [0, 6].includes(new Date(`${day(back)}T12:00:00`).getDay());
  const noise = (k) => ((k * 37) % 23) - 11;
  // Smoother for the small counts (sign-ins, sends): a busy day or two, never a saw.
  const swell = (k) => 2.2 * Math.sin(k / 2.6) + 1.3 * Math.sin(k / 1.1 + 1);
  const history = Array.from({ length: 98 }, (_, k) => {
    const i = 97 - k;
    const base = (250 + (k * 190) / 97) * (weekend(i) ? 0.8 : 1);
    return {
      day: day(i),
      map: i === 0 ? 180 : Math.round(base + 2 * noise(k)),
      welcome: i === 0 ? 41 : Math.round(base * 0.23 + noise(k + 5) / 2),
      signin: i === 0 ? 6 : Math.round(base * 0.035 + swell(k + 3)),
      contributions: i === 0 ? 4 : Math.max(0, Math.round(6 + (k * 3) / 97 + swell(k))),
      decisions: i === 0 ? 3 : Math.max(0, Math.round(5 + (k * 2) / 97 + swell(k - 1))),
    };
  });
  const days = history.slice(-30);
  // The hours: a day's shape (nights low, the evening's peak), the same hours of the
  // 7 days before a little lower on average; this hour still running.
  const shape = [
    2, 1, 1, 0, 0, 1, 3, 8, 14, 16, 18, 21, 26, 22, 19, 18, 21, 27, 33, 36, 31, 24, 14, 7,
  ];
  const hours = Array.from({ length: 24 }, (_, k) => {
    const { at, h } = parisHour(23 - k);
    const n = shape[h] + (((k * 13) % 7) - 3);
    const now = k === 23;
    return {
      at,
      map: Math.max(0, now ? Math.round(n * 0.4) : n),
      welcome: Math.max(0, Math.round((now ? n * 0.4 : n) * 0.22)),
      signin: Math.max(0, Math.round(n * 0.05 + ((k * 5) % 3) - 1)),
      ref: { map: Math.max(0, shape[h] * 0.92), welcome: shape[h] * 0.2, signin: shape[h] * 0.04 },
    };
  });
  hours[3].ref = null; // an hour the 7 days before never counted: no mark
  const monday = (back) => {
    const d = new Date(`${TODAY}T12:00:00`);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7) - 7 * back);
    return d.toLocaleDateString("sv");
  };
  const weeks = Array.from({ length: 14 }, (_, k) => {
    const week = monday(13 - k);
    const of = history.filter((d) => d.day >= week && d.day < (k === 13 ? "9999" : monday(12 - k)));
    const total = (key) => of.reduce((a, d) => a + d[key], 0);
    return {
      week,
      map: total("map"),
      welcome: total("welcome"),
      signin: total("signin"),
      contributions: total("contributions"),
      decisions: total("decisions"),
    };
  });
  const month = TODAY.slice(0, 7);
  const prev = (n) => {
    const d = new Date(`${month}-15T12:00:00`);
    d.setMonth(d.getMonth() - n);
    return d.toLocaleDateString("sv").slice(0, 7);
  };
  const signups = [0, 0, 0, 0, 0, 0, 0, 0, 0, 12, 19, 24, 31];
  const months = signups.map((n, i) => ({ month: prev(12 - i), signups: n }));
  // A few loads, today only: every other row zero.
  const few = (rows) =>
    rows.map((r, i) =>
      Object.fromEntries(
        Object.entries(r).map(([k, v]) =>
          typeof v === "number" ? [k, i === rows.length - 1 ? Math.min(v, 5) : 0] : [k, v],
        ),
      ),
    );
  const block = (rows, name, n) =>
    low
      ? { enough: true, n: Math.min(n, 5), need: {}, [name]: few(rows) }
      : { enough: true, n, need: {}, [name]: rows };
  const weekly = Array.from({ length: 13 }, (_, k) => ({
    week: monday(12 - k),
    in: k === 12 ? 48 : 30 + ((k * 7) % 19),
    decided: k === 12 ? 35 : 27 + ((k * 5) % 17),
  }));
  const pending = Array.from({ length: 90 }, (_, k) => ({
    day: day(89 - k),
    n: Math.max(4, Math.round(8 + (k * 15) / 89 + 3 * Math.sin(k / 6))),
  }));
  pending[89].n = 23;
  const out = {
    today: TODAY,
    hours: block(
      hours,
      "hours",
      hours.reduce((a, h) => a + h.map, 0),
      { n: 50 },
    ),
    days: block(days, "days", 30, { n: 7 }),
    weeks: block(weeks, "weeks", weeks.length, { n: 4 }),
    months: block(
      months,
      "months",
      signups.reduce((a, n) => a + n, 0),
      { n: 5 },
    ),
    queue: {
      enough: true,
      n: 412,
      n_weeks: 13,
      need: { n: 30, n_weeks: 4 },
      weekly,
      pending_by_day: pending,
      pending_now: 23,
      oldest_days: 6,
      median_wait_days: 2,
    },
    contributors: {
      enough: true,
      n: 17,
      need: { n: 5 },
      monthly: [3, 2, 1, 0].map((n, i) => ({
        month: prev(n),
        active: [6, 9, 14, 17][i],
        new: [6, 4, 7, 5][i],
      })),
      top3_share: 0.58,
      top: [
        ["joe", 41],
        ["lea.b", 12],
        ["marie_k", 9],
        ["tom92", 7],
        ["sam", 5],
      ].map(([pseudonym, accepted], i) => ({
        id: `5eed5747-0000-4000-8000-00000000000${i + 1}`,
        pseudonym,
        accepted,
      })),
    },
    osm: {
      enough: true,
      n: 96,
      need: { n: 20 },
      offered: false,
      server: "live",
      accepted: 96,
      published: 0,
      conflict: 0,
      sending: 0,
      stays: 96,
    },
    hidden: {
      enough: true,
      n: 5,
      need: { n: 1 },
      monthly: [
        { month: prev(1), n: 3 },
        { month, n: 2 },
      ],
    },
  };
  // Nothing hidden yet: « Retraits » says 0.
  const none = { ...out.hidden, n: 0, monthly: [] };
  if (low) {
    // Four sends, two accounts: the median wait and the share, « peu de données ».
    out.queue = {
      ...out.queue,
      enough: false,
      n: 4,
      n_weeks: 0,
      weekly: weekly.map((w, i) =>
        i === weekly.length - 1 ? { ...w, in: 4, decided: 1 } : { ...w, in: 0, decided: 0 },
      ),
      pending_by_day: pending.map((d, i) => ({ ...d, n: i === pending.length - 1 ? 3 : 0 })),
      pending_now: 3,
      oldest_days: 0,
      median_wait_days: 0,
    };
    out.contributors = {
      ...out.contributors,
      enough: false,
      n: 2,
      top3_share: 1,
      top: out.contributors.top.slice(0, 1).map((a) => ({ ...a, accepted: 1 })),
      monthly: [{ month, active: 2, new: 2 }],
    };
    out.hidden = none;
  } else if (hiddenLow) out.hidden = none;
  return out;
}

/** `back` days before TODAY. */
const dayBack = (back) => {
  const d = new Date(`${TODAY}T12:00:00`);
  d.setDate(d.getDate() - back);
  return d.toLocaleDateString("sv");
};

/** GET /api/review/log as the « go » of 17/10 has it (S6: an activity feed), for a site
 * of a few days: contributions received (one alone, a « Modifier » send, an add with its
 * answers, a « je ne sais pas », an opinion, a test account's, a deleted account's), the
 * review's decisions and administrator's gestures; the newest day first, in a day the
 * journal's lines then the contributions. The cameras are the CI extract's, their labels
 * as the queue gives them. Answered by the page until S6 is integrated; `type` and
 * `actor` filter it as the API would. */
export function journalMock() {
  const L = (kind, street, operator = null, extra = {}) => ({
    add: false,
    built: true,
    kind,
    operator,
    operator_class: operator ? "public" : null,
    street,
    commune: "Courbevoie",
    ...extra,
  });
  const ARCHE = L("fixed", "Avenue de l'Arche");
  const ANGE = L("dome", "Rue Michel-Ange", "Ville de Courbevoie");
  const RABELAIS = L("fixed", "Rue François Rabelais");
  const ALLEE = L("unknown", "Allée de l'Arche");
  const ADDED = L("dome", "Avenue de l'Arche", null, { add: true, built: false });
  const piece = (kind, extra = {}) => ({
    kind,
    answer: null,
    direction: null,
    distance_m: null,
    operator_name: null,
    status: "pending",
    ...extra,
  });
  let seq = 0;
  const j = (back, actor, action, extra = {}) => ({
    key: `j${++seq}`,
    day: dayBack(back),
    source: "journal",
    actor,
    actor_test: false,
    action,
    pieces: [],
    camera: null,
    label: null,
    target_name: null,
    target: null,
    detail: null,
    ...extra,
  });
  const c = (back, actor, camera, label, pieces, extra = {}) => ({
    key: `c${++seq}`,
    day: dayBack(back),
    source: "contribution",
    actor,
    actor_test: false,
    action: "contribution",
    pieces,
    camera,
    label,
    target_name: actor,
    target: null,
    detail: null,
    ...extra,
  });
  const decision = (to, from = "pending") => ({ from, to });
  return [
    j(0, "rev", "decide", {
      camera: FIXED.id,
      label: ARCHE,
      target_name: "ana",
      pieces: [piece("move", { distance_m: 7, status: "validated" })],
      detail: decision("validated"),
    }),
    j(0, "rev", "hide", { camera: CAM.m1.id, label: ANGE, target: CAM.m1.id, detail: {} }),
    c(0, "ana", FIXED.id, ARCHE, [piece("move", { distance_m: 7, status: "validated" })]),
    c(0, "bob", DOME.id, ANGE, [
      piece("shape", { answer: "dome" }),
      piece("direction", { direction: 210 }),
      piece("height", { answer: "first" }),
    ]),
    c(0, "tess", CAM.ts.id, RABELAIS, [piece("verify", { answer: "present" })], {
      actor_test: true,
    }),
    j(1, "rev", "role", { target_name: "gil", detail: { from: "contributor", to: "reviewer" } }),
    j(1, "rev", "setting", { target: "signups_open", detail: { value: true } }),
    j(1, "rvw", "decide", {
      camera: CAM.n1.id,
      label: ALLEE,
      target_name: "bob",
      pieces: [piece("verify", { answer: "not_found", status: "rejected" })],
      detail: decision("rejected"),
    }),
    c(1, "cara", CAM.wd.id, RABELAIS, [piece("verify", { answer: "not_found" })]),
    c(1, null, CAM.op.id, ALLEE, [
      piece("operator", { answer: "business", operator_name: "Monop'" }),
    ]),
    c(1, "ana", addedId(ADD.a1.uuid), ADDED, [
      piece("add"),
      piece("shape", { answer: "dome" }),
      piece("direction", { direction: 120 }),
    ]),
    c(1, "bob", CAM.m2.id, ANGE, [piece("agree")]),
    j(2, "rev", "suspend", {
      target_name: "dan",
      detail: { rejected: ["a", "b", "c", "d"] },
    }),
    j(2, "rev", "cut", { target_name: "cara", detail: { sessions: 1 } }),
    j(2, "rev", "undo", {
      camera: CAM.v1.id,
      label: RABELAIS,
      target_name: "ana",
      pieces: [piece("move", { distance_m: 5 })],
      detail: decision("pending", "validated"),
    }),
    c(2, "cara", CAM.dir.id, ANGE, [piece("direction", { answer: "unknown" })]),
    c(2, "ana", CAM.ht.id, ARCHE, [piece("height", { answer: "upper" })]),
    j(4, null, "signin_refused", { target_name: "rev" }),
    j(4, "rev", "export_csv", { detail: { rows: 312 } }),
    j(4, "rev", "delete", { target_name: "eve", detail: { contributions: 3 } }),
    j(4, "rev", "on_site", {
      camera: CAM.x2.id,
      label: ARCHE,
      target_name: "bob",
      pieces: [piece("verify", { answer: "not_found", status: "validated" })],
    }),
    j(4, "rev", "unhide", {
      camera: "n9999999999",
      target: "n9999999999",
      detail: { known: false },
    }),
    c(4, "marie_k", CAM.rj.id, RABELAIS, [piece("tilt", { answer: "slight" })]),
  ];
}

const DECISIONS = ["decide", "undo", "on_site"];
/** GET /api/review/log answered by the page (journalMock), filtered by `type` and `actor`
 * as S6 does, 100 a page. */
export async function mockJournal(k, entries = journalMock()) {
  await k.page.route("**/api/review/log*", (r) => {
    const q = new URL(r.request().url()).searchParams;
    const type = q.get("type") ?? "all";
    const actor = (q.get("actor") ?? "").toLocaleLowerCase("fr");
    const kept = entries.filter(
      (e) =>
        (type === "all" ||
          (type === "contributions" && e.source === "contribution") ||
          (type === "decisions" && DECISIONS.includes(e.action)) ||
          (type === "admin" && e.source === "journal" && !DECISIONS.includes(e.action))) &&
        (!actor || (e.actor ?? "").toLocaleLowerCase("fr") === actor),
    );
    return r.fulfill({ json: { entries: kept.slice(0, 100), next: null } });
  });
}

// --- the account's screen: the leaderboard (lot « comptes », board 26a) ----------------
// The account routes answered by the page (bench/profile-mock.mjs: the board's example on
// CI cameras, nothing stored); the account square, « Votre profil », opens it.

/** The account's screen (the square, « Votre profil »): the leaderboard of 26a, alone;
 * `opts`: the mock's (profile-mock.mjs mockProfile). */
async function board(k, opts = {}) {
  await mockProfile(k.page, opts);
  await k.open(PROFILE_AT);
  await k.tap(k.page.getByRole("button", { name: "Votre profil" }));
  await k.page.waitForSelector("#sheet .board-paper :is(.board-you:not([hidden]), .board-note)", {
    timeout: 15000,
  });
  await k.page.waitForTimeout(1500);
}

/** « Changer le mot de passe » opened, the current one typed (`current`) and sent. */
async function changePassword(k, current) {
  await board(k);
  await k.show("#sheet .board-password");
  await k.tap("#sheet .board-password");
  if (current !== null) {
    const fields = k.page.locator("#sheet .board-password-form input");
    await fields.nth(0).fill(current);
    await fields.nth(1).fill("a brand new password");
    await k.tap("#sheet .board-password-submit");
  }
  await k.show("#sheet .board-password-form");
  await k.page.waitForTimeout(600);
}

/** The leaderboard (`opts`: the mock's), « Supprimer mon compte », its password typed
 * (`password`) and confirmed (`send`). */
async function deleteAccount(k, password, send = true, opts = {}) {
  await board(k, opts);
  await k.show("#sheet .board-delete");
  await k.tap("#sheet .board-delete");
  if (password !== null) await k.page.locator("#sheet .board-delete-form input").fill(password);
  if (send) await k.tap("#sheet .board-delete-confirm");
  await k.show("#sheet .board-delete-form");
  await k.page.waitForTimeout(600);
}

/** Lot U: « Mes caméras » unfolded on the account's screen, the mock's fuller collection
 * (profile-mock.mjs COLLECTION), its paper in view. */
async function myCameras(k, opts = {}) {
  await board(k, { contributions: COLLECTION, signed: false, ...opts });
  await k.show("#sheet .board-cameras-toggle");
  await k.tap("#sheet .board-cameras-toggle");
  await k.page.waitForSelector("#sheet .board-cameras :is(.profile-numbers, .profile-note)", {
    timeout: 15000,
  });
  await k.fullSheet();
  await k.show("#sheet .board-cameras .profile-numbers");
}

const CAMERAS_STATES = [
  // « Mes caméras » (lot U), on the account's screen
  { id: "cameras-open", run: (k) => myCameras(k) },
  {
    id: "cameras-list",
    async run(k) {
      await myCameras(k);
      await k.show("#sheet .board-cameras .profile-group");
    },
  },
  {
    id: "cameras-back",
    async run(k) {
      await myCameras(k);
      const dome = `#sheet [data-camera="${DOME_CAM}"] button.profile-cam`;
      await k.show(dome);
      await k.tap(dome);
      await k.page.waitForSelector("#sheet .sheet-paper:not(.profile-paper) .sheet-return", {
        timeout: 15000,
      });
      await k.page.waitForTimeout(800);
    },
  },
];

const PROFILE_STATES = [
  // Leaderboard (26a), the account's screen
  { id: "board-month", run: (k) => board(k) },
  {
    id: "board-logout-offline",
    async run(k) {
      await board(k, { fail: ["/api/session"] });
      await k.show("#sheet .profile-logout");
      await k.tap("#sheet .profile-logout");
      await k.page.waitForSelector("#sheet .profile-logout-error");
      await k.show("#sheet .profile-logout-error");
    },
  },
  { id: "board-password-form", run: (k) => changePassword(k, null) },
  { id: "board-password-wrong", run: (k) => changePassword(k, "wrong password") },
  {
    id: "board-all",
    async run(k) {
      await board(k);
      await k.tap(k.page.locator("#sheet .board-period").nth(1));
      await k.page.waitForTimeout(1500);
    },
  },
  {
    id: "board-kind",
    async run(k) {
      await board(k);
      await k.tap(k.page.locator("#sheet .board-count", { hasText: "Ajouts" }));
      await k.page.waitForTimeout(1500);
    },
  },
  {
    id: "board-list",
    async run(k) {
      await board(k);
      await k.show("#sheet .board-list");
    },
  },
  {
    id: "board-scale",
    async run(k) {
      await board(k);
      await k.show("#sheet .board-scale-toggle");
      await k.tap("#sheet .board-scale-toggle");
      await k.show("#sheet .board-scale");
    },
  },
  { id: "board-opted-out", run: (k) => board(k, { optIn: false }) },
  // Lot U: « Afficher mon pseudonyme sur les caméras que j'ai relevées », off, what it
  // reveals under it.
  {
    id: "board-signed",
    async run(k) {
      await board(k, { signed: false });
      await k.show("#sheet .board-signed-help");
    },
  },
  {
    id: "board-me-far",
    async run(k) {
      await board(k, {
        me: [
          [0, 1, 0, 1],
          [0, 2, 0, 1],
        ],
        pending: 0,
      });
      await k.show("#sheet .board-gap");
    },
  },
  { id: "board-empty", run: (k) => board(k, { nobody: true }) },
  {
    id: "board-offline",
    run: (k) => board(k, { fail: ["/api/leaderboard", "/api/me/score"] }),
  },
  {
    id: "board-optin-offline",
    async run(k) {
      await board(k, { fail: ["/api/me/leaderboard"] });
      await k.show("#sheet .board-switch");
      await k.tap("#sheet .board-switch");
      await k.page.waitForTimeout(800);
    },
  },
  {
    id: "board-scale-offline",
    async run(k) {
      await board(k, { fail: ["/api/leaderboard"] });
      await k.show("#sheet .board-scale-toggle");
      await k.tap("#sheet .board-scale-toggle");
      await k.show("#sheet .board-scale");
    },
  },
  {
    id: "board-delete-form",
    run: (k) => deleteAccount(k, null, false),
  },
  {
    id: "board-delete-empty",
    run: (k) => deleteAccount(k, null),
  },
  {
    id: "board-delete-wrong",
    run: (k) => deleteAccount(k, "pas le bon"),
  },
  {
    id: "board-delete-failed",
    run: (k) => deleteAccount(k, PASSWORD, true, { fail: ["/api/me/delete"] }),
  },
  {
    // Back from OpenStreetMap signed in (OSM lot 1): the page opened as the callback leaves
    // it, the account's screen with its line.
    id: "board-osm-status",
    async run(k) {
      await mockProfile(k.page, { account: { osm: true, password: false }, osmLogin: true });
      await k.open(`?osm=signed${PROFILE_AT}`);
      await k.page.waitForSelector("#sheet .board-paper .board-notice:not(:empty)", {
        timeout: 15000,
      });
      await k.page.waitForTimeout(1500);
    },
  },
  // The account and OpenStreetMap at the foot (OSM lot 1), sign-in on.
  {
    id: "board-osm-link",
    run: (k) => osmBoard(k, { osm: false, password: true }),
  },
  {
    id: "board-osm-linked",
    run: (k) => osmBoard(k, { osm: true, password: true }),
  },
  {
    id: "board-osm-only",
    run: (k) => osmBoard(k, { osm: true, password: false }),
  },
  {
    id: "board-delete-osm-only",
    async run(k) {
      await osmBoard(k, { osm: true, password: false });
      await k.show("#sheet .board-delete");
      await k.tap("#sheet .board-delete");
      await k.page.locator("#sheet .board-delete-form input").fill("pas_moi");
      await k.tap("#sheet .board-delete-confirm");
      await k.show("#sheet .board-delete-form");
      await k.page.waitForTimeout(600);
    },
  },
  {
    id: "board-osm-unlinked",
    async run(k) {
      await osmBoard(k, { osm: true, password: true });
      await k.tap("#sheet .board-osm-unlink");
      await k.page.waitForSelector("#sheet .board-osm-note:not(:empty)");
      await k.show("#sheet .board-osm");
    },
  },
  {
    id: "board-osm-unlink-failed",
    async run(k) {
      await osmBoard(k, { osm: true, password: true }, { unlinkFails: true });
      await k.tap("#sheet .board-osm-unlink");
      await k.page.waitForSelector("#sheet .board-osm-note:not(:empty)");
      await k.show("#sheet .board-osm");
    },
  },
  // « Publier sur OpenStreetMap »: the OSM synchronisation (16/10), offered on the test
  // server unless said.
  {
    id: "board-sync-not-offered",
    async run(k) {
      await board(k, { account: { osm: true, password: true, sync: false } });
      await k.show("#sheet .board-links");
    },
  },
  { id: "board-sync-off", run: (k) => syncBoard(k, SYNC) },
  {
    id: "board-sync-enable",
    async run(k) {
      await syncBoard(k, SYNC);
      await k.tap(k.page.locator("#sheet .board-sync-choice", { hasText: "Publier aussi" }));
      await k.page.locator("#board-sync-enable input").fill("pas le bon");
      await k.tap("#sheet .board-sync-enable-submit");
      await k.page.waitForSelector("#board-sync-enable-error:not(:empty)");
      await k.show("#board-sync-enable");
    },
  },
  { id: "board-sync-on", run: (k) => syncBoard(k, SYNC_ON) },
  {
    id: "board-sync-history",
    run: (k) => syncBoard(k, SYNC_ON, {}, ".board-sync-history-title"),
  },
  {
    id: "board-sync-stop",
    async run(k) {
      await syncBoard(k, SYNC_ON);
      await k.tap(k.page.locator("#sheet .board-sync-choice", { hasText: "Rester" }));
      await k.show("#board-sync-stop");
    },
  },
  {
    id: "board-sync-stopped",
    async run(k) {
      await syncBoard(k, SYNC_ON);
      await k.tap(k.page.locator("#sheet .board-sync-choice", { hasText: "Rester" }));
      await k.tap("#sheet .board-sync-stop-submit");
      await k.page.waitForSelector("#sheet .board-sync-note:not(:empty)");
      await k.show("#sheet .board-sync");
    },
  },
  {
    id: "board-sync-suspended",
    run: (k) => syncBoard(k, { ...SYNC_ON, suspended: true }),
  },
  {
    id: "board-sync-revoked",
    run: (k) => syncBoard(k, { ...SYNC, last_error: "revoked" }),
  },
  {
    id: "board-sync-blocked",
    run: (k) => syncBoard(k, { ...SYNC_ON, last_error: "blocked" }),
  },
  {
    id: "board-sync-retry",
    run: (k) => syncBoard(k, { ...SYNC_ON, last_error: "osm_down" }),
  },
  // The camera sheet's « Vos contributions », the choice on: « OSM : … » under each one
  // that went or may still go.
  {
    id: "mine-sync",
    async run(k) {
      await mockProfile(k.page, {
        account: { osm: true, password: true, sync: true },
        sync: SYNC_ON,
      });
      await k.open(`?cam=${PROFILE_CAMS.dome}${PROFILE_AT}`, { sheet: true });
      await k.tap(k.page.locator("#sheet .part-link", { hasText: "Vos contributions" }));
      await k.page.waitForSelector("#mine .mine-osm");
    },
  },
  {
    id: "board-sync-live",
    run: (k) => syncBoard(k, { ...SYNC_ON, server: "live", url: "https://www.openstreetmap.org" }),
  },
];

/** The account's screen scrolled to « Publier sur OpenStreetMap » (the OSM
 * synchronisation): GET /api/osm/sync's answer `sync` (its `on` also GET /api/me's `sync`;
 * linked to OSM, with a password) and the mock's `opts`; `at`, what is brought into view
 * (the section's top by default). */
async function syncBoard(k, sync, opts = {}, at = ".board-sync") {
  await board(k, { account: { osm: true, password: true, sync: sync.on }, sync, ...opts });
  await k.page.waitForSelector("#sheet .board-sync:not([hidden])");
  await k.show(`#sheet ${at}`);
}

/** The account's screen scrolled to its foot, the account (`account`: GET /api/me's `osm`
 * and `password`) and OSM sign-in on. */
async function osmBoard(k, account, opts = {}) {
  await board(k, { account, osmLogin: true, ...opts });
  await k.page.waitForSelector("#sheet .board-osm:not([hidden])");
  await k.show("#sheet .board-osm");
}

/** The API's answer without a session (lot « comptes »). */
const SESSION_401 = (r) =>
  r.fulfill({ status: 401, contentType: "application/json", body: '{"error":"session"}' });
/** /revue's routes without the privileged entry's session (lot 2). */
const PRIVILEGED_401 = (r) =>
  r.fulfill({ status: 401, contentType: "application/json", body: '{"error":"privileged"}' });

/** Punk signed out, the map at the street level: the ticket's account square. */
async function signedOutMap(k) {
  await k.page.route("**/api/me", SESSION_401);
  await k.open(hash(STREET, 16.5));
}

/** 28a: the welcome panel of a first visit, its poppers played (their cones stay). */
async function welcome(k) {
  await k.page.addInitScript(() => {
    try {
      localStorage.removeItem("lacarte.welcome");
    } catch {
      // about:blank has no storage.
    }
  });
  await k.open(hash(STREET, 16.5));
  await k.page.waitForSelector("#welcome [role=dialog]");
  await k.page.waitForTimeout(2300);
}

/** « Compte » (25a frame 1), from the square, signed out. */
async function accountAsk(k) {
  await signedOutMap(k);
  await k.tap("#account-square");
  await k.page.waitForSelector('#sheet [data-account="ask"]');
  await k.page.waitForTimeout(800);
}

/** « Entrer » (25a frame 2): no longer in « Compte » (28a), at the address nothing links to,
 * `?compte=motdepasse`. */
async function accountForm(k) {
  await k.page.route("**/api/me", SESSION_401);
  await k.open(`?compte=motdepasse${hash(STREET, 16.5)}`);
  await k.page.waitForSelector('#sheet [data-account="form"]');
  await k.page.waitForTimeout(800);
}

/** « Entrer » sent, POST /api/session answered by `answer`. */
async function accountLogin(k, answer) {
  await k.page.route("**/api/session", answer);
  await accountForm(k);
  await k.page.fill("#account-pseudonym", "ana");
  await k.page.fill("#account-password", "mauvais");
  await k.tap("#sheet .account-submit");
  await k.page.waitForTimeout(1200);
}

// Sign-in with OpenStreetMap (OSM lot 1): its routes answered by the page, never
// openstreetmap.org (the callback's outcome is the `?osm=` the page is opened with).
const OSM_ON = (r) => r.fulfill({ status: 200, json: { login: true } });
const OSM_SIGNUP = { suggestion: "Jean_Dupont", osm_name: "Jean Dupont" };

/** « Compte » with the OpenStreetMap key. */
async function osmAsk(k) {
  await k.page.route("**/api/osm/status", OSM_ON);
  await accountAsk(k);
}

/** Signed out, the page opened as the API's callback leaves it (`?osm=<outcome>`); GET
 * /api/osm/signup answered by `read` (default the suggestion), POST by `post`. */
async function osmLanding(k, outcome, { read, post } = {}) {
  await k.page.route("**/api/me", SESSION_401);
  await k.page.route("**/api/osm/status", OSM_ON);
  await k.page.route("**/api/osm/signup", (r) =>
    r.request().method() === "GET"
      ? read
        ? read(r)
        : r.fulfill({ status: 200, json: OSM_SIGNUP })
      : post
        ? post(r)
        : r.fulfill({ status: 204, body: "" }),
  );
  await k.open(`?osm=${outcome}${hash(STREET, 16.5)}`);
  await k.page.waitForSelector(
    '#sheet [data-account="signup"], #sheet .account-notice:not(:empty)',
    {
      timeout: 15000,
    },
  );
  await k.page.waitForTimeout(800);
}

/** « Choisissez votre pseudonyme », `pseudonym` typed and « Valider » sent. */
async function osmSignup(k, pseudonym, post) {
  await osmLanding(k, "signup", { post });
  await k.page.fill("#account-signup-pseudonym", pseudonym);
  await k.tap("#sheet .account-submit");
  await k.page.waitForSelector("#account-signup-error:not([hidden])", { timeout: 10000 });
  await k.page.waitForTimeout(600);
}

// --- the states, by screen, as in docs/interface.md ----------------------------------

export const STATES = [
  // Map
  { id: "map-no-data", run: (k) => k.open("") },
  { id: "map-z7-departements", run: (k) => k.open("#7.60/48.89/2.23") },
  { id: "map-z10-communes", run: (k) => k.open("#10.30/48.895/2.23") },
  { id: "map-z12-streets", run: (k) => k.open("#12.60/48.8977/2.2377") },
  { id: "map-z14-portions", run: (k) => k.open("#14.50/48.8977/2.2377") },
  { id: "map-z16-street", run: (k) => k.open(hash(STREET, 16.5)) },
  { id: "map-z18-street", run: (k) => k.open(hash([48.8979, 2.2378], 18.2)) },
  { id: "map-prudent", run: (k) => k.open(`?est=prudent${hash(STREET, 16.5)}`) },
  {
    id: "map-filtered-public",
    async run(k) {
      await k.open("#13.2/48.8965/2.2385");
      await filters(k);
      await k.tap(k.page.locator("#filters label", { hasText: "publiques seules" }));
      await k.page.waitForTimeout(800);
      await closeFilters(k);
      await k.idle();
    },
  },
  { id: "map-filtered-advanced", run: (k) => k.open(`?f=fresh_never${hash(STREET, 16.5)}`) },
  { id: "map-filtered-empty", run: (k) => k.open(`?op=zzz${hash(STREET, 16.5)}`) },
  // Punk (DECISIONS 2026-10-09): the filters hide every filmed street of the view (z14.5, by
  // the filter bits there: PTZ, which no camera of the view is): the map's message.
  {
    id: "map-filtered-empty-streets",
    run: (k) => k.open(`?f=ptz${hash(STREET, 14.5)}`),
  },
  // Punk: below the street level the machine says the filters set in the street view.
  {
    id: "filters-street-active",
    run: (k) => openFilters(k, `?op=zzz${hash(STREET, 13.2)}`),
  },
  // Punk, a phone: the credit unfolded from its « ⓘ ».
  {
    id: "map-attribution-open",
    devices: ["phone"],
    async run(k) {
      await street(k);
      await k.tap("#attrib-toggle");
      await k.page.waitForTimeout(300);
    },
  },
  {
    id: "map-focus",
    async run(k) {
      await sheet(k, FIXED);
      // A phone: the sheet down to its top, the map above it.
      if (k.phone) {
        await k.tap(".sheet-grab");
        await k.tap(".sheet-grab");
        await k.page.waitForTimeout(800);
      }
    },
  },
  {
    id: "map-focus-labels",
    devices: ["desktop"],
    async run(k) {
      await sheet(k, FIXED);
      // The mouse over the focused field: every level's reach.
      const p = await k.page.evaluate(
        (ll) => {
          const m = window.__map;
          const q = m.project(ll);
          const r = m.getCanvas().getBoundingClientRect();
          return { x: r.left + q.x, y: r.top + q.y };
        },
        offsetLngLat(FIXED.at, 0, -6),
      );
      await k.page.mouse.move(p.x, p.y);
      await k.page.waitForTimeout(800);
    },
  },
  {
    id: "map-focus-far",
    async run(k) {
      await sheet(k, FIXED);
      // Zoomed out around it, the camera in the part of the map the panels leave free (a
      // phone's sheet covers the middle of the screen).
      await k.jump({ center: [FIXED.at[1], FIXED.at[0]], zoom: 13.5 }, 500);
      await k.centreInFree([FIXED.at[1], FIXED.at[0]]);
      await k.idle(800);
    },
  },
  {
    id: "map-focus-far-filtered",
    async run(k) {
      // Verified less than a year ago: not this camera (2022), hidden with its marker.
      await sheet(k, FIXED, "&f=fresh_lt1");
      // Zoomed out around it, as `map-focus-far`.
      await k.jump({ center: [FIXED.at[1], FIXED.at[0]], zoom: 13.5 }, 500);
      await k.centreInFree([FIXED.at[1], FIXED.at[0]]);
      await k.idle(800);
    },
  },
  { id: "map-proposals-street", seed: "full", run: (k) => k.open(hash([48.8962, 2.238], 17.4)) },
  { id: "map-proposal-add", seed: "full", run: (k) => k.open(hash(ADD.a1.at, 18.6)) },
  { id: "map-gone-filter", run: (k) => k.open(`?f=gone${hash(GONE.at, 18.5)}`) },
  {
    id: "map-locate-follow",
    geolocation: { latitude: 48.8962, longitude: 2.2385, accuracy: 15 },
    async run(k) {
      await k.open(hash(STREET, 15));
      await k.tap("#fab-locate");
      await k.page.waitForSelector("#fab-locate[data-locate='follow']");
      await k.page.waitForTimeout(3000);
      await k.idle();
    },
  },
  {
    id: "map-locate-free",
    geolocation: { latitude: 48.8962, longitude: 2.2385, accuracy: 15 },
    async run(k) {
      await k.open(hash(STREET, 15));
      await k.tap("#fab-locate");
      await k.page.waitForTimeout(3000);
      await k.drag(-120, 0);
      await k.page.waitForSelector("#fab-locate[data-locate='free']");
      await k.idle();
    },
  },
  {
    id: "map-locate-error",
    async run(k) {
      await k.open(hash(STREET, 16.5));
      await k.tap("#fab-locate");
      await k.page.waitForSelector("#fab-locate.failed", { timeout: 10000 });
    },
  },
  {
    id: "map-add-zoom",
    async run(k) {
      // Punk: « ＋ Ajouter » is active from the street level (DECISIONS 2026-10-09).
      await k.open(hash(FREE, 14.6));
      await k.page.waitForSelector("#fab-add:not([hidden])", { timeout: 30000 });
      await k.tap("#fab-add");
      await k.page.waitForTimeout(400);
    },
  },
  { id: "map-add-enabled", run: (k) => k.open(hash(FREE, 17.6)) },
  // Punk: « ＋ Ajouter » tapped at z16.4: the map zooms to z17, then the add opens.
  {
    id: "map-add-zooms-in",
    async run(k) {
      await k.open(hash(FREE, 16.4));
      await k.page.waitForSelector("#fab-add:not([hidden]):not([aria-disabled='true'])", {
        timeout: 30000,
      });
      await k.tap("#fab-add");
      await k.page.waitForSelector("#modify-panel", { timeout: 20000 });
      await k.page.waitForTimeout(800);
    },
  },
  // « Liste des caméras » (punk, machine.ts CameraList) is hidden until further notice
  // (DECISIONS 2026-10-08): its states map-list, map-list-zoom and map-list-more are not
  // reachable (their captures opened it from the ticket's #list-open).
  {
    id: "map-queue-counter",
    async run(k) {
      await sheet(k, FIXED);
      await offline(k);
      await notFound(k);
      await k.page.keyboard.press("Escape");
      await k.page.waitForTimeout(800);
    },
  },
  { id: "map-debug", run: (k) => k.open(cam(FIXED, "&debug=1"), { sheet: true }) },
  {
    id: "map-landscape",
    devices: ["phone"],
    landscape: true,
    async run(k) {
      // The sheet at its tallest: 60 % of the height at most.
      await sheet(k, FIXED);
      await k.fullSheet();
    },
  },
  // The punk buttons (theme/punk/buttons.css): a hover and a press held on a wide screen,
  // the keyboard focus on both.
  {
    id: "button-estimate-hover",
    devices: ["desktop"],
    async run(k) {
      await street(k);
      await k.hover(PRUDENT);
    },
  },
  {
    id: "button-estimate-press",
    devices: ["desktop"],
    async run(k) {
      await street(k);
      await k.hold(PRUDENT);
    },
  },
  {
    id: "button-estimate-focus",
    async run(k) {
      await street(k);
      await k.keyFocus("#estimate button");
    },
  },
  {
    id: "button-fab-hover",
    devices: ["desktop"],
    async run(k) {
      await street(k);
      await k.hover("#fab-locate");
    },
  },
  {
    id: "button-fab-press",
    devices: ["desktop"],
    async run(k) {
      await street(k);
      await k.hold("#fab-locate");
    },
  },
  {
    id: "button-fab-press-reduced",
    devices: ["desktop"],
    async run(k) {
      await k.page.emulateMedia({ reducedMotion: "reduce" });
      await street(k);
      await k.hold("#fab-locate");
    },
  },
  {
    id: "button-fab-focus",
    async run(k) {
      await street(k);
      await k.keyFocus("#fab-locate");
    },
  },

  // Filters and legend
  { id: "filters-z7", run: (k) => openFilters(k, "#7.60/48.89/2.23") },
  { id: "filters-z10", run: (k) => openFilters(k, "#10.30/48.895/2.23") },
  { id: "filters-z13", run: (k) => openFilters(k, "#13.2/48.8965/2.2385") },
  { id: "filters-z14", run: (k) => openFilters(k, "#14.50/48.8977/2.2377") },
  { id: "filters-z16", run: (k) => openFilters(k, hash(STREET, 16.5)) },
  // Punk: « Légende ↑ » prints the legend on the ticket (20a, 18a), on both screens.
  {
    id: "filters-ticket-legend",
    async run(k) {
      await openFilters(k, hash(STREET, 16.5));
      await k.tap("#filters .legend-key");
      await k.page.waitForTimeout(600);
    },
  },
  {
    id: "filters-ticket-legend-areas",
    async run(k) {
      await openFilters(k, "#10.30/48.895/2.23");
      await k.tap("#filters .legend-key");
      await k.page.waitForTimeout(600);
    },
  },
  {
    id: "filters-legend-calc",
    async run(k) {
      await openFilters(k, hash(STREET, 16.5));
      await k.tap("#filters .legend-key");
      await k.page.waitForTimeout(600);
      await k.tap("#ticket .legend-calc");
      await k.page.waitForTimeout(400);
    },
  },
  // Punk « État de la fiche » (20a): « Correction en attente » released, the proposed
  // cameras, their tape and ghosts hidden.
  {
    id: "filters-state-hidden",
    seed: "full",
    async run(k) {
      await openFilters(k, hash([48.8962, 2.238], 17.4));
      await k.tap(k.page.locator('#filters label[data-state="pending"]'));
      await k.page.waitForTimeout(800);
      await k.idle();
      await k.show("#filters .states");
    },
  },
  // Punk « Tout réafficher » (20a): every filter off at once, « BOUM ! » over the button
  // (a decoration of 1.2 s, caught 250 ms in).
  {
    id: "filters-reset",
    async run(k) {
      await openFilters(k, `?f=fresh_never${hash(STREET, 16.5)}`);
      await k.tap("#filters .reset");
      await k.page.waitForTimeout(250);
    },
  },
  {
    id: "filters-advanced",
    async run(k) {
      await k.open(hash(STREET, 16.5));
      await filters(k);
      await k.tap(k.page.locator("#filters .advanced summary"));
      await k.show("#filters .advanced");
    },
  },
  {
    id: "filters-advanced-active",
    async run(k) {
      await k.open(`?f=fresh_never,direction_unknown${hash(STREET, 16.5)}`);
      await filters(k);
      await k.show("#filters .streets-count");
    },
  },
  {
    id: "filters-operator",
    async run(k) {
      await k.open(`?op=Vinci${hash(STREET, 16.5)}`);
      await filters(k);
      await k.show("#adv-operator");
    },
  },
  {
    id: "filters-operator-none",
    async run(k) {
      await k.open(`?op=zzz${hash(STREET, 16.5)}`);
      await filters(k);
      await k.show("#adv-operator");
    },
  },
  {
    id: "filters-z13-active",
    async run(k) {
      await k.open("?f=fresh_never,direction_unknown&op=Courbevoie#13.2/48.8965/2.2385");
      await filters(k);
      await k.show("#filters .streets-count");
    },
  },
  {
    id: "filters-unchecked",
    async run(k) {
      await k.open(hash(STREET, 16.5));
      await filters(k);
      await k.tap(k.page.locator("#filters label", { hasText: "fixe" }));
      await k.page.waitForTimeout(800);
      await k.idle();
    },
  },
  {
    // The machine's ×, as the sheet's (the close norm).
    id: "button-panel-hover",
    devices: ["desktop"],
    async run(k) {
      await openFilters(k, hash(STREET, 16.5));
      await k.hover("#filters .machine-close");
    },
  },
  {
    // « Tout réafficher », a filter on: it sinks; nothing is reset until it is released.
    id: "button-panel-press",
    devices: ["desktop"],
    async run(k) {
      await openFilters(k, `?f=fresh_never${hash(STREET, 16.5)}`);
      await k.hold("#filters .reset");
    },
  },
  {
    // The machine's own opener: the ticket's « Filtres et légende », on both screens.
    id: "button-panel-focus",
    async run(k) {
      await street(k);
      await k.keyFocus("#fab-filters");
    },
  },

  // Camera sheet
  { id: "sheet-fixed", run: (k) => sheet(k, FIXED) },
  { id: "sheet-prudent", run: (k) => sheet(k, FIXED, "&est=prudent") },
  {
    id: "sheet-peek",
    devices: ["phone"],
    async run(k) {
      await sheet(k, FIXED);
      await k.tap(".sheet-grab");
      await k.tap(".sheet-grab");
      await k.page.waitForTimeout(600);
    },
  },
  {
    id: "sheet-full",
    devices: ["phone"],
    async run(k) {
      await sheet(k, FIXED);
      await k.fullSheet();
    },
  },
  {
    // Punk, half open, scrolled: the head alone stays, the tickets went under it.
    id: "sheet-half-scrolled",
    devices: ["phone"],
    async run(k) {
      await sheet(k, FIXED);
      await scrollPaper(k);
    },
  },
  {
    id: "sheet-how",
    async run(k) {
      await sheet(k, FIXED);
      await k.fullSheet();
      await k.tap("#sheet :is(details.how summary, .how-toggle)");
      await k.show("#sheet :is(details.how summary, .how:not([hidden]))");
    },
  },
  {
    id: "sheet-share",
    devices: ["desktop"],
    async run(k) {
      await k.context.grantPermissions(["clipboard-read", "clipboard-write"]);
      await sheet(k, FIXED);
      await k.page.evaluate(() => {
        // No system share sheet on a desktop browser: the copy to the clipboard.
        navigator.share = undefined;
      });
      await k.tap("#sheet .share");
      await k.show("#sheet .share");
    },
  },
  { id: "sheet-no-direction", run: (k) => sheet(k, DOME) },
  { id: "sheet-no-direction-prudent", run: (k) => sheet(k, DOME, "&est=prudent") },
  {
    id: "sheet-no-direction-chips",
    async run(k) {
      await sheet(k, DOME);
      await k.fullSheet();
      await k.show(ASSUMED);
    },
  },
  {
    id: "sheet-unknown",
    async run(k) {
      await sheet(k, UNKNOWN);
      await k.fullSheet();
      await k.show(ASSUMED);
    },
  },
  { id: "sheet-household", run: (k) => sheet(k, HOUSEHOLD) },
  // Lot U: the camera's public history, cara's validated move (seed full), « par un
  // contributeur »; then cara's pseudonym, once she chose to show it (a write: the data is
  // set again after).
  { id: "sheet-history", seed: "full", run: (k) => historySheet(k) },
  {
    id: "sheet-history-signed",
    seed: "full",
    writes: true,
    async run(k) {
      await api("cara", "PUT", "/api/me/history-pseudonym", { on: true });
      await historySheet(k);
    },
  },
  { id: "sheet-no-field", run: (k) => sheet(k, NOFIELD) },
  { id: "sheet-private-indoor", run: (k) => sheet(k, INDOOR) },
  { id: "sheet-too-high", run: (k) => sheet(k, OSM_MOUNT) },
  { id: "sheet-too-high-prudent", run: (k) => sheet(k, OSM_MOUNT, "&est=prudent") },
  {
    id: "sheet-height-tilt-answered",
    async run(k) {
      await sheet(k, ANSWERED_MOUNT);
      await k.fullSheet();
      await k.show(ROWS);
    },
  },
  {
    id: "sheet-height-default",
    async run(k) {
      await sheet(k, LAMP);
      await k.fullSheet();
      await k.show(ASSUMED);
    },
  },
  { id: "sheet-gone", run: (k) => sheet(k, GONE, "&f=gone") },
  {
    id: "sheet-position-corrected",
    async run(k) {
      await sheet(k, MOVED_ON_SITE);
      await k.fullSheet();
      await k.show(ROWS);
    },
  },
  {
    // The same camera as `sheet-position-corrected`: the only one a validated contribution
    // made on site has seen (an add on site says it in its position chip).
    id: "sheet-verified-on-site",
    async run(k) {
      await sheet(k, MOVED_ON_SITE);
      await k.fullSheet();
      await k.show(ROWS);
    },
  },
  {
    id: "sheet-position-corrected-off",
    async run(k) {
      await sheet(k, MOVED_OFF_SITE);
      await k.fullSheet();
      await k.show(ROWS);
    },
  },
  {
    id: "sheet-verified-off",
    async run(k) {
      await sheet(k, SEEN_OFF_SITE);
      await k.fullSheet();
      await k.show(ROWS);
    },
  },
  {
    id: "sheet-never-verified",
    async run(k) {
      await sheet(k, NEVER);
      await k.fullSheet();
      await k.show("#sheet :is(.note, .sheet-dates)");
    },
  },
  {
    // Punk: « reconnaît » chosen among the tickets (DECISIONS 2026-10-08, « Punk focus… »).
    id: "sheet-level-chosen",
    async run(k) {
      await sheet(k, DIRECTION_ANSWERED);
      await k.tap('#sheet .ticket[data-level="2"]');
      await k.page.waitForTimeout(600);
    },
  },
  {
    id: "sheet-direction-answered",
    async run(k) {
      await sheet(k, DIRECTION_ANSWERED);
      await k.fullSheet();
      await k.show(ROWS);
    },
  },
  {
    id: "sheet-operator-answered",
    async run(k) {
      await sheet(k, OPERATOR_ANSWERED);
      await k.fullSheet();
      await k.show(ROWS);
    },
  },
  {
    id: "sheet-added",
    async run(k) {
      await sheet(k, ADDED_ON_SITE);
      await k.fullSheet();
      await k.show(ROWS);
    },
  },
  {
    id: "sheet-added-answered",
    async run(k) {
      await sheet(k, ADDED_ANSWERED);
      await k.fullSheet();
      await k.show(ROWS);
    },
  },
  {
    id: "sheet-reviewer-conflict",
    seed: "full",
    who: "rev",
    async run(k) {
      await sheet(k, CAM.e1);
      await k.page.waitForSelector("#sheet .part-conflict", { timeout: 10000 });
    },
  },
  {
    // Punk: what has no certainty: the dates line (OSM's check date, by the month) and the
    // band of a field drawn almost nil (neither tag nor certainty).
    id: "chip-no-certainty",
    async run(k) {
      await sheet(k, CHECK);
      await k.fullSheet();
      await k.show("#sheet .sheet-band");
    },
  },
  {
    id: "button-close-hover",
    devices: ["desktop"],
    async run(k) {
      await sheet(k, FIXED);
      await k.hover("#sheet .close");
    },
  },
  {
    id: "button-close-press",
    devices: ["desktop"],
    async run(k) {
      await sheet(k, FIXED);
      await k.hold("#sheet .close");
    },
  },
  {
    id: "button-close-focus",
    async run(k) {
      await sheet(k, FIXED);
      await k.keyFocus("#sheet .close");
    },
  },
  {
    // The sheet's buttons (lot 3.2, 17a): « Toujours là ? » lifts, the links never move.
    id: "button-sheet-hover",
    devices: ["desktop"],
    async run(k) {
      await sheet(k, FIXED);
      await k.hover(sheetBtn(k, "Toujours là"));
    },
  },
  {
    id: "button-sheet-press",
    devices: ["desktop"],
    async run(k) {
      await sheet(k, FIXED);
      await k.hold(sheetBtn(k, "Toujours là"));
    },
  },
  {
    // A link's focus: « Calcul ? ».
    id: "button-sheet-focus",
    async run(k) {
      await sheet(k, FIXED);
      await k.fullSheet();
      await k.keyFocus("#sheet .how-toggle");
      await k.show("#sheet .how-toggle");
    },
  },

  // Proposals in the camera sheet (seed: full)
  { id: "prop-move-mine", seed: "full", run: (k) => sheet(k, CAM.m1) },
  { id: "prop-move-other", seed: "full", who: "bob", run: (k) => sheet(k, CAM.m1) },
  { id: "prop-move-reviewer", seed: "full", who: "rev", run: (k) => sheet(k, CAM.m1) },
  {
    id: "prop-reviewer-armed",
    seed: "full",
    who: "rev",
    async run(k) {
      await sheet(k, CAM.m1);
      await k.tap(k.page.locator("#sheet .part-proposal button.decide-validated"));
      await k.page.waitForTimeout(300);
    },
  },
  { id: "prop-answered-agree", seed: "full", who: "bob", run: (k) => sheet(k, CAM.m2) },
  { id: "prop-answered-disagree", seed: "full", who: "cara", run: (k) => sheet(k, CAM.m2) },
  { id: "prop-counts-mine", seed: "full", run: (k) => sheet(k, CAM.m2) },
  {
    id: "prop-withdraw-opinion-armed",
    seed: "full",
    who: "bob",
    async run(k) {
      await sheet(k, CAM.m2);
      await k.tap(k.page.locator("#sheet .part-withdraw"));
      await k.page.waitForTimeout(300);
    },
  },
  { id: "prop-not-found", seed: "full", run: (k) => sheet(k, CAM.n1) },
  { id: "prop-validated", seed: "full", run: (k) => sheet(k, CAM.v1) },
  { id: "prop-validated-reviewer", seed: "full", who: "rev", run: (k) => sheet(k, CAM.v1) },
  { id: "prop-more", seed: "full", run: (k) => sheet(k, CAM.x2) },
  {
    id: "prop-withdraw-armed",
    seed: "full",
    async run(k) {
      await sheet(k, CAM.m1);
      await k.tap(k.page.locator("#sheet .part-withdraw"));
      await k.page.waitForTimeout(300);
    },
  },
  {
    id: "prop-withdraw-offline",
    seed: "full",
    async run(k) {
      await sheet(k, CAM.m1);
      await offline(k);
      await k.tap(k.page.locator("#sheet .part-withdraw"));
      await k.tap(k.page.locator("#sheet .part-withdraw"));
      await k.page.waitForTimeout(1000);
    },
  },
  {
    id: "prop-withdraw-busy",
    seed: "full",
    async run(k) {
      await k.page.route("**/api/contributions/withdraw", (r) =>
        r.fulfill({ status: 429, contentType: "application/json", body: '{"error":"rate"}' }),
      );
      await sheet(k, CAM.m1);
      await k.tap(k.page.locator("#sheet .part-withdraw"));
      await k.tap(k.page.locator("#sheet .part-withdraw"));
      await k.page.waitForTimeout(1000);
    },
  },
  {
    id: "prop-withdrawn",
    seed: "full",
    writes: true,
    async run(k) {
      await sheet(k, CAM.m1);
      await k.tap(k.page.locator("#sheet .part-withdraw"));
      await k.tap(k.page.locator("#sheet .part-withdraw"));
      await k.page.waitForTimeout(1500);
    },
  },
  {
    id: "prop-queued",
    async run(k) {
      await sheet(k, FIXED);
      await offline(k);
      await notFound(k);
      // Closed and opened again (a tap on its pictogram): its proposal, still on the phone.
      await k.page.keyboard.press("Escape");
      await k.page.waitForTimeout(600);
      await k.tapAt([FIXED.at[1], FIXED.at[0]]);
      await k.page.waitForSelector("#sheet:not([hidden]) .part-proposal:not([hidden])");
      await k.page.waitForTimeout(800);
    },
  },

  // A pending add's sheet (seed: full)
  {
    id: "add-pending-other",
    seed: "full",
    who: "bob",
    run: (k) => pendingAdd(k, ADD.a1.uuid, ADD.a1.at),
  },
  { id: "add-pending-mine", seed: "full", run: (k) => pendingAdd(k, ADD.a1.uuid, ADD.a1.at) },
  {
    id: "add-pending-reviewer",
    seed: "full",
    who: "rev",
    run: (k) => pendingAdd(k, ADD.a1.uuid, ADD.a1.at),
  },
  { id: "add-pending-on-site", seed: "full", run: (k) => pendingAdd(k, ADD.a2.uuid, ADD.a2.at) },
  { id: "add-pending-validated", seed: "full", run: (k) => pendingAdd(k, ADD.a3.uuid, ADD.a3.at) },
  {
    id: "add-pending-conflict",
    seed: "full",
    who: "rev",
    run: (k) => pendingAdd(k, ADD.dup.uuid, ADD.dup.at),
  },

  // "Toujours là ?"
  {
    id: "verify-question",
    async run(k) {
      await sheet(k, FIXED);
      await k.tap(sheetBtn(k, "Toujours là"));
      await k.page.waitForTimeout(500);
    },
  },
  {
    // Punk: on a camera verified gone, the two answers (DECISIONS 2026-10-08).
    id: "verify-gone",
    async run(k) {
      await sheet(k, GONE, "&f=gone");
      await k.tap(sheetBtn(k, "Toujours là"));
      await k.page.waitForTimeout(500);
    },
  },
  {
    id: "verify-armed",
    async run(k) {
      await sheet(k, FIXED);
      await k.tap(sheetBtn(k, "Toujours là"));
      await k.tap(sheetBtn(k, "Je ne la trouve pas"));
      await k.page.waitForTimeout(300);
    },
  },
  {
    id: "verify-sent",
    who: "dan",
    writes: true,
    async run(k) {
      await sheet(k, FIXED);
      await k.tap(sheetBtn(k, "Toujours là"));
      await k.tap(sheetBtn(k, "Elle est là"));
      await k.page.waitForSelector(".part-done");
      // From afar a check earns nothing: punk shows no scene then, only its confirmation.
      if (await k.page.$("#score")) await scene(k);
      else await k.page.waitForTimeout(800);
    },
  },
  {
    id: "verify-queued",
    async run(k) {
      await sheet(k, FIXED);
      await offline(k);
      await notFound(k);
    },
  },
  {
    id: "verify-on-site-waiting",
    geolocation: { latitude: 48.896425, longitude: 2.239968, accuracy: 400 },
    async run(k) {
      await sheet(k, FIXED);
      await k.tap(sheetBtn(k, "Toujours là"));
      await k.tap(k.page.locator("#sheet .part-onsite-locate"));
      await k.page.waitForTimeout(2000);
      await k.show("#sheet .part-onsite-help");
    },
  },

  {
    id: "move-sent",
    who: "eve",
    writes: true,
    async run(k, fx) {
      await editMove(k, fx);
      await k.page.waitForFunction(() => !document.body.classList.contains("moving"));
      await k.page.waitForTimeout(2000);
      await k.idle();
    },
  },
  {
    id: "move-queued",
    async run(k, fx) {
      await editMove(k, fx, true);
      await k.page.waitForFunction(() => !document.body.classList.contains("moving"));
      await k.page.waitForTimeout(1500);
    },
  },

  // Adding and « Modifier » (punk, DECISIONS 2026-10-08): one component
  { id: "modify-open", run: (k) => modify(k, FIXED) },
  { id: "modify-row-open", run: (k) => modify(k, FIXED, [["mount"]]) },
  // 4a-f4: only what the camera assumes unfolded (an applied add's dome: its height).
  { id: "modify-assumed", run: (k) => modify(k, ADDED_ANSWERED) },
  {
    id: "modify-height-dome",
    run: (k) => modify(k, UNKNOWN, [["shape"], ["dome"], ["mount"]]),
  },
  {
    id: "modify-changed",
    run: (k) => modify(k, FIXED, [["mount"], ["first", "height"], ["tilt"], ["slight", "tilt"]]),
  },
  { id: "modify-shapes", run: (k) => modify(k, UNKNOWN, [["shape"]]) },
  {
    id: "modify-aim-waiting",
    async run(k) {
      await modify(k, UNKNOWN, [["shape"], ["dome"], ["direction"]]);
      await editView(k, "aim");
    },
  },
  {
    id: "modify-aim",
    async run(k) {
      await modify(k, UNKNOWN, [["shape"], ["dome"], ["direction"]]);
      await editView(k, "aim");
      await k.tapAt(offsetLngLat(UNKNOWN.at, 20, 8));
      await editField(k);
      await k.page.waitForTimeout(1500);
    },
  },
  {
    id: "modify-operator-names",
    async run(k) {
      await modify(k, UNKNOWN, [["operator"], ["public"]]);
      await k.page
        .waitForSelector("#modify-panel [data-operator]", { timeout: 15000 })
        .catch(() => {});
    },
  },
  {
    id: "modify-abandon",
    async run(k) {
      await modify(k, FIXED, [["mount"], ["first", "height"], ["tilt"], ["slight", "tilt"]]);
      await k.tap("#modify-panel .modify-head .modify-close");
      await k.page.waitForSelector("#modify-panel .part-abandon");
    },
  },
  {
    id: "modify-done",
    who: "hal",
    writes: true,
    async run(k) {
      await mockPoints(k.page);
      await modify(k, FIXED, [["mount"], ["first", "height"], ["tilt"], ["slight", "tilt"]]);
      await k.tap("#modify-send");
      await scene(k);
    },
  },
  {
    id: "modify-done-offline",
    async run(k) {
      await modify(k, FIXED, [["mount"], ["first", "height"], ["tilt"], ["slight", "tilt"]]);
      await offline(k);
      await k.tap("#modify-send");
      await scene(k);
    },
  },
  { id: "modify-position", run: (k, fx) => editPosition(k, fx, fx.inside) },
  {
    id: "modify-position-too-far",
    run: (k, fx) => editPosition(k, fx, offsetLngLat([fx.at[1], fx.at[0]], 60, 0)),
  },
  { id: "add-place", run: (k) => editAdd(k, FREE) },
  { id: "add-place-duplicates", run: (k) => editAdd(k, NEAR, true) },
  { id: "add-sheet", run: (k) => editAdd(k, FREE, true) },
  { id: "add-sheet-filled", run: (k) => editAddFilled(k) },
  {
    id: "add-sheet-abandon",
    async run(k) {
      await editAdd(k, FREE, true);
      await editSteps(k, [["shape"], ["dome"]]);
      await k.tap("#modify-panel .modify-head .modify-close");
      await k.page.waitForSelector("#modify-panel .part-abandon");
    },
  },
  // « Multi-boules » (DECISIONS 2026-10-23): its tile, the pin's sticker, « Nombre de
  // boules »; then « 3 »; then sent with « Je ne sais pas », the API's `osm: "kept"`.
  {
    id: "add-multidome",
    async run(k) {
      await editAdd(k, FREE, true);
      await editSteps(k, [["multidome"]]);
    },
  },
  {
    id: "add-multidome-count",
    async run(k) {
      await editAdd(k, FREE, true);
      await editSteps(k, [["multidome"], ["3", "count"]]);
    },
  },
  {
    id: "add-multidome-kept",
    who: "fay",
    writes: true,
    async run(k) {
      await mockPoints(k.page);
      await keptMultidome(k.page);
      await editAdd(k, FREE, true);
      await editSteps(k, [["multidome"], ["first", "height"]]);
      await k.tap("#modify-send");
      await k.page.waitForSelector("#modify-done .score-kept", { timeout: 15000 });
      await scene(k);
    },
  },
  {
    id: "sheet-multidome",
    async run(k) {
      await asMultidome(k.page, DOME.id, { dn: 3, dnc: 1, km: "2026-10" });
      await sheet(k, DOME);
    },
  },
  {
    id: "add-done",
    who: "fay",
    writes: true,
    async run(k) {
      await mockPoints(k.page);
      await editAddFilled(k);
      await k.tap("#modify-send");
      await scene(k);
    },
  },
  {
    id: "add-done-offline",
    async run(k) {
      await editAddFilled(k);
      await offline(k);
      await k.tap("#modify-send");
      await scene(k);
    },
  },

  {
    id: "add-sent",
    who: "fay",
    writes: true,
    async run(k) {
      await addSent(k);
      await k.page.waitForFunction(() => !document.body.classList.contains("moving"));
      await k.page.waitForTimeout(2500);
      await k.idle();
    },
  },
  {
    id: "add-queued",
    async run(k) {
      await addSent(k, true);
      await k.page.waitForFunction(() => !document.body.classList.contains("moving"));
      await k.page.waitForTimeout(1500);
    },
  },
  {
    id: "add-pending-queued",
    async run(k) {
      await addSent(k, true);
      await k.page.waitForFunction(() => !document.body.classList.contains("moving"));
      await k.page.waitForTimeout(1000);
      await k.tapAt([FREE[1], FREE[0]]);
      await k.page.waitForSelector("#sheet:not([hidden])", { timeout: 10000 });
      await k.page.waitForTimeout(800);
    },
  },

  // "Vos contributions"
  { id: "mine-empty", run: (k) => mine(k) },
  { id: "mine-list", seed: "full", run: (k) => mine(k) },
  {
    id: "mine-withdraw-armed",
    seed: "full",
    async run(k) {
      await mine(k);
      await k.tap(k.page.locator("#mine .mine-withdraw").first());
      await k.page.waitForTimeout(300);
    },
  },
  {
    id: "mine-withdrawn",
    seed: "full",
    writes: true,
    async run(k) {
      await mine(k);
      await k.tap(k.page.locator("#mine .mine-withdraw").first());
      await k.tap(k.page.locator("#mine .mine-withdraw").first());
      await k.page.waitForTimeout(1500);
    },
  },
  {
    id: "mine-withdraw-offline",
    seed: "full",
    async run(k) {
      await mine(k);
      await offline(k);
      await k.tap(k.page.locator("#mine .mine-withdraw").first());
      await k.tap(k.page.locator("#mine .mine-withdraw").first());
      await k.page.waitForTimeout(1000);
    },
  },
  {
    id: "mine-withdraw-busy",
    seed: "full",
    async run(k) {
      await k.page.route("**/api/contributions/withdraw", (r) =>
        r.fulfill({ status: 429, contentType: "application/json", body: '{"error":"rate"}' }),
      );
      await mine(k);
      await k.tap(k.page.locator("#mine .mine-withdraw").first());
      await k.tap(k.page.locator("#mine .mine-withdraw").first());
      await k.page.waitForTimeout(1000);
    },
  },
  {
    id: "mine-offline",
    async run(k) {
      await sheet(k, FIXED);
      await offline(k);
      await notFound(k);
      // The sheet now says "enregistré sur ce téléphone"; the counter opens the page.
      await k.page.keyboard.press("Escape");
      await k.page.waitForTimeout(500);
      await k.tap("#queue-count");
      await k.page.waitForSelector("#mine");
      await k.page.waitForTimeout(1200);
    },
  },
  {
    // The session expired: the send is answered 401, the page asks who is signed in (401
    // too from then on), the counter asks for a login.
    id: "queue-relogin",
    async run(k) {
      let expired = false;
      await k.page.route("**/api/me", (r) => (expired ? SESSION_401(r) : r.continue()));
      await k.page.route("**/api/contributions", (r) => {
        if (r.request().method() !== "POST") return r.continue();
        expired = true;
        return SESSION_401(r);
      });
      await sheet(k, FIXED);
      await k.tap(sheetBtn(k, "Toujours là"));
      await k.tap(sheetBtn(k, "Elle est là"));
      // The sheet is drawn again signed out as soon as the 401 is met: no « Merci » to wait for.
      await k.page.waitForFunction(
        () => document.getElementById("queue-count")?.classList.contains("relogin"),
        null,
        { timeout: 15000 },
      );
      await k.page.keyboard.press("Escape");
      await k.page.waitForTimeout(800);
    },
  },

  // Account (lot « comptes », board 25a), punk; the API's answers simulated where the
  // state needs them (signed out: /api/me 401; the login's answer).
  { id: "account-square", run: (k) => signedOutMap(k) },
  { id: "account-ask", run: (k) => accountAsk(k) },
  { id: "account-form", run: (k) => accountForm(k) },
  {
    id: "account-form-error",
    run: (k) =>
      accountLogin(k, (r) =>
        r.fulfill({
          status: 401,
          contentType: "application/json",
          body: '{"error":"credentials"}',
        }),
      ),
  },
  {
    // The server's delay after refusals (1 s, 2 s, 4 s… up to 30 s): no answer yet.
    id: "account-form-waiting",
    run: (k) => accountLogin(k, () => {}),
  },
  {
    id: "account-form-offline",
    run: (k) => accountLogin(k, (r) => r.abort("internetdisconnected")),
  },
  {
    id: "account-form-failed",
    run: (k) => accountLogin(k, (r) => r.fulfill({ status: 500, body: "" })),
  },
  {
    id: "account-sheet-visitor",
    async run(k) {
      await k.page.route("**/api/me", SESSION_401);
      await sheet(k, FIXED);
    },
  },
  // Sign-in with OpenStreetMap (OSM lot 1), its routes answered by the page.
  { id: "account-osm-key", run: (k) => osmAsk(k) },
  { id: "account-osm-signup", run: (k) => osmLanding(k, "signup") },
  {
    id: "account-osm-signup-taken",
    run: (k) =>
      osmSignup(k, "pris", (r) => r.fulfill({ status: 409, json: { error: "pseudonym_taken" } })),
  },
  { id: "account-osm-signup-invalid", run: (k) => osmSignup(k, "é") },
  {
    id: "account-osm-signup-failed",
    run: (k) => osmSignup(k, "Jean_Dupont", (r) => r.abort("internetdisconnected")),
  },
  {
    id: "account-osm-signup-expired",
    run: (k) =>
      osmLanding(k, "signup", {
        read: (r) => r.fulfill({ status: 401, json: { error: "signup_expired" } }),
      }),
  },
  { id: "account-osm-status", run: (k) => osmLanding(k, "denied") },
  {
    // Sign-ups closed in /revue's « Réglages » (GET /api/config `signups`): « Compte » says
    // only existing accounts enter.
    id: "account-osm-signups-closed",
    async run(k) {
      await k.page.route("**/api/config", (r) =>
        r.fulfill({
          json: { contributions: true, signups: false, publish: false, publisher: null },
        }),
      );
      await osmAsk(k);
    },
  },
  {
    // Back from OpenStreetMap the first time while sign-ups are closed: 403 signups_closed.
    id: "account-osm-signup-closed",
    run: (k) =>
      osmLanding(k, "signup", {
        read: (r) => r.fulfill({ status: 403, json: { error: "signups_closed" } }),
      }),
  },
  {
    // A first sign-in while sign-ups are closed, said by the API's callback itself
    // (?osm=signups_closed: no account made, lot 4 of /revue), sign-ups closed in /api/config.
    id: "account-osm-return-closed",
    async run(k) {
      await k.page.route("**/api/config", (r) =>
        r.fulfill({
          json: { contributions: true, signups: false, publish: false, publisher: null },
        }),
      );
      await osmLanding(k, "signups_closed");
    },
  },

  // /revue (lot 1 « Modérer »: « File » and a camera's view; lot 2 « Administrer »: the
  // privileged entry, the administrator's views). rev is an administrator, rvw a reviewer
  // (harness.mjs); both enter by POST /api/review/session (session.mjs).
  { id: "review-not-found", run: (k) => revue(k) },
  {
    // Signed out, or a session the privileged entry did not open: « Connexion à la revue ».
    id: "review-visitor",
    who: "rev",
    async run(k) {
      await k.page.route("**/api/review/me", PRIVILEGED_401);
      await k.page.route("**/api/me", SESSION_401);
      await revue(k);
    },
  },
  {
    id: "review-login-error",
    who: "rev",
    async run(k) {
      await k.page.route("**/api/review/me", PRIVILEGED_401);
      await k.page.route("**/api/me", SESSION_401);
      await k.page.route("**/api/review/session", (r) =>
        r.fulfill({
          status: 401,
          contentType: "application/json",
          body: '{"error":"credentials"}',
        }),
      );
      await revue(k);
      await k.page.fill("#review-pseudonym", "ana");
      await k.page.fill("#review-password", "mauvais");
      await k.tap("#review-signin button[type=submit]");
      await k.page.waitForSelector(".review-login-error:not([hidden])");
      await k.page.waitForTimeout(500);
    },
  },
  {
    // A contributor signed in on the map: named above the form (the proxy serves /revue to
    // everyone past its gate; the API's answers about the account simulated).
    id: "review-contributor",
    who: "rev",
    async run(k) {
      await k.page.route("**/api/review/me", PRIVILEGED_401);
      await k.page.route("**/api/me", (r) =>
        r.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            author: "ana",
            pseudonym: "ana",
            reviewer: false,
            role: "contributor",
            since: "2026-03",
            leaderboard: false,
            validation: "review",
          }),
        }),
      );
      await revue(k);
    },
  },
  {
    // The privileged session gone meanwhile (its 8 hours, a restart of the API, « Couper
    // l'accès »): the next call's 401 privileged brings the sign-in back, said.
    id: "review-session-ended",
    who: "rev",
    async run(k) {
      await k.page.route("**/api/review/queue?**", PRIVILEGED_401);
      await revue(k);
      await k.page.waitForSelector("#review-signin");
    },
  },
  {
    id: "review-api-down",
    who: "rev",
    async run(k) {
      await k.page.route("**/api/review/**", (r) => r.fulfill({ status: 502, body: "" }));
      await revue(k);
    },
  },
  // A reviewer: « File » alone; an administrator's address says it is not hers.
  { id: "review-reviewer", seed: "full", who: "rvw", run: (k) => revue(k) },
  { id: "review-admin-only", who: "rvw", run: (k) => revue(k, "vue=comptes") },
  { id: "review-empty", who: "rev", run: (k) => revue(k) },
  { id: "review-todo", seed: "full", who: "rev", run: (k) => revue(k) },
  { id: "review-all", seed: "full", who: "rev", run: (k) => revue(k, "file=all") },
  // The map's link (?status=conflict) opens « Conflits ».
  { id: "review-conflicts", seed: "full", who: "rev", run: (k) => revue(k, "status=conflict") },
  { id: "review-names", seed: "full", who: "rev", run: (k) => revue(k, "file=names") },
  {
    id: "review-search",
    seed: "full",
    who: "rev",
    async run(k) {
      await revue(k);
      await k.page.fill("#review-search", "Arche");
      await k.page.waitForTimeout(1500);
    },
  },
  {
    id: "review-search-none",
    seed: "full",
    who: "rev",
    async run(k) {
      await revue(k);
      await k.page.fill("#review-search", "zzzz");
      await k.page.waitForTimeout(1500);
    },
  },
  { id: "review-camera-move", seed: "full", who: "rev", run: (k) => reviewCamera(k, CAM.m1.id) },
  {
    id: "review-camera-add",
    seed: "full",
    who: "rev",
    run: (k) => reviewCamera(k, addedId(ADD.a2.uuid)),
  },
  {
    id: "review-camera-conflict",
    seed: "full",
    who: "rev",
    run: (k) => reviewCamera(k, CAM.e1.id, { query: "file=conflicts", scroll: ".review-decide" }),
  },
  {
    id: "review-camera-duplicate",
    seed: "full",
    who: "rev",
    run: (k) => reviewCamera(k, addedId(ADD.dup.uuid), { scroll: ".review-decide" }),
  },
  {
    id: "review-camera-direction",
    seed: "full",
    who: "rev",
    run: (k) => reviewCamera(k, DOME.id, { scroll: ".review-decide" }),
  },
  {
    id: "review-camera-no-effect",
    seed: "full",
    who: "rev",
    run: (k) => reviewCamera(k, LAMP.id, { scroll: ".review-decide" }),
  },
  { id: "review-camera-test", seed: "full", who: "rev", run: (k) => reviewCamera(k, CAM.ts.id) },
  {
    id: "review-camera-others",
    seed: "full",
    who: "rev",
    run: (k) => reviewCamera(k, CAM.x2.id, { scroll: ".review-others" }),
  },
  {
    id: "review-camera-decided",
    seed: "full",
    who: "rev",
    run: (k) => reviewCamera(k, MOVED_OFF_SITE.id, { scroll: "#review-details" }),
  },
  {
    id: "review-details",
    seed: "full",
    who: "rev",
    async run(k) {
      await reviewCamera(k, CAM.m1.id);
      await k.tap("#review-details summary");
      await k.show("#review-details");
    },
  },
  {
    // A « Modifier » send (punk): moved 4 m, a tube, at the first floor, as the phone
    // sends it (three pieces sharing their batch), then its view.
    id: "review-camera-send",
    seed: "full",
    who: "rev",
    writes: true,
    async run(k) {
      const batch = "5eed0b01-0000-4000-8000-0000000000b1";
      const base = { build_id: BUILD, day: "2026-10-08", on_site: true };
      const to = offsetLngLat(FIXED.at, 4, 0);
      const pieces = [
        { kind: "move", lon: to[0], lat: to[1], placement: "free" },
        { kind: "shape", answer: "bullet" },
        { kind: "height", answer: "first", aim_kind: "fixed" },
      ];
      let i = 0;
      for (const p of pieces)
        await api("ana", "POST", "/api/contributions", {
          ...base,
          ...p,
          uuid: `5eed0b01-0000-4000-8000-00000000000${++i}`,
          camera: FIXED.id,
          batch,
        });
      await reviewCamera(k, FIXED.id, { scroll: ".review-decide" });
    },
  },
  {
    // Two answers made on site by two accounts: « Valider ce qui est fait sur place (2) ».
    id: "review-on-site",
    seed: "full",
    who: "rev",
    writes: true,
    async run(k) {
      const base = { build_id: BUILD, day: "2026-10-09", on_site: true };
      for (const [who, n] of [
        ["ana", 1],
        ["bob", 2],
      ])
        await api(who, "POST", "/api/contributions", {
          ...base,
          kind: "verify",
          answer: "present",
          uuid: `5eed0c01-0000-4000-8000-00000000000${n}`,
          camera: NEVER.id,
        });
      await reviewCamera(k, NEVER.id);
    },
  },
  {
    // « Valider » once: « Validée. » and « Annuler (8 s) » over the next camera's view.
    id: "review-decided",
    seed: "full",
    who: "rev",
    writes: true,
    async run(k) {
      await reviewCamera(k, CAM.m1.id);
      await k.tap('[data-action="validated"]');
      await k.page.waitForSelector(".review-toast-undo");
      await k.page.waitForTimeout(1500);
    },
  },
  {
    // « Annuler »: the decision undone, the camera back, « Décision annulée » said.
    id: "review-undone",
    seed: "full",
    who: "rev",
    writes: true,
    async run(k) {
      await reviewCamera(k, CAM.m1.id);
      await k.tap('[data-action="validated"]');
      await k.tap(k.page.locator(".review-toast-undo"));
      await k.page.waitForFunction(() =>
        document.getElementById("review-live")?.textContent?.includes("annulée"),
      );
      await k.page.waitForTimeout(1500);
    },
  },
  {
    // The last camera decided: back to the queue, « File vide » (the queue's answer
    // emptied by the page: the seed has more than one camera waiting).
    id: "review-queue-done",
    seed: "full",
    who: "rev",
    writes: true,
    async run(k) {
      await reviewCamera(k, CAM.m1.id);
      await k.page.route("**/api/review/queue?**", (r) =>
        r.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            summary: { pending: 0, oldest_days: null, counts: { todo: 0, conflicts: 0, names: 0 } },
            items: [],
          }),
        }),
      );
      await k.tap('[data-action="validated"]');
      await k.page.waitForSelector("#review-queue .review-note:not([hidden])");
      await k.page.waitForTimeout(1500);
    },
  },
  {
    // A decision the API refuses (here the rate limit): said above the bar and aloud.
    id: "review-decide-error",
    seed: "full",
    who: "rev",
    async run(k) {
      await reviewCamera(k, CAM.m1.id);
      await k.page.route("**/api/review/decide", (r) =>
        r.fulfill({ status: 429, contentType: "application/json", body: '{"error":"rate"}' }),
      );
      await k.tap('[data-action="validated"]');
      await k.page.waitForSelector(".review-foot .review-error:not([hidden])");
      await k.page.waitForTimeout(500);
    },
  },
  {
    id: "review-change-armed",
    seed: "full",
    who: "rev",
    async run(k) {
      await reviewCamera(k, CAM.v1.id, { scroll: "#review-details" });
      const change = k.page.locator("#review-details button.decide-change").first();
      // Centred: at the screen's foot it would lie under the fixed decision bar.
      await change.evaluate((e) => e.scrollIntoView({ block: "center" }));
      await k.tap(change);
      await k.page.waitForTimeout(300);
    },
  },

  {
    // An administrator's camera view hidden from the map (GET /api/review/hidden answered):
    // « masquée », since when, the way to « Retraits ».
    id: "review-camera-hidden",
    seed: "full",
    who: "rev",
    async run(k) {
      await k.page.route("**/api/review/hidden", (r) =>
        r.fulfill({
          json: [{ camera: CAM.m1.id, added_on: TODAY, applied_build: null, label: null }],
        }),
      );
      await reviewCamera(k, CAM.m1.id, { scroll: "#review-retreat-title" });
    },
  },
  // The administrator's views (lot 2, boards P3, P4, P5): what writes is answered by the
  // page (the accounts and the hidden cameras outlive a state: the seeds empty only the
  // contributions).
  { id: "review-accounts", seed: "full", who: "rev", run: (k) => revue(k, "vue=comptes") },
  { id: "review-account", seed: "full", who: "rev", run: (k) => accountSheet(k, "bob") },
  {
    // « Couper l'accès » in two taps, the password not given lately: the dialog.
    id: "review-reauth",
    seed: "full",
    who: "rev",
    async run(k) {
      await k.page.route("**/api/review/account/cut", (r) =>
        r.fulfill({ status: 403, json: { error: "reauth" } }),
      );
      await accountSheet(k, "bob");
      await k.tap("#review-cut");
      await k.tap("#review-cut");
      await k.page.waitForSelector("#review-reauth[open]");
      await k.page.waitForTimeout(400);
    },
  },
  {
    id: "review-account-reset",
    seed: "full",
    who: "rev",
    async run(k) {
      await k.page.route("**/api/review/account/reset", (r) =>
        r.fulfill({ json: { password: "Exemple-fictif-pas-un-vrai" } }),
      );
      await accountSheet(k, "bob");
      await k.tap("#review-reset");
      await k.tap("#review-reset");
      await k.page.waitForSelector(".review-reset");
      await k.page.waitForTimeout(400);
    },
  },
  {
    id: "review-account-suspend-armed",
    seed: "full",
    who: "rev",
    async run(k) {
      await accountSheet(k, "bob");
      await k.show("#review-suspend");
      await k.tap("#review-suspend");
      await k.page.waitForTimeout(300);
    },
  },
  {
    id: "review-hidden",
    who: "rev",
    async run(k) {
      await k.page.route("**/api/review/hidden", (r) =>
        r.request().method() === "GET"
          ? r.fulfill({
              json: [
                { camera: CAM.m1.id, added_on: TODAY, applied_build: null, label: null },
                {
                  camera: "c3f2a9b1c4d5e",
                  added_on: "2026-10-14",
                  applied_build: BUILD,
                  label: null,
                },
              ],
            })
          : r.continue(),
      );
      await revue(k, "vue=retraits");
      await k.page.fill("#review-hide-id", `https://exemple.invalid/?cam=${CAM.v1.id}`);
      await k.page.waitForTimeout(1500);
    },
  },
  { id: "review-settings", who: "rev", run: (k) => revue(k, "vue=reglages") },
  {
    // The activity feed (the « go » of 17/10), the API's answer mocked (journalMock).
    id: "review-journal",
    who: "rev",
    async run(k) {
      await mockJournal(k);
      await revue(k, "vue=journal");
      await k.page.waitForSelector("#review-journal .review-feed-item");
      await k.page.waitForTimeout(300);
    },
  },
  {
    // The feed under « Décisions » (the address keeps it: &type=decisions).
    id: "review-journal-filtered",
    who: "rev",
    async run(k) {
      await mockJournal(k);
      await revue(k, "vue=journal");
      await k.page.waitForSelector("#review-journal .review-feed-item");
      await k.tap('#review-journal .review-chip[data-type="decisions"]');
      await k.page.waitForFunction(() => window.location.search.includes("type=decisions"));
      await k.page.waitForTimeout(300);
    },
  },
  // The OSM synchronisation in /revue. « Réglages »'s two switches as this API has them
  // (synchronisation on, writing to the live server off and greyed: no live client here),
  // then as a site with the live client would show them, writing live on.
  {
    id: "review-settings-osm",
    who: "rev",
    async run(k) {
      await revue(k, "vue=reglages");
      await k.show("#review-switch-osm_write_live");
    },
  },
  {
    id: "review-settings-osm-live",
    who: "rev",
    async run(k) {
      await patchJson(k, "**/api/review/settings", (s) => ({
        ...s,
        osm_sync: false,
        osm_write_live: true,
        osm: { ...s.osm, write_offered: true, write_server: "live", live_client: true },
      }));
      await revue(k, "vue=reglages");
      await k.show("#review-switch-osm_write_live");
    },
  },
  // The queue's « OSM » filter: two cameras with a publication that needs a look (the real
  // queue's first two, their first piece given a conflict and an uncertain send: no
  // publication exists without OSM).
  {
    id: "review-queue-osm",
    seed: "full",
    who: "rev",
    async run(k) {
      await k.page.route("**/api/review/queue?*", async (r) => {
        const url = new URL(r.request().url());
        if (url.searchParams.get("filter") !== "osm") return r.fallback();
        url.searchParams.set("filter", "all");
        const real = await r.fetch({ url: url.href });
        const q = await real.json();
        const OSM = [
          { state: "conflict", reason: "osm_value", server: "dev" },
          { state: "uncertain", reason: null, server: "dev" },
        ];
        const items = q.items.slice(0, 2).map((item, i) => ({
          ...item,
          pieces: item.pieces.map((p, j) => (j === 0 ? { ...p, osm: OSM[i] } : p)),
        }));
        return r.fulfill({
          response: real,
          json: { ...q, summary: { ...q.summary, counts: { ...q.summary.counts, osm: 2 } }, items },
        });
      });
      await revue(k, "file=osm");
      await k.page.waitForSelector(".review-row");
    },
  },
  // A camera's view, its « Modifier » send's pieces each bound elsewhere: waiting to leave,
  // changed by the review (stays here), sent but uncertain.
  {
    id: "review-camera-osm",
    seed: "full",
    who: "rev",
    writes: true,
    async run(k) {
      const batch = "5eed0b02-0000-4000-8000-0000000000b2";
      const base = { build_id: BUILD, day: "2026-10-08", on_site: true };
      const to = offsetLngLat(FIXED.at, 4, 0);
      const pieces = [
        { kind: "move", lon: to[0], lat: to[1], placement: "free" },
        { kind: "shape", answer: "bullet" },
        { kind: "height", answer: "first", aim_kind: "fixed" },
      ];
      let i = 0;
      for (const p of pieces)
        await api("ana", "POST", "/api/contributions", {
          ...base,
          ...p,
          uuid: `5eed0b02-0000-4000-8000-00000000000${++i}`,
          camera: FIXED.id,
          batch,
        });
      const DEST = {
        move: {
          where: "osm",
          server: "dev",
          state: "waiting",
          reason: null,
          changeset: null,
          month: null,
        },
        shape: { where: "sw", state: "kept_edited" },
        height: {
          where: "osm",
          server: "dev",
          state: "uncertain",
          reason: null,
          changeset: null,
          month: "2026-10",
        },
      };
      await patchJson(k, "**/api/review/camera?*", (c) => ({
        ...c,
        contributions: c.contributions.map((r) =>
          r.batch === batch ? { ...r, destination: DEST[r.kind] ?? r.destination } : r,
        ),
      }));
      await reviewCamera(k, FIXED.id, { scroll: ".review-dest" });
    },
  },
  // « Fiche utilisateur »: « Publie sur OSM : oui depuis octobre 2026 (serveur de test) ·
  // dernier refus d'OSM : … », its publications in each state.
  {
    id: "review-account-sync",
    seed: "full",
    who: "rev",
    async run(k) {
      const pub = (n, state, extra = {}) => ({
        uuid: `5eed0b03-0000-4000-8000-00000000000${n}`,
        server: "dev",
        state,
        reason: null,
        changeset: null,
        month: "2026-10",
        ...extra,
      });
      await patchJson(k, "**/api/review/account?*", (a) => ({
        ...a,
        publish: true,
        sync: { on: true, server: "dev", since: "2026-10", last_error: "rate_limited" },
        publications: [
          pub(1, "published", { changeset: 12345 }),
          pub(2, "conflict", { reason: "osm_duplicate" }),
          pub(3, "uncertain"),
          pub(4, "sending"),
        ],
      }));
      await accountSheet(k, "bob");
      await k.show("#review-pubs-title");
    },
  },

  {
    // « Statistiques » (lot 4, board P6; the « go » of 17/10): the API's answer mocked in
    // S6's shape (statsMock), publishing not offered, « Retraits » under its threshold.
    id: "review-stats",
    who: "rev",
    async run(k) {
      await k.page.route("**/api/review/stats", (r) => r.fulfill({ json: statsMock() }));
      await revue(k, "vue=statistiques");
      await k.page.waitForSelector("#review-stats .review-stats-grid");
      await k.page.waitForTimeout(400);
    },
  },
  {
    // The same, the last 24 hours' « Voir les chiffres » open: each hour, its reference.
    id: "review-stats-figures",
    who: "rev",
    async run(k) {
      await k.page.route("**/api/review/stats", (r) => r.fulfill({ json: statsMock() }));
      await revue(k, "vue=statistiques");
      await k.page.waitForSelector("#review-stats .review-stats-grid");
      await k.tap("#review-stat-hours .review-figures summary");
      await k.show("#review-stat-hours .review-figures");
      await k.page.waitForTimeout(300);
    },
  },
  {
    // No block with enough data (S6's answer mocked until it is integrated: every block
    // `enough: false`, n = 0).
    id: "review-stats-empty",
    who: "rev",
    async run(k) {
      await k.page.route("**/api/review/stats", (r) =>
        r.fulfill({ json: statsMock({ low: true }) }),
      );
      await revue(k, "vue=statistiques");
      await k.page.waitForSelector("#review-stats .review-stats-grid");
      await k.page.waitForTimeout(400);
    },
  },

  // Communes, arrondissements, départements
  { id: "area-commune", run: (k) => k.open("?insee=92026", { sheet: true }) },
  {
    id: "area-commune-public",
    async run(k) {
      await k.open("?insee=92026", { sheet: true });
      await filters(k);
      await k.tap(k.page.locator("#filters label", { hasText: "publiques seules" }));
      await k.page.waitForTimeout(600);
      if (k.phone) await k.tap("#filters .panel-close");
      await k.idle();
    },
  },
  {
    id: "area-how",
    async run(k) {
      await k.open("?insee=92026", { sheet: true });
      await k.fullSheet();
      await k.tap("#sheet :is(details.how summary, .how-toggle)");
      await k.show("#sheet :is(details.how summary, .how:not([hidden]))");
    },
  },
  // The punk sheet after 24a: its tickets are tabs, « Publiques » recounts in the sheet.
  {
    id: "area-sheet-public",
    async run(k) {
      await k.open("?insee=92026", { sheet: true });
      await k.tap('#sheet .area-toggle[data-set="public"]');
      await k.page.waitForTimeout(300);
    },
  },
  {
    id: "area-tab-cameras",
    async run(k) {
      await k.open("?insee=92026", { sheet: true });
      await k.tap("#area-tab-cameras");
      await k.page.waitForTimeout(300);
    },
  },
  {
    id: "area-tab-who",
    async run(k) {
      await k.open("?insee=92026", { sheet: true });
      await k.tap("#area-tab-who");
      await k.page.waitForTimeout(300);
    },
  },
  {
    // A phone's half-open commune sheet, scrolled: the title and its line alone stay.
    id: "area-half-scrolled",
    devices: ["phone"],
    async run(k) {
      await k.open("?insee=92026", { sheet: true });
      await scrollPaper(k);
    },
  },
  { id: "area-departement", run: (k) => k.open("?insee=92", { sheet: true }) },
  { id: "area-no-camera", run: (k) => k.open("?insee=92035", { sheet: true }) },
  { id: "area-no-camera-filmed", run: (k) => k.open("?insee=92050", { sheet: true }) },

  // Errors
  {
    id: "error-meta-missing",
    async run(k) {
      await k.page.route("**/tiles/meta.json", (r) => r.fulfill({ status: 404, body: "" }));
      await k.open(hash(STREET, 16.5), { map: false });
      await k.page.waitForTimeout(2500);
    },
  },
  {
    id: "error-tiles",
    async run(k) {
      await k.page.route(/\/tiles\/(detail|streets|admin)\.pmtiles/, (r) =>
        r.fulfill({ status: 500, body: "" }),
      );
      await k.open(hash(STREET, 16.5), { map: false });
      await k.page.waitForTimeout(4000);
    },
  },
  {
    id: "error-api-down",
    async run(k) {
      await k.page.route("**/api/**", (r) => r.abort("failed"));
      await sheet(k, FIXED);
    },
  },
  {
    id: "error-offline-map",
    async run(k) {
      await k.open(hash(STREET, 15.2));
      await offline(k);
      await k.jump({ center: [2.2405, 48.8995], zoom: 18.5 }, 3000);
    },
  },
  {
    id: "error-rate-send",
    async run(k) {
      await k.page.route("**/api/contributions", (r) =>
        r.request().method() === "POST"
          ? r.fulfill({ status: 429, contentType: "application/json", body: '{"error":"rate"}' })
          : r.continue(),
      );
      await sheet(k, FIXED);
      await notFound(k);
      await k.page.keyboard.press("Escape");
      await k.page.waitForTimeout(800);
    },
  },
  {
    id: "error-send-refused-500",
    async run(k) {
      // A contribution on an added camera the database holds no add for (the CI build's
      // cadd000010000 after the reset): the API fails (500), the queue keeps it.
      await sheet(k, ADDED_ON_SITE);
      await k.tap(sheetBtn(k, "Toujours là"));
      await k.tap(sheetBtn(k, "Elle est là"));
      await k.page.waitForSelector(".part-done");
      await k.page.keyboard.press("Escape");
      await k.page.waitForTimeout(1500);
    },
  },
  ...PROFILE_STATES,
  ...CAMERAS_STATES,
  // The welcome (28a, lot of 2026-10-11): a device that has not seen it (the harness marks
  // every other capture a returning visit).
  { id: "welcome-first", run: (k) => welcome(k) },
];
