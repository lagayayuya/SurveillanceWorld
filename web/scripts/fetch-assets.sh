#!/usr/bin/env bash
# Self-host every runtime asset: basemap fonts and sprites (Protomaps basemaps-assets),
# and link the region's tiles into public/. Nothing is fetched from a third party at runtime.
set -euo pipefail
cd "$(dirname "$0")/.."
REGION="${1:-idf}"
ASSETS="https://protomaps.github.io/basemaps-assets"
PUB=public

mkdir -p "$PUB/basemap/fonts" "$PUB/basemap/sprites"
for font in "Noto Sans Regular" "Noto Sans Medium" "Noto Sans Italic"; do
  mkdir -p "$PUB/basemap/fonts/$font"
  enc="${font// /%20}"
  for start in $(seq 0 256 65280); do
    range="$start-$((start + 255))"
    out="$PUB/basemap/fonts/$font/$range.pbf"
    [ -s "$out" ] || echo "$ASSETS/fonts/$enc/$range.pbf|$out"
  done
done | xargs -P 16 -I{} sh -c 'u="${1%%|*}"; o="${1#*|}"; curl -sf -o "$o" "$u" || rm -f "$o"' _ {}

for f in grayscale.json grayscale.png grayscale@2x.json grayscale@2x.png; do
  curl -sf -o "$PUB/basemap/sprites/$f" "$ASSETS/sprites/v4/$f"
done

# The region's basemap extract; small regions (CI) have a versioned one in tests/fixtures.
BASEMAP="../../../data/basemap/$REGION.pmtiles"
FIXTURE="../tests/fixtures/$REGION-basemap.pmtiles"
if [ ! -e "../data/basemap/$REGION.pmtiles" ] && [ -e "$FIXTURE" ]; then
  BASEMAP="../../../tests/fixtures/$REGION-basemap.pmtiles"
fi
ln -sfn "$BASEMAP" "$PUB/basemap/basemap.pmtiles"
ln -sfn "../../data/build/$REGION/tiles" "$PUB/tiles"
# The register's files (lacarte registre construire), served under /data/registre/.
mkdir -p "$PUB/data"
ln -sfn "../../../data/registre/site" "$PUB/data/registre"
echo "assets ready for region $REGION"
