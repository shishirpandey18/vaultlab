# Day 11: Authorization, every user sees only their own vault

**Goal for today:** give every vault item an owner, make every query check that owner, add roles with an admin-only route, and attack my own API to see the four most common authorization mistakes.

**My setup:** MariaDB and the API on the Dell, the React app on the Mac, as on Days 9 and 10.

---

Yesterday ended with VaultLab's most serious bug: I registered a second account, and it could see **the same items** as the first one. Every logged-in user could read, change and delete everyone's passwords. Yesterday answered "**who** are you?". Today answers "**what** may you do?".

| | Authentication | Authorization |
| --- | --- | --- |
| Question | Who are you? | What may you do? |
| Checked by | Password, session cookie | Ownership, roles |
| Fails with | `401 Unauthorized` | `403 Forbidden`, or `404` |

Authentication is the badge at the office door; authorization is which rooms the badge opens. Until today, every badge opened every room.

## Giving every item an owner

The `items` table had no idea who an item belonged to. Adding a required `user_id` column in one go doesn't work: the existing rows have no owner yet, so the database would refuse. The safe order is **add, fill, require**:

1. Add `user_id` as optional.
2. Fill it in for every existing row.
3. Make it required, and link it to `users` with a foreign key.

That's my migration `server/db/003-item-owners-roles.sql`:

```sql
SET @owner = (SELECT id FROM users WHERE email = 'shishir@example.com');
SELECT IF(@owner IS NULL, 'NO SUCH USER: fix the email in this file',
          CONCAT('Existing items go to user ', @owner)) AS check_owner;

ALTER TABLE items ADD COLUMN user_id INT UNSIGNED NULL AFTER id;
UPDATE items SET user_id = @owner WHERE user_id IS NULL;
ALTER TABLE items
  MODIFY user_id INT UNSIGNED NOT NULL,
  ADD KEY items_user (user_id),
  ADD CONSTRAINT items_user_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE;

ALTER TABLE users ADD COLUMN role ENUM('user', 'admin') NOT NULL DEFAULT 'user' AFTER password_hash;
```

- The `check_owner` line prints whether the email was found **before** anything changes.
- `ON DELETE CASCADE`: deleting an account deletes its items. For a password manager that's what I want, because a deleted account's secrets shouldn't linger. It's a decision, though, not a default to copy everywhere.
- `ENUM('user', 'admin')`: the column can only ever hold those two words.

## Lesson Learned: A backup you've never restored is only a hope

`ALTER TABLE` can't be undone with `ROLLBACK` like Day 9's `UPDATE`: MariaDB commits it immediately. So before the migration I made a backup:

```bash
mariadb-dump -u vaultlab -p --single-transaction --skip-add-locks vaultlab > ~/backups/vaultlab-before-003.sql
chmod 600 ~/backups/vaultlab-before-003.sql
```

The `--skip-add-locks` is new, and it fixes a problem in my Day 9 backup command. Without it, the dump contains `LOCK TABLES` lines, which my least-privilege `vaultlab` user isn't allowed to run. Restoring such a file as `vaultlab` **drops and recreates each table first**, then fails with error `1044` before the rows go back in. The backup would have looked fine right up to the moment I needed it, and then deleted my data. Old dumps still restore as the administrator (`sudo mariadb vaultlab < file.sql`), who may lock tables.

