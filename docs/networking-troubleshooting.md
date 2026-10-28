# Network troubleshooting: ports, firewall, DNS and the wire (Day 22)

Written from a home lab: the Dell is the server, a Passbolt LXD container on the Dell's own bridge is the client
(its own network namespace, so it reaches the Dell like another machine). The firewall, packet-capture and `nmap`
parts are further down. All outputs are real; public addresses are left out.

## What a port is

A port is a 16-bit number the operating system uses to decide which running program a piece of traffic belongs to.
The IP address gets the packet to the machine; the port gets it to the program. One TCP connection is identified by
four things: **source IP : source port -> destination IP : destination port**.

- A **listening** port is a program saying "send me what arrives for this number". Only one program can listen on a
  given TCP port at a time (hence "address already in use").
- A **connected** port is one end of a live conversation. The client borrows a random high ("ephemeral") port for each
  connection. On the Dell, a container connecting to nginx looked like this, with the same port in two roles:

```text
LISTEN  0.0.0.0:443                              (nginx, waiting)
ESTAB   10.157.83.1:443  <-  10.157.83.205:36036  (a live connection; 36036 is the client's ephemeral port)
```

- Ports 0-1023 are "well-known" (22 SSH, 53 DNS, 80 HTTP, 443 HTTPS); on Linux only root may listen on them.
- TCP sets up a connection first; UDP doesn't. `:443` on TCP and on UDP are different things.

## What is listening here? `ss -tln`

`t` TCP, `l` listening only, `n` numeric. Add `p` (needs `sudo`) to see the process. The **Local Address** column is the
part people miss:

| Local address | Meaning | On the Dell |
| --- | --- | --- |
| `0.0.0.0:443` or `*:8443` | all addresses: reachable from the network | nginx, the Passbolt proxy, SSH, HTTP |
| `127.0.0.1:3000` | loopback only: reachable from this machine only | the API, MariaDB (3306) |

If a service works locally but not from another machine, check first whether it is bound to `127.0.0.1` instead of
`0.0.0.0`. To find the owner of a port: `sudo ss -tlnp | grep :PORT` or `sudo lsof -nP -iTCP:PORT -sTCP:LISTEN`.

## Is the port reachable from another machine? open, closed, filtered

The difference isn't open against closed; it is **how the machine says no**, and the clock tells you.

| State | What it means | What you see |
| --- | --- | --- |
| open | a program is listening and reachable | connects at once |
| closed | reached the machine, nothing answers on that port (a TCP RST comes back) | fails **instantly**: "connection refused" |
| filtered | a firewall drops the packet silently | **hangs**, then times out |

Probes from the container to the Dell (`nc -z -w4`, exit code and time):

```text
port 443   nginx, 0.0.0.0           exit=0  0.00s   open
port 22    ssh, 0.0.0.0             exit=0  0.01s   open
port 8443  passbolt proxy, *        exit=0  0.00s   open
port 3000  API, 127.0.0.1 ONLY      exit=1  0.00s   closed
port 3306  MariaDB, 127.0.0.1 ONLY  exit=1  0.00s   closed
port 9999  nothing listening        exit=1  0.00s   closed
curl: (7) Failed to connect to 10.157.83.1 port 9999 after 0 ms: Couldn't connect to server
```

Port 3000 is the instructive one: a service **is** running, and from the network it looks exactly like an empty port,
because it is bound to loopback. That is on purpose: only nginx, on the same machine, can reach the API. A "filtered"
port needs a firewall rule that drops traffic; that's the next section.

## DNS: how a name becomes an address

The OS doesn't go straight to a DNS server. It follows `/etc/nsswitch.conf`; on this Ubuntu Desktop the line is
`hosts: files mdns4_minimal [NOTFOUND=return] dns`: `/etc/hosts` first, then multicast DNS, then DNS. That's why a lab
works without a DNS server: the names go in `/etc/hosts`.

| Tool | Asks | Result here |
| --- | --- | --- |
| `getent hosts vaultlab.home` | what the OS would really resolve, hosts file included | `127.0.0.1` |
| `dig +short vaultlab.home` | the local resolver stub on `127.0.0.53` | `127.0.0.1` (the stub merges `/etc/hosts`) |
| `dig @10.157.83.1 vaultlab.home` | a real DNS server directly | `NOERROR`, one answer |

Two things I wouldn't have guessed:

- `dig` is **not** independent of `/etc/hosts` here, because systemd-resolved merges the hosts file into its answers. To
  test a DNS server itself, name it with `dig @server`.
- That server, the LXD bridge's `dnsmasq`, also serves the **Dell's** `/etc/hosts` to containers. A container asking for
  `vaultlab.home` is told `127.0.0.1`, which for the container means itself. It only gets `passbolt.vaultlab.home` right
  because its own `/etc/hosts` is checked first (`files` before `dns`).

Failure looks different at each layer, and the message names the layer:

| Message | Layer | Example |
| --- | --- | --- |
| `getent` prints nothing, exit 2; `dig` `status: NXDOMAIN` | the name doesn't exist | `nonexistent.invalid` |
| `curl: (6) Could not resolve host` | DNS: it never tried to connect | `nonexistent.invalid` |
| `curl: (7) Failed to connect ... Couldn't connect to server` | reached the host; nothing listens (refused) | port 9999 |
| `curl: (28) Connection timed out` | reached nothing: usually a firewall drop, or a dead host | a `ufw deny` rule |

A test name must really not exist: `bad.name` turned out to be a real domain. The reserved `.invalid` top level never resolves.

## The firewall decides closed against filtered

`ufw` is a front end over the kernel's netfilter. The choice between two rules is the choice between two symptoms:

