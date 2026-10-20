// "Me localiser": the device position, followed while the button is on (position.ts),
// shown as a dot with its accuracy circle; never stored nor sent. Three states:
//   off     nothing is asked;
//   follow  the map follows the dot ("Suivi"), until the map is touched;
//   free    the dot moves, the map stays ("Recentrer": a tap follows again).
// A tap in "follow" turns it off. Any gesture on the map (a drag, a pinch, the wheel, the
// keyboard, the zoom buttons, a tap) and any framing by the app (a camera's sheet, an area,
// a link) set "free": no position moves the map after them. Contribution modes
// (body.moving: the map is the viewfinder there) never follow, but the dot and its circle
// stay. The URL follows the map as always.
// From the tap to the first position the button says « Localisation… » (aria-busy); the
// first position, fast and coarse (tracker.ts), brings the map at once in at most 400 ms
// (DECISIONS 2026-10-06), at once when it is out of view; the precise ones that follow move
// it only when they differ noticeably (tracker.ts worthMoving). No position within the wait:
// the button says so and turns off.
import type { GeoJSONSource, Map as MlMap, PaddingOptions } from "maplibre-gl";
import { t } from "./i18n";
import { tracker } from "./position";
import { MAX_WAIT_MS, worthMoving } from "./tracker";

export const EMPTY = { type: "FeatureCollection" as const, features: [] };

export type LocateState = "off" | "follow" | "free";

const ARROW = "M12 2 L20 21 L12 16.5 L4 21 Z";
const SVG_NS = "http://www.w3.org/2000/svg";

/** A circle of `m` metres around a point, as a polygon (48 vertices). */
export function circle(at: [number, number], m: number): GeoJSON.Polygon {
  const rad = Math.PI / 180;
  const dLat = m / 111_320;
  const dLon = m / (111_320 * Math.cos(at[1] * rad));
  const ring: [number, number][] = [];
  for (let i = 0; i <= 48; i++) {
    const a = (i / 48) * 2 * Math.PI;
    ring.push([at[0] + dLon * Math.cos(a), at[1] + dLat * Math.sin(a)]);
  }
  return { type: "Polygon", coordinates: [ring] };
}

const moving = () => document.body.classList.contains("moving");

/** The first move to the position: the longest animation DECISIONS 2026-10-06 allows for
 * what delays access to a content (a flyTo took 1 to 3 s, distance-dependent). */
const FIRST_MS = 400;

export class Locate {
  state: LocateState = "off";
  /** The first fix after "Me localiser": the map goes there and zooms in. */
  private first = false;
  /** That first move is under way: the fixes that come meanwhile wait for its end. */
  private landing = false;
  /** Where our last move put the dot; null once the map was moved otherwise. */
  private shown: [number, number] | null = null;
  private icon: SVGPathElement;
  private text: HTMLSpanElement;
  private failing = 0;

  constructor(
    private map: MlMap,
    private button: HTMLButtonElement,
    /** The part of the map the panels leave free (above an open sheet): the dot goes in
     * its middle, not under the sheet. */
    private padding: () => PaddingOptions = () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  ) {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.classList.add("locate-icon");
    this.icon = document.createElementNS(SVG_NS, "path");
    this.icon.setAttribute("d", ARROW);
    svg.append(this.icon);
    this.text = document.createElement("span");
    button.replaceChildren(svg, this.text);
    button.addEventListener("click", () => this.tap());
    tracker.listen(() => this.update());
    // eventData `locate` marks our own moves; any other (a gesture, a framing) forgets where
    // the dot was put, so that the next fix in "follow" centres it again. A gesture's move
    // carries its DOM event (MapLibre 6.11.2: drag, pinch, double tap, keyboard, the zoom
    // buttons, inertia) and leaves "follow", a pinch too (the owner, 2026-10-18).
    const ours = (e: object) => (e as { locate?: boolean }).locate === true;
    map.on("movestart", (e) => {
      if (ours(e)) return;
      this.shown = null;
      if (e.originalEvent) this.release();
    });
    // The wheel's move may come without its event: a lone notch is told from a trackpad by a
    // 40 ms timeout that starts the zoom without remembering the wheel event
    // (handler/scroll_zoom.ts in 6.11.2, `_onTimeout`; seen in the bench: movestart without
    // originalEvent). The wheel itself on the map says it.
    map.getCanvasContainer().addEventListener("wheel", () => this.release(), { passive: true });
    map.on("moveend", (e) => {
      if (!ours(e) || !this.landing) return;
      this.landing = false;
      if (this.state === "follow") this.recentre();
    });
    this.label();
  }

  private tap(): void {
    // A tap on « réessayez » answers at once: the failure's message gives way.
    this.unfail();
    if (this.state === "off") {
      if (!tracker.start()) {
        this.failed();
        return;
      }
      this.first = true;
      this.set(moving() ? "free" : "follow");
    } else if (this.state === "follow") {
      tracker.stop();
    } else {
      this.set("follow");
      this.recentre(true);
    }
  }

