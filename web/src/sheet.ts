// Camera sheet: pictogram and one line, then in large "can identify you up to ~X m" for the
// chosen estimate; a one-hue reach ruler; facts as chips with their certainty symbol (a tap
// explains); freshness; the CNIL signal; every explanation behind one "how is it
// computed?"; OpenStreetMap links last. The punk interface draws the same facts as mockup
// 17a does (chips.ts, a chunk it alone downloads).
import type { Source } from "./chips";
import { formatDate, formatMonth, t, tp } from "./i18n";
import { cameraCanvas, KINDS, type Kind } from "./icons";
import { chosenUi, palette, ui } from "./theme";

export type CameraProps = Record<string, string | number | undefined>;

const CNIL_COMPLAINT = "https://www.cnil.fr/fr/plaintes";
/** The punk sheet's CNIL box, suspended (DECISIONS 2026-10-08). */
const PUNK_CNIL = false;
// Certainty codes as in the tiles: 2 identified, 1 estimated, 0 default.
const CERT_SYMBOL = ["○", "◐", "●"];

// The punk sheet (chips.ts) is downloaded by the punk interface only, asked for as this
// module loads, long before a sheet opens; a sheet drawn before it arrives is the current
// one, drawn again in punk when it does (and stays the current one if it cannot load).
type PunkSheet = typeof import("./chips");
let punk: PunkSheet | undefined;
let punkLoading: Promise<PunkSheet> | undefined;
const loadPunk = () => (punkLoading ??= import("./chips").then((m) => (punk = m)));
if (chosenUi() === "punk") void loadPunk();
/** In the punk interface before its sheet's chunk: `draw` again once it is in, if the frame
 * still shows what was drawn. */
function later(frame: HTMLElement, draw: () => void): void {
  if (ui() !== "punk") return;
  const first = frame.firstElementChild;
  void loadPunk().then(
    () => {
      if (frame.firstElementChild === first && first) draw();
    },
    () => {},
  );
}

export type SheetOptions = {
  cnil: boolean;
  onClose: () => void;
  onGrab: () => void;
  /** Link to this camera (?cam=, hypothesis, position). */
  shareUrl: () => string;
  /** Estimate names by band index, the shown ones (standard, prudent) and the chosen. */
  estimates: string[];
  shown: number[];
  est: number;
  /** reach[est][lv - 1] in metres (lv 1 detection, 2 recognition, 3 identification). */
  reach: number[][];
  /** Direction not surveyed and a kind the direction rule applies to (drawn light). */
  noDirection: boolean;
  /** Median wide field of view of PTZ cameras (catalogue), for their chips. */
  ptzFov: number;
  /** Height answers' metres by class (rules/questions.yaml, phase D3), for the chip. */
  heights?: Record<string, number>;
  /** Participation: "Toujours là ?" and "Déplacer", first in the body. */
  actions?: HTMLElement;
  /** The punk sheet: where the participation puts its proposal and conflict, its link
   * « Déplacer » and « Vos contributions » (participate/index.ts actionSlots). */
  slots?: { head: HTMLElement; move: HTMLElement; mine: HTMLElement };
  /** The facts (chips() keys) a « Compléter » journey can answer for this camera, when it is
   * offered: the punk sheet's « ? » and its box's title. */
  answerable?: string[];
  /** « Revenir à la caméra » (punk interface): back to the focused camera's field from a
   * zoom where it is not drawn, as a tap on its marker; first in the body, shown by the
   * page while the map is below the street level (main.ts). */
  onBack?: () => void;
  /** The operator's name (OpenStreetMap's `operator`, meta.operators), for the punk sheet's
   * line under its title and its « Exploitant » row. */
  operatorName?: string;
  /** Punk: the level the map shows of the camera, and the tickets' choice (main.ts). */
  level?: number;
  onLevel?: (lv: 1 | 2 | 3) => void;
  /** Punk, signed out (lot « comptes »): « Corriger sur OpenStreetMap » among the links,
   * the way to correct a camera without an account. */
  visitor?: boolean;
  /** The camera's history (history.ts historySlot, lot U): last in the body, filled once
   * the API has answered. */
  history?: HTMLElement;
};

function el(tag: string, attrs: Record<string, string> = {}, text?: string): HTMLElement {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text !== undefined) e.textContent = text;
  return e;
}

