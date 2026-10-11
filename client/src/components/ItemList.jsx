import ItemCard from './ItemCard.jsx'

export default function ItemList({ items, onDelete }) {
  if (items.length === 0) {
    return <p className="muted">Your vault is empty.</p>
  }

  return (
    <ul className="list">
      {items.map((item) => (
        <ItemCard key={item.id} item={item} onDelete={onDelete} />
      ))}
    </ul>
  )
}
