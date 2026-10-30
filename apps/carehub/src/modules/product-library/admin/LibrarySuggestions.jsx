import { useCallback, useEffect, useState } from 'react'
import { Inbox } from 'lucide-react'
import { theme } from '../../../styles/theme'
import { Card, Pill, GhostBtn, TealBtn, RedBtn, Modal, Inp, Loading, Empty, ErrorState, useToast, Toast } from '../../../components/ui'
import { libraryRepository, PAGE_SIZE } from '../repositories'
import { libraryLabel, libraryFacts, rxStatus, libraryError } from '../libraryRules'
import LibraryItemForm from './LibraryItemForm'
import LibrarySearch from '../LibrarySearch'

const { navy, gray500, gray600, tealDeep, tealMist } = theme
const log = (what, e) => console.error(`[library] ${what}:`, e)
const when = (d) => (d ? new Date(d).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' }) : '')

// What businesses propose for the library, newest first (CareHub admins). Each one can be added as a new approved item
// (details editable first), linked to an item already in the library, or rejected with a reason. The business's item
// is linked on approval and its owner is told either way.
export default function LibrarySuggestions({ categories, repository = libraryRepository, onChanged }) {
  const { msg, type, show: showToast } = useToast()
  const [state, setState] = useState({ status: 'loading', suggestions: [], total: 0, available: true })
  const [offset, setOffset] = useState(0)
  const [adding, setAdding] = useState(null)
  const [linking, setLinking] = useState(null)
  const [rejecting, setRejecting] = useState(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setState((s) => ({ ...s, status: 'loading' }))
    try { setState({ status: 'ready', ...(await repository.suggestions({ status: 'pending', offset, limit: PAGE_SIZE })) }) } catch (e) { log('suggestions', e); setState((s) => ({ ...s, status: 'error' })) }
  }, [repository, offset])
  useEffect(() => { load() }, [load])

  async function decide(s, action, opts, done) {
    setBusy(true)
    try {
      await repository.decide(s.id, action, opts)
      done()
      showToast(action === 'reject' ? `${s.brand_name}: rejected. ${s.business_name || 'The business'} has been told.` : `${s.brand_name} is in the library and linked for ${s.business_name || 'the business'}.`, { type: 'success' })
      load(); onChanged?.()
    } catch (e) { log('decide', e); showToast(libraryError(e, 'That did not work. Please try again.'), { type: 'error', duration: 8000 }) }
    setBusy(false)
  }

  const pages = Math.max(1, Math.ceil(state.total / PAGE_SIZE))
  const page = Math.floor(offset / PAGE_SIZE) + 1

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {state.status === 'loading' && !state.suggestions.length ? <Loading text='Loading suggestions…' />
        : state.status === 'error' ? <ErrorState message="We couldn't load the suggestions. Check your connection and try again." onRetry={load} />
        : !state.available ? <Empty icon={<Inbox size={40} aria-hidden='true' />} title='The product library is not installed yet' description='Apply the shared product library database update, then reload.' />
        : !state.suggestions.length ? <Empty icon={<Inbox size={40} aria-hidden='true' />} title='No suggestions waiting' description='Businesses can suggest items from their Master Catalog.' />
        : (
          <ul aria-busy={state.status === 'loading'} aria-label='Suggestions' style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {state.suggestions.map((s) => {
              const rx = rxStatus(s.rx_status)
              return (
                <li key={s.id}>
                  <Card style={{ padding: '12px 14px' }}>
                    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                      <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: 800, fontSize: '14px', color: navy }}>{libraryLabel(s)}</span>
                          {rx && <Pill label={rx.label} type={rx.pill} />}
                        </div>
                        {libraryFacts(s) && <div style={{ fontSize: '12px', color: gray600, marginTop: 3 }}>{libraryFacts(s)}{s.barcode ? ` · Barcode ${s.barcode}` : ''}</div>}
                        <div style={{ fontSize: '11.5px', color: gray500, marginTop: 4 }}>
                          From {s.business_name || 'a business'}{s.suggested_by_email ? ` (${s.suggested_by_email})` : ''} · {when(s.created_at)}
                        </div>
                        {s.note && <div style={{ fontSize: '12.5px', color: gray600, marginTop: 6, fontStyle: 'italic' }}>“{s.note}”</div>}
                        {s.existing && (
                          <div role='note' style={{ fontSize: '12px', color: tealDeep, background: tealMist, padding: '6px 10px', borderRadius: theme.radius.md, marginTop: 8 }}>
                            Already in the library{s.existing.status === 'active' ? '' : ' (waiting for review)'}: <strong>{libraryLabel(s.existing)}</strong>. Link to it rather than adding a duplicate.
                          </div>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {s.existing?.status === 'active' && (
                          <TealBtn onClick={() => decide(s, 'link', { catalogItemId: s.existing.id }, () => {})} disabled={busy} style={{ padding: '8px 12px', fontSize: '12px' }}>Link to {libraryLabel(s.existing)}</TealBtn>
                        )}
                        {!s.existing && <TealBtn onClick={() => setAdding(s)} disabled={busy} style={{ padding: '8px 12px', fontSize: '12px' }}>Add to library…</TealBtn>}
                        <GhostBtn onClick={() => setLinking(s)} disabled={busy}>Link to another item…</GhostBtn>
                        <GhostBtn onClick={() => { setReason(''); setRejecting(s) }} disabled={busy}>Reject…</GhostBtn>
                      </div>
                    </div>
                  </Card>
                </li>
              )
            })}
          </ul>
        )}
      {pages > 1 && (
        <nav aria-label='Pages' style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
          <GhostBtn onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))} disabled={page <= 1}>Previous</GhostBtn>
          <span style={{ fontSize: '12.5px', color: gray600 }}>Page {page} of {pages}</span>
          <GhostBtn onClick={() => setOffset(offset + PAGE_SIZE)} disabled={page >= pages}>Next</GhostBtn>
        </nav>
      )}

      <LibraryItemForm show={!!adding} item={adding ? { ...adding, id: null } : null} categories={categories} saving={busy}
        title={`Add ${adding?.brand_name || ''} to the library`} saveLabel='Add and link'
        onSave={(fields) => decide(adding, 'create', { fields }, () => setAdding(null))} onClose={() => setAdding(null)} />

      <Modal show={!!linking} onClose={() => setLinking(null)} title={`Link ${linking?.brand_name || ''} to a library item`}
        footer={<GhostBtn onClick={() => setLinking(null)} style={{ flex: 1, padding: '12px' }}>Cancel</GhostBtn>}>
        <LibrarySearch autoFocus onPick={(item) => decide(linking, 'link', { catalogItemId: item.id }, () => setLinking(null))} />
      </Modal>

      <Modal show={!!rejecting} onClose={() => setRejecting(null)} title={`Reject ${rejecting?.brand_name || ''}?`}
        footer={<><GhostBtn onClick={() => setRejecting(null)} style={{ flex: 1, padding: '12px' }}>Cancel</GhostBtn>
          <RedBtn onClick={() => decide(rejecting, 'reject', { note: reason }, () => setRejecting(null))} disabled={busy} style={{ flex: 1, padding: '12px' }}>{busy ? 'Saving…' : 'Reject'}</RedBtn></>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: '13px', color: gray600 }}>The business keeps its item as it is. The owner is told, with your reason.</div>
          <Inp id='reject-reason' label='Reason' value={reason} onChange={setReason} placeholder='e.g. Please add the strength to the name' maxLength={500} />
        </div>
      </Modal>
      <Toast msg={msg} type={type} />
    </div>
  )
}
