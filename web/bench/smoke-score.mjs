// Smoke test of the points scored at the send (board 8a: src/participate/score.ts, its hooks
// in modify.ts and the camera sheet's « Toujours là ? », src/cannon.ts,
// src/theme/punk/score.css), on the states' servers (states/harness.mjs: the throwaway API
// on the CI build, real sends, real fields), GET /api/me/points answered by score-kit.mjs
// until the API serves it. Punk, a phone (390 × 845; WebKit by default, real taps) and a
// wide screen (960 × 581): « Modifier »'s three changes sent — the sheet slides away, the
// field turns from 180° to the bearing sent (its yellow tag), a ticket per piece in the
// order sent with exactly the server's points (the real API's, which the bench's mirror
// and the phone's own categories match), the total their sum, « en attente de revue », the
// points asked only for what left the phone; from the first third of the first fall, each
// ticket in its category's colour (the leaderboard dot's, light and dark) and words, before
// any number, and on a wide screen in the column of the sheet that slid away (a phone's
// column unchanged); the points answering after score.ts's timeout, no number ever; the
// cannon, its burst, clear of
// « PTS »; « Voir le classement » last, then the leaderboard; nothing blocks: a touch on
// the map mid-fall, a move of the map or Escape puts it away and closes the editor; under
// reduced motion everything at once, nothing animated, no cannon; offline the tickets
// without points and the queued wording, no total, no points asked; the points route
// failing, no number; a send refused by the server, its points gone with it; the add of a
// bullet (seven tickets), its bonus ticket, its infos on one ticket where the stack would
// rise above the screen (wide), not on the phone's; on a phone (375 and 390 px wide, both
// engines) the stack and the total centred, every ticket and the total within 16 px of the
// edges, no ticket's number under the next ticket, the smaller cannon clear of « PTS » and
// at least half on the screen; no ticket for a piece that earns
// nothing (an add whose direction is « Je ne vois pas »), none for a piece the server gives
// nothing, and then no scene but « Envoyé · en attente de revue »; « Toujours là ? » and
// « Je ne la trouve pas » (« Disparue ») on site, the sheet gone, one ticket with its points;
// from afar (nothing earned) no scene, the sheet says « Envoyé · en attente de revue ».
// Exits non-zero if a check failed.
//   node bench/smoke-score.mjs [--browser webkit|chromium]

import { readFileSync } from "node:fs";
import { chromium, webkit } from "playwright";
import {
  addFilled,
  awards,
  DOME,
  frameContext,
  holdAt,
  mockPoints,
  offsetLngLat,
  threeChanges,
} from "./score-kit.mjs";
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
const engine = arg("--browser", "webkit");
const PHONE = { width: 390, height: 845 };
const WIDE = { width: 960, height: 581 };
const ctx = { login, cookie: COOKIE, app: APP };

// The leaderboard's words (26a's legend, fr.json board.count.one.*, the scale's bonus):
// a ticket's line starts with its category's.
const FR = JSON.parse(readFileSync(new URL("../src/locales/fr.json", import.meta.url), "utf8"));
const WORD = {
  add: FR["board.count.one.add"],
  info: FR["board.count.one.info"],
  correction: FR["board.count.one.correction"],
  verification: FR["board.count.one.verification"],
  bonus: FR["board.scale.bonus.title"],
};
// A send that earns nothing: no scene, this alone.
const SENT = FR["score.sent"];

// The first ticket starts to fall at LAND + FIRST (src/participate/points.ts) after the tap,
// for 420 ms (theme/punk/score.css): a third into its fall.
const FALLING = 400 + 650 + 140;
// How long the scene waits for the points (score.ts POINTS_TIMEOUT_MS), read from the source.
const TIMEOUT = Number(
  readFileSync(new URL("../src/participate/score.ts", import.meta.url), "utf8").match(
    /POINTS_TIMEOUT_MS = (\d+)/,
  )[1],
);

