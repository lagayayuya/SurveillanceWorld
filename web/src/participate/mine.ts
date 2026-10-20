// "Vos contributions": what is stored and what is not (DECISIONS.md 2026-09-29), what
// still waits on this phone, and the contributions the API holds for this account. Each
// one still pending (or waiting on the phone) can be withdrawn, in two steps.
// Punk's own words where it has them (i18n.ts tp: « acceptée »). Punk, the OSM
// synchronisation offered (16/10): under a contribution that went or may still go to OSM,
// what became of it there (« OSM : partira après relecture », « OSM : publiée · changeset
// n° N »…), read from GET /api/osm/sync's history (asked once per page, shared with
// « Compte »; account/syncline.ts), or from the send's own answer for one sent since.
import { readSync, type Sync } from "../account/osm";
import { stateParts } from "../account/syncline";
import { siteConfig } from "../config";
import { tp as t } from "../i18n";
import { ui } from "../theme";
import { ApiError, mine, SETTLED, shortBuild } from "./api";
import { twoStep } from "./decide";
import type { OnSiteRules } from "./onsite";
import type { Queue } from "./queue";

export function openMine(
  queue: Queue,
  /** `batch`: a sent piece of a « Modifier » send (its pieces go together). */
  withdraw: (uuid: string, batch?: string | null) => Promise<void>,
  onSite: OnSiteRules,
): void {
  document.getElementById("mine")?.remove();
  const page = document.createElement("section");
  page.id = "mine";
  page.setAttribute("role", "dialog");
  page.setAttribute("aria-label", t("part.mine.title"));
  const close = document.createElement("button");
  close.className = "close";
  close.setAttribute("aria-label", t("part.mine.close"));
  close.textContent = "×";
  close.addEventListener("click", () => page.remove());
  const h = document.createElement("h2");
  h.textContent = t("part.mine.title");
  const p = (key: string, params = {}) => {
    const e = document.createElement("p");
    e.textContent = t(key, params);
    return e;
  };
  page.append(
    close,
    h,
    p("part.mine.stored"),
    p("part.mine.not_stored", {
      m: onSite.on_site_m,
      age: onSite.on_site_max_age_s ?? "?",
      acc: onSite.on_site_max_accuracy_m ?? "?",
    }),
    p("part.mine.osm"),
  );
  if (queue.items.length) page.append(p("part.mine.queue", { n: queue.items.length }));
  /** "Retirer" on one line; the line says "retirée" once done. */
  const withdrawable = (
    li: HTMLElement,
    text: HTMLElement,
    uuid: string,
    line: string,
    batch?: string | null,
  ) => {
    const b = twoStep(
      "part.mine.withdraw",
      "part.mine.withdraw_confirm",
      "part-btn quiet mine-withdraw",
      async () => {
        try {
          await withdraw(uuid, batch);
          text.textContent = line.replace(/[^·]*$/, ` ${t("part.mine.status.withdrawn")}`);
          b.remove();
        } catch (e) {
          b.disabled = false;
          b.textContent = t("part.mine.withdraw");
          b.classList.remove("armed");
          // Too many requests in a minute (429) is not being offline.
          const busy = e instanceof ApiError && e.status === 429;
          text.textContent = `${line} · ${t(busy ? "part.mine.busy_withdraw" : "part.mine.offline_withdraw")}`;
        }
      },
    );
    b.dataset.withdraw = uuid;
    li.append(b);
  };
  const line = (li: HTMLElement, value: string) => {
    const text = document.createElement("span");
    text.textContent = value;
    li.append(text);
    return text;
  };
  // What waits on this phone: withdrawn here, never sent.
  const waiting = document.createElement("ul");
  waiting.className = "mine-list";
  for (const item of queue.items) {
    const li = document.createElement("li");
    const value = `${item.body.day} · ${t(`part.mine.kind.${item.body.kind}`)} · ${t("part.mine.status.queued")}`;
    withdrawable(li, line(li, value), item.uuid, value);
    waiting.append(li);
  }
  const list = document.createElement("ul");
  list.className = "mine-list";
  page.append(waiting, list);
  document.body.append(page);
  const sync: Promise<Sync | null> =
    ui() === "punk" && siteConfig().sync ? readSync() : Promise.resolve(null);
  /** « OSM : … » under a contribution, when it went or may still go there. */
  const osmLine = (s: Sync | null, uuid: string, status: string): HTMLElement | null => {
    if (!s?.offered) return null;
    const item =
      s.history.find((h) => h.uuid === uuid) ??
      // Sent since the history was read, the API said it will leave once accepted.
      (queue.publishes(uuid) && status === "pending"
        ? {
            uuid,
            camera: "",
            label: null,
            kind: "",
            status,
            state: "waiting" as const,
            changeset: null,
            reason: null,
            month: null,
          }
        : null);
    if (!item) return null;
    const e = document.createElement("span");
    e.className = "mine-osm";
    const parts = stateParts(item, s.url);
    const [first, ...rest] = parts;
    e.append(t("sync.mine", { state: String(first) }), ...rest);
    return e;
  };
  Promise.all([mine(), sync])
    .then(([r, s]) => {
      if (!r.contributions.length) list.replaceWith(p("part.mine.empty"));
      for (const c of r.contributions) {
        const li = document.createElement("li");
        const what = answerText(c);
        // "Je ne sais pas" / "Je ne vois pas": statistics only, no decision awaited.
        const blank = c.answer === "unknown" || c.answer === "not_visible";
        const status = t(blank ? "part.mine.status.recorded" : `part.mine.status.${c.status}`);
        const state =
          c.apply_build && SETTLED.includes(c.status)
            ? t("part.mine.build", { status, build: shortBuild(c.apply_build) })
            : status;
        const value = `${c.day} · ${t(`part.mine.kind.${c.kind}`)} · ${what} · ${state}`;
        const text = line(li, value);
        // In the text: withdrawn, it goes with it (nothing leaves any more).
        const osm = osmLine(s, c.uuid, c.status);
        if (osm) text.append(osm);
        if (c.status === "pending") withdrawable(li, text, c.uuid, value, c.batch);
        list.append(li);
      }
    })
    .catch(() => list.replaceWith(p("part.mine.offline")));
}

