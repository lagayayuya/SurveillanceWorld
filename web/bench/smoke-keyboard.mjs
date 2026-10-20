// Smoke test of a phone's keyboard over the panels' fields (the author's request of
// 2026-10-11, point 4; src/keyboard.ts, bottomsheet.ts), in WebKit at a phone's size
// (390 × 845, punk), on the production build of the CI extract, the API answered by the
// page (bench/account.mjs mockApi, bench/profile-mock.mjs mockProfile). WebKit headless has
// no software keyboard: each field is focused, then the keyboard is played two ways —
//   resize  the viewport shrinks to 509 px (what an iPhone's 336 px keyboard leaves), as a
//           browser that resizes its layout viewport does;
//   overlay the layout viewport stays 845 px and `visualViewport` says 509 px (its
//           `height` redefined, its `resize` dispatched), as iOS Safari does;
// and in both the field and its form's submit button must lie whole in the visible part
// (under the phone sheet's pinned head), and the sheet must end above the keyboard; by
// overlay, the keyboard coming, then the field let go (a tap outside) and the keyboard
// leaving after it, the sheet's top, read at every frame, goes straight from where it was to
// where it ends, never past either (the author's point 3 of 2026-10-15). Only a
// real iPhone shows the real keyboard (its height, the accessory bar, Safari's own scroll).
// Fields: the password form (?compte=motdepasse), the pseudonym's choice after a first OSM
// sign-in, the account screen's « Changer le mot de passe », « Supprimer mon compte »,
// « Relier à OpenStreetMap », « Publier aussi sur OpenStreetMap en mon nom » (passwords),
// and the filters' operator (the machine; no submit button). Then no pinch-zoom of the
// interface (point 7; src/gestures.ts, theme/punk/base.css): every panel, sheet, ticket and
// button container says `touch-action: pan-x pan-y` (or less: `pan-y`, `none`), the map's
// canvas MapLibre's `none`; a `gesturestart` / `gesturechange` (WebKit's own) is cancelled on
// them and not on the map; Safari's text size stays free (no `maximum-scale`, no
// `user-scalable`, `-webkit-text-size-adjust` not `none`). Headless WebKit has no pinch:
// only a real iPhone shows that two fingers on a panel no longer zoom the page.
// Exits non-zero if a check failed.
//   node bench/smoke-keyboard.mjs [--port N]
import { spawn } from "node:child_process";
import { webkit } from "playwright";
import { mockApi, OSM_SIGNUP } from "./account.mjs";
import { preview, requireTiles, WEB } from "./dist.mjs";
import { mockProfile, SYNC } from "./profile-mock.mjs";
import { returning } from "./ui.mjs";

