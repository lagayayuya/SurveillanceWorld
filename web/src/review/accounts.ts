// /revue's accounts, for administrators (lot 2 « Administrer », boards P4 and P3).
// « Comptes » (?vue=comptes&q=…): a search by pseudonym, the team (reviewers and
// administrators) and the other accounts, the latest to contribute first (50 at most:
// beyond, the search); each pseudonym a link to its sheet. « Fiche utilisateur »
// (?compte=<id>): its role, month of arrival, state and sessions, OSM linked or not,
// « Publie sur OSM : oui depuis <mois> / non » and OSM's last refusal in words (the OSM
// synchronisation), its contributions counted (a send once) and listed (links to their
// cameras), its OpenStreetMap publications; « Arrêter un abus » (« Suspendre et rejeter ses
// envois en attente », in two taps) and « Compte » (role, disable or enable, « Couper
// l'accès », « Réinitialiser le mot de passe » shown once, « Exporter ses données »,
// « Supprimer… » with the pseudonym retyped). Every action asks the password again when
// the API says so (auth.ts withReauth) and enters the journal. Never an OSM id, a hash, a
// session's day, points: the API gives none.
import { t } from "../i18n";
import { call } from "../participate/api";
import { twoStep } from "../participate/decide";
import { type AdminNav, button, download, frame, shortDay, table } from "./admin";
import { withReauth } from "./auth";
import { dayText, el, fieldName, type Label, labelText, osmHost, osmReason } from "./rows";
import { errorText, fail, say } from "./say";

type Role = "contributor" | "reviewer" | "admin";
export type AccountRow = {
  id: string;
  pseudonym: string;
  role: Role;
  state: "active" | "disabled" | "placeholder";
  test: boolean;
  accepted: number;
  pending: number;
  rejected: number;
  last_day: string | null;
};
type Sheet = AccountRow & {
  since: string | null;
  osm: boolean;
  publish: boolean;
  sessions: number;
  by_status: Record<string, number>;
  contributions: {
    uuid: string;
    camera: string;
    label: Label | null;
    kind: string;
    status: string;
    day: string;
  }[];
  /** The OSM synchronisation: her choice (on, its server and month), the class of OSM's
   * last refusal (revoked, blocked, rate_limited, osm_down); absent from an older API. */
  sync?: {
    on: boolean;
    server: "dev" | "live" | null;
    since: string | null;
    last_error: string | null;
  };
  publications: {
    uuid: string;
    server: "dev" | "live";
    state: "sending" | "published" | "conflict" | "uncertain";
    reason: string | null;
    changeset: number | null;
    month: string | null;
  }[];
  protected: boolean;
  self: boolean;
};

const ROLES: Role[] = ["contributor", "reviewer", "admin"];
const roleWord = (r: Role) => t(`review.role.${r}`);

/** The tags after a pseudonym: test, désactivé, jamais activé, vous. */
function tags(r: AccountRow, self: boolean): HTMLElement[] {
  const out: HTMLElement[] = [];
  if (r.test) out.push(el("span", t("review.signal.test"), "review-tag"));
  if (r.state !== "active") out.push(el("span", t(`review.state.${r.state}`), "review-tag warn"));
  if (self) out.push(el("span", t("review.state.self"), "review-tag"));
  return out;
}

/** A pseudonym cell: the link to its sheet, its tags. */
function nameCell(r: AccountRow, nav: AdminNav): HTMLTableCellElement {
  const th = el("th", "", "review-name");
  th.scope = "row";
  const a = el("a", r.pseudonym, "review-cell-link");
  a.href = nav.href({ compte: r.id });
  a.dataset.account = r.id;
  nav.inPlace(a, () => nav.go({ compte: r.id }, "push"));
  th.append(a, ...tags(r, r.pseudonym === nav.who.pseudonym));
  return th;
}

const num = (n: number, cls = "") => el("td", String(n), `review-num ${cls}`.trim());

// --- « Comptes » ---------------------------------------------------------------------------

