// /revue's « Journal », for administrators (lot 2 « Administrer »; the « go » of 17/10: an
// activity feed): the contributions received and the gestures of the review, the newest
// day first, 100 at a time with « Plus » (GET /api/review/log?type=&actor=&before=, the
// cursor opaque); filtered by type (Tout · Contributions · Décisions · Administration) and
// by person (a pseudonym, any case; a contribution's author), both in the address
// (?vue=journal&type=…&qui=…). A line says the day, who (« compte supprimé », a test
// account tagged), what in a short sentence, and on what: a camera by the queue's label
// (« Fixe · Avenue de l'Arche, Courbevoie »), its id after it as a link to its view, an
// account by its pseudonym, a setting, a register document by its id — never a
// contribution's uuid, an hour or an address.
import { has, t } from "../i18n";
import { call } from "../participate/api";
import { type AdminNav, button, frame, shortDay } from "./admin";
import { answerWord, el, fieldName, fieldOrder, type Label, labelText } from "./rows";
import { errorText, fail } from "./say";

export const TYPES = ["all", "contributions", "decisions", "admin"] as const;
export type Type = (typeof TYPES)[number];

/** A contribution of a send, as the feed reads it from its table. */
export type FeedPiece = {
  kind: string;
  answer: string | null;
  direction: number | null;
  /** A move's distance, rounded to the metre. */
  distance_m: number | null;
  /** The name chosen, or proposed as typed. */
  operator_name: string | null;
  status: string;
};

export type Entry = {
  key: string;
  day: string;
  source: "journal" | "contribution";
  /** The pseudonym; null once the account is deleted, and for `signin_refused` (the site
   * itself, no person); "" also the site itself. */
  actor: string | null;
  actor_test: boolean;
  /** "contribution", or the journal's action. */
  action: string;
  pieces: FeedPiece[];
  camera: string | null;
  label: Label | null;
  target_name: string | null;
  target: string | null;
  detail: Record<string, unknown> | null;
};

const blankPiece = (p: FeedPiece) =>
  ["shape", "direction", "operator", "height", "tilt"].includes(p.kind) &&
  ["unknown", "not_visible"].includes(p.answer ?? "");

/** A piece's value in words, lower-cased where it would start with a capital mid-sentence. */
function value(p: FeedPiece): string {
  const word = answerWord({ ...p, move_m: p.distance_m, operator_proposed: null });
  return ["shape", "operator"].includes(p.kind)
    ? word.charAt(0).toLocaleLowerCase("fr") + word.slice(1)
    : word;
}

/** One piece alone, a sentence after the person: « a proposé un déplacement de 7 m ». */
function oneSentence(p: FeedPiece): string {
  if (blankPiece(p))
    return t(`review.feed.one.${p.answer}`, { field: fieldName(p.kind).toLocaleLowerCase("fr") });
  switch (p.kind) {
    case "add":
    case "agree":
    case "disagree":
      return t(`review.feed.one.${p.kind}`);
    case "verify":
      return t(`review.feed.one.verify.${p.answer ?? "present"}`);
    case "move":
      return t("review.feed.one.move", { m: Math.round(p.distance_m ?? 0) });
    default:
      return t(`review.feed.one.${p.kind}`, { v: value(p) });
  }
}

/** One piece among others: « déplacement de 7 m », « direction → 210° (sud-ouest) ». */
function shortPiece(p: FeedPiece): string {
  if (blankPiece(p)) return t(`review.feed.short.${p.answer}`, { field: fieldName(p.kind) });
  switch (p.kind) {
    case "agree":
    case "disagree":
      return t(`review.feed.short.${p.kind}`);
    case "verify":
      return t(`review.verify.${p.answer ?? "present"}`);
    case "move":
      return t("review.feed.short.move", { m: Math.round(p.distance_m ?? 0) });
    default:
      return t("review.feed.short.field", {
        field: fieldName(p.kind).toLocaleLowerCase("fr"),
        v: value(p),
      });
  }
}

/** What a send did: one piece in a sentence; an add « a ajouté une caméra : type … »; a
 * « Modifier » send « a modifié déplacement de 7 m, direction → 210° (sud-ouest) ». */
export function contributionText(pieces: FeedPiece[]): string {
  const ordered = [...pieces].sort((a, b) => fieldOrder(a.kind) - fieldOrder(b.kind));
  if (!ordered.length) return t("review.feed.sent");
  if (ordered.length === 1) return oneSentence(ordered[0]);
  const add = ordered.some((p) => p.kind === "add");
  const list = ordered
    .filter((p) => p.kind !== "add")
    .map(shortPiece)
    .join(", ");
  return t(add ? "review.feed.add_with" : "review.feed.many", { list });
}

