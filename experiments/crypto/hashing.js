// Hashing vs encryption, by experiment (Day 10)
// Run: node experiments/crypto/hashing.js
const crypto = require('node:crypto')

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex')

console.log('1. A hash is a fingerprint: same input, same output, every time')
console.log('   sha256("password123") =', sha256('password123'))
console.log('   sha256("password123") =', sha256('password123'))
console.log('   sha256("password124") =', sha256('password124'))

console.log('\n2. A fast hash is FAST, which is bad for passwords')
let count = 0
const end = Date.now() + 1000
while (Date.now() < end) {
  sha256(`guess-${count}`)
  count++
}
console.log(`   SHA-256 guesses in 1 second on this machine: ${count.toLocaleString('en')}`)

console.log('\n3. Two users with the same password get the same fast hash')
console.log('   alice:', sha256('Summer2026!'))
console.log('   bob:  ', sha256('Summer2026!'))

console.log('\n4. A salt (random, different per user) makes them different')
const saltA = crypto.randomBytes(16).toString('hex')
const saltB = crypto.randomBytes(16).toString('hex')
console.log('   alice:', saltA, sha256(saltA + 'Summer2026!'))
console.log('   bob:  ', saltB, sha256(saltB + 'Summer2026!'))

console.log('\n5. A slow hash: scrypt (built into Node.js)')
const PARAMS = { N: 2 ** 15, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }
const salt = crypto.randomBytes(16)
const started = Date.now()
const hash = crypto.scryptSync('Summer2026!', salt, 32, PARAMS)
const ms = Date.now() - started
console.log(`   one scrypt hash took ${ms} ms (about ${Math.round(1000 / ms)} guesses per second instead of ${count.toLocaleString('en')})`)
console.log('   stored as:', `scrypt$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}$${salt.toString('base64')}$${hash.toString('base64')}`)

console.log('\n6. Encryption is different: it can be reversed, with the key')
const key = crypto.randomBytes(32)
const iv = crypto.randomBytes(12)
const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
const encrypted = Buffer.concat([cipher.update('my GitHub password', 'utf8'), cipher.final()])
const tag = cipher.getAuthTag()
console.log('   encrypted:', encrypted.toString('base64'))
const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
decipher.setAuthTag(tag)
const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
console.log('   decrypted with the key:', decrypted)
