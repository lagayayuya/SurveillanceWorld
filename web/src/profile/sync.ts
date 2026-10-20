// « Publier sur OpenStreetMap » on the account's screen: the synchronisation's setting (the
// owner's decision of 16/10), replacing OSM
// lot 2's « À publier » list. No board draws it: built from 26a's vocabulary as ported (the
// opt-in's box, the scale's dashed rows, the foot's links, 25a's field and key, lot 1's OSM
// rows and password form; docs/interface.md §3). Shown when GET /api/config offers the
// synchronisation (`sync`) and GET /api/osm/sync says `offered`; nothing of it otherwise.
// Two exclusive choices, a real radio group: « Rester sur Surveillance World » (the default)
// and « Publier aussi sur OpenStreetMap en mon nom », with what the second means (what
// leaves, under her OSM name, public and permanent, deleting the account here does not
// remove it there, only what she sends after the choice, « sera publiée sur OSM en votre nom
// après relecture », a value the review changed does not leave). Choosing it unfolds the
// password (an account that has one) and « Autoriser sur OpenStreetMap »: POST
// /api/osm/sync {on: true}, then OSM's page (scope write_api), back with `?osm=write_on`:
// « Activé depuis <mois> » and, optional, « Vous pouvez lier la page du projet depuis votre
// profil OSM » (the wiki page, a new window). Going back unfolds what stopping does and its key: POST {on:
// false}. The states: suspended by the team, OSM's authorisation withdrawn (« autorisez à
// nouveau »), the account blocked on OSM, tried again later, the test server. Then the
// history: each contribution that went or may still go, its camera, its question, its
// month and what became of it (account/syncline.ts).
import { readSync, type Sync, startSync, stopSync } from "../account/osm";
import { cameraName, stateParts } from "../account/syncline";
import { siteConfig } from "../config";
import { t } from "../i18n";
import { ApiError } from "../participate/api";
import type { ProfileContext } from "./context";
import { drawn, el, link, monthYear } from "./dom";

/** What leaves, in rules/publish.yaml's order (`answers`, `add_tags`): fr.json's
 * board.sync.leaves.* lines. */
const LEAVES = ["add", "shape", "direction", "operator", "verify"];

/** The section, hidden until GET /api/osm/sync offers the synchronisation; none when the
 * site does not. */
export function syncSection(ctx: ProfileContext): HTMLElement[] {
  if (!siteConfig().sync) return [];
  const section = el("section", "board-publish board-sync");
  section.hidden = true;
  section.setAttribute("aria-labelledby", "board-sync-title");
  const title = el("h3", "board-publish-title");
  title.id = "board-sync-title";
  const body = el("div", "board-publish-body");
  // What a choice gave (stopped, refused), said (role status).
  const note = el("p", "board-note board-sync-note");
  note.setAttribute("role", "status");
  section.append(title, body, note);
  void readSync().then((s) => {
    if (!s?.offered || !section.isConnected) return;
    title.append(t("board.sync.title"));
    section.hidden = false;
    draw(ctx, body, note, s, null);
  });
  return [section];
}

