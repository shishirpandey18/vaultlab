// One log line per request: time, client, method, URL, status, duration.
// It never logs request bodies, because they can contain passwords.
function logger(req, res, next) {
  const started = Date.now()
  const client = req.ip // read it now: after the connection closes it's gone
  res.on('finish', () => {
    console.log(`${new Date().toISOString()} ${client} ${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - started} ms)`)
  })
  res.on('close', () => {
    if (!res.writableFinished) {
      console.log(`${new Date().toISOString()} ${client} ${req.method} ${req.originalUrl} -> no response, connection closed after ${Date.now() - started} ms`)
    }
  })
  next()
}

module.exports = logger
