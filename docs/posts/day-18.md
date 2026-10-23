# Day 18: Review day, incident drills and explaining it well

**Goal for today:** build nothing new. Practise the two things the Founder round tested: finding a problem I didn't cause, and explaining it calmly while I do. The feedback was that I knew the theory but struggled to hold an answer and show my thinking.

**Not done in this post:** Part 1 (the gap audit) and Part 4 (answering out loud) are things I do myself, and I haven't recorded them. I also didn't record logging in through the browser after each fix.

---

## Lesson Learned: the order is the answer

One runbook, `docs/troubleshooting.md`, turns "the application is not working" into an order of questions: clarify first, then start where the user is and move toward the server, one layer at a time (browser, name, network and port, TLS, nginx, app and database, auth). Each check either finds the problem or rules out everything before it. Two sentences to remember:

- "I start from what the user sees and move towards the server one layer at a time, because each check rules out everything before it."
- "The status code tells me which side to look at: no answer means network or TLS, 5xx means the server side, 4xx means the request or permissions."

## The drill script

`deploy/chaos.sh` injects one of eight faults, shows only what a user would say, and undoes it afterwards. Everything it changes is saved first; the fault number sits in a root-only file so it isn't on my screen. It runs each step in a child process, because inside an `if` bash ignores `set -e` and a failed step wouldn't stop the rest. Before starting, I made a fresh backup and checked that the monitor from Day 16 showed everything `OK`.

## Round by round

| Round | Ticket (short) | First hypothesis | Real cause |
| --- | --- | --- | --- |
| 1 | can't log in, "something went wrong" | a failure behind nginx | MariaDB stopped |
| 2 | everyone logged out, "were we hacked?" | sessions gone on the server, not a breach | sessions table emptied |
| 3 | page loads, nothing works | nginx can't reach the API | API listening on the wrong address |
| 4 | can't log in (same wording as round 1) | the database or its access | MariaDB stopped, again |
| 5 | everyone logged out (same as round 2) | sessions removed, not a breach | sessions table emptied, again |

**Round 1 and 4: MariaDB stopped.** The services told it fast, and the health check told it with a cause:

```text
nginx          active
vaultlab-api   active
mariadb        inactive
{"status":"error","database":"unreachable"} HTTP 503
```

A login attempt returned 500, and the API's journal said `ECONNREFUSED 127.0.0.1:3306`. In round 4 that last line mattered: a database that is running but refuses the app's user would also give a login 500, but it would say "access denied", not "connection refused". The fix is `systemctl start mariadb`, then a restart of the API. My `curl` ran a second after the restart in round 1 and returned a **502**: the API wasn't listening yet. Three seconds later, `{"status":"ok","database":"ok"}`. A 502 straight after a restart often means "wait a moment", not "something else broke".

**Round 3: two correct-looking configurations that no longer match.** All three services were `active`, and health through nginx gave 502. nginx's error log named the address it tried, and `ss` showed where Node really was:

```text
connect() failed (111: Connection refused) while connecting to upstream ... upstream: "http://127.0.0.1:3000/..."
LISTEN 0  511  127.0.0.2:3000  0.0.0.0:*
VaultLab API on http://127.0.0.2:3000
```

`HOST` in `/etc/vaultlab/api.env` had been changed to `127.0.0.2`, so nginx knocked on one address and the app answered on another. "Active" in `systemctl` only says a process exists, not that anyone can reach it. A stopped API gives the same 502, so what tells them apart is the upstream address in the error log together with `ss -tln`. The fix was `HOST=127.0.0.1` and a restart; afterwards `ss` showed `127.0.0.1:3000` and health was 200.

**Round 2 and 5: "were we hacked?"** Everything was healthy, with no errors and no auth warnings. A request with no session returned 401, as it should. The nginx access log showed requests only from `127.0.0.1`, and the earlier burst of failed logins (401 and 429) was my own `curl` testing from the Dell itself, hours earlier. The one check I couldn't do as myself needed `sudo`:

```text
+----------+
| sessions |
+----------+
|        0 |
+----------+
```

An empty sessions table with no errors anywhere else explains a mass logout without a breach, and the calm reply says so: no data changed, everyone logs in again. The note is where the real question goes: who or what ran the delete (here the drill; in real life the database logs, recent deployments, and who has access).

**Round 5 had a trap.** The API's journal still contained errors from round 4, `ECONNREFUSED` and a 500, and they looked like a clue. They were from the previous round, a few minutes older than the ticket. Always read the timestamp before blaming a log line.

## What I learned

