const express = require('express')
const logger = require('./middleware/logger')
const { notFound, errorHandler } = require('./middleware/errors')
const itemsRouter = require('./routes/items')

const app = express()

app.disable('x-powered-by') // don't advertise "Express" in every response

// Middleware runs in this order, for every request
app.use(logger)
app.use(express.json({ limit: '10kb' })) // read JSON bodies into req.body

// Routes
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptimeSeconds: Math.round(process.uptime()) })
})
app.use('/api/items', itemsRouter)

// Nothing matched, or something failed: these two must come LAST
app.use(notFound)
app.use(errorHandler)

module.exports = app
