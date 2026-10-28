// The registre's template engine (src/registre/dc.ts) and its texts (catalogue.ts), in a
// small DOM of the test's own (tests/fakedom.ts): whatever a value holds, it ends up as
// text or as one attribute's value, never as markup, a new attribute or code; a handler is
// only ever a function of the view; a link that would run code is refused; the template
// holds paths, not expressions; and the prototype's behaviour stays — nodes kept across a
// render (focus, caret, scroll), data-dc-keep, a setState that changes nothing renders
// nothing, the lifecycle, the parts.
//   node --test --experimental-strip-types tests/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { nest } from "../src/registre/catalogue.ts";
import {
  type DcEvent,
  type Format,
  type MountOptions,
  mount,
  parse,
  parseParts,
  type Rich,
  type Vals,
  View,
} from "../src/registre/dc.ts";
import {
  all,
  dispatch,
  FElement,
  FText,
  fakeRoot,
  HTML_NS,
  html,
  SVG_NS,
} from "./fakedom.ts";

const src = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");
const tick = () => new Promise((r) => setTimeout(r, 0));

/** Mounts a view whose values are `vals` (a function: read at each render). */
function show(template: string, vals: Vals | (() => Vals), opts?: MountOptions) {
  const { doc, root } = fakeRoot();
  class V extends View {
    renderVals() {
      return typeof vals === "function" ? vals() : vals;
    }
  }
  const m = mount(root as unknown as Element, V, {}, template, opts);
  return { doc, root, m };
}
const first = (root: FElement, name: string) => {
  const el = all(root).find((e) => e !== root && e.localName === name);
  assert.ok(el, `no <${name}>`);
  return el;
};

// --- the engine's source --------------------------------------------------------------

