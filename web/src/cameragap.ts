// The camera sheet's « Combien en manque-t-il ? » (board 12, Carte3-Camera): the block of the
// commune the camera stands in (gap.ts), from the tiles' commune under it (main.ts cameraGap) and
// the register's file of its département (placedata.ts). A municipal arrondissement's camera is
// its commune's (« À Lyon »): the map's count is the register's for the commune, its split by
// operator not known here. Asked by the page when a camera opens, a chunk of its own.
import type { AreaProps } from "./area";
import { gapBlock } from "./gap";
import { t } from "./i18n";
import { aCommune, actesCam, autOf, etatCam, loadDep, parentCommune } from "./placedata";

export async function fillCameraGap(
  slot: HTMLElement,
  commune: AreaProps,
  opts: { onAdd?: () => void },
): Promise<void> {
  const code = String(commune.c);
  const unit = parentCommune(code);
  // The slot may be out of the page meanwhile (the sheet drawn again keeps it): filled anyway.
  const dep = await loadDep(String(commune.d));
  const stats = dep?.stats.communes[unit];
  const own = unit === code;
  const n = Number(commune.n ?? 0);
  const pub = Number(commune.n_pub ?? 0);
  const nom = own
    ? String(commune.nm)
    : (dep?.communes[unit]?.nom ?? String(commune.nm).replace(/ \d+(er|e) Arrondissement$/i, ""));
  const etat = etatCam(dep, unit);
  slot.replaceChildren(
    gapBlock({
      lieu: aCommune(nom),
      carte: own ? n : (stats?.carte ?? null),
      publiques: own ? pub : null,
      autres: own ? n - pub : null,
      aut: autOf(stats?.cam_aut),
      etat,
      onAdd: opts.onAdd,
      registre: stats
        ? {
            href: `/registre/commune/${unit}`,
            label:
              actesCam(dep, unit) === undefined
                ? t("gap.registre_commune_nl", { nom })
                : t("gap.registre_commune", { nom, n: actesCam(dep, unit) ?? 0 }),
          }
        : null,
    }),
  );
}
