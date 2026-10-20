// The words of the OpenStreetMap synchronisation (the contract's « Synchro OSM », 16/10):
// what became of one contribution there, as « Compte »'s history and the camera sheet's
// « Vos contributions » both say it — « partira après relecture », « publiée · changeset
// n° N » (a link to the write server's changeset, a new window), « conflit : … · rien n'a
// été écrasé », « modifiée à la relecture, non publiée »… — and a camera's name from its
// label. Months only, never a day.
import { has, t } from "../i18n";
import type { SyncItem, SyncLabel } from "./osm";

/** « partira après relecture » (the review still to come), « partira après la prochaine
 * mise à jour de la carte » (accepted, no build applied it yet), « partira au prochain
 * envoi » (applied: the job's next pass). */
function waiting(status: string): string {
  if (status === "pending") return t("sync.state.waiting.pending");
  if (status === "applied") return t("sync.state.waiting.applied");
  return t("sync.state.waiting.validated");
}

/** A conflict's reason in words; an unknown one, the general case. */
export const reasonText = (reason: string | null): string =>
  t(reason && has(`sync.reason.${reason}`) ? `sync.reason.${reason}` : "sync.reason.other");

/** The changeset's link: « changeset n° 12345 ↗ » on the write server, a new window. */
export function changesetLink(url: string, n: number): HTMLAnchorElement {
  const a = document.createElement("a");
  a.className = "sync-changeset";
  a.href = `${url}/changeset/${n}`;
  a.target = "_blank";
  a.rel = "noopener";
  // As a string: the number is an id, not a quantity (no thousands' space).
  a.append(t("sync.changeset", { n: String(n) }));
  const arrow = document.createElement("span");
  arrow.setAttribute("aria-hidden", "true");
  arrow.textContent = " ↗";
  const said = document.createElement("span");
  said.className = "sheet-sr sr";
  said.textContent = ` ${t("sheet.punk.new_window")}`;
  a.append(arrow, said);
  return a;
}

/** What became of `item` on OSM, as text and, once published, the changeset's link (`url`
 * the write server's address). */
export function stateParts(item: SyncItem, url: string | null): (string | Node)[] {
  switch (item.state) {
    case "waiting":
      return [waiting(item.status)];
    case "gone":
      if (item.changeset !== null && url)
        return [`${t("sync.state.gone")} · `, changesetLink(url, item.changeset)];
      return [item.changeset === null ? t("sync.state.gone_same") : t("sync.state.gone")];
    case "conflict":
      return [t("sync.state.conflict", { reason: reasonText(item.reason) })];
    default:
      return [t(`sync.state.${item.state}`)];
  }
}

/** « Dôme · Ville de Courbevoie · Rue de Bezons, Courbevoie »: the punk sheet's title for
 * the kind (« Ajout » for an add no build has applied yet), its operator, where it is. */
export function cameraName(label: SyncLabel | null): string {
  if (!label) return t("sheet.punk.title.unknown");
  const kind = `sheet.punk.title.${label.kind}`;
  const title =
    label.add && !label.built && !has(kind)
      ? t("sync.added")
      : t(has(kind) ? kind : "sheet.punk.title.unknown");
  const where =
    label.street && label.commune
      ? `${label.street}, ${label.commune}`
      : (label.street ?? label.commune ?? "");
  return [title, label.operator, where].filter(Boolean).join(" · ");
}
