#!/usr/bin/env bash
# Back to the release before deploy/deploy.sh's last one, at once: the build's tables
# swapped back (db/rollback.sh: cameras, buildings, meta, kept one build back by db/load.sh),
# then the API and web releases before the current ones linked as `current`, the API
# restarted and asked for its health, and the site checked (deploy/site.py) with the
# builds now served. Refused, and nothing changed, when there is no release or table to go
# back to, or when a migration changed the tables since: then restore the deploy's dump
# (db/restore.sh). Caddy's site file is left as it is (each deploy keeps the one before as
# .bak.<stamp>). Run twice, it goes forward again only for the tables: relink by hand.
#   deploy/rollback.sh             (environment: deploy/deploy.env.example)
set -euo pipefail
cd "$(dirname "$0")/.."
: "${DEPLOY_TARGET:?set DEPLOY_TARGET=user@host (ssh destination of the VPS)}"
: "${PREVIEW_HOST:?set PREVIEW_HOST}"
DEPLOY_PATH="${DEPLOY_PATH:-/srv/preview}"
API_PORT="${API_PORT:-8791}"
DB_DSN="${DB_DSN:-dbname=preview}"
API="$DEPLOY_PATH/api"
LOCK_TOKEN="$(uv run --quiet python -m lacarte.lock acquire --pid $$ --what "deploy/rollback.sh")" ||
  exit
export LACARTE_LOCK_TOKEN="$LOCK_TOKEN"
trap 'uv run --quiet python -m lacarte.lock release --token "$LOCK_TOKEN"' EXIT

ssh "$DEPLOY_TARGET" "set -e
  # The release just before the one \`current\` names, in a releases folder.
  before() {
    cur=\$(readlink \"\$1/current\"); cur=\${cur##*/}
    ls -1 \"\$1/releases\" | sort | awk -v c=\"\$cur\" '\$0 < c' | tail -n 1
  }
  web=\$(before '$DEPLOY_PATH'); api=\$(before '$API')
  [ -n \"\$web\" ] && [ -n \"\$api\" ] || { echo 'refused: no release before' >&2; exit 1; }
  # The tables kept back must be that release's build (a second rollback would swap them
  # forward while the releases go further back).
  kept=\$(psql -XAt '$DB_DSN' -c 'SELECT build_id FROM meta_prev' 2>/dev/null || true)
  grep -q \"\\\"build_id\\\": \\\"\$kept\\\"\" '$DEPLOY_PATH'/releases/\$web/tiles/meta.json ||
    { echo \"refused: the tables kept back (\${kept:-none}) are not release \$web's build\" >&2; exit 1; }
  cd '$API/current'
  db/rollback.sh '$DB_DSN'
  for pair in '$API':\$api '$DEPLOY_PATH':\$web; do
    dir=\${pair%%:*}; rel=\${pair#*:}
    cd \"\$dir\"
    ln -sfn \"\$dir/releases/\$rel\" current.new
    mv -T current.new current 2>/dev/null || { ln -sfn \"\$dir/releases/\$rel\" current; rm -f current.new; }
  done
  sudo -n /usr/bin/systemctl restart preview-api
  for i in \$(seq 30); do
    code=\$(curl -s -o /dev/null -w '%{http_code}' \
      'http://127.0.0.1:$API_PORT/api/proposals?bbox=2.2,48.8,2.3,48.9' || true)
    [ \"\$code\" = 200 ] && break
    sleep 1
  done
  [ \"\$code\" = 200 ] || { echo \"API health: \$code\" >&2; exit 1; }
  echo \"back to web \$web, api \$api\""

SERVED="$(ssh "$DEPLOY_TARGET" "grep -o '\"build_id\": \"[^\"]*\"' '$DEPLOY_PATH/current/tiles/meta.json'" |
  sed 's/.*: "\(.*\)"/\1/')"
IN_DB="$(ssh "$DEPLOY_TARGET" "psql -XAt '$DB_DSN' -c 'SELECT build_id FROM meta'")"
uv run python deploy/site.py check "https://$PREVIEW_HOST" --builds "$SERVED" "$IN_DB"
