// View 9 · Acheteur (maquette Acheteur-grand.dc.html): the frieze with its visible legend, the sortable table,
// who sells here, the calls for tenders, the linked buyer.
(() => {
  "use strict";
  const D = D11;
  const eurK = n => n == null ? "non publié" : n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(".", ",") + " M€" : D.fr(n) + " €";
  const eurX = n => D.fr(n) + " €";
  const h = s => esc(s);
  const label = (a, e) => { const c = D.court(a); return c ? D.Maj(c) : D.sent(e?.objet || R.affaires[a]?.titre || ""); };
  const entA = s => `<a href="#/entreprise/${s}" class="rowlink">${h(tidy(entName(s)))}</a>`;
  function contrats(siren) {
    return (D.buyStats[siren]?.contrats || []).map(e => {
      const a = R.affaires[e.affaire], evs = a.events.map(i => EV[i]), mods = evs.filter(x => x.t === "modification"), last = mods[mods.length - 1];
      const avis = evs.find(x => x.t === "avis") || (a.avis_probables || []).map(x => R.affaires[x] && EV[R.affaires[x].events[0]]).filter(Boolean)[0];
      const res = evs.find(x => x.t === "resultat") || (avis ? (R.affaires[avis.affaire]?.events || []).map(i => EV[i]).find(x => x.t === "resultat") : null);
      return { e, a, d: D.dateLue(e), label: label(e.affaire, e), objet: D.sent(e.objet || a.titre || ""), ents: e.entreprises || [], m0: e.montant, m1: last && last.montant !== e.montant ? last.montant : null,
        d0: e.duree, d1: last && last.duree && last.duree !== e.duree ? last.duree : null, off: e.offres, avis, res, mods: mods.map(x => x.date), mixte: /^mixte/.test(e.hors_totaux || ""), out: !!(e.hors_totaux || e.national), ref: e.ref };
    }).sort((x, y) => x.d.localeCompare(y.d));
  }
  class Acheteur extends Vue {
    init() { return { sort: "date", dir: 1 }; }
    titre() { return D.buyerNom(this.props.siren); }
    renderVals() {
      const S = this.state, siren = this.props.siren, A = ACH[siren] || {}, C = contrats(siren), nom = D.buyerNom(siren).replace(/ \((transports lyonnais|centrale d’achat)\)$/, "");
      const DET = {};
      const ents = [...new Set(C.flatMap(c => c.ents))];
      const total = C.filter(c => !c.out).reduce((t, c) => t + (c.m0 || 0), 0), mixtes = C.filter(c => c.mixte);
      const kpis = [{ v: D.fr(C.length), l: C.length > 1 ? "contrats signés" : "contrat signé" }, { v: D.fr(ents.length), l: ents.length > 1 ? "entreprises" : "entreprise" },
        { v: eurK(total), l: mixtes.length ? `au maximum (hors contrat${mixtes.length > 1 ? "s" : ""} mixte${mixtes.length > 1 ? "s" : ""})` : "au maximum" }, { v: D.fr(C.filter(c => c.mods.length).length), l: "contrats modifiés après signature" }];
      // the lead: how many, when, for what, and who got most of them
      const L = (window.LEADS_ACHETEURS || {})[siren], y0 = C[0]?.d.slice(0, 4), y1 = C[C.length - 1]?.d.slice(0, 4);
      const byEnt = {}; C.forEach(c => c.ents.forEach(s => { byEnt[s] = (byEnt[s] || 0) + 1; }));
      const topE = Object.entries(byEnt).sort((a, b) => b[1] - a[1]), top2 = topE.slice(0, 2), got = C.filter(c => c.ents.some(s => top2.some(t => t[0] === s))).length;
      const lead = C.length ? `${L ? h(L.sujet) : h(nom)} a signé <strong>${D.plur(C.length, "contrat")}</strong> ${L ? h(L.pour) + " " : "de vidéosurveillance "}${y0 === y1 ? `en ${y0}` : `entre ${y0} et ${y1}`}.${top2.length > 1 && got < C.length ? ` <strong>${top2.map(t => h(tidy(entName(t[0])))).join(" et ")} en ont obtenu ${got}.</strong>` : top2.length === 1 ? ` <strong>Tous avec ${h(tidy(entName(top2[0][0])))}.</strong>` : ""}` : `${h(nom)} n'a signé aucun contrat de vidéosurveillance publié.`;
      // the frieze: signature → planned end, the time added by a change dashed, the notice, the changes
      const avisAll = C.map(c => c.avis).filter(Boolean);
      const t0y = Math.min(...C.map(c => +c.d.slice(0, 4)), ...avisAll.map(a => +a.date.slice(0, 4)), +TODAY.slice(0, 4));
      const T0 = Date.parse(`${t0y}-01-01`), T1 = Date.parse(TODAY);
      const P = d => Math.max(0, Math.min(100, (Date.parse(d) - T0) / (T1 - T0) * 100));
      const gantt = C.map((c, i) => { const k = "c" + i, on = this.on(k), col = on ? "var(--hover)" : "var(--fg)", end = c.d0 ? D.addM(c.d, c.d0) : null, end2 = c.d1 ? D.addM(c.d, c.d1) : null, a = P(c.d), b = end ? P(end) : 100;
        const r = [["Entreprise", c.ents.map(s => tidy(entName(s))).join(" + ") || "non publiée"], ["Montant max. à la signature", eurX(c.m0 || 0)]];
        if (c.m1) r.push(["Après modification", eurX(c.m1)]);
        r.push(["Durée", c.d1 ? `${c.d0} → ${c.d1} mois` : c.d0 ? `${c.d0} mois` : "non publiée"]); if (end) r.push(["Fin prévue", D.fd(end2 || end)]);
        r.push(["Offres reçues", c.off == null ? "non publié" : String(c.off)]); if (c.mods.length) r.push(["Modifications", c.mods.map(D.fd).join(", ")]);
        DET[k] = { kicker: "Contrat · " + D.fd(c.d) + (c.mixte ? " · contrat mixte" : ""), title: c.objet, rows: r, foot: c.ref + (c.avis ? " · appel d'offres " + c.avis.ref : ""), link: "Historique du contrat →", href: `#/contrat/${encodeURIComponent(c.e.affaire)}` };
        return { label: c.label, ent: c.ents.map(s => tidy(entName(s))).join(" + ") || "entreprise non publiée", entH: c.ents.map(s => `<a href="#/entreprise/${s}" style="color: inherit">${h(tidy(entName(s)))}</a>`).join(" + ") || "entreprise non publiée", amt: eurK(c.m0), href: `#/contrat/${encodeURIComponent(c.e.affaire)}`, cls: "gl" + (on ? " on" : ""),
          bar: "position: absolute; top: 0; bottom: 0; left: " + a.toFixed(2) + "%; width: " + Math.max(0.6, b - a).toFixed(2) + "%; background: " + col,
          ext: end2 ? "position: absolute; top: 0; bottom: 0; left: " + b.toFixed(2) + "%; width: " + (P(end2) - b).toFixed(2) + "%; border: 2px dashed " + col + "; border-left: 0; box-sizing: border-box" : "display: none",
          avis: c.avis ? "position: absolute; top: 2px; left: calc(" + P(c.avis.date).toFixed(2) + "% - 7px); width: 0; height: 0; border-left: 7px solid transparent; border-right: 7px solid transparent; border-bottom: 13px solid var(--ao)" : "display: none",
          mods: c.mods.map(d => ({ style: "position: absolute; top: -5px; bottom: -5px; left: " + P(d).toFixed(2) + "%; width: 3px; background: var(--accent)" })), hover: this.pick(k) }; });
      const years = []; for (let y = t0y; y <= +TODAY.slice(0, 4); y += 2) if (P(`${y}-01-01`) < 92) years.push({ l: String(y), style: "position: absolute; top: 4px; left: " + P(`${y}-01-01`).toFixed(2) + "%; transform: translateX(-50%)" });
      years.push({ l: "auj.", style: "position: absolute; top: 4px; right: 0; color: var(--fg)" });
      const enCours = C.filter(c => c.d0 && D.addM(c.d, c.d1 || c.d0) >= TODAY).length;
      const lieS = (window.ACHETEURS_LIES || {})[siren], LC = lieS ? contrats(lieS) : [];
      const tempsPhrase = (enCours ? `${D.plur(enCours, "de ces contrats est encore en cours", "de ces contrats sont encore en cours").replace(/^1 de ces contrats/, "Un de ces contrats")}.` : "Aucun de ces contrats n'est encore en cours.")
        + (lieS && LC.length ? ` Les suivants, de ${LC[0].d.slice(0, 4)} à ${LC[LC.length - 1].d.slice(0, 4)}, sont signés par <a href="#lie">${h(D.buyerNom(lieS))}</a>.` : "");
      // the table
      const keyf = { date: c => c.d, objet: c => c.label, ent: c => entName(c.ents[0] || ""), amt: c => c.m0 || 0, dur: c => c.d1 || c.d0 || 0, off: c => c.off == null ? -1 : c.off };
      const list = C.map((c, i) => [c, i]).sort((x, y) => { const f = keyf[S.sort], va = f(x[0]), vb = f(y[0]); return (typeof va === "string" ? va.localeCompare(vb, "fr") : va - vb) * S.dir; });
      const rows = list.map(([c, i]) => ({ date: D.fd(c.d), objet: c.label, mixte: c.mixte, ents: c.ents.map(s => ({ nom: tidy(entName(s)), href: `#/entreprise/${s}` })), href: `#/contrat/${encodeURIComponent(c.e.affaire)}`,
        amt: c.m0 == null ? "non publié" : eurX(c.m0), amt2: c.m1 ? "→ " + eurX(c.m1) + " après modification" : "", dur: c.d1 ? `${c.d0} → ${c.d1} mois` : c.d0 ? `${c.d0} mois` : "—", off: c.off == null ? "non publié" : String(c.off),
        cls: "r" + (this.on("c" + i) ? " on" : ""), hover: this.pick("c" + i) }));
      const cols = this.cols([["date", "Signature", "", "width: 120px"], ["objet", "Objet", "", ""], ["ent", "Entreprise", "", "width: 180px"], ["amt", "Montant max.", "num", ""], ["dur", "Durée", "num", ""], ["off", "Offres", "num", ""]], "sort", "dir", k => k === "amt" || k === "dur" || k === "off" ? -1 : 1);
      // who sells here
      const SE = ents.map(s => { const cs = C.filter(c => c.ents.includes(s)), shared = cs.filter(c => c.ents.length > 1), others = [...new Set(shared.flatMap(c => c.ents.filter(x => x !== s)))].map(x => `<a href="#/entreprise/${x}" style="color: inherit">${h(tidy(entName(x)))}</a>`);
        const mix = cs.filter(c => c.mixte);
        const note = [mix.length ? `dont le contrat mixte « ${h(D.court(mix[0].e.affaire) || mix[0].label)} »` : "", shared.length ? (shared.length === cs.length ? `avec ${others.join(", ")}, montant partagé non publié` : `dont ${shared.length} avec ${others.join(", ")}`) : ""].filter(Boolean).join(" ; ");
        return { s, n: cs.length, amt: cs.reduce((t, c) => t + (c.m0 || 0), 0), note }; }).sort((a, b) => b.amt - a.amt);
      const mxs = SE[0]?.amt || 1;
      const sellers = SE.map((x, i) => { const k = "s" + i;
        DET[k] = { kicker: "Entreprise", title: tidy(entName(x.s)), rows: [[`Contrats avec ${nom}`, String(x.n)], ["Au maximum", eurX(x.amt)]].concat(x.note ? [["À noter", x.note.replace(/<[^>]+>/g, "")]] : []), foot: "Montants à la signature, avant modification.", link: "Page de l'entreprise →", href: `#/entreprise/${x.s}` };
        return { nom: tidy(entName(x.s)), href: `#/entreprise/${x.s}`, n: x.n, amt: eurK(x.amt), note: x.note, bar: "display: inline-block; height: 10px; width: " + Math.max(3, Math.round(x.amt / mxs * 160)) + "px; background: var(--accent)", cls: "r" + (this.on(k) ? " on" : ""), hover: this.pick(k) }; });
      // calls for tenders: those of its contracts, and those without a contract found
      const AO = [];
      C.forEach(c => { if (c.avis) AO.push({ d: c.avis.date, objet: c.label, refs: [`avis ${c.avis.ref.replace("BOAMP ", "")}`].concat(c.res ? [`résultat ${c.res.ref.replace("BOAMP ", "")}`] : []).join(" · "), contrat: `${D.fm(c.d)} · ${c.ents.map(s => tidy(entName(s))).join(" + ")}`, chref: `#/contrat/${encodeURIComponent(c.e.affaire)}`, href: `#/contrat/${encodeURIComponent(c.avis.affaire)}` }); });
      Object.values(R.affaires).filter(a => a.kind === "contrat_non_retrouve" && a.events.some(i => EV[i].acheteur_siren === siren) && !C.some(c => c.avis && c.avis.affaire === a.id)).forEach(a => {
        const evs = a.events.map(i => EV[i]), av = evs.find(x => x.t === "avis") || evs[0], res = evs.filter(x => x.t === "resultat"), rect = evs.filter(x => x.t === "rectificatif");
        const pc = a.contrat_probable && R.affaires[a.contrat_probable], pe = pc && EV[pc.events.find(i => EV[i].t === "attribution")];
        AO.push({ d: a.debut, objet: label(a.id, av), refs: [av.t === "avis" ? `avis ${av.ref.replace("BOAMP ", "")}` : "", ...rect.map(x => `rectificatif ${x.ref.replace("BOAMP ", "")}`), ...res.map(x => `résultat ${x.ref.replace("BOAMP ", "")}`)].filter(Boolean).join(" · ") || av.ref,
          contrat: pe ? `${D.fm(pe.date)} · ${(pe.entreprises || []).map(s => tidy(entName(s))).join(" + ")} (probable)` : "", chref: pc ? `#/contrat/${encodeURIComponent(pc.id)}` : "", href: `#/contrat/${encodeURIComponent(a.id)}` }); });
      AO.sort((a, b) => a.d.localeCompare(b.d));
      const aos = AO.map((a, i) => { const k = "o" + i;
        DET[k] = { kicker: "Appel d'offres · " + D.fd(a.d), title: a.objet, rows: [["Publications", a.refs], ["Contrat", a.contrat || "non retrouvé"]], foot: "Bulletin officiel des annonces des marchés publics.", link: a.contrat ? "Historique du contrat →" : "", href: a.chref };
        return { date: D.fd(a.d), objet: a.objet, refs: a.refs, contrat: a.contrat, chref: a.chref, href: a.href, found: !!a.contrat, missing: !a.contrat, cls: "r" + (this.on(k) ? " on" : ""), hover: this.pick(k) }; });
      // the linked buyer
      const lie = lieS && LC.length ? { nom: D.buyerNom(lieS), href: `#/acheteur/${lieS}`, sous: `SIREN ${lieS.replace(/(\d{3})(\d{3})(\d{3})/, "$1 $2 $3")} · ${D.plur(LC.length, "contrat")}, ${LC[0].d.slice(0, 4)} → ${LC[LC.length - 1].d.slice(0, 4)}` } : null;
      const mob = LC.map(c => ({ date: D.fd(c.d), objet: c.label, ent: c.ents.map(entA).join(" + ") || "entreprise non publiée", amt: eurK(c.m0) }));
      const tabs = [["#temps", "Dans le temps"], ["#contrats", "Contrats · " + C.length], ["#vend", "Qui vend · " + ents.length], ["#ao", "Appels d'offres · " + AO.length]].concat(lie ? [["#lie", lie.nom]] : []).map(([hr, l], i) => ({ href: hr, l, cur: i === 0 ? "page" : null }));
      const d0 = DET[S.sel];
      const det = d0 ? { kicker: d0.kicker, title: d0.title, rows: d0.rows.map(([k, v]) => ({ k, v })), foot: d0.foot, links: d0.link ? [{ l: d0.link, href: d0.href }] : [] }
        : { kicker: "Acheteur · " + D.buyerCat(siren), title: nom, rows: [{ k: "Contrats signés", v: D.fr(C.length) }, { k: "Entreprises", v: D.fr(ents.length) }, { k: "Au maximum", v: eurK(total) }].concat(C.length ? [{ k: "Premier contrat", v: D.fd(C[0].d) }, { k: "Dernier contrat", v: D.fd(C[C.length - 1].d) }] : []), foot: "Survolez un contrat, une entreprise ou un appel d'offres.", links: [] };
      const dep = A.dep, siege = A.insee_siege && R.communes[A.insee_siege] ? R.communes[A.insee_siege].nom : "";
      return Object.assign(this.base("acheteur"), this.info("tps", "mt"), {
        fil: [{ l: "Registre", href: "#/" }].concat(dep && DEPS[dep] ? [{ l: DEPS[dep], href: `#/departement/${dep}` }] : []), filIci: nom, cat: D.buyerCat(siren), nom,
        sous: `${A.nom && A.nom !== nom ? A.nom + " · " : ""}SIREN ${siren.replace(/(\d{3})(\d{3})(\d{3})/, "$1 $2 $3")}${siege ? ` · ${siege} (${DEPS[dep] || dep})` : ""}`,
        lead, kpis, tabs, gantt, years, tempsPhrase, conTitre: `Les ${D.plur(C.length, "contrat")}`.replace("Les 1 contrat", "Le contrat"), rows, cols,
        mtNote: "Montants maximums prévus au contrat, hors taxes, pas les sommes payées. Une flèche montre le montant après modification." + (mixtes.length ? ` Le contrat « ${D.court(mixtes[0].e.affaire) || mixtes[0].label} » est un contrat mixte (d'autres travaux que la vidéoprotection) : il n'est pas compté dans le total de ${eurK(total)}.` : ""),
        nEnts: D.plur(ents.length, "entreprise"), sellers, aoSous: AO.length ? `${D.plur(AO.length, "consultation")} depuis ${AO[0].d.slice(0, 4)} · BOAMP` : "aucune consultation publiée", aos, lie, mob, det,
      });
    }
  }
  V11.register("acheteur", Acheteur);
})();
