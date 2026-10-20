// Who is in /revue and the password asked again (lot 2 « Administrer » of its redesign,
// plan-revue §5): the privileged entry (POST /api/review/session: a reviewer's or an
// administrator's password; the map's sessions, OpenStreetMap's or /api/session's, never
// open /revue), who it is (GET /api/review/me: the pseudonym, the role the tabs follow,
// whether the password was given again lately), and the dialog « Confirmez avec votre mot
// de passe » that an administrator's destructive action opens when the API answers 403
// reauth (POST /api/review/reauth, valid 10 minutes): the action is then tried once more.
// A native modal <dialog>: the rest of the page is inert while it is open, Escape cancels,
// the focus goes back where it was.
import { t } from "../i18n";
import { ApiError, call } from "../participate/api";
import { el } from "./rows";
import { say } from "./say";

export type Role = "reviewer" | "admin";
export type Who = { pseudonym: string; role: Role; reauth: boolean };

/** GET /api/review/me; throws the API's refusal (401 privileged: not signed in here). */
export const fetchWho = () => call<Who>("GET", "/api/review/me");

/** What the privileged entry gave: in, refused (one answer for every refusal, after the
 * server's delay), offline, or anything else. */
export type SignInResult = "ok" | "credentials" | "offline" | "error";

/** POST /api/review/session: the session cookie, marked privileged for a few hours. */
export async function signIn(pseudonym: string, password: string): Promise<SignInResult> {
  try {
    await call("POST", "/api/review/session", { pseudonym, password });
    return "ok";
  } catch (e) {
    if (e instanceof ApiError) return e.status === 401 ? "credentials" : "error";
    return "offline";
  }
}

/** The password not given again: the action did not run. */
export class Cancelled extends Error {
  constructor() {
    super("cancelled");
  }
}

let dialog: {
  box: HTMLDialogElement;
  form: HTMLFormElement;
  input: HTMLInputElement;
  error: HTMLParagraphElement;
  submit: HTMLButtonElement;
} | null = null;

function build(): NonNullable<typeof dialog> {
  const box = el("dialog", "", "review-dialog");
  box.id = "review-reauth";
  box.setAttribute("aria-labelledby", "review-reauth-title");
  box.setAttribute("aria-describedby", "review-reauth-hint");
  const form = el("form", "", "review-dialog-form");
  const h2 = el("h2", t("review.reauth.title"));
  h2.id = "review-reauth-title";
  const hint = el("p", t("review.reauth.hint"), "review-muted");
  hint.id = "review-reauth-hint";
  const label = el("label", "", "review-field");
  const input = el("input");
  input.id = "review-reauth-password";
  input.type = "password";
  input.autocomplete = "current-password";
  input.required = true;
  label.append(el("span", t("review.reauth.password")), input);
  const error = el("p", "", "review-login-error");
  error.setAttribute("role", "alert");
  error.hidden = true;
  const actions = el("div", "", "review-dialog-actions");
  const cancel = el("button", t("review.reauth.cancel"), "review-button");
  cancel.type = "button";
  cancel.value = "cancel";
  cancel.addEventListener("click", () => box.close("cancel"));
  const submit = el("button", t("review.reauth.submit"), "review-button primary");
  submit.type = "submit";
  actions.append(cancel, submit);
  form.append(h2, hint, label, error, actions);
  box.append(form);
  document.body.append(box);
  return { box, form, input, error, submit };
}

/** « Confirmez avec votre mot de passe »: true once the API took it (204), false when
 * cancelled (Annuler, Escape). A wrong password is said in the dialog, which stays. */
export function askPassword(): Promise<boolean> {
  dialog ??= build();
  const { box, form, input, error, submit } = dialog;
  const back = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  input.value = "";
  error.hidden = true;
  box.returnValue = "";
  return new Promise((resolve) => {
    let busy = false;
    const onSubmit = async (e: SubmitEvent) => {
      e.preventDefault();
      if (busy) return;
      busy = true;
      submit.setAttribute("aria-disabled", "true");
      form.setAttribute("aria-busy", "true");
      let why: string | null = null;
      try {
        await call("POST", "/api/review/reauth", { password: input.value });
      } catch (err) {
        why =
          err instanceof ApiError
            ? err.status === 401 && err.code === "credentials"
              ? "review.reauth.wrong"
              : err.status === 401
                ? "review.signin.expired"
                : "account.form.failed"
            : "account.form.offline";
      } finally {
        busy = false;
        submit.removeAttribute("aria-disabled");
        form.removeAttribute("aria-busy");
      }
      if (why) {
        error.textContent = t(why);
        error.hidden = false;
        input.value = "";
        input.focus();
        return;
      }
      box.close("ok");
    };
    const onClose = () => {
      form.removeEventListener("submit", onSubmit);
      box.removeEventListener("close", onClose);
      const ok = box.returnValue === "ok";
      if (ok) say(t("review.reauth.done"));
      // The focus back on what opened it (the action's button), if still in the page.
      if (back?.isConnected) back.focus({ preventScroll: true });
      resolve(ok);
    };
    form.addEventListener("submit", onSubmit);
    box.addEventListener("close", onClose);
    box.showModal();
    input.focus();
  });
}

/** Run `act`; on 403 reauth, the password asked, then `act` once more. Throws Cancelled
 * when the password is not given, and any other refusal as it came. */
export async function withReauth<T>(act: () => Promise<T>): Promise<T> {
  try {
    return await act();
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 403 && e.code === "reauth")) throw e;
  }
  if (!(await askPassword())) throw new Cancelled();
  return act();
}

/** Before a download the browser makes itself (a navigation cannot open the dialog):
 * the password given lately, or asked now. False when cancelled. */
export async function ensureReauth(): Promise<boolean> {
  const who = await fetchWho();
  return who.reauth || askPassword();
}
