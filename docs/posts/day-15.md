# Day 15: Encrypted backups and a restore drill

**Goal for today:** stop making backups by hand. Every night, a timer should make an encrypted backup of the database, using a user that can only read, to a key whose private half isn't on the server. Then prove it works by restoring one, and break the backup job in several ways to see which failures look like success.

**My setup:** Ubuntu 24.04 with MariaDB 10.11, GnuPG 2.4.4 and systemd 255. Everything below uses test accounts.

**This one took two days.(19 and 20 October)** The first evening went on the script, the service and the timer. The restore drill, the breaks and the notes went into the second day, mostly because the drill taught me something I hadn't planned for (see "What went wrong").

---

Until today, VaultLab's backups were files I made by hand when I remembered, stored on the same disk as the database, readable by anyone who could read that folder, and restored exactly once. Ask of that setup the questions every operations team gets asked: how old is the newest backup, is there a copy somewhere else, can someone who steals it read it, and has anyone tested it? My answers were "I don't know", "no", "partly" and "no".

## Lesson Learned: A backup you never restored is only a hope

Day 11 already showed me a backup that looked fine and wasn't restorable as `vaultlab`. Today I found two more ways a backup "succeeds" and contains nothing useful (below), and the only real proof was restoring one.

Two secrets matter now, and they do different jobs:

| | `VAULT_KEY` (Day 12) | Backup private key (today) |
| --- | --- | --- |
| Protects | each vault password inside the database | the whole backup file |
| Needed by | the running API, all the time | me, only when restoring |
| Lives | `/etc/vaultlab/api.env` and my safe copy | **not** on the server |

To restore a working vault I need both, plus the backup file and the key's passphrase. Lose any one of the four and the vault is gone.

## The key: encrypt to a public key

```bash
gpg --quick-gen-key "VaultLab Backups <backups@vaultlab.home>" future-default default 2y
```

That makes an ed25519 key for signing and certifying, and a cv25519 subkey for encryption. It expires in two years, so extending it will be the reminder to check that I still have everything. The point of a public key here: the server can **encrypt** backups with the public half (`/etc/vaultlab/backup-pub.asc`, mode 644), but it can never **decrypt** them. If the Dell is broken into, the attacker gets a folder of unreadable files. This is also the cryptography Passbolt is built on: an OpenPGP key pair, a passphrase on the private key, and secrets encrypted to the public key. "I forgot my passphrase" has the same answer there as here: without it, the data stays encrypted.

## A user that can only read

```sql
CREATE USER 'vaultlab-backup'@'localhost' IDENTIFIED VIA unix_socket;
GRANT SELECT, SHOW VIEW, TRIGGER, LOCK TABLES ON vaultlab.* TO 'vaultlab-backup'@'localhost';
```

`unix_socket` means MariaDB asks the kernel which Linux user is on the other end of the local socket, so the Linux user `vaultlab-backup` is let in as the database user `vaultlab-backup`. There is no password to store, leak or rotate. As that user, `mariadb-dump` works and `DELETE FROM sessions` is refused with `ERROR 1142 ... DELETE command denied`. A hijacked backup job can read but can't damage anything.

## The script

`deploy/vaultlab-backup.sh`, installed as `/usr/local/sbin/vaultlab-backup` (root-owned). The ideas:

- `set -euo pipefail`, and `umask 077`.
- A check before dumping: count the tables and rows the user can really see, and refuse if it's fewer than 3 tables.
- One pipeline, `mariadb-dump | gzip | gpg`, so the plain-text dump never exists on disk.
- Write to `.partial` and `mv` it only when complete, so an interrupted backup never looks like a good one.
- Log the counts. The line looks like `backup ok: .../vaultlab-<timestamp>.sql.gz.gpg (3372 bytes, 3 tables, 5 users, 12 items)`.
- Keep the newest 14 and delete older ones, only after a successful backup.

The result is mode 600, owned by `vaultlab-backup`. `file` calls it `data`, `grep -c 'INSERT INTO'` finds 0, and `gpg --list-packets` shows who it's for but ends with `decryption failed: No secret key`. Even root on the Dell can't read it.

## The service and the timer

