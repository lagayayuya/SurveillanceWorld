// The punk commune and département sheets, board 12 · Fiches de la carte (v3), ported from its
// mockups (Carte3-Commune, Carte3-Departement): the title in cut-out letters and its line, one
// column without tabs. A commune: three figures (cameras on the map, per 1 000 inhabitants with
// its rank in its intercommunality, streets within reach), « À portée d'une caméra » with the
// 100 m street drawn and « Voir ces rues sur la carte », the « manque » block (gap.ts), « Qui
// filme ? » folded, the two doors (drones in 3D, the register). A département: three figures,
// « Où sont-elles ? » (its communes with the most cameras, each opening its sheet), the same
// block and doors. Y, the share of streets within reach (cautious hypothesis, every camera,
// direction ignored), is always a maximum, rounded down (DECISIONS 2026-10-06, 2026-10-08). The
// register's figures come from the département's file (placedata.ts); what it does not serve is
// written « non lu ». A chunk the punk interface alone downloads (area.ts); its paper is the
// camera sheet's (theme/punk/sheet.css), its own rules theme/punk/area.css.
import { cutout, fitTitle, pinHead } from "./chips";
import { type Etat, gapBlock, nb } from "./gap";
import { t } from "./i18n";
import {
  aCommune,
  actesCam,
  autOf,
  type DepFile,
  depNow,
  depuis,
  epciNom,
  etatCam,
  euros,
  isArrondissement,
  isMetropole,
  loadDep,
  parentCommune,
  per1000,
  rankInEpci,
  tenth,
  tops,
} from "./placedata";

type Props = Record<string, string | number | undefined>;

export type PunkAreaInput = {
  p: Props;
  /** « Commune · Hauts-de-Seine (92) » (area.ts areaLine). */
  line: string;
  departement: boolean;
  /** The map's « Qui filme » when the sheet opens: « Toutes / Publiques » starts on that set. */
  publicOnly: boolean;
  parts: { grab: HTMLElement; close: HTMLElement; share: HTMLElement };
  /** The map's sticker of a camera type (16a), in the mode in force (icons.ts cameraCanvas). */
  sticker: (kind: string) => HTMLCanvasElement;
  /** « + Ajouter une caméra »: the map's add (main.ts). */
  onAdd?: () => void;
  /** « Voir ces rues sur la carte »: the commune framed at a zoom where its streets are drawn. */
  onStreets?: (publicOnly: boolean) => void;
  /** A commune of « Où sont-elles ? »: its sheet, the map centred on it. */
  onCommune?: (insee: string) => void;
};

const TOP_OPERATORS = 5; // pipeline/lacarte/admin.py TOP_OPERATORS: the names the tiles keep
// The operator classes (`n_pub`…, the map's « Qui filme »).
const CLASSES = ["pub", "pro", "pri", "unk"] as const;
/** The farthest a figure's fraction may fall below Y (points); farther, the percentage. */
const SHARE_GAP = 2;
/** « Où sont-elles ? »: the board's six communes. */
const TOPS = 6;

