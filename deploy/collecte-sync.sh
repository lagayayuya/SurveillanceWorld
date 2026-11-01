#!/usr/bin/env bash
# The registre's collection on the server, from the Mac, as the deploy user (no root):
#
#   deploy/collecte-sync.sh envoyer     # the code to DIR/code/<stamp>, its venv, then current
#   deploy/collecte-sync.sh rapatrier   # DIR/sortie (the derived files) to data/registre/collecte
#   deploy/collecte-sync.sh lancer      # start the unit now (it also runs every night)
#   deploy/collecte-sync.sh etat        # the unit's status and the collection's report
#
# DEPLOY_TARGET (the deploy user's ssh address) comes from the deploy environment
# (~/.config/la-carte/deploy.env, outside the repository); COLLECTE_DIR defaults to
# /srv/lacarte-collecte (deploy/collecte-bootstrap.sh). Only the derived files come back:
# the collection's raw data (states, caches) stays in DIR/data, which the deploy user cannot
# read. Nothing is printed of the environment.
# shellcheck disable=SC2029 # the paths below are the client's, expanded here on purpose
set -euo pipefail
cd "$(dirname "$0")/.."
: "${DEPLOY_TARGET:?DEPLOY_TARGET is not set (the deploy environment)}"
DIR="${COLLECTE_DIR:-/srv/lacarte-collecte}"
LOCAL="data/registre/collecte"

case "${1:-}" in
  envoyer)
    STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
    REL="$DIR/code/$STAMP"
    rsync -az --delete --exclude '__pycache__' --exclude '.DS_Store' \
      pipeline rules pyproject.toml uv.lock .python-version "$DEPLOY_TARGET:$REL/"
    # The venv: uv in the deploy user's home, Python under DIR/code/python, never the
    # system's; the API's dependency group, which holds what the collection imports (PyYAML).
    ssh "$DEPLOY_TARGET" "set -e
      cd '$REL'
      UV_PYTHON_INSTALL_DIR='$DIR/code/python' UV_PROJECT_ENVIRONMENT=.venv \
        \"\$HOME/.local/bin/uv\" sync --frozen --only-group api --no-install-project --quiet
      chmod -R a+rX '$REL' '$DIR/code/python'
      ln -sfn '$REL' '$DIR/code/current.new' && mv -T '$DIR/code/current.new' '$DIR/code/current'
      # the releases but the last three
      ls -1d '$DIR'/code/20*Z | head -n -3 | xargs -r rm -rf"
    echo "code: $STAMP"
    ;;
  rapatrier)
    mkdir -p "$LOCAL"
    rsync -az --delete "$DEPLOY_TARGET:$DIR/sortie/" "$LOCAL/"
    echo "derived files in $LOCAL"
    ;;
  lancer)
    ssh "$DEPLOY_TARGET" "sudo -n /usr/bin/systemctl start --no-block lacarte-collecte.service"
    ;;
  etat)
    ssh "$DEPLOY_TARGET" "sudo -n /usr/bin/systemctl status --no-pager lacarte-collecte.service | head -n 12 || true
      cat '$DIR/sortie/rapport.txt' 2>/dev/null || echo '(no report yet)'"
    ;;
  *)
    sed -n '2,13p' "$0" >&2
    exit 2
    ;;
esac
