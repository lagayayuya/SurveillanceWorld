// /revue's « File » (board P1, phone first): « N en attente · la plus ancienne : D jours »,
// the filters with their counts (À traiter, Conflits, Noms, OSM, Tout: « OSM » the cameras
// with a publication to OSM in conflict or uncertain), a search (street, commune, pseudonym,
// id), and one row per camera: its label, what waits in one line, its signals (sur place,
// confirmée par N, conflit, nom à choisir, conflit OSM, envoi OSM incertain, test, masquée),
// its age and
// its author's record. A row is a link to the camera's view; the address keeps the filter
// and the search (?file=conflicts&q=…).
import { t } from "../i18n";
import { call } from "../participate/api";
import {
  authorText,
  daysSince,
  el,
  FILTERS,
  type Filter,
  type Item,
  labelText,
  type Queue,
  waitLine,
} from "./rows";

export type QueueNav = {
  filter: Filter;
  q: string;
  /** The queue's cameras in the order last shown (the camera view's « next »). */
  order: string[] | null;
  /** The camera whose view was last open: its row gets the focus back. */
  lastCamera: string | null;
  scrollY: number;
  href(params: Record<string, string>): string;
  openCamera(camera: string, how: "push" | "replace"): void;
  setQuery(filter: Filter, q: string): void;
  fail(e: unknown): void;
};

export const fetchQueue = (filter: Filter, q: string) =>
  call<Queue>("GET", `/api/review/queue?${new URLSearchParams({ filter, ...(q ? { q } : {}) })}`);

/** One row: a link to the camera's view. */
function row(item: Item, nav: QueueNav): HTMLLIElement {
  const li = el("li");
  const a = el("a", "", "review-row");
  a.href = nav.href({ camera: item.camera });
  a.dataset.camera = item.camera;
  const days = daysSince(item.oldest_day);
  const age = el("span", t("review.age", { d: String(days) }), "review-row-age");
  age.setAttribute("aria-label", t("review.age.label", { d: days }));
  const signals = el("span", "", "review-row-signals");
  if (item.conflict) signals.append(el("span", t("review.signal.conflict"), "review-tag warn"));
  if (item.names) signals.append(el("span", t("review.signal.names"), "review-tag"));
  // The OSM synchronisation: a publication in conflict, or uncertain (« OSM »'s filter).
  const osm = item.pieces.map((p) => p.osm).filter((o) => o);
  if (osm.some((o) => o?.state === "conflict"))
    signals.append(el("span", t("review.signal.osm_conflict"), "review-tag warn"));
  if (osm.some((o) => o?.state === "uncertain"))
    signals.append(el("span", t("review.signal.osm_uncertain"), "review-tag warn"));
  if (item.test) signals.append(el("span", t("review.signal.test"), "review-tag"));
  if (item.hidden) signals.append(el("span", t("review.signal.hidden"), "review-tag"));
  if (item.on_site === true) signals.append(el("span", t("review.signal.on_site"), "review-ok"));
  else if (item.on_site === false) signals.append(el("span", t("review.signal.off_site")));
  if (item.confirmed)
    signals.append(el("span", t("review.signal.confirmed", { n: item.confirmed }), "review-ok"));
  signals.append(el("span", authorText(item.author.pseudonym, item.author), "review-row-author"));
  a.append(
    el("span", labelText(item.label), "review-row-title"),
    age,
    el("span", waitLine(item), "review-row-what"),
    signals,
  );
  a.addEventListener("click", (e) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    nav.lastCamera = item.camera;
    nav.scrollY = window.scrollY;
    nav.openCamera(item.camera, "push");
  });
  li.append(a);
  return li;
}

