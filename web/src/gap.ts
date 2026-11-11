// « Combien en manque-t-il ? » (board 12 · Fiches de la carte v3): the cameras the prefecture
// authorised in a place against the cameras the map knows there, one block shared by the camera,
// commune and département sheets. What the data does not serve is written « non lu », never 0
// (donnees-pour-l-interface, 09/11: « Affiche « non lu », jamais 0, quand l'état n'est pas
// `lu` »). The authorised cameras come from the register's `cam_aut` (placedata.ts autOf); until
// it is served the block says so and draws no gap.
import {
  type Autorisees,
  CATEGORIES,
  type Etat,
  ecart,
  nb,
  nonRattache,
  totalAut,
} from "./gapcalc.ts";
import { has, t } from "./i18n";

export { type Autorisees, CATEGORIES, type Etat, ecart, nb, totalAut };

export type GapInput = {
  /** « À Lyon », « Dans le Rhône ». */
  lieu: string;
  /** Cameras on the map; null when the map's count is not known for this place. */
  carte: number | null;
  publiques: number | null;
  autres: number | null;
  /** Null: `cam_aut` not served for this place. */
  aut: Autorisees | null;
  etat: Etat;
  /** « + Ajouter une caméra »: the map's own add (participate/index.ts). Absent, no button. */
  onAdd?: () => void;
  /** The place's page in the register, when it has one. */
  registre?: { href: string; label: string } | null;
};

