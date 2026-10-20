// Smoke test of what GET /api/config changes in punk (src/config.ts, the launch lot), on the
// production build of the CI extract, the API simulated as the lot's contract says.
// Contributions open: the account square, « ＋ Ajouter », the camera sheet's « Modifier » and
// « Toujours là ? », the welcome's « Participer » (its questions not shown). Closed: none of
// them in the page (absent, not greyed), signed out or signed in, nor any question that speaks
// of accounts; the camera sheet keeps « Corriger sur OpenStreetMap »; the way back from
// OpenStreetMap and the password form's address are dropped unread. An API that fails leaves
// contributions open. Publishing to OpenStreetMap (« Publier sur OpenStreetMap », the OSM
// synchronisation's setting) on the account's screen only when the API offers it (GET
// /api/config `sync` and GET /api/osm/sync `offered`), in the privacy page and the terms
// only when `publish` is true, whatever GET /api/osm/status says. The legal pages (`?page=`,
// src/legal): a named modal dialog in place of a first visit's welcome, the four pages linked
// at its top (the one shown marked), one replacing the other with the address and the
// document's title, Escape, × and a tap outside closing it; opened from the welcome over it
// (Escape closes the page alone, the focus back on its link), from the « ? » window (the
// welcome opened again, the links its last line, contributions open or closed), from
// « Compte »'s foot (signed out and in) and from the pseudonym screen's « En validant, vous
// acceptez les conditions… » (the pseudonym typed kept); closed contributions leave no account
// part in them but the contact address; the publisher's identity only when the API gives one;
// axe-core WCAG 2.2 A/AA none in the dialog. A pending proposal's line, punk and classique,
// says its month (the API gives no day). The map's corner credit in punk's words (its Sources
// page's), the classique's unchanged. Exits non-zero if a check failed.
//   node bench/smoke-launch.mjs [--browser webkit|chromium] [--port N]
// WebKit runs a phone (390 × 845), Chromium a wide screen (960 × 581).
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { chromium, devices, webkit } from "playwright";
import { ME } from "./account.mjs";
import { preview, requireTiles, WEB } from "./dist.mjs";

const args = process.argv.slice(2);
const arg = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
requireTiles("ci");
const engine = arg("--browser", "webkit");
const PORT = Number(arg("--port", "4614"));
const APP = `http://localhost:${PORT}/`;
const STREET = [2.2377, 48.8977];
const AXE = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
const phone = engine === "webkit";
const DEVICE = phone
  ? { ...devices["iPhone 14"], viewport: { width: 390, height: 845 } }
  : { viewport: { width: 960, height: 581 } };

const checks = [];
function check(name, ok, detail = "") {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "ok  " : "FAIL"} [${engine}] ${name}${detail ? ` — ${detail}` : ""}`);
}

let browser;
/** A device: `config` is GET /api/config's answer (null: a 500), `signed` the session;
 * `seen` skips the welcome; `proposal`, a pending proposal's properties, given to the
 * camera whose sheet cameraSheet opens (`aim`). Returns the page and what the API was asked. */
async function visit({ config, signed = false, seen = true, url = "", me = ME, proposal = null }) {
  const context = await browser.newContext({ ...DEVICE, locale: "fr-FR", colorScheme: "light" });
  if (seen)
    await context.addInitScript(() => {
      try {
        localStorage.setItem("lacarte.welcome", "1");
      } catch {}
    });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const asked = [];
  const aim = { cam: null };
  await context.route("**/api/**", (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    asked.push(`${req.method()} ${path}`);
    const json = (status, body) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (path === "/api/config") return config ? json(200, config) : json(500, { error: "x" });
    if (path === "/api/me") return signed ? json(200, me) : json(401, { error: "session" });
    if (path === "/api/osm/status")
      return json(200, { login: true, server: "live", write: true, write_server: "live" });
    if (path === "/api/osm/sync")
      return json(
        200,
        config?.sync
          ? {
              offered: true,
              server: "live",
              url: "https://www.openstreetmap.org",
              suspended: false,
              on: false,
              since: null,
              last_error: null,
              history: [],
            }
          : { offered: false, history: [] },
      );
    if (path === "/api/osm/signup")
      return json(200, { suggestion: "Jean_Dupont", osm_name: "Jean Dupont" });
    if (path === "/api/proposals") {
      const features =
        proposal && aim.cam
          ? [
              {
                type: "Feature",
                geometry: { type: "Point", coordinates: aim.cam.at },
                properties: { ...proposal, c: aim.cam.id },
              },
            ]
          : [];
      return json(200, { type: "FeatureCollection", features });
    }
    return json(signed ? 404 : 401, { error: "x" });
  });
  await page.goto(url || `${APP}?ui=punk#18/${STREET[1]}/${STREET[0]}`);
  await page.waitForFunction(() => window.__map?.loaded(), null, { timeout: 60000 });
  return { context, page, errors, asked, aim };
}

