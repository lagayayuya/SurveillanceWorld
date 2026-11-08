// Up to four communes or companies compared: lot 4 of the redesign v3 (board Comparer-communes, Comparer-entreprises). A stub until its view lands.

import type { VueModule } from "../modale.ts";
import type { TypeCle } from "../types.ts";
import { Vue } from "../vue.ts";

class Comparer extends Vue {
  type(): TypeCle {
    return "registre";
  }
  renderVals() {
    return { ...this.base("comparer") };
  }
}

export default {
  Vue: Comparer,
  template: '<div class="{{th}} va comparer"></div>',
} satisfies VueModule;
