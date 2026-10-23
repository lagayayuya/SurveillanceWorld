// Participation (phases D1, D2, "Ajouter"): the camera sheet's actions, "Toujours là ?",
// "Déplacer" and "Compléter" (shape, direction, who films; complete.ts), "Ajouter une
// caméra" (add.ts, a floating button from add.min_zoom, for the accounts the API knows),
// the proposals on the map and in the sheet (confirm / dispute for other accounts, validate
// / reject for the review account; a pending add has a sheet of its own), the send queue
// and its discreet counter, and the "Vos contributions" page. Nothing is sent to
// OpenStreetMap.
import type { Map as MlMap } from "maplibre-gl";
import { cameraAddress, comeBackTo } from "../account/osm";
import { loadSession, type Me, onSession, pseudonym } from "../account/session";
import { debugEvent } from "../debug";
import { formatMonth, t, tp } from "../i18n";
import { DETAIL_MIN } from "../layers";
import { awardOf } from "../profile/award";
import { AddMode, type Nearby } from "./add";
import { ApiError, call, withdrawSent } from "./api";
import { CompleteMode, type CompleteTarget, type Questions } from "./complete";
import { decisionButtons, twoStep } from "./decide";
import { answerText, openMine } from "./mine";
import { ModifyMode } from "./modify";
import { MoveMode, type MoveTarget, type Rules } from "./move";
import { metresBetween, onSite } from "./onsite";
import { type Proposal, ProposalsLayer, proposalsOf } from "./proposals";
import { editorAnswerable, editorAssumed } from "./questions";
import { type Contribution, Queue, today } from "./queue";
import { columnOf, Score, sceneOf } from "./score";
import { verifyPanel } from "./verify";

/** How long the counter says a send was refused. */
const REFUSED_MS = 12_000;

export type ParticipationMeta = {
  build_id: string;
  participation: Rules & { questions?: Questions };
};
/** `check`: position or direction to check on site; "Déplacer" comes first. */
export type SheetCamera = CompleteTarget & { label: string; check?: boolean };

export class Participation {
  readonly queue: Queue;
  readonly move: MoveMode;
  /** "Compléter"; null with a build made before phase D2 (no questions in its meta). */
  readonly complete: CompleteMode | null;
  /** "Ajouter une caméra"; null with a build made before the phase (no add rules). */
  readonly add: AddMode | null;
  /** « Modifier » (the punk sheet: it replaces « Compléter » and « Déplacer » there); null
   * with a build made before phase D2 (no questions in its meta). */
  readonly modify: ModifyMode | null;
  private addButton: HTMLButtonElement;
  private proposals: ProposalsLayer;
  /** A pending add's proposal opened from a link or the review (not in the view's list). */
  private opened: Proposal | null = null;
  private counter: HTMLButtonElement;
  /** While a refused send is said on the counter: its timer. */
  private refused = 0;
  private me: Me | null = null;
  /** No session, said by the API (account/session.ts): a login is asked where a
   * contribution would start. */
  private visitor = false;
  /** The review account: conflicts of each camera opened (the build found its OSM element
   * changed or gone), fetched once per camera. */
  private conflicts = new Map<string, number>();
  /** The camera whose sheet shows participation, the box its proposal goes in, and the
   * punk sheet's slots (actionSlots) when it reads them in its own order. */
  private shown: { cam: SheetCamera; box: HTMLElement; slots?: ActionSlots } | null = null;