/** The first camera of the street's tiles, its sheet opened by its link in `ui`; `aim`
 * (visit's) told which. */
async function cameraSheet(page, ui = "punk", aim = null) {
  await page.waitForFunction(
    () => window.__map.querySourceFeatures("detail", { sourceLayer: "cameras" }).length > 0,
    null,
    { timeout: 20000 },
  );
  const cam = await page.evaluate(() => {
    const f = window.__map
      .querySourceFeatures("detail", { sourceLayer: "cameras" })
      .find((c) => /^[nwr]\d+$/.test(String(c.properties.id)));
    return { id: String(f.properties.id), at: f.geometry.coordinates };
  });
  if (aim) aim.cam = cam;
  await page.goto(`${APP}?ui=${ui}&cam=${cam.id}#18/${cam.at[1]}/${cam.at[0]}`);
  // The classique's sheet has no paper.
  await page.waitForSelector(`#sheet ${ui === "punk" ? ".sheet-paper " : ""}.headline`, {
    timeout: 30000,
  });
  // The participation is built at the map's load: its buttons, when any, come with it.
  await page.waitForFunction(() => window.__map?.loaded(), null, { timeout: 60000 });
  await page.waitForTimeout(800);
}

/** What the page offers of accounts and contributions. */
const offered = (page) =>
  page.evaluate(() => {
    const sheet = document.getElementById("sheet");
    return {
      square: Boolean(document.getElementById("account-square")),
      add: Boolean(document.getElementById("fab-add")),
      queue: Boolean(document.getElementById("queue-count")),
      modify: Boolean(sheet?.querySelector("#part-modify")),
      verify: Boolean(sheet?.querySelector(".part-verify")),
      osmEdit: Boolean(sheet?.querySelector("a.osm-edit")),
      welcomeSquare: Boolean(document.getElementById("welcome-square")),
    };
  });

/** The welcome panel's labels and questions. */
const welcome = (page) =>
  page.evaluate(() => {
    const d = document.querySelector("#welcome [role=dialog]");
    return {
      open: Boolean(d),
      labels: [...(d?.querySelectorAll(".welcome-label") ?? [])].map((e) => e.textContent),
      questions: d?.querySelectorAll(".welcome-ask").length ?? 0,
      text: d?.textContent ?? "",
    };
  });

/** The legal dialog as the page shows it. */
const legal = (page) =>
  page.evaluate(() => {
    const d = document.querySelector("#legal [role=dialog]");
    const title = d?.querySelector("#legal-title");
    return {
      open: Boolean(d),
      modal: d?.getAttribute("aria-modal"),
      name: title?.textContent ?? "",
      labelled: d?.getAttribute("aria-labelledby") === title?.id,
      focusInside: Boolean(d?.contains(document.activeElement)),
      current: d?.querySelector("[aria-current=page]")?.textContent ?? "",
      links: d?.querySelectorAll(".legal-nav a").length ?? 0,
      headings: [...(d?.querySelectorAll(".legal-label") ?? [])].map((h) => h.textContent),
      text: d?.textContent ?? "",
      mailto: Boolean(d?.querySelector('a[href^="mailto:"]')),
      search: location.search,
      doc: document.title,
      welcome: Boolean(document.querySelector("#welcome [role=dialog]")),
      sideways: document.documentElement.scrollWidth > innerWidth,
    };
  });

