// Captures of the launch lot's legal and closed screens in punk, for the author's stop
// point: the four legal pages (`?page=`), where they are linked (the welcome's foot,
// « Compte »), the pseudonym screen with its acceptance line, and contributions closed (the
// map without the account square, the camera sheet without « Modifier » nor « Toujours
// là ? », the welcome without « Participer »); on a phone (390 × 845) and a wide
// screen (960 × 581), at scale 2, in light and dark. With --only liens, the three ways to
// the pages the author asked for (2026-10-14), each at its links and one page opened from
// it: the welcome of a first visit, the « ? » window (the welcome opened again), « Compte »
// signed out and signed in; then the Sources page at its link to /licences.txt, and the
// map's corner credit (unfolded on a phone). The API is simulated (GET /api/config, a
// visitor, the pseudonym's sign-up). Run it on a build made with
// VITE_CONTACT_EMAIL=contact@example.org (a documentation domain, RFC 2606): the pages
// show the address as the site will. The output folder must be outside the repository.
//   node bench/shots-legal.mjs --out DIR [--port N] [--only liens]
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { chromium, devices, webkit } from "playwright";
import { mockApi, OSM_SIGNUP } from "./account.mjs";
import { preview, requireTiles, WEB } from "./dist.mjs";

const args = process.argv.slice(2);
const arg = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const OUT = arg("--out", null);
if (!OUT || !relative(resolve(WEB, ".."), resolve(OUT)).startsWith("..")) {
  console.log("FAIL --out DIR, outside the repository");
  process.exit(2);
}
requireTiles("ci");
const PORT = Number(arg("--port", "4472"));
const ONLY = arg("--only", null);
const APP = `http://localhost:${PORT}/`;
const STREET = [2.2377, 48.8977];
const DEVICES = {
  phone: { ...devices["iPhone 14"], viewport: { width: 390, height: 845 }, deviceScaleFactor: 2 },
  wide: { viewport: { width: 960, height: 581 }, deviceScaleFactor: 2 },
};
const OPEN = { contributions: true, publish: false, publisher: null };
const CLOSED = { contributions: false, publish: false, publisher: null };
mkdirSync(OUT, { recursive: true });

/** A device in `mode`, the API answering `config`; `seen`: the welcome already seen. */
async function open(
  browser,
  device,
  mode,
  config,
  { seen = true, osm = null, signed = false } = {},
) {
  const context = await browser.newContext({
    ...DEVICES[device],
    locale: "fr-FR",
    colorScheme: mode,
    reducedMotion: "reduce",
  });
  await context.addInitScript((s) => {
    try {
      localStorage.setItem("lacarte.fonts", "1");
      if (s) localStorage.setItem("lacarte.welcome", "1");
    } catch {}
  }, seen);
  // GET /api/config first: mockApi's own routes answer the rest (a visitor).
  await mockApi(context, { osm, signed });
  await context.route("**/api/config", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(config) }),
  );
  return { context, page: await context.newPage() };
}

