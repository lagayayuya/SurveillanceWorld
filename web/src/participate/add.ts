// "Ajouter une caméra" (phase "Ajouter"): a camera the map does not have. The position
// screen is move mode (move.ts) on a point: the pin follows the map, "Sur une façade" or
// "Libre" (nothing preselected: no mount is known), the magnet on the phone, the server's
// position at rest; no current field and no move limit, the buildings fetched again around
// the pin once it is `refetch_m` from where they were. Before the add leaves, the cameras
// within `duplicate_m` (the map's, those added or proposed by others) are listed: "Est-ce
// l'une de celles-ci ?" — one tap opens its sheet and sends nothing, "Non, c'en est une
// autre" goes on. Phase "Retours terrain": nothing leaves before the end, and an add always
// goes through the three questions (each with "Je ne sais pas"): "Continuer" keeps it on the
// phone (a draft, in memory: a reload loses it) through "Compléter", whose screens have
// "‹ Retour" (back to this position screen too, the answers kept) and whose last screen
// sums the answers up and sends the add with them ("Envoyer l'ajout", one queue
// transaction); abandoned, nothing leaves. Its uuid is chosen here, so the answers name the
// camera it creates (`c` + 12 hex digits).
import { t } from "../i18n";
import { cameraCanvas, KINDS, type Kind } from "../icons";
import { facades, type PreviewBody } from "./api";
import type { AddDraft, CompleteTarget } from "./complete";
import { twoStep } from "./decide";
import { MoveMode, type MoveTarget, type Placement, type Rules } from "./move";
import { metresBetween, onSite } from "./onsite";
import { addedId, type Contribution, type Queue, today } from "./queue";

/** A camera near the point being added (the duplicates list). */
export type Nearby = { id: string; label: string; k: string; m: number; proposed: boolean };

const NEW = "c000000000000"; // the camera being placed, before its uuid

export class AddMode extends MoveMode {
  /** Where the buildings were fetched around: the magnet's frame. */
  private origin: [number, number] | null = null;
  /** Back from the questions ("‹ Retour"): the add's draft, its uuid and answers kept. */
  private pending: AddDraft | null = null;
  private refetching = false;

  constructor(
    map: import("maplibre-gl").Map,
    rules: Rules,
    private add: {
      queue: Queue;
      buildId: string;
      est: () => number;
      onExit: (sent: boolean) => void;
      /** Cameras within `m` metres of a point, nearest first. */
      nearby: (at: [number, number], m: number) => Nearby[];
      /** "Est-ce l'une de celles-ci ?": its sheet, nothing sent. */
      open: (id: string) => void;
      /** "Continuer": the "Compléter" questions on the camera it creates, the add kept
       * with them until their last screen sends it (or "‹ Retour" brings it back here). */
      added: (cam: CompleteTarget, draft: AddDraft) => void;
    },
  ) {
    super(map, rules, add);
    this.words = {
      title: "part.add.title",
      hint: "part.add.hint",
      foot: "part.complete.onsite",
      previewOk: "part.add.preview",
    };
  }

  /** Back from the first question: this screen again at the point asked, the placement
   * chosen, the draft (uuid, answers) kept for "Continuer". */
  resume(draft: AddDraft): void {
    this.map.jumpTo({ center: [draft.lon, draft.lat] });
    this.begin();
    this.pending = draft;
    this.placement = draft.placement;
    this.render();
    void this.request();
  }

  /** The position screen, the pin at the map's centre. */
  begin(): void {
    this.pending = null;
    const c = this.map.getCenter();
    const target: MoveTarget = { id: NEW, fid: -1, lngLat: [c.lng, c.lat], mg: "", k: "unknown" };
    this.origin = null;
    this.start(target);
    document.body.classList.add("adding");
  }

  protected async facadesFor() {
    const c = this.map.getCenter();
    this.origin = [c.lng, c.lat];
    return facades({ lon: c.lng, lat: c.lat });
  }

  protected placePin(): void {
    super.placePin();
    // The pin left the buildings fetched: fetch them again around it (the old ones stay
    // until the new ones come; offline, they simply stay).
    const c = this.map.getCenter();
    const far = this.origin && metresBetween(this.origin, [c.lng, c.lat]);
    if (far && far > (this.rules.add?.refetch_m ?? 40) && !this.refetching) {
      this.refetching = true;
      void this.facadesFor()
        .then((f) => {
          this.facades = f;
        })
        .catch(() => undefined)
        .finally(() => {
          this.refetching = false;
        });
    }
  }

