// The commune page's tools (the prototype's app.js `modal`, `demande` and the « Partager l'image »
// button): a dialog over the page, the request letter to copy (« Demander à la mairie / à la
// préfecture »), and the page's share image drawn on a canvas in the browser and downloaded. Every
// node is made with createElement, every word comes from the catalogue: nothing is sent anywhere.
import { t } from "../i18n.ts";

type Attrs = Record<string, string>;
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...kids: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const x = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) x.setAttribute(k, v);
  x.append(...kids);
  return x;
}

let seq = 0;
/** A modal dialog (role="dialog", the page behind made inert), closed by its button, Escape or a
 * click outside; the focus goes back to what opened it. */
export function dialogue(titre: string, corps: (Node | string)[], focus?: HTMLElement): void {
  const opener = document.activeElement as HTMLElement | null;
  const id = `dlg-${++seq}`;
  const fermer = el("button", { type: "button", class: "btn" }, t("commune.fermer"));
  const box = el(
    "div",
    { class: "box", role: "dialog", "aria-modal": "true", "aria-labelledby": id },
    el("h2", { id }, titre),
    ...corps,
    el("p", {}, fermer),
  );
  const m = el("div", { class: "dialogue" }, box);
  const behind = [...document.body.children].filter((x): x is HTMLElement => x !== m);
  const close = () => {
    m.remove();
    document.removeEventListener("keydown", key, true);
    for (const x of behind) x.inert = false;
    opener?.focus?.();
  };
  const key = (ev: KeyboardEvent) => {
    if (ev.key === "Escape") {
      ev.preventDefault();
      close();
    } else if (ev.key === "Tab") {
      // the focus stays in the dialog
      const f = [...box.querySelectorAll<HTMLElement>("a[href], button, textarea")];
      const first = f[0];
      const last = f[f.length - 1];
      if (ev.shiftKey && document.activeElement === first) {
        ev.preventDefault();
        last.focus();
      } else if (!ev.shiftKey && document.activeElement === last) {
        ev.preventDefault();
        first.focus();
      }
    }
  };
  m.addEventListener("click", (ev) => {
    if (ev.target === m) close();
  });
  fermer.addEventListener("click", close);
  document.addEventListener("keydown", key, true);
  document.body.append(m);
  for (const x of behind) x.inert = true;
  (focus ?? fermer).focus();
}

/** The letter asking a mairie or a préfecture for a document (code des relations entre le public et
 * l'administration, L.311-1), to send oneself. */
export function lettre(objet: string, qui: "mairie" | "prefecture", nom: string, dep: string) {
  const dest =
    qui === "prefecture"
      ? t("commune.demande_dest_prefecture", { dep })
      : t("commune.demande_dest_mairie", { nom });
  return t("commune.demande_lettre", { dest, objet });
}

/** « Demander à la mairie / à la préfecture »: the letter in a field, selected, with a copy button. */
export function demander(objet: string, qui: "mairie" | "prefecture", nom: string, dep: string) {
  const texte = el("textarea", { "aria-label": t("commune.demande_titre"), rows: "12" });
  texte.value = lettre(objet, qui, nom, dep);
  const copier = el("button", { type: "button", class: "btn" }, t("commune.demande_copier"));
  const dit = el("span", { "aria-live": "polite", class: "tw" });
  copier.addEventListener("click", async () => {
    texte.select();
    try {
      await navigator.clipboard.writeText(texte.value);
      dit.textContent = t("commune.demande_copie");
    } catch {
      dit.textContent = t("commune.demande_copie_main");
    }
  });
  const [avant, apres] = t("commune.demande_madada", { lien: "\uE000" }).split("\uE000");
  const madada = el(
    "a",
    { href: "https://madada.fr/", target: "_blank", rel: "noopener" },
    t("commune.demande_madada_lien"),
  );
  dialogue(
    t("commune.demande_titre"),
    [
      el(
        "p",
        {},
        t("commune.demande_intro", {
          qui: t(qui === "mairie" ? "commune.la_mairie" : "commune.la_prefecture"),
        }),
      ),
      texte,
      el("p", {}, copier, " ", dit),
      el("p", { class: "note" }, t("commune.demande_note")),
      el("p", {}, avant ?? "", madada, apres ?? ""),
    ],
    texte,
  );
  texte.select();
}

// --- the share image ---------------------------------------------------------------------------

