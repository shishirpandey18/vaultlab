import { useState } from 'react'

// One vault item. Props come from the parent; "revealed" is this card's own state.
export default function ItemCard({ item, onDelete }) {
  const [revealed, setRevealed] = useState(false)

  return (
    <li className="card">
      <div>
        <strong>{item.title}</strong>
        <div className="muted">{item.username ?? 'no username'}</div>
      </div>
      <code className="secret">
        {item.password ? (revealed ? item.password : '••••••••') : 'no password stored'}
      </code>
      <div className="actions">
        {item.password && (
          <button onClick={() => setRevealed(!revealed)}>{revealed ? 'Hide' : 'Show'}</button>
        )}
        <button onClick={() => onDelete(item.id)}>Delete</button>
      </div>
    </li>
  )
}
