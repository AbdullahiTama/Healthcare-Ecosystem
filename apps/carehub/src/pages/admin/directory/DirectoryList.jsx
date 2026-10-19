import { useState, useEffect, useCallback } from 'react'
import { Plus, Pencil, ShieldCheck, History, Power } from 'lucide-react'
import { Button, Modal, Input, Select, Textarea, Pill, Loading, Empty, ErrorState, ConfirmDialog, Toast, useToast } from '../../../components/ui'
import { directoryRepository as repo } from '../../../modules/directory/repositories'
import { validateDirectoryRecord, duplicateKeys, VERIFICATION_STATUSES } from '../../../modules/directory/directoryRecord'

const PAGE = 25
const VERIF_PILL = { verified: 'green', pending: 'amber', rejected: 'red', unverified: 'gray' }
const EMPTY_FORM = { name: '', category_id: '', subcategory_id: '', business_type: '', address: '', city: '', state: '', lga: '', latitude: '', longitude: '', phone: '', email: '', website: '', description: '', contact_person: '', notes: '' }

function useDebounced(value, ms = 350) {
  const [v, setV] = useState(value)
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t) }, [value, ms])
  return v
}

export default function DirectoryList() {
  const { msg, type, actionLabel, onAction, show: showToast } = useToast()
  const [categories, setCategories] = useState([])
  const [filters, setFilters] = useState({ q: '', verification: '', categoryId: '', state: '', active: 'true' })
  const [page, setPage] = useState(0)
  const [rows, setRows] = useState([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null) // null | { id?: string }
  const [verifying, setVerifying] = useState(null)
  const [toggling, setToggling] = useState(null)
  const [history, setHistory] = useState(null)

  const q = useDebounced(filters.q)
  const state = useDebounced(filters.state)

  useEffect(() => { repo.listCategories().then(setCategories).catch(() => {}) }, [])
  useEffect(() => { setPage(0) }, [q, state, filters.verification, filters.categoryId, filters.active])

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      // Ask for one extra row to know whether a next page exists.
      const data = await repo.search({
        q, state, verification: filters.verification || undefined, categoryId: filters.categoryId || undefined,
        active: filters.active === 'all' ? null : filters.active === 'true', limit: PAGE + 1, offset: page * PAGE,
      })
      const list = Array.isArray(data) ? data : []
      setHasMore(list.length > PAGE)
      setRows(list.slice(0, PAGE))
    } catch (e) {
      console.error('[Directory] load failed:', e)
      setError(e.message || 'Could not load the directory.')
    } finally { setLoading(false) }
  }, [q, state, filters.verification, filters.categoryId, filters.active, page])
  useEffect(() => { load() }, [load])

  const catName = (id) => (categories.find((c) => c.id === id) || {}).name || ''
  const topCats = categories.filter((c) => !c.parent_id)

  async function toggleActive() {
    const row = toggling
    try {
      await repo.setActive(row.id, !row.is_active)
      showToast(row.is_active ? 'Deactivated' : 'Reactivated', { type: 'success' })
      setToggling(null); load()
    } catch (e) { showToast('Could not update: ' + e.message, { type: 'error' }); setToggling(null) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end' }}>
        <Input label="Search name" value={filters.q} onChange={(v) => setFilters({ ...filters, q: v })} placeholder="Business name" style={{ flex: '2 1 180px' }} />
        <Input label="State" value={filters.state} onChange={(v) => setFilters({ ...filters, state: v })} placeholder="e.g. Lagos" style={{ flex: '1 1 120px' }} />
        <Select label="Category" value={filters.categoryId} onChange={(v) => setFilters({ ...filters, categoryId: v })} placeholder="All" options={topCats.map((c) => ({ value: c.id, label: c.name }))} style={{ flex: '1 1 160px' }} />
        <Select label="Verification" value={filters.verification} onChange={(v) => setFilters({ ...filters, verification: v })} placeholder="All" options={VERIFICATION_STATUSES.map((s) => ({ value: s, label: s }))} style={{ flex: '1 1 130px' }} />
        <Select label="Status" value={filters.active} onChange={(v) => setFilters({ ...filters, active: v || 'true' })} placeholder="Active" options={[{ value: 'true', label: 'Active' }, { value: 'false', label: 'Inactive' }, { value: 'all', label: 'All' }]} style={{ flex: '1 1 110px' }} />
        <Button variant="primary" size="md" onClick={() => setEditing({})}><Plus size={14} aria-hidden="true" /> Add business</Button>
      </div>

      {loading ? <Loading text="Loading directory..." />
        : error ? <ErrorState message={error} onRetry={load} />
        : rows.length === 0 ? <Empty title="No businesses found" description="Adjust the filters, add a business, or import a CSV." />
        : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {rows.map((r) => (
              <li key={r.id} style={{ border: '1px solid var(--border)', borderRadius: 10, background: 'var(--panel)', padding: 12, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', opacity: r.is_active ? 1 : 0.6 }}>
                <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, overflowWrap: 'anywhere' }}>{r.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', overflowWrap: 'anywhere' }}>
                    {[catName(r.category_id), r.city, r.state].filter(Boolean).join(' · ') || 'No category or location'}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                    {r.latitude == null ? 'No coordinates' : r.latitude.toFixed(4) + ', ' + r.longitude.toFixed(4)} · source: {r.data_source}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  <Pill label={r.verification_status} type={VERIF_PILL[r.verification_status] || 'gray'} />
                  {!r.is_active && <Pill label="inactive" type="gray" />}
                  <Button variant="ghost" size="sm" aria-label={'Edit ' + r.name} onClick={() => setEditing({ id: r.id })}><Pencil size={14} aria-hidden="true" /> Edit</Button>
                  <Button variant="ghost" size="sm" aria-label={'Verification for ' + r.name} onClick={() => setVerifying(r)}><ShieldCheck size={14} aria-hidden="true" /> Verify</Button>
                  <Button variant="ghost" size="sm" aria-label={'History for ' + r.name} onClick={() => setHistory(r)}><History size={14} aria-hidden="true" /> History</Button>
                  <Button variant="ghost" size="sm" aria-label={(r.is_active ? 'Deactivate ' : 'Reactivate ') + r.name} onClick={() => setToggling(r)}><Power size={14} aria-hidden="true" /> {r.is_active ? 'Deactivate' : 'Reactivate'}</Button>
                </div>
              </li>
            ))}
          </ul>
        )}

      {!loading && !error && (page > 0 || hasMore) && (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', alignItems: 'center' }}>
          <Button variant="ghost" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>Page {page + 1}</span>
          <Button variant="ghost" size="sm" disabled={!hasMore} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      )}

      {editing && <EditModal id={editing.id} categories={categories} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); showToast('Saved', { type: 'success' }); load() }} />}
      {verifying && <VerifyModal row={verifying} onClose={() => setVerifying(null)} onDone={() => { setVerifying(null); showToast('Verification updated', { type: 'success' }); load() }} />}
      {history && <HistoryModal row={history} onClose={() => setHistory(null)} />}
      <ConfirmDialog show={!!toggling} onClose={() => setToggling(null)} onConfirm={toggleActive} danger={!!(toggling && toggling.is_active)}
        title={toggling && toggling.is_active ? 'Deactivate this business?' : 'Reactivate this business?'}
        consequence={toggling && toggling.is_active ? 'It will disappear from company searches. The record and its history are kept.' : 'It will appear in company searches again.'}
        confirmLabel={toggling && toggling.is_active ? 'Deactivate' : 'Reactivate'} />
      <Toast msg={msg} type={type} actionLabel={actionLabel} onAction={onAction} />
    </div>
  )
}

