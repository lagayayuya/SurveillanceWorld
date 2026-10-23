// The site's text fields and how to reach each one, for the benches that type in them
// (smoke-keyboard.mjs: a phone's keyboard over them; smoke-formats.mjs: the page never
// zoomed by them, on every touch format). One list, so that a new field is checked by
// both. Each case opens its screen in a fresh context (the API answered by the page:
// account.mjs mockApi, profile-mock.mjs mockProfile) and names its field and its form's
// submit button; `keyboard: false`, a field smoke-keyboard does not play the keyboard over
// (« Modifier »'s panel is not a sheet). /revue's fields are a desktop tool's: not here.
import { mockApi, OSM_SIGNUP } from "./account.mjs";
import { DOME_CAM, mockProfile, AT as PROFILE_AT, SYNC } from "./profile-mock.mjs";

/** The cases on the site at `app` (its address, ending with /), the map at `at`. */
export function fieldCases(app, at) {
  /** Signed out, sign-in with OpenStreetMap on (its signup waiting for `?osm=signup`). */
  const visitor = (url, ready) => async (context) => {
    await mockApi(context, { osm: { login: true, server: "dev", signup: { ...OSM_SIGNUP } } });
    const page = await context.newPage();
    await page.goto(`${app}?${url.slice(1)}${at}`);
    await page.waitForFunction(() => window.__map?.loaded(), null, { timeout: 60_000 });
    await page.waitForSelector(ready, { timeout: 30_000 });
    return page;
  };
  /** Signed in, the account's screen open, then `open` tapped (a link that unfolds a form). */
  const signed = (opts, open, ready) => async (context) => {
    await mockProfile(context, opts);
    const page = await context.newPage();
    await page.goto(`${app}?mode=clair${at}`);
    await page.waitForFunction(() => window.__map?.loaded(), null, { timeout: 60_000 });
    await page.waitForTimeout(800);
    await page.getByRole("button", { name: "Votre profil" }).first().tap();
    await page.waitForSelector("#sheet .board-paper .board-place", { timeout: 15_000 });
    if (open) {
      await page.locator(open).scrollIntoViewIfNeeded();
      await page.locator(open).tap();
    }
    await page.waitForSelector(ready, { state: "visible", timeout: 15_000 });
    return page;
  };
  return [
    {
      name: "« Entrer », the password (?compte=motdepasse)",
      open: visitor("&compte=motdepasse", '#sheet [data-account="form"]'),
      field: "#account-password",
      submit: "#sheet .account-submit",
    },
    {
      name: "« Choisissez votre pseudonyme » (?osm=signup)",
      open: visitor("&osm=signup", '#sheet [data-account="signup"]'),
      field: "#account-signup-pseudonym",
      submit: "#sheet .account-submit",
    },
    {
      name: "« Changer le mot de passe », the new one",
      open: signed(
        { account: { password: true } },
        "#sheet .board-password",
        "#board-password-form:not([hidden])",
      ),
      field: '#board-password-form input[autocomplete="new-password"]',
      submit: '#board-password-form button[type="submit"]',
    },
    {
      name: "« Supprimer mon compte », the password",
      open: signed(
        { account: { password: true } },
        "#sheet .board-delete",
        "#board-delete-form:not([hidden])",
      ),
      field: "#board-delete-form input",
      submit: '#board-delete-form button[type="submit"]',
    },
    {
      name: "« Relier à OpenStreetMap », the password",
      open: signed(
        { account: { osm: false, password: true }, osmLogin: true },
        "#sheet .board-osm-link",
        "#board-osm-link-form:not([hidden])",
      ),
      field: "#board-osm-link-form input",
      submit: '#board-osm-link-form button[type="submit"]',
    },
    {
      name: "« Publier aussi sur OpenStreetMap en mon nom », the password",
      open: signed(
        { account: { osm: true, password: true }, sync: SYNC },
        "#sheet .board-sync-choice:has(#board-sync-publish)",
        "#board-sync-enable:not([hidden])",
      ),
      field: '#board-sync-enable input[type="password"]',
      submit: '#board-sync-enable button[type="submit"]',
    },
    {
      name: "the filters' operator (the machine)",
      open: async (context) => {
        await mockApi(context, {});
        const page = await context.newPage();
        await page.goto(`${app}?op=V${at}`);
        await page.waitForFunction(() => window.__map?.loaded(), null, { timeout: 60_000 });
        await page.locator("#fab-filters").tap();
        await page.waitForSelector("#adv-operator", { state: "attached", timeout: 15_000 });
        return page;
      },
      field: "#adv-operator",
      submit: null,
    },
    {
      name: "« Modifier », « Exploitant précis »",
      keyboard: false,
      open: async (context) => {
        await mockProfile(context, { account: { password: true } });
        const page = await context.newPage();
        await page.goto(`${app}?cam=${DOME_CAM}${PROFILE_AT}`);
        await page.waitForSelector("#sheet #part-modify", { timeout: 30_000 });
        await page.waitForTimeout(800);
        await page.locator("#part-modify").tap();
        await page.waitForSelector("#modify-panel", { timeout: 20_000 });
        const line = page.locator('#modify-panel .modify-line[data-field="operator"]');
        if (await line.evaluate((e) => e.tagName === "BUTTON")) await line.tap();
        await page.waitForSelector("#modify-operator-search", { timeout: 10_000 });
        return page;
      },
      field: "#modify-operator-search",
      submit: null,
    },
  ];
}