const args = process.argv.slice(2);
const arg = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
requireTiles("ci");
const PORT = Number(arg("--port", "4195"));
const APP = `http://localhost:${PORT}/`;
const AT = "#17.6/48.8977/2.2377";
const PHONE = {
  viewport: { width: 390, height: 845 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  locale: "fr-FR",
};
const KEYBOARD = 336; // an iPhone 14's keyboard with its suggestions bar, in CSS px
const LEFT = PHONE.viewport.height - KEYBOARD;

const checks = [];
function check(name, ok, detail = "") {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "ok  " : "FAIL"} [webkit] ${name}${detail ? ` — ${detail}` : ""}`);
}

/** Signed out, sign-in with OpenStreetMap on (its signup waiting for `?osm=signup`). */
const visitor = (url, ready) => async (context) => {
  await mockApi(context, { osm: { login: true, server: "dev", signup: { ...OSM_SIGNUP } } });
  const page = await context.newPage();
  await page.goto(`${APP}?ui=punk${url}${AT}`);
  await page.waitForFunction(() => window.__map?.loaded(), null, { timeout: 60_000 });
  await page.waitForSelector(ready, { timeout: 30_000 });
  return page;
};
/** Signed in, the account's screen open, then `open` tapped (a link that unfolds a form). */
const signed = (opts, open, ready) => async (context) => {
  await mockProfile(context, opts);
  const page = await context.newPage();
  await page.goto(`${APP}?ui=punk&mode=clair${AT}`);
  await page.waitForFunction(() => window.__map?.loaded(), null, { timeout: 60_000 });
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: "Votre profil" }).first().tap();
  await page.waitForSelector("#sheet .board-paper .board-place", { timeout: 15_000 });
  if (open) {
    await page.locator(open).scrollIntoViewIfNeeded();
    await page.locator(open).tap();
  }
  await page.waitForSelector(ready, { state: "visible", timeout: 15_000 });
  return page;
};

const CASES = [
  {
    name: "« Entrer », the password (?compte=motdepasse)",
    open: visitor("&compte=motdepasse", '#sheet [data-account="form"]'),
    field: "#account-password",
    submit: "#sheet .account-submit",
  },
  {
    name: "« Choisissez votre pseudonyme » (?osm=signup)",
    open: visitor("&osm=signup", '#sheet [data-account="signup"]'),
    field: "#account-signup-pseudonym",
    submit: "#sheet .account-submit",
  },
  {
    name: "« Changer le mot de passe », the new one",
    open: signed(
      { account: { password: true } },
      "#sheet .board-password",
      "#board-password-form:not([hidden])",
    ),
    field: '#board-password-form input[autocomplete="new-password"]',
    submit: '#board-password-form button[type="submit"]',
  },
  {
    name: "« Supprimer mon compte », the password",
    open: signed(
      { account: { password: true } },
      "#sheet .board-delete",
      "#board-delete-form:not([hidden])",
    ),
    field: "#board-delete-form input",
    submit: '#board-delete-form button[type="submit"]',
  },
  {
    name: "« Relier à OpenStreetMap », the password",
    open: signed(
      { account: { osm: false, password: true }, osmLogin: true },
      "#sheet .board-osm-link",
      "#board-osm-link-form:not([hidden])",
    ),
    field: "#board-osm-link-form input",
    submit: '#board-osm-link-form button[type="submit"]',
  },
  {
    name: "« Publier aussi sur OpenStreetMap en mon nom », the password",
    open: signed(
      { account: { osm: true, password: true }, sync: SYNC },
      "#sheet .board-sync-choice:has(#board-sync-publish)",
      "#board-sync-enable:not([hidden])",
    ),
    field: '#board-sync-enable input[type="password"]',
    submit: '#board-sync-enable button[type="submit"]',
  },
  {
    name: "the filters' operator (the machine)",
    open: async (context) => {
      await mockApi(context, {});
      const page = await context.newPage();
      await page.goto(`${APP}?ui=punk&op=V${AT}`);
      await page.waitForFunction(() => window.__map?.loaded(), null, { timeout: 60_000 });
      await page.locator("#fab-filters").tap();
      await page.waitForSelector("#adv-operator", { state: "attached", timeout: 15_000 });
      return page;
    },
    field: "#adv-operator",
    submit: null,
  },
];

/** The sheet's top at every frame from now on (null while hidden), until `seen` reads it. */
const watch = (page) =>
  page.evaluate(() => {
    const tops = [];
    window.__tops = tops;
    const sheet = document.getElementById("sheet");
    const tick = () => {
      if (window.__tops !== tops) return;
      tops.push(sheet.hidden ? null : Math.round(sheet.getBoundingClientRect().top));
      requestAnimationFrame(tick);
    };
    tick();
  });
const seen = (page) =>
  page.evaluate(() => {
    const tops = window.__tops;
    window.__tops = null;
    return tops;
  });

/** The sheet's top went from where it was to where it ends without passing either: a lift
 * set at once under a height that eases throws it off the screen and back (the author's
 * point 3 of 2026-10-15), a lift dropped while the keyboard is still there sinks it
 * behind the keyboard. */
const straight = (tops) => {
  const t = tops.filter((v) => v !== null);
  if (t.length < 2) return true;
  const lo = Math.min(t[0], t.at(-1)) - 2;
  const hi = Math.max(t[0], t.at(-1)) + 2;
  return t.every((v) => v >= lo && v <= hi);
};
const span = (tops) => {
  const t = tops.filter((v) => v !== null);
  return t.length
    ? `from ${t[0]} to ${t.at(-1)}, between ${Math.min(...t)} and ${Math.max(...t)} (${t.length} frames)`
    : "sheet hidden";
};

/** Where the field, its key, the sheet and the visible part are, after the keyboard. */
const measure = (page, c) =>
  page.evaluate(
    ([field, submit]) => {
      const box = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { top: Math.round(r.top), bottom: Math.round(r.bottom) };
      };
      const vv = window.visualViewport;
      const head = document.querySelector("#sheet .sheet-head");
      const pinned = head && getComputedStyle(head).position === "absolute";
      const sheet = document.getElementById("sheet");
      return {
        band: [Math.round(vv.offsetTop), Math.round(vv.offsetTop + vv.height)],
        head: pinned && sheet.contains(document.querySelector(field)) ? box(head) : null,
        field: box(document.querySelector(field)),
        submit: box(submit ? document.querySelector(submit) : null),
        sheet: sheet.hidden ? null : box(sheet),
        focused: document.activeElement === document.querySelector(field),
        keyboard: document.documentElement.dataset.keyboard ?? null,
      };
    },
    [c.field, c.submit],
  );

const inside = (m) => {
  const top = Math.max(m.band[0], m.head?.bottom ?? -Infinity);
  const whole = (b) => b && b.top >= top - 1 && b.bottom <= m.band[1] + 1;
  return (
    m.focused &&
    whole(m.field) &&
    (m.submit === null || whole(m.submit)) &&
    (m.sheet === null || !m.sheet || m.sheet.bottom <= m.band[1] + 1)
  );
};

/** Point 7, on a camera sheet then the filters machine open. */
async function gestures() {
  const context = await browser.newContext(PHONE);
  try {
    await mockApi(context, {});
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(`${APP}?ui=punk${AT}`);
    await page.waitForFunction(() => window.__map?.loaded(), null, { timeout: 60_000 });
    const id = await page.evaluate(
      () =>
        window.__map
          .querySourceFeatures("detail", { sourceLayer: "cameras" })
          .map((c) => String(c.properties.id))
          .find((c) => /^[nwr]\d+$/.test(c)) ?? null,
    );
    await page.goto(`${APP}?ui=punk&cam=${id}${AT}`);
    await page.waitForSelector("#sheet #part-modify", { timeout: 30_000 });
    const read = () =>
      page.evaluate(() => {
        const ta = (sel) => {
          const el = document.querySelector(sel);
          return el ? getComputedStyle(el).touchAction : null;
        };
        const cancelled = (sel) => {
          const el = document.querySelector(sel);
          if (!el) return null;
          return ["gesturestart", "gesturechange"].map((type) => {
            const e = new Event(type, { bubbles: true, cancelable: true });
            el.dispatchEvent(e);
            return e.defaultPrevented;
          });
        };
        const panels = [
          "#estimate",
          "#ticket",
          "#fabs",
          "#sheet",
          "#filters",
          "#queue-count",
          ".maplibregl-ctrl",
        ];
        const meta = document.querySelector('meta[name="viewport"]')?.getAttribute("content");
        const html = getComputedStyle(document.documentElement);
        return {
          panels: Object.fromEntries(panels.map((p) => [p, ta(p)])),
          canvas: ta(".maplibregl-canvas-container"),
          onPanels: Object.fromEntries(
            ["#sheet .part-verify", "#ticket", "#fab-locate", "#sheet .sheet-body"].map((p) => [
              p,
              cancelled(p),
            ]),
          ),
          onMap: cancelled(".maplibregl-canvas"),
          meta,
          adjust: html.webkitTextSizeAdjust ?? html.textSizeAdjust ?? "",
        };
      });
    const m = await read();
    const allowed = new Set(["pan-x pan-y", "pan-y", "none"]);
    check(
      "pinch: every panel, sheet, ticket and button container pan-x pan-y (or less), the map's canvas MapLibre's none",
      Object.values(m.panels).every((v) => allowed.has(v)) && m.canvas === "none",
      JSON.stringify({ panels: m.panels, canvas: m.canvas }),
    );
    check(
      "pinch: gesturestart / gesturechange cancelled on the sheet, the ticket, a button; not on the map",
      Object.values(m.onPanels).every((v) => v?.every(Boolean)) &&
        m.onMap?.every((v) => v === false),
      JSON.stringify({ onPanels: m.onPanels, onMap: m.onMap }),
    );
    check(
      "Safari's text size stays free: no maximum-scale nor user-scalable, -webkit-text-size-adjust not none",
      m.meta && !/maximum-scale|user-scalable/.test(m.meta) && m.adjust !== "none",
      JSON.stringify({ meta: m.meta, adjust: m.adjust }),
    );
    // The machine open: its own panel, and the map still free beside it.
    await page.locator("#sheet .sheet-head .close").tap();
    await page.locator("#fab-filters").tap();
    await page.waitForSelector("#filters .panel-close", { state: "visible", timeout: 15_000 });
    const open = await page.evaluate(() => {
      const el = document.querySelector("#filters");
      const e = new Event("gesturestart", { bubbles: true, cancelable: true });
      el.querySelector("button, label, input")?.dispatchEvent(e);
      return { ta: getComputedStyle(el).touchAction, cancelled: e.defaultPrevented };
    });
    check(
      "pinch: the filters machine open, pan-x pan-y and its gestures cancelled",
      open.ta === "pan-x pan-y" && open.cancelled,
      JSON.stringify(open),
    );
    // The classique is frozen: its panels keep the page's pinch-zoom (no gesture cancelled,
    // touch-action untouched) and no keyboard handling (review finding, 2026-10-11).
    await page.goto(`${APP}?ui=classique${AT}`);
    await page.waitForFunction(() => window.__map?.loaded(), null, { timeout: 60_000 });
    const classique = await page.evaluate(() =>
      ["#sheet", "#filters", "#fabs"]
        .map((sel) => document.querySelector(sel))
        .filter(Boolean)
        .map((el) => {
          const e = new Event("gesturestart", { bubbles: true, cancelable: true });
          el.dispatchEvent(e);
          return { id: el.id, ta: getComputedStyle(el).touchAction, cancelled: e.defaultPrevented };
        }),
    );
    check(
      "classique: no gesture cancelled on its panels, touch-action auto (its pinch-zoom kept)",
      classique.length > 0 && classique.every((c) => !c.cancelled && c.ta === "auto"),
      JSON.stringify(classique),
    );
  } catch (e) {
    check("pinch", false, String(e).split("\n")[0]);
  } finally {
    await context.close();
  }
}

const server = spawn("npx", preview(PORT), { cwd: WEB, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 2500));
const browser = returning(await webkit.launch());
const errors = [];
try {
  for (const c of CASES) {
    for (const how of ["resize", "overlay"]) {
      const context = await browser.newContext(PHONE);
      try {
        const page = await c.open(context);
        page.on("pageerror", (e) => errors.push(String(e)));
        const field = page.locator(c.field);
        await field.focus();
        // The page scrolled to the top of its form, as when the person taps the field.
        await page.waitForTimeout(300);
        if (how === "resize") {
          await page.setViewportSize({ width: PHONE.viewport.width, height: LEFT });
        } else {
          await watch(page);
          await page.evaluate((left) => {
            const vv = window.visualViewport;
            Object.defineProperty(vv, "height", { configurable: true, get: () => left });
            vv.dispatchEvent(new Event("resize"));
          }, LEFT);
        }
        await page.waitForTimeout(700);
        const m = await measure(page, c);
        check(
          `${c.name}, keyboard by ${how}: the field${c.submit ? " and its key" : ""} whole above the keyboard${how === "overlay" ? ", the sheet standing on it" : ""}`,
          inside(m) && (how === "resize" || m.keyboard === "open"),
          JSON.stringify(m),
        );
        if (how === "overlay") {
          const up = await seen(page);
          check(
            `${c.name}: the keyboard coming, the sheet's top straight to its place, never thrown past it`,
            straight(up),
            span(up),
          );
          // The keyboard goes as on a phone: a tap outside lets the field go first, the
          // keyboard leaves after; the sheet back down, nothing left scrolled.
          await watch(page);
          await page.evaluate(() => document.activeElement?.blur());
          await page.waitForTimeout(150);
          await page.evaluate((h) => {
            const vv = window.visualViewport;
            Object.defineProperty(vv, "height", { configurable: true, get: () => h });
            vv.dispatchEvent(new Event("resize"));
          }, PHONE.viewport.height);
          await page.waitForTimeout(500);
          const down = await seen(page);
          check(
            `${c.name}: the field let go, then the keyboard gone, the sheet's top straight to its place, never sunk behind the keyboard`,
            straight(down),
            span(down),
          );
          const after = await page.evaluate(() => ({
            keyboard: document.documentElement.dataset.keyboard ?? null,
            margin: document.getElementById("sheet").style.marginBottom,
            scroll: window.scrollY,
          }));
          check(
            `${c.name}: the keyboard gone, the sheet down again, the page not scrolled`,
            after.keyboard === null && after.margin === "" && after.scroll === 0,
            JSON.stringify(after),
          );
        }
      } catch (e) {
        check(`${c.name}, keyboard by ${how}`, false, String(e).split("\n")[0]);
      } finally {
        await context.close();
      }
    }
  }
  await gestures();
  check("keyboard and gestures: no page errors", errors.length === 0, errors.join(" | "));
} finally {
  await browser.close();
  server.kill();
}
const failed = checks.filter((c) => !c.ok).length;
console.log(`${checks.length - failed} ok, ${failed} FAIL`);
process.exit(failed ? 1 : 0);
