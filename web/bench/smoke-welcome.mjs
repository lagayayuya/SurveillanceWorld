// Smoke test of punk's welcome panel (board 28a of « Accueil Surveillance World »:
// src/welcome.ts, src/cannon.ts, src/theme/punk/welcome.css and cannon.css), on the
// production build of the CI extract, the API answering « signed out »: on a first visit
// the panel over the map, its content there at once (no entrance animation), a dialog
// (named, aria-modal, the focus inside, the page behind inert), « Voir la carte » in view on
// a phone (390 × 845 and 320 × 568), the title held left of the ×,
// the two poppers and their confetti (none but the still cones under reduced motion); it
// closes by ×, Escape, a tap outside and « Voir la carte » (a tap inside does not), the
// focus back on the ticket's « ? », still (no pulse: the author's request of 2026-10-14),
// which opens it again without poppers, its hover, press and focus its neighbours' (the
// sun / moon and the account's squares); the visit kept on the device under one key holding « 1 », the
// panel not back after a reload; without storage the panel still shows and closes; not over
// a return from OpenStreetMap; no « Questions fréquentes » (not shown, 2026-10-14); the texts as corrected
// (« The most magical place on Earth », no « Rien n'est stocké… », « Île-de-France »); the credit
// (and the contact address, when the build has one) right of « Voir la carte » on a wide
// screen, under it from the left on a phone, the button its size; axe-core WCAG 2.2 A/AA
// in the panel; the classique has neither panel nor « ? »; the site's counters (src/hit.ts):
// no POST /api/hit under navigator.webdriver (this bench's browsers), and, webdriver said
// false, the map's once in either interface and a welcome's at each showing. Exits non-zero
// if a check failed.
//   node bench/smoke-welcome.mjs [--browser webkit|chromium] [--port N]
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { chromium, devices, webkit } from "playwright";
import { preview, requireTiles, WEB } from "./dist.mjs";

const args = process.argv.slice(2);
const arg = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
requireTiles("ci");
const engine = arg("--browser", "webkit");
const PORT = Number(arg("--port", "4612"));
const APP = `http://localhost:${PORT}/`;
const AT = "#17/48.8963/2.2382";
const AXE = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
const PHONE = { ...devices["iPhone 14"], viewport: { width: 390, height: 845 } };
const NARROW = { ...devices["iPhone 14"], viewport: { width: 320, height: 568 } };
const WIDE = { viewport: { width: 960, height: 581 } };

