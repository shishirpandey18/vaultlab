# Day 16: Monitoring and alerts

**Goal for today:** know about a problem before a user does. A check runs every 5 minutes, looks at VaultLab from the outside in, and says what is wrong, only when something changes.

**My setup:** Ubuntu 24.04 with systemd 255, nginx with HTTPS from my own CA (Day 13), the `vaultlab-api` service (Day 14) and the backup timer (Day 15).

**Not done today:** phone notifications (ntfy) and the "who monitors the monitor" heartbeat. Alerts go to the journal only. More on that at the end.

---

VaultLab now restarts itself after a crash and backs itself up every night. But if the backup fails at 03:30, the certificate is about to expire or nginx stops, nobody knows until someone complains. Silence is the problem: it looks exactly like health.

## Lesson Learned: Check the symptom and the cause

One HTTPS request to `/api/health` goes through DNS, TLS, nginx, Node and MariaDB. If it answers 200, all five work, and when it doesn't, the answer often says where it broke. That is a **symptom** check: what a user would feel. Then I added **cause** checks for the things a user can't see yet:

| Check | Catches |
| --- | --- |
| HTTPS `/api/health` | anything on the request path (symptom) |
| Certificate days left | an expiry coming, while everything still works |
| `vaultlab-api`, `nginx`, `mariadb` active | which part is down (cause) |
| Last backup: result and age | a failed or missing backup |
| Disk use | a full disk breaks the database, logs and backups at once |
| Failed systemd units | anything else, a cheap catch-all |

Symptoms tell me something is wrong. Causes tell me where to look.

## The script

`deploy/vaultlab-check.sh`, installed as `/usr/local/sbin/vaultlab-check`. One line per check, exit code 1 if anything is wrong. The design choices:

- **No `set -e`**, the opposite of the backup script. A backup must stop at the first error so it never deletes a good copy. A check must run every check, so I see the whole picture at once.
- **The certificate is read from the live connection**, not the file. If someone renews the file but forgets to reload nginx, the file looks fine and users still get the old certificate.
- **The backup check asks systemd**, not the backup folder: `Result` (did the last run succeed?) and `ExecMainExitTimestamp` (when did it end?). The checking user can't read `/var/backups/vaultlab` and doesn't need to.
- **Named thresholds at the top**: 21 days for the certificate, 26 hours for the backup, 90% for the disk.
- **State, not every run.** The script remembers the last overall state (`OK` or `PROBLEM`) in a file and notifies only on a change. A 3-hour outage checked every 5 minutes would be 36 identical messages, and after a week of that nobody reads them. That's alert fatigue.

## The service and the timer

The service is `Type=oneshot` and heavily locked down (`ProtectSystem=strict`, empty `CapabilityBoundingSet`, restricted address families, `MemoryDenyWriteExecute`, and so on). `systemd-analyze security` gave it **3.0 OK**. It needs the network, unlike the backup service, so it scores a little worse. The timer isn't `OnCalendar=` this time but relative: `OnBootSec=2min`, then `OnUnitActiveSec=5min`.

The first run as the real service:

```text
OK      health: 200
OK      certificate: 396 days left
OK      vaultlab-api: active
OK      nginx: active
OK      mariadb: active
OK      backup: last success 0 h ago
OK      disk: 25% used
OK      failed units: none
state changed: PROBLEM -> OK
```

## What went wrong on the way

**`DynamicUser=true` broke every check that asks systemd.** The guide used a throwaway user (`DynamicUser=true`). As the service, the same script that passed as me printed:

```text
OK      health: 200
OK      certificate: 396 days left
PROBLEM vaultlab-api: Failed to retrieve unit state: Transport endpoint is not connected
PROBLEM nginx: Failed to retrieve unit state: Transport endpoint is not connected
PROBLEM mariadb: Failed to retrieve unit state: Transport endpoint is not connected
PROBLEM backup: no finished run recorded
```

The network checks passed and every `systemctl` call failed. I suspected the hardening, so I ran `systemctl is-active nginx` in a transient unit with one option at a time. Every single option failed, which means none of them was the cause:

```text
-p User=nobody                                     active
-p DynamicUser=true                                Failed to retrieve unit state: Transport endpoint is not connected
-p DynamicUser=true -p PrivateUsers=false          Failed to retrieve unit state: Transport endpoint is not connected
```

`DynamicUser=true` itself was the cause on this machine. I don't know why, and I didn't dig further. The fix was a fixed system user, `sudo useradd --system --no-create-home --shell /usr/sbin/nologin vaultlab-check`, and `User=vaultlab-check` in the unit. `StateDirectory=` still works with it.

**My own test left failed units behind, and the check noticed.** The bisect left 14 transient `run-uNNN.service` units in the failed state, and the next run said:

```text
PROBLEM failed units: run-u445.service run-u446.service ... run-u461.service
```

That is the check doing its job, on a mess I made. `systemctl reset-failed 'run-u*.service'` cleared it.

## Break and fix

I ran the breaks with a script that undoes each break afterwards. I ran it myself with `sudo` and read the output.

**1. The API stops.**

```text
PROBLEM health: 502
PROBLEM vaultlab-api: inactive
state changed: OK -> PROBLEM
```

