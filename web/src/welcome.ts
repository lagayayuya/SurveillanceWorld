// The welcome panel of the punk interface (board 28a of « Accueil Surveillance World »,
// « Fan-club · une communauté de passionné.e.s »): a dark ticket over the map on a first
// visit only, what the site does as labels (Découvrir, Participer, Garanties), the four
// legal pages' links (no board: the launch lot), « Voir la carte → » at its foot, always in view (on
// a phone the rest scrolls above it). Its content is there from the first frame; two party
// poppers behind its top corners are a 1.6 s decoration (cannon.ts), none under reduced
// motion, none when the « ? » of the header ticket opens it again. Closed by ×, Escape, a
// tap outside the panel or « Voir la carte »; a dialog (focus inside while open, the page
// behind inert, the focus back on the « ? »). The visit is remembered on the device under
// a fixed key, nothing personal in it; without storage (a private window) the panel shows
// at each visit. Contributions closed (GET /api/config, config.ts): no « Participer », no
// invitation to take part in the pitch, no « Contributions vérifiées », nothing greyed in
// their place. The questions (`faq`) are kept but not shown (`FAQ_SHOWN`). Loaded by
// the punk interface alone, beside machine.ts. Its look: theme/punk/welcome.css.
import { motion, POPPERS_MS, poppers } from "./cannon";
import { hitWhenShown } from "./hit";
import { t } from "./i18n";
import { legalLinks } from "./legal";
import { CONTACT } from "./legal/contact";

const SEEN = "lacarte.welcome";

const FAQ = ["real", "levels", "estimate", "all", "grow", "data"] as const;
/** The questions whose answers speak of accounts: not asked while contributions are closed. */
const ACCOUNT_FAQ: readonly string[] = ["grow", "data"];
/** « Questions fréquentes » not shown (the owner's request, 2026-10-14); its texts kept. */
const FAQ_SHOWN = false;
const DISCOVER = ["streets", "levels", "communes", "who", "cameras"] as const;
const JOIN = ["add", "modify", "leaderboard"] as const;
const PROMISES = ["free", "open_source", "open_data", "region", "reviewed"] as const;

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

/** Seen on this device already (never asked again by itself). */
export function seen(): boolean {
  try {
    return localStorage.getItem(SEEN) === "1";
  } catch {
    return false;
  }
}

function remember(): void {
  try {
    localStorage.setItem(SEEN, "1");
  } catch {
    // No storage (a private window): the panel comes back next visit, nothing breaks.
  }
}

export class Welcome {
  /** The « ? » square under the ticket's link, after the mode's and the account's (28a). */
  readonly square: HTMLButtonElement;
  private backdrop: HTMLElement | null = null;
  private inerted: HTMLElement[] = [];
  private timer = 0;

  /** `contributions`: open (« Participer » and every question) or closed. */
  constructor(private contributions = true) {
    const b = el("button", "ticket-square welcome-square");
    b.type = "button";
    b.id = "welcome-square";
    b.setAttribute("aria-label", t("welcome.square"));
    b.setAttribute("aria-haspopup", "dialog");
    b.setAttribute("aria-expanded", "false");
    b.append(el("span", "welcome-q", "?"));
    b.firstElementChild?.setAttribute("aria-hidden", "true");
    b.addEventListener("click", () => this.open(false));
    this.square = b;
  }

  /** A first visit: the panel with its poppers, remembered at once. */
  first(): void {
    if (seen()) return;
    remember();
    this.open(true);
  }

  get isOpen(): boolean {
    return this.backdrop !== null;
  }

