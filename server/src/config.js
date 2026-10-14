// Reads settings from the environment (and from server/.env, if there is one)
const path = require('node:path')

// Look for .env next to the code, not in whatever folder the server was started from
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true })

const REQUIRED = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME']
const missing = REQUIRED.filter((name) => !process.env[name])
if (missing.length > 0) {
  console.error(`Missing settings: ${missing.join(', ')}. Copy .env.example to .env and fill it in.`)
  process.exit(1)
}

module.exports = {
  port: Number(process.env.PORT) || 3000,
  host: process.env.HOST || '0.0.0.0',
  db: {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  },
}
