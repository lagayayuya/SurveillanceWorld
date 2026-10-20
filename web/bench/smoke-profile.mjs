// Smoke test of the punk account screen (board 26a, and only it: the profile of 25b is not
// shipped, one's contributions stay in each camera's « Vos contributions »), src/profile and
// theme/punk/profile.css, on the production build of the CI extract with the account routes
// answered by the page (bench/profile-mock.mjs: no server), in light and dark, on a phone
// and a wide screen. Signed in, the account square of the header ticket (--open, by default
// the button named « Votre profil ») opens the leaderboard in place of the camera sheet: the
// podium rises to its scores' height (its transition, the content there at once) and rises
// again on a change of filter; under reduced motion it is at its height from the first
// frame; the list says ranks, pseudonyms and points only (never a day nor a place); the
// opt-in switch calls PUT /api/me/leaderboard both ways; the scale is the API's (a scale
// changed in the answer is the one shown); « Changer le mot de passe » checks its fields,
// says a wrong current password, and calls POST /api/me/password; « Supprimer mon compte »
// asks the password before any request, a wrong one is said and keeps the account, the
// right one closes the sheet; « Se déconnecter » calls DELETE /api/session; « Télécharger
// mes données » saves GET /api/me/export's file under its name, a session gone said and
// nothing saved (the launch lot). With axe-core
// (the dev dependency, or --axe PATH / LACARTE_AXE): no violation of WCAG 2.2 A/AA in the
// sheet. OSM lot 1, sign-in on: « Relier à OpenStreetMap » starts GET /api/osm/link with
// the page as `then` (answered by the page), « Délier » calls POST /api/osm/unlink, an
// account without a password has neither « Délier » nor « Changer le mot de passe ». The OSM
// synchronisation (16/10), « Publier sur OpenStreetMap »: absent when not offered; off, two
// radios (« Rester sur Surveillance World » checked) and what publishing means, the test
// server's notice; « Publier aussi… » asks the password again (an account with one; « Annuler »
// sends nothing) and POST /api/osm/sync {on: true} opens OSM's page (a local stand-in, never
// openstreetmap.org); 403 closed said; on, « Activé depuis octobre 2026 » and the history
// (each state's sentence, the changeset's link on the write server); « Rester » asks first,
// then POST {on: false}, what went stays listed; stopping offline said; the states
// (suspended, revoked, blocked with « Autoriser à nouveau », OSM down or limiting, the live
// server); `?osm=write_on`
// is said. Lot U2: the camera sheet opened from « Mes caméras » and its « ← Mes caméras »
// button, one sheet head across the account's, a camera's, a commune's and a département's,
// and a camera's history two lines an entry (punk and classique, 320 and 390 px and a wide
// screen). With --out, captures. Exits non-zero if a check failed.
//   node bench/smoke-profile.mjs [--browser chromium|webkit] [--axe PATH] [--out DIR]
//                                [--port N] [--open CSS]
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { chromium, devices, webkit } from "playwright";
import { preview, requireTiles, WEB } from "./dist.mjs";
import {
  AT,
  CAMERA_HISTORY,
  CAMS,
  COLLECTION,
  DOME_CAM,
  EXPORT_FILE,
  HISTORY,
  ME,
  mockProfile,
  PASSWORD,
  REFUSED_ADD,
  SCALE,
  SYNC,
  SYNC_ON,
  WRITE_URL,
} from "./profile-mock.mjs";
import { returning } from "./ui.mjs";

const args = process.argv.slice(2);
const arg = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
requireTiles("ci");
const engine = arg("--browser", "chromium");
const AXE = arg(
  "--axe",
  process.env.LACARTE_AXE ?? createRequire(import.meta.url).resolve("axe-core/axe.min.js"),
);
const OUT = arg("--out", null) && resolve(arg("--out"));
const PORT = Number(arg("--port", "4196"));
const OPEN = arg("--open", null);
const APP = `http://localhost:${PORT}/`;
if (OUT) mkdirSync(OUT, { recursive: true });

