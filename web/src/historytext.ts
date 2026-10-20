// A camera's history in words (lot U; history.ts draws it): what the API's answer may hold,
// and how each entry is said. No import: every string comes translated (the caller passes
// `t`), so that tests/history.test.ts checks them in node.

export type HistoryEntry = {
  /** added, seen, gone, moved, shape, direction, height, tilt, operator. */
  what: string;
  /** "2026-09". */
  month: string;
  on_site: boolean;
  /** The pseudonym its author chose to show; null: « par un contributeur ». */
  by: string | null;
  /** The OSM node's history (live server only), when it was published there. */
  osm: string | null;
};

export type Fmt = (key: string, params?: Record<string, string | number>) => string;

/** What changed, in the order the API's CASE says it (pipeline/lacarte/api/app.py
 * HISTORY_WHAT). */
export const WHATS = [
  "added",
  "seen",
  "gone",
  "moved",
  "shape",
  "direction",
  "height",
  "tilt",
  "operator",
] as const;
/** OpenStreetMap's live server: the only one a history links to (a test server's object is
 * no camera's history). */
export const OSM_LIVE = "https://www.openstreetmap.org/";

/** The entries of GET /api/history's answer the page can say, or null when it is no
 * answer: an unknown change, a month that is no month or a day, a link to another server
 * are left out. */
export function parseHistory(data: unknown): HistoryEntry[] | null {
  const list = (data as { history?: unknown } | null)?.history;
  if (!Array.isArray(list)) return null;
  const out: HistoryEntry[] = [];
  for (const x of list as Record<string, unknown>[]) {
    if (!x || !(WHATS as readonly unknown[]).includes(x.what)) continue;
    if (typeof x.month !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(x.month)) continue;
    out.push({
      what: x.what as string,
      month: x.month,
      on_site: x.on_site === true,
      by: typeof x.by === "string" && x.by ? x.by : null,
      osm: typeof x.osm === "string" && x.osm.startsWith(OSM_LIVE) ? x.osm : null,
    });
  }
  return out;
}

/** « Ajoutée », « Direction relevée »… */
export const whatText = (what: string, t: Fmt) => t(`history.what.${what}`);
/** « par un contributeur », « par ju_93 ». */
export const whoText = (by: string | null, t: Fmt) =>
  by ? t("history.by", { who: by }) : t("history.by_anyone");

/** An entry's first line, in both interfaces: « Position corrigée · octobre 2026 » (the month
 * in words: « 10/26 » read as a day; lot U2). Who comes on its own line (whoText); whether
 * it was on site is no longer said there (the API keeps `on_site`). */
export function lineText(e: HistoryEntry, t: Fmt, month: (m: string) => string): string {
  return t("history.line", { what: whatText(e.what, t), month: month(e.month) });
}

/** The links to OpenStreetMap's histories, one per object (a camera has one node). */
export const osmLinks = (entries: HistoryEntry[]) => [
  ...new Set(entries.map((e) => e.osm).filter((u): u is string => Boolean(u))),
];
