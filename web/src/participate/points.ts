// The numbers and times of the points scored at the send (board 8a; participate/score.ts
// draws them): what the server gave for each piece sent (GET /api/me/points, the contract
// of the lot of 2026-10-11), when each ticket falls, and 8a's spring for what the map draws
// frame by frame. No points are computed here: they are the server's, only added up per
// piece. Pure, for tests/score.test.ts.

/** GET /api/me/points (the contract of the lot of 2026-10-11). */
export type PointsItem = {
  uuid: string;
  kind: string;
  category: "add" | "info" | "correction" | "verification";
  points: number;
  bonus: boolean;
  accepted: boolean;
};
export type Points = { items: PointsItem[]; total: number };

/** 8a's times, in ms from the tap on « Envoyer »: the sheet gone (LAND), then from there
 * as 8a counts them: the tickets 330 ms apart (three at most; more share the same second),
 * the total, the cannon swung in, shaken, burst, « Voir le classement ». */
export const LAND = 400;
export const FIRST = 650;
export const SPREAD = 990;
export const TOTAL = 1700;
export const BANG = 2350;
export const BOARD = BANG + 900;
/** When the last of 8a's motions ends (the slowest confetti), from the tap. */
export const SCENE_MS = LAND + BANG + 2400;

/** When each of `n` tickets starts to fall. */
export function fallTimes(n: number): number[] {
  const step = n <= 3 ? 330 : SPREAD / (n - 1);
  return Array.from({ length: n }, (_, i) => Math.round(LAND + FIRST + i * step));
}

/** CSS's cubic-bezier(x1, y1, x2, y2) as a function of the time's fraction (8a's spring
 * overshoots: y1 > 1), for what the map draws frame by frame. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (x: number) => number {
  const at = (a: number, b: number, u: number) =>
    3 * a * u * (1 - u) ** 2 + 3 * b * u * u * (1 - u) + u ** 3;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (at(x1, x2, mid) < x) lo = mid;
      else hi = mid;
    }
    return at(y1, y2, (lo + hi) / 2);
  };
}

/** The items the server gave for a ticket's uuid, the add's bonus apart. */
export function pointsOf(
  points: Points,
  uuid: string,
): { points: number; category: string } | null {
  const own = points.items.filter((i) => i.uuid === uuid && !i.bonus);
  if (!own.length) return null;
  return { points: own.reduce((s, i) => s + i.points, 0), category: own[0].category };
}

/** The bonus of an add (« toutes les infos »), when the server gave one. */
export function bonusOf(points: Points): number {
  return points.items.filter((i) => i.bonus).reduce((s, i) => s + i.points, 0);
}
