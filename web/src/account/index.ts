// Access to an account in the punk interface (lot « comptes », board 25a; board 28a since
// the lot of 2026-10-11): the account square under the ticket's link, beside the sun / moon
// one; signed out, the sheet it opens in place of the camera sheet, « Compte »: with
// OpenStreetMap's sign-in on (account/osm.ts), 28a's one way in, « Connexion et inscription
// passent par OpenStreetMap », the key « Se connecter avec OpenStreetMap » (its « serveur de
// test » label while sign-in goes through OSM's test server), « Rien n'est publié sans votre
// accord. », « La carte se lit sans compte. » and « Me contacter », a discreet link; without
// it, 25a's « Inscriptions fermées » stamp and « Me contacter ». The password form
// (« Entrer »: identifiant, mot de passe, its error) is no longer in « Compte »: the review
// account, the test account and particular cases reach it by /revue's own sign-in or by an
// address nothing links to, `?compte=motdepasse`. Signed in, the square shows the
// pseudonym's initials and opens the account's screen, 26a's leaderboard
// (profile/leaderboard.ts). Every contribution started signed out opens « Compte » first
// (`require`); a camera sheet's greyed buttons send the person back to that camera after
// OpenStreetMap. The page the API sends back to says how it went (`?osm=`, and `?osm_why=`
// on a failure, shown only under `?debug=1`; read once by `land`): a first sign-in asks the
// pseudonym (« Choisissez votre pseudonyme »), the others a line where the person lands.
// Nothing is sent by mail from the site: « Me contacter » is a mailto: to the address the
// deploy gives the build (VITE_CONTACT_EMAIL, never in the repository), with a subject and a
// body to fill in; nothing is stored. Loaded by the punk interface only, beside machine.ts.
// Sizes, fonts and colours are 25a's and 28a's (theme/punk/account.css).
import { cutout, fitTitle, pinHead } from "../chips";
import { siteConfig } from "../config";
import { t } from "../i18n";
import { legalLink, legalLinks, template } from "../legal";
import { CONTACT } from "../legal/contact";
import { endFirstLoad, loading } from "../loading";
import { openLeaderboard } from "../profile/leaderboard";
import { readParam, writeParams } from "../url";
import {
  comeBackTo,
  forgetSync,
  loginHref,
  type Outcome,
  osmLogin,
  osmTestServer,
  readSignup,
  type Signup,
  type SignupRead,
  sendSignup,
  takeReturn,
  validPseudonym,
  type Why,
  whyLine,
} from "./osm";
import {
  initials,
  type LoginResult,
  loadSession,
  login,
  logout,
  onSession,
  pseudonym,
  type Session,
  settled,
} from "./session";

/** What main.ts lends the account's sheets: the camera sheet's panel (#sheet), opened in
 * place of whatever it showed (the camera, the area, the focus let go). */
export type SheetHost = {
  /** #sheet: a sheet renders into it, then calls `show`. */
  sheet: HTMLElement;
  /** Show what was rendered, at that height on a phone (bottomsheet.ts). */
  show(state?: "peek" | "half" | "full"): void;
  /** Close the sheet (as its × does). */
  close(): void;
  /** The phone's handle: peek → half → full. */
  step(): void;
  /** « Mes caméras » (lot U): a camera's sheet by id in this panel (profile/context.ts). */
  openCamera?: (id: string, at: [number, number] | null) => Promise<boolean>;
};

/** « Me contacter » (`ask`, a request for an account) and « Mot de passe oublié ? »
 * (`forgot`): the same address, their own subject and body (25a's). */
export function mailto(kind: "ask" | "forgot"): string {
  const subject = encodeURIComponent(t(`account.mail.${kind}.subject`));
  const body = encodeURIComponent(t(`account.mail.${kind}.body`));
  return `mailto:${CONTACT}?subject=${subject}&body=${body}`;
}

