# Day 12: Encryption, vault passwords you can read back but nobody else can

**Goal for today:** encrypt every vault password with AES-256-GCM before it is saved, decrypt it after it is read, make the server refuse to start with a key that doesn't open the vault, and then break my own encryption five ways to see how each failure looks.

**My setup:** MariaDB, the API and all the commands on the Dell; the React app on the Mac. Everything below uses test accounts and fake passwords.

---

Day 11 ended with a promise: every item has an owner, but the passwords are still stored as plain text, so whoever reads the database reads them. Today I fixed that.

## Why encryption, not hashing

Day 10 hashed login passwords: the server only has to check a guess, never read the password back. Vault passwords are different: I need the original back to log in to a site. So they need **encryption**, which works both ways with a key.

| | Hashing | Encryption |
| --- | --- | --- |
| Reversible? | No | Yes, with the key |
| Used for | Login passwords | Vault passwords |
| If I used the other one | Hashed vault passwords would be useless | Encrypted login passwords would be readable by whoever has the key |

## The pieces of AES-256-GCM

VaultLab uses AES-256-GCM, built into Node.js. AES is the cipher, 256 is the key size in bits, and GCM is the mode that also checks nobody changed the data.

| Piece | Size | Secret? | What it's for |
| --- | --- | --- | --- |
| Key | 32 bytes | Yes, the only secret | Encrypts and decrypts. One key for the whole vault, in `.env` |
| IV | 12 bytes | No, stored with the data | Makes every encryption different. Must never repeat with the same key |
| Ciphertext | Same length as the password | No | The encrypted password |
| Tag | 16 bytes | No, stored with the data | Proves the ciphertext, IV and AAD weren't changed |
| AAD | Any | No, not stored with the ciphertext; the server rebuilds it from the row | Extra data that must match at decryption. I use the owner's user id |

Everything except the key can sit in the database, and VaultLab stores it as one string with a version prefix, so a future algorithm change can be told apart:

```text
v1:<iv>:<tag>:<ciphertext>          (each part base64)
```

One thing GCM doesn't hide is the **length**: the ciphertext is as long as the password.

## Lesson Learned: Two AES-GCM mistakes, shown with fake data

Before writing the real code I ran `experiments/crypto/gcm-mistakes.js`. The output (the hex changes every run):

```text
1. A new random IV every time
   identical? false

2. MISTAKE: the same IV every time
   identical? true  <- anyone reading the table sees who shares a password
   attacker knows one password: Summer2026!Bank1
   ...and recovers the other, WITHOUT the key: MyRealPassw0rd!!

3. AAD ties a ciphertext to its owner
   decrypting it as user 6: Unsupported state or unable to authenticate data
   decrypting it as user 1: shishirs-bank-password

4. MISTAKE: no AAD
   copied into anyone's row, it decrypts fine: shishirs-bank-password
```

**Why a reused IV lets an attacker recover a password without the key.** GCM works like a stream cipher: it makes a keystream from the key and the IV, then XORs the password with it. With the same key and IV, the keystream is the same. So for two passwords P1 and P2 and keystream K:

- C1 = P1 XOR K and C2 = P2 XOR K
- C1 XOR C2 = P1 XOR P2, because K cancels out
- if I know P1, then (P1 XOR P2) XOR P1 = P2

The key never appears in that calculation. In GCM a repeated IV is worse still: it also leaks the authentication key behind the tag (not the encryption key itself), so an attacker can forge values that pass the check. The fix costs nothing: 12 fresh random bytes for every encryption.

**What AAD does.** The tag is computed from the key, the IV, the ciphertext **and** the AAD. I use `vaultlab:item-owner:<user id>`. A ciphertext made for user 1 refuses to decrypt as user 6, so someone who can write to the database, but has no key, can't copy my password into their own row. Changing the owner id in the row doesn't help either: the value only verifies under the id it was encrypted with. What AAD doesn't stop: swapping blobs between two of my own items (same owner), restoring an old valid blob, or simply corrupting rows.

## The code

Four pieces:

1. **`vaultCrypto.js`** (new, about 40 lines): `encryptSecret(userId, text)` makes a new random IV every time and sets the owner as AAD; `decryptSecret(userId, stored)` checks the `v1` format and lets GCM throw if anything doesn't match.
2. **`store.js`**: passwords are encrypted before they reach the database and decrypted only there. The API never sends the ciphertext, so the React app saw exactly what it saw yesterday. Titles and usernames stay readable, so search still works in SQL, which is a real trade-off.
3. **`config.js`**: `VAULT_KEY` is required and must be exactly 64 hex characters, otherwise the server stops with a message that says how to make one.
4. **`index.js`**: before accepting any request, the server tries to decrypt one item with the configured key. If it can't, it refuses to start.

