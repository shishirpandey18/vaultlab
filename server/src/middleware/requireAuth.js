const { COOKIE_NAME, findSessionUser, readCookie } = require('../sessions')

// Lets the request through only with a valid session; sets req.user
async function requireAuth(req, res, next) {
  const token = readCookie(req, COOKIE_NAME)
  const user = token ? await findSessionUser(token) : undefined
  if (!user) {
    return res.status(401).json({ error: 'Not logged in' })
  }
  req.user = user
  next()
}

module.exports = requireAuth
