// Theme A's bubbles (the boards' .tip, board Lyon-A-comportements): « survol = lire, clic = aller ».
// An element carries its bubble in data attributes, so that every view draws them the same way:
//   data-bh  the heading (« 2022 · 10,2 M€ »)
//   data-bl  its lines, separated by "\n"; a line "§c-ville§Ville de Lyon · 10,2 M€" opens with
//            the swatch of that class
//   data-bc  what the click does (« Clic : … »); without it the element has no click
//   data-go  (optional) where the click goes, for an element that is not a link
// and a container `data-bg` pales its other members while one is read.
// Mouse: the bubble on hover. Keyboard: on focus (Tab); Enter does the click, Escape hides it.
// Touch: the first tap shows the bubble, with « Ouvrir » in it when the element has a click; a
// second tap on the same element does the click. The bubble stays inside the screen.

import { t } from "./i18n.ts";

const SEL = "[data-bh],[data-bl]";
let suivi = false;

/** Follows a register link from a handler (the frame's router takes it, hote.ts). */
export function allerA(href: string): void {
  const a = document.createElement("a");
  a.href = href;
  document.getElementById("registre")?.append(a);
  a.click();
  a.remove();
}

/** The element's click, done as a pointer would: its link, its button, its handler. */
function cliquer(el: Element): void {
  const go = el.getAttribute("data-go");
  if (go) {
    allerA(go);
    return;
  }
  const lien = el.matches("a[href], button") ? el : el.querySelector("a[href]");
  suivi = true;
  try {
    (lien ?? el).dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, view: window }),
    );
  } finally {
    suivi = false;
  }
}

/** Installs the bubbles on the frame's view root; the bubble lives in `hote`, beside the root,
 * where the template engine never patches. Returns the uninstaller. */
