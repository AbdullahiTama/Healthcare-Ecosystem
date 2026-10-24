import { useState, useEffect } from 'react'
import { theme } from '../../../styles/theme'
import { suggestionRepository } from './repository.js'

const { navy, gray500, gray400, border, success, warning } = theme

const STATUS = {
  pending: { text: 'Waiting for review', color: gray500 },
  accepted: { text: 'Added to the directory', color: success },
  rejected: { text: 'Not added', color: warning },
}

// "Your suggestions": what happened to each business this person suggested. Extra information, so it stays out of
// the way: nothing is shown when there are none, before the feature exists, or if they cannot be loaded.
export default function SuggestionsList({ email, repo = suggestionRepository }) {
  const [rows, setRows] = useState([])

  useEffect(() => {
    let alive = true
    setRows([])
    repo.listMine(email).then((r) => { if (alive) setRows(r || []) }).catch(() => {})
    return () => { alive = false }
  }, [email, repo])

  if (rows.length === 0) return null
  return (
    <section aria-labelledby='your-suggestions-h' style={{ marginTop: '20px' }}>
      <h3 id='your-suggestions-h' style={{ margin: '0 0 8px', fontSize: '12px', fontWeight: 800, color: gray400, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Your suggestions</h3>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {rows.map((s) => {
          const st = STATUS[s.status] || STATUS.pending
          return (
            <li key={s.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap', padding: '8px 0', borderBottom: '1px solid ' + border, fontSize: '12.5px' }}>
              <span style={{ fontWeight: 700, color: navy }}>{s.name}</span>
              <span style={{ color: st.color }}>{st.text}{s.status === 'rejected' && s.review_note ? ': ' + s.review_note : ''}</span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
