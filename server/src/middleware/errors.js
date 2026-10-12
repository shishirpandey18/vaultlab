// Runs when no route matched
function notFound(req, res) {
  res.status(404).json({ error: `No route for ${req.method} ${req.originalUrl}` })
}

// Runs when anything called next(err), threw, or returned a rejected promise.
// Express knows it's an error handler because it has FOUR parameters.
function errorHandler(err, req, res, next) {
  if (res.headersSent) {
    // An answer was already (partly) sent, so we can't send another one. Log it and let Express close the connection.
    console.error(`[error after response] ${req.method} ${req.originalUrl}:`, err.message)
    return next(err)
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Request body is not valid JSON' })
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body is too large' })
  }
  // Everything else is our fault: log the details, tell the client nothing internal
  console.error(`[error] ${req.method} ${req.originalUrl}:`, err)
  res.status(500).json({ error: 'Internal Server Error' })
}

module.exports = { notFound, errorHandler }
