# Day 10: Authentication, hashing and sessions

**Goal for today:** give VaultLab user accounts, store login passwords so that even a stolen database doesn't reveal them, build register, login and logout with sessions in cookies, and protect the items API.

**My setup:** MariaDB and the API on the Dell, the React app on the Mac, as on Day 9.

---

Until today, anyone who could reach port 3000 could read my whole vault: there was no login at all. Today VaultLab got accounts. The central question of the day is one every password manager has to get right: **how do you store a login password so that a stolen database doesn't give it away?**

## Hashing vs encryption

| | Hashing | Encryption |
| --- | --- | --- |
| Goes | One way only | Both ways |
| Original back? | No, you can only check a guess | Yes, with the key |
| Used for | Checking a login password | Secrets you need to read again |

A password manager uses both: my **login** password is hashed, because the server only needs to check it, and the passwords **in** the vault will be encrypted, because I need to read them again. "We encrypt the passwords" is the classic mix-up: for logins it should be "we hash them", because anything that can be decrypted can be decrypted by whoever steals the key.

## Lesson Learned: Why a fast hash is the wrong tool for passwords

I wrote `experiments/crypto/hashing.js` to see it for myself:

1. **A hash is a fingerprint.** `sha256("password123")` is always `ef92b778bafe771e89245b89ecbc08a44a4e166c06659911881f383d4473e94f`, on any computer. Changing one character changes everything. That hash is so well known that searching for it on the web shows the password straight away.
2. **A fast hash is fast.** The script counts how many SHA-256 hashes one CPU can do in a second: hundreds of thousands. Attackers with graphics cards do billions. If a table of SHA-256 password hashes leaks, every common password falls almost immediately.
3. **Same password, same hash.** Two users with `Summer2026!` get identical hashes, so whoever reads the table can see they share a password.
4. **A salt fixes that.** A random value per user, stored next to the hash (it isn't secret), makes every hash different, even for the same password.
5. **A slow hash fixes the speed.** **scrypt**, built into Node.js, takes a noticeable fraction of a second per hash on purpose. For a user logging in that's nothing; for an attacker it means a handful of guesses per second instead of hundreds of thousands.
6. **Encryption is reversible.** An AES-256-GCM round trip with a key gives the original text back, which is what the vault itself will need later.

The algorithms made for passwords are Argon2id, scrypt and bcrypt. VaultLab uses scrypt because it's built into Node.js. Never plain MD5, SHA-1 or SHA-256.

### The proof was in my own Day 9

On Day 9, `SHOW GRANTS` showed my database user's first password stored as `*9AFAC38AFB59C44085CF8CD7B1159DFA529C3B0A`. That was the placeholder password I had copied from my guide by mistake. MariaDB's old password hash is fast and **unsalted**, so:

```bash
mariadb -u vaultlab -p vaultlab -e "SELECT PASSWORD('paste-your-generated-password-here')"
```

gives exactly that same hash. Anyone who saw it could have computed this and known my password without cracking anything. That's what a missing salt means in practice.

## Users and sessions in the database

HTTP is stateless, so after logging in, how does the server know the next request is me? With a **session**: I log in once, the server makes a long random token, stores which user it belongs to, and gives it to my browser in a **cookie**. The browser sends the cookie back with every request automatically, and logging out makes the server forget the token.

The two new tables live in `server/db/002-users-sessions.sql`, my first numbered **migration**:

```text
+--------------------+
| Tables_in_vaultlab |
+--------------------+
| items              |
| sessions           |
| users              |
+--------------------+
+------------+------------------+------+-----+---------------------+-------+
| Field      | Type             | Null | Key | Default             | Extra |
+------------+------------------+------+-----+---------------------+-------+
| token_hash | char(64)         | NO   | PRI | NULL                |       |
| user_id    | int(10) unsigned | NO   | MUL | NULL                |       |
| created_at | datetime         | NO   |     | current_timestamp() |       |
| expires_at | datetime         | NO   |     | NULL                |       |
+------------+------------------+------+-----+---------------------+-------+
```

- `users.email` is **unique**, so the database itself refuses a second account with the same email.
- `users.password_hash` holds a string like `scrypt$32768$8$3$<salt>$<hash>`: the algorithm, its cost settings, the salt and the hash. Never the password.
- `sessions.token_hash` holds the **SHA-256 of the token**, not the token itself, so a leaked sessions table gives no working logins.
- **`PRI`** means the primary key: every request with a cookie looks a session up by its hash, so that has to be fast. **`MUL`** is an ordinary index where a value can appear multiple times: one user can have several sessions.

`SHOW CREATE TABLE sessions\G` showed the link between the tables:

```text
CONSTRAINT `sessions_user_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
```

A **foreign key**: every session must belong to a real user, and deleting a user deletes their sessions. **InnoDB** is the storage engine that supports foreign keys and transactions, which is why my `ROLLBACK` worked yesterday. And the table inherited `utf8mb4` from the database without my writing it.

## Lesson Learned: dotenv reads .env from where you start, not where the code is

`dotenv` looks for `.env` in the folder the server was **started** from. Started from anywhere other than `server/`, the API stopped with `Missing settings: DB_HOST, DB_USER, DB_PASSWORD, DB_NAME` even though `.env` existed. The fix was to give it the path relative to the code itself:

```js
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true })
```

## The auth routes

| Method and path | Success | Errors |
| --- | --- | --- |
| `POST /api/auth/register` | `201` | `400` invalid, `409` email taken |
| `POST /api/auth/login` | `200` + `Set-Cookie` | `401` wrong login, `429` too many tries |
| `POST /api/auth/logout` | `204` | |
| `GET /api/auth/me` | `200` | `401` |
| `/api/items...` | as before | `401` without a session |

The decisions that matter:

- **Checking a password** means hashing the attempt with the stored salt and settings and comparing, with `timingSafeEqual`, which takes the same time wherever the difference is.
- **One message for every failed login:** `Invalid email or password`, whether the email exists or not.
- **A dummy hash:** for an unknown email the server still runs one full scrypt check, so both cases take the same time.
- **A failure limit:** after 5 wrong passwords for the same email from the same address, `429 Too Many Requests` for 15 minutes.
- **The token** comes from `crypto.randomBytes(32)`: 256 random bits that nobody can guess.
- **`requireAuth` middleware** protects every items route at once, so none can be forgotten.
- **`Cache-Control: no-store`** on every API answer, so vault data is never kept in the browser's cache.
- **The log records failed logins** with the email and address, never the password.

### The cookie settings are security settings

```text
Set-Cookie: vaultlab_session=...; Max-Age=28800; Path=/; Expires=...; HttpOnly; SameSite=Lax
```

- **`HttpOnly`**: JavaScript in the page can't read the cookie, so even an injected script can't steal the session.
- **`SameSite=Lax`**: the browser doesn't send it with requests that other websites start, which blocks most cross-site request forgery.
- **`Secure`** is still off, because VaultLab runs on plain HTTP at home. Anyone who can read my Wi-Fi traffic could copy the cookie. HTTPS is coming.

Testing with curl, `-c jar.txt` saves cookies and `-b jar.txt` sends them back, like a browser. Without a login, `GET /api/items` answered `401 Not logged in`. After logging in, the same request worked. In the database there was no password anywhere, only the `scrypt$...` string, and the SHA-256 of the token in my cookie jar matched the `token_hash` in the sessions table. Logging out answered `204` with a `Set-Cookie` that expires in 1970, which is how a server asks the browser to delete a cookie, and the session row was gone.

## Logging in from the React app

The React app needed no code to handle the cookie: the browser stores it from `Set-Cookie` and sends it back by itself, because the page and the API share one origin through the Vite proxy. The app only tracks the user in three states: `undefined` while asking `/api/auth/me`, `null` when logged out, and the user when logged in. Without the "still checking" state, the login form would flash on every reload.

In DevTools, **Application → Cookies** shows `vaultlab_session` with **HttpOnly** ticked. And in the Console:

```js
document.cookie
// ''
```

The cookie exists, the browser sends it with every request, but page scripts can't see it.

## Lesson Learned: Authentication isn't authorization

I registered a second account, and its vault showed **the same items as the first one**. Every logged-in user can read and delete everyone's items. Authentication answers "**who** are you?", but nothing in VaultLab answers "**what** may you see?" yet. That's tomorrow's work, and it's the most serious bug VaultLab has right now.

## Break and fix

I attacked my own login on the Dell, with test accounts (`shishir@example.com` and `bob@example.com`, test passwords only), removing one protection at a time.

## Lesson Learned: The same 401 can still leak which emails exist

First the protected version, with a known and an unknown email: both `401`, both about a quarter of a second. Then I added a "shortcut" that answers straight away when the email doesn't exist, skipping the password check:

```js
  if (!user) return res.status(401).json({ error: 'Invalid email or password' }) // shortcut: no password check
