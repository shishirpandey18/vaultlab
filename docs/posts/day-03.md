# Day 3: Async JavaScript and debugging

**Goal for today:** understand why JavaScript doesn't wait for slow things, explain the event loop with my own code, read a stack trace properly, and pause a running program to look inside it.

**My setup:** Mac with VS Code, Node.js and Chrome. The Dell was not needed today.

---

This day continues where Day 2 stopped. On Day 2 I built the password generator. Today was about the part of JavaScript that confused me most before: async code. Every server request, database query and `fetch` in VaultLab will be asynchronous, so I wanted to really understand it, and then learn how to look inside a program when something goes wrong.

## Async JavaScript

JavaScript runs my code on **one thread**: one thing at a time. If it stopped and waited for every slow task (a network request, a database, a timer), the whole program would freeze. So it **starts** the slow task, carries on with the rest of my code, and comes back to the result later. The **event loop** decides when "later" is.

The way I remember it: a restaurant with one waiter. The waiter takes my order to the kitchen and serves other tables while the food is cooking, instead of standing at the kitchen door. When the food is ready, it goes on a counter, and the waiter picks it up the next time they are free.

## Lesson Learned: Why a 0 ms timeout runs last

Before running this, I had to predict the order the four lines would print:

```js
console.log("A: Start");
setTimeout(() => console.log("B: timeout 0 ms"), 0);
Promise.resolve().then(() => console.log("C: promise"));
console.log("D: end");
```

```text
er.shishirpandey@Mac vaultlab % node experiments/async/event-loop.js
A: Start
D: end
C: promise
B: timeout 0 ms
```

The order is **A, D, C, B**, and there are three rules behind it:

1. **A** and **D** are normal code, so they run immediately, top to bottom.
2. **C** is a promise callback. It waits in the **microtask queue**, which runs as soon as the current code is finished.
3. **B** is a timer. It waits in the **task queue**, which runs only after all the microtasks.

So a timeout of `0` ms does not mean "now". It means "as soon as possible, after everything else".

```text
normal code  →  microtasks (promises)  →  tasks (timers)
   A, D              C                        B
```

### Callbacks, Promises and async/await

There are three ways to say "do this when the slow thing finishes", from oldest to newest:

| Style | Looks like | What it solved |
| --- | --- | --- |
| Callback | `fs.readFile(path, (err, data) => { ... })` | The first way, but it nests deeply ("callback hell") |
| Promise | `fetchItem(1).then(item => ...).catch(err => ...)` | A value that will arrive later, and can be chained |
| async/await | `const item = await fetchItem(1);` | Reads like normal top-to-bottom code |

`async/await` is built on Promises. An `async` function **always returns a Promise**, and `await` pauses only that function (not the whole program) until the Promise is finished.

## Lesson Learned: One by one vs Promise.all

I made a fake server: `fetchItem` pretends to be a request to the VaultLab API that takes half a second.

```js
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchItem(id) {
  await wait(500);
  if (id < 0) throw new Error(`Item ${id} not found`);
  return { id, title: `Item${id}` };
}
```

Then I fetched three items in two different ways:

```js
console.time("one by one");
const a = await fetchItem(1);
const b = await fetchItem(2);
const c = await fetchItem(3);
console.timeEnd("one by one");

console.time("all at once");
const items = await Promise.all([fetchItem(1), fetchItem(2), fetchItem(3)]);
console.timeEnd("all at once");
```

```text
er.shishirpandey@Mac vaultlab % node experiments/async/fake-server.js
one by one: 1.502s
Item1 Item2 Item3
all at once: 501.022ms
[ 'Item1', 'Item2', 'Item3' ]
Caught: Item -1 not found
```

The exact times change a little every run, but the difference is always the same: about 1.5 seconds against about half a second.

- **One by one** waits for each request before starting the next one: 3 × 500 ms = 1.5 seconds.
- **`Promise.all`** starts all three together and waits until all are finished: about 500 ms. I can use it when the requests don't depend on each other. If one of them fails, the whole `Promise.all` fails.
- **`try/catch` works with `await`**: an error thrown inside an async function becomes a rejected Promise, and `await` turns it back into a normal error that I can catch. That's why the last line printed `Caught: Item -1 not found` instead of crashing.

### Reading a file the async way

I also read a JSON file with `fs/promises`:

```js
const fs = require("node:fs/promises");
const path = require("node:path");

async function loadVault() {
  const file = path.join(__dirname, "vault-items.json");
  const text = await fs.readFile(file, "utf8");
  return JSON.parse(text);
}

loadVault()
  .then((items) => console.log(`Loaded ${items.length} items:`, items.map((i) => i.title)))
  .catch((err) => {
    console.error("Could not load the vault:", err.message);
    process.exitCode = 1;
  });
```

`path.join(__dirname, ...)` builds the path from the folder **this file** lives in, so it works no matter which folder I run it from.

Then I renamed the JSON file on purpose and ran it again:

```text
Could not load the vault: ENOENT: no such file or directory, open '/Users/er.shishirpandey/projects/vaultlab/experiments/async/vault-items.json'
```

