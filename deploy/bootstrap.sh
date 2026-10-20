#!/usr/bin/env bash
# Root setup of a freshly installed Debian 13 VPS for the site, run BY THE AUTHOR with sudo,
# never by an agent. Idempotent: running it again, also after a run stopped halfway, only
# does what is missing (rehearsed twice in a row on a fresh Debian 13 container). It never
# touches the network configuration (the site's additional IPv4 is configured before, by
# hand) and never cuts the ssh session it runs in.
#
#   sudo deploy/bootstrap.sh --deploy-user USER --host HOST --bind-ip IPV4 \
#     [--main-ip IPV4] [--ssh-key PUBLIC_KEY_FILE] [--deploy-path DIR] [--api-port PORT] \
#     [--dry-run]
# --bind-ip is the site's address (Caddy's), --main-ip the server's main one (ssh's); both
# must be addresses of this machine, and differ. Without --main-ip: the machine's only
# global IPv4 address other than --bind-ip (`ip -4 addr show scope global`); none or
# several: refused, never guessed. Refused too while an ssh session came to another address
# than the main one: sign in again to the main address first.
# (--review-user NAME is still accepted and ignored: the reviewer is an account's role
# since migration 014, set with `python -m lacarte.api.accounts create NAME --admin` for
# the first administrator, migration 020; the others in /revue's « Comptes ».)
#
# What it does (Debian):
#   1. the missing packages, from the distribution, no recommended ones: PostgreSQL and
#      the PostGIS extension of its version, sudo, the ssh server, curl, rsync (deploy.sh
#      sends with it), nftables, unattended-upgrades, iproute2;
#   2. USER, the deploy user (deploy.sh logs in as it): created, password locked, the keys
#      of PUBLIC_KEY_FILE added to its authorized_keys (never one removed);
#   3. Caddy from Caddy's own apt repository (its key pinned by digest), and Caddy's base
#      Caddyfile: every site on the site's own IPv4 only (default_bind IPV4), no client
#      address in any log, slow clients cut, then `import sites.d/*.caddy` (the folder is
#      USER's: deploy.sh writes the site file there);
#   4. PostgreSQL's memory and logging settings in conf.d/preview.conf (restart only if
#      they changed): the local socket only, nothing about contributors logged;
#   5. roles: USER owns the database `preview` (peer auth over the local socket), and
#      `preview_api` reads it (default privileges; contributions are granted by migration
#      002); the postgis extension, which a non-superuser cannot create;
#   6. the system user `preview_api`, /etc/preview-api.env, the unit preview-api.service
#      (MemoryMax=768M, hardened; it also reads DEPLOY_PATH/api/osm.env and site.env when
#      there, which deploy/deploy.sh writes), enabled but first started by deploy/deploy.sh;
#      DEPLOY_PATH and its folders, USER's;
#   7. sudoers: USER may restart that unit and reload Caddy, nothing else;
#   8. a daily pg_dump of the contributions, kept 14 days (/var/backups/preview);
#   9. uv for USER in its home; Python >= 3.12 is installed by uv under DEPLOY_PATH/api,
#      never in the system;
#  10. the firewall (nftables): in, ssh on the main address only, http and https (tcp, and
#      udp for HTTP/3) on the site's address only, over IPv4 only, ping, and what answers a
#      connection already open; nothing else;
#  11. IPv6 off (sysctl), unless an ssh session runs over IPv6 (it would be cut: reconnect
#      over IPv4 and run again); an address may be bound before it is configured (sysctl:
#      sshd at boot);
#  12. security updates installed every day (unattended-upgrades, Debian-Security only);
#  13. ssh: keys only, no root, IPv4 only, on the main address only (a drop-in in
#      sshd_config.d: the host key is the same on both addresses, so the site's address
#      must not show it), written only once USER and the account running sudo both have a
#      key, checked by `sshd -t` and `sshd -T`, then a reload (never a restart: open
#      sessions stay); then the check to make from a new window before closing this one.
# In a container (systemd-detect-virt), the firewall and the sysctl are written and checked,
# not applied: « written, not applied here ».
# --dry-run prints every command and file instead of running or writing it.
set -euo pipefail
cd / # sudo -u postgres cannot enter the caller's home
export DEBIAN_FRONTEND=noninteractive # the packages' questions take their defaults

