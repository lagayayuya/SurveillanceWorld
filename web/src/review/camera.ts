// /revue's camera view (board P2): its own address (?camera=<id>, the queue's filter and
// search kept), its label as title, the small map, the signals, the author and their
// record, and what to decide: the oldest waiting send (a « Modifier » send, an add with its
// author's answers, or one contribution) as a « Sur la carte | Proposé » table of the
// fields it touches, its notes, the operator name's choice, its destination. A fixed bar
// decides it in one tap (Rejeter · Valider; « Valider ce qui est fait sur place (N) » when
// it does more than Valider); « Annuler » for 8 s after a decision taken from `pending`;
// then the same camera's next send, else the queue's next camera, else the queue (« File
// vide »). « Détails »: the id with a copy button, OpenStreetMap's version, tags and
// history, the decisions with « Changer la décision » (two steps), the withdrawn ones.
import { t } from "../i18n";
import { call } from "../participate/api";
import { twoStep } from "../participate/decide";
import { fold } from "../participate/questions";
import { type Hidden, onMap } from "./hidden";
import type { ReviewMap } from "./map";
import {
  answerWord,
  authorText,
  blank,
  type CameraAnswer,
  conflictBox,
  dayText,
  degrees,
  destinationLine,
  el,
  fieldName,
  fieldOrder,
  historyLink,
  inFootprint,
  kindWord,
  labelText,
  nameWaits,
  operatorWord,
  placementOf,
  proposedText,
  type Row,
  type Served,
  statusText,
  tagList,
  unknownFor,
} from "./rows";
import { errorText, fail, say, toast } from "./say";

export type CameraNav = {
  href(params: Record<string, string>): string;
  /** Back to the queue: the history's entry when the view came from it. */
  back(): void;
  /** The next camera to decide after `camera`, or the queue with its note. */
  next(camera: string): Promise<void>;
  openCamera(camera: string, how: "push" | "replace"): void;
  /** An administrator: « Masquer cette caméra » (lot 2). */
  admin(): boolean;
  /** « Retraits »'s address, where a hidden camera is shown again. */
  hiddenHref(): string;
  fail(e: unknown): void;
};

/** What one decision is about: a « Modifier » send, an add with its author's answers, or
 * one contribution. `open`: it waits (`pending`) or a build put it in conflict. */
type Unit = {
  kind: "send" | "add" | "single";
  rows: Row[];
  head: Row;
  open: "pending" | "conflict" | null;
};

type Choice = { choice: "proposed" | "listed" | "none"; name?: string };
type Listed = { name: string; class: "public" | "business" };
/** Names of the list shown at once under the reviewer's search. */
const MATCHES = 8;

const isOpen = (r: Row) => r.status === "pending" || r.status === "conflict";

function unitsOf(rows: Row[]): Unit[] {
  const live = rows.filter((r) => r.status !== "withdrawn" && !blank(r));
  const units: Unit[] = [];
  const sends = new Map<string, Row[]>();
  const taken = new Set<string>();
  for (const r of live)
    if (r.batch) {
      sends.set(r.batch, [...(sends.get(r.batch) ?? []), r]);
      taken.add(r.uuid);
    }
  for (const rs of sends.values()) units.push(unit("send", rs));
  for (const add of live.filter((r) => r.kind === "add")) {
    // Its author's answers go with it; once the add is decided, an answer still open is
    // decided alone (one decide on the add would no longer reach it).
    const answers = live.filter(
      (r) =>
        r.target === add.uuid &&
        r.author === add.author &&
        !taken.has(r.uuid) &&
        (isOpen(add) || !isOpen(r)),
    );
    for (const r of [add, ...answers]) taken.add(r.uuid);
    units.push(unit("add", [add, ...answers]));
  }
  for (const r of live) if (!taken.has(r.uuid)) units.push(unit("single", [r]));
  const first = (u: Unit) => u.rows.reduce((d, r) => (r.day < d ? r.day : d), u.head.day);
  return units.sort(
    (a, b) => first(a).localeCompare(first(b)) || a.head.uuid.localeCompare(b.head.uuid),
  );
}
function unit(kind: Unit["kind"], rows: Row[]): Unit {
  const sorted = [...rows].sort((a, b) => fieldOrder(a.kind) - fieldOrder(b.kind));
  const open = sorted.some((r) => r.status === "pending")
    ? "pending"
    : sorted.some((r) => r.status === "conflict")
      ? "conflict"
      : null;
  return { kind, rows: sorted, head: sorted[0], open };
}
/** The send the view decides: the oldest waiting, else the oldest in conflict. */
const currentOf = (units: Unit[]) =>
  units.find((u) => u.open === "pending") ?? units.find((u) => u.open === "conflict") ?? null;