The service is `Type=oneshot`, runs as `vaultlab-backup`, and is locked down harder than the API: `PrivateNetwork=true` and `RestrictAddressFamilies=AF_UNIX` mean no network at all (it reaches MariaDB through the socket file), `ProtectSystem=strict` with `ReadWritePaths=/var/backups/vaultlab` means it can only write to its own folder, and `MemoryDenyWriteExecute=true` is fine here, unlike for Node. `systemd-analyze security` gave it **2.1 OK**, better than the API's 2.8, mostly thanks to the missing network. There's no `Restart=` and no `[Install]`: a failed backup should be noticed, not silently retried.

The timer runs it at 03:30 with a random delay of up to 15 minutes, and `Persistent=true` so that if the Dell was off at 03:30 the backup runs at the next boot instead of skipping the night. After `enable --now` on the timer, `list-timers` showed the next run between 03:30 and 03:45.

## The restore drill

I took the newest backup, imported the private key into a **throwaway** keyring (`GNUPGHOME=$(mktemp -d)`), decrypted it and restored it into a separate database, never over the live one:

```text
-- Dump completed on <date and time of the backup>
restore: exit 0 0 0
live_items  restored_items
12          12
vaultlab.items           1208854858
vaultlab_restore.items   1208854858
```

`exit 0 0 0` is `PIPESTATUS`: gpg, gunzip and mariadb all succeeded. The counts match and so do the checksums, every row and every byte. And for a password manager rows aren't enough, so I ran the Day 12 vault check against the restored copy:

```text
12 of 12 item(s) decrypt with this key
```

That's the complete proof. My recovery time (how long the restore takes) was about 2 seconds for this tiny database, and my recovery point (how much I could lose) is up to a day, because the backups are nightly.

## What went wrong on the way

**I lost the private key.** I'm glad this happened in a lab. The guide said to copy the exported key to the Mac and then delete it from the Dell. I ran the `scp` on the Dell itself, not on the Mac. `vaultlab.home` points at `127.0.0.1`, so the "copy" went from my home folder to my home folder. Then I ran `gpg --delete-secret-keys` and `shred -u` as a block; the delete was cancelled by the passphrase prompt, but the `shred` right after it ran anyway and destroyed the exported file. The next try deleted the key from the keyring too. I searched the whole disk: there was no copy anywhere, so the two backups I had were unreadable forever.

The fix was a new key, a new public key on the server, a copy on a USB stick I formatted for this, a restore drill **from the USB copy**, and only then deleting the private key from the Dell. Lessons: a copy only counts if it exists on another device and I've opened it from there, run delete and shred as separate commands, and never put two destructive steps in the same paste.

## Break and fix

I did the breaks one at a time and undid each. I ran Parts 3 to 6 on my machine under a temporary passwordless-sudo rule that I added and removed myself, and wrote the repo files.

**1. The backup user loses its permission.** I revoked `SELECT`. The check at the top caught it:

```text
ERROR 1142 (42000) at line 1: SELECT command denied to user 'vaultlab-backup'@'localhost' for table `vaultlab`.`users`
```

The service failed and no file was written. Then I removed the check from the installed script and ran it again:

```text
backup ok: .../vaultlab-<timestamp>.sql.gz.gpg (1172 bytes, ? tables, ? users, ? items)
exit 0
```

A backup a third of the normal size, reporting success. Without `SELECT` the user can't even see the tables, so `mariadb-dump` dumps an empty database and exits 0. Every night would "succeed", retention would delete a good backup each night, and after two weeks every backup would be empty.

**2. A pipeline without `pipefail`.** I misspelled the database name in the dump line (`vaultlb`). With `pipefail` the service failed. With `set -eu` it printed:

```text
mariadb-dump: Got error: 1044: "Access denied for user 'vaultlab-backup'@'localhost' to database 'vaultlb'" when selecting the database
backup ok: .../vaultlab-<timestamp>.sql.gz.gpg (560 bytes, 3 tables, 5 users, 12 items)
```

The dump failed, and the script still said `backup ok`, kept a file of nothing, and would delete a good old one. Without `pipefail` a pipeline's exit status is the last command's, and gpg happily encrypted an empty stream.

**3. Enabling the wrong unit.** `systemctl enable vaultlab-backup.service` answered `The unit files have no installation config (WantedBy=, ...)` and `list-timers` showed `0 timers listed`. I'd "enabled the backup" and nothing would ever run. The classic reason a scheduled job never ran.

