import {
  type AddProtocolAction,
  AttributionControl,
  addProtocol,
  LngLat,
  type MapGeoJSONFeature,
  type MapLayerMouseEvent,
  Map as MlMap,
  NavigationControl,
  type PaddingOptions,
  setWorkerUrl,
} from "maplibre-gl";
// MapLibre 6 ships its worker as a separate module; Vite must bundle it (`?worker&url`).
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Point } from "geojson";
import { Protocol } from "pmtiles";
import { isVisitor, loadSession, onSession, type Session } from "./account/session";
import { type AreaProps, isDepartement, renderAreaSheet } from "./area";
import { BottomSheet } from "./bottomsheet";
import { lowestZoom, recentre } from "./bounds";
import { DEFAULT_CONFIG, loadConfig } from "./config";
import { DEBUG, debugEvent, debugInit } from "./debug";
import {
  estimateParam,
  FilterPanel,
  initialEstimate,
  type Meta,
  withoutDirection,
} from "./filters";
import { cameraReaches, type Focus, fieldBounds, type LabelRoom } from "./focus";
import { installGestures } from "./gestures";
import { historySlot } from "./history";
import { hitWhenShown } from "./hit";
import { locale, t, tp } from "./i18n";
import { addImages, KINDS, type Kind, loadStickers, TAG_PREFIX } from "./icons";
import { installKeyboard } from "./keyboard";
import {
  AREA_SELECTED_LAYERS,
  areaFillOpacities,
  CAMERA_HIT_RADIUS,
  CITY_FADE,
  COMMUNES_MIN,
  DEFAULT_LEVEL,
  DETAIL_MIN,
  drawnBasemap,
  FOCUS_MARKER_RADIUS,
  FOCUS_MARKER_RING,
  focusMarkerLayers,
  focusMarkerSource,
  PROPOSAL_HIT,
  PROPOSAL_LINK_DASH,
  PROPOSAL_LINK_WIDTH,
  PROPOSAL_TAPE,
  proposalHitLayers,
  proposalHover,
  proposalLinkHalo,
  proposalTapeLayers,
  sources,
  stacked,
  surveillanceLayers,
} from "./layers";
import { isPhone } from "./layout";
import { endFirstLoad } from "./loading";
import { EMPTY, Locate } from "./locate";
import { nudge } from "./nudge";
import { actionSlots, Participation } from "./participate";
import { nearestStreet } from "./participate/place";
import type { Proposal } from "./participate/proposals";
import { setLeaderboardOpener } from "./participate/score";
import { tracker } from "./position";
import { prefetching, wanted as prefetchWanted } from "./prefetch";
import {
  brancher as brancherRegistre,
  porteRegistre,
  prefetchRegistre,
  REGISTRE,
} from "./registre/hote";
import { type CameraProps, headLine, renderPendingSheet, renderSheet } from "./sheet";
import "./style.css";
import { basemap, basemapLayers } from "./basemap";
import { colourMap, followMode, initTheme, type Palette, palette, themeFonts } from "./theme";
import { readHash, readParam, writeHash, writeParams } from "./url";

// The CNIL signal stays hidden until 20 random cases have been reviewed by hand.
const CNIL_SIGNAL = import.meta.env.VITE_CNIL_SIGNAL === "true";

const base = window.location.origin;
// The site's counter of map loads (hit.ts): this page, once it is shown;
// sent before anything is awaited, waiting for nothing.
hitWhenShown("map");
// Who is signed in (lot « comptes »), asked at once: the sheets and the ticket read it.
void loadSession();
setWorkerUrl(workerUrl);
// A tile request can fail with a transient network error while the tile is still needed
// (measured in the bench: tile still wanted, reloaded fine afterwards). Retry once on such
// an error; never on an abort; a second failure is reported as usual.
const pmtiles = new Protocol();
const loadTile: AddProtocolAction = async (params, abortController) => {
  for (let attempt = 0; ; attempt++) {
    try {
      return (await pmtiles.tilev4(params, abortController)) as Awaited<
        ReturnType<AddProtocolAction>
      >;
    } catch (err) {
      if (attempt >= 1 || abortController.signal.aborted || !(err instanceof TypeError)) throw err;
      window.__tileRetries = (window.__tileRetries ?? 0) + 1;
    }
  }
};
// The tiles around the view fetched while the map rests (prefetch.ts): started below, once
// the map exists.
const prefetch = prefetching(loadTile);
addProtocol("pmtiles", prefetch.loader);

// The theme first (its tokens, and the stickers before the map asks for them), with the
// build's figures.
const themed = initTheme();
const stickers = loadStickers();
// The map screen (machine.ts: the header ticket, the filters machine, the camera list),
// downloaded beside the tokens, a chunk of its own.
const machineModule = import("./machine");
// Its account square and sheets (account/index.ts, lot « comptes »), beside it.
const accountModule = import("./account");
// The welcome panel of a first visit and its « ? » square (welcome.ts, board 28a), beside it;
// not over a return from OpenStreetMap or the account's own address, whose sheet opens.
const welcomeModule = import("./welcome");
// The legal pages (legal/index.ts, the launch lot), beside it: `?page=` opens one at once.
const legalModule = import("./legal");
// The register (registre/hote.ts): a register page's address opens it over the map, its code
// asked beside the map's.
const registreAtStart = REGISTRE.test(window.location.pathname);
prefetchRegistre();
const landing = readParam("osm") !== null || readParam("compte") !== null;
// What the API says of the site (config.ts: contributions open or not, publishing, the
// publisher's identity), known before its squares and sheets are built.
const siteAsked = loadConfig();
const meta: Meta = await fetch(`${base}/tiles/meta.json`).then((r) => r.json());
await themed;
await stickers;
const site = (await siteAsked) ?? DEFAULT_CONFIG;
const machineKit = await machineModule;
const accountKit = await accountModule;
const welcomeKit = await welcomeModule;
const legalKit = await legalModule;
const sprite = (name: string) => `${base}/basemap/sprites/${name}`;
const startBasemap = basemap();

