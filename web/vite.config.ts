import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import { licences } from "./scripts/licences.mjs";

// Every string of the pages' <head> (title, share metadata) comes from the catalogue, as the
// interface's do: %t:key% is replaced at build time, so that link previews, which run no
// script, read them; an unknown key stops the build.
const catalogue: Record<string, string> = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "src/locales/fr.json"), "utf8"),
);
const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// The site's own address (https://<host>, no trailing slash), given by deploy.sh from
// PREVIEW_HOST: the share tags that need an absolute URL (og:url, og:image) sit between
// <!-- site --> and <!-- /site --> with %site% for it, and are left out of a build without it
// (the gate's, a developer's). The repository names no host.
const site = (process.env.VITE_SITE_URL ?? "").replace(/\/$/, "").toLowerCase();
if (site && !/^https:\/\/[a-z0-9.-]+$/.test(site))
  throw new Error(`VITE_SITE_URL: https://<host> expected, got "${site}"`);
const headStrings: Plugin = {
  name: "head-strings",
  transformIndexHtml: (html) => {
    const sited = html.replace(/<!-- site -->([\s\S]*?)<!-- \/site -->\n?/g, (_, block: string) =>
      site ? block.replace(/%site%/g, site) : "",
    );
    if (sited.includes("%site%")) throw new Error("head-strings: %site% outside <!-- site -->");
    const out = sited.replace(/%t:([\w.]+)%/g, (_, key: string) => {
      const value = catalogue[key];
      if (value === undefined) throw new Error(`head-strings: no "${key}" in fr.json`);
      return escapeHtml(value);
    });
    // A malformed key (a dash, a space) would otherwise reach the page as written.
    const left = out.match(/%t:[^%<"]*%?/);
    if (left) throw new Error(`head-strings: "${left[0]}" is not a catalogue key`);
    return out;
  },
};

// The web app manifest (the home screen's name and icons, logo L3 of 2026-10-15), its name
// from the catalogue as every string of the page.
const manifest: Plugin = {
  name: "manifest",
  generateBundle() {
    this.emitFile({
      type: "asset",
      fileName: "manifest.webmanifest",
      source: `${JSON.stringify(
        {
          name: catalogue["app.name"],
          short_name: catalogue["app.name"],
          lang: "fr",
          start_url: "/",
          display: "browser",
          background_color: "#e6eef0",
          theme_color: "#f2efe6",
          icons: [
            { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
            { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
          ],
        },
        null,
        2,
      )}\n`,
    });
  },
};

// The register's words: the catalogue's `registre.*` keys only, as a module of their own
// (registre/modale.ts imports "virtual:registre-catalogue"), asked with the register's code only.
const REGISTRE_CATALOGUE = "virtual:registre-catalogue";
const registreCatalogue: Plugin = {
  name: "registre-catalogue",
  resolveId: (id) => (id === REGISTRE_CATALOGUE ? `\0${REGISTRE_CATALOGUE}` : null),
  load: (id) =>
    id === `\0${REGISTRE_CATALOGUE}`
      ? `export default ${JSON.stringify(Object.fromEntries(Object.entries(catalogue).filter(([k]) => k.startsWith("registre."))))};`
      : null,
  // the register's paths are the map's page, the register over it (Caddy rewrites them on the
  // server, deploy/preview.caddy; registre/hote.ts)
  configureServer: (server) => {
    server.middlewares.use((req, _res, next) => {
      if (req.url && /^\/registre(\/|\?|$)/.test(req.url)) req.url = "/index.html";
      next();
    });
  },
  configurePreviewServer: (server) => {
    server.middlewares.use((req, _res, next) => {
      if (req.url && /^\/registre(\/|\?|$)/.test(req.url)) req.url = "/index.html";
      next();
    });
  },
};

// The other way round: the map's and /revue's catalogue (src/i18n.ts imports locales/fr.json, the
// only module that does) without the register's keys, which they never read (824 keys, 60 kB
// before compression). Before Vite's own JSON plugin, on the file's text.
const siteCatalogue: Plugin = {
  name: "site-catalogue",
  enforce: "pre",
  transform: (code, id) =>
    /\/src\/locales\/fr\.json$/.test(id)
      ? JSON.stringify(
          Object.fromEntries(
            Object.entries(JSON.parse(code) as Record<string, string>).filter(
              ([k]) => !k.startsWith("registre."),
            ),
          ),
        )
      : null,
};

// Local development only: the participation API (tests/apiserver.py) behind a proxy that
// adds the account name, as Caddy does on the server with basic auth.
const api = {
  "/api": {
    target: `http://127.0.0.1:${process.env.API_PORT ?? 8791}`,
    headers: { "X-Author": process.env.DEV_AUTHOR ?? "dev" },
  },
};

export default defineConfig({
  // The third-party licence notices served at /licences.txt (scripts/licences.mjs).
  plugins: [headStrings, manifest, licences(catalogue), registreCatalogue, siteCatalogue],
  server: { port: 5173, proxy: api },
  preview: { port: 4173, proxy: api },
  // Two pages: the map, which answers the register's paths too (/registre/…, the register over
  // the map, its code a chunk of its own), and the review page (served at /revue by Caddy).
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        revue: resolve(import.meta.dirname, "revue.html"),
      },
    },
  },
});
