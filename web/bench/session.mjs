// Accounts on the bench's throwaway API (tests/apiserver.py creates them, migration 014):
// every bench account has this password, fictitious, never a real one. A session is
// opened as the page does, by POST /api/session with the site's Origin — for a reviewer or
// an administrator by /revue's privileged entry, POST /api/review/session (lot 2: the
// ordinary entry refuses them, and each refusal doubles the pseudonym's delay); the API
// serves the local cookie `session` (no Secure: WebKit refuses one over http://localhost).
export const BENCH_PASSWORD = "bench-password-not-a-secret";
export const COOKIE = "session";
/** The bench's privileged accounts (tests/apiserver.py): rev, an administrator (its
 * --admin-user default), rvw, a reviewer only (--review-user rvw where a bench needs one). */
export const PRIVILEGED = new Set(["rev", "rvw"]);
/** Where `who` signs in: /revue's privileged entry for a reviewer or an administrator. */
export const entryOf = (who) => (PRIVILEGED.has(who) ? "/api/review/session" : "/api/session");

const tokens = new Map();

/** POST /api/session (or /api/review/session: entryOf) as `who` on `base` (the API, or a
 * proxy in front of it, with `headers` such as a basic-auth gate's); returns the session
 * token, cached per base and account. `origin`: the Origin the API accepts on writes. */
export async function sessionOf(base, origin, who, headers = {}) {
  const key = `${base} ${who}`;
  if (tokens.has(key)) return tokens.get(key);
  const r = await fetch(new URL(entryOf(who), base), {
    method: "POST",
    headers: { origin, "content-type": "application/json", ...headers },
    body: JSON.stringify({ pseudonym: who, password: BENCH_PASSWORD }),
  });
  const token = new RegExp(`(?:^|[;,]\\s*)${COOKIE}=([^;]+)`).exec(
    r.headers.get("set-cookie") ?? "",
  )?.[1];
  if (r.status !== 204 || !token) throw new Error(`sign-in as ${who}: ${r.status}`);
  tokens.set(key, token);
  return token;
}

/** POST /api/review/reauth: `who`'s password again on its privileged session, for an
 * administrator's destructive routes (403 reauth without it; valid 10 minutes). */
export async function reauthOf(base, origin, who, headers = {}) {
  const token = await sessionOf(base, origin, who, headers);
  const r = await fetch(new URL("/api/review/reauth", base), {
    method: "POST",
    headers: {
      origin,
      "content-type": "application/json",
      cookie: `${COOKIE}=${token}`,
      ...headers,
    },
    body: JSON.stringify({ password: BENCH_PASSWORD }),
  });
  if (r.status !== 204) throw new Error(`reauth as ${who}: ${r.status}`);
}

/** Forget the sessions (a new throwaway database). */
export const forgetSessions = () => tokens.clear();

/** The session cookie in a request's Cookie header, or null. */
export const sessionCookie = (cookie) =>
  new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`).exec(cookie ?? "")?.[1] ?? null;

/** A Cookie header with the session `token` in place of any session cookie it had. */
export function withSession(cookie, token) {
  const rest = (cookie ?? "").split(/;\s*/).filter((c) => c && !c.startsWith(`${COOKIE}=`));
  return [...rest, `${COOKIE}=${token}`].join("; ");
}
