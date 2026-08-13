import { useState, useEffect } from 'react'
import { Lock, BarChart2, Building2, DollarSign, Package, AlertTriangle } from 'lucide-react'
import { useAuth } from '../../providers/AuthProvider'
import { useNavigate } from 'react-router-dom'
// Cross-aggregate read: per-branch takings come from the POS module's sale
// repository. Each branch is its own business row, so the branch id is what
// gets passed as the tenant. `getSales` was imported here but never used —
// dropped rather than repointed.
import { saleRepository } from '../pos/repositories'
import { getAllLocations, addBranch, cloneBranchData, getProducts } from '../../services/supabase'
import { fmt, todayDate, businessLucideIcon } from '../../lib/utils'
import { NIG_STATES } from '../../config/constants'
import { planLimitsFor, PLAN_LABELS } from '../../lib/planLimits'
import { theme } from '../../styles/theme'
import { Card, StatCard, SectionHead, Modal, Pill, Inp, Sel, GhostBtn, TealBtn, Loading, Empty, useToast, Toast } from '../../components/ui'

const { tealDeep, tealBright, tealMist, navy, gray600, gray500, gray400, gray100, border, danger, success, warning, bg } = theme

export default function Locations({ brand, role }) {
  const { auth, setAuth } = useAuth()
  const navigate = useNavigate()
  const [locations, setLocations] = useState([])
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState({})
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const { msg, type, actionLabel, onAction, show: showToast } = useToast()
  const f = (k, v) => setForm(p => ({ ...p, [k]: v }))
  const isOwner = role === 'Owner'
  const mainId = brand?.parent_business_id || brand?.id

  useEffect(() => { load() }, [brand?.id])

  async function load() {
    setLoading(true)
    try {
      const locs = await getAllLocations(brand.id)
      setLocations(locs || [])
      // Get stats for each location
      const statsData = {}
      for (const loc of (locs || [])) {
        try {
          const [today, products] = await Promise.all([
            saleRepository.getToday(loc.id),
            getProducts(loc.id),
          ])
          statsData[loc.id] = {
            todayRevenue: (today || []).reduce((s, x) => s + (x.total || 0), 0),
            todayCount: (today || []).length,
            productCount: (products || []).length,
            lowStock: (products || []).filter(p => (p.cat || p.category) !== 'Services' && p.stock > 0 && p.stock <= (p.reorder_level || 5)).length,
          }
        } catch (e) {
          statsData[loc.id] = { todayRevenue: 0, todayCount: 0, productCount: 0, lowStock: 0 }
        }
      }
      setStats(statsData)
    } catch (e) {}
    setLoading(false)
  }

  async function saveBranch() {
    if (!form.name || !form.address) { showToast('Please enter branch name and address.', { type: 'warning' }); return }
    const limit = planLimitsFor(brand?.plan).maxLocations
    if (locations.length >= limit) {
      showToast(`Your ${PLAN_LABELS[brand?.plan] || 'current'} plan allows up to ${limit} location${limit === 1 ? '' : 's'}. Upgrade your plan in Settings to add more.`, { type: 'warning' })
      return
    }
    setSaving(true)
    try {
      const created = await addBranch({
        name: brand.name + ' — ' + form.name,
        branch_name: form.name,
        parent_business_id: mainId,
        owner: brand.owner,
        email: brand.email,
        // C20: brand.password no longer exists (anon lost it; it is never
        // returned by the client reads). Branches get no password — legacy
        // login for a branch's shared email resolves through the parent row,
        // and the RPC prefers a non-NULL-password row deterministically.
        phone: form.phone || brand.phone,
        whatsapp: form.whatsapp || brand.whatsapp,
        address: form.address,
        state: form.state || brand.state,
        city: form.city || '',
        business_type: brand.business_type || brand.type,
        hours: brand.hours || '',
        status: 'active',
        visible_on_carefind: true,
        plan: brand.plan || 'growth',
      })
      // Clone the parent's master catalog + roles into the new branch so it
      // opens ready to operate. Never blocks branch creation — a failed clone
      // still leaves a working (if empty) branch.
      const newId = Array.isArray(created) ? created[0]?.id : created?.id
      if (newId) { cloneBranchData(mainId, newId).catch(() => {}) }
      showToast('Branch added successfully!', { type: 'success' })
      setForm({}); setShowAdd(false); load()
    } catch (e) { showToast('Could not add branch. Please try again.', { type: 'error' }) }
    setSaving(false)
  }

  function switchToLocation(loc) {
    const newAuth = { ...auth, brand: loc }
    setAuth(newAuth)
    try { localStorage.setItem('carehub_auth', JSON.stringify(newAuth)) } catch (e) {}
    showToast('Switched to ' + (loc.branch_name || loc.name), { type: 'success' })
    setTimeout(() => navigate('/dashboard/dashboard'), 500)
  }

  const totalRevenue = Object.values(stats).reduce((s, x) => s + (x.todayRevenue || 0), 0)
  const totalTransactions = Object.values(stats).reduce((s, x) => s + (x.todayCount || 0), 0)
  const totalProducts = Object.values(stats).reduce((s, x) => s + (x.productCount || 0), 0)
  const totalLowStock = Object.values(stats).reduce((s, x) => s + (x.lowStock || 0), 0)

  if (!isOwner) return (
    <div style={{ padding: '40px', textAlign: 'center', color: gray400 }}>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '16px' }}><Lock size={40} /></div>
      <div style={{ fontSize: '16px', fontWeight: '700', color: gray600 }}>Multi-location management is restricted to the business Owner</div>
    </div>
  )

  return (
    <div>
      <SectionHead title='Locations' sub='Manage all your business branches in one place' btn='+ Add Branch' onBtn={() => setShowAdd(true)} />

      {/* Combined stats across all locations */}
      <div style={{ marginBottom: '20px', padding: '20px', borderRadius: theme.radius.lg, background: navy, color: 'white' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', opacity: 0.6, marginBottom: '12px' }}><BarChart2 size={14} /> Combined performance — all locations today</div>
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

      {loading ? <Loading /> : locations.length === 0 ? (
        <Empty icon={<Building2 size={40} />} message='No additional branches yet' action='+ Add First Branch' onAction={() => setShowAdd(true)} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {locations.sort((a, b) => (a.parent_business_id ? 1 : -1)).map(loc => {
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
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: tealDeep, fontWeight: '700' }}><DollarSign size={12} /> {fmt(s.todayRevenue || 0)} today</span>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: gray500 }}><Package size={12} /> {s.productCount || 0} products</span>
                        {s.lowStock > 0 && <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: warning, fontWeight: '700' }}><AlertTriangle size={12} /> {s.lowStock} low stock</span>}
                      </div>
                    </div>
                  </div>
                  {!isCurrentLocation && (
                    <TealBtn onClick={() => switchToLocation(loc)} style={{ padding: '8px 16px', fontSize: '12px' }}>Switch to this branch →</TealBtn>
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
            This branch will use the same login email and password as your main account. Inventory, sales, and staff are separate per branch.
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
