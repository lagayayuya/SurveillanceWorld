// Sign in with OpenStreetMap (OSM lot 1, scope `openid` only; its contract of 2026-10-10):
// the routes the punk account's sheets call. The sign-in itself is a navigation to the API
// (GET /api/osm/login or /api/osm/link), which sends the person to openstreetmap.org and
// back to `then` with `?osm=<outcome>`; the page reads that outcome once and removes it from
// the address. Nothing about the OSM account is kept on the device. The synchronisation
// (the owner's decision of 16/10, replacing OSM lot 2's « À
// publier »): « Publier aussi sur OpenStreetMap en mon nom », the person's choice in
// « Compte »; choosing it is a second passage through OSM (scope `write_api`, on the write
// server), the outcome coming back as `?osm=write_*`; then the API's job sends each of her
// accepted on-site contributions in her name, no gesture more (GET/POST /api/osm/sync).
import { DEBUG } from "../debug";
import { t } from "../i18n";
import { ApiError, call } from "../participate/api";
import { writeParams } from "../url";
import { parseReturn, type Return, type Why } from "./back";

export type { Outcome, Return, Why } from "./back";

/** GET /api/osm/status as the page reads it: whether sign-in with OpenStreetMap is offered.
 * (Its `write*` fields are not read: the synchronisation's setting reads GET /api/osm/sync.) */
export type OsmStatus = { login: boolean };
const OFF: OsmStatus = { login: false };

let status: Promise<OsmStatus> | null = null;
let testServer = false;

/** GET /api/osm/status, asked once. Any failure (an older API, offline, 503) says no:
 * « Compte » then shows the stamp as before. */
export function osmStatus(): Promise<OsmStatus> {
  status ??= call<{ login?: unknown; server?: unknown } | null>("GET", "/api/osm/status").then(
    (s) => {
      testServer = s?.server === "dev";
      return { login: s?.login === true };
    },
    () => OFF,
  );
  return status;
}

/** Sign-in with OpenStreetMap enabled (GET /api/osm/status's `login`). */
export const osmLogin = (): Promise<boolean> => osmStatus().then((s) => s.login);

/** Sign-in goes through OSM's test server (OSM_LOGIN_SERVER dev): the key says so, so that
 * it is not taken for a real OSM account. Known once osmLogin() has answered. */
export const osmTestServer = (): boolean => testServer;

/** Where the person comes back after OpenStreetMap: this page as it is (path, query,
 * the map's position in the hash). */
export const here = (): string =>
  `${window.location.pathname}${window.location.search}${window.location.hash}`;

/** Where the OpenStreetMap key brings the person back, when it is not this page as it is:
 * set by a camera sheet's greyed button (the sheet comes back after the sign-in), cleared by
 * the account square. */
let comeBack: string | null = null;
export function comeBackTo(address: string | null): void {
  comeBack = address;
}

/** « Se connecter avec OpenStreetMap »: the API's start of the flow, coming back to `then`
 * (by default where a camera sheet asked for it, else this page). */
export const loginHref = (then = comeBack ?? here()): string =>
  `/api/osm/login?then=${encodeURIComponent(then)}`;
/** « Relier à OpenStreetMap » (signed in): POST /api/osm/link with the password asked again
 * (a stolen session alone cannot link its thief's OSM user); the answer is OSM's page to
 * open, the flow cookie set. 401 a wrong password, 409 an account without one. */
export const startLink = (password: string, then = here()) =>
  call<{ url: string }>("POST", "/api/osm/link", { password, then });

/** How the account's screen and « Vos contributions » name a camera (GET /api/osm/sync's
 * `label`, /revue's). */
export type SyncLabel = {
  add: boolean;
  built: boolean;
  kind: string | null;
  operator: string | null;
  operator_class: string | null;
  street: string | null;
  commune: string | null;
};
/** What became of a contribution on OpenStreetMap, as « Compte » says it: gone (published,
 * its changeset), in conflict (nothing overwritten), uncertain (the team checks), sending,
 * waiting (the review or the next map update is still to come: `status`), or kept here
 * (sent before the choice, or changed by the review). */
export type SyncState =
  | "gone"
  | "conflict"
  | "uncertain"
  | "sending"
  | "waiting"
  | "kept_before"
  | "kept_edited";
export type SyncItem = {
  uuid: string;
  camera: string;
  label: SyncLabel | null;
  kind: string;
  /** The contribution's status here (pending, validated, applied…). */
  status: string;
  state: SyncState;
  changeset: number | null;
  /** A conflict's reason: osm_version, osm_tags, osm_value, osm_deleted, osm_duplicate,
   * osm_way. */
  reason: string | null;
  /** "2026-10": months only. */
  month: string | null;
};
/** The class of OSM's last refusal: revoked (she must authorise again; the choice is then
 * off), blocked (OSM blocked her account), rate_limited and osm_down (tried again later). */
export type SyncError = "revoked" | "blocked" | "rate_limited" | "osm_down";
/** GET /api/osm/sync (the synchronisation of 16/10, its server as shipped). */
export type Sync = {
  offered: boolean;
  server: "dev" | "live" | null;
  /** The write server's address: a changeset is `${url}/changeset/${n}`. */
  url: string | null;
  /** The team stopped every send (/revue's « Synchronisation OSM »). */
  suspended: boolean;
  on: boolean;
  since: string | null;
  last_error: SyncError | null;
  history: SyncItem[];
};

