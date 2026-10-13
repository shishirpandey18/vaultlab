# Day 9: Databases, VaultLab's items in MariaDB

**Goal for today:** move VaultLab's items from the API's memory into a real database, write SQL by hand, connect the API to it safely, and learn to recognise database failures from the API's side, including SQL injection.

**My setup:** MariaDB on the Dell, listening only to the Dell itself. The API also runs on the Dell, because it needs the database. The React app on the Mac didn't change at all.

---

Yesterday's API kept everything in an array in memory, so every restart wiped my items. Today they moved into **MariaDB**. It was also the day with the most mistakes so far, and most of them taught me something.

## What a database adds

A database server is a separate program whose only job is storing data safely: on disk, for many clients at once, with rules it enforces itself, and with a language (SQL) for asking questions.

| Word | Meaning | In VaultLab |
| --- | --- | --- |
| Database | A named container of tables | `vaultlab` |
| Table | One kind of thing, with fixed columns | `items` |
| Column | One field, with a type and rules | `title`: text, at most 100 characters, required |
| Row | One record | the GitHub item |
| Primary key | Uniquely identifies each row | `id`, numbered automatically |
| NULL | "No value", not the same as empty text | the Bank item's `username` |

## Installing MariaDB and checking it like any service

```bash
sudo apt install mariadb-server
systemctl status mariadb
sudo ss -tlnp | grep 3306
sudo journalctl -u mariadb -n 20
```

The important line was from `ss`: MariaDB listens on port 3306, but only on **`127.0.0.1`**. That comes from `bind-address = 127.0.0.1` in its config, and it's exactly right: only the API on the same machine needs the database. A database reachable from the network is one of the most common causes of real data leaks.

`sudo mariadb` logged me in as the database's administrator without a password:

```text
MariaDB [(none)]> SELECT VERSION();
+-----------------------------------+
| VERSION()                         |
+-----------------------------------+
| 10.11.14-MariaDB-0ubuntu0.24.04.1 |
+-----------------------------------+
```

On Ubuntu, MariaDB's `root` uses **unix_socket** authentication: it trusts the Linux user, so whoever is root on the Dell through `sudo` is root in the database. Without `sudo`:

```text
$ mariadb
ERROR 1045 (28000): Access denied for user 'er-shishir'@'localhost' (using password: NO)
```

My Linux username isn't a database user, and `using password: NO` means I didn't even send one.

## Lesson Learned: Fixing a password I copied from the guide

The API needs its own database user that can only touch its own database: **least privilege**. If the API is ever misused, the damage stays small. I created the database and the user:

```sql
CREATE DATABASE vaultlab CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'vaultlab'@'localhost' IDENTIFIED BY 'paste-your-generated-password-here';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, DROP
  ON vaultlab.* TO 'vaultlab'@'localhost';
```

Everything said `Query OK`, and `SHOW GRANTS` looked perfect. But I had copied the line from my guide **with the placeholder still in it**, so the password was literally `paste-your-generated-password-here`. Anyone who read the guide would know it.

Fixing it taught me three more things:

1. **I tried `ALTER USER` while logged in as `vaultlab`** and got:

   ```text
   ERROR 1227 (42000): Access denied; you need (at least one of) the CREATE USER privilege(s) for this operation
   ```

   Least privilege again: the app's user can't change user accounts, not even its own password. It has to be done as the administrator, with `sudo mariadb`.

2. **I posted the new password in a chat** by copying my whole terminal output, including the line `openssl rand -base64 24` printed. A password that has been shared is a used password, so I had to generate another one. Now, when I share terminal output, I leave out lines with secrets.

3. **I tested the limits as the wrong user.** I ran the "forbidden" commands in the `sudo mariadb` session, so `CREATE DATABASE other` worked and I could read all the database accounts, because root may do anything. The prompt tells you who you are: `MariaDB [(none)]>` after `sudo mariadb` is root, `MariaDB [vaultlab]>` after `-u vaultlab` is the limited user. Run as `vaultlab`, the limits worked:

```text
MariaDB [vaultlab]> SHOW DATABASES;
+--------------------+
| Database           |
+--------------------+
| information_schema |
| vaultlab           |
+--------------------+

MariaDB [vaultlab]> CREATE DATABASE other;
ERROR 1044 (42000): Access denied for user 'vaultlab'@'localhost' to database 'other'
MariaDB [vaultlab]> SELECT User FROM mysql.user;
ERROR 1142 (42000): SELECT command denied to user 'vaultlab'@'localhost' for table `mysql`.`user`
```

