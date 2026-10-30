// The punk commune and département sheet (redesign lot 3.3), ported from mockup 24a: the
// title in cut-out letters, its line (« Commune · Hauts-de-Seine (92) »), three tickets that
// are tabs (Rues / Caméras / Qui filme), the gridded panel of the chosen one, the place on
// the map's colour ramp, « Partager » and « Calcul ? ». It shows only Y, the share of streets
// within reach of at least one camera (cautious hypothesis, every camera, direction
// ignored), always as a maximum, never as certain; X is not shown (DECISIONS 2026-10-06,
// « Punk commune and département sheets show only Y… »). The ticket's share is rounded down
// (DECISIONS 2026-10-08, « Punk commune and département sheets: the 100 m street… »). What
// 24a draws and the data cannot feed (the exact rank among communes) is in docs/interface.md
// §3 « Commune and département sheets (lot 3.3) ». A chunk the punk interface alone
// downloads (area.ts); its paper is the camera sheet's (theme/punk/sheet.css), its own rules
// theme/punk/area.css.
import { cutout, fitTitle, pinHead } from "./chips";
import { t } from "./i18n";
import { porteLieu } from "./registre/hote";
import { onTheme } from "./theme";

type Props = Record<string, string | number | undefined>;
type Breaks = Record<string, { breaks: number[] }>;
type Meta = { communes?: Breaks; departements?: Breaks; area_classes?: number[] };

export type PunkAreaInput = {
  p: Props;
  /** « Commune · Hauts-de-Seine (92) » (area.ts areaLine). */
  line: string;
  departement: boolean;
  /** The map's « Qui filme » when the sheet opens: the sheet starts on that set. */
  publicOnly: boolean;
  parts: { grab: HTMLElement; close: HTMLElement; share: HTMLElement };
  /** The map's sticker of a camera type (16a), in the mode in force (icons.ts cameraCanvas). */
  sticker: (kind: string) => HTMLCanvasElement;
};

type Tab = "streets" | "cameras" | "who";
const TABS: Tab[] = ["streets", "cameras", "who"];
// 24a's tickets: tilted at rest, the chosen one tilted the other way and lifted 3 px.
const ON_TILT = [-3, 2, -2];
const OFF_TILT = [1, -1.5, 1.5];
const TOP_OPERATORS = 5; // pipeline/lacarte/admin.py TOP_OPERATORS: the names the tiles keep
// The tiles' types (`k_<kind>`, pipeline/lacarte/aggregate.py KINDS) in 24a's order: the
// known types, then the unknown last.
const KINDS = ["dome", "multidome", "fixed", "ptz", "panorama", "alpr", "doorbell", "unknown"];
// The operator classes (`n_pub`…, the map's « Qui filme »).
const CLASSES = ["pub", "pro", "pri", "unk"] as const;
/** The farthest a ticket's fraction may fall below Y (points); farther, the percentage. */
const SHARE_GAP = 2;

// The colour breaks (tiles/meta.json, as the map's), asked once: the browser has it already.
let metaLoad: Promise<Meta> | null = null;
let meta: Meta | null = null;
const loadMeta = () =>
  (metaLoad ??= fetch(`${window.location.origin}/tiles/meta.json`)
    .then((r) => r.json() as Promise<Meta>)
    .then((m) => (meta = m)));