// The position lives in the hash (#zoom/lat/lng, MapLibre's form), written by us so that
// it can be held while the user's own position is shown (locate.ts).
const start = readHash();
const map = new MlMap({
  container: "map",
  center: start?.center ?? [2.347, 48.859],
  zoom: start?.zoom ?? 13,
  minZoom: 5,
  // A finger moves a little during a tap: 3 px (the default) turned taps into drags.
  clickTolerance: 10,
  maxZoom: 21,
  attributionControl: false,
  style: {
    version: 8,
    glyphs: `${base}/basemap/fonts/{fontstack}/{range}.pbf`,
    sprite: sprite(startBasemap.sprite),
    sources: {
      protomaps: {
        type: "vector",
        url: `pmtiles://${base}/basemap/basemap.pmtiles`,
        attribution: `<a href="https://protomaps.com">${tp("attribution.basemap")}</a>`,
      },
      ...sources(base),
      ...focusMarkerSource(),
    },
    // Our surfaces and lines under the basemap's labels (place names stay readable), our
    // pictograms and reach labels above them.
    // The focus marker (below z15) goes just under the selected pictogram (from z15):
    // they never show together, and the selected one stays the top layer.
    layers: stacked(
      basemapLayers(startBasemap),
      surveillanceLayers(
        // The fixed classes from the first frame (filters.ts breaks); a build without them,
        // the quantiles.
        meta.area_classes
          ? { communes: meta.area_classes, departements: meta.area_classes }
          : {
              communes: meta.communes.hi?.breaks ?? [],
              departements: meta.departements.hi?.breaks ?? [],
            },
        { publicOnly: false, est: initialEstimate(meta) },
      ).flatMap((l) => (l.id === "camera-selected" ? [...focusMarkerLayers(), l] : [l])),
    ),
  },
});
// The first load's « Chargement » (index.html, loading.ts) gone at the map's first
// complete display (MapLibre's "load": every resource of the first view in and drawn).
map.once("load", endFirstLoad);
// Always visible, never collapsed: ODbL requires the attribution, worded as the Sources page
// (« construit avec Protomaps », « données © les contributeurs d'OpenStreetMap »).
map.addControl(
  new AttributionControl({
    compact: false,
    customAttribution: `<a href="https://www.openstreetmap.org/copyright">${tp("attribution.osm")}</a> · ${tp("attribution.odbl")}`,
  }),
);
// Zoom buttons on a wide screen only: phones pinch.
if (!isPhone()) map.addControl(new NavigationControl({ showCompass: false }), "top-right");
// Zoomed out, the region stays whole and in the middle (bounds.ts): the lowest zoom fits it
// to the screen, and a view taken outside it comes back once the gesture is over.
if (meta.bounds) {
  const region = meta.bounds;
  const fit = () => {
    const { clientWidth: w, clientHeight: h } = map.getContainer();
    if (w && h) map.setMinZoom(lowestZoom(region, w, h));
  };
  fit();
  map.on("resize", fit);
  let recentring = false;
  map.on("moveend", () => {
    if (recentring) {
      recentring = false;
      return;
    }
    const { clientWidth: w, clientHeight: h } = map.getContainer();
    const c = map.getCenter();
    const back = recentre([c.lng, c.lat], map.getZoom(), region, w, h);
    if (!back) return;
    recentring = true;
    map.easeTo({ center: back, duration: 300 });
  });
}
// The URL follows the map (sharing one camera goes through the sheet's "Partager").
map.on("moveend", () => {
  const c = map.getCenter();
  writeHash(map.getZoom(), c.lat, c.lng);
});
// The attribution stays expanded (ODbL); on a phone the bottom panels sit above it. On a
// phone (DECISIONS 2026-10-09): a compact « ⓘ », always shown, unfolding the credit on a tap
// (theme/punk/map.css shows the button and folds the text on a phone only). Our own
// disclosure button: MapLibre's compact mode folds again on every drag and names its
// button in English.
const attribution = document.querySelector(".maplibregl-ctrl-bottom-right") as HTMLElement;
{
  const ctrl = attribution.querySelector(".maplibregl-ctrl-attrib") as HTMLElement;
  const inner = ctrl.querySelector(".maplibregl-ctrl-attrib-inner") as HTMLElement;
  inner.id = "attrib-text";
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.id = "attrib-toggle";
  toggle.className = "attrib-toggle";
  toggle.setAttribute("aria-controls", inner.id);
  toggle.setAttribute("aria-label", t("attribution.toggle"));
  const mark = document.createElement("span");
  mark.className = "attrib-i";
  mark.setAttribute("aria-hidden", "true");
  mark.textContent = "i";
  toggle.append(mark);
  const unfold = (open: boolean) => {
    ctrl.classList.toggle("attrib-open", open);
    toggle.setAttribute("aria-expanded", String(open));
  };
  toggle.addEventListener("click", () => unfold(!ctrl.classList.contains("attrib-open")));
  inner.before(toggle);
  unfold(false);
}
new ResizeObserver(() => {
  document.body.style.setProperty("--attrib-h", `${attribution.offsetHeight}px`);
}).observe(attribution);
// The punk level labels are drawn when asked for (icons.ts, `punk-tag:<text>`).
map.on("styleimagemissing", (e: { id: string }) => {
  if (!e.id.startsWith(TAG_PREFIX)) console.warn("missing image", e.id);
});
addImages(map);

/** The punk interface's mode changed with the phone's (theme.followMode): the basemap's
 * layers are rebuilt in the new flavour, every other colour of the map is swapped for the
 * same token's new value (filters, focus and participation layers keep their state), the
 * communes and départements take the mode's opacity, the hatches and the punk stickers are
 * redrawn, the panel and the open sheet are drawn again. The swap starts from the palette
 * the map is painted in (`painted`), so that a change met while tiles were loading —
 * deferred to the next idle, MapLibre's "load" fires once per map — or several changes in
 * a row repaint exactly once, from what is on the map. */
let painted: Palette = palette();
let restylePending = false;
function restyle(): void {
  if (!map.isStyleLoaded()) {
    if (!restylePending) {
      restylePending = true;
      map.once("idle", () => {
        restylePending = false;
        restyle();
      });
    }
    return;
  }
  const to = palette();
  if (to === painted) return;
  const pairs = colourMap(painted, to);
  const swap = (v: unknown): unknown => {
    if (typeof v === "string") return pairs.get(v) ?? v;
    if (Array.isArray(v)) return v.map(swap);
    if (v && typeof v === "object")
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, swap(x)]));
    return v;
  };
  const next = basemap();
  // The basemap as the theme draws it, punk's lifted roads included (layers.ts drawnBasemap).
  const fresh = new Map(drawnBasemap(basemapLayers(next)).map((l) => [l.id, l]));
  // Communes and départements have the mode's own opacity, where a theme sets one per mode.
  const fills: Record<string, unknown> = areaFillOpacities();
  const style = map.getStyle();
  style.sprite = sprite(next.sprite);
  style.layers = style.layers.map((l) => {
    const base = fresh.get(l.id);
    if (base) return base;
    // A layer without paint (the punk marks' symbols) stays without: `paint: undefined`
    // fails the style's validation and the whole swap with it.
    if (!l.paint) return l;
    const paint = swap(l.paint) as Record<string, unknown>;
    if (l.id in fills) paint["fill-opacity"] = fills[l.id];
    return { ...l, paint } as typeof l;
  });
  map.setStyle(style, { diff: true });
  painted = to;
  addImages(map);
  panel.render();
  // The open camera sheet's pictogram and ruler are drawn with the colours.
  if (shown && sheetPanel.state) renderSheet(sheet, shown, sheetOptions());
}
followMode(() => restyle());
// The punk fonts after the first display (theme/fonts.ts).
map.once("idle", themeFonts);

