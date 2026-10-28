// « Demander à la mairie / à la préfecture » (the v10 request dialog): a template of a request for
// administrative documents (CRPA L.311-1), to copy and send oneself; nothing is sent from the site. Any
// element of a view carrying data-demande (the object asked for), data-qui (« mairie » or « prefecture »)
// and data-insee opens it. The dialog is built node by node (.modal of registre.css), every word from
// the catalogue.

import { commune } from "./commun.ts";
import { t } from "./i18n.ts";

/** The request's text: its addressee, the object asked for, the usual mentions. */
export function modele(objet: string, qui: string, nom: string, dep: string): string {
  const dest =
    qui === "prefecture"
      ? t("demande.dest_prefecture", { dep })
      : t("demande.dest_mairie", { nom });
  return t("demande.modele", { dest, objet });
}

function ouvrir(objet: string, qui: string, nom: string, dep: string): void {
  const opener = document.activeElement as HTMLElement | null;
  const m = document.createElement("div");
  m.className = "modal";
  const box = document.createElement("div");
  box.className = "box";
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-modal", "true");
  box.setAttribute("aria-labelledby", "dlg-demande");
  const h = document.createElement("h2");
  h.id = "dlg-demande";
  h.textContent = t("demande.titre");
  const intro = document.createElement("p");
  intro.textContent = t(qui === "prefecture" ? "demande.intro_prefecture" : "demande.intro_mairie");
  const area = document.createElement("textarea");
  area.readOnly = true;
  area.value = modele(objet, qui, nom, dep);
  area.setAttribute("aria-label", t("demande.titre"));
  const note = document.createElement("p");
  note.className = "note";
  note.textContent = t("demande.note");
  const dada = document.createElement("p");
  dada.append(`${t("demande.madada_avant")} `);
  const a = document.createElement("a");
  a.href = "https://madada.fr/";
  a.target = "_blank";
  a.rel = "noopener";
  a.textContent = t("demande.madada_lien");
  dada.append(a, ` ${t("demande.madada_apres")}`);
  const p = document.createElement("p");
  const close = document.createElement("button");
  close.type = "button";
  close.className = "btn";
  close.textContent = t("demande.fermer");
  p.append(close);
  box.append(h, intro, area, note, dada, p);
  m.append(box);
  const shut = () => {
    m.remove();
    document.removeEventListener("keydown", key);
    opener?.focus?.();
  };
  const key = (ev: KeyboardEvent) => {
    if (ev.key === "Escape") shut();
  };
  m.addEventListener("click", (ev) => {
    if (ev.target === m || ev.target === close) shut();
  });
  document.addEventListener("keydown", key);
  document.body.append(m);
  area.focus();
  area.select();
}

// before the router's own listener (main.ts), which would take the link for a page of the register
document.addEventListener(
  "click",
  (ev) => {
    const el = (ev.target as Element | null)?.closest?.<HTMLElement>("[data-demande]");
    if (!el) return;
    ev.preventDefault();
    const { demande = "", qui = "mairie", insee = "" } = el.dataset;
    void commune(insee).then(
      (d) => ouvrir(demande, qui, d.f.commune.nom, d.f.commune.dep),
      () => ouvrir(demande, qui, insee, insee.slice(0, 2)),
    );
  },
  true,
);
