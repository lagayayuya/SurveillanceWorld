// The punk interface's map screen (redesign lot 3.1, after mockups 20a on a wide screen,
// 18a on a phone, and 17a's map side): the header ticket « Surveillance World » with its two
// links, « Filtres et légende » and « Liste des caméras »; the filters « machine » that rises
// under the ticket, the ticket printing the legend when « Légende » is pressed; the list of
// the cameras in view, the map's accessible alternative. A chunk of its own (main.ts), it
// builds its DOM once and patches it on every render (filters.ts calls it on each idle):
// the keyboard focus, a finger's tap and the machine's slide survive the map's moves. Each
// row is a label holding its input, its label and its count; their look is 20a's.
import type { Map as MlMap } from "maplibre-gl";
import { t } from "./i18n";
import { cameraCanvas, type Kind, levelCanvas } from "./icons";
import { mode, onTheme, palette, toggleMode } from "./theme";

/** What the filters panel (filters.ts) gives the machine to draw, at each render. */
export type MachineView = {
  /** From the street level: types and the sheets' state are filterable. */
  street: boolean;
  /** Counts summed by commune (below the street level). */
  approx: boolean;
  publicOnly: boolean;
  ops: { op: string; n: number; on: boolean }[];
  /** Below the street level: all, public only. */
  pub: { all: number; pub: number };
  kinds: { kind: Kind; n: number; on: boolean }[];
  /** « État de la fiche »: shown (on) or hidden. */
  states: { id: "maybe_gone" | "pending"; on: boolean }[];
  adv: { id: string; group: string; n: number | null; on: boolean; label: string }[];
  groups: string[];
  operatorQuery: string;
  operatorCount: string;
  operators: string[];
  shown: number;
  total: number;
  /** Active restrictions (the reset button and the link's count). */
  active: number;
  /** Those set in the street view (all but « public only »): told at every zoom. */
  streetActive: number;
  /** What the filters hide whole in the view, told on the map; null: nothing. */
  hiddenWhole: "cameras" | "streets" | null;
  advActive: number;
  notes: { text: string; cls: string }[];
  legend: LegendView;
  estimateName: string;
  estimateSub: string;
  /** The map's ground (the basemap's earth), under the level samples. */
  ground: string;
};

export type LegendView =
  | { kind: "areas"; title: string; swatches: { colour: string; label: string }[] }
  | {
      kind: "streets";
      /** z14+: unfilmed streets are drawn grey. */
      unfilmed: boolean;
      /** z15+: fields, stickers, markers. */
      street: boolean;
    };

/** What the machine asks of the filters panel. */
export type MachineActions = {
  setOpened(opened: boolean): void;
  toggleOp(op: string, on: boolean): void;
  setPublicOnly(pub: boolean): void;
  toggleKind(kind: Kind, on: boolean): void;
  toggleState(id: "maybe_gone" | "pending", on: boolean): void;
  toggleAdv(id: string, on: boolean): void;
  setOperator(query: string): void;
  setAdvOpen(open: boolean): void;
  reset(): void;
};

// --- small DOM helpers ---------------------------------------------------------------------

type Attrs = Record<string, string | boolean | undefined>;
function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: (Node | string | null | undefined)[]
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    e.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children) if (c !== null && c !== undefined) e.append(c);
  return e;
}

const SVG = "http://www.w3.org/2000/svg";
/** An icon the fonts' Latin subsets lack (↓ ↑ → ✓; DECISIONS 2026-10-05, « Punk fonts… »),
 * drawn in the text's colour, hidden from screen readers. */
function icon(name: "right" | "down" | "up" | "check" | "boom", cls = "icon"): SVGSVGElement {
  const s = document.createElementNS(SVG, "svg");
  s.setAttribute("aria-hidden", "true");
  s.setAttribute("class", cls);
  s.setAttribute("focusable", "false");
  const paths: Record<string, string> = {
    right: "M2 8h10M8.5 4l4 4-4 4",
    down: "M8 2v10M4 8.5l4 4 4-4",
    up: "M8 14V4M4 7.5l4-4 4 4",
    check: "M3 8.5l3.2 3.2L13 4.8",
  };
  if (name === "boom") {
    // 20a's reset: a little atomic mushroom (« BOUM ! » when pressed).
    s.setAttribute("viewBox", "0 0 32 32");
    const shapes: [string, Record<string, string>][] = [
      ["ellipse", { cx: "16", cy: "27.2", rx: "11.5", ry: "2.6" }],
      ["path", { d: "M13.6 15.5c0 4.2-1.2 7.6-2.6 10.6h10c-1.4-3-2.6-6.4-2.6-10.6z" }],
      ["ellipse", { cx: "16", cy: "18.6", rx: "5.6", ry: "1.7" }],
      ["circle", { cx: "9.8", cy: "11.2", r: "5" }],
      ["circle", { cx: "16", cy: "8.6", r: "6.6" }],
      ["circle", { cx: "22.2", cy: "11.2", r: "5" }],
      ["ellipse", { cx: "16", cy: "13.6", rx: "10.4", ry: "3.4" }],
      ["ellipse", { cx: "13.2", cy: "7.4", rx: "2.4", ry: "1.5", class: "boom-spot" }],
      ["ellipse", { cx: "8.6", cy: "10.6", rx: "1.4", ry: "1", class: "boom-spot" }],
    ];
    for (const [tag, a] of shapes) {
      const el = document.createElementNS(SVG, tag);
      for (const [k, v] of Object.entries(a)) el.setAttribute(k, v);
      s.append(el);
    }
    return s;
  }
  s.setAttribute("viewBox", "0 0 16 16");
  const p = document.createElementNS(SVG, "path");
  p.setAttribute("d", paths[name]);
  s.append(p);
  return s;
}

