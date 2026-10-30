// The register's types (mockup V2-Types): every fiche says at once what it is, by one pictogram, one
// word and one colour per family, the same everywhere — the fiche's head, its band, its links, the
// lists, the breadcrumb, the search. Four families: territories, buyers, companies, documents. The
// colour says the type, never a value (pink stays the register's frame and the map's). Words come
// from the catalogue (`registre.types.<key>.l` / `.p`), colours from the punk tokens
// (`--type-<family>`, theme/punk/tokens.css), pictograms are the mockup's paths (24 × 24, stroked).
import type { Evenement } from "./donnees.ts";
import { t } from "./i18n.ts";

export type Famille = "territoire" | "acheteur" | "entreprise" | "document" | "registre";
export type TypeCle =
  | "commune"
  | "epci"
  | "departement"
  | "acheteur"
  | "entreprise"
  | "con"
  | "mod"
  | "ao"
  | "aut"
  | "sub"
  | "registre";

const TYPES: Record<TypeCle, { famille: Famille; icone: string }> = {
  commune: { famille: "territoire", icone: "M3 10.5 12 4l9 6.5M5.5 10v9.5h13V10M10 19.5v-5h4v5" },
  epci: {
    famille: "territoire",
    icone: "M2 13l4.5-3.5L11 13v6.5H2zM13 13l4.5-3.5L22 13v6.5h-9",
  },
  departement: { famille: "territoire", icone: "M6 4l5 2.5 6-1.5 3 6-3 7.5-7 1.5-5.5-5z" },
  acheteur: {
    famille: "acheteur",
    icone: "M4 9.5 12 4l8 5.5M5 9.5h14M7 9.5v8M10.5 9.5v8M13.5 9.5v8M17 9.5v8M4 20h16",
  },
  entreprise: { famille: "entreprise", icone: "M3 8.5h18v11H3zM9 8.5V5.5h6v3M3 13.5h18" },
  con: { famille: "document", icone: "M6 3h9l4 4v14H6zM15 3v4h4M9 17c1.5-2 2.5 1 4-1 1-1 2 0 3 0" },
  mod: { famille: "document", icone: "M6 3h9l4 4v14H6zM15 3v4h4M9 16l5-5 2 2-5 5H9z" },
  ao: {
    famille: "document",
    icone: "M3 10v4h4l7 4.5v-13L7 10zM17.5 9a4 4 0 0 1 0 6M20 6.5a7.5 7.5 0 0 1 0 11",
  },
  aut: {
    famille: "document",
    icone: "M6 3h12v18H6zM9 7.5h6M9 11h6M12 14.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 1 0 0-5",
  },
  sub: { famille: "document", icone: "M16 6.5a6.5 6.5 0 1 0 0 11M4.5 10.5h8.5M4.5 13.5h8.5" },
  registre: { famille: "registre", icone: "M5 4h11l3 3v13H5zM8 9h8M8 12.5h8M8 16h5" },
};

/** The families in the summary's order, each with its types. */
export const FAMILLES: { famille: Exclude<Famille, "registre">; types: TypeCle[] }[] = [
  { famille: "territoire", types: ["commune", "epci", "departement"] },
  { famille: "acheteur", types: ["acheteur"] },
  { famille: "entreprise", types: ["entreprise"] },
  { famille: "document", types: ["con", "mod", "ao", "aut", "sub"] },
];

export const famille = (k: TypeCle): Famille => TYPES[k].famille;
export const icone = (k: TypeCle): string => TYPES[k].icone;
/** « Entreprise » */
export const mot = (k: TypeCle): string => t(`types.${k}.l`);
/** « Entreprises » */
export const pluriel = (k: TypeCle): string => t(`types.${k}.p`);
/** « Territoires » */
export const motFamille = (f: Famille): string => t(`types.famille.${f}`);
const COULEUR: Record<Famille, string> = {
  territoire: "var(--type-territoire)",
  acheteur: "var(--type-acheteur)",
  entreprise: "var(--type-entreprise)",
  document: "var(--type-document)",
  registre: "var(--type-registre)",
};
/** The family's colour, a token: `var(--type-entreprise)`. */
export const couleur = (k: TypeCle): string => COULEUR[TYPES[k].famille];

/** What a template reads of a type: its word, plural, colour as a style (`--c`), pictogram. */
export type Repere = { k: TypeCle; l: string; p: string; c: string; i: string };
export function repere(k: TypeCle): Repere {
  return { k, l: mot(k), p: pluriel(k), c: `--c: ${couleur(k)}`, i: icone(k) };
}

/** A document's type from its kind (the pilot's `t`, corpus.ts typ's mapping). */
export function typeDocument(e: Pick<Evenement, "t">): TypeCle {
  const k = e.t;
  if (k === "attribution") return "con";
  if (k === "modification") return "mod";
  if (/^(avis|resultat|rectificatif)$/.test(k)) return "ao";
  if (k.startsWith("arrete")) return "aut";
  if (k.startsWith("subvention")) return "sub";
  return "con";
}

/** A territory's type from its code: a commune (INSEE), a département, an EPCI (SIREN). */
export function typeTerritoire(code: string): TypeCle {
  if (/^\d{9}$/.test(code)) return "epci";
  if (/^(\d[\dAB]|97\d)$/.test(code)) return "departement";
  return "commune";
}

// The name in cut-out letters (the mockups' `cut`): each letter its own scrap, five looks in turn,
// a tilt and a lift from two fixed series, a space a gap. Shown beside the real h1 (read once).
const TILT = [-4, 3, -2, 5, 2, -5, 4, -1, 3, -4, 4, -3];
const LIFT = [0, 3, -2, 1, 2, 0, -1, 3, -2, 0, 2, 1];
export type Lettre = { ch: string; cls: string; st: string };
export function decoupe(nom: string): Lettre[] {
  const out: Lettre[] = [];
  let i = 0;
  for (const ch of nom.toLocaleUpperCase("fr")) {
    if (ch === " ") {
      out.push({ ch: " ", cls: "gap", st: "" });
      continue;
    }
    out.push({
      ch,
      cls: `rg-cut c${i % 5}`,
      st: `transform: rotate(${TILT[i % 12]}deg) translateY(${LIFT[i % 12]}px)`,
    });
    i++;
  }
  return out;
}

/** The same, word by word (a name breaks between its words, never inside one). */
export function decoupeMots(nom: string): { lettres: Lettre[] }[] {
  const out: { lettres: Lettre[] }[] = [];
  let i = 0;
  for (const mot of nom.split(/\s+/).filter(Boolean)) {
    const lettres = decoupe(mot).map((l, j) => ({
      ...l,
      cls: `rg-cut c${(i + j) % 5}`,
      st: `transform: rotate(${TILT[(i + j) % 12]}deg) translateY(${LIFT[(i + j) % 12]}px)`,
    }));
    i += lettres.length;
    out.push({ lettres });
  }
  return out;
}
