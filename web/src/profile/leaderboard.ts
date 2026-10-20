// The account's screen: the leaderboard (board 26a « Classement à points »), and only it
// (2026-10-10: 25b's profile is not shipped; one's contributions stay in each camera's
// « Vos contributions »). The period
// (this month, « Depuis le début »), the sort of points (Total, Ajouts, Infos ajoutées,
// Corrections, Vérifications, each with its colour, the bars' too), the podium rising to the
// scores' height and again on each change of filter (it blocks nothing; none under less
// motion: DECISIONS 2026-10-06, animations), « Vous · Ne » with the detail of your points and
// « +N pts en attente de revue », the list (rank, pseudonym, points: never a place or a day),
// « Apparaître dans le classement des autres » (off by default), « Afficher mon pseudonyme sur
// les caméras que j'ai relevées » (lot U: the cameras' public history; off by default, what it
// reveals said under it), « Mes caméras ↓ » (lot U, profile/cameras.ts), « Comment on compte ? ↓ »
// unfolding the scale the API reads from rules/leaderboard.yaml (never written here),
// « Télécharger mes données » (a JSON file, the launch lot), « Se déconnecter », « Supprimer
// mon compte » (the password asked). OSM lot 1: « Relier à
// OpenStreetMap » or « Relié à OpenStreetMap » and « Délier »; « Changer le mot de passe »
// only for an account that has one; back from OpenStreetMap, a line at the top. The OSM
// synchronisation (16/10): « Publier sur OpenStreetMap » before the foot's links
// (profile/sync.ts).
import { osmLogin, startLink, unlink, whyLine } from "../account/osm";
import { t } from "../i18n";
import { legalLinks } from "../legal";
import { ApiError } from "../participate/api";
import {
  type Board,
  type Count,
  changePassword,
  deleteAccount,
  EXPORT_FILE,
  exportData,
  KINDS,
  leaderboard,
  type Period,
  type Scale,
  type Score,
  score,
  setHistoryPseudonym,
  setLeaderboard,
} from "./api";
import { camerasSection } from "./cameras";
import { pending } from "./categories";
import { forgetVisit, type ProfileContext } from "./context";
import {
  button,
  drawn,
  el,
  link,
  logoutLink,
  monthName,
  ordinal,
  paper,
  said,
  settle,
  thisMonth,
} from "./dom";
import { syncSection } from "./sync";

const COUNTS: Count[] = ["total", ...KINDS];
// 26a's tilts: the period buttons, the chosen sort, the podium's tags and steps.
const PERIOD_TILT = [-1.5, 1];
const COUNT_TILT = [-2, 2, -1.5, 1.5, -2];
const TAG_TILT = [1, -1.5, -1];
const STEP_TILT = [1, -1.5, -1];
/** 26a's podium: a step is 44 px, and 96 px more for the first's score. */
const STEP_MIN = 44;
const STEP_RANGE = 96;
/** The scale's worked example: an add with the four infos 26a names (type, direction,
 * height, operator). A count, not a value of the scale. */
const EXAMPLE_INFOS = 4;

type State = {
  period: Period;
  count: Count;
  board: Board | null;
  score: Score | null;
  scale: Scale | null;
  failed: boolean;
};

