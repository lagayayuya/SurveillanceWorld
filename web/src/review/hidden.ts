// /revue's « Retraits », for administrators (lot 2 « Administrer », board P5): « Caméras
// masquées » — a camera hidden by its id or by a map link (?cam=<id>), what it is said under
// the field before (GET /api/review/camera's label, or « Inconnue de la base »), then the
// list: the id, the day it was hidden, and whether it has left the map (« au prochain
// build », « retirée de la carte (build X) »), each with « Démasquer » (the password again).
// Only the id and the day are kept (DECISIONS 2026-10-13: a private procedure): no field for
// a reason, a requester or any free text.
import { t } from "../i18n";
import { ApiError, call, shortBuild } from "../participate/api";
import { type AdminNav, button, frame, shortDay, table } from "./admin";
import { withReauth } from "./auth";
import { el, type Label, labelText } from "./rows";
import { errorText, fail } from "./say";

export type Hidden = {
  camera: string;
  added_on: string;
  applied_build: string | null;
  label: Label | null;
};

/** A camera id (the API's format): OpenStreetMap's n/w/r and digits, or an add's c and 12
 * hexadecimal characters. */
export const CAMERA_ID = /^(?:[nwr]\d{1,15}|c[0-9a-f]{12})$/;

/** The id typed or pasted: the id itself, or a map link's ?cam=. */
export function cameraOf(text: string): string {
  const raw = text.trim();
  if (/[?&]cam=/.test(raw)) {
    try {
      return (new URL(raw, window.location.origin).searchParams.get("cam") ?? "").trim();
    } catch {
      return raw;
    }
  }
  return raw;
}

/** « au prochain build » (a tag) or « retirée de la carte (build X) ». */
export function onMap(h: Pick<Hidden, "applied_build">): HTMLElement {
  return h.applied_build
    ? el("span", t("review.hidden.applied", { build: shortBuild(h.applied_build) }))
    : el("span", t("review.hidden.next"), "review-tag warn");
}

export async function hiddenView(
  app: HTMLElement,
  nav: AdminNav,
  note: string | null,
): Promise<void> {
  const v = frame(app, nav.head("retraits"), "review-hidden", t("review.hidden.title"), note);
  const form = el("form", "", "review-hide-form");
  const input = el("input", "", "review-search");
  input.id = "review-hide-id";
  input.placeholder = t("review.hidden.input");
  input.setAttribute("aria-label", t("review.hidden.input.label"));
  input.setAttribute("aria-describedby", "review-hide-preview");
  input.autocomplete = "off";
  input.autocapitalize = "none";
  input.spellcheck = false;
  input.maxLength = 300;
  const submit = el("button", t("review.hidden.submit"), "review-button primary");
  submit.type = "submit";
  const row = el("div", "", "review-hide-row");
  row.append(input, submit);
  const preview = el("p", "", "review-muted review-hide-preview");
  preview.id = "review-hide-preview";
  preview.setAttribute("aria-live", "polite");
  const error = el("p", "", "review-error review-inline-error");
  error.hidden = true;
  form.append(row, preview, error);
  const list = el("div", "", "review-hidden-list");
  v.main.append(
    form,
    list,
    el("p", t("review.hidden.kept"), "review-muted"),
    el("p", t("review.hidden.note"), "review-muted"),
  );

  // What the id is, under the field, as it is typed (a typo shows before hiding).
  let asked = 0;
  let timer = 0;
  input.addEventListener("input", () => {
    clearTimeout(timer);
    error.hidden = true;
    const mine = ++asked;
    const id = cameraOf(input.value);
    if (!CAMERA_ID.test(id)) {
      preview.textContent = "";
      return;
    }
    timer = window.setTimeout(async () => {
      let text: string;
      try {
        const w = await call<{ label: Label }>(
          "GET",
          `/api/review/camera?${new URLSearchParams({ camera: id })}`,
        );
        text = `${id} : ${labelText(w.label)}`;
      } catch (e) {
        text =
          e instanceof ApiError && e.code === "unknown_camera"
            ? `${id} : ${t("review.hidden.unknown")}`
            : "";
      }
      if (mine === asked) preview.textContent = text;
    }, 300);
  });

  const load = async () => {
    const rows = await call<Hidden[]>("GET", "/api/review/hidden");
    const tb = table(t("review.hidden.caption"), [
      t("review.col.camera"),
      t("review.col.since"),
      t("review.col.on_map"),
      "",
    ]);
    // The last column's head: its buttons' name says what they do.
    tb.table
      .querySelector("thead th:last-child")
      ?.append(el("span", t("review.hidden.unhide"), "review-sr"));
    for (const h of rows) {
      const tr = el("tr");
      tr.dataset.camera = h.camera;
      const th = el("th", "", "review-name");
      th.scope = "row";
      th.append(el("code", h.camera));
      if (h.label) th.append(el("span", labelText(h.label), "review-muted review-sub"));
      const unhide = button(t("review.hidden.unhide"));
      unhide.setAttribute("aria-label", t("review.hidden.unhide.label", { id: h.camera }));
      unhide.addEventListener("click", async () => {
        error.hidden = true;
        unhide.setAttribute("aria-disabled", "true");
        try {
          await withReauth(() =>
            call("POST", "/api/review/hidden", { camera: h.camera, hide: false }),
          );
          v.note.textContent = t("review.hidden.unhidden", { id: h.camera });
          v.note.hidden = false;
          await load();
          v.h1.focus({ preventScroll: true });
        } catch (e) {
          unhide.removeAttribute("aria-disabled");
          fail(errorText(e), error);
        }
      });
      const action = el("td");
      action.append(unhide);
      tr.append(th, el("td", shortDay(h.added_on), "review-num"), el("td"), action);
      tr.children[2].append(onMap(h));
      tb.body.append(tr);
    }
    list.replaceChildren(rows.length ? tb.table : el("p", t("review.hidden.none"), "review-muted"));
  };

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    error.hidden = true;
    const id = cameraOf(input.value);
    if (!CAMERA_ID.test(id)) {
      fail(t("review.error.camera_id"), error);
      input.focus();
      return;
    }
    submit.setAttribute("aria-disabled", "true");
    try {
      const r = await call<{ known: boolean; changed: boolean }>("POST", "/api/review/hidden", {
        camera: id,
        hide: true,
      });
      const said = !r.changed
        ? t("review.hidden.already", { id })
        : r.known
          ? t("review.hidden.done", { id })
          : t("review.hidden.done_unknown", { id });
      // Said by the note (role status).
      v.note.textContent = said;
      v.note.hidden = false;
      input.value = "";
      preview.textContent = "";
      await load();
    } catch (err) {
      fail(errorText(err), error);
    } finally {
      submit.removeAttribute("aria-disabled");
    }
  });

  try {
    await load();
  } catch (e) {
    nav.fail(e);
    return;
  }
  v.focus();
}