export type Partage = {
  nom: string;
  ligne: string;
  lead: string;
  kpis: { v: string; l: string }[];
  /** The page's address, written at the bottom. */
  url: string;
  /** The element whose theme tokens colour the image. */
  scope: Element;
  fichier: string;
};

/** Words cut into lines that fit `width` (canvas measure). */
function lines(g: CanvasRenderingContext2D, text: string, width: number): string[] {
  const out: string[] = [];
  let cur = "";
  for (const w of text.split(/\s+/)) {
    const next = cur ? `${cur} ${w}` : w;
    if (cur && g.measureText(next).width > width) {
      out.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) out.push(cur);
  return out;
}

/** The page's share image (1200 × 630, the size link previews use), drawn here and downloaded. */
export async function partagerImage(o: Partage): Promise<void> {
  const W = 1200;
  const H = 630;
  const css = getComputedStyle(o.scope);
  const tok = (name: string, d: string) => css.getPropertyValue(name).trim() || d;
  const page = tok("--page", "#e6eef0");
  const fg = tok("--fg", "#111111");
  const muted = tok("--muted", "#555555");
  try {
    await Promise.all([
      document.fonts.load('900 extra-condensed 80px "Archivo"'),
      document.fonts.load('400 26px "Archivo"'),
      document.fonts.load('16px "Special Elite"'),
    ]);
  } catch {
    // the system's font then
  }
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d");
  if (!g) return;
  // the kit's condensed capitals: the stretch is part of the font shorthand (setting `font` alone
  // would reset a separate fontStretch)
  const font = (weight: number, stretch: string, px: number, family = '"Archivo", sans-serif') => {
    g.font = `${weight} ${stretch} ${px}px ${family}`;
  };
  /** The largest size up to `px` at which `text` fits `width`. */
  const fit = (text: string, weight: number, stretch: string, px: number, width: number) => {
    let size = px;
    font(weight, stretch, size);
    while (g.measureText(text).width > width && size > 20) {
      size -= 2;
      font(weight, stretch, size);
    }
    return size;
  };
  g.fillStyle = page;
  g.fillRect(0, 0, W, H);
  // the header band
  g.fillStyle = "#000";
  g.fillRect(0, 0, W, 64);
  g.fillStyle = "#f2efe6";
  font(900, "condensed", 28);
  g.textBaseline = "middle";
  g.fillText(t("commune.image_marque").toUpperCase(), 48, 33);
  // the tag and the name
  g.textBaseline = "alphabetic";
  font(800, "semi-condensed", 18);
  const tag = t("commune.commune").toUpperCase();
  const tw = g.measureText(tag).width + 20;
  g.fillStyle = "#ffe800";
  g.fillRect(48, 92, tw, 30);
  g.fillStyle = "#111";
  g.fillText(tag, 58, 114);
  const size = fit(o.nom.toUpperCase(), 900, "extra-condensed", 104, W - 96);
  g.fillStyle = fg;
  g.fillText(o.nom.toUpperCase(), 44, 130 + size * 0.85);
  let y = 130 + size * 0.85 + 34;
  font(400, "normal", 18, '"Special Elite", monospace');
  g.fillStyle = muted;
  g.fillText(o.ligne, 48, y);
  y += 44;
  font(500, "normal", 28);
  g.fillStyle = fg;
  for (const l of lines(g, o.lead, W - 96).slice(0, 3)) {
    g.fillText(l, 48, y);
    y += 38;
  }
  // the four figures
  const top = Math.max(y + 10, 430);
  g.fillRect(48, top, W - 96, 3);
  const cw = (W - 96) / o.kpis.length;
  o.kpis.forEach((k, i) => {
    const x = 48 + i * cw + (i ? 18 : 0);
    fit(k.v, 900, "extra-condensed", 60, cw - 30);
    g.fillStyle = fg;
    g.fillText(k.v, x, top + 66);
    font(400, "normal", 20);
    lines(g, k.l, cw - 24)
      .slice(0, 2)
      .forEach((l, j) => {
        g.fillText(l, x, top + 98 + j * 24);
      });
  });
  font(400, "normal", 15, '"Special Elite", monospace');
  g.fillStyle = muted;
  g.fillText(o.url, 48, H - 22);
  const src = t("commune.image_sources");
  g.fillText(src, W - 48 - g.measureText(src).width, H - 22);
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/png"));
  if (!blob) return;
  const href = URL.createObjectURL(blob);
  const a = el("a", { href, download: o.fichier });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}