/** The « File » view into `app`; `note`: a line said at the top (« File vide… »). */
export async function queueView(
  app: HTMLElement,
  head: HTMLElement,
  nav: QueueNav,
  note: string | null,
): Promise<void> {
  const main = el("main", "", "review-main");
  main.id = "review-queue";
  const h1 = el("h1", t("review.queue.title"));
  h1.tabIndex = -1;
  const summary = el("p", "", "review-summary");
  const message = el("p", note ?? "", "review-note");
  message.hidden = !note;
  const chips = el("div", "", "review-chips");
  chips.setAttribute("role", "group");
  chips.setAttribute("aria-label", t("review.filter.label"));
  const search = el("input", "", "review-search");
  search.type = "search";
  search.id = "review-search";
  search.value = nav.q;
  search.placeholder = t("review.search");
  search.setAttribute("aria-label", t("review.search.label"));
  search.maxLength = 64;
  search.autocomplete = "off";
  search.spellcheck = false;
  const filters = el("div", "", "review-filters");
  filters.append(chips, search);
  const count = el("p", "", "review-count");
  count.setAttribute("aria-live", "polite");
  const list = el("ul", "", "review-queue");
  // The CSV is the administrator's, in « Réglages » (lot 2).
  main.append(h1, summary, message, filters, count, list);
  app.replaceChildren(head, main);
  // No decision bar here (camera.ts sets its height).
  document.documentElement.style.removeProperty("--foot-h");

  let shown: Queue | null = null;
  const drawChips = (q: Queue | null) => {
    chips.replaceChildren(
      ...FILTERS.map((f) => {
        const b = el("button", "", "review-chip");
        b.type = "button";
        b.dataset.filter = f;
        b.setAttribute("aria-pressed", String(nav.filter === f));
        const n = f === "all" ? null : (q?.summary.counts[f] ?? null);
        b.append(el("span", t(`review.filter.${f}`)));
        if (n) b.append(" ", el("span", String(n), "review-chip-n"));
        b.addEventListener("click", () => {
          if (nav.filter === f) return;
          nav.setQuery(f, nav.q);
          message.hidden = true;
          drawChips(shown);
          void load();
        });
        return b;
      }),
    );
  };
  let asked = 0;
  const load = async () => {
    const mine = ++asked;
    list.setAttribute("aria-busy", "true");
    try {
      const q = await fetchQueue(nav.filter, nav.q);
      if (mine !== asked) return;
      shown = q;
      nav.order = q.items.map((i) => i.camera);
      const s = q.summary;
      summary.replaceChildren(
        el("strong", t("review.queue.pending", { n: s.pending })),
        ...(s.oldest_days === null
          ? []
          : [
              " · ",
              t("review.queue.oldest"),
              " ",
              el("strong", t("review.queue.days", { d: s.oldest_days })),
            ]),
      );
      drawChips(q);
      count.textContent = t("review.queue.count", { n: q.items.length });
      list.replaceChildren(...q.items.map((i) => row(i, nav)));
      if (!q.items.length)
        list.append(
          el(
            "li",
            nav.q ? t("review.queue.none_search", { q: nav.q }) : t("review.queue.none"),
            "review-empty",
          ),
        );
    } catch (e) {
      if (mine === asked) nav.fail(e);
    } finally {
      if (mine === asked) list.removeAttribute("aria-busy");
    }
  };
  let timer = 0;
  search.addEventListener("input", () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      // Left meanwhile (a camera opened): the address is no longer this view's.
      if (!search.isConnected) return;
      nav.setQuery(nav.filter, search.value.trim());
      message.hidden = true;
      void load();
    }, 300);
  });
  drawChips(null);
  await load();
  // Left meanwhile (a camera opened): its view keeps the focus.
  if (!main.isConnected) return;
  // Back from a camera: its row gets the focus back, where the list was.
  const back = nav.lastCamera
    ? list.querySelector<HTMLElement>(`a[data-camera="${CSS.escape(nav.lastCamera)}"]`)
    : null;
  if (back) {
    window.scrollTo(0, nav.scrollY);
    back.focus({ preventScroll: true });
  } else {
    window.scrollTo(0, 0);
    h1.focus({ preventScroll: true });
  }
}
