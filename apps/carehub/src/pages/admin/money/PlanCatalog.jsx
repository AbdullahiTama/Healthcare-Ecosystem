import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, Plus, Trash2, Edit3, CheckCircle, AlertTriangle } from 'lucide-react'
import { Card, GhostBtn, TealBtn, Inp, Sel, Loading, Empty, ErrorState, useToast, Toast, ConfirmDialog } from '../../../components/ui'
import { createMoneyRepository, koboToNaira } from '../../../modules/money/repositories'

export default function PlanCatalog({ repository = createMoneyRepository() }) {
  const [plans, setPlans] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [editing, setEditing] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [form, setForm] = useState({ key: '', name: '', price_kobo: 0, billing_cycle: 'monthly', trial_days: 0, entitlements: '{}', is_active: true })
  const [busy, setBusy] = useState(false)
  const { msg, type, show: showToast } = useToast()

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const rows = await repository.getPlans({ includeInactive: true })
      setPlans(Array.isArray(rows) ? rows : [])
    } catch (e) { setError(e.message) }
    setLoading(false)
  }, [repository])
  useEffect(() => { load() }, [load])

  const handleCreate = async () => {
    if (!form.key.trim() || !form.name.trim()) { showToast('Key and name required', { type: 'error' }); return }
    let entitlements
    try { entitlements = form.entitlements.trim() ? JSON.parse(form.entitlements) : {} } catch { showToast('Entitlements must be valid JSON', { type: 'error' }); return }
    setBusy(true)
    try {
      await repository.createPlan({ key: form.key.trim(), name: form.name.trim(), price_kobo: Number(form.price_kobo) || 0, billing_cycle: form.billing_cycle, trial_days: Number(form.trial_days) || 0, entitlements, is_active: !!form.is_active })
      showToast('Plan created', { type: 'success' }); setShowNew(false); setForm({ key: '', name: '', price_kobo: 0, billing_cycle: 'monthly', trial_days: 0, entitlements: '{}', is_active: true }); load()
    } catch (e) { showToast(e.message, { type: 'error' }) }
    setBusy(false)
  }
  const handleUpdate = async () => {
    if (!editing) return
    let entitlements
    try { entitlements = form.entitlements.trim() ? JSON.parse(form.entitlements) : {} } catch { showToast('Entitlements JSON invalid', { type: 'error' }); return }
    setBusy(true)
    try {
      await repository.updatePlan(editing.key, { name: form.name.trim(), price_kobo: Number(form.price_kobo) || 0, billing_cycle: form.billing_cycle, trial_days: Number(form.trial_days) || 0, entitlements, is_active: !!form.is_active })
      showToast('Plan updated', { type: 'success' }); setEditing(null); load()
    } catch (e) { showToast(e.message, { type: 'error' }) }
    setBusy(false)
  }
  const handleDelete = async () => {
    if (!confirmDelete) return
    setBusy(true)
    try { await repository.deletePlan(confirmDelete.key); showToast('Plan deleted', { type: 'success' }); setConfirmDelete(null); load() } catch (e) { showToast(e.message, { type: 'error' }) }
    setBusy(false)
  }

  if (loading && plans == null) return <Loading />
  if (error) return <ErrorState message={error} onRetry={load} />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Card style={{ padding: 12, background: 'var(--panel)', border: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ fontWeight: 800, fontSize: 13, color: 'var(--fg)' }}>Plan Catalog <span style={{ fontSize: 11, background: 'var(--hairline)', padding: '2px 6px', borderRadius: 6, color: 'var(--muted)' }}>{plans.length} plans • price in kobo → ₦</span></div>
        <div style={{ display: 'flex', gap: 8 }}>
          <GhostBtn onClick={load}><RefreshCw size={12} style={{ marginRight: 6 }} />Refresh</GhostBtn>
          <TealBtn onClick={() => { setShowNew(true); setEditing(null); setForm({ key: '', name: '', price_kobo: 0, billing_cycle: 'monthly', trial_days: 0, entitlements: '{}', is_active: true }) }}><Plus size={12} style={{ marginRight: 6 }} />New plan</TealBtn>
        </div>
      </Card>

      {plans.length === 0 ? (
        <Card style={{ padding: 32, background: 'var(--panel)', border: '1px solid var(--border)', textAlign: 'center' }}><Empty icon={<CheckCircle size={24} />} message="No plans — seed basic/pro/enterprise or create one." /></Card>
      ) : (
        <Card style={{ padding: 0, overflow: 'hidden', background: 'var(--panel)', border: '1px solid var(--border)' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead style={{ background: 'var(--panel)', borderBottom: '1px solid var(--border)' }}>
                <tr style={{ height: 36 }}>
                  <th style={{ padding: '0 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>Key</th>
                  <th style={{ padding: '0 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>Name</th>
                  <th style={{ padding: '0 12px', textAlign: 'right', fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>Price</th>
                  <th style={{ padding: '0 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>Cycle</th>
                  <th style={{ padding: '0 12px', textAlign: 'center', fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>Active</th>
                  <th style={{ padding: '0 12px', textAlign: 'right', fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {plans.map(p => (
                  <tr key={p.key} style={{ height: 36, borderBottom: '1px solid var(--hairline)' }}>
                    <td style={{ padding: '0 12px', fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--fg)' }}>{p.key}</td>
                    <td style={{ padding: '0 12px', color: 'var(--fg)' }}>{p.name}</td>
                    <td style={{ padding: '0 12px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--fg)' }}>{koboToNaira(p.price_kobo)}</td>
                    <td style={{ padding: '0 12px', color: 'var(--muted)' }}>{p.billing_cycle}{p.trial_days ? ` • ${p.trial_days}d trial` : ''}</td>
                    <td style={{ padding: '0 12px', textAlign: 'center' }}>{p.is_active ? <CheckCircle size={14} style={{ color: 'var(--green)' }} /> : <AlertTriangle size={14} style={{ color: 'var(--amber)' }} />}</td>
                    <td style={{ padding: '0 12px', textAlign: 'right' }}>
                      <button onClick={() => { setEditing(p); setShowNew(false); setForm({ key: p.key, name: p.name, price_kobo: p.price_kobo, billing_cycle: p.billing_cycle, trial_days: p.trial_days, entitlements: JSON.stringify(p.entitlements || {}, null, 2), is_active: !!p.is_active }) }} style={{ padding: '5px 8px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--panel)', cursor: 'pointer', marginRight: 6 }}><Edit3 size={12} /></button>
                      <button onClick={() => setConfirmDelete(p)} style={{ padding: '5px 8px', borderRadius: 8, border: '1px solid var(--red)', background: 'var(--panel)', color: 'var(--red)', cursor: 'pointer' }}><Trash2 size={12} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {(showNew || editing) && (
        <Card style={{ padding: 16, background: 'var(--panel)', border: '1px solid var(--teal)' }}>
          <div style={{ fontWeight: 800, fontSize: 13, color: 'var(--fg)', marginBottom: 10 }}>{editing ? `Edit ${editing.key}` : 'New plan'}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 10 }}>
            <Inp label="Key * (e.g. pro)" value={form.key} onChange={v => setForm(s => ({ ...s, key: v }))} placeholder="basic" />
            <Inp label="Name *" value={form.name} onChange={v => setForm(s => ({ ...s, name: v }))} placeholder="Pro" />
            <Inp label="Price kobo * (1500000 = ₦15,000)" value={String(form.price_kobo)} onChange={v => setForm(s => ({ ...s, price_kobo: v }))} />
            <Sel label="Cycle" value={form.billing_cycle} onChange={v => setForm(s => ({ ...s, billing_cycle: v }))} options={[{ value: 'monthly', label: 'monthly' }, { value: 'yearly', label: 'yearly' }, { value: 'lifetime', label: 'lifetime' }]} />
            <Inp label="Trial days" value={String(form.trial_days)} onChange={v => setForm(s => ({ ...s, trial_days: v }))} />
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: 'var(--fg)', marginTop: 18 }}><input type="checkbox" checked={form.is_active} onChange={e => setForm(s => ({ ...s, is_active: e.target.checked }))} /> Active</label>
          </div>
          <label style={{ display: 'block', marginTop: 10, fontSize: 13 }}><span style={{ fontWeight: 600, color: 'var(--fg)' }}>Entitlements JSON</span><textarea value={form.entitlements} onChange={e => setForm(s => ({ ...s, entitlements: e.target.value }))} rows={4} style={{ width: '100%', marginTop: 6, padding: 10, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--fg)', fontFamily: 'var(--font-mono)', fontSize: 12 }} placeholder='{"pharmacy":true,"hospital":true,"branches":3}' /></label>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <GhostBtn onClick={() => { setShowNew(false); setEditing(null) }} style={{ flex: 1 }}>Cancel</GhostBtn>
            {editing ? <TealBtn disabled={busy} onClick={handleUpdate} style={{ flex: 1 }}>{busy ? 'Saving...' : 'Save'}</TealBtn> : <TealBtn disabled={busy} onClick={handleCreate} style={{ flex: 1 }}>{busy ? 'Creating...' : 'Create'}</TealBtn>}
          </div>
        </Card>
      )}

      <ConfirmDialog show={!!confirmDelete} title={`Delete ${confirmDelete?.key}?`} onClose={() => setConfirmDelete(null)} onConfirm={handleDelete} confirmLabel={busy ? 'Deleting...' : 'Delete'} variant="danger" message={<div style={{ fontSize: 13 }}>Only if zero subscribers. Audited.</div>} />
      <Toast msg={msg} type={type} />
    </div>
  )
}
