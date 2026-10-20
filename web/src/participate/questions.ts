// Which "Compléter" questions a camera gets (rules/questions.yaml, through the build's
// meta): pure, so that web/tests can check it without a map.
import type { Shape } from "./shapes";

/** rules/questions.yaml, as the build's meta gives it to the phone. */
export type Questions = {
  /** Shape answer -> camera kind of the model. */
  shape_kinds: Record<Shape, string>;
  /** Kinds asked for a direction (the direction rule's kinds). */
  direction_kinds: string[];
  /** Operator classes (tile codes) "who films" may be asked for. */
  operator_codes: string[];
  /** Operator names (folded) that do not tell a business from a private individual. */
  category_unknown?: string[];
  min_target_m: number;
  /** The punk aim's minimum, in screen pixels; absent from a build made before it (the
   * editor then counts min_target_m). */
  min_target_px?: number;
  /** Phase D3: the height answers offered (class -> metres, in this order), the tilt
   * answers (classes: their degrees are never shown), the kinds asked a tilt. */
  height_m: Record<string, number>;
  tilt_classes: string[];
  /** The classique's kinds asked a tilt (a tube). */
  tilt_kinds: string[];
  /** The punk editor's (a tube and a small dome, questions@5); absent from an older build. */
  editor_tilt_kinds?: string[];
  /** The punk add and « Modifier »: the kinds offered no height (rules/questions.yaml
   * height.modify_excludes, the big ball); absent from a build made before it. */
  height_excluded_kinds?: string[];
};
/** What the questions read of a camera: kind and its certainty code, direction, operator
 * class code, the kind of private operator a validated answer gave (`ok`: h | b) and the
 * OSM operator name (meta.operators[op]); phase D3: the height's certainty code (0 = by
 * default) and the class of a known tilt (`t`, any source). */
export type Asked = {
  k: string;
  kc: number;
  d: number;
  o: string;
  ok?: string;
  opName?: string;
  hc?: number;
  t?: string;
};
/** "mount": the screen "Hauteur et inclinaison" (phase D3). */
export type Step = "shape" | "direction" | "mount" | "operator";

/** The parts of the "Hauteur et inclinaison" screen (phase D3). A height or a tilt alone
 * changes nothing computed (camerafield.mount needs both, and there is no default tilt), so
 * the screen comes only when its answer can change the field: for a kind of tilt_kinds the
 * classique asks (a tube: OSM's kind, or the shape just answered), the height
 * when it is by default, the tilt when none is known and a height is (known, or `height`
 * just chosen, not "Je ne sais pas"); for a camera of any kind whose known tilt waits for a
 * height, the height alone. */
export function mountParts(
  cam: Asked,
  q: Questions,
  kind: string,
  height: string | null = null,
): { height: boolean; tilt: boolean } {
  const tilts = q.tilt_kinds.includes(kind);
  const defaultHeight = (cam.hc ?? 0) === 0;
  const askHeight = defaultHeight && (tilts || Boolean(cam.t));
  const heightKnown = !defaultHeight || (height !== null && height !== "unknown");
  return { height: askHeight, tilt: tilts && !cam.t && heightKnown };
}

/** Whether the screen comes at all: a part is asked now, or the tilt once a height is. */
function asksMount(cam: Asked, q: Questions, kind: string): boolean {
  const parts = mountParts(cam, q, kind);
  return parts.height || parts.tilt;
}

