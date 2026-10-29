// View 1 · Registre · Documents (maquette Registre.dc.html). The mockup's logic, on the 6 759 documents.
(() => {
  "use strict";
  const D = D11;
  const TL = { con: "Contrats", ao: "Appels d'offres et résultats", aut: "Arrêtés de la préfecture", mod: "Modifications", sub: "Subventions" };
  const PL = { vp: "Vidéoprotection", csu: "Centres de supervision", vsa: "Analyse algorithmique", lapi: "Lecture de plaques", pi: "Caméras-piétons", vv: "Vidéoverbalisation", dr: "Drones", na: "Non classé (appels d’offres)" };
  const YO = ["2026", "2025", "2024", "2023", "2022", "2021", "2020", "2019", "2018", "<2018"];
  const FK = ["t", "d", "y", "p"];
  // one row per document: its keys for the filters, its words for the search, what the list shows
  let ROWS = null;
  function rows() {
    if (ROWS) return ROWS;
    ROWS = D.E.map(e => {
      const k = D.typ(e), com = e.insee && R.communes[e.insee] ? R.communes[e.insee].nom : "";
      const isArr = e.t.startsWith("arrete");
      const b = isArr ? D.benef(e) : null, s = !isArr && !e.t.startsWith("subvention") ? D.buyer(e) : null;
      // who: the buyer (not repeated when it is the commune itself), or the beneficiary of an act; « nom non publié » when withheld
      // a contract's buyer is not repeated when it is the commune itself; a notice keeps its buyer as published
      const own = s && ACH[s]?.categorie === "commune" && ACH[s]?.insee_siege === e.insee;
      const qui = isArr ? (e.beneficiaire === "[non retenu]" ? "nom non publié" : b || "") : e.t.startsWith("subvention") ? casse(tidy(e.beneficiaire || ""))
        : /^(avis|resultat|rectificatif)$/.test(e.t) ? tidy(e.acheteur || "") : s && !own ? D.buyerNom(s) : "";
      const ents = (e.entreprises || []).map(D.ent).join(", ");
      const title = D.titre(e);
      return { e, id: e.id, date: e.date || "", k, key: [k, D.depGroup(e.dep), D.yGroup(e.date), D.disp(e)], title, com, dep: e.dep, qui, ents, amt: e.montant || 0,
        words: D.plain([title, e.objet, com, qui, ents, e.ref].join(" ")), href: D.docHref(e) };
    });
    return ROWS;
  }
  const tidyQui = (r) => r.qui && D.plain(r.qui) !== D.plain(r.com) ? r.qui : "";   // the mockup's rule

  class Registre extends Vue {
    init(p) { return { q: p.q || "", f: { t: p.t ? p.t.split(",") : [], d: p.d ? p.d.split(",") : [], p: p.p ? p.p.split(",") : [], y: p.y ? p.y.split(",") : [] }, sort: "date", lim: 10 }; }
    titre() { return "Le registre"; }
    componentDidMount() { this._esc = ev => { if (ev.key === "Escape" && this.state.fOpen) this.setState({ fOpen: false }); }; addEventListener("keydown", this._esc); }
    componentWillUnmount() { removeEventListener("keydown", this._esc); document.querySelectorAll("[data-inert-sheet]").forEach(n => { n.inert = false; n.removeAttribute("data-inert-sheet"); }); }
    componentDidUpdate() {
      // aria-modal says the rest of the page is out of reach: make it so (inert on every sibling up the sheet's ancestors)
      document.querySelectorAll("[data-inert-sheet]").forEach(n => { n.inert = false; n.removeAttribute("data-inert-sheet"); });
      const sheet = document.getElementById("r-filtres");
      if (this.state.fOpen && sheet && !matchMedia("(min-width: 960px)").matches)
        for (let n = sheet; n && n !== document.body; n = n.parentElement)
          for (const sib of n.parentElement.children) if (sib !== n && !sib.inert) { sib.inert = true; sib.setAttribute("data-inert-sheet", ""); }
      if (this.state.fOpen === this._was) return;
      this._was = this.state.fOpen;
      (this.state.fOpen ? document.querySelector("#r-filtres .sheet-x") : document.querySelector(".filtres-btn"))?.focus();
    }
    renderVals() {
      const S = this.state, F = S.f, all = rows();
      const ok = (r, skip) => FK.every((k, i) => k === skip || !F[k].length || F[k].indexOf(r.key[i]) >= 0);
      const q = D.plain(S.q.trim());
      const base = q ? all.filter(r => r.words.indexOf(q) >= 0) : all;
      const facetN = (k, v) => { const i = FK.indexOf(k); let n = 0; for (const r of base) if (r.key[i] === v && ok(r, k)) n++; return n; };
      const tog = (k, v) => () => { const cur = F[k]; const nx = cur.indexOf(v) >= 0 ? cur.filter(x => x !== v) : cur.concat([v]); this.setState({ f: Object.assign({}, F, { [k]: nx }), lim: 10, sel: null }); };
      // a filter without result is hidden, unless it is checked; each count leaves its own family out
      const mkFacet = (k, label, vals, lab) => ({ l: label, opts: vals.map(v => { const on = F[k].indexOf(v) >= 0, n = facetN(k, v);
        return { v, on, l: lab(v), n: D.fr(n), pressed: on ? "true" : "false", mark: on ? "✓" : "", cls: "fopt" + (n || on ? "" : " zero"), pick: tog(k, v) }; }).filter(o => o.n !== "0" || o.on) });
      const facets = [
        mkFacet("t", "Type de document", ["con", "ao", "aut", "mod", "sub"], v => TL[v]),
        mkFacet("d", "Département", ["69", "75", "77", "78", "91", "92", "93", "94", "95", "13", "xx"], v => D.DL[v] || "Autres"),
        mkFacet("p", "Dispositif", ["vp", "csu", "vsa", "lapi", "pi", "vv", "dr", "na"], v => PL[v]),
        mkFacet("y", "Année", YO, v => v === "<2018" ? "Avant 2018" : v),
      ];
      let list = base.filter(r => ok(r, null));
      list = list.slice().sort((a, b) => S.sort === "amt" ? (b.amt - a.amt) || b.date.localeCompare(a.date) : b.date.localeCompare(a.date));
      const cam = n => n + (n > 1 ? " caméras" : " caméra");
      const rowsV = list.slice(0, S.lim).map(r => { const e = r.e; return {
        date: D.docDate(e), type: D.badgeType(e), badge: D.BS[r.k], title: r.title,
        amt: r.amt ? D.eurK(r.amt) : e.cameras != null && e.t === "arrete" ? cam(e.cameras) : "",
        meta: [r.com || (D.DL[e.dep] || DEPS[e.dep] || ""), tidyQui(r), r.ents].filter(Boolean).join(" · "),
        href: r.href, cls: "res" + (S.sel === r.id ? " on" : ""), hover: this.pick(r.id) }; });
      const chips = [];
      FK.forEach(k => F[k].forEach(v => chips.push({ l: k === "t" ? TL[v] : k === "d" ? (D.DL[v] || "Autres") : k === "p" ? PL[v] : v === "<2018" ? "Avant 2018" : v, aria: "Retirer le filtre " + (k === "t" ? TL[v] : k === "d" ? (D.DL[v] || "Autres") : k === "p" ? PL[v] : v), drop: tog(k, v) })));
      if (S.q) chips.unshift({ l: "« " + S.q + " »", aria: "Effacer la recherche", drop: () => this.setState({ q: "" }) });
      const total = list.length;
      const countLabel = D.fr(total) + (total > 1 ? " documents" : " document");
      const sorts = [["date", "Plus récents"], ["amt", "Plus gros montants"]].map(([k, l]) => ({ l, pressed: S.sort === k ? "true" : "false", pick: () => this.setState({ sort: k }), style: S.sort === k ? "background: var(--fg); color: var(--bg)" : "background: var(--card); color: var(--fg)" }));
      // « Aller directement à »: communes, départements, companies, buyers
      let sug = [];
      if (q.length >= 2) {
        const cs = Object.keys(D.byInsee).filter(k => R.communes[k] && D.plain(R.communes[k].nom).indexOf(q) === 0).sort((a, b) => D.byInsee[b].length - D.byInsee[a].length).slice(0, 2)
          .map(k => ({ kind: "Commune", tagStyle: "background: #ffe800", nom: R.communes[k].nom, meta: (D.DL[R.communes[k].dep] || DEPS[R.communes[k].dep] || "") + " · " + D.plur(D.byInsee[k].length, "document"), href: `#/commune/${k}` }));
        const ds = Object.keys(D.DL).filter(k => D.plain(D.DL[k]).indexOf(q) === 0).slice(0, 1).map(k => ({ kind: "Département", tagStyle: "background: #ffb36b", nom: D.DL[k], meta: k, href: `#/departement/${k}` }));
        const es = Object.values(D.entStats).filter(o => D.plain(D.ent(o.siren)).indexOf(q) >= 0).sort((a, b) => b.n - a.n).slice(0, 2)
          .map(o => ({ kind: "Entreprise", tagStyle: "background: #c9b8ff", nom: D.ent(o.siren), meta: D.plur(o.n, "contrat"), href: `#/entreprise/${o.siren}` }));
        const bs = Object.values(D.buyStats).filter(o => ACH[o.siren]?.categorie !== "commune" && D.plain(D.buyerNom(o.siren)).indexOf(q) >= 0).sort((a, b) => b.n - a.n).slice(0, 1)
          .map(o => ({ kind: "Acheteur", tagStyle: "background: #9be7c4", nom: D.buyerNom(o.siren), meta: D.plur(o.n, "contrat"), href: `#/acheteur/${o.siren}` }));
        sug = cs.concat(ds, es, bs).slice(0, 4);
      }
      // the panel: the hovered document, else the selection and its one download
      const sr = S.sel && all.find(r => r.id === S.sel);
      const nT = k => { let n = 0; for (const r of list) if (r.k === k) n++; return D.fr(n); };
      let det = { kicker: "Votre recherche", title: countLabel, rows: [{ k: "Contrats", v: nT("con") }, { k: "Appels d'offres", v: nT("ao") }, { k: "Arrêtés", v: nT("aut") }, { k: "Subventions", v: nT("sub") }],
        links: [{ l: "Télécharger cette sélection (CSV, JSON) →", href: "#", act: ev => { ev.preventDefault(); telecharger(list.map(r => r.e), "selection"); } }] };
      if (sr) {
        const e = sr.e, aut = sr.k === "aut";
        det = { kicker: D.badgeType(e) + " · " + D.docDate(e), title: sr.title, rows: [
          { k: "Commune", v: sr.com || "non rattaché" }, { k: aut ? "Bénéficiaire" : "Acheteur", v: sr.qui || "non publié" },
          { k: "Entreprise", v: sr.ents || "—" }, { k: aut ? (e.t === "arrete_drone" ? "Appareils" : "Caméras") : "Montant maximum", v: aut ? (e.cameras != null ? D.fr(e.cameras) : "[à lire]") : D.eurK(e.montant) },
          { k: "Dispositif", v: PL[D.disp(e)] }, { k: "Référence", v: e.ref }],
          links: [{ l: aut && e.insee && R.communes[e.insee] ? "Les autorisations de la commune →" : "Fiche du contrat →", href: sr.href }].concat(e.url ? [{ l: "Document source →", href: e.url }] : []) };
        if (aut && !(e.insee && R.communes[e.insee])) det.links[0].l = "Fiche de l'arrêté →";
        if (sr.k !== "con" && sr.k !== "mod" && !aut) det.links[0].l = sr.k === "sub" ? "Fiche de la subvention →" : "Fiche de l'appel d'offres →";
      }
      const kpis = ["con", "ao", "aut", "mod", "sub"].map(k => { const on = F.t.length === 1 && F.t[0] === k; let n = 0; for (const r of all) if (r.k === k) n++;
        return { v: D.fr(n), l: TL[k].toLowerCase(), pressed: on ? "true" : "false", pick: () => this.setState({ f: Object.assign({}, F, { t: on ? [] : [k] }), lim: 10, sel: null }) }; });
      return Object.assign(this.base("registre"), this.info("scope"), {
        maj: (R.meta.construit || "").split("-").reverse().join("/"), ndocs: D.fr(all.length),
        kpis, q: S.q, onQ: e => this.setState({ q: e.target.value, lim: 10, sel: null }),
        sug, hasSug: sug.length > 0, chips, hasChips: chips.length > 0, clear: () => this.setState({ q: "", f: { t: [], d: [], y: [], p: [] }, lim: 10, sel: null }),
        // the phone: the filters fold behind « Filtres (N) » and open as a sheet (Escape or « Voir » closes it)
        fOpen: S.fOpen ? "true" : "false", fCls: S.fOpen ? "ouvert" : "", fRole: S.fOpen ? "dialog" : "region", fModal: S.fOpen ? "true" : null,
        nfTxt: (() => { const n = FK.reduce((a, k) => a + F[k].length, 0); return n ? ` (${n})` : ""; })(),
        fOuvrir: () => this.setState({ fOpen: true }), fFermer: () => this.setState({ fOpen: false }),
        countLabel, sorts, facets, rows: rowsV, noRows: rowsV.length === 0, hasMore: list.length > S.lim, more: () => this.setState({ lim: S.lim + 10 }), det,
      });
    }
  }
  // the one download of the page: the selection, as CSV and JSON with their LISEZMOI, in one zip file
  async function telecharger(evs, name) {
    const { zipSync, strToU8 } = await import("../lib/fflate.mjs");
    const blobs = {};
    const keep = window.__exportBlob; window.__exportBlob = (fmt, blob) => { blobs[fmt] = blob; };
    for (const f of ["csv", "json", "txt"]) exportRows(evs, f, name);
    window.__exportBlob = keep;
    const files = {};
    for (const [f, b] of Object.entries(blobs)) files[f === "txt" ? `LISEZMOI-${name}.txt` : `registre-${name}.${f}`] = new Uint8Array(await b.arrayBuffer());
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([zipSync(files)], { type: "application/zip" })); a.download = `registre-${name}.zip`; a.click();
  }
  window.telecharger11 = telecharger;
  V11.register("registre", Registre);
})();