export async function accountsView(
  app: HTMLElement,
  nav: AdminNav,
  note: string | null,
): Promise<void> {
  const v = frame(app, nav.head("comptes"), "review-accounts", t("review.accounts.title"), note);
  const params = new URLSearchParams(window.location.search);
  const search = el("input", "", "review-search");
  search.type = "search";
  search.id = "review-accounts-search";
  search.value = (params.get("q") ?? "").slice(0, 64);
  search.placeholder = t("review.accounts.search");
  search.setAttribute("aria-label", t("review.accounts.search.label"));
  search.maxLength = 64;
  search.autocomplete = "off";
  search.spellcheck = false;
  const team = el("section", "", "review-section");
  team.setAttribute("aria-labelledby", "review-team-title");
  const teamTitle = el("h2", t("review.accounts.team"));
  teamTitle.id = "review-team-title";
  const teamBody = el("div");
  team.append(teamTitle, teamBody);
  const others = el("section", "", "review-section");
  others.setAttribute("aria-labelledby", "review-others-title");
  const othersTitle = el("h2", t("review.accounts.others"));
  othersTitle.id = "review-others-title";
  const othersBody = el("div");
  others.append(othersTitle, othersBody);
  v.main.append(search, team, others);

  let asked = 0;
  const load = async () => {
    const mine = ++asked;
    const q = search.value.trim();
    v.main.setAttribute("aria-busy", "true");
    try {
      const r = await call<{ team: AccountRow[]; accounts: AccountRow[] }>(
        "GET",
        `/api/review/accounts${q ? `?${new URLSearchParams({ q })}` : ""}`,
      );
      if (mine !== asked) return;
      const teamTable = table(t("review.accounts.team.caption"), [
        t("review.col.pseudonym"),
        t("review.col.role"),
        t("review.col.accepted"),
        t("review.col.pending"),
      ]);
      for (const a of r.team) {
        const tr = el("tr");
        tr.append(nameCell(a, nav), el("td", roleWord(a.role)), num(a.accepted), num(a.pending));
        teamTable.body.append(tr);
      }
      teamBody.replaceChildren(
        r.team.length ? teamTable.table : el("p", t("review.accounts.none"), "review-muted"),
      );
      const othersTable = table(
        t("review.accounts.others.caption"),
        [
          t("review.col.pseudonym"),
          t("review.col.last"),
          t("review.col.accepted"),
          t("review.col.pending"),
          t("review.col.rejected"),
        ],
        "review-accounts-others",
      );
      for (const a of r.accounts) {
        const tr = el("tr");
        tr.append(
          nameCell(a, nav),
          el("td", a.last_day ? shortDay(a.last_day) : t("review.none"), "review-num"),
          num(a.accepted),
          num(a.pending),
          num(a.rejected, a.rejected ? "review-bad" : ""),
        );
        othersTable.body.append(tr);
      }
      othersBody.replaceChildren(
        r.accounts.length
          ? othersTable.table
          : el(
              "p",
              q ? t("review.accounts.none_search", { q }) : t("review.accounts.none"),
              "review-muted",
            ),
        ...(r.accounts.length >= 50 ? [el("p", t("review.accounts.more"), "review-muted")] : []),
      );
    } catch (e) {
      if (mine === asked) nav.fail(e);
    } finally {
      if (mine === asked) v.main.removeAttribute("aria-busy");
    }
  };
  let timer = 0;
  search.addEventListener("input", () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      // Left meanwhile (a sheet opened): the address is no longer this view's.
      if (!search.isConnected) return;
      const q = search.value.trim();
      history.replaceState(history.state, "", nav.href({ vue: "comptes", q }));
      v.note.hidden = true;
      void load();
    }, 300);
  });
  await load();
  v.focus();
}

// --- « Fiche utilisateur » --------------------------------------------------------------------

/** « octobre 2026 » from « 2026-10 ». */
const monthText = (m: string) =>
  new Date(`${m}-15T12:00:00`).toLocaleDateString("fr", { month: "long", year: "numeric" });

