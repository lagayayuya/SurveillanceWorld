// /revue, the reviewers' and administrators' tool (plan-revue; lot 1 « Modérer », boards P1
// and P2; lot 2 « Administrer », boards P3, P4, P5: a drawing of its own on the punk tokens,
// not the mockup's). It opens by its own entry (POST /api/review/session: auth.ts); any
// other session, or none, reads « Connexion à la revue » and its form. Its tabs follow the
// role GET /api/review/me gives: a reviewer has « File »; an administrator also « Comptes »,
// « Retraits », « Réglages », « Statistiques » (lot 4) and « Journal ». Each view has its
// address and one h1, focused when it opens, the browser's back button between them:
// « File » (queue.ts: what waits, in which order; ?file=conflicts&q=…), a camera
// (camera.ts: ?camera=<id>, the queue's filter and search kept for « next »), and the
// administrator's (?vue=comptes, ?compte=<id>, ?vue=retraits, ?vue=reglages,
// ?vue=statistiques, ?vue=journal: accounts.ts, hidden.ts, settings.ts, stats.ts,
// journal.ts). The map links to /revue?status=conflict (and &kind=add): « Conflits ».
// It follows the mode as the map does (light or dark), on the punk theme's tokens.
import { addProtocol, setWorkerUrl } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import "maplibre-gl/dist/maplibre-gl.css";
import { Protocol } from "pmtiles";
import { loadSession, logout, pseudonym } from "../account/session";
import { t } from "../i18n";
import { ApiError } from "../participate/api";
import { followMode, initTheme, themeFonts } from "../theme";
import { accountsView, accountView } from "./accounts";
import { ADMIN_VIEWS, type AdminNav, type AdminView, type Tab } from "./admin";
import { fetchWho, signIn, type Who } from "./auth";
import { CameraView } from "./camera";
import { hiddenView } from "./hidden";
import { journalView } from "./journal";
import { ReviewMap } from "./map";
import { fetchQueue, type QueueNav, queueView } from "./queue";
import { el, FILTERS, type Filter } from "./rows";
import { settingsView } from "./settings";
import { statsView } from "./stats";
import "./review.css";

setWorkerUrl(workerUrl);
addProtocol("pmtiles", new Protocol().tile);
// The theme (theme.ts): its tokens loaded before anything is drawn.
await initTheme();
themeFonts();
// Nothing unsent lives here: after a change of the phone's mode the page loads again, its
// map drawn in the new colours (the CSS follows by itself).
followMode(() => window.location.reload());
if ("scrollRestoration" in history) history.scrollRestoration = "manual";

const app = document.getElementById("review-app") as HTMLElement;
const toastHost = el("div", "", "review-toast-host");
toastHost.id = "review-toast-host";
app.after(toastHost);
const map = new ReviewMap();
/** Who is in (GET /api/review/me), once the page knows. */
let who: Who | null = null;

// --- the address ----------------------------------------------------------------------

/** The view the address asks: the queue's filter and search (the map's old links,
 * ?status=conflict and &kind=add, open « Conflits »), a camera, an account, or one of the
 * administrator's views. */
function readQuery(): {
  filter: Filter;
  q: string;
  camera: string | null;
  account: string | null;
  view: AdminView | null;
} {
  const p = new URLSearchParams(window.location.search);
  const asked = p.get("file") as Filter | null;
  const filter: Filter =
    asked && (FILTERS as readonly string[]).includes(asked)
      ? asked
      : p.get("status") === "conflict"
        ? "conflicts"
        : "todo";
  const view = p.get("vue") as AdminView | null;
  return {
    filter,
    q: (p.get("q") ?? "").slice(0, 64),
    camera: p.get("camera"),
    account: p.get("compte"),
    view: view && (ADMIN_VIEWS as readonly string[]).includes(view) ? view : null,
  };
}

/** The interface and mode asked in the address, kept from view to view. */
function kept(): URLSearchParams {
  const now = new URLSearchParams(window.location.search);
  const out = new URLSearchParams();
  for (const k of ["ui", "mode"]) {
    const v = now.get(k);
    if (v) out.set(k, v);
  }
  return out;
}
const addressOf = (out: URLSearchParams) => {
  const query = out.toString();
  return `${window.location.pathname}${query ? `?${query}` : ""}`;
};

