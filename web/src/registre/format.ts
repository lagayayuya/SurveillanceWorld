// Numbers, amounts and dates as the register writes them (its kit, § 3): « 1 233 », « 415 000 € »,
// « 108,7 M€ », « 18 nov. 2025 », « novembre 2025 », « 1er octobre 2026 ». Month names come from
// Intl (French), the units and the words from the catalogue (registre.format.*).
import { t } from "./i18n.ts";

const NBSP = "\u00a0";
const integer = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
const SHORT = Array.from({ length: 12 }, (_, m) =>
  new Intl.DateTimeFormat("fr-FR", { month: "short", timeZone: "UTC" }).format(
    Date.UTC(2026, m, 15),
  ),
);
const LONG = Array.from({ length: 12 }, (_, m) =>
  new Intl.DateTimeFormat("fr-FR", { month: "long", timeZone: "UTC" }).format(
    Date.UTC(2026, m, 15),
  ),
);

/** An integer, its thousands apart by a no-break space as wide as a space, as the kit writes them
 * (« 1 233 »): Intl's narrow one all but vanishes in Archivo's condensed figures. */
export const fr = (n: number): string => integer.format(Math.round(n)).replace(/\u202f/g, NBSP);

/** An amount: in euros below a million (« 415 000 € »), in millions above, with one decimal below
 * ten millions (« 4,9 M€ ») and none from ten (« 109 M€ »); none or zero: « non publié ». */
export function money(n: number | null | undefined): string {
  if (n == null || n === 0) return t("format.non_publie");
  if (n < 1e6) return t("format.eur", { n: fr(n) });
  const m = (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(".", ",");
  return t("format.meur", { n: m });
}

/** An amount in full euros, never in millions: « 415 000 € ». */
export const moneyFull = (n: number | null | undefined): string =>
  n == null ? t("format.non_publie") : t("format.eur", { n: fr(n) });

const parts = (d: string) => d.split("-").map(Number);

/** « 18 nov. 2025 »; a month « nov. 2025 »; none: « date non publiée ». */
export function shortDate(d: string | null | undefined): string {
  if (!d) return t("format.date_non_publiee");
  const [y, m, j] = parts(d);
  return `${j ? `${j}${NBSP}` : ""}${SHORT[m - 1]}${NBSP}${y}`;
}
/** « nov. 2025 ». */
export const shortMonth = (d: string): string =>
  `${SHORT[Number(d.slice(5, 7)) - 1]}${NBSP}${d.slice(0, 4)}`;
/** « novembre 2025 ». */
export const longMonth = (d: string): string =>
  `${LONG[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
/** « 1er octobre 2026 », « 18 novembre 2025 ». */
export function longDate(d: string): string {
  const day = Number(d.slice(8, 10));
  return `${day === 1 ? t("format.premier") : day} ${LONG[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
}
/** A subsidy dated by its year only shows the year. */
export const docDate = (date: string | null | undefined, yearOnly?: boolean): string =>
  yearOnly && date ? date.slice(0, 4) : shortDate(date);

/** A date plus n months (rounded), the day kept. */
export function addMonths(d: string, n: number): string {
  const [y, m] = parts(d);
  const total = y * 12 + (m - 1) + Math.round(n);
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}${d.slice(7)}`;
}

/** A signed difference: « +13 », « −3 », « ±0 ». */
export const signed = (d: number): string => (d > 0 ? `+${fr(d)}` : d < 0 ? `−${fr(-d)}` : "±0");

/** A count with its noun, singular or plural from the catalogue (`registre.n.<noun>`). */
export const count = (n: number, noun: string): string => t(`n.${noun}`, { n });

export const MONTHS_LONG = LONG;
