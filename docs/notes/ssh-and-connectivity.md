# SSH and connectivity troubleshooting

> **Remember in one line:** *Timed out* = nothing answered (network). *Refused* = machine answered, nothing listening (service). *Permission denied* = connected, login failed (authentication).

## What is it?

SSH (Secure Shell) is an encrypted protocol to log in to and control another computer over the network. The server program is `sshd`. It listens on **TCP port 22**.

## Why does it exist?

Older tools like Telnet sent everything, passwords included, in plain text. SSH encrypts the whole session and checks the server's identity with a **host key**.

## How does it work?

1. The client connects to port 22 on the server.
2. The server proves its identity with its host key. The first time, the client asks "Are you sure?" and saves the key in `~/.ssh/known_hosts`. If the key ever changes, the client shows a loud warning.
3. They agree on encryption keys.
4. The user logs in, with a password or (better) an SSH key.
5. The server starts a **separate process for this session**. That is why stopping the SSH service doesn't end open sessions.

## How do I use it?

```bash
ssh <username>@<host-or-ip>       # e.g. ssh er-shishir@192.168.178.52
exit                              # leave
```

`username` is the account on the server, **not** the computer's name. The prompt shows both: `user@hostname:~$`.

## The three SSH errors (the core of this note)

| Error on the client | What happened | Layer | Where I look next |
| --- | --- | --- | --- |
| `Operation timed out` | No answer at all | Network | Same network? `ping`, `arp -a`, Wi-Fi/cable, firewall dropping packets |
| `Connection refused` | Machine answered "nothing listens on port 22" | Service | `systemctl status ssh`, `ss -tlnp \| grep :22` on the server |
| `Permission denied` | Connected, login failed | Authentication | `/var/log/auth.log` on the server |

What I saw for each (Day 1):

- **Timed out:** Dell's Wi-Fi was in a bad state (`?` on the icon) although `nmcli` said "connected". Fix: Wi-Fi off/on.
- **Refused:** I stopped SSH on purpose with `sudo systemctl stop ssh`.
- **Permission denied:** I used the hostname as the username. The log said `invalid user`.

## How do I troubleshoot it? (my order)

1. **Read the exact error.** It already tells me the layer (table above).
2. **Same network?** Mac: `ipconfig getifaddr en0`. Dell: `hostname -I`. Same first three numbers (`192.168.178.x`) on a home network.
3. **Can I reach it at all?** `ping <ip>`. On macOS, `No route to host` / `Host is down` mean the Mac asked the local network for that IP and got no reply. `arp -a` shows `(incomplete)` for it.
4. **Can the server reach the router?** On the Dell: `ip route` shows the router (`default via ...`), then `ping` that address. If this fails, the server's own link is broken.
5. **Is the service running and listening?** `systemctl status ssh`, `sudo ss -tlnp | grep :22`.
6. **What does the server's log say?** `sudo grep -a "sshd" /var/log/auth.log | tail -20` or `journalctl -u ssh -n 20`.

**Lesson from Day 1:** "connected" in a status tool is not proof. Test real traffic.

## Reading auth.log

| Log line contains | Meaning |
| --- | --- |
| `Failed password for invalid user X` | User X does not exist |
| `Failed password for X` | User X exists, wrong password |
| `Accepted password for X` / `Accepted publickey for X` | Successful login |
| `sudo: X : ... COMMAND=...` | User X ran an admin command (audit trail) |

The log also shows the **source IP** of each attempt, so I can tell which machine tried.

## What security problems can occur?

- **Accepting an unknown host key without checking it** (I did this on Day 1). On an untrusted network, an attacker could pretend to be the server (man-in-the-middle). Check on the server: `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` and compare with what the client shows.
- **"REMOTE HOST IDENTIFICATION HAS CHANGED"** warning: either the server was reinstalled, or someone is in the middle. Never ignore it blindly.
- **Password logins** can be brute-forced. On Day 6 I switch to keys only.
- **Port 22 open to the internet** gets attacked automatically within hours. Keep it inside the home network.

## Extra notes

- Ubuntu 24.04 can start SSH through `ssh.socket` (systemd listens on port 22 and starts SSH when someone connects). If a new connection ever works after I stopped `ssh`, check `systemctl status ssh.socket`.
- `grep -a` treats a file as text. Without it, `grep` may say "binary file matches" when a log contains a few non-text bytes.

## Quick self-quiz

1. Which error means the server's SSH service is stopped, and which means the server is unreachable?
2. The log says `Failed password for invalid user admin`. What is wrong?
3. Why did my SSH session stay open after `systemctl stop ssh`?
4. `nmcli` says connected but ping fails. What do I test next?
5. Why should I compare the host key fingerprint the first time I connect?
