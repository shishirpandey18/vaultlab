# Day 5: DNS and HTTP from first principles

**Goal for today:** tell a DNS failure, a refused connection and an HTTP error apart from the error text alone, and explain what happens when I type a URL and press Enter.

**My setup:** the Dell with Ubuntu as the server, the Mac as the client. One SSH tab on the Dell for the server log, one for commands, and a normal tab on the Mac.

---

Yesterday was about ports and TCP: how a connection gets to the right program. Today I went one layer up on each side: **DNS**, which happens before the connection, and **HTTP**, which is what travels inside it. At the end I put both days together into one picture of what happens when a page loads, and then broke every step of it on purpose.

## DNS: from a name to an IP

Computers connect to IP addresses, people remember names. **DNS** (Domain Name System) turns a name like `blog.nepeu.eu` into an IP address. Nobody has the whole list: it's split up, and each part is answered by whoever owns that part of the name.

When I look up a name, each step is skipped if an earlier one already knows the answer:

1. **Browser cache**: "did I look this up a minute ago?"
2. **Operating system**: its own cache, then the **hosts file** (`/etc/hosts`).
3. **Resolver**: usually my router, which asks my internet provider's resolver.
4. The resolver asks the **root servers**: "who handles `.eu`?"
5. The **`.eu` servers**: "who handles `nepeu.eu`?"
6. The **authoritative servers** for my domain, at my hosting provider: "`blog.nepeu.eu` is this IP."
7. The answer goes back, and every step **caches** it for as long as its **TTL** (time to live) allows.

| Record | Holds |
| --- | --- |
| `A` | An IPv4 address |
| `AAAA` | An IPv6 address |
| `CNAME` | "This name is another name" (an alias) |
| `MX` | Which server receives the domain's email |
| `NS` | Which servers are authoritative for the domain |
| `TXT` | Free text, used for domain verification and email security |

### Looking up my own domain

```bash
dig blog.nepeu.eu
dig +short NS nepeu.eu
dig +trace blog.nepeu.eu
dig @1.1.1.1 +short blog.nepeu.eu
```

What I read in the `dig` output:

- **`status: NOERROR`** means the name exists. `NXDOMAIN` would mean "no such name".
- The **ANSWER SECTION** has the `A` record with the IP, and a number before it: the **TTL** in seconds.
- **`SERVER:`** at the bottom shows which resolver answered me.
- Running the same `dig` twice, the second **Query time** is usually shorter, because the resolver has cached the answer.

`dig +trace` was the best part. It doesn't ask my router. It does the whole walk itself, so I could see each step from the list above: the root servers, then the `.eu` servers, then my hosting provider's name servers, which finally gave the `A` record. `dig @1.1.1.1` asks Cloudflare's public resolver directly instead of my router, which is a quick way to check whether "my" DNS and the rest of the internet agree.

### Lesson Learned: The mystery port 53 on my server

Yesterday `ss` on the Dell showed something listening on `127.0.0.53` port 53, and I didn't know what it was. Today I found out:

```bash
cat /etc/resolv.conf     # nameserver 127.0.0.53
resolvectl status        # the real DNS servers it forwards to
```

`127.0.0.53` is **systemd-resolved**, a small local DNS helper on Ubuntu. Every program on the Dell asks it, and it forwards the question to the real resolver. So yesterday's mystery port is today's DNS.

## Lesson Learned: dig ignores the hosts file

I gave the Dell a name on my Mac by adding one line to the Mac's `/etc/hosts`:

```text
192.168.178.52   vaultlab.home
```

Then:

```bash
ping -c 2 vaultlab.home                       # works
dscacheutil -q host -a name vaultlab.home     # works
dig +short vaultlab.home                      # nothing!
```

`dig` always asks a DNS server directly, so it **never reads the hosts file**. `ping`, `curl` and browsers go through the operating system, which reads `/etc/hosts` first. So "dig says the name doesn't exist, but my browser opens it" is not a contradiction: they are asking different places. To check what a Mac really resolves a name to, `dscacheutil` is the better tool.

On a Mac, the cache is flushed with:

```bash
sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder
```

## HTTP is just text over TCP

Yesterday I sent text to my echo server over TCP. **HTTP is the same idea, with agreed rules for what the text says.** The client sends a request, the server sends a response, and both have the same shape:

```text
REQUEST                              RESPONSE
GET /api/hello HTTP/1.1   ← line 1   HTTP/1.1 200 OK            ← line 1
Host: vaultlab.home       ← headers  Content-Type: application/json
User-Agent: curl/8.x                 Content-Length: 140
Accept: */*                          (blank line)
(blank line)              ← end      { "message": "Hello..." }  ← body
```

