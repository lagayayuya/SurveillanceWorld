// The account's session in the client (lot « comptes », its contract of 2026-10-09): who
// the API says is signed in (GET /api/me), asked once at start, again after a login or a
// logout; the rest of the page reads it here and listens to its changes. Three answers:
// signed in (200), a visitor (401: no session, or an expired one), unknown (offline, the
// API down or absent: the screens then behave as before accounts, and what is sent waits in
// the queue, which says when it needs a login). The session itself is an HttpOnly cookie
// the page never sees; nothing about the account on the device (the previous version's
// « Depuis votre visite », a month and two counts, is removed at sign-out: profile/context.ts).
import { ApiError, call } from "../participate/api";

/** GET /api/me. `author` and `reviewer` are the fields the code read before accounts;
 * `pseudonym`, `role`, `since` and `leaderboard` come with them (an older API has none). */
export type Me = {
  author: string;
  pseudonym: string;
  reviewer: boolean;
  role?: "contributor" | "reviewer";
  /** "YYYY-MM": the month the account was made. */
  since: string;
  leaderboard: boolean;
  validation: "review" | "peer";
  /** Linked to an OpenStreetMap account (OSM lot 1; an older API says nothing: not linked). */
  osm?: boolean;
  /** Has a password (an account made with OpenStreetMap may have none; an older API says
   * nothing: every account had one). */
  password?: boolean;
  /** Publishing to OpenStreetMap in one's name is on, on the write server (OSM lot 2);
   * absent from an older API. */
  publish?: boolean;
};

export type Session = { state: "unknown" } | { state: "visitor" } | { state: "signed"; me: Me };

let current: Session = { state: "unknown" };
let asking: Promise<Session> | null = null;
const listeners = new Set<(s: Session) => void>();

export const session = (): Session => current;
export const signedIn = (): boolean => current.state === "signed";
/** No session, said by the API (not merely unreachable). */
export const isVisitor = (): boolean => current.state === "visitor";
export const me = (): Me | null => (current.state === "signed" ? current.me : null);

/** The account's name: its pseudonym (an older API says `author`). */
export const pseudonym = (m: Me): string => m.pseudonym ?? m.author;

/** The account square's letters (board 25b: « ju_93 » → « JU »): its first two letters or
 * digits, in capitals. */
export function initials(name: string): string {
  const chars = [...name.normalize("NFC")].filter((c) => /[\p{L}\p{N}]/u.test(c));
  return chars.slice(0, 2).join("").toLocaleUpperCase("fr");
}

/** Told now and at every change; returns a function that stops it. */
export function onSession(listener: (s: Session) => void): () => void {
  listeners.add(listener);
  listener(current);
  return () => listeners.delete(listener);
}

function set(s: Session): void {
  current = s;
  for (const listener of [...listeners]) listener(s);
}

/** The session once the API has answered the request in flight (the one asked at start),
 * or the one known. */
export const settled = (): Promise<Session> => asking ?? Promise.resolve(current);

/** Ask the API who is signed in (one request at a time; concurrent callers share it). */
export function loadSession(): Promise<Session> {
  asking ??= call<Me | null>("GET", "/api/me")
    .then(
      (m): Session =>
        m && typeof m === "object" && typeof (m.pseudonym ?? m.author) === "string"
          ? { state: "signed", me: m }
          : { state: "unknown" },
      (e): Session =>
        e instanceof ApiError && e.status === 401 ? { state: "visitor" } : { state: "unknown" },
    )
    .then((s) => {
      set(s);
      return s;
    })
    .finally(() => {
      asking = null;
    });
  return asking;
}

/** What a login gave: signed in, wrong identifiant or password (one answer for every
 * refusal, after the server's delay), offline, or anything else the API said. */
export type LoginResult = "ok" | "credentials" | "offline" | "error";

/** POST /api/session, then who is signed in. */
export async function login(pseudonymInput: string, password: string): Promise<LoginResult> {
  try {
    await call("POST", "/api/session", { pseudonym: pseudonymInput, password });
  } catch (e) {
    if (e instanceof ApiError) return e.status === 401 ? "credentials" : "error";
    return "offline";
  }
  const s = await loadSession();
  return s.state === "signed" ? "ok" : "error";
}

/** DELETE /api/session: the session ends here whatever the API answers (offline, the
 * cookie stays until it expires, but the page no longer acts signed in). */
export async function logout(): Promise<void> {
  try {
    await call("DELETE", "/api/session");
  } catch {
    // Offline or refused: the page forgets the account all the same.
  }
  set({ state: "visitor" });
}
