# Day 20: Passbolt support tickets: break it, diagnose it, answer the user

**Goal for today:** work the Passbolt from Day 19 as its support engineer. Cause a problem on purpose, forget that I caused it, diagnose it from the outside in, fix it, and write the reply to the user and the internal note. The build is small; the skill is the order I look in and what I say afterwards.

Invitations were created with `cake passbolt register_user`, which queues the same email as the browser form.

**Done:** tickets 1, 2, 4, 5, 6, 7 and 8, and two paper tickets (drafted). **Not done:** ticket 3 (a new laptop and recovery), which needs a second browser profile and bob's recovery kit.

---

## Lesson Learned: the chain, left to right

```text
Browser + extension ──► name & TLS ──► Dell: ufw, port 8443 ──► LXD proxy ──► nginx :443 ──► php-fpm ──► MySQL
(holds the private key)                                                          │              └─► GnuPG
                                                                      cron ──► email queue ──► SMTP
```

Every ticket is answered by walking this chain from left to right and finding the first link that breaks. It's the structured answer to "how do you troubleshoot?". Two facts explain half the tickets: **the private key never leaves the user's browser** (so a lost passphrase isn't a server problem), and **the extension is tied to the exact URL** (scheme, name and port all count).

## The baseline and the safety net

Before breaking anything I saved a "known good" health check and took a snapshot (`lxc snapshot passbolt day20-start`), so a bad break costs one command:

```text
Passbolt CE 5.18.0, CakePHP 5.4.3
nginx, mysql, php8.3-fpm, cron, mailcatcher: all active
Healthcheck: 64 PASS, 5 WARN, 0 FAIL
```

The five warnings are ones I could already explain (NTP inactive, SMTP endpoints enabled, host availability checking off, some email notifications off, a stale model schema cache), so I couldn't blame them on a break later. Note the database service is `mysql`: Day 19's package brought MySQL 8, not MariaDB.

**Two surprises before the first ticket.** I typed `sudo lxc restore passbolt day20-start` by mistake. It restarted the container, and everything came back except the **mail catcher**, because I'd started it as a temporary `systemd-run` unit. It's a permanent, enabled service now, which Day 20 needs anyway. And the snapshot of a container on the plain `dir` storage driver is a full copy: the second one got stuck for over ten minutes, so I cancelled and retried it.

## Tickets 1 and 2: emails that don't arrive, two different causes

**Ticket 1: "I invited Mallory but she never got the email."** I stopped the mail catcher and invited her. The checks:

```text
show_queued_emails     the invitation waits, last column (sent) empty
ss -tln                no row for port 1025: nothing listens
systemctl is-active cron   active  (the job runs every minute)
email_digest send      "sent":0,"failed":1,"pending":1
send_test_email        Unable to connect to tcp://127.0.0.1:1025 (Connection refused)
```

**The queue works; the mail server is not there.** I started the catcher, and on the next cron run the queued invitation went out (`"sent":1,"failed":0`), after an outage of about a minute. (I haven't tested a longer outage, so I can't say where Passbolt gives up.) The Day 19 "shared a resource" email, stuck while the catcher was down, went out at the same moment.

**Ticket 2: "Nobody has received any Passbolt emails."** This time I stopped `cron` and invited another test user. The checks are the same, but the answers are the opposite:

| | Ticket 1: mail server missing | Ticket 2: scheduler stopped |
| --- | --- | --- |
| queue | full | full |
| port 1025 | **nothing listening** | listening |
| `cron` | active | **inactive** |
| Error column | `Connection refused` | **empty** (nobody tried) |
| manual `email_digest send` | fails | works |
| `cron.log` | recent | **stale** |

A stopped cron leaves no error anywhere. The only evidence is a growing queue with an empty Error column and a log that hasn't been written for minutes. After `systemctl start cron`, the scheduler itself delivered the next invitation within the minute. A good idea for later: have the Day 16 monitor watch the age of the oldest queued email.

## Ticket 5: 502, and the health check trap

I stopped PHP-FPM. The page went from `302` to **502**. TLS, the firewall and the proxy were fine (same certificate, same answer from nginx), and nginx's error log named the problem:

```text
connect() to unix:/run/php/php8.3-fpm.sock failed (2: No such file or directory)
```

The command-line health check runs PHP directly, so most of it passed. It did report one failure, *"Could not reach the /healthcheck/status with the url specified in App.fullBaseUrl"*, and the web version of the same check returned the 502. Someone who only looks for green could miss an outage. After `systemctl start php8.3-fpm`, the check matched the baseline again.

## Ticket 6: 500, and a health check that crashes

I stopped MySQL. A request that needs the database returned **500**, and Passbolt's log said why:

```text
Connection to Mysql could not be established: SQLSTATE[HY000] [2002] Connection refused
```

**502 means nginx had nobody to talk to; 500 means PHP ran but crashed on something it needed.** The status code tells you which layer to read next. Two traps: the health check didn't print red lines, it **crashed with the same error and an HTML error page** (my count of `[FAIL]` lines was zero), and nginx error lines from the previous ticket looked like clues until I read their timestamps. I also ruled out the usual real-life causes: the journal showed a clean stop (no out-of-memory kill) and the disk was at 30%.

## Ticket 7: the key file, and a login that kept working

I recorded the permissions first (`440`, `www-data:www-data` for both key files), then made the server's private key unreadable with `chmod 000`. The full health check flipped four checks to FAIL (private key not readable, fingerprint mismatch, no valid email id, key format). I couldn't find `healthcheck --gpg` from the guide: `Unknown option gpg` in this version.

The guide predicted that nobody could sign in. **But signing out and in again worked.** The nginx log showed the normal login steps with `200`. The reason is that the server key had already been imported into Passbolt's own keyring (`/var/lib/passbolt/.gnupg`), and GnuPG uses that at login. The `.asc` file is read by the health check and at import. So it was a **latent failure**: the check is red while users are fine, until something re-imports or re-checks the key. I haven't tested a restart. The fix was the **recorded** mode, never `chmod 644`, which would make a server private key readable by any local account.

## Ticket 8: one config edit, several symptoms

I backed up `passbolt.php`, then removed `:8443` from `fullBaseUrl`. A new invitation's link became `https://passbolt.vaultlab.home/setup/start`, with no port, so it points at port 443, which is VaultLab's nginx. Its certificate is for `vaultlab.home`:

```text
curl: SSL: no alternative certificate subject name matches target host name 'passbolt.vaultlab.home'
```

A user would get a certificate warning from a link in Passbolt's own email, which is exactly when someone clicks through it. The health check showed one cause with several symptoms: a failed self-check, three misleading SSL warnings (even "self-signed", although the certificate never changed, only where Passbolt looked), and one extra failure that cleared by itself when I restored the URL. And the user could still use Passbolt normally on `:8443`: a wrong `fullBaseUrl` is a **quiet** failure. Only the links and the server's self-check break. I restored the backup (`cmp` said identical) and the check was back to the baseline, plus one improvement: `cake cache clear_all` cleared the stale-cache warning.

**Why it matters beyond the email:** each user's extension stores the exact URL, so changing the scheme, the name or the port is a planned migration with an announcement, never a quick edit.

## Ticket 4: "My browser says the connection is not private"

No break needed: I reproduced it two ways. The server presents a valid certificate for **one name**, `passbolt.vaultlab.home`, issued by my CA, so the same warning page can come from two different causes.

| Test | Result | What it means |
| --- | --- | --- |
| by **name**, with my CA | `302` | works |
| by **IP**, with my CA | `no alternative certificate subject name matches target host name` (verify code 62) | the certificate doesn't name the IP |
| by name, **no** CA configured | `unable to get local issuer certificate` (code 21) | the client doesn't trust my CA |
| by IP, but verifying the name | `302` | the server is fine; only the name differs |

In a Chromium browser the IP address gave `net::ERR_CERT_COMMON_NAME_INVALID`. In Firefox on the Dell, which has never been told about my CA, the name gave "Warning: Potential Security Risk Ahead". I didn't capture the error code under Advanced there (I expect `SEC_ERROR_UNKNOWN_ISSUER`, which matches code 21). Firefox's own text said *"there is nothing you can do to resolve it"*, which is misleading: the fix is on the client. I imported my CA's **public** certificate under *Settings, Privacy & Security, Certificates, Authorities* with "trust this CA to identify websites", and the warning went away. My CA is name-constrained to `vaultlab.home`, which limits the harm of trusting it.

The point for the reply: never tell a user to "accept the risk" on a password manager. The warning is the browser doing its job, and clicking through is exactly how a man-in-the-middle attack succeeds. The right answer is "use the name, here is the bookmark", and for an unknown issuer, "add our certificate".

## The paper tickets

**A, "I forgot my passphrase. Can you reset it?"** In Community Edition there's no reset: the passphrase protects the private key, which lives only in the user's browser and recovery kit, and the server never had it. I can let them try again calmly, then delete the account and re-invite (a new key; shared passwords are re-shared, passwords only that user held are gone). The reply is empathy, an honest "no" with the reason, the plan, and what I do for them now. Prevention: share important passwords with a group or at least two people.

**B, "Login fails on one laptop only, with a server key error."** Compare the clocks (`date -u` and `timedatectl`), ask the user to set the time automatically, then find what's different about that client: browser, extension version, network. "If one client fails and the others work, I look for what is different about that client. If everyone fails, I start on the server."

## What I learned

- Two email problems can look identical to the user and are opposite on the server. The empty Error column and the stale log are the clues.
- A health check can be green, red, or *crash*. All three are answers.
- A server can be healthy for users and still wrong on disk. A red check with working logins is a latent failure to fix, not to ignore.
- Record the original value before every change (permissions, config), and restore that value exactly.
- Read the timestamp on every log line before blaming it.

## Commands I used today

```bash
lxc snapshot passbolt day20-start          # lxc restore passbolt day20-start to roll back
cake passbolt healthcheck                  # the baseline, and the check after each ticket
cake passbolt show_queued_emails
cake passbolt email_digest send
cake passbolt send_test_email --recipient=...
cake passbolt register_user -u ... -f ... -l ... -r user
cake cache clear_all
ss -tln | grep 1025
systemctl stop php8.3-fpm        # then start it again, likewise for mysql and cron
```

## Not done yet

- **Ticket 3** (recovery on a new browser): it needs a second browser profile and bob's recovery kit and passphrase.
- The cleanup: five test users, and the snapshot.
- Doing all of this again against a timer.

## Reflection

**What did I learn?**
That the order of the chain is the answer, that the status code points to the layer, and that the evidence for a cause is often a *difference* from the baseline.

**What did I struggle with?**
Keeping track of which window was which, and noticing when a "clue" was an old log line. I also broke my own safety net by running a restore by accident.

**What did I understand better after practising?**
That "healthy" has levels: a service can be active but unreachable, a check can be green but incomplete, and users can work while the server is already wrong.

**What should I review next?**
Ticket 3, the stopped-cron versus failing-SMTP difference, and the latent key failure (what exactly breaks on a restart).

**What can I demonstrate now that I couldn't before?**
I can take a Passbolt ticket, walk the chain from the browser to the database, point at the evidence for each conclusion, fix it, and write the reply and the note.
