# Day 13: HTTPS and TLS, with nginx and my own CA

**Goal for today:** see what anyone on my network could read from VaultLab, then put nginx in front with HTTPS, a certificate from my own small certificate authority, HSTS, and the API hidden behind it. Then break it in seven ways and learn to read each error.

**My setup:** today the Dell was both the server and the client. The Mac wasn't free, so I used Brave on the Dell, with `vaultlab.home` pointing to `127.0.0.1` in `/etc/hosts`. Everything below uses test accounts.

---

Day 12 protected the passwords **on the disk**. But VaultLab still spoke plain HTTP, so every login, every session cookie and every decrypted vault password crossed the network as readable text. Today was about the network.

## Lesson Learned: Encryption at rest doesn't protect the wire

Before changing anything, I listened to my own API with `tcpdump`:

```bash
sudo tcpdump -i any -A -s 0 -l 'tcp port 3000' | grep --line-buffered -E '"password"|Set-Cookie|Cookie:'
```

`-A` prints packet contents as text, `-l` prints each line straight away, and `'tcp port 3000'` keeps only my API's traffic. Then I logged in from the browser with a test account. Shortened:

```text
{"email":"shishir@example.com","password":"correct-horse-battery"}
Set-Cookie: vaultlab_session=...; Max-Age=28800; Path=/; ...; HttpOnly; SameSite=Lax
{"id":24,"title":"Facebook","username":"...","password":"..."}
```

Three things in plain text:

- **The login password**, as typed. scrypt protects it in the database (Day 10), not on its way there.
- **The session cookie.** `HttpOnly` keeps it from JavaScript, but whoever reads it here can paste it into their own browser and be me for 8 hours.
- **A vault password**, decrypted. Day 12's encryption protects the disk; the server decrypts before answering.

## What TLS gives you

| Property | Means |
| --- | --- |
| Confidentiality | Nobody in between can read the data |
| Integrity | Nobody in between can change it |
| Authentication | You're talking to the real server, not an impostor |

The third one is what certificates are for. Encrypting perfectly to the wrong server protects nothing.

## A real certificate chain

I looked at Passbolt's own site:

```text
Certificate chain
 0 s:CN = passbolt.com
   i:C = US, O = Google Trust Services, CN = WE1
 1 s:C = US, O = Google Trust Services, CN = WE1
   i:C = US, O = Google Trust Services LLC, CN = GTS Root R4
 2 s:C = US, O = Google Trust Services LLC, CN = GTS Root R4
   i:C = BE, O = GlobalSign nv-sa, OU = Root CA, CN = GlobalSign Root CA
Server Temp Key: X25519, 253 bits
New, TLSv1.3, Cipher is TLS_AES_256_GCM_SHA384
Verify return code: 0 (ok)
```

- Depth 0 is the site, signed by the **intermediate** `WE1`, signed by the root `GTS Root R4`.
- Depth 2 is a **cross-signature**: Google's newer root, signed by GlobalSign's older one, so devices that only know GlobalSign still trust it.
- The cipher is `TLS_AES_256_GCM_SHA384`: AES-256-GCM, the same algorithm I used for the vault yesterday, now protecting a connection.
- `X25519` is the key exchange: both sides compute the same secret without ever sending it, and a fresh one per connection gives **forward secrecy**. Stealing the server's key later doesn't decrypt today's recorded traffic.

The TLS 1.3 handshake in four steps: the client says what it supports and which site it wants (SNI); the server picks and sends its half of the key exchange; the server sends its certificate plus a **signature** that proves it holds the private key; both sides send `Finished`, a check that nobody changed the handshake on the way.

## My own certificate authority

`vaultlab.home` only exists on my home network, so no public CA will sign it. Instead I made a tiny private CA, the way companies do for internal services:

```bash
openssl req -x509 -new -key ca.key -sha256 -days 825 -subj "/CN=VaultLab Home CA" \
  -addext "basicConstraints=critical,CA:TRUE,pathlen:0" \
  -addext "keyUsage=critical,keyCertSign,cRLSign" \
  -addext "nameConstraints=critical,permitted;DNS:vaultlab.home" \
  -out ca.crt
```

