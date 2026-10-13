const mysql = require('mysql2/promise')
const config = require('./config')

// A pool keeps a few connections open and lends them out, instead of
// opening a new connection for every request.
const pool = mysql.createPool({
  ...config.db,
  connectionLimit: 5,
  dateStrings: true, // return dates as text, exactly as stored
})

module.exports = pool
