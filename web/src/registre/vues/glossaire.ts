// View 11 · Glossaire (/registre/glossaire; mockup Glossaire.dc.html, the prototype's vues/glossaire.js):
// the sticky index, a filter (accents and case ignored, in the word or its definition), each word's
// definition and an example, a page of the register. An address #g-<id> (the other views link
// /registre/glossaire#g-accord-cadre) shows its word marked; the page's router scrolls to it.

import { t } from "../i18n.ts";
import type { VueModule } from "../modale.ts";
import { type BaseState, Vue } from "../vue.ts";
import template from "./glossaire.html?raw";
import { ancre, filtrer, type Mot, mots } from "./glossaire-mots.ts";

type State = BaseState & { q: string; ici: string };

class Glossaire extends Vue<Record<string, unknown>, State> {
  private readonly all: Mot[] = mots(t);

  protected init(): Partial<State> {
    return { q: "", ici: ancre(location.hash) };
  }

  titre(): string {
    return t("glossaire.les_mots_du_registre");
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
      fil: [{ l: t("commun.fil_registre"), href: "/registre/" }],
      filIci: t("entete.glossaire"),
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
        ex: m.exemple,
        href: m.href,
      })),
      none: hit.length === 0,
      countLabel: S.q.trim()
        ? t("glossaire.n_trouves", { n: hit.length })
        : t("glossaire.alphabetique"),
    };
  }
}

export default { Vue: Glossaire, template } satisfies VueModule;
