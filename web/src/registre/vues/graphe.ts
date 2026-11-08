// The graph centred on a company or a buyer: lot 4 of the redesign v3 (board Graphe-plein, Graphe-grammaire). A stub until its view lands.

import type { VueModule } from "../modale.ts";
import type { TypeCle } from "../types.ts";
import { Vue } from "../vue.ts";

class Graphe extends Vue {
  type(): TypeCle {
    return "registre";
  }
  renderVals() {
    return { ...this.base("graphe") };
  }
}

export default {
  Vue: Graphe,
  template: '<div class="{{th}} va graphe"></div>',
} satisfies VueModule;