The line I care most about is the **name constraint**. When a browser trusts a root CA, that root can normally sign a certificate for any site, my bank included. With `permitted;DNS:vaultlab.home`, my CA may only vouch for `vaultlab.home`, so if `ca.key` were ever stolen, the damage stays in my lab.

Then a key and a certificate for the server, signed by the CA (valid for 397 days):

```text
vaultlab.home.crt: OK
subject=CN = vaultlab.home
issuer=CN = VaultLab Home CA
X509v3 Extended Key Usage:
    TLS Web Server Authentication
X509v3 Subject Alternative Name:
    DNS:vaultlab.home
```

Browsers read the name from **Subject Alternative Name**, not from the `CN`. `ca.key` stays in a folder only I can read and never goes near the repo; the server's key goes to nginx, readable by root only.

## nginx in front

VaultLab now looks like this:

```text
browser ──HTTPS :443──► nginx ──HTTP, 127.0.0.1:3000──► Node API ──► MariaDB
        ──HTTP  :80 ──► nginx: "301, go to HTTPS"
                         nginx also serves the built React app
```

This is how real deployments work, Passbolt's included: a **reverse proxy** does the TLS, and the application behind it stays simple. The configuration lives in the repo as `deploy/nginx-vaultlab.conf`. The parts that matter:

- **Port 80 only redirects** (`return 301 https://...`). Nothing is ever served unencrypted.
- **`ssl_protocols TLSv1.2 TLSv1.3`**: the broken old versions are off.
- **HSTS** (`Strict-Transport-Security: max-age=300`): "for the next 5 minutes, never even try HTTP for this name". Short on purpose while testing; real sites use a year.
- **`/api/` goes to `127.0.0.1:3000`**, with `X-Forwarded-For` and `X-Forwarded-Proto` so Node knows who the real client was.
- **`server_tokens off`**, so it says `nginx`, not the exact version.

And three small changes on the Node side:

- `HOST=127.0.0.1`: the API no longer listens on the network at all. Only nginx, on the same machine, can reach it. I also removed the firewall rule for 3000 and opened 80 and 443 to my home network instead.
- `app.set('trust proxy', 'loopback')`: trust the forwarded headers only when they come from nginx.
- `secure: true` on the session cookie: the Day 10 `TODO` is done.

The checks:

```text
curl: (60) SSL certificate problem: unable to get local issuer certificate     <- without my CA
{"status":"ok","database":"ok",...}                                            <- with --cacert
HTTP/1.1 301 Moved Permanently                                                 <- port 80
Strict-Transport-Security: max-age=300                                         <- HTTPS
Set-Cookie: vaultlab_session=...; HttpOnly; Secure; SameSite=Lax               <- login
```

## In the browser

I imported the CA into Brave after comparing its SHA-256 fingerprint with the one on the server. You only tell a device "trust everything this signs" after checking it's really yours. Then `https://vaultlab.home` showed a padlock, and DevTools showed:

- the request going to port `:443`
- `Strict-Transport-Security` in the response headers and the cookie with **Secure** and **HttpOnly**
- typing `http://vaultlab.home` gave **`307 Internal Redirect`** with `non-authoritative-reason: HSTS`. The browser never sent that request: it remembered HSTS and switched to HTTPS by itself.

Then the same capture on port 443: the only readable thing was `vaultlab.home`, the **SNI** sent before encryption starts. No password, no cookie. On the loopback interface between nginx and Node, though, the password was still plain text, with `X-Forwarded-Proto: https`. That's where TLS **ends**. It's fine here, because that hop never leaves the machine, but "is it encrypted end to end?" has an honest answer: no, it's encrypted to nginx.

## Break and fix

I ran seven breaks. For Break 3 I made the expired certificate and installed it in nginx. Break 5 used a separate nginx on port 8080 rather than my real configuration, with `curl`'s trace of the bytes standing in for a `tcpdump` capture.