/** Open the leaderboard in the sheet (this month, every sort). */
export function openLeaderboard(ctx: ProfileContext): void {
  const { paper: page, body, title } = paper(ctx, "board-paper");
  const month = thisMonth();
  const state: State = {
    period: month,
    count: "total",
    board: null,
    score: null,
    scale: null,
    failed: false,
  };

  // --- the filters: the period, the sort -----------------------------------------------
  const filters = el("div", "board-filters");
  filters.setAttribute("role", "group");
  filters.setAttribute("aria-label", t("board.refine"));
  const periods = el("div", "board-periods");
  periods.setAttribute("role", "group");
  periods.setAttribute("aria-label", t("board.period"));
  const periodButtons = [month, "all"].map((p, i) => {
    const b = button("board-period");
    b.dataset.period = p;
    b.append(drawn("✓", "board-check"), p === "all" ? t("board.period.all") : monthName(p));
    b.style.transform = `rotate(${PERIOD_TILT[i]}deg)`;
    b.addEventListener("click", () => {
      if (state.period === p) return;
      state.period = p;
      void refresh();
    });
    periods.append(b);
    return b;
  });
  const counts = el("div", "board-counts");
  counts.setAttribute("role", "group");
  counts.setAttribute("aria-label", t("board.count"));
  const countButtons = COUNTS.map((c) => {
    const b = button(`board-count k-${c}`);
    b.dataset.count = c;
    b.append(drawn("", "board-dot"), t(`board.count.${c}`));
    b.addEventListener("click", () => {
      if (state.count === c) return;
      state.count = c;
      void refresh();
    });
    counts.append(b);
    return b;
  });
  filters.append(periods, counts);

  // --- the podium, your place, the list ---------------------------------------------
  const podium = el("div", "board-podium");
  const pod = el("ol", "board-pod");
  pod.setAttribute("aria-label", t("board.podium"));
  podium.append(drawn("", "board-rays"), drawn("", "board-dots"), pod, drawn("", "board-floor"));
  const you = el("section", "board-you");
  you.setAttribute("aria-label", t("board.you.label"));
  const heading = el("h3", "board-title");
  const list = el("ol", "board-list");
  const status = el("p", "board-note");
  status.setAttribute("role", "status");

  // --- appear in the others' leaderboard, the scale ---------------------------------
  const opt = button("board-switch");
  opt.setAttribute("role", "switch");
  const optNote = el("p", "board-note");
  optNote.setAttribute("role", "status");
  opt.addEventListener("click", async () => {
    const on = !ctx.me.leaderboard;
    opt.disabled = true;
    optNote.textContent = "";
    try {
      await setLeaderboard(on);
      ctx.me.leaderboard = on;
    } catch {
      optNote.textContent = t("board.optin.offline");
    }
    opt.disabled = false;
    drawSwitch();
    void refresh(false);
  });
  const drawSwitch = () => {
    opt.setAttribute("aria-checked", String(ctx.me.leaderboard));
    opt.replaceChildren(drawn(ctx.me.leaderboard ? "✓" : "", "board-box"), t("board.optin"));
  };
  drawSwitch();
  const signed = signedSwitch(ctx);
  const scaleToggle = button("board-scale-toggle");
  const scaleLabel = (open: boolean) =>
    scaleToggle.replaceChildren(
      t(open ? "board.scale.close" : "board.scale.open"),
      drawn(open ? "\u00a0↑" : "\u00a0↓"),
    );
  scaleLabel(false);
  scaleToggle.setAttribute("aria-expanded", "false");
  scaleToggle.setAttribute("aria-controls", "board-scale");
  const scaleBox = el("section", "board-scale");
  scaleBox.id = "board-scale";
  scaleBox.setAttribute("aria-labelledby", "board-scale-title");
  scaleBox.hidden = true;
  scaleToggle.addEventListener("click", () => {
    const open = scaleToggle.getAttribute("aria-expanded") !== "true";
    scaleToggle.setAttribute("aria-expanded", String(open));
    scaleLabel(open);
    scaleBox.hidden = !open;
    if (open) drawScale(scaleBox, state.scale);
  });

  const links = el("div", "profile-links board-links");
  // OSM lot 1: the link to OpenStreetMap first; « Changer le mot de passe » only for an
  // account that has one (an older API says nothing: every account had one).
  links.append(
    ...osmLinks(ctx),
    ...(ctx.me.password === false ? [] : passwordLink()),
    exportLink(),
    logoutLink(ctx),
    ...deleteLink(ctx),
  );
  // Back from OpenStreetMap: how it went, said once the screen is in.
  if (ctx.notice) {
    const notice = el("p", "board-note board-notice");
    notice.setAttribute("role", "status");
    const text = ctx.notice;
    setTimeout(() => {
      notice.textContent = text;
    }, 150);
    body.append(notice);
    const why = whyLine(ctx.why);
    if (why) body.append(why);
  }
  body.append(
    filters,
    podium,
    you,
    heading,
    status,
    list,
    opt,
    optNote,
    ...signed,
    ...camerasSection(ctx, () => openLeaderboard(ctx)),
    scaleToggle,
    scaleBox,
    ...syncSection(ctx),
    links,
    legalLinks("account-legal", "account-link"),
  );

  const draw = (rise: boolean) => {
    periodButtons.forEach((b, i) => {
      const on = b.dataset.period === state.period;
      b.setAttribute("aria-pressed", String(on));
      b.style.transform = on
        ? `translate(3px, 3px) rotate(${PERIOD_TILT[i]}deg)`
        : `rotate(${PERIOD_TILT[i]}deg)`;
    });
    countButtons.forEach((b, i) => {
      const on = b.dataset.count === state.count;
      b.setAttribute("aria-pressed", String(on));
      b.style.transform = on ? `rotate(${COUNT_TILT[i]}deg)` : "";
    });
    const rows = state.board?.rows ?? [];
    const max = Math.max(1, ...rows.map((r) => r.points));
    podium.hidden = rows.length === 0;
    drawPodium(pod, rows.slice(0, 3), max, rise);
    drawYou(you, state, rows.find((r) => r.me)?.rank ?? null, ctx.me.leaderboard);
    const when =
      state.period === "all"
        ? t("board.when.all")
        : t("board.when.month", { month: monthName(state.period).toLocaleLowerCase("fr") });
    heading.replaceChildren(el("span", "", t(`board.count.${state.count}`)), ` ${when}`);
    drawList(list, rows.slice(3), rows, max, state);
    status.textContent = state.failed
      ? t("board.offline")
      : state.board && rows.length === 0
        ? t("board.empty")
        : "";
    status.hidden = status.textContent === "";
    heading.hidden = rows.length <= 3;
  };

  /** The period's or the sort's leaderboard and your points; the podium rises again. */
  const refresh = async (rise = true) => {
    draw(false);
    try {
      const [b, s] = await Promise.all([
        leaderboard(state.period, state.count),
        score(state.period),
      ]);
      if (!page.isConnected) return;
      state.board = b;
      state.score = s;
      state.scale = b.scale ?? state.scale;
      state.failed = false;
      if (!scaleBox.hidden) drawScale(scaleBox, state.scale);
    } catch {
      if (!page.isConnected) return;
      state.failed = true;
    }
    draw(rise);
  };

  draw(false);
  ctx.show();
  settle(ctx, page, title);
  if (ctx.notice) {
    title.tabIndex = -1;
    title.focus({ preventScroll: true });
  }
  void refresh();
}