So by the end, I had met four different "Access denied" errors:

| Error | Means |
| --- | --- |
| 1045 | Not logged in: wrong user or password |
| 1044 | Logged in, but not allowed to use that **database** |
| 1142 | Logged in, but not allowed to use that **table** |
| 1227 | Logged in, but missing a **privilege** (like `CREATE USER`) |

In a support ticket, 1045 sends you to the credentials, and the others send you to the permissions.

## SQL by hand

The table design lives in Git, in `server/db/schema.sql`:

```sql
CREATE TABLE IF NOT EXISTS items (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  title      VARCHAR(100) NOT NULL,
  username   VARCHAR(255) NULL,
  password   VARCHAR(200) NOT NULL,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME     NULL     ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
);
```

`VARCHAR(100) NOT NULL` is the same rule as my API's validation: at most 100 characters, and required. The database fills in `id`, `created_at` and `updated_at` by itself.

```text
MariaDB [vaultlab]> SELECT * FROM items;
+----+-------------+---------------------+---------------+---------------------+------------+
| id | title       | username            | password      | created_at          | updated_at |
+----+-------------+---------------------+---------------+---------------------+------------+
|  1 | GitHub      | shishir             | fake-Pass-111 | 2026-10-13 19:25:15 | NULL       |
|  2 | Email       | shishir@example.com | fake-Pass-222 | 2026-10-13 19:25:15 | NULL       |
|  3 | Bank (demo) | NULL                | fake-Pass-333 | 2026-10-13 19:25:15 | NULL       |
+----+-------------+---------------------+---------------+---------------------+------------+
```

Then `WHERE username IS NULL` (never `= NULL`, which matches nothing), `LIKE '%mail%'`, `ORDER BY` and `COUNT(*)`. After an `UPDATE`, `updated_at` filled itself in. Deleting the same row twice gave `ROW_COUNT()` 1 and then 0, which is exactly how the API knows whether to answer `204` or `404`.

When I added the Bank item back, it got id **4**, not 3. `AUTO_INCREMENT` never reuses a number, so an old link to item 3 can never show a different item.

### The database says no

```text
ERROR 1048 (23000): Column 'title' cannot be null
ERROR 1406 (22001): Data too long for column 'title' at row 1
ERROR 1364 (HY000): Field 'password' doesn't have a default value
ERROR 1054 (42S22): Unknown column 'titel' in 'SELECT'
ERROR 1064 (42000): You have an error in your SQL syntax; ... near 'SELEC * FROM items' at line 1
```

1048, 1406 and 1364 mean the data broke a rule, 1054 means the query names something that doesn't exist, and 1064 means the SQL itself is broken.

## Lesson Learned: Undoing an UPDATE without WHERE

The most famous database mistake is forgetting `WHERE`. I did it on purpose, inside a transaction:

```text
MariaDB [vaultlab]> START TRANSACTION;
MariaDB [vaultlab]> UPDATE items SET password = 'oops';
Query OK, 3 rows affected (0.000 sec)
Rows matched: 3  Changed: 3  Warnings: 0

MariaDB [vaultlab]> SELECT id, title, password FROM items;
+----+-------------+----------+
| id | title       | password |
+----+-------------+----------+
|  1 | GitHub      | oops     |
|  2 | Email       | oops     |
|  4 | Bank (demo) | oops     |
+----+-------------+----------+

MariaDB [vaultlab]> ROLLBACK;
MariaDB [vaultlab]> SELECT id, title, password FROM items;
+----+-------------+---------------+
| id | title       | password      |
+----+-------------+---------------+
|  1 | GitHub      | fake-Pass-111 |
|  2 | Email       | fake-Pass-222 |
|  4 | Bank (demo) | fake-Pass-333 |
+----+-------------+---------------+
```

Every password in the vault was gone, and `ROLLBACK` brought them all back. Without `START TRANSACTION`, each statement is final the moment it runs. Two habits I'm keeping: run a `SELECT` with the same `WHERE` before any `UPDATE` or `DELETE`, and use a transaction on important data.