/** A line of the facts: its term and its value. */
function fact(dl: HTMLDListElement, term: string, value: string | (string | Node)[]): void {
  const row = el("div", "", "review-fact");
  const dd = el("dd");
  if (typeof value === "string") dd.textContent = value;
  else dd.append(...value);
  row.append(el("dt", term), dd);
  dl.append(row);
}

/** A publication on OpenStreetMap: its month, what became of it, its changeset. */
function publicationLine(p: Sheet["publications"][number]): HTMLLIElement {
  const li = el("li");
  const parts: (string | Node)[] = [];
  if (p.month) parts.push(`${p.month} · `);
  if (p.state === "published") {
    parts.push(t("review.pub.published"));
    if (p.changeset) {
      const a = el("a", t("review.dest.changeset", { n: String(p.changeset) }));
      a.href = `${osmHost(p.server)}/changeset/${p.changeset}`;
      a.target = "_blank";
      a.rel = "noopener";
      parts.push(" · ", a);
    }
  } else if (p.state === "conflict")
    parts.push(t("review.pub.conflict", { reason: osmReason(p.reason) }));
  else parts.push(t(p.state === "uncertain" ? "review.pub.uncertain" : "review.pub.sending"));
  if (p.server === "dev") parts.push(` ${t("review.dest.dev")}`);
  li.append(...parts);
  return li;
}

/** « oui depuis octobre 2026 (serveur de test) · dernier refus d'OSM : autorisation
 * retirée » / « non ». */
function syncText(s: Sheet): string {
  const sync = s.sync;
  if (!sync) return t(s.publish ? "review.yes" : "review.no");
  const parts = [
    sync.on
      ? `${t("review.account.sync.on", { month: sync.since ? monthText(sync.since) : "–" })}${
          sync.server === "dev" ? ` ${t("review.dest.dev")}` : ""
        }`
      : t("review.no"),
  ];
  if (sync.last_error)
    parts.push(
      t("review.account.sync.error", {
        what: t(`review.account.sync.error.${sync.last_error}`),
      }),
    );
  return parts.join(" · ");
}