/** The mode button's icons, in the text's colour, hidden from screen readers (the button's
 * name says it): a sun of eight rays, a crescent moon. */
function sun(): SVGSVGElement {
  const s = icon("check", "mode-icon");
  s.setAttribute("viewBox", "0 0 24 24");
  const rays = Array.from({ length: 8 }, (_, i) => {
    const a = (i * Math.PI) / 4;
    const [c, n] = [Math.cos(a), Math.sin(a)];
    const f = (v: number) => (12 + v).toFixed(2);
    return `M${f(c * 7.5)} ${f(n * 7.5)}L${f(c * 10.5)} ${f(n * 10.5)}`;
  }).join("");
  (s.firstChild as SVGPathElement).setAttribute("d", `M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8z${rays}`);
  return s;
}
function moon(): SVGSVGElement {
  const s = icon("check", "mode-icon");
  s.setAttribute("viewBox", "0 0 24 24");
  (s.firstChild as SVGPathElement).setAttribute(
    "d",
    "M19.5 14.6A8 8 0 0 1 9.4 4.5a8 8 0 1 0 10.1 10.1z",
  );
  return s;
}

/** 17a's cut-out title: one piece of paper per letter, the real text for screen readers. */
function cutOut(text: string): HTMLElement[] {
  const letters = h("span", { class: "cut", "aria-hidden": "true" });
  [...text.toUpperCase()].forEach((ch, i) => {
    letters.append(h("span", { class: `cut-${i % 7}` }, ch));
  });
  return [h("span", { class: "sr" }, text), letters];
}

const setText = (e: Element, text: string) => {
  if (e.textContent !== text) e.textContent = text;
};
const setHidden = (e: HTMLElement, hidden: boolean) => {
  if (e.hidden !== hidden) e.hidden = hidden;
};

// --- the header ticket ---------------------------------------------------------------------

type Key = { root: HTMLLabelElement; input: HTMLInputElement; count: HTMLElement };

/** A row of the machine as 20a draws its keys: a label holding a visually hidden checkbox
 * (or radio), then what the key shows; `on` and the input follow the state at each render. */
function key(
  cls: string,
  type: "checkbox" | "radio",
  name: string,
  parts: (Node | string)[],
  onChange: (on: boolean) => void,
): Key {
  const input = h("input", { type, name: type === "radio" ? name : undefined });
  input.addEventListener("change", () => onChange(input.checked));
  const count = h("span", { class: "count" });
  const root = h("label", { class: `row toggle ${cls}` }, input, ...parts);
  return { root, input, count };
}

function syncKey(k: Key, on: boolean, count?: string): void {
  if (k.input.checked !== on) k.input.checked = on;
  k.root.classList.toggle("on", on);
  if (count !== undefined) setText(k.count, count);
}

/** The machine (filters), its ticket and the camera list; built once by main.ts. */
export class Machine {
  private ticket: HTMLElement;
  private machine: HTMLElement;
  private legendBody: HTMLElement;
  private calc: HTMLElement;
  private legendKey = "";
  private legendOpen = false;
  private calcOpen = false;
  private els: Record<string, HTMLElement> = {};
  private who: Map<string, Key> = new Map();
  private whoLow: Map<"all" | "pub", Key> = new Map();
  private kinds: Map<string, Key> = new Map();
  private states: Map<string, Key> = new Map();
  private chips: Map<string, Key> = new Map();
  private advGroups: Map<string, HTMLElement> = new Map();
  private drums: HTMLElement[] = [];
  private shown = -1;
  private resize: ResizeObserver;
  private drawnMode = mode();

  constructor(
    private panel: HTMLElement,
    private fab: HTMLButtonElement,
    private actions: MachineActions,
    private list: CameraList,
    /** The squares after the mode's under the ticket's link (25a: the account's). */
    private squares: HTMLElement[] = [],
  ) {
    this.ticket = this.buildTicket();
    this.panel.before(this.ticket);
    this.legendBody = this.els.legendBody;
    this.calc = this.els.calc;
    this.machine = this.buildMachine();
    this.panel.replaceChildren(this.machine);
    this.panel.classList.add("machine");
    this.panel.setAttribute("aria-labelledby", "machine-title");
    this.panel.removeAttribute("aria-label");
    // The machine sits under the ticket's title, or under the whole ticket while it prints
    // the legend: its top follows the ticket's size (fonts, legend, screen).
    this.resize = new ResizeObserver(() => this.place());
    this.resize.observe(this.ticket);
    window.addEventListener("resize", () => this.place());
  }