/** The address of the queue or a camera: the queue's filter and search, `params` (a
 * camera), and the interface and mode asked in the address, kept. */
function href(params: Record<string, string>): string {
  const out = new URLSearchParams();
  if (nav.filter !== "todo") out.set("file", nav.filter);
  if (nav.q) out.set("q", nav.q);
  for (const [k, v] of kept()) out.set(k, v);
  for (const [k, v] of Object.entries(params)) out.set(k, v);
  return addressOf(out);
}

/** The address of an administrator's view (`params`: vue, compte, its filters; an empty
 * value left out). */
function viewHref(params: Record<string, string>): string {
  const out = kept();
  for (const [k, v] of Object.entries(params)) if (v) out.set(k, v);
  return addressOf(out);
}

type State = { view: "queue" | "camera" | "admin"; fromQueue?: boolean };

const start = readQuery();
const nav: QueueNav = {
  filter: start.filter,
  q: start.q,
  order: null,
  lastCamera: null,
  scrollY: 0,
  href,
  openCamera(camera, how) {
    nav.lastCamera = camera;
    const state: State = { view: "camera", fromQueue: how === "push" || fromQueue() };
    const url = href({ camera });
    if (how === "push") history.pushState(state, "", url);
    else history.replaceState(state, "", url);
    void route();
  },
  setQuery(filter, q) {
    nav.filter = filter;
    nav.q = q;
    history.replaceState({ view: "queue" } satisfies State, "", href({}));
  },
  fail,
};
const fromQueue = () => Boolean((history.state as State | null)?.fromQueue);
// The map's old addresses take the new form (the filter kept).
if (!start.view && !start.account)
  history.replaceState(
    { view: start.camera ? "camera" : "queue" } satisfies State,
    "",
    href(start.camera ? { camera: start.camera } : {}),
  );

function showQueue(how: "push" | "replace", note: string | null = null): void {
  if (how === "push") history.pushState({ view: "queue" } satisfies State, "", href({}));
  else history.replaceState({ view: "queue" } satisfies State, "", href({}));
  void route(note);
}

/** A link that changes the view in place (a plain click; a new tab or window keeps the
 * browser's own way). */
function inPlace(a: HTMLAnchorElement, go: () => void): HTMLAnchorElement {
  a.addEventListener("click", (e) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    go();
  });
  return a;
}

/** What the administrator's views share: their head, their addresses, the way between. */
const admin: AdminNav = {
  get who() {
    return who as Who;
  },
  head: (current) => head(current),
  href: viewHref,
  go(params, how, note = null) {
    const url = viewHref(params);
    if (how === "push") history.pushState({ view: "admin" } satisfies State, "", url);
    else history.replaceState({ view: "admin" } satisfies State, "", url);
    void route(note);
  },
  inPlace,
  fail,
};

const camera = new CameraView(app, map, {
  href,
  back() {
    if (fromQueue()) history.back();
    else showQueue("push");
  },
  async next(current) {
    try {
      const order = nav.order ?? (await fetchQueue(nav.filter, nav.q)).items.map((i) => i.camera);
      const fresh = await fetchQueue(nav.filter, nav.q);
      const present = new Set(fresh.items.map((i) => i.camera));
      const at = order.indexOf(current);
      let next = order.slice(at + 1).find((c) => c !== current && present.has(c));
      // What was skipped above it, but under « Tout », where nothing leaves the list.
      if (!next && nav.filter !== "all")
        next = fresh.items.find((i) => i.camera !== current)?.camera;
      nav.lastCamera = current;
      if (next) {
        nav.lastCamera = next;
        nav.openCamera(next, "replace");
        return;
      }
      nav.order = fresh.items.map((i) => i.camera);
      // « File vide » only for the whole queue: a search or a filter says nothing of the rest.
      const rest =
        fresh.items.some((i) => i.camera !== current) || nav.q !== "" || nav.filter !== "todo";
      showQueue("replace", t(rest ? "review.queue.end" : "review.queue.empty"));
    } catch (e) {
      fail(e);
    }
  },
  openCamera: (c, how) => nav.openCamera(c, how),
  admin: () => who?.role === "admin",
  hiddenHref: () => viewHref({ vue: "retraits" }),
  fail,
});

