// /revue « Registre »: what a reviewer types as a correction's value, read as the API takes it
// (POST /api/review/registre, lacarte_registre/corrections.py checks it again). Pure: the tests
// read it without a page (web/tests/review-registre.test.ts).

/** What an acceptance may change on a document (corrections.FIELDS). */
export const FIELDS = [
  "montant",
  "date",
  "entreprises",
  "insee",
  "beneficiaire",
  "cameras",
  "affaire",
] as const;
export type Field = (typeof FIELDS)[number];

/** What a reader may say is wrong (corrections.CATEGORIES). */
export const CATEGORIES = [
  "montant",
  "date",
  "entreprise",
  "commune",
  "nom",
  "lien",
  "cameras",
  "zone",
  "autre",
] as const;

/** The field a category most likely corrects; none for a zone or anything else (the reviewer
 * chooses). */
export function defaultField(category: string): Field | null {
  const map: Record<string, Field> = {
    montant: "montant",
    date: "date",
    entreprise: "entreprises",
    commune: "insee",
    nom: "beneficiaire",
    cameras: "cameras",
    lien: "affaire",
  };
  return map[category] ?? null;
}

export type Parsed = { ok: true; value: number | string | string[] } | { ok: false };

const SIREN = /^\d{9}$/;
const INSEE = /^(\d{5}|2[AB]\d{3})$/;
const ID = /^[A-Za-z0-9._~-]{1,80}$/;
const AMOUNT_MAX = 1e11;
const CAMERAS_MAX = 100_000;
const NAME_MAX = 200;

/** A day YYYY-MM-DD that exists, between 1990 and 2100. */
function isDay(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return (
    y >= 1990 &&
    y <= 2100 &&
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === mo - 1 &&
    date.getUTCDate() === d
  );
}

/** The value typed for `field`, as the API takes it: « 12 000,50 € » → 12000.5, « 05/02/2021 »
 * → "2021-02-05", « 431 903 954, 256900994 » → two SIREN… `{ok: false}` when it does not fit. */
export function parseValue(field: Field, text: string): Parsed {
  const raw = text.trim();
  const no = { ok: false } as const;
  switch (field) {
    case "montant": {
      const s = raw.replace(/[\s  €]/g, "").replace(",", ".");
      if (!/^\d+(\.\d+)?$/.test(s)) return no;
      const n = Number(s);
      return Number.isFinite(n) && n <= AMOUNT_MAX ? { ok: true, value: n } : no;
    }
    case "cameras": {
      const s = raw.replace(/[\s  ]/g, "");
      if (!/^\d+$/.test(s)) return no;
      const n = Number(s);
      return n <= CAMERAS_MAX ? { ok: true, value: n } : no;
    }
    case "date": {
      const fr = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
      const iso = fr ? `${fr[3]}-${fr[2].padStart(2, "0")}-${fr[1].padStart(2, "0")}` : raw;
      return isDay(iso) ? { ok: true, value: iso } : no;
    }
    case "entreprises": {
      const list = raw
        .split(/[,;\n]+/)
        .map((s) => s.replace(/[\s  ]/g, ""))
        .filter(Boolean);
      if (!list.length || list.length > 50 || !list.every((s) => SIREN.test(s))) return no;
      return new Set(list).size === list.length ? { ok: true, value: list } : no;
    }
    case "insee": {
      const s = raw.toUpperCase();
      return INSEE.test(s) ? { ok: true, value: s } : no;
    }
    case "affaire":
      return ID.test(raw) ? { ok: true, value: raw } : no;
    case "beneficiaire": {
      const s = raw.split(/\s+/).filter(Boolean).join(" ");
      return s.length >= 1 && s.length <= NAME_MAX ? { ok: true, value: s } : no;
    }
  }
}
