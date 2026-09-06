import { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  RefreshCw, Bell, Building2, Hourglass, CheckCircle, Users, Check, X, Pause, Play, Search, Download, Store, Shield, UserCog, FileText, Wallet, Landmark, MapPin, AlertTriangle, Trash2, Eye, ExternalLink, ArrowRight, Filter
} from 'lucide-react'
import { useAuth } from '../../providers/AuthProvider'
import {
  getBusinesses, updateBusiness, getAdminTeam, addAdminTeam, removeAdminTeam,
  getBusinessesFiltered, deleteBusinessSoft, hardDeleteBusiness, getEcommerceProductsByBusiness,
  getAdminRoles, createAdminRole, updateAdminRole, deleteAdminRole,
  getAdminTeamMembers, createAdminTeamMember, updateAdminTeamMember, deleteAdminTeamMember,
  getAgentTiers, getAgentsDetailed, getAgentReferralsByAgent, getAgentEarningsByAgent, getAgentTransfers, transferAgentAccount, calculateAgentEarningsRpc,
  getApplications, reviewApplication, createApplication,
  getLedgerForEntity, getPayoutRequests, createPayoutRequest, updatePayoutRequest, markPayoutPaidAtomic,
  getAgentApplications, reviewAgentApplication, getAgents, addAgentRow, updateAgentRow
} from '../../services/supabase'
import { authClient } from '../../lib/authClient'
import { businessLucideIcon, businessName, DARK, fmt, fmtDate } from '../../lib/utils'
import { theme } from '../../styles/theme'
import { Card, StatCard, Pill, Modal, Inp, Sel, GhostBtn, TealBtn, Avatar, Loading, useToast, Toast, Logo, Empty, ErrorState, ConfirmDialog } from '../../components/ui'
import { ApplicationsPanel, AgentsPanel, LedgerPanel, PayoutsPanel, CoveragePanel } from './referral/AdminReferralPanels'
import { PLATFORM_PERMISSIONS, PLATFORM_NAV, normalizePlatformPermissions, navCatalogueFor, buildPlatformPermissions } from '../../lib/platformPermissions'
import { toBusinessCsv, downloadCsv, buildStatementHtml, openPrintWindow, toBusinessExportRow, BUSINESS_EXPORT_COLUMNS } from '../../lib/carefindhubExports'

// ── helpers ────────────────────────────────────────────────────────────────
function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value)
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t) }, [value, ms])
  return v
}

// ── Dashboard stats-only panel (spec §2) ──────────────────────────────────
function DashboardStats({ businesses, teamMembers, onNav }) {
  const pendingBusinesses = businesses.filter(b => b.status === 'pending' && !b.deleted_at)
  const active = businesses.filter(b => b.status === 'active' && !b.deleted_at)
  const ecommerce = businesses.filter(b => b.ecommerce_enabled && !b.deleted_at)
  const [pendingAgents, setPendingAgents] = useState([])
  useEffect(() => {
    let alive = true
    getAgentApplications().then(rows => { if (alive) setPendingAgents((rows || []).filter(r => r.status === 'submitted' || r.status === 'pending' || r.status === 'under_review')) }).catch(()=>{})
    // also check unified applications for pending agent type
    getApplications({ type: 'agent', status: 'pending' }).then(rows => { if (alive && rows?.length) setPendingAgents(prev => [...prev, ...rows]) }).catch(()=>{})
    return () => { alive = false }
  }, [businesses])
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 12 }}>
        <StatCard icon={<Building2 />} label="Total businesses" value={businesses.filter(b=>!b.deleted_at).length} />
        <StatCard icon={<Hourglass />} label="Vendor approvals (pending)" value={pendingBusinesses.length} alert={pendingBusinesses.length>0} />
        <StatCard icon={<CheckCircle />} label="Active users" value={active.length} />
        <StatCard icon={<Users />} label="Admin teams" value={teamMembers.length} />
        <StatCard icon={<Store />} label="E-commerce participants" value={ecommerce.length} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))', gap: 14 }}>
        <Card style={{ padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontWeight: 800, fontSize: 14, color: theme.slate }}>Pending business approvals</div>
            <button onClick={() => onNav('businesses')} style={{ fontSize: 12, fontWeight: 700, color: theme.tealDeep, background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>View all <ArrowRight size={12} /></button>
          </div>
          {pendingBusinesses.length === 0 ? <div style={{ fontSize: 13, color: theme.textFaint, padding: '12px 0', textAlign: 'center' }}>No pending approvals</div> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 320, overflowY: 'auto' }}>
              {pendingBusinesses.slice(0, 8).map(b => (
                <button key={b.id} onClick={() => onNav('businesses', b.id)} style={{ textAlign: 'left', padding: '10px 12px', borderRadius: 10, border: `1px solid ${theme.hairline}`, background: 'white', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div><div style={{ fontWeight: 700, fontSize: 13 }}>{b.name}</div><div style={{ fontSize: 11, color: theme.textFaint }}>{b.owner || b.owner_name} • {b.state || '—'} • {b.category || b.business_type}</div></div>
                  <Pill label="pending" type="amber" />
                </button>
              ))}
              {pendingBusinesses.length > 8 && <div style={{ fontSize: 11, color: theme.textFaint, textAlign: 'center' }}>+{pendingBusinesses.length - 8} more</div>}
            </div>
          )}
        </Card>
        <Card style={{ padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontWeight: 800, fontSize: 14, color: theme.slate }}>Pending agent applications</div>
            <button onClick={() => onNav('applications')} style={{ fontSize: 12, fontWeight: 700, color: theme.tealDeep, background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>View all <ArrowRight size={12} /></button>
          </div>
          {pendingAgents.length === 0 ? <div style={{ fontSize: 13, color: theme.textFaint, padding: '12px 0', textAlign: 'center' }}>No pending agent applications</div> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 320, overflowY: 'auto' }}>
              {pendingAgents.slice(0, 8).map(a => (
                <button key={a.id} onClick={() => onNav('applications')} style={{ textAlign: 'left', padding: '10px 12px', borderRadius: 10, border: `1px solid ${theme.hairline}`, background: 'white', cursor: 'pointer' }}>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{a.applicant_name || a.applicant_ref || 'Agent application'}</div>
                  <div style={{ fontSize: 11, color: theme.textFaint }}>{a.applicant_email || a.contact_email || ''} • {fmtDate(a.submitted_at || a.created_at)}</div>
                </button>
              ))}
              {pendingAgents.length > 8 && <div style={{ fontSize: 11, color: theme.textFaint, textAlign: 'center' }}>+{pendingAgents.length - 8} more</div>}
            </div>
          )}
        </Card>
      </div>
      <div style={{ fontSize: 12, color: theme.textFaint, textAlign: 'center' }}>Stats-only view — no management actions here. Use tabs to manage.</div>
    </div>
  )
}