  /** The machine's top, under the ticket's title (or its legend), as 20a stacks them. */
  place(): void {
    const title = this.els.title.getBoundingClientRect();
    const ticket = this.ticket.getBoundingClientRect();
    const top = this.legendOpen ? ticket.bottom - 26 : title.bottom - 14;
    document.body.style.setProperty("--machine-top", `${Math.round(top)}px`);
    // The camera list sits under the whole ticket (camlist.css).
    if (!document.body.classList.contains("machine-open"))
      document.body.style.setProperty("--ticket-bottom", `${Math.round(ticket.bottom)}px`);
  }

  private buildTicket(): HTMLElement {
    const title = h("h1", { id: "ticket-title", class: "ticket-title" }, t("app.name"));
    this.els.title = title;
    // « Filtres et légende »: the page's own button (index.html #fab-filters), moved here.
    const fab = this.fab;
    fab.classList.remove("fab");
    fab.classList.add("ticket-link");
    fab.setAttribute("aria-controls", "filters");
    fab.setAttribute("aria-expanded", "false");
    const fabText = h("span", { class: "ticket-link-text" });
    fab.replaceChildren(fabText, icon("right"));
    this.els.fabText = fabText;
    // « Liste des caméras » hidden until further notice (DECISIONS 2026-10-08, « Punk, until
    // further notice… »): its opener is not placed, the list's code stays (CameraList).
    // Under the link, 25a's squares: the mode's, then the account's (account/index.ts).
    const squares = h("div", { class: "ticket-squares" }, this.modeToggle(), ...this.squares);
    const links = h("div", { class: "ticket-links" }, fab, squares);
    this.els.links = links;
    // The legend the ticket prints (20a « Légende ↑ »), with « Calcul ? ».
    const calcBtn = h(
      "button",
      {
        type: "button",
        class: "ticket-link legend-calc",
        "aria-expanded": "false",
        "aria-controls": "legend-calc",
      },
      t("legend.ticket.calc"),
    );
    const calc = h("div", { id: "legend-calc", class: "legend-calc-text", hidden: true });
    calcBtn.addEventListener("click", () => {
      this.calcOpen = !this.calcOpen;
      calcBtn.setAttribute("aria-expanded", String(this.calcOpen));
      calc.hidden = !this.calcOpen;
    });
    this.els.calc = calc;
    const body = h("div", { class: "legend-body" });
    this.els.legendBody = body;
    const legend = h(
      "div",
      {
        id: "legend",
        class: "legend ticket-legend",
        role: "region",
        "aria-label": t("legend.section"),
      },
      h("div", { class: "legend-calc-row" }, calcBtn),
      calc,
      body,
    );
    this.els.legend = legend;
    // No scotch on the ticket: the map's only tape means « correction en attente »
    // (DECISIONS 2026-10-09, « Punk map after the iPhone test »).
    return h(
      "section",
      { id: "ticket", class: "ticket", "aria-labelledby": "ticket-title" },
      h("div", { class: "ticket-paper" }, title, links, legend),
    );
  }

  /** The sun / moon button (DECISIONS 2026-10-09, in place of Clair / Sombre / Auto): the
   * first of 25a's 44 px squares under the ticket's link, a key as the machine's (theme/
   * punk/map.css .ticket-square), the moon in light (« Passer en mode sombre »), the
   * sun in dark (« Passer en mode clair »); its name says what a tap does, so no pressed
   * state. The first visit follows the phone; a tap keeps the other mode on the device
   * (theme.ts toggleMode). Drawn again when the phone changes the mode meanwhile. */
  private modeToggle(): HTMLElement {
    const b = h("button", {
      type: "button",
      id: "mode-toggle",
      class: "ticket-square mode-toggle",
    });
    const draw = () => {
      const dark = mode() === "dark";
      b.dataset.mode = dark ? "dark" : "light";
      b.setAttribute("aria-label", t(dark ? "mode.to_light" : "mode.to_dark"));
      b.replaceChildren(dark ? sun() : moon());
    };
    b.addEventListener("click", () => {
      toggleMode();
      draw();
    });
    onTheme(draw, () => b.isConnected);
    draw();
    return b;
  }

