// "On site": computed on the phone, never sent as a position. From the last position
// "Me localiser" tracks (position.ts), when it is recent and precise enough
// (rules/participation.yaml on_site); otherwise unknown. The contribution flow never asks
// for the position: the help line below offers "Me localiser", on a tap.
// The position is read, compared, and dropped here; only true / false / null leaves.
import { debugEvent } from "../debug";
import { t } from "../i18n";
import { tracker } from "../position";
import { metresBetween } from "../tracker";

// Re-exported for its callers (participate/move.ts): it lives with the tracker.
export { metresBetween } from "../tracker";

/** meta.json participation (tiles.participation_rules); a build made before this phase has
 * no age nor accuracy limit: then "on site" stays unknown. */
export type OnSiteRules = {
  on_site_m: number;
  on_site_max_age_s?: number;
  on_site_max_accuracy_m?: number;
};

/** Why a position can say "on site" or not (null: it can). */
function unusable(r: OnSiteRules): string | null {
  const fix = tracker.fix;
  if (!tracker.on) return "Me localiser off";
  if (!fix) return "no fix yet";
  if (r.on_site_max_age_s === undefined || r.on_site_max_accuracy_m === undefined)
    return "no limits in meta";
  const age = tracker.age() ?? Infinity;
  if (age > r.on_site_max_age_s) return `fix ${Math.round(age)} s old`;
  if (fix.accuracy > r.on_site_max_accuracy_m) return `±${Math.round(fix.accuracy)} m`;
  return null;
}

/** true / false within `on_site_m` of the camera, null when unknown (no recent and precise
 * position). Async for its callers' sake: it reads memory only. */
export async function onSite(camera: [number, number], r: OnSiteRules): Promise<boolean | null> {
  const why = unusable(r);
  const fix = tracker.fix;
  if (why || !fix) {
    debugEvent(`on_site: unknown (${why})`);
    return null;
  }
  const m = metresBetween(camera, fix.lngLat);
  const on = m <= r.on_site_m;
  debugEvent(`on_site: ${on} (${Math.round(m)} m, ±${Math.round(fix.accuracy)} m)`);
  return on;
}

/** The line under a contribution screen while "on site" cannot be said: why, and the
 * "Me localiser" button (a tap starts the position; never by itself). Hides itself once a
 * recent and precise position comes, and stops listening once out of the page. */
export function onSiteHelp(r: OnSiteRules): HTMLElement {
  const line = document.createElement("p");
  line.className = "part-onsite-help";
  const text = document.createElement("span");
  const button = document.createElement("button");
  button.className = "part-btn quiet part-onsite-locate";
  button.textContent = t("part.onsite.help.button");
  button.addEventListener("click", () => {
    tracker.start();
    render();
  });
  line.append(text, button);
  const render = () => {
    const why = unusable(r);
    line.hidden = why === null;
    // Started but not precise or recent enough yet: say so, no button.
    text.textContent = t(tracker.on ? "part.onsite.help.waiting" : "part.onsite.help");
    button.hidden = tracker.on;
  };
  const undo = tracker.listen(() => {
    if (!line.isConnected && line.dataset.placed) undo();
    else render();
  });
  // Placed in the page by the caller: from then on, leaving it ends the listening.
  queueMicrotask(() => {
    line.dataset.placed = "1";
  });
  // A position grows old without any event: look again every few seconds while shown.
  const timer = window.setInterval(() => {
    if (!line.isConnected && line.dataset.placed) {
      clearInterval(timer);
      undo();
    } else render();
  }, 5000);
  render();
  return line;
}
