#!/usr/bin/env bash
# Build the site (CNIL signal on) and publish it on the VPS, as the private preview or the
# public site (SITE_MODE, deploy/site.py):
#   1. the participation API as a timestamped release (code, rules, migrations, its own
#      venv built by uv under DEPLOY_PATH/api), a dump of the contributions, the
#      migrations, the build's tables loaded
#      (prepared here, sent compressed, swapped in one transaction there), the statuses
#      of the contributions the build applied (db/settle.sh), the test accounts' flags
#      (TEST_AUTHORS, db/test_authors.sh), the API's OpenStreetMap settings
#      (deploy/osm_env.sh: <DEPLOY_PATH>/api/osm.env, 600) and its site settings
#      (deploy/site_env.sh: <DEPLOY_PATH>/api/site.env, 600: the identity shown if given;
#      contributions and sign-ups open or not are the database's, set in /revue), the
#      journal's lines older than 12 months deleted and the counters' days older than 13
#      months folded into monthly totals (db/retention.sql), the API restarted
#      and asked for its health on 127.0.0.1 (a route that answers without a session);
#   2. the web release (built with CONTACT_EMAIL, the address « Me contacter » writes
#      to; the files the release in service holds unchanged linked, not sent), swapped in
#      atomically;
#   3. the Caddy site file, Caddy reloaded;
#   4. what answers without the password (preview: nothing but a generic 401, /api
#      included; public: the site open with its headers, /revue behind its password,
#      www.<host> redirected for good to the host, both names on SITE_IP alone, no AAAA
#      record), and the build id of the served tiles against the database's.
# The one-time root setup is deploy/bootstrap.sh, run by the author. Nothing about the
# server is stored here. Back to the release before, tables included: deploy/rollback.sh.
#   deploy/deploy.sh [--dry-run]     (environment: deploy/deploy.env.example)
set -euo pipefail
cd "$(dirname "$0")/.."
: "${DEPLOY_TARGET:?set DEPLOY_TARGET=user@host (ssh destination of the VPS)}"
: "${PREVIEW_HOST:?set PREVIEW_HOST (random subdomain)}"
# Defined, even empty (deploy.env.example): unset, the test accounts' table would be
# emptied and their contributions exported again; STAGE guards db/reset_contributions.sh.
: "${TEST_AUTHORS?set TEST_AUTHORS (the test accounts, comma-separated; empty for none)}"
: "${STAGE?set STAGE (preview for the private preview, public for the public site)}"
# « Me contacter » (asking for an account, a forgotten password): built into the page.
: "${CONTACT_EMAIL:?set CONTACT_EMAIL (the address « Me contacter » writes to)}"
# Sign in with and publish to OpenStreetMap: the live and dev clients, the write tokens' key,
# and where people publish (OSM_WRITE_SERVER, dev only: the live server is /revue's switch).
# Never printed.
deploy/osm_env.sh check
# The identity shown if given (default: none). Never printed.
deploy/site_env.sh check
# The site's mode, and in public mode the address it is served on (bootstrap.sh --bind-ip),
# which the check compares with the host's A record.
export SITE_MODE="${SITE_MODE:-preview}"
if [ "$SITE_MODE" = public ]; then
  : "${SITE_IP:?set SITE_IP (the IPv4 the site is served on, bootstrap.sh --bind-ip)}"
  ipv4='^[0-9]{1,3}(\.[0-9]{1,3}){3}$'
  [[ "$SITE_IP" =~ $ipv4 ]] || { echo "refused: SITE_IP is an IPv4 address" >&2; exit 1; }
elif [ "$SITE_MODE" != preview ]; then
  echo "refused: SITE_MODE is preview or public" >&2
  exit 1
fi
DEPLOY_PATH="${DEPLOY_PATH:-/srv/preview}"
CADDY_SITE="${CADDY_SITE:-/etc/caddy/sites.d/preview.caddy}"
API_PORT="${API_PORT:-8791}"
DB_DSN="${DB_DSN:-dbname=preview}"
REGION="${REGION:-france}"
KEEP="${KEEP:-3}"
DRY=""
[ "${1:-}" = "--dry-run" ] && DRY="--dry-run"
# One build, gate or deploy at a time on this machine (pipeline/lacarte/lock.py): taken, the
# deploy stops before anything is built or sent and says by whom; released at its end,
# whatever the outcome.
LOCK_TOKEN="$(uv run --quiet python -m lacarte.lock acquire --pid $$ --what "deploy/deploy.sh $*")" ||
  exit
