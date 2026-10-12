# Day 8: Express.js, VaultLab's real API

**Goal for today:** give VaultLab a real API with Express: list, read, create, change and delete vault items, with proper status codes, validation, logging and error handling, and connect the React app to it.

**My setup:** the code in a new `server/` folder, next to `client/`. The API runs on the Dell on port 3000, and the React app on the Mac reaches it through the Vite proxy.

---

On Days 5 and 6 my servers were one long chain of `if` blocks, and one bad request could kill the whole process. Today VaultLab got a real API, built with **Express**, the most widely used web framework for Node.js. For the first time, items I add in the React app survive a page reload.

## REST in one page

**REST** is a set of habits that make APIs predictable:

- **Resources are nouns in the URL:** `items`, and one item is `items/4`. No `/getItems` or `/deleteItem?id=4`.
- **The HTTP method is the verb:** `GET` reads, `POST` creates, `PATCH` changes part of something, `DELETE` removes it.
- **The status code is the result**, so the client knows what happened before reading the body.
- **Each request stands alone** (stateless).

| Method and path | Does | Success | Typical errors |
| --- | --- | --- | --- |
| `GET /api/health` | "Are you alive?" | `200` | |
| `GET /api/items` | List all items | `200` | |
| `GET /api/items/:id` | One item | `200` | `400` bad id, `404` |
| `POST /api/items` | Create an item | `201 Created` + `Location` header | `400` invalid |
| `PATCH /api/items/:id` | Change some fields | `200` | `400`, `404` |
| `DELETE /api/items/:id` | Delete an item | `204 No Content` | `400`, `404` |

Two words I want to remember:

- **Idempotent:** doing it twice has the same effect as once. Deleting item 4 twice leaves it deleted; the second time just answers `404`. `POST` is not idempotent: posting twice creates two items, which is why a double-clicked "Save" can create duplicates.
- **Safe:** doesn't change anything. `GET` is safe, so never change data in a `GET`.

## How the server is organised

```text
server/src/
├── index.js            ← starts the server: port, host, "port in use"
├── app.js              ← middleware and routes, in order
├── store.js            ← where items are kept (in memory for now)
├── routes/items.js     ← everything under /api/items
└── middleware/
    ├── logger.js       ← one log line per request
    └── errors.js       ← JSON 404, and the error handler
```

Each file has one job, so when something breaks, I know where to look: a wrong status code is in `routes/`, a missing log line is in `logger.js`, and leaked error details would be in `errors.js`.

The routes never touch the items directly; they go through five functions in `store.js`. Tomorrow I'll swap that file for a real database, and the routes shouldn't need to change.

A warning I'm keeping in mind: for today, passwords are stored as **plain text** in the server's memory. That's only acceptable for an experiment with fake passwords on a server only I can reach. VaultLab will encrypt secrets later in the project.

## Middleware

Every request travels through a **chain of functions**, in the order they were added with `app.use(...)`. Each one either answers or calls `next()` to pass the request on:

```text
request → logger → express.json() → routes → notFound → response
                                        │
                          (an error anywhere) → errorHandler → response
```

- **The logger** writes one line per request with the time, client IP, method, URL, status and duration. It **never logs the request body**, because a `POST` body contains a password, and logs are read by many people and kept for a long time. It also logs requests that never got an answer.
- **`express.json()`** reads JSON bodies into `req.body`, with a 10 kb limit.
- **`notFound`** answers unknown routes with JSON instead of Express's HTML page.
- **The error handler** has four parameters, which is how Express recognises it. Client mistakes get a `4xx` with a clear message; our own mistakes get a `500`, with the details in the log and nothing internal sent to the client.
- **`app.disable('x-powered-by')`** removes the `X-Powered-By: Express` header, which only tells attackers what to look up.

**Order matters:** with the logger placed after the routes, normal requests aren't logged at all, because the router answers and never calls `next()`. So "it's not in the logs" doesn't always mean "it never reached the server".

## Lesson Learned: Fixing "Could not resolve host" for my API

I started the API on the Dell with `npm start` and checked it was listening:

```text
$ sudo ss -tlnp | grep 3000
LISTEN 0      511          0.0.0.0:3000       0.0.0.0:*    users:(("node-MainThread",pid=47851,fd=22))
```

`0.0.0.0:3000` means it accepts connections from the network, not only from the Dell itself (Day 4). On the Mac, the name `vaultlab.home` needed to point at the Dell again, so I edited the Mac's hosts file (`sudo nano /etc/hosts`, Day 5). After that:

```text
$ curl -i http://vaultlab.home:3000/api/health
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8
Content-Length: 36
ETag: W/"24-cPizsFWCJ2YyQK6Rb2OP7yo1VlU"
Date: Mon, 12 Oct 2026 18:24:36 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"status":"ok","uptimeSeconds":1731}
```

Things I read in that answer:

- `200` with `{"status":"ok"}`: DNS (the hosts file), the network, the port and the app all work.
- No `X-Powered-By` header, so `app.disable('x-powered-by')` works.
- `uptimeSeconds: 1731`: the server had been running for about 29 minutes without a restart.
- The `%` zsh prints after the JSON isn't part of the response. It just means the output didn't end with a newline.

## Lesson Learned: My firewall was off the whole time

Checking the Dell's firewall, I found this:

```text
$ sudo ufw status
Status: inactive
```

