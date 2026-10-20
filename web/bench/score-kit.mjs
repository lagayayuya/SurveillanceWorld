// GET /api/me/points answered by the page itself (Playwright route mocks), for the points
// scored at the send (board 8a: participate/score.ts) in smoke-score.mjs and shots-fete.mjs:
// a failure, a slow answer, at will (the smoke also asks the real API once). The sends
// themselves go to the real API (or wherever the page sends them); each body is recorded on
// its way, and the points are those of 26a's scale (DECISIONS 2026-10-10, « Points (26a,
// rules/leaderboard.yaml)… »), by the server's rule (pipeline/lacarte/api/leaderboard.py
// awards()), which the phone also tells for the tickets' colours (src/profile/award.ts):
// the three are kept aligned. « Replaces a known value » is read here from the cameras the
// journeys edit (KNOWN). Then the journeys the smoke and the captures share.
import { devices } from "playwright";

/** The id of the camera an add creates (participate/queue.ts addedId). */
const addedId = (uuid) => `c${uuid.replaceAll("-", "").slice(0, 12)}`;
export const SCALE = { add: 50, info: 10, correction: 20, verification: 10, bonus: 10 };
const INFOS = ["shape", "direction", "height", "tilt", "operator"];
// What a camera had (rules/leaderboard.yaml known), as the server reads its OSM tags: 8a's
// dome has camera:type, height and operator; its camera:direction=360 is out of range
// (osmtags.parse_direction), the 180° the map shows a contribution's: answering it adds.
const KNOWN = new Map([["n998633844", new Set(["shape", "height", "operator"])]]);
/** The infos an add's shape asks (leaderboard.asked): the direction but for a PTZ or a
 * panorama, the height but for a PTZ, the tilt for a bullet (kind fixed). */
const asked = (shape) => [
  "shape",
  "operator",
  ...(["ptz", "multi"].includes(shape) ? [] : ["direction"]),
  ...(shape === "ptz" ? [] : ["height"]),
  ...(shape === "bullet" ? ["tilt"] : []),
];

/** The items the server would give for `uuids` among the `sent` bodies (uuid → body). */
export function awards(sent, uuids) {
  const items = [];
  const item = (uuid, body, category, points, bonus = false) =>
    items.push({ uuid, kind: body.kind, category, points, bonus, accepted: false });
  for (const uuid of uuids) {
    const body = sent.get(uuid);
    if (!body) continue;
    if (body.kind === "add") {
      item(uuid, body, "add", SCALE.add);
      const answers = [...sent.values()].filter(
        (b) =>
          b.camera === addedId(uuid) &&
          INFOS.includes(b.kind) &&
          b.answer !== "unknown" &&
          b.answer !== "not_visible",
      );
      const shape = answers.find((b) => b.kind === "shape")?.answer;
      const kinds = new Set(answers.map((b) => b.kind));
      if (shape && asked(shape).every((k) => kinds.has(k)))
        item(uuid, body, "add", SCALE.bonus, true);
      continue;
    }
    if (body.kind === "verify") {
      if (body.on_site === true && (body.answer === "present" || body.answer === "not_found"))
        item(uuid, body, "verification", SCALE.verification);
      continue;
    }
    if (body.answer === "unknown" || body.answer === "not_visible") continue;
    if (body.kind === "move" || KNOWN.get(body.camera)?.has(body.kind))
      item(uuid, body, "correction", SCALE.correction);
    else item(uuid, body, "info", SCALE.info);
  }
  return { items, total: items.reduce((s, i) => s + i.points, 0) };
}

/** Records every contribution the page sends and answers GET /api/me/points from them;
 * `fail`: the points route answers 500 instead (a failure: no number shown); `delay`: it
 * answers that many ms late; `none`: it gives nothing (as for pieces sent again within
 * their month: leaderboard.py awards()); `real`: the real API answers (its body kept in
 * `answers`). Returns the recorded bodies (uuid → body), the uuids asked and the real
 * answers. */
export async function mockPoints(
  page,
  { fail = false, delay = 0, real = false, none = false } = {},
) {
  const sent = new Map();
  const asked = [];
  const answers = [];
  await page.route("**/api/contributions", (route) => {
    const req = route.request();
    if (req.method() === "POST") {
      const body = req.postDataJSON();
      sent.set(body.uuid, body);
    }
    return route.fallback();
  });
  await page.route(/\/api\/me\/points\?/, async (route) => {
    const uuids = new URL(route.request().url()).searchParams.getAll("uuid");
    asked.push(...uuids);
    if (real)
      return route.fetch().then(async (r) => {
        answers.push(await r.json());
        return route.fulfill({ response: r });
      });
    if (delay) await new Promise((done) => setTimeout(done, delay));
    // Late, the page may have given up on it (score.ts POINTS_TIMEOUT_MS): nothing to answer.
    const given = none ? { items: [], total: 0 } : awards(sent, uuids);
    const answer = fail
      ? { status: 500, contentType: "application/json", body: "{}" }
      : { status: 200, contentType: "application/json", body: JSON.stringify(given) };
    return route.fulfill(answer).catch(() => undefined);
  });
  return { sent, asked, answers };
}

// --- the journeys of the smoke and the captures, on the states' servers (states/harness.mjs:
// the throwaway API on the CI build, real sends, real fields) -----------------------------

/** 8a's camera on the CI extract: a public dome looking south (180°), its height estimated. */
export const DOME = { id: "n998633844", at: [48.897281, 2.238582] };
/** A facade with no camera within 20 m (« ＋ Ajouter »). */
export const FREE = [48.8981364, 2.2403746];

