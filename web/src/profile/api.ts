// The account routes the profile and the leaderboard read and write (the lot « comptes »
// contract, 2026-10-09): who is signed in, their points, the leaderboard and its scale, the
// opt-in, signing out, downloading one's data and deleting the account. Same origin, through
// the participation's client (participate/api.ts call: ?debug=1 logs each call, never its
// body).
import { ApiError, call } from "../participate/api";

/** GET /api/me (`author` and `reviewer` stay for the participation's code). */
export type Me = {
  pseudonym: string;
  /** "2026-03": the month the account was created. */
  since: string;
  /** Shown in the others' leaderboard (off by default). */
  leaderboard: boolean;
  /** Her pseudonym in the public history of the cameras she surveyed (lot U, off by
   * default: « par un contributeur »); absent from an older API. */
  history_pseudonym?: boolean;
  reviewer: boolean;
  role?: "contributor" | "reviewer";
  /** Linked to an OpenStreetMap account (OSM lot 1); absent from an older API. */
  osm?: boolean;
  /** Has a password; absent from an older API (every account had one then). */
  password?: boolean;
  /** The OSM synchronisation is on (« Publier aussi sur OpenStreetMap en mon nom », on the
   * offered write server); absent from an older API. */
  sync?: boolean;
  /** `sync`'s former name, kept by the API. */
  publish?: boolean;
};

/** The four sorts of points (rules/leaderboard.yaml), in 26a's order and colours. */
export const KINDS = ["add", "info", "correction", "verification"] as const;
export type Kind = (typeof KINDS)[number];
/** A leaderboard's filter: every sort, or one. */
export type Count = "total" | Kind;
/** "2026-10", or every month. */
export type Period = string;

export type Score = {
  period: Period;
  total: number;
  by: Record<Kind, number>;
  counts: Record<Kind, number>;
  /** Contributions the review accepted (validated, applied or superseded). */
  accepted: number;
  communes: number;
  /** Points waiting for the review, this person only. */
  pending: number;
  /** Null when not opted in or without points. */
  rank: number | null;
};

/** The points of each sort (rules/leaderboard.yaml), what « Comment on compte ? » shows. */
export type Scale = {
  add: number;
  info: number;
  complete_bonus: number;
  correction: number;
  verification: number;
  verification_on_site_only: boolean;
};

export type Board = {
  period: Period;
  kind: Count;
  rows: { rank: number; pseudonym: string; points: number; me: boolean }[];
  periods: Period[];
  scale?: Scale;
};

export const score = (period: Period) =>
  call<Score>("GET", `/api/me/score?period=${encodeURIComponent(period)}`);

export const leaderboard = (period: Period, kind: Count) =>
  call<Board>(
    "GET",
    `/api/leaderboard?period=${encodeURIComponent(period)}&kind=${encodeURIComponent(kind)}`,
  );

export const setLeaderboard = (on: boolean) => call<null>("PUT", "/api/me/leaderboard", { on });

/** PUT /api/me/history-pseudonym: her pseudonym in the cameras' public history, or not; read
 * by the API at each request, so it holds at once. */
export const setHistoryPseudonym = (on: boolean) =>
  call<null>("PUT", "/api/me/history-pseudonym", { on });

export const signOut = () => call<null>("DELETE", "/api/session");

/** POST /api/me/password: the account's other sessions end; 401 a wrong current password,
 * 400 « password_short » a new one under 12 characters. */
export const changePassword = (current: string, next: string) =>
  call<null>("POST", "/api/me/password", { current, new: next });

/** POST /api/me/delete: the password, or for an account without one (signed in with
 * OpenStreetMap) the pseudonym retyped; 401 a wrong password, 400 « confirmation » a wrong
 * pseudonym, 409 « test_account ». */
export const deleteAccount = (confirm: { password: string } | { pseudonym: string }) =>
  call<null>("POST", "/api/me/delete", confirm);

/** The file « Télécharger mes données » saves (the API's Content-Disposition). */
export const EXPORT_FILE = "surveillance-world-mes-donnees.json";

/** GET /api/me/export: the account, its contributions, its points and its sessions as the
 * server wrote them (a JSON attachment), kept as bytes rather than read through call(); 401
 * no session. */
export async function exportData(): Promise<Blob> {
  const r = await fetch("/api/me/export");
  if (!r.ok) throw new ApiError(r.status, "export");
  return r.blob();
}
