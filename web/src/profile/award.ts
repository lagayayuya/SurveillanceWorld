// The category of points a piece just sent earns, as the leaderboard counts it
// (pipeline/lacarte/api/leaderboard.py awards(), rules/leaderboard.yaml), told on the phone
// so that 8a's tickets wear their colour and word from their first frame (participate/
// score.ts); the numbers stay the server's, and its answer has the last word. The server
// reads « a known value » in the OSM tags it copied at receipt; the phone has only the
// camera's tile (pipeline/lacarte/tiles.py), where an applied contribution may stand over
// them: a value with a contribution's month is read as not from OSM. Where both had one
// (OSM, then an answer over it), the server says « correction » and the phone « info »;
// the ticket then turns at its answer. web/bench/score-kit.mjs mirrors the same rule.
// Pure, for tests/categories.test.ts.
import type { Contribution } from "../participate/queue";
import type { Category } from "./categories";

/** A camera's detail tile properties (k, kc, d, dc, hc, t, o and their months km, dm…). */
export type TileProps = Record<string, unknown>;

const INFOS = ["shape", "direction", "height", "tilt", "operator"];
/** « Je ne sais pas », « Je ne vois pas »: no answer, nothing earned. */
const NO_ANSWER = ["unknown", "not_visible"];
/** An added camera's id (participate/queue.ts isAdded): it has no tags, every answer on it
 * is an info. */
const ADDED = /^c[0-9a-f]{12}$/;

/** Whether the camera had this info before the send (rules/leaderboard.yaml known): a value
 * that is no default (its certainty) and no contribution's (its month). */
export function known(kind: string, p: TileProps): boolean {
  const n = (k: string, none = 0) => Number(p[k] ?? none);
  switch (kind) {
    case "shape":
      return n("kc") > 0 && !p.km;
    case "direction":
      return n("d", -1) >= 0 && n("dc") > 0 && !p.dm;
    case "height":
      return n("hc") > 0 && !p.hm;
    case "tilt":
      return Boolean(p.t) && !p.tm;
    case "operator":
      return String(p.o ?? "unk") !== "unk" && !p.om;
    default:
      return false;
  }
}

/** What `body` earns once sent (null: nothing — « Je ne sais pas », a check from afar). */
export function awardOf(
  body: Pick<Contribution, "kind" | "answer" | "on_site" | "camera">,
  props: TileProps,
): Category | null {
  if (body.kind === "add") return "add";
  if (body.kind === "move") return "correction";
  if (body.kind === "verify")
    return body.on_site === true && (body.answer === "present" || body.answer === "not_found")
      ? "verification"
      : null;
  if (!INFOS.includes(body.kind) || NO_ANSWER.includes(body.answer ?? "")) return null;
  if (ADDED.test(body.camera ?? "")) return "info";
  return known(body.kind, props) ? "correction" : "info";
}
