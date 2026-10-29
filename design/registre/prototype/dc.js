// A small runtime for the mockups' templates (the « .dc.html » format of maquette-direction/), so that the
// prototype renders the validated markup as it is instead of a hand copy of it.
// Supported, as the mockups use them (plus <dc-include src> for the shared pieces, prototype only): {{path}} in text and attributes ({{{path}}} inserts trusted HTML,
// prototype only), <sc-for list="{{x}}" as="y">, <sc-if value="{{x}}">, on* attributes (onClick, onMouseEnter,
// onFocus, onInput, onPointerDown/Move/Up/Leave), a component class with state, setState, renderVals,
// componentDidMount and componentWillUnmount (window.DCLogic).
// The template is parsed by a tokenizer of its own: the browser's parser would move <sc-for> out of <tbody>.
// Each render builds the HTML string, parses it and patches the live DOM node by node, so that the focused
// field, its caret and the hovered row survive a re-render.
(function () {
  "use strict";
  const VOID = new Set("area base br col embed hr img input link meta source track wbr".split(" "));
  const RAW = new Set(["style", "script", "textarea"]);
  const EVENTS = { onClick: "click", onMouseEnter: "mouseenter", onFocus: "focus", onInput: "input", onPointerDown: "pointerdown",
    onPointerMove: "pointermove", onPointerUp: "pointerup", onPointerLeave: "pointerleave", onChange: "change", onKeyDown: "keydown" };

  // --- parse -------------------------------------------------------------------------------------------
  function parse(src) {
    const root = { tag: "#root", attrs: [], kids: [] }, stack = [root];
    const re = /<!--[\s\S]*?-->|<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:\s+[^\s=>\/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>/g;
    let i = 0, m;
    const text = s => { if (s) stack[stack.length - 1].kids.push({ text: s }); };
    while ((m = re.exec(src))) {
      text(src.slice(i, m.index)); i = re.lastIndex;
      if (m[0].startsWith("<!--")) continue;
      if (m[1]) {   // closing tag: pop to the matching element
        const t = m[1].toLowerCase();
        for (let k = stack.length - 1; k > 0; k--) if (stack[k].tag === t) { stack.length = k; break; }
        continue;
      }
      const tag = m[2].toLowerCase(), attrs = [];
      m[3].replace(/([^\s=>\/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g, (_, n, a, b, c) => { attrs.push([n, a ?? b ?? c ?? ""]); return ""; });
      const el = { tag, name: m[2], attrs, kids: [] };
      stack[stack.length - 1].kids.push(el);
      if (RAW.has(tag)) {
        const end = src.indexOf(`</${tag}`, i); const body = end < 0 ? src.slice(i) : src.slice(i, end);
        el.kids.push({ text: body, raw: true }); i = end < 0 ? src.length : src.indexOf(">", end) + 1; re.lastIndex = i; continue;
      }
      if (!m[4] && !VOID.has(tag)) stack.push(el);
    }
    text(src.slice(i));
    return root;
  }

  // shared pieces of markup (the « socle »): <dc-part name="x">…</dc-part> blocks, used as <dc-include src="x">
  const parts = {};
  function addParts(src) { for (const n of parse(src).kids) if (n.tag === "dc-part") parts[Object.fromEntries(n.attrs).name] = n; }

  // --- render to a string ----------------------------------------------------------------------------
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  function lookup(path, scope) {
    path = path.trim();
    if (path === "true") return true; if (path === "false") return false;
    if (/^-?\d+(\.\d+)?$/.test(path)) return +path;
    const parts = path.split(".");
    let v;
    for (let k = scope.length - 1; k >= 0; k--) if (scope[k] && parts[0] in scope[k]) { v = scope[k][parts[0]]; break; }
    for (let k = 1; k < parts.length && v != null; k++) v = v[parts[k]];
    return v;
  }
  const whole = s => { const m = /^\s*\{\{([^{}]+)\}\}\s*$/.exec(s); return m && m[1]; };
  function interp(s, scope, html) {
    return s.replace(/\{\{\{([^{}]+)\}\}\}|\{\{([^{}]+)\}\}/g, (_, raw, p) => {
      const v = lookup(raw || p, scope);
      if (v == null || v === false) return "";
      return raw ? String(v) : html ? esc(v) : String(v);
    });
  }
  function render(node, scope, ctx, out) {
    for (const n of node.kids) {
      if (n.text != null) { out.push(n.raw ? n.text : interp(n.text, scope, true)); continue; }
      if (n.tag === "sc-for") {
        const a = Object.fromEntries(n.attrs), list = lookup(whole(a.list) || "", scope) || [];
        list.forEach((item, idx) => render(n, scope.concat([{ [a.as]: item, [a.as + "Index"]: idx }]), ctx, out));
        continue;
      }
      if (n.tag === "sc-if") { const a = Object.fromEntries(n.attrs); if (lookup(whole(a.value) || "", scope)) render(n, scope, ctx, out); continue; }
      if (n.tag === "dc-import") continue;
      if (n.tag === "dc-include") { const p = parts[Object.fromEntries(n.attrs).src]; if (p) render(p, scope, ctx, out); continue; }
      let s = "<" + n.name;
      for (const [k, v] of n.attrs) {
        if (k.startsWith("hint-")) continue;
        if (EVENTS[k]) { const f = lookup(whole(v) || "", scope); if (typeof f === "function") s += ` data-dc-${EVENTS[k]}="${ctx.handlers.push(f) - 1}"`; continue; }
        const w = whole(v);
        if (w != null) { const val = lookup(w, scope); if (val == null || val === false && !/^aria-/.test(k)) continue; s += ` ${k}="${esc(val)}"`; continue; }
        s += ` ${k}="${esc(interp(v, scope, false))}"`;
      }
      s += ">"; out.push(s);
      if (!VOID.has(n.tag)) { render(n, scope, ctx, out); out.push(`</${n.name}>`); }
    }
  }

  // --- patch the live DOM ----------------------------------------------------------------------------
  function patchAttrs(o, n) {
    for (const a of [...o.attributes]) if (!n.hasAttribute(a.name)) o.removeAttribute(a.name);
    for (const a of n.attributes) if (o.getAttribute(a.name) !== a.value) o.setAttribute(a.name, a.value);
    if ((o.tagName === "INPUT" || o.tagName === "TEXTAREA") && o !== document.activeElement) {
      const v = n.getAttribute("value") ?? ""; if (o.value !== v) o.value = v;
    }
  }
  function patch(o, n) {
    const on = [...o.childNodes], nn = [...n.childNodes];
    nn.forEach((c, i) => {
      const p = on[i];
      if (!p) { o.appendChild(c); return; }
      if (p.nodeType !== c.nodeType || p.nodeName !== c.nodeName || p.namespaceURI !== c.namespaceURI || (p.dataset && p.dataset.dcKeep !== c.dataset?.dcKeep)) { o.replaceChild(c, p); return; }
      if (p.nodeType === 3 || p.nodeType === 8) { if (p.data !== c.data) p.data = c.data; return; }
      if (p.nodeType === 1) {
        // a node owned by someone else (the map): the template's attributes set, the others (its class) kept, its children left alone
        if (p.hasAttribute("data-dc-keep")) { for (const a of c.attributes) if (p.getAttribute(a.name) !== a.value) p.setAttribute(a.name, a.value); return; }
        patchAttrs(p, c);
        patch(p, c);
      }
    });
    for (let i = on.length - 1; i >= nn.length; i--) on[i].remove();
  }

  // --- events: delegated to the root -----------------------------------------------------------------
  function wrap(e, el, stop) {
    return { nativeEvent: e, type: e.type, target: e.target, currentTarget: el, clientX: e.clientX, clientY: e.clientY, pointerId: e.pointerId,
      key: e.key, button: e.button, stopPropagation() { stop.done = true; e.stopPropagation(); }, preventDefault() { e.preventDefault(); } };
  }
  function bind(root, inst) {
    const fire = (type, e, enterLeave) => {
      const stop = { done: false };
      for (let el = e.target; el && el !== root.parentNode; el = el.parentNode) {
        if (el.nodeType !== 1) continue;
        const id = el.getAttribute(`data-dc-${type}`);
        if (id != null) {
          if (enterLeave && el.contains(e.relatedTarget)) continue;
          const f = inst.__handlers[+id]; if (f) f(wrap(e, el, stop));
          if (stop.done || type === "focus" || type === "input") break;
        }
        if (el === root) break;
      }
    };
    for (const t of ["click", "input", "change", "keydown", "pointerdown", "pointermove", "pointerup"]) root.addEventListener(t, e => fire(t, e));
    root.addEventListener("mouseover", e => fire("mouseenter", e, true));
    root.addEventListener("pointerout", e => fire("pointerleave", e, true));
    root.addEventListener("focusin", e => fire("focus", e));
  }

  // --- components ------------------------------------------------------------------------------------
  class DCLogic {
    constructor(props) { this.props = props || {}; this.state = {}; }
    setState(p) {
      const next = typeof p === "function" ? p(this.state, this.props) : p;
      let same = true; for (const k in next) if (this.state[k] !== next[k]) { same = false; break; }
      if (same) return;   // a hover that changes nothing does not render again
      this.state = Object.assign({}, this.state, next);
      if (this.__mounted) this.__schedule();
    }
  }
  function mount(root, Comp, props, template) {
    const ast = typeof template === "string" ? parse(template) : template;
    const inst = new Comp(props || {});
    let queued = false;
    inst.__render = () => {
      queued = false;
      const ctx = { handlers: [] }, out = [];
      const vals = inst.renderVals();
      render(ast, [vals], ctx, out);
      inst.__handlers = ctx.handlers;
      const tpl = document.createElement("template"); tpl.innerHTML = out.join("");
      patch(root, tpl.content);
      if (inst.componentDidUpdate) inst.componentDidUpdate();
      if (DC.afterRender) DC.afterRender(root);
    };
    inst.__schedule = () => { if (!queued) { queued = true; queueMicrotask(inst.__render); } };
    bind(root, inst);
    inst.__mounted = true;
    inst.__render();
    if (inst.componentDidMount) inst.componentDidMount();
    return { inst, unmount() { inst.__mounted = false; if (inst.componentWillUnmount) inst.componentWillUnmount(); } };
  }
  // Split a .dc.html file into its parts: template (inside <x-dc>, without <helmet>), helmet, script, props.
  function split(src) {
    const a = src.indexOf("<x-dc>"), b = src.lastIndexOf("</x-dc>");
    let tpl = src.slice(a + 6, b), helmet = "";
    const h = /<helmet>([\s\S]*?)<\/helmet>/.exec(tpl); if (h) { helmet = h[1]; tpl = tpl.replace(h[0], ""); }
    const s = /<script type="text\/x-dc" data-dc-script(?: data-props='([^']*)')?>([\s\S]*?)<\/script>/.exec(src);
    return { template: tpl, helmet, script: s ? s[2] : "", props: s && s[1] ? JSON.parse(s[1]) : {} };
  }
  window.DCLogic = DCLogic;
  window.DC = { parse, mount, split, esc, addParts, parts };
})();
