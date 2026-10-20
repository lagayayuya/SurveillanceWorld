// Filters on streets, from STREET_FILTER_MIN: a filmed portion is kept when at least one
// camera filming it passes the active filters, with an estimate at least as certain as the
// chosen one (the portion's `cs` lists ";t;" per camera, t = base 36 of n * 3 + band, n the
// camera's compact number: see camera_bands_key in pipeline/lacarte/tiles.py). What the
// filters test per camera comes from tiles/cameras.json, fetched the first time a filter is
// used. Portions are marked with feature-state `sel`; only changed states are written:
// every write repaints, and this runs on each idle.
import type { Map as MlMap } from "maplibre-gl";

// The street level (pipeline tiles.PORTIONS_MIN): portions list their cameras from there.
export const STREET_FILTER_MIN = 15;

type CameraTable = {
  ops: string[];
  kinds: string[];
  o: number[];
  k: number[];
  fl: number[];
  op: number[];
};
/** A camera as the filters see it (the same keys as on camera features; `n` its compact
 * number, the table's index). */
export type CameraProps = { o: string; k: string; fl: number; op?: number; n?: number };
export type Predicate = (p: CameraProps) => boolean;

export class StreetFilter {
  private table: CameraTable | null = null;
  private loading = false;
  private pass: Uint8Array | null = null;
  private test: Predicate | null = null;
  private est = 0;
  private marked = new Map<string, boolean>();
  /** Kept segments with a vertex in view (0 below STREET_FILTER_MIN). */
  count = 0;

  private pending = false;

  constructor(
    private map: MlMap,
    private base: string,
    private onLoaded: () => void,
  ) {
    // Mark the portions of each streets tile as it arrives, not only when the map is idle:
    // an unmarked portion is hidden, and while a finger keeps zooming "idle" may not come
    // for seconds (the streets vanished around z14 on an iPhone). One refresh per frame.
    map.on("sourcedata", (e) => {
      if (e.sourceId !== "streets" || !e.tile || !this.pass || this.pending) return;
      this.pending = true;
      requestAnimationFrame(() => {
        this.pending = false;
        this.refresh();
      });
    });
  }

  get active(): boolean {
    return this.test !== null;
  }

  get ready(): boolean {
    return this.pass !== null;
  }

  /** null: no filter, every segment as usual. */
  set(test: Predicate | null, est: number): void {
    this.test = test;
    this.est = est;
    if (!test) {
      this.pass = null;
      this.clear();
      return;
    }
    if (!this.table) {
      this.load();
      return;
    }
    const t = this.table;
    const pass = new Uint8Array(t.o.length);
    for (let i = 0; i < pass.length; i++) {
      const p: CameraProps = { o: t.ops[t.o[i]], k: t.kinds[t.k[i]], fl: t.fl[i], n: i };
      if (t.op[i] >= 0) p.op = t.op[i];
      pass[i] = test(p) ? 1 : 0;
    }
    this.pass = pass;
    this.refresh();
  }

  private load(): void {
    if (this.loading) return;
    this.loading = true;
    fetch(`${this.base}/tiles/cameras.json`)
      .then((r) => r.json())
      .then((t: CameraTable) => {
        this.table = t;
        this.set(this.test, this.est);
        this.onLoaded();
      })
      .finally(() => {
        this.loading = false;
      });
  }

  private kept(cs: string): boolean {
    const pass = this.pass as Uint8Array;
    for (const token of cs.split(";")) {
      if (!token) continue;
      const v = Number.parseInt(token, 36);
      if (v % 3 <= this.est && pass[Math.floor(v / 3)] === 1) return true;
    }
    return false;
  }

  private mark(layer: string, id: number, sel: boolean): void {
    const key = `${layer}:${id}`;
    if (this.marked.get(key) === sel) return;
    this.map.setFeatureState({ source: "streets", sourceLayer: layer, id }, { sel });
    this.marked.set(key, sel);
  }

  /** Mark the loaded portions and count the kept ones of the chosen estimate in view. */
  refresh(): void {
    this.count = 0;
    if (!this.pass || this.map.getZoom() < STREET_FILTER_MIN) return;
    const bounds = this.map.getBounds();
    const inView = new Set<number>();
    for (const f of this.map.querySourceFeatures("streets", { sourceLayer: "portions" })) {
      if (f.id === undefined) continue;
      const id = Number(f.id);
      const cs = f.properties.cs;
      const sel = typeof cs === "string" && this.kept(cs);
      this.mark("portions", id, sel);
      if (!sel || inView.has(id) || Number(f.properties.b) !== this.est) continue;
      if (f.geometry.type !== "LineString") continue;
      if (f.geometry.coordinates.some(([lng, lat]) => bounds.contains([lng, lat]))) inView.add(id);
    }
    this.count = inView.size;
  }

  private clear(): void {
    for (const key of this.marked.keys()) {
      const [layer, id] = key.split(":");
      this.mark(layer, Number(id), false);
    }
    this.marked.clear();
    this.count = 0;
  }
}
