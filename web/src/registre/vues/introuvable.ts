// A path the register does not answer, or a page whose subject is not in the register (a view's
// donnees() throws Absent). No mockup draws it: a page of the register in its frame (its pink, its
// breadcrumb), its title in cut-out letters as the summary's (V2-Sommaire), the kit's lead.

import { t } from "../i18n.ts";
import type { VueModule } from "../modale.ts";
import type { TypeCle } from "../types.ts";
import { large, Vue } from "../vue.ts";
import { motsDecoupes } from "./decoupe-outils.ts";
import "./introuvable.css";
import template from "./introuvable.html?raw";

class Introuvable extends Vue {
  titre(): string {
    return t("introuvable.titre");
  }
  type(): TypeCle {
    return "registre";
  }
  renderVals() {
    return {
      ...this.base("introuvable"),
      lay: large() ? { inner: "inner", cut: "cutout" } : { inner: "tin", cut: "cutout s" },
      titre: t("introuvable.titre"),
      mots: motsDecoupes(t("introuvable.titre")),
      phrase: t("introuvable.phrase"),
    };
  }
}

export default { Vue: Introuvable, template } satisfies VueModule;
