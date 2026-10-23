// What /revue reads from its API and says of it (lot 1 « Modérer »): the queue's items
// (GET /api/review/queue), one camera's contributions (GET /api/review/camera), and the
// words for each: a camera's label (« Ajout · Dôme · Ville de Paris · Rue de Rivoli, Paris
// 1er », never an id), what waits in one line, a field before -> after, a contribution's
// status, its destination, a conflict's reason.
import { has, t } from "../i18n";
import { SETTLED, type Status, shortBuild } from "../participate/api";

/** How /revue names a camera (the served build's, or an add's own answers). */
export type Label = {
  add: boolean;
  built: boolean;
  kind: string | null;
  operator: string | null;
  operator_class: string | null;
  street: string | null;
  commune: string | null;
};

/** A waiting piece of a queue item (its contribution, the fields the line needs). */
export type Piece = {
  uuid: string;
  kind: Row["kind"];
  answer: string | null;
  direction: number | null;
  move_m: number | null;
  operator_name: string | null;
  operator_proposed: string | null;
  /** The served value of that field, null when unknown (S1: by kind). */
  before: unknown;
  batch: string | null;
  /** Lot 2 lists conflict rows too; absent = pending. Under « OSM », an applied one. */
  status?: string;
  /** A publication to OSM that needs a look (the synchronisation): in conflict or
   * uncertain; null otherwise. */
  osm?: { state: "conflict" | "uncertain"; reason: string | null; server: "dev" | "live" } | null;
};

export type Item = {
  camera: string;
  label: Label;
  pieces: Piece[];
  conflict: boolean;
  names: boolean;
  on_site: boolean | null;
  confirmed: number;
  author: { pseudonym: string | null; accepted: number; rejected: number };
  oldest_day: string;
  day: string;
  test: boolean;
  hidden?: boolean;
};

export const FILTERS = ["todo", "conflicts", "names", "osm", "all"] as const;
export type Filter = (typeof FILTERS)[number];

export type Queue = {
  summary: {
    pending: number;
    oldest_days: number | null;
    counts: Record<Exclude<Filter, "all">, number>;
  };
  items: Item[];
};

export type Near = {
  camera: string;
  kind: string;
  m: number;
  pending?: boolean;
  at: [number, number];
};

/** Where a contribution goes: stays here (`kept_edited`: its author publishes on OSM, but
 * the review changed it), or OSM — its latest publication there (sending, published,
 * conflict, uncertain), or `waiting`: its author's synchronisation is on, it leaves once
 * accepted and applied. */
export type Destination =
  | { where: "sw"; state?: "kept_edited" }
  | {
      where: "osm";
      server: "dev" | "live";
      state: "sending" | "published" | "conflict" | "uncertain" | "waiting";
      reason: string | null;
      changeset: number | null;
      month: string | null;
    };

export type Row = {
  uuid: string;
  kind: "verify" | "move" | "shape" | "direction" | "operator" | "add" | "height" | "tilt";
  /** On an added camera: its add. */
  target: string | null;
  /** A piece of a « Modifier » send: the send's uuid (migration 012). */
  batch?: string | null;
  /** An add: the cameras within review_near_m. */
  near?: Near[];
  camera: string;
  /** The author's pseudonym; null once the account is deleted. */
  author: string | null;
  test?: boolean;
  day: string;
  on_site: boolean | null;
  status: Status;
  osm_type: "n" | "w" | "r" | null;
  osm_id: number | null;
  osm_version: number | null;
  apply_build: string | null;
  apply_detail: {
    result?: string;
    reason?:
      | "osm_version"
      | "osm_deleted"
      | "same_day"
      | "osm_tags"
      | "moved"
      | "kind"
      | "duplicate"
      | "no_height";
    near?: string[];
    osm_version?: number;
    moved_m?: number;
    now?: { lon: number; lat: number; tags: Record<string, string> };
  } | null;
  decided_by: string | null;
  decided_on: string | null;
  answer: string | null;
  direction: number | null;
  operator_name: string | null;
  operator_proposed?: string | null;
  operator_choice?: "proposed" | "listed" | "none" | null;
  osm_tags: Record<string, string> | null;
  lon: number;
  lat: number;
  destination?: Destination;
  author_record?: { accepted: number; rejected: number };
  /** Other accounts confirming it on site. */
  confirmed?: number;
  payload: {
    old?: [number, number];
    position?: [number, number];
    pulled?: boolean;
    placement?: "facade" | "free";
    inside_footprint?: boolean;
    snap?: boolean;
    under_arcade?: boolean;
    move_m?: number;
    bands?: GeoJSON.FeatureCollection;
    old_bands?: GeoJSON.FeatureCollection;
    no_effect?: "no_tilt" | "no_height";
  };
};