/** « Afficher mon pseudonyme sur les caméras que j'ai relevées » (lot U, owner's decision of
 * 2026-10-18): 26a's switch, as « Apparaître dans le classement des autres », off by
 * default, with what it reveals said under it (who reads the cameras' sheets can follow
 * where she went); PUT /api/me/history-pseudonym both ways, which holds at once. An older
 * API that does not say the choice: no switch. */
function signedSwitch(ctx: ProfileContext): HTMLElement[] {
  if (typeof ctx.me.history_pseudonym !== "boolean") return [];
  const sw = button("board-signed");
  sw.setAttribute("role", "switch");
  const help = el("p", "board-note board-signed-help", t("board.signed.help"));
  help.id = "board-signed-help";
  sw.setAttribute("aria-describedby", help.id);
  const note = el("p", "board-note");
  note.setAttribute("role", "status");
  const draw = () => {
    const on = ctx.me.history_pseudonym === true;
    sw.setAttribute("aria-checked", String(on));
    sw.replaceChildren(drawn(on ? "✓" : "", "board-box"), t("board.signed"));
  };
  sw.addEventListener("click", async () => {
    const on = ctx.me.history_pseudonym !== true;
    sw.disabled = true;
    note.textContent = "";
    try {
      await setHistoryPseudonym(on);
      ctx.me.history_pseudonym = on;
    } catch {
      note.textContent = t("board.optin.offline");
    }
    sw.disabled = false;
    draw();
  });
  draw();
  return [sw, help, note];
}