const byId = (id: string) => document.getElementById(id) as HTMLElement;
byId("estimate").setAttribute("aria-label", t("estimate.title"));
byId("filters").setAttribute("aria-label", t("legend.title"));
const panel = new FilterPanel(
  map,
  { panel: byId("filters"), estimate: byId("estimate"), fab: byId("fab-filters") },
  meta,
);
// The punk map screen: the header ticket and its links, the filters machine, the camera
// list (machine.ts), drawn by the panel at each render.
const cameraList = machineKit
  ? new machineKit.CameraList(
      map,
      () => listedCameras(),
      (id) => {
        if (isPhone()) cameraList?.close(false);
        void openById(id, "list");
      },
      () => {
        locate.release();
        map.easeTo({ zoom: DETAIL_MIN + 1 });
      },
      () => panel.setOpened(false),
    )
  : null;
// Punk: the account square under the ticket's link, its sheets in the camera sheet's place
// (showAccount, below). Contributions closed (config.ts): no account at all, and the way
// back from OpenStreetMap or to the password form taken from the address unread.
if (!site.contributions) writeParams({ osm: null, osm_why: null, compte: null });
const account =
  accountKit && site.contributions
    ? new accountKit.Account({
        sheet: byId("sheet"),
        show: (state) => showAccount(state),
        close: () => closeSheet("close button"),
        step: () => sheetPanel.step(),
        // « Mes caméras » (lot U): its sheet when its tile is loaded, else the map goes to
        // where it stands at the street level (400 ms), then its sheet; a pending add's sheet
        // from the proposals.
        openCamera: async (id, at) => {
          if (await openById(id, "account")) return true;
          if (!at) return false;
          return new Promise<boolean>((done) => {
            locate.release();
            // A map already there gives no further « idle »: given up after 8 s.
            const late = setTimeout(() => done(false), 8000);
            map.once(
              "idle",
              () =>
                void openById(id, "account").then((ok) => {
                  clearTimeout(late);
                  done(ok);
                }),
            );
            map.easeTo({
              center: at,
              zoom: Math.max(map.getZoom(), DETAIL_MIN + 2),
              duration: 400,
            });
          });
        },
      })
    : null;
// 8a's « Voir le classement » (participate/score.ts): the account's screen, the leaderboard.
if (account) setLeaderboardOpener(() => account.open());
const welcome = welcomeKit ? new welcomeKit.Welcome(site.contributions) : null;
if (machineKit && cameraList)
  panel.setSkin(
    new machineKit.Machine(
      byId("filters"),
      byId("fab-filters") as HTMLButtonElement,
      panel,
      cameraList,
      [account?.square, welcome?.square, porteRegistre()].filter((x) => x !== undefined),
    ),
  );
// A legal page's address opens it in place of the welcome of a first visit.
const legalAtStart = legalKit?.pageAtStart() ?? null;
if (welcome && !landing && !legalAtStart && !registreAtStart) welcome.first();
if (legalKit && legalAtStart) legalKit.openLegal(legalAtStart);

/** The cameras in view the filters keep, nearest the map's centre first (the punk list);
 * null below the street level, where no camera is loaded. */
function listedCameras() {
  if (map.getZoom() < DETAIL_MIN) return null;
  const b = map.getBounds();
  const c = map.getCenter();
  const opIds = new Set(panel.adv.operatorIds());
  const showGone = panel.adv.active.has("gone");
  const seen = new Set<string>();
  const out: { id: string; kind: Kind; label: string; distance: number }[] = [];
  for (const f of map.querySourceFeatures("detail", { sourceLayer: "cameras" })) {
    const p = f.properties;
    const id = String(p.id);
    if (seen.has(id) || f.geometry.type !== "Point") continue;
    const at = f.geometry.coordinates as [number, number];
    if (!b.contains(at)) continue;
    seen.add(id);
    if (p.gm !== undefined && !showGone) continue;
    if (!panel.passes(p as Focus["props"], opIds)) continue;
    out.push({
      id,
      kind: (KINDS as readonly string[]).includes(String(p.k)) ? (p.k as Kind) : "unknown",
      label: headLine(p as CameraProps),
      distance: Math.round(c.distanceTo(new LngLat(at[0], at[1]))),
    });
  }
  return out.sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id));
}

// A proposal's tape (20a) in place of the participation's blue badge and dot, once its
// source is there (participate/proposals.ts adds it at the first refresh).
map.on("sourcedata", (e) => {
  if (e.sourceId !== "proposals" || map.getLayer(PROPOSAL_TAPE)) return;
  for (const id of ["proposal-dot", "proposal-badge"])
    if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", "none");
  // A pending move's line, thicker on its halo, above the fields (layers.ts).
  if (map.getLayer("proposal-link")) {
    map.addLayer(proposalLinkHalo(), "proposal-link");
    map.setPaintProperty("proposal-link", "line-width", PROPOSAL_LINK_WIDTH);
    map.setPaintProperty("proposal-link", "line-dasharray", PROPOSAL_LINK_DASH);
    map.setLayoutProperty("proposal-link", "line-cap", "butt");
  }
  const top = map.getLayer("camera-selected") ? "camera-selected" : undefined;
  for (const layer of [...proposalHitLayers(), ...proposalTapeLayers()]) map.addLayer(layer, top);
  panel.apply();
});
// A proposal answers the pointer as a camera does (layers.ts proposalHitLayers): the
// hand, a ring; a tap is answered in selectAt.
let hoveredProposal: string | null = null;
const hoverProposal = (c: string | null) => {
  // While adding or modifying, the proposals are hidden (participate/slide.ts): no hover.
  if (c !== null && moving()) return;
  if (c === hoveredProposal) return;
  hoveredProposal = c;
  if (map.getLayer(PROPOSAL_HIT))
    for (const [prop, value] of Object.entries(proposalHover(c)))
      map.setPaintProperty(PROPOSAL_HIT, prop as "circle-opacity", value);
  map.getCanvas().style.cursor = c === null ? "" : "pointer";
};
map.on("mousemove", PROPOSAL_HIT, (e: MapLayerMouseEvent) => {
  const c = e.features?.[0]?.properties.c;
  hoverProposal(c === undefined ? null : String(c));
});
map.on("mouseleave", PROPOSAL_HIT, () => hoverProposal(null));
map.once("load", () => {
  // The user's position, when asked for (locate.ts), with its accuracy circle.
  map.addSource("me", { type: "geojson", data: EMPTY });
  map.addSource("me-accuracy", { type: "geojson", data: EMPTY });
  // Above the pictograms, under the camera in focus.
  map.addLayer(
    {
      id: "me-accuracy",
      type: "fill",
      source: "me-accuracy",
      layout: { visibility: "none" },
      paint: { "fill-color": palette().me, "fill-opacity": 0.12 },
    },
    "camera-selected",
  );
  map.addLayer(
    {
      id: "me-accuracy-line",
      type: "line",
      source: "me-accuracy",
      layout: { visibility: "none" },
      paint: { "line-color": palette().me, "line-opacity": 0.45, "line-width": 1 },
    },
    "camera-selected",
  );
  map.addLayer(
    {
      id: "me",
      type: "circle",
      source: "me",
      layout: { visibility: "none" },
      paint: {
        "circle-radius": 8,
        "circle-color": palette().me,
        "circle-stroke-width": 3,
        "circle-stroke-color": palette().halo,
      },
    },
    "camera-selected",
  );
  panel.apply();
  panel.render();
  // Contributions closed (config.ts): no participation at all (« ＋ Ajouter », « Modifier »,
  // « Toujours là ? », the proposals and their tape, the send queue's counter).
  if (!site.contributions) return;
  participation = new Participation(map, meta, {
    est: () => panel.mode.est,
    closeSheet: () => closeSheet("move"),
    afterMove: () => undefined,
    label: (id) => {
      const f = map
        .querySourceFeatures("detail", { sourceLayer: "cameras" })
        .find((c) => c.properties.id === id);
      // The type and where it is (« Caméra fixe · Rue de Paris », the nearest street
      // in the tiles, as the Position ticket), never a raw id; « Caméra » unknown.
      const kind = String(f?.properties.k ?? "unknown");
      const word = t(`sheet.punk.title.${kind}`);
      if (!f) return word;
      const at = (f.geometry as Point).coordinates as [number, number];
      const street = nearestStreet(
        map.querySourceFeatures("protomaps", { sourceLayer: "roads" }),
        at,
      );
      return street ? `${word} · ${street}` : word;
    },
    open: (id) => void openById(id, "list"),
    login: account ? (then, back) => account.require(then, back) : undefined,
  });
});
const locate = new Locate(map, byId("fab-locate") as HTMLButtonElement, () => freePadding());
// Participation (phase D1): verify and move a camera, from its sheet.
let participation: Participation | null = null;
const moving = () => participation?.busy() === true;

