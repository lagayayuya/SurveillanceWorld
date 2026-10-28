// The registre's template engine: the mockups' templates (the « .dc.html » format) rendered
// as they are, so that the views draw the validated markup instead of a hand copy of it.
// A template holds paths, never expressions: {{a.b}} in text and attributes, {{{a.b}}} for
// a rich value (Rich: words, bold, links), <sc-for list="{{x}}" as="y"> (y and yIndex in
// scope), <sc-if value="{{x}}">, on* attributes bound to the view's functions, <dc-include
// src="name"> of a <dc-part name="name"> given at mount, data-dc-keep on a node someone
// else fills (the map). hint-* attributes belong to the mockup tool and are dropped.
// A value is data, never markup: the template is read by the tokenizer below (the browser's
// parser would also move <sc-for> out of <tbody>), every node is made with createElement /
// createTextNode / setAttribute and every inline style goes through the CSSOM (cssText),
// which a strict CSP allows; no string from a view ever reaches an HTML parser.
// Each render patches the live DOM node by node: the focused field, its caret, the scroll
// and the hovered row survive it.

/** A rich value: text with emphasis and links, built as nodes, every string a text node. */
export type Rich = string | RichItem[];
export type RichItem =
  | string
  | { strong: Rich }
  | { em: Rich }
  | { a: { href: string; text: Rich; cls?: string; label?: string } }
  | { br: true }
  | { span: Rich; cls: string };

/** What renderVals() returns: the template's paths are read in it. */
export type Vals = Record<string, unknown>;

/** The event a handler gets: the native one, the element the handler sits on, and the
 * fields the views read (0 or "" when the event has none). */
export type DcEvent = {
  nativeEvent: Event;
  type: string;
  target: EventTarget | null;
  currentTarget: Element;
  /** The value of the field the event comes from (a search box's), "" otherwise. */
  value: string;
  clientX: number;
  clientY: number;
  pointerId: number;
  key: string;
  button: number;
  stopPropagation(): void;
  preventDefault(): void;
};
export type Handler = (e: DcEvent) => void;

type Hole = { path: string[]; rich: boolean };
type Seg = string | Hole;
type TAttr = { name: string; segs: Seg[]; whole: Hole | null };
type TNode =
  | { k: "text"; segs: Seg[] }
  | { k: "el"; name: string; tag: string; attrs: TAttr[]; kids: TNode[] }
  | { k: "for"; list: string[]; as: string; kids: TNode[] }
  | { k: "if"; value: string[]; kids: TNode[] }
  | { k: "include"; src: string }
  | { k: "part"; name: string; kids: TNode[] };

/** A parsed template (parse()). */
export type Template = { kids: TNode[] };
/** The shared pieces a template includes, by name (parseParts()). */
export type Parts = Record<string, Template>;

const HTML = "http://www.w3.org/1999/xhtml";
const SVG = "http://www.w3.org/2000/svg";
const MATHML = "http://www.w3.org/1998/Math/MathML";
const VOID = new Set("area base br col embed hr img input link meta source track wbr".split(" "));
const EVENTS: Record<string, string> = {
  onclick: "click",
  onmouseenter: "mouseenter",
  onfocus: "focus",
  oninput: "input",
  onchange: "change",
  onkeydown: "keydown",
  onpointerdown: "pointerdown",
  onpointermove: "pointermove",
  onpointerup: "pointerup",
  onpointerleave: "pointerleave",
};
/** Where a link or a resource is fetched or followed: a `javascript:` there would run. */
const URL_ATTRS = new Set(["href", "src", "xlink:href", "action", "formaction", "poster"]);
/** A style value that would fetch something (a third-party request) or hide such a word
 * behind a CSS escape: dropped. */
