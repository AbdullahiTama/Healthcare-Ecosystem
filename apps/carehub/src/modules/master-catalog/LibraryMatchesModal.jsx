import { useCallback, useEffect, useState } from 'react'
import { ArrowRight } from 'lucide-react'
import { theme } from '../../styles/theme'
import { Modal, GhostBtn, TealBtn, Loading, ErrorState } from '../../components/ui'
import { libraryRepository } from '../product-library/repositories'
import { libraryLabel, libraryFacts, libraryError } from '../product-library/libraryRules'
import { rxStatus, rxRank } from './catalogueRules'

const { navy, gray500, gray600, border, tealDeep, warning } = theme
const PAGE = 50

// Items of this business that match a CareHub library item (by barcode, then by name and strength), for the owner to
// confirm. Linking fills an item's empty details from the library and raises its prescription status to the library's
// where it is lower, at every location. The item keeps its own name and prices.
export default function LibraryMatchesModal({ show, businessId, repository = libraryRepository, onLinked, onClose }) {
  const [state, setState] = useState({ status: 'loading', matches: [], total: 0 })
  const [chosen, setChosen] = useState(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setState((s) => ({ ...s, status: 'loading' }))
    try {
      const r = await repository.linkMatches(businessId, { offset: 0, limit: PAGE })
      setState({ status: 'ready', matches: r.matches, total: r.total })
      setChosen(new Set(r.matches.map((m) => m.master.id)))
    } catch (e) { console.error('[master-catalog] library matches:', e); setState((s) => ({ ...s, status: 'error' })) }
  }, [repository, businessId])
  useEffect(() => { if (show) { setError(''); load() } }, [show, load])

  async function link() {
    const links = state.matches.filter((m) => chosen.has(m.master.id)).map((m) => ({ master_product_id: m.master.id, catalog_item_id: m.library.id }))
    if (!links.length) { setError('Tick the items to link.'); return }
    setBusy(true); setError('')
    try {
      const n = await repository.link(businessId, links)
      onLinked(n)
      if (state.total > state.matches.length) load(); else onClose()
    } catch (e) { console.error('[master-catalog] link:', e); setError(libraryError(e, 'Could not link the items. Check your connection and try again.')) }
    setBusy(false)
  }

  const toggle = (id, on) => setChosen((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n })
  const all = state.matches.length > 0 && state.matches.every((m) => chosen.has(m.master.id))

  return (
    <Modal show={show} onClose={onClose} title='Link items to the CareHub library' wide
      footer={<><GhostBtn onClick={onClose} style={{ flex: 1, padding: '12px' }}>Close</GhostBtn>
        <TealBtn onClick={link} disabled={busy || state.status !== 'ready' || !chosen.size} style={{ flex: 1, padding: '12px' }}>{busy ? 'Linking…' : `Link ${chosen.size} item${chosen.size === 1 ? '' : 's'}`}</TealBtn></>}>
      {state.status === 'loading' && !state.matches.length ? <Loading text='Finding matches…' />
        : state.status === 'error' ? <ErrorState message="We couldn't load the matches. Check your connection and try again." onRetry={load} />
        : !state.matches.length ? <div style={{ padding: '24px 8px', textAlign: 'center', color: gray500, fontSize: '13px' }}>No more matches. Items you add later can be linked from their Library button.</div>
        : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <p style={{ margin: 0, fontSize: '12.5px', color: gray600 }}>
              Linking keeps your names and prices. Empty details (generic name, strength, form, barcode) are filled in from the library, and an item’s prescription status is raised to the library’s if yours is lower.
              {state.total > state.matches.length ? ` Showing the first ${state.matches.length} of ${state.total.toLocaleString()} matches.` : ''}
            </p>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '12.5px', color: gray600, cursor: 'pointer', width: 'fit-content' }}>
              <input type='checkbox' checked={all} onChange={(e) => setChosen(e.target.checked ? new Set(state.matches.map((m) => m.master.id)) : new Set())} style={{ width: 18, height: 18, accentColor: tealDeep }} />
              Select all
            </label>
            <ul aria-label='Library matches' aria-busy={state.status === 'loading'} style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6, maxHeight: '50vh', overflowY: 'auto' }}>
              {state.matches.map((m) => {
                const before = rxStatus(m.master.rx_status)
                const after = rxStatus(m.library.rx_status)
                const raised = after && before && rxRank(after.value) > rxRank(before.value)
                return (
                  <li key={m.master.id} style={{ border: `1px solid ${border}`, borderRadius: theme.radius.md, padding: '10px 12px' }}>
                    <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer' }}>
                      <input type='checkbox' checked={chosen.has(m.master.id)} onChange={(e) => toggle(m.master.id, e.target.checked)} aria-label={`Link ${m.master.name}`}
                        style={{ width: 18, height: 18, marginTop: 2, accentColor: tealDeep, flexShrink: 0 }} />
                      <span style={{ flex: 1, minWidth: 0, fontSize: '13px' }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', color: navy, fontWeight: 700 }}>
                          {m.master.name} <ArrowRight size={13} aria-label='matches' /> {libraryLabel(m.library)}
                        </span>
                        <span style={{ display: 'block', fontSize: '11.5px', color: gray500, marginTop: 2 }}>
                          {m.match_by === 'barcode' ? `Same barcode${m.master.barcode ? ` (${m.master.barcode})` : ''}` : 'Same name and strength'}
                          {libraryFacts(m.library) ? ` · ${libraryFacts(m.library)}` : ''}
                        </span>
                        {raised && <span style={{ display: 'block', fontSize: '11.5px', color: warning, marginTop: 2, fontWeight: 600 }}>Becomes {after.label} (now {before.label})</span>}
                      </span>
                    </label>
                  </li>
                )
              })}
            </ul>
            {error && <div role='alert' style={{ fontSize: '13px', color: theme.danger }}>{error}</div>}
          </div>
        )}
    </Modal>
  )
}
