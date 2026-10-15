const express = require('express')
const logger = require('./middleware/logger')
const { notFound, errorHandler } = require('./middleware/errors')
const itemsRouter = require('./routes/items')
const pool = require('./db')
const authRouter = require('./routes/auth')
const requireAuth = require('./middleware/requireAuth')
const requireRole = require('./middleware/requireRole')
const adminRouter = require('./routes/admin')

const app = express()

app.disable('x-powered-by') // don't advertise "Express" in every response

// Middleware runs in this order, for every request
app.use(logger)
app.use(express.json({ limit: '10kb' })) // read JSON bodies into req.body

// API answers can contain secrets: never let the browser or a proxy keep a copy
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store')
  next()
})

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
app.use('/api/auth', authRouter)
app.use('/api/items', requireAuth, itemsRouter) // every items route needs a login
app.use('/api/admin', requireAuth, requireRole('admin'), adminRouter) // and these need an admin

// Nothing matched, or something failed: these two must come LAST
app.use(notFound)
app.use(errorHandler)

module.exports = app
