// A view's own address, replaced as its state changes (a list's filters): the frame is told, so
// that it does not draw the view again from that address (modale.ts `shown`). A module of its
// own, without the frame's side effects: a view imports it, and the tests render the views
// without a document.
let suivi: (() => void) | null = null;

/** The frame's hook (modale.ts): called after each replacement. */
export function suivreAdresse(f: () => void): void {
  suivi = f;
}

/** Replaces the address (no new step in the history) and tells the frame. */
export function remplacerAdresse(href: string): void {
  history.replaceState(history.state, "", href);
  suivi?.();
}
