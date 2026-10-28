#!/usr/bin/env bash
# The punk theme's fonts, self-hosted (nothing is fetched from a third party at runtime):
# the upstream files at pinned commits, cut to what the theme uses and to the Latin set,
# as woff2, into web/src/theme/fonts/ (versioned with their licences, see README.md there).
#   web/scripts/fonts.sh        (needs uv; downloads ~2 MB into a temporary folder)
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=src/theme/fonts
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
FONTTOOLS="fonttools[woff]==4.66.1"
ft() { uvx --quiet --from "$FONTTOOLS" "$@"; }

# Upstream: Archivo (OFL 1.1, Omnibus-Type), Special Elite (Apache 2.0, Astigmatic, as
# distributed by google/fonts).
ARCHIVO=https://raw.githubusercontent.com/Omnibus-Type/Archivo/b5d63988ce19d044d3e10362de730af00526b672
ELITE=https://raw.githubusercontent.com/google/fonts/0c42307921ce94c085ce191020cde436f8396ec3/apache/specialelite
curl -sfL -o "$TMP/archivo.ttf" "$ARCHIVO/fonts/variable/Archivo%5Bwdth,wght%5D.ttf"
curl -sfL -o "$OUT/OFL-Archivo.txt" "$ARCHIVO/OFL.txt"
curl -sfL -o "$TMP/elite.ttf" "$ELITE/SpecialElite-Regular.ttf"
curl -sfL -o "$OUT/LICENSE-SpecialElite.txt" \
  https://raw.githubusercontent.com/google/fonts/90abd17b4f97671435798b6147b698aa9087612f/apache/specialelite/LICENSE.txt

# Latin, French punctuation (« » ’ …), the narrow no-break space and the euro sign.
LATIN="U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+2074,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD"

# Archivo: the theme's display text uses weights 800-900 at widths 62-100 % only.
ft fonttools varLib.instancer "$TMP/archivo.ttf" wght=800:900 wdth=62:100 -o "$TMP/archivo-cut.ttf" -q
ft pyftsubset "$TMP/archivo-cut.ttf" --unicodes="$LATIN" --flavor=woff2 \
  --name-IDs='*' --name-languages='*' --output-file="$OUT/archivo-800-900-62-100.woff2"
# Archivo for the register's text (registre.html): every weight from 400 to 900 and the widths its
# kit uses (62-100 %), Latin and Latin Extended (the names of places and companies), one variable
# file; the upstream file's SHA-256 is printed (README.md there records it).
LATIN_EXT="$LATIN,U+0100-024F,U+0259,U+1E00-1EFF,U+20A0-20C0,U+2C60-2C7F,U+A720-A7FF"
ft fonttools varLib.instancer "$TMP/archivo.ttf" wght=400:900 wdth=62:100 -o "$TMP/archivo-text.ttf" -q
ft pyftsubset "$TMP/archivo-text.ttf" --unicodes="$LATIN_EXT" --flavor=woff2 \
  --name-IDs='*' --name-languages='*' --output-file="$OUT/archivo-400-900-62-100.woff2"
shasum -a 256 "$TMP/archivo.ttf"
ft pyftsubset "$TMP/elite.ttf" --unicodes="$LATIN" --flavor=woff2 \
  --name-IDs='*' --name-languages='*' --output-file="$OUT/special-elite.woff2"
ls -l "$OUT"/*.woff2