function EditModal({ id, categories, onClose, onSaved }) {
  const [form, setForm] = useState(EMPTY_FORM)
  const [loading, setLoading] = useState(!!id)
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [dupes, setDupes] = useState(null) // null | candidate rows awaiting an explicit "add anyway"
  const [formError, setFormError] = useState('')
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }))

  useEffect(() => {
    if (!id) return
    let live = true
    Promise.all([repo.get(id), repo.getPrivate(id).catch(() => null)]).then(([row, priv]) => {
      if (!live) return
      if (!row) { setFormError('This business no longer exists.'); setLoading(false); return }
      setForm({ ...EMPTY_FORM, ...Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v == null ? '' : String(v)])), contact_person: (priv && priv.contact_person) || '', notes: (priv && priv.notes) || '' })
      setLoading(false)
    }).catch((e) => { if (live) { setFormError(e.message); setLoading(false) } })
    return () => { live = false }
  }, [id])

  const topCats = categories.filter((c) => !c.parent_id)
  const subCats = categories.filter((c) => c.parent_id && c.parent_id === form.category_id)

  async function save(confirmedDuplicate) {
    const v = validateDirectoryRecord(form)
    setErrors(v.errors); setFormError('')
    if (!v.ok) return
    setSaving(true)
    try {
      if (!id && !confirmedDuplicate) {
        const keys = duplicateKeys(v.record)
        const found = await repo.findPossibleDuplicates({ nameNormalized: keys.name, phoneNormalized: keys.phone })
        if (found.length) { setDupes(found); setSaving(false); return }
      }
      const saved = id ? (await repo.update(id, form), { id }) : await repo.create(form)
      const savedId = saved && saved.id
      if (savedId && (form.contact_person || form.notes)) await repo.savePrivate(savedId, form)
      onSaved()
    } catch (e) {
      if (e.fields) setErrors(e.fields)
      else setFormError(e.message || 'Could not save.')
    } finally { setSaving(false) }
  }

  return (
    <Modal show onClose={onClose} title={id ? 'Edit business' : 'Add business'} wide
      footer={<><Button variant="ghost" size="sm" onClick={onClose} style={{ flex: 1 }}>Cancel</Button><Button variant="primary" size="md" disabled={saving || loading} onClick={() => save(!!dupes)} style={{ flex: 1 }}>{saving ? 'Saving...' : dupes ? 'Add anyway' : 'Save'}</Button></>}>
      {loading ? <Loading text="Loading..." /> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {formError && <div role="alert" style={{ color: 'var(--danger, #b91c1c)', fontSize: 13 }}>{formError}</div>}
          {dupes && (
            <div role="alert" style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 10, fontSize: 13 }}>
              <strong>Possible duplicates already in the directory:</strong>
              <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{dupes.map((d) => <li key={d.id}>{d.name}{d.city ? ', ' + d.city : ''} ({d.verification_status})</li>)}</ul>
              <div style={{ marginTop: 6 }}>Nothing was saved. Edit the details, or choose Add anyway to create a separate record.</div>
            </div>
          )}
          <Input label="Business name" required value={form.name} onChange={set('name')} error={errors.name} />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Select label="Category" value={form.category_id} onChange={(v) => setForm((f) => ({ ...f, category_id: v, subcategory_id: '' }))} placeholder="None" options={topCats.map((c) => ({ value: c.id, label: c.name }))} style={{ flex: '1 1 180px' }} />
            <Select label="Subcategory" value={form.subcategory_id} onChange={set('subcategory_id')} placeholder="None" options={subCats.map((c) => ({ value: c.id, label: c.name }))} error={errors.subcategory_id} style={{ flex: '1 1 180px' }} />
          </div>
          <Input label="Address" value={form.address} onChange={set('address')} />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Input label="City or town" value={form.city} onChange={set('city')} style={{ flex: '1 1 140px' }} />
            <Input label="State" value={form.state} onChange={set('state')} style={{ flex: '1 1 140px' }} />
            <Input label="LGA" value={form.lga} onChange={set('lga')} style={{ flex: '1 1 140px' }} />
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Input label="Latitude" value={form.latitude} onChange={set('latitude')} error={errors.latitude} helperText="Leave both blank if unknown. Never guess." style={{ flex: '1 1 140px' }} />
            <Input label="Longitude" value={form.longitude} onChange={set('longitude')} style={{ flex: '1 1 140px' }} />
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Input label="Phone" value={form.phone} onChange={set('phone')} error={errors.phone} style={{ flex: '1 1 160px' }} />
            <Input label="Email" value={form.email} onChange={set('email')} error={errors.email} style={{ flex: '1 1 180px' }} />
            <Input label="Website" value={form.website} onChange={set('website')} error={errors.website} style={{ flex: '1 1 180px' }} />
          </div>
          <Textarea label="Description" value={form.description} onChange={set('description')} />
          <fieldset style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 10 }}>
            <legend style={{ fontSize: 12, color: 'var(--muted)' }}>Private to directory administrators</legend>
            <Input label="Contact person" value={form.contact_person} onChange={set('contact_person')} />
            <Textarea label="Internal notes" value={form.notes} onChange={set('notes')} />
          </fieldset>
        </div>
      )}
    </Modal>
  )
}