## Lesson Learned: A command that can't be wrong, failing because of an invisible character

To reset the table, I pasted `DROP TABLE items;` and got:

```text
ERROR 1051 (42S02): Unknown table 'vaultlab.items'
```

The `SELECT` one line earlier had just read from that table. When I **typed** the same command by hand instead of pasting it:

```text
MariaDB [vaultlab]> DROP TABLE items;
Query OK, 0 rows affected (0.007 sec)
```

The pasted line contained an invisible character, so MariaDB looked for a table called "items" plus something I couldn't see. Now, when a command fails in a way that makes no sense, I retype it before looking for deeper causes.

## Lesson Learned: Wrong folder, wrong prompt

Two more small mistakes, both worth remembering:

- I ran `mariadb -u vaultlab -p vaultlab < db/schema.sql` from the repo root instead of `server/`, and got `bash: db/schema.sql: No such file or directory`. That message came from **bash**, not from MariaDB: the command never even started. Because the table wasn't recreated, everything after it failed with a new error: **1146, Table 'vaultlab.items' doesn't exist**.
- I typed shell commands (`mariadb -u vaultlab ...`) at the `MariaDB [vaultlab]>` prompt, and MariaDB answered with 1064, because that isn't SQL. The prompt tells you who you're talking to: `...$` is bash, `MariaDB [...]>` is the database.

One more thing I noticed: `SELEC * FROM items` gave **1064**, not 1146, even while the table was missing. MariaDB checks that the SQL is valid **before** it looks for tables.

## Connecting the API

