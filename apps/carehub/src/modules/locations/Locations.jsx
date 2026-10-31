import { sumTotalSales } from '../pos/salesReport'
import { useState, useEffect } from 'react'
import { Lock, BarChart2, Building2, DollarSign, Package, AlertTriangle } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useLocationSwitch } from '../../components/layout/useLocationSwitch'
// Cross-aggregate read: per-branch takings come from the POS module's sale
// repository. Each branch is its own business row, so the branch id is what
// gets passed as the tenant. `getSales` was imported here but never used —
// dropped rather than repointed.
import { saleRepository } from '../pos/repositories'
import { locationsRepository } from './repositories'
import { productRepository } from '../inventory/repositories'
import { fmt, todayDate, businessLucideIcon } from '../../lib/utils'
import { NIG_STATES } from '../../config/constants'
import { planLimitsFor, PLAN_LABELS } from '../../lib/planLimits'
import { usePlanGate } from '../../hooks/usePlanGate'
import { theme } from '../../styles/theme'
import { Card, StatCard, SectionHead, Modal, Pill, Inp, Sel, GhostBtn, TealBtn, Loading, Empty, ErrorState, useToast, Toast } from '../../components/ui'

const { tealDeep, tealBright, tealMist, navy, gray600, gray500, gray400, gray100, border, danger, success, warning, bg } = theme

// The database's own words for a refusal ("Supabase error (403): <reason>" -> "<reason>").
function reasonOf(e) {
  const text = String((e && e.message) || e || 'request failed')
  return text.replace(/^Supabase error \(\d+\):\s*/, '').replace(/\.$/, '')
}