| Break | What happened |
| --- | --- |
| 1. A client that doesn't trust my CA | curl `exit 60`, Node `UNABLE_TO_VERIFY_LEAF_SIGNATURE`, Node with `NODE_EXTRA_CA_CERTS`: `200` |
| 2. The wrong name (`https://127.0.0.1`) | `no alternative certificate subject name matches target host name` |
| 3. An expired certificate (valid Jan–Feb 2025) | `nginx -t` passed, then `certificate has expired` |
| 4. The API stopped | `502 Bad Gateway` for the API while the page itself loaded `200` |
| 5. The app served on plain HTTP | Login `200` over HTTP, password visible in the request, `/me` `401` |
| 6. TLS 1.0 and 1.1 | `alert protocol version`; 1.2 and 1.3 worked |
| 7. Who to trust for `X-Forwarded-For` | Depends entirely on one setting (below) |

## Lesson Learned: Every program has its own trust store

Break 1 was the same server and the same certificate, with three different results. Brave trusted it because I imported the CA; curl and Node didn't, because each has its own list of trusted roots. **"It works in my browser but not in the script"** is almost always this, and the fix is to give that client the CA, never to switch verification off (`-k`, `NODE_TLS_REJECT_UNAUTHORIZED=0`).

## Lesson Learned: An expired certificate stops everything, and `nginx -t` won't warn you

For Break 3 I used a certificate that expired in February 2025, made with `openssl ca` (which accepts dates; `openssl x509 -req` can only start "now"). `nginx -t` was perfectly happy, because it checks that the files exist and match, not the dates. Every user would be locked out at the same second, with nothing changed in the code. The check that catches it in time:

```bash
echo | openssl s_client -connect vaultlab.home:443 -servername vaultlab.home 2>/dev/null | openssl x509 -noout -enddate
```

A detail that confused me: my first checks after `systemctl reload nginx` still saw the **old** certificate, and after I put the good one back, the first check still failed with "expired". `reload` returns before the new worker processes have taken over, so for a moment the old ones keep answering. Waiting a second fixed it. Worth knowing before concluding "my change didn't work".

## Lesson Learned: 502 means "nginx is fine, the thing behind it isn't"

With the API stopped, the page loaded but every API call returned `502`, and nginx's error log said exactly why:

```text
connect() failed (111: Connection refused) while connecting to upstream, ... upstream: "http://127.0.0.1:3000/api/health"
```

That's the most useful reading of the day for support. A **502 comes from the proxy**, and its log names the address it tried. A **500 comes from the application**, and its details are in the app's own log. The next steps for a 502 are the Day 4 ones: is the process running, and is it listening on that port?

## Lesson Learned: Secure cookies don't save a login done over HTTP

Break 5 served the whole app on port 80 instead of redirecting. Logging in over plain HTTP worked, the password was readable in the request, and `/me` afterwards answered `401`, because curl wouldn't keep a `Secure` cookie that arrived over HTTP at all. So `Secure` did its job, but too late: the password and the session token had already crossed the network in plain text.

This is what **SSL stripping** arranges: an attacker in the middle keeps the victim on HTTP while talking HTTPS to the real server. The defences are the two things the break removed: never serve anything on port 80 except a redirect, and **HSTS**, so the browser never tries HTTP in the first place. The `307 Internal Redirect` I saw in Brave is that defence working.

## Lesson Learned: `trust proxy` decides who can lie to your logs

Behind nginx, Node only ever sees connections from `127.0.0.1`, so the real client address has to come from `X-Forwarded-For`. Seven failed logins for a test account, each with a forged `X-Forwarded-For` header:

| Setting | Result |
| --- | --- |
| `'loopback'` | Five `401`, then `429`. The limiter works, and the log shows the real address |
| `true` | Seven `401`, never `429`. The log shows the forged addresses |
| Not set | The limit works, but every log line says `127.0.0.1`, and every user shares one counter |

