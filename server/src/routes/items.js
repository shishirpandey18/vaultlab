const express = require('express')
const store = require('../store')

const router = express.Router()

// Check the fields of a new or changed item. Returns a list of problems (empty = OK).
function validateItem(body, { partial = false } = {}) {
  const problems = []
  if (typeof body !== 'object' || body === null) {
    return ['Body must be a JSON object']
  }
  const { title, username, password } = body

  if (!partial || title !== undefined) {
    if (typeof title !== 'string' || title.trim() === '') problems.push('title is required')
    else if (title.length > 100) problems.push('title must be at most 100 characters')
  }
  if (username !== undefined && typeof username !== 'string') {
    problems.push('username must be a string')
  }
  if (!partial || password !== undefined) {
    if (typeof password !== 'string' || password === '') problems.push('password is required')
    else if (password.length > 200) problems.push('password must be at most 200 characters')
  }
  if (partial && title === undefined && username === undefined && password === undefined) {
    problems.push('send at least one of: title, username, password')
  }
  return problems
}

// Turn ":id" from the URL into a number, or answer 400
function parseId(req, res) {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id < 1) {
    res.status(400).json({ error: 'id must be a positive whole number' })
    return null
  }
  return id
}

// GET /api/items: list all items
router.get('/', (req, res) => {
  res.json(store.listItems())
})

// GET /api/items/:id: one item
router.get('/:id', (req, res) => {
  const id = parseId(req, res)
  if (id === null) return
  const item = store.getItem(id)
  if (!item) return res.status(404).json({ error: `Item ${id} not found` })
  res.json(item)
})

// POST /api/items: create an item
router.post('/', (req, res) => {
  const problems = validateItem(req.body)
  if (problems.length > 0) {
    return res.status(400).json({ error: 'Invalid item', details: problems })
  }
  const { title, username, password } = req.body
  const item = store.createItem({ title: title.trim(), username: username?.trim() || undefined, password })
  res.status(201).location(`/api/items/${item.id}`).json(item)
})

// PATCH /api/items/:id: change some fields of an item
router.patch('/:id', (req, res) => {
  const id = parseId(req, res)
  if (id === null) return
  const problems = validateItem(req.body, { partial: true })
  if (problems.length > 0) {
    return res.status(400).json({ error: 'Invalid change', details: problems })
  }
  const { title, username, password } = req.body
  const changes = {}
  if (title !== undefined) changes.title = title.trim()
  if (username !== undefined) changes.username = username.trim() || undefined
  if (password !== undefined) changes.password = password
  const item = store.updateItem(id, changes)
  if (!item) return res.status(404).json({ error: `Item ${id} not found` })
  res.json(item)
})

// DELETE /api/items/:id: delete an item
router.delete('/:id', (req, res) => {
  const id = parseId(req, res)
  if (id === null) return
  if (!store.deleteItem(id)) return res.status(404).json({ error: `Item ${id} not found` })
  res.status(204).end()
})

module.exports = router
