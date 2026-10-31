// The register's summary (/registre/; mockups V2-Sommaire and V2-Tel-Sommaire): its name cut out,
// what it covers and when it was updated, the search across the register with its results by type
// (each one a typed link), the four families and their lists with their counts, « Comment lire le
// registre » in three sentences whose types are their lists' stickers (the glossary one link away),
// then the update, the coverage and the decrees that could not be read. It opens on index.json (its
// counts the build's, `comptes`) and couverture.json; a search reads the names in listes.json (asked
// once, at the first search) and asks the documents of the search API (lot R3).
// The old addresses (/registre/chiffres, /registre/?t=…) are replaced by their list's before
// anything is drawn (listes.ts redirection).

import type { Index } from "../corpus.ts";
import type { Handler, RichItem } from "../dc.ts";
import { load } from "../donnees.ts";
import { fr } from "../format.ts";
import { has, t } from "../i18n.ts";
import { departementDans, lienDepartement, phrase as phraseLiee } from "../liens.ts";
import {
  CATS,
  type Comptes,
  type Corpus,
  type CouvertureX,
  chercherDocuments,
  chercherNoms,
  comptesIndex,
  corpus,
  type Groupe,
  grouper,
  type Liste,
  type Listes,
  lienTrouve,
  listeHref,
  nomDep,
  ordonner,
  redirection,
  TYPE_DE,
} from "../listes.ts";
import type { VueModule } from "../modale.ts";
import type { Route } from "../routes.ts";
import { couvertureLiee } from "../sources.ts";
import { plain } from "../texte.ts";
import {
  couleur,
  decoupe,
  FAMILLES,
  icone,
  mot,
  motFamille,
  pluriel,
  repere,
  type TypeCle,
} from "../types.ts";
import { type BaseState, large, Vue } from "../vue.ts";
import "./sommaire.css";
import template from "./sommaire.html?raw";

type Props = { q: Record<string, string>; I: Index; couverture: CouvertureX };
type State = BaseState & {
  q: string;
  C: Corpus | null;
  res: Groupe[] | null;
  cherche: boolean;
  indispo: boolean;
};

const numDate = (d: string) => d.split("-").reverse().join("/");
const jourMois = (d: string) => numDate(d).slice(0, 5);

/** A sentence of the catalogue whose {placeholders} are types: its words and its stickers, each
 * sticker its type's list (V2-Sommaire « Comment lire le registre »). */
export type Morceau =
  | { isT: true; isW: false; href: string; c: string; i: string; l: string; apres: string }
  | { isT: false; isW: true; w: string };
export function phrase(key: string): Morceau[] {
  const marks: Record<string, string> = {};
  for (const k of [
    "commune",
    "epci",
    "departement",
    "acheteur",
    "entreprise",
    "con",
    "mod",
    "ao",
    "aut",
    "sub",
  ])
    marks[k] = `\u0001${k}\u0001`;
  const out: Morceau[] = [];
  t(key, marks)
    .split("\u0001")
    .forEach((x, i) => {
      if (i % 2 === 0) {
        // a stop or a comma right after a sticker stays with it (no line starts with it)
        const prev = out[out.length - 1];
        const m = prev?.isT ? /^[.,;:)]+/.exec(x) : null;
        if (m && prev?.isT) prev.apres = m[0];
        const w = (m ? x.slice(m[0].length) : x).trim();
        if (w) out.push({ isT: false, isW: true, w });
        return;
      }
      const k = x as TypeCle;
      out.push({
        isT: true,
        isW: false,
        href: listeHref(k),
        c: `--c: ${couleur(k)}`,
        i: icone(k),
        l: mot(k),
        apres: "",
      });
    });
  return out;
}

/** The families and their lists, with their counts (« … » until they are known). */
export function familles(n: Comptes | null) {
  const N = (x: number | undefined) => (n && x != null ? fr(x) : "…");
  const row = (k: TypeCle, l: string, count: number | undefined, href: string) => ({
    c: `--c: ${couleur(k)}`,
    i: icone(k),
    l,
    n: N(count),
    href,
  });
  const listeDe = (k: TypeCle) =>
    (Object.keys(TYPE_DE) as Liste[]).find((l) => TYPE_DE[l] === k) as Liste;
  return FAMILLES.map((f) => {
    const k0 = f.types[0];
    const c = couleur(k0);
    return {
      l: motFamille(f.famille),
      d: t(`sommaire.fam.${f.famille}`),
      c: `--c: ${c}`,
      i: icone(k0),
      card: `display: flex; flex-direction: column; gap: 10px; padding: 16px; background: var(--bg-2); border: 2px solid var(--line); box-shadow: 5px 5px 0 ${c}`,
      cardTel: `box-shadow: 5px 5px 0 ${c}`,
      rows:
        f.famille === "acheteur"
          ? CATS.map((x) =>
              row(
                "acheteur",
                t(`liste.cat.${x}`),
                n?.categories[x],
                `${listeHref("acheteur")}?cat=${x}`,
              ),
            )
          : f.types.map((k) =>
              row(
                k,
                k === "entreprise" ? t("sommaire.titulaires") : pluriel(k),
                n?.listes[listeDe(k)],
                listeHref(k),
              ),
            ),
    };
  });
}

class Sommaire extends Vue<Props, State> {
  private n = 0;
  private attente: ReturnType<typeof setTimeout> | undefined;
  private demande: Promise<Corpus> | null = null;

  protected init(p: Props): Partial<State> {
    return { q: p.q?.q ?? "", C: null, res: null, cherche: false, indispo: false };
  }
  titre(): string {
    return "";
  }
  type(): TypeCle {
    return "registre";
  }

