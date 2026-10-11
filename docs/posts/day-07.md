# Day 7: React fundamentals, VaultLab's first front end

**Goal for today:** build a small React app from components, understand props, state and effects, and find and fix React's typical bugs, especially the white screen.

**My setup:** the Mac with VS Code, running the React app with Vite on `localhost:5173`. The API is yesterday's DevTools lab server, running on the Dell.

---

Until now, every page in VaultLab was hand-written HTML and JavaScript. On Day 6 my `app.js` changed the page by hand: find the status box, set its text, empty the list, add the items one by one. It worked, but the page and the data drifted apart easily, and the `undefined` on the screen was one example of that. Today I started VaultLab's real front end with **React**: the vault screen where items are listed, added, revealed and deleted.

## The idea behind React

React turns it around:

1. I split the screen into **components**: functions that return what a piece of the screen should look like.
2. Each component describes the screen **for the current data**, instead of giving step-by-step instructions to change it.
3. When the data changes, React calls the component again and updates only the parts of the page that are different.

The way I remember it: **the screen is a function of the data.**

## Creating the app with Vite

The React app lives in a new `client/` folder in the repo. Later, the API will get its own `server/` folder next to it.

```bash
cd ~/projects/vaultlab
npm create vite@latest client -- --template react
cd client
npm install
npm run dev
```

I ran the first command from the repo root, but nothing was installed there: `client` tells it to create a new folder, and `npm install` puts Vite and React in `client/node_modules`. The installer also asked which linter to use, and I kept the default, Oxlint.

**Vite** is a development server and build tool. While I work, it serves my files, turns JSX into normal JavaScript, and updates the browser as soon as I save (**hot module replacement**). For production, `npm run build` packs everything into a few plain files in `dist/`.

| File | What it is |
| --- | --- |
| `package.json` | The project's scripts and dependencies |
| `node_modules/` | The installed packages, never committed |
| `index.html` | The only HTML page, with an empty `<div id="root"></div>` |
| `src/main.jsx` | Tells React to draw `<App />` inside `#root` |
| `src/App.jsx` | The top component |
| `vite.config.js` | Vite's settings, including the API proxy |

The whole app lives in that one empty `div`. That turned out to be important later today.

### JSX rules

The HTML-looking code in React is **JSX**. It isn't HTML: Vite turns it into JavaScript. The rules that tripped me up:

- Anything in `{ }` is JavaScript: `{name}`, `{items.length}`.
- It's `className`, not `class`.
- A component returns one parent element.
- Every tag must be closed: `<input />`.
- Component names start with a capital letter.

## Components and props

Before writing code, I drew the screen and boxed each part:

```text
App                      ← owns the data, puts the screen together
├── AddItemForm
└── ItemList             ← the list, or "Your vault is empty"
    ├── ItemCard         ← one vault item
    ├── ItemCard
    └── ItemCard
```

Data flows **down** this tree. What a parent hands to a child is called **props**.

```jsx
export default function ItemList({ items, onDelete }) {
  if (items.length === 0) {
    return <p className="muted">Your vault is empty.</p>
  }

  return (
    <ul className="list">
      {items.map((item) => (
        <ItemCard key={item.id} item={item} onDelete={onDelete} />
      ))}
    </ul>
  )
}
```

- `items.map(...)` turns the array of items into an array of cards. That's how every list in React is drawn.
- `key={item.id}` gives each card a unique, stable name, so React knows which card is which when the list changes. I found out the hard way why it matters (below).
- **Props are read-only.** A child never changes what its parent gave it. It asks the parent instead.

In `ItemCard` I used the Day 6 fix from the start: `{item.username ?? 'no username'}`, so the Bank item without a username shows "no username" instead of `undefined`.

## State and events

Props are data a component is **given**. **State** is data a component **owns and can change**. When state changes, React draws the component again.

```jsx
const [revealed, setRevealed] = useState(false)
```

`revealed` is the current value, and `setRevealed` is the only way to change it. Calling `setRevealed(true)` doesn't change the variable on the spot. It tells React "this changed, please draw again". Each card has its **own** `revealed`, so showing one password doesn't show the others.

### Lifting state up

A card can't delete itself, because the list belongs to `App`. So `App` keeps the items in state and passes a **function** down: "call this when you want an item deleted". Data goes down as props, and requests to change it come back up through functions.

```jsx
function addItem(newItem) {
  // Never change state in place: make a NEW array with the new item at the end
  setItems((current) => [...current, { ...newItem, id: crypto.randomUUID() }])
}

function deleteItem(id) {
  setItems((current) => current.filter((item) => item.id !== id))
}
```

The rule that matters most: **never change state in place, replace it with a new value.** `[...current, newItem]` and `filter` both create a **new** array.

### The form and the password generator

The form is **controlled**: each input shows its value from state, and every keystroke goes back into state. That's why the **Generate** button can fill the password box just by calling `setPassword(...)`.

Three details I wouldn't have known without trying:

- `event.preventDefault()` stops the browser from reloading the page when the form is submitted.
- Inside a form, a button without a type is a **submit** button. Generate needs `type="button"`, or clicking it would also try to add the item.
- The generator uses `crypto.getRandomValues`, the browser's secure random source, never `Math.random`. It throws away the few random numbers at the very top of the range so that every character is equally likely, the same "no bias" rule as my Day 2 generator.

When I reloaded the page, the items I had added were gone. State lives in the browser's memory. Saving it on the server is what the coming days are for.

## Effects and fetching

Then I replaced the sample data with items from the API on the Dell:

```jsx
useEffect(() => {
  async function loadItems() {
    try {
      const res = await fetch('/api/items')
      const type = res.headers.get('content-type') || ''
      if (!res.ok || !type.includes('application/json')) {
        throw new Error(`${res.status} ${res.statusText}, ${type || 'no content type'}`)
      }
      setItems(await res.json())
    } catch (err) {
      console.error('Could not load items:', err)
      setError(`Could not load your vault (${err.message}).`)
    } finally {
      setLoading(false)
    }
  }
  loadItems()
}, [])
```

- Loading data is a **side effect**: it reaches outside the component and takes time. `useEffect` runs it **after** the screen is drawn.
- The `[]` at the end is the **dependency list**. An empty list means "only once, when the component first appears".
- The app handles three states: loading, error and success.
- The `content-type` check is the Day 6 lesson: a `200` isn't enough, it also has to be JSON.

## Lesson Learned: A proxy avoids the CORS problem

My page comes from `http://localhost:5173`, and the API is at `http://vaultlab.home:8080`. Different host and port means **different origins**, and yesterday I saw what the browser does with that: blocked by CORS policy.

Instead of allowing the origin on the API, I let **Vite** pass the API requests on:

```js
server: {
  proxy: {
    '/api': API_URL,
  },
},
```

```text
Browser  ── GET /api/items ──▶  Vite (localhost:5173)  ── GET /api/items ──▶  Dell (vaultlab.home:8080)
         same origin: no CORS               server to server: CORS doesn't apply
```

The browser only ever talks to Vite, and Vite is a server, not a browser, so CORS doesn't apply to it. This middleman is called a **reverse proxy**, and later Nginx will do the same job in production. Two things I noticed in the Dell's log:

- The client IP was the **Mac's**, because Vite made the request, not the browser. Behind a proxy, the server sees the proxy's address.
- One page load gave **two** `GET /api/items` lines. That's **StrictMode**: in development, React runs every effect twice on purpose, to catch effects that can't safely run twice. It's not a bug, and in the production build it runs once.

## React DevTools

I installed the **React Developer Tools** extension. Its **Components** tab shows the component tree, and for each component its props and state. I clicked **Show** on a card and watched its state change to `true`, then did it the other way round and changed the state in DevTools, and the page followed. With **Highlight updates when components render** turned on, typing in the form only made the form flash, not the list: React only redraws what changed.

## Break and fix

Then I broke the app in eight ways. For each break, I looked at the page like a user first, then at the Console, the Network tab and React DevTools.

## Lesson Learned: A white screen is almost always a JavaScript error

I changed the username line in `ItemCard` to `{item.username.toUpperCase()}`. The whole page went **white**, not even the "VaultLab" title was left. The Console said:

```text
Uncaught TypeError: Cannot read properties of undefined (reading 'toUpperCase')
    at ItemCard (ItemCard.jsx:11:...)
An error occurred in the <ItemCard> component. Consider adding an error boundary to your tree
to customize error handling behavior.
```

In Elements, `<div id="root"></div>` was **empty**, and in Network, `items` was a `200`. The data arrived fine, but the Bank item has no username, so **one** card crashed while being drawn, and React removed the **whole app** from the page. One bad item made the entire vault disappear.

So for a white screen, the Console comes first. The network and the server were fine; the evidence was one red line. An **error boundary**, a component that catches its children's errors and shows something else instead, can stop one card from taking down the whole page. I'll add one later.

## Lesson Learned: A wrong key revealed the wrong password

When I removed `key={item.id}`, the page looked normal and the Console only warned:

```text
Each child in a list should have a unique "key" prop.
Check the render method of `ItemList`.
```

A common "fix" is to use the position in the list: `key={index}`. The warning disappears. Then I:

1. Added two items with passwords, **Alpha** and **Beta**.
2. Clicked **Show** on Alpha only.
3. Deleted **Bank (demo)**, which was above them.

Alpha was suddenly hidden, and **Beta's password was shown**, although I never clicked Show on Beta.

The `revealed` state belongs to the component **with that key**. After deleting Bank, every item moved up one place: Alpha moved into Bank's old component (hidden), and Beta moved into the component I had revealed. The state stayed with the key, and the items moved under it. In a password manager, that means showing a secret the user didn't ask to see. **Keys must identify the item itself, never its position.** With `key={item.id}` back, the same steps worked correctly.

## Lesson Learned: Changing state in place doesn't show

I changed `addItem` to:

```jsx
items.push({ ...newItem, id: crypto.randomUUID() })
setItems(items)
```

When I added **Netflix**, nothing happened: no new card, still "3 items", and no error. Then I deleted GitHub, and Netflix suddenly **appeared** at the bottom.

