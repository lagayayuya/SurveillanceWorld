// What the account's screen (profile/leaderboard.ts: board 26a, and only it) is opened with
// by the account square (account/index.ts).
import type { Why } from "../account/osm";
import type { Me } from "./api";

export type ProfileContext = {
  /** The sheet panel (#sheet): the screen is drawn into it in place of the camera sheet. */
  sheet: HTMLElement;
  /** Show the panel once the screen is in it. */
  show: () => void;
  /** Close the panel (main.ts closeSheet). */
  close: () => void;
  /** A phone's handle: the next height (main.ts sheetPanel.step). */
  grab: () => void;
  /** GET /api/me's answer (its `leaderboard` follows the switch). */
  me: Me;
  /** « Se déconnecter » or « Supprimer mon compte » done: the page as signed out (the
   * account square, the participation). The sheet is closed already. */
  signedOut: () => void;
  /** A line said at the top (role status) where the person lands back from OpenStreetMap
   * (account/index.ts land); the focus then goes to the title. */
  notice?: string;
  /** Under `?debug=1`, the server's reason for a failed return (`?osm_why=`, the lot of
   * 2026-10-11): a short line under the notice. */
  why?: Why | null;
  /** « Mes caméras » (lot U): a camera's sheet in this panel in place of the screen (the
   * map's camera, else a pending add), the map brought to `at` first when its tile is not
   * loaded; false when it cannot be found. Absent: no camera opens from the screen. */
  openCamera?: (id: string, at: [number, number] | null) => Promise<boolean>;
};

/** The previous version's profile kept a month and two counts per account on the phone
 * (« Depuis votre visite »): gone with it, they are removed at sign-out. */
export function forgetVisit(pseudonym: string): void {
  try {
    localStorage.removeItem(`lacarte.profile.visit.${pseudonym}`);
  } catch {}
}