With `true`, Express believes the **leftmost** address, which the attacker wrote. That means unlimited password guesses (Day 10's limiter is bypassed), and the attacker chooses what my logs say about them.

There was one more twist. Testing from the Dell with `vaultlab.home` pointing to `127.0.0.1`, even `'loopback'` gave seven `401`s. A local client's own address is also loopback, so Express trusts every hop and walks back to the forged address. Connecting through the Dell's LAN address (`192.168.178.52`) instead gave the results above: nginx appends a non-loopback address, Express stops there, and the limiter works. I didn't test from a second computer, but that is the same situation. The answer to "which address is the client?" depends on where the request comes from.

## How an attacker can still get information from a TLS connection

Properly configured TLS 1.2 and 1.3 aren't broken by reading the traffic, so attackers go around the encryption:

1. **Avoid TLS: SSL stripping.** Keep the victim on HTTP. Defence: redirect only, HSTS, and the HSTS preload list for the very first visit.
2. **Weaken TLS: downgrade.** Make both sides agree on an old version or weak cipher, then break that, like POODLE (forcing SSL 3.0) or FREAK and Logjam (forcing weak "export" keys). Defence: don't support weak options at all (Break 6). TLS 1.3 also signs the whole handshake, and marks its random value when it has to use an older version, so a 1.3 client notices.
3. **Impersonate the server.** Present a fake certificate. Works if the user clicks through the warning, or if the attacker's CA is trusted. Defence: never click through, protect CA keys, and use name constraints.
4. **Read the metadata.** The hostname (SNI, DNS), IP addresses, sizes and timing are all still visible.
5. **Attack the ends.** TLS ends somewhere: the client, the server, the hop behind the proxy.

And "downgrade" can mean route 1 or route 2. Asking which one someone means is a fair clarifying question.

## Commands I used today

```bash
# Listening to traffic
sudo tcpdump -i any -A -s 0 -l 'tcp port 3000' | grep --line-buffered -E '"password"|Set-Cookie'

# Looking at a certificate and handshake
echo | openssl s_client -connect www.passbolt.com:443 -servername www.passbolt.com 2>/dev/null | grep -E 'Certificate chain| s:| i:|Cipher is|Verify return'
openssl x509 -in vaultlab.home.crt -noout -subject -issuer -dates -ext subjectAltName

# nginx
sudo nginx -t && sudo systemctl reload nginx
sudo tail /var/log/nginx/error.log

# Testing HTTPS with my own CA
curl --cacert ~/vaultlab-ca/ca.crt https://vaultlab.home/api/health
NODE_EXTRA_CA_CERTS=~/vaultlab-ca/ca.crt node -e "fetch('https://vaultlab.home/api/health').then(r => console.log(r.status))"

# Which TLS versions does the server accept?
openssl s_client -connect vaultlab.home:443 -tls1_1 -cipher 'DEFAULT@SECLEVEL=0'
```

## Security things I noticed

- My login password, session cookie and vault passwords were readable on the network until today.
- A capture shows everything that was typed, so a lab should only ever use test accounts.
- My CA can only sign for `vaultlab.home`, and its key never leaves its folder.
- Node listens on `127.0.0.1` only; the firewall no longer opens 3000.
- The session cookie is `Secure`, HSTS is on, and port 80 only redirects.
- `trust proxy` must trust only the proxy, or attackers can bypass rate limits and forge log entries.
- TLS ends at nginx. The hop behind it is plain text, on the same machine.
- My firewall allows everything on the Tailscale interface, so 80 and 443 are reachable from my own Tailscale devices too. That's a choice I made consciously.

## Reflection

**What did I learn?**
What TLS protects and what it doesn't, how a certificate chain is checked, how to run my own CA safely, and how a reverse proxy changes where TLS ends and which address the app sees.

**What did I struggle with?**
Telling apart "my change didn't work" from "the old process is still answering" after an nginx reload, and why the same `trust proxy` setting behaved differently from the Dell itself and from its network address.

**What did I understand better after practising?**
Seeing my own password in a capture made "use HTTPS" concrete, and seeing a `307 Internal Redirect` I never sent made HSTS concrete.

**What should I review next?**
The five ways around TLS, and the error table: authority, name, date, 502, protocol version.

**What can I demonstrate now that I couldn't before?**
I can set up HTTPS with nginx and my own CA, read a certificate chain with `openssl`, diagnose the common certificate errors from their messages, and explain how an attacker could still get information from a TLS-protected connection, with examples I've seen myself.
