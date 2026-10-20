// No pinch-zoom on the interface (the author's request of 2026-10-11, point 7): on a phone a
// pinch on a panel (the filters machine, a sheet, the ticket, a button) zoomed the whole
// page, frame and all. iOS ignores `user-scalable=no`; the panels say `touch-action: pan-x
// pan-y` instead (theme/punk/base.css: scrolling and taps only, no pinch nor double-tap
// zoom; MDN, touch-action: `manipulation` is « an alias for pan-x pan-y pinch-zoom », so it
// would keep the pinch), and here WebKit's own gesture events (GestureEvent, « a proprietary
// interface specific to WebKit », MDN) are cancelled when they start on those elements only.
// The map keeps its own zoom: MapLibre's canvas is never one of them. Safari's text size
// (« aA ») is a setting of the page, not a gesture: untouched (no `maximum-scale`, no
// `-webkit-text-size-adjust`).

/** The interface over the map: panels, sheets, tickets, buttons and their containers. */
export const PANELS = [
  "#estimate",
  "#ticket",
  "#filters",
  "#fabs",
  "#sheet",
  "#camlist",
  "#filters-empty",
  "#queue-count",
  "#modify-panel",
  "#complete-panel",
  "#move-panel",
  "#mine",
  ".maplibregl-ctrl",
].join(", ");

/** Whether a gesture starting on `target` must not zoom the page. */
export function onPanel(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest(PANELS) !== null &&
    target.closest(".maplibregl-canvas-container") === null
  );
}

/** Cancel WebKit's gesture events on the panels (not passive: they must be cancelable). */
export function installGestures(): void {
  const stop = (e: Event) => {
    if (onPanel(e.target)) e.preventDefault();
  };
  for (const type of ["gesturestart", "gesturechange"])
    document.addEventListener(type, stop, { passive: false });
}
