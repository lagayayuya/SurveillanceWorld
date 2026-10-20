// /revue and an operator name a contributor proposed (lot of 2026-10-12, point 6; the
// camera view of lot 1 « Modérer »): the view shows the name, « Valider » says it waits for
// the reviewer's choice (as typed, a listed name searched, or no name) until it is made,
// and the choice reaches the API. On the states' servers
// (states/harness.mjs: the throwaway API on the CI build, real contributions), as rev: a
// phone (390 × 845, WebKit) and a wide screen (960 × 581, Chromium), scale 2, light.
// Captures for the report:
//   node bench/shots-revue-operator.mjs [--out DIR]   (default: <repository>/build/shots/
//   revue-operator, never committed)
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, webkit } from "playwright";
import { COOKIE } from "./session.mjs";
import {
  APP,
  api,
  BUILD,
  closeProxy,
  login,
  ROOT,
  resetContributions,
  startServers,
  stopServers,
  takenPorts,
} from "./states/harness.mjs";

const args = process.argv.slice(2);
const arg = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const OUT = resolve(arg("--out", resolve(ROOT, "build/shots/revue-operator")));
mkdirSync(OUT, { recursive: true });
const PHONE = { width: 390, height: 845 };
const WIDE = { width: 960, height: 581 };
// A tube of the CI build without an operator (the fixture's k1).
const CAMERA = "n5442645359";
const NAME = "Boulangerie Dupont";
const SENT = "Pressing du Parvis";