const statusWord = (s: unknown) => t(`part.mine.status.${String(s)}`);
const roleWord = (r: unknown) => t(`review.role.${String(r)}`);

/** « de bob », « d'ana », « d'un compte supprimé »: the account a gesture was about. */
export function ofName(name: string | null): string {
  if (name === null) return t("review.feed.of.gone");
  return t(/^[aeiouhâàäéèêëîïôöûüù]/i.test(name) ? "review.feed.of.elided" : "review.feed.of", {
    name,
  });
}

/** What a line of the journal did, a sentence after the person. */
export function actionText(e: Entry): string {
  const d = e.detail ?? {};
  const name = e.target_name ?? t("review.author.gone");
  const of = ofName(e.target_name);
  const n = (k: string) => Number(d[k] ?? 0);
  const fields = [...new Set(e.pieces.map((p) => fieldName(p.kind).toLocaleLowerCase("fr")))];
  const what = fields.length ? ` (${fields.join(", ")})` : "";
  switch (e.action) {
    case "decide": {
      const to = String(d.to ?? "");
      const key = ["validated", "rejected"].includes(to) ? to : "other";
      return t(`review.feed.decide.${key}`, { name, of, to: statusWord(to) }) + what;
    }
    case "undo":
      return (
        t("review.feed.undo", { name, of, from: statusWord(d.from), to: statusWord(d.to) }) + what
      );
    case "on_site":
      return t("review.feed.on_site", { name, of }) + what;
    case "role":
      return t("review.feed.role", { name, of, from: roleWord(d.from), to: roleWord(d.to) });
    case "disable":
    case "cut":
    case "reset":
      return t(`review.feed.${e.action}`, {
        name,
        of,
        sessions: t("review.log.sessions", { n: n("sessions") }),
      });
    case "delete":
      return t("review.feed.delete", {
        name,
        of,
        kept: t("review.log.kept", { n: n("contributions") }),
      });
    case "suspend":
      return t("review.feed.suspend", {
        name,
        rejected: t("review.log.rejected", {
          n: Array.isArray(d.rejected) ? d.rejected.length : 0,
        }),
      });
    case "export_csv":
      return t("review.feed.export_csv", { rows: t("review.log.rows", { n: n("rows") }) });
    case "hide":
    case "unhide":
      return (
        t(`review.feed.${e.action}`) +
        (d.known === false && !e.label ? ` (${t("review.log.unknown")})` : "")
      );
    case "registre_accept":
      return t("review.feed.registre_accept", {
        field: has(`review.registre.field.${d.field}`)
          ? t(`review.registre.field.${d.field}`).toLocaleLowerCase("fr")
          : String(d.field ?? ""),
        id: String(e.target ?? ""),
      });
    case "registre_refuse":
      return t("review.feed.registre_refuse", { id: String(e.target ?? "") });
    case "setting":
      return t("review.feed.setting", {
        what: has(`review.settings.${e.target}`)
          ? t(`review.settings.${e.target}`)
          : String(e.target ?? ""),
        state: t(d.value ? "review.settings.on" : "review.settings.off").toLocaleLowerCase("fr"),
      });
    default:
      return has(`review.feed.${e.action}`) ? t(`review.feed.${e.action}`, { name, of }) : e.action;
  }
}

/** One line of the feed: « 16/10 · ana · a proposé un déplacement de 7 m · Fixe · Avenue
 * de l'Arche, Courbevoie », the camera's id after it, a link to its view. */
function line(e: Entry, nav: AdminNav): HTMLLIElement {
  const li = el("li", "", "review-feed-item");
  li.dataset.key = e.key;
  li.dataset.source = e.source;
  const text = el("p", "", "review-feed-line");
  const day = el("span", shortDay(e.day), "review-feed-day");
  day.tabIndex = -1;
  const sep = () => el("span", " · ", "review-feed-sep");
  text.append(day, sep());
  // The site itself (an entry refused three times: the API's actor null, or "") has no
  // person; any other null actor is a deleted account.
  if (e.actor !== "" && !(e.actor === null && e.action === "signin_refused")) {
    text.append(
      el(
        "span",
        e.actor ?? t("review.author.gone"),
        e.actor === null ? "review-feed-who gone" : "review-feed-who",
      ),
    );
    if (e.actor_test) text.append(" ", el("span", t("review.signal.test"), "review-tag"));
    text.append(sep());
  }
  text.append(
    el(
      "span",
      e.source === "contribution" ? contributionText(e.pieces) : actionText(e),
      "review-feed-what",
    ),
  );
  if (e.label) text.append(sep(), el("span", labelText(e.label), "review-feed-label"));
  li.append(text);
  if (e.camera) {
    const camera = e.camera;
    const a = el("a", camera, "review-feed-camera");
    a.href = nav.href({ camera });
    a.setAttribute("aria-label", t("review.feed.camera", { id: camera }));
    nav.inPlace(a, () => nav.go({ camera }, "push"));
    li.append(a);
  }
  return li;
}