```

```text
known   401 0.280426s
unknown 401 0.002184s
```

Same status, same message, but the unknown email answered about 130 times faster. Anyone with a list of emails can now find out which ones have accounts here, just by timing the answers. That's **username enumeration through timing**, and the dummy hash in the real code exists only to close it.

## Lesson Learned: Logout has to end the session on the server

I commented out the line that deletes the session at logout, logged in, kept a copy of the cookie the way an attacker would, then logged out:

```text
HTTP/1.1 204 No Content
Set-Cookie: vaultlab_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax

HTTP/1.1 200 OK
{"id":6,"email":"shishir@example.com","role":"user"}
```

The browser was told to delete the cookie, but the **copied** token still worked, because the session row was still in the database. After undoing the break, the same steps ended with `401 Not logged in`.

### Brute force

Seven wrong passwords in a row:

```text
attempt 1 -> 401
attempt 2 -> 401
attempt 3 -> 401
attempt 4 -> 401
attempt 5 -> 401
attempt 6 -> 429
attempt 7 -> 429
```

After five failures, `429 Too Many Requests`, even for the correct password, for 15 minutes. The first time I ran the loop, `429` started at attempt **5**: an earlier failed login for the same email had already been counted. The counter is per email and address, not per test. It also means anyone can lock a user out by failing five times on purpose, a small denial of service. Restarting the API clears the counter, because it's kept in memory.

### A leaked sessions table, and an expired session

```text
token starts with: uaJI3j...
with the real token:       200
with the hash from the DB: 401
```

The cookie's token logs in; the hash stored in the database doesn't. A stolen copy of the sessions table gives no working logins. Then I moved that session's expiry into the past:

```text
| ROW_COUNT() |
|           1 |
HTTP/1.1 401 Unauthorized
{"error":"Not logged in"}
```

## Lesson Learned: Check that the first step of a test worked

My first attempts at these two tests gave `401` for everything, including the real token, and they meant nothing:

- I was still locked out from the brute-force loop, so the login at the top got `429`, the cookie jar stayed empty, and every later request was simply "no cookie".
- After fixing that, `ROW_COUNT()` said `0`: my shell variables still held the empty token from the failed login. Variables don't update themselves when a file changes.
- The database login failed with **1045**, because I had changed the `vaultlab` password and typed the old one. `sudo mariadb` worked instead: it asks for my **Linux** password, not the database one, because the database's root trusts the system's root (unix_socket).

Before believing a test, I now check that its first step worked: the login said `200`, the token isn't empty, the `UPDATE` changed `1` row.

| What I removed | What an attacker gets |
| --- | --- |
| The dummy hash | Which emails have accounts, by timing (2 ms vs 280 ms) |
| Deleting the session at logout | A copied cookie that keeps working after logout |
| The failure limit | Unlimited guesses (slowed only by scrypt) |
| Storing only the token's hash | Working logins from a leaked database |
| `expires_at` | Sessions that never end |

## Commands I used today

```bash
node experiments/crypto/hashing.js
mariadb -u vaultlab -p vaultlab < db/002-users-sessions.sql
mariadb -u vaultlab -p vaultlab -e "SHOW TABLES; DESCRIBE sessions;"
mariadb -u vaultlab -p vaultlab -e "SHOW CREATE TABLE sessions\G"