The API got two new packages: `mysql2` (the driver that speaks MariaDB's protocol) and `dotenv` (reads settings from a `.env` file).

- **The password is never in the code.** My repo is public. Settings live in `server/.env`, which is in `.gitignore`, and `server/.env.example` documents which settings exist, with no real values. On the Dell, `chmod 600 .env` means only my Linux user can read it.
- **`config.js` fails fast:** if a setting is missing, the server refuses to start and says what's missing.
- **A connection pool** keeps up to 5 connections open and lends them out, instead of opening a new one for every request.
- **`store.js` kept the same function names** as yesterday, so the routes barely changed.
- **`/api/health` now checks the database too,** and answers `503 Service Unavailable` if it can't reach it.

The most important idea is the `?` in every query:

```js
const [rows] = await pool.execute(`SELECT ${COLUMNS} FROM items WHERE title LIKE ? ORDER BY id`, [`%${text}%`])
```

The SQL text and the values travel **separately**, so a value can never change what the SQL means.

From the Mac:

```text
$ curl -s http://vaultlab.home:3000/api/health
{"status":"ok","database":"ok","uptimeSeconds":4}
```

Then I added an item called **arjun** in the React app, which needed no changes at all, and checked it at the source:

```text
$ mariadb -u vaultlab -p vaultlab -e "SELECT id, title FROM items"
+----+-------------+
| id | title       |
+----+-------------+
|  1 | GitHub      |
|  2 | Email       |
|  3 | Bank (demo) |
|  4 | arjun       |
+----+-------------+
```

Then I restarted the API and reloaded the app: **arjun was still there.** Yesterday the same restart wiped everything. The whole chain is now real: React on the Mac → Vite proxy → API on the Dell → MariaDB → disk.

## Lesson Learned: My health check said "ok" while the table was missing

While the table didn't exist (after my wrong-folder mistake), the health check still answered `"database":"ok"`. It only runs `SELECT 1`, which proves the login works, not that the `items` table is there. So the health check said everything was fine while every request for items would have failed with 1146. A health check is only as good as what it actually checks.

## Break and fix

I ran the API with `npm run dev` in one SSH tab and used curl in a second.

### Pasting a whole example block into bash

My first attempt printed things like:

```text
$: command not found
bash: HTTP/1.1: No such file or directory
{error:Internal Server Error}: command not found
```

I had pasted the guide's code block including the `$` signs and the **expected output**, and bash tried to run every line. Only the lines starting with `$` are commands, and the `$` itself isn't part of them.

Then my first real curl gave:

```text
curl: (7) Failed to connect to localhost port 3000 after 0 ms: Couldn't connect to server
```

Error 7 is Day 4's "connection refused": the API simply wasn't running.

### A wrong database password

With `DB_PASSWORD=wrong-password` in `.env`, the server still started, but its log warned `Database: NOT reachable (ER_ACCESS_DENIED_ERROR)`, and the health check told the truth:

```text
$ curl -i http://localhost:3000/api/health
HTTP/1.1 503 Service Unavailable
Content-Type: application/json; charset=utf-8
Content-Length: 63
```

The client only gets `500`/`503`. The real reason, **1045**, is only in the log.

### Missing settings, the database down, and a typo

- Without `.env`, the server refused to start: `Missing settings: DB_HOST, DB_USER, DB_PASSWORD, DB_NAME. Copy .env.example to .env and fill it in.`
- With MariaDB stopped, the log said `ECONNREFUSED 127.0.0.1:3306`: nothing listening. After `sudo systemctl start mariadb`, the API recovered **by itself**, without a restart, because the pool opens new connections. So the same `500` can mean **1045** (the database answered and said no: check the credentials) or **ECONNREFUSED** (nothing answered: check the service).
- A typo in a column name (`titel`) gave **1054**, and the driver logged the exact SQL it sent. Because of the `?` placeholders, values are never part of that SQL text, so a password from an `INSERT` never ends up in an error log.

## Lesson Learned: The fix only works once the running server uses it

I made the API's title limit 300 while the database allows 100, and posted a 150-character title:

```text
HTTP/1.1 500 Internal Server Error
Content-Length: 33

{"error":"Internal Server Error"}
```

The API let it through, the database refused it with **1406**, and the user got a vague `500` instead of a clear message. Then I tried to undo the change, and got the **same 500 again**. Twice.

The investigation:

1. I had run `git checkout -- src/routes/items.js` from the repo root instead of `server/`, so it pointed at a file that doesn't exist.
2. `grep` from the right folder showed the file did say `100` again.
3. So the **running** API was still using the old code. After a restart:

```text
HTTP/1.1 400 Bad Request
Content-Length: 75

{"error":"Invalid item","details":["title must be at most 100 characters"]}
```

Same input, and now a clear `400` that tells the user what to fix. When "I fixed it but nothing changed", I now check three things: is the file really changed, is it the right file, and is the running program using it?

## Lesson Learned: SQL injection on my own search

This was the most important part of the day. I replaced my safe search with a version that glues the user's text straight into the SQL:

```js
const sql = `SELECT ${COLUMNS} FROM items WHERE title LIKE '%${text}%' ORDER BY id`
const [rows] = await pool.query(sql)
```

A normal search for `git` found only GitHub. Then I searched for this:

```bash
curl -s -G http://localhost:3000/api/items/search --data-urlencode "q=zzz' OR 1=1 -- "
```

No title contains "zzz", but it returned **all six items in my vault, with every password**. The log showed why:

```text
[sql] SELECT ... FROM items WHERE title LIKE '%zzz' OR 1=1 -- %' ORDER BY id
```

My `'` closed the text early, `OR 1=1` made the condition true for every row, and `-- ` turned the rest into a comment. **My input became part of the SQL.** In a real password manager, that would be the whole vault, from one search box.

Then I made the database describe itself:

```bash
curl -s -G http://localhost:3000/api/items/search --data-urlencode "q=zzz' UNION SELECT 1, user(), version(), database(), NOW(), NOW() -- "
```

```json
[{"id":"1","title":"vaultlab@localhost","username":"10.11.14-MariaDB-0ubuntu0.24.04.1","password":"vaultlab", ...}]
```

The "item" is really the database user, the exact MariaDB version (and that it runs on Ubuntu 24.04) and the database name: exactly what an attacker needs for the next step. So I tried that next step, reading the database's own accounts:

```text
$ curl -i -G http://localhost:3000/api/items/search --data-urlencode "q=zzz' UNION SELECT 1, User, Password, Host, NOW(), NOW() FROM mysql.user -- "
HTTP/1.1 500 Internal Server Error
```

The log said **1142**: `SELECT command denied to user 'vaultlab'@'localhost' for table mysql.user`. The injection worked, but **least privilege stopped it**. If the API logged in as root, that request would have returned every database account and its password hash.

And the famous "delete everything":

```text
$ curl -i -G http://localhost:3000/api/items/search --data-urlencode "q=zzz'; DROP TABLE items; -- "
HTTP/1.1 500 Internal Server Error
```

That gave **1064**, and the table survived with all 6 items, but only because `mysql2` refuses two statements in one query by default. That's luck in the defaults, not a defence.

Then the fix: `git checkout -- src/store.js` to get the `?` version back, a restart, and the same attack again:

```text
$ curl -s -G http://localhost:3000/api/items/search --data-urlencode "q=zzz' OR 1=1 -- "
[]
```

The whole attack text is now just what I searched for. The defence, in order:

1. **Parameterized queries, always.** This alone stops SQL injection.
2. **Least privilege** limits the damage if something slips through.
3. **Generic error messages:** the attacker only ever got `500`, never the SQL error text that would help adjust the attack.

### One more thing I noticed: two clocks

The HTTP `Date:` header said **18:43 GMT**, while my items' `createdAt` said **20:43**. HTTP always uses GMT, but MariaDB stored the Dell's local time (Luxembourg, two hours ahead in summer time). Two clocks for the same moment is a classic source of "the log says it happened two hours later" tickets.

## The table I'm keeping

| What the client gets | What the log says | Cause |
| --- | --- | --- |
| curl error 7 | (nothing) | The API isn't running |
| Server won't start | `Missing settings: ...` | No `.env`, or a missing value |
| `500` + health `503` | 1045 `ER_ACCESS_DENIED_ERROR` | Wrong DB user or password |
| `500` + health `503` | `ECONNREFUSED 127.0.0.1:3306` | MariaDB not running |
| `500`, health says ok | 1146 `Table doesn't exist` | Table missing (health check too shallow) |
| `500` on one route | 1054 `ER_BAD_FIELD_ERROR` | Code and schema don't match |
| `500` on save | 1406 `ER_DATA_TOO_LONG` | Validation more lenient than the schema |
| `500` | 1142 | The app (or an attack) tried something its user may not do |
| Too much data, strange "items" | User input inside the SQL | SQL injection |

## Commands I used today

```bash
# MariaDB as a service
sudo apt install mariadb-server
systemctl status mariadb
sudo ss -tlnp | grep 3306
sudo journalctl -u mariadb -n 20
sudo systemctl stop mariadb / start mariadb

# Logging in
sudo mariadb                          # administrator (unix_socket)
mariadb -u vaultlab -p vaultlab       # the app's user
openssl rand -base64 24               # a random password (don't paste the output anywhere)

# Schema and data
mariadb -u vaultlab -p vaultlab < db/schema.sql
mariadb -u vaultlab -p vaultlab < db/seed.sql
mariadb -u vaultlab -p vaultlab -e "SELECT id, title FROM items"

# Checking what's really running
grep -n "title.length >" src/routes/items.js
git diff --stat
git checkout -- src/store.js

# Searching safely with curl
curl -s -G http://localhost:3000/api/items/search --data-urlencode "q=git"
```

## Security things I noticed

- **The database only listens on `127.0.0.1`,** and port 3306 is never opened in the firewall.
- **Least privilege** blocked my own SQL injection from reading the user table, and stopped the app's user from changing accounts.
- **Parameterized queries** are the real fix for SQL injection; least privilege and generic errors only limit the damage.
- **Secrets stay out of Git and out of chats:** `.env` is ignored and `chmod 600`, and a password that has been shared must be replaced.
- **Placeholders in copied commands are a real risk:** my first database password was the guide's example text.
- **Passwords are still stored as plain text** in the vault table. It's fine for fake test data on my home network, and fixing it with encryption comes later.

## Reflection

**What did I learn?**
How a relational database works, SQL for creating, reading, changing and deleting data, transactions, database users and least privilege, connecting an API through a pool with settings in `.env`, and SQL injection from both sides.

**What did I struggle with?**
Mostly small things: a placeholder password, an invisible character, the wrong folder, the wrong prompt, and a fix that didn't work until I restarted the server. Each one looked like a mystery until I checked something basic.

**What did I understand better after practising?**
That "Access denied" isn't one error but four, and that the same `500` can mean a wrong password, a stopped service, a missing table or bad input. The error code in the log tells them apart.

**What should I review next?**
The error number table, and the three defences against SQL injection.

**What can I demonstrate now that I couldn't before?**
I can set up a database server with a limited user, write SQL by hand, connect an API to it without putting the password in the code, and show an SQL injection working on my own code, see least privilege limit it, and fix it.