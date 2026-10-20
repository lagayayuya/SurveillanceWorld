// Compare two folders of captures pixel by pixel (same file names): prints, for each PNG,
// the number of differing pixels and their bounding box, and whether the JSON files are
// identical; a PNG or JSON file in one folder only is a difference. Exits non-zero if
// anything differs.
//   node bench/pixeldiff.mjs DIR_A DIR_B [--diff OUT] [--accept a.png@H,b.png@H]
//        [--accept-json a.json@layer+layer,b.json@layer]
// OUT: images of the differences. --accept: captures whose pixels may differ on purpose (a
// decision changed one line of what they show): reported « ACCEPTED », not counted, while
// the differences fit in a band H pixels high (their bounding box); their size must still
// match, and a taller difference counts. --accept-json: style captures whose named layers
// may differ on purpose (a decision changed them): « ACCEPTED » when the rest is identical.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const [a, b] = process.argv.slice(2);
const diffOut = process.argv.includes("--diff")
  ? process.argv[process.argv.indexOf("--diff") + 1]
  : null;
if (diffOut) mkdirSync(diffOut, { recursive: true });
const accepted = new Map(
  (process.argv.includes("--accept")
    ? process.argv[process.argv.indexOf("--accept") + 1].split(",").filter(Boolean)
    : []
  ).map((spec) => {
    const [name, h] = spec.split("@");
    return [name, Number(h) || 0];
  }),
);
const acceptedJson = new Map(
  (process.argv.includes("--accept-json")
    ? process.argv[process.argv.indexOf("--accept-json") + 1].split(",").filter(Boolean)
    : []
  ).map((spec) => {
    const [name, layers] = spec.split("@");
    return [name, new Set((layers ?? "").split("+").filter(Boolean))];
  }),
);
/** A style capture without the given layers (their ids kept, so a missing one counts). */
const withoutLayers = (buf, ids) => {
  const style = JSON.parse(buf.toString());
  for (const l of style.layers ?? [])
    if (ids.has(l.id)) for (const k of Object.keys(l)) if (k !== "id") delete l[k];
  return JSON.stringify(style);
};
const kept = (dir) => readdirSync(dir).filter((f) => /\.(png|json)$/.test(f));
const names = [...new Set([...kept(a), ...kept(b)])].sort();
const browser = await chromium.launch();
const page = await browser.newPage();
let differing = 0;
for (const name of names) {
  // A capture on one side only (a state that failed there) is a difference too.
  const only = [a, b].filter((d) => !existsSync(join(d, name)));
  if (only.length) {
    differing++;
    console.log(`DIFF ${name}: missing in ${only.join(", ")}`);
    continue;
  }
  const fa = readFileSync(join(a, name));
  const fb = readFileSync(join(b, name));
  if (name.endsWith(".json")) {
    const same = fa.equals(fb);
    const ids = acceptedJson.get(name);
    if (!same && ids && withoutLayers(fa, ids) === withoutLayers(fb, ids)) {
      console.log(`ACCEPTED ${name}: only ${[...ids].join(", ")} differ`);
      continue;
    }
    if (!same) differing++;
    console.log(`${same ? "same" : "DIFF"} ${name}`);
    continue;
  }
  if (!name.endsWith(".png")) continue;
  if (fa.equals(fb)) {
    console.log(`same ${name}`);
    continue;
  }
  const r = await page.evaluate(
    async ([pa, pb, wantImage]) => {
      const load = async (s) =>
        createImageBitmap(await (await fetch(`data:image/png;base64,${s}`)).blob());
      const [ia, ib] = [await load(pa), await load(pb)];
      if (ia.width !== ib.width || ia.height !== ib.height)
        return { size: `${ia.width}x${ia.height} / ${ib.width}x${ib.height}` };
      const read = (bm) => {
        const c = new OffscreenCanvas(bm.width, bm.height);
        const x = c.getContext("2d");
        x.drawImage(bm, 0, 0);
        return x.getImageData(0, 0, bm.width, bm.height);
      };
      const [da, db] = [read(ia), read(ib)];
      const out = new ImageData(ia.width, ia.height);
      let n = 0;
      let box = [Infinity, Infinity, -1, -1];
      for (let i = 0; i < da.data.length; i += 4) {
        const same =
          da.data[i] === db.data[i] &&
          da.data[i + 1] === db.data[i + 1] &&
          da.data[i + 2] === db.data[i + 2] &&
          da.data[i + 3] === db.data[i + 3];
        const p = i / 4;
        const x = p % ia.width;
        const y = Math.floor(p / ia.width);
        if (!same) {
          n++;
          box = [
            Math.min(box[0], x),
            Math.min(box[1], y),
            Math.max(box[2], x),
            Math.max(box[3], y),
          ];
          out.data.set([255, 0, 0, 255], i);
        } else out.data.set([da.data[i], da.data[i + 1], da.data[i + 2], 60], i);
      }
      let image = null;
      if (wantImage && n) {
        const c = new OffscreenCanvas(ia.width, ia.height);
        c.getContext("2d").putImageData(out, 0, 0);
        const blob = await c.convertToBlob();
        image = btoa(
          new Uint8Array(await blob.arrayBuffer()).reduce((s, v) => s + String.fromCharCode(v), ""),
        );
      }
      return { n, total: da.data.length / 4, box, image };
    },
    [fa.toString("base64"), fb.toString("base64"), Boolean(diffOut)],
  );
  if (r.size) {
    differing++;
    console.log(`DIFF ${name}: size ${r.size}`);
  } else if (r.n && accepted.has(name) && r.box[3] - r.box[1] < accepted.get(name)) {
    console.log(`ACCEPTED ${name}: ${r.n} of ${r.total} pixels, box ${r.box.join(",")}`);
    if (r.image) writeFileSync(join(diffOut, name), Buffer.from(r.image, "base64"));
  } else if (r.n) {
    differing++;
    console.log(`DIFF ${name}: ${r.n} of ${r.total} pixels, box ${r.box.join(",")}`);
    if (r.image) writeFileSync(join(diffOut, name), Buffer.from(r.image, "base64"));
  } else console.log(`same ${name} (pixels; files differ)`);
}
await browser.close();
console.log(`${differing} differing of ${names.length}`);
process.exit(differing ? 1 : 0);