export type Served = {
  osm_type: "n" | "w" | "r" | null;
  osm_id: number | null;
  osm_version: number | null;
  tags: Record<string, string> | null;
  kind: string;
  kind_certainty: string;
  directions: number[];
  direction_certainty: string;
  height_m: number;
  height_certainty: string;
  tilt?: string | null;
  operator_class: string | null;
  operator: string | null;
  commune: string | null;
  geom_certainty: string;
  position_source?: string | null;
  lon: number;
  lat: number;
};

export type CameraAnswer = {
  camera: string;
  label: Label;
  served: Served | null;
  field: GeoJSON.Feature[];
  contributions: Row[];
  near: Near[];
  proposed?: GeoJSON.FeatureCollection | null;
  batches?: Record<
    string,
    { bands: GeoJSON.FeatureCollection; old_bands: GeoJSON.FeatureCollection } | null
  >;
};

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = "", cls = "") {
  const e = document.createElement(tag);
  if (text) e.textContent = text;
  if (cls) e.className = cls;
  return e;
}

// --- a camera's label -------------------------------------------------------------------

const KIND_WORDS = ["dome", "multidome", "fixed", "ptz", "panorama", "alpr", "doorbell"];
/** « Dôme », « Fixe »…; « Caméra » for an unknown kind (null, or the build's default). */
export const kindWord = (kind: string | null): string =>
  t(`review.kind.${KIND_WORDS.includes(kind ?? "") ? kind : "unknown"}`);

/** « Rue de Rivoli, Paris 1er », the street alone, the commune alone, or nothing. */
export function whereOf(l: Label): string {
  if (l.street && l.commune)
    return t("review.label.where", { street: l.street, commune: l.commune });
  return l.street ?? l.commune ?? "";
}

/** « Ajout · Dôme · Ville de Paris · Rue de Rivoli, Paris 1er »: never an id; an add of
 * unknown kind « Ajout · Rue … ». */
export function labelText(l: Label): string {
  const where = whereOf(l);
  const add = l.add && !l.built;
  const known = KIND_WORDS.includes(l.kind ?? "");
  return [
    ...(add ? [t("review.label.add")] : []),
    // « Ajout · Caméra » says nothing more than « Ajout ».
    ...(add && !known ? [] : [kindWord(l.kind)]),
    ...(l.operator ? [l.operator] : []),
    ...(where ? [where] : []),
  ].join(" · ");
}

// --- fields, before and after -------------------------------------------------------------

/** The fields a decision is about, in « Modifier »'s order. */
export const FIELD_ORDER = [
  "add",
  "verify",
  "move",
  "shape",
  "direction",
  "height",
  "tilt",
  "operator",
] as const;
export const fieldOrder = (kind: string): number =>
  FIELD_ORDER.indexOf(kind as (typeof FIELD_ORDER)[number]);
export const fieldName = (kind: string): string => t(`review.field.${kind}`);
/** « inconnu » or « inconnue », as the field's name asks. */
export const unknownFor = (kind: string): string =>
  t(["direction", "height", "tilt"].includes(kind) ? "review.unknown.f" : "review.unknown.m");

const OP_CLASS: Record<string, string> = {
  public: "op.pub",
  private_outdoor: "op.pro",
  private_indoor: "op.pri",
};
/** A served operator: its name, else its class, else « inconnu ». */
export const operatorWord = (cls: string | null, name: string | null): string =>
  name ?? (cls && OP_CLASS[cls] ? t(OP_CLASS[cls]) : unknownFor("operator"));

/** « 210° (sud-ouest) ». */
export function degrees(d: number): string {
  const c = Math.round((((d % 360) + 360) % 360) / 45) % 8;
  return t("review.degrees", { d: String(Math.round(d)), c: t(`review.compass.${c}`) });
}

/** What an answer proposes, in the contributor's words. */
export function answerWord(p: {
  kind: string;
  answer: string | null;
  direction: number | null;
  move_m?: number | null;
  operator_name: string | null;
  operator_proposed?: string | null;
}): string {
  switch (p.kind) {
    case "verify":
      return t(`review.verify.${p.answer ?? "present"}`);
    case "move":
      return t("review.moved", { m: Math.round(p.move_m ?? 0) });
    case "shape":
      return t(`part.complete.shape.${p.answer}`);
    case "direction":
      return p.direction === null ? unknownFor("direction") : degrees(p.direction);
    case "height":
    case "tilt":
      return t(`chip.value.${p.kind}.${p.answer}`);
    case "operator": {
      const cls = t(`part.complete.operator.${p.answer}`);
      if (p.operator_name) return `${cls} · ${p.operator_name}`;
      if (p.operator_proposed) return t("review.named", { cls, name: p.operator_proposed });
      return cls;
    }
    default:
      return t("review.label.add");
  }
}