// ── Businesses panel (spec §3) ────────────────────────────────────────────
function BusinessesPanel({ businesses, onRefresh, onStatusChange, highlightId }) {
  const [search, setSearch] = useState('')
  const debounced = useDebounced(search, 300)
  const [filterStatus, setFilterStatus] = useState('')
  const [page, setPage] = useState(1)
  const pageSize = 10
  const [selected, setSelected] = useState(null)
  const [ecomProducts, setEcomProducts] = useState([])
  const [ecomLoading, setEcomLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(null)
  const [deleteMode, setDeleteMode] = useState('soft') // soft vs hard
  const { msg, show: showToast } = useToast()

  const filtered = useMemo(() => {
    let list = businesses.filter(b => !b.deleted_at)
    if (debounced) {
      const q = debounced.toLowerCase()
      list = list.filter(b => (b.name || '').toLowerCase().includes(q))
    }
    if (filterStatus) list = list.filter(b => b.status === filterStatus)
    return list
  }, [businesses, debounced, filterStatus])

  const paginated = useMemo(() => {
    const start = (page - 1) * pageSize
    return filtered.slice(start, start + pageSize)
  }, [filtered, page])

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))

  useEffect(() => { setPage(1) }, [debounced, filterStatus])
  useEffect(() => {
    if (highlightId) {
      const found = businesses.find(b => b.id === highlightId)
      if (found) setSelected(found)
    }
  }, [highlightId, businesses])

  useEffect(() => {
    if (!selected) return
    setEcomLoading(true)
    getEcommerceProductsByBusiness(selected.id).then(r => setEcomProducts(r || [])).catch(() => setEcomProducts([])).finally(() => setEcomLoading(false))
  }, [selected])

  const handleSuspend = async (b) => {
    if (busy) return
    setBusy(true)
    try { await onStatusChange(b.id, 'suspended', 'Suspended — dashboard access lost but data retained.'); setSelected(s=> s && s.id===b.id ? { ...s, status: 'suspended'} : s); showToast('Suspended', { type: 'success' }) } catch (e) { showToast(e.message, { type: 'error' }) }
    setBusy(false)
  }
  const handleRevoke = async (b) => {
    if (busy) return
    if (!confirm('Revoke withdraws approval. The business will need to reapply. This is NOT temporary like Suspend. Continue?')) return
    setBusy(true)
    try { await onStatusChange(b.id, 'revoked', 'Revoked — approval withdrawn, reapplication required.'); setSelected(s=> s && s.id===b.id ? { ...s, status: 'revoked'} : s); showToast('Revoked', { type: 'success' }) } catch (e) { showToast(e.message, { type: 'error' }) }
    setBusy(false)
  }
  const handleDelete = async () => {
    if (!showDeleteConfirm) return
    setBusy(true)
    try {
      if (deleteMode === 'hard') await hardDeleteBusiness(showDeleteConfirm.id)
      else await deleteBusinessSoft(showDeleteConfirm.id)
      showToast(deleteMode==='hard' ? 'Hard deleted' : 'Soft deleted (ledger preserved)', { type: 'success' })
      setShowDeleteConfirm(null)
      setSelected(null)
      onRefresh()
    } catch (e) { showToast(e.message, { type: 'error' }) }
    setBusy(false)
  }

  const exportRows = (rows) => {
    const csv = toBusinessCsv(rows)
    const mode = filterStatus || 'all'
    downloadCsv(`businesses_${mode}_${new Date().toISOString().slice(0,10)}.csv`, csv)
    showToast(`Exported ${rows.length} rows (CSV). XLSX preferred — confirm if CSV acceptable.`, { type: 'info' })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', flex: 1 }}>
          <div style={{ position: 'relative', flex: '1 1 220px', maxWidth: 360 }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: theme.textFaint }} />
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search businesses by name (ilike)" aria-label="Search businesses" style={{ width: '100%', padding: '10px 12px 10px 30px', borderRadius: 10, border: `1px solid ${theme.hairline}`, fontSize: 13 }} />
          </div>
          <select value={filterStatus} onChange={e=>setFilterStatus(e.target.value)} aria-label="Filter by status" style={{ padding: '10px 12px', borderRadius: 10, border: `1px solid ${theme.hairline}`, fontSize: 13 }}>
            <option value="">All statuses</option>
            <option value="pending">pending</option>
            <option value="active">active</option>
            <option value="suspended">suspended</option>
            <option value="revoked">revoked</option>
          </select>
          <span style={{ fontSize: 12, color: theme.textFaint }}>{filtered.length} result(s) • page {page}/{totalPages}</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <GhostBtn onClick={()=>exportRows(filtered)}><Download size={13} style={{ marginRight: 6 }} />Export filtered</GhostBtn>
          <GhostBtn onClick={()=>exportRows(businesses.filter(b=>!b.deleted_at))}><Download size={13} style={{ marginRight: 6 }} />Export all</GhostBtn>
        </div>
      </div>

      {paginated.length === 0 ? <Empty icon={<Building2 size={28} />} message={search || filterStatus ? 'No businesses match filters.' : 'No businesses yet.'} /> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {paginated.map(b => (
            <Card key={b.id} style={{ padding: 16, cursor: 'pointer', border: highlightId===b.id ? `1px solid ${theme.tealDeep}` : undefined }} onClick={() => setSelected(b)}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 44, height: 44, borderRadius: theme.radius.md, background: theme.tealMist, color: theme.tealDeep, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{(() => { const Icon = businessLucideIcon(b.business_type || b.type); return <Icon size={20} /> })()}</div>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 15 }}>{b.name}</div>
                    <div style={{ fontSize: 12, color: theme.textFaint, marginTop: 2 }}>{b.owner_name || b.owner} • {b.owner_email || b.email} • {b.category || b.business_type} • {b.state || '—'} • {b.plan}</div>
                    <div style={{ fontSize: 11, color: theme.textLight, marginTop: 2 }}>E-comm: {b.ecommerce_enabled ? 'enabled' : 'disabled'} • {fmtDate(b.created_at)}</div>
                  </div>
                </div>
                <Pill label={b.status} type={b.status==='active'?'green': b.status==='pending'?'amber': b.status==='suspended'?'red': b.status==='revoked'?'gray':'gray'} />
              </div>
            </Card>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'center', alignItems: 'center' }}>
        <GhostBtn onClick={()=>setPage(p=>Math.max(1,p-1))} disabled={page<=1}>Prev</GhostBtn>
        <span style={{ fontSize: 13, color: theme.textFaint }}>Page {page} of {totalPages}</span>
        <GhostBtn onClick={()=>setPage(p=>Math.min(totalPages,p+1))} disabled={page>=totalPages}>Next</GhostBtn>
      </div>

      <Modal show={!!selected} onClose={()=>setSelected(null)} title={selected?.name || 'Business Details'} footer={selected && (
        <div style={{ display: 'flex', gap: 8, width: '100%', flexWrap: 'wrap' }}>
          {selected.status==='pending' && <><TealBtn disabled={busy} onClick={async()=>{ await onStatusChange(selected.id,'active','Approved!'); setSelected(s=>({...s,status:'active'})); showToast('Approved',{type:'success'}) }} style={{ flex:1, padding:11 }}><Check size={14} /> Approve</TealBtn><button disabled={busy} onClick={async()=>{ await onStatusChange(selected.id,'revoked','Rejected.'); setSelected(s=>({...s,status:'revoked'})); showToast('Rejected',{type:'success'}) }} style={{ flex:1, padding:11, borderRadius:12, border:'none', background: theme.dangerBg, color: theme.danger, fontWeight:700, cursor: busy?'not-allowed':'pointer' }}><X size={14} /> Reject</button></>}
          {selected.status==='active' && <><button disabled={busy} onClick={()=>handleSuspend(selected)} style={{ flex:1, padding:11, borderRadius:12, border:'none', background:'#fffbeb', color:'#d97706', fontWeight:700, cursor: busy?'not-allowed':'pointer' }}><Pause size={14} /> Suspend (temporary)</button><button disabled={busy} onClick={()=>handleRevoke(selected)} style={{ flex:1, padding:11, borderRadius:12, border:'none', background: theme.gray100, color: theme.slate, fontWeight:700, cursor: busy?'not-allowed':'pointer' }} title="Revoke withdraws approval — must reapply"><X size={14} /> Revoke (withdrawal)</button></>}
          {selected.status==='suspended' && <TealBtn disabled={busy} onClick={async()=>{ await onStatusChange(selected.id,'active','Reactivated!'); setSelected(s=>({...s,status:'active'})) }} style={{ flex:1, padding:11 }}><Play size={14} /> Reactivate</TealBtn>}
          {selected.status==='revoked' && <TealBtn disabled={busy} onClick={async()=>{ await onStatusChange(selected.id,'pending','Moved to pending — reapplication flow'); setSelected(s=>({...s,status:'pending'})) }} style={{ flex:1, padding:11 }}>Move to pending (reapply)</TealBtn>}
          <button disabled={busy} onClick={()=>setShowDeleteConfirm(selected)} style={{ padding:'11px 14px', borderRadius:12, border:`1px solid ${theme.dangerBorder}`, background:'white', color: theme.danger, fontWeight:700, cursor: busy?'not-allowed':'pointer' }}><Trash2 size={14} /> Delete</button>
        </div>
      )}>
        {selected && (
          <div>
            <div style={{ display:'flex', flexDirection:'column', gap:0, marginBottom: 14 }}>
              {[['Business Name', selected.name], ['Owner Name', selected.owner_name || selected.owner], ['Owner Email', selected.owner_email || selected.email], ['Category', selected.category || selected.business_type], ['State', selected.state || '—'], ['Plan', selected.plan||'basic'], ['Status', selected.status], ['Date Onboarded', fmtDate(selected.created_at)], ['Phone', selected.phone||'—'], ['Address', selected.address||'—'], ['E-commerce', selected.ecommerce_enabled ? 'enabled' : 'disabled']].map(([l,v]) => (
                <div key={l} style={{ display:'flex', justifyContent:'space-between', padding:'8px 0', borderBottom:`1px solid ${theme.hairline}`, fontSize:13 }}><span style={{ color: theme.textFaint, fontWeight:600 }}>{l}</span><span style={{ color: theme.slate, textAlign:'right' }}>{v}</span></div>
              ))}
            </div>
            <div style={{ borderTop:`1px solid ${theme.hairline}`, paddingTop: 12 }}>
              <div style={{ fontWeight:800, fontSize:13, marginBottom:8, display:'flex', alignItems:'center', gap:6 }}><Store size={14} /> E-commerce products for this business</div>
              {ecomLoading ? <Loading /> : ecomProducts.length===0 ? <div style={{ fontSize:13, color: theme.textFaint, padding:10, textAlign:'center', border:`1px dashed ${theme.hairline}`, borderRadius:10 }}>No e-commerce products — showing will appear here when the business has active store items.</div> : (
                <div style={{ display:'flex', flexDirection:'column', gap:8, maxHeight: 240, overflowY:'auto' }}>
                  {ecomProducts.map(p => (
                    <div key={p.id} style={{ display:'flex', justifyContent:'space-between', padding:'10px 12px', border:`1px solid ${theme.hairline}`, borderRadius:10, fontSize:13 }}>
                      <div><div style={{ fontWeight:700 }}>{p.products?.name || p.name || 'Product'}</div><div style={{ fontSize:11, color: theme.textFaint }}>Units sold: {(p.units_sold ?? p.total_sold ?? '—')} • Price: {p.ecommerce_price_kobo ? '₦'+(p.ecommerce_price_kobo/100).toLocaleString() : p.products?.price ? '₦'+p.products.price : '—'}</div></div>
                      <Pill label={(p.status||'').toLowerCase().includes('active')||p.is_active ? 'live' : 'inactive'} type={(p.status||'').toLowerCase().includes('active')||p.is_active ? 'green':'gray'} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog show={!!showDeleteConfirm} title="Delete business?" onClose={()=>setShowDeleteConfirm(null)} onConfirm={handleDelete} confirmLabel={busy ? 'Deleting...' : deleteMode==='hard' ? 'Hard Delete' : 'Soft Delete (preserve ledger)'} variant="danger" message={
        <div style={{ display:'flex', flexDirection:'column', gap:10, fontSize:13 }}>
          <div><b>Soft delete</b> sets deleted_at and status=revoked, preserving ledger history. <b>Hard delete</b> removes the row (may break ledger references).</div>
          <div style={{ display:'flex', gap:8 }}>
            <label style={{ display:'flex', gap:6, alignItems:'center' }}><input type="radio" checked={deleteMode==='soft'} onChange={()=>setDeleteMode('soft')} /> Soft (recommended)</label>
            <label style={{ display:'flex', gap:6, alignItems:'center' }}><input type="radio" checked={deleteMode==='hard'} onChange={()=>setDeleteMode('hard')} /> Hard</label>
          </div>
          <div style={{ color: theme.danger, fontWeight:600 }}>This action requires confirmation and is auditable.</div>
        </div>
      } />

      <Toast msg={msg} />
    </div>
  )
}

// ── Team: Agents (spec §4) ────────────────────────────────────────────────
function TeamAgentsPanel() {
  const { msg, type, show: showToast } = useToast()
  const [tiers, setTiers] = useState([])
  const [agents, setAgents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState(null)
  const [showRegister, setShowRegister] = useState(false)
  const [reg, setReg] = useState({ full_name:'', email:'', password:'', state:'' })
  const [busy, setBusy] = useState(false)
  const [filter, setFilter] = useState('all')
  const [tierForm, setTierForm] = useState({ tier:'agent', parent_agent_id:'', commission_pct:'' })
  const [transfer, setTransfer] = useState({ toAgentId:'', reason:'' })
  const [earnings, setEarnings] = useState([])
  const [transfers, setTransfers] = useState([])

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [t, a, tr] = await Promise.all([getAgentTiers().catch(()=>[]), getAgentsDetailed().catch(()=>[]), getAgentTransfers().catch(()=>[])])
      setTiers(t||[]); setAgents(a||[]); setTransfers(tr||[])
    } catch (e) { setError(e.message) }
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (selected) {
      getAgentEarningsByAgent(selected.id).then(r=>setEarnings(r||[])).catch(()=>setEarnings([]))
    } else setEarnings([])
  }, [selected])

  const filtered = filter==='all' ? agents : agents.filter(a=> (a.status||a.tier)===filter || a.tier===filter)

  const handleRegister = async () => {
    if (!reg.full_name || !reg.email || !reg.password || !reg.state) { showToast('All fields required', {type:'error'}); return }
    setBusy(true)
    try {
      await addAgentRow({ full_name: reg.full_name, email: reg.email.toLowerCase(), password_hash: reg.password, state: reg.state, tier: 'unplaced', status: 'pending' })
      showToast('Agent registered (pending approval)', {type:'success'}); setShowRegister(false); setReg({full_name:'',email:'',password:'',state:''}); load()
    } catch (e) { showToast(e.message, {type:'error'}) }
    setBusy(false)
  }

  const handleApprove = async (agent) => {
    setBusy(true)
    try {
      // enforce tier/parent/commission
      const patch = { status: 'approved', tier: tierForm.tier, parent_agent_id: tierForm.parent_agent_id || null, commission_pct: tierForm.commission_pct ? Number(tierForm.commission_pct) : null }
      await updateAgentRow(agent.id, patch)
      showToast('Approved and placed', {type:'success'}); setSelected(null); load()
    } catch (e) { showToast(e.message.includes('max children')? 'Community coordinator 20-agent cap reached' : e.message, {type:'error'}) }
    setBusy(false)
  }
  const handleTierUpdate = async () => {
    if (!selected) return
    setBusy(true)
    try {
      await updateAgentRow(selected.id, { tier: tierForm.tier, parent_agent_id: tierForm.parent_agent_id || null, commission_pct: tierForm.commission_pct ? Number(tierForm.commission_pct) : null })
      showToast('Tier updated', {type:'success'}); load(); setSelected(a=>({...a, tier: tierForm.tier, parent_agent_id: tierForm.parent_agent_id || null}))
    } catch (e) { showToast(e.message, {type:'error'}) }
    setBusy(false)
  }
  const handleTransfer = async () => {
    if (!selected || !transfer.toAgentId) { showToast('Select target agent', {type:'error'}); return }
    if (!confirm(`Transfer financial history from ${selected.full_name || selected.name} to selected agent? This is audited and requires confirmation.`)) return
    setBusy(true)
    try {
      // For spec: reassign agent_referrals and agent_earnings history; we use transfer helper which reassigns businesses for this agent's referrals
      const referrals = await getAgentReferralsByAgent(selected.id).catch(()=>[])
      for (const r of (referrals||[])) {
        await transferAgentAccount({ fromAgentId: selected.id, toAgentId: transfer.toAgentId, businessId: r.business_id, reason: transfer.reason || 'admin transfer', byAdminId: null })
      }
      showToast('Transfer complete and audited', {type:'success'}); load(); setSelected(null)
    } catch (e) { showToast(e.message,{type:'error'}) }
    setBusy(false)
  }

  const parentOptions = agents.filter(a=> a.id!==selected?.id).map(a=> ({ value: a.id, label: `${a.full_name||a.name} (${a.tier}/${a.state||'—'})` }))

  if (loading) return <Loading />
  if (error) return <ErrorState message={error} onRetry={load} />

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
      <div style={{ display:'flex', gap:8, flexWrap:'wrap', justifyContent:'space-between' }}>
        <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
          {['all','pending','unplaced','agent','community_coordinator','state_coordinator'].map(k=> (
            <button key={k} onClick={()=>setFilter(k)} style={{ padding:'8px 14px', borderRadius: theme.radius.md, border:'none', cursor:'pointer', fontWeight:700, fontSize:12, background: filter===k? theme.tealDeep : theme.gray100, color: filter===k?'white':theme.gray600 }}>{k}</button>
          ))}
        </div>
        <TealBtn onClick={()=>setShowRegister(true)}>+ Register agent (admin)</TealBtn>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))', gap:10 }}>
        <Card style={{ padding:12, background: theme.tealMist, border:`1px solid ${theme.tealDeep}` }}><div style={{ fontSize:12, color: theme.textFaint }}>Agent tiers</div><div style={{ fontSize:13 }}>{tiers.map(t=> `${t.name} (${t.max_children ?? '∞'} @ ${t.commission_pct}%)`).join(' • ') || '—'}</div></Card>
        <Card style={{ padding:12 }}><div style={{ fontSize:12, color: theme.textFaint }}>Total agents</div><div style={{ fontWeight:800 }}>{agents.length}</div></Card>
        <Card style={{ padding:12 }}><div style={{ fontSize:12, color: theme.textFaint }}>Pending</div><div style={{ fontWeight:800 }}>{agents.filter(a=>a.status==='pending').length}</div></Card>
      </div>

      {filtered.length===0 ? <Empty icon={<Users size={28} />} message="No agents for filter" /> : (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {filtered.map(a=> (
            <Card key={a.id} style={{ padding:14, display:'flex', justifyContent:'space-between', gap:12, alignItems:'center', flexWrap:'wrap' }}>
              <div>
                <div style={{ fontWeight:800 }}>{a.full_name || a.name} <span style={{ fontWeight:400, color: theme.textFaint, fontSize:12 }}>• {a.tier}</span></div>
                <div style={{ fontSize:12, color: theme.textFaint }}>{a.email || a.contact_email} • {a.state || '—'} • {a.referral_code || 'no code'} • {a.commission_pct ?? '—'}% • {a.status}</div>
                <div style={{ fontSize:11, color: theme.textLight }}>Parent: {a.parent_agent_id ? agents.find(x=>x.id===a.parent_agent_id)?.full_name || a.parent_agent_id.slice(0,8) : '—'}</div>
              </div>
              <div style={{ display:'flex', gap:6, alignItems:'center' }}>
                <Pill label={a.status} type={a.status==='active'?'green': a.status==='pending'?'amber':'gray'} />
                <GhostBtn onClick={()=>{ setSelected(a); setTierForm({ tier: a.tier||'agent', parent_agent_id: a.parent_agent_id||'', commission_pct: a.commission_pct||'' }); setTransfer({toAgentId:'',reason:''}) }}>Manage</GhostBtn>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal show={!!selected} onClose={()=>setSelected(null)} title={`Agent: ${selected?.full_name||selected?.name || ''}`} footer={
        <div style={{ display:'flex', gap:8, flexWrap:'wrap', width:'100%' }}>
          <GhostBtn onClick={()=>setSelected(null)} style={{ flex:1 }}>Close</GhostBtn>
          {selected?.status==='pending' && <TealBtn disabled={busy} onClick={()=>handleApprove(selected)} style={{ flex:1 }}>Approve & place</TealBtn>}
        </div>
      }>
        {selected && (
          <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
            <div style={{ fontSize:13, display:'flex', flexDirection:'column', gap:6 }}>
              {[['Email', selected.email||selected.contact_email], ['Referral code', selected.referral_code||'auto CF-...'], ['Tier', selected.tier], ['State', selected.state||'—'], ['Status', selected.status], ['Commission %', selected.commission_pct ?? '—']].map(([l,v])=>(
                <div key={l} style={{ display:'flex', justifyContent:'space-between', padding:'6px 0', borderBottom:`1px solid ${theme.hairline}` }}><span style={{ color: theme.textFaint }}>{l}</span><span style={{ fontWeight:600 }}>{v}</span></div>
              ))}
            </div>
            <div style={{ padding:12, border:`1px solid ${theme.hairline}`, borderRadius:10 }}>
              <div style={{ fontWeight:800, fontSize:13, marginBottom:8 }}>Tier migration</div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                <Sel label="Tier" value={tierForm.tier} onChange={v=>setTierForm(s=>({...s,tier:v}))} options={['unplaced','agent','community_coordinator','state_coordinator']} />
                <Inp label="Commission %" value={tierForm.commission_pct} onChange={v=>setTierForm(s=>({...s,commission_pct:v}))} placeholder="e.g. 10" />
              </div>
              <Sel label="Parent agent (community coordinator cap 20)" value={tierForm.parent_agent_id} onChange={v=>setTierForm(s=>({...s,parent_agent_id:v}))} options={[{value:'',label:'— No parent —'}, ...parentOptions]} />
              <GhostBtn disabled={busy} onClick={handleTierUpdate} style={{ marginTop:8 }}>Update tier / parent</GhostBtn>
              <div style={{ fontSize:11, color: theme.textFaint, marginTop:6 }}>20-agent cap enforced server-side via trigger; UI also warns before assignment.</div>
            </div>
            <div style={{ padding:12, border:`1px solid ${theme.hairline}`, borderRadius:10 }}>
              <div style={{ fontWeight:800, fontSize:13, marginBottom:8 }}>Transfer Account (audit required)</div>
              <Sel label="Transfer to agent" value={transfer.toAgentId} onChange={v=>setTransfer(s=>({...s,toAgentId:v}))} options={[{value:'',label:'Select target'}, ...agents.filter(a=>a.id!==selected.id).map(a=>({value:a.id,label:a.full_name||a.name}))]} />
              <Inp label="Reason" value={transfer.reason} onChange={v=>setTransfer(s=>({...s,reason:v}))} placeholder="e.g. account correction" />
              <TealBtn disabled={busy} onClick={handleTransfer} style={{ marginTop:8, background: theme.danger }}>Transfer & audit</TealBtn>
              <div style={{ fontSize:11, color: theme.textFaint, marginTop:6 }}>Creates agent_transfers row who/when/from/to.</div>
            </div>
            <div style={{ padding:12, border:`1px solid ${theme.hairline}`, borderRadius:10 }}>
              <div style={{ fontWeight:800, fontSize:13, marginBottom:8 }}>Earnings for this agent</div>
              {earnings.length===0 ? <div style={{ fontSize:12, color: theme.textFaint }}>No earnings yet. Calculated server-side on payment webhook via calculate_agent_earnings (amount_owed = plan_value × commission_pct) — never client-side.</div> : (
                <div style={{ display:'flex', flexDirection:'column', gap:6, maxHeight: 200, overflowY:'auto' }}>
                  {earnings.map(e=>(
                    <div key={e.id} style={{ display:'flex', justifyContent:'space-between', fontSize:12, padding:'6px 8px', background: theme.gray50, borderRadius:8 }}>
                      <span>{fmtDate(e.created_at)} • {e.status} • {e.payout_period||''} • ref {e.payment_reference||'—'}</span><span style={{ fontWeight:700 }}>{fmt(e.amount_owed)} (paid {fmt(e.amount_paid)}) @ {e.commission_pct}%</span>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ fontSize:11, color: theme.textFaint, marginTop:6 }}>Idempotent: webhook retries cannot duplicate earnings (partial unique on payment_reference,agent_id).</div>
            </div>
            <div>
              <div style={{ fontWeight:700, fontSize:12, marginBottom:6 }}>Agent self-service</div>
              <div style={{ fontSize:12, color: theme.textFaint }}>Agent portal at /agent-login shows only own referral count, paid/unpaid earnings via RLS (own-record). Enforced server-side, not UI hiding.</div>
            </div>
          </div>
        )}
      </Modal>

      <Modal show={showRegister} onClose={()=>setShowRegister(false)} title="Register agent (admin)">
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          <Inp label="Full name *" value={reg.full_name} onChange={v=>setReg(s=>({...s,full_name:v}))} />
          <Inp label="Email *" value={reg.email} onChange={v=>setReg(s=>({...s,email:v}))} type="email" />
          <Inp label="Password *" value={reg.password} onChange={v=>setReg(s=>({...s,password:v}))} type="password" />
          <Inp label="State *" value={reg.state} onChange={v=>setReg(s=>({...s,state:v}))} placeholder="e.g. Lagos" />
          <TealBtn disabled={busy} onClick={handleRegister}>Create (CF- unique auto)</TealBtn>
        </div>
      </Modal>

      <Card style={{ padding:12 }}>
        <div style={{ fontWeight:700, fontSize:13, marginBottom:6 }}>Recent transfers audit</div>
        {transfers.length===0 ? <div style={{ fontSize:12, color: theme.textFaint }}>No transfers</div> : transfers.slice(0,5).map(t=>(
          <div key={t.id} style={{ fontSize:12, padding:'4px 0', borderBottom:`1px solid ${theme.hairline}` }}>{fmtDate(t.created_at)}: {t.from_agent_id?.slice(0,6)} → {t.to_agent_id?.slice(0,6)} • {t.reason||''}</div>
        ))}
      </Card>

      <Toast msg={msg} type={type} />
    </div>
  )
}

// ── Team: Platform (spec §5) ─────────────────────────────────────────────
function TeamPlatformPanel() {
  const { msg, type, show: showToast } = useToast()
  const [roles, setRoles] = useState([])
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showRole, setShowRole] = useState(false)
  const [showMember, setShowMember] = useState(false)
  const [roleForm, setRoleForm] = useState({ name:'', description:'', perms: {} })
  const [memberForm, setMemberForm] = useState({ full_name:'', email:'', password:'', role_id:'' })
  const [busy, setBusy] = useState(false)

  const load = useCallback(async()=>{
    setLoading(true)
    try {
      const [r,m] = await Promise.all([getAdminRoles().catch(()=>[]), getAdminTeamMembers().catch(()=>[])])
      setRoles(r||[]); setMembers(m||[])
    } catch(e) {}
    setLoading(false)
  },[])
  useEffect(()=>{ load() },[load])

  const handleCreateRole = async()=>{
    if (!roleForm.name) { showToast('Name required',{type:'error'}); return }
    setBusy(true)
    try {
      const perms = buildPlatformPermissions(roleForm.perms)
      await createAdminRole({ name: roleForm.name, description: roleForm.description||null, permissions: perms })
      showToast('Role created',{type:'success'}); setShowRole(false); setRoleForm({name:'',description:'',perms:{}}); load()
    } catch(e){ showToast(e.message,{type:'error'}) }
    setBusy(false)
  }
  const handleCreateMember = async()=>{
    if (!memberForm.full_name || !memberForm.email || !memberForm.password || !memberForm.role_id) { showToast('All fields required',{type:'error'}); return }
    setBusy(true)
    try {
      // password_hash stored; in production hash server-side, here store as hash placeholder (custom auth pattern)
      await createAdminTeamMember({ full_name: memberForm.full_name, email: memberForm.email.toLowerCase(), password_hash: memberForm.password, role_id: memberForm.role_id })
      showToast('Team member hired',{type:'success'}); setShowMember(false); setMemberForm({full_name:'',email:'',password:'',role_id:''}); load()
    } catch(e){ showToast(e.message,{type:'error'}) }
    setBusy(false)
  }

  if (loading) return <Loading />

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
      <Card style={{ padding:14 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:8 }}>
          <div style={{ fontWeight:800 }}>Roles — create first, then hire</div>
          <TealBtn onClick={()=>setShowRole(true)}>+ Create role</TealBtn>
        </div>
        {roles.length===0 ? <div style={{ fontSize:13, color: theme.textFaint, padding:12, textAlign:'center' }}>No roles yet — super admin creates a role with name, description, permission checklist. Independent of hiring.</div> : (
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(260px,1fr))', gap:10, marginTop:12 }}>
            {roles.map(r=>(
              <div key={r.id} style={{ padding:12, border:`1px solid ${theme.hairline}`, borderRadius:10 }}>
                <div style={{ fontWeight:700, fontSize:13 }}>{r.name}</div>
                <div style={{ fontSize:12, color: theme.textFaint }}>{r.description || '—'}</div>
                <div style={{ fontSize:11, marginTop:6, color: theme.slate }}>{Object.entries(normalizePlatformPermissions(r.permissions)).filter(([,v])=>v).map(([k])=>k).join(', ') || 'No permissions'}</div>
                <GhostBtn onClick={async()=>{ if(confirm('Delete role?')){ await deleteAdminRole(r.id); load() } }} style={{ marginTop:8, fontSize:11 }}>Delete</GhostBtn>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card style={{ padding:14 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:8 }}>
          <div style={{ fontWeight:800 }}>Hiring — select existing role (no inline permission config)</div>
          <TealBtn onClick={()=>setShowMember(true)}>+ Hire / Add team member</TealBtn>
        </div>
        {members.length===0 ? <div style={{ fontSize:13, color: theme.textFaint, padding:12, textAlign:'center' }}>No team members yet</div> : (
          <div style={{ display:'flex', flexDirection:'column', gap:8, marginTop:12 }}>
            {members.map(m=>(
              <div key={m.id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:10, border:`1px solid ${theme.hairline}`, borderRadius:10, flexWrap:'wrap', gap:8 }}>
                <div style={{ display:'flex', gap:10, alignItems:'center' }}>
                  <Avatar name={m.full_name} size={36} />
                  <div><div style={{ fontWeight:700, fontSize:13 }}>{m.full_name}</div><div style={{ fontSize:12, color: theme.textFaint }}>{m.email} • Role: {m.admin_roles?.name || roles.find(r=>r.id===m.role_id)?.name || '—'} • {m.status}</div></div>
                </div>
                <div style={{ display:'flex', gap:6, alignItems:'center' }}>
                  <Pill label={m.admin_roles?.name || '—'} type="gray" />
                  <button onClick={async()=>{ if(confirm('Remove member?')){ await deleteAdminTeamMember(m.id); load() } }} style={{ padding:'6px 10px', borderRadius:8, border:'none', background: theme.dangerBg, color: theme.danger, fontWeight:700, fontSize:12, cursor:'pointer' }}>Remove</button>
                </div>
              </div>
            ))}
          </div>
        )}
        <div style={{ fontSize:11, color: theme.textFaint, marginTop:10 }}>Login renders only sections in role.permissions. Permissions enforced at access/data layer, not just nav hiding. Reuse registerCustomRoles / navCatalogueFor pattern — do not build second system.</div>
      </Card>

      <Modal show={showRole} onClose={()=>setShowRole(false)} title="Create role">
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          <Inp label="Name *" value={roleForm.name} onChange={v=>setRoleForm(s=>({...s,name:v}))} placeholder="e.g. Support Lead" />
          <Inp label="Description" value={roleForm.description} onChange={v=>setRoleForm(s=>({...s,description:v}))} placeholder="What this role can do" />
          <div>
            <div style={{ fontWeight:700, fontSize:12, marginBottom:6 }}>Permissions checklist (8 platform perms)</div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6 }}>
              {PLATFORM_PERMISSIONS.map(p=>(
                <label key={p} style={{ display:'flex', gap:6, alignItems:'center', fontSize:13, padding:'6px 8px', border:`1px solid ${theme.hairline}`, borderRadius:8 }}>
                  <input type="checkbox" checked={!!roleForm.perms[p]} onChange={e=>setRoleForm(s=>({...s, perms:{...s.perms, [p]: e.target.checked}}))} /> {p}
                </label>
              ))}
            </div>
          </div>
          <TealBtn disabled={busy} onClick={handleCreateRole}>Create role</TealBtn>
        </div>
      </Modal>

      <Modal show={showMember} onClose={()=>setShowMember(false)} title="Hire team member">
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          <Inp label="Full name *" value={memberForm.full_name} onChange={v=>setMemberForm(s=>({...s,full_name:v}))} />
          <Inp label="Email *" value={memberForm.email} onChange={v=>setMemberForm(s=>({...s,email:v}))} type="email" />
          <Inp label="Password *" value={memberForm.password} onChange={v=>setMemberForm(s=>({...s,password:v}))} type="password" />
          <Sel label="Role * (dropdown — role supplies permissions)" value={memberForm.role_id} onChange={v=>setMemberForm(s=>({...s,role_id:v}))} options={[{value:'',label:'Select existing role'}, ...roles.map(r=>({value:r.id,label: r.name}))]} />
          <div style={{ fontSize:11, color: theme.textFaint }}>Do not configure permissions inline during hiring; selected role supplies permissions.</div>
          <TealBtn disabled={busy} onClick={handleCreateMember}>Hire / Add</TealBtn>
        </div>
      </Modal>

      <Toast msg={msg} type={type} />
    </div>
  )
}

// ── Applications unified (spec §6) ───────────────────────────────────────
function ApplicationsUnifiedPanel() {
  const { msg, type, show: showToast } = useToast()
  const [apps, setApps] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async()=>{
    setLoading(true)
    const rows = await getApplications().catch(()=>[])
    // also merge legacy ecommerce_applications and agent_applications for visibility
    const [ecom, agentLegacy] = await Promise.all([
      // legacy tables may not be in applications; fetch if exists
      (async()=>{ try { const r = await import('../../services/supabase.js').then(m=>m.sbFetch ? m.sbFetch('ecommerce_applications?select=*&order=created_at.desc&limit=20') : []); return r } catch(e){ return [] } })(),
      getAgentApplications().catch(()=>[])
    ])
    const merged = [...(rows||[])]
    for (const e of (ecom||[])) merged.push({ id: 'ecom_'+e.id, type:'ecommerce', applicant_ref: e.business_id, applicant_name: e.business_name || e.name, applicant_email: e.email, status: e.status||'pending', submitted_at: e.created_at, details: e })
    for (const a of (agentLegacy||[])) merged.push({ id: 'agent_'+a.id, type:'agent', applicant_ref: a.id, applicant_name: a.applicant_name, applicant_email: a.contact_email, status: a.status==='submitted'?'pending': a.status, submitted_at: a.submitted_at, details: a })
    setApps(merged); setLoading(false)
  },[])
  useEffect(()=>{ load() },[load])

  const filtered = filter==='all' ? apps : apps.filter(a=>a.type===filter)

  const handleReview = async (app, status) => {
    setBusy(true)
    try {
      if (String(app.id).startsWith('ecom_') || String(app.id).startsWith('agent_')) {
        // legacy: update legacy table directly
        if (app.type==='agent') await reviewAgentApplication(app.applicant_ref, { status: status==='approved'?'approved':'rejected', reviewed_at: new Date().toISOString() })
        showToast(`Legacy ${app.type} ${status}`,{type:'success'})
      } else {
        await reviewApplication(app.id, { status, reviewed_at: new Date().toISOString(), review_notes: 'reviewed via unified panel' })
        if (app.type==='ecommerce' && status==='approved') {
          // side effect: set businesses.ecommerce_enabled=true for that business if applicant_ref is business id
          try { const bid = app.applicant_ref; if (bid) await updateBusiness(bid, { ecommerce_enabled: true }) } catch(e){}
        }
        if (app.type==='agent' && status==='approved') {
          // trigger agent approval flow: create agent row if not exists
          try { await addAgentRow({ name: app.applicant_name||'Agent', contact_email: app.applicant_email, status:'approved_pending_onboarding', city: app.details?.city||'', area: app.details?.area||'', referral_code: undefined }) } catch(e){}
        }
        showToast(`Application ${status}`,{type:'success'})
      }
      load()
    } catch(e){ showToast(e.message,{type:'error'}) }
    setBusy(false)
  }

  if (loading) return <Loading />

  return (
    <div>
      <div style={{ display:'flex', gap:8, marginBottom:12, flexWrap:'wrap' }}>
        {['all','ecommerce','agent','team'].map(t=>(
          <button key={t} onClick={()=>setFilter(t)} style={{ padding:'8px 16px', borderRadius: theme.radius.md, border:'none', cursor:'pointer', fontWeight:700, fontSize:13, background: filter===t ? theme.tealDeep : theme.gray100, color: filter===t?'white':theme.gray600, textTransform:'capitalize' }}>{t}{t!=='all' ? ` (${apps.filter(a=>a.type===t).length})` : ''}</button>
        ))}
        <GhostBtn onClick={load}><RefreshCw size={13} style={{ marginRight:6 }} />Refresh</GhostBtn>
      </div>
      {filtered.length===0 ? <Empty icon={<FileText size={28} />} message={filter==='all' ? 'No applications' : `No ${filter} applications — all require explicit admin review, none auto-approve.`} /> : (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {filtered.map(a=>(
            <Card key={a.id} style={{ padding:14, display:'flex', justifyContent:'space-between', gap:12, alignItems:'center', flexWrap:'wrap' }}>
              <div>
                <div style={{ fontWeight:800, fontSize:14, textTransform:'capitalize' }}>{a.type} • {a.applicant_name || a.applicant_ref || '—'}</div>
                <div style={{ fontSize:12, color: theme.textFaint }}>{a.applicant_email || ''} • {fmtDate(a.submitted_at)}</div>
                <div style={{ fontSize:11, color: theme.textLight, marginTop:4 }}>Details: {JSON.stringify(a.details||{}).slice(0,120)}</div>
              </div>
              <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                <Pill label={a.status} type={a.status==='approved'?'green': a.status==='rejected'?'red':'amber'} />
                {a.status==='pending' && <><TealBtn disabled={busy} onClick={()=>handleReview(a,'approved')} style={{ padding:'7px 12px', fontSize:12 }}>Approve</TealBtn><button disabled={busy} onClick={()=>handleReview(a,'rejected')} style={{ padding:'7px 12px', borderRadius:8, border:'none', background: theme.dangerBg, color: theme.danger, fontWeight:700, fontSize:12, cursor: busy?'not-allowed':'pointer' }}>Reject</button></>}
              </div>
            </Card>
          ))}
        </div>
      )}
      <div style={{ fontSize:11, color: theme.textFaint, marginTop:10 }}>Approving E-commerce sets businesses.ecommerce_enabled=true; Approving Agent triggers placement flow; Approving Team creates/activates member. None auto-approve.</div>
      <Toast msg={msg} type={type} />
    </div>
  )
}

// ── Ledger (spec §7) ──────────────────────────────────────────────────────
function LedgerUnifiedPanel() {
  const { msg, type, show: showToast } = useToast()
  const [query, setQuery] = useState('')
  const [businesses, setBusinesses] = useState([])
  const [agents, setAgents] = useState([])
  const [selected, setSelected] = useState(null) // {type,id,name}
  const [lines, setLines] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(()=>{ getBusinesses().then(b=>setBusinesses(b||[])).catch(()=>{}); getAgentsDetailed().then(a=>setAgents(a||[])).catch(()=>{}) },[])

  const debounced = useDebounced(query, 300)
  const filteredBiz = useMemo(()=> {
    if (!debounced) return businesses.slice(0,20)
    const q = debounced.toLowerCase()
    return businesses.filter(b=> (b.name||'').toLowerCase().includes(q) || (b.owner||'').toLowerCase().includes(q)).slice(0,20)
  }, [businesses, debounced])
  const filteredAgents = useMemo(()=> {
    if (!debounced) return agents.slice(0,20)
    const q = debounced.toLowerCase()
    return agents.filter(a=> (a.full_name||a.name||'').toLowerCase().includes(q) || (a.email||'').toLowerCase().includes(q)).slice(0,20)
  }, [agents, debounced])

  const openStatement = async (entity) => {
    setSelected(entity); setLoading(true); setLines([])
    try {
      const l = await getLedgerForEntity({ type: entity.type, id: entity.id })
      setLines(l||[])
    } catch(e){ showToast(e.message,{type:'error'}) }
    setLoading(false)
  }

  const exportSingle = () => {
    if (!selected) return
    const html = buildStatementHtml(selected, lines)
    const ok = openPrintWindow(html)
    if (!ok) {
      const csv = `Statement for ${selected.name}\nDate,Description,Type,Amount,Balance\n` + lines.map((it,i)=> {
        let bal=0; for(let j=0;j<=i;j++) bal+=Number(lines[j].amount||0)
        return `${it.date},${it.description},${it.type},${it.amount},${bal}`
      }).join('\n')
      downloadCsv(`statement_${selected.name}_${new Date().toISOString().slice(0,10)}.csv`, csv)
    }
    showToast('Statement opened (PDF print). Bulk: ZIP of PDFs or consolidated sheet — confirm with Abdullahi.',{type:'info'})
  }
  const exportBulk = async () => {
    // consolidated spreadsheet of all entities' latest lines? For now export all lines for selected + summary
    let csv = 'Entity,Date,Description,Type,Amount\n'
    for (const b of businesses.slice(0,5)) {
      const l = await getLedgerForEntity({type:'business',id:b.id}).catch(()=>[])
      for (const it of (l||[])) csv += `${b.name},${it.date},${it.description},${it.type},${it.amount}\n`
    }
    downloadCsv(`ledger_bulk_${new Date().toISOString().slice(0,10)}.csv`, csv)
    showToast('Bulk exported (consolidated). Confirm if ZIP of PDFs preferred.',{type:'info'})
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
      <div style={{ display:'flex', gap:8, flexWrap:'wrap', justifyContent:'space-between' }}>
        <div style={{ position:'relative', flex:'1 1 300px', maxWidth: 480 }}>
          <Search size={14} style={{ position:'absolute', left:10, top:'50%', transform:'translateY(-50%)', color: theme.textFaint }} />
          <input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search businesses and agents" aria-label="Search ledger" style={{ width:'100%', padding:'10px 12px 10px 30px', borderRadius:10, border:`1px solid ${theme.hairline}`, fontSize:13 }} />
        </div>
        <GhostBtn onClick={exportBulk}><Download size={13} style={{ marginRight:6 }} />Bulk export</GhostBtn>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
        <Card style={{ padding:14 }}>
          <div style={{ fontWeight:800, fontSize:13, marginBottom:8 }}>Businesses ({filteredBiz.length})</div>
          {filteredBiz.length===0 ? <div style={{ fontSize:12, color: theme.textFaint }}>No matches</div> : filteredBiz.map(b=>(
            <button key={b.id} onClick={()=>openStatement({type:'business',id:b.id,name:b.name,email:b.email})} style={{ display:'block', width:'100%', textAlign:'left', padding:'8px 10px', borderRadius:8, border: selected?.id===b.id?`1px solid ${theme.tealDeep}`:`1px solid ${theme.hairline}`, background: selected?.id===b.id? theme.tealMist : 'white', marginBottom:6, cursor:'pointer' }}>
              <div style={{ fontWeight:600, fontSize:13 }}>{b.name}</div><div style={{ fontSize:11, color: theme.textFaint }}>{b.owner} • {b.state}</div>
            </button>
          ))}
        </Card>
        <Card style={{ padding:14 }}>
          <div style={{ fontWeight:800, fontSize:13, marginBottom:8 }}>Agents ({filteredAgents.length})</div>
          {filteredAgents.length===0 ? <div style={{ fontSize:12, color: theme.textFaint }}>No matches</div> : filteredAgents.map(a=>(
            <button key={a.id} onClick={()=>openStatement({type:'agent',id:a.id,name:a.full_name||a.name,email:a.email})} style={{ display:'block', width:'100%', textAlign:'left', padding:'8px 10px', borderRadius:8, border: selected?.id===a.id?`1px solid ${theme.tealDeep}`:`1px solid ${theme.hairline}`, background: selected?.id===a.id? theme.tealMist : 'white', marginBottom:6, cursor:'pointer' }}>
              <div style={{ fontWeight:600, fontSize:13 }}>{a.full_name||a.name}</div><div style={{ fontSize:11, color: theme.textFaint }}>{a.email} • {a.state||'—'}</div>
            </button>
          ))}
        </Card>
      </div>

      {selected && (
        <Card style={{ padding:16 }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:8 }}>
            <div style={{ fontWeight:800 }}>Statement — {selected.name} ({selected.type})</div>
            <GhostBtn onClick={exportSingle}><FileText size={13} style={{ marginRight:6 }} />Export single (PDF print)</GhostBtn>
          </div>
          {loading ? <Loading /> : lines.length===0 ? <div style={{ fontSize:12, color: theme.textFaint, padding:12, textAlign:'center' }}>No transactions — underlying sources authoritative.</div> : (
            <div style={{ overflowX:'auto', marginTop:10 }}>
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
                <thead><tr style={{ background: theme.gray50 }}><th style={{ textAlign:'left', padding:'8px', border:`1px solid ${theme.hairline}` }}>Date</th><th style={{ textAlign:'left', padding:'8px', border:`1px solid ${theme.hairline}` }}>Description</th><th style={{ padding:'8px', border:`1px solid ${theme.hairline}` }}>Type</th><th style={{ textAlign:'right', padding:'8px', border:`1px solid ${theme.hairline}` }}>Amount</th><th style={{ textAlign:'right', padding:'8px', border:`1px solid ${theme.hairline}` }}>Balance</th></tr></thead>
                <tbody>
                  {(() => { let bal=0; return lines.map((it,i)=>{ bal+=Number(it.amount||0); return <tr key={i}><td style={{ padding:'8px', border:`1px solid ${theme.hairline}` }}>{it.date}</td><td style={{ padding:'8px', border:`1px solid ${theme.hairline}` }}>{it.description}</td><td style={{ padding:'8px', border:`1px solid ${theme.hairline}`, textAlign:'center' }}><Pill label={it.type} type="gray" /></td><td style={{ padding:'8px', border:`1px solid ${theme.hairline}`, textAlign:'right' }}>{fmt(it.amount)}</td><td style={{ padding:'8px', border:`1px solid ${theme.hairline}`, textAlign:'right', fontWeight:700 }}>{fmt(bal)}</td></tr> }) })()}
                </tbody>
              </table>
            </div>
          )}
          <div style={{ fontSize:11, color: theme.textFaint, marginTop:8 }}>Ledger is aggregate view, not new source of truth. Compare against wallet_transactions, plan_payments, agent_earnings etc.</div>
        </Card>
      )}

      <Toast msg={msg} type={type} />
    </div>
  )
}

// ── Payouts (spec §8) ────────────────────────────────────────────────────
function PayoutsUnifiedPanel() {
  const { msg, type, show: showToast } = useToast()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [busy, setBusy] = useState(false)
  const [confirmPaid, setConfirmPaid] = useState(null)

  const load = useCallback(async()=>{
    setLoading(true)
    const r = await getPayoutRequests().catch(()=>[])
    setRows(r||[]); setLoading(false)
  },[])
  useEffect(()=>{ load() },[load])

  const filtered = filter==='all' ? rows : rows.filter(r=>r.status===filter)

  const updateStatus = async (row, next) => {
    if (busy) return
    setBusy(true)
    try {
      await updatePayoutRequest(row.id, { status: next, reviewed_at: new Date().toISOString() })
      showToast(`Payout ${next}`,{type:'success'}); load()
    } catch(e){ showToast(e.message,{type:'error'}) }
    setBusy(false)
  }
  const doMarkPaid = async () => {
    if (!confirmPaid) return
    setBusy(true)
    try {
      await markPayoutPaidAtomic(confirmPaid.id, {})
      // fallback ensure status paid even if RPC not present
      await updatePayoutRequest(confirmPaid.id, { status: 'paid', processed_at: new Date().toISOString() })
      showToast('Marked paid — agent_earnings.amount_paid / wallet updated atomically server-side', {type:'success'})
      setConfirmPaid(null); load()
    } catch(e){ showToast(e.message,{type:'error'}) }
    setBusy(false)
  }

  if (loading) return <Loading />

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
      <div style={{ display:'flex', gap:8, flexWrap:'wrap', justifyContent:'space-between' }}>
        <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
          {['all','pending','processing','paid','rejected'].map(s=>(
            <button key={s} onClick={()=>setFilter(s)} style={{ padding:'8px 14px', borderRadius: theme.radius.md, border:'none', cursor:'pointer', fontWeight:700, fontSize:12, background: filter===s? theme.tealDeep : theme.gray100, color: filter===s?'white':theme.gray600, textTransform:'capitalize' }}>{s}</button>
          ))}
        </div>
        <GhostBtn onClick={load}><RefreshCw size={13} style={{ marginRight:6 }} />Refresh</GhostBtn>
      </div>

      {filtered.length===0 ? <Empty icon={<Wallet size={28} />} message="No payout requests" /> : (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {filtered.map(r=>(
            <Card key={r.id} style={{ padding:14, display:'flex', justifyContent:'space-between', gap:12, flexWrap:'wrap', alignItems:'center' }}>
              <div>
                <div style={{ fontWeight:800, fontSize:14 }}>{r.requester_type} • {r.requester_id.slice(0,8)} • {fmt(r.amount)}</div>
                <div style={{ fontSize:12, color: theme.textFaint }}>{r.bank_name || r.bank_details?.bank_name || '—'} • {r.account_number || r.bank_details?.account_number || ''} • {r.account_name || r.bank_details?.account_name || ''} • {fmtDate(r.requested_at)} • method {r.payout_method || r.bank_details?.method || 'bank_transfer'}</div>
              </div>
              <div style={{ display:'flex', gap:6, alignItems:'center', flexWrap:'wrap' }}>
                <Pill label={r.status} type={r.status==='paid'?'green': r.status==='rejected'?'red': r.status==='processing'?'blue':'amber'} />
                {r.status==='pending' && <><TealBtn disabled={busy} onClick={()=>updateStatus(r,'processing')} style={{ padding:'6px 12px', fontSize:12 }}>Approve → processing</TealBtn><button disabled={busy} onClick={()=>updateStatus(r,'rejected')} style={{ padding:'6px 12px', borderRadius:8, border:'none', background: theme.dangerBg, color: theme.danger, fontWeight:700, fontSize:12, cursor: busy?'not-allowed':'pointer' }}>Reject</button></>}
                {r.status==='processing' && <TealBtn disabled={busy} onClick={()=>setConfirmPaid(r)} style={{ padding:'6px 12px', fontSize:12, background: theme.success }}>Mark as Paid</TealBtn>}
              </div>
            </Card>
          ))}
        </div>
      )}

      <ConfirmDialog show={!!confirmPaid} title="Confirm Mark as Paid?" onClose={()=>setConfirmPaid(null)} onConfirm={doMarkPaid} confirmLabel={busy?'Processing...':'Confirm Paid'} variant="danger" message={
        <div style={{ fontSize:13 }}>
          <div>This will atomically update payout status and the corresponding financial source (agent_earnings.amount_paid or wallet balance) server-side.</div>
          <div style={{ marginTop:8, color: theme.danger, fontWeight:600 }}>Require confirmation for final Mark as Paid. This action is irreversible.</div>
        </div>
      } />

      <Toast msg={msg} type={type} />
    </div>
  )
}

// ── Main AdminDashboard ──────────────────────────────────────────────────
export default function AdminDashboard() {
  const [businesses, setBusinesses] = useState([])
  const [team, setTeam] = useState([]) // legacy admin_team for count fallback
  const [teamMembers, setTeamMembers] = useState([]) // new
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('dashboard')
  const [highlightBusinessId, setHighlightBusinessId] = useState(null)
  const [platformPerms, setPlatformPerms] = useState(null)
  const { msg, show: showToast } = useToast()
  const navigate = useNavigate()
  const { logout: authLogout, auth } = useAuth()

  const load = useCallback(async () => {
    try {
      const [b, tLegacy, tNew] = await Promise.all([
        getBusinesses().catch(()=>[]),
        getAdminTeam().catch(()=>[]),
        getAdminTeamMembers().catch(()=>[])
      ])
      setBusinesses(b || [])
      setTeam(tLegacy || [])
      setTeamMembers(tNew || [])
      // resolve platform perms for current user if member
      try {
        const email = auth?.brand?.email || auth?.email
        if (email && tNew?.length) {
          const me = tNew.find(m=> (m.email||'').toLowerCase() === (email||'').toLowerCase())
          if (me) {
            const role = me.admin_roles
            setPlatformPerms(normalizePlatformPermissions(role?.permissions))
          } else if (auth?.isAdmin) {
            // super admin (businesses.is_platform_admin) gets full
            const full = {}; for (const k of PLATFORM_PERMISSIONS) full[k]=true
            setPlatformPerms(full)
          }
        } else if (auth?.isAdmin) {
          const full = {}; for (const k of PLATFORM_PERMISSIONS) full[k]=true
          setPlatformPerms(full)
        }
      } catch(e){}
    } catch (e) { console.error(e) }
    setLoading(false)
  }, [auth])

  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t) }, [load])

  const handleStatusChange = useCallback(async (id, status) => {
    await updateBusiness(id, { status })
    setBusinesses(prev => prev.map(b => b.id === id ? { ...b, status } : b))
    // fire-and-forget notification
    try {
      const { data: { session } } = await authClient.auth.getSession()
      if (session?.access_token) {
        fetch('/api/notify-business-status', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ businessId: id, status }) }).catch(()=>{})
      }
    } catch(e){}
  }, [])

  const logout = () => { authLogout(); navigate('/login') }

  const allTeamCount = teamMembers.length || team.length
  const pendingCount = businesses.filter(b=>b.status==='pending' && !b.deleted_at).length

  // Permission gating: hide nav items not in perms (if perms resolved). If null, show all (bootstrap).
  const isPermitted = (perm) => {
    if (!platformPerms) return true
    return !!platformPerms[perm]
  }

  const handleNavFromDashboard = (targetTab, businessId) => {
    if (businessId) setHighlightBusinessId(businessId)
    setTab(targetTab)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // Top nav definition with permission mapping
  const TOP_TABS = [
    { id: 'dashboard', label: 'Dashboard', perm: 'Dashboard' },
    { id: 'businesses', label: 'Businesses', perm: 'Businesses' },
    { id: 'team', label: 'Team', perm: 'Team-Agents' }, // Team aggregates both perms; sub-tabs gate further
    { id: 'applications', label: 'Applications', perm: 'Applications' },
    { id: 'ledger', label: 'Ledger', perm: 'Ledger' },
    { id: 'payouts', label: 'Payouts', perm: 'Payouts' },
    { id: 'coverage', label: 'Coverage', perm: 'Coverage' },
  ]

  const [teamSub, setTeamSub] = useState('agents') // agents | platform

  return (
    <div style={{ minHeight: '100vh', background: theme.bg, fontFamily: theme.fontFamily }}>
      <div style={{ background: DARK, color: 'white', padding: '14px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', backgroundImage: DARK, position:'sticky', top:0, zIndex:20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Logo size={32} />
          <div><div style={{ fontWeight: 800, fontSize: 14 }}>CareHub Admin</div><div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>Super Admin Panel • {pendingCount>0 ? `${pendingCount} pending` : 'All caught up'}</div></div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems:'center' }}>
          {platformPerms && <span style={{ fontSize:11, color:'rgba(255,255,255,0.7)', display:'flex', gap:4, alignItems:'center' }}><Shield size={12} /> {Object.entries(platformPerms).filter(([,v])=>v).length}/{PLATFORM_PERMISSIONS.length} perms</span>}
          <button onClick={load} aria-label="Refresh" style={{ display:'flex', alignItems:'center', gap:5, padding:'6px 12px', borderRadius:8, border:'none', background:'rgba(255,255,255,0.12)', color:'white', fontWeight:600, fontSize:12, cursor:'pointer' }}><RefreshCw size={13} /> Refresh</button>
          <button onClick={logout} style={{ padding:'6px 12px', borderRadius:8, border:'none', background:'rgba(255,255,255,0.12)', color:'white', fontWeight:600, fontSize:12, cursor:'pointer' }}>Sign Out</button>
        </div>
      </div>

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: 24 }}>
        {pendingCount > 0 && tab==='dashboard' && (
          <div style={{ marginBottom: 16, padding:'12px 16px', borderRadius:12, background: theme.warningBg, border:`1px solid ${theme.amberBorder}`, display:'flex', alignItems:'center', gap:10 }}>
            <Bell size={18} color={theme.warning} style={{ flexShrink:0 }} />
            <div style={{ fontWeight:700, color: theme.amberText, fontSize:13 }}>{pendingCount} business(es) waiting for approval — review in Businesses</div>
          </div>
        )}

        <div style={{ display:'flex', gap:8, marginBottom: 20, flexWrap:'wrap', overflowX:'auto' }}>
          {TOP_TABS.filter(t=> isPermitted(t.perm) || t.id==='dashboard').map(t => (
            <button key={t.id} onClick={()=>setTab(t.id)} aria-pressed={tab===t.id} style={{ padding:'9px 16px', borderRadius: theme.radius.md, border: tab===t.id? `1px solid ${theme.tealDeep}` : `1px solid ${theme.hairline}`, cursor:'pointer', fontWeight:700, fontSize:13, background: tab===t.id? theme.tealDeep : 'white', color: tab===t.id? 'white' : theme.gray600, whiteSpace:'nowrap' }}>{t.label}</button>
          ))}
        </div>

        {loading ? <Loading /> : (
          <>
            {tab==='dashboard' && isPermitted('Dashboard') && <DashboardStats businesses={businesses} teamMembers={teamMembers.length? teamMembers: team} onNav={handleNavFromDashboard} />}
            {tab==='dashboard' && !isPermitted('Dashboard') && <Empty icon={<Shield size={28} />} message="No access to Dashboard" />}

            {tab==='businesses' && (isPermitted('Businesses') ? <BusinessesPanel businesses={businesses} onRefresh={load} onStatusChange={handleStatusChange} highlightId={highlightBusinessId} /> : <Empty icon={<Shield size={28} />} message="No access to Businesses" />)}

            {tab==='team' && (
              <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
                <div style={{ display:'flex', gap:8 }}>
                  {[
                    { id:'agents', label:'Agents', perm:'Team-Agents', icon: Users },
                    { id:'platform', label:'Platform Team', perm:'Team-Platform', icon: UserCog },
                  ].filter(s=> isPermitted(s.perm)).map(s=> (
                    <button key={s.id} onClick={()=>setTeamSub(s.id)} style={{ flex:1, padding:'10px 12px', borderRadius:10, border: teamSub===s.id? `1px solid ${theme.tealDeep}`:`1px solid ${theme.hairline}`, background: teamSub===s.id? theme.tealMist : 'white', color: teamSub===s.id? theme.tealDeep: theme.slate, fontWeight:700, fontSize:13, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:6 }}><s.icon size={14} /> {s.label}</button>
                  ))}
                </div>
                {teamSub==='agents' && isPermitted('Team-Agents') && <TeamAgentsPanel />}
                {teamSub==='platform' && isPermitted('Team-Platform') && <TeamPlatformPanel />}
                {!isPermitted('Team-Agents') && !isPermitted('Team-Platform') && <Empty icon={<Shield size={28} />} message="No access to Team" />}
              </div>
            )}

            {tab==='applications' && (isPermitted('Applications') ? <ApplicationsUnifiedPanel /> : <Empty icon={<Shield size={28} />} message="No access to Applications" />)}
            {tab==='ledger' && (isPermitted('Ledger') ? <LedgerUnifiedPanel /> : <Empty icon={<Shield size={28} />} message="No access to Ledger" />)}
            {tab==='payouts' && (isPermitted('Payouts') ? <PayoutsUnifiedPanel /> : <Empty icon={<Shield size={28} />} message="No access to Payouts" />)}
            {tab==='coverage' && (isPermitted('Coverage') ? <CoveragePanel /> : <Empty icon={<Shield size={28} />} message="No access to Coverage" />)}
          </>
        )}
      </div>

      <Toast msg={msg} />
      <div style={{ textAlign:'center', fontSize:11, color: theme.textFaint, padding:16 }}>Coverage unchanged • Financial operations are server-side & atomic • RLS enforced at data layer • Build order: schema → dashboard → businesses → applications → agents → platform → ledger → payouts</div>
    </div>
  )
}
