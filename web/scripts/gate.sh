#!/usr/bin/env bash
# The local gate (`make smoke`), before any push: CI's full matrix (workflow_dispatch) on
# the CI extract — the map on a desktop, the phone and participation in WebKit and
# Chromium, each on both interfaces, the punk map on every screen format (Chromium, WebKit
# and Firefox), the themes' test, the punk chips' and the punk
# account screen's, the leaderboard (with axe-core) in both engines — then the classique interface pixel for pixel against the
# code before the redesign (REF).
#   web/scripts/gate.sh [STEP...]   (a step runs when its name starts with one of the
#                                    arguments; none: every step)
# It builds in build/gate/ (ignored by git), never in web/dist nor web/public, which keep
# the developer's region:
#   current/web       the working tree's web files (tracked and new, not ignored), built;
#   ref-<REF>/web     `git archive REF web` (or the tarball GATE_REF_TAR), built once per
#                     commit;
#   shots/{ref,current}  the same captures of both (shots-theme --region ci, shots-add,
#                     shots-complete); the reference's are taken again when what they
#                     depend on changes (tiles, basemap, capture scripts, the API, the
#                     browsers, the day: sheets show dates);
#   logs/<step>.log   each step's output.
# Both builds serve the CI extract (data/build/ci/tiles, the versioned basemap), which must
# be built from the CI fixture as CI's `prepare` job does (checked: the build id).
# Exits 2 when something is missing, 1 when a step failed, 3 when the machine's lock is taken.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)" || exit 2
# Every rm -rf below is under $GATE: never let an empty or odd root reach it.
[ -n "$ROOT" ] && [ -f "$ROOT/Makefile" ] && [ -d "$ROOT/web" ] || { echo "gate: no repository root" >&2; exit 2; }
WEB="$ROOT/web"
GATE="${GATE_DIR:-$ROOT/build/gate}"
case "$GATE" in /*/build/gate* | /*/gate*) ;; *) echo "gate: odd GATE_DIR $GATE" >&2; exit 2 ;; esac
# Before the redesign; the current interface was proven pixel-identical to it (DECISIONS.md,
# 2026-10-05, themes by tokens).
REF="${GATE_REF:-b935b91}"
# The reference's web tree: a tarball of it kept outside the repository when given
# (GATE_REF_TAR, made by `git archive <ref> web | gzip`), else `git archive $REF web` when
# this clone holds REF; a clone without the old history has neither: the pixels step is then
# skipped and every other step still runs.
REF_TAR="${GATE_REF_TAR:-}"
CI_TILES="$ROOT/data/build/ci/tiles"
BASEMAP="$ROOT/tests/fixtures/ci-basemap.pmtiles" # as fetch-assets.sh: data/basemap first
[ -e "$ROOT/data/basemap/ci.pmtiles" ] && BASEMAP="$ROOT/data/basemap/ci.pmtiles"
LOGS="$GATE/logs"
REBUILD="mkdir -p data/contrib && cp tests/fixtures/contrib-ci.jsonl data/contrib/ci.jsonl && make build REGION=ci"
ONLY=("$@")

# One build, gate or deploy at a time on this machine (pipeline/lacarte/lock.py): taken, the
# gate stops at once and says by whom; released at its end, whatever the outcome.
LOCK_TOKEN="$(cd "$ROOT" && uv run --quiet python -m lacarte.lock acquire --pid $$ --what "make smoke $*")" ||
  exit
export LACARTE_LOCK_TOKEN="$LOCK_TOKEN"
trap '(cd "$ROOT" && uv run --quiet python -m lacarte.lock release --token "$LOCK_TOKEN")' EXIT

missing() {
  echo "gate: $*" >&2
  exit 2
}

# --- what the gate needs --------------------------------------------------------------------
if [ -n "$REF_TAR" ]; then
  [ -f "$REF_TAR" ] || missing "GATE_REF_TAR: no file $REF_TAR"
  REF_SRC=tar
elif (cd "$ROOT" && git cat-file -e "$REF^{commit}" 2>/dev/null); then
  REF_SRC=git
else
  REF_SRC=none
fi
[ -f "$CI_TILES/meta.json" ] || missing "no CI extract in data/build/ci; build it: $REBUILD"
cmp -s "$ROOT/tests/fixtures/contrib-ci.jsonl" "$ROOT/data/contrib/ci.jsonl" ||
  missing "data/contrib/ci.jsonl is not tests/fixtures/contrib-ci.jsonl (CI builds with it): $REBUILD"
