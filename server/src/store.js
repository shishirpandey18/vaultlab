// Vault items, stored in MariaDB (Days 9 and 11).
// Every function takes the owner's id, and every query is limited to that owner's items.
// Every value from outside goes in through a ? placeholder, never by building SQL text.
// WARNING: passwords are stored as plain text for now. Encryption comes later in the project.
const pool = require('./db')

const COLUMNS = 'id, title, username, password, created_at AS createdAt, updated_at AS updatedAt'
const CHANGEABLE = ['title', 'username', 'password'] // the only columns PATCH may change

async function listItems(userId) {
  const [rows] = await pool.execute(`SELECT ${COLUMNS} FROM items WHERE user_id = ? ORDER BY id`, [userId])
  return rows
}

async function searchItems(userId, text) {
  const [rows] = await pool.execute(
    `SELECT ${COLUMNS} FROM items WHERE user_id = ? AND title LIKE ? ORDER BY id`,
    [userId, `%${text}%`],
  )
  return rows
}

async function getItem(userId, id) {
  const [rows] = await pool.execute(`SELECT ${COLUMNS} FROM items WHERE id = ? AND user_id = ?`, [id, userId])
  return rows[0] // undefined if there is no such item OR it belongs to someone else
}

async function createItem(userId, { title, username, password }) {
  const [result] = await pool.execute(
    'INSERT INTO items (user_id, title, username, password) VALUES (?, ?, ?, ?)',
    [userId, title, username ?? null, password],
  )
  return getItem(userId, result.insertId)
}

async function updateItem(userId, id, changes) {
  const fields = Object.keys(changes).filter((field) => CHANGEABLE.includes(field))
  if (fields.length === 0) return getItem(userId, id)
  const setList = fields.map((field) => `${field} = ?`).join(', ')
  const values = fields.map((field) => changes[field] ?? null)
  const [result] = await pool.execute(`UPDATE items SET ${setList} WHERE id = ? AND user_id = ?`, [...values, id, userId])
  if (result.affectedRows === 0) return undefined
  return getItem(userId, id)
}

async function deleteItem(userId, id) {
  const [result] = await pool.execute('DELETE FROM items WHERE id = ? AND user_id = ?', [id, userId])
  return result.affectedRows > 0
}

module.exports = { listItems, searchItems, getItem, createItem, updateItem, deleteItem }
