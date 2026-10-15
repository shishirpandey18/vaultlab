const express = require('express')
const pool = require('../db')

const router = express.Router()

// GET /api/admin/users: every account and how many items it has (never the items themselves)
router.get('/users', async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT users.id, users.email, users.role, users.created_at AS createdAt, COUNT(items.id) AS itemCount
       FROM users LEFT JOIN items ON items.user_id = users.id
      GROUP BY users.id
      ORDER BY users.id`,
  )
  res.json(rows)
})

module.exports = router