/** Lower case, no accents, punctuation as single spaces (normalize.name_key). */
export function fold(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** "Who films" is asked for an unknown operator, and for a private one while nobody says
 * whether a business or a private individual installed it: no validated answer (`ok`)
 * and no OSM name that tells (a name says a business, "Particulier" a private
 * individual; the names listed in category_unknown say neither). Never for a public one. */
export function asksOperator(cam: Asked, q: Questions): boolean {
  if (!q.operator_codes.includes(cam.o) || cam.o === "pub") return false;
  if (cam.o === "unk") return true;
  if (cam.ok) return false;
  return !cam.opName || (q.category_unknown ?? []).includes(fold(cam.opName));
}

/** Which questions a camera gets, given the answer to the shape question (if any). */
export function questionsFor(
  cam: Asked,
  q: Questions,
  shape: Shape | "unknown" | null = null,
): Step[] {
  const steps: Step[] = [];
  if (cam.kc === 0) steps.push("shape");
  const kind = shape && shape !== "unknown" ? q.shape_kinds[shape] : cam.k;
  if (cam.d < 0 && q.direction_kinds.includes(kind)) steps.push("direction");
  if (asksMount(cam, q, kind)) steps.push("mount");
  if (asksOperator(cam, q)) steps.push("operator");
  return steps;
}

/** The camera sheet's facts (sheet.ts chips() keys) a « Compléter » journey can answer for
 * this camera, whatever the shape answered: the punk sheet draws the « ? » of its
 * « Supposé » box only on them and titles the box « Supposé · à compléter » only when one
 * of its rows is among them (chips.ts). The field of view, the night vision and the zoom
 * are never asked. */
export function answerableFacts(cam: Asked, q: Questions): string[] {
  const keys = new Set<string>();
  const shapes: (Shape | null)[] = [null];
  if (cam.kc === 0) shapes.push(...(Object.keys(q.shape_kinds) as Shape[]));
  for (const shape of shapes) {
    const kind = shape ? q.shape_kinds[shape] : cam.k;
    for (const step of questionsFor(cam, q, shape)) {
      if (step === "shape") keys.add("type");
      else if (step === "direction") keys.add("direction");
      else if (step === "operator") keys.add("status").add("operator");
      else {
        // The tilt comes once a height is known or answered (mountParts).
        const parts = mountParts(cam, q, kind, "known");
        if (parts.height) keys.add("height");
        if (parts.tilt) keys.add("tilt");
      }
    }
  }
  return [...keys];
}

/** The punk add and « Modifier » (DECISIONS 2026-10-08): the height for every final kind
 * but height_excluded_kinds (the big ball), the tilt under it for a kind of tilt_kinds (a
 * tube, a small dome since questions@5), its line absent otherwise. */
export function editorParts(q: Questions, kind: string): { height: boolean; tilt: boolean } {
  const height = !(q.height_excluded_kinds ?? []).includes(kind);
  return { height, tilt: height && (q.editor_tilt_kinds ?? q.tilt_kinds).includes(kind) };
}

/** The punk editor's lines whose value the camera only assumes and the editor can ask
 * (DECISIONS 2026-10-08, « The add / « Modifier » sheet… »): the shape while its type is by
 * default, the direction while it is not surveyed for a kind that has one, the height while
 * it is by default for every kind but the big ball (a dome's included), who films while
 * its class is unknown. « Modifier » unfolds these lines' choices from the start, and the
 * punk sheet shows its « ? » while one is left (editorAnswerable). */
export function editorAssumed(cam: Asked, q: Questions): Step[] {
  const steps: Step[] = [];
  if (cam.kc === 0) steps.push("shape");
  if (cam.d < 0 && q.direction_kinds.includes(cam.k)) steps.push("direction");
  if ((cam.hc ?? 0) === 0 && editorParts(q, cam.k).height) steps.push("mount");
  if (cam.o === "unk") steps.push("operator");
  return steps;
}

/** The punk camera sheet's facts (chips.ts rows) marked « ? »: editorAssumed's lines. */
export function editorAnswerable(cam: Asked, q: Questions): string[] {
  const keys: Record<Step, string[]> = {
    shape: ["type"],
    direction: ["direction"],
    mount: ["height"],
    operator: ["status", "operator"],
  };
  return editorAssumed(cam, q).flatMap((s) => keys[s]);
}

// --- who films in the punk editor (the author's point 6 of 2026-10-12) -------------------
// Every normalised name of rules/operators.yaml with its class (POST /api/operators without
// `class`, the contract of the lot of 2026-10-12), the ones around first, searched with
// fold; and a name not listed, proposed after « Public » or « Commerce ou entreprise »
// only, checked as the API checks it before it is queued: a refusal would drop the whole
// send (queue.ts).

/** A listed name and the class it sets (operators.yaml `private` is `business`). */
export type Listed = { name: string; class: "public" | "business" };
export type Operators = { near: Listed[]; all: Listed[] };

/** At most `max` names: with no query the ones around; else those whose folded form
 * contains the query's, the ones around first, then in the list's order. */
export function searchOperators(ops: Operators, query: string, max: number): Listed[] {
  const q = fold(query);
  const seen = new Set<string>();
  const out: Listed[] = [];
  for (const n of q ? [...ops.near, ...ops.all] : ops.near) {
    const key = fold(n.name);
    if (seen.has(key) || !key.includes(q)) continue;
    seen.add(key);
    out.push(n);
    if (out.length === max) break;
  }
  return out;
}

/** The listed name a text is, once folded (a proposal of it is that name). */
export const listedAs = (ops: Operators, text: string): Listed | undefined => {
  const key = fold(text);
  return [...ops.near, ...ops.all].find((n) => fold(n.name) === key);
};

/** The API's own form of a proposed name: NFC, trimmed, inner spaces collapsed. */
export const tidy = (text: string): string => text.normalize("NFC").trim().replace(/\s+/g, " ");

// The contract's bounds and characters (`operator_proposed`: 2 to 60 characters, a letter
// or a digit first, then letters, digits, space, ' ’ - . & ( ) , /).
const MIN = 2;
const MAX = 60;
const FIRST = /^[\p{L}\p{N}]/u;
const ALLOWED = /^[\p{L}\p{N} '’\-.&(),/]*$/u;

/** Why the API would refuse this proposed name (null: it passes). */
export function proposedProblem(text: string): "length" | "chars" | null {
  const name = tidy(text);
  const n = [...name].length;
  if (n < MIN || n > MAX) return "length";
  if (!FIRST.test(name) || !ALLOWED.test(name)) return "chars";
  return null;
}
