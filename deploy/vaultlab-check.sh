#!/usr/bin/env bash
# Day 16: check VaultLab from the outside in. One line per check; exit 1 if anything is wrong.
# Sends a notification only when the overall state CHANGES (OK -> PROBLEM, PROBLEM -> OK).
set -uo pipefail   # no -e on purpose: one failing check must not stop the others

HOST=vaultlab.home
CA=/etc/vaultlab/ca.crt
CERT_MIN_DAYS=21       # warn three weeks before the certificate expires
BACKUP_MAX_HOURS=26    # nightly backup, plus some slack
DISK_MAX_PERCENT=90
STATE_FILE=${STATE_DIRECTORY:-/var/lib/vaultlab-check}/state
NTFY_URL=${NTFY_URL:-}   # optional, from /etc/vaultlab/monitor.env

problems=()
ok()  { echo "OK      $*"; }
bad() { echo "PROBLEM $*"; problems+=("$*"); }

# 1. One request through everything: DNS, TLS, nginx, Node and the database
out=$(curl -sS --max-time 10 --cacert "$CA" -o /dev/null -w '%{http_code}' "https://$HOST/api/health" 2>&1)
if [ "$out" = 200 ]; then ok "health: 200"; else bad "health: ${out//$'\n'/ }"; fi

# 2. The certificate nginx is serving right now, not the file on disk
end=$(echo | openssl s_client -connect "$HOST:443" -servername "$HOST" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)
if [ -z "$end" ]; then
  bad "certificate: could not read it from $HOST:443"
else
  days=$(( ($(date -d "$end" +%s) - $(date +%s)) / 86400 ))
  if [ "$days" -ge "$CERT_MIN_DAYS" ]; then ok "certificate: $days days left"; else bad "certificate: expires in $days days ($end)"; fi
fi

# 3. The services systemd runs for us
for unit in vaultlab-api nginx mariadb; do
  state=$(systemctl is-active "$unit" 2>&1)
  if [ "$state" = active ]; then ok "$unit: active"; else bad "$unit: $state"; fi
done

# 4. Last night's backup: did the last run succeed, and when did it end?
result=$(systemctl show -p Result --value vaultlab-backup.service 2>&1)
ended=$(systemctl show --timestamp=unix -p ExecMainExitTimestamp --value vaultlab-backup.service 2>&1)
if [ -z "$ended" ] || [ "${ended#@}" = "$ended" ]; then
  bad "backup: no finished run recorded"
else
  hours=$(( ($(date +%s) - ${ended#@}) / 3600 ))
  if [ "$result" != success ]; then bad "backup: last run $hours h ago ended with '$result'"
  elif [ "$hours" -gt "$BACKUP_MAX_HOURS" ]; then bad "backup: last success $hours h ago"
  else ok "backup: last success $hours h ago"; fi
fi

# 5. Disk space (a full disk breaks the database, the logs and the backups at once)
used=$(df --output=pcent / | tail -1 | tr -dc '0-9')
if [ "$used" -lt "$DISK_MAX_PERCENT" ]; then ok "disk: ${used}% used"; else bad "disk: ${used}% used"; fi

# 6. Anything else systemd considers failed
failed=$(systemctl list-units --state=failed --plain --no-legend 2>/dev/null | awk '{print $1}' | paste -sd ' ')
if [ -z "$failed" ]; then ok "failed units: none"; else bad "failed units: $failed"; fi

# Compare with the previous run, and notify only on a change
if [ ${#problems[@]} -eq 0 ]; then state=OK; else state=PROBLEM; fi
previous=$(cat "$STATE_FILE" 2>/dev/null || echo UNKNOWN)
echo "$state" > "$STATE_FILE"
if [ "$state" != "$previous" ]; then
  echo "state changed: $previous -> $state"
  if [ "$state" = OK ]; then message="All checks OK"; else message=$(printf '%s\n' "${problems[@]}"); fi
  if [ -n "$NTFY_URL" ]; then
    if curl -sS --max-time 10 -H "Title: VaultLab $state" -d "$message" "$NTFY_URL" >/dev/null; then
      echo "notification sent"
    else
      echo "notification FAILED"
    fi
  fi
fi

[ "$state" = OK ]
