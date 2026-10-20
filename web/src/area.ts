// Commune (or municipal arrondissement) and département sheet, in the camera sheet's panel:
// name and département, "between X % and Y % of the streets" (fixed, whatever the estimate
// chosen: tiles._area_features), cameras and the share without a surveyed direction,
// reliability, main operators, "Partager". The punk interface draws mockup 24a instead
// (areapunk.ts, a chunk it alone downloads, asked for as this module loads; a sheet drawn
// before it arrives is this one, drawn again in punk when it does).
import { t } from "./i18n";
import { cameraCanvas, type Kind } from "./icons";
import { shareButton } from "./sheet";
import { chosenUi, ui } from "./theme";

type PunkArea = typeof import("./areapunk");
let punk: PunkArea | undefined;
let punkLoading: Promise<PunkArea> | undefined;
const loadPunk = () => (punkLoading ??= import("./areapunk").then((m) => (punk = m)));
if (chosenUi() === "punk") void loadPunk();

export type AreaProps = Record<string, string | number | undefined>;

export type AreaOptions = {
  onClose: () => void;
  onGrab: () => void;
  /** Link to this area (?insee=, hypothesis). */
  shareUrl: () => string;
  publicOnly: boolean;
};

function el(tag: string, attrs: Record<string, string> = {}, text?: string): HTMLElement {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text !== undefined) e.textContent = text;
  return e;
}

/** A département's code is its own: the tiles' `d` equals `c`. */
export const isDepartement = (p: AreaProps): boolean => String(p.c) === String(p.d);

/** The low (X) or high (Y) end of the filmed share (%), for the set in view. */
export const share = (p: AreaProps, end: "lo" | "hi", publicOnly: boolean): number =>
  Number(p[`${end}${publicOnly ? "_pub" : ""}`] ?? 0);

/** "Commune · Hauts-de-Seine (92)", "Arrondissement · Paris (75)", "Département (92)". */
export function areaLine(p: AreaProps): string {
  if (isDepartement(p))
    return t("area.line_dep", { kind: t("area.kind.departement"), code: String(p.c) });
  const arrondissement = /Arrondissement$/i.test(String(p.nm));
  const kind = t(arrondissement ? "area.kind.arrondissement" : "area.kind.commune");
  return t("area.line", { kind, dep: String(p.dn ?? ""), code: String(p.d) });
}

/** "dont 47 publiques", "dont 47 publiques et 3 sans exploitant précis". */
function ofWhich(p: AreaProps): string {
  const pub = t("area.of_which_pub", { pub: Number(p.n_pub ?? 0) });
  const nx = Number(p.nx ?? 0);
  return nx ? `${pub} ${t("area.and_no_operator", { n: nx })}` : pub;
}

export function renderAreaSheet(frame: HTMLElement, p: AreaProps, opts: AreaOptions): void {
  frame.replaceChildren();
  const pub = opts.publicOnly;

  const top = el("div", { class: "sheet-top area" });
  const grab = el("button", { class: "sheet-grab", "aria-label": t("sheet.grab") });
  grab.append(el("span", { class: "handle" }));
  grab.addEventListener("click", opts.onGrab);
  const close = el("button", { class: "close", "aria-label": t("sheet.close") }, "×");
  close.addEventListener("click", opts.onClose);
  const shared = () => shareButton(opts.shareUrl, t("area.share_title", { name: String(p.nm) }));

  if (ui() === "punk") {
    if (punk) {
      punk.punkAreaSheet(frame, {
        p,
        line: areaLine(p),
        departement: isDepartement(p),
        publicOnly: pub,
        parts: { grab, close, share: shared() },
        sticker: (kind) => cameraCanvas(kind as Kind),
      });
      return;
    }
    // Before its chunk: this sheet, then the punk one if the frame still shows it.
    const first = top;
    void loadPunk().then(
      () => {
        if (frame.firstElementChild === first) renderAreaSheet(frame, p, opts);
      },
      () => {},
    );
  }
  const line = el("div", { class: "sheet-line" });
  line.append(el("strong", { class: "area-name" }, String(p.nm)), el("span", {}, areaLine(p)));
  const headline = el(
    "h2",
    { class: "headline" },
    t(pub ? "area.headline_pub" : "area.headline", {
      lo: share(p, "lo", pub),
      hi: share(p, "hi", pub),
    }),
  );
  top.append(grab, close, line, headline);

  const body = el("div", { class: "sheet-body" });
  frame.append(top, body);
  const figures = el("div", { class: "area-figures" });
  const n = Number(p.n ?? 0);
  const cams = t("area.cameras", { n });
  figures.append(el("p", {}, n ? `${cams}, ${ofWhich(p)}` : cams));
  if (n && p.nd !== undefined)
    figures.append(el("p", {}, t("area.no_direction", { pct: Number(p.nd) })));
  figures.append(el("p", { class: "small" }, t("area.road", { km: Number(p.road_km ?? 0) })));
  body.append(figures);

  body.append(
    el(
      "p",
      { class: "area-reliability" },
      p.rw
        ? `${t(`area.word.${p.rw}`)} — ${t(`area.reason.${p.rr}`, { pct: Number(p.rp) })}`
        : t("area.reliability.none"),
    ),
  );

  body.append(el("h4", {}, t("area.operators")));
  const ops: [string, number][] = p.ops ? JSON.parse(String(p.ops)) : [];
  if (ops.length) {
    const list = el("ol", { class: "area-operators" });
    for (const [name, count] of ops)
      list.append(el("li", {}, t("area.operator", { name, n: count })));
    body.append(list);
  } else {
    body.append(el("p", { class: "small" }, t("area.no_operator")));
  }

  const how = el("details", { class: "how" });
  how.append(el("summary", {}, t("sheet.how")));
  for (const key of [
    "area.how.share",
    "area.how.range",
    "area.how.reliability",
    "legend.quantiles",
    "area.how.filters",
    "area.how.source",
  ]) {
    how.append(el("p", {}, t(key)));
  }
  body.append(how);
  body.append(shared());
}
