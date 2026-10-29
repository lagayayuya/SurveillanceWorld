// View 11 · Glossaire (maquette Glossaire.dc.html): the sticky index, a filter that works (accents ignored, in the
// word or its definition), a definition and a clickable example for each word.
(() => {
  "use strict";
  const D = D11;
  class Glossaire extends Vue {
    init() { return { q: "" }; }
    titre() { return "Les mots du registre"; }
    componentDidMount() {
      const a = this.props.ancre, el = a && (document.getElementById(a) || document.getElementById("g-" + a));
      if (el) requestAnimationFrame(() => { el.scrollIntoView({ block: "start" }); el.setAttribute("tabindex", "-1"); el.focus({ preventScroll: true }); });
    }
    renderVals() {
      const S = this.state, G = window.GLOSSAIRE11 || [], q = D.plain(S.q.trim());
      const hit = G.filter(g => !q || D.plain(g[1]).includes(q) || D.plain(g[2]).includes(q));
      return Object.assign(this.base("glossaire"), {
        fil: [{ l: "Registre", href: "#/" }], filIci: "Glossaire",
        total: G.length, q: S.q, onQ: e => this.setState({ q: e.target.value }),
        items: hit.map(g => ({ id: "g-" + g[0], anchor: "#g-" + g[0], t: g[1], d: g[2], hasEx: !!g[3], ex: g[3], href: g[4] })), none: hit.length === 0,
        countLabel: q ? hit.length + (hit.length > 1 ? " mots trouvés" : " mot trouvé") + " (dans le mot ou sa définition)" : "Par ordre alphabétique",
      });
    }
  }
  V11.register("glossaire", Glossaire);
})();