DRY=0
DEPLOY_USER="${SUDO_USER:-}"
PREVIEW_HOST=""
BIND_IP=""
MAIN_IP=""
SSH_KEY=""
DEPLOY_PATH="/srv/preview"
API_PORT="8791"
UV_VERSION="0.11.22" # the version the project is developed with
# Caddy's apt repository and its signing key (primary key 6576 0C51 EDEA 2017 CEA2 CA15
# 155B 6D79 CA56 EA34, « Caddy Web Server »), as served on 2026-10-13: a key that changed
# is refused until someone checks it and updates the digest.
CADDY_REPO="https://dl.cloudsmith.io/public/caddy/stable"
CADDY_KEY_SHA256="783dfee04b19e851a928cd87b34710213ebbe7628f98d9f34595ab83be578c00"
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY=1 ;;
    --deploy-user) DEPLOY_USER="$2"; shift ;;
    --host) PREVIEW_HOST="$2"; shift ;;
    --bind-ip) BIND_IP="$2"; shift ;;
    --main-ip) MAIN_IP="$2"; shift ;;
    --ssh-key) SSH_KEY="$2"; shift ;;
    --review-user) shift ;;  # ignored (accounts, migration 014)
    --deploy-path) DEPLOY_PATH="$2"; shift ;;
    --api-port) API_PORT="$2"; shift ;;
    *) echo "unknown argument $1" >&2; exit 2 ;;
  esac
  shift
done
: "${DEPLOY_USER:?--deploy-user (the ssh user deploy.sh logs in as)}"
: "${PREVIEW_HOST:?--host (the site host name)}"
: "${BIND_IP:?--bind-ip (the IPv4 the site is served on, already configured)}"
[[ "$DEPLOY_USER" =~ ^[a-z_][a-z0-9_-]*$ ]] || { echo "bad user name" >&2; exit 2; }
[[ "$API_PORT" =~ ^[0-9]+$ ]] || { echo "bad port" >&2; exit 2; }
ipv4='^([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})$'
is_ipv4() {
  [[ "$1" =~ $ipv4 ]] && [ "${BASH_REMATCH[1]}" -le 255 ] && [ "${BASH_REMATCH[2]}" -le 255 ] &&
    [ "${BASH_REMATCH[3]}" -le 255 ] && [ "${BASH_REMATCH[4]}" -le 255 ]
}
is_ipv4 "$BIND_IP" || { echo "bad --bind-ip: an IPv4 address" >&2; exit 2; }
[ -z "$MAIN_IP" ] || is_ipv4 "$MAIN_IP" || { echo "bad --main-ip: an IPv4 address" >&2; exit 2; }
if [ -n "$SSH_KEY" ]; then
  [ -f "$SSH_KEY" ] || { echo "--ssh-key: no file $SSH_KEY" >&2; exit 2; }
  if grep -q "PRIVATE KEY" "$SSH_KEY"; then echo "--ssh-key: a public key, not a private one" >&2; exit 2; fi
fi
if [ "$DRY" = 0 ] && [ "$(id -u)" != 0 ]; then echo "run with sudo (or --dry-run)" >&2; exit 1; fi
if [ "$DRY" = 0 ] && ! command -v apt-get >/dev/null; then
  echo "Debian expected (apt-get)" >&2
  exit 1
fi
CONTAINER=0
if command -v systemd-detect-virt >/dev/null && systemd-detect-virt --quiet --container; then
  CONTAINER=1
  echo "container ($(systemd-detect-virt --container)): the firewall and the sysctl will be written, not applied"
fi

# The main address (ssh's) and the site's (Caddy's): this machine's, two different ones.
# Read-only, so a dry run checks them too (on a machine without iproute2, it cannot).
global_ipv4() { ip -4 -o addr show scope global | awk '{ split($4, a, "/"); print a[1] }'; }
if command -v ip >/dev/null; then
  mine="$(global_ipv4)"
  if [ -z "$MAIN_IP" ]; then
    others="$(printf '%s\n' "$mine" | grep -vxF -e "$BIND_IP" -e "" || true)"
    if [ "$(printf '%s' "$others" | grep -c .)" != 1 ]; then
      echo "--main-ip not given and not detected: this machine's global IPv4 addresses other" \
        "than --bind-ip are [$(echo $others)]; pass --main-ip (the one you sign in to)" >&2
      exit 2
    fi
    MAIN_IP="$others"
    echo "main address: $MAIN_IP (the only global IPv4 address other than --bind-ip)"
  fi
  for a in "$MAIN_IP" "$BIND_IP"; do
    printf '%s\n' "$mine" | grep -qxF "$a" ||
      { echo "$a is not an address of this machine ([$(echo $mine)])" >&2; exit 2; }
  done