/** The podium (26a): the second, the first, the third; each its tag, its points and its
 * step, as high as its score; rising from the floor unless motion is unwelcome. */
function drawPodium(pod: HTMLElement, top3: Board["rows"], max: number, rise: boolean): void {
  pod.replaceChildren();
  const order = [1, 0, 2].filter((i) => top3[i]);
  const steps: [HTMLElement, number][] = [];
  for (const i of order) {
    const r = top3[i];
    const li = el("li", `board-place p${i + 1}${r.me ? " me" : ""}`);
    const tag = el("span", "board-tag", r.pseudonym);
    tag.style.transform = `rotate(${TAG_TILT[i]}deg)`;
    const pts = el("span", "board-pts", t("board.pts", { n: r.points }));
    const step = el("div", "board-step");
    step.style.transform = `rotate(${STEP_TILT[i]}deg)`;
    step.append(said(ordinal(r.rank)), drawn(String(r.rank), "board-step-n"));
    li.append(tag, pts, step);
    pod.append(li);
    steps.push([step, STEP_MIN + Math.round((STEP_RANGE * r.points) / max)]);
  }
  const still = !rise || matchMedia("(prefers-reduced-motion: reduce)").matches;
  for (const [step, h] of steps) step.style.height = `${still ? h : 0}px`;
  if (still) return;
  // Laid out from the floor, then to the scores' height (theme/punk/profile.css: the
  // transition is under the motion query).
  void pod.offsetHeight;
  for (const [step, h] of steps) step.style.height = `${h}px`;
}

/** « Vous · 4e », your points (the sort's, with its count), the bar of your four sorts, their
 * detail, and what waits for the review. */
function drawYou(you: HTMLElement, state: State, listed: number | null, shown: boolean): void {
  const s = state.score;
  you.hidden = !s;
  if (!s) return;
  const rank = listed ?? (state.count === "total" ? s.rank : null);
  const head = el("div", "board-you-head");
  const who = el(
    "span",
    "board-you-who",
    rank ? t("board.you.rank", { rank: ordinal(rank) }) : t("board.you"),
  );
  const right = el("span", "board-you-pts");
  const pts = state.count === "total" ? s.total : s.by[state.count];
  right.append(el("span", "board-you-total", t("board.pts", { n: pts })));
  if (state.count !== "total")
    right.append(
      el("span", "board-you-sub", t(`board.unit.${state.count}`, { n: s.counts[state.count] })),
    );
  head.append(who, right);
  you.replaceChildren(head);
  if (!shown) you.append(el("p", "board-you-hidden", t("board.you.hidden")));
  const bar = drawn("", "board-you-bar");
  const sum = Math.max(
    1,
    KINDS.reduce((n, k) => n + s.by[k], 0),
  );
  for (const k of KINDS) {
    if (!s.by[k]) continue;
    const seg = el("span", `board-seg k-${k}`);
    seg.style.width = `${((100 * s.by[k]) / sum).toFixed(1)}%`;
    bar.append(seg);
  }
  const legend = el("ul", "board-legend");
  for (const k of KINDS) {
    const li = el("li");
    li.append(
      drawn("", `board-dot k-${k}`),
      el("span", "board-legend-what", t(`board.unit.${k}`, { n: s.counts[k] })),
      el("span", "board-legend-pts", t("board.plus", { n: s.by[k] })),
    );
    legend.append(li);
  }
  you.append(bar, legend);
  if (s.pending > 0) you.append(el("p", "board-pending", pending(s.pending)));
}

