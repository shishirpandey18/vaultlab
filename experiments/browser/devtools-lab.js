// DevTools lab server (Day 6)
// Serves the page in ./public and a small API with problems on purpose.
// Run:  node devtools-lab.js                     listens on 0.0.0.0:8080
//       PORT=8081 node devtools-lab.js           a second copy (for the CORS test)
//       ALLOW_ORIGIN=http://vaultlab.home:8080 PORT=8081 node devtools-lab.js
//                                                the second copy, with CORS allowed

const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");

const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || "0.0.0.0";
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || null;
const PUBLIC_DIR = path.join(__dirname, "public");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

// Fake vault items: titles only, no real secrets
const ITEMS = [
  { id: 1, title: "GitHub", username: "shishir" },
  { id: 2, title: "Email", username: "shishir@example.com" },
  { id: 3, title: "Bank (demo)" },
];

function send(res, status, type, body) {
  const headers = { "Content-Type": type, "Content-Length": Buffer.byteLength(body), "Cache-Control": "no-store" };
  if (ALLOW_ORIGIN) headers["Access-Control-Allow-Origin"] = ALLOW_ORIGIN;
  res.writeHead(status, headers);
  res.end(body);
}

function sendJson(res, status, body) {
  send(res, status, "application/json; charset=utf-8", JSON.stringify(body, null, 2) + "\n");
}

// Read the whole request body (for POST)
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

async function serveFile(req, res) {
  const urlPath = req.url === "/" ? "/index.html" : req.url.split("?")[0];
  const file = path.normalize(path.join(PUBLIC_DIR, urlPath));

  // Never serve anything outside the public folder (e.g. /../devtools-lab.js)
  if (!file.startsWith(PUBLIC_DIR + path.sep)) {
    return sendJson(res, 403, { error: "Forbidden" });
  }
  try {
    const body = await fs.readFile(file, "utf8");
    send(res, 200, TYPES[path.extname(file)] || "text/plain; charset=utf-8", body);
  } catch {
    send(res, 404, "text/plain; charset=utf-8", `Not found: ${urlPath}\n`);
  }
}

const server = http.createServer(async (req, res) => {
  const started = Date.now();
  res.on("finish", () => {
    console.log(`${new Date().toISOString()} ${req.socket.remoteAddress} ${req.method} ${req.url} -> ${res.statusCode} (${Date.now() - started} ms)`);
  });

  const url = req.url.split("?")[0];

  if (req.method === "GET" && url === "/api/items") {
    return sendJson(res, 200, ITEMS);
  }

  if (req.method === "GET" && url === "/api/slow") {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    return sendJson(res, 200, { message: "Sorry I'm late (3 seconds)" });
  }

  if (url === "/api/error") {
    try {
      throw new Error("Database is not reachable (simulated)");
    } catch (err) {
      console.error(`Handled error: ${err.message}`);
      return sendJson(res, 500, { error: "Internal Server Error" });
    }
  }

  if (url === "/api/not-json") {
    // Says 200, but sends an HTML page instead of JSON (like a proxy error page)
    return send(res, 200, "text/html; charset=utf-8", "<!DOCTYPE html><html><body><h1>Maintenance</h1></body></html>\n");
  }

  if (req.method === "POST" && url === "/api/login") {
    let data;
    try {
      data = JSON.parse(await readBody(req));
    } catch {
      return sendJson(res, 400, { error: "Body must be JSON" });
    }
    if (!data.username || !data.password) {
      return sendJson(res, 400, { error: "username and password are required" });
    }
    // Demo account only. Real passwords are never checked like this (that's Day 10).
    if (data.username === "demo" && data.password === "demo-password") {
      return sendJson(res, 200, { message: "Logged in", user: "demo" });
    }
    return sendJson(res, 401, { error: "Wrong username or password" });
  }

  if (url === "/api/crash") {
    throw new Error("Unhandled crash (simulated)");
  }

  if (url.startsWith("/api/")) {
    return sendJson(res, 404, { error: `No API route ${req.method} ${url}` });
  }

  return serveFile(req, res);
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`Error: port ${PORT} is already in use. Find the owner: sudo ss -tlnp | grep :${PORT}`);
  } else {
    console.error(`Server error: ${err.message}`);
  }
  process.exitCode = 1;
});

server.listen(PORT, HOST, () => {
  console.log(`DevTools lab on http://${HOST}:${PORT} (process id ${process.pid})${ALLOW_ORIGIN ? `, CORS allowed for ${ALLOW_ORIGIN}` : ""}`);
});