The key lives in `server/.env`, with `chmod 600`, never in Git, never typed (32 bytes from `crypto.randomBytes`). A copy goes somewhere safe, away from the database backups. Lose it and every password is gone for good.

## Migrating the real data: add, fill, require, again

Same order as Day 11, except the "fill" step can't be SQL: MariaDB doesn't have the key and shouldn't. So three steps:

1. `db/004`: add `password_enc`, empty.
2. `scripts/encrypt-existing.js`: encrypt every row, checking the round trip before saving, and keeping `updated_at` unchanged so the migration doesn't rewrite what the user sees.
3. `db/005`: make `password_enc` required and drop the plain-text `password` column. This is the one-way door.

## Lesson Learned: `grep -c` of 1 doesn't mean the setting works

I made the key with `echo "VAULT_KEY=..." >> .env` and checked with `grep -c VAULT_KEY .env`, which said `1`. But my `.env` had no newline at the end, so the key was glued onto the previous line:

```text
DB_NAME=vaultlabVAULT_KEY=...
```

The scripts stopped with `Missing settings: VAULT_KEY`. I carried on anyway, and `check-vault.js` said `0 of 11 item(s) decrypt`, because nothing had been encrypted. Then I ran `db/005` too early:

```text
not_encrypted_yet
11
ERROR 1265 (01000) at line 6: Data truncated for column 'password_enc' at row 1
```

It failed safely: the NOT NULL rule refused the empty column, and nothing was dropped. After fixing `.env`, the real run:

```text
Database vaultlab: 11 item(s) to encrypt
...
Done: 0 left without an encrypted password
Database vaultlab: 0 item(s) to encrypt        <- second run, safe to repeat
11 of 11 item(s) decrypt with this key
```

Then `db/005` printed `not_encrypted_yet 0`, `DESCRIBE items` showed no `password` column, and the API started with `Vault check: OK`.

## Lesson Learned: Encrypting the database doesn't encrypt the copies

I looked for my test password (`day12-plain-secret`) in the same places as before:

| Place | Result |
| --- | --- |
| The table | Only `v1:...` values |
| The table file (`items.ibd`) | No match, exit code 1 |
| The new backup | 0 |
| The old backup from before the migration | 1, plain text, and always will be |
| InnoDB's redo log (`ib_logfile0`) | 2 copies |

`sudo mariadb` still opens the database but no longer opens the vault. The old backups still hold every password in plain text, and so does the redo log, a journal of recent changes that keeps old values until newer changes overwrite them. Deleting data isn't erasing it from the disk. Real systems encrypt the whole disk or turn on MariaDB's own file encryption.

I shredded the old backups with `shred -u`, which overwrites before deleting. On an SSD that isn't guaranteed to reach every copy. From then on the only way to recover the vault is the ciphertext backup **plus** the key.

## Break and fix

### Break 1: the wrong key

I changed one character of the 64. The server connected to the database, then:

```text
Vault check FAILED: cannot decrypt item 1 (Unsupported state or unable to authenticate data)
Refusing to start, so that nothing gets saved with the wrong key.
```

`curl` to the API gave `000`: nothing was listening. There's no "almost right" key, and a **lost** key looks exactly like this, except there's no `.env.good` to copy back.

### Break 2: skipping the check

I commented out the `process.exit(1)` and broke the key again. The server printed `Vault check FAILED` and started anyway:

```text
list -> 500
add  -> 201
```

Reading failed, but **saving worked**: the new item was encrypted with the wrong key without any error. After restoring the good key, the startup check said `Vault check: OK`, but the list still returned `500`. The check only samples one item. `check-vault.js` found the bad one:

```text
  FAILED item 23 (user 6): Unsupported state or unable to authenticate data
11 of 12 item(s) decrypt with this key
```

