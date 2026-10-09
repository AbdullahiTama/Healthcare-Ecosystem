import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Download } from 'lucide-react'
import {
  Card, TealBtn, GhostBtn, RedBtn, Inp, Sel, Pill, DataTable, Empty, ErrorState, Loading, ConfirmDialog, useToast, Toast,
} from '../../components/ui'
import { theme } from '../../styles/theme'
import { territoryRepository } from '../territories/repositories'
import { directoryRepository } from './repositories'
import { useDirectoryLookups } from './components/useDirectoryLookups'
import { VerificationBadge, SourceBadge } from './components/BusinessBadges'
import BusinessForm from './components/BusinessForm'
import BusinessProfile from './components/BusinessProfile'
import ImportWizard from './components/ImportWizard'
import CategoryManager from './components/CategoryManager'
import { createDedupIndex, addToIndex, classify, findDuplicatePairs, buildMergePatch, pairKey } from './services/deduplication'
import { toExportRow, exportRows } from './services/exportService'
import { NIGERIA_STATES, DATA_SOURCE } from './services/constants'

const { navy, gray500, gray600, border, tealDeep, danger } = theme
const PAGE_SIZE = 50
const TABS = [['businesses', 'Businesses'], ['import', 'Import'], ['duplicates', 'Duplicates'], ['categories', 'Categories'], ['reports', 'Reports']]

function readAuth() {
  try { return JSON.parse(localStorage.getItem('carehub_auth') || '{}') } catch (e) { return {} }
}

/**
 * Business Directory Management — the foundational data layer for Business
 * Discovery and (via nearby-business suggestions) Live Field Activity.
 * Reading is open to anyone who can reach the page; writes need
 * `perms.canManageDirectory`, enforced again by the database (RLS).
 */
