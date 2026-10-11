const SETS = {
  lower: 'abcdefghijklmnopqrstuvwxyz',
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  digits: '0123456789',
  symbols: '!@#$%^&*()-_=+[]{};:,.?',
}

// A random whole number from 0 to max - 1, without bias
function randomIndex(max) {
  const limit = Math.floor(2 ** 32 / max) * max
  const buffer = new Uint32Array(1)
  do {
    crypto.getRandomValues(buffer)
  } while (buffer[0] >= limit)
  return buffer[0] % max
}

export function generatePassword(length = 16) {
  const pool = Object.values(SETS).join('')
  let password = ''
  for (let i = 0; i < length; i++) {
    password += pool[randomIndex(pool.length)]
  }
  return password
}
