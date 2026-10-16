// Encrypts and decrypts vault secrets with AES-256-GCM (Day 12).
// Stored format: v1:<iv>:<tag>:<ciphertext>, each part base64.
//   iv         12 random bytes, NEW for every encryption (never reuse one with the same key)
//   tag        16 bytes that prove nobody changed the ciphertext, the iv or the owner
//   ciphertext the encrypted secret, same length as the original
const crypto = require('node:crypto')
const config = require('./config')

const FORMAT = 'v1'
const key = Buffer.from(config.vaultKey, 'hex') // 32 bytes = 256 bits

// "Additional authenticated data": not secret, not stored, but part of the check.
// It ties each ciphertext to its owner, so it can't be copied into another user's row.
function ownerData(userId) {
  return Buffer.from(`vaultlab:item-owner:${userId}`)
}

function encryptSecret(userId, plaintext) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(ownerData(userId))
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [FORMAT, iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join(':')
}

function decryptSecret(userId, stored) {
  const parts = String(stored).split(':')
  if (parts.length !== 4 || parts[0] !== FORMAT) {
    throw new Error(`not a ${FORMAT} encrypted value`)
  }
  const [, iv, tag, ciphertext] = parts.map((part, i) => (i === 0 ? part : Buffer.from(part, 'base64')))
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAAD(ownerData(userId))
  decipher.setAuthTag(tag)
  // final() throws if the key, iv, tag, ciphertext or owner don't match: GCM never returns garbage
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}

module.exports = { encryptSecret, decryptSecret }
