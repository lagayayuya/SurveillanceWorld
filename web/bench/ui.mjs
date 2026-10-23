// The browser a smoke test drives: every page it opens is a returning visit (no welcome
// panel), and with `asWritten` (the smoke tests, which read innerText) the punk theme's
// capitals, CSS only (text-transform, checked by smoke-theme.mjs), are switched off;
// captures keep them. One interface since 2026-10-23 (the classique removed): no --ui.

/** Every page the browser opens is a returning visit: the welcome panel (welcome.ts, board
 * 28a), shown on a first visit, would cover the map the tests use. */
export function returning(browser) {
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (options) => {
    const context = await newContext(options);
    await context.addInitScript(() => {
      try {
        localStorage.setItem("lacarte.welcome", "1");
      } catch {
        // about:blank and opaque origins have no storage.
      }
    });
    return context;
  };
  browser.newPage = async (options) => (await browser.newContext(options)).newPage();
  return browser;
}

/** A returning visit (above), its text as written when `asWritten`. */
export function benchBrowser(browser, asWritten = false) {
  returning(browser);
  if (!asWritten) return browser;
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (options) => {
    const context = await newContext(options);
    await context.addInitScript(() => {
      const style = document.createElement("style");
      style.textContent = "* { text-transform: none !important; }";
      document.addEventListener("DOMContentLoaded", () => document.head.append(style));
    });
    return context;
  };
  browser.newPage = async (options) => (await browser.newContext(options)).newPage();
  return browser;
}
