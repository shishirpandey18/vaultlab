# Day 4: Ports, TCP and sockets

**Goal for today:** say which process owns any listening port, explain why a service can be reachable from the server itself but not from the network, and tell "connection refused" and "timed out" apart.

**My setup:** the Dell with Ubuntu as the server, the Mac as the client. Two SSH tabs into the Dell and one normal tab on the Mac.

---

Today I took on networking, starting with two questions: **"How do ports work?"** and **"How can you find which ports are open on a machine?"** Today was about answering both from my own experiments instead of from theory.

## My network

First I wanted to understand my own home network well enough to draw it.

| Word | Meaning | In my home |
| --- | --- | --- |
| **IP address** | A device's address on a network | Dell `192.168.178.52`, Mac `192.168.178.51` |
| **Subnet** (`/24`, mask `255.255.255.0`) | Which addresses count as "local" | Everything `192.168.178.x` |
| **Gateway** | The device that sends traffic out of the local network | My router |
| **Private address** | Only valid inside a network: `10.x`, `172.16-31.x`, `192.168.x` | Every device at home |
| **NAT** | The router swaps my private address for its one public address on the way out | Why the internet sees one IP for my whole home |
| **Loopback** `127.0.0.1` | "This machine itself", never leaves the computer | Every computer has it |

The rule that decides everything: if the destination is **in my subnet**, the packet goes **directly**; if not, it goes **to the gateway**. The Mac and the Dell are in the same subnet, so the Mac talks to the Dell directly, not through the internet.

```bash
ip -4 addr            # Dell: my addresses
ip route              # Dell: "default via ..." is the gateway
networksetup -getinfo Wi-Fi   # Mac: IP, subnet mask, router
```

On the Dell I also saw `docker0` (`172.17.0.1`) and a `br-...` interface (`172.18.0.1`). These are virtual networks Docker created inside the Dell for its containers. They exist only inside the Dell.

I also looked at the neighbour tables (`arp -a` on the Mac, `ip neigh` on the Dell): the list of which IP belongs to which network card. That's exactly the table that was missing on Day 1, when my ping said `Host is down`: the Mac asked "who has 192.168.178.52?" and nobody answered.

## What a port is

An IP address gets data to the right **machine**. A **port** gets it to the right **program** on that machine. It's a number from 0 to 65535 that a program claims; the operating system then hands it every packet addressed to that port.

The way I remember it: a block of flats. The IP address is the building's street address, the port is the flat number. The postman (the operating system) delivers to the flat, and whoever lives in flat 22 gets the SSH mail.

| Range | Name | Examples |
| --- | --- | --- |
| 0-1023 | Well-known (need root on Linux) | 22 SSH, 53 DNS, 80 HTTP, 443 HTTPS |
| 1024-49151 | Registered | 3000 Node apps, 5432 PostgreSQL |
| 49152-65535 | Dynamic / ephemeral | Picked automatically for the client side of a connection |

Key words:

- **Listening:** a program has claimed a port and is waiting for connections.
- **Socket:** one end of a connection: IP + port + protocol.
- **Connection:** identified by **four** values: client IP, client port, server IP, server port. That's how one server port can serve many clients at the same time: each connection has a different client port.
- **Bind address:** which of the machine's addresses a server listens on.

| Bind address | Who can connect |
| --- | --- |
| `127.0.0.1` | Only programs on the same machine |
| `0.0.0.0` (or `*`) | Any interface, so the whole network (if the firewall allows) |
| `[::]` | The same idea for IPv6 |

### TCP vs UDP

| | TCP | UDP |
| --- | --- | --- |
| Connection | Yes, set up with a handshake first | No, just sends |
| Delivery | Guaranteed, in order, resent if lost | Best effort |
| Used for | SSH, HTTP, HTTPS, databases | DNS lookups, video calls, games |

### Seeing what is listening

```bash
sudo ss -tlnp     # TCP, listening, numeric, with the process
sudo ss -ulnp     # the same for UDP
```

The letters spell what I want: **t**cp, **l**istening, **n**umeric, **p**rocess. Without `sudo`, I can't see the names of other users' programs.

