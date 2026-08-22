import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { RefreshCw, LogOut, Building2, Users, CheckCircle, Landmark, Plus, CheckCircle2, ClipboardIcon, Activity } from 'lucide-react'
import { useAuth } from '../../providers/AuthProvider'
import {
  getAgentPortfolio, getAgentCommissions, getAgentPayouts,
  getAgentSupportLogs, addAgentSupportLog,
} from '../../services/supabase'
import { fmt, fmtDate, businessName } from '../../lib/utils'
import { theme } from '../../styles/theme'
import { Card, StatCard, Pill, Inp, Sel, TealBtn, GhostBtn, Loading, Empty, Modal, useToast, Toast } from '../../components/ui'

const { tealDeep, tealMist, navy, navySoft, gray500, gray400, border, danger, dangerBg, warningBg } = theme

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'referrals', label: 'My Referrals' },
  { id: 'commissions', label: 'Commissions' },
  { id: 'payouts', label: 'Payouts' },
  { id: 'support', label: 'Support Log' },
  { id: 'activity', label: 'Activity' },
]

export default function AgentDashboard() {
  const { agent, logoutAgent } = useAuth()
  const navigate = useNavigate()
  const { msg, type, show: showToast } = useToast()
  const [tab, setTab] = useState('overview')
  const [portfolio, setPortfolio] = useState([])
  const [commissions, setCommissions] = useState([])
  const [payouts, setPayouts] = useState([])
  const [supportLogs, setSupportLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [showLog, setShowLog] = useState(false)
  const [logForm, setLogForm] = useState({ business_id: '', kind: 'followup', details: '' })

  useEffect(() => { load() }, [agent?.id])

  async function load() {
    if (!agent?.id) return
    setLoading(true)
    try {
      const [p, c, o, s] = await Promise.all([
        getAgentPortfolio(), getAgentCommissions(agent.id),
        getAgentPayouts(agent.id), getAgentSupportLogs(agent.id),
      ])
      setPortfolio(p || [])
      setCommissions(c || [])
      setPayouts(o || [])
      setSupportLogs(s || [])
    } catch (e) {
      showToast('Failed to load your dashboard: ' + e.message, { type: 'error' })
    }
    setLoading(false)
  }

  const bizName = (id) => {
    const b = portfolio.find(x => x.id === id)
    return b ? b.name : '—'
  }

  const earned = commissions.filter(c => c.status !== 'void')
  const lifetime = earned.reduce((s, c) => s + Number(c.amount || 0), 0)
  const pending = earned.filter(c => c.status === 'accrued' || c.status === 'payable')
    .reduce((s, c) => s + Number(c.amount || 0), 0)
  const signups = portfolio.length
  const typeCounts = {}
  portfolio.forEach(b => { const t = b.business_type || 'other'; typeCounts[t] = (typeCounts[t] || 0) + 1 })

  const atRisk = portfolio.filter(b => {
    const exp = b.plan_expires_at ? new Date(b.plan_expires_at) : null
    if (!exp) return false
    return exp <= new Date(Date.now() + 14 * 86400000)
  })

  const activity = [
    ...commissions.map(c => ({ date: c.created_at, kind: 'commission', type: c.type, amount: c.amount, status: c.status, business: bizName(c.business_id) })),
    ...atRisk.map(b => ({ date: b.plan_expires_at, kind: 'at_risk', business: b.name, expires: b.plan_expires_at })),
  ].sort((a, b) => new Date(b.date) - new Date(a.date))

  const saveSupportLog = async () => {
    if (!logForm.business_id) { showToast('Choose a business first.', { type: 'warning' }); return }
    if (!logForm.details.trim()) { showToast('Add a short note.', { type: 'warning' }); return }
    try {
      await addAgentSupportLog({
        agent_id: agent.id,
        business_id: logForm.business_id,
        kind: logForm.kind,
        details: logForm.details.trim(),
      })
      setShowLog(false)
      setLogForm({ business_id: '', kind: 'followup', details: '' })
      showToast('Support entry logged.', { type: 'success' })
      load()
    } catch (e) {
      showToast('Could not log entry: ' + e.message, { type: 'error' })
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: theme.bg, fontFamily: theme.fontFamily }}>
      {/* Header */}
      <div style={{ background: theme.darkGradient, color: 'white', padding: '14px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ fontSize: '20px' }}>🤝</div>
          <div>
            <div style={{ fontWeight: '800', fontSize: '14px' }}>CareHub Referral Agent</div>
            <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.6)' }}>{agent?.city ? agent.city + ' · ' : ''}{agent?.area || ''} — {agent?.name || ''}</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {agent?.referral_code && (
            <div style={{ fontSize: '12px', fontWeight: '700', padding: '6px 12px', borderRadius: theme.radius.md, background: 'rgba(255,255,255,0.15)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <CheckCircle2 size={13} /> Code: {agent.referral_code}
            </div>
          )}
          <button onClick={load} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: '8px', border: 'none', background: 'rgba(255,255,255,0.12)', color: 'white', fontWeight: '600', fontSize: '12px', cursor: 'pointer' }}><RefreshCw size={13} /> Refresh</button>
          <button onClick={() => { logoutAgent(); navigate('/') }} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: '8px', border: 'none', background: 'rgba(255,255,255,0.12)', color: 'white', fontWeight: '600', fontSize: '12px', cursor: 'pointer' }}><LogOut size={13} /> Sign out</button>
        </div>
      </div>

      <div style={{ maxWidth: '1080px', margin: '0 auto', padding: '24px' }}>
        {/* Tabs */}
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '20px' }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{ padding: '9px 18px', borderRadius: theme.radius.md, border: 'none', cursor: 'pointer', fontWeight: '700', fontSize: '13px', background: tab === t.id ? theme.tealDeep : theme.cardBg, color: tab === t.id ? 'white' : gray500, boxShadow: tab === t.id ? theme.elevation[2] : theme.elevation[1] }}>
              {t.label}
            </button>
          ))}
        </div>

        {loading ? <Loading /> : (
          <>
            {tab === 'overview' && (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: '12px', marginBottom: '20px' }}>
                  <StatCard icon={<Building2 />} label='Business Onboarded' value={signups} />
                  <StatCard icon={<Landmark />} label='Lifetime Earnings' value={'₦' + lifetime.toLocaleString()} />
                  <StatCard icon={<CheckCircle />} label='Pending Balance' value={'₦' + pending.toLocaleString()} />
                  <StatCard icon={<Users />} label='Active Agent' value={agent?.status === 'active' ? 'Yes' : agent?.status || '—'} />
                </div>

                <Card style={{ padding: '18px' }}>
                  <div style={{ fontWeight: '800', color: navy, marginBottom: '12px' }}>Territory overview</div>
                  <div style={{ fontSize: '13px', color: gray500, lineHeight: 1.9 }}>
                    You cover <strong style={{ color: navy }}>{agent?.area}, {agent?.city}</strong>. Keep these businesses supported so they stay subscribed — that's what earns you the recurring 5% on every renewal.
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '12px' }}>
                    {Object.entries(typeCounts).map(([t, n]) => (
                      <span key={t} style={{ fontSize: '12px', fontWeight: '700', padding: '6px 12px', borderRadius: theme.radius.full, background: tealMist, color: theme.tealDeep }}>{businessName(t)} — {n}</span>
                    ))}
                    {Object.keys(typeCounts).length === 0 && <span style={{ fontSize: '12px', color: gray400 }}>No businesses yet — share your referral code to onboard your first clinic or pharmacy.</span>}
                  </div>
                </Card>

                <Card style={{ padding: '18px', marginTop: '12px' }}>
                  <div style={{ fontWeight: 800, color: navy, marginBottom: '12px' }}>Your referral link</div>
                  <div style={{ fontSize: '12px', color: gray500, marginBottom: '8px' }}>Send businesses this link — they sign up with it and you're credited as their referring agent.</div>
                  <code style={{ display: 'block', fontSize: '13px', padding: '12px 14px', borderRadius: theme.radius.md, background: theme.gray50, border: `1px dashed ${theme.tealDeep}`, color: theme.tealDeep, fontWeight: 700 }}>{agent?.referral_code ? window.location.origin + '/register?ref=' + agent.referral_code : 'Code unlocks once your account is active.'}</code>
                </Card>
              </>
            )}

            {tab === 'referrals' && (
              <ReferralList portfolio={portfolio} />
            )}

            {tab === 'commissions' && (
              <CommissionsView commissions={commissions} bizName={bizName} />
            )}

            {tab === 'payouts' && (
              <PayoutsView payouts={payouts} />
            )}

            {tab === 'support' && (
              <>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '14px' }}>
                  <TealBtn onClick={() => setShowLog(true)} style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Plus size={15} /> Log follow-up</TealBtn>
                </div>
                <SupportLogView logs={supportLogs} bizName={bizName} />
              </>
            )}

            {tab === 'activity' && (
              <ActivityFeed activity={activity} />
            )}
          </>
        )}
      </div>

      <Modal show={showLog} onClose={() => setShowLog(false)} sheet title='Log support activity'
        footer={<>
          <GhostBtn onClick={() => setShowLog(false)} style={{ flex: 1, padding: '12px' }}>Cancel</GhostBtn>
          <TealBtn onClick={saveSupportLog} style={{ flex: 1, padding: '12px' }}>Save</TealBtn>
        </>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <Sel label='Business' value={logForm.business_id} onChange={v => setLogForm(p => ({ ...p, business_id: v }))} options={portfolio.map(b => ({ value: b.id, label: b.name }))} />
          <Sel label='Type' value={logForm.kind} onChange={v => setLogForm(p => ({ ...p, kind: v }))} options={[
            { value: 'followup', label: 'Follow-up call / check-in' },
            { value: 'training', label: 'Training session' },
            { value: 'feedback', label: 'Feedback sent to CareHub' },
          ]} />
          <div>
            <div style={{ fontSize: '11px', fontWeight: '700', color: gray500, marginBottom: '6px' }}>Details</div>
            <textarea value={logForm.details} onChange={e => setLogForm(p => ({ ...p, details: e.target.value }))} rows={3} placeholder='What was done, what was discussed…'
              style={{ width: '100%', minHeight: 80, padding: '10px 12px', borderRadius: theme.radius.md, border: `1px solid ${border}`, fontSize: '13px', boxSizing: 'border-box', color: navy, outline: 'none', resize: 'vertical' }} />
          </div>
        </div>
      </Modal>

      <Toast msg={msg} type={type} />
    </div>
  )
}

