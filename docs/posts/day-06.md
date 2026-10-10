# Day 6: Debugging from the browser with DevTools

**Goal for today:** given a broken page, open DevTools and say within a minute whether the problem is JavaScript in the browser, the network, or the server, and point to the evidence.

**My setup:** the Dell runs a small "DevTools lab" server, the Mac is the user's computer with Chrome. Two SSH tabs on the Dell (server log and commands), and a third for a second copy of the server.

---

This was the day I was waiting for. The question for today: **"A user says the page is broken. How do you investigate it from the browser?"** I knew the words "Console" and "Network tab", but I couldn't walk through them step by step. Today I built a page with bugs on purpose and found every one of them from DevTools, so I can answer from experience.

## The five panels that matter

`Cmd + Option + I` opens DevTools in Chrome. Before anything else, I ticked two settings in the **Network** tab:

- **Preserve log**: keeps the list of requests when the page reloads. Without it, the request that caused the problem disappears the moment the page changes.
- **Disable cache**: always loads fresh files while DevTools is open, so I never debug an old version of a file.

| Panel | The question it answers |
| --- | --- |
| **Elements** | What is on the page right now, and how is it styled? |
| **Console** | Did JavaScript fail? What did the page log? |
| **Sources** | Which line of JavaScript, and what were the values? |
| **Network** | Which requests were made, and what came back? |
| **Application** | What does the browser store for this site (cookies, storage)? |

The sentence I'll remember: **Console = the browser's side, Network = the conversation with the server.**

## The DevTools lab

I extended yesterday's server so it also **serves files** (HTML, CSS, JavaScript), and wrote a page with eight buttons. Each one causes a different problem: a JavaScript bug, a wrong URL, a server error, a response that isn't JSON, a slow request, a request to another server, and one that crashes the server. There's also a login form with a demo account. Everything is in `experiments/browser/`:

```text
experiments/browser/
├── devtools-lab.js      ← the server
└── public/              ← what the browser downloads
    ├── index.html
    ├── style.css
    └── app.js           ← with bugs on purpose
```

When I opened `http://vaultlab.home:8080/`, the server log showed three lines at once:

```text
GET / -> 200
GET /style.css -> 200
GET /app.js -> 200
```

**One page is several requests**: first the HTML, then everything it links to. The Network tab showed the same three rows.

## Lesson Learned: "Nothing happens when I click" is often an uncaught error

I clicked **Show details of item 3**, and from the user's side, nothing happened. The page didn't change at all. The Console had the answer:

```text
Uncaught (in promise) TypeError: Cannot read properties of undefined (reading 'toUpperCase')
    at showDetails (app.js:50:30)
    at HTMLButtonElement.<anonymous> (app.js:56:3)
```

I read it the same way as a Node stack trace on Day 3:

- **Uncaught**: nothing caught the error, so the function just stopped. That's why "nothing happened". **(in promise)** means it was inside an `async` function.
- **`reading 'toUpperCase'`**: the thing **before** `.toUpperCase()` was `undefined`.
- **`app.js:50:30`**: the file, line and column.

Clicking `app.js:50:30` jumped straight to the line in the **Sources** panel:

```js
const name = item.username.toUpperCase();
```

I set a breakpoint on line 50, clicked again, and hovered over `item`: `{id: 3, title: "Bank (demo)"}`. Item 3 simply has no username. The data was fine; the code assumed every item has one. The fix:

```js
const name = item.username ? item.username.toUpperCase() : "(no username)";
```

## Lesson Learned: An empty Console doesn't mean the code is right

When I loaded the items, the list on the page showed:

```text
GitHub (shishir)
Email (shishir@example.com)
Bank (demo) (undefined)
```

The word `undefined` was shown to the user, and the Console said **nothing**. Putting `${item.username}` into a text never fails; it just prints "undefined". Same cause as the first bug, but without any error message. So I can't only look at the Console: I have to look at the page too. Fixed with:

```js
li.textContent = `${item.title} (${item.username ?? "no username"})`;
```

## Lesson Learned: A 200 can still be the wrong answer

The **Not JSON** button gave:

```text
Uncaught (in promise) SyntaxError: Unexpected token '<', "<!DOCTYPE "... is not valid JSON
```

The message itself is the clue: the code expected JSON, but the text started with `<`, as in `<!DOCTYPE html>`. The server had sent an HTML page. In the Network tab the request was a **`200 OK`**, and the **Response** tab showed a "Maintenance" HTML page. In real life this happens when a proxy error page, a login page or a maintenance page comes back where the API should have answered.

The fix was to check what kind of answer came back **before** reading it as JSON:

```js
const type = res.headers.get("content-type") || "";
if (!type.includes("application/json")) {
  throw new Error(`${res.status} ${res.statusText}: expected JSON but got ${type || "nothing"}`);
}
```

Now the page shows a clear red message instead of doing nothing:

```text
Unexpected answer: 200 OK: expected JSON but got text/html; charset=utf-8
```

## Reading the Network tab

For every request, the Network tab gives me what `curl -v` gave me yesterday, just laid out differently:

- **Headers**: the URL, method, status code, the server's address, and the request and response headers.
- **Payload**: the body the browser sent (for a `POST`).
- **Preview / Response**: what the server actually sent back.
- **Initiator**: which line of JavaScript made the request.
- **Timing**: where the time went.

The rule I learned: **the server's real answer is in the Network tab, not on the page.** The page shows what the JavaScript decided to show.

The **Wrong URL** and **Server error** buttons gave two red rows: `itemz` with **404** and `error` with **500**. The Console also showed a red line for each:

```text
Failed to load resource: the server responded with a status of 404 (Not Found)
Failed to load resource: the server responded with a status of 500 (Internal Server Error)
```

So a red line in the Console **isn't always a JavaScript bug**. "Failed to load resource" means "go and look in the Network tab". For the 500, the browser could only tell me **that** the server failed. The reason, `Database is not reachable (simulated)`, was only in the server log on the Dell.

## Lesson Learned: The password is readable in the Payload

I logged in three times and watched the `login` request:

| I typed | Status | Response |
| --- | --- | --- |
| nothing | `400 Bad Request` | `username and password are required` |
| `demo` / `wrong` | `401 Unauthorized` | `Wrong username or password` |
| `demo` / `demo-password` | `200 OK` | `Logged in` |

The **Payload** tab showed exactly what was sent:

```json
{"username":"demo","password":"wrong"}
```

That's normal: DevTools shows what this browser sends, and HTTPS protects it on the **network**, not from the user's own browser. But it means anything copied out of DevTools can contain passwords.

I also tried **Copy as cURL** (right-click the request): it gives a `curl` command with the exact same request, which I ran in the terminal and got the same answer. That's how to check whether a problem is in the browser or on the server.

### Slow requests

The **Slow request** button stayed **(pending)** for 3 seconds. Its **Timing** tab showed almost all the time in **Waiting for server response** (time to first byte). So for a slow page, Timing answers "is it the network or the server?": a big wait means the server, a big download means a big file or a slow connection. I also tried **network throttling** (Slow 4G) to feel what a user on a bad connection sees, and set it back afterwards.

## Break and fix

Then I broke things on purpose. For each one, I looked **only at the browser first** and said where the problem was, then confirmed on the Dell.

### A page that "looks broken"

I renamed `style.css` on the Dell. The page turned into plain text with no styling, but the buttons still worked. The Network tab showed `style.css` in red with **404**. A page that "looks wrong" is often a CSS or JS file that didn't load, for example after a half-finished deployment. Renamed it back, and it was `200` again.

## Lesson Learned: CORS errors mean the server answered

I started a second copy of the server on port 8081 and clicked **Other server**. The page said `Failed to fetch`, and the Console said:

```text
Access to fetch at 'http://vaultlab.home:8081/api/items' from origin 'http://vaultlab.home:8080'
has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.
```

The surprise was in the 8081 server's log:

```text
GET /api/items -> 200
```

**The request arrived and the server answered.** The browser received the answer and then refused to give it to the JavaScript.

An **origin** is scheme + host + port, so `:8080` and `:8081` are different origins just because of the port. By default, a page may only read answers from its own origin. This is the **same-origin policy**, and it protects users: without it, any website I visit could call my password manager's API with my login cookies and read the answers. **CORS** is how a server says "this other origin is allowed", with the `Access-Control-Allow-Origin` header.

I restarted the 8081 copy with permission for the page's origin:

```bash
ALLOW_ORIGIN=http://vaultlab.home:8080 PORT=8081 node experiments/browser/devtools-lab.js
```

and it worked: `Loaded 3 items from the other server.` Two things to remember: CORS is enforced by the **browser** (curl always worked), and it is fixed **on the server**, by allowing the exact origin that needs it.

### The server crashes

The **Crash the server** button gave `net::ERR_CONNECTION_RESET` in the Console, and the request showed **(failed)** in the Network tab. On the Dell, the log ended with a stack trace (`Error: Unhandled crash (simulated)`) and the server was gone. After that, every request failed with `net::ERR_CONNECTION_REFUSED`. The browser can't tell me **why** the server stopped, but it tells me nothing is listening any more, which sends me to the server: is the process running, and what are the last lines of its log?

### A wrong name and a firewall

- A typo in the address (`vaultlab.hom`) gave Chrome's "This site can't be reached" page with `DNS_PROBE_FINISHED_NXDOMAIN`. The server log stayed silent, because nothing ever reached the Dell.
- A `ufw` deny rule on port 8080 made the page spin for a long time, with the request **(pending)**, until Chrome gave up with `ERR_CONNECTION_TIMED_OUT`. The server was running fine and logged nothing. Same as Day 4: refused is instant, timed out is slow, and slow points to a firewall.