/** The section's body for `s`; `focus`: the radio to focus once drawn (after a change). */
function draw(
  ctx: ProfileContext,
  body: HTMLElement,
  note: HTMLElement,
  s: Sync,
  focus: "stay" | "publish" | null,
): void {
  body.replaceChildren();
  // The states first: what holds the sends now.
  for (const line of stateLines(s)) body.append(line);

  const group = el("div", "board-sync-choices");
  group.setAttribute("role", "radiogroup");
  group.setAttribute("aria-labelledby", "board-sync-title");
  const choice = (value: "stay" | "publish") => {
    const label = el("label", "board-sync-choice");
    const input = el("input") as HTMLInputElement;
    input.type = "radio";
    input.name = "board-sync";
    input.value = value;
    input.id = `board-sync-${value}`;
    input.checked = (value === "publish") === s.on;
    label.append(input, drawn("", "board-box"), el("span", "", t(`board.sync.${value}`)));
    group.append(label);
    return input;
  };
  const stay = choice("stay");
  const publish = choice("publish");
  body.append(group);
  if (s.on && s.since) {
    const since = el(
      "p",
      "board-sync-since",
      t("board.sync.since", { month: monthYear(s.since).toLocaleLowerCase("fr") }),
    );
    since.id = "board-sync-since";
    publish.setAttribute("aria-describedby", since.id);
    body.append(since);
  }
  if (s.on) body.append(wikiLine());

  // What publishing means, always there: one reads it before choosing.
  const info = el("div", "board-sync-info");
  info.id = "board-sync-info";
  const list = el("ul", "board-sync-leaves");
  for (const k of LEAVES) list.append(el("li", "", t(`board.sync.leaves.${k}`)));
  info.append(
    el("p", "board-publish-info", t("board.sync.info")),
    el("p", "board-publish-info board-sync-leaves-title", t("board.sync.leaves")),
    list,
    el("p", "board-publish-info", t("board.sync.never")),
    el("p", "board-publish-info", t("board.sync.public")),
  );
  group.setAttribute("aria-describedby", info.id);

  const askPassword = ctx.me.password !== false;
  const enable = enableForm(askPassword, () => {
    stay.checked = !s.on;
    publish.checked = s.on;
    (s.on ? publish : stay).focus();
  });
  const stop = stopForm(() => {
    stay.checked = false;
    publish.checked = true;
    publish.focus();
  });
  stop.onStop(async () => {
    note.textContent = "";
    let next: Sync;
    try {
      next = await stopSync();
    } catch {
      return t("board.sync.stop_failed");
    }
    ctx.me.sync = false;
    ctx.me.publish = false;
    draw(ctx, body, note, next, "stay");
    note.textContent = t("board.sync.stopped");
    return null;
  });
  group.addEventListener("change", () => {
    note.textContent = "";
    const wantOn = publish.checked;
    enable.close();
    stop.close();
    if (wantOn && !s.on) enable.open();
    else if (!wantOn && s.on) stop.open();
  });
  body.append(info);
  // Blocked by OSM: the choice stays on, nothing leaves; once the block is lifted, authorise
  // again (the same passage through OSM).
  if (s.on && s.last_error === "blocked") {
    const again = link(t("board.sync.again"), "board-sync-again");
    again.setAttribute("aria-controls", enable.form.id);
    again.addEventListener("click", () => enable.open());
    body.append(again);
  }
  body.append(enable.form, stop.form);
  if (s.history.length) body.append(...history(s));
  if (focus) (focus === "publish" ? publish : stay).focus();
}

/** The project's page on the OpenStreetMap wiki (the changesets' comment links it too,
 * rules/publish.yaml). */
const WIKI = "https://wiki.openstreetmap.org/wiki/Organised_Editing/Activities/Surveillance_World";

/** Once publishing: « Vous pouvez lier la page du projet depuis votre profil OSM », the
 * page a link (a new window: « ↗ », said), a choice left to her. */
function wikiLine(): HTMLElement {
  const p = el("p", "board-sync-wiki");
  const a = el("a", "account-link", t("board.sync.wiki.link")) as HTMLAnchorElement;
  a.href = WIKI;
  a.target = "_blank";
  a.rel = "noopener";
  a.append(drawn(" ↗"), el("span", "sheet-sr", ` ${t("sheet.punk.new_window")}`));
  p.append(`${t("board.sync.wiki")} `, a);
  return p;
}

/** The lines above the choices: suspended by the team; OSM's authorisation withdrawn (the
 * choice is then off: « autorisez à nouveau »); her account blocked on OSM; OSM limiting or
 * down (tried again later); the test server. */
function stateLines(s: Sync): HTMLElement[] {
  const lines: HTMLElement[] = [];
  const line = (key: string, warn = true) =>
    lines.push(el("p", `board-sync-state${warn ? " warn" : ""}`, t(key)));
  if (s.suspended) line("board.sync.suspended");
  if (s.last_error === "revoked" && !s.on) line("board.sync.revoked");
  if (s.on && s.last_error && s.last_error !== "revoked") line(`board.sync.${s.last_error}`);
  if (s.server === "dev") line("board.sync.dev", false);
  return lines;
}

/** « Publier aussi… » chosen: the password asked again for an account that has one (a stolen
 * session alone must not publish in its owner's name), then OSM's page. `cancel`: the
 * choice back as it was. */
