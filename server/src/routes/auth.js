const express = require('express')
const pool = require('../db')
const { hashPassword, verifyPassword } = require('../passwords')
const sessions = require('../sessions')
const requireAuth = require('../middleware/requireAuth')

const router = express.Router()

// A real hash of a random password, used when the email doesn't exist,
// so that "unknown email" takes as long as "wrong password"
const dummyHash = hashPassword(require('node:crypto').randomBytes(16).toString('hex'))

// Simple brute-force protection: at most 5 failed logins per email and address per 15 minutes
const FAILURE_LIMIT = 5
const FAILURE_WINDOW_MS = 15 * 60 * 1000
const failures = new Map() // "email|ip" -> { count, firstAt }

function tooManyFailures(key) {
  const entry = failures.get(key)
  if (!entry) return false
  if (Date.now() - entry.firstAt > FAILURE_WINDOW_MS) {
    failures.delete(key)
    return false
  }
  return entry.count >= FAILURE_LIMIT
}

function recordFailure(key) {
  const entry = failures.get(key) || { count: 0, firstAt: Date.now() }
  entry.count++
  failures.set(key, entry)
}

function normaliseEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

// POST /api/auth/register: create an account
router.post('/register', async (req, res) => {
  const email = normaliseEmail(req.body?.email)
  const password = req.body?.password
  const problems = []
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 255) problems.push('a valid email is required')
  if (typeof password !== 'string' || password.length < 12) problems.push('password must be at least 12 characters')
  else if (password.length > 200) problems.push('password must be at most 200 characters')
  if (problems.length > 0) {
    return res.status(400).json({ error: 'Invalid registration', details: problems })
  }

  try {
    const passwordHash = await hashPassword(password)
    const [result] = await pool.execute('INSERT INTO users (email, password_hash) VALUES (?, ?)', [email, passwordHash])
    res.status(201).json({ id: result.insertId, email })
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'An account with this email already exists' })
    }
    throw err
  }
})

// POST /api/auth/login: check the password and start a session
router.post('/login', async (req, res) => {
  const email = normaliseEmail(req.body?.email)
  const password = typeof req.body?.password === 'string' ? req.body.password : ''
  const key = `${email}|${req.ip}`

  if (tooManyFailures(key)) {
    return res.status(429).json({ error: 'Too many failed attempts. Try again later.' })
  }

  const [rows] = await pool.execute('SELECT id, email, role, password_hash FROM users WHERE email = ?', [email])
  const user = rows[0]
  // Always run ONE password check, even for an unknown email
  const ok = await verifyPassword(password, user ? user.password_hash : await dummyHash)

  if (!user || !ok) {
    recordFailure(key)
    console.warn(`[auth] failed login for ${email || '(no email)'} from ${req.ip}`)
    return res.status(401).json({ error: 'Invalid email or password' })
  }

  failures.delete(key)
  const token = await sessions.createSession(user.id)
  res.cookie(sessions.COOKIE_NAME, token, sessions.cookieOptions)
  console.log(`[auth] user ${user.id} logged in from ${req.ip}`)
  res.json({ id: user.id, email: user.email, role: user.role })
})

// POST /api/auth/logout: end the session on the server AND remove the cookie
router.post('/logout', async (req, res) => {
  const token = sessions.readCookie(req, sessions.COOKIE_NAME)
  if (token) await sessions.deleteSession(token)
  res.clearCookie(sessions.COOKIE_NAME, { ...sessions.cookieOptions, maxAge: undefined })
  res.status(204).end()
})

// GET /api/auth/me: who is logged in?
router.get('/me', requireAuth, (req, res) => {
  res.json(req.user)
})

module.exports = router
