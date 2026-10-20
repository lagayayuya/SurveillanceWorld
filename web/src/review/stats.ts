// /revue's « Statistiques », for administrators (lot 4, board P6; plan-revue §6 bis; the
// « go » of 17/10): what the site's counters say over four spans — « Les dernières
// 24 heures » hour by hour, the same hours of the 7 days before as a reference mark;
// « Les 30 derniers jours » day by day; « Les semaines, sur 13 mois »; « Inscriptions par
// mois » — the map's loads, the welcomes and the sign-ins, the contributions received and
// the decisions on the days' and weeks' axes; then the questions of lot 4 (« La file
// grossit-elle ? », « Qui contribue ? », « Quelle part part sur OSM ? », « Retraits »).
// Each block its sentence answer first, a small chart only where a curve says more than a
// number, « Voir les chiffres » (the numbers behind it in real tables). Every count is
// shown from the first one (lot M, 2026-10-17: an administrators' screen of totals); a
// computed value under its threshold (the median wait, a share: GET /api/review/stats
// `enough`, rules/stats.yaml) is shown all the same, followed by « peu de données (n = …) ».
// The page says that it counts visits and sign-ins, never people.
// The numbers are the API's; the page adds only the means and the shares. The charts are
// in ink on the paper (the board's): nothing is told by a colour — two series on one axis
// differ by their mark (a solid line and a dashed one, a bar and its reference tick), are
// named in a legend, in the chart's text alternative and as the tables' columns.
import { t } from "../i18n";
import { call } from "../participate/api";
import { type AdminNav, frame, shortDay, table } from "./admin";
import { el } from "./rows";

type Need = Record<string, number>;
type Block = { enough: boolean; n: number; need: Need };

type Counts = { map: number; welcome: number; signin: number };
type Activity = Counts & { contributions: number; decisions: number };
export type Hour = Counts & {
  at: string;
  ref: Partial<Record<keyof Counts, number | null>> | null;
};
export type Day = Activity & { day: string };
export type Week = Activity & { week: string };
export type Month = { month: string; signups: number };

/** A span of the counters: its threshold and its rows (S6's `hours`, `days`, `weeks`,
 * `months`). Read as the API gives it: the block with its rows under its own name, under
 * `rows`, or the bare list (always enough). */
type Span<R> = Block & { rows: R[] };
function span<R>(raw: unknown, name: string): Span<R> {
  if (Array.isArray(raw)) return { enough: true, n: raw.length, need: {}, rows: raw as R[] };
  const b = (raw ?? {}) as Record<string, unknown>;
  const rows =
    (b[name] as R[] | undefined) ??
    (b.rows as R[] | undefined) ??
    ((Object.values(b).find(Array.isArray) as R[] | undefined) || []);
  return {
    enough: b.enough !== false,
    n: Number(b.n ?? rows.length),
    need: (b.need as Need) ?? {},
    rows,
  };
}

export type Stats = {
  today: string;
  hours: unknown;
  days: unknown;
  weeks: unknown;
  months: unknown;
  queue: Block & {
    n_weeks: number;
    weekly: { week: string; in: number; decided: number }[];
    pending_by_day: { day: string; n: number }[];
    pending_now: number;
    oldest_days: number | null;
    median_wait_days: number | null;
  };
  contributors: Block & {
    monthly: { month: string; active: number; new: number }[];
    top3_share: number | null;
    top: { id: string; pseudonym: string | null; accepted: number }[];
  };
  osm: Block & {
    offered: boolean;
    server: string;
    accepted: number;
    published: number;
    conflict: number;
    sending: number;
    stays: number;
  };
  hidden: Block & { monthly: { month: string; n: number }[] };
};

const numbers = new Intl.NumberFormat("fr", { maximumFractionDigits: 1 });
const fmt = (n: number) => numbers.format(n);

/** « octobre » (the API's day). */
const monthName = (m: string) =>
  new Date(`${m}-15T12:00:00`).toLocaleDateString("fr", { month: "long" });
