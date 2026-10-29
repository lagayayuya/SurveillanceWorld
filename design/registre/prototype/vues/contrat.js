// View 7 · Fiche d'un contrat (maquette Contrat-grand.dc.html), replacing the « affaire » page. The same template
// serves a call for tenders without a contract found, a subsidy and an act without a commune (brief § 2.7).
(() => {
  "use strict";
  const D = D11;
  const eur = n => n == null ? "non publié" : D.fr(n) + " €";
  const eurK = n => n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(".", ",") + " M€" : D.fr(n) + " €";
  const h = s => esc(s);
  const TS = { con: "background: var(--fg); color: var(--bg)", mod: "background: transparent; color: var(--fg)", ao: "background: var(--ao); color: var(--ao-ink); border-color: var(--ao)",
    fin: "background: transparent; color: var(--muted); border-style: dashed; border-color: var(--muted)", aut: D.BS.aut, sub: D.BS.sub };
  const entA = s => `<a href="#/entreprise/${s}">${h(tidy(entName(s)))}</a>`;
  const ans = m => m % 12 === 0 && m >= 12 ? D.plur(m / 12, "an") : D.plur(m, "mois", "mois");
  const MAXNOTE = "« Au maximum » : le plafond écrit dans le contrat, hors taxes. La somme réellement payée n'est pas publiée. Un accord-cadre fixe ce plafond ; la mairie passe ensuite des commandes.";
  class Contrat extends Vue {
    titre() { const a = R.affaires[this.props.id]; return a ? D.titreAff(a.id, EV[a.events[0]]) : "Document"; }
    renderVals() {
      const S = this.state, id = this.props.id, a = R.affaires[id];
      if (!a) return Object.assign(this.base("contrat"), this.info("par", "max"), { fil: [{ l: "Registre", href: "#/" }], filIci: "Document introuvable", titre: "Document introuvable", sous: id, lead: "Ce document n'est pas dans le registre.", kpis: [], steps: [], grille: "1fr", src: [], dl: [], det: { kicker: "", title: "", rows: [] }, ditTitre: "", maxNote: "" });
      const evs = a.events.map(i => EV[i]).filter(Boolean).sort(byDateAsc), e0 = evs[0];
      const insee = a.insee && R.communes[a.insee] ? a.insee : (lieu(e0)[0] || null), c = insee ? R.communes[insee] : null, dep = a.dep || e0.dep;
      const ST = [];
      let kpis, lead, dl, badge, ditTitre, maxNote = MAXNOTE, kind, sum;
      const buyerS = a.acheteur_siren || D.buyer(e0), buyerTxt = buyerS ? (ACH[buyerS]?.categorie === "commune" && ACH[buyerS]?.insee_siege ? `La mairie de ${h(R.communes[ACH[buyerS].insee_siege]?.nom || "")}` : h(D.buyerNom(buyerS))) : "L'acheteur";
      const buyerLinkV = buyerS ? `<a href="${D.buyerHref(buyerS)}">${h(D.buyerNom(buyerS))}</a>` : "non publié";
      if (a.kind === "contrat") {
        kind = "con";
        const att = evs.find(e => e.t === "attribution") || e0, mods = evs.filter(e => e.t === "modification"), avis = evs.filter(e => e.t === "avis");
        const probAvis = (a.avis_probables || []).map(x => R.affaires[x]).filter(Boolean).map(x => EV[x.events[0]]);
        const aoE = avis[0] || probAvis[0];
        const lastM = mods[mods.length - 1] || att, dur = lastM.duree || att.duree, end = dur ? D.addM(D.dateLue(att), dur) : null;
        if (aoE) ST.push({ k: "ao", type: "Appel d'offres", date: D.fd(aoE.date), what: probAvis[0] && !avis[0] ? "La mairie publie sa consultation (lien probable)" : "L'acheteur publie sa consultation", ref: aoE.ref, url: aoE.url,
          rows: [["Objet", D.court(aoE.affaire) || D.sent(aoE.objet || "").toLowerCase()], ["Résultat publié", (R.affaires[aoE.affaire]?.events || []).map(i => EV[i]).filter(x => x.t === "resultat").map(x => D.fd(x.date)).join(", ") || "[à lire]"]], foot: "Bulletin officiel des annonces des marchés publics" });
        ST.push({ k: "con", type: "Contrat", date: D.fd(att.date) + (att.note_relecture ? " (à vérifier)" : ""), what: `Signé avec ${att.entreprises?.length ? att.entreprises.map(x => tidy(entName(x))).join(", ") : "une entreprise non publiée"}${att.offres != null ? `, ${D.plur(att.offres, "offre reçue", "offres reçues")}` : ""}`, ref: att.ref, url: att.url,
          rows: [["Montant maximum", eur(att.montant)], ["Durée", att.duree ? `${att.duree} mois` : "non publiée"], ["Offres reçues", att.offres != null ? String(att.offres) : "non publié"], ["Forme", (a.techniques && a.techniques !== "Sans objet" ? a.techniques : "contrat").toLowerCase()]], foot: "Données essentielles de la commande publique · " + (att.relu ? "relu à la main" : "lu par programme") });
        const modSteps = mods.length > 2 ? [{ many: mods }] : mods.map(m => ({ one: m }));
        modSteps.forEach(x => { if (x.one) { const m = x.one, i = mods.indexOf(m);
          ST.push({ k: "mod", type: "Modification", date: D.fd(m.date), what: `Modification n° ${m.modif_n || i + 1}`, ref: m.ref, url: m.url,
            rows: [["Montant maximum", eur(m.montant) + (m.montant === att.montant ? " (inchangé)" : "")], ["Durée", (m.duree ? `${m.duree} mois` : "—") + (m.duree === att.duree ? " (inchangée)" : "")], ["Ce qui change", (m.changements || []).length ? m.changements.join(" ; ") : "[à lire dans l’avenant]"]],
            foot: (m.changements || []).length ? "" : "La donnée publiée ne dit pas ce que modifie l’avenant." }); }
          else ST.push({ k: "mod", type: "Modification", date: `${D.fd(x.many[0].date)} → ${D.fd(x.many[x.many.length - 1].date)}`, what: `${x.many.length} modifications`, ref: x.many[x.many.length - 1].ref, url: x.many[x.many.length - 1].url,
            rows: x.many.map(m => [D.fd(m.date), eur(m.montant)]), foot: "La donnée publiée ne dit pas ce que modifie chaque avenant." }); });
        const next = Object.values(R.affaires).filter(x => x.kind === "contrat_non_retrouve" && x.insee === a.insee && (R.affaires[x.id].events.map(i => EV[i]).some(v => (v.acheteur_siren || "") === buyerS)) && x.debut > (end ? D.addM(end, -24) : att.date) && x.debut > att.date).sort((p, q) => p.debut.localeCompare(q.debut))[0];
        if (end) ST.push({ k: "fin", type: "Fin prévue", date: D.fm(end), what: `Signature + ${dur} mois`, rows: [["Calcul", `${D.fd(D.dateLue(att))} + ${dur} mois`]].concat(next ? [["Nouvel appel d’offres", "publié dès " + D.fmL(next.debut)]] : []), foot: "Date calculée, pas publiée." });
        // the previous contract of the same buyer for the same device; the next call for tenders
        const prev = Object.values(R.affaires).filter(x => x.kind === "contrat" && x.id !== a.id && x.acheteur_siren === a.acheteur_siren && x.dispositif === a.dispositif)
          .map(x => ({ x, e: EV[x.events.find(i => EV[i].t === "attribution")] })).filter(o => o.e && D.dateLue(o.e) < D.dateLue(att)).sort((p, q) => D.dateLue(q.e).localeCompare(D.dateLue(p.e)))[0];
        this._prec = prev ? { href: `#/contrat/${encodeURIComponent(prev.x.id)}`, l: `← Contrat précédent : ${D.dateLue(prev.e).slice(0, 4)}, ${prev.e.entreprises?.length ? tidy(entName(prev.e.entreprises[0])) : "entreprise non publiée"}, ${eurK(prev.e.montant || 0)}` } : null;
        this._suiv = next ? { href: `#/contrat/${encodeURIComponent(next.id)}`, l: `Appel d'offres suivant : ${D.fmL(next.debut)}${next.contrat_probable ? " (lien probable)" : ""} →` } : null;
        const es = att.entreprises || [], est = es[0] ? D.entStats[es[0]] : null;
        kpis = [{ v: eur(att.montant), l: "au maximum, hors taxes" }, { v: dur ? `${dur} mois` : "—", l: end ? `fin prévue en ${D.fm(end)}` : "durée non publiée" }, { v: att.offres != null ? String(att.offres) : "—", l: att.offres != null ? (att.offres > 1 ? "offres reçues" : "offre reçue") : "offres non publiées" }, { v: String(mods.length), l: mods.length > 1 ? "modifications publiées" : "modification publiée" }];
        const what = LIBELLES[a.id]?.phrase || (D.court(a.id) ? D.court(a.id).replace(/^(\S)/, x => x) : "ce contrat");
        lead = `${buyerTxt} a confié ${D.court(a.id) ? (D.court(a.id) === "achat et entretien des caméras" ? "l'achat et l'entretien de ses caméras" : h(D.court(a.id))) : "ce contrat"} à ${es.length ? es.map(entA).join(", ") : "une entreprise non publiée"}${dur ? ` pour ${ans(dur)}` : ""}, jusqu'à <strong>${eur(att.montant)}</strong> au maximum.`;
        dl = [["Acheteur", buyerLinkV], ["Entreprise", es.length ? es.map(entA).join(", ") + (est ? ` <span style="color: var(--muted)">· ${D.plur(est.n, "contrat")} avec ${D.plur(est.clientes.size, "collectivité")}</span>` : "") : "non publiée"],
          ["Objet publié", `<span class="objet">${h(D.sent(att.objet || a.titre || ""))}</span>`], ["Forme", a.techniques && a.techniques !== "Sans objet" ? `<a href="#/glossaire#g-accord-cadre">${h(a.techniques)}</a>` : "contrat"], ["Dispositif", h(D.Maj((DISPOSITIFS[att.dispositif] || att.dispositif || "").toString()))],
          ["Montant maximum", `<strong>${eur(lastM.montant ?? att.montant)}</strong>${mods.length ? (lastM.montant === att.montant ? `, inchangé par la modification` : `, ${eur(att.montant)} à la signature`) : ""}`],
          ["Durée", dur ? `${dur} mois${mods.length ? (lastM.duree === att.duree ? ", inchangée par la modification" : `, ${att.duree} mois à la signature`) : ""}` : "non publiée"], ["Offres reçues", att.offres != null ? String(att.offres) : "non publié"]];
        if (att.hors_totaux || att.national) dl.push(["Hors des totaux", h(horsRaison(att))]);
        if (att.note_relecture) dl.push(["À vérifier", h(att.note_relecture)]);
        badge = { l: "Contrat", s: TS.con }; ditTitre = "Ce que dit le contrat";
        sum = { kicker: `Contrat · ${c ? c.nom : DEPS[dep] || ""}`, title: `${es.length ? tidy(entName(es[0])) : "Entreprise non publiée"} · ${eur(att.montant)}`, rows: [["Signé", D.fd(att.date)], ["Fin prévue", end ? D.fm(end) : "—"], ["Offres reçues", att.offres != null ? String(att.offres) : "non publié"], ["Modifications", String(mods.length)]] };
        this._titreDoc = `Contrat de ${D.fmL(D.dateLue(att))}`;
      } else if (a.kind === "contrat_non_retrouve") {
        kind = "ao";
        const avis = evs.filter(e => e.t === "avis"), res = evs.filter(e => e.t === "resultat"), rect = evs.filter(e => e.t === "rectificatif");
        const prob = a.contrat_probable ? R.affaires[a.contrat_probable] : null, pe = prob ? EV[prob.events.find(i => EV[i].t === "attribution")] : null;
        evs.forEach(e => ST.push({ k: "ao", type: e.t === "resultat" ? "Résultat" : e.t === "rectificatif" ? "Rectificatif" : "Appel d'offres", date: D.fd(e.date), what: e.t === "resultat" ? "Le résultat est publié" : e.t === "rectificatif" ? "La consultation est corrigée" : "L'acheteur publie sa consultation", ref: e.ref, url: e.url, rows: [["Objet", D.sent(e.objet || "")]], foot: "Bulletin officiel des annonces des marchés publics" }));
        if (pe) ST.push({ k: "con", type: "Contrat", date: D.fd(pe.date), what: `Contrat probable avec ${pe.entreprises?.length ? pe.entreprises.map(x => tidy(entName(x))).join(", ") : "une entreprise non publiée"} (lien probable)`, ref: pe.ref, url: pe.url, href: `#/contrat/${encodeURIComponent(prob.id)}`, rows: [["Montant maximum", eur(pe.montant)], ["Règle", a.lien_probable?.regle || "même acheteur, objet proche"]], foot: "Lien probable, pas certain." });
        else ST.push({ k: "fin", type: "Contrat", date: a.debut > D.addM(TODAY, -18) ? "pas encore publié" : "non retrouvé", what: "Aucun contrat publié ne correspond", rows: [["Cherché", "même acheteur, objet proche, 1 à 12 mois après"]], foot: "Le contrat existe peut-être : il n'est pas dans les données publiées." });
        kpis = [{ v: D.fd(a.debut), l: "consultation publiée" }, { v: res.length ? D.fd(res[0].date) : "—", l: res.length ? "résultat publié" : "résultat non publié" }, { v: pe ? "probable" : "—", l: pe ? "contrat retrouvé (lien probable)" : "contrat non retrouvé" }, { v: String(evs.length), l: evs.length > 1 ? "avis publiés" : "avis publié" }];
        lead = `${buyerTxt} a publié un appel d'offres le ${longDate(a.debut)}${pe ? `. Le contrat qui a suivi est probablement celui signé avec ${pe.entreprises?.length ? pe.entreprises.map(entA).join(", ") : "une entreprise non publiée"} (<a href="#/contrat/${encodeURIComponent(prob.id)}">fiche</a>).` : a.debut > D.addM(TODAY, -18) ? " : aucun contrat n'est encore publié." : " : aucun contrat publié ne lui correspond."}`;
        dl = [["Acheteur", buyerLinkV], ["Objet publié", `<span class="objet">${h(D.sent(e0.objet || a.titre || ""))}</span>`], ["Avis", avis.length ? avis.map(x => h(x.ref)).join(", ") : "—"], ["Résultat", res.length ? res.map(x => h(x.ref)).join(", ") : "non publié"]].concat(rect.length ? [["Rectificatifs", rect.map(x => h(x.ref)).join(", ")]] : []);
        badge = { l: "Appel d'offres", s: TS.ao }; ditTitre = "Ce que dit l'appel d'offres"; maxNote = "Un appel d'offres annonce un besoin ; le montant et l'entreprise ne sont connus qu'au contrat. Un lien « probable » relie l'avis à un contrat du même acheteur, d'objet proche, signé dans l'année.";
        sum = { kicker: `Appel d'offres · ${c ? c.nom : DEPS[dep] || ""}`, title: D.titreAff(a.id, e0), rows: [["Publié", D.fd(a.debut)], ["Résultat", res.length ? D.fd(res[0].date) : "non publié"], ["Contrat", pe ? "lien probable" : "non retrouvé"]] };
        this._prec = null; this._suiv = pe ? { href: `#/contrat/${encodeURIComponent(prob.id)}`, l: "Contrat probable →" } : null;
        this._titreDoc = `Appel d'offres de ${D.fmL(a.debut)}`;
      } else if (a.kind === "subvention") {
        // a subsidy: the vote(s), the contract it may have financed, what it says
        kind = "sub";
        evs.forEach(e => ST.push({ k: "sub", type: "Subvention", date: e.date_annee ? e.date.slice(0, 4) : D.fd(e.date), what: `${e.t === "subvention_region" ? "La Région" : "L'État"} vote ${eur(e.montant)}`, ref: e.ref, url: e.url, rows: [["Montant", eur(e.montant)], ["Caméras", e.cameras != null ? D.fr(e.cameras) : "non précisé"], ["Base subventionnable", e.base ? eur(e.base) : "—"], ["Taux", e.taux ? D.fr(e.taux) + " %" : "—"]], foot: e.t === "subvention_region" ? "Délibération de la commission permanente de la Région" : "Liste des dotations de la préfecture" }));
        const prob = a.contrat_probable ? R.affaires[a.contrat_probable] : null, pe = prob ? EV[prob.events.find(i => EV[i].t === "attribution")] : null;
        if (pe) ST.push({ k: "con", type: "Contrat", date: D.fd(pe.date), what: "Contrat probablement financé (lien probable)", ref: pe.ref, url: pe.url, rows: [["Montant maximum", eur(pe.montant)]], foot: "Lien probable, pas certain." });
        const tot = evs.reduce((t, e) => t + (e.montant || 0), 0), cams = evs.reduce((t, e) => t + (e.cameras || 0), 0);
        kpis = [{ v: eur(tot), l: "votés" }, { v: cams ? D.fr(cams) : "—", l: "caméras financées" }, { v: e0.taux ? D.fr(e0.taux) + " %" : "—", l: "du coût subventionnable" }, { v: String(evs.length), l: evs.length > 1 ? "délibérations" : "délibération" }];
        lead = `${e0.t === "subvention_region" ? (e0.dep === "13" ? "La Région Sud" : "La Région Île-de-France") : "L'État"} a accordé <strong>${eur(tot)}</strong> à ${c ? `<a href="#/commune/${insee}">${h(c.nom)}</a>` : h(casse(tidy(e0.beneficiaire || "")))}${cams ? ` pour ${D.plur(cams, "caméra")}` : ""}.`;
        const fin = e0.t === "subvention_region" ? (e0.dep === "13" ? "Région Sud" : "Région Île-de-France") : "", finS = fin && Object.keys(ACH).find(k => ACH[k].categorie === "region" && ACH[k].nom === fin);
        dl = [["Bénéficiaire", c ? `<a href="#/commune/${insee}">${h(casse(tidy(e0.beneficiaire || c.nom)))}</a>` : h(casse(tidy(e0.beneficiaire || "")))], ["Financeur", fin ? (finS ? `<a href="${D.buyerHref(finS)}">${fin}</a>` : fin) : "État" + (e0.programme ? ` (${h(e0.programme)})` : "")], ["Objet publié", `<span class="objet">${h(D.sent(e0.objet || ""))}</span>`], ["Montant", eur(tot)], ["Caméras", cams ? D.fr(cams) : "non précisé"]];
        badge = { l: "Subvention", s: TS.sub }; ditTitre = "Ce que dit la subvention"; maxNote = "Une subvention couvre une part du coût d'un projet (le taux, sur une base subventionnable). Le contrat qu'elle finance n'est pas désigné : un lien « probable » est proposé quand un contrat de la commune correspond.";
        sum = { kicker: `Subvention · ${c ? c.nom : DEPS[dep] || ""}`, title: eur(tot), rows: [["Votée", D.fd(e0.date)], ["Caméras", cams ? D.fr(cams) : "—"], ["Contrat", pe ? "lien probable" : "non désigné"]] };
        this._prec = null; this._suiv = pe ? { href: `#/contrat/${encodeURIComponent(prob.id)}`, l: "Contrat probable →" } : null;
        this._titreDoc = `Subvention de ${e0.date_annee ? e0.date.slice(0, 4) : D.fmL(e0.date)}`;
      } else {
        // an act without a commune (or a dossier): what the préfecture authorises
        kind = "aut";
        evs.forEach(e => ST.push({ k: "aut", type: "Autorisation", date: D.fd(e.date), what: D.titre(e), ref: e.ref, url: e.url, rows: [["Bénéficiaire", benefLabel(e)], ["Caméras ou appareils", e.cameras != null ? D.fr(e.cameras) : "non précisé"], ["Période", e.periode || "—"]], foot: e.relu ? "relu à la main" : "lu par programme, à relire" }));
        kpis = [{ v: e0.cameras != null ? D.fr(e0.cameras) : "—", l: e0.t === "arrete_drone" ? "appareils" : "caméras" }, { v: D.fd(e0.date), l: "date de l'arrêté" }, { v: e0.periode ? "oui" : "—", l: e0.periode ? "période précisée" : "période non précisée" }, { v: String(evs.length), l: evs.length > 1 ? "arrêtés" : "arrêté" }];
        lead = `${h(emetteur(e0))} a autorisé ${h(D.titre(e0).replace(/^Autorisation (de |d')/, "").toLowerCase())} pour ${h(benefLabel(e0))}${e0.objet ? ` : ${h(tidy(e0.objet))}` : ""}.`;
        dl = [["Bénéficiaire", h(benefLabel(e0))], ["Publié par", h(emetteur(e0))], ["Période", h(e0.periode || "non précisée")], ["Lieu", h(e0.objet || "non précisé")]];
        badge = { l: "Autorisation", s: TS.aut }; ditTitre = "Ce que dit l'arrêté"; maxNote = "Un arrêté de la préfecture autorise un dispositif pour une durée ou une période. Quand l'arrêté ne nomme pas de commune, il reste rattaché à son département.";
        sum = { kicker: `Arrêté · ${DEPS[dep] || dep || ""}`, title: D.titre(e0), rows: [["Date", D.fd(e0.date)], ["Bénéficiaire", benefLabel(e0)]] };
        this._prec = null; this._suiv = null;
        this._titreDoc = `Arrêté du ${D.fd(e0.date)}`;
      }
      // the steps, as the mockup draws them
      const steps = ST.map((s, i) => ({ type: s.type, date: s.date, what: s.what, badge: TS[s.k], next: i < ST.length - 1, cls: "st" + (s.k === "fin" ? " ghostst" : "") + (S.sel === i ? " on" : ""), hover: this.pick(i) }));
      const grille = ST.map(() => "minmax(0, 1fr)").join(" 28px ");
      const src = ST.map((s, i) => ({ s, i })).filter(o => o.s.ref).map(({ s, i }) => ({ date: s.date, type: s.type, badge: TS[s.k], ref: s.ref, url: s.url || "#", cls: "r" + (S.sel === i ? " on" : ""), hover: this.pick(i) }));
      let det = { kicker: sum.kicker, title: sum.title, rows: sum.rows.map(([k, v]) => ({ k, v })), foot: "Survolez une étape ou une source.", links: [] };
      if (S.sel != null && ST[S.sel]) { const s = ST[S.sel]; det = { kicker: s.type + " · " + s.date, title: s.what, rows: s.rows.map(([k, v]) => ({ k, v })), foot: (s.ref ? s.ref + " · " : "") + (s.foot || ""), links: s.href ? [{ l: "Fiche du contrat →", href: s.href }] : [] }; }
      const fil = [{ l: "Registre", href: "#/" }].concat(dep && DEPS[dep] ? [{ l: DEPS[dep], href: `#/departement/${dep}` }] : [], c ? [{ l: c.nom, href: `#/commune/${insee}` }, { l: "Documents", href: `#/commune/${insee}/documents` }] : []);
      return Object.assign(this.base("contrat"), this.info("par", "max"), {
        fil, filIci: this._titreDoc, badge, titre: this.titre(), sous: kind === "con" ? `Signé le ${D.fd(evs.find(e => e.t === "attribution")?.date || e0.date)} · ${evs.find(e => e.t === "attribution")?.ref || e0.ref}` : `${D.fd(e0.date)} · ${e0.ref}`,
        lead, kpis, steps, grille, prec: this._prec, noPrec: !this._prec, suiv: this._suiv, ditTitre, maxNote, dl: dl.map(([k, v]) => ({ k, v })), src, det, ev: (evs.find(e => e.t === "attribution") || e0).id,
      });
    }
  }
  V11.register("contrat", Contrat);
})();