elif [ "$DRY" = 0 ]; then
  echo "iproute2 expected (ip): the addresses cannot be checked" >&2
  exit 1
else
  [ -n "$MAIN_IP" ] || { echo "--main-ip: no ip command to detect it here; pass it" >&2; exit 2; }
  echo "addresses: not checked (no ip command here)"
fi
[ "$MAIN_IP" != "$BIND_IP" ] ||
  { echo "--main-ip and --bind-ip are the same address: ssh would show itself on the site's" >&2; exit 2; }
# Never cut the way in: ssh and the firewall keep port 22 on the main address alone, so a
# session that came to another one could not come back. (Open sessions are not cut by the
# reload or the firewall; the next sign-in would be.)
if command -v ss >/dev/null; then
  elsewhere="$(ss -H -4 -tn state established '( sport = :22 )' | awk '{ print $3 }' |
    sed 's/:22$//' | grep -vxF "$MAIN_IP" | sort -u || true)"
  if [ -n "$elsewhere" ]; then
    echo "refused: an ssh session came to $(echo $elsewhere), not to the main address" \
      "$MAIN_IP; ssh would stop answering there. Sign in to $MAIN_IP (ssh -4" \
      "${SUDO_USER:-debian}@$MAIN_IP), close the other session(s), run again." >&2
    exit 1
  fi
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
psql_su() { run sudo -u postgres psql -X -q -v ON_ERROR_STOP=1 "$@"; }
active() { command -v systemctl >/dev/null && systemctl is-active --quiet "$1"; }
enabled() { command -v systemctl >/dev/null && systemctl is-enabled --quiet "$1" 2>/dev/null; }
# A folder owned by USER (deploy.sh writes there over ssh), created or given back.
user_dir() {
  local d="$1" mode="$2"
  if [ ! -d "$d" ] || [ "$(stat -c %U "$d" 2>/dev/null)" != "$DEPLOY_USER" ]; then
    run install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" -m "$mode" "$d"
  fi
}

echo "== 1. packages"
# Only what is missing; never the recommended packages. The distribution's `postgis`
# package only recommends the extension (Debian 13: bootstrap stopped at CREATE EXTENSION),
# so the extension of the installed server version is named explicitly.
missing() { # the packages of "$@" not installed
  local p
  for p in "$@"; do dpkg -s "$p" >/dev/null 2>&1 || echo "$p"; done
}
updated=0
install_missing() {
  local todo
  todo="$(missing "$@")"
  [ -n "$todo" ] || return 0
  [ "$updated" = 1 ] || { run apt-get update; updated=1; }
  # shellcheck disable=SC2086 # one package per word
  run apt-get install -y --no-install-recommends $todo
}
# (No postgresql-contrib: on Debian a virtual package provided by the server package, so
# dpkg never sees it installed and every run installed it again, CI's second run showed.)
install_missing postgresql curl ca-certificates sudo openssh-server rsync nftables \
  unattended-upgrades iproute2
PG_VERSION="$(pg_lsclusters -h 2>/dev/null | awk 'NR==1 {print $1}' || true)"
[ -n "$PG_VERSION" ] || PG_VERSION="<version>" # dry run on a machine without PostgreSQL
echo "cluster: $PG_VERSION main"
install_missing "postgresql-$PG_VERSION-postgis-3" "postgresql-$PG_VERSION-postgis-3-scripts"

echo "== 2. deploy user $DEPLOY_USER and its ssh key"
if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
  # A locked password (useradd's default): it signs in by key only.
  run useradd --create-home --shell /bin/bash --user-group "$DEPLOY_USER"