export LACARTE_LOCK_TOKEN="$LOCK_TOKEN"
trap 'uv run --quiet python -m lacarte.lock release --token "$LOCK_TOKEN"' EXIT
# The OSM clients known to OSM (their secret refused would make every sign-in fail).
[ -n "$DRY" ] || deploy/osm_env.sh probe
API="$DEPLOY_PATH/api"

# The site file first: fails early on a missing variable (the gate's users, port; in public
# mode, REVIEW_ACCOUNTS).
SITE="$(PREVIEW_ROOT="$DEPLOY_PATH/current" API_PORT="$API_PORT" uv run python deploy/site.py render)"

# The region's tiles and basemap must exist (make build REGION=... and the basemap extract), and
# the register's files and its search's rows (lacarte-registre construire).
for f in "data/build/$REGION/tiles/meta.json" "data/basemap/$REGION.pmtiles" \
  "data/registre/site/index.json" "data/registre/recherche.tsv.gz"; do
  [ -e "$f" ] || { echo "missing $f" >&2; exit 1; }
done
# The register built by `lacarte-registre construire` with the corrections /revue accepted,
# exported from the database at that build (not --sans-corrections), and not changed since.
uv run lacarte-registre verifier
# The basemap made by the current code (its own id, outside the build's: basemap.py), or stop:
# strip it again (README).
uv run lacarte basemap check "data/basemap/$REGION.pmtiles"
BUILD_ID="$(uv run python -c 'import json, sys; print(json.load(open(sys.argv[1]))["build_id"])' \
  "data/build/$REGION/tiles/meta.json")"

# The build's tables, prepared here (every building of the region, as the views stage
# prepares them): same build as the tiles, or stop.
EXPORT="data/build/$REGION/db"
uv run lacarte db load --region "$REGION" --to-dir "$EXPORT"
grep -q "\"build_id\": \"$BUILD_ID\"" "$EXPORT/export.json" ||
  { echo "the tables' build differs from the tiles' ($BUILD_ID): rebuild" >&2; exit 1; }
# What the build did with the validated contributions (the `apply` stage), written into the
# database after the load (db/settle.sh); none when the build applied no contribution.
rm -f "$EXPORT/contrib_outcome.json"
if [ -f "data/build/$REGION/contrib_outcome.json" ]; then
  grep -q "\"build_id\": \"$BUILD_ID\"" "data/build/$REGION/contrib_outcome.json" ||
    { echo "the contribution outcome's build differs from the tiles' ($BUILD_ID)" >&2; exit 1; }
  cp "data/build/$REGION/contrib_outcome.json" "$EXPORT/"
fi
# The register's search rows (migration 027), loaded with the build's tables
# (db/load_registre.sh): the same construire as the files verifier checked above.
cp data/registre/recherche.tsv.gz "$EXPORT/registre-recherche.tsv.gz"
# The hidden cameras this build left out (its extract's list): settle marks them gone from
# the map with this build (migration 020, /revue's « Retraits »).
rm -f "$EXPORT/hidden-applied.txt"
if [ -f "data/build/$REGION/hidden-applied.txt" ]; then
  cp "data/build/$REGION/hidden-applied.txt" "$EXPORT/"
fi
# No test account's contribution in what the build read or applied (TEST_AUTHORS: their
# contributions never leave the database; the file has no author, the database is asked).
uv run lacarte contrib check-test --region "$REGION"
# The build read the database's current validated contributions and hidden cameras: an
# older export would drop from the map a contribution applied since (refused; export,
# then build).
uv run lacarte contrib check-fresh --region "$REGION"
TEST_LIST="$(uv run python -c 'from lacarte import contrib; print(",".join(contrib.test_authors()))')"

web/scripts/fetch-assets.sh "$REGION"
# The share tags' absolute addresses (og:url, og:image) from the host (vite.config.ts).
VITE_CNIL_SIGNAL=true VITE_CONTACT_EMAIL="$CONTACT_EMAIL" VITE_SITE_URL="https://$PREVIEW_HOST" \
  npm --prefix web run build
