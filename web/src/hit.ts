// The site's two counters (lot 4 of /revue, plan-revue §6 bis): POST /api/hit
// {"event": "map"} once per load of the map page once it is shown, {"event": "welcome"}
// each time the welcome panel shows. The server adds one to that day's number and keeps
// nothing else; the page sends nothing more (no cookie: `credentials: "omit"`, nothing read
// or written on the device). A browser driven by a script (navigator.webdriver: the
// benches, a crawler that says so) sends nothing. Fire and forget: `keepalive`, no answer
// awaited, every error swallowed — a count lost is better than a page held up.
// Written without the page (no DOM at module scope, the environment passed in), so that
// web/tests/hit.test.ts runs it in Node.

export type HitEvent = "map" | "welcome";

/** What the beacons read of the browser (the real one by default). */
export type HitEnv = {
  /** navigator.webdriver: a browser driven by a script. */
  webdriver: boolean;
  /** document.prerendering (Chromium's prerender): not shown yet, maybe never. */
  prerendering: boolean;
  /** document.visibilityState. */
  visible: () => boolean;
  /** document.addEventListener (visibilitychange, prerenderingchange). */
  listen: (type: string, fn: () => void) => void;
  unlisten: (type: string, fn: () => void) => void;
  /** The request itself. */
  send: (url: string, init: RequestInit) => Promise<unknown>;
};

function browserEnv(): HitEnv {
  const doc = document as Document & { prerendering?: boolean };
  return {
    webdriver: navigator.webdriver === true,
    prerendering: doc.prerendering === true,
    visible: () => doc.visibilityState === "visible",
    listen: (type, fn) => doc.addEventListener(type, fn),
    unlisten: (type, fn) => doc.removeEventListener(type, fn),
    send: (url, init) => fetch(url, init),
  };
}

/** POST /api/hit {event}, now; nothing under webdriver; never throws. */
export function hit(event: HitEvent, env?: HitEnv): void {
  try {
    const e = env ?? browserEnv();
    if (e.webdriver) return;
    e.send("/api/hit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event }),
      keepalive: true,
      credentials: "omit",
    }).catch(() => {});
  } catch {
    // No fetch, a refused request: nothing to say, nothing to retry.
  }
}

/** A hit, once, when the page is shown (the map's once per load, the welcome's once per
 * showing): now if it is visible, else at its first
 * `visibilitychange` to visible (a tab opened in the background); a prerendered page waits
 * for its activation (`prerenderingchange`, MDN « Document: prerendering property »), and
 * one never shown sends nothing. */
export function hitWhenShown(event: HitEvent, env?: HitEnv): void {
  try {
    const e = env ?? browserEnv();
    if (e.webdriver) return;
    let done = false;
    const now = () => {
      if (done || !e.visible()) return false;
      done = true;
      hit(event, e);
      return true;
    };
    const whenVisible = () => {
      if (now()) return;
      const onChange = () => {
        if (now()) e.unlisten("visibilitychange", onChange);
      };
      e.listen("visibilitychange", onChange);
    };
    if (e.prerendering) {
      const onActive = () => {
        e.unlisten("prerenderingchange", onActive);
        whenVisible();
      };
      e.listen("prerenderingchange", onActive);
    } else whenVisible();
  } catch {
    // As hit(): never in the page's way.
  }
}