// --- cameras: hover highlight, hand cursor, enlarged click target -----------------------
const sheet = byId("sheet");
let hovered: string | number | undefined;
const cameraRef = (id: string | number) => ({ source: "detail", sourceLayer: "cameras", id });
map.on("mousemove", "camera-hit", (e: MapLayerMouseEvent) => {
  const id = e.features?.[0]?.id;
  if (id === hovered) return;
  if (hovered !== undefined) map.setFeatureState(cameraRef(hovered), { hover: false });
  hovered = id;
  if (id !== undefined) map.setFeatureState(cameraRef(id), { hover: true });
  map.getCanvas().style.cursor = "pointer";
});
map.on("mouseleave", "camera-hit", () => {
  if (hovered !== undefined) map.setFeatureState(cameraRef(hovered), { hover: false });
  hovered = undefined;
  map.getCanvas().style.cursor = "";
});
// Focus mode while a camera's sheet is open: everything else dimmed, its three estimates
// outlined with their reach, the street it films highlighted. Leaving: the sheet's close
// button, a click or tap anywhere else on the map, or Escape.
const setFocus = (focus: Focus | null) => {
  // A camera comes into focus on « identifie » (DECISIONS 2026-10-08).
  if (focus?.id !== panel.focus?.id) panel.level = DEFAULT_LEVEL;
  panel.focus = focus;
  panel.apply();
  document.body.classList.toggle("focus", focus !== null);
  markFar();
  debugEvent(
    focus
      ? `focus applied id=${focus.id} fan=${JSON.stringify(map.getFilter("bands-fan")).includes(String(focus.id))}`
      : "focus cleared",
  );
};
/** A camera in focus while the map is below the street level, where neither it nor its
 * field is drawn: its marker stands in (layers.ts), and the sheet's « Revenir à la
 * caméra » (shown by the body's `focus-far`, theme/punk/sheet.css) does what a tap on the marker
 * does, for the keyboard and screen readers. The button gone, its keyboard focus goes to
 * the sheet's headline rather than to the page. */
function markFar(): void {
  // A camera the filters hide has no marker (FilterPanel.refreshFocus): no way back either.
  const far = panel.focus !== null && panel.passes(panel.focus.props) && map.getZoom() < DETAIL_MIN;
  if (far === document.body.classList.contains("focus-far")) return;
  const back = document.activeElement?.closest(".sheet-back");
  document.body.classList.toggle("focus-far", far);
  if (!far && back) {
    const headline = sheet.querySelector<HTMLElement>("h2.headline");
    if (headline) {
      headline.tabIndex = -1;
      headline.focus();
    }
  }
}
map.on("zoom", markFar);
// The reach labels come from the band tiles in view: recomputed when the map settles.
// Everything else in focus mode is a style expression on the camera's id.
map.on("idle", () => {
  panel.refreshFocus();
  markFar(); // the filters may have hidden or shown the camera in focus
});
/** The part of the map the panels leave free (on a phone: above the open sheet). */
const freePadding = (): PaddingOptions => {
  // The header ticket's bottom too, and on a wide screen the machine or the list only
  // while open (they are hidden otherwise, the ticket alone at the top left). On a phone the
  // ticket slides away while a sheet is open (theme/punk/map.css): its box, still there,
  // covers nothing then (it took 130 px of the 160 left above a half sheet on a phone).
  const ticketShown = !(isPhone() && document.body.dataset.sheet !== undefined);
  const ticket = ticketShown ? byId("ticket").getBoundingClientRect().bottom : 0;
  const top = Math.max(byId("estimate").getBoundingClientRect().bottom, ticket) + 12;
  const side = panel.opened ? byId("filters") : cameraList?.opened ? byId("camlist") : null;
  // On a phone: the attribution (18a's inset, up to four lines with the IGN source)
  // rides above the open sheet, at the bottom left: nothing framed goes under it.
  const underAttribution = attribution.offsetHeight + 10;
  return isPhone()
    ? { top, bottom: sheetPanel.covered + underAttribution + 16, left: 16, right: 16 }
    : {
        top,
        bottom: 40,
        left: (side?.getBoundingClientRect().right ?? 0) + 20,
        right: sheet.getBoundingClientRect().width + 40,
      };
};
// The level's label goes where it is seen whole (focus.reachLabelPoints): in the part
// of the map the panels leave free, off the floating buttons and map controls over it (« Me
// localiser », the zoom, the attribution), its size that of its image (icons.ts putTag).
const LABEL_OBSTACLES = "#fabs > *, .maplibregl-ctrl, #estimate, #ticket, #filters-empty";
panel.labelRoom = (): LabelRoom => {
  const canvas = map.getCanvas();
  const origin = map.getContainer().getBoundingClientRect();
  const pad = { top: 0, bottom: 0, left: 0, right: 0, ...freePadding() };
  const obstacles = [...document.querySelectorAll<HTMLElement>(LABEL_OBSTACLES)]
    .map((el) => el.getBoundingClientRect())
    .filter((r) => r.width > 0 && r.height > 0)
    .map((r) => ({
      left: r.left - origin.left,
      right: r.right - origin.left,
      top: r.top - origin.top,
      bottom: r.bottom - origin.top,
    }));
  return {
    left: pad.left,
    top: pad.top,
    right: canvas.clientWidth - pad.right,
    bottom: canvas.clientHeight - pad.bottom,
    obstacles,
    size: (lv, r) => {
      const text = t("focus.punk.label", {
        level: t(`focus.level.${lv}`),
        m: new Intl.NumberFormat(locale).format(Math.ceil(r - 1e-9)),
      });
      const image = map.hasImage(TAG_PREFIX + text) ? map.getImage(TAG_PREFIX + text) : null;
      // Before its image exists (the first idle), about the typewriter's advance.
      return image
        ? [image.data.width / image.pixelRatio, image.data.height / image.pixelRatio]
        : [text.length * 8 + 28, 26];
    },
  };
};
// Show the focused camera's field for the chosen estimate in the part of the map the
// panels leave free (on a phone: above the sheet at half height).
const fitField = () => {
  if (!panel.focus) return;
  const est = panel.mode.est;
  // The drawn field, from its extent computed by the pipeline (tiles.field_extents).
  const extent = shown ? (shown as Record<string, unknown>)[`x${est}`] : undefined;
  const bounds = fieldBounds(map, panel.focus, est, extent as string | undefined);
  const pad = { top: 0, bottom: 0, left: 0, right: 0, ...freePadding() };
  const cam = map.cameraForBounds(bounds, { padding: pad, maxZoom: 19 });
  if (!cam?.center) return;
  locate.release();
  // Below the street level the detail tiles (and the camera) are gone.
  const zoom = Math.max(cam.zoom ?? DETAIL_MIN, DETAIL_MIN + 0.3);
  if (zoom === cam.zoom) {
    map.easeTo({ center: cam.center, zoom });
    return;
  }
  // A zoom raised to the street level: the field's middle in the middle of the free part,
  // by an offset at that zoom. cameraForBounds' centre holds the padding's offset at its own
  // zoom, and 1.5 levels higher it put the camera three times as far (under the estimate bar
  // from a half sheet, lot U).
  map.easeTo({
    center: bounds.getCenter(),
    zoom,
    offset: [(pad.left - pad.right) / 2, (pad.top - pad.bottom) / 2],
  });
};
/** What the camera sheet's next settling does to the map (BottomSheet's onSettle): "fit"
 * frames the camera's field (a link, the list, a new estimate), "reveal" at most moves the
 * camera into the free part (a tap, and every other settling: a step of the sheet, the
 * visible height changing under Safari's toolbars) — a second framing while the first ran
 * made the map leave and come back (DECISIONS 2026-10-18). */
