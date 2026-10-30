// View state beyond the map position (which MapLibre keeps in the hash): the reach estimate
// and the filters live in the query string, so that a link reproduces what is shown.
// While the register is open over the map (registre/hote.ts), the page's address is the
// register's (/registre/…, its own query and section): the map then reads and writes its own
// address aside, and gets it back when the register closes.

/** The map's address while the register holds the page's, else null. */
let aside: URL | null = null;
/** The map's address as last written on the page: where a step back onto the register finds it. */
let last = `${window.location.pathname}${window.location.search}${window.location.hash}`;

/** Where the map reads its state: its address aside, or the page's. */
const here = (): { search: string; hash: string; pathname: string } => aside ?? window.location;

/** The register opens over the map: the map keeps `address` (a path, its query and hash) as its
 * own from now on, and stops writing the page's. */
export function setAside(address: string): void {
  aside = new URL(address, window.location.origin);
}

/** The register has closed: the map's address, to show again, and the map writes the page's. */
export function takeBack(): string {
  const a = aside;
  aside = null;
  last = a ? `${a.pathname}${a.search}${a.hash}` : "/";
  return last;
}

/** The register holds the page's address. */
export const isAside = (): boolean => aside !== null;

/** The map's address as last shown on the page (a step back onto the register keeps it aside). */
export const lastMapAddress = (): string => last;

/** The map's own address (the page's, or the one kept aside while the register is open). */
export function mapAddress(): string {
  const a = here();
  return `${a.pathname}${a.search}${a.hash}`;
}

// The register's paths: the page opened at one shows the map behind it, at its last address
// (?carte=, an older link's) or at its start.
// A commune's page shows the commune on the map (as « ← Carte » did, plan B1.3).
if (/^\/registre(\/|$)/.test(window.location.pathname)) {
  const carte = new URLSearchParams(window.location.search).get("carte");
  const insee = /^\/registre\/commune\/(\d[\dAB]\d{3})(\/|$)/.exec(window.location.pathname)?.[1];
  setAside(
    carte && /^[?#]/.test(carte) && !/[\s<>"]/.test(carte)
      ? `/${carte}`
      : insee
        ? `/?insee=${insee}`
        : "/",
  );
  last = "/";
}

export function readParam(name: string): string | null {
  return new URLSearchParams(here().search).get(name);
}

/** Set (or remove, with null) query parameters, keeping the hash and without a reload. */
export function writeParams(params: Record<string, string | null>): void {
  const q = new URLSearchParams(here().search);
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === "") q.delete(k);
    else q.set(k, v);
  }
  const search = q.toString();
  if (aside) {
    aside.search = search;
    return;
  }
  const url = `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`;
  window.history.replaceState(window.history.state, "", url);
  last = url;
}

/** Map position from the hash, in MapLibre's form #zoom/lat/lng. */
export function readHash(): { zoom: number; center: [number, number] } | null {
  const parts = here().hash.slice(1).split("/").map(Number);
  if (parts.length < 3 || parts.slice(0, 3).some((v) => Number.isNaN(v))) return null;
  return { zoom: parts[0], center: [parts[2], parts[1]] };
}

/** Write the map position into the hash, keeping the query string, without a history entry. */
export function writeHash(zoom: number, lat: number, lng: number): void {
  const hash = `#${zoom.toFixed(2)}/${lat.toFixed(5)}/${lng.toFixed(5)}`;
  if (aside) {
    aside.hash = hash;
    return;
  }
  const url = `${window.location.pathname}${window.location.search}${hash}`;
  window.history.replaceState(window.history.state, "", url);
  last = url;
}
