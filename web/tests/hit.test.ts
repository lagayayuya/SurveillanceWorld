// The site's counters as the page sends them (src/hit.ts): one POST /api/hit {event} with
// nothing else (no credentials, keepalive), the map's once the page is shown (now, at its
// first visibilitychange to visible, after a prerender's activation; never for a page
// never shown), nothing under navigator.webdriver, and never an error out of it.
import assert from "node:assert/strict";
import { test } from "node:test";
import { type HitEnv, hit, hitWhenShown } from "../src/hit.ts";

type Sent = { url: string; init: RequestInit };

/** A browser: `visible`, `prerendering`, `webdriver` as given; `fire(type)` dispatches. */
function fake(opts: { webdriver?: boolean; prerendering?: boolean; visible?: boolean } = {}) {
  const sent: Sent[] = [];
  const listeners = new Map<string, Set<() => void>>();
  const state = { visible: opts.visible ?? true };
  const env: HitEnv = {
    webdriver: opts.webdriver ?? false,
    prerendering: opts.prerendering ?? false,
    visible: () => state.visible,
    listen: (type, fn) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)?.add(fn);
    },
    unlisten: (type, fn) => listeners.get(type)?.delete(fn),
    send: async (url, init) => {
      sent.push({ url, init });
    },
  };
  const fire = (type: string) => {
    for (const fn of [...(listeners.get(type) ?? [])]) fn();
  };
  const count = (type: string) => listeners.get(type)?.size ?? 0;
  return { env, sent, state, fire, count };
}

test("a hit is one anonymous POST of its event, kept alive, nothing else", () => {
  const f = fake();
  hit("welcome", f.env);
  assert.equal(f.sent.length, 1);
  const [{ url, init }] = f.sent;
  assert.equal(url, "/api/hit");
  assert.equal(init.method, "POST");
  assert.equal(init.body, '{"event":"welcome"}');
  assert.equal(init.keepalive, true);
  assert.equal(init.credentials, "omit");
  assert.deepEqual(init.headers, { "Content-Type": "application/json" });
});

test("under navigator.webdriver nothing is sent, neither hit nor the map's", () => {
  const f = fake({ webdriver: true });
  hit("welcome", f.env);
  hitWhenShown("map", f.env);
  f.fire("visibilitychange");
  assert.equal(f.sent.length, 0);
  assert.equal(f.count("visibilitychange"), 0);
});

test("the map's hit: at once on a visible page, once", () => {
  const f = fake();
  hitWhenShown("map", f.env);
  f.fire("visibilitychange");
  assert.deepEqual(
    f.sent.map((s) => s.init.body),
    ['{"event":"map"}'],
  );
});

test("a page opened hidden sends at its first visibilitychange to visible, then never again", () => {
  const f = fake({ visible: false });
  hitWhenShown("map", f.env);
  assert.equal(f.sent.length, 0);
  f.fire("visibilitychange"); // still hidden
  assert.equal(f.sent.length, 0);
  f.state.visible = true;
  f.fire("visibilitychange");
  f.state.visible = false;
  f.fire("visibilitychange");
  f.state.visible = true;
  f.fire("visibilitychange");
  assert.equal(f.sent.length, 1);
  assert.equal(f.count("visibilitychange"), 0, "its listener removed");
});

test("a prerendered page sends nothing until it is activated, and nothing if never shown", () => {
  const never = fake({ prerendering: true, visible: false });
  hitWhenShown("map", never.env);
  never.fire("visibilitychange");
  assert.equal(never.sent.length, 0);

  const shown = fake({ prerendering: true, visible: true });
  hitWhenShown("map", shown.env);
  assert.equal(shown.sent.length, 0, "visible but still prerendering");
  shown.fire("prerenderingchange");
  assert.equal(shown.sent.length, 1);
  shown.fire("prerenderingchange");
  assert.equal(shown.sent.length, 1);
});

test("a failing network or a throwing fetch never reaches the page", async () => {
  const rejecting = fake();
  rejecting.env.send = () => Promise.reject(new TypeError("offline"));
  assert.doesNotThrow(() => hit("map", rejecting.env));
  const throwing = fake();
  throwing.env.send = () => {
    throw new Error("no fetch");
  };
  assert.doesNotThrow(() => hit("map", throwing.env));
  assert.doesNotThrow(() => hitWhenShown("map", throwing.env));
  // The rejection is swallowed (an unhandled one would fail this test run).
  await new Promise((r) => setTimeout(r, 10));
});