test("dc.ts builds nodes: it never parses markup nor runs a string", () => {
  for (const f of ["registre/dc.ts", "registre/catalogue.ts"]) {
    const s = src(f);
    for (const word of [
      /\beval\b/,
      /new\s+Function/,
      /innerHTML/,
      /outerHTML/,
      /insertAdjacentHTML/,
      /document\.write/,
      /setAttribute\(\s*["']style/,
    ])
      assert.ok(!word.test(s), `${f} holds ${word}`);
  }
});

// --- escaping: a value is data ------------------------------------------------------------

test("a value in a text hole is text, whatever it holds", () => {
  const values = [
    "<script>alert(1)</script>",
    '"guillemets" & <b>gras</b>',
    "<img src=x onerror=alert(1)>",
    "&amp; &lt;déjà échappé&gt;",
    "{{t.x}} {{{y}}}",
  ];
  for (const v of values) {
    const { root, doc } = show("<p>{{v}}</p>", { v });
    const p = first(root, "p");
    assert.equal(p.childNodes.length, 1);
    assert.ok(p.childNodes[0] instanceof FText);
    assert.equal((p.childNodes[0] as FText).data, v);
    assert.deepEqual(
      all(root).map((e) => e.localName),
      ["div", "p"],
      "no element made from a value",
    );
    assert.deepEqual(doc.log, []);
  }
  const { root } = show("<p>{{v}}</p>", { v: "<script>alert(1)</script>" });
  assert.equal(html(root), "<div><p>&lt;script&gt;alert(1)&lt;/script&gt;</p></div>");
});

test("a value in an attribute stays one attribute's value", () => {
  const v = '" onclick="alert(1)" x="';
  const { root, doc } = show('<a title="{{v}}" class="lien {{v}}" href="#/x">ok</a>', { v });
  const a = first(root, "a");
  assert.deepEqual(
    a.attributes.map((x) => x.name),
    ["title", "class", "href"],
  );
  assert.equal(a.getAttribute("title"), v);
  assert.equal(a.getAttribute("class"), `lien ${v}`);
  assert.deepEqual(doc.log, [], "no on* attribute set");
});

test("an on* attribute is bound to a function of the view, nothing else", () => {
  const calls: string[] = [];
  const f = (e: DcEvent) => calls.push(`f ${(e.currentTarget as unknown as FElement).localName}`);
  const { root, doc } = show(
    '<button onClick="{{s}}" onclick="alert(1)" onMouseOver="{{f}}" onFocus="alert({{s}})">b</button>' +
      '<a onClick="{{f}}" onclick2="{{f}}">a</a><i onClick="{{n}}">i</i>',
    { s: "alert(1)", f, n: 42 },
  );
  for (const el of all(root))
    assert.ok(!el.attributes.some((x) => /^on/i.test(x.name)), `${el.localName} has an on*`);
  assert.deepEqual(doc.log, []);
  dispatch(first(root, "button"), "click");
  dispatch(first(root, "i"), "click");
  assert.deepEqual(calls, [], "a string or a number is never a handler");
  dispatch(first(root, "a"), "click");
  assert.deepEqual(calls, ["f a"]);
});

test("a link or a source that would run code is refused", () => {
  const refused = [
    "javascript:alert(1)",
    " JaVaScRiPt:alert(1)",
    "java\tscript:alert(1)",
    "\u0001javascript:alert(1)",
    "java\nscript:alert(1)",
    "vbscript:msgbox(1)",
  ];
  for (const u of refused) {
    const { root } = show('<a href="{{u}}">x</a><img src="{{u}}"><a href="{{u}}x">y</a>', { u });
    for (const el of all(root)) {
      assert.equal(el.getAttribute("href"), null, JSON.stringify(u));
      assert.equal(el.getAttribute("src"), null, JSON.stringify(u));
    }
  }
  const { root } = show('<a href="java{{x}}">x</a>', { x: "script:alert(1)" });
  assert.equal(first(root, "a").getAttribute("href"), null, "a split scheme is still refused");
  for (const u of ["#/commune/69123", "https://www.data.gouv.fr/", "/registre?q=drone", "mailto:x@example.org"]) {
    const { root } = show('<a href="{{u}}">x</a>', { u });
    assert.equal(first(root, "a").getAttribute("href"), u);
  }
});

test("inline styles go through the CSSOM; a style value that would fetch is dropped", () => {
  const { root, doc } = show('<div style="width: 10px; color: {{c}}"></div><p style="{{s}}"></p>', {
    c: "red",
    s: "display:none",
  });
  assert.equal(first(root, "div").getAttribute("style"), "width: 10px; color: red;");
  assert.equal(first(root, "p").getAttribute("style"), "display: none;");
  assert.deepEqual(doc.log, ["cssText div", "cssText p"]);
  for (const s of [
    "background: url(https://tracker.example/x.png)",
    "background-image: image-set('x.png' 1x)",
    "background: u\\72l(x)",
    "width: expression(alert(1))",
  ]) {
    const { root } = show('<p style="{{s}}"></p><div style="color: red; {{s}}"></div>', { s });
    assert.equal(first(root, "p").getAttribute("style"), null, s);
    assert.equal(first(root, "div").getAttribute("style"), "color: red;", s);
  }
});

// --- rich values ------------------------------------------------------------------------

test("{{{ }}} builds a rich value as nodes, every string escaped", () => {
  const lead: Rich = [
    "En 2024, la préfecture a autorisé ",
    { strong: "12 caméras" },
    " <script>x</script> à ",
    { a: { href: "#/commune/69123", text: ["la ", { em: "mairie" }], cls: "lien", label: "Lyon" } },
    ".",
    { br: true },
    { span: ["note <i>", { strong: "&" }], cls: "muted" },
  ];
  const { root, doc } = show('<p class="lead">{{{lead}}}</p>', { lead });
  assert.equal(
    html(root),
    '<div><p class="lead">En 2024, la préfecture a autorisé <strong>12 caméras</strong> &lt;script&gt;x&lt;/script&gt; à ' +
      '<a href="#/commune/69123" class="lien" aria-label="Lyon">la <em>mairie</em></a>.<br></br>' +
      '<span class="muted">note &lt;i&gt;<strong>&amp;</strong></span></p></div>',
  );
  assert.deepEqual(doc.log, []);
  const plain = show("<p>{{{s}}}</p>", { s: "<b>pas du gras</b>" });
  assert.equal(html(plain.root), "<div><p>&lt;b&gt;pas du gras&lt;/b&gt;</p></div>");
});

test("a rich link that would run code keeps its words, not the link; unknown shapes are dropped", () => {
  const r = [
    { a: { href: "javascript:alert(1)", text: ["voir ", { strong: "ici" }] } },
    { script: "alert(1)" },
    { img: { src: "x", onerror: "alert(1)" } },
    { a: { href: 42, text: "nombre" } },
    null,
    7,
  ];
  const { root } = show("<p>{{{r}}}</p>", { r });
  assert.equal(html(root), "<div><p>voir <strong>ici</strong>nombre7</p></div>");
});

test("a rich value in an attribute, or inside an SVG, is its words", () => {
  const r: Rich = ["12 ", { strong: "caméras" }, " à ", { a: { href: "#/x", text: "Lyon" } }];
  const { root } = show('<p aria-label="{{{r}}}" title="{{r}}"></p><svg><text>{{{r}}}</text></svg>', { r });
  assert.equal(first(root, "p").getAttribute("aria-label"), "12 caméras à Lyon");
  assert.equal(first(root, "p").getAttribute("title"), "12 caméras à Lyon");
  const t = first(root, "text");
  assert.equal(t.childNodes.length, 1);
  assert.equal(t.textContent, "12 caméras à Lyon");
});

// --- the template's language ------------------------------------------------------------

test("a template holds paths only", () => {
  for (const bad of [
    "<p>{{a + b}}</p>",
    "<p>{{f()}}</p>",
    "<p>{{a[0]}}</p>",
    "<p>{{a.__proto__.x}}</p>",
    "<p>{{constructor}}</p>",
    "<p>{{ }}</p>",
    "<p>{{true}}</p>",
    '<p title="{{a ? b : c}}"></p>',
    '<sc-for list="items" as="i"></sc-for>',
    '<sc-for list="{{items}}" as="a.b"></sc-for>',
    '<sc-if value="{{a}} {{b}}"></sc-if>',
  ])
    assert.throws(() => parse(bad), /dc:/, bad);
  parse("<p>{{ a.b }} {{x.y.z}} {{{r.l1}}} {{t.commune.titre}} {{list.0}}</p>");
});

test("sc-for gives the item and its index, sc-if tests the value", () => {
  const { root } = show(
    '<ul><sc-for list="{{rows}}" as="r"><li data-i="{{rIndex}}">{{r.l}}<sc-for list="{{r.kids}}" as="k"> {{k}}/{{r.l}}</sc-for></li></sc-for></ul>' +
      '<sc-for list="{{none}}" as="x"><b>{{x}}</b></sc-for>' +
      '<sc-if value="{{yes}}"><em>oui</em></sc-if><sc-if value="{{no}}"><em>non</em></sc-if>' +
      '<sc-if value="{{zero}}"><em>zéro</em></sc-if><sc-if value="{{empty}}"><em>vide</em></sc-if><sc-if value="{{missing.deep}}"><em>?</em></sc-if>',
    { rows: [{ l: "a", kids: [1, 2] }, { l: "b" }], none: "pas une liste", yes: 1, no: false, zero: 0, empty: "" },
  );
  assert.equal(
    html(root),
    '<div><ul><li data-i="0">a 1/a 2/a</li><li data-i="1">b</li></ul><em>oui</em></div>',
  );
});

test("an attribute whose one value is empty is dropped; aria-* says false", () => {
  const { root } = show(
    '<button hidden="{{f}}" aria-expanded="{{f}}" aria-pressed="{{t}}" aria-sort="{{n}}" data-n="{{z}}" title="{{u}}" class="a {{u}} b">x</button>',
    { f: false, t: true, n: null, z: 0 },
  );
  const b = first(root, "button");
  assert.deepEqual(Object.fromEntries(b.attrs), {
    "aria-expanded": "false",
    "aria-pressed": "true",
    "data-n": "0",
    class: "a  b",
  });
});

test("parts come from the map given at mount; a missing or self-including one stops", () => {
  const parts = parseParts(
    '<!-- socle --><dc-part name="fil"><nav><sc-for list="{{fil}}" as="f"><a href="{{f.href}}">{{f.l}}</a> › </sc-for><span>{{ici}}</span></nav></dc-part>' +
      '<dc-part name="boucle"><i>{{ici}}</i><dc-include src="boucle"></dc-include></dc-part>',
  );
  assert.deepEqual(Object.keys(parts), ["fil", "boucle"]);
  const { root } = show(
    '<header><dc-include src="fil"></dc-include><dc-include src="absent"></dc-include></header><footer><dc-include src="boucle"></dc-include></footer>',
    { fil: [{ href: "#/registre", l: "Registre" }], ici: "Lyon" },
    { parts },
  );
  assert.equal(
    first(root, "header").childNodes.map(html).join(""),
    '<nav><a href="#/registre">Registre</a> › <span>Lyon</span></nav>',
  );
  assert.equal(all(first(root, "footer")).length - 1, 8, "eight <i>, then the include stops");
});

test("hint-* attributes, comments and scripts are dropped; the template's character references are read, a value's never", () => {
  const { root } = show(
    '<p hint-placeholder-val="{{true}}" title="a &amp; b">x&nbsp;y&#8239;z&#x2192; {{v}}<!-- note --></p><script>alert(1)</script><dc-import name="x"></dc-import>',
    { v: "&amp;" },
  );
  const p = first(root, "p");
  assert.deepEqual(Object.fromEntries(p.attrs), { title: "a & b" });
  assert.equal(p.textContent, "x\u00a0y\u202fz→ &amp;");
  assert.deepEqual(
    all(root).map((e) => e.localName),
    ["div", "p"],
  );
});

test("SVG is built in its namespace, its names in their case; foreignObject goes back to HTML", () => {
  const { root, doc } = show(
    '<svg viewBox="0 0 24 24" aria-hidden="true"><linearGradient id="g"></linearGradient><path d="M0 0" stroke-width="{{w}}"/>' +
      '<foreignObject><p>{{w}}</p></foreignObject></svg><p>après</p>',
    { w: 2 },
  );
  assert.deepEqual(
    doc.created.map((c) => `${c.ns === SVG_NS ? "svg" : c.ns === HTML_NS ? "html" : c.ns}:${c.name}`),
    ["svg:svg", "svg:linearGradient", "svg:path", "svg:foreignObject", "html:p", "html:p"],
  );
  const svg = first(root, "svg");
  assert.equal(svg.getAttribute("viewBox"), "0 0 24 24");
  assert.equal(first(root, "path").getAttribute("stroke-width"), "2");
});

// --- patching and the lifecycle ---------------------------------------------------------

class Counter extends View<{ start: number }, { n: number; q: string; l: string }> {
  renders = 0;
  log: string[] = [];
  constructor(p: { start: number }) {
    super(p);
    this.state = { n: p.start, q: "", l: "carte" };
  }
  renderVals() {
    this.renders++;
    this.log.push("render");
    return { n: this.state.n, q: this.state.q, l: this.state.l };
  }
  override componentDidMount() {
    this.log.push("didMount");
  }
  override componentDidUpdate() {
    this.log.push("didUpdate");
  }
  override componentWillUnmount() {
    this.log.push("willUnmount");
  }
}
const COUNTER =
  '<section><p class="n">{{n}} caméras</p><input type="search" value="{{q}}">' +
  '<div id="carte" data-dc-keep="1" aria-label="{{l}}" class="cadre"></div></section>';
function counter(opts?: MountOptions) {
  const { doc, root } = fakeRoot();
  const m = mount(root as unknown as Element, Counter, { start: 3 }, COUNTER, opts);
  return { doc, root, m, v: m.view };
}

test("a render keeps the nodes it can: same elements, same text node, its text changed", async () => {
  const { root, v } = counter();
  const p = first(root, "p");
  const text = p.childNodes[0] as FText;
  const input = first(root, "input");
  v.setState({ n: 4 });
  assert.equal(text.data, "3 caméras", "renders at the next microtask, not at once");
  await tick();
  assert.equal(first(root, "p"), p);
  assert.equal(p.childNodes[0], text);
  assert.equal(text.data, "4 caméras");
  assert.equal(first(root, "input"), input);
});

test("a field the reader is typing in keeps its value until it loses the focus", async () => {
  const { doc, root, v } = counter();
  const input = first(root, "input");
  doc.activeElement = input;
  input.value = "Mio";
  v.setState({ q: "autre" });
  await tick();
  assert.equal(input.value, "Mio");
  doc.activeElement = null;
  v.setState({ q: "Mions" });
  await tick();
  assert.equal(input.value, "Mions");
});

test("data-dc-keep: the owner's children and changes stay, the template's changes follow", async () => {
  const { root, v } = counter();
  const map = first(root, "div");
  const canvas = root.ownerDocument.createElement("canvas");
  map.appendChild(canvas);
  map.setAttribute("class", "cadre maplibregl-map");
  v.setState({ l: "Carte de Lyon" });
  await tick();
  assert.equal(first(root, "div"), map);
  assert.deepEqual(map.childNodes, [canvas]);
  assert.equal(map.getAttribute("class"), "cadre maplibregl-map", "the owner's class kept");
  assert.equal(map.getAttribute("aria-label"), "Carte de Lyon");
  map.setAttribute("tabindex", "0");
  v.setState({ n: 7 });
  await tick();
  assert.equal(map.getAttribute("tabindex"), "0", "an attribute the template has not is kept");
});

test("an attribute the template no longer has goes; a style someone changed is put back", async () => {
  const { root, doc } = fakeRoot();
  class S extends View<Vals, { on: boolean }> {
    renderVals() {
      return { cls: this.state.on ? "on" : null, w: this.state.on ? "20px" : "10px" };
    }
  }
  const m = mount(root as unknown as Element, S, {}, '<p class="{{cls}}" style="width: {{w}}">x</p>');
  const p = first(root, "p");
  m.view.setState({ on: true });
  await tick();
  assert.equal(p.getAttribute("class"), "on");
  assert.equal(p.getAttribute("style"), "width: 20px;");
  const writes = doc.log.length;
  m.update();
  await tick();
  assert.equal(doc.log.length, writes, "the same style is not written again");
  p.style.cssText = "width: 999px";
  m.view.setState({ on: false });
  await tick();
  assert.equal(p.getAttribute("class"), null);
  assert.equal(p.getAttribute("style"), "width: 10px;");
});

test("a setState that changes nothing renders nothing; setStates are batched", async () => {
  const { v } = counter();
  assert.equal(v.renders, 1);
  v.setState({ n: 3 });
  v.setState((s) => ({ q: s.q }));
  await tick();
  assert.equal(v.renders, 1);
  v.setState({ n: 5 });
  v.setState({ q: "x" });
  v.setState((s, p) => ({ n: s.n + p.start }));
  await tick();
  assert.equal(v.renders, 2);
  assert.equal(v.state.n, 8);
});

test("the lifecycle: didUpdate and the after-render hook after each render, didMount once, willUnmount then the nodes and listeners go", async () => {
  const seen: unknown[] = [];
  const { root, v, m } = counter({ afterRender: (r) => seen.push(r) });
  assert.deepEqual(v.log, ["render", "didUpdate", "didMount"]);
  assert.deepEqual(seen, [root]);
  v.setState({ n: 9 });
  await tick();
  assert.deepEqual(v.log.slice(3), ["render", "didUpdate"]);
  assert.equal(seen.length, 2);
  m.unmount();
  assert.equal(v.log.at(-1), "willUnmount");
  assert.equal(root.childNodes.length, 0);
  assert.ok([...root.listeners.values()].every((l) => l.length === 0), "listeners removed");
  v.setState({ n: 10 });
  await tick();
  assert.equal(v.renders, 2, "no render once unmounted");
});

test("events are delegated: the closest handler first, stopPropagation ends the walk", () => {
  const calls: string[] = [];
  let stop = false;
  const { root } = show('<div onClick="{{outer}}"><button onClick="{{inner}}"><span>x</span></button></div>', {
    outer: () => calls.push("outer"),
    inner: (e: DcEvent) => {
      calls.push("inner");
      if (stop) e.stopPropagation();
    },
  });
  dispatch(first(root, "span"), "click");
  assert.deepEqual(calls, ["inner", "outer"]);
  calls.length = 0;
  stop = true;
  dispatch(first(root, "span"), "click");
  assert.deepEqual(calls, ["inner"]);
});

test("an enter fires when the pointer comes from outside, not while it moves inside; an input carries its value", () => {
  const calls: string[] = [];
  const { root } = show(
    '<p>dehors</p><div onMouseEnter="{{enter}}"><span>dedans</span></div><input onInput="{{typed}}" onFocus="{{focus}}">',
    {
      enter: (e: DcEvent) => calls.push(`enter ${(e.currentTarget as unknown as FElement).localName}`),
      typed: (e: DcEvent) => calls.push(`input ${e.value}`),
      focus: () => calls.push("focus"),
    },
  );
  const div = first(root, "div");
  const span = first(root, "span");
  dispatch(span, "mouseover", { relatedTarget: div });
  assert.deepEqual(calls, []);
  dispatch(span, "mouseover", { relatedTarget: first(root, "p") });
  assert.deepEqual(calls, ["enter div"]);
  const input = first(root, "input");
  input.value = "Mions";
  dispatch(input, "input");
  dispatch(input, "focusin");
  assert.deepEqual(calls, ["enter div", "input Mions", "focus"]);
});

// --- the texts --------------------------------------------------------------------------

test("nest(): the registre's keys as one object, read by the template as paths", () => {
  const fr = {
    "app.name": "Surveillance World",
    "registre.commune.titre": "Commune",
    "registre.commune.onglets.carte": "Carte et drones",
    "registre.commune.onglets.documents": "Documents",
    "registre.vide": "Aucun document",
    "registrex.autre": "non",
  };
  const t = nest(fr);
  assert.deepEqual(t, {
    commune: { titre: "Commune", onglets: { carte: "Carte et drones", documents: "Documents" } },
    vide: "Aucun document",
  });
  const { root } = show("<h1>{{t.commune.titre}}</h1><a>{{t.commune.onglets.carte}}</a><p>{{t.vide}}</p>", { t });
  assert.equal(html(root), "<div><h1>Commune</h1><a>Carte et drones</a><p>Aucun document</p></div>");
});

test("nest() refuses a key a template could not read, or both a text and a group", () => {
  for (const bad of [
    { "registre.a": "x", "registre.a.b": "y" },
    { "registre.a.b": "y", "registre.a": "x" },
    { "registre.vue-ensemble": "x" },
    { "registre.a..b": "x" },
    { "registre.__proto__.x": "x" },
    { "registre.constructor": "x" },
  ])
    assert.throws(() => nest(bad), /catalogue:/, JSON.stringify(bad));
  assert.deepEqual(nest({ "registre.hasOwnProperty.x": "x" }), { hasOwnProperty: { x: "x" } });
});

test("fr.json's registre keys nest", () => {
  const FR = JSON.parse(src("locales/fr.json")) as Record<string, string>;
  const t = nest(FR);
  const count = (o: object): number =>
    Object.values(o).reduce((n: number, v) => n + (typeof v === "string" ? 1 : count(v)), 0);
  assert.equal(count(t), Object.keys(FR).filter((k) => k.startsWith("registre.")).length);
});

test("a message with placeholders is filled from the scope where the template reads it", async () => {
  // each placeholder names the path that fills it, as the register's formats.json does
  const messages: Record<string, [string, Record<string, string>]> = {
    "v.tete": ["À {nom}", { nom: "nom" }],
    "v.ligne": ["{n} contrats à {nom}", { n: "i.n", nom: "nom" }],
  };
  const format: Format = (key, read) =>
    messages[key][0].replace(/\{(\w+)\}/g, (_, p: string) => String(read(messages[key][1][p])));
  const { root } = show(
    '<h1>{{f.v.tete}}</h1><sc-for list="{{items}}" as="i"><p>{{f.v.ligne}}</p></sc-for>',
    { nom: "Mions", items: [{ n: 2 }, { n: 5 }] },
    { format },
  );
  await tick();
  assert.equal(first(root, "h1").textContent, "À Mions");
  assert.deepEqual(
    all(root).filter((e) => e.localName === "p").map((p) => p.textContent),
    ["2 contrats à Mions", "5 contrats à Mions"],
  );
});
