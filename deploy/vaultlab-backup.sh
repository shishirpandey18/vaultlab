#!/usr/bin/env bash
# Day 15: dump the vaultlab database, compress it, encrypt it to the backup PUBLIC key,
# and keep only the newest $KEEP backups. Runs as the vaultlab-backup user (systemd timer).
# The server can make backups but can't read them: the private key isn't on it.
set -euo pipefail
umask 077

BACKUP_DIR=/var/backups/vaultlab
PUBKEY=/etc/vaultlab/backup-pub.asc
KEEP=14

stamp=$(date +%Y%m%d-%H%M%S)
final="$BACKUP_DIR/vaultlab-$stamp.sql.gz.gpg"
partial="$final.partial"
gpghome=$(mktemp -d)
trap 'rm -rf "$gpghome" "$partial"' EXIT

# Before dumping: can we really see the data? A user without SELECT gets an EMPTY dump that "succeeds".
read -r tables users items < <(mariadb -N -B -e "SELECT
  (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'vaultlab'),
  (SELECT COUNT(*) FROM vaultlab.users),
  (SELECT COUNT(*) FROM vaultlab.items)")
if [ "$tables" -lt 3 ]; then
  echo "refusing: only $tables table(s) visible in vaultlab" >&2
  exit 1
fi

# One pipeline: the plain-text dump only ever exists in memory, never on disk
mariadb-dump --single-transaction --skip-add-locks --no-tablespaces vaultlab \
  | gzip -9 \
  | gpg --homedir "$gpghome" --batch --no-tty --quiet --encrypt --recipient-file "$PUBKEY" --output "$partial"

# Only a complete file gets the real name
mv "$partial" "$final"
echo "backup ok: $final ($(stat -c %s "$final") bytes, $tables tables, $users users, $items items)"

# Keep the newest $KEEP, delete the rest
mapfile -t old < <(ls -1t "$BACKUP_DIR"/vaultlab-*.sql.gz.gpg | tail -n +$((KEEP + 1)))
for f in "${old[@]}"; do
  rm -- "$f"
  echo "deleted old backup: $f"
done
