// What the API says of the site (GET /api/config, the launch lot's contract), asked once as
// the punk page starts (main.ts, beside the session): whether contributions are open,
// whether new accounts can be made (lot 2 of /revue: an administrator closes sign-ups
// without closing everything), whether publishing to OpenStreetMap is offered (and the synchronisation's setting), and the
// publisher's identity when the API gives one. Read without a rebuild: the server's setting changes, the next page load
// follows. Offline, failing, slow or malformed: contributions open, no publishing, no
// publisher (the API's own refusals stay the guard). Plain fetch, no import: the tests read
// parseConfig without a page.

export type SiteConfig = {
  /** Accounts and contributions shown (« Compte », « ＋ Ajouter », « Modifier »…). */
  contributions: boolean;
  /** A first sign-in with OpenStreetMap can make its account (never while contributions
   * are closed); an older API says nothing: open. */
  signups: boolean;
  /** Publishing to OpenStreetMap offered, while contributions are open (the legal pages'
   * publishing texts). */
  publish: boolean;
  /** The OpenStreetMap synchronisation offered (« Compte »'s setting): whatever
   * contributions are, so that a person can always stop it. */
  sync: boolean;
  /** Shown in the legal pages when set; null otherwise (nothing shown in its place). */
  publisher: string | null;
};

export const DEFAULT_CONFIG: SiteConfig = {
  contributions: true,
  signups: true,
  publish: false,
  sync: false,
  publisher: null,
};

/** Past this, the page starts with the defaults rather than wait for the API. */
const WAIT_MS = 2500;

/** The answer as the page reads it: a field of the wrong type takes its default. */
export function parseConfig(data: unknown): SiteConfig {
  const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const publisher = typeof d.publisher === "string" ? d.publisher.trim() : "";
  const contributions = typeof d.contributions === "boolean" ? d.contributions : true;
  return {
    contributions,
    signups: contributions && d.signups !== false,
    publish: d.publish === true,
    sync: d.sync === true,
    publisher: publisher || null,
  };
}

let current: SiteConfig = DEFAULT_CONFIG;
let asked: Promise<SiteConfig> | null = null;

/** GET /api/config, asked once; never fails. */
export function loadConfig(): Promise<SiteConfig> {
  asked ??= (async () => {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), WAIT_MS);
    try {
      const r = await fetch("/api/config", { signal: abort.signal });
      if (!r.ok) return DEFAULT_CONFIG;
      current = parseConfig(await r.json());
    } catch {
      // Offline, aborted, not JSON: the defaults.
    } finally {
      clearTimeout(timer);
    }
    return current;
  })();
  return asked;
}

/** The site as known so far (the defaults until loadConfig has answered). */
export const siteConfig = (): SiteConfig => current;