export function bulles(root: HTMLElement, hote: HTMLElement): () => void {
  const tip = document.createElement("div");
  tip.className = "tip bulle";
  tip.id = "bulle";
  tip.setAttribute("role", "tooltip");
  tip.hidden = true;
  hote.append(tip);
  let cur: Element | null = null;
  let tactile = false;
  // a focus a pointer gave (a tap, a click) is not a keyboard's: the hover or the tap reads it
  let clavier = false;

  const cacher = () => {
    if (cur) {
      cur.removeAttribute("aria-describedby");
      cur.classList.remove("hl");
      cur.closest("[data-bg]")?.classList.remove("pale");
    }
    cur = null;
    tip.hidden = true;
    tip.classList.remove("tact");
  };

  const montrer = (el: Element, tact: boolean) => {
    if (cur !== el) cacher();
    cur = el;
    tip.replaceChildren();
    const h = el.getAttribute("data-bh");
    if (h) {
      const b = document.createElement("b");
      b.className = "tt-h";
      b.textContent = h;
      tip.append(b);
    }
    for (const l of (el.getAttribute("data-bl") ?? "").split("\n").filter(Boolean)) {
      const s = document.createElement("span");
      const m = /^§([\w -]+)§(.*)$/.exec(l);
      if (m) {
        const i = document.createElement("i");
        i.className = `sw ${m[1]}`;
        i.setAttribute("aria-hidden", "true");
        s.append(i, m[2]);
      } else s.textContent = l;
      tip.append(s);
    }
    const c = el.getAttribute("data-bc");
    if (c && !tact) {
      const em = document.createElement("em");
      em.textContent = c;
      tip.append(em);
    }
    if (c && tact) {
      const o = document.createElement("button");
      o.type = "button";
      o.className = "btn pri";
      o.textContent = t("socle_a.ouvrir");
      o.addEventListener("click", (ev) => {
        ev.stopPropagation();
        cacher();
        cliquer(el);
      });
      tip.append(o);
    }
    tip.classList.toggle("tact", tact);
    tip.hidden = false;
    el.setAttribute("aria-describedby", tip.id);
    el.classList.add("hl");
    el.closest("[data-bg]")?.classList.add("pale");
    placer(el);
  };

  // above the element, centred, kept inside the screen (8 px from its edges); below when the top
  // of the screen would cut it
  const placer = (el: Element) => {
    const r = el.getBoundingClientRect();
    const hr = hote.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    tip.style.left = "0px";
    tip.style.top = "0px";
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    const x = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), vw - w - 8);
    const y = r.top - h - 10 >= 8 ? r.top - h - 10 : r.bottom + 10;
    tip.style.left = `${(x - hr.left).toFixed(0)}px`;
    tip.style.top = `${(y - hr.top).toFixed(0)}px`;
  };

  const cible = (n: EventTarget | null): Element | null =>
    n instanceof Element ? n.closest(SEL) : null;

  const over = (ev: PointerEvent) => {
    if (ev.pointerType === "touch") return;
    const el = cible(ev.target);
    if (el && root.contains(el)) montrer(el, false);
  };
  const out = (ev: PointerEvent) => {
    if (ev.pointerType === "touch" || !cur) return;
    const to = ev.relatedTarget as Node | null;
    if (to && cur.contains(to)) return;
    if (document.activeElement !== cur) cacher();
  };
  const down = (ev: PointerEvent) => {
    tactile = ev.pointerType === "touch";
    clavier = false;
  };
  const clic = (ev: MouseEvent) => {
    if (suivi) return;
    const el = cible(ev.target);
    if (!el || !root.contains(el)) {
      if (tactile && cur && !tip.contains(ev.target as Node)) cacher();
      return;
    }
    if (tactile) {
      // the first tap reads, the second (or « Ouvrir ») goes
      if (cur !== el || tip.hidden) {
        ev.preventDefault();
        ev.stopImmediatePropagation();
        montrer(el, true);
        return;
      }
      cacher();
    }
    const go = el.getAttribute("data-go");
    if (go && !el.matches("a[href]")) {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      allerA(go);
    }
  };
  const focus = (ev: FocusEvent) => {
    if (!clavier) return;
    const el = cible(ev.target);
    if (el && root.contains(el)) montrer(el, false);
  };
  const blur = (ev: FocusEvent) => {
    const to = ev.relatedTarget as Node | null;
    if (cur && !(to && (cur.contains(to) || tip.contains(to)))) cacher();
  };
  const touche = (ev: KeyboardEvent) => {
    clavier = true;
    if (ev.key === "Escape") return;
    if (ev.key !== "Enter" && ev.key !== " ") return;
    const el = ev.target instanceof Element ? ev.target : null;
    if (!el?.matches(SEL) || !el.getAttribute("data-bc")) return;
    if (el.closest("a[href],button")) return;
    ev.preventDefault();
    cacher();
    cliquer(el);
  };
  // Escape hides an open bubble, and only that: the frame does not close under it
  const echap = (ev: KeyboardEvent) => {
    if (ev.key !== "Escape" || !cur || tip.hidden) return;
    ev.preventDefault();
    ev.stopImmediatePropagation();
    cacher();
  };
  // a scroll moves the bubble with its element when the keyboard's focus is on it (a Tab scrolls
  // the frame to bring it in sight), hides it otherwise
  const defile = () => {
    if (!cur || tip.classList.contains("tact")) return;
    if (document.activeElement === cur) placer(cur);
    else cacher();
  };

  root.addEventListener("pointerover", over);
  root.addEventListener("pointerout", out);
  document.addEventListener("pointerdown", down, true);
  document.addEventListener("click", clic, true);
  root.addEventListener("focusin", focus);
  root.addEventListener("focusout", blur);
  document.addEventListener("keydown", touche);
  window.addEventListener("keydown", echap, true);
  hote.parentElement?.addEventListener("scroll", defile, { passive: true });
  return () => {
    root.removeEventListener("pointerover", over);
    root.removeEventListener("pointerout", out);
    document.removeEventListener("pointerdown", down, true);
    document.removeEventListener("click", clic, true);
    root.removeEventListener("focusin", focus);
    root.removeEventListener("focusout", blur);
    document.removeEventListener("keydown", touche);
    window.removeEventListener("keydown", echap, true);
    tip.remove();
  };
}