let settle: "fit" | "reveal" = "reveal";
const sheetPanel = new BottomSheet(sheet, (state) => {
  const fit = settle === "fit";
  settle = "reveal";
  if (!fit) revealCamera();
  else if (state === "half" || !isPhone()) fitField();
});
/** A tapped camera (DECISIONS 2026-10-18): the map moves only when the camera's tap target
 * lies outside the part the panels leave free (under the sheet, the bar, a side panel), and
 * then just enough to bring it in, in REVEAL_MS (at most 400 ms, DECISIONS 2026-10-06; a
 * jump under reduced motion, MapLibre's own for an ease that is not `essential`); the zoom
 * never changes. It waits for the map at rest: what still runs at the tap (a wheel's zoom,
 * a double tap's, a fling's end) is the user's own gesture and ends where they wanted, the
 * move is computed from there, once. Never for a camera off the screen. */
const REVEAL_MS = 300;
let revealPending = false;
function revealCamera(): void {
  revealPending = true;
  requestAnimationFrame(revealNow);
}
function revealNow(): void {
  if (!revealPending || downs.size > 0 || map.isMoving()) return;
  // The visible height just changed (Safari's toolbars, a phone turned): the sheet is placed
  // for it, the map not yet (MapLibre resizes from a ResizeObserver, after this frame's
  // callbacks); from its old size the camera seemed under the new sheet (seen in the bench:
  // a 30 px move for nothing).
  const canvas = map.getCanvas();
  const box = map.getContainer();
  if (canvas.clientWidth !== box.clientWidth || canvas.clientHeight !== box.clientHeight) {
    map.once("resize", () => requestAnimationFrame(revealNow));
    return;
  }
  revealPending = false;
  if (!panel.focus || !sheetPanel.state) return;
  const pad = { top: 0, bottom: 0, left: 0, right: 0, ...freePadding() };
  const d = nudge(
    map.project(panel.focus.lngLat),
    canvas.clientWidth,
    canvas.clientHeight,
    pad,
    CAMERA_HIT_RADIUS,
  );
  if (!d) return;
  debugEvent(`camera kept in view: ${Math.round(d[0])},${Math.round(d[1])} px`);
  // panBy moves the map's content by minus its offset.
  map.panBy([-d[0], -d[1]], { duration: REVEAL_MS });
}
map.on("moveend", () => {
  if (revealPending) requestAnimationFrame(revealNow);
});
const closeSheet = (reason = "close") => {
  if (sheet.hidden) return;
  participation?.select(null);
  debugEvent(`close: ${reason}`);
  sheetPanel.close();
  setFocus(null);
  selectArea(null);
  writeParams({ cam: null, insee: null });
  shownHistory = null;
};
/** The open camera's history (history.ts, lot U): asked once per opening, kept while the
 * sheet is drawn again (a level, the mode), asked again at the next opening — so that a
 * pseudonym shown or hidden in the account's screen is so the next time the sheet opens. */
let shownHistory: { id: string; slot: HTMLElement } | null = null;
const historyOf = (id: string): HTMLElement => {
  if (shownHistory?.id !== id) shownHistory = { id, slot: historySlot(id) };
  return shownHistory.slot;
};
/** Focus a camera feature (from a tap or a ?cam= link) and open its sheet at half height. */
const openCamera = (f: MapGeoJSONFeature, how: string) => {
  const lngLat = (f.geometry as Point).coordinates as [number, number];
  const p = f.properties;
  const props = { o: String(p.o), k: String(p.k), fl: Number(p.fl ?? 0) } as Focus["props"];
  if (p.op !== undefined) props.op = Number(p.op);
  debugEvent(`select ${String(p.id)} (${how})`);
  setFocus({ id: Number(f.id), n: Number(p.n), lngLat, props });
  if (panel.opened) panel.setOpened(false);
  selectArea(null);
  shown = f.properties as CameraProps;
  shownHistory = null; // read again at each opening
  renderSheet(sheet, shown, sheetOptions());
  // A proposed move's field is drawn only while its camera is selected.
  participation?.select(String(p.id));
  // A tap leaves the map where it is unless the panels hide the camera (revealCamera); a
  // link or a list frames its field.
  settle = how === "tap" || how === "click" ? "reveal" : "fit";
  locate.release();
  sheetPanel.open("half");
  debugEvent(`sheet open ${String(f.properties.id)} (${sheetPanel.state})`);
};
/** A camera's sheet by id: the map's camera (its tile loaded), else an add no build has
 * applied yet (phase "Ajouter"). False when neither is found. */
