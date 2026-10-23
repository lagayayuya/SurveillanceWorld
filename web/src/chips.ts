// The punk camera sheet (redesign lot 3.2), ported from mockup 17a (a wide screen) and 4b
// (a phone's bottom sheet): the title in cut-out letters (its real text hidden for screen
// readers, the letters hidden from them), the operator, the dates by the month, the three
// distance tickets of the chosen estimate with the other one's under them, the facts as
// rows on the paper (no « Vérifié » stamp: DECISIONS 2026-10-08, « The punk sheet's « ~ »… ») — label, source tag, dotted leader, value — and
// the gridded « Supposé · à compléter » box, then « Compléter » / « Toujours là ? » and the
// links. The certainty in 17a's language (DECISIONS 2026-10-07, « The camera sheet's facts
// follow 17a… », and 2026-10-08, « The punk sheet's « ~ »… »): identified, the value alone;
// an estimated number (height, angle, zoom) « ~ » before it, an estimated category (type,
// status, direction, operator) its value alone, its source tag saying enough; default, the
// row in the box with its « ? »; the word is said (hidden text) and written in « Calcul ? »,
// never drawn by colour alone. Rows are not interactive: the help a tap gave is in
// « Calcul ? ». The states the current sheet has take a band, a stamp or a tape of the
// mockup. A chunk the punk interface alone downloads (sheet.ts).
// No import: every string comes translated (sheet.ts passes `t`) and every element that
// acts comes built (its handlers are the page's), so that the rows are checked in node
// (tests/chips.test.ts) and drawn alone in a page (bench/smoke-chips.mjs).

/** Where a value comes from: a validated contribution observed on site, a validated answer
 * (« Compléter ») or another validated contribution (a move, a sighting, an add, « gone »)
 * made from elsewhere, OpenStreetMap's tags, a generic assumption (certainty default), or
 * anything the review has not validated yet. */
export type Source = "site" | "answer" | "contrib" | "osm" | "assumed" | "pending";

export type Fmt = (key: string, params?: Record<string, string | number>) => string;

/** A fact (sheet.ts chips(), the current sheet's): `bare` is its value without the source
 * and the month its tag says; `month` ("2026-10") a validated contribution's. Certainty
 * codes as in the tiles: 2 identified, 1 estimated, 0 default; none for a name or a date. */
export type Fact = {
  key?: string;
  label: string;
  value: string;
  bare?: string;
  cert?: number;
  source?: Source;
  month?: string;
  warn?: boolean;
};

/** The source given (contributions, set by sheet.ts), else the certainty's: a default
 * value is an assumption, any other comes from OSM's tags. */
export const sourceOf = (f: { cert?: number; source?: Source }): Source | undefined =>
  f.source ?? (f.cert === undefined ? undefined : f.cert > 0 ? "osm" : "assumed");

/** "2026-10" -> "10/26", 17a's « sur place · 03/26 » (the month, never the day). */
export const shortMonth = (m: string) => `${m.slice(5, 7)}/${m.slice(2, 4)}`;

