const express = require('express')
const logger = require('./middleware/logger')
const { notFound, errorHandler } = require('./middleware/errors')
const itemsRouter = require('./routes/items')
const pool = require('./db')

const app = express()

app.disable('x-powered-by') // don't advertise "Express" in every response

// Middleware runs in this order, for every request
app.use(logger)
app.use(express.json({ limit: '10kb' })) // read JSON bodies into req.body

// Routes
// Health check: is the API up, AND can it reach the database?
app.get('/api/health', async (req, res) => {
  const uptimeSeconds = Math.round(process.uptime())
  try {
    await pool.query('SELECT 1')
    res.json({ status: 'ok', database: 'ok', uptimeSeconds })
  } catch (err) {
    console.error(`[health] database check failed: ${err.code || err.message}`)
    res.status(503).json({ status: 'error', database: 'unreachable', uptimeSeconds })
  }
})
app.use('/api/items', itemsRouter)

// Nothing matched, or something failed: these two must come LAST
app.use(notFound)
app.use(errorHandler)

module.exports = app