const openById = async (id: string, how: string): Promise<boolean> => {
  const f = map
    .querySourceFeatures("detail", { sourceLayer: "cameras" })
    .find((c) => c.properties.id === id);
  if (f) {
    openCamera(f as MapGeoJSONFeature, how);
    return true;
  }
  const p = await participation?.pending(id);
  if (!p) return false;
  openPending(p, how);
  return true;
};
/** The sheet of a pending add: its pale pictogram framed, its proposal and field. */
const openPending = (p: Proposal, how: string) => {
  if (!participation) return;
  debugEvent(`select pending ${p.c} (${how})`);
  setFocus(null);
  selectArea(null);
  shown = null;
  if (panel.opened) panel.setOpened(false);
  renderPendingSheet(sheet, {
    onClose: () => closeSheet("close button"),
    onGrab: () => sheetPanel.step(),
    actions: participation.pendingActions(p),
    status: p.s,
  });
  participation.select(p.c);
  sheetPanel.open("half");
  locate.release();
  // In the middle of the part the panels leave free, by an offset: an easeTo's `padding`
  // stays on the map (MapLibre setPadding), and every later framing subtracted it again — on
  // a phone, more than the screen's height, so that a commune tapped next stayed under its
  // sheet (MapLibre gives up a fit that has no room).
  const free = { top: 0, bottom: 0, left: 0, right: 0, ...freePadding() };
  map.easeTo({
    center: p.at,
    zoom: Math.max(map.getZoom(), 18),
    offset: [(free.left - free.right) / 2, (free.top - free.bottom) / 2],
  });
};
// A tap selects the camera under it, or closes the sheet on empty map. Touch taps are
// recognised from pointer events on the map: on an iPhone, map taps often gave no
// "click" at all (?debug=1 journal: touchstart, then nothing), while pointer events
// still arrive. The map's "click" stays for the mouse; a click right after a recognised
// tap is the same gesture and is ignored.
const TAP_MAX_MOVE_PX = 12;
const TAP_MAX_MS = 500;
const TAP_CLICK_DEDUP_MS = 800;
const TAP_SELECT_DELAY_MS = 60;
let lastTapAt = -Infinity;
// Communes and départements answer a tap below the street level.
const AREA_LAYERS = ["communes", "communes-none", "deps", "deps-none"];
const selectAt = (point: { x: number; y: number }, how: string) => {
  // A tap on the map is a gesture: no position moves the map after it (locate.ts).
  locate.release();
  // Tap targets (20 px) overlap where cameras are dense: the one nearest the finger wins,
  // not the first one found.
  const dist = (f: MapGeoJSONFeature) => {
    const q = map.project((f.geometry as Point).coordinates as [number, number]);
    return Math.hypot(q.x - point.x, q.y - point.y);
  };
  const nearest = (fs: MapGeoJSONFeature[]) =>
    fs.reduce<MapGeoJSONFeature | undefined>(
      (a, b) => (a && dist(a) <= dist(b) ? a : b),
      undefined,
    );
  // The focused camera's marker below the street level: back to its field, still in
  // focus (a tap away from the camera leaves it).
  if (
    panel.focus &&
    map.queryRenderedFeatures([point.x, point.y], { layers: [FOCUS_MARKER_RING] }).length
  ) {
    debugEvent(`focus marker (${how})`);
    fitField();
    return;
  }
  const f = nearest(map.queryRenderedFeatures([point.x, point.y], { layers: ["camera-hit"] }));
  // A pending add's pale pictogram (phase "Ajouter"), when nearer than any camera: it may
  // stand a few metres from one (the duplicates list let it). Its target as large as a
  // camera's (PROPOSAL_HIT), once the proposals' layers are in.
  const ghostLayer = map.getLayer(PROPOSAL_HIT) ? PROPOSAL_HIT : "proposal-ghost";
  const ghost = map.getLayer(ghostLayer)
    ? nearest(
        map
          .queryRenderedFeatures([point.x, point.y], { layers: [ghostLayer] })
          .filter((g) => g.properties.a === 1),
      )
    : undefined;
  if (ghost && (!f || dist(ghost) < dist(f))) {
    void openById(String(ghost.properties.c), how);
    return;
  }
  if (f) {
    openCamera(f, how);
    return;
  }
  const area =
    map.getZoom() < CITY_FADE[1]
      ? map.queryRenderedFeatures([point.x, point.y], { layers: AREA_LAYERS })[0]
      : undefined;
  if (area) openArea(area.properties as AreaProps, how);
  else closeSheet(`empty ${how}`);
};
const canvasBox = map.getCanvasContainer();
const downs = new Map<number, { x: number; y: number; t: number }>();
let pinch = false;
canvasBox.addEventListener("pointerdown", (e) => {
  if (e.pointerType === "mouse") return;
  downs.set(e.pointerId, { x: e.clientX, y: e.clientY, t: e.timeStamp });
  if (downs.size > 1) pinch = true;
  debugEvent(`pointerdown ${Math.round(e.clientX)},${Math.round(e.clientY)} n=${downs.size}`);
});
canvasBox.addEventListener("pointerup", (e) => {
  const d = downs.get(e.pointerId);
  if (!d) return;
  downs.delete(e.pointerId);
  if (moving()) {
    if (!downs.size) pinch = false;
    return; // the map slides under the reticle: no selection
  }
  const dx = e.clientX - d.x;
  const dy = e.clientY - d.y;
  const dt = e.timeStamp - d.t;
  debugEvent(`pointerup dx=${Math.round(dx)} dy=${Math.round(dy)} ${Math.round(dt)} ms`);
  let reason = "";
  if (pinch) reason = "two fingers";
  else if (Math.hypot(dx, dy) > TAP_MAX_MOVE_PX)
    reason = `moved ${Math.round(Math.hypot(dx, dy))} px`;
  else if (dt > TAP_MAX_MS) reason = `held ${Math.round(dt)} ms`;
  if (!downs.size) pinch = false;
  if (reason) {
    debugEvent(`tap rejected (${reason})`);
    return;
  }
  debugEvent("tap recognised");
  lastTapAt = performance.now();
  // Where the finger came down: it drifts a few pixels before it lifts.
  const r = map.getCanvas().getBoundingClientRect();
  const point = { x: d.x - r.left, y: d.y - r.top };
  // After the mouse events the browser synthesises for the tap: their mousedown stops map
  // animations, which would cut the reveal of a camera hidden by the panels short.
  setTimeout(() => selectAt(point, "tap"), TAP_SELECT_DELAY_MS);
});
canvasBox.addEventListener("pointercancel", (e) => {
  downs.delete(e.pointerId);
  if (!downs.size) pinch = false;
  debugEvent("pointercancel");
});
/** The focused camera's marker below the street level, kept clear of the panels: a
 * gesture that ends with it on the screen but under the estimate bar, the sheet or a side
 * panel (outside freePadding's part of the map) moves the map just enough to bring the
 * whole marker back into that part. A gesture's moveend carries its DOM event (MapLibre:
 * pinch, drag and its inertia, wheel, zoom buttons, keyboard); our own moves never do, so
 * this move never calls itself again. It starts at the next frame, once every listener has
 * seen the gesture end (and MapLibre's handlers are done with it). Nothing while a finger
 * is still down or the map moves again, nor for a marker off the screen (the user moved
 * away from it), nor when the free part is smaller than the marker. Under reduced motion
 * MapLibre makes the move a jump (an ease that is not `essential` gets a duration of 0).
 * A gesture leaves the nudge pending until the map is still: a pinch released with a slight
 * twist ends with MapLibre's own ease back to north, whose moveend carries no DOM event
 * (review, 2026-10-06: the marker stayed under the bar). */
