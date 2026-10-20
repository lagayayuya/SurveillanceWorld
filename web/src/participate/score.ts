// Points scored at the send (board 8a, « Envoyer et marquer des points »), in the punk
// interface, wherever a send means the same: « Modifier », « ＋ Ajouter », « Toujours là »
// and « Disparue ». Once the sheet has slid away (the caller's), a ticket per change falls
// on the map and lands on the one before, its points on its stub; then the total
// « +N pts » with « en attente de revue » under it; the confetti cannon in the corner
// (cannon.ts) shakes, has its string pulled and bursts; « Voir le classement » comes last.
// Each ticket wears its category's colour and word (the leaderboard's) from its first frame,
// told on the phone (profile/award.ts); a piece that earns nothing (« Je ne sais pas », « Je
// ne vois pas », a check from afar; or the server's answer gives it none) has no ticket, and
// a send that earns nothing at all has no scene: « Envoyé · en attente de revue » alone, in
// the total's place (the author's request of 2026-10-13, point 1). The numbers are the
// server's only (GET /api/me/points, the leaderboard's own function over the contributions
// just sent, asked once they have left the phone), so « +50 » now is +50 in the leaderboard
// once accepted, and its category wins where the phone's differs. Offline, a failure, or no
// answer within POINTS_TIMEOUT_MS, the tickets come without points (offline, the queued
// wording says where they are). On a wide screen they fall in the column of the sheet that
// just slid away; a stack higher than the screen gathers its added infos on one ticket.
// Nothing blocks: a touch on the map, a move of the map or Escape puts the tickets away
// (the caller is told). Under reduced motion the tickets and the total are there at once,
// nothing falls, no cannon. Its role=status line is `#modify-done`, where a send the server
// refuses is said (Participation.sayRefused): the points then go. When the API answers that
// the send will be published on OSM in its author's name (the OSM synchronisation of 16/10:
// `osm: "will_publish"`), « Sera publiée sur OSM en votre nom après relecture. » comes under
// the badge. Look: theme/punk/score.css.
import type { Map as MlMap } from "maplibre-gl";
import { cannon, motion } from "../cannon";
import { t } from "../i18n";
import { isPhone } from "../layout";
import { awardOf, type TileProps } from "../profile/award";
import { type Category, categoryClass, categoryWord } from "../profile/categories";
import { call } from "./api";
import { BANG, BOARD, bonusOf, fallTimes, LAND, type Points, pointsOf, TOTAL } from "./points";
import type { Queue } from "./queue";

export type { Points, PointsItem } from "./points";
export { cubicBezier, LAND } from "./points";

/** A change as its ticket says it: « Direction », « 27° → 300° nord-ouest ». */
export type Ticket = {
  /** The contribution's uuid: its points are the items the server gives for it. */
  uuid: string;
  what: string;
  /** What changed (« premier étage », « 27° → 300° nord-ouest »), after the leaderboard's
   * word for its category (« Correction · 27° → 300° nord-ouest »); empty when the word
   * says it all (an add: « Caméra ajoutée »). */
  value: string;
  /** The category it earns (profile/award.ts; null: none). Left out: read from the piece
   * queued under `uuid` and its camera's tile. */
  category?: Category | null;
};

/** How long the tickets wait for their numbers once asked, in ms. The API answers in tens
 * of ms (the states' harness, 2026-10-12: 5 to 90 ms through its proxy); two seconds is a
 * network in trouble, and numbers coming later would land on a scene that has told its
 * story (8a's total drops 2.1 s after the tap): the tickets stay as they fell, without
 * numbers, as offline. */
export const POINTS_TIMEOUT_MS = 2000;

/** The short confirmation of a send that earns nothing, once the sheet is gone (both of
 * .score-total's animations). */
const QUIET_DELAY = `${LAND}ms, ${LAND}ms`;

/** Room the stack leaves above it, in px (the sheet's own top margin, theme/punk/
 * participate.css #modify-panel): higher, its added infos go on one ticket. */
const TOP_ROOM = 16;
/** On a phone (score.css draws the cannon at 0.65 there): from « PTS » to the cannon's
 * mouth, its body's left edge 30 px left of the mouth once tilted; the mouth's least
 * distance to the screen's right edge. */
const PHONE_CLEAR = 34;
const PHONE_EDGE = 10;

/** Where a sheet stood: the tickets' column on a wide screen. */
export type Column = { left: number; width: number };

