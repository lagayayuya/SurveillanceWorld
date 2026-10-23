// "Toujours là ?": three answers. "Je ne la trouve pas" asks again on the button itself
// ("J'ai bien cherché autour : confirmer") before it counts; no native dialog. The gesture
// lasts from opening the question to the answer. Punk, on a camera verified gone (its sheet
// marked `data-gone` by sheet.ts): two answers, « Elle n'est plus là (je confirme) », which
// says « not found » again at once (its words confirm), and « Elle est toujours là »
// (DECISIONS 2026-10-08, « Punk, until further notice… »).
import { t } from "../i18n";
import { type OnSiteRules, onSite, onSiteHelp } from "./onsite";
import { type Contribution, type Queue, today } from "./queue";

const ARMED_MS = 6000; // the confirmation waits this long, then the button comes back

export type Target = { id: string; lngLat: [number, number] };

export function verifyPanel(
  box: HTMLElement,
  cam: Target,
  ctx: {
    queue: Queue;
    buildId: string;
    onSite: OnSiteRules;
    /** `sent`: what was queued (punk scores it, board 8a). */
    onDone: (queued: boolean, sent: { uuid: string; body: Contribution }) => void;
  },
  onCancel: () => void,
): void {
  box.replaceChildren();
  box.append(
    Object.assign(document.createElement("p"), {
      className: "part-question",
      textContent: t("part.verify.title"),
    }),
  );
  // One answer per line, full width: an armed button's longer text must not move it out
  // from under the finger that confirms.
  const row = document.createElement("div");
  row.className = "part-answers stack";
  const send = async (answer: Contribution["answer"]) => {
    for (const b of row.querySelectorAll("button")) b.disabled = true;
    const body: Contribution = {
      kind: "verify",
      camera: cam.id,
      build_id: ctx.buildId,
      day: today(),
      on_site: await onSite(cam.lngLat, ctx.onSite),
      answer,
    };
    const uuid = await ctx.queue.add(body);
    ctx.onDone(!navigator.onLine, { uuid, body });
  };
  const button = (key: string, cls = "part-btn") => {
    const b = document.createElement("button");
    b.className = cls;
    b.textContent = t(key);
    row.append(b);
    return b;
  };
  if (box.closest("[data-gone]")) {
    button("sheet.punk.verify_gone.confirm").addEventListener(
      "click",
      () => void send("not_found"),
    );
    button("sheet.punk.verify_gone.present").addEventListener("click", () => void send("present"));
    button("part.cancel", "part-btn quiet").addEventListener("click", onCancel);
    box.append(row, onSiteHelp(ctx.onSite));
    return;
  }
  button("part.verify.present").addEventListener("click", () => void send("present"));
  const gone = button("part.verify.not_found");
  let armed = 0;
  gone.addEventListener("click", () => {
    if (armed) {
      clearTimeout(armed);
      void send("not_found");
      return;
    }
    gone.textContent = t("part.verify.not_found_confirm");
    gone.classList.add("armed");
    armed = window.setTimeout(() => {
      armed = 0;
      gone.textContent = t("part.verify.not_found");
      gone.classList.remove("armed");
    }, ARMED_MS);
  });
  button("part.verify.unsure").addEventListener("click", () => void send("unsure"));
  button("part.cancel", "part-btn quiet").addEventListener("click", onCancel);
  box.append(row, onSiteHelp(ctx.onSite));
}
