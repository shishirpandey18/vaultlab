// Vault items, stored in MariaDB (Day 9).
// Every value from outside goes in through a ? placeholder, never by building SQL text.
// WARNING: passwords are stored as plain text for now. Encryption comes later in the project.
const pool = require('./db')

const COLUMNS = 'id, title, username, password, created_at AS createdAt, updated_at AS updatedAt'
const CHANGEABLE = ['title', 'username', 'password'] // the only columns PATCH may change

async function listItems() {
  const [rows] = await pool.execute(`SELECT ${COLUMNS} FROM items ORDER BY id`)
  return rows
}

async function searchItems(text) {
  const [rows] = await pool.execute(`SELECT ${COLUMNS} FROM items WHERE title LIKE ? ORDER BY id`, [`%${text}%`])
  return rows
}

async function getItem(id) {
  const [rows] = await pool.execute(`SELECT ${COLUMNS} FROM items WHERE id = ?`, [id])
  return rows[0] // undefined if there is no such item
}

async function createItem({ title, username, password }) {
  const [result] = await pool.execute(
    'INSERT INTO items (title, username, password) VALUES (?, ?, ?)',
    [title, username ?? null, password],
  )
  return getItem(result.insertId)
}

async function updateItem(id, changes) {
  const fields = Object.keys(changes).filter((field) => CHANGEABLE.includes(field))
  if (fields.length === 0) return getItem(id)
  const setList = fields.map((field) => `${field} = ?`).join(', ')
  const values = fields.map((field) => changes[field] ?? null)
  const [result] = await pool.execute(`UPDATE items SET ${setList} WHERE id = ?`, [...values, id])
  if (result.affectedRows === 0) return undefined
  return getItem(id)
}

async function deleteItem(id) {
  const [result] = await pool.execute('DELETE FROM items WHERE id = ?', [id])
  return result.affectedRows > 0
}

module.exports = { listItems, searchItems, getItem, createItem, updateItem, deleteItem }