/** « octobre 2026 ». */
const monthLong = (m: string) =>
  new Date(`${m}-15T12:00:00`).toLocaleDateString("fr", { month: "long", year: "numeric" });
/** « oct. 25 » (a chart's axis: 13 months show the same month twice). */
const monthShort = (m: string) =>
  new Date(`${m}-15T12:00:00`).toLocaleDateString("fr", { month: "short", year: "2-digit" });
/** « 14 h » from the API's Paris hour (« 2026-10-17T14:00:00+02:00 »): read from the
 * string itself, whatever the zone of the browser. */
const hourOf = (at: string) => t("review.stats.hour", { h: String(Number(at.slice(11, 13))) });
/** « 16/10 14 h ». */
const dayHour = (at: string) => `${shortDay(at.slice(0, 10))} ${hourOf(at)}`;

/** `key`'s sentence with its figures `bold` (params whose value is shown in bold: the
 * number itself; `params` for the rest and the plurals' choice). */
function rich(
  tag: "p" | "span",
  cls: string,
  key: string,
  params: Record<string, string | number>,
  bold: Record<string, string>,
): HTMLElement {
  const marks: Record<string, string> = {};
  const order: string[] = [];
  for (const [k, v] of Object.entries(bold)) {
    marks[k] = `\u0001${order.length}\u0001`;
    order.push(v);
  }
  const out = el(tag, "", cls);
  t(key, { ...params, ...marks })
    .split("\u0001")
    .forEach((part, i) => {
      if (i % 2 === 0) {
        if (part) out.append(part);
      } else out.append(el("strong", order[Number(part)]));
    });
  return out;
}