  protected previewBody(lon: number, lat: number, placement: Placement): PreviewBody {
    return { add: true, lon, lat, placement };
  }

  protected async loadOld(): Promise<void> {
    // A camera the map does not have: no current field.
  }

  protected statusLines() {
    return { lines: [] as string[], blocked: false };
  }

  /** Where the camera goes: the server's position at rest, else the phone's. */
  private position(): [number, number] {
    const c = this.map.getCenter();
    return this.at?.lngLat ?? [c.lng, c.lat];
  }

  /** The position screen: "Annuler" asks once more; "Continuer": the questions. */
  protected render(): void {
    super.render();
    const actions = this.panel.querySelector(".part-actions");
    const ok = this.panel.querySelector<HTMLButtonElement>("#move-submit");
    if (!actions || !ok) return;
    ok.textContent = t("part.add.continue");
    const cancel = twoStep("part.cancel", "part.add.abandon_question", "part-btn quiet", async () =>
      this.exit(false),
    );
    actions.firstElementChild?.replaceWith(cancel);
  }

  /** "Continuer", after the cameras within duplicate_m are ruled out. */
  protected async submit(): Promise<void> {
    if (this.placement === null) return;
    const near = this.add.nearby(this.position(), this.rules.add?.duplicate_m ?? 5);
    if (near.length) this.renderDuplicates(near);
    else await this.proceed();
  }

  private renderDuplicates(near: Nearby[]): void {
    const p = this.panel;
    p.replaceChildren();
    p.dataset.step = "duplicates";
    const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = "") => {
      const e = document.createElement(tag);
      if (cls) e.className = cls;
      if (text) e.textContent = text;
      return e;
    };
    p.append(el("h3", "", t("part.add.duplicates.title")));
    const list = el("div", "part-answers stack part-duplicates");
    for (const c of near) {
      const b = el("button", "part-btn quiet part-duplicate");
      b.dataset.camera = c.id;
      const kind = ((KINDS as readonly string[]).includes(c.k) ? c.k : "unknown") as Kind;
      const picto = cameraCanvas(kind);
      picto.className = "part-duplicate-picto";
      picto.setAttribute("aria-hidden", "true");
      const text = el("span", "part-duplicate-text");
      text.append(
        el("span", "", c.label),
        el(
          "span",
          "part-btn-hint",
          t("part.add.duplicates.at", { m: Math.max(1, Math.round(c.m)) }),
        ),
      );
      b.append(picto, text);
      b.addEventListener("click", () => {
        this.exit(false);
        this.add.open(c.id);
      });
      list.append(b);
    }
    const other = el("button", "part-btn primary", t("part.add.duplicates.other"));
    other.id = "add-other";
    other.addEventListener("click", () => void this.proceed());
    const back = el("button", "part-btn quiet", t("part.add.duplicates.back"));
    back.addEventListener("click", () => {
      delete p.dataset.step;
      this.render();
    });
    const row = el("div", "part-actions");
    row.append(back, other);
    // Not the journey's first screen: the help line was on the position screen.
    p.append(list, row, el("p", "part-onsite", t("part.complete.onsite")));
  }

  /** Kept on the phone with the questions that follow (the server places the requested
   * point again when it leaves). Back from them, the same uuid and answers. */
  private async proceed(): Promise<void> {
    if (this.placement === null) return;
    for (const b of this.panel.querySelectorAll("button")) b.disabled = true;
    const c = this.map.getCenter();
    const at = this.position();
    const uuid = this.pending?.uuid ?? crypto.randomUUID();
    const body: Contribution = {
      kind: "add",
      build_id: this.add.buildId,
      day: today(),
      on_site: await onSite(at, this.rules),
      lon: c.lng,
      lat: c.lat,
      placement: this.placement,
    };
    const draft: AddDraft = {
      uuid,
      body,
      answers: this.pending?.answers ?? [],
      lon: c.lng,
      lat: c.lat,
      placement: this.placement,
    };
    this.exit(false);
    // Every question is asked: nothing is known of it (Asked: kind and operator unknown,
    // no direction).
    const id = addedId(uuid);
    this.add.added(
      {
        id,
        fid: -1,
        lngLat: at,
        mg: "",
        k: "unknown",
        kc: 0,
        d: -1,
        o: "unk",
        added: true,
      },
      draft,
    );
  }

  exit(sent: boolean): void {
    document.body.classList.remove("adding");
    super.exit(sent);
  }
}
