// The interface a smoke test runs on: `--ui punk` or `--ui classique` keeps it on the
// device (localStorage, as ?ui= does) in every page the browser opens, so that the test's
// own URLs need no change; without `--ui`, the classique, as the benches always ran (the
// app's own default is punk since the launch, theme.ts chosenUi: the classique is asked
// for, never left to the default). With `asWritten` (the smoke tests, which read
// innerText) the punk theme's capitals, CSS only (text-transform, checked by
// smoke-theme.mjs), are switched off; captures keep them.
export const uiArg = (args) => (args.includes("--ui") ? args[args.indexOf("--ui") + 1] : null);

/** Every page the browser opens is a returning visit: punk's welcome panel (welcome.ts,
 * board 28a), shown on a first visit, would cover the map the tests use. */
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

export function withUi(browser, asked, asWritten = false) {
  const ui = asked === "punk" ? "punk" : "classique";
  if (ui === "punk") returning(browser);
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (options) => {
    const context = await newContext(options);
    await context.addInitScript(
      ([u, plain]) => {
        try {
          localStorage.setItem("lacarte.ui", u);
        } catch {
          // about:blank and opaque origins have no storage.
        }
        if (!plain || u !== "punk") return;
        const style = document.createElement("style");
        style.textContent = "* { text-transform: none !important; }";
        document.addEventListener("DOMContentLoaded", () => document.head.append(style));
      },
      [ui, asWritten],
    );
    return context;
  };
  browser.newPage = async (options) => (await browser.newContext(options)).newPage();
  return browser;
}
