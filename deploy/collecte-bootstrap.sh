#!/usr/bin/env bash
# Root setup of the registre's collection on the site's server, run BY THE AUTHOR with sudo,
# never by an agent. Idempotent: a second run only does what is missing. It installs no
# network service and opens no port: the collection only asks, from the server's main
# address (outgoing connections, which the firewall of deploy/bootstrap.sh leaves open).
#
#   sudo deploy/collecte-bootstrap.sh --deploy-user USER [--dir DIR] [--dry-run]
#
# What it does (Debian 13):
#   1. the missing packages, from the distribution, no recommended ones: poppler-utils
#      (pdftotext, pdfinfo: an official PDF read then thrown away), tesseract-ocr and its
#      French data (the scanned pages, accents kept);
#   2. `lacarte-collecte`, a system user without a shell, a password or sudo, its home DIR
#      (default /srv/lacarte-collecte);
#   3. its folders: DIR/code (USER's: deploy/collecte-sync.sh sends the code and builds its
#      venv there, readable by all), DIR/data (the collection's, 750: its states, its caches,
#      nothing USER reads), DIR/sortie (the derived files only, 2750, group USER: what
#      deploy/collecte-sync.sh brings back to the Mac);
#   4. /etc/lacarte-collecte.env (640, root:lacarte-collecte), created once with an empty
#      LACARTE_ROBOT_CONTACT: the author writes the robot's contact there (never in the
#      repository); the collection refuses to start without it;
#   5. lacarte-collecte.service (a oneshot, hardened: writes in DIR/data and DIR/sortie
#      only, nice, idle I/O, 2 GB of memory at most, 6 hours at most) and its timer (every
#      night at 01:15 Paris time: the catching up, then the weekly update, which the
#      collection itself decides), enabled;
#   6. sudoers: USER may start, stop and ask the status of that unit, and read its journal,
#      nothing else.
# --dry-run prints every command and file instead of running or writing it.
set -euo pipefail
cd /
export DEBIAN_FRONTEND=noninteractive

DRY=0
DEPLOY_USER="${SUDO_USER:-}"
DIR="/srv/lacarte-collecte"
UNIT_USER="lacarte-collecte"
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY=1 ;;
    --deploy-user) DEPLOY_USER="$2"; shift ;;
    --dir) DIR="$2"; shift ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done
[ -n "$DEPLOY_USER" ] || { echo "--deploy-user is required" >&2; exit 2; }
if [ "$DRY" = 0 ] && [ "$(id -u)" != 0 ]; then
  echo "run with sudo (or --dry-run)" >&2
  exit 1
fi
if [ "$DRY" = 0 ] && ! id "$DEPLOY_USER" >/dev/null 2>&1; then
  echo "$DEPLOY_USER does not exist (deploy/bootstrap.sh creates it)" >&2
  exit 1
fi

run() { # print, then run unless --dry-run
  echo "+ $*"
  [ "$DRY" = 1 ] || "$@"
}
changed=""
put() { # put PATH MODE OWNER: write stdin to PATH if it differs; remember what changed
  local path="$1" mode="$2" owner="$3" content
  content="$(cat)"
  if [ -f "$path" ] && [ "$(cat "$path")" = "$content" ]; then
    echo "= $path unchanged"
    return
  fi
  echo "+ write $path ($mode $owner)"
  if [ "$DRY" = 1 ]; then
    printf '%s\n' "$content" | sed 's/^/    | /'
  else
    printf '%s\n' "$content" > "$path.new"
    chmod "$mode" "$path.new"
    chown "$owner" "$path.new"
    mv "$path.new" "$path"
  fi
  changed="$changed $path"
}
folder() { # folder PATH MODE OWNER:GROUP: created, or its mode and owner given back
  local d="$1" mode="$2" owner="$3"
  if [ ! -d "$d" ] || [ "$(stat -c '%a %U:%G' "$d" 2>/dev/null)" != "${mode#0} $owner" ]; then
    run install -d -o "${owner%:*}" -g "${owner#*:}" -m "$mode" "$d"
  fi
}

echo "== 1. packages"
todo=""
for p in poppler-utils tesseract-ocr tesseract-ocr-fra; do
  dpkg -s "$p" >/dev/null 2>&1 || todo="$todo $p"
