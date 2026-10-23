// Smoke test and captures of the punk editor (adding and « Modifier », participate/modify.ts)
// for the author's points 3 to 6 of 2026-10-12, on the states' servers (states/harness.mjs:
// the throwaway API on the CI build, real sends, real fields), a phone (390 × 845, WebKit,
// real taps) and a wide screen (960 × 581, Chromium, clicks), light (point 3 dark too), at
// scale 2:
//   3. the field under the streets and their names (layer order), lighter, once aimed;
//      while the pin is placed and before a direction is chosen, the possible field only
//      (the return on Temps 1, point 4): its outline thin and dotted, its fill very light,
//      under the streets and their names; a small dome offers « Inclinaison » (point 1);
//   4. the aim's minimum in screen pixels (a target 2 m away at z21 lights « Valider »), and
//      each case without a field said near the target;
//   5. the height's three choices in metres, no « Poteau »;
//   6. who films: the whole list with a search, a name not listed (« Public » or « Commerce
//      ou entreprise » only), never shown in « Vos contributions » before review.
// What the CI build or the API of this branch do not serve yet is answered by the page
// itself (Playwright routes, as score-kit.mjs answers the points): meta's min_target_px
// and tilt_kinds (questions@5) when the build predates them, POST /api/operators without `class` (the contract of the lot
// of 2026-10-12), « Vos contributions » with a proposed name; the field's failures. Exits
// non-zero if a check failed.
//   node bench/smoke-editor.mjs [--only phone|wide] [--shots DIR]
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, webkit } from "playwright";
import { DOME, FREE, frameContext, offsetLngLat } from "./score-kit.mjs";
import { COOKIE } from "./session.mjs";
import {
  APP,
  closeProxy,
  login,
  resetContributions,
  startServers,
  stopServers,
  takenPorts,
} from "./states/harness.mjs";
import { kit } from "./states/kit.mjs";

const args = process.argv.slice(2);
const arg = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const only = arg("--only", null);
const SHOTS = args.includes("--shots") ? resolve(arg("--shots")) : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const PHONE = { width: 390, height: 845 };
const WIDE = { width: 960, height: 581 };
const ctx = { login, cookie: COOKIE, app: APP };

const checks = [];
let where = "";
function check(name, ok, detail = "") {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "ok  " : "FAIL"} [${where}] ${name}${detail ? ` — ${detail}` : ""}`);
}
const shot = async (page, name) => {
  if (SHOTS) await page.screenshot({ path: join(SHOTS, `${name}-${where}.png`) });
};

/** The CI build's meta with min_target_px and the editor's tilt kinds as
 * rules/questions.yaml says them when it predates them. */
async function withPx(page) {
  await page.route(/\/tiles\/meta\.json/, async (route) => {
    const r = await route.fetch();
    const meta = await r.json();
    const q = meta.participation?.questions;
    if (q && q.min_target_px === undefined) q.min_target_px = MIN_TARGET_PX;
    if (q) q.editor_tilt_kinds = TILT_KINDS;
    return route.fulfill({ response: r, json: meta });
  });
}
// rules/questions.yaml direction.min_target_px and tilt.kinds, read once.
const [MIN_TARGET_PX, TILT_KINDS] = await (async () => {
  const { readFileSync } = await import("node:fs");
  const yaml = readFileSync(new URL("../../rules/questions.yaml", import.meta.url), "utf8");
  const px = /^\s+min_target_px:\s*(\d+)/m.exec(yaml);
  const tilt = /^tilt:\n(?:\s.*\n)*?\s+kinds:\s*\[([^\]]*)\]/m.exec(yaml);
  return [px ? Number(px[1]) : null, tilt ? tilt[1].split(",").map((k) => k.trim()) : []];
})();

const view = (page, v) =>
  page.waitForSelector(`#modify-panel[data-view="${v}"]`, { timeout: 20000 });
/** The edit field's features as drawn (its source's, whatever is in view). */
const fieldCount = (page) =>
  page.evaluate(() => window.__map.querySourceFeatures("edit-field").length);
/** The possible field's features as drawn (no direction chosen yet). */
const possibleCount = (page) =>
  page.evaluate(() => window.__map.querySourceFeatures("edit-possible").length);
