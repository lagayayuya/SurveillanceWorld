// The shapes of the "À quoi ressemble-t-elle ?" screen, drawn for this project as full
// silhouettes in one colour (currentColor): from the pavement, against the sky, a passer-by
// sees an outline, not the lenses inside. So no inner detail tells them apart, only the
// outline: a low, wide half-dome flush under its plate; a tube on a wall arm, its visor
// overhanging; a big full ball hanging from a pipe. "Plusieurs objectifs" (multi) is no
// longer offered (phase "Retours terrain"): from below its lenses are invisible and its
// outline is a small dome's; IDF has 18 panoramas of 18,383 cameras. The answers map to
// camera kinds in rules/questions.yaml, not here; the API still accepts `multi`.

export const SHAPES = ["dome", "bullet", "ptz", "multi"] as const;
export type Shape = (typeof SHAPES)[number];
/** The shapes offered, in this order. */
export const OFFERED: readonly Shape[] = ["dome", "bullet", "ptz"];

const DRAWINGS: Record<Shape, string> = {
  // Wide and low, flush under its plate: a flat pebble.
  dome: `<rect x="6" y="14" width="52" height="6" rx="2"/>
    <path d="M12 20 h40 a20 13 0 0 1 -40 0 z"/>`,
  // Long and horizontal on a wall arm, its visor overhanging the front.
  bullet: `<rect x="3" y="14" width="6" height="32" rx="1.5"/>
    <path d="M9 34 l13 -7 v7 l-13 7 z"/>
    <rect x="20" y="24" width="38" height="14" rx="4"/>
    <rect x="17" y="19" width="45" height="6" rx="2"/>`,
  // A long pipe, then a big full ball: it turns and zooms by motor.
  ptz: `<rect x="21" y="3" width="22" height="5" rx="1.5"/>
    <rect x="29" y="8" width="6" height="15"/>
    <rect x="20" y="21" width="24" height="6" rx="2"/>
    <circle cx="32" cy="43" r="17"/>`,
  // Not offered any more; kept for answers already stored.
  multi: `<rect x="6" y="14" width="52" height="6" rx="2"/>
    <path d="M6 20 h52 a26 14 0 0 1 -52 0 z"/>`,
};

/** The drawing as an inline SVG element (decorative: the button carries the label). */
export function shapeSvg(shape: Shape): SVGSVGElement {
  return svg(DRAWINGS[shape]);
}

// Phase D3, "Hauteur et inclinaison": the same one-colour silhouettes. Height: the camera
// (a small tube, solid) on a facade drawn pale storey by storey, or on a pole, with a
// passer-by for scale (about 9 units for 1.75 m, the ground at y = 59); the answers' values
// are in rules/questions.yaml, the drawings only place the camera on the right storey.
export const HEIGHTS = ["ground", "first", "upper", "pole"] as const;
export type Height = (typeof HEIGHTS)[number];
const GROUND = `<rect x="0" y="59" width="64" height="3"/>`;
const PERSON = `<circle cx="53" cy="47" r="2.6"/><rect x="50.5" y="50.5" width="5" height="8.5" rx="2"/>`;
/** Storeys of a pale facade, from the ground up (14 units each, 1-unit gaps). */
const storeys = (n: number) =>
  Array.from({ length: n }, (_, i) => {
    const y = 45 - 15 * i;
    return `<rect x="4" y="${y}" width="24" height="14" fill-opacity="0.28"/>`;
  }).join("");
/** The camera on the facade's edge at height y: an arm and a tube looking out. */
const wallCam = (y: number) =>
  `<rect x="28" y="${y}" width="3" height="3"/><rect x="30" y="${y - 2}" width="12" height="6" rx="1.5"/>`;
const HEIGHT_DRAWINGS: Record<Height, string> = {
  ground: `${storeys(2)}${wallCam(48)}${PERSON}${GROUND}`,
  first: `${storeys(3)}${wallCam(33)}${PERSON}${GROUND}`,
  upper: `${storeys(4)}${wallCam(18)}${PERSON}${GROUND}`,
  // A street lamp: its pole, its head, the camera halfway up looking out.
  pole: `<rect x="17" y="8" width="3.5" height="51"/><path d="M18 8 q2 -4 12 -3 v3 h-8 z"/>
    <rect x="26" y="7" width="9" height="3" rx="1"/>
    <rect x="20" y="31" width="3" height="3"/><rect x="22" y="29" width="12" height="6" rx="1.5"/>
    ${PERSON}${GROUND}`,
};

// Tilt: in profile, a tube on a wall arm turned down by the class's angle (10, 25 and 45
// degrees, as rules/questions.yaml), with the pale wedge it looks along.
export const TILTS = ["horizon", "slight", "steep"] as const;
export type Tilt = (typeof TILTS)[number];
const tilted = (deg: number) =>
  `<rect x="2" y="4" width="6" height="56"/><rect x="0" y="59" width="64" height="3"/>
  <g transform="rotate(${deg} 10 20)">
    <path d="M44 20.5 L104 9 L104 32 Z" fill-opacity="0.22"/>
    <rect x="8" y="18" width="7" height="4"/>
    <rect x="14" y="15" width="30" height="11" rx="3"/>
    <rect x="12" y="11.5" width="34" height="4.5" rx="1.5"/>
  </g>`;
const TILT_DRAWINGS: Record<Tilt, string> = {
  horizon: tilted(10),
  slight: tilted(25),
  steep: tilted(45),
};

export function heightSvg(height: Height): SVGSVGElement {
  return svg(HEIGHT_DRAWINGS[height]);
}

export function tiltSvg(tilt: Tilt): SVGSVGElement {
  return svg(TILT_DRAWINGS[tilt]);
}

/** Every drawing by screen, as SVG markup (bench/shots-silhouettes.mjs draws the sheet). */
export const SILHOUETTES = {
  shape: DRAWINGS,
  height: HEIGHT_DRAWINGS,
  tilt: TILT_DRAWINGS,
} as const;

export function svgMarkup(body: string, size = 64): string {
  return `<svg viewBox="0 0 64 64" width="${size}" height="${size}" fill="currentColor" overflow="hidden" aria-hidden="true" focusable="false">${body}</svg>`;
}

function svg(body: string): SVGSVGElement {
  const wrap = document.createElement("div");
  wrap.innerHTML = svgMarkup(body);
  return wrap.firstElementChild as SVGSVGElement;
}