function el(tag: string, cls = "", text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
const nonLu = () => el("span", "nl", t("gap.non_lu"));

/** A count's row; a 0 among acts not tied to their commune says « non rattaché », never 0. */
function row(label: string, value: number | null, nr = false): HTMLElement {
  const li = el("li");
  const b = el("b");
  if (value === null) b.append(nonLu());
  else if (value === 0 && nr) b.append(el("span", "nl", t("gap.non_rattache")));
  else b.textContent = nb(value);
  const lead = el("span", "lead");
  lead.setAttribute("aria-hidden", "true");
  li.append(el("span", "k", label), lead, b);
  return li;
}

function bar(
  label: string,
  value: number | null,
  max: number,
  cls: string,
  nr = false,
): HTMLElement {
  const r = el("div", "gr");
  const track = el("span", "gt");
  if (value === null) track.append(el("span", "gb nl", t(nr ? "gap.non_rattache" : "gap.non_lu")));
  else if (value > 0) {
    const fill = el("span", `gb ${cls}`);
    fill.style.width = `${Math.max(2, Math.round((1000 * value) / max) / 10)}%`;
    fill.setAttribute("aria-hidden", "true");
    track.append(fill);
  }
  r.append(
    el("span", "gl", label),
    track,
    el("b", "gv", value === null ? t("gap.dash") : nb(value)),
  );
  return r;
}

const year = (iso: string) => iso.slice(0, 4);
const month = (iso: string) =>
  new Date(`${iso.slice(0, 7)}-15T12:00:00`).toLocaleDateString("fr", {
    month: "short",
    year: "numeric",
  });

/** « Autorisées depuis 2025 », « Autorisées de nov. 2025 à oct. 2026 », or « Autorisées ». */
function autTitle(aut: Autorisees | null): string {
  const p = aut?.periode;
  if (!p) return t("gap.split.aut");
  return year(p[0]) === year(p[1]) || p[1] >= new Date().toISOString().slice(0, 7)
    ? t("gap.split.aut_depuis", { an: year(p[0]) })
    : t("gap.split.aut_de_a", { de: month(p[0]), a: month(p[1]) });
}

const cap = (s: string) => s.charAt(0).toLocaleUpperCase("fr") + s.slice(1);
/** « Dans le Rhône », « À Paris », « Dans les Bouches-du-Rhône » (the catalogue's articles,
 * `dep.dans.<code>`, the register's own copied for the map). */
export const dansDep = (code: string, nom: string): string =>
  cap(
    has(`dep.dans.${code}`) ? t(`dep.dans.${code}`) : t("dep.dans", { art: t("dep.art", { nom }) }),
  );
/** « Le Rhône », « Paris ». */
export const artDep = (code: string, nom: string): string =>
  cap(has(`dep.art.${code}`) ? t(`dep.art.${code}`) : t("dep.art", { nom }));

/** « Lyon dans le registre : 447 arrêtés de caméras → », « au moins N » when its acts are not all
 * tied to their commune, the name alone when not read. */
export function registreLien(
  nom: string,
  actes: { n: number; min: boolean } | undefined,
  href: string,
  dep = false,
): { href: string; label: string } {
  const label =
    actes === undefined
      ? t("gap.registre_commune_nl", { nom })
      : actes.min
        ? t("gap.registre_commune_min", { nom, n: actes.n })
        : t(dep ? "gap.registre_dep" : "gap.registre_commune", { nom, n: actes.n });
  return { href, label };
}

/** The block. */
export function gapBlock(input: GapInput): HTMLElement {
  const box = el("section", "gap");
  box.setAttribute("aria-label", t("gap.label", { lieu: input.lieu }));

  const head = el("div", "gap-head");
  head.append(el("h3", "area-label", input.lieu), el("span", "area-sub", t("gap.sub")));

  const nr = nonRattache(input.etat);
  // Not tied and nothing read here: the bar says so, no number (never « 0 »).
  const total = nr && !totalAut(input.aut, input.etat)?.n ? null : totalAut(input.aut, input.etat);
  const max = Math.max(input.carte ?? 0, total?.n ?? 0, 1);
  const bars = el("div", "gap-bars");
  bars.append(
    bar(t("gap.carte"), input.carte, max, "c"),
    bar(t("gap.autorisees"), total ? total.n : null, max, "a", nr),
  );

  const big = el("p", "gap-big");
  const e = ecart(input);
  if (e.kind === "plus") {
    big.append(
      el("b", "", t(e.auMoins ? "gap.big.au_moins" : "gap.big.plus", { n: nb(e.n) })),
      el("span", "", t(e.auMoins ? "gap.big.au_moins_text" : "gap.big.text")),
    );
  } else if (e.kind === "moins") {
    big.append(el("span", "", t("gap.big.moins", { v: nb(e.n), n: e.n })));
  } else {
    const key = {
      non_lu: "gap.big.non_lu",
      non_rattache: "gap.big.non_rattache",
      incomplet: "gap.big.incomplet",
    }[e.kind];
    big.append(el("span", "", t(key)));
  }

  const split = el("div", "gap-split");
  const mapCol = el("div");
  const mapList = el("ul");
  mapList.append(
    row(t("gap.split.publiques"), input.publiques),
    row(t("gap.split.autres"), input.autres),
  );
  mapCol.append(el("p", "area-sub", t("gap.split.carte")), mapList);
  const autCol = el("div");
  const autList = el("ul");
  for (const cle of CATEGORIES) {
    const r = input.aut?.rows.find((x) => x.cle === cle);
    autList.append(row(t(`gap.cat.${cle}`), r ? r.n : null, nr));
  }
  // The cameras whose holder is not read, counted in the total (`non_classees`).
  const nc = input.aut?.nonClassees ?? null;
  if (nc) autList.append(row(t("gap.cat.non_classees"), nc));
  autCol.append(el("p", "area-sub", autTitle(input.aut)), autList);
  split.append(mapCol, autCol);

  const fine = el("p", "fine", `${t("gap.fine")} `);
  const vp = input.aut?.voiePublique ?? null;
  if (vp === null) fine.append(nonLu(), ".");
  else fine.append(el("b", "", nb(vp)), ".");

  box.append(head, bars, big, split, fine);
  if (input.onAdd) {
    const cta = el("div", "gap-cta");
    const b = el("button", "cta", t("gap.add"));
    b.setAttribute("type", "button");
    b.addEventListener("click", input.onAdd);
    cta.append(b, el("span", "", t("gap.add_text")));
    box.append(cta);
  }
  if (input.registre) {
    const a = el("a", "sheet-link more", input.registre.label) as HTMLAnchorElement;
    a.href = input.registre.href;
    box.append(a);
  }
  return box;
}
