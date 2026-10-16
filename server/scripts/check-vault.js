// Day 12: try to decrypt every item with the current VAULT_KEY, and list the ones that fail.
// Run from server/:  node scripts/check-vault.js
// Prints ids and owners only, never a password.
require('../src/config')
const pool = require('../src/db')
const { decryptSecret } = require('../src/vaultCrypto')

async function main() {
  const [rows] = await pool.query('SELECT id, user_id, password_enc FROM items ORDER BY id')
  const failed = []
  for (const row of rows) {
    try {
      decryptSecret(row.user_id, row.password_enc)
    } catch (err) {
      failed.push(row)
      console.log(`  FAILED item ${row.id} (user ${row.user_id}): ${err.message}`)
    }
  }
  console.log(`${rows.length - failed.length} of ${rows.length} item(s) decrypt with this key`)
  await pool.end()
  if (failed.length > 0) process.exitCode = 1
}

main().catch(async (err) => {
  console.error(`Stopped: ${err.message}`)
  await pool.end()
  process.exitCode = 1
})
