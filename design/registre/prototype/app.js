// Prototype v11: on a phone, the pages of the validated phone mockups (the rest is app11.js and vues/).
// Prototype v8: the validated direction (maquette-direction: Main, Documents, Filtres, Historique,
// Drones) applied to every view of the registre. No network: the registre (window.REG, built by
// scripts/build_registre.py), the commune maps (carte/*.json, fond/*.pmtiles, scripts/carte/couches.py)
// and the drone and algorithmic-analysis zones (zones.js, scripts/drones/zones_v8.py) are local.
// The map is an ES module: the page needs the small local server (ouvrir.sh), never a file:// URL.
"use strict";
const R = window.REG;
const EV = Object.fromEntries(R.evenements.map(e => [e.id, e]));
const SITE = "[adresse du site]";
const TODAY = new Date().toISOString().slice(0, 10);
const CARTE_N = window.CARTE_N || {};          // cameras on the map per commune (OpenStreetMap, ODbL)
const ZONES = window.ZONES || [];
const NATURE = {
  avis: ["Appel d'offres", "ao"], resultat: ["Résultat de l'appel d'offres", "ao"], rectificatif: ["Rectificatif à l'appel d'offres", "ao"],
  attribution: ["Contrat signé", "con"], modification: ["Contrat modifié", "con"],
  arrete: ["Autorisation de la préfecture", "aut"], arrete_drone: ["Autorisation de drones", "aut"],
  arrete_pietons: ["Autorisation de caméras-piétons", "aut"], arrete_vsa: ["Autorisation d'analyse algorithmique des images", "aut"],
  subvention_region: ["Subvention de la Région", "sub"], subvention_etat: ["Subvention de l'État", "sub"],
};
const EMETTEUR = { avis: "BOAMP (DILA)", resultat: "BOAMP (DILA)", rectificatif: "BOAMP (DILA)",
  attribution: "Données de la commande publique (data.gouv.fr)", modification: "Données de la commande publique (data.gouv.fr)", subvention_region: "Région", subvention_etat: "Préfecture" };
const DISPOSITIFS = { videoprotection: "vidéoprotection", csu: "centre de supervision", vsa: "analyse algorithmique des images", lapi: "lecture de plaques (LAPI)",
  pietons: "caméras-piétons", verbalisation: "vidéoverbalisation", drone: "drones" };
// département names (geo.api.gouv.fr, data/raw/geo/departements.json.gz), all of France
const DEPS = { ...{"01":"Ain","02":"Aisne","03":"Allier","04":"Alpes-de-Haute-Provence","05":"Hautes-Alpes","06":"Alpes-Maritimes","07":"Ardèche","08":"Ardennes","09":"Ariège","10":"Aube","11":"Aude","12":"Aveyron","13":"Bouches-du-Rhône","14":"Calvados","15":"Cantal","16":"Charente","17":"Charente-Maritime","18":"Cher","19":"Corrèze","21":"Côte-d'Or","22":"Côtes-d'Armor","23":"Creuse","24":"Dordogne","25":"Doubs","26":"Drôme","27":"Eure","28":"Eure-et-Loir","29":"Finistère","2A":"Corse-du-Sud","2B":"Haute-Corse","30":"Gard","31":"Haute-Garonne","32":"Gers","33":"Gironde","34":"Hérault","35":"Ille-et-Vilaine","36":"Indre","37":"Indre-et-Loire","38":"Isère","39":"Jura","40":"Landes","41":"Loir-et-Cher","42":"Loire","43":"Haute-Loire","44":"Loire-Atlantique","45":"Loiret","46":"Lot","47":"Lot-et-Garonne","48":"Lozère","49":"Maine-et-Loire","50":"Manche","51":"Marne","52":"Haute-Marne","53":"Mayenne","54":"Meurthe-et-Moselle","55":"Meuse","56":"Morbihan","57":"Moselle","58":"Nièvre","59":"Nord","60":"Oise","61":"Orne","62":"Pas-de-Calais","63":"Puy-de-Dôme","64":"Pyrénées-Atlantiques","65":"Hautes-Pyrénées","66":"Pyrénées-Orientales","67":"Bas-Rhin","68":"Haut-Rhin","69":"Rhône","70":"Haute-Saône","71":"Saône-et-Loire","72":"Sarthe","73":"Savoie","74":"Haute-Savoie","75":"Paris","76":"Seine-Maritime","77":"Seine-et-Marne","78":"Yvelines","79":"Deux-Sèvres","80":"Somme","81":"Tarn","82":"Tarn-et-Garonne","83":"Var","84":"Vaucluse","85":"Vendée","86":"Vienne","87":"Haute-Vienne","88":"Vosges","89":"Yonne","90":"Territoire de Belfort","91":"Essonne","92":"Hauts-de-Seine","93":"Seine-Saint-Denis","94":"Val-de-Marne","95":"Val-d'Oise","971":"Guadeloupe","972":"Martinique","973":"Guyane","974":"La Réunion","976":"Mayotte"}, "75": "Paris", "69": "Rhône", "13": "Bouches-du-Rhône", "91": "Essonne", "92": "Hauts-de-Seine", "93": "Seine-Saint-Denis", "94": "Val-de-Marne",
  "95": "Val-d'Oise", "77": "Seine-et-Marne", "78": "Yvelines", "73": "Savoie", "74": "Haute-Savoie", "38": "Isère", "36": "Indre" };