  constructor(
    private map: MlMap,
    private meta: ParticipationMeta,
    private hooks: {
      est: () => number;
      /** Hide the sheet while moving; bring it back (with a message) afterwards. */
      closeSheet: () => void;
      afterMove: (sent: boolean) => void;
      label: (id: string) => string;
      /** A camera's sheet by id: the map's, or a pending add's (the duplicates list). */
      open: (id: string) => void;
      /** The login form in the sheet, then `then` once signed in; `back` is its
       * « ← Retour ». None when contributions are closed. */
      login?: (then: () => void, back?: () => void) => void;
    },
  ) {
    this.counter = document.createElement("button");
    this.counter.id = "queue-count";
    this.counter.hidden = true;
    this.counter.addEventListener("click", () => {
      this.endRefused();
      // Punk: sends waiting for a login lead to it; they leave once signed in.
      if (this.queue.needsLogin && this.queue.items.length && hooks.login) {
        hooks.login(() => this.queue.resume());
        return;
      }
      openMine(this.queue, (u, b) => this.withdraw(u, b), this.meta.participation);
    });
    document.body.append(this.counter);
    let waiting = 0;
    let asked = false;
    this.queue = new Queue(
      (q) => {
        // A send answered 401 while the page thought it signed in: the session expired;
        // asked again, the page acts signed out (and a login sends what waits).
        if (q.needsLogin && this.me && !asked) {
          asked = true;
          void loadSession();
        }
        if (!q.needsLogin) asked = false;
        this.renderCounter();
        // Something left the phone: the API now holds it, with the others' contributions.
        if (q.items.length < waiting) void this.proposals?.refresh();
        else this.proposals?.draw();
        waiting = q.items.length;
      },
      (batch) => this.sayRefused(batch),
    );
    this.proposals = new ProposalsLayer(
      map,
      this.queue,
      meta.participation.proposals_min_zoom ?? 13,
      hooks.est,
      (id) => this.cameraAt(id),
      () => this.renderProposal(),
    );
    void this.proposals.refresh();
    this.addButton = document.createElement("button");
    this.addButton.id = "fab-add";
    this.addButton.className = "fab";
    this.addButton.hidden = true;
    document.getElementById("fabs")?.prepend(this.addButton);
    this.move = new MoveMode(map, meta.participation, {
      queue: this.queue,
      buildId: meta.build_id,
      est: hooks.est,
      onExit: (sent) => {
        void this.proposals.refresh();
        hooks.afterMove(sent);
      },
    });
    const questions = meta.participation.questions;
    this.complete = questions
      ? new CompleteMode(map, questions, {
          queue: this.queue,
          buildId: meta.build_id,
          onSite: meta.participation,
          est: hooks.est,
          onExit: (sent) => {
            void this.proposals.refresh();
            hooks.afterMove(sent > 0);
          },
        })
      : null;
    this.modify = questions
      ? new ModifyMode(map, meta.participation, questions, {
          queue: this.queue,
          buildId: meta.build_id,
          est: hooks.est,
          reopen: (id) => hooks.open(id),
          onExit: (sent) => {
            void this.proposals.refresh();
            hooks.afterMove(sent > 0);
          },
          nearby: (at, m) => this.nearby(at, m),
        })
      : null;
    this.add = meta.participation.add
      ? new AddMode(map, meta.participation, {
          queue: this.queue,
          buildId: meta.build_id,
          est: hooks.est,
          onExit: (sent) => {
            void this.proposals.refresh();
            hooks.afterMove(sent);
          },
          nearby: (at, m) => this.nearby(at, m),
          open: (id) => hooks.open(id),
          added: (cam, draft) => {
            // A build before phase D2 has no questions: the add leaves at once.
            if (this.complete) this.complete.start(cam, draft, (d) => this.add?.resume(d));
            else void this.queue.addAll([{ uuid: draft.uuid, body: draft.body }]);
          },
        })
      : null;
    // "＋ Ajouter", short: a long pill reached over the map's middle and hid the followed
    // dot. Below min_zoom it stays greyed (aria-disabled, so a tap still comes) and a tap
    // says "Zoomez pour ajouter" for a few seconds.
    const minZoom = meta.participation.add?.min_zoom ?? 17;
    // DECISIONS 2026-10-09: active as soon as the stickers show (the street level); a tap
    // below min_zoom first zooms there, centred where it is, then opens the add.
    const activeFrom = DETAIL_MIN;
    let saying = 0;
    const label = () => {
      const near = map.getZoom() >= activeFrom;
      this.addButton.setAttribute("aria-disabled", String(!near));
      this.addButton.setAttribute("aria-label", t(near ? "fab.add.aria" : "fab.add_zoom"));
      if (!saying || near) {
        clearTimeout(saying);
        saying = 0;
        this.addButton.textContent = t("fab.add");
      }
    };
    map.on("zoom", label);
    label();
    this.addButton.addEventListener("click", () => {
      if (!this.add) return;
      // Signed out: the login, then this same tap once signed in.
      if (this.visitor && hooks.login) {
        hooks.login(() => this.addButton.click());
        return;
      }
      if (map.getZoom() >= activeFrom && map.getZoom() < minZoom) {
        hooks.closeSheet();
        // A finger that stops the zoom halfway stops the add with it. A move still running
        // (a fling's inertia) is stopped first: its own moveend would come at the old zoom.
        map.stop();
        map.once("moveend", () => {
          if (map.getZoom() < minZoom - 0.01) return;
          if (this.modify) this.modify.startAdd();
          else this.add?.begin();
        });
        map.easeTo({ zoom: minZoom, duration: 400 });
        return;
      }
      if (map.getZoom() < activeFrom) {
        this.addButton.textContent = t("fab.add_zoom");
        clearTimeout(saying);
        saying = window.setTimeout(() => {
          saying = 0;
          label();
        }, 3000);
        return;
      }
      hooks.closeSheet();
      // DECISIONS 2026-10-08: adding and « Modifier » are one component.
      if (this.modify) this.modify.startAdd();
      else this.add.begin();
    });
    // Who is signed in (account/session.ts, asked by main.ts at start). Signed in, one may
    // add a camera; a visitor in punk too, the button asking for a login first; unknown
    // (the API unreachable), no « ＋ Ajouter », as before accounts. A login sends what
    // waited for it.
    onSession((s) => {
      const was = this.me;
      this.me = s.state === "signed" ? s.me : null;
      this.visitor = s.state === "visitor";
      if (s.state === "unknown") debugEvent("me: unavailable (offline?)");
      this.addButton.hidden = this.add === null || !(this.me || (this.visitor && hooks.login));
      // Signed in now (a login): what waited for it leaves. Asked again while signed in
      // (after a 401), nothing more: the same 401 would come back.
      // On a shared phone, each account's sends wait for that account (queue.ts owner).
      const owner = this.me ? pseudonym(this.me).toLowerCase() : null;
      if (owner !== this.queue.owner) {
        this.queue.owner = owner;
        void this.queue.refresh().then(() => {
          if (!this.queue.needsLogin) void this.queue.flush("account");
        });
      }
      if (this.me && !was) this.queue.resume();
      this.renderCounter();
      this.renderProposal();
    });
  }

