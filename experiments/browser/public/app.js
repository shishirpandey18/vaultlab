// DevTools lab page (Day 6)
// Some of these functions have bugs ON PURPOSE. Find them with DevTools.

const statusBox = document.getElementById("status");
const list = document.getElementById("items");

// The second server, for the CORS test: same name, other port
const OTHER_SERVER = `${location.protocol}//${location.hostname}:8081`;

function showStatus(text, kind) {
  statusBox.textContent = text;
  statusBox.className = kind || "";
}

// A careful request: checks the status code and shows a clear message
async function getJson(url, options) {
  console.log(`-> ${options?.method || "GET"} ${url}`);
  const res = await fetch(url, options);
  const type = res.headers.get("content-type") || "";
  if (!type.includes("application/json")) {
    throw new Error(`${res.status} ${res.statusText}: expected JSON but got ${type || "nothing"}`);
  }
  const body = await res.json();
  if (!res.ok) {
    console.warn(`<- ${res.status} ${res.statusText} from ${url}`, body);
    throw new Error(`${res.status} ${res.statusText}: ${body.error}`);
  }
  console.log(`<- ${res.status} from ${url}`, body);
  return body;
}

function renderItems(items) {
  list.innerHTML = "";
  for (const item of items) {
    const li = document.createElement("li");
    li.textContent = `${item.title} (${item.username ?? "no username"})`;
    list.appendChild(li);
  }
}

// 1. Works
document.getElementById("load-items").addEventListener("click", async () => {
  try {
    const items = await getJson("/api/items");
    renderItems(items);
    showStatus(`Loaded ${items.length} items.`, "ok");
  } catch (err) {
    showStatus(`Could not load items: ${err.message}`, "error");
  }
});

// 2. BUG: item 3 has no username, and this code doesn't expect that
function showDetails(item) {
  const name = item.username ? item.username.toUpperCase() : "(no username)";
  showStatus(`${item.title}: ${name}`, "ok");
}

document.getElementById("show-details").addEventListener("click", async () => {
  const items = await getJson("/api/items");
  showDetails(items[2]);
});

// 3. BUG: a typo in the URL
document.getElementById("wrong-url").addEventListener("click", async () => {
  try {
    await getJson("/api/itemz");
  } catch (err) {
    showStatus(`Could not load items: ${err.message}`, "error");
  }
});

// 4. The server fails
document.getElementById("server-error").addEventListener("click", async () => {
  try {
    await getJson("/api/error");
  } catch (err) {
    showStatus(`Something went wrong: ${err.message}`, "error");
  }
});

// 5. BUG: expects JSON, gets HTML, and nothing catches the error
document.getElementById("not-json").addEventListener("click", async () => {
  try {
    const data = await getJson("/api/not-json");
    showStatus(JSON.stringify(data), "ok");
  } catch (err) {
    showStatus(`Unexpected answer: ${err.message}`, "error");
  }
});

// 6. Slow, but works
document.getElementById("slow").addEventListener("click", async () => {
  showStatus("Waiting...");
  const data = await getJson("/api/slow");
  showStatus(data.message, "ok");
});

// 7. Another origin (other port): blocked by the browser unless that server allows it
document.getElementById("other-server").addEventListener("click", async () => {
  try {
    const items = await getJson(`${OTHER_SERVER}/api/items`);
    showStatus(`Loaded ${items.length} items from the other server.`, "ok");
  } catch (err) {
    showStatus(`Other server failed: ${err.message}`, "error");
  }
});

// 8. Kills the server process
document.getElementById("crash").addEventListener("click", async () => {
  try {
    await getJson("/api/crash");
  } catch (err) {
    showStatus(`Crash request failed: ${err.message}`, "error");
  }
});

// Log in form
document.getElementById("login-form").addEventListener("submit", async (event) => {
  event.preventDefault(); // stop the browser from reloading the page
  const username = document.getElementById("username").value;
  const password = document.getElementById("password").value;
  try {
    const data = await getJson("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    showStatus(`${data.message} as ${data.user}.`, "ok");
  } catch (err) {
    showStatus(`Login failed: ${err.message}`, "error");
  }
});