/** The mean of `values`, or null without any. */
function mean(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

/** A round top for a chart's scale: 1, 2, 5 × 10^k at or above `max`. */
export function niceMax(max: number): number {
  if (max <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(max));
  for (const m of [1, 2, 5, 10]) if (m * p >= max) return m * p;
  return 10 * p;
}

const SVG = "http://www.w3.org/2000/svg";
const W = 300;
const H = 100;
const svgEl = (tag: string, cls: string, attrs: Record<string, string | number>) => {
  const e = document.createElementNS(SVG, tag);
  e.classList.add(cls);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
};

/** A series of a chart: a line (solid or dashed: the second of two), bars, or a reference
 * tick on each bar (null: no mark there). */
type Series = { values: (number | null)[]; mark: "line" | "dashed" | "bars" | "ticks" };

/** A small chart (oldest first): the scale's top and 0 at its left, the first and last
 * labels under it; `label`, its text alternative (the values in words; the table behind
 * « Voir les chiffres » holds them all); `legend`, the marks named (two series); each
 * point's own values on hover (its `title`). */
function plot(o: {
  series: Series[];
  first: string;
  last: string;
  label: string;
  title: (i: number) => string;
  legend?: { mark: Series["mark"]; text: string }[];
}): HTMLElement {
  const box = el("figure", "", "review-chart");
  const n = o.series[0].values.length;
  const all = o.series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  const top = niceMax(Math.max(0, ...all));
  const bars = o.series.some((s) => s.mark === "bars");
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", o.label);
  svg.classList.add("review-chart-plot");
  // Bars: one band each, the point in its middle; lines: the first and last at the edges.
  const band = bars ? W / n : n > 1 ? W / (n - 1) : W;
  const x = (i: number) => (bars ? (i + 0.5) * band : n > 1 ? i * band : W / 2);
  const y = (v: number) => H - (v / top) * H;
  for (const s of o.series) {
    if (s.mark === "bars")
      s.values.forEach((v, i) => {
        if (v === null || v <= 0) return;
        const w = band * 0.62;
        svg.append(
          svgEl("rect", "review-chart-bar", {
            x: (x(i) - w / 2).toFixed(2),
            y: y(v).toFixed(2),
            width: w.toFixed(2),
            height: (H - y(v)).toFixed(2),
          }),
        );
      });
    else if (s.mark === "ticks")
      s.values.forEach((v, i) => {
        if (v === null) return;
        const w = band * 0.92;
        const at = {
          x1: (x(i) - w / 2).toFixed(2),
          x2: (x(i) + w / 2).toFixed(2),
          y1: y(v).toFixed(2),
          y2: y(v).toFixed(2),
        };
        // A ring of paper under the tick: seen over its bar as over the paper.
        svg.append(svgEl("line", "review-chart-ring", at), svgEl("line", "review-chart-tick", at));
      });
    else {
      // A null value breaks the line (no data is not 0).
      let run: string[] = [];
      const flush = () => {
        if (run.length > 1)
          svg.append(
            svgEl("polyline", s.mark === "dashed" ? "review-chart-dashed" : "review-chart-line", {
              points: run.join(" "),
            }),
          );
        run = [];
      };
      s.values.forEach((v, i) => {
        if (v === null) flush();
        else run.push(`${x(i).toFixed(2)},${y(v).toFixed(2)}`);
      });
      flush();
    }
  }
  // Hover: a band per point, its values in its title (the table is the way for everyone).
  const hit = bars ? band : n > 1 ? band : W;
  for (let i = 0; i < n; i++) {
    const r = svgEl("rect", "review-chart-hit", {
      x: Math.max(0, x(i) - hit / 2).toFixed(2),
      y: 0,
      width: hit.toFixed(2),
      height: H,
    });
    const title = document.createElementNS(SVG, "title");
    title.textContent = o.title(i);
    r.append(title);
    svg.append(r);
  }
  const yTop = el("span", fmt(top), "review-chart-y top");
  const yZero = el("span", "0", "review-chart-y zero");
  const first = el("span", o.first, "review-chart-x");
  const last = el("span", o.last, "review-chart-x last");
  for (const s of [yTop, yZero, first, last]) s.setAttribute("aria-hidden", "true");
  const xs = el("div", "", "review-chart-xs");
  xs.append(first, last);
  const ys = el("div", "", "review-chart-ys");
  ys.append(yTop, yZero);
  box.append(ys, svg, xs);
  if (o.legend) {
    // Said by the chart's label already: seen, not read twice.
    const legend = el("p", "", "review-chart-legend");
    legend.setAttribute("aria-hidden", "true");
    for (const item of o.legend) {
      const key = el("span", "", "review-chart-key");
      key.append(el("span", "", `review-chart-swatch ${item.mark}`), item.text);
      legend.append(key);
    }
    box.append(legend);
  }
  return box;
}

/** A line chart of one series by day (the queue's waiting sends). */
function lineChart(
  points: { day: string; v: number }[],
  label: string,
  pointTitle: (p: { day: string; v: number }) => string,
): HTMLElement {
  return plot({
    series: [{ values: points.map((p) => p.v), mark: "line" }],
    first: shortDay(points[0].day),
    last: shortDay(points[points.length - 1].day),
    label,
    title: (i) => pointTitle(points[i]),
  });
}

/** « Voir les chiffres »: the tables, closed. */
function figures(...parts: Node[]): HTMLDetailsElement {
  const d = el("details", "", "review-figures");
  const s = el("summary", t("review.stats.figures"));
  d.append(s, ...parts);
  return d;
}

/** A table of rows of cells (the first a row head); a wide one scrolls sideways in a
 * region of its own (named, reachable by the keyboard) rather than the page. */
function rows(caption: string, heads: string[], data: (string | number | null)[][]): HTMLElement {
  const tb = table(caption, heads, "review-stats-table");
  for (const r of data) {
    const tr = el("tr");
    r.forEach((c, i) => {
      const text = c === null ? t("review.none") : typeof c === "number" ? fmt(c) : c;
      const cell = el(i === 0 ? "th" : "td", text);
      if (i === 0) (cell as HTMLTableCellElement).scope = "row";
      else cell.classList.add("review-num");
      tr.append(cell);
    });
    tb.body.append(tr);
  }
  if (heads.length <= 3) return tb.table;
  const wrap = el("div", "", "review-table-scroll");
  wrap.setAttribute("role", "region");
  wrap.setAttribute("aria-label", caption);
  wrap.tabIndex = 0;
  wrap.append(tb.table);
  return wrap;
}

/** A block: its h2 (the question). */
function block(id: string): HTMLElement {
  const section = el("section", "", "review-stat");
  section.id = `review-stat-${id}`;
  const h2 = el("h2", t(`review.stats.${id}.title`));
  h2.id = `review-stat-${id}-title`;
  section.setAttribute("aria-labelledby", h2.id);
  section.append(h2);
  return section;
}

/** After a computed value (a median, a share) resting on fewer figures than its threshold:
 * « · peu de données (n = …) », appended to `to`. */
function low(to: HTMLElement, b: Block & { n_weeks?: number }): void {
  if (b.enough) return;
  // The queue's median also waits for weeks of history: say which measure is short.
  const weeks = b.n_weeks !== undefined && b.n >= (b.need.n ?? 0);
  const said = weeks
    ? t("review.stats.low_weeks", { n: b.n_weeks as number })
    : t("review.stats.low", { n: fmt(b.n) });
  to.append(" · ", el("span", said, "review-stat-low"));
}

// --- the counters' spans ------------------------------------------------------------------

/** « Les dernières 24 heures »: the map's loads hour by hour, the same hour's mean over the
 * 7 days before as a tick on each bar; the welcomes and sign-ins in the line under it. */
function hours(s: Stats): HTMLElement {
  const h = span<Hour>(s.hours, "hours");
  const section = block("hours");
  if (!h.rows.length) return section;
  const r = h.rows;
  const ref = (x: Hour, k: keyof Counts) => x.ref?.[k] ?? null;
  const total = (k: keyof Counts) => sum(r.map((x) => x[k]));
  const refs = r.map((x) => ref(x, "map")).filter((v): v is number => v !== null);
  section.append(
    rich(
      "p",
      "review-stat-answer",
      "review.stats.hours.answer",
      { n: total("map") },
      { v: fmt(total("map")) },
    ),
  );
  const last = r[r.length - 1];
  section.append(
    plot({
      series: [
        { values: r.map((x) => x.map), mark: "bars" },
        { values: r.map((x) => ref(x, "map")), mark: "ticks" },
      ],
      first: hourOf(r[0].at),
      last: hourOf(last.at),
      label: t("review.stats.hours.chart", {
        from: dayHour(r[0].at),
        to: dayHour(last.at),
        min: fmt(Math.min(...r.map((x) => x.map))),
        max: fmt(Math.max(...r.map((x) => x.map))),
        total: fmt(total("map")),
        ref: refs.length ? fmt(Math.round(sum(refs))) : t("review.none"),
      }),
      title: (i) =>
        t("review.stats.hours.point", {
          hour: dayHour(r[i].at),
          n: fmt(r[i].map),
          ref: ref(r[i], "map") === null ? t("review.none") : fmt(ref(r[i], "map") as number),
        }),
      legend: [
        { mark: "bars", text: t("review.stats.legend.hours") },
        { mark: "ticks", text: t("review.stats.legend.ref") },
      ],
    }),
  );
  section.append(
    el(
      "p",
      [
        refs.length
          ? t("review.stats.hours.ref", { n: fmt(Math.round(sum(refs))) })
          : t("review.stats.hours.no_ref"),
        t("review.stats.hours.more", {
          welcome: fmt(total("welcome")),
          signin: total("signin"),
        }),
      ].join(" · "),
      "review-muted review-stat-more",
    ),
  );
  const cell = (x: Hour, k: keyof Counts) => {
    const v = ref(x, k);
    return v === null ? null : Math.round(v * 10) / 10;
  };
  const hoursTable = rows(
    t("review.stats.hours.caption"),
    [
      t("review.stats.col.hour"),
      t("review.stats.col.map"),
      t("review.stats.col.ref"),
      t("review.stats.col.welcome"),
      t("review.stats.col.ref"),
      t("review.stats.col.signin"),
      t("review.stats.col.ref"),
    ],
    [...r]
      .reverse()
      .map((x, i) => [
        i === 0 ? t("review.stats.today", { day: dayHour(x.at) }) : dayHour(x.at),
        x.map,
        cell(x, "map"),
        x.welcome,
        cell(x, "welcome"),
        x.signin,
        cell(x, "signin"),
      ]),
  );
  // Each « Repère » says, to a screen reader, which count it is the reference of.
  const refs3 = ["map", "welcome", "signin"] as const;
  hoursTable.querySelectorAll("thead th").forEach((th, i) => {
    if (i >= 2 && i % 2 === 0)
      th.append(el("span", ` ${t(`review.stats.col.ref.${refs3[i / 2 - 1]}`)}`, "review-sr"));
  });
  section.append(figures(hoursTable, el("p", t("review.stats.hours.ref_note"), "review-muted")));
  return section;
}

/** The two charts of a span by day or week: the map's loads, then the contributions
 * received and the decisions (one axis: both are sends). */
function activityCharts(
  r: (Activity & { key: string })[],
  label: (key: string) => string,
  span: "days" | "weeks",
): HTMLElement[] {
  const first = label(r[0].key);
  const last = label(r[r.length - 1].key);
  const maps = r.map((x) => x.map);
  const loads = plot({
    series: [{ values: maps, mark: "line" }],
    first,
    last,
    label: t(`review.stats.${span}.chart`, {
      from: first,
      to: last,
      min: fmt(Math.min(...maps)),
      max: fmt(Math.max(...maps)),
      last: fmt(maps[maps.length - 1]),
    }),
    title: (i) => t("review.stats.point.map", { at: label(r[i].key), n: fmt(r[i].map) }),
  });
  const sends = plot({
    series: [
      { values: r.map((x) => x.contributions), mark: "line" },
      { values: r.map((x) => x.decisions), mark: "dashed" },
    ],
    first,
    last,
    label: t(`review.stats.${span}.sends_chart`, {
      from: first,
      to: last,
      in: fmt(sum(r.map((x) => x.contributions))),
      decided: fmt(sum(r.map((x) => x.decisions))),
    }),
    title: (i) =>
      t("review.stats.point.sends", {
        at: label(r[i].key),
        in: fmt(r[i].contributions),
        decided: fmt(r[i].decisions),
      }),
    legend: [
      { mark: "line", text: t("review.stats.legend.contributions") },
      { mark: "dashed", text: t("review.stats.legend.decisions") },
    ],
  });
  return [
    el("h3", t("review.stats.sub.loads"), "review-chart-title"),
    loads,
    el("h3", t("review.stats.sub.sends"), "review-chart-title"),
    sends,
  ];
}

const ACTIVITY_COLS = ["map", "welcome", "signin", "contributions", "decisions"] as const;

/** « Les 30 derniers jours »: the 7 whole days' mean of the map's loads, the charts, the
 * welcomes and sign-ins a day. */
function days(s: Stats): HTMLElement {
  const d = span<Day>(s.days, "days");
  const section = block("days");
  if (!d.rows.length) return section;
  // Whole days only: today's count is still running.
  const whole = d.rows.filter((x) => x.day < s.today);
  const week = whole.slice(-7);
  const avg = (k: keyof Activity) => Math.round(mean(week.map((x) => x[k])) ?? 0);
  section.append(
    rich(
      "p",
      "review-stat-answer",
      "review.stats.days.answer",
      { n: avg("map") },
      { v: fmt(avg("map")) },
    ),
  );
  // The charts over whole days: today's running count would end every curve with a drop.
  if (whole.length > 1)
    section.append(
      ...activityCharts(
        whole.map((x) => ({ ...x, key: x.day })),
        shortDay,
        "days",
      ),
    );
  section.append(
    el(
      "p",
      t("review.stats.days.more", {
        welcome: fmt(avg("welcome")),
        signin: fmt(avg("signin")),
        in: fmt(avg("contributions")),
        decided: fmt(avg("decisions")),
      }),
      "review-muted review-stat-more",
    ),
  );
  section.append(
    figures(
      rows(
        t("review.stats.days.caption"),
        [t("review.stats.col.day"), ...ACTIVITY_COLS.map((k) => t(`review.stats.col.${k}`))],
        [...d.rows]
          .reverse()
          .map((x) => [
            x.day === s.today ? t("review.stats.today", { day: shortDay(x.day) }) : shortDay(x.day),
            ...ACTIVITY_COLS.map((k) => x[k]),
          ]),
      ),
    ),
  );
  return section;
}

/** « Les semaines, sur 13 mois »: the last whole week, the charts by week. */
function weeks(s: Stats): HTMLElement {
  const w = span<Week>(s.weeks, "weeks");
  const section = block("weeks");
  if (!w.rows.length) return section;
  const r = w.rows;
  const monday = (iso: string) => {
    const d = new Date(`${iso}T12:00:00`);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d.toLocaleDateString("sv");
  };
  const current = monday(s.today);
  const whole = r.filter((x) => x.week < current);
  const lastWhole = whole[whole.length - 1] ?? r[r.length - 1];
  section.append(
    rich(
      "p",
      "review-stat-answer",
      "review.stats.weeks.answer",
      { n: lastWhole.map, day: shortDay(lastWhole.week) },
      { v: fmt(lastWhole.map) },
    ),
  );
  const weekOf = (iso: string) => t("review.stats.week_of", { day: shortDay(iso) });
  if (whole.length > 1)
    section.append(
      ...activityCharts(
        whole.map((x) => ({ ...x, key: x.week })),
        shortDay,
        "weeks",
      ),
    );
  section.append(
    el(
      "p",
      t("review.stats.weeks.more", {
        welcome: fmt(lastWhole.welcome),
        signin: fmt(lastWhole.signin),
        in: fmt(lastWhole.contributions),
        decided: fmt(lastWhole.decisions),
      }),
      "review-muted review-stat-more",
    ),
  );
  section.append(
    figures(
      rows(
        t("review.stats.weeks.caption"),
        [t("review.stats.col.week"), ...ACTIVITY_COLS.map((k) => t(`review.stats.col.${k}`))],
        [...r]
          .reverse()
          .map((x) => [
            x.week === current ? t("review.stats.today", { day: weekOf(x.week) }) : weekOf(x.week),
            ...ACTIVITY_COLS.map((k) => x[k]),
          ]),
      ),
    ),
  );
  return section;
}

/** « Inscriptions par mois »: this month's, a bar a month over 13 months. */
function months(s: Stats): HTMLElement {
  const m = span<Month>(s.months, "months");
  const section = block("months");
  if (!m.rows.length) return section;
  const r = m.rows;
  const month = s.today.slice(0, 7);
  const now = r.find((x) => x.month === month)?.signups ?? 0;
  section.append(
    rich(
      "p",
      "review-stat-answer",
      "review.stats.months.answer",
      { n: now, month: monthName(month) },
      { v: fmt(now) },
    ),
  );
  const values = r.map((x) => x.signups);
  if (r.length > 1)
    section.append(
      plot({
        series: [{ values, mark: "bars" }],
        first: monthShort(r[0].month),
        last: monthShort(r[r.length - 1].month),
        label: t("review.stats.months.chart", {
          from: monthLong(r[0].month),
          to: monthLong(r[r.length - 1].month),
          total: fmt(sum(values)),
          max: fmt(Math.max(...values)),
        }),
        title: (i) =>
          t("review.stats.point.signups", { at: monthLong(r[i].month), n: fmt(r[i].signups) }),
      }),
    );
  section.append(
    el("p", t("review.stats.months.total", { n: sum(values) }), "review-muted review-stat-more"),
  );
  section.append(
    figures(
      rows(
        t("review.stats.months.caption"),
        [t("review.stats.col.month"), t("review.stats.col.signups")],
        [...r].reverse().map((x) => [monthLong(x.month), x.signups]),
      ),
    ),
  );
  return section;
}

// --- lot 4's questions --------------------------------------------------------------------

function queue(s: Stats): HTMLElement {
  const q = s.queue;
  const section = block("queue");
  const week = q.weekly[q.weekly.length - 1] ?? { week: s.today, in: 0, decided: 0 };
  section.append(
    rich(
      "p",
      "review-stat-answer",
      "review.stats.queue.answer",
      {},
      { in: fmt(week.in), decided: fmt(week.decided) },
    ),
  );
  if (q.pending_by_day.length > 1) {
    const pts = q.pending_by_day.map((d) => ({ day: d.day, v: d.n }));
    const vs = pts.map((p) => p.v);
    section.append(
      lineChart(
        pts,
        t("review.stats.queue.chart", {
          from: shortDay(pts[0].day),
          to: shortDay(pts[pts.length - 1].day),
          first: fmt(vs[0]),
          max: fmt(Math.max(...vs)),
          last: fmt(vs[vs.length - 1]),
        }),
        (p) => t("review.stats.queue.point", { day: shortDay(p.day), n: fmt(p.v) }),
      ),
    );
  }
  const more = [t("review.stats.queue.pending", { n: fmt(q.pending_now) })];
  if (q.oldest_days !== null) more.push(t("review.stats.queue.oldest", { n: q.oldest_days }));
  if (q.median_wait_days !== null)
    more.push(t("review.stats.queue.median", { n: q.median_wait_days }));
  const line = el("p", more.join(" · "), "review-muted review-stat-more");
  if (q.median_wait_days !== null) low(line, q);
  section.append(line);
  section.append(
    figures(
      el("h3", t("review.stats.queue.weeks")),
      rows(
        t("review.stats.queue.weeks"),
        [t("review.stats.col.week"), t("review.stats.col.in"), t("review.stats.col.decided")],
        [...q.weekly]
          .reverse()
          .map((w) => [t("review.stats.week_of", { day: shortDay(w.week) }), w.in, w.decided]),
      ),
      el("h3", t("review.stats.queue.days")),
      rows(
        t("review.stats.queue.days"),
        [t("review.stats.col.day"), t("review.stats.col.pending")],
        [...q.pending_by_day].reverse().map((d) => [shortDay(d.day), d.n]),
      ),
    ),
  );
  return section;
}

function contributors(s: Stats, nav: AdminNav): HTMLElement {
  const c = s.contributors;
  const section = block("contributors");
  const answer =
    c.top3_share === null
      ? rich(
          "p",
          "review-stat-answer",
          "review.stats.contributors.answer",
          { n: c.n },
          {
            v: fmt(c.n),
          },
        )
      : rich(
          "p",
          "review-stat-answer",
          "review.stats.contributors.answer_share",
          { n: c.n },
          { v: fmt(c.n), share: `${fmt(Math.round(c.top3_share * 100))} %` },
        );
  if (c.top3_share !== null) low(answer, c);
  section.append(answer);
  if (c.top.length) {
    const list = el("ol", "", "review-stat-top");
    list.setAttribute("aria-label", t("review.stats.contributors.top"));
    for (const a of c.top) {
      const li = el("li");
      if (a.pseudonym) {
        const link = el("a", a.pseudonym, "review-cell-link");
        link.href = nav.href({ compte: a.id });
        nav.inPlace(link, () => nav.go({ compte: a.id }, "push"));
        li.append(link);
      } else li.append(el("span", t("review.stats.contributors.unnamed")));
      li.append(
        el("span", t("review.stats.contributors.accepted", { n: a.accepted }), "review-muted"),
      );
      list.append(li);
    }
    section.append(list);
  }
  section.append(
    figures(
      rows(
        t("review.stats.contributors.months"),
        [t("review.stats.col.month"), t("review.stats.col.active"), t("review.stats.col.new")],
        [...c.monthly].reverse().map((m) => [monthLong(m.month), m.active, m.new]),
      ),
    ),
  );
  return section;
}

function osm(s: Stats): HTMLElement {
  const o = s.osm;
  // Not offered: that is the answer, whatever the count (nothing can leave).
  const section = block("osm");
  if (!o.offered) {
    section.append(el("p", t("review.stats.osm.closed"), "review-stat-closed"));
    return section;
  }
  const share = o.accepted ? Math.round((o.published / o.accepted) * 100) : 0;
  const answer = rich(
    "p",
    "review-stat-answer",
    "review.stats.osm.answer",
    { n: o.accepted },
    {
      published: fmt(o.published),
      accepted: fmt(o.accepted),
      share: `${fmt(share)} %`,
    },
  );
  if (o.accepted) low(answer, o);
  section.append(answer);
  const more = [
    t("review.stats.osm.conflict", { n: fmt(o.conflict) }),
    t("review.stats.osm.sending", { n: fmt(o.sending) }),
    t("review.stats.osm.stays", { n: fmt(o.stays) }),
  ];
  if (o.server === "dev") more.push(t("review.stats.osm.dev"));
  section.append(el("p", more.join(" · "), "review-muted review-stat-more"));
  section.append(
    figures(
      rows(
        t("review.stats.osm.caption"),
        [t("review.stats.col.state"), t("review.stats.col.sends")],
        [
          [t("review.stats.osm.row.published"), o.published],
          [t("review.stats.osm.row.conflict"), o.conflict],
          [t("review.stats.osm.row.sending"), o.sending],
          [t("review.stats.osm.row.stays"), o.stays],
          [t("review.stats.osm.row.accepted"), o.accepted],
        ],
      ),
    ),
  );
  return section;
}

function hidden(s: Stats): HTMLElement {
  const h = s.hidden;
  const section = block("hidden");
  const month = s.today.slice(0, 7);
  const now = h.monthly.find((m) => m.month === month)?.n ?? 0;
  section.append(
    rich(
      "p",
      "review-stat-answer",
      "review.stats.hidden.answer",
      { n: now, month: monthName(month) },
      { v: fmt(now) },
    ),
  );
  section.append(
    el("p", t("review.stats.hidden.total", { n: h.n }), "review-muted review-stat-more"),
  );
  section.append(
    figures(
      rows(
        t("review.stats.hidden.months"),
        [t("review.stats.col.month"), t("review.stats.col.hidden")],
        [...h.monthly].reverse().map((m) => [monthLong(m.month), m.n]),
      ),
    ),
  );
  return section;
}

export async function statsView(
  app: HTMLElement,
  nav: AdminNav,
  note: string | null,
): Promise<void> {
  const v = frame(app, nav.head("statistiques"), "review-stats", t("review.stats.title"), note);
  let s: Stats;
  try {
    s = await call<Stats>("GET", "/api/review/stats");
  } catch (e) {
    nav.fail(e);
    return;
  }
  const grid = el("div", "", "review-stats-grid");
  grid.append(
    hours(s),
    days(s),
    weeks(s),
    months(s),
    queue(s),
    contributors(s, nav),
    osm(s),
    hidden(s),
  );
  v.main.append(
    el("p", t("review.stats.lead"), "review-stats-lead"),
    grid,
    el("p", t("review.stats.note"), "review-muted review-stats-note"),
  );
  v.focus();
}
