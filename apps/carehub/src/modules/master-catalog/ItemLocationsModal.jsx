import { useEffect, useState } from 'react'
import { fmt } from '../../lib/utils'
import { theme } from '../../styles/theme'
import { Modal, Inp, GhostBtn, TealBtn } from '../../components/ui'
import { carryingByLocation, locationName, parseBranchPrice } from './catalogueRules'

const { navy, gray500, border, bg, warning } = theme

// One item at every location: whether it is carried, its price there (master or the location's own) and stock.
// Each location can start or stop carrying it, or set its own price.
export default function ItemLocationsModal({ item, locations, busy, onCarry, onStop, onClose }) {
  const [prices, setPrices] = useState({})
  const [errors, setErrors] = useState({})
  useEffect(() => { setPrices({}); setErrors({}) }, [item?.id])
  if (!item) return null

  const rows = carryingByLocation(item, locations)
  function savePrice(locId) {
    const p = parseBranchPrice(prices[locId])
    if (p == null) { setErrors((e) => ({ ...e, [locId]: 'Enter a price.' })); return }
    if (typeof p === 'object') { setErrors((e) => ({ ...e, [locId]: p.error })); return }
    setErrors((e) => ({ ...e, [locId]: '' }))
    onCarry(locId, p)
  }

  return (
    <Modal show onClose={onClose} title={`${item.name} at each location`}
      footer={<GhostBtn onClick={onClose} style={{ flex: 1, padding: '12px' }}>Done</GhostBtn>}>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {rows.map((r) => {
          const id = r.location.id
          const name = locationName(r.location)
          return (
            <li key={id} style={{ padding: '12px', borderRadius: theme.radius.md, border: `1px solid ${border}`, background: bg }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 160px', minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: '13px', color: navy }}>{name}</div>
                  <div style={{ fontSize: '12px', color: gray500, marginTop: 2 }}>
                    {r.carried ? `${fmt(r.price)} ${r.ownPrice ? '(own price)' : '(master price)'} · ${r.stock} in stock`
                      : r.stopped ? `Stopped · ${r.stock} still in stock` : 'Not carried'}
                    {r.products > 1 && <span style={{ color: warning }}> · {r.products} entries for this item</span>}
                  </div>
                </div>
                {r.carried
                  ? <GhostBtn onClick={() => onStop(id)} disabled={busy} aria-label={`Stop carrying at ${name}`}>Stop carrying</GhostBtn>
                  : <TealBtn onClick={() => onCarry(id, null)} disabled={busy} aria-label={`Carry at ${name}`} style={{ padding: '8px 14px', fontSize: '12px' }}>{r.stopped ? 'Carry again' : 'Carry'}</TealBtn>}
              </div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', marginTop: '10px', flexWrap: 'wrap' }}>
                <Inp id={`price-${id}`} label={`Own price at ${name} (₦)`} type='number' min='0' value={prices[id] || ''}
                  onChange={(v) => setPrices((p) => ({ ...p, [id]: v }))} placeholder={String(item.default_price ?? '')} error={errors[id]} style={{ flex: '1 1 140px' }} />
                <GhostBtn onClick={() => savePrice(id)} disabled={busy} aria-label={`Save price at ${name}`} style={{ marginBottom: errors[id] ? 22 : 0 }}>Set price</GhostBtn>
              </div>
            </li>
          )
        })}
      </ul>
    </Modal>
  )
}
