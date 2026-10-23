// The punk map's layout checks shared by smoke-formats.mjs (each screen format at rest) and
// smoke-formats-add.mjs (the same formats after « ＋ Ajouter » chained): the formats, and the
// floating controls measured as drawn (each one's box turned by its tilt and scaled as the
// CSS says), apart from each other and inside the screen.

// Clearance between two controls, in CSS px: tilted toward each other, two buttons closer
// than this read as touching (the report's « nearly overlap »).
export const MIN_GAP = 4;
// The floating buttons' foot above the visible bottom, at most: 18a's 34 px, plus a tilt.
export const MAX_FOOT = 40;

// [name, width, height, device pixel ratio, touch]. Phones held upright and sideways.
export const PHONES = [
  ["320x568", 320, 568, 2],
  ["360x640", 360, 640, 2],
  ["360x800", 360, 800, 3],
  ["375x667", 375, 667, 2],
  ["390x844", 390, 844, 3],
  ["412x915", 412, 915, 2.625],
];
export const FORMATS = [
  ...PHONES.map(([n, w, h, d]) => [`phone-${n}`, w, h, d, true]),
  ...PHONES.map(([, w, h, d]) => [`phone-${h}x${w}`, h, w, d, true]),
  ["tablet-768x1024", 768, 1024, 2, true],
  ["tablet-1024x768", 1024, 768, 2, true],
  ["desktop-1280x720", 1280, 720, 1, false],
  ["desktop-1440x900", 1440, 900, 1, false],
  ["desktop-1920x1080", 1920, 1080, 1, false],
];

/** Every floating control shown, as a polygon in CSS px (run in the page); with `whole`, the
 * attribution's whole control (its credit unfolded) rather than its « ⓘ ». */
export const SHAPES = (whole) => {
  const deg = (v) => {
    if (!v || v === "none") return 0;
    const n = Number.parseFloat(v);
    return v.endsWith("rad") ? (n * 180) / Math.PI : v.endsWith("turn") ? n * 360 : n;
  };
  const shape = (name, e) => {
    if (!e?.checkVisibility({ visibilityProperty: true, opacityProperty: true })) return null;
    const box = e.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return null;
    // Its own size, its tilt and scale (the `rotate` and `scale` properties and a
    // `transform`, its ancestors' translations moving its centre only); rotation and scale
    // are about the centre (transform-origin's default), so the box's centre is its own.
    const cs = getComputedStyle(e);
    const m = new DOMMatrix(cs.transform === "none" ? undefined : cs.transform);
    const s = (cs.scale === "none" ? 1 : Number.parseFloat(cs.scale)) * Math.hypot(m.a, m.b);
    const angle = ((deg(cs.rotate) + (Math.atan2(m.b, m.a) * 180) / Math.PI) * Math.PI) / 180;
    const w = (e.offsetWidth * s) / 2;
    const h = (e.offsetHeight * s) / 2;
    const cx = box.left + box.width / 2;
    const cy = box.top + box.height / 2;
    const round = Number.parseFloat(cs.borderTopLeftRadius) >= e.offsetWidth / 2 - 0.5;
    const local = round
      ? Array.from({ length: 32 }, (_, i) => [
          w * Math.cos((i * Math.PI) / 16),
          h * Math.sin((i * Math.PI) / 16),
        ])
      : [
          [-w, -h],
          [w, -h],
          [w, h],
          [-w, h],
        ];
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return {
      name,
      points: local.map(([x, y]) => [cx + x * cos - y * sin, cy + x * sin + y * cos]),
    };
  };
  const q = (s) => document.querySelector(s);
  const attribToggle = q("#attrib-toggle");
  const shapes = [
    shape("ticket", q("#ticket")),
    shape("Standard", q("#estimate button:nth-child(1)")),
    shape("Prudent", q("#estimate button:nth-child(2)")),
    shape("Ajouter", q("#fab-add")),
    shape("Me localiser", q("#fab-locate")),
    shape("zoom +", q(".maplibregl-ctrl-zoom-in")),
    shape("zoom −", q(".maplibregl-ctrl-zoom-out")),
    attribToggle?.checkVisibility() && !whole
      ? shape("ⓘ", attribToggle)
      : shape("attribution", q(".maplibregl-ctrl-attrib")),
  ].filter(Boolean);
  // What the ticket holds stays within its paper sideways (a narrower ticket must wrap, not
  // spill).
  const paper = q("#ticket .ticket-paper")?.getBoundingClientRect();
  const spill = paper
    ? [...document.querySelectorAll("#ticket .ticket-paper *")]
        .filter((e) => e.checkVisibility?.({ visibilityProperty: true }) !== false)
        .map((e) => [e, e.getBoundingClientRect()])
        .filter(([, r]) => r.width > 0 && (r.left < paper.left - 1 || r.right > paper.right + 1))
        .map(([e, r]) => `${e.tagName.toLowerCase()}.${e.className} ${r.left | 0}-${r.right | 0}`)
    : [];
  // The credit unfolded: nothing over it (nine points of its box).
  const credit = q(".maplibregl-ctrl-attrib").getBoundingClientRect();
  const covered = [0.1, 0.5, 0.9]
    .flatMap((fx) => [0.1, 0.5, 0.9].map((fy) => [fx, fy]))
    .map(([fx, fy]) => [credit.left + credit.width * fx, credit.top + credit.height * fy])
    .map(([x, y]) => document.elementFromPoint(x, y))
    .filter((e) => !e?.closest(".maplibregl-ctrl-attrib"))
    .map((e) => e?.closest("[id]")?.id ?? e?.tagName ?? "nothing");
  const vv = window.visualViewport;
  return {
    shapes,
    spill,
    covered: whole ? covered : [],
    vw: vv?.width ?? window.innerWidth,
    vh: vv?.height ?? window.innerHeight,
    phone: matchMedia("(max-width: 600px), (pointer: coarse) and (max-height: 500px)").matches,
    coarse: matchMedia("(pointer: coarse)").matches,
  };
};

