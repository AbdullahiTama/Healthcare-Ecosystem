import { useState, useEffect, useCallback } from 'react'
import { Search, RefreshCw, Building2, Users, CheckCircle, XCircle, Clock, ExternalLink } from 'lucide-react'
import { Card, GhostBtn, TealBtn, Loading, Empty, ErrorState, useToast, Toast, ConfirmDialog } from '../../../components/ui'
import { createTrustRepository } from '../../../modules/trust/repositories'

function timeAgo(s) {
  if (!s) return '—'
  const diff = Math.floor((Date.now() - new Date(s)) / 1000)
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

export default function Claims({ repository = createTrustRepository() }) {
  const [businessClaims, setBusinessClaims] = useState(null)
  const [staffClaims, setStaffClaims] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('all') // all | business | staff
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('pending')
  const [busyId, setBusyId] = useState(null)
  const { msg, type, show: showToast } = useToast()
  const [confirm, setConfirm] = useState(null) // { id, kind: 'approve'|'reject', type: 'business'|'staff' }

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [b, s] = await Promise.all([
        repository.getBusinessClaims({ status: statusFilter || undefined, limit: 50 }),
        repository.getStaffClaims({ status: statusFilter || undefined, limit: 50 }),
      ])
      setBusinessClaims(Array.isArray(b) ? b : [])
      setStaffClaims(Array.isArray(s) ? s : [])
    } catch (e) { setError(e.message) }
    setLoading(false)
  }, [repository, statusFilter])
  useEffect(() => { load() }, [load])

  const all = (() => {
    const b = (businessClaims || []).map(r => ({ ...r, _type: 'business', _label: r.businesses?.name || r.business_id?.slice(0, 8) || 'Business claim', _who: r.claimant_name || r.email || r.user_id?.slice(0, 8) || '—' }))
    const s = (staffClaims || []).map(r => ({ ...r, _type: 'staff', _label: r.staff_name || r.email || r.staff_id?.slice(0, 8) || 'Staff claim', _who: r.claimant_name || r.email || '—' }))
    let list = [...b, ...s].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    if (filter !== 'all') list = list.filter(x => x._type === filter)
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter(x => `${x._label} ${x._who} ${x.business_id} ${x.staff_id}`.toLowerCase().includes(q))
    }
    return list
  })()

  const doAction = async () => {
    if (!confirm) return
    const { id, kind, type } = confirm
    setBusyId(id)
    try {
      const patch = kind === 'approve' ? { status: 'approved' } : { status: 'rejected' }
      if (type === 'business') await repository.updateBusinessClaim(id, patch)
      else await repository.updateStaffClaim(id, patch)
      await repository.logModeration({ target_type: 'claim', target_id: id, action: kind === 'approve' ? 'approve' : 'reject', reason: `${type} claim ${kind}`, actor_admin_id: null }).catch(() => {})
      showToast(`${type} claim ${kind}d`, { type: 'success' })
      setConfirm(null)
      load()
    } catch (e) { showToast(e.message, { type: 'error' }) }
    setBusyId(null)
  }

  if (loading && businessClaims == null) return <Loading />
  if (error) return <ErrorState message={error} onRetry={load} />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Card style={{ padding: 12, background: 'var(--panel)', border: '1px solid var(--border)', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {[
            { id: 'all', label: `All (${(businessClaims?.length || 0) + (staffClaims?.length || 0)})` },
            { id: 'business', label: `Business (${businessClaims?.length || 0})` },
            { id: 'staff', label: `Staff (${staffClaims?.length || 0})` },
          ].map(f => (
            <button key={f.id} onClick={() => setFilter(f.id)} style={{ padding: '7px 12px', borderRadius: 8, border: filter === f.id ? '1px solid var(--teal)' : '1px solid var(--border)', background: filter === f.id ? 'var(--teal-mist)' : 'var(--panel)', color: filter === f.id ? 'var(--teal)' : 'var(--muted)', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>{f.label}</button>
          ))}
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} aria-label="Filter status" style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--fg)', fontSize: 12 }}>
            <option value="pending">pending</option>
            <option value="approved">approved</option>
            <option value="rejected">rejected</option>
            <option value="">all</option>
          </select>
        </div>
        <GhostBtn onClick={load}><RefreshCw size={12} style={{ marginRight: 6 }} />Refresh</GhostBtn>
      </Card>

      <Card style={{ padding: 12, background: 'var(--panel)', border: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: 1, maxWidth: 360 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search claim / business / staff" aria-label="Search claims" style={{ width: '100%', padding: '9px 12px 9px 30px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--fg)', fontSize: 13 }} />
        </div>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>{all.length} claims</span>
      </Card>

      {all.length === 0 ? (
        <Card style={{ padding: 32, background: 'var(--panel)', border: '1px solid var(--border)', textAlign: 'center' }}><Empty icon={filter === 'staff' ? <Users size={28} /> : <Building2 size={28} />} message={search ? 'No claims match search.' : `No ${statusFilter || 'all'} ${filter} claims.`} /></Card>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {all.map(r => (
            <Card key={`${r._type}:${r.id}`} style={{ padding: 12, background: 'var(--panel)', border: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              <div>
                <div style={{ fontWeight: 800, fontSize: 13, color: 'var(--fg)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  {r._type === 'business' ? <Building2 size={13} /> : <Users size={13} />} {r._label} <span style={{ fontWeight: 600, fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', background: 'var(--hairline)', padding: '2px 6px', borderRadius: 6 }}>{r._type}</span>
                  <span style={{ fontSize: 11, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 4 }}><Clock size={11} />{timeAgo(r.created_at)} • {r.status}</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>{r._who} {r.business_id ? `• biz ${r.business_id.slice(0, 8)}` : ''} {r.staff_id ? `• staff ${r.staff_id.slice(0, 8)}` : ''}</div>
                {r.business_id && <div style={{ fontSize: 11, color: 'var(--teal)', display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}><ExternalLink size={11} /> Business 360: {r.business_id.slice(0, 8)} — open Businesses → select</div>}
              </div>
              {statusFilter === 'pending' && (
                <div style={{ display: 'flex', gap: 6 }}>
                  <button disabled={busyId === r.id} onClick={() => setConfirm({ id: r.id, kind: 'approve', type: r._type })} style={{ padding: '6px 12px', borderRadius: 8, border: 'none', background: 'var(--green)', color: 'white', fontWeight: 700, fontSize: 12, cursor: busyId ? 'not-allowed' : 'pointer' }}><CheckCircle size={11} style={{ marginRight: 4 }} />Approve</button>
                  <button disabled={busyId === r.id} onClick={() => setConfirm({ id: r.id, kind: 'reject', type: r._type })} style={{ padding: '6px 12px', borderRadius: 8, border: 'none', background: 'var(--red)', color: 'white', fontWeight: 700, fontSize: 12, cursor: busyId ? 'not-allowed' : 'pointer' }}><XCircle size={11} style={{ marginRight: 4 }} />Reject</button>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      <ConfirmDialog show={!!confirm} title={`${confirm?.kind === 'approve' ? 'Approve' : 'Reject'} ${confirm?.type} claim?`} onClose={() => setConfirm(null)} onConfirm={doAction} confirmLabel={busyId ? 'Saving...' : confirm?.kind === 'approve' ? 'Approve' : 'Reject'} variant={confirm?.kind === 'approve' ? 'default' : 'danger'} message={<div style={{ fontSize: 13 }}>This updates <code>{confirm?.type}_claims.status</code> and is audited to <code>moderation_actions</code>. {confirm?.kind === 'approve' && confirm?.type === 'business' ? 'Business will become visible on CareFind.' : ''}</div>} />
      <Toast msg={msg} type={type} />
    </div>
  )
}
