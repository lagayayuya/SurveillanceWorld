// What /revue says: a status read aloud (`say`), an error read aloud and shown (`fail`,
// never a silently greyed button), and the toast after a decision taken from `pending`:
// « Validée. » with « Annuler » for 8 s, a real button Tab reaches (the toast follows the
// action bar in the page's order); its time stops while the pointer or the focus is on it.
import { t } from "../i18n";
import { ApiError, isNetworkError } from "../participate/api";
import { Cancelled } from "./auth";
import { el } from "./rows";

const UNDO_MS = 8000;

const live = () => document.getElementById("review-live") as HTMLElement;
const alert = () => document.getElementById("review-alert") as HTMLElement;

/** Read `text` aloud (role status); the same text again is read again. */
export function say(text: string): void {
  const box = live();
  box.textContent = "";
  window.setTimeout(() => {
    box.textContent = text;
  }, 50);
}

/** An API error in a sentence (the administrator's refusals of lot 2 too); the password
 * not given again, said as such. */
export function errorText(e: unknown): string {
  if (e instanceof Cancelled) return t("review.error.cancelled");
  if (e instanceof ApiError) {
    const known = [
      "rate",
      "not_a_change",
      "withdrawn",
      "element_gone",
      "operator_choice",
      "operator_name",
      "not_undoable",
      "unknown_camera",
      "self",
      "last_admin",
      "needs_password",
      "placeholder",
      "test_account",
      "confirmation",
      "unknown_account",
      "camera_id",
      "not_hidden",
      "admin",
      "no_live_client",
    ];
    if (known.includes(e.code)) return t(`review.error.${e.code}`);
    return t("review.error.server", { status: String(e.status) });
  }
  if (isNetworkError(e)) return t("review.error.offline");
  return t("review.error.server", { status: String(e) });
}

/** Say an error (role alert) and show it in `where` (a line of the view), if given. */
export function fail(text: string, where?: HTMLElement | null): void {
  const box = alert();
  box.textContent = "";
  window.setTimeout(() => {
    box.textContent = text;
  }, 50);
  if (where) {
    where.textContent = text;
    where.hidden = false;
  }
}

let current: { box: HTMLElement; timer: number; stop: () => void } | null = null;

/** Drop the toast on screen, if any. */
export function dropToast(): void {
  if (!current) return;
  current.stop();
  current.box.remove();
  current = null;
}

/** « Validée. » / « Rejetée. » / « 3 contributions validées. » with « Annuler » for 8 s;
 * `undo` runs on a tap. One toast at a time: a new decision replaces it. */
export function toast(text: string, undo: (() => Promise<void>) | null): void {
  dropToast();
  const host = document.getElementById("review-toast-host") as HTMLElement;
  const box = el("div", "", "review-toast");
  box.append(el("span", text, "review-toast-text"));
  say(text);
  let left = UNDO_MS;
  let started = Date.now();
  let paused = false;
  let timer = 0;
  const end = () => {
    if (current?.box === box) {
      current.stop();
      current = null;
    }
    box.remove();
  };
  if (!undo) {
    timer = window.setTimeout(end, 4000);
    host.append(box);
    current = { box, timer, stop: () => clearTimeout(timer) };
    return;
  }
  const button = el("button", "", "review-toast-undo");
  button.type = "button";
  button.setAttribute("aria-label", t("review.toast.undo_label"));
  const seconds = () => Math.max(0, Math.ceil(left / 1000));
  const draw = () => {
    button.textContent = t("review.toast.undo", { s: String(seconds()) });
  };
  draw();
  const tick = () => {
    if (!paused) {
      left -= Date.now() - started;
      started = Date.now();
    }
    if (left <= 0) {
      end();
      return;
    }
    draw();
    timer = window.setTimeout(tick, Math.min(1000, left));
  };
  timer = window.setTimeout(tick, 1000);
  const pause = () => {
    if (paused) return;
    left -= Date.now() - started;
    paused = true;
  };
  const resume = () => {
    if (!paused || box.contains(document.activeElement) || box.matches(":hover")) return;
    paused = false;
    started = Date.now();
  };
  box.addEventListener("pointerenter", pause);
  box.addEventListener("pointerleave", resume);
  box.addEventListener("focusin", pause);
  box.addEventListener("focusout", () => window.setTimeout(resume, 0));
  button.addEventListener("click", async () => {
    button.disabled = true;
    clearTimeout(timer);
    try {
      await undo();
      end();
    } catch (e) {
      end();
      fail(errorText(e));
    }
  });
  box.append(button);
  host.append(box);
  current = { box, timer, stop: () => clearTimeout(timer) };
}
