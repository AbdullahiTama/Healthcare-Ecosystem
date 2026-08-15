import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { RefreshCw, Bell, Building2, Hourglass, CheckCircle, Users, Check, X, Pause, Play } from 'lucide-react'
import { useAuth } from '../../providers/AuthProvider'
import { getBusinesses, getAdminTeam, updateBusiness, addAdminTeam, removeAdminTeam } from '../../services/supabase'
import { emailBusinessApproved, emailBusinessRejected } from '../../lib/email'
import { businessLucideIcon, businessName, DARK } from '../../lib/utils'
import { theme } from '../../styles/theme'
import { Card, StatCard, Pill, Modal, Inp, Sel, GhostBtn, TealBtn, Avatar, Loading, useToast, Toast, Logo } from '../../components/ui'
import { ApplicationsPanel, AgentsPanel, LedgerPanel, PayoutsPanel, CoveragePanel } from './referral/AdminReferralPanels'

export default function AdminDashboard() {
  const [businesses, setBusinesses] = useState([])
  const [team, setTeam] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('businesses')
  const [selected, setSelected] = useState(null)
  const [showInvite, setShowInvite] = useState(false)
  const [invite, setInvite] = useState({})
  const { msg, show: showToast } = useToast()
  const navigate = useNavigate()
  const { logout: authLogout } = useAuth()

  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t) }, [])

  async function load() {
    try {
      const [b, t] = await Promise.all([getBusinesses(), getAdminTeam()])
      setBusinesses(b || []); setTeam(t || [])
    } catch (e) {}
    setLoading(false)
  }

  async function updateStatus(id, status, msg) {
    try {
      await updateBusiness(id, { status })
      const biz = businesses.find(b => b.id === id)
      setBusinesses(prev => prev.map(b => b.id === id ? { ...b, status } : b))
      setSel(null)
      showToast(msg)
      // Send email notification
      if (biz) {
        try {
          if (status === 'active') {
            await emailBusinessApproved({
              businessName: biz.name,
              ownerName: biz.owner,
              ownerEmail: biz.email,
            })
          } else if (status === 'rejected') {
            await emailBusinessRejected({
              businessName: biz.name,
              ownerName: biz.owner,
              ownerEmail: biz.email,
            })
          }
        } catch (e) {}
      }
    } catch (e) { showToast('Error updating status.') }
  }
  const [sel, setSel] = useState(null)

  const pending = businesses.filter(b => b.status === 'pending')
  const active = businesses.filter(b => b.status === 'active')

  const logout = () => { authLogout(); navigate('/login') }

  return (
    <div style={{ minHeight: '100vh', background: '#f9fafb', fontFamily: 'system-ui,sans-serif' }}>
      {/* Header */}
      <div style={{ background: DARK, color: 'white', padding: '14px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', backgroundImage: DARK }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Logo size={32} />
          <div><div style={{ fontWeight: '800', fontSize: '14px' }}>CareHub Admin</div><div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)' }}>Super Admin Panel</div></div>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={load} style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '6px 12px', borderRadius: '8px', border: 'none', background: 'rgba(255,255,255,0.1)', color: 'white', fontWeight: '600', fontSize: '12px', cursor: 'pointer' }}><RefreshCw size={13} /> Refresh</button>
          <button onClick={logout} style={{ padding: '6px 12px', borderRadius: '8px', border: 'none', background: 'rgba(255,255,255,0.1)', color: 'white', fontWeight: '600', fontSize: '12px', cursor: 'pointer' }}>Sign Out</button>
        </div>
      </div>

      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '24px' }}>
        {pending.length > 0 && (
          <div style={{ marginBottom: '20px', padding: '14px 18px', borderRadius: '14px', background: theme.warningBg, border: `1px solid ${theme.amberBorder}`, display: 'flex', alignItems: 'center', gap: '12px' }}>
            <Bell size={20} color='#d97706' style={{ flexShrink: 0 }} />
            <div><div style={{ fontWeight: '700', color: theme.amberText, fontSize: '14px' }}>{pending.length} business(es) waiting for approval!</div><div style={{ fontSize: '12px', color: theme.amberDeep }}>{pending.map(b => b.name).join(' Â· ')}</div></div>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: '12px', marginBottom: '24px' }}>
          <StatCard icon={<Building2 />} label='Total Businesses' value={businesses.length} />
          <StatCard icon={<Hourglass />} label='Pending Approval' value={pending.length} alert={pending.length > 0} />
          <StatCard icon={<CheckCircle />} label='Active' value={active.length} />
          <StatCard icon={<Users />} label='Admin Team' value={team.length} />
        </div>

        <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', flexWrap: 'wrap' }}>
          {['businesses', 'team', 'applications', 'agents', 'ledger', 'payouts', 'coverage'].map(t => <button key={t} onClick={() => setTab(t)} style={{ padding: '9px 20px', borderRadius: '10px', border: 'none', cursor: 'pointer', fontWeight: '700', fontSize: '13px', background: tab === t ? '#0E6F5A' : '#f3f4f6', color: tab === t ? 'white' : '#666', textTransform: 'capitalize' }}>{t}</button>)}
        </div>

        {loading ? <Loading /> : tab === 'businesses' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {businesses.map(b => (
              <Card key={b.id} style={{ padding: '16px', cursor: 'pointer' }} onClick={() => setSel(b)}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{ width: '44px', height: '44px', borderRadius: theme.radius.md, background: theme.tealMist, color: theme.tealDeep, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{(() => { const Icon = businessLucideIcon(b.business_type || b.type); return <Icon size={20} /> })()}</div>
                    <div>
                      <div style={{ fontWeight: '800', fontSize: '15px' }}>{b.name}</div>
                      <div style={{ fontSize: '12px', color: theme.textFaint, marginTop: '2px' }}>{b.owner} Â· {b.email}</div>
                      <div style={{ fontSize: '12px', color: '#aaa', marginTop: '2px' }}>{businessName(b.business_type || b.type)} Â· {b.state || 'â€”'}</div>
                    </div>
                  </div>
                  <Pill label={b.status} type={b.status === 'active' ? 'green' : b.status === 'pending' ? 'amber' : b.status === 'suspended' ? 'red' : 'gray'} />
                </div>
              </Card>
            ))}
          </div>
        ) : tab === 'applications' ? <ApplicationsPanel />
        : tab === 'agents' ? <AgentsPanel />
        : tab === 'ledger' ? <LedgerPanel />
        : tab === 'payouts' ? <PayoutsPanel />
        : tab === 'coverage' ? <CoveragePanel />
        : (
          <div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '16px' }}>
              <TealBtn onClick={() => setShowInvite(true)}>+ Invite Team Member</TealBtn>
            </div>
            {team.length === 0 ? <div style={{ textAlign: 'center', padding: '40px', color: '#ccc' }}>No team members yet</div> : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {team.map(m => (
                  <Card key={m.id} style={{ padding: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <Avatar name={m.name} size={40} />
                      <div>
                        <div style={{ fontWeight: '700' }}>{m.name}</div>
                        <div style={{ fontSize: '12px', color: theme.textFaint }}>{m.email} Â· {m.role}</div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <Pill label={m.status} type={m.status === 'active' ? 'green' : 'amber'} />
                      <button onClick={async () => { await removeAdminTeam(m.id); load() }} style={{ padding: '5px 10px', borderRadius: '8px', border: 'none', background: theme.dangerBg, color: theme.danger, fontWeight: '700', fontSize: '12px', cursor: 'pointer' }}>Remove</button>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Business detail modal */}
      <Modal show={!!sel} onClose={() => setSel(null)} title='Business Details'
        footer={sel && (
          <div style={{ display: 'flex', gap: '8px', width: '100%', flexWrap: 'wrap' }}>
            {sel.status === 'pending' && <>
              <TealBtn onClick={() => updateStatus(sel.id, 'active', 'Approved!')} style={{ flex: 1, padding: '11px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}><Check size={14} /> Approve</TealBtn>
              <button onClick={() => updateStatus(sel.id, 'rejected', 'Rejected.')} style={{ flex: 1, padding: '11px', borderRadius: '12px', border: 'none', background: theme.dangerBg, color: theme.danger, fontWeight: '700', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}><X size={14} /> Reject</button>
            </>}
            {sel.status === 'active' && <button onClick={() => updateStatus(sel.id, 'suspended', 'Suspended.')} style={{ flex: 1, padding: '11px', borderRadius: '12px', border: 'none', background: '#fffbeb', color: '#d97706', fontWeight: '700', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}><Pause size={14} /> Suspend</button>}
            {sel.status === 'suspended' && <TealBtn onClick={() => updateStatus(sel.id, 'active', 'Reactivated!')} style={{ flex: 1, padding: '11px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}><Play size={14} /> Reactivate</TealBtn>}
          </div>
        )}>
        {sel && [['Business Name', sel.name], ['Type', businessName(sel.business_type || sel.type)], ['Owner', sel.owner], ['Email', sel.email], ['Phone', sel.phone || 'â€”'], ['WhatsApp', sel.whatsapp || 'â€”'], ['Address', sel.address || 'â€”'], ['State', sel.state || 'â€”'], ['Hours', sel.hours || 'â€”'], ['CareFind', (sel.visible_on_carefind !== false) ? 'Listed' : 'Hidden'], ['Plan', sel.plan || 'basic'], ['Registered', sel.created_at?.split('T')[0]]].map(([l, v]) => (
          <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f9f9f9', fontSize: '13px' }}>
            <span style={{ color: theme.textFaint, fontWeight: '600' }}>{l}</span><span style={{ color: theme.slate, textAlign: 'right' }}>{v}</span>
          </div>
        ))}
      </Modal>

      {/* Invite modal */}
      <Modal show={showInvite} onClose={() => { setShowInvite(false); setInvite({}) }} title='Invite Team Member'
        footer={<><GhostBtn onClick={() => { setShowInvite(false); setInvite({}) }} style={{ flex: 1, padding: '12px' }}>Cancel</GhostBtn><TealBtn onClick={async () => { if (invite.name && invite.email) { try { await addAdminTeam({ name: invite.name, email: invite.email, role: invite.role || 'Support Agent', status: 'invited' }); load(); setShowInvite(false); setInvite({}); showToast('Invite sent!') } catch (e) { showToast('Error â€” email may exist') } } }} style={{ flex: 1, padding: '12px' }}>Send Invite</TealBtn></>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <Inp label='Full Name *' value={invite.name} onChange={v => setInvite(p => ({ ...p, name: v }))} placeholder='Team member name' required />
          <Inp label='Email Address *' value={invite.email} onChange={v => setInvite(p => ({ ...p, email: v }))} type='email' required />
          <Sel label='Role' value={invite.role} onChange={v => setInvite(p => ({ ...p, role: v }))} options={['Support Agent', 'Brand Manager', 'Technical Lead', 'Admin']} />
        </div>
      </Modal>

      <Toast msg={msg} />
    </div>
  )
}