const metres = (m: number) => t("sheet.m", { v: m });
const str = (v: unknown) => (v ? String(v) : undefined);
const known = (m: number | undefined): m is number => m !== undefined && Number.isFinite(m);

/** "Dôme · publique". */
export function headLine(p: CameraProps): string {
  const kind = String(p.k ?? "unknown");
  const op = String(p.o ?? "unk");
  const gender = t(`sheet.kind.${kind}.gender`);
  // A private camera a validated answer says a private individual installed (tiles `ok`).
  const who =
    p.ok === "h" ? `sheet.operator.household.${gender}` : `sheet.operator.${op}.${gender}`;
  return `${t(`sheet.kind.${kind}`)} · ${t(who)}`;
}

/** The reach ruler: one row per level (identify, recognise, detect), a solid segment up
 * to the standard camera's reach, extended by a faded one up to the prudent one's, with
 * both values written above. */
export function reachRuler(reach: number[][], typical: number, high: number): SVGElement {
  const rows = [
    { key: "ruler.identify", lv: 3, opacity: 1 },
    { key: "ruler.recognise", lv: 2, opacity: 0.6 },
    { key: "ruler.detect", lv: 1, opacity: 0.3 },
  ].map((r) => ({ ...r, a: reach[typical]?.[r.lv - 1], b: reach[high]?.[r.lv - 1] }));
  const max = Math.max(...rows.flatMap((r) => [r.a, r.b]).filter(known), 1) * 1.02;
  const W = 320;
  const X0 = 2;
  const ROW = 32;
  const x = (m: number) => X0 + ((W - 2 * X0) * m) / max;
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${ROW * rows.length}`);
  svg.setAttribute("class", "ruler");
  svg.setAttribute("role", "img");
  const node = (tag: string, attrs: Record<string, string | number>, text?: string) => {
    const e = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
    if (text !== undefined) e.textContent = text;
    svg.append(e);
  };
  const spoken: string[] = [];
  rows.forEach((r, i) => {
    const y = i * ROW;
    const line = rowText(r.key, r.a, r.b);
    spoken.push(line);
    node("text", { x: X0, y: y + 12, class: "ruler-m" }, line);
    if (known(r.a)) {
      node("rect", {
        x: X0,
        y: y + 17,
        width: x(r.a) - X0,
        height: 9,
        fill: palette().field,
        "fill-opacity": r.opacity,
      });
    }
    if (known(r.b) && (!known(r.a) || r.b > r.a)) {
      const from = known(r.a) ? x(r.a) : X0;
      node("rect", {
        x: from,
        y: y + 17,
        width: x(r.b) - from,
        height: 9,
        fill: palette().field,
        "fill-opacity": r.opacity * 0.3,
      });
    }
  });
  svg.setAttribute("aria-label", spoken.join(". "));
  return svg;
}

/** "Identifier : ~5,6 m (~18 m en prudent)", or what is missing. */
function rowText(key: string, a: number | undefined, b: number | undefined): string {
  const verb = t(key);
  if (known(a) && known(b)) return t("ruler.row", { verb, m: metres(a), M: metres(b) });
  if (known(b)) return t("ruler.row_high", { verb, M: metres(b) });
  if (known(a)) return t("ruler.row_one", { verb, m: metres(a) });
  return t("ruler.row_none", { verb });
}

/** The sheet's headline, starting with the chosen estimate, then the other one; or why
 * the camera cannot identify. A field without an identification zone comes from the blind
 * zone under a mounted camera (height and tilt known, views._mount): too high or too
 * tilted. A camera without a surveyed direction (rules/direction.yaml) films there only if
 * it is turned towards you: the headline says so. */
export function headline(
  reach: number[][],
  typical: number,
  high: number,
  mounted: boolean,
  chosen: number,
  noDirection = false,
): string {
  const a = reach[typical]?.[2];
  const b = reach[high]?.[2];
  const highChosen = chosen === high;
  if (known(a) && known(b)) {
    if (noDirection) {
      return highChosen
        ? t("sheet.headline.if_turned_high", { M: metres(b), m: metres(a) })
        : t("sheet.headline.if_turned", { m: metres(a), M: metres(b) });
    }
    return highChosen
      ? t("sheet.headline.high_first", { M: metres(b), m: metres(a) })
      : t("sheet.headline", { m: metres(a), M: metres(b) });
  }
  const field = [reach[typical]?.[0], reach[high]?.[0]].find(known);
  if (!known(field)) return t("sheet.headline.no_field");
  if (known(b)) {
    if (highChosen) {
      return t(mounted ? "sheet.headline.high_first_too_high" : "sheet.headline.high_first_only", {
        M: metres(b),
      });
    }
    return t(mounted ? "sheet.headline.too_high_but_high" : "sheet.headline.high_only", {
      M: metres(b),
    });
  }
  if (mounted) return t("sheet.headline.too_high");
  return t("sheet.headline.detect_only", { m: metres(field) });
}

// `source`: a validated contribution's (the punk sheet's tag); others follow the certainty
// (chips.ts sourceOf). The punk sheet writes `bare` (the value without its source and
// month, which its tag says) and the contribution's `month` in the tag.
export type Chip = {
  key: string;
  label: string;
  value: string;
  cert?: number;
  warn?: boolean;
  source?: Source;
  bare?: string;
  month?: string;
};

function chips(p: CameraProps, ptzFov: number, heights: Record<string, number> = {}): Chip[] {
  const out: Chip[] = [];
  const kind = String(p.k ?? "unknown");
  // "Type : inconnu", not "Type : type inconnu".
  const typeValue = kind === "unknown" ? t("chip.value.unknown_m") : t(`kind.${kind}`);
  // "Compléter" answers applied (tiles `km`, `dm`, `om`: months of observation).
  const answered = (value: string, month: unknown, what: keyof typeof ON_SITE) =>
    month
      ? t(observed(p, what) ? "chip.value.answered_on_site" : "chip.value.answered", {
          value,
          month: formatMonth(String(month)),
        })
      : value;
  // Where a validated contribution's value comes from: on site, else an answer or another
  // contribution (a move, a sighting, an add, « gone »).
  const via = (month: unknown, what: keyof typeof ON_SITE, answer = true): Source | undefined =>
    month ? (observed(p, what) ? "site" : answer ? "answer" : "contrib") : undefined;
  out.push({
    key: "type",
    label: t("chip.type"),
    value: answered(typeValue, p.km, "kind"),
    cert: Number(p.kc ?? 0),
    source: via(p.km, "kind"),
    bare: typeValue,
    month: str(p.km),
  });
  const d = Number(p.d ?? -1);
  // A PTZ turns: every direction, whatever the tagged one (its rest position).
  const ptz = kind === "ptz";
  const towards =
    d >= 0 && !ptz
      ? String(p.ds)
          .split(";")
          .map((v) =>
            t("chip.value.towards", { dir: t(`compass.${Math.round(Number(v) / 45) % 8}`) }),
          )
          .join(", ")
      : "";
  out.push({
    key: "direction",
    label: t("chip.direction"),
    value: ptz
      ? t("chip.value.all_directions")
      : d >= 0
        ? answered(towards, p.dm, "direction")
        : t("chip.value.not_surveyed"),
    cert: ptz ? Number(p.kc ?? 0) : Number(p.dc ?? 0),
    source: ptz ? via(p.km, "kind") : d >= 0 ? via(p.dm, "direction") : undefined,
    bare: ptz || d < 0 ? undefined : towards,
    month: str(ptz ? p.km : d >= 0 ? p.dm : undefined),
  });
  // Who films, when a validated answer says it (the headline gives the class).
  if (p.om) {
    const who = p.ok === "h" ? "household" : p.ok === "b" ? "business" : String(p.o ?? "unk");
    out.push({
      key: "operator",
      label: t("chip.operator"),
      value: answered(t(`chip.value.operator.${who}`), p.om, "operator"),
      cert: who === "unk" ? 0 : 1,
      source: via(p.om, "operator"),
      bare: t(`chip.value.operator.${who}`),
      month: str(p.om),
    });
  }
  out.push({
    key: "fov",
    label: t("chip.fov"),
    value: ptz
      ? t("chip.value.ptz_fov", { v: ptzFov })
      : d >= 0
        ? t("sheet.deg", { v: String(p.fov) })
        : t("chip.value.full_circle"),
    cert: 0,
    // The direction's row says it is not surveyed.
    bare: !ptz && d < 0 ? t("sheet.deg", { v: 360 }) : undefined,
  });
  // Phase D3: an answered height says its class (tiles `hk`, `hm`); a tilt only its class
  // (`t`), never degrees, and only while a height at least estimated makes it count.
  // Punk says the editor's metres alone (« ~4 m »: DECISIONS 2026-10-12, the height in
  // metres); the classique its floor and the metres.
  const heightClass = p.hk
    ? tp("chip.value.height", {
        v: tp(`chip.value.height.${p.hk}`),
        m: heights[String(p.hk)] ?? Number(p.h),
      })
    : "";
  out.push({
    key: "height",
    label: t("chip.height"),
    value: p.hk ? answered(heightClass, p.hm, "height") : metres(Number(p.h)),
    cert: Number(p.hc ?? 0),
    source: p.hk ? via(p.hm, "height") : undefined,
    bare: p.hk ? heightClass : undefined,
    month: str(p.hk ? p.hm : undefined),
  });
  if (p.t && Number(p.hc ?? 0) > 0)
    out.push({
      key: "tilt",
      label: t("chip.tilt"),
      value: answered(t(`chip.value.tilt.${p.t}`), p.tm, "tilt"),
      cert: 1,
      source: via(p.tm, "tilt"),
      bare: t(`chip.value.tilt.${p.t}`),
      month: str(p.tm),
    });
  out.push({
    key: "night",
    label: t("chip.night"),
    value: p.nv === "probable" ? t("chip.value.probable") : t("chip.value.unknown_f"),
    cert: 0,
  });
  if (p.zr !== undefined) {
    out.push({
      key: "zoom",
      label: t("chip.zoom"),
      value: t("chip.value.zoom", { m: Number(p.zr) }),
      cert: 0,
    });
  }
  // Validated contributions (tiles `pm`, `vm`, `gm`, `am`: months of observation; `os`: which
  // of them were observed on site, rules/contributions.yaml on_site).
  if (p.gm) {
    out.push({
      key: "gone",
      label: t("chip.gone"),
      value: t(observed(p, "gone") ? "chip.value.gone" : "chip.value.gone_off", {
        month: formatMonth(String(p.gm)),
      }),
      cert: 2,
      warn: true,
      source: via(p.gm, "gone", false),
      month: str(p.gm),
    });
  }
  // Added on site (phase "Ajouter", tiles `am`): its position is the add's until a later
  // validated move corrects it.
  if (p.am && (!p.pm || p.pm === p.am)) {
    out.push({
      key: "added",
      label: t("chip.position"),
      value: t(observed(p, "added") ? "chip.value.added" : "chip.value.added_off", {
        month: formatMonth(String(p.am)),
      }),
      cert: 2,
      source: via(p.am, "added", false),
      month: str(p.am),
    });
  } else if (p.pm) {
    out.push({
      key: "position",
      label: t("chip.position"),
      value: t(
        observed(p, "position") ? "chip.value.position_corrected" : "chip.value.corrected_off",
        {
          month: formatMonth(String(p.pm)),
        },
      ),
      cert: 2,
      source: via(p.pm, "position", false),
      month: str(p.pm),
    });
  }
  // Seen only through its own add: the position chip says it already.
  if (seenLater(p) && !(Number(p.os ?? 0) & SEEN_BY_ADD)) {
    out.push({
      key: "fresh_seen",
      label: t("chip.fresh"),
      value: t(observed(p, "seen") ? "chip.value.seen_on_site" : "chip.value.seen_off", {
        month: formatMonth(String(p.vm)),
      }),
      cert: 2,
      source: via(p.vm, "seen", false),
      month: str(p.vm),
    });
  } else if (!seenLater(p))
    out.push({ key: "fresh", label: t("chip.fresh"), value: freshness(p), source: "osm" });
  for (const flag of String(p.st ?? "")
    .split(",")
    .filter(Boolean)) {
    out.push({
      key: `stale.${flag}`,
      label: t("chip.warn"),
      value: t(`sheet.stale.${flag}`),
      warn: true,
      source: "osm",
    });
  }
  // Position or direction to check on site (tiles `pv`: field under 10 m2 or drawn inside a
  // building, rules/reliability.yaml position_check).
  if (Number(p.pv) === 1 || Number(p.ib) === 1)
    out.push({ key: "check", label: t("chip.warn"), value: t("chip.value.check"), warn: true });
  return out;
}

// Tiles `os` (apply.ON_SITE): the months a contribution made on site backs.
const ON_SITE = {
  position: 1,
  seen: 2,
  gone: 4,
  added: 8,
  kind: 32,
  direction: 64,
  operator: 128,
  height: 256,
  tilt: 512,
} as const;
const SEEN_BY_ADD = 16;
const observed = (p: CameraProps, what: keyof typeof ON_SITE) =>
  (Number(p.os ?? 0) & ON_SITE[what]) !== 0;

/** A validated sighting (`vm`, a month) at least as recent as the OSM survey date. */
function seenLater(p: CameraProps): boolean {
  return Boolean(p.vm) && (!p.sd || String(p.vm) >= String(p.sd).slice(0, 7));
}

/** "Vérifiée il y a 2 ans" / "Jamais vérifiée". */
function freshness(p: CameraProps): string {
  if (!p.sd) return t("chip.value.never_checked");
  const days = (Date.now() - new Date(String(p.sd)).getTime()) / 86400000;
  const rtf = new Intl.RelativeTimeFormat("fr", { numeric: "auto" });
  const ago =
    days >= 365
      ? rtf.format(-Math.round(days / 365.25), "year")
      : days >= 30
        ? rtf.format(-Math.round(days / 30.4), "month")
        : rtf.format(-Math.round(days), "day");
  return t("chip.value.checked", { ago });
}

/** The handle (a phone's) and the close button, both sheets'. */
function topButtons(opts: { onClose: () => void; onGrab: () => void }) {
  const grab = el("button", { class: "sheet-grab", "aria-label": t("sheet.grab") });
  grab.append(el("span", { class: "handle" }));
  grab.addEventListener("click", opts.onGrab);
  const close = el("button", { class: "close", "aria-label": t("sheet.close") }, "×");
  close.addEventListener("click", opts.onClose);
  return { grab, close };
}

/** The sheet in two parts: `.sheet-top` (handle, close, pictogram, line, headline: what a
 * phone shows at its lowest position, and where it is dragged) and `.sheet-body`. The punk
 * interface's is chips.ts's, from the same facts. */
export function renderSheet(frame: HTMLElement, p: CameraProps, opts: SheetOptions): void {
  frame.replaceChildren();
  const kind = (KINDS as readonly string[]).includes(String(p.k))
    ? (String(p.k) as Kind)
    : "unknown";

  const { grab, close } = topButtons(opts);
  const picto = cameraCanvas(kind, p.gm ? palette().gone : undefined);
  picto.className = "sheet-picto";
  picto.setAttribute("aria-hidden", "true");
  const [typical, high] = opts.shown;
  // No field, or one too small to be real: the position or the direction is wrong, only a
  // survey can say which; no reach is given, the edit link and "Déplacer" come first.
  // Verified gone (a validated "introuvable", tiles `gm`): no field, said so.
  const gone = Boolean(p.gm);
  const noField =
    !gone &&
    (Number(p.pv) === 1 || Number(p.ib) === 1 || !opts.reach.some((levels) => levels.some(known)));
  const mounted = Number(p.hc ?? 0) > 0;
  const sentence = gone
    ? t(observed(p, "gone") ? "sheet.headline.gone" : "sheet.headline.gone_off", {
        month: formatMonth(String(p.gm)),
      })
    : noField
      ? t("sheet.headline.no_field")
      : headline(opts.reach, typical, high, mounted, opts.est, opts.noDirection);
  // An added camera (phase "Ajouter") has no OpenStreetMap element to link to.
  const osm = !isAddedId(String(p.id));
  const punkSheet = ui() === "punk" ? punk : undefined;
  // Punk: « Toujours là ? » asks otherwise on a camera verified gone (participate/verify.ts).
  if (punkSheet && gone) frame.dataset.gone = "";
  else delete frame.dataset.gone;
  let back: HTMLElement | undefined;
  if (opts.onBack) {
    back = el("button", { class: punkSheet ? "sheet-back" : "part-btn sheet-back" });
    back.textContent = t("sheet.back_to_camera");
    back.addEventListener("click", opts.onBack);
  }
  const share = shareButton(opts.shareUrl, t("sheet.share_title"));
  if (punkSheet) {
    const [type, id] = osmRef(p);
    punkSheet.punkSheet(frame, {
      ...{ p, t, month: formatMonth, title: headLine(p), operatorName: opts.operatorName },
      ...{ facts: chips(p, opts.ptzFov, opts.heights), sentence, gone, noField, mounted },
      ...{ reach: opts.reach, shown: opts.shown, est: opts.est, estimates: opts.estimates },
      ...{ level: opts.level, onLevel: opts.onLevel },
      noDirection: opts.noDirection,
      visitor: opts.visitor === true,
      answerable: opts.answerable ?? [],
      observed: (what) => observed(p, what as keyof typeof ON_SITE),
      seen: seenLater(p),
      seenByAdd: (Number(p.os ?? 0) & SEEN_BY_ADD) !== 0,
      osm: osm
        ? {
            edit: `https://www.openstreetmap.org/edit?${type}=${id}`,
            page: `https://www.openstreetmap.org/${type}/${id}`,
          }
        : undefined,
      // The CNIL box is suspended in punk until further notice (DECISIONS 2026-10-08,
      // « Punk, until further notice… »): chips.ts keeps drawing it when given one.
      cnil: PUNK_CNIL && opts.cnil && Number(p.cnil) === 1 ? CNIL_COMPLAINT : undefined,
      parts: {
        ...{ picto, grab, close, back, actions: opts.actions, slots: opts.slots, share },
        history: opts.history,
      },
    });
    return;
  }

  const top = el("div", { class: "sheet-top" });
  const line = el("div", { class: "sheet-line" });
  line.append(picto, el("span", {}, headLine(p)));
  const title = el("h2", { class: "headline" }, sentence);
  top.append(grab, close, line, title);
  if (osm && (noField || gone)) top.append(osmEditLink(p));

  const body = el("div", { class: "sheet-body" });
  frame.append(top, body);
  if (back) body.append(back);
  if (opts.actions) body.append(opts.actions);

  if (!noField && !gone) body.append(reachRuler(opts.reach, typical, high));

  // Chips: a tap shows a short explanation under them, one at a time.
  const list = el("div", { class: "chips" });
  const help = el("p", { class: "chip-help", "aria-live": "polite" });
  help.hidden = true;
  let openKey = "";
  for (const c of chips(p, opts.ptzFov, opts.heights)) {
    const certText = c.cert === undefined ? "" : t(`cert.${c.cert}`);
    // Freshness reads as a phrase ("Vérifiée il y a 2 ans"): no label before it.
    const phrase = c.key === "fresh" || c.key === "fresh_seen";
    const b = el("button", {
      class: `chip${c.warn ? " warn" : ""}`,
      "aria-label": certText
        ? t("chip.aria", { label: c.label, value: c.value, certainty: certText })
        : c.key === "fresh"
          ? c.value
          : `${c.label} : ${c.value}`,
      "aria-expanded": "false",
    });
    if (c.cert !== undefined)
      b.append(el("span", { class: "cert", "aria-hidden": "true" }, CERT_SYMBOL[c.cert]));
    if (!phrase) b.append(el("span", { class: "chip-label" }, c.label));
    b.append(el("span", { class: "chip-value" }, c.value));
    b.addEventListener("click", () => {
      const again = openKey === c.key;
      openKey = again ? "" : c.key;
      for (const other of list.querySelectorAll("button"))
        other.setAttribute("aria-expanded", "false");
      b.setAttribute("aria-expanded", String(!again));
      help.hidden = again;
      const helpKey = c.key.startsWith("stale.") ? "chip.help.warn" : `chip.help.${c.key}`;
      help.textContent = again
        ? ""
        : `${c.label} — ${t(helpKey)}${certText ? ` ${t(`cert.help.${c.cert}`)}` : ""}`;
    });
    list.append(b);
  }
  body.append(list, help);

  if (opts.cnil && Number(p.cnil) === 1) {
    const box = el("div", { class: "cnil" });
    // Without a direction the signal comes from surveillance=public: "can film", not "turned".
    const title = Number(p.d ?? -1) < 0 ? "sheet.cnil.title_no_direction" : "sheet.cnil.title";
    box.append(el("strong", {}, t(title)), el("p", {}, t("sheet.cnil.body")));
    box.append(
      el("a", { href: CNIL_COMPLAINT, target: "_blank", rel: "noopener" }, t("sheet.cnil.link")),
    );
    body.append(box);
  }

  // Every explanation behind one link.
  const how = el("details", { class: "how" });
  how.append(el("summary", {}, t("sheet.how")));
  for (const key of [
    "sheet.how.certainty",
    "sheet.fan",
    "estimate.probable.sub",
    "estimate.cautious.sub",
    "sheet.old_generation",
    "legend.norm",
    "sheet.focus_exit",
  ]) {
    how.append(el("p", {}, t(key)));
  }
  body.append(how);

  body.append(share);
  if (osm) {
    const links = el("p", { class: "links" });
    links.append(osmEditLink(p), osmHistoryLink(p));
    body.append(links);
  }
  if (p.ed && !p.sd)
    body.append(el("p", { class: "note" }, t("sheet.edited", { date: formatDate(String(p.ed)) })));
  if (opts.history) body.append(opts.history);
  // The punk interface before its sheet's chunk: this one, then the punk one.
  later(frame, () => renderSheet(frame, p, opts));
}