/** A unit's title: « Modification · 3 changements », « Ajout », « Direction ». */
function unitTitle(u: Unit): string {
  if (u.kind === "send") return t("review.send.title", { n: u.rows.length });
  return fieldName(u.head.kind);
}

// --- « Sur la carte » and « Proposé » -----------------------------------------------------

const source = (certainty: string) => t(`review.certainty.${certainty}`);

/** What the map shows of the field `r` is about, with where it comes from. */
function nowCell(r: Row, s: Served | null): string {
  if (!s) return t("review.now.absent");
  switch (r.kind) {
    case "move":
    case "verify":
      // Where OpenStreetMap has it now: no certainty beside it (geom_certainty is the drawn
      // field's — direction, angle, range — never the position's).
      return s.position_source === "contribution"
        ? t("review.now.position.contribution")
        : t("review.now.position.osm");
    case "shape":
      return s.kind_certainty === "default"
        ? `${unknownFor("shape")} (${source("default")})`
        : `${kindWord(s.kind)} (${source(s.kind_certainty)})`;
    case "direction":
      return s.direction_certainty === "default" || !s.directions.length
        ? `${unknownFor("direction")} (${source("default")})`
        : `${s.directions.map((d) => degrees(d)).join(", ")} (${source(s.direction_certainty)})`;
    case "height":
      return `${t("review.metres", { v: s.height_m })} (${source(s.height_certainty)})`;
    case "tilt":
      return s.tilt ? t(`chip.value.tilt.${s.tilt}`) : unknownFor("tilt");
    case "operator":
      return operatorWord(s.operator_class, s.operator);
    default:
      return t("review.now.absent");
  }
}

/** What `r` proposes. */
function proposedCell(r: Row): string {
  const p = r.payload;
  if (r.kind === "add" || r.kind === "move") {
    const how = [
      t(`review.placement.${placementOf(p) ?? "free"}`),
      ...(p.pulled ? [t("review.pulled")] : []),
      ...(inFootprint(p) ? [t("review.in_footprint")] : []),
    ].join(", ");
    return r.kind === "add"
      ? how
      : t("review.proposed.move", { m: Math.round(p.move_m ?? 0), how });
  }
  return answerWord({ ...r, move_m: p.move_m });
}

function diffTable(u: Unit, s: Served | null): HTMLTableElement {
  const table = el("table", "", "review-diff");
  table.append(el("caption", t("review.table.caption"), "review-sr"));
  const head = el("tr");
  for (const k of ["field", "now", "proposed"]) {
    const th = el("th", t(`review.col.${k}`));
    th.scope = "col";
    head.append(th);
  }
  const thead = el("thead");
  thead.append(head);
  const body = el("tbody");
  for (const r of u.rows) {
    const tr = el("tr");
    tr.dataset.uuid = r.uuid;
    const th = el("th", fieldName(r.kind === "add" ? "position" : r.kind));
    th.scope = "row";
    const status = isOpen(r) || u.rows.every((o) => o.status === r.status) ? "" : statusText(r);
    tr.append(
      th,
      el("td", r.kind === "add" ? t("review.now.absent") : nowCell(r, s)),
      el("td", status ? `${proposedCell(r)} · ${status}` : proposedCell(r), "review-new"),
    );
    body.append(tr);
  }
  table.append(thead, body);
  return table;
}