const waitPossible = (page) =>
  page
    .waitForFunction(() => window.__map.querySourceFeatures("edit-possible").length > 0, null, {
      timeout: 10000,
    })
    .catch(() => {});
/** The next answer of /api/modify/preview, then the map at rest. */
async function previewed(page, act) {
  const answer = page.waitForResponse(/\/api\/modify\/preview/, { timeout: 20000 });
  await act();
  await answer;
  await page.waitForTimeout(400);
}

let browser;
/** A punk page at `size`, the kit of the states' captures; `dark`: the dark theme. */
async function open(size, dark = false) {
  const context = await frameContext(browser, size, { ...ctx, dark });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await withPx(page);
  // Who films as the contract's API answers it (point 6); a scene may answer otherwise
  // (Playwright runs the last route registered first).
  await page.route(/\/api\/operators$/, (route) =>
    route.request().postDataJSON().class
      ? route.fallback()
      : route.fulfill({ json: { near: NEAR, all: ALL } }),
  );
  const phone = size.width < 600;
  const k = kit(page, context, { device: phone ? "phone" : "desktop", mode: "clair" });
  return { context, page, errors, k };
}

/** « ＋ Ajouter » at FREE: the position view, the server's answer in. */
async function startAdd(k, page) {
  await k.open(`#18/${FREE[0]}/${FREE[1]}`);
  await page.waitForSelector("#fab-add:not([hidden]):not([aria-disabled='true'])", {
    timeout: 30000,
  });
  await previewed(page, async () => {
    await k.tap("#fab-add");
    await view(page, "position");
  });
}

/** Aim at (lon, lat) on the map: the target there, the field asked for its bearing. */
async function aimAt(k, page, lngLat) {
  await view(page, "aim");
  // The map at rest first: a tap while it eases to the aim's view is lost.
  await page.waitForTimeout(1200);
  await previewed(page, () => k.tapAt(lngLat));
}

// --- 3. the field under the streets once aimed, the possible field before ------------------
/** Where the editor's layers sit and how the possible field is painted. */
const layerOrder = (page) =>
  page.evaluate(() => {
    const m = window.__map;
    const layers = m.getStyle().layers;
    const at = (id) => layers.findIndex((l) => l.id === id);
    const edit = layers.flatMap((l, i) => (l.id.startsWith("edit-field-") ? [i] : []));
    return {
      edit: Math.max(...edit),
      possible: Math.max(at("edit-possible"), at("edit-possible-line")),
      buildings: at("buildings"),
      streets: at("streets"),
      portions: at("portions"),
      label: layers.findIndex((l) => l.type === "symbol" && l.source === "protomaps"),
      opacity: m.getPaintProperty("edit-field-3", "fill-opacity"),
      possibleFill: m.getPaintProperty("edit-possible", "fill-opacity"),
      possibleDash: m.getPaintProperty("edit-possible-line", "line-dasharray"),
      possibleCap: m.getLayoutProperty("edit-possible-line", "line-cap"),
      possibleWidth: m.getPaintProperty("edit-possible-line", "line-width"),
    };
  });
const under = (o, i) => i < o.buildings && i < o.streets && i < o.portions && i < o.label;