/** The places after the podium: rank, pseudonym and its bar, points; yours on pink, after
 * « … » when it is far below. The bar: the sort's colour; in Total, yours in your four sorts
 * and the others' in the ink (the API gives the others' points, not their sorts). */
function drawList(
  list: HTMLElement,
  rest: Board["rows"],
  rows: Board["rows"],
  max: number,
  state: State,
): void {
  list.replaceChildren();
  let previous = rows[2]?.rank ?? 0;
  for (const r of rest) {
    if (r.rank > previous + 1 && r.me) {
      const gap = el("li", "board-gap", "…");
      gap.setAttribute("aria-hidden", "true");
      list.append(gap);
    }
    previous = r.rank;
    const li = el("li", `board-row${r.me ? " me" : ""}`);
    if (r.me) li.style.transform = "rotate(-1deg)";
    const name = el("span", "board-name");
    name.append(el("span", "board-pseudo", r.pseudonym));
    const bar = drawn("", "board-bar");
    const segs: [string, number][] =
      state.count !== "total"
        ? [[state.count, r.points]]
        : r.me && state.score
          ? KINDS.map((k) => [k, state.score?.by[k] ?? 0] as [string, number])
          : [["all", r.points]];
    for (const [k, v] of segs) {
      if (!v) continue;
      const seg = el("span", `board-seg k-${k}`);
      seg.style.width = `${((100 * v) / max).toFixed(1)}%`;
      bar.append(seg);
    }
    name.append(bar);
    li.append(
      el("span", "board-rank", ordinal(r.rank)),
      name,
      el("span", "board-row-pts", t("board.pts", { n: r.points })),
    );
    list.append(li);
  }
}

/** « Barème » (26a), its values the API's (rules/leaderboard.yaml). */
function drawScale(box: HTMLElement, scale: Scale | null): void {
  const h3 = el("h3", "", t("board.scale.title"));
  h3.id = "board-scale-title";
  const paperBox = el("div", "board-scale-paper");
  box.replaceChildren(paperBox);
  paperBox.append(h3);
  if (!scale) {
    paperBox.append(el("p", "board-scale-note", t("board.scale.offline")));
    return;
  }
  const items: [string, number, string][] = [
    ["add", scale.add, "add"],
    ["info", scale.info, "info"],
    ["bonus", scale.complete_bonus, "bonus"],
    ["correction", scale.correction, "correction"],
    [
      scale.verification_on_site_only ? "verification_on_site" : "verification",
      scale.verification,
      "verification",
    ],
  ];
  const ul = el("ul");
  items.forEach(([key, value, k], i) => {
    const li = el("li");
    const v = el("span", `board-scale-v k-${k}`, t("board.plus", { n: value }));
    v.style.transform = `rotate(${[-3, 2, -4, -2, 3][i]}deg)`;
    const text = el("span", "board-scale-text");
    text.append(el("b", "", t(`board.scale.${key}.title`)), el("br"), t(`board.scale.${key}`));
    li.append(v, text);
    ul.append(li);
  });
  const total = scale.add + EXAMPLE_INFOS * scale.info + scale.complete_bonus;
  const example = el("p", "board-scale-example");
  example.style.transform = "rotate(-0.8deg)";
  example.append(
    t("board.scale.example", {
      n: EXAMPLE_INFOS,
      add: scale.add,
      info: scale.info,
      bonus: scale.complete_bonus,
    }),
    el("b", "", t("board.pts", { n: total })),
    ".",
  );
  paperBox.append(ul, example, el("p", "board-scale-note", t("board.scale.note")));
}

/** The account and OpenStreetMap (OSM lot 1; GET /api/me's `osm`, an older API without it:
 * nothing): not linked, « Relier à OpenStreetMap » (a link to the API's flow, coming back
 * here, when GET /api/osm/status says sign-in is on); linked, « Relié à OpenStreetMap »
 * (an information line) and, for an account with a password, « Délier » (POST
 * /api/osm/unlink; without a password it would be locked out, so the API refuses it and the
 * page does not offer it). */