let sync: Promise<Sync | null> | null = null;

/** GET /api/osm/sync, asked once per page (« Compte » and « Vos contributions » share it;
 * a choice made or the page's return from OSM asks it again). Null: not readable (signed
 * out, offline, an older API). */
export function readSync(): Promise<Sync | null> {
  sync ??= call<Sync>("GET", "/api/osm/sync").then(
    (s) => (s && typeof s.offered === "boolean" ? { ...s, history: s.history ?? [] } : null),
    () => null,
  );
  return sync;
}

/** The next readSync() asks the API again (a sign-out, a sign-in). */
export function forgetSync(): void {
  sync = null;
}

/** « Publier aussi sur OpenStreetMap en mon nom »: POST /api/osm/sync {on: true}, the
 * password asked again for an account that has one; the answer is OSM's page to open (scope
 * `write_api`), the flow cookie set. 401 a wrong password, 409 a test account, 403 closed,
 * 503 not offered. */
export const startSync = (password: string | null, then = here()) =>
  call<{ url: string }>(
    "POST",
    "/api/osm/sync",
    password === null ? { on: true, then } : { on: true, password, then },
  );

/** « Rester sur Surveillance World »: POST /api/osm/sync {on: false} (the token revoked at
 * OSM, best effort, and deleted; what is published stays); answers as GET, kept. */
export async function stopSync(): Promise<Sync> {
  const s = await call<Sync>("POST", "/api/osm/sync", { on: false });
  const read = { ...s, history: s.history ?? [] };
  sync = Promise.resolve(read);
  return read;
}

/** The server's reason for a failed return, under `?debug=1` only (« raison :
 * client_refuse », in a monospace face; theme/punk/account.css): nothing
 * otherwise, never logged. */
export function whyLine(why: Why | null | undefined): HTMLElement | null {
  if (!DEBUG || !why) return null;
  const p = document.createElement("p");
  p.className = "account-why";
  p.id = "account-why";
  p.textContent = t("account.osm.why", { code: why });
  return p;
}

/** The return the page was opened with, its parameters removed from the address at once (a
 * reload or a shared link does not say it again). */
export function takeReturn(): Return {
  const read = parseReturn(window.location.search);
  const q = new URLSearchParams(window.location.search);
  if (q.has("osm") || q.has("osm_why") || q.has("compte"))
    writeParams({ osm: null, osm_why: null, compte: null });
  return read;
}

/** A camera's address: this page with `?cam=<id>` and the map where it is. */
export function cameraAddress(id: string): string {
  const q = new URLSearchParams(window.location.search);
  q.set("cam", id);
  return `${window.location.pathname}?${q.toString()}${window.location.hash}`;
}

/** GET /api/osm/signup: the pseudonym suggested and the name on OSM; null when the signup
 * has expired (401), sign-ups are closed (403 signups_closed: an administrator closed them
 * in /revue's « Réglages ») or it cannot be read (offline, another answer). */
export type Signup = { suggestion: string; osm_name: string };
export type SignupRead =
  | { ok: true; signup: Signup }
  | { ok: false; why: "expired" | "closed" | "failed" };
export async function readSignup(): Promise<SignupRead> {
  try {
    const s = await call<Signup>("GET", "/api/osm/signup");
    if (s && typeof s.suggestion === "string" && typeof s.osm_name === "string")
      return { ok: true, signup: s };
    return { ok: false, why: "failed" };
  } catch (e) {
    if (e instanceof ApiError && e.code === "signups_closed") return { ok: false, why: "closed" };
    return { ok: false, why: e instanceof ApiError && e.status === 401 ? "expired" : "failed" };
  }
}

/** What « Valider » gave. */
export type SignupResult =
  | "ok"
  | "taken"
  | "invalid"
  | "expired"
  | "osm_taken"
  | "closed"
  | "offline"
  | "error";

/** POST /api/osm/signup {pseudonym}: the account made and the session open (204). */
export async function sendSignup(pseudonym: string): Promise<SignupResult> {
  try {
    await call("POST", "/api/osm/signup", { pseudonym });
    return "ok";
  } catch (e) {
    if (!(e instanceof ApiError)) return "offline";
    if (e.status === 400) return "invalid";
    if (e.status === 401) return "expired";
    if (e.code === "signups_closed") return "closed";
    if (e.status === 409) return e.code === "osm_taken" ? "osm_taken" : "taken";
    return "error";
  }
}

/** What « Délier » gave. */
export type UnlinkResult = "ok" | "no_password" | "offline" | "error";

/** POST /api/osm/unlink: refused (409) for an account without a password. */
export async function unlink(): Promise<UnlinkResult> {
  try {
    await call("POST", "/api/osm/unlink");
    return "ok";
  } catch (e) {
    if (!(e instanceof ApiError)) return "offline";
    return e.status === 409 ? "no_password" : "error";
  }
}

/** A pseudonym the API accepts (accounts.pseudonym's CHECK, pipeline/lacarte/api/auth.py
 * PSEUDONYM_RE): said before sending. */
export const validPseudonym = (p: string): boolean => /^[A-Za-z0-9._-]{2,32}$/.test(p);
