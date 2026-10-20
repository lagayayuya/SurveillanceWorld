// The account's screens in punk (lot « comptes », board 25a) with the API simulated as its
// contract says (not in the repository): smoke.mjs runs
// them on a wide screen, smoke-mobile.mjs on a phone. Signed out: the camera sheet's
// « Modifier » and « Toujours là ? » greyed (aria-disabled, described by « Connectez-vous
// pour participer »), no « Vos contributions », « Corriger sur OpenStreetMap »; a tap or Enter
// on them opens « Compte »; the account square and « Compte » without OpenStreetMap (its
// stamp, the mailto's subject, no password form, axe); the password form only at
// `?compte=motdepasse` (« Entrer », its error: role alert, fields marked, axe; « ← Retour »);
// « ＋ Ajouter » → « Compte »; a send answered 401 kept, « Reconnectez-vous pour envoyer 1
// contribution » → « Compte », sent once signed in. Sign-in with OpenStreetMap (OSM lot 1,
// osm-lot1-contrat.md; board 28a since the lot of 2026-10-11): « Compte » with its one key
// (the flow started with this page as `then`; openstreetmap.org never called), a greyed
// button's « Compte » coming back to its camera (`then` with `?cam=`, and `?osm=signed&cam=`
// opens the camera's sheet signed in), `?osm=denied`, `?osm=failed` with its reason under
// `?debug=1` only, `?osm=signup` expired, « Choisissez votre pseudonyme » (axe, its errors,
// the account made). Every return from OpenStreetMap (the author's point 1 of 2026-10-12)
// shows « Chargement de votre compte » (board 2c, role status) in the sheet first, then
// its screen, never « Compte » in between, the map loading or not; the key leaving for
// OpenStreetMap says it too while the page is still there.
import { createRequire } from "node:module";

const AXE = createRequire(import.meta.url).resolve("axe-core/axe.min.js");

/** The account the simulated API knows (password « bon »). */
export const ME = {
  author: "ju_93",
  pseudonym: "ju_93",
  reviewer: false,
  role: "contributor",
  since: "2026-03",
  leaderboard: false,
  validation: "review",
};

/** OSM lot 1's routes (as its contract says), answered by
 * `mockOsm`: GET /api/osm/status says `login`; GET /api/osm/signup gives `signup` (null: 401
 * signup_expired); POST /api/osm/signup refuses « pris » (409 pseudonym_taken), a pseudonym
 * outside the rule (400), answers `post` when set (an error code and its status), else makes
 * the account (OSM, no password) and signs in. Never openstreetmap.org: the key's and the
 * link's hrefs are read, not followed. */
export const OSM_SIGNUP = { suggestion: "Jean_Dupont", osm_name: "Jean Dupont" };
export function mockOsm(api, req, path, method, json) {
  const osm = api.osm;
  if (path === "/api/osm/status")
    return json(200, { login: osm?.login ?? false, server: osm?.server ?? "dev" });
  if (!osm) return null;
  // The flow's start: where the API would send to OpenStreetMap, a page of ours instead.
  if (path === "/api/osm/login" || path === "/api/osm/link") {
    api.starts.push(req.url());
    return { status: 200, contentType: "text/html", body: "<!doctype html><title>osm</title>" };
  }
  if (path === "/api/osm/signup" && method === "GET")
    return osm.signup ? json(200, osm.signup) : json(401, { error: "signup_expired" });
  if (path === "/api/osm/signup" && method === "POST") {
    const p = req.postDataJSON()?.pseudonym ?? "";
    api.signups.push(p);
    if (osm.post) return json(osm.post[0], { error: osm.post[1] });
    if (!/^[A-Za-z0-9._-]{2,32}$/.test(p)) return json(400, { error: "pseudonym_invalid" });
    if (p === "pris") return json(409, { error: "pseudonym_taken" });
    api.signed = true;
    api.me = { ...ME, author: p, pseudonym: p, osm: true, password: false };
    osm.signup = null;
    return { status: 204, body: "" };
  }
  if (path === "/api/osm/unlink" && method === "POST") {
    api.unlinks++;
    if (api.me.password === false) return json(409, { error: "no_password" });
    api.me = { ...api.me, osm: false };
    return { status: 204, body: "" };
  }
  return null;
}

/** The API in memory: `signed` (the session), `send` (POST /api/contributions answers 201,
 * 401, or fails as offline), `posts` (what arrived), `logins`; `osm` (mockOsm's options:
 * `login`, `signup`, `post`), `me` (GET /api/me's answer), `signups`. */