/** Under the table: the cameras near an add, an answer with no effect, a conflict. */
function notes(u: Unit, w: CameraAnswer): HTMLElement[] {
  const out: HTMLElement[] = [];
  const add = u.rows.find((r) => r.kind === "add");
  if (add) {
    const near = add.near ?? [];
    if (!near.length) out.push(el("p", t("review.near.none"), "review-note"));
    for (const n of near)
      out.push(
        el(
          "p",
          n.pending
            ? t("review.near.pending", { m: n.m })
            : t("review.near.built", { m: n.m, kind: kindWord(n.kind) }),
          "review-note",
        ),
      );
  }
  for (const r of u.rows) {
    if (r.apply_detail?.reason === "no_height")
      out.push(el("p", t("review.reason.no_height"), "review-note"));
    else if (r.payload?.no_effect)
      out.push(el("p", t(`review.no_effect.${r.payload.no_effect}`), "review-note"));
    if (r.status === "conflict") out.push(conflictBox(r));
    const named = !nameWaits(r) || !isOpen(r) ? proposedText(r) : null;
    if (named) out.push(el("p", named, "review-note"));
  }
  if (!w.served && !add) out.push(el("p", t("review.cam.gone"), "review-note"));
  return out;
}

/** The destination of a unit: one line when its pieces agree, else one per piece. */
function destinations(u: Unit): HTMLElement[] {
  const keys = new Set(u.rows.map((r) => JSON.stringify(r.destination ?? { where: "sw" })));
  if (keys.size === 1) return [destinationLine(u.head.destination)];
  return u.rows.map((r) => {
    const line = destinationLine(r.destination);
    line.prepend(`${fieldName(r.kind)} · `);
    return line;
  });
}

// --- the operator name's choice -------------------------------------------------------------

/** The choice a proposed operator name needs before « Valider »: as typed, a listed name of
 * the answer's class (searched as the editor searches, folded), or no name. */
function chooser(
  piece: Row,
  names: () => Promise<Listed[]>,
): { box: HTMLFieldSetElement; get(): Choice | null } {
  let choice: Choice["choice"] | null = null;
  let picked: string | null = null;
  const box = el("fieldset", "", "review-choice");
  box.id = "review-choice";
  box.tabIndex = -1;
  box.append(
    el("legend", t("review.operator.choose", { name: piece.operator_proposed ?? "" })),
    el("p", t("review.operator.choose_hint"), "review-muted"),
  );
  const search = el("input", "", "review-search");
  search.type = "search";
  search.placeholder = t("review.operator.search");
  search.setAttribute("aria-label", t("review.operator.search"));
  const matches = el("ul", "", "review-matches");
  const pickedLine = el("p", "", "review-muted");
  pickedLine.setAttribute("aria-live", "polite");
  const ready = () => {
    search.hidden = matches.hidden = pickedLine.hidden = choice !== "listed";
  };
  const show = async () => {
    const q = fold(search.value);
    const all = (await names()).filter((e) => e.class === piece.answer);
    const hits = all.filter((e) => fold(e.name).includes(q)).slice(0, MATCHES);
    matches.replaceChildren(
      ...hits.map((e) => {
        const b = el("button", e.name, "review-button small");
        b.type = "button";
        b.setAttribute("aria-pressed", String(picked === e.name));
        b.addEventListener("click", () => {
          picked = e.name;
          pickedLine.textContent = t("review.operator.picked", { name: e.name });
          for (const o of matches.querySelectorAll("button"))
            o.setAttribute("aria-pressed", String(o === b));
        });
        const li = el("li");
        li.append(b);
        return li;
      }),
    );
    if (!hits.length) matches.append(el("li", t("review.operator.no_match"), "review-muted"));
  };
  search.addEventListener("input", () => void show());
  const options: [Choice["choice"], string][] = [
    ["proposed", t("review.operator.as_is")],
    ["listed", t("review.operator.listed")],
    [
      "none",
      t("review.operator.none", {
        answer: t(`part.complete.operator.${piece.answer}`).toLocaleLowerCase("fr"),
      }),
    ],
  ];
  for (const [value, text] of options) {
    const label = el("label", "", "review-radio");
    const input = el("input");
    input.type = "radio";
    input.name = `op-${piece.uuid}`;
    input.value = value;
    input.addEventListener("change", () => {
      choice = value;
      ready();
      if (value === "listed") void show();
    });
    label.append(input, el("span", text));
    box.append(label);
    if (value === "listed") box.append(search, matches, pickedLine);
  }
  ready();
  return {
    box,
    get: () =>
      choice === null || (choice === "listed" && !picked)
        ? null
        : choice === "listed"
          ? { choice, name: picked as string }
          : { choice },
  };
}

