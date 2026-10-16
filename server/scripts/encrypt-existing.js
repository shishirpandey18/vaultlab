// Day 12, step 2 of 3: encrypt every item that has a plain-text password but no password_enc yet.
// Run from server/:  node scripts/encrypt-existing.js
// Safe to run twice: it only touches rows where password_enc is still empty.
const config = require('../src/config') // stops here if VAULT_KEY is missing or malformed
const pool = require('../src/db')
const { encryptSecret, decryptSecret } = require('../src/vaultCrypto')

async function main() {
  const [rows] = await pool.query('SELECT id, user_id, password FROM items WHERE password_enc IS NULL')
  console.log(`Database ${config.db.database}: ${rows.length} item(s) to encrypt`)

  for (const row of rows) {
    const encrypted = encryptSecret(row.user_id, row.password)
    // Check the round trip BEFORE saving: if this fails, the key or the code is wrong
    if (decryptSecret(row.user_id, encrypted) !== row.password) {
      throw new Error(`item ${row.id}: decrypting gave a different value, stopping`)
    }
    // updated_at = updated_at: encrypting isn't a change by the user, so keep their "last changed" date
    await pool.execute('UPDATE items SET password_enc = ?, updated_at = updated_at WHERE id = ? AND password_enc IS NULL', [
      encrypted,
      row.id,
    ])
    console.log(`  item ${row.id} (user ${row.user_id}) encrypted`)
  }

  const [[{ left }]] = await pool.query('SELECT COUNT(*) AS `left` FROM items WHERE password_enc IS NULL')
  console.log(`Done: ${left} left without an encrypted password`)
  await pool.end()
  if (left > 0) process.exitCode = 1
}

main().catch(async (err) => {
  console.error(`Stopped: ${err.message}`)
  await pool.end()
  process.exitCode = 1
})