/** What a contribution said, in a few words (also the review's "Réponse" column). */
export function answerText(c: {
  kind: string;
  answer: string | null;
  move_m?: number | null;
  direction?: number | null;
  operator_name?: string | null;
  /** A name not listed, under review: said, never shown (the lot of 2026-10-12). */
  operator_proposed?: boolean | string | null;
}): string {
  switch (c.kind) {
    case "verify":
      return t(`part.mine.answer.${c.answer}`);
    case "move":
      return t("part.mine.moved", { m: c.move_m ?? 0 });
    case "shape":
      return c.answer === "unknown"
        ? t("part.complete.unknown").toLowerCase()
        : t(`part.complete.shape.${c.answer}`).toLowerCase();
    case "direction":
      return c.answer === "not_visible"
        ? t("part.complete.direction.not_visible").toLowerCase()
        : t("part.mine.direction", { deg: c.direction ?? 0 });
    case "height":
    case "tilt":
      return c.answer === "unknown"
        ? t("part.complete.unknown").toLowerCase()
        : t(`chip.value.${c.kind}.${c.answer}`);
    case "operator": {
      const cls =
        c.answer === "unknown"
          ? t("part.complete.unknown").toLowerCase()
          : t(`part.complete.operator.${c.answer}`).toLowerCase();
      if (c.operator_name) return `${cls} (${c.operator_name})`;
      return c.operator_proposed ? `${cls} (${t("modify.operator.under_review")})` : cls;
    }
    default:
      return t(`part.mine.answer.${c.kind}`);
  }
}