let nudgePending = false;
function keepMarkerFree(e: { originalEvent?: unknown }): void {
  if (e.originalEvent) nudgePending = true;
  if (nudgePending) requestAnimationFrame(nudgeMarker);
}
function nudgeMarker(): void {
  if (!nudgePending || downs.size > 0 || moving() || map.isMoving()) return;
  nudgePending = false;
  if (!panel.focus || !document.body.classList.contains("focus-far")) return;
  const canvas = map.getCanvas();
  const pad = { top: 0, bottom: 0, left: 0, right: 0, ...freePadding() };
  const d = nudge(
    map.project(panel.focus.lngLat),
    canvas.clientWidth,
    canvas.clientHeight,
    pad,
    FOCUS_MARKER_RADIUS,
  );
  if (!d) return;
  debugEvent(`focus marker kept in view: ${Math.round(d[0])},${Math.round(d[1])} px`);
  // panBy moves the map's content by minus its offset.
  map.panBy([-d[0], -d[1]]);
}
map.on("moveend", keepMarkerFree);
map.on("click", (e: MapLayerMouseEvent) => {
  if (moving()) return;
  if (performance.now() - lastTapAt < TAP_CLICK_DEDUP_MS) {
    debugEvent("click ignored (same tap)");
    return;
  }
  debugEvent(`click ${Math.round(e.point.x)},${Math.round(e.point.y)}`);
  selectAt(e.point, "click");
});
map.on("movestart", () => debugEvent("movestart"));
// ?cam=<id>: centre is in the hash; open that camera's sheet once its tile is there.
const wanted = readParam("cam");
if (wanted) {
  const tryOpen = () => {
    const f = map
      .querySourceFeatures("detail", { sourceLayer: "cameras" })
      .find((c) => c.properties.id === wanted);
    if (!f) return false;
    openCamera(f as MapGeoJSONFeature, "link");
    return true;
  };
  // Unknown id, or a link below the street zoom: give up after a few settled views. An id
  // the tiles do not have may be an add no build has applied yet (`c` + 12 hex digits),
  // asked at the first settled view: a map at rest gives no further "idle" (the link
  // waited for 8 and never opened).
  let tries = 0;
  let askedPending = false;
  const onIdle = async () => {
    if (tryOpen()) {
      map.off("idle", onIdle);
      return;
    }
    if (/^c[0-9a-f]{12}$/.test(wanted) && !askedPending) {
      askedPending = true;
      if (await openById(wanted, "link")) {
        map.off("idle", onIdle);
        return;
      }
    }
    if (++tries >= 8) map.off("idle", onIdle);
  };
  map.on("idle", onIdle);
}
let shown: CameraProps | null = null;

// --- communes and départements: a tap opens their sheet in the same panel --------------
let shownArea: AreaProps | null = null;
/** Outline the area whose sheet is open (null: none). */
function selectArea(p: AreaProps | null) {
  shownArea = p;
  const code = p ? String(p.c) : "";
  for (const id of AREA_SELECTED_LAYERS) {
    if (map.getLayer(id)) map.setFilter(id, ["==", ["get", "c"], code]);
  }
}
const areaOptions = () => ({
  onClose: () => closeSheet("close button"),
  onGrab: () => sheetPanel.step(),
  shareUrl: () => {
    if (!shownArea) return "";
    const param = estimateParam(meta, panel.mode.est);
    const est = param ? `&est=${param}` : "";
    return `${window.location.origin}/?insee=${encodeURIComponent(String(shownArea.c))}${est}`;
  },
  publicOnly: panel.mode.publicOnly,
});
// Code -> [name, département, [west, south, east, north]] (tiles/areas.json), fetched the
// first time an area is opened: its tiles only hold the pieces in view.
type AreaIndex = Record<string, [string, string, [number, number, number, number]]>;
let areaIndexLoad: Promise<AreaIndex> | null = null;
const areaIndex = () => {
  areaIndexLoad ??= fetch(`${base}/tiles/areas.json`).then((r) => r.json());
  return areaIndexLoad;
};
/** Frame an area in the part of the map the panels leave free (`padding`, by default the
 * open sheet's), at a zoom where its level is drawn. */
async function fitArea(code: string, animate: boolean, padding?: PaddingOptions | number) {
  const entry = (await areaIndex())[code];
  if (!entry) return;
  const dep = entry[1] === code;
  locate.release();
  map.fitBounds(entry[2], {
    padding: padding ?? freePadding(),
    // Communes are drawn up to CITY_FADE (11.5 leaves them fully opaque); départements
    // below COMMUNES_MIN.
    maxZoom: dep ? COMMUNES_MIN - 0.5 : CITY_FADE[0] - 0.5,
    minZoom: dep ? 0 : COMMUNES_MIN,
    animate,
  });
}
function openArea(p: AreaProps, how: string) {
  debugEvent(`select area ${String(p.c)} (${how})`);
  participation?.select(null);
  setFocus(null);
  shown = null;
  if (panel.opened) panel.setOpened(false);
  selectArea(p);
  renderAreaSheet(sheet, p, areaOptions());
  sheetPanel.open("half");
  debugEvent(`sheet open ${String(p.c)} (${sheetPanel.state})`);
  // Like a camera's field: the area in the map the sheet leaves free (a link frames it
  // itself, without animation).
  if (how !== "link") void fitArea(String(p.c), true);
}
/** A sheet of the account (account/index.ts, profile/leaderboard.ts), rendered in #sheet,
 * shown in place of the camera's or the area's: their focus and outline let go, the
 * machine closed, the link's parameters gone. */
