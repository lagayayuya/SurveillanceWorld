#!/usr/bin/env bash
# The API's site settings, for deploy/deploy.sh: the identity the site shows when one is
# given. Never prints a value. Whether contributions and sign-ups are open is no longer
# the deploy's (lot 2): the database's (migration 020), changed in /revue's « Réglages »;
# CONTRIBUTIONS_OPEN, still set in a deploy's environment, is said to be ignored.
#   deploy/site_env.sh check         the settings are there and safe to write, or exit 1
#   deploy/site_env.sh write PATH    check, then write them to PATH on DEPLOY_TARGET (ssh):
#                                    through ssh's stdin, umask 077, mode 600, the deploy
#                                    user's; replaced in one rename.
# The unit reads PATH (<DEPLOY_PATH>/api/site.env) as root before it starts the API
# (bootstrap.sh: EnvironmentFile=-…). The deploy user may change it on the server and
# restart the API (`sudo systemctl restart preview-api`): no build, no deploy; the next
# deploy writes it again from its own environment.
set -euo pipefail

PUBLISHER_IDENTITY="${PUBLISHER_IDENTITY:-}"

check() {
  if [ -n "${CONTRIBUTIONS_OPEN+set}" ]; then
    echo "note: CONTRIBUTIONS_OPEN is ignored; contributions open and close in /revue" >&2
  fi
  # Free text on one line: no control character (a newline would start another setting).
  if [[ "$PUBLISHER_IDENTITY" =~ [[:cntrl:]] ]]; then
    echo "refused: PUBLISHER_IDENTITY holds a control character (one line, no tab)" >&2
    exit 1
  fi
  # The API's own bound (pipeline/lacarte/api/app.py PUBLISHER_MAX): longer, it shows none.
  if [ "${#PUBLISHER_IDENTITY}" -gt 200 ]; then
    echo "refused: PUBLISHER_IDENTITY is longer than 200 characters" >&2
    exit 1
  fi
}

# systemd.exec(5), EnvironmentFile=: a double-quoted value takes the escapes of a POSIX
# shell's double quotes and nothing else (no expansion): \ " $ ` escaped, read back as is.
# (sed, not ${v//…}: bash 5.2 changed how a replacement's backslashes read; the value
# reaches sed through a pipe, never its command line.)
quoted() {
  printf '"%s"' "$(printf '%s' "$1" | sed 's/[\\"$`]/\\&/g')"
}

lines() { # printf is a builtin: the values never reach a command line
  printf 'PUBLISHER_IDENTITY=%s\n' "$(quoted "$PUBLISHER_IDENTITY")"
}

case "${1:-}" in
  check) check ;;
  write)
    dest="${2:?usage: deploy/site_env.sh write PATH}"
    : "${DEPLOY_TARGET:?set DEPLOY_TARGET=user@host (ssh destination of the VPS)}"
    check
    lines | ssh "$DEPLOY_TARGET" "set -e
      umask 077
      cat > '$dest.new'
      chmod 600 '$dest.new'
      mv -f '$dest.new' '$dest'"
    echo "site.env written (values not shown)"
    ;;
  *) echo "usage: deploy/site_env.sh check | write PATH" >&2; exit 2 ;;
esac
