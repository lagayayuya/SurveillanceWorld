// View state beyond the map position (which MapLibre keeps in the hash): the reach estimate
// and the filters live in the query string, so that a link reproduces what is shown.

export function readParam(name: string): string | null {
  return new URLSearchParams(window.location.search).get(name);
}

/** Set (or remove, with null) query parameters, keeping the hash and without a reload. */
export function writeParams(params: Record<string, string | null>): void {
  const q = new URLSearchParams(window.location.search);
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === "") q.delete(k);
    else q.set(k, v);
  }
  const search = q.toString();
  const url = `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`;
  window.history.replaceState(window.history.state, "", url);
}

/** Map position from the hash, in MapLibre's form #zoom/lat/lng. */
export function readHash(): { zoom: number; center: [number, number] } | null {
  const parts = window.location.hash.slice(1).split("/").map(Number);
  if (parts.length < 3 || parts.slice(0, 3).some((v) => Number.isNaN(v))) return null;
  return { zoom: parts[0], center: [parts[2], parts[1]] };
}

/** Write the map position into the hash, keeping the query string, without a history entry. */
export function writeHash(zoom: number, lat: number, lng: number): void {
  const hash = `#${zoom.toFixed(2)}/${lat.toFixed(5)}/${lng.toFixed(5)}`;
  const url = `${window.location.pathname}${window.location.search}${hash}`;
  window.history.replaceState(window.history.state, "", url);
}
