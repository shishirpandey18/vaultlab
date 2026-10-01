# Day 1: Setup, Linux basics and Git

**Goal for today:** connect my Mac to my Ubuntu machine with SSH, understand Linux permissions, and learn the basics of Git and GitHub.

**My setup:** Mac (client) and my Dell Inspiron 5570 with Ubuntu 24.04.5 LTS, which will be my server for this month.

---

Today was my first day of this 30-day project. I didn't want to only read theory today, so I started by setting up my Ubuntu machine as a server and connecting to it from my Mac. I thought it would be easy. It was not, and that turned out to be the best part of the day, because I got to troubleshoot real problems.

## What I set up today

First I checked what I am running:

```text
Description: Ubuntu 24.04.5 LTS
Hostname:    er-shishir-Inspiron-5570
Dell IP:     192.168.178.52
Mac IP:      192.168.178.51
```

Then I installed and started the SSH server on Ubuntu so I can control the Dell from my Mac.

**What is SSH?** SSH (Secure Shell) is a cryptographic network protocol that lets you securely connect to and control a remote computer over an unsecured network like the internet.

## Problem 1: "Permission denied"

My first try from the Mac:

```text
er.shishirpandey@Mac ~ % ssh er-shishir-Inspiron-5570@192.168.178.52
The authenticity of host '192.168.178.52 (192.168.178.52)' can't be established.
ED25519 key fingerprint is: SHA256:iPBbLMOGE3yftn/55Ay+TP4PYr9l/NuqEm5WnNeqR30
Are you sure you want to continue connecting (yes/no/[fingerprint])? yes
Warning: Permanently added '192.168.178.52' (ED25519) to the list of known hosts.
er-shishir-Inspiron-5570@192.168.178.52's password:
Permission denied, please try again.
```

I thought I typed my password wrong. Later I checked the authentication log on Ubuntu and found the real reason:

```text
er-shishir@er-shishir-Inspiron-5570:~$ sudo grep -a "Failed password" /var/log/auth.log
2026-10-01T13:02:58 ... sshd[7796]: Failed password for invalid user er-shishir-Inspiron-5570 from 192.168.178.51 port 65453 ssh2
2026-10-01T13:03:08 ... sshd[7796]: Failed password for invalid user er-shishir-Inspiron-5570 from 192.168.178.51 port 65453 ssh2
```

**"invalid user"**. I had used my computer's hostname (`er-shishir-Inspiron-5570`) as the username. My username is only `er-shishir`. My terminal prompt was showing me this the whole time: `er-shishir@er-shishir-Inspiron-5570` means **user@hostname**.

The log also showed `from 192.168.178.51`, which is my Mac. So the log tells you who tried and why it failed.

Something else I noticed: the same log also had my own `sudo grep` commands in it, with time, user and folder. So Linux also records what the admin does.

## Problem 2: "Operation timed out"

So I tried again with the correct username, and got a different error:

```text
er.shishirpandey@Mac ~ % ssh er-shishir@192.168.178.52
ssh: connect to host 192.168.178.52 port 22: Operation timed out
```

I tried ping:

```text
er.shishirpandey@Mac ~ % ping 192.168.178.52
PING 192.168.178.52 (192.168.178.52): 56 data bytes
Request timeout for icmp_seq 0
Request timeout for icmp_seq 1
Request timeout for icmp_seq 2
Request timeout for icmp_seq 3
ping: sendto: No route to host
Request timeout for icmp_seq 4
ping: sendto: Host is down
...
9 packets transmitted, 0 packets received, 100.0% packet loss
```

Nothing was reaching the Dell. So I checked step by step:

1. **Are both machines in the same network?**
   - Mac: `ipconfig getifaddr en0` → `192.168.178.51`
   - Ubuntu: `hostname -I` → `192.168.178.52`
   - Both are `192.168.178.x`, so yes. 
2. **Is the SSH server running?** `systemctl status ssh` → `active (running)` 
3. **Is the Wi-Fi connected?** `nmcli device status` → `connected` 

Everything said it was fine, and I got confused about what was going wrong. While thinking, my eye went to the Wi-Fi signal icon on Ubuntu, and it was showing a **?**. That means the connection was in a bad state. I turned the Wi-Fi off and reconnected it, tried everything again, and it worked.

**What I learned from this:**

- "Timed out" means **nothing answered at all**. The problem was the network, not SSH.
- A tool saying "connected" does not prove the traffic is really flowing. Ping is a real test.
- The ping messages `No route to host` and `Host is down` were already a clue: my Mac could not even find the Dell on the Wi-Fi. Next time, I will also try `ping 192.168.178.1` (my router) from the Dell to check if the Dell's own connection works.

## Problem 3 (my experiment): stopping SSH

I found something interesting that I didn't know. I stopped the SSH server on Ubuntu while I was still connected from my Mac:

```text
sudo systemctl stop ssh
```