export async function mockApi(context, { signed = false, osm = null, me = ME } = {}) {
  const api = {
    signed,
    send: "ok",
    posts: [],
    logins: 0,
    osm,
    me,
    signups: [],
    unlinks: 0,
    starts: [],
  };
  await context.route("**/api/**", async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const method = req.method();
    const json = (status, body) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    const osmAnswer = mockOsm(api, req, path, method, json);
    if (osmAnswer && "status" in osmAnswer) return route.fulfill(osmAnswer);
    if (osmAnswer) return osmAnswer;
    if (path === "/api/me") return api.signed ? json(200, api.me) : json(401, { error: "session" });
    if (path === "/api/session") {
      if (method === "DELETE") {
        api.signed = false;
        return route.fulfill({ status: 204, body: "" });
      }
      api.logins++;
      const b = req.postDataJSON() ?? {};
      if (b.pseudonym === ME.pseudonym && b.password === "bon") {
        api.signed = true;
        return route.fulfill({ status: 204, body: "" });
      }
      return json(401, { error: "credentials" });
    }
    if (path === "/api/proposals") return json(200, { type: "FeatureCollection", features: [] });
    if (path === "/api/contributions" && method === "POST") {
      if (api.send === "offline") {
        // A phone's request may hang a while before it fails (api.offlineMs): the "online"
        // event can come meanwhile, while that send is still being tried.
        if (api.offlineMs) await new Promise((r) => setTimeout(r, api.offlineMs));
        return route.abort("internetdisconnected");
      }
      if (!api.signed || api.send === 401) return json(401, { error: "session" });
      const body = req.postDataJSON();
      api.posts.push(body);
      return json(201, { uuid: body.uuid, status: "pending" });
    }
    if (path === "/api/me/contributions")
      return api.signed ? json(200, { author: ME.author, contributions: [] }) : json(401, {});
    return api.signed ? json(404, { error: "not_found" }) : json(401, { error: "session" });
  });
  return api;
}

/** axe-core's WCAG 2.2 A/AA violations inside #sheet (its paper scrolled through). */
async function axe(page) {
  if (!(await page.evaluate(() => Boolean(window.axe)))) await page.addScriptTag({ path: AXE });
  return page.evaluate(async () => {
    const sheet = document.querySelector("#sheet");
    const paper = sheet.querySelector(".sheet-paper");
    const out = new Set();
    const steps = paper ? Math.ceil(paper.scrollHeight / Math.max(1, paper.clientHeight)) + 1 : 1;
    for (let i = 0; i < steps; i++) {
      if (paper) paper.scrollTop = i * paper.clientHeight;
      await new Promise((r) => setTimeout(r, 50));
      const r = await window.axe.run(sheet, {
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
      });
      for (const v of r.violations)
        for (const n of v.nodes) out.add(`${v.id} ${n.target.join(" ")}`);
    }
    if (paper) paper.scrollTop = 0;
    return [...out];
  });
}

/** A camera of the street with participation (not an add), its id and position. */
async function streetCamera(page, app, street) {
  await page.goto(`${app}#18/${street[1]}/${street[0]}`);
  await page.waitForFunction(() => window.__map?.loaded(), null, { timeout: 60000 });
  await page.waitForFunction(
    () => window.__map.querySourceFeatures("detail", { sourceLayer: "cameras" }).length > 0,
    null,
    { timeout: 20000 },
  );
  return page.evaluate(() => {
    const f = window.__map
      .querySourceFeatures("detail", { sourceLayer: "cameras" })
      .find((c) => /^[nwr]\d+$/.test(String(c.properties.id)));
    return { id: String(f.properties.id), at: f.geometry.coordinates };
  });
}

/**
 * Run the account's checks.
 * @param {import("playwright").Browser} browser with `--ui punk` (ui.mjs)
 * @param {{ app: string, street: [number, number], phone: boolean, check: Function,
 *   context: object, smallTargets?: Function }} o `context`: newContext options
 */
