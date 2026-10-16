// Day 12: two AES-GCM mistakes, shown with fake data.  Run: node experiments/crypto/gcm-mistakes.js
const crypto = require('node:crypto')

const key = crypto.randomBytes(32)

function encrypt(text, iv, aad) {
  const c = crypto.createCipheriv('aes-256-gcm', key, iv)
  if (aad) c.setAAD(Buffer.from(aad))
  const ct = Buffer.concat([c.update(text, 'utf8'), c.final()])
  return { iv, ct, tag: c.getAuthTag() }
}

function decrypt({ iv, ct, tag }, aad) {
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv)
  if (aad) d.setAAD(Buffer.from(aad))
  d.setAuthTag(tag)
  return Buffer.concat([d.update(ct), d.final()]).toString('utf8')
}

const xor = (a, b) => Buffer.from(a.map((byte, i) => byte ^ b[i]))

console.log('1. A new random IV every time')
const a1 = encrypt('same-password-1', crypto.randomBytes(12))
const a2 = encrypt('same-password-1', crypto.randomBytes(12))
console.log('   same password twice:', a1.ct.toString('hex'), a2.ct.toString('hex'))
console.log('   identical?', a1.ct.equals(a2.ct))

console.log('\n2. MISTAKE: the same IV every time')
const fixed = Buffer.alloc(12) // twelve zero bytes
const b1 = encrypt('same-password-1', fixed)
const b2 = encrypt('same-password-1', fixed)
console.log('   same password twice:', b1.ct.toString('hex'), b2.ct.toString('hex'))
console.log('   identical?', b1.ct.equals(b2.ct), ' <- anyone reading the table sees who shares a password')

// Worse: GCM encrypts by XOR-ing the text with a keystream made from key + IV.
// Same key + same IV = same keystream, so XOR-ing two ciphertexts cancels it out.
const known = 'Summer2026!Bank1'
const secret = 'MyRealPassw0rd!!'
const c1 = encrypt(known, fixed).ct
const c2 = encrypt(secret, fixed).ct
const recovered = xor(xor(c1, c2), Buffer.from(known)).toString('utf8')
console.log('   attacker knows one password:', known)
console.log('   ...and recovers the other, WITHOUT the key:', recovered)

console.log('\n3. AAD ties a ciphertext to its owner')
const mine = encrypt('shishirs-bank-password', crypto.randomBytes(12), 'vaultlab:item-owner:1')
try {
  decrypt(mine, 'vaultlab:item-owner:6') // copied into user 6's row
} catch (err) {
  console.log('   decrypting it as user 6:', err.message)
}
console.log('   decrypting it as user 1:', decrypt(mine, 'vaultlab:item-owner:1'))

console.log('\n4. MISTAKE: no AAD')
const noAad = encrypt('shishirs-bank-password', crypto.randomBytes(12))
console.log('   copied into anyone\'s row, it decrypts fine:', decrypt(noAad))