const checks = [];
function check(name, ok, detail = "") {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "ok  " : "FAIL"} [${engine}] ${name}${detail ? ` — ${detail}` : ""}`);
}

/** The account square: --open's selector, else the button named « Votre profil ». */
const square = (page) =>
  OPEN ? page.locator(OPEN).first() : page.getByRole("button", { name: "Votre profil" }).first();

const shot = async (page, name) => {
  if (OUT) await page.screenshot({ path: join(OUT, `${name}.png`) });
};

/** The page signed in on the cluster, a send waiting on the phone, a visit in September. */
async function signedIn(context, mode, opts = {}) {
  const api = await mockProfile(context, opts);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const ready = () =>
    page.waitForFunction(() => window.__map?.loaded() && window.__map.areTilesLoaded(), null, {
      timeout: 30_000,
    });
  await page.goto(`${APP}?ui=punk&mode=${mode}${AT}`);
  await ready();
  await page.waitForTimeout(800);
  return { page, api, errors };
}

/** The account square: the leaderboard, drawn once the API has answered. */
async function openAccount(page) {
  await square(page).click();
  await page.waitForSelector("#sheet .board-paper .board-place", { timeout: 10_000 });
}

async function axe(page, where) {
  if (!AXE) return;
  if (!(await page.evaluate(() => Boolean(window.axe)))) await page.addScriptTag({ path: AXE });
  const found = await page.evaluate(async () => {
    const nodes = (r) => r.flatMap((v) => v.nodes.map((n) => `${v.id} ${n.target.join(" ")}`));
    // axe leaves out what is not on the screen: the paper in view in turn, top to bottom.
    const sheet = document.querySelector("#sheet");
    const scroller = sheet.querySelector(".sheet-paper");
    const out = new Set();
    let passes = 0;
    const steps = Math.ceil(scroller.scrollHeight / scroller.clientHeight) + 1;
    for (let i = 0; i < steps; i++) {
      scroller.scrollTop = i * scroller.clientHeight;
      await new Promise((r) => setTimeout(r, 80));
      const r = await window.axe.run(sheet, {
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
      });
      for (const n of nodes(r.violations)) out.add(n);
      passes += r.passes.flatMap((v) => v.nodes).length;
    }
    scroller.scrollTop = 0;
    return { violations: [...out], passes };
  });
  check(
    `${where}: axe WCAG 2.2 A/AA none in the sheet (${found.passes} passes)`,
    found.violations.length === 0,
    found.violations.join(" | "),
  );
}

/** The podium's steps: height now, height wanted (44 + 96 × points / first's), transition. */
const steps = (page) =>
  page.evaluate(() => {
    const places = [...document.querySelectorAll("#sheet .board-place")];
    const pts = (li) => Number(li.querySelector(".board-pts").textContent.replace(/\D/g, ""));
    const max = Math.max(1, ...places.map(pts));
    return places.map((li) => {
      const step = li.querySelector(".board-step");
      return {
        now: step.offsetHeight,
        want: 44 + Math.round((96 * pts(li)) / max),
        duration: getComputedStyle(step).transitionDuration,
      };
    });
  });

/** Every frame for 3 s, the lowest a step of the podium stood against its height (1: at
 * its height all along; a step that rises from the floor goes near 0). Started before the
 * tap that shows it: on a slow runner the podium had risen 85 % by the first frame a
 * watch started after the tap saw (CI run 38010355680). */
const watchPodium = (page) =>
  page.evaluate(() => {
    window.__lowest = 1;
    const t0 = performance.now();
    const frame = () => {
      for (const li of document.querySelectorAll("#sheet .board-place")) {
        const step = li.querySelector(".board-step");
        const want = Number.parseFloat(step.style.height);
        if (want > 0) window.__lowest = Math.min(window.__lowest, step.offsetHeight / want);
      }
      if (performance.now() - t0 < 3000) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
const lowest = (page) => page.evaluate(() => window.__lowest);

async function boardChecks(page, api, where, reduced, phone = false) {
  // From before the tap, every frame: the steps rising (or at their height under reduced
  // motion).
  await watchPodium(page);
  await openAccount(page);
  if (phone) await page.locator("#sheet .sheet-grab").click();
  await page.waitForTimeout(3100);
  const low = await lowest(page);
  const settled = await steps(page);
  const atHeight = (list) =>
    list.length === 3 && list.every((s) => Math.abs(s.now - s.want) <= 1.5);
  if (reduced)
    check(
      `${where}: reduced motion, the podium at its scores' height from its first frame, no transition`,
      low > 0.99 && atHeight(settled) && settled.every((s) => s.duration === "0s"),
      JSON.stringify({ low, settled }),
    );
  else
    check(
      `${where}: the podium rises from the floor to its scores' height (550 ms, the names there at once)`,
      low < 0.5 && atHeight(settled) && settled.every((s) => s.duration === "0.55s"),
      JSON.stringify({ low, settled }),
    );
  const board = await page.evaluate(() => ({
    tickets: document.querySelectorAll("#sheet .profile-tickets").length,
    pod: [...document.querySelectorAll("#sheet .board-place")].map((li) =>
      li.innerText.replace(/\s+/g, " "),
    ),
    rows: [...document.querySelectorAll("#sheet .board-row")].map((li) =>
      li.innerText.replace(/\s+/g, " ").trim(),
    ),
    you: document.querySelector("#sheet .board-you")?.innerText.replace(/\s+/g, " "),
    pressed: [...document.querySelectorAll("#sheet [aria-pressed=true]")].map((b) => b.textContent),
  }));
  check(
    `${where}: the account's screen is the leaderboard alone (no profile tickets)`,
    board.tickets === 0,
    String(board.tickets),
  );
  const ROW = /^\d+(er|e) [\w.-]+ [\d\s ]+ pts?$/;
  const DAY = /\b\d{1,2}[/.]\d{1,2}\b|\d{4}-\d{2}-\d{2}|\b(rue|avenue|av\.|place|boulevard|bd)\b/i;
  check(
    `${where}: the list says rank, pseudonym, points only (never a day or a place)`,
    board.rows.length === 7 &&
      board.rows.every((r) => ROW.test(r)) &&
      ![...board.rows, ...board.pod].some((r) => DAY.test(r)),
    JSON.stringify(board.rows),
  );
  check(
    `${where}: « Vous · 4e », its four sorts and « +90 pts en attente de revue »`,
    /VOUS · 4E/i.test(board.you ?? "") &&
      /3 caméras ajoutées \+150/.test(board.you ?? "") &&
      /\+90 pts en attente de revue/.test(board.you ?? ""),
    board.you,
  );
  await shot(page, `${where.replaceAll(" ", "-")}-board`);
  await axe(page, `${where} leaderboard`);

  // A change of filter: the sort's leaderboard, the podium rising again.
  await watchPodium(page);
  await page.locator("#sheet .board-count", { hasText: "Ajouts" }).click();
  await page.waitForTimeout(1600);
  const again = await lowest(page);
  const asked = api.calls.some((c) => c.path === "/api/leaderboard" && /kind=add/.test(c.query));
  check(
    `${where}: « Ajouts » asks its leaderboard${reduced ? ", the podium still" : ", the podium rises again"}`,
    asked && (reduced ? again > 0.99 : again < 0.5) && atHeight(await steps(page)),
    String(again),
  );

  // The opt-in switch, both ways.
  const sw = page.locator("#sheet .board-switch");
  const was = await sw.getAttribute("aria-checked");
  await sw.click();
  await page.waitForTimeout(400);
  const off = await sw.getAttribute("aria-checked");
  await sw.click();
  await page.waitForTimeout(400);
  const puts = api.calls.filter((c) => c.method === "PUT" && c.path === "/api/me/leaderboard");
  check(
    `${where}: « Apparaître dans le classement des autres » calls PUT {on:false} then {on:true}`,
    was === "true" &&
      off === "false" &&
      (await sw.getAttribute("aria-checked")) === "true" &&
      JSON.stringify(puts.map((p) => p.body)) === JSON.stringify([{ on: false }, { on: true }]),
    JSON.stringify(puts.map((p) => p.body)),
  );

  // The scale, the API's.
  const toggle = page.locator("#sheet .board-scale-toggle");
  await toggle.click();
  await page.waitForTimeout(200);
  const scale = await page.evaluate(() => ({
    expanded: document.querySelector("#sheet .board-scale-toggle").getAttribute("aria-expanded"),
    values: [...document.querySelectorAll("#sheet .board-scale-v")].map((e) => e.textContent),
    example: document.querySelector("#sheet .board-scale-example")?.textContent,
  }));
  const s = api.scale ?? SCALE;
  const total = s.add + 4 * s.info + s.complete_bonus;
  check(
    `${where}: « Comment on compte ? » unfolds the API's scale`,
    scale.expanded === "true" &&
      JSON.stringify(scale.values) ===
        JSON.stringify(
          [s.add, s.info, s.complete_bonus, s.correction, s.verification].map((v) => `+${v}`),
        ) &&
      (scale.example ?? "").includes(`${total} pts`),
    JSON.stringify(scale),
  );
  await axe(page, `${where} scale`);

  // « Changer le mot de passe »: both fields; a wrong current one said; then changed.
  await page.locator("#sheet .board-password").click();
  const pw = page.locator("#sheet .board-password-form input[type=password]");
  await page.locator("#sheet .board-password-submit").click();
  const empty = await page.locator("#sheet .board-form-error").textContent();
  await pw.nth(0).fill("wrong password");
  await pw.nth(1).fill("a brand new password");
  await page.locator("#sheet .board-password-submit").click();
  await page.waitForTimeout(400);
  const wrong = await page.locator("#sheet .board-form-error").textContent();
  await pw.nth(0).fill(PASSWORD);
  await pw.nth(1).fill("a brand new password");
  await page.locator("#sheet .board-password-submit").click();
  await page
    .locator("#sheet .board-password-done")
    .waitFor({ timeout: 5000 })
    .catch(() => {});
  const posts = api.calls.filter((c) => c.path === "/api/me/password");
  const done = await page.locator("#sheet .board-password-done").textContent();
  check(
    `${where}: « Changer le mot de passe »: both asked, a wrong current one said, then changed`,
    /ancien et le nouveau/.test(empty ?? "") &&
      /incorrect/.test(wrong ?? "") &&
      posts.length === 2 &&
      posts[1].body?.current === PASSWORD &&
      posts[1].body?.new === "a brand new password" &&
      /changé/.test(done ?? ""),
    JSON.stringify({ empty, wrong, posts: posts.length, done }),
  );

  // « Supprimer mon compte »: the password first; a wrong one keeps the account.
  await page.locator("#sheet .board-delete").click();
  const field = page.locator("#sheet .board-delete-form input[type=password]");
  const shown = await field.isVisible();
  const early = api.calls.filter((c) => c.path === "/api/me/delete").length;
  await field.fill("wrong password");
  await page.locator("#sheet .board-delete-confirm").click();
  await page.waitForTimeout(400);
  const said = await page.locator("#sheet .board-delete-error").textContent();
  const open = await page.evaluate(() => !document.getElementById("sheet").hidden);
  await field.fill(PASSWORD);
  await page.locator("#sheet .board-delete-confirm").click();
  await page.waitForTimeout(500);
  const deletes = api.calls.filter((c) => c.path === "/api/me/delete");
  const closed = await page.evaluate(() => document.getElementById("sheet").hidden);
  check(
    `${where}: « Supprimer mon compte » asks the password; wrong, said; right, the sheet closes`,
    shown &&
      early === 0 &&
      /incorrect/.test(said ?? "") &&
      open &&
      deletes.length === 2 &&
      deletes[1].body?.password === PASSWORD &&
      closed,
    JSON.stringify({ shown, early, said, open, deletes: deletes.length, closed }),
  );
}

/** OSM lot 1 at the foot (sign-in on): not linked, « Relier à OpenStreetMap » asks the
 * password again, then POST /api/osm/link (`then` this page) answers OSM's page, opened (a
 * local stand-in, never openstreetmap.org);
 * linked with a password, « Délier » calls POST /api/osm/unlink and the link comes back;
 * an account without a password: neither « Délier » nor « Changer le mot de passe ». */
