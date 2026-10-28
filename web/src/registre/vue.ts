// The base of the register's views (the prototype's vue11.js): what every view gives its template —
// the theme's class, the catalogue's words (`t`), the « i » buttons, the selection shown in the
// panel, the sortable column heads.
import { nest, type Texts } from "./catalogue.ts";
import { type Handler, View } from "./dc.ts";

let words: Texts = {};
/** The catalogue as the templates read it ({{t.<view>.<key>}}), set once by the page. */
export function setWords(catalogue: Record<string, string>): void {
  words = nest(catalogue);
}

export type BaseState = { sel: string | null; open: Record<string, boolean> };

/** A sortable column head: [key, label, class, width]; no key, not sortable. */
export type Col = [key: string, label: string, cls?: string, width?: string];

export abstract class Vue<
  P extends object = Record<string, unknown>,
  S extends BaseState = BaseState,
> extends View<P, S> {
  constructor(props: P) {
    super(props);
    this.state = { sel: null, open: {}, ...this.init(props) } as S;
  }

  /** The view's own state at mount (the prototype's init). */
  protected init(_props: P): Partial<S> {
    return {};
  }

  /** The tab's title: « <titre> · Le registre · Surveillance World ». */
  titre(): string {
    return "";
  }

  /** The theme's scope (.th .v-<name>) and the words. */
  protected base(name: string): { th: string; t: Texts } {
    return { th: `th v-${name}`, t: words };
  }

  /** { show, open, tgl } for the « i » buttons named, as the mockups use them. */
  protected info(...keys: string[]) {
    const o = this.state.open;
    return {
      show: Object.fromEntries(keys.map((k) => [k, !!o[k]])),
      open: Object.fromEntries(keys.map((k) => [k, o[k] ? "true" : "false"])),
      tgl: Object.fromEntries(
        keys.map((k) => [
          k,
          (() =>
            this.setState({
              open: { ...this.state.open, [k]: !this.state.open[k] },
            } as Partial<S>)) as Handler,
        ]),
      ),
    };
  }

  /** Hovered, focused or touched: shown in the panel. */
  protected pick(k: string): Handler {
    return () => {
      if (this.state.sel !== k) this.setState({ sel: k } as Partial<S>);
    };
  }

  protected on(k: string): boolean {
    return this.state.sel === k;
  }

  /** Sortable heads: a click on the current key flips the order. */
  protected cols(
    defs: Col[],
    sk: keyof S & string,
    dk: keyof S & string,
    firstDir: (k: string) => number = () => -1,
  ) {
    const S = this.state as Record<string, unknown>;
    return defs.map(([k, l, cls, w]) => ({
      l,
      cls: cls ?? "",
      w: w ?? "",
      sort: k && S[sk] === k ? ((S[dk] as number) < 0 ? "descending" : "ascending") : "none",
      arrow: k && S[sk] === k ? ((S[dk] as number) < 0 ? "↓" : "↑") : "",
      pick: (k
        ? () =>
            this.setState({
              [sk]: k,
              [dk]: S[sk] === k ? -(S[dk] as number) : firstDir(k),
            } as Partial<S>)
        : () => {}) as Handler,
    }));
  }
}