function el(tag: string, cls = "", text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
/** Said, not seen (the certainty's word, « source : »). */
const said = (text: string) => el("span", "sheet-sr", text);
/** Seen, not said (« ~ », « ? », a month the hidden text says in words, an arrow). */
const drawn = (text: string, cls = "") => {
  const e = el("span", cls, text);
  e.setAttribute("aria-hidden", "true");
  return e;
};

/** The rows whose value is a number: an estimated one takes « ~ » (17a's « ~3 M »); a
 * category never does (DECISIONS 2026-10-08, « The punk sheet's « ~ »… »). */
export const NUMERIC = new Set(["height", "fov", "zoom"]);

/** Where a row goes, its tag and its words: the box holds the default values, whose tag
 * « supposé » the box's title says (a contribution's tag stays). */
export function factText(f: Fact, t: Fmt) {
  const source = sourceOf(f);
  const box = f.cert === 0;
  const tag = source && !(box && source === "assumed") ? t(`chip.source.${source}`) : "";
  return {
    source,
    box,
    tag,
    value: f.bare ?? f.value,
    approx: f.cert === 1 && NUMERIC.has(f.key ?? ""),
    certainty: f.cert === undefined ? "" : t(`cert.${f.cert}`),
  };
}

/** One row: the label and its source tag (dt), the dotted leader (CSS, between them), the
 * value in capitals (dd): « ~ » before an estimated number, « ? » after a default one that
 * « Compléter » can answer (`ask`: 17a's « à compléter »), the certainty's word hidden after
 * it. A `div` groups them in the `dl`, as 17a does. */
export function factRow(f: Fact, t: Fmt, month: (m: string) => string, ask = false): HTMLElement {
  const { source, box, tag, value, approx, certainty } = factText(f, t);
  const row = el("div", box ? "fact assumed" : "fact");
  const dt = el("dt", "", f.label);
  if (tag) {
    const span = el("span", `chip-tag ${source}`);
    span.append(said(t("chip.punk.source")), tag);
    if (f.month) span.append(drawn(` · ${shortMonth(f.month)}`), said(`, ${month(f.month)}`));
    dt.append(span);
  }
  const dd = el("dd");
  if (approx) dd.append(drawn("~", "approx"));
  dd.append(value);
  if (box && ask) dd.append(drawn("?", "q"));
  if (certainty) dd.append(said(`, ${certainty}`));
  row.append(dt, dd);
  return row;
}

// The cut-out letters (17a, 4b): five styles in turn, each letter tilted and lifted as 17a's
// « Dôme public » and 24a's « La Courneuve » are.
const TILT = [-4, 3, -2, 5, 2, -5, 4, -1, 3, -4, 4, -3];
const LIFT = [0, 3, -2, 1, 2, 0, -1, 3, -2, 0, 2, 1];

/** The title: its real text for screen readers, its letters for the eyes. */
export function cutout(real: string, shown: string): HTMLElement {
  const h2 = el("h2", "headline");
  const letters = drawn("", "cutout");
  let i = 0;
  const words = shown.toLocaleUpperCase("fr").split(/\s+/).filter(Boolean);
  // A word longer than 17a's « PUBLIC » takes smaller letters on a phone (sheet.css).
  if (words.some((x) => x.length > 6)) letters.classList.add("long");
  for (const word of words) {
    const w = el("span", "cut-word");
    for (const ch of word) {
      const c = el("span", `cut c${i % 5}`, ch);
      c.style.transform = `rotate(${TILT[i % TILT.length]}deg) translateY(${LIFT[i % LIFT.length]}px)`;
      w.append(c);
      i++;
    }
    letters.append(w);
  }
  h2.append(said(real), letters);
  return h2;
}

/** The smallest the letters of a title shrink to; under it, its widest word wraps inside
 * (theme/punk/sheet.css, .cut-word). */
const MIN_FIT = 0.5;

/** A title's cut-out letters held on its line (DECISIONS 2026-10-09, « Punk sheets on a
 * phone… »: a long title wraps on two lines or shrinks, never under ↑ and ×): its words
 * wrap between them, and when the widest is longer than the line every letter shrinks (CSS
 * zoom) until it holds. Fitted again whenever the title's width changes (the sheet shown,
 * turned) and once the fonts are in, a frame later: a size changed inside the observer's
 * callback would loop. */
export function fitTitle(title: HTMLElement | null): void {
  const letters = title?.querySelector<HTMLElement>(".cutout");
  if (!title || !letters) return;
  const fit = () => {
    if (!letters.isConnected) return;
    letters.style.zoom = "";
    // Each word on one line while it is measured.
    letters.classList.add("fitting");
    // The line as laid out: the sheet's paper is drawn slightly turned on a wide screen, and
    // a bounding box would count its slant as room (a word then a pixel too long, broken).
    const line = Number.parseFloat(getComputedStyle(title).width) || 0;
    const words = [...letters.querySelectorAll<HTMLElement>(".cut-word")];
    const widest = () => Math.max(0, ...words.map((w) => w.getBoundingClientRect().width));
    const wide = widest();
    if (line && wide > line) {
      const base = Number.parseFloat(getComputedStyle(letters).zoom) || 1;
      let zoom = Math.max(MIN_FIT, Math.floor((base * line * 100) / wide) / 100);
      letters.style.zoom = String(zoom);
      // A zoom does not shrink everything in proportion (a border stays a pixel): measured
      // again, a step smaller while the word is still longer than its line.
      while (zoom > MIN_FIT && widest() > line) {
        zoom = Math.max(MIN_FIT, Math.round(zoom * 100 - 1) / 100);
        letters.style.zoom = String(zoom);
      }
    }
    letters.classList.remove("fitting");
  };
  fit();
  if (typeof ResizeObserver === "undefined") return;
  let width = -1;
  const watch = new ResizeObserver(([entry]) => {
    if (!title.isConnected) {
      watch.disconnect();
      return;
    }
    if (entry.contentRect.width === width) return;
    width = entry.contentRect.width;
    requestAnimationFrame(fit);
  });
  watch.observe(title);
  void document.fonts?.ready.then(() => requestAnimationFrame(fit));
}

/** A phone's half-open or full sheet scrolls under its head, which alone stays (DECISIONS
 * 2026-10-09, « Punk sheets on a phone… »; theme/punk/sheet.css pins it out of the
 * scrolling flow): the top keeps the head's room (an empty block as high as the head,
 * measured again whenever it changes: the sheet shown, a title fitted), so that a phone's
 * peek (bottomsheet.ts, the top's height) is what it was; and the paper is back at its start
 * whenever the sheet goes down to its lowest position, which shows its top. Once the paper
 * scrolls, the pinned head folds to one line (`.compact`: its title in plain letters, cut
 * short with « … »; sheet.css), so that what scrolls goes under a bar, never under a title
 * of three lines (lot U2); its room keeps the whole head's height meanwhile, or the paper
 * would jump. */
export function pinHead(frame: HTMLElement, paper: HTMLElement): void {
  const head = paper.querySelector<HTMLElement>(".sheet-head");
  if (!head) return;
  // The head's room in the top, as high as the head (shown on a phone only: sheet.css).
  const room = el("div", "sheet-head-room");
  room.setAttribute("aria-hidden", "true");
  head.after(room);
  const fold = () => head.classList.toggle("compact", paper.scrollTop > 0);
  paper.addEventListener("scroll", fold, { passive: true });
  const measure = () => {
    if (!head.offsetHeight || head.classList.contains("compact")) return;
    room.style.height = `${head.offsetHeight}px`;
    // A focus moving back up the scrolled paper stops below the pinned head (WCAG 2.4.11).
    paper.style.scrollPaddingTop = room.style.height;
  };
  measure();
  if (typeof ResizeObserver !== "undefined") {
    const sized = new ResizeObserver(() => {
      if (paper.isConnected) measure();
      else sized.disconnect();
    });
    sized.observe(head);
  }
  if (typeof MutationObserver !== "undefined") {
    const placed = new MutationObserver(() => {
      if (!paper.isConnected) placed.disconnect();
      else if (frame.dataset.state === "peek") {
        paper.scrollTop = 0;
        fold();
      }
    });
    placed.observe(frame, { attributes: true, attributeFilter: ["data-state"] });
  }
}

/** An external link as 17a writes them: « ↗ », and « (nouvelle fenêtre) » said. */
function outLink(href: string, text: string, t: Fmt, cls = ""): HTMLElement {
  const a = el("a", cls, text);
  a.setAttribute("href", href);
  a.setAttribute("target", "_blank");
  a.setAttribute("rel", "noopener");
  // A no-break space: a flex item's leading space would collapse (17a: « OpenStreetMap ↗ »).
  a.append(drawn("\u00a0↗"), said(` ${t("sheet.punk.new_window")}`));
  return a;
}

/** A band of 17a (its yellow label): a state the mockup does not draw, said on the paper. */
function band(text: string, cls = ""): HTMLElement {
  const p = el("p", `sheet-band${cls ? ` ${cls}` : ""}`);
  p.append(el("span", "band", text));
  return p;
}

/** A stamp (17a's « Toujours là », for « Disparue »): its word, then a line in small type. */
function stamp(cls: string, word: string, sub: string): HTMLElement {
  const p = el("p", `sheet-stamp ${cls}`, word);
  if (sub) p.append(el("span", "stamp-sub", sub));
  return p;
}

const known = (m: number | undefined): m is number => m !== undefined && Number.isFinite(m);
const ON_TILT = [-3, 2, -2];
const OFF_TILT = [1, -1.5, 2];

export type PunkSheetInput = {
  p: Record<string, string | number | undefined>;
  t: Fmt;
  /** "2026-10" -> "octobre 2026". */
  month: (m: string) => string;
  /** The current sheet's line (« Dôme · public »): the title's real text. */
  title: string;
  operatorName?: string;
  facts: Fact[];
  /** The current sheet's headline: the tickets' name, or the gone / no-field band's. */
  sentence: string;
  gone: boolean;
  noField: boolean;
  mounted: boolean;
  noDirection: boolean;
  /** The facts (keys) « Compléter » can answer, when it is offered (questions.ts). */
  answerable: string[];
  reach: number[][];
  shown: number[];
  est: number;
  estimates: string[];
  /** The level the map shows of this camera (1 detect, 2 recognise, 3 identify), and what
   * a choice among the tickets calls (DECISIONS 2026-10-08, « Punk focus… »). */
  level?: number;
  onLevel?: (lv: 1 | 2 | 3) => void;
  observed: (what: string) => boolean;
  /** A validated sighting at least as recent as OSM's check date; one only by its add. */
  seen: boolean;
  seenByAdd: boolean;
  osm?: { edit: string; page: string };
  /** Signed out (lot « comptes »): « Corriger sur OpenStreetMap » among the links. */
  visitor?: boolean;
  /** The CNIL complaint page when the box is shown. */
  cnil?: string;
  parts: {
    picto: HTMLElement;
    grab: HTMLElement;
    close: HTMLElement;
    back?: HTMLElement;
    actions?: HTMLElement;
    /** Where the participation puts its proposal and the review's conflict, its link
     * « Déplacer » and « Vos contributions »: the sheet places them in its reading order. */
    slots?: { head: HTMLElement; move: HTMLElement; mine: HTMLElement };
    share: HTMLElement;
    /** The camera's history (history.ts, lot U), last: it comes in once the API has
     * answered, under everything one can tap. */
    history?: HTMLElement;
  };
};

/** The title drawn in letters: the kind, then the class of who films (the « Statut » row
 * says it in full: « privé (intérieur) », « inconnu »). */
function shortTitle(p: PunkSheetInput["p"], t: Fmt): string {
  const kind = String(p.k ?? "unknown");
  const g = t(`sheet.kind.${kind}.gender`);
  const o = String(p.o ?? "unk");
  const who =
    p.ok === "h"
      ? t(`sheet.operator.household.${g}`)
      : o === "unk"
        ? ""
        : t(`sheet.operator.${o === "pri" ? "pro" : o}.${g}`);
  return `${t(`sheet.punk.title.${kind}`)} ${who}`.trim();
}

/** The rows, sourced first then the box's, in 17a's order: Exploitant, Type, Statut, then
 * what the camera can do, then its position. */
function rows(input: PunkSheetInput): Fact[] {
  const { p, t, facts, operatorName } = input;
  const byKey = new Map(facts.map((f) => [f.key, f]));
  const out: Fact[] = [];
  const answered = byKey.get("operator");
  if (operatorName)
    out.push({
      key: "operator_name",
      label: t("chip.operator_name"),
      value: operatorName,
      // A validated answer may have kept OSM's name or given its own: no tag then.
      source: answered ? undefined : "osm",
    });
  const type = byKey.get("type");
  if (type) out.push(type);
  // Who films: OSM's class, estimated when known and default when not, as the pipeline
  // says (normalize.py operator_class), or a validated answer's (sheet.ts chips()).
  if (answered) out.push({ ...answered, label: t("chip.status") });
  else {
    const o = String(p.o ?? "unk");
    out.push({
      key: "status",
      label: t("chip.status"),
      value: o === "unk" ? t("chip.value.unknown_m") : t(`chip.value.operator.${o}`),
      cert: o === "unk" ? 0 : 1,
    });
  }
  for (const key of ["domes", "direction", "fov", "height", "tilt", "night", "zoom"]) {
    const f = byKey.get(key);
    if (f) out.push(f);
  }
  const position = byKey.get("added") ?? byKey.get("position");
  if (position)
    out.push({
      ...position,
      bare: t(position.key === "added" ? "chip.punk.value.added" : "chip.punk.value.corrected"),
    });
  return out;
}

/** The dates line (17a: « Vérifiée sur place : mars 2026 · Modif. OSM : févr. 2022 »), by
 * the month, « sur place » only when it was. */
function dates(input: PunkSheetInput): string[] {
  const { p, t, month } = input;
  const line: string[] = [];
  if (input.seen && !input.seenByAdd) {
    const key = input.observed("seen") ? "sheet.punk.dates.seen_on_site" : "sheet.punk.dates.seen";
    line.push(t(key, { month: month(String(p.vm)) }));
  } else if (!input.seen) {
    if (p.sd) line.push(t("sheet.punk.dates.osm", { month: month(String(p.sd).slice(0, 7)) }));
    else line.push(t("chip.value.never_checked"));
  }
  if (p.ed) line.push(t("sheet.punk.dates.edited", { month: month(String(p.ed).slice(0, 7)) }));
  return line;
}

/** A distance as the punk interface writes it, everywhere alike: rounded up to the metre
 * (5.6 m → 6 m), without « ~ »; « Calcul ? » says they are estimates (DECISIONS
 * 2026-10-08, « The punk sheet's « ~ »… »). layers.ts reachLabel rounds the map's label
 * the same. */
export const upMetre = (m: number) => Math.ceil(m - 1e-9);

/** The three distance tickets of the chosen estimate (identify, recognise, detect: 17a's
 * « 6 m identifie »), a choice (DECISIONS 2026-10-08, « Punk focus… »): the map shows the
 * chosen level of this camera alone, with its yellow label; « identifie » first, or the
 * first level reached when it is not; the chosen ticket on pink, lifted, with 17a's ✓. A
 * radiogroup: one tab stop, the arrows move among the levels reached, a tap, Enter or the
 * space bar chooses; a level not reached (« — ») cannot be chosen. Under them, as 4b, the
 * note: « si elle est tournée vers vous », too high to identify, then the other estimate's
 * distances. */
function tickets(input: PunkSheetInput): HTMLElement[] {
  const { t, reach, shown, est, estimates } = input;
  const [typical, high] = shown;
  const other = est === high ? typical : high;
  const levels: [1 | 2 | 3, string][] = [
    [3, "identify"],
    [2, "recognise"],
    [1, "detect"],
  ];
  const list = el("ul", "tickets");
  list.setAttribute("role", "radiogroup");
  list.setAttribute("aria-label", t("sheet.punk.tickets.label"));
  const reached = (lv: number) => known(reach[est]?.[lv - 1]);
  const wanted = levels.find(([lv]) => lv === input.level && reached(lv));
  let chosen = wanted?.[0] ?? levels.find(([lv]) => reached(lv))?.[0];
  // The map follows when the level asked for is not reached (another camera, an estimate).
  if (chosen !== undefined && chosen !== input.level) input.onLevel?.(chosen);
  const items: HTMLElement[] = [];
  const paint = () =>
    levels.forEach(([lv], i) => {
      const li = items[i];
      const on = lv === chosen;
      li.classList.toggle("on", on);
      li.setAttribute("aria-checked", String(on));
      li.tabIndex = on ? 0 : -1;
      // 17a's tilts, the pink one lifted.
      li.style.transform = on
        ? `rotate(${ON_TILT[i]}deg) translateY(-4px)`
        : `rotate(${OFF_TILT[i]}deg)`;
    });
  const choose = (lv: 1 | 2 | 3, focus = false) => {
    if (!reached(lv)) return;
    const i = levels.findIndex(([x]) => x === lv);
    if (lv !== chosen) {
      chosen = lv;
      paint();
      input.onLevel?.(lv);
    }
    if (focus) items[i].focus();
  };
  levels.forEach(([lv, key]) => {
    const m = reach[est]?.[lv - 1];
    const li = el("li", "ticket");
    li.setAttribute("role", "radio");
    li.dataset.level = String(lv);
    if (!known(m)) li.setAttribute("aria-disabled", "true");
    const v = el("span", "ticket-v");
    if (known(m)) v.append(t("sheet.m", { v: upMetre(m) }));
    else v.append(drawn("—"), said(t("sheet.punk.ticket.none")));
    li.append(v, el("span", "ticket-k", t(`sheet.punk.ticket.${key}`)), drawn("✓", "ticket-check"));
    li.addEventListener("click", () => choose(lv));
    li.addEventListener("keydown", (e) => {
      const at = levels.findIndex(([x]) => x === lv);
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        choose(lv);
      } else if (step) {
        e.preventDefault();
        // The next level reached, around the three.
        for (let k = 1; k <= levels.length; k++) {
          const [next] = levels[(at + step * k + levels.length * 3) % levels.length];
          if (reached(next)) {
            choose(next, true);
            break;
          }
        }
      }
    });
    items.push(li);
    list.append(li);
  });
  paint();
  const note: string[] = [];
  if (input.mounted && !known(reach[est]?.[2])) note.push(t("sheet.punk.note.too_high"));
  if (other !== undefined && other !== est) {
    const values = levels
      .map(([lv]) => reach[other]?.[lv - 1])
      .map((m) => (known(m) ? t("sheet.punk.note.value", { v: upMetre(m) }) : "—"))
      .join(" · ");
    note.push(
      t("sheet.punk.note.other", { name: t(`estimate.${estimates[other]}.short`), values }),
    );
  }
  return [list, el("p", "sheet-note", note.join(" · "))];
}