const $ = s => document.querySelector(s);
// the display font has no narrow no-break space (U+202F): a plain no-break space instead
const nb = s => String(s).replace(/\u202f/g, "\u00a0");
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmtD = d => { if (!d) return ""; const [y, m, j] = d.split("-"); return j ? `${j}/${m}/${y}` : d; };
const eur = v => v == null ? "" : nb(v >= 1e6 ? `${(v / 1e6).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} M€` : `${Math.round(v).toLocaleString("fr-FR").replace(/\u202f/g, "\u00a0")} €`);
const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const MC = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const moisAn = d => `${MOIS[+d.slice(5, 7) - 1]} ${d.slice(0, 4)}`;
const MoisAn = d => { const s = moisAn(d); return s[0].toUpperCase() + s.slice(1); };
const jourMois = d => `${+d.slice(8, 10) === 1 ? "1er" : +d.slice(8, 10)} ${MC[+d.slice(5, 7) - 1]}`;
const longDate = d => `${+d.slice(8, 10) === 1 ? "1er" : +d.slice(8, 10)} ${MOIS[+d.slice(5, 7) - 1]} ${d.slice(0, 4)}`;
const nat = e => (NATURE[e.t] || [e.t, "ao"])[0];
const kindOf = e => (NATURE[e.t] || ["", "ao"])[1];
const year = e => (e.date || "").slice(0, 4);
const affaire = id => R.affaires[id];
const commune = c => R.communes[c] || { nom: c, dep: (c || "").slice(0, 2), pop: 0 };
const plural = (n, s, p = s + "s") => `${nb(n.toLocaleString("fr-FR").replace(/\u202f/g, "\u00a0"))} ${n > 1 ? p : s}`;
const decY = d => +d.slice(0, 4) + (+d.slice(5, 7) - 1) / 12 + (+(d.slice(8, 10) || 1) - 1) / 365;
const addMonths = (d, m) => { const x = new Date(d + "T12:00:00Z"); x.setUTCMonth(x.getUTCMonth() + Math.round(m)); return x.toISOString().slice(0, 10); };
const monthsBetween = (a, b) => Math.round((decY(b) - decY(a)) * 12);
const sign = d => d > 0 ? `+${d}` : d < 0 ? `−${-d}` : "±0";
const ELECTIONS = R.mandats.map(m => ({ date: m.second_tour, label: moisAn(m.second_tour) }));
const ELUS = "https://www.data.gouv.fr/datasets/repertoire-national-des-elus-1";
const PILOTE = new Set(["75", "69", "13", "77", "78", "91", "92", "93", "94", "95"]);
const COUV = { region: new Set(["75", "77", "78", "91", "92", "93", "94", "95", "13"]), etat: new Set(["69", "13"]), arretes: new Set(["69"]) };
const dossierNo = id => { const n = String(id).split("-").slice(1).join("-"); return /^\d{8}$/.test(n) ? `${n.slice(0, 4)}-${n.slice(4)}` : n; };
// display only: spaces and apostrophes lost by the source; exports keep the original text
const tidy = t => String(t ?? "").replace(/[\u0092`´']/g, "’").replace(/[\u0096\u0097]/g, "–").replace(/\b([DLdl]|QU|qu|[Jj]) (?=[AEIOUYÉÈÊÂHaeiouyéèêâh])/g, "$1’").replace(/\bD(UNE?) (?=(?:SYST|DISPOSITIF|R[EÉ]SEAU|PARC|MARCH[EÉ]|CENTRE|LOGICIEL|ENSEMBLE|OUTIL|[EÉ]QUIPEMENT|SOLUTION|INSTALLATION|PLATE|PRESTATION)[A-ZÉÈ]*)/g, "D’$1 ")
  .replace(/\s+/g, " ").trim();
// a title in capitals, or a long one, is written in lower case (sentence case)
const calm = t => { const s = tidy(t).replace(/,(?=\S)/g, ", "); const caps = s.replace(/[^A-Za-zÀ-ÿ]/g, ""); return caps && (caps === caps.toUpperCase() || s.length > 70) ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s; };
const DEV = /[?&]dev=1\b/.test(location.search + location.hash);
const devTag = t => DEV ? ` <span class="dev">${t}</span>` : "";
const HORS = { centrale: "plafond pour d'autres acheteurs", a_verifier: "montant à vérifier", mixte_surete: "contrat vidéo + alarmes des bâtiments", mixte_autres: "contrat vidéo + autres services" };
const horsRaison = e => e.national && !e.hors_totaux ? "acheteur national" : HORS[e.hors_totaux] || "";
const glo = (id, txt = "c'est quoi ?") => `<a href="#/glossaire#${id}">${txt}</a>`;
// the site's map on a commune: the production address (site.js) with ?insee=, else a placeholder dialog
const siteLink = (insee, txt, cls = "ghost") => window.SITE_URL ? `<a class="${cls}" href="${esc(window.SITE_URL)}/?insee=${insee}">${txt}</a>` : `<a class="${cls}" href="#" data-site="${insee}">${txt}</a>`;

// a name in capitals is shown in title case (display only; « T.I.C. » and « SA » kept)
// 11th pass: the small words in lower case after the first word (« Compagnie des Signaux »)
const CASSE_PETITS = new Set(["DE", "DES", "DU", "LA", "LE", "LES", "ET", "EN", "AUX", "AU", "SUR", "SOUS"]);
const casse = n => n === n.toUpperCase() && /[A-Z]{4}/.test(n) ? n.split(/(\s+|-)/).map((w, i) => i && CASSE_PETITS.has(w) ? w.toLowerCase() : /\.|^(SA|SAS|SARL|SNC|EI|II|III)$/.test(w) || w.length < 2 ? w : w.charAt(0) + w.slice(1).toLowerCase()).join("") : n;
function entName(s) {
  const x = R.entreprises[s];
  if (!x) return `entreprise SIREN ${s}`;
  if (x.entrepreneur_individuel) return `entrepreneur individuel (SIREN ${s})`;
  return x.nom ? casse(x.nom) : `entreprise SIREN ${s}`;
}
const entLink = s => `<a href="#/entreprise/${s}">${esc(entName(s))}</a>`;
// buyers (scripts/acheteurs/build_acheteurs.py): proper names, category, communes covered
const ACH = window.ACHETEURS || {};
const buyerOf = e => e.acheteur_siren || affaire(e.affaire)?.acheteur_siren || null;
const communeOfBuyer = s => ACH[s]?.categorie === "commune" ? ACH[s].insee_siege : null;
const buyerName = s => ACH[s]?.nom || (s ? `acheteur SIREN ${s}` : "acheteur non publié");
const comLink = (insee, label) => insee && R.communes[insee] ? `<a href="#/commune/${insee}">${esc(label || commune(insee).nom)}</a>` : esc(label || "");
function buyerLink(s, ctx = {}) {
  if (!s) return "acheteur non publié";
  const ci = communeOfBuyer(s);
  if (ci && ctx.page === "commune" && ctx.insee === ci) return "la mairie";
  if (ci) return comLink(ci, buyerName(s));
  return `<a href="#/acheteur/${s}">${esc(buyerName(s))}</a>`;
}
// « acheteur → entreprise(s) », every name a link; the place of the document when the page is not its commune's
// the commune of a document: its own, else its buyer's seat (said), else Paris for the police prefecture
function lieu(e) {
  if (e.insee && R.communes[e.insee]) return [e.insee, "à"];
  const la = (window.LIEUX_AVIS || {})[e.id];
  if (la && R.communes[la]) return [la, "acheteur à"];
  const s = buyerOf(e), si = s && ACH[s]?.insee_siege;
  if (si && R.communes[si]) return [si, "siège à"];
  if (e.communes_multi?.[0] && R.communes[e.communes_multi[0]]) return [e.communes_multi[0], "à"];
  if (e.dep === "75") return ["75056", "à"];
  // « Mairie de X », « Ville de X », « Commune de X »: the commune named by the buyer, in its département
  const m = /^(?:mairie|ville|commune)\s+(?:de\s+|d['’]\s*)(.+)$/i.exec(tidy(e.acheteur || "")), pn = m && plainTxt(m[1]);
  if (pn) { const hit = Object.entries(R.communes).find(([k, c]) => c.dep === e.dep && (plainTxt(c.nom) === pn || plainTxt(c.nom).startsWith(pn + " "))); if (hit) return [hit[0], "acheteur à"]; }
  return [null, ""];
}
function whoLinks(e, ctx = {}) {
  const [li, how] = lieu(e), here = ctx.page === "commune" && ctx.insee === li;
  // no commune published: the département, said as such (never a commune made up)
  const place = !here && li ? ` · ${how} ${comLink(li)}` : !li && e.dep && DEPS[e.dep] ? ` · <a href="#/departement/${e.dep}" class="dep">${esc(DEPS[e.dep])}, commune non publiée</a>` : "";
  if (e.t.startsWith("arrete")) {
    // a private beneficiary has no page of its own: its name opens the history of its authorisation
    const com = isCommunal(e), b = com ? (here ? "la mairie" : comLink(e.insee, e.type_beneficiaire === "epci" ? benefLabel(e) : `Mairie de ${commune(e.insee).nom}`)) : `<a href="#/affaire/${encodeURIComponent(e.affaire)}">${esc(benefLabel(e))}</a>`;
    return `${esc(emetteur(e))} → ${b}${com ? (here ? "" : "") : place}${e.arrondissement ? ` · ${esc(e.arrondissement)}` : ""}`;
  }
  if (e.t.startsWith("subvention")) return `${esc(emetteur(e))} → ${here ? "la mairie" : comLink(e.insee)}`;
  const s = buyerOf(e), buyer = buyerLink(s, ctx), atHome = communeOfBuyer(s) === li && ctx.page !== "entreprise" && ctx.page !== "explorer";
  const ents = (e.entreprises || []).filter(x => !(ctx.page === "entreprise" && x === ctx.siren));
  const to = ents.length ? ` → ${ents.map(entLink).join(", ")}` : ctx.page === "entreprise" ? "" : (e.t === "attribution" || e.t === "modification") ? " → entreprise non publiée" : e.t === "avis" ? ` · <span class="objet">${esc(calm(e.objet || "").toLowerCase().slice(0, 90))}</span>` : "";
  return `${buyer}${to}${ctx.page === "entreprise" && (e.entreprises || []).length > 1 ? " (avec d'autres entreprises)" : ""}${atHome ? "" : place}`;
}
function emetteur(e) {
  if (e.publie_par) return e.publie_par.charAt(0).toUpperCase() + e.publie_par.slice(1);
  if (e.t.startsWith("arrete")) return e.dep === "69" ? "Préfecture du Rhône" : e.dep === "75" ? "Préfecture de police" : e.dep === "13" ? "Préfecture de police des Bouches-du-Rhône" : "Préfecture";
  if (e.t === "subvention_region") return e.dep === "13" ? "Région Sud" : "Région Île-de-France";
  return EMETTEUR[e.t] || "";
}
function benefLabel(e) {
  if (e.beneficiaire === "[non retenu]") return "commerce ou entreprise (nom masqué)";
  if (e.beneficiaire === "[non précisé]") return "non précisé dans l'arrêté";
  return casse(tidy(e.beneficiaire || ""));
}
function isCommunal(e) {
  if (e.t.startsWith("subvention")) return true;
  if (e.t.startsWith("arrete")) return /^commune|epci/.test(e.type_beneficiaire || "") || e.t === "arrete_pietons";
  return affaire(e.affaire)?.acheteur_communal ?? true;
}
const NO_CHANGE = "aucun changement publié : montant, durée et entreprises identiques ; la nature de la modification n'est pas publiée";
const counts = (e, f = {}) => e.t === "attribution" && !(e.national && f.territorial)
  && (!e.hors_totaux || (e.hors_totaux === "mixte_surete" && f.mixtes_surete) || (e.hors_totaux === "mixte_autres" && f.mixtes_autres));
const dateLabel = e => e.date_annee ? `${year(e)}, date non précisée` : fmtD(e.date);
const sortKey = e => e.date_annee ? `${year(e)}-00-00` : (e.date || "");
const byDateDesc = (a, b) => sortKey(b).localeCompare(sortKey(a));
const byDateAsc = (a, b) => sortKey(a).localeCompare(sortKey(b));
const nCartes = insee => CARTE_N[insee] ?? null;
const PHOTO = e => /photo|exercice/.test(e.nature_vol || "");
const NATVOL = { video: "vidéo", "photographies aeriennes": "photographies aériennes, pas de la vidéo", exercice: "prises de vues pour un exercice" };

// « i »: a real button next to the title it explains; it opens a short text just below, then closes it
let _ib = 0;
function ib(text, label = "Comment lire") {
  const id = `ib-${++_ib}`;
  return { btn: `<button type="button" class="ib" aria-expanded="false" aria-controls="${id}" aria-label="${esc(label)}"><span aria-hidden="true">i</span></button>`, box: `<div class="infobox" id="${id}" hidden>${text}</div>` };
}
document.addEventListener("click", ev => { const b = ev.target.closest("button.ib"); if (!b) return; const open = b.getAttribute("aria-expanded") !== "true", box = document.getElementById(b.getAttribute("aria-controls")); b.setAttribute("aria-expanded", String(open)); if (box) box.hidden = !open; });
const titleI = (tag, id, title, text, cls = "h2") => { const i = ib(text); return `<div class="tline"><${tag} id="${id}" class="${cls}">${title}</${tag}>${i.btn}</div>${i.box}`; };
// the strip: a fixed two-line band above a map (64 px); never moves the page
const stripHTML = (id, l1, l2) => `<div class="strip" id="${id}" aria-live="polite"><b>${l1}</b><span>${l2}</span></div>`;
const setStrip = (el, l1, l2) => { if (!el) return; el.innerHTML = `<b>${l1}</b><span>${l2}</span>`; };

// --- the commune: what we know ---------------------------------------------------------------
// 12th pass: the commune's documents include the acts it shares with other communes (D11.byInsee)
function rowsOfCommune(insee) { return (window.D11 ? (D11.byInsee[insee] || []).slice() : R.evenements.filter(e => e.insee === insee)).sort(byDateDesc); }
function lastArretes(rows) {
  const last = {};
  rows.filter(e => e.t === "arrete" && e.cameras != null).forEach(e => { if (!last[e.affaire] || last[e.affaire].date < e.date) last[e.affaire] = e; });
  return Object.values(last);
}
function ess(insee) {
  const c = commune(insee), all = rowsOfCommune(insee), mine = all.filter(isCommunal);
  const arr = lastArretes(all), com = arr.filter(isCommunal).sort((a, b) => b.cameras - a.cameras), prv = arr.filter(e => !isCommunal(e));
  const contrats = mine.filter(e => e.t === "attribution").sort(byDateAsc);
  const counted = contrats.filter(e => !e.hors_totaux && !e.national && !isCopy(e)), excluded = contrats.filter(e => (e.hors_totaux || e.national) && !isCopy(e));
  const subs = all.filter(e => e.t.startsWith("subvention"));
  const aosPending = Object.values(R.affaires).filter(a => a.insee === insee && a.kind === "contrat_non_retrouve" && !a.contrat_probable && a.debut >= addMonths(TODAY, -18)
    && a.events.some(i => EV[i].t === "avis")).sort((a, b) => a.debut.localeCompare(b.debut));
  return {
    c, insee, all, mine, com, prv, contrats, counted, excluded, subs, aosPending,
    // street cameras: only when every act of the mairie gives the number (else said, not summed as a whole)
    camAut: com.reduce((s, e) => s + e.cameras, 0), vpAut: com.length && com.every(e => e.cameras_vp != null) ? com.reduce((s, e) => s + e.cameras_vp, 0) : null,
    vpPart: com.filter(e => e.cameras_vp != null),
    // « complete »: at most 3 dossiers of the mairie, each giving its street cameras (else: partial, not compared)
    complet: com.length > 0 && com.length <= 3 && com.every(e => e.cameras_vp != null),
    autresAcheteurs: all.filter(e => e.t === "attribution" && !isCommunal(e)),
    dateAut: com.map(e => e.date).sort().pop(), n: nCartes(insee), eur: counted.reduce((s, e) => s + (e.montant || 0), 0),
    arretesCollectes: COUV.arretes.has(c.dep), hors: !PILOTE.has(c.dep) && !all.some(e => e.publie_par),
    autres: all.filter(e => /^arrete_(drone|vsa)$/.test(e.t)),
  };
}
const qui = e => e.type_beneficiaire === "epci" ? "à l'intercommunalité" : "à la mairie de";
function phrase(s) {
  const { c } = s, out = [];
  if (s.hors) out.push(`Hors de la zone collectée : à ${esc(c.nom)}, seuls les contrats d'Alphaiota sont recensés.`);
  if (s.camAut && !s.complet) {
    // the collection does not cover every dossier: said first, never compared with the map
    out.push(`Arrêtés publiés depuis novembre 2025 : ${plural(s.com.length, "dossier")} de la mairie, <strong>${plural(s.camAut, "caméra")}</strong>. Ce n'est pas le total de la ville.`);
  } else if (s.camAut) {
    const k = s.com.length, q = s.com[0].type_beneficiaire === "epci" ? "à l'intercommunalité" : `à la mairie de ${esc(c.nom)}`;
    let p = `En ${moisAn(s.dateAut)}, la préfecture ${k > 1 ? "avait" : "a"} autorisé <strong>${plural(s.camAut, "caméra")}</strong> ${q}${k > 1 ? `, dans ${k} dossiers` : ""}.`;
    if (s.vpAut != null) p += ` <strong>${s.vpAut.toLocaleString("fr-FR").replace(/\u202f/g, "\u00a0")}</strong> filment la rue.`;
    else if (s.vpPart.length) p += ` ${s.vpPart.reduce((t, e) => t + e.cameras_vp, 0)} filment la rue, d'après ${s.vpPart.length > 1 ? `les ${s.vpPart.length} arrêtés` : "le seul arrêté"} sur ${k} qui le ${s.vpPart.length > 1 ? "précisent" : "précise"}.`;
    const pub = (window.CARTE_PUB || {})[s.insee];
    if (pub != null) p += ` La carte en connaît <strong>${pub.toLocaleString("fr-FR").replace(/\u202f/g, "\u00a0")}</strong> publique${pub > 1 ? "s" : ""}.`;
    out.push(p);
  } else if (s.counted.length || s.excluded.length) {
    const y = year((s.counted[0] || s.excluded[0]));
    let p = s.counted.length ? `Depuis ${y}, ${esc(c.nom)} a signé <strong>${plural(s.counted.length, "contrat")}</strong> de vidéosurveillance, pour <strong>${eur(s.eur)}</strong> au maximum.`
      : `${esc(c.nom)} a signé ${plural(s.excluded.length, "contrat")} de vidéosurveillance dont le montant reste hors des totaux (${esc(horsRaison(s.excluded[0]))}).`;
    if (s.n != null) p += ` La carte connaît <strong>${s.n.toLocaleString("fr-FR").replace(/\u202f/g, "\u00a0")}</strong> caméra${s.n > 1 ? "s" : ""}.`;
    out.push(p);
  } else if (s.subs.length) {
    out.push(`${esc(c.nom)} a obtenu ${plural(s.subs.length, "subvention")} pour ${plural(s.subs.reduce((t, e) => t + (e.cameras || 0), 0), "caméra")} depuis ${year(s.subs[s.subs.length - 1])}.${s.n != null ? ` La carte connaît <strong>${s.n}</strong> caméra${s.n > 1 ? "s" : ""}.` : ""}`);
  } else if (!s.all.length) {
    out.push(`Aucun document trouvé pour ${esc(c.nom)} dans les sources collectées.${s.n != null ? (s.n ? ` La carte connaît <strong>${s.n}</strong> caméra${s.n > 1 ? "s" : ""}.` : " La carte n'en connaît aucune.") : ""}`);
  } else out.push(`${plural(s.all.length, "document")} trouvé${s.all.length > 1 ? "s" : ""} pour ${esc(c.nom)}.${s.n != null ? ` La carte connaît <strong>${s.n}</strong> caméra${s.n > 1 ? "s" : ""}.` : ""}`);
  if (!s.arretesCollectes && !s.hors) out.push(c.dep === "75" ? "Les autorisations de la préfecture de police ne sont pas encore collectées." : "Les autorisations de la préfecture ne sont pas encore collectées pour ce département.");
  return out.map((p, i) => `<p class="phrase">${p}</p>`).join("");
}

// --- blocks of « L'essentiel » ------------------------------------------------------------------
function blocCarte(s) {
  const { c, insee } = s;
  if (s.n == null) return `<section class="blk" aria-labelledby="s-vue"><h2 id="s-vue" class="h2">La carte de ${esc(c.nom)}</h2>
    <p class="why">La carte de cette commune n'est pas encore découpée dans ce prototype : elle le sera pour toutes les communes du site.</p></section>`;
  const title = s.n ? `Ce que filment les ${s.n.toLocaleString("fr-FR").replace(/\u202f/g, "\u00a0")} caméras placées` : "Aucune caméra n'est encore placée sur la carte";
  const drones = s.autres.length || (window.SITES || []).some(z => z.parts?.[insee]);
  const iV = ib("Caméras relevées par des contributeurs OpenStreetMap (ODbL), pas un inventaire officiel. Champs de vision et rues filmées calculés par la carte du site. À l'échelle de la commune : les rues filmées ; en zoomant, les caméras, puis leurs champs de vision.", "Comment lire la carte");
  return `<section class="blk" aria-labelledby="s-vue"><div class="tline"><h2 id="s-vue" class="h2">${title}</h2>${iV.btn}</div>${iV.box}
    <div class="c3" id="carte" data-label="Carte inclinée de ${esc(c.nom)}, découpée sur la commune, qui tourne lentement : en rose, les champs de vision des caméras placées et les rues qu'elles filment. Deux doigts ou la souris la font tourner ; les boutons l'arrêtent ou remettent le nord en haut."></div>
    <div class="legend"><span><span class="sw-rue" aria-hidden="true"></span>rue filmée</span><span class="muted">en zoomant :</span><span><span class="sw-cam" aria-hidden="true"></span>caméra</span><span><span class="sw-fov" aria-hidden="true"></span>champ de vision</span></div>
    <div class="ghosts">${siteLink(insee, `Ouvrir la carte de ${esc(c.nom)} →`)}${drones ? `<a class="ghost" href="#/commune/${insee}/carte">Drones et analyse algorithmique →</a>` : ""}</div></section>`;
}
function blocAutres(s) {
  // compared with the public cameras of the map only (operator public), never with all of them
  const pub = (window.CARTE_PUB || {})[s.insee];
  if (!s.complet || s.vpAut == null || pub == null || pub >= s.vpAut) return "";
  const k = s.vpAut - pub;
  return `<section class="pinkcard" aria-labelledby="s-ou"><h2 id="s-ou" class="h2">Où sont les ${k.toLocaleString("fr-FR").replace(/\u202f/g, "\u00a0")} autres ?</h2>
    <p>${plural(s.vpAut, "caméra")} de la mairie autorisées sur la rue ; ${plural(pub, "caméra publique", "caméras publiques")} sur la carte. La mairie peut en donner la liste.</p>
    <button type="button" class="btn-pink" data-demande="la liste des emplacements des caméras de vidéoprotection installées sur la voie publique (adresse ou carte), telle qu'autorisée par l'arrêté préfectoral du ${fmtD(s.dateAut)}" data-qui="mairie" data-insee="${s.insee}">Demander la liste à la mairie</button>
    <p id="ici" hidden>Vous êtes à ${esc(s.c.nom)} en ce moment ? ${siteLink(s.insee, "Ajoutez celles que vous voyez", "")}.</p></section>`;
}
const IC = {
  verb: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="4" y="3" width="16" height="18"></rect><path d="M8 8h8M8 12h8M8 16h5"></path></svg>',
  trans: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 12h12M12 6l6 6-6 6"></path><path d="M20 4v16"></path></svg>',
  cal: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="5" width="18" height="16"></rect><path d="M3 10h18M8 3v4M16 3v4"></path></svg>',
};
function histLink(a) {
  const pts = (a.cameras || []).filter(p => p.n != null && !p.groupe).map(p => p.n);
  const seq = pts.length > 5 ? [pts[0], "…", pts[pts.length - 1]] : pts;
  return `<a class="ghost" href="#/affaire/${encodeURIComponent(a.id)}">${pts.length > 1 ? `Historique : ${seq.join(" → ")} caméras` : "Historique de l'autorisation"} →</a>`;
}
function blocAutorise(s) {
  const { c } = s, h = `<h2 id="s-aut" class="h2">Ce que la préfecture autorise</h2>`;
  if (!s.arretesCollectes) return "";   // said once, in the sentence at the top
  if (!s.com.length) return `<section class="blk" aria-labelledby="s-aut">${h}<p class="why">Aucun arrêté pour les caméras de la mairie dans les 12 mois collectés (novembre 2025 à octobre 2026).</p></section>`;
  const last = s.com[0], a = affaire(last.affaire), more = s.com.length > 1 ? `<p class="note">Dossier principal (${plural(last.cameras, "caméra")}) ; ${s.com.length - 1} autre${s.com.length > 2 ? "s" : ""} dossier${s.com.length > 2 ? "s" : ""} dans les documents.</p>` : "";
  const src = a?.echeance_source ? EV[a.echeance_source] : null;
  return `<section class="blk" aria-labelledby="s-aut">${h}<ul class="facts">
    <li>${IC.verb}<span>${last.videoverbalisation ? "<strong>Verbaliser grâce aux caméras</strong><br>des amendes peuvent être dressées à partir des images." : `<strong>Verbalisation par caméra</strong><br><span class="abs">non mentionnée dans l'arrêté.</span>`}</span></li>
    <li>${IC.trans}<span>${last.deport_forces ? "<strong>Transmettre les images</strong><br>à la police ou à la gendarmerie." : `<strong>Transmission des images à la police ou à la gendarmerie</strong><br><span class="abs">non mentionnée dans l'arrêté.</span>`}</span></li>
    <li>${IC.cal}<span>${a?.echeance ? `<strong>Jusqu'au ${longDate(a.echeance)}</strong><br>durée de ${esc(src?.duree || "")} inscrite dans l'arrêté${src && src.id !== a.events[a.events.length - 1] ? ` du ${fmtD(src.date)}` : ""}.` : `<strong>Date de fin</strong><br><span class="abs">non précisée dans l'arrêté.</span>`}</span></li>
  </ul>${more}${a ? histLink(a) : ""}</section>`;
}
// lots of one tender (same buyer, same date, same companies: faits.py, window.LOTS) shown as one contract « N lots »
// a contract published twice (same number, same amount: faits.py « doublon ») counts once; lots add up
const GROUPES = window.LOTS_GROUPES || {};
const isCopy = e => { const g = GROUPES[(window.LOTS || {})[e.affaire]]; return !!(g && g.nature === "doublon" && g.membres?.[0]?.affaire !== e.affaire); };
function mergeLots(cs) {
  const L = window.LOTS || {}, key = e => L[e.affaire] || e.affaire, by = new Map();
  cs.forEach(e => { const k = key(e); if (!by.has(k)) by.set(k, []); by.get(k).push(e); });
  return [...by.entries()].map(([k, es]) => { if (es.length === 1) return es[0]; const g = GROUPES[k];
    return g?.nature === "doublon" ? { ...es[0], copies: es.length } : { ...es[0], montant: es.reduce((t, e) => t + (e.montant || 0), 0), lots: es }; });
}
const entLinks = e => e.entreprises?.length ? e.entreprises.map(entLink).join(", ") : "entreprise non publiée";
function frise(csRaw, aos) {
  const cs = mergeLots(csRaw), items = cs.slice(-8), older = cs.length - items.length;
  if (!items.length && !aos.length) return "";
  const ends = items.map(e => e.duree ? addMonths(e.date, e.duree) : null);
  const y0 = Math.floor(Math.min(...items.map(e => decY(e.date)), ...aos.map(a => decY(a.debut)))), y1 = Math.max(Math.ceil(decY(TODAY) + 0.6), ...ends.filter(Boolean).map(d => Math.ceil(decY(d))));
  const X = d => ((decY(d) - y0) / (y1 - y0) * 100).toFixed(2), now = X(TODAY);
  const names = e => e.entreprises?.length ? e.entreprises.map(entName).map(tidy).join(", ") : "entreprise non publiée";
  let alt = [], h = `<div class="frise"><p class="sr-only">ALT</p><div class="auj" style="left:calc(12px + (100% - 24px) * ${now / 100})"></div>`;
  items.forEach((e, i) => {
    const end = ends[i], out = !!(e.hors_totaux || e.national), k = cs.length - items.length + i + 1;
    const a = X(e.date), b = end ? X(end) : now;
    const note = e.note_relecture ? ` <span class="datecheck">date à vérifier</span>` : "";
    h += `<div class="ln"><div class="top-l"><span><strong>Contrat ${k}</strong>${e.lots ? ` · ${e.lots.length} lots` : e.copies ? ` · publié ${e.copies} fois` : ""} · ${entLinks(e)}</span><strong>${eur(e.montant)}${out ? "*" : ""}</strong></div>
      <div class="bar"><a class="${out ? "out" : "on"}" href="#/affaire/${encodeURIComponent(e.affaire)}" aria-label="Historique du contrat ${k}" style="left:${a}%;width:${Math.max(0.8, b - a).toFixed(2)}%"></a>${end ? "" : `<span class="open" style="left:${now}%;right:0"></span>`}</div>
      <span class="tw muted" style="font-size:13px">${MC[+e.date.slice(5, 7) - 1]} ${e.date.slice(0, 4)} → ${end ? `${MC[+end.slice(5, 7) - 1]} ${end.slice(0, 4)} · ${e.duree} mois` : "fin à lire dans le contrat"}${note}${out ? ` · hors total : ${esc(horsRaison(e))}` : ""}</span></div>`;
    alt.push(`Contrat ${k} avec ${names(e)} : ${eur(e.montant)} au maximum, de ${moisAn(e.date)} ${end ? `à ${moisAn(end)}` : ", date de fin à lire"}${out ? `, hors du total (${horsRaison(e)})` : ""}.`);
  });
  aos.forEach(a => {
    h += `<div class="ln"><div class="top-l"><span><strong>Appel d'offres</strong> · ${moisAn(a.debut)}</span><strong>?</strong></div>
      <div class="bar"><span class="ao" style="left:calc(${X(a.debut)}% - 8px)"></span></div><span class="tw muted" style="font-size:13px">nouveau contrat pas encore publié</span></div>`;
    alt.push(`${MoisAn(a.debut)} : appel d'offres, contrat pas encore publié.`);
  });
  const step = Math.max(1, Math.ceil((y1 - y0) / 4)), ticks = [];
  for (let y = y0 + (y1 - y0 > 4 ? 1 : 0); y < y1; y += step) if (Math.abs((y - y0) / (y1 - y0) * 100 - now) > 9) ticks.push(`<span style="left:${((y - y0) / (y1 - y0) * 100).toFixed(1)}%">${y}</span>`);
  h += `<div class="axis tw" aria-hidden="true">${ticks.join("")}<span class="now" style="left:${now}%">auj.</span></div></div>`;
  if (older) h += `<p class="why" style="margin:0;font-size:14px">${plural(older, "contrat plus ancien", "contrats plus anciens")} dans les documents.</p>`;
  return h.replace("ALT", esc(alt.join(" ")));
}
// from 6 contracts: one line per company, its contracts as bars on the common scale (who followed whom)
function friseEnt(csRaw, aos) {
  const cs = mergeLots(csRaw), by = {}; cs.forEach(e => { const k = e.entreprises?.[0] || "?"; (by[k] ||= []).push(e); });
  const lines = Object.entries(by).sort((a, b) => a[1][0].date.localeCompare(b[1][0].date));
  const ends = cs.map(e => e.duree ? addMonths(e.date, e.duree) : null);
  const y0 = Math.floor(Math.min(...cs.map(e => decY(e.date)), ...aos.map(a => decY(a.debut)))), y1 = Math.max(Math.ceil(decY(TODAY) + 0.6), ...ends.filter(Boolean).map(d => Math.ceil(decY(d))));
  const X = d => ((decY(d) - y0) / (y1 - y0) * 100).toFixed(2), now = X(TODAY), alt = [];
  let h = `<div class="frise"><p class="sr-only">ALT</p><div class="auj" style="left:calc(12px + (100% - 24px) * ${now / 100})"></div>`;
  for (const [k, es] of lines) {
    const name = k === "?" ? "entreprise non publiée" : tidy(entName(k)), sum = es.filter(e => !e.hors_totaux && !e.national).reduce((t, e) => t + (e.montant || 0), 0);
    h += `<div class="ln"><div class="top-l"><span><strong>${k === "?" ? esc(name) : `<a href="#/entreprise/${k}">${esc(name)}</a>`}</strong> · ${plural(es.length, "contrat")}</span><strong>${eur(sum)}</strong></div>
      <div class="bar">${es.map(e => { const a = X(e.date), end = e.duree ? addMonths(e.date, e.duree) : null, b = end ? X(end) : now, out = e.hors_totaux || e.national;
        return `<a class="${out ? "out" : "on"}" href="#/affaire/${encodeURIComponent(e.affaire)}" aria-label="${esc(`Historique du contrat de ${moisAn(e.date)}, ${eur(e.montant)}${e.lots ? `, ${e.lots.length} lots` : ""}`)}" style="left:${a}%;width:${Math.max(0.8, b - a).toFixed(2)}%"></a>${end ? "" : `<span class="open" style="left:${b}%;width:2%"></span>`}`; }).join("")}</div>
      <span class="tw muted" style="font-size:13px">${es.map(e => year(e)).filter((v, i, a) => a.indexOf(v) === i).join(", ")}</span></div>`;
    alt.push(`${name} : ${es.length} contrats, de ${year(es[0])} à ${year(es[es.length - 1])}, ${eur(sum)} au maximum.`);
  }
  aos.forEach(a => { h += `<div class="ln"><div class="top-l"><span><strong>Appel d'offres</strong> · ${moisAn(a.debut)}</span><strong>?</strong></div><div class="bar"><span class="ao" style="left:calc(${X(a.debut)}% - 8px)"></span></div><span class="tw muted" style="font-size:13px">nouveau contrat pas encore publié</span></div>`; alt.push(`${MoisAn(a.debut)} : appel d'offres sans contrat publié.`); });
  const step = Math.max(1, Math.ceil((y1 - y0) / 4)), ticks = [];
  for (let y = y0 + (y1 - y0 > 4 ? 1 : 0); y < y1; y += step) if (Math.abs((y - y0) / (y1 - y0) * 100 - now) > 9) ticks.push(`<span style="left:${((y - y0) / (y1 - y0) * 100).toFixed(1)}%">${y}</span>`);
  h += `<div class="axis tw" aria-hidden="true">${ticks.join("")}<span class="now" style="left:${now}%">auj.</span></div></div>`;
  return h.replace("ALT", esc(alt.join(" ")));
}
function retenir(s) {
  const cs = s.contrats, out = [];
  if (!cs.length) return "";
  const ents = [...new Set(cs.flatMap(e => e.entreprises || []))], y = year(cs[0]), checking = cs.some(e => e.note_relecture);
  if (ents.length === 1 && cs.length > 1) {
    const gaps = [];
    for (let i = 1; i < cs.length; i++) { const end = cs[i - 1].duree ? addMonths(cs[i - 1].date, cs[i - 1].duree) : null; if (end && monthsBetween(end, cs[i].date) > 3) gaps.push([end, cs[i].date]); }
    if (checking) out.push(`La même entreprise, ${entLink(ents[0])}, depuis ${y} (date du premier contrat à vérifier).`);
    else if (gaps.length) out.push(`La même entreprise depuis ${y}, avec ${gaps.length > 1 ? `${gaps.length} trous` : "un trou"} de ${monthsBetween(...gaps[0])} mois entre ${moisAn(gaps[0][0])} et ${moisAn(gaps[0][1])}.`);
    else out.push(`Pas de trou entre les contrats : la même entreprise, ${esc(tidy(entName(ents[0])))}, depuis ${y}.`);
  } else if (ents.length === 1) out.push(`Un seul contrat trouvé, avec ${esc(tidy(entName(ents[0])))}.`);
  else if (ents.length > 1) out.push(`${ents.length} entreprises différentes depuis ${y} ; la plus récente : ${esc(tidy(entName(cs[cs.length - 1].entreprises?.[0] || ents[0])))}.`);
  // the longest run of years without any contract running
  const run = new Set();
  cs.forEach(e => { const a = +year(e), b = e.duree ? +addMonths(e.date, e.duree).slice(0, 4) : a; for (let k = a; k <= b; k++) run.add(k); });
  let best = [0, 0], cur = null;
  for (let k = +y; k <= +TODAY.slice(0, 4); k++) { if (!run.has(k)) { cur = cur || [k, k]; cur[1] = k; if (cur[1] - cur[0] > best[1] - best[0]) best = [...cur]; } else cur = null; }
  if (best[0] && best[1] - best[0] >= 2) out.push(`Pas de contrat trouvé entre ${best[0]} et ${best[1]}.`);
  if (s.aosPending.length) out.push(`L'appel d'offres de ${moisAn(s.aosPending[s.aosPending.length - 1].debut)} attend son contrat.`);
  return `<p style="margin:0;font-size:15px">${out.join(" ")}</p>`;
}
function blocArgent(s) {
  const { c } = s, iM = ib("« Au maximum » : le plafond écrit dans le contrat, pas la somme payée. Contrats de 40 000 € et plus, publiés dans les données de la commande publique. Les lots d'un même appel d'offres (même acheteur, même jour, mêmes entreprises) forment un seul contrat ; un contrat publié deux fois compte une fois. Frise : une ligne par contrat, ou par entreprise à partir de 6 contrats ; chaque barre ouvre son historique ; en pointillé, une fin non publiée.", "Comment lire l'argent"), h = `<div class="tline"><h2 id="s-argent" class="h2">L'argent</h2>${iM.btn}</div>${iM.box}`;
  const subs = s.subs, subRow = subs.length ? eur(subs.reduce((t, e) => t + (e.montant || 0), 0)) : COUV.region.has(c.dep) || COUV.etat.has(c.dep) ? "aucune" : "pas encore collectées";
  const cov = !COUV.region.has(c.dep) && COUV.etat.has(c.dep) ? " Aides de la Région pas encore collectées." : COUV.region.has(c.dep) && !COUV.etat.has(c.dep) ? " Aides de l'État (DETR) pas encore collectées." : "";
  if (!s.contrats.length) return `<section class="blk" aria-labelledby="s-argent">${h}<p class="why">Aucun contrat de vidéosurveillance trouvé dans les données de la commande publique (contrats de 40 000 € et plus).</p>
    <dl class="kv"><dt>Subventions trouvées</dt><dd>${subRow}</dd></dl>${cov ? `<p class="note">${cov.trim()}</p>` : ""}</section>`;
  const ents = [...new Set(s.counted.flatMap(e => e.entreprises || []))], y = year(s.counted[0] || s.contrats[0]);
  const offre = s.contrats.filter(e => e.offres).pop();
  const big = s.counted.length ? `<p class="money"><span class="big">${eur(s.eur)}</span><br>au maximum depuis ${y}${c.pop ? `, soit <strong>${Math.round(s.eur / c.pop).toLocaleString("fr-FR").replace(/\u202f/g, "\u00a0")} € par habitant</strong>` : ""}${ents.length === 1 ? `, versés à <strong>une seule entreprise</strong> : ${entLink(ents[0])}` : ents.length ? `, versés à <strong>${ents.length} entreprises</strong> : ${ents.map(entLink).join(", ")}` : ""}.</p>`
    : `<p class="money"><span class="big">—</span><br>aucun contrat compté dans le total : ${esc([...new Set(s.excluded.map(horsRaison))].join(", "))} ${glo("totaux")}.</p>`;
  const hors = s.counted.length && s.excluded.length ? `<p class="why" style="margin:0;font-size:14px">* Hors du total : ${s.excluded.map(e => `${eur(e.montant)} (${horsRaison(e)})`).join(", ")}. ${glo("totaux")}</p>` : "";
  // the scope is written; other buyers on the commune (métropole, transports…) have their own pages
  const others = {}; s.autresAcheteurs.forEach(e => { const b = buyerOf(e); if (b) (others[b] ||= []).push(e); });
  const oth = Object.entries(others).sort((a, b) => b[1].length - a[1].length);
  const scope = `<p class="why" style="margin:0">Contrats signés par la mairie de ${esc(c.nom)}.</p>`;
  // by kind of buyer: who else buys on the commune (the État, the transports, the métropole…)
  const CATP = { etat: "l'État", transports: "les transports", metropole: "la métropole", intercommunalite: "l'intercommunalité", departement: "le département", region: "la région", bailleur: "les bailleurs sociaux", sante: "les hôpitaux", education: "l'enseignement", autre: "d'autres acheteurs" };
  const byCat = {}; s.autresAcheteurs.forEach(e => { const k = ACH[buyerOf(e)]?.categorie || "autre", x = byCat[k] ||= { n: 0, m: 0 }; x.n++; if (!e.hors_totaux && !e.national) x.m += e.montant || 0; });
  const cats = Object.entries(byCat).sort((a, b) => b[1].m - a[1].m || b[1].n - a[1].n).map(([k, x]) => `${CATP[k] || k} : ${plural(x.n, "contrat")}${x.m ? ` (${eur(x.m)})` : ""}`);
  const otherTxt = oth.length ? `<h3 class="h3">Les autres acheteurs sur la commune · ${plural(s.autresAcheteurs.length, "contrat")}</h3><ul class="results">${cats.map(c0 => `<li>${c0.charAt(0).toUpperCase() + c0.slice(1)}</li>`).join("")}</ul>
    <p style="margin:0" class="muted">${oth.slice(0, 5).map(([b, es]) => `${buyerLink(b)} (${es.length})`).join(", ")}${oth.length > 5 ? `, et ${oth.length - 5} autres` : ""}</p>` : "";
  const of = (window.OFFRES?.communes || {})[s.insee];
  const conc = of && of.filled >= 2 ? `<p style="margin:0"><strong>${of.one_offer} contrat${of.one_offer > 1 ? "s" : ""} sur ${of.filled}</strong> n'${of.one_offer > 1 ? "ont" : "a"} reçu qu'une offre.</p>` : "";
  return `<section class="blk" aria-labelledby="s-argent">${h}${scope}${big}${conc}${otherTxt}
    <h3 class="h3">${s.contrats.length >= 6 ? "Les entreprises, dans le temps" : "Les contrats, dans le temps"}</h3>${s.contrats.length >= 6 ? friseEnt(s.contrats, s.aosPending) : frise(s.contrats, s.aosPending)}${retenir(s)}
    <dl class="kv"><dt>Entreprises différentes depuis ${y}</dt><dd>${new Set(s.contrats.flatMap(e => e.entreprises || [])).size}</dd>
    ${offre ? `<dt>Offres reçues pour le contrat de ${moisAn(offre.date)}</dt><dd>${offre.offres}</dd>` : ""}
    <dt>Subventions trouvées</dt><dd>${subRow}</dd></dl>${hors}
    ${cov ? `<p class="why" style="font-size:14px">${cov.trim()}</p>` : ""}</section>`;
}
function story(s) {
  const { c, insee } = s, it = [];
  const mine = s.mine.filter(e => !/^arrete_(drone|vsa)$/.test(e.t));
  const big = mine.length > 30;
  if (big) {
    // the notable facts of each year: a new company, the largest contract, a first drone or analysis, a jump in cameras
    const seen = new Set(), ys = [...new Set(mine.map(year))].filter(Boolean).sort();
    const firstDrone = s.all.filter(e => e.t === "arrete_drone").sort(byDateAsc)[0], firstVsa = s.all.filter(e => e.t === "arrete_vsa").sort(byDateAsc)[0];
    ys.forEach(y => {
      const rs = mine.filter(e => year(e) === y), cs = rs.filter(e => e.t === "attribution"), facts = [];
      const neu = [...new Set(cs.flatMap(e => e.entreprises || []))].filter(x => !seen.has(x));
      cs.forEach(e => (e.entreprises || []).forEach(x => seen.add(x)));
      if (neu.length && y > ys[0]) facts.push(`nouvelle entreprise : ${neu.slice(0, 3).map(entLink).join(", ")}${neu.length > 3 ? ` et ${neu.length - 3} autres` : ""}`);
      const top = cs.filter(e => !e.hors_totaux && !e.national).sort((a, b) => (b.montant || 0) - (a.montant || 0))[0];
      if (top) facts.push(`plus gros contrat : ${eur(top.montant)} avec ${top.entreprises?.length ? entLink(top.entreprises[0]) : "une entreprise non publiée"}`);
      if (firstDrone && year(firstDrone) === y) facts.push(`premier arrêté de drones (${jourMois(firstDrone.date)})`);
      if (firstVsa && year(firstVsa) === y) facts.push(`première analyse algorithmique (${jourMois(firstVsa.date)})`);
      const jumps = Object.values(R.affaires).filter(a => a.insee === insee && a.kind === "dossier").flatMap(a => { const p = (a.cameras || []).filter(q => q.n != null && !q.groupe); return p.slice(1).map((q, i) => ({ q, d: q.n - p[i].n })); }).filter(x => year({ date: x.q.date }) === y && x.d >= 10);
      if (jumps.length) facts.push(`${jumps.length > 1 ? `${jumps.length} hausses` : "une hausse"} des caméras autorisées (${jumps.map(x => sign(x.d)).join(", ")})`);
      const n = { c: cs.length, a: rs.filter(e => e.t === "arrete").length };
      // a year without a notable fact is left out (its documents are in « Documents »)
      if (facts.length) it.push({ d: y, k: y, mk: "", t: `${facts.map(f => f.charAt(0).toUpperCase() + f.slice(1)).join(". ")}. <span class="muted">${[n.c ? plural(n.c, "contrat") : "", n.a ? plural(n.a, "autorisation") : ""].filter(Boolean).join(" · ")}</span>` });
    });
  } else {
    const dossiers = Object.values(R.affaires).filter(a => a.insee === insee && a.kind === "dossier" && isCommunal(EV[a.events[a.events.length - 1]]));
    dossiers.forEach(a => {
      if (a.origine_annee && a.origine_annee < +a.debut.slice(0, 4)) it.push({ d: String(a.origine_annee), k: `${a.origine_annee}-00`, mk: "open", t: `La mairie ouvre son dossier d'autorisation des caméras${dossiers.length > 1 ? ` (n° ${dossierNo(a.id)})` : ""}.` });
      const pts = (a.cameras || []).filter(p => p.n != null && !p.groupe);
      if (pts.length > 1) { const m = monthsBetween(pts[0].date, pts[pts.length - 1].date), dl = pts[pts.length - 1].n - pts[0].n;
        it.push({ d: `${MoisAn(pts[0].date)} → ${moisAn(pts[pts.length - 1].date)}`, k: pts[0].date, mk: "aut", t: `La préfecture autorise ${pts.map(p => p.n).join(", puis ")} caméras : <strong>${sign(dl)} en ${m} mois.</strong>` }); }
      else if (pts.length) it.push({ d: MoisAn(pts[0].date), k: pts[0].date, mk: "aut", t: `La préfecture autorise ${plural(pts[0].n, "caméra")}.` });
    });
    s.contrats.forEach((e, i) => {
      const mods = R.evenements.filter(x => x.affaire === e.affaire && x.t === "modification");
      const who = e.entreprises?.length ? `<strong>${entLink(e.entreprises[0])}</strong>` : "une entreprise non publiée";
      it.push({ d: e.note_relecture ? `${year(e)} <span class="datecheck">date à vérifier</span>` : MoisAn(e.date), k: e.date, mk: "con",
        t: `${i ? "Nouveau contrat" : "Premier contrat trouvé"} avec ${who}${mods.length ? `, modifié ${mods.length > 1 ? `${mods.length} fois` : `en ${MOIS[+mods[0].date.slice(5, 7) - 1]}`}` : ""} : ${esc(calm(e.objet || "").toLowerCase())}.` });
    });
    Object.values(R.affaires).filter(a => a.insee === insee && a.kind === "contrat_non_retrouve" && !a.contrat_probable && a.debut >= "2019").forEach(a => {
      const e0 = EV[a.events[0]]; it.push({ d: MoisAn(a.debut), k: a.debut, mk: "ao", t: `Appel d'offres sans contrat publié : ${esc(calm(e0.objet || "").toLowerCase())}.` }); });
    s.subs.forEach(e => it.push({ d: MoisAn(e.date), k: e.date, mk: "sub", t: `${e.t === "subvention_region" ? "La Région" : "L'État"} accorde une subvention de ${eur(e.montant)}${e.cameras ? ` pour ${plural(e.cameras, "caméra")}` : ""}.` }));
  }
  const ad = s.all.filter(e => /^arrete_(drone|vsa)$/.test(e.t));
  if (ad.length && !big) { const dr = ad.filter(e => e.t === "arrete_drone"), vs = ad.filter(e => e.t === "arrete_vsa");
    if (dr.length) it.push({ d: dr.length > 1 ? `${MoisAn(dr[dr.length - 1].date)} → ${moisAn(dr[0].date)}` : MoisAn(dr[0].date), k: dr[dr.length - 1].date, mk: "aut", t: `La préfecture autorise des drones à ${esc(c.nom)} ${dr.length > 1 ? `${dr.length} fois` : "une fois"}.` });
    vs.forEach(e => it.push({ d: MoisAn(e.date), k: e.date, mk: "aut", t: `La préfecture autorise l'analyse algorithmique des images : ${esc(tidy(e.objet || ""))}.` })); }
  if (!it.length) return "";
  const k0 = it.map(x => x.k).sort()[0];
  ELECTIONS.filter(el => el.date >= k0 && el.date <= TODAY).forEach(el => it.push({ d: "", k: big ? el.date.slice(0, 4) + "~" : el.date, mk: "elec", t: `élections municipales, ${el.label} · <a href="${ELUS}" target="_blank" rel="noopener">les élus ↗</a>` }));
  it.sort((a, b) => a.k.localeCompare(b.k));
  const iS = ib(big ? "Les faits marquants de chaque année, pour les documents de la mairie : une nouvelle entreprise, le plus gros contrat, un premier drone ou une première analyse algorithmique, une hausse d'au moins 10 caméras autorisées. Une année sans fait marquant est omise ; le détail est dans les documents." : "Les documents de la mairie, du plus ancien au plus récent. Les élections municipales sont des repères.", "Comment lire ce qui s'est passé");
  return `<section class="blk" aria-labelledby="s-temps"><div class="tline"><h2 id="s-temps" class="h2">Ce qui s'est passé</h2>${iS.btn}</div>${iS.box}
    <ol class="story">${it.map(x => x.mk === "elec" ? `<li class="elec">${x.t}</li>` : `<li><span class="mk ${x.mk}" aria-hidden="true"></span><span class="d">${x.d}</span><br>${x.t}</li>`).join("")}</ol>

    <a class="ghost" href="#/commune/${insee}/dossier">Les ${plural(s.all.length, "document")} →</a></section>`;
}
function yearSentence(rs) {
  const n = t => rs.filter(e => e.t === t).length, p = [];
  const c = rs.filter(e => e.t === "attribution");
  if (c.length) p.push(`${plural(c.length, "contrat signé", "contrats signés")}`);
  if (n("modification")) p.push(plural(n("modification"), "modification de contrat", "modifications de contrat"));
  const a = rs.filter(e => e.t === "arrete"); if (a.length) p.push(`${plural(a.length, "autorisation de caméras", "autorisations de caméras")}`);
  const d = rs.filter(e => e.t === "arrete_drone"); if (d.length) p.push(plural(d.length, "autorisation de drones", "autorisations de drones"));
  const v = rs.filter(e => e.t === "arrete_vsa"); if (v.length) p.push(plural(v.length, "autorisation d'analyse algorithmique", "autorisations d'analyse algorithmique"));
  const s = rs.filter(e => e.t.startsWith("subvention")); if (s.length) p.push(plural(s.length, "subvention"));
  const o = rs.filter(e => ["avis", "resultat", "rectificatif"].includes(e.t)); if (o.length) p.push(plural(o.length, "avis d'appel d'offres", "avis d'appels d'offres"));
  const t = p.join(", ");
  return t.charAt(0).toUpperCase() + t.slice(1) + ".";
}
function blocSurveiller(s) {
  const it = [];
  s.aosPending.forEach(a => it.push({ k: "0", w: "bientôt", t: `<strong>Avec qui ${esc(s.c.nom)} va-t-elle signer ?</strong> L'appel d'offres de ${moisAn(a.debut)} n'a pas encore de contrat publié.` }));
  s.contrats.filter(e => !isCopy(e)).forEach(e => { if (!e.duree) return; const end = addMonths(e.date, e.duree); if (end >= TODAY) it.push({ k: end, w: fmtD(end), t: `<a href="#/affaire/${encodeURIComponent(e.affaire)}">Fin du contrat de ${year(e)}</a> avec ${e.entreprises?.length ? entLink(e.entreprises[0]) : "une entreprise non publiée"}${e.note_relecture ? " (date à vérifier)" : ""}.` }); });
  s.com.forEach(e => { const a = affaire(e.affaire); if (a?.echeance && a.echeance >= TODAY) it.push({ k: a.echeance, w: fmtD(a.echeance), t: "Fin de l'autorisation de la préfecture : un renouvellement devra être publié." }); });
  if (!it.length) return "";
  it.sort((a, b) => a.k.localeCompare(b.k));
  return `<section class="blk" aria-labelledby="s-bientot"><h2 id="s-bientot" class="h2">À surveiller</h2>
    <ul class="watch">${it.map(x => `<li><span class="when">${x.w}</span><span>${x.t}</span></li>`).join("")}</ul>
    <button type="button" class="btn" style="align-self:flex-start" data-rss="${s.insee}">Me prévenir (RSS)</button></section>`;
}
function blocAussi(s) {
  if (!s.prv.length) return "";
  const n = s.prv.reduce((t, e) => t + e.cameras, 0), kinds = { banque: "banques", commerce: "commerces", pharmacie: "pharmacies", entreprise: "entreprises" };
  const ty = [...new Set(s.prv.map(e => kinds[e.type_beneficiaire] || ""))].filter(Boolean);
  return `<section class="aussi" aria-labelledby="s-prives"><h2 id="s-prives" class="h2">Aussi à ${esc(s.c.nom)}</h2>
    <p><strong>${plural(n, "caméra")}</strong> de commerces et d'entreprises autorisées en un an${ty.length ? ` (${ty.join(", ")})` : ""}, dans ${plural(s.prv.length, "arrêté")}.</p>
    <a class="ghost" href="#/commune/${s.insee}/dossier?qui=prives&amp;nature=aut">Les voir →</a></section>`;
}
function missingItems(insee, all) {
  const items = [], c = commune(insee);
  Object.values(R.affaires).filter(a => a.insee === insee).forEach(a => {
    if (a.kind === "dossier" && a.origine_annee && a.origine_annee < +a.debut.slice(0, 4) - 1 && isCommunal(EV[a.events[a.events.length - 1]]))
      items.push([`Combien de caméras la préfecture a-t-elle autorisées entre ${a.origine_annee} et ${+a.debut.slice(0, 4) - 1} ?`, "prefecture", `les arrêtés préfectoraux d'autorisation du système de vidéoprotection de la commune de ${c.nom}, dossier n° ${a.id.split("-")[1]}, de ${a.origine_annee} à ${+a.debut.slice(0, 4) - 1}`]);
    if (a.kind === "contrat_non_retrouve" && !a.contrat_probable && a.events.some(i => EV[i].t === "avis") && a.debut >= "2019")
      items.push([`Avec quelle entreprise ${c.nom} a-t-elle signé après l'appel d'offres de ${moisAn(a.debut)} ?`, "mairie", `le contrat (acte d'engagement) conclu à la suite de l'avis d'appel public à la concurrence publié le ${fmtD(a.debut)} au BOAMP (${EV[a.events[0]].ref}), avec son montant`]);
    if (a.kind === "subvention" && a.id.startsWith("sub-") && !a.contrat_probable && a.debut >= "2019")
      items.push([`Quel contrat la subvention de la Région du ${fmtD(a.debut)} a-t-elle financé ?`, "mairie", `le ou les contrats de travaux financés par la subvention régionale votée le ${fmtD(a.debut)} (${EV[a.events[0]].ref})`]);
  });
  if (!all.some(e => e.t.startsWith("arrete")) && !COUV.arretes.has(c.dep) && PILOTE.has(c.dep))
    items.push([`Combien de caméras la préfecture a-t-elle autorisées à ${c.nom} ?`, "prefecture", `les arrêtés préfectoraux autorisant le système de vidéoprotection de la commune de ${c.nom}, avec le nombre de caméras autorisées`]);
  return items;
}
function blocIntrouvables(s) {
  const items = missingItems(s.insee, s.all);
  if (!items.length) return "";
  const card = ([q, quiq, obj]) => `<div class="ask"><p class="q">${esc(q)}</p><button type="button" class="btn" style="align-self:flex-start" data-demande="${esc(obj)}" data-qui="${quiq}" data-insee="${s.insee}">Demander ${quiq === "mairie" ? "à la mairie" : "à la préfecture"}</button></div>`;
  return `<section class="blk" aria-labelledby="s-introuvables"><h2 id="s-introuvables" class="h2">Documents introuvables en ligne</h2>
    <p class="why">Ils existent, mais ne sont pas publiés. Tout le monde peut les demander.</p>${items.slice(0, 3).map(card).join("")}
    ${items.length > 3 ? `<p class="note">Et ${plural(items.length - 3, "autre question", "autres questions")} de ce genre.</p>` : ""}</section>`;
}
const foot = (insee, osm = true) => `<footer class="foot"><div class="btns"><button type="button" class="btn" data-partage="${insee || ""}">Partager l'image</button><button type="button" class="btn" data-sources>Nos sources</button></div></footer>`;