done
if [ -n "$todo" ]; then
  run apt-get update
  # shellcheck disable=SC2086 # one package per word
  run apt-get install -y --no-install-recommends $todo
fi

echo "== 2. the collection's user, $UNIT_USER"
if ! id "$UNIT_USER" >/dev/null 2>&1; then
  run useradd --system --home-dir "$DIR" --no-create-home --shell /usr/sbin/nologin \
    --user-group "$UNIT_USER"
fi

echo "== 3. folders"
folder "$DIR" 0755 root:root
folder "$DIR/code" 0755 "$DEPLOY_USER:$DEPLOY_USER"
folder "$DIR/data" 0750 "$UNIT_USER:$UNIT_USER"
folder "$DIR/sortie" 2750 "$UNIT_USER:$DEPLOY_USER"

echo "== 4. /etc/lacarte-collecte.env"
if [ ! -f /etc/lacarte-collecte.env ]; then
  put /etc/lacarte-collecte.env 640 "root:$UNIT_USER" <<'ENV'
# The registre's collection (lacarte-collecte.service). Written by the author, never
# committed. The robot's contact, said in its User-Agent: an address or a page where
# whoever runs it can be reached (one line, no parentheses).
LACARTE_ROBOT_CONTACT=
ENV
else
  echo "= /etc/lacarte-collecte.env kept (the author's)"
fi

echo "== 5. the unit and its timer"
put /etc/systemd/system/lacarte-collecte.service 644 root:root <<UNIT
[Unit]
Description=Registre: the national collection (arrêtés, BOAMP, subventions)
After=network-online.target
Wants=network-online.target
ConditionPathExists=$DIR/code/current/.venv/bin/python

[Service]
Type=oneshot
User=$UNIT_USER
Group=$UNIT_USER
EnvironmentFile=/etc/lacarte-collecte.env
Environment=PYTHONPATH=$DIR/code/current/pipeline
Environment=LACARTE_COLLECTE_DIR=$DIR/data
Environment=LACARTE_COLLECTE_SORTIE=$DIR/sortie
Environment=TESSDATA_PREFIX=/usr/share/tesseract-ocr/5/tessdata
WorkingDirectory=$DIR/data
UMask=0027
ExecStart=$DIR/code/current/.venv/bin/python -m lacarte_collecte.cli tourner
Nice=10
IOSchedulingClass=idle
CPUQuota=200%
MemoryMax=2G
RuntimeMaxSec=6h
TimeoutStopSec=60
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=$DIR/data $DIR/sortie
PrivateTmp=yes
PrivateDevices=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
CapabilityBoundingSet=
UNIT
put /etc/systemd/system/lacarte-collecte.timer 644 root:root <<'TIMER'
[Unit]
Description=Registre: the national collection, every night

[Timer]
OnCalendar=*-*-* 01:15 Europe/Paris
RandomizedDelaySec=10min
Persistent=true

[Install]
WantedBy=timers.target
TIMER
if [[ "$changed" == *lacarte-collecte.* ]]; then run systemctl daemon-reload; fi
systemctl is-enabled --quiet lacarte-collecte.timer 2>/dev/null ||
  run systemctl enable --now lacarte-collecte.timer

echo "== 6. sudoers: $DEPLOY_USER starts, stops and reads the collection, nothing else"
put /etc/sudoers.d/lacarte-collecte 440 root:root <<SUDO
$DEPLOY_USER ALL=(root) NOPASSWD: /usr/bin/systemctl start --no-block lacarte-collecte.service, /usr/bin/systemctl stop lacarte-collecte.service, /usr/bin/systemctl status --no-pager lacarte-collecte.service, /usr/bin/journalctl -u lacarte-collecte.service *
SUDO
if [ "$DRY" = 0 ]; then visudo -cf /etc/sudoers.d/lacarte-collecte >/dev/null; fi

echo "done. Next: write the robot's contact in /etc/lacarte-collecte.env, then, from the"
echo "Mac, deploy/collecte-sync.sh envoyer (the code), then"
echo "sudo systemctl start --no-block lacarte-collecte.service for a first run."
