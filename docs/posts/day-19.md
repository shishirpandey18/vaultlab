# Day 19: Installing Passbolt CE in a container on the Dell

**Goal for today:** install the real thing, Passbolt Community Edition, the way an administrator would, and look at it from the inside: its installer, health check, logs, keys and what the server actually stores.

**My setup:** Ubuntu 24.04 on the Dell (nginx, MariaDB and VaultLab already running), an LXD container for Passbolt, the Mac for the admin account, Brave on the Dell for a second user.

---

## Lesson Learned: install next to nothing

Passbolt's own guide says to use "a minimal Ubuntu server with no other services installed", because the install scripts could damage what's there. The Dell already runs nginx and MariaDB with VaultLab's data. So Passbolt got its own small Ubuntu inside the Dell, an **LXD system container**: a full Ubuntu with its own nginx, PHP and database, sharing only the Dell's kernel. Reading the vendor's requirements and respecting them is itself a support skill.

```text
Mac / Dell browser ── https://passbolt.vaultlab.home:8443 ──► Dell port 8443
                                                                │  LXD proxy device
                                                                ▼
                                   container "passbolt": nginx :443 → PHP (Passbolt) → MySQL 8
```

VaultLab stays on port 443 and was untouched all day (`/api/health` stayed `200`).

## The container, and the firewall

`lxc launch ubuntu:24.04 passbolt` and a few `ufw` rules for the bridge `lxdbr0` (containers ask the Dell for DHCP and DNS, and my `ufw` denies incoming traffic by default). The container came up with an address and the internet worked:

```text
| passbolt | RUNNING | 10.x.y.z (eth0) | ... | CONTAINER |
64 bytes from download.passbolt.com ... time=19.0 ms
```

I was worried that **Docker**, which also runs on the Dell, would break the container's network (Docker changes the firewall's forwarding policy). It didn't.

## A certificate for passbolt.vaultlab.home

My CA has a name constraint, `permitted;DNS:vaultlab.home`. That covers `vaultlab.home` and everything under it, so `passbolt.vaultlab.home` is allowed and `passbolt.home` wouldn't be. The constraint I added on Day 13 for safety decided today's hostname. Inside the container, the certificate verified against the CA I pushed in, and `ca.key` never left the Dell.

## Installing the package: verify first

The repository script came from Passbolt's server and its checksum from GitHub, a different place, so a tampered script on one server wouldn't match the other:

```text
passbolt-repo-setup.ce.sh: OK
```

I read what the script does before running it (fingerprint check of the key, a `sources.list.d` file, `apt update`).

## What went wrong on the way

**I typed the wrong answers into the installer.** I put names where the database user and database name belonged, and answered the TLS question with `auto`, which means Let's Encrypt, together with a domain that isn't mine. The install failed at the first database step (`Access denied`) before it got that far, and I checked that nothing had been requested: `/etc/letsencrypt` held only its default config file and no certificate existed. `dpkg-reconfigure` then refused ("broken or not fully installed"), and `dpkg --configure` would have reused the same stored answers. The fix:

```bash
echo PURGE | debconf-communicate passbolt-ce-server     # forget the answers
dpkg --configure passbolt-ce-server                     # ask again
```

and the right answers: admin `root` with an empty password, a dedicated database user, TLS **manual**, my own domain and certificate paths. The lesson: read each prompt, and know which answer talks to an outside service.

**The database is MySQL 8, not MariaDB.** The package pulled in `default-mysql-server`, and `mysql` was the active service while `mariadb` was inactive. Passbolt supports MySQL 8, so it works, but every `mariadb ...` command in the guide becomes `mysql ...`.

**`curl -I` said 404.** nginx and the page were fine; a `HEAD` request isn't what Passbolt answers. A normal `GET` returned the redirect and the install page:

```text
GET /                         302 -> https://passbolt.vaultlab.home:8443/install
GET /install                  200
GET /healthcheck/status.json  302 -> .../install
```

## The network path, and the trust trap

An LXD proxy device passes port 8443 on the Dell into the container's 443. One name must work from three places, so it needs three answers:

| Where | `hosts` line | Why |
| --- | --- | --- |
| The Mac | the Dell's LAN address | reaches the Dell over the network |
| The Dell | `127.0.0.1` | the proxy listens on every address |
| The container | the Dell's LAN address | Passbolt checks its own URL from inside, out and back in on 8443 |

The same Passbolt answer came back from the container, the Dell and the Mac. The Mac needed one more thing: it didn't trust my CA, so `curl` stopped with `SSL certificate problem` and the browser would have warned. I got the CA's public certificate onto the Mac by pasting its text, then **checked its SHA-256 fingerprint against the Dell's** before trusting it (the same habit as Day 13), and added it to the System keychain. After that the Mac printed `200` with no `-k`. A trusted CA could normally vouch for any site, but mine is name-constrained to `vaultlab.home` and marked critical, which is why I'm comfortable with it.

I also ended up with a stray line in the Dell's `hosts` file twice, because I ran a Mac command in the Dell's terminal. Two answers for one name is the kind of confusing state that comes back later; I removed it. I started putting a guard in front of Mac-only commands that refuses to run anywhere else.

## A mail catcher

Passbolt sends email for almost everything, and I don't want lab emails going to real inboxes. A small SMTP server that prints what it receives does the job. Two surprises:

- **It printed nothing**, even though the test message said `sent`. Python buffers its output when it isn't writing to a terminal, so under `systemd-run` the emails sat in a buffer. `python3 -u` fixed it, and then each email showed between `MESSAGE FOLLOWS` and `END MESSAGE`.
- **Passbolt's test email failed** with `SMTP server did not accept the connection or trying to connect to non TLS SMTP server using TLS`. It connected, then tried to switch to TLS, which my catcher doesn't offer. The wizard had saved TLS as on; I turned it off in the admin screen and the test email arrived. A classic "my emails don't arrive" cause.

Passbolt doesn't send mail at the moment it decides to: it queues it, and a job runs every minute (`/etc/cron.d/passbolt-ce-server`). The invitation for the second user took about a minute to appear.

## The server's key, and the wizard

The server needs its own OpenPGP key pair (RSA 3072) to prove to the browser extension that it's the real server. I made it in a throwaway keyring, imported it in the web wizard, then shredded the exported copy: Passbolt keeps its own in `/etc/passbolt/gpg/`. The key has no passphrase, on purpose, because the server uses it unattended, so that file is one of the most sensitive in the installation.

## The health check

```text
[PASS] No error found. Nice one, sparky!
```

Plus four warnings that I can explain: NTP inactive (the container borrows the Dell's clock; on a real server a drifting clock breaks OpenPGP signature checks), the SMTP settings endpoints are enabled (recommended off in production), host availability checking is disabled (fine for `example.com`), and a stale model schema cache after the install. It also confirmed the things I had built by hand earlier: the certificate verifies, the hostname matches, the server key signs and decrypts, and `fullBaseUrl` is reachable from the server itself.

## A second user, by email

I created `bob` as the admin. The invitation arrived in the catcher after the queue ran. The guide warned that the HTML mail might be quoted-printable (`=3D` for `=`), but this version sent `Content-Transfer-Encoding: 8bit`, so the link was intact. Opening the link in a separate browser profile completed bob's setup, and the server showed one public key per user and a login right after:

```text
shishir@example.com  admin  EdDSA 256   (admin on the Mac)
bob@example.com      user   EdDSA 256   (bob in Brave on the Dell)
```

The server holds only the **public** halves. The private half lives in each browser extension, which is why a lost passphrase or a new browser is such a common support ticket.

## What the server really stores

I created a password called `Test Wi-Fi` (a made-up value) as the admin and shared it with bob. Then in the container:

```text
username             data_start                                bytes
shishir@example.com  -----BEGIN PGP MESSAGE-----\n\nwV4D...   635
bob@example.com      -----BEGIN PGP MESSAGE-----\n\nwV4D...   635
```

Two rows for one password, one encrypted to each user's public key. The two ciphertexts are different (`COUNT(DISTINCT MD5(data))` was 2 out of 2). The `resources` row holds only the item's metadata, and permissions are a separate table: shishir has owner (`15`) and bob has read (`1`). That's the table from Day 12, now in real software: sharing with three people means three encrypted copies, and nothing on the server can read any of them, not even root in the container.

## Commands I used today

```bash
sudo snap install lxd && sudo lxd init --minimal
lxc launch ubuntu:24.04 passbolt
lxc exec passbolt -- bash
openssl x509 -req -in passbolt.vaultlab.home.csr -CA ca.crt -CAkey ca.key -CAcreateserial -days 397 -sha256 -extfile passbolt.vaultlab.home.ext -out passbolt.vaultlab.home.crt
sha512sum -c passbolt-ce-SHA512SUM.txt
echo PURGE | debconf-communicate passbolt-ce-server; dpkg --configure passbolt-ce-server
lxc config device add passbolt https proxy listen=tcp:0.0.0.0:8443 connect=tcp:127.0.0.1:443
su -s /bin/bash -c "/usr/share/php/passbolt/bin/cake passbolt healthcheck" www-data
mysql passbolt -e "SELECT u.username, LEFT(s.data,40) FROM secrets s JOIN users u ON u.id=s.user_id;"
```

## Security things I noticed

- A password or a key pasted into a chat is exposed. Generate a new one and keep it out of the chat.
- Never answer an installer's TLS question with `auto` unless I mean to ask Let's Encrypt for a certificate for a real domain.
- Trust a CA only after comparing its fingerprint through a second channel, and prefer one with a name constraint.
- `lxd` group membership is close to root on the Dell, and the `ufw` bridge rules trust everything on `lxdbr0`.
- The server's OpenPGP key has no passphrase on purpose, so protect the file, not the passphrase.

## Not done yet

- The recovery kit and the security token for both accounts: I didn't verify that either was saved.
- Day 20 breaks Passbolt the way users and administrators do: a lost passphrase and recovery, a new browser, emails that never arrive, a wrong `fullBaseUrl`, a certificate change, the server's clock.

## Reflection

**What did I learn?**
That the vendor's installer talks to other people's servers if I let it, that a package can bring in a different database from the one a guide assumes, and that "sent" doesn't mean "arrived".

**What did I struggle with?**
Reading each installer prompt, and keeping track of which window was the Dell and which was the Mac. Two of my mistakes were Mac commands run on the Dell.

**What did I understand better after practising?**
That sharing a password is encryption per person, not a shared secret, and that the server only ever holds ciphertext and public keys.

**What should I review next?**
The health check's warnings, the email queue, and what each log file records, in time for Day 20.

**What can I demonstrate now that I couldn't before?**
I can install Passbolt CE in a container, get it through TLS with my own CA, run its health check and read its logs, and show in the database that each shared secret is a separate OpenPGP message.
