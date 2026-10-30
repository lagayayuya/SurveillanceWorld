// The fixed layers of the register's preview images (lot R3, pipeline/lacarte_registre/apercu.py),
// cut from the mockup as it renders (design/registre/v2/maquettes/V2-Partage.dc.html): the
// background map, the logo and « Le registre » (fond.png), and each type's label (etiquette-*.png,
// its pictogram, word and colour), with where each sits (calques.json). Run by hand when the mockup
// changes, never by the build:  node web/scripts/apercu-calques.mjs
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const out = resolve(root, "pipeline/lacarte_registre/apercu");
const mockup = resolve(root, "design/registre/v2/maquettes/V2-Partage.dc.html");
// The four families (design/registre/v2/README.md): a colour and a pictogram each, the
// pictogram taken from the mockup's own label of that family; one label per type.
const TYPES = [
  ["commune", "Commune", "territoire"],
  ["intercommunalite", "Intercommunalité", "territoire"],
  ["departement", "Département", "territoire"],
  ["acheteur", "Acheteur", "acheteur"],
  ["entreprise", "Entreprise", "entreprise"],
  ["contrat", "Contrat", "document"],
  ["modification", "Modification", "document"],
  ["appel_offres", "Appel d'offres", "document"],
  ["arrete", "Arrêté", "document"],
  ["subvention", "Subvention", "document"],
];
const COLOURS = {
  territoire: "#ffe800",
  acheteur: "#9be7c4",
  entreprise: "#c9b8ff",
  document: "#7fd4ff",
};
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1300, height: 700 } });
await page.goto(`file://${mockup}`);
await page.waitForTimeout(500);
// the mockup's four cards hold the four families' labels, in this order
const icons = await page.evaluate(() =>
  [...document.querySelectorAll(".og .ogstk svg")].map((s) => s.outerHTML),
);
const icon = { territoire: icons[0], entreprise: icons[1], acheteur: icons[2], document: icons[3] };
// one card alone, at its real size, at the top left of the page
await page.evaluate(() => {
  const og = document.querySelector(".og");
  og.style.transform = "none";
  // the mockup's styles live in its body: kept beside the card
  const styles = [...document.body.querySelectorAll("style, link[rel=stylesheet]")];
  document.body.replaceChildren(...styles, og);
  document.body.style.margin = "0";
  document.body.style.background = "transparent";
  document.documentElement.style.background = "transparent";
});
const card = page.locator(".og");
// the background, the logo and « Le registre »
await page.evaluate(() => {
  for (const s of [".ogmid", ".ogfig"]) document.querySelector(s).style.visibility = "hidden";
});
await card.screenshot({ path: `${out}/fond.png` });
// each type's label, alone on a transparent card
await page.evaluate(() => {
  const og = document.querySelector(".og");
  for (const c of og.children) c.style.visibility = "hidden";
  og.style.background = "transparent";
  const mid = document.querySelector(".ogmid");
  mid.style.visibility = "visible";
  for (const c of mid.children) c.style.visibility = c.matches(".ogstk") ? "visible" : "hidden";
});
const layers = { taille: [1200, 630], etiquettes: {} };
for (const [key, word, family] of TYPES) {
  const box = await page.evaluate(
    ([w, colour, svg]) => {
      const stk = document.querySelector(".ogstk");
      stk.innerHTML = `${svg}${w}`;
      stk.style.background = colour;
      const r = stk.getBoundingClientRect();
      const name = document.querySelector(".ogname").getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height, nom_y: name.y };
    },
    [word, COLOURS[family], icon[family]],
  );
  // the label with its shadow and its tilt: a margin around its box
  const m = 12;
  const clip = { x: box.x - m, y: box.y - m, width: box.w + 2 * m, height: box.h + 2 * m };
  await page.screenshot({ path: `${out}/etiquette-${key}.png`, clip, omitBackground: true });
  layers.etiquettes[key] = {
    mot: word,
    famille: family,
    couleur: COLOURS[family],
    x: Math.round(clip.x),
    y: Math.round(clip.y),
    nom_y: Math.round(box.nom_y),
  };
}
writeFileSync(`${out}/calques.json`, `${JSON.stringify(layers, null, 1)}\n`);
await browser.close();
console.log(`layers written to ${out}`);
