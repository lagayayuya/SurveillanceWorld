// Smoke test of the interface and its theme (redesign, phase 2), on the production build:
// one interface since 2026-10-23, ?ui= (the classique's old links, ?ui=punk) and a choice
// kept on the device change nothing; its tokens and fonts load; its mode follows the phone,
// or ?mode=; a change of the phone's mode mid-session, either way, repaints the map exactly
// as a page opened in that mode (every layer's paint, filter and order, with a camera in
// focus; communes and départements opaque in both); a focused
// camera zoomed out below the street level is marked, the map's own pixels as without
// focus but for the marker, and « Revenir à la caméra » (or a tap on the marker) brings its
// field back; a gesture leaving the marker under the estimate bar brings it back into view,
// our own moves never; less motion stops the sheet's animation; the focus is a dashed outline; the
// punk basemap has no road shields, and every label in one colour on the map's halo; the
// punk buttons (theme/punk/buttons.css) transition
// listed properties briefly, move on hover without selecting or recolouring (a pressed one
// untilted), sink onto their shadow when pressed, move not at all under less motion, and
// are 44 px at least. Exits non-zero if a check failed.
//   node bench/smoke-theme.mjs [--region idf|ci] [--browser chromium|webkit] [--port N]
import { spawn } from "node:child_process";
import { chromium, devices, webkit } from "playwright";
import { returning } from "./ui.mjs";

const args = process.argv.slice(2);
const arg = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const region = arg("--region", "idf");
const engine = arg("--browser", "chromium");
const PORT = Number(arg("--port", "4186"));
const APP = `http://localhost:${PORT}/`;
// A camera with a field in each region, and its street.
const CAMERA =
  region === "ci"
    ? { id: "n9622344410", hash: "#18/48.897761/2.239972" } // on it: a phone opens it
    : { id: "n13205053278", hash: "#18/48.857247/2.361873" };
const checks = [];

function check(name, ok, detail = "") {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "ok  " : "FAIL"} [${engine}] ${name}${detail ? ` — ${detail}` : ""}`);
}

async function idle(page) {
  await page.waitForFunction(() => window.__map?.loaded(), null, { timeout: 30000 });
  await page.evaluate(
    () =>
      new Promise((r) => {
        window.__map.once("idle", r);
        window.__map.triggerRepaint();
        setTimeout(r, 4000);
      }),
  );
  await page.waitForTimeout(300);
}

/** The map's text as styled: every text layer of the basemap (its colour, halo colour, width
 * and blur), the reach labels', and the tokens they should follow (punk: --map-label on
 * --map-halo, --map-label-halo-width). The build's minifier writes #111111 as #111. */
const labelStyle = (page) =>
  page.evaluate(() => {
    const s = getComputedStyle(document.documentElement);
    const token = (name) => {
      const v = s.getPropertyValue(name).trim();
      return v.length === 4 ? `#${[...v.slice(1)].map((d) => d + d).join("")}` : v;
    };
    const m = window.__map;
    const texts = m
      .getStyle()
      .layers.filter(
        (l) => l.source === "protomaps" && l.type === "symbol" && l.layout?.["text-field"],
      );
    const paint = (l) => ({
      color: l.paint?.["text-color"],
      halo: l.paint?.["text-halo-color"],
      width: l.paint?.["text-halo-width"],
      blur: l.paint?.["text-halo-blur"],
    });
    return {
      want: {
        color: token("--map-label"),
        ink: token("--map-ink"),
        halo: token("--map-halo"),
        width: Number(token("--map-label-halo-width")) || null,
      },
      layers: texts.map((l) => ({ id: l.id, ...paint(l) })),
      reach: {
        color: m.getPaintProperty("focus-labels", "text-color"),
        halo: m.getPaintProperty("focus-labels", "text-halo-color"),
        width: m.getPaintProperty("focus-labels", "text-halo-width"),
        // Punk (lot 3.1): 17a's yellow tag, one image per text (icons.ts TAG_PREFIX).
        tag: JSON.stringify(m.getLayoutProperty("focus-labels", "icon-image") ?? null).includes(
          "punk-tag:",
        ),
        text: m.getLayoutProperty("focus-labels", "text-field") ?? null,
      },
    };
  });
/** Punk: every text of the basemap in the ink on the halo, 2 px; the reach labels are 17a's
 * yellow tag, ink on yellow (its contrast: web/tests/theme.test.ts), with no text of their
 * own (DECISIONS 2026-10-07, « Lots after 3.0… »: the level's yellow label on the map). */
const oneColour = (l) =>
  l.want.color === l.want.ink &&
  l.want.width >= 2 &&
  l.layers.length >= 10 &&
  l.layers.every(
    (x) =>
      x.color === l.want.color &&
      x.halo === l.want.halo &&
      x.width === l.want.width &&
      x.blur === 0,
  ) &&
  l.reach.tag &&
  l.reach.text === null;
const offColour = (l) =>
  JSON.stringify({
    want: l.want,
    off: l.layers.filter((x) => x.color !== l.want.color || x.halo !== l.want.halo).slice(0, 3),
    n: l.layers.length,
    reach: l.reach,
  });

/** The départements' and communes' fill opacity at the end of their fade in (the highest
 * output of their zoom curve): punk draws them opaque. */
const areaOpacity = (page) =>
  page.evaluate(() =>
    ["deps", "communes"].map((id) =>
      Math.max(
        ...window.__map
          .getPaintProperty(id, "fill-opacity")
          .slice(3)
          .filter((_, i) => i % 2 === 1),
      ),
    ),
  );

/** What a theme changes on the map: the sprite, then by layer in order its paint, filter
 * and visibility. */
const mapPaint = (page) =>
  page.evaluate(() => {
    const style = window.__map.getStyle();
    return [
      { id: "sprite", sprite: style.sprite },
      ...style.layers.map((l) => ({
        id: l.id,
        paint: l.paint ?? {},
        filter: l.filter ?? null,
        visibility: l.layout?.visibility ?? "visible",
      })),
    ];
  });

