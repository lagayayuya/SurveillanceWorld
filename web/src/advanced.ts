// Advanced filters: a drawer, collapsed by default, grouped by question. Every row restricts
// the cameras to those having a property; rows of one group combine with OR, groups with
// AND. They apply to cameras (and their views) at the street level only; shares do not move.
// Attributes come packed in `fl` (see FLAG_BITS in pipeline/lacarte/tiles.py) and `op`
// (operator index), on cameras, bands and PTZ outlines.
import type { ExpressionSpecification } from "maplibre-gl";
import { t } from "./i18n";

export type FilterMeta = {
  operators: string[];
  flag_bits: Record<string, number>;
  segment_bits: Record<string, number>;
  identify_beyond_m: number;
};
type Props = Record<string, unknown>;

type Row = {
  id: string;
  /** Its group in the scheme in force (the current interface's or the punk one's). */
  group: string;
  label: string;
  test: (p: Props, est: number) => boolean;
  expr: (est: number) => ExpressionSpecification;
};

/** The punk interface groups the rows as mockup 20a's drawer does (« Vérifiée il y a… »,
 * « Il manque… », « Elle peut… », « À vérifier », then the operator search), and the logic
 * follows what it shows: rows of one group OR, groups AND. The current interface keeps its
 * own groups. */
const PUNK_GROUP: Record<string, string> = {
  fresh_lt1: "fresh",
  fresh_1to3: "fresh",
  fresh_gt3: "fresh",
  fresh_never: "fresh",
  direction_unknown: "missing",
  type_unknown: "missing",
  height_unknown: "missing",
  plate_reading: "can",
  ptz: "can",
  night_vision: "can",
  analytics: "can",
  identifies_far: "can",
  in_building: "check",
  maybe_gone: "check",
  gone: "check",
  legacy_import: "check",
};
export type Scheme = "classique" | "punk";

const FRESH = ["lt1", "1to3", "gt3", "never"];

const fl = (p: Props) => Number(p.fl ?? 0);
const bitOn = (v: number, b: number) => Math.floor(v / 2 ** b) % 2 === 1;
const bitExpr = (b: number): ExpressionSpecification => [
  "==",
  ["%", ["floor", ["/", ["get", "fl"], 2 ** b]], 2],
  1,
];
export const bucketExpr: ExpressionSpecification = ["%", ["get", "fl"], 4];
export const freshBucket = (p: Props) => fl(p) % 4;

/** Accent- and case-insensitive form for the operator search. */
export const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export class AdvancedFilters {
  readonly rows: Row[];
  active = new Set<string>();
  operatorQuery = "";
  open = false;

  constructor(
    private meta: FilterMeta,
    private scheme: Scheme = "classique",
  ) {
    const bits = meta.flag_bits;
    const bit = (id: string, group: string, name: string): Row => ({
      id,
      group,
      label: t(`adv.${id}`, { m: meta.identify_beyond_m }),
      test: (p) => bitOn(fl(p), bits[name]),
      expr: () => bitExpr(bits[name]),
    });
    this.rows = [
      ...FRESH.map(
        (f, i): Row => ({
          id: `fresh_${f}`,
          group: "uptodate",
          label: t(`adv.fresh_${f}`),
          test: (p) => freshBucket(p) === i,
          expr: () => ["==", bucketExpr, i],
        }),
      ),
      bit("maybe_gone", "uptodate", "maybe_gone"),
      {
        // Verified gone (a validated "introuvable", tiles `gm`): hidden unless this row is
        // on; such a camera films nothing, so no street passes it (no segment bit).
        id: "gone",
        group: "uptodate",
        label: t("adv.gone"),
        test: (p) => p.gm !== undefined && p.gm !== null,
        expr: () => ["has", "gm"],
      },
      bit("legacy_import", "uptodate", "legacy_import"),
      bit("direction_unknown", "complete", "direction_unknown"),
      bit("type_unknown", "complete", "type_unknown"),
      bit("height_unknown", "complete", "height_unknown"),
      bit("in_building", "complete", "in_building"),
      bit("plate_reading", "can", "plate_reading"),
      bit("ptz", "can", "ptz"),
      bit("night_vision", "can", "night_vision"),
      bit("analytics", "can", "analytics"),
      {
        id: "identifies_far",
        group: "can",
        label: t("adv.identifies_far", { m: meta.identify_beyond_m }),
        test: (p, est) => bitOn(fl(p), bits[`identifies_far_${est}`]),
        expr: (est) => bitExpr(bits[`identifies_far_${est}`]),
      },
    ];
    if (scheme === "punk") for (const r of this.rows) r.group = PUNK_GROUP[r.id] ?? r.group;
  }

  get groups(): string[] {
    return this.scheme === "punk"
      ? ["fresh", "missing", "can", "check", "who"]
      : ["uptodate", "complete", "who", "can"];
  }

  /** Operator indices whose name contains the query (ignoring accents and case). */
  operatorIds(): number[] {
    const q = fold(this.operatorQuery.trim());
    if (!q) return [];
    const ids: number[] = [];
    this.meta.operators.forEach((name, i) => {
      if (fold(name).includes(q)) ids.push(i);
    });
    return ids;
  }

  get isActive(): boolean {
    return this.active.size > 0 || this.operatorQuery.trim() !== "";
  }

  /** Map filter for the active rows, or null when nothing restricts. */
  expression(est: number): ExpressionSpecification | null {
    const parts: ExpressionSpecification[] = [];
    for (const group of this.groups) {
      const on = this.rows.filter((r) => r.group === group && this.active.has(r.id));
      if (on.length === 1) parts.push(on[0].expr(est));
      else if (on.length > 1) parts.push(["any", ...on.map((r) => r.expr(est))]);
    }
    if (this.operatorQuery.trim()) {
      parts.push(["in", ["get", "op"], ["literal", this.operatorIds()]]);
    }
    if (!parts.length) return null;
    return parts.length === 1 ? parts[0] : ["all", ...parts];
  }

  /** Active rows as segment-bit names (tiles.SEGMENT_BITS), one list per group; the
   * operator search has no bit (it applies from z15 only). */
  bitGroups(est: number): string[][] {
    const out: string[][] = [];
    for (const group of this.groups) {
      const on = this.rows.filter((r) => r.group === group && this.active.has(r.id));
      if (on.length) {
        out.push(on.map((r) => (r.id === "identifies_far" ? `identifies_far_${est}` : r.id)));
      }
    }
    return out;
  }

  /** The same test as expression(), on one camera's properties: rows OR within a group,
   * groups and the operator search AND. */
  matches(p: Props, est: number, operatorIds: Set<number>): boolean {
    for (const group of this.groups) {
      const on = this.rows.filter((r) => r.group === group && this.active.has(r.id));
      if (on.length && !on.some((r) => r.test(p, est))) return false;
    }
    if (this.operatorQuery.trim() && !this.matchesOperator(p, operatorIds)) return false;
    return true;
  }

  matchesOperator(p: Props, ids: Set<number>): boolean {
    return p.op !== undefined && ids.has(Number(p.op));
  }

  /** URL form: active row ids, and the operator query. */
  toParams(): Record<string, string | null> {
    return {
      f: this.active.size ? [...this.active].join(",") : null,
      op: this.operatorQuery.trim() || null,
    };
  }

  fromParams(f: string | null, op: string | null): void {
    const known = new Set(this.rows.map((r) => r.id));
    this.active = new Set((f ?? "").split(",").filter((id) => known.has(id)));
    this.operatorQuery = op ?? "";
    this.open = this.isActive;
  }
}
