const config = require('./config') // first: stops with a clear message if settings are missing
const app = require('./app')
const pool = require('./db')
const store = require('./store')

async function main() {
  // 1. Can we reach the database?
  let databaseOk = false
  try {
    await pool.query('SELECT 1')
    databaseOk = true
    console.log(`Database: connected to ${config.db.database} on ${config.db.host}:${config.db.port} as ${config.db.user}`)
  } catch (err) {
    console.error(`Database: NOT reachable (${err.code || err.message}). The API will answer 500/503 until it is.`)
  }

  // 2. Does VAULT_KEY open the vault? Checked BEFORE accepting any request
  if (databaseOk) {
    let key
    try {
      key = await store.checkVaultKey()
    } catch (err) {
      key = { ok: false, message: `could not run (${err.code || err.message}). Has db/004 been applied?` }
    }
    if (!key.ok) {
      console.error(`Vault check FAILED: ${key.message}`)
      console.error('Either VAULT_KEY in .env is not the key this vault was encrypted with, or the code and database do not match.')
      console.error('Refusing to start, so that nothing gets saved with the wrong key.')
      process.exit(1)
    }
    console.log(`Vault check: ${key.message}`)
  }

  // 3. Only now: accept requests
  const server = app.listen(config.port, config.host)

  server.on('listening', () => {
    console.log(`VaultLab API on http://${config.host}:${config.port} (process id ${process.pid})`)
  })

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Error: port ${config.port} is already in use. Find the owner: sudo ss -tlnp | grep :${config.port}`)
    } else {
      console.error(`Server error: ${err.message}`)
    }
    process.exitCode = 1
  })
}

main()
