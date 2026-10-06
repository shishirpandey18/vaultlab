# Day 2: JavaScript core, Node.js and a secure password generator

**Goal for today:** understand the JavaScript basics properly, set up Node.js on my Mac, and build a password generator that uses secure randomness and has automated tests.

**My setup:** Mac with VS Code and Node.js. The Dell was not needed today.

---

This "day" actually took me two days (2 and 3 October). I didn't want to just type the code and move on. I wanted to understand every line: why it is written that way and what happens if I change it. So I took the extra time, and I think it was worth it. Day 3 will continue with async JavaScript, debugging and breaking things on purpose.

## Node.js

JavaScript was made to run inside browsers. Node.js takes the same JavaScript engine Chrome uses (V8) and lets it run on its own, outside the browser, with extra powers browsers don't give: reading files, opening network ports, running servers. My VaultLab backend will run on Node.

### The REPL

REPL = **Read → Evaluate → Print → Loop**. It is an interactive JS playground in the terminal, which makes it easy to test one line quickly.

When I run `node` in the terminal, I enter the REPL and get a `>`:

- **Read:** I type `2 + 3`, and Node reads what I entered.
- **Evaluate:** Node executes it and calculates the result.
- **Print:** Node prints the result, `5`.
- **Loop:** when the print is done, Node doesn't stop. It gives me another `>`.

```text
type JS → read → evaluate → print → loop → wait for more JS
```

It is useful for quickly testing JS without creating a `.js` file. To come out of it: `.exit`.

In short: a place where I can type JS one piece at a time and immediately see what it does.

## JavaScript basics

### let, const and typeof

`let` and `const` both declare variables. `let` is for a variable whose value can be reassigned, and `const` is for one whose value cannot.

```js
let age = 25;
age = 27;            // allowed

const name = "shishir";
name = "pandey";     // error
```

`typeof` tells me the type of a value: `string`, `number`, `boolean`, `undefined`, `object`.

### == vs ===

`==` lets JavaScript convert the types before comparing. `===` doesn't: it checks both the value and the type.

```js
5 == "5"            // true
5 === "5"           // false
null == undefined   // true
null === undefined  // false
```

So I will always use `===`.

### Truthy and falsy

JavaScript has a small set of **falsy** values:

```text
false   0   -0   0n   ""   null   undefined   NaN
```

Almost everything else is **truthy**, including `"0"`, `"false"`, `"hello"`, `[]`, `{}` and `function() {}`.

```js
Boolean(0)      // false
Boolean("")     // false
Boolean(null)   // false
Boolean([])     // true
Boolean({})     // true
Boolean("0")    // true
```

So when JavaScript sees a value inside an `if`:

```js
if (value) {
  // ...
}
```

it doesn't need `value` to literally be `true`. It converts the value to a Boolean and then decides whether to enter the block.

## Lesson Learned: Why an empty array is truthy

The one that surprised me was `[]`. I thought: "It's empty, so shouldn't it be falsy?" **No.**

In JavaScript, arrays are objects, and objects are truthy, even empty ones. So `Boolean([])` is `true`, and:

```js
[]      // truthy
[1, 2]  // truthy
```

Even an empty array is truthy. This matters because `if (items)` will be true even when there are no items. To check for an empty list I need `if (items.length > 0)`.

### Functions

A function is a reusable piece of code that does a particular job.

```js
function isStrong(password) {
  return password.length >= 12;
}
const isWeak = (password) => !isStrong(password);   // arrow function, shorter
```

### Closures

A closure is a function that remembers variables from its outer function even after the outer function has finished.

```js
function makeCounter() {
  let count = 0;
  return () => ++count;
}

const counter = makeCounter();
counter(); // 1
counter(); // 2
counter(); // 3
```

How it works:

- `count` is created inside `makeCounter()`.
- The arrow function uses `count`.
- The arrow function remembers `count` → this is a closure.
- `count` is private and cannot be accessed directly from outside.

Since the arrow function uses `count` every time it runs, `count` stays alive through the closure.

### map, filter and reduce

- `map` changes every item and returns a new array of the same length.
- `filter` keeps the items that pass a condition and returns a new array that might be the same length or shorter.
- `reduce` combines all items into one value and returns that one value.

I tried them on a small vault:

```js
const vault = [
  { title: "GitHub", username: "shishir", password: "shishir-pandey-Nepal", tags: ["work"] },
  { title: "Bank", username: "s.pandey", password: "1234", tags: ["money"] },
  { title: "Email", username: "shishir", password: "sjT9Us%Qk#o", tags: [] },
];
const titles = vault.map((item) => item.title);
const weak = vault.filter((item) => isWeak(item.password)).map((item) => item.title);
const totalLength = vault.reduce((sum, item) => sum + item.password.length, 0);
console.log(titles, weak, totalLength);
```

```text
[ 'GitHub', 'Bank', 'Email' ] [ 'Bank', 'Email' ] 35
```

"Email" is in the weak list because `isStrong` only checks the length (12 or more), and `sjT9Us%Qk#o` has 11 characters, even though it looks strong.

### Destructuring and spread

**Destructuring** takes properties out of an object and puts them into variables:

```js
const { title, username } = vault[0];
```

**Spread** copies an object's properties into a new object, then lets me override or change specific properties:

```js
const updated = { ...vault[0], password: "new-password" };
```

### Optional chaining and ??

```js
const item = { title: "Bank" };
console.log(item.login?.username);                     // no crash, just undefined
console.log(item.login?.username ?? "(no username)");
```

`?.` stops and returns `undefined` if the left side is missing, instead of crashing. `??` gives a default when a value is `null` or `undefined`.

```text
?.  → "Is it there? If not, don't crash."
??  → "If it's missing, use this instead."
```

### Template strings

A template string uses backticks, and `${...}` lets me insert JavaScript values or expressions directly into the text.

```js
const name = "Shishir";
console.log(`Hello ${name}!`);   // Hello Shishir!
```

```text
"..."   → normal string
'...'   → normal string
`...`   → template string
${...}  → insert/evaluate JavaScript here
```

## Building the secure password generator

Goal: a command-line tool, `node passgen.js --length 20`, that makes strong passwords using secure randomness, handles bad input politely, and has automated tests.

## Lesson Learned: Math.random() is not for passwords

`Math.random()` gives a random-looking number between 0 and 1, but it is not designed for security. It is a **pseudo-random** generator: it looks random, but it is calculated by an algorithm, made for things like games and animations.

For passwords, tokens and authentication keys, I need a **cryptographically secure** random number generator. Node provides that through its built-in `crypto` module:

```js
const crypto = require("node:crypto");

crypto.randomInt(n)   // a secure random whole number from 0 to n-1, never n
```

The scary part is that I can't tell the two apart just by looking at the output. That's why the choice has to be made correctly in the code.

### How I built it, step by step

1. **Imported** Node's `crypto` module.
2. **Made the character sets** as one object: lowercase, uppercase, digits and symbols.
3. **Created `HELP`**, the instructions shown when the user runs `node passgen.js --help`.
4. **Wrote `parseArgs(argv)`**, which takes the raw command-line words and understands their structure. For example:

    ```text
    ["--length", "20", "--no-symbols"]   →   { length: 20, symbols: false }
    ```

    It starts with the default options, so if the user simply runs `node passgen.js`, they get length 16, count 1, and all character types:

    ```js
    const options = { length: 16, count: 1, lower: true, upper: true, digits: true, symbols: true, help: false };
    ```

    Then a `for` loop goes through the command-line arguments. It also handles flags like `--no-symbols` and `--help`, and throws an error for unknown options.

5. **Wrote `validate()`**, which checks the length (8 to 128) and the count (1 to 20).
6. **Wrote `generatePassword()`** using `crypto.randomInt`. First it takes one character from each chosen set, then fills the rest from all the chosen characters together. Here I used `push` (`chars.push("x")` adds `"x"` to the end of the array) and `join` (converts the array into a string).
7. **Shuffled the password.** At that point I had all the characters, but there was a problem: I had deliberately put one character from each category at the beginning, so every password started with lowercase → uppercase → digit → symbol, like `aG7$...`. That is a predictable pattern, so I shuffle with an algorithm called the **Fisher-Yates shuffle**:

    ```js
    for (let i = chars.length - 1; i > 0; i--) {
      const j = crypto.randomInt(i + 1);
      [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    ```

8. **Measured the entropy.** Entropy measures how hard a password is to guess. Length matters more than symbols: 24 characters without symbols beat 16 with them.
9. **Wrote `main()`**, which reads the command-line arguments with `process.argv.slice(2)`. If I run `node passgen.js --length 20 --count 3`, Node gives me this array:

    ```text
    [ node path, passgen.js path, "--length", "20", "--count", "3" ]
    ```

    I don't care about the first two items, so `slice(2)` means: start at index 2 and take everything after it. Then `main()` prints the help if `--help` is there, validates the options (throwing an error if something is wrong), filters out the character types the user doesn't want, generates the passwords, and handles errors.

### How it fits together

```text
                    passgen.js
                         │
                         ▼
                   process.argv
                         │
                         ▼
                    parseArgs()
                         │
                         ▼
                      options
                         │
                         ▼
                     validate()
                         │
                         ▼
               choose character sets
                         │
                         ▼
                 generatePassword()
                         │
              ┌──────────┴──────────┐
              │                     │
          randomInt()            shuffle
              │                     │
              └──────────┬──────────┘
                         ▼
                     password
                         │
                         ▼
                   console.log()
```

And if something fails:

```text
Error → catch → friendly message → process.exitCode = 1
```

The model I want to remember, without memorising code:

| Part | Job |
| --- | --- |
| `parseArgs()` | turn command-line words into an options object |
| `validate()` | check whether those options are allowed |
| `generatePassword()` | create the actual password |
| `try/catch` | handle errors politely |
| `module.exports` | make the functions available to test files |

### The result

```text
er.shishirpandey@Mac vaultlab % node experiments/passgen/passgen.js
Z2a^+Srv{X4K[u}C
(85 possible characters, about 103 bits of entropy)

er.shishirpandey@Mac vaultlab % node experiments/passgen/passgen.js --length 20 --count 3 --no-symbols
WmaPj5U53uAZUUCOt9q4
SaLdZtjtxJd5B21AtCqj
4RH3q6i8SersspS26OcY
(62 possible characters, about 119 bits of entropy)
```