function osmLinks(ctx: ProfileContext): HTMLElement[] {
  if (typeof ctx.me.osm !== "boolean") return [];
  const row = el("div", "board-osm");
  const note = el("p", "board-note board-osm-note");
  note.setAttribute("role", "status");
  const draw = (login: boolean, focus = false) => {
    row.replaceChildren();
    if (!ctx.me.osm) {
      row.hidden = !login;
      if (!login) return;
      const [open, form] = linkForm();
      row.append(open, form);
      if (focus) open.focus(); // once in the page: before, focus() does nothing
      return;
    }
    row.hidden = false;
    const linked = el("p", "board-osm-linked");
    linked.append(drawn("✓ ", "board-osm-check"), t("board.osm.linked"));
    row.append(linked);
    if (!login || ctx.me.password === false) return;
    const unlinkButton = link(t("board.osm.unlink"), "board-osm-unlink");
    unlinkButton.setAttribute("aria-describedby", "board-osm-linked");
    linked.id = "board-osm-linked";
    unlinkButton.addEventListener("click", async () => {
      unlinkButton.disabled = true;
      note.textContent = "";
      const result = await unlink();
      if (result === "ok") {
        ctx.me.osm = false;
        draw(login, true);
        note.textContent = t("board.osm.unlinked");
        return;
      }
      unlinkButton.disabled = false;
      note.textContent = t(
        result === "no_password" ? "board.osm.no_password" : "board.osm.unlink_failed",
      );
    });
    row.append(unlinkButton);
  };
  row.hidden = true;
  void osmLogin().then((login) => draw(login));
  return [row, note];
}

/** « Relier à OpenStreetMap »: the password asked again (a stolen session alone must not
 * link its thief's OSM user), then OSM's page (the page as it is now comes back). */
function linkForm(): [HTMLButtonElement, HTMLFormElement] {
  const open = link(t("board.osm.link"), "board-osm-link");
  open.setAttribute("aria-expanded", "false");
  open.setAttribute("aria-controls", "board-osm-link-form");
  const form = el("form", "board-password-form board-osm-link-form") as HTMLFormElement;
  form.id = "board-osm-link-form";
  form.hidden = true;
  form.noValidate = true;
  const label = el("label", "board-field");
  const input = el("input") as HTMLInputElement;
  input.type = "password";
  input.autocomplete = "current-password";
  label.append(t("board.osm.link_password"), input);
  const error = el("p", "board-form-error");
  error.id = "board-osm-link-error";
  error.setAttribute("role", "alert");
  input.setAttribute("aria-describedby", error.id);
  const submit = el("button", "account-key primary board-osm-link-submit") as HTMLButtonElement;
  submit.type = "submit";
  submit.append(el("span", "", t("board.osm.link_submit")), drawn("→"));
  const cancel = link(t("board.delete.cancel"), "board-osm-link-cancel");
  form.append(label, error, submit, cancel);
  const close = () => {
    form.hidden = true;
    open.setAttribute("aria-expanded", "false");
    input.value = "";
    input.removeAttribute("aria-invalid");
    error.textContent = "";
  };
  open.addEventListener("click", () => {
    if (!form.hidden) return close();
    form.hidden = false;
    open.setAttribute("aria-expanded", "true");
    input.focus();
  });
  cancel.addEventListener("click", () => {
    close();
    open.focus();
  });
  let sending = false;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (sending) return;
    if (!input.value) {
      error.textContent = t("board.osm.link_empty");
      input.setAttribute("aria-invalid", "true");
      input.focus();
      return;
    }
    sending = true;
    submit.setAttribute("aria-disabled", "true");
    form.setAttribute("aria-busy", "true");
    error.textContent = "";
    try {
      const { url } = await startLink(input.value);
      window.location.assign(url);
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      error.textContent = t(
        status === 401
          ? "board.osm.link_wrong"
          : status === 409
            ? "board.osm.no_password"
            : "board.osm.link_failed",
      );
      input.setAttribute("aria-invalid", "true");
      input.select();
    } finally {
      sending = false;
      submit.removeAttribute("aria-disabled");
      form.removeAttribute("aria-busy");
    }
  });
  return [open, form];
}

