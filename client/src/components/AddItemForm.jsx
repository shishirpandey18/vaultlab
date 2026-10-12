import { useState } from 'react'
import { generatePassword } from '../lib/passwords.js'

// A controlled form: React state holds what is typed in each input
export default function AddItemForm({ onAdd }) {
  const [title, setTitle] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  async function handleSubmit(event) {
    event.preventDefault() // stop the browser from reloading the page
    if (!title.trim() || !password) {
      setError('Title and password are required.')
      return
    }
    try {
      await onAdd({ title: title.trim(), username: username.trim() || undefined, password })
      setTitle('')
      setUsername('')
      setPassword('')
      setError('')
    } catch (err) {
      setError(`Could not save: ${err.message}`) // keep what was typed, so nothing is lost
    }
  }

  return (
    <form className="add-form" onSubmit={handleSubmit}>
      <input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
      <input placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} />
      <input placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
      <button type="button" onClick={() => setPassword(generatePassword(16))}>Generate</button>
      <button type="submit">Add</button>
      {error && <p className="error">{error}</p>}
    </form>
  )
}
