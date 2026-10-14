import { useState } from 'react'
import { api } from '../lib/api.js'

// Log in, or create an account and then log in
export default function LoginForm({ onLoggedIn }) {
  const [mode, setMode] = useState('login') // 'login' or 'register'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')
    setBusy(true)
    try {
      const body = JSON.stringify({ email, password })
      if (mode === 'register') {
        await api('/auth/register', { method: 'POST', body })
      }
      const user = await api('/auth/login', { method: 'POST', body })
      setPassword('') // don't keep the password in memory longer than needed
      onLoggedIn(user)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="login-form" onSubmit={handleSubmit}>
      <h2>{mode === 'login' ? 'Log in' : 'Create an account'}</h2>
      <input type="email" placeholder="Email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
      <input
        type="password"
        placeholder="Password (at least 12 characters)"
        autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <button type="submit" disabled={busy}>{busy ? 'Please wait...' : mode === 'login' ? 'Log in' : 'Create account'}</button>
      <button type="button" className="link" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
        {mode === 'login' ? 'No account yet? Create one' : 'Already have an account? Log in'}
      </button>
      {error && <p className="error">{error}</p>}
    </form>
  )
}
