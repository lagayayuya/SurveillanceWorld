// The base of the register's views (the prototype's vue11.js): what every view gives its template —
// the theme's class, the catalogue's words (`t`), the « i » buttons, the selection shown in the
// panel, the sortable column heads.
import { nest, type Texts } from "./catalogue.ts";
import { type Handler, type Rich, View } from "./dc.ts";
import { t } from "./i18n.ts";
import { partager } from "./partage.ts";
import { decoupe, decoupeMots, type Lettre, type Repere, repere, type TypeCle } from "./types.ts";

let words: Texts = {};
/** The catalogue as the templates read it ({{t.<view>.<key>}}), set once by the page. */
export function setWords(catalogue: Record<string, string>): void {
  words = nest(catalogue);
}

export type BaseState = { sel: string | null; open: Record<string, boolean> };

/** A sortable column head: [key, label, class, width]; no key, not sortable. */
export type Col = [key: string, label: string, cls?: string, width?: string];

/** The skeleton every fiche follows, in this order (design/registre/v2, V2-Types): identity (the
 * head), then these; an empty section is left out, the others numbered in turn. */
export const SECTIONS = ["essentiel", "temps", "avecqui", "documents", "sources"] as const;
export type Section = (typeof SECTIONS)[number];
export type Sections = {
  /** the sections shown, in order: { k, n, l, href } */
  liste: { k: Section; n: number; l: string; href: string }[];
} & Partial<Record<Section, { n: number; l: string }>>;

/** What a fiche shares (partage.ts): its title, and the text R3's build writes for it, if any. */
export type Partage = { titre: string; texte?: string; image?: string };

/** A wide screen (the boards' 960 px and up): the frame, the head and the band differ on a phone. */
export const large = (): boolean =>
  typeof matchMedia === "function" && matchMedia("(min-width: 960px)").matches;

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

  /** What « Partager » shares; a fiche says it (null: the page has no « Partager »). */
  partage(): Partage | null {
    return null;
  }

  /** A fiche's head (socle's tete-fiche): its type's sticker, its name cut out, its identity. */
  protected tete(k: TypeCle, nom: string, ligne: Rich) {
    const isLarge = large();
    return {
      r: repere(k),
      nom,
      lettres: decoupe(nom) as Lettre[],
      mots: decoupeMots(nom),
      ligne,
      cls: isLarge ? "inner" : "tin",
      stk: isLarge ? "stk big" : "stk",
    };
  }

  /** The fiche's sections, the empty ones left out: `present` says which have something. */
  protected sections(present: Partial<Record<Section, boolean>>): Sections {
    const out: Sections = { liste: [] };
    for (const k of SECTIONS) {
      if (!present[k]) continue;
      const s = { k, n: out.liste.length + 1, l: t(`cadre.sec.${k}`), href: `#${k}` };
      out.liste.push(s);
      out[k] = { n: s.n, l: s.l };
    }
    return out;
  }

  /** The type's band (socle's bandeau): stuck at the top, the sections, « Partager ». */
  protected bandeau(k: TypeCle, nom: string, secs: Sections) {
    const isLarge = large();
    return {
      r: repere(k) as Repere,
      nom,
      secs: secs.liste,
      large: isLarge,
      tel: !isLarge,
      partager: ((ev: { currentTarget: Element }) => partager(this, ev.currentTarget)) as Handler,
    };
  }

  /** The theme's scope (.th .v-<name>), the words, and the panel's state (`ps`): something chosen
   * (its class `sel`: on a phone the panel rises as a drawer then only) and how to let it go. */
  protected base(name: string): {
    th: string;
    t: Texts;
    ps: { cls: string; fermer: Handler | null };
  } {
    const sel = this.state.sel !== null;
    return {
      th: `th v-${name}`,
      t: words,
      ps: {
        cls: sel ? "panel sel" : "panel",
        fermer: sel ? ((() => this.setState({ sel: null } as Partial<S>)) as Handler) : null,
      },
    };
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