- `ufw reject`: sends an answer back (RST). The port looks **closed**: "connection refused", instantly.
- `ufw deny`: drops the packet silently. The port looks **filtered**: the client waits, then times out.

I tested both on a spare port with a real listener that never stopped running, probing from the container:

| State of port 18081 | `nc -z -w4` | `curl` says |
| --- | --- | --- |
| open | exit 0 in 0.01 s | `200` |
| `ufw reject` | exit 1 in 0.01 s | `(7) Couldn't connect` |
| `ufw deny` | exit 1 in **4.01 s** | `(28) Connection timed out after 5002 ms` |
| rule removed | exit 0 in 0.00 s | `200` |

The listener was running the whole time, so the firewall alone made the difference. "Why does it hang" against "why does it
refuse instantly" is a DROP rule somewhere. Safe handling: allow SSH before enabling a firewall, test changes from a second
machine, **insert** a test rule at the top and delete it with the same text (`ufw --force delete deny in on lxdbr0 to any
port 18081 proto tcp`), and use a spare port: `ufw` here already had its own rules, so I never ran a blanket `enable` or reset.
A rule on the bridge interface only affects traffic arriving there: traffic from a machine to its own address goes over the
loopback interface, which `ufw` always allows, so a "drop" can't be tested that way.

## nmap says it in words

`nmap -Pn -p ports host` labels each port, from the Dell against the container:

```text
22/tcp    open     ssh
80/tcp    open     http
443/tcp   open     https
18083/tcp open     unknown      (a throwaway listener)
18084/tcp closed   unknown      (nothing there)
-- after a ufw deny OUT rule for 18083:
18083/tcp filtered unknown      (the same listener, now dropped)
18084/tcp closed   unknown      (unchanged: refused, not dropped)
```

Only scan machines you own. On a home lab that's exactly what it's for.

## On the wire: `tcpdump`

`tcpdump -nn` prints packets (`-nn`: no name lookups). Three captures, one per state.

**Open: the three-way handshake**, then data (loopback, port 18081):

```text
127.0.0.1.33106 > 127.0.0.1.18081: Flags [S],  seq 2604812336                  SYN       "let's talk"
127.0.0.1.18081 > 127.0.0.1.33106: Flags [S.], seq 884213488, ack 2604812337   SYN-ACK   "ok, and let's talk"
127.0.0.1.33106 > 127.0.0.1.18081: Flags [.],  ack 1                           ACK       "agreed"
127.0.0.1.33106 > 127.0.0.1.18081: Flags [P.], length 78                       the HTTP request
127.0.0.1.18081 > 127.0.0.1.33106: Flags [P.], length 156 and 3530             the response
127.0.0.1.18081 > 127.0.0.1.33106: Flags [F.]  ...                             the server closes (FIN), the client answers
```

**Closed: SYN, then RST straight back** (that `[R.]` is "connection refused" at the packet level):

```text
127.0.0.1.36118 > 127.0.0.1.18082: Flags [S]
127.0.0.1.18082 > 127.0.0.1.36118: Flags [R.]
```

**Filtered: the same SYN, again and again, never answered** (on the bridge, with a `ufw deny` rule):

```text
10.157.83.205.47980 > 10.157.83.1.18081: Flags [S], seq 3382974915
10.157.83.205.47980 > 10.157.83.1.18081: Flags [S], seq 3382974915   (+1.05 s)
10.157.83.205.47980 > 10.157.83.1.18081: Flags [S], seq 3382974915   (+1.02 s)
```

"SYN with no reply" against "SYN then RST" tells you firewall drop against nothing listening, without touching the server.
Note: `tcpdump` sees the packets before the firewall drops them, which is why the dropped SYNs still appear.

**Pitfalls I hit:** a script that put `tcpdump` in the background under `sudo timeout` produced empty captures, and the
`tcpdump` kept running long after the timeout; even `sudo pkill` said `Permission denied`. The process ran under an enforcing
AppArmor profile (`/proc/<pid>/attr/current` said `tcpdump (enforce)`), which is consistent with signals being refused, but
I haven't proved that. What worked: let `tcpdump` stop itself with `-c N`, and capture in the foreground.

## The ladder: "the app isn't reachable"

Climb from the client and stop at the first rung that fails.

| # | Question | Command (from the client) | If it fails, the problem is |
| --- | --- | --- | --- |
| 1 | Does the name resolve? | `getent hosts NAME` | DNS or `/etc/hosts` (`curl: (6)`) |
| 2 | Is the host up? | `ping HOST` | network, wrong IP, machine down |
| 3 | Is the port reachable? | `nc -z -w2 HOST PORT; echo $?` | **refused (instant)** = nothing listening; **timeout (slow)** = a firewall drop |
| 4 | (refused) Is it listening? | on the server: `sudo ss -tlnp \| grep PORT` | service down, or bound to `127.0.0.1` |
| 5 | (timeout) Is the firewall dropping it? | on the server: `sudo ufw status` | a `deny` rule, or a dead host |
| 6 | Does the app answer? | `curl -v https://NAME/` | TLS error, 502 (backend down), 500 (app error) |
| 7 | (502/500) Is the backend alive? | on the server: the health endpoint and logs | the API or the database |

The clock is the tell at rung 3: refused is instant, filtered is slow.

## One-liners

```bash
sudo ss -tlnp                         # what listens, on which address, owned by which process
sudo ss -tnp                          # live connections (drop the l)
sudo lsof -nP -iTCP:3000 -sTCP:LISTEN # who owns a port
nc -z -w2 HOST PORT; echo $?          # reachable? exit 0 open, 1 refused (instant) or timed out (slow)
getent hosts NAME                     # what the OS resolves (respects /etc/hosts and nsswitch)
dig @SERVER NAME A                    # ask one DNS server directly
```