async function pointThree(size, dark = false) {
  const { page, errors, k, context } = await open(size, dark);
  const theme = dark ? "dark" : "light";
  await startAdd(k, page);
  await waitPossible(page);
  const placing = { field: await fieldCount(page), possible: await possibleCount(page) };
  check(
    `3: placing the pin (${theme}), the possible field only, no aimed field`,
    placing.field === 0 && placing.possible > 0,
    JSON.stringify(placing),
  );
  const o = await layerOrder(page);
  const dash = Array.isArray(o.possibleDash?.[1]) ? o.possibleDash[1] : o.possibleDash;
  check(
    `3: the possible field (${theme}) under the buildings, our streets and every label; its outline thin and dotted, its fill very light`,
    under(o, o.possible) &&
      o.possibleCap === "round" &&
      Array.isArray(dash) &&
      dash[0] === 0 &&
      dash[1] > 0 &&
      o.possibleWidth <= 2 &&
      o.possibleFill > 0 &&
      o.possibleFill <= 0.15,
    JSON.stringify(o),
  );
  await shot(page, `3a-placement-${theme}`);
  await k.tap("#modify-here");
  await view(page, "sheet");
  await previewed(page, () => k.tap('#modify-panel .modify-tile[data-answer="dome"]'));
  const sheetBefore = { field: await fieldCount(page), possible: await possibleCount(page) };
  check(
    `3: the sheet before a direction (${theme}), the possible field only`,
    sheetBefore.field === 0 && sheetBefore.possible > 0,
    JSON.stringify(sheetBefore),
  );
  // Point 1 (questions@5): a small dome offers « Inclinaison », its three classes.
  const tilt = await page
    .locator('#modify-panel .modify-chip[data-part="tilt"]')
    .evaluateAll((bs) => bs.map((b) => b.dataset.answer));
  const tiltRow = await page
    .locator('#modify-panel [data-field="tilt"]')
    .innerText()
    .catch(() => "");
  check(
    `1: a small dome's add offers « ${FR["modify.field.tilt"]} » (${theme})`,
    tiltRow.includes(FR["modify.field.tilt"]) && tilt.join("|") === "unknown|horizon|slight|steep",
    `${JSON.stringify(tiltRow)} — ${tilt.join(", ")}`,
  );
  await k.tap("#modify-aim-open");
  await view(page, "aim");
  await page.waitForTimeout(1200);
  const aimOpen = { field: await fieldCount(page), possible: await possibleCount(page) };
  check(
    `3: the aim before a target (${theme}), the possible field still`,
    aimOpen.field === 0 && aimOpen.possible > 0,
    JSON.stringify(aimOpen),
  );
  // West: the field crosses Boulevard de la Mission Marchand and its name.
  await aimAt(k, page, offsetLngLat(FREE, -14, 0));
  await page.waitForSelector("#aim-submit:not([disabled])", { timeout: 10000 });
  // The field is in the source once its GeoJSON tile is cut, which a fixed wait does not
  // always cover on a loaded machine.
  await page
    .waitForFunction(() => window.__map.querySourceFeatures("edit-field").length > 0, null, {
      timeout: 10000,
    })
    .catch(() => {});
  const aiming = { field: await fieldCount(page), possible: await possibleCount(page) };
  check(
    `3: aimed (${theme}), the field drawn, the possible field gone`,
    aiming.field > 0 && aiming.possible === 0,
    JSON.stringify(aiming),
  );
  await shot(page, `3c-aimed-${theme}`);
  await previewed(page, () => k.tap("#aim-submit"));
  await view(page, "sheet");
  const order = await layerOrder(page);
  order.fields = await fieldCount(page);
  check(
    `3: the field (${theme}) under the buildings, our streets and every basemap label`,
    under(order, order.edit),
    JSON.stringify(order),
  );
  check(
    `3: its fill lighter (fill-opacity < 1, ${theme})`,
    order.opacity < 1,
    String(order.opacity),
  );
  // The sheet covers the map on a phone: the capture of the streets under the field is the
  // aim's view there, the sheet beside the map on a wide screen.
  if (size.width < 600) {
    await k.tap("#modify-aim-open");
    await view(page, "aim");
    await page.waitForTimeout(1200);
    // The target (the map's centre) halfway: the same bearing, the camera in view.
    await previewed(page, () =>
      page.evaluate((c) => window.__map.jumpTo({ center: c, zoom: 19 }), offsetLngLat(FREE, -7, 0)),
    );
  }
  await shot(page, `3b-add-streets-${theme}`);
  check(`3: no page error (${theme})`, errors.length === 0, errors.join(" / "));
  await context.close();
}