function el(tag: string, cls = "", text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
/** Seen, not said. */
const drawn = (text: string, cls = "") => {
  const e = el("span", cls, text);
  e.setAttribute("aria-hidden", "true");
  return e;
};
const nonLu = () => el("span", "nl", t("gap.non_lu"));

const num = (p: Props, key: string) => Number(p[key] ?? 0);
/** Rounded up, to the tenth: the metres that may be filmed (with those out of reach rounded
 * down, the two make 100 m). */
const up = (v: number) => Math.max(0, Math.ceil(v * 10 - 1e-9) / 10);
/** Rounded down, to the tenth. */
const down = (v: number) => Math.max(0, Math.floor(v * 10 + 1e-9) / 10);

export type Share = { form: "none" } | { form: "one_in" | "n_in_ten" | "pct"; n: number };
/** Y (%) as the figure says it, rounded down, never above Y: the nearest of « 1 sur N » and
 * « N sur 10 » below it (Y = 51,4 %: « 5 sur 10 »; 27 %: « 1 sur 4 »); when that fraction falls
 * more than SHARE_GAP points below Y, the percentage rounded down to the unit instead (58 %:
 * « 5 sur 10 » would say 8 points less, so « 57 % »); « Aucune » at 0. */
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

/** The figure's value: « 1 sur 5 », « 57 % », « Aucune ». */
function shareValue(y: number): string {
  const s = streetShare(y);
  if (s.form === "none") return t("area.punk.none");
  return t(`area.punk.${s.form}`, { n: s.n });
}

/** One of the three figures: its value (a count, « non lu ») and its words. */
function figure(value: string | HTMLElement, words: string, extra?: HTMLElement): HTMLElement {
  const box = el("div");
  const b = el("b");
  b.append(value);
  const span = el("span", "", words);
  if (extra) span.append(" ", extra);
  box.append(b, span);
  return box;
}

function panelHead(title: string, extra?: HTMLElement): HTMLElement {
  const head = el("div", "area-panel-head");
  head.append(el("h3", "area-label", title));
  if (extra) head.append(extra);
  return head;
}

const SVG = "http://www.w3.org/2000/svg";
function svg(tag: string, attrs: Record<string, string | number>): SVGElement {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

/** The board's 100 m street: the metres within reach as two stretches under two cameras (where
 * the board draws them, moved in when longer), the rest empty, a scale every 25 m. */
export function streetSvg(on: number, off: number): SVGElement {
  const W = 360;
  const px = (m: number) => Math.round(((m * W) / 100) * 10) / 10;
  const s = svg("svg", { viewBox: `0 0 ${W} 84`, role: "img", class: "street100" });
  s.setAttribute("aria-label", t("area.v3.street.svg", { on: nb(on), off: nb(off) }));
  s.append(
    svg("rect", { class: "road", x: 0, y: 34, width: W, height: 26 }),
    svg("line", { class: "mid", x1: 0, y1: 47, x2: W, y2: 47 }),
  );
  const half = on / 2;
  if (on > 0) {
    const starts = [Math.max(0, Math.min(9, 50 - half)), Math.max(50, Math.min(61, 100 - half))];
    for (const a of starts)
      s.append(
        svg("rect", { class: "on", x: px(a), y: 34, width: px(a + half) - px(a), height: 26 }),
      );
    for (const a of starts) {
      const cx = px(a + half / 2);
      s.append(
        svg("path", { class: "cone", d: `M${cx} 26 L${px(a)} 34 L${px(a + half)} 34 Z` }),
        svg("circle", { class: "cam", cx, cy: 18, r: 9 }),
        svg("rect", { class: "lens", x: cx - 4, y: 15, width: 8, height: 5 }),
      );
    }
  }
  for (const m of [0, 25, 50, 75, 100]) {
    const text = svg("text", {
      class: "scale",
      x: px(m),
      y: 78,
      "text-anchor": m === 0 ? "start" : m === 100 ? "end" : "middle",
    });
    text.textContent = m === 0 || m === 100 ? t("sheet.m", { v: m }) : String(m);
    s.append(text);
  }
  return s;
}

/** « À portée d'une caméra »: « Toutes / Publiques », the 100 m street, its two rows, what
 * « à portée » means, « Voir ces rues sur la carte ». */
function streets(input: PunkAreaInput, pub: boolean, setPub: (v: boolean) => void): HTMLElement {
  const { p } = input;
  const box = el("section", "street");
  box.setAttribute("aria-label", t("area.v3.street.title"));
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

  const rows = el("ul", "rows");
  const row = (cls: string, m: number, key: string, km: number) => {
    const li = el("li");
    li.append(
      drawn("", `sw ${cls}`),
      el("b", "", t("sheet.m", { v: m })),
      el("span", "", t(key)),
      el("i", "", t("area.punk.km", { v: km })),
    );
    return li;
  };
  rows.append(
    row("on", max, "area.v3.street.on", maxKm),
    row("off", off, "area.v3.street.off", offKm),
  );
  box.append(
    panelHead(t("area.v3.street.title"), group),
    el("p", "lead-t", t("area.v3.street.lead")),
    streetSvg(max, off),
    rows,
  );
  if (num(p, pub ? "n_pub" : "n") === 0 && y > 0)
    box.append(el("p", "fine", t("area.punk.neighbours")));
  box.append(el("p", "fine", t("area.v3.street.fine")));
  if (input.onStreets) {
    const go = el("button", "sheet-link go", t("area.v3.street.go"));
    go.setAttribute("type", "button");
    go.addEventListener("click", () => input.onStreets?.(pub));
    box.append(go);
  }
  return box;
}

/** One row of a counted list: label, dotted leader, count. */
function countRow(label: string, count: number): HTMLElement {
  const li = el("li");
  li.append(el("span", "", label), drawn("", "area-leader"));
  li.append(el("b", "area-count", String(count)));
  return li;
}

/** « Qui filme ? »'s fold: the named operators by cameras, those without a name apart, then
 * every camera by operator class, as the map's « Qui filme » counts them. */
function whoBody(p: Props): HTMLElement[] {
  const n = num(p, "n");
  const ops: [string, number][] = p.ops ? JSON.parse(String(p.ops)) : [];
  const classes = el("ul", "area-list area-classes");
  for (const cls of CLASSES)
    classes.append(countRow(t(`area.punk.class.${cls}`), num(p, `n_${cls}`)));
  const byClass = [el("p", "area-sub area-classes-head", t("area.punk.who.classes")), classes];
  if (!ops.length) return [el("p", "area-empty", t("area.no_operator")), ...byClass];
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
  return [list, ...byClass];
}

/** A fold: a button[aria-expanded] that shows its body below (RGAA: the state said). */
function fold(id: string, title: string, v: string, k: string, body: HTMLElement[], open: boolean) {
  const b = el("button", `acc${open ? " open" : ""}`);
  b.setAttribute("type", "button");
  b.setAttribute("aria-expanded", String(open));
  b.setAttribute("aria-controls", id);
  b.dataset.fold = id;
  const words = el("span", "t");
  words.append(el("span", "v", v), el("span", "k", k));
  const sign = drawn(open ? "−" : "+", "sg");
  b.append(el("span", "area-label", title), words, sign);
  const box = el("div", "acc-body");
  box.id = id;
  box.hidden = !open;
  box.append(...body);
  b.addEventListener("click", () => {
    const now = b.getAttribute("aria-expanded") !== "true";
    b.setAttribute("aria-expanded", String(now));
    b.classList.toggle("open", now);
    sign.textContent = now ? "−" : "+";
    box.hidden = !now;
  });
  return [b, box];
}

/** A door: a link styled as the board's ticket, its value, its words, its arrow. */
function door(href: string, v: string, k: string, drones = false): HTMLAnchorElement {
  const a = el("a", `rdoor${drones ? " dr" : ""}`) as HTMLAnchorElement;
  a.href = href;
  const words = el("span", "t");
  words.append(el("span", "v", v), el("span", "k", k));
  a.append(words, drawn("→", "go"));
  return a;
}

/** « Calcul ? » and what it opens. */
function how(p: Props): [HTMLElement, HTMLElement] {
  const toggle = el("button", "how-toggle sheet-link", t("sheet.punk.how"));
  toggle.setAttribute("type", "button");
  const said = el("span", "sheet-sr", ` ${t("sheet.punk.how.said")}`);
  toggle.append(said);
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
    t("area.punk.how.who"),
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

/** The commune's line: the tiles' (« Commune · Rhône (69) »), its intercommunality and its
 * population when the register lists them. */
function communeLine(input: PunkAreaInput, dep: DepFile | null): string {
  const code = String(input.p.c);
  let line = input.line;
  if (!dep) return line;
  const nom = epciNom(dep, parentCommune(code));
  if (nom) line = t("area.v3.line_epci", { line, epci: nom });
  const pop = dep.communes[code]?.pop;
  if (pop) line = t("area.v3.line_pop", { line, pop: nb(pop) });
  return line;
}

/** « Lyon dans le registre : 447 arrêtés de caméras → ». */
function registreLink(nom: string, n: number | undefined, href: string, dep = false) {
  return {
    href,
    label:
      n === undefined
        ? t("gap.registre_commune_nl", { nom })
        : t(dep ? "gap.registre_dep" : "gap.registre_commune", { nom, n }),
  };
}

/** The commune's body. A municipal arrondissement is its own on the map (cameras, streets,
 * operators) and its commune's in the register (the « manque » block, the doors). */
function communeBody(
  input: PunkAreaInput,
  dep: DepFile | null,
  state: { pub: boolean; folds: Set<string> },
  redraw: () => void,
): HTMLElement[] {
  const { p } = input;
  const code = String(p.c);
  const unit = parentCommune(code);
  const parentNom = isArrondissement(code)
    ? (dep?.communes[unit]?.nom ?? String(p.nm).replace(/ \d+(er|e) Arrondissement$/i, ""))
    : String(p.nm);
  const n = num(p, "n");
  const stats = dep?.stats.communes[unit];
  // Paris, Lyon or Marseille opened from a département's list: the register's commune, which
  // the tiles split into arrondissements (main.ts openAreaByCode); no street nor operator here.
  const parent = Number(p.parent) === 1;

  // The three figures.
  const kf = el("div", "kf3");
  const pop = dep?.communes[code]?.pop;
  const ratio = per1000(n, pop);
  const rank = dep && ratio !== null ? rankInEpci(dep, code, n) : null;
  let rankEm: HTMLElement | undefined;
  if (rank) {
    // « · 5e sur 51 de l'intercommunalité », its ordinal's letters raised.
    rankEm = el("em", "", `· ${rank.r}`);
    rankEm.append(
      el("sup", "", t(rank.r === 1 ? "area.v3.kf.rank_er" : "area.v3.kf.rank_e")),
      ` ${t(dep && isMetropole(dep, code) ? "area.v3.kf.rank_metropole" : "area.v3.kf.rank", { n: rank.sur })}`,
    );
  }
  const y = num(p, state.pub ? "hi_pub" : "hi");
  kf.append(
    figure(nb(n), t("area.v3.kf.cameras", { n })),
    figure(ratio === null ? nonLu() : tenth(ratio), t("area.v3.kf.per1000"), rankEm),
    parent
      ? figure(nonLu(), t("area.v3.kf.streets"))
      : figure(shareValue(y), t(y > 0 ? "area.v3.kf.streets" : "area.v3.kf.streets_none")),
  );

  const setPub = (v: boolean) => {
    state.pub = v;
    redraw();
    document
      .querySelector<HTMLElement>(`#sheet .area-toggle[data-set="${v ? "public" : "all"}"]`)
      ?.focus();
  };

  // The « manque » block: the commune's (an arrondissement's commune in the register: its map
  // count is the register's, its split unknown here).
  const own = unit === code && !parent;
  const carte = own || parent ? n : (stats?.carte ?? null);
  const gap = gapBlock({
    lieu: aCommune(parentNom),
    carte,
    publiques: own ? num(p, "n_pub") : null,
    autres: own ? n - num(p, "n_pub") : null,
    aut: autOf(stats?.cam_aut),
    etat: etatCam(dep, unit),
    onAdd: input.onAdd,
    registre: stats
      ? registreLink(parentNom, actesCam(dep, unit), `/registre/commune/${unit}`)
      : null,
  });

  // « Qui filme ? », folded.
  const ops: [string, number][] = p.ops ? JSON.parse(String(p.ops)) : [];
  const [whoButton, whoBox] = fold(
    "area-who",
    t("area.punk.who.title"),
    ops.length ? ops[0][0] : t("area.punk.none"),
    ops.length ? t("area.v3.who.top") : t("area.v3.who.none"),
    whoBody(p),
    state.folds.has("area-who"),
  );
  whoButton.addEventListener("click", () => {
    if (state.folds.has("area-who")) state.folds.delete("area-who");
    else state.folds.add("area-who");
  });

  if (parent) {
    const box = el("section", "street");
    box.setAttribute("aria-label", t("area.v3.street.title"));
    box.append(panelHead(t("area.v3.street.title")), el("p", "fine", t("area.v3.street.parent")));
    const out = [kf, box, gap];
    const doors = communeDoors(dep, unit);
    if (doors) out.push(doors);
    return out;
  }
  const out = [kf, streets(input, state.pub, setPub), gap, whoButton, whoBox];
  const doors = communeDoors(dep, unit);
  if (doors) out.push(doors);
  return out;
}

/** The two doors: the commune's drones in 3D, its page in the register. */
function communeDoors(dep: DepFile | null, unit: string): HTMLElement | null {
  const s = dep?.stats.communes[unit];
  if (!s) return null;
  const box = el("div", "doors");
  const drEtat: Etat = (s.couverture_actes?.dr as Etat | undefined) ?? "non_lu";
  const dr = s.dr ?? 0;
  box.append(
    door(
      `/registre/commune/${unit}/carte`,
      dr === 0 && drEtat !== "lu"
        ? t("area.v3.door.drones_nl")
        : t("area.v3.door.drones", { n: dr }),
      t("area.v3.door.drones_k"),
      true,
    ),
    door(
      `/registre/commune/${unit}`,
      t("area.v3.door.registre"),
      actesCam(dep, unit) === undefined
        ? t("area.v3.door.registre_k_nl")
        : t("area.v3.door.registre_k", { eur: euros(s.montant ?? 0), n: actesCam(dep, unit) ?? 0 }),
    ),
  );
  return box;
}

/** The département's body. */
function departementBody(input: PunkAreaInput, dep: DepFile | null): HTMLElement[] {
  const { p } = input;
  const code = String(p.c);
  const n = num(p, "n");
  const ds = dep?.stats.depStats;
  const an = dep ? depuis(dep) : null;

  const kf = el("div", "kf3");
  const ratio = per1000(n, dep?.departement.pop);
  const camLu = dep && an !== null && ds?.cam !== undefined;
  const drC = ds?.dr_commune ?? 0;
  const drA = ds?.dr_autorite ?? 0;
  // A département not collected (no year of collection) has no drone count to say: « non lu ».
  const drLu = ds !== undefined && (drC > 0 || drA > 0 || an !== null);
  kf.append(
    figure(
      nb(n),
      t("area.v3.kf.dep_cameras"),
      ratio === null ? undefined : el("em", "", t("area.v3.kf.dep_per1000", { v: tenth(ratio) })),
    ),
    camLu
      ? figure(nb(ds.cam ?? 0), t("area.v3.kf.dep_actes_depuis", { n: ds.cam ?? 0, an: an ?? "" }))
      : figure(nonLu(), t("area.v3.kf.dep_actes")),
    !drLu
      ? figure(nonLu(), t("area.v3.kf.dep_drones", { n: 2 }))
      : drC > 0
        ? figure(nb(drC), t("area.v3.kf.dep_drones", { n: drC }))
        : figure(nb(drA), t("area.v3.kf.dep_drones_autorite", { n: drA })),
  );

  const out: HTMLElement[] = [kf];
  // « Où sont-elles ? »
  if (dep) {
    const box = el("section", "street");
    box.setAttribute("aria-label", t("area.v3.tops.label"));
    box.append(panelHead(t("area.v3.tops.title"), el("span", "area-sub", t("area.v3.tops.sub"))));
    const top = tops(dep, TOPS);
    if (top.rows.length) {
      const headRow = el("div", "tops-head");
      headRow.setAttribute("aria-hidden", "true");
      headRow.append(
        el("span", "", t("area.v3.tops.commune")),
        el("span"),
        el("span", "", t("area.v3.tops.cameras")),
        el("span", "", t("area.v3.tops.per1000")),
      );
      const list = el("ul", "tops");
      const first = top.rows[0].carte;
      for (const r of top.rows) {
        const li = el("li");
        const a = el("a", "", r.nom) as HTMLAnchorElement;
        a.href = `/?insee=${r.insee}`;
        a.setAttribute("aria-label", t("area.v3.tops.open", { nom: r.nom, n: nb(r.carte) }));
        a.addEventListener("click", (e) => {
          if (!input.onCommune || e.metaKey || e.ctrlKey || e.shiftKey) return;
          e.preventDefault();
          input.onCommune(r.insee);
        });
        const track = drawn("");
        const b = el("span", "tb");
        b.style.width = `${Math.max(2, Math.round((100 * r.carte) / first))}%`;
        track.append(b);
        // The board's count and ratio, seen only: the link says them.
        const count = el("b", "", nb(r.carte));
        const ratio = el("i", "", r.per1000 === null ? "—" : tenth(r.per1000));
        for (const x of [count, ratio]) x.setAttribute("aria-hidden", "true");
        li.append(a, track, count, ratio);
        list.append(li);
      }
      box.append(headRow, list);
      if (top.total > 0)
        box.append(
          el(
            "p",
            "fine",
            t("area.v3.tops.fine", {
              nom: top.rows[0].nom,
              pct: Math.round((100 * first) / top.total),
            }),
          ),
        );
    } else box.append(el("p", "fine", t("area.v3.tops.empty")));
    const all = el(
      "a",
      "sheet-link go",
      t("area.v3.tops.all", { n: top.communes }),
    ) as HTMLAnchorElement;
    all.href = `/registre/communes?dep=${encodeURIComponent(code)}`;
    box.append(all);
    out.push(box);
  }

  const nom = dep?.departement.nom ?? String(p.nm);
  out.push(
    gapBlock({
      lieu: nom,
      carte: n,
      publiques: num(p, "n_pub"),
      autres: n - num(p, "n_pub"),
      aut: autOf(ds?.cam_aut),
      // The département's own reading of its acts, once served with `cam_aut`; until then the
      // sum is never the whole (acts without a commune: depStats.sansCommune).
      etat: "partiel",
      onAdd: input.onAdd,
      registre: dep
        ? registreLink(nom, camLu ? ds?.cam : undefined, `/registre/departement/${code}`, true)
        : null,
    }),
  );
  if (dep && ds) {
    const box = el("div", "doors");
    const drN = drC > 0 ? drC : drA;
    box.append(
      door(
        `/registre/departement/${code}`,
        drLu ? t("area.v3.door.drones", { n: drN }) : t("area.v3.door.drones_nl"),
        t("area.v3.door.drones_k"),
        true,
      ),
      door(
        `/registre/departement/${code}`,
        t("area.v3.door.registre"),
        ds.con === undefined
          ? t("area.v3.door.registre_k_nl")
          : t("area.v3.door.registre_k_dep", { eur: euros(ds.montant ?? 0), n: ds.con }),
      ),
    );
    out.push(box);
  }
  return out;
}

/** The sheet. Drawn at once from the tiles, then again when the département's file is in
 * (the frame kept, the folds and « Toutes / Publiques » as they were, the scroll too). */
export function punkAreaSheet(frame: HTMLElement, input: PunkAreaInput): void {
  const { p, parts } = input;
  const depCode = String(p.d);
  const state = { pub: input.publicOnly, folds: new Set<string>() };
  frame.replaceChildren();
  const paper = el("div", "sheet-paper area-paper");
  const top = el("div", "sheet-top");
  const body = el("div", "sheet-body");

  const head = el("div", "sheet-head");
  const column = el("div", "sheet-title");
  // Its letters may wrap after a hyphen (« HAUTS-DE-SEINE » is wider than the paper).
  const title = cutout(String(p.nm), String(p.nm).replace(/-/g, "- "));
  title.querySelector(".sheet-sr")?.classList.add("area-name");
  const line = el("p", "area-line", input.line);
  column.append(title, line);
  parts.close.replaceChildren(drawn("×"));
  parts.grab.replaceChildren();
  head.append(column, parts.grab, parts.close);
  top.append(head);

  const [toggle, explained] = how(p);
  parts.share.classList.add("sheet-link");
  const foot = el("div", "sheet-foot");
  foot.append(parts.share, toggle);

  const draw = () => {
    const dep = depNow(depCode) ?? null;
    line.textContent = input.departement
      ? dep?.departement.pop
        ? t("area.v3.line_dep", {
            code: depCode,
            pop: nb(dep.departement.pop),
            n: tops(dep).communes,
          })
        : input.line
      : communeLine(input, dep);
    const scroller = paper.scrollTop;
    body.replaceChildren(
      ...(input.departement ? departementBody(input, dep) : communeBody(input, dep, state, draw)),
      foot,
      explained,
    );
    paper.scrollTop = scroller;
  };
  draw();
  paper.append(top, body);
  const edge = el("div", "sheet-frame");
  edge.append(paper);
  frame.append(edge);
  fitTitle(title);
  pinHead(frame, paper);
  if (depNow(depCode) === undefined)
    void loadDep(depCode).then(() => {
      if (paper.isConnected) draw();
    });
}