I thought the connection would fail and I would not be able to use the Dell from my Mac anymore. But my existing session **kept working**. Then I tried to connect again in a new tab:

```text
er.shishirpandey@Mac ~ % ssh er-shishir@192.168.178.52
ssh: connect to host 192.168.178.52 port 22: Connection refused
```

So the existing SSH session can survive even after we stop the SSH service, and it only refuses **new** connections. It's like SSH closes the reception desk for new customers, but it doesn't necessarily kick out the customers who are already inside.

I understood the reason later: SSH has one main process that waits for new connections, and every connection gets its own separate process. Stopping the service stops the "reception desk", not the ones already inside.

**Now I know three SSH errors and what they mean:**

| Error | What it means | Where to look |
| --- | --- | --- |
| Operation timed out | Nothing answered | The network (Wi-Fi, IP, ping) |
| Connection refused | Machine answered, but nothing is listening on the port | Is the service running? |
| Permission denied | Connected, but login failed | `/var/log/auth.log` |

I got all three today without planning to.

## Problem 4: Linux permissions and groups

I made a file in `/srv/day1-lab` that only the group `vaultteam` could read, and tested it with a `testuser`.

What I did:

1. In one tab, I removed testuser from the group: `sudo gpasswd -d testuser vaultteam`
2. In the next tab, I logged in as testuser and tried to read the file: **Permission denied**. That was expected.
3. I went back to the first tab and put testuser in the group again: `sudo usermod -aG vaultteam testuser`
4. I came back to the testuser tab and tried again: **still Permission denied**, although testuser was now in the group that had permission.

This was caused because **a login session keeps the group list it had when it started**. The fix is to exit testuser once, log in again, and try again. Then I had access.

Next time I can check it faster with `id` inside the session and `id testuser` from the admin tab. If they show different groups, the session is old.

## Problem 5: Git merge conflict

In Git I learned that if we make changes in the same place from different branches, commit both, and then try to merge, a conflict will occur. Then we have to resolve it manually, and then commit and push.

When I looked at my repo later, I found that while resolving the conflict I also deleted a line that was not part of the conflict: the `## Goals for the month` heading in my README. I saw it with:

```bash
git diff b174f0a 3e7d2d8 -- README.md
```

So after resolving a conflict, I should check the whole file, not only the lines with the conflict markers.

## Problem 6: my push was rejected

I edited the README directly on GitHub, then changed it on my Mac and tried to push. Git rejected it because GitHub had a change my Mac didn't have. `git pull` merged both changes, and then `git push` worked.

## Commands I used today

```bash
# Who and where am I?
whoami
hostname
hostname -I

# Connect from my Mac
ssh er-shishir@192.168.178.52

# Check the network
ipconfig getifaddr en0          # Mac: my IP
ping 192.168.178.52             # can I reach the Dell?
nmcli device status             # Ubuntu: is the Wi-Fi connected?

# SSH service
systemctl status ssh
sudo systemctl stop ssh
sudo systemctl start ssh

# Read the login log
sudo grep -a "Failed password" /var/log/auth.log

# Groups
id
id testuser
sudo gpasswd -d testuser vaultteam
sudo usermod -aG vaultteam testuser    # always use -a, or the user loses other groups

# Git
git status
git add .
git commit -m "message"
git push
git pull
git merge <branch>
```

## Security things I noticed

- The first time I connected, SSH showed me the Dell's fingerprint and I just typed `yes`. I should have checked it on the Dell first (`ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`). On an untrusted network, someone could pretend to be my server.
- `hostname -I` also showed public IPv6 addresses for my Dell. I didn't put them in this post. The `192.168.x.x` addresses are private, so they are fine to share.

## Questions I still have

- Why did `grep` need `-a` to read `auth.log`?
- How can Wi-Fi say "connected" when no traffic is going through?

## Reflection

**What did I learn today?**
How to connect to a remote machine with SSH, how to read the authentication log, how Linux groups and permissions work, and how to resolve a Git merge conflict.

**What did I struggle with?**
The "Operation timed out" problem. Every check said everything was fine, and I didn't know where else to look until I saw the **?** on the Wi-Fi icon.

**What did I understand better after practising?**
The difference between timed out, connection refused and permission denied. Before, these were just error messages. Now I know which one points to the network, which one to the service, and which one to the login.

**What mistakes did I make?**
I used the hostname as the username. I typed `yes` to the fingerprint without checking it. And I deleted a line from my README while resolving the merge conflict.

**What troubleshooting skills did I develop?**
Checking step by step (same network → service running → Wi-Fi connected) instead of guessing, and reading the server's own log to find the real reason.

**What is still unclear?**
How Wi-Fi can show "connected" while traffic doesn't flow.

**What should I review tomorrow?**
Reading `ls -l` permissions quickly, and my three SSH errors.

**What can I demonstrate today that I couldn't yesterday?**
If someone shows me an SSH error, I can tell them where the problem probably is and which command to use to check it.