/** (lon, lat) `dx`, `dy` metres from (lat, lon). */
export const offsetLngLat = ([lat, lon], dx, dy) => [
  lon + dx / (111320 * Math.cos((lat * Math.PI) / 180)),
  lat + dy / 111320,
];

/** A context as the boards' frames: `size` (390 × 845 phone, 960 × 581 wide) at scale 2,
 * light, punk, a returning visit (no welcome) but with `welcome`, signed in as `who`; the
 * phone's position at `geolocation` ({ latitude, longitude, accuracy }) when given. */
export async function frameContext(
  browser,
  size,
  { who = "ana", reduced = false, welcome = false, dark = false, geolocation, login, cookie, app },
) {
  const phone = size.width < 600;
  const context = await browser.newContext({
    ...(phone ? { isMobile: true, hasTouch: true, userAgent: devices["iPhone 14"].userAgent } : {}),
    viewport: size,
    deviceScaleFactor: 2,
    colorScheme: dark ? "dark" : "light",
    reducedMotion: reduced ? "reduce" : "no-preference",
    locale: "fr-FR",
    timezoneId: "Europe/Paris",
    ...(geolocation ? { geolocation, permissions: ["geolocation"] } : {}),
  });
  await context.addInitScript(
    ([mode, first]) => {
      try {
        localStorage.setItem("lacarte.ui", "punk");
        localStorage.setItem("lacarte.mode", mode);
        localStorage.setItem("lacarte.fonts", "1");
        if (first) localStorage.removeItem("lacarte.welcome");
        else localStorage.setItem("lacarte.welcome", "1");
      } catch {
        // about:blank has no storage.
      }
    },
    [dark ? "sombre" : "clair", welcome],
  );
  if (who)
    await context.addCookies([
      { name: cookie, value: await login(who), url: app, httpOnly: true, sameSite: "Strict" },
    ]);
  return context;
}

const editView = (k, view) =>
  k.page.waitForSelector(`#modify-panel[data-view="${view}"]`, { timeout: 20000 });

/** A step of the editor (states/catalogue.mjs editSteps): [field] unfolds its line, [answer]
 * or [answer, part] taps a choice. */
export async function editSteps(k, steps) {
  for (const [what, part] of steps) {
    if (["shape", "direction", "mount", "tilt", "operator"].includes(what) && !part) {
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

/** Aim the direction at (lon, lat) and « Valider ». */
async function aim(k, lngLat) {
  await editView(k, "aim");
  // The map at rest first: a tap while it eases to the aim's view is lost.
  await k.page.waitForTimeout(1200);
  const before = await k.page.locator("#edit-tag").textContent();
  await k.tapAt(lngLat);
  await k.page.waitForFunction(
    (was) => document.querySelector("#edit-tag")?.textContent !== was,
    before,
    { timeout: 10000 },
  );
  await k.page.waitForSelector("#aim-submit:not([disabled])", { timeout: 10000 });
  await k.tap("#aim-submit");
  await editView(k, "sheet");
}

/** 8a's three changes on DOME, ready to send: the direction turned north-west (from 180°),
 * the first floor, « Public » (and the first name offered, when any). */
export async function threeChanges(k) {
  await k.open(`?cam=${DOME.id}#18/${DOME.at[0]}/${DOME.at[1]}`, { sheet: true });
  await k.tap("#part-modify");
  await editView(k, "sheet");
  await editSteps(k, [["direction"]]);
  await aim(k, offsetLngLat(DOME.at, -9, 5));
  await editSteps(k, [["mount"], ["first", "height"], ["operator"], ["public", "operator"]]);
  await k.page.waitForSelector("#modify-panel [data-operator]", { timeout: 8000 }).catch(() => {});
  const name = k.page.locator("#modify-panel [data-operator]").first();
  if (await name.count()) await k.tap(name);
  // The field the send gives, drawn on the map behind the sheet.
  await k.page
    .waitForFunction(() => window.__map.querySourceFeatures("edit-field").length > 0, null, {
      timeout: 20000,
    })
    .catch(() => {});
  await k.page.waitForTimeout(800);
}

/** « ＋ Ajouter » at FREE filled: a dome (or `shape`) aimed 15 m east (with `unseen`, its
 * direction « Je ne vois pas » instead), the first floor, a slight tilt when the shape asks
 * one (a bullet: then seven tickets), « Public ». */
export async function addFilled(k, { shape = "dome", unseen = false } = {}) {
  await k.open(`#18/${FREE[0]}/${FREE[1]}`);
  await k.page.waitForSelector("#fab-add:not([hidden]):not([aria-disabled='true'])", {
    timeout: 30000,
  });
  await k.tap("#fab-add");
  await editView(k, "position");
  await k.page.waitForTimeout(800);
  await k.tap("#modify-here");
  await k.page.waitForSelector('#modify-panel:is([data-view="sheet"], [data-view="duplicates"])');
  if (unseen) {
    await editSteps(k, [[shape]]);
    const line = k.page.locator('#modify-panel .modify-line[data-field="direction"]');
    if (await line.evaluate((e) => e.tagName === "BUTTON")) await k.tap(line);
    await editSteps(k, [["unknown", "direction"]]);
  } else {
    await editSteps(k, [[shape], ["direction"]]);
    await aim(k, offsetLngLat(FREE, 15, 0));
  }
  await editSteps(k, [
    ["first", "height"],
    ...(shape === "bullet" ? [["slight", "tilt"]] : []),
    ["public", "operator"],
  ]);
  await k.page.waitForTimeout(800);
}

/** Every animation of the page held at `ms` from its start (the scene's all start with the
 * tap on « Envoyer »), for a capture of that instant. */
export const holdAt = (page, ms) =>
  page.evaluate((t) => {
    for (const a of document.getAnimations()) {
      a.pause();
      a.currentTime = t;
    }
  }, ms);