`push` changed the old array, and `setItems(items)` gave React the **same** array, so React decided nothing had changed and didn't redraw. The item was in the array the whole time. The delete used `filter`, which makes a new array, so React redrew and the hidden item came out. A user would report this as "I have to click twice".

## Lesson Learned: Calling a function instead of passing it

I changed the Show button to `onClick={setRevealed(!revealed)}`, without `() =>`. After adding an item with a password, the page went white again:

```text
Uncaught Error: Too many re-renders. React limits the number of renders to prevent an infinite loop.
```

Without `() =>`, `setRevealed` isn't given to React to call later when the button is clicked. It's called **right away, while drawing**. That changes state, which draws again, which calls it again, forever, until React stops it.

## Lesson Learned: A missing [] can flood the server

I removed the `[]` from the effect. The page looked completely normal, but the Network tab filled up with `items` requests non-stop, and the Dell's log scrolled without stopping. In my test it was over 600 requests in about 3 seconds.

Without a dependency list, the effect runs after **every** render: it loads the items, `setItems` causes a render, the render runs the effect again, and so on. The page looks fine while it attacks my own API. If a server suddenly gets the same request thousands of times from normal users, a front-end loop like this is a likely cause, and one user's Network tab shows it immediately.

### No proxy, and the API down

- Without the proxy line, the page said `Could not load your vault (200 OK, text/html).` The Network tab showed a `200` whose Response was **my own `index.html`**: Vite didn't know `/api/items` was special, so it answered with the app's main page. The request never left the Mac. That's exactly the Day 6 "Not JSON" lesson, in a real setup.
- With the Dell server stopped, the page said `Could not load your vault (502 Bad Gateway, text/plain).` The Vite terminal on the Mac explained why:

```text
[vite] http proxy error: /api/items
Error: connect ECONNREFUSED 192.168.178.52:8080
```

**502 Bad Gateway** means "I'm a proxy, and the server behind me didn't answer properly". The browser reached Vite fine, but Vite couldn't reach the Dell. When I use Nginx later, a 502 will mean the same thing: check the app behind the proxy.

### A wrong import

A typo in an import (`ItemsList.jsx` instead of `ItemList.jsx`) showed Vite's red error overlay:

```text
[plugin:vite:import-analysis] Failed to resolve import "./components/ItemsList.jsx" from "src/App.jsx". Does the file exist?
```

This one is caught before the app even runs, and the overlay only exists in development. A Mac-specific warning: the Mac's disk ignores upper and lower case by default, so a wrong case in an import can work on my Mac and then fail on a Linux server.

### The table I'm keeping

| What the user sees | Evidence | Cause |
| --- | --- | --- |
| White screen | Console: `Uncaught TypeError`, `#root` empty | A component crashed while drawing |
| White screen | `Too many re-renders` | State set while drawing |
| Wrong item revealed | `key` warning, or `key={index}` | Keys not tied to the item |
| "Nothing happens", then appears later | No error | State changed in place |
| Looks fine, server flooded | Endless identical requests | Effect without a dependency list |
| "Could not load" + `200 text/html` | Response is `index.html` | Missing proxy or wrong URL |
| "Could not load" + `502` | Proxy log: `ECONNREFUSED` | API down behind the proxy |
| Red overlay in development | `Failed to resolve import` | Wrong file name or path |

## Commands I used today

```bash
# Create and run the React app
npm create vite@latest client -- --template react
cd client
npm install
npm run dev          # development server on localhost:5173
npm run build        # production files in dist/

# API on the Dell
node experiments/browser/devtools-lab.js
curl -s http://vaultlab.home:8080/api/items

# Commit without node_modules
git status
git add client
```

## Security things I noticed

- **Keys and secrets:** a wrong `key` revealed a password the user never asked to see. In a password manager, UI bugs can become security bugs.
- **Passwords are generated with `crypto.getRandomValues`**, never `Math.random`, and without bias.
- **A front-end loop can act like an attack** on my own API. Later, the server will need limits on how many requests one client can make.
- **The proxy changes what the server sees:** the client IP in the log was Vite's, not the browser's. That matters for logging and for blocking abusive clients.
- **`node_modules` is never committed**, but `package-lock.json` is, so the same versions are installed everywhere.

## Reflection

**What did I learn?**
How React thinks (components, props, state), controlled forms, lifting state up, `useEffect` and its dependency list, Vite and its proxy, and React DevTools.

**What did I understand better after practising?**
Why state must be replaced and not changed, and why `key` matters. Both looked like small rules until I saw the screen show the wrong thing.

**What troubleshooting skills did I develop?**
Recognising React's typical failures from what the user sees: a white screen means Console first, "nothing happens" can mean mutated state, and a flooded server can mean a missing `[]`. And reading `200 text/html` and `502` behind a proxy.

**What should I review next?**
The dependency list of `useEffect`, and the break-and-fix table.

**What can I demonstrate now that I couldn't before?**
I can build a small React app from components that loads data from my own API, and explain what to do when a user reports a blank white page, because I caused one myself.