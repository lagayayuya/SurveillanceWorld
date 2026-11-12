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
        // the series' colour as its legend draws it: the swatch classes are the view's (under
        // .va.com, .va.ent…), out of reach of the bubble, which lives beside the view
        const c = couleur(m[1]);
        if (c) i.style.background = c;
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

  /** A series' colour read where the view draws it: a legend swatch, a bar, a mark. */
  const couleur = (cls: string): string | null => {
    const sel = cls
      .trim()
      .split(/\s+/)
      .map((c) => `.${CSS.escape(c)}`)
      .join("");
    for (const e of root.querySelectorAll(sel)) {
      const st = getComputedStyle(e);
      const bg = st.backgroundColor;
      if (bg && !/^(transparent|rgba\(0, 0, 0, 0\))$/.test(bg)) return bg;
      const fill = e instanceof SVGElement ? st.fill : "";
      if (fill && fill !== "none" && !/^rgba\(0, 0, 0, 0\)$/.test(fill)) return fill;
    }
    return null;
  };

  /** Where a bubble may stand: the frame's visible scroll (or the 3D view's panel), under the
   * section bar that sticks at its top, 8 px from every edge. */
  const cadre = (el: Element) => {
    const box = (
      el.closest(".v3p") ??
      hote.parentElement ??
      document.documentElement
    ).getBoundingClientRect();
    let top = Math.max(box.top, 0);
    const bottom = Math.min(box.bottom, window.innerHeight);
    const left = Math.max(box.left, 0);
    const right = Math.min(box.right, document.documentElement.clientWidth);
    for (const s of root.querySelectorAll(".toc")) {
      const r = s.getBoundingClientRect();
      if (r.height && r.top <= top + 2 && r.bottom > top && !s.contains(el)) top = r.bottom;
    }
    return { top: top + 8, bottom: bottom - 8, left: left + 8, right: right - 8 };
  };

  // whole inside the frame: above the element, centred; else below; else beside it (right, then
  // left), its middle level with the element's; clamped to the frame on both axes
  const placer = (el: Element) => {
    const r = el.getBoundingClientRect();
    const hr = hote.getBoundingClientRect();
    const B = cadre(el);
    tip.style.left = "0px";
    tip.style.top = "0px";
    tip.style.maxWidth = `${Math.max(160, Math.min(300, B.right - B.left))}px`;
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    const clampX = (x: number) => Math.min(Math.max(B.left, x), Math.max(B.left, B.right - w));
    const clampY = (y: number) => Math.min(Math.max(B.top, y), Math.max(B.top, B.bottom - h));
    let x: number;
    let y: number;
    if (r.top - h - 10 >= B.top) {
      x = clampX(r.left + r.width / 2 - w / 2);
      y = r.top - h - 10;
    } else if (r.bottom + 10 + h <= B.bottom) {
      x = clampX(r.left + r.width / 2 - w / 2);
      y = r.bottom + 10;
    } else {
      x = r.right + 10 + w <= B.right ? r.right + 10 : clampX(r.left - w - 10);
      y = clampY(r.top + r.height / 2 - h / 2);
    }
    tip.style.left = `${(x - hr.left).toFixed(0)}px`;
    tip.style.top = `${(y - hr.top).toFixed(0)}px`;
  };

  /** A row of a list or a table that leads somewhere, clicked beside its link: its first link. The
   * documents' table and the rows that choose (aria-current) have their own click. */
  const ligne = (ev: MouseEvent): boolean => {
    const tg = ev.target instanceof Element ? ev.target : null;
    if (!tg || tg.closest("a[href], button, input, label, select, summary")) return false;
    const row = tg.closest(
      ":is(ol.top, ol.rank) > li, table:not(.docs) tbody tr:not([aria-current])",
    );
    if (!row || !root.contains(row)) return false;
    const lien = row.querySelector("a[href]");
    if (!lien) return false;
    ev.preventDefault();
    ev.stopImmediatePropagation();
    cliquer(lien);
    return true;
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
      ligne(ev);
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
      return;
    }
    // « Clic : … » promised: the whole element does it, not only its underlined name — a click
    // beside its link or button follows that link or button
    const on =
      ev.target instanceof Element ? ev.target.closest("a[href], button, input, label") : null;
    if (el.getAttribute("data-bc") && !el.matches("a[href], button") && !(on && el.contains(on))) {
      const lien = el.querySelector("a[href], button");
      if (lien) {
        ev.preventDefault();
        ev.stopImmediatePropagation();
        cliquer(lien);
        return;
      }
    }
    ligne(ev);
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