fi
HOME_DIR="$(getent passwd "$DEPLOY_USER" 2>/dev/null | cut -d: -f6 || true)"
[ -n "$HOME_DIR" ] || HOME_DIR="/home/$DEPLOY_USER" # dry run, user not created yet
KEYS="$HOME_DIR/.ssh/authorized_keys"
if [ -n "$SSH_KEY" ]; then
  if [ "$DRY" = 0 ] && ! ssh-keygen -l -f "$SSH_KEY" >/dev/null; then
    echo "--ssh-key: not a public key file" >&2
    exit 1
  fi
  [ -d "$HOME_DIR/.ssh" ] || run install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" -m 700 "$HOME_DIR/.ssh"
  # Each key of the file not there yet is added; the others stay.
  while IFS= read -r key || [ -n "$key" ]; do
    key="${key%$'\r'}"
    case "$key" in "" | "#"*) continue ;; esac
    if [ -f "$KEYS" ] && grep -qxF "$key" "$KEYS"; then
      echo "= key ${key:0:24}... already in $KEYS"
      continue
    fi
    echo "+ append to $KEYS: ${key:0:24}..."
    if [ "$DRY" = 0 ]; then
      ( umask 077; printf '%s\n' "$key" >> "$KEYS" )
      chown "$DEPLOY_USER:$DEPLOY_USER" "$KEYS"
      chmod 600 "$KEYS"
    fi
    changed="$changed $KEYS"
  done < "$SSH_KEY"
fi

echo "== 3. Caddy (its own apt repository), its base Caddyfile"
# Caddy's repository, not Debian's package: Debian 13 ships Caddy 2.6.2 (2022), the tests
# and the site file are written against 2.11. The key in ASCII armour, which apt reads as
# is (.asc), no gpg needed.
KEY=/etc/apt/keyrings/caddy-stable.asc
key_ok() { [ -f "$KEY" ] && echo "$CADDY_KEY_SHA256  $KEY" | sha256sum -c --status 2>/dev/null; }
if ! key_ok; then
  [ -d /etc/apt/keyrings ] || run install -d -m 755 /etc/apt/keyrings
  echo "+ curl -fsSL $CADDY_REPO/gpg.key -o $KEY.new (sha256 $CADDY_KEY_SHA256)"
  if [ "$DRY" = 0 ]; then
    curl -fsSL "$CADDY_REPO/gpg.key" -o "$KEY.new"
    if ! echo "$CADDY_KEY_SHA256  $KEY.new" | sha256sum -c --status; then
      rm -f "$KEY.new"
      echo "Caddy's repository key changed: check its fingerprint, then update CADDY_KEY_SHA256" >&2
      exit 1
    fi
    chmod 644 "$KEY.new"
    mv "$KEY.new" "$KEY"
  fi
  changed="$changed $KEY"
fi
put /etc/apt/sources.list.d/caddy-stable.sources 644 root:root <<SOURCES
Types: deb
URIs: $CADDY_REPO/deb/debian
Suites: any-version
Components: main
Signed-By: $KEY
SOURCES
if [[ "$changed" == *caddy-stable* ]]; then updated=0; fi # the new list read first
install_missing caddy
# deploy.sh writes the site file (preview.caddy, rendered by deploy/site.py) here.
user_dir /etc/caddy/sites.d 755
# Every site on the site's own address: the server's main address answers nothing on 80
# and 443, nor IPv6. No access log (no site has a log directive); every other log (errors,
# TLS handshakes, the proxy) loses the fields that carry a client's address, read in
# Caddy 2.11's and certmagic's sources (request, remote*, client_ip, headers).
# A client that sends its request too slowly is cut (in memory, nothing logged).
caddyfile() {
  cat <<CADDYFILE
{
	default_bind $BIND_IP
	log default {
		level INFO
		format filter {
			fields {
				request>remote_ip delete
				request>remote_port delete
				request>client_ip delete
				request>headers delete
				remote_ip delete
				remote_port delete
				remote_addr delete
				remote delete
				client_ip delete
				headers delete
			}
		}
	}
	servers {
		timeouts {
			read_header 10s
			read_body 30s
			idle 2m
		}
	}
}

import sites.d/*.caddy
CADDYFILE
}
# Checked by Caddy before it replaces the running one (next to it: the import is relative).
if [ "$DRY" = 0 ] && [ "$(caddyfile)" != "$(cat /etc/caddy/Caddyfile 2>/dev/null)" ]; then
  caddyfile > /etc/caddy/Caddyfile.check
  chmod 644 /etc/caddy/Caddyfile.check
  if ! out="$(sudo -u caddy caddy validate --config /etc/caddy/Caddyfile.check --adapter caddyfile 2>&1)"; then
    rm -f /etc/caddy/Caddyfile.check
    printf '%s\n' "$out" >&2
    echo "Caddyfile refused by caddy validate: not written" >&2
    exit 1
  fi
  rm -f /etc/caddy/Caddyfile.check
  echo "Caddyfile: caddy validate ok"
fi
put /etc/caddy/Caddyfile 644 root:root < <(caddyfile) # (not a pipe: put records what changed)
if ! active caddy; then
  run systemctl enable --now caddy
elif [[ "$changed" == */etc/caddy/Caddyfile* ]]; then
  run systemctl reload caddy