const taken = await takenPorts();
if (taken.length) {
  console.log(`FAIL ports taken: ${taken.join(", ")}`);
  process.exit(2);
}
let browsers;
let failed = 0;
const done = (name, ok, why = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${why ? ` — ${why}` : ""}`);
};
const today = new Date().toISOString().slice(0, 10);
const uuid = () => crypto.randomUUID();
const answer = (who, kind, fields) =>
  api(who, "POST", "/api/contributions", {
    kind,
    uuid: uuid(),
    camera: CAMERA,
    build_id: BUILD,
    day: today,
    on_site: true,
    ...fields,
  });

/** One contribution on its own (ana) and one piece of a « Modifier » send (bob). */
async function seed() {
  resetContributions();
  const alone = await answer("ana", "operator", { answer: "business", operator_proposed: NAME });
  const batch = uuid();
  await answer("bob", "shape", { answer: "dome", batch });
  const piece = await answer("bob", "operator", {
    answer: "business",
    operator_proposed: SENT,
    batch,
  });
  return { alone: alone.uuid, batch, piece: piece.uuid };
}

async function open(engine, size) {
  const context = await browsers[engine].newContext({
    viewport: size,
    deviceScaleFactor: 2,
    isMobile: engine === "webkit",
    hasTouch: engine === "webkit",
    colorScheme: "light",
    locale: "fr-FR",
    timezoneId: "Europe/Paris",
  });
  await context.addCookies([
    { name: COOKIE, value: await login("rev"), url: APP, httpOnly: true, sameSite: "Strict" },
  ]);
  const page = await context.newPage();
  await page.goto(`${APP}revue?camera=${CAMERA}`);
  await page.waitForSelector("#review-camera .review-choice", { timeout: 20000 });
  return { context, page };
}

const windowOf = () => api("rev", "GET", `/api/review/camera?camera=${CAMERA}`);
const rowOf = async (uuid) => (await windowOf()).contributions.find((c) => c.uuid === uuid);
/** The send the view decides (its table's rows): ana's answer or bob's send, the older
 * first (the same day: by uuid). */
async function current(page, ids) {
  const uuids = await page
    .locator(".review-diff tbody tr")
    .evaluateAll((trs) => trs.map((tr) => tr.dataset.uuid));
  return uuids.includes(ids.alone)
    ? { operator: ids.alone, name: NAME }
    : { operator: ids.piece, name: SENT };
}

try {
  await startServers();
  browsers = { webkit: await webkit.launch(), chromium: await chromium.launch() };

  // --- a phone: the name shown, « Valider » says what it waits for, a listed name chosen --
  let ids = await seed();
  {
    const { context, page } = await open("webkit", PHONE);
    try {
      const first = await current(page, ids);
      const box = page.locator("#review-choice");
      await box.scrollIntoViewIfNeeded();
      const legend = await box.locator("legend").textContent();
      done("phone: the proposed name in the camera's view", legend.includes(first.name), legend);
      const none = await box.locator('label:has(input[value="none"])').textContent();
      done(
        "phone: « aucun nom » keeps the class alone, without the name's review note",
        !none.includes("relecture") && !none.includes(first.name),
        none,
      );
      await page.screenshot({ path: join(OUT, "revue-operator-phone.png") });
      // « Valider » before a choice: said, the choice focused, nothing sent.
      await page.locator('[data-action="validated"]').tap();
      const said = await page.locator(".review-foot .review-error").textContent();
      const focused = await page.evaluate(() => document.activeElement?.id);
      done(
        "phone: « Valider » without a choice says so and focuses the choice; nothing decided",
        said.includes("Choisissez d'abord") &&
          focused === "review-choice" &&
          (await rowOf(first.operator)).status === "pending",
        `${said} | ${focused}`,
      );
      await box.locator('input[value="listed"]').check();
      await box.locator('input[type="search"]').fill("fran");
      await box.locator(".review-matches button", { hasText: "Franprix" }).tap();
      await page.screenshot({ path: join(OUT, "revue-operator-phone-listed.png") });
      await page.locator('[data-action="validated"]').tap();
      await page.waitForSelector(".review-toast");
      const row = await rowOf(first.operator);
      done(
        "phone: validated in one tap with Franprix in place of the name",
        row.status === "validated" &&
          row.operator_choice === "listed" &&
          row.operator_name === "Franprix",
        JSON.stringify([row.status, row.operator_choice, row.operator_name]),
      );
      // The other one waits: the view stays on the camera, its own name to choose.
      await page.waitForFunction(
        (name) => document.querySelector("#review-choice legend")?.textContent?.includes(name),
        first.name === NAME ? SENT : NAME,
        { timeout: 10000 },
      );
      done("phone: the camera's other send next, with its own name to choose", true);
      await page.screenshot({ path: join(OUT, "revue-operator-phone-done.png") });
    } catch (e) {
      done("phone", false, String(e).split("\n")[0]);
    }
    await context.close();
  }

  // --- a wide screen: a name accepted as typed, the other send rejected ------------------
  ids = await seed();
  {
    const { context, page } = await open("chromium", WIDE);
    try {
      const first = await current(page, ids);
      await page.locator('#review-choice input[value="proposed"]').check();
      await page.screenshot({ path: join(OUT, "revue-operator-wide-send.png") });
      await page.locator('[data-action="validated"]').click();
      await page.waitForSelector(".review-toast");
      const row = await rowOf(first.operator);
      const sendRows = (await windowOf()).contributions.filter((c) => c.batch === ids.batch);
      done(
        "wide: the name accepted as typed (a send validated whole)",
        row.status === "validated" &&
          row.operator_choice === "proposed" &&
          row.operator_name === first.name &&
          (first.operator !== ids.piece || sendRows.every((c) => c.status === "validated")),
        JSON.stringify([row.status, row.operator_choice, row.operator_name]),
      );
      const other = first.operator === ids.alone ? ids.piece : ids.alone;
      await page.waitForSelector("#review-choice");
      await page.locator('[data-action="rejected"]').click();
      await page.waitForFunction(() => !document.querySelector("#review-choice"), null, {
        timeout: 10000,
      });
      const rejected = await rowOf(other);
      await page.goto(`${APP}revue?camera=${CAMERA}`);
      await page.waitForSelector("#review-details[open] li.review-decided");
      const notes = await page.locator("#review-details").innerText();
      done(
        "wide: a rejection refuses the name, said under « Détails »",
        rejected.status === "rejected" && notes.includes("refusé avec la contribution"),
        `${rejected.status} | ${notes.replace(/\n/g, " ").slice(0, 200)}`,
      );
      await page.screenshot({ path: join(OUT, "revue-operator-wide-done.png") });
    } catch (e) {
      done("wide", false, String(e).split("\n")[0]);
    }
    await context.close();
  }
} finally {
  await browsers?.webkit.close();
  await browsers?.chromium.close();
  await stopServers();
  closeProxy();
}
console.log(`${failed ? "FAIL" : "ok"}: captures in ${OUT}`);
process.exit(failed ? 1 : 0);
