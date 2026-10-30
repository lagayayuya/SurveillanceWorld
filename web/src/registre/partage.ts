// « Partager » a fiche (design/registre/v2: V2-Entreprise, V2-Tel-Entreprise, V2-Partage). On a wide
// screen a small window in the frame: the fiche's preview image, « Copier le lien », « Copier le
// texte », nothing else. On a phone a drawer at the bottom of the sheet: the image, « Partager… »
// (the device's own share sheet, navigator.share: the title, the text, the link) and « Copier le
// lien ». The link opens the fiche again at the section one is reading; a list keeps its filters (its
// query). No social network's button, nothing loaded from another site. The text and the image are
// the build's (lot R3): without them the window shares the link alone.
import { t } from "./i18n.ts";

/** What a page shares: its title, and R3's text and image when the build wrote them. */
type Partageable = { partage(): { titre: string; texte?: string; image?: string } | null };

const SVG = "http://www.w3.org/2000/svg";
let ouvert: { box: HTMLElement; retour: Element | null; fermer: () => void } | null = null;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...kids: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const x = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) x.setAttribute(k, v);
  x.append(...kids);
  return x;
}

/** The section one is reading (the band's current one), kept in the link. */
function lienDeLaPage(): string {
  const sec = document.querySelector<HTMLElement>("#registre [data-sec][aria-current='true']")
    ?.dataset.sec;
  return `${location.origin}${location.pathname}${location.search}${sec ? `#${sec}` : ""}`;
}

async function copier(texte: string, bouton: HTMLButtonElement, fait: string): Promise<void> {
  const avant = bouton.textContent ?? "";
  try {
    await navigator.clipboard.writeText(texte);
    bouton.textContent = fait;
  } catch {
    bouton.textContent = t("partage.impossible");
  }
  setTimeout(() => {
    if (bouton.isConnected) bouton.textContent = avant;
  }, 2000);
}

/** The preview image when the build has made it (R3): asked, shown only once it has arrived. */
function image(src: string | undefined, largeur: number): HTMLElement | null {
  if (!src || !/^\/data\/registre\//.test(src)) return null;
  const img = el("img", { src, alt: "", width: String(largeur), height: String(largeur * 0.525) });
  img.className = "ogimg";
  img.hidden = true;
  img.addEventListener("load", () => {
    img.hidden = false;
  });
  img.addEventListener("error", () => img.remove());
  return img;
}

export function fermerPartage(): void {
  ouvert?.fermer();
}

/** Opens the share window (or drawer) of the view shown; `depuis` gets the focus back. */
export function partager(vue: Partageable, depuis: Element | null): void {
  if (ouvert) {
    fermerPartage();
    return;
  }
  const p = vue.partage();
  const cadre = document.querySelector<HTMLElement>("#registre .modal, #registre .sheet");
  if (!p || !cadre) return;
  const large = matchMedia("(min-width: 960px)").matches;
  const titre = el("b", { class: "h3", id: "partage-titre" }, t("partage.titre"));
  titre.style.setProperty("font-size", large ? "20px" : "18px");
  const x = el("button", { class: "ibtn", type: "button", "aria-label": t("partage.fermer") });
  x.append(el("span", {}, "✕"));
  const haut = el("div", { class: "partage-haut" }, titre, x);
  const lien = el("button", { class: large ? "more" : "key", type: "button" }, t("partage.lien"));
  lien.addEventListener("click", () => void copier(lienDeLaPage(), lien, t("partage.lien_copie")));
  const boutons = el("div", { class: "sbtns" });
  if (large) {
    boutons.append(lien);
    if (p.texte) {
      const texte = el("button", { class: "key", type: "button" }, t("partage.texte"));
      const tout = `${p.texte}\n${lienDeLaPage()}`;
      texte.addEventListener("click", () => void copier(tout, texte, t("partage.texte_copie")));
      boutons.append(texte);
    }
  } else {
    if (typeof navigator.share === "function") {
      const natif = el("button", { class: "more", type: "button" }, t("partage.partager"));
      natif.style.setProperty("flex", "1");
      natif.style.setProperty("justify-content", "center");
      natif.addEventListener("click", () => {
        void navigator
          .share({ title: p.titre, text: p.texte ?? p.titre, url: lienDeLaPage() })
          .catch(() => {});
      });
      boutons.append(natif);
    }
    boutons.append(lien);
  }
  const box = el(
    "div",
    {
      class: large ? "rg-share" : "rg-drawer partage",
      role: "dialog",
      "aria-labelledby": "partage-titre",
    },
    haut,
  );
  const img = image(p.image, large ? 480 : 358);
  if (img) box.append(img);
  box.append(boutons);
  const cle = (ev: KeyboardEvent) => {
    if (ev.key !== "Escape") return;
    // the share closes, the register stays
    ev.preventDefault();
    ev.stopPropagation();
    fermerPartage();
  };
  const fermer = () => {
    box.remove();
    box.removeEventListener("keydown", cle);
    const r = ouvert?.retour;
    ouvert = null;
    if (r instanceof HTMLElement && r.isConnected) r.focus();
  };
  box.addEventListener("keydown", cle);
  x.addEventListener("click", fermer);
  ouvert = { box, retour: depuis, fermer };
  cadre.append(box);
  lien.focus();
}

/** The phone's share square, in the sheet's top (V2-Tel-Entreprise). */
export function boutonPartage(vue: Partageable): HTMLButtonElement | null {
  if (!vue.partage()) return null;
  const b = el("button", { class: "sq", type: "button", "aria-label": t("partage.titre") });
  const svg = document.createElementNS(SVG, "svg");
  for (const [k, v] of Object.entries({
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "2.4",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
  }))
    svg.setAttribute(k, v);
  const path = document.createElementNS(SVG, "path");
  path.setAttribute("d", "M12 15V3M7 8l5-5 5 5M5 13v7h14v-7");
  svg.append(path);
  b.append(svg);
  b.setAttribute("aria-haspopup", "dialog");
  b.addEventListener("click", () => partager(vue, b));
  return b;
}
