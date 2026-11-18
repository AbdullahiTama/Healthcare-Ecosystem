import { useCallback, useEffect, useState } from 'react'
import { theme } from '../../styles/theme'
import { Modal, GhostBtn, TealBtn, Loading, ErrorState } from '../../components/ui'
import { refusalMessage } from '../../lib/dbErrors'
import { masterCatalogRepository } from './repositories'
import { duplicateReason, mergeSummary, rxStatus } from './catalogueRules'

const { navy, gray500, gray600, border, tealDeep, tealMist } = theme
const PAGE = 20
const log = (what, e) => console.error(`[master-catalog] duplicates ${what}:`, e)
const pairId = (p) => `${p.a.id}|${p.b.id}`

// The side kept by default: the one at more locations, then with more stock, then linked to the library.
export function defaultKeep(pair) {
  const rank = (s) => [Number(s.locations) || 0, Number(s.stock) || 0, s.catalog_item_id ? 1 : 0]
  const [a, b] = [rank(pair.a), rank(pair.b)]
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i] ? pair.a.id : pair.b.id
  return pair.a.id
}

function Side({ side, pair, keep, onKeep, categoryLabel }) {
  const rx = rxStatus(side.rx_status)
  const facts = [side.generic_name, side.strength, side.barcode && `Barcode ${side.barcode}`, categoryLabel(side.category_code), rx?.label].filter(Boolean)
  const chosen = keep === side.id
  return (
    <label style={{ flex: '1 1 220px', minWidth: 0, display: 'flex', gap: 10, padding: '10px 12px', borderRadius: theme.radius.md, cursor: 'pointer',
      border: `1px solid ${chosen ? tealDeep : border}`, background: chosen ? tealMist : 'white' }}>
      <input type='radio' name={`keep-${pairId(pair)}`} checked={chosen} onChange={() => onKeep(side.id)} aria-label={`Keep ${side.name}`}
        style={{ width: 18, height: 18, marginTop: 2, accentColor: tealDeep, flexShrink: 0 }} />
      <span style={{ fontSize: '13px', minWidth: 0 }}>
        <span style={{ display: 'block', fontWeight: 700, color: navy, overflowWrap: 'anywhere' }}>{side.name}</span>
        <span style={{ display: 'block', fontSize: '11.5px', color: gray500, marginTop: 2 }}>{facts.join(' · ') || 'No details'}</span>
        <span style={{ display: 'block', fontSize: '11.5px', color: gray600, marginTop: 2 }}>
          {Number(side.default_price) > 0 ? `₦${Number(side.default_price).toLocaleString()}` : 'No price'} · {side.locations || 0} location{Number(side.locations) === 1 ? '' : 's'} · {Number(side.stock || 0).toLocaleString()} in stock
        </span>
        {chosen && <span style={{ display: 'block', fontSize: '11px', color: tealDeep, fontWeight: 700, marginTop: 4 }}>Kept</span>}
      </span>
    </label>
  )
}

