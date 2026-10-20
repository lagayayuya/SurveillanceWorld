// A camera's history on its sheet (lot U, 2026-10-18; owner's decision, applied by default):
// the contributions the review accepted, newest first, each with what it changed, the month
// (never the day: DECISIONS 2026-09-30 and 2026-10-13) and who — « par un contributeur »,
// or the pseudonym its author chose to show (« Afficher mon pseudonyme sur les caméras que
// j'ai relevées », off by default) — and, for one published on OpenStreetMap's live server,
// a link to that object's history there (GET /api/history, read at each opening: never
// cached, so that a pseudonym shown or hidden is so at once). Both interfaces, two lines an
// entry at most, even 320 px wide (lot U2: 17a's rows, their tag « contribution · 10/26 »
// and dotted leader, made one line too full and « PAR / CARA » wrapped): the change and the
// month in words (« Position corrigée · octobre 2026 »), then, smaller, « par cara » or
// « par un contributeur » on one line, a long pseudonym cut short with « … » on the screen
// (theme/punk/sheet.css, style.css), whole for a screen reader (the text is all there).
// Asked when the sheet is drawn, never awaited by it: the section comes in at the end of
// the sheet's body once the answer is in, under everything one can tap, so that nothing
// moves under a finger; nothing at all when the list is empty or the API unreachable (the
// sheet's dates already say when OSM last checked the camera). The words: historytext.ts.
import { type HistoryEntry, lineText, osmLinks, parseHistory, whoText } from "./historytext";
import { formatMonth, t } from "./i18n";
import { ui } from "./theme";

/** GET /api/history: the entries, or null when they cannot be read. */
export async function readHistory(id: string): Promise<HistoryEntry[] | null> {
  try {
    const r = await fetch(`/api/history?camera=${encodeURIComponent(id)}`);
    if (!r.ok) return null;
    return parseHistory(await r.json());
  } catch {
    return null; // offline, no API (a static build), not JSON
  }
}

function el(tag: string, cls = "", text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** An external link as the sheets write them: « ↗ », and « (nouvelle fenêtre) » said. */
function outLink(href: string, cls: string): HTMLElement {
  const a = el("a", cls, t("history.osm"));
  a.setAttribute("href", href);
  a.setAttribute("target", "_blank");
  a.setAttribute("rel", "noopener");
  const arrow = el("span", "", " ↗");
  arrow.setAttribute("aria-hidden", "true");
  a.append(arrow, el("span", "sheet-sr", ` ${t("sheet.punk.new_window")}`));
  return a;
}

/** The section, in the interface's words; null when there is nothing to say. */
function section(entries: HistoryEntry[]): HTMLElement | null {
  if (!entries.length) return null;
  const box = el("section", "sheet-history");
  box.setAttribute("aria-labelledby", "sheet-history-title");
  const h3 = el("h3", "", t("history.title"));
  h3.id = "sheet-history-title";
  box.append(h3);
  const list = el("ul", "history-list");
  for (const e of entries) {
    const li = el("li", "history-entry");
    li.append(
      el("span", "history-what", lineText(e, t, formatMonth)),
      el("span", "history-who", whoText(e.by, t)),
    );
    list.append(li);
  }
  box.append(list);
  const links = osmLinks(entries);
  if (ui() === "punk") {
    for (const href of links) box.append(outLink(href, "sheet-link history-osm"));
  } else if (links.length) {
    const p = el("p", "links");
    for (const href of links) p.append(outLink(href, "history-osm"));
    box.append(p);
  }
  return box;
}

/** Where a camera's sheet puts its history: an empty element at once, filled once the API
 * has answered (the sheet drawn again keeps it: main.ts gives the same one while the same
 * camera is shown). `data-history` says when it is settled: `shown` or `none`. */
export function historySlot(id: string): HTMLElement {
  const slot = el("div", "sheet-history-slot");
  slot.dataset.camera = id;
  void readHistory(id)
    .then((entries) => (entries ? section(entries) : null))
    .then(
      (box) => {
        if (box) slot.replaceChildren(box);
        slot.dataset.history = box ? "shown" : "none";
      },
      () => {
        slot.dataset.history = "none";
      },
    );
  return slot;
}
