# Day 22: Ports, firewalls, and reading the wire on my home lab

**Goal for today:** answer the Founder-round questions with my hands: how do ports work, how do I find which ones are open, and how do I troubleshoot a network problem? By the end I wanted a fixed ladder to walk down when someone says "the app isn't reachable", with every failure seen with my own eyes.

I split the day in two (Part 1 on Oct 27, Part 2 on Oct 28) because half of it needs `sudo` and a firewall experiment. The "other machine" for the probes was the Passbolt LXD container, which has its own network namespace and reaches the Dell across the `lxdbr0` bridge. I did not use the Mac. Several things didn't behave like the guide, and those are the best parts.

---

## Lesson Learned: closed, filtered, and the clock

A port is a 16-bit number the operating system uses to decide which program a packet belongs to. The IP address gets the packet to the machine; the port gets it to the program. A connection is four things: source IP and port, destination IP and port. The same port has two roles, and I saw both on port 443:

```text
LISTEN  0.0.0.0:443                              (nginx, waiting)
ESTAB   10.157.83.1:443  <-  10.157.83.205:36036  (a live connection; 36036 is the client's random "ephemeral" port)
```

Probing a port gives three outcomes, and the difference isn't open against closed but **how the machine says no**:

| State | What it means | What you see |
| --- | --- | --- |
| open | a program listens and is reachable | connects at once |
| closed | reached the machine, nothing on that port (an RST comes back) | **instant** "connection refused" |
| filtered | a firewall silently drops the packet | **hangs**, then times out |

## What is listening here

`ss -tln` shows it, and `sudo ss -tlnp` adds the owning process. The Local Address column is the part people miss:

```text
0.0.0.0:443    nginx            reachable from the network
0.0.0.0:22     sshd             reachable from the network
*:8443         lxd (the proxy)  reachable from the network
127.0.0.1:3000 node (vaultlab)  loopback only
127.0.0.1:3306 mariadbd         loopback only
```

Probing from the container (`nc -z -w4`, exit code and time):

```text
port 443   nginx, 0.0.0.0           exit=0  0.00s   open
port 8443  passbolt proxy, *        exit=0  0.00s   open
port 3000  API, 127.0.0.1 ONLY      exit=1  0.00s   closed
port 3306  MariaDB, 127.0.0.1 ONLY  exit=1  0.00s   closed
port 9999  nothing listening        exit=1  0.00s   closed
```

Port 3000 is the instructive one: a service **is** running, and from the network it looks exactly like an empty port, because it's bound to loopback. That is on purpose (only nginx, on the same machine, reaches the API), and "works on the server, not from my laptop" is very often this exact detail.

## DNS, and four things that surprised me

The OS doesn't go straight to a DNS server: it follows `/etc/nsswitch.conf`. On my Ubuntu Desktop the line is `hosts: files mdns4_minimal [NOTFOUND=return] dns`, not the guide's `files dns`. Differences from the guide:

1. **`bad.name` is a real domain.** The guide's example "name that doesn't exist" resolved to public addresses, and `curl` timed out instead of saying `Could not resolve host`. The reserved `.invalid` top level never resolves, so I used `nonexistent.invalid`.
2. **`dig` isn't independent of `/etc/hosts` here.** `dig vaultlab.home` went through the local stub on `127.0.0.53`, and systemd-resolved merges the hosts file into its answers. To test a real DNS server I had to name it: `dig @server`.
3. **LXD's `dnsmasq` serves the Dell's `/etc/hosts` to containers.** `dig @10.157.83.1 vaultlab.home` returned an authoritative `127.0.0.1`, which for a container means itself. The container only gets `passbolt.vaultlab.home` right because its own `/etc/hosts` is checked first (`files` before `dns`). That's the real reason for Day 19's "third hosts line".
4. Each layer says something different:

| Message | Layer |
| --- | --- |
| `getent` prints nothing (exit 2), `dig` `status: NXDOMAIN` | the name doesn't exist |
| `curl: (6) Could not resolve host` | DNS: it never tried to connect |
| `curl: (7) Failed to connect ... Couldn't connect to server` | reached the host; nothing listens |
| `curl: (28) Connection timed out` | reached nothing: usually a firewall drop |

## The firewall decides closed against filtered

`ufw reject` sends an answer back, so the port looks closed. `ufw deny` drops silently, so it looks filtered. I proved it on a spare port with a real listener that never stopped:

| State of port 18081 | `nc -z -w4` | `curl` says |
| --- | --- | --- |
| open | exit 0 in 0.01 s | `200` |
| `ufw reject` | exit 1 in 0.01 s | `(7) Couldn't connect` |
| `ufw deny` | exit 1 in **4.01 s** | `(28) Connection timed out after 5002 ms` |
| rule removed | exit 0 in 0.00 s | `200` |

My `ufw` already had its own rules (the LXD bridge, Passbolt's 8443), so I didn't run the guide's `allow 22, allow 443, enable` sequence over it. Everything used spare ports, only on the bridge, **inserted** at the top and deleted with the same text, and the script printed the full rule list before and after: `IDENTICAL: nothing of mine is left`. One more consequence: traffic from a machine to its own address goes over the loopback interface, which `ufw` always allows, so I couldn't test a "drop" from the Dell to itself. The container as a separate client is what made it possible.

`nmap` says the same in its own words, from the Dell against the container:

```text
18083/tcp open     unknown      (a throwaway listener)
18084/tcp closed   unknown      (nothing there)
-- after a ufw deny OUT rule for 18083:
18083/tcp filtered unknown      (the same listener, now dropped)
18084/tcp closed   unknown      (unchanged)
```

nmap also labelled the container `blocked.local`, from a reverse lookup answered by some resolver on my network. I haven't worked out why.

## On the wire

Three captures, one per state. **Open** (the three-way handshake, then data, on loopback):

```text
127.0.0.1.33106 > 127.0.0.1.18081: Flags [S],  seq 2604812336                  SYN
127.0.0.1.18081 > 127.0.0.1.33106: Flags [S.], seq 884213488, ack 2604812337   SYN-ACK
127.0.0.1.33106 > 127.0.0.1.18081: Flags [.],  ack 1                           ACK
127.0.0.1.33106 > 127.0.0.1.18081: Flags [P.], length 78                       the HTTP request
127.0.0.1.18081 > 127.0.0.1.33106: Flags [P.], length 156 and 3530             the response
```

**Closed:** `[S]` and then `[R.]` straight back (that `[R.]` is "connection refused" as packets). **Filtered**, with the deny rule on the bridge: the same SYN, with the same sequence number, three times, never answered:

```text
10.157.83.205.47980 > 10.157.83.1.18081: Flags [S], seq 3382974915
10.157.83.205.47980 > 10.157.83.1.18081: Flags [S], seq 3382974915   (+1.05 s)
10.157.83.205.47980 > 10.157.83.1.18081: Flags [S], seq 3382974915   (+1.02 s)
```

"SYN with no reply" against "SYN then RST" tells a firewall drop from nothing listening without touching the server. I predicted retries 1 and then 2 seconds apart; they were about 1 second apart each time. `tcpdump` sees the packets before the firewall drops them, which is why the dropped SYNs still show up.

## What went wrong on the way

**The script stalled at the first capture.** I had written a bare `wait`; in recent bash it also waits for the `tee` process that mirrors the output into a file, and that never finishes. Waiting for the one specific pid fixed it.

**Every scripted capture was empty, and I couldn't stop the `tcpdump`.** `sudo timeout 4 tcpdump ...` never stopped it: after 93 seconds the `timeout` was still sleeping and `tcpdump` (dropped to its own user) was still running. Even `sudo pkill tcpdump` said `Permission denied`, as root. `/proc/<pid>/attr/current` said `tcpdump (enforce)`: it runs under an enforcing AppArmor profile, which is **consistent with** the signals being refused, but I haven't proved that. What worked: let `tcpdump` stop itself with `-c N`, and capture in the foreground, by hand. The first stuck `tcpdump` was still alive at the end; it clears on reboot.

**Output and timing mistakes.** Pasted output arrived out of order, and one script's cleanup only half-ran after a Ctrl+C and left a listener in the container, which I removed by hand. None of them touched the firewall rules: each script deleted its own rule on exit, and the check at the end said `0`.

## The ladder: "the app isn't reachable"

Climb from the client and stop at the first rung that fails:

| # | Question | Command (from the client) | If it fails, the problem is |
| --- | --- | --- | --- |
| 1 | Does the name resolve? | `getent hosts NAME` | DNS or `/etc/hosts` (`curl (6)`) |
| 2 | Is the host up? | `ping HOST` | network, wrong IP, machine down |
| 3 | Is the port reachable? | `nc -z -w2 HOST PORT; echo $?` | **refused (instant)** = nothing listening; **timeout (slow)** = a firewall drop |
| 4 | (refused) Is it listening? | on the server: `sudo ss -tlnp \| grep PORT` | service down, or bound to `127.0.0.1` |
| 5 | (timeout) Is the firewall dropping it? | on the server: `sudo ufw status` | a `deny` rule |
| 6 | Does the app answer? | `curl -v https://NAME/` | TLS error, 502 (backend down), 500 (app error) |
| 7 | (502/500) Is the backend alive? | on the server: the health endpoint and logs | the API or the database |

The clock is the tell at rung 3: refused is instant, filtered is slow. The same ladder connects the whole month: DNS and ports (today), TLS (Day 13), the service (Day 14), the API and database (Days 11 to 12), Passbolt's health check (Days 19 to 20).

## Commands I used today

```bash
sudo ss -tlnp
nc -z -w4 HOST PORT; echo $?
getent hosts NAME
dig @SERVER NAME A
sudo ufw insert 1 deny in on lxdbr0 to any port 18081 proto tcp
sudo ufw --force delete deny in on lxdbr0 to any port 18081 proto tcp
nmap -Pn -p 22,80,443,18083,18084 HOST
sudo tcpdump -i lo -nn -c 12 'tcp port 18081'
```

## Security things I noticed

- A service bound to `127.0.0.1` is invisible from the network: the bind address and the firewall are two separate layers.
- `ufw deny` hides a port from a scanner at the cost of slow failures for real users; `ufw reject` fails fast.
- Test firewall changes from a second machine, insert (don't replace) rules, and always delete them with the same text.
- A packet capture sees traffic before the firewall acts, so it shows what was sent, not what arrived.

## Not done yet

- A real TLS connection captured on port 443 (the guide's optional extra): the handshake on a plain port is the same one underneath.
- The probes from my Mac as a second machine: I used the container as the client.
- Finding out why that `tcpdump` can't be signalled, and why nmap printed `blocked.local`.

## Reflection

**What did I learn?**
That closed and filtered are told apart by the clock, that the firewall rule behind each is `reject` and `deny`, and that you can see all three states as packets: SYN-ACK, RST, and silence.

**What did I struggle with?**
Scripts that appeared to work and produced empty captures, and tools that don't behave like the guide (`dig` and `/etc/hosts`, `bad.name`). Each time I had to look at what was really running before trusting the output.

**What did I understand better after practising?**
That "works on the server, not from my laptop" is usually the bind address, that a container can be told a name resolves to itself, and that a timeout and a refusal need completely different fixes.

**What should I review next?**
Capturing a TLS handshake on 443, and why `tcpdump` here resists signals.

**What can I demonstrate now that I couldn't before?**
I can find what listens on a machine and which process owns it, tell open from closed from filtered by exit code and time, name the firewall rule behind each, point to SYN, SYN-ACK, ACK and a RST in a capture, and walk the "not reachable" ladder out loud.