  /** Cameras within `m` metres of a point, nearest first: the map's (loaded tiles), the
   * adds others proposed, and moves' proposed positions. */
  private nearby(at: [number, number], m: number): Nearby[] {
    const best = new Map<string, Nearby>();
    const keep = (n: Nearby) => {
      const old = best.get(n.id);
      if (n.m <= m && (!old || n.m < old.m)) best.set(n.id, n);
    };
    // The label (punk: the nearest street, read from the tiles) only for what is near: one
    // per camera in the view would cost seconds on a phone in a dense one.
    for (const f of this.map.querySourceFeatures("detail", { sourceLayer: "cameras" })) {
      const id = String(f.properties.id);
      const lngLat = (f.geometry as GeoJSON.Point).coordinates as [number, number];
      const d = metresBetween(at, lngLat);
      if (d > m) continue;
      const k = String(f.properties.k ?? "unknown");
      keep({ id, label: "", k, m: d, proposed: false });
    }
    for (const p of this.proposals.all) {
      const where = p.k === "add" ? p.at : p.to;
      if (!where || p.s === "queued") continue;
      const d = metresBetween(at, where);
      if (d > m) continue;
      const label = p.k === "add" ? t("part.add.duplicates.proposed") : "";
      keep({ id: p.c, label, k: p.ck, m: d, proposed: true });
    }
    const out = [...best.values()].sort((a, b) => a.m - b.m);
    for (const n of out) if (!n.label) n.label = this.hooks.label(n.id);
    return out;
  }

  /** A pending add's proposal, by its camera id: from the view's list, else the API. */
  async pending(id: string): Promise<Proposal | null> {
    const known = this.proposals.forCamera(id).find((p) => p.k === "add");
    if (known) return known;
    try {
      return (await proposalsOf(id)).find((p) => p.k === "add") ?? null;
    } catch {
      return null;
    }
  }

  /** The sheet of an add no build has applied yet: its proposal block alone. */
  pendingActions(p: Proposal): HTMLElement {
    const box = document.createElement("div");
    box.className = "participate";
    this.opened = p;
    const cam = { id: p.c, fid: -1, lngLat: p.at, mg: "", k: p.ck, kc: 0, d: -1, o: "unk" };
    this.shown = { cam: { ...cam, label: "" }, box };
    this.renderProposal();
    return box;
  }