// --- deciding -------------------------------------------------------------------------------

type Decision = "validated" | "rejected";

/** Decide a unit in one call: a send (the API decides it whole), an add (validated with its
 * author's waiting answers, rejected with every answer on it, in one transaction), or one
 * contribution; the choice for a proposed name goes with it. Returns what changed (the
 * API's `decided`), which « Annuler » puts back. */
async function decideUnit(u: Unit, decision: Decision, op: Choice | null): Promise<string[]> {
  const named = u.rows.some((r) => nameWaits(r) && isOpen(r));
  const r = await call<{ decided?: string[] }>("POST", "/api/review/decide", {
    uuid: u.head.uuid,
    decision,
    ...(named && op && decision === "validated" ? { operator: op } : {}),
  });
  return r.decided ?? u.rows.filter(isOpen).map((x) => x.uuid);
}

// --- the view -----------------------------------------------------------------------------

export class CameraView {
  private listed: Promise<Listed[]> | null = null;
  private listedFor: string | null = null;
  private footSeen: ResizeObserver | null = null;

  constructor(
    private app: HTMLElement,
    private map: ReviewMap,
    private nav: CameraNav,
  ) {}

  private names(camera: string): Promise<Listed[]> {
    if (this.listedFor !== camera) {
      this.listedFor = camera;
      this.listed = call<{ all: Listed[] }>("POST", "/api/operators", { camera })
        .then((r) => r.all)
        .catch(() => []);
    }
    return this.listed as Promise<Listed[]>;
  }

  /** The camera's answer and, for an administrator, whether it is hidden (GET
   * /api/review/hidden: the camera's answer does not say). */
  private async fetch(camera: string): Promise<[CameraAnswer, Hidden | null]> {
    const [w, hidden] = await Promise.all([
      call<CameraAnswer>("GET", `/api/review/camera?camera=${encodeURIComponent(camera)}`),
      this.nav.admin()
        ? call<Hidden[]>("GET", "/api/review/hidden").catch(() => [] as Hidden[])
        : Promise.resolve([] as Hidden[]),
    ]);
    return [w, hidden.find((h) => h.camera === camera) ?? null];
  }

  async show(camera: string, focus: "title" | string = "title"): Promise<void> {
    let w: CameraAnswer;
    let hidden: Hidden | null;
    try {
      [w, hidden] = await this.fetch(camera);
    } catch (e) {
      this.nav.fail(e);
      return;
    }
    this.render(w, hidden, focus);
  }

  private render(w: CameraAnswer, hidden: Hidden | null, focus: string): void {
    // An answer that arrives after the reviewer left this camera (back to the queue,
    // another camera) draws nothing over the view now shown.
    if (new URLSearchParams(window.location.search).get("camera") !== w.camera) return;
    const units = unitsOf(w.contributions);
    const current = currentOf(units);
    const others = units.filter((u) => u !== current && u.open === "pending");
    const decided = units.filter((u) => u !== current && u.open !== "pending");

    // The bar above the page's head: back to the queue, the label as title.
    const top = el("header", "", "review-top review-top-camera");
    const back = el("a", t("review.back"), "review-back");
    back.href = this.nav.href({});
    back.setAttribute("aria-label", t("review.back.label"));
    back.addEventListener("click", (e) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      this.nav.back();
    });
    const h1 = el("h1", labelText(w.label));
    h1.tabIndex = -1;
    top.append(back, h1);