```text
State   Recv-Q  Send-Q  Local Address:Port   Peer Address:Port  Process
LISTEN  0       4096          0.0.0.0:22          0.0.0.0:*     users:(("sshd",...))
```

`0.0.0.0:22` means SSH accepts connections from every network. On Ubuntu 24.04, SSH can also show up as `systemd` instead of `sshd`: systemd holds the port and starts SSH when someone connects ("socket activation").

Then I found my own SSH connection from **both** ends. On the Dell, `ss -tn state established '( sport = :22 )'` showed the Dell's port 22 and a high port number on the Mac's side. On the Mac, `lsof -nP -iTCP@192.168.178.52` showed the same connection the other way round. Same four numbers, seen from each machine. With two SSH tabs open, there were two connections, with two different ports on the Mac.

## Building a TCP echo server

Then I wrote my own server: the smallest possible version of what VaultLab's backend will be, a program that claims a port and answers whoever connects. It's in `experiments/network/tcp-echo.js`.

```js
const net = require("node:net");

const PORT = Number(process.env.PORT) || 5000;
const HOST = process.env.HOST || "0.0.0.0";

// This function runs once for every new connection (every new socket)
const server = net.createServer((socket) => {
  const client = `${socket.remoteAddress}:${socket.remotePort}`;
  const me = `${socket.localAddress}:${socket.localPort}`;
  console.log(`[+] ${client} connected to ${me}`);
  socket.write(`Hello ${client}. You reached ${me}. Type something, or "quit".\n`);

  let buffer = "";
  socket.on("data", (data) => {
    buffer += data.toString();
    let newline;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      console.log(`[${client}] ${line}`);
      if (line === "quit") {
        socket.end("Bye!\n");
        return;
      }
      socket.write(`echo: ${line}\n`);
    }
  });

  socket.on("end", () => console.log(`[-] ${client} disconnected`));
});

server.listen(PORT, HOST, () => {
  console.log(`Echo server listening on ${HOST}:${PORT} (process id ${process.pid})`);
});
```

(The full file also handles server errors like "port already in use"; more on that below.)

- **`process.env.PORT` and `process.env.HOST`** are environment variables: settings passed from outside, without changing the code. `HOST=127.0.0.1 node tcp-echo.js` sets one just for that run.
- **`createServer` runs my function once per connection.** Each client gets its own `socket`, with its own address: the four-number rule from above, in code.

## Lesson Learned: TCP is a stream, not separate messages

The `buffer` in the code is there for a reason. TCP guarantees that the bytes arrive in order, but **not** that they arrive in the same pieces they were sent in. Two lines can arrive in one `data` event, or one line in two.

A simpler version without the buffer, which treated each `data` event as one message, breaks when two lines arrive together: `hello vault` and `quit` come in as one piece, the server echoes them back as one message, and it never recognises `quit`, so the connection never closes. Collecting the bytes and handling one complete line at a time fixes it.

This is why protocols like HTTP define exactly where a message ends.

### Talking to it

I wrote the code on the Mac, pushed it, and pulled it on the Dell with `git pull`: a small manual deployment. Then I started the server in SSH tab 1 and connected with `nc` (netcat), a raw TCP client:

```text
$ nc localhost 5000
Hello 127.0.0.1:60708. You reached 127.0.0.1:5000. Type something, or "quit".
hello vault
echo: hello vault
quit
Bye!
```

And the server's side, at the same time:

```text
[+] 127.0.0.1:60708 connected to 127.0.0.1:5000
[127.0.0.1:60708] hello vault
[127.0.0.1:60708] quit
[-] 127.0.0.1:60708 disconnected
```

Then from the Mac with `nc 192.168.178.52 5000`. Now the greeting showed the Mac's address and a Mac port, and the server said `You reached 192.168.178.52:5000`. While the Mac was connected, `sudo ss -tnp | grep 5000` on the Dell showed one **LISTEN** line (the server waiting) and one **ESTAB** line (the Mac's connection).

## Watching the TCP handshake

