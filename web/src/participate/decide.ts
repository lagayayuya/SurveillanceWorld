// The review account's decision on a contribution in the camera sheet: "Valider" /
// "Rejeter", each in two steps on the button itself (no native dialog), through
// POST /api/review/decide; /revue decides in one tap with « Annuler » and keeps the two
// steps for « Changer la décision » (twoStep). A validated contribution is applied by the next build deployed;
// rejecting an applied one puts the camera back in the build after.
import { t } from "../i18n";
import { call } from "./api";

const ARMED_MS = 6000;

export type Decision = "validated" | "rejected";

/** A button asking once more before `act` ("… : confirmer"), back to itself after 6 s. */
export function twoStep(
  key: string,
  confirmKey: string,
  cls: string,
  act: () => Promise<void>,
): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = cls;
  b.textContent = t(key);
  let armed = 0;
  b.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (!armed) {
      b.textContent = t(confirmKey);
      b.classList.add("armed");
      armed = window.setTimeout(() => {
        armed = 0;
        b.textContent = t(key);
        b.classList.remove("armed");
      }, ARMED_MS);
      return;
    }
    clearTimeout(armed);
    armed = 0;
    b.disabled = true;
    await act();
  });
  return b;
}

/** What « Changer la décision » turns a decided contribution into (the API's CHANGES):
 * validated <-> rejected, applied -> rejected (the next build puts the camera back);
 * nothing for a superseded or withdrawn one. */
export function changeTo(status: string): Decision | null {
  if (status === "validated" || status === "applied") return "rejected";
  if (status === "rejected") return "validated";
  return null;
}

/** « Changer la décision », then « Rejeter : confirmer » (or « Valider : confirmer »). */
export function changeButton(
  uuid: string,
  status: string,
  after: (decision: Decision) => void | Promise<void>,
): HTMLButtonElement {
  const to = changeTo(status) as Decision;
  const key = to === "rejected" ? "decide.reject_confirm" : "decide.validate_confirm";
  const b = twoStep("decide.change", key, `reject decide-change decide-${to}`, async () => {
    await call("POST", "/api/review/decide", { uuid, decision: to });
    await after(to);
  });
  b.dataset.to = to;
  return b;
}

/** "Valider" and "Rejeter" for one contribution; the one matching its status is off
 * (validating what a build applied or superseded changes nothing). */
export function decisionButtons(
  uuid: string,
  status: string,
  cls: string,
  after: (decision: Decision) => void | Promise<void>,
): HTMLButtonElement[] {
  const make = (decision: Decision, key: string) => {
    const b = twoStep(key, `${key}_confirm`, `${cls} decide-${decision}`, async () => {
      await call("POST", "/api/review/decide", { uuid, decision });
      await after(decision);
    });
    b.disabled =
      status === decision ||
      (decision === "validated" && (status === "applied" || status === "superseded"));
    return b;
  };
  return [make("validated", "decide.validate"), make("rejected", "decide.reject")];
}
