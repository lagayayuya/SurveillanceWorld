// View 6 · Commune · Carte et drones (maquette CarteTemps-grand.dc.html): the v10 time map (carte3d.mjs) in the
// mockup's frame: layers, the map and its panel, the frieze of the slots of flight with its brush, the list.
// 11th pass fixes: labels on hover or selection only (Lyon was cluttered); the hours of a period count every
// slot shown, drones and algorithmic analysis (Saint-Denis said « 0 h » beside an 8 h slot); no « hours not read » row.
(() => {
  "use strict";
  const D = D11;
  const MOIS = D.MOISC;
  const fdt = (ms, withH) => { const d = new Date(ms); let s = d.getUTCDate() + " " + MOIS[d.getUTCMonth()] + " " + d.getUTCFullYear(); if (withH) s += ", " + String(d.getUTCHours()).padStart(2, "0") + " h " + String(d.getUTCMinutes()).padStart(2, "0"); return s; };
  const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  class Carte extends Vue {
    init(p) {
      const st = { r0: null, r1: null, sel: -1, hov: -1, playing: false, info: false, drones: true, cams: true, vsa: true };
      if (/^\d{4}-\d{2}$/.test(p.mois || "")) { st.r0 = Date.UTC(+p.mois.slice(0, 4), +p.mois.slice(5, 7) - 1, 1); st.r1 = Date.UTC(+p.mois.slice(0, 4), +p.mois.slice(5, 7), 1); }
      return st;
    }
    titre() { return "Carte et drones · " + (R.communes[this.props.insee]?.nom || ""); }
    slots() {
      if (this._T) return this._T;
      const insee = this.props.insee, ZID = Object.fromEntries((window.ZONES || []).map(z => [z.id, z])), SIT = Object.fromEntries((window.SITES || []).map(s => [s.id, s]));
      const by = new Map();
      for (const a of (window.AUTORISATIONS || []).filter(x => x.insee.includes(insee))) for (const p of a.periodes) {
        const sites = [...new Set(a.zones.map(id => ZID[id]?.site).filter(s => s && SIT[s]?.parts?.[insee]))].sort();
        const key = `${p.t0}|${p.t1}|${sites.join(",")}|${a.kind}`;
        const o = by.get(key) || { t0: p.t0, t1: p.t1, h: p.heures, sure: !!p.heures_sures && p.heures != null, kind: a.kind, svc: a.service || "", fin: (a.finalite || "finalité non lue").replace(/\s+/g, " ").replace(/^dans le cadre (des|de la|du|de l'|d')\s*/i, ""), url: a.url, actes: [], sites,
          st: sites.length && sites.every(s => SIT[s].statut === "relu") ? "r" : "i" };
        o.actes.push(a.acte); by.set(key, o);
      }
      return this._T = [...by.values()].sort((a, b) => a.t0 - b.t0);
    }
    componentDidMount() {
      const insee = this.props.insee, el = document.getElementById("carte-tps");
      if (!el) return;
      if (nCartes(insee) == null) { el.innerHTML = `<p style="margin: 0; padding: 20px; color: var(--muted)">La carte de ${esc(R.communes[insee]?.nom || insee)} n'est pas encore découpée dans ce prototype.</p>`; return; }
      const T = this.slots();
      const first = s => this.state.sel >= 0 && T[this.state.sel].sites.includes(s) ? this.state.sel : T.findIndex(t => t.sites.includes(s) && this.inRange(t));
      // no turn here (the mockup's map turns by hand only) and no control of its own: the frame has its « N »
      mountMap(el, insee, { etiquettes: "survol", controles: false, play: false, couches: { cams: true, vsa: true, drones: true },
        onZone: u => { if (!u) return; const i = first(u.id); if (i >= 0) this.setState({ sel: i, playing: false }); },
        onHover: u => { const i = u ? first(u.id) : -1; if (i !== this.state.hov) this.setState({ hov: i }); } }).then(m => { if (!m) return; this.map = m; this.syncMap(true); });
      this.player = setInterval(() => { if (this.state.playing) { const n = T.length; if (n) this.setState({ sel: (this.state.sel + 1) % n, hov: -1 }); } }, 1400);
    }
    componentWillUnmount() { clearInterval(this.player); this.map?.stop(false); }
    componentDidUpdate() { this.syncMap(false); }
    range() { const T = this.slots(), A = T.length ? Date.UTC(new Date(T[0].t0).getUTCFullYear(), new Date(T[0].t0).getUTCMonth(), 1) : Date.UTC(2025, 10, 1), B = Date.parse(TODAY + "T00:00:00Z");
      return { A, B, r0: this.state.r0 ?? A, r1: this.state.r1 ?? B }; }
    inRange(t) { const { r0, r1 } = this.range(); return t.t1 > r0 && t.t0 < r1; }
    // the map follows: the hours of each site over the period, or the selected slot's; the layers; the selection
    syncMap(force) {
      const m = this.map; if (!m) return;
      const S = this.state, T = this.slots(), key = [S.r0, S.r1, S.sel, S.hov, S.drones, S.vsa, S.cams].join("|");
      if (!force && key === this._mk) return; this._mk = key;
      const kinds = [S.drones ? "drone" : "", S.vsa ? "vsa" : ""].filter(Boolean);
      let H = {};
      if (S.sel >= 0) { const t = T[S.sel]; if (kinds.includes(t.kind)) t.sites.forEach(s => { H[s] = { heures: t.h || 0, n: t.actes.length }; }); }
      else { const { r0, r1 } = this.range(); H = Object.fromEntries(Object.entries(D.heuresSites(this.props.insee, r0, r1, kinds)).map(([k, x]) => [k, { heures: x.heures, n: x.n }])); }
      m.setHeures(H); m.setCouches({ cams: S.cams, vsa: S.vsa, drones: S.drones });
      const f = S.hov >= 0 ? T[S.hov] : S.sel >= 0 ? T[S.sel] : null;
      m.select(f ? f.sites[0] || null : null); m.hover(S.hov >= 0 ? T[S.hov].sites[0] || null : null);
    }
    renderVals() {
      const S = this.state, insee = this.props.insee, T = this.slots(), { A, B, r0, r1 } = this.range();
      const allMode = S.r0 == null && S.sel < 0;
      const shownKind = t => (t.kind === "drone" && S.drones) || (t.kind === "vsa" && S.vsa);
      const inR = t => t.t1 > r0 && t.t0 < r1;
      // the frieze
      const W = 1136, X = ms => 4 + (ms - A) / (B - A) * W;
      const lanesEnd = [];
      const bars = T.map((t, i) => {
        const x = X(t.t0), w = Math.max(4, X(t.t1) - x);
        let lane = 0; while (lanesEnd[lane] != null && lanesEnd[lane] > x - 2) lane++; lanesEnd[lane] = x + w;
        const on = S.sel === i || S.hov === i, vis = shownKind(t) && (S.sel >= 0 ? S.sel === i : inR(t));
        return { x: x.toFixed(1), y: Math.max(4, 112 - lane * 15), w: w.toFixed(1), fill: on ? "var(--hover)" : t.kind === "vsa" ? "#b38f00" : "var(--drone)", op: vis ? 1 : 0.3, stroke: t.sure ? "none" : "var(--fg)", sw: t.sure ? 0 : 1.2, dash: t.sure ? "none" : "3 2",
          hover: () => { if (this.state.hov !== i) this.setState({ hov: i }); }, pick: e => { e.stopPropagation(); this.setState({ sel: i, playing: false }); } };
      });
      const months = [];
      for (let k = 0; ; k++) { const d = new Date(Date.UTC(new Date(A).getUTCFullYear(), new Date(A).getUTCMonth() + k, 1)), ms = d.getTime(); if (ms >= B) break;
        months.push({ x: X(ms).toFixed(1), tx: (X(ms) + 4).toFixed(1), l: MOIS[d.getUTCMonth()] + (d.getUTCMonth() === 0 || k === 0 && T.length && new Date(A).getUTCFullYear() !== 2025 ? " " + d.getUTCFullYear() : "") }); }
      const brush = { x: X(r0).toFixed(1), w: Math.max(2, X(r1) - X(r0)).toFixed(1) };
      const toMs = px => A + (px - 4) / W * (B - A), svgX = e => { const r = e.currentTarget.getBoundingClientRect(); return (e.clientX - r.left) * 1144 / r.width; };
      // the panel: a slot, or the period
      const act = T.map((t, i) => ({ t, i })).filter(o => shownKind(o.t) && (S.sel >= 0 ? o.i === S.sel : inR(o.t)));
      // the hours read in the acts (an act without its hours counts none: dashed bar); a chosen period takes its share
      const rangeH = Math.round(act.reduce((s, o) => s + Math.max(0, (o.t.h || 0) * (S.sel >= 0 || allMode ? 1 : Math.min(1, (Math.min(o.t.t1, r1) - Math.max(o.t.t0, r0)) / Math.max(1, o.t.t1 - o.t.t0)))), 0));
      const places = new Set(act.flatMap(o => o.t.sites)).size;
      const focus = S.hov >= 0 ? S.hov : S.sel;
      let det;
      if (focus >= 0) { const t = T[focus];
        det = { kicker: `Créneau ${focus + 1} sur ${T.length}` + (t.st === "i" ? " · tracé indicatif" : " · tracé relu") + (t.kind === "vsa" ? " · analyse algorithmique" : ""), title: fdt(t.t0, true),
          rows: [{ k: "Durée", v: t.sure ? D.fr(t.h) + " h" : "horaires non précisés dans l'arrêté" }, { k: "Service", v: t.svc }, { k: "Arrêtés", v: String(t.actes.length) }, { k: "Fin", v: fdt(t.t1, true) }], note: "Pour : " + t.fin + ".", link: t.url ? "Voir l’arrêté ↗" : "", href: t.url || "" }; }
      else det = { kicker: allMode ? "Toutes les dates collectées" : "Période choisie", title: fdt(r0) + " → " + fdt(r1), rows: [{ k: "Créneaux de vol", v: String(act.length) }, { k: "Heures autorisées", v: D.fr(rangeH) + " h" }, { k: "Endroits", v: String(places) }],
        note: "Survolez un volume ou une barre de la frise pour voir le créneau.", link: "", href: "" };
      const listIdx = T.map((t, i) => i).filter(i => shownKind(T[i]) && (S.sel >= 0 ? i <= S.sel : inR(T[i]))).reverse().slice(0, 8);
      const rows = listIdx.map(i => { const t = T[i], on = i === S.sel || i === S.hov; return { d: fdt(t.t0, true), svc: t.svc, fin: t.fin, h: t.sure ? D.fr(t.h) + " h" : "horaires non précisés",
        hover: () => { if (this.state.hov !== i) this.setState({ hov: i }); }, pick: () => this.setState({ sel: i, playing: false }),
        style: "all: unset; box-sizing: border-box; cursor: pointer; display: grid; grid-template-columns: 210px 180px minmax(0, 1fr) 110px; gap: 14px; align-items: center; min-height: 46px; padding: 0 8px; border-bottom: 1px solid var(--rule); " + (on ? "background: var(--soft); box-shadow: inset 4px 0 0 var(--hover)" : "") }; });
      const L = [["cams", "Caméras placées", "background: #111; box-shadow: 0 0 0 2px #f2efe6, 0 0 0 3px #111"], ["vsa", "Analyse algorithmique", "background: repeating-linear-gradient(45deg, #ffe800 0 3px, #111 3px 6px)"], ["drones", "Drones", "background: #7fd4ff"]];
      const layers = L.map(([k, l, sw]) => ({ l, pressed: S[k] ? "true" : "false", pick: () => this.setState({ [k]: !S[k] }), sw: "display: inline-block; width: 14px; height: 14px; border-radius: 50%; margin-right: 8px; vertical-align: -2px; " + sw + (S[k] ? "" : "; opacity: .35"), style: S[k] ? "background: var(--fg); color: var(--bg)" : "background: var(--card); color: var(--fg)" }));
      const nom = R.communes[insee]?.nom || insee, n = T.length;
      return Object.assign(this.base("carte"), D.filCommune(insee, "Carte et drones"), {
        com: D.tete(insee, "carte"), layers, det, bars, months, brush, rows,
        alt: `Carte inclinée de ${nom} : ${places} endroits où des vols de drone ou une analyse algorithmique ont été autorisés sur la période, la hauteur de chaque volume étant proportionnelle aux heures autorisées. La liste sous la frise dit la même chose en texte.`,
        tlAlt: n ? `Frise des ${n} créneaux autorisés à ${nom}, de ${D.fmL(new Date(A).toISOString().slice(0, 10))} à ${D.fmL(TODAY)}.` : `Aucun créneau autorisé à ${nom}.`,
        rangeLabel: S.sel >= 0 ? `Créneau ${S.sel + 1} sur ${n}` : allMode ? `Toutes les dates · ${act.length} créneaux · ${D.fr(rangeH)} h` : `${fdt(r0)} → ${fdt(r1)} · ${act.length} créneaux · ${D.fr(rangeH)} h`,
        listTitle: S.sel >= 0 ? "Créneau choisi et précédents" : allMode ? `Les ${n} créneaux` : `${act.length} créneaux sur la période`,
        all: () => this.setState({ r0: null, r1: null, sel: -1, hov: -1, playing: false }), allPressed: allMode ? "true" : "false", allStyle: allMode ? "background: var(--fg); color: var(--bg)" : "",
        prev: () => n && this.setState({ sel: S.sel <= 0 ? n - 1 : S.sel - 1, playing: false, hov: -1 }), next: () => n && this.setState({ sel: (S.sel + 1) % n, playing: false, hov: -1 }),
        play: () => { if (reduced() || !n) return; this.setState({ playing: !S.playing, sel: S.sel < 0 ? 0 : S.sel, hov: -1 }); },
        playText: S.playing ? "❚❚ Pause" : "▶ Lire", playPressed: S.playing ? "true" : "false",
        showInfo: S.info, infoOpen: S.info ? "true" : "false", tglInfo: () => this.setState({ info: !S.info }),
        tdown: e => { this.drag = svgX(e); try { e.currentTarget.setPointerCapture(e.pointerId); } catch (x) { /* no capture */ } },
        tmove: e => { if (this.drag == null) return; const x = svgX(e), a = Math.min(this.drag, x), b = Math.max(this.drag, x); if (b - a > 4) this.setState({ r0: toMs(a), r1: toMs(b), sel: -1, playing: false }); },
        tup: () => { this.drag = null; }, north: () => this.map?.north(),
      });
    }
  }
  V11.register("carte", Carte);
})();