function el(tag: string, cls = "", text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
/** Said, not seen. */
const said = (text: string) => el("span", "sheet-sr", text);
/** Seen, not said. */
const drawn = (text: string, cls = "") => {
  const e = el("span", cls, text);
  e.setAttribute("aria-hidden", "true");
  return e;
};

const num = (p: Props, key: string) => Number(p[key] ?? 0);
/** Rounded up, to the tenth: the metres that may be filmed (with those out of reach rounded
 * down, the two make 100 m). */
const up = (v: number) => Math.max(0, Math.ceil(v * 10 - 1e-9) / 10);
/** Rounded down, to the tenth. */
const down = (v: number) => Math.max(0, Math.floor(v * 10 + 1e-9) / 10);

export type Share = { form: "none" } | { form: "one_in" | "n_in_ten" | "pct"; n: number };
/** Y (%) as the « Rues » ticket says it, rounded down, never above Y: the nearest of « 1 sur
 * N » and « N sur 10 » below it (Y = 51,4 %: « 5 sur 10 »; 27 %: « 1 sur 4 »); when that
 * fraction falls more than SHARE_GAP points below Y, the percentage rounded down to the
 * unit instead (58 %: « 5 sur 10 » would say 8 points less, so « 57 % »); « Aucune » at 0. */
export function streetShare(y: number): Share {
  if (y <= 0) return { form: "none" };
  const eps = 1e-9;
  const tenths = Math.floor(y / 10 + eps);
  const n = Math.ceil(100 / y - eps);
  // Equal (50 %, 20 %): « 1 sur N » up to one street in two, « N sur 10 » above.
  const tens = tenths * 10 > 100 / n + eps || (tenths * 10 >= 100 / n - eps && y > 50);
  const best: Share = tenths > 0 && tens ? { form: "n_in_ten", n: tenths } : { form: "one_in", n };
  const shown = best.form === "n_in_ten" ? best.n * 10 : 100 / n;
  if (y - shown <= SHARE_GAP + eps) return best;
  return { form: "pct", n: Math.floor(y + eps) };
}

/** The ticket's two lines: « 5 sur 10 » / « rues à portée », « 57 % » / « des rues à
 * portée », « Aucune » / « rue à portée » (DECISIONS 2026-10-09, « Punk sheets on a
 * phone… »). */
function shareFace(y: number): [string, string] {
  const s = streetShare(y);
  if (s.form === "none") return [t("area.punk.none"), t("area.punk.tab.streets_none")];
  const k = s.form === "pct" ? "area.punk.tab.streets_pct" : "area.punk.tab.streets";
  return [t(`area.punk.${s.form}`, { n: s.n }), t(k)];
}

/** The class of the map's colour (layers.ts areaColour: a step on the breaks), the breaks in
 * force; null when the map hatches the area (no camera in the set). */
function mapClass(p: Props, pub: boolean, departement: boolean) {
  if (num(p, pub ? "n_pub" : "n") <= 0) return null;
  // The punk map's fixed classes (filters.ts breaks); the quantiles of an older build.
  const set = meta?.area_classes
    ? { breaks: meta.area_classes }
    : meta?.[departement ? "departements" : "communes"]?.[pub ? "hi_pub" : "hi"];
  if (!set) return undefined;
  const breaks = set.breaks.filter((b, i, a) => i === 0 || b > a[i - 1]);
  const y = num(p, pub ? "hi_pub" : "hi");
  return { breaks, k: breaks.filter((b) => y >= b).length };
}

/** « Sa couleur : la classe la plus filmée (plus de 18,9 % des rues à portée) »: class k of
 * the map's colours in words (the least and the most filmed, the middle one, a little or a
 * much filmed one between), then its range (DECISIONS 2026-10-09, « Punk sheets on a
 * phone… »). The breaks are deduplicated (mapClass): their count is not fixed. */
export function placeLine(breaks: number[], k: number): string {
  const last = breaks.length;
  const rank =
    k <= 0
      ? "least"
      : k >= last
        ? "most"
        : 2 * k === last
          ? "middle"
          : 2 * k < last
            ? "low"
            : "high";
  const range =
    k <= 0
      ? t("area.punk.place.below", { v: breaks[0] ?? 0 })
      : k >= last
        ? t("area.punk.place.above", { v: breaks[last - 1] })
        : t("area.punk.place.between", { lo: breaks[k - 1], hi: breaks[k] });
  return t("area.punk.place", { rank: t(`area.punk.place.${rank}`), range });
}

function panelHead(title: string, extra?: HTMLElement): HTMLElement {
  const head = el("div", "area-panel-head");
  head.append(el("h3", "area-label", title));
  if (extra) head.append(extra);
  return head;
}

/** « Rues »: the 100 m street, Y in light blue on the ink, the rest empty; two rows. */
function streets(input: PunkAreaInput, pub: boolean, setPub: (v: boolean) => void): HTMLElement[] {
  const { p } = input;
  const y = num(p, pub ? "hi_pub" : "hi");
  const max = Math.min(100, up(y));
  const off = down(100 - max);
  const road = num(p, "road_km");
  const maxKm = Math.min(road, up((y / 100) * road));
  const offKm = down(road - maxKm);

  const group = el("div", "area-counted");
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", t("area.punk.counted"));
  for (const [key, v] of [
    ["all", false],
    ["public", true],
  ] as const) {
    const b = el("button", "area-toggle", t(`area.punk.counted.${key}`));
    b.setAttribute("type", "button");
    b.dataset.set = key;
    b.setAttribute("aria-pressed", String(pub === v));
    b.addEventListener("click", () => {
      if (pub !== v) setPub(v);
    });
    group.append(b);
  }

  const road100 = drawn("", "area-road");
  const track = el("span", "area-track");
  const fill = el("span", "area-fill");
  fill.style.width = `${max}%`;
  track.append(el("span", "area-mid"), fill);
  const scale = el("span", "area-scale");
  for (const v of [0, 50, 100]) scale.append(el("span", "", v ? t("sheet.m", { v }) : "0"));
  road100.append(track, scale);

  const rows = el("ul", "area-rows");
  rows.setAttribute("aria-hidden", "true");
  const row = (cls: string, m: number, key: string, km: number) => {
    const li = el("li", `area-row ${cls}`);
    li.append(
      el("span", "area-sw"),
      el("b", "area-num", t("sheet.m", { v: m })),
      el("span", "area-row-label", t(key)),
      el("span", "area-row-sub", t("area.punk.km", { v: km })),
    );
    return li;
  };
  rows.append(
    row("max", max, "area.punk.row.max", maxKm),
    row("off", off, "area.punk.row.off", offKm),
  );
  const sentence = said(
    t("area.punk.streets.said", {
      name: String(p.nm),
      pub: pub ? t("area.punk.streets.said_public") : "",
      max: t("sheet.m", { v: max }),
      off: t("sheet.m", { v: off }),
    }),
  );
  const out = [panelHead(t("area.punk.streets.title"), group), road100, rows, sentence];
  if (num(p, pub ? "n_pub" : "n") === 0 && y > 0)
    out.push(el("p", "area-note", t("area.punk.neighbours")));
  return out;
}

/** One row of a counted list: label, dotted leader, count; a sticker before it for a type. */
function countRow(label: string, count: number, sticker?: HTMLElement): HTMLElement {
  const li = el("li");
  if (sticker) {
    const slot = drawn("", "area-sticker");
    slot.append(sticker);
    li.append(slot);
  }
  li.append(el("span", "", label), drawn("", "area-leader"));
  li.append(el("b", "area-count", String(count)));
  return li;
}

/** « La liste des caméras » (24a): the cameras by type with 16a's stickers, a type without
 * camera left out. The stickers are drawn again when the mode changes. */
function cameras(input: PunkAreaInput): HTMLElement[] {
  const { p } = input;
  const n = num(p, "n");
  const nd = p.nd === undefined ? undefined : Number(p.nd);
  const sub =
    n && nd !== undefined
      ? el("span", "area-sub", t("area.punk.cameras.no_direction", { pct: nd }))
      : undefined;
  const head = panelHead(t("area.punk.cameras.title"), sub);
  if (!n) return [head, el("p", "area-empty", t("area.cameras", { n: 0 }))];
  const kinds = KINDS.filter((k) => num(p, `k_${k}`) > 0);
  // Tiles built before the types were counted (pipeline, 2026-10-08) have none.
  if (!kinds.length) return [head, el("p", "area-empty", t("area.punk.cameras.no_kinds"))];
  const list = el("ul", "area-list area-kinds");
  const fill = () =>
    list.replaceChildren(
      ...kinds.map((k) => countRow(t(`area.punk.kind.${k}`), num(p, `k_${k}`), input.sticker(k))),
    );
  fill();
  onTheme(fill, () => list.isConnected);
  return [head, list];
}

/** « Qui filme ? »: the named operators by cameras, those without a name apart (24a), then
 * every camera by operator class, as the map's « Qui filme » counts them. */
function who(p: Props): HTMLElement[] {
  const head = panelHead(t("area.punk.who.title"));
  const n = num(p, "n");
  const ops: [string, number][] = p.ops ? JSON.parse(String(p.ops)) : [];
  const classes = el("ul", "area-list area-classes");
  for (const cls of CLASSES)
    classes.append(countRow(t(`area.punk.class.${cls}`), num(p, `n_${cls}`)));
  const byClass = [el("p", "area-sub area-classes-head", t("area.punk.who.classes")), classes];
  if (!ops.length) return [head, el("p", "area-empty", t("area.no_operator")), ...byClass];
  const list = el("ol", "area-ops");
  const item = (name: string, count: number, cls = "") => {
    const li = el("li", cls);
    const line = el("span", "area-op");
    line.append(el("span", "", name), el("b", "area-count", String(count)));
    const bar = drawn("", "area-bar");
    bar.style.width = `${n ? (100 * count) / n : 0}%`;
    li.append(line, bar);
    return li;
  };
  for (const [name, count] of ops) list.append(item(name, count));
  // Without a sixth name, every camera left has none; with five, the rest may be named too.
  const rest = n - ops.reduce((s, [, c]) => s + c, 0);
  if (rest > 0) {
    const key = ops.length < TOP_OPERATORS ? "area.punk.who.unnamed" : "area.punk.who.others";
    list.append(item(t(key), rest, "unnamed"));
  }
  return [head, list, ...byClass];
}

/** « Place sur la carte »: the map's ramp (as many colours as the breaks make), the area's
 * cursor on its own, and the legend's label of its class. */
function place(input: PunkAreaInput, pub: boolean): HTMLElement {
  const box = el("section", "area-place");
  box.setAttribute("aria-labelledby", "area-place-title");
  const h3 = el("h3", "sheet-sr", t("area.punk.place.title"));
  h3.id = "area-place-title";
  box.append(h3);
  const fill = () => {
    box.replaceChildren(h3);
    const c = mapClass(input.p, pub, input.departement);
    if (c === undefined) return;
    if (c === null) {
      box.append(el("p", "area-place-text", t("area.punk.place.none")));
      return;
    }
    const wrap = drawn("", "area-ramp-wrap");
    const ramp = el("span", "area-ramp");
    const cells = c.breaks.length + 1;
    for (let i = 0; i < cells; i++) {
      const cell = el("span");
      cell.style.background = `var(--map-area-${i + 1})`;
      ramp.append(cell);
    }
    // The name never runs out of the ramp (no sideways scroll: DECISIONS 2026-10-09, « Punk
    // sheets on a phone… »): moved back by the same share of its own width as its class's
    // middle is of the ramp's, cut with « … » when longer than the ramp; the ▾ under it on
    // the class's middle.
    const at = ((c.k + 0.5) / cells) * 100;
    const cursor = el("span", "area-cursor", String(input.p.nm));
    cursor.style.left = `${at}%`;
    cursor.style.transform = `translateX(-${at}%) rotate(-3deg)`;
    const pin = el("span", "area-pin", "▾");
    pin.style.left = `${at}%`;
    pin.style.transform = "translateX(-50%)";
    wrap.append(ramp, cursor, pin);
    box.append(wrap, el("p", "area-place-text", placeLine(c.breaks, c.k)));
  };
  fill();
  if (!meta) void loadMeta().then(fill, () => {});
  return box;
}

/** « Calcul ? » and what it opens. */
function how(p: Props): [HTMLElement, HTMLElement] {
  const toggle = el("button", "how-toggle sheet-link", t("sheet.punk.how"));
  toggle.setAttribute("type", "button");
  toggle.append(said(` ${t("sheet.punk.how.said")}`));
  toggle.setAttribute("aria-expanded", "false");
  toggle.setAttribute("aria-controls", "area-how");
  const box = el("div", "how");
  box.id = "area-how";
  box.hidden = true;
  const reliability = p.rw
    ? `${t(`area.word.${p.rw}`)} — ${t(`area.reason.${p.rr}`, { pct: Number(p.rp) })}`
    : t("area.reliability.none");
  for (const text of [
    t("area.punk.how.max"),
    t("area.how.share"),
    t("area.punk.how.round"),
    t("area.punk.how.cameras"),
    t("area.punk.how.who"),
    // The punk map's fixed classes (filters.ts breaks), written before meta.json is in.
    t("legend.fixed_classes"),
    reliability,
    t("area.how.reliability"),
    t("area.punk.how.filters"),
    t("area.how.source"),
  ])
    box.append(el("p", "", text));
  toggle.addEventListener("click", () => {
    const open = toggle.getAttribute("aria-expanded") !== "true";
    toggle.setAttribute("aria-expanded", String(open));
    box.hidden = !open;
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

/** The sheet. Its tabs and « Toutes / Publiques » change the tickets, the panel and the
 * place in place: the frame, its top and its body stay (a phone's sheet sized them). */
export function punkAreaSheet(frame: HTMLElement, input: PunkAreaInput): void {
  const { p, parts } = input;
  if (!meta) void loadMeta().catch(() => {});
  const state = { tab: "streets" as Tab, pub: input.publicOnly };
  frame.replaceChildren();
  const paper = el("div", "sheet-paper area-paper");
  const top = el("div", "sheet-top");
  const body = el("div", "sheet-body");

  const head = el("div", "sheet-head");
  const column = el("div", "sheet-title");
  // Its letters may wrap after a hyphen (« HAUTS-DE-SEINE » is wider than the paper).
  const title = cutout(String(p.nm), String(p.nm).replace(/-/g, "- "));
  title.querySelector(".sheet-sr")?.classList.add("area-name");
  column.append(title, el("p", "area-line", input.line));
  parts.close.replaceChildren(drawn("×"));
  parts.grab.replaceChildren();
  head.append(column, parts.grab, parts.close);

  // The tickets are tabs (24a: role tablist, aria-selected); arrows, Home and End move
  // between them, the chosen one alone in the tab order.
  const n = num(p, "n");
  const ops: [string, number][] = p.ops ? JSON.parse(String(p.ops)) : [];
  const face = (id: Tab): [string, string] => {
    const y = num(p, state.pub ? "hi_pub" : "hi");
    if (id === "streets") return shareFace(y);
    if (id === "cameras") return [String(n), t("area.punk.tab.cameras", { n })];
    return ops.length ? [ops[0][0], t("area.punk.tab.who")] : ["0", t("area.punk.tab.who_none")];
  };
  const tabs = el("div", "area-tabs");
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", t("area.punk.tabs"));
  const panel = el("div", "area-panel");
  panel.id = "area-panel";
  panel.setAttribute("role", "tabpanel");
  panel.style.transform = "rotate(-0.6deg)";
  const placeSlot = el("div", "area-place-slot");

  const buttons: HTMLElement[] = [];
  const draw = () => {
    TABS.forEach((id, i) => {
      const b = buttons[i];
      const on = state.tab === id;
      const [v, k] = face(id);
      b.className = `area-tab${on ? " on" : ""}`;
      b.setAttribute("aria-selected", String(on));
      b.setAttribute("aria-label", `${v} ${k}`);
      b.tabIndex = on ? 0 : -1;
      b.style.transform = on
        ? `rotate(${ON_TILT[i]}deg) translateY(-3px)`
        : `rotate(${OFF_TILT[i]}deg)`;
      // A long name (an operator) takes smaller letters on two lines (24a's « DIRIF » is
      // short).
      b.replaceChildren(
        drawn("✓", "area-tab-check"),
        el("span", `area-tab-v${v.length > 8 ? " long" : ""}`, v),
        el("span", "area-tab-k", k),
      );
    });
    panel.setAttribute("aria-labelledby", `area-tab-${state.tab}`);
    panel.replaceChildren(
      ...(state.tab === "streets"
        ? streets(input, state.pub, setPub)
        : state.tab === "cameras"
          ? cameras(input)
          : who(p)),
    );
    placeSlot.replaceChildren(place(input, state.pub));
  };
  const choose = (id: Tab) => {
    if (state.tab === id) return;
    state.tab = id;
    draw();
  };
  function setPub(v: boolean) {
    state.pub = v;
    draw();
    panel.querySelector<HTMLElement>(`.area-toggle[data-set="${v ? "public" : "all"}"]`)?.focus();
  }
  TABS.forEach((id, i) => {
    const b = el("button", "area-tab");
    b.id = `area-tab-${id}`;
    b.setAttribute("type", "button");
    b.setAttribute("role", "tab");
    b.setAttribute("aria-controls", "area-panel");
    b.addEventListener("click", () => choose(id));
    b.addEventListener("keydown", (e) => {
      const to = (
        { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: TABS.length - 1 } as Record<
          string,
          number
        >
      )[e.key];
      if (to === undefined) return;
      e.preventDefault();
      const next = TABS[(to + TABS.length) % TABS.length];
      choose(next);
      buttons[TABS.indexOf(next)].focus();
    });
    tabs.append(b);
    buttons.push(b);
  });
  draw();
  top.append(head, tabs);

  body.append(panel, placeSlot, drawn("", "sheet-break"));
  const [toggle, explained] = how(p);
  parts.share.classList.add("sheet-link");
  // The register's page of the commune or département, when it holds one (registre/hote.ts).
  const door = el("div", "area-registre");
  void porteLieu(String(p.c), String(p.c) === String(p.d)).then((a) => a && door.append(a));
  body.append(parts.share, door, toggle, explained);
  paper.append(top, body);
  const edge = el("div", "sheet-frame");
  edge.append(paper);
  frame.append(edge);
  fitTitle(title);
  pinHead(frame, paper);
}