const OSM = "https://www.openstreetmap.org/";

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls = "",
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
/** Seen, not said (an arrow). */
const drawn = (text: string, cls = "") => {
  const e = el("span", cls, text);
  e.setAttribute("aria-hidden", "true");
  return e;
};
/** Said, not seen. */
const said = (text: string) => el("span", "sheet-sr", text);

/** An external link as the sheets write them: « ↗ », and « (nouvelle fenêtre) » said. */
function outLink(href: string, text: string, cls = "account-link"): HTMLAnchorElement {
  const a = el("a", cls, text);
  a.href = href;
  a.target = "_blank";
  a.rel = "noopener";
  // A no-break space: a flex item's leading space would collapse.
  a.append(drawn(" ↗"), said(` ${t("sheet.punk.new_window")}`));
  return a;
}

/** 25a's key: the word in capitals, what it does in small type, an arrow. */
function key<K extends "a" | "button">(tag: K, word: string, sub: string, cls: string) {
  const k = el(tag, `account-key ${cls}`) as HTMLElementTagNameMap[K];
  if (k instanceof HTMLButtonElement) k.type = "button";
  k.append(el("span", "account-key-word", word), drawn(sub ? `${sub} →` : "→", "account-key-sub"));
  return k;
}

/** A line said where the person lands after OpenStreetMap: the key of its text, on the
 * error's yellow band when something did not go through; `why`, the server's reason for a
 * failure (`?osm_why=`), shown under it only under `?debug=1`. */
export type Notice = {
  key: string;
  params?: Record<string, string>;
  warn?: boolean;
  why?: Why | null;
};

/** The landing outcomes that did not go through. */
const WARN: Outcome[] = [
  "link_taken",
  "link_other",
  "failed",
  "denied",
  "write_failed",
  "write_other",
  "signups_closed",
];

/** A line said where the person lands, its text set a moment after it is in the page (a
 * live region announces a change, not what it held when it appeared): what did not go
 * through an alert (28a's « retour d'OSM en échec »), the rest a status. */
function noticeLine(n: Notice): HTMLElement {
  const p = el("p", `account-notice${n.warn ? " warn" : ""}`);
  p.setAttribute("role", n.warn ? "alert" : "status");
  setTimeout(() => {
    p.textContent = t(n.key, n.params);
  }, 150);
  return p;
}

/** The person drawn in the signed-out square (25a). */
function personIcon(): SVGSVGElement {
  const NS = "http://www.w3.org/2000/svg";
  const s = document.createElementNS(NS, "svg");
  s.setAttribute("viewBox", "0 0 24 24");
  s.setAttribute("aria-hidden", "true");
  s.setAttribute("focusable", "false");
  s.setAttribute("class", "account-icon");
  const head = document.createElementNS(NS, "circle");
  head.setAttribute("cx", "12");
  head.setAttribute("cy", "8");
  head.setAttribute("r", "3.6");
  const body = document.createElementNS(NS, "path");
  body.setAttribute("d", "M5 20c.9-3.9 3.7-6 7-6s6.1 2.1 7 6");
  s.append(head, body);
  return s;
}

export class Account {
  /** The account square, under the ticket's link (machine.ts puts it beside the mode's). */
  readonly square: HTMLButtonElement;
  private state: Session = { state: "unknown" };
  /** `?osm=`, `?osm_why=` and `?compte=motdepasse` the page was opened with, taken from the
   * address at once (`land` acts on them). */
  private outcome: Outcome | null;
  private why: Why | null;
  private password: boolean;
  /** Back from OpenStreetMap to a camera (`?cam=`, a greyed button of its sheet started the
   * sign-in): signed in, its sheet opens (main.ts) in place of the account's screen. */
  private toCamera: boolean;
  /** A first sign-in's GET /api/osm/signup, asked as the page starts (beside GET /api/me,
   * main.ts), not once the map is in. */
  private signupRead: Promise<SignupRead> | null;