/** A queue piece's served value (S1's `before`, by kind), or « inconnu(e) ». */
export function beforeWord(p: Piece): string {
  const b = p.before;
  if (b === null || b === undefined) return unknownFor(p.kind);
  switch (p.kind) {
    case "shape":
      return kindWord(b as string);
    case "direction":
      return (b as number[]).map((d) => `${d}°`).join(", ");
    case "height":
      return t("review.metres", { v: b as number });
    case "tilt":
      return t(`chip.value.tilt.${b}`);
    case "operator": {
      const o = b as { class: string | null; name: string | null };
      return operatorWord(o.class, o.name);
    }
    default:
      return unknownFor(p.kind);
  }
}

/** One queue piece in a sentence: « Direction : inconnue → 210° », « Déplacement de 12 m »,
 * « Introuvable », « Qui filme : « Monop' » (nom proposé) ». */
export function pieceLine(p: Piece): string {
  if (p.kind === "verify") return t(`review.line.verify.${p.answer ?? "present"}`);
  if (p.kind === "move") return t("review.line.move", { m: Math.round(p.move_m ?? 0) });
  if (p.kind === "add") return t("review.line.add");
  if (p.kind === "operator" && p.operator_proposed)
    return t("review.line.named", { name: p.operator_proposed });
  return t("review.line.change", {
    field: fieldName(p.kind),
    before: beforeWord(p),
    after: answerWord(p),
  });
}

/** What waits on a camera, in one line: the first piece in a sentence, the others named
 * (« + direction, hauteur »); an add's answers after « + » (its type is in its label). */
export function waitLine(item: Item): string {
  const pieces = [...item.pieces].sort((a, b) => fieldOrder(a.kind) - fieldOrder(b.kind));
  if (!pieces.length) return item.conflict ? t("review.line.conflict") : t("review.line.none");
  const names = (from: Piece[]) => [
    ...new Set(from.map((p) => fieldName(p.kind).toLocaleLowerCase("fr"))),
  ];
  if (pieces.some((p) => p.kind === "add")) {
    // The type is in the label already when it comes from the add's shape answer.
    const answers = pieces.filter(
      (p) => p.kind !== "add" && !(p.kind === "shape" && item.label.kind),
    );
    return answers.length
      ? t("review.line.add_more", { list: names(answers).join(", ") })
      : t("review.line.add");
  }
  const [first, ...others] = pieces;
  const more = names(others.filter((p) => p.kind !== first.kind));
  return more.length
    ? t("review.line.more", { first: pieceLine(first), list: more.join(", ") })
    : pieceLine(first);
}

// --- a contribution -----------------------------------------------------------------------

/** A position in a building's footprint (awning, arcade); release 1 said under_arcade. */
export const inFootprint = (p: Row["payload"]) => Boolean(p.inside_footprint || p.under_arcade);
/** "facade" or "free"; release 1 stored snap and under_arcade instead. */
export function placementOf(p: Row["payload"]): string | null {
  if (p.placement) return p.placement;
  if (p.snap === undefined) return null;
  return p.snap && !p.under_arcade ? "facade" : "free";
}
/** An operator name proposed and not accepted yet: validating needs the reviewer's choice
 * (POST /api/review/decide `operator`); a rejection clears a choice made before. */
export const nameWaits = (r: Row) =>
  r.kind === "operator" && Boolean(r.operator_proposed) && !r.operator_choice;

/** What became of a proposed name, or null when none was proposed. */
export function proposedText(r: Row): string | null {
  if (!r.operator_proposed) return null;
  const name = r.operator_proposed;
  if (r.operator_choice === "listed")
    return t("review.operator.chosen.listed", { name, listed: r.operator_name ?? "" });
  if (r.operator_choice) return t(`review.operator.chosen.${r.operator_choice}`, { name });
  return t(r.status === "rejected" ? "review.operator.refused" : "review.operator.waiting", {
    name,
  });
}

/** "Je ne sais pas" / "Je ne vois pas": nothing to decide. */
export const blank = (r: Row) =>
  ["shape", "direction", "operator", "height", "tilt"].includes(r.kind) &&
  (r.answer === "unknown" || r.answer === "not_visible");

/** « appliquée au build cddac8c1 » for what a build settled, else the status. */
export function statusText(r: Row): string {
  const status = t(`part.mine.status.${r.status}`);
  return r.apply_build && SETTLED.includes(r.status)
    ? t("review.build", { status, build: shortBuild(r.apply_build) })
    : status;
}

const OSM_TYPE = { n: "node", w: "way", r: "relation" } as const;
export function historyLink(type: "n" | "w" | "r", id: number | string, text: string) {
  const a = el("a", text);
  a.setAttribute("href", `https://www.openstreetmap.org/${OSM_TYPE[type]}/${id}/history`);
  a.setAttribute("target", "_blank");
  a.setAttribute("rel", "noopener");
  return a;
}
export function tagList(tags: Record<string, string>): HTMLUListElement {
  const ul = el("ul", "", "review-tags");
  for (const [k, v] of Object.entries(tags).sort()) ul.append(el("li", `${k}=${v}`));
  return ul;
}

