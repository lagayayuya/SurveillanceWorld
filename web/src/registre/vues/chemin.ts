// The shortest paths of contracts between two: lot 4 of the redesign v3 (board Chemin-entre-deux). A stub until its view lands.

import type { VueModule } from "../modale.ts";
import type { TypeCle } from "../types.ts";
import { Vue } from "../vue.ts";

class Chemin extends Vue {
  type(): TypeCle {
    return "registre";
  }
  renderVals() {
    return { ...this.base("chemin") };
  }
}

export default {
  Vue: Chemin,
  template: '<div class="{{th}} va chemin"></div>',
} satisfies VueModule;