const isAddedId = (id: string) => /^c[0-9a-f]{12}$/.test(id);

/** The sheet of an add no build has applied yet (phase "Ajouter"): a pale pictogram,
 * "Caméra proposée", its status as the title, and its proposal block (the participation's
 * `actions`). */
export function renderPendingSheet(
  frame: HTMLElement,
  opts: { onClose: () => void; onGrab: () => void; actions: HTMLElement; status: string },
): void {
  frame.replaceChildren();
  const { grab, close } = topButtons(opts);
  const picto = cameraCanvas("unknown");
  picto.className = "sheet-picto pending";
  picto.setAttribute("aria-hidden", "true");
  const status = tp(`sheet.pending_add.headline.${opts.status}`);
  if (ui() === "punk" && punk) {
    const parts = { picto, grab, close, actions: opts.actions };
    punk.punkPendingSheet(frame, { t, title: t("sheet.pending_add.line"), status, parts });
    return;
  }
  const top = el("div", { class: "sheet-top" });
  const line = el("div", { class: "sheet-line" });
  line.append(picto, el("span", {}, t("sheet.pending_add.line")));
  top.append(grab, close, line, el("h2", { class: "headline" }, status));
  const body = el("div", { class: "sheet-body" });
  body.append(opts.actions);
  frame.append(top, body);
  later(frame, () => renderPendingSheet(frame, opts));
}

