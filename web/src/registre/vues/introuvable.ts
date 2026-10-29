// A path the register does not answer: a page still to come (a company, a buyer, a département, a
// document, the glossary: lot R1b), or none at all. No mockup draws it: the kit's title and lead.

import { t } from "../i18n.ts";
import type { VueModule } from "../main.ts";
import { Vue } from "../vue.ts";
import template from "./introuvable.html?raw";

const A_VENIR = /^\/registre\/(acheteur|contrat|commune\/[^/]+\/carte)(\/|$)/;

class Introuvable extends Vue {
  titre(): string {
    return t(A_VENIR.test(location.pathname) ? "introuvable.titre_a_venir" : "introuvable.titre");
  }
  renderVals() {
    const venir = A_VENIR.test(location.pathname);
    return {
      ...this.base("introuvable"),
      titre: t(venir ? "introuvable.titre_a_venir" : "introuvable.titre"),
      phrase: t(venir ? "introuvable.a_venir" : "introuvable.phrase"),
    };
  }
}

export default { Vue: Introuvable, template } satisfies VueModule;