    const main = el("main", "", "review-main review-camera");
    main.id = "review-camera";
    main.dataset.camera = w.camera;
    const cols = el("div", "", "review-cols");
    const info = el("div", "", "review-info");
    cols.append(this.map.box, info);
    main.append(cols);
    this.map.draw(w, current?.rows ?? units.flatMap((u) => u.rows).filter(isOpen));

    let choose: ReturnType<typeof chooser> | null = null;
    if (current) {
      const rows = current.rows;
      // Signals and who: of the send decided.
      const signals = el("p", "", "review-signals");
      const onSite = rows.some((r) => r.on_site === true)
        ? true
        : rows.some((r) => r.on_site === false)
          ? false
          : null;
      if (onSite === true) signals.append(el("span", t("review.signal.on_site"), "review-ok"));
      else if (onSite === false) signals.append(el("span", t("review.signal.off_site")));
      const confirmed = Math.max(0, ...rows.map((r) => r.confirmed ?? 0));
      if (confirmed)
        signals.append(
          el("span", t("review.signal.confirmed_on_site", { n: confirmed }), "review-ok"),
        );
      if (current.open === "conflict")
        signals.append(el("span", t("review.signal.conflict"), "review-tag warn"));
      if (rows.some((r) => nameWaits(r) && isOpen(r)))
        signals.append(el("span", t("review.signal.names"), "review-tag"));
      if (rows.some((r) => r.test))
        signals.append(el("span", t("review.signal.test"), "review-tag"));
      if (hidden) signals.append(el("span", t("review.signal.hidden"), "review-tag"));
      const who = el("p", "", "review-author");
      who.append(
        authorText(current.head.author, current.head.author_record ?? { accepted: 0, rejected: 0 }),
        " ",
        el("span", t("review.cam.received", { day: dayText(current.head.day) }), "review-muted"),
      );
      const section = el("section", "", "review-decide");
      section.setAttribute("aria-labelledby", "review-decide-title");
      const h2 = el("h2", t("review.cam.decide", { what: unitTitle(current) }));
      h2.id = "review-decide-title";
      section.append(h2, diffTable(current, w.served), ...notes(current, w));
      const waiting = rows.find((r) => nameWaits(r) && isOpen(r));
      if (waiting) {
        choose = chooser(waiting, () => this.names(w.camera));
        section.append(choose.box);
      }
      section.append(...destinations(current));
      info.append(...(signals.childElementCount ? [signals] : []), who, section);
    } else {
      const section = el("section", "", "review-decide");
      const h2 = el("h2", t("review.cam.nothing"));
      section.append(h2);
      info.append(section);
    }

    if (others.length) {
      const section = el("section", "", "review-others");
      const h2 = el("h2", t("review.cam.others", { n: others.length }));
      const ul = el("ul", "", "review-units");
      for (const u of others) {
        const li = el("li");
        li.dataset.uuid = u.head.uuid;
        li.append(
          ...(u.kind === "single" ? [] : [el("strong", unitTitle(u)), " · "]),
          `${u.rows.map((r) => `${fieldName(r.kind === "add" ? "position" : r.kind)} : ${proposedCell(r)}`).join(" · ")}`,
          el(
            "span",
            ` · ${authorText(u.head.author, u.head.author_record ?? { accepted: 0, rejected: 0 })} · ${dayText(u.head.day)}`,
            "review-muted",
          ),
        );
        ul.append(li);
      }
      section.append(h2, el("p", t("review.cam.others_hint"), "review-muted"), ul);
      info.append(section);
    }
    info.append(this.details(w, decided, current === null));
    if (this.nav.admin()) info.append(this.retreat(w.camera, hidden));

