// The register's words: the `registre.*` keys of locales/fr.json, and only them. The page gets them
// from a module the build makes out of fr.json (vite.config.ts, « registre-catalogue »), so that it
// does not ship the map's and /revue's 1 600 keys; tests give them from fr.json itself.
import { render } from "../messages.ts";

let messages: Record<string, string> = {};

/** The catalogue in force (the `registre.*` keys, with their prefix). */
export function setMessages(catalogue: Record<string, string>): void {
  messages = catalogue;
}

export const has = (key: string): boolean => key in messages;

/** `registre.<key>` filled in; a missing key says so in the console and shows its name. */
export function t(key: string, params: Record<string, string | number> = {}): string {
  const template = messages[`registre.${key}`];
  if (template === undefined) {
    console.warn(`missing message registre.${key}`);
    return `registre.${key}`;
  }
  // a plural's number in the kit's full no-break space, as fr() writes it (format.ts)
  return render(template, params).replace(/\u202f/g, "\u00a0");
}