`ufw` wasn't filtering anything, so every port the Dell listens on was open to every device on my home network. The `ufw allow` rules I added on earlier days were saved, but never applied. Nothing was exposed to the internet, because my router doesn't forward any ports. But a service with no login and plain-text passwords shouldn't be reachable by every device at home.

The safe order to turn it on matters: **allow SSH first**, or `ufw enable` cuts off the SSH session I'm using to run it.

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow from 192.168.178.0/24 to any port 22 proto tcp
sudo ufw allow from 192.168.178.0/24 to any port 3000 proto tcp
sudo ufw enable
sudo ufw status verbose
```

And before closing the old session, open a new SSH connection to make sure I can still get in.

The bigger lesson: **adding a rule is not the same as the rule being active.** "I configured the firewall" means nothing until `ufw status` says `active`.

## Connecting the React app

I pointed the Vite proxy at port 3000, added one helper (`lib/api.js`) that checks every API answer the same way, and changed the app so that **the server goes first**: a new item only appears once the server has saved it and sent it back with its id, and a card only disappears once the server answers `204`. If the server says no, the screen doesn't pretend otherwise.

Then I tested it in the browser: the vault loaded from the Dell, I added two items, and after reloading the page they were still there, five items in total. That's the difference from yesterday: the data now lives on the server, not in the browser.

It still lives in the server's **memory**, though. When the API restarts, my added items disappear and the three sample items come back. That's what tomorrow's database is for.

## Break and fix

Then I broke the server in eight ways, with `npm run dev` on the Mac so it restarted on every save. For each break I made the change, reproduced it with curl, read the log, and undid it.

| Scenario | What happened |
| --- | --- |
| Missing `return` after a `400` | curl got **400**, but the item **was saved anyway**. The log showed `Cannot set headers after they are sent to the client` and recorded **201** |
| A route that never answers (`DELETE`) | curl gave up with exit code **28** (timeout). The item was deleted, and the log said "no response, connection closed" |
| No `express.json()`, or no `Content-Type` header | Both gave **400** `Body must be a JSON object` |
| Broken JSON / a body over 10 kb | **400** and **413**. With the error handler's special cases removed, broken JSON wrongly became a **500** |
| An error thrown in a route, normal or `async` | **500**, logged, and the server kept running |
| An error thrown inside a timer | The request got **200**, then the server crashed, and the next curl was refused (exit code **7**) |
| A `/search` route placed after `/:id` | **400** "id must be a positive whole number": `/:id` matched first. Moving `/search` above `/:id` fixed it |
| Starting a second copy | `port 3000 is already in use` |

### What I learned from it

**The missing `return` is the most dangerous one.** The user is told "invalid, not saved" while bad data is saved anyway. And it fooled the log too: it said `201`, while curl received `400`. When a log and the client disagree, trust what actually went over the wire (curl or the Network tab). The stack trace pointed at the second answer, not at the missing `return`: an error shows where it **hurt**, not where it **started**.

**A request that hangs with no error** usually means a code path that forgot to answer. Without the logger's "no response" line, it would leave no trace at all.

**Same symptom, two causes:** `Body must be a JSON object` can mean the server doesn't read JSON, or the client didn't say it was sending JSON. curl's `-d` without `-H "Content-Type: application/json"` sends a web form. Check the request headers before blaming the server.

**4xx vs 5xx tells support which side to look at.** Broken JSON is the client's mistake and must be a `400`. Reported as a `500`, it sends everyone looking at the server for nothing.

**Express 5 catches errors in routes**, including `async` ones, so one bad request no longer kills the server for everyone, unlike my Day 5 and 6 servers. In Express 4, an error in an `async` route left the request hanging, which is worth knowing because older tutorials are full of that.

**But it can't catch everything.** Code that runs later, outside a request (timers, background jobs), has nothing around it to catch an error, so the whole process dies. That code needs its own `try/catch`, and a server needs something that restarts it, which will be `systemd` later.

**Route order:** Express uses the first route that matches, and `/:id` matches anything. Specific routes go before routes with parameters. I kept the search route, above `/:id`.

## Commands I used today

```bash
# On the Dell
cd ~/Desktop/vaultlab && git pull
cd server && npm install && npm start
sudo ss -tlnp | grep 3000
sudo ufw status

# On the Mac
sudo nano /etc/hosts
curl -i http://vaultlab.home:3000/api/health
cd client && npm run dev
```

## Security things I noticed

- **My firewall was inactive.** Rules mean nothing until `ufw status` says `active`, and SSH must be allowed before enabling it.
- **Never log request bodies:** they can contain passwords.
- **Error answers say nothing internal;** the details go to the log.
- **`X-Powered-By` is removed,** and request bodies are limited to 10 kb.
- **Passwords are plain text in memory for now.** It's an experiment on my home network only, never with real passwords and never forwarded to the internet.
- **The server validates everything,** even what the React form already checks, because anyone can send anything with curl.

## Reflection

**What did I learn?**
REST and its status codes, how Express organises routes and middleware, how one error handler keeps a server alive, and how a front end and an API agree on a contract.

**What did I struggle with?**
The name `vaultlab.home` not resolving at first, and finding out the firewall I thought I had was never on.

**What did I understand better?**
Why the order of middleware and routes matters, and that a log can be wrong.

**What should I review next?**
The break-and-fix table, and especially the missing `return`.

**What can I demonstrate now that I couldn't before?**
I can deploy an Express API on my Ubuntu server, reach it from another machine by name, check that it's listening and what the firewall allows, and explain how the React app saves through it.
