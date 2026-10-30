// View 11 · Glossaire (/registre/glossaire; mockup Glossaire.dc.html, the prototype's vues/glossaire.js):
// the sticky index, a filter (accents and case ignored, in the word or its definition), each word's
// definition and an example, a page of the register. An address #g-<id> (the other views link
// /registre/glossaire#g-accord-cadre) shows its word marked; the page's router scrolls to it.
// v2 (design/registre/v2): a page of the register in its frame (its pink, its breadcrumb), its title in
// cut-out letters as the summary's; a word that names a type of fiche wears its sticker (V2-Types), an
// example that is a fiche is a link of its type.

import type { RichItem } from "../dc.ts";
import { t } from "../i18n.ts";
import { lien } from "../liens.ts";
import type { VueModule } from "../modale.ts";
import { repere, type TypeCle } from "../types.ts";
import { type BaseState, large, Vue } from "../vue.ts";
import "./glossaire.css";
import { motsDecoupes } from "./decoupe-outils.ts";
import template from "./glossaire.html?raw";
import { ancre, filtrer, type Mot, mots, TYPES_MOTS, typeExemple } from "./glossaire-mots.ts";

/** « Exemple : Sytral Mobilités → », a link of its fiche's type; a list or a page, a plain one. */
function exemple(m: Mot): RichItem {
  const text = t("glossaire.exemple", { g_ex: m.exemple });
  const k = typeExemple(m.href);
  return k ? lien(k, m.href, text) : { a: { href: m.href, text, cls: "ghost" } };
}

type State = BaseState & { q: string; ici: string };

class Glossaire extends Vue<Record<string, unknown>, State> {
  private readonly all: Mot[] = mots(t);

  protected init(): Partial<State> {
    return { q: "", ici: ancre(location.hash) };
  }

  titre(): string {
    return t("glossaire.les_mots_du_registre");
  }

  type(): TypeCle {
    return "registre";
  }

  /** A link to another word of the page (the index, an address typed): that word marked, and shown
   * even when the filter hid it. */
  private readonly onHash = (): void => {
    const ici = ancre(location.hash);
    const hidden = ici && !filtrer(this.all, this.state.q).some((m) => m.id === ici);
    // the template does not rewrite the field being typed in: the reader leaves it for the word
    const field = document.activeElement;
    if (hidden && field instanceof HTMLInputElement) field.blur();
    this.setState({ ici, ...(hidden ? { q: "" } : {}) });
    if (hidden)
      requestAnimationFrame(() => {
        const el = document.getElementById(`g-${ici}`);
        el?.scrollIntoView({ block: "start" });
        el?.focus({ preventScroll: true });
      });
  };

  componentDidMount(): void {
    addEventListener("hashchange", this.onHash);
    // opened at #g-<id>: the reader's place is that word (the router scrolls to it)
    if (this.state.ici)
      document.getElementById(`g-${this.state.ici}`)?.focus({ preventScroll: true });
  }

  componentWillUnmount(): void {
    removeEventListener("hashchange", this.onHash);
  }

  renderVals() {
    const S = this.state;
    const hit = filtrer(this.all, S.q);
    return {
      ...this.base("glossaire"),
      lay: large() ? { inner: "inner", cut: "cutout" } : { inner: "tin", cut: "cutout s" },
      mots: motsDecoupes(t("glossaire.les_mots_du_registre")),
      total: this.all.length,
      q: S.q,
      onQ: (e: { value: string }) => this.setState({ q: e.value }),
      items: hit.map((m) => ({
        id: `g-${m.id}`,
        anchor: `#g-${m.id}`,
        cls: m.id === S.ici ? "entry on" : "entry",
        tab: m.id === S.ici ? "-1" : null,
        t: m.terme,
        d: m.definition,
        hasEx: !!m.exemple,
        exemple: exemple(m),
        r: TYPES_MOTS[m.id] ? repere(TYPES_MOTS[m.id]) : null,
      })),
      none: hit.length === 0,
      countLabel: S.q.trim()
        ? t("glossaire.n_trouves", { n: hit.length })
        : t("glossaire.alphabetique"),
    };
  }
}

export default { Vue: Glossaire, template } satisfies VueModule;
