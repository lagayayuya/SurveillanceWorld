// The device position while "Me localiser" is on: the tracker (tracker.ts: a fast first
// position, then the high-accuracy watch), on the browser's geolocation. The last fix is
// kept in memory only, never stored nor sent. Stopped while the page is hidden, resumed when
// it shows again if it was on. "On site" (participate/onsite.ts) reads the last fix; the
// help line of the contribution screens starts it (always on a tap: never asked by itself).
import { debugEvent } from "./debug";
import { Tracker } from "./tracker";

export type { Fix } from "./tracker";

export const tracker = new Tracker({
  geolocation: "geolocation" in navigator ? navigator.geolocation : null,
  now: () => performance.now(),
  epoch: () => Date.now(),
  log: debugEvent,
  started: () => void logPermission("start"),
  later: (fn, ms) => window.setTimeout(fn, ms),
  cancel: (id) => window.clearTimeout(id),
  onVisibility: (fn) =>
    document.addEventListener("visibilitychange", () => fn(document.visibilityState === "hidden")),
});

/** The geolocation permission as the browser reports it, for the ?debug=1 log only: Safari
 * on iOS was suspected of answering "prompt" after a successful "Me localiser". */
export async function logPermission(why: string): Promise<void> {
  try {
    const perm = await navigator.permissions?.query({ name: "geolocation" });
    debugEvent(`permission (${why}): ${perm?.state ?? "n/a"}`);
  } catch {
    debugEvent(`permission (${why}): query failed`);
  }
}
