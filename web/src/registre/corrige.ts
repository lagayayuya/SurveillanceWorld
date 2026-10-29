// A correction accepted in /revue (DECISIONS 2026-10-29): the build replaced the field the pages
// read and kept, in `corrige`, the value the source published and the day it was accepted
// (pipeline/lacarte_registre/regles.py corriger). The document's page says « Corrigé le <date> »,
// the value read now, and the source's value struck, named in words for those who cannot see
// the stroke.

import type { Rich } from "./dc.ts";
import type { Evenement } from "./donnees.ts";
import { fr, longDate, money } from "./format.ts";
import { has, t } from "./i18n.ts";

export type Corrige = Record<string, { source: unknown; le: string }>;

/** The names a value may need: companies by SIREN, communes by INSEE code. */
export type Noms = {
  entreprise: (siren: string) => string;
  commune: (insee: string) => string;
};

/** The names a commune's file gives (commun.ts Donnees). */
export const nomsDe = (d: {
  entName(siren: string): string;
  commune(insee: string): { nom: string };
}): Noms => ({ entreprise: (s) => d.entName(s), commune: (k) => d.commune(k).nom });

/** A field's value as the pages write it; « — » for none. */
export function valeur(champ: string, v: unknown, noms: Noms): string {
  if (v == null || v === "" || (Array.isArray(v) && !v.length)) return "—";
  switch (champ) {
    case "montant":
      return money(Number(v));
    case "date":
      return longDate(String(v));
    case "cameras":
      return fr(Number(v));
    case "entreprises":
      return (Array.isArray(v) ? v : [v]).map((s) => noms.entreprise(String(s))).join(", ");
    case "insee":
      return noms.commune(String(v));
    default:
      return String(v);
  }
}

/** One line per corrected field of the document: « Corrigé le … », what it reads now and, struck,
 * what the source published. */
export function corrections(e: Evenement, noms: Noms): { k: string; v: Rich }[] {
  const c = (e.corrige ?? {}) as Corrige;
  return Object.entries(c)
    .filter(([, x]) => x && typeof x.le === "string")
    .map(([champ, x]) => {
      const label = has(`registre.corrige.champ.${champ}`) ? t(`corrige.champ.${champ}`) : champ;
      return {
        k: t("corrige.le", { date: longDate(x.le) }),
        v: [
          `${label} : `,
          { strong: valeur(champ, e[champ], noms) },
          ` · ${t("corrige.source")} `,
          { span: valeur(champ, x.source, noms), cls: "barre" },
        ],
      };
    });
}
