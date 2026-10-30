// « Chargement »'s first load as index.html's script decides it (public/carte-chargement.js,
// src/loading.ts): run
// in a sandbox with a page made of the few parts it touches. The first load only once 300 ms
// have passed since the navigation (at once past them), whatever ?ui= says (the classique,
// removed on 2026-10-23, once skipped it), not at all when the map was in first; a return from OpenStreetMap or the
// account's address « de votre compte », at once. The component it builds: the word cut into
// its letters, the line, its words said a moment after it is in the page.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const SCRIPT = readFileSync(new URL("../public/carte-chargement.js", import.meta.url), "utf8");
assert.ok(SCRIPT.includes("window.__loading ="), "index.html's « Chargement » script");

/** An element as the script uses one: classes, dataset, children, textContent. */
class El {
  className = "";
  id = "";
  dataset: Record<string, string> = {};
  children: El[] = [];
  textContent = "";
  constructor(className = "", children: El[] = []) {
    this.className = className;
    this.children = children;
  }
  get classList() {
    return { add: (c: string) => (this.className = `${this.className} ${c}`.trim()) };
  }
  append(...kids: El[]) {
    this.children.push(...kids);
  }
  cloneNode(): El {
    const copy = new El(this.className, this.children.map((c) => c.cloneNode()));
    copy.textContent = this.textContent;
    return copy;
  }
  querySelector(sel: string): El | null {
    for (const c of this.children) {
      if (c.className.split(" ").includes(sel.slice(1))) return c;
      const deep = c.querySelector(sel);
      if (deep) return deep;
    }
    return null;
  }
}

type Run = {
  shown: El[];
  mark: () => string | undefined;
  delays: number[];
  /** Fire the timers scheduled so far, in order (each once). */
  tick: () => void;
  /** As main.ts's endFirstLoad: the mark taken off. */
  end: () => void;
  build: (line: string) => El;
};

function run({ search = "", stored = {} as Record<string, string>, now = 0 } = {}): Run {
  const template = new El();
  template.dataset = {
    word: "Chargement",
    map: "de la carte",
    account: "de votre compte",
    saidMap: "Chargement de la carte",
    saidAccount: "Chargement de votre compte",
  };
  const component = new El("loading", [
    new El("loading-said"),
    new El("loading-stage"),
    new El("loading-label", [
      new El("loading-word"),
      new El("loading-line", [new El("loading-line-text"), new El("loading-caret")]),
    ]),
  ]);
  (template as unknown as { content: unknown }).content = { firstElementChild: component };
  const root = new El();
  const shown: El[] = [];
  const timers: { fn: () => void; done: boolean }[] = [];
  const delays: number[] = [];
  const window: Record<string, unknown> = {};
  const sandbox = {
    window,
    document: {
      documentElement: root,
      getElementById: (id: string) => (id === "loading-template" ? template : null),
      createElement: () => new El(),
      body: { append: (e: El) => shown.push(e) },
    },
    location: { search },
    localStorage: { getItem: (k: string) => stored[k] ?? null },
    matchMedia: () => ({ matches: false }),
    performance: { now: () => now },
    URLSearchParams,
    setTimeout: (fn: () => void, ms: number) => {
      timers.push({ fn, done: false });
      delays.push(ms);
    },
  };
  runInNewContext(SCRIPT as string, sandbox);
  return {
    shown,
    mark: () => root.dataset.loading,
    delays,
    tick: () => {
      for (const t of [...timers])
        if (!t.done) {
          t.done = true;
          t.fn();
        }
    },
    end: () => {
      delete root.dataset.loading;
    },
    build: window.__loading as (line: string) => El,
  };
}

// The classique is gone (2026-10-23): its old links (?ui=classic, ?ui=classique, ?ui=punk)
// and a choice kept on the device (lacarte.ui) load the site as any visit does.
test("?ui= and a kept lacarte.ui change nothing: the same first load as any visit", () => {
  for (const r of [
    run(),
    run({ search: "?ui=classic" }),
    run({ search: "?ui=classique" }),
    run({ search: "?ui=punk" }),
    run({ stored: { "lacarte.ui": "classique" } }),
    run({ search: "?ui=punk", stored: { "lacarte.ui": "classique" } }),
  ]) {
    assert.equal(r.mark(), "map");
    assert.deepEqual(r.delays, [300]);
    r.tick();
    assert.equal(r.shown.length, 1);
    assert.equal(r.shown[0].id, "loading");
  }
});

test("the first load: « de la carte » once 300 ms have passed since the navigation", () => {
  const r = run({ now: 120 });
  assert.equal(r.mark(), "map");
  assert.deepEqual(r.delays, [180]);
  r.tick();
  assert.equal(r.shown.length, 1);
  const el = r.shown[0];
  assert.equal(el.id, "loading");
  assert.match(el.className, /\bloading-first\b/);
  assert.equal(el.dataset.line, "map");
  assert.equal(el.querySelector(".loading-line-text")?.textContent, "de la carte");
});

test("past 300 ms already: at once", () => {
  const r = run({ now: 900 });
  assert.deepEqual(r.delays, [0]);
});

test("the map in before the wait has passed: never shown", () => {
  const r = run({ now: 50 });
  r.end();
  r.tick();
  assert.equal(r.shown.length, 0);
});

test("back from OpenStreetMap or to the account's address: « de votre compte », at once", () => {
  for (const search of ["?osm=signup", "?osm=denied&osm_why=reseau", "?compte=motdepasse"]) {
    const r = run({ search, now: 10 });
    assert.equal(r.mark(), "account", search);
    assert.equal(r.delays[0], 0, search);
    r.tick();
    assert.equal(r.shown[0]?.querySelector(".loading-line-text")?.textContent, "de votre compte");
  }
});

test("dark mode asked or followed: the screen drawn dark from the start", () => {
  const r = run({ search: "?mode=sombre" });
  r.tick();
  assert.equal(r.shown[0]?.dataset.dark, "");
  const light = run({ search: "?mode=clair" });
  light.tick();
  assert.equal(light.shown[0]?.dataset.dark, undefined);
});

test("one component: the word in its letters, the line, said a moment after", () => {
  // The map in before the first load's wait: only the component built.
  const r = run({ stored: { "lacarte.fonts": "1" }, now: 50 });
  r.end();
  const el = r.build("account");
  const letters = el.querySelector(".loading-word")?.children ?? [];
  assert.equal(letters.map((t) => t.children[0]?.textContent).join(""), "Chargement");
  assert.ok(letters.every((t) => t.className === "loading-tilt"));
  assert.equal(el.querySelector(".loading-line-text")?.textContent, "de votre compte");
  // The device has the punk fonts: its own faces.
  assert.equal(el.dataset.fonts, "");
  assert.equal(el.querySelector(".loading-said")?.textContent, "");
  assert.deepEqual(r.delays, [250, 150]);
  r.tick();
  assert.equal(r.shown.length, 0);
  assert.equal(el.querySelector(".loading-said")?.textContent, "Chargement de votre compte");
  assert.equal(run().build("map").dataset.fonts, undefined);
});
