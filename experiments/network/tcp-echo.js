// TCP echo server (Day 4)
// Run:  node tcp-echo.js                 listens on 0.0.0.0:5000 (every network)
//       HOST=127.0.0.1 node tcp-echo.js  listens on this machine only
//       PORT=6000 node tcp-echo.js       another port

const net = require("node:net");

const PORT = Number(process.env.PORT) || 5000;
const HOST = process.env.HOST || "0.0.0.0";

// This function runs once for every new connection (every new socket)
const server = net.createServer((socket) => {
  const client = `${socket.remoteAddress}:${socket.remotePort}`;
  const me = `${socket.localAddress}:${socket.localPort}`;
  console.log(`[+] ${client} connected to ${me}`);

  socket.write(`Hello ${client}. You reached ${me}. Type something, or "quit".\n`);

  // TCP delivers a STREAM of bytes, not separate messages: two lines can
  // arrive in one "data" event, or one line in two. So collect the bytes
  // and handle them one complete line at a time.
  let buffer = "";
  socket.on("data", (data) => {
    buffer += data.toString();
    let newline;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      console.log(`[${client}] ${line}`);
      if (line === "quit") {
        socket.end("Bye!\n");
        return;
      }
      socket.write(`echo: ${line}\n`);
    }
  });

  socket.on("end", () => console.log(`[-] ${client} disconnected`));
  socket.on("error", (err) => console.log(`[!] ${client} ${err.code}`));
});

// Errors of the server itself, such as the port already being used
server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`Error: port ${PORT} is already in use.`);
    console.error(`Find who owns it with:  sudo ss -tlnp | grep :${PORT}`);
  } else if (err.code === "EACCES") {
    console.error(`Error: no permission to use port ${PORT} (ports below 1024 need root).`);
  } else {
    console.error(`Server error: ${err.message}`);
  }
  process.exitCode = 1;
});

server.listen(PORT, HOST, () => {
  console.log(`Echo server listening on ${HOST}:${PORT} (process id ${process.pid})`);
});