// breadcrumb: département → commune → the page
function crumbs(insee, here) {
  const c = commune(insee), dep = DEPS[c.dep] || c.dep;
  return `<nav class="crumbs" aria-label="Fil d'Ariane"><a href="#/departement/${c.dep}">${esc(dep)}</a> › ${here ? `<a href="#/commune/${insee}">${esc(c.nom)}</a> › <span aria-current="page">${esc(here)}</span>` : `<span aria-current="page">${esc(c.nom)}</span>`}</nav>`;
}
function ident(c, cls = "", h1 = c.nom) {
  const dep = DEPS[c.dep] || c.dep;
  return `<div class="ident ${cls}"><div class="tape" aria-hidden="true"></div><span class="tag commune">Commune</span>
    <h1>${esc(h1)}</h1><p class="tw">${esc(dep)} · ${c.pop.toLocaleString("fr-FR").replace(/\u202f/g, "\u00a0")} habitants</p></div>`;
}
const tabs = (insee, cur, n) => `<nav class="tabs" aria-label="Vues de la commune"><a href="#/commune/${insee}" ${cur === "ess" ? 'aria-current="page"' : ""}>L'essentiel</a><a href="#/commune/${insee}/dossier" ${cur === "doc" ? 'aria-current="page"' : ""}>Documents · ${n.toLocaleString("fr-FR").replace(/\u202f/g, "\u00a0")}</a></nav>`;

async function pageCommune(insee) {
  const s = ess(insee);
  $("#app").innerHTML = `${crumbs(insee)}${ident(s.c)}${tabs(insee, "ess", s.all.length)}
    <main class="ess">${phrase(s)}${blocCarte(s)}${blocAutres(s)}${blocAutorise(s)}${blocArgent(s)}${story(s)}${blocSurveiller(s)}${blocAussi(s)}<div id="autour"></div>${blocMemes(s)}${blocIntrouvables(s)}${foot(insee)}</main>`;
  if (s.n != null) mountMap(document.getElementById("carte"), insee, { couches: { cams: true, vsa: false, drones: false } });
  // the neighbours' small map is loaded only here (2,9 Mo for all the communes of the pilot)
  loadScript("geo/mini.js").catch(() => {}).then(() => { const el = document.getElementById("autour"); if (el) el.outerHTML = blocAutour(s); });
  ici(insee);
}
// « Vous êtes à X ? »: only when the phone has already granted its position; computed here, never sent
async function ici(insee) {
  const p = document.getElementById("ici");
  if (!p || !navigator.permissions || !navigator.geolocation) return;
  try {
    const st = await navigator.permissions.query({ name: "geolocation" });
    if (st.state !== "granted") return;
    const data = await carteData(insee), { pointInCommune } = await import("./carte3d.mjs");
    navigator.geolocation.getCurrentPosition(pos => { if (pointInCommune(data, [pos.coords.longitude, pos.coords.latitude])) p.hidden = false; }, () => {}, { maximumAge: 600000, timeout: 8000 });
  } catch (e) { /* no position, no line */ }
}
const _carte = {};
const CARTES = "../prototype-v10/";   // the commune maps (carte/, fond/: 64 Mo) are read from v10, not copied
const carteData = insee => _carte[insee] ||= fetch(`${CARTES}carte/${insee}.json`).then(r => r.json());
let current = null;
async function mountMap(el, insee, o = {}) {
  if (!el) return null;
  const [{ carte }, data] = await Promise.all([import("./carte3d.mjs"), carteData(insee)]);
  if (!el.isConnected) return null;
  const theme = () => document.documentElement.classList.contains("dark") ? "dark" : "light";
  const c = await carte(el, { data, fond: `${CARTES}fond/${insee}.pmtiles`, theme: theme(), play: !/[?&]rotation=0\b/.test(location.search), slowStop: !/[?&]perf=1\b/.test(location.search),
    nom: commune(insee).nom, label: el.dataset.label, sites: (window.SITES || []).filter(u => u.parts?.[insee]), capture: /[?&]capture=1\b/.test(location.search), ...o });
  current = c; window.__carte = c;
  addEventListener("themechange", () => c.setTheme(theme()));
  document.dispatchEvent(new Event("carteprete"));
  return c;
}

