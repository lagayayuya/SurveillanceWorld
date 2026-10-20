// « Mes caméras » (lot U, 2026-10-18), the account's private collection, a section of the
// account's screen (26a's leaderboard, profile/leaderboard.ts) unfolded as its « Comment on
// compte ? ↓ » is: on 25b's grid paper (theme/punk/profile.css .profile-panel), 25b's line
// of numbers (« 7 caméras · 3 communes »), the collection by kind (the map's stickers, each
// with its count: no board draws it), a little map of where they stand (a static drawing,
// see miniMap: no board either), then 25b's cameras grouped by commune, each a button to
// its sheet over its journal (month, what it changed in the cameras' history's words,
// where it stands: « en attente », « acceptée », « sur la carte », « publiée sur OSM »,
// « refusée »). GET /api/me/contributions is asked when the section unfolds, once per
// opening of the screen; nothing is drawn before. A tap on a camera closes the screen and
// opens the camera on the map (ProfileContext.openCamera: its sheet, or a pending add's),
// « ← Mes caméras » at the top of that sheet to come back; an add the review refused has no
// camera to open, its row is no button. No points of its own: the points are 26a's.
import { cameraName } from "../account/syncline";
import { whatText } from "../historytext";
import { t } from "../i18n";
import { cameraCanvas } from "../icons";
import { mine } from "../participate/api";
import { onTheme } from "../theme";
import {
  type Box,
  type Collection,
  collect,
  DOT_R,
  frameOf,
  labelPlace,
  type Owned,
} from "./collection";
import type { ProfileContext } from "./context";
import { button, drawn, el, said } from "./dom";

/** "2026-10" -> "oct." (25b's journal: the month alone). */
const shortMonth = (m: string) =>
  new Date(`${m}-15T12:00:00`).toLocaleDateString("fr", { month: "short" });

/** The toggle and the section it unfolds; `reopen` draws the screen again (« ← Profil »). */
export function camerasSection(ctx: ProfileContext, reopen: () => void): HTMLElement[] {
  const toggle = button("board-cameras-toggle");
  const label = (open: boolean) =>
    toggle.replaceChildren(t(open ? "cameras.close" : "cameras.open"), drawn(open ? " ↑" : " ↓"));
  label(false);
  toggle.setAttribute("aria-expanded", "false");
  toggle.setAttribute("aria-controls", "board-cameras");
  const box = el("section", "board-cameras");
  box.id = "board-cameras";
  box.setAttribute("aria-labelledby", "board-cameras-title");
  box.hidden = true;
  let asked: Promise<Collection | null> | null = null;
  toggle.addEventListener("click", () => {
    const open = toggle.getAttribute("aria-expanded") !== "true";
    toggle.setAttribute("aria-expanded", String(open));
    label(open);
    box.hidden = !open;
    if (!open) {
      box.replaceChildren(); // the little map goes with it
      return;
    }
    const panel = el("div", "profile-panel board-cameras-panel");
    panel.setAttribute("aria-busy", "true");
    const h3 = el("h3", "board-cameras-title", t("cameras.title"));
    h3.id = "board-cameras-title";
    panel.append(h3);
    box.replaceChildren(panel);
    // Once per opening of the screen; asked again on the next unfolding when it failed.
    asked ??= mine().then(
      (d) => collect(d),
      () => {
        asked = null;
        return null;
      },
    );
    void asked.then((c) => {
      if (!panel.isConnected) return;
      panel.removeAttribute("aria-busy");
      panel.append(...drawCollection(ctx, c, reopen));
    });
  });
  return [toggle, box];
}

function drawCollection(
  ctx: ProfileContext,
  c: Collection | null,
  reopen: () => void,
): HTMLElement[] {
  if (!c) return [el("p", "profile-note", t("cameras.offline"))];
  if (!c.cameras.length) return [el("p", "profile-note", t("cameras.empty"))];
  const out: HTMLElement[] = [];
  // 25b's numbers: how many cameras, in how many communes.
  const communes = new Set(
    c.cameras.filter((o) => o.counted && o.label?.commune).map((o) => o.label?.commune),
  );
  const numbers = el("p", "profile-numbers");
  const part = (n: number, key: string) => {
    const span = el("span");
    span.append(el("b", "", String(n)), ` ${t(key, { n })}`);
    return span;
  };
  numbers.append(part(c.total, "cameras.numbers.cameras"));
  // Apart by the line's gap on the screen, by a comma when said.
  if (communes.size) numbers.append(said(", "), part(communes.size, "cameras.numbers.communes"));
  out.push(numbers);
  if (c.byKind.length) out.push(kinds(c));
  const map = miniMap(c.cameras.filter((o) => o.counted));
  if (map) out.push(map);
  out.push(...groups(ctx, c.cameras, reopen));
  return out;
}