  /** The panel; `poppers` only on a first visit (the « ? » opens it without). */
  open(withPoppers: boolean): void {
    if (this.backdrop) return;
    // The site's counter of welcomes (hit.ts): a first visit and each « ? », once the page
    // is shown (a prerendered or background first visit counts when it is seen).
    hitWhenShown("welcome");
    const backdrop = el("div", "welcome-backdrop");
    backdrop.id = "welcome";
    const dialog = this.build();
    backdrop.append(dialog);
    // A tap outside the panel closes it; one inside does not reach the backdrop's.
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) this.close();
    });
    if (withPoppers) {
      const parts = poppers(11008);
      dialog.append(...parts);
      if (motion())
        this.timer = window.setTimeout(() => {
          for (const p of parts) if (p.classList.contains("popper-spray")) p.remove();
        }, POPPERS_MS);
    }
    // The page behind is out of reach while the panel is open (aria-modal alone is not
    // honoured everywhere): every other child of the page made inert, and given back.
    for (const child of document.body.children)
      if (child instanceof HTMLElement && !child.inert) {
        child.inert = true;
        this.inerted.push(child);
      }
    document.body.append(backdrop);
    document.body.classList.add("welcome-open");
    this.backdrop = backdrop;
    this.square.setAttribute("aria-expanded", "true");
    document.addEventListener("keydown", this.onKey, true);
    dialog.focus({ preventScroll: true });
  }

  /** Escape closes the panel before anything behind it hears it (main.ts closes the camera
   * sheet on Escape). */
  private onKey = (e: KeyboardEvent): void => {
    if (e.key !== "Escape" || !this.backdrop) return;
    e.preventDefault();
    e.stopPropagation();
    this.close();
  };

  close(): void {
    const backdrop = this.backdrop;
    if (!backdrop) return;
    this.backdrop = null;
    clearTimeout(this.timer);
    document.removeEventListener("keydown", this.onKey, true);
    for (const child of this.inerted.splice(0)) child.inert = false;
    backdrop.remove();
    document.body.classList.remove("welcome-open");
    this.square.setAttribute("aria-expanded", "false");
    // The « ? » as still as its neighbours (the author's request of 2026-10-14: 28a's
    // pulse around it is gone).
    this.square.focus({ preventScroll: true });
  }

  /** 28a's panel: the scrolled body (title, labels, questions) over its foot. */
  private build(): HTMLElement {
    const dialog = el("div", "welcome");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-label", t("welcome.dialog"));
    dialog.tabIndex = -1;
    const paper = el("div", "welcome-paper");
    const body = el("div", "welcome-body");
    // The title: « SURVEILLANCE » in the ticket's capitals, « WORLD » in five cut-out
    // letters, read as one word.
    const head = el("div", "welcome-head");
    const title = el("h2", "welcome-title");
    const world = el("span", "welcome-world");
    world.setAttribute("aria-hidden", "true");
    for (const ch of t("welcome.title.second").toLocaleUpperCase("fr"))
      world.append(el("span", "", ch));
    title.append(
      el("span", "welcome-big", t("welcome.title.first")),
      el("span", "welcome-sr", ` ${t("welcome.title.second")}`),
      world,
    );
    const close = el("button", "welcome-close");
    close.type = "button";
    close.setAttribute("aria-label", t("welcome.close"));
    const cross = el("span", "", "×");
    cross.setAttribute("aria-hidden", "true");
    close.append(cross);
    close.addEventListener("click", () => this.close());
    head.append(title, close);
    const intro = el("div", "welcome-intro");
    // The title invites no one (2026-10-15): shown whether contributions are open or not.
    const shout = el("p", "welcome-shout", t("welcome.shout"));
    // English in a French page: said as English (WCAG 3.1.2).
    shout.lang = "en";
    intro.append(shout);
    intro.append(
      el("p", "welcome-pitch", t(this.contributions ? "welcome.pitch" : "welcome.pitch.closed")),
    );
    const groups = el("div", "welcome-groups");
    const group = (key: string, items: readonly string[], cls: string) => {
      const id = `welcome-${cls}`;
      const label = el("h3", `welcome-label ${cls}`, t(key));
      label.id = id;
      const list = el("ul", `welcome-tags ${cls}`);
      list.setAttribute("aria-labelledby", id);
      for (const item of items) {
        const li = el("li", "welcome-tag");
        if (cls === "promises") {
          const tick = el("span", "welcome-tick", "✓");
          tick.setAttribute("aria-hidden", "true");
          li.append(tick);
        }
        li.append(t(`${key}.${item}`));
        list.append(li);
      }
      groups.append(label, list);
    };
    group("welcome.discover", DISCOVER, "discover");
    if (this.contributions) group("welcome.join", JOIN, "join");
    // Closed, no promise about contributions (« Contributions vérifiées »).
    const promises = PROMISES.filter((p) => this.contributions || p !== "reviewed");
    group("welcome.promises", promises, "promises");
    intro.append(groups);
    // The legal pages (legal/index.ts), opened over the panel.
    body.append(head, intro);
    if (FAQ_SHOWN) body.append(this.faq());
    body.append(legalLinks("legal-nav welcome-legal"));
    const foot = el("div", "welcome-foot");
    const go = el("button", "welcome-go");
    go.type = "button";
    const arrow = el("span", "", "→");
    arrow.setAttribute("aria-hidden", "true");
    go.append(t("welcome.go"), " ", arrow);
    go.addEventListener("click", () => this.close());
    // Who made it and where to write, quietly, right of « Voir la carte » (2026-10-17);
    // under it, from the left, where the line does not hold. The address is the deploy's
    // (legal/contact.ts); a build without one shows the credit alone.
    const byline = el("div", "welcome-byline");
    byline.append(el("p", "welcome-credit", t("welcome.credit")));
    if (CONTACT) {
      const mail = el("a", "welcome-contact", CONTACT);
      mail.href = `mailto:${CONTACT}`;
      byline.append(mail);
    }
    foot.append(go, byline);
    paper.append(body, foot);
    const drop = el("div", "welcome-drop");
    drop.append(paper);
    dialog.append(drop);
    return dialog;
  }

  /** The six questions (four while contributions are closed), one open at a time (28a). */
  private faq(): HTMLElement {
    const box = el("section", "welcome-faq");
    const label = el("h3", "welcome-label faq", t("welcome.faq"));
    label.id = "welcome-faq";
    box.setAttribute("aria-labelledby", label.id);
    const list = el("div", "welcome-questions");
    const items: { button: HTMLButtonElement; answer: HTMLElement; sign: HTMLElement }[] = [];
    const toggle = (i: number) => {
      items.forEach((it, j) => {
        const open = j === i && it.button.getAttribute("aria-expanded") !== "true";
        it.button.setAttribute("aria-expanded", String(open));
        it.answer.hidden = !open;
        it.sign.textContent = open ? "−" : "+";
      });
    };
    const asked = FAQ.filter((q) => this.contributions || !ACCOUNT_FAQ.includes(q));
    asked.forEach((q, i) => {
      const item = el("div", "welcome-question");
      const button = el("button", "welcome-ask");
      button.type = "button";
      button.setAttribute("aria-expanded", "false");
      button.setAttribute("aria-controls", `welcome-a-${q}`);
      const sign = el("span", "welcome-sign", "+");
      sign.setAttribute("aria-hidden", "true");
      button.append(el("span", "welcome-q-text", t(`welcome.faq.${q}.q`)), sign);
      const answer = el("p", "welcome-answer", t(`welcome.faq.${q}.a`));
      answer.id = `welcome-a-${q}`;
      answer.hidden = true;
      button.addEventListener("click", () => toggle(i));
      item.append(button, answer);
      list.append(item);
      items.push({ button, answer, sign });
    });
    box.append(label, list);
    return box;
  }
}