built="$(cd "$ROOT" && uv run --quiet python -c 'import json, sys
print(json.load(open(sys.argv[1]))["build_id"])' "$CI_TILES/meta.json")"
expected="$(cd "$ROOT" && uv run --quiet python -c 'from lacarte import buildinfo, regions
print(buildinfo.build_id(regions.load("ci")))')"
[ "$built" = "$expected" ] ||
  missing "the CI extract is stale (tiles $built, the code and rules give $expected): $REBUILD"
for f in "fonts/Noto Sans Regular" sprites/grayscale.json; do
  [ -e "$WEB/public/basemap/$f" ] ||
    missing "no basemap fonts and sprites in web/public/basemap: web/scripts/fetch-assets.sh <region> once"
done
[ -d "$WEB/node_modules" ] || missing "no web/node_modules: npm --prefix web ci"

mkdir -p "$LOGS"

# --- builds -----------------------------------------------------------------------------------
# public/ of a gate build: its own files (the icons, copied with the rest of web/), and the
# basemap's fonts and sprites linked (the build copies them); the tiles go into dist after it
# (put_data), so that a reference built once follows the data.
link_public() {
  rm -rf "$1/public/basemap" "$1/public/tiles" && mkdir -p "$1/public/basemap"
  ln -s "$WEB/public/basemap/fonts" "$1/public/basemap/fonts"
  ln -s "$WEB/public/basemap/sprites" "$1/public/basemap/sprites"
  ln -sfn "$WEB/node_modules" "$1/node_modules"
}

# The CI extract's tiles and basemap, copied (small; vite preview and Caddy serve files).
put_data() {
  rm -rf "$1/tiles" "$1/basemap/basemap.pmtiles"
  cp -R "$CI_TILES/" "$1/tiles"
  cp "$BASEMAP" "$1/basemap/basemap.pmtiles"
}

build_current() {
  local w="$GATE/current/web"
  rm -rf "$GATE/current" && mkdir -p "$w"
  # What git sees in web/: tracked files that still exist, and new files it does not ignore.
  (cd "$ROOT" && git ls-files -co --exclude-standard -- web) |
    sed -n 's#^web/##p' | grep -v -e '^node_modules$' -e '^public/basemap/' -e '^public/tiles' |
    while IFS= read -r f; do [ -f "$WEB/$f" ] && printf '%s\n' "$f"; done |
    (cd "$WEB" && tar -cf - -T -) | (cd "$w" && tar -xf -) || return 1
  [ -f "$w/package.json" ] && [ -f "$w/index.html" ] || return 1
  link_public "$w"
  (cd "$w" && npm run --silent build -- --logLevel warn) || return 1
  put_data "$w/dist"
}

build_ref() {
  local d="$GATE/ref-$REF"
  # Built once per commit and per installed toolchain (the reference builds with today's
  # node_modules: a lockfile change rebuilds it).
  local key
  key="$(cat "$WEB/package-lock.json" ${REF_TAR:+"$REF_TAR"} | shasum | cut -c1-12)"
  if [ "$(cat "$d/.built" 2>/dev/null)" != "$key" ]; then
    rm -rf "$d" && mkdir -p "$d"
    if [ "$REF_SRC" = tar ]; then
      tar -xzf "$REF_TAR" -C "$d" || return 1
    else
      (cd "$ROOT" && git archive "$REF" web) | tar -x -C "$d" || return 1
    fi
    link_public "$d/web"
    (cd "$d/web" && npm run --silent build -- --logLevel warn) || return 1
    echo "$key" >"$d/.built"
  fi
  put_data "$d/web/dist"
}

# --- steps ------------------------------------------------------------------------------------
declare -a SUMMARY=()
failed=0