function enableForm(
  askPassword: boolean,
  cancelled: () => void,
): { form: HTMLFormElement; open: () => void; close: () => void } {
  const form = el("form", "board-password-form board-sync-enable") as HTMLFormElement;
  form.id = "board-sync-enable";
  form.hidden = true;
  form.noValidate = true;
  const input = el("input") as HTMLInputElement;
  const error = el("p", "board-form-error");
  error.id = "board-sync-enable-error";
  error.setAttribute("role", "alert");
  if (askPassword) {
    const label = el("label", "board-field");
    input.type = "password";
    input.autocomplete = "current-password";
    input.setAttribute("aria-describedby", error.id);
    label.append(t("board.sync.password"), input);
    form.append(label);
  }
  const submit = el("button", "account-key primary board-sync-enable-submit") as HTMLButtonElement;
  submit.type = "submit";
  submit.append(el("span", "", t("board.sync.authorise")), drawn("→"));
  const cancel = link(t("board.delete.cancel"), "board-sync-enable-cancel");
  form.append(error, submit, cancel);
  const close = () => {
    form.hidden = true;
    input.value = "";
    input.removeAttribute("aria-invalid");
    error.textContent = "";
  };
  const open = () => {
    form.hidden = false;
    (askPassword ? input : submit).focus();
  };
  cancel.addEventListener("click", () => {
    close();
    cancelled();
  });
  let sending = false;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (sending) return;
    if (askPassword && !input.value) {
      error.textContent = t("board.sync.empty");
      input.setAttribute("aria-invalid", "true");
      input.focus();
      return;
    }
    sending = true;
    submit.setAttribute("aria-disabled", "true");
    form.setAttribute("aria-busy", "true");
    error.textContent = "";
    try {
      const { url } = await startSync(askPassword ? input.value : null);
      window.location.assign(url);
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      const code = err instanceof ApiError ? err.code : "";
      error.textContent = t(
        status === 401
          ? "board.sync.wrong"
          : code === "test_account"
            ? "board.sync.test_account"
            : code === "closed"
              ? "board.sync.closed"
              : "board.sync.failed",
      );
      if (askPassword && status === 401) {
        input.setAttribute("aria-invalid", "true");
        input.select();
      }
    } finally {
      sending = false;
      submit.removeAttribute("aria-disabled");
      form.removeAttribute("aria-busy");
    }
  });
  return { form, open, close };
}

/** « Rester sur Surveillance World » chosen while publishing: what stopping does, its key,
 * « Annuler ». The key's action (`onStop`) answers an error to say, or null. */
function stopForm(cancelled: () => void): {
  form: HTMLFormElement;
  open: () => void;
  close: () => void;
  onStop: (act: () => Promise<string | null>) => void;
} {
  const form = el("form", "board-password-form board-sync-stop") as HTMLFormElement;
  form.id = "board-sync-stop";
  form.hidden = true;
  form.noValidate = true;
  const warn = el("p", "board-delete-warn", t("board.sync.stop.warn"));
  warn.id = "board-sync-stop-warn";
  const error = el("p", "board-form-error");
  error.id = "board-sync-stop-error";
  error.setAttribute("role", "alert");
  const submit = el("button", "account-key primary board-sync-stop-submit") as HTMLButtonElement;
  submit.type = "submit";
  submit.setAttribute("aria-describedby", warn.id);
  submit.append(el("span", "", t("board.sync.stop.submit")), drawn("→"));
  const cancel = link(t("board.delete.cancel"), "board-sync-stop-cancel");
  form.append(warn, error, submit, cancel);
  let act: () => Promise<string | null> = async () => null;
  const close = () => {
    form.hidden = true;
    error.textContent = "";
  };
  cancel.addEventListener("click", () => {
    close();
    cancelled();
  });
  let sending = false;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (sending) return;
    sending = true;
    submit.setAttribute("aria-disabled", "true");
    form.setAttribute("aria-busy", "true");
    const why = await act();
    sending = false;
    submit.removeAttribute("aria-disabled");
    form.removeAttribute("aria-busy");
    if (why) error.textContent = why;
  });
  return {
    form,
    open: () => {
      form.hidden = false;
      submit.focus();
    },
    close,
    onStop: (f) => {
      act = f;
    },
  };
}

/** « Vos contributions et OSM (N) »: each one, its camera, its question and month, what
 * became of it. */
function history(s: Sync): HTMLElement[] {
  const heading = el("h4", "board-title board-sync-history-title");
  heading.id = "board-sync-history";
  heading.textContent = t("board.sync.history", { n: s.history.length });
  const list = el("ul", "board-sync-history");
  list.setAttribute("aria-labelledby", heading.id);
  for (const item of s.history) {
    const li = el("li", `board-sync-item ${item.state}`);
    li.dataset.uuid = item.uuid;
    const what = [t(`part.mine.kind.${item.kind}`)];
    if (item.month) what.push(monthYear(item.month));
    const line = el("p", "board-publish-line board-sync-line");
    line.append(`${what.join(" · ")} · `, ...stateParts(item, s.url));
    li.append(el("span", "board-publish-name", cameraName(item.label)), line);
    list.append(li);
  }
  return [heading, list];
}
