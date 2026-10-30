// The map's « Chargement » (index.html, after its template). A file of its own, not inline, so that
// the register's paths keep a strict Content-Security-Policy (script-src 'self').
// « Chargement » (src/loading.ts): window.__loading(line) builds one from the template
// above, « de la carte » (`map`) or « de votre compte » (`account`). The punk
// interface's first load shows it over the page until the map's first display
// (main.ts), from here: the page is blank until the scripts have arrived and run
// (measured: 0.7 to 3.5 s on a slow phone, bench/loading-timeline.mjs). Only when the
// wait passes 300 ms from the navigation (no flash); at once on a return from
// OpenStreetMap or to the account's address, whose sheet then takes over.
(() => {
  const root = document.documentElement;
  const template = document.getElementById("loading-template");
  const said = { map: template.dataset.saidMap, account: template.dataset.saidAccount };
  window.__loading = (line) => {
    const el = template.content.firstElementChild.cloneNode(true);
    el.dataset.line = line;
    const word = el.querySelector(".loading-word");
    for (const ch of template.dataset.word) {
      const tilt = document.createElement("span");
      tilt.className = "loading-tilt";
      const letter = document.createElement("span");
      letter.className = "loading-letter";
      letter.textContent = ch;
      tilt.append(letter);
      word.append(tilt);
    }
    el.querySelector(".loading-line-text").textContent = template.dataset[line];
    // Its own faces once the device has the punk fonts (theme/fonts.ts): from the
    // cache; a first visit keeps the fallbacks, not to slow the map.
    try {
      if (localStorage.getItem("lacarte.fonts") === "1") el.dataset.fonts = "";
    } catch {}
    // A live region says a change, not what it held when it appeared.
    setTimeout(() => {
      el.querySelector(".loading-said").textContent = said[line];
    }, 150);
    return el;
  };
  try {
    const q = new URLSearchParams(location.search);
    const mode = q.get("mode") || localStorage.getItem("lacarte.mode") || "auto";
    const dark =
      mode === "sombre" ||
      (mode !== "clair" && matchMedia("(prefers-color-scheme: dark)").matches);
    const line = q.has("osm") || q.get("compte") === "motdepasse" ? "account" : "map";
  // A register page opens over the map: the register shows at once, not the map's wait.
  if (/^\/registre(\/|$)/.test(location.pathname)) return;
    // Waiting: main.ts removes this mark (and the screen) at the end.
    root.dataset.loading = line;
    const wait = line === "account" ? 0 : Math.max(0, 300 - performance.now());
    setTimeout(() => {
      if (!root.dataset.loading) return;
      const el = window.__loading(line);
      el.id = "loading";
      el.classList.add("loading-first");
      if (dark) el.dataset.dark = "";
      document.body.append(el);
    }, wait);
  } catch {}
})();