const checks = [];
function check(name, ok, detail = "") {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "ok  " : "FAIL"} [${engine}] ${name}${detail ? ` — ${detail}` : ""}`);
}

/** The scene as shown: its tickets, the total, the status, the board, the cannon. */
const scene = (page) =>
  page.evaluate(() => {
    const root = document.getElementById("score");
    if (!root) return null;
    const box = (e) => e?.getBoundingClientRect();
    const tickets = [...root.querySelectorAll(".score-ticket:not([hidden])")].map((t) => ({
      pts: t.querySelector(".score-ticket-pts").textContent,
      what: t.querySelector(".score-ticket-what").textContent,
      det: t.querySelector(".score-ticket-det").textContent,
      k: [...t.classList].find((c) => c.startsWith("k-")) ?? null,
    }));
    const row = root.querySelector(".score-total-row");
    const pts = box(root.querySelector(".score-total-pts"));
    const gun = root.querySelector(".cannon-body");
    const g = box(gun);
    const board = root.querySelector(".score-board");
    return {
      tickets,
      total: row.hidden ? null : root.querySelector(".score-total-n").textContent,
      status: document.getElementById("modify-done")?.textContent ?? "",
      badge: root.querySelector(".score-badge")?.textContent ?? null,
      board: board.hidden ? "hidden" : getComputedStyle(board).visibility,
      cannon: Boolean(gun),
      clear:
        !g || !pts || row.hidden || g.left > pts.right || g.bottom < pts.top || g.top > pts.bottom,
      moving: document
        .getAnimations()
        .filter((a) => a.playState === "running" && root.contains(a.effect?.target)).length,
      panel: document.getElementById("modify-panel")?.hidden ?? "gone",
      sliding: document.getElementById("modify-panel")?.classList.contains("sent") ?? false,
      tag: document.getElementById("edit-tag")?.textContent ?? null,
    };
  });

const taken = await takenPorts();
if (taken.length) {
  console.log(`FAIL ports taken: ${taken.join(", ")}`);
  process.exit(2);
}
let browser;
/** A punk page at `size`; the kit of the states' captures. */
async function open(size, opts = {}) {
  const context = await frameContext(browser, size, { ...ctx, ...opts });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const phone = size.width < 600;
  const k = kit(page, context, { device: phone ? "phone" : "desktop", mode: "clair" });
  return { context, page, errors, k };
}

try {
  await startServers();
  browser = await (engine === "chromium" ? chromium : webkit).launch();
  const size = engine === "webkit" ? PHONE : WIDE;
  const where = engine === "webkit" ? "phone" : "wide";

  // --- one colour per category: a ticket and the leaderboard's dot, light and dark -------
  for (const dark of [false, true]) {
    const { context, page, k } = await open(size, { dark });
    await k.open("#16.5/48.8963/2.2382");
    const got = await page.evaluate(() => {
      const sheet = document.getElementById("sheet");
      const out = {};
      for (const k of ["add", "info", "correction", "verification", "bonus"]) {
        const ticket = document.createElement("div");
        ticket.className = `score-ticket k-${k}`;
        const paper = document.createElement("div");
        paper.className = "score-ticket-paper";
        ticket.append(paper);
        document.body.append(ticket);
        // The leaderboard: its legend's dot, the scale's bonus value.
        const legend = document.createElement("div");
        legend.className = k === "bonus" ? "" : `board-count k-${k}`;
        const dot = document.createElement("span");
        dot.className = k === "bonus" ? "board-scale-v k-bonus" : "board-dot";
        legend.append(dot);
        sheet.append(legend);
        const a = getComputedStyle(paper);
        const b = getComputedStyle(dot);
        out[k] = {
          ticket: a.backgroundColor,
          board: b.backgroundColor,
          ink: a.color,
          boardInk: b.color,
        };
        ticket.remove();
        legend.remove();
      }
      return { mode: document.documentElement.dataset.mode, out };
    });
    const same = Object.entries(got.out).every(
      ([k, v]) =>
        v.ticket === v.board &&
        v.ticket !== "rgba(0, 0, 0, 0)" &&
        (k !== "bonus" || v.ink === v.boardInk),
    );
    check(
      `${dark ? "dark" : "light"}: each category's ticket in the colour of its leaderboard dot (the bonus: the scale's value, ink too)`,
      same && got.mode === (dark ? "dark" : "light"),
      JSON.stringify(got),
    );
    await context.close();
  }

  // --- the first frame: colours and words before the numbers, in the sheet's column -------
  for (const dark of [false, true]) {
    const mode = dark ? "dark" : "light";
    resetContributions();
    const { context, page, errors, k } = await open(size, { dark });
    const { sent } = await mockPoints(page, { delay: 1500 });
    await threeChanges(k);
    const sheet = await page.evaluate(() => {
      const p = document.getElementById("modify-panel");
      return { left: p.offsetLeft, width: p.offsetWidth };
    });
    await k.tap("#modify-send");
    await page.waitForSelector("#score");
    await holdAt(page, FALLING);
    const f = await page.evaluate(() => {
      const root = document.getElementById("score");
      const col = root.querySelector(".score-col").getBoundingClientRect();
      const dot = (k) => {
        const legend = document.createElement("div");
        legend.className = `board-count ${k}`;
        const d = document.createElement("span");
        d.className = "board-dot";
        legend.append(d);
        document.getElementById("sheet").append(legend);
        const bg = getComputedStyle(d).backgroundColor;
        legend.remove();
        return bg;
      };
      return {
        col: { left: Math.round(col.left), width: Math.round(col.width) },
        tickets: [...root.querySelectorAll(".score-ticket:not([hidden])")].map((t) => {
          const k = [...t.classList].find((c) => c.startsWith("k-")) ?? null;
          return {
            k,
            bg: getComputedStyle(t.querySelector(".score-ticket-paper")).backgroundColor,
            dot: k ? dot(k) : null,
            opacity: getComputedStyle(t).opacity,
            pts: t.querySelector(".score-ticket-pts").textContent,
            det: t.querySelector(".score-ticket-det").textContent,
          };
        }),
      };
    });
    await page.evaluate(() => {
      for (const a of document.getAnimations()) a.play();
    });
    await page
      .waitForSelector("#score .score-total-row:not([hidden])", { timeout: 15000 })
      .catch(() => {});
    const end = await scene(page);
    const want = awards(sent, [...sent.keys()]);
    const kindOf = Object.fromEntries([...sent].map(([u, b]) => [b.kind, u]));
    const cats = ["direction", "height", "operator"].map(
      (kind) => want.items.find((i) => i.uuid === kindOf[kind] && !i.bonus)?.category,
    );
    check(
      `${where} ${mode}: a third into the first fall (${FALLING} ms after the tap), the first ticket shown, every ticket in its category's colour (the leaderboard dot's) and words (« ${cats.map((c) => WORD[c]).join(" », « ")} »), no number yet`,
      f.tickets.length === 3 &&
        f.tickets[0].opacity === "1" &&
        f.tickets.every(
          (t, i) =>
            t.k === `k-${cats[i]}` &&
            t.bg === t.dot &&
            t.det.startsWith(`${WORD[cats[i]]} · `) &&
            t.pts === "",
        ),
      JSON.stringify({ f: f.tickets, cats }),
    );
    check(
      where === "wide"
        ? `${where} ${mode}: the tickets in the column of the sheet that slid away (${sheet.left} px, ${sheet.width} px wide)`
        : `${where} ${mode}: the column where it was, 22 px from the left, 346 px wide`,
      where === "wide"
        ? f.col.left === sheet.left && f.col.width === sheet.width
        : f.col.left === 22 && f.col.width === 346,
      JSON.stringify({ col: f.col, sheet }),
    );
    check(
      `${where} ${mode}: the numbers come with the answer (${end?.tickets.map((t) => t.pts).join(" ")}), no page error`,
      end?.tickets.every((t) => t.pts !== "") && end.total === `+${want.total}` && !errors.length,
      JSON.stringify({ end, errors }),
    );
    await context.close();
  }

  // --- « Modifier »'s three changes, online, the real API's points ------------------------
  {
    resetContributions();
    const { context, page, errors, k } = await open(size);
    const { sent, asked, answers } = await mockPoints(page, { real: true });
    let answered = null;
    page.on("requestfinished", (r) => {
      if (r.url().includes("/api/me/points")) answered = r.timing().responseEnd;
    });
    await threeChanges(k);
    const tap = Date.now();
    await k.tap("#modify-send");
    await page.waitForSelector("#score");
    const t0 = await scene(page);
    await page.waitForTimeout(600);
    const landed = await scene(page);
    await page
      .waitForSelector("#score .score-total-row:not([hidden])", { timeout: 15000 })
      .catch(() => {});
    const shown = Date.now() - tap;
    await page.waitForTimeout(4600);
    const end = await scene(page);
    const uuids = [...sent.keys()];
    const want = awards(sent, uuids);
    console.log(
      `info [${engine}] GET /api/me/points answered in ${Math.round(answered ?? -1)} ms; the total shown ${shown} ms after the tap`,
    );
    const byKind = Object.fromEntries([...sent].map(([u, b]) => [b.kind, u]));
    const ptsOf = (u) => {
      const i = want.items.filter((x) => x.uuid === u && !x.bonus);
      return i.length ? `+${i.reduce((s, x) => s + x.points, 0)}` : "";
    };
    const dir = sent.get(byKind.direction)?.direction;
    check(
      `${where}: « Envoyer 3 modifications »: the sheet slides away (hidden once gone), three tickets in the order sent (Direction, Hauteur, Exploitant)`,
      t0?.sliding === true &&
        landed?.panel === true &&
        end.tickets.map((t) => t.what).join(",") === "Direction,Hauteur,Exploitant",
      JSON.stringify({ panel: [t0?.sliding, landed?.panel], tickets: end.tickets }),
    );
    check(
      `${where}: each ticket's points the server's for its piece, the total their sum, « en attente de revue », the points asked for the three pieces once sent`,
      end.tickets[0].pts === ptsOf(byKind.direction) &&
        end.tickets[1].pts === ptsOf(byKind.height) &&
        end.tickets[2].pts === ptsOf(byKind.operator) &&
        end.total === `+${want.total}` &&
        end.badge === "en attente de revue" &&
        end.status.includes(`+${want.total} points`) &&
        asked.length === 3 &&
        uuids.every((u) => asked.includes(u)),
      JSON.stringify({ tickets: end.tickets.map((t) => t.pts), total: end.total, want, asked }),
    );
    const catOf = (u) => want.items.find((x) => x.uuid === u && !x.bonus)?.category;
    const order = [byKind.direction, byKind.height, byKind.operator];
    const cats = order.map(catOf);
    const real = order.map(
      (u) => answers[0]?.items.find((x) => x.uuid === u && !x.bonus)?.category,
    );
    check(
      `${where}: the phone's categories at the first frame are the server's (the real GET /api/me/points: ${real.join(", ")}) and the bench mirror's`,
      t0.tickets.every((tk, i) => tk.k === `k-${real[i]}`) && real.join() === cats.join(),
      JSON.stringify({ first: t0.tickets.map((t) => t.k), real, mirror: cats }),
    );
    check(
      `${where}: each ticket in its category's colour class and words, the leaderboard's (« ${cats.map((c) => WORD[c]).join(" », « ")} »)`,
      end.tickets.every(
        (tk, i) => tk.k === `k-${cats[i]}` && tk.det.startsWith(`${WORD[cats[i]]} · `),
      ),
      JSON.stringify({ tickets: end.tickets.map((t) => [t.k, t.det]), cats }),
    );
    check(
      `${where}: the direction's ticket « … · 180° → ${dir}° … », the field turned with its tag saying the new bearing`,
      end.tickets[0].det.includes(` · 180° → ${dir}° `) &&
        typeof end.tag === "string" &&
        end.tag.startsWith(`${dir}° · `),
      JSON.stringify({ det: end.tickets[0].det, tag: end.tag }),
    );
    check(
      `${where}: the cannon burst, clear of « PTS »; « Voir le classement » shown last; every animation over`,
      end.cannon &&
        end.clear &&
        end.board === "visible" &&
        end.moving === 0 &&
        landed.board !== "visible",
      JSON.stringify({ clear: end.clear, board: [landed.board, end.board], moving: end.moving }),
    );
    await k.tap("#score .score-board");
    await page
      .waitForSelector('#sheet [data-account="profile"]', { timeout: 15000 })
      .catch(() => {});
    const after = await page.evaluate(() => ({
      score: Boolean(document.getElementById("score")),
      editor: Boolean(document.getElementById("modify-panel")),
      board: Boolean(document.querySelector('#sheet [data-account="profile"]')),
    }));
    check(
      `${where}: « Voir le classement »: the scene and the editor gone, the leaderboard open`,
      !after.score && !after.editor && after.board,
      JSON.stringify(after),
    );
    check(`${where}: no page error`, errors.length === 0, errors.join(" | "));
    await context.close();
  }

  // --- nothing blocks: a touch on the map mid-fall, a move, Escape ------------------------
  for (const how of ["touch", "move", "Escape"]) {
    resetContributions();
    const { context, page, k } = await open(size);
    await mockPoints(page);
    await threeChanges(k);
    await k.tap("#modify-send");
    await page.waitForSelector("#score");
    await page.waitForTimeout(900);
    if (how === "touch") {
      const b = await page.locator("#map").boundingBox();
      if (engine === "webkit") await page.touchscreen.tap(b.x + b.width - 40, b.y + 140);
      else await page.mouse.click(b.x + b.width - 40, b.y + 140);
    } else if (how === "move") await k.drag(-60, 40);
    else await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    const gone = await page.evaluate(() => ({
      score: Boolean(document.getElementById("score")),
      editor: Boolean(document.getElementById("modify-panel")),
      tag: Boolean(document.getElementById("edit-tag")),
      field: window.__map.getSource("edit-field") !== undefined,
    }));
    check(
      `${where}: ${how} 900 ms after the tap: the tickets put away, the editor, its field and tag gone`,
      !gone.score && !gone.editor && !gone.tag && !gone.field,
      JSON.stringify(gone),
    );
    await context.close();
  }

  // --- reduced motion -----------------------------------------------------------------------
  {
    resetContributions();
    const { context, page, k } = await open(size, { reduced: true });
    await mockPoints(page);
    await threeChanges(k);
    await k.tap("#modify-send");
    await page.waitForSelector("#score");
    await page
      .waitForSelector("#score .score-total-row:not([hidden])", { timeout: 15000 })
      .catch(() => {});
    await page.waitForTimeout(150);
    const s = await scene(page);
    const visible = await page.evaluate(() =>
      [
        ...document.querySelectorAll(
          "#score .score-ticket, #score .score-total, #score .score-board",
        ),
      ].every(
        (e) => getComputedStyle(e).opacity === "1" && getComputedStyle(e).visibility === "visible",
      ),
    );
    check(
      `${where} reduced motion: tickets, total and « Voir le classement » there at once, nothing animated, no cannon, the sheet gone at once`,
      s.tickets.length === 3 &&
        s.total !== null &&
        visible &&
        s.moving === 0 &&
        !s.cannon &&
        s.panel === true,
      JSON.stringify({
        n: s.tickets.length,
        total: s.total,
        visible,
        moving: s.moving,
        cannon: s.cannon,
        panel: s.panel,
      }),
    );
    await context.close();
  }

  // --- offline; the points route failing; a send refused ----------------------------------
  {
    resetContributions();
    const { context, page, k } = await open(size);
    const { asked } = await mockPoints(page);
    await threeChanges(k);
    await context.setOffline(true);
    await k.tap("#modify-send");
    await page.waitForSelector("#score");
    await page.waitForTimeout(3000);
    const s = await scene(page);
    check(
      `${where} offline: three tickets without points, no total, the queued wording in the badge's place, no « Voir le classement », no points asked`,
      s.tickets.length === 3 &&
        s.tickets.every((t) => t.pts === "") &&
        s.total === null &&
        /enregistrées sur ce téléphone/.test(s.badge ?? "") &&
        s.board === "hidden" &&
        asked.length === 0,
      JSON.stringify(s),
    );
    await context.setOffline(false);
    await context.close();
  }
  {
    resetContributions();
    const { context, page, errors, k } = await open(size);
    await mockPoints(page, { fail: true });
    await threeChanges(k);
    await k.tap("#modify-send");
    await page.waitForSelector("#score");
    await page.waitForTimeout(3000);
    const s = await scene(page);
    check(
      `${where} the points route failing: tickets without a number, no total, no page error`,
      s.tickets.length === 3 &&
        s.tickets.every((t) => t.pts === "") &&
        s.total === null &&
        errors.length === 0,
      JSON.stringify({ s, errors }),
    );
    await context.close();
  }
  {
    resetContributions();
    const { context, page, errors, k } = await open(size);
    const { asked } = await mockPoints(page, { delay: TIMEOUT + 1000 });
    await threeChanges(k);
    await k.tap("#modify-send");
    await page.waitForSelector("#score");
    for (let i = 0; i < 100 && !asked.length; i++) await page.waitForTimeout(100);
    // Past the timeout, and past the late answer too.
    await page.waitForTimeout(TIMEOUT + 1800);
    const s = await scene(page);
    check(
      `${where} the points answering ${TIMEOUT + 1000} ms late (the scene waits ${TIMEOUT} ms): the tickets in their colours without a number, no total, even once the late answer came; no page error`,
      asked.length === 3 &&
        s.tickets.length === 3 &&
        s.tickets.every((t) => t.pts === "" && t.k !== null) &&
        s.total === null &&
        errors.length === 0,
      JSON.stringify({ s, errors, asked: asked.length }),
    );
    await context.close();
  }
  {
    resetContributions();
    const { context, page, k } = await open(size);
    await mockPoints(page);
    let n = 0;
    await page.route("**/api/contributions", (route) => {
      if (route.request().method() === "POST" && ++n === 2)
        return route.fulfill({
          status: 422,
          contentType: "application/json",
          body: '{"error":"invalid"}',
        });
      return route.fallback();
    });
    await threeChanges(k);
    await k.tap("#modify-send");
    await page.waitForSelector("#score");
    await page
      .waitForFunction(
        () => document.getElementById("modify-done")?.textContent.includes("refusée"),
        null,
        { timeout: 15000 },
      )
      .catch(() => {});
    await page.waitForTimeout(500);
    const s = await scene(page);
    check(
      `${where} a send refused by the server: said in place of the status, no points nor total, no « Voir le classement »`,
      s.status.includes("refusée") &&
        s.tickets.every((t) => t.pts === "") &&
        s.total === null &&
        s.board === "hidden",
      JSON.stringify(s),
    );
    await context.close();
  }

  // The OSM synchronisation: the API answers that the send will be published on OSM in her
  // name (`osm: "will_publish"`, added here to the real API's answer): the line under the
  // badge, in the status; without it (every other case above), none.
  {
    resetContributions();
    const { context, page, k } = await open(size);
    await mockPoints(page);
    await page.route("**/api/contributions", async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      const real = await route.fetch();
      const body = await real.json();
      return route.fulfill({ response: real, json: { ...body, osm: "will_publish" } });
    });
    await threeChanges(k);
    await k.tap("#modify-send");
    await page.waitForSelector("#score");
    await page.waitForSelector("#modify-done .score-osm", { timeout: 15000 }).catch(() => {});
    // Once the total has dropped (it falls from a larger scale).
    await page.evaluate(() =>
      Promise.all(
        (document.querySelector("#score .score-total")?.getAnimations() ?? []).map((a) =>
          a.finished.catch(() => {}),
        ),
      ),
    );
    const s = await scene(page);
    const line = await page.evaluate(() => {
      const e = document.querySelector("#modify-done .score-osm");
      const r = e?.getBoundingClientRect();
      return e
        ? {
            text: e.textContent,
            inside: r.left >= 0 && r.right <= window.innerWidth,
            at: [Math.round(r.left), Math.round(r.right)],
          }
        : null;
    });
    check(
      `${where} the API says the send will be published on OSM: « Sera publiée sur OSM en votre nom après relecture. » under the badge (kept when the scene goes quiet), in the status, on the screen`,
      line?.text === "Sera publiée sur OSM en votre nom après relecture." &&
        line.inside &&
        s.status.includes("Sera publiée sur OSM") &&
        /en attente de revue$/.test(s.badge ?? ""),
      JSON.stringify({ line, status: s.status, badge: s.badge }),
    );
    await context.close();
  }

  // --- the add of a bullet: seven tickets, its infos on one where the stack is too high --------
  {
    resetContributions();
    const { context, page, k } = await open(size, { who: "fay" });
    const { sent } = await mockPoints(page);
    await addFilled(k, { shape: "bullet" });
    await k.tap("#modify-send");
    await page.waitForSelector("#score");
    await page
      .waitForSelector("#score .score-total-row:not([hidden])", { timeout: 15000 })
      .catch(() => {});
    await page.waitForTimeout(300);
    const s = await scene(page);
    const want = awards(sent, [...sent.keys()]);
    const bonus = want.items.find((i) => i.bonus);
    const infos = want.items.filter((i) => i.category === "info");
    const top = await page.evaluate(() =>
      Math.round(document.querySelector("#score .score-col").getBoundingClientRect().top),
    );
    check(
      `${where} « ＋ Ajouter » a bullet: « Ajout / Caméra ajoutée » first, the bonus last (« Tout y est »), the total the server's`,
      s.tickets[0].what === "Ajout" &&
        s.tickets[0].det === WORD.add &&
        bonus &&
        s.tickets.at(-1).pts === `+${bonus.points}` &&
        s.tickets.at(-1).what === "Tout y est" &&
        s.tickets.at(-1).det === WORD.bonus &&
        s.total === `+${want.total}`,
      JSON.stringify({ tickets: s.tickets, total: s.total, want: want.total }),
    );
    check(
      where === "wide"
        ? `${where}: seven tickets would rise above the screen: the ${infos.length} infos on one ticket « Fiche · ${infos.length} infos ajoutées », +${infos.length * 10}, the column within the screen`
        : `${where}: the seven tickets fit under the screen's top: one each`,
      where === "wide"
        ? s.tickets.length === 3 &&
            s.tickets[1].what === "Fiche" &&
            s.tickets[1].det === `${infos.length} infos ajoutées` &&
            s.tickets[1].k === "k-info" &&
            s.tickets[1].pts === `+${infos.reduce((n, i) => n + i.points, 0)}` &&
            infos.length === 5 &&
            top >= 16
        : s.tickets.length === 7 && top >= 16,
      JSON.stringify({ tickets: s.tickets.map((t) => [t.what, t.det, t.pts, t.k]), top }),
    );
    await context.close();
  }

  // --- on a phone, in both engines: the stack and the total centred, nothing off the screen -
  // The add of a bullet, the longest stack (seven tickets, every tilt and offset), at 375 and
  // 390 px wide once every animation is over: each ticket's box and the total's (their tilt
  // included) within MARGIN of both edges, each block's middle the screen's.
  for (const phoneSize of [
    { width: 375, height: 812 },
    { width: 390, height: 845 },
  ]) {
    const MARGIN = 16;
    resetContributions();
    const { context, page, errors, k } = await open(phoneSize, { who: "fay" });
    await mockPoints(page);
    await addFilled(k, { shape: "bullet" });
    await k.tap("#modify-send");
    await page.waitForSelector("#score");
    await page
      .waitForSelector("#score .score-total-row:not([hidden])", { timeout: 15000 })
      .catch(() => {});
    await page.evaluate(() =>
      Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))),
    );
    const g = await page.evaluate(() => {
      const box = (e) => {
        const r = e.getBoundingClientRect();
        return { left: Math.round(r.left), right: Math.round(r.right) };
      };
      const shown = [...document.querySelectorAll("#score .score-ticket:not([hidden])")];
      // Each stub's number not under the next ticket: what is on top at its lower quarter,
      // a third and two thirds across (the scene lets touches through: hit-tested for once).
      document.getElementById("score").style.pointerEvents = "auto";
      const covered = shown.filter((t) => {
        const range = document.createRange();
        range.selectNodeContents(t.querySelector(".score-ticket-pts"));
        const r = range.getBoundingClientRect();
        const y = r.top + r.height * 0.75;
        return [1 / 3, 2 / 3].some(
          (f) => !t.contains(document.elementFromPoint(r.left + r.width * f, y)),
        );
      }).length;
      document.getElementById("score").style.pointerEvents = "";
      const pts = document.querySelector("#score .score-total-pts").getBoundingClientRect();
      const gun = document.querySelector("#score .cannon-body")?.getBoundingClientRect();
      return {
        width: innerWidth,
        tickets: shown.map(box),
        covered,
        total: box(document.querySelector("#score .score-total")),
        pts: box({ getBoundingClientRect: () => pts }),
        gun: gun ? box({ getBoundingClientRect: () => gun }) : null,
        clear:
          Boolean(gun) && (gun.left > pts.right || gun.top > pts.bottom || gun.bottom < pts.top),
        shown: gun ? (Math.min(gun.right, innerWidth) - Math.max(gun.left, 0)) / gun.width : 0,
      };
    });
    const inside = (b) => b.left >= MARGIN && b.right <= g.width - MARGIN;
    const stack = {
      left: Math.min(...g.tickets.map((b) => b.left)),
      right: Math.max(...g.tickets.map((b) => b.right)),
    };
    const middle = (b) => Math.abs((b.left + b.right) / 2 - g.width / 2);
    check(
      `phone ${phoneSize.width} px: the ${g.tickets.length} tickets and the total within ${MARGIN} px of both edges (tilts included), the stack and the total centred (within 8 px)`,
      g.tickets.length === 7 &&
        g.tickets.every(inside) &&
        inside(g.total) &&
        middle(stack) <= 8 &&
        middle(g.total) <= 8 &&
        errors.length === 0,
      JSON.stringify({ ...g, stack, errors }),
    );
    check(
      `phone ${phoneSize.width} px: no ticket's number under the next ticket (${g.covered} covered)`,
      g.covered === 0,
      JSON.stringify({ covered: g.covered }),
    );
    check(
      `phone ${phoneSize.width} px: the cannon clear of « PTS » beside the centred total (the bullet's, four digits), at least half of it on the screen (${Math.round(g.shown * 100)} %)`,
      g.clear && g.shown >= 0.5,
      JSON.stringify({ pts: g.pts, gun: g.gun, shown: g.shown }),
    );
    await context.close();
  }

  // --- no ticket for what earns nothing: an add's « Je ne vois pas » --------------------
  {
    resetContributions();
    const { context, page, errors, k } = await open(size, { who: "fay" });
    const { sent } = await mockPoints(page);
    await addFilled(k, { unseen: true });
    await k.tap("#modify-send");
    await page.waitForSelector("#score");
    await page
      .waitForSelector("#score .score-total-row:not([hidden])", { timeout: 15000 })
      .catch(() => {});
    await page.waitForTimeout(300);
    const s = await scene(page);
    const want = awards(sent, [...sent.keys()]);
    const unseen = [...sent.values()].filter(
      (b) => b.kind === "direction" && b.answer === "not_visible",
    );
    check(
      `${where} « ＋ Ajouter » with its direction « Je ne vois pas » (sent: ${[...sent.values()].map((b) => b.kind).join(", ")}): no ticket for it, every ticket with its points, no bonus, the total the server's`,
      unseen.length === 1 &&
        s.tickets.length > 0 &&
        !s.tickets.some((t) => t.what === "Direction" || /je ne vois pas/i.test(t.det)) &&
        s.tickets.every((t) => t.pts !== "" && t.k !== null) &&
        !s.tickets.some((t) => t.what === "Tout y est") &&
        s.total === `+${want.total}` &&
        errors.length === 0,
      JSON.stringify({ tickets: s.tickets, total: s.total, want: want.total, errors }),
    );
    await context.close();
  }

  // --- the server gives nothing (sent again within the month): no scene ------------------
  {
    resetContributions();
    const { context, page, errors, k } = await open(size);
    const { asked } = await mockPoints(page, { none: true });
    await threeChanges(k);
    await k.tap("#modify-send");
    await page.waitForSelector("#score");
    await page.waitForTimeout(3500);
    const s = await scene(page);
    const role = await page.evaluate(() =>
      document.getElementById("modify-done")?.getAttribute("role"),
    );
    check(
      `${where} the server gives the three pieces nothing: their tickets gone, no total, no cannon, no « Voir le classement », « ${SENT} » alone (role=status)`,
      asked.length === 3 &&
        s.tickets.length === 0 &&
        s.total === null &&
        !s.cannon &&
        s.board === "hidden" &&
        s.badge === SENT &&
        s.status === SENT &&
        role === "status" &&
        errors.length === 0,
      JSON.stringify({ s, role, errors }),
    );
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    const gone = await page.evaluate(() => ({
      score: Boolean(document.getElementById("score")),
      editor: Boolean(document.getElementById("modify-panel")),
    }));
    check(
      `${where} that confirmation put away as the scene is (Escape), the editor closed`,
      !gone.score && !gone.editor,
      JSON.stringify(gone),
    );
    await context.close();
  }

  // --- « Toujours là ? » and « Disparue »: on site a ticket, from afar none --------------
  // On site: the phone 7 m from the camera, precise, « Me localiser » tapped (onsite.ts).
  const [lon, lat] = offsetLngLat(DOME.at, 5, 5);
  const near = { latitude: lat, longitude: lon, accuracy: 10 };
  for (const [answer, words] of [
    ["Elle est là", "Toujours là"],
    ["Je ne la trouve pas", "Disparue"],
  ]) {
    resetContributions();
    const { context, page, k } = await open(size, { geolocation: near });
    const { sent, asked } = await mockPoints(page);
    await k.open(`?cam=${DOME.id}#18/${DOME.at[0]}/${DOME.at[1]}`, { sheet: true });
    await k.tap(page.locator("#sheet button", { hasText: "Toujours là" }).first());
    await k.tap("#sheet .part-onsite-locate");
    await page.waitForSelector("#sheet .part-onsite-help[hidden]", {
      state: "attached",
      timeout: 15000,
    });
    const sheet = await page.evaluate(() => {
      let left = 0;
      const e = document.getElementById("sheet");
      for (let n = e; n instanceof HTMLElement; n = n.offsetParent) left += n.offsetLeft;
      return { left, width: e.offsetWidth };
    });
    await k.tap(page.locator("#sheet button", { hasText: answer }).first());
    if (answer.startsWith("Je ne"))
      await k.tap(page.locator("#sheet button", { hasText: "J'ai bien cherché" }).first());
    await page.waitForSelector("#score");
    await page.waitForTimeout(2500);
    const s = await scene(page);
    const sheetGone = await page.evaluate(() => document.getElementById("sheet").hidden);
    const col = await page.evaluate(() => {
      const r = document.querySelector("#score .score-col").getBoundingClientRect();
      return { left: Math.round(r.left), width: Math.round(r.width) };
    });
    const body = [...sent.values()][0];
    check(
      `${where} « ${answer} » on site: ${where === "wide" ? `the ticket in the camera sheet's column (${sheet.left} px, ${sheet.width} px)` : "the column 22 px from the left"}`,
      where === "wide"
        ? col.left === sheet.left && col.width === sheet.width
        : col.left === 22 && col.width === 346,
      JSON.stringify({ col, sheet }),
    );
    check(
      `${where} « ${answer} » on site: the sheet gone, one ticket « ${words} · ${WORD.verification} · … sur place », +10, « en attente de revue », « Merci » said`,
      body?.on_site === true &&
        sheetGone &&
        s.tickets.length === 1 &&
        s.tickets[0].what === words &&
        s.tickets[0].k === "k-verification" &&
        /sur place$/.test(s.tickets[0].det) &&
        s.tickets[0].pts === "+10" &&
        s.total === "+10" &&
        s.badge === "en attente de revue" &&
        s.status.startsWith("Merci") &&
        asked.length === 1,
      JSON.stringify({ on_site: body?.on_site, sheetGone, s, asked }),
    );
    await context.close();
  }
  // From afar (no position): nothing earned, no scene; the sheet stays and says it.
  {
    resetContributions();
    const { context, page, errors, k } = await open(size);
    const { sent, asked } = await mockPoints(page);
    await k.open(`?cam=${DOME.id}#18/${DOME.at[0]}/${DOME.at[1]}`, { sheet: true });
    await k.tap(page.locator("#sheet button", { hasText: "Toujours là" }).first());
    await k.tap(page.locator("#sheet button", { hasText: "Elle est là" }).first());
    await page.waitForSelector("#sheet .part-done");
    await page.waitForTimeout(2500);
    const c = await page.evaluate(() => {
      const done = document.querySelector("#sheet .part-done");
      return {
        score: Boolean(document.getElementById("score")),
        sheet: !document.getElementById("sheet").hidden,
        text: done?.textContent,
        role: done?.getAttribute("role"),
      };
    });
    check(
      `${where} « Elle est là » from afar (nothing earned): no scene, no ticket, the sheet stays and says « ${SENT} » (role=status), no points asked`,
      [...sent.values()][0]?.on_site !== true &&
        !c.score &&
        c.sheet &&
        c.text === SENT &&
        c.role === "status" &&
        asked.length === 0 &&
        errors.length === 0,
      JSON.stringify({ c, asked, errors }),
    );
    await context.close();
  }
} catch (e) {
  check("the run", false, String(e).split("\n")[0]);
} finally {
  await browser?.close();
  await stopServers();
  closeProxy();
}
const failed = checks.filter((c) => !c.ok);
console.log(`${checks.length - failed.length} ok, ${failed.length} FAIL`);
process.exit(failed.length ? 1 : 0);
