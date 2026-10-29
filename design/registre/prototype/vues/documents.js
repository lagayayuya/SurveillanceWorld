// View 4 · Commune · Documents (maquette Documents-grand.dc.html): the mockup's filters, table and panel, on
// every document of the commune.
(() => {
  "use strict";
  const D = D11;
  const eur = n => n >= 1e6 ? (n / 1e6).toFixed(1).replace(".", ",") + " M€" : D.fr(n) + " €";
  const TYPEL = { attribution: "Contrat", modification: "Modification", avis: "Appel d'offres", resultat: "Résultat", rectificatif: "Rectificatif",
    arrete: "Autorisation", arrete_drone: "Autorisation", arrete_pietons: "Autorisation", arrete_vsa: "Autorisation", subvention_region: "Subvention", subvention_etat: "Subvention" };
  // the families of the « Type » filter: one word per perimeter (§ 3)
  const fam = e => e.t === "attribution" ? "con" : e.t === "modification" ? "mod" : /^(avis|resultat|rectificatif)$/.test(e.t) ? "ao" : e.t === "arrete" ? "aut" : e.t === "arrete_drone" ? "dr" : e.t.startsWith("arrete") ? "arr" : "sub";
  const FAML = { con: "Contrats", mod: "Modifications", ao: "Appels d'offres et résultats", aut: "Autorisations de caméras", dr: "Arrêtés de drones", arr: "Autres arrêtés", sub: "Subventions" };
  const QUIL = { m: "La mairie", o: "Autres acheteurs publics", p: "Entreprises et commerces", n: "Nom non publié" };

  class Documents extends Vue {
    init(p) { const q = new URLSearchParams((location.hash.split("?")[1] || ""));
      const pre = (k) => Object.fromEntries((q.get(k) || "").split(",").filter(Boolean).map(v => [v, true]));
      return { sort: "date", dir: -1, f: { type: pre("t"), qui: pre("qui"), an: pre("y") }, copied: false }; }
    titre() { return "Documents · " + (R.communes[this.props.insee]?.nom || ""); }
    rows() {
      if (this._r) return this._r;
      const insee = this.props.insee, nom = R.communes[insee]?.nom || insee;
      return this._r = (D.byInsee[insee] || []).map(e => {
        const isA = e.t.startsWith("arrete"), com = isCommunal(e), b = isA ? D.buyer(e) : D.buyer(e);
        const qk = isA ? (com ? "m" : e.beneficiaire === "[non retenu]" ? "n" : "p") : e.t.startsWith("subvention") ? "m" : (com ? "m" : "o");
        const qui = qk === "m" ? (e.type_beneficiaire === "epci" && isA ? benefLabel(e) : `Mairie de ${nom}`) : qk === "n" ? "nom non publié" : isA ? benefLabel(e) : D.buyerNom(D.buyer(e));
        // names are links (the buyer when it is not the mairie, the companies); the panel keeps the plain text
        const b2 = !isA && !e.t.startsWith("subvention") ? D.buyer(e) : null;
        const quiH = qk === "o" && b2 ? `<a href="${D.buyerHref(b2)}" style="color: inherit">${esc(qui)}</a>` : qk === "m" && insee ? `<a href="#/commune/${insee}" style="color: inherit">${esc(qui)}</a>` : esc(qui);
        const entH = (e.t === "attribution" || e.t === "modification") && e.entreprises?.length ? "→ " + e.entreprises.map(s => `<a href="#/entreprise/${s}" style="color: inherit">${esc(D.ent(s))}</a>`).join(", ") : "";
        return { e, id: e.id, date: e.date || "", g: fam(e), qk, an: (e.date || "").slice(0, 4), qui, quiH, entH, ent: (e.t === "attribution" || e.t === "modification") && e.entreprises?.length ? "→ " + e.entreprises.map(D.ent).join(", ") : "",
          objet: D.titre(e), amt: (e.t === "attribution" || e.t === "modification" || e.t.startsWith("subvention")) ? e.montant : null, cam: e.t === "arrete" ? e.cameras : null };
      });
    }
    renderVals() {
      const S = this.state, insee = this.props.insee, nom = R.communes[insee]?.nom || insee, all = this.rows(), F = S.f;
      const val = (r, k) => k === "type" ? r.g : k === "qui" ? r.qk : r.an;
      const pass = (r, skip) => ["type", "qui", "an"].every(k => { if (k === skip) return true; const sel = Object.keys(F[k]).filter(x => F[k][x]); return !sel.length || sel.indexOf(val(r, k)) >= 0; });
      const pick = (k, v) => () => { const nf = { type: { ...F.type }, qui: { ...F.qui }, an: { ...F.an } }; nf[k][v] = !nf[k][v]; this.setState({ f: nf }); };
      const present = k => [...new Set(all.map(r => val(r, k)))];
      const FD = [["type", "Type", ["con", "mod", "ao", "aut", "dr", "arr", "sub"].filter(v => present("type").includes(v)).map(v => [v, FAML[v]])],
        ["qui", "Qui", ["m", "o", "p", "n"].filter(v => present("qui").includes(v)).map(v => [v, QUIL[v]])],
        ["an", "Année", present("an").filter(Boolean).sort().reverse().map(v => [v, v])]];
      const facets = FD.map(([k, l, items]) => ({ l, items: items.map(([v, lab]) => { const n = all.filter(r => pass(r, k) && val(r, k) === v).length, c = !!F[k][v];
        return { l: lab, n, checked: c ? "true" : "false", mark: c ? "✓" : "", pick: pick(k, v), style: n === 0 && !c ? "opacity: .45" : "" }; }) }));
      const list = all.filter(r => pass(r, null));
      const key = { date: r => r.date, fig: r => r.amt != null ? 1e9 + r.amt : r.cam != null ? r.cam : -1 }[S.sort];
      list.sort((a, b) => { const va = key(a), vb = key(b); return (va > vb ? 1 : va < vb ? -1 : 0) * S.dir; });
      const rows = list.map(r => { const e = r.e; return { date: D.fd(e.date), flag: !!e.note_relecture, type: TYPEL[e.t] || "", bs: D.BS[D.typ(e)], objet: r.objet, href: D.docHref(e),
        qui: r.quiH, quiStyle: r.qk === "n" ? "font-style: italic; color: var(--muted)" : "", ent: r.entH, fig: r.amt != null ? eur(r.amt) : r.cam != null ? String(r.cam) : "—", figL: r.amt != null ? "au maximum" : r.cam != null ? "caméras" : "",
        cls: "r" + (S.sel === r.id ? " on" : ""), hover: () => { if (S.sel !== r.id) this.setState({ sel: r.id, copied: false }); } }; });
      const cols = this.cols([["date", "Date", "", "width: 112px"], [null, "Document", "", ""], [null, "Qui", "", "width: 140px"], ["fig", "Montant ou caméras", "num", "width: 120px"]], "sort", "dir");
      const r = S.sel && all.find(x => x.id === S.sel);
      let det;
      if (r) {
        const e = r.e, isA = e.t.startsWith("arrete"), a = R.affaires[e.affaire];
        const rowsD = [["Date", D.fd(e.date)], ["Type", TYPEL[e.t]], [isA ? "Bénéficiaire" : "Acheteur", r.qui]];
        if (r.ent) rowsD.push(["Entreprise", r.ent.slice(2)]);
        if (r.amt != null) rowsD.push([e.t.startsWith("subvention") ? "Montant de la subvention" : "Montant maximum", eur(r.amt)]);
        if (e.t === "attribution") { rowsD.push(["Durée publiée", e.duree ? `${e.duree} mois` : "non publiée"]); rowsD.push(["Offres reçues", e.offres != null ? String(e.offres) : "non publié"]); }
        if (e.t === "modification") rowsD.push(["Montant", (e.changements || []).length ? e.changements.join(" ; ") : "inchangé"]);
        if (e.t === "arrete") { if (r.cam != null) rowsD.push(["Caméras autorisées", String(r.cam)]); if (e.cameras_vp != null || e.cameras_int != null) rowsD.push(["Voie publique · intérieur · extérieur", [e.cameras_vp, e.cameras_int, e.cameras_ext].map(x => x ?? "—").join(" · ")]); rowsD.push(["Durée", e.duree || "non précisée"]); }
        if (e.t === "avis" && a?.kind === "contrat_non_retrouve") rowsD.push(["Contrat qui a suivi", a.contrat_probable ? "lien probable" : (e.date > D.addM(TODAY, -18) ? "pas encore publié" : "non retrouvé")]);
        rowsD.push(["Référence", e.ref]);
        det = { kicker: TYPEL[e.t] + " · " + D.fd(e.date), title: r.objet, rows: rowsD.map(([k, v]) => ({ k, v })), note: e.note_relecture || "",
          links: [{ l: isA ? `Les autorisations de ${nom} →` : /^(avis|resultat|rectificatif)$/.test(e.t) ? "Le parcours de l'appel d'offres →" : e.t.startsWith("subvention") ? "Fiche de la subvention →" : "Fiche du contrat →", href: D.docHref(e) }]
            .concat(e.url ? [{ l: "Source officielle →", href: e.url }] : []),
          btn: { l: S.copied ? "Référence copiée" : "Copier la référence", act: () => { try { navigator.clipboard?.writeText(e.ref); } catch (x) { /* not allowed */ } this.setState({ copied: true }); } } };
      } else {
        const c = k => all.filter(x => x.g === k).length, ys = all.map(x => x.an).filter(Boolean).sort();
        det = { kicker: `${nom} · ${D.plur(all.length, "document")}`, title: "Survolez une ligne",
          rows: ["con", "mod", "ao", "aut", "dr", "arr", "sub"].filter(k => c(k)).map(k => ({ k: FAML[k], v: String(c(k)) })).concat(ys.length ? [{ k: "Du plus ancien au plus récent", v: `${ys[0]} → ${ys[ys.length - 1]}` }] : []) };
      }
      const nf = Object.values(F).reduce((a, o) => a + Object.values(o).filter(Boolean).length, 0);
      const exp = fmt => ev => { ev.preventDefault(); exportRows(list.map(x => x.e), fmt, `${D.plain(nom).replace(/\s+/g, "-")}-documents`); };
      return Object.assign(this.base("documents"), this.info("np", "dl"), D.filCommune(insee, "Documents"), {
        com: D.tete(insee, "doc"), facets, rows, cols, det, empty: list.length === 0,
        countLabel: nf ? D.plur(list.length, "document") + " sur " + D.fr(all.length) : D.plur(all.length, "document"),
        dlLabel: nf ? "Télécharger la sélection :" : "Télécharger :", dl: { csv: exp("csv"), json: exp("json") },
        clear: () => this.setState({ f: { type: {}, qui: {}, an: {} } }),
      });
    }
  }
  V11.register("documents", Documents);
})();
