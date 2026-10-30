import { useEffect, useId, useState } from 'react'
import { Search, BadgeCheck } from 'lucide-react'
import { theme } from '../../styles/theme'
import { Pill } from '../../components/ui'
import { libraryRepository } from './repositories'
import { libraryLabel, libraryFacts, rxStatus } from './libraryRules'

const { navy, gray500, border, tealDeep, tealMist } = theme

// Searches the approved CareHub library by name, generic name or barcode and lets the user pick an item. Used to add
// a product from the library, link an item, merge two library items, and link a suggestion. `exclude` hides one id.
export default function LibrarySearch({ label = 'Find in the CareHub library', placeholder = 'Name, generic name or barcode', onPick, exclude = null, search = libraryRepository.search, autoFocus = false }) {
  const id = useId()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [state, setState] = useState('idle') // idle | searching | done | error

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) { setResults([]); setState('idle'); return undefined }
    let alive = true
    setState('searching')
    const t = setTimeout(async () => {
      try {
        const rows = await search(q, 20)
        if (alive) { setResults((rows || []).filter((r) => r.id !== exclude)); setState('done') }
      } catch (e) {
        console.error('[library] search failed:', e)
        if (alive) { setResults([]); setState('error') }
      }
    }, 250)
    return () => { alive = false; clearTimeout(t) }
  }, [query, exclude, search])

  return (
    <div>
      <label htmlFor={`${id}-q`} style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: navy, marginBottom: 6 }}>{label}</label>
      <div style={{ position: 'relative' }}>
        <Search size={15} aria-hidden='true' style={{ position: 'absolute', left: 12, top: 13, color: gray500 }} />
        <input id={`${id}-q`} type='search' value={query} onChange={(e) => setQuery(e.target.value)} placeholder={placeholder} autoFocus={autoFocus}
          aria-controls={`${id}-results`} autoComplete='off'
          style={{ width: '100%', boxSizing: 'border-box', padding: '11px 12px 11px 34px', borderRadius: theme.radius.md, border: `1px solid ${border}`, fontSize: '14px' }} />
      </div>
      {state !== 'idle' && (
        <ul id={`${id}-results`} aria-label='Library results' aria-busy={state === 'searching'}
          style={{ listStyle: 'none', margin: '8px 0 0', padding: 0, maxHeight: 220, overflowY: 'auto', border: `1px solid ${border}`, borderRadius: theme.radius.md }}>
          {results.map((item) => {
            const rx = rxStatus(item.rx_status)
            return (
              <li key={item.id}>
                <button type='button' onClick={() => onPick(item)}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', minHeight: 44, border: 'none', borderBottom: `1px solid ${border}`, background: 'white', cursor: 'pointer', textAlign: 'left' }}>
                  <BadgeCheck size={16} aria-hidden='true' style={{ color: tealDeep, flexShrink: 0 }} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: navy }}>{libraryLabel(item)}</span>
                    {libraryFacts(item) && <span style={{ display: 'block', fontSize: '11.5px', color: gray500 }}>{libraryFacts(item)}</span>}
                  </span>
                  {rx && <Pill label={rx.label} type={rx.pill} />}
                </button>
              </li>
            )
          })}
          {state === 'searching' && !results.length && <li style={{ padding: 12, fontSize: '13px', color: gray500 }}>Searching…</li>}
          {state === 'done' && !results.length && <li style={{ padding: 12, fontSize: '13px', color: gray500 }}>Nothing in the library matches “{query.trim()}”.</li>}
          {state === 'error' && <li role='alert' style={{ padding: 12, fontSize: '13px', color: theme.danger, background: tealMist }}>The library search failed. Check your connection and try again.</li>}
        </ul>
      )}
    </div>
  )
}