export async function accountSmoke(browser, o) {
  const { app, street, phone, check } = o;
  const press = (loc) => (phone ? loc.tap() : loc.click());
  const errors = [];
  const fresh = async (signed) => {
    const context = await browser.newContext(o.context);
    const api = await mockApi(context, { signed });
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(String(e)));
    return { context, api, page };
  };
  const sheetOf = (page, cam) =>
    page
      .goto(`${app}?cam=${cam.id}#18/${cam.at[1]}/${cam.at[0]}`)
      .then(() => page.waitForSelector("#sheet #part-modify", { timeout: 30000 }));

  // --- signed out: the camera sheet, « Compte », « Entrer » and its error ---------------
  {
    const { context, page } = await fresh(false);
    const cam = await streetCamera(page, app, street);
    await sheetOf(page, cam);
    await page
      .waitForSelector('#part-modify[aria-disabled="true"]', { timeout: 10000 })
      .catch(() => {});
    const sheet = await page.evaluate(() => {
      const modify = document.getElementById("part-modify");
      const verify = document.querySelector("#sheet .part-verify");
      const line = document.getElementById("part-signin");
      return {
        modify: modify?.textContent,
        verify: verify?.textContent,
        disabled: [modify, verify].map((b) => b?.getAttribute("aria-disabled")),
        native: [modify, verify].some((b) => b?.disabled),
        described: [modify, verify].map((b) => b?.getAttribute("aria-describedby")),
        line: line?.textContent,
        role: line?.getAttribute("role"),
        greyed: modify ? getComputedStyle(modify).borderTopStyle : "",
        mine: document.querySelectorAll("#sheet .part-mine-slot .part-link").length,
        osm: document.querySelector("#sheet a.osm-edit")?.textContent ?? "",
        add: !document.getElementById("fab-add")?.hidden,
      };
    });
    check(
      "punk signed out: « Modifier » and « Toujours là ? » greyed (aria-disabled, not disabled, dashed), described by « Connectez-vous pour participer », « Corriger sur OpenStreetMap », no « Vos contributions », « ＋ Ajouter » shown",
      sheet.modify === "Modifier" &&
        sheet.verify === "Toujours là ?" &&
        sheet.disabled.every((d) => d === "true") &&
        !sheet.native &&
        sheet.described.every((d) => d === "part-signin") &&
        sheet.line === "Connectez-vous pour participer" &&
        sheet.role === null &&
        sheet.greyed === "dashed" &&
        sheet.mine === 0 &&
        sheet.osm.startsWith("Corriger sur OpenStreetMap") &&
        sheet.add,
      JSON.stringify(sheet),
    );
    // A greyed button is not a dead one: Enter on « Toujours là ? » opens « Compte ».
    await page.locator("#sheet .part-verify").focus();
    await page.keyboard.press("Enter");
    const byKey = await page
      .waitForSelector('#sheet [data-account="ask"]', { timeout: 10000 })
      .then(() => true)
      .catch(() => false);
    check("signed out: Enter on the greyed « Toujours là ? » opens « Compte »", byKey);
    await press(page.locator("#sheet .sheet-head .close"));
    await page.waitForTimeout(400);

    const square = page.locator("#account-square");
    const before = await square.evaluate((b) => ({
      name: b.getAttribute("aria-label"),
      expanded: b.getAttribute("aria-expanded"),
    }));
    await press(square);
    await page.waitForSelector('#sheet [data-account="ask"]');
    await page.waitForTimeout(400);
    const ask = await page.evaluate(() => ({
      expanded: document.getElementById("account-square").getAttribute("aria-expanded"),
      stamp: document.querySelector("#sheet .account-stamp")?.textContent,
      lead: document.querySelector("#sheet .account-lead")?.textContent,
      contact: document.getElementById("account-contact")?.getAttribute("href") ?? "",
      connect: document.getElementById("account-connect"),
      form: document.querySelectorAll("#sheet input").length,
      osm: document.querySelector("#sheet .account-foot a")?.getAttribute("href"),
      camera: Boolean(document.querySelector("#sheet #part-modify")),
      url: window.location.search,
    }));
    check(
      "punk account square signed out, OSM sign-in off: « Compte » in place of the camera sheet (stamp, lead, « Me contacter », OpenStreetMap; no password form), the square expanded",
      before.name === "Compte : se connecter ou demander un compte" &&
        before.expanded === "false" &&
        ask.expanded === "true" &&
        ask.stamp === "Inscriptions ferméespour l'instant" &&
        ask.lead === "La carte se lit sans compte." &&
        ask.connect === null &&
        ask.form === 0 &&
        ask.osm === "https://www.openstreetmap.org/" &&
        !ask.camera &&
        !ask.url.includes("cam="),
      JSON.stringify({ before, ask }),
    );
    const mail = /^mailto:([^?]*)\?subject=([^&]*)&body=(.*)$/.exec(ask.contact);
    check(
      "« Me contacter »: a mailto: asking for an account (subject, body), the deploy's address or none",
      mail !== null &&
        (mail[1] === "" || mail[1] === "contact@example.org") &&
        decodeURIComponent(mail[2]) === "Demande de compte Surveillance World" &&
        decodeURIComponent(mail[3]).includes("Identifiant souhaité"),
      ask.contact,
    );
    const askAxe = await axe(page);
    check(
      "« Compte »: axe WCAG 2.2 A/AA none in the sheet",
      askAxe.length === 0,
      askAxe.join(" | "),
    );
    if (phone && o.smallTargets) {
      const small = (await o.smallTargets(page)).filter((s) => !s.startsWith("canvas"));
      check("« Compte »: touch targets >= 44 px", small.length === 0, small.join(" "));
    }

    // The password form: not in « Compte », at an address nothing links to.
    await page.goto(`${app}?compte=motdepasse#16/${street[1]}/${street[0]}`);
    await page.waitForSelector('#sheet [data-account="form"]', { timeout: 30000 });
    await page.waitForTimeout(300);
    const form = await page.evaluate(() => ({
      search: window.location.search,
      focus: document.activeElement?.id,
      user: document.getElementById("account-pseudonym")?.getAttribute("autocomplete"),
      pass: document.getElementById("account-password")?.getAttribute("type"),
      forgot: document.getElementById("account-forgot")?.getAttribute("href") ?? "",
      labels: [...document.querySelectorAll("#sheet .account-field")].map((l) =>
        l.firstChild?.textContent?.trim(),
      ),
      back: Boolean(document.querySelector("#sheet .account-back")),
    }));
    const forgot = /^mailto:([^?]*)\?subject=([^&]*)&/.exec(form.forgot);
    check(
      "?compte=motdepasse → « Entrer »: identifiant (focused), mot de passe, « Mot de passe oublié » the same mailto with its subject, « ← Retour »; the parameter gone",
      !form.search.includes("compte") &&
        form.focus === "account-pseudonym" &&
        form.user === "username" &&
        form.pass === "password" &&
        form.labels.join("|") === "Identifiant|Mot de passe" &&
        forgot !== null &&
        forgot[1] === (mail?.[1] ?? "") &&
        decodeURIComponent(forgot[2]) === "Mot de passe oublié" &&
        form.back,
      JSON.stringify(form),
    );
    await page.locator("#account-pseudonym").fill("ju_93");
    await page.locator("#account-password").fill("faux");
    await page.locator("#account-password").press("Enter");
    await page.waitForSelector("#account-error:not([hidden])", { timeout: 10000 });
    const error = await page.evaluate(() => ({
      text: document.getElementById("account-error").textContent,
      role: document.getElementById("account-error").getAttribute("role"),
      invalid: [...document.querySelectorAll("#sheet .account-input")].map((i) =>
        i.getAttribute("aria-invalid"),
      ),
      password: document.getElementById("account-password").value,
      focus: document.activeElement?.id,
      square: document.getElementById("account-square").getAttribute("aria-label"),
    }));
    check(
      "« Entrer » refused: « Identifiant ou mot de passe faux. » (alert), both fields marked, the password emptied and focused, still signed out",
      error.text === "Identifiant ou mot de passe faux." &&
        error.role === "alert" &&
        error.invalid.every((v) => v === "true") &&
        error.password === "" &&
        error.focus === "account-password" &&
        error.square === "Compte : se connecter ou demander un compte",
      JSON.stringify(error),
    );
    const formAxe = await axe(page);
    check(
      "« Entrer » with its error: axe WCAG 2.2 A/AA none",
      formAxe.length === 0,
      formAxe.join(" | "),
    );
    if (phone && o.smallTargets) {
      const small = (await o.smallTargets(page)).filter((s) => !s.startsWith("canvas"));
      check("« Entrer »: touch targets >= 44 px", small.length === 0, small.join(" "));
    }
    await press(page.locator("#sheet .account-back"));
    await page.waitForSelector('#sheet [data-account="ask"]');
    await press(page.locator("#sheet .sheet-head .close"));
    await page.waitForTimeout(300);
    const closed = await page.evaluate(() => ({
      hidden: document.getElementById("sheet").hidden,
      focus: document.activeElement?.id,
      expanded: document.getElementById("account-square").getAttribute("aria-expanded"),
    }));
    check(
      "« ← Retour » back to « Compte », × closes it, the focus back on the square",
      closed.hidden && closed.focus === "account-square" && closed.expanded === "false",
      JSON.stringify(closed),
    );

    // The password form signs in: the account square says so.
    await page.goto(`${app}?compte=motdepasse#16/${street[1]}/${street[0]}`);
    await page.waitForSelector('#sheet [data-account="form"]', { timeout: 30000 });
    await page.locator("#account-pseudonym").fill("ju_93");
    await page.locator("#account-password").fill("bon");
    await press(page.locator("#sheet .account-submit"));
    await page
      .waitForFunction(
        () => document.getElementById("account-square")?.textContent === "JU",
        null,
        {
          timeout: 15000,
        },
      )
      .catch(() => {});
    await sheetOf(page, cam);
    await page.waitForTimeout(500);
    const after = await page.evaluate(() => ({
      modify: document.getElementById("part-modify")?.textContent,
      disabled: document.getElementById("part-modify")?.getAttribute("aria-disabled"),
      line: Boolean(document.getElementById("part-signin")),
      mine: document.querySelectorAll("#sheet .part-mine-slot .part-link").length,
      square: document.getElementById("account-square").textContent,
      name: document.getElementById("account-square").getAttribute("aria-label"),
      osm: Boolean(document.querySelector("#sheet .sheet-body > a.osm-edit")),
    }));
    check(
      "?compte=motdepasse → login → the camera sheet signed in: « Modifier » not greyed, no line, « Vos contributions », the square « JU » (« Votre profil »)",
      after.modify === "Modifier" &&
        after.disabled === null &&
        !after.line &&
        after.mine === 1 &&
        after.square === "JU" &&
        after.name === "Votre profil" &&
        !after.osm,
      JSON.stringify(after),
    );
    await context.close();
  }

  // --- « ＋ Ajouter » signed out: « Compte » (no password form) -----------------------
  {
    const { context, page } = await fresh(false);
    await page.goto(`${app}#16/${street[1]}/${street[0]}`);
    await page.waitForFunction(() => window.__map?.loaded(), null, { timeout: 60000 });
    await page.waitForSelector("#fab-add:not([hidden])", { timeout: 15000 });
    await page.waitForTimeout(500);
    await press(page.locator("#fab-add"));
    const asked = await page
      .waitForSelector('#sheet [data-account="ask"]', { timeout: 10000 })
      .then(() => true)
      .catch(() => false);
    const inputs = await page.locator("#sheet input").count();
    check(
      "« ＋ Ajouter » signed out → « Compte », no password form",
      asked && inputs === 0,
      JSON.stringify({ asked, inputs }),
    );
    // « Compte » refits the map: its tiles and glyphs settled before the page closes (WebKit
    // reports the fetches a closing page cancels as page errors, « access control checks »).
    await page.waitForFunction(() => window.__map.loaded() && !window.__map.isMoving(), null, {
      timeout: 30000,
    });
    await context.close();
  }

  // --- a send answered 401: kept, « Reconnectez-vous… », sent after the login ----------
  {
    const { context, api, page } = await fresh(true);
    const cam = await streetCamera(page, app, street);
    await sheetOf(page, cam);
    api.send = "offline";
    api.offlineMs = 1500; // the network comes back before this send has failed
    await press(page.locator("#sheet .part-verify"));
    await press(page.locator("#sheet button", { hasText: "Elle est là" }));
    // In the sheet, or (punk, board 8a) in the tickets over the map, the sheet gone.
    await page.waitForSelector(".part-done");
    await page.waitForFunction(() => !document.getElementById("queue-count").hidden);
    // The session expired meanwhile; the network comes back.
    api.signed = false;
    api.send = "ok";
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await page
      .waitForFunction(
        () => document.getElementById("queue-count").classList.contains("relogin"),
        null,
        { timeout: 10000 },
      )
      .catch(() => {});
    const waiting = await page.evaluate(() => ({
      text: document.getElementById("queue-count").textContent,
      shown: !document.getElementById("queue-count").hidden,
    }));
    const keptBefore = api.posts.length;
    // The sheet closed, or (board 8a: the sheet already gone) the tickets put away.
    if (await page.locator("#sheet .sheet-head .close").isVisible())
      await press(page.locator("#sheet .sheet-head .close"));
    else await page.keyboard.press("Escape");
    await page.waitForTimeout(600);
    await press(page.locator("#queue-count"));
    const asked = await page
      .waitForSelector('#sheet [data-account="ask"]', { timeout: 10000 })
      .then(() => true)
      .catch(() => false);
    // Signed in again (OpenStreetMap, or the password form): the page comes back signed in.
    api.signed = true;
    await page.goto(`${app}?osm=signed#16/${street[1]}/${street[0]}`);
    await page.waitForFunction(() => window.__map?.loaded(), null, { timeout: 60000 });
    await page
      .waitForFunction(() => document.getElementById("queue-count").hidden, null, {
        timeout: 15000,
      })
      .catch(() => {});
    const sent = await page.evaluate(() => ({
      counter: document.getElementById("queue-count").hidden,
      sheet: document.getElementById("sheet").hidden,
    }));
    check(
      "a send answered 401 is kept: « Reconnectez-vous pour envoyer 1 contribution », a tap opens « Compte », signed in again it leaves",
      asked &&
        waiting.shown &&
        waiting.text === "Reconnectez-vous pour envoyer 1 contribution" &&
        keptBefore === 0 &&
        api.posts.length === 1 &&
        api.posts[0].kind === "verify" &&
        sent.counter,
      JSON.stringify({ asked, waiting, keptBefore, posts: api.posts.length, sent }),
    );
    await context.close();
  }
  await osmSmoke({ ...o, browser }, press, errors);
  check("account: no page errors", errors.length === 0, errors.join(" | "));
}

