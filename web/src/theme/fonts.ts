// The punk theme's fonts (self-hosted, see fonts/README.md), loaded by the punk interface
// only. On a first visit they are fetched once the map is drawn, not before: on a slow
// phone their 94 KB would compete with the first tiles (measured: +0.4 s to the first
// useful display with the light sprite, bench/lowend.mjs); the text shows in the fallback
// faces meanwhile. Once loaded, the device remembers it and they load at once next time
// (from the browser's cache), so that the faces do not change under the eyes.
import archivo from "./fonts/archivo-800-900-62-100.woff2?url";
import elite from "./fonts/special-elite.woff2?url";

const SEEN = "lacarte.fonts";

export function seen(): boolean {
  try {
    return localStorage.getItem(SEEN) === "1";
  } catch {
    return false;
  }
}

let loading: Promise<void> | null = null;

export function loadFonts(): Promise<void> {
  loading ??= (async () => {
    const faces = [
      new FontFace("Archivo", `url(${archivo}) format("woff2")`, {
        weight: "800 900",
        stretch: "62% 100%",
        display: "swap",
      }),
      new FontFace("Special Elite", `url(${elite}) format("woff2")`, {
        weight: "400",
        display: "swap",
      }),
    ];
    for (const face of faces) document.fonts.add(face);
    await Promise.all(faces.map((face) => face.load()));
    try {
      localStorage.setItem(SEEN, "1");
    } catch {
      // No storage: they load after the map next time too.
    }
  })();
  return loading;
}
