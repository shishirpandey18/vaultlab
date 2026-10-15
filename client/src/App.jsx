import { useEffect, useState } from 'react'
import AddItemForm from './components/AddItemForm.jsx'
import ItemList from './components/ItemList.jsx'
import LoginForm from './components/LoginForm.jsx'
import AdminPanel from './components/AdminPanel.jsx'
import { api } from './lib/api.js'

export default function App() {
  const [user, setUser] = useState(undefined) // undefined = still checking, null = logged out
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  // On start: is there already a valid session cookie?
  useEffect(() => {
    api('/auth/me')
      .then(setUser)
      .catch(() => setUser(null))
  }, [])

  // Whenever someone logs in: load their vault
  useEffect(() => {
    if (!user) return
    async function loadItems() {
      setLoading(true)
      setError('')
      try {
        setItems(await api('/items'))
      } catch (err) {
        if (err.status === 401) return setUser(null) // session expired: back to the login form
        console.error('Could not load items:', err)
        setError(`Could not load your vault (${err.message}).`)
      } finally {
        setLoading(false)
      }
    }
    loadItems()
  }, [user])

  async function logout() {
    await api('/auth/logout', { method: 'POST' })
    setItems([])
    setUser(null)
  }

  // Save on the server first, then show the item the server sent back
  async function addItem(newItem) {
    const saved = await api('/items', { method: 'POST', body: JSON.stringify(newItem) })
    setItems((current) => [...current, saved])
  }

  async function deleteItem(id) {
    try {
      await api(`/items/${id}`, { method: 'DELETE' })
      setItems((current) => current.filter((item) => item.id !== id))
      setNotice('')
    } catch (err) {
      setNotice(`Could not delete the item (${err.message}).`)
    }
  }

  if (user === undefined) {
    return <main className="app"><p className="muted">Checking your session...</p></main>
  }

  if (user === null) {
    return (
      <main className="app">
        <h1>VaultLab</h1>
        <LoginForm onLoggedIn={setUser} />
      </main>
    )
  }

  return (
    <main className="app">
      <div className="topbar">
        <h1>VaultLab</h1>
        <span className="muted">
          {user.email} {user.role === 'admin' && <strong>(admin)</strong>} <button onClick={logout}>Log out</button>
        </span>
      </div>
      <p className="muted">{items.length} items</p>
      <AddItemForm onAdd={addItem} />
      {notice && <p className="error">{notice}</p>}
      {loading && <p>Loading your vault...</p>}
      {error && <p className="error">{error}</p>}
      {!loading && !error && <ItemList items={items} onDelete={deleteItem} />}
      {user.role === 'admin' && <AdminPanel />}
    </main>
  )
}
