// /revue's « Registre », for reviewers and administrators (lot R1b « Signaler une erreur »): no
// one reviews the register's documents (DECISIONS 2026-10-28), so a reader's report is how it
// gets corrected. « Erreurs signalées » (h1), « N en attente · la plus ancienne : D jours »,
// then one box per reported document, the one waiting longest first: its id, « Voir le
// contrat » (/registre/contrat/<affaire>) and its age; under it each report: what is wrong
// (« Montant », « Date »…), the reader's correction, the source (a link) and the contact when
// given, « reçu il y a N jours »; and the decision: « Champ corrigé », « Valeur », « Raison »
// with « Accepter » (pink: the field and value the next `lacarte-registre construire`
// applies), or « Refuser ». Both erase the reader's contact and enter the journal
// (GET and POST /api/review/registre, lacarte.api.registre).
import { t } from "../i18n";
import { call } from "../participate/api";
import { type AdminNav, button, frame } from "./admin";
import { defaultField, FIELDS, type Field, parseValue } from "./registre-value";
import { el } from "./rows";
import { errorText, fail } from "./say";

export type Report = {
  id: string;
  category: string;
  correction: string;
  source: string | null;
  contact: string | null;
  received_on: string;
  age_days: number;
};
export type ReportedDocument = {
  evenement: string;
  affaire: string;
  age_days: number;
  reports: Report[];
};
export type Pending = { pending: number; documents: ReportedDocument[]; fields: string[] };

/** The register's page of a document's contract. */
export const contractHref = (affaire: string) => `/registre/contrat/${encodeURIComponent(affaire)}`;

let serial = 0;

/** One report and its decision. `done(note)`: decided, the list loads again. */
function reportBox(r: Report, d: ReportedDocument, done: (note: string) => void): HTMLElement {
  const n = ++serial;
  const box = el("section", "", "review-box review-registre-report");
  box.dataset.report = r.id;
  const h3 = el("h3", t(`review.registre.category.${r.category}`));
  const age = el("span", t("review.age", { d: String(r.age_days) }), "review-row-age");
  age.setAttribute("aria-label", t("review.registre.received", { d: r.age_days }));
  h3.append(" ", age);
  const said = el("p", r.correction, "review-registre-correction");
  box.append(h3, said);
  if (r.source) {
    const p = el("p", `${t("review.registre.source")} `, "review-registre-line");
    const a = el("a", r.source, "review-registre-source");
    a.href = r.source;
    a.target = "_blank";
    a.rel = "noopener noreferrer nofollow";
    p.append(a);
    box.append(p);
  }
  if (r.contact)
    box.append(
      el("p", t("review.registre.contact", { contact: r.contact }), "review-registre-line"),
    );

  // The decision: the field, the value, the reason; Accepter or Refuser.
  const form = el("form", "", "review-registre-form");
  const fieldset = el("fieldset");
  fieldset.append(el("legend", t("review.registre.decide"), "review-sr"));
  const select = el("select");
  select.id = `review-registre-field-${n}`;
  const none = el("option", t("review.registre.field.choose"));
  none.value = "";
  select.append(none);
  for (const f of FIELDS) {
    const o = el("option", t(`review.registre.field.${f}`));
    o.value = f;
    select.append(o);
  }
  const value = el("input");
  value.id = `review-registre-value-${n}`;
  value.autocomplete = "off";
  value.spellcheck = false;
  value.maxLength = 1000;
  const hint = el("p", "", "review-muted review-registre-hint");
  hint.id = `review-registre-hint-${n}`;
  value.setAttribute("aria-describedby", hint.id);
  const reason = el("input");
  reason.id = `review-registre-reason-${n}`;
  reason.autocomplete = "off";
  reason.maxLength = 500;
  const label = (text: string, control: HTMLElement) => {
    const l = el("label", "", "review-field");
    l.append(el("span", text), control);
    return l;
  };
  const error = el("p", "", "review-error review-inline-error");
  error.hidden = true;
  const accept = el("button", t("review.registre.accept"), "review-button primary");
  accept.type = "submit";
  const refuse = button(t("review.registre.refuse"), "review-button");
  const actions = el("div", "", "review-actions");
  actions.append(accept, refuse);
  fieldset.append(
    label(t("review.registre.field"), select),
    label(t("review.registre.value"), value),
    hint,
    label(t("review.registre.reason"), reason),
  );
  form.append(fieldset, error, actions);
  box.append(form);

  const showHint = () => {
    hint.textContent = select.value ? t(`review.registre.hint.${select.value}`) : "";
  };
  select.addEventListener("change", showHint);
  // The field the category points to, and the reader's correction as its value when it is
  // one as it stands (« 12 000 € » for an amount).
  const first = defaultField(r.category);
  if (first) {
    select.value = first;
    if (parseValue(first, r.correction).ok) value.value = r.correction.trim();
  }
  showHint();

  let busy = false;
  const send = async (body: Record<string, unknown>, note: string) => {
    if (busy) return;
    busy = true;
    error.hidden = true;
    for (const b of [accept, refuse]) b.setAttribute("aria-disabled", "true");
    try {
      await call("POST", "/api/review/registre", body);
      done(note);
    } catch (e) {
      fail(errorText(e), error);
    } finally {
      busy = false;
      for (const b of [accept, refuse]) b.removeAttribute("aria-disabled");
    }
  };
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const field = select.value as Field | "";
    if (!field) {
      fail(t("review.registre.error.field"), error);
      select.focus();
      return;
    }
    const parsed = parseValue(field, value.value);
    if (!parsed.ok) {
      fail(t("review.registre.error.value", { hint: t(`review.registre.hint.${field}`) }), error);
      value.focus();
      return;
    }
    if (!reason.value.trim()) {
      fail(t("review.registre.error.reason"), error);
      reason.focus();
      return;
    }
    void send(
      { id: r.id, decision: "accept", field, value: parsed.value, reason: reason.value.trim() },
      t("review.registre.accepted", {
        field: t(`review.registre.field.${field}`).toLocaleLowerCase("fr"),
        id: d.evenement,
      }),
    );
  });
  refuse.addEventListener("click", () => {
    void send({ id: r.id, decision: "refuse" }, t("review.registre.refused", { id: d.evenement }));
  });
  return box;
}

