#!/usr/bin/env bash
# The API's OpenStreetMap settings, for deploy/deploy.sh (README, « Sign in with
# OpenStreetMap »). Never prints a value.
#   deploy/osm_env.sh check         the variables are there and safe to write, or exit 1
#   deploy/osm_env.sh probe         check, then ask each OSM server in use whether it knows
#                                   its client: a code no one was given, sent with the real
#                                   id and secret to its /oauth2/token, must be refused as a
#                                   code (invalid_grant), not as a client (invalid_client,
#                                   exit 1). Only the verdict is printed; no answer from OSM
#                                   is a warning, not a refusal. Whether the live client may
#                                   ask write_api is not checked: nothing tells it before a
#                                   person signs in (see probe below).
#   deploy/osm_env.sh write PATH    check, then write them to PATH on DEPLOY_TARGET (ssh):
#                                   through ssh's stdin (never its command line), umask 077,
#                                   mode 600, the deploy user's; replaced in one rename.
# The unit reads PATH (<DEPLOY_PATH>/api/osm.env) as root before it starts the API
# (bootstrap.sh: EnvironmentFile=-…), so the deploy writes it before the restart.
set -euo pipefail

# Sign-in goes through OSM's test server unless OSM_LOGIN_SERVER=live: the live server's
# client is required only then. Writing goes to the test server (OSM_WRITE_SERVER=dev, the
# only value); /revue's « Réglages » switches it to the live server (osm_write_live,
# migration 022, no redeploy), with the live client: written whenever it is given.
LOGIN="${OSM_LOGIN_SERVER:-dev}"
REQUIRED=(OSM_DEV_CLIENT_ID OSM_DEV_CLIENT_SECRET OSM_TOKEN_KEY)
CLIENTS=(OSM_DEV_CLIENT_ID OSM_DEV_CLIENT_SECRET)
if [ "$LOGIN" = live ] || [ -n "${OSM_LIVE_CLIENT_ID:-}${OSM_LIVE_CLIENT_SECRET:-}" ]; then
  REQUIRED+=(OSM_LIVE_CLIENT_ID OSM_LIVE_CLIENT_SECRET)
  CLIENTS+=(OSM_LIVE_CLIENT_ID OSM_LIVE_CLIENT_SECRET)
fi

check() {
  local v
  for v in "${REQUIRED[@]}"; do
    [ -n "${!v:-}" ] || { echo "set $v (README, « Sign in with OpenStreetMap »)" >&2; exit 1; }
  done
  # Written as VAR=value lines that systemd reads without quotes: only characters that need
  # none. The clients' id and secret are sent form-encoded (RFC 6749 §2.3.1), which leaves
  # these unchanged; the key is base64.
  case "$LOGIN" in
    dev | live) ;;
    *) echo "refused: OSM_LOGIN_SERVER is dev or live" >&2; exit 1 ;;
  esac
  for v in "${CLIENTS[@]}"; do
    [[ "${!v}" =~ ^[A-Za-z0-9._~-]+$ ]] ||
      { echo "refused: $v holds characters other than A-Z a-z 0-9 . _ ~ -" >&2; exit 1; }
  done
  [[ "$OSM_TOKEN_KEY" =~ ^[A-Za-z0-9+/]+=*$ ]] ||
    { echo "refused: OSM_TOKEN_KEY is not base64 (openssl rand -base64 32)" >&2; exit 1; }
  # Where people publish: the test server; the live one is /revue's switch, not this file's.
  [ "${OSM_WRITE_SERVER:-dev}" = dev ] || {
    echo "refused: OSM_WRITE_SERVER is dev (the live server is /revue's switch osm_write_live)" >&2
    exit 1
  }
  if [ -n "${OSM_WRITE_LIVE_APPROVED+set}" ]; then
    echo "note: OSM_WRITE_LIVE_APPROVED is no longer read nor written (/revue's osm_write_live)" >&2
  fi
}