function VerifyModal({ row, onClose, onDone }) {
  const [status, setStatus] = useState(row.verification_status)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  async function go() {
    setSaving(true); setErr('')
    try { await repo.setVerification(row.id, status, note); onDone() }
    catch (e) { setErr(e.message || 'Could not change verification.') }
    finally { setSaving(false) }
  }
  return (
    <Modal show onClose={onClose} title={'Verification: ' + row.name}
      footer={<><Button variant="ghost" size="sm" onClick={onClose} style={{ flex: 1 }}>Cancel</Button><Button variant="primary" size="md" disabled={saving || status === row.verification_status} onClick={go} style={{ flex: 1 }}>{saving ? 'Saving...' : 'Apply'}</Button></>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>Only mark a business verified after checking it against a trusted source. Your name and the time are recorded.</p>
        {err && <div role="alert" style={{ color: 'var(--danger, #b91c1c)', fontSize: 13 }}>{err}</div>}
        <Select label="Status" value={status} onChange={(v) => setStatus(v || row.verification_status)} placeholder="Status" options={VERIFICATION_STATUSES.map((s) => ({ value: s, label: s }))} />
        <Textarea label="Note (what was checked)" value={note} onChange={setNote} />
      </div>
    </Modal>
  )
}

function HistoryModal({ row, onClose }) {
  const [items, setItems] = useState(null)
  const [err, setErr] = useState('')
  useEffect(() => { repo.history(row.id).then(setItems).catch((e) => setErr(e.message)) }, [row.id])
  return (
    <Modal show onClose={onClose} title={'History: ' + row.name} wide>
      {err ? <ErrorState message={err} /> : !items ? <Loading text="Loading history..." />
        : items.length === 0 ? <Empty title="No history yet" />
        : <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {items.map((h) => (
            <li key={h.id} style={{ fontSize: 13, borderBottom: '1px solid var(--border)', paddingBottom: 6 }}>
              <strong>{h.action}</strong> · {new Date(h.created_at).toLocaleString()}
              <div style={{ color: 'var(--muted)', fontSize: 12 }}>by {h.actor_id ? h.actor_id.slice(0, 8) : 'system'}{h.note ? ' · ' + h.note : ''}</div>
            </li>
          ))}
        </ul>}
    </Modal>
  )
}
