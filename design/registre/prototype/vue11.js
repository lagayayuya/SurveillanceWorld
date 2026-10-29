// The base class of the v11 views and the registry of views (loaded before vues/*.js; app11.js is the shell).
(() => {
  "use strict";
  const WIDE = matchMedia("(min-width: 960px)");
  const views = {};
  const dark = () => document.documentElement.classList.contains("dark");
  // --- base class: theme, the « i » buttons, the selection shown in the panel ------------------------
  class Vue extends DCLogic {
    constructor(p) { super(p); this.state = Object.assign({ sel: null, open: {} }, this.init ? this.init(p) : {}); }
    base(name) {
      return { th: "th v-" + name + (dark() ? " dark" : "") };
    }
    // { show, open, tgl } for the given « i » keys, as the mockups use them
    info(...keys) {
      const o = this.state.open || {};
      return { show: Object.fromEntries(keys.map(k => [k, !!o[k]])), open: Object.fromEntries(keys.map(k => [k, o[k] ? "true" : "false"])),
        tgl: Object.fromEntries(keys.map(k => [k, () => this.setState({ open: Object.assign({}, this.state.open, { [k]: !this.state.open[k] }) })])) };
    }
    pick(k) { return () => { if (this.state.sel !== k) this.setState({ sel: k }); }; }
    on(k) { return this.state.sel === k; }
    // sortable column heads: [[key, label, cls, width], …]; a click on the current key flips the order
    cols(defs, sk, dk, firstDir = () => -1) {
      const S = this.state;
      return defs.map(([k, l, cls, w]) => ({ l, cls: cls || "", w: w || "", sort: k && S[sk] === k ? (S[dk] < 0 ? "descending" : "ascending") : "none",
        arrow: k && S[sk] === k ? (S[dk] < 0 ? "↓" : "↑") : "", pick: k ? () => this.setState({ [sk]: k, [dk]: S[sk] === k ? -S[dk] : firstDir(k) }) : () => {} }));
    }
  }
  window.Vue = Vue;
  window.V11 = { views, register: (name, Comp) => { views[name] = Comp; }, WIDE };

})();