/** Sign-in with OpenStreetMap (OSM lot 1), its routes simulated (mockOsm): « Compte » with
 * its key (the flow started with this page as `then`), the landing outcomes (`?osm=`, gone
 * from the address), « Choisissez votre pseudonyme » and its errors, the account made. */
async function osmSmoke(o, press, errors) {
  const { app, street, phone, check } = o;
  const at = `#16.5/${street[1]}/${street[0]}`;
  const fresh = async (osm) => {
    const context = await o.browser.newContext(o.context);
    const api = await mockApi(context, { osm });
    // The sheets of the account the page shows, in order (each page anew), « Chargement »'s
    // with its role and line.
    await context.addInitScript(() => {
      window.__sheets = [];
      let last = null;
      new MutationObserver(() => {
        const paper = document.querySelector("#sheet [data-account]");
        const kind = paper?.getAttribute("data-account") ?? null;
        if (kind === last) return;
        last = kind;
        if (!kind) return;
        const l = paper.querySelector(".loading");
        window.__sheets.push(
          l
            ? `${kind}:${l.getAttribute("role")}:${l.querySelector(".loading-line-text")?.textContent}`
            : kind,
        );
      }).observe(document, { childList: true, subtree: true });
    });
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(String(e)));
    return { context, api, page };
  };
  const loaded = (page) =>
    page.waitForFunction(() => window.__map?.loaded(), null, { timeout: 60000 });
  const sheets = (page) => page.evaluate(() => window.__sheets);
  const WAITING = "waiting:status:de votre compte";
  /** A route held until the function returned is called. */
  const hold = async (context, url) => {
    let release;
    const gate = new Promise((r) => {
      release = r;
    });
    await context.route(url, async (route) => {
      await gate;
      await route.fallback();
    });
    return () => release();
  };

  // « Compte » with the key; the key starts the flow with this page as `then`.
  {
    const { context, api, page } = await fresh({ login: true });
    await page.goto(`${app}${at}`);
    await loaded(page);
    await press(page.locator("#account-square"));
    await page.waitForSelector('#sheet [data-osm="true"]', { timeout: 10000 });
    await page.waitForTimeout(400);
    const ask = await page.evaluate(() => {
      const key = document.getElementById("account-osm");
      const kept = document.getElementById(key?.getAttribute("aria-describedby") ?? "");
      const contact = document.getElementById("account-contact");
      return {
        stamp: Boolean(document.querySelector("#sheet .account-stamp")),
        title: document.querySelector("#sheet .account-osm-title")?.textContent,
        lead: document.querySelector("#sheet .account-osm-lead")?.textContent,
        key: key?.textContent,
        href: key?.getAttribute("href") ?? "",
        kept: kept?.textContent,
        connect: document.getElementById("account-connect"),
        inputs: document.querySelectorAll("#sheet input").length,
        contact: contact?.getAttribute("href") ?? "",
        contactLink: contact?.classList.contains("account-link") ?? false,
        foot: document.querySelector("#sheet .account-osm-foot")?.textContent,
        keys: [...document.querySelectorAll("#sheet .account-key")].map((k) => k.id),
        out: document.querySelectorAll('#sheet a[href^="https://www.openstreetmap.org"]').length,
      };
    });
    const then = new URL(ask.href, app).searchParams.get("then") ?? "";
    check(
      "OSM sign-in on: « Compte » is 28a: « Connexion et inscription passent par OpenStreetMap », its lead, one key « Se connecter avec OpenStreetMap » (to /api/osm/login, `then` this page; « serveur de test »), « Rien n'est publié sans votre accord. », the foot's « Me contacter » a link; no password form, no OSM link",
      !ask.stamp &&
        ask.title === "Connexion et inscription passent par OpenStreetMap" &&
        ask.lead === "Pas encore de compte OSM\u00a0? Vous le créerez en chemin." &&
        // On OSM's test server (the default) the key says so, in its accessible name too.
        ask.key === "Se connecter avecOpenStreetMap→serveur de test" &&
        ask.href.startsWith("/api/osm/login?then=") &&
        then.startsWith("/") &&
        !then.startsWith("//") &&
        then.includes("#16.5/") &&
        ask.kept === "Rien n'est publié sans votre accord." &&
        ask.connect === null &&
        ask.inputs === 0 &&
        ask.contact.startsWith("mailto:") &&
        ask.contactLink &&
        ask.foot === "La carte se lit sans compte.Me contacter" &&
        ask.keys.length === 0 &&
        ask.out === 0,
      JSON.stringify({ ask, then }),
    );
    const askAxe = await axe(page);
    check(
      "« Compte » with OpenStreetMap: axe WCAG 2.2 A/AA none",
      askAxe.length === 0,
      askAxe.join(" | "),
    );
    if (phone && o.smallTargets) {
      const small = (await o.smallTargets(page)).filter((s) => !s.startsWith("canvas"));
      check(
        "« Compte » with OpenStreetMap: touch targets >= 44 px",
        small.length === 0,
        small.join(" "),
      );
    }
    // The map moved meanwhile: the key takes the page as it is when used. OpenStreetMap's
    // way held: the page still there says « Chargement de votre compte », not « Compte ».
    await page.evaluate(() => window.__map.jumpTo({ zoom: 17.25 }));
    await page.waitForTimeout(600);
    // OpenStreetMap's way answered 204 No Content: the browser drops that navigation and
    // the page stays, as it stays on the screen while OpenStreetMap is on its way (a held
    // navigation would also hold Playwright's reads of the page, in Chromium).
    await context.route("**/api/osm/login**", (route) => {
      api.starts.push(route.request().url());
      return route.fulfill({ status: 204, body: "" });
    });
    await press(page.locator("#account-osm"));
    const leaving = await page
      .waitForSelector('#sheet [data-account="waiting"] .loading[role="status"]', {
        timeout: 10000,
      })
      .then(() => true)
      .catch(() => false);
    check(
      "« Se connecter avec OpenStreetMap » pressed: while the page is still there, its sheet says « Chargement de votre compte » (role status), not « Compte »",
      leaving,
    );
    const started = api.starts.map((u) => new URL(u).searchParams.get("then") ?? "");
    check(
      "« Se connecter avec OpenStreetMap » starts the flow (GET /api/osm/login) with `then` the page as it is",
      started.length === 1 && started[0].startsWith("/") && started[0].includes("#17.25/"),
      JSON.stringify(started),
    );
    await context.close();
  }

  // ?osm=denied signed out: « Compte » with its line, the parameter gone.
  {
    const { context, page } = await fresh({ login: true });
    await page.goto(`${app}?osm=denied${at}`);
    await loaded(page);
    await page.waitForSelector("#sheet .account-notice:not(:empty)", { timeout: 15000 });
    const landed = await page.evaluate(() => ({
      text: document.querySelector("#sheet .account-notice")?.textContent,
      role: document.querySelector("#sheet .account-notice")?.getAttribute("role"),
      search: window.location.search,
      hash: window.location.hash,
    }));
    const seen = await sheets(page);
    check(
      "?osm=denied: « Chargement de votre compte » first, then « Compte » says « Refusé sur OpenStreetMap… » (role alert); `osm` gone from the address, the map's position kept",
      landed.text === "Refusé sur OpenStreetMap : rien n'a été transmis." &&
        landed.role === "alert" &&
        !landed.search.includes("osm=") &&
        landed.hash.startsWith("#") &&
        JSON.stringify(seen) === JSON.stringify([WAITING, "ask"]),
      JSON.stringify({ landed, seen }),
    );
    await context.close();
  }

  // ?osm=failed (28a's « retour d'OSM en échec »): the band; its reason only under ?debug=1.
  for (const debug of [false, true]) {
    const { context, page } = await fresh({ login: true });
    const q = `?osm=failed&osm_why=client_refuse${debug ? "&debug=1" : ""}`;
    await page.goto(`${app}${q}${at}`);
    await loaded(page);
    await page.waitForSelector("#sheet .account-notice:not(:empty)", { timeout: 15000 });
    const landed = await page.evaluate(() => {
      const why = document.getElementById("account-why");
      return {
        text: document.querySelector("#sheet .account-notice")?.textContent,
        role: document.querySelector("#sheet .account-notice")?.getAttribute("role"),
        why: why?.textContent ?? null,
        font: why ? getComputedStyle(why).fontFamily : "",
        key: Boolean(document.getElementById("account-osm")),
        search: window.location.search,
        // The code's focus on the title: no frame (28a); the keyboard's next one has it.
        title: document.activeElement?.id ?? null,
        frame: getComputedStyle(document.activeElement).outlineStyle,
      };
    });
    await page.keyboard.press("Tab");
    const next = await page.evaluate(() => ({
      id: document.activeElement?.id || document.activeElement?.className || null,
      frame: getComputedStyle(document.activeElement).outlineStyle,
    }));
    check(
      `?osm=failed${debug ? " (debug)" : ""}: the title focused by the code shows no frame; Tab's next control shows its dashed one`,
      landed.title === "account-title" && landed.frame === "none" && next.frame === "dashed",
      JSON.stringify({ title: landed.title, frame: landed.frame, next }),
    );
    check(
      debug
        ? "?osm=failed&osm_why=client_refuse&debug=1: the band, then « raison : client_refuse » in a monospace face"
        : "?osm=failed&osm_why=client_refuse: « La connexion n'a pas abouti. Réessayez. » (role alert) over 28a, no reason shown; `osm` and `osm_why` gone",
      landed.text === "La connexion n'a pas abouti. Réessayez." &&
        landed.role === "alert" &&
        landed.key &&
        !landed.search.includes("osm") &&
        (debug
          ? landed.why === "raison : client_refuse" && /monospace/.test(landed.font)
          : landed.why === null),
      JSON.stringify(landed),
    );
    const failedSeen = await sheets(page);
    check(
      `?osm=failed${debug ? " (debug)" : ""}: « Chargement de votre compte » first, then « Compte » with the band, nothing between`,
      JSON.stringify(failedSeen) === JSON.stringify([WAITING, "ask"]),
      JSON.stringify(failedSeen),
    );
    await context.close();
  }

  // A greyed button of a camera sheet: « Compte », whose key comes back to that camera;
  // back signed in (`?osm=signed&cam=`), the camera's sheet opens, its buttons on.
  {
    const { context, api, page } = await fresh({ login: true });
    const cam = await streetCamera(page, app, street);
    await page.goto(`${app}?cam=${cam.id}#18/${cam.at[1]}/${cam.at[0]}`);
    await page.waitForSelector('#sheet #part-modify[aria-disabled="true"]', { timeout: 30000 });
    // Playwright waits for an enabled element: aria-disabled is pressed by force, as a finger.
    const greyed = page.locator("#sheet #part-modify");
    await (phone ? greyed.tap({ force: true }) : greyed.click({ force: true }));
    await page.waitForSelector('#sheet [data-osm="true"]', { timeout: 10000 });
    const href = await page.locator("#account-osm").getAttribute("href");
    const then = new URL(href ?? "", app).searchParams.get("then") ?? "";
    api.signed = true;
    const landing = new URL(then, app);
    landing.searchParams.set("osm", "signed");
    // « Compte » refits the map: its tiles settled before the next page (WebKit reports the
    // fetches a navigation cancels as page errors, « access control checks »).
    await page.waitForFunction(() => window.__map.loaded() && !window.__map.isMoving(), null, {
      timeout: 30000,
    });
    await page.goto(landing.href);
    await loaded(page);
    await page
      .waitForSelector("#sheet #part-modify:not([aria-disabled])", { timeout: 30000 })
      .catch(() => {});
    await page.waitForTimeout(800);
    const back = await page.evaluate(() => ({
      modify: Boolean(document.querySelector("#sheet #part-modify:not([aria-disabled])")),
      board: Boolean(document.querySelector("#sheet .board-paper")),
      search: window.location.search,
      sheets: window.__sheets,
    }));
    check(
      "a greyed « Modifier » → « Compte »: the key's `then` is the camera (`?cam=`); back with ?osm=signed, the camera's sheet signed in, not the account's screen",
      then.startsWith("/") &&
        then.includes(`cam=${cam.id}`) &&
        back.modify &&
        !back.board &&
        !back.search.includes("osm=") &&
        back.sheets.length === 0,
      JSON.stringify({ then, back }),
    );
    await context.close();
  }

  // ?osm=signup with the signup gone: « Compte » with the expired line.
  {
    const { context, page } = await fresh({ login: true, signup: null });
    await page.goto(`${app}?osm=signup${at}`);
    await loaded(page);
    await page.waitForSelector("#sheet .account-notice:not(:empty)", { timeout: 15000 });
    const text = await page.locator("#sheet .account-notice").textContent();
    const seen = await sheets(page);
    check(
      "?osm=signup, the signup expired (401): « Chargement de votre compte », then « Compte » again with « Le délai… est passé »",
      /^Le délai pour choisir un pseudonyme est passé/.test(text ?? "") &&
        JSON.stringify(seen) === JSON.stringify([WAITING, "ask"]),
      JSON.stringify({ text, seen }),
    );
    await context.close();
  }

  // ?osm=signup: « Choisissez votre pseudonyme », its errors, then the account.
  {
    const { context, api, page } = await fresh({ login: true, signup: { ...OSM_SIGNUP } });
    // GET /api/osm/signup and the map's tiles held: the sheet waits, not for the map.
    const answer = await hold(context, "**/api/osm/signup");
    const tiles = await hold(context, /\.pmtiles(\?|$)|\/tiles\/(?!meta\.json)/);
    await page.goto(`${app}?osm=signup${at}`);
    await page.waitForSelector('#sheet [data-account="waiting"]', { timeout: 30000 });
    const waiting = await page.evaluate(() => {
      const l = document.querySelector("#sheet .loading");
      return {
        role: l?.getAttribute("role"),
        line: l?.querySelector(".loading-line-text")?.textContent,
        first: Boolean(document.getElementById("loading")),
        map: window.__map?.loaded() ?? false,
        visible: Boolean(l && l.getBoundingClientRect().height > 100),
      };
    });
    check(
      "?osm=signup: the sheet says « Chargement de votre compte » at once (2c, role status), the first load's screen gone for it, the map not in yet",
      waiting.role === "status" &&
        waiting.line === "de votre compte" &&
        waiting.visible &&
        !waiting.first &&
        !waiting.map,
      JSON.stringify(waiting),
    );
    answer();
    const early = await page
      .waitForSelector('#sheet [data-account="signup"]', { timeout: 15000 })
      .then(() => page.evaluate(() => !window.__map?.loaded()))
      .catch(() => false);
    check("?osm=signup: « Choisissez votre pseudonyme » before the map is in", early);
    tiles();
    await loaded(page);
    await page.waitForSelector('#sheet [data-account="signup"]', { timeout: 15000 });
    await page.waitForTimeout(400);
    const sheet = await page.evaluate(() => ({
      sheets: window.__sheets,
      title: document.getElementById("account-title")?.textContent,
      name: document.querySelector("#sheet .account-osm-name")?.textContent,
      value: document.getElementById("account-signup-pseudonym")?.value,
      focus: document.activeElement?.id,
      label: document.querySelector("#sheet .account-field")?.firstChild?.textContent,
      search: window.location.search,
    }));
    check(
      "?osm=signup: « Choisissez votre pseudonyme », « Votre nom sur OSM : Jean Dupont », the suggestion in the focused field, `osm` gone",
      sheet.title?.startsWith("Choisissez votre pseudonyme") &&
        sheet.name === "Votre nom sur OSM : Jean Dupont" &&
        sheet.value === "Jean_Dupont" &&
        sheet.focus === "account-signup-pseudonym" &&
        sheet.label === "Pseudonyme" &&
        !sheet.search.includes("osm=") &&
        JSON.stringify(sheet.sheets) === JSON.stringify([WAITING, "signup"]),
      JSON.stringify(sheet),
    );
    const signupAxe = await axe(page);
    check(
      "« Choisissez votre pseudonyme »: axe WCAG 2.2 A/AA none",
      signupAxe.length === 0,
      signupAxe.join(" | "),
    );
    if (phone && o.smallTargets) {
      // The conditions' link inside its sentence is WCAG 2.5.8's inline exception.
      const small = (await o.smallTargets(page)).filter(
        (s) => !s.startsWith("canvas") && !s.includes("account-inline"),
      );
      check(
        "« Choisissez votre pseudonyme »: touch targets >= 44 px (but the inline link in its sentence)",
        small.length === 0,
        small.join(" "),
      );
    }
    const field = page.locator("#account-signup-pseudonym");
    const said = () =>
      page.evaluate(() => ({
        text: document.getElementById("account-signup-error")?.textContent,
        role: document.getElementById("account-signup-error")?.getAttribute("role"),
        invalid: document.getElementById("account-signup-pseudonym")?.getAttribute("aria-invalid"),
        described: document
          .getElementById("account-signup-pseudonym")
          ?.getAttribute("aria-describedby"),
      }));
    await field.fill("pris");
    await field.press("Enter");
    await page.waitForSelector("#account-signup-error:not([hidden])", { timeout: 10000 });
    const taken = await said();
    await field.fill("é");
    await press(page.locator("#sheet .account-submit"));
    await page.waitForTimeout(300);
    const invalid = await said();
    const sent = [...api.signups];
    check(
      "« Valider »: a pseudonym taken said (409, role alert, field marked); one outside the rule said before sending",
      taken.text === "Ce pseudonyme est déjà pris : choisissez-en un autre." &&
        taken.role === "alert" &&
        taken.invalid === "true" &&
        taken.described?.includes("account-signup-error") &&
        /^Ce pseudonyme ne va pas/.test(invalid.text ?? "") &&
        JSON.stringify(sent) === JSON.stringify(["pris"]),
      JSON.stringify({ taken, invalid, sent }),
    );
    const errorAxe = await axe(page);
    check(
      "« Choisissez votre pseudonyme » with its error: axe WCAG 2.2 A/AA none",
      errorAxe.length === 0,
      errorAxe.join(" | "),
    );
    await field.fill("Jean_Dupont");
    await press(page.locator("#sheet .account-submit"));
    await page
      .waitForSelector("#sheet .board-paper .board-notice:not(:empty)", { timeout: 15000 })
      .catch(() => {});
    const made = await page.evaluate(() => ({
      notice: document.querySelector("#sheet .board-notice")?.textContent,
      role: document.querySelector("#sheet .board-notice")?.getAttribute("role"),
      square: document.getElementById("account-square")?.textContent,
      focus: document.activeElement?.closest("h2") !== null,
    }));
    check(
      "« Valider » accepted: signed in, the account's screen says « Compte créé : bienvenue, Jean_Dupont. » (role status, the focus on its title), the square « JE »",
      made.notice === "Compte créé : bienvenue, Jean_Dupont." &&
        made.role === "status" &&
        made.square === "JE" &&
        made.focus &&
        api.signed,
      JSON.stringify(made),
    );
    await context.close();
  }
}
