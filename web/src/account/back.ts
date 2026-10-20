// What the page was opened with on its way back from OpenStreetMap (`?osm=`, `?osm_why=`)
// or to the password form (`?compte=motdepasse`): read without the page (no import), so
// that web/tests/account.test.ts runs it in Node.

/** What the API's callback says, in the `osm` parameter of the page it sends back to. */
export type Outcome =
  | "signup"
  | "signed"
  | "linked"
  | "link_taken"
  | "link_other"
  | "failed"
  | "denied"
  | "write_on"
  | "write_failed"
  | "write_other"
  /** A first sign-in while sign-ups are closed (lot 4 of /revue): no account was made. */
  | "signups_closed";
const OUTCOMES: Outcome[] = [
  "signup",
  "signed",
  "linked",
  "link_taken",
  "link_other",
  "failed",
  "denied",
  "write_on",
  "write_failed",
  "write_other",
  "signups_closed",
];

/** Why a return from OpenStreetMap failed (`osm_why`, for `failed` and `write_failed`):
 * the server's short codes (lot of 2026-10-11), shown only under `?debug=1`. */
const WHYS = [
  "flux_inconnu",
  "flux_serveur",
  "navigateur",
  "refus_osm",
  "client_refuse",
  "echange_refuse",
  "reseau",
  "id_token",
  "droits",
  "compte",
] as const;
export type Why = (typeof WHYS)[number];

/** What the page was opened with: `?osm=` (null when absent or not one the contract
 * names), `?osm_why=` (null unless a known code), `?compte=motdepasse` (the password form,
 * an address nothing links to). */
export type Return = { outcome: Outcome | null; why: Why | null; password: boolean };

/** `search` (location.search) read as a return; pure. */
export function parseReturn(search: string): Return {
  const q = new URLSearchParams(search);
  const osm = q.get("osm");
  const why = q.get("osm_why");
  return {
    outcome: osm !== null && (OUTCOMES as string[]).includes(osm) ? (osm as Outcome) : null,
    why: why !== null && (WHYS as readonly string[]).includes(why) ? (why as Why) : null,
    password: q.get("compte") === "motdepasse",
  };
}