  constructor(private host: SheetHost) {
    const back = takeReturn();
    this.outcome = back.outcome;
    this.why = back.why;
    this.password = back.password;
    this.toCamera = back.outcome === "signed" && readParam("cam") !== null;
    this.signupRead = back.outcome === "signup" ? readSignup() : null;
    // Any other outcome shows a sheet of the account: the camera's would replace it.
    if ((back.outcome || back.password) && !this.toCamera) writeParams({ cam: null });
    const b = el("button", "ticket-square account-square");
    b.type = "button";
    b.id = "account-square";
    b.setAttribute("aria-controls", "sheet");
    b.addEventListener("click", () => {
      // From the square, OpenStreetMap brings the person back here, not to a camera.
      comeBackTo(null);
      this.open();
    });
    this.square = b;
    onSession((s) => {
      this.state = s;
      // Another account, or none: the OSM synchronisation's answer kept for the page
      // (« Compte », « Vos contributions ») was the previous one's.
      forgetSync();
      this.drawSquare();
      // Signed out: whether « Compte » offers OpenStreetMap, asked before it opens.
      if (s.state === "visitor") void osmLogin();
    });
    // Expanded while a sheet of the account is shown (this one's, or the profile's); the
    // focus back on the square when such a sheet closes with it inside (×, Escape).
    let shown = false;
    new MutationObserver(() => {
      const now = !host.sheet.hidden && host.sheet.querySelector("[data-account]") !== null;
      b.setAttribute("aria-expanded", String(now));
      const active = document.activeElement;
      const lost = !active || active === document.body || host.sheet.contains(active);
      if (shown && !now && host.sheet.hidden && lost) b.focus({ preventScroll: true });
      // « Compte » gone without a sign-in: the next one comes back where it is opened.
      if (shown && !now) comeBackTo(null);
      shown = now;
    }).observe(host.sheet, {
      attributes: true,
      attributeFilter: ["hidden"],
      childList: true,
      subtree: true,
    });
    b.setAttribute("aria-expanded", "false");
    // Back from the browser's history to a page that had left for OpenStreetMap (its
    // « Chargement » shown, askOsm): « Compte » again.
    window.addEventListener("pageshow", (e) => {
      if (e.persisted && host.sheet.querySelector('[data-account="waiting"]')) void this.ask();
    });
  }

  /** The square: signed in, the pseudonym's initials (25b); else 25a's person. */
  private drawSquare(): void {
    const b = this.square;
    if (this.state.state === "signed") {
      b.dataset.signed = "true";
      b.setAttribute("aria-label", t("account.square.signed"));
      b.replaceChildren(drawn(initials(pseudonym(this.state.me)), "account-initials"));
    } else {
      delete b.dataset.signed;
      b.setAttribute("aria-label", t("account.square.visitor"));
      b.replaceChildren(personIcon());
    }
  }

  /** The square's tap: the account's screen once signed in (26a's leaderboard, and only
   * it: one's own contributions stay in each camera's « Vos contributions »), else the
   * « Compte » sheet. */
  open(notice?: Notice): void {
    if (this.state.state === "signed") {
      const host = this.host;
      openLeaderboard({
        sheet: host.sheet,
        show: () => {
          host.show("half");
          // The square says it is expanded while a sheet of the account is shown.
          host.sheet.querySelector(".sheet-paper")?.setAttribute("data-account", "profile");
        },
        close: () => host.close(),
        grab: () => host.step(),
        me: this.state.me,
        // The screen has asked DELETE /api/session (or deleted the account): the page
        // forgets the account (logout's request again is harmless).
        signedOut: () => void logout(),
        notice: notice ? t(notice.key, notice.params) : undefined,
        why: notice?.why ?? null,
        openCamera: host.openCamera,
      });
      return;
    }
    void this.ask(notice);
  }