/** A kind in the punk sheet's title words (« Dôme », « Caméra fixe »), « Type inconnu ». */
const kindName = (kind: string) =>
  t(kind === "unknown" ? "cameras.kind.unknown" : `sheet.punk.title.${kind}`);

/** The collection: each kind's sticker (the map's) and how many of hers are of it. */
function kinds(c: Collection): HTMLElement {
  const list = el("ul", "board-cameras-kinds");
  list.setAttribute("aria-label", t("cameras.kinds"));
  for (const { kind, n } of c.byKind) {
    const li = el("li", "board-cameras-kind");
    const sticker = drawn("", "profile-sticker");
    const paint = () => sticker.replaceChildren(cameraCanvas(kind));
    paint();
    onTheme(paint, () => sticker.isConnected);
    li.append(
      sticker,
      drawn(`×${n}`, "board-cameras-n"),
      said(t("cameras.kind", { kind: kindName(kind), n })),
    );
    list.append(li);
  }
  return list;
}

const SVG = "http://www.w3.org/2000/svg";
/** The little map's box, in CSS pixels (its width follows the paper; the drawing scales). */
const MAP_W = 320;
const MAP_H = 150;

/** Where her cameras stand: a static drawing on the paper's grid, one dot each, the
 * communes' names where their cameras are (no tiles, no second map: measured on an
 * entry-level phone, lot U, docs/interface.md). Decorative: the list says it all. */
function miniMap(cams: Owned[]): HTMLElement | null {
  const placed = cams.filter((o): o is Owned & { at: [number, number] } => o.at !== null);
  const frame = frameOf(
    placed.map((o) => o.at),
    MAP_W / MAP_H,
  );
  if (!frame) return null;
  const [w, s, e, n] = frame;
  const x = (lng: number) => ((lng - w) / (e - w)) * MAP_W;
  const y = (lat: number) => ((n - lat) / (n - s)) * MAP_H;
  const fig = drawn("", "board-minimap");
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", `0 0 ${MAP_W} ${MAP_H}`);
  svg.setAttribute("focusable", "false");
  const node = (tag: string, attrs: Record<string, string | number>, text?: string) => {
    const e = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
    if (text !== undefined) e.textContent = text;
    svg.append(e);
    return e;
  };
  const dots = placed.map((o): [number, number] => [x(o.at[0]), y(o.at[1])]);
  for (const [cx, cy] of dots) node("circle", { cx, cy, r: DOT_R });
  // The communes' names near the middle of their cameras, on a paper halo, where they cover
  // no dot and no other name (lot U2: « Courbevoie » lay over a dot); a name with no such
  // place is left out (the list under the map says every commune).
  const at = new Map<string, [number, number][]>();
  for (const o of placed) {
    const c = o.label?.commune;
    if (c) at.set(c, [...(at.get(c) ?? []), [x(o.at[0]), y(o.at[1])]]);
  }
  const taken: Box[] = [];
  for (const [name, pts] of at) {
    const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length;
    const cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    const box = labelPlace(name, cx, cy, dots, taken, MAP_W, MAP_H);
    if (!box) continue;
    taken.push(box);
    node("text", { x: box.x, y: box.y, class: "board-minimap-name" }, name);
  }
  fig.append(svg);
  fig.dataset.drawn = "true";
  return fig;
}

/** 25b's cameras grouped by commune (« COURBEVOIE · 3 CAMÉRAS »; an add no build has
 * drawn yet has none, its group last), the most cameras first. */