fi

echo "== 4. PostgreSQL settings (memory [TO VALIDATE after measurement], logging)"
put "/etc/postgresql/$PG_VERSION/main/conf.d/preview.conf" 644 postgres:postgres <<'CONF'
# The site: a 4 GB server.
shared_buffers = 256MB
work_mem = 16MB
max_connections = 20
# The local socket only (every client here uses it): no TCP, no address in any log line.
listen_addresses = ''
# Nothing about contributors in the server log: no statement text, no parameter values,
# no connections.
log_statement = none
log_min_error_statement = panic
log_parameter_max_length_on_error = 0
log_connections = off
log_disconnections = off
CONF
if [[ "$changed" == *preview.conf* ]]; then run systemctl restart "postgresql@$PG_VERSION-main"; fi

echo "== 5. roles, database, extension"
psql_su -c "DO \$\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '$DEPLOY_USER') THEN
    CREATE ROLE \"$DEPLOY_USER\" LOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'preview_api') THEN
    CREATE ROLE preview_api LOGIN; END IF;
END \$\$"
# Read-only checks, also in a dry run, so that it says what the real run will do (on a
# machine without PostgreSQL, the database counts as absent).
database_exists() {
  sudo -n -u postgres psql -XAtc "SELECT 1 FROM pg_database WHERE datname = 'preview'" \
    2>/dev/null | grep -qx 1
}
if ! database_exists; then
  run sudo -u postgres createdb --owner "$DEPLOY_USER" preview
fi
psql_su -d preview -c "CREATE EXTENSION IF NOT EXISTS postgis"
psql_su -d preview -c "REVOKE CONNECT ON DATABASE preview FROM PUBLIC;
  GRANT CONNECT ON DATABASE preview TO preview_api, \"$DEPLOY_USER\";
  GRANT USAGE ON SCHEMA public TO preview_api;
  ALTER DEFAULT PRIVILEGES FOR ROLE \"$DEPLOY_USER\" IN SCHEMA public
    GRANT SELECT ON TABLES TO preview_api;"

echo "== 6. service user, folders, environment, unit"
if ! id preview_api >/dev/null 2>&1; then
  run useradd --system --no-create-home --shell /usr/sbin/nologin preview_api
fi
# deploy.sh swaps releases in DEPLOY_PATH and DEPLOY_PATH/api: both USER's; readable by all
# (Caddy serves DEPLOY_PATH/current, the API runs DEPLOY_PATH/api/current).
for d in "$DEPLOY_PATH" "$DEPLOY_PATH/releases" "$DEPLOY_PATH/api" "$DEPLOY_PATH/api/releases" \
  "$DEPLOY_PATH/api/python" "$DEPLOY_PATH/api/exports"; do
  user_dir "$d" 755
done
put /etc/preview-api.env 640 root:preview_api <<ENV
LACARTE_DSN=dbname=preview user=preview_api
ALLOWED_ORIGIN=https://$PREVIEW_HOST
ENV
put /etc/systemd/system/preview-api.service 644 root:root <<UNIT
[Unit]
Description=Site API (participation)
After=network.target postgresql.service
Requires=postgresql.service