/** « Changer le mot de passe »: the current one and the new one (12 characters at least,
 * the server's rule), 25a's fields and blue key; the account's other sessions end. */
function passwordLink(): HTMLElement[] {
  const open = link(t("board.password"), "board-password");
  open.setAttribute("aria-expanded", "false");
  open.setAttribute("aria-controls", "board-password-form");
  const form = el("form", "board-password-form") as HTMLFormElement;
  form.id = "board-password-form";
  form.hidden = true;
  // The page says what is wrong, in its words (the browser's bubble would not).
  form.noValidate = true;
  const field = (label: string, autocomplete: AutoFill) => {
    const box = el("label", "board-field");
    const input = el("input") as HTMLInputElement;
    input.type = "password";
    input.autocomplete = autocomplete;
    box.append(label, input);
    return { box, input };
  };
  const current = field(t("board.password.current"), "current-password");
  const next = field(t("board.password.new"), "new-password");
  next.input.minLength = 12;
  const note = el("p", "board-form-error");
  note.id = "board-password-error";
  note.setAttribute("role", "alert");
  for (const f of [current, next]) f.input.setAttribute("aria-describedby", note.id);
  const done = el("p", "board-note board-password-done");
  done.setAttribute("role", "status");
  const invalid = (bad: HTMLInputElement | null) => {
    for (const f of [current, next]) f.input.toggleAttribute("aria-invalid", f.input === bad);
    if (bad) bad.setAttribute("aria-invalid", "true");
  };
  const submit = el("button", "account-key primary board-password-submit") as HTMLButtonElement;
  submit.type = "submit";
  submit.append(el("span", "", t("board.password.submit")), drawn("→"));
  const cancel = link(t("board.delete.cancel"), "board-password-cancel");
  form.append(current.box, next.box, note, submit, cancel);
  let sending = false;
  const close = () => {
    form.hidden = true;
    open.setAttribute("aria-expanded", "false");
    current.input.value = "";
    next.input.value = "";
    invalid(null);
  };
  open.addEventListener("click", () => {
    const opening = form.hidden;
    if (!opening) return close();
    form.hidden = false;
    note.textContent = "";
    done.textContent = "";
    open.setAttribute("aria-expanded", "true");
    current.input.focus();
  });
  cancel.addEventListener("click", () => {
    close();
    open.focus();
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (sending) return;
    if (!current.input.value || !next.input.value) {
      note.textContent = t("board.password.empty");
      const empty = current.input.value ? next.input : current.input;
      invalid(empty);
      empty.focus();
      return;
    }
    if (next.input.value.length < 12) {
      note.textContent = t("board.password.short");
      invalid(next.input);
      next.input.focus();
      return;
    }
    // Waiting (the server's delay may last seconds): the key pressed, as « Entrer ».
    sending = true;
    submit.setAttribute("aria-disabled", "true");
    form.setAttribute("aria-busy", "true");
    note.textContent = "";
    invalid(null);
    try {
      await changePassword(current.input.value, next.input.value);
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      note.textContent = t(
        status === 401
          ? "board.password.wrong"
          : status === 400
            ? "board.password.short"
            : "board.password.failed",
      );
      const bad = status === 401 ? current.input : status === 400 ? next.input : null;
      invalid(bad);
      if (!form.hidden) bad?.select();
      return;
    } finally {
      sending = false;
      submit.removeAttribute("aria-disabled");
      form.removeAttribute("aria-busy");
    }
    const visible = !form.hidden;
    close();
    note.textContent = "";
    done.textContent = t("board.password.done");
    if (visible) open.focus();
  });
  return [open, form, done];
}

