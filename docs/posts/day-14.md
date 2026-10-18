# Day 14: VaultLab as a systemd service

**Goal for today:** stop running the API in a terminal tab and make it a real service: it starts at boot, restarts after a crash, runs as its own unprivileged user with its secrets in a root-only file, is hardened by systemd, and logs to the journal. Then break it in several ways and learn to read each failure.

**My setup:** Ubuntu 24.04 with systemd 255, nginx and MariaDB already running from earlier days. Everything below uses test accounts.

---

Until today, the API lived in a terminal tab (`npm run dev`). Close the tab, log out, or reboot, and VaultLab is gone: nginx answers 502 and nobody notices. Day 13 gave VaultLab HTTPS; today it gets a process manager.

## Lesson Learned: A process in a terminal is not a server

The API ran as me (`er-shishir`), attached to a terminal (`pts/N`). When a terminal closes, the kernel sends SIGHUP to everything attached to it, and by default a process that gets SIGHUP ends. Nothing restarts it, nothing starts it at boot, and if someone ever took it over, they'd be me, with my home folder and my SSH keys.

A systemd service fixes all of that: it starts at boot (`WantedBy=multi-user.target`), systemd is its parent so there's no terminal to hang up, `Restart=on-failure` brings it back after a crash, `User=vaultlab` limits what it can do, and its output goes to the journal.

## The layout

| What | Where | Owner / mode |
| --- | --- | --- |
| Development checkout | `~/Desktop/vaultlab` | me |
| Deployed API | `/opt/vaultlab/server` | root, readable by all |
| Settings and secrets | `/etc/vaultlab/api.env` | root, `600` |
| Service user | `vaultlab` | no password, no shell, no home |

```bash
sudo useradd --system --no-create-home --shell /usr/sbin/nologin vaultlab
sudo install -d -m 755 /etc/vaultlab
sudo install -m 600 -o root -g root ~/Desktop/vaultlab/server/.env /etc/vaultlab/api.env
```

systemd reads `api.env` as root and hands the values to Node as environment variables, so the `vaultlab` user never needs to read the file. One difference from dotenv: systemd only skips lines that **start** with `#`, so `HOST=127.0.0.1   # comment` would put the comment into the value. I checked my file with `grep`: no inline comments, `VAULT_KEY` on its own line, 64 hex characters.

Two helper scripts live in `deploy/`: `deploy-api.sh` (rsync the code to `/opt`, `npm ci --omit=dev`, restart the service) and `vaultlab-run.sh` (run a command as `vaultlab` with the settings loaded).

## The unit file

`deploy/vaultlab-api.service`, installed as `/etc/systemd/system/vaultlab-api.service`. The important lines:

```ini
[Unit]
After=network.target mariadb.service
Wants=mariadb.service
StartLimitIntervalSec=60
StartLimitBurst=5

[Service]
User=vaultlab
WorkingDirectory=/opt/vaultlab/server
EnvironmentFile=/etc/vaultlab/api.env
ExecStart=/usr/bin/node src/index.js
Restart=on-failure
RestartSec=2
# plus hardening: ProtectSystem=strict, ProtectHome=true, PrivateTmp=true,
# NoNewPrivileges=true, CapabilityBoundingSet=, RestrictAddressFamilies=..., UMask=0077 ...
```

- `After=` / `Wants=` mariadb: the database starts first.
- `StartLimit*` belong in `[Unit]`: at most 5 starts in 60 seconds, then systemd gives up.
- `Restart=on-failure`: restarts after a crash, not after `systemctl stop`.
- Hardening takes away what a Node API doesn't need. `MemoryDenyWriteExecute` is deliberately missing, because V8 compiles code at run time.

`systemd-analyze security` gave the unit an exposure score of **2.8 OK**, both offline and on the running service.

## What went wrong on the way

**Node was installed with nvm.** The service can't use anything under `/home` (the `vaultlab` user can't enter it, and `ProtectHome=` hides it). `sudo npm` also failed with `npm: command not found`, because nvm only adds Node to my shell's PATH. I installed Node system-wide from NodeSource, so `/usr/bin/node` exists, and re-ran the deploy.

