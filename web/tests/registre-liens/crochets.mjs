// Node's module hooks for rendering the register's views outside Vite (rendre.ts): a template
// imported `?raw` is its text, a stylesheet nothing, a JSON file its value, the register's words
// (`virtual:registre-catalogue`) fr.json's `registre.*` keys, as vite.config.ts serves them.
import { readFileSync } from "node:fs";

const CATALOGUE = new URL("../../src/locales/fr.json", import.meta.url);

export async function resolve(specifier, context, next) {
  if (specifier === "virtual:registre-catalogue")
    return { url: "virtual:registre-catalogue", shortCircuit: true };
  if (specifier.endsWith("?raw")) {
    const r = await next(specifier.slice(0, -4), context);
    return { url: `${r.url}?raw`, shortCircuit: true };
  }
  return next(specifier, context);
}

export async function load(url, context, next) {
  if (url === "virtual:registre-catalogue") {
    const all = JSON.parse(readFileSync(CATALOGUE, "utf8"));
    const own = Object.fromEntries(Object.entries(all).filter(([k]) => k.startsWith("registre.")));
    return { format: "module", source: `export default ${JSON.stringify(own)};`, shortCircuit: true };
  }
  if (url.endsWith("?raw")) {
    const text = readFileSync(new URL(url.slice(0, -4)), "utf8");
    return { format: "module", source: `export default ${JSON.stringify(text)};`, shortCircuit: true };
  }
  if (url.endsWith(".css")) return { format: "module", source: "export {};", shortCircuit: true };
  if (url.endsWith(".json") && !context.importAttributes?.type) {
    const text = readFileSync(new URL(url), "utf8");
    return { format: "module", source: `export default ${text};`, shortCircuit: true };
  }
  return next(url, context);
}