    // The decision bar, then the toast (the page's order: Tab reaches « Annuler » next).
    const bar = el("div", "", "review-bar");
    bar.setAttribute("role", "group");
    bar.setAttribute("aria-label", t("review.bar.label"));
    const error = el("p", "", "review-error");
    error.hidden = true;
    if (current) bar.append(...this.actions(w, units, current, choose, error));
    else {
      const next = el("button", t("review.bar.next"), "review-button");
      next.type = "button";
      next.dataset.action = "next";
      next.addEventListener("click", () => void this.nav.next(w.camera));
      bar.append(next);
    }
    const foot = el("div", "", "review-foot");
    foot.append(error, bar);
    // The page ends the bar's height above the bottom (review.css --foot-h).
    this.footSeen?.disconnect();
    this.footSeen = new ResizeObserver(() =>
      document.documentElement.style.setProperty("--foot-h", `${foot.offsetHeight}px`),
    );
    this.footSeen.observe(foot);
    this.app.replaceChildren(top, main, foot);
    const again =
      focus !== "title" ? bar.querySelector<HTMLElement>(`[data-action="${focus}"]`) : null;
    if (again) again.focus();
    else {
      window.scrollTo(0, 0);
      h1.focus({ preventScroll: true });
    }
  }

  /** Rejeter · Valider, and « Valider ce qui est fait sur place (N) » when it does more. */
  private actions(
    w: CameraAnswer,
    units: Unit[],
    current: Unit,
    choose: ReturnType<typeof chooser> | null,
    error: HTMLElement,
  ): HTMLButtonElement[] {
    const buttons: HTMLButtonElement[] = [];
    const busy = (on: boolean) => {
      for (const b of buttons) b.setAttribute("aria-disabled", String(on));
    };
    let running = false;
    const run = async (act: () => Promise<void>) => {
      if (running) return;
      running = true;
      busy(true);
      error.hidden = true;
      try {
        await act();
      } catch (e) {
        fail(errorText(e), error);
      } finally {
        running = false;
        busy(false);
      }
    };
    const decide = (decision: Decision) => async () => {
      const op = choose?.get() ?? null;
      if (decision === "validated" && choose && !op) {
        fail(t("review.operator.needed"), error);
        choose.box.focus();
        return;
      }
      const fromPending = current.open === "pending";
      const done = await decideUnit(current, decision, op);
      await this.decided(w.camera, done, decision, fromPending);
    };
    // A choice made: what was said of it is no longer true.
    choose?.box.addEventListener("change", () => {
      error.hidden = true;
    });
    choose?.box.addEventListener("click", () => {
      if (choose?.get()) error.hidden = true;
    });
    const reject = el("button", t("decide.reject"), "review-button");
    reject.dataset.action = "rejected";
    reject.addEventListener("click", () => void run(decide("rejected")));
    const validate = el("button", t("decide.validate"), "review-button primary");
    validate.dataset.action = "validated";
    validate.addEventListener("click", () => void run(decide("validated")));
    // The sends made on site the API would validate (a proposed name waiting aside).
    const onSite = units.filter(
      (u) =>
        u.open === "pending" &&
        u.rows.some((r) => r.status === "pending" && r.on_site === true) &&
        !u.rows.some((r) => nameWaits(r) && r.status === "pending"),
    );
    if (onSite.length > 1 || (onSite.length === 1 && onSite[0] !== current)) {
      const all = el("button", t("review.bar.on_site", { n: onSite.length }), "review-button wide");
      all.id = "review-on-site";
      all.dataset.action = "on_site";
      all.addEventListener(
        "click",
        () =>
          void run(async () => {
            const r = await call<{ validated: string[] }>("POST", "/api/review/decide-on-site", {
              camera: w.camera,
            });
            await this.decided(w.camera, r.validated, "validated", true, true);
          }),
      );
      buttons.push(all);
    }
    for (const b of [reject, validate]) b.type = "button";
    buttons.push(reject, validate);
    return buttons;
  }

  /** After a decision: the toast (with « Annuler » when it was taken from `pending`), then
   * the same camera's next send, or the next camera. */
  private async decided(
    camera: string,
    done: string[],
    decision: Decision,
    fromPending: boolean,
    /** « Valider ce qui est fait sur place »: several sends, counted. */
    many = false,
  ): Promise<void> {
    if (done.length) {
      const text =
        many && decision === "validated"
          ? t("review.toast.validated_n", { n: done.length })
          : t(`review.toast.${decision}`);
      toast(
        text,
        fromPending
          ? async () => {
              await call("POST", "/api/review/undo", { uuids: done });
              say(t("review.undone"));
              this.nav.openCamera(camera, "replace");
            }
          : null,
      );
    }
    let w: CameraAnswer;
    let hidden: Hidden | null;
    try {
      [w, hidden] = await this.fetch(camera);
    } catch (e) {
      this.nav.fail(e);
      return;
    }
    if (new URLSearchParams(window.location.search).get("camera") !== camera) return;
    if (unitsOf(w.contributions).some((u) => u.open === "pending"))
      this.render(w, hidden, decision);
    else await this.nav.next(camera);
  }

  /** « Retrait » (an administrator, lot 2): « Masquer cette caméra » in two taps (no
   * password asked: hiding takes nothing away for good), or, hidden, since when and
   * whether it has left the map, with the way to « Retraits » to show it again. */
  private retreat(camera: string, hidden: Hidden | null): HTMLElement {
    const section = el("section", "", "review-retreat");
    section.setAttribute("aria-labelledby", "review-retreat-title");
    const h2 = el("h2", t("review.hide.title"));
    h2.id = "review-retreat-title";
    h2.tabIndex = -1;
    section.append(h2);
    if (hidden) {
      const p = el("p");
      p.append(
        t("review.hide.state", {
          day: dayText(hidden.added_on),
          state: onMap(hidden).textContent ?? "",
        }),
        " ",
      );
      const a = el("a", t("review.hide.where"));
      a.href = this.nav.hiddenHref();
      p.append(a);
      section.append(p);
      return section;
    }
    const hint = el("p", t("review.hide.hint"), "review-muted");
    hint.id = "review-hide-hint";
    const error = el("p", "", "review-error review-inline-error");
    error.hidden = true;
    const hide: HTMLButtonElement = twoStep(
      "review.hide.button",
      "review.hide.confirm",
      "review-button small",
      async () => {
        try {
          await call("POST", "/api/review/hidden", { camera, hide: true });
          say(t("review.hidden.done", { id: camera }));
          await this.show(camera);
          document.querySelector<HTMLElement>("#review-retreat-title")?.focus();
        } catch (e) {
          fail(errorText(e), error);
          hide.disabled = false;
        }
      },
    );
    hide.type = "button";
    hide.id = "review-hide";
    hide.setAttribute("aria-describedby", hint.id);
    section.append(hint, hide, error);
    return section;
  }

  /** « Détails »: the id and its copy, OpenStreetMap's version, history and tags, the
   * decisions with « Changer la décision », the withdrawn contributions. Open when nothing
   * waits (its decisions are then the view's content). */
  private details(w: CameraAnswer, decided: Unit[], open: boolean): HTMLDetailsElement {
    const d = el("details", "", "review-details");
    d.id = "review-details";
    d.open = open;
    const summary = el("summary");
    // What it holds, while closed: never a title over nothing.
    summary.append(
      el("h2", t("review.details")),
      el("span", t("review.details.hint"), "review-details-hint"),
    );
    d.append(summary);
    const id = el("p", "", "review-id");
    const code = el("code", w.camera);
    const copy = el("button", t("review.copy"), "review-button small");
    copy.type = "button";
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(w.camera);
        say(t("review.copied"));
      } catch {
        fail(t("review.copy_failed"));
        const range = document.createRange();
        range.selectNodeContents(code);
        window.getSelection()?.removeAllRanges();
        window.getSelection()?.addRange(range);
      }
    });
    id.append(`${t("review.details.id")} `, code, " ", copy);
    d.append(id);
    const s = w.served;
    if (s?.osm_type && s.osm_id) {
      const p = el("p", t("review.details.version", { v: s.osm_version ?? "–" }));
      p.append(" · ", historyLink(s.osm_type, s.osm_id, t("review.conflict.history")));
      d.append(p);
    }
    if (s?.tags && Object.keys(s.tags).length) {
      d.append(
        el("h3", t("review.details.tags", { n: Object.keys(s.tags).length })),
        tagList(s.tags),
      );
    }
    d.append(el("h3", t("review.details.decisions")));
    if (!decided.length) d.append(el("p", t("review.details.no_decision"), "review-muted"));
    else {
      const ul = el("ul", "", "review-units");
      for (const u of decided) ul.append(this.decidedLine(w, u));
      d.append(ul);
    }
    const withdrawn = w.contributions.filter((r) => r.status === "withdrawn");
    if (withdrawn.length) {
      d.append(el("h3", t("review.details.withdrawn", { n: withdrawn.length })));
      const ul = el("ul", "", "review-units review-withdrawn");
      for (const r of withdrawn)
        ul.append(
          el(
            "li",
            `${fieldName(r.kind === "add" ? "position" : r.kind)} : ${proposedCell(r)} · ${r.author ?? t("review.author.gone")} · ${dayText(r.day)}`,
          ),
        );
      d.append(ul);
    }
    return d;
  }

  /** A decided send: what it said, its status, who and which day, « Changer la décision »
   * in two steps (a proposed name asks its choice again before a validation). */
  private decidedLine(w: CameraAnswer, u: Unit): HTMLLIElement {
    const li = el("li", "", "review-decided");
    li.dataset.uuid = u.head.uuid;
    const statuses = [...new Set(u.rows.map((r) => r.status))];
    li.dataset.status = statuses.join(" ");
    const what = u.rows
      .map((r) => `${fieldName(r.kind === "add" ? "position" : r.kind)} : ${proposedCell(r)}`)
      .join(" · ");
    const who = u.head.decided_by
      ? t("review.decided", {
          who: u.head.decided_by,
          day: dayText(u.head.decided_on ?? u.head.day),
        })
      : "";
    li.append(
      ...(u.kind === "single" ? [] : [el("strong", unitTitle(u)), " · "]),
      `${what} · `,
      el(
        "span",
        u.rows.length > 1 && statuses.length > 1
          ? u.rows.map(statusText).join(", ")
          : statusText(u.head),
        "review-status",
      ),
      ...(who ? [` · ${who}`] : []),
    );
    for (const r of u.rows) {
      const named = proposedText(r);
      if (named) li.append(el("p", named, "review-note"));
      if (r.status === "conflict") li.append(conflictBox(r));
    }
    // Once decided, where it went on OSM (published, its changeset, a conflict) stays said.
    if (u.rows.some((r) => r.destination?.where === "osm")) li.append(...destinations(u));
    const to =
      statuses.length !== 1
        ? null
        : u.head.status === "validated" || u.head.status === "applied"
          ? "rejected"
          : u.head.status === "rejected"
            ? "validated"
            : null;
    if (!to) return li;
    const named = to === "validated" ? u.rows.find(nameWaits) : undefined;
    const pick = named ? chooser(named, () => this.names(w.camera)) : null;
    const error = el("p", "", "review-error");
    error.hidden = true;
    const change = twoStep(
      "decide.change",
      to === "rejected" ? "decide.reject_confirm" : "decide.validate_confirm",
      `review-button small decide-change decide-${to}`,
      async () => {
        const op = pick?.get() ?? null;
        if (pick && !op) {
          fail(t("review.operator.needed"), error);
          pick.box.focus();
          return;
        }
        try {
          await call("POST", "/api/review/decide", {
            uuid: u.head.uuid,
            decision: to,
            ...(op ? { operator: op } : {}),
          });
          say(t(`review.toast.${to}`));
          await this.show(w.camera);
          document.getElementById("review-details")?.setAttribute("open", "");
        } catch (e) {
          fail(errorText(e), error);
          change.disabled = false;
        }
      },
    );
    change.dataset.to = to;
    const row = el("div", "", "review-change");
    if (pick) li.append(pick.box);
    row.append(change);
    li.append(row, error);
    return li;
  }
}