// Convex polygons: overlap by separating axes, else their distance (vertex to edge).
const axes = (p) =>
  p.map(([x, y], i) => {
    const [nx, ny] = p[(i + 1) % p.length];
    return [y - ny, nx - x];
  });
const separated = (a, b) =>
  [...axes(a), ...axes(b)].some(([ax, ay]) => {
    const pa = a.map(([x, y]) => x * ax + y * ay);
    const pb = b.map(([x, y]) => x * ax + y * ay);
    return Math.max(...pa) < Math.min(...pb) || Math.max(...pb) < Math.min(...pa);
  });
const toSegment = ([px, py], [ax, ay], [bx, by]) => {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
};
const toPolygon = (pt, p) => Math.min(...p.map((a, i) => toSegment(pt, a, p[(i + 1) % p.length])));
const gap = (a, b) =>
  separated(a, b)
    ? Math.min(...a.map((pt) => toPolygon(pt, b)), ...b.map((pt) => toPolygon(pt, a)))
    : 0;

/** What is wrong with the layout measured (an empty list: nothing). With the credit unfolded
 * (`foot` false: the floating buttons rise above it where it would meet them), it may lie
 * over the ticket's foot on a short screen, on top of it (map.css), never under anything. */
export function problems(m, foot = true) {
  const out = [];
  const { shapes, vw, vh } = m;
  const over = (a, b) => !foot && [a, b].includes("ticket") && [a, b].includes("attribution");
  for (let i = 0; i < shapes.length; i++)
    for (let j = i + 1; j < shapes.length; j++) {
      if (over(shapes[i].name, shapes[j].name)) continue;
      const g = gap(shapes[i].points, shapes[j].points);
      if (g < MIN_GAP) out.push(`${shapes[i].name}/${shapes[j].name} ${g.toFixed(1)} px apart`);
    }
  for (const { name, points } of shapes) {
    const xs = points.map(([x]) => x);
    const ys = points.map(([, y]) => y);
    const [l, r, t, b] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    if (l < -0.5 || t < -0.5 || r > vw + 0.5 || b > vh + 0.5)
      out.push(`${name} out of the screen (${l | 0},${t | 0})-(${r | 0},${b | 0})`);
  }
  const feet = shapes
    .filter((s) => s.name === "Ajouter" || s.name === "Me localiser")
    .map((s) => vh - Math.max(...s.points.map(([, y]) => y)));
  if (foot && feet.length && Math.min(...feet) > MAX_FOOT)
    out.push(`floating buttons ${Math.min(...feet).toFixed(0)} px above the bottom`);
  if (!shapes.some((s) => s.name === "Me localiser")) out.push("no « Me localiser »");
  if (m.spill.length) out.push(`out of the ticket: ${m.spill.join(", ")}`);
  if (m.covered.length) out.push(`the credit under ${[...new Set(m.covered)].join(", ")}`);
  return out;
}
