# Day 17: Off-site backups over restricted SSH

**Goal for today:** the encrypted backups from Day 15 sit on the same disk as the database. A dead disk, a stolen laptop or someone with root on the Dell takes the data and its backups together. Today a second machine pulls copies every day over SSH, with a key that can do exactly one thing: read the backup folder.

**My setup:** Ubuntu 24.04, OpenSSH, rsync 3.2.7, the backup timer from Day 15.

**What I ran:** the Dell side, the Mac side (Homebrew rsync, the restricted key, a `launchd` job) and a check that an off-site copy decrypts. Break and fix: Break 1 run and recorded, Breaks 5 and 6 as written runbooks, Breaks 2 to 4 not recorded.

---

## Lesson Learned: Pull, append-only, encrypted

Three design decisions, each with a reason:

1. **Pull, don't push.** If the Dell pushed to the Mac, the Dell would hold a key that can write there, and whoever takes over the Dell could delete or encrypt the off-site copies too (ransomware does exactly this). With a pull, the Mac holds the key and logs in to the Dell. A compromised server can't touch its own off-site copies.
2. **Append-only.** No `--delete`, because the Dell removes old backups after 14 days and the off-site copy should keep them longer. And `--ignore-existing`, so a file that is already off-site is never fetched again. If someone overwrites last week's backup on the Dell, the off-site copy stays as it was.
3. **Only encrypted files leave the Dell.** The files are already encrypted to the backup key (Day 15), so wherever they end up doesn't have to be trusted.

An unattended pull can't use a passphrase, so the key itself is the risk. The answer is to limit what the key can do, until stealing it is nearly worthless:

| Limit | Where | Effect |
| --- | --- | --- |
| Its own user `vaultlab-offsite` | Dell | not my account, no sudo |
| `command="rrsync -ro ..."` and `ForceCommand` | `authorized_keys`, sshd | whatever the client asks for, only read-only rsync of one folder runs |
| `restrict` | `authorized_keys` | no terminal, no port forwarding, no agent forwarding |
| `from="..."` | `authorized_keys` | the key only works from one network |
| Group read on the backups only | file permissions | can read the encrypted files, nothing else |

## Step 1: Let a group read the backups

The folder was 700 and the files 600. One line in the backup script changes (`umask 027`) and one in the service (`UMask=0027`), then I installed both and fixed the existing files with `chmod 750` on the folder and `chmod 640` on the `.gpg` files. After a fresh backup:

```text
-rw-r----- 1 vaultlab-backup vaultlab-backup 3372 Oct 22 21:51 vaultlab-20261022-215103.sql.gz.gpg
-rw-r----- 1 vaultlab-backup vaultlab-backup 3373 Oct 22 22:26 vaultlab-20261022-222629.sql.gz.gpg
-rw-r----- 1 vaultlab-backup vaultlab-backup 3373 Oct 22 22:36 vaultlab-20261022-223634.sql.gz.gpg
drwxr-x--- 2 vaultlab-backup vaultlab-backup 4096 Oct 22 22:36 /var/backups/vaultlab
```

The new backup is 640 as well, so the umask change works. Still nothing for "others".

## Step 2: The puller user

```text
uid=993(vaultlab-offsite) gid=980(vaultlab-offsite) groups=980(vaultlab-offsite),982(vaultlab-backup)
vaultlab-offsite:!
```

- **A home folder this time** (in `/var/lib`), because SSH looks for `~/.ssh/authorized_keys`.
- **A real shell (`/bin/sh`), not `nologin`.** SSH runs the forced command through the user's shell, so with `nologin` even the allowed rsync would be refused. The restrictions are what stop it being used as a shell.
- **`!` in `/etc/shadow`** means no password exists, so only the key can work.
- **Group `vaultlab-backup`** is how it reads the 640 files.

## Step 3: sshd rules for this user

A `Match User vaultlab-offsite` block in `/etc/ssh/sshd_config.d/` turns off passwords, keyboard-interactive, TCP and agent forwarding, X11 and the terminal, and sets `ForceCommand /usr/bin/rrsync -ro /var/backups/vaultlab/`. The block ends with `Match all`, so nothing after it is affected. I checked it before reloading, like `nginx -t`:

```text
syntax ok
passwordauthentication no
permittty no
allowtcpforwarding no
forcecommand /usr/bin/rrsync -ro /var/backups/vaultlab/
authenticationmethods publickey
```

and for my own user, with `sshd -T -C user=...`:

```text
permittty yes
forcecommand none
```

`sshd -T -C` prints the effective settings for a given user and address, the best way to check a `Match` block without logging in. There was no `AllowUsers` line in this setup. If there is one, the new user has to be added to it or sshd refuses it before anything else.

I ran Part 2 as a script with `sudo`.

## Step 4: A key that can only fetch

On the Mac, Homebrew's rsync (not macOS's own, which is either 2.6.9 or `openrsync` and may disagree with `rrsync`):

```text
rsync  version 3.5.2  protocol version 33
```

The key is made on the Mac with no passphrase, on purpose, because nobody is there to type it at 09:15: `ssh-keygen -t ed25519 -N '' -C 'vaultlab-offsite@mac' -f ~/.ssh/vaultlab_offsite`. Its public half goes on the Dell with the limits in front of it (the Mac's address was in `192.168.178.0/24`, so the guide's subnet was right):

```text
restrict,from="192.168.178.0/24",command="/usr/bin/rrsync -ro /var/backups/vaultlab/" ssh-ed25519 AAAAC3Nz...
```

Before the real key I tested the same limits from the Dell itself, over `127.0.0.1` with a throwaway key whose line said `from="127.0.0.1,::1"`. Every result matched what the Mac gave later, and I removed that line when the real key went in.

**First pull on the Mac.** The Mac asked me to trust the host `vaultlab.home`. It already knew that same key under the Dell's IP address in `known_hosts`, so I accepted:

```text
receiving incremental file list
./
vaultlab-20261022-215103.sql.gz.gpg
vaultlab-20261022-222629.sql.gz.gpg
vaultlab-20261022-223634.sql.gz.gpg

sent 99 bytes  received 10,443 bytes
total size is 10,118  speedup is 0.96
```

**Second pull:** no file names, nothing re-sent (`sent 35 bytes  received 189 bytes`, speedup 45.17).

## Step 5: Prove the limits

Everything a thief with this key would try, from the Mac:

```text
/usr/bin/rrsync error: SSH_ORIGINAL_COMMAND does not run rsync
PTY allocation request failed on channel 0
/usr/bin/rrsync error: sending to read-only server is not allowed
/usr/bin/rrsync error: do not use .. in arg (anchor the path at the root of your restricted dir)
/usr/bin/rrsync error: option --remove-source-files has been disabled on this server.
channel 2: open failed: administratively prohibited: open failed
```

| Attempt | Blocked by |
| --- | --- |
| Run a command (`id`, read files) | `command=` / `ForceCommand` |
| Get a terminal | `restrict`, `PermitTTY no` |
| Upload a file | `rrsync -ro` |
| Read outside the backup folder | `rrsync`: no `..` |
| Delete the backups on the Dell | `rrsync -ro` disables every remove option |
| Tunnel into MariaDB (port 3306) | `restrict`, `AllowTcpForwarding no` |

What's left for a thief: copying encrypted files they can't open, from the home network only.

**The first run of three of these was wrong, and the proof was fake.** The guide is written for bash, but the Mac uses zsh, and zsh doesn't split `$K` (`-i key -o IdentitiesOnly=yes`) into separate words. So `ssh $K ...` took the whole string as one identity file name and printed `Identity file ... not accessible` and `Permission denied (publickey)`. That looks like a refusal and isn't one: no key was even offered. The rsync attempts worked only because `-e "ssh $K"` hands the string to rsync, which splits it. I re-ran the three with the options written out, and then they gave the real `rrsync` and `PTY` messages above.

**A second false alarm** (on the Dell test): the guide's `nc -z` check printed "port open" for the tunnel. That only shows the local listener that `ssh -L` opens on my own machine. The refusal comes from the Dell once something uses the tunnel, which is the `channel 2: open failed` line. Checking the port isn't a proof; that line is.

## Step 6: Daily pulls with launchd

`deploy/pull-backups.sh` pulls append-only, keeps 90 days locally, uses `BatchMode=yes` and `ConnectTimeout=15` so an unattended run fails instead of hanging, and warns when the newest copy is older than 48 hours. Run by hand:

```text
== 2026-10-22 23:17:18 pulling with /opt/homebrew/bin/rsync
.d...p..... ./
== 3 copies here; newest vaultlab-20261022-223634.sql.gz.gpg, 0 h old
```

The `launchd` agent runs it at 09:15 every day, after the Dell's 03:30 backup:

```text
plutil: OK
== 2026-10-22 23:17:26 pulling with /opt/homebrew/bin/rsync
.d...p..... ./
== 3 copies here; newest vaultlab-20261022-223634.sql.gz.gpg, 0 h old
state = not running
last exit code = 0
```

`state = not running` is normal for a job that runs once a day: launchd starts it at 09:15 and kickstart ran it once for the test. The plist has my username in it, so it lives only on the Mac.

**The Mac's repo had a different history.** `git pull` on the Mac produced 11 conflicts: that folder held 20 unrelated local commits against 31 on GitHub. I didn't merge them. The Mac session aborted the merge, saved the 20 local commits on a branch (`backup/local-before-reset`), and then ran `git reset --hard origin/main`. After that, the pull script on the Mac was byte-for-byte the committed one (same `git hash-object` as the commit). One thing to remember: the `launchd` job runs the script straight from the repo, so a later `git pull` that changes `deploy/pull-backups.sh` changes what runs every morning.

## Step 7: Prove an off-site copy opens

A copy I've never opened is only a hope. The backup key lived on a pendrive that I couldn't plug into the Mac, so my first decrypt ran on the Dell. The Mac's copy and the Dell's original have the same SHA-256, so decrypting the original proves what is in the off-site copy:

```text
Mac:   4434c404...98dee6  (the newest off-site copy)
Dell:  4434c404...98dee6  (the original in /var/backups/vaultlab)
```

**I had forgotten the passphrase.** The key was the right one (the file was encrypted to `VaultLab Backups <backups@vaultlab.home>`), but gpg said:

```text
gpg: public key decryption failed: Bad passphrase
gpg: decryption failed: Bad passphrase
```

There is no reset. The only backups were three test backups from that day, so the cost was small: I made a new key in a throwaway keyring, put its public half on the Dell as `/etc/vaultlab/backup-pub.asc`, put the private half on the pendrive under a new name, and took a fresh backup. The old three can never be opened. The new one:

```text
decrypts and decompresses: OK
-- Dump completed on 2026-10-22 23:33:23
```

Then the Mac pulled it, and the two hashes matched again (`cb90ab37...c3aa3f` on both sides):

```text
== 2026-10-22 23:34:15 pulling with /opt/homebrew/bin/rsync
.d..tp..... ./
>f+++++++++ vaultlab-20261022-233323.sql.gz.gpg
== 4 copies here; newest vaultlab-20261022-233323.sql.gz.gpg, 0 h old
```

`>f+++++++++` is a new file; the three older copies were left as they were. **Then on the Mac itself.** To open the off-site copy where it actually lives, the new private key had to get to the Mac. I sent the key file to myself by Gmail, which is a compromise: the file is protected only by its passphrase, so the passphrase has to be long, and the email and the downloaded copy have to be deleted afterwards (I deleted the file from Downloads and the mail from Inbox, Sent and Trash). In a throwaway keyring on the Mac:

```text
gpg: key ...: secret key imported
.../vaultlab-offsite/vaultlab-20261022-233323.sql.gz.gpg
gpg: encrypted with cv25519 key, ID 9CF8EA279165AF7D, created 2026-10-22
decrypts and decompresses: OK
-- Dump completed on 2026-10-22 23:33:23
```

That closes the chain: made on the Dell, encrypted there, pulled over the restricted key, and opened on the Mac with a key that was never on the Dell. One thing I noticed in `~/Downloads`: the old key file was there too. The three older copies can only be opened with that old key, so the old key and its (forgotten) passphrase are the only way to them. Two things I noticed about the new key: its revocation certificate was made inside the throwaway keyring and deleted with it, and the pendrive's filesystem ignores `chmod`, so the key file is readable by anyone who holds the pendrive. Only the passphrase protects it, so it needs to be a strong one, saved in my password manager *before* the key is made.

## Break and fix

**Break 1: someone overwrites a backup on the Dell (run, with output).** On the Dell I replaced the oldest backup with the word `RANSOMWARE`, after saving the original:

```text
overwrote: /var/backups/vaultlab/vaultlab-20261022-215103.sql.gz.gpg
-rw-r----- 1 vaultlab-backup vaultlab-backup 11 Oct 22 23:48 /var/backups/vaultlab/vaultlab-20261022-215103.sql.gz.gpg
```

On the Mac, a dry run (`rsync -an --itemize-changes`, no `--ignore-existing`) shows what a plain mirror would do:

```text
>f.st...... vaultlab-20261022-215103.sql.gz.gpg
```

A mirror would copy `RANSOMWARE` over my good copy (the size and time both changed). The real pull, with `--ignore-existing`:

```text
== 4 copies here; newest vaultlab-20261022-233323.sql.gz.gpg, 0 h old
```

No `>` line: nothing was fetched. The first bytes of the Mac's copy, from `head -c 12 ... | od -c`, are binary and not `R A N S O M W A R E`:

```text
0000000 204 ^ 003 ~ 207 235 216 ] ...
```

`84` is the start of a GPG "encrypted to a public key" packet, and the key ID in the next bytes was the old backup key. So the copy is untouched. I restored the Dell's file afterwards (3372 bytes again, with its original time and permissions). The lesson: an off-site copy that blindly mirrors the source copies the damage too. Append-only is what makes it a backup rather than a second copy of whatever just happened.

**Breaks 2 to 4: not recorded.** I set up the exercises (the key from a network it isn't allowed on, a new backup with `umask 077` that the puller can't read, and the Dell off the network) but I didn't keep the output, so I'm not claiming results. What each should show, from the guide, so I know what to look for when I repeat them:

| Break | Expected | Where to look |
| --- | --- | --- |
| 2: `from=` set to another network | `Permission denied (publickey)` on the Mac; a "not from a permitted host" line in `journalctl -u ssh` | the Dell's journal |
| 3: a 600 backup | `Permission denied (13)`, rsync code 23, `set -e` stops the script | `ls -l` on the Dell; the script's umask |
| 4: the Dell unreachable | `Operation timed out` after 15 s, code 255; after 48 hours the age warning | is the Dell on the network? |

**Break 5: the Mac is stolen (runbook).** Revoke in this order:
1. The off-site key: delete its line from `/var/lib/vaultlab-offsite/.ssh/authorized_keys` on the Dell. From that second, the stolen key gets `Permission denied (publickey)`.
2. My own SSH key from the Mac: its line in `~/.ssh/authorized_keys` on the Dell.
3. The backup key: the thief has the encrypted copies and maybe the private key, but not the passphrase. To be safe, make a new key, put its public half on the Dell, and use it from the next backup. Old copies still need the old key.
4. The VaultLab CA isn't at risk (its private key never left the Dell), but the Mac trusted it.

**Break 6: "REMOTE HOST IDENTIFICATION HAS CHANGED" (on paper).** A reinstalled Dell gets new SSH host keys, and the next pull fails with this warning. It means either "the server was reinstalled" or "someone is pretending to be it". Never delete the old key blindly: check the new fingerprint on the Dell (`ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`), and only then `ssh-keygen -R vaultlab.home` on the Mac and connect once by hand to accept it. `BatchMode=yes` makes the unattended job fail instead of asking.

## The table to keep

| What you see | Means | First step |
| --- | --- | --- |
| `rrsync error: ...` | the key tried something outside "read-only rsync of one folder" | working as designed; check what tried it |
| `Permission denied (publickey)` | key refused: wrong key, `from=` mismatch, revoked, or (in zsh) `$K` not split | check the command, then `journalctl -u ssh` on the Dell |
| `Permission denied (13)`, code 23 | a backup file the puller can't read | `ls -l` on the Dell: 640? The script's umask |
| `Operation timed out`, code 255 | the Dell is unreachable | is it on, on the network? |
| `WARNING: ... older than 48 hours` | pulls or backups stopped days ago | the pull log, then the Dell's `list-timers` |
| `REMOTE HOST IDENTIFICATION HAS CHANGED` | new host key: reinstall, or an impostor | verify the fingerprint before anything else |
| `gpg: Bad passphrase` | wrong passphrase, and there is no reset | the password manager; otherwise a new key |

## Commands I used today

```bash
sudo install -m 755 -o root -g root deploy/vaultlab-backup.sh /usr/local/sbin/vaultlab-backup
sudo chmod 750 /var/backups/vaultlab
sudo useradd --system --create-home --home-dir /var/lib/vaultlab-offsite --shell /bin/sh vaultlab-offsite
sudo usermod -aG vaultlab-backup vaultlab-offsite
sudo sshd -t && echo "syntax ok"
sudo sshd -T -C user=vaultlab-offsite,host=mac,addr=192.168.178.20 | grep -Ei '^(forcecommand|permittty)'
rsync -av --ignore-existing --exclude '*.partial' -e "ssh -i KEY -o IdentitiesOnly=yes" vaultlab-offsite@HOST: DEST/
sha256sum FILE          # on the Dell; shasum -a 256 FILE on the Mac
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/home.vaultlab.pull-backups.plist
launchctl print gui/$(id -u)/home.vaultlab.pull-backups | grep -E 'state|last exit code'
```

## Security things I noticed

- A key with no passphrase is acceptable only because of everything around it: its own user, a forced read-only command, no terminal or tunnels, and a `from=` limit.
- `command=` and `ForceCommand` say the same thing twice on purpose. If a second key is ever added without options, `ForceCommand` still applies.
- Permissions decide what the puller can read. A wrong umask on a future backup would silently stop its off-site copy.
- Sending a key file by email works only because of its passphrase. A copy of it stays in the mail provider and on every device that syncs it, so I delete the mail and the downloaded file straight after use.
- A passphrase made from my own name and a number is guessable, and one I can't remember is just as bad. Pick it in the password manager first.
- No key, public or private, goes into the repo. The `launchd` file has my username in it, so it stays on the Mac.

## Reflection

**What did I learn?**
Why a pull beats a push for off-site backups, and how `restrict`, `command=`, `from=`, `ForceCommand` and `rrsync` together reduce an automation key to one job.

**What did I struggle with?**
Two proofs that weren't proofs: the zsh `$K` that made refusals that were really missing keys, and the "port open" tunnel check. And a forgotten passphrase.

**What did I understand better after practising?**
That a copy is only a backup once I've opened it, that `--ignore-existing` makes the off-site copy append-only, and that the passphrase is as much part of the backup as the file.

**What should I review next?**
Breaks 2 to 4 with recorded output, and a revocation certificate for the new key.

**What can I demonstrate now that I couldn't before?**
I can make a user whose key only fetches one folder over read-only rsync, schedule the pull with `launchd`, and open an off-site copy on the Mac with a key the Dell never held.