- The same ticket wording can come back with a different, or the same, cause. Confirm it, don't assume.
- Test from where the user is. My first health `curl` from the Dell returned `HTTP 000`, not because of the app but because that shell doesn't trust my home CA. `-k` for the test (never for real) showed the real answer.
- `status: ok` doesn't mean the app works. The check from Day 16 and the health endpoint both say what *they* test; nothing tests the login path except a login.
- Write what I saw separately from what I concluded. That's the difference between "I think it's the database" and "health returned 503 and mariadb was inactive".

## Two texts after every round

A reply for the user (calm, plain, no blame, what happened, what I did, what they should do) and an internal note (symptom, cause, found by, fix, verified, prevent). For round 3:

```text
Hi,

Thanks for reporting this, and sorry for the trouble. The page loaded but the part that does the work behind it
couldn't be reached, which is why nothing responded. A setting had changed so that the two parts of VaultLab
were looking for each other at different addresses. I put it back and confirmed that logging in and opening
your vault work again.

You don't need to do anything, and your passwords were not affected.
```

```text
Symptom:   page loads, every action fails; /api/health via nginx returns 502
Cause:     HOST in /etc/vaultlab/api.env was 127.0.0.2, nginx proxies to 127.0.0.1:3000
Found by:  502 with all services active -> nginx error.log upstream -> ss -tln -> API journal
Fix:       HOST=127.0.0.1; systemctl restart vaultlab-api
Verified:  /api/health 200 ("database": "ok"); ss shows 127.0.0.1:3000
Prevent:   find who or what changed the setting; "active" does not prove reachable
```

## The question index (the handbook's front page)

| Question | Where |
| --- | --- |
| Which process listens on a port, and on which address? | [Day 4](post.html?day=4) |
| What's the difference between "connection refused" and a timeout? | [Day 4](post.html?day=4), [Day 8](post.html?day=8) |
| How does a name become an address, and how do I check it? | [Day 5](post.html?day=5) |
| How do I read a request and its status code with curl? | [Day 5](post.html?day=5) |
| How do I debug a failed request in the browser (Console, Network, Application)? | [Day 6](post.html?day=6) |
| What does middleware order change in Express? What happens on an unhandled error? | [Day 8](post.html?day=8) |
| How do I recover from an UPDATE without WHERE? What is SQL injection? | [Day 9](post.html?day=9) |
| Why hash login passwords but encrypt vault passwords? How do sessions and cookie flags work? | [Day 10](post.html?day=10), [Day 12](post.html?day=12) |
| What are IDOR and mass assignment, and why 404 instead of 403? | [Day 11](post.html?day=11) |
| What do the key, IV, tag and AAD do in AES-GCM? | [Day 12](post.html?day=12) |
| What does TLS protect and not protect? How do certificate errors read? | [Day 13](post.html?day=13) |
| What does a 502 mean, and where's the evidence? | [Day 13](post.html?day=13), [Day 14](post.html?day=14), this post |
| How do I run an app as a hardened service, and read its logs? | [Day 14](post.html?day=14) |
| How do I make, encrypt, schedule and restore a backup? | [Day 15](post.html?day=15) |
| What should I monitor, and how do I avoid alert fatigue? | [Day 16](post.html?day=16) |
| How do I give a machine limited, read-only access over SSH? | [Day 17](post.html?day=17) |
| "The application is not working": what do I do, in what order? | this post, `docs/troubleshooting.md` |

## Commands I used today

```bash
sudo ./deploy/chaos.sh                 # inject a random fault, prints only the ticket
sudo ./deploy/chaos.sh undo            # put it back
sudo ./deploy/chaos.sh answer          # only after diagnosing
systemctl is-active nginx vaultlab-api mariadb
curl -sk https://vaultlab.home/api/health
ss -tln | grep ':3000'
sudo tail -20 /var/log/nginx/error.log
sudo journalctl -u vaultlab-api -n 50 --no-pager
sudo mariadb vaultlab -e "SELECT COUNT(*) FROM sessions"
```

## Not done yet

- **Part 1, the gap audit:** each interview gap proved on my own system, out loud.
- **Part 4:** the answer shape and the model answers, said in my own words in under two minutes with one example each.
- **The browser check** after each fix, which I didn't record.
- Redoing the drills against a timer.

## Reflection

**What did I learn?**
That the order of checks is the answer, and that a log line is only evidence once I've read its timestamp.

**What did I struggle with?**
Telling look-alike causes apart: the same ticket wording came back with the same or a different cause, and a 502 right after a restart can just mean "wait a moment".

**What did I understand better after practising?**
That two correct-looking settings can disagree (round 3), and that the same ticket words can hide a different cause.

**What should I review next?**
The gap audit, the out-loud answers, and the drills alone against a timer.

**What can I demonstrate now that I couldn't before?**
I can take a ticket, say what I'd ask first, work from the browser toward the server, point at the evidence for each conclusion, and write the reply and the note.