export default function BusinessDirectory({ brand, perms }) {
  const repo = directoryRepository
  const businessId = brand?.id
  const canManage = !!perms?.canManageDirectory
  const auth = readAuth()
  const actor = auth?.staff?.email || auth?.brand?.email || brand?.email || null
  const { msg, type, actionLabel, onAction, show: showToast } = useToast()
  const lookups = useDirectoryLookups(businessId, repo)

  const [tab, setTab] = useState('businesses')
  const [filters, setFilters] = useState({ search: '', categoryId: '', state: '', verification: '', source: '', active: 'active' })
  const [debounced, setDebounced] = useState(filters)
  const [page, setPage] = useState(0)
  const [rows, setRows] = useState([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [territories, setTerritories] = useState([])

  const [viewing, setViewing] = useState(null)
  const [editing, setEditing] = useState(null) // null | {} (new) | record
  const [confirm, setConfirm] = useState(null)
  const [exporting, setExporting] = useState(false)

  const [dupPairs, setDupPairs] = useState(null)
  const [dupProgress, setDupProgress] = useState(null)
  const [reports, setReports] = useState(null)
  const [batches, setBatches] = useState([])

  // The duplicate index is expensive (every record); build it once per visit and keep it current incrementally.
  const indexRef = useRef(null)
  const ensureIndex = useCallback(async () => {
    if (!indexRef.current) indexRef.current = createDedupIndex(await repo.getDedupIndexRows(businessId))
    return indexRef.current
  }, [repo, businessId])

  useEffect(() => { indexRef.current = null }, [businessId])
  useEffect(() => { const t = setTimeout(() => { setDebounced(filters); setPage(0) }, 300); return () => clearTimeout(t) }, [filters])

  const load = useCallback(async () => {
    if (!businessId) return
    setLoading(true)
    setError('')
    try {
      const r = await repo.list(businessId, debounced, { page, pageSize: PAGE_SIZE, probe: true })
      setRows(r.slice(0, PAGE_SIZE))
      setHasMore(r.length > PAGE_SIZE)
    } catch (e) {
      setError(e.message || 'Could not load the directory')
    }
    setLoading(false)
  }, [repo, businessId, debounced, page])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (!businessId) return
    territoryRepository.getAll(businessId).then((t) => setTerritories(t || [])).catch(() => {})
    repo.getBatches(businessId, 10).then(setBatches).catch(() => {})
  }, [businessId, repo])

  const set = (k) => (v) => setFilters((p) => ({ ...p, [k]: v }))
  const filtered = Object.entries(filters).some(([k, v]) => v && !(k === 'active' && v === 'active'))

  async function saveBusiness(record, pendingSub) {
    if (!canManage) throw new Error('You do not have permission to change the directory.')
    const rec = { ...record }
    if (pendingSub) rec.subcategory_id = (await repo.ensureSubcategory(businessId, pendingSub.category_id, pendingSub.name)).id
    if (editing?.id) {
      await repo.update(editing.id, businessId, rec)
      indexRef.current = null
      showToast('Business updated', { type: 'success' })
    } else {
      const created = await repo.create(businessId, rec, actor)
      if (indexRef.current && created) addToIndex(indexRef.current, created)
      showToast('Business added', { type: 'success' })
    }
    if (pendingSub) lookups.reload()
    setEditing(null)
    load()
  }

  async function act(fn, ok) {
    try { await fn(); indexRef.current = null; showToast(ok, { type: 'success' }); load() } catch (e) { showToast(e.message, { type: 'error' }) }
  }

  async function doExport(format) {
    setExporting(true)
    try {
      const all = await repo.listAll(businessId, debounced)
      if (!all.length) { showToast('Nothing to export for these filters.', { type: 'warning' }); setExporting(false); return }
      await exportRows(format, all.map((r) => toExportRow(r, lookups.categoryName(r.category_id), lookups.subcategoryName(r.subcategory_id))),
        { baseName: 'business-directory', title: 'Business Directory', subtitle: brand?.name })
      showToast(`Exported ${all.length.toLocaleString()} record(s)`, { type: 'success' })
    } catch (e) { showToast('Could not export: ' + e.message, { type: 'error' }) }
    setExporting(false)
  }

  async function scanDuplicates() {
    setDupProgress({ done: 0, total: 0 })
    try {
      const [all, dismissed] = await Promise.all([repo.getDedupIndexRows(businessId), repo.getDismissedPairs(businessId)])
      const pairs = await findDuplicatePairs(all.filter((r) => r.is_active !== false), {
        dismissed: new Set(dismissed.map((d) => pairKey(d.a_id, d.b_id))),
        onProgress: (done, total) => setDupProgress({ done, total }),
      })
      setDupPairs(pairs)
    } catch (e) { showToast('Could not scan: ' + e.message, { type: 'error' }) }
    setDupProgress(null)
  }

  async function resolvePair(pair, how) {
    try {
      if (how === 'dismiss') await repo.dismissPair(businessId, pair.keep.id, pair.other.id, actor)
      else {
        if (how === 'merge') {
          const [keep, other] = await Promise.all([repo.getById(pair.keep.id, businessId), repo.getById(pair.other.id, businessId)])
          const patch = keep && other ? buildMergePatch(keep, other) : null
          if (patch) await repo.update(keep.id, businessId, patch)
        }
        await repo.setActive(pair.other.id, businessId, false)
      }
      indexRef.current = null
      setDupPairs((prev) => prev.filter((p) => p !== pair))
      load()
      showToast(how === 'dismiss' ? 'Marked as different businesses' : how === 'merge' ? 'Merged — the duplicate was deactivated' : 'Duplicate deactivated', { type: 'success' })
    } catch (e) { showToast(e.message, { type: 'error' }) }
  }

  useEffect(() => {
    if (tab !== 'reports' || !canManage) return
    setReports(null)
    repo.getOpenReports(businessId).then(async (rs) => {
      const named = await Promise.all(rs.map(async (r) => ({ ...r, business: await repo.getById(r.directory_business_id, businessId).catch(() => null) })))
      setReports(named)
    }).catch((e) => { setReports([]); showToast(e.message, { type: 'error' }) })
  }, [tab, canManage, businessId, repo])

  const columns = useMemo(() => [
    { key: 'name', label: 'Business', sortable: true, render: (r) => (
      <div>
        <div style={{ fontWeight: 700, color: navy }}>{r.name}</div>
        <div style={{ fontSize: 11.5, color: gray500 }}>{[lookups.categoryName(r.category_id), lookups.subcategoryName(r.subcategory_id)].filter(Boolean).join(' · ') || 'Uncategorised'}</div>
      </div>) },
    { key: 'state', label: 'Location', render: (r) => [r.city || r.lga, r.state].filter(Boolean).join(', ') || '—' },
    { key: 'phone', label: 'Phone', render: (r) => r.phone || '—' },
    { key: 'verification_status', label: 'Status', render: (r) => (
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        <VerificationBadge status={r.verification_status} />
        <SourceBadge source={r.data_source} />
        {!r.is_active && <Pill label='Inactive' type='red' />}
        {r.latitude == null && <Pill label='No coordinates' type='amber' />}
      </div>) },
  ], [lookups.categories, lookups.subcategories])

  if (!businessId) return null

  return (
    <div style={{ padding: 24, maxWidth: 1200 }}>
      <Toast msg={msg} type={type} actionLabel={actionLabel} onAction={onAction} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 900, color: navy, margin: 0 }}>Business Directory</h1>
          <div style={{ fontSize: 13, color: gray500, marginTop: 2 }}>
            The central list of pharmacies, facilities and companies your team can search in Business Discovery. Managing it never creates field activity.
          </div>
        </div>
        {canManage && tab === 'businesses' && <TealBtn onClick={() => setEditing({})}>+ Add business</TealBtn>}
      </div>
      {!canManage && (
        <div role='note' style={{ padding: '10px 14px', borderRadius: 10, background: theme.infoBg, color: theme.info, fontSize: 12.5, marginBottom: 14 }}>
          You can view the directory. Only the Owner, or a role with “Manage business directory”, can add, import or change records.
        </div>
      )}

      <div role='tablist' aria-label='Directory sections' style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
        {TABS.filter(([id]) => canManage || id === 'businesses' || id === 'categories').map(([id, label]) => (
          <button key={id} role='tab' aria-selected={tab === id} onClick={() => setTab(id)}
            style={{ fontSize: 12.5, fontWeight: 800, padding: '9px 16px', borderRadius: 10, cursor: 'pointer', border: `1px solid ${tab === id ? tealDeep : border}`, background: tab === id ? navy : 'white', color: tab === id ? 'white' : gray500 }}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'businesses' && (
        <>
          <Card style={{ padding: 14, marginBottom: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
              <Inp label='Search' value={filters.search} onChange={set('search')} placeholder='Name, address, phone…' id='bd-search' />
              <Sel label='Category' value={filters.categoryId} onChange={set('categoryId')} options={lookups.categories.map((c) => ({ value: c.id, label: c.name }))} placeholder='All categories' id='bd-cat' />
              <Sel label='State' value={filters.state} onChange={set('state')} options={NIGERIA_STATES} placeholder='All states' id='bd-state' />
              <Sel label='Verification' value={filters.verification} onChange={set('verification')} options={[{ value: 'verified', label: 'Verified' }, { value: 'unverified', label: 'Unverified' }, { value: 'rejected', label: 'Rejected' }]} placeholder='Any' id='bd-ver' />
              <Sel label='Source' value={filters.source} onChange={set('source')} options={Object.entries(DATA_SOURCE).map(([v, d]) => ({ value: v, label: d.label }))} placeholder='Any' id='bd-src' />
              <Sel label='Show' value={filters.active} onChange={set('active')} options={[{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }, { value: 'all', label: 'All' }]} placeholder='Active' id='bd-active' />
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10, alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: gray600, fontWeight: 700 }}>Export these results:</span>
              {[['csv', 'CSV'], ['xlsx', 'Excel'], ['pdf', 'PDF'], ['json', 'JSON']].map(([f, l]) => (
                <GhostBtn key={f} disabled={exporting} onClick={() => doExport(f)} style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}><Download size={13} aria-hidden='true' />{l}</GhostBtn>
              ))}
            </div>
          </Card>

          <DataTable
            rows={rows} columns={columns} loading={loading} error={error} onRetry={load}
            count={!loading && !error ? `${rows.length} shown${hasMore ? ' — more on the next page' : ''}` : undefined}
            onRowClick={(r) => setViewing(r)}
            empty={filtered
              ? <Empty cause='filtered' message='No businesses match these filters.' action='Clear filters' onAction={() => setFilters({ search: '', categoryId: '', state: '', verification: '', source: '', active: 'active' })} />
              : <Empty message='Your directory is empty. Add a business or import a spreadsheet.' action={canManage ? 'Import businesses' : undefined} onAction={() => setTab('import')} />}
            actions={canManage ? (r) => (
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }} onClick={(e) => e.stopPropagation()}>
                <GhostBtn onClick={() => setEditing(r)}>Edit</GhostBtn>
                {r.verification_status !== 'verified'
                  ? <GhostBtn onClick={() => act(() => repo.setVerification(r.id, businessId, 'verified'), 'Marked as verified')}>Verify</GhostBtn>
                  : <GhostBtn onClick={() => act(() => repo.setVerification(r.id, businessId, 'unverified'), 'Verification removed')}>Unverify</GhostBtn>}
                {r.is_active
                  ? <RedBtn onClick={() => setConfirm(r)}>Deactivate</RedBtn>
                  : <GhostBtn onClick={() => act(() => repo.setActive(r.id, businessId, true), 'Reactivated')}>Reactivate</GhostBtn>}
              </div>) : undefined}
          />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '12px 0', fontSize: 12.5, color: gray600 }}>
            <GhostBtn disabled={page === 0 || loading} onClick={() => setPage((p) => Math.max(0, p - 1))}>Previous</GhostBtn>
            <span>Page {page + 1}</span>
            <GhostBtn disabled={!hasMore || loading} onClick={() => setPage((p) => p + 1)}>Next</GhostBtn>
          </div>
        </>
      )}

      {tab === 'import' && canManage && (
        <>
          <ImportWizard businessId={businessId} repo={repo} categories={lookups.categories} subcategories={lookups.subcategories}
            loadExisting={() => repo.getDedupIndexRows(businessId)} createdBy={actor} showToast={showToast}
            onImported={() => { indexRef.current = null; load(); lookups.reload(); repo.getBatches(businessId, 10).then(setBatches).catch(() => {}) }} />
          {batches.length > 0 && (
            <Card style={{ padding: 14, marginTop: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: navy, marginBottom: 8 }}>Recent imports</div>
              {batches.map((b) => (
                <div key={b.id} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 12.5, padding: '6px 0', borderTop: `1px solid ${border}` }}>
                  <span style={{ fontWeight: 700, color: navy }}>{b.file_name || 'Untitled'}</span>
                  <Pill label={b.status} type={b.status === 'completed' ? 'green' : b.status === 'importing' ? 'blue' : 'red'} />
                  <span style={{ color: gray600 }}>{b.imported_count} of {b.total_rows} imported · {b.invalid_count} invalid</span>
                  <span style={{ color: gray500, marginLeft: 'auto' }}>{new Date(b.created_at).toLocaleString('en-NG')}</span>
                </div>
              ))}
            </Card>
          )}
        </>
      )}

      {tab === 'duplicates' && canManage && (
        <div>
          <Card style={{ padding: 14, marginBottom: 12 }}>
            <div style={{ fontSize: 13, color: gray600, marginBottom: 10 }}>
              Scan the whole directory for businesses that appear more than once under different spellings, phone formats or addresses.
            </div>
            <TealBtn onClick={scanDuplicates} disabled={!!dupProgress}>{dupProgress ? `Scanning… ${dupProgress.done.toLocaleString()} / ${dupProgress.total.toLocaleString()}` : dupPairs ? 'Scan again' : 'Scan for duplicates'}</TealBtn>
          </Card>
          {dupPairs && dupPairs.length === 0 && <Empty cause='positive' message='No duplicates found.' />}
          {dupPairs && dupPairs.slice(0, 100).map((p) => (
            <Card key={p.keep.id + p.other.id} style={{ padding: 14, marginBottom: 10 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
                <Pill label={p.status === 'confirmed_duplicate' ? 'Likely duplicate' : 'Possible duplicate'} type={p.status === 'confirmed_duplicate' ? 'red' : 'amber'} />
                <span style={{ fontSize: 12, color: gray600 }}>{p.reasons.join(', ')}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12, fontSize: 12.5 }}>
                {[['Keep', p.keep], ['Duplicate', p.other]].map(([label, r]) => (
                  <div key={label}>
                    <div style={{ fontSize: 10.5, fontWeight: 800, color: gray500, textTransform: 'uppercase' }}>{label}</div>
                    <div style={{ fontWeight: 700, color: navy }}>{r.name}</div>
                    <div style={{ color: gray600 }}>{r.address_normalized || 'No address'}</div>
                    <div style={{ color: gray600 }}>{r.phone_normalized || 'No phone'}</div>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                <GhostBtn onClick={() => resolvePair(p, 'dismiss')}>Different businesses</GhostBtn>
                <GhostBtn onClick={() => resolvePair(p, 'merge')}>Merge into “keep”</GhostBtn>
                <RedBtn onClick={() => resolvePair(p, 'deactivate')}>Deactivate duplicate</RedBtn>
              </div>
            </Card>
          ))}
          {dupPairs && dupPairs.length > 100 && <div style={{ fontSize: 12.5, color: gray500 }}>Showing the 100 strongest of {dupPairs.length.toLocaleString()} — resolve these, then scan again.</div>}
        </div>
      )}

      {tab === 'categories' && (lookups.loading ? <Loading /> : lookups.error ? <ErrorState message={lookups.error} onRetry={lookups.reload} /> : (
        <CategoryManager businessId={businessId} repo={repo} categories={lookups.categories} subcategories={lookups.subcategories}
          canManage={canManage} onChanged={lookups.reload} showToast={showToast} />
      ))}

      {tab === 'reports' && canManage && (
        reports === null ? <Loading /> : reports.length === 0 ? <Empty cause='positive' message='No open reports of incorrect information.' /> : reports.map((r) => (
          <Card key={r.id} style={{ padding: 14, marginBottom: 10 }}>
            <div style={{ fontWeight: 700, color: navy }}>{r.business?.name || 'Removed business'}</div>
            <div style={{ fontSize: 13, color: gray600, margin: '4px 0' }}>{r.message}</div>
            <div style={{ fontSize: 11.5, color: gray500 }}>Reported by {r.reported_by || 'unknown'} · {new Date(r.created_at).toLocaleString('en-NG')}</div>
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              {r.business && <GhostBtn onClick={() => setEditing(r.business)}>Open record</GhostBtn>}
              <GhostBtn onClick={async () => { await repo.resolveReport(r.id, businessId, 'resolved'); setReports((p) => p.filter((x) => x.id !== r.id)) }}>Mark resolved</GhostBtn>
              <GhostBtn onClick={async () => { await repo.resolveReport(r.id, businessId, 'dismissed'); setReports((p) => p.filter((x) => x.id !== r.id)) }}>Dismiss</GhostBtn>
            </div>
          </Card>
        ))
      )}

      {editing && (
        <BusinessForm key={editing.id || 'new'} show initial={editing.id ? editing : null}
          categories={lookups.categories} subcategories={lookups.subcategories} territories={territories}
          onClose={() => setEditing(null)} onSave={saveBusiness}
          checkDuplicate={(rec, ignoreId) => {
            // The index may still be loading on first save; treat that as "no signal" rather than blocking.
            const idx = indexRef.current
            if (!idx) { ensureIndex(); return null }
            const res = classify(rec, idx)
            return res.match && res.match.id === ignoreId ? null : res
          }} />
      )}
      {viewing && (
        <BusinessProfile business={viewing} categoryName={lookups.categoryName(viewing.category_id)} subcategoryName={lookups.subcategoryName(viewing.subcategory_id)}
          onClose={() => setViewing(null)} onToast={showToast} />
      )}
      <ConfirmDialog show={!!confirm} onClose={() => setConfirm(null)} title={`Deactivate ${confirm?.name || ''}?`}
        consequence='It will stop appearing in Business Discovery. Field activity already logged against it is kept. You can reactivate it at any time.'
        confirmLabel='Deactivate'
        onConfirm={() => { const r = confirm; setConfirm(null); act(() => repo.setActive(r.id, businessId, false), 'Deactivated') }} />
    </div>
  )
}