// Possible duplicates in the catalogue (catalogue_duplicate_pairs), for the owner to merge or dismiss one pair at a
// time. Merging keeps the chosen item and archives the other: at a location carrying both, the other's stock and
// batches move to the kept product through the stock ledger and the other product is stopped (not deleted, so its
// sales and history stay); where only the other is carried, its product becomes the kept item. Managers can dismiss
// pairs but only the owner can merge (the database checks both).
export default function DuplicatesModal({ show, businessId, isOwner = true, categoryLabel = () => '', repository = masterCatalogRepository, onChanged, onClose }) {
  const [state, setState] = useState({ status: 'loading', pairs: [], total: 0 })
  const [keep, setKeep] = useState({})
  const [confirming, setConfirming] = useState(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState({ text: '', error: false })

  const load = useCallback(async () => {
    setState((s) => ({ ...s, status: 'loading' }))
    try {
      const r = await repository.duplicatePairs(businessId, { offset: 0, limit: PAGE })
      setState({ status: 'ready', pairs: r.pairs, total: r.total })
      setKeep(Object.fromEntries(r.pairs.map((p) => [pairId(p), defaultKeep(p)])))
    } catch (e) { log('load', e); setState((s) => ({ ...s, status: 'error' })) }
  }, [repository, businessId])
  useEffect(() => { if (show) { setMessage({ text: '', error: false }); setConfirming(null); load() } }, [show, load])

  async function act(fn, done) {
    setBusy(true)
    try {
      const text = done(await fn())
      setMessage({ text, error: false })
      setConfirming(null)
      onChanged?.()
      await load()
    } catch (e) {
      log('action', e)
      setMessage({ text: refusalMessage(e, 'That did not work. Check your connection and try again.'), error: true })
    }
    setBusy(false)
  }
  const merge = (pair) => {
    const keepId = keep[pairId(pair)]
    const [kept, dropped] = keepId === pair.a.id ? [pair.a, pair.b] : [pair.b, pair.a]
    return act(() => repository.merge(businessId, kept.id, dropped.id), (r) => mergeSummary(r, kept.name))
  }
  const dismiss = (pair) => act(() => repository.dismissPair(businessId, pair.a.id, pair.b.id),
    () => `${pair.a.name} and ${pair.b.name} will not be suggested again.`)

  return (
    <Modal show={show} onClose={onClose} title='Possible duplicates' wide
      footer={<GhostBtn onClick={onClose} style={{ flex: 1, padding: '12px' }}>Close</GhostBtn>}>
      {message.text && (
        <div role={message.error ? 'alert' : 'status'} style={{ marginBottom: 10, padding: '10px 12px', borderRadius: theme.radius.md, fontSize: '13px',
          color: message.error ? theme.danger : theme.success, background: message.error ? theme.dangerBg : theme.successBg }}>{message.text}</div>
      )}
      {state.status === 'loading' && !state.pairs.length ? <Loading text='Looking for duplicates…' />
        : state.status === 'error' ? <ErrorState message="We couldn't load the duplicates. Check your connection and try again." onRetry={load} />
        : !state.pairs.length ? <div style={{ padding: '24px 8px', textAlign: 'center', color: gray500, fontSize: '13px' }}>No possible duplicates. Well done.</div>
        : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <p style={{ margin: 0, fontSize: '12.5px', color: gray600 }}>
              Choose the item to keep. Merging moves the other’s stock into it where a location has both, and stops the other there; its past sales stay as they were.
              {state.total > state.pairs.length ? ` Showing ${state.pairs.length} of ${state.total.toLocaleString()} pairs.` : ''}
            </p>
            <ul aria-label='Possible duplicates' aria-busy={state.status === 'loading' || busy} style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10, maxHeight: '55vh', overflowY: 'auto' }}>
              {state.pairs.map((pair) => {
                const id = pairId(pair)
                const keepId = keep[id]
                const dropped = keepId === pair.a.id ? pair.b : pair.a
                const kept = keepId === pair.a.id ? pair.a : pair.b
                return (
                  <li key={id} style={{ border: `1px solid ${border}`, borderRadius: theme.radius.md, padding: '10px 12px' }}>
                    <div style={{ fontSize: '11.5px', fontWeight: 700, color: gray600, marginBottom: 8 }}>{duplicateReason(pair.reason)}</div>
                    <fieldset style={{ border: 0, margin: 0, padding: 0, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <legend style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Which item to keep</legend>
                      {[pair.a, pair.b].map((side) => (
                        <Side key={side.id} side={side} pair={pair} keep={keepId} categoryLabel={categoryLabel}
                          onKeep={(sid) => { setKeep((k) => ({ ...k, [id]: sid })); setConfirming(null) }} />
                      ))}
                    </fieldset>
                    {confirming === id ? (
                      <div role='group' aria-label='Confirm merge' style={{ marginTop: 10, padding: '10px 12px', borderRadius: theme.radius.md, background: theme.warningBg, fontSize: '12.5px', color: navy }}>
                        Keep <strong>{kept.name}</strong> and archive <strong>{dropped.name}</strong>? This cannot be undone in one step: stock moves are recorded in the stock history.
                        <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                          <GhostBtn onClick={() => setConfirming(null)} disabled={busy}>Cancel</GhostBtn>
                          <TealBtn onClick={() => merge(pair)} disabled={busy} style={{ padding: '8px 14px', fontSize: '12px' }}>{busy ? 'Merging…' : 'Merge'}</TealBtn>
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        <GhostBtn onClick={() => dismiss(pair)} disabled={busy}>Not duplicates</GhostBtn>
                        {isOwner && <TealBtn onClick={() => setConfirming(id)} disabled={busy} style={{ padding: '8px 14px', fontSize: '12px' }}>Merge…</TealBtn>}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        )}
    </Modal>
  )
}
