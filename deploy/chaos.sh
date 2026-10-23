#!/usr/bin/env bash
# Day 18: break VaultLab in one of eight ways, show only the "ticket", and undo it later.
#   sudo ./deploy/chaos.sh          inject a random fault (or: sudo ./deploy/chaos.sh 3)
#   sudo ./deploy/chaos.sh answer   show which fault is active (only after you've diagnosed it!)
#   sudo ./deploy/chaos.sh undo     put everything back
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "run with sudo"; exit 1; }

STATE=/root/.vaultlab-chaos
SAVE=/root/.vaultlab-chaos-files
ENV=/etc/vaultlab/api.env
SITE=/etc/nginx/sites-available/vaultlab
CERT=/etc/nginx/vaultlab/vaultlab.home.crt
KEY=/etc/nginx/vaultlab/vaultlab.home.key

ticket() { printf '\n  TICKET: "%s"\n\n' "$1"; }
reload_nginx() { nginx -t -q && systemctl reload nginx; sleep 1; }

inject() {
  case "$1" in
    1) systemctl stop vaultlab-api
       ticket "The VaultLab page opens, but my vault won't load." ;;
    2) systemctl stop mariadb
       ticket "I can't log in. It just says something went wrong." ;;
    3) cp -p "$ENV" "$SAVE/api.env"
       sed -i 's/^HOST=.*/HOST=127.0.0.2/' "$ENV"
       systemctl restart vaultlab-api
       ticket "The page loads, but nothing in it works. Nobody changed anything, I think." ;;
    4) mariadb -e "REVOKE SELECT ON vaultlab.* FROM 'vaultlab'@'localhost'"
       ticket "Nobody can log in since this morning. The error is the same for everyone." ;;
    5) ufw insert 1 deny proto tcp from any to any port 443 >/dev/null
       ticket "From my laptop VaultLab doesn't load at all, it just spins. Is the server down?" ;;
    6) cp -p "$CERT" "$SAVE/cert.crt"; cp -p "$KEY" "$SAVE/cert.key"
       openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -days 30 \
         -subj "/CN=vaultlab.home" -addext "subjectAltName=DNS:vaultlab.home" \
         -keyout "$KEY" -out "$CERT" 2>/dev/null
       reload_nginx
       ticket "My browser shows a big security warning when I open VaultLab. Should I click through?" ;;
    7) mariadb vaultlab -e "DELETE FROM sessions"
       ticket "Everyone was logged out at the same time. Were we hacked?" ;;
    8) cp -p "$SITE" "$SAVE/site"
       sed -i 's#proxy_pass http://127.0.0.1:3000;#proxy_pass http://127.0.0.1:3001;#' "$SITE"
       reload_nginx
       ticket "The page shows up, but every action fails. I restarted my browser already." ;;
    *) echo "unknown fault $1 (1-8)"; exit 1 ;;
  esac
}

undo() {
  case "$1" in
    1) systemctl start vaultlab-api ;;
    2) systemctl start mariadb; sleep 2; systemctl restart vaultlab-api ;;
    3) cp -p "$SAVE/api.env" "$ENV"; systemctl restart vaultlab-api ;;
    4) mariadb -e "GRANT SELECT ON vaultlab.* TO 'vaultlab'@'localhost'" ;;
    5) ufw delete deny proto tcp from any to any port 443 >/dev/null ;;
    6) cp -p "$SAVE/cert.crt" "$CERT"; cp -p "$SAVE/cert.key" "$KEY"; reload_nginx ;;
    7) echo "(nothing to undo: users simply log in again)" ;;
    8) cp -p "$SAVE/site" "$SITE"; reload_nginx ;;
  esac
}

describe() {
  case "$1" in
    1) echo "fault 1: the vaultlab-api service was stopped" ;;
    2) echo "fault 2: MariaDB was stopped" ;;
    3) echo "fault 3: HOST in /etc/vaultlab/api.env was changed to 127.0.0.2" ;;
    4) echo "fault 4: SELECT was revoked from the database user 'vaultlab'" ;;
    5) echo "fault 5: ufw rule 1 denies port 443 (the Dell itself isn't affected)" ;;
    6) echo "fault 6: nginx serves a self-signed certificate, not one from your CA" ;;
    7) echo "fault 7: every row in the sessions table was deleted" ;;
    8) echo "fault 8: nginx's proxy_pass points to port 3001" ;;
  esac
}

case "${1:-}" in
  __inject) inject "$2" ;;   # internal: run in a child process, so set -e stops at the first error
  __undo)   undo "$2" ;;
  undo)
    [ -f "$STATE" ] || { echo "no fault is active"; exit 0; }
    n=$(cat "$STATE")
    if "$0" __undo "$n"; then
      rm -f "$STATE"; rm -rf "$SAVE"; echo "fault $n undone"
    else
      echo "undo of fault $n FAILED: fix the error above, then run undo again"; exit 1
    fi ;;
  answer)
    [ -f "$STATE" ] && describe "$(cat "$STATE")" || echo "no fault is active" ;;
  *)
    [ ! -f "$STATE" ] || { echo "fault $(cat "$STATE") is still active: run undo first"; exit 1; }
    n=${1:-$(( RANDOM % 8 + 1 ))}
    rm -rf "$SAVE"; install -d -m 700 "$SAVE"
    echo "$n" > "$STATE"; chmod 600 "$STATE"
    if ! "$0" __inject "$n"; then
      echo "injecting fault $n FAILED part-way: undoing it"
      "$0" __undo "$n" || true
      rm -f "$STATE"; rm -rf "$SAVE"; exit 1
    fi ;;
esac
