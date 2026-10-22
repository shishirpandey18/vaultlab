#!/usr/bin/env bash
# Day 17: pull new encrypted VaultLab backups to this computer (the Mac).
# Append-only: never deletes or overwrites a copy that's already here.
set -euo pipefail

DEST="$HOME/vaultlab-offsite"
KEY="$HOME/.ssh/vaultlab_offsite"
SOURCE="vaultlab-offsite@vaultlab.home:"
KEEP_DAYS=90         # much longer than the Dell's 14 backups
MAX_AGE_HOURS=48     # warn if the newest copy here is older than this

# Homebrew's rsync 3 (Apple silicon, then Intel), not macOS's own
RSYNC=""
for candidate in /opt/homebrew/bin/rsync /usr/local/bin/rsync /usr/bin/rsync; do
  if [ -x "$candidate" ]; then RSYNC=$candidate; break; fi
done

mkdir -p "$DEST"
chmod 700 "$DEST"
echo "== $(date '+%Y-%m-%d %H:%M:%S') pulling with $RSYNC"

"$RSYNC" -a --ignore-existing --exclude '*.partial' --itemize-changes \
  -e "ssh -i $KEY -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=15" \
  "$SOURCE" "$DEST/"

# Local retention
find "$DEST" -name 'vaultlab-*.sql.gz.gpg' -mtime +"$KEEP_DAYS" -print -delete

newest=$(ls -1 "$DEST"/vaultlab-*.sql.gz.gpg | tail -1)   # the names sort by date
count=$(ls -1 "$DEST"/vaultlab-*.sql.gz.gpg | wc -l | tr -d ' ')
age_hours=$(( ($(date +%s) - $(date -r "$newest" +%s)) / 3600 ))
echo "== $count copies here; newest $(basename "$newest"), $age_hours h old"
if [ "$age_hours" -gt "$MAX_AGE_HOURS" ]; then
  echo "WARNING: the newest off-site copy is older than $MAX_AGE_HOURS hours"
  exit 1
fi