function osmRef(p: CameraProps): [string, string] {
  const id = String(p.id);
  const type = id.startsWith("n") ? "node" : id.startsWith("w") ? "way" : "relation";
  return [type, id.slice(1)];
}

function osmEditLink(p: CameraProps): HTMLElement {
  const [type, id] = osmRef(p);
  const href = `https://www.openstreetmap.org/edit?${type}=${id}`;
  return el(
    "a",
    { href, target: "_blank", rel: "noopener", class: "osm-edit" },
    t("sheet.osm.edit"),
  );
}

function osmHistoryLink(p: CameraProps): HTMLElement {
  const [type, id] = osmRef(p);
  const href = `https://www.openstreetmap.org/${type}/${id}/history`;
  return el("a", { href, target: "_blank", rel: "noopener" }, t("sheet.osm.history"));
}

/** "Partager": the system share sheet when there is one, else a copy to the clipboard. */
export function shareButton(url: () => string, title: string): HTMLElement {
  const b = el("button", { class: "share" }, t("sheet.share"));
  b.addEventListener("click", async () => {
    const link = url();
    try {
      if (navigator.share) {
        await navigator.share({ url: link, title });
        return;
      }
      await navigator.clipboard.writeText(link);
      b.textContent = t("sheet.share_copied");
    } catch (err) {
      // Share sheet closed by the user: nothing to say.
      if (err instanceof DOMException && err.name === "AbortError") return;
      // No share sheet nor clipboard access: show the link to copy by hand.
      b.textContent = link;
    }
    setTimeout(() => {
      b.textContent = t("sheet.share");
    }, 3000);
  });
  return b;
}
