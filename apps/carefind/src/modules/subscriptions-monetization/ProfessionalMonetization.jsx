import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../../config/supabaseClient'
import { useAuth } from '../../providers/AuthContext'
import {
  BadgeCheck, CalendarDays, ChevronRight, ClipboardList, Coins, FileText,
  Landmark, LayoutDashboard, Lock, MessageSquare, Radio, Stethoscope, Video, Wallet as WalletIcon, Briefcase, Check,
} from 'lucide-react'
import { theme } from '../../styles/theme'
import { useBreakpoint } from '../../hooks/useBreakpoint'
import { useHeaderIdentity } from '../../hooks/useHeaderIdentity'
import AppShell from '../../components/layout/AppShell.jsx'
import BottomNav from '../../components/BottomNav.jsx'
import { Loading, Toast, useToast } from '../../components/ui'

function ProfessionalMonetization() {
  const { user, loading: authLoading } = useAuth()
  const navigate = useNavigate()
  const { isMobile } = useBreakpoint()
  const { myUsername, myAvatar, unreadNotifs } = useHeaderIdentity(user)
  const [profile, setProfile] = useState(null)
  const [subscription, setSubscription] = useState(null)
  const [subscribers, setSubscribers] = useState([])
  const [consultations, setConsultations] = useState([])
  const [tasks, setTasks] = useState([])
  const [submissions, setSubmissions] = useState([])
  const [wallet, setWallet] = useState(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('overview')
  const [editingPrice, setEditingPrice] = useState(false)
  const [newPrice, setNewPrice] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [consultFee, setConsultFee] = useState('')
  const [consultType, setConsultType] = useState('text')
  const [consultNotes, setConsultNotes] = useState('')
  const { msg: toastMsg, type: toastType, actionLabel: toastActionLabel, onAction: toastOnAction, show: showToast } = useToast()

  useEffect(() => {
    async function load() {
      if (!user) { setLoading(false); return }
      setLoading(true)

      const [profileRes, subRes, subscribersRes, consultRes, tasksRes, submissionsRes, walletRes] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', user.id).single(),
        supabase.from('subscriptions').select('*').eq('professional_id', user.id).maybeSingle(),
        supabase.from('user_subscriptions').select('id, subscriber_id, started_at, status, profiles(full_name, display_name)').eq('professional_id', user.id).eq('status', 'active'),
        supabase.from('professional_consultations').select('*').eq('professional_id', user.id).order('created_at', { ascending: false }),
        supabase.from('tasks').select('*').eq('status', 'open').order('created_at', { ascending: false }),
        supabase.from('task_submissions').select('*, tasks(title, compensation)').eq('professional_id', user.id),
        supabase.from('wallets').select('balance').eq('user_id', user.id).maybeSingle(),
      ])

      setProfile(profileRes.data)
      setSubscription(subRes.data)
      setSubscribers(subscribersRes.data || [])
      setConsultations(consultRes.data || [])
      const setupRow = (consultRes.data || []).find(c => c.status === 'setup')
      if (setupRow) {
        setConsultFee(setupRow.fee?.toString() || '')
        setConsultType(setupRow.type || 'text')
        setConsultNotes(setupRow.notes || '')
      }
      setTasks(tasksRes.data || [])
      setSubmissions(submissionsRes.data || [])
      setWallet(walletRes.data)
      if (subRes.data) {
        setNewPrice(subRes.data.price?.toString() || '500')
        setNewDescription(subRes.data.description || '')
      }
      setLoading(false)
    }
    if (!authLoading) load()
  }, [user, authLoading])

  async function saveSubscription() {
    if (!newPrice || parseInt(newPrice) < 100) return
    setSaving(true)
    if (subscription) {
      await supabase.from('subscriptions').update({ price: parseInt(newPrice), description: newDescription, is_active: true }).eq('id', subscription.id)
    } else {
      await supabase.from('subscriptions').insert({ professional_id: user.id, price: parseInt(newPrice), description: newDescription })
    }
    const { data } = await supabase.from('subscriptions').select('*').eq('professional_id', user.id).maybeSingle()
    setSubscription(data)
    setEditingPrice(false)
    setSaving(false)
  }

  async function submitConsultationSetup() {
    if (!consultFee || parseInt(consultFee) < 100) return
    setSaving(true)
    const { error } = await supabase.from('professional_consultations').upsert({
      professional_id: user.id,
      patient_id: user.id,
      type: consultType,
      fee: parseInt(consultFee),
      notes: consultNotes,
      status: 'setup',
    }, { onConflict: 'professional_id' })
    setSaving(false)
    if (error) {
      showToast(`Could not save: ${error.message}`, { type: 'error' })
      return
    }
    const { data } = await supabase.from('professional_consultations').select('*').eq('professional_id', user.id).order('created_at', { ascending: false })
    setConsultations(data || [])
    showToast('Consultation profile saved! Patients can now book you.', { type: 'success' })
  }

  async function acceptTask(taskId) {
    const { error } = await supabase.from('task_submissions').insert({
      task_id: taskId,
      professional_id: user.id,
      status: 'pending',
    })
    if (!error) {
      const { data } = await supabase.from('task_submissions').select('*, tasks(title, compensation)').eq('professional_id', user.id)
      setSubmissions(data || [])
    }
  }

  if (authLoading || loading) return <Loading />

  if (!user || !profile?.is_verified) {
    const verifyRequiredContent = (
      <div style={isMobile ? { fontFamily: theme.fontFamily, maxWidth: 420, margin: '0 auto', paddingBottom: 'calc(90px + env(safe-area-inset-bottom))' } : { fontFamily: theme.fontFamily }}>
        <div style={{
          background: theme.navy, color: '#fff',
          ...(isMobile ? { padding: '22px 20px 26px', borderRadius: '0 0 28px 28px' } : { padding: '22px 26px', borderRadius: theme.radius.xl }),
        }}>
          {isMobile && <Link to="/profile" style={{ color: 'rgba(255,255,255,0.7)', textDecoration: 'none', fontSize: 13, fontWeight: 700 }}>← Profile</Link>}
          <h1 style={{ fontSize: 21, fontWeight: 900, margin: isMobile ? '14px 0 4px 0' : 0 }}>Earn on CareFind</h1>
        </div>
        <div style={{ textAlign: 'center', padding: '40px 20px' }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}><Stethoscope size={40} color={theme.gray300} strokeWidth={1.5} aria-hidden="true" /></div>
          <h3 style={{ fontSize: 15, fontWeight: 800, color: theme.navy, margin: '0 0 6px 0' }}>Verification required</h3>
          <p style={{ fontSize: 13, color: theme.textLight, margin: '0 0 16px 0' }}>Get verified as a healthcare professional to unlock all earning features</p>
          <Link to="/verify" style={{ display: 'inline-block', padding: '10px 20px', background: theme.tealDeep, color: '#fff', borderRadius: 14, textDecoration: 'none', fontWeight: 700, fontSize: 13 }}>
            Get Verified
          </Link>
        </div>
        {isMobile && <BottomNav />}
      </div>
    )

    if (isMobile) return verifyRequiredContent

    return (
      <AppShell user={user} myUsername={myUsername} myAvatar={myAvatar} unreadNotifs={unreadNotifs} onCompose={() => navigate('/feed')}>
        {verifyRequiredContent}
      </AppShell>
    )
  }

  const totalEarnings = (wallet?.balance || 0) * 200
  const pendingConsults = consultations.filter(c => c.status === 'paid').length
  const submittedTaskIds = submissions.map(s => s.task_id)

  const bodyContent = (
    <div style={isMobile
      ? { fontFamily: theme.fontFamily, maxWidth: 480, margin: '0 auto', paddingBottom: 'calc(90px + env(safe-area-inset-bottom))' }
      : { fontFamily: theme.fontFamily, maxWidth: 640, margin: '0 auto' }}>
      <div style={{
        background: theme.navy, color: '#fff',
        ...(isMobile ? { padding: '22px 20px 26px', borderRadius: '0 0 28px 28px' } : { padding: '24px 26px', borderRadius: theme.radius.xl, marginBottom: 20 }),
      }}>
        {isMobile && <Link to="/professional-dashboard" style={{ color: 'rgba(255,255,255,0.7)', textDecoration: 'none', fontSize: 13, fontWeight: 700 }}>← Dashboard</Link>}
        <h1 style={{ fontSize: 21, fontWeight: 900, margin: isMobile ? '14px 0 4px 0' : '0 0 4px 0' }}>Earn on CareFind</h1>
        <p style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'rgba(255,255,255,0.65)', margin: '0 0 16px 0' }}><BadgeCheck size={14} aria-hidden="true" /> {profile.specialty || profile.verification_label}</p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10 }}>
          <div style={{ background: 'rgba(255,255,255,0.12)', borderRadius: 14, padding: '12px 10px', textAlign: 'center' }}>
            <p style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 7, fontSize: 17, fontWeight: 900 }}><Coins size={16} aria-hidden="true" /> {wallet?.balance || 0}</p>
            <p style={{ margin: 0, fontSize: 10.5, color: 'rgba(255,255,255,0.65)', fontWeight: 700 }}>CareCoins</p>
          </div>
          <div style={{ background: 'rgba(255,255,255,0.12)', borderRadius: 14, padding: '12px 10px', textAlign: 'center' }}>
            <p style={{ margin: 0, fontSize: 17, fontWeight: 900 }}>{subscribers.length}</p>
            <p style={{ margin: 0, fontSize: 10.5, color: 'rgba(255,255,255,0.65)', fontWeight: 700 }}>Subscribers</p>
          </div>
          <div style={{ background: 'rgba(255,255,255,0.12)', borderRadius: 14, padding: '12px 10px', textAlign: 'center' }}>
            <p style={{ margin: 0, fontSize: 17, fontWeight: 900 }}>{pendingConsults}</p>
            <p style={{ margin: 0, fontSize: 10.5, color: 'rgba(255,255,255,0.65)', fontWeight: 700 }}>Bookings</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 6, padding: isMobile ? '14px 20px 4px' : '0 0 14px', overflowX: 'auto' }}>
        {[
          { key: 'overview', label: 'Overview', Icon: LayoutDashboard },
          { key: 'subscription', label: 'Subscription', Icon: Lock },
          { key: 'consultation', label: 'Consults', Icon: CalendarDays },
          { key: 'tasks', label: 'Tasks', Icon: ClipboardList },
        ].map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            flexShrink: 0, padding: '7px 14px', borderRadius: 20, fontSize: 12, fontWeight: 700,
            border: tab === t.key ? 'none' : `1px solid ${theme.border}`,
            background: tab === t.key ? theme.tealDeep : theme.cardBg,
            color: tab === t.key ? '#fff' : theme.textMid,
          }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <t.Icon size={13} aria-hidden="true" /> {t.label}
            </span>
          </button>
        ))}
      </div>

      <div style={isMobile ? { padding: '16px 20px 0' } : {}}>

        {/* OVERVIEW */}
        {tab === 'overview' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[
              { Icon: Lock, title: 'Premium Content', desc: subscription ? `₦${subscription.price}/month · ${subscribers.length} subscribers` : 'Not set up yet', action: () => setTab('subscription') },
              { Icon: CalendarDays, title: 'Consultations', desc: `${pendingConsults} pending booking${pendingConsults !== 1 ? 's' : ''}`, action: () => setTab('consultation') },
              { Icon: ClipboardList, title: 'Sponsored Tasks', desc: `${tasks.length} open task${tasks.length !== 1 ? 's' : ''} available`, action: () => setTab('tasks') },
              { Icon: WalletIcon, title: 'Gifts Received', desc: `${wallet?.balance || 0} CareCoins ≈ ₦${((wallet?.balance || 0) * 200).toLocaleString()}`, action: () => {} },
              { Icon: Radio, title: 'Live Session Earnings', desc: 'Gifts from your live sessions — permanently recorded', action: () => {} },
            ].map((item) => (
              <button key={item.title} onClick={item.action} style={{
                border: `1px solid ${theme.border}`, borderRadius: 16, padding: 14, background: theme.cardBg,
                boxShadow: '0 1px 4px rgba(0,0,0,0.05)', display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left',
              }}>
                <span style={{ width: 40, height: 40, borderRadius: theme.radius.md, background: theme.tealMist, color: theme.tealDeep, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><item.Icon size={19} aria-hidden="true" /></span>
                <div style={{ flex: 1 }}>
                  <p style={{ margin: '0 0 2px 0', fontWeight: 800, fontSize: 14, color: theme.navy }}>{item.title}</p>
                  <p style={{ margin: 0, fontSize: 12.5, color: theme.textLight }}>{item.desc}</p>
                </div>
                <ChevronRight size={17} color={theme.gray400} aria-hidden="true" />
              </button>
            ))}

            <Link to="/wallet" style={{ textDecoration: 'none' }}>
              <div style={{ border: `1px solid ${theme.tealDeep}`, borderRadius: 16, padding: 14, background: theme.tealMist, display: 'flex', alignItems: 'center', gap: 12 }}>
                <Landmark size={20} color={theme.tealDeep} aria-hidden="true" />
                <div style={{ flex: 1 }}>
                  <p style={{ margin: 0, fontWeight: 800, fontSize: 14, color: theme.tealDeep }}>Withdraw Earnings</p>
                  <p style={{ margin: 0, fontSize: 12, color: theme.tealDeep }}>Balance: {wallet?.balance || 0} CareCoins</p>
                </div>
                <ChevronRight size={17} color={theme.tealDeep} aria-hidden="true" />
              </div>
            </Link>
          </div>
        )}

        {/* SUBSCRIPTION */}
        {tab === 'subscription' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ border: `1px solid ${theme.border}`, borderRadius: 16, padding: 16, background: theme.cardBg }}>
              <h3 style={{ margin: '0 0 6px 0', fontSize: 15, fontWeight: 800, color: theme.navy }}>Your Subscription Plan</h3>
              <p style={{ margin: '0 0 14px 0', fontSize: 13, color: theme.textLight, lineHeight: 1.5 }}>
                Set a monthly price. Subscribers pay this to unlock all your premium posts. You earn 90% of each payment.
              </p>

              {editingPrice || !subscription ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div>
                    <label style={{ fontSize: 11, color: theme.textLight, fontWeight: 700, display: 'block', marginBottom: 4 }}>Monthly Price (₦)</label>
                    <input type="number" value={newPrice} onChange={(e) => setNewPrice(e.target.value)} placeholder="e.g. 500" min="100"
                      style={{ width: '100%', padding: 11, fontSize: 15, fontWeight: 700, border: `1px solid ${theme.border}`, borderRadius: 12 }} />
                    <p style={{ margin: '4px 0 0', fontSize: 11, color: theme.textLight }}>Minimum ₦100 · You earn 90% = ₦{Math.floor((parseInt(newPrice) || 0) * 0.9)}/subscriber/month</p>
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: theme.textLight, fontWeight: 700, display: 'block', marginBottom: 4 }}>What subscribers get (optional)</label>
                    <textarea value={newDescription} onChange={(e) => setNewDescription(e.target.value)} placeholder="e.g. Exclusive drug safety alerts, clinical tips, and monthly Q&A sessions"
                      rows={3} style={{ width: '100%', padding: 10, fontSize: 13, border: `1px solid ${theme.border}`, borderRadius: 12, fontFamily: 'inherit' }} />
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={saveSubscription} disabled={saving} style={{ flex: 2, padding: 12, background: theme.tealDeep, color: '#fff', border: 'none', borderRadius: 12, fontWeight: 800, fontSize: 14 }}>
                      {saving ? 'Saving...' : 'Save Plan'}
                    </button>
                    {subscription && <button onClick={() => setEditingPrice(false)} style={{ flex: 1, padding: 12, background: theme.bg, color: theme.textMid, border: `1px solid ${theme.border}`, borderRadius: 12, fontWeight: 700, fontSize: 13 }}>Cancel</button>}
                  </div>
                </div>
              ) : (
                <div>
                  <div style={{ background: theme.tealMist, borderRadius: 14, padding: 14, marginBottom: 12 }}>
                    <p style={{ margin: '0 0 4px 0', fontSize: 22, fontWeight: 900, color: theme.tealDeep }}>₦{subscription.price}<span style={{ fontSize: 13, fontWeight: 600 }}>/month</span></p>
                    {subscription.description && <p style={{ margin: 0, fontSize: 13, color: theme.textMid }}>{subscription.description}</p>}
                  </div>
                  <p style={{ margin: '0 0 10px 0', fontSize: 13, color: theme.textLight }}>
                    {subscribers.length} active subscriber{subscribers.length !== 1 ? 's' : ''} · You earn ₦{Math.floor(subscription.price * 0.9 * subscribers.length).toLocaleString()}/month
                  </p>
                  <button onClick={() => setEditingPrice(true)} style={{ padding: '8px 16px', background: 'none', border: `1px solid ${theme.tealDeep}`, color: theme.tealDeep, borderRadius: 10, fontWeight: 700, fontSize: 13 }}>
                    Edit Plan
                  </button>
                </div>
              )}
            </div>

            {subscribers.length > 0 && (
              <div style={{ border: `1px solid ${theme.border}`, borderRadius: 16, padding: 14, background: theme.cardBg }}>
                <h3 style={{ margin: '0 0 12px 0', fontSize: 14, fontWeight: 800, color: theme.navy }}>Active Subscribers ({subscribers.length})</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {subscribers.map((s) => (
                    <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: `1px solid ${theme.border}` }}>
                      <div style={{ width: 32, height: 32, borderRadius: '50%', background: theme.tealDeep, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 12, fontWeight: 800 }}>
                        {(s.profiles?.full_name || s.profiles?.display_name || '?')[0]?.toUpperCase()}
                      </div>
                      <p style={{ margin: 0, fontSize: 13, color: theme.navy, fontWeight: 600 }}>{s.profiles?.full_name || s.profiles?.display_name || 'Subscriber'}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* CONSULTATIONS */}
        {tab === 'consultation' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ border: `1px solid ${theme.border}`, borderRadius: 16, padding: 16, background: theme.cardBg }}>
              <h3 style={{ margin: '0 0 6px 0', fontSize: 15, fontWeight: 800, color: theme.navy }}>Offer Consultations</h3>
              <p style={{ margin: '0 0 14px 0', fontSize: 13, color: theme.textLight, lineHeight: 1.5 }}>
                Set your consultation fee. Patients pay upfront, you earn 85% after the platform fee.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div>
                  <label style={{ fontSize: 11, color: theme.textLight, fontWeight: 700, display: 'block', marginBottom: 4 }}>Consultation Type</label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {['text', 'video', 'document'].map((t) => (
                      <button key={t} onClick={() => setConsultType(t)} style={{
                        flex: 1, padding: '8px 6px', borderRadius: 10, fontSize: 11.5, fontWeight: 700, border: 'none',
                        background: consultType === t ? theme.tealDeep : theme.bg, color: consultType === t ? '#fff' : theme.textMid, textTransform: 'capitalize',
                      }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          {t === 'text' ? <><MessageSquare size={13} aria-hidden="true" /> Text</> : t === 'video' ? <><Video size={13} aria-hidden="true" /> Video</> : <><FileText size={13} aria-hidden="true" /> Document</>}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label style={{ fontSize: 11, color: theme.textLight, fontWeight: 700, display: 'block', marginBottom: 4 }}>Your Fee (₦)</label>
                  <input type="number" value={consultFee} onChange={(e) => setConsultFee(e.target.value)} placeholder="e.g. 2000" min="500"
                    style={{ width: '100%', padding: 11, fontSize: 15, fontWeight: 700, border: `1px solid ${theme.border}`, borderRadius: 12 }} />
                  {consultFee && <p style={{ margin: '4px 0 0', fontSize: 11, color: theme.textLight }}>You earn ₦{Math.floor((parseInt(consultFee) || 0) * 0.85).toLocaleString()} per consultation</p>}
                </div>
                <div>
                  <label style={{ fontSize: 11, color: theme.textLight, fontWeight: 700, display: 'block', marginBottom: 4 }}>Notes for patients (optional)</label>
                  <textarea value={consultNotes} onChange={(e) => setConsultNotes(e.target.value)} placeholder="e.g. Available Mon-Fri 9am-5pm. Please describe your symptoms when booking."
                    rows={3} style={{ width: '100%', padding: 10, fontSize: 13, border: `1px solid ${theme.border}`, borderRadius: 12, fontFamily: 'inherit' }} />
                </div>
                <button onClick={submitConsultationSetup} disabled={saving} style={{ padding: 13, background: theme.tealDeep, color: '#fff', border: 'none', borderRadius: 13, fontWeight: 800, fontSize: 14 }}>
                  {saving ? 'Saving...' : 'Save Consultation Profile'}
                </button>
              </div>
            </div>

            {consultations.filter(c => c.status === 'paid').length > 0 && (
              <div style={{ border: `1px solid ${theme.border}`, borderRadius: 16, padding: 14, background: theme.cardBg }}>
                <h3 style={{ margin: '0 0 12px 0', fontSize: 14, fontWeight: 800, color: theme.navy }}>Incoming Bookings</h3>
                {consultations.filter(c => c.status === 'paid').map((c) => (
                  <div key={c.id} style={{ padding: '10px 0', borderBottom: `1px solid ${theme.border}` }}>
                    <p style={{ margin: '0 0 2px 0', fontSize: 13, fontWeight: 700, color: theme.navy, textTransform: 'capitalize' }}>{c.type} Consultation</p>
                    <p style={{ margin: '0 0 4px 0', fontSize: 12, color: theme.textLight }}>Fee: ₦{c.fee?.toLocaleString()}</p>
                    {c.notes && <p style={{ margin: 0, fontSize: 12, color: theme.textMid }}>{c.notes}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TASKS */}
        {tab === 'tasks' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ border: `1px solid ${theme.amberBg}`, borderRadius: 14, padding: 12, background: theme.warningBg }}>
              <p style={{ margin: 0, fontSize: 12.5, color: theme.amberText, lineHeight: 1.5 }}>
                <Briefcase size={14} aria-hidden="true" style={{ verticalAlign: '-2px', marginRight: 6 }} /><strong>Sponsored Tasks</strong> are paid assignments from companies and health brands. Complete a task to earn the listed compensation directly to your wallet.
              </p>
            </div>

            {tasks.length === 0 && (
              <div style={{ textAlign: 'center', padding: '30px 10px' }}>
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}><ClipboardList size={36} color={theme.gray300} strokeWidth={1.5} aria-hidden="true" /></div>
                <p style={{ color: theme.textLight, fontSize: 13 }}>No open tasks right now. Check back soon.</p>
              </div>
            )}

            {tasks.map((task) => {
              const submitted = submittedTaskIds.includes(task.id)
              return (
                <div key={task.id} style={{ border: `1px solid ${theme.border}`, borderRadius: 16, padding: 14, background: theme.cardBg, boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                    <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800, color: theme.navy, flex: 1 }}>{task.title}</h3>
                    <span style={{ fontSize: 14, fontWeight: 900, color: theme.success, marginLeft: 10 }}>₦{task.compensation?.toLocaleString()}</span>
                  </div>
                  <p style={{ margin: '0 0 8px 0', fontSize: 13, color: theme.textMid, lineHeight: 1.5 }}>{task.description}</p>
                  {task.specialty && <p style={{ margin: '0 0 10px 0', display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: theme.tealDeep, fontWeight: 700 }}><Stethoscope size={12} aria-hidden="true" /> For: {task.specialty}</p>}
                  {task.deadline && <p style={{ margin: '0 0 10px 0', fontSize: 11.5, color: theme.textLight }}>⏰ Deadline: {new Date(task.deadline).toLocaleDateString()}</p>}
                  <button
                    onClick={() => !submitted && acceptTask(task.id)}
                    disabled={submitted}
                    style={{
                      padding: '8px 16px', borderRadius: 12, border: 'none', fontSize: 13, fontWeight: 700,
                      background: submitted ? theme.bg : theme.tealDeep,
                      color: submitted ? theme.textLight : '#fff',
                    }}
                  >
                    {submitted ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Check size={14} strokeWidth={3} aria-hidden="true" /> Accepted</span> : 'Accept Task'}
                  </button>
                </div>
              )
            })}

            {submissions.length > 0 && (
              <>
                <p style={{ fontSize: 11, fontWeight: 800, color: theme.tealDeep, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '8px 0 4px 0' }}>My Submissions</p>
                {submissions.map((s) => (
                  <div key={s.id} style={{ border: `1px solid ${theme.border}`, borderRadius: 14, padding: 12, background: theme.cardBg }}>
                    <p style={{ margin: '0 0 2px 0', fontWeight: 700, fontSize: 13, color: theme.navy }}>{s.tasks?.title}</p>
                    <p style={{ margin: 0, fontSize: 12, color: theme.textLight }}>
                      ₦{s.tasks?.compensation?.toLocaleString()} · Status: <span style={{ textTransform: 'capitalize', color: s.status === 'approved' ? theme.success : theme.warning }}>{s.status}</span>
                    </p>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>

      <Toast msg={toastMsg} type={toastType} actionLabel={toastActionLabel} onAction={toastOnAction} />

      {isMobile && <BottomNav />}
    </div>
  )

  if (isMobile) return bodyContent

  return (
    <AppShell user={user} myUsername={myUsername} myAvatar={myAvatar} unreadNotifs={unreadNotifs} onCompose={() => navigate('/feed')}>
      {bodyContent}
    </AppShell>
  )
}

export default ProfessionalMonetization
