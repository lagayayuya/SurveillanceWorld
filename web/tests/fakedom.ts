// A small DOM for tests/dc.test.ts (none is installed): the members src/registre/dc.ts
// uses, no parser at all, and two traps that make a mistake loud — a style set as an
// attribute throws (the engine must go through the CSSOM), and every on* attribute set is
// logged (none must be).

export const HTML_NS = "http://www.w3.org/1999/xhtml";
export const SVG_NS = "http://www.w3.org/2000/svg";

type Listener = (e: FakeEvent) => void;

export class FNode {
  nodeType: number;
  nodeName: string;
  parentNode: FElement | null = null;
  childNodes: FNode[] = [];
  ownerDocument: FDocument;
  constructor(doc: FDocument, type: number, name: string) {
    this.ownerDocument = doc;
    this.nodeType = type;
    this.nodeName = name;
  }
  get firstChild() {
    return this.childNodes[0] ?? null;
  }
  get lastChild() {
    return this.childNodes[this.childNodes.length - 1] ?? null;
  }
  appendChild(n: FNode) {
    n.parentNode?.removeChild(n);
    n.parentNode = this as unknown as FElement;
    this.childNodes.push(n);
    return n;
  }
  replaceChild(n: FNode, old: FNode) {
    const i = this.childNodes.indexOf(old);
    if (i < 0) throw new Error("replaceChild: not a child");
    n.parentNode?.removeChild(n);
    this.childNodes[this.childNodes.indexOf(old)] = n;
    n.parentNode = this as unknown as FElement;
    old.parentNode = null;
    return old;
  }
  removeChild(n: FNode) {
    const i = this.childNodes.indexOf(n);
    if (i < 0) throw new Error("removeChild: not a child");
    this.childNodes.splice(i, 1);
    n.parentNode = null;
    return n;
  }
  contains(n: FNode | null): boolean {
    for (let x = n; x; x = x.parentNode) if (x === this) return true;
    return false;
  }
  get textContent(): string {
    return this.childNodes.map((c) => c.textContent).join("");
  }
}

export class FText extends FNode {
  data: string;
  constructor(doc: FDocument, data: string) {
    super(doc, 3, "#text");
    this.data = data;
  }
  override get textContent() {
    return this.data;
  }
}

class FStyle {
  #el: FElement;
  #css = "";
  constructor(el: FElement) {
    this.#el = el;
  }
  get cssText() {
    return this.#css;
  }
  /** Written back the way a browser does (its own spacing, a closing « ; »), so that the
   * engine cannot compare its source with the attribute. */
  set cssText(v: string) {
    const parts = v
      .split(";")
      .map((p) => p.trim().replace(/\s*:\s*/, ": "))
      .filter(Boolean);
    this.#css = parts.length ? `${parts.join("; ")};` : "";
    this.#el.ownerDocument.log.push(`cssText ${this.#el.localName}`);
    if (this.#css) this.#el.attrs.set("style", this.#css);
    else this.#el.attrs.delete("style");
  }
}

export class FElement extends FNode {
  localName: string;
  namespaceURI: string;
  attrs = new Map<string, string>();
  style: FStyle;
  #value = "";
  /** Typed in: the value attribute no longer moves the value (as in a browser). */
  dirty = false;
  listeners = new Map<string, Listener[]>();
  constructor(doc: FDocument, ns: string, name: string) {
    super(doc, 1, ns === HTML_NS ? name.toUpperCase() : name);
    this.namespaceURI = ns;
    this.localName = name;
    this.style = new FStyle(this);
  }
  #name(n: string) {
    return this.namespaceURI === HTML_NS ? n.toLowerCase() : n;
  }
  get attributes() {
    return [...this.attrs].map(([name, value]) => ({ name, value }));
  }
  getAttribute(n: string) {
    return this.attrs.get(this.#name(n)) ?? null;
  }
  hasAttribute(n: string) {
    return this.attrs.has(this.#name(n));
  }
  setAttribute(n: string, v: string) {
    if (n.toLowerCase() === "style") throw new Error("style set as an attribute");
    if (/^on/i.test(n)) this.ownerDocument.log.push(`on-attribute ${n}`);
    this.attrs.set(this.#name(n), String(v));
    if (n === "value" && !this.dirty) this.#value = String(v);
  }
  removeAttribute(n: string) {
    this.attrs.delete(this.#name(n));
  }
  addEventListener(type: string, f: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), f]);
  }
  removeEventListener(type: string, f: Listener) {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((g) => g !== f),
    );
  }
  get value() {
    return this.#value;
  }
  set value(v: string) {
    this.#value = v;
    this.dirty = true;
  }
  get childElements(): FElement[] {
    return this.childNodes.filter((c): c is FElement => c instanceof FElement);
  }
}

export class FDocument {
  activeElement: FElement | null = null;
  /** What the engine did that a test wants to see: cssText writes, on* attributes. */
  log: string[] = [];
  created: { ns: string; name: string }[] = [];
  createElementNS(ns: string, name: string) {
    this.created.push({ ns, name });
    return new FElement(this, ns, name);
  }
  createElement(name: string) {
    return this.createElementNS(HTML_NS, name.toLowerCase());
  }
  createTextNode(data: string) {
    return new FText(this, data);
  }
}

export type FakeEvent = {
  type: string;
  target: FNode;
  relatedTarget: FNode | null;
  clientX?: number;
  key?: string;
  stopped: boolean;
  defaultPrevented: boolean;
  stopPropagation(): void;
  preventDefault(): void;
};

/** Dispatches an event that bubbles from `target` up to the document's top. */
export function dispatch(
  target: FNode,
  type: string,
  init: Partial<Pick<FakeEvent, "relatedTarget" | "clientX" | "key">> = {},
): FakeEvent {
  const e: FakeEvent = {
    type,
    target,
    relatedTarget: null,
    ...init,
    stopped: false,
    defaultPrevented: false,
    stopPropagation() {
      this.stopped = true;
    },
    preventDefault() {
      this.defaultPrevented = true;
    },
  };
  for (let n: FNode | null = target; n && !e.stopped; n = n.parentNode)
    if (n instanceof FElement) for (const f of n.listeners.get(type) ?? []) f(e);
  return e;
}

/** The tree as markup, text escaped: what a browser would show, for assertions. */
export function html(n: FNode): string {
  if (n instanceof FText) return n.data.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const kids = n.childNodes.map(html).join("");
  if (!(n instanceof FElement)) return kids;
  const attrs = n.attributes
    .map((a) => ` ${a.name}="${a.value.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"`)
    .join("");
  return `<${n.localName}${attrs}>${kids}</${n.localName}>`;
}

/** Every element of the tree, `n` included. */
export function all(n: FNode): FElement[] {
  const out = n instanceof FElement ? [n] : [];
  for (const c of n.childNodes) out.push(...all(c));
  return out;
}

export function fakeRoot() {
  const doc = new FDocument();
  const root = new FElement(doc, HTML_NS, "div");
  return { doc, root };
}