// --- 4. the aim's minimum on the screen; every case without a field said -----------------
const FR = JSON.parse(
  (await import("node:fs")).readFileSync(
    new URL("../src/locales/fr.json", import.meta.url),
    "utf8",
  ),
);
/** (lon, lat) `dx` metres east and `dy` north of (lon, lat). */
const beside = ([lon, lat], dx, dy = 0) => [
  lon + dx / (111320 * Math.cos((lat * Math.PI) / 180)),
  lat + dy / 111320,
];
/** The aim as shown: the note under the target, its distance from the target, « Valider ». */
const aimState = (page) =>
  page.evaluate(() => {
    const warn = document.getElementById("edit-warn");
    const t = document.getElementById("edit-target").getBoundingClientRect();
    const w = warn.getBoundingClientRect();
    const m = window.__map;
    const pin = document.getElementById("edit-pin");
    const o = m.project([Number(pin.dataset.lng), Number(pin.dataset.lat)]);
    const c = m.project(m.getCenter());
    return {
      why: warn.hidden ? "" : warn.dataset.why,
      text: warn.hidden ? "" : warn.textContent,
      // From the target's centre to the note's top centre (px).
      near: warn.hidden
        ? null
        : Math.round(
            Math.hypot(
              w.left + w.width / 2 - (t.left + t.width / 2),
              w.top - (t.top + t.height / 2),
            ),
          ),
      ok: !document.getElementById("aim-submit").disabled,
      status: document.getElementById("modify-status")?.textContent ?? "",
      fields: m.querySourceFeatures("edit-field").length,
      zoom: Math.round(m.getZoom() * 10) / 10,
      bearing: document.getElementById("modify-panel").dataset.bearing,
      px: Math.round(
        Math.hypot(
          t.left + t.width / 2 - o.x - m.getContainer().getBoundingClientRect().left,
          t.top + t.height / 2 - o.y - m.getContainer().getBoundingClientRect().top,
        ),
      ),
      centre: Math.round(c.x),
    };
  });
const waitWhy = (page, why, ms = 10000) =>
  page
    .waitForFunction(
      (w) => {
        const e = document.getElementById("edit-warn");
        return w ? !e.hidden && e.dataset.why === w : e.hidden;
      },
      why,
      { timeout: ms },
    )
    .then(() => true)
    .catch(() => false);

async function pointFour(size) {
  const { page, errors, k, context } = await open(size);
  // Who films' list refused by the server (an API before the contract): said so, not
  // « hors ligne ».
  await page.route(/\/api\/operators$/, (route) =>
    route.fulfill({ status: 422, json: { error: "class" } }),
  );
  await startAdd(k, page);
  await k.tap("#modify-here");
  await view(page, "sheet");
  await previewed(page, () => k.tap('#modify-panel .modify-tile[data-answer="dome"]'));
  const refused = await page
    .locator('#modify-panel [data-row="operator"] .modify-note')
    .allTextContents();
  check(
    "6: who films' list refused by the server: said unavailable, not offline",
    refused.includes(FR["modify.operator.search.error"]),
    refused.join(" / "),
  );
  await k.tap("#modify-aim-open");
  await view(page, "aim");
  await page.waitForTimeout(1200);
  // The author's capture: z21.
  await page.evaluate(() => window.__map.jumpTo({ zoom: 21 }));
  await page.waitForTimeout(1200);
  const origin = await page.evaluate(() => {
    const pin = document.getElementById("edit-pin");
    return [Number(pin.dataset.lng), Number(pin.dataset.lat)];
  });
  // 0.4 m: about 16 px at z21, under min_target_px.
  await k.tapAt(beside(origin, 0.4));
  const closeSaid = await waitWhy(page, "closer");
  const close = await aimState(page);
  check(
    "4: a target 0.4 m away at z21 (under min_target_px): « Visez plus loin » under the target, « Valider » off",
    closeSaid && !close.ok && close.text === FR["modify.aim.closer"] && close.near < 60,
    JSON.stringify(close),
  );
  await shot(page, "4b-closer");
  // 2 m: about 80 px at z21; the old rule (min_target_m, 5 m) refused it.
  await previewed(page, () => k.tapAt(beside(origin, 2)));
  await page
    .waitForFunction(() => window.__map.querySourceFeatures("edit-field").length > 0, null, {
      timeout: 10000,
    })
    .catch(() => {});
  const far = await aimState(page);
  check(
    "4: a target 2 m away at z21 (5 m refused it): « Valider » on, the field drawn, nothing to say",
    far.ok && far.fields > 0 && far.why === "" && Math.abs(Number(far.bearing) - 90) <= 3,
    JSON.stringify(far),
  );
  await shot(page, "4a-z21-2m");
  // Each case without a field, the preview answered by the page: its own words under the
  // target, « Valider » still on (only the bearing counts).
  let mode = null;
  const asked = {};
  await page.route(/\/api\/modify\/preview/, async (route) => {
    asked[mode] = (asked[mode] ?? 0) + 1;
    const json = (status, error) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify({ error }) });
    if (mode === "outside") return json(422, "outside_region");
    if (mode === "error") return json(500, "internal");
    if (mode === "busy") return json(429, "rate");
    if (mode === "offline") return route.abort("internetdisconnected");
    if (mode === "slow") await new Promise((r) => setTimeout(r, 4500));
    if (mode === "blocked" || mode === "inside") {
      const r = await route.fetch();
      const body = await r.json();
      body.bands.features = [];
      body.inside_footprint = mode === "inside";
      return route.fulfill({ response: r, json: body });
    }
    return route.fallback();
  });
  let step = 0;
  for (const why of ["outside", "error", "busy", "offline", "blocked", "inside", "slow"]) {
    mode = why;
    // A new target each time (a new preview), 2 to 3 m away.
    await k.tapAt(beside(origin, 2 + (++step % 2) * 0.6, step % 2 ? 0.3 : -0.3));
    const said = await waitWhy(page, why);
    const got = await aimState(page);
    check(
      `4: no field — ${why}: said under the target and in the paper, « Valider » still on`,
      said &&
        got.text === FR[`modify.field.${why}`] &&
        got.status.includes(FR[`modify.field.${why}`]) &&
        got.near < 60 &&
        got.ok,
      JSON.stringify(got),
    );
    if (why === "outside") await shot(page, "4c-outside");
    if (why === "slow") {
      const gone = await waitWhy(page, "", 10000);
      await page
        .waitForFunction(() => window.__map.querySourceFeatures("edit-field").length > 0, null, {
          timeout: 5000,
        })
        .catch(() => {});
      const after = await aimState(page);
      check(
        "4: slow — once the answer comes, the field drawn and nothing said",
        gone && after.fields > 0,
        JSON.stringify({ ...after, asked }),
      );
    }
  }
  mode = null;
  check("4: no page error", errors.length === 0, errors.join(" / "));
  await context.close();
}