  /** The lists' names (listes.json), asked once, at the first search. */
  private corpus(): Promise<Corpus> {
    if (this.state.C) return Promise.resolve(this.state.C);
    if (!this.demande) {
      this.demande = load<Listes>("listes.json").then((X) => {
        const C = corpus(X, this.props.couverture);
        this.setState({ C });
        return C;
      });
      this.demande.catch(() => {
        this.demande = null;
      });
    }
    return this.demande;
  }

  componentDidMount(): void {
    if (this.state.q) void this.chercher(this.state.q);
  }
  componentWillUnmount(): void {
    clearTimeout(this.attente);
    this.n++;
  }

  private async chercher(q: string): Promise<void> {
    const id = ++this.n;
    if (plain(q.trim()).length < 2) {
      this.setState({ res: null, cherche: false, indispo: false });
      return;
    }
    this.setState({ cherche: true });
    // the names (listes.json) and the documents (the search API) at once; the documents not
    // answered: the names found and « recherche indisponible »
    const [noms, docs] = await Promise.all([
      this.corpus().then(
        (C) => grouper(chercherNoms(C, q), q),
        () => null,
      ),
      chercherDocuments(q, this.props),
    ]);
    if (id !== this.n) return;
    if (!noms && !docs) {
      this.setState({ res: null, cherche: false, indispo: true });
      return;
    }
    this.setState({
      res: ordonner([...(noms ?? []), ...(docs ?? [])]),
      cherche: false,
      indispo: !docs,
    });
  }

  private onQ: Handler = (ev) => {
    const q = ev.value;
    this.setState({ q });
    // the words in the address, replaced: back from a result finds them again
    const href = q.trim() ? `/registre/?${new URLSearchParams({ q: q.trim() })}` : "/registre/";
    history.replaceState(history.state, "", href);
    clearTimeout(this.attente);
    this.attente = setTimeout(() => void this.chercher(q), 180);
  };

  renderVals() {
    const S = this.state;
    const { I, couverture: cv } = this.props;
    const wide = large();
    const n = comptesIndex(I);
    const maj = t("sommaire.maj", { date: numDate(I.maj) });
    // how far each source has been read (couverture.json): the contracts, each collected département's decrees
    const con = cv.sources.find((s) => s.id === "contrats")?.jusqu_au;
    const jusqu = [
      con ? t("sommaire.contrats_jusqu", { date: jourMois(con) }) : "",
      ...Object.entries(cv.departements)
        .filter(([, d]) => d.etat === "collecte" && d.dernier_recueil)
        .map(([code, d]) =>
          phraseLiee("sommaire.arretes_jusqu", {
            dep: has(`registre.sommaire.du_${code}`)
              ? departementDans(code, t(`sommaire.du_${code}`))
              : t("sommaire.du", { code }),
            date: jourMois(d.dernier_recueil as string),
          }),
        ),
    ]
      .filter((x) => x.length > 0)
      .flatMap((x) => [" · ", ...(typeof x === "string" ? [x] : x)]);
    const zones = couvertureLiee(cv);
    const res = (S.res ?? []).map((g) => ({
      ...repere(g.k),
      l: pluriel(g.k),
      rows: g.rows.map((r) => ({ lien: lienTrouve(r) as RichItem, meta: r.detail })),
      plus:
        g.n > g.rows.length && g.tout !== "/registre/"
          ? t("sommaire.tout_voir", { n: fr(g.n) })
          : "",
      tout: g.tout,
    }));
    const pret = !S.cherche && S.res !== null;
    return {
      ...this.base("sommaire"),
      wide,
      tel: !wide,
      cls: wide ? "inner" : "tin",
      title: t("sommaire.titre"),
      letters: decoupe(t("sommaire.titre")),
      idline: phraseLiee("sommaire.idline", {
        maj: numDate(I.maj),
        zones: { span: zones, cls: "" },
      }),
      idlineTel: phraseLiee("sommaire.idline_tel", {
        maj: numDate(I.maj),
        zones: { span: zones, cls: "" },
      }),
      q: S.q,
      onQ: this.onQ,
      cherche: S.cherche,
      hasRes: pret && res.length > 0,
      res,
      aucun: pret && res.length === 0 ? t("sommaire.aucun_resultat", { q: S.q.trim() }) : "",
      indispo: S.indispo,
      depsIndispo: Object.keys(cv.departements)
        .sort()
        .map((code) => lienDepartement(code, nomDep({ couverture: cv }, code), true)),
      fams: familles(n),
      phrases: [1, 2, 3].map((i) => ({
        k: t(`sommaire.phrase.k${i}`),
        parts: phrase(`sommaire.phrase.p${i}`),
      })),
      phraseTel: phrase("sommaire.phrase.tel"),
      maj,
      jusqu,
      nonLus: t("sommaire.non_lus", { n: I.non_lus }),
    };
  }
}

async function donnees(r: Route): Promise<Record<string, unknown>> {
  const to = redirection(r);
  if (to) {
    // an old address: its list's, in place of this one (no new step in the history); the router
    // answers the new path at once and drops this one, never drawn
    history.replaceState(history.state, "", `${to}${location.hash}`);
    dispatchEvent(new PopStateEvent("popstate"));
    return new Promise(() => {});
  }
  const [I, couverture] = await Promise.all([
    load<Index>("index.json"),
    load<CouvertureX>("couverture.json"),
  ]);
  return { I, couverture };
}

export default {
  // the shell gives every view its route and its data as one record
  Vue: Sommaire as unknown as VueModule["Vue"],
  template,
  donnees,
} satisfies VueModule;