/** « Calcul ? » and what it opens: how the sheet is computed, and what each row means
 * (the help a tap on a chip gave), with its certainty's word. */
function how(input: PunkSheetInput, shownRows: Fact[]): [HTMLElement, HTMLElement] {
  const { t } = input;
  const toggle = el("button", "how-toggle", t("sheet.punk.how"));
  toggle.append(said(` ${t("sheet.punk.how.said")}`));
  toggle.setAttribute("aria-expanded", "false");
  toggle.setAttribute("aria-controls", "sheet-how");
  const box = el("div", "how");
  box.id = "sheet-how";
  box.hidden = true;
  for (const key of [
    "sheet.punk.how.certainty",
    "sheet.punk.how.tickets",
    "sheet.punk.how.distances",
    "estimate.probable.sub",
    "estimate.cautious.sub",
    "sheet.old_generation",
    "legend.norm",
    "sheet.focus_exit",
  ])
    box.append(el("p", "", t(key)));
  const helps = el("dl", "how-facts");
  const help = (label: string, key: string, cert?: number) => {
    const dt = el("dt", "", cert === undefined ? label : `${label}, ${t(`cert.${cert}`)}`);
    helps.append(dt, el("dd", "", t(key)));
  };
  help(t("chip.fresh"), input.seen ? "chip.help.fresh_seen" : "chip.help.fresh");
  for (const f of shownRows) help(f.label, `chip.help.${f.key}`, f.cert);
  for (const f of input.facts)
    if (f.key?.startsWith("stale.") || f.key === "check")
      help(f.label, f.key === "check" ? "chip.help.check" : "chip.help.warn");
  box.append(helps);
  toggle.addEventListener("click", () => {
    const open = toggle.getAttribute("aria-expanded") !== "true";
    toggle.setAttribute("aria-expanded", String(open));
    box.hidden = !open;
    // Bring it into what scrolls (a phone's body, a wide screen's paper), never the page
    // (which does not scroll).
    const scroller = [
      box.closest<HTMLElement>(".sheet-body"),
      box.closest<HTMLElement>(".sheet-paper"),
    ]
      .filter((e): e is HTMLElement => e !== null)
      .find((e) => /auto|scroll/.test(getComputedStyle(e).overflowY));
    if (open && scroller) {
      const r = box.getBoundingClientRect();
      const b = scroller.getBoundingClientRect();
      if (r.bottom > b.bottom) scroller.scrollTop += Math.min(r.bottom - b.bottom, r.top - b.top);
    }
  });
  return [toggle, box];
}

