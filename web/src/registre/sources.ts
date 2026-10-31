// A fiche's last section, « Sources » (design/registre/v2, V2-Entreprise): each source it reads, who
// publishes it, and how far the register has read it (couverture.json, the build's dates, never a
// text); then what the register covers. One list for every fiche (socle's part `sources`).
import { depNom } from "./corpus.ts";
import type { RichItem } from "./dc.ts";
import type { Couverture } from "./donnees.ts";
import { load } from "./donnees.ts";
import { has, t } from "./i18n.ts";
import { lienDepartement, phrase } from "./liens.ts";

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

/** The pilot's areas: a département a link to its fiche, a region words. */
const pilote = (): RichItem[] => [
  t("sommaire.zone_idf"),
  ", ",
  lienDepartement("69", depNom("69")),
  ", ",
  lienDepartement("13", depNom("13")),
];

/** What the register covers, family by family, in one sentence (couverture.json `resume`, the
 * summary's line): « Contrats et avis : toute la France. Arrêtés : Rhône. », each département a
 * link. Before the build wrote it, the pilot's areas. */
export function couvertureLiee(
  cv: Pick<Couverture, "resume"> & { departements: Record<string, { nom?: string }> },
): RichItem[] {
  if (!cv.resume?.length) return pilote();
  const et = new Intl.ListFormat("fr", { type: "conjunction" });
  return cv.resume.flatMap((r, i) => {
    const mots = et.format(r.familles.map((f) => t(`sommaire.par_source.${f}`)));
    const zone: RichItem[] =
      r.zone === "france"
        ? [t("sommaire.par_source.france")]
        : r.zone === "pilote"
          ? pilote()
          : r.zone.flatMap((d, j) => [
              ...(j ? [", "] : []),
              lienDepartement(d, cv.departements[d]?.nom ?? depNom(d)),
            ]);
    return [
      ...(i ? [" "] : []),
      ...phrase("sommaire.par_source.ligne", {
        familles: mots.charAt(0).toUpperCase() + mots.slice(1),
        zone: { span: zone, cls: "" },
      }),
    ];
  });
}