A server that keeps running with the wrong key doesn't only fail to read: it mixes two keys in one vault. And a check that samples one item can't vouch for all of them. (This break took me three attempts: twice the curls gave `000` because my edit hadn't actually removed the exit, and I deleted the wrong item once before finding the failing one.)

### Break 3: one character changed in the database

I changed one character of a stored tag:

```text
{"error":"Internal Server Error"} 500
list -> 500
```

The log said `[crypto] item ... could not be decrypted`. GCM never hands back a slightly wrong password. The cost: one damaged item makes the **whole list** fail, because `listItems` stops at the first error. A more forgiving design would return the other items and mark one as damaged.

### Break 4: copying a password into another user's row

Bob (with database write access but no key) copies shishir's encrypted password into his own item:

```text
{"error":"Internal Server Error"} 500
```

The value was encrypted with `vaultlab:item-owner:6`, and decrypting it as user 7 fails the tag check. Without AAD, Bob would have read the password right there. (My first try copied an already corrupted value from Break 3, which proves nothing, so I undid Break 3 first and repeated it.)

### Break 5: the same IV every time

I changed one line to `const iv = Buffer.alloc(12)` and added items with the same password:

```text
18 | IV break 1 | v1:AAAAAAAAAAAAAAAA:mvkhdvdDHSgEPCu3jJY3RQ==:RZuNOhDx3yK1UsITjspA
19 | IV break 2 | v1:AAAAAAAAAAAAAAAA:mvkhdvdDHSgEPCu3jJY3RQ==:RZuNOhDx3yK1UsITjspA
```

Identical values, and an IV of all As (twelve zero bytes in base64). Every request returned `201`, everything decrypted, nothing looked wrong. That's what makes it dangerous: only someone reading the stored data notices, and that's the attacker. (My first two tries didn't change anything: I hadn't saved the edit. `git diff --stat` before testing fixed that.)

### The same error, five causes

Every break printed `Unsupported state or unable to authenticate data`, except the last, which printed nothing at all. The message never says what didn't match, so the pattern does the diagnosis:

| What I see | Most likely cause |
| --- | --- |
| Server refuses to start after a `.env` change | Wrong or missing key |
| Every item fails | The key |
| One item fails, the rest are fine | That row was changed, or saved with another key |
| A user's items fail after something touched the database | Values moved between users (AAD) |
| Everything works, but identical passwords look identical | A reused IV: no error at all |

## What it does and doesn't protect

VaultLab now does **server-side encryption at rest**: the server holds the key, encrypts before saving and decrypts after reading. It protects every copy of the data that leaves the running server: new backups, the table file, whatever an SQL injection or a curious admin reads with `sudo mariadb`. It doesn't protect against anyone who controls the server itself: root on the Dell can read `.env` or the decrypted passwords out of the running API's memory.

Passbolt goes a step further with end-to-end encryption using OpenPGP: each user has their own private key, passwords are encrypted and decrypted in the browser, and the server only ever sees encrypted data. In Passbolt's own words: "All encryption and decryption happens locally in your browser extension or mobile app, never on the server." (from their page on how Passbolt secures your data) The price is that the server can't "just reset" access to someone's secrets. That's why Passbolt support conversations are so often about keys, and today's Break 1 is a small version of one.

## Commands I used today

```bash
# Make the key (once!), check it is its own line, lock the file
printf '\nVAULT_KEY=%s\n' "$(node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))")" >> .env
chmod 600 .env
grep -cE '^VAULT_KEY=[0-9a-f]{64}$' .env

# Migration
sudo mariadb vaultlab < db/004-encrypt-passwords.sql
node scripts/encrypt-existing.js
node scripts/check-vault.js
sudo mariadb vaultlab < db/005-drop-plaintext.sql

# Looking for plain text on the disk and in backups
sudo grep -a -o "day12-plain-secret" /var/lib/mysql/vaultlab/items.ibd
grep -c day12-plain-secret ~/backups/*.sql

# Overwrite and delete an old backup, then make a fresh one
shred -u ~/backups/vaultlab-before-004.sql
sudo mariadb-dump --single-transaction --skip-add-locks vaultlab > ~/backups/vaultlab-day12-end.sql

# Undo a break (then restart the API)
git checkout -- src/vaultCrypto.js
```

## Security things I noticed

- Only the key is secret. Everything else sits in the database next to the ciphertext.
- A new random IV for every encryption, the owner's id as AAD, and a version prefix on the stored format.
- The key is checked at startup, and the server refuses to start with one that doesn't open the vault.
- The key has never been committed: `git log -p | grep -cE "VAULT_KEY=[0-9a-f]{8}"` printed `0`.
- A failed decryption is logged with the item and the owner, never the value, and becomes a 500, never a wrong or empty password.
- My old backups and the redo log still held plain text. Encrypting the table didn't touch them.
- `check-vault.js` prints ids and owners only, never a password.

## Reflection

**What did I learn?**
How AES-GCM works, what each piece is for, and why a reused IV breaks it without ever touching the key. I also learned to migrate encrypted data in three steps without losing a password.

**What did I struggle with?**
Three times I read the last result before checking that the first step had worked: the key glued onto the wrong line, the exit I thought I had removed, and an IV edit I never saved. Each time the real state was one command away.

**What did I understand better after practising?**
That the key is the one thing a backup of the database can't replace, and that the most dangerous failure is the one that shows no error.

**What should I review next?**
Where plain text can still survive after encrypting a table (old backups and the redo log), and what MariaDB's own file encryption would change.

**What can I demonstrate now that I couldn't before?**
I can encrypt and decrypt a secret with AES-256-GCM, explain each part of the stored value, break the encryption five ways and tell them apart from the logs, and show that a reused IV leaks a password without the key.
