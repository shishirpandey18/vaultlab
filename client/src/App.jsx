import { useEffect, useState } from 'react'
import AddItemForm from './components/AddItemForm.jsx'
import ItemList from './components/ItemList.jsx'

export default function App() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Runs after the first render: load the items from the API once
  useEffect(() => {
    async function loadItems() {
      try {
        const res = await fetch('/api/items')
        const type = res.headers.get('content-type') || ''
        if (!res.ok || !type.includes('application/json')) {
          throw new Error(`${res.status} ${res.statusText}, ${type || 'no content type'}`)
        }
        setItems(await res.json())
      } catch (err) {
        console.error('Could not load items:', err)
        setError(`Could not load your vault (${err.message}).`)
      } finally {
        setLoading(false)
      }
    }
    loadItems()
  }, [])

  function addItem(newItem) {
    // Never change state in place: make a NEW array with the new item at the end
    setItems((current) => [...current, { ...newItem, id: crypto.randomUUID() }])
  }

  function deleteItem(id) {
    setItems((current) => current.filter((item) => item.id !== id))
  }

  return (
    <main className="app">
      <h1>VaultLab</h1>
      <p className="muted">{items.length} items</p>
      <AddItemForm onAdd={addItem} />
      {loading && <p>Loading your vault...</p>}
      {error && <p className="error">{error}</p>}
      {!loading && !error && <ItemList items={items} onDelete={deleteItem} />}
    </main>
  )
}