  private buildMachine(): HTMLElement {
    const a = this.actions;
    // The machine's body, as 20a draws it: a dark case on feet with a top handle, a tray
    // with its slot, a crank on its right side, four screws; decoration only.
    const deco = h(
      "div",
      { class: "machine-case", "aria-hidden": "true" },
      h("div", { class: "case-body" }),
      h("div", { class: "case-handle" }, h("span")),
      h("div", { class: "case-tray" }, h("span"), h("span")),
      h("div", { class: "case-foot left" }),
      h("div", { class: "case-foot right" }),
      h(
        "div",
        { class: "case-crank" },
        h("span", { class: "crank-arm" }, h("span")),
        h("span", { class: "crank-hub" }),
        h("span", { class: "crank-pin" }),
      ),
      h("span", { class: "screw tl" }),
      h("span", { class: "screw tr" }),
      h("span", { class: "screw bl" }),
      h("span", { class: "screw br" }),
    );

    // Head: the cut-out title, « Légende ↑ / Ranger ↓ ».
    const legendKey = h(
      "button",
      { type: "button", class: "legend-key", "aria-expanded": "false", "aria-controls": "legend" },
      h("span", { class: "legend-key-text" }, t("filters.legend_show")),
      // 20a's arrow is a glyph of Archivo after a space (« Légende ↑ »), not said: the
      // button says « Légende » and whether it is expanded. A no-break space: a flex item's
      // leading space would collapse.
      h("span", { class: "legend-key-arrow", "aria-hidden": "true" }, "\u00a0↑"),
    );
    legendKey.addEventListener("click", () => this.setLegend(!this.legendOpen));
    this.els.legendKey = legendKey;
    const head = h(
      "div",
      { class: "machine-head" },
      h("h2", { id: "machine-title", class: "machine-title" }, ...cutOut(t("filters.title"))),
      legendKey,
    );

    // The counter: drums, the sentence, « Tout réafficher ».
    const drums = h("span", { class: "drums", "aria-hidden": "true" });
    this.els.drums = drums;
    const counterText = h("p", { class: "counter-text" });
    this.els.counterText = counterText;
    const reset = h(
      "button",
      { type: "button", class: "reset", "aria-label": t("filters.reset"), "aria-disabled": "true" },
      icon("boom", "boom-icon"),
    );
    reset.addEventListener("click", () => {
      if (reset.getAttribute("aria-disabled") === "true") return;
      a.reset();
      this.boom(reset);
    });
    this.els.reset = reset;
    const status = h("div", { class: "sr", role: "status" });
    this.els.status = status;
    const counter = h("div", { class: "counter" }, drums, counterText, reset);
    const streets = h("p", { class: "streets-count", hidden: true });
    this.els.streets = streets;
    // « N filtres actifs en vue rue · Tout réafficher », at every zoom while filters set in
    // the street view are on (DECISIONS 2026-10-09): below it their keys are not shown.
    const streetActiveText = h("span", { class: "street-active-text" });
    this.els.streetActiveText = streetActiveText;
    const streetActive = h(
      "p",
      { class: "street-active", hidden: true },
      streetActiveText,
      h("span", { "aria-hidden": "true" }, " · "),
      this.resetLink(),
    );
    this.els.streetActive = streetActive;
    // On the map: the filters hide every camera or every filmed street of the view.
    const emptyText = h("span", { class: "filters-empty-text" });
    this.els.emptyText = emptyText;
    const empty = h(
      "div",
      { id: "filters-empty", class: "filters-empty", role: "status", hidden: true },
      emptyText,
      this.resetLink(),
    );
    this.els.empty = empty;
    document.body.append(empty);

    // Qui filme: four keys at the street level, two below it (all, public only: the
    // communes and départements hold those two sets only).
    const whoGrid = h("div", { class: "keys" });
    for (const op of ["pub", "pro", "pri", "unk"]) {
      const count = h("span", { class: "count" });
      const k = key(
        "key",
        "checkbox",
        "who",
        [
          h("span", { class: "key-check", "aria-hidden": "true" }, icon("check")),
          count,
          h("span", { class: "label" }, t(`filters.who.${op}`)),
        ],
        (on) => a.toggleOp(op, on),
      );
      k.count = count;
      k.root.dataset.op = op;
      this.who.set(op, k);
      whoGrid.append(k.root);
    }
    const whoLowGrid = h("div", { class: "keys" });
    for (const w of ["all", "pub"] as const) {
      const count = h("span", { class: "count" });
      const k = key(
        "key",
        "radio",
        "who-low",
        [
          h("span", { class: "key-check", "aria-hidden": "true" }, icon("check")),
          count,
          h(
            "span",
            { class: "label" },
            t(w === "all" ? "filters.who.all" : "filters.who.public_only"),
          ),
        ],
        (on) => {
          if (on) a.setPublicOnly(w === "pub");
        },
      );
      k.count = count;
      this.whoLow.set(w, k);
      whoLowGrid.append(k.root);
    }
    this.els.whoGrid = whoGrid;
    this.els.whoLowGrid = whoLowGrid;
    const who = h(
      "section",
      { class: "machine-section", "aria-labelledby": "machine-who" },
      h("h3", { id: "machine-who", class: "tag-title" }, t("legend.who")),
      whoGrid,
      whoLowGrid,
    );

    // Type de caméra: round buttons with the map's stickers and a count label.
    const kindRows = h("div", { class: "kinds" });
    const order: Kind[] = [
      "dome",
      "multidome",
      "fixed",
      "ptz",
      "panorama",
      "unknown",
      "alpr",
      "doorbell",
    ];
    for (const kind of order) {
      const sample = cameraCanvas(kind);
      sample.className = "sample";
      const count = h("span", { class: "count" });
      const k = key(
        "kind",
        "checkbox",
        "kind",
        [
          h("span", { class: "kind-disc", "aria-hidden": "true" }, sample),
          h("span", { class: "label" }, t(`filters.kind.${kind}`)),
          count,
        ],
        (on) => a.toggleKind(kind, on),
      );
      k.count = count;
      k.root.dataset.kind = kind;
      this.kinds.set(kind, k);
      kindRows.append(k.root);
    }
    const types = h(
      "section",
      { class: "machine-section street-only", "aria-labelledby": "machine-type" },
      h("h3", { id: "machine-type", class: "tag-title" }, t("legend.type")),
      kindRows,
    );
    this.els.types = types;

    // État de la fiche (20a): « maybe gone » and « pending correction », shown or hidden.
    const stateGrid = h("div", { class: "keys states" });
    for (const id of ["maybe_gone", "pending"] as const) {
      const k = key(
        "key state",
        "checkbox",
        "state",
        [
          h("span", { class: "key-check", "aria-hidden": "true" }, icon("check")),
          h("span", { class: `state-sample ${id}`, "aria-hidden": "true" }, h("span"), h("span")),
          h("span", { class: "label" }, t(`filters.state.${id}`)),
        ],
        (on) => a.toggleState(id, on),
      );
      k.root.dataset.state = id;
      this.states.set(id, k);
      stateGrid.append(k.root);
    }
    const states = h(
      "section",
      { class: "machine-section street-only", "aria-labelledby": "machine-state" },
      h("h3", { id: "machine-state", class: "tag-title" }, t("filters.state")),
      stateGrid,
    );
    this.els.states = states;
    const streetOnly = h("p", { class: "small", hidden: true }, t("filters.street_only"));
    this.els.streetOnly = streetOnly;

    // Plus de filtres: the drawer (a disclosure), chips grouped as 20a's.
    const summary = h(
      "summary",
      { class: "more" },
      h("span", { class: "more-text" }, t("filters.more")),
    );
    this.els.moreText = summary.firstChild as HTMLElement;
    const drawer = h("div", { class: "drawer" });
    const details = h("details", {}, summary, drawer);
    details.addEventListener("toggle", () => a.setAdvOpen(details.open));
    this.els.details = details;
    const advanced = h("div", { class: "advanced" }, details);
    this.els.drawer = drawer;
    const notes = h("div", { class: "notes" });
    this.els.notes = notes;

    const scroll = h(
      "div",
      { class: "machine-body" },
      streetActive,
      counter,
      status,
      streets,
      who,
      types,
      states,
      streetOnly,
      advanced,
      notes,
    );
    const close = h(
      "button",
      {
        type: "button",
        class: "panel-close machine-close",
        "aria-label": t("filters.close_machine"),
      },
      h("span", { "aria-hidden": "true" }, "×"),
    );
    close.addEventListener("click", () => {
      a.setOpened(false);
      this.fab.focus();
    });
    const paper = h(
      "div",
      { class: "machine-paper" },
      head,
      h("div", { class: "machine-rule", "aria-hidden": "true" }),
      scroll,
    );
    return h("div", { class: "machine-frame" }, deco, paper, close);
  }