// --- the views --------------------------------------------------------------------------

const TABS: { tab: Tab; key: string; params: Record<string, string> }[] = [
  { tab: "queue", key: "review.tab.queue", params: {} },
  { tab: "comptes", key: "review.tab.accounts", params: { vue: "comptes" } },
  { tab: "retraits", key: "review.tab.hidden", params: { vue: "retraits" } },
  { tab: "reglages", key: "review.tab.settings", params: { vue: "reglages" } },
  { tab: "statistiques", key: "review.tab.stats", params: { vue: "statistiques" } },
  { tab: "journal", key: "review.tab.journal", params: { vue: "journal" } },
];

/** The head: « Revue », its tabs (a reviewer: « File »; an administrator: the six), who
 * is signed in and « Se déconnecter ». On a phone the tabs take a row of their own, which
 * scrolls sideways when it must. */
function head(current: Tab): HTMLElement {
  const top = el("header", "", "review-top");
  const brand = el("p", t("review.brand"), "review-brand");
  const tabs = el("nav", "", "review-tabs");
  tabs.setAttribute("aria-label", t("review.nav"));
  const shown = who?.role === "admin" ? TABS : TABS.slice(0, 1);
  tabs.classList.toggle("many", shown.length > 1);
  for (const { tab, key, params } of shown) {
    const a = el("a", t(key), "review-tab");
    a.dataset.tab = tab;
    if (tab === "queue") {
      a.href = href({});
      inPlace(a, () => showQueue("push"));
    } else {
      a.href = viewHref(params);
      inPlace(a, () => admin.go(params, "push"));
    }
    if (tab === current) a.setAttribute("aria-current", "page");
    tabs.append(a);
  }
  const whoBox = el("div", "", "review-who");
  if (who) whoBox.append(el("span", who.pseudonym, "review-pseudonym"));
  const out = el("button", t("review.logout"), "review-button small");
  out.type = "button";
  out.addEventListener("click", async () => {
    await logout();
    who = null;
    void signInView();
  });
  whoBox.append(out);
  top.append(brand, tabs, whoBox);
  // The current tab in sight when the row scrolls (a phone).
  requestAnimationFrame(() => {
    const on = tabs.querySelector<HTMLElement>('[aria-current="page"]');
    if (on && tabs.scrollWidth > tabs.clientWidth)
      tabs.scrollLeft = on.offsetLeft - (tabs.clientWidth - on.offsetWidth) / 2;
  });
  return top;
}

async function route(note: string | null = null): Promise<void> {
  const q = readQuery();
  nav.filter = q.filter;
  nav.q = q.q;
  if (q.camera) {
    nav.lastCamera = q.camera;
    await camera.show(q.camera);
    return;
  }
  if (q.account || q.view) {
    if (who?.role !== "admin") {
      adminOnly();
      return;
    }
    if (q.account) await accountView(app, admin, q.account, note);
    else if (q.view === "comptes") await accountsView(app, admin, note);
    else if (q.view === "retraits") await hiddenView(app, admin, note);
    else if (q.view === "reglages") await settingsView(app, admin, note);
    else if (q.view === "statistiques") await statsView(app, admin, note);
    else await journalView(app, admin, note);
    return;
  }
  await queueView(app, head("queue"), nav, note);
}
window.addEventListener("popstate", () => {
  if (who) void route();
});

// --- not for this session -----------------------------------------------------------------

/** A page of its own under the head « Revue » alone (nobody is in: no tabs). */
function bare(id: string, title: string, body: Node[]): void {
  const page = el("main", "", "review-main review-forbidden");
  page.id = id;
  const h1 = el("h1", title);
  h1.tabIndex = -1;
  page.append(h1, ...body);
  const top = el("header", "", "review-top");
  top.append(el("p", t("review.brand"), "review-brand"));
  app.replaceChildren(top, page);
  document.documentElement.style.removeProperty("--foot-h");
  h1.focus({ preventScroll: true });
}