/** One reported document: its id, the link to its contract, its age, its reports. */
function documentBox(d: ReportedDocument, done: (note: string) => void): HTMLElement {
  const art = el("article", "", "review-registre-doc");
  art.dataset.evenement = d.evenement;
  const h2 = el("h2", "", "review-registre-doc-head");
  h2.append(el("code", d.evenement));
  const age = el("span", t("review.age", { d: String(d.age_days) }), "review-row-age");
  age.setAttribute("aria-label", t("review.age.label", { d: d.age_days }));
  const link = el("a", t("review.registre.open"), "review-cell-link");
  link.href = contractHref(d.affaire);
  link.target = "_blank";
  link.rel = "noopener";
  link.setAttribute("aria-label", t("review.registre.open.label", { id: d.affaire }));
  const line = el("p", "", "review-registre-doc-line");
  line.append(link, " · ", age);
  art.append(h2, line, ...d.reports.map((r) => reportBox(r, d, done)));
  return art;
}

export async function registreView(
  app: HTMLElement,
  nav: AdminNav,
  note: string | null,
): Promise<void> {
  const v = frame(app, nav.head("registre"), "review-registre", t("review.registre.title"), note);
  const summary = el("p", "", "review-summary");
  const list = el("div", "", "review-registre-list");
  v.main.append(
    summary,
    el("p", t("review.registre.lead"), "review-muted"),
    list,
    el("p", t("review.registre.kept"), "review-muted"),
  );
  const load = async () => {
    const p = await call<Pending>("GET", "/api/review/registre");
    const oldest = p.documents.length ? Math.max(...p.documents.map((d) => d.age_days)) : null;
    summary.replaceChildren(
      el("strong", t("review.queue.pending", { n: p.pending })),
      ...(oldest === null
        ? []
        : [
            " · ",
            t("review.queue.oldest"),
            " ",
            el("strong", t("review.queue.days", { d: oldest })),
          ]),
    );
    const done = (said: string) => {
      v.note.textContent = said;
      v.note.hidden = false;
      void load()
        .then(() => v.focus())
        .catch((e) => nav.fail(e));
    };
    list.replaceChildren(
      ...(p.documents.length
        ? p.documents.map((d) => documentBox(d, done))
        : [el("p", t("review.registre.none"), "review-muted")]),
    );
  };
  try {
    await load();
  } catch (e) {
    nav.fail(e);
    return;
  }
  v.focus();
}
