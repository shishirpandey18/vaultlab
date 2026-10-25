# Passbolt support playbook (Day 20)

Built from tickets I caused on purpose on my own Passbolt CE lab (a container on my Dell, see
`passbolt-lab.md`), diagnosed from the outside in, fixed and undone. Nothing here is a secret: no links, keys,
passphrases or addresses. Commands run inside the container; `cake` stands for
`su -s /bin/bash -c "/usr/share/php/passbolt/bin/cake ..." www-data`.

## The request chain: where a Passbolt request can fail

```
Browser + extension ──► name & TLS ──► Dell: ufw, port 8443 ──► LXD proxy ──► nginx :443 ──► php-fpm ──► MySQL
(holds the private key)                                                          │              └─► GnuPG
                                                                      cron ──► email queue ──► SMTP
```

Walk it left to right and stop at the first link that breaks. Two facts explain half the tickets: the private
key never leaves the user's browser (so a lost passphrase is not a server problem), and the extension is tied to
the exact URL (scheme, name and port all count).

## The status code tells you which layer to read

| You see | Meaning | Read next |
| --- | --- | --- |
| no answer / certificate warning | name, network or TLS | `getent hosts`, `curl -v`, `openssl s_client` |
| **502** | nginx is up, nothing answers behind it | nginx `error.log` (it names the socket or address) |
| **500** | PHP ran but crashed on something it needs | `/var/log/passbolt/error.log` |
| 4xx | the request or permissions | the request itself, the user's role |

## Tickets I ran

### 1. "I invited someone but they never got the email" (mail server missing)
- **First checks:** `cake passbolt show_queued_emails` (invite waiting, with an Error column), `ss -tln` for
  port 1025, `cake passbolt send_test_email` (prints the trace).
- **Root cause:** nothing listened on the SMTP port. The queue worked; the mail server was not there.
- **Fix:** start the mail service. The queued invitation went out on the next cron run.
- **Lesson:** `Connection refused` in the Error column = the mail server. Judge delivery by the mailbox, not by that column.

### 2. "Nobody has received any Passbolt emails" (scheduler stopped)
- **First checks:** the same, plus `systemctl is-active cron` and when `/var/log/passbolt/cron.log` was last written.
- **Root cause:** cron was stopped. The port was listening and a manual `email_digest send` worked.
- **Fix:** start cron.
- **Lesson:** queue full + Error column empty + stale `cron.log` = nobody is sending, and there is no error anywhere.
  Compare ticket 1: queue full + errors = sending fails.

### 3. "New laptop and Passbolt won't let me in" (recovery)
- **Not run yet.** The plan: clarify whether the user still has the recovery kit and passphrase, then `/recover`
  on the new browser. An admin can generate a recovery link with `cake passbolt recover_user`; treat it like a password.

### 4. "My browser says the connection is not private" (certificate)
- **First checks:** the browser's error code under Advanced, then `openssl s_client` against the name, and again against the IP
  (look at "Verify return code"), and `curl` with and without the CA.
- **Root causes (the same warning page has two):** the address was the IP, which the certificate doesn't name
  (`ERR_CERT_COMMON_NAME_INVALID`, verify code 62); or the browser doesn't trust the CA (Firefox keeps its own store;
  verify code 21, unknown issuer).
- **Fix:** use the name (a bookmark); import the CA into that browser (the public certificate only).
- **Lesson:** never tell a user to "accept the risk" on a password manager: clicking through is how a man-in-the-middle
  attack succeeds. A browser's own help text can be misleading (Firefox said "nothing you can do").

### 5. "502 Bad Gateway" (PHP-FPM stopped)
- **First checks:** `curl` the page (502), nginx `error.log`, `systemctl status php8.3-fpm`.
- **Root cause:** the PHP socket was gone, so nginx had nobody to talk to. The TLS, firewall and proxy all worked.
- **Fix:** start php-fpm.
- **Lesson:** the command-line health check runs PHP directly and can look almost green. It did report one failure,
  that it could not reach `/healthcheck/status` at `fullBaseUrl`, and the web check returned the 502.

### 6. "An error page when I log in" (database stopped)
- **First checks:** a request that needs the database (500), Passbolt `error.log` (`SQLSTATE[HY000] [2002] Connection refused`),
  `systemctl status mysql` and the journal, then disk and memory.
- **Root cause:** MySQL was stopped (a clean stop, no out-of-memory kill, disk fine).
- **Fix:** start mysql.
- **Lesson:** 502 = nobody behind nginx; 500 = PHP ran and crashed. The health check can crash with the same error
  instead of printing red lines, so a crash is an answer too. Read log timestamps: old errors from an earlier problem look like clues.

### 7. "Could not verify the server key" (key file unreadable)
- **First checks:** the full health check (four failures: private key not readable, fingerprint mismatch, no valid
  email id, key format), then the file's owner and mode against what it was before.
- **Root cause:** the server's private key file had mode 000.
- **Fix:** restore the **recorded** mode and owner (here 440, `www-data:www-data`). Never `chmod 644` a server private key.
- **Lesson:** it was a **latent failure**: sign-in kept working, because the key was already imported into Passbolt's
  own keyring and GnuPG uses that at login. The health check was red while users were fine. Record permissions before
  you change them. `healthcheck --gpg` does not exist in 5.18; use the full check.

### 8. "Links in Passbolt emails don't work" (`fullBaseUrl` without the port)
- **First checks:** the link in a fresh invitation, then the health check.
- **Root cause:** `fullBaseUrl` had no `:8443`, so links pointed at port 443, which is another site's nginx with another
  certificate (name mismatch).
- **Fix:** restore the backed-up config, clear the cache.
- **Lesson:** one cause, several symptoms: a failed self-check plus three misleading SSL warnings (even "self-signed",
  although the certificate never changed). Users kept working. Changing the scheme, name or port is a planned migration
  with an announcement, never a quick config edit: each user's extension stores the exact URL.

## Tickets answered on paper

### A. "I forgot my passphrase. Can you reset it?"
In Community Edition there is no reset: the passphrase protects the private key, which lives only in the user's
browser and recovery kit, and the server never had it. What I can do: let them try again calmly, then delete the
account and re-invite (new key; shared passwords are re-shared, passwords only that user held are gone). Prevention:
share important passwords with a group or at least two people. The reply is empathy, an honest "this can't be reset
and here is why that protects you", the plan, and what I do for them now.

### B. "Login fails on one laptop only, with a server key error" (clock)
Plan: clarify, compare `date -u` on both sides, check `timedatectl` on the server, ask the user to set time
automatically, then Console and Network on that laptop and the Passbolt log. "If one client fails and the others
work, I first look for what is different about that client: browser, extension version, clock, network. If everyone
fails, I start on the server."
