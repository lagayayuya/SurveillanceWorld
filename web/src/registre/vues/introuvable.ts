// A path the register does not answer, or a page whose subject is not in the register (a view's
// donnees() throws Absent). No mockup draws it: the kit's title and lead.

import { t } from "../i18n.ts";
import type { VueModule } from "../main.ts";
import { Vue } from "../vue.ts";
import template from "./introuvable.html?raw";

class Introuvable extends Vue {
  titre(): string {
    return t("introuvable.titre");
  }
  renderVals() {
    return {
      ...this.base("introuvable"),
      titre: t("introuvable.titre"),
      phrase: t("introuvable.phrase"),
    };
  }
}

export default { Vue: Introuvable, template } satisfies VueModule;