/** The OSM server's address, for a changeset's link. */
export const osmHost = (server: "dev" | "live"): string =>
  server === "dev" ? "https://master.apis.dev.openstreetmap.org" : "https://www.openstreetmap.org";

/** A publication conflict's reason in words; an unknown one, the general case. */
export const osmReason = (reason: string | null): string =>
  t(
    reason && has(`review.dest.reason.${reason}`)
      ? `review.dest.reason.${reason}`
      : "review.dest.reason.other",
  );

/** Where a contribution goes: stays here, waits to leave for OSM, or its latest publication
 * there (published with its changeset, in conflict, uncertain, sending). */
export function destinationLine(d: Destination | undefined): HTMLElement {
  const p = el("p", "", "review-dest");
  if (!d || d.where === "sw") {
    p.textContent = t(d?.state === "kept_edited" ? "review.dest.kept_edited" : "review.dest.sw");
    return p;
  }
  const server = d.server === "dev" ? ` ${t("review.dest.dev")}` : "";
  if (d.state === "published" && d.changeset) {
    p.append(`${t("review.dest.published")} `);
    const a = el("a", t("review.dest.changeset", { n: String(d.changeset) }));
    a.href = `${osmHost(d.server)}/changeset/${d.changeset}`;
    a.target = "_blank";
    a.rel = "noopener";
    p.append(a, server);
    return p;
  }
  if (d.state === "conflict") {
    p.textContent = `${t("review.dest.conflict", { reason: osmReason(d.reason) })}${server}`;
    return p;
  }
  const key = {
    published: "review.dest.published_same",
    uncertain: "review.dest.uncertain",
    waiting: "review.dest.waiting",
    sending: "review.dest.sending",
  }[d.state];
  p.textContent = `${t(key)}${server}`;
  return p;
}

/** Under a conflict: why, the element as OpenStreetMap has it now (position, tags), the
 * tags the contribution saw. */
export function conflictBox(r: Row): HTMLElement {
  const d = r.apply_detail ?? {};
  const box = el("div", "", "review-conflict");
  const reason = d.reason ?? "same_day";
  const key = reason === "kind" && r.kind === "tilt" ? "kind_tilt" : reason;
  box.append(
    el(
      "p",
      t(`review.conflict.${key}`, {
        old: r.osm_version ?? "–",
        now: d.osm_version ?? "–",
        m: d.moved_m ?? "–",
      }),
    ),
  );
  if (d.now) {
    const [lon, lat] = [d.now.lon.toFixed(6), d.now.lat.toFixed(6)];
    box.append(el("p", t("review.conflict.now", { lon, lat })));
    box.append(el("p", t("review.conflict.tags")), tagList(d.now.tags));
  }
  if (r.kind === "add") {
    // The OpenStreetMap cameras mapped beside it, each with its history (no raw id).
    const list = el("ul", "", "review-links");
    (d.near ?? []).forEach((id, i) => {
      const li = el("li");
      li.append(
        historyLink(
          id[0] as "n" | "w" | "r",
          id.slice(1),
          t("review.conflict.near", { n: String(i + 1) }),
        ),
      );
      list.append(li);
    });
    box.append(list);
    return box;
  }
  const link = historyLink(r.osm_type ?? "n", r.osm_id ?? "", t("review.conflict.history"));
  if (r.osm_tags) {
    const p = el("p", t("review.conflict.seen_tags"));
    p.append(" ", link);
    box.append(p, tagList(r.osm_tags));
  } else {
    const old = el("p", t("review.conflict.old"));
    old.append(" ", link);
    box.append(old);
  }
  return box;
}

/** « 16/10/2026 » from « 2026-10-16 ». */
export const dayText = (iso: string): string =>
  new Date(`${iso}T12:00:00`).toLocaleDateString("fr", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

/** Whole days since `iso` (the page's day). */
export function daysSince(iso: string): number {
  const then = new Date(`${iso}T12:00:00`).getTime();
  const now = new Date();
  now.setHours(12, 0, 0, 0);
  return Math.max(0, Math.round((now.getTime() - then) / 86_400_000));
}

/** « joe · 12 acceptées · 1 refusée », « marie_k · 1re contribution ». */
export function authorText(
  name: string | null,
  rec: { accepted: number; rejected: number },
): string {
  const who = name ?? t("review.author.gone");
  if (!rec.accepted && !rec.rejected) return t("review.author.first", { name: who });
  const parts = [who, t("review.author.accepted", { n: rec.accepted })];
  if (rec.rejected) parts.push(t("review.author.rejected", { n: rec.rejected }));
  return parts.join(" · ");
}
