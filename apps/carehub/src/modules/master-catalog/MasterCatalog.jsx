import { useCallback, useEffect, useRef, useState } from 'react'
import { Lock, Layers, Search, Building2 } from 'lucide-react'
import { masterCatalogRepository, PAGE_SIZE } from './repositories'
import { locationsRepository } from '../locations/repositories'
import { isDuplicateError } from '../../lib/dbErrors'
import { theme } from '../../styles/theme'
import { SectionHead, ConfirmDialog, Sel, GhostBtn, TealBtn, Loading, Empty, ErrorState, useToast, Toast } from '../../components/ui'
import { usePlanGate } from '../../hooks/usePlanGate'
import { RX_STATUSES, locationName } from './catalogueRules'
import MasterItemCard from './MasterItemCard'
import MasterItemForm from './MasterItemForm'
import CarryDialog from './CarryDialog'
import ItemLocationsModal from './ItemLocationsModal'

const { tealBright, navy, gray500, border } = theme
const log = (what, e) => console.error(`[master-catalog] ${what}:`, e)
const reason = (e) => String(e?.message || e || '').replace(/^Supabase error \(\d+\):\s*/, '')

// The business's master catalogue: the home of every product (Product-Catalogue-Design.md, phase 1). Every product at
// every location is linked to an item here by id. The owner searches and filters the list, edits an item and pushes
// it to the locations, carries items at locations in bulk, sets a location's own price, and archives what is no longer
// sold. Pages of 50 come from master_catalog_page; before carehub_20261215 the page shows the plain list.
export default function MasterCatalog({ brand, role }) {
  const { msg, type, actionLabel, onAction, show: showToast } = useToast()
  const { allow } = usePlanGate(showToast)
  const mainId = brand?.parent_business_id || brand?.id // master items live on the main business (ADR-004)
  const isOwner = role === 'Owner'

  const [categories, setCategories] = useState([])
  const [locations, setLocations] = useState([])
  const [page, setPage] = useState({ items: [], total: 0, upgraded: true })
  const [status, setStatus] = useState('loading') // loading | ready | error
  const [searchText, setSearchText] = useState('')
  const [filters, setFilters] = useState({ search: '', category: '', rx: '', archived: false })
  const [offset, setOffset] = useState(0)
  const [selected, setSelected] = useState([])
  const [busy, setBusy] = useState(false)

  const [formItem, setFormItem] = useState(undefined) // undefined: closed, null: new item, object: editing
  const [carryItems, setCarryItems] = useState(null)
  const [locationsItemId, setLocationsItemId] = useState(null)
  const [pushTarget, setPushTarget] = useState(null)
  const [archiveTargets, setArchiveTargets] = useState(null)
  const request = useRef(0)

  // Categories and locations change rarely: loaded once per business.
  useEffect(() => {
    if (!isOwner || !mainId) return
    masterCatalogRepository.getCategories().then(setCategories).catch((e) => log('categories', e))
    locationsRepository.getAll(mainId).then((l) => setLocations(l || [])).catch((e) => log('locations', e))
  }, [mainId, isOwner])

  // The search box waits for a pause in typing before asking the server.
  useEffect(() => {
    const t = setTimeout(() => setFilters((f) => (f.search === searchText.trim() ? f : { ...f, search: searchText.trim() })), 300)
    return () => clearTimeout(t)
  }, [searchText])
  useEffect(() => { setOffset(0); setSelected([]) }, [filters])

  const load = useCallback(async () => {
    if (!isOwner || !mainId) return
    const mine = ++request.current
    setStatus('loading')
    try {
      const result = await masterCatalogRepository.getPage(mainId, { ...filters, offset, limit: PAGE_SIZE })
      if (mine !== request.current) return // a newer search is on its way
      setPage(result)
      setStatus('ready')
    } catch (e) {
      if (mine !== request.current) return
      log('load', e)
      setStatus('error')
    }
  }, [mainId, isOwner, filters, offset])
  useEffect(() => { load() }, [load])

  const categoryLabel = (item) => categories.find((c) => c.code === item.category_code)?.label || item.category || ''
  const selectedItems = page.items.filter((i) => selected.includes(i.id))
  const locationsItem = page.items.find((i) => i.id === locationsItemId) || null

  // ── Actions ───────────────────────────────────────────────────────────────
  async function saveItem(payload) {
    if (!formItem && !allow('adding products')) return
    setBusy(true)
    try {
      if (formItem) {
        await masterCatalogRepository.update(formItem.id, mainId, payload)
        const linked = (formItem.carried || []).length
        showToast(linked ? 'Item saved. Press Push on it to update the locations that carry it.' : 'Item saved.', { type: 'success', duration: linked ? 7000 : 4000 })
      } else {
        await masterCatalogRepository.create(mainId, payload)
        showToast('Item added to the catalogue. Use Carry to stock it at your locations.', { type: 'success' })
      }
      setFormItem(undefined)
      load()
    } catch (e) {
      log('save', e)
      showToast(isDuplicateError(e) ? 'An item with this name is already in the catalogue. Search for it instead.' : 'Could not save the item: ' + reason(e), { type: 'error' })
    }
    setBusy(false)
  }

  async function carry(locationIds, price, items = carryItems) {
    if (!allow('adding products')) return
    const ids = items.map((i) => i.id)
    setBusy(true)
    const failed = []
    for (const locId of locationIds) {
      try { await masterCatalogRepository.carry(locId, ids, price) } catch (e) {
        log('carry', e)
        failed.push(`${locationName(locations.find((l) => l.id === locId))} (${reason(e)})`)
      }
    }
    setBusy(false)
    if (failed.length) showToast('Not carried at ' + failed.join(', '), { type: 'error', duration: 10000 })
    else showToast(`${ids.length === 1 ? items[0].name : ids.length + ' items'} carried at ${locationIds.length} location${locationIds.length === 1 ? '' : 's'}.`, { type: 'success' })
    setCarryItems(null)
    setSelected([])
    load()
  }

  async function stopAt(locationId) {
    setBusy(true)
    try {
      await masterCatalogRepository.deactivate(locationId, locationsItemId)
      showToast('Stopped. The location keeps its stock and sales history.', { type: 'success' })
      load()
    } catch (e) { log('stop', e); showToast('Could not stop carrying: ' + reason(e), { type: 'error' }) }
    setBusy(false)
  }

  async function push() {
    const item = pushTarget
    setPushTarget(null)
    try {
      const n = await masterCatalogRepository.push(item.id, mainId)
      showToast(typeof n === 'number' ? `${item.name} updated at ${n} product${n === 1 ? '' : 's'} across your locations.` : 'Pushed to your locations.', { type: 'success' })
      load()
    } catch (e) { log('push', e); showToast('Could not push: ' + reason(e), { type: 'error' }) }
  }

  async function archive() {
    const items = archiveTargets
    setArchiveTargets(null)
    setBusy(true)
    const results = await Promise.allSettled(items.map((i) => masterCatalogRepository.archive(i.id, mainId)))
    setBusy(false)
    const failed = results.filter((r) => r.status === 'rejected')
    failed.forEach((r) => log('archive', r.reason))
    showToast(failed.length ? `${failed.length} of ${items.length} items could not be archived.` : `${items.length === 1 ? items[0].name : items.length + ' items'} archived.`, { type: failed.length ? 'error' : 'success' })
    setSelected([])
    load()
  }

  async function restore(item) {
    try {
      await masterCatalogRepository.restore(item.id, mainId)
      showToast(`${item.name} restored.`, { type: 'success' })
      load()
    } catch (e) {
      log('restore', e)
      showToast(isDuplicateError(e) ? 'Another item with this name is in the catalogue. Rename one of them first.' : 'Could not restore: ' + reason(e), { type: 'error' })
    }
  }

  const select = (id, on) => setSelected((s) => (on ? [...s, id] : s.filter((x) => x !== id)))
  const allOnPage = page.items.filter((i) => !i.archived_at)
  const allSelected = allOnPage.length > 0 && allOnPage.every((i) => selected.includes(i.id))

  if (!isOwner) return (
    <div style={{ padding: '32px', textAlign: 'center', color: theme.gray400 }}>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '16px' }}><Lock size={40} aria-hidden='true' /></div>
      <div style={{ fontSize: '16px', fontWeight: 700, color: theme.gray600 }}>The master catalogue is managed by the business owner</div>
    </div>
  )

  const filtered = filters.search || filters.category || filters.rx
  const from = page.total ? offset + 1 : 0
  const to = Math.min(offset + page.items.length, page.total)

  return (
    <div>
      <SectionHead title='Master Catalog' sub='Every product of your business in one list. Carry items at your locations and keep them in step.'
        btn='+ Add item' onBtn={() => { if (allow('adding products')) setFormItem(null) }} />

      <div style={{ marginBottom: '16px', padding: '16px 20px', borderRadius: theme.radius.lg, background: navy, color: 'white', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(110px,1fr))', gap: '12px' }}>
        <div><div style={{ fontSize: '22px', fontWeight: 900, color: tealBright }}>{status === 'ready' || page.total ? page.total.toLocaleString() : '–'}</div><div style={{ fontSize: '11px', opacity: 0.6 }}>{filters.archived ? 'Archived items' : filtered ? 'Matching items' : 'Catalogue items'}</div></div>
        <div><div style={{ fontSize: '22px', fontWeight: 900 }}>{locations.length}</div><div style={{ fontSize: '11px', opacity: 0.6 }}>Locations</div></div>
        <div><div style={{ fontSize: '22px', fontWeight: 900 }}>{categories.length || '–'}</div><div style={{ fontSize: '11px', opacity: 0.6 }}>Standard categories</div></div>
      </div>

      {!page.upgraded && status === 'ready' && (
        <div role='status' style={{ marginBottom: '16px', padding: '12px 14px', borderRadius: theme.radius.md, background: theme.warningBg, color: theme.warning, fontSize: '13px' }}>
          Categories, prescription status, filters and per-location details appear once the catalogue update is installed on the database.
        </div>
      )}

      {/* Search and filters */}
      <div role='search' style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: '10px', marginBottom: '12px', alignItems: 'end' }}>
        <label style={{ position: 'relative', display: 'block' }}>
          <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Search the catalogue</span>
          <Search size={15} aria-hidden='true' style={{ position: 'absolute', left: 12, top: 13, color: gray500 }} />
          <input type='search' value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder='Name, generic name or barcode'
            style={{ width: '100%', boxSizing: 'border-box', padding: '11px 12px 11px 34px', borderRadius: theme.radius.md, border: `1px solid ${border}`, fontSize: '14px' }} />
        </label>
        <Sel id='mc-filter-category' aria-label='Category' value={filters.category} onChange={(v) => setFilters((f) => ({ ...f, category: v }))}
          options={categories.map((c) => ({ value: c.code, label: c.label }))} placeholder='All categories' disabled={!page.upgraded} />
        <Sel id='mc-filter-rx' aria-label='Prescription status' value={filters.rx} onChange={(v) => setFilters((f) => ({ ...f, rx: v }))}
          options={RX_STATUSES.map((s) => ({ value: s.value, label: s.label }))} placeholder='Any prescription status' disabled={!page.upgraded} />
        <GhostBtn onClick={() => setFilters((f) => ({ ...f, archived: !f.archived }))} aria-pressed={filters.archived} disabled={!page.upgraded} style={{ padding: '11px 14px' }}>
          {filters.archived ? 'Show current items' : 'Show archived'}
        </GhostBtn>
      </div>

      {/* Bulk actions for the selection */}
      {page.upgraded && !filters.archived && allOnPage.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', padding: '10px 12px', marginBottom: '12px', borderRadius: theme.radius.md, border: `1px solid ${border}`, background: 'white', position: 'sticky', top: 0, zIndex: 2 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer' }}>
            <input type='checkbox' checked={allSelected} onChange={(e) => setSelected(e.target.checked ? allOnPage.map((i) => i.id) : [])} style={{ width: 18, height: 18 }} />
            Select all on this page
          </label>
          <span aria-live='polite' style={{ fontSize: '13px', color: gray500 }}>{selected.length ? `${selected.length} selected` : ''}</span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <TealBtn onClick={() => setCarryItems(selectedItems)} disabled={!selected.length || busy} style={{ padding: '8px 14px', fontSize: '12px' }}>
              <Building2 size={13} aria-hidden='true' style={{ marginRight: 5 }} /> Carry at locations
            </TealBtn>
            <GhostBtn onClick={() => setArchiveTargets(selectedItems)} disabled={!selected.length || busy}>Archive</GhostBtn>
          </div>
        </div>
      )}

      {status === 'loading' && !page.items.length ? <Loading text='Loading the catalogue…' />
        : status === 'error' ? <ErrorState message="We couldn't load the catalogue. Check your connection and try again." onRetry={load} />
        : page.items.length === 0 ? (
          filtered || filters.archived
            ? <Empty icon={<Search size={40} aria-hidden='true' />} message={filters.archived ? 'No archived items' : 'No items match your search'} cause='filtered'
                action={filters.archived ? 'Show current items' : 'Clear search and filters'}
                onAction={() => { setSearchText(''); setFilters({ search: '', category: '', rx: '', archived: false }) }} />
            : <Empty icon={<Layers size={40} aria-hidden='true' />} title='Your catalogue is empty'
                description='Products added at any location appear here automatically. You can also add items here and carry them at your locations.'
                action='+ Add first item' onAction={() => { if (allow('adding products')) setFormItem(null) }} />
        ) : (
          <div aria-busy={status === 'loading'} style={{ display: 'flex', flexDirection: 'column', gap: '10px', opacity: status === 'loading' ? 0.6 : 1 }}>
            {page.items.map((item) => (
              <MasterItemCard key={item.id} item={item} locations={locations} categoryLabel={categoryLabel(item)} upgraded={page.upgraded}
                selected={selected.includes(item.id)} onSelect={select} onEdit={setFormItem} onLocations={(i) => setLocationsItemId(i.id)}
                onPush={setPushTarget} onArchive={setArchiveTargets} onRestore={restore} />
            ))}
          </div>
        )}

      {page.total > PAGE_SIZE && (
        <nav aria-label='Catalogue pages' style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', marginTop: '16px', flexWrap: 'wrap' }}>
          <GhostBtn onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))} disabled={offset === 0 || status === 'loading'}>← Previous</GhostBtn>
          <span style={{ fontSize: '13px', color: gray500 }}>{from.toLocaleString()}–{to.toLocaleString()} of {page.total.toLocaleString()}</span>
          <GhostBtn onClick={() => setOffset((o) => o + PAGE_SIZE)} disabled={offset + PAGE_SIZE >= page.total || status === 'loading'}>Next →</GhostBtn>
        </nav>
      )}

      <MasterItemForm show={formItem !== undefined} item={formItem || null} categories={categories} upgraded={page.upgraded}
        saving={busy} onSave={saveItem} onClose={() => setFormItem(undefined)} />

      <CarryDialog show={!!carryItems} items={carryItems || []} locations={locations} busy={busy}
        onCarry={(locIds, price) => carry(locIds, price)} onClose={() => setCarryItems(null)} />

      {locationsItem && page.upgraded && (
        <ItemLocationsModal item={locationsItem} locations={locations} busy={busy}
          onCarry={(locId, price) => carry([locId], price, [locationsItem])} onStop={stopAt} onClose={() => setLocationsItemId(null)} />
      )}
      {locationsItem && !page.upgraded && (
        <CarryDialog show items={[locationsItem]} locations={locations} busy={busy}
          onCarry={(locIds, price) => carry(locIds, price, [locationsItem])} onClose={() => setLocationsItemId(null)} />
      )}

      <ConfirmDialog show={!!pushTarget} onClose={() => setPushTarget(null)} onConfirm={push}
        title='Push to your locations?' confirmLabel='Push' danger={false}
        consequence={`Sends the name, generic name, category, barcode and prescription status of "${pushTarget?.name}" to every location's product. The price changes only where a location follows the master price; locations with their own price keep it.`} />

      <ConfirmDialog show={!!archiveTargets} onClose={() => setArchiveTargets(null)} onConfirm={archive} confirmLabel='Archive'
        title={archiveTargets?.length === 1 ? `Archive ${archiveTargets[0].name}?` : `Archive ${archiveTargets?.length || 0} items?`}
        consequence='Archived items leave the catalogue list. Locations keep their products, stock and history, and you can restore an item at any time.' />

      <Toast msg={msg} type={type} actionLabel={actionLabel} onAction={onAction} />
    </div>
  )
}