const settle = async (page) => {
  await page.waitForFunction(() => window.__map?.loaded(), null, { timeout: 60000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(600);
};

let n = 0;
async function shot(page, name) {
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  n++;
  console.log(`${name}.png`);
}

/** The body of the dialog or sheet open, scrolled to its end. */
const toEnd = (page, sel) =>
  page.evaluate((s) => {
    const body = document.querySelector(s);
    body.scrollTop = body.scrollHeight;
  }, sel);

/** The three ways to the legal pages, a page opened from each, the notices' link, the
 * corner credit. */
async function paths(browser, device, mode, tag) {
  const at = `#16/${STREET[1]}/${STREET[0]}`;
  // The welcome of a first visit, then « Mentions légales » from it.
  {
    const { context, page } = await open(browser, device, mode, OPEN, { seen: false });
    await page.goto(`${APP}${at}`);
    await page.waitForSelector("#welcome [role=dialog]");
    await settle(page);
    await toEnd(page, "#welcome .welcome-body");
    await page.waitForTimeout(300);
    await shot(page, `${tag}-1-accueil-liens`);
    await page.locator("#welcome .welcome-legal a", { hasText: "Mentions légales" }).click();
    await page.waitForSelector("#legal [role=dialog]");
    await page.waitForTimeout(300);
    await shot(page, `${tag}-1-accueil-mentions`);
    await context.close();
  }
  // The « ? » window, then « Sources et licences » from it, at its notices' link.
  {
    const { context, page } = await open(browser, device, mode, OPEN);
    await page.goto(`${APP}${at}`);
    await settle(page);
    await page.locator("#welcome-square").click();
    await page.waitForSelector("#welcome [role=dialog]");
    await toEnd(page, "#welcome .welcome-body");
    await page.waitForTimeout(300);
    await shot(page, `${tag}-2-question-liens`);
    await page.locator("#welcome .welcome-legal a", { hasText: "Sources et licences" }).click();
    await page.waitForSelector("#legal [role=dialog]");
    await page
      .locator('#legal a[href$="licences.txt"]')
      .evaluate((a) => a.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(300);
    await shot(page, `${tag}-2-question-sources-licences`);
    await context.close();
  }
  // « Compte », signed out and signed in, then « Confidentialité » from it.
  for (const signed of [false, true]) {
    const { context, page } = await open(browser, device, mode, OPEN, {
      osm: { login: true },
      signed,
    });
    await page.goto(`${APP}${at}`);
    await settle(page);
    await page.locator("#account-square").click();
    await page.waitForSelector("#sheet .account-legal", { timeout: 20000 });
    await page.waitForTimeout(500);
    await page.locator("#sheet .account-legal").evaluate((n) => n.scrollIntoView({ block: "end" }));
    await page.waitForTimeout(300);
    const who = signed ? "connecte" : "visiteur";
    await shot(page, `${tag}-3-compte-${who}-liens`);
    if (!signed) {
      await page.locator("#sheet .account-legal a", { hasText: "Confidentialité" }).click();
      await page.waitForSelector("#legal [role=dialog]");
      await page.waitForTimeout(300);
      await shot(page, `${tag}-3-compte-confidentialite`);
    }
    await context.close();
  }
  // The map's corner credit (a phone unfolds it from its « ⓘ »).
  {
    const { context, page } = await open(browser, device, mode, OPEN);
    await page.goto(`${APP}${at}`);
    await settle(page);
    if (device === "phone") await page.locator("#attrib-toggle").click();
    await page.waitForTimeout(300);
    await shot(page, `${tag}-4-credit`);
    await context.close();
  }
}

const server = spawn("npx", preview(PORT), { cwd: WEB, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 2500));
const browsers = { phone: await webkit.launch(), wide: await chromium.launch() };
try {
  for (const device of ["phone", "wide"])
    for (const mode of ["light", "dark"]) {
      const browser = browsers[device];
      const tag = `${device}-${mode}`;
      if (ONLY === "liens") {
        await paths(browser, device, mode, tag);
        continue;
      }
      // The four pages, over the map.
      for (const slug of ["mentions-legales", "confidentialite", "conditions", "sources"]) {
        const { context, page } = await open(browser, device, mode, OPEN);
        await page.goto(`${APP}?page=${slug}#16/${STREET[1]}/${STREET[0]}`);
        await settle(page);
        await page.waitForSelector("#legal [role=dialog]");
        await shot(page, `${tag}-page-${slug}`);
        await context.close();
      }
      // The pseudonym screen, back from OpenStreetMap the first time.
      {
        const { context, page } = await open(browser, device, mode, OPEN, {
          osm: { login: true, signup: { ...OSM_SIGNUP } },
        });
        await page.goto(`${APP}?osm=signup#16/${STREET[1]}/${STREET[0]}`);
        await page.waitForSelector("#account-signup-accept", { timeout: 30000 });
        await settle(page);
        await shot(page, `${tag}-pseudonyme`);
        await context.close();
      }
      // Where the pages are linked: the foot of the welcome, the foot of « Compte ».
      {
        const { context, page } = await open(browser, device, mode, OPEN, { seen: false });
        await page.goto(`${APP}#16/${STREET[1]}/${STREET[0]}`);
        await page.waitForSelector("#welcome [role=dialog]");
        await settle(page);
        await page.evaluate(() => {
          const body = document.querySelector(".welcome-body");
          body.scrollTop = body.scrollHeight;
        });
        await page.waitForTimeout(300);
        await shot(page, `${tag}-accueil-liens`);
        await context.close();
      }
      {
        const { context, page } = await open(browser, device, mode, OPEN, {
          osm: { login: true },
        });
        await page.goto(`${APP}#16/${STREET[1]}/${STREET[0]}`);
        await settle(page);
        await page.locator("#account-square").click();
        await page.waitForSelector("#sheet .account-legal");
        await page.waitForTimeout(500);
        await shot(page, `${tag}-compte`);
        await context.close();
      }
      // Contributions closed: the map, a camera's sheet, the welcome of a first visit.
      {
        const { context, page } = await open(browser, device, mode, CLOSED);
        await page.goto(`${APP}#16/${STREET[1]}/${STREET[0]}`);
        await settle(page);
        await shot(page, `${tag}-ferme-carte`);
        await context.close();
      }
      {
        const { context, page } = await open(browser, device, mode, CLOSED);
        await page.goto(`${APP}#18/${STREET[1]}/${STREET[0]}`);
        await settle(page);
        const cam = await page.evaluate(() => {
          const f = window.__map
            .querySourceFeatures("detail", { sourceLayer: "cameras" })
            .find((c) => /^[nwr]\d+$/.test(String(c.properties.id)));
          return { id: String(f.properties.id), at: f.geometry.coordinates };
        });
        await page.goto(`${APP}?cam=${cam.id}#18/${cam.at[1]}/${cam.at[0]}`);
        await page.waitForSelector("#sheet .sheet-paper .headline", { timeout: 30000 });
        await settle(page);
        await shot(page, `${tag}-ferme-fiche`);
        await context.close();
      }
      {
        const { context, page } = await open(browser, device, mode, CLOSED, { seen: false });
        await page.goto(`${APP}#16/${STREET[1]}/${STREET[0]}`);
        await page.waitForSelector("#welcome [role=dialog]");
        await settle(page);
        await shot(page, `${tag}-ferme-accueil`);
        await context.close();
      }
    }
} finally {
  await browsers.phone.close();
  await browsers.wide.close();
  server.kill();
}
console.log(`${n} captures in ${OUT}`);
