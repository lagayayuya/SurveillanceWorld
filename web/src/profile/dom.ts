// What the profile (25b) and the leaderboard (26a) share: the camera sheet's paper
// (theme/punk/sheet.css: its frame, torn edge, head, links and a phone's bottom sheet), the
// pseudonym as the cut-out title, « Compte · depuis <mois> ».
import { cutout, fitTitle, pinHead } from "../chips";
import { t } from "../i18n";
import { signOut } from "./api";
import { forgetVisit, type ProfileContext } from "./context";

export function el(tag: string, cls = "", text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
/** Said, not seen. */
export const said = (text: string) => el("span", "sheet-sr", text);
/** Seen, not said (an arrow, a dot, a bar). */
export const drawn = (text: string, cls = "") => {
  const e = el("span", cls, text);
  e.setAttribute("aria-hidden", "true");
  return e;
};
export function button(cls: string, text?: string): HTMLButtonElement {
  const b = el("button", cls, text) as HTMLButtonElement;
  b.type = "button";
  return b;
}

/** "2026-03" -> "mars 2026". */
export const monthYear = (m: string) =>
  new Date(`${m}-15T12:00:00`).toLocaleDateString("fr", { month: "long", year: "numeric" });
/** "2026-10" -> "Octobre" (26a's period button). */
export const monthName = (m: string) => {
  const s = new Date(`${m}-15T12:00:00`).toLocaleDateString("fr", { month: "long" });
  return s.charAt(0).toLocaleUpperCase("fr") + s.slice(1);
};
/** This month, "2026-10". */
export const thisMonth = (now = new Date()) =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
/** 1 -> "1er", 4 -> "4e". */
export const ordinal = (n: number) => t(n === 1 ? "profile.rank.first" : "profile.rank.nth", { n });

/** The paper in the sheet: its head (cut-out pseudonym, « Compte · depuis… », the
 * handle on a phone, ×), its top and its body, filled by the caller. */
export function paper(
  ctx: ProfileContext,
  cls: string,
): { paper: HTMLElement; top: HTMLElement; body: HTMLElement; title: HTMLElement } {
  const frame = ctx.sheet;
  frame.replaceChildren();
  const page = el("div", `sheet-paper profile-paper ${cls}`);
  const top = el("div", "sheet-top");
  const body = el("div", "sheet-body");
  const head = el("div", "sheet-head");
  const column = el("div", "sheet-title");
  const title = cutout(ctx.me.pseudonym, ctx.me.pseudonym);
  const since = el("p", "profile-since", t("profile.since", { month: monthYear(ctx.me.since) }));
  column.append(title, since);
  const grab = button("sheet-grab");
  grab.setAttribute("aria-label", t("sheet.grab"));
  grab.append(el("span", "handle"));
  grab.addEventListener("click", () => ctx.grab());
  const close = button("close");
  close.setAttribute("aria-label", t("sheet.close"));
  close.append(drawn("×"));
  close.addEventListener("click", () => ctx.close());
  head.append(column, grab, close);
  top.append(head);
  page.append(top, body);
  const edge = el("div", "sheet-frame");
  edge.append(page);
  frame.append(edge);
  return { paper: page, top, body, title };
}

/** Once the paper is in the shown sheet: its title held on its line, a phone's head pinned. */
export function settle(ctx: ProfileContext, page: HTMLElement, title: HTMLElement): void {
  fitTitle(title);
  pinHead(ctx.sheet, page);
}

/** The links at the foot (25b, 26a): a typewriter word with a wavy underline. */
export function link(text: string, cls = ""): HTMLButtonElement {
  return button(`sheet-link${cls ? ` ${cls}` : ""}`, text);
}

/** « Se déconnecter »: DELETE /api/session, the visit forgotten, the sheet closed. */
export function logoutLink(ctx: ProfileContext): HTMLElement {
  const b = link(t("profile.logout"), "profile-logout");
  b.addEventListener("click", async () => {
    b.disabled = true;
    b.parentElement?.querySelector(".profile-logout-error")?.remove();
    try {
      await signOut();
    } catch {
      b.disabled = false;
      const note = el("p", "profile-error profile-logout-error", t("profile.logout.offline"));
      note.setAttribute("role", "status");
      b.after(note);
      return;
    }
    forgetVisit(ctx.me.pseudonym);
    ctx.close();
    ctx.signedOut();
  });
  return b;
}
