// The leaderboard's categories (26a's legend) as every screen says and colours them: the
// account's leaderboard (its dots, bars and scale) and the send's tickets (8a,
// participate/score.ts) read the same words (fr.json board.count.*, board.scale.*) and the
// same tokens (theme/punk/tokens.css --k-*, through the k-<category> classes).
import { t } from "../i18n";

/** A category of points (rules/leaderboard.yaml, GET /api/me/points' `category`). */
export type Category = "add" | "info" | "correction" | "verification";

/** The legend's word for one award: « Caméra ajoutée », « Info ajoutée », « Correction »,
 * « Vérification », or the scale's « Bonus caméra complète » for an add's bonus. */
export function categoryWord(category: Category, bonus = false): string {
  return bonus ? t("board.scale.bonus.title") : t(`board.count.one.${category}`);
}

/** The class that gives an element its category's colours (k-add … k-bonus). */
export function categoryClass(category: Category, bonus = false): string {
  return `k-${bonus ? "bonus" : category}`;
}

/** « +90 pts en attente de revue »: the number, its unit and what it waits for. */
export function pending(n: number): string {
  return `+${n} ${t("board.pending.unit", { n })} ${t("board.pending.waiting")}`;
}