export async function accountView(
  app: HTMLElement,
  nav: AdminNav,
  id: string,
  note: string | null,
  password: string | null = null,
): Promise<void> {
  let s: Sheet;
  let writeOffered = false;
  try {
    const [sheet, settings] = await Promise.all([
      call<Sheet>("GET", `/api/review/account?${new URLSearchParams({ id })}`),
      call<{ osm: { write_offered: boolean } }>("GET", "/api/review/settings").catch(() => null),
    ]);
    s = sheet;
    writeOffered = Boolean(settings?.osm.write_offered);
  } catch (e) {
    // Gone (deleted meanwhile) or not an id: back to « Comptes », which says so.
    const code = (e as { code?: string }).code;
    if (code === "unknown_account" || code === "uuid") {
      nav.go({ vue: "comptes" }, "replace", errorText(e));
      return;
    }
    nav.fail(e);
    return;
  }
  if (new URLSearchParams(window.location.search).get("compte") !== id) return;

  // The bar above: back to « Comptes », the pseudonym as title.
  const top = el("header", "", "review-top review-top-camera");
  const back = el("a", t("review.account.back"), "review-back");
  back.href = nav.href({ vue: "comptes" });
  back.setAttribute("aria-label", t("review.account.back.label"));
  nav.inPlace(back, () => nav.go({ vue: "comptes" }, "push"));
  top.append(back);
  const v = frame(app, top, "review-account", s.pseudonym, note, true);
  v.main.dataset.account = s.id;
  const reload = (said: string | null, shown: string | null = null) =>
    accountView(app, nav, id, said, shown);

  const cols = el("div", "", "review-cols review-account-cols");
  const left = el("div");
  const right = el("div");
  cols.append(left, right);
  v.main.append(cols);

  // What the account is.
  const dl = el("dl", "", "review-facts");
  fact(dl, t("review.account.role"), roleWord(s.role));
  if (s.since) fact(dl, t("review.account.since"), monthText(s.since));
  fact(dl, t("review.account.state"), [
    t(`review.account.${s.state}`),
    ` · ${t("review.account.sessions", { n: s.sessions })}`,
    ...(s.test ? [" · ", el("span", t("review.account.test"), "review-tag")] : []),
  ]);
  fact(
    dl,
    t("review.account.osm"),
    t(s.osm ? "review.account.linked" : "review.account.not_linked"),
  );
  fact(dl, t("review.account.sync"), syncText(s));
  const counts = table(t("review.account.counts.caption"), [
    t("review.account.counts"),
    t("review.account.counts.n"),
  ]);
  counts.table.classList.add("review-counts");
  for (const [key, value] of [
    ["review.col.pending", String(s.pending)],
    ["review.col.accepted", String(s.accepted)],
    ["review.col.rejected", String(s.rejected)],
    ["review.col.last", s.last_day ? shortDay(s.last_day) : t("review.none")],
  ]) {
    const tr = el("tr");
    const th = el("th", t(key));
    th.scope = "row";
    tr.append(th, el("td", value, "review-num"));
    counts.body.append(tr);
  }
  left.append(dl, counts.table);

  // Its contributions, each a link to its camera's view.
  const list = el("details", "", "review-details review-account-list");
  const summary = el("summary");
  summary.append(el("h2", t("review.account.list", { n: s.contributions.length })));
  list.append(summary);
  const ul = el("ul", "", "review-links review-contribs");
  for (const c of s.contributions) {
    const li = el("li");
    const a = el("a");
    a.href = nav.href({ camera: c.camera });
    a.append(
      el("span", c.label ? labelText(c.label) : c.camera, "review-contrib-label"),
      ` · ${fieldName(c.kind)} · ${t(`part.mine.status.${c.status}`)} · ${dayText(c.day)}`,
    );
    li.append(a);
    ul.append(li);
  }
  if (s.contributions.length) list.append(ul);
  left.append(list);

  // What became of them on OpenStreetMap.
  const pubs = el("section", "", "review-box");
  pubs.setAttribute("aria-labelledby", "review-pubs-title");
  const pubsTitle = el("h2", t("review.account.publications"));
  pubsTitle.id = "review-pubs-title";
  pubs.append(pubsTitle);
  if (s.publications.length) {
    const pl = el("ul", "", "review-links");
    pl.append(...s.publications.map(publicationLine));
    pubs.append(pl);
  } else
    pubs.append(
      el(
        "p",
        t(writeOffered ? "review.account.publications.none" : "review.account.publications.off"),
        "review-muted",
      ),
    );
  left.append(pubs);

  // The actions: what each does said, its error said under it.
  const error = el("p", "", "review-error review-inline-error");
  error.hidden = true;
  const run = async <T>(act: () => Promise<T>, done: (r: T) => void): Promise<void> => {
    error.hidden = true;
    try {
      done(await withReauth(act));
    } catch (e) {
      fail(errorText(e), error);
    }
  };
  const post =
    <T>(path: string, body: Record<string, unknown>) =>
    () =>
      call<T>("POST", path, { id: s.id, ...body });
  /** Two taps (« … : confirmer »), then the action; a failure leaves the button usable. */
  const twice = (key: string, cls: string, act: () => Promise<void>) => {
    const b: HTMLButtonElement = twoStep(key, `${key}.confirm`, cls, async () => {
      await act();
      b.disabled = false;
    });
    b.type = "button";
    return b;
  };
  const blocked = s.self || s.protected;

  if (!blocked) {
    const abuse = el("section", "", "review-box danger");
    abuse.setAttribute("aria-labelledby", "review-abuse-title");
    const h2 = el("h2", t("review.abuse.title"));
    h2.id = "review-abuse-title";
    const what = el("p", `${t("review.abuse.text", { n: s.pending })} ${t("review.abuse.after")}`);
    what.id = "review-abuse-what";
    const suspend = twoStep(
      "review.abuse.button",
      "review.abuse.confirm",
      "review-button danger wide",
      () =>
        run(post<{ rejected: number }>("/api/review/account/suspend", {}), (r) => {
          void reload(t("review.abuse.done", { n: r.rejected }));
        }).finally(() => {
          suspend.disabled = false;
        }),
    );
    suspend.type = "button";
    suspend.id = "review-suspend";
    suspend.setAttribute("aria-describedby", what.id);
    abuse.append(h2, what, suspend);
    right.append(abuse);
  }

  const manage = el("section", "", "review-box");
  manage.setAttribute("aria-labelledby", "review-manage-title");
  const manageTitle = el("h2", t("review.manage.title"));
  manageTitle.id = "review-manage-title";
  manage.append(manageTitle);
  if (password) manage.append(resetBox(s.pseudonym, password));
  const buttons = el("div", "", "review-actions");
  const panel = el("div", "", "review-panel");
  panel.hidden = true;
  /** One form at a time under the buttons (the role's, the deletion's). */
  const open = (opener: HTMLButtonElement, form: HTMLElement | null) => {
    for (const b of buttons.querySelectorAll("[aria-expanded]"))
      b.setAttribute("aria-expanded", String(b === opener && form !== null));
    panel.replaceChildren(...(form ? [form] : []));
    panel.hidden = !form;
    if (form) form.querySelector<HTMLElement>("input:checked, input")?.focus();
    else opener.focus();
  };

  const placeholder = s.state === "placeholder";
  if (!s.self && !s.protected && !placeholder) {
    const role = button(t("review.manage.role"));
    role.id = "review-role";
    role.setAttribute("aria-expanded", "false");
    role.setAttribute("aria-controls", "review-panel");
    role.addEventListener("click", () =>
      open(
        role,
        role.getAttribute("aria-expanded") === "true"
          ? null
          : roleForm(
              s,
              () => open(role, null),
              (to) =>
                run(post<AccountRow>("/api/review/account/role", { role: to }), () => {
                  void reload(t("review.role.done", { role: roleWord(to) }));
                }),
            ),
      ),
    );
    buttons.append(role);
  }
  if (!s.self && !(s.protected && s.state === "active")) {
    const disabled = s.state === "disabled";
    const state = twice(
      disabled ? "review.manage.enable" : "review.manage.disable",
      "review-button small",
      () =>
        run(post<AccountRow>("/api/review/account/state", { disabled: !disabled }), () => {
          void reload(t(disabled ? "review.manage.enabled" : "review.manage.disabled"));
        }),
    );
    state.id = "review-state";
    buttons.append(state);
  }
  const cut = twice("review.manage.cut", "review-button small", () =>
    run(post<{ sessions: number }>("/api/review/account/cut", {}), (r) => {
      void reload(t("review.manage.cut.done", { n: r.sessions }));
    }),
  );
  cut.id = "review-cut";
  buttons.append(cut);
  if (!s.self && !placeholder) {
    const reset = twice("review.manage.reset", "review-button small", () =>
      run(post<{ password: string }>("/api/review/account/reset", {}), (r) => {
        say(t("review.reset.done"));
        void reload(null, r.password);
      }),
    );
    reset.id = "review-reset";
    buttons.append(reset);
  }
  const exp = button(t("review.manage.export"));
  exp.id = "review-export";
  exp.addEventListener("click", async () => {
    error.hidden = true;
    if (await download(`/api/review/account/export?${new URLSearchParams({ id: s.id })}`, error))
      say(t("review.manage.exported"));
  });
  buttons.append(exp);
  if (!blocked) {
    const del = button(t("review.manage.delete"), "review-button small danger");
    del.id = "review-delete";
    del.setAttribute("aria-expanded", "false");
    del.setAttribute("aria-controls", "review-panel");
    del.addEventListener("click", () =>
      open(
        del,
        del.getAttribute("aria-expanded") === "true"
          ? null
          : deleteForm(
              s,
              error,
              () => open(del, null),
              (typed) =>
                run(post<null>("/api/review/account/delete", { pseudonym: typed }), () => {
                  nav.go(
                    { vue: "comptes" },
                    "replace",
                    t("review.accounts.deleted", { name: s.pseudonym }),
                  );
                }),
            ),
      ),
    );
    buttons.append(del);
  }
  panel.id = "review-panel";
  manage.append(buttons, panel, error, el("p", t("review.manage.note"), "review-muted"));
  if (s.self) manage.append(el("p", t("review.manage.self"), "review-muted"));
  else if (s.protected) manage.append(el("p", t("review.manage.protected"), "review-muted"));
  else if (placeholder) manage.append(el("p", t("review.manage.placeholder"), "review-muted"));
  right.append(manage);

  if (password) {
    // Shown once: the focus on it, so that it is read and copied now.
    const box = manage.querySelector<HTMLElement>(".review-reset");
    box?.scrollIntoView({ block: "center" });
    box?.focus({ preventScroll: true });
    return;
  }
  v.focus();
}