**4. The public key is missing.** I moved `backup-pub.asc`. The service failed, and there were 0 `.partial` files left, because the `trap` cleaned up.

**5. A damaged backup.** On a copy, a file cut short gave `gpg: block_filter: pending bytes!` and `gzip: stdin: unexpected end of file`, exit `2 1`. With one flipped byte, `gunzip -t` said `not in gzip format`. Damage is only detected when someone reads the file, which is one more reason to run a drill regularly.

**6. No key or the wrong passphrase.** Without the private key, `gpg: decryption failed: No secret key`. My try with a wrong passphrase didn't show `Bad passphrase` because gpg's agent still had the right one cached from the step before, so that one is only half tested.

Afterwards: the installed script matches the repo, `SELECT` is granted back, and no empty or partial backups remain.

## The table to keep

| What I see | Means | First step |
| --- | --- | --- |
| `backup ok` but a much smaller file | An empty or partial dump that "succeeded" | Check the permissions and the dump; restore-test the newest |
| An error line, then `backup ok` | A pipeline without `pipefail` | `set -euo pipefail` |
| `SELECT command denied`, `Access denied ... to database` | Lost permission or a wrong name | `SHOW GRANTS`, then the script |
| `0 timers listed`, `no installation config` | The service was enabled instead of the timer | `enable --now` the timer |
| `encryption failed: No public key` | The public key file is missing | `/etc/vaultlab/backup-pub.asc` |
| `decryption failed: No secret key` | I'm not holding the private key | Import it from a safe copy |
| `Bad passphrase` | Wrong passphrase | The password manager; there's no reset |
| `unexpected end of file`, `invalid packet` | A damaged file | Use the previous backup |

## Commands I used today

```bash
# Key
gpg --quick-gen-key "VaultLab Backups <backups@vaultlab.home>" future-default default 2y
gpg --armor --export "VaultLab Backups" > ~/vaultlab-backup-pub.asc
gpg --armor --export-secret-keys "VaultLab Backups" > ~/vaultlab-backup-SECRET.asc
gpg --show-keys ~/vaultlab-backup-SECRET.asc

# Backup job
sudo runuser -u vaultlab-backup -- /usr/local/sbin/vaultlab-backup
systemctl list-timers vaultlab-backup.timer --no-pager
sudo journalctl -u vaultlab-backup -n 5 --no-pager
systemd-analyze calendar --iterations=3 '*-*-* 03:30:00'

# Restore drill
export GNUPGHOME=$(mktemp -d)
gpg --decrypt backup.sql.gz.gpg | gunzip | sudo mariadb vaultlab_restore
sudo mariadb -e "CHECKSUM TABLE vaultlab.items, vaultlab_restore.items"
gunzip -t        # quick integrity check, writes nothing
```

## Security things I noticed

- The server can encrypt backups but not read them: that's the whole point of a public key.
- The backup user has no password and can't write to the database. `unix_socket` only works through the local socket on this machine.
- The backup service has no network.
- A key that exists in one place is a lost key waiting to happen. A copy only counts after I've opened it from another device.
- Exit code 0 isn't proof. Size, row counts and a restore of the newest backup are.

## Not done yet

All backups still live on the Dell's disk, so this isn't 3-2-1 yet. The next steps are an off-site copy of the encrypted files (the other machine pulling them over SSH, which is safe because they're encrypted), a second copy of the key, and monitoring so a failed backup tells me instead of waiting for me to look.

## Reflection

**What did I learn?**
How to make backups that the server can create but not read, how a restore drill proves them, and that the dangerous failures are the ones that report success.

**What did I struggle with?**
The two keys (backup key and `VAULT_KEY`), and keeping the steps of a key copy straight enough not to destroy the only copy.

**What did I understand better after practising?**
What `pipefail` does, why a oneshot service needs its timer enabled and not itself, and why a backup is only real after a restore.

**What should I review next?**
Off-site copies, key rotation before the expiry date, and alerts when the backup job fails.

**What can I demonstrate now that I couldn't before?**
I can run an encrypted, least-privilege nightly backup, restore it into a separate database, prove it with checksums and the vault check, and diagnose a backup that fails or silently contains nothing.