  /** « Tout réafficher » as a link (the panel's line, the map's message): every filter off;
   * the link goes with what it said, so the keyboard focus goes to the counter's reset
   * while the machine is open, else to « Filtres et légende ». */
  private resetLink(): HTMLButtonElement {
    const b = h("button", { type: "button", class: "reset-link" }, t("filters.reset"));
    b.addEventListener("click", () => {
      const focused = document.activeElement === b;
      this.actions.reset();
      if (!focused) return;
      const open = document.body.classList.contains("machine-open");
      (open ? this.els.reset : this.fab).focus();
    });
    return b;
  }

  /** The drawer's groups and chips, once the rows are known (first render). */
  private buildDrawer(v: MachineView): void {
    const a = this.actions;
    const drawer = this.els.drawer;
    for (const group of v.groups) {
      const title = t(`adv.punk.${group === "who" ? "operator" : group}`);
      if (group === "who") {
        const input = h("input", {
          id: "adv-operator",
          type: "search",
          list: "adv-operators",
          placeholder: t("adv.operator_placeholder"),
        });
        input.addEventListener("input", () => a.setOperator(input.value));
        const list = h("datalist", { id: "adv-operators" });
        for (const name of v.operators) list.append(h("option", { value: name }));
        const count = h("span", { class: "count" });
        this.els.operator = input;
        this.els.operatorCount = count;
        const box = h(
          "div",
          { class: "adv-group operator" },
          h("label", { class: "adv-title", for: "adv-operator" }, title),
          h("div", { class: "row operator-row" }, input, count),
          list,
        );
        drawer.append(box);
        this.advGroups.set(group, box);
        continue;
      }
      const chips = h("div", { class: "chips-row" });
      for (const r of v.adv.filter((x) => x.group === group)) {
        const count = h("span", { class: "count" });
        const k = key(
          "chip-adv",
          "checkbox",
          "adv",
          [h("span", { class: "label" }, r.label), count],
          (on) => a.toggleAdv(r.id, on),
        );
        k.count = count;
        k.root.dataset.adv = r.id;
        this.chips.set(r.id, k);
        chips.append(k.root);
      }
      const box = h(
        "div",
        { class: "adv-group", role: "group", "aria-label": title },
        h("span", { class: "adv-title" }, title),
        chips,
      );
      drawer.append(box);
      this.advGroups.set(group, box);
    }
    drawer.append(h("p", { class: "small" }, t("adv.scope_short")));
  }

  /** Open or close the machine (filters.ts keeps the state: FilterPanel.opened). */
  setOpened(opened: boolean): void {
    document.body.classList.toggle("machine-open", opened);
    this.fab.setAttribute("aria-expanded", String(opened));
    if (opened) this.list.close(false);
    if (!opened && this.legendOpen) this.setLegend(false);
    this.place();
  }