function groups(ctx: ProfileContext, cams: Owned[], reopen: () => void): HTMLElement[] {
  const by = new Map<string | null, Owned[]>();
  for (const o of cams) {
    const commune = o.label?.commune ?? null;
    by.set(commune, [...(by.get(commune) ?? []), o]);
  }
  const order = [...by.keys()].sort((a, b) =>
    a === null
      ? 1
      : b === null
        ? -1
        : (by.get(b)?.length ?? 0) - (by.get(a)?.length ?? 0) || a.localeCompare(b, "fr"),
  );
  return order.map((commune) => {
    const list = by.get(commune) ?? [];
    const group = el("section", "profile-group");
    const n = { n: list.length };
    group.append(
      el(
        "h3",
        "profile-label",
        commune === null ? t("cameras.no_commune", n) : t("cameras.commune", { ...n, commune }),
      ),
    );
    const ul = el("ul", "profile-cams");
    for (const o of list) ul.append(cameraItem(ctx, o, reopen));
    group.append(ul);
    return group;
  });
}

/** One camera: its sticker, its name (kind · who films) and street, « → » when a tap opens
 * it; under it, its journal. */
function cameraItem(ctx: ProfileContext, o: Owned, reopen: () => void): HTMLElement {
  const li = el("li", "profile-cam-item");
  li.dataset.camera = o.camera;
  const head = o.opens ? button("profile-cam") : el("div", "profile-cam");
  const sticker = drawn("", "profile-sticker");
  const paint = () => sticker.replaceChildren(cameraCanvas(o.kind));
  paint();
  onTheme(paint, () => sticker.isConnected);
  const text = el("span", "profile-cam-text");
  // 25b: the kind and who films, then the street (the commune is the group's).
  const title = cameraName(o.label ? { ...o.label, street: null, commune: null } : null);
  text.append(el("span", "profile-cam-title", title));
  if (o.label?.street) text.append(el("span", "profile-cam-sub", o.label.street));
  head.append(sticker, text);
  if (o.opens && ctx.openCamera) {
    const open = ctx.openCamera;
    head.append(said(` ${t("cameras.open_said")}`), drawn("→", "profile-arrow"));
    head.addEventListener("click", async () => {
      li.querySelector(".profile-far")?.remove();
      if (await open(o.camera, o.at)) {
        backLink(ctx, reopen);
        return;
      }
      const note = el("p", "profile-far", t("cameras.far"));
      note.setAttribute("role", "status");
      li.append(note);
    });
  }
  const journal = el("ul", "profile-journal");
  for (const p of o.pieces) {
    const line = el("li");
    line.append(
      el("span", "profile-month", shortMonth(p.month)),
      el("span", "profile-what", whatText(p.what, t)),
      el("span", `profile-state ${p.state}`, t(`cameras.state.${p.state}`)),
    );
    journal.append(line);
  }
  li.append(head, journal);
  return li;
}

/** « ← Mes caméras » at the top of the camera sheet opened from « Mes caméras » (25b), kept
 * while that sheet is drawn again (a level, the mode) and gone with it (closed, or another
 * kind of sheet). The camera sheet is chips.ts's: a button in its head's top row, beside ↑
 * and × and as high, the sticker and the title under it where every sheet has them
 * (theme/punk/sheet.css `.has-return`; lot U2: « ←Profil » in the title's column pushed the
 * title aside and did not say where it went). */
function backLink(ctx: ProfileContext, back: () => void): void {
  const sheet = ctx.sheet;
  let watch: MutationObserver | null = null;
  const stop = () => {
    watch?.disconnect();
    watch = null;
  };
  const place = () => {
    const page = sheet.querySelector<HTMLElement>(".sheet-paper");
    if (
      sheet.hidden ||
      !page ||
      page.classList.contains("profile-paper") ||
      page.classList.contains("area-paper")
    ) {
      if (sheet.hidden || page) stop();
      return;
    }
    const head = page.querySelector<HTMLElement>(".sheet-head");
    if (!head || head.querySelector(".sheet-return")) return;
    const b = button("sheet-return");
    // Said « Revenir à Mes caméras », the words shown in it (WCAG 2.5.3).
    b.append(drawn("←\u00a0"), said(t("cameras.back_said")), t("cameras.back"));
    b.addEventListener("click", () => {
      stop();
      back();
    });
    head.prepend(b);
    head.classList.add("has-return");
  };
  place();
  if (typeof MutationObserver === "undefined") return;
  watch = new MutationObserver(place);
  watch.observe(sheet, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["hidden"],
  });
}