[Service]
Type=simple
User=preview_api
Group=preview_api
EnvironmentFile=/etc/preview-api.env
# Sign in with OpenStreetMap, and the site settings (contributions open or not, the
# identity shown): written by deploy.sh (600, the deploy user's), read by the service
# manager as root before the sandbox; the leading dash: the API starts without them
# (sign-in off, its defaults).
EnvironmentFile=-$DEPLOY_PATH/api/osm.env
EnvironmentFile=-$DEPLOY_PATH/api/site.env
Environment=PYTHONPATH=$DEPLOY_PATH/api/current/pipeline
WorkingDirectory=$DEPLOY_PATH/api/current
# 127.0.0.1 only, behind Caddy; no proxy headers, no access log, no Server header.
ExecStart=$DEPLOY_PATH/api/current/.venv/bin/uvicorn lacarte.api.app:app --host 127.0.0.1 --port $API_PORT --workers 1 --no-proxy-headers --no-access-log --no-server-header --log-level warning
MemoryMax=768M
Restart=on-failure
RestartSec=2
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectKernelTunables=yes
ProtectControlGroups=yes
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6

[Install]
WantedBy=multi-user.target
UNIT
if [[ "$changed" == *preview-api.service* ]]; then run systemctl daemon-reload; fi
enabled preview-api.service || run systemctl enable preview-api.service

echo "== 7. sudoers: the deploy user restarts the API and reloads Caddy, nothing else"
put /etc/sudoers.d/preview-api 440 root:root <<SUDO
$DEPLOY_USER ALL=(root) NOPASSWD: /usr/bin/systemctl restart preview-api, /usr/bin/systemctl is-active preview-api, /usr/bin/systemctl reload caddy
SUDO
[ "$DRY" = 1 ] || visudo -cf /etc/sudoers.d/preview-api

echo "== 8. daily backup of the contributions, 14 days"
[ -d /var/backups/preview ] || run install -d -o postgres -g postgres -m 700 /var/backups/preview
put /usr/local/sbin/preview-backup 755 root:root <<'BACKUP'
#!/bin/sh
# Contributions and the accounts they point at (migration 014; never the sessions), what
# became of them on OpenStreetMap (016: publications, nodes; never the write tokens, which
# choosing to publish again recovers), the cameras kept off the map (018), the journal and
# the site's settings (020), the site's counters, by the hour too (021): the build's tables
# are reloaded at each deploy.
set -eu
out="/var/backups/preview/contributions-$(date +%F).dump"
pg_dump -Fc -d preview -t contributions -t accounts -t schema_migrations -t meta \
  -t osm_publications -t osm_nodes -t hidden_cameras -t admin_log -t site_settings \
  -t site_counters -t site_counters_month -t site_counters_hour -f "$out.tmp"
mv "$out.tmp" "$out"
find /var/backups/preview -name 'contributions-*.dump' -mtime +13 -delete
BACKUP
put /etc/systemd/system/preview-backup.service 644 root:root <<'UNIT'
[Unit]
Description=Backup of the site's contributions

[Service]
Type=oneshot
User=postgres
ExecStart=/usr/local/sbin/preview-backup
UNIT
put /etc/systemd/system/preview-backup.timer 644 root:root <<'UNIT'
[Unit]
Description=Daily backup of the site's contributions

[Timer]
OnCalendar=daily
RandomizedDelaySec=1h
Persistent=true

[Install]
WantedBy=timers.target
UNIT
if [[ "$changed" == *preview-backup* ]]; then run systemctl daemon-reload; fi
{ enabled preview-backup.timer && active preview-backup.timer; } ||
  run systemctl enable --now preview-backup.timer

echo "== 9. uv for $DEPLOY_USER (in its home)"
if ! sudo -n -u "$DEPLOY_USER" -H sh -c 'test -x "$HOME/.local/bin/uv"' 2>/dev/null; then
  echo "+ curl -LsSf https://astral.sh/uv/$UV_VERSION/install.sh | sudo -u $DEPLOY_USER -H env UV_NO_MODIFY_PATH=1 sh"
  [ "$DRY" = 1 ] || curl -LsSf "https://astral.sh/uv/$UV_VERSION/install.sh" |
    sudo -u "$DEPLOY_USER" -H env UV_NO_MODIFY_PATH=1 sh
fi