  /** Back from OpenStreetMap (`?osm=`), as the page starts, the map loading or not: the
   * sheet shows « Chargement de votre compte » at once (in place of the first load's
   * screen), never « Compte » before the session is known; then a first sign-in asks the
   * pseudonym; signed in on the way to a camera, its sheet (main.ts opens it from `?cam=`;
   * no sheet of the account meanwhile, which would take `?cam=` from the address); any other
   * outcome is a line on the account's screen when signed in, on « Compte » otherwise.
   * `?compte=motdepasse`: the password form, when signed out. */
  async land(): Promise<void> {
    const { outcome, why, password } = this;
    this.outcome = null;
    this.why = null;
    this.password = false;
    if (!outcome && !password) return;
    if (!this.toCamera) this.waiting();
    this.state = await settled();
    if (!outcome) {
      if (this.state.state === "signed") this.open();
      else this.form({ back: () => void this.ask() });
      return;
    }
    if (outcome === "signup") {
      if (this.state.state === "signed") this.open();
      else await this.signup();
      return;
    }
    if (this.toCamera && this.state.state === "signed") return;
    const warn = WARN.includes(outcome);
    // Signed out, a sign-in that failed says 28a's words; a first sign-in while sign-ups
    // are closed (the API's callback made no account) says lot 2's closed notice.
    const key =
      outcome === "failed" && this.state.state !== "signed"
        ? "account.osm.signin_failed"
        : outcome === "signups_closed"
          ? "account.signup.closed"
          : `account.osm.outcome.${outcome}`;
    this.open({ key, warn, why: warn ? why : null });
  }

  /** Signed in, `then` at once; else « Compte » (28a: the way in is OpenStreetMap, which
   * leaves the page: a camera sheet's buttons set where it comes back, account/osm.ts
   * comeBackTo; `_back`, the old form's « ← Retour », has no place in 28a: its × closes). */
  require(then: () => void, _back?: () => void): void {
    if (this.state.state === "signed") then();
    else void this.ask();
  }

  /** The paper of a sheet of the account: the head (title in cut-out letters, a phone's
   * handle, ×) then `body`, drawn in #sheet and shown. */
  private render(
    kind: "ask" | "form" | "signup" | "waiting",
    title: string,
    body: Node[],
    state: "peek" | "half" | "full",
  ): HTMLElement {
    const paper = el("div", `sheet-paper account-paper ${kind}`);
    paper.dataset.account = kind;
    const top = el("div", "sheet-top");
    const head = el("div", "sheet-head");
    const column = el("div", "sheet-title");
    const h2 = cutout(title, title);
    h2.id = "account-title";
    h2.tabIndex = -1;
    column.append(h2);
    const grab = el("button", "sheet-grab");
    grab.type = "button";
    grab.setAttribute("aria-label", t("sheet.grab"));
    grab.addEventListener("click", () => this.host.step());
    const close = el("button", "close");
    close.type = "button";
    close.setAttribute("aria-label", t("sheet.close"));
    close.append(drawn("×"));
    close.addEventListener("click", () => {
      this.host.close();
      this.square.focus({ preventScroll: true });
    });
    head.append(column, grab, close);
    top.append(head);
    const content = el("div", "sheet-body account-body");
    content.append(...body);
    paper.append(top, content);
    const frame = el("div", "sheet-frame");
    frame.append(paper);
    this.host.sheet.replaceChildren(frame);
    this.host.show(state);
    fitTitle(h2);
    pinHead(this.host.sheet, paper);
    return paper;
  }

  /** « Chargement de votre compte » (board 2c, loading.ts) in the account's sheet, at the
   * height of what follows (a phone's full sheet), not focused (what follows takes the
   * focus); the first load's screen leaves for it. */
  private waiting(): void {
    this.render("waiting", t("account.title"), [loading("account")], "full");
    endFirstLoad();
  }

