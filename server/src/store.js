// In-memory store for vault items (Day 8).
// Everything here is lost when the server restarts. A real database comes next.
// WARNING: passwords are kept in plain text for now. Encryption comes later in the project.

let nextId = 4
const items = [
  { id: 1, title: 'GitHub', username: 'shishir' },
  { id: 2, title: 'Email', username: 'shishir@example.com' },
  { id: 3, title: 'Bank (demo)' },
]

function listItems() {
  return items
}

function getItem(id) {
  return items.find((item) => item.id === id)
}

function createItem({ title, username, password }) {
  const item = { id: nextId++, title, username, password, createdAt: new Date().toISOString() }
  items.push(item)
  return item
}

function updateItem(id, changes) {
  const item = getItem(id)
  if (!item) return undefined
  Object.assign(item, changes, { updatedAt: new Date().toISOString() })
  return item
}

function deleteItem(id) {
  const index = items.findIndex((item) => item.id === id)
  if (index === -1) return false
  items.splice(index, 1)
  return true
}

module.exports = { listItems, getItem, createItem, updateItem, deleteItem }