/** « Connexion à la revue »: the privileged entry's form (the page loads again once in,
 * at the same address); a contributor signed in on the map is named; a session that ended
 * meanwhile (its hours, a restart of the API, an administrator's « Couper l'accès ») is
 * said. */
async function signInView(ended = false): Promise<void> {
  const s = await loadSession();
  const lines: Node[] = [];
  if (ended) lines.push(el("p", t("review.signin.expired"), "review-note"));
  lines.push(el("p", t("review.signin.lead")));
  if (s.state === "signed" && (s.me.role ?? "contributor") === "contributor")
    lines.push(el("p", t("review.signin.signed", { name: pseudonym(s.me) }), "review-muted"));
  const back = el("a", t("review.signin.map"));
  back.href = "/";
  bare("review-signin", t("review.signin.title"), [...lines, loginForm(), back]);
}

/** « Réservé aux administrateurs. », for a reviewer at an administrator's address. */
function adminOnly(): void {
  const page = el("main", "", "review-main review-forbidden");
  page.id = "review-admin-only";
  const h1 = el("h1", t("review.admin_only"));
  h1.tabIndex = -1;
  page.append(h1, el("p", t("review.admin_only.lead")));
  app.replaceChildren(head("queue"), page);
  document.documentElement.style.removeProperty("--foot-h");
  h1.focus({ preventScroll: true });
}

/** The privileged entry's form: identifiant, mot de passe, « Entrer », its error. */
function loginForm(): HTMLFormElement {
  const form = el("form", "", "review-login");
  const field = (label: string, input: HTMLInputElement) => {
    const l = el("label", "", "review-field");
    l.append(el("span", label), input);
    return l;
  };
  const user = el("input");
  user.id = "review-pseudonym";
  user.autocomplete = "username";
  user.autocapitalize = "none";
  user.spellcheck = false;
  user.required = true;
  const pass = el("input");
  pass.id = "review-password";
  pass.type = "password";
  pass.autocomplete = "current-password";
  pass.required = true;
  const error = el("p", "", "review-login-error");
  error.setAttribute("role", "alert");
  error.hidden = true;
  const submit = el("button", t("account.form.submit"), "review-button primary");
  submit.type = "submit";
  form.append(
    field(t("account.form.pseudonym"), user),
    field(t("account.form.password"), pass),
    error,
    submit,
  );
  let busy = false;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (busy) return;
    busy = true;
    submit.setAttribute("aria-disabled", "true");
    form.setAttribute("aria-busy", "true");
    const result = await signIn(user.value.trim(), pass.value);
    busy = false;
    submit.removeAttribute("aria-disabled");
    form.removeAttribute("aria-busy");
    if (result === "ok") {
      window.location.reload();
      return;
    }
    error.hidden = false;
    error.textContent = t(
      result === "credentials"
        ? "account.form.error"
        : result === "offline"
          ? "account.form.offline"
          : "account.form.failed",
    );
    if (result === "credentials") {
      pass.value = "";
      pass.focus();
    }
  });
  return form;
}

/** A call refused: no privileged session (401) → the sign-in; an administrator's view for
 * a reviewer (403 admin) → « Réservé aux administrateurs »; an unknown camera → the queue
 * says so; anything else: the API is unreachable, said instead of a blank page (a dev
 * server without the API, the API down). */
function fail(e: unknown): void {
  if (e instanceof ApiError && e.status === 401) {
    const ended = who !== null;
    who = null;
    void signInView(ended);
    return;
  }
  if (e instanceof ApiError && e.status === 403 && e.code === "admin") {
    adminOnly();
    return;
  }
  if (e instanceof ApiError && e.code === "unknown_camera") {
    showQueue("replace", t("review.error.unknown_camera"));
    return;
  }
  const status = e instanceof ApiError ? String(e.status) : String(e);
  bare("review-down", t("review.api_down.title"), [el("p", t("review.api_down", { status }))]);
}

// --- start ---------------------------------------------------------------------------------

async function load(): Promise<void> {
  try {
    who = await fetchWho();
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) void signInView();
    else fail(e);
    return;
  }
  await route();
}
// The page title comes from the catalogue at build time (revue.html, vite.config.ts).
void load();