// --- documents: rows, filters, summary ---------------------------------------------------------
const PAGE = 50;
const state = { filters: {}, q: "", limit: PAGE };
function filterRows(rows, f, q) {
  return rows.filter(e => (!f.nature || kindOf(e) === f.nature)
    && (!f.annee || (f.annee.startsWith("avant") ? year(e) < f.annee.slice(6) : year(e) === f.annee))
    && (!f.entreprise || e.entreprises?.includes(f.entreprise)) && (!f.dep || e.dep === f.dep)
    && (!f.dispositif || e.dispositif === f.dispositif || affaire(e.affaire)?.dispositif === f.dispositif)
    && (!f.qui || f.qui === "tous" || (f.qui === "mairie" ? isCommunal(e) : !isCommunal(e))) && (!f.arr || e.arrondissement === f.arr)
    && (!f.masquer || !PHOTO(e)) && (!f.pilote || !affaire(e.affaire)?.hors_pilote)
    && (!f.acheteur || (f.acheteur.startsWith("?") ? e.insee === f.acheteur.slice(1) && !buyerOf(e) : buyerOf(e) === f.acheteur))
    && (!q || `${e.objet} ${e.ref} ${e.beneficiaire || ""} ${e.acheteur || ""} ${(e.entreprises || []).map(entName).join(" ")}`.toLowerCase().includes(q.toLowerCase())));
}
function who(e) {
  if (e.t.startsWith("arrete")) return [benefLabel(e), e.arrondissement].filter(Boolean).join(" · ");
  if (e.entreprises?.length) return e.entreprises.map(entName).map(tidy).join(", ");
  if (e.t.startsWith("subvention")) return e.acheteur || "commune";
  return [e.acheteur ? calm(e.acheteur) : "", e.objet ? calm(e.objet).toLowerCase() : ""].filter(Boolean).join(" · ");
}
function value(e) {
  if (e.t === "attribution" || e.t === "modification") return e.montant != null ? `${eur(e.montant)} max.` : "";
  if (e.t.startsWith("subvention")) return e.montant != null ? eur(e.montant) : e.cameras ? plural(e.cameras, "caméra") : "";
  if (e.t.startsWith("arrete")) return e.cameras != null ? plural(e.cameras, e.t === "arrete_drone" ? "drone" : "caméra") : "";
  return "";
}
function prevInDossier(e) {
  const a = affaire(e.affaire); if (!a || a.kind !== "dossier") return null;
  const es = a.events.map(i => EV[i]).filter(x => x.date < e.date && x.cameras_vp != null).sort(byDateDesc);
  return es[0] || null;
}
function lines(e) {
  const L = [], a = affaire(e.affaire), c = a?.kind === "contrat" ? a : null;
  if (e.t === "arrete") {
    const p = prevInDossier(e);
    if (e.cameras_vp != null) L.push(`${e.cameras_vp} filment la rue${p ? ` (${sign(e.cameras_vp - p.cameras_vp)} depuis ${MOIS[+p.date.slice(5, 7) - 1]})` : ""}.`);
    if (e.videoverbalisation) L.push("Vidéoverbalisation autorisée.");
    if (e.deport_forces) L.push("Images transmises à la police ou à la gendarmerie.");
    if (a?.echeance_source === e.id) L.push(`Valable jusqu'au ${longDate(a.echeance)}.`);
    if (e.beneficiaire === "[non retenu]") L.push(`Bénéficiaire privé : nom masqué, faute de preuve dans le registre des entreprises. ${glo("nom-non-publie", "Pourquoi ?")}`);
    else if (e.beneficiaire_siren) L.push(`Identifié dans le registre des entreprises (SIREN ${e.beneficiaire_siren}).`);
  }
  if (e.t === "arrete_drone" || e.t === "arrete_vsa" || e.t === "arrete_pietons") {
    if (e.beneficiaire) L.push(`Service : ${esc(benefLabel(e))}.`);
    if (e.periode) L.push(`Période : ${esc(e.periode.replace(/(\d{4})-(\d\d)-(\d\d)/g, (m, y, mo, d) => `${d}/${mo}/${y}`))}.`);
    if (e.objet) L.push(`Zone : ${esc(tidy(e.objet))}.`);
    if (e.nature_vol && e.nature_vol !== "video") L.push(`Nature : ${esc(NATVOL[e.nature_vol] || e.nature_vol)}.`);
  }
  if (e.publie_par) L.push(`Publié par la ${esc(e.publie_par)}${e.note_lieu ? ` ; ${esc(e.note_lieu)}` : ""}.`);
  if (e.t === "attribution" || e.t === "modification") {
    if (e.objet) L.push(esc(calm(e.objet)));
    if (e.t === "modification") L.push(`Ce qui change : ${esc(e.changements?.length ? e.changements.join(", ") : NO_CHANGE)}.`);
    if (e.t === "attribution" && e.duree) L.push(`Durée : ${e.duree} mois.`);
    if (e.offres) L.push(`Offres reçues : ${e.offres}.`);
  }
  if (["avis", "resultat", "rectificatif"].includes(e.t)) {
    if (e.objet) L.push(esc(calm(e.objet)));
    L.push(e.t === "avis" ? "La mairie ou l'administration cherche une entreprise." : e.t === "resultat" ? "Le contrat est attribué." : "L'appel d'offres est corrigé.");
    if (a?.kind === "contrat_non_retrouve") L.push(a.contrat_probable ? `Contrat probablement signé à la suite : <a href="#/affaire/${encodeURIComponent(a.contrat_probable)}">voir</a> (lien probable ${glo("lien-probable")}).` : "Contrat pas encore publié.");
  }
  if (e.t.startsWith("subvention")) {
    if (e.objet) L.push(esc(calm(e.objet)));
    if (e.cameras) L.push(`${plural(e.cameras, "caméra")} dans le projet.`);
    if (e.base) L.push(`Sur ${eur(e.base)} de travaux${e.taux ? `, ${e.taux} %` : ""}.`);
  }
  const flags = [];
  if (e.hors_totaux === "centrale") flags.push(`Centrale d'achat : ce montant est le plafond de ce que d'autres acheteurs pourront commander, pas une dépense. Hors de tous les totaux. ${glo("centrale")}`);
  if (e.hors_totaux === "a_verifier" || c?.montant_a_verifier) flags.push(`Montant à vérifier : ${esc(c?.montant_a_verifier || "")}. Hors des totaux, en relecture. ${glo("montant-a-verifier")}`);
  if (c?.contrat_mixte) flags.push(`Contrat mixte (${c.mixte_famille === "surete" ? "vidéo + alarmes des bâtiments" : "vidéo + autres services : gardiennage, incendie, éclairage…"}) : hors des totaux sauf si vous l'incluez dans les filtres. ${glo("contrat-mixte")}`);
  if (c?.plafond_partage) flags.push(`Plafond partagé : ${esc(c.plafond_partage)}. Ce maximum n'est pas la part de cet acheteur. ${glo("plafond-partage")}`);
  if (c?.acheteur_national) flags.push(`Acheteur national : hors des totaux d'une commune ou d'un département. ${glo("acheteur-national")}`);
  if (e.note_relecture) flags.push(`À vérifier : ${esc(e.note_relecture)}`);
  return [L, flags];
}
function docRow(e, opts = {}) {
  const [L, flags] = lines(e), a = affaire(e.affaire), op = opts.hl === e.id, mid = `m-${String(e.id).replace(/[^A-Za-z0-9]/g, "_")}`;
  const k = kindOf(e), ic = e.t === "arrete_drone" ? "drone" : k;
  const hist = !opts.noaff && a && (a.events.length > 1 || a.kind === "dossier") ? `<a class="ghost" href="#/affaire/${encodeURIComponent(e.affaire)}">${histTitleShort(a)} →</a>` : "";
  return `<li id="ev-${CSS.escape(e.id)}"><div class="sumrow">
    <span class="ic" aria-hidden="true"><span class="ic-${ic}"></span></span><span class="d">${e.date_annee ? "date ?" : jourMois(e.date)}</span>
    <span class="t"><button type="button" class="sum" aria-expanded="${op}" aria-controls="${mid}"><b>${esc(nat(e))}${e.note_relecture ? " · date à vérifier" : ""}</b><span class="chev" aria-hidden="true">▾</span></button><span class="who">${whoLinks(e, opts.ctx)}</span></span><span class="v">${esc(value(e))}</span></div>
    <div class="more" id="${mid}" ${op ? "" : "hidden"}>${L.length ? `<ul>${L.map(l => `<li>${l}</li>`).join("")}</ul>` : ""}${flags.map(f => `<p class="flagline">${f}</p>`).join("")}
      <p class="note">${esc(emetteur(e))} · ${esc(e.ref.replace(/^préfecture du Rhône, /, ""))}${e.relu ? " · vérifié à la main" : " · lu automatiquement"}</p>
      <div class="btns">${e.url ? `<a class="btn small" href="${esc(e.url)}" target="_blank" rel="noopener">Voir le document ↗</a>` : ""}<button type="button" class="btn small" data-cite="${esc(e.id)}">Copier la référence</button></div>
      ${hist}<button type="button" class="linkbtn" data-signal="${esc(e.id)}">Signaler une erreur</button></div></li>`;
}
function histTitleShort(a) {
  const n = a.events.length;
  return { dossier: `Historique de l'autorisation (${plural(n, "arrêté")})`, contrat: `Historique du contrat (${plural(n, "document")})`, contrat_non_retrouve: `Historique de l'appel d'offres (${plural(n, "document")})`,
    subvention: "Historique de la subvention", acte: "Historique" }[a.kind] || "Historique";
}
function yearsHTML(rows, opts = {}) {
  const shown = rows.slice(0, state.limit);
  let h = `<div class="years">`, curY = null, prevDate = "9999";
  const seen = new Set();
  for (const e of shown) {
    if (year(e) !== curY) {
      if (curY !== null) h += `</ul></section>`;
      curY = year(e); const n = rows.filter(x => year(x) === curY).length;
      h += `<section><h2>${curY || "Sans date"} <span class="tw">${plural(n, "document")}</span></h2><ul class="docs">`;
    }
    if (opts.mandats) for (const el of ELECTIONS) if (!seen.has(el.date) && prevDate >= el.date && (e.date || "") < el.date) {
      h += `<li class="marker">Élections municipales, ${el.label} · <a href="${ELUS}" target="_blank" rel="noopener">les élus ↗</a></li>`; seen.add(el.date); }
    prevDate = e.date || prevDate;
    h += docRow(e, opts);
  }
  if (curY !== null) h += `</ul></section>`;
  h += `</div>`;
  if (!rows.length) h = `<p class="why" style="padding:16px">Aucun document avec ces filtres.</p>`;
  if (rows.length > shown.length) h += `<p style="padding:0 16px"><button type="button" class="btn" data-more>Afficher les ${Math.min(PAGE, rows.length - shown.length)} suivants (${rows.length - shown.length} restants)</button></p>`;
  return h;
}
function summary(rows, f, ctx) {
  const contrats = rows.filter(e => counts(e, { ...f, territorial: ctx.territorial })), all = rows.filter(e => e.t === "attribution");
  const arr = lastArretes(rows), com = arr.filter(isCommunal), prv = arr.filter(e => !isCommunal(e)), ss = rows.filter(e => e.t.startsWith("subvention"));
  const camC = com.reduce((t, e) => t + e.cameras, 0), camP = prv.reduce((t, e) => t + e.cameras, 0);
  const sum = eur(contrats.reduce((t, e) => t + (e.montant || 0), 0));
  const nat_ = f.nature || "";
  const subCov = d => COUV.region.has(d) || COUV.etat.has(d) ? (COUV.region.has(d) && !COUV.etat.has(d) ? "aides de l'État pas encore collectées" : !COUV.region.has(d) ? "aides de la Région pas encore collectées" : "") : "subventions pas encore collectées";
  if (nat_ === "aut") return [plural(rows.length, "autorisation"), camC ? `${plural(camC, "caméra")} ${ctx.commune ? "de la mairie" : "des communes"}` : "", camP ? `${camP.toLocaleString("fr-FR").replace(/\u202f/g, "\u00a0")} de commerces et entreprises` : "",
    rows.filter(e => e.t === "arrete_drone").length ? plural(rows.filter(e => e.t === "arrete_drone").length, "autorisation de drones", "autorisations de drones") : ""].filter(Boolean).join(" · ");
  if (nat_ === "ao") return rows.length ? `${plural(rows.length, "avis d'appel d'offres ou de résultat", "avis d'appels d'offres et de résultats")}, depuis ${year(rows[rows.length - 1])}` : "Aucun avis d'appel d'offres";
  const montant = contrats.length ? `${sum} au maximum${contrats.length < all.length ? ` (${contrats.length} comptés)` : ""}` : `montant hors des totaux (${[...new Set(all.map(horsRaison))].filter(Boolean).join(", ")})`;
  if (nat_ === "con") return all.length ? `${plural(all.length, "contrat")} et ${plural(rows.filter(e => e.t === "modification").length, "modification")} · ${montant}` : "Aucun contrat";
  if (nat_ === "sub") return ss.length ? `${plural(ss.length, "subvention")} · ${eur(ss.reduce((t, e) => t + (e.montant || 0), 0))}` : `Aucune subvention trouvée${ctx.dep ? ` · ${subCov(ctx.dep)}` : ""}`;
  return [plural(rows.length, "document"), all.length ? `${plural(all.length, "contrat")} (${contrats.length ? `${sum} au max.${contrats.length < all.length ? `, ${contrats.length} comptés` : ""}` : "hors des totaux"})` : "", camC ? `${plural(camC, "caméra")} ${ctx.commune ? "de la mairie" : "des communes"}` : ""].filter(Boolean).join(" · ");
}
function chipsHTML(base, f, ctx) {
  const others = filterRows(base, { ...f, nature: "" }, state.q), n = k => others.filter(e => !k || kindOf(e) === k).length;
  const defs = [["", "Tout"], ["aut", "Autorisations"], ["ao", "Appels d'offres"], ["con", "Contrats"], ["sub", "Subventions"]].filter(([k]) => !k || n(k) || k === "sub" && ctx.commune);
  return `<div class="chips" role="group" aria-label="Nature des documents">${defs.map(([k, l]) => `<button type="button" class="chip" aria-pressed="${(f.nature || "") === k}" data-f="nature" data-v="${k}">${l} · ${n(k).toLocaleString("fr-FR").replace(/\u202f/g, "\u00a0")}</button>`).join("")}</div>`;
}
const activeCount = f => ["qui", "annee", "entreprise", "arr", "mixtes_surete", "mixtes_autres", "masquer", "dep", "dispositif", "acheteur"].filter(k => f[k] && f[k] !== "tous").length;
function docbar(base, f, ctx) {
  const k = activeCount(f);
  return `<div class="docbar" ${ctx.commune ? "" : 'style="top:0"'}>${chipsHTML(base, f, ctx)}
    <div class="tools"><button type="button" class="btn" data-filtres aria-haspopup="dialog"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M3 6h18M7 12h10M10 18h4"></path></svg>Filtres${k ? ` · ${k}` : ""}</button>
    <label class="search"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-4-4"></path></svg><span class="sr-only">Rechercher dans les documents</span><input type="search" placeholder="Rechercher" value="${esc(state.q)}" data-q></label></div>
    <p class="summary" aria-live="polite">${esc(summary(filterRows(base, f, state.q), f, ctx))}</p></div>`;
}
const downloads = name => { const i = ib("Licence Ouverte 2.0. Chaque ligne cite sa source (référence et adresse du document). Le LISEZMOI explique chaque colonne. Les caméras de la carte (OpenStreetMap, ODbL) ne sont pas dans ces fichiers.", "La licence et les colonnes"); return `<div class="dl"><div class="tline"><p><strong>Télécharger ces documents</strong></p>${i.btn}</div>${i.box}<div class="btns"><button type="button" class="btn" data-export="csv">Tableur (CSV)</button><button type="button" class="btn" data-export="json">Données (JSON)</button><button type="button" class="btn small" data-export="txt">LISEZMOI</button></div>
  </div>`; };

// the filter panel (a dialog, from the bottom on a phone)
function openFilters(base, ctx, apply) {
  const opener = document.activeElement, f = { ...state.filters };
  const bg = document.createElement("div"); bg.className = "sheet-bg";
  const yrs = [...new Set(base.map(year))].filter(Boolean).sort().reverse(), top = yrs.slice(0, 3), avant = yrs[3] ? yrs[2] : null;
  const ents = [...new Set(base.flatMap(e => e.entreprises || []))].sort((a, b) => entName(a).localeCompare(entName(b)));
  const arrs = [...new Set(base.map(e => e.arrondissement).filter(Boolean))].sort((x, y) => parseInt(x.replace(/\D/g, "")) - parseInt(y.replace(/\D/g, "")));
  const hasMix = base.some(e => e.hors_totaux?.startsWith("mixte")), hasPhoto = base.some(PHOTO);
  const draw = () => {
    const n = filterRows(base, f, state.q).length, cnt = q => filterRows(base, { ...f, qui: q }, state.q).length;
    bg.innerHTML = `<section class="sheet" role="dialog" aria-modal="true" aria-labelledby="f-titre"><div class="handle" aria-hidden="true"></div>
      <div class="hd"><h2 id="f-titre">Filtres</h2><button type="button" class="x" data-x aria-label="Fermer"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" aria-hidden="true"><path d="M5 5l14 14M19 5 5 19"></path></svg></button></div>
      <div class="bd">
        <fieldset><legend>Qui</legend>${[["tous", "Tout le monde"], ["mairie", ctx.commune ? "La mairie seulement" : "Communes et intercommunalités"], ["prives", "Commerces et entreprises"]].map(([k, l]) =>
          `<label class="opt"><input type="radio" name="qui" value="${k}" ${(f.qui || "tous") === k ? "checked" : ""}><span>${l}</span><span class="n">${cnt(k).toLocaleString("fr-FR").replace(/\u202f/g, "\u00a0")} doc.</span></label>`).join("")}</fieldset>
        <fieldset><legend>Période</legend><div class="pills">${[["", "Toutes"], ...top.map(y => [y, y]), ...(avant ? [[`avant-${avant}`, `Avant ${avant}`]] : [])].map(([k, l]) =>
          `<button type="button" class="chip" aria-pressed="${(f.annee || "") === k}" data-an="${k}">${l}</button>`).join("")}</div>${f.annee && !top.includes(f.annee) && !f.annee.startsWith("avant") ? `<p class="note">Année choisie : ${esc(f.annee)}</p>` : ""}</fieldset>
        ${ents.length ? `<div><label for="f-ent" class="lg">Entreprise</label><select id="f-ent" data-s="entreprise"><option value="">Toutes les entreprises</option>${ents.map(s => `<option value="${s}" ${f.entreprise === s ? "selected" : ""}>${esc(tidy(entName(s)))} (${base.filter(e => e.entreprises?.includes(s)).length} documents)</option>`).join("")}</select></div>` : ""}
        ${ctx.entreprise ? (() => { const bs = [...new Set(base.filter(e => e.t === "attribution").map(e => buyerOf(e)).filter(Boolean))].sort((a, b) => buyerName(a).localeCompare(buyerName(b), "fr"));
          return `<div><label for="f-cl" class="lg">Cliente</label><select id="f-cl" data-s="acheteur"><option value="">Toutes les clientes</option>${bs.map(b => `<option value="${b}" ${f.acheteur === b ? "selected" : ""}>${esc(buyerName(b))}</option>`).join("")}</select></div>`; })() : ""}
        ${arrs.length ? `<div><label for="f-arr" class="lg">Arrondissement</label><select id="f-arr" data-s="arr"><option value="">Tous les arrondissements</option>${arrs.map(x => `<option ${f.arr === x ? "selected" : ""}>${esc(x)}</option>`).join("")}</select></div>` : ""}
        ${ctx.explorer ? `<div><label for="f-dep" class="lg">Département</label><select id="f-dep" data-s="dep"><option value="">Tous les départements</option>${[...PILOTE].map(d => `<option value="${d}" ${f.dep === d ? "selected" : ""}>${d} · ${DEPS[d]}</option>`).join("")}</select></div>
          <div><label for="f-dis" class="lg">Dispositif</label><select id="f-dis" data-s="dispositif"><option value="">Tous les dispositifs</option>${Object.entries(DISPOSITIFS).map(([k, v]) => `<option value="${k}" ${f.dispositif === k ? "selected" : ""}>${v}</option>`).join("")}</select></div>
          <label class="opt box"><input type="checkbox" data-c="pilote" ${f.pilote ? "checked" : ""}><span><strong>Zone collectée seulement</strong><br><span class="muted" style="font-size:14px">sans les contrats d'Alphaiota hors de Paris, du Rhône, des Bouches-du-Rhône et de l'Île-de-France</span></span></label>` : ""}
        ${hasMix ? `<fieldset><legend>Contrats qui ne sont pas que de la vidéo</legend><p class="muted" style="margin:0 0 10px;font-size:15px">Par défaut, on ne compte que les contrats de vidéosurveillance. Certains mêlent la vidéo à autre chose : on ne sait pas quelle part va aux caméras.</p>
          <label class="opt box"><input type="checkbox" data-c="mixtes_surete" ${f.mixtes_surete ? "checked" : ""}><span><strong>Vidéo + alarmes des bâtiments</strong><br><span class="muted" style="font-size:14px">intrusion, contrôle d'accès des bâtiments</span></span></label>
          <label class="opt box"><input type="checkbox" data-c="mixtes_autres" ${f.mixtes_autres ? "checked" : ""}><span><strong>Vidéo + autres prestations</strong><br><span class="muted" style="font-size:14px">gardiennage, incendie, éclairage public</span></span></label></fieldset>` : ""}
        ${hasPhoto ? `<label class="opt box"><input type="checkbox" data-c="masquer" ${f.masquer ? "checked" : ""}><span><strong>Masquer les photographies aériennes et les exercices</strong><br><span class="muted" style="font-size:14px">des drones autorisés à prendre des photos, ou à filmer pour un exercice</span></span></label>` : ""}
      </div>
      <div class="ft"><button type="button" class="btn" data-reset>Tout effacer</button><button type="button" class="btn ink" data-ok>Voir ${plural(n, "document")}</button></div></section>`;
  };
  const close = ok => { bg.remove(); document.removeEventListener("keydown", key); if (ok) { state.filters = f; state.limit = PAGE; apply(); document.querySelector("[data-filtres]")?.focus(); } else opener?.focus?.(); };
  const key = ev => { if (ev.key === "Escape") close(false); if (ev.key === "Tab") { const fs = [...bg.querySelectorAll("button, input, select, a[href]")], i = fs.indexOf(document.activeElement);
    if (ev.shiftKey && i <= 0) { ev.preventDefault(); fs[fs.length - 1].focus(); } else if (!ev.shiftKey && i === fs.length - 1) { ev.preventDefault(); fs[0].focus(); } } };
  bg.addEventListener("click", ev => {
    const t = ev.target;
    if (t === bg || t.closest("[data-x]")) return close(false);
    if (t.closest("[data-ok]")) return close(true);
    if (t.closest("[data-reset]")) { for (const k of Object.keys(f)) if (k !== "nature" && !(ctx.explorer && k === "pilote")) delete f[k]; draw(); bg.querySelector("[data-reset]").focus(); return; }
    const an = t.closest("[data-an]"); if (an) { f.annee = an.dataset.an; draw(); bg.querySelector(`[data-an="${CSS.escape(an.dataset.an)}"]`).focus(); }
  });
  bg.addEventListener("change", ev => {
    const t = ev.target, sel = t.dataset.s ? `[data-s="${t.dataset.s}"]` : t.dataset.c ? `[data-c="${t.dataset.c}"]` : `input[name="qui"][value="${t.value}"]`;
    if (t.name === "qui") f.qui = t.value; else if (t.dataset.s) f[t.dataset.s] = t.value; else if (t.dataset.c) f[t.dataset.c] = t.checked ? "1" : "";
    draw(); bg.querySelector(sel)?.focus();
  });
  document.addEventListener("keydown", key);
  draw(); document.body.append(bg); bg.querySelector("[data-x]").focus();
}
function bindDocs(base, rerender, name, ctx) {
  document.querySelectorAll("[data-f]").forEach(b => b.onclick = () => { state.filters[b.dataset.f] = b.dataset.v; state.limit = PAGE; rerender(); document.querySelector(`[data-f="${b.dataset.f}"][data-v="${CSS.escape(b.dataset.v)}"]`)?.focus(); });
  const q = $("[data-q]"); if (q) q.onchange = () => { state.q = q.value; state.limit = PAGE; rerender(); $("[data-q]")?.focus(); };
  const fb = $("[data-filtres]"); if (fb) fb.onclick = () => openFilters(base, ctx, rerender);
  const more = $("[data-more]"); if (more) more.onclick = () => { const n = state.limit; state.limit += PAGE; rerender(); document.querySelectorAll("ul.docs .sum")[n]?.focus(); };
  document.querySelectorAll("[data-export]").forEach(b => b.onclick = () => exportRows(filterRows(base, state.filters, state.q), b.dataset.export, name));
}
function pageDocuments(insee, hl) {
  const c = commune(insee), all = rowsOfCommune(insee);
  if (state.filters.qui === "prives" && !state.filters.nature) state.filters.nature = "aut";
  const ctx = { commune: true, territorial: true, dep: c.dep };
  const render = () => {
    const rows = filterRows(all, state.filters, state.q);
    $("#app").innerHTML = `${crumbs(insee, "Documents")}${ident(c, "", c.nom)}${tabs(insee, "doc", all.length)}${docbar(all, state.filters, ctx)}<main>${yearsHTML(rows, { mandats: true, hl, ctx: { page: "commune", insee } })}${downloads()}${all.length ? "" : ""}</main>
      <div style="padding:24px 0 32px">${foot(insee, false)}</div>`;
    bindDocs(all, render, `commune-${insee}`, ctx);
    if (hl) document.getElementById(`ev-${CSS.escape(hl)}`)?.scrollIntoView({ block: "center" });
  };
  render();
}