**Port 3000 was taken.** The service started, connected to the database, passed the vault check, and then logged `Error: port 3000 is already in use`. My old dev server (`node --watch`, in a terminal tab since 13:19) still held the port. I stopped it with Ctrl+C, ran `systemctl reset-failed` and restarted. That was Break 7 by accident, and it showed why the lesson is "find the owner with `ss -tlnp`, never kill whatever has the port".

## Break and fix

For every break: do it, read `systemctl status`, read the journal, fix it, check it's `active` again.

I ran every break myself in my terminal and read the output. I wrote the repo files (the unit and the two scripts), made the code change for Break 8, and checked the state between steps. Break 7 wasn't planned: it happened on its own.

**1. A crash (`kill -9`).** Three 502s, then 200 again, a new PID and `NRestarts` 1. The journal:

```text
vaultlab-api.service: Main process exited, code=killed, status=9/KILL
vaultlab-api.service: Failed with result 'signal'.
vaultlab-api.service: Scheduled restart job, restart counter is at 1.
Started vaultlab-api.service - VaultLab API (Node.js).
```

**2. Stopped on purpose.** `inactive` and 502, and it stayed that way, because `Restart=on-failure` doesn't restart a service someone stopped. The journal said `Stopping...`, `Deactivated successfully.`, `Stopped.` "It's down" can mean crashed (it comes back) or stopped (someone decided).

**3. A crash loop (wrong key).** I changed one character of `VAULT_KEY` in `api.env`. The state went `active`, `activating`, `activating`... then `failed (Result: exit-code)` after 5 restarts:

```text
vaultlab-api.service: Main process exited, code=exited, status=1/FAILURE
vaultlab-api.service: Scheduled restart job, restart counter is at 5.
vaultlab-api.service: Start request repeated too quickly.
Failed to start vaultlab-api.service - VaultLab API (Node.js).
```

One finding: the final state said `Result: exit-code`, not `start-limit-hit`, even though the journal said `Start request repeated too quickly`. On this machine, `status` kept the result of the last real failure. The real cause was in my own line, `VAULT_KEY must be 64 hex characters`, not in systemd's. My edit put an `X` in the key, so it failed that check before the vault check. Then the trap: starting again while the limit was in effect failed with `Job for vaultlab-api.service failed`. The fix is `systemctl reset-failed`, then `start`.

I made a mistake here too. I pasted the terminal output back into the shell, and it re-ran my "back up the file" command after the key was already broken, so the backup (`api.env.good`) was overwritten with the broken file. I restored `api.env` from `server/.env`, which still had the good key, and checked with `grep -c` that it matched `[0-9a-f]{64}`. It's a good reason to keep the key in a safe copy.

**4. Editing the unit and forgetting `daemon-reload`.** After changing `RestartSec` to 10, `systemctl show -p RestartUSec` still said `2s`, and `status` printed `Warning: The unit file ... changed on disk. Run 'systemctl daemon-reload'`. After `daemon-reload` it said `10s`. I restored the unit from the repo and reloaded: `2s`.

**5. Running from my home folder.** I pointed `WorkingDirectory=` at the Desktop checkout:

```text
(node)[82815]: vaultlab-api.service: Changing to the requested working directory failed: Permission denied
vaultlab-api.service: Main process exited, code=exited, status=200/CHDIR
```

No Node output at all, because systemd failed before my program started. Status codes of 200 and up come from systemd itself (`200/CHDIR`, `203/EXEC`, `217/USER`). It showed `activating (auto-restart)`, not `failed`, because the limit hadn't been reached yet.

**6. The settings file is missing.** I moved `api.env` away:

```text
vaultlab-api.service: Failed to load environment files: No such file or directory
vaultlab-api.service: Failed with result 'resources'.
```

`Result: resources` means systemd couldn't prepare the service, so Node never started. Compare break 3, where Node started and exited by itself (`exit-code`).

