// Minimal message catalogue: {name} placeholders and ICU-like plurals
// ({n, plural, =0 {...} one {# ...} other {# ...}}). One JSON file per language.
import fr from "./locales/fr.json";

type Catalogue = Record<string, string>;
const catalogues: Record<string, Catalogue> = { fr };
export const locale = "fr";
const messages = catalogues[locale];
const plurals = new Intl.PluralRules(locale);
const numbers = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });

export const has = (key: string): boolean => key in messages;

export function t(key: string, params: Record<string, string | number> = {}): string {
  const template = messages[key];
  if (template === undefined) {
    console.warn(`missing message ${key}`);
    return key;
  }
  return template
    .replace(/\{(\w+), plural, ((?:[^{}]|\{[^{}]*\})*)\}/g, (_, name: string, body: string) => {
      const n = Number(params[name]);
      const cases = Object.fromEntries(
        [...body.matchAll(/(=\d+|\w+) \{([^{}]*)\}/g)].map((m) => [m[1], m[2]]),
      );
      const chosen = cases[`=${n}`] ?? cases[plurals.select(n)] ?? cases.other ?? "";
      return chosen.replace(/#/g, numbers.format(n));
    })
    .replace(/\{(\w+)\}/g, (_, name: string) => {
      const v = params[name];
      return typeof v === "number" ? numbers.format(v) : String(v ?? "");
    });
}

/** A key in the punk interface's own words when it has them (`<key>.punk`; board 26a's
 * vocabulary: « acceptée », not « validée »), else the key itself. */
export function tp(key: string, params: Record<string, string | number> = {}): string {
  return t(has(`${key}.punk`) ? `${key}.punk` : key, params);
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(locale, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/** "2026-09" -> "septembre 2026": contributions are dated to the month on the map. */
export function formatMonth(month: string): string {
  return new Date(`${month}-15T12:00:00`).toLocaleDateString(locale, {
    year: "numeric",
    month: "long",
  });
}
