// The registre's interface texts as one object, for its templates: a template reads its
// words as paths ({{t.commune.titre}}), never through a call (a template holds no
// expression), so the view passes `t`, made here from the catalogue's flat keys
// (registre.commune.titre -> t.commune.titre). No import: the view gives fr.json (vite
// reads it, node's tests read the file). A message with {placeholders} or a plural stays a
// string here: the view formats it with i18n.ts's t() and passes the result itself.

/** What dc.ts's paths refuse to read. */
const BANNED = new Set(["__proto__", "prototype", "constructor"]);

export type Texts = { [key: string]: string | Texts };

/** The keys under `prefix`, nested by their dots. A key a template could not read (a
 * hyphen, an empty part) or one that is both a text and a group is a mistake in the
 * catalogue, said at once rather than drawn as an empty hole. */
export function nest(flat: Record<string, string>, prefix = "registre"): Texts {
  const root: Texts = {};
  const head = `${prefix}.`;
  for (const [key, text] of Object.entries(flat)) {
    if (!key.startsWith(head)) continue;
    const path = key.slice(head.length).split(".");
    if (path.some((p) => !/^[\w$]+$/.test(p) || BANNED.has(p)))
      throw new Error(`catalogue: ${key} cannot be read from a template`);
    let node = root;
    path.forEach((p, i) => {
      const next = Object.hasOwn(node, p) ? node[p] : undefined;
      if (i === path.length - 1) {
        if (next !== undefined) throw new Error(`catalogue: ${key} is both a text and a group`);
        node[p] = text;
      } else if (typeof next === "string") {
        throw new Error(
          `catalogue: ${head}${path.slice(0, i + 1).join(".")} is both a text and a group`,
        );
      } else {
        if (next === undefined) node[p] = {};
        node = node[p] as Texts;
      }
    });
  }
  return root;
}
