// View 2 · Registre · Chiffres et classements (maquette Registre-chiffres.dc.html).
(() => {
  "use strict";
  const D = D11;
  const DISPS = [["vp", "Vidéoprotection"], ["csu", "Centres de supervision"], ["vsa", "Analyse algorithmique"], ["lapi", "Lecture de plaques"], ["pi", "Caméras-piétons"], ["vv", "Vidéoverbalisation"], ["dr", "Drones"]];
  let CACHE = null;
  function figures() {
    if (CACHE) return CACHE;
    const ents = Object.values(D.entStats).map(o => ({ siren: o.siren, nom: D.ent(o.siren), deps: Object.entries(o.deps).sort((a, b) => b[1] - a[1]).map(x => x[0]).join(", "),
      clients: o.clientes.size, n: o.n, amt: o.montant, y0: o.y0 }));
    const buyers = Object.values(D.buyStats).map(o => ({ siren: o.siren, nom: D.buyerNom(o.siren), cat: D.buyerCat(o.siren) + " · " + (D.DL[ACH[o.siren]?.dep] || DEPS[ACH[o.siren]?.dep] || ACH[o.siren]?.dep || ""),
      n: o.n, amt: o.montant, ents: o.ents.size, href: D.buyerHref(o.siren) }));
    const coms = Object.keys(D.byInsee).filter(k => R.communes[k]).map(D.communeStats);
    const years = {};
    for (const e of D.E) { const y = (e.date || "").slice(0, 4), k = D.typ(e); (years[y] ||= {})[k] = (years[y][k] || 0) + 1; }
    const disp = {}; for (const e of D.E) if (e.t === "attribution") disp[D.disp(e)] = (disp[D.disp(e)] || 0) + 1;
    const dr = {}; for (const e of D.E) if (e.t === "arrete_drone" && e.insee && R.communes[e.insee]) dr[e.insee] = (dr[e.insee] || 0) + 1;
    return CACHE = { ents, buyers, coms, years, disp, dr, nCon: D.E.filter(e => e.t === "attribution").length };
  }
  class Chiffres extends Vue {
    init() { return { sortE: "clients", sortB: "n", sortC: "n", yt: "con" }; }
    titre() { return "Chiffres et classements"; }
    renderVals() {
      const S = this.state, F = figures();
      const ki = { clients: "clients", n: "n", amt: "amt" };
      const ents = F.ents.slice().sort((a, b) => b[ki[S.sortE]] - a[ki[S.sortE]] || b.n - a.n).slice(0, 10)
        .map(e => ({ nom: e.nom, deps: e.deps, clients: e.clients, n: e.n, amt: D.eurK(e.amt), y0: e.y0, href: `#/entreprise/${e.siren}` }));
      const head = (defs, key, set) => defs.map(([k, l]) => ({ l, sort: S[key] === k ? "descending" : "none", arrow: S[key] === k ? "↓" : "", pick: () => this.setState({ [key]: k }) }));
      const entCols = head([["clients", "Clientes"], ["n", "Contrats"], ["amt", "Montant max."]], "sortE");
      const buyers = F.buyers.slice().sort((a, b) => b[S.sortB] - a[S.sortB] || b.n - a.n).slice(0, 10).map(b => ({ ...b, amt: D.eurK(b.amt) }));
      const buyCols = head([["n", "Contrats"], ["amt", "Montant max."], ["ents", "Entreprises"]], "sortB");
      const ck = { n: "docs", con: "con", aut: "cam", dr: "dr", cam: "carte" };
      const coms = F.coms.slice().sort((a, b) => (b[ck[S.sortC]] || 0) - (a[ck[S.sortC]] || 0)).slice(0, 12).map(c => {
        const col = D.ARRETES_COLLECTES.has(c.dep);
        return { nom: c.nom, dep: D.DL[c.dep] || DEPS[c.dep] || c.dep, n: D.fr(c.docs), con: c.con, aut: col ? c.cam : "—", dr: col ? c.dr : "—", cam: c.carte == null ? "—" : D.fr(c.carte), href: `#/commune/${c.insee}` };
      });
      const comCols = head([["n", "Documents"], ["con", "Contrats"], ["aut", "Autorisations"], ["dr", "Drones"], ["cam", "Sur la carte"]], "sortC");
      const yrs = ["2018", "2019", "2020", "2021", "2022", "2023", "2024", "2025", "2026"];
      const vals = yrs.map(y => (F.years[y] || {})[S.yt] || 0), mx = Math.max(1, ...vals);
      const years = yrs.map((y, i) => ({ y: y === "2026" ? "2026*" : y, v: vals[i] ? D.fr(vals[i]) : "—",
        bar: "display: block; height: " + Math.round(vals[i] / mx * 170) + "px; background: " + (y === "2026" ? "repeating-linear-gradient(45deg, var(--fg) 0 3px, transparent 3px 7px); border: 2px solid var(--fg); box-sizing: border-box" : "var(--fg)") }));
      const yearTypes = [["con", "Contrats"], ["ao", "Appels d'offres"], ["aut", "Autorisations"], ["sub", "Subventions"]].map(([k, l]) => ({ l, pressed: S.yt === k ? "true" : "false", pick: () => this.setState({ yt: k }), style: S.yt === k ? "background: var(--fg); color: var(--bg)" : "background: var(--card); color: var(--fg)" }));
      const nv = Math.max(...DISPS.map(([k]) => F.disp[k] || 0));
      const disp = DISPS.map(([k, l]) => { const n = F.disp[k] || 0; return { l, n: D.fr(n), href: `#/?t=con&p=${k}`, bar: "position: absolute; left: 0; top: 0; bottom: 0; width: " + Math.max(1, Math.round(Math.sqrt(n / nv) * 100)) + "%; background: var(--fg)" }; });
      const drl = Object.entries(F.dr).sort((a, b) => b[1] - a[1] || R.communes[a[0]].nom.localeCompare(R.communes[b[0]].nom, "fr")).slice(0, 8), dmx = drl[0]?.[1] || 1;
      const drones = drl.map(([k, n]) => ({ l: R.communes[k].nom, n, href: `#/commune/${k}/carte`, bar: "position: absolute; left: 0; top: 0; bottom: 0; width: " + Math.round(n / dmx * 100) + "%; background: var(--drone)" }));
      return Object.assign(this.base("chiffres"), this.info("scope", "ach", "com"), {
        maj: (R.meta.construit || "").split("-").reverse().join("/"), ndocs: D.fr(D.E.length), nEnts: D.fr(F.ents.length), nBuy: D.fr(Object.keys(ACH).length), nCon: D.fr(F.nCon),
        ents, entCols, buyers, buyCols, coms, comCols, ncom: D.fr(F.coms.length), years, yearTypes, yearAlt: "Nombre de documents de ce type par année, de 2018 à 2026 (2026 incomplet).", disp, drones,
      });
    }
  }
  V11.register("chiffres", Chiffres);
})();