// --- histories -----------------------------------------------------------------------------------
function histHead(a, tag, title, sub) {
  const c = a.insee ? commune(a.insee) : null;
  return `<div class="ident histo">${c ? `<a class="backlink" href="#/commune/${a.insee}/dossier">← ${esc(c.nom)}, tous les documents</a>` : `<a class="backlink" href="#/explorer">← Rechercher dans le registre</a>`}
    <div style="margin-top:4px"><span class="tag histo">${tag}</span></div><h1 ${title.length > 70 ? 'class="long"' : ""}>${title}</h1><p class="tw">${sub}</p></div>`;
}
function askBox(title, q, obj, quiq, insee) {
  return `<section class="ask" aria-labelledby="h-avant"><h2 id="h-avant" class="h2" style="font-size:21px">${title}</h2><p style="margin:0">${q}</p>
    <div class="tpl">${esc(demande(obj, quiq, insee).split("\n").slice(2, 6).join("\n"))}…</div>
    <div class="btns"><button type="button" class="btn" data-demande="${esc(obj)}" data-qui="${quiq}" data-insee="${insee}">Copier le modèle</button><a class="btn" href="https://madada.fr/" target="_blank" rel="noopener">Faire la demande sur Ma Dada ↗</a></div>
    <p class="note">Sur Ma Dada, la demande et la réponse sont publiques. Nous n'envoyons rien à votre place.</p></section>`;
}
function pageAffaire(id, hl) {
  const a = affaire(id);
  if (!a) { $("#app").innerHTML = `<main class="hist"><p>Historique introuvable : ${esc(id)}</p></main>`; return; }
  const es = a.events.map(i => EV[i]), c = commune(a.insee), last = es[es.length - 1];
  const rowsList = `<section aria-labelledby="h-docs"><h2 id="h-docs" class="h2" style="margin-bottom:8px">${es.length > 1 ? `Les ${es.length} documents` : "Le document"}</h2><ul class="docs">${es.slice().reverse().map(e => docRow(e, { hl, noaff: true, ctx: { page: "affaire" } })).join("")}</ul></section>`;
  let tag, title, sub, body = "";
  if (a.kind === "dossier") {
    const com = isCommunal(last);
    tag = "Historique · autorisation";
    const multi = new Set(es.map(e => e.insee)).size > 1, masked = last.beneficiaire === "[non retenu]";
    title = com ? `Les caméras de la ${last.type_beneficiaire === "epci" ? "intercommunalité" : `mairie de ${esc(c.nom)}`}`
      : `Les caméras ${masked ? "d'un commerce ou d'une entreprise (nom masqué)" : `de ${esc(benefLabel(last))}`}${a.insee && !multi ? ` à ${esc(c.nom)}` : multi ? `, sur ${new Set(es.map(e => e.insee)).size} sites` : ""}`;
    sub = `${esc(emetteur(last))} · dossier n° ${esc(dossierNo(a.id))}${a.origine_annee ? `, ouvert en ${a.origine_annee}` : ""}`;
    const pts = (a.cameras || []).filter(p => p.n != null);
    const groups = pts.filter(p => p.groupe), singles = es.filter(e => e.cameras != null);
    if (groups.length) {
      const g = groups[0];
      body += `<section aria-labelledby="h-evol" style="display:flex;flex-direction:column;gap:12px"><h2 id="h-evol" class="h2">${plural(g.groupe, "arrêté")} le même jour, pour ${plural(g.groupe, "site différent", "sites différents")}</h2>
        <p style="margin:0">${plural(g.n, "caméra")} en tout, de ${g.min} à ${g.max} par site. Des sites différents : aucun écart à calculer.</p>
        <ul class="facts">${es.map(e => `<li><span><strong>${esc(commune(e.insee).nom)}</strong> (${esc(DEPS[e.dep] || e.dep)}) · ${plural(e.cameras || 0, "caméra")}<br><span class="muted">${esc(e.note_lieu || "")}${e.publie_par ? `${e.note_lieu ? " · " : ""}publié par la ${esc(e.publie_par)}` : ""}</span></span></li>`).join("")}</ul></section>`;
    } else if (singles.length) {
      const first = singles[0], fin = singles[singles.length - 1], dl = fin.cameras - first.cameras, m = monthsBetween(first.date, fin.date);
      const h2 = singles.length > 1 ? (dl ? `${sign(dl)} caméras en ${m} mois` : `${plural(fin.cameras, "caméra")}, sans changement en ${m} mois`) : `${plural(fin.cameras, "caméra")} autorisée${fin.cameras > 1 ? "s" : ""}`;
      const max = Math.max(...singles.map(e => e.cameras)), bat = fin.cameras_vp != null ? fin.cameras - fin.cameras_vp : null;
      const alt = singles.map((e, i) => `${longDate(e.date)} : ${e.cameras} caméras${e.cameras_vp != null ? ` dont ${e.cameras_vp} sur la rue` : ""}${i ? `, ${sign(e.cameras - singles[i - 1].cameras)}` : ""}.`).join(" ");
      body += `<section aria-labelledby="h-evol" style="display:flex;flex-direction:column;gap:14px"><h2 id="h-evol" class="h2">${h2}</h2>
        <div class="evol" role="img" aria-label="${esc(alt)}">${singles.slice().reverse().map((e, i, arr) => { const prev = arr[i + 1];
          return `<div class="st"><div class="row1"><span class="tw muted" style="font-size:14px">${fmtD(e.date)}</span><span><span class="tot">${e.cameras}</span>${prev ? ` <span class="delta">${sign(e.cameras - prev.cameras)}</span>` : ""}</span></div>
          <div class="bars" style="width:${Math.round(e.cameras / max * 100)}%">${e.cameras_vp != null ? `<span class="rue" style="width:${Math.round(e.cameras_vp / e.cameras * 100)}%"></span><span class="bat"></span>` : `<span class="bat"></span>`}</div></div>`; }).join("")}
          <div class="lg"><span><span class="sw-r" aria-hidden="true"></span>filment la rue</span><span><span class="sw-b" aria-hidden="true"></span>bâtiments et abords${bat != null ? ` (${bat})` : ""}</span></div></div></section>`;
    }
    const src = a.echeance_source ? EV[a.echeance_source] : null;
    const iH = ib(`Lu dans l'arrêté du ${longDate(last.date)}, ${last.relu ? "vérifié à la main" : "extrait automatiquement"}${src && src.id !== last.id ? ` ; durée lue dans l'arrêté du ${fmtD(src.date)}` : ""}. Une option que l'arrêté ne cite pas est « non mentionnée », jamais « non ».`, "D'où viennent ces valeurs");
    body += `<section aria-labelledby="h-auj" style="display:flex;flex-direction:column;gap:10px"><div class="tline"><h2 id="h-auj" class="h2">Ce qui est autorisé aujourd'hui</h2>${iH.btn}</div>${iH.box}
      <dl class="kv"><dt>Caméras</dt><dd>${groups.length ? groups[0].n : last.cameras ?? "non précisé"}</dd><dt>Vidéoverbalisation</dt><dd>${last.videoverbalisation ? "oui" : "non mentionnée"}</dd>
      <dt>Images transmises à la police ou à la gendarmerie</dt><dd>${last.deport_forces ? "oui" : "non mentionné"}</dd><dt>Valable jusqu'au</dt><dd>${a.echeance ? fmtD(a.echeance) : "non précisé"}</dd></dl></section>`;
    if (!groups.length) body += `<section aria-labelledby="h-etapes" style="display:flex;flex-direction:column;gap:10px"><h2 id="h-etapes" class="h2">${es.length > 1 ? `Les ${es.length} arrêtés publiés` : "L'arrêté publié"}</h2>
      ${es.slice().reverse().map(e => `<div class="acte"><div class="row1"><strong>${longDate(e.date)}</strong><span style="font-weight:800">${e.cameras != null ? plural(e.cameras, "caméra") : ""}</span></div>
        <p class="note">${esc(emetteur(e))}, acte ${esc(e.id)}${e.relu ? " · vérifié à la main" : ""}</p>
        <div class="btns">${e.url ? `<a class="btn small" href="${esc(e.url)}" target="_blank" rel="noopener">Voir le document ↗</a>` : ""}<button type="button" class="btn small" data-cite="${esc(e.id)}">Copier la référence</button></div></div>`).join("")}</section>`;
    if (com && a.origine_annee && a.origine_annee < +a.debut.slice(0, 4) - 1)
      body += askBox(`De ${a.origine_annee} à ${+a.debut.slice(0, 4) - 1} : introuvable en ligne`, `Combien de caméras la préfecture a-t-elle autorisées au départ, et comment leur nombre a-t-il évolué ? Les arrêtés existent, mais ne sont pas publiés en ligne. Tout le monde peut les demander gratuitement.`,
        `les arrêtés d'autorisation de vidéoprotection du dossier n° ${dossierNo(a.id)} (commune de ${c.nom}), de ${a.origine_annee} à ${+a.debut.slice(0, 4) - 1}`, "prefecture", a.insee);
  } else if (a.kind === "contrat") {
    const at = es.find(e => e.t === "attribution") || es[0], mods = es.filter(e => e.t === "modification");
    const amounts = es.map(e => e.montant).filter(v => v != null), first = amounts[0], lastA = amounts[amounts.length - 1];
    tag = "Historique · contrat"; title = esc(calm(a.titre || at.objet || id)); sub = `${esc(buyerName(a.acheteur_siren))} · données de la commande publique`;
    const h2 = first !== lastA ? `De ${eur(first)} à ${eur(lastA)} au maximum` : `${eur(lastA)} au maximum${mods.length ? `, ${plural(mods.length, "modification")}` : ""}`;
    const avis = (a.avis_probables || []).map(x => affaire(x)).filter(Boolean);
    const end = at.duree ? addMonths(at.date, at.duree) : null;
    body += `<section aria-labelledby="h-evol" style="display:flex;flex-direction:column;gap:12px"><h2 id="h-evol" class="h2">${h2}</h2>
      <ol class="steps">${avis.map(x => `<li><span class="when">${fmtD(x.debut)}</span><p><strong>Appel d'offres</strong> · ${esc(EV[x.events[0]].ref)} <span class="muted">(lien probable ${glo("lien-probable")})</span></p></li>`).join("")}
      <li><span class="when">${fmtD(at.date)}</span><p><strong>Contrat signé</strong>${at.entreprises?.length ? ` avec ${at.entreprises.map(entLink).join(", ")}` : ""} · ${eur(at.montant)} au maximum${at.duree ? ` · ${at.duree} mois` : ""}${at.offres ? ` · ${plural(at.offres, "offre reçue", "offres reçues")}` : ""}</p></li>
      ${mods.map(e => `<li><span class="when">${fmtD(e.date)}</span><p><strong>Modification ${e.modif_n}</strong> : ${esc(e.changements?.length ? e.changements.join(", ") : NO_CHANGE)}.</p></li>`).join("")}</ol></section>
      <section aria-labelledby="h-kv" style="display:flex;flex-direction:column;gap:10px"><h2 id="h-kv" class="h2">Ce que dit le contrat</h2><dl class="kv">
        <dt>Acheteur</dt><dd>${buyerLink(a.acheteur_siren)}</dd><dt>${(at.entreprises || []).length > 1 ? "Entreprises, ensemble" : "Entreprise"}</dt><dd>${(at.entreprises || []).map(entLink).join(" + ") || "non publiée"}</dd>${a.insee ? `<dt>Commune</dt><dd>${comLink(a.insee)}</dd>` : ""}
        <dt>Montant maximum</dt><dd>${eur(lastA)}</dd><dt>Durée</dt><dd>${at.duree ? `${at.duree} mois` : "non publiée"}</dd>${end ? `<dt>Fin prévue</dt><dd>${fmtD(end)}</dd>` : ""}
        <dt>Offres reçues</dt><dd>${at.offres ?? "non publiées"}</dd>${a.dispositif ? `<dt>Dispositif</dt><dd>${DISPOSITIFS[a.dispositif] || ""}</dd>` : ""}</dl>
        ${lines(at)[1].map(f => `<p class="flagline">${f}</p>`).join("")}</section>`;
    if (a.subventions_probables?.length) body += `<p style="margin:0">Subvention qui l'a peut-être financé : ${a.subventions_probables.map(sid => `<a href="#/affaire/${sid}">${esc(EV[affaire(sid).events[0]].ref)}</a>`).join(", ")} (lien probable ${glo("lien-probable")}).</p>`;
  } else if (a.kind === "contrat_non_retrouve") {
    tag = "Historique · appel d'offres"; title = esc(calm(a.titre || es[0].objet || id)); sub = `${esc(calm(es[0].acheteur || ""))} · BOAMP`;
    const cp = a.contrat_probable ? affaire(a.contrat_probable) : null, lp = a.lien_probable || {};
    body += `<section aria-labelledby="h-evol" style="display:flex;flex-direction:column;gap:12px"><h2 id="h-evol" class="h2">${cp ? "Contrat probablement signé à la suite" : "Pas encore de contrat publié"}</h2>
      <ol class="steps">${es.map(e => `<li><span class="when">${fmtD(e.date)}</span><p><strong>${esc(nat(e))}</strong> · ${esc(e.ref)}</p></li>`).join("")}
      ${cp ? `<li><span class="when">${fmtD(cp.debut)}</span><p><strong>Contrat signé</strong> : <a href="#/affaire/${encodeURIComponent(a.contrat_probable)}">${esc(calm(cp.titre))}</a> <span class="muted">(lien probable : ${esc(lp.regle || "")}${lp.jours ? `, ${lp.jours} jours après l'avis` : ""}) ${glo("lien-probable")}</span></p></li>` : ""}</ol></section>`;
    if (!cp && a.debut >= "2019" && a.insee) body += askBox("Le contrat : introuvable en ligne", `Avec quelle entreprise, et pour quel montant ? Le contrat n'est pas encore publié dans les données de la commande publique.`, `le contrat conclu à la suite de l'avis publié le ${fmtD(a.debut)} au BOAMP (${es[0].ref}), avec son montant`, "mairie", a.insee);
  } else if (a.kind === "subvention") {
    const e = es[0];
    tag = "Historique · subvention"; title = esc(calm(e.objet || a.titre || "Subvention")); sub = `${esc(emetteur(e))} · ${fmtD(e.date)}`;
    body += `<section aria-labelledby="h-evol" style="display:flex;flex-direction:column;gap:12px"><h2 id="h-evol" class="h2">${eur(e.montant)}${e.cameras ? ` pour ${plural(e.cameras, "caméra")}` : ""}</h2>
      <dl class="kv"><dt>Bénéficiaire</dt><dd>${esc(c.nom)}</dd>${e.base ? `<dt>Montant des travaux</dt><dd>${eur(e.base)}</dd>` : ""}${e.taux ? `<dt>Taux</dt><dd>${e.taux} %</dd>` : ""}</dl>
      ${a.contrat_probable ? `<p style="margin:0">Contrat qu'elle a peut-être financé : <a href="#/affaire/${encodeURIComponent(a.contrat_probable)}">${esc(calm(affaire(a.contrat_probable).titre))}</a> (lien probable ${glo("lien-probable")}).</p>` : ""}</section>`;
  } else {
    const e = es[0];
    tag = e.t === "arrete_vsa" ? "Historique · analyse algorithmique" : e.t === "arrete_drone" ? "Historique · drones" : "Historique · autorisation";
    title = esc(nat(e)); sub = `${esc(emetteur(e))} · acte ${esc(e.id)}`;
    const z = ZONES.filter(x => x.acte === e.id);
    body += `<section aria-labelledby="h-evol" style="display:flex;flex-direction:column;gap:12px"><h2 id="h-evol" class="h2">${e.t === "arrete_vsa" ? "Analyse des images" : "Drones"} ${a.insee ? `à ${esc(c.nom)}` : ""}</h2>
      <dl class="kv"><dt>Service</dt><dd>${esc(benefLabel(e))}</dd><dt>Période</dt><dd>${esc((e.periode || "non précisée").replace(/(\d{4})-(\d\d)-(\d\d)/g, (m, y, mo, d) => `${d}/${mo}/${y}`))}</dd>
      ${z.length ? `<dt>Créneaux</dt><dd>${z.length}</dd>` : ""}${e.cameras != null ? `<dt>${e.t === "arrete_drone" ? "Drones" : "Caméras"}</dt><dd>${e.cameras}</dd>` : ""}</dl>
      ${e.objet ? `<p style="margin:0">Zone : ${esc(tidy(e.objet))}</p>` : ""}${e.publie_par ? `<p class="note">Publié par la ${esc(e.publie_par)}.</p>` : ""}
      ${a.insee && (z.length || CARTE_N[a.insee] != null) ? `<a class="ghost" href="#/commune/${a.insee}/carte?acte=${encodeURIComponent(e.id)}">Voir sur la carte →</a>` : ""}</section>`;
  }
  $("#app").innerHTML = `${histHead(a, tag, title, sub)}<main class="hist">${body}${rowsList}<button type="button" class="linkbtn" data-signal="${esc(last.id)}">Signaler une erreur</button></main>`;
  if (hl) document.getElementById(`ev-${CSS.escape(hl)}`)?.scrollIntoView({ block: "center" });
}

// --- company, explorer, home, glossary ------------------------------------------------------------
// --- maps of communes, one strip for all (département, « Autour de… », a company's clientes, Explorer) ---------
// Each commune is a link: hover, keyboard focus or a first touch writes it in the strip above the map
// (name, département, one line of figures, « voir la commune → »); a second touch, a click or Enter opens it.
// At rest the strip gives the map's summary. Nothing opens over the map; the page never moves.
const DOM = { "971": "Guadeloupe", "972": "Martinique", "973": "Guyane", "974": "La Réunion", "976": "Mayotte" };
function smap(id, rest, svg, legend = "") {
  return `<div class="smap framed" data-smap="${id}" data-r1="${esc(rest[0])}" data-r2="${esc(rest[1])}">${stripHTML(`strip-${id}`, esc(rest[0]), esc(rest[1]))}${svg}${legend ? `<p class="legend smap-l">${legend}</p>` : ""}</div>`;
}
const smapItem = (insee, l2, extra = "") => { const c = commune(insee); return `href="#/commune/${insee}" data-c="${insee}" data-l1="${esc(`${c.nom} · ${DEPS[c.dep] || c.dep}`)}" data-l2="${esc(l2)}" aria-label="${esc(`${c.nom}, ${l2}`)}" ${extra}`; };
function smapShow(a) {
  const box = a.closest("[data-smap]"), s = box?.querySelector(".strip"); if (!s) return;
  box.querySelectorAll(".hot").forEach(x => x.classList.remove("hot")); a.classList.add("hot");
  const list = a.dataset.list ? JSON.parse(a.dataset.list) : null;
  s.innerHTML = list ? `<b>${esc(a.dataset.l1)}</b><span>${list.map(k => `<a href="#/commune/${k}">${esc(commune(k).nom)} →</a>`).join(" · ")}</span>`
    : `<b>${esc(a.dataset.l1)}</b><span>${esc(a.dataset.l2)} · <a href="${a.getAttribute("href")}">${esc(a.dataset.go || "voir la commune")} →</a></span>`;
}
function smapRest(box) { const s = box.querySelector(".strip"); box.querySelectorAll(".hot").forEach(x => x.classList.remove("hot")); s.innerHTML = `<b>${esc(box.dataset.r1)}</b><span>${esc(box.dataset.r2)}</span>`; }
let _touch = false;
document.addEventListener("pointerdown", ev => { _touch = ev.pointerType === "touch"; }, true);
document.addEventListener("mouseover", ev => { const a = ev.target.closest("[data-smap] a[data-c]"); if (a) smapShow(a); });
document.addEventListener("mouseout", ev => { const box = ev.target.closest("[data-smap]"); if (box && !box.contains(ev.relatedTarget)) smapRest(box); });
document.addEventListener("focusin", ev => { const a = ev.target.closest("[data-smap] a[data-c]"); if (a) smapShow(a); });
document.addEventListener("click", ev => {
  const a = ev.target.closest("[data-smap] a[data-c]"); if (!a) return;
  // a first touch shows, a second one opens; a cluster of points only lists its communes
  if (a.dataset.list || (_touch && !a.classList.contains("hot-touch"))) { ev.preventDefault(); a.closest("[data-smap]").querySelectorAll(".hot-touch").forEach(x => x.classList.remove("hot-touch")); a.classList.add("hot-touch"); smapShow(a); }
}, true);

// points of a company or a search, merged when they overlap (« 2 clientes »)
function pointsMap(points, what = "contrat", rest = ["", ""], who = "cliente") {
  const C = window.CENTRES || {}, X = lon => 150 + (lon - 2.4) * 22 * Math.cos(46.5 * Math.PI / 180), Y = lat => 150 - (lat - 46.5) * 22;
  const r = p => Math.min(9, 3.2 + Math.sqrt(p.n) * 1.1);
  const fig = p => `${plural(p.n, what)}${p.montant ? ` · ${eur(p.montant)} au maximum` : ""}${p.last ? ` · dernier : ${moisAn(p.last)}` : ""}`;
  const place = pts => { const out = [];
    for (const p of pts.slice().sort((a, b) => b.n - a.n)) { const q = out.find(o => Math.hypot(o.x - p.x, o.y - p.y) < o.r + r(p) + 1);
      if (q) { q.members.push(p); q.n += p.n; q.montant += p.montant; q.r = Math.min(10, q.r + 1); } else out.push({ ...p, members: [p], r: r(p) }); }
    return out; };
  const metro = place(points.filter(p => !p.insee.startsWith("97") && C[p.insee]).map(p => ({ ...p, x: X(C[p.insee][0]), y: Y(C[p.insee][1]) })));
  const dom = points.filter(p => p.insee.startsWith("97")), insets = [...new Set(dom.map(p => p.insee.slice(0, 3)))];
  const dot = (p, cx, cy, rr) => p.members && p.members.length > 1
    ? `<a href="#" data-c="${p.members[0].insee}" data-list="${esc(JSON.stringify(p.members.map(m => m.insee)))}" data-l1="${esc(`${p.members.length} ${who}s : ${p.members.map(m => commune(m.insee).nom).join(", ")}`)}" data-l2="" aria-label="${esc(`${p.members.length} ${who}s proches : ${p.members.map(m => commune(m.insee).nom).join(", ")}`)}"><circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${rr.toFixed(1)}" class="pt multi"></circle><text x="${cx.toFixed(1)}" y="${(cy + 3).toFixed(1)}" text-anchor="middle" font-size="8" class="ptn">${p.members.length}</text></a>`
    : `<a ${smapItem(p.insee, fig(p.members ? p.members[0] : p))}><circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${rr.toFixed(1)}" class="pt"></circle></a>`;
  const svg = `<svg viewBox="0 0 300 ${insets.length ? 310 : 300}" role="group" aria-label="Carte des communes">${(window.FOND || []).map(([lo, la]) => `<circle cx="${X(lo).toFixed(1)}" cy="${Y(la).toFixed(1)}" r="0.9" class="fond" aria-hidden="true"/>`).join("")}
    ${metro.map(p => dot(p, p.x, p.y, p.r)).join("")}
    ${insets.map((d, i) => `<g transform="translate(${6 + i * 72} 262)"><rect width="64" height="44" class="inset"/><text x="32" y="12" font-size="8.5" text-anchor="middle" class="ptn">${DOM[d] || d}</text>${dom.filter(p => p.insee.startsWith(d)).slice(0, 3).map((p, k) => dot(p, 18 + k * 14, 28, r(p))).join("")}</g>`).join("")}</svg>`;
  return smap(`pts${++_ib}`, rest, svg);
}

const pointsOf = rows => { const by = {}; rows.filter(e => e.insee).forEach(e => { const p = by[e.insee] ||= { insee: e.insee, n: 0, montant: 0, last: "" }; p.n++; if (e.date > p.last) p.last = e.date; if (e.t === "attribution" && !e.hors_totaux) p.montant += e.montant || 0; }); return Object.values(by); };

// --- company (maquette « Entreprise ») ------------------------------------------------------------------
const SEUILS = window.SEUILS || [];
const seuilsAt = d => SEUILS.filter(x => x.portee !== "travaux" && x.acheteurs !== "etat" && x.debut <= d && (!x.fin || d <= x.fin))
  .map(x => ({ ...x, nom: /dispense/.test(x.nom) ? "sans publicité ni mise en concurrence en dessous" : /publicit/.test(x.nom) ? "publicité obligatoire au-dessus" : /europ/.test(x.nom) ? "procédure européenne au-dessus" : x.nom }));
// a computed sentence: each buyer it names becomes a link (its full name, or its commune's name)
function linkNames(phrase, sirens) {
  let h = esc(phrase);
  for (const b of sirens) {
    const ci = communeOfBuyer(b) || ACH[b]?.insee_siege, cand = [buyerName(b), ci && commune(ci).nom].filter(Boolean).sort((x, y) => y.length - x.length);
    for (const nm of cand) { const e = esc(nm), i = h.indexOf(e); if (i >= 0 && !h.slice(0, i).endsWith(">")) { h = h.slice(0, i) + (communeOfBuyer(b) ? comLink(communeOfBuyer(b), nm) : nm === buyerName(b) ? `<a href="#/acheteur/${b}">${e}</a>` : comLink(ci, nm)) + h.slice(i + e.length); break; } }
  }
  return h;
}
function pageEntreprise(siren) {
  const x = R.entreprises[siren];
  if (!x) { $("#app").innerHTML = `<main class="hist"><p>Entreprise inconnue : ${esc(siren)}</p></main>`; return; }
  const all = R.evenements.filter(e => e.entreprises?.includes(siren)).sort(byDateDesc);
  const contrats = all.filter(e => e.t === "attribution").sort(byDateAsc), comptes = contrats.filter(e => !e.hors_totaux && !e.national && !isCopy(e));
  const name = tidy(entName(siren)), total = comptes.reduce((t, e) => t + (e.montant || 0), 0);
  const clientes = {};
  contrats.forEach(e => { const b = buyerOf(e) || `?${e.insee}`, c = clientes[b] ||= { b, n: 0, montant: 0, last: "", insee: communeOfBuyer(buyerOf(e)) || e.insee }; c.n++; if (e.date > c.last) c.last = e.date; if (!e.hors_totaux && !e.national) c.montant += e.montant || 0; });
  const cl = Object.values(clientes), nameOf = c => c.b.startsWith("?") ? commune(c.insee).nom : buyerName(c.b);
  // what she sells: the most frequent kind of contract (a curated sentence for Alphaiota)
  const cats = {}; contrats.forEach(e => { const k = affaire(e.affaire)?.categorie; if (k) cats[k] = (cats[k] || 0) + 1; });
  const top = Object.entries(cats).sort((a, b) => b[1] - a[1])[0];
  const years = contrats.length ? Math.max(1, Math.round((decY(TODAY) - decY(contrats[0].date)) * 2) / 2) : 0;
  const vend = siren === "899832901" ? `Elle vend surtout des <strong>caméras déplaçables qui repèrent les dépôts sauvages</strong>, et le logiciel qui va avec.`
    : top ? `Ses contrats portent surtout sur : <strong>${esc(top[0])}</strong> (${top[1]} sur ${contrats.length}).` : "";
  const phrase = `${vend} En ${years.toLocaleString("fr-FR")} an${years > 1 ? "s" : ""}, <strong>${plural(cl.length, "collectivité")}</strong> lui ont signé un contrat.`;
  // L'argent: the staircase of the total signed, a point per contract
  const W = 358, H = 230, t0 = decY(contrats[0]?.date || TODAY), t1 = Math.max(decY(TODAY), t0 + 0.5), X = d => 40 + (decY(d) - t0) / (t1 - t0) * 305;
  let cum = 0; const maxY = Math.max(1, total), Y = v => 200 - v / maxY * 180;
  let path = `M40,${Y(0).toFixed(1)}`;
  const pts = contrats.map(e => { const x = X(e.date); path += ` L${x.toFixed(1)},${Y(cum).toFixed(1)}`; if (!e.hors_totaux && !e.national) cum += e.montant || 0; path += ` L${x.toFixed(1)},${Y(cum).toFixed(1)}`;
    return `<a href="#/affaire/${encodeURIComponent(e.affaire)}" data-c="${e.insee || ""}" data-go="voir le contrat" data-l1="${esc(`${longDate(e.date)} · ${nameOfE(e)}`)}" data-l2="${esc(`${eur(e.montant)} au maximum · total à cette date : ${eur(cum)}`)}" aria-label="${esc(`${longDate(e.date)}, ${nameOfE(e)}, ${eur(e.montant)}`)}"><circle cx="${x.toFixed(1)}" cy="${Y(cum).toFixed(1)}" r="3.5" class="pt"></circle><circle cx="${x.toFixed(1)}" cy="${Y(cum).toFixed(1)}" r="9" fill="transparent"></circle></a>`; });
  function nameOfE(e) { const b = buyerOf(e); return b ? buyerName(b) : commune(e.insee).nom; }
  path += ` L345,${Y(cum).toFixed(1)}`;
  const grid = [0, .25, .5, .75, 1].map(k => `<line x1="40" x2="350" y1="${Y(maxY * k).toFixed(1)}" y2="${Y(maxY * k).toFixed(1)}" class="grid"/><text x="38" y="${(Y(maxY * k) + 4).toFixed(1)}" text-anchor="end" class="axis-t">${k ? (maxY * k >= 1e6 ? `${(maxY * k / 1e6).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} M€` : `${Math.round(maxY * k / 1000)} k€`) : "0"}</text>`).join("");
  const ys = []; for (let y = Math.ceil(t0); y <= Math.floor(t1); y++) ys.push(`<text x="${X(`${y}-01-01`).toFixed(1)}" y="222" text-anchor="middle" class="axis-t">${y}</text>`);
  const curve = `<svg viewBox="0 0 ${W} ${H}" role="group" aria-label="Le total signé, au maximum, contrat par contrat">${grid}<path d="${path}" class="step"/>${pts.join("")}${ys.join("")}</svg>`;
  // contracts per quarter
  const Q = []; for (let y = Math.floor(t0); y <= +TODAY.slice(0, 4); y++) for (let q = 1; q <= 4; q++) { const k = `${y}-${q}`; if (`${y}-${String(q * 3).padStart(2, "0")}` < (contrats[0]?.date || "").slice(0, 7)) continue; if (`${y}-${String(q * 3 - 2).padStart(2, "0")}` > TODAY.slice(0, 7)) break; Q.push({ k, y, q, n: contrats.filter(e => +e.date.slice(0, 4) === y && Math.ceil(+e.date.slice(5, 7) / 3) === q).length }); }
  const qmax = Math.max(1, ...Q.map(q => q.n));
  const quarters = `<div class="qbars" style="grid-template-columns:repeat(${Q.length},minmax(0,1fr))" role="img" aria-label="${esc(Q.map(q => `T${q.q} ${q.y} : ${q.n}`).join(", "))}">${Q.map(q => `<div><span class="tw">${q.n || ""}</span><span class="bar" style="height:${Math.max(2, Math.round(q.n / qmax * 54))}px;opacity:${q.n ? 1 : .3}"></span></div>`).join("")}</div>
    <div class="qlab tw" style="grid-template-columns:repeat(${Q.length},minmax(0,1fr))" aria-hidden="true">${Q.map(q => `<span>T${q.q}${q.q === 1 ? ` ${String(q.y).slice(2)}` : ""}</span>`).join("")}</div>`;
  // the amounts one by one, with the procedure thresholds in force at the last contract
  const amax = Math.max(1, ...contrats.map(e => e.montant || 0)) * 1.08, AX = v => 12 + v / amax * 334, bins = {};
  const th = seuilsAt(contrats.length ? contrats[contrats.length - 1].date : TODAY).filter(t => t.montant_ht < amax);
  const dots = contrats.map(e => { const b = Math.round(AX(e.montant || 0) / 9); bins[b] = (bins[b] || 0) + 1; const yy = 113 - (bins[b] - 1) * 10.5;
    return `<a href="#/affaire/${encodeURIComponent(e.affaire)}" data-c="${e.insee || ""}" data-go="voir le contrat" data-l1="${esc(`${eur(e.montant)} · ${nameOfE(e)}`)}" data-l2="${esc(longDate(e.date))}" aria-label="${esc(`${eur(e.montant)}, ${nameOfE(e)}`)}"><circle cx="${AX(e.montant || 0).toFixed(1)}" cy="${Math.max(18, yy).toFixed(1)}" r="5" class="pt"></circle></a>`; });
  const ticks = [0, .25, .5, .75, 1].map(k => `<text x="${AX(amax / 1.08 * k).toFixed(1)}" y="138" text-anchor="middle" class="axis-t">${eur(Math.round(amax / 1.08 * k / 1000) * 1000).replace(" 000 €", " k€")}</text>`).join("");
  const amounts = `<svg viewBox="0 0 358 150" role="group" aria-label="Chaque contrat placé selon son montant maximum">${th.map(t => `<line x1="${AX(t.montant_ht).toFixed(1)}" x2="${AX(t.montant_ht).toFixed(1)}" y1="14" y2="120" class="seuil"/><text x="${AX(t.montant_ht).toFixed(1)}" y="11" text-anchor="middle" class="seuil-t">${eur(t.montant_ht)}</text>`).join("")}<line x1="12" x2="346" y1="120" y2="120" class="base"/>${dots.join("")}${ticks}</svg>`;
  const facts = (window.FAITS || {})[siren] || [];
  const iA = ib(`Chaque point : un contrat, placé selon son montant maximum hors taxes. Lignes pointillées : seuils de la commande publique en vigueur à la date du dernier contrat${th.length ? ` (${th.map(t => `${t.nom} : ${eur(t.montant_ht)}`).join(" ; ")})` : ""}, d'après le code de la commande publique (Légifrance). Les faits ci-dessous se calculent sur les données publiées ; ils ne disent rien des raisons.`, "Comment lire ce graphique");
  const co = {}; contrats.forEach(e => (e.entreprises || []).filter(y => y !== siren).forEach(y => { co[y] = (co[y] || 0) + 1; }));
  const coList = Object.entries(co).sort((a, b) => b[1] - a[1]);
  const SORTS = [["montant", "Plus gros montant"], ["contrats", "Plus de contrats"], ["recent", "Plus récentes"], ["az", "A → Z"]];
  let sort = "montant", showAll = false;
  const ctx = { commune: false, territorial: false, entreprise: siren };
  const clientList = () => { const L = cl.slice().sort({ montant: (a, b) => b.montant - a.montant, contrats: (a, b) => b.n - a.n || b.montant - a.montant, recent: (a, b) => b.last.localeCompare(a.last), az: (a, b) => nameOf(a).localeCompare(nameOf(b), "fr") }[sort]);
    const mx = Math.max(1, ...L.map(c => c.montant));
    return `<div role="group" aria-label="Trier les clientes" class="chips" style="padding:0">${SORTS.map(([k, l]) => `<button type="button" class="chip" aria-pressed="${sort === k}" data-sort="${k}">${l}</button>`).join("")}</div>
      <ol class="clients">${(showAll ? L : L.slice(0, 10)).map(c => `<li><span class="nm">${c.b.startsWith("?") ? comLink(c.insee) : buyerLink(c.b)}</span><strong class="am">${eur(c.montant)}</strong>
        <span class="meta">${esc(CAT[ACH[c.b]?.categorie] || "Commune")} · ${PILOTE.has(commune(c.insee).dep) ? `<a href="#/departement/${commune(c.insee).dep}">${esc(DEPS[commune(c.insee).dep])}</a>` : esc(DEPS[commune(c.insee).dep] || commune(c.insee).dep || "")} · ${plural(c.n, "contrat")} · dernier : ${fmtD(c.last)}</span><span class="minibar" aria-hidden="true"><span style="width:${Math.round(c.montant / mx * 100)}%"></span></span></li>`).join("")}</ol>
      ${!showAll && L.length > 10 ? `<button type="button" class="btn small" data-allcl style="align-self:flex-start">Voir les ${L.length} clientes</button>` : ""}`; };
  const render = () => {
    const rows = filterRows(all, state.filters, state.q);
    $("#app").innerHTML = `<div class="ident"><span class="tag ent">Entreprise</span><h1 class="${name.length > 18 ? "long" : ""}">${esc(name)}</h1><p class="tw">SIREN ${siren.replace(/(\d{3})(\d{3})(\d{3})/, "$1 $2 $3")}${x.naf_libelle ? ` · ${esc(x.naf_libelle.toLowerCase())}` : ""}</p>
      <p class="lead">${phrase}</p>
      <div class="three"><div><b>${contrats.length}</b><span>contrats signés</span></div><div><b>${cl.length}</b><span>clientes</span></div><div><b>${eur(total)}</b><span>au maximum</span></div></div></div>
      <nav class="tabs tri" aria-label="Sections"><a href="#/entreprise/${siren}" data-to="argent" aria-current="page">L'argent</a><a href="#/entreprise/${siren}" data-to="clientes">Clientes · ${cl.length}</a><a href="#/entreprise/${siren}" data-to="contrats">Contrats · ${all.length}</a></nav>
      <main class="ess" style="gap:40px">
      <section class="blk" id="argent" aria-labelledby="e-argent"><h2 id="e-argent" class="h2">L'argent, dans le temps</h2><p style="margin:0">Le total signé depuis le premier contrat. Chaque point : un contrat.</p>
        ${smap("argent", [`${eur(total)} au maximum, ${plural(contrats.length, "contrat")}`, "touchez un point"], curve)}
        <span style="font-weight:700">Contrats signés par trimestre</span>${quarters}
        <div class="tline" style="margin-top:10px"><h3 class="h3">Les montants, un par un</h3>${iA.btn}</div>${iA.box}
        ${smap("montants", [`${plural(contrats.length, "contrat")}, de ${eur(Math.min(...contrats.map(e => e.montant || 0)))} à ${eur(Math.max(...contrats.map(e => e.montant || 0)))}`, "touchez un point"], amounts)}
        ${facts.length ? `<ul class="faits">${facts.map(fa => `<li>${linkNames(fa.phrase.replace(/\bacheteurs\b/g, "clientes").replace(/\bacheteur\b/g, "cliente").replace(/même titulaire/g, "même entreprise").replace(/\btitulaires?\b/g, "entreprise").replace(/^./, m => m.toUpperCase()), fa.acheteurs || [])}</li>`).join("")}</ul>` : ""}</section>
      <section class="blk" id="clientes" aria-labelledby="e-cli"><h2 id="e-cli" class="h2">Ses ${plural(cl.length, "cliente")}</h2>
        ${pointsMap(pointsOf(contrats), "contrat", [`${plural(cl.length, "cliente")} dans ${plural(new Set(cl.map(c => commune(c.insee).dep)).size, "département")}`, "survolez ou touchez un point"])}
        <div id="cl">${clientList()}</div></section>
      ${coList.length ? `<section class="blk" aria-labelledby="e-co"><h2 id="e-co" class="h2">Avec qui elle répond</h2><ul class="results">${coList.map(([y, n]) => `<li>${entLink(y)}<br><span class="muted">${plural(n, "contrat")} en commun</span></li>`).join("")}</ul></section>` : ""}
      <section id="contrats" aria-labelledby="e-con"><h2 id="e-con" class="h2" style="padding:0 16px">Ses contrats · ${plural(all.length, "document")}</h2>${docbar(all, state.filters, ctx)}${yearsHTML(rows, { ctx: { page: "entreprise", siren } })}${downloads()}</section></main>
      <div style="padding:24px 0 32px">${foot("", false)}</div>`;
    bindDocs(all, render, `entreprise-${siren}`, ctx);
    const clb = () => { document.querySelectorAll("[data-sort]").forEach(b => b.onclick = () => { sort = b.dataset.sort; $("#cl").innerHTML = clientList(); clb(); $(`[data-sort="${sort}"]`)?.focus(); });
      const ab = $("[data-allcl]"); if (ab) ab.onclick = () => { showAll = true; $("#cl").innerHTML = clientList(); clb(); }; };
    clb();
    document.querySelectorAll(".tabs.tri [data-to]").forEach(a => a.onclick = ev => { ev.preventDefault(); document.getElementById(a.dataset.to)?.scrollIntoView({ block: "start" }); document.querySelectorAll(".tabs.tri a").forEach(x => x.toggleAttribute("aria-current", x === a)); });
  };
  render();
}
// --- buyer ------------------------------------------------------------------------------------------------
const CAT = { commune: "Commune", intercommunalite: "Intercommunalité", metropole: "Métropole", departement: "Département", region: "Région", transports: "Transports",
  bailleur: "Bailleur social", sante: "Santé", etat: "État", education: "Enseignement", autre: "Acheteur public" };
function pageAcheteur(siren) {
  const b = ACH[siren];
  if (!b) { $("#app").innerHTML = `<main class="hist"><p>Acheteur inconnu : ${esc(siren)}</p></main>`; return; }
  if (b.categorie === "commune" && b.insee_siege) { location.replace(`#/commune/${b.insee_siege}`); return; }
  const all = R.evenements.filter(e => buyerOf(e) === siren).sort(byDateDesc);
  const contrats = all.filter(e => e.t === "attribution"), comptes = contrats.filter(e => !e.hors_totaux && !e.national);
  const ents = [...new Set(contrats.flatMap(e => e.entreprises || []))].sort((a, c) => entName(a).localeCompare(entName(c)));
  const cover = (b.communes || []).filter(i => R.communes[i]).sort((a, c) => commune(a).nom.localeCompare(commune(c).nom));
  const ctx = { commune: false, territorial: false };
  const render = () => {
    const rows = filterRows(all, state.filters, state.q);
    $("#app").innerHTML = `<div class="ident"><span class="tag plain">${CAT[b.categorie] || "Acheteur public"}</span><h1 class="long">${esc(b.nom)}</h1><p class="tw">SIREN ${siren}${b.dep ? ` · ${esc(DEPS[b.dep] || b.dep)}` : ""}${b.insee_siege && R.communes[b.insee_siege] ? ` · siège à ${esc(commune(b.insee_siege).nom)}` : ""}</p></div>
      <main class="ess" style="gap:24px;padding-bottom:0"><p class="phrase">${contrats.length ? `Depuis ${year(contrats[contrats.length - 1])}, ${plural(contrats.length, "contrat")} de vidéosurveillance, pour <strong>${eur(comptes.reduce((s, e) => s + (e.montant || 0), 0))}</strong> au maximum, ${ents.length ? `avec ${plural(ents.length, "entreprise")}` : "entreprises non publiées"}.` : `Aucun contrat de vidéosurveillance publié ; ${plural(all.length, "document")}.`}</p>
      ${ents.length ? `<section class="blk" aria-labelledby="h-ae"><h2 id="h-ae" class="h2">Ses entreprises</h2><p style="margin:0">${ents.map(entLink).join(", ")}</p></section>` : ""}
      <section class="blk" aria-labelledby="h-ac"><h2 id="h-ac" class="h2">Les communes qu'il couvre</h2>${cover.length ? `<p style="margin:0">${cover.map(i => comLink(i)).join(", ")}</p><p class="note">${b.categorie === "metropole" || b.categorie === "intercommunalite" ? "Les communes membres, d'après le code officiel géographique (INSEE)." : "Les communes où ses contrats sont rattachés."}</p>`
        : `<p class="why">${b.categorie === "departement" || b.categorie === "region" ? "Tout son territoire." : "Pas de commune connue dans ses contrats."}</p>`}</section></main>
      ${docbar(all, state.filters, ctx)}<main>${yearsHTML(rows, { ctx: { page: "acheteur", siren } })}${downloads()}</main><div style="padding:24px 0 32px">${foot("", false)}</div>`;
    bindDocs(all, render, `acheteur-${siren}`, ctx);
  };
  render();
}
// --- département ------------------------------------------------------------------------------------------
function loadScript(src) { return new Promise((ok, ko) => { if (document.querySelector(`script[src="${src}"]`)) return ok(); const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = ko; document.body.append(s); }); }
async function pageDepartement(dep) {
  const name = DEPS[dep] || dep;
  $("#app").innerHTML = `<div class="ident"><span class="tag plain">Département</span><h1 class="long">${esc(name)}</h1><p class="tw">${dep}</p></div><main class="ess"><p class="phrase">Chargement de la carte…</p></main>`;
  try { await loadScript(`geo/dep-${dep}.js`); } catch (e) { /* no map for this département */ }
  const D = window.DEP?.[dep], ev = R.evenements.filter(e => e.dep === dep && e.insee);
  const has = t => new Set(ev.filter(t).map(e => e.insee));
  const withC = has(e => e.t === "attribution"), withA = has(e => e.t === "arrete"), withD = has(e => e.t === "arrete_drone" || e.t === "arrete_vsa"), withAny = new Set(ev.map(e => e.insee));
  const fig = i => { const f = fiche(i), p = [f.contrats ? plural(f.contrats, "contrat") : "aucun contrat trouvé"]; if (COUV.arretes.has(dep)) p.push(f.cam ? plural(f.cam, "caméra autorisée", "caméras autorisées") : "aucune caméra autorisée"); if (f.carte != null) p.push(`${f.carte} sur la carte`); return p.join(" · "); };
  // who sells here: companies by number of buyers in the département (a ranking of companies, not of communes)
  const cs = R.evenements.filter(e => e.t === "attribution" && e.dep === dep), byE = {};
  cs.forEach(e => (e.entreprises || []).forEach(x => { const o = byE[x] ||= { n: new Set(), m: 0 }; o.n.add(buyerOf(e) || e.insee); if (!e.hors_totaux && !e.national) o.m += e.montant || 0; }));
  const sellers = Object.entries(byE).sort((a, b) => b[1].n.size - a[1].n.size || b[1].m - a[1].m).slice(0, 12);
  const byB = {}; cs.forEach(e => { const b = buyerOf(e); if (!b || ACH[b]?.categorie === "commune") return; const o = byB[b] ||= { n: 0, m: 0 }; o.n++; if (!e.hors_totaux && !e.national) o.m += e.montant || 0; });
  const buyers = Object.entries(byB).sort((a, b) => b[1].m - a[1].m).slice(0, 10);
  const list = [...withAny].filter(i => R.communes[i]).sort((a, b) => commune(a).nom.localeCompare(commune(b).nom));
  const iC = ib("Une commune compte quand un document la concerne : un contrat de sa mairie ou d'un autre acheteur sur son territoire, une autorisation de la préfecture, un arrêté de drones. Un « — » veut dire « pas encore collecté », pas zéro. Les autorisations de caméras ne sont collectées que dans le Rhône.");
  $("#app").innerHTML = `<nav class="crumbs" aria-label="Fil d'Ariane"><a href="#/">Accueil</a> › <span aria-current="page">${esc(name)}</span></nav>
    <div class="ident"><span class="tag plain">Département</span><h1 class="long">${esc(name)}</h1><p class="tw">${dep} · ${plural(D?.communes.length || 0, "commune")}</p></div>
    <main class="ess" style="gap:28px"><section class="blk"><dl class="kv" style="margin:0">
      <dt>Communes avec un contrat</dt><dd>${withC.size}</dd><dt>Avec une autorisation de caméras</dt><dd>${COUV.arretes.has(dep) ? withA.size : "—"}</dd><dt>Avec des drones ou de l'analyse algorithmique</dt><dd>${withD.size}</dd></dl>
      <div class="tline"><p class="why" style="margin:0">Trois comptes, sans classement des communes.</p>${iC.btn}</div>${iC.box}</section>
      ${D ? `<section class="blk" aria-labelledby="h-dm"><h2 id="h-dm" class="h2">Les communes</h2>${smap("dep", [`${plural(withAny.size, "commune")} avec des documents`, "survolez ou touchez une commune"],
        `<svg viewBox="${D.viewBox}" role="group" aria-label="Carte des communes du département">${D.communes.map(c => `<a ${smapItem(c.c, fig(c.c))}><path d="${c.d}" class="${withAny.has(c.c) ? "doc" : ""}"></path></a>`).join("")}</svg>`,
        `<span><span class="sw-doc" aria-hidden="true"></span>au moins un document</span><span><span class="sw-nodoc" aria-hidden="true"></span>aucun trouvé</span><span><span class="sw-hot" aria-hidden="true"></span>survol</span>`)}</section>` : ""}
      <section class="blk" aria-labelledby="h-qv"><h2 id="h-qv" class="h2">Qui vend ici</h2><ol class="results rank">${sellers.map(([x, o]) => `<li><a href="#/entreprise/${x}">${esc(tidy(entName(x)))}</a><br><span class="muted">${plural(o.n.size, "acheteur")} · ${eur(o.m)} au maximum</span></li>`).join("")}</ol></section>
      ${buyers.length ? `<section class="blk" aria-labelledby="h-qa"><h2 id="h-qa" class="h2">Les autres acheteurs</h2><ul class="results">${buyers.map(([b, o]) => `<li>${buyerLink(b)} <span class="muted">· ${CAT[ACH[b]?.categorie] || "acheteur public"}</span><br><span class="muted">${plural(o.n, "contrat")} · ${eur(o.m)} au maximum</span></li>`).join("")}</ul></section>` : ""}
      <section class="blk" aria-labelledby="h-dl"><h2 id="h-dl" class="h2">${plural(list.length, "commune")} avec des documents</h2><p style="margin:0">${list.map(i => comLink(i)).join(", ")}</p></section></main>`;
}
// --- search: a commune, a postal code, a company, a SIREN, a reference ------------------------------------
const plainTxt = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
let _communesIdx = null;
function search(q) {
  const p = plainTxt(q), raw = q.trim(), out = { communes: [], entreprises: [], acheteurs: [], references: [] };
  if (!p) return out;
  _communesIdx ||= Object.entries(R.communes).map(([k, c]) => [k, plainTxt(c.nom)]);
  const CP = window.CP || {};
  if (/^\d{5}$/.test(raw)) out.communes = Object.keys(R.communes).filter(k => k === raw || (CP[k] || []).includes(raw));
  if (!out.communes.length) out.communes = _communesIdx.filter(([, n]) => n === p || n.startsWith(p + " ") || n.includes(p)).sort((a, b) => (a[1] === p ? -1 : 0) - (b[1] === p ? -1 : 0) || a[1].length - b[1].length).map(([k]) => k).slice(0, 10);
  out.entreprises = Object.keys(R.entreprises).filter(s => s === raw.replace(/\s/g, "") || plainTxt(entName(s)).includes(p)).slice(0, 10);
  out.acheteurs = Object.keys(ACH).filter(s => ACH[s].categorie !== "commune" && (s === raw.replace(/\s/g, "") || plainTxt(ACH[s].nom).includes(p))).slice(0, 10);
  // references: an act number, a BOAMP notice, a DECP identifier, wherever they appear
  const r = raw.replace(/^(boamp|decp|acte)\s*/i, "").trim();
  if (r.length >= 5) out.references = R.evenements.filter(e => e.id === r || e.affaire === r || e.ref.replace(/\s/g, "").toLowerCase().includes(r.replace(/\s/g, "").toLowerCase())).slice(0, 10);
  return out;
}
function pageRecherche(q = "") {
  const res = search(q), n = Object.values(res).reduce((s, x) => s + x.length, 0);
  const sec = (t, items) => items.length ? `<section class="blk"><h2 class="h2">${t}</h2><ul class="results">${items.join("")}</ul></section>` : "";
  $("#app").innerHTML = `<div class="ident"><span class="tag plain">Recherche</span><h1 class="long">Chercher dans le registre</h1><p class="tw">une commune, un code postal, une entreprise, un SIREN, une référence d'acte, du BOAMP ou de la commande publique</p></div>
    <main class="ess" style="gap:20px"><form class="blk" role="search" id="f-search"><label for="q" class="sr-only">Rechercher</label><div class="tools" style="padding:0"><label class="search" style="flex:1"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-4-4"></path></svg><input id="q" type="search" value="${esc(q)}" placeholder="Mions, 69780, Serfim, 69-2026-06-30-00021…" autocomplete="off"></label><button class="btn ink" type="submit">Chercher</button></div>
      <p class="note">Exemples : <a href="#/recherche?q=Mions">Mions</a> · <a href="#/recherche?q=431903954">431903954</a> · <a href="#/recherche?q=69-2026-06-30-00021">69-2026-06-30-00021</a> · <a href="#/recherche?q=26-71981">26-71981</a></p></form>
    ${q ? `<p class="phrase" aria-live="polite">${n ? `${plural(n, "résultat")} pour « ${esc(q)} ».` : `Rien trouvé pour « ${esc(q)} ».`}</p>` : ""}
    ${sec("Communes", res.communes.map(k => `<li>${comLink(k)} <span class="muted">· ${esc(DEPS[commune(k).dep] || commune(k).dep)} · ${k}</span></li>`))}
    ${sec("Entreprises", res.entreprises.map(s => `<li>${entLink(s)} <span class="muted">· SIREN ${s}</span></li>`))}
    ${sec("Acheteurs", res.acheteurs.map(s => `<li>${buyerLink(s)} <span class="muted">· ${CAT[ACH[s].categorie] || ""} · SIREN ${s}</span></li>`))}
    ${sec("Références", res.references.map(e => `<li><a href="#/evenement/${encodeURIComponent(e.id)}">${esc(nat(e))}, ${fmtD(e.date)}</a> <span class="muted">· ${esc(e.ref)}${e.insee ? ` · ${esc(commune(e.insee).nom)}` : ""}</span></li>`))}</main>`;
  $("#f-search").onsubmit = ev => { ev.preventDefault(); location.hash = `#/recherche?q=${encodeURIComponent($("#q").value)}`; };
  if (!q) $("#q").focus();
}
// --- around a commune: its neighbours, the same companies elsewhere ----------------------------------------
function fiche(insee) {
  const rows = R.evenements.filter(e => e.insee === insee), arr = lastArretes(rows).filter(isCommunal);
  return { contrats: rows.filter(e => e.t === "attribution" && isCommunal(e)).length, cam: arr.reduce((s, e) => s + e.cameras, 0), carte: CARTE_N[insee] ?? (window.CARTE_N_ALL || {})[insee] };   // the commune's own cut first, as on its page
}
function blocAutour(s) {
  const V = (window.VOISINS || {})[s.insee], mini = (window.MINI || {})[s.insee];
  if (!V?.length) return "";
  const vs = V.filter(i => R.communes[i]).sort((a, b) => commune(a).nom.localeCompare(commune(b).nom));
  const line = i => { const f = fiche(i), p = []; p.push(f.contrats ? plural(f.contrats, "contrat") : "aucun contrat trouvé");
    if (COUV.arretes.has(commune(i).dep)) p.push(f.cam ? `${plural(f.cam, "caméra autorisée", "caméras autorisées")}` : "aucune caméra autorisée en 12 mois"); else p.push("autorisations pas encore collectées");
    if (f.carte != null) p.push(`${f.carte} sur la carte`); return p.join(" · "); };
  const iA = ib("Les communes qui touchent celle-ci, dans l'ordre alphabétique, sans classement. Les autorisations de caméras ne sont collectées que dans le Rhône.", "Comment lire les communes voisines");
  return `<section class="blk" aria-labelledby="s-autour"><div class="tline"><h2 id="s-autour" class="h2">Autour de ${esc(s.c.nom)}</h2>${iA.btn}</div>${iA.box}
    ${mini ? smap("autour", [`${plural(vs.length, "commune voisine", "communes voisines")}`, "survolez ou touchez une commune"], `<svg viewBox="${mini.viewBox}" role="group" aria-label="Carte de ${esc(s.c.nom)} et de ses voisines">${mini.items.map(it => it.c === s.insee ? `<path d="${it.d}" class="moi" aria-hidden="true"></path>` : R.communes[it.c] ? `<a ${smapItem(it.c, line(it.c))}><path d="${it.d}"></path></a>` : `<path d="${it.d}" class="hors" aria-hidden="true"></path>`).join("")}</svg>`,
      `<span><span class="sw-moi" aria-hidden="true"></span>${esc(s.c.nom)}</span><span><span class="sw-hot" aria-hidden="true"></span>survol</span>`) : ""}
    <ul class="results">${vs.map(i => `<li>${comLink(i)}<br><span class="muted">${line(i)}</span></li>`).join("")}</ul></section>`;
}
function blocMemes(s) {
  const ents = [...new Set(s.contrats.flatMap(e => e.entreprises || []))];
  if (!ents.length) return "";
  const items = ents.map(x => {
    const cs = R.evenements.filter(e => e.t === "attribution" && e.entreprises?.includes(x)), buyers = new Set(cs.map(buyerOf).filter(b => b && b !== buyerOf(s.contrats[0])));
    const coms = [...new Set(cs.map(e => e.insee).filter(i => i && i !== s.insee && R.communes[i]))].sort((a, b) => commune(a).nom.localeCompare(commune(b).nom));
    return { x, buyers, coms };
  }).filter(i => i.buyers.size);
  if (!items.length) return "";
  return `<section class="blk" aria-labelledby="s-memes"><h2 id="s-memes" class="h2">Les mêmes entreprises ailleurs</h2>
    ${items.map(i => `<p style="margin:0"><a href="#/entreprise/${i.x}">${esc(tidy(entName(i.x)))} travaille aussi pour ${plural(i.buyers.size, "autre acheteur", "autres acheteurs")} →</a><br><span class="muted">${i.coms.slice(0, 8).map(k => comLink(k)).join(", ")}${i.coms.length > 8 ? ` et ${i.coms.length - 8} autres communes` : ""}</span></p>`).join("")}</section>`;
}
// --- explorer and home ------------------------------------------------------------------------------------
function pageExplorer() {
  const all = R.evenements.slice().sort(byDateDesc);
  if (state.filters.pilote === undefined) state.filters.pilote = "1";
  const ctx = { explorer: true, commune: false, territorial: false };
  const render = () => {
    const rows = filterRows(all, state.filters, state.q);
    $("#app").innerHTML = `<div class="ident"><span class="tag plain">Registre</span><h1 class="long">Rechercher dans tout le registre</h1><p class="tw">Paris, Rhône, Bouches-du-Rhône et Île-de-France · filtres et tris, aucun classement</p></div>
      <main class="ess" style="gap:12px;padding-bottom:12px"><p class="phrase">${plural(R.evenements.length, "document officiel", "documents officiels")}, ${plural(Object.keys(R.affaires).length, "historique")}, ${plural(Object.keys(R.entreprises).length, "entreprise")}.</p>
      <div class="ghosts blk"><a class="ghost" href="#/recherche">Chercher une commune, une entreprise ou une référence →</a><a class="ghost" href="#/explorer?dispositif=vsa">Qui achète de l'analyse algorithmique ? →</a><a class="ghost" href="#/explorer?nature=aut&amp;dispositif=drone&amp;dep=69">Les drones dans le Rhône →</a><a class="ghost" href="#/explorer?entreprise=899832901&amp;annee=2025&amp;pilote=">Alphaiota en 2025 →</a></div></main>
      ${docbar(all, state.filters, ctx)}<main><section class="blk" style="padding-top:12px" aria-labelledby="h-xm"><h2 id="h-xm" class="h2" style="font-size:18px">Où sont ces ${plural(rows.length, "document")}</h2>${pointsMap(pointsOf(rows), "document")}<p class="note">Chaque point : une commune ; touchez-le pour le détail.</p></section>
      ${yearsHTML(rows, { ctx: { page: "explorer" } })}${downloads()}</main><div style="padding:24px 0 32px">${foot("", false)}</div>`;
    bindDocs(all, render, "registre", ctx);
  };
  render();
}
function pageAccueil() {
  const ex = [["69283", "Mions (Rhône)"], ["69290", "Saint-Priest (Rhône)"], ["69123", "Lyon"], ["69282", "Meyzieu (drones)"], ["93066", "Saint-Denis (Stade de France)"], ["91386", "Mennecy (Essonne)"], ["75056", "Paris"], ["94018", "Charenton-le-Pont"]];
  $("#app").innerHTML = `<div class="home"><div class="ident"><span class="tag plain">Prototype</span><h1 class="long">Registre de la vidéosurveillance</h1><p class="tw">Construit le ${fmtD(R.meta.construit)} · données du pilote</p></div>
    <main><form role="search" id="f-search"><label for="q" class="lg h2" style="font-size:18px;display:block;margin-bottom:6px">Chercher</label><div class="tools" style="padding:0"><label class="search" style="flex:1"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-4-4"></path></svg><input id="q" type="search" placeholder="Commune, code postal, entreprise, SIREN, référence" autocomplete="off"></label><button class="btn ink" type="submit">Chercher</button></div></form>
    <p class="phrase" style="padding:0">${plural(R.evenements.length, "document officiel", "documents officiels")} : contrats, appels d'offres, autorisations de la préfecture, subventions.</p>
    <section><h2 class="h2" style="margin-bottom:8px">Départements</h2><ul>${[...PILOTE].map(d => `<li><a href="#/departement/${d}">${esc(DEPS[d])} (${d}) →</a></li>`).join("")}</ul></section>
    <section><h2 class="h2" style="margin-bottom:8px">Exemples</h2><ul>${ex.map(([k, n]) => `<li><a href="#/commune/${k}">${n} →</a></li>`).join("")}<li><a href="#/entreprise/899832901">Alphaiota →</a></li><li><a href="#/entreprise/431903954">Serfim T.I.C. →</a></li><li><a href="#/acheteur/200046977">Métropole de Lyon →</a></li></ul></section>
    <section><h2 class="h2" style="margin-bottom:8px">Aussi</h2><ul><li><a href="#/explorer">Rechercher dans tout le registre →</a></li><li><a href="#/glossaire">Glossaire →</a></li><li><a href="entree.html">Depuis la carte du site (maquette) →</a></li></ul></section>
    <p class="note">${esc(R.meta.licence)}</p></main></div>`;
  $("#f-search").onsubmit = ev => { ev.preventDefault(); location.hash = `#/recherche?q=${encodeURIComponent($("#q").value)}`; };
}

// --- « Qui regarde la rue ? » -----------------------------------------------------------------------
const fmtT = ms => new Date(ms).toLocaleString("fr-FR", { weekday: "short", day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Paris" });
const fmtH = ms => new Date(ms).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" }).replace(":", " h ");
function zoneText(z) {
  const d0 = fmtT(z.t0), d1 = fmtT(z.t1), same = d0 === d1;
  const when = z.heures_sures ? (same ? `${d0}, de ${fmtH(z.t0)} à ${fmtH(z.t1)}` : `du ${d0}, ${fmtH(z.t0)}, au ${d1}, ${fmtH(z.t1)}`) : `${same ? d0 : `du ${d0} au ${d1}`} · heures : voir l'arrêté`;
  return when;
}
function pageCarte(insee, acte) {
  const c = commune(insee), AUT = (window.AUTORISATIONS || []).filter(a => a.insee.includes(insee)).sort((a, b) => a.t0 - b.t0);
  const SIT = (window.SITES || []).filter(x => x.parts?.[insee]), ZID = Object.fromEntries((window.ZONES || []).map(z => [z.id, z]));
  const f = { cams: true, vsa: true, drones: true, masquer: false };
  const NOW = Date.now();
  const monthOf = t => new Date(t).toLocaleString("sv-SE", { timeZone: "Europe/Paris" }).slice(0, 7);
  // the 12 collected months (November 2025 to October 2026), widened to an older authorisation of the commune
  const first = AUT.length ? AUT.map(a => monthOf(a.t0)).sort()[0] : "2025-11", from = first < "2025-11" ? first : "2025-11";
  const span = (2026 - +from.slice(0, 4)) * 12 + (10 - +from.slice(5, 7)) + 1;
  const months = Array.from({ length: span }, (_, i) => { const d = new Date(Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1 + i, 1)); return { y: d.getUTCFullYear(), m: d.getUTCMonth(), key: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}` }; });
  const MOISL = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
  const keep = a => !(f.masquer && /photo|exercice/.test(a.nature || "")) && ((a.kind === "vsa" && f.vsa) || (a.kind === "drone" && f.drones));
  const inPeriod = (a, per) => a.periodes.filter(p => per === "all" || monthOf(p.t0) === per);
  const label = per => per === "all" ? (months.length > 12 ? `${months.length} derniers mois` : "12 derniers mois") : (m => m ? `${MOIS[m.m]} ${m.y}` : per)(months.find(x => x.key === per));
  // hours per site on the period: distinct (act, period) pairs, never counted twice for two zones of a site
  function heures(per) {
    const out = {};
    for (const a of AUT.filter(keep)) for (const p of inPeriod(a, per)) {
      const sites = new Set(a.zones.map(id => ZID[id]?.site).filter(s => s && SIT.some(x => x.id === s)));
      for (const s of sites) { const x = out[s] ||= { heures: 0, n: 0, actes: new Set(), seen: new Set() }; const k = `${a.acte}|${p.t0}|${p.t1}`; if (!x.seen.has(k)) { x.seen.add(k); x.heures += p.heures || 0; } x.actes.add(a.acte); x.n = x.actes.size; }
    }
    return out;
  }
  const qmois = (state.filters.mois || "").slice(0, 7);
  let per = months.some(m => m.key === qmois) ? qmois : (() => { const cur = monthOf(NOW); if (AUT.some(a => inPeriod(a, cur).length)) return cur; const last = AUT.filter(keep).pop(); return last ? monthOf(last.t0) : months[months.length - 1].key; })();
  if (acte) { const a = AUT.find(x => x.acte === acte); if (a) per = monthOf(a.t0); }
  let sel = null, timer = 0, m = null;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const layerChip = (k, l, sw) => `<button type="button" class="chip" aria-pressed="true" data-layer="${k}"><span class="dot" aria-hidden="true" style="${sw}"></span>${l}</button>`;
  const i0 = ib(`La hauteur d'un volume montre les heures de vol autorisées sur la période choisie, pas une altitude : aucun arrêté ne la donne. Les zones au même endroit s'additionnent dans un seul volume. Une zone qui déborde de la commune est dessinée en entier, sa partie extérieure estompée. Contour pointillé : tracé indicatif, à relire. Une heure ne compte qu'une fois, même si l'autorisation couvre deux zones du même lieu.`, "Comment lire cette carte");
  $("#app").innerHTML = `${crumbs(insee, "Qui regarde la rue ?")}<div class="ident"><span class="tag commune">Commune · ${esc(c.nom)}</span>
      <h1 style="font-size:44px">Qui regarde la rue&nbsp;?</h1>
      <div class="tline"><p style="margin:0"><strong>Plus une zone est haute, plus on y a autorisé d'heures de vol.</strong></p>${i0.btn}</div>${i0.box}</div>
    <div class="layers" role="group" aria-label="Couches de la carte">${layerChip("cams", "Caméras fixes", "background:#ff48b0")}${layerChip("vsa", "Analyse algorithmique", "background:repeating-linear-gradient(45deg,#ffe800 0 3px,#111 3px 6px)")}${layerChip("drones", "Drones", "background:#7fd4ff")}</div>
    <div class="mapframe">${stripHTML("strip", "", "")}
      <div class="c3 wide" id="carte" data-label="Carte inclinée de ${esc(c.nom)}. Chaque zone de drone est un volume bleu dont la hauteur montre les heures de vol autorisées sur la période choisie. La liste des autorisations, sous la carte, dit la même chose en texte."></div>
      <div class="ctlbar"><div class="row1" style="justify-content:flex-start;gap:8px"><button type="button" class="ctl" data-per="-1" aria-label="Mois précédent">◀</button><button type="button" class="ctl wide" data-play aria-pressed="false" ${reduce ? 'disabled title="Votre système demande de réduire les animations"' : ""}>▶ Lire</button><button type="button" class="ctl" data-per="1" aria-label="Mois suivant">▶</button><button type="button" class="ctl wide" data-all aria-pressed="false" style="margin-left:auto">${months.length > 12 ? "Tout" : "12 mois"}</button></div>
        <div class="histo small" role="group" aria-label="Choisir un mois" id="histo"></div><div class="histo-l" aria-hidden="true" id="histo-l"></div></div></div>
    <main class="ess" style="gap:18px;padding-top:16px"><section class="blk" aria-labelledby="h-per"><h2 id="h-per" class="h2" style="font-size:22px"></h2><div id="rows"></div>
      ${AUT.some(x => /photo|exercice/.test(x.nature || "")) ? `<label class="opt-inline"><input type="checkbox" id="masquer"> Masquer les photographies aériennes et les exercices</label>` : ""}</section>
      <footer class="foot"><div class="btns"><button type="button" class="btn" data-partage="${insee}">Partager l'image</button><button type="button" class="btn" data-sources>Nos sources</button></div></footer></main>`;
  const strip = $("#strip");
  function render() {
    // 11th pass: the hours of every authorisation shown (drones and algorithmic analysis), as the rows below them
    // (Saint-Denis said « 0 h » beside its 8 h analysis slot); the « without duration » count left the band
    const H = heures(per), L = AUT.filter(keep).filter(a => inPeriod(a, per).length), tot = L.reduce((s, a) => s + inPeriod(a, per).reduce((t, p) => t + (p.heures || 0), 0), 0);
    const unread = L.filter(a => inPeriod(a, per).some(p => p.heures == null)).length, nsites = Object.keys(H).length;
    const restStrip = () => L.length ? setStrip(strip, `${esc(label(per))} · ${nb(Math.round(tot).toLocaleString("fr-FR"))} h de vol autorisées`, `${plural(L.length, "autorisation")} · ${plural(nsites, "zone")} · touchez une zone`)
      : setStrip(strip, `${esc(label(per))} · aucun drone autorisé`, "choisissez un autre mois ou « 12 mois »");
    if (!sel) restStrip(); else showSite(sel, H);
    $("#h-per").textContent = `${label(per)} · ${Math.round(tot).toLocaleString("fr-FR")} h`;
    const mh = months.map(mo => AUT.filter(keep).reduce((s, a) => s + inPeriod(a, mo.key).reduce((t, p) => t + (p.heures || 0), 0), 0)), mx = Math.max(1, ...mh);
    $("#histo").style.gridTemplateColumns = $("#histo-l").style.gridTemplateColumns = `repeat(${months.length}, minmax(0, 1fr))`;
    $("#histo").innerHTML = months.map((mo, i) => `<button type="button" aria-pressed="${per === mo.key}" data-mois="${mo.key}" aria-label="${MOIS[mo.m]} ${mo.y} : ${Math.round(mh[i])} heures"><span class="bar" style="height:${mh[i] ? Math.max(4, Math.round(mh[i] / mx * 56)) : 2}px;opacity:${mh[i] ? 1 : .3}"></span></button>`).join("");
    $("#histo-l").innerHTML = months.map(mo => `<span class="tw ${per === mo.key ? "on" : ""}">${MOISL[mo.m]}</span>`).join("");
    $("[data-all]").setAttribute("aria-pressed", String(per === "all"));
    $("#rows").innerHTML = L.length ? L.map(a => { const ps = inPeriod(a, per), h = ps.reduce((t, p) => t + (p.heures || 0), 0), site = a.zones.map(id => ZID[id]?.site).find(Boolean);
      return `<button type="button" class="aut ${sel && site === sel ? "on" : ""}" aria-pressed="${!!(sel && site === sel)}" data-site="${site || ""}" data-acte="${esc(a.acte)}">
        <span class="row1"><strong>${esc(ps.map(p => zoneText(p)).join(" ; "))}</strong><span class="dur">${ps.some(p => p.heures == null) ? "durée non lue" : `${nb(h.toLocaleString("fr-FR", { maximumFractionDigits: 1 }))} h`}</span></span>
        <span class="muted">${a.kind === "vsa" ? "Analyse algorithmique · " : ""}${esc(a.service || "")}${a.finalite ? ` · ${esc(a.finalite)}` : ""}${site ? "" : " · zone en relecture"}</span></button>`; }).join("") : `<p class="why">Aucune autorisation sur cette période.</p>`;
    m?.setHeures(Object.fromEntries(Object.entries(H).map(([k, x]) => [k, { heures: x.heures, n: x.n }])));
  }
  function showSite(id, H = heures(per)) {
    const x = H[id]; if (!x) { sel = null; return render(); }
    const as = AUT.filter(a => x.actes.has(a.acte));
    setStrip(strip, `${nb(Math.round(x.heures).toLocaleString("fr-FR"))} h · ${esc(as.map(a => inPeriod(a, per).map(p => zoneText(p)).join(", ")).join(" ; "))}`, esc(as.map(a => `${a.service || ""}${a.finalite ? ` · ${a.finalite}` : ""}`).join(" ; ")));
  }
  function select(id) {
    sel = id; m?.select(id); render();
    document.querySelector(`#rows [data-site="${CSS.escape(id || "")}"]`)?.scrollIntoView({ block: "nearest" });
  }
  function setPer(p) { per = p; sel = null; m?.select(null); render(); }
  root();
  function root() {
    render();
    $("#app").addEventListener("click", ev => {
      const mo = ev.target.closest("[data-mois]"), st = ev.target.closest("[data-per]"), all = ev.target.closest("[data-all]"), pl = ev.target.closest("[data-play]"), row = ev.target.closest("#rows [data-site]");
      if (mo) { stopPlay(); setPer(mo.dataset.mois); $(`[data-mois="${mo.dataset.mois}"]`)?.focus(); }
      if (st) { stopPlay(); const n = months.length, i = per === "all" ? 0 : (months.findIndex(x => x.key === per) + +st.dataset.per + n) % n; setPer(months[i].key); }
      if (all) { stopPlay(); setPer("all"); }
      if (pl && !reduce) timer ? stopPlay() : startPlay();
      if (row && row.dataset.site) { select(sel === row.dataset.site ? null : row.dataset.site); const u = m?.units.find(x => x.id === row.dataset.site); if (u && sel) m.focus(u); }
    });
    const mq = $("#masquer"); if (mq) mq.onchange = () => { f.masquer = mq.checked; render(); };
  }
  function startPlay() { const b = $("[data-play]"); b.textContent = "❚❚ Pause"; b.setAttribute("aria-pressed", "true"); let i = per === "all" ? 0 : months.findIndex(x => x.key === per);
    timer = setInterval(() => { i = (i + 1) % months.length; setPer(months[i].key); }, 1600); setPer(months[i].key); }
  function stopPlay() { if (!timer) return; clearInterval(timer); timer = 0; const b = $("[data-play]"); if (b) { b.textContent = "▶ Lire"; b.setAttribute("aria-pressed", "false"); } }
  window.__chrono = { setPer, startPlay, stopPlay, select, n: AUT.length };
  mountMap($("#carte"), insee, { couches: { cams: true, vsa: true, drones: true }, sites: SIT, onZone: u => select(u ? (sel === u.id ? null : u.id) : null) }).then(mm => {
    m = mm; if (!m) return; render();
    document.querySelectorAll("[data-layer]").forEach(b => b.onclick = () => { const k = b.dataset.layer, on = b.getAttribute("aria-pressed") !== "true"; b.setAttribute("aria-pressed", String(on)); f[k] = on; m.setCouches({ [k]: on }); render(); });
    if (acte) { const a = AUT.find(x => x.acte === acte), s = a && a.zones.map(id => ZID[id]?.site).find(Boolean); if (s) { select(s); const u = m.units.find(x => x.id === s); if (u) m.focus(u); } }
  });
}

// --- exports ------------------------------------------------------------------------------------------
const COLS = ["id", "date", "date_precision", "nature", "montant_max_contrat_eur", "montant_subvention_eur", "changements", "offres_recues", "centrale_achat", "contrat_mixte", "montant_a_verifier", "plafond_partage", "acheteur_national",
  "cameras", "cameras_voie_publique", "videoverbalisation", "transmission_police_gendarmerie", "entreprises_siren", "entreprises", "beneficiaire", "beneficiaire_siren", "acheteur", "commune_insee", "departement", "publie_par", "affaire",
  "contrat_probable", "reference", "url", "relu", "note_relecture", "objet"];
function lisezmoi(name) {
  return `Registre Surveillance World — extrait « ${name} »
Extrait le ${fmtD(TODAY)} depuis un registre construit le ${fmtD(R.meta.construit)}.

Licence : Licence Ouverte 2.0 (Etalab). Chaque ligne cite sa source (colonnes reference et url).
Les caméras de la carte (OpenStreetMap, ODbL) ne sont pas dans ce fichier.

Encodage : UTF-8 avec BOM, séparateur virgule, une ligne d'en-tête.

Ouvrir le prototype : la carte de chaque commune est un module JavaScript, que les navigateurs
refusent de charger depuis un fichier. Lancez le petit serveur local (127.0.0.1 seulement, aucun
appel extérieur) : ./ouvrir.sh (ou python3 scripts/serveur.py), puis ouvrez
http://127.0.0.1:8765/prototype-v11/index.html

Colonnes :
- id : identifiant stable de la ligne (adresse ${SITE}/#/evenement/<id>)
- date, date_precision : « jour », ou « année » quand la source ne donne que l'année
- nature : type de document officiel
- montant_max_contrat_eur : maximum prévu par le contrat (pas la dépense réelle)
- montant_subvention_eur : montant voté de la subvention
- changements : ce qu'une modification de contrat change (montant, durée, entreprises) ; la raison n'est pas publiée
- offres_recues : nombre d'offres reçues, quand les données de la commande publique le donnent
- centrale_achat : « oui » si l'acheteur est une centrale d'achat (plafond pour d'autres acheteurs, hors des totaux)
- contrat_mixte : « vidéo + alarmes des bâtiments » ou « vidéo + autres services »
- montant_a_verifier, plafond_partage, acheteur_national : raisons de laisser un montant hors des totaux
- cameras, cameras_voie_publique : nombres lus dans le document
- videoverbalisation, transmission_police_gendarmerie : « oui » si l'arrêté le mentionne, sinon « non mentionné »
- entreprises_siren, entreprises : entreprises titulaires (un entrepreneur individuel est désigné par son seul SIREN)
- beneficiaire, beneficiaire_siren : un commerce ou une entreprise n'est nommé que s'il est une personne morale dans SIRENE
- publie_par : l'administration qui a publié un arrêté pris pour un site hors de son département
- contrat_probable : pour un appel d'offres, le contrat probablement signé à sa suite (lien « probable »)
- relu : « vérifié à la main » si une personne a vérifié la ligne, sinon « lecture automatique »
`;
}
function exportRows(rows, fmt, name) {
  const flat = rows.map(e => { const a = affaire(e.affaire), c = a?.kind === "contrat" ? a : {}; const art = e.t.startsWith("arrete"); return {
    id: e.id, date: e.date_annee ? year(e) : e.date, date_precision: e.date_annee ? "année" : "jour", nature: nat(e),
    montant_max_contrat_eur: e.t === "attribution" || e.t === "modification" ? e.montant ?? "" : "", montant_subvention_eur: e.t.startsWith("subvention") ? e.montant ?? "" : "",
    changements: e.t === "modification" ? (e.changements?.length ? e.changements.join(" ; ") : NO_CHANGE) : "", offres_recues: e.offres ?? "",
    centrale_achat: c.centrale_achat ? "oui" : "", contrat_mixte: c.mixte_famille === "surete" ? "vidéo + alarmes des bâtiments" : c.mixte_famille === "autres" ? "vidéo + autres services" : "",
    montant_a_verifier: c.montant_a_verifier || "", plafond_partage: c.plafond_partage || "", acheteur_national: c.acheteur_national ? "oui" : "",
    cameras: e.cameras ?? "", cameras_voie_publique: e.cameras_vp ?? "", videoverbalisation: e.t === "arrete" ? (e.videoverbalisation ? "oui" : "non mentionné") : "",
    transmission_police_gendarmerie: e.t === "arrete" ? (e.deport_forces ? "oui" : "non mentionné") : "",
    entreprises_siren: (e.entreprises || []).join(" "), entreprises: (e.entreprises || []).map(entName).join(" ; "),
    beneficiaire: e.beneficiaire ? benefLabel(e) : "", beneficiaire_siren: e.beneficiaire_siren || "", acheteur: e.acheteur || a?.acheteur || "",
    commune_insee: e.insee || "", departement: e.dep || "", publie_par: e.publie_par || "", affaire: e.affaire, contrat_probable: a?.kind === "contrat_non_retrouve" ? a.contrat_probable || "" : "",
    reference: e.ref, url: e.url || "", relu: e.relu ? "vérifié à la main" : "lecture automatique", note_relecture: e.note_relecture || "", objet: e.objet || "" }; });
  let blob, ext = fmt;
  if (fmt === "csv") { const q = v => `"${String(v ?? "").replace(/"/g, '""')}"`; blob = new Blob(["﻿" + `${COLS.join(",")}\r\n${flat.map(r => COLS.map(c => q(r[c])).join(",")).join("\r\n")}\r\n`], { type: "text/csv;charset=utf-8" }); }
  else if (fmt === "txt") { blob = new Blob(["﻿" + lisezmoi(name)], { type: "text/plain;charset=utf-8" }); name = `LISEZMOI-${name}`; }
  else blob = new Blob([JSON.stringify({ meta: { licence: "Licence Ouverte 2.0 (Etalab) ; chaque ligne cite sa source ; caméras de la carte exclues (ODbL)", extrait: name, extrait_le: TODAY, registre_construit_le: R.meta.construit, colonnes: COLS },
    lignes: flat.map(r => Object.fromEntries(COLS.map(k => [k, r[k] === "" ? null : r[k]]))) }, null, 1)], { type: "application/json" });
  if (window.__exportBlob) return window.__exportBlob(fmt, blob);   // v11: the files gathered in one zip (vues/registre.js)
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = fmt === "txt" ? `${name}.txt` : `registre-${name}.${ext}`; a.click();
}

// --- dialogs -------------------------------------------------------------------------------------------
function modal(title, body) {
  const opener = document.activeElement, m = document.createElement("div"); m.className = "modal";
  m.innerHTML = `<div class="box" role="dialog" aria-modal="true" aria-labelledby="dlg-t"><h2 id="dlg-t">${title}</h2>${body}<p><button type="button" class="btn" data-close>Fermer</button></p></div>`;
  const close = () => { m.remove(); document.removeEventListener("keydown", k); opener?.focus?.(); };
  const k = ev => { if (ev.key === "Escape") close(); };
  m.addEventListener("click", ev => { if (ev.target === m || ev.target.dataset.close !== undefined) close(); });
  document.addEventListener("keydown", k); document.body.append(m);
  const t = m.querySelector("textarea"); if (t) { t.setAttribute("aria-label", title); t.focus(); t.select(); } else m.querySelector("[data-close]").focus();
}
function demande(objet, quiq, insee) {
  const c = commune(insee);
  const dest = quiq === "prefecture" ? `Madame la Préfète ou Monsieur le Préfet (département ${c.dep})` : `Madame la Maire ou Monsieur le Maire de ${c.nom}`;
  return `${dest}

Objet : demande de communication de documents administratifs
Je vous demande de me communiquer, en application des articles L.311-1 et suivants du code des relations entre le public et l'administration :
${objet}.

Je souhaite les recevoir sous forme électronique. Les mentions relatives à des personnes physiques peuvent être occultées, et les éléments dont la communication porterait atteinte à la sécurité publique peuvent être retirés.

À défaut de réponse dans le délai d'un mois, je me réserve la possibilité de saisir la Commission d'accès aux documents administratifs (CADA).

[Nom, adresse, courriel] — [date]`;
}
function citation(e) {
  const w = emetteur(e), ref = e.ref.toLowerCase().startsWith(w.toLowerCase()) ? e.ref : `${w}, ${e.ref}`;
  return `${ref.charAt(0).toUpperCase()}${ref.slice(1)}, ${fmtD(e.date)}${e.url ? ` (${e.url})` : ""}, consulté le ${fmtD(TODAY)}. Registre Surveillance World : ${SITE}/#/evenement/${encodeURIComponent(e.id)}`;
}
document.addEventListener("click", ev => {
  const t = ev.target.closest("ul.docs button.sum[aria-expanded]");
  if (t) { const open = t.getAttribute("aria-expanded") !== "true", p = document.getElementById(t.getAttribute("aria-controls")); t.setAttribute("aria-expanded", String(open)); if (p) p.hidden = !open; return; }
  const c = ev.target.closest("[data-cite]"), s = ev.target.closest("[data-signal]"), d = ev.target.closest("[data-demande]"), site = ev.target.closest("[data-site]");
  if (site) { ev.preventDefault(); modal("La carte du site", `<p>Ce lien ouvre la carte du site sur la commune : <code>[adresse du site]/?insee=${esc(site.dataset.site)}</code>. L'adresse de production n'est pas dans ce prototype (<code>site.js</code>, rempli par <code>scripts/site_url.sh</code>).</p>`); return; }
  if (c) { const e = EV[c.dataset.cite]; modal("Copier la référence", `<p class="note">Texte prêt à coller (sélectionné). Adresse stable de la ligne : <code>${SITE}/#/evenement/${esc(e.id)}</code></p><textarea>${esc(citation(e))}</textarea>`); }
  if (s) { const e = EV[s.dataset.signal]; modal("Signaler une erreur", `<p>Ce signalement part dans la file de relecture. <strong>Prototype : rien n'est envoyé.</strong></p><textarea>${esc(JSON.stringify({ ligne: e.id, reference: e.ref, champ: "(à choisir : date, montant, caméras, entreprise, commune…)", valeur_juste: "", source_de_la_correction: "", date: TODAY }, null, 1))}</textarea>`); }
  if (d) modal("Demander le document", `<p>Modèle à envoyer vous-même, par courrier ou par courriel, à ${d.dataset.qui === "mairie" ? "la mairie" : "la préfecture"}.${devTag("à valider")}</p><textarea>${esc(demande(d.dataset.demande, d.dataset.qui, d.dataset.insee))}</textarea>
    <p class="note">La mairie ou la préfecture peut refuser une partie de la liste pour raison de sécurité ; en cas de refus ou sans réponse sous un mois, la CADA peut être saisie gratuitement.</p>
    <p>Vous pouvez aussi passer par <a href="https://madada.fr/" target="_blank" rel="noopener">Ma Dada ↗</a> : la demande et la réponse y sont publiques. Ce n'est qu'un lien : rien n'est transmis depuis ce site.</p>`);
  const r = ev.target.closest("[data-rss]");
  if (r) modal("Me prévenir (RSS)", `<p>Un flux RSS annonce chaque nouveau document de ${esc(commune(r.dataset.rss).nom)} : contrat, modification, appel d'offres, arrêté. Adresse du flux : <code>${SITE}/rss/${esc(r.dataset.rss)}.xml</code></p><p class="note">Prototype : le flux n'existe pas encore. Aucune inscription, aucune adresse demandée.</p>`);
  const p = ev.target.closest("[data-partage]");
  if (p) modal("Partager l'image", `<p>L'image de partage de la page, avec son lien : <code>${SITE}/#/commune/${esc(p.dataset.partage)}</code>.</p><p class="note">Prototype : l'image sera produite au moment de la publication ; la planche v6 en montre une (partage/).</p>`);
  if (ev.target.closest("[data-sources]")) modal("Nos sources", `<ul>
    <li>Contrats et modifications : données de la commande publique (data.gouv.fr), version du 23/10/2026. Montants maximums ; contrats de 40 000 € et plus.</li>
    <li>Appels d'offres : BOAMP (DILA).</li>
    <li>Autorisations : recueils des actes administratifs de la préfecture (Rhône : septembre 2025 à octobre 2026 ; ailleurs : drones et analyse algorithmique seulement).</li>
    <li>Subventions : délibérations de la Région (Île-de-France, Région Sud) et listes DETR des préfectures du Rhône et des Bouches-du-Rhône.</li>
    <li>Carte : caméras relevées par des contributeurs OpenStreetMap (ODbL) ; champs de vision et rues filmées calculés par la carte du site ; fond Protomaps.</li></ul>`);
});

// --- glossary and routes --------------------------------------------------------------------------------
const GLOSSAIRE = window.GLOSSAIRE_V8 || [];
// one real page per entry (« un exemple : … → »)
const EXEMPLES = {
  historique: ["l'autorisation des caméras de Mions", "#/affaire/69-20083300"], elections: ["les documents de Mions", "#/commune/69283/dossier"],
  "zone-collectee": ["le Rhône", "#/departement/69"], verifie: ["l'autorisation de Mions du 18 novembre 2025", "#/evenement/69-2025-11-18-00015"],
  "voie-publique": ["Mions : 125 caméras sur la rue", "#/affaire/69-20083300"], videoverbalisation: ["Mions", "#/commune/69283"],
  drones: ["Meyzieu", "#/commune/69282/carte"], pietons: ["les caméras-piétons dans le Rhône", "#/explorer?nature=aut&dispositif=pietons&dep=69"],
  csu: ["les centres de supervision", "#/explorer?dispositif=csu"], lapi: ["la lecture de plaques", "#/explorer?dispositif=lapi"], dispositif: ["la recherche par dispositif", "#/explorer?dispositif=vsa"],
  acte: ["un arrêté de Mions", "#/evenement/69-2026-06-30-00021"], beneficiaire: ["Mions", "#/commune/69283"], acheteur: ["la Métropole de Lyon", "#/acheteur/200046977"],
  titulaire: ["Serfim T.I.C.", "#/entreprise/431903954"], resultat: ["un résultat à Mions", "#/evenement/21-16838"], deliberation: ["une subvention à Mennecy", "#/affaire/sub-EX077568"],
  detr: ["les subventions dans le Rhône", "#/explorer?nature=sub&dep=69"], "region-sud": ["les subventions des Bouches-du-Rhône", "#/explorer?nature=sub&dep=13"],
  siren: ["Alphaiota (SIREN 899832901)", "#/entreprise/899832901"], sirene: ["une pharmacie nommée à Mions", "#/evenement/69-2026-07-15-00020"], insee: ["Mions", "#/commune/69283"],
  totaux: ["Charenton-le-Pont", "#/commune/94018"], "plafond-partage": ["Charenton-le-Pont", "#/commune/94018/dossier?nature=con"], "acheteur-national": ["la recherche dans Paris", "#/explorer?dep=75&nature=con"],
  couverture: ["Paris", "#/commune/75056"], centrale: ["la recherche des contrats", "#/explorer?nature=con"], "contrat-mixte": ["les documents de Lyon", "#/commune/69123/dossier?nature=con"],
  "montant-a-verifier": ["Charenton-le-Pont", "#/commune/94018/dossier?nature=con"], "lien-probable": ["l'appel d'offres de Mions de 2020", "#/affaire/avis-20-142345"],
  duree: ["l'autorisation de Mions", "#/affaire/69-20083300"], "nom-non-publie": ["les autorisations privées de Mions", "#/commune/69283/dossier?qui=prives&nature=aut"],
  "appel-offres": ["l'appel d'offres de Mions de juillet 2026", "#/affaire/avis-26-71981"], contrat: ["le contrat de Mions de 2025", "#/affaire/21690283300013202520240600_32323500"],
  "montant-maximum": ["Mions", "#/commune/69283"], avenant: ["un contrat modifié 15 fois", "#/affaire/200054807000172024Z240006F00_45000000"], "accord-cadre": ["Saint-Priest", "#/commune/69290/dossier?nature=con"],
  autorisation: ["Saint-Priest", "#/commune/69290"], recueil: ["un arrêté de drones", "#/evenement/69-2026-04-03-00001"], "dossier-prefectoral": ["le dossier de Mions ouvert en 2008", "#/affaire/69-20083300"],
  subvention: ["Mennecy", "#/commune/91386"], vsa: ["le Stade de France", "#/commune/93066/carte"], decp: ["Serfim T.I.C.", "#/entreprise/431903954"], boamp: ["l'avis 26-71981", "#/recherche?q=26-71981"],
  carte: ["Lyon", "#/commune/69123"], cada: ["les documents introuvables de Mions", "#/commune/69283"], "analyse-algorithmique": ["le Stade de France", "#/commune/93066/carte"],
  "trace-indicatif": ["Meyzieu", "#/commune/69282/carte"], "offres-recues": ["le contrat de Mions de 2025", "#/affaire/21690283300013202520240600_32323500"],
  "prefecture-zone": ["les tunnels autoroutiers", "#/affaire/69-20140883"], mediane: ["la recherche", "#/explorer"], empreinte: ["un arrêté de Mions", "#/evenement/69-2026-06-30-00021"],
  "licence-ouverte": ["les téléchargements de Mions", "#/commune/69283/dossier"], openstreetmap: ["la carte de Mions", "#/commune/69283"], odbl: ["la carte de Mions", "#/commune/69283"], formats: ["les téléchargements de Mions", "#/commune/69283/dossier"],
};
function pageGlossaire() {
  $("#app").innerHTML = `<div class="ident"><span class="tag plain">Glossaire</span><h1 class="long">Les mots du registre</h1><p class="tw">${GLOSSAIRE.length} entrées</p></div>
    <main class="hist"><dl class="gloss">${GLOSSAIRE.map(([id, t, d]) => `<dt id="${id}">${t}</dt><dd>${d}${EXEMPLES[id] ? `<br><a class="ex" href="${EXEMPLES[id][1]}">Un exemple : ${esc(EXEMPLES[id][0])} →</a>` : ""}</dd>`).join("")}</dl></main>`;
  const anchor = location.hash.split("#")[2], dt = anchor && document.getElementById(anchor);
  if (dt) { dt.classList.add("cible"); dt.nextElementSibling?.classList.add("cible"); dt.tabIndex = -1; dt.focus(); dt.scrollIntoView({ block: "start" }); }
}
function route() {
  const h = location.hash.slice(1).split("#")[0] || "/", [path, qs] = h.split("?"), parts = path.split("/").filter(Boolean);
  state.q = ""; state.limit = PAGE; state.filters = {};
  if (qs) new URLSearchParams(qs).forEach((v, k) => state.filters[k] = v);
  if (state.filters.nature === "arrete") state.filters.nature = "aut";
  if (state.filters.nature === "contrat") state.filters.nature = "con";
  current?.pause?.(); current = null;
  document.querySelectorAll(".modal, .sheet-bg").forEach(m => m.remove());
  window.scrollTo(0, 0);
  const carteLink = $("[data-carte]"); if (carteLink) carteLink.href = parts[0] === "commune" ? `#/commune/${parts[1]}/carte` : "#/commune/69123/carte";
  // 11th pass: the views made from the wide mockups (app11.js) first; on a phone, the v10 pages below where a phone mockup exists
  if (window.V11 && V11.route(parts, state.filters)) return;
  if (parts[0] === "commune" && (parts[2] === "dossier" || parts[2] === "documents")) return pageDocuments(parts[1]);
  if (parts[0] === "commune" && parts[2] === "carte") return pageCarte(parts[1], state.filters.acte);
  if (parts[0] === "commune") return pageCommune(parts[1]);
  if (parts[0] === "affaire") return pageAffaire(decodeURIComponent(parts[1]));
  if (parts[0] === "evenement") { const e = EV[decodeURIComponent(parts[1])]; return e ? pageAffaire(e.affaire, e.id) : pageAccueil(); }
  if (parts[0] === "entreprise") return pageEntreprise(parts[1]);
  if (parts[0] === "explorer") return pageExplorer();
  if (parts[0] === "acheteur") return pageAcheteur(parts[1]);
  if (parts[0] === "departement") return pageDepartement(parts[1]);
  if (parts[0] === "recherche") return pageRecherche(state.filters.q || "");
  if (parts[0] === "glossaire") return pageGlossaire();
  return pageAccueil();
}
// the router is started by app11.js, once the views' templates are loaded
