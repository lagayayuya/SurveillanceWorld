// No zoom of the page (the author's requests of 2026-10-11, point 7, and 2026-10-23, « Zoom
// bloqué »: on a phone the page ended up zoomed, its buttons off the screen, with no way
// back). iOS ignores `user-scalable=no`; every element of the page says `touch-action: pan-x
// pan-y` instead (theme/punk/base.css: scrolling and taps only, no pinch nor double-tap
// zoom), and here WebKit's own gesture events (GestureEvent, « a proprietary interface
// specific to WebKit », MDN) are cancelled wherever they start but on the map, whose
// MapLibre canvas keeps its own zoom. Safari's text size (« aA ») is a setting of the page,
// not a gesture: untouched (no `maximum-scale`, no `-webkit-text-size-adjust`).
//
// The page zoomed all the same (an iPhone zooms the page on a field under 16 px and leaves
// it zoomed, WKWebViewIOS.mm _zoomToFocusRect; a browser may force the zoom for its
// reader): `data-page-zoomed` on the root while `visualViewport.scale` is over 1, and
// nothing is cancelled meanwhile, so that the browser's gestures come back (base.css) and
// two fingers or a double tap can zoom it back out. Nothing can set the scale from a page
// (VisualViewport has no setter), so the way out is left to the visitor.

/** A scale above this is a zoomed page (a pinch out ends a hair above 1). */
const ZOOMED = 1.01;

/** Whether the page is zoomed (pinched or zoomed on a field), as far as the browser says. */
export function pageZoomed(): boolean {
  return (window.visualViewport?.scale ?? 1) > ZOOMED;
}

/** Whether a gesture starting on `target` must not zoom the page: anywhere but the map,
 * while the page is not zoomed. */
export function blocksZoom(target: EventTarget | null): boolean {
  return (
    !pageZoomed() &&
    target instanceof Element &&
    target.closest(".maplibregl-canvas-container") === null
  );
}

/** Cancel WebKit's gesture events (not passive: they must be cancelable) and mark the root
 * while the page is zoomed. */
export function installGestures(): void {
  const stop = (e: Event) => {
    if (blocksZoom(e.target)) e.preventDefault();
  };
  for (const type of ["gesturestart", "gesturechange"])
    document.addEventListener(type, stop, { passive: false });
  const root = document.documentElement;
  const mark = () => {
    if (pageZoomed()) root.dataset.pageZoomed = "";
    else delete root.dataset.pageZoomed;
  };
  // A change of scale fires `resize` on the visual viewport (CSSOM View, « resize steps »).
  window.visualViewport?.addEventListener("resize", mark);
  mark();
}