- **Request line:** the method (what to do), the path (which thing), the HTTP version.
- **Status line:** the version, a status code and a short reason.
- **Headers:** `Name: value` lines with extra information.
- **Blank line:** "the headers are finished". This is how HTTP knows where a message ends, which is exactly the problem my echo server had yesterday with TCP being a stream.
- **Body:** the content.

| Status range | Means | The ones to know |
| --- | --- | --- |
| `2xx` | Success | `200 OK`, `201 Created`, `204 No Content` |
| `3xx` | Go somewhere else | `301` / `302` redirects, `304 Not Modified` |
| `4xx` | **The client** did something wrong | `400`, `401` (not logged in), `403` (not allowed), `404`, `405`, `429` |
| `5xx` | **The server** failed | `500`, `502`, `503`, `504` |

The rule I'll keep: **4xx → look at what was sent. 5xx → look at the server logs.**

### Reading curl -v

```bash
curl -v https://blog.nepeu.eu/ -o /dev/null
```

`-o /dev/null` throws the page away, so only the conversation is shown. The lines are easy to sort by their first character:

- `*` lines: what curl itself is doing. It **resolves the name** (DNS), **connects** to port 443 (TCP), then does the **TLS handshake** and shows the certificate.
- `>` lines: the request I sent.
- `<` lines: the response the server sent back.

So one `curl -v` shows every layer in order: **DNS → TCP → TLS → HTTP**. I also used `curl -sI`, which asks only for the headers, to look at `content-type`, the `location` header of a redirect, and the caching headers.

## Building an HTTP server with no framework

Express comes later in the month. First I wanted to see what it will be doing for me, so I wrote the smallest real HTTP server with Node's own `http` module. It's in `experiments/network/http-raw.js`. The main part:

```js
const server = http.createServer((req, res) => {
  const started = Date.now();

  // Log one line per request when the answer has been sent
  res.on("finish", () => {
    const ms = Date.now() - started;
    console.log(`${new Date().toISOString()} ${req.socket.remoteAddress} ${req.method} ${req.url} -> ${res.statusCode} (${ms} ms)`);
  });

  if (req.method === "GET" && req.url === "/api/hello") {
    return sendJson(res, 200, {
      message: "Hello from VaultLab",
      yourAddress: req.socket.remoteAddress,
      yourUserAgent: req.headers["user-agent"] || null,
      time: new Date().toISOString(),
    });
  }

  if (req.url === "/api/error") {
    // A handled error: the server catches it and answers 500
    try {
      throw new Error("Database is not reachable (simulated)");
    } catch (err) {
      console.error(`Handled error: ${err.message}`);
      return sendJson(res, 500, { error: "Internal Server Error" });
    }
  }

  if (req.url === "/api/crash") {
    // An UNHANDLED error: nothing catches it, so the whole process dies
    throw new Error("Unhandled crash (simulated)");
  }

  if (req.url.startsWith("/api/hello")) {
    return sendJson(res, 405, { error: `Method ${req.method} not allowed on /api/hello` });
  }

  return sendJson(res, 404, { error: `Nothing at ${req.url}` });
});
```

(The full file also has an `/api/headers` route that sends back every header the client sent, and handles "port already in use".)

What I understood from writing it:

- **`http` is built on top of yesterday's `net` module.** Node reads the TCP bytes, parses the request line and headers, and gives me `req` and `res`.
- **The `if` blocks are a tiny router.** Method + path decide the answer. That's all a REST API route is.
- **The status code is my choice.** Nothing forces a 404: my code writes it. That's also why a badly written server can answer `200` with an error inside.
- **One log line per request**, with the time, client IP, method, path, status and duration. It's the same kind of line real web servers write, and the kind I'll be reading in support work:

```text
2026-11-15T16:34:55.572Z 127.0.0.1 GET /api/hello -> 200 (9 ms)
```

I wrote it on the Mac, pushed it, pulled it on the Dell and ran it there on port 8080. I allowed 8080 in `ufw` only for my home network (`sudo ufw allow from 192.168.178.0/24 to any port 8080 proto tcp`), and then reached it from the Mac by name: `curl http://vaultlab.home:8080/api/hello`. The hosts file → the Dell's IP → port 8080 → my code. In the JSON, `yourAddress` showed the Mac's IP: the server always knows who connected.

## Lesson Learned: A server only knows what the client sends

To prove HTTP is only text, I typed a request by hand with `nc`:

```bash
printf 'GET /api/hello HTTP/1.1\r\nHost: vaultlab.home\r\nConnection: close\r\n\r\n' | nc vaultlab.home 8080
```

The whole raw response came back: status line, headers, blank line, JSON. Two things stood out:

- **`"yourUserAgent": null`**. I didn't send a `User-Agent` header, so the server never got one. curl adds `User-Agent` and `Accept` by itself, and a browser sends many more headers (language, encoding, and a much longer user agent). I compared all three with the `/api/headers` route.
- **`Connection: close`** asked the server to hang up after answering. Without it, HTTP/1.1 keeps the connection open for the next request (`keep-alive`), and `nc` would just sit there.

Then I sent something that isn't HTTP at all:

```text
$ printf 'HELLO\r\n\r\n' | nc vaultlab.home 8080
HTTP/1.1 400 Bad Request
Connection: close
```

Node's HTTP parser couldn't understand it and answered **400** before my code even ran, so my log had **no line** for it. Lesson: *no log line* can mean the request never reached my code.

When I opened the page in Chrome, the log also showed a request I never made: `GET /favicon.ico -> 404`. The browser asks for the tab icon by itself. It shows up in every server log and it's harmless, but it's good to recognise it.

## The whole journey of one request

Putting Day 4 and Day 5 together, a page only loads if every step works, in this order:

| Step | What happens | What I see when it fails |
| --- | --- | --- |
| 1. DNS | The name becomes an IP | `Could not resolve host`, `DNS_PROBE_FINISHED_NXDOMAIN` |
| 2. TCP | Connect to the IP and port (handshake) | `Connection refused` or `timed out` |
| 3. TLS | Only for https: certificate checked, keys agreed | A certificate error |
| 4. HTTP request | Method, path, headers sent | `400 Bad Request`, or `Empty reply from server` |
| 5. Server answers | My code picks the status | `4xx` or `5xx` |
| 6. Browser renders | HTML, CSS and JavaScript run | Status 200, but errors in the DevTools Console |

The right-hand column is the important part: **each step fails with a different message**, so the error text tells me which step broke before I touch anything.

## Break and fix

Then I broke every step on purpose. For each one, I said which step had failed from the error text **first**, and only then checked.

## Lesson Learned: "Could not resolve host" means don't touch the server

```text
$ curl http://vault.doesnotexist.invalid:8080/api/hello
curl: (6) Could not resolve host: vault.doesnotexist.invalid
```

Step 1, DNS. No IP was found, so no connection was ever tried, and my server log stayed silent. `dig vault.doesnotexist.invalid` showed `status: NXDOMAIN`. Restarting the server would do nothing here: the problem is the name.

## Lesson Learned: Check which IP a name became before blaming the network

This one is sneakier. I changed my hosts entry to an address where nothing exists:

```text
192.168.178.250   vaultlab.home
```

After flushing the cache, curl gave **no DNS error at all**. It just hung and timed out, which looks exactly like a network or firewall problem. But the real cause was step 1: the name resolved to the **wrong** IP. `curl -v` gave it away, because it prints the address it's trying (`Trying 192.168.178.250:8080...`), and `dscacheutil` showed the same. Putting the right address back and flushing again fixed it.

## Lesson Learned: Refused means nothing is listening

I stopped the server with `Ctrl + C` and tried again:

```text
curl: (7) Failed to connect to vaultlab.home port 8080 after ... ms: Couldn't connect to server
```

Step 2, TCP. DNS worked, the Dell answered, but nothing was listening on 8080, so it sent back a reset, exactly like yesterday. `sudo ss -tlnp | grep 8080` on the Dell printed nothing. Starting the server again and running curl again confirmed the fix.

## Lesson Learned: A 4xx means the request reached the server

```text
$ curl -i http://vaultlab.home:8080/api/helo
HTTP/1.1 404 Not Found
{ "error": "Nothing at /api/helo" }

$ curl -i -X POST http://vaultlab.home:8080/api/hello
HTTP/1.1 405 Method Not Allowed
{ "error": "Method POST not allowed on /api/hello" }
```

Step 5. Everything up to the server worked, and my log showed both lines with `-> 404` and `-> 405`. The server is fine: it **chose** to say no because of what I sent. A 4xx means look at the request: a typo in the URL, the wrong method, or a missing login.

## Lesson Learned: The real reason for a 500 is only in the server log

```text
$ curl -i http://vaultlab.home:8080/api/error
HTTP/1.1 500 Internal Server Error
{ "error": "Internal Server Error" }
```

The client only gets a vague message. The real reason was in the Dell's log tab:

```text
Handled error: Database is not reachable (simulated)
```