/** « Nouveau mot de passe », once: the password, « Copier le mot de passe », and that it
 * will not be shown again (nor kept by the page: gone at the next view). */
function resetBox(name: string, password: string): HTMLElement {
  const box = el("div", "", "review-reset");
  box.tabIndex = -1;
  box.setAttribute("role", "group");
  box.setAttribute("aria-labelledby", "review-reset-title");
  const h3 = el("h3", `${t("review.reset.title")} · ${name}`);
  h3.id = "review-reset-title";
  const code = el("code", password, "review-secret");
  code.id = "review-reset-password";
  const copy = button(t("review.reset.copy"));
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(password);
      say(t("review.reset.copied"));
    } catch {
      fail(t("review.reset.copy_failed"));
      const range = document.createRange();
      range.selectNodeContents(code);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
    }
  });
  const line = el("p", "", "review-secret-line");
  line.append(code, " ", copy);
  box.append(h3, line, el("p", t("review.reset.once"), "review-warn"));
  return box;
}

/** « Rôle… »: the three roles, the current one checked, « Changer le rôle ». */
function roleForm(s: Sheet, cancel: () => void, apply: (to: Role) => void): HTMLElement {
  const form = el("form", "", "review-choice review-role-form");
  const set = el("fieldset");
  set.append(el("legend", t("review.role.legend")));
  for (const r of ROLES) {
    const label = el("label", "", "review-radio");
    const input = el("input");
    input.type = "radio";
    input.name = "review-role";
    input.value = r;
    input.checked = r === s.role;
    label.append(input, el("span", roleWord(r)));
    set.append(label);
  }
  set.append(el("p", t("review.role.hint"), "review-muted"));
  const actions = el("div", "", "review-actions");
  const no = button(t("review.role.cancel"));
  no.addEventListener("click", cancel);
  const yes = el("button", t("review.role.apply"), "review-button small primary");
  yes.type = "submit";
  actions.append(no, yes);
  form.append(set, actions);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const to = form.querySelector<HTMLInputElement>("input:checked")?.value as Role | undefined;
    if (!to || to === s.role) {
      say(t("review.role.same"));
      return;
    }
    apply(to);
  });
  return form;
}

/** « Supprimer… »: what it does, the pseudonym retyped, « Supprimer définitivement ». */
function deleteForm(
  s: Sheet,
  error: HTMLElement,
  cancel: () => void,
  apply: (typed: string) => void,
): HTMLElement {
  const form = el("form", "", "review-choice review-delete-form");
  form.append(el("h3", t("review.delete.title")), el("p", t("review.delete.text")));
  const label = el("label", "", "review-field");
  const input = el("input");
  input.id = "review-delete-name";
  input.autocomplete = "off";
  input.autocapitalize = "none";
  input.spellcheck = false;
  input.required = true;
  label.append(el("span", t("review.delete.label", { name: s.pseudonym })), input);
  const actions = el("div", "", "review-actions");
  const no = button(t("review.delete.cancel"));
  no.addEventListener("click", cancel);
  const yes = el("button", t("review.delete.submit"), "review-button small danger");
  yes.type = "submit";
  actions.append(no, yes);
  form.append(label, actions);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (input.value.trim() !== s.pseudonym) {
      fail(t("review.error.confirmation"), error);
      input.select();
      return;
    }
    apply(input.value.trim());
  });
  return form;
}
