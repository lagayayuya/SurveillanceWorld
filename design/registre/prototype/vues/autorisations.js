// View 5 · Commune · Autorisations (maquette Autorisations-grand.dc.html, new): the commune's prefectoral acts,
// grouped by dossier; the mairie's main dossier first, then the shops and companies, then the other devices.
(() => {
  "use strict";
  const D = D11;
  const dash = v => v == null ? "—" : D.fr(v);
  const CAT = { commerce: "Commerce", banque: "Banque", pharmacie: "Pharmacie", entreprise: "Entreprise", etablissement: "Établissement", association: "Association", sante: "Santé", bailleur: "Bailleur social", transport: "Transport", culte: "Lieu de culte", etat: "État" };
  const ym = d => +d.slice(0, 4) * 12 + (+d.slice(5, 7) - 1);
  // what an act changes from the previous one of its dossier, in words
  function change(a, p, dossier) {
    if (!p) return "Premier arrêté publié en ligne pour ce dossier.";
    const parts = [], diff = (k, lab) => { if (a[k] != null && p[k] != null && a[k] !== p[k]) { const d = a[k] - p[k]; parts.push(`${Math.abs(d)} de ${d > 0 ? "plus" : "moins"} ${lab}`); } };
    diff("cameras_vp", "sur la rue"); diff("cameras_int", "dans les bâtiments"); diff("cameras_ext", "aux abords");
    let s = parts.length ? parts.join(", ").replace(/^./, x => x.toUpperCase()) + "." : (a.cameras !== p.cameras ? `${D.fr(Math.abs(a.cameras - p.cameras))} caméras de ${a.cameras > p.cameras ? "plus" : "moins"}.` : "Même nombre de caméras.");
    if (dossier?.echeance_source === a.id && dossier.echeance) s += ` Fixe la fin au ${longDate(dossier.echeance)}.`;
    return s;
  }
  class Autorisations extends Vue {
    init() { return { allPriv: false }; }
    titre() { return "Autorisations · " + (R.communes[this.props.insee]?.nom || ""); }
    data() {
      if (this._d) return this._d;
      const insee = this.props.insee, L = (D.byInsee[insee] || []).filter(D.isArr).sort(byDateAsc);
      const cam = L.filter(e => e.t === "arrete");
      const byDos = {}; cam.forEach(e => (byDos[e.affaire] ||= []).push(e));
      const dossiers = Object.entries(byDos).map(([id, es]) => { const last = es[es.length - 1]; return { id, es, last, com: isCommunal(last), a: R.affaires[id] }; });
      const mairie = dossiers.filter(x => x.com).sort((a, b) => (b.last.cameras || 0) - (a.last.cameras || 0));
      const prives = dossiers.filter(x => !x.com).sort((a, b) => a.last.date.localeCompare(b.last.date));
      const autres = L.filter(e => e.t !== "arrete");
      const zid = Object.fromEntries((window.ZONES || []).map(z => [z.id, z]));
      const ids = new Set(L.map(e => e.id));
      const multi = (window.AUTORISATIONS || []).filter(a => a.insee.includes(insee) && !ids.has(a.acte) && a.acte.startsWith(R.communes[insee]?.dep + "-"));
      return this._d = { insee, L, mairie, prives, autres, multi };
    }
    componentDidMount() {
      const d = this.data(), id = this.props.dossier;
      if (!id) return;
      const i = d.prives.findIndex(x => x.id === id), j = d.mairie.findIndex(x => x.id === id);
      requestAnimationFrame(() => {
        if (j === 0) document.getElementById("mairie")?.scrollIntoView({ block: "start" });
        else if (j > 0) { this.setState({ sel: d.mairie[j].last.id }); document.getElementById("dos-" + id)?.scrollIntoView({ block: "center" }); }
        else if (i >= 0) { if (i >= 15) this.setState({ allPriv: true }); this.setState({ sel: d.prives[i].last.id }); requestAnimationFrame(() => document.querySelectorAll("#prives tbody tr")[i]?.scrollIntoView({ block: "center" })); }
      });
    }
    renderVals() {
      const S = this.state, d = this.data(), insee = d.insee, nom = R.communes[insee]?.nom || insee, dep = R.communes[insee]?.dep;
      const DET = {};
      const main = d.mairie[0];
      // the lead and the four figures
      const nM = d.mairie.reduce((t, x) => t + x.es.length, 0), nP = d.prives.reduce((t, x) => t + x.es.length, 0), nA = d.autres.length;
      const first = d.L[0];
      const parts = [nM ? `${D.fr(nM)} pour les caméras de la mairie` : "", nP ? `${D.fr(nP)} pour des commerces et des entreprises` : "", nA ? `${D.fr(nA)} pour des drones ou d'autres dispositifs` : ""].filter(Boolean);
      const lead = d.L.length ? `Depuis ${D.fmL(first.date)}, la préfecture a publié <strong>${D.plur(d.L.length, "arrêté")}</strong> pour ${esc(nom)} : ${parts.join(", ").replace(/, ([^,]*)$/, parts.length > 1 ? ", $1" : "$1")}.`
        : D.ARRETES_COLLECTES.has(dep) ? `Aucun arrêté de la préfecture publié pour ${esc(nom)} depuis ${D.fmL(D.premierArrete[dep])}.` : `Les arrêtés de la préfecture ne sont pas encore collectés pour ${esc(DEPS[dep] || dep)}.`;
      const camM = d.mairie.reduce((t, x) => t + (x.last.cameras || 0), 0), vpM = d.mairie.every(x => x.last.cameras_vp != null) ? d.mairie.reduce((t, x) => t + x.last.cameras_vp, 0) : null;
      const camP = d.prives.reduce((t, x) => t + (x.last.cameras || 0), 0);
      const fin = main?.a?.echeance;
      const kpis = [{ v: D.fr(camM), l: "caméras de la mairie" }, { v: vpM == null ? "—" : D.fr(vpM), l: "filment la rue" }, { v: D.fr(camP), l: "caméras de commerces et d'entreprises" }, { v: fin ? fin.slice(0, 4) : "—", l: "fin de l'autorisation de la mairie" }];
      // the mairie's main dossier: the frieze, the table, what it allows, before
      const mairie = { show: !!main };
      let marks = [], rows = [];
      if (main) {
        const es = main.es.filter(e => e.cameras != null), a = main.a, last = main.last;
        const t0 = Date.UTC(+es[0].date.slice(0, 4), +es[0].date.slice(5, 7) - 2, 1), t1 = Date.parse(TODAY + "T00:00:00Z");
        const X = dd => 24 + (Date.parse(dd + "T00:00:00Z") - t0) / (t1 - t0) * 62;
        let lastX = -99;   // the phone hides a date label closer than 13 % to the one before (they overlapped at 390 px)
        marks = es.map((e, i) => { const on = S.sel === e.id, delta = i ? sign(e.cameras - es[i - 1].cameras) : "premier publié";
          DET[e.id] = { kicker: "Arrêté · " + D.fd(e.date), title: `${D.fr(e.cameras)} caméras pour la mairie`, rows: [["Sur la rue", dash(e.cameras_vp)], ["Abords des bâtiments", dash(e.cameras_ext)], ["Dans les bâtiments", dash(e.cameras_int)], ["Écart", i ? sign(e.cameras - es[i - 1].cameras) : "—"], ["Durée", e.duree || "non précisée"]],
            foot: `${change(e, es[i - 1], a)} Acte ${e.id}${e.page ? ", p. " + e.page : ""} · ${e.relu ? "relu à la main" : "lu par programme, à relire"}`, links: e.url ? [{ l: "Lire l'arrêté (recueil de la préfecture) ↗", href: e.url }] : [] };
          return { n: D.fr(e.cameras), delta, d: D.fm(e.date), cls: "mk" + (on ? " on" : ""), pos: "left: " + X(e.date).toFixed(1) + "%; top: 79px", lpos: "position: absolute; left: " + X(e.date).toFixed(1) + "%; transform: translateX(-50%); white-space: nowrap", lcls: X(e.date) - lastX < 13 ? "tk-o" : (lastX = X(e.date), ""), aria: `Arrêté du ${D.fd(e.date)} : ${D.fr(e.cameras)} caméras`, hover: this.pick(e.id) }; });
        rows = es.map((e, i) => ({ date: D.fd(e.date), n: D.fr(e.cameras), vp: dash(e.cameras_vp), ext: dash(e.cameras_ext), int: dash(e.cameras_int), delta: i ? sign(e.cameras - es[i - 1].cameras) : "—", url: e.url, cls: "r" + (S.sel === e.id ? " on" : ""), hover: this.pick(e.id) }));
        const no = main.id.split("-")[1], orig = a?.origine_annee;
        Object.assign(mairie, { n: D.fr(es.length), sous: `Dossier préfectoral n° ${no}${orig ? ` · ouvert en ${orig}` : ""}`, avant: orig ? `${orig} → ${es[0].date.slice(0, 4)} : arrêtés non publiés en ligne` : `avant ${D.fm(es[0].date)} : arrêtés non publiés en ligne`,
          an0: orig ? String(orig) : "", jusquaL: fin ? "valable jusqu'au" : "fin", jusqua: fin ? longDate(fin) : "non précisée", arrete: `arrêté du ${longDate(last.date)}`,
          permet: [{ l: last.videoverbalisation ? "<strong>Verbaliser grâce aux caméras</strong> : des amendes à partir des images" : "<strong>Verbaliser grâce aux caméras</strong>", v: last.videoverbalisation ? "oui" : "non mentionné" },
            { l: last.deport_forces ? "<strong>Transmettre les images</strong> à la police ou à la gendarmerie" : "<strong>Transmettre les images</strong> à la police ou à la gendarmerie", v: last.deport_forces ? "oui" : "non mentionné" },
            { l: "<strong>Durée</strong>", v: last.duree || (a?.duree_dernier_arrete) || "non précisée" }],
          avantMois: D.fmL(es[0].date), avantQ: orig ? `Combien de caméras au départ, en ${orig}, et comment ce nombre a-t-il évolué ?` : "Combien de caméras avant cet arrêté, et depuis quand ?",
          demande: `les arrêtés préfectoraux d'autorisation du système de vidéoprotection de la commune de ${nom}, dossier n° ${no}${orig ? `, de ${orig} à ${+es[0].date.slice(0, 4) - 1}` : ""}` });
      }
      const autres = d.mairie.slice(1).map(x => { const e = x.last; DET[e.id] = { kicker: "Dossier n° " + x.id.split("-")[1], title: `${D.plur(e.cameras || 0, "caméra")} pour la mairie`, rows: [["Arrêtés publiés", String(x.es.length)], ["Dernier arrêté", D.fd(e.date)], ["Sur la rue", dash(e.cameras_vp)], ["Durée", e.duree || "non précisée"]], foot: `Acte ${e.id} · ${e.relu ? "relu à la main" : "lu par programme, à relire"}`, links: e.url ? [{ l: "Lire l'arrêté (recueil de la préfecture) ↗", href: e.url }] : [] };
        return { no: x.id.split("-")[1], date: D.fd(e.date), url: e.url, na: x.es.length, n: dash(e.cameras), vp: dash(e.cameras_vp), ancre: "dos-" + x.id, cls: "r" + (S.sel === e.id ? " on" : ""), hover: this.pick(e.id) }; });
      // shops and companies: one row per dossier (its last act)
      const pv = S.allPriv ? d.prives : d.prives.slice(0, 15);
      const priv = pv.map(x => { const e = x.last, nm = D.benef(e), cat = /pharmacie/i.test(e.beneficiaire || "") ? "Pharmacie" : CAT[e.type_beneficiaire] || D.Maj(e.type_beneficiaire || "commerce");
        DET[e.id] = { kicker: "Arrêté · " + D.fd(e.date), title: `${nm || "Nom non publié"} · ${D.plur(e.cameras || 0, "caméra")}`, rows: [["Catégorie", cat], ["Abords", dash(e.cameras_ext)], ["Intérieur", dash(e.cameras_int)], ["Durée", e.duree || "non précisée"]],
          foot: `Acte ${e.id}${e.page ? ", p. " + e.page : ""} · ${e.relu ? "relu à la main" : "lu par programme, à relire"}`, links: e.url ? [{ l: "Lire l'arrêté (recueil de la préfecture) ↗", href: e.url }] : [] };
        return { date: D.fd(e.date), nom: nm || "nom non publié", nomStyle: nm ? "font-weight: 700" : "font-style: italic; color: var(--muted)", cat, n: D.fr(e.cameras || 0), ext: dash(e.cameras_ext), int: dash(e.cameras_int), url: e.url, cls: "r" + (S.sel === e.id ? " on" : ""), hover: this.pick(e.id) }; });
      const ds = d.prives.map(x => x.last.date).sort();
      const prv = { cam: D.plur(camP, "caméra"), arr: D.plur(nP, "arrêté"), span: ds.length ? (ds[0].slice(0, 7) === ds[ds.length - 1].slice(0, 7) ? `en ${D.fmL(ds[0])}` : `de ${D.MOISL[+ds[0].slice(5, 7) - 1]}${ds[0].slice(0, 4) !== ds[ds.length - 1].slice(0, 4) ? " " + ds[0].slice(0, 4) : ""} à ${D.fmL(ds[ds.length - 1])}`) : "",
        more: d.prives.length > 15 ? (S.allPriv ? "Réduire" : `Les ${D.fr(d.prives.length)} dossiers`) : "", moreAct: () => this.setState({ allPriv: !S.allPriv }) };
      // drones, body cameras, algorithmic analysis
      const lyonDr = (D.byInsee["69123"] || []).filter(D.isDrone).length;
      const autresArr = { none: !d.autres.length, ex: `Exemple à Lyon : ${D.plur(lyonDr, "arrêté")} de drones →`, exHref: "#/commune/69123/carte",
        // a shared act: the communes it names, each a link, and « partagé avec N communes »
        list: d.autres.slice().sort(byDateDesc).slice(0, 12).map(e => ({ d: D.fd(e.date), t: `${e.t === "arrete_drone" ? "Drones" : e.t === "arrete_pietons" ? "Caméras-piétons" : "Analyse algorithmique"} · ${esc(benefLabel(e))}`
          + (e.partage?.length ? ` · ${D.partageTxt(e)} : ${e.partage.map(k => `<a href="#/commune/${k}">${esc(R.communes[k].nom)}</a>`).join(", ")}` : ""), href: e.t === "arrete_drone" || e.t === "arrete_vsa" ? `#/commune/${insee}/carte` : e.url || "#", l: e.t === "arrete_drone" || e.t === "arrete_vsa" ? "Sur la carte →" : "L'arrêté ↗" })),
        multi: d.multi.length ? `${D.plur(d.multi.length, "arrêté")} de ${d.multi.every(a => a.kind === "drone") ? "drones" : "drones ou d'analyse algorithmique"} ${d.multi.length > 1 ? "nomment" : "nomme"} aussi ${esc(nom)} parmi d'autres communes (${d.multi.map(a => D.fd(a.date_acte)).join(", ")}) : <a href="#/commune/${insee}/carte">voir sur la carte →</a>` : "" };
      if (d.autres.length) autresArr.none = false;
      const d0 = DET[S.sel];
      const det = d0 ? { kicker: d0.kicker, title: d0.title, rows: d0.rows.map(([k, v]) => ({ k, v })), foot: d0.foot, links: d0.links }
        : { kicker: `${nom} · autorisations en vigueur`, title: D.plur(camM + camP, "caméra") + " autorisée" + (camM + camP > 1 ? "s" : ""), rows: [{ k: "Mairie", v: D.fr(camM) }, { k: "dont sur la rue", v: vpM == null ? "—" : D.fr(vpM) }, { k: "Commerces et entreprises", v: D.fr(camP) }, { k: "Drones", v: (n => n ? D.plur(n, "arrêté") : "aucun")(d.autres.filter(D.isDrone).length + d.multi.length) }], foot: "Survolez un arrêté : son détail s'affiche ici.", links: [] };
      return Object.assign(this.base("autorisations"), this.info("dos", "nom"), D.filCommune(insee, "Autorisations"), {
        com: D.tete(insee, "aut"), lead, kpis, mairie, marks, rows, autres, priv, prv, autresArr, det,
        nArr: D.fr(d.L.length), nDocs: D.fr((D.byInsee[insee] || []).length),
        // singular and elision (« Cet arrêté figure aussi parmi le document d'Ampuis »)
        cesTxt: d.L.length > 1 ? `Ces ${D.fr(d.L.length)} arrêtés figurent aussi parmi` : "Cet arrêté figure aussi parmi",
        docsTxt: (n => `${n > 1 ? `les ${D.fr(n)} documents` : "le document"} ${/^[aeiouyéèêâîôûh]/i.test(nom) ? "d'" : "de "}${nom}`)((D.byInsee[insee] || []).length),
        mairieCap: main ? (main.es.filter(e => e.cameras != null).length > 1 ? `Les ${main.es.filter(e => e.cameras != null).length} arrêtés du dossier de la mairie` : "L'arrêté du dossier de la mairie") : "", lien: { ici: location.hash, documents: `#/commune/${insee}/documents` },
      });
    }
  }
  V11.register("autorisations", Autorisations);
})();