/** A sheet's layout box (neither its tilt nor its slide), null when it does not show. */
export function columnOf(e: HTMLElement | null): Column | null {
  if (!e || e.hidden || !e.offsetWidth) return null;
  let left = 0;
  for (let n: Element | null = e; n instanceof HTMLElement; n = n.offsetParent)
    left += n.offsetLeft;
  return { left, width: e.offsetWidth };
}

/** A camera's detail tile properties, as the editor reads them (modify.ts tileProps). */
function tileProps(map: MlMap, id: string | undefined): TileProps {
  if (!id || !map.getSource("detail")) return {};
  const f = map
    .querySourceFeatures("detail", { sourceLayer: "cameras" })
    .find((c) => String(c.properties.id) === id);
  return f?.properties ?? {};
}

/** A ticket as shown: one piece, or the added infos gathered (several uuids). */
type Shown = {
  uuids: string[];
  what: string;
  value: string;
  k: Category | null;
  el: HTMLElement;
  pts: HTMLElement;
  det: HTMLElement;
};

/** Opens the leaderboard (26a), registered by main.ts (the account's screen). */
let leaderboard: (() => void) | null = null;
export function setLeaderboardOpener(open: () => void): void {
  leaderboard = open;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls = "",
  text = "",
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

/** One scene at a time: a new send puts the last one away. */
let current: Score | null = null;

/** Whether a refused « Modifier » batch is the shown scene's (or no scene shows): only then
 * is the refusal said in its place (participate/index.ts sayRefused). */
export function sceneOf(batch: string): boolean {
  return current === null || current.batch === batch;
}

export class Score {
  private root: HTMLElement;
  private status: HTMLElement;
  private badge: HTMLElement;
  private said: HTMLElement;
  private total: HTMLElement;
  private totalN: HTMLElement;
  private board: HTMLButtonElement;
  private tickets: Shown[] = [];
  private bonus: HTMLElement | null = null;
  private ended = false;
  private undo: (() => void)[] = [];
  private points: Points | null = null;

  /** The scene for `tickets` just queued: `offline` when they stayed on the phone, `thanks`
   * the sentence said meanwhile (the existing « Merci, … envoyées / enregistrées sur ce
   * téléphone… »), `add` when the send is an add (room for its bonus). */
  constructor(
    private opts: {
      tickets: Ticket[];
      queue: Queue;
      offline: boolean;
      thanks: string;
      map: MlMap;
      add?: boolean;
      /** The « Modifier » send's batch: a refusal of another batch leaves this scene. */
      batch?: string;
      /** The sheet that slid away (wide screen: the tickets fall in its column); left out:
       * the editor's, #modify-panel, read now, before it is hidden. */
      column?: Column | null;
      onEnd: () => void;
    },
  ) {
    current?.end();
    current = this;
    const moving = motion();
    const root = el("section", "score");
    root.id = "score";
    root.setAttribute("aria-label", t("score.region"));
    if (!moving) root.classList.add("still");
    const column =
      opts.column !== undefined ? opts.column : columnOf(document.getElementById("modify-panel"));
    const col = el("div", "score-col");
    if (column && !isPhone()) {
      col.style.left = `${column.left}px`;
      col.style.width = `${column.width}px`;
    }
    const stack = el("div", "score-stack");
    stack.setAttribute("aria-hidden", "true");
    for (const tk of opts.tickets) {
      const k = tk.category !== undefined ? tk.category : this.categoryOf(tk.uuid);
      if (!k) continue;
      const shown: Shown = {
        uuids: [tk.uuid],
        what: tk.what,
        value: tk.value,
        k: null,
        ...this.ticket(tk.what),
      };
      this.paint(shown, k);
      this.tickets.push(shown);
      stack.append(shown.el);
    }
    // Nothing earned: no ticket, no total, no cannon, the short confirmation alone.
    const quiet = !this.tickets.length && !opts.add;
    if (quiet) root.classList.add("quiet");
    if (opts.add) {
      const made = this.ticket(t("score.what.bonus"), categoryWord("add", true));
      made.el.classList.add(categoryClass("add", true));
      made.el.hidden = true;
      this.bonus = made.el;
      this.bonusPts = made.pts;
      stack.append(made.el);
    }
    // The total and what it waits for, in the leaderboard's words (« +50 pts », « en
    // attente de revue »: board.pending.*); offline, the queued wording in its place, no
    // number.
    const total = el("div", "score-total");
    const row = el("div", "score-total-row");
    row.setAttribute("aria-hidden", "true");
    const n = el("span", "score-total-n");
    const unit = el("span", "score-total-pts");
    row.append(n, unit);
    this.unit = unit;
    row.hidden = true;
    this.totalN = n;
    this.total = row;
    const status = el("p", "part-done score-status");
    status.id = "modify-done";
    status.tabIndex = -1;
    status.setAttribute("role", "status");
    const said = el("span", "score-said", quiet ? "" : `${opts.thanks} `);
    const badge = el(
      "span",
      "score-badge",
      opts.offline ? opts.thanks : t(quiet ? "score.sent" : "board.pending.waiting"),
    );
    if (opts.offline) {
      said.textContent = "";
      badge.classList.add("queued");
    }
    status.append(said, badge);
    this.status = status;
    this.said = said;
    this.badge = badge;
    total.append(row, status);
    this.totalBox = total;
    if (moving)
      total.style.animationDelay = quiet ? QUIET_DELAY : `${LAND + TOTAL}ms, ${LAND + TOTAL}ms`;
    const board = el("button", "score-board");
    board.type = "button";
    const arrow = el("span", "", "→");
    arrow.setAttribute("aria-hidden", "true");
    board.append(t("score.board"), " ", arrow);
    board.hidden = opts.offline || leaderboard === null || quiet;
    board.addEventListener("click", () => {
      this.end();
      leaderboard?.();
    });
    if (moving) board.style.animationDelay = `${LAND + BOARD}ms, ${LAND + BOARD}ms`;
    this.board = board;
    col.append(stack, total, board);
    root.append(col);
    document.body.append(root);
    document.body.classList.add("scoring");
    this.root = root;
    if (this.tooHigh(col)) this.gather(stack);
    const fall = [...this.tickets.map((x) => x.el), ...(this.bonus ? [this.bonus] : [])];
    const times = fallTimes(fall.length);
    fall.forEach((e, i) => {
      e.dataset.i = String(i % 3);
      if (moving) e.style.animationDelay = `${times[i]}ms, ${times[i]}ms`;
    });
    if (moving && !quiet) {
      const gun = cannon({ in: LAND + 250, shake: LAND + TOTAL + 200, bang: LAND + BANG });
      col.append(gun);
      this.placeCannon(gun, col);
    }
    status.focus({ preventScroll: true });
    this.listen();
    // Said in place of the thanks by Participation.sayRefused: the send is gone, so are its
    // points.
    const watch = new MutationObserver(() => {
      if (!status.contains(badge)) this.refused();
    });
    watch.observe(status, { childList: true });
    this.undo.push(() => watch.disconnect());
    // The OSM synchronisation: once the API answered that a piece of this send will be
    // published on OSM in her name (POST /api/contributions `osm: "will_publish"`), a line
    // under the badge says so (in the status: said once it comes).
    const uuids = opts.tickets.map((x) => x.uuid);
    const osm = () => {
      if (this.ended || status.querySelector(".score-osm") || !status.contains(badge)) return;
      status.append(" ", el("span", "score-osm", t("score.osm")));
      this.placeGun();
    };
    if (uuids.some((u) => opts.queue.publishes(u))) osm();
    else
      this.undo.push(
        opts.queue.onPublishes((u) => {
          if (uuids.includes(u)) osm();
        }),
      );
    if (!opts.offline && !quiet) void this.fetchPoints();
  }

  private totalBox: HTMLElement | null = null;
  private bonusPts: HTMLElement | null = null;
  private unit: HTMLElement | null = null;

  /** 8a's ticket: its stub (the points, filled once known), a dashed tear, what and how. */
  private ticket(what: string, det = ""): { el: HTMLElement; pts: HTMLElement; det: HTMLElement } {
    const outer = el("div", "score-ticket");
    const paper = el("div", "score-ticket-paper");
    const pts = el("div", "score-ticket-pts");
    const body = el("div", "score-ticket-body");
    const d = el("span", "score-ticket-det", det);
    body.append(el("span", "score-ticket-what", what), d);
    paper.append(pts, body);
    outer.append(paper);
    return { el: outer, pts, det: d };
  }

  /** A ticket in its category's colour, its line after the category's word (« Correction ·
   * 27° → 300° nord-ouest »; the added infos gathered: « 5 infos ajoutées »); none: white,
   * its value alone. */
  private paint(x: Shown, k: Category | null): void {
    if (x.k) x.el.classList.remove(categoryClass(x.k));
    if (k) x.el.classList.add(categoryClass(k));
    x.k = k;
    x.det.textContent =
      x.uuids.length > 1
        ? t("score.det.infos", { n: x.uuids.length })
        : !k
          ? x.value
          : x.value
            ? t("score.det.k", { k: categoryWord(k), v: x.value })
            : categoryWord(k);
  }

  /** The category of the piece queued under `uuid` (it is queued before the scene). */
  private categoryOf(uuid: string): Category | null {
    const body = this.opts.queue.items.find((i) => i.uuid === uuid)?.body;
    return body ? awardOf(body, tileProps(this.opts.map, body.camera)) : null;
  }

  /** Whether the column, once its total and its bonus are in, rises above TOP_ROOM. */
  private tooHigh(col: HTMLElement): boolean {
    const row = this.total;
    const bonus = this.bonus;
    row.hidden = false;
    this.totalN.textContent = "+00";
    if (this.unit) this.unit.textContent = t("board.pending.unit", { n: 2 });
    if (bonus) bonus.hidden = false;
    const top = col.getBoundingClientRect().top;
    row.hidden = true;
    this.totalN.textContent = "";
    if (this.unit) this.unit.textContent = "";
    if (bonus) bonus.hidden = true;
    return top < TOP_ROOM;
  }

  /** The added infos on one ticket, where the first of them was (« Fiche », « 5 infos
   * ajoutées »). */
  private gather(stack: HTMLElement): void {
    const infos = this.tickets.filter((x) => x.k === "info");
    if (infos.length < 2) return;
    const what = t("score.what.infos");
    const one: Shown = {
      uuids: infos.flatMap((x) => x.uuids),
      what,
      value: "",
      k: null,
      ...this.ticket(what),
    };
    this.paint(one, "info");
    stack.insertBefore(one.el, infos[0].el);
    for (const x of infos) x.el.remove();
    const at = this.tickets.indexOf(infos[0]);
    this.tickets = this.tickets.filter((x) => !infos.includes(x));
    this.tickets.splice(at, 0, one);
  }

  /** The cannon beside the total, clear of « PTS » (8a draws it over a long total): its
   * mouth 8a's 302 px from the column's left (324 on a 390 px phone), further right when
   * the total is wider, 28 px under the total's top; without a total (no points), beside
   * the last ticket; never over « Voir le classement ». On a phone the total is centred
   * (score.css): no room beside it, the cannon is drawn smaller and its mouth goes up to
   * the screen's edge, its body partly beyond it, still clear of « PTS ». */
  private placeCannon(gun: HTMLElement, col: HTMLElement): void {
    const place = () => {
      const row = this.total;
      const total = row.parentElement as HTMLElement;
      const stack = col.querySelector<HTMLElement>(".score-stack");
      const pts = row.querySelector<HTMLElement>(".score-total-pts");
      // In the column's frame, whichever ancestor is the offset parent (a tilted total is
      // one in WebKit).
      let right = 0;
      if (pts && !row.hidden) {
        right = pts.offsetWidth;
        for (let n: Element | null = pts; n instanceof HTMLElement && n !== col; n = n.offsetParent)
          right += n.offsetLeft;
      }
      const phone = isPhone();
      const x = Math.min(
        Math.max(302, right + (phone ? PHONE_CLEAR : 72)),
        phone ? window.innerWidth - col.offsetLeft - PHONE_EDGE : col.clientWidth - 30,
      );
      let y =
        row.hidden && stack ? stack.offsetTop + stack.offsetHeight - 40 : total.offsetTop + 28;
      // The cannon reaches 130 px under its mouth (its string's ring).
      if (!this.board.hidden) y = Math.min(y, this.board.offsetTop - 140);
      gun.style.left = `${x}px`;
      gun.style.top = `${y}px`;
    };
    place();
    this.placeGun = place;
  }

  private placeGun: () => void = () => {};

  /** A touch or a move on the map, Escape: the tickets put away. */
  private listen(): void {
    const map = this.opts.map;
    const down = () => this.end();
    const moved = (e: { originalEvent?: Event }) => {
      if (e.originalEvent) this.end();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") this.end();
    };
    const canvas = map.getCanvasContainer();
    canvas.addEventListener("pointerdown", down);
    map.on("movestart", moved);
    document.addEventListener("keydown", key);
    this.undo.push(() => {
      canvas.removeEventListener("pointerdown", down);
      map.off("movestart", moved);
      document.removeEventListener("keydown", key);
    });
  }

  /** The points of what left the phone: the server's, per contribution, and their sum. */
  private async fetchPoints(): Promise<void> {
    const uuids = this.tickets.flatMap((x) => x.uuids);
    try {
      await this.opts.queue.flush("points");
    } catch {
      return;
    }
    // A flush already running when they were queued may have left them out: once more.
    if (uuids.some((u) => this.opts.queue.items.some((i) => i.uuid === u)))
      await this.opts.queue.flush("points").catch(() => undefined);
    const left = uuids.filter((u) => !this.opts.queue.items.some((i) => i.uuid === u));
    // The session expired meanwhile: the pieces wait on the phone for a login, not for the
    // review — said as the counter says it, no points.
    if (!this.ended && left.length < uuids.length && this.opts.queue.needsLogin) {
      this.badge.textContent = t("account.queue.relogin", { n: uuids.length - left.length });
      this.badge.classList.add("queued");
      this.board.hidden = true;
    }
    if (this.ended || !left.length) return;
    let points: Points;
    const stop = new AbortController();
    const timer = window.setTimeout(() => stop.abort(), POINTS_TIMEOUT_MS);
    this.undo.push(() => stop.abort());
    try {
      points = await call<Points>(
        "GET",
        `/api/me/points?${left.map((u) => `uuid=${encodeURIComponent(u)}`).join("&")}`,
        undefined,
        stop.signal,
      );
    } catch {
      return; // offline, signed out, a failure, too late: the tickets stay without points
    } finally {
      clearTimeout(timer);
    }
    if (this.ended || !this.status.contains(this.badge)) return;
    this.show(points);
  }

  /** The server's numbers on the tickets, the bonus, the total. */
  show(points: Points): void {
    this.points = points;
    const said: string[] = [];
    // A piece the server gives nothing (sent again within its month: leaderboard.py
    // awards()) loses its ticket; nothing earned at all, the short confirmation alone.
    const none = this.tickets.filter(
      (x) => !x.uuids.some((u) => (pointsOf(points, u)?.points ?? 0) > 0),
    );
    for (const x of none) x.el.remove();
    this.tickets = this.tickets.filter((x) => !none.includes(x));
    if (!this.tickets.length && !(this.bonus && bonusOf(points) > 0)) {
      this.hush();
      return;
    }
    for (const x of this.tickets) {
      const got = x.uuids.map((u) => pointsOf(points, u)).filter((g) => g !== null && g.points > 0);
      const n = got.reduce((s, g) => s + (g?.points ?? 0), 0);
      // The server's category where the phone's differs (rare: profile/award.ts); the
      // gathered infos stay infos.
      const k = x.uuids.length > 1 ? "info" : (got[0]?.category as Category);
      if (k !== x.k) this.paint(x, k);
      x.pts.textContent = n > 0 ? `+${n}` : "";
      const det = x.det.textContent ?? "";
      said.push(
        n > 0
          ? t("score.said.ticket_pts", { what: x.what, det, n })
          : t("score.said.ticket", { what: x.what, det }),
      );
    }
    const bonus = bonusOf(points);
    if (this.bonus && this.bonusPts && bonus > 0) {
      this.bonus.hidden = false;
      this.bonusPts.textContent = `+${bonus}`;
      said.push(
        t("score.said.ticket_pts", {
          what: t("score.what.bonus"),
          det: categoryWord("add", true),
          n: bonus,
        }),
      );
    }
    if (points.items.length && points.total > 0) {
      this.totalN.textContent = `+${points.total}`;
      if (this.unit) this.unit.textContent = t("board.pending.unit", { n: points.total });
      this.total.hidden = false;
      said.push(t("score.said.total", { n: points.total }));
    }
    this.said.textContent = `${this.opts.thanks} ${said.join(" ")} `;
    this.placeGun();
  }

  /** Nothing earned after all: the tickets, the cannon and « Voir le classement » gone, the
   * status the short confirmation (said again: it changes). */
  private hush(): void {
    for (const x of this.tickets) x.el.remove();
    this.tickets = [];
    this.bonus?.remove();
    this.bonus = null;
    this.root.querySelector(".cannon")?.remove();
    this.root.classList.add("quiet");
    this.total.hidden = true;
    this.board.hidden = true;
    this.said.textContent = "";
    this.badge.textContent = t("score.sent");
    if (this.totalBox && motion()) this.totalBox.style.animationDelay = QUIET_DELAY;
  }

  /** The send refused by the server (its pieces withdrawn): no points left to show. */
  private refused(): void {
    this.total.hidden = true;
    for (const { pts } of this.tickets) pts.textContent = "";
    if (this.bonus) this.bonus.hidden = true;
    this.board.hidden = true;
    this.placeGun();
  }

  /** The tickets put away (once); the caller's `onEnd`. */
  end(): void {
    if (this.ended) return;
    this.ended = true;
    if (current === this) current = null;
    for (const u of this.undo.splice(0)) u();
    this.root.remove();
    if (!current) document.body.classList.remove("scoring");
    this.opts.onEnd();
  }

  get batch(): string | undefined {
    return this.opts.batch;
  }

  get shown(): Points | null {
    return this.points;
  }
}