### Path traversal

The server has a check so it only serves files from `public/`. I tested it with curl, using `--path-as-is` so the `../` is sent exactly as typed:

```text
$ curl -i --path-as-is http://vaultlab.home:8080/../devtools-lab.js
HTTP/1.1 403 Forbidden
```

When I commented out the check and tried again, the server sent back **its own source code**. On a real server, the same bug could leak configuration files or keys. I put the check back and got `403` again.

## Lesson Learned: "Failed to fetch" means nothing on its own

Looking back, the page said exactly the same thing for CORS, a crashed server, a refused connection and a DNS failure: `Failed to fetch`. The browser hides the details from the page's JavaScript on purpose. **Only the Console and the Network tab show the real reason.** That's why a screenshot of the page isn't enough when a user reports a problem.

| What the user sees | Console | Network | Where the problem is |
| --- | --- | --- | --- |
| Click does nothing | `Uncaught TypeError` | Requests `200` | JavaScript |
| Page looks unstyled | `Failed to load resource: 404` | A `.css` / `.js` file `404` | Missing file on the server |
| Error after an action | `Failed to load resource: 4xx` | API `4xx` | The request (URL, input, login) |
| "Something went wrong" | `Failed to load resource: 500` | API `5xx` | The server (read its log) |
| Wrong data, status 200 | `Unexpected token '<'` | `200` with HTML | Something answered instead of the API |
| Works in curl, not in the browser | `blocked by CORS policy` | CORS error | The server's CORS headers |
| Everything fails suddenly | `ERR_CONNECTION_RESET`, then `REFUSED` | (failed) | The server process stopped |
| "This site can't be reached" | `ERR_NAME_NOT_RESOLVED` | (failed) | DNS |
| Spins for ages | `ERR_CONNECTION_TIMED_OUT` | (pending) | Firewall or network |
| Slow but works | | Big waiting time | Server or database |

## How I would handle a real user

First, questions, asked calmly: what were you trying to do, what happened instead, does it happen every time, only for you or for colleagues too, and does it happen in a private window? **Only one user** points to their browser or account, **everyone** points to the server, and **a private window fixes it** points to the cache, cookies or a browser extension.

Then evidence. Because the page often only says "Failed to fetch", I'd ask for the Console and Network information, often as a **HAR file**: a recording of all the requests that I can open in my own DevTools. I recorded one myself and opened it in VS Code, and the password I typed in the login form was in it. A HAR file can contain passwords, cookies and tokens, so it has to be treated like a password: recorded only for the problem, shared through a secure channel, and deleted afterwards.

## Commands and shortcuts I used today

```bash
# DevTools (Chrome on the Mac)
# Cmd + Option + I    open DevTools
# Cmd + Option + J    open the Console
# Cmd + Shift + R     hard reload
# Network: Preserve log, Disable cache, Fetch/XHR filter, throttling
# Right-click a request → Copy → Copy as cURL

# Lab server on the Dell
node experiments/browser/devtools-lab.js
PORT=8081 node experiments/browser/devtools-lab.js
ALLOW_ORIGIN=http://vaultlab.home:8080 PORT=8081 node experiments/browser/devtools-lab.js

# Firewall for the lab (removed afterwards)
sudo ufw allow from 192.168.178.0/24 to any port 8080:8081 proto tcp
sudo ufw insert 1 deny proto tcp from any to any port 8080
sudo ufw status numbered
sudo ufw delete <number>

# Path traversal test
curl -i --path-as-is http://vaultlab.home:8080/../devtools-lab.js
```

## Security things I noticed

- **DevTools shows passwords in the Payload, and HAR files keep them.** Anything exported from DevTools needs to be handled like a secret.
- **The same-origin policy protects users.** CORS should allow only the exact origins that need access, never `*` for an API with logins.
- **Path traversal** can leak files outside the public folder. A file server must check that the final path stays inside the folder it's allowed to serve.
- **Error pages shouldn't reveal internals.** The 500 told the browser nothing; the details stayed in the server log.
- **Temporary firewall rules and test servers get cleaned up** at the end of the day.

## Reflection

**What did I learn?**
What each DevTools panel is for, how to read a JavaScript error in the browser and jump to the line, how to read a request in the Network tab, what CORS is and why it exists, and why HAR files are sensitive.

**What did I understand better after practising?**
That the page, the Console and the Network tab tell different parts of the story. The page often only says "Failed to fetch", and the real reason is in DevTools. And that a CORS error means the server did answer.

**What troubleshooting skills did I develop?**
Deciding from the browser alone whether a problem is in the JavaScript, the network or the server, and knowing what to check next for each.

**What should I review next?**
The "what the user sees → where the problem is" table, and CORS.

**What can I demonstrate now that I couldn't before?**
I can answer "the page is broken, how do you investigate it from the browser?" step by step: Console, Network, status code, response, timing, and then the server logs, because I've done each step myself.