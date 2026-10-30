// A name in cut-out letters (types.ts decoupe), grouped by word: the scraps of a word stay on one line,
// a long name (« Contrat de juin 2022 », « Ce que couvre le registre ») breaks between its words only,
// never inside one, at 390 px as on a wide screen. Each word a `.mot` (its view's CSS: inline-flex,
// no wrap). Pure: the tests read it.
import { decoupe, type Lettre } from "../types.ts";

export type Mot = { lettres: Lettre[] };

export function motsDecoupes(nom: string): Mot[] {
  const out: Mot[] = [{ lettres: [] }];
  for (const l of decoupe(nom)) {
    if (l.cls === "gap") out.push({ lettres: [] });
    else out[out.length - 1].lettres.push(l);
  }
  return out.filter((m) => m.lettres.length > 0);
}
