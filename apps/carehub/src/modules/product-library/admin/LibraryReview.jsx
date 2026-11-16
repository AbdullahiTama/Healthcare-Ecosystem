import { useCallback, useEffect, useState } from 'react'
import { BookOpen, Search, Sparkles } from 'lucide-react'
import { theme } from '../../../styles/theme'
import { Card, Pill, GhostBtn, TealBtn, RedBtn, Loading, Empty, ErrorState, ConfirmDialog, useToast, Toast } from '../../../components/ui'
import { libraryRepository, PAGE_SIZE } from '../repositories'
import { LIBRARY_SOURCE, libraryLabel, libraryFacts, rxStatus, libraryError } from '../libraryRules'
import LibraryItemForm from './LibraryItemForm'

const { navy, gray500, gray600, border, tealDeep } = theme
const log = (what, e) => console.error(`[library] ${what}:`, e)

const VIEW = {
  pending: { empty: 'Nothing is waiting for review', emptyHint: 'Find new candidates from business catalogues, or import an official list.' },
  active: { empty: 'No approved items yet', emptyHint: 'Approve items from the review queue, or add one.' },
  retired: { empty: 'No retired items', emptyHint: 'Items you retire or merge appear here.' },
}

// The library by status, for CareHub admins: the review queue (pending), the approved library (active) or retired
// items. Approve, retire or reopen one item or a selection; edit, add and merge. Most widely used first.
export default function LibraryReview({ status, categories, repository = libraryRepository, onChanged }) {
  const { msg, type, show: showToast } = useToast()
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [source, setSource] = useState('')
  const [offset, setOffset] = useState(0)
  const [state, setState] = useState({ status: 'loading', items: [], total: 0, available: true })
  const [selected, setSelected] = useState(new Set())
  const [editing, setEditing] = useState(null) // null | {} (new) | item
  const [confirm, setConfirm] = useState(null) // { ids, action, label }
  const [busy, setBusy] = useState(false)

  useEffect(() => { const t = setTimeout(() => { setQuery(search.trim()); setOffset(0) }, 300); return () => clearTimeout(t) }, [search])
  useEffect(() => { setOffset(0); setSelected(new Set()) }, [status, source])

  const load = useCallback(async () => {
    setState((s) => ({ ...s, status: 'loading' }))
    try {
      const r = await repository.adminPage({ status, source: source || null, search: query, offset, limit: PAGE_SIZE })
      setState({ status: 'ready', ...r })
    } catch (e) { log('load', e); setState((s) => ({ ...s, status: 'error' })) }
  }, [repository, status, source, query, offset])
  useEffect(() => { load() }, [load])

  const label = (id) => libraryLabel(state.items.find((i) => i.id === id))
  const toggle = (id, on) => setSelected((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n })
  const allOnPage = state.items.length > 0 && state.items.every((i) => selected.has(i.id))

  async function run(fn, done) {
    setBusy(true)
    try { const r = await fn(); done(r); setSelected(new Set()); load(); onChanged?.() } catch (e) { log('action', e); showToast(libraryError(e, 'That did not work. Please try again.'), { type: 'error', duration: 8000 }) }
    setBusy(false)
  }

  const review = (ids, action) => run(() => repository.review(ids, action), (n) => {
    setConfirm(null)
    const what = action === 'approve' ? 'approved' : action === 'retire' ? 'retired' : 'back in the review queue'
    showToast(`${n} item${n === 1 ? '' : 's'} ${what}.`, { type: 'success' })
  })

  const ask = (ids, action) => {
    if (action !== 'retire') return review(ids, action)
    const linked = state.items.filter((i) => ids.includes(i.id)).reduce((s, i) => s + i.linked, 0)
    setConfirm({ ids, action, linked, title: ids.length === 1 ? `Retire ${label(ids[0])}?` : `Retire ${ids.length} items?` })
  }

  const save = (payload) => run(() => repository.save(editing?.id || null, payload), (item) => {
    setEditing(null)
    showToast(`${libraryLabel(item) || 'Item'} saved.`, { type: 'success' })
  })

  const merge = (keep, drop) => run(() => repository.merge(keep.id, drop.id), (n) => {
    setEditing(null)
    showToast(`Merged into ${libraryLabel(keep)}${n ? `. ${n} business item${n === 1 ? '' : 's'} moved.` : '.'}`, { type: 'success' })
  })

  const seed = () => run(() => repository.seed(2), (n) => showToast(n ? `${n} new candidate${n === 1 ? '' : 's'} added to the queue.` : 'No new candidates: every name used by two or more businesses is already in the library or was retired.', { type: n ? 'success' : 'info', duration: 6000 }))

  const pages = Math.max(1, Math.ceil(state.total / PAGE_SIZE))
  const page = Math.floor(offset / PAGE_SIZE) + 1
  const view = VIEW[status]
  const sel = [...selected]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: '1 1 240px' }}>
          <Search size={15} aria-hidden='true' style={{ position: 'absolute', left: 12, top: 12, color: gray500 }} />
          <input type='search' value={search} onChange={(e) => setSearch(e.target.value)} placeholder='Search name, generic, NAFDAC no. or barcode' aria-label='Search the library'
            style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px 10px 34px', borderRadius: theme.radius.md, border: `1px solid ${border}`, fontSize: '13px' }} />
        </div>
        <select value={source} onChange={(e) => setSource(e.target.value)} aria-label='Where items came from'
          style={{ padding: '10px', borderRadius: theme.radius.md, border: `1px solid ${border}`, fontSize: '13px', minHeight: 40 }}>
          <option value=''>Any source</option>
          {Object.entries(LIBRARY_SOURCE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        {status === 'pending' && <GhostBtn onClick={seed} disabled={busy}><Sparkles size={13} aria-hidden='true' style={{ marginRight: 4 }} /> Find new candidates</GhostBtn>}
        {status === 'active' && <TealBtn onClick={() => setEditing({})} style={{ padding: '9px 14px', fontSize: '12.5px' }}>+ Add item</TealBtn>}
      </div>

      {sel.length > 0 && (
        <div role='region' aria-label='Selected items' style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '10px 12px', borderRadius: theme.radius.md, background: theme.tealMist }}>
          <span style={{ fontSize: '13px', fontWeight: 700, color: tealDeep, flex: 1 }}>{sel.length} selected</span>
          {status === 'pending' && <TealBtn onClick={() => ask(sel, 'approve')} disabled={busy} style={{ padding: '8px 14px', fontSize: '12.5px' }}>Approve {sel.length}</TealBtn>}
          {status !== 'retired' && <RedBtn onClick={() => ask(sel, 'retire')} disabled={busy}>Retire {sel.length}</RedBtn>}
          {status === 'retired' && <TealBtn onClick={() => ask(sel, 'reopen')} disabled={busy} style={{ padding: '8px 14px', fontSize: '12.5px' }}>Reopen {sel.length}</TealBtn>}
          <GhostBtn onClick={() => setSelected(new Set())}>Clear</GhostBtn>
        </div>
      )}

      {state.status === 'loading' && !state.items.length ? <Loading text='Loading the library…' />
        : state.status === 'error' ? <ErrorState message="We couldn't load the library. Check your connection and try again." onRetry={load} />
        : !state.available ? <Empty icon={<BookOpen size={40} aria-hidden='true' />} title='The product library is not installed yet' description='Apply the shared product library database update, then reload.' />
        : !state.items.length ? (
          query || source
            ? <Empty icon={<BookOpen size={40} aria-hidden='true' />} cause='filtered' title='Nothing matches' description='Try another search or source.' action='Clear search' onAction={() => { setSearch(''); setSource('') }} />
            : <Empty icon={<BookOpen size={40} aria-hidden='true' />} title={view.empty} description={view.emptyHint} />
        ) : (
          <>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '12.5px', color: gray600, cursor: 'pointer', width: 'fit-content' }}>
              <input type='checkbox' checked={allOnPage} onChange={(e) => setSelected(e.target.checked ? new Set(state.items.map((i) => i.id)) : new Set())} style={{ width: 18, height: 18, accentColor: tealDeep }} />
              Select all on this page
            </label>
            <ul aria-busy={state.status === 'loading'} aria-label='Library items' style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {state.items.map((item) => {
                const rx = rxStatus(item.rx_status)
                const cat = categories.find((c) => c.code === item.category_code)
                return (
                  <li key={item.id}>
                    <Card style={{ padding: '12px 14px' }}>
                      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                        <input type='checkbox' checked={selected.has(item.id)} onChange={(e) => toggle(item.id, e.target.checked)} aria-label={`Select ${libraryLabel(item)}`}
                          style={{ width: 18, height: 18, marginTop: 3, accentColor: tealDeep, flexShrink: 0 }} />
                        <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                            <span style={{ fontWeight: 800, fontSize: '14px', color: navy, overflowWrap: 'anywhere' }}>{libraryLabel(item)}</span>
                            {rx && <Pill label={rx.label} type={rx.pill} />}
                            {cat && <Pill label={cat.label} type='teal' />}
                          </div>
                          {libraryFacts(item) && <div style={{ fontSize: '12px', color: gray600, marginTop: 3 }}>{libraryFacts(item)}</div>}
                          <div style={{ fontSize: '11.5px', color: gray500, marginTop: 4, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                            <span>{LIBRARY_SOURCE[item.source] || item.source}</span>
                            {item.business_count > 0 && <span>Used by {item.business_count} business{item.business_count === 1 ? '' : 'es'}</span>}
                            {item.linked > 0 && <span>Linked to {item.linked} item{item.linked === 1 ? '' : 's'}</span>}
                            {item.barcodes?.length > 0 && <span>Barcode{item.barcodes.length === 1 ? '' : 's'} {item.barcodes.join(', ')}</span>}
                            {item.review_note && <span>Note: {item.review_note}</span>}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {status === 'pending' && <TealBtn onClick={() => ask([item.id], 'approve')} disabled={busy} aria-label={`Approve ${libraryLabel(item)}`} style={{ padding: '8px 12px', fontSize: '12px' }}>Approve</TealBtn>}
                          {status !== 'retired' && <GhostBtn onClick={() => setEditing(item)} aria-label={`Edit ${libraryLabel(item)}`}>Edit</GhostBtn>}
                          {status !== 'retired' && <GhostBtn onClick={() => ask([item.id], 'retire')} disabled={busy} aria-label={`Retire ${libraryLabel(item)}`}>Retire</GhostBtn>}
                          {status === 'retired' && <GhostBtn onClick={() => ask([item.id], 'reopen')} disabled={busy} aria-label={`Reopen ${libraryLabel(item)}`}>Reopen</GhostBtn>}
                        </div>
                      </div>
                    </Card>
                  </li>
                )
              })}
            </ul>
            {pages > 1 && (
              <nav aria-label='Pages' style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
                <GhostBtn onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))} disabled={page <= 1}>Previous</GhostBtn>
                <span style={{ fontSize: '12.5px', color: gray600 }}>Page {page} of {pages} · {state.total.toLocaleString()} items</span>
                <GhostBtn onClick={() => setOffset(offset + PAGE_SIZE)} disabled={page >= pages}>Next</GhostBtn>
              </nav>
            )}
          </>
        )}

      <LibraryItemForm show={!!editing} item={editing?.id ? editing : null} categories={categories} saving={busy}
        onSave={save} onMerge={merge} onClose={() => setEditing(null)} />
      <ConfirmDialog show={!!confirm} onClose={() => setConfirm(null)} onConfirm={() => review(confirm.ids, confirm.action)}
        title={confirm?.title} confirmLabel='Retire'
        consequence={confirm?.linked
          ? `${confirm.linked} business item${confirm.linked === 1 ? ' is' : 's are'} linked to this and will be unlinked. They keep their details and prescription status. A retired name is not suggested again.`
          : 'It leaves the library and is not suggested again from business catalogues. You can reopen it later.'} />
      <Toast msg={msg} type={type} />
    </div>
  )
}
