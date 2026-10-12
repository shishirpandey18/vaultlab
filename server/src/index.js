const app = require('./app')

const PORT = Number(process.env.PORT) || 3000
const HOST = process.env.HOST || '0.0.0.0'

const server = app.listen(PORT, HOST)

server.on('listening', () => {
  console.log(`VaultLab API on http://${HOST}:${PORT} (process id ${process.pid})`)
})

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Error: port ${PORT} is already in use. Find the owner: sudo ss -tlnp | grep :${PORT}`)
  } else {
    console.error(`Server error: ${err.message}`)
  }
  process.exitCode = 1
})
