import { useEffect, useState } from 'react'
import AddItemForm from './components/AddItemForm.jsx'
import ItemList from './components/ItemList.jsx'
import { api } from './lib/api.js'

export default function App() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  // Runs after the first render: load the items from the API once
  useEffect(() => {
    async function loadItems() {
      try {
        setItems(await api('/items'))
      } catch (err) {
        console.error('Could not load items:', err)
        setError(`Could not load your vault (${err.message}).`)
      } finally {
        setLoading(false)
      }
    }
    loadItems()
  }, [])

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

  return (
    <main className="app">
      <h1>VaultLab</h1>
      <p className="muted">{items.length} items</p>
      <AddItemForm onAdd={addItem} />
      {notice && <p className="error">{notice}</p>}
      {loading && <p>Loading your vault...</p>}
      {error && <p className="error">{error}</p>}
      {!loading && !error && <ItemList items={items} onDelete={deleteItem} />}
    </main>
  )
}
