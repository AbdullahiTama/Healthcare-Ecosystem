import { useCallback, useEffect, useState } from 'react'
import { theme } from '../../styles/theme'
import { Modal, GhostBtn, TealBtn, Sel, Loading, ErrorState } from '../../components/ui'
import { refusalMessage } from '../../lib/dbErrors'
import { masterCatalogRepository } from './repositories'
import { suggestionReason, fixesSummary } from './catalogueRules'

const { navy, gray500, gray600, border, tealDeep } = theme
const PAGE = 100
const TABS = [{ kind: 'category', label: 'Categories' }, { kind: 'price', label: 'Prices' }]
const log = (what, e) => console.error(`[master-catalog] suggestions ${what}:`, e)

// Suggested fixes (carehub_20270205): a category for items still in "Other medicines", and a price for unpriced items.
// Every suggestion starts ticked and can be changed before it is applied; nothing changes until the owner applies.
// Prices can also be given to the locations that follow the catalogue price and have none, which brings them back on
// CareFind. "Don't suggest these" hides the ticked ones for good. The database checks the owner or a manager and only
// fixes items that still have the problem.
export default function SuggestionsModal({ show, businessId, categories = [], initialKind = 'category', repository = masterCatalogRepository, onChanged, onClose }) {
  const [kind, setKind] = useState(initialKind)
  const [state, setState] = useState({ status: 'loading', list: [], total: 0, available: true })
  const [picked, setPicked] = useState({}) // item id -> { on, value }
  const [push, setPush] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState({ text: '', error: false })

  const load = useCallback(async () => {
    setState((s) => ({ ...s, status: 'loading' }))
    try {
      const r = await repository.suggestions(businessId, kind, { offset: 0, limit: PAGE })
      setState({ status: 'ready', list: r.suggestions, total: r.total, available: r.available })
      setPicked(Object.fromEntries(r.suggestions.map((s) => [s.item.id, { on: true, value: s.value }])))
    } catch (e) { log('load', e); setState((s) => ({ ...s, status: 'error' })) }
  }, [repository, businessId, kind])
  useEffect(() => { if (show) load() }, [show, load])
  useEffect(() => { if (show) { setKind(initialKind); setMessage({ text: '', error: false }) } }, [show, initialKind])

  const chosen = state.list.filter((s) => picked[s.item.id]?.on)
  const set = (id, patch) => setPicked((p) => ({ ...p, [id]: { ...p[id], ...patch } }))
  const all = state.list.length > 0 && chosen.length === state.list.length

  async function act(fn, done) {
    setBusy(true)
    try {
      setMessage({ text: done(await fn()), error: false })
      onChanged?.()
      await load()
    } catch (e) {
      log('action', e)
      setMessage({ text: refusalMessage(e, 'That did not work. Check your connection and try again.'), error: true })
    }
    setBusy(false)
  }
  function apply() {
    const fixes = chosen.map((s) => {
      const value = picked[s.item.id].value
      return kind === 'price' ? { id: s.item.id, default_price: Number(value) } : { id: s.item.id, category_code: value }
    })
    if (kind === 'price' && fixes.some((f) => !(f.default_price > 0))) {
      setMessage({ text: 'Every ticked price must be above zero.', error: true })
      return
    }
    act(() => repository.applyFixes(businessId, fixes, push), fixesSummary)
  }
  const dismiss = () => act(() => repository.dismissSuggestions(businessId, chosen.map((s) => s.item.id), kind),
    (n) => `${n} suggestion${n === 1 ? '' : 's'} hidden. ${kind === 'price' ? 'Set those prices' : 'Choose those categories'} yourself when you are ready.`)

  const categoryOptions = categories.filter((c) => c.code !== 'medicines_other').map((c) => ({ value: c.code, label: c.label }))
  const noun = kind === 'price' ? 'price' : 'category'

  return (
    <Modal show={show} onClose={onClose} title='Suggested fixes' wide
      footer={<>
        <GhostBtn onClick={onClose} style={{ flex: 1, padding: '12px' }}>Close</GhostBtn>
        <GhostBtn onClick={dismiss} disabled={busy || !chosen.length} style={{ flex: 1, padding: '12px' }}>Don’t suggest these</GhostBtn>
        <TealBtn onClick={apply} disabled={busy || !chosen.length} style={{ flex: 1, padding: '12px' }}>{busy ? 'Applying…' : `Apply ${chosen.length}`}</TealBtn>
      </>}>
      <div role='tablist' aria-label='What to fix' style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        {TABS.map((t) => (
          <button key={t.kind} type='button' role='tab' aria-selected={kind === t.kind} onClick={() => { setKind(t.kind); setMessage({ text: '', error: false }) }}
            style={{ minHeight: 36, padding: '6px 14px', borderRadius: 999, cursor: 'pointer', fontSize: '13px', fontWeight: 700,
              border: `1px solid ${kind === t.kind ? tealDeep : border}`, background: kind === t.kind ? theme.tealMist : 'white', color: navy }}>{t.label}</button>
        ))}
      </div>
      {message.text && (
        <div role={message.error ? 'alert' : 'status'} style={{ marginBottom: 10, padding: '10px 12px', borderRadius: theme.radius.md, fontSize: '13px',
          color: message.error ? theme.danger : theme.success, background: message.error ? theme.dangerBg : theme.successBg }}>{message.text}</div>
      )}
      {state.status === 'loading' && !state.list.length ? <Loading text='Finding suggestions…' />
        : state.status === 'error' ? <ErrorState message="We couldn't load the suggestions. Check your connection and try again." onRetry={load} />
        : !state.available ? <div style={{ padding: '24px 8px', textAlign: 'center', color: gray500, fontSize: '13px' }}>Suggestions appear once the catalogue update is installed on the database.</div>
        : !state.list.length ? <div style={{ padding: '24px 8px', textAlign: 'center', color: gray500, fontSize: '13px' }}>No {noun} suggestions right now. Items we cannot place need a {noun} from you.</div>
        : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <p style={{ margin: 0, fontSize: '12.5px', color: gray600 }}>
              {kind === 'price'
                ? 'Check each price before applying. Prices from other pharmacies are the middle price of at least three, never one pharmacy’s own.'
                : 'Check each category before applying. Prescription status does not change.'}
              {state.total > state.list.length ? ` Showing ${state.list.length} of ${state.total.toLocaleString()}; the rest appear as you apply these.` : ''}
            </p>
            {kind === 'price' && (
              <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: '12.5px', color: navy, cursor: 'pointer' }}>
                <input type='checkbox' checked={push} onChange={(e) => setPush(e.target.checked)} style={{ width: 18, height: 18, accentColor: tealDeep, flexShrink: 0 }} />
                Also price the locations that follow the catalogue price and have none. They show on CareFind again.
              </label>
            )}
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '12.5px', color: gray600, cursor: 'pointer', width: 'fit-content' }}>
              <input type='checkbox' checked={all} onChange={(e) => setPicked((p) => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, { ...v, on: e.target.checked }])))}
                style={{ width: 18, height: 18, accentColor: tealDeep }} />
              Select all ({chosen.length} of {state.list.length} ticked)
            </label>
            <ul aria-label={`${noun} suggestions`} aria-busy={state.status === 'loading' || busy}
              style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6, maxHeight: '50vh', overflowY: 'auto' }}>
              {state.list.map((s) => {
                const p = picked[s.item.id] || {}
                return (
                  <li key={s.item.id} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', border: `1px solid ${border}`, borderRadius: theme.radius.md, padding: '8px 12px' }}>
                    <input type='checkbox' checked={!!p.on} onChange={(e) => set(s.item.id, { on: e.target.checked })} aria-label={`Fix ${s.item.name}`}
                      style={{ width: 18, height: 18, accentColor: tealDeep, flexShrink: 0 }} />
                    <span style={{ flex: '1 1 200px', minWidth: 0, fontSize: '13px' }}>
                      <span style={{ display: 'block', fontWeight: 700, color: navy, overflowWrap: 'anywhere' }}>{s.item.name}</span>
                      <span style={{ display: 'block', fontSize: '11.5px', color: gray500 }}>
                        {suggestionReason(kind, s.reason, s.detail)}
                        {kind === 'price' && Number(s.item.hidden) > 0 ? ` · hidden on CareFind at ${s.item.hidden} location${Number(s.item.hidden) === 1 ? '' : 's'}` : ''}
                      </span>
                    </span>
                    <span style={{ flex: '0 1 220px', minWidth: 140 }}>
                      {kind === 'price' ? (
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '13px' }}>
                          <span aria-hidden='true'>₦</span>
                          <input type='number' inputMode='numeric' min='1' value={p.value ?? ''} aria-label={`Price for ${s.item.name}`}
                            onChange={(e) => set(s.item.id, { value: e.target.value, on: true })}
                            style={{ width: '100%', padding: '8px 10px', borderRadius: theme.radius.md, border: `1px solid ${border}`, fontSize: '13px' }} />
                        </label>
                      ) : (
                        <Sel id={`sugg-${s.item.id}`} aria-label={`Category for ${s.item.name}`} value={p.value || ''} options={categoryOptions}
                          onChange={(v) => set(s.item.id, { value: v, on: true })} />
                      )}
                    </span>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
    </Modal>
  )
}
