# Passbolt CE lab: a container on the Dell (Day 19)

Passbolt Community Edition runs in its own LXD system container, so it doesn't touch VaultLab's nginx and database
on the same machine. No secrets are in this file: database passwords, keys and the admin's passphrase live in a
password manager, never in the repo.

## Layout

```
Mac / Dell browser ── https://passbolt.vaultlab.home:8443 ──► Dell port 8443
                                                                  │  LXD proxy device
                                                                  ▼
                                     container "passbolt": nginx :443 → PHP (Passbolt) → MySQL 8
```

VaultLab stays on `https://vaultlab.home` (port 443). Passbolt gets 8443.

## 1. The container

```bash
sudo snap install lxd
sudo lxd init --minimal
sudo usermod -aG lxd "$USER"          # new login (or `newgrp lxd`) before lxc works without sudo
sudo ufw allow in on lxdbr0
sudo ufw route allow in on lxdbr0
sudo ufw route allow out on lxdbr0
lxc launch ubuntu:24.04 passbolt
lxc exec passbolt -- bash -c 'hostname; ip -4 addr show eth0 | grep inet; ping -c 2 download.passbolt.com'
```

The three `ufw` rules trust everything on the bridge `lxdbr0`: acceptable for one container I control. Docker also
runs on the Dell; it did not stop the container's networking here.

## 2. A certificate from the VaultLab CA

The CA has a name constraint (`permitted;DNS:vaultlab.home`), so the hostname must be a subdomain:
`passbolt.vaultlab.home` is allowed, `passbolt.home` would not be.

```bash
cd ~/vaultlab-ca
# passbolt.vaultlab.home.ext: basicConstraints CA:FALSE, keyUsage digitalSignature,
#                              extendedKeyUsage serverAuth, subjectAltName DNS:passbolt.vaultlab.home
openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out passbolt.vaultlab.home.key
openssl req -new -key passbolt.vaultlab.home.key -subj "/CN=passbolt.vaultlab.home" -out passbolt.vaultlab.home.csr
openssl x509 -req -in passbolt.vaultlab.home.csr -CA ca.crt -CAkey ca.key -CAcreateserial -days 397 -sha256 \
  -extfile passbolt.vaultlab.home.ext -out passbolt.vaultlab.home.crt
openssl verify -CAfile ca.crt passbolt.vaultlab.home.crt

lxc exec passbolt -- install -d -m 755 /etc/ssl/passbolt
lxc file push passbolt.vaultlab.home.crt passbolt/etc/ssl/passbolt/passbolt.vaultlab.home.crt
lxc file push --mode 600 passbolt.vaultlab.home.key passbolt/etc/ssl/passbolt/passbolt.vaultlab.home.key
lxc file push ca.crt passbolt/usr/local/share/ca-certificates/vaultlab-home-ca.crt
lxc exec passbolt -- chown root:root /etc/ssl/passbolt/* /usr/local/share/ca-certificates/vaultlab-home-ca.crt
lxc exec passbolt -- update-ca-certificates
```

`ca.key` never leaves the Dell.

## 3. The package (inside the container)

Verify before running: the setup script comes from Passbolt's server, its checksum from GitHub.

```bash
curl -fsSLO https://download.passbolt.com/ce/installer/passbolt-repo-setup.ce.sh
curl -fsSLO https://github.com/passbolt/passbolt-dep-scripts/releases/latest/download/passbolt-ce-SHA512SUM.txt
sha512sum -c passbolt-ce-SHA512SUM.txt && bash ./passbolt-repo-setup.ce.sh
apt install passbolt-ce-server
```

Installer answers: local database yes; admin user `root` with an empty password; database user `passboltadmin`;
database `passbolt`; nginx yes; TLS **manual** (not `auto`, which asks Let's Encrypt for a certificate); domain
`passbolt.vaultlab.home`; the two certificate paths above.

If the installer stops half-configured with wrong answers: clear what debconf remembers, then run it again
(`dpkg-reconfigure` refuses on a half-configured package):

```bash
echo PURGE | debconf-communicate passbolt-ce-server
dpkg --configure passbolt-ce-server
```

Note: on Ubuntu 24.04 the package brought in **MySQL 8.0**, not MariaDB. The service is `mysql`, and the client
is `mysql` (not `mariadb`).

## 4. The network path

```bash
lxc config device add passbolt https proxy listen=tcp:0.0.0.0:8443 connect=tcp:127.0.0.1:443
sudo ufw allow from 192.168.178.0/24 to any port 8443 proto tcp
```

TLS still ends at the container's nginx. Inside the container every visitor appears as `127.0.0.1`, because the
proxy device opens the connection.

One name, three places. The Dell's address is `192.168.178.52` on my network.

| Where | `/etc/hosts` line | Why |
| --- | --- | --- |
| The Mac | `192.168.178.52  passbolt.vaultlab.home` | reaches the Dell over the network |
| The Dell | `127.0.0.1  passbolt.vaultlab.home` | the proxy listens on every address |
| The container | `192.168.178.52  passbolt.vaultlab.home` | Passbolt checks its own URL from inside: out to the Dell and back in on 8443 |

The Mac also needs the CA certificate in its keychain. It's a public file, so the fingerprint is checked first:

```bash
openssl x509 -in vaultlab-home-ca.crt -noout -fingerprint -sha256     # compare with the Dell's
sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain vaultlab-home-ca.crt
```

## 5. A mail catcher and the server key

```bash
apt install -y python3-aiosmtpd
systemd-run --unit=mailcatcher python3 -u -m aiosmtpd -n -c aiosmtpd.handlers.Debugging -l 127.0.0.1:1025
journalctl -u mailcatcher -f              # every email Passbolt sends appears here
```

`python3 -u` matters: without it Python buffers its output when it isn't a terminal, and the emails don't show.
Passbolt SMTP settings in the admin screen: host `127.0.0.1`, port `1025`, TLS **off**, no authentication.

The server's OpenPGP key (RSA 3072, no passphrase on purpose) is generated in a throwaway keyring, imported in
the web wizard, and the exported copy is shredded afterwards; Passbolt keeps its own in `/etc/passbolt/gpg/`.

## 6. Looking inside

```bash
su -s /bin/bash -c "/usr/share/php/passbolt/bin/cake passbolt healthcheck" www-data
su -s /bin/bash -c "/usr/share/php/passbolt/bin/cake passbolt send_test_email --recipient=you@example.com" www-data
# logs: /var/log/passbolt/error.log   /var/log/nginx/passbolt-access.log   journalctl -u 'php*-fpm'
# the email queue job: /etc/cron.d/passbolt-ce-server (every minute)
mysql passbolt -e "DESCRIBE secrets;"
mysql passbolt -e "SELECT u.username, LEFT(s.data,40) FROM secrets s JOIN users u ON u.id=s.user_id;"
```
