// The shell of the v11 views: the kit's header, the router, the base class of the views, the theme.
// Views made from the wide mockups are rendered by dc.js from vues/<name>.html (the mockup's markup) and
// vues/<name>.js (its figures, from the registre). On a phone, every view is the same view in one column
// (kit.css, « téléphone »): the phone mockups are out of date (Ju, 2026-10-25); the v10 pages are no longer shown.
(() => {
  "use strict";
  const WIDE = matchMedia("(min-width: 960px)");
  const views = V11.views, templates = {};
  let mounted = null, mountedKey = "";
  const dark = () => document.documentElement.classList.contains("dark");

  // --- stylesheets and the two shells ---------------------------------------------------------------
  function useKit(on) {
    document.getElementById("css-kit").disabled = !on;
    document.getElementById("css-v10").disabled = on;
    document.getElementById("kit").hidden = !on;
    document.getElementById("v10").hidden = on;
  }
  function header(navCur, insee) {
    const h = document.querySelector("#kit .entete");
    h.querySelectorAll("[data-nav]").forEach(a => {
      const k = a.dataset.nav;
      if (k === "registre" || k === "glossaire" || k === "carte") { if (k === navCur) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); }
    });
    // « Carte » opens the drone map of the commune on screen, else of the last commune seen, else Lyon (the mockup's)
    if (insee) try { sessionStorage.setItem("commune", insee); } catch (e) { /* private mode */ }
    let last = insee; if (!last) try { last = sessionStorage.getItem("commune"); } catch (e) { /* private mode */ }
    h.querySelectorAll('[data-nav^="carte"]').forEach(a => a.href = `#/commune/${last && R.communes[last] ? last : "69123"}/carte`);
    const b = h.querySelector("[data-theme-btn]");
    b.setAttribute("aria-label", dark() ? "Passer en thème clair" : "Passer en thème sombre");
    b.innerHTML = dark() ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="4.5"></circle><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"></path></svg>'
      : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M20.5 14.5A8.5 8.5 0 1 1 9.5 3.5a7 7 0 0 0 11 11z"></path></svg>';
  }
  document.querySelector("[data-theme-btn]").addEventListener("click", () => {
    const d = !dark(); document.documentElement.classList.toggle("dark", d);
    try { sessionStorage.setItem("theme", d ? "dark" : "light"); } catch (e) { /* private mode */ }
    header(document.querySelector('#kit [aria-current="page"]')?.dataset.nav);
    if (mounted) mounted.inst.__schedule();
    dispatchEvent(new Event("themechange"));
  });

  // the mockups' section tabs are anchors (#argent, #d-ic…): they scroll the page, never change the route
  document.getElementById("kit").addEventListener("click", ev => {
    const a = ev.target.closest('a[href^="#"]:not([href^="#/"])'); if (!a || a.getAttribute("href") === "#") return;
    const t = document.getElementById(a.getAttribute("href").slice(1)); if (!t) return;
    ev.preventDefault(); t.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    t.setAttribute("tabindex", "-1"); t.focus({ preventScroll: true });
  });

  // the phone: each cell of a table carries its column's name (shown when the row unfolds); a touched row unfolds
  // a title's size shrinks until its longest word fits (never cut inside a word)
  const fitTitles = root => root.querySelectorAll("h1").forEach(h => {
    h.style.removeProperty("font-size"); let px = parseFloat(getComputedStyle(h).fontSize);
    while (h.scrollWidth > h.clientWidth + 1 && px > 22) { px -= 2; h.style.setProperty("font-size", px + "px", "important"); }
  });
  addEventListener("resize", () => fitTitles(document.getElementById("vue")));
  DC.afterRender = root => {
    fitTitles(root);
    if (WIDE.matches) return;
    root.querySelectorAll("table.t").forEach(t => { const hs = [...t.querySelectorAll("thead th")].map(th => th.textContent.replace(/[↑↓]/g, "").trim());
      // a re-render resets the row's attributes from its template: its state lives on the node and is put back
      // no aria-expanded on a table row (not allowed outside a treegrid): a folded cell is clipped, still read aloud
      t.querySelectorAll("tbody tr:not(.sub)").forEach(tr => { tr.classList.toggle("ouvert", !!tr.__ouvert); tr.__depliable = true;
        [...tr.children].forEach((td, i) => { if (i && hs[i]) td.setAttribute("data-l", hs[i]); }); }); });
  };
  const unfold = tr => { tr.__ouvert = !tr.__ouvert; tr.classList.toggle("ouvert", tr.__ouvert); };
  document.getElementById("vue").addEventListener("click", ev => { if (WIDE.matches || ev.target.closest("a, button, input")) return; const tr = ev.target.closest("table.t tbody tr"); if (tr && tr.__depliable) unfold(tr); });

  // --- mount a view ---------------------------------------------------------------------------------
  function show(name, params, nav) {
    const key = name + "|" + JSON.stringify(params) + "|" + WIDE.matches + "|" + location.hash;
    useKit(true);
    header(nav ?? "registre", params.insee);
    if (mounted && mountedKey === key) return true;
    if (mounted) mounted.unmount();
    const root = document.getElementById("vue");
    root.innerHTML = "";
    mounted = DC.mount(root, views[name], params, templates[name]);
    mountedKey = key;
    window.__vue = { name, inst: mounted.inst };
    if (params.ancre) requestAnimationFrame(() => document.getElementById(params.ancre)?.scrollIntoView({ block: "start" }));
    else window.scrollTo(0, 0);
    document.title = (mounted.inst.titre ? mounted.inst.titre() + " · " : "") + "Registre de la vidéosurveillance";
    return true;
  }
  function leave() { if (mounted) { mounted.unmount(); mounted = null; mountedKey = ""; } useKit(false); }

  // the routes (an unknown one returns false: app.js renders its v10 fallback)
  V11.route = (parts, q) => {
    const [a, b, c, d] = parts, wide = WIDE.matches;
    if (!a || a === "registre" && !b || a === "recherche" || a === "explorer") return show("registre", { q: q.q || "", t: q.t || "", d: q.d || "", p: q.p || "", y: q.y || "" });
    if (a === "registre" && b === "chiffres") return show("chiffres", {});
    if (a === "glossaire") return show("glossaire", { ancre: location.hash.split("#")[2] || "" }, "glossaire");
    if (a === "departement") return show("departement", { dep: b });
    if (a === "acheteur") return show("acheteur", { siren: b });
    if (a === "commune" && c === "autorisations") return show("autorisations", { insee: b, dossier: d ? decodeURIComponent(d) : "" }, "");
    if (a === "commune" && (c === "documents" || c === "dossier")) return show("documents", { insee: b }, "");
    if (a === "commune" && c === "carte") return show("carte", { insee: b, mois: q.mois || "" }, "carte");
    if (a === "commune") return show("commune", { insee: b }, "");
    if (a === "entreprise") return show("entreprise", { siren: b });
    if (a === "contrat" || a === "affaire" || a === "evenement") {
      // an act of a préfecture: the Autorisations tab of its commune, on its dossier; anything else: the record
      const ev = a === "evenement" ? EV[decodeURIComponent(b)] : null, id = ev ? ev.affaire : decodeURIComponent(b || "");
      const af = R.affaires[id], first = af && EV[af.events?.[0]];
      if (first && first.t.startsWith("arrete") && first.insee && R.communes[first.insee]) { location.replace(`#/commune/${first.insee}/autorisations/${encodeURIComponent(id)}`); return true; }
      if (a !== "contrat") { location.replace(`#/contrat/${encodeURIComponent(id)}`); return true; }
      return show("contrat", { id, ev: ev ? ev.id : "" });
    }
    leave(); return false;
  };
  V11.leave = leave;
  // crossing the breakpoint changes the page: the router is run again
  WIDE.addEventListener("change", () => { mountedKey = ""; route(); });

  // the templates (the mockups' markup) and the shared pieces, fetched once, then the first route
  const NAMES = ["registre", "chiffres", "commune", "documents", "autorisations", "carte", "contrat", "entreprise", "acheteur", "departement", "glossaire"];
  Promise.all([fetch("vues/socle.html").then(r => r.text()).then(DC.addParts),
    ...NAMES.map(n => fetch(`vues/${n}.html`).then(r => r.text()).then(t => { templates[n] = DC.parse(t); }))])
    .then(() => { window.addEventListener("hashchange", route); route(); window.__v11 = true; })
    .catch(e => { document.body.insertAdjacentHTML("afterbegin", `<p>Erreur de chargement : ${String(e)}</p>`); console.error(e); });
})();