const server = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], {
  stdio: "ignore",
});
await new Promise((r) => setTimeout(r, 1500));
const browser = returning(await (engine === "webkit" ? webkit : chromium).launch());
const device =
  engine === "webkit" ? devices["iPhone 14"] : { viewport: { width: 1280, height: 800 } };

try {
  // --- one interface: ?ui= and a choice kept on the device change nothing ---------------
  // The classique is gone (2026-10-23): its old links (?ui=classic, ?ui=classique), ?ui=punk
  // and a « classique » kept on the device (lacarte.ui) load the site as a plain visit does,
  // with no error, and nothing is written for them.
  for (const [query, kept] of [
    ["", null],
    ["?ui=classic", null],
    ["?ui=classique", null],
    ["?ui=punk", null],
    ["", "classique"],
  ]) {
    const context = await browser.newContext({ ...device, colorScheme: "light" });
    if (kept)
      await context.addInitScript((k) => {
        try {
          if (!sessionStorage.getItem("seeded")) localStorage.setItem("lacarte.ui", k);
          sessionStorage.setItem("seeded", "1");
        } catch {
          // about:blank has no storage.
        }
      }, kept);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    const urls = [];
    page.on("request", (r) => urls.push(r.url()));
    await page.goto(`${APP}${query}${CAMERA.hash}`);
    await idle(page);
    const state = await page.evaluate(() => ({
      ui: document.documentElement.dataset.ui,
      mode: document.documentElement.dataset.mode,
      bg: getComputedStyle(document.documentElement).getPropertyValue("--bg").trim(),
      kept: localStorage.getItem("lacarte.ui"),
      sheet: !document.getElementById("sheet").hidden,
    }));
    const punkCss = urls.some((u) => /\/assets\/punk-.*\.css$/.test(new URL(u).pathname));
    check(
      `${query || "no ?ui="}${kept ? `, « ${kept} » kept on the device` : ""}: the site as any visit, no error`,
      state.ui === "punk" &&
        state.mode === "light" &&
        state.bg === "#f2efe6" &&
        punkCss &&
        state.kept === kept &&
        errors.length === 0,
      JSON.stringify({ ...state, punkCss, errors }),
    );
    await context.close();
  }

  // --- punk: tokens, fonts, mode from the phone or ?mode= -----------------------------
  {
    const context = await browser.newContext({ ...device, colorScheme: "light" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    const urls = [];
    page.on("request", (r) => urls.push(r.url()));
    await page.goto(`${APP}${CAMERA.hash}`);
    await idle(page);
    // The fonts load once the map is drawn (theme/fonts.ts).
    await page
      .waitForFunction(
        () =>
          document.fonts.check('800 16px "Archivo"') &&
          document.fonts.check('16px "Special Elite"'),
        null,
        { timeout: 20000 },
      )
      .catch(() => undefined);
    const s = await page.evaluate(async () => {
      await document.fonts.ready;
      const root = getComputedStyle(document.documentElement);
      return {
        ui: document.documentElement.dataset.ui,
        mode: document.documentElement.dataset.mode,
        bg: root.getPropertyValue("--bg").trim(),
        archivo: document.fonts.check('800 16px "Archivo"'),
        caps: getComputedStyle(document.querySelector("#estimate button")).textTransform,
        elite: document.fonts.check('16px "Special Elite"'),
      };
    });
    const fonts = urls.filter((u) => u.endsWith(".woff2")).length;
    const shields = await page.evaluate(() => Boolean(window.__map.getLayer("roads_shields")));
    check("punk light: no road shields layer", !shields);
    check(
      "punk tokens, light, both fonts self-hosted (after the map), buttons in capitals",
      s.ui === "punk" &&
        s.mode === "light" &&
        s.bg === "#f2efe6" &&
        s.archivo &&
        s.elite &&
        s.caps === "uppercase" &&
        fonts === 2 &&
        urls.every((u) => u.startsWith(APP) || u.startsWith("data:") || u.startsWith("blob:")),
      JSON.stringify({ ...s, fonts }),
    );
    check("no page error", errors.length === 0, errors.join(" | "));
    await context.close();
  }
  {
    const context = await browser.newContext({ ...device, colorScheme: "dark" });
    const page = await context.newPage();
    await page.goto(`${APP}?mode=auto${CAMERA.hash}`);
    await idle(page);
    const auto = await page.evaluate(() => document.documentElement.dataset.mode);
    await page.goto(`${APP}?mode=clair${CAMERA.hash}`);
    await idle(page);
    const forced = await page.evaluate(() => document.documentElement.dataset.mode);
    await page.goto(`${APP}${CAMERA.hash}`);
    await idle(page);
    const keptMode = await page.evaluate(() => document.documentElement.dataset.mode);
    check(
      "the phone's dark mode followed; ?mode=clair wins and is kept",
      auto === "dark" && forced === "light" && keptMode === "light",
      JSON.stringify({ auto, forced, keptMode }),
    );
    await context.close();
  }
  // The sun / moon button (DECISIONS 2026-10-09): a first visit follows the phone, the
  // button names the other mode, a tap switches and keeps it on the device.
  {
    const context = await browser.newContext({ ...device, colorScheme: "dark" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(`${APP}${CAMERA.hash}`);
    await idle(page);
    const state = () =>
      page.evaluate(() => {
        const b = document.querySelector("#mode-toggle");
        const r = b?.getBoundingClientRect();
        return {
          mode: document.documentElement.dataset.mode,
          name: b?.getAttribute("aria-label"),
          size: r ? [Math.round(r.width), Math.round(r.height)] : null,
          stored: localStorage.getItem("lacarte.mode"),
          keys: document.querySelectorAll(".mode-key").length,
        };
      });
    const first = await state();
    await page.locator("#mode-toggle").click();
    await page.waitForTimeout(600);
    const after = await state();
    await page.reload();
    await idle(page);
    const reloaded = await state();
    check(
      "the sun / moon button: the phone's dark first, a tap keeps light, named for the other mode",
      first.mode === "dark" &&
        first.name === "Passer en mode clair" &&
        first.stored === null &&
        first.keys === 0 &&
        first.size?.every((v) => v >= 44) &&
        after.mode === "light" &&
        after.name === "Passer en mode sombre" &&
        after.stored === "clair" &&
        reloaded.mode === "light" &&
        reloaded.name === "Passer en mode sombre" &&
        errors.length === 0,
      JSON.stringify({ first, after, reloaded, errors }),
    );
    await context.close();
  }

  // --- the phone's mode changes mid-session: the map as if opened in that mode, in both
  // directions (the evening switch of a phone on "Automatic", and the morning one) -------
  for (const [first, then] of [
    ["light", "dark"],
    ["dark", "light"],
  ]) {
    const url = `${APP}?mode=auto&cam=${CAMERA.id}${CAMERA.hash}`;
    const live = await browser.newContext({ ...device, colorScheme: first });
    const page = await live.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => m.type() === "warning" && errors.push(m.text()));
    await page.goto(url);
    await idle(page);
    await page.waitForTimeout(1500);
    await idle(page);
    const before = await page.evaluate(() => document.documentElement.dataset.mode);
    // The switch is checked with a camera in focus (its layers, marker and sheet).
    const focused = await page.evaluate(() => document.body.classList.contains("focus"));
    check(`${first} to ${then}: the linked camera is in focus before the switch`, focused);
    await page.emulateMedia({ colorScheme: then });
    await page.waitForFunction((m) => document.documentElement.dataset.mode === m, then);
    await idle(page);
    const switched = await mapPaint(page);
    const view = await page.evaluate(() => ({
      center: window.__map.getCenter(),
      zoom: window.__map.getZoom(),
    }));
    const fresh = await browser.newContext({ ...device, colorScheme: then });
    const other = await fresh.newPage();
    await other.goto(url);
    await idle(other);
    await other.waitForTimeout(1500);
    await other.evaluate((v) => window.__map.jumpTo(v), view);
    await idle(other);
    const opened = await mapPaint(other);
    check(
      `punk ${then}, opened or switched: no road shields layer`,
      [opened, switched].every((s) => !s.some((l) => l.id === "roads_shields")),
    );
    // Communes and départements opaque, opened in that mode or switched to it (the layer
    // comparison above holds their whole paint).
    const areas = { opened: await areaOpacity(other), switched: await areaOpacity(page) };
    check(
      `punk ${then}, opened or switched: départements and communes opaque`,
      [...areas.opened, ...areas.switched].every((a) => a === 1),
      JSON.stringify(areas),
    );
    // Names, one colour: every text of the basemap in the ink on the map's halo, 2 px, the
    // reach labels 17a's yellow tag, on the page opened in that mode and on the switched one.
    const labels = { opened: await labelStyle(other), switched: await labelStyle(page) };
    check(
      `punk ${then}, opened or switched: every label in the ink (${labels.opened.want.ink}) ` +
        `on the halo (${labels.opened.want.halo}), ${labels.opened.want.width} px, unblurred; ` +
        "the reach labels yellow tags",
      oneColour(labels.opened) &&
        oneColour(labels.switched) &&
        labels.opened.want.ink === labels.switched.want.ink,
      `${offColour(labels.opened)} ${offColour(labels.switched)}`.slice(0, 900),
    );
    const differ = opened
      .map((l, i) => [l, switched[i]])
      .filter(([a, b]) => JSON.stringify(a) !== JSON.stringify(b))
      .map(([a, b]) => ({ id: a.id, opened: a, switched: b?.id === a.id ? b : b?.id }));
    check(
      `${first} to ${then} mid-session: every layer as on a page opened in ${then}`,
      before === first && opened.length === switched.length && differ.length === 0,
      differ.length ? JSON.stringify(differ.slice(0, 3)).slice(0, 900) : `${opened.length} layers`,
    );
    // The legend's levels: three samples with their names, in both modes, no sentence (the
    // legend the punk ticket prints, machine.ts renderLegend).
    const levels = async (p) =>
      p.evaluate(() => ({
        names: [...document.querySelectorAll("#legend canvas.sample.level")].map(
          (c) => c.nextElementSibling?.textContent,
        ),
        sentence: /Foncé|Le plus vif/.test(document.querySelector("#legend").textContent),
        pixels: [...document.querySelectorAll("#legend canvas.sample.level")]
          .map((c) => c.toDataURL())
          .join(),
      }));
    const legends = { switched: await levels(page), opened: await levels(other) };
    check(
      `punk legend: three level samples named identifier, reconnaître, détecter (${then}), ` +
        `redrawn by the live switch as on a page opened ${then}`,
      Object.values(legends).every(
        (l) => l.names.join() === "identifier,reconnaître,détecter" && !l.sentence,
      ) && legends.switched.pixels === legends.opened.pixels,
      JSON.stringify(Object.values(legends).map(({ names, sentence }) => ({ names, sentence }))),
    );
    const missing = errors.filter((e) => /missing image|becomes both/.test(e));
    check(
      `${first} to ${then}: no missing image, no ambiguous colour`,
      missing.length === 0,
      missing.join(" | "),
    );
    // Below the street level the switched page marks the focused camera, in the new colours.
    await page.evaluate(() => window.__map.zoomTo(13, { duration: 0 }));
    await idle(page);
    const marker = await page.evaluate(() => {
      // The build's minifier writes #111111 as #111 (theme.normalHex reads it back).
      const token = (name) => {
        const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
        return v.length === 4 ? `#${[...v.slice(1)].map((d) => d + d).join("")}` : v;
      };
      return {
        n: window.__map.queryRenderedFeatures({ layers: ["focus-marker"] }).length,
        ring: window.__map.getPaintProperty("focus-marker-ring", "circle-color"),
        edge: window.__map.getPaintProperty("focus-marker-edge", "circle-stroke-color"),
        halo: token("--map-halo"),
        ink: token("--map-ink"),
      };
    });
    check(
      `after the live switch to ${then}, zoomed out: the focused camera's marker, on the ` +
        `${then} halo, edged in its ink`,
      marker.n === 1 && marker.ring === marker.halo && marker.edge === marker.ink,
      JSON.stringify(marker),
    );
    await live.close();
    await fresh.close();
  }

  // --- changes of mode while tiles load, three in a row: the map ends exactly as a page
  // opened in the last mode (a change met while the style was busy waits for the next
  // idle, and the swap starts from what is painted: main.ts restyle) -------------------
  {
    const url = `${APP}?mode=auto&cam=${CAMERA.id}${CAMERA.hash}`;
    const busy = await browser.newContext({ ...device, colorScheme: "light" });
    const page = await busy.newPage();
    await page.goto(url);
    await idle(page);
    // Far enough for new tiles; their requests start at the next frame.
    const loading = await page.evaluate(
      () =>
        new Promise((r) => {
          const m = window.__map;
          const c = m.getCenter();
          m.jumpTo({ center: [c.lng + 0.03, c.lat + 0.02], zoom: m.getZoom() - 1 });
          requestAnimationFrame(() => r(!m.isStyleLoaded()));
        }),
    );
    for (const scheme of ["dark", "light", "dark"])
      await page.emulateMedia({ colorScheme: scheme });
    await page.waitForFunction(() => document.documentElement.dataset.mode === "dark");
    await idle(page);
    await idle(page);
    const switched = await mapPaint(page);
    const view = await page.evaluate(() => ({
      center: window.__map.getCenter(),
      zoom: window.__map.getZoom(),
    }));
    const fresh = await browser.newContext({ ...device, colorScheme: "dark" });
    const other = await fresh.newPage();
    await other.goto(url);
    await idle(other);
    await other.waitForTimeout(1500);
    await other.evaluate((v) => window.__map.jumpTo(v), view);
    await idle(other);
    const opened = await mapPaint(other);
    const differ = opened
      .map((l, i) => [l, switched[i]])
      .filter(([a, b]) => JSON.stringify(a) !== JSON.stringify(b))
      .map(([a]) => a.id);
    check(
      "three changes of mode while tiles load: the map as a page opened in the last one",
      opened.length === switched.length && differ.length === 0,
      `tiles loading at the first change: ${loading}; ${differ.length ? `differ: ${differ.slice(0, 5).join(", ")}` : `${opened.length} layers`}`,
    );
    await busy.close();
    await fresh.close();
  }

  // --- the review page follows too (it reloads: nothing unsent there) -------------------
  {
    const context = await browser.newContext({ ...device, colorScheme: "light" });
    const page = await context.newPage();
    await page.goto(`${APP}revue.html?mode=auto`);
    await page.waitForFunction(() => document.documentElement.dataset.mode === "light");
    await page.emulateMedia({ colorScheme: "dark" });
    // The page reloads: read it once the new document has its tokens.
    let bg = "";
    for (let i = 0; i < 30 && bg !== "#1c1a1f"; i++) {
      await page.waitForTimeout(500);
      bg = await page
        .evaluate(() =>
          document.documentElement.dataset.mode === "dark"
            ? getComputedStyle(document.documentElement).getPropertyValue("--bg").trim()
            : "",
        )
        .catch(() => "");
    }
    const followed = bg !== "";
    check("/revue: dark mid-session, its tokens too", followed && bg === "#1c1a1f", bg);
    await context.close();
  }

  // --- a camera in focus, then zooming out (punk): below the street level the camera is
  // marked and the rest of the map is drawn as without focus; a tap on the marker goes
  // back to its field; Escape still leaves the focus ------------------------------------
  {
    const context = await browser.newContext({
      ...device,
      colorScheme: "light",
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(`${APP}?mode=clair&cam=${CAMERA.id}${CAMERA.hash}`);
    await idle(page);
    await page.waitForFunction(() => document.body.classList.contains("focus"), null, {
      timeout: 20000,
    });
    await idle(page);
    const at = await page.evaluate(
      (id) =>
        window.__map
          .querySourceFeatures("detail", { sourceLayer: "cameras" })
          .find((c) => c.properties.id === id)?.geometry.coordinates,
      CAMERA.id,
    );
    /** Zoom as a pinch on the camera (it keeps its place on screen), then what is drawn:
     * the opacity the streets and portions have at this zoom (MapLibre's evaluated paint),
     * and the focused camera's marker and pictogram rendered. */
    const state = async (z) => {
      await page.evaluate(
        ([zz, around]) => window.__map.zoomTo(zz, { around, duration: 0 }),
        [z, at],
      );
      await idle(page);
      return page.evaluate(() => {
        const m = window.__map;
        const opacity = (id, prop) =>
          m.getLayer(id).paint.get(prop).evaluate({ type: 2, properties: {} }, {});
        const n = (id) => m.queryRenderedFeatures({ layers: [id] }).length;
        const c = m
          .getLayer("portions")
          .paint.get("line-color")
          .evaluate({ type: 2, properties: { lv: 1 } }, {});
        const hex = (v) =>
          Math.round(v * 255)
            .toString(16)
            .padStart(2, "0");
        return {
          focus: document.body.classList.contains("focus"),
          portions: opacity("portions", "line-opacity"),
          portionColour: `#${hex(c.r)}${hex(c.g)}${hex(c.b)}`,
          dimColour: window.__palette().fieldDimLine,
          streets: opacity("streets", "line-opacity"),
          marker: n("focus-marker"),
          selected: n("camera-selected"),
        };
      });
    };
    /** The map's own pixels at zoom `z` centred on the camera: its WebGL canvas, read in the
     * frame that drew it (no overlay, the sheet's included), kept in the page as `name`. */
    const shoot = async (z, name) => {
      await page.evaluate(([zz, c]) => window.__map.jumpTo({ center: c, zoom: zz }), [z, at]);
      await idle(page);
      await page.evaluate(
        (n) =>
          new Promise((resolve) => {
            const m = window.__map;
            m.once("render", () => {
              window.__shots ??= {};
              window.__shots[n] = m.getCanvas().toDataURL("image/png");
              resolve();
            });
            m.triggerRepaint();
          }),
        name,
      );
    };
    /** Pixels of two shots that differ outside a disc of `r` CSS px on the camera (its
     * marker: 23.5 px with its edge), and inside it. */
    const differing = (a, b, r) =>
      page.evaluate(
        async ([a, b, c, r]) => {
          const load = async (url) => {
            const image = await createImageBitmap(await (await fetch(url)).blob());
            const canvas = new OffscreenCanvas(image.width, image.height);
            const ctx = canvas.getContext("2d");
            ctx.drawImage(image, 0, 0);
            return ctx.getImageData(0, 0, image.width, image.height);
          };
          const [x, y] = [await load(window.__shots[a]), await load(window.__shots[b])];
          const m = window.__map;
          const ratio = x.width / m.getCanvas().clientWidth;
          const p = m.project(c);
          let n = 0;
          let inside = 0;
          for (let j = 0; j < x.height; j++)
            for (let i = 0; i < x.width; i++) {
              const k = (j * x.width + i) * 4;
              if (Math.hypot(i / ratio - p.x, j / ratio - p.y) < r) {
                // The marker's own pixels: they differ, or the shots are blank.
                if (x.data[k] !== y.data[k] || x.data[k + 1] !== y.data[k + 1]) inside++;
                continue;
              }
              if (
                x.data[k] !== y.data[k] ||
                x.data[k + 1] !== y.data[k + 1] ||
                x.data[k + 2] !== y.data[k + 2]
              )
                n++;
            }
          return { differing: n, of: x.width * x.height, same: x.width === y.width, inside };
        },
        [a, b, at, r],
      );
    const focused = {};
    for (const z of [16, 14.6, 13, 11]) focused[z] = await state(z);
    // A tap (a click on a wide screen) on the marker: back to the field, still in focus
    // (the camera where the sheet leaves it in view, as the zoom around it kept it).
    const point = await page.evaluate((p) => window.__map.project(p), at);
    const box = await page.locator("#map canvas").boundingBox();
    const [x, y] = [box.x + point.x, box.y + point.y];
    if (engine === "webkit") await page.touchscreen.tap(x, y);
    else await page.mouse.click(x, y);
    await page.waitForTimeout(1500);
    await idle(page);
    const back = await page.evaluate(() => ({
      zoom: window.__map.getZoom(),
      focus: document.body.classList.contains("focus"),
    }));
    check(
      "focus, zoomed out: a tap on the marker goes back to the field, still in focus",
      back.focus && back.zoom >= 15,
      JSON.stringify(back),
    );
    for (const z of [13, 11]) await shoot(z, `focus-${z}`);
    await page.keyboard.press("Escape");
    const free = {};
    for (const z of [11, 13, 14.6, 16]) free[z] = await state(z);
    for (const z of [13, 11]) await shoot(z, `free-${z}`);
    // Between the portions' fade-in and the fields (z12-15) the focus dims nothing: the
    // portions at 13 and 14.6, the grey streets at 14.6 (they start at 14), each drawn
    // (not a 0 = 0) and as without focus. Dimmed at every zoom, they were 0.15 and 0.12.
    for (const z of [14.6, 13]) {
      const [f, o] = [focused[z], free[z]];
      check(
        `focus, zoomed out to ${z}: portions${z > 14 ? " and streets" : ""} drawn as without focus`,
        f.focus &&
          f.portions === 1 &&
          o.portions === 1 &&
          (z < 14 || (f.streets === o.streets && f.streets >= 0.8)),
        JSON.stringify({ focus: f, without: o }),
      );
    }
    // The map itself: the same pixels as without focus but for the marker's disc (with the
    // old dimming, every filmed street at 13 differed).
    for (const z of [13, 11]) {
      const d = await differing(`focus-${z}`, `free-${z}`, 28);
      check(
        `focus, zoomed out to ${z}: the camera's marker drawn, the map's pixels as without ` +
          "focus outside it",
        focused[z].marker === 1 && d.same && d.differing === 0 && d.inside > 0,
        JSON.stringify({ marker: focused[z].marker, ...d }),
      );
    }
    const [f16, o16] = [focused[16], free[16]];
    // The other cameras' streets as their fields: one opaque dimmed colour, no opacity
    // (DECISIONS 2026-10-08, « The palette of the second round is validated »).
    check(
      "focus at the street level: the camera's own pictogram, no marker, the rest dimmed, " +
        "the streets in an opaque dimmed colour",
      f16.marker === 0 &&
        f16.selected === 1 &&
        f16.portions === o16.portions &&
        f16.portionColour === f16.dimColour &&
        o16.portionColour !== o16.dimColour &&
        f16.streets < o16.streets,
      JSON.stringify({ focus: f16, without: o16 }),
    );
    check(
      "Escape below the street level leaves the focus, the marker goes",
      !free[11].focus && free[11].marker === 0 && free[13].marker === 0,
      JSON.stringify(free[11]),
    );
    check("focus and zoom: no page error", errors.length === 0, errors.join(" | "));
    await context.close();
  }

  // --- « Revenir à la caméra »: the keyboard's and screen readers' way back to the field
  // from below the street level (punk), as a tap on the marker ------------------------------
  {
    const context = await browser.newContext({
      ...device,
      colorScheme: "light",
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(`${APP}?mode=clair&cam=${CAMERA.id}${CAMERA.hash}`);
    await idle(page);
    await page.waitForFunction(() => document.body.classList.contains("focus"), null, {
      timeout: 20000,
    });
    await idle(page);
    // A real button, named by its text.
    const back = page.getByRole("button", { name: "Revenir à la caméra" });
    const atStreet = await back.isVisible();
    await page.evaluate(() => window.__map.zoomTo(13, { duration: 0 }));
    await idle(page);
    const far = await back.isVisible();
    // By the keyboard: the next stop after the distance tickets (one stop, a radiogroup:
    // DECISIONS 2026-10-08, « Punk focus… »), the close button and the tickets before them
    // (Safari moves the focus with Option+Tab).
    await page.focus('#sheet .ticket[aria-checked="true"]');
    await page.keyboard.press(engine === "webkit" ? "Alt+Tab" : "Tab");
    const reached = await page.evaluate(
      () => document.activeElement?.classList.contains("sheet-back") === true,
    );
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1500);
    await idle(page);
    const after = await page.evaluate(() => ({
      zoom: window.__map.getZoom(),
      focus: document.body.classList.contains("focus"),
      active: `${document.activeElement?.tagName}.${document.activeElement?.className}`,
    }));
    const gone = !(await back.isVisible());
    check(
      "« Revenir à la caméra »: hidden at the street level, shown at 13, reached by the " +
        "keyboard; Enter goes back to the field, still in focus, the button gone and the " +
        "focus on the sheet's headline",
      !atStreet &&
        far &&
        reached &&
        after.zoom >= 15 &&
        after.focus &&
        gone &&
        after.active === "H2.headline" &&
        errors.length === 0,
      JSON.stringify({ atStreet, far, reached, ...after, gone, errors }),
    );
    await context.close();
  }

  // --- the focused camera's marker kept clear of the panels after a gesture (punk): a zoom
  // out that leaves it under the estimate bar brings it just back under it, at once under
  // reduced motion; our own moves never do, nor a marker off the screen ----------------------
  {
    const context = await browser.newContext({
      ...device,
      colorScheme: "light",
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(`${APP}?mode=clair&cam=${CAMERA.id}${CAMERA.hash}`);
    await idle(page);
    await page.waitForFunction(() => document.body.classList.contains("focus"), null, {
      timeout: 20000,
    });
    await idle(page);
    const at = await page.evaluate(
      (id) =>
        window.__map
          .querySourceFeatures("detail", { sourceLayer: "cameras" })
          .find((c) => c.properties.id === id)?.geometry.coordinates,
      CAMERA.id,
    );
    // Gestures are faked engine-independently: MapLibre's handlers end a pinch, a drag, the
    // wheel or a zoom button with a moveend carrying the DOM event (handler_manager.ts,
    // navigation_control.ts); a zoom with that event data ends the same way.
    const gesture = { originalEvent: "wheel" };
    const run = (steps) =>
      page.evaluate(
        async ([at, steps, gesture]) => {
          const m = window.__map;
          // The map's answer to a gesture starts at the next frame (main.ts keepMarkerFree).
          const frames = () =>
            new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          // The header: the estimate bar, and beside it the punk ticket unless it slid away
          // under an open sheet on a phone (main.ts freePadding, theme/punk/map.css).
          const bar = {
            bottom: Math.max(
              ...["estimate", "ticket"].map((id) => {
                const el = document.getElementById(id);
                return el && getComputedStyle(el).visibility !== "hidden"
                  ? el.getBoundingClientRect().bottom
                  : 0;
              }),
            ),
          };
          const out = { bar: bar.bottom, steps: [] };
          let moves = [];
          const onEnd = (e) => moves.push(e.originalEvent ? "gesture" : "ours");
          m.on("moveend", onEnd);
          for (const s of steps) {
            const data = s.gesture ? { originalEvent: new Event(gesture.originalEvent) } : {};
            moves = [];
            let under = null;
            m.once("zoomend", () => {
              under = m.project(at).y;
            });
            if (s.place !== undefined) {
              // Our own move: the camera `place` px under the bar.
              m.jumpTo({ zoom: s.zoom });
              m.panBy([0, m.project(at).y - (bar.bottom + s.place)], { duration: 0 });
            } else if (s.zoom !== undefined) {
              // A zoom around the map's top edge, above the camera (as a pinch near it).
              const q = m.project(at);
              m.zoomTo(s.zoom, { around: m.unproject([q.x, 0]), duration: 0 }, data);
            } else {
              m.panBy([0, s.pan], { duration: 0 }, data);
            }
            await frames();
            const p = m.project(at);
            out.steps.push({ under, x: p.x, y: p.y, zoom: m.getZoom(), moves: moves.join() });
          }
          m.off("moveend", onEnd);
          return out;
        },
        [at, steps, gesture],
      );
    // The marker's top edge 12 px under the bar (the header's bottom: the bar, and the punk
    // ticket beside it), its radius 23.5 px (layers.ts).
    const free = (r) => r.bar + 12 + 23.5;
    // Our own moves: the camera 30 px under the bar (the marker across its lower edge), then
    // our own zoom out around the top: left where they put it.
    const ours = await run([{ place: 30, zoom: 13 }, { zoom: 12 }]);
    const [placed, zoomed] = ours.steps;
    check(
      "focus marker: our own moves leave it where they put it, under the bar included",
      Math.abs(placed.y - (ours.bar + 30)) < 1 &&
        zoomed.y < ours.bar &&
        zoomed.zoom === 12 &&
        zoomed.moves === "ours",
      JSON.stringify(ours),
    );
    // The gesture: from the same place, a zoom out to 12 around the top edge leaves the
    // marker under the bar; one move of ours (no loop) brings it to the free part's top.
    const g = await run([
      { place: 30, zoom: 13 },
      { zoom: 12, gesture: true },
    ]);
    const [before, after] = g.steps;
    await idle(page);
    const settled = await page.evaluate((at) => window.__map.project(at), at);
    check(
      "focus marker: a gesture leaving it under the estimate bar brings it just under it " +
        "(at once under reduced motion), the zoom kept, one move of ours, then no more",
      after.under < g.bar &&
        Math.abs(after.y - free(g)) < 1 &&
        Math.abs(after.x - before.x) < 1 &&
        after.zoom === 12 &&
        after.moves === "gesture,ours" &&
        Math.abs(settled.y - after.y) < 1,
      JSON.stringify({ ...g, settled }),
    );
    // A pinch released with a slight twist: MapLibre ends it, then eases back to north with
    // a move of its own (no DOM event, still running at the next frame); the marker is
    // brought in once the map is still (main.ts nudgePending).
    const snap = await page.evaluate(async (at) => {
      const m = window.__map;
      // The header: the estimate bar, and beside it the punk ticket (main.ts freePadding).
      const bar = {
        bottom: Math.max(
          ...["estimate", "ticket"].map((id) => {
            const el = document.getElementById(id);
            return el && getComputedStyle(el).visibility !== "hidden"
              ? el.getBoundingClientRect().bottom
              : 0;
          }),
        ),
      };
      m.jumpTo({ zoom: 13, bearing: 0 });
      m.panBy([0, m.project(at).y - (bar.bottom + 30)], { duration: 0 });
      m.jumpTo({ bearing: 5 });
      const q = m.project(at);
      m.zoomTo(
        12,
        { around: m.unproject([q.x, 0]), duration: 0 },
        { originalEvent: new Event("touchend") },
      );
      m.resetNorth({ duration: 300, essential: true });
      await new Promise((r) => setTimeout(r, 1200));
      const p = m.project(at);
      return { bar: bar.bottom, y: p.y, bearing: m.getBearing(), moving: m.isMoving() };
    }, at);
    check(
      "focus marker: a pinch ending with MapLibre's ease back to north still brings it in",
      Math.abs(snap.y - free(snap)) < 1.5 && snap.bearing === 0 && !snap.moving,
      JSON.stringify(snap),
    );
    // A gesture that takes the marker off the screen: the user moved away, left alone.
    const away = await run([{ pan: -2000, gesture: true }]);
    check(
      "focus marker: a gesture taking it off the screen leaves it there",
      away.steps[0].y > 1500 && away.steps[0].moves === "gesture",
      JSON.stringify(away),
    );
    check("focus marker kept in view: no page error", errors.length === 0, errors.join(" | "));
    await context.close();
  }

  // --- buttons (theme/punk/buttons.css): their transitions listed and short, a hover that
  // moves (where a pointer hovers) but neither selects nor recolours, nor tilts a pressed
  // button, a press that sinks a floating button onto its shadow, nothing moving under less
  // motion, every button of the map and the sheet 44 px at least -------------------------
  for (const motion of ["no-preference", "reduce"]) {
    const context = await browser.newContext({ ...device, reducedMotion: motion });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(`${APP}?mode=clair&cam=${CAMERA.id}${CAMERA.hash}`);
    await idle(page);
    await page.waitForSelector("#sheet:not([hidden]) .close", { timeout: 20000 });
    // The camera sheet's rows are not buttons (lot 3.2): its × stands for its buttons.
    const SAMPLE = ["#estimate button", "#fab-locate", "#sheet .close"];
    const motions = await page.evaluate(
      (sel) =>
        sel.map((s) => {
          const c = getComputedStyle(document.querySelector(s));
          const seconds = (d) =>
            d.endsWith("ms") ? Number.parseFloat(d) / 1000 : Number.parseFloat(d);
          return {
            s,
            props: c.transitionProperty,
            longest: Math.max(...c.transitionDuration.split(",").map((d) => seconds(d.trim()))),
          };
        }),
      SAMPLE,
    );
    if (motion === "no-preference")
      check(
        "buttons: transitioned properties listed (never all), each 400 ms at most",
        motions.every(
          (m) => !/\ball\b/.test(m.props) && /translate/.test(m.props) && m.longest <= 0.4,
        ),
        JSON.stringify(motions),
      );
    else
      check(
        "buttons, less motion: no transition",
        motions.every((m) => m.longest === 0),
        JSON.stringify(motions),
      );

    /** A button's moves and colours as computed, `aria-pressed` with them. */
    const look = (sel) =>
      page.evaluate((s) => {
        const el = document.querySelector(s);
        const c = getComputedStyle(el);
        return {
          translate: c.translate,
          rotate: c.rotate,
          scale: c.scale,
          shadow: c.boxShadow,
          bg: c.backgroundColor,
          fg: c.color,
          border: c.borderColor,
          pressed: el.getAttribute("aria-pressed"),
        };
      }, sel);
    const settle = () => page.waitForTimeout(500);
    const hovers = await page.evaluate(() => matchMedia("(hover: hover)").matches);
    const off = '#estimate button[aria-pressed="false"]';
    const on = '#estimate button[aria-pressed="true"]';
    const offRest = await look(off);
    const onRest = await look(on);
    await page.hover(off);
    await settle();
    const offHover = await look(off);
    await page.hover(on);
    await settle();
    const onHover = await look(on);
    const sameColours = (a, b) => a.bg === b.bg && a.fg === b.fg && a.border === b.border;
    check(
      `buttons: a hover never selects nor recolours (${hovers ? "hover: hover" : "no hover"})`,
      offHover.pressed === "false" &&
        sameColours(offRest, offHover) &&
        sameColours(onRest, onHover),
      JSON.stringify({ offRest, offHover, onRest, onHover }),
    );
    // A pressed pastille keeps the tilt it rests at (17a draws « Standard » at -8°): a hover
    // grows it and tilts it no further.
    if (motion === "no-preference" && hovers)
      check(
        "buttons: a hover tilts and grows the estimate button, a pressed one grows untilted",
        offHover.rotate === "8deg" &&
          offHover.scale === "1.06" &&
          onHover.rotate === onRest.rotate &&
          onHover.scale === "1.06",
        JSON.stringify({ offHover, onRest, onHover }),
      );
    // As at rest (17a's pastilles rest tilted, and the other smaller, where motion is
    // welcome; straight under less motion).
    else
      check(
        `buttons: no move on hover (${motion === "reduce" ? "less motion" : "no hover"})`,
        [
          [offRest, offHover],
          [onRest, onHover],
        ].every(
          ([r, l]) => l.rotate === r.rotate && l.scale === r.scale && l.translate === r.translate,
        ) &&
          (motion !== "reduce" ||
            [offHover, onHover].every(
              (l) => l.rotate === "none" && l.scale === "none" && l.translate === "none",
            )),
        JSON.stringify({ offRest, offHover, onRest, onHover }),
      );
    if (motion === "no-preference") {
      // Every button shown on the map and in the camera sheet (MapLibre's own controls
      // apart), 44 px at least each way; but, with a mouse (a fine pointer), the punk
      // ticket's links and the camera sheet's links and ×: 17a's 28 px (the × 36), 24 px
      // at least (WCAG 2.5.8), 44 under a finger.
      const fine = await page.evaluate(() => matchMedia("(pointer: fine)").matches);
      const KNOWN = fine
        ? {
            "#fab-filters": "the ticket's « Filtres et légende », 17a's 28 px with a mouse",
            "#list-open": "the ticket's « Liste des caméras », 17a's 28 px with a mouse",
            "#sheet .sheet-head .close": "the sheet's ×, 17a's 36 px with a mouse",
            "#sheet .sheet-paper :is(.sheet-link, .sheet-back, .osm-edit)":
              "the sheet's links, 28 px with a mouse",
            "#sheet .part-slot > :is(.part-link, .part-move)":
              "the sheet's « Déplacer » and « Vos contributions », links, 28 px with a mouse",
          }
        : {};
      const small = await page.evaluate(
        (known) =>
          [...document.querySelectorAll("button")]
            .filter((b) => !b.closest(".maplibregl-ctrl") && b.getClientRects().length > 0)
            .map((b) => {
              const r = b.getBoundingClientRect();
              const as = known.find((s) => b.matches(s));
              return {
                b: b.id || b.className || b.textContent.trim(),
                as,
                w: r.width,
                h: r.height,
              };
            })
            .filter((r) => r.w < 44 || r.h < 44),
        Object.keys(KNOWN),
      );
      const known = small.filter((r) => r.as && r.w >= 24 && r.h >= 24);
      check(
        "buttons: every button of the map and the sheet 44 px at least",
        small.length === known.length,
        JSON.stringify({ small, known: known.map((r) => `${r.b}: ${KNOWN[r.as]}`) }),
      );
    }
    // The press: the sheet closed (on a wide screen it covers the floating buttons), the
    // mouse held down on "Me localiser" (it asks for nothing until the button is released).
    await page.keyboard.press("Escape");
    await page.waitForSelector("#sheet", { state: "hidden", timeout: 10000 }).catch(() => null);
    await page.mouse.move(0, 0);
    await settle();
    const fabRest = await look("#fab-locate");
    const box = (await page.locator("#fab-locate").boundingBox()) ?? { x: 0, y: 0, width: 0 };
    const [cx, cy] = [box.x + box.width / 2, box.y + box.height / 2];
    const hit = await page.evaluate(
      ([x, y]) => Boolean(document.elementFromPoint(x, y)?.closest("#fab-locate")),
      [cx, cy],
    );
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await settle();
    const fabDown = await look("#fab-locate");
    await page.mouse.move(0, 0);
    await page.mouse.up();
    const flat = /0px 0px 0px$|^rgb\([^)]+\) 0px 0px 0px/.test(fabDown.shadow);
    if (motion === "no-preference")
      check(
        "buttons: a press sinks a floating button 3 px onto its shadow, which shrinks to none",
        hit && fabDown.translate === "3px 3px" && flat && fabRest.shadow !== fabDown.shadow,
        JSON.stringify({ hit, fabRest, fabDown }),
      );
    else
      check(
        "buttons, less motion: a press does not move, its shadow still shrinks",
        hit && fabDown.translate === "none" && fabDown.rotate === "none" && flat,
        JSON.stringify({ hit, fabRest, fabDown }),
      );
    check(`buttons (${motion}): no page error`, errors.length === 0, errors.join(" | "));
    await context.close();
  }

  // --- less motion, and the focus ---------------------------------------------------------
  {
    const context = await browser.newContext({ ...device, reducedMotion: "reduce" });
    const page = await context.newPage();
    await page.goto(`${APP}${CAMERA.hash}`);
    await idle(page);
    const dur = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--dur-sheet").trim(),
    );
    check("less motion: the sheet does not animate", dur === "0s", dur);
    let outline = null;
    for (let i = 0; i < 6 && !outline; i++) {
      // Safari (WebKit) moves the focus to buttons with Option+Tab, as macOS by default.
      await page.keyboard.press(engine === "webkit" ? "Alt+Tab" : "Tab");
      outline = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body || el.tagName === "CANVAS") return null;
        const s = getComputedStyle(el);
        return `${el.tagName} ${s.outlineStyle} ${s.outlineWidth}`;
      });
    }
    check("keyboard focus: a dashed 3 px outline", /dashed 3px$/.test(outline ?? ""), outline);
    // 17a's round pastilles: the chosen one's edge solid and its ✓ shown, the other's
    // edge dashed and no ✓ (machine.ts estimateBar), whatever their colours.
    const bar = await page.evaluate(() => {
      const look = (b) => ({
        edge: getComputedStyle(b).borderTopStyle,
        check: b.querySelector(".pastille-check")?.getClientRects().length > 0,
      });
      return {
        overflow: getComputedStyle(document.getElementById("estimate")).overflow,
        pressed: look(document.querySelector('#estimate [aria-pressed="true"]')),
        other: look(document.querySelector('#estimate [aria-pressed="false"]')),
      };
    });
    check(
      "estimate bar: focus not clipped, the pressed button framed, not only coloured",
      bar.overflow === "visible" &&
        bar.pressed.edge === "solid" &&
        bar.pressed.check &&
        bar.other.edge === "dashed" &&
        !bar.other.check,
      JSON.stringify(bar),
    );
    await context.close();
  }
} finally {
  await browser.close();
  server.kill();
}
const failed = checks.filter((c) => !c.ok);
console.log(`${checks.length - failed.length}/${checks.length} checks passed`);
process.exit(failed.length ? 1 : 0);
