// ?debug=1: a band at the top with what a phone does that the tests cannot see — the
// selected camera, the sheet's state and box, the viewport heights, the safe-area inset,
// and the last open/close events with their reason. Screenshots of it go into bug reports.
import { readParam } from "./url";

export const DEBUG = readParam("debug") === "1";
const events: string[] = [];
let box: HTMLElement | null = null;
let probe: HTMLElement | null = null;
let state: () => Record<string, string | number> = () => ({});

export function debugInit(read: () => Record<string, string | number>): void {
  if (!DEBUG) return;
  state = read;
  box = document.createElement("pre");
  box.id = "debug";
  probe = document.createElement("div");
  probe.style.cssText =
    "position:fixed;bottom:0;height:0;padding-bottom:env(safe-area-inset-bottom,0px);visibility:hidden";
  document.body.append(box, probe);
  const draw = () => debugDraw();
  window.visualViewport?.addEventListener("resize", draw);
  window.addEventListener("resize", draw);
  setInterval(draw, 1000);
  draw();
}

export function debugEvent(text: string): void {
  if (!DEBUG) return;
  const t = new Date().toISOString().slice(11, 23);
  events.unshift(`${t} ${text}`);
  events.length = Math.min(events.length, 20);
  debugDraw();
}

function debugDraw(): void {
  if (!box) return;
  const vv = window.visualViewport;
  const lines = [
    ...Object.entries(state()).map(([k, v]) => `${k}: ${v}`),
    `visualViewport.height: ${vv ? vv.height.toFixed(0) : "n/a"} (offsetTop ${vv ? vv.offsetTop.toFixed(0) : "-"})`,
    `innerHeight: ${window.innerHeight}`,
    // The page must never scroll; a participation panel must reach the visible bottom.
    `scroll: ${Math.round(window.scrollY)} / ${Math.round(document.documentElement.scrollTop)}`,
    panelGap(vv),
    `safe-area-inset-bottom: ${probe ? probe.offsetHeight : 0}px`,
    ...events,
  ];
  box.textContent = lines.join("\n");
}

/** Gap between the open participation panel and the bottom of the visible viewport. */
function panelGap(vv: VisualViewport | null): string {
  const panel = document.querySelector<HTMLElement>("#complete-panel, #move-panel");
  if (!panel) return "panel: none";
  const bottom = vv ? vv.height + vv.offsetTop : window.innerHeight;
  return `panel: bottom gap ${Math.round(bottom - panel.getBoundingClientRect().bottom)} px`;
}