The other thing about migrations: **the database and the code have to change together.** After this migration, the old code that inserts items without an owner fails with `1364` (`Field 'user_id' doesn't have a default value`, Day 9's error). A real deployment either updates both at once, or writes migrations the old code can live with for a while.

## Lesson Learned: Filter in the query, don't check afterwards

There are two ways to stop bob from reading my item:

- **Check afterwards:** load the item, then compare its owner with the logged-in user. Every route has to remember to do it, and one forgotten check is a breach.
- **Filter in the query:** ask the database for "this item, **if it belongs to this user**". If it isn't his, the database finds nothing. There's no separate step to forget.

VaultLab does the second. Every function in `store.js` now takes the user's id first, and every query has `user_id = ?`:

```js
async function getItem(userId, id) {
  const [rows] = await pool.execute(`SELECT ${COLUMNS} FROM items WHERE id = ? AND user_id = ?`, [id, userId])
  return rows[0] // undefined if there is no such item OR it belongs to someone else
}
```

The same goes for listing, searching, updating and deleting. Three details matter:

- A new item's owner comes from the **session** (`req.user.id`), never from the request body.
- `user_id` isn't in `CHANGEABLE`, the list of fields a `PATCH` may change, so nobody can move an item to another account.
- All the queries are in one file, so that's the only place where the rule has to be right.

When I first read the old `getItem`, I was honestly surprised there had been no owner check at all. There was simply nothing in the table to check against.

## 401, 403 or 404?

| Code | Means | VaultLab answers it when... |
| --- | --- | --- |
| `401` | "I don't know who you are" | there's no valid session |
| `403` | "I know who you are, and you may not" | a normal user asks for the admin page |
| `404` | "There's nothing here (for you)" | the item doesn't exist **or isn't yours** |

Why `404` for someone else's item, and not `403`? Because `403` **confirms the item exists**. GitHub does the same: a private repository you can't see answers `404`. `403` is right when existence isn't a secret: everyone knows there's an admin page, bob just isn't allowed in.

## Roles and an admin-only route

Some actions belong to a role, not to an owner. A small middleware lets a request through only with the right role, and logs every refusal:

```js
function requireRole(role) {
  return (req, res, next) => {
    if (req.user?.role !== role) {
      console.warn(`[authz] user ${req.user?.id} (${req.user?.role}) denied ${req.method} ${req.originalUrl}`)
      return res.status(403).json({ error: 'Forbidden' })
    }
    next()
  }
}
```

```js
app.use('/api/auth', authRouter)
app.use('/api/items', requireAuth, itemsRouter)
app.use('/api/admin', requireAuth, requireRole('admin'), adminRouter)
```

Three layers, in order: logged in? Admin? Then the route. `GET /api/admin/users` lists every account with its role and **how many** items it has, never the items themselves. Even an administrator of a password manager shouldn't be able to read people's secrets.

There's deliberately no API to become an admin. Someone with access to the server does it in the database:

```bash
sudo mariadb vaultlab -e "UPDATE users SET role = 'admin' WHERE email = '...'"
```

The session looks the role up in the database on every request, so the change applies immediately, without logging in again. In the React app, admins see "(admin)" next to their email and an accounts table under the vault; bob sees neither.

## Break and fix

Then I put back, one at a time, the most common authorization mistakes in real applications, and attacked each one as `bob@example.com`, a normal user with no items of his own. My test account `shishir@example.com` was the victim.

## Lesson Learned: IDOR, the bug you only find by asking for someone else's id

**IDOR** (Insecure Direct Object Reference) is the most common authorization bug on the web: the app loads something by an id from the request and forgets to check whose it is. I removed `AND user_id = ?` from `getItem` only.

Bob's own list still looked perfect: it was empty, as it should be. A quick test would have said "all fine". Then bob tried other ids with a loop:

```bash
for i in $(seq 1 10); do curl -s -o /dev/null -w "bob GET /api/items/$i -> %{http_code}\n" -b bob.txt http://localhost:3000/api/items/$i; done
```

The ids of other accounts' items answered `200`, and the full item came back, **password included**. One missing condition in one function, and every item on the server could be read by counting from 1. After `git checkout -- src/store.js` and a restart, the same loop answered `404` for everything that wasn't his.

The lesson: a correct list proves nothing. Every route that takes an id needs its own check, and testing must include "what if I ask for **someone else's** id?"

## Lesson Learned: 403 can leak as much as it hides

Next, a developer decides `403` is "more honest" for someone else's item. I changed the `GET /:id` route to answer `403` when the item exists but isn't bob's. No item leaked. But the same loop now gave:

```text
403
403
403
404
```

Bob couldn't read anything, but he now knew exactly **which ids exist** and belong to someone else, and where they stop. For a password manager, even "this user has 340 secrets" is information. With `404` for both cases, he learns nothing.

## Lesson Learned: Mass assignment, admin with one extra word

**Mass assignment** means trusting fields in a request that the user should never control. I made registration read the role from the body:

```js
const role = req.body.role || 'user'
```

A new attacker, `mallory@example.com`, registered with one field the React form never sends:

```bash
curl -s -X POST http://localhost:3000/api/auth/register -H "Content-Type: application/json" \
  -d '{"email":"mallory@example.com","password":"...","role":"admin"}'
```

```text
mallory GET /api/admin/users -> 200
```

```text
+----+---------------------+-------+
| id | email               | role  |
+----+---------------------+-------+
|  8 | mallory@example.com | admin |
+----+---------------------+-------+
```

A complete stranger became an administrator with one extra word. Nobody would notice in testing, because the attack doesn't use the form. After undoing the change, I ran **the same attack again**:

```text
{"id":9,"email":"mallory@example.com"}
+----+---------------------+------+
| id | email               | role |
+----+---------------------+------+
|  9 | mallory@example.com | user |
+----+---------------------+------+
```

The real code inserts only `email` and `password_hash`, so the role always comes from the database default. The rule: **never pass the request body into the database; list the fields you accept.** It's the same reason `user_id` isn't in `CHANGEABLE`.

### Two things that confused me on the way

My first run of this break gave `000` from curl. That means **no HTTP answer at all**: my edit to `auth.js` had a mistake, and the API crashed when it reloaded. After fixing it, the admin route answered `401`, not `200`. That was because mallory's login had run **while the API was down**, so her cookie file was empty. The same lesson as yesterday: check that the first step worked before reading the last one.

Then `/api/auth/me` printed nothing, even though the headers said `200 OK`. My terminal was hiding a last line that didn't end with a newline. The headers still told the story: `Content-Length: 53` is exactly the length of `{"id":8,"email":"mallory@example.com","role":"admin"}`. With `"role":"user"`, it would be 52. Adding `; echo` after a curl command makes the body show.

## Lesson Learned: Hidden is not protected

Last, I removed `requireRole('admin')` from the admin line, so only the React app's `user.role === 'admin'` check was left. In the browser, bob still saw no admin panel. Everything looked secure. Then bob asked the API directly:

```bash
curl -s -b bob.txt http://localhost:3000/api/admin/users
```

He got the whole account list: every email, every role, every item count. (I'm only showing the shape here, because the list holds real accounts.) The front end runs on the user's computer, and the user controls it completely. Hiding a button is for convenience; **every check that matters is on the server.**

After `git checkout -- src/app.js`, the same request answered:

```text
HTTP/1.1 403 Forbidden
```

The API log records every refusal as `[authz] user 7 (user) denied GET /api/admin/users`, exactly the line support would search for when someone says "I get an error on the admin page."

### The break I skipped

The guide had a fifth break: a migration that fails halfway, then a restore from the backup. I skipped it on purpose. My database now holds real accounts, and a wrong restore would lose data, as I learned with the backup above. I'll do it on a copy of the database.

| The mistake | What bob (or mallory) gets |
| --- | --- |
| One query without `AND user_id = ?` (IDOR) | Any item, by counting ids |
| `403` for other people's things | Which ids exist, and how many |
| Trusting fields from the request (mass assignment) | Admin rights, with one extra field |
| Checking only in the front end | Everything the API offers, with curl |
| A backup that was never restored | No way back from a bad migration |

## Commands I used today

```bash
# Backup before changing a table's structure
mariadb-dump -u vaultlab -p --single-transaction --skip-add-locks vaultlab > ~/backups/vaultlab-before-003.sql

# The migration, and checking it
mariadb -u vaultlab -p vaultlab < db/003-item-owners-roles.sql
sudo mariadb vaultlab -e "SELECT id, user_id, title FROM items"
sudo mariadb vaultlab -e "SHOW CREATE TABLE items\G"

# Trying ids as another user
for i in $(seq 1 10); do curl -s -o /dev/null -w "$i -> %{http_code}\n" -b bob.txt http://localhost:3000/api/items/$i; done

# Undo a break (then restart the API)
git checkout -- src/store.js
```

## Security things I noticed

- Every item query is limited to the logged-in user, inside the SQL itself.
- Other people's items answer `404`, so ids can't be counted.
- The owner and the role come from the server (session and database), never from the request.
- Roles are checked on the server; the React app only hides what a user can't use anyway.
- Refused admin requests are logged with who tried what.
- Even admins see item counts, never items. The passwords are still stored as plain text, though, so whoever reads the database reads them. Encryption is next.

## Reflection

**What did I learn?**
The difference between authentication and authorization, how to add an owner to a table that already holds data, and the four classic authorization bugs: IDOR, 403 leaks, mass assignment, and front-end-only checks.

**What did I struggle with?**
Keeping track of what was really running: the crashed API in Break 3, and the empty cookie file that made a working break look like it failed.

**What did I understand better after practising?**
That 404 for someone else's item isn't hiding the truth, it's refusing to answer a question bob shouldn't be able to ask. And that a correct-looking screen says nothing about the API behind it.

**What should I review next?**
401 vs 403 vs 404, and the add, fill, require order for migrations.

**What can I demonstrate now that I couldn't before?**
I can test an API for authorization bugs as a second user with curl, explain each one with real output, and show where in the code the fix lives.