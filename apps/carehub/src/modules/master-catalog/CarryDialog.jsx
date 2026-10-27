import { useEffect, useState } from 'react'
import { theme } from '../../styles/theme'
import { Modal, Inp, GhostBtn, TealBtn } from '../../components/ui'
import { locationName, parseBranchPrice } from './catalogueRules'

const { tealDeep, tealMist, navy, gray500, border } = theme

// Carry the selected items at one or more locations, in one call per location. A location without the item gets
// it at stock 0 (stock arrives by purchase or, later, by transfer). A price can be given only when one item is
// carried: it becomes that location's own price.
export default function CarryDialog({ show, items, locations, busy, onCarry, onClose }) {
  const [chosen, setChosen] = useState([])
  const [price, setPrice] = useState('')
  const [error, setError] = useState('')
  useEffect(() => { if (show) { setChosen([]); setPrice(''); setError('') } }, [show])

  const single = items.length === 1
  const toggle = (id, on) => setChosen((c) => (on ? [...c, id] : c.filter((x) => x !== id)))

  function submit() {
    if (!chosen.length) { setError('Choose at least one location.'); return }
    const p = single ? parseBranchPrice(price) : null
    if (p && typeof p === 'object') { setError(p.error); return }
    onCarry(chosen, p)
  }

  const title = single ? `Carry ${items[0]?.name}` : `Carry ${items.length} items`
  return (
    <Modal show={show} onClose={onClose} title={title}
      footer={<><GhostBtn onClick={onClose} style={{ flex: 1, padding: '12px' }}>Cancel</GhostBtn>
        <TealBtn onClick={submit} disabled={busy} style={{ flex: 1, padding: '12px' }}>{busy ? 'Carrying…' : 'Carry'}</TealBtn></>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div role='note' style={{ padding: '12px', borderRadius: theme.radius.md, background: tealMist, fontSize: '12px', color: tealDeep }}>
          Locations that do not have {single ? 'this item' : 'an item'} get it at stock 0, at the default price. Items a location stopped carrying start again. Nothing already in stock changes.
        </div>
        <fieldset style={{ border: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <legend style={{ fontSize: '13px', fontWeight: 700, color: navy, marginBottom: '6px' }}>Locations</legend>
          {locations.map((loc) => (
            <label key={loc.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', border: `1px solid ${border}`, borderRadius: theme.radius.md, cursor: 'pointer', minHeight: 44 }}>
              <input type='checkbox' checked={chosen.includes(loc.id)} onChange={(e) => toggle(loc.id, e.target.checked)} style={{ width: 18, height: 18, accentColor: tealDeep }} />
              <span style={{ fontSize: '13px', fontWeight: 600, color: navy }}>{locationName(loc)}</span>
              {loc.city && <span style={{ fontSize: '12px', color: gray500 }}>{loc.city}</span>}
            </label>
          ))}
          {!locations.length && <div style={{ fontSize: '13px', color: gray500 }}>No locations found.</div>}
        </fieldset>
        {single && (
          <Inp id='carry-price' label='Own price at these locations (₦)' type='number' min='0' value={price} onChange={setPrice}
            placeholder={`Leave empty for the default`} helperText='Empty: the location follows the master price and Push updates it.' />
        )}
        {error && <div role='alert' style={{ fontSize: '13px', color: theme.danger }}>{error}</div>}
      </div>
    </Modal>
  )
}