  /** The app frames something else, or the map was touched: stop following, the dot
   * stays. */
  release(): void {
    if (this.state === "follow") this.set("free");
  }

  private set(state: LocateState): void {
    this.state = state;
    this.label();
  }

  private update(): void {
    if (!tracker.on) {
      const wasOn = this.state !== "off";
      this.first = false;
      this.landing = false;
      this.shown = null;
      this.set("off");
      this.draw();
      if (wasOn && tracker.error === 1) this.failed("locate.error");
      if (wasOn && tracker.error === 3) this.failed("locate.timeout");
      return;
    }
    // Started from a contribution screen's help line: the dot, no follow.
    if (this.state === "off") this.set("free");
    if (this.state === "follow" && moving()) this.set("free");
    this.draw();
    if (this.state === "follow") this.recentre();
    this.label();
  }

  private draw(): void {
    const fix = tracker.fix;
    const visibility = fix ? "visible" : "none";
    for (const id of ["me", "me-accuracy", "me-accuracy-line"]) {
      if (this.map.getLayer(id)) this.map.setLayoutProperty(id, "visibility", visibility);
    }
    const me = this.map.getSource("me") as GeoJSONSource | undefined;
    const acc = this.map.getSource("me-accuracy") as GeoJSONSource | undefined;
    if (!fix) {
      me?.setData(EMPTY);
      acc?.setData(EMPTY);
      return;
    }
    me?.setData({
      type: "FeatureCollection",
      features: [
        { type: "Feature", geometry: { type: "Point", coordinates: fix.lngLat }, properties: {} },
      ],
    });
    acc?.setData({
      type: "FeatureCollection",
      features: [{ type: "Feature", geometry: circle(fix.lngLat, fix.accuracy), properties: {} }],
    });
  }

  /** `force`: « Recentrer » tapped, whatever the gap. */
  private recentre(force = false): void {
    const fix = tracker.fix;
    if (!fix || moving()) return;
    if (this.landing && this.map.isMoving()) return;
    this.landing = false;
    if (!this.first && !force && this.shown && !worthMoving(this.shown, fix)) return;
    // eventData `locate`: these moves are ours, not a framing by the app. In the middle of
    // the part the panels leave free by an offset, not a `padding`: MapLibre keeps an
    // easeTo's padding on the map, and the next framing (a commune's, a camera's) subtracted
    // it again, on a phone past the screen's height (main.ts openPending).
    const p = { top: 0, bottom: 0, left: 0, right: 0, ...this.padding() };
    const offset: [number, number] = [(p.left - p.right) / 2, (p.top - p.bottom) / 2];
    this.shown = fix.lngLat;
    if (this.first) {
      this.first = false;
      // Out of view, the way there shows nothing one knows and loads the tiles of the ground
      // in between: a jump. Under « Réduire les animations » MapLibre jumps by itself (an
      // easeTo that is not `essential`: camera.ts in 6.11.2; its flyTo's own fallback drops
      // the offset).
      const far = !this.map.getBounds().contains(fix.lngLat);
      this.landing = true;
      this.map.easeTo(
        {
          center: fix.lngLat,
          zoom: Math.max(this.map.getZoom(), 16),
          offset,
          duration: FIRST_MS,
          animate: !far,
        },
        { locate: true },
      );
    } else {
      this.map.easeTo({ center: fix.lngLat, duration: 300, offset }, { locate: true });
    }
  }

  private label(): void {
    if (this.failing) return;
    const waiting = tracker.waiting;
    const key = waiting
      ? "fab.locate_waiting"
      : { off: "fab.locate", follow: "fab.locate_follow", free: "fab.locate_free" }[this.state];
    this.text.textContent = t(key);
    this.button.setAttribute("aria-label", t(`${key}.aria`));
    if (waiting) this.button.setAttribute("aria-busy", "true");
    else this.button.removeAttribute("aria-busy");
    this.button.setAttribute("aria-pressed", String(this.state === "follow"));
    this.button.dataset.locate = this.state;
  }

  /** Refused, unavailable, or no position within the wait: said on the button itself for a
   * few seconds (a touch screen shows no tooltip), and in its accessible name. */
  private failed(key = "locate.error"): void {
    clearTimeout(this.failing);
    this.text.textContent = t(key);
    this.button.setAttribute("aria-label", t(`${key}.aria`, { s: MAX_WAIT_MS / 1000 }));
    this.button.removeAttribute("aria-busy");
    this.button.classList.add("failed");
    this.failing = window.setTimeout(() => this.unfail(), 4000);
  }

  private unfail(): void {
    if (!this.failing) return;
    clearTimeout(this.failing);
    this.failing = 0;
    this.button.classList.remove("failed");
    this.label();
  }
}
