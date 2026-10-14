// Login sessions: a random token in a cookie, and only its SHA-256 hash in the database
const crypto = require('node:crypto')
const pool = require('./db')

const COOKIE_NAME = 'vaultlab_session'
const SESSION_HOURS = 8

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex')

async function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url') // 256 random bits
  await pool.execute(
    'INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, NOW() + INTERVAL ? HOUR)',
    [sha256(token), userId, SESSION_HOURS],
  )
  return token
}

// The user behind a token, or undefined if the token is unknown or expired
async function findSessionUser(token) {
  const [rows] = await pool.execute(
    `SELECT users.id, users.email FROM sessions
       JOIN users ON users.id = sessions.user_id
      WHERE sessions.token_hash = ? AND sessions.expires_at > NOW()`,
    [sha256(token)],
  )
  return rows[0]
}

async function deleteSession(token) {
  await pool.execute('DELETE FROM sessions WHERE token_hash = ?', [sha256(token)])
}

// Read one cookie from the request's Cookie header ("a=1; b=2")
function readCookie(req, name) {
  const header = req.headers.cookie || ''
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return decodeURIComponent(rest.join('='))
  }
  return undefined
}

const cookieOptions = {
  httpOnly: true, // JavaScript in the page can't read it
  sameSite: 'lax', // not sent with requests that other websites start
  secure: false, // TODO: true once VaultLab runs on HTTPS
  path: '/',
  maxAge: SESSION_HOURS * 60 * 60 * 1000,
}

module.exports = { COOKIE_NAME, cookieOptions, createSession, findSessionUser, deleteSession, readCookie }
