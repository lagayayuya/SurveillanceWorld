// View 3 · Commune · L'essentiel (maquette Commune-grand.dc.html). The figures come from the registre (ess() of
// app.js); the sentences written for Mions in the mockup become rules, each hidden where it does not hold.
(() => {
  "use strict";
  const D = D11;
  const eur = n => n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(".", ",") + " M€" : D.fr(n) + " €";
  const h = s => esc(s);
  const entA = s => `<a href="#/entreprise/${s}">${h(tidy(entName(s)))}</a>`;
  const MK = { dossier: "display: inline-block; width: 12px; height: 12px; border: 3px solid var(--fg); border-radius: 50%", contrat: "display: inline-block; width: 14px; height: 14px; background: var(--fg)",
    aut: "display: inline-block; width: 13px; height: 13px; border: 3px solid var(--fg); transform: rotate(45deg); box-sizing: border-box",
    ao: "display: inline-block; width: 0; height: 0; border-left: 8px solid transparent; border-right: 8px solid transparent; border-bottom: 14px solid var(--ao)",
    vote: "display: inline-block; width: 14px; height: 3px; background: var(--muted); vertical-align: middle",
    sub: "display: inline-block; width: 14px; height: 14px; background: var(--sub)", an: "display: inline-block; width: 14px; height: 3px; background: var(--fg); vertical-align: middle" };
  const ym = d => +d.slice(0, 4) * 12 + (+d.slice(5, 7) - 1);
  const TODAY11 = TODAY;

  class Commune extends Vue {
    init(p) { return { playing: true }; }
    titre() { return R.communes[this.props.insee]?.nom || "Commune"; }
    data() {
      if (this._d) return this._d;
      const insee = this.props.insee, s = ess(insee), c = s.c, com = D.tete(insee, "ess");
      const d = { s, c, com, insee, nom: c.nom };
      // money: the counted contracts (lots added up, a doublon once), placed at the reviewed date when flagged
      d.cs = mergeLots(s.contrats.filter(e => !isCopy(e))).map(e => ({ ...e, dl: D.dateLue(e) })).sort((a, b) => a.dl.localeCompare(b.dl));
      d.counted = d.cs.filter(e => !e.hors_totaux && !e.national);
      d.y0 = (d.counted[0] || d.cs[0])?.dl.slice(0, 4);
      d.aos = Object.values(R.affaires).filter(a => a.insee === insee && a.kind === "contrat_non_retrouve" && a.events.some(i => EV[i].t === "avis")).sort((a, b) => a.debut.localeCompare(b.debut));
      // the mairie's main dossier: its acts (the largest dossier first, as ess() sorts them)
      const main = s.com[0] ? affaire(s.com[0].affaire) : null;
      d.main = main; d.mainActs = main ? main.events.map(i => EV[i]).filter(e => e.cameras != null).sort(byDateAsc) : [];
      return this._d = d;
    }
    componentDidMount() {
      const { insee, c } = this.data(), el = document.getElementById("carte-ess");
      if (!el) return;
      if (nCartes(insee) == null) { el.innerHTML = `<p style="margin: 0; padding: 20px; color: var(--muted)">La carte de ${h(c.nom)} n'est pas encore découpée dans ce prototype : elle le sera pour toutes les communes du site.</p>`; el.style.height = "auto"; return; }
      // the zones of this commune only (a neighbour's zone that spills over is not this commune's)
      const zid = Object.fromEntries((window.ZONES || []).map(z => [z.id, z.site]));
      const mine = new Set((window.AUTORISATIONS || []).filter(a => a.insee.includes(insee)).flatMap(a => a.zones.map(z => zid[z])).filter(Boolean));
      const sites = (window.SITES || []).filter(u => mine.has(u.id) && u.parts?.[insee]);
      mountMap(el, insee, { fixe: true, sites, couches: { cams: true, vsa: true, drones: true }, play: !/[?&]rotation=0\b/.test(location.search) }).then(m => {
        if (!m) return; this.map = m;
        const H = D.heuresSites(insee, null, null);
        m.setHeures(Object.fromEntries(Object.entries(H).map(([k, x]) => [k, { heures: x.heures, n: x.n }])));
        this.setState({ playing: m.playing() });
      });
    }
    componentWillUnmount() { this.map?.stop(false); }
    renderVals() {
      const S = this.state, d = this.data(), { s, c, insee, nom } = d;
      const n = nCartes(insee), pub = (window.CARTE_PUB || {})[insee];
      const sel = k => this.pick(k), on = k => this.on(k);
      const DET = {};
      // --- the lead sentence (one) and the four figures
      let lead;
      if (s.camAut && s.complet) {
        lead = `En ${D.fmL(s.dateAut)}, la préfecture a autorisé <strong>${D.plur(s.camAut, "caméra")}</strong> ${s.com[0].type_beneficiaire === "epci" ? "à l'intercommunalité" : `à la mairie de ${h(nom)}`}.`;
        if (s.vpAut != null) lead += ` <strong>${D.fr(s.vpAut)}</strong> filment la rue.`;
        if (n != null) lead += n < s.camAut ? ` La carte n'en connaît que <strong>${D.fr(n)}</strong>.` : ` La carte en connaît <strong>${D.fr(n)}</strong>.`;
      } else if (s.camAut) lead = `Arrêtés publiés depuis ${D.fmL(D.premierArrete[c.dep] || s.dateAut)} : ${D.plur(s.com.length, "dossier")} de la mairie, <strong>${D.plur(s.camAut, "caméra")}</strong>. Ce n'est pas le total de la ville.`;
      else if (d.counted.length) lead = `Depuis ${d.y0}, ${h(nom)} a signé <strong>${D.plur(d.counted.length, "contrat")}</strong> de vidéosurveillance, pour <strong>${eur(d.counted.reduce((t, e) => t + (e.montant || 0), 0))}</strong> au maximum.${n != null ? ` La carte connaît <strong>${D.fr(n)}</strong> caméra${n > 1 ? "s" : ""}.` : ""}`;
      else if (s.all.length) lead = `${D.plur(s.all.length, "document")} trouvé${s.all.length > 1 ? "s" : ""} pour ${h(nom)}.${n != null ? ` La carte connaît <strong>${D.fr(n)}</strong> caméra${n > 1 ? "s" : ""}.` : ""}`;
      else lead = `Aucun document trouvé pour ${h(nom)} dans les sources collectées.`;
      if (!s.arretesCollectes && !s.hors) lead += c.dep === "75" ? " Les arrêtés de la préfecture de police ne sont pas encore collectés." : " Les arrêtés de la préfecture ne sont pas encore collectés pour ce département.";
      const total = d.counted.reduce((t, e) => t + (e.montant || 0), 0);
      const kpis = [s.camAut ? { v: D.fr(s.camAut), l: "caméras autorisées à la mairie" } : { v: D.fr(d.cs.length), l: d.cs.length > 1 ? "contrats signés" : "contrat signé" },
        { v: n == null ? "—" : D.fr(n), l: "caméras sur la carte" },
        d.counted.length ? { v: eur(total), l: `au maximum depuis ${d.y0}` } : { v: "—", l: "aucun contrat compté" },
        { v: D.fr(s.all.length), l: "documents officiels" }];
      DET.sum = { kicker: `${nom} · en bref`, title: "L'essentiel", rows: [s.camAut ? ["Caméras autorisées (mairie)", D.fr(s.camAut)] : null, s.vpAut != null ? ["dont sur la rue", D.fr(s.vpAut)] : null,
        ["Sur la carte", n == null ? "—" : D.fr(n)], [d.counted.length ? `Au maximum depuis ${d.y0}` : "Contrats comptés", d.counted.length ? eur(total) : "aucun"], ["Documents", D.fr(s.all.length)]].filter(Boolean),
        link: "Tous les documents →", href: `#/commune/${insee}/documents` };
      // --- the map's legend: an absent layer says « aucune à <commune> »
      // a layer is present when an act names this commune (a neighbour's zone that crosses the boundary is not)
      const acts = (window.AUTORISATIONS || []).filter(a => a.insee.includes(insee));
      const hasDr = s.all.some(e => e.t === "arrete_drone") || acts.some(a => a.kind === "drone");
      const hasVsa = s.all.some(e => e.t === "arrete_vsa") || acts.some(a => a.kind === "vsa");
      const ls = "display: flex; align-items: center; gap: 8px", lsm = ls + "; color: var(--muted)";
      // 12th pass: an act that names the commune among others says so
      const drOwn = s.all.filter(e => e.t === "arrete_drone" && !e.insee0), drSh = s.all.filter(e => e.t === "arrete_drone" && e.insee0);
      const leg = { dr: drOwn.length ? "zone de drones autorisée" : drSh.length ? `${D.plur(drSh.length, "arrêté")} de drones (zones partagées avec d'autres communes)` : hasDr ? "zone de drones autorisée" : `zone de drones autorisée · aucune à ${nom}`, drStyle: hasDr ? ls : lsm,
        vsa: hasVsa ? "analyse algorithmique" : `analyse algorithmique · aucune à ${nom}`, vsaStyle: hasVsa ? ls : lsm };
      const vueTitre = n == null ? `La carte de ${nom}` : n ? `Ce que filment les ${D.fr(n)} caméras placées` : "Aucune caméra n'est encore placée sur la carte";
      const carteAlt = `Carte inclinée de ${nom}, découpée sur la commune, qui tourne lentement : ${n ? `les ${D.fr(n)} caméras placées sur la carte, leurs champs de vision et les rues qu'elles filment` : "aucune caméra placée"}.${hasDr ? " Les zones de drones autorisées." : ` Pas de zone de drones${hasVsa ? "" : " ni d'analyse algorithmique"} à ${nom}.`} Pour explorer, ouvrir l'onglet Carte et drones.`;
      // --- « Où sont les N autres ? » (10th pass: compared with the public cameras of the map only)
      const ou = { show: !!(s.complet && s.vpAut != null && pub != null && pub < s.vpAut) };
      if (ou.show) Object.assign(ou, { k: D.fr(s.vpAut - pub), vp: D.fr(s.vpAut), pub: D.fr(pub),
        note: `${D.fr(s.vpAut)} caméras de la mairie autorisées sur la rue, moins les ${D.fr(pub)} caméras publiques que la carte connaît : ${D.fr(s.vpAut - pub)}. La carte compte ${D.fr(n)} caméras en tout à ${nom}, dont des caméras privées ; seules les publiques se comparent à l'autorisation de la mairie.` });
      // --- what the préfecture authorises: the last act of the mairie's main dossier
      const aut = { show: s.com.length > 0 };
      if (aut.show) {
        const last = s.com[0], a = affaire(last.affaire), src = a?.echeance_source ? EV[a.echeance_source] : null;
        aut.items = [last.videoverbalisation ? { a: "Verbaliser grâce aux caméras", b: "des amendes peuvent être dressées à partir des images." } : { a: "Verbalisation par caméra", b: "non mentionnée dans l'arrêté." },
          last.deport_forces ? { a: "Transmettre les images", b: "à la police ou à la gendarmerie." } : { a: "Transmission des images à la police ou à la gendarmerie", b: "non mentionnée dans l'arrêté." },
          a?.echeance ? { a: `Jusqu'au ${longDate(a.echeance)}`, b: `durée inscrite dans l'arrêté${src && src.id !== a.events[a.events.length - 1] ? ` du ${fmtD(src.date)}` : ""}.` } : { a: "Date de fin", b: "non précisée dans l'arrêté." }];
        const acts = d.mainActs.slice(-4), k = acts.length;
        const mo = k > 1 ? ym(acts[k - 1].date) - ym(acts[0].date) : 0;
        aut.h3 = k > 1 ? `${D.Maj(D.lettres(k))} arrêtés en ${D.lettres(mo)} mois` : "Un arrêté publié";
        aut.n = Math.max(1, k);
        aut.arr = acts.map((e, i) => { const key = "a" + e.id; DET[key] = { kicker: "Arrêté · " + D.fd(e.date), title: D.plur(e.cameras, "caméra") + " autorisée" + (e.cameras > 1 ? "s" : ""),
          rows: [["Sur la voie publique", e.cameras_vp ?? "non précisé"], ["Intérieur", e.cameras_int ?? "—"], ["Extérieur", e.cameras_ext ?? "—"], ["Durée", e.duree || "non précisée"], ["Référence", "acte " + e.id]].map(([k1, v]) => [k1, String(v)]),
          link: "Historique de l'autorisation →", href: `#/commune/${insee}/autorisations/${encodeURIComponent(e.affaire)}` };
          return { n: D.fr(e.cameras), d: D.fd(e.date), hover: sel(key), cls: "hv" + (on(key) ? " on" : ""), style: "padding: 12px 14px; " + (i ? "border-left: 1px solid var(--rule); " : "") + (on(key) ? "box-shadow: inset 0 -5px 0 var(--hover)" : "") }; });
        const pts = (d.main?.cameras || []).filter(p => p.n != null && !p.groupe).map(p => D.fr(p.n)), seq = pts.length > 5 ? [pts[0], "…", pts[pts.length - 1]] : pts;
        aut.hist = pts.length > 1 ? `Historique de l'autorisation : ${seq.join(" → ")} caméras →` : "Historique de l'autorisation →";
      } else aut.arr = [];
      // --- also here: the shops and companies (their last act per dossier)
      const prv = { show: s.prv.length > 0, hover: sel("prv"), cls: "hv" + (on("prv") ? " on" : "") };
      if (prv.show) {
        const ncam = s.prv.reduce((t, e) => t + (e.cameras || 0), 0), K = { banque: "banque", commerce: "commerce", pharmacie: "pharmacie", entreprise: "entreprise" };
        const kinds = [...new Set(s.prv.map(e => /pharmacie/i.test(e.beneficiaire || "") ? "pharmacie" : K[e.type_beneficiaire] || ""))].filter(Boolean).sort((a, b) => (a === "commerce" || a === "entreprise") - (b === "commerce" || b === "entreprise"));
        Object.assign(prv, { cam: D.plur(ncam, "caméra"), arr: D.plur(s.prv.length, "arrêté"), kinds: kinds.length ? ` (${kinds.slice(0, 2).join(", ")}${kinds.length > 2 ? "…" : ""})` : "" });
        prv.priv = s.prv.slice().sort(byDateAsc).slice(-6).map(e => ({ d: D.fd(e.date), who: e.beneficiaire === "[non retenu]" ? "nom non publié" : D.benef(e) || benefLabel(e), n: D.fr(e.cameras || 0) }));
        const byK = {}; s.prv.forEach(e => { const k1 = e.beneficiaire === "[non retenu]" ? "nom non publié" : D.benef(e) || benefLabel(e); (byK[k1] ||= { n: 0, a: 0 }).n += e.cameras || 0; byK[k1].a++; });
        DET.prv = { kicker: `Autres bénéficiaires · ${[...new Set(s.prv.map(e => e.date.slice(0, 4)))].join(", ")}`, title: `${D.plur(ncam, "caméra")}, ${D.plur(s.prv.length, "arrêté")}`,
          rows: Object.entries(byK).sort((a, b) => b[1].n - a[1].n).slice(0, 5).map(([k1, x]) => [x.a > 1 ? `${k1} (${x.a} arrêtés)` : k1, D.plur(x.n, "caméra")]), link: "Les voir dans les documents →", href: `#/commune/${insee}/documents?qui=p,n&t=aut` };
      } else prv.priv = [];
      // --- the money
      const ents = [...new Set(d.counted.flatMap(e => e.entreprises || []))];
      const arg = { total: d.counted.length ? eur(total) : "—", friseTitre: d.cs.length >= 6 ? "Les entreprises et appels d'offres, dans le temps" : "Les contrats et appels d'offres, dans le temps" };
      arg.phrase = d.counted.length ? `au maximum depuis ${d.y0}${c.pop ? `, soit <strong>${D.fr(Math.round(total / c.pop))} € par habitant</strong>` : ""}${ents.length === 1 ? `, versés à <strong>une seule entreprise</strong> : ${entA(ents[0])}` : ents.length ? `, versés à <strong>${ents.length} entreprises</strong> : ${ents.slice(0, 4).map(entA).join(", ")}${ents.length > 4 ? ` et ${ents.length - 4} autres` : ""}` : ""}`
        : d.cs.length ? `aucun contrat compté dans le total (${h([...new Set(d.cs.map(horsRaison))].join(", "))})` : "aucun contrat de vidéosurveillance trouvé dans les données de la commande publique.";
      arg.couv = !COUV.region.has(c.dep) && COUV.etat.has(c.dep) ? ` Aides de la Région ${c.dep === "69" ? "Auvergne-Rhône-Alpes " : ""}pas encore collectées.` : COUV.region.has(c.dep) && !COUV.etat.has(c.dep) ? " Aides de l'État (DETR) pas encore collectées." : "";
      // the frieze: from (first year − 1) to today, « auj. » at the right edge; an arrow when a contract runs on
      const first = d.cs[0]?.dl || d.aos[0]?.debut || TODAY11;
      const M0 = (+first.slice(0, 4) - 1) * 12, NOW = ym(TODAY11) + (+TODAY11.slice(8, 10)) / 31;
      const X = dd => Math.max(0, Math.min(100, (ym(dd) + ((+dd.slice(8, 10) || 1) - 1) / 31 - M0) / (NOW - M0) * 100));
      const bar = (a, b, k) => ({ style: "position: absolute; top: 0; bottom: 0; left: " + a.toFixed(2) + "%; width: " + Math.max(0.6, b - a).toFixed(2) + "%; background: " + (on(k) ? "var(--hover)" : "var(--fg)") });
      const arrowStyle = k => "position: absolute; top: -3px; right: -16px; width: 0; height: 0; border-top: 15px solid transparent; border-bottom: 15px solid transparent; border-left: 16px solid " + (on(k) ? "var(--hover)" : "var(--fg)");
      const endOf = e => e.duree ? D.addM(e.dl, e.duree) : null;
      const cDet = (e, k) => { const end = endOf(e); DET[k] = { kicker: "Contrat · " + (e.note_relecture ? D.fm(e.dl) + " (date à vérifier)" : D.fd(e.dl)), title: e.entreprises?.length ? e.entreprises.map(x => tidy(entName(x))).join(", ") : "entreprise non publiée",
        rows: [["Objet", D.court(e.affaire) || calm(e.objet || "").toLowerCase()], ["Montant maximum", eur(e.montant || 0)], ["Durée publiée", e.duree ? `${e.duree} mois` : "non publiée"], ["Fin calculée", end ? D.fm(end) : "—"], ["Offres reçues", e.offres != null ? String(e.offres) : "non publié"]]
          .concat((() => { const mods = R.evenements.filter(x => x.affaire === e.affaire && x.t === "modification"); return mods.length ? [["Modifié", D.fd(mods[mods.length - 1].date) + (mods.every(m => m.montant === e.montant) ? ", montant inchangé" : "")]] : []; })()),
        link: "Historique du contrat →", href: `#/contrat/${encodeURIComponent(e.affaire)}` }; };
      let rows;
      if (d.cs.length < 6) rows = d.cs.map((e, i) => { const k = "c" + i, end = endOf(e); cDet(e, k);
        return { l1: h(`Contrat ${i + 1} · ${eur(e.montant || 0)}`) + (e.lots ? h(` · ${e.lots.length} lots`) : e.copies ? h(` · publié ${e.copies} fois`) : ""), l2: `${D.fm(e.dl)} → ${end ? D.fm(end) : "fin à lire"}`,
          bars: [bar(X(e.dl), end ? X(end) : 100, k)], arrow: !end || end > TODAY11, arrowStyle: arrowStyle(k), tris: [], cls: "hv" + (on(k) ? " on" : ""), hover: sel(k) }; });
      else {
        const by = {}; d.cs.forEach((e, i) => { const k0 = e.entreprises?.[0] || "?"; (by[k0] ||= []).push([e, i]); });
        rows = Object.entries(by).sort((a, b) => a[1][0][0].dl.localeCompare(b[1][0][0].dl)).map(([k0, es]) => { const k = "e" + k0, sum = es.reduce((t, [e]) => t + (!e.hors_totaux && !e.national ? e.montant || 0 : 0), 0);
          es.forEach(([e, i]) => cDet(e, "c" + i));
          DET[k] = { kicker: "Entreprise · " + D.plur(es.length, "contrat"), title: k0 === "?" ? "entreprise non publiée" : tidy(entName(k0)), rows: es.slice(-5).map(([e]) => [D.fd(e.dl), eur(e.montant || 0)]), link: k0 === "?" ? "" : "Page de l'entreprise →", href: `#/entreprise/${k0}` };
          const ends = es.map(([e]) => endOf(e));
          return { l1: (k0 === "?" ? "entreprise non publiée" : entA(k0)) + h(` · ${D.plur(es.length, "contrat")}`), l2: `${[...new Set(es.map(([e]) => e.dl.slice(0, 4)))].join(", ")} · ${eur(sum)}`,
            bars: es.map(([e, i]) => bar(X(e.dl), endOf(e) ? X(endOf(e)) : 100, k)), arrow: ends.some(x => !x || x > TODAY11), arrowStyle: arrowStyle(k), tris: [], cls: "hv" + (on(k) ? " on" : ""), hover: sel(k) }; });
      }
      const aoTri = d.aos.filter(a => ym(a.debut) >= M0).map(a => { const k = "o" + a.id, e0 = EV[a.events[0]], pend = !a.contrat_probable;
        DET[k] = { kicker: "Appel d'offres · " + D.fd(a.debut), title: D.titreAff(a.id, e0), rows: [["Référence", e0.ref]].concat(a.events.filter(i => EV[i].t === "resultat").map(i => ["Résultat publié", `${D.fd(EV[i].date)} (${EV[i].ref})`]))
          .concat([["Contrat qui a suivi", a.contrat_probable ? `contrat de ${D.dateLue(EV[R.affaires[a.contrat_probable]?.events?.[0]] || {}).slice?.(0, 4) || "?"} (lien probable)` : (ym(a.debut) > ym(TODAY11) - 18 ? "pas encore publié" : "non retrouvé")]]),
          link: "Historique de l'appel d'offres →", href: `#/contrat/${encodeURIComponent(a.id)}` };
        return { hover: sel(k), style: "position: absolute; top: 4px; left: calc(" + X(a.debut).toFixed(2) + "% - 9px); width: 0; height: 0; border-left: 9px solid transparent; border-right: 9px solid transparent; border-bottom: 16px solid " + (on(k) ? "var(--hover)" : "var(--ao)") + "; cursor: pointer", id: k, a }; });
      // contracts' own notices, as triangles too (the mockup shows the 2024 notice of the 2025 contract)
      d.cs.forEach(e => (R.affaires[e.affaire]?.events || []).map(i => EV[i]).filter(x => x.t === "avis" && ym(x.date) >= M0).forEach(x => { const k = "o" + x.id;
        DET[k] = { kicker: "Appel d'offres · " + D.fd(x.date), title: D.titreAff(e.affaire, x), rows: [["Référence", x.ref], ["Contrat qui a suivi", "contrat du " + D.fd(e.dl)]], link: "Historique du contrat →", href: `#/contrat/${encodeURIComponent(e.affaire)}` };
        aoTri.push({ hover: sel(k), style: "position: absolute; top: 4px; left: calc(" + X(x.date).toFixed(2) + "% - 9px); width: 0; height: 0; border-left: 9px solid transparent; border-right: 9px solid transparent; border-bottom: 16px solid " + (on(k) ? "var(--hover)" : "var(--ao)") + "; cursor: pointer", id: k, a: { debut: x.date } }); }));
      aoTri.sort((a, b) => a.a.debut.localeCompare(b.a.debut));
      if (aoTri.length) { const last = aoTri[aoTri.length - 1];
        rows.push({ l1: h("Appels d'offres"), l2: [...new Set(aoTri.map(t => t.a.debut.slice(0, 4)))].map((y, i, all) => i === all.length - 1 && aoTri[aoTri.length - 1].a.debut.slice(0, 4) === y && ym(last.a.debut) > ym(TODAY11) - 6 ? D.MOISL[+last.a.debut.slice(5, 7) - 1] + " " + y : y).join(" · "),
          bars: [], arrow: false, tris: aoTri, cls: "", hover: sel(last.id) }); }
      const yrs = []; for (let y = M0 / 12; y <= +TODAY11.slice(0, 4); y++) yrs.push(y);
      const stepY = yrs.length > 9 ? 2 : 1;
      const ticks = yrs.filter((y, i) => i % stepY === 0 && X(`${y}-01-01`) < 94).map((y, i) => ({ l: String(y), cls: i % 2 || X(`${y}-01-01`) > 80 ? "tk-o" : "", style: "position: absolute; top: 2px; left: " + X(`${y}-01-01`).toFixed(2) + "%; transform: translateX(" + (y === M0 / 12 ? "0" : "-50%") + ")" }))
        .concat([{ l: "auj.", style: "position: absolute; top: 2px; right: 0; color: var(--fg); font-weight: 700" }]);
      const friseAlt = d.cs.map((e, i) => { const end = endOf(e); return `Contrat ${i + 1} avec ${e.entreprises?.length ? e.entreprises.map(x => tidy(entName(x))).join(", ") : "une entreprise non publiée"} : ${eur(e.montant || 0).replace("€", "euros")} au maximum, de ${D.fmL(e.dl)} à ${end ? D.fmL(end) : "une date à lire"}${end && end > TODAY11 ? ", encore en cours aujourd'hui" : ""}.`; }).join(" ")
        + (aoTri.length ? ` Appels d'offres en ${aoTri.map(t => D.fmL(t.a.debut)).join(", ")}.` : "");
      // what to keep in mind (v10 « retenir », the mockup's words)
      let retenir = "";
      if (d.cs.length) {
        const all = [...new Set(d.cs.flatMap(e => e.entreprises || []))];
        if (all.length === 1 && d.cs.length > 1) {
          const gaps = []; for (let i = 1; i < d.cs.length; i++) { const end = endOf(d.cs[i - 1]); if (end && ym(d.cs[i].dl) - ym(end) > 3) gaps.push([end, d.cs[i].dl]); }
          retenir = gaps.length ? `La même entreprise depuis ${d.y0}, avec ${gaps.length > 1 ? `${gaps.length} trous` : "un trou"} de ${ym(gaps[0][1]) - ym(gaps[0][0])} mois entre ${D.fmL(gaps[0][0])} et ${D.fmL(gaps[0][1])}.`
            : `Pas de trou entre les ${D.lettres(d.cs.length)} contrats : la même entreprise entretient les caméras depuis ${d.y0}.`;
        } else if (all.length === 1) retenir = `Un seul contrat trouvé, avec ${entA(all[0])}.`;
        else if (all.length > 1) retenir = `${all.length} entreprises différentes depuis ${d.y0} ; la plus récente : ${entA(d.cs[d.cs.length - 1].entreprises?.[0] || all[0])}.`;
      }
      const offre = d.cs.filter(e => e.offres != null).pop();
      const subRow = s.subs.length ? eur(s.subs.reduce((t, e) => t + (e.montant || 0), 0)) : COUV.region.has(c.dep) || COUV.etat.has(c.dep) ? "aucune" : "pas encore collectées";
      arg.dl = [{ k: `Entreprises différentes depuis ${d.y0 || "—"}`, v: String(new Set(d.cs.flatMap(e => e.entreprises || [])).size) }].concat(offre ? [{ k: `Offres reçues pour le contrat de ${offre.dl.slice(0, 4)}`, v: String(offre.offres) }] : [], [{ k: "Subventions trouvées", v: subRow }]);
      if (!d.cs.length) arg.dl = [{ k: "Subventions trouvées", v: subRow }];
      arg.retenir = retenir;
      // --- what happened (the mockup's chronology; a big city keeps the notable facts of each year)
      const chrono = this.chrono(d, DET, sel, on);
      // --- the intercommunality and the département
      const ter = this.territoires(d, DET, sel, on);
      // --- to watch, and documents to ask for
      const veille = [];
      s.aosPending.forEach(a => veille.push({ k: "0", w: "bientôt", t: `<strong>Avec qui ${h(nom)} va-t-elle signer ?</strong> L'appel d'offres de ${D.fmL(a.debut)} n'a pas encore de contrat publié.` }));
      d.cs.forEach(e => { const end = endOf(e); if (end && end >= TODAY11) veille.push({ k: end, w: D.fm(end), t: `Fin prévue du <a href="#/contrat/${encodeURIComponent(e.affaire)}">contrat de ${e.dl.slice(0, 4)}</a> avec ${e.entreprises?.length ? entA(e.entreprises[0]) : "une entreprise non publiée"} (${e.duree} mois).` }); });
      s.com.forEach(e => { const a = affaire(e.affaire); if (a?.echeance && a.echeance >= TODAY11) veille.push({ k: a.echeance, w: fmtD(a.echeance), t: "Fin de l'autorisation de la préfecture : un renouvellement devra être publié." }); });
      veille.sort((a, b) => a.k.localeCompare(b.k));
      const introuvables = missingItems(insee, s.all).slice(0, 2).map(([q, quiq]) => ({ q, l: quiq === "mairie" ? "Demander à la mairie" : "Demander à la préfecture", href: quiq === "mairie" ? `#/commune/${insee}/documents` : `#/commune/${insee}/autorisations` }));
      const d0 = DET[S.sel] || DET.sum;
      const det = { kicker: d0.kicker, title: d0.title, rows: d0.rows.map(([k, v]) => ({ k, v })), links: d0.link ? [{ l: d0.link, href: d0.href }] : [], hint: "Survolez un contrat, un arrêté, une date ou une ligne : le détail s'affiche ici." };
      return Object.assign(this.base("commune"), this.info("arg", "met", "ou"), D.filCommune(insee), {
        com: Object.assign(d.com, { insee }), lead, kpis, vueTitre, carteAlt, leg, ou, aut, arr: aut.arr, prv, priv: prv.priv, arg, rows, ticks, friseAlt, chrono, ter, veille, introuvables, det,
        nDocs: D.fr(s.all.length), lien: { carte: `#/commune/${insee}/carte`, autorisations: `#/commune/${insee}/autorisations`, dossier: d.main ? `#/commune/${insee}/autorisations/${encodeURIComponent(d.main.id)}` : `#/commune/${insee}/autorisations`, prives: `#/commune/${insee}/documents?qui=p,n&t=aut`, documents: `#/commune/${insee}/documents` },
        playing: S.playing, paused: !S.playing, pressed: S.playing ? "false" : "true", toggleLabel: S.playing ? "Arrêter la rotation" : "Reprendre la rotation",
        toggle: () => { const m = this.map; if (!m) return; m.playing() ? m.stop(true) : m.play(); this.setState({ playing: m.playing() }); },
      });
    }
    chrono(d, DET, sel, on) {
      const { s, insee, nom } = d, it = [];
      const mine = s.mine.filter(e => !/^arrete_(drone|vsa)$/.test(e.t));
      if (mine.length > 30) {
        // a big city: the notable facts of each year (9th pass rule)
        const seen = new Set(), ys = [...new Set(mine.map(year))].filter(Boolean).sort();
        const firstDrone = s.all.filter(e => e.t === "arrete_drone").sort(byDateAsc)[0];
        ys.forEach(y => {
          const rs = mine.filter(e => year(e) === y), cs = rs.filter(e => e.t === "attribution" && !isCopy(e)), facts = [];
          const neu = [...new Set(cs.flatMap(e => e.entreprises || []))].filter(x => !seen.has(x));
          cs.forEach(e => (e.entreprises || []).forEach(x => seen.add(x)));
          if (neu.length && y > ys[0]) facts.push(`nouvelle entreprise : ${neu.slice(0, 3).map(entA).join(", ")}${neu.length > 3 ? ` et ${neu.length - 3} autres` : ""}`);
          const top = cs.filter(e => !e.hors_totaux && !e.national).sort((a, b) => (b.montant || 0) - (a.montant || 0))[0];
          if (top) facts.push(`plus gros contrat : ${eur(top.montant || 0)} avec ${top.entreprises?.length ? entA(top.entreprises[0]) : "une entreprise non publiée"}`);
          if (firstDrone && year(firstDrone) === y) facts.push(`premier arrêté de drones (${jourMois(firstDrone.date)})`);
          const na = rs.filter(e => e.t === "arrete").length;
          if (facts.length) { const k = "y" + y; DET[k] = { kicker: "Année", title: y, rows: [["Contrats signés", String(cs.length)], ["Autorisations de caméras", String(na)], ["Documents", String(rs.length)]], link: "Les documents →", href: `#/commune/${insee}/documents?y=${y}` };
            it.push({ k: y, d: y, mark: MK.an, t: facts.map(D.Maj).join(". ") + ".", flag: false, key: k }); }
        });
      } else {
        const dossiers = Object.values(R.affaires).filter(a => a.insee === insee && a.kind === "dossier" && isCommunal(EV[a.events[a.events.length - 1]]));
        dossiers.forEach(a => {
          if (a.origine_annee && a.origine_annee < +a.debut.slice(0, 4)) { const k = "h" + a.id;
            DET[k] = { kicker: String(a.origine_annee), title: "Ouverture du dossier d'autorisation", rows: [["Dossier préfectoral", "n° " + a.id.split("-")[1]], [`Arrêtés ${a.origine_annee}-${+a.debut.slice(0, 4) - 1}`, "non publiés en ligne"]], link: "Demander à la préfecture →", href: `#/commune/${insee}/autorisations/${encodeURIComponent(a.id)}` };
            it.push({ k: `${a.origine_annee}-00`, d: String(a.origine_annee), mark: MK.dossier, t: `La mairie ouvre son dossier d'autorisation des caméras${dossiers.length > 1 ? ` (n° ${dossierNo(a.id)})` : ""}.`, key: k }); }
          const pts = (a.cameras || []).filter(p => p.n != null && !p.groupe), evs = a.events.map(i => EV[i]).filter(e => e.cameras != null);
          const kLast = evs.length ? "a" + evs[evs.length - 1].id : "";
          if (pts.length > 1) { const m = ym(pts[pts.length - 1].date) - ym(pts[0].date), dl = pts[pts.length - 1].n - pts[0].n;
            it.push({ k: pts[0].date, d: `${D.fm(pts[0].date)} → ${D.fm(pts[pts.length - 1].date).replace(/^(\S+)\.? /, (x, mo) => x)}`, mark: MK.aut, t: `La préfecture autorise ${pts.map(p => D.fr(p.n)).join(", puis ")} caméras : ${sign(dl)} en ${m} mois.`, key: kLast }); }
          else if (pts.length) it.push({ k: pts[0].date, d: D.fmL(pts[0].date), mark: MK.aut, t: `La préfecture autorise ${D.plur(pts[0].n, "caméra")}.`, key: kLast });
        });
        d.cs.forEach((e, i) => {
          const mods = R.evenements.filter(x => x.affaire === e.affaire && x.t === "modification");
          const who = e.entreprises?.length ? entA(e.entreprises[0]) : "une entreprise non publiée";
          const what = D.court(e.affaire) || calm(e.objet || "").toLowerCase();
          it.push({ k: e.dl, d: e.note_relecture ? e.dl.slice(0, 4) : D.fmL(e.dl).replace(/^./, x => x.toUpperCase()), mark: MK.contrat, flag: !!e.note_relecture, key: "c" + i,
            t: i ? `Nouveau contrat avec ${who}${mods.length ? `, modifié ${mods.length > 1 ? `${mods.length} fois` : `en ${D.MOISL[+mods[0].date.slice(5, 7) - 1]}`}` : ""}.` : `Premier contrat trouvé avec ${who} : ${h(what)}.` });
        });
        d.aos.forEach(a => { const e0 = EV[a.events[0]], c0 = D.court(a.id), pend = !a.contrat_probable && ym(a.debut) > ym(TODAY11) - 18;
          const what = c0 ? (c0.startsWith("pour ") ? " " + c0 : " : " + c0) : " : " + calm(e0.objet || "").toLowerCase();
          it.push({ k: a.debut, d: D.fmL(a.debut), mark: MK.ao, t: h(`${pend ? "Nouvel appel d'offres" : "Appel d'offres"}${what}.`), key: "o" + a.id }); });
        s.subs.forEach(e => it.push({ k: e.date, d: e.date_annee ? e.date.slice(0, 4) : D.fmL(e.date), mark: MK.sub, t: h(`${e.t === "subvention_region" ? "La Région" : "L'État"} accorde une subvention de ${eur(e.montant || 0)}${e.cameras ? ` pour ${D.plur(e.cameras, "caméra")}` : ""}.`) }));
        const dr = s.all.filter(e => e.t === "arrete_drone").sort(byDateAsc);
        if (dr.length) it.push({ k: dr[0].date, d: dr.length > 1 ? `${D.fm(dr[0].date)} → ${D.fm(dr[dr.length - 1].date)}` : D.fmL(dr[0].date), mark: MK.aut, t: h(`La préfecture autorise des drones à ${nom} ${dr.length > 1 ? `${dr.length} fois` : "une fois"}.`) });
      }
      if (!it.length) return [];
      const k0 = it.map(x => x.k).sort()[0];
      R.mandats.filter(m => m.second_tour >= k0 && m.second_tour <= TODAY11).forEach(m => { const k = "el" + m.mandat;
        DET[k] = { kicker: D.Maj(D.fmL(m.premier_tour)), title: "Élections municipales", rows: [["Mandat", m.mandat], ["Élus", "source officielle (répertoire national des élus)"]], link: "Les élus (source officielle) →", href: ELUS };
        it.push({ k: mine.length > 30 ? m.second_tour.slice(0, 4) + "~" : m.second_tour, d: D.fmL(m.premier_tour), mark: MK.vote, t: "Élections municipales.", key: k }); });
      it.sort((a, b) => a.k.localeCompare(b.k));
      return it.map(x => ({ d: x.d, t: x.t, flag: !!x.flag, mark: x.mark, hover: x.key ? sel(x.key) : () => {}, cls: "hv" + (x.key && on(x.key) ? " on" : "") }));
    }
    territoires(d, DET, sel, on) {
      const { c, insee, nom } = d, epci = c.epci, dep = c.dep, en = epci ? D.epciNom(epci) : "";
      const all = D.epciCommunes(epci), reg = all.filter(k => D.byInsee[k]?.length);
      const sum = ks => D.uniq(ks);   // a document shared by several communes counts once in a territory
      const me = D.communeStats(insee), ep = sum(reg), depKs = D.communesDep(dep).map(x => x.insee), dp = sum(depKs), col = D.ARRETES_COLLECTES.has(dep);
      const rank = reg.map(D.communeStats).sort((a, b) => b.docs - a.docs).findIndex(x => x.insee === insee) + 1;
      const v = (x, k) => k === "cam" || k === "dr" ? (col ? D.fr(x[k]) : "—") : D.fr(x[k]);
      const epA = /^(métropole|communauté|ca |cc |cu |eurométropole|établissement)/i.test(en) || /^(CA|CC|CU)\b/.test(en) ? "la " : "";
      DET.m0 = { kicker: "Commune", title: nom, rows: [["Documents", v(me, "docs")], ["Contrats", v(me, "con")], ["Autorisations de caméras", v(me, "cam")], ["Arrêtés de drones", v(me, "dr")]].concat(rank ? [[`Rang dans ${epA ? "la " + en.replace(/^la /, "") : en}`, `${rank}e sur ${reg.length} (documents)`]] : []), link: `Les ${D.fr(me.docs)} documents →`, href: `#/commune/${insee}/documents` };
      DET.m1 = { kicker: "Intercommunalité", title: en, rows: [["Communes", `${all.length}, dont ${reg.length} dans le registre`], ["Documents", v(ep, "docs")], ["Contrats", v(ep, "con")], ["Autorisations de caméras", v(ep, "cam")], ["Arrêtés de drones", v(ep, "dr")]], link: `Les communes de ${epA}${en} →`, href: `#/departement/${dep}?ic=${epci}` };
      DET.m2 = { kicker: "Département", title: DEPS[dep] || dep, rows: [["Communes dans le registre", D.fr(depKs.length)], ["Documents", v(dp, "docs")], ["Contrats", v(dp, "con")], ["Autorisations de caméras", v(dp, "cam")], ["Arrêtés de drones", v(dp, "dr")]], link: `${D.Maj(D.depArt(dep))} →`, href: `#/departement/${dep}` };
      const row = (k, nomR, sub, x, href) => ({ nom: nomR, sub, n: v(x, "docs"), con: v(x, "con"), aut: v(x, "cam"), dr: v(x, "dr"), href, hover: sel(k), cls: "r" + (on(k) ? " on" : "") });
      const terr = [row("m0", nom, `commune · ${D.fr(c.pop)} habitants`, me, `#/commune/${insee}`)].concat(epci ? [row("m1", en, `${reg.length} communes dans le registre, sur ${all.length}`, ep, `#/departement/${dep}?ic=${epci}`)] : [],
        [row("m2", DEPS[dep] || dep, `${D.fr(depKs.length)} communes dans le registre`, dp, `#/departement/${dep}`)]);
      const own = D.buyStats[epci];
      const ownAmt = own ? own.montant : 0;
      return { titre: epci ? `Dans ${epA}${en} et ${D.depArt(dep)}` : `Dans ${D.depArt(dep)}`, de: epA, epci: en, nCom: D.fr(all.length), nReg: D.fr(reg.length), terr,
        caption: `${nom} comparée à ${epA}${en} et ${D.depArt(dep).replace(/^le /, "au ").replace(/^les /, "aux ")}`,
        couv: col ? ` Les arrêtés de la préfecture ne sont collectés que depuis ${D.fmL(D.premierArrete[dep])}.` : " Les arrêtés de la préfecture ne sont pas encore collectés pour ce département.",
        achat: own && own.n ? `${D.plur(own.n, "contrat")}${ownAmt ? `, ${eur(ownAmt)} au maximum` : ""}` : "", achatQui: D.Maj(epA + en.split(" ")[0]), achatHref: D.buyerHref(epci),
        hrefEpci: `#/departement/${dep}?ic=${epci}`, lienEpci: `Les communes de ${epA}${en.split(" ")[0] === "Métropole" ? "Métropole" : en} →`, hrefDep: `#/departement/${dep}`, lienDep: `${D.Maj(D.depArt(dep))} →` };
    }
  }
  V11.register("commune", Commune);
})();