/** The paper in its frame: the frame casts the offset shadow of the paper's torn shape
 * (a shadow on the paper itself would be cut by its own clip). */
function edge(paper: HTMLElement): HTMLElement {
  const frame = el("div", "sheet-frame");
  frame.append(paper);
  return frame;
}

/** The head both sheets share: the sticker (a phone's, as 4b), the title with the
 * operator under it (4b's column; 17a's line under the title), the handle (a phone's « ↑ »)
 * and the close button. */
function head(
  title: HTMLElement,
  parts: { picto: HTMLElement; grab: HTMLElement; close: HTMLElement },
  operator?: string,
) {
  const row = el("div", "sheet-head");
  const column = el("div", "sheet-title");
  column.append(title);
  if (operator) column.append(el("p", "sheet-operator", operator));
  parts.close.replaceChildren(drawn("×"));
  parts.grab.replaceChildren();
  row.append(parts.picto, column, parts.grab, parts.close);
  return row;
}

/** The camera's sheet. */
export function punkSheet(frame: HTMLElement, input: PunkSheetInput): void {
  const { p, t, parts } = input;
  frame.replaceChildren();
  const paper = el("div", "sheet-paper");
  const top = el("div", "sheet-top");
  const body = el("div", "sheet-body");
  top.append(head(cutout(input.title, shortTitle(p, t)), parts, input.operatorName));
  const line = dates(input);
  if (line.length) top.append(el("p", "sheet-dates", line.join(" · ")));
  const check = input.facts.find((f) => f.key === "check");
  if (input.gone) {
    const where = input.observed("gone") ? "sheet.punk.gone.on_site" : "sheet.punk.gone.off";
    top.append(stamp("gone", t("chip.gone"), t(where, { month: input.month(String(p.gm)) })));
  } else if (input.noField)
    top.append(band(check ? `${input.sentence} : ${check.value}` : input.sentence, "check"));
  else top.append(...tickets(input));
  if (input.osm && (input.noField || input.gone))
    top.append(outLink(input.osm.edit, t("sheet.osm.edit"), t, "osm-edit"));

  if (parts.back) {
    // A no-break space: a flex item's leading space would collapse (17a « … → »).
    parts.back.append(drawn("\u00a0→"));
    body.append(parts.back);
  }
  // OpenStreetMap's warnings: bands, their source said.
  for (const f of input.facts.filter((x) => x.key?.startsWith("stale."))) {
    const b = band(`${f.label} : ${f.value} `, "warn");
    const tag = el("span", "chip-tag osm");
    tag.append(said(t("chip.punk.source")), t("chip.source.osm"));
    b.firstElementChild?.append(tag);
    body.append(b);
  }
  // The review's conflict and the proposal, under the tickets.
  if (parts.slots) body.append(parts.slots.head);

  const all = rows(input);
  const facts = el("div", "sheet-facts");
  const sourced = el("dl", "facts");
  for (const f of all.filter((x) => x.cert !== 0)) sourced.append(factRow(f, t, input.month));
  facts.append(sourced);
  body.append(facts);
  const assumed = all.filter((x) => x.cert === 0);
  if (assumed.length) {
    // 17a's « Supposé · à compléter » when « Compléter » can answer one of its rows (their
    // « ? »), else 4b's « Supposé d'après le type »: not every default can be asked.
    const ask = (f: Fact) => input.answerable.includes(f.key ?? "");
    const box = el("section", "sheet-assumed");
    box.setAttribute("aria-labelledby", "sheet-assumed-title");
    const h3 = el(
      "h3",
      "",
      t(assumed.some(ask) ? "sheet.punk.assumed" : "sheet.punk.assumed_type"),
    );
    h3.id = "sheet-assumed-title";
    const dl = el("dl", "facts");
    for (const f of assumed) dl.append(factRow(f, t, input.month, ask(f)));
    box.append(h3, dl);
    body.append(box);
  }
  if (input.cnil) {
    const box = el("div", "cnil");
    // Without a direction the signal comes from surveillance=public: "can film", not "turned".
    const key = Number(p.d ?? -1) < 0 ? "sheet.cnil.title_no_direction" : "sheet.cnil.title";
    box.append(band(t(key)), el("p", "", t("sheet.cnil.body")));
    box.append(outLink(input.cnil, t("sheet.cnil.link"), t));
    body.append(box);
  }
  // The participation's buttons (« Compléter », « Toujours là ? »), or what replaces them.
  if (parts.actions) body.append(parts.actions);
  // The buttons' line ends here (the links go on the next): see theme/punk/sheet.css.
  body.append(drawn("", "sheet-break"));
  const [toggle, explained] = how(input, all);
  parts.share.classList.add("sheet-link");
  body.append(parts.share);
  if (parts.slots) body.append(parts.slots.move);
  // Signed out, the way to correct it without an account (the contract's « Signed out »
  // list), unless the top already gives it.
  if (input.osm && input.visitor && !(input.noField || input.gone))
    body.append(outLink(input.osm.edit, t("sheet.osm.edit"), t, "sheet-link osm-edit"));
  if (input.osm)
    body.append(outLink(input.osm.page, t("sheet.punk.osm"), t, "sheet-link osm-page"));
  toggle.classList.add("sheet-link");
  body.append(toggle);
  if (parts.slots) body.append(parts.slots.mine);
  body.append(explained);
  if (parts.history) body.append(parts.history);
  paper.append(top, body);
  frame.append(edge(paper));
  fitTitle(paper.querySelector<HTMLElement>(".sheet-head .headline"));
  pinHead(frame, paper);
}

/** The sheet of an add no build has applied yet: « Caméra proposée » in letters, its status
 * on 20a's yellow tape, its proposal block. */
export function punkPendingSheet(
  frame: HTMLElement,
  input: {
    t: Fmt;
    title: string;
    status: string;
    parts: { picto: HTMLElement; grab: HTMLElement; close: HTMLElement; actions: HTMLElement };
  },
): void {
  frame.replaceChildren();
  const paper = el("div", "sheet-paper pending");
  const top = el("div", "sheet-top");
  top.append(head(cutout(input.title, input.title), input.parts), band(input.status, "tape"));
  const body = el("div", "sheet-body");
  body.append(input.parts.actions);
  paper.append(top, body);
  frame.append(edge(paper));
  fitTitle(paper.querySelector<HTMLElement>(".sheet-head .headline"));
  pinHead(frame, paper);
}
