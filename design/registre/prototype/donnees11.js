// The figures of the v11 views, computed once from the registre (window.REG) and the files beside it.
// Loaded after app.js, whose helpers it uses (R, tidy, calm, casse, entName, buyerName, isCopy, CARTE_N…).
// The rules decided in the 11th pass (rapport-v11, § 3) live here and nowhere else:
// · words: « arrêtés » = every act of a préfecture in the registre (video, drones, body cameras, algorithmic
//   analysis); « autorisations de caméras » = the video-protection acts only (t = arrete); « arrêtés de
//   drones » = t = arrete_drone. One word per perimeter, everywhere.
// · amounts of a territory, a buyer or a company: the maximum of each signed contract, without the central
//   purchasing bodies (their ceiling covers other buyers), the mixed contracts and those « à vérifier »
//   (flags of the 5th pass), the national buyers, and a contract published twice counted once.
window.DEPS11 = DEPS;   // the département names, for the link census
window.D11 = (() => {
  "use strict";
  const E = R.evenements;
  const AFF = R.affaires;
  const MAP_ALL = { ...(window.CARTE_N_ALL || {}), ...(window.CARTE_N || {}) };   // the commune's own cut first
  const DL = { "69": "Rhône", "75": "Paris", "77": "Seine-et-Marne", "78": "Yvelines", "91": "Essonne", "92": "Hauts-de-Seine", "93": "Seine-Saint-Denis", "94": "Val-de-Marne", "95": "Val-d'Oise", "13": "Bouches-du-Rhône" };
  const ARRETES_COLLECTES = new Set(["69"]);
  const premierArrete = { "69": E.filter(e => e.t.startsWith("arrete") && e.dep === "69").map(e => e.date).sort()[0] };   // 2025-09-30
  const typ = e => e.t === "attribution" ? "con" : e.t === "modification" ? "mod" : /^(avis|resultat|rectificatif)$/.test(e.t) ? "ao" : e.t.startsWith("arrete") ? "aut" : e.t.startsWith("subvention") ? "sub" : "?";
  const DISP = { videoprotection: "vp", csu: "csu", vsa: "vsa", lapi: "lapi", pietons: "pi", cameras_pietons: "pi", videoverbalisation: "vv", drone: "dr", drones: "dr" };
  const disp = e => DISP[e.dispositif] || "na";
  const yGroup = d => { const y = +(d || "").slice(0, 4); return !y ? "" : y < 2018 ? "<2018" : String(y); };
  const depGroup = d => DL[d] ? d : "xx";
  const isCam = e => e.t === "arrete", isDrone = e => e.t === "arrete_drone", isArr = e => e.t.startsWith("arrete");
  const compte = e => e.t === "attribution" && !e.hors_totaux && !e.national && !isCopy(e);
  const buyer = e => e.acheteur_siren || AFF[e.affaire]?.acheteur_siren || null;

  // money and dates, as in the kit (§ 3)
  const fr = n => Math.round(n).toLocaleString("fr-FR").replace(/[  ]/g, " ");
  const eurK = n => n == null || n === 0 ? "non publié" : n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(".", ",") + " M€" : fr(n) + " €";
  const eurX = n => n == null ? "non publié" : fr(n) + " €";
  const MOISC = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
  const MOISL = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
  const fd = d => { if (!d) return "date non publiée"; const [y, m, j] = d.split("-").map(Number); return (j ? j + " " : "") + MOISC[m - 1] + " " + y; };
  const fm = d => MOISC[+d.slice(5, 7) - 1] + " " + d.slice(0, 4);
  const fmL = d => MOISL[+d.slice(5, 7) - 1] + " " + d.slice(0, 4);
  const docDate = e => e.t.startsWith("subvention") && e.date_annee ? (e.date || "").slice(0, 4) : fd(e.date);
  const addM = (d, n) => { const [y, m] = d.split("-").map(Number), t = y * 12 + (m - 1) + Math.round(n); return Math.floor(t / 12) + "-" + String(t % 12 + 1).padStart(2, "0") + d.slice(7); };
  const plur = (n, s, p) => fr(n) + " " + (n > 1 ? (p || s + "s") : s);
  const plain = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

  // a readable title: capitals put in sentence case, the source's lost apostrophes restored (display only)
  const SMALL = { de: 1, du: 1, des: 1, la: 1, le: 1, les: 1, et: 1, en: 1, pour: 1, au: 1, aux: 1, sur: 1 };
  const sent = s => { if (!s) return ""; s = tidy(s); if (s === s.toUpperCase()) { s = s.toLowerCase(); s = s.charAt(0).toUpperCase() + s.slice(1); } return s.length > 120 ? s.slice(0, 118).replace(/\s+\S*$/, "") + "…" : s; };
  const cam = n => fr(n) + (n > 1 ? " caméras" : " caméra");
  const titre = e => e.t === "arrete_drone" ? "Autorisation de drones" + (e.partage?.length ? ` · partagé avec ${e.partage.length} commune${e.partage.length > 1 ? "s" : ""}` : "") : e.t === "arrete_pietons" ? "Autorisation de caméras-piétons"
    : e.t === "arrete_vsa" ? "Autorisation d'analyse algorithmique" : e.t === "arrete" ? "Autorisation de " + (e.cameras != null ? cam(e.cameras) : "caméras")
    : sent(e.objet) || "Objet non publié";
  // a name in capitals in title case, its small words in lower case (« Pharmacie des Halles »); accents lost by the source stay lost
  const PETITS = new Set(["de", "des", "du", "la", "le", "les", "et", "en", "aux", "au", "sur", "sous"]);
  const propre = n => n.split(/(\s+)/).map((w, i) => i && PETITS.has(w.toLowerCase()) ? w.toLowerCase() : w.replace(/^([dl])’(\p{L})/iu, (m, a, b) => a.toLowerCase() + "’" + b.toUpperCase())).join("");
  const benef = e => e.beneficiaire === "[non retenu]" ? null : e.beneficiaire === "[non précisé]" ? "non précisé" : propre(casse(tidy(e.beneficiaire || ""))) || null;
  const ent = s => entName(s);

  // --- per commune ----------------------------------------------------------------------------------
  const byInsee = {};
  for (const e of E) if (e.insee) (byInsee[e.insee] ||= []).push(e);
  // 12th pass: an act that covers several communes appears in each, marked « partagé » (a copy of the event with
  // the commune's code, « partage » = the other communes). Territory totals still count each document once (uniq).
  const PARTAGES = {};
  for (const a of window.AUTORISATIONS || []) {
    const e = EV[a.acte]; if (!e || a.insee.length < 2 && a.insee[0] === e.insee) continue;
    const all = [...new Set(a.insee)].filter(k => R.communes[k]);
    // an act the registre left without a commune is placed by its zones (69-2026-10-02-00002: Lyon only)
    if (!e.insee && all.length) { e.insee = all[0]; e.dep ||= R.communes[all[0]].dep; (byInsee[all[0]] ||= []).push(e); }
    if (all.length < 2) continue;
    for (const k of all) {
      if (k === e.insee) { e.partage = all.filter(x => x !== k); continue; }
      const sh = Object.assign({}, e, { insee: k, partage: all.filter(x => x !== k), insee0: e.insee, id: e.id });
      (byInsee[k] ||= []).push(sh); (PARTAGES[k] ||= []).push(sh);
    }
  }
  const partageTxt = e => e.partage?.length ? `partagé avec ${e.partage.length} commune${e.partage.length > 1 ? "s" : ""}` : "";
  // a set of communes counted once per document
  const uniq = ks => { const seen = new Set(), o = { docs: 0, con: 0, cam: 0, dr: 0, arr: 0 };
    for (const k of ks) for (const e of byInsee[k] || []) { if (seen.has(e.id)) continue; seen.add(e.id); o.docs++; if (e.t === "attribution") o.con++; if (isCam(e)) o.cam++; if (isDrone(e)) o.dr++; if (isArr(e)) o.arr++; }
    return o; };
  function communeStats(insee) {
    const L = byInsee[insee] || [], c = R.communes[insee] || {};
    return { insee, nom: c.nom || insee, dep: c.dep, pop: c.pop || 0, epci: c.epci || "", docs: L.length,
      con: L.filter(e => e.t === "attribution").length, cam: L.filter(isCam).length, dr: L.filter(isDrone).length, arr: L.filter(isArr).length,
      carte: MAP_ALL[insee] ?? null, montant: L.filter(e => compte(e) && isCommunal(e)).reduce((s, e) => s + (e.montant || 0), 0) };
  }
  const communesDep = dep => Object.keys(byInsee).filter(k => R.communes[k]?.dep === dep).map(communeStats);
  const epciNom = code => (window.EPCIS || {})[code] || (code ? `intercommunalité ${code}` : "");
  // the communes of an intercommunality (all of them, from the reference file), and those with a document
  const epciCommunes = code => Object.entries(R.communes).filter(([, c]) => c.epci === code).map(([k]) => k);

  // --- per département ------------------------------------------------------------------------------
  const byDep = {};
  for (const e of E) (byDep[e.dep || ""] ||= []).push(e);
  function depStats(dep) {
    const L = byDep[dep] || [];
    return { docs: L.length, con: L.filter(e => e.t === "attribution").length, cam: L.filter(isCam).length, dr: L.filter(isDrone).length, arr: L.filter(isArr).length,
      sansCommune: L.filter(e => !e.insee || !R.communes[e.insee]).length, montant: L.filter(compte).reduce((s, e) => s + (e.montant || 0), 0),
      montantBrut: L.filter(e => e.t === "attribution").reduce((s, e) => s + (e.montant || 0), 0) };
  }

  // --- companies and buyers -------------------------------------------------------------------------
  const contrats = E.filter(e => e.t === "attribution");
  const entStats = {};
  for (const e of contrats) for (const s of e.entreprises || []) {
    const o = entStats[s] ||= { siren: s, n: 0, copies: 0, clientes: new Set(), montant: 0, deps: {}, y0: "9999", contrats: [] };
    if (isCopy(e)) { o.copies++; continue; }
    o.n++; o.contrats.push(e);
    const b = buyer(e); if (b) o.clientes.add(b);
    if (compte(e)) o.montant += e.montant || 0;
    if (e.dep) o.deps[e.dep] = (o.deps[e.dep] || 0) + 1;
    if (e.date && e.date.slice(0, 4) < o.y0) o.y0 = e.date.slice(0, 4);
  }
  const buyStats = {};
  for (const e of contrats) {
    const b = buyer(e); if (!b) continue;
    const o = buyStats[b] ||= { siren: b, n: 0, montant: 0, ents: new Set(), contrats: [] };
    if (isCopy(e)) continue;
    o.n++; o.contrats.push(e);
    if (e.hors_totaux !== "centrale" && !e.hors_totaux && !e.national) o.montant += e.montant || 0;
    (e.entreprises || []).forEach(s => o.ents.add(s));
  }
  const ACHC = { autre: "autre", etat: "État", bailleur: "bailleur social", intercommunalite: "intercommunalité", commune: "commune", region: "région", sante: "santé", transports: "transports", departement: "département", metropole: "métropole" };
  const buyerCat = s => s === "776056467" ? "centrale d’achat" : ACHC[ACH[s]?.categorie] || ACH[s]?.categorie || "acheteur";
  // a buyer's name: the short one of the mockups, an intercommunality's usual name (« CA … »), else its published name
  const buyerNom = s => (window.NOMS_COURTS || {})[s] || (/^(intercommunalite|metropole)$/.test(ACH[s]?.categorie) && (window.EPCIS || {})[s]) || ACH[s]?.nom || buyerName(s);
  const buyerHref = s => ACH[s]?.categorie === "commune" && ACH[s]?.insee_siege && R.communes[ACH[s].insee_siege] ? `#/commune/${ACH[s].insee_siege}` : `#/acheteur/${s}`;

  // --- links of a document --------------------------------------------------------------------------
  // a prefectoral act opens the Autorisations tab of its commune, anchored on its dossier; anything else, its record
  const docHref = e => e.t.startsWith("arrete") ? (e.insee && R.communes[e.insee] ? `#/commune/${e.insee}/autorisations/${encodeURIComponent(e.affaire)}` : `#/contrat/${encodeURIComponent(e.affaire)}`) : `#/contrat/${encodeURIComponent(e.affaire)}`;

  // badge styles of the kit (§ 4)
  const BS = { con: "background: var(--fg); color: var(--bg)", mod: "background: transparent; color: var(--fg)", ao: "background: var(--ao); color: var(--ao-ink); border-color: var(--ao)",
    aut: "background: var(--aut); color: var(--aut-ink); border-color: var(--aut)", sub: "background: var(--sub); color: var(--sub-ink); border-color: var(--sub)" };
  const TB = { con: "Contrat", ao: "Appel d'offres", aut: "Autorisation", mod: "Modification", sub: "Subvention" };
  const badgeType = e => TB[typ(e)];   // the kit's five badges (§ 4): a result or a correction is an « Appel d'offres », an act an « Autorisation »

  // a date flagged in review: the timelines place the contract at the reading of the review (the record keeps
  // the source's date, flagged « à vérifier », with its note). Mions: the result notice BOAMP 21-16838 gives
  // an award on 5 February 2021, the source says 5 February 2020 (note_relecture).
  const DATE_LUE = { "216902833000132020_32323500~0": "2021-02-05" };
  const dateLue = e => DATE_LUE[e.id] || e.date;
  const LIB = window.LIBELLES || {};
  const court = a => LIB[a]?.court || "";
  const titreAff = (a, e) => LIB[a]?.titre || sent(e?.objet || AFF[a]?.titre || "") || "Objet non publié";

  // articles: « la Métropole de Lyon », « le Rhône »…
  const DEP_ART = { "69": "le Rhône", "13": "les Bouches-du-Rhône", "75": "Paris", "77": "la Seine-et-Marne", "78": "les Yvelines", "91": "l'Essonne", "92": "les Hauts-de-Seine", "93": "la Seine-Saint-Denis", "94": "le Val-de-Marne", "95": "le Val-d'Oise" };
  const depArt = d => DEP_ART[d] || (DEPS[d] ? "le département " + DEPS[d] : "le département");
  const LETTRES = ["zéro", "un", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf", "dix", "onze", "douze"];
  const lettres = n => LETTRES[n] || fr(n);
  const Maj = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;

  // the head of a commune's pages (§ 4 bis): its line, its four tabs, always in the same order
  function tete(insee, cur) {
    const c = R.communes[insee] || { nom: insee, dep: "", pop: 0 }, dn = DL[c.dep] || DEPS[c.dep] || c.dep, en = c.epci ? epciNom(c.epci) : "";
    const L = byInsee[insee] || [];
    const parts = [dn, en, c.pop ? fr(c.pop) + " habitants" : ""].filter(Boolean).join(" · ");
    return { insee, nom: c.nom, dep: c.dep, epci: c.epci, ligne: parts, ligneLongue: parts + " · code INSEE " + insee, ongletsMt: cur === "ess" ? "22px" : "16px",
      onglets: [["ess", "L'essentiel", `#/commune/${insee}`], ["doc", "Documents · " + fr(L.length), `#/commune/${insee}/documents`],
        ["aut", "Autorisations · " + fr(L.filter(isArr).length), `#/commune/${insee}/autorisations`], ["carte", "Carte et drones", `#/commune/${insee}/carte`]]
        .map(([k, l, href]) => ({ l, href, cur: k === cur ? "page" : null })) };
  }
  // the crumbs: Registre › département › (intercommunality on L'essentiel) › commune › tab
  function filCommune(insee, ici) {
    const c = R.communes[insee] || { dep: "" }, f = [{ l: "Registre", href: "#/" }, { l: DL[c.dep] || DEPS[c.dep] || c.dep, href: `#/departement/${c.dep}` }];
    if (!ici && c.epci) f.push({ l: epciNom(c.epci), href: `#/departement/${c.dep}?ic=${c.epci}` });
    if (ici) f.push({ l: c.nom, href: `#/commune/${insee}` });
    return { fil: f, filIci: ici || c.nom };
  }

  // the drone and algorithmic-analysis hours of each site of a commune, between t0 and t1 (ms; null = all):
  // distinct (act, period) pairs, never counted twice for two zones of a site (as the v10 map)
  function heuresSites(insee, t0, t1, kinds = ["drone", "vsa"]) {
    const AUT = (window.AUTORISATIONS || []).filter(a => a.insee.includes(insee) && kinds.includes(a.kind));
    const SIT = new Set((window.SITES || []).filter(x => x.parts?.[insee]).map(x => x.id)), ZID = Object.fromEntries((window.ZONES || []).map(z => [z.id, z]));
    const out = {};
    for (const a of AUT) for (const p of a.periodes) {
      if (t0 != null && !(p.t1 > t0 && p.t0 < t1)) continue;
      const sites = new Set(a.zones.map(id => ZID[id]?.site).filter(s => s && SIT.has(s)));
      for (const s of sites) { const x = out[s] ||= { heures: 0, n: 0, actes: new Set(), seen: new Set() }; const k = `${a.acte}|${p.t0}|${p.t1}`; if (!x.seen.has(k)) { x.seen.add(k); x.heures += p.heures || 0; } x.actes.add(a.acte); x.n = x.actes.size; }
    }
    return out;
  }

  return { PARTAGES, partageTxt, uniq, propre, dateLue, court, titreAff, depArt, lettres, Maj, tete, filCommune, heuresSites, E, AFF, DL, ARRETES_COLLECTES, premierArrete, typ, disp, yGroup, depGroup, isCam, isDrone, isArr, compte, buyer,
    fr, eurK, eurX, fd, fm, fmL, docDate, addM, plur, plain, sent, cam, titre, benef, ent, MOISC, MOISL,
    byInsee, communeStats, communesDep, epciNom, epciCommunes, byDep, depStats, entStats, buyStats, buyerCat, buyerNom, buyerHref,
    docHref, BS, TB, badgeType, MAP_ALL };
})();