// --- 5. the height in metres -------------------------------------------------------------
async function pointFive(size) {
  const { page, errors, k, context } = await open(size);
  await startAdd(k, page);
  await k.tap("#modify-here");
  await view(page, "sheet");
  const chips = () =>
    page
      .locator('#modify-panel .modify-chip[data-part="height"]')
      .evaluateAll((bs) =>
        bs.map((b) => `${b.dataset.answer}:${b.textContent}:${b.getAttribute("aria-pressed")}`),
      );
  const before = await chips();
  const want = [
    `unknown:${FR["part.complete.unknown"]}:true`,
    "ground:~2 m:false",
    "first:~4 m:false",
    "upper:6 m et +:false",
  ];
  check(
    "5: the height's choices — « Je ne sais pas » checked, ~2 m, ~4 m, 6 m et +, no « Poteau »",
    before.join("|") === want.join("|"),
    before.join(" | "),
  );
  await k.tap('#modify-panel .modify-chip[data-part="height"][data-answer="first"]');
  await page.waitForTimeout(400);
  const value = await page
    .locator('#modify-panel [data-field="mount"] .modify-value')
    .evaluate((e) => e.textContent);
  const after = await chips();
  check(
    "5: « ~4 m » chosen: pressed, the line says it",
    value === "~4 m" && after.includes("first:~4 m:true"),
    `${value} — ${after.join(" | ")}`,
  );
  await page
    .locator('#modify-panel [data-row="mount"]')
    .evaluate((e) => e.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(400);
  await shot(page, "5-heights");
  check("5: no page error", errors.length === 0, errors.join(" / "));
  await context.close();
}

// --- 6. who films: the whole list, a search, a name not listed ----------------------------
// POST /api/operators without `class` as the contract answers it (rules/operators.yaml's
// names; RATP among them), with `class` the API of this branch.
const NEAR = [{ name: "Ville de Courbevoie", class: "public" }];
const ALL = [
  { name: "Carrefour", class: "business" },
  { name: "Pôle universitaire Léonard de Vinci", class: "public" },
  { name: "RATP", class: "public" },
  { name: "SNCF", class: "public" },
  { name: "Ville de Courbevoie", class: "public" },
];
const PROPOSED = "Boulangerie du Coin";

async function pointSix(size) {
  const { page, errors, k, context } = await open(size);
  await page.route(/\/api\/operators$/, (route) =>
    route.request().postDataJSON().class
      ? route.fallback()
      : route.fulfill({ json: { near: NEAR, all: ALL } }),
  );
  // A proposed name: accepted as the contract's API would (this branch's refuses the field);
  // every other piece goes to the real API.
  const sent = [];
  await page.route(/\/api\/contributions$/, (route) => {
    const body = route.request().postDataJSON();
    sent.push(body);
    return body.operator_proposed
      ? route.fulfill({ json: { uuid: body.uuid, status: "pending", new: true } })
      : route.fallback();
  });
  await startAdd(k, page);
  await k.tap("#modify-here");
  await view(page, "sheet");
  const names = () =>
    page
      .locator("#modify-panel [data-operator]")
      .evaluateAll((bs) => bs.map((b) => b.dataset.operator));
  await page.waitForSelector("#modify-panel [data-operator]", { timeout: 10000 }).catch(() => {});
  const around = await names();
  const search = page.locator("#modify-operator-search");
  await search.scrollIntoViewIfNeeded();
  await search.fill("ratp");
  const found = await names();
  check(
    "6: the names around first; « ratp » finds RATP among every listed name",
    around.join("|") === "Ville de Courbevoie" && found.join("|") === "RATP",
    `${around.join(", ")} — ${found.join(", ")}`,
  );
  await page
    .locator("#modify-panel .modify-names")
    .evaluate((e) => e.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(300);
  await shot(page, "6a-ratp-search");
  await k.tap('#modify-panel [data-operator="RATP"]');
  await page.waitForTimeout(300);
  const operatorState = () =>
    page.evaluate(() => ({
      cls: document.querySelector(
        '#modify-panel .modify-chip[data-part="operator"][aria-pressed="true"]',
      )?.dataset.answer,
      value: document.querySelector('#modify-panel [data-field="operator"] .modify-value')
        ?.textContent,
      name: document.querySelector('#modify-panel [data-operator][aria-pressed="true"]')?.dataset
        .operator,
      search: Boolean(document.getElementById("modify-operator-search")),
      propose: document.getElementById("modify-propose")
        ? { disabled: document.getElementById("modify-propose").disabled }
        : null,
      notes: [...document.querySelectorAll("#modify-panel .modify-operator .modify-note")].map(
        (n) => n.textContent,
      ),
    }));
  const ratp = await operatorState();
  check(
    "6: choosing RATP sets « Public »",
    ratp.cls === "public" && ratp.value === "RATP" && ratp.name === "RATP",
    JSON.stringify(ratp),
  );
  // « Particulier »: no search, no name at all.
  await k.tap('#modify-panel .modify-chip[data-part="operator"][data-answer="household"]');
  await page.waitForTimeout(300);
  const household = await operatorState();
  check(
    "6: after « Particulier » no search and no name to propose",
    household.cls === "household" && !household.search && !household.propose && !household.name,
    JSON.stringify(household),
  );
  // « Je ne sais pas »: a name not listed waits for a class.
  await k.tap('#modify-panel .modify-chip[data-part="operator"][data-answer="unknown"]');
  await page.locator("#modify-operator-search").fill(PROPOSED);
  const noClass = await operatorState();
  check(
    "6: a name not listed after « Je ne sais pas »: no « Proposer », the class asked first",
    !noClass.propose && noClass.notes.includes(FR["modify.operator.propose.class"]),
    JSON.stringify(noClass),
  );
  await k.tap('#modify-panel .modify-chip[data-part="operator"][data-answer="public"]');
  await page.waitForTimeout(300);
  for (const [bad, why] of [
    ["x".repeat(61), "length"],
    ["<b>Coin</b>", "chars"],
    ["-Coin", "chars"],
  ]) {
    await page.locator("#modify-operator-search").fill(bad);
    const got = await operatorState();
    check(
      `6: a proposed name refused here (${why}): « Proposer » off, why said`,
      got.propose?.disabled === true && got.notes.includes(FR[`modify.operator.invalid.${why}`]),
      JSON.stringify(got),
    );
  }
  await page.locator("#modify-operator-search").fill(` ${PROPOSED}  `);
  await k.tap("#modify-propose");
  await page.waitForTimeout(300);
  const proposed = await operatorState();
  check(
    "6: after « Public » a name not listed proposed, said reviewed before it shows",
    proposed.cls === "public" &&
      proposed.value === FR["modify.operator.proposed"].replace("{name}", PROPOSED) &&
      proposed.notes.includes(FR["modify.operator.propose.review"]),
    JSON.stringify(proposed),
  );
  await page.locator("#modify-propose").evaluate((e) => e.scrollIntoView({ block: "center" }));
  await shot(page, "6b-proposed");
  await k.tap("#modify-send");
  await page.waitForSelector('#modify-panel[data-view="sent"]', { state: "attached" });
  await page
    .waitForFunction(() => document.querySelectorAll("#score .score-ticket").length > 0, null, {
      timeout: 10000,
    })
    .catch(() => {});
  await page.waitForTimeout(1500);
  const piece = sent.find((b) => b.kind === "operator");
  const tickets = await page
    .locator("#score")
    .innerText()
    .catch(() => "");
  check(
    "6: sent as operator_proposed (tidied), no operator_name; the ticket does not show it",
    piece?.operator_proposed === PROPOSED &&
      piece.operator_name === undefined &&
      piece.answer === "public" &&
      !tickets.includes(PROPOSED),
    JSON.stringify({ piece, tickets }),
  );
  await page.keyboard.press("Escape");
  // « Vos contributions »: the API says a name is under review, never which.
  await page.route(/\/api\/me\/contributions$/, (route) =>
    route.fulfill({
      json: {
        author: "ana",
        contributions: [
          {
            uuid: piece?.uuid ?? "00000000-0000-4000-8000-000000000000",
            kind: "operator",
            camera: piece?.camera ?? "c000000000000",
            day: "2026-10-12",
            status: "pending",
            answer: "public",
            move_m: null,
            apply_build: null,
            direction: null,
            operator_name: null,
            operator_proposed: true,
          },
        ],
      },
    }),
  );
  await k.open(`?cam=${DOME.id}#18/${DOME.at[0]}/${DOME.at[1]}`, { sheet: true });
  await k.tap(page.locator("#sheet button", { hasText: "Vos contributions" }));
  await page.waitForSelector("#mine .mine-list li", { timeout: 10000 }).catch(() => {});
  const mine = await page
    .locator("#mine")
    .innerText()
    .catch(() => "");
  check(
    "6: « Vos contributions » says a name is under review, never the name",
    mine.includes(FR["modify.operator.under_review"]) && !mine.includes(PROPOSED),
    mine
      .split("\n")
      .filter((l) => l.includes("xploitant") || l.includes("relecture"))
      .join(" / "),
  );
  check("6: no page error", errors.length === 0, errors.join(" / "));
  await context.close();
}

const taken = await takenPorts();
if (taken.length) {
  console.log(`FAIL ports taken: ${taken.join(", ")}`);
  process.exit(2);
}
try {
  await startServers();
  for (const [engine, size, name] of [
    [webkit, PHONE, "phone"],
    [chromium, WIDE, "wide"],
  ]) {
    if (only && only !== name) continue;
    where = name;
    browser = await engine.launch();
    resetContributions();
    await pointThree(size);
    await pointThree(size, true);
    await pointFour(size);
    await pointFive(size);
    await pointSix(size);
    await browser.close();
    browser = null;
  }
} catch (e) {
  check("the run", false, String(e?.stack ?? e));
} finally {
  await browser?.close();
  await stopServers();
  closeProxy();
}
const failed = checks.filter((c) => !c.ok);
console.log(`${checks.length - failed.length} ok, ${failed.length} FAIL`);
process.exit(failed.length ? 1 : 0);
