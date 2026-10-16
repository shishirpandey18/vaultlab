// Vault items, stored in MariaDB (Days 9, 11 and 12).
// Every function takes the owner's id, and every query is limited to that owner's items.
// Every value from outside goes in through a ? placeholder, never by building SQL text.
// Passwords are encrypted before they reach the database, and decrypted only here.
const pool = require('./db')
const { encryptSecret, decryptSecret } = require('./vaultCrypto')

const COLUMNS = 'id, title, username, password_enc, created_at AS createdAt, updated_at AS updatedAt'
const CHANGEABLE = ['title', 'username', 'password'] // the only fields PATCH may change

// A database row -> what the API sends: the password decrypted, the ciphertext never sent
function toItem(userId, row) {
  const { password_enc: passwordEnc, ...item } = row
  try {
    item.password = decryptSecret(userId, passwordEnc)
  } catch (err) {
    console.error(`[crypto] item ${row.id} of user ${userId} could not be decrypted: ${err.message}`)
    throw err
  }
  return item
}

async function listItems(userId) {
  const [rows] = await pool.execute(`SELECT ${COLUMNS} FROM items WHERE user_id = ? ORDER BY id`, [userId])
  return rows.map((row) => toItem(userId, row))
}

async function searchItems(userId, text) {
  // Titles are not encrypted, so the database can still search them
  const [rows] = await pool.execute(
    `SELECT ${COLUMNS} FROM items WHERE user_id = ? AND title LIKE ? ORDER BY id`,
    [userId, `%${text}%`],
  )
  return rows.map((row) => toItem(userId, row))
}

async function getItem(userId, id) {
  const [rows] = await pool.execute(`SELECT ${COLUMNS} FROM items WHERE id = ? AND user_id = ?`, [id, userId])
  return rows[0] ? toItem(userId, rows[0]) : undefined // undefined if there is no such item OR it belongs to someone else
}

async function createItem(userId, { title, username, password }) {
  const [result] = await pool.execute(
    'INSERT INTO items (user_id, title, username, password_enc) VALUES (?, ?, ?, ?)',
    [userId, title, username ?? null, encryptSecret(userId, password)],
  )
  return getItem(userId, result.insertId)
}

async function updateItem(userId, id, changes) {
  const fields = Object.keys(changes).filter((field) => CHANGEABLE.includes(field))
  if (fields.length === 0) return getItem(userId, id)
  // The password is stored as password_enc, encrypted; the other fields as they are
  const columns = fields.map((field) => (field === 'password' ? 'password_enc' : field))
  const values = fields.map((field) => (field === 'password' ? encryptSecret(userId, changes.password) : changes[field] ?? null))
  const setList = columns.map((column) => `${column} = ?`).join(', ')
  const [result] = await pool.execute(`UPDATE items SET ${setList} WHERE id = ? AND user_id = ?`, [...values, id, userId])
  if (result.affectedRows === 0) return undefined
  return getItem(userId, id)
}

async function deleteItem(userId, id) {
  const [result] = await pool.execute('DELETE FROM items WHERE id = ? AND user_id = ?', [id, userId])
  return result.affectedRows > 0
}

// At startup: can the configured key decrypt an existing item? A wrong key must stop the server,
// or it would save new items with the wrong key and mix two keys in one vault.
async function checkVaultKey() {
  const [rows] = await pool.query('SELECT id, user_id, password_enc FROM items ORDER BY id LIMIT 1')
  if (rows.length === 0) return { ok: true, message: 'no items yet, nothing to check' }
  try {
    decryptSecret(rows[0].user_id, rows[0].password_enc)
    return { ok: true, message: `OK (decrypted item ${rows[0].id})` }
  } catch (err) {
    return { ok: false, message: `cannot decrypt item ${rows[0].id} (${err.message})` }
  }
}

module.exports = { checkVaultKey, listItems, searchItems, getItem, createItem, updateItem, deleteItem }