function showAccount(state: "peek" | "half" | "full" = "half"): void {
  debugEvent("account sheet");
  participation?.select(null);
  // Only what is held (a return from OpenStreetMap opens it before the map is in, whose
  // layers cannot be filtered yet).
  if (panel.focus) setFocus(null);
  if (shownArea) selectArea(null);
  shown = null;
  if (panel.opened) panel.setOpened(false);
  writeParams({ cam: null, insee: null });
  sheetPanel.open(state);
}
panel.onWho = () => {
  if (shownArea && sheetPanel.state) renderAreaSheet(sheet, shownArea, areaOptions());
};
for (const id of [...AREA_LAYERS, FOCUS_MARKER_RING]) {
  map.on("mouseenter", id, () => {
    map.getCanvas().style.cursor = "pointer";
  });
  map.on("mouseleave", id, () => {
    map.getCanvas().style.cursor = "";
  });
}
// ?insee=<code>: frame the area from the index (its tiles may not be loaded, e.g. at the
// default street zoom), low enough for it to be drawn, then open its sheet.
const wantedArea = readParam("insee");
if (wantedArea) {
  void areaIndex().then(async (index) => {
    const entry = index[wantedArea];
    if (!entry) return;
    // First at the right zoom for its tiles to load, then in the part of the map the sheet
    // leaves free once it is open.
    await fitArea(wantedArea, false, 40);
    const layer = entry[1] === wantedArea ? "departements" : "communes";
    let tries = 0;
    const onIdle = () => {
      const f = map
        .querySourceFeatures("admin", { sourceLayer: layer })
        .find((x) => x.properties.c === wantedArea);
      if (f) {
        openArea(f.properties as AreaProps, "link");
        void fitArea(wantedArea, false);
      }
      if (f || ++tries >= 8) map.off("idle", onIdle);
    };
    map.on("idle", onIdle);
  });
}
// Back from OpenStreetMap (?osm=, OSM lot 1): its sheet at once, « Chargement de votre
// compte » until the session (and a first sign-in's signup) is known, the map loading or not
// (account/index.ts land; the parameter is already gone from the address). Here, once every
// part showAccount touches exists.
if (account) void account.land();
// The sheet shows the chosen estimate and the camera's reaches read from its bands.
const sheetOptions = () => {
  // The sheet reads the participation's parts in its own order (chips.ts).
  const slots = actionSlots();
  const target =
    participation && shown && panel.focus
      ? {
          id: String(shown.id),
          fid: panel.focus.id,
          lngLat: panel.focus.lngLat,
          mg: String(shown.mg ?? "unknown"),
          k: String(shown.k ?? "unknown"),
          kc: Number(shown.kc ?? 0),
          o: String(shown.o ?? "unk"),
          d: Number(shown.d ?? -1),
          hc: Number(shown.hc ?? 0),
          t: shown.t === undefined ? undefined : String(shown.t),
          ok: shown.ok === undefined ? undefined : String(shown.ok),
          opName: shown.op === undefined ? undefined : meta.operators[Number(shown.op)],
          label: headLine(shown),
          check: Number(shown.pv) === 1 || Number(shown.ib) === 1,
        }
      : undefined;
  return {
    cnil: CNIL_SIGNAL,
    onClose: () => closeSheet("close button"),
    shareUrl: () => {
      if (!shown || !panel.focus) return "";
      const [lng, lat] = panel.focus.lngLat;
      const param = estimateParam(meta, panel.mode.est);
      const est = param ? `&est=${param}` : "";
      const cam = encodeURIComponent(String(shown.id));
      return `${window.location.origin}/?cam=${cam}${est}#18.00/${lat.toFixed(6)}/${lng.toFixed(6)}`;
    },
    onGrab: () => sheetPanel.step(),
    onBack: () => {
      debugEvent("back to the camera (sheet)");
      fitField();
    },
    estimates: meta.estimates,
    shown: meta.shown_estimates,
    est: panel.mode.est,
    reach: panel.focus ? cameraReaches(map, panel.focus.id, meta.estimates.length) : [],
    noDirection: shown ? withoutDirection(meta, shown) : false,
    ptzFov: meta.ptz_hfov_p50,
    heights: meta.participation?.questions?.height_m ?? {},
    operatorName: shown?.op === undefined ? undefined : meta.operators[Number(shown.op)],
    level: panel.level,
    onLevel: (lv: 1 | 2 | 3) => panel.setLevel(lv),
    actions:
      participation && target && !participation.hidden
        ? participation.actions(target, slots)
        : undefined,
    slots,
    // Signed out, or contributions closed: « Corriger sur OpenStreetMap » is the way.
    visitor: isVisitor() || !site.contributions,
    // The facts the sheet marks « ? » (chips.ts): « Modifier »'s assumed lines.
    answerable: target ? (participation?.answerable(target) ?? []) : [],
    history: shown ? historyOf(String(shown.id)) : undefined,
  };
};
// Signed in or out (account/session.ts; at start, the answer may come after a ?cam= link
// opened the sheet): the open camera sheet's participation follows, drawn again in place.
let sessionSeen: Session["state"] | null = null;
onSession((s) => {
  const changed = sessionSeen !== null && s.state !== sessionSeen;
  sessionSeen = s.state;
  if (changed && shown && sheetPanel.state && !moving()) renderSheet(sheet, shown, sheetOptions());
});
// The sheet speaks of the chosen estimate: redraw it, keep its position, refit.
panel.onEstimate = () => {
  if (shownArea && sheetPanel.state) {
    renderAreaSheet(sheet, shownArea, areaOptions());
    return;
  }
  if (!shown || !sheetPanel.state) return;
  renderSheet(sheet, shown, sheetOptions());
  // place() refits on the new estimate's field (half height on a phone, always on a wide
  // screen).
  settle = "fit";
  sheetPanel.place(sheetPanel.state);
};
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  // Escape from inside the machine closes it, its link takes the focus back.
  if (panel.opened && document.activeElement?.closest("#filters, #ticket")) {
    panel.setOpened(false);
    byId("fab-filters").focus();
    return;
  }
  if (moving()) participation?.escape();
  else closeSheet("Escape");
});
debugInit(() => {
  const r = sheet.getBoundingClientRect();
  const mid = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(r.height / 2, 40));
  return {
    camera: shown ? `${shown.id} ${shown.k} d=${shown.d}` : "none",
    area: shownArea
      ? `${shownArea.c} ${shownArea.nm}${isDepartement(shownArea) ? " (dép.)" : ""}`
      : "none",
    sheet: `${sheetPanel.state ?? "closed"} h=${r.height.toFixed(0)} top=${r.top.toFixed(0)} bottom=${r.bottom.toFixed(0)}`,
    "sheet on top": sheet.hidden ? "-" : String(Boolean(mid?.closest("#sheet"))),
    "send queue": participation?.debugState() ?? "-",
    position: `${tracker.describe()}, ${locate.state}`,
    site: `contributions ${site.contributions ? "open" : "closed"}, publish ${site.publish}`,
  };
});
// The page's gestures and the phone keyboard (the author's points 4 and 7 of 2026-10-11).
installGestures();
installKeyboard();
if (DEBUG) {
  document.body.classList.add("debug");
  document.addEventListener(
    "touchstart",
    (e) => {
      const t = e.touches[0];
      debugEvent(`touchstart ${Math.round(t.clientX)},${Math.round(t.clientY)}`);
    },
    { capture: true, passive: true },
  );
  // Tiles loaded between two settled views, per source.
  const loaded: Record<string, number> = {};
  map.on("sourcedata", (e) => {
    if (e.tile && (e.sourceId === "detail" || e.sourceId === "streets")) {
      loaded[e.sourceId] = (loaded[e.sourceId] ?? 0) + 1;
    }
  });
  map.on("idle", () => {
    const parts = Object.entries(loaded).map(([k, v]) => `${k}+${v}`);
    if (parts.length) debugEvent(`tiles loaded ${parts.join(" ")} z=${map.getZoom().toFixed(1)}`);
    for (const k of Object.keys(loaded)) delete loaded[k];
  });
}

declare global {
  interface Window {
    __map: MlMap;
    __palette: typeof palette;
    __tileRetries?: number;
  }
}
window.__map = map;
if (prefetchWanted()) prefetch.install(map);
// The register over the map, its doors and its addresses (registre/hote.ts).
brancherRegistre(map);
window.__palette = palette;
