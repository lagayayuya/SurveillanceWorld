// The register's pre-paint, before its code arrives: the punk tokens are keyed on the root's
// data-ui and data-mode (theme/punk/tokens.css), set here from the visitor's choice (?mode=,
// lacarte.mode, shared with the map: same origin) or the system's, so that the page is drawn in
// its mode at once. A file of its own, not inline, so that the page keeps a strict
// Content-Security-Policy (script-src 'self'), as /revue's pre-paint.
try {
  const q = new URLSearchParams(location.search);
  const mode = q.get("mode") || localStorage.getItem("lacarte.mode") || "auto";
  const dark =
    mode === "sombre" || (mode !== "clair" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.ui = "punk";
  document.documentElement.dataset.mode = dark ? "dark" : "light";
} catch {}
