// /revue's « Réglages », for administrators (lot 2 « Administrer », board P5): contributions
// and sign-ups open or closed (two switches, each saying what closing does; the API's
// routes follow at once, without a restart: DECISIONS, Q2 of plan-revue); the OSM
// synchronisation (16/10): « Synchronisation OSM » (suspended: no send to OSM at all) and
// « Écriture sur le vrai serveur OSM » (off by default; only after the wiki's activity page,
// the forum message and two weeks; greyed with its reason while the deploy has no client for
// the live server, the API's 409 no_live_client said too), both after the password again
// like the others; what the deploy
// sets, read only (the publisher's identity, the OpenStreetMap servers), and « Exporter
// toutes les contributions (CSV) » (moved here from the queue's foot: the administrator's,
// after the password again, journalled).
import { t } from "../i18n";
import { call } from "../participate/api";
import { type AdminNav, download, frame } from "./admin";
import { withReauth } from "./auth";
import { el } from "./rows";
import { errorText, fail } from "./say";

type Settings = {
  contributions_open: boolean;
  signups_open: boolean;
  osm_sync: boolean;
  osm_write_live: boolean;
  publisher: string | null;
  osm: {
    login_server: "dev" | "live";
    write_offered: boolean;
    write_server?: "dev" | "live" | null;
    live_client?: boolean;
  };
};
const SWITCHES = ["contributions_open", "signups_open", "osm_sync", "osm_write_live"] as const;

export async function settingsView(
  app: HTMLElement,
  nav: AdminNav,
  note: string | null,
): Promise<void> {
  let s: Settings;
  try {
    s = await call<Settings>("GET", "/api/review/settings");
  } catch (e) {
    nav.fail(e);
    return;
  }
  const v = frame(app, nav.head("reglages"), "review-settings", t("review.settings.title"), note);
  const error = el("p", "", "review-error review-inline-error");
  error.hidden = true;
  const rows = el("div", "", "review-settings-rows");

  /** One switch: its name, what closing does, « Oui » / « Non » written beside it. */
  const toggle = (key: (typeof SWITCHES)[number]) => {
    const row = el("div", "", "review-setting");
    const text = el("div", "", "review-setting-text");
    const name = el("p", t(`review.settings.${key}`), "review-setting-name");
    name.id = `review-${key}`;
    const hint = el("p", t(`review.settings.${key}.hint`), "review-muted");
    hint.id = `review-${key}-hint`;
    text.append(name, hint);
    // Writing to OSM's live server cannot be turned on without its client: greyed, its reason
    // said under it (and again on a tap); turning it off stays possible.
    const blocked = () =>
      key === "osm_write_live" && !s.osm_write_live && s.osm.live_client === false;
    const reason = el(
      "p",
      t("review.settings.osm_write_live.no_client"),
      "review-muted review-setting-reason",
    );
    reason.id = `review-${key}-reason`;
    if (key === "osm_write_live") text.append(reason);
    const sw = el("button", "", "review-switch");
    sw.type = "button";
    sw.id = `review-switch-${key}`;
    sw.setAttribute("role", "switch");
    sw.setAttribute("aria-labelledby", name.id);
    sw.setAttribute("aria-describedby", hint.id);
    const word = el("span", "", "review-switch-word");
    const knob = el("span", "", "review-switch-knob");
    knob.setAttribute("aria-hidden", "true");
    sw.append(word, knob);
    const draw = () => {
      sw.setAttribute("aria-checked", String(s[key]));
      word.textContent = t(s[key] ? "review.settings.on" : "review.settings.off");
      const off = blocked();
      reason.hidden = !off;
      sw.classList.toggle("blocked", off);
      if (off) {
        sw.setAttribute("aria-disabled", "true");
        sw.setAttribute("aria-describedby", `${hint.id} ${reason.id}`);
      } else {
        sw.removeAttribute("aria-disabled");
        sw.setAttribute("aria-describedby", hint.id);
      }
    };
    draw();
    sw.addEventListener("click", async () => {
      if (blocked()) {
        fail(t("review.settings.osm_write_live.no_client"), error);
        return;
      }
      if (sw.getAttribute("aria-disabled") === "true") return;
      error.hidden = true;
      sw.setAttribute("aria-disabled", "true");
      try {
        s = await withReauth(() =>
          call<Settings>("POST", "/api/review/settings", { key, value: !s[key] }),
        );
        for (const d of drawers) d();
        v.note.textContent = t("review.settings.done", {
          what: t(`review.settings.${key}`),
          state: t(s[key] ? "review.settings.on" : "review.settings.off").toLocaleLowerCase("fr"),
        });
        v.note.hidden = false;
      } catch (e) {
        fail(errorText(e), error);
      } finally {
        sw.removeAttribute("aria-disabled");
        draw();
      }
    });
    row.append(text, sw);
    drawers.push(draw);
    return row;
  };
  const drawers: (() => void)[] = [];
  rows.append(...SWITCHES.map(toggle));

  /** A line the deploy sets: its name, where it comes from, its value. */
  const fixed = (name: string, sub: string, value: string) => {
    const row = el("div", "", "review-setting review-setting-fixed");
    const text = el("div", "", "review-setting-text");
    text.append(el("p", name, "review-setting-name"), el("p", sub, "review-muted"));
    row.append(text);
    if (value) row.append(el("p", value, "review-setting-value"));
    return row;
  };
  rows.append(
    fixed(
      t("review.settings.publisher"),
      t("review.settings.publisher.hint"),
      s.publisher ?? t("review.settings.publisher.none"),
    ),
    fixed(
      t("review.settings.osm"),
      t("review.settings.osm.value", {
        server: t(`review.settings.osm.${s.osm.login_server}`),
        write: s.osm.write_offered
          ? s.osm.write_server
            ? t(`review.settings.osm.${s.osm.write_server}`)
            : t("review.settings.osm.write_on")
          : t("review.settings.osm.write_off"),
      }),
      "",
    ),
  );

  const data = el("section", "", "review-section");
  data.setAttribute("aria-labelledby", "review-data-title");
  const h2 = el("h2", t("review.settings.data"));
  h2.id = "review-data-title";
  const csv = el("button", t("review.csv"), "review-button small");
  csv.type = "button";
  csv.id = "review-csv";
  csv.setAttribute("aria-describedby", "review-csv-hint");
  const hint = el("p", t("review.csv.hint"), "review-muted");
  hint.id = "review-csv-hint";
  csv.addEventListener("click", async () => {
    error.hidden = true;
    await download("/api/review/export.csv", error);
  });
  data.append(h2, csv, hint);

  v.main.append(rows, error, el("p", t("review.settings.note"), "review-muted"), data);
  v.focus();
}
