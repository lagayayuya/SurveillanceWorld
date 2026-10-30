// View 8 · Entreprise (/registre/entreprise/<siren>; mockup Entreprise-grand, the prototype's
// vues/entreprise.js): its template, its data (the build's entreprise/<siren>.json) and its logic
// (entreprise-outils.ts, where the tests read it).
import { Absent, load } from "../donnees.ts";
import type { VueModule } from "../modale.ts";
import type { Route } from "../routes.ts";
import { couverture } from "../sources.ts";
import template from "./entreprise.html?raw";
import { Entreprise, type FichierEntreprise } from "./entreprise-outils.ts";

async function donnees(r: Route): Promise<Record<string, unknown>> {
  const siren = r.view === "entreprise" ? r.siren : "";
  // a company outside the register has no file (404; the dev server answers its page instead,
  // not JSON): « introuvable », not a load error
  const cv = couverture().catch(() => undefined);
  try {
    return { F: await load<FichierEntreprise>(`entreprise/${siren}.json`), couverture: await cv };
  } catch (e) {
    if (e instanceof SyntaxError || /: 404$/.test(String((e as Error).message)))
      throw new Absent(siren);
    throw e;
  }
}

export default {
  // the shell gives every view its route and its data as one record
  Vue: Entreprise as unknown as VueModule["Vue"],
  template,
  donnees,
} satisfies VueModule;
