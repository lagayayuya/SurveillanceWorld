// A département named inside words the register writes itself (« Préfecture du Rhône », « Arrêtés du
// Rhône », « Subventions de l'État dans les Bouches-du-Rhône »): that name a link to its fiche, the rest
// words (design/registre/v2: every mention that has its fiche is a link). Only the département the
// text is about, by its code, never a guess from the words; a name inside a longer one (« Rhône » in
// « Bouches-du-Rhône ») is not it. Pure: the tests read it.
import { depNom, type Lexique } from "../corpus.ts";
import type { RichItem } from "../dc.ts";
import { lienCommune, lienDepartement } from "../liens.ts";

const LETTRE = /[\p{L}-]/u;

export function lierDepartement(texte: string, dep: string | null | undefined): RichItem[] {
  const nom = dep ? depNom(dep) : "";
  if (!dep || !nom || nom === dep) return [texte];
  for (let at = texte.indexOf(nom); at >= 0; at = texte.indexOf(nom, at + 1)) {
    const end = at + nom.length;
    if (LETTRE.test(texte[at - 1] ?? "") || LETTRE.test(texte[end] ?? "")) continue;
    return [texte.slice(0, at), lienDepartement(dep, nom), texte.slice(end)].filter(
      (x) => x !== "",
    );
  }
  return [texte];
}

/** The same for the commune a text is about (by its code, when the register holds it), then its
 * département: « La commune de Noisiel va réaliser… », « …des sites de la Caf de Paris ». */
export function lierLieux(
  texte: string,
  L: Lexique,
  insee: string | null | undefined,
  dep: string | null | undefined,
): RichItem[] {
  const nom = insee ? L.communes[insee]?.nom : undefined;
  const parts: RichItem[] = [texte];
  if (insee && nom)
    for (let at = texte.indexOf(nom); at >= 0; at = texte.indexOf(nom, at + 1)) {
      const end = at + nom.length;
      if (LETTRE.test(texte[at - 1] ?? "") || LETTRE.test(texte[end] ?? "")) continue;
      parts.splice(0, 1, texte.slice(0, at), lienCommune(L, insee, nom), texte.slice(end));
      break;
    }
  return parts
    .flatMap((p) => (typeof p === "string" ? lierDepartement(p, dep) : [p]))
    .filter((x) => x !== "");
}
