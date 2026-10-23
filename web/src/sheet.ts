// Camera sheet: the facts of a camera (its headline, its chips and their certainty, its
// freshness, its links), drawn as mockup 17a does by chips.ts, a chunk of its own.
import type { Source } from "./chips";
import { formatMonth, t, tp } from "./i18n";
import { cameraCanvas, KINDS, type Kind } from "./icons";
import { palette } from "./theme";

export type CameraProps = Record<string, string | number | undefined>;

const CNIL_COMPLAINT = "https://www.cnil.fr/fr/plaintes";
/** The sheet's CNIL box, suspended (DECISIONS 2026-10-08). */
const PUNK_CNIL = false;

// The sheet's drawing (chips.ts), asked for as this module loads, long before a sheet
// opens; a sheet asked before it arrives shows its grab and close buttons, then is drawn
// whole when it does.
type PunkSheet = typeof import("./chips");
let punk: PunkSheet | undefined;
let punkLoading: Promise<PunkSheet> | undefined;
const loadPunk = () => (punkLoading ??= import("./chips").then((m) => (punk = m)));
void loadPunk();
/** Before the sheet's chunk: the grab and close buttons, then `draw` once it is in, if the
 * frame still shows them. */
function later(
  frame: HTMLElement,
  buttons: { grab: HTMLElement; close: HTMLElement },
  draw: () => void,
): void {
  const top = el("div", { class: "sheet-top" });
  top.append(buttons.grab, buttons.close);
  frame.append(top);
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
  // A multi-dome (DECISIONS 2026-10-23): its number of domes (tiles `dn`, absent when
  // unknown; `dnc` 2 OSM's camera:count, 1 an answer, which goes with the shape's, 0
  // unknown), and a field all around whatever OSM's direction says (`d` is not read).
  const multi = kind === "multidome";
  if (multi) {
    const n = Number(p.dn);
    const given = p.dn !== undefined && Number.isFinite(n);
    const value = given ? t("sheet.dome_count", { n }) : t("chip.value.unknown_m");
    const cert = given ? Number(p.dnc ?? 1) : 0;
    const answer = given && cert === 1;
    out.push({
      key: "domes",
      label: t("chip.domes"),
      value: answer ? answered(value, p.km, "kind") : value,
      cert,
      source: answer ? via(p.km, "kind") : undefined,
      bare: value,
      month: answer ? str(p.km) : undefined,
    });
  }
  const d = multi ? -1 : Number(p.d ?? -1);
  // A PTZ turns: every direction, whatever the tagged one (its rest position).
  const ptz = kind === "ptz";
  // Both film all around: the direction row says so, not OSM's bearing.
  const around = ptz || multi;
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
      : multi
        ? t("chip.value.all_around")
        : d >= 0
          ? answered(towards, p.dm, "direction")
          : t("chip.value.not_surveyed"),
    cert: around ? Number(p.kc ?? 0) : Number(p.dc ?? 0),
    source: around ? via(p.km, "kind") : d >= 0 ? via(p.dm, "direction") : undefined,
    bare: around || d < 0 ? undefined : towards,
    month: str(around ? p.km : d >= 0 ? p.dm : undefined),
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
      : multi
        ? p.fov === undefined
          ? t("sheet.deg", { v: 360 })
          : t("chip.value.multidome_fov", { v: String(p.fov) })
        : d >= 0
          ? t("sheet.deg", { v: String(p.fov) })
          : t("chip.value.full_circle"),
    cert: 0,
    // The direction's row says it is not surveyed.
    bare: !around && d < 0 ? t("sheet.deg", { v: 360 }) : undefined,
  });
  // Phase D3: an answered height says its class (tiles `hk`, `hm`); a tilt only its class
  // (`t`), never degrees, and only while a height at least estimated makes it count.
  // The editor's metres alone (« ~4 m »: DECISIONS 2026-10-12, the height in metres).
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

/** The camera's sheet, drawn by chips.ts from its facts. */
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
  // « Toujours là ? » asks otherwise on a camera verified gone (participate/verify.ts).
  if (gone) frame.dataset.gone = "";
  else delete frame.dataset.gone;
  if (!punk) {
    later(frame, { grab, close }, () => renderSheet(frame, p, opts));
    return;
  }
  let back: HTMLElement | undefined;
  if (opts.onBack) {
    back = el("button", { class: "sheet-back" });
    back.textContent = t("sheet.back_to_camera");
    back.addEventListener("click", opts.onBack);
  }
  const share = shareButton(opts.shareUrl, t("sheet.share_title"));
  const [type, id] = osmRef(p);
  punk.punkSheet(frame, {
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
    // The CNIL box is suspended until further notice (DECISIONS 2026-10-08, « Punk, until
    // further notice… »): chips.ts keeps drawing it when given one.
    cnil: PUNK_CNIL && opts.cnil && Number(p.cnil) === 1 ? CNIL_COMPLAINT : undefined,
    parts: {
      ...{ picto, grab, close, back, actions: opts.actions, slots: opts.slots, share },
      history: opts.history,
    },
  });
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
  if (!punk) {
    later(frame, { grab, close }, () => renderPendingSheet(frame, opts));
    return;
  }
  const parts = { picto, grab, close, actions: opts.actions };
  punk.punkPendingSheet(frame, { t, title: t("sheet.pending_add.line"), status, parts });
}

function osmRef(p: CameraProps): [string, string] {
  const id = String(p.id);
  const type = id.startsWith("n") ? "node" : id.startsWith("w") ? "way" : "relation";
  return [type, id.slice(1)];
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
