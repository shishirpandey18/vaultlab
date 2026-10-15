import { useEffect, useState } from 'react'
import { api } from '../lib/api.js'

// Only rendered for admins. Hiding it is for convenience: the SERVER is what enforces it.
export default function AdminPanel() {
  const [users, setUsers] = useState([])
  const [error, setError] = useState('')

  useEffect(() => {
    api('/admin/users')
      .then(setUsers)
      .catch((err) => setError(err.message))
  }, [])

  return (
    <section className="admin">
      <h2>Admin: accounts</h2>
      {error && <p className="error">{error}</p>}
      <table>
        <thead><tr><th>Id</th><th>Email</th><th>Role</th><th>Items</th></tr></thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}><td>{u.id}</td><td>{u.email}</td><td>{u.role}</td><td>{u.itemCount}</td></tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