async function osmChecks(options) {
  const foot = (page) =>
    page.evaluate(() => ({
      link: Boolean(document.querySelector("#sheet .board-osm-link")),
      linked: document.querySelector("#sheet .board-osm-linked")?.textContent ?? null,
      unlink: Boolean(document.querySelector("#sheet .board-osm-unlink")),
      password: Boolean(document.querySelector("#sheet .board-password")),
      note: document.querySelector("#sheet .board-osm-note")?.textContent ?? "",
      focus: document.activeElement?.className ?? "",
    }));
  const open = async (account) => {
    const context = await browser.newContext(options);
    const s = await signedIn(context, "sombre", { account, osmLogin: true });
    await openAccount(s.page);
    await s.page.waitForSelector("#sheet .board-osm:not([hidden])", { timeout: 10_000 });
    return { context, ...s };
  };
  try {
    // Not linked: the link, then the flow's start with this page as `then`.
    {
      const s = await open({ osm: false, password: true });
      const before = await foot(s.page);
      await s.page.locator("#sheet .board-osm-link").click();
      const field = s.page.locator("#sheet .board-osm-link-form input[type=password]");
      await s.page.locator("#sheet .board-osm-link-submit").click();
      const empty = await s.page.locator("#board-osm-link-error").textContent();
      await field.fill("pas le bon");
      await s.page.locator("#sheet .board-osm-link-submit").click();
      await s.page.waitForTimeout(400);
      const wrong = await s.page.locator("#board-osm-link-error").textContent();
      await field.fill(PASSWORD);
      await s.page.locator("#sheet .board-osm-link-submit").click();
      await s.page.waitForURL(/\/fake-osm\/authorize/, { timeout: 10_000 }).catch(() => {});
      const posts = s.api.calls.filter((c) => c.method === "POST" && c.path === "/api/osm/link");
      const startedThen = posts.at(-1)?.body?.then ?? "";
      check(
        "OSM: not linked, « Relier à OpenStreetMap » asks the password again (empty, wrong said), then POST /api/osm/link (`then` this page) opens OSM's page",
        before.link &&
          before.linked === null &&
          before.password &&
          /mot de passe/i.test(empty ?? "") &&
          /incorrect/.test(wrong ?? "") &&
          posts.length === 2 &&
          posts[1].body?.password === PASSWORD &&
          startedThen.startsWith("/") &&
          startedThen.includes("#17.6/") &&
          s.page.url().includes("/fake-osm/authorize"),
        JSON.stringify({
          before,
          empty,
          wrong,
          posts: posts.length,
          startedThen,
          url: s.page.url(),
        }),
      );
      check("OSM not linked: no page error", s.errors.length === 0, s.errors.join(" | "));
      await s.context.close();
    }
    // Linked, with a password: « Délier ».
    {
      const s = await open({ osm: true, password: true });
      const before = await foot(s.page);
      await axe(s.page, "OSM linked");
      await s.page.locator("#sheet .board-osm-unlink").click();
      await s.page.waitForSelector("#sheet .board-osm-note:not(:empty)", { timeout: 5_000 });
      const after = await foot(s.page);
      const posts = s.api.calls.filter((c) => c.method === "POST" && c.path === "/api/osm/unlink");
      check(
        "OSM linked: « ✓ Relié à OpenStreetMap », « Délier » → POST /api/osm/unlink, then « Relier à OpenStreetMap » (focused) and « Délié… » said",
        before.linked === "✓ Relié à OpenStreetMap" &&
          before.unlink &&
          before.password &&
          posts.length === 1 &&
          after.link &&
          after.linked === null &&
          after.focus.includes("board-osm-link") &&
          /^Délié d'OpenStreetMap/.test(after.note),
        JSON.stringify({ before, after, posts: posts.length }),
      );
      check("OSM linked: no page error", s.errors.length === 0, s.errors.join(" | "));
      await s.context.close();
    }
    // An account made with OpenStreetMap, no password.
    {
      const s = await open({ osm: true, password: false });
      const only = await foot(s.page);
      check(
        "OSM account without a password: « Relié », no « Délier », no « Changer le mot de passe »",
        only.linked === "✓ Relié à OpenStreetMap" && !only.unlink && !only.password,
        JSON.stringify(only),
      );
      await axe(s.page, "OSM account without a password");
      // « Supprimer mon compte » asks the pseudonym retyped: wrong, said; exact, closed.
      await s.page.locator("#sheet .board-delete").click();
      const field = s.page.locator("#sheet .board-delete-form input");
      const kind = await field.getAttribute("type");
      await field.fill("pas_moi");
      await s.page.locator("#sheet .board-delete-confirm").click();
      await s.page.waitForTimeout(400);
      const said = await s.page.locator("#sheet .board-delete-error").textContent();
      await field.fill("ju_93");
      await s.page.locator("#sheet .board-delete-confirm").click();
      await s.page.waitForTimeout(500);
      const bodies = s.api.calls.filter((c) => c.path === "/api/me/delete").map((c) => c.body);
      const closed = await s.page.evaluate(() => document.getElementById("sheet").hidden);
      check(
        "OSM account without a password: « Supprimer mon compte » asks the pseudonym retyped",
        kind === "text" &&
          /pseudonyme exact/.test(said ?? "") &&
          JSON.stringify(bodies) ===
            JSON.stringify([{ pseudonym: "pas_moi" }, { pseudonym: "ju_93" }]) &&
          closed,
        JSON.stringify({ kind, said, bodies, closed }),
      );
      check("OSM only: no page error", s.errors.length === 0, s.errors.join(" | "));
      await s.context.close();
    }
  } catch (e) {
    check("OSM at the account's foot", false, String(e).split("\n")[0]);
  }
}

/** The OSM synchronisation (16/10), « Publier sur OpenStreetMap » (writing on, the test
 * server). */
