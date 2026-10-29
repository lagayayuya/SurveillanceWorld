// View 10 · Département (maquette Departement-grand.dc.html): by intercommunality (a row unfolds on its communes),
// every commune with a filter by name (accents ignored), who sells and who buys with the amount, each year. No map.
(() => {
  "use strict";
  const D = D11;
  const eurK = n => !n ? "non publié" : n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(".", ",") + " M€" : D.fr(n) + " €";
  const PART = x => x >= 0.9 ? ["presque toutes", "presque tous"] : x >= 0.72 ? ["les trois quarts", "les trois quarts"] : x >= 0.6 ? ["les deux tiers", "les deux tiers"] : x >= 0.45 ? ["la moitié", "la moitié"] : null;
  const DANS = d => d === "75" ? "à Paris" : "dans " + D.depArt(d), DU = d => d === "75" ? "de Paris" : D.depArt(d).replace(/^le /, "du ").replace(/^les /, "des ").replace(/^la /, "de la ").replace(/^l'/, "de l'");
  class Departement extends Vue {
    init(p) { const ic = new URLSearchParams(location.hash.split("?")[1] || "").get("ic");
      return { sortI: "docs", dirI: -1, openI: ic || null, sortC: "docs", dirC: -1, q: "", allC: false, sortV: "n", sortB: "n", yt: "con" }; }
    titre() { return DEPS[this.props.dep] || this.props.dep; }
    componentDidMount() { if (this.state.openI) requestAnimationFrame(() => document.getElementById("d-ic")?.scrollIntoView({ block: "start" })); }
    data() {
      if (this._d) return this._d;
      const dep = this.props.dep, coms = D.communesDep(dep).filter(c => c.docs);
      const st = D.depStats(dep);
      const sel = {}; for (const e of D.E) if (e.t === "attribution" && e.dep === dep && !isCopy(e)) for (const s of e.entreprises || []) { const o = sel[s] ||= { s, n: 0, amt: 0 }; o.n++; if (D.compte(e)) o.amt += e.montant || 0; }
      const buy = Object.values(D.buyStats).filter(o => ACH[o.siren]?.dep === dep);
      const yr = {}; for (const e of D.byDep[dep] || []) { const y = (e.date || "").slice(0, 4), k = e.t === "arrete" ? "aut" : D.typ(e); (yr[y] ||= {})[k] = (yr[y][k] || 0) + 1; }
      return this._d = { dep, coms, st, SEL: Object.values(sel), BUY: buy, YR: yr };
    }
    renderVals() {
      const S = this.state, { dep, coms, st, SEL, BUY, YR } = this.data(), nom = DEPS[dep] || dep, col = D.ARRETES_COLLECTES.has(dep), sel = S.sel;
      const DET = {};
      const cmp = (k, dir) => (a, b) => { const va = a[k], vb = b[k]; return (typeof va === "string" ? va.localeCompare(vb, "fr") : (va || 0) - (vb || 0)) * dir; };
      const sortHead = (defs, key, dir, onPick) => defs.map(([k, l, cls, w]) => ({ l, cls, w, sort: key === k ? (dir < 0 ? "descending" : "ascending") : "none", arrow: key === k ? (dir < 0 ? "↓" : "↑") : "", pick: () => onPick(k) }));
      const v = n => col ? D.fr(n) : "—";
      // the intercommunalities
      const IC = {};
      coms.forEach(c => { const o = IC[c.epci] ||= { code: c.epci, nom: c.epci ? D.epciNom(c.epci) : "Sans intercommunalité", n: 0, docs: 0, con: 0, aut: 0, dr: 0, cams: 0, list: [] }; o.n++; o.cams += c.carte || 0; o.list.push(c); });
      // an intercommunality counts each document once (an act shared by several of its communes too)
      Object.values(IC).forEach(o => { const u = D.uniq(o.list.map(c => c.insee)); o.docs = u.docs; o.con = u.con; o.aut = u.cam; o.dr = u.dr; });
      const ics = Object.values(IC).sort(cmp(S.sortI, S.dirI)).map(o => { const ex = S.openI === o.code;
        DET["i" + o.code] = { kicker: "Intercommunalité", title: o.nom, rows: [["Communes avec documents", D.fr(o.n)], ["Documents", D.fr(o.docs)], ["Contrats", D.fr(o.con)], ["Autorisations de caméras", v(o.aut)], ["Arrêtés de drones", v(o.dr)], ["Caméras sur la carte", D.fr(o.cams)]] };
        if (D.buyStats[o.code]) DET["i" + o.code].link = ["Voir l'acheteur →", D.buyerHref(o.code)];
        return { nom: o.nom, n: o.n, docs: D.fr(o.docs), con: D.fr(o.con), aut: v(o.aut), dr: v(o.dr), cams: D.fr(o.cams), cls: "r" + (sel === "i" + o.code || ex ? " on" : ""), ex: ex ? "true" : "false", arrow: ex ? "▾" : "▸", subStyle: ex ? "" : "display: none",
          subs: ex ? o.list.slice().sort((a, b) => b.docs - a.docs).map(c => ({ nom: c.nom, href: `#/commune/${c.insee}`, v: D.plur(c.docs, "doc.", "doc."), hover: this.pick("c" + c.insee) })) : [], hover: this.pick("i" + o.code),
          toggle: () => this.setState({ openI: ex ? null : o.code, sel: "i" + o.code }) }; });
      const icCols = sortHead([["nom", "Intercommunalité", "", "width: 38%"], ["n", "Communes", "num", ""], ["docs", "Documents", "num", ""], ["con", "Contrats", "num", ""], ["aut", "Autorisations", "num", ""], ["dr", "Drones", "num", ""], ["cams", "Sur la carte", "num", ""]], S.sortI, S.dirI, k => this.setState({ sortI: k, dirI: S.sortI === k ? -S.dirI : (k === "nom" ? 1 : -1) }));
      // every commune, filtered by name
      const q = D.plain(S.q.trim()), C = coms.map(c => ({ ...c, aut: c.cam, cams: c.carte || 0, nomK: c.nom }));
      const filtered = C.filter(c => !q || D.plain(c.nom).includes(q)).sort(cmp(S.sortC === "nom" ? "nomK" : S.sortC, S.dirC));
      const shown = q || S.allC ? filtered : filtered.slice(0, 15), mxd = Math.max(1, ...C.map(c => c.docs));
      C.forEach(c => { DET["c" + c.insee] = { kicker: "Commune · " + (c.epci ? D.epciNom(c.epci) : ""), title: c.nom, rows: [["Habitants", c.pop ? D.fr(c.pop) : "[à lire]"], ["Documents", D.fr(c.docs)], ["Contrats", D.fr(c.con)], ["Autorisations de caméras", v(c.cam)], ["Arrêtés de drones", v(c.dr)], ["Caméras sur la carte", D.fr(c.cams)]], link: ["Voir la commune →", `#/commune/${c.insee}`] }; });
      const comsV = shown.map(c => ({ nom: c.nom, ep: c.epci ? D.epciNom(c.epci) : "", epHref: c.epci ? (D.buyStats[c.epci] ? D.buyerHref(c.epci) : `#/departement/${dep}?ic=${c.epci}`) : "", docs: D.fr(c.docs), con: c.con, aut: v(c.cam), dr: v(c.dr), cams: D.fr(c.cams), href: `#/commune/${c.insee}`, cls: "r" + (sel === "c" + c.insee ? " on" : ""), hover: this.pick("c" + c.insee),
        bar: "display: inline-block; height: 10px; width: " + Math.max(2, Math.round(Math.sqrt(c.docs / mxd) * 110)) + "px; background: var(--accent)" }));
      const comCols = sortHead([["nom", "Commune", "", "width: 34%"], ["docs", "Documents", "num", ""], ["con", "Contrats", "num", ""], ["aut", "Autorisations", "num", ""], ["dr", "Drones", "num", ""], ["cams", "Sur la carte", "num", ""]], S.sortC, S.dirC, k => this.setState({ sortC: k, dirC: S.sortC === k ? -S.dirC : (k === "nom" ? 1 : -1) }));
      // who sells, who buys
      const sellers = SEL.slice().sort((a, b) => (S.sortV === "n" ? b.n - a.n || b.amt - a.amt : b.amt - a.amt)).slice(0, 10).map(x => { const k = "s" + x.s;
        DET[k] = { kicker: "Entreprise · SIREN " + x.s.replace(/(\d{3})(\d{3})(\d{3})/, "$1 $2 $3"), title: tidy(entName(x.s)), rows: [[`Contrats ${DANS(dep)}`, D.fr(x.n)], ["Au maximum", eurK(x.amt)]], link: ["Voir l'entreprise →", `#/entreprise/${x.s}`] };
        return { nom: tidy(entName(x.s)), href: `#/entreprise/${x.s}`, n: x.n, amt: eurK(x.amt), cls: "r" + (sel === k ? " on" : ""), hover: this.pick(k) }; });
      const vCols = [["n", "Contrats"], ["amt", "Montant max."]].map(([k, l]) => ({ l, sort: S.sortV === k ? "descending" : "none", arrow: S.sortV === k ? "↓" : "", pick: () => this.setState({ sortV: k }) }));
      const buyers = BUY.slice().sort((a, b) => (S.sortB === "n" ? b.n - a.n || b.montant - a.montant : b.montant - a.montant)).slice(0, 10).map(o => { const k = "b" + o.siren;
        DET[k] = { kicker: "Acheteur · " + D.buyerCat(o.siren), title: D.buyerNom(o.siren), rows: [["Contrats", D.fr(o.n)], ["Au maximum", eurK(o.montant)]], link: [ACH[o.siren]?.categorie === "commune" ? "Voir la commune →" : "Voir l'acheteur →", D.buyerHref(o.siren)] };
        return { nom: D.buyerNom(o.siren), cat: D.buyerCat(o.siren), n: o.n, amt: eurK(o.montant), href: D.buyerHref(o.siren), cls: "r" + (sel === k ? " on" : ""), hover: this.pick(k) }; });
      const bCols = [["n", "Contrats"], ["amt", "Montant max."]].map(([k, l]) => ({ l, sort: S.sortB === k ? "descending" : "none", arrow: S.sortB === k ? "↓" : "", pick: () => this.setState({ sortB: k }) }));
      // each year
      const yrs = ["2018", "2019", "2020", "2021", "2022", "2023", "2024", "2025", "2026"], y0col = (D.premierArrete[dep] || "9999").slice(0, 4);
      const absent = y => S.yt === "aut" && (!col || y < y0col);
      const vals = yrs.map(y => (YR[y] && YR[y][S.yt]) || 0), mx = Math.max(1, ...vals);
      const years = yrs.map((y, i) => { const on = sel === "y" + y, h = absent(y) ? 0 : Math.max(vals[i] ? 2 : 0, Math.round(vals[i] / mx * 190)), fill = on ? "var(--hover)" : "var(--fg)", o = YR[y] || {};
        DET["y" + y] = { kicker: y === "2026" ? "Année en cours" : "Année", title: y, rows: [["Contrats", D.fr(o.con || 0)], ["Modifications", D.fr(o.mod || 0)], ["Appels d'offres et résultats", D.fr(o.ao || 0)], ["Autorisations de caméras", !col || y < y0col ? "non collectées" : D.fr(o.aut || 0)], ["Subventions", D.fr(o.sub || 0)]], link: [`Les documents de ${y} →`, `#/?d=${dep}&y=${y}`] };
        return { y: y === "2026" ? "2026*" : y, v: absent(y) ? "—" : D.fr(vals[i]), alt: y + " : " + (absent(y) ? "non collecté" : D.fr(vals[i])), hover: this.pick("y" + y),
          bar: "display: block; height: " + h + "px; background: " + (y === "2026" ? "repeating-linear-gradient(45deg, " + fill + " 0 3px, transparent 3px 7px); border: 2px solid " + fill + "; box-sizing: border-box" : fill) }; });
      const TL = { con: "Contrats", ao: "Appels d'offres", aut: "Autorisations" };
      const yearTypes = Object.keys(TL).map(k => ({ l: TL[k], pressed: S.yt === k ? "true" : "false", pick: () => this.setState({ yt: k }), style: S.yt === k ? "background: var(--fg); color: var(--bg)" : "background: var(--card); color: var(--fg)" }));
      // the lead, in the § 3 words
      const top = Object.values(IC).sort((a, b) => b.aut - a.aut)[0], pa = top && st.cam ? PART(top.aut / st.cam) : null, pd = top && st.dr ? PART(top.dr / st.dr) : null;
      const topNom = top ? (/^(Métropole|CA |CC |CU |Communauté)/.test(top.nom) ? "la " : "") + top.nom : "";
      const lead = col ? `Depuis ${D.fmL(D.premierArrete[dep])}, la préfecture a signé <strong>${D.plur(st.cam, "autorisation")} de caméras</strong> et <strong>${D.plur(st.dr, "arrêté")} de drones</strong> ${esc(DANS(dep))}${pa ? ` : ${pa[0]} des autorisations${pd ? ` et ${pd[1]} les drones` : ""} concernent <strong>${esc(topNom)}</strong>` : ""}.`
        : `${D.plur(st.con, "contrat")} de vidéosurveillance signé${st.con > 1 ? "s" : ""} ${esc(DANS(dep))}, pour <strong>${eurK(st.montant)}</strong> au maximum. Les arrêtés de la préfecture ne sont pas encore collectés pour ce département.`;
      const kpis = [{ v: D.fr(st.docs), l: "documents" }, { v: D.fr(st.con), l: "contrats signés" }, { v: col ? D.fr(st.cam) : "—", l: "autorisations de caméras" }, { v: col ? D.fr(st.dr) : "—", l: "arrêtés de drones" }];
      const d0 = DET[sel];
      const det = d0 ? { kicker: d0.kicker, title: d0.title, rows: d0.rows.map(([k, x]) => ({ k, v: x })), links: d0.link ? [{ l: d0.link[0], href: d0.link[1] }] : [] }
        : { kicker: D.Maj(D.depArt(dep)), title: "Survolez une ligne ou une barre", rows: [{ k: "Documents", v: D.fr(st.docs) }, { k: "Communes avec documents", v: D.fr(coms.length) }, { k: "Intercommunalités", v: D.fr(Object.keys(IC).length) }, { k: "Documents sans commune publiée", v: D.fr(st.sansCommune) }], links: [] };
      const ao18 = (D.byDep[dep] || []).filter(e => D.typ(e) === "ao" && e.date < "2018").length;
      return Object.assign(this.base("departement"), this.info("ic", "qui", "an"), {
        fil: [{ l: "Registre", href: "#/" }], filIci: nom, nom, dans: DANS(dep), du: DU(dep),
        sous: `${dep} · ${D.plur(coms.length, "commune")} avec au moins un document · ${col ? `arrêtés de la préfecture collectés depuis ${D.fmL(D.premierArrete[dep])}` : "arrêtés de la préfecture pas encore collectés"}`,
        lead, kpis, nIc: Object.keys(IC).length, nCom: D.fr(coms.length), sansCommune: `${D.plur(st.sansCommune, "document")} ${DU(dep)}`,
        icCols, ics, comCols, coms: comsV, comCount: q ? D.plur(filtered.length, "commune trouvée", "communes trouvées") : (S.allC ? D.plur(C.length, "commune") : `15 sur ${D.plur(C.length, "commune")}`), q: S.q,
        onQ: e => this.setState({ q: e.target.value }), showMore: !q && C.length > 15, noMatch: !!q && filtered.length === 0, more: () => this.setState({ allC: !S.allC }), moreLabel: S.allC ? "Réduire" : `Les ${C.length} communes`,
        sellers, vCols, buyers, bCols, years, yearTypes, yearAlt: `Nombre de ${({ con: "contrats", ao: "appels d'offres", aut: "autorisations de caméras" })[S.yt]} ${DANS(dep)} par année, de 2018 à 2026 (2026 en cours).`,
        anNote: `${col ? `Les arrêtés de la préfecture ne sont collectés que depuis ${D.fmL(D.premierArrete[dep])} : avant, la barre est absente parce que le registre ne les a pas, pas parce qu'il n'y en avait pas.` : "Les arrêtés de la préfecture ne sont pas encore collectés pour ce département : la barre est absente."} 2026 est l'année en cours.${ao18 ? ` ${D.plur(ao18, "appel")} d'offres antérieur${ao18 > 1 ? "s" : ""} à 2018 ne ${ao18 > 1 ? "sont" : "est"} pas montré${ao18 > 1 ? "s" : ""}.` : ""}`, det,
      });
    }
  }
  V11.register("departement", Departement);
})();
