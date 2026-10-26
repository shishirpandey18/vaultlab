# Day 21: Break VaultLab with XSS, then shut it down with CSP and headers

**Goal for today:** attack my own app. Add one realistic bug to VaultLab, watch a stored password-manager page run an attacker's JavaScript, then close it with a Content-Security-Policy and a set of security headers in nginx.

Everything ran on the Dell, where both the repo and nginx live. The vulnerable version was a teaching step: it was built **outside the repo** and the source was reverted at once, so nothing vulnerable was ever committed. Only the hardening is in the history.

---

## Lesson Learned: TLS was never the weak point

This is the Day 13 interview question, "how could an attacker get data out of a TLS-protected app?", answered from the inside. XSS (cross-site scripting) means an attacker's JavaScript runs inside my page, in the user's browser, on my origin. It then has everything the real page has:

- **AES-256-GCM at rest (Day 12) doesn't help.** The script reads the plaintext the API hands to the logged-in browser.
- **TLS (Day 13) doesn't help.** XSS runs after TLS has decrypted the page.
- **An `httpOnly` cookie (Day 10) limits it but doesn't stop it.**

Three kinds worth naming: **stored** (saved on the server, shown later: a vault item's title), **reflected** (bounced back from a URL or form: a search box that echoes `?q=`) and **DOM-based** (client JS writes it into the page: `innerHTML = location.hash`). I did stored, the most dangerous one here.

## Why VaultLab was safe, and the one prop that changes that

React escapes every value in `{curly braces}`, so a title of `<img src=x onerror=...>` is shown as literal text. The common way to defeat that is a prop named `dangerouslySetInnerHTML`, ugly on purpose so it stands out in review. I checked first: it appears nowhere in my source, and the title is `<strong>{item.title}</strong>`. For the lab build I changed that one line, built it into a scratch folder, reverted the source immediately, and deployed the scratch build. One trap: the string `dangerouslySetInnerHTML` is in **both** built bundles, because React's own code handles that prop, so you can't tell the builds apart by grepping the JavaScript. Only the browser or the source tells you.

## Break 1: the payload runs

I registered a throwaway account (I didn't know the old test password; the register screen made a new one) and added an item whose title was a harmless marker:

```text
<img src=x onerror="document.title='XSS-ran'">
```

**First, by accident, the safe build was still live**, and the page showed the title as literal text. That's the "after" picture I needed anyway. Once the vulnerable bundle was deployed and I hard-refreshed, **the browser tab's title changed to `XSS-ran`**: the title was inserted as a real `<img>` element, the image failed to load, and `onerror` ran. In the Elements panel there was a real element, not text.

A second item's title read the user's own vault and printed it to the Console only (nothing left the page). The Console showed the **whole vault, decrypted**, with both items' passwords in plain text (random test values; I'm not copying them anywhere). And the cookie?

```text
> document.cookie
""
```

Empty, because of `httpOnly: true`. So the classic "steal the session token and log in from my laptop" attack doesn't work. **But XSS is still a full compromise:** the script was already inside the logged-in page, so it didn't need the cookie. It called `/api/items` as the user and could have changed or deleted items, or posted everything to an attacker's server. `httpOnly` is a seatbelt, not the brakes: the real fix is to stop the script from running.

## Layer 1: remove the bug. Layer 2: a safety net

**Layer 1** is the real fix: never render untrusted data as HTML. Keep `{item.title}` and ban `dangerouslySetInnerHTML`. **Layer 2**, a Content-Security-Policy, limits the damage of the next bug I haven't found. A strict policy works for VaultLab because Vite bundles the app into one external script and one stylesheet. I checked the build before adding it: no inline scripts, no inline styles, no `style=` attributes, no external resources, and the API is same-origin. So `'self'` is enough, with no `'unsafe-inline'`.

```nginx
add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "DENY" always;
add_header Referrer-Policy "no-referrer" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
```

The headers before and after, on the app page:

```text
before:  Strict-Transport-Security: max-age=300            (nothing else)
after:   + Content-Security-Policy, X-Content-Type-Options, X-Frame-Options,
           Referrer-Policy, Permissions-Policy
```

**The test that matters:** I left the vulnerable build deployed *on purpose* and hard-refreshed. The tab title stayed `VaultLab`, and the Console printed, once per malicious item:

```text
Executing inline event handler violates the following Content Security Policy directive 'script-src 'self''.
Either the 'unsafe-inline' keyword, a hash ('sha256-...'), or a nonce ('nonce-...') is required to enable inline
execution. Note that hashes do not apply to event handlers, style attributes and javascript: navigations unless the
'unsafe-hashes' keyword is present. The action has been blocked.
```

Its stack trace named the **vulnerable** bundle: the hole was still there, and the policy caught it. That's defence in depth. It also shows why a nonce or hash wouldn't help against inline event handlers: the policy has to forbid them.

## What went wrong on the way

**The first header check showed no CSP.** The install script printed only HSTS right after the reload, though nginx had accepted the new file. A second `curl` a moment later showed the full set. A reload is graceful: new workers take over while old ones finish, so verify a second after reloading, not in the same instant.

## The trap that silently removes your headers

In nginx, `add_header` is **replace per scope**, not additive: a `location` inherits the server block's headers only if it defines **none of its own**. I added one harmless line to `location /`:

```nginx
location / {
    root /var/www/vaultlab;
    add_header Cache-Control "no-cache";
    try_files $uri /index.html;
}
```

```text
BEFORE  /             HSTS, CSP, X-Frame-Options
        /api/health   no-store, HSTS, CSP, X-Frame-Options
AFTER   /             Cache-Control: no-cache          <- only this
        /api/health   no-store, HSTS, CSP, X-Frame-Options   (unchanged)
```

`nginx -t` said `successful` the whole time, and the API looked perfect, while the one page that most needs the CSP lost it, with no error. The symptom is "present on some URLs, missing on others": always check the headers on the HTML page, not just an `/api` URL. The experiment restored the hardened config by itself afterwards, and I put a warning comment in `nginx-vaultlab.conf`.

## Final state

```text
item.title             <strong>{item.title}</strong>
dangerouslySetInnerHTML  found nowhere in client/src
CSP on the app page /   present
deployed bundle         the safe one
```

I checked in the browser that the safe build under the policy shows my two malicious items as plain text with no console errors, and that adding, revealing and deleting an item all still work. A CSP that blocks your own app is a bug too, so that check matters. The commit is only `deploy/nginx-vaultlab.conf` and `docs/web-security.md`: no vulnerable component, no payload script, no vault contents.

## Commands I used today

```bash
git switch -c day21-websec
npm run build -- --outDir <scratch>/dist-safe     # and dist-vuln, outside the repo
sudo rsync -a --delete <scratch>/dist-safe/ /var/www/vaultlab/
sudo nginx -t && sudo systemctl reload nginx
curl -sI https://vaultlab.home/ | grep -iE 'content-security|x-frame|x-content|referrer|permissions'
curl -sI https://vaultlab.home/api/health | grep -iE 'content-security|strict|cache-control'
grep -rn 'dangerouslySetInnerHTML' client/src
```

## Security things I noticed

- Escaping at the point where data meets the page is the primary defence; a CSP is the backup, not the plan.
- `httpOnly` stops token theft but not an attacker acting as the user for as long as the page is open.
- HSTS is still `max-age=300` (short on purpose while testing), and `Cache-Control: no-store` stays on every API response so decrypted data isn't cached.
- A real shared-vault product like Passbolt treats every stored field as hostile for exactly this reason.

## Not done yet

- A CSP `report-uri` or `report-to`, to see violations from real users.
- XSS in the other two kinds (reflected and DOM-based) and a search box test.
- The throwaway account and its two payload items are still in the database (harmless in the safe build).

## Reflection

**What did I learn?**
That TLS and encryption at rest don't protect a page from its own JavaScript, that a cookie flag limits one attack but not XSS, and that a strict CSP is possible when the app has no inline code.

**What did I struggle with?**
Keeping the vulnerable version out of the repo, and one wasted attempt where I looked at the safe build and thought the attack had failed. A reload that looked like it hadn't applied the headers also confused me for a moment.

**What did I understand better after practising?**
That `add_header` is replace-per-scope, that a check on `/api` can pass while the HTML page has no protection, and that defence in depth means the net catches the bug you haven't fixed.

**What should I review next?**
The other kinds of XSS, a CSP reporting endpoint, and a header check that runs against the HTML page every time.

**What can I demonstrate now that I couldn't before?**
I can show in DevTools the difference between React escaping a value and `dangerouslySetInnerHTML`, explain why TLS and AES-GCM don't stop XSS, read a CSP, and break and fix the nginx header inheritance.