  /** The camera sheet's facts marked « ? »: the lines « Modifier » would unfold
   * (questions.ts editorAnswerable), else what « Compléter » can answer. */
  answerable(cam: CompleteTarget): string[] {
    const q = this.meta.participation.questions;
    if (this.modify && q) return editorAnswerable(cam, q);
    return this.complete?.answerable(cam) ?? [];
  }

  /** A mode holds the map (move, « Compléter », « Modifier »): a tap selects nothing. */
  busy(): boolean {
    return this.move.active || this.complete?.active === true || this.modify?.active === true;
  }

  /** Escape: the mode's own step back (an add, or « Modifier » with changes, asks first). */
  escape(): void {
    if (this.modify?.active) this.modify.escape();
    else if (this.complete?.active) this.complete.escape();
    else if (this.move.active) this.move.exit(false);
  }

  /** No participation at all: signed out without a way to sign in. */
  get hidden(): boolean {
    return this.visitor && !this.hooks.login;
  }

  /** Signed out in punk: the login takes the hand, `then` once signed in, `back` its
   * « ← Retour » (true); else nothing to do (false). */
  private loginFirst(then: () => void, back?: () => void): boolean {
    if (!this.visitor || !this.hooks.login) return false;
    this.hooks.login(then, back);
    return true;
  }

  /** The queue's counter: what waits on the phone, or a send just refused; in punk, sends
   * the API refused for want of a session say they wait for a login (a tap leads to it). */
  private renderCounter(): void {
    const n = this.queue.items.length;
    this.counter.hidden = !this.refused && n === 0;
    const relogin = this.queue.needsLogin && this.hooks.login !== undefined && n > 0;
    this.counter.classList.toggle("relogin", relogin && !this.refused);
    this.counter.textContent = this.refused
      ? t("part.batch_refused")
      : relogin
        ? t("account.queue.relogin", { n })
        : t("part.pending_count", { n });
  }

  /** A « Modifier » send refused by the server (the queue dropped all of it): said where
   * its thanks still shows, and on the counter for a while (a tap opens « Vos
   * contributions »). */
  private sayRefused(batch: string): void {
    // In the shown send's place only when it is that send (8a's scene of another one, a
    // verify's, keeps its points); the counter says it anyway.
    const thanks = sceneOf(batch) ? document.getElementById("modify-done") : null;
    if (thanks) thanks.textContent = t("part.batch_refused");
    clearTimeout(this.refused);
    this.refused = window.setTimeout(() => this.endRefused(), REFUSED_MS);
    this.counter.setAttribute("aria-live", "polite");
    this.renderCounter();
  }

  private endRefused(): void {
    if (!this.refused) return;
    clearTimeout(this.refused);
    this.refused = 0;
    this.counter.removeAttribute("aria-live");
    this.renderCounter();
  }

  /** Queue state for ?debug=1. */
  debugState(): string {
    return `${this.queue.items.length} waiting, ${this.queue.dropped} dropped`;
  }

  private cameraAt(id: string): [number, number] | null {
    const f = this.map
      .querySourceFeatures("detail", { sourceLayer: "cameras" })
      .find((c) => c.properties.id === id);
    return f ? ((f.geometry as GeoJSON.Point).coordinates as [number, number]) : null;
  }

  /** The sheet opened on a camera (null: closed, or another kind of sheet). */
  select(camera: string | null): void {
    if (camera === null) this.shown = null;
    if (camera !== this.opened?.c) this.opened = null;
    void this.proposals.select(camera);
  }

