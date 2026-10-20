// /revue's pre-paint, before its code arrives: the punk interface (the default; theme.ts
// chosenUi) in dark mode takes the system's own dark background (no colour written here),
// so that the empty page does not flash white. A file of its own, not inline: /revue's
// Content-Security-Policy is `script-src 'self'` (deploy/preview.caddy). Served as is from
// web/public (Vite copies it untouched), loaded as a classic script in the page's head so
// that it runs before the first paint. The same rule as index.html's pre-paint.
try {
  const q = new URLSearchParams(location.search);
  const asked = q.get("ui");
  const classique =
    asked === "classique" ||
    asked === "classic" ||
    (asked !== "punk" && localStorage.getItem("lacarte.ui") === "classique");
  const mode = q.get("mode") || localStorage.getItem("lacarte.mode") || "auto";
  const dark =
    mode === "sombre" || (mode !== "clair" && matchMedia("(prefers-color-scheme: dark)").matches);
  if (!classique && dark) {
    document.documentElement.style.colorScheme = "dark";
    document.documentElement.style.setProperty("--page", "Canvas");
  }
} catch {}