  private setLegend(open: boolean): void {
    this.legendOpen = open;
    document.body.classList.toggle("machine-legend", open);
    const k = this.els.legendKey;
    k.setAttribute("aria-expanded", String(open));
    setText(k.firstChild as HTMLElement, t(open ? "filters.legend_hide" : "filters.legend_show"));
    setText(k.lastChild as HTMLElement, open ? "\u00a0↓" : "\u00a0↑");
    // The machine moves once the ticket has its new size.
    requestAnimationFrame(() => this.place());
  }

  /** « BOUM ! »: 20a's reset, a decoration that blocks nothing (the filters are already
   * reset), played once, none under reduced motion (theme/punk/machine.css). */
  private boom(button: HTMLElement): void {
    button.querySelector(".boom")?.remove();
    const b = h(
      "span",
      { class: "boom", "aria-hidden": "true" },
      h("span", { class: "boom-burst" }),
      h("span", { class: "boom-ring" }),
      h("span", { class: "boom-word" }, t("filters.boom")),
    );
    button.append(b);
    window.setTimeout(() => b.remove(), 1200);
  }

  /** Patch the machine and the ticket to the panel's state. */
  render(v: MachineView): void {
    if (!this.chips.size) this.buildDrawer(v);
    // A change of mode: the types' stickers drawn again in its inks (main.ts restyle).
    if (this.drawnMode !== mode()) {
      this.drawnMode = mode();
      for (const [kind, k] of this.kinds) {
        const sample = cameraCanvas(kind as Kind);
        sample.className = "sample";
        k.root.querySelector("canvas.sample")?.replaceWith(sample);
      }
    }
    // The link's text: « Filtres et légende (n) » while filters restrict, at every zoom.
    setText(this.els.fabText, v.active ? t("filters.open_n", { n: v.active }) : t("filters.open"));
    // Filters set in the street view, told at every zoom; what they hide whole, on the map.
    setHidden(this.els.streetActive, !v.streetActive);
    setText(this.els.streetActiveText, t("filters.street_active", { n: v.streetActive }));
    setHidden(this.els.empty, v.hiddenWhole === null);
    if (v.hiddenWhole) setText(this.els.emptyText, t(`filters.empty.${v.hiddenWhole}`));
    document.body.classList.toggle("street-level", v.street);

    // Counter: the drums show what is displayed.
    this.drumsTo(v.shown);
    const counter = this.els.counterText;
    const lines = v.approx
      ? [t("filters.counter.in_view", { n: v.shown }), t("filters.counter.approx")]
      : [t("filters.counter.shown", { n: v.shown }), t("filters.counter.of", { n: v.total })];
    if (counter.childElementCount !== 2) counter.replaceChildren(h("span"), h("span"));
    setText(counter.children[0], lines[0]);
    setText(counter.children[1], lines[1]);
    setText(this.els.status, t("filters.counter.status", { shown: v.shown, total: v.total }));
    this.els.reset.setAttribute("aria-disabled", String(!v.active));

    // Qui filme.
    setHidden(this.els.whoGrid, !v.street);
    setHidden(this.els.whoLowGrid, v.street);
    for (const o of v.ops) {
      const k = this.who.get(o.op);
      if (k) syncKey(k, o.on, String(o.n));
    }
    const approx = (n: number) => (v.approx ? `≈ ${n}` : String(n));
    syncKey(this.whoLow.get("all") as Key, !v.publicOnly, approx(v.pub.all));
    syncKey(this.whoLow.get("pub") as Key, v.publicOnly, approx(v.pub.pub));

    // Types (rows absent from the view hidden, unless unchecked), the sheets' state.
    setHidden(this.els.types, !v.street);
    setHidden(this.els.states, !v.street);
    setHidden(this.els.streetOnly, v.street);
    for (const k of v.kinds) {
      const key = this.kinds.get(k.kind);
      if (!key) continue;
      syncKey(key, k.on, String(k.n));
      setHidden(key.root, !k.n && k.on && document.activeElement !== key.input);
    }
    for (const s of v.states) syncKey(this.states.get(s.id) as Key, s.on);

    // The drawer.
    const details = this.els.details as HTMLDetailsElement;
    setText(
      this.els.moreText,
      v.advActive ? t("filters.more_n", { n: v.advActive }) : t("filters.more"),
    );
    for (const r of v.adv) {
      const k = this.chips.get(r.id);
      if (!k) continue;
      syncKey(k, r.on, r.n === null ? "—" : String(r.n));
      // Capabilities absent from the view are not listed (unless active), as today.
      setHidden(
        k.root,
        r.group === "can" && v.street && !r.n && !r.on && document.activeElement !== k.input,
      );
    }
    const op = this.els.operator as HTMLInputElement;
    if (document.activeElement !== op && op.value !== v.operatorQuery) op.value = v.operatorQuery;
    setText(this.els.operatorCount, v.operatorCount);
    if (details.dataset.init !== "1") {
      details.dataset.init = "1";
      details.open = v.advActive > 0;
    }

    // Notes and the streets' line.
    const streets = v.notes.find((n) => n.cls === "streets-count");
    setHidden(this.els.streets, !streets);
    if (streets) setText(this.els.streets, streets.text);
    const others = v.notes.filter((n) => n.cls !== "streets-count");
    const notes = this.els.notes;
    const want = others.map((n) => `${n.cls}|${n.text}`).join("\n");
    if (notes.dataset.key !== want) {
      notes.dataset.key = want;
      notes.replaceChildren(...others.map((n) => h("p", { class: `small ${n.cls}` }, n.text)));
    }

    this.renderLegend(v);
  }