# The register's records' entry pages (their share tags and a page readable without
# JavaScript, lot R3), put into the map's page as built, which the register opens over:
# served at /registre/<ref>.
uv run lacarte-registre pages web/dist/index.html web/dist --site "https://$PREVIEW_HOST"
# Vite copies public/ with the build's time: each copy gets its source's back, or rsync's
# quick check (size and time) never finds the basemap unchanged and sends it again whole.
(cd web/public && find -L . -type f) | while IFS= read -r f; do
  touch -r "web/public/$f" "web/dist/$f"
done

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RELEASE="$DEPLOY_PATH/releases/$STAMP"
API_RELEASE="$API/releases/$STAMP"
# -L: web/public links the tiles and the basemap; send the files, not the links. A file the
# release in service holds unchanged (same size and time: the basemap, 4.5 GB for France) is
# hard-linked there, not sent again (--link-dest, rsync(1)).
rsync -azL --delete $DRY --exclude '.DS_Store' --link-dest="$DEPLOY_PATH/current/" \
  web/dist/ "$DEPLOY_TARGET:$RELEASE/"
# The API's code and what it reads: the package, the rules, the migrations and loader.
rsync -az --delete $DRY --exclude '__pycache__' --exclude '.DS_Store' \
  pipeline rules db pyproject.toml uv.lock .python-version "$DEPLOY_TARGET:$API_RELEASE/"
# The buildings (every prepared building of the region, a few hundred MB) are sent only
# when the server's differ (their digest, meta.tsv's last column; db/load.sh keeps the
# table when it matches). Before migration 007 the column is missing: they are sent.
WANT="$(cut -f6 "$EXPORT/meta.tsv")"
HAVE="$(ssh "$DEPLOY_TARGET" "psql -XAt '$DB_DSN' -c 'SELECT buildings_sha256 FROM meta' 2>/dev/null" || true)"
SKIP=()
if [ -n "$WANT" ] && [ "$WANT" = "$HAVE" ]; then
  SKIP=(--exclude buildings.tsv.gz)
  echo "buildings unchanged on the server (${WANT:0:8}): not sent"
fi
rsync -az --delete $DRY ${SKIP[@]+"${SKIP[@]}"} "$EXPORT/" "$DEPLOY_TARGET:$API/exports/$STAMP/"
if [ -n "$DRY" ]; then
  echo "dry run: nothing changed on the server (build $BUILD_ID)"
  exit 0
fi

