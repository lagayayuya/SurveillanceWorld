// The confetti cannon of the punk interface, shared by the welcome (board 28a: two party
// poppers behind the top of its panel, a decoration of about 1.6 s on a first visit) and
// the send (board 8a: a cannon in the corner that shakes, has its string pulled and bursts
// upwards). Shapes, colours, angles and timings are the mockups' (Accueil Surveillance
// World.dc.html fanfarePair, Carte punk.dc.html crVals), their pseudo-random series
// included, so that two runs draw the same confetti. Pure decoration: aria-hidden, no
// pointer events, removed once played; nothing of it under reduced motion but 28a's still
// cones (theme/punk/cannon.css). DECISIONS 2026-10-06, « Animations: at most 400 ms… »: it
// blocks nothing, never loops, and flashes nowhere.

/** Motion is welcome (the phone's « Réduire les animations » off). */
export function motion(): boolean {
  return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function el(cls: string, style: Record<string, string | number> = {}): HTMLElement {
  const e = document.createElement(cls === "i" ? "i" : "div");
  if (cls !== "i") e.className = cls;
  for (const [k, v] of Object.entries(style)) e.style.setProperty(k, String(v));
  return e;
}

const px = (n: number) => `${n.toFixed(1)}px`;

/** 28a's series (mulberry32). */
function mulberry(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** 8a's series (Lehmer). */
function lehmer(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

/** One piece of confetti: four shapes (a strip, a square, a dot, a stick; 8a adds a long
 * stick), its flight up to (x1, y1) in 38 % of its time, then its fall to (x2, y2) turning
 * `r` and fading out (the mockups' cfly / pfly, each piece its own path: Web Animations,
 * so that no style reads a variable). */
function piece(
  i: number,
  colour: string,
  shapes: number,
  fly: { x1: number; y1: number; x2: number; y2: number; r: number },
  timing: { duration: number; delay: number },
): HTMLElement {
  const s = i % shapes;
  const w = [7, 9, 8, 4, 3][s];
  const h = [13, 9, 8, 18, 30][s];
  const p = el("i", {
    left: px(-w / 2),
    top: px(-h / 2),
    width: `${w}px`,
    height: `${h}px`,
    background: colour,
    "border-radius": s === 2 ? "50%" : "1px",
  });
  p.animate(
    [
      { translate: "0 0", rotate: "0deg", scale: "0.3", opacity: 1, offset: 0 },
      {
        translate: `${px(fly.x1)} ${px(fly.y1)}`,
        rotate: `${Math.round(fly.r * 0.4)}deg`,
        scale: "1",
        offset: 0.38,
        easing: "cubic-bezier(.45,0,.85,.6)",
      },
      { opacity: 1, offset: 0.85 },
      {
        translate: `${px(fly.x2)} ${px(fly.y2)}`,
        rotate: `${Math.round(fly.r)}deg`,
        scale: "1",
        opacity: 0,
        offset: 1,
      },
    ],
    {
      duration: Math.round(timing.duration),
      delay: Math.round(timing.delay),
      easing: "cubic-bezier(.1,.8,.3,1)",
      fill: "both",
    },
  );
  return p;
}

/** 28a's colours on the dark panel. */
const POPPER_INKS = ["#ff48b0", "#7fd4ff", "#ffe800", "#f2efe6", "#ff48b0", "#7fd4ff"];

/** 28a: a party popper slipped behind each top corner of the welcome panel, 70 px in, its
 * mouth over the panel's edge; it pops (420 ms) and throws `count` pieces up and out
 * (1.3 to 2 s). Under reduced motion the two cones alone, still. The caller places the
 * returned elements in the panel (position: relative) and removes them afterwards. */
export function poppers(seed: number, count = 60): HTMLElement[] {
  const out: HTMLElement[] = [];
  const moving = motion();
  const n = Math.round(count / 2);
  (["left", "right"] as const).forEach((side, k) => {
    const dir = side === "left" ? 1 : -1;
    const R = mulberry(seed + k * 501);
    const cone = el(`popper popper-${side}`);
    cone.setAttribute("aria-hidden", "true");
    const tilt = el("popper-cone", { rotate: `${dir * 16}deg` });
    const pop = el("popper-pop");
    pop.append(el("popper-body"), el("popper-rim"));
    tilt.append(pop);
    cone.append(tilt);
    out.push(cone);
    if (!moving) return;
    const spray = el(`popper popper-spray popper-${side}`);
    spray.setAttribute("aria-hidden", "true");
    spray.append(el("popper-ring"));
    const ang0 = dir === 1 ? -78 : -102;
    for (let i = 0; i < n; i++) {
      const a = ((ang0 + (R() - 0.5) * 36) * Math.PI) / 180;
      const d = 230 * (0.45 + R() * 0.65);
      const x1 = Math.cos(a) * d;
      const y1 = Math.sin(a) * d;
      const x2 = x1 + (R() - 0.5) * 120 + dir * 24;
      const y2 = y1 + 320 + R() * 300;
      const r = (R() - 0.5) * 1260;
      const dur = 1300 + R() * 700;
      const delay = R() * 90;
      spray.append(
        piece(
          i,
          POPPER_INKS[i % POPPER_INKS.length],
          4,
          { x1, y1, x2, y2, r },
          { duration: dur, delay },
        ),
      );
    }
    out.push(spray);
  });
  return out;
}

/** How long 28a's poppers play (the slowest piece: 2 s and its 90 ms delay). */
export const POPPERS_MS = 2100;

/** 8a's colours on the paper map. */
const CANNON_INKS = ["#ff48b0", "#7fd4ff", "#ffe800", "#111111", "#ff48b0", "#7fd4ff", "#ffe800"];
/** 8a: the cannon leans 26° to the left, its burst aimed up and that way. */
const TILT = -26;

/** 8a's cannon, its mouth at the returned element's origin (the caller places it): it
 * swings in at `t.in` (520 ms), shakes three times from `t.shake`, its string is pulled
 * 140 ms before `t.bang`, then it recoils and bursts (two rings, 80 pieces, 1.5 to 2.3 s).
 * Times in ms from the start of the scene. Nothing under reduced motion: the caller does
 * not draw it then. */
export function cannon(t: { in: number; shake: number; bang: number }): HTMLElement {
  const mount = el("cannon", {
    animation: `cannon-in 520ms cubic-bezier(.3,1.3,.5,1) ${t.in}ms both, cannon-recoil 420ms ease-out ${t.bang}ms`,
  });
  mount.setAttribute("aria-hidden", "true");
  const tilted = el("cannon-tilt", { rotate: `${TILT}deg` });
  const wobble = el("cannon-wobble", { animation: `cannon-shake 140ms linear ${t.shake}ms 3` });
  const string = el("cannon-string", {
    animation: `cannon-yank 320ms cubic-bezier(.5,0,.3,1) ${t.bang - 140}ms both`,
  });
  string.append(el("cannon-cord"), el("cannon-pull"));
  const body = el("cannon-body");
  body.append(el("cannon-cone"), el("cannon-band"), el("cannon-rim"));
  wobble.append(string, body);
  // Confetti peeking out of the mouth until the bang.
  const peek: [string, number, number][] = [
    ["#7fd4ff", -14, -10],
    ["#ffe800", 2, -14],
    ["#111111", 14, -9],
    ["#ff48b0", -4, -6],
  ];
  peek.forEach(([c, x, y], i) => {
    wobble.append(
      el("i", {
        left: `${x - 4}px`,
        top: `${y - 4}px`,
        width: "8px",
        height: i % 2 ? "8px" : "12px",
        "border-radius": i % 2 ? "50%" : "1px",
        background: c,
        rotate: `${i * 37}deg`,
        animation: `cannon-peek 160ms ease-in ${t.bang}ms forwards`,
      }),
    );
  });
  const burst = el("cannon-burst", { rotate: `${-TILT}deg` });
  burst.append(
    el("cannon-ring big", { animation: `cannon-ring 520ms ease-out ${t.bang}ms both` }),
    el("cannon-ring small", { animation: `cannon-ring 420ms ease-out ${t.bang + 60}ms both` }),
  );
  const rnd = lehmer(7);
  const aim = -90 + TILT;
  for (let i = 0; i < 80; i++) {
    const a = ((aim + (rnd() - 0.5) * 70) * Math.PI) / 180;
    const d = 260 + rnd() * 420;
    const x1 = Math.cos(a) * d;
    const y1 = Math.sin(a) * d;
    const x2 = x1 + (rnd() - 0.5) * 140;
    const y2 = y1 + 420 + rnd() * 380;
    const r = (rnd() - 0.5) * 1400;
    const dur = 1500 + rnd() * 800;
    const delay = t.bang + rnd() * 80;
    const p = piece(
      i,
      CANNON_INKS[i % CANNON_INKS.length],
      5,
      { x1, y1, x2, y2, r },
      { duration: dur, delay },
    );
    p.style.opacity = "0";
    burst.append(p);
  }
  tilted.append(wobble, burst);
  mount.append(tilted);
  return mount;
}

/** How long after `bang` the cannon's last piece lands. */
export const BURST_MS = 2400;
