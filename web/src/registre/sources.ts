// A fiche's last section, « Sources » (design/registre/v2, V2-Entreprise): each source it reads, who
// publishes it, and how far the register has read it (couverture.json, the build's dates, never a
// text); then what the register covers. One list for every fiche (socle's part `sources`).
import type { Couverture } from "./donnees.ts";
import { load } from "./donnees.ts";
import { has, t } from "./i18n.ts";

export type Source = { l: string; ed: string; date: string; href?: string; lien?: string };

/** A legal person's official record, the Annuaire des entreprises (DINUM, from SIRENE): a link
 * only, nothing loaded from it. Never for a sole trader (its number names a person). */
export const annuaire = (siren: string): string =>
  `https://annuaire-entreprises.data.gouv.fr/entreprise/${siren}`;

const numDate = (d: string) => d.split("-").reverse().join("/");

/** The build's coverage, asked once per page (a fiche's donnees() waits for it beside its own). */
export const couverture = (): Promise<Couverture> => load<Couverture>("couverture.json");

/** The sources a fiche reads, in this order: `ids` are couverture.json's (contrats, avis, the
 * départements' decrees…); `sirene` adds the companies' register (names and activities), with
 * `fiche` its official record when the fiche is a legal person's (« Fiche officielle »). */
export function sources(
  c: Couverture | undefined,
  ids: string[],
  sirene = false,
  fiche?: string,
): Source[] {
  const out: Source[] = [];
  for (const id of ids) {
    const s = c?.sources.find((x) => x.id === id);
    if (!s) continue;
    const date = s.jusqu_au
      ? t("sources.jusqu_au", { date: numDate(s.jusqu_au) })
      : s.collecte_le
        ? t("sources.collecte_le", { date: numDate(s.collecte_le) })
        : "";
    out.push({
      l: t(`source.${id}`),
      ed: has(`registre.sources.editeur.${id}`) ? t(`sources.editeur.${id}`) : "",
      date,
    });
  }
  if (sirene)
    out.push({
      l: t("sources.sirene"),
      ed: t("sources.editeur.sirene"),
      date: "",
      ...(fiche ? { href: fiche, lien: t("sources.fiche_officielle") } : {}),
    });
  return out;
}