# Logging in with curl and a cookie jar
curl -i -c jar.txt -X POST http://localhost:3000/api/auth/login -H "Content-Type: application/json" -d '{"email":"...","password":"..."}'
curl -b jar.txt http://localhost:3000/api/auth/me
curl -i -b jar.txt -c jar.txt -X POST http://localhost:3000/api/auth/logout

# Timing a request
curl -s -o /dev/null -w "%{http_code} %{time_total}s\n" ...
```

## Security things I noticed

- Login passwords are stored as **scrypt** hashes with a random salt, never as text and never with a fast hash.
- Session tokens are random, stored only as hashes, expire after 8 hours, and end on the server at logout.
- The session cookie is `HttpOnly` and `SameSite=Lax`. `Secure` waits for HTTPS.
- Failed logins get one message, take the same time, and are limited.
- `jar.txt` contains a live session token, so it's in `.gitignore`.
- **Open issue:** every user can see every item. Authorization comes next.

## Reflection

**What did I learn?**
The difference between hashing and encryption, why passwords need slow salted hashes, how sessions and cookies work, and which cookie flags stop which attacks.

**What did I understand better after practising?**
That my own Day 9 database password hash could be recognised by anyone who knew the placeholder text. Seeing my own `*9AFAC38A...` come back from `PASSWORD()` made "no salt" real.

**What troubleshooting skills did I develop?**
Following a session from the `Set-Cookie` header to the cookie in DevTools to the row in the database, and reading `401` vs `429` vs `409`.

**What should I review next?**
The cookie flags, and the difference between authentication and authorization.

**What can I demonstrate now that I couldn't before?**
I can explain and show how a login works from the password hash to the session cookie, and why each protection is there, by removing it and attacking my own login.