async function axe(page, where) {
  await page.addScriptTag({ path: AXE });
  const found = await page.evaluate(async () => {
    const body = document.querySelector(".legal-body");
    const out = new Set();
    const steps = Math.ceil(body.scrollHeight / body.clientHeight) + 1;
    for (let i = 0; i < steps; i++) {
      body.scrollTop = i * body.clientHeight;
      await new Promise((r) => setTimeout(r, 50));
      const r = await window.axe.run(document.querySelector("#legal"), {
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
      });
      for (const v of r.violations)
        for (const n of v.nodes) out.add(`${v.id} ${n.target.join(" ")}`);
    }
    body.scrollTop = 0;
    return [...out];
  });
  check(`${where}: axe WCAG 2.2 A/AA none in the dialog`, found.length === 0, found.join(" | "));
}

const server = spawn("npx", preview(PORT), { cwd: WEB, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 2500));
browser = await (engine === "chromium" ? chromium : webkit).launch();
const OPEN = { contributions: true, publish: false, publisher: null };
const CLOSED = { contributions: false, publish: false, publisher: null };
try {
  // --- open: what the page offered before ------------------------------------------------
  {
    const { context, page, errors, asked } = await visit({ config: OPEN });
    const once = asked.filter((a) => a === "GET /api/config").length === 1;
    await cameraSheet(page);
    const o = await offered(page);
    check(
      "open, signed out: the account square, « ＋ Ajouter », « Modifier » and « Toujours là ? » (greyed), « Corriger sur OpenStreetMap »",
      o.square && o.add && o.modify && o.verify && o.osmEdit,
      JSON.stringify(o),
    );
    check("GET /api/config asked once by a page load", once);
    check("open: no page error", errors.length === 0, errors.join(" | "));
    await context.close();
  }
  {
    const { context, page } = await visit({ config: OPEN, seen: false });
    await page.waitForSelector("#welcome [role=dialog]");
    const w = await welcome(page);
    check(
      "open: the welcome's « Participer », no question (not shown), « rejoins l'aventure » and « Contributions vérifiées »",
      w.labels.includes("Participer") &&
        w.questions === 0 &&
        w.text.includes("rejoins l'aventure") &&
        w.text.includes("Contributions vérifiées"),
      JSON.stringify(w.labels),
    );
    await context.close();
  }
  // --- a pending proposal: dated by its month, the API giving no day ---------------------
  // (signed in: the classique shows no participation to a visitor)
  for (const ui of ["punk", "classic"]) {
    const proposal = {
      ...{ u: "0dd0dd00-0000-4000-8000-000000000001", k: "move", ck: "dome", s: "pending" },
      ...{ month: "2026-10", n: 0, d: 0, o: null, to: STREET, mv: 7.2 },
    };
    const { context, page, errors, aim } = await visit({ config: OPEN, signed: true, proposal });
    await cameraSheet(page, ui, aim);
    await page.waitForSelector(".proposal-line", { timeout: 20000 });
    const line = await page.locator(".proposal-line").innerText();
    check(
      `${ui}: a pending proposal's line says its month (« en octobre 2026 »), no day`,
      / en octobre 2026$/.test(line) && !/\d{1,2} octobre/.test(line) && errors.length === 0,
      `${line}${errors.length ? ` | ${errors.join(" | ")}` : ""}`,
    );
    await context.close();
  }
  // --- closed: none of it, signed out or in ---------------------------------------------
  for (const signed of [false, true]) {
    const who = signed ? "signed in" : "signed out";
    const { context, page, errors } = await visit({ config: CLOSED, signed });
    await cameraSheet(page);
    const o = await offered(page);
    check(
      `closed, ${who}: no account square, no « ＋ Ajouter », no send counter, no « Modifier » nor « Toujours là ? » in the sheet (absent, not greyed); the « ? » stays`,
      !o.square && !o.add && !o.queue && !o.modify && !o.verify && o.welcomeSquare,
      JSON.stringify(o),
    );
    check(`closed, ${who}: « Corriger sur OpenStreetMap » in the sheet`, o.osmEdit);
    check(`closed, ${who}: no page error`, errors.length === 0, errors.join(" | "));
    await context.close();
  }
  {
    const { context, page } = await visit({ config: CLOSED, seen: false });
    await page.waitForSelector("#welcome [role=dialog]");
    const w = await welcome(page);
    check(
      "closed: the welcome without « Participer », « rejoins l'aventure » nor « Contributions vérifiées », its title kept, no question, no word of an account",
      !w.labels.includes("Participer") &&
        w.questions === 0 &&
        !/compte|rejoins l'aventure|Contributions vérifiées/i.test(w.text) &&
        w.text.includes("The most magical place on Earth") &&
        w.text.includes("sous un nouveau jour <3"),
      JSON.stringify(w.labels),
    );
    await context.close();
  }
  {
    const { context, page } = await visit({
      config: CLOSED,
      url: `${APP}?ui=punk&osm=signup&compte=motdepasse#18/${STREET[1]}/${STREET[0]}`,
    });
    await page.waitForTimeout(500);
    const left = await page.evaluate(() => ({
      search: location.search,
      sheet: !document.getElementById("sheet")?.hidden,
    }));
    check(
      "closed: ?osm= and ?compte= dropped from the address unread, no sheet opened",
      left.search === "?ui=punk" && !left.sheet,
      JSON.stringify(left),
    );
    await context.close();
  }
  // --- publishing: offered by the API or not ---------------------------------------------
  for (const publish of [true, false]) {
    const { context, page } = await visit({
      config: { ...OPEN, publish, sync: publish },
      signed: true,
      me: { ...ME, osm: true, password: false, sync: false, publish: false },
    });
    await page.locator("#account-square").click();
    await page.waitForSelector("#sheet .board-delete", { timeout: 20000 });
    await page.waitForTimeout(800);
    const section = await page.evaluate(() => {
      const s = document.querySelector("#sheet .board-publish");
      return s ? (s.hidden ? "hidden" : s.textContent) : "absent";
    });
    check(
      publish
        ? "publish offered: « Publier sur OpenStreetMap » on the account's screen"
        : "publish not offered: no « Publier sur OpenStreetMap » on the account's screen, though OSM's write server answers",
      publish ? /Publier aussi sur OpenStreetMap en mon nom/.test(section) : section === "absent",
      section.slice(0, 80),
    );
    await context.close();
    // The privacy page and the terms say publishing only when it is offered.
    const said = [];
    for (const slug of ["confidentialite", "conditions"]) {
      const v = await visit({
        config: { ...OPEN, publish },
        seen: true,
        url: `${APP}?ui=punk&page=${slug}#18/${STREET[1]}/${STREET[0]}`,
      });
      await v.page.waitForSelector("#legal [role=dialog]");
      said.push((await legal(v.page)).text);
      await v.context.close();
    }
    const [privacy, terms] = said;
    const speaks = {
      token: privacy.includes("chiffrée"),
      public: privacy.includes("publiée sous votre nom OSM"),
      section: /Publier sur OpenStreetMap/.test(terms),
    };
    check(
      publish
        ? "publish offered: the privacy page (the encrypted authorisation, what becomes public) and the terms (« Publier sur OpenStreetMap ») say it"
        : "publish not offered: neither the privacy page nor the terms speak of publishing to OpenStreetMap",
      Object.values(speaks).every((x) => x === publish),
      JSON.stringify(speaks),
    );
  }
  // --- the head: share tags and the logo L3 (2026-10-15) ----------------------------------
  {
    const html = await (await fetch(APP)).text();
    const meta = (attr, name) =>
      html.match(new RegExp(`<meta ${attr}="${name}" content="([^"]*)"`))?.[1] ?? null;
    const served = async (path) => {
      const r = await fetch(`${APP}${path.slice(1)}`);
      return { status: r.status, type: r.headers.get("content-type"), body: await r.text() };
    };
    const svg = await served("/favicon.svg");
    const apple = await served("/apple-touch-icon.png");
    const og = await fetch(`${APP}og.jpg`);
    const ogBytes = (await og.arrayBuffer()).byteLength;
    const manifest = await served("/manifest.webmanifest");
    let app = null;
    try {
      app = JSON.parse(manifest.body);
    } catch {}
    // The PNG icons of a page's head: each size in light and dark (variant C, 2026-10-15),
    // served as a PNG of that size (its IHDR).
    const pngIcons = async (page) =>
      Promise.all(
        [...page.matchAll(/<link rel="icon" href="([^"]+\.png)"[^>]*>/g)].map(async (m) => {
          const r = await fetch(`${APP}${m[1].slice(1)}`);
          const bytes = new DataView(await r.arrayBuffer());
          const side = r.ok && bytes.byteLength > 24 ? bytes.getUint32(16) : 0;
          return {
            href: m[1],
            sizes: m[0].match(/sizes="(\d+)x\d+"/)?.[1] ?? null,
            mode: m[0].match(/prefers-color-scheme: (light|dark)/)?.[1] ?? null,
            png: /^image\/png/.test(r.headers.get("content-type") ?? "") ? side : 0,
          };
        }),
      );
    const pairs = (icons, sizes) =>
      sizes.every((s) =>
        ["light", "dark"].every(
          (mode) =>
            icons.filter((i) => i.sizes === s && i.mode === mode && i.png === Number(s)).length ===
            1,
        ),
      ) && icons.length === sizes.length * 2;
    const icons = await pngIcons(html);
    const review = await pngIcons(await (await fetch(`${APP}revue.html`)).text());
    const head = {
      title: meta("property", "og:title"),
      card: meta("name", "twitter:card"),
      locale: meta("property", "og:locale"),
      url: meta("property", "og:url"),
      leftover: /%site%|%t:/.test(html),
      icon: html.includes('<link rel="icon" href="/favicon.svg" type="image/svg+xml"'),
      svg: [svg.status, svg.type],
      apple: [apple.status, apple.type],
      og: [og.status, og.headers.get("content-type"), ogBytes],
      manifest: [manifest.status, app?.name, app?.icons?.length],
      icons: icons.map((i) => `${i.href} ${i.sizes} ${i.mode} ${i.png}`),
      review: review.map((i) => `${i.href} ${i.sizes} ${i.mode} ${i.png}`),
    };
    check(
      "the head: the PNG icons 16 and 32 px in light and dark (the review page's 32 px), each served at its size",
      pairs(icons, ["16", "32"]) && pairs(review, ["32"]),
      JSON.stringify({ icons: head.icons, review: head.review }),
    );
    check(
      "the head: og:title and description from the catalogue, twitter:card summary_large_image, fr_FR; no og:url nor og:image without a host (the gate's build); the L3 icons, the manifest and the A2 preview (/og.jpg, under 300 KB) served",
      head.title === "Surveillance World — la carte des caméras d'Île-de-France" &&
        head.card === "summary_large_image" &&
        head.locale === "fr_FR" &&
        head.url === null &&
        !head.leftover &&
        head.icon &&
        svg.status === 200 &&
        /^image\/svg\+xml/.test(svg.type ?? "") &&
        apple.status === 200 &&
        /^image\/png/.test(apple.type ?? "") &&
        og.status === 200 &&
        /^image\/jpeg/.test(og.headers.get("content-type") ?? "") &&
        ogBytes < 300_000 &&
        manifest.status === 200 &&
        app?.name === "Surveillance World" &&
        app?.icons?.length === 2,
      JSON.stringify(head),
    );
  }
  // --- the legal pages -------------------------------------------------------------------
  {
    const { context, page, errors } = await visit({
      config: OPEN,
      seen: false,
      url: `${APP}?ui=punk&page=conditions#18/${STREET[1]}/${STREET[0]}`,
    });
    await page.waitForSelector("#legal [role=dialog]");
    const first = await legal(page);
    check(
      "?page=conditions: a named modal dialog at once, in place of the first visit's welcome, the focus inside, the page and the document titled",
      first.open &&
        first.modal === "true" &&
        first.labelled &&
        first.name === "Conditions d'utilisation et de contribution" &&
        first.focusInside &&
        !first.welcome &&
        first.doc.startsWith("Conditions d'utilisation et de contribution"),
      JSON.stringify({ ...first, text: first.text.length }),
    );
    check(
      "the four pages linked at its top, the one shown marked; open contributions: the contribution's parts and CC0",
      first.links === 4 &&
        first.current === "Conditions" &&
        first.headings.includes("Contribuer") &&
        first.text.includes("CC0") &&
        !first.sideways,
      JSON.stringify(first.headings),
    );
    await axe(page, "conditions");
    await page.locator("#legal .legal-nav a", { hasText: "Sources et licences" }).click();
    const sources = await legal(page);
    check(
      "a page's link replaces it in place: address, title, the link marked, ODbL, IGN, AGPL",
      sources.search.includes("page=sources") &&
        sources.name === "Sources et licences" &&
        sources.current === "Sources et licences" &&
        /ODbL/.test(sources.text) &&
        /Admin Express/.test(sources.text) &&
        /AGPL/.test(sources.text),
      sources.search,
    );
    // The third-party licence notices: linked from « Le code », served by the site.
    const notices = await page.evaluate(async () => {
      const a = document.querySelector('#legal a[href$="licences.txt"]');
      if (!a) return null;
      const r = await fetch(a.href);
      const text = await r.text();
      return {
        href: a.getAttribute("href"),
        blank: a.target === "_blank",
        status: r.status,
        type: r.headers.get("content-type"),
        protomaps: text.includes("Copyright 2019-2023 Protomaps LLC, Kelso Cartography"),
        pmtiles: text.includes("Copyright 2021 Protomaps LLC"),
        maplibre: text.includes("Copyright (c) 2023, MapLibre contributors"),
        bsd3: (text.match(/Neither the name of/g) ?? []).length,
      };
    });
    check(
      "Sources links /licences.txt (a new tab), served as text: Protomaps' (basemaps, PMTiles) and MapLibre's BSD-3 in full",
      notices?.href === "/licences.txt" &&
        notices.blank &&
        notices.status === 200 &&
        /^text\/plain/.test(notices.type ?? "") &&
        notices.protomaps &&
        notices.pmtiles &&
        notices.maplibre &&
        notices.bsd3 >= 3,
      JSON.stringify(notices),
    );
    {
      // Opened as a page: read as UTF-8 (its byte order mark), whatever the header says.
      const tab = await context.newPage();
      await tab.goto(`${APP}licences.txt`);
      const head = await tab.evaluate(() => document.body.innerText.split("\n")[0]);
      check(
        "/licences.txt opened in a tab: its French intact",
        head.startsWith("Surveillance World — les avis de licence") &&
          head.includes("«\u00a0Sources et licences\u00a0»"),
        head,
      );
      await tab.close();
    }
    await page.keyboard.press("Escape");
    const after = await legal(page);
    check(
      "Escape closes it: the address without ?page=, the document's title back",
      !after.open && !after.search.includes("page=") && after.doc === "Surveillance World",
      JSON.stringify({ search: after.search, doc: after.doc }),
    );
    check("legal pages: no page error", errors.length === 0, errors.join(" | "));
    await context.close();
  }
  {
    // From the welcome: the page over it, Escape closes the page alone.
    const { context, page } = await visit({ config: OPEN, seen: false });
    await page.waitForSelector("#welcome [role=dialog]");
    const link = page.locator("#welcome .welcome-legal a", { hasText: "Mentions légales" });
    const links = await page.locator("#welcome .welcome-legal a").count();
    await link.click();
    await page.waitForSelector("#legal [role=dialog]");
    const over = await legal(page);
    await page.keyboard.press("Escape");
    const back = await page.evaluate(() => ({
      legal: Boolean(document.getElementById("legal")),
      welcome: Boolean(document.querySelector("#welcome [role=dialog]")),
      welcomeInert: Boolean(document.getElementById("welcome")?.inert),
      focus: document.activeElement?.textContent ?? "",
    }));
    check(
      "the welcome links the four pages; one opens over it, Escape closes it alone, the focus back on its link",
      links === 4 &&
        over.open &&
        over.welcome &&
        over.name === "Mentions légales" &&
        !back.legal &&
        back.welcome &&
        !back.welcomeInert &&
        back.focus === "Mentions légales",
      JSON.stringify({ links, back }),
    );
    check(
      "no publisher given: no « Éditeur » in the mentions légales, the hoster and the contact there",
      !over.headings.includes("Éditeur") &&
        over.headings.includes("Hébergeur") &&
        over.headings.includes("Contact") &&
        over.mailto,
      JSON.stringify(over.headings),
    );
    await context.close();
  }
  {
    const { context, page } = await visit({
      config: { ...OPEN, publisher: "Jo Exemple, 1 rue de l'Exemple" },
      url: `${APP}?ui=punk&page=mentions-legales#18/${STREET[1]}/${STREET[0]}`,
    });
    await page.waitForSelector("#legal [role=dialog]");
    const m = await legal(page);
    await page.locator("#legal .legal-nav a", { hasText: "Confidentialité" }).click();
    const c = await legal(page);
    check(
      "a publisher given: « Éditeur » in the mentions légales, « Responsable du traitement » in the privacy page",
      m.headings[0] === "Éditeur" &&
        m.text.includes("Jo Exemple, 1 rue de l'Exemple") &&
        c.headings[0] === "Responsable du traitement" &&
        c.text.includes("Jo Exemple"),
      JSON.stringify([m.headings, c.headings]),
    );
    await context.close();
  }
  for (const slug of ["confidentialite", "conditions"]) {
    const { context, page } = await visit({
      config: CLOSED,
      url: `${APP}?ui=punk&page=${slug}#18/${STREET[1]}/${STREET[0]}`,
    });
    await page.waitForSelector("#legal [role=dialog]");
    const l = await legal(page);
    check(
      `closed: « ${l.name} » without a word of an account, the contact address kept`,
      !/compte|pseudonyme|cookie|classement|session/i.test(l.text.replace(l.name, "")) && l.mailto,
      JSON.stringify(l.headings),
    );
    await context.close();
  }
  for (const config of [OPEN, CLOSED]) {
    // The « ? » window (the welcome opened again by the ticket's « ? »): the four links on
    // the last line of its body; one opens over it.
    const what = config.contributions ? "open" : "closed";
    const { context, page } = await visit({ config });
    await page.locator("#welcome-square").click();
    await page.waitForSelector("#welcome [role=dialog]");
    const line = await page.evaluate(() => {
      const body = document.querySelector("#welcome .welcome-body");
      body.scrollTop = body.scrollHeight;
      const nav = body.querySelector(".welcome-legal");
      return {
        last: body.lastElementChild === nav,
        links: [...(nav?.querySelectorAll("a") ?? [])].map((a) => a.textContent),
      };
    });
    await page.locator("#welcome .welcome-legal a", { hasText: "Sources et licences" }).click();
    await page.waitForSelector("#legal [role=dialog]");
    const l = await legal(page);
    check(
      `${what}: the « ? » window ends on the four pages' links; « Sources et licences » opens over it`,
      line.last &&
        line.links.join("|") ===
          "Mentions légales|Confidentialité|Conditions|Sources et licences" &&
        l.open &&
        l.welcome &&
        l.name === "Sources et licences",
      JSON.stringify(line),
    );
    await context.close();
  }
  {
    // « Compte »'s foot, signed in: the account's screen ends on the four links.
    const { context, page } = await visit({ config: OPEN, signed: true });
    await page.locator("#account-square").click();
    await page.waitForSelector("#sheet .account-legal", { timeout: 20000 });
    const foot = await page.locator("#sheet .account-legal a").allTextContents();
    await page.locator("#sheet .account-legal a", { hasText: "Mentions légales" }).click();
    const l = await legal(page);
    check(
      "« Compte »'s foot, signed in, links the four pages; one opens over the sheet",
      foot.length === 4 && l.open && l.name === "Mentions légales",
      JSON.stringify(foot),
    );
    await context.close();
  }
  {
    // « Compte »'s foot, signed out.
    const { context, page } = await visit({ config: OPEN });
    await page.locator("#account-square").click();
    await page.waitForSelector("#sheet .account-legal");
    const foot = await page.locator("#sheet .account-legal a").allTextContents();
    await page.locator("#sheet .account-legal a", { hasText: "Confidentialité" }).click();
    const l = await legal(page);
    check(
      "« Compte »'s foot links the four pages; one opens over the sheet",
      foot.length === 4 && l.open && l.name === "Confidentialité et traceurs",
      JSON.stringify(foot),
    );
    await context.close();
  }
  {
    // The pseudonym screen: the acceptance line and its link, the pseudonym kept.
    const { context, page } = await visit({
      config: OPEN,
      url: `${APP}?ui=punk&osm=signup#18/${STREET[1]}/${STREET[0]}`,
    });
    await page.waitForSelector("#account-signup-accept", { timeout: 30000 });
    await page.locator("#account-signup-pseudonym").fill("mon_pseudo");
    const line = await page.locator("#account-signup-accept").textContent();
    const described = await page.locator("#sheet .account-submit").getAttribute("aria-describedby");
    await page.locator("#account-signup-accept a").click();
    const l = await legal(page);
    await page.locator("#legal .welcome-close").click();
    const back = await page.evaluate(() => ({
      value: document.getElementById("account-signup-pseudonym")?.value,
      focus: document.activeElement?.closest("#account-signup-accept") !== null,
    }));
    check(
      "the pseudonym screen: « En validant, vous acceptez les conditions d'utilisation et de contribution. », its link opens the page over it, × gives the focus back, the pseudonym kept",
      line === "En validant, vous acceptez les conditions d'utilisation et de contribution." &&
        described === "account-signup-accept" &&
        l.name === "Conditions d'utilisation et de contribution" &&
        back.value === "mon_pseudo" &&
        back.focus,
      JSON.stringify({ line, described, back }),
    );
    await context.close();
  }
  // --- the map's corner credit: punk's as its Sources page, the classique's unchanged -----
  for (const ui of ["punk", "classic"]) {
    const { context, page } = await visit({
      config: OPEN,
      url: `${APP}?ui=${ui}#18/${STREET[1]}/${STREET[0]}`,
    });
    const credit = await page.evaluate(() =>
      [...document.querySelectorAll(".maplibregl-ctrl-attrib-inner a")].map((a) => [
        a.textContent,
        a.getAttribute("href"),
      ]),
    );
    const said = JSON.stringify(credit);
    const want =
      ui === "punk"
        ? [
            ["construit avec Protomaps", "https://protomaps.com"],
            [
              "données © les contributeurs d'OpenStreetMap",
              "https://www.openstreetmap.org/copyright",
            ],
          ]
        : [
            ["fond Protomaps", "https://protomaps.com"],
            ["© contributeurs OpenStreetMap", "https://www.openstreetmap.org/copyright"],
          ];
    const text = await page.locator(".maplibregl-ctrl-attrib-inner").textContent();
    check(
      ui === "punk"
        ? "punk's corner credit: « construit avec Protomaps », « données © les contributeurs d'OpenStreetMap · licence ODbL »"
        : "the classique's corner credit unchanged: « fond Protomaps », « © contributeurs OpenStreetMap · données ODbL »",
      want.every((w) => said.includes(JSON.stringify(w))) &&
        text.includes(ui === "punk" ? " · licence ODbL" : " · données ODbL"),
      text,
    );
    await context.close();
  }
  // --- an API that fails: open, as before ------------------------------------------------
  {
    const { context, page } = await visit({ config: null });
    const o = await offered(page);
    check("GET /api/config failing: contributions open (the account square)", o.square);
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
