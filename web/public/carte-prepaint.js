// The map's pre-paint (index.html, every page the map answers: / and the register's /registre/…),
// before its code arrives. A file of its own, not inline, so that the register's paths keep a strict
// Content-Security-Policy (script-src 'self'), as /revue's pre-paint.
// Dark mode (theme.ts): until the tokens arrive with the code, the empty page takes the
// system's own dark background (no colour written here).
try {
  const q = new URLSearchParams(location.search);
  const mode = q.get("mode") || localStorage.getItem("lacarte.mode") || "auto";
  const dark =
    mode === "sombre" ||
    (mode !== "clair" && matchMedia("(prefers-color-scheme: dark)").matches);
  if (dark) {
    document.documentElement.style.colorScheme = "dark";
    document.documentElement.style.setProperty("--page", "Canvas");
  }
} catch {}
