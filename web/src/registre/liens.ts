// Every mention that has its fiche is a link (design/registre/v2, the owner's rule « partout et sans
// exception »): a territory, a buyer, a company or a document the register holds a page for, in a
// sentence, a table, a panel, a tooltip, the frieze, a search result, the breadcrumb, a figure that
// names a place. The link takes its target's colour and pictogram (types.ts): a small square and an
// underline of the type's colour; in a list, the pictogram alone. A name without a fiche stays
// text; a sole trader is never a link (DECISIONS 2026-10-29). The views build their mentions here.
import { communeHref } from "./commun.ts";
import { buyerHref, buyerNom, depNom, docHref, entHref, entName, type Lexique } from "./corpus.ts";
import type { Rich, RichItem } from "./dc.ts";
import type { Evenement } from "./donnees.ts";
import { couleur, icone, type TypeCle, typeDocument } from "./types.ts";

/** A mention as a link to its fiche, or its words alone when it has none (`href` null). */
export function lien(k: TypeCle, href: string | null, text: Rich, liste = false): RichItem {
  if (!href) return { span: text, cls: "" };
  return { a: { href, text, cls: liste ? "rl" : "lk", c: couleur(k), i: icone(k) } };
}

/** The same for a template's own markup (`<a class="lk" style="{{x.c}}" href="{{x.href}}">…`): the
 * href, the colour as a style, the pictogram's path, and whether it is a link at all. */
export type Mention = { href: string; c: string; i: string; l: string; lien: boolean };
export function mention(k: TypeCle, href: string | null, l: string): Mention {
  return { href: href ?? "", c: `--c: ${couleur(k)}`, i: icone(k), l, lien: href !== null };
}

export const departementHref = (dep: string): string =>
  `/registre/departement/${encodeURIComponent(dep)}`;

// --- a mention by its id, from the lexicon every file carries (corpus.ts Lexique) -----------------
// Every buyer, company and commune of a lexicon has its page (the build writes one per entry; a sole
// trader is the token `ei`, without page): its id is enough to link it.

/** A buyer: its fiche, or its commune's when it is a commune (one fiche per collectivité). */
export function lienAcheteur(L: Lexique, siren: string, text?: Rich, liste = false): RichItem {
  const href = buyerHref(L, siren);
  const k: TypeCle = href.startsWith("/registre/commune/") ? "commune" : "acheteur";
  return lien(k, L.acheteurs[siren] ? href : null, text ?? buyerNom(L, siren), liste);
}

/** A company: its fiche; a sole trader, its words only. */
export function lienEntreprise(L: Lexique, siren: string, text?: Rich, liste = false): RichItem {
  const href =
    L.entreprises[siren] && !L.entreprises[siren].entrepreneur_individuel ? entHref(siren) : null;
  return lien("entreprise", href, text ?? entName(L, siren), liste);
}

/** A commune: its fiche when the register holds it. */
export function lienCommune(L: Lexique, insee: string, text?: Rich, liste = false): RichItem {
  const c = L.communes[insee];
  return lien("commune", c ? communeHref(insee) : null, text ?? c?.nom ?? insee, liste);
}

/** A département: its fiche (the build writes one per département it covers). */
export function lienDepartement(dep: string, text?: Rich, liste = false): RichItem {
  return lien("departement", dep ? departementHref(dep) : null, text ?? depNom(dep), liste);
}

/** A document: its record, or its commune's Autorisations at its dossier for a decree. */
export function lienDocument(L: Lexique, e: Evenement, text: Rich, liste = false): RichItem {
  return lien(typeDocument(e), docHref(L, e), text, liste);
}