  /** « Compte », signed out: 28a with OpenStreetMap's sign-in on (GET /api/osm/status);
   * without it, 25a frame 1's stamp and « Me contacter » (the password form is no longer
   * here). `notice`: a line at its top. */
  async ask(notice?: Notice): Promise<void> {
    if (await osmLogin()) {
      this.askOsm(notice);
      return;
    }
    const stamp = el("p", "account-stamp");
    stamp.append(
      el("span", "account-stamp-word", t("account.stamp")),
      el("span", "account-stamp-sub", t("account.stamp_sub")),
    );
    const stampRow = el("div", "account-stamp-row");
    stampRow.append(stamp);
    const contact = key("a", t("account.contact"), t("account.contact_sub"), "primary");
    contact.href = mailto("ask");
    contact.id = "account-contact";
    const keys = el("div", "account-keys");
    keys.append(contact);
    const foot = el("p", "account-foot");
    foot.append(`${t("account.osm")} `, outLink(OSM, t("account.osm_link")));
    const body: Node[] = [
      stampRow,
      el("p", "account-lead", t("account.lead")),
      keys,
      foot,
      legalLinks("account-legal", "account-link"),
    ];
    if (notice) body.unshift(...this.noticeLines(notice));
    const paper = this.render("ask", t("account.title"), body, "half");
    paper.querySelector<HTMLElement>("#account-title")?.focus({ preventScroll: true });
  }

  /** A notice and, under `?debug=1`, the server's reason. */
  private noticeLines(notice: Notice): HTMLElement[] {
    const why = whyLine(notice.why);
    return why ? [noticeLine(notice), why] : [noticeLine(notice)];
  }

  /** Board 28a, « Compte : une seule entrée, OpenStreetMap » (the author's request of
   * 2026-10-11): « Connexion et inscription passent par OpenStreetMap », « Pas encore de
   * compte OSM ? Vous le créerez en chemin. », the one key « Se connecter avec
   * OpenStreetMap » (a link to the API's flow, coming back to this page or to the camera
   * whose sheet asked; its « serveur de test » label while sign-in goes through OSM's test
   * server), « Rien n'est publié sans votre accord. », and under a dashed rule « La carte se
   * lit sans compte. » with « Me contacter », a discreet link. */
  private askOsm(notice?: Notice): void {
    const block = el("div", "account-osm");
    const title = el("p", "account-osm-title", `${t("account.osm_title")} `);
    title.append(el("span", "account-osm-mark", t("account.osm_title_mark")));
    // Sign-ups closed (GET /api/config `signups`, an administrator's switch in /revue): the
    // way in is still OpenStreetMap, for the accounts that exist.
    const lead = el(
      "p",
      "account-osm-lead",
      t(siteConfig().signups ? "account.osm_lead" : "account.osm_lead_closed"),
    );
    const osm = el("a", "account-osm-key");
    osm.id = "account-osm";
    osm.href = loginHref();
    // The page as it is when the key is used (the map may have moved since). Leaving for
    // OpenStreetMap, the sheet says « Chargement de votre compte »: the browser keeps this
    // page on the screen until the next one paints, through OpenStreetMap's redirects when
    // it asks nothing (measured: bench/loading-timeline.mjs, way `chain`), and « Compte »
    // there would say the person is still signed out. Not for a new tab or window. The page
    // goes itself: a link taken out of the page while clicked would not.
    osm.addEventListener("click", (e) => {
      osm.href = loginHref();
      if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      const href = osm.href;
      this.render("waiting", t("account.title"), [loading("account")], "full");
      window.location.assign(href);
    });
    const words = el("span", "account-osm-words");
    t("account.osm_key")
      .split("\n")
      .forEach((line, i) => {
        if (i) words.append(el("br"));
        words.append(line);
      });
    osm.append(words, drawn("→", "account-osm-arrow"));
    // On OSM's test server the key says so (its accounts are not OSM's real ones): part of
    // its name.
    if (osmTestServer()) osm.append(el("span", "account-osm-test", t("account.osm_test")));
    const kept = el("p", "account-kept", t("account.osm_kept"));
    kept.id = "account-osm-kept";
    osm.setAttribute("aria-describedby", kept.id);
    block.append(title, lead, osm, kept);
    const contact = el("a", "account-link", t("account.contact"));
    contact.href = mailto("ask");
    contact.id = "account-contact";
    const foot = el("div", "account-foot account-osm-foot");
    foot.append(el("span", "", t("account.lead")), contact);
    const body: Node[] = [block, foot, legalLinks("account-legal", "account-link")];
    if (notice) body.unshift(...this.noticeLines(notice));
    const paper = this.render("ask", t("account.title"), body, "full");
    paper.dataset.osm = "true";
    paper.querySelector<HTMLElement>("#account-title")?.focus({ preventScroll: true });
  }