And the error cases:

```text
er.shishirpandey@Mac vaultlab % node experiments/passgen/passgen.js --length 4 --count 3 --no-symbols
Error: --length must be whole number form 8 to 128
Run with --help to see the options.

er.shishirpandey@Mac vaultlab % node experiments/passgen/passgen.js --length abc
Error: --length must be whole number form 8 to 128
Run with --help to see the options.

er.shishirpandey@Mac vaultlab % node experiments/passgen/passgen.js --colour
Error: Unknown option: --colour
Run with --help to see the options.

er.shishirpandey@Mac vaultlab % echo "exit code: $?"
exit code: 1
```

`--length abc` gives the length error because `Number("abc")` is `NaN` (Not a Number), and `NaN` is not a whole number. The exit code `1` tells the shell that the run failed. Scripts and servers use that number, not the printed text, to know if something worked.

## Adding automated tests

Next I wanted a test that automatically checks: does this password generator behave the way I expect it to?

First I imported Node's built-in testing tools:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
```

Then I wrote five tests:

1. The password has the requested length.
2. The password contains at least one character from every chosen set.
3. `--no-symbols` leaves the symbols out (I pretended the user typed `node passgen.js --no-symbols`).
4. A too-short length is rejected.
5. An unknown option is rejected.

## Lesson Learned: Spread also works on strings

In the second test I saw `[...pw]`. Before, I understood spread as copying an object's properties into a new object. But spread also spreads a **string into an array** of its characters:

```js
[..."aG7$"]   // [ 'a', 'G', '7', '$' ]
```

That's how the test can check each character of the password with `.some(...)`.

All five tests passed:

```text
er.shishirpandey@Mac passgen % npm test
✔ password has the required length (0.757542ms)
✔ password contains at least one character from every chosen set (0.798875ms)
✔ --no-symbols leaves symbols out (0.127166ms)
✔ too short a length is rejected (0.17525ms)
✔ an unknown option is rejected (0.064709ms)
ℹ tests 5
ℹ pass 5
ℹ fail 0
```

## Lesson Learned: Proving my tests can actually fail

A test that always passes could be a test that checks nothing. So I broke my own code on purpose. I changed:

```js
while (chars.length < length)
```

to:

```js
while (chars.length < length - 1)
```

and ran the tests again:

```text
er.shishirpandey@Mac passgen % npm test
✖ password has the required length (2.461583ms)
✔ password contains at least one character from every chosen set (1.046875ms)
✔ --no-symbols leaves symbols out (0.122584ms)
✔ too short a length is rejected (0.170167ms)
✔ an unknown option is rejected (0.061583ms)
ℹ tests 5
ℹ pass 4
ℹ fail 1

✖ failing tests:

test at passgen.test.js:7:1
✖ password has the required length (2.461583ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:

  19 !== 20
```

The test caught it: the password was **1 character shorter** than the required length (19 instead of 20). The error even told me the file and line of the test (`passgen.test.js:7`), the expected value and the actual value. Then I changed the code back and all five tests passed again.

Only one test failed, which also makes sense: the other tests don't check the exact length, so they couldn't notice.

## Commands I used today

```bash
# Node.js
node -v                 # Node version
npm -v                  # npm version
node                    # open the REPL (.exit to leave)
node file.js            # run a file

# npm project
npm init -y             # create package.json
npm start -- --length 12
npm test                # run all *.test.js files

# Exit code of the last command
echo $?

# My password generator
node passgen.js
node passgen.js --length 20 --count 3 --no-symbols
node passgen.js --help
```

## Security things I noticed

- `Math.random()` must never be used for passwords, tokens or keys. I need `crypto.randomInt()` in Node (and `crypto.getRandomValues()` in the browser).
- Length adds more strength than symbols.
- A predictable pattern (every password starting lowercase → uppercase → digit → symbol) makes a password weaker, which is why the shuffle matters.

## Reflection

**What did I learn?**
How Node.js runs JavaScript outside the browser, the core JavaScript rules (types, `===`, truthy and falsy, closures, map/filter/reduce, destructuring, spread, `?.` and `??`), and how to build and test a small command-line tool.

**What did I struggle with?**
Understanding every line of the password generator, not just running it. That's why this day took me two days.

**What did I understand better after practising?**
Closures, and why the shuffle is needed. Also how a program gets its options from `process.argv`.

**What surprised me?**
That an empty array `[]` is truthy, and that spread also works on strings.

**What troubleshooting skill did I develop?**
Reading a failing test: which test failed, the expected value and the actual value (`19 !== 20`), then finding the line in my code that explains the difference.

**What should I review next?**
The truthy and falsy list, and the order `parseArgs()` → `validate()` → `generatePassword()`.

**What can I demonstrate now that I couldn't before?**
I can build a small Node.js command-line tool that uses secure randomness, handles bad input with a clear message and exit code, and has tests that I have seen both pass and fail.