  /** The proposal block of the open sheet, rendered again when the data changes. */
  private renderProposal(): void {
    if (!this.shown) return;
    const { cam, box, slots } = this.shown;
    // The punk sheet's slot holds the review's conflict then the proposal (the conflict,
    // fetched later, goes before it); the box puts the proposal first.
    const into = slots?.head ?? box;
    let block = into.querySelector<HTMLElement>(".part-proposal");
    if (!block) {
      block = document.createElement("div");
      block.className = "part-proposal";
      if (slots) into.append(block);
      else into.prepend(block);
    }
    let list = this.proposals.forCamera(cam.id);
    if (!list.length && this.opened?.c === cam.id) list = [this.opened];
    // Rebuilt only when what it says changes: a refresh after every map move would
    // otherwise replace its buttons under the finger (seen in CI's WebKit run). An add's
    // answers, read after the rest (ProposalsLayer select), change their list alone.
    const first = list[0] ? { ...list[0], ans: undefined } : null;
    const said = JSON.stringify([first, list.length, this.me?.reviewer ?? null, this.visitor]);
    if (block.dataset.said === said) {
      showAnswers(block, list[0]);
      return;
    }
    block.dataset.said = said;
    block.hidden = list.length === 0;
    block.replaceChildren();
    if (!list.length) return;
    const p = list[0];
    const line = document.createElement("p");
    line.className = "proposal-line";
    // Dated by its month, as the map dates contributions (DECISIONS 2026-09-30, « Dates of
    // contributions on the map are months… »): the API gives no day to the public.
    const month = formatMonth(p.month);
    const what =
      p.k === "move"
        ? t("prop.moved_month", { m: Math.round((p.mv ?? 0) * 10) / 10, month })
        : t("prop.not_found_month", { month });
    // An add: its sheet's title says the status; the box says when, "sur place" only when
    // it was (rules: on_site). One an OSM camera was mapped beside (the review account
    // only): its own words.
    line.textContent =
      p.s === "conflict"
        ? t("prop.add_duplicate")
        : p.k === "add"
          ? t(p.os ? "prop.added_on_site_month" : "prop.added_month", { month })
          : `${tp(`prop.status.${p.s}`)} ${what}`;
    block.append(line);
    showAnswers(block, p);
    if (p.s === "conflict") {
      const link = document.createElement("a");
      link.href = "/revue?status=conflict&kind=add";
      link.textContent = t("sheet.review_conflict.link");
      block.append(link);
    }
    if (p.n > 0 || p.d > 0) {
      const counts = document.createElement("p");
      counts.className = "proposal-counts";
      counts.textContent = [
        p.n > 0 ? t("prop.agreed", { n: p.n }) : "",
        p.d > 0 ? t("prop.disputed", { n: p.d }) : "",
      ]
        .filter(Boolean)
        .join(" · ");
      block.append(counts);
    }
    if (list.length > 1) {
      const more = document.createElement("p");
      more.className = "proposal-counts";
      more.textContent = t("prop.more", { n: list.length - 1 });
      block.append(more);
    }
    const row = document.createElement("div");
    row.className = "part-answers";
    if (p.m || p.s === "queued") {
      block.append(note("prop.yours"));
      // Withdrawn while nobody decided: from the queue unsent, or on the server.
      if (p.s === "pending" || p.s === "queued" || p.s === "sent")
        block.append(this.withdrawButton(p.q ?? p.u, "prop.withdraw", p.k === "add", block, p.b));
    } else if (this.hidden) {
      // Signed out without a way to sign in: the proposal's state alone.
    } else if (this.me?.reviewer) {
      row.append(
        ...decisionButtons(p.u, p.s, "part-btn", async () => {
          await this.proposals.refresh();
        }),
      );
      block.append(row);
    } else if (p.o) {
      block.append(note(`prop.answered.${p.o}`));
      if (p.ou) block.append(this.withdrawButton(p.ou, "prop.withdraw_opinion", false, block));
    } else {
      for (const kind of ["agree", "disagree"] as const) {
        const b = button(`prop.${kind}`, "part-btn");
        b.dataset.opinion = kind;
        b.addEventListener("click", () => {
          // Signed out (punk): the login, then back to this sheet.
          const back = () => this.hooks.open(cam.id);
          if (this.loginFirst(back, back)) return;
          void this.opine(cam, p, kind, block);
        });
        row.append(b);
      }
      block.append(row);
    }
  }

  /** Take back one's own pending contribution: unsent from the queue, else on the server
   * (online only). An add takes its answers with it. A piece of a « Modifier » send
   * (`batch`, when it left: the proposal's or « Vos contributions »' line says it) takes
   * the whole send, on the phone and on the server: its pieces leave one at a time, so
   * some may have arrived while others wait. */
  async withdraw(uuid: string, batch?: string | null): Promise<void> {
    this.proposals.forget(uuid); // not drawn as "sent" when it leaves the queue
    const local = await this.queue.remove(uuid);
    for (const i of local) this.proposals.forget(i.uuid);
    const sendOf = local[0]?.body.batch;
    if (sendOf) {
      // Its pieces already sent (none: 404). Offline, it is an error only when a piece
      // is known to have left; else the send was all on the phone, now gone.
      try {
        await withdrawSent(sendOf);
      } catch (e) {
        const none = e instanceof ApiError && e.status === 404;
        if (!none && this.queue.left(sendOf)) throw e;
      }
    } else if (!local.length) {
      await withdrawSent(uuid);
      this.proposals.forget(uuid);
      // The send's pieces still waiting on the phone go with it (sent later, the server
      // would refuse them: batch_closed).
      if (batch) for (const u of await this.queue.removeBatch(batch)) this.proposals.forget(u);
    }
    debugEvent("withdrawn");
    await this.proposals.refresh();
  }

