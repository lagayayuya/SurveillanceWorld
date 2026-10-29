// View 8 · Entreprise (maquette Entreprise-grand.dc.html). The scatter of amounts is gone (brief § 2.8): in its
// place, the contracts running today and the largest ones. A contract published twice counts once (10th pass).
(() => {
  "use strict";
  const D = D11;
  const eur = n => n >= 1e6 ? (n / 1e6).toFixed(2).replace(".", ",").replace(/,?0+$/, "") + " M€" : D.fr(n) + " €";
  const h = s => esc(s);
  const IDF = new Set(["75", "77", "78", "91", "92", "93", "94", "95"]);
  const REGION = d => IDF.has(d) ? "idf" : d;
  const DANS = r => r === "idf" ? "en Île-de-France" : r === "75" ? "à Paris" : "dans " + D.depArt(r);
  const placeOf = s => { const a = ACH[s]; return a?.categorie === "commune" && a.insee_siege && R.communes[a.insee_siege] ? R.communes[a.insee_siege].nom : D.buyerNom(s); };
  // a contract is named by its place (its commune), as the mockup's lists do; else by its buyer
  const placeC = c => c.e.insee && R.communes[c.e.insee] ? R.communes[c.e.insee].nom : placeOf(c.b);
  const hrefOf = s => D.buyerHref(s);
  class Entreprise extends Vue {
    init() { return { sort: "amt", dir: -1, all: false, allAct: false }; }
    titre() { return tidy(entName(this.props.siren)); }
    data() {
      if (this._d) return this._d;
      const siren = this.props.siren, st = D.entStats[siren] || { n: 0, clientes: new Set(), montant: 0, deps: {}, y0: "", contrats: [], copies: 0 };
      const CT = st.contrats.map(e => ({ e, d: D.dateLue(e), b: D.buyer(e), amt: !e.hors_totaux && !e.national ? e.montant || 0 : 0, raw: e.montant || 0 })).sort((a, b) => a.d.localeCompare(b.d));
      const cl = {}; CT.forEach(c => { if (!c.b) return; const o = cl[c.b] ||= { s: c.b, n: 0, amt: 0, last: "" }; o.n++; o.amt += c.amt; if (c.d > o.last) o.last = c.d; });
      return this._d = { siren, st, CT, CL: Object.values(cl) };
    }
    renderVals() {
      const S = this.state, { siren, st, CT, CL } = this.data(), nom = tidy(entName(siren)), x = R.entreprises[siren] || {};
      const DET = {};
      // the lead: what it does (its contracts' categories), where (its clients' regions), how much
      const cats = {}; CT.forEach(c => { const k = R.affaires[c.e.affaire]?.categorie || "autre"; cats[k] = (cats[k] || 0) + 1; });
      const has = k => (cats[k] || 0) >= 2 || (cats[k] || 0) >= CT.length * 0.15;
      const fait = siren === "899832901" ? "Elle vend surtout des <strong>caméras déplaçables qui repèrent les dépôts sauvages</strong>, et le logiciel qui va avec"
        : (has("installation") || has("extension")) && has("maintenance") ? "Elle installe et entretient des systèmes de vidéosurveillance" : has("installation") || has("extension") ? "Elle installe des systèmes de vidéosurveillance"
        : has("maintenance") ? "Elle entretient des systèmes de vidéosurveillance" : "Elle vend des équipements et des services de vidéosurveillance";
      const reg = {}; CL.forEach(c => { const r = REGION(ACH[c.s]?.dep || ""); if (r) reg[r] = (reg[r] || 0) + 1; });
      const regs = Object.entries(reg).sort((a, b) => b[1] - a[1]), tot = CL.length || 1;
      const ou = regs.length && regs[0][1] / tot >= 0.5 ? `, <strong>surtout ${DANS(regs[0][0])}</strong>${regs[1] && regs[1][1] / tot >= 0.15 ? ` et ${DANS(regs[1][0])}` : ""}` : regs.length > 1 ? `, ${DANS(regs[0][0])} et ${DANS(regs[1][0])}` : regs.length ? ` ${DANS(regs[0][0])}` : "";
      const lead = `${fait}${ou}. <strong>${D.plur(CL.length, "collectivité")}</strong> lui ont signé <strong>${D.plur(CT.length, "contrat")}</strong> depuis ${st.y0 || "—"}.`.replace("lui ont signé", CL.length > 1 ? "lui ont signé" : "lui a signé");
      const of = (window.FAITS?.[siren] || []).find(f => f.type === "offres")?.chiffres;
      const total = CT.reduce((t, c) => t + c.amt, 0);
      const ks = "padding: 14px 0 14px 20px; border-left: 1px solid var(--rule)";
      const kpis = [{ v: D.fr(CT.length), l: CT.length > 1 ? "contrats signés" : "contrat signé", s: "padding: 14px 0" }, { v: D.fr(CL.length), l: CL.length > 1 ? "clientes" : "cliente", s: ks },
        { v: total >= 1e6 ? (total / 1e6).toFixed(total >= 1e7 ? 1 : 1).replace(".", ",") + "\u00a0M€" : D.fr(total) + "\u00a0€", l: "au maximum", s: ks }, { v: of ? `${of.une_offre} sur ${of.renseignes}` : "—", l: "contrats avec une seule offre", s: ks }];
      // the years
      const yrs = []; for (let y = +(st.y0 || TODAY.slice(0, 4)); y <= +TODAY.slice(0, 4); y++) yrs.push(String(y));
      const ya = yrs.map(y => CT.filter(c => c.d.startsWith(y))), sums = ya.map(l => l.reduce((t, c) => t + c.amt, 0)), mxs = Math.max(1, ...sums);
      const years = yrs.map((y, i) => { const k = "y" + y;
        DET[k] = { kicker: "Année", title: y, rows: [["Contrats signés", String(ya[i].length)], ["Au maximum", eur(sums[i])], ["Plus gros contrat", ya[i].length ? eur(Math.max(...ya[i].map(c => c.amt))) : "—"], ["Clientes", String(new Set(ya[i].map(c => c.b)).size)]], link: `Voir les contrats de ${y} →`, href: `#/?q=${encodeURIComponent(nom)}&y=${y}` };
        return { y, v: (sums[i] / 1e6).toFixed(1).replace(".", ",") + " M€", n: D.plur(ya[i].length, "contrat"), bar: "display: block; height: " + Math.max(2, Math.round(sums[i] / mxs * 180)) + "px; background: " + (this.on(k) ? "var(--hover)" : "var(--fg)"), hover: this.pick(k) }; });
      const yearsCols = `repeat(${yrs.length}, minmax(0, 1fr))`;
      // running today: the planned end not passed, the nearest first, with how much of it has run
      const ym = s => +s.slice(0, 4) * 12 + +s.slice(5, 7);
      const cDet = (c, k) => { const end = c.e.duree ? D.addM(c.d, c.e.duree) : null; DET[k] = { kicker: "Contrat · " + D.fd(c.d), title: placeC(c), rows: [["Montant maximum", eur(c.raw)], ["Durée", c.e.duree ? `${c.e.duree} mois, fin prévue ${end ? D.fm(end) : "—"}` : "non publiée"], ["Offres reçues", c.e.offres != null ? String(c.e.offres) : "non publié"], ["Entreprises", (c.e.entreprises || []).length > 1 ? "à plusieurs" : "seule"]], link: "Historique du contrat →", href: `#/contrat/${encodeURIComponent(c.e.affaire)}` }; };
      const actAll = CT.map((c, i) => ({ c, i, end: c.e.duree ? D.addM(c.d, c.e.duree) : null })).filter(o => o.end && o.end.slice(0, 7) >= TODAY.slice(0, 7)).sort((a, b) => a.end.localeCompare(b.end));
      const act = (S.allAct ? actAll : actAll.slice(0, 8)).map(o => { const k = "c" + o.i, on = this.on(k); cDet(o.c, k);
        const pct = Math.max(2, Math.min(100, Math.round((ym(TODAY) - ym(o.c.d)) / Math.max(1, ym(o.end) - ym(o.c.d)) * 100)));
        return { nom: placeC(o.c), span: o.c.d.slice(0, 4) + " → " + D.fm(o.end), amt: eur(o.c.raw), prog: "position: absolute; left: 0; top: 0; bottom: 0; width: " + pct + "%; background: " + (on ? "var(--hover)" : "var(--accent)"), cls: "bar2" + (on ? " on" : ""), hover: this.pick(k) }; });
      const bigL = CT.map((c, i) => ({ c, i })).sort((a, b) => b.c.raw - a.c.raw).slice(0, 8), bmx = bigL[0]?.c.raw || 1;
      const big = bigL.map(o => { const k = "c" + o.i, on = this.on(k); cDet(o.c, k);
        return { nom: placeC(o.c), y: D.fd(o.c.d), amt: eur(o.c.raw), bar: "display: inline-block; height: 14px; width: " + Math.max(4, Math.round(o.c.raw / bmx * 150)) + "px; background: " + (on ? "var(--hover)" : "var(--fg)"), cls: "bar2" + (on ? " on" : ""), hover: this.pick(k) }; });
      // what stands out: the facts of the 10th pass (faits.js), in the mockup's words; every name a link
      const names = s => { const m = /dans \d+ collectivités \((.+)\)$/.exec(s), m2 = /à (.+?)(?:, à \d+ jours d'intervalle)?$/.exec(s);
        const L = m ? m[1].split(", ") : m2 ? m2[1].split(/,? et à |, à | et /) : []; return L; };
      const link = n => { const b = CL.find(c => placeOf(c.s) === n || D.buyerNom(c.s) === n || ACH[c.s]?.nom === n); return b ? `<a href="${hrefOf(b.s)}">${h(n)}</a>` : h(n); };
      const amtOf = s => /^(?:les mêmes montants reviennent : )?((?:de [\d   ]+ à )?[\d   ]+ €)/.exec(s)?.[1] || "";
      const list = L => L.length > 1 ? L.slice(0, -1).map(link).join(", ") + " et " + link(L[L.length - 1]) : L.map(link).join("");
      const F = window.FAITS?.[siren] || [], ids = F.filter(f => f.type === "montants_identiques");
      const faits = [];
      const tops = ids.slice().sort((a, b) => b.chiffres.contrats - a.chiffres.contrats || b.chiffres.min - a.chiffres.min).slice(0, 2);
      if (tops.length) faits.push(`<strong>Les mêmes montants reviennent</strong> : ${tops.map(f => `${h(amtOf(f.phrase))} à ${list(names(f.phrase))}`).join(" ; ")}.`);
      const close = ids.filter(f => f.chiffres.ecart_jours != null && f.chiffres.ecart_jours <= 31 && !tops.includes(f)).sort((a, b) => a.chiffres.ecart_jours - b.chiffres.ecart_jours)[0];
      if (close) { const L = names(close.phrase); faits.push(`<strong>${h(amtOf(close.phrase))}</strong> à ${L.map(link).join(" et à ")}, à ${close.chiffres.ecart_jours} jours d'intervalle.`); }
      if (of && of.renseignes) faits.push(`<strong>Une seule offre</strong> pour ${D.plur(of.une_offre, "contrat")} sur les ${of.renseignes} où le nombre d'offres est publié.`);
      // the clients: a bar by département, a sortable table
      const dc = {}; CL.forEach(c => { const d = ACH[c.s]?.dep || ""; dc[d] = (dc[d] || 0) + 1; });
      const dl = Object.entries(dc).sort((a, b) => b[1] - a[1]);
      const deps = dl.map(([d, n], i) => ({ l: (DEPS[d] || d) + " : " + D.plur(n, "cliente"), short: (i === 0 ? (DEPS[d] || d) : d) + " · " + n, style: "display: flex; align-items: center; padding: 0 8px; overflow: hidden; white-space: nowrap; font-size: 13px; font-weight: 700; flex: " + n + " 1 0; " + (i === 0 ? "background: var(--fg); color: var(--bg)" : "border-left: 2px solid var(--fg); background: var(--soft); color: var(--fg)") }));
      const key = { nom: c => D.buyerNom(c.s), dep: c => DEPS[ACH[c.s]?.dep] || "", n: c => c.n, amt: c => c.amt, last: c => c.last };
      const sorted = CL.slice().sort((a, b) => { const va = key[S.sort](a), vb = key[S.sort](b); return (typeof va === "string" ? va.localeCompare(vb, "fr") : va - vb) * S.dir; });
      const mxa = Math.max(1, ...CL.map(c => c.amt));
      const clients = (S.all ? sorted : sorted.slice(0, 15)).map(c => { const k = "k" + c.s;
        DET[k] = { kicker: "Cliente · " + D.buyerCat(c.s), title: D.buyerNom(c.s), rows: [["Département", DEPS[ACH[c.s]?.dep] || "—"], ["Contrats", String(c.n)], ["Au maximum", eur(c.amt)], ["Dernier contrat", c.last.split("-").reverse().join("/")]], link: ACH[c.s]?.categorie === "commune" ? "Voir la commune →" : "Voir l'acheteur →", href: hrefOf(c.s) };
        return { nom: D.buyerNom(c.s), cat: D.buyerCat(c.s), dep: DEPS[ACH[c.s]?.dep] || "—", n: c.n, amt: eur(c.amt), last: c.last.slice(0, 4), href: hrefOf(c.s), cls: "r" + (this.on(k) ? " on" : ""), bar: "display: inline-block; height: 10px; width: " + Math.max(2, Math.round(c.amt / mxa * 120)) + "px; background: var(--accent)", hover: this.pick(k) }; });
      const cols = this.cols([["nom", "Cliente", "", "width: 44%"], ["dep", "Département", "", ""], ["n", "Contrats", "num", ""], ["amt", "Montant max.", "num", ""], ["last", "Dernier", "num", ""]], "sort", "dir", k => k === "nom" || k === "dep" ? 1 : -1);
      // signed together with other companies
      const par = {}; CT.forEach(c => (c.e.entreprises || []).filter(s => s !== siren).forEach(s => { par[s] = (par[s] || 0) + 1; }));
      const nPar = CT.filter(c => (c.e.entreprises || []).length > 1).length;
      const partners = Object.entries(par).sort((a, b) => b[1] - a[1] || entName(a[0]).localeCompare(entName(b[0]), "fr")).map(([s, n]) => ({ nom: tidy(entName(s)), n: D.plur(n, "contrat"), href: `#/entreprise/${s}` }));
      const mods = CT.reduce((t, c) => t + R.evenements.filter(e => e.affaire === c.e.affaire && e.t === "modification").length, 0);
      const d0 = DET[this.state.sel];
      const det = d0 ? { kicker: d0.kicker, title: d0.title, rows: d0.rows.map(([k, v]) => ({ k, v })), links: d0.link ? [{ l: d0.link, href: d0.href }] : [] }
        : { kicker: "Détail", title: "Survolez un contrat, une année ou une cliente", rows: [{ k: "Contrats signés", v: D.fr(CT.length) }, { k: "Clientes", v: D.fr(CL.length) }, { k: "Au maximum", v: eur(total) }, { k: "Premier contrat", v: CT[0] ? D.fd(CT[0].d) : "—" }], links: [] };
      const tabs = [["#argent", "L'argent"], ["#clientes", "Clientes · " + CL.length], ["#partenaires", "À plusieurs · " + nPar], ["#contrats", "Contrats · " + (CT.length + mods)]].map(([hr, l], i) => ({ href: hr, l, style: "display: inline-flex; align-items: center; min-height: 52px; padding: 0 18px; font-weight: 800; font-stretch: 80%; text-transform: uppercase; text-decoration: none; color: var(--fg); " + (i === 0 ? "box-shadow: inset 0 -4px 0 var(--fg)" : "") }));
      return Object.assign(this.base("entreprise"), this.info("mt", "par"), {
        fil: [{ l: "Registre", href: "#/" }, { l: "Entreprises", href: "#/registre/chiffres" }], filIci: nom, nom, sous: `SIREN ${siren.replace(/(\d{3})(\d{3})(\d{3})/, "$1 $2 $3")}${x.naf_libelle ? " · " + x.naf_libelle.charAt(0).toLowerCase() + x.naf_libelle.slice(1) : ""}`,
        lead, kpis, tabs, years, yearsCols, act, big, nBig: big.length, nCon: D.fr(CT.length), nAct: D.plur(actAll.length, "contrat"), actMore: actAll.length > 8, actLabel: S.allAct ? "Réduire" : `Les ${actAll.length} contrats en cours`, toggleAct: () => this.setState({ allAct: !S.allAct }),
        faits, nCli: D.fr(CL.length), deps, depAlt: "Clientes par département : " + dl.map(([d, n]) => (DEPS[d] || d) + " " + n).join(", "), yearAlt: `Montant maximum des contrats signés chaque année, de ${yrs[0]} à ${yrs[yrs.length - 1]}.`,
        cols, clients, more: () => this.setState({ all: !S.all }), moreLabel: S.all ? "Réduire" : `Les ${CL.length} clientes`, showMore: CL.length > 15,
        doublonNote: st.copies ? ` Un contrat publié deux fois compte une fois : ${D.plur(CT.length, "contrat")} ici, ${D.fr(CT.length + st.copies)} lignes publiées dans les données de la commande publique.` : "",
        parPhrase: nPar ? `${D.fr(nPar)} des ${D.fr(CT.length)} contrats ont été signés avec d'autres entreprises.` : "Aucun contrat signé avec d'autres entreprises.", partners,
        docsPhrase: `${D.plur(CT.length + mods, "document")} : ${D.plur(CT.length, "contrat")} et ${D.plur(mods, "modification")}, avec la cliente, le montant et la source.`, parcourir: `#/?q=${encodeURIComponent(nom)}`, det,
      });
    }
  }
  V11.register("entreprise", Entreprise);
})();
