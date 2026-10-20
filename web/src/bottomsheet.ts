// Camera sheet on a phone: a panel at the bottom of the screen with three positions
// (peek: its top only, half, full), dragged by its top, or stepped by tapping the handle.
// Its height changes (not a translation, which would slide it over the attribution). The
// height it covers is published as --sheet-covered for the floating buttons. While a field
// of the sheet is focused on a phone (keyboard.ts), the sheet is as high as the visible part
// allows, whatever its position, standing on the keyboard when one covers the page; the
// field let go, it stays so until the keyboard has gone.
// On a wide screen it is a side panel and none of this applies.
import { focusedField, keyboardCover } from "./keyboard";
import { isLandscapePhone, isPhone, visibleHeight } from "./layout";

export type SheetState = "peek" | "half" | "full";
const ORDER: SheetState[] = ["peek", "half", "full"];
const FLICK = 0.4; // px/ms: a faster release goes on to the next position that way
const DRAG_MIN = 6; // px: less is a tap

export class BottomSheet {
  /** null when closed. */
  state: SheetState | null = null;
  private shown = 0; // current height, px
  private dragged = false;
  private standing = false; // on a keyboard at the last placing

  constructor(
    private root: HTMLElement,
    private onSettle: (state: SheetState) => void,
  ) {
    this.bindDrag();
    // Safari's toolbars change the visible height: re-place the sheet (visualViewport).
    const replace = () => {
      if (this.state) this.place(this.state);
    };
    window.addEventListener("resize", replace);
    window.visualViewport?.addEventListener("resize", replace);
    window.addEventListener("lacarte:keyboard", replace);
  }

  /** A field of the sheet focused on a phone: someone types in it. */
  private get typing(): boolean {
    const field = focusedField();
    return isPhone() && field !== null && this.root.contains(field);
  }

  /** On the keyboard: someone types in the sheet, or did, and the keyboard has not gone yet
   * (a tap outside lets the field go before the keyboard leaves: dropped then, the sheet
   * sank behind it and came back up; the author's point 3 of 2026-10-15). */
  private get raised(): boolean {
    // Not once another panel's field has the focus (the keyboard is then that panel's).
    return this.typing || (this.standing && focusedField() === null && keyboardCover() > 0);
  }

  /** The keyboard's height under the sheet while it is raised: it stands on it. */
  private get lift(): number {
    return this.raised ? keyboardCover() : 0;
  }

  /** Gap between the sheet and the bottom of the screen (the attribution). */
  private get gap(): number {
    return Number.parseFloat(getComputedStyle(this.root).bottom) || 0;
  }

  /** Tallest position: the visible height minus the estimate bar and the gap; at most
   * 60 % of it on a phone held in landscape. */
  private get max(): number {
    const vh = visibleHeight();
    const top =
      this.root.parentElement?.querySelector("#estimate")?.getBoundingClientRect().bottom ?? 56;
    // Over a keyboard: from the visible part's bottom up to its top (or the bar).
    const shown = this.lift ? (window.visualViewport?.offsetTop ?? 0) : 0;
    const room = vh + shown - this.gap - Math.max(top, shown) - 8;
    return isLandscapePhone() ? Math.min(room, Math.round(vh * 0.6)) : room;
  }

  private get top(): HTMLElement | null {
    return this.root.querySelector(".sheet-top");
  }

  /** Height left visible by each position (while typing in it, and on its keyboard until it
   * has gone, the tallest). */
  visible(state: SheetState): number {
    if (this.raised) return this.max;
    const peek = this.top?.offsetHeight ?? 120;
    if (state === "peek") return Math.min(peek, this.max);
    if (state === "half") return Math.min(Math.round(visibleHeight() * 0.5), this.max);
    return this.max;
  }

  /** Height the sheet covers at the bottom of the map, gap included (0 when closed or on
   * a wide screen). */
  get covered(): number {
    return this.state && isPhone() ? this.shown + this.gap : 0;
  }

