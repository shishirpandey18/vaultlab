const config = require('./config') // first: stops with a clear message if settings are missing
const app = require('./app')
const pool = require('./db')

const server = app.listen(config.port, config.host)

server.on('listening', async () => {
  console.log(`VaultLab API on http://${config.host}:${config.port} (process id ${process.pid})`)
  try {
    await pool.query('SELECT 1')
    console.log(`Database: connected to ${config.db.database} on ${config.db.host}:${config.db.port} as ${config.db.user}`)
  } catch (err) {
    console.error(`Database: NOT reachable (${err.code || err.message}). The API will answer 500/503 until it is.`)
  }
})

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Error: port ${config.port} is already in use. Find the owner: sudo ss -tlnp | grep :${config.port}`)
  } else {
    console.error(`Server error: ${err.message}`)
  }
  process.exitCode = 1
})