function ReferralList({ portfolio }) {
  if (!portfolio.length) return <Empty icon={<Building2 size={28} />} message='No businesses attributed to you yet.' />
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {portfolio.map(b => {
        const expired = b.plan_expires_at && new Date(b.plan_expires_at) <= new Date()
        const soon = b.plan_expires_at && new Date(b.plan_expires_at) <= new Date(Date.now() + 14 * 86400000)
        return (
          <Card key={b.id} style={{ padding: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: '800', fontSize: '15px', color: navy }}>{b.name}</div>
                <div style={{ fontSize: '12px', color: gray500, marginTop: '2px' }}>{businessName(b.business_type)} · {b.state || '—'} · joined {fmtDate(b.created_at)}</div>
              </div>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <Pill label={b.plan || 'basic'} type='gray' />
                <Pill label={!b.plan_expires_at ? 'never paid' : expired ? 'lapsed' : soon ? 'expiring soon' : 'active'} type={!b.plan_expires_at ? 'red' : expired ? 'red' : soon ? 'amber' : 'green'} />
              </div>
            </div>
          </Card>
        )
      })}
    </div>
  )
}

function CommissionsView({ commissions, bizName }) {
  if (!commissions.length) return <Empty icon={<Landmark size={28} />} message='No commissions yet. They appear here when a referred business makes its first payment.' />
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {commissions.map(c => (
        <Card key={c.id} style={{ padding: '14px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontWeight: '800', fontSize: '14px', color: navy }}>{bizName(c.business_id)}</div>
            <div style={{ fontSize: '12px', color: gray500, marginTop: '2px' }}>{fmtDate(c.created_at)}</div>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <Pill label={c.type === 'referral_bonus' ? 'Referral bonus' : 'Residual'} type={c.type === 'referral_bonus' ? 'green' : 'teal'} />
            <span style={{ fontWeight: '900', fontSize: '14px', color: navy }}>₦{Number(c.amount || 0).toLocaleString()}</span>
            <Pill label={c.status} type={c.status === 'paid' || c.status === 'void' ? 'gray' : c.status === 'payable' ? 'amber' : 'green'} />
          </div>
        </Card>
      ))}
    </div>
  )
}

function PayoutsView({ payouts }) {
  if (!payouts.length) return <Empty icon={<Landmark size={28} />} message='No payouts yet. Accrued commissions will be batched into payouts by CareHub.' />
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {payouts.map(p => (
        <Card key={p.id} style={{ padding: '14px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontWeight: '800', fontSize: '14px', color: navy }}>Payout — {fmtDate(p.created_at)}</div>
            <div style={{ fontSize: '12px', color: gray500, marginTop: '2px' }}>{p.method || 'bank transfer'} · {Array.isArray(p.commission_ids) ? p.commission_ids.length : 0} commissions</div>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <span style={{ fontWeight: '900', fontSize: '15px', color: navy }}>₦{Number(p.total_amount || 0).toLocaleString()}</span>
            <Pill label={p.status} type={p.status === 'processed' ? 'green' : p.status === 'failed' ? 'red' : 'amber'} />
          </div>
        </Card>
      ))}
    </div>
  )
}

function SupportLogView({ logs, bizName }) {
  if (!logs.length) return <Empty icon={<ClipboardIcon size={28} />} message="No support entries yet. Logging follow-ups, training calls, and feedback is part of staying active as an agent." />
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {logs.map(l => (
        <Card key={l.id} style={{ padding: '14px 16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: '800', fontSize: '14px', color: navy }}>{bizName(l.business_id)}</span>
            <span style={{ fontSize: '12px', color: gray400 }}>{fmtDate(l.created_at)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginTop: '6px', flexWrap: 'wrap' }}>
            <Pill label={l.kind} type={l.kind === 'training' ? 'teal' : l.kind === 'feedback' ? 'blue' : 'green'} />
            <span style={{ fontSize: '13px', color: gray500 }}>{l.details}</span>
          </div>
        </Card>
      ))}
    </div>
  )
}

function ActivityFeed({ activity }) {
  if (!activity.length) return <Empty icon={<Activity size={28} />} message="No activity yet. You'll see new sign-ups and at-risk businesses here." />
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {activity.slice(0, 40).map((a, i) => {
        const isAtRisk = a.kind === 'at_risk'
        return (
          <Card key={i} style={{ padding: '14px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontWeight: '800', fontSize: '14px', color: navy }}>{isAtRisk ? '⚠ ' + a.business + ' near expiry' : 'Business signed up — ' + a.business}</div>
              <div style={{ fontSize: '12px', color: gray500, marginTop: '2px' }}>{fmtDate(a.date)}</div>
            </div>
            {!isAtRisk && <Pill label={(a.type === 'referral_bonus' ? '40% bonus' : '5% residual') + ' · ₦' + Number(a.amount || 0).toLocaleString()} type={a.type === 'referral_bonus' ? 'green' : 'teal'} />}
            {isAtRisk && <Pill label={new Date(a.expires) <= new Date() ? 'Lapsed' : 'Expiring soon'} type='amber' />}
          </Card>
        )
      })}
    </div>
  )
}