That's on purpose: users should never see internal details (like the file paths I saw in error messages on Day 3). It's also why "5xx → read the server logs" is the first move. And the server **survived**, because the error was caught.

## Lesson Learned: One unhandled error took the whole server down

```text
$ curl http://vaultlab.home:8080/api/crash
curl: (52) Empty reply from server
```

The Dell's log tab printed a stack trace, and the server was gone:

```text
Error: Unhandled crash (simulated)
    at Server.<anonymous> (.../experiments/network/http-raw.js:56:11)
```

The next normal request got `curl: (7) Couldn't connect to server`. So one bad request killed the server for **everyone**.

If a user reported this, they'd say "it worked, then suddenly everything stopped". The way to investigate: the request is refused → `ss` shows nothing on 8080 → the process isn't running → the last lines of the server log show the stack trace → line 56 of `http-raw.js`. I read it the way I learned on Day 3: the error type, the message, then the first line in my own file.

Today the fix was just restarting it. The real fix is to catch errors so one request can't crash the process. Express does that for me, which is one of the reasons I'll use it from Day 7.

### The table I'm keeping

| Error text | Step that failed | First thing to check |
| --- | --- | --- |
| `Could not resolve host` / `NXDOMAIN` | DNS | `dig`, `/etc/hosts`, spelling |
| Times out or reaches the wrong machine, no DNS error | DNS gave the wrong answer | Which IP did the name become? (`curl -v`) |
| `Connection refused` / `(7)` | TCP, nothing listening | `ss -tlnp`, is the process running? |
| Timed out / `(28)` | TCP, packets dropped | Firewall, wrong IP, machine off |
| Certificate error | TLS | Certificate name, expiry, issuer |
| `Empty reply` / `(52)` | The server closed without answering | Server log: did it crash? |
| `4xx` | The request was wrong | URL, method, headers, login |
| `5xx` | The server failed | Server log |

## Commands I used today

```bash
# DNS
dig blog.nepeu.eu
dig +short NS nepeu.eu
dig +trace blog.nepeu.eu
dig @1.1.1.1 +short blog.nepeu.eu
cat /etc/resolv.conf                          # Dell: 127.0.0.53
resolvectl status                             # Dell: real DNS servers
dscacheutil -q host -a name vaultlab.home     # Mac: what the OS resolves
sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder   # Mac: flush

# HTTP
curl -v https://blog.nepeu.eu/ -o /dev/null   # every layer in order
curl -sI https://blog.nepeu.eu/               # headers only
curl -i http://vaultlab.home:8080/api/hello   # status + headers + body
curl -X POST http://vaultlab.home:8080/api/hello
printf 'GET /api/hello HTTP/1.1\r\nHost: vaultlab.home\r\nConnection: close\r\n\r\n' | nc vaultlab.home 8080

# Server on the Dell
node experiments/network/http-raw.js
sudo ss -tlnp | grep 8080

# Temporary firewall rule (removed afterwards)
sudo ufw allow from 192.168.178.0/24 to any port 8080 proto tcp
sudo ufw status numbered
sudo ufw delete <number>
```

## Security things I noticed

- **Plain `http` can be read by anyone on the network.** My test server has no TLS, so every request and response travels as readable text. That's fine for an experiment at home, never for a password manager. HTTPS comes later in the month.
- **Error responses should be vague, logs should be detailed.** The 500 told the client nothing useful, while the log had the real reason. Leaking internal details helps attackers.
- **One unhandled error can be a denial of service.** If one request can crash the server, anyone who finds that request can take the service down.
- **The hosts file decides where a name goes.** It's handy for testing, but anyone who can change it can send me to the wrong server without any DNS error. It's also a reason why HTTPS certificates matter: they prove I reached the right server.
- **Firewall rules for testing get cleaned up.** I opened 8080 only for my home network, and removed the rule at the end of the day.

## Reflection

**What did I learn?**
How a name becomes an IP, the main DNS record types, what an HTTP request and response look like line by line, what status codes mean, and how to build an HTTP server without a framework.

**What did I understand better after practising?**
That loading a page is a chain of steps, and that each step has its own error message. Before, "it doesn't load" was one problem. Now it's six possible problems, and the error text tells me which one.

**What troubleshooting skills did I develop?**
Naming the failed step from the error message before checking anything, checking which IP a name actually became, and going to the server log when the response is a 5xx or an empty reply.

**What should I review next?**
The DNS lookup path and the "error text → step" table.

**What can I demonstrate now that I couldn't before?**
I can explain what happens when I type a URL and press Enter, step by step, with what goes wrong at each step, and I can show it with my own server.