# 2026-10-11: sign-in failed on OSM's test server because it refused the deployed secret
# (401 invalid_client), which nothing could see before a person tried. RFC 6749 §5.2: a
# refused client is invalid_client (401 with client_secret_basic), a refused code
# invalid_grant; OSM's test server answers so (read on its token endpoint, 2026-10-11).
# 2026-10-13, the client's scopes (write_api) cannot be asked so. openstreetmap-website's
# Oauth2AuthorizationsController authorizes before Doorkeeper's `new` (authorize_resource;
# Ability lets only a signed-in user reach :oauth2_authorization), so /oauth2/authorize
# answers a stranger with the login page (302, or 403 for JSON) before validate_scopes;
# the test server answered so alike for write_api, openid, an unknown scope and an
# unknown client. The token endpoint only grants authorization_code (discovery's
# grant_types_supported; client_credentials: unsupported_grant_type), which carries no
# scope. The first « Autoriser sur OpenStreetMap » on the site shows it: an application
# without « Modifier la carte » gets OSM's invalid_scope page right after the sign-in.
probe() {
  check
  local pairs=("OSM_DEV ${OSM_DEV_URL:-https://master.apis.dev.openstreetmap.org}")
  if [[ " ${CLIENTS[*]} " == *" OSM_LIVE_CLIENT_ID "* ]]; then
    pairs+=("OSM_LIVE ${OSM_LIVE_URL:-https://www.openstreetmap.org}")
  fi
  local pair
  for pair in "${pairs[@]}"; do
    # The names go on the command line, the values stay in the environment.
    python3 - "${pair% *}" "${pair#* }" <<'PY' || exit 1
import base64, json, os, sys, urllib.error, urllib.parse, urllib.request
name, url = sys.argv[1], sys.argv[2]
q = lambda v: urllib.parse.quote(os.environ[v], safe="")
pair = f"{q(name + '_CLIENT_ID')}:{q(name + '_CLIENT_SECRET')}"
form = {"grant_type": "authorization_code", "code": "deploy-probe",
        "redirect_uri": "https://invalid.invalid/api/osm/callback", "code_verifier": "p" * 64}
request = urllib.request.Request(
    url + "/oauth2/token", data=urllib.parse.urlencode(form).encode(), method="POST",
    headers={"Authorization": "Basic " + base64.b64encode(pair.encode()).decode(),
             "Accept": "application/json", "User-Agent": "SurveillanceWorld-deploy",
             "Content-Type": "application/x-www-form-urlencoded"})
try:
    urllib.request.urlopen(request, timeout=15).close()
    error, status = None, 200
except urllib.error.HTTPError as exc:
    status = exc.code
    try:
        error = json.loads(exc.read(1 << 16)).get("error")
    except Exception:
        error = None
except Exception as exc:
    print(f"warning: {name}: no answer from OSM ({type(exc).__name__}), client not checked",
          file=sys.stderr)
    sys.exit(0)
if status == 401 or error == "invalid_client":
    print(f"refused: OSM does not know {name}_CLIENT_ID / {name}_CLIENT_SECRET together"
          " (invalid_client): copy them again from the application's page", file=sys.stderr)
    sys.exit(1)
if status != 400:  # maintenance (5xx), a limit (429), a redirect: the question unanswered
    print(f"warning: {name}: OSM answered {status}, client not checked", file=sys.stderr)
    sys.exit(0)
print(f"{name} client known to OSM")
PY
  done
}

lines() { # printf is a builtin: the values never reach a command line
  local v
  for v in "${REQUIRED[@]}"; do printf '%s=%s\n' "$v" "${!v}"; done
  printf 'OSM_LOGIN_SERVER=%s\n' "$LOGIN"
  printf 'OSM_WRITE_SERVER=%s\n' "${OSM_WRITE_SERVER:-dev}"
}

case "${1:-}" in
  check) check ;;
  probe) probe ;;
  write)
    dest="${2:?usage: deploy/osm_env.sh write PATH}"
    : "${DEPLOY_TARGET:?set DEPLOY_TARGET=user@host (ssh destination of the VPS)}"
    check
    lines | ssh "$DEPLOY_TARGET" "set -e
      umask 077
      cat > '$dest.new'
      chmod 600 '$dest.new'
      mv -f '$dest.new' '$dest'"
    echo "osm.env written (values not shown)"
    ;;
  *) echo "usage: deploy/osm_env.sh check | probe | write PATH" >&2; exit 2 ;;
esac