export default function Locations({ brand, role }) {
  const navigate = useNavigate()
  const [locations, setLocations] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  // The shared switch (asks first when a POS cart would be lost); after a switch, open that location's dashboard.
  const { request: requestSwitch, dialog: switchDialog } = useLocationSwitch(() => navigate('/dashboard/dashboard'))
  const [stats, setStats] = useState({})
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const { msg, type, actionLabel, onAction, show: showToast } = useToast()
  const plan = usePlanGate(showToast)
  const f = (k, v) => setForm(p => ({ ...p, [k]: v }))
  const isOwner = role === 'Owner'
  const mainId = brand?.parent_business_id || brand?.id

  useEffect(() => { load() }, [brand?.id])

  async function load() {
    setLoading(true)
    setLoadError('')
    try {
      const locs = await locationsRepository.getAll(brand.id)
      setLocations(locs || [])
      // All branches at once, each with today's sales and a stock summary
      // (counts only, not every product row). A branch that fails is marked,
      // not shown as zero.
      const entries = await Promise.all((locs || []).map(async (loc) => {
        try {
          const [today, summary] = await Promise.all([
            saleRepository.getToday(loc.id),
            productRepository.getStockSummary(loc.id),
          ])
          return [loc.id, {
            todayRevenue: sumTotalSales(today),
            todayCount: (today || []).length,
            productCount: summary.productCount,
            lowStock: summary.lowStock,
          }]
        } catch (e) {
          console.error('[locations] branch stats failed:', loc.id, e?.message)
          return [loc.id, { failed: true }]
        }
      }))
      setStats(Object.fromEntries(entries))
    } catch (e) {
      console.error('[locations] load failed:', e)
      setLoadError("We couldn't load your branches. Check your connection and try again.")
    }
    setLoading(false)
  }

  async function saveBranch() {
    if (!form.name || !form.address) { showToast('Please enter branch name and address.', { type: 'warning' }); return }
    if (!plan.allow('adding branches')) return
    const limit = planLimitsFor(brand?.plan).maxLocations
    if (locations.length >= limit) {
      showToast(`Your ${PLAN_LABELS[brand?.plan] || 'current'} plan allows up to ${limit} location${limit === 1 ? '' : 's'}. Upgrade your plan in Settings to add more.`, { type: 'warning' })
      return
    }
    setSaving(true)
    try {
      const created = await locationsRepository.addBranch({
        name: brand.name + ' · ' + form.name,
        branch_name: form.name,
        parent_business_id: mainId,
        owner: brand.owner,
        // No email: a branch has no sign-in of its own (owner's option A, 2026-10-25). businesses.email is the
        // identity the database matches the signed-in person against, and the owner of a branch is the owner of its
        // main business (carehub_20261212_branches_without_email). No password either (C2).
        phone: form.phone || brand.phone,
        whatsapp: form.whatsapp || brand.whatsapp,
        address: form.address,
        state: form.state || brand.state,
        city: form.city || '',
        business_type: brand.business_type || brand.type,
        hours: brand.hours || '',
        status: 'active',
        visible_on_carefind: true,
        // A branch is on its main business's plan (the database enforces it). Sent only when known; never a default.
        ...(brand.plan ? { plan: brand.plan } : {}),
      })
      // Clone the parent's master catalog + roles into the new branch so it
      // opens ready to operate. Never blocks branch creation — a failed clone
      // still leaves a working (if empty) branch.
      const newId = Array.isArray(created) ? created[0]?.id : created?.id
      setForm({}); setShowAdd(false)
      let copied = true
      if (newId) {
        try { await locationsRepository.cloneBranchData(mainId, newId) } catch (e) {
          copied = false
          showToast('The branch was added, but its products and roles were not fully copied: ' + reasonOf(e) + '. Set them up in the branch before staff use it.', { type: 'warning', duration: 10000 })
        }
      }
      if (copied) showToast('Branch added successfully!', { type: 'success' })
      load()
    } catch (e) { showToast('Could not add the branch: ' + reasonOf(e), { type: 'error' }) }
    setSaving(false)
  }

  // Main business first; the list from the server is never reordered in place.
  const ordered = [...locations].sort((a, b) => (a.parent_business_id ? 1 : 0) - (b.parent_business_id ? 1 : 0))
  const totalRevenue = Object.values(stats).reduce((s, x) => s + (x.todayRevenue || 0), 0)
  const totalTransactions = Object.values(stats).reduce((s, x) => s + (x.todayCount || 0), 0)
  const totalProducts = Object.values(stats).reduce((s, x) => s + (x.productCount || 0), 0)
  const totalLowStock = Object.values(stats).reduce((s, x) => s + (x.lowStock || 0), 0)

  if (!isOwner) return (
    <div style={{ padding: '32px', textAlign: 'center', color: gray400 }}>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '16px' }}><Lock size={40} /></div>
      <div style={{ fontSize: '16px', fontWeight: '700', color: gray600 }}>Managing multiple locations is restricted to the business Owner</div>
    </div>
  )

  return (
    <div>
      <SectionHead title='Locations' sub='Manage all your business branches in one place' btn='+ Add Branch' onBtn={() => plan.allow('adding branches') && setShowAdd(true)} />

      {/* Combined stats across all locations */}
      <div style={{ marginBottom: '20px', padding: '20px', borderRadius: theme.radius.lg, background: navy, color: 'white' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', opacity: 0.6, marginBottom: '12px' }}><BarChart2 size={14} /> Combined performance across every location today</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: '16px' }}>
          <div>
            <div style={{ fontSize: '24px', fontWeight: '900', color: tealBright }}>{fmt(totalRevenue)}</div>
            <div style={{ fontSize: '11px', opacity: 0.5 }}>Total revenue</div>
          </div>
          <div>
            <div style={{ fontSize: '24px', fontWeight: '900' }}>{totalTransactions}</div>
            <div style={{ fontSize: '11px', opacity: 0.5 }}>Transactions</div>
          </div>
          <div>
            <div style={{ fontSize: '24px', fontWeight: '900' }}>{locations.length}</div>
            <div style={{ fontSize: '11px', opacity: 0.5 }}>Locations</div>
          </div>
          <div>
            <div style={{ fontSize: '24px', fontWeight: '900', color: totalLowStock > 0 ? theme.warning : 'white' }}>{totalLowStock}</div>
            <div style={{ fontSize: '11px', opacity: 0.5 }}>Low stock items</div>
          </div>
        </div>
      </div>

      {switchDialog}
      {loading ? <Loading text='Loading branches…' /> : loadError ? (
        <ErrorState message={loadError} onRetry={load} />
      ) : locations.length === 0 ? (
        <Empty icon={<Building2 size={40} />} message='No additional branches yet' action='+ Add First Branch' onAction={() => plan.allow('adding branches') && setShowAdd(true)} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {ordered.map(loc => {
            const isCurrentLocation = loc.id === brand.id
            const isMain = !loc.parent_business_id
            const s = stats[loc.id] || {}
            return (
              <Card key={loc.id} style={{ padding: '18px', border: isCurrentLocation ? `2px solid ${tealDeep}` : `1px solid ${border}` }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                    <div style={{ width: '48px', height: '48px', borderRadius: theme.radius.md, background: tealMist, color: tealDeep, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      {(() => { const Icon = isMain ? Building2 : businessLucideIcon(loc.business_type || loc.type); return <Icon size={22} /> })()}
                    </div>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontWeight: '800', fontSize: '15px', color: navy }}>{loc.branch_name || (isMain ? 'Main Location' : loc.name)}</span>
                        {isMain && <Pill label='Main' type='blue' />}
                        {isCurrentLocation && <Pill label='Current' type='green' />}
                      </div>
                      <div style={{ fontSize: '12px', color: gray500, marginTop: '2px' }}>{loc.address || 'No address set'}{loc.state ? ', ' + loc.state : ''}</div>
                      <div style={{ display: 'flex', gap: '12px', marginTop: '8px', flexWrap: 'wrap' }}>
                        {s.failed ? (
                          <span role="status" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: warning, fontWeight: '700' }}><AlertTriangle size={12} /> Figures unavailable. <button type="button" onClick={load} style={{ background: 'none', border: 'none', padding: 0, color: tealDeep, fontWeight: 700, fontSize: 12, cursor: 'pointer', textDecoration: 'underline' }}>Try again</button></span>
                        ) : (<>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: tealDeep, fontWeight: '700' }}><DollarSign size={12} /> {fmt(s.todayRevenue || 0)} today</span>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: gray500 }}><Package size={12} /> {(s.productCount || 0).toLocaleString()} products</span>
                        </>)}
                        {s.lowStock > 0 && <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: warning, fontWeight: '700' }}><AlertTriangle size={12} /> {s.lowStock} low stock</span>}
                      </div>
                    </div>
                  </div>
                  {!isCurrentLocation && (
                    <TealBtn onClick={() => requestSwitch(loc)} style={{ padding: '8px 16px', fontSize: '12px' }}>Switch to this branch →</TealBtn>
                  )}
                </div>
              </Card>
            )
          })}
        </div>
      )}

      <Modal show={showAdd} onClose={() => { setShowAdd(false); setForm({}) }} title='Add New Branch'
        footer={<><GhostBtn onClick={() => { setShowAdd(false); setForm({}) }} style={{ flex: 1, padding: '12px' }}>Cancel</GhostBtn><TealBtn onClick={saveBranch} style={{ flex: 1, padding: '12px' }}>{saving ? 'Saving...' : 'Add Branch'}</TealBtn></>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{ padding: '12px', borderRadius: theme.radius.md, background: tealMist, fontSize: '12px', color: tealDeep }}>
            A branch has no sign-in of its own: you manage it from your main account and switch to it from the top bar. Inventory, sales and staff are separate per branch.
          </div>
          <Inp label='Branch Name *' value={form.name} onChange={v => f('name', v)} placeholder='e.g. Lagos Branch, Abuja Branch' required />
          <Inp label='Branch Address *' value={form.address} onChange={v => f('address', v)} placeholder='Full address of this branch' required />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <Sel label='State' value={form.state} onChange={v => f('state', v)} options={NIG_STATES} />
            <Inp label='City' value={form.city} onChange={v => f('city', v)} placeholder='e.g. Ikeja' />
          </div>
          <Inp label='Branch Phone' value={form.phone} onChange={v => f('phone', v)} placeholder='Phone number for this branch' />
          <Inp label='Branch WhatsApp' value={form.whatsapp} onChange={v => f('whatsapp', v)} placeholder='WhatsApp for this branch' />
        </div>
      </Modal>

      <Toast msg={msg} type={type} actionLabel={actionLabel} onAction={onAction} />
    </div>
  )
}
