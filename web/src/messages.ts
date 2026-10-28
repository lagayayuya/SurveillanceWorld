// A message's placeholders and plurals filled in ({name}, {n, plural, =0 {...} one {# ...} other
// {# ...}}): the catalogue's grammar, apart from the catalogue itself, so that a page that ships
// only its own keys (the register, registre/i18n.ts) shares the rules without the map's 1 600 keys.
const plurals = new Intl.PluralRules("fr");
const numbers = new Intl.NumberFormat("fr", { maximumFractionDigits: 1 });

export function render(template: string, params: Record<string, string | number> = {}): string {
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