# 1. API: its OpenStreetMap and site settings first (read by the unit at the restart
# below); its venv (uv in the deploy user's home, Python under $API/python, never the
# system's), readable by the service user; migrations; the tables; the release swapped in; a restart
# and a health check on 127.0.0.1 (the only place it listens).
deploy/osm_env.sh write "$API/osm.env"
deploy/site_env.sh write "$API/site.env"
ssh "$DEPLOY_TARGET" "set -e
  cd '$API_RELEASE'
  UV_PYTHON_INSTALL_DIR='$API/python' UV_PROJECT_ENVIRONMENT=.venv \
    \"\$HOME/.local/bin/uv\" sync --frozen --only-group api --no-install-project --quiet
  chmod -R a+rX '$API_RELEASE' '$API/python'
  # The contributions first: a migration may change live rows. With what restores them as
  # they were before it: the test accounts (a table until 014), the migrations applied, and
  # what publishing to OSM keeps (016: the sealed write tokens, the publications, the nodes),
  # the cameras kept off the map (018), the journal and the site's settings (020), the
  # site's counters by hour, day and month (021), the register's reports (026).
  # A -t naming no table is no error while another matches (pg_dump: only none matching
  # fails). The deploy user's alone: it holds the accounts' password hashes and the tokens.
  install -d -m 700 '$API/backups' && chmod 700 '$API/backups'
  if psql -XAt '$DB_DSN' -c \"SELECT to_regclass('contributions') IS NOT NULL\" | grep -qx t; then
    ( umask 077
      pg_dump -Fc -t contributions -t accounts -t test_authors -t schema_migrations \\
        -t osm_write -t osm_publications -t osm_nodes -t hidden_cameras -t admin_log \\
        -t site_settings -t site_counters_hour -t site_counters -t site_counters_month \\
        -t registre_reports \\
        '$DB_DSN' \\
        -f '$API/backups/contributions-$STAMP.dump' )
  fi
  db/migrate.sh '$DB_DSN'
  db/test_authors.sh '$TEST_LIST' '$DB_DSN'
  db/load.sh '$API/exports/$STAMP' '$DB_DSN'
  db/load_registre.sh '$API/exports/$STAMP/registre-recherche.tsv.gz' '$DB_DSN'
  db/settle.sh '$API/exports/$STAMP' '$DB_DSN'
  psql -X -q -At -v ON_ERROR_STOP=1 '$DB_DSN' -f db/retention.sql
  cd '$API'
  ln -sfn '$API_RELEASE' current.new
  mv -T current.new current 2>/dev/null || { ln -sfn '$API_RELEASE' current; rm -f current.new; }
  sudo -n /usr/bin/systemctl restart preview-api
  for i in \$(seq 30); do
    code=\$(curl -s -o /dev/null -w '%{http_code}' \
      'http://127.0.0.1:$API_PORT/api/proposals?bbox=2.2,48.8,2.3,48.9' || true)
    [ \"\$code\" = 200 ] && break
    sleep 1
  done
  [ \"\$code\" = 200 ] || { echo \"API health: \$code\" >&2; exit 1; }
  for d in releases exports backups; do
    cd '$API'/\$d
    n=\$(ls -1 | wc -l)
    if [ \"\$n\" -gt $KEEP ]; then ls -1 | sort | head -n \$((n - $KEEP)) | xargs rm -rf; fi
  done
  # The dumps hold accounts and tokens: none older than 14 days either, as the nightly ones
  # (the privacy page says so).
  find '$API/backups' -maxdepth 1 -name 'contributions-*.dump' -mtime +13 -delete"
echo "api published $STAMP (build $BUILD_ID)"

# 2. Web: swap `current` to the new release (atomic rename with GNU mv; plain relink
# elsewhere), then keep the last $KEEP releases.
ssh "$DEPLOY_TARGET" "set -e
  cd '$DEPLOY_PATH'
  ln -sfn '$RELEASE' current.new
  mv -T current.new current 2>/dev/null || { ln -sfn '$RELEASE' current; rm -f current.new; }
  cd releases
  n=\$(ls -1 | wc -l)
  if [ \"\$n\" -gt $KEEP ]; then ls -1 | sort | head -n \$((n - $KEEP)) | xargs rm -rf; fi"
echo "published $STAMP"

# 3. Site file, then reload: Caddy keeps its running configuration if the new one is refused.
# The previous file is kept as .bak.<stamp> (not *.caddy: `import sites.d/*.caddy` would
# load it) for a rollback: copy it back and reload.
printf '%s' "$SITE" | ssh "$DEPLOY_TARGET" "set -e
  if [ -f '$CADDY_SITE' ]; then cp '$CADDY_SITE' '$CADDY_SITE.bak.$STAMP'; fi
  cat > '$CADDY_SITE.new' && mv '$CADDY_SITE.new' '$CADDY_SITE'
  sudo -n systemctl reload caddy"
echo "caddy reloaded"

# 4. Anonymous view (the API included) and the served build against the database's. A new
# host gets its certificate a few seconds after the reload: retry for two minutes.
SERVED="$(ssh "$DEPLOY_TARGET" "grep -o '\"build_id\": \"[^\"]*\"' '$DEPLOY_PATH/current/tiles/meta.json'" |
  sed 's/.*: "\(.*\)"/\1/')"
IN_DB="$(ssh "$DEPLOY_TARGET" "psql -XAt '$DB_DSN' -c 'SELECT build_id FROM meta'")"
for _ in $(seq 12); do
  uv run python deploy/site.py check "https://$PREVIEW_HOST" --builds "$SERVED" "$IN_DB" 2>/dev/null &&
    break
  sleep 10
done
uv run python deploy/site.py check "https://$PREVIEW_HOST" --builds "$SERVED" "$IN_DB"