async function syncChecks(options) {
  const section = (page) =>
    page.evaluate(() => {
      const s = document.querySelector("#sheet .board-sync");
      const text = (sel) => s?.querySelector(sel)?.textContent ?? null;
      const radio = (v) => s?.querySelector(`input[type=radio][value=${v}]`);
      return {
        shown: Boolean(s && !s.hidden),
        title: text(".board-publish-title"),
        group: s?.querySelector("[role=radiogroup]")?.getAttribute("aria-labelledby") ?? null,
        stay: radio("stay")?.checked ?? null,
        publish: radio("publish")?.checked ?? null,
        labels: [...(s?.querySelectorAll(".board-sync-choice") ?? [])].map((l) => l.textContent),
        states: [...(s?.querySelectorAll(".board-sync-state") ?? [])].map((p) => p.textContent),
        since: text(".board-sync-since"),
        wiki: (() => {
          const p = s?.querySelector(".board-sync-wiki");
          const a = p?.querySelector("a");
          return p
            ? { text: p.textContent, href: a?.getAttribute("href"), target: a?.target, rel: a?.rel }
            : null;
        })(),
        info: text(".board-sync-info"),
        leaves: s?.querySelectorAll(".board-sync-leaves li").length ?? 0,
        enable: Boolean(s?.querySelector(".board-sync-enable:not([hidden])")),
        stop: Boolean(s?.querySelector(".board-sync-stop:not([hidden])")),
        again: Boolean(s?.querySelector(".board-sync-again")),
        heading: text(".board-sync-history-title"),
        items: [...(s?.querySelectorAll(".board-sync-item") ?? [])].map((li) => ({
          state: [...li.classList].find((c) => c !== "board-sync-item"),
          name: li.querySelector(".board-publish-name")?.textContent,
          line: li.querySelector(".board-sync-line")?.textContent,
        })),
        link: (() => {
          const a = s?.querySelector(".sync-changeset");
          return a ? { href: a.getAttribute("href"), target: a.target, rel: a.rel } : null;
        })(),
        note: text(".board-sync-note"),
        error: text("#board-sync-enable-error"),
        stopError: text("#board-sync-stop-error"),
        focus: document.activeElement?.id ?? "",
      };
    });
  const open = async (account, opts = {}) => {
    const context = await browser.newContext(options);
    const s = await signedIn(context, "clair", { account, sync: SYNC, ...opts });
    await openAccount(s.page);
    await s.page.waitForSelector("#sheet .board-sync:not([hidden])", { timeout: 10_000 });
    return { context, ...s };
  };
  const posts = (s) => s.api.calls.filter((c) => c.method === "POST" && c.path === "/api/osm/sync");
  try {
    // Not offered: no section.
    {
      const context = await browser.newContext(options);
      const s = await signedIn(context, "clair", { account: { osm: true, sync: false } });
      await openAccount(s.page);
      await s.page.waitForTimeout(600);
      const off = await section(s.page);
      check("sync: not offered, nothing of it", !off.shown, JSON.stringify(off));
      await context.close();
    }
    // Off, an account with a password: the two choices, the text, the password, OSM's page.
    {
      const s = await open({ osm: true, password: true, sync: false });
      const a = await section(s.page);
      await axe(s.page, "sync off");
      await shot(s.page, "sync-off");
      check(
        "sync off: the test server's notice, two radios « Rester sur Surveillance World » (checked) / « Publier aussi sur OpenStreetMap en mon nom », the text (after review, what leaves with check_date, never, public and permanent), no history",
        a.shown &&
          a.title === "Publier sur OpenStreetMap" &&
          a.group === "board-sync-title" &&
          a.stay === true &&
          a.publish === false &&
          JSON.stringify(a.labels) ===
            JSON.stringify([
              "Rester sur Surveillance World",
              "Publier aussi sur OpenStreetMap en mon nom",
            ]) &&
          a.states.length === 1 &&
          /^Serveur de test d'OSM/.test(a.states[0]) &&
          /sera publiée sur OSM en votre nom après relecture/.test(a.info ?? "") &&
          /check_date/.test(a.info ?? "") &&
          /Ne part jamais : une caméra de particulier/.test(a.info ?? "") &&
          /supprimer votre compte ici ne retire rien d'OSM/.test(a.info ?? "") &&
          a.leaves === 5 &&
          !a.enable &&
          a.heading === null,
        JSON.stringify(a),
      );
      // « Publier aussi… » chosen, then « Annuler »: back, nothing sent.
      await s.page.locator("#sheet .board-sync-choice", { hasText: "Publier aussi" }).click();
      const chosen = await section(s.page);
      await s.page.locator("#sheet .board-sync-enable-cancel").click();
      const cancelled = await section(s.page);
      check(
        "sync off: « Publier aussi… » unfolds the password (focused) and « Autoriser »; « Annuler » folds it, « Rester » checked again and focused, nothing sent",
        chosen.publish &&
          chosen.enable &&
          chosen.focus === "" &&
          !cancelled.enable &&
          cancelled.stay &&
          cancelled.focus === "board-sync-stay" &&
          posts(s).length === 0,
        JSON.stringify({ chosen, cancelled }),
      );
      await s.page.locator("#sheet .board-sync-choice", { hasText: "Publier aussi" }).click();
      const field = s.page.locator("#board-sync-enable input[type=password]");
      const focused = await field.evaluate((e) => e === document.activeElement);
      await s.page.locator("#sheet .board-sync-enable-submit").click();
      const empty = (await section(s.page)).error;
      await field.fill("pas le bon");
      await s.page.locator("#sheet .board-sync-enable-submit").click();
      await s.page.waitForTimeout(400);
      const wrong = (await section(s.page)).error;
      await field.fill(PASSWORD);
      await s.page.locator("#sheet .board-sync-enable-submit").click();
      await s.page
        .waitForURL(/\/fake-osm\/authorize\?state=write/, { timeout: 10_000 })
        .catch(() => {});
      const sent = posts(s);
      check(
        "sync off → on: the password asked (empty, wrong said), then POST {on: true, password, then: this page} opens OSM's page",
        focused &&
          /mot de passe/i.test(empty ?? "") &&
          /incorrect/.test(wrong ?? "") &&
          sent.length === 2 &&
          sent[1].body?.on === true &&
          sent[1].body?.password === PASSWORD &&
          (sent[1].body?.then ?? "").includes("#17.6/") &&
          s.page.url().includes("/fake-osm/authorize?state=write"),
        JSON.stringify({ empty, wrong, sent: sent.map((c) => c.body?.then), url: s.page.url() }),
      );
      check("sync off: no page error", s.errors.length === 0, s.errors.join(" | "));
      await s.context.close();
    }
    // An account without a password: no field, straight to OSM.
    {
      const s = await open({ osm: true, password: false, sync: false });
      await s.page.locator("#sheet .board-sync-choice", { hasText: "Publier aussi" }).click();
      const fields = await s.page.locator("#board-sync-enable input").count();
      const focused = await s.page.evaluate(() =>
        document.activeElement?.classList.contains("board-sync-enable-submit"),
      );
      await s.page.locator("#sheet .board-sync-enable-submit").click();
      await s.page.waitForURL(/\/fake-osm\/authorize/, { timeout: 10_000 }).catch(() => {});
      const body = posts(s)[0]?.body;
      check(
        "sync, no password: no field, the key focused, POST {on: true} without one, OSM's page",
        fields === 0 &&
          focused &&
          body?.on === true &&
          !("password" in body) &&
          s.page.url().includes("/fake-osm/"),
        JSON.stringify({ fields, focused, body }),
      );
      await s.context.close();
    }
    // Contributions closed meanwhile: 403 closed said.
    {
      const s = await open(
        { osm: true, password: false, sync: false },
        { syncError: [403, "closed"] },
      );
      await s.page.locator("#sheet .board-sync-choice", { hasText: "Publier aussi" }).click();
      await s.page.locator("#sheet .board-sync-enable-submit").click();
      await s.page.waitForSelector("#board-sync-enable-error:not(:empty)", { timeout: 5_000 });
      const closed = await section(s.page);
      check(
        "sync: 403 closed said, nothing changed",
        /contributions sont fermées/.test(closed.error ?? "") && closed.publish,
        JSON.stringify(closed),
      );
      await s.context.close();
    }
    // On, its history; then « Rester sur Surveillance World ».
    {
      const s = await open({ osm: true, password: true, sync: true }, { sync: SYNC_ON });
      const on = await section(s.page);
      await axe(s.page, "sync on, its history");
      await shot(s.page, "sync-on");
      const line = (state) => on.items.find((i) => i.state === state)?.line ?? "";
      const lines = on.items.map((i) => i.line);
      check(
        "sync on: « Publier aussi » checked, « Activé depuis octobre 2026 », the wiki page offered (a new window), the history: each contribution its camera, question, month, what became of it",
        on.publish &&
          !on.stay &&
          on.since === "Activé depuis octobre 2026" &&
          on.wiki?.text.startsWith("Vous pouvez lier la page du projet depuis votre profil OSM") &&
          on.wiki.href ===
            "https://wiki.openstreetmap.org/wiki/Organised_Editing/Activities/Surveillance_World" &&
          on.wiki.target === "_blank" &&
          on.wiki.rel === "noopener" &&
          on.heading === `Vos contributions et OSM (${HISTORY.length})` &&
          on.items.length === HISTORY.length &&
          on.items[0].name === "Dôme · Ville de Courbevoie · Rue de Bezons, Courbevoie" &&
          lines[0] === "Déplacement · octobre 2026 · partira après relecture" &&
          lines[1] ===
            "Direction · octobre 2026 · partira après la prochaine mise à jour de la carte" &&
          /^Vérification · octobre 2026 · publiée · changeset n° 12345 ↗ \(nouvelle fenêtre\)$/.test(
            lines[2],
          ) &&
          lines.includes("Forme · octobre 2026 · publiée : OSM avait déjà cette valeur") &&
          lines.includes(
            "Qui filme · octobre 2026 · conflit : OSM a déjà une autre valeur · rien n'a été écrasé",
          ) &&
          lines.includes(
            "Ajout · octobre 2026 · conflit : une caméra est déjà sur OSM à quelques mètres · rien n'a été écrasé",
          ) &&
          /envoi incertain/.test(line("uncertain")) &&
          /en cours d'envoi/.test(line("sending")) &&
          /modifiée à la relecture, non publiée$/.test(line("kept_edited")) &&
          line("kept_before") ===
            "Vérification · septembre 2026 · envoyée avant votre choix, reste sur Surveillance World" &&
          on.link?.href === `${WRITE_URL}/changeset/12345` &&
          on.link.target === "_blank" &&
          on.link.rel === "noopener",
        JSON.stringify(on),
      );
      // « Rester » chosen: what stopping does, then the key.
      await s.page.locator("#sheet .board-sync-choice", { hasText: "Rester" }).click();
      const asked = await section(s.page);
      await s.page.locator("#sheet .board-sync-stop-cancel").click();
      const kept = await section(s.page);
      await s.page.locator("#sheet .board-sync-choice", { hasText: "Rester" }).click();
      await s.page.locator("#sheet .board-sync-stop-submit").click();
      await s.page.waitForSelector("#sheet .board-sync-note:not(:empty)", { timeout: 5_000 });
      const off = await section(s.page);
      const sent = posts(s);
      check(
        "sync on → off: « Rester » unfolds what stopping does (« Annuler » keeps it on, nothing sent); its key posts {on: false}, « Rester » checked and focused, « Vous restez… » said, only what went stays listed",
        asked.stop &&
          !kept.stop &&
          kept.publish &&
          kept.focus === "board-sync-publish" &&
          sent.length === 1 &&
          sent[0].body?.on === false &&
          off.stay &&
          off.focus === "board-sync-stay" &&
          off.since === null &&
          /^Vous restez sur Surveillance World/.test(off.note ?? "") &&
          off.items.length === 6 &&
          off.items.every((i) => ["gone", "conflict", "uncertain", "sending"].includes(i.state)),
        JSON.stringify({ asked: asked.stop, kept, sent: sent.map((c) => c.body), off }),
      );
      check("sync on: no page error", s.errors.length === 0, s.errors.join(" | "));
      await s.context.close();
    }
    // The camera sheet's « Vos contributions »: the same state line under each contribution
    // that went or may still go (matched by uuid in GET /api/osm/sync's history).
    {
      const context = await browser.newContext(options);
      const api = await mockProfile(context, {
        account: { osm: true, password: true, sync: true },
        sync: SYNC_ON,
      });
      const page = await context.newPage();
      await page.goto(`${APP}?ui=punk&mode=clair&cam=${CAMS.dome}${AT}`);
      await page.waitForSelector("#sheet .part-link", { timeout: 20_000 });
      await page.locator("#sheet .part-link", { hasText: "Vos contributions" }).click();
      await page.waitForSelector("#mine .mine-osm", { timeout: 10_000 }).catch(() => {});
      const lines = await page.evaluate(() =>
        [...document.querySelectorAll("#mine .mine-list li")]
          .filter((li) => li.querySelector(".mine-osm"))
          .map((li) => ({
            osm: li.querySelector(".mine-osm").textContent,
            href: li.querySelector(".mine-osm a")?.getAttribute("href") ?? null,
          })),
      );
      const asked = api.calls.filter((c) => c.path === "/api/osm/sync").length;
      await shot(page, "sync-mine");
      check(
        "sync: the camera sheet's « Vos contributions » says what became of each on OSM (« OSM : partira après relecture », « OSM : publiée · changeset n° 12345 » linked…), GET /api/osm/sync asked once",
        lines.length === 4 &&
          lines[0].osm === "OSM : partira après relecture" &&
          lines[1].osm === "OSM : publiée · changeset n° 12345\u00a0↗ (nouvelle fenêtre)" &&
          lines[1].href === `${WRITE_URL}/changeset/12345` &&
          lines[2].osm === "OSM : partira après la prochaine mise à jour de la carte" &&
          /^OSM : conflit : une caméra est déjà sur OSM/.test(lines[3].osm) &&
          asked === 1,
        JSON.stringify({ lines, asked }),
      );
      await context.close();
    }
    // Stopping offline: said, still on.
    {
      const s = await open(
        { osm: true, password: true, sync: true },
        { sync: SYNC_ON, disableFails: true },
      );
      await s.page.locator("#sheet .board-sync-choice", { hasText: "Rester" }).click();
      await s.page.locator("#sheet .board-sync-stop-submit").click();
      await s.page.waitForSelector("#board-sync-stop-error:not(:empty)", { timeout: 5_000 });
      const failed = await section(s.page);
      check(
        "sync: stopping offline is said, the choice stays on",
        /reste activée/.test(failed.stopError ?? "") && failed.since !== null,
        JSON.stringify(failed),
      );
      await s.context.close();
    }
    // The states: suspended, revoked, blocked (« Autoriser à nouveau »), OSM down; live.
    for (const [name, sync, want] of [
      ["suspended", { ...SYNC_ON, suspended: true }, /^Envois vers OSM suspendus par l'équipe/],
      ["revoked", { ...SYNC, last_error: "revoked" }, /^OSM a retiré l'autorisation/],
      ["blocked", { ...SYNC_ON, last_error: "blocked" }, /^OSM refuse vos envois/],
      ["osm_down", { ...SYNC_ON, last_error: "osm_down" }, /nouvel essai plus tard/],
      ["rate_limited", { ...SYNC_ON, last_error: "rate_limited" }, /nouvel essai plus tard/],
    ]) {
      const s = await open({ osm: true, password: true, sync: sync.on }, { sync });
      const got = await section(s.page);
      let again = true;
      if (name === "blocked") {
        await s.page.locator("#sheet .board-sync-again").click();
        again = (await section(s.page)).enable;
      }
      check(
        `sync ${name}: said above the choices${name === "blocked" ? ", « Autoriser à nouveau » unfolds the authorisation" : ""}${name === "revoked" ? ", « Rester » checked" : ""}`,
        got.states.some((x) => want.test(x)) &&
          (name !== "revoked" || got.stay) &&
          (name !== "blocked" || (got.again && again)),
        JSON.stringify(got.states),
      );
      await s.context.close();
    }
    {
      const s = await open(
        { osm: true, password: true, sync: true },
        { sync: { ...SYNC_ON, server: "live", url: "https://www.openstreetmap.org" } },
      );
      const live = await section(s.page);
      check(
        "sync on the live server: no test-server notice, the changeset on openstreetmap.org",
        live.states.length === 0 &&
          live.link?.href === "https://www.openstreetmap.org/changeset/12345",
        JSON.stringify({ title: live.title, states: live.states, link: live.link }),
      );
      await s.context.close();
    }
    // Back from OSM, the choice on.
    {
      const context = await browser.newContext(options);
      await mockProfile(context, {
        account: { osm: true, password: true, sync: true },
        sync: SYNC_ON,
      });
      const page = await context.newPage();
      await page.goto(`${APP}?ui=punk&mode=clair&osm=write_on${AT}`);
      await page.waitForSelector("#sheet .board-notice:not(:empty)", { timeout: 20_000 });
      await page.waitForSelector("#sheet .board-sync-since", { timeout: 10_000 });
      const notice = await page.locator("#sheet .board-notice").textContent();
      const since = await page.locator("#sheet .board-sync-since").textContent();
      check(
        "sync: `?osm=write_on` opens the account's screen, « Publication sur OpenStreetMap activée… » said, « Activé depuis octobre 2026 »",
        /^Publication sur OpenStreetMap activée : vos contributions faites sur place à partir de maintenant partiront en votre nom après relecture\.$/.test(
          notice ?? "",
        ) &&
          since === "Activé depuis octobre 2026" &&
          !page.url().includes("osm="),
        JSON.stringify({ notice, since, url: page.url() }),
      );
      await context.close();
    }
  } catch (e) {
    check("« Publier sur OpenStreetMap »", false, String(e).split("\n")[0]);
  }
}

/** Lot U: « Afficher mon pseudonyme sur les caméras que j'ai relevées » (off, what it reveals
 * said, PUT both ways), then « Mes caméras »: asked only when unfolded; its numbers, its
 * collection by kind, its little map (a drawing, a dot per counted camera), its cameras by
 * commune with each contribution's state in the five words, an add the review refused
 * listed without a button; a tap on a camera opens its sheet in place of the screen (its
 * history there, the link to OSM's live server), « ← Profil » back; folded, the little map
 * gone; axe on the unfolded section. */
/** A sheet's head as laid out (run in the page): its buttons (↑ on a phone, ×, « ← Mes
 * caméras »), the sticker and the title, in CSS px; a tilted button by its own box. */
const HEAD = () => {
  // Measured untilted: a wide screen's paper is drawn turned 1°, the buttons a few degrees
  // (decoration), which would move their boxes by a few pixels across the head.
  const flat = document.createElement("style");
  flat.textContent =
    "#sheet, #sheet .sheet-frame, #sheet .sheet-paper, #sheet .sheet-head > * { transform: none !important; rotate: none !important; }";
  document.head.append(flat);
  const head = document.querySelector("#sheet .sheet-head");
  const shown = (e) => e && e.offsetWidth > 0 && e.offsetHeight > 0;
  const own = (e) => {
    const r = e.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    return {
      left: Math.round(cx - e.offsetWidth / 2),
      right: Math.round(cx + e.offsetWidth / 2),
      top: Math.round(cy - e.offsetHeight / 2),
      bottom: Math.round(cy + e.offsetHeight / 2),
      mid: Math.round(cy),
      w: e.offsetWidth,
      h: e.offsetHeight,
    };
  };
  const buttons = [...head.querySelectorAll(":scope > :is(.sheet-return, .sheet-grab, .close)")]
    .filter(shown)
    .map((b) => {
      // Its name as a screen reader says it (what is aria-hidden left out), and what the eye
      // reads (what is said only left out), from the text the page holds (not its CSS case).
      const words = (skip) =>
        [...b.childNodes]
          .filter((n) => n.nodeType === Node.TEXT_NODE || !n.matches(skip))
          .map((n) => n.textContent)
          .join("")
          .replace(/\s+/g, " ")
          .trim();
      return {
        cls: b.className.split(" ")[0],
        name: b.getAttribute("aria-label") ?? words("[aria-hidden]"),
        text: words(".sheet-sr"),
        ...own(b),
      };
    });
  const picto = head.querySelector(":scope > .sheet-picto");
  const column = head.querySelector(":scope > .sheet-title");
  const letters = [...column.querySelectorAll(".cut")]
    .filter(shown)
    .map((c) => c.getBoundingClientRect());
  const paper = document.querySelector("#sheet .sheet-paper").getBoundingClientRect();
  const title = {
    left: Math.round(column.getBoundingClientRect().left),
    top: Math.round(Math.min(...letters.map((r) => r.top))),
  };
  const sticker = shown(picto) ? own(picto) : null;
  flat.remove();
  return {
    kind: document.querySelector("#sheet .sheet-paper").className,
    paperLeft: Math.round(paper.left),
    paperRight: Math.round(paper.right),
    buttons,
    picto: sticker,
    title,
  };
};

/** One sheet head in the whole site (lot U2): the account's, a camera's, the same camera's
 * opened from « Mes caméras », a commune's and a département's. Each has ↑ (a phone) and ×
 * on one row at the right, 44 px under a finger, × at the same right edge; the title (after
 * the sticker on a camera's, 4b) at its kind's left edge in the paper, the camera opened from
 * « Mes caméras » exactly as the others, its « ← Mes caméras » above. */
async function headsChecks(page, where, phone) {
  const heads = {};
  const at = async (name, open) => {
    await open();
    await page.waitForTimeout(900);
    heads[name] = await page.evaluate(HEAD);
    await shot(page, `${where.replace(/\W+/g, "-")}-head-${name}`);
  };
  const goto = async (query) => {
    await page.goto(`${APP}?ui=punk&mode=clair&${query}`);
    await page.waitForSelector("#sheet .sheet-head .headline", { timeout: 20_000 });
  };
  await at("compte", async () => {
    await page.goto(`${APP}?ui=punk&mode=clair${AT}`);
    await page.waitForFunction(() => window.__map?.loaded(), null, { timeout: 30_000 });
    await page.waitForTimeout(800);
    // A sheet still open from before (the camera's) hides the header ticket on a phone.
    const close = page.locator("#sheet .sheet-head .close");
    if (await close.isVisible()) await close.click();
    await openAccount(page);
  });
  await at("mes-cameras", async () => {
    if (phone) await page.locator("#sheet .sheet-grab").click();
    const toggle = page.locator("#sheet .board-cameras-toggle");
    await toggle.scrollIntoViewIfNeeded();
    await toggle.click();
    const dome = page.locator(`#sheet [data-camera="${DOME_CAM}"] button.profile-cam`);
    await dome.waitFor({ timeout: 10_000 });
    await dome.scrollIntoViewIfNeeded();
    await dome.click();
    await page.waitForSelector("#sheet .sheet-paper:not(.profile-paper) .sheet-return", {
      timeout: 10_000,
    });
  });
  // A phone: that sheet's paper scrolled, its head folds to one bar, « ← Mes caméras », ↑
  // and × where they were (the review of lot U2: the emptied title took the room between
  // them); back at the top it unfolds.
  const folding = phone
    ? await (async () => {
        const scroll = async (y) => {
          const folded = await page.evaluate(async (top) => {
            const paper = document.querySelector("#sheet .sheet-paper:not(.profile-paper)");
            if (top && paper.scrollHeight - paper.clientHeight < top) {
              const more = document.createElement("div");
              more.className = "bench-more";
              more.style.height = `${paper.clientHeight}px`;
              paper.querySelector(".sheet-body").append(more);
            }
            paper.scrollTop = top;
            await new Promise((r) => setTimeout(r, 400));
            return document.querySelector("#sheet .sheet-head").classList.contains("compact");
          }, y);
          const h = await page.evaluate(HEAD);
          return { folded, at: Object.fromEntries(h.buttons.map((b) => [b.cls, b.left])) };
        };
        const scrolled = await scroll(300);
        await shot(page, `${where.replace(/\W+/g, "-")}-head-mes-cameras-folded`);
        const top = await scroll(0);
        await page.evaluate(() => document.querySelector("#sheet .bench-more")?.remove());
        return { scrolled, top, open: heads["mes-cameras"] };
      })()
    : null;
  if (folding) {
    const open = Object.fromEntries(folding.open.buttons.map((b) => [b.cls, b.left]));
    const same = (at) =>
      ["sheet-return", "sheet-grab", "close"].every((c) => Math.abs((at[c] ?? -99) - open[c]) <= 2);
    check(
      `${where}: the sheet from « Mes caméras » scrolled folds its head, « ← Mes caméras », ↑ and × where they were; unfolded at the top`,
      folding.scrolled.folded &&
        same(folding.scrolled.at) &&
        !folding.top.folded &&
        same(folding.top.at),
      JSON.stringify({ open, ...folding }),
    );
  }
  await at("camera", () => goto(`cam=${DOME_CAM}${AT}`));
  await at("commune", () => goto("insee=92026"));
  if (phone) {
    // Its paper scrolled, an area's head folds to the one bar too: its line under the title
    // gone (the review of lot U2).
    const area = await page.evaluate(async () => {
      const paper = document.querySelector("#sheet .sheet-paper");
      const more = document.createElement("div");
      more.style.height = `${paper.clientHeight}px`;
      paper.querySelector(".sheet-body")?.append(more);
      paper.scrollTop = 300;
      await new Promise((r) => setTimeout(r, 400));
      const head = document.querySelector("#sheet .sheet-head");
      const out = {
        folded: head.classList.contains("compact"),
        height: Math.round(head.getBoundingClientRect().height),
        line: head.querySelector(".area-line")?.offsetHeight ?? 0,
      };
      paper.scrollTop = 0;
      more.remove();
      return out;
    });
    check(
      `${where}: a commune's sheet scrolled folds its head to one bar (no line under the title), at most 72 px`,
      area.folded && area.line === 0 && area.height <= 72,
      JSON.stringify(area),
    );
  }
  await at("departement", () => goto("insee=92"));
  const bad = [];
  const min = phone ? 44 : 36;
  const closeOf = (h) => h.buttons.find((b) => b.cls === "close");
  const ref = heads.camera;
  for (const [name, h] of Object.entries(heads)) {
    const row = h.buttons.filter((b) => b.cls !== "sheet-return");
    const close = closeOf(h);
    if (!close) bad.push(`${name}: no ×`);
    if (phone && !h.buttons.some((b) => b.cls === "sheet-grab")) bad.push(`${name}: no ↑`);
    if (row.some((b) => Math.abs(b.mid - row[0].mid) > 3)) bad.push(`${name}: ↑ and × apart`);
    if (h.buttons.some((b) => b.h < min || (b.cls !== "sheet-return" && b.w < min)))
      bad.push(`${name}: a button under ${min} px`);
    if (close && Math.abs(h.paperRight - close.right - (ref.paperRight - closeOf(ref).right)) > 2)
      bad.push(`${name}: × not as far from its paper's right edge as on a camera's`);
    // The title's left edge in its paper: after the sticker on a camera's (4b), at the
    // paper's edge otherwise (the account's, the areas').
    const kin = h.picto || name === "mes-cameras" ? ref : heads.commune;
    const left = h.title.left - h.paperLeft;
    const want = kin.title.left - kin.paperLeft;
    if (Math.abs(left - want) > 1) bad.push(`${name}: title at ${left}, its kind's at ${want}`);
  }
  const mine = heads["mes-cameras"];
  if (
    Boolean(mine.picto) !== Boolean(ref.picto) ||
    (mine.picto &&
      Math.abs(mine.picto.left - mine.paperLeft - (ref.picto.left - ref.paperLeft)) > 1)
  )
    bad.push("mes-cameras: the sticker not where the camera sheet has it");
  check(
    `${where}: one sheet head (compte, camera, camera from « Mes caméras », commune, département): ↑ and × in one row at the same right edge, ${min} px, the title at its kind's left edge`,
    bad.length === 0,
    bad.length ? `${bad.join("; ")} ${JSON.stringify(heads)}` : "",
  );
}

/** A camera's history on its sheet (lot U2), punk and classique, on phones 320 and 390 px
 * wide and a wide screen, light and dark: two lines an entry at most — the change and the
 * month in words, then who on one line —, no tag nor dotted leader, no word cut; the
 * longest pseudonym the accounts allow (32 letters, the widest) on one line, cut short with
 * « … » where it is longer than the line, whole in the page's text (a screen reader's). */
const LONG_NAME = "W".repeat(32);
const LONG_HISTORY = {
  [DOME_CAM]: [
    { what: "moved", month: "2026-10", on_site: false, by: "cara", osm: null },
    { what: "operator", month: "2026-09", on_site: false, by: LONG_NAME, osm: null },
    { what: "tilt", month: "2026-09", on_site: true, by: null, osm: null },
    ...CAMERA_HISTORY[DOME_CAM],
  ],
};
async function historyChecks(browser, ui, [name, options], mode) {
  const where = `history ${ui} ${name} ${mode}`;
  const context = await browser.newContext({ ...options, locale: "fr-FR" });
  await mockProfile(context, { history: LONG_HISTORY });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${APP}?ui=${ui}&mode=${mode}&cam=${DOME_CAM}${AT}`);
  await page.waitForSelector('.sheet-history-slot[data-history="shown"]', {
    state: "attached",
    timeout: 20_000,
  });
  const grab = page.locator("#sheet .sheet-grab");
  if (ui === "punk" && (await grab.isVisible())) {
    await grab.click();
    await page.waitForTimeout(500);
  }
  // The section's end at the sheet's bottom: the whole section shown, under any pinned head.
  await page.evaluate(() =>
    document.querySelector(".sheet-history").scrollIntoView({ block: "end" }),
  );
  await page.waitForTimeout(400);
  const got = await page.evaluate(() =>
    [...document.querySelectorAll(".sheet-history .history-entry")].map((li) => {
      const lines = (e) =>
        Math.round(e.offsetHeight / Number.parseFloat(getComputedStyle(e).lineHeight));
      const what = li.querySelector(".history-what");
      const who = li.querySelector(".history-who");
      // A word cut in two: a line of the first ending inside a word (its rects' text).
      const range = document.createRange();
      range.selectNodeContents(what);
      const rows = [...range.getClientRects()].map((r) => Math.round(r.top));
      return {
        what: what.textContent,
        who: who.textContent,
        lines: lines(what) + lines(who),
        whoLines: lines(who),
        cut: who.scrollWidth > who.clientWidth,
        // Longer than its line, it is clipped and ends with « … », never painted past it.
        clipped:
          who.scrollWidth <= who.clientWidth ||
          (getComputedStyle(who).overflow === "hidden" &&
            getComputedStyle(who).textOverflow === "ellipsis"),
        rows: new Set(rows).size,
        // The two lines and nothing else: no tag, no dotted leader.
        children: [...li.children].map((c) => c.className).join(),
      };
    }),
  );
  const words = await page.evaluate(() => {
    // Every word of the first lines whole on one row.
    const broken = [];
    for (const what of document.querySelectorAll(".sheet-history .history-what")) {
      const text = what.firstChild;
      let at = 0;
      for (const word of what.textContent.split(" ")) {
        const r = document.createRange();
        r.setStart(text, at);
        r.setEnd(text, at + word.length);
        if (new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size > 1)
          broken.push(word);
        at += word.length + 1;
      }
    }
    return broken;
  });
  const long = got.find((e) => e.who === `par ${LONG_NAME}`);
  check(
    `${where}: two lines an entry, « Position corrigée · octobre 2026 » / « par cara », no tag, no word cut, a long pseudonym on one line, whole in the text`,
    got.length === 4 &&
      got[0].what === "Position corrigée · octobre 2026" &&
      got[0].who === "par cara" &&
      got[2].what === "Inclinaison précisée · septembre 2026" &&
      got[2].who === "par un contributeur" &&
      got.every(
        (e) =>
          e.lines <= 2 &&
          e.whoLines === 1 &&
          e.clipped &&
          e.children === "history-what,history-who",
      ) &&
      long !== undefined &&
      words.length === 0 &&
      errors.length === 0,
    JSON.stringify({ got, words, errors }),
  );
  if (OUT) await page.screenshot({ path: join(OUT, `${where.replace(/\W+/g, "-")}.png`) });
  await context.close();
  return long?.cut;
}

async function camerasChecks(page, api, where, phone) {
  await openAccount(page);
  if (phone) await page.locator("#sheet .sheet-grab").click();
  const sw = page.locator("#sheet .board-signed");
  const help = await page.locator("#board-signed-help").textContent();
  const was = await sw.getAttribute("aria-checked");
  await sw.click();
  await page.waitForTimeout(300);
  const on = await sw.getAttribute("aria-checked");
  await sw.click();
  await page.waitForTimeout(300);
  const puts = api.calls.filter((c) => c.path === "/api/me/history-pseudonym");
  check(
    `${where}: « Afficher mon pseudonyme… » off by default, says what it reveals, PUT both ways`,
    was === "false" &&
      on === "true" &&
      (await sw.getAttribute("aria-checked")) === "false" &&
      (await sw.getAttribute("aria-describedby")) === "board-signed-help" &&
      /suivre où vous passez/.test(help ?? "") &&
      JSON.stringify(puts.map((p) => p.body)) === JSON.stringify([{ on: true }, { on: false }]),
    JSON.stringify({ was, on, puts: puts.map((p) => p.body) }),
  );
  const before = api.calls.filter((c) => c.path === "/api/me/contributions").length;
  const toggle = page.locator("#sheet .board-cameras-toggle");
  await toggle.scrollIntoViewIfNeeded();
  await toggle.click();
  await page.waitForSelector("#sheet .board-cameras .profile-numbers", { timeout: 10_000 });
  const asked = api.calls.filter((c) => c.path === "/api/me/contributions").length;
  const seen = await page.evaluate((refused) => {
    const box = document.querySelector("#sheet .board-cameras");
    const text = (sel) => [...box.querySelectorAll(sel)].map((e) => e.textContent.trim());
    return {
      numbers: box.querySelector(".profile-numbers").textContent.replace(/\s+/g, " ").trim(),
      kinds: text(".board-cameras-kind .sheet-sr"),
      dots: box.querySelectorAll(".board-minimap circle").length,
      // Lot U2: a commune's name over a dot (its halo's box against each dot's).
      names: [...box.querySelectorAll(".board-minimap-name")].map((n) => n.textContent),
      covered: [...box.querySelectorAll(".board-minimap-name")].flatMap((n) => {
        const t = n.getBBox();
        return [...box.querySelectorAll(".board-minimap circle")]
          .map((c) => c.getBBox())
          .filter(
            (d) =>
              d.x < t.x + t.width &&
              t.x < d.x + d.width &&
              d.y < t.y + t.height &&
              t.y < d.y + d.height,
          )
          .map(() => n.textContent);
      }),
      groups: text(".profile-label"),
      states: [...new Set(text(".profile-state"))].sort(),
      cams: box.querySelectorAll(".profile-cam-item").length,
      buttons: box.querySelectorAll("button.profile-cam").length,
      refusedButton: box.querySelectorAll(`[data-camera="${refused}"] button`).length,
      expanded: document
        .querySelector("#sheet .board-cameras-toggle")
        .getAttribute("aria-expanded"),
    };
  }, REFUSED_ADD);
  check(
    `${where}: asked once unfolded; 7 cameras in 2 communes, by kind, a dot each`,
    before === 0 &&
      asked === 1 &&
      seen.expanded === "true" &&
      seen.numbers === "7 caméras, 2 communes" &&
      JSON.stringify(seen.kinds) ===
        JSON.stringify(["Caméra fixe : 5", "Dôme : 1", "Type inconnu : 1"]) &&
      seen.dots === 7,
    JSON.stringify(seen),
  );
  check(
    `${where}: the mini-map's commune names over no dot`,
    seen.names.length > 0 && seen.covered.length === 0,
    JSON.stringify({ names: seen.names, covered: seen.covered }),
  );
  check(
    `${where}: by commune, each contribution's state in its word; a refused add is no button`,
    JSON.stringify(seen.groups) ===
      JSON.stringify(["Courbevoie · 6 caméras", "Puteaux · 2 caméras"]) &&
      JSON.stringify(seen.states) ===
        JSON.stringify(["acceptée", "en attente", "publiée sur OSM", "refusée", "sur la carte"]) &&
      seen.cams === 8 &&
      seen.buttons === 7 &&
      seen.refusedButton === 0,
    JSON.stringify(seen),
  );
  await shot(page, `${where.replace(/\W+/g, "-")}-cameras`);
  await axe(page, `${where} unfolded`);
  // A tap on the dome: its sheet in place of the screen, « ← Mes caméras » back.
  const dome = page.locator(`#sheet [data-camera="${DOME_CAM}"] button.profile-cam`);
  await dome.scrollIntoViewIfNeeded();
  await dome.click();
  await page.waitForSelector("#sheet .sheet-paper:not(.profile-paper) .sheet-return", {
    timeout: 10_000,
  });
  await page.waitForSelector('#sheet .sheet-history-slot[data-history="shown"]', {
    state: "attached",
    timeout: 10_000,
  });
  const sheet = await page.evaluate(() => ({
    title: document.querySelector("#sheet .sheet-head .headline .sheet-sr")?.textContent,
    history: document.querySelector("#sheet .sheet-history")?.textContent,
    osm: document.querySelector("#sheet .sheet-history a")?.getAttribute("href"),
  }));
  check(
    `${where}: a tap opens the camera's sheet, its history there, the link to OSM's history`,
    /Dôme/.test(sheet.title ?? "") &&
      /Vérifiée/.test(sheet.history ?? "") &&
      /par un contributeur/.test(sheet.history ?? "") &&
      sheet.osm === `https://www.openstreetmap.org/node/${DOME_CAM.slice(1)}/history`,
    JSON.stringify(sheet),
  );
  const back = await page.evaluate(HEAD);
  const ret = back.buttons.find((b) => b.cls === "sheet-return");
  check(
    `${where}: « ← Mes caméras » a button of the head's top row, beside ↑ and ×, as high, said « Revenir à Mes caméras »`,
    ret !== undefined &&
      ret.name === "Revenir à Mes caméras" &&
      ret.text === "← Mes caméras" &&
      back.buttons.every((b) => Math.abs(b.mid - ret.mid) <= 3 && Math.abs(b.h - ret.h) <= 1) &&
      back.buttons.every((b) => b.h >= (phone ? 44 : 36)) &&
      ret.right < Math.min(...back.buttons.filter((b) => b !== ret).map((b) => b.left)) &&
      back.title.top >= ret.bottom,
    JSON.stringify(back),
  );
  await shot(page, `${where.replace(/\W+/g, "-")}-return`);
  await page.locator("#sheet .sheet-return").click();
  await page.waitForSelector("#sheet .board-paper .board-cameras-toggle", { timeout: 10_000 });
  const toggleBack = page.locator("#sheet .board-cameras-toggle");
  await toggleBack.scrollIntoViewIfNeeded();
  await toggleBack.click();
  await page.waitForSelector("#sheet .board-minimap", { timeout: 10_000 });
  await toggleBack.click();
  const folded = await page.evaluate(() => ({
    map: document.querySelectorAll("#sheet .board-minimap").length,
    hidden: document.querySelector("#sheet .board-cameras").hidden,
  }));
  check(
    `${where}: « ← Profil » back to the screen; folded, the little map gone`,
    folded.map === 0 && folded.hidden,
    JSON.stringify(folded),
  );
}

const server = spawn("npx", preview(PORT), { cwd: WEB, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 2500));
const browser = returning(await (engine === "chromium" ? chromium : webkit).launch());
try {
  for (const [device, options] of [
    ["phone", devices["iPhone 14"]],
    ["desktop", { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 }],
  ]) {
    for (const mode of ["clair", "sombre"]) {
      const where = `${device} ${mode}`;
      const context = await browser.newContext({ ...options, locale: "fr-FR" });
      const { page, api, errors } = await signedIn(context, mode);
      try {
        await boardChecks(page, api, where, false, device === "phone");
      } catch (e) {
        check(`${where}: the profile and the leaderboard`, false, String(e).split("\n")[0]);
      }
      check(`${where}: no page error`, errors.length === 0, errors.join(" | "));
      await context.close();
    }
  }
  // Lot U: « Afficher mon pseudonyme… » and « Mes caméras », on a phone and a wide screen.
  for (const [device, options] of [
    ["phone", devices["iPhone 14"]],
    ["desktop", { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 }],
  ]) {
    const context = await browser.newContext({ ...options, locale: "fr-FR" });
    const { page, api, errors } = await signedIn(context, "clair", {
      contributions: COLLECTION,
      signed: false,
    });
    try {
      await camerasChecks(page, api, `${device} « Mes caméras »`, device === "phone");
    } catch (e) {
      check(`${device}: « Mes caméras »`, false, String(e).split("\n")[0]);
    }
    try {
      await headsChecks(page, `${device} heads`, device === "phone");
    } catch (e) {
      check(`${device}: one sheet head`, false, String(e).split("\n")[0]);
    }
    check(`${device} « Mes caméras »: no page error`, errors.length === 0, errors.join(" | "));
    await context.close();
  }
  // Lot U2: the history's entries, two lines at most.
  const narrow = { ...devices["iPhone SE"], viewport: { width: 320, height: 568 } };
  const cut = [];
  for (const ui of ["punk", "classique"])
    for (const device of [
      ["320", narrow],
      ["390", devices["iPhone 14"]],
      ["desktop", { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 }],
    ])
      for (const mode of ui === "punk" ? ["clair", "sombre"] : ["clair"]) {
        try {
          cut.push([`${ui} ${device[0]} ${mode}`, await historyChecks(browser, ui, device, mode)]);
        } catch (e) {
          check(`history ${ui} ${device[0]} ${mode}`, false, String(e).split("\n")[0]);
        }
      }
  console.log(`  (a 32-letter pseudonym cut short with « … »: ${JSON.stringify(cut)})`);
  // Reduced motion, and a scale changed in the API's answer.
  const changed = { ...SCALE, add: 60, info: 15 };
  const desktop = { viewport: { width: 1440, height: 900 }, locale: "fr-FR" };
  const reduced = await browser.newContext({ ...desktop, reducedMotion: "reduce" });
  const r = await signedIn(reduced, "sombre", { scale: changed });
  r.api.scale = changed;
  try {
    await boardChecks(r.page, r.api, "reduced motion", true);
  } catch (e) {
    check("reduced motion: the leaderboard", false, String(e).split("\n")[0]);
  }
  check("reduced motion: no page error", r.errors.length === 0, r.errors.join(" | "));
  await reduced.close();
  // « Se déconnecter ».
  const out = await browser.newContext(desktop);
  const o = await signedIn(out, "clair");
  try {
    await openAccount(o.page);
    await o.page.locator("#sheet .profile-logout").click();
    await o.page.waitForTimeout(400);
    check(
      "« Se déconnecter » calls DELETE /api/session and closes the sheet",
      o.api.calls.some((c) => c.method === "DELETE" && c.path === "/api/session") &&
        (await o.page.evaluate(() => document.getElementById("sheet").hidden)),
    );
  } catch (e) {
    check("« Se déconnecter »", false, String(e).split("\n")[0]);
  }
  check("sign out: no page error", o.errors.length === 0, o.errors.join(" | "));
  await out.close();
  // « Télécharger mes données »: a session gone is said, nothing saved; then the file.
  const dl = await browser.newContext({ ...desktop, acceptDownloads: true });
  const d = await signedIn(dl, "clair");
  try {
    await openAccount(d.page);
    const saved = [];
    d.page.on("download", (x) => saved.push(x));
    d.api.exportStatus = 401;
    await d.page.locator("#sheet .board-export").click();
    const said = await d.page.locator("#sheet .board-export-error").textContent();
    d.api.exportStatus = null;
    const [file] = await Promise.all([
      d.page.waitForEvent("download", { timeout: 10_000 }),
      d.page.locator("#sheet .board-export").click(),
    ]);
    const got = JSON.parse(readFileSync(await file.path(), "utf8"));
    const after = await d.page.evaluate(() => ({
      error: Boolean(document.querySelector("#sheet .board-export-error")),
      open: !document.getElementById("sheet").hidden,
    }));
    check(
      "« Télécharger mes données »: a session gone said, nothing saved; then the API's file under its name, the sheet kept",
      /reconnectez-vous/.test(said ?? "") &&
        saved.length === 1 &&
        file.suggestedFilename() === EXPORT_FILE &&
        got.account?.pseudonym === ME &&
        Array.isArray(got.contributions) &&
        d.api.calls.filter((c) => c.path === "/api/me/export").length === 2 &&
        !after.error &&
        after.open,
      JSON.stringify({ said, saved: saved.length, name: file.suggestedFilename(), after }),
    );
  } catch (e) {
    check("« Télécharger mes données »", false, String(e).split("\n")[0]);
  }
  check("export: no page error", d.errors.length === 0, d.errors.join(" | "));
  await dl.close();
  await osmChecks(desktop);
  await syncChecks(desktop);
} finally {
  await browser.close();
  server.kill();
}
const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
process.exit(failed.length ? 1 : 0);
