# Web security notes: XSS, CSP and security headers (Day 21)

VaultLab's React client and nginx, attacked on purpose in a lab and then hardened. The vulnerable build was a
teaching step: it never went into a commit. Only the hardening is in the repo.

## Why XSS is the worst bug for a password manager

Cross-site scripting means an attacker's JavaScript runs inside the page, on the page's origin, in the user's browser.
It then has everything the real page has: the logged-in session, the right to call the API, and the decrypted
passwords once they are on screen.

- **AES-256-GCM at rest (Day 12) doesn't help:** the script reads the plaintext the API hands to the logged-in browser.
- **TLS (Day 13) doesn't help:** XSS runs after TLS has decrypted the page. An attacker doesn't have to break TLS to get
  data out of a TLS app.
- **An `httpOnly` cookie limits it but doesn't stop it:** `document.cookie` was empty in the vulnerable build, so the
  session token couldn't be stolen. But the script was already inside the logged-in page, called `/api/items`, and read
  the whole vault. `httpOnly` is a seatbelt, not the brakes.

## Three kinds

| Kind | Where the payload lives | VaultLab example |
| --- | --- | --- |
| Stored | saved on the server, shown later | a vault item's title shown in the list |
| Reflected | bounced back from the URL or a form | a search box that echoes `?q=` into the page |
| DOM-based | never leaves the browser; client JS writes it into the page | `innerHTML = location.hash` |

## Why VaultLab was safe, and how it stops being safe

React escapes every value in `{curly braces}`: a title of `<img src=x onerror=...>` is shown as literal text. The one
common way to defeat that is to ask React to stop escaping, with a prop named `dangerouslySetInnerHTML`. It is named that
on purpose so it stands out in review. In the lab build, a title with a harmless marker payload,

```text
<img src=x onerror="document.title='XSS-ran'">
```

changed the browser tab's title: the value was inserted as a real `<img>` element, the image failed to load, and
`onerror` ran. In DevTools the Elements panel showed a real element instead of text; that is the tell. With the escaped
`{item.title}` the same title is plain text and nothing runs.

**Rule for VaultLab:** `dangerouslySetInnerHTML` is banned. A password manager has no reason to render HTML in a title.
If rich text were ever needed, sanitize it first (for example DOMPurify). Correct output encoding, at the point where
data meets the page, is the primary defense; everything below is a safety net.

## Layer 2: Content-Security-Policy and supporting headers

A CSP tells the browser which sources of script, style and other content it may load and run. With
`script-src 'self'`, even an injected inline handler is refused. In the lab, with the bug still present, the browser
printed this in the Console and the tab title stayed `VaultLab`:

```text
Executing inline event handler violates the following Content Security Policy directive 'script-src 'self''.
Either the 'unsafe-inline' keyword, a hash ('sha256-...'), or a nonce ('nonce-...') is required to enable inline
execution. Note that hashes do not apply to event handlers, style attributes and javascript: navigations unless the
'unsafe-hashes' keyword is present. The action has been blocked.
```

A strict policy is possible because Vite bundles the app into one external script and one stylesheet, with no inline
scripts, no inline styles and no external resources. The block in `deploy/nginx-vaultlab.conf`:

```nginx
add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "DENY" always;
add_header Referrer-Policy "no-referrer" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
```

| Directive | Effect | Why it matters here |
| --- | --- | --- |
| `script-src 'self'` | only scripts from this origin run; no inline `onerror`, no inline `<script>` | neutralised the attack |
| `default-src 'self'` | the fallback for everything not named | no scripts from another domain |
| `connect-src 'self'` | `fetch`/XHR may only reach this origin | injected code can't POST the vault to an attacker's server |
| `img-src 'self'` | images only from this origin | an `<img src=...>` can't beacon out |
| `object-src 'none'` | no plugins | removes a legacy bypass |
| `frame-ancestors 'none'` | the page can't be framed | clickjacking (the modern `X-Frame-Options`) |

Note: a hash or nonce does not help against inline event handlers. The policy has to forbid them.

## The trap: nginx `add_header` is replace-per-scope

`add_header` directives are inherited by a `location` only if that location defines **none of its own**. Add one
unrelated header inside a location and nginx drops every inherited header, silently, and `nginx -t` still passes.
Reproduced in the lab by adding `add_header Cache-Control "no-cache";` to `location /`:

| | before | after |
| --- | --- | --- |
| `/` (the app page) | HSTS, CSP, X-Frame-Options | only `Cache-Control: no-cache` |
| `/api/health` | `no-store`, HSTS, CSP, X-Frame-Options | unchanged |

The API looked perfect while the HTML page, which needs the CSP most, had none. The symptom is "the header is on some
URLs but not others". Always check the headers on the HTML page, not only an `/api` URL. To avoid it: don't put an
`add_header` in the location that serves the app, or repeat the whole set there, or keep the set in one file that is
included in every location. A warning comment now sits in `nginx-vaultlab.conf`.

Also: `nginx -s reload` is graceful (new workers take over while old ones finish), so a `curl` in the same instant
can still show the old response. Verify a moment after reloading.

## Verify

```bash
sudo nginx -t && sudo systemctl reload nginx
curl -sI https://vaultlab.home/ | grep -iE 'content-security|x-frame|x-content|referrer|permissions'    # the HTML page
curl -sI https://vaultlab.home/api/health | grep -iE 'content-security|strict|cache-control'          # the API
grep -n 'item.title' client/src/components/ItemCard.jsx            # <strong>{item.title}</strong>
grep -rn 'dangerouslySetInnerHTML' client/src                       # must find nothing
```

A bundle check doesn't work: the string `dangerouslySetInnerHTML` appears in React's own library code, so it appears in
every built bundle. Test in the browser, and read the source.

## What I would add next

HSTS is still `max-age=300` (short on purpose while testing), `Cache-Control: no-store` stays on every API response
so decrypted data isn't cached, and a CSP `report-uri` or `report-to` would show violations from real users.