  /** Each drum rolls to its digit (20a's counter); as many drums as digits, two at least. */
  private drumsTo(n: number): void {
    if (n === this.shown) return;
    this.shown = n;
    const digits = String(Math.max(0, n)).padStart(2, "0");
    const drums = this.els.drums;
    while (this.drums.length < digits.length) {
      const roll = h("span", { class: "drum-roll" });
      for (let d = 0; d <= 9; d++) roll.append(h("span", {}, String(d)));
      const drum = h("span", { class: "drum" }, roll);
      this.drums.unshift(drum);
      drums.prepend(drum);
    }
    while (this.drums.length > digits.length) this.drums.shift()?.remove();
    [...digits].forEach((d, i) => {
      (this.drums[i].firstChild as HTMLElement).style.setProperty("--digit", d);
    });
  }

  /** The legend the ticket prints, for what the map draws at this zoom; drawn again only
   * when that changes (the « Calcul ? » text with it). */
  private renderLegend(v: MachineView): void {
    const l = v.legend;
    const want =
      JSON.stringify(l) +
      v.estimateName +
      v.ground +
      palette().field +
      palette().fieldLine +
      palette().level.join();
    if (want === this.legendKey) return;
    this.legendKey = want;
    const body = this.legendBody;
    const parts: HTMLElement[] = [];
    const swatch = (colour: string, cls = "") => {
      const s = h("span", { class: `sw ${cls}`, "aria-hidden": "true" });
      if (colour) s.style.background = colour;
      return s;
    };
    if (l.kind === "areas") {
      parts.push(h("p", { class: "legend-line" }, l.title));
      const dl = h("ul", { class: "legend-areas" });
      for (const s of l.swatches) dl.append(h("li", {}, swatch(s.colour), s.label));
      dl.append(h("li", {}, swatch("", "hatch"), t("legend.none")));
      parts.push(dl);
    } else {
      parts.push(
        h("p", { class: "legend-line" }, t("legend.ticket.street", { est: v.estimateName })),
      );
      // Each level: below the street level 20a's swatch in its street colour beside its
      // name; where the fields are drawn (z15+), the level's
      // sample alone, its halftone and its outline as the map draws them: exactly these
      // three samples (DECISIONS 2026-10-08, « One palette… »).
      const levels = h("dl", { class: "legend-levels" });
      const p = palette();
      for (const lv of [3, 2, 1] as const) {
        const name = h(
          "span",
          { class: "level-name" },
          ...(l.street ? [] : [swatch(p.level[lv - 1], `level lv${lv}`)]),
          t(`legend.street.${lv}`),
        );
        let sample: HTMLCanvasElement | null = null;
        if (l.street) {
          // 28 CSS px at the pictograms' ratio (2).
          sample = levelCanvas(lv, 56, v.ground);
          sample.className = "sample level";
          sample.setAttribute("aria-hidden", "true");
        }
        levels.append(h("div", {}, h("dt", {}, sample, name)));
      }
      parts.push(levels, h("div", { class: "legend-rule", "aria-hidden": "true" }));
      const items = h("ul", { class: "legend-items" });
      items.append(
        h(
          "li",
          {},
          swatch(l.unfilmed ? p.streetNone : "", l.unfilmed ? "street" : "street none"),
          l.unfilmed ? t("legend.ticket.unfilmed") : t("legend.ticket.only_filmed"),
        ),
      );
      if (l.street) {
        // No « direction inconnue »: punk leaves no trace of it on the map (DECISIONS
        // 2026-10-08, « Unknown direction leaves no trace… »).
        const gone = cameraCanvas("dome", palette().gone);
        gone.className = "sample gone";
        items.append(
          h(
            "li",
            { class: "wide" },
            h("span", { class: "mark field", "aria-hidden": "true" }, h("span")),
            t("legend.ticket.field"),
          ),
          h(
            "li",
            {},
            h("span", { class: "mark maybe", "aria-hidden": "true" }, h("span"), h("span")),
            t("legend.ticket.maybe_gone"),
          ),
          h("li", {}, h("span", { class: "mark gone" }, gone), t("legend.ticket.gone")),
          h(
            "li",
            {},
            h("span", { class: "mark pending", "aria-hidden": "true" }, h("span"), h("span")),
            t("legend.ticket.pending"),
          ),
          h(
            "li",
            {},
            h("span", { class: "mark ghost", "aria-hidden": "true" }, h("span"), h("span")),
            t("legend.ticket.ghost"),
          ),
        );
      }
      parts.push(items);
    }
    body.replaceChildren(...parts);
    // « Calcul ? »: what the chosen hypothesis means, the levels' norm, the classes.
    const calc = [v.estimateSub, l.kind === "areas" ? t("legend.fixed_classes") : t("legend.norm")];
    this.calc.replaceChildren(...calc.map((s) => h("p", {}, s)));
    requestAnimationFrame(() => this.place());
  }

  /** Below the estimate bar's pastilles: the ✓ of the chosen one (20a, 17a). */
  estimateBar(bar: HTMLElement): void {
    for (const b of bar.querySelectorAll("button")) {
      if (b.querySelector(".pastille-check")) continue;
      b.prepend(h("span", { class: "pastille-check", "aria-hidden": "true" }, icon("check")));
    }
  }
}

// --- the list of cameras ----------------------------------------------------------------

/** A camera in view, as the list shows it. */
export type ListedCamera = { id: string; kind: Kind; label: string; distance: number };

/** « Liste des caméras » (17a's map side): the cameras in view that the filters keep, each a
 * button opening its sheet; the map's alternative for screen readers and keyboards. Below
 * the street level no camera is loaded: it says so and offers to zoom in. */
export class CameraList {
  readonly opener: HTMLButtonElement;
  private panel: HTMLElement;
  private items: HTMLElement;
  private count: HTMLElement;
  private zoom: HTMLElement;
  private more: HTMLElement;
  private key = "";
  opened = false;

  constructor(
    map: MlMap,
    private cameras: () => ListedCamera[] | null,
    private open: (id: string) => void,
    private zoomIn: () => void,
    private onOpen: () => void,
  ) {
    this.opener = h(
      "button",
      {
        type: "button",
        id: "list-open",
        class: "ticket-link",
        "aria-expanded": "false",
        "aria-controls": "camlist",
      },
      h("span", { class: "ticket-link-text" }, t("list.title")),
      icon("right"),
    );
    this.opener.addEventListener("click", () => (this.opened ? this.close(true) : this.show()));
    this.count = h("p", { class: "camlist-count" });
    this.items = h("ol", { class: "camlist-items" });
    const zoomBtn = h("button", { type: "button", class: "camlist-zoom" }, t("list.zoom_here"));
    zoomBtn.addEventListener("click", () => this.zoomIn());
    this.zoom = h(
      "div",
      { class: "camlist-zoom-box", hidden: true },
      h("p", {}, t("list.zoom")),
      zoomBtn,
    );
    this.more = h("p", { class: "small camlist-more", hidden: true });
    const close = h(
      "button",
      { type: "button", class: "panel-close camlist-close", "aria-label": t("list.close") },
      h("span", { "aria-hidden": "true" }, "×"),
    );
    close.addEventListener("click", () => this.close(true));
    this.panel = h(
      "aside",
      { id: "camlist", class: "camlist", "aria-labelledby": "camlist-title", hidden: true },
      h(
        "div",
        { class: "camlist-paper" },
        h(
          "div",
          { class: "camlist-head" },
          h("h2", { id: "camlist-title", class: "camlist-title" }, t("list.title")),
          close,
        ),
        this.count,
        this.zoom,
        this.items,
        this.more,
      ),
    );
    document.body.append(this.panel);
    this.panel.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        this.close(true);
      }
    });
    map.on("idle", () => {
      if (this.opened) this.render();
    });
  }

  show(): void {
    this.onOpen();
    this.opened = true;
    this.panel.hidden = false;
    document.body.classList.add("list-open");
    this.opener.setAttribute("aria-expanded", "true");
    this.render();
    (this.panel.querySelector("h2") as HTMLElement).tabIndex = -1;
    (this.panel.querySelector("h2") as HTMLElement).focus();
  }

  close(refocus: boolean): void {
    if (!this.opened) return;
    this.opened = false;
    this.panel.hidden = true;
    document.body.classList.remove("list-open");
    this.opener.setAttribute("aria-expanded", "false");
    if (refocus) this.opener.focus();
  }

  /** The list for the view, drawn again only when it changes (keeps the focus). */
  render(): void {
    const all = this.cameras();
    const MAX = 60;
    const key = `${mode()}|${all ? all.map((c) => `${c.id}:${c.label}`).join("|") : "zoom"}`;
    if (key === this.key) return;
    this.key = key;
    this.zoom.hidden = all !== null;
    this.count.hidden = all === null;
    this.more.hidden = !all || all.length <= MAX;
    if (!all) {
      this.items.replaceChildren();
      return;
    }
    this.count.textContent = `${t("list.count", { n: all.length })} (${t("list.filtered")})`;
    if (all.length > MAX) this.more.textContent = t("list.more", { n: all.length - MAX });
    const focused = document.activeElement?.closest<HTMLElement>("[data-cam]")?.dataset.cam;
    this.items.replaceChildren(
      ...all.slice(0, MAX).map((c) => {
        const pic = cameraCanvas(c.kind);
        pic.className = "camlist-pic";
        pic.setAttribute("aria-hidden", "true");
        const b = h(
          "button",
          { type: "button", class: "camlist-item", "data-cam": c.id },
          pic,
          h("span", { class: "camlist-label" }, c.label),
          h("span", { class: "camlist-dist" }, t("list.distance", { m: c.distance })),
        );
        b.addEventListener("click", () => this.open(c.id));
        return h("li", {}, b);
      }),
    );
    if (focused) this.items.querySelector<HTMLElement>(`[data-cam="${focused}"]`)?.focus();
  }
}