`ENOENT` means "Error NO ENTry": no such file or directory. The error even shows the full path it tried to open, which is the first thing to check when a file "can't be found".

## Debugging

### How to read a stack trace

Every Node error has the same parts:

```text
/Users/.../type-error.js:7              ← 1. file and line where it broke
  return item.login.username;           ← 2. the line itself, ^ under the spot
                    ^

TypeError: Cannot read properties of undefined (reading 'username')   ← 3. type: message
    at showUsername (/Users/.../type-error.js:7:21)                   ← 4. stack, newest call first
    at Object.<anonymous> (/Users/.../type-error.js:11:33)
    at Module._compile (node:internal/...)
```

The order I read it in:

1. **Error type**: what kind of problem it is.
2. **Message**: what exactly was wrong. `reading 'username'` means I tried to read `.username` from something that was `undefined`. So the culprit is the thing **before** `.username`, not `username` itself.
3. **First stack line in my own file**: function, file, line and column.
4. **Next line down**: who called it. This usually shows which data caused the problem.
5. **Ignore the `node:internal` lines**: that's Node's own code. The bug is almost never there.

| Error type | What it means | Typical cause |
| --- | --- | --- |
| `TypeError` | A value is the wrong kind for what I did with it | Reading a property of `undefined` or `null` |
| `ReferenceError` | A name doesn't exist at all | A typo in a variable name |
| `SyntaxError` | The code (or JSON) can't even be read | A missing bracket, or a trailing comma in JSON |
| `RangeError` | A value is outside the allowed range | My own `validate()` uses it for bad lengths |

## Lesson Learned: A breakpoint shows everything, console.log only shows what I asked for

With `console.log` I only see what I already expected to print. A **breakpoint** pauses the program so I can see every variable, at any line.

What I did in VS Code:

1. Opened `experiments/passgen/passgen.js` and clicked left of the line number of `const pool = sets.join("");` inside `generatePassword`. A red dot appeared.
2. Opened `Cmd + Shift + P` → **Debug: JavaScript Debug Terminal**. Any `node` command started in that terminal is debugged automatically.
3. Ran `node passgen.js --length 10`.
4. The program paused on my line, and I could see:
    - **Variables**: `length` was `10`, `sets` had 4 strings, and `chars` already had 4 characters, one from each set.
    - **Call Stack**: `generatePassword` was called by `main`. This is the same stack I read in a crash, but live.
    - **Debug Console**: I could type `pool.length` or `chars.join("")` and see the value straight away.
5. I pressed **Step Over** a few times inside the `while` loop and watched `chars` grow one character at a time.

| Button | Key | What it does |
| --- | --- | --- |
| Continue | `F5` | Run until the next breakpoint |
| Step Over | `F10` | Run this line, stop at the next one |
| Step Into | `F11` | Go inside the function called on this line |
| Step Out | `Shift + F11` | Finish this function, stop in the caller |
| Stop | `Shift + F5` | End the program |

On my Mac, the F-keys control brightness and volume, so I have to hold `fn` with them, or just click the buttons in the toolbar.

### The same thing in Chrome DevTools

```bash
node --inspect-brk passgen.js --length 10
Debugger listening on ws://127.0.0.1:9229/...
```

`--inspect-brk` starts the program **paused** on the first line and opens a debug connection on **port 9229**. Then I went to `chrome://inspect` in Chrome and clicked **inspect** under *Remote Target*. A DevTools window opened on the **Sources** tab, where I could set breakpoints and look at variables, exactly like in VS Code.

This is the same DevTools I will use to debug websites, so getting used to it now helps.

## Commands I used today

```bash
# Run my async experiments
node experiments/async/event-loop.js
node experiments/async/fake-server.js
node experiments/async/read-file.js

# Debug in Chrome DevTools (port 9229)
node --inspect-brk passgen.js --length 10
# then open chrome://inspect

# VS Code
# Cmd + Shift + P → Debug: JavaScript Debug Terminal
# F5 continue, F10 step over, F11 step into, Shift + F5 stop
```

## Security things I noticed

- `node --inspect` opens a debug port (9229). Anyone who can connect to that port can run code inside my program, so it should only ever listen on `127.0.0.1` (which it does by default) and never be left running on a server.
- Error messages can show full file paths, like the `ENOENT` error did. That's useful for me while debugging, but a real app should not show these details to its users.

## Reflection

**What did I learn?**
How the event loop decides the order of code, the difference between callbacks, Promises and async/await, when to use `Promise.all`, how to read a stack trace, and how to pause a program with breakpoints.

**What did I understand better after practising?**
Why a timeout of 0 ms still runs last, and that `await` pauses only its own function, not the whole program.

**What troubleshooting skill did I develop?**
Reading a stack trace in the right order, and using a breakpoint to see the real values instead of guessing.

**What should I review next?**
The three event-loop rules, and the error type table.

**What can I demonstrate now that I couldn't before?**
I can explain why code prints in the order A, D, C, B, and I can pause a Node program in VS Code or Chrome DevTools and inspect its variables.