// What the administrator's views of /revue share (lot 2 « Administrer »): their place in
// the page (main.ts's head with its tabs, their addresses), the frame each view draws (one
// h1 focused, a line said at its top), a short day, tables, and the downloads after the
// password given again (auth.ts).
import { ApiError } from "../participate/api";
import { Cancelled, ensureReauth, type Who, withReauth } from "./auth";
import { el } from "./rows";
import { errorText, fail } from "./say";

export const ADMIN_VIEWS = ["comptes", "retraits", "reglages", "statistiques", "journal"] as const;
export type AdminView = (typeof ADMIN_VIEWS)[number];
export type Tab = "queue" | AdminView;

export type AdminNav = {
  readonly who: Who;
  /** The head « Revue » with its tabs, `current` pressed. */
  head(current: Tab): HTMLElement;
  /** The address of a view (the interface and mode kept). */
  href(params: Record<string, string>): string;
  /** Open a view (`params`: vue, compte, camera, filters), `note` said at its top. */
  go(params: Record<string, string>, how: "push" | "replace", note?: string | null): void;
  /** A link that opens its view in place on a plain click. */
  inPlace(a: HTMLAnchorElement, go: () => void): HTMLAnchorElement;
  /** A refused call that ends the view (401: the sign-in; the API down). */
  fail(e: unknown): void;
};

/** A view's frame into `app`: `top` (the head with its tabs, or a bar back), its main with
 * one h1 and, under it, `note` (a line said at the top: « Compte ana supprimé. »). The h1
 * takes the focus once the caller has filled the view (`focus`). */
export function frame(
  app: HTMLElement,
  top: HTMLElement,
  id: string,
  title: string,
  note: string | null,
  h1InTop = false,
): { main: HTMLElement; h1: HTMLHeadingElement; note: HTMLElement; focus(): void } {
  const main = el("main", "", "review-main review-admin");
  main.id = id;
  const h1 = el("h1", title);
  h1.tabIndex = -1;
  const line = el("p", "", "review-note");
  line.setAttribute("role", "status");
  line.hidden = !note;
  // Written once the line is in the page: a status present at insertion is not reliably
  // read aloud (« Compte gil supprimé. », « Rôle changé : Relecteur. »).
  if (note) window.setTimeout(() => (line.textContent = note), 50);
  if (h1InTop) top.append(h1);
  else main.append(h1);
  main.append(line);
  app.replaceChildren(top, main);
  // No decision bar here (camera.ts sets its height).
  document.documentElement.style.removeProperty("--foot-h");
  return {
    main,
    h1,
    note: line,
    focus() {
      if (!main.isConnected) return;
      window.scrollTo(0, 0);
      h1.focus({ preventScroll: true });
    },
  };
}

/** « 15/10 » this year, « 15/10/2025 » before. */
export function shortDay(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  const thisYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("fr", {
    day: "2-digit",
    month: "2-digit",
    ...(thisYear ? {} : { year: "numeric" }),
  });
}

/** A download (an attachment: the CSV, an account's data): the password given lately
 * (GET /api/review/me), else asked first; then fetched (a 403 reauth meanwhile asks it
 * again: withReauth) and saved under the name the API gives. False when it did not
 * happen, said in `where` and aloud. */
export async function download(url: string, where: HTMLElement | null): Promise<boolean> {
  try {
    if (!(await ensureReauth())) throw new Cancelled();
    const r = await withReauth(async () => {
      const res = await fetch(url);
      if (!res.ok) {
        const data = res.headers.get("content-type")?.includes("json") ? await res.json() : null;
        throw new ApiError(res.status, String(data?.error ?? res.statusText));
      }
      return res;
    });
    const name =
      /filename="?([^";]+)"?/.exec(r.headers.get("content-disposition") ?? "")?.[1] ?? "export";
    const a = el("a");
    a.href = URL.createObjectURL(await r.blob());
    a.download = name;
    a.hidden = true;
    document.body.append(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
    return true;
  } catch (e) {
    fail(errorText(e), where);
    return false;
  }
}

/** A small button. */
export function button(text: string, cls = "review-button small"): HTMLButtonElement {
  const b = el("button", text, cls);
  b.type = "button";
  return b;
}

/** A table with its caption (read, not shown) and column heads (`th scope="col"`). */
export function table(
  caption: string,
  heads: string[],
  cls = "",
): {
  table: HTMLTableElement;
  body: HTMLTableSectionElement;
} {
  const tb = el("table", "", `review-table ${cls}`.trim());
  tb.append(el("caption", caption, "review-sr"));
  const tr = el("tr");
  for (const h of heads) {
    const th = el("th", h);
    th.scope = "col";
    tr.append(th);
  }
  const thead = el("thead");
  thead.append(tr);
  const body = el("tbody");
  tb.append(thead, body);
  return { table: tb, body };
}