  /** Back from OpenStreetMap the first time (`?osm=signup`): « Choisissez votre
   * pseudonyme », the API's suggestion in the field, « Votre nom sur OSM : … », « Valider »
   * (POST /api/osm/signup: the account made and signed in, then the account's screen).
   * The signup gone (10 min, or used), or sign-ups closed meanwhile: « Compte » again with
   * a line. */
  async signup(): Promise<void> {
    const read = await (this.signupRead ?? readSignup());
    this.signupRead = null;
    if (!read.ok) {
      await this.ask({
        key:
          read.why === "expired"
            ? "account.signup.expired"
            : read.why === "closed"
              ? "account.signup.closed"
              : "account.signup.unreadable",
        warn: true,
      });
      return;
    }
    this.signupForm(read.signup);
  }

  private signupForm(s: Signup): void {
    const name = el("p", "account-osm-name");
    name.append(`${t("account.signup.osm_name")} `, el("b", "", s.osm_name));
    const form = el("form", "account-form");
    // The page says what is wrong, in its words (the browser's bubble would not).
    form.noValidate = true;
    const label = el("label", "account-field", t("account.signup.pseudonym"));
    const input = el("input", "account-input");
    input.id = "account-signup-pseudonym";
    input.name = "username";
    input.autocomplete = "username";
    input.autocapitalize = "none";
    input.spellcheck = false;
    input.required = true;
    input.maxLength = 32;
    input.value = s.suggestion;
    label.append(input);
    const rule = el("p", "account-hint", t("account.signup.rule"));
    rule.id = "account-signup-rule";
    const error = el("p", "account-error");
    error.id = "account-signup-error";
    error.setAttribute("role", "alert");
    error.hidden = true;
    input.setAttribute("aria-describedby", rule.id);
    const submit = el("button", "account-key primary account-submit");
    submit.type = "submit";
    submit.append(el("span", "account-key-word", t("account.signup.submit")), drawn("→"));
    // The launch lot: « En validant, vous acceptez les conditions d'utilisation et de
    // contribution », the page opened over the sheet (the pseudonym typed is kept).
    const accept = el("p", "account-hint account-accept");
    accept.id = "account-signup-accept";
    const [before, after] = template("legal.accept").split("{conditions}");
    accept.append(
      before,
      // In its sentence: WCAG 2.5.8's inline exception, no 44 px target (account-inline).
      legalLink("conditions", t("legal.accept.link"), "account-link account-inline"),
      after ?? "",
    );
    submit.setAttribute("aria-describedby", accept.id);
    form.append(label, rule, error, accept, submit);
    const say = (k: string | null) => {
      error.hidden = k === null;
      error.textContent = k ? t(k) : "";
      if (k) {
        input.setAttribute("aria-invalid", "true");
        input.setAttribute("aria-describedby", `${error.id} ${rule.id}`);
      } else {
        input.removeAttribute("aria-invalid");
        input.setAttribute("aria-describedby", rule.id);
      }
    };
    let busy = false;
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (busy) return;
      const value = input.value.trim();
      if (!validPseudonym(value)) {
        say("account.signup.invalid");
        input.focus();
        return;
      }
      busy = true;
      form.setAttribute("aria-busy", "true");
      submit.setAttribute("aria-disabled", "true");
      let result: Awaited<ReturnType<typeof sendSignup>>;
      try {
        result = await sendSignup(value);
      } finally {
        busy = false;
        form.removeAttribute("aria-busy");
        submit.removeAttribute("aria-disabled");
      }
      if (result === "ok") {
        say(null);
        this.state = await loadSession();
        this.open({ key: "account.signup.done", params: { name: value } });
        return;
      }
      if (result === "expired" || result === "osm_taken" || result === "closed") {
        await this.ask({ key: `account.signup.${result}`, warn: true });
        return;
      }
      say(
        result === "taken"
          ? "account.signup.taken"
          : result === "invalid"
            ? "account.signup.invalid"
            : result === "offline"
              ? "account.signup.offline"
              : "account.signup.failed",
      );
      if (result === "taken" || result === "invalid") input.select();
    });
    const foot = el("p", "account-foot", t("account.osm_kept"));
    const back = el("button", "account-back");
    back.type = "button";
    // A no-break space: a flex item's trailing space would collapse.
    back.append(drawn("←\u00a0"), t("account.form.back"));
    back.addEventListener("click", () => void this.ask());
    this.render("signup", t("account.signup.title"), [name, form, foot, back], "full");
    input.focus({ preventScroll: true });
  }

  /** 25a frame 2: « Entrer », the login form. Once signed in the sheet closes and `then`
   * runs; `back`: « ← Retour ». */
  form(opts: { then?: () => void; back?: () => void } = {}): void {
    const form = el("form", "account-form");
    const field = (label: string, input: HTMLInputElement) => {
      const l = el("label", "account-field", label);
      l.append(input);
      return l;
    };
    const user = el("input", "account-input");
    user.id = "account-pseudonym";
    user.name = "username";
    user.autocomplete = "username";
    user.autocapitalize = "none";
    user.spellcheck = false;
    user.required = true;
    const pass = el("input", "account-input");
    pass.id = "account-password";
    pass.type = "password";
    pass.name = "password";
    pass.autocomplete = "current-password";
    pass.required = true;
    const error = el("p", "account-error");
    error.id = "account-error";
    error.setAttribute("role", "alert");
    error.hidden = true;
    const submit = el("button", "account-key primary account-submit");
    submit.type = "submit";
    submit.append(el("span", "account-key-word", t("account.form.submit")), drawn("→"));
    form.append(
      field(t("account.form.pseudonym"), user),
      field(t("account.form.password"), pass),
      error,
      submit,
    );
    const say = (key: string | null) => {
      error.hidden = key === null;
      error.textContent = key ? t(key) : "";
      for (const input of [user, pass]) {
        if (key) {
          input.setAttribute("aria-invalid", "true");
          input.setAttribute("aria-describedby", error.id);
        } else {
          input.removeAttribute("aria-invalid");
          input.removeAttribute("aria-describedby");
        }
      }
    };
    let busy = false;
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (busy) return;
      // The server answers a refusal after a delay that doubles (up to 30 s): the key
      // stays pressed meanwhile, nothing else is sent.
      busy = true;
      form.setAttribute("aria-busy", "true");
      submit.setAttribute("aria-disabled", "true");
      let result: LoginResult;
      try {
        result = await login(user.value.trim(), pass.value);
      } finally {
        busy = false;
        form.removeAttribute("aria-busy");
        submit.removeAttribute("aria-disabled");
      }
      if (result === "ok") {
        // The sheet closes; what asked for the login goes on (its sheet again, the add).
        say(null);
        this.host.close();
        if (opts.then) opts.then();
        else this.square.focus({ preventScroll: true });
        return;
      }
      say(
        result === "credentials"
          ? "account.form.error"
          : result === "offline"
            ? "account.form.offline"
            : "account.form.failed",
      );
      if (result === "credentials") {
        pass.value = "";
        pass.focus();
      }
    });
    const foot = el("p", "account-foot account-links");
    const forgot = el("a", "account-link", t("account.form.forgot"));
    forgot.id = "account-forgot";
    forgot.href = mailto("forgot");
    foot.append(forgot, outLink(OSM, t("account.form.osm")));
    const body: Node[] = [form, foot];
    const back = opts.back;
    if (back) {
      const b = el("button", "account-back");
      b.type = "button";
      // A no-break space: a flex item's trailing space would collapse.
      b.append(drawn("← "), t("account.form.back"));
      b.addEventListener("click", back);
      body.push(b);
    }
    this.render("form", t("account.form.title"), body, "full");
    user.focus({ preventScroll: true });
  }
}