selected() {
  [ ${#ONLY[@]} -eq 0 ] && return 0
  local p
  for p in "${ONLY[@]}"; do [[ "$1" == "$p"* ]] && return 0; done
  return 1
}

# step NAME DIR COMMAND...: run COMMAND in DIR against the current build, log it, count its
# "ok" and "FAIL" lines.
step() {
  local name="$1" dir="$2"
  shift 2
  selected "$name" || return 0
  local log="$LOGS/$name.log" t0=$SECONDS code
  echo "== $name: $*"
  (cd "$dir" && LACARTE_DIST="$GATE/current/web/dist" "$@") >"$log" 2>&1
  code=$?
  local ok fail
  ok=$(grep -c '^ok' "$log")
  fail=$(grep -c '^FAIL' "$log")
  grep '^FAIL' "$log" | sed 's/^/   /' | cut -c1-240
  [ "$code" -ne 0 ] && [ "$fail" -eq 0 ] && tail -5 "$log" | sed 's/^/   /'
  SUMMARY+=("$(printf '%-34s exit %-3s ok %-4s FAIL %-3s %4ss' "$name" "$code" "$ok" "$fail" $((SECONDS - t0)))")
  [ "$code" -eq 0 ] || failed=1
}

ref_key() {
  {
    echo "$REF"
    [ -n "$REF_TAR" ] && shasum -a 256 <"$REF_TAR"
    date +%F
    (cd "$WEB" && node -p 'require("playwright/package.json").version')
    cat "$CI_TILES"/* "$BASEMAP" "$WEB"/public/basemap/sprites/* | shasum -a 256
    cat "$WEB"/bench/{shots-theme,shots-add,shots-complete,dist,ui}.mjs | shasum -a 256
    (cd "$ROOT" && git ls-files -co --exclude-standard -z -- pipeline/lacarte/api db rules \
      tests/apiserver.py tests/pgcluster.py | xargs -0 cat) | shasum -a 256
  } | shasum -a 256 | cut -d' ' -f1
}

# capture DIST OUT: the classique interface's captures of a build, asked for (punk is the
# current build's default; the reference, older than the choice, ignores the asking).
# /revue is out of the comparison since its redesign (lot 1 « Modérer », 2026-10-16): one
# new layout for both interfaces replaces the classique page frozen at REF, so the two can
# no longer match (shots-theme.mjs no longer captures it; its states are in the state
# catalogue, its journeys in smoke-participate and shots-revue-operator).
capture() {
  rm -rf "$2" && mkdir -p "$2"
  (cd "$WEB" && export LACARTE_DIST="$1" &&
    node bench/shots-theme.mjs --region ci --ui classique --out "$2/theme" &&
    node bench/shots-add.mjs --browser webkit --ui classique --out "$2/add" &&
    node bench/shots-complete.mjs --browser webkit --ui classique --out "$2/complete")
}

pixels() {
  local shots="$GATE/shots" key
  key="$(ref_key)"
  if [ "$(cat "$shots/ref/.key" 2>/dev/null)" != "$key" ]; then
    echo "reference captures ($REF) taken again"
    capture "$GATE/ref-$REF/web/dist" "$shots/ref" || return 1
    echo "$key" >"$shots/ref/.key"
  else
    echo "reference captures ($REF) unchanged, kept"
  fi
  capture "$GATE/current/web/dist" "$shots/current" || return 1
  local part code=0
  rm -rf "$shots/diff"
  # Differences decided since the reference: a pending add's line is dated by its month
  # (DECISIONS 2026-10-13, « The public API dates a pending proposal by its month… »).
  # One line of text each: a difference taller than 80 px (at scale 2) still counts.
  local accept_add="4a-pending-other.png@80,4b-pending-author.png@80"
  # The exact street filters from z15, no longer z14 (DECISIONS 2026-10-17, « The streets'
  # z14 is drawn from the merged filmed intervals… »): the `portions` layer's zoom step; its
  # pixels unchanged without a filter (every capture still compared).
  local accept_style="style-desktop.json@portions,style-phone.json@portions"
  for part in theme add complete; do
    local accept="" accept_json=""
    [ "$part" = add ] && accept="$accept_add"
    [ "$part" = theme ] && accept_json="$accept_style"
    (cd "$WEB" && node bench/pixeldiff.mjs "$shots/ref/$part" "$shots/current/$part" \
      --diff "$shots/diff/$part" ${accept:+--accept "$accept"} \
      ${accept_json:+--accept-json "$accept_json"}) | sed "s#^#[$part] #" || code=1
  done
  return $code
}

echo "== build: current web and reference $REF ($REF_SRC; CI extract $built)"
build_current >"$LOGS/build.log" 2>&1 || { tail -20 "$LOGS/build.log"; missing "the current build failed"; }
if [ "$REF_SRC" != none ]; then
  build_ref >>"$LOGS/build.log" 2>&1 || { tail -20 "$LOGS/build.log"; missing "the reference build failed"; }
fi

B="$WEB"
for ui in classique punk; do
  step "map-desktop-$ui" "$B" node bench/smoke.mjs --region ci --ui "$ui"
done
for engine in webkit chromium; do
  for ui in classique punk; do
    step "phone-$engine-$ui" "$B" node bench/smoke-mobile.mjs --region ci --browser "$engine" --ui "$ui"
  done
done
# Lot M (2026-10-17): the punk map's floating controls apart, inside the screen and the
# floating buttons at the bottom, from 320 to 1920 px wide, phones upright and sideways,
# light and dark, in the three engines (Firefox: an Android phone's other browser family).
for engine in chromium webkit firefox; do
  step "formats-$engine" "$B" node bench/smoke-formats.mjs --region ci --browser "$engine"
done
for engine in webkit chromium; do
  for ui in classique punk; do
    step "participate-$engine-$ui" "$B" node bench/smoke-participate.mjs --browser "$engine" --ui "$ui"
  done
done
# smoke-theme.mjs serves the build of its working directory (`vite preview`, no
# LACARTE_DIST): it runs from the current build's own web folder.
for engine in webkit chromium; do
  step "theme-$engine" "$GATE/current/web" node "$WEB/bench/smoke-theme.mjs" --region ci --browser "$engine"
done
# The punk chips (source tag, certainty, accessible name) with axe-core, the dev dependency.
for engine in webkit chromium; do
  step "chips-$engine" "$B" node bench/smoke-chips.mjs --browser "$engine"
done
# The punk account screen, the leaderboard (board 26a), the account routes mocked, axe-core.
for engine in webkit chromium; do
  step "profile-$engine" "$B" node bench/smoke-profile.mjs --browser "$engine"
done
# Lot of 2026-10-11: the welcome panel (28a), the points at send (8a) with their category
# colours, and the phone keyboard and gestures (WebKit only: an iPhone's).
for engine in webkit chromium; do
  step "welcome-$engine" "$B" node bench/smoke-welcome.mjs --browser "$engine"
  step "score-$engine" "$B" node bench/smoke-score.mjs --browser "$engine"
done
step "keyboard-webkit" "$B" node bench/smoke-keyboard.mjs
# Lot of 2026-10-12: the punk editor (field under the streets, the aim in pixels, the
# height in metres, who films with its search; WebKit phone and Chromium wide inside), and
# /revue's choice for a proposed operator name.
step "editor" "$B" node bench/smoke-editor.mjs
# « Chargement » (board 2c) over punk's first load, and the return from OpenStreetMap.
for engine in webkit chromium; do
  step "loading-$engine" "$B" node bench/smoke-loading.mjs --browser "$engine"
done
step "revue-operator" "$B" node bench/shots-revue-operator.mjs
# The launch: the legal pages, the closed contributions, publishing as /api/config says, the
# data download (mocked API), and the account's deletion against the real API.
for engine in webkit chromium; do
  step "launch-$engine" "$B" node bench/smoke-launch.mjs --browser "$engine"
  step "delete-$engine" "$B" node bench/smoke-delete.mjs --browser "$engine"
  step "export-$engine" "$B" node bench/smoke-export.mjs --browser "$engine"
done
# The tiles prefetched while the map rests (src/prefetch.ts, off in the other benches: a
# browser driven by tests), on a throttled 4G phone in Chromium.
step "prefetch" "$B" node bench/latency.mjs --profile phone4g --check
if selected pixels && [ "$REF_SRC" = none ]; then
  echo "== pixels: skipped, no reference (set GATE_REF_TAR)"
  SUMMARY+=("pixels: skipped, no reference (set GATE_REF_TAR)")
elif selected pixels; then
  echo "== pixels: classique against $REF"
  t0=$SECONDS
  pixels >"$LOGS/pixels.log" 2>&1
  code=$?
  grep -E '^\[|DIFF|ACCEPTED|differing|taken again|kept|FAIL|Error' "$LOGS/pixels.log" | grep -v ' same ' | sed 's/^/   /'
  SUMMARY+=("$(printf '%-34s exit %-3s %s %4ss' pixels "$code" \
    "$(grep -o '[0-9]* differing of [0-9]*' "$LOGS/pixels.log" | paste -sd, -)" $((SECONDS - t0)))")
  [ "$code" -eq 0 ] || failed=1
fi

echo
echo "== summary (logs in $LOGS)"
[ ${#SUMMARY[@]} -gt 0 ] && printf '%s\n' "${SUMMARY[@]}" # bash 3.2 (macOS): no empty "${a[@]}"
[ "$failed" -eq 0 ] && echo "gate: green" || echo "gate: FAILED"
exit "$failed"