const BAD_CSS = /url\s*\(|image(-set)?\s*\(|expression\s*\(|@import|\\/i;
/** Names a path never reads: the object machinery, and words a reader would take for a
 * literal (the prototype read {{true}} as one; here a template holds paths only). */
const BANNED = new Set([
  "__proto__",
  "prototype",
  "constructor",
  "true",
  "false",
  "null",
  "undefined",
]);
const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
};

// --- parse ------------------------------------------------------------------------------

/** "a.b.c" -> ["a", "b", "c"]; anything else is a mistake in the template, said at once. */
function pathOf(src: string): string[] {
  const s = src.trim();
  const path = s.split(".");
  if (!/^[A-Za-z_$][\w$]*(\.[\w$]+)*$/.test(s) || path.some((p) => BANNED.has(p)))
    throw new Error(`dc: {{${src}}} is not a path`);
  return path;
}

/** The template's own character references (its words); values are never decoded. */
const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, r: string) => {
    if (r[0] !== "#") return ENTITIES[r.toLowerCase()] ?? m;
    const cp = r[1] === "x" || r[1] === "X" ? Number.parseInt(r.slice(2), 16) : Number(r.slice(1));
    return cp > 0 && cp <= 0x10ffff && (cp < 0xd800 || cp > 0xdfff) ? String.fromCodePoint(cp) : m;
  });

function segsOf(s: string): Seg[] {
  const out: Seg[] = [];
  let i = 0;
  for (const m of s.matchAll(/\{\{\{([^{}]*)\}\}\}|\{\{([^{}]*)\}\}/g)) {
    if (m.index > i) out.push(decode(s.slice(i, m.index)));
    out.push({ path: pathOf(m[1] ?? m[2]), rich: m[1] !== undefined });
    i = m.index + m[0].length;
  }
  if (i < s.length) out.push(decode(s.slice(i)));
  return out;
}

/** The value when it is a single {{path}} (a list, a condition, a handler, an attribute
 * dropped when its value is empty). */
function wholeOf(s: string): Hole | null {
  const segs = segsOf(s.trim());
  const h = segs[0];
  return segs.length === 1 && typeof h !== "string" && !h.rich ? h : null;
}

/** Parses a template. The tokenizer reads the mockups' markup: tags closed explicitly
 * (an end tag closes up to its element), void elements, `/>`, comments dropped. */