export async function journalView(
  app: HTMLElement,
  nav: AdminNav,
  note: string | null,
): Promise<void> {
  const v = frame(app, nav.head("journal"), "review-journal", t("review.journal.title"), note);
  const params = new URLSearchParams(window.location.search);
  const asked = params.get("type") ?? "";
  let type: Type = (TYPES as readonly string[]).includes(asked) ? (asked as Type) : "all";

  const form = el("form", "", "review-journal-filters");
  form.setAttribute("role", "search");
  form.setAttribute("aria-label", t("review.journal.filters"));
  const chips = el("div", "", "review-chips review-journal-types");
  chips.setAttribute("role", "group");
  chips.setAttribute("aria-label", t("review.journal.type"));
  const chipFor = new Map<Type, HTMLButtonElement>();
  for (const k of TYPES) {
    const b = el("button", t(`review.journal.type.${k}`), "review-chip");
    b.type = "button";
    b.dataset.type = k;
    b.setAttribute("aria-pressed", String(k === type));
    b.addEventListener("click", () => {
      if (type === k) return;
      type = k;
      for (const [kk, bb] of chipFor) bb.setAttribute("aria-pressed", String(kk === type));
      form.requestSubmit();
    });
    chipFor.set(k, b);
    chips.append(b);
  }
  const whoRow = el("div", "", "review-journal-who");
  const whoLabel = el("label", "", "review-field");
  const who = el("input");
  who.id = "review-journal-who";
  who.type = "search";
  who.value = (params.get("qui") ?? "").slice(0, 64);
  who.placeholder = t("review.journal.who.placeholder");
  who.maxLength = 64;
  who.autocomplete = "off";
  who.autocapitalize = "none";
  who.spellcheck = false;
  whoLabel.append(el("span", t("review.journal.who")), who);
  const apply = el("button", t("review.journal.apply"), "review-button small");
  apply.type = "submit";
  whoRow.append(whoLabel, apply);
  form.append(chips, whoRow);
  const count = el("p", "", "review-count");
  count.setAttribute("aria-live", "polite");
  const list = el("ol", "", "review-feed");
  list.setAttribute("aria-label", t("review.journal.caption"));
  const empty = el("p", t("review.journal.none"), "review-muted");
  empty.hidden = true;
  const more = button(t("review.journal.more"));
  more.id = "review-journal-more";
  more.hidden = true;
  const error = el("p", "", "review-error review-inline-error");
  error.hidden = true;
  v.main.append(
    form,
    el("p", t("review.journal.kept"), "review-muted"),
    count,
    list,
    empty,
    error,
    more,
  );

  let next: string | null = null;
  let shown = 0;
  let asking = 0;
  const load = async (before: string | null) => {
    const mine = ++asking;
    const q = new URLSearchParams();
    if (type !== "all") q.set("type", type);
    if (who.value.trim()) q.set("actor", who.value.trim());
    if (before) q.set("before", before);
    const r = await call<{ entries: Entry[]; next: string | null }>(
      "GET",
      `/api/review/log${q.toString() ? `?${q}` : ""}`,
    );
    if (mine !== asking) return;
    if (!before) {
      list.replaceChildren();
      shown = 0;
    }
    for (const e of r.entries) list.append(line(e, nav));
    shown += r.entries.length;
    next = r.next ?? null;
    count.textContent = t("review.journal.count", { n: shown });
    list.hidden = shown === 0;
    empty.hidden = shown > 0;
    more.hidden = next === null;
  };
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    error.hidden = true;
    history.replaceState(
      history.state,
      "",
      nav.href({ vue: "journal", type: type === "all" ? "" : type, qui: who.value.trim() }),
    );
    try {
      await load(null);
    } catch (err) {
      fail(errorText(err), error);
    }
  });
  more.addEventListener("click", async () => {
    if (next === null) return;
    error.hidden = true;
    const first = list.children.length;
    try {
      await load(next);
      // The focus on the first line added (its day), Tab goes on from there.
      const added = list.children[first]?.querySelector<HTMLElement>(".review-feed-day");
      if (added) added.focus();
      else more.focus();
    } catch (err) {
      fail(errorText(err), error);
    }
  });
  try {
    await load(null);
  } catch (e) {
    nav.fail(e);
    return;
  }
  v.focus();
}