echo "== 10. firewall: ssh on $MAIN_IP, http and https on $BIND_IP, over IPv4"
# Debian loads /etc/nftables.conf at boot with nftables.service (wiki.debian.org/nftables).
# Accepting what answers a connection already open first: applying it never cuts a session.
# Each port on its own address (ip daddr: IPv4 only): a scanner of the site's address sees
# no ssh (the same host key would tie it to the main address), the main one no site.
put /etc/nftables.conf 755 root:root <<NFT
#!/usr/sbin/nft -f
# Written by bootstrap.sh. In: ssh on the main address, http and https (tcp; udp 443 for
# HTTP/3) on the site's, over IPv4, ping, and what answers a connection already open;
# nothing over IPv6. Out: everything.
flush ruleset

table inet filter {
	chain input {
		type filter hook input priority filter; policy drop;
		iif "lo" accept
		ct state established,related accept
		ct state invalid drop
		meta nfproto ipv4 icmp type { echo-request, destination-unreachable, time-exceeded } accept
		ip daddr $MAIN_IP tcp dport 22 accept
		ip daddr $BIND_IP tcp dport { 80, 443 } accept
		ip daddr $BIND_IP udp dport 443 accept
	}
	chain forward {
		type filter hook forward priority filter; policy drop;
	}
	chain output {
		type filter hook output priority filter; policy accept;
	}
}
NFT
if [ "$DRY" = 0 ]; then nft -c -f /etc/nftables.conf && echo "nftables.conf: syntax checked"; fi
if [ "$CONTAINER" = 1 ]; then
  echo "firewall: written, not applied here (container)"
else
  enabled nftables.service || run systemctl enable nftables.service
  if ! active nftables.service; then
    run systemctl start nftables.service
  elif [[ "$changed" == */etc/nftables.conf* ]]; then
    run systemctl reload nftables.service
  fi
fi

echo "== 11. IPv6 off; addresses bound before they are configured"
# sshd listens on the main address alone (step 13): started at boot before that address is
# configured, it stops for good (« Cannot bind any address », exit 255, which ssh.service
# does not restart, RestartPreventExitStatus=255; seen on Debian 13). Binding an address not
# configured yet is allowed (ip_nonlocal_bind, the kernel's ip-sysctl documentation).
BIND=/etc/sysctl.d/91-nonlocal-bind.conf
put "$BIND" 644 root:root <<'SYSCTL'
# Written by bootstrap.sh: sshd (ListenAddress) and Caddy (default_bind) start even before
# their address is configured.
net.ipv4.ip_nonlocal_bind = 1
SYSCTL
if [ "$CONTAINER" = 1 ]; then
  echo "nonlocal bind: written, not applied here (container)"
elif [ "$(cat /proc/sys/net/ipv4/ip_nonlocal_bind 2>/dev/null || echo 1)" != 1 ]; then
  run /usr/lib/systemd/systemd-sysctl "$BIND"
fi
SYSCTL=/etc/sysctl.d/90-ipv6-off.conf
put "$SYSCTL" 644 root:root <<'SYSCTL'
# Written by bootstrap.sh: no IPv6 (the site is served over IPv4 only).
net.ipv6.conf.all.disable_ipv6 = 1
net.ipv6.conf.default.disable_ipv6 = 1
SYSCTL
if [ "$CONTAINER" = 1 ]; then
  echo "IPv6: written, not applied here (container)"
elif [ "$(cat /proc/sys/net/ipv6/conf/all/disable_ipv6 2>/dev/null || echo 1)" != 1 ]; then
  if [ -n "$(ss -H -6 -tn state established '( sport = :22 )' 2>/dev/null)" ]; then
    echo "IPv6: written, not applied: an ssh session runs over IPv6 and would be cut;" \
      "reconnect over IPv4 and run again (or reboot)"
  else
    run /usr/lib/systemd/systemd-sysctl "$SYSCTL"
  fi
fi

echo "== 12. security updates, every day"
# What `dpkg-reconfigure unattended-upgrades` writes (wiki.debian.org/UnattendedUpgrades);
# the timers are apt-daily(-upgrade).timer. Debian-Security only: the distribution's default
# (50unattended-upgrades) also takes the point releases.
put /etc/apt/apt.conf.d/20auto-upgrades 644 root:root <<'APT'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT
put /etc/apt/apt.conf.d/52unattended-upgrades-local 644 root:root <<'APT'
// Written by bootstrap.sh: security updates only (Caddy's repository is updated by hand).
#clear Unattended-Upgrade::Origins-Pattern;
Unattended-Upgrade::Origins-Pattern {
	"origin=Debian,codename=${distro_codename}-security,label=Debian-Security";
	"origin=Debian,codename=${distro_codename},label=Debian-Security";
};
APT
for t in apt-daily.timer apt-daily-upgrade.timer; do
  { enabled "$t" && active "$t"; } || run systemctl enable --now "$t"
