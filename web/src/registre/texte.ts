// What the register shows of a published text: the sources' lost apostrophes and dashes put back,
// a title in capitals set in sentence case, a company's name in capitals set in title case. Display
// only: the build and the exports keep the text as published. No word of the interface here.

/** The source's typewriter apostrophes and dashes, and the apostrophes it lost (« D UNE » → « D’UNE »). */
export function tidy(text: unknown): string {
  return String(text ?? "")
    .replace(/[\u0092`´']/g, "’")
    .replace(/[\u0096\u0097]/g, "–")
    .replace(/\b([DLdl]|QU|qu|[Jj]) (?=[AEIOUYÉÈÊÂHaeiouyéèêâh])/g, "$1’")
    .replace(
      /\bD(UNE?) (?=(?:SYST|DISPOSITIF|R[EÉ]SEAU|PARC|MARCH[EÉ]|CENTRE|LOGICIEL|ENSEMBLE|OUTIL|[EÉ]QUIPEMENT|SOLUTION|INSTALLATION|PLATE|PRESTATION)[A-ZÉÈ]*)/g,
      "D’$1 ",
    )
    .replace(/\s+/g, " ")
    .trim();
}

/** A title in capitals, or a long one, in sentence case. */
export function calm(text: unknown): string {
  const s = tidy(text).replace(/,(?=\S)/g, ", ");
  const letters = s.replace(/[^A-Za-zÀ-ÿ]/g, "");
  return letters && (letters === letters.toUpperCase() || s.length > 70)
    ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()
    : s;
}

/** A published object as a title: capitals in sentence case, cut at a word before 120 characters. */
export function sentence(text: unknown): string {
  if (!text) return "";
  let s = tidy(text);
  if (s === s.toUpperCase()) {
    s = s.toLowerCase();
    s = s.charAt(0).toUpperCase() + s.slice(1);
  }
  return s.length > 120 ? `${s.slice(0, 118).replace(/\s+\S*$/, "")}…` : s;
}

const SMALL_CAPS = new Set([
  "DE",
  "DES",
  "DU",
  "LA",
  "LE",
  "LES",
  "ET",
  "EN",
  "AUX",
  "AU",
  "SUR",
  "SOUS",
]);
/** A name in capitals in title case, its small words in lower case after the first; « T.I.C. » and
 * legal forms (SA, SAS…) kept. A name already in mixed case is left as published. */
export function titleCase(name: string): string {
  if (name !== name.toUpperCase() || !/[A-Z]{4}/.test(name)) return name;
  return name
    .split(/(\s+|-)/)
    .map((w, i) =>
      i && SMALL_CAPS.has(w)
        ? w.toLowerCase()
        : /\.|^(SA|SAS|SARL|SNC|EI|II|III)$/.test(w) || w.length < 2
          ? w
          : w.charAt(0) + w.slice(1).toLowerCase(),
    )
    .join("");
}

const SMALL = new Set([
  "de",
  "des",
  "du",
  "la",
  "le",
  "les",
  "et",
  "en",
  "aux",
  "au",
  "sur",
  "sous",
]);
/** A proper name's small words in lower case and its elisions fixed (« Pharmacie des Halles »,
 * « l’Arbresle »); accents the source lost stay lost. */
export function proper(name: string): string {
  return name
    .split(/(\s+)/)
    .map((w, i) =>
      i && SMALL.has(w.toLowerCase())
        ? w.toLowerCase()
        : w.replace(
            /^([dl])’(\p{L})/iu,
            (_, a: string, b: string) => `${a.toLowerCase()}’${b.toUpperCase()}`,
          ),
    )
    .join("");
}

/** Lower case without accents: what a search compares. */
export const plain = (text: unknown): string =>
  String(text ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

/** First letter in capital. */
export const capital = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
