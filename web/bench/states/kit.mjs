// The gestures a state needs, the same on a phone (WebKit, real taps) and a wide screen
// (Chromium, clicks): open a URL and wait for the map at rest, tap, slide the map, open the
// sheet in full; on a wide screen a hover or a press held for the capture; the keyboard
// focus.
import { APP } from "./harness.mjs";

export function kit(page, context, combo) {
  let loads = 0;
  const phone = combo.device === "phone";

  /** The map at rest, its tiles in, the fonts loaded. */
  async function idle(ms = 300) {
    await page.waitForFunction(() => window.__map?.loaded(), null, { timeout: 60000 });
    await page.evaluate(
      () =>
        new Promise((r) => {
          window.__map.once("idle", r);
          window.__map.triggerRepaint();
          setTimeout(r, 5000);
        }),
    );
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await page.waitForTimeout(ms);
  }

  /** `target`: "[path][?query][#hash]". A query that changes each time: a new hash alone
   * does not load the page again (main.ts reads it once). */
  async function open(target = "", { sheet = false, map = true } = {}) {
    const [beforeHash, hash = ""] = target.split("#");
    const [path, query = ""] = beforeHash.split("?");
    const q = new URLSearchParams(query);
    q.set("load", String(++loads));
    await page.goto(`${APP}${path}?${q}${hash ? `#${hash}` : ""}`);
    if (!map) {
      await page.waitForLoadState("networkidle").catch(() => {});
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      await page.waitForTimeout(500);
      return;
    }
    await idle();
    if (sheet) {
      await page.waitForFunction(() => !document.getElementById("sheet").hidden, null, {
        timeout: 30000,
      });
      // The fit to the camera's field (easeTo), then its tiles.
      await page.waitForTimeout(900);
      await idle(500);
    }
  }

  /** A real tap on a phone, a click on a wide screen; `force` for aria-disabled buttons. */
  async function tap(target) {
    const locator = typeof target === "string" ? page.locator(target).first() : target;
    await locator.scrollIntoViewIfNeeded();
    if (!phone) {
      await locator.click({ force: true });
      return;
    }
    const b = await locator.boundingBox();
    await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
  }

  /** Wide screen: the mouse resting over an element (its :hover), long enough for the punk
   * buttons' spring (300 ms) to settle. A phone has no hover. */
  async function hover(target, ms = 700) {
    const locator = typeof target === "string" ? page.locator(target).first() : target;
    await locator.scrollIntoViewIfNeeded();
    const b = await locator.boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.waitForTimeout(ms);
  }

  /** Wide screen: the mouse button held down over an element (its :active) for the
   * capture, never released, as bench/smoke-theme.mjs holds the press it measures. A
   * phone's touch cannot be held (Playwright's touchscreen only taps). */
  async function hold(target, ms = 500) {
    await hover(target, 100);
    await page.mouse.down();
    await page.waitForTimeout(ms);
  }

  /** The keyboard focus on `selector`, reached as a keyboard user does, so that
   * :focus-visible shows: Tab, or Option+Tab in WebKit, which moves to buttons only so,
   * as Safari (bench/smoke-theme.mjs); at most `max` presses. */
  async function keyFocus(selector, max = 150) {
    const key = phone ? "Alt+Tab" : "Tab";
    for (let i = 0; i < max; i++) {
      await page.keyboard.press(key);
      if (await page.evaluate((s) => document.activeElement?.matches(s) ?? false, selector)) {
        await page.waitForTimeout(400);
        return;
      }
    }
    throw new Error(`${selector}: not focused after ${max} × ${key}`);
  }

  /** Tap the map at a point (lon, lat). */
  async function tapAt(lngLat) {
    const p = await page.evaluate((ll) => {
      const m = window.__map;
      const q = m.project(ll);
      const r = m.getCanvas().getBoundingClientRect();
      return { x: r.left + q.x, y: r.top + q.y };
    }, lngLat);
    if (phone) await page.touchscreen.tap(p.x, p.y);
    else await page.mouse.click(p.x, p.y);
  }

  /** The map moved by the app's own means (what a finger's slide ends with): move and
   * add modes listen to "move" and draw the pin, then ask the server at rest. */
  async function jump(options, ms = 1500) {
    await page.evaluate((o) => window.__map.jumpTo(o), options);
    await page.waitForTimeout(ms);
  }

  /** A one-finger drag of the map (the mouse: MapLibre pans on it in both engines). */
  async function drag(dx, dy) {
    const box = await page.locator("#map").boundingBox();
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 3;
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(x + (dx * i) / 10, y + (dy * i) / 10);
    await page.mouse.up();
    await page.waitForTimeout(600);
  }

  /** Phone: the sheet at its full height (the handle steps peek -> half -> full). */
  async function fullSheet() {
    if (!phone) return;
    for (let i = 0; i < 3; i++) {
      if ((await page.evaluate(() => document.body.dataset.sheet)) === "full") break;
      await tap(".sheet-grab");
      await page.waitForTimeout(400);
    }
    await page.waitForTimeout(400);
  }

  /** Bring an element into the middle of its scrolling panel. On the map's page the
   * document itself never scrolls (a finger cannot move it), but scrollIntoView does:
   * put it back, or the whole page is captured shifted up. */
  async function show(selector) {
    await page
      .locator(selector)
      .first()
      .evaluate((e) => {
        e.scrollIntoView({ block: "center" });
        if (document.getElementById("map")) {
          window.scrollTo(0, 0);
          document.documentElement.scrollTop = 0;
          document.body.scrollTop = 0;
        }
      });
    await page.waitForTimeout(300);
  }

  /** The free part of the map (not under the panels, the sheet, the estimate bar). */
  async function freeArea() {
    return page.evaluate((isPhone) => {
      const box = (id) => {
        const e = document.getElementById(id);
        // offsetParent is null for a fixed element: the phone's sheet is one.
        return e && !e.hidden && getComputedStyle(e).display !== "none"
          ? e.getBoundingClientRect()
          : null;
      };
      const sheet = box("sheet");
      const filters = box("filters");
      const top = box("estimate")?.bottom ?? 0;
      return isPhone
        ? { left: 0, right: innerWidth, top, bottom: sheet ? sheet.top : innerHeight }
        : {
            left: filters ? filters.right : 0,
            right: sheet ? sheet.left : innerWidth,
            top,
            bottom: innerHeight,
          };
    }, phone);
  }

  /** The map moved so that (lon, lat) is in the middle of its free part. */
  async function centreInFree(lngLat) {
    const a = await freeArea();
    await page.evaluate(
      ([ll, t]) => {
        const m = window.__map;
        const s = m.project(ll);
        const r = m.getCanvas().getBoundingClientRect();
        // panBy(p) moves what is at screen point s to s - p.
        m.panBy([s.x + r.left - t.x, s.y + r.top - t.y], { duration: 0 });
      },
      [lngLat, { x: (a.left + a.right) / 2, y: (a.top + a.bottom) / 2 }],
    );
    await page.waitForTimeout(300);
  }

  return {
    ...{ page, context, combo, phone, idle, open, tap, tapAt, jump, drag, fullSheet },
    ...{ show, centreInFree, hover, hold, keyFocus },
  };
}
