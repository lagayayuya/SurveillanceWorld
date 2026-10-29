// View 8 · Entreprise (/registre/entreprise/<siren>; mockup Entreprise-grand, the prototype's
// vues/entreprise.js): its template, its data (the build's entreprise/<siren>.json) and its logic
// (entreprise-outils.ts, where the tests read it).
import { load } from "../donnees.ts";
import type { VueModule } from "../main.ts";
import type { Route } from "../routes.ts";
import template from "./entreprise.html?raw";
import { Entreprise, type FichierEntreprise } from "./entreprise-outils.ts";

async function donnees(r: Route): Promise<Record<string, unknown>> {
  const siren = r.view === "entreprise" ? r.siren : "";
  return { F: await load<FichierEntreprise>(`entreprise/${siren}.json`) };
}

export default {
  // the shell gives every view its route and its data as one record
  Vue: Entreprise as unknown as VueModule["Vue"],
  template,
  donnees,
} satisfies VueModule;