done

echo "== 13. ssh: keys only, no root, IPv4 only, on $MAIN_IP only"
# Debian's sshd_config reads sshd_config.d/*.conf first, and the first value read wins:
# 10- comes before a cloud image's 50-cloud-init.conf.
DROPIN=/etc/ssh/sshd_config.d/10-keys-only.conf
has_keys() { [ -s "$1/.ssh/authorized_keys" ]; }
ADMIN_HOME=""
if [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != root ]; then
  ADMIN_HOME="$(getent passwd "$SUDO_USER" | cut -d: -f6)"
fi
if [ "$DRY" = 0 ] && ! has_keys "$HOME_DIR"; then
  echo "ssh: not written: $DEPLOY_USER has no key yet (--ssh-key)"
elif [ "$DRY" = 0 ] && [ -z "$ADMIN_HOME" ]; then
  # Run from a root session, not through sudo: whose key keeps the way in is unknown, and
  # « no root » would close the door this session came through.
  echo "ssh: not written: run through sudo from the account you sign in with (debian)"
elif [ "$DRY" = 0 ] && [ -n "$ADMIN_HOME" ] && ! has_keys "$ADMIN_HOME"; then
  echo "ssh: not written: $SUDO_USER, who runs this, signs in without a key"
else
  previous=""
  [ -f "$DROPIN" ] && previous="$(cat "$DROPIN")"
  # (ListenAddress adds up, wherever it is written: `sshd -T` must show this one alone. A
  # socket-activated ssh, ssh.socket, would ignore it: refused.)
  put "$DROPIN" 644 root:root <<SSHD
# Written by bootstrap.sh: sign-in by key only, never as root, over IPv4 only, on the
# server's main address only.
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
AddressFamily inet
ListenAddress $MAIN_IP
SSHD
  if [[ "$changed" == *"$DROPIN"* ]] && [ "$DRY" = 0 ]; then
    listen=""
    if /usr/sbin/sshd -t; then listen="$(/usr/sbin/sshd -T | grep '^listenaddress ' || true)"; fi
    if [ "$listen" != "listenaddress $MAIN_IP:22" ] || active ssh.socket; then
      # Never left behind: the next reload or boot would read it.
      if [ -n "$previous" ]; then printf '%s\n' "$previous" > "$DROPIN"; else rm -f "$DROPIN"; fi
      echo "ssh: refused (sshd -t, or listening on [$(echo $listen)] instead of $MAIN_IP:22," \
        "or ssh.socket active); the drop-in put back as it was" >&2
      exit 1
    fi
    echo "sshd -t: ok; sshd -T: $listen"
  fi
  if [[ "$changed" == *"$DROPIN"* ]] && active ssh; then
    run systemctl reload ssh
    # The reload re-executes sshd, which binds again (sshd(8), SIGHUP): wait to see it.
    for _ in $(seq 10); do
      seen="$(ss -H -4 -ltn '( sport = :22 )' | awk '{ print $4 }' | sort -u)"
      [ "$seen" = "$MAIN_IP:22" ] && break
      sleep 0.5
    done
    if [ "$seen" = "$MAIN_IP:22" ]; then
      echo "ssh listens on $MAIN_IP:22 only"
    else
      echo "WARNING: ssh listens on [$(echo $seen)], not $MAIN_IP:22 alone: keep this session" \
        "open and look (ss -ltn)" >&2
    fi
  fi
fi
if [ "$DRY" = 0 ]; then
  echo "Before closing this session, from a new window: ssh -4 $DEPLOY_USER@$MAIN_IP true &&" \
    "ssh -4 ${SUDO_USER:-debian}@$MAIN_IP true; and nc -z -w3 $BIND_IP 22 must fail."
fi

echo "done${changed:+; changed:$changed}"
