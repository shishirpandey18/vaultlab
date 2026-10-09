// HTTP server with no framework (Day 5)
// Run:  node http-raw.js            listens on 0.0.0.0:8080
//       PORT=9000 node http-raw.js  another port

const http = require("node:http");

const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || "0.0.0.0";

// Send a JSON answer with a status code
function sendJson(res, status, body) {
  const text = JSON.stringify(body, null, 2) + "\n";
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(text),
  });
  res.end(text);
}

// This function runs once for every HTTP request
const server = http.createServer((req, res) => {
  const started = Date.now();

  // Log one line per request when the answer has been sent
  res.on("finish", () => {
    const ms = Date.now() - started;
    console.log(`${new Date().toISOString()} ${req.socket.remoteAddress} ${req.method} ${req.url} -> ${res.statusCode} (${ms} ms)`);
  });

  if (req.method === "GET" && req.url === "/api/hello") {
    return sendJson(res, 200, {
      message: "Hello from VaultLab",
      yourAddress: req.socket.remoteAddress,
      yourUserAgent: req.headers["user-agent"] || null,
      time: new Date().toISOString(),
    });
  }

  if (req.method === "GET" && req.url === "/api/headers") {
    // Shows exactly which headers the client sent
    return sendJson(res, 200, { method: req.method, url: req.url, headers: req.headers });
  }

  if (req.url === "/api/error") {
    // A handled error: the server catches it and answers 500
    try {
      throw new Error("Database is not reachable (simulated)");
    } catch (err) {
      console.error(`Handled error: ${err.message}`);
      return sendJson(res, 500, { error: "Internal Server Error" });
    }
  }

  if (req.url === "/api/crash") {
    // An UNHANDLED error: nothing catches it, so the whole process dies
    throw new Error("Unhandled crash (simulated)");
  }

  if (req.url.startsWith("/api/hello")) {
    return sendJson(res, 405, { error: `Method ${req.method} not allowed on /api/hello` });
  }

  return sendJson(res, 404, { error: `Nothing at ${req.url}` });
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
  console.log(`HTTP server listening on http://${HOST}:${PORT} (process id ${process.pid})`);
});