The first line is the symptom and the second is the cause. A second check printed the same two PROBLEM lines and **no** `state changed` line: that's the silence between changes. After starting the API: `state changed: PROBLEM -> OK`. A recovery message matters as much as the alert.

**2. nginx stops: one cause, several symptoms.**

```text
PROBLEM health: curl: (7) Failed to connect to vaultlab.home port 443 after 0 ms: Couldn't connect to server 000
PROBLEM certificate: could not read it from vaultlab.home:443
PROBLEM nginx: inactive
```

Three problems, one cause. Nothing listens on 443, so of course there is no certificate to read. Fixing the certificate would be the wrong job.

**3. A certificate about to expire.** I issued one for 10 days from my CA and reloaded nginx:

```text
OK      health: 200
PROBLEM certificate: expires in 9 days (<date> GMT)
```

The app works perfectly and the health check says 200. This alert is the whole value of monitoring: a warning before the day everything stops at once. It says 9 and not 10 because the script rounds down whole days.

**4. The backup fails.** I revoked `SELECT` from the backup user and started the backup service:

```text
PROBLEM backup: last run 0 h ago ended with 'exit-code'
PROBLEM failed units: vaultlab-backup.service
```

Without today this would sit unnoticed until the day I needed a backup. After the grant and a fresh backup: `backup: last success 0 h ago`.

**5. A full disk (pretend).** I set `DISK_MAX_PERCENT=1` in the installed copy:

```text
PROBLEM disk: 25% used
```

Then I reinstalled the script from the repo and the check went back to OK.

**6. Who monitors the monitor? (not run).** If the Dell is off, frozen or off the network, nothing runs and nothing is sent, and the quiet looks exactly like health. The usual answer is a **heartbeat** (a dead man's switch): the check pings an outside service at the end of every run, and that service alerts when the pings stop. I didn't set one up today; it's one more outside service to trust.

One more problem was in my own test script: its journal window was one second wide, so it re-printed earlier runs and printed nothing at all for break 3. I re-ran break 3 alone with a journal cursor (`--after-cursor`), which gives exactly the lines of one run.

## The table to keep

| Message | Most likely cause | First step |
| --- | --- | --- |
| `health: 502` + `vaultlab-api: inactive` | The API stopped or crashed | `systemctl status vaultlab-api`, its journal |
| `health: 503` | Node is up, the database isn't | `systemctl status mariadb` |
| `health: ... 000` + `certificate: could not read` | Nothing on port 443 | `systemctl status nginx`, `sudo nginx -t` |
| `certificate: expires in N days` | Renewal is due | Issue a new certificate, reload nginx |
| `backup: ... ended with 'exit-code'` | Last night's backup failed | `journalctl -u vaultlab-backup` |
| `backup: last success N h ago` (too many) | The timer didn't run | `systemctl list-timers` |
| `disk: NN% used` | Space running out | `df -h`, `du`, `journalctl --disk-usage` |
| `Transport endpoint is not connected` | The check can't talk to systemd (here: `DynamicUser`) | Run it as a fixed user |
| Silence | Everything's fine, or the monitor isn't running | `systemctl list-timers vaultlab-check.timer` |

## Commands I used today

```bash
sudo install -m 755 -o root -g root deploy/vaultlab-check.sh /usr/local/sbin/vaultlab-check
sudo systemd-analyze verify /etc/systemd/system/vaultlab-check.service /etc/systemd/system/vaultlab-check.timer
sudo systemctl start vaultlab-check.service
sudo journalctl -u vaultlab-check -n 12 -o cat --no-pager
sudo systemctl enable --now vaultlab-check.timer
systemctl list-timers vaultlab-check.timer --no-pager
systemctl --failed --no-pager
sudo systemctl reset-failed 'run-u*.service'
sudo systemd-run --quiet --wait --pipe -p User=nobody systemctl is-active nginx
```

## Security things I noticed

- The check user owns nothing but its state folder, has no shell, and can't read the backups or any secret.
- The check uses only the public CA certificate, never `ca.key`.
- Messages will contain only check results, never secrets, keys, emails or passwords. If I use public ntfy, the topic is the password, so it goes in a 600 root file and never in Git.
- A check that runs on the same machine can't see that machine being off.

## Not done yet

Phone notifications (Part 3) and a heartbeat from outside the Dell. Until then, a problem lands in the journal and I only see it if I look. Next up in the roadmap: an off-site copy of the encrypted backups.

## Reflection

**What did I learn?**
How to check an app from the outside in, why a check script shouldn't stop at the first failure, and how to notify only when the state changes.

**What did I struggle with?**
A hardened service that behaved differently from the same script run as me. Taking the options apart one at a time showed that none of them was the problem.

**What did I understand better after practising?**
That one cause produces several alerts (nginx down gives three), and that finding the first domino is the skill.

**What should I review next?**
Notifications to a phone, a heartbeat from outside the machine, and why `DynamicUser=` breaks `systemctl` here.

**What can I demonstrate now that I couldn't before?**
I can run a check every 5 minutes as a locked-down user, trigger each failure it watches for, and read the message to find the first cause.
