// Hashing and checking login passwords with scrypt (built into Node.js)
const crypto = require('node:crypto')
const { promisify } = require('node:util')

const scrypt = promisify(crypto.scrypt)

// Cost settings: slow on purpose (about a quarter of a second per hash)
const N = 2 ** 15
const r = 8
const p = 3
const KEY_LENGTH = 32
const MAXMEM = 64 * 1024 * 1024

// Returns a string like scrypt$32768$8$3$<salt>$<hash>, ready to store
async function hashPassword(password) {
  const salt = crypto.randomBytes(16)
  const hash = await scrypt(password, salt, KEY_LENGTH, { N, r, p, maxmem: MAXMEM })
  return ['scrypt', N, r, p, salt.toString('base64'), hash.toString('base64')].join('$')
}

// Hashes the attempt with the SAME salt and settings, then compares
async function verifyPassword(password, stored) {
  const [scheme, n, rr, pp, saltB64, hashB64] = stored.split('$')
  if (scheme !== 'scrypt') return false
  const expected = Buffer.from(hashB64, 'base64')
  const actual = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(n), r: Number(rr), p: Number(pp), maxmem: MAXMEM,
  })
  return crypto.timingSafeEqual(actual, expected) // compares in constant time
}

module.exports = { hashPassword, verifyPassword }