const checks = [];
function check(name, ok, detail = "") {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "ok  " : "FAIL"} [${engine}] ${name}${detail ? ` — ${detail}` : ""}`);
}

let browser;
/** Where the credit stands against « Voir la carte » in the panel's foot (2026-10-17). */
const byline = (page) =>
  page.evaluate(() => {
    const go = document.querySelector("#welcome .welcome-foot > .welcome-go");
    const by = document.querySelector("#welcome .welcome-foot > .welcome-byline");
    const credit = by?.querySelector(".welcome-credit");
    if (!go || !credit) return { found: false };
    const g = go.getBoundingClientRect();
    const b = by.getBoundingClientRect();
    return {
      found: true,
      credit: credit.textContent,
      // 4 px: the button is tilted 1° (its box a little wider than it).
      right: b.left >= g.right - 4 && b.top < g.bottom && b.bottom > g.top,
      under: b.top >= g.bottom - 4 && Math.abs(b.left - g.left) <= 4,
      goWidth: Math.round(g.width),
      goHeight: Math.round(g.height),
    };
  });

/** A fresh device (no storage): a first visit. The API says « signed out ». `hits`: the
 * bodies of the page's POST /api/hit, in order (src/hit.ts), from before it loads. */
async function visit(options, { reduced = false, url = `${APP}?ui=punk${AT}`, init } = {}) {
  const context = await browser.newContext({
    ...options,
    locale: "fr-FR",
    colorScheme: "light",
    reducedMotion: reduced ? "reduce" : "no-preference",
  });
  if (init) await context.addInitScript(init);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const hits = [];
  page.on("request", (r) => {
    if (new URL(r.url()).pathname === "/api/hit") hits.push(r.postData());
  });
  await page.route("**/api/**", (r) =>
    r.fulfill({ status: 401, contentType: "application/json", body: '{"error":"no_session"}' }),
  );
  await page.goto(url);
  return { context, page, errors, hits };
}

const tap = async (page, locator) => {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw new Error("nothing to tap");
  if (await page.evaluate(() => matchMedia("(pointer: coarse)").matches))
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  else await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
};

/** The panel as the page shows it: dialog, focus, inert, what is in view. */
const state = (page) =>
  page.evaluate(() => {
    const d = document.querySelector("#welcome [role=dialog]");
    const r = (e) => e?.getBoundingClientRect();
    const go = r(document.querySelector(".welcome-go"));
    const close = r(document.querySelector(".welcome-close"));
    const title = document.querySelector(".welcome-title");
    const letters = [...(title?.querySelectorAll(".welcome-big, .welcome-world > span") ?? [])];
    return {
      open: Boolean(d),
      modal: d?.getAttribute("aria-modal"),
      name: d?.getAttribute("aria-label"),
      focusInside: Boolean(d?.contains(document.activeElement)),
      inert: ["map", "ticket", "sheet"].every((id) =>
        document.getElementById(id)?.closest("[inert]"),
      ),
      goInView: go
        ? go.top >= 0 && go.bottom <= innerHeight && go.left >= 0 && go.right <= innerWidth
        : false,
      titleRight: Math.round(Math.max(...letters.map((e) => e.getBoundingClientRect().right))),
      closeLeft: Math.round(close?.left ?? 0),
      text: d?.innerText ?? "",
      sprays: document.querySelectorAll("#welcome .popper-spray").length,
      cones: document.querySelectorAll("#welcome .popper:not(.popper-spray)").length,
      panelMoves: d ? d.getAnimations({ subtree: false }).length : -1,
      opacity: d ? getComputedStyle(d).opacity : "",
      sideways: document.documentElement.scrollWidth > innerWidth,
    };
  });

async function axe(page, where) {
  await page.addScriptTag({ path: AXE });
  const found = await page.evaluate(async () => {
    const body = document.querySelector(".welcome-body");
    const out = new Set();
    let passes = 0;
    const steps = Math.ceil(body.scrollHeight / body.clientHeight) + 1;
    for (let i = 0; i < steps; i++) {
      body.scrollTop = i * body.clientHeight;
      await new Promise((r) => setTimeout(r, 50));
      const r = await window.axe.run(document.querySelector("#welcome"), {
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
      });
      for (const v of r.violations)
        for (const n of v.nodes) out.add(`${v.id} ${n.target.join(" ")}`);
      passes += r.passes.flatMap((v) => v.nodes).length;
    }
    body.scrollTop = 0;
    return { violations: [...out], passes };
  });
  check(
    `${where}: axe WCAG 2.2 A/AA none in the panel (${found.passes} passes)`,
    found.violations.length === 0,
    found.violations.join(" | "),
  );
}

const server = spawn("npx", preview(PORT), { cwd: WEB, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 2500));
browser = await (engine === "chromium" ? chromium : webkit).launch();
try {
  // --- a first visit on a phone ---------------------------------------------------------
  {
    const { context, page, errors } = await visit(PHONE);
    await page.waitForSelector("#welcome [role=dialog]");
    const first = await state(page);
    check(
      "phone first visit: the panel over the map at once, a named modal dialog, the focus inside, the map, ticket and sheet inert, no entrance animation",
      first.open &&
        first.modal === "true" &&
        first.name === "Bienvenue sur Surveillance World" &&
        first.focusInside &&
        first.inert &&
        first.panelMoves === 0 &&
        first.opacity === "1" &&
        /Voir la carte/i.test(first.text),
      JSON.stringify({ ...first, text: first.text.length }),
    );
    check(
      "phone first visit: two poppers and their confetti (28a)",
      first.cones === 2 && first.sprays === 2,
      `${first.cones} cones, ${first.sprays} sprays`,
    );
    const text = first.text;
    check(
      "texts as corrected: « The most magical place on Earth », « Tu aimes être surveillé », Île-de-France, no « Rien n'est stocké », « Open source » kept",
      /the most magical place on earth/i.test(text) &&
        text.includes("Tu aimes être surveillé en permanence") &&
        text.includes("rejoins l'aventure <3") &&
        text.includes("Île-de-France, pour l'instant") &&
        !/Rien n'est stocké|identifiant OpenStreetMap|Uniquement en France|PASSIONÉ/i.test(text) &&
        text.includes("Open source"),
      text.slice(0, 160).replace(/\n/g, " / "),
    );
    // The credit above the legal links; the ticket on the paper in light, 28a's in dark
    // (2026-10-15), axe-core in dark too (its contrasts).
    const ink = (p) =>
      p.evaluate(() => {
        const c = document.querySelector("#welcome .welcome-credit");
        return {
          credit: c?.textContent ?? null,
          shoutLang: document.querySelector("#welcome .welcome-shout")?.lang ?? null,
          inFoot: c?.parentElement?.parentElement?.classList.contains("welcome-foot") ?? false,
          paper: getComputedStyle(document.querySelector("#welcome .welcome-paper"))
            .backgroundColor,
        };
      });
    const light = await ink(page);
    const night = await visit(PHONE, { url: `${APP}?ui=punk&mode=sombre${AT}` });
    await night.page.waitForSelector("#welcome [role=dialog]");
    await night.page.evaluate(() => document.fonts.ready);
    const dark = await ink(night.page);
    const phoneBy = await byline(page);
    check(
      "phone 390: the credit under « Voir la carte », from its left, the button 52 px high",
      phoneBy.found && phoneBy.under && phoneBy.goHeight >= 52,
      JSON.stringify(phoneBy),
    );
    check(
      "« imaginé par lagayayuya » in the foot by « Voir la carte » (2026-10-17); the English title said as English; the ticket on the paper in light (#f2efe6), 28a's dark in dark (#1c1a1f)",
      light.credit === "imaginé par lagayayuya" &&
        light.shoutLang === "en" &&
        light.inFoot &&
        light.paper === "rgb(242, 239, 230)" &&
        dark.credit === "imaginé par lagayayuya" &&
        dark.paper === "rgb(28, 26, 31)",
      JSON.stringify({ light, dark }),
    );
    await axe(night.page, "phone, dark");
    await night.context.close();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(2300);
    const later = await state(page);
    check(
      "phone 390: « Voir la carte » in view, the title left of the ×, no sideways scroll; the confetti gone after 2.1 s",
      later.goInView &&
        later.titleRight <= later.closeLeft &&
        !later.sideways &&
        later.sprays === 0,
      JSON.stringify({
        go: later.goInView,
        title: later.titleRight,
        close: later.closeLeft,
        sprays: later.sprays,
      }),
    );
    // « Questions fréquentes » not shown (2026-10-14): neither its heading nor a question.
    const faq = await page.evaluate(() => ({
      section: Boolean(document.querySelector("#welcome .welcome-faq")),
      asks: document.querySelectorAll("#welcome .welcome-ask").length,
      said: /questions fréquentes/i.test(document.querySelector("#welcome")?.textContent ?? ""),
    }));
    check(
      "no « Questions fréquentes »: no heading, no question",
      !faq.section && faq.asks === 0 && !faq.said,
      JSON.stringify(faq),
    );
    await axe(page, "phone");
    // A tap inside the panel keeps it; the backdrop's closes it.
    await tap(page, page.locator(".welcome-pitch"));
    const kept = (await state(page)).open;
    await page.touchscreen.tap(195, 838);
    await page.waitForTimeout(100);
    // A second later nothing of the « ? » moves (its press has ended).
    await page.waitForTimeout(1000);
    const after = await page.evaluate(() => ({
      open: Boolean(document.querySelector("#welcome")),
      focus: document.activeElement?.id,
      moving: (() => {
        const sq = document.getElementById("welcome-square");
        const named = [sq, ...sq.querySelectorAll("*")]
          .map((e) => getComputedStyle(e).animationName)
          .filter((n) => n !== "none");
        return [...named, ...sq.getAnimations({ subtree: true }).map((a) => a.constructor.name)];
      })(),
      inert: Boolean(document.querySelector("[inert]")),
      kept: (() => {
        const keys = Object.keys(localStorage);
        return keys.filter((k) => k.startsWith("lacarte.welcome")).map((k) => [k, localStorage[k]]);
      })(),
    }));
    check(
      "a tap inside keeps the panel, a tap outside closes it: the focus on the « ? », nothing on it animated (no pulse), nothing inert",
      kept &&
        !after.open &&
        after.focus === "welcome-square" &&
        after.moving.length === 0 &&
        !after.inert,
      JSON.stringify(after),
    );
    check(
      "the visit kept on the device: one key, « 1 », nothing personal",
      JSON.stringify(after.kept) === JSON.stringify([["lacarte.welcome", "1"]]),
      JSON.stringify(after.kept),
    );
    // The « ? » opens it again, without poppers; Escape closes it (and only it).
    await tap(page, page.locator("#welcome-square"));
    await page.waitForSelector("#welcome [role=dialog]");
    const again = await state(page);
    await page.keyboard.press("Escape");
    const esc = await page.evaluate(() => ({
      open: Boolean(document.querySelector("#welcome")),
      focus: document.activeElement?.id,
      expanded: document.querySelector("#welcome-square").getAttribute("aria-expanded"),
    }));
    check(
      "the « ? » opens it again without poppers; Escape closes it, the focus back on the « ? »",
      again.open &&
        again.cones === 0 &&
        again.sprays === 0 &&
        !esc.open &&
        esc.focus === "welcome-square" &&
        esc.expanded === "false",
      JSON.stringify({ cones: again.cones, sprays: again.sprays, esc }),
    );
    // × and « Voir la carte » close it too.
    for (const sel of [".welcome-close", ".welcome-go"]) {
      await tap(page, page.locator("#welcome-square"));
      await page.waitForSelector("#welcome [role=dialog]");
      await tap(page, page.locator(sel));
      check(`« ${sel} » closes the panel`, !(await state(page)).open);
    }
    await page.reload();
    await page.waitForFunction(() => window.__map?.loaded());
    check("reloaded: the panel does not come back by itself", !(await state(page)).open);
    check("phone: no page error", errors.length === 0, errors.join(" | "));
    await context.close();
  }
  // --- the « ? » as its neighbours: at rest, hovered, pressed, focused --------------------
  {
    const { context, page } = await visit(WIDE, {
      init: () => localStorage.setItem("lacarte.welcome", "1"),
    });
    await page.waitForFunction(() => window.__map?.loaded(), null, { timeout: 30000 });
    await page.waitForSelector("#account-square");
    const SQUARES = ["#mode-toggle", "#account-square", "#welcome-square"];
    // What a state may change of a square (its own tilt aside: 28a tilts each its way).
    const look = (sel) =>
      page.evaluate((s) => {
        const e = document.querySelector(s);
        const c = getComputedStyle(e);
        return {
          background: c.backgroundColor,
          shadow: c.boxShadow,
          translate: c.translate,
          scale: c.scale,
          outline: `${c.outlineStyle} ${c.outlineWidth} ${c.outlineColor} ${c.outlineOffset}`,
          border: `${c.borderStyle} ${c.borderWidth} ${c.borderColor}`,
          animation: c.animationName,
          transition: c.transitionProperty,
          moving: e.getAnimations({ subtree: true }).filter((a) => !(a instanceof CSSTransition))
            .length,
        };
      }, sel);
    const states = {};
    for (const sel of SQUARES) {
      const box = await page.locator(sel).boundingBox();
      const at = [box.x + box.width / 2, box.y + box.height / 2];
      await page.mouse.move(5, 300);
      await page.waitForTimeout(400);
      const rest = await look(sel);
      await page.mouse.move(...at);
      await page.waitForTimeout(400);
      const hover = await look(sel);
      // Pressed, then released elsewhere: no click (the mode, the sheet, the panel stay).
      await page.mouse.down();
      await page.waitForTimeout(400);
      const press = await look(sel);
      await page.mouse.move(5, 300);
      await page.mouse.up();
      await page.waitForTimeout(400);
      // A keyboard focus: a key pressed, then the square focused (WebKit's Tab skips
      // buttons, as macOS does by default), so that the browser shows it.
      await page.keyboard.press("Tab");
      await page.evaluate((s) => document.querySelector(s).focus(), sel);
      await page.waitForTimeout(400);
      const focus = {
        ...(await look(sel)),
        visible: await page.evaluate(
          (s) => document.querySelector(s).matches(":focus-visible"),
          sel,
        ),
      };
      await page.evaluate(() => document.activeElement?.blur());
      states[sel] = { rest, hover, press, focus };
    }
    const q = states["#welcome-square"];
    const same = SQUARES.slice(0, 2).every(
      (sel) => JSON.stringify(states[sel]) === JSON.stringify(q),
    );
    check(
      "the « ? »: at rest, hovered, pressed and focused as the sun / moon and the account's squares (tilt aside), nothing animated",
      same && q.rest.animation === "none" && q.rest.moving === 0 && q.focus.visible,
      JSON.stringify(states),
    );
    check(
      "the « ? » pressed sinks onto its shadow, focused shows the dashed outline",
      q.press.translate !== q.rest.translate &&
        q.press.shadow !== q.rest.shadow &&
        q.focus.outline.startsWith("dashed"),
      JSON.stringify({ rest: q.rest, press: q.press, focus: q.focus.outline }),
    );
    await context.close();
  }
  // --- 320 px wide --------------------------------------------------------------------
  {
    const { context, page } = await visit(NARROW);
    await page.waitForSelector("#welcome [role=dialog]");
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);
    const s = await state(page);
    check(
      "phone 320: « Voir la carte » in view, the title left of the ×, no sideways scroll",
      s.goInView && s.titleRight <= s.closeLeft && !s.sideways,
      JSON.stringify({
        go: s.goInView,
        title: s.titleRight,
        close: s.closeLeft,
        sideways: s.sideways,
      }),
    );
    await context.close();
  }
  // --- reduced motion -------------------------------------------------------------------
  {
    const { context, page } = await visit(PHONE, { reduced: true });
    await page.waitForSelector("#welcome [role=dialog]");
    const s = await state(page);
    const moving = await page.evaluate(
      () => document.querySelector("#welcome").getAnimations({ subtree: true }).length,
    );
    check(
      "reduced motion: the two cones still, no confetti, nothing animated",
      s.open && s.cones === 2 && s.sprays === 0 && moving === 0,
      JSON.stringify({ cones: s.cones, sprays: s.sprays, moving }),
    );
    await context.close();
  }
  // --- no storage (a private window that refuses it) ------------------------------------
  {
    const { context, page, errors } = await visit(PHONE, {
      init: () => {
        const no = () => {
          throw new DOMException("denied", "SecurityError");
        };
        Storage.prototype.getItem = no;
        Storage.prototype.setItem = no;
      },
    });
    await page.waitForSelector("#welcome [role=dialog]");
    await tap(page, page.locator(".welcome-go"));
    const closed = !(await state(page)).open;
    await page.waitForFunction(() => window.__map?.loaded(), null, { timeout: 15000 });
    check(
      "no storage: the panel shows and closes, the map works, no page error",
      closed && errors.length === 0,
      errors.join(" | "),
    );
    await context.close();
  }
  // --- a wide screen, a return from OpenStreetMap, the classique ------------------------
  {
    const { context, page } = await visit(WIDE);
    await page.waitForSelector("#welcome [role=dialog]");
    await page.evaluate(() => document.fonts.ready);
    const s = await state(page);
    check(
      "wide 960 × 581: the panel, « Voir la carte » in view, the title left of the ×",
      s.open && s.goInView && s.titleRight <= s.closeLeft,
      JSON.stringify({ go: s.goInView, title: s.titleRight, close: s.closeLeft }),
    );
    const wideBy = await byline(page);
    check(
      "wide 960: the credit right of « Voir la carte », on its line",
      wideBy.found && wideBy.right && wideBy.goHeight >= 52,
      JSON.stringify(wideBy),
    );
    await axe(page, "wide");
    await page.mouse.click(10, 300);
    check("wide: a click outside the panel closes it", !(await state(page)).open);
    await context.close();
  }
  {
    const { context, page } = await visit(PHONE, { url: `${APP}?ui=punk&osm=denied${AT}` });
    await page.waitForFunction(() => window.__map?.loaded(), null, { timeout: 15000 });
    check(
      "back from OpenStreetMap (?osm=): no welcome over the account's sheet",
      !(await state(page)).open,
    );
    await context.close();
  }
  {
    const { context, page } = await visit(PHONE, { url: `${APP}?ui=classique${AT}` });
    await page.waitForFunction(() => window.__map?.loaded(), null, { timeout: 15000 });
    const none = await page.evaluate(
      () => !document.querySelector("#welcome, #welcome-square, .popper"),
    );
    check("classique: no welcome panel, no « ? »", none);
    await context.close();
  }

  // --- the site's counters (src/hit.ts, lot 4 of /revue): POST /api/hit -------------------
  /** A first visit (the panel open), closed by ×, then the « ? » opening it again. */
  const welcomeTwice = async (page) => {
    await page.waitForSelector("#welcome [role=dialog]");
    await page.waitForFunction(() => window.__map?.loaded(), null, { timeout: 15000 });
    await tap(page, page.locator(".welcome-close"));
    await tap(page, page.locator("#welcome-square"));
    await page.waitForSelector("#welcome [role=dialog]");
    await page.waitForTimeout(500);
  };
  for (const ui of ["punk", "classique"]) {
    // A browser driven by a script (the benches: navigator.webdriver) sends nothing.
    const { context, page, hits: sent } = await visit(PHONE, { url: `${APP}?ui=${ui}${AT}` });
    const driven = await page.evaluate(() => navigator.webdriver === true);
    if (ui === "punk") await welcomeTwice(page);
    else await page.waitForFunction(() => window.__map?.loaded(), null, { timeout: 15000 });
    await page.waitForTimeout(500);
    check(
      `${ui}, navigator.webdriver true: no POST /api/hit (the map, two welcomes)`,
      driven && sent.length === 0,
      `webdriver ${driven}, sent ${JSON.stringify(sent)}`,
    );
    await context.close();
  }
  for (const ui of ["punk", "classique"]) {
    // The same page as a person's browser (webdriver said false): the map once, whatever the
    // interface, and in punk a welcome each time the panel shows.
    const {
      context,
      page,
      hits: sent,
    } = await visit(PHONE, {
      url: `${APP}?ui=${ui}${AT}`,
      init: () => Object.defineProperty(Navigator.prototype, "webdriver", { get: () => false }),
    });
    if (ui === "punk") await welcomeTwice(page);
    else await page.waitForFunction(() => window.__map?.loaded(), null, { timeout: 15000 });
    await page.waitForTimeout(500);
    const map = sent.filter((b) => b === '{"event":"map"}').length;
    const welcome = sent.filter((b) => b === '{"event":"welcome"}').length;
    const want = ui === "punk" ? 2 : 0;
    check(
      `${ui}, webdriver false: the map's hit once, ${want} welcome hits, nothing else`,
      map === 1 && welcome === want && sent.length === 1 + want,
      JSON.stringify(sent),
    );
    await context.close();
  }
} catch (e) {
  check("the run", false, String(e).split("\n")[0]);
} finally {
  await browser.close();
  server.kill();
}
const failed = checks.filter((c) => !c.ok);
console.log(`${checks.length - failed.length} ok, ${failed.length} FAIL`);
process.exit(failed.length ? 1 : 0);
