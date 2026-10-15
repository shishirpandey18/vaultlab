// Lets the request through only if the logged-in user has this role.
// Use AFTER requireAuth, which sets req.user.
function requireRole(role) {
  return (req, res, next) => {
    if (req.user?.role !== role) {
      console.warn(`[authz] user ${req.user?.id} (${req.user?.role}) denied ${req.method} ${req.originalUrl}`)
      return res.status(403).json({ error: 'Forbidden' })
    }
    next()
  }
}

module.exports = requireRole
