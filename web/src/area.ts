// Commune (or municipal arrondissement) and département sheet, in the camera sheet's panel:
// mockup 24a, drawn by areapunk.ts, a chunk of its own asked for as this module loads; a
// sheet asked before it arrives shows its grab and close buttons, then is drawn whole when
// it does.
import { t } from "./i18n";
import { cameraCanvas, type Kind } from "./icons";
import { shareButton } from "./sheet";

type PunkArea = typeof import("./areapunk");
let punk: PunkArea | undefined;
let punkLoading: Promise<PunkArea> | undefined;
const loadPunk = () => (punkLoading ??= import("./areapunk").then((m) => (punk = m)));
void loadPunk();

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

/** "Commune · Hauts-de-Seine (92)", "Arrondissement · Paris (75)", "Département (92)". */
export function areaLine(p: AreaProps): string {
  if (isDepartement(p))
    return t("area.line_dep", { kind: t("area.kind.departement"), code: String(p.c) });
  const arrondissement = /Arrondissement$/i.test(String(p.nm));
  const kind = t(arrondissement ? "area.kind.arrondissement" : "area.kind.commune");
  return t("area.line", { kind, dep: String(p.dn ?? ""), code: String(p.d) });
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
  // Before its chunk: the grab and close buttons, then the sheet if the frame still shows
  // them.
  top.append(grab, close);
  frame.append(top);
  void loadPunk().then(
    () => {
      if (frame.firstElementChild === top) renderAreaSheet(frame, p, opts);
    },
    () => {},
  );
}