**7. Port 3000 already taken.** See above: it happened for real, with the old dev server.

**8. "I fixed it, but nothing changed".** I added `version: 'day14'` to the health answer in `server/src/app.js` and restarted. No `version` in the answer. The service runs `/opt/vaultlab/server`, not my checkout: `app.js` there was dated 13:19, mine 21:04. After `./deploy/deploy-api.sh`, `"version":"day14"` appeared. Then I reverted the change with `git checkout` and deployed again.

## The table to keep

| What status / the journal says | Means | First step |
| --- | --- | --- |
| `code=killed, status=9/KILL`, `Result: signal` | Killed from outside | It restarts itself; find out who or what killed it |
| `code=exited, status=1/FAILURE`, `Result: exit-code` | The app started and exited with an error | The app's own lines just above in the journal |
| `Start request repeated too quickly` (the result may still say `exit-code`) | It failed too often; systemd gave up | Fix the cause, then `reset-failed`, then `start` |
| `status=200/CHDIR`, `203/EXEC`, `217/USER` | systemd failed before the app ran | The unit: `WorkingDirectory=`, `ExecStart=`, `User=` |
| `Result: resources`, `Failed to load environment files` | systemd couldn't prepare the service | The paths in the unit (`EnvironmentFile=`) |
| `inactive (dead)`, `Deactivated successfully` | Stopped on purpose | Who stopped it, and why? |
| `changed on disk. Run 'systemctl daemon-reload'` | Edited, but not reloaded | `daemon-reload` |
| `port 3000 is already in use` | Two copies of the API | `ss -tlnp` to find the owner |
| A change has no effect after a restart | The running copy isn't the edited one | `WorkingDirectory=`, deploy |

## Commands I used today

```bash
# Look at services
systemctl status vaultlab-api --no-pager
systemctl is-enabled vaultlab-api; systemctl is-active vaultlab-api
systemctl show -p MainPID -p NRestarts --value vaultlab-api

# Change and recover
sudo systemctl daemon-reload
sudo systemctl enable --now vaultlab-api
sudo systemctl reset-failed vaultlab-api

# Logs
sudo journalctl -u vaultlab-api -n 20 --no-pager
sudo journalctl -u vaultlab-api -f

# Check and score the unit
systemd-analyze verify /etc/systemd/system/vaultlab-api.service
systemd-analyze security vaultlab-api | tail -1

# Deploy
./deploy/deploy-api.sh
```

## Security things I noticed

- The service runs as `vaultlab`, with no shell, no home and no terminal, instead of as me.
- The secrets file is `600` root, and the service process never reads it, because systemd passes the values in.
- A separate user is only part of the protection; most of the exposure score comes from the hardening lines.
- The key now lives in three places (`/etc/vaultlab/api.env`, `server/.env`, my safe copy). Each copy is one more thing to protect, and `server/.env` saved me today.
- Don't paste terminal output back into the shell. It runs.

## Not done yet

I haven't done the **reboot test** (reboot, then open VaultLab before running anything). The service is `enabled`, so it should start by itself, but I haven't proved it. I'll add the result when I do it.

## Reflection

**What did I learn?**
How systemd runs, restarts and limits a service, how to read `status` and the journal, and that a failure's cause is usually in my own app's log lines, not in systemd's.

**What did I struggle with?**
nvm versus a system-wide Node, and the extra copy of the code in `/opt`, where a fix can exist in one copy and not in the one that runs.

**What did I understand better after practising?**
Why `start` and `enable` are different, why `reset-failed` exists, and why `activating (auto-restart)` and `failed` are different states.

**What should I review next?**
The reboot test and the `journalctl -b -1` view of the previous boot, plus the full list of ✗ items in `systemd-analyze security`.

**What can I demonstrate now that I couldn't before?**
I can turn an app into a hardened service, deploy it, and diagnose crash, stop, start-limit, path and settings problems from `systemctl status` and `journalctl`.