  /** "Retirer ma proposition" / "Retirer mon avis", in two steps. An add's sheet closes:
   * the camera no longer exists. `batch`: a sent piece of a « Modifier » send. */
  private withdrawButton(
    uuid: string,
    key: string,
    add: boolean,
    block: HTMLElement,
    batch?: string,
  ) {
    const b = twoStep(key, `${key}_confirm`, "part-btn quiet part-withdraw", async () => {
      try {
        await this.withdraw(uuid, batch);
      } catch (e) {
        b.disabled = false;
        b.textContent = t(key);
        b.classList.remove("armed");
        // Too many requests in a minute (429) is not being offline.
        const busy = e instanceof ApiError && e.status === 429;
        block.append(note(busy ? "prop.withdraw_busy" : "prop.withdraw_offline"));
        return;
      }
      if (add) this.hooks.closeSheet();
    });
    return b;
  }

  /** "Je confirme" / "Ce n'est pas ça": one tap, queued like any contribution. */
  private async opine(
    cam: SheetCamera,
    p: Proposal,
    kind: "agree" | "disagree",
    block: HTMLElement,
  ) {
    for (const b of block.querySelectorAll("button")) b.disabled = true;
    p.ou = await this.queue.add({
      kind,
      target: p.u,
      camera: cam.id,
      build_id: this.meta.build_id,
      day: today(),
      on_site: await onSite(cam.lngLat, this.meta.participation),
    });
    p.o = kind; // until the next refresh says so
    this.renderProposal();
  }

