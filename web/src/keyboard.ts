// A phone's keyboard over the panels (the author's request of 2026-10-11, point 4): on the
// iPhone the keyboard hid the sign-in form. The keyboard shrinks the visual viewport, not
// the layout one where the panels are fixed: what a panel holds at its bottom (the field,
// its form's key) went under it. Here, on each change of `visualViewport` (resize, scroll)
// and each focus: `data-keyboard="open"` on the root while a field is focused over a
// keyboard; the camera sheet follows (bottomsheet.ts: on a phone, while one of its fields is
// focused and, in punk, until the keyboard has gone, as high as the visible part allows,
// standing on the keyboard); the filters
// machine ends above it; and the focused field, with its form's submit button when both
// fit, is scrolled into the visible part of its panel (under a phone sheet's pinned head),
// again once the panel has its new height. The fields: the password form, the pseudonym's
// choice, the account screen's passwords and the publication's comment (#sheet), the
// filters' operator (#filters). A browser without `visualViewport` keeps its own behaviour.

import { isPhone } from "./layout";

/** What a keyboard comes up for: text, not a box to tick nor a key. */
const FIELD =
  'input:not([type="checkbox"], [type="radio"], [type="button"], [type="submit"], [type="reset"], [type="range"], [type="color"], [type="file"]), textarea, select, [contenteditable="true"]';

/** The focused field, if any. */
export function focusedField(): HTMLElement | null {
  const a = document.activeElement;
  return a instanceof HTMLElement && a.matches(FIELD) ? a : null;
}

/** The height of the layout viewport the keyboard (or anything below the visual
 * viewport) covers at its bottom, in CSS px; 0 without `visualViewport`. */
export function keyboardCover(): number {
  const vv = window.visualViewport;
  if (!vv) return 0;
  return Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
}

/** The visible band of the layout viewport: [top, bottom] in client coordinates. */
function visibleBand(): [number, number] {
  const vv = window.visualViewport;
  return vv ? [vv.offsetTop, vv.offsetTop + vv.height] : [0, window.innerHeight];
}

/** Longer than the sheet's change of height (theme/punk/tokens.css --dur-sheet, 0.22 s). */
const SETTLE_MS = 300;

/** The nearest ancestor of `el` that scrolls vertically. */
function scroller(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const y = getComputedStyle(p).overflowY;
    if ((y === "auto" || y === "scroll") && p.scrollHeight > p.clientHeight) return p;
  }
  return null;
}

/** The field's form's submit button (its key), if it has one. */
function submitOf(field: HTMLElement): HTMLElement | null {
  const form = field.closest("form");
  return form?.querySelector<HTMLElement>('button[type="submit"], input[type="submit"]') ?? null;
}

/** Scroll `field` (and its submit button, when both fit) into the part of its scroller the
 * visual viewport shows, under a phone sheet's pinned head. */
export function reveal(field: HTMLElement): void {
  const box = scroller(field);
  if (!box) return;
  const [vTop, vBottom] = visibleBand();
  const r = box.getBoundingClientRect();
  let top = Math.max(r.top, vTop);
  const bottom = Math.min(r.bottom, vBottom);
  // A phone sheet's head stays over its paper (theme/punk/sheet.css: pinned, absolute).
  const head = box.querySelector<HTMLElement>(".sheet-head");
  if (head && getComputedStyle(head).position === "absolute")
    top = Math.max(top, head.getBoundingClientRect().bottom);
  const margin = 8;
  const f = field.getBoundingClientRect();
  const key = submitOf(field)?.getBoundingClientRect();
  let from = f.top;
  let to = f.bottom;
  if (
    key &&
    Math.max(f.bottom, key.bottom) - Math.min(f.top, key.top) <= bottom - top - 2 * margin
  ) {
    from = Math.min(f.top, key.top);
    to = Math.max(f.bottom, key.bottom);
  }
  let delta = 0;
  if (to > bottom - margin) delta = to - (bottom - margin);
  if (from - delta < top + margin) delta = from - (top + margin);
  if (Math.abs(delta) >= 1) box.scrollTop += delta;
}

/** Listeners on `visualViewport` and the focus; one update a frame. */
export function installKeyboard(): void {
  const vv = window.visualViewport;
  if (!vv) return;
  const root = document.documentElement;
  let frame = 0;
  let was = false;
  let said = "";
  let settle = 0;
  const update = () => {
    frame = 0;
    const cover = keyboardCover();
    const field = focusedField();
    const up = field !== null && cover > 0;
    if (up) root.dataset.keyboard = "open";
    else delete root.dataset.keyboard;
    // The filters machine (a phone: fixed from its top to the map's foot) ends above it.
    const machine = document.getElementById("filters");
    if (machine) machine.style.marginBottom = up && machine.contains(field) ? `${cover}px` : "";
    // The bottom sheet follows (bottomsheet.ts listens to this event), when what it reads
    // changes: which field, and how much the keyboard covers.
    const now = `${field ? field.id || field.tagName : "-"}:${cover}`;
    if (now !== said) window.dispatchEvent(new Event("lacarte:keyboard"));
    said = now;
    // The keyboard gone, iOS may leave the page scrolled: the page itself never scrolls.
    if (was && !up && (window.scrollY || document.documentElement.scrollTop)) window.scrollTo(0, 0);
    was = up;
    // A phone's panels (a wide screen's browser scrolls its own field into view).
    if (field && (up || isPhone())) {
      reveal(field);
      // Once a panel has reached its new height (the sheet's transition, --dur-sheet),
      // again.
      clearTimeout(settle);
      settle = window.setTimeout(() => {
        const f = focusedField();
        if (f) reveal(f);
      }, SETTLE_MS);
    }
  };
  const soon = () => {
    if (!frame) frame = requestAnimationFrame(update);
  };
  vv.addEventListener("resize", soon);
  vv.addEventListener("scroll", soon);
  window.addEventListener("resize", soon);
  document.addEventListener("focusin", soon);
  document.addEventListener("focusout", soon);
  update();
}