/** « Télécharger mes données » (GET /api/me/export): the file saved by the browser under
 * the API's name; a failure said under the link, nothing saved. */
function exportLink(): HTMLElement {
  const b = link(t("board.export"), "board-export");
  b.addEventListener("click", async () => {
    b.disabled = true;
    b.parentElement?.querySelector(".board-export-error")?.remove();
    let file: Blob;
    try {
      file = await exportData();
    } catch (err) {
      b.disabled = false;
      const expired = err instanceof ApiError && err.status === 401;
      const note = el("p", "profile-error board-export-error");
      note.textContent = t(expired ? "board.export.session" : "board.export.failed");
      note.setAttribute("role", "status");
      b.after(note);
      return;
    }
    const url = URL.createObjectURL(file);
    const save = el("a") as HTMLAnchorElement;
    save.href = url;
    save.download = EXPORT_FILE;
    save.hidden = true;
    document.body.append(save);
    save.click();
    save.remove();
    // The browser has the file once the click is handled; the address is freed after.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    b.disabled = false;
  });
  return b;
}

/** « Supprimer mon compte », then the password and « Supprimer mon compte : confirmer »
 * (POST /api/me/delete): the account and its sessions gone, its contributions kept without
 * a name. */
function deleteLink(ctx: ProfileContext): HTMLElement[] {
  const open = link(t("board.delete"), "board-delete");
  open.setAttribute("aria-expanded", "false");
  open.setAttribute("aria-controls", "board-delete-form");
  const form = el("form", "board-delete-form") as HTMLFormElement;
  form.id = "board-delete-form";
  form.hidden = true;
  const warn = el("p", "board-delete-warn", t("board.delete.warn"));
  // No password (an account signed in with OpenStreetMap): the pseudonym retyped confirms.
  const byName = ctx.me.password === false;
  const label = el("label", "board-field");
  const input = el("input") as HTMLInputElement;
  if (byName) {
    input.type = "text";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.setAttribute("autocapitalize", "none");
  } else {
    input.type = "password";
    input.autocomplete = "current-password";
  }
  label.append(t(byName ? "board.delete.pseudonym" : "board.delete.password"), input);
  const error = el("p", "board-delete-error");
  error.setAttribute("role", "alert");
  const confirm = el("button", "board-delete-confirm") as HTMLButtonElement;
  confirm.type = "submit";
  confirm.append(el("span", "", t("board.delete.confirm")), drawn("→"));
  const cancel = link(t("board.delete.cancel"), "board-delete-cancel");
  form.append(warn, label, error, confirm, cancel);
  open.addEventListener("click", () => {
    const opening = form.hidden;
    form.hidden = !opening;
    open.setAttribute("aria-expanded", String(opening));
    if (opening) input.focus();
  });
  cancel.addEventListener("click", () => {
    form.hidden = true;
    open.setAttribute("aria-expanded", "false");
    input.value = "";
    error.textContent = "";
    open.focus();
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!input.value) {
      error.textContent = t(byName ? "board.delete.pseudonym_empty" : "board.delete.empty");
      input.focus();
      return;
    }
    confirm.disabled = true;
    error.textContent = "";
    try {
      await deleteAccount(byName ? { pseudonym: input.value } : { password: input.value });
    } catch (err) {
      confirm.disabled = false;
      const status = err instanceof ApiError ? err.status : 0;
      // 409: a test account, deleted by the site's owner only (its contributions with it),
      // or the last administrator, who names another one first.
      error.textContent = t(
        status === 401
          ? "board.delete.wrong"
          : status === 400 && byName
            ? "board.delete.pseudonym_wrong"
            : status === 409 && err instanceof ApiError && err.code === "last_admin"
              ? "board.delete.last_admin"
              : status === 409
                ? "board.delete.test"
                : "board.delete.failed",
      );
      input.select();
      return;
    }
    forgetVisit(ctx.me.pseudonym);
    ctx.close();
    ctx.signedOut();
  });
  return [open, form];
}
