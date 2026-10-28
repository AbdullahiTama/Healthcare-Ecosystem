import { useEffect, useState } from 'react'
import { Search, X } from 'lucide-react'
import { theme } from '../../styles/theme'
import { Modal, Sel, Inp, GhostBtn, TealBtn } from '../../components/ui'
import { transferRepository } from './repositories'
import { checkSendLines, locationName } from './transferRules'

const { navy, gray500, border, danger, tealDeep, tealMist } = theme

// Send stock from this location to another location of the business. Items are this location's products that are
// linked to the master catalogue and in stock; the quantity cannot exceed what is here. The stock leaves this location
// when the transfer is sent, and arrives when the other location receives it.
export default function NewTransferModal({ show, fromLocation, locations, sending, onSend, onClose }) {
  const [toId, setToId] = useState('')
  const [search, setSearch] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [lines, setLines] = useState([])
  const [note, setNote] = useState('')
  const [error, setError] = useState('')

  useEffect(() => { if (show) { setToId(''); setSearch(''); setResults([]); setLines([]); setNote(''); setError('') } }, [show])

  // Search this location's stock, after a pause in typing.
  useEffect(() => {
    if (!show || !fromLocation?.id) return undefined
    let alive = true
    const t = setTimeout(async () => {
      setSearching(true)
      try {
        const rows = await transferRepository.sendable(fromLocation.id, search)
        if (alive) setResults(rows || [])
      } catch (e) {
        console.error('[transfers] item search failed:', e)
        if (alive) setResults([])
      }
      if (alive) setSearching(false)
    }, 250)
    return () => { alive = false; clearTimeout(t) }
  }, [search, show, fromLocation?.id])

  const others = locations.filter((l) => l.id !== fromLocation?.id)
  const add = (p) => {
    if (lines.some((l) => l.master_product_id === p.master_product_id)) return
    setLines((ls) => [...ls, { master_product_id: p.master_product_id, name: p.name, stock: p.stock, qty: '' }])
  }
  const setQty = (id, qty) => setLines((ls) => ls.map((l) => (l.master_product_id === id ? { ...l, qty } : l)))
  const remove = (id) => setLines((ls) => ls.filter((l) => l.master_product_id !== id))

  function submit() {
    if (!toId) { setError('Choose where the stock is going.'); return }
    const problem = checkSendLines(lines)
    if (problem) { setError(problem); return }
    setError('')
    onSend(toId, lines.map((l) => ({ ...l, qty: Number(l.qty) })), note)
  }

  return (
    <Modal show={show} onClose={onClose} title={`Send stock from ${locationName(fromLocation)}`} wide
      footer={<><GhostBtn onClick={onClose} style={{ flex: 1, padding: '12px' }}>Cancel</GhostBtn>
        <TealBtn onClick={submit} disabled={sending} style={{ flex: 1, padding: '12px' }}>{sending ? 'Sending…' : `Send ${lines.length || ''} item${lines.length === 1 ? '' : 's'}`}</TealBtn></>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <Sel id='transfer-to' label='Send to' value={toId} onChange={setToId} placeholder={others.length ? 'Choose a location…' : 'No other locations'}
          options={others.map((l) => ({ value: l.id, label: locationName(l) }))} required />

        <div>
          <label htmlFor='transfer-search' style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: navy, marginBottom: 6 }}>Add items</label>
          <div style={{ position: 'relative' }}>
            <Search size={15} aria-hidden='true' style={{ position: 'absolute', left: 12, top: 13, color: gray500 }} />
            <input id='transfer-search' type='search' value={search} onChange={(e) => setSearch(e.target.value)} placeholder='Search this location’s stock'
              style={{ width: '100%', boxSizing: 'border-box', padding: '11px 12px 11px 34px', borderRadius: theme.radius.md, border: `1px solid ${border}`, fontSize: '14px' }} />
          </div>
          <ul aria-label='Items you can send' aria-busy={searching} style={{ listStyle: 'none', margin: '8px 0 0', padding: 0, maxHeight: 180, overflowY: 'auto', border: `1px solid ${border}`, borderRadius: theme.radius.md }}>
            {results.map((p) => {
              const added = lines.some((l) => l.master_product_id === p.master_product_id)
              return (
                <li key={p.id}>
                  <button type='button' onClick={() => add(p)} disabled={added}
                    style={{ width: '100%', display: 'flex', justifyContent: 'space-between', gap: 8, padding: '10px 12px', border: 'none', borderBottom: `1px solid ${border}`, background: added ? tealMist : 'white', cursor: added ? 'default' : 'pointer', textAlign: 'left', fontSize: '13px', color: navy, minHeight: 44 }}>
                    <span>{p.name}</span><span style={{ color: gray500 }}>{added ? 'Added' : `${p.stock} in stock`}</span>
                  </button>
                </li>
              )
            })}
            {!searching && results.length === 0 && (
              <li style={{ padding: '12px', fontSize: '13px', color: gray500 }}>
                {search ? 'No items in stock match your search.' : 'No items in stock here are linked to the master catalogue.'}
              </li>
            )}
          </ul>
        </div>

        {lines.length > 0 && (
          <div role='group' aria-label='Items to send' style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {lines.map((l) => (
              <div key={l.master_product_id} style={{ display: 'flex', alignItems: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 180px', fontSize: '13px', fontWeight: 600, color: navy, paddingBottom: 12 }}>
                  {l.name} <span style={{ fontWeight: 400, color: gray500 }}>({l.stock} here)</span>
                </div>
                <Inp id={`qty-${l.master_product_id}`} label='Quantity' type='number' min='1' value={l.qty} onChange={(v) => setQty(l.master_product_id, v)} style={{ width: 110 }} />
                <button type='button' onClick={() => remove(l.master_product_id)} aria-label={`Remove ${l.name}`}
                  style={{ width: 44, height: 44, border: `1px solid ${border}`, borderRadius: theme.radius.md, background: 'white', cursor: 'pointer', color: gray500, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <X size={16} aria-hidden='true' />
                </button>
              </div>
            ))}
          </div>
        )}

        <Inp id='transfer-note' label='Note (optional)' value={note} onChange={setNote} placeholder='e.g. Weekly top-up, sent with Musa' />
        <div style={{ fontSize: '12px', color: tealDeep }}>The stock leaves {locationName(fromLocation)} when you send it, and is added at the other location when it is received there.</div>
        {error && <div role='alert' style={{ fontSize: '13px', color: danger }}>{error}</div>}
      </div>
    </Modal>
  )
}