  private setHeight(px: number): void {
    this.shown = px;
    this.root.style.height = `${px}px`;
    document.body.style.setProperty("--sheet-covered", `${this.covered}px`);
  }

  open(state: SheetState = "half"): void {
    this.root.hidden = false;
    this.place(state);
  }

  close(): void {
    this.root.hidden = true;
    this.root.style.marginBottom = "";
    this.standing = false;
    this.state = null;
    delete this.root.dataset.state;
    document.body.style.removeProperty("--sheet-covered");
    delete document.body.dataset.sheet;
  }

  place(state: SheetState): void {
    this.state = state;
    this.root.dataset.state = state;
    document.body.dataset.sheet = state;
    if (!isPhone()) {
      // A phone turned wide while standing on a keyboard (punk): no lift on a side panel.
      if (this.standing) {
        this.standing = false;
        this.root.style.marginBottom = "";
      }
      this.root.style.height = "";
      this.fitBody(this.root.offsetHeight);
      this.onSettle(state);
      return;
    }
    const lift = this.lift;
    // Punk only: the classique is frozen (it keeps dropping the lift with the focus).
    this.standing = lift > 0 && document.documentElement.dataset.ui === "punk";
    this.root.style.marginBottom = lift ? `${lift}px` : "";
    this.setHeight(this.visible(state));
    this.fitBody(this.shown);
    this.onSettle(state);
  }

  /** Handle tapped: peek -> half -> full -> peek (unless it was the end of a drag). */
  step(): void {
    if (this.dragged) {
      this.dragged = false;
      return;
    }
    const i = ORDER.indexOf(this.state ?? "peek");
    this.place(ORDER[(i + 1) % ORDER.length]);
  }

  /** Only the visible part of the body scrolls. */
  private fitBody(shown: number): void {
    const body = this.root.querySelector<HTMLElement>(".sheet-body");
    if (body) body.style.maxHeight = `${Math.max(0, shown - (this.top?.offsetHeight ?? 0))}px`;
  }

  private bindDrag(): void {
    let start: { y: number; t: number; from: number; id: number } | null = null;
    this.root.addEventListener("pointerdown", (e) => {
      const target = e.target as HTMLElement;
      if (!isPhone() || !target.closest(".sheet-top") || target.closest(".close, a")) return;
      start = { y: e.clientY, t: e.timeStamp, from: this.shown, id: e.pointerId };
      this.dragged = false;
    });
    this.root.addEventListener("pointermove", (e) => {
      if (!start || e.pointerId !== start.id) return;
      const dy = e.clientY - start.y;
      if (!this.dragged && Math.abs(dy) < DRAG_MIN) return;
      if (!this.dragged) {
        this.dragged = true;
        this.root.classList.add("dragging");
        // Keep the drag when the finger leaves the sheet; a pointer already gone throws.
        try {
          this.root.setPointerCapture(e.pointerId);
        } catch {}
      }
      this.setHeight(Math.max(this.visible("peek"), Math.min(this.max, start.from - dy)));
      this.fitBody(this.shown);
    });
    const end = (e: PointerEvent) => {
      if (!start || e.pointerId !== start.id) return;
      const speed = (e.clientY - start.y) / Math.max(1, e.timeStamp - start.t);
      start = null;
      this.root.classList.remove("dragging");
      if (!this.dragged) return;
      const shown = this.shown;
      const byHeight = [...ORDER].sort((a, b) => this.visible(a) - this.visible(b));
      let target = byHeight.reduce((a, s) =>
        Math.abs(this.visible(s) - shown) < Math.abs(this.visible(a) - shown) ? s : a,
      );
      if (speed < -FLICK) target = byHeight.find((s) => this.visible(s) > shown) ?? "full";
      if (speed > FLICK)
        target = [...byHeight].reverse().find((s) => this.visible(s) < shown) ?? "peek";
      this.place(target);
      // A click follows the pointerup on the handle; step() swallows it once.
      setTimeout(() => {
        this.dragged = false;
      }, 0);
    };
    this.root.addEventListener("pointerup", end);
    this.root.addEventListener("pointercancel", end);
  }
}