With the server running, I captured every packet to port 5000:

```bash
sudo tcpdump -i any -n 'tcp port 5000'
```

When the Mac connected, the first three packets were the **three-way handshake**:

```text
192.168.178.51.xxxxx > 192.168.178.52.5000: Flags [S]    ← SYN: "I want to connect"
192.168.178.52.5000 > 192.168.178.51.xxxxx: Flags [S.]   ← SYN-ACK: "OK, I'm listening"
192.168.178.51.xxxxx > 192.168.178.52.5000: Flags [.]    ← ACK: connected
```

| Flag | Meaning |
| --- | --- |
| `[S]` | SYN: "I want to connect" |
| `[S.]` | SYN-ACK: "OK, I'm listening" (the `.` means ACK) |
| `[.]` | ACK: "got it" |
| `[P.]` | PUSH: real data, like the text I typed |
| `[F.]` | FIN: "I'm finished", a polite close |
| `[R]` / `[R.]` | RST: "no" or "abort" |

Then I stopped the server and tried again: just two packets, my `[S]` and the Dell answering `[R.]`. The **operating system** sent that reset itself, because no program had claimed port 5000.

## Lesson Learned: Refused and timed out are two different problems

This was the most important thing I learned today. One connection attempt can get three different answers:

| What happens | What the Mac sees | nmap says | Where the problem is |
| --- | --- | --- | --- |
| SYN → SYN-ACK → ACK | Connected | `open` | Nothing wrong |
| SYN → RST (instantly) | `Connection refused` | `closed` | The **service**: not running, crashed, or wrong port |
| SYN → nothing, retry, nothing | `Operation timed out` | `filtered` | The **network or a firewall** |

**Refused is fast**, because the machine actively answers "no". **Timed out is slow**, because the client keeps waiting for an answer that never comes. So the error message alone already tells me which layer to look at.

## Scanning ports with nmap

nmap shows a machine the way **another computer** sees it. (Only on machines I own: scanning other people's systems without permission is not OK.)

From the Mac:

```bash
nmap -p 22,5000,5001 192.168.178.52
```

| Port | From the Mac | Why |
| --- | --- | --- |
| 22 | open | SSH listens on `0.0.0.0` |
| 5000 | open | My echo server listens on `0.0.0.0` |
| 5001 | closed | Nothing listens there |

The SERVICE column nmap prints is only a **guess from the port number**. For port 5000 it says `upnp`, because that's a common use of 5000. It has no idea my echo server is running there. That's why `ss` (which shows the real program) and nmap complement each other.

So the answer to "how do I find which ports are open on a machine?" has two halves:

- **From the machine itself:** `sudo ss -tlnp` (or `lsof -nP -iTCP -sTCP:LISTEN` on a Mac) shows what is listening, on which address, and which program. It doesn't show what a firewall blocks.
- **From another machine:** `nmap <ip>` or `nc -vz <ip> <port>` shows what's actually reachable through the network and the firewall. It doesn't show which program it is.

If the two disagree, that disagreement **is** the clue.

## Break and fix

Then I caused the port problems I'll meet most often in support work, on purpose, and found each one with the tools from today.

## Lesson Learned: Fixing "port already in use"

With the server running, I started a second copy:

```text
$ node tcp-echo.js
Error: port 5000 is already in use.
Find who owns it with:  sudo ss -tlnp | grep :5000
```

Then I found the owner:

```bash
sudo ss -tlnp | grep :5000
sudo lsof -i :5000
```

Both showed `node` with its process id. The fix is to stop the old one (`Ctrl + C`, or `kill <pid>` if I can't find its terminal).

Only **one** program can listen on a port and address at a time. "Address already in use" after a restart usually means the old copy is still running in the background.

## Lesson Learned: "It works on the server but not from my laptop"

I started the server bound to loopback only:

```bash
HOST=127.0.0.1 node tcp-echo.js
```

- On the Dell, `nc localhost 5000` worked.
- From the Mac, `nc -vz 192.168.178.52 5000` gave `Connection refused`.

The service was running, but I couldn't reach it from the Mac. `ss` showed why:

```text
LISTEN  0  511  127.0.0.1:5000  0.0.0.0:*  users:(("node",...))
```

`127.0.0.1:5000` means only programs on the Dell itself can connect. A packet arriving for `192.168.178.52:5000` finds nobody listening on that address, so the Dell answers with RST. Restarting on `0.0.0.0` fixed it, and nmap from the Mac changed from `closed` to `open`.

This is one of the most common support tickets, and later this month I'll use it on purpose: VaultLab's API and database will listen on `127.0.0.1`, so that only Nginx can reach them.

## Lesson Learned: A firewall makes it time out, even when everything looks fine

To see the third answer, I added a temporary firewall rule that silently drops anything to port 5000:

```bash
sudo iptables -I INPUT -p tcp --dport 5000 -j DROP
```

Then from the Mac:

```text
$ nc -vz -G 5 192.168.178.52 5000
nc: connectx to 192.168.178.52 port 5000 (tcp) failed: Operation timed out
```

nmap now said `filtered`, and tcpdump on the Dell showed the Mac's `[S]` arriving again and again, with no answer going back.

The important part: the server was running, and `ss` on the Dell looked perfect. Checking from the inside alone would have said "everything is fine". Only testing from the outside showed the problem. Then I removed the rule:

```bash
sudo iptables -D INPUT -p tcp --dport 5000 -j DROP
```

### Ports below 1024

```text
$ PORT=80 node tcp-echo.js
Error: no permission to use port 80 (ports below 1024 need root).
```

On Linux, ports below 1024 are reserved for root, so a normal user can't pretend to be the machine's web or SSH server. That's why Node apps usually run on ports like 3000, with a web server like Nginx in front on 80 and 443. Running `sudo node` to "fix" it would mean running my own code as root, which is a security risk.

## Commands I used today

```bash
# My network
ip -4 addr                     # Dell: addresses
ip route                       # Dell: gateway
networksetup -getinfo Wi-Fi    # Mac: IP, mask, router
arp -a                         # Mac: neighbours
ip neigh                       # Dell: neighbours

# What is listening (inside)
sudo ss -tlnp                  # TCP listening ports + process
sudo ss -ulnp                  # UDP
sudo lsof -i :5000             # who owns port 5000
lsof -nP -iTCP -sTCP:LISTEN    # Mac version

# Testing from outside
nc 192.168.178.52 5000         # talk to a port
nc -vz 192.168.178.52 5000     # only test it
nmap -p 22,5000,5001 192.168.178.52

# Watching packets
sudo tcpdump -i any -n 'tcp port 5000'

# Temporary firewall rule (removed afterwards)
sudo iptables -I INPUT -p tcp --dport 5000 -j DROP
sudo iptables -D INPUT -p tcp --dport 5000 -j DROP
```

## Security things I noticed

- **Know what's listening.** Every listening port is a door into the machine. A service that only needs to be used locally should listen on `127.0.0.1`, not `0.0.0.0`.
- **Only scan what I own.** nmap is a normal admin tool, but using it on other people's networks without permission isn't OK.
- **Don't run my own code as root** just to get a low port number.
- **Temporary firewall rules need cleaning up.** I checked `sudo iptables -L INPUT -n` afterwards, so no test rule was left behind.

## Reflection

**What did I learn?**
How my home network fits together, what ports, sockets and bind addresses are, the difference between TCP and UDP, the three-way handshake, and how to find open ports from inside a machine and from outside.

**What did I understand better after practising?**
The difference between "connection refused" and "timed out". Before, they were both just "it doesn't work". Now I know refused points to the service and timed out points to the network or a firewall.

**What troubleshooting skills did I develop?**
Checking a service from both sides: `ss` on the server for what's listening and where, then `nc` or nmap from another machine for what's reachable. And reading the error type to decide where to look first.

**What should I review next?**
The three answers (open, closed, filtered) and the bind address table.

**What can I demonstrate now that I couldn't before?**
I can explain how ports work with my own echo server, find which program owns any port, and show why a service can work on the server but not from another machine.