  /** The block under the camera sheet's headline. With `slots` (the punk sheet), the
   * proposal and the review's conflict, « Déplacer » when it is a link and « Vos
   * contributions » go in them, where that sheet reads them (chips.ts); what replaces the
   * buttons (a question, a list, thanks) empties them, as it empties the box. */
  actions(cam: SheetCamera, slots?: ActionSlots): HTMLElement {
    const box = document.createElement("div");
    box.className = "participate";
    this.shown = { cam, box, slots };
    const clearSlots = () => {
      if (slots) for (const slot of Object.values(slots)) slot.replaceChildren();
    };
    const clear = () => {
      box.replaceChildren();
      clearSlots();
    };
    const idle = () => {
      clear();
      this.renderProposal();
      const row = document.createElement("div");
      row.className = "part-answers";
      const verify = button("part.verify", "part-btn part-verify");
      // Signed out: « Compte », then back to this sheet (a password login runs
      // `back`; OpenStreetMap comes back to this camera's address).
      const back = () => this.hooks.open(cam.id);
      const signIn = () => {
        if (this.visitor && this.hooks.login) comeBackTo(cameraAddress(cam.id));
        return this.loginFirst(back, back);
      };
      verify.addEventListener("click", () => {
        if (signIn()) return;
        clearSlots();
        verifyPanel(
          box,
          cam,
          {
            queue: this.queue,
            buildId: this.meta.build_id,
            onSite: this.meta.participation,
            onDone: (offline, sent) => done(offline, sent),
          },
          idle,
        );
      });
      const move = button(
        "part.move",
        cam.check ? "part-btn part-move primary" : "part-btn part-move",
      );
      move.addEventListener("click", () => this.chooseAndMove(clear, box, cam, idle));
      const mine = button("part.mine", "part-link");
      mine.addEventListener("click", () =>
        openMine(this.queue, (u, b) => this.withdraw(u, b), this.meta.participation),
      );
      let complete: HTMLButtonElement | null = null;
      if (this.complete?.offers(cam)) {
        complete = button("part.complete", "part-btn");
        complete.id = "part-complete";
        complete.addEventListener("click", () => {
          this.hooks.closeSheet();
          this.complete?.start(cam);
        });
      }
      if (slots && this.modify) {
        // The punk sheet (DECISIONS 2026-10-08): « Modifier », always, in place of
        // « Compléter » and « Déplacer » (17a's « Compléter »: its « ? » while a value is
        // assumed that the editor asks, a dome's height included), then « Toujours là ? »;
        // « Vos contributions » in its slot. A position or direction to check: « Modifier »
        // filled as « Déplacer » was (`primary`), since it now moves the camera.
        // Signed out (the author's request of 2026-10-11, point 3): both buttons greyed
        // (aria-disabled: still reached by the keyboard and said, a tap opens « Compte »),
        // « Connectez-vous pour participer » under them; no « Vos contributions ».
        const modify = button("part.modify", "part-btn part-modify");
        modify.id = "part-modify";
        const q = this.meta.participation.questions;
        if (!this.visitor && q && editorAssumed(cam, q).length) modify.classList.add("asks");
        if (!this.visitor && cam.check) modify.classList.add("primary");
        modify.addEventListener("click", () => {
          if (signIn()) return;
          this.hooks.closeSheet();
          this.modify?.start(cam);
        });
        row.append(modify, verify);
        if (!this.visitor) slots.mine.append(mine);
        box.append(row);
        if (this.visitor && this.hooks.login) {
          const line = document.createElement("p");
          line.className = "part-signin";
          line.id = "part-signin";
          line.textContent = t("account.login_to_participate");
          for (const b of [modify, verify]) {
            b.setAttribute("aria-disabled", "true");
            b.setAttribute("aria-describedby", line.id);
          }
          box.append(line);
        }
      } else if (slots) {
        // The punk sheet's order (17a): « Déplacer » first when filled, « Compléter »,
        // « Toujours là ? »; « Déplacer » as a link and « Vos contributions » in their slots.
        if (cam.check) row.append(move);
        else slots.move.append(move);
        if (complete) row.append(complete);
        row.append(verify);
        slots.mine.append(mine);
        box.append(row);
      }
      if (this.me?.reviewer) void this.renderConflicts(cam, box);
    };
    const done = (offline: boolean, sent?: { uuid: string; body: Contribution }) => {
      // Board 8a: the sheet goes, the ticket falls on the map with its points; a check that
      // earns nothing (from afar, « Je ne sais pas »: profile/award.ts) has no ticket nor
      // scene, the sheet says « Envoyé · en attente de revue ».
      const category = sent ? awardOf(sent.body, {}) : null;
      if (sent && category) {
        void this.proposals.refresh();
        // Wide screen: the ticket falls where the camera's sheet stood.
        const column = columnOf(document.getElementById("sheet"));
        this.hooks.closeSheet();
        // Earned on site only, « Elle est là » or « Je ne la trouve pas ».
        const answer = sent.body.answer;
        new Score({
          tickets: [
            {
              uuid: sent.uuid,
              what: t(`score.what.${answer}`),
              value: t(`score.det.${answer}_on_site`),
              category,
            },
          ],
          column,
          queue: this.queue,
          offline,
          thanks: t(offline ? "part.queued" : "part.sent"),
          map: this.map,
          onEnd: () => undefined,
        });
        return;
      }
      clear();
      const p = document.createElement("p");
      p.className = "part-done";
      p.setAttribute("role", "status");
      p.textContent = t(offline ? "part.queued" : sent ? "score.sent" : "part.sent");
      box.append(p);
      void this.proposals.refresh();
    };
    idle();
    return box;
  }

  /** The review account only: "N contributions en conflit…" with a link to /revue. */
  private async renderConflicts(cam: SheetCamera, box: HTMLElement): Promise<void> {
    let n = this.conflicts.get(cam.id);
    if (n === undefined) {
      try {
        const q = `/api/review/contributions?status=conflict&camera=${encodeURIComponent(cam.id)}`;
        n = (await call<{ contributions: unknown[] }>("GET", q)).contributions.length;
      } catch {
        return; // offline: nothing to say
      }
      this.conflicts.set(cam.id, n);
    }
    const into = this.shown?.slots?.head ?? box;
    if (!n || this.shown?.box !== box || into.querySelector(".part-conflict")) return;
    const line = document.createElement("p");
    line.className = "part-conflict";
    line.textContent = `${t("sheet.review_conflict", { n })} `;
    const link = document.createElement("a");
    link.href = "/revue?status=conflict";
    link.textContent = t("sheet.review_conflict.link");
    line.append(link);
    into.prepend(line);
  }

  /** Several cameras within nearby_m: say which one moves first. */
  private chooseAndMove(
    clear: () => void,
    box: HTMLElement,
    cam: SheetCamera,
    back: () => void,
  ): void {
    const near = this.move.nearby(cam);
    debugEvent(`move: ${near.length} camera(s) within ${this.meta.participation.nearby_m} m`);
    if (near.length === 1) {
      this.startMove(cam);
      return;
    }
    clear();
    const q = document.createElement("p");
    q.className = "part-question";
    q.textContent = t("part.nearby.title");
    const list = document.createElement("div");
    list.className = "part-nearby";
    for (const c of near) {
      const b = document.createElement("button");
      b.className = "part-btn";
      b.textContent = this.hooks.label(c.id);
      b.addEventListener("click", () => this.startMove(c));
      list.append(b);
    }
    const cancel = button("part.cancel", "part-btn quiet");
    cancel.addEventListener("click", back);
    box.append(q, list, cancel);
  }

  private startMove(cam: MoveTarget): void {
    this.hooks.closeSheet();
    this.move.start(cam);
  }
}

/** Where the punk camera sheet reads the participation's parts that are not its buttons
 * (chips.ts punkSheet): the review's conflict and the proposal under the tickets,
 * « Déplacer » as a link after « Partager », « Vos contributions » after « Calcul ? »,
 * so that the sheet's DOM is in its visual order (WCAG 1.3.2, 2.4.3). */
export type ActionSlots = { head: HTMLElement; move: HTMLElement; mine: HTMLElement };

export function actionSlots(): ActionSlots {
  const slot = (cls: string) => {
    const e = document.createElement("div");
    e.className = `part-slot ${cls}`;
    return e;
  };
  return { head: slot("part-head"), move: slot("part-move-slot"), mine: slot("part-mine-slot") };
}

/** DECISIONS 2026-10-08: a pending add's answers under its proposal's line, as
 * they make the field drawn, so that one confirms knowingly. A sent add's come with its
 * camera (ProposalsLayer select): none listed until they are read, rather than « pas de
 * réponse » meanwhile; then the list alone is put in, the block's buttons kept. */
function showAnswers(block: HTMLElement, p: Proposal | undefined): void {
  const old = block.querySelector<HTMLElement>(".add-answers");
  const shown = p?.k === "add" && (p.ans || p.s === "queued" || p.s === "sent");
  if (!p || !shown) {
    old?.remove();
    return;
  }
  const said = JSON.stringify(p.ans ?? null);
  if (old?.dataset.said === said) return;
  const list = addAnswers(p);
  list.dataset.said = said;
  if (old) old.replaceWith(list);
  else block.querySelector(".proposal-line")?.after(list);
}

/** A pending add's answers on its sheet: shape, direction, height (and tilt), who films;
 * « pas de réponse » for a question nobody answered. */
function addAnswers(p: Proposal): HTMLElement {
  const list = document.createElement("dl");
  list.className = "part-recap add-answers";
  const a = p.ans ?? {};
  const rows: [string, string | null][] = [
    [
      "shape",
      a.shape ? answerText({ kind: "shape", answer: a.shape, dome_count: a.dome_count }) : null,
    ],
    [
      "direction",
      a.direction !== undefined
        ? answerText({ kind: "direction", answer: null, direction: a.direction })
        : null,
    ],
    ["height", a.height ? answerText({ kind: "height", answer: a.height }) : null],
    ...(a.tilt ? [["tilt", answerText({ kind: "tilt", answer: a.tilt })] as [string, string]] : []),
    [
      "operator",
      a.operator
        ? answerText({ kind: "operator", answer: a.operator[0], operator_name: a.operator[1] })
        : null,
    ],
  ];
  for (const [kind, value] of rows) {
    const row = document.createElement("div");
    const dt = document.createElement("dt");
    dt.textContent = t(`part.mine.kind.${kind}`);
    const dd = document.createElement("dd");
    dd.textContent = value ?? t("prop.add_answer.none");
    if (value === null) dd.className = "none";
    row.append(dt, dd);
    list.append(row);
  }
  return list;
}

function note(key: string): HTMLElement {
  const p = document.createElement("p");
  p.className = "proposal-counts";
  p.textContent = t(key);
  return p;
}

function button(key: string, cls: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = cls;
  b.textContent = t(key);
  return b;
}