export function parse(src: string): Template {
  type Open = { tag: string; kids: TNode[] };
  const root: Open = { tag: "#root", kids: [] };
  const stack: Open[] = [root];
  const top = () => stack[stack.length - 1];
  const text = (s: string) => {
    if (s) top().kids.push({ k: "text", segs: segsOf(s) });
  };
  const re =
    /<!--[\s\S]*?-->|<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>/g;
  let i = 0;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    text(src.slice(i, m.index));
    i = re.lastIndex;
    if (m[0].startsWith("<!--")) continue;
    if (m[1]) {
      const t = m[1].toLowerCase();
      for (let k = stack.length - 1; k > 0; k--)
        if (stack[k].tag === t) {
          stack.length = k;
          break;
        }
      continue;
    }
    const name = m[2];
    const tag = name.toLowerCase();
    const raw = new Map<string, string>();
    for (const a of m[3].matchAll(/([^\s=>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g))
      if (!a[1].toLowerCase().startsWith("hint-")) raw.set(a[1], a[2] ?? a[3] ?? a[4] ?? "");
    if (tag === "script" || tag === "style" || tag === "textarea") {
      // Raw text up to the end tag; a script never runs (dropped), a style or a textarea
      // keeps its text as it is written.
      const end = src.toLowerCase().indexOf(`</${tag}`, i);
      const body = end < 0 ? src.slice(i) : src.slice(i, end);
      i = end < 0 ? src.length : src.indexOf(">", end) + 1 || src.length;
      re.lastIndex = i;
      if (tag !== "script")
        top().kids.push({ k: "el", name, tag, attrs: [], kids: [{ k: "text", segs: [body] }] });
      continue;
    }
    const need = (a: string) => {
      const h = wholeOf(raw.get(a) ?? "");
      if (!h) throw new Error(`dc: <${tag} ${a}> needs one {{path}}`);
      return h.path;
    };
    let node: TNode;
    if (tag === "sc-for") {
      const as = raw.get("as") ?? "";
      if (!/^[A-Za-z_$][\w$]*$/.test(as) || BANNED.has(as))
        throw new Error(`dc: <sc-for as="${as}">`);
      node = { k: "for", list: need("list"), as, kids: [] };
    } else if (tag === "sc-if") node = { k: "if", value: need("value"), kids: [] };
    else if (tag === "dc-part") node = { k: "part", name: raw.get("name") ?? "", kids: [] };
    else if (tag === "dc-include") {
      top().kids.push({ k: "include", src: raw.get("src") ?? "" });
      continue;
    } else if (tag === "dc-import") continue;
    else {
      const attrs = [...raw].map(([n, v]) => ({ name: n, segs: segsOf(v), whole: wholeOf(v) }));
      node = { k: "el", name, tag, attrs, kids: [] };
      if (m[4] || VOID.has(tag)) {
        top().kids.push(node);
        continue;
      }
    }
    top().kids.push(node);
    stack.push({ tag, kids: node.kids });
  }
  text(src.slice(i));
  return { kids: root.kids };
}

/** The shared pieces of a file of <dc-part name="…"> blocks (the « socle »), by name. */
export function parseParts(src: string): Parts {
  const parts: Parts = {};
  for (const n of parse(src).kids) if (n.k === "part") parts[n.name] = { kids: n.kids };
  return parts;
}

// --- render: the template and the values into a tree of plain objects -------------------

type VEl = {
  name: string;
  ns: string;
  attrs: Map<string, string>;
  style: string | null;
  on: Map<string, Handler> | null;
  keep: boolean;
  kids: VNode[];
};
/** A text node is its string. */
type VNode = string | VEl;

/** A catalogue's message with placeholders, filled from the paths of the scope where the template
 * reads it: `{{f.commune.depuis}}` inside a loop reads its item's values (MountOptions.format). */
export type Format = (key: string, read: (path: string) => unknown) => string;
// The formatter of the render in progress (renders are synchronous: one at a time).
let formatting: Format | null = null;

function lookup(path: string[], scope: Vals[]): unknown {
  if (path[0] === "f" && formatting && !scope.some((s) => Object.hasOwn(s, "f"))) {
    const format = formatting;
    return format(path.slice(1).join("."), (p) => lookup(p.split("."), scope));
  }
  let v: unknown;
  for (let k = scope.length - 1; k >= 0; k--)
    if (Object.hasOwn(scope[k], path[0])) {
      v = scope[k][path[0]];
      break;
    }
  for (let k = 1; k < path.length && v != null; k++) v = (v as Record<string, unknown>)[path[k]];
  return v;
}

/** Nothing for an empty value (null, undefined, false) and for a function. */
const str = (v: unknown) =>
  v == null || v === false || typeof v === "function"
    ? ""
    : Array.isArray(v)
      ? richText(v)
      : String(v);

/** A rich value as plain text (an attribute, an SVG text, a label). */
export function richText(v: unknown, depth = 0): string {
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (depth > 16 || !v || typeof v !== "object") return "";
  if (Array.isArray(v)) return v.map((x) => richText(x, depth + 1)).join("");
  const o = v as Record<string, unknown>;
  if ("br" in o) return "\n";
  const inner = "a" in o ? (o.a as { text?: unknown } | null)?.text : (o.strong ?? o.em ?? o.span);
  return richText(inner, depth + 1);
}

/** The URL unless following it would run code: browsers drop controls and blanks from a
 * scheme, so they are dropped before the test. */
export function safeUrl(url: string): string | null {
  let bare = "";
  for (const c of url) if (c > " " && c !== "\x7f") bare += c;
  return /^(javascript|vbscript):/i.test(bare) ? null : url;
}

function pushText(out: VNode[], s: string) {
  if (!s) return;
  const last = out.length - 1;
  if (typeof out[last] === "string") out[last] += s;
  else out.push(s);
}

const vel = (name: string, attrs: [string, string][], kids: VNode[]): VEl => ({
  name,
  ns: HTML,
  attrs: new Map(attrs),
  style: null,
  on: null,
  keep: false,
  kids,
});

function richInto(v: unknown, out: VNode[], depth: number) {
  if (typeof v === "string" || typeof v === "number") {
    pushText(out, String(v));
    return;
  }
  if (depth > 16 || !v || typeof v !== "object") return;
  if (Array.isArray(v)) {
    for (const x of v) richInto(x, out, depth + 1);
    return;
  }
  const o = v as Record<string, unknown>;
  const kids = (r: unknown) => {
    const k: VNode[] = [];
    richInto(r, k, depth + 1);
    return k;
  };
  const cls = (c: unknown): [string, string][] =>
    typeof c === "string" && c ? [["class", c]] : [];
  if ("strong" in o) out.push(vel("strong", [], kids(o.strong)));
  else if ("em" in o) out.push(vel("em", [], kids(o.em)));
  else if ("span" in o) out.push(vel("span", cls(o.cls), kids(o.span)));
  else if ("br" in o) out.push(vel("br", [], []));
  else if ("a" in o && o.a && typeof o.a === "object") {
    const a = o.a as Record<string, unknown>;
    const href = typeof a.href === "string" ? safeUrl(a.href) : null;
    const text = kids(a.text);
    // A refused link keeps its words, without the link.
    if (href === null)
      for (const k of text) {
        if (typeof k === "string") pushText(out, k);
        else out.push(k);
      }
    else {
      const attrs: [string, string][] = [["href", href], ...cls(a.cls)];
      if (typeof a.label === "string") attrs.push(["aria-label", a.label]);
      out.push(vel("a", attrs, text));
    }
  }
}

type Ctx = { parts: Parts; depth: number };

function build(nodes: TNode[], scope: Vals[], c: Ctx, ns: string, out: VNode[]) {
  for (const n of nodes) {
    if (n.k === "text") {
      for (const s of n.segs) {
        if (typeof s === "string") pushText(out, s);
        else if (!s.rich) pushText(out, str(lookup(s.path, scope)));
        // Inside an SVG or a formula, bold and links mean nothing: the words alone.
        else if (ns === HTML) richInto(lookup(s.path, scope), out, 0);
        else pushText(out, richText(lookup(s.path, scope)));
      }
    } else if (n.k === "for") {
      const list = lookup(n.list, scope);
      if (Array.isArray(list))
        list.forEach((item, idx) => {
          build(n.kids, [...scope, { [n.as]: item, [`${n.as}Index`]: idx }], c, ns, out);
        });
    } else if (n.k === "if") {
      if (lookup(n.value, scope)) build(n.kids, scope, c, ns, out);
    } else if (n.k === "include") {
      // A part that includes itself stops instead of filling the stack.
      const p = Object.hasOwn(c.parts, n.src) ? c.parts[n.src] : undefined;
      if (p && c.depth < 8) build(p.kids, scope, { parts: c.parts, depth: c.depth + 1 }, ns, out);
    } else if (n.k === "el") out.push(element(n, scope, c, ns));
  }
}

function element(n: Extract<TNode, { k: "el" }>, scope: Vals[], c: Ctx, parentNs: string): VEl {
  const ns = n.tag === "svg" ? SVG : n.tag === "math" ? MATHML : parentNs;
  const v: VEl = {
    name: ns === HTML ? n.tag : n.name,
    ns,
    attrs: new Map(),
    style: null,
    on: null,
    keep: false,
    kids: [],
  };
  for (const a of n.attrs) {
    const lower = a.name.toLowerCase();
    if (lower.startsWith("on")) {
      // Only ever a function of the view; a string here (the template's or a value) is
      // never set, as an attribute it would run.
      const f = a.whole ? lookup(a.whole.path, scope) : null;
      if (EVENTS[lower] && typeof f === "function") {
        v.on ??= new Map();
        v.on.set(EVENTS[lower], f as Handler);
      }
      continue;
    }
    const style = lower === "style";
    let val: string | null;
    if (a.whole) {
      const x = lookup(a.whole.path, scope);
      // aria-* says false aloud; elsewhere false means no attribute.
      val =
        x == null || typeof x === "function" || (x === false && !lower.startsWith("aria-"))
          ? null
          : str(x === false ? "false" : x);
      if (style && val && BAD_CSS.test(val)) val = null;
    } else
      val = a.segs
        .map((s) => {
          if (typeof s === "string") return s;
          const x = lookup(s.path, scope);
          const t = s.rich ? richText(x) : str(x);
          return style && BAD_CSS.test(t) ? "" : t;
        })
        .join("");
    if (val === null || (URL_ATTRS.has(lower) && safeUrl(val) === null)) continue;
    if (style) v.style = val;
    else {
      if (lower === "data-dc-keep") v.keep = true;
      v.attrs.set(ns === HTML ? lower : a.name, val);
    }
  }
  if (!VOID.has(n.tag)) build(n.kids, scope, c, n.tag === "foreignobject" ? HTML : ns, v.kids);
  return v;
}

// --- patch the live DOM -----------------------------------------------------------------

const handlers = new WeakMap<Element, Map<string, Handler>>();
/** The style last given to an element, and how the browser wrote it back: what someone else
 * changed since is put back, what did not change is not set again. */
const styles = new WeakMap<Element, { css: string; attr: string | null }>();

function setStyle(el: Element, css: string | null, keep: boolean) {
  const last = styles.get(el);
  const now = el.getAttribute("style");
  if (css === null) {
    if (!keep && now !== null) el.removeAttribute("style");
    styles.delete(el);
    return;
  }
  if (last && last.css === css && (keep || last.attr === now)) return;
  (el as HTMLElement).style.cssText = css;
  styles.set(el, { css, attr: el.getAttribute("style") });
}

/** The attributes a kept node last got from its template: only what the template changes
 * is written again, so the owner's own changes (maplibre's class) stay. */
const kept = new WeakMap<Element, Map<string, string>>();

function setOn(el: Element, on: Map<string, Handler> | null) {
  if (on) handlers.set(el, on);
  else handlers.delete(el);
}

/** A field's value as the template says, unless the reader is typing in it. */
function setValue(el: Element, v: VEl) {
  if (v.ns !== HTML || (v.name !== "input" && v.name !== "textarea")) return;
  const want = v.name === "input" ? (v.attrs.get("value") ?? "") : v.kids.join("");
  const f = el as HTMLInputElement;
  if (el !== el.ownerDocument.activeElement && f.value !== want) f.value = want;
}

function create(doc: Document, v: VNode): Node {
  if (typeof v === "string") return doc.createTextNode(v);
  const el = doc.createElementNS(v.ns, v.name);
  for (const [k, val] of v.attrs) el.setAttribute(k, val);
  setStyle(el, v.style, false);
  setOn(el, v.on);
  if (v.keep) kept.set(el, v.attrs);
  patchKids(doc, el, v.kids);
  setValue(el, v);
  return el;
}

const same = (n: Node, v: VNode) =>
  typeof v === "string"
    ? n.nodeType === 3
    : n.nodeType === 1 &&
      (n as Element).namespaceURI === v.ns &&
      (n as Element).localName === v.name &&
      (n as Element).hasAttribute("data-dc-keep") === v.keep;

function update(el: Element, v: VEl) {
  if (v.keep) {
    // Someone else's node (the map): what the template changed in its attributes is set,
    // the rest (the owner's class) kept, its children left alone.
    const last = kept.get(el);
    for (const [k, val] of v.attrs) if (last?.get(k) !== val) el.setAttribute(k, val);
    if (last) for (const k of last.keys()) if (!v.attrs.has(k)) el.removeAttribute(k);
    kept.set(el, v.attrs);
    setStyle(el, v.style, true);
    setOn(el, v.on);
    return;
  }
  for (const a of Array.from(el.attributes))
    if (a.name !== "style" && !v.attrs.has(a.name)) el.removeAttribute(a.name);
  for (const [k, val] of v.attrs) if (el.getAttribute(k) !== val) el.setAttribute(k, val);
  setStyle(el, v.style, false);
  setOn(el, v.on);
  patchKids(el.ownerDocument, el, v.kids);
  setValue(el, v);
}

function patchKids(doc: Document, parent: Node, vs: VNode[]) {
  const live = parent.childNodes;
  vs.forEach((v, i) => {
    const n = live[i];
    if (!n) parent.appendChild(create(doc, v));
    else if (!same(n, v)) parent.replaceChild(create(doc, v), n);
    else if (typeof v === "string") {
      if ((n as Text).data !== v) (n as Text).data = v;
    } else update(n as Element, v);
  });
  while (live.length > vs.length) parent.removeChild(live[live.length - 1]);
}

// --- events: delegated to the root ------------------------------------------------------

/** The native events listened to on the root, the template's event each one fires, and
 * whether it is an enter / leave (not fired again while the pointer stays inside). */
const LISTEN: [string, string, boolean][] = [
  ["click", "click", false],
  ["input", "input", false],
  ["change", "change", false],
  ["keydown", "keydown", false],
  ["pointerdown", "pointerdown", false],
  ["pointermove", "pointermove", false],
  ["pointerup", "pointerup", false],
  ["mouseover", "mouseenter", true],
  ["pointerout", "pointerleave", true],
  ["focusin", "focus", false],
];

function wrap(e: Event, el: Element, stop: () => void): DcEvent {
  const m = e as Partial<PointerEvent & KeyboardEvent>;
  const t = e.target as { value?: unknown } | null;
  return {
    nativeEvent: e,
    type: e.type,
    target: e.target,
    currentTarget: el,
    value: typeof t?.value === "string" ? t.value : "",
    clientX: m.clientX ?? 0,
    clientY: m.clientY ?? 0,
    pointerId: m.pointerId ?? 0,
    key: m.key ?? "",
    button: m.button ?? 0,
    stopPropagation() {
      stop();
      e.stopPropagation();
    },
    preventDefault() {
      e.preventDefault();
    },
  };
}

function fire(root: Element, type: string, e: Event, enterLeave: boolean) {
  let stopped = false;
  const related = (e as MouseEvent).relatedTarget as Node | null;
  for (let n = e.target as Node | null; n; n = n.parentNode) {
    const f = n.nodeType === 1 ? handlers.get(n as Element)?.get(type) : undefined;
    if (f && !(enterLeave && related && n.contains(related))) {
      f(
        wrap(e, n as Element, () => {
          stopped = true;
        }),
      );
      // A focus or a keystroke is the field's own: its ancestors do not get it again.
      if (stopped || type === "focus" || type === "input") break;
    }
    if (n === root) break;
  }
}

// --- views ------------------------------------------------------------------------------

const schedules = new WeakMap<object, () => void>();

/** A view: its state, setState, renderVals() for the template, and the lifecycle the
 * mockups' components have. */
export abstract class View<P extends object = Record<string, unknown>, S extends object = object> {
  props: P;
  state: S;
  constructor(props: P) {
    this.props = props;
    this.state = {} as S;
  }
  abstract renderVals(): Vals;
  componentDidMount?(): void;
  /** After every render, the first one included. */
  componentDidUpdate?(): void;
  componentWillUnmount?(): void;
  /** Renders again (once per microtask) only when a value changes: a hover over the row
   * already shown costs nothing. */
  setState(patch: Partial<S> | ((state: S, props: P) => Partial<S>)): void {
    const next = typeof patch === "function" ? patch(this.state, this.props) : patch;
    let same = true;
    for (const k in next)
      if (this.state[k] !== next[k]) {
        same = false;
        break;
      }
    if (same) return;
    this.state = { ...this.state, ...next };
    schedules.get(this)?.();
  }
}

export type MountOptions = {
  /** The pieces <dc-include src> names (parseParts() of the socle). */
  parts?: Parts;
  /** After each render, once the DOM is patched (the titles' fit, the phone's tables). */
  afterRender?: (root: Element) => void;
  /** What fills `{{f.<key>}}`: a message of the catalogue with its placeholders (Format). */
  format?: Format;
};

export type Mounted<V> = {
  view: V;
  /** Renders again at the next microtask (a theme change: the view's state did not move). */
  update(): void;
  /** componentWillUnmount, then the listeners and the rendered nodes go. */
  unmount(): void;
};

/** Renders a view into `root` and keeps it in step with its state. */
export function mount<P extends object, V extends View<P>>(
  root: Element,
  Comp: new (props: P) => V,
  props: P,
  template: string | Template,
  opts: MountOptions = {},
): Mounted<V> {
  const tpl = typeof template === "string" ? parse(template) : template;
  const parts = opts.parts ?? {};
  const doc = root.ownerDocument;
  const ns = root.namespaceURI ?? HTML;
  const view = new Comp(props);
  let queued = false;
  let live = true;
  const render = () => {
    queued = false;
    if (!live) return;
    const out: VNode[] = [];
    formatting = opts.format ?? null;
    try {
      build(tpl.kids, [view.renderVals()], { parts, depth: 0 }, ns, out);
    } finally {
      formatting = null;
    }
    patchKids(doc, root, out);
    view.componentDidUpdate?.();
    opts.afterRender?.(root);
  };
  const schedule = () => {
    if (live && !queued) {
      queued = true;
      queueMicrotask(render);
    }
  };
  const listeners = LISTEN.map(([native, type, el]): [string, (e: Event) => void] => [
    native,
    (e) => fire(root, type, e, el),
  ]);
  for (const [t, f] of listeners) root.addEventListener(t, f);
  schedules.set(view, schedule);
  render();
  view.componentDidMount?.();
  return {
    view,
    update: schedule,
    unmount() {
      if (!live) return;
      live = false;
      schedules.delete(view);
      view.componentWillUnmount?.();
      for (const [t, f] of listeners) root.removeEventListener(t, f);
      while (root.lastChild) root.removeChild(root.lastChild);
    },
  };
}
