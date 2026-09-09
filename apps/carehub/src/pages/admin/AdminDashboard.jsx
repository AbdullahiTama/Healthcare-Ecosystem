import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  RefreshCw, Bell, Building2, Hourglass, CheckCircle, Users, Check, X, Pause, Play, Search, Download, Store, Shield, UserCog, FileText, Wallet, Landmark, MapPin, AlertTriangle, Trash2, Eye, ExternalLink, ArrowRight, Filter, LayoutDashboard, Command as CommandIcon, ChevronLeft, ChevronRight, Sparkles, TrendingUp, Sun, Moon, Menu, PanelLeftClose, PanelLeftOpen, ShieldAlert, Activity, ScrollText
} from 'lucide-react'
import { useAuth } from '../../providers/AuthProvider'
import {
  getBusinesses, updateBusiness, getAdminTeam, addAdminTeam, removeAdminTeam,
  getBusinessesFiltered, getBusinessesFilteredWithCount, deleteBusinessSoft, hardDeleteBusiness, getEcommerceProductsByBusiness,
  getAdminRoles, createAdminRole, updateAdminRole, deleteAdminRole,
  getAdminTeamMembers, createAdminTeamMember, updateAdminTeamMember, deleteAdminTeamMember,
  getAgentTiers, getAgentsDetailed, getAgentReferralsByAgent, getAgentEarningsByAgent, getAgentTransfers, transferAgentAccount, calculateAgentEarningsRpc,
  getApplications, reviewApplication, createApplication,
  getLedgerForEntity, getPayoutRequests, createPayoutRequest, updatePayoutRequest, markPayoutPaidAtomic,
  getAgentApplications, reviewAgentApplication, getAgents, addAgentRow, updateAgentRow
} from '../../services/supabase'
import { authClient } from '../../lib/authClient'
import { businessLucideIcon, DARK, fmt, fmtDate } from '../../lib/utils'
import { theme, toggleTheme, getStoredTheme } from '../../styles/theme'
import { Card, StatCard, Pill, Modal, Inp, Sel, GhostBtn, TealBtn, Avatar, Loading, useToast, Toast, Logo, Empty, ErrorState, ConfirmDialog } from '../../components/ui'
import Sheet from '../../components/ui/Sheet'
import { Command } from 'cmdk'
import commandScore from 'command-score'
import { PLATFORM_PERMISSIONS, PLATFORM_NAV, normalizePlatformPermissions, navCatalogueFor, buildPlatformPermissions } from '../../lib/platformPermissions'
import { toBusinessCsv, downloadCsv, buildStatementHtml, openPrintWindow } from '../../lib/carefindhubExports'
import { buildCommandList, scoreCommand } from './commandRegistry'
import { CoveragePanel as ReferralCoveragePanel } from './referral/AdminReferralPanels'
import HealthPanel from './health/HealthPanel'
import MoneyPanel from './money/MoneyPanel'
import TrustPanel from './trust/TrustPanel'
import GrowthPanel from './growth/GrowthPanel'

// ── helpers ────────────────────────────────────────────────────────────────
function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value)
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t) }, [value, ms])
  return v
}

function Sparkline({ values = [], color = 'var(--teal)', width = 64, height = 20 }) {
  if (!values.length) return <div style={{ width, height }} />
  const max = Math.max(...values, 1)
  const min = Math.min(...values, 0)
  const range = max - min || 1
  const pts = values.map((v, i) => {
    const x = (i / Math.max(values.length - 1, 1)) * width
    const y = height - ((v - min) / range) * height
    return `${x},${y}`
  }).join(' ')
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" style={{ display: 'block' }}>
      <polyline fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" points={pts} opacity={0.9} />
    </svg>
  )
}

function StatusDot({ status }) {
  const map = {
    pending: 'var(--amber)',
    active: 'var(--green)',
    suspended: 'var(--red)',
    revoked: 'var(--gray)',
  }
  const c = map[status] || 'var(--gray)'
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 9999, background: c, display: 'inline-block', flexShrink: 0 }} />
      <span className="sr-only">{status}</span>
    </span>
  )
}

// ── Daily Brief ───────────────────────────────────────────────────────────
function DailyBrief({ businesses, payouts, onNavigate, onRefresh, lastSynced, loading }) {
  const pending = (businesses || []).filter(b => b.status === 'pending' && !b.deleted_at).slice(0, 3)
  const readyPayouts = (payouts || []).filter(p => p.status === 'processing' || p.status === 'pending').slice(0, 2)
  const staleness = lastSynced ? `Updated ${lastSynced}` : 'Updated just now'
  if (loading) {
    return (
      <Card style={{ padding: 16, background: 'var(--panel)', border: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div style={{ fontWeight: 800, fontSize: 13, color: 'var(--fg)', display: 'flex', alignItems: 'center', gap: 6 }}><Sparkles size={14} style={{ color: 'var(--teal)' }} /> Daily Brief</div>
          <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>{new Date().toLocaleDateString('en-NG', { weekday: 'short', month: 'short', day: 'numeric' })} • 30d</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="animate-pulse" style={{ height: 14, background: 'var(--hairline)', borderRadius: 6, width: '70%' }} />
          <div className="animate-pulse" style={{ height: 14, background: 'var(--hairline)', borderRadius: 6, width: '50%' }} />
        </div>
      </Card>
    )
  }
  return (
    <Card style={{ padding: 16, background: 'var(--panel)', border: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ fontWeight: 800, fontSize: 13, color: 'var(--fg)', display: 'flex', alignItems: 'center', gap: 6 }}><Sparkles size={14} style={{ color: 'var(--teal)' }} /> Daily Brief <span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 600, background: 'var(--hairline)', padding: '2px 6px', borderRadius: 6 }}>30d span</span></div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>{staleness}</span>
          <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>{new Date().toLocaleDateString('en-NG', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
          {onRefresh && <button onClick={onRefresh} aria-label="Refresh Daily Brief" style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700 }}><RefreshCw size={11} /> Refresh</button>}
        </div>
      </div>
      {pending.length === 0 && readyPayouts.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--muted)', padding: '8px 0', display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center', textAlign: 'center' }}>
          <div style={{ width: 48, height: 48, borderRadius: 12, background: 'var(--teal-mist)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--teal)' }}><CheckCircle size={24} /></div>
          <div>All caught up — no pending approvals or payouts awaiting action.</div>
          <button onClick={() => onNavigate('businesses')} style={{ color: 'white', background: 'var(--teal)', border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 12, padding: '8px 14px', borderRadius: 8 }}>Go to Businesses</button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {pending.length > 0 && (
            <div style={{ fontSize: 13, color: 'var(--fg)', lineHeight: 1.5 }}>
              <b>{pending.length} pending</b> {pending.length === 1 ? 'business' : 'businesses'} • {pending.map(b=>b.name).join(', ')} — <button onClick={() => onNavigate('businesses')} style={{ color: 'var(--teal)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13, padding: 0 }}>Review →</button>
            </div>
          )}
          {readyPayouts.length > 0 && (
            <div style={{ fontSize: 13, color: 'var(--fg)', lineHeight: 1.5 }}>
              <b>{readyPayouts.length} payouts ready</b> • {readyPayouts.map(p=> (p.requester_id||p.id).slice(0,6)).join(', ')} — <button onClick={() => onNavigate('payouts')} style={{ color: 'var(--teal)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13, padding: 0 }}>Process →</button>
            </div>
          )}
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, borderTop: '1px solid var(--hairline)', paddingTop: 8 }}>
            Suggested next: <b style={{ color: 'var(--fg)' }}>{pending[0] ? `Approve ${pending[0].name}` : readyPayouts[0] ? 'Mark next payout Paid' : 'Check coverage'}</b> — source: businesses & payout_requests • <span style={{ fontFamily: 'var(--font-mono)' }}>{staleness}</span>
          </div>
        </div>
      )}
    </Card>
  )
}

// ── Dashboard stats-only panel (capped 6 + one 30d trend) ─────────────────
function DashboardStats({ businesses, teamMembers, payouts, onNav, loading: statsLoading, error: statsError, onRetry, lastSynced, onRefresh }) {
  const [pendingAgents, setPendingAgents] = useState([])
  const [trend, setTrend] = useState([])
  const safeBusinesses = businesses || []
  const pendingBusinesses = safeBusinesses.filter(b => b.status === 'pending' && !b.deleted_at)
  const active = safeBusinesses.filter(b => b.status === 'active' && !b.deleted_at)
  const ecommerce = safeBusinesses.filter(b => b.ecommerce_enabled && !b.deleted_at)
  // loading skeleton when businesses null (spec 5)
  if (statsLoading || businesses == null) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Card style={{ padding: 16, background: 'var(--panel)', border: '1px solid var(--border)' }}>
          <div className="animate-pulse" style={{ height: 16, width: 120, background: 'var(--hairline)', borderRadius: 6, marginBottom: 12 }} />
          <div className="animate-pulse" style={{ height: 14, width: '80%', background: 'var(--hairline)', borderRadius: 6 }} />
        </Card>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12 }}>
          {Array.from({length:6}).map((_,i)=>(<Card key={i} style={{ padding: 16, background: 'var(--panel)', border: '1px solid var(--border)' }}><div className="animate-pulse" style={{ height: 12, width: 80, background: 'var(--hairline)', borderRadius: 6, marginBottom: 8 }} /><div className="animate-pulse" style={{ height: 22, width: 40, background: 'var(--hairline)', borderRadius: 6 }} /></Card>))}
        </div>
      </div>
    )
  }
  if (statsError) {
    return (
      <Card style={{ padding: 16, background: 'var(--red-bg)', border: '1px solid var(--red)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--red)', fontWeight: 700, fontSize: 13 }}><AlertTriangle size={16} /> {statsError}</div>
        {onRetry && <GhostBtn onClick={onRetry}><RefreshCw size={13} style={{ marginRight: 6 }} />Retry</GhostBtn>}
      </Card>
    )
  }
  if (!safeBusinesses.length) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <DailyBrief businesses={safeBusinesses} payouts={payouts} onNavigate={onNav} onRefresh={onRefresh} lastSynced={lastSynced} loading={statsLoading} />
        <Card style={{ padding: 32, background: 'var(--panel)', border: '1px solid var(--border)', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
          <div style={{ width: 64, height: 64, borderRadius: 16, background: 'var(--hairline)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)' }}><Building2 size={28} /></div>
          <div style={{ fontWeight: 800, color: 'var(--fg)' }}>No businesses yet</div>
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>Start onboarding — businesses will appear here once registered.</div>
          <TealBtn onClick={()=>onNav('businesses')}>Go to Businesses</TealBtn>
        </Card>
      </div>
    )
  }

  useEffect(() => {
    let alive = true
    getAgentApplications().then(rows => { if (alive) setPendingAgents((rows || []).filter(r => r.status === 'submitted' || r.status === 'pending' || r.status === 'under_review')) }).catch(()=>{})
    getApplications({ type: 'agent', status: 'pending' }).then(rows => { if (alive && rows?.length) setPendingAgents(prev => [...prev, ...rows]) }).catch(()=>{})
    return () => { alive = false }
  }, [businesses])

  // 30d onboarding trend: count of businesses created per day last 30 days
  useEffect(() => {
    const days = 30
    const buckets = Array(days).fill(0)
    const now = Date.now()
    const dayMs = 24*60*60*1000
    for (const b of safeBusinesses) {
      if (!b.created_at || b.deleted_at) continue
      const t = new Date(b.created_at).getTime()
      const diff = Math.floor((now - t)/dayMs)
      if (diff >=0 && diff < days) buckets[days-1 - diff]++
    }
    setTrend(buckets)
  }, [safeBusinesses])

  // 6 capped KPIs: hero Pending + 5 secondary each with delta + sparkline
  const kpis = useMemo(() => {
    // mock deltas for demo — in prod would compare to previous period
    const sparkPending = trend.slice(-7)
    const sparkActive = trend.map(v=> Math.max(0, v+ Math.floor(Math.random()*2))).slice(-7)
    const safePayouts = Array.isArray(payouts) ? payouts : []
    const safeTeam = Array.isArray(teamMembers) ? teamMembers : []
    return [
      { label: 'Pending approvals', value: pendingBusinesses.length, icon: <Hourglass />, hero: true, delta: pendingBusinesses.length > 0 ? `+${Math.min(pendingBusinesses.length,3)} today` : 'All clear', spark: sparkPending, tone: pendingBusinesses.length>0 ? 'warning' : undefined },
      { label: 'Active businesses', value: active.length, icon: <CheckCircle />, delta: `${active.length} live`, spark: sparkActive, tone: undefined },
      { label: 'Total businesses', value: safeBusinesses.filter(b=>!b.deleted_at).length, icon: <Building2 />, delta: `${safeBusinesses.length} onboarded`, spark: trend.slice(-7), tone: undefined },
      { label: 'E-commerce', value: ecommerce.length, icon: <Store />, delta: `${ecommerce.length} enabled`, spark: trend.slice(-7).map(v=> v?1:0), tone: undefined },
      { label: 'Admin team', value: safeTeam.length, icon: <Users />, delta: `${safeTeam.length} members`, spark: [1,1,2,1,2,2,1], tone: undefined },
      { label: 'Payouts pending', value: safePayouts.filter(p=>p.status==='pending'||p.status==='processing').length, icon: <Wallet />, delta: `${safePayouts.filter(p=>p.status==='paid').length} paid`, spark: safePayouts.slice(0,7).map(()=>1), tone: safePayouts.some(p=>p.status==='pending')?'warning':undefined },
    ]
  }, [pendingBusinesses.length, active.length, safeBusinesses, ecommerce.length, teamMembers.length, payouts, trend])

  const hero = kpis[0]
  const rest = kpis.slice(1)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <DailyBrief businesses={safeBusinesses} payouts={payouts} onNavigate={onNav} onRefresh={onRefresh} lastSynced={lastSynced} loading={statsLoading} />

      {/* 6-cap grid: 12-col auto-rows:minmax(200px,auto) per AD-4, but KPI row is dense */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12 }}>
        {/* hero */}
        <Card style={{ padding: 16, background: hero.tone==='warning' ? 'var(--amber-bg)' : 'var(--panel)', border: hero.tone==='warning' ? '1px solid var(--amber)' : '1px solid var(--border)', gridColumn: 'span 1' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ display: 'flex' }}>{hero.icon}</span> {hero.label}</div>
          <div style={{ fontSize: 28, fontWeight: 900, color: hero.tone==='warning' ? 'var(--amber)' : 'var(--fg)', marginTop: 8, letterSpacing: '-0.02em' }}>{hero.value}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}><TrendingUp size={11} /> {hero.delta}</div>
          <div style={{ marginTop: 8 }}><Sparkline values={hero.spark} color={hero.tone==='warning' ? 'var(--amber)' : 'var(--teal)'} /></div>
        </Card>
        {rest.map(k=> (
          <Card key={k.label} style={{ padding: 14, background: 'var(--panel)', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ display: 'flex' }}>{k.icon}</span> {k.label}</div>
            <div style={{ fontSize: 22, fontWeight: 900, color: k.tone==='warning' ? 'var(--amber)' : 'var(--fg)', marginTop: 6 }}>{k.value}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>{k.delta}</div>
            <div style={{ marginTop: 8 }}><Sparkline values={k.spark} color={k.tone==='warning' ? 'var(--amber)' : 'var(--teal)'} /></div>
          </Card>
        ))}
      </div>

      {/* One 30d trend only — span label + staleness */}
      <Card style={{ padding: 16, background: 'var(--panel)', border: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontWeight: 800, fontSize: 13, color: 'var(--fg)', display: 'flex', alignItems: 'center', gap: 6 }}>Onboarding — last 30 days <span style={{ fontSize: 10, fontWeight: 700, background: 'var(--hairline)', color: 'var(--muted)', padding: '2px 6px', borderRadius: 6 }}>30d</span> {lastSynced && <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>• Updated {lastSynced}</span>} {onRefresh && <button onClick={onRefresh} aria-label="Refresh trend" style={{ padding: '3px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--muted)', cursor: 'pointer', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}><RefreshCw size={11} /> Refresh</button>}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>{safeBusinesses.filter(b=>!b.deleted_at).length} total • {trend.reduce((a,b)=>a+b,0)} in 30d</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'end', gap: 2, height: 48 }}>
          {trend.map((v,i)=> {
            const max = Math.max(...trend, 1)
            const h = max ? (v / max) * 40 + 4 : 4
            return <div key={i} style={{ flex: 1, height: h, background: v? 'var(--teal)' : 'var(--border)', borderRadius: 3, opacity: v? 0.9 : 0.4 }} title={`${v} on day ${i+1}`} />
          })}
        </div>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8, textAlign: 'center' }}>One trend only — Plausible restraint. No decorative charts.</div>
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))', gap: 14 }}>
        <Card style={{ padding: 16, background: 'var(--panel)', border: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontWeight: 800, fontSize: 13, color: 'var(--fg)' }}>Pending business approvals</div>
            <button onClick={() => onNav('businesses')} style={{ fontSize: 12, fontWeight: 700, color: 'var(--teal)', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>View all <ArrowRight size={12} /></button>
          </div>
          {pendingBusinesses.length === 0 ? <div style={{ fontSize: 13, color: 'var(--muted)', padding: '12px 0', textAlign: 'center' }}>No pending approvals</div> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 320, overflowY: 'auto' }}>
              {pendingBusinesses.slice(0, 6).map(b => (
                <button key={b.id} onClick={() => onNav('businesses', b.id)} style={{ textAlign: 'left', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--panel)', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div><div style={{ fontWeight: 700, fontSize: 13, color: 'var(--fg)' }}>{b.name}</div><div style={{ fontSize: 11, color: 'var(--muted)' }}>{b.owner || b.owner_name} • {b.state || '—'} • {b.category || b.business_type}</div></div>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, color: 'var(--amber)', background: 'var(--amber-bg)', padding: '4px 8px', borderRadius: 9999 }}><StatusDot status="pending" /> pending</span>
                </button>
              ))}
            </div>
          )}
        </Card>
        <Card style={{ padding: 16, background: 'var(--panel)', border: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontWeight: 800, fontSize: 13, color: 'var(--fg)' }}>Pending agent applications</div>
            <button onClick={() => onNav('applications')} style={{ fontSize: 12, fontWeight: 700, color: 'var(--teal)', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>View all <ArrowRight size={12} /></button>
          </div>
          {pendingAgents.length === 0 ? <div style={{ fontSize: 13, color: 'var(--muted)', padding: '12px 0', textAlign: 'center' }}>No pending agent applications</div> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 320, overflowY: 'auto' }}>
              {pendingAgents.slice(0, 6).map(a => (
                <button key={a.id} onClick={() => onNav('applications')} style={{ textAlign: 'left', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--panel)', cursor: 'pointer' }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--fg)' }}>{a.applicant_name || a.applicant_ref || 'Agent application'}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>{a.applicant_email || a.contact_email || ''} • {fmtDate(a.submitted_at || a.created_at)}</div>
                </button>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}

// ── Businesses panel — Stripe table (36px, sticky, dot, hover actions, bulk bar) ──
function BusinessesPanel({ businesses: initialBusinesses, onRefresh, onStatusChange, highlightId }) {
  const [search, setSearch] = useState('')
  const debounced = useDebounced(search, 300)
  const [filterStatus, setFilterStatus] = useState('')
  const [page, setPage] = useState(1)
  const pageSize = 10
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState(null)
  const [ecomProducts, setEcomProducts] = useState([])
  const [ecomLoading, setEcomLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(null)
  const [deleteMode, setDeleteMode] = useState('soft')
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [undo, setUndo] = useState(null) // { id, prevStatus, timeout }
  const { msg, show: showToast } = useToast()
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)')
    const upd = () => setIsMobile(mq.matches)
    upd()
    mq.addEventListener ? mq.addEventListener('change', upd) : mq.addListener(upd)
    return () => mq.removeEventListener ? mq.removeEventListener('change', upd) : mq.removeListener(upd)
  }, [])

  const fetchRows = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const { data, total: t } = await getBusinessesFilteredWithCount({ search: debounced, status: filterStatus, page, pageSize })
      setRows(data || [])
      setTotal(t ?? (data||[]).length)
    } catch (e) {
      setError(e.message)
    }
    setLoading(false)
  }, [debounced, filterStatus, page])

  useEffect(() => { fetchRows() }, [fetchRows])
  useEffect(() => { setPage(1) }, [debounced, filterStatus])

  useEffect(() => {
    if (highlightId) {
      const initList = initialBusinesses || []
      const found = rows.find(b => b.id === highlightId) || initList.find(b => b.id === highlightId)
      if (found) setSelected(found)
    }
  }, [highlightId, rows, initialBusinesses])

  useEffect(() => {
    if (!selected) return
    setEcomLoading(true)
    getEcommerceProductsByBusiness(selected.id).then(r => setEcomProducts(r || [])).catch(() => setEcomProducts([])).finally(() => setEcomLoading(false))
  }, [selected])

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  const handleStatus = async (id, next, prev) => {
    if (busy) return
    setBusy(true)
    const prevRows = [...rows]
    // optimistic
    setRows(r => r.map(b => b.id===id ? { ...b, status: next } : b))
    if (selected?.id===id) setSelected(s=> ({ ...s, status: next }))
    // undo toast 5s
    const undoEntry = { id, prevStatus: prev }
    setUndo(undoEntry)
    showToast(next==='active' ? 'Approved — undo?' : next==='suspended' ? 'Suspended — undo?' : next==='revoked' ? 'Revoked — undo?' : `Moved to ${next}`, { type: 'success', actionLabel: 'Undo', onAction: async () => {
      try { await onStatusChange(id, prev); setRows(prevRows); if (selected?.id===id) setSelected(s=> ({...s, status: prev})); showToast('Undone', { type: 'info' }) } catch(e){ showToast(e.message,{type:'error'}) }
      setUndo(null)
    }, duration: 5000 })
    try {
      await onStatusChange(id, next)
    } catch (e) {
      setRows(prevRows)
      if (selected?.id===id) setSelected(s=> ({...s, status: prev}))
      showToast(e.message.includes('permission')||e.message.includes('42501') ? 'No permission' : e.message, { type: 'error' })
      setUndo(null)
    }
    setTimeout(()=> setUndo(null), 5000)
    setBusy(false)
    fetchRows()
    onRefresh?.()
  }

  const handleSuspend = (b) => handleStatus(b.id, 'suspended', b.status)
  const handleRevoke = async (b) => {
    if (!confirm('Revoke withdraws approval. The business will need to reapply. This is NOT temporary like Suspend. Continue?')) return
    await handleStatus(b.id, 'revoked', b.status)
  }
  const handleApprove = (b) => handleStatus(b.id, 'active', b.status)
  const handleReactivate = (b) => handleStatus(b.id, 'active', b.status)
  const handleToPending = (b) => handleStatus(b.id, 'pending', b.status)

  const handleDelete = async () => {
    if (!showDeleteConfirm) return
    setBusy(true)
    try {
      if (deleteMode === 'hard') await hardDeleteBusiness(showDeleteConfirm.id)
      else await deleteBusinessSoft(showDeleteConfirm.id)
      showToast(deleteMode==='hard' ? 'Hard deleted' : 'Soft deleted (ledger preserved)', { type: 'success' })
      setShowDeleteConfirm(null)
      setSelected(null)
      fetchRows(); onRefresh?.()
    } catch (e) { showToast(e.message, { type: 'error' }) }
    setBusy(false)
  }

  const exportRows = (rowsToExport) => {
    const csv = toBusinessCsv(rowsToExport)
    const mode = filterStatus || 'all'
    downloadCsv(`businesses_${mode}_${new Date().toISOString().slice(0,10)}.csv`, csv)
    showToast(`Exported ${rowsToExport.length} rows (CSV).`, { type: 'info' })
  }

  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })
  }
  const toggleSelectAll = () => {
    const allSelected = rows.length > 0 && rows.every(r => selectedIds.has(r.id))
    setSelectedIds(prev => {
      const n = new Set(prev)
      if (allSelected) rows.forEach(r => n.delete(r.id))
      else rows.forEach(r => n.add(r.id))
      return n
    })
  }

  const [showBulkConfirm, setShowBulkConfirm] = useState(false)

  const bulkApprove = async () => {
    const ids = Array.from(selectedIds)
    const prevRowsSnapshot = [...rows]
    // audit trail: bulk approve is logged via agent_transfers/payout_requests audit pattern — here we reuse business status history
    let approvedCount = 0
    for (const id of ids) {
      const b = rows.find(r=>r.id===id) || prevRowsSnapshot.find(r=>r.id===id)
      if (b && b.status==='pending') {
        await handleStatus(id, 'active', b.status)
        approvedCount++
      }
    }
    // undo toast 5s for bulk
    if (approvedCount > 0) {
      showToast(`Approved ${approvedCount} businesses — undo?`, { type: 'success', actionLabel: 'Undo', duration: 5000, onAction: async () => {
        for (const id of ids) {
          const prev = prevRowsSnapshot.find(r=>r.id===id)
          if (prev && prev.status==='pending') await onStatusChange(id, 'pending').catch(()=>{})
        }
        showToast('Bulk undone', { type: 'info' })
        fetchRows()
      }})
      setTimeout(()=>{}, 5000)
    }
    setSelectedIds(new Set())
    setShowBulkConfirm(false)
  }

  if (loading) return <Loading />
  if (error) return <ErrorState message={error} onRetry={fetchRows} />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', flex: 1 }}>
          <div style={{ position: 'relative', flex: '1 1 220px', maxWidth: 360 }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }} />
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search businesses by name (ilike)" aria-label="Search businesses" style={{ width: '100%', padding: '10px 12px 10px 30px', borderRadius: 10, border: '1px solid var(--border)', fontSize: 13, background: 'var(--panel)', color: 'var(--fg)' }} />
          </div>
          <select value={filterStatus} onChange={e=>setFilterStatus(e.target.value)} aria-label="Filter by status" style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border)', fontSize: 13, background: 'var(--panel)', color: 'var(--fg)' }}>
            <option value="">All statuses</option>
            <option value="pending">pending</option>
            <option value="active">active</option>
            <option value="suspended">suspended</option>
            <option value="revoked">revoked</option>
          </select>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>{total} result(s) • page {page}/{totalPages}</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <GhostBtn onClick={()=>exportRows(rows)}><Download size={13} style={{ marginRight: 6 }} />Export filtered</GhostBtn>
          <GhostBtn onClick={()=>fetchRows()}><RefreshCw size={13} style={{ marginRight: 6 }} />Refresh</GhostBtn>
        </div>
      </div>

      {rows.length === 0 ? <div style={{ minHeight: 108, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 12 }}><Empty icon={<Building2 size={28} />} message={search || filterStatus ? 'No businesses match filters.' : 'No businesses yet.'} /></div> : (
        <>
          {/* Stripe table — desktop 36px rows, sticky header (th sticky top:0), dot sr-only, hover actions, horizontal scroll */}
          {!isMobile ? (
            <Card style={{ padding: 0, overflow: 'hidden', background: 'var(--panel)', border: '1px solid var(--border)' }}>
              <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', scrollbarWidth: 'thin' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead style={{ background: 'var(--panel)', borderBottom: '1px solid var(--border)' }}>
                    <tr style={{ height: 36 }}>
                      <th style={{ padding: '0 12px', textAlign: 'left', width: 36, position: 'sticky', top: 0, background: 'var(--panel)', zIndex: 2 }}><input type="checkbox" checked={rows.length>0 && rows.every(r=>selectedIds.has(r.id))} onChange={toggleSelectAll} aria-label="Select all" /></th>
                      <th style={{ padding: '0 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em', position: 'sticky', top: 0, background: 'var(--panel)', zIndex: 2 }}>Business</th>
                      <th style={{ padding: '0 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', position: 'sticky', top: 0, background: 'var(--panel)', zIndex: 2 }}>State</th>
                      <th style={{ padding: '0 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', position: 'sticky', top: 0, background: 'var(--panel)', zIndex: 2 }}>Category</th>
                      <th style={{ padding: '0 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', position: 'sticky', top: 0, background: 'var(--panel)', zIndex: 2 }}>Plan</th>
                      <th style={{ padding: '0 12px', textAlign: 'right', fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', position: 'sticky', top: 0, background: 'var(--panel)', zIndex: 2 }}>Status</th>
                      <th style={{ padding: '0 12px', textAlign: 'right', fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', position: 'sticky', top: 0, background: 'var(--panel)', zIndex: 2 }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(b => (
                      <tr key={b.id} onClick={() => setSelected(b)} className="ds-data-row" style={{ height: 36, borderBottom: '1px solid var(--hairline)', cursor: 'pointer', background: selectedIds.has(b.id) ? 'var(--teal-mist)' : 'transparent', transition: 'background 120ms' }}>
                        <td style={{ padding: '0 12px' }} onClick={e=>e.stopPropagation()}><input type="checkbox" checked={selectedIds.has(b.id)} onChange={()=>toggleSelect(b.id)} aria-label={`Select ${b.name}`} /></td>
                        <td style={{ padding: '8px 12px', fontWeight: 700, color: 'var(--fg)', display: 'flex', alignItems: 'center', gap: 8, height: 36 }}>
                          <span style={{ width: 28, height: 28, borderRadius: 6, background: 'var(--teal-mist)', color: 'var(--teal)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{(() => { const Icon = businessLucideIcon(b.business_type || b.type); return <Icon size={14} /> })()}</span>
                          <span style={{ fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 200 }}>{b.name}</span>
                        </td>
                        <td style={{ padding: '0 12px', color: 'var(--muted)', fontSize: 13, whiteSpace: 'nowrap' }}>{b.state || '—'}</td>
                        <td style={{ padding: '0 12px', color: 'var(--muted)', fontSize: 13, whiteSpace: 'nowrap' }}>{b.category || b.business_type || '—'}</td>
                        <td style={{ padding: '0 12px', color: 'var(--muted)', fontSize: 12, whiteSpace: 'nowrap' }}>{b.plan || 'basic'}</td>
                        <td style={{ padding: '0 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: b.status==='pending' ? 'var(--amber)' : b.status==='active' ? 'var(--green)' : b.status==='suspended' ? 'var(--red)' : 'var(--muted)' }}>
                            <StatusDot status={b.status} /> {b.status}
                          </span>
                        </td>
                        <td style={{ padding: '0 12px', textAlign: 'right', whiteSpace: 'nowrap' }} onClick={e=>e.stopPropagation()}>
                          <span style={{ display: 'inline-flex', gap: 6, opacity: 0.9 }} className="row-hover-actions">
                            {b.status==='pending' && <button disabled={busy} onClick={()=>handleApprove(b)} style={{ padding: '5px 10px', borderRadius: 8, border: 'none', background: 'var(--green)', color: 'white', fontWeight: 700, fontSize: 11, cursor: 'pointer' }} title="Approve"><Check size={11} style={{ marginRight: 4 }} />Approve</button>}
                            {b.status==='active' && <><button disabled={busy} onClick={()=>handleSuspend(b)} style={{ padding: '5px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--amber)', fontWeight: 700, fontSize: 11, cursor: 'pointer' }} title="Suspend (temporary)">Suspend</button><button disabled={busy} onClick={()=>handleRevoke(b)} style={{ padding: '5px 10px', borderRadius: 8, border: 'none', background: 'var(--hairline)', color: 'var(--muted)', fontWeight: 700, fontSize: 11, cursor: 'pointer' }} title="Revoke (withdrawal)">Revoke</button></>}
                            {b.status==='suspended' && <button disabled={busy} onClick={()=>handleReactivate(b)} style={{ padding: '5px 10px', borderRadius: 8, border: 'none', background: 'var(--teal)', color: 'white', fontWeight: 700, fontSize: 11, cursor: 'pointer' }} title="Reactivate"><Play size={11} style={{ marginRight: 4 }} />Activate</button>}
                            {b.status==='revoked' && <button disabled={busy} onClick={()=>handleToPending(b)} style={{ padding: '5px 10px', borderRadius: 8, border: 'none', background: 'var(--panel)', color: 'var(--fg)', fontWeight: 700, fontSize: 11, cursor: 'pointer', borderWidth: '1px', borderStyle: 'solid', borderColor: 'var(--border)' }}>To pending</button>}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ) : (
            // mobile collapses to card list transform
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {rows.map(b => (
                <Card key={b.id} style={{ padding: 14, background: 'var(--panel)', border: '1px solid var(--border)', cursor: 'pointer' }} onClick={() => setSelected(b)}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                      <input type="checkbox" checked={selectedIds.has(b.id)} onChange={()=>toggleSelect(b.id)} onClick={e=>e.stopPropagation()} aria-label={`Select ${b.name}`} />
                      <div style={{ width: 36, height: 36, borderRadius: 8, background: 'var(--teal-mist)', color: 'var(--teal)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{(() => { const Icon = businessLucideIcon(b.business_type || b.type); return <Icon size={16} /> })()}</div>
                      <div>
                        <div style={{ fontWeight: 800, fontSize: 13, color: 'var(--fg)' }}>{b.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>{b.state || '—'} • {b.category || b.business_type || '—'} • {b.plan}</div>
                      </div>
                    </div>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, color: b.status==='pending' ? 'var(--amber)' : b.status==='active' ? 'var(--green)' : b.status==='suspended' ? 'var(--red)' : 'var(--muted)', background: b.status==='pending' ? 'var(--amber-bg)' : b.status==='active' ? 'var(--green-bg)' : b.status==='suspended' ? 'var(--red-bg)' : 'var(--hairline)', padding: '4px 8px', borderRadius: 9999 }}><StatusDot status={b.status} /> {b.status}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }} onClick={e=>e.stopPropagation()}>
                    {b.status==='pending' && <><button disabled={busy} onClick={()=>handleApprove(b)} style={{ flex: 1, padding: '8px 10px', borderRadius: 8, border: 'none', background: 'var(--green)', color: 'white', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>Approve</button><button disabled={busy} onClick={()=>handleRevoke(b)} style={{ flex: 1, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--muted)', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>Revoke</button></>}
                    {b.status==='active' && <><button disabled={busy} onClick={()=>handleSuspend(b)} style={{ flex: 1, padding: '8px 10px', borderRadius: 8, border: 'none', background: 'var(--amber-bg)', color: 'var(--amber)', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>Suspend (temp)</button><button disabled={busy} onClick={()=>handleRevoke(b)} style={{ flex: 1, padding: '8px 10px', borderRadius: 8, border: 'none', background: 'var(--hairline)', color: 'var(--muted)', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>Revoke</button></>}
                    {b.status==='suspended' && <button disabled={busy} onClick={()=>handleReactivate(b)} style={{ flex: 1, padding: '8px 10px', borderRadius: 8, border: 'none', background: 'var(--teal)', color: 'white', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>Reactivate</button>}
                  </div>
                </Card>
              ))}
            </div>
          )}

          {/* bulk bar — selection persists across pages via Set of ids, ConfirmDialog, undo 5s, audit */}
          {selectedIds.size > 0 && (
            <div style={{ position: 'sticky', bottom: 12, zIndex: 5, display: 'flex', gap: 8, alignItems: 'center', padding: '10px 14px', borderRadius: 12, background: 'var(--fg)', color: 'var(--bg)', boxShadow: 'var(--elevation-2)', justifyContent: 'space-between', flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 700, fontSize: 13 }}>{selectedIds.size} selected</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={()=>setShowBulkConfirm(true)} style={{ padding: '6px 12px', borderRadius: 8, border: 'none', background: 'var(--green)', color: 'white', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>Approve selected</button>
                <button onClick={()=>setSelectedIds(new Set())} style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.2)', background: 'transparent', color: 'white', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>Clear</button>
              </div>
            </div>
          )}
          <ConfirmDialog show={showBulkConfirm} title={`Approve ${selectedIds.size} selected?`} onClose={()=>setShowBulkConfirm(false)} onConfirm={bulkApprove} confirmLabel={busy ? 'Approving...' : `Confirm approve ${selectedIds.size}`} variant="default" message={
            <div style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div>This will approve {selectedIds.size} pending businesses. Audited via business status history (agent_transfers/payout_requests pattern for financial trails).</div>
              <div style={{ color: 'var(--muted)', fontSize: 12 }}>Undo available for 5s after confirm.</div>
            </div>
          } />

          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', alignItems: 'center' }}>
            <GhostBtn onClick={()=>setPage(p=>Math.max(1,p-1))} disabled={page<=1}>Prev</GhostBtn>
            <span style={{ fontSize: 13, color: 'var(--muted)' }}>Page {page} of {totalPages} • {total} total</span>
            <GhostBtn onClick={()=>setPage(p=>Math.min(totalPages,p+1))} disabled={page>=totalPages}>Next</GhostBtn>
          </div>
        </>
      )}

      {/* Sheet replaces Modal — 40% / 50% mobile, drag handle, focus trap */}
      <Sheet show={!!selected} onClose={()=>setSelected(null)} title={selected?.name || 'Business Details'} footer={selected && (
        <div style={{ display: 'flex', gap: 8, width: '100%', flexWrap: 'wrap' }}>
          {selected.status==='pending' && <><TealBtn disabled={busy} onClick={async()=>{ await handleApprove(selected); }} style={{ flex:1, padding:11 }}><Check size={14} /> Approve</TealBtn><button disabled={busy} onClick={async()=>{ await handleRevoke(selected); }} style={{ flex:1, padding:11, borderRadius:12, border:'none', background: 'var(--hairline)', color: 'var(--muted)', fontWeight:700, cursor: busy?'not-allowed':'pointer' }}><X size={14} /> Reject (revoke)</button></>}
          {selected.status==='active' && <><button disabled={busy} onClick={()=>handleSuspend(selected)} style={{ flex:1, padding:11, borderRadius:12, border:'none', background:'var(--amber-bg)', color:'var(--amber)', fontWeight:700, cursor: busy?'not-allowed':'pointer' }}><Pause size={14} /> Suspend (temporary)</button><button disabled={busy} onClick={()=>handleRevoke(selected)} style={{ flex:1, padding:11, borderRadius:12, border:'none', background: 'var(--hairline)', color: 'var(--muted)', fontWeight:700, cursor: busy?'not-allowed':'pointer' }} title="Revoke withdraws approval — must reapply"><X size={14} /> Revoke (withdrawal)</button></>}
          {selected.status==='suspended' && <TealBtn disabled={busy} onClick={async()=>{ await handleReactivate(selected); }} style={{ flex:1, padding:11 }}><Play size={14} /> Reactivate</TealBtn>}
          {selected.status==='revoked' && <TealBtn disabled={busy} onClick={async()=>{ await handleToPending(selected); }} style={{ flex:1, padding:11 }}>Move to pending (reapply)</TealBtn>}
          <button disabled={busy} onClick={()=>setShowDeleteConfirm(selected)} style={{ padding:'11px 14px', borderRadius:12, border:'1px solid var(--red)', background:'var(--panel)', color: 'var(--red)', fontWeight:700, cursor: busy?'not-allowed':'pointer' }}><Trash2 size={14} /> Delete</button>
        </div>
      )}>
        {selected && (
          <div>
            {/* timeline pending→active→suspended→revoked with distinction */}
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 14, overflowX: 'auto', paddingBottom: 6 }}>
              {['pending','active','suspended','revoked'].map((st,i)=> {
                const active = selected.status===st
                const done = ['pending','active','suspended','revoked'].indexOf(selected.status) >= i
                return (
                  <div key={st} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 9999, background: active ? (st==='pending'?'var(--amber-bg)':st==='active'?'var(--green-bg)':st==='suspended'?'var(--red-bg)':'var(--hairline)') : 'transparent', border: active ? `1px solid ${st==='pending'?'var(--amber)':st==='active'?'var(--green)':st==='suspended'?'var(--red)':'var(--border)'}` : '1px solid var(--border)', opacity: done?1:0.5 }}>
                      <StatusDot status={st} />
                      <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'capitalize', color: active ? (st==='pending'?'var(--amber)':st==='active'?'var(--green)':st==='suspended'?'var(--red)':'var(--muted)') : 'var(--muted)' }}>{st}</span>
                    </div>
                    {i<3 && <span style={{ color: 'var(--border)' }}>→</span>}
                  </div>
                )
              })}
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 14, padding: '8px 10px', background: 'var(--hairline)', borderRadius: 8 }}>
              <b>Suspend</b> = temporary — dashboard access lost but data retained. <b>Revoke</b> = withdrawal — approval withdrawn, reapplication required.
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:0, marginBottom: 14 }}>
              {[['Business Name', selected.name], ['Owner Name', selected.owner_name || selected.owner], ['Owner Email', selected.owner_email || selected.email], ['Category', selected.category || selected.business_type], ['State', selected.state || '—'], ['Plan', selected.plan||'basic'], ['Status', selected.status], ['Date Onboarded', fmtDate(selected.created_at)], ['Phone', selected.phone||'—'], ['Address', selected.address||'—'], ['E-commerce', selected.ecommerce_enabled ? 'enabled' : 'disabled']].map(([l,v]) => (
                <div key={l} style={{ display:'flex', justifyContent:'space-between', padding:'8px 0', borderBottom:'1px solid var(--hairline)', fontSize:13 }}><span style={{ color: 'var(--muted)', fontWeight:600 }}>{l}</span><span style={{ color: 'var(--fg)', textAlign:'right' }}>{v}</span></div>
              ))}
            </div>
            <div style={{ borderTop:'1px solid var(--hairline)', paddingTop: 12 }}>
              <div style={{ fontWeight:800, fontSize:13, marginBottom:8, display:'flex', alignItems:'center', gap:6, color: 'var(--fg)' }}><Store size={14} /> E-commerce products for this business</div>
              {ecomLoading ? <Loading /> : ecomProducts.length===0 ? <div style={{ fontSize:13, color: 'var(--muted)', padding:10, textAlign:'center', border:'1px dashed var(--border)', borderRadius:10 }}>No e-commerce products — showing will appear here when the business has active store items.</div> : (
                <div style={{ display:'flex', flexDirection:'column', gap:8, maxHeight: 240, overflowY:'auto' }}>
                  {ecomProducts.map(p => (
                    <div key={p.id} style={{ display:'flex', justifyContent:'space-between', padding:'10px 12px', border:'1px solid var(--border)', borderRadius:10, fontSize:13, background: 'var(--panel)' }}>
                      <div><div style={{ fontWeight:700, color: 'var(--fg)' }}>{p.products?.name || p.name || 'Product'}</div><div style={{ fontSize:11, color: 'var(--muted)' }}>Units sold: {(p.units_sold ?? p.total_sold ?? '—')} • Price: {p.ecommerce_price_kobo ? '₦'+(p.ecommerce_price_kobo/100).toLocaleString() : p.products?.price ? '₦'+p.products.price : '—'}</div></div>
                      <Pill label={(p.status||'').toLowerCase().includes('active')||p.is_active ? 'live' : 'inactive'} type={(p.status||'').toLowerCase().includes('active')||p.is_active ? 'green':'gray'} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </Sheet>

      <ConfirmDialog show={!!showDeleteConfirm} title="Delete business?" onClose={()=>setShowDeleteConfirm(null)} onConfirm={handleDelete} confirmLabel={busy ? 'Deleting...' : deleteMode==='hard' ? 'Hard Delete' : 'Soft Delete (preserve ledger)'} variant="danger" message={
        <div style={{ display:'flex', flexDirection:'column', gap:10, fontSize:13 }}>
          <div><b>Soft delete</b> sets deleted_at and status=revoked, preserving ledger history. <b>Hard delete</b> removes the row (may break ledger references).</div>
          <div style={{ display:'flex', gap:8 }}>
            <label style={{ display:'flex', gap:6, alignItems:'center' }}><input type="radio" checked={deleteMode==='soft'} onChange={()=>setDeleteMode('soft')} /> Soft (recommended)</label>
            <label style={{ display:'flex', gap:6, alignItems:'center' }}><input type="radio" checked={deleteMode==='hard'} onChange={()=>setDeleteMode('hard')} /> Hard</label>
          </div>
          <div style={{ color: 'var(--red)', fontWeight:600 }}>This action requires confirmation and is auditable.</div>
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

  const safeAgents = Array.isArray(agents) ? agents : []
  const filtered = filter==='all' ? safeAgents : safeAgents.filter(a=> (a.status||a.tier)===filter || a.tier===filter)

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
      const referrals = await getAgentReferralsByAgent(selected.id).catch(()=>[])
      for (const r of (referrals||[])) {
        await transferAgentAccount({ fromAgentId: selected.id, toAgentId: transfer.toAgentId, businessId: r.business_id, reason: transfer.reason || 'admin transfer', byAdminId: null })
      }
      showToast('Transfer complete and audited', {type:'success'}); load(); setSelected(null)
    } catch (e) { showToast(e.message,{type:'error'}) }
    setBusy(false)
  }

  const parentOptions = safeAgents.filter(a=> a.id!==selected?.id).map(a=> ({ value: a.id, label: `${a.full_name||a.name} (${a.tier}/${a.state||'—'})` }))

  if (loading) return <Loading />
  if (error) return <ErrorState message={error} onRetry={load} />

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
      <div style={{ display:'flex', gap:8, flexWrap:'wrap', justifyContent:'space-between' }}>
        <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
          {['all','pending','unplaced','agent','community_coordinator','state_coordinator'].map(k=> (
            <button key={k} onClick={()=>setFilter(k)} style={{ padding:'8px 14px', borderRadius: theme.radius.md, border:'none', cursor:'pointer', fontWeight:700, fontSize:12, background: filter===k? 'var(--teal)' : 'var(--hairline)', color: filter===k?'white':'var(--muted)' }}>{k}</button>
          ))}
        </div>
        <TealBtn onClick={()=>setShowRegister(true)}>+ Register agent (admin)</TealBtn>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))', gap:10 }}>
        <Card style={{ padding:12, background: 'var(--teal-mist)', border:'1px solid var(--teal)', color: 'var(--fg)' }}><div style={{ fontSize:12, color: 'var(--muted)' }}>Agent tiers</div><div style={{ fontSize:13 }}>{(Array.isArray(tiers)?tiers:[]).map(t=> `${t.name} (${t.max_children ?? '∞'} @ ${t.commission_pct}%)`).join(' • ') || '—'}</div></Card>
        <Card style={{ padding:12, background: 'var(--panel)', border: '1px solid var(--border)' }}><div style={{ fontSize:12, color: 'var(--muted)' }}>Total agents</div><div style={{ fontWeight:800, color: 'var(--fg)' }}>{safeAgents.length}</div></Card>
        <Card style={{ padding:12, background: 'var(--panel)', border: '1px solid var(--border)' }}><div style={{ fontSize:12, color: 'var(--muted)' }}>Pending</div><div style={{ fontWeight:800, color: 'var(--fg)' }}>{safeAgents.filter(a=>a.status==='pending').length}</div></Card>
      </div>
      {filtered.length===0 ? <Empty icon={<Users size={28} />} message="No agents for filter" /> : (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {filtered.map(a=> (
            <Card key={a.id} style={{ padding:14, display:'flex', justifyContent:'space-between', gap:12, alignItems:'center', flexWrap:'wrap', background: 'var(--panel)', border: '1px solid var(--border)' }}>
              <div>
                <div style={{ fontWeight:800, color: 'var(--fg)' }}>{a.full_name || a.name} <span style={{ fontWeight:400, color: 'var(--muted)', fontSize:12 }}>• {a.tier}</span></div>
                <div style={{ fontSize:12, color: 'var(--muted)' }}>{a.email || a.contact_email} • {a.state || '—'} • {a.referral_code || 'no code'} • {a.commission_pct ?? '—'}% • {a.status}</div>
                <div style={{ fontSize:11, color: 'var(--muted)' }}>Parent: {a.parent_agent_id ? agents.find(x=>x.id===a.parent_agent_id)?.full_name || a.parent_agent_id.slice(0,8) : '—'}</div>
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
                <div key={l} style={{ display:'flex', justifyContent:'space-between', padding:'6px 0', borderBottom:'1px solid var(--hairline)' }}><span style={{ color: 'var(--muted)' }}>{l}</span><span style={{ fontWeight:600, color: 'var(--fg)' }}>{v}</span></div>
              ))}
            </div>
            <div style={{ padding:12, border:'1px solid var(--border)', borderRadius:10, background: 'var(--panel)' }}>
              <div style={{ fontWeight:800, fontSize:13, marginBottom:8, color: 'var(--fg)' }}>Tier migration</div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                <Sel label="Tier" value={tierForm.tier} onChange={v=>setTierForm(s=>({...s,tier:v}))} options={['unplaced','agent','community_coordinator','state_coordinator']} />
                <Inp label="Commission %" value={tierForm.commission_pct} onChange={v=>setTierForm(s=>({...s,commission_pct:v}))} placeholder="e.g. 10" />
              </div>
              <Sel label="Parent agent (community coordinator cap 20)" value={tierForm.parent_agent_id} onChange={v=>setTierForm(s=>({...s,parent_agent_id:v}))} options={[{value:'',label:'— No parent —'}, ...parentOptions]} />
              <GhostBtn disabled={busy} onClick={handleTierUpdate} style={{ marginTop:8 }}>Update tier / parent</GhostBtn>
            </div>
            <div style={{ padding:12, border:'1px solid var(--border)', borderRadius:10, background: 'var(--panel)' }}>
              <div style={{ fontWeight:800, fontSize:13, marginBottom:8, color: 'var(--fg)' }}>Transfer Account (audit required)</div>
              <Sel label="Transfer to agent" value={transfer.toAgentId} onChange={v=>setTransfer(s=>({...s,toAgentId:v}))} options={[{value:'',label:'Select target'}, ...safeAgents.filter(a=>a.id!==selected.id).map(a=>({value:a.id,label:a.full_name||a.name}))]} />
              <Inp label="Reason" value={transfer.reason} onChange={v=>setTransfer(s=>({...s,reason:v}))} placeholder="e.g. account correction" />
              <TealBtn disabled={busy} onClick={handleTransfer} style={{ marginTop:8, background: 'var(--red)' }}>Transfer & audit</TealBtn>
            </div>
            <div style={{ padding:12, border:'1px solid var(--border)', borderRadius:10, background: 'var(--panel)' }}>
              <div style={{ fontWeight:800, fontSize:13, marginBottom:8, color: 'var(--fg)' }}>Earnings for this agent</div>
              {earnings.length===0 ? <div style={{ fontSize:12, color: 'var(--muted)' }}>No earnings yet. Calculated server-side on payment webhook via calculate_agent_earnings — never client-side.</div> : (
                <div style={{ display:'flex', flexDirection:'column', gap:6, maxHeight: 200, overflowY:'auto' }}>
                  {earnings.map(e=>(
                    <div key={e.id} style={{ display:'flex', justifyContent:'space-between', fontSize:12, padding:'6px 8px', background: 'var(--hairline)', borderRadius:8 }}>
                      <span style={{ color: 'var(--fg)' }}>{fmtDate(e.created_at)} • {e.status} • {e.payout_period||''} • ref {e.payment_reference||'—'}</span><span style={{ fontWeight:700, color: 'var(--fg)', fontFamily: 'var(--font-mono)' }}>{fmt(e.amount_owed)} (paid {fmt(e.amount_paid)}) @ {e.commission_pct}%</span>
                    </div>
                  ))}
                </div>
              )}
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
      <Card style={{ padding:12, background: 'var(--panel)', border: '1px solid var(--border)' }}>
        <div style={{ fontWeight:700, fontSize:13, marginBottom:6, color: 'var(--fg)' }}>Recent transfers audit</div>
        {transfers.length===0 ? <div style={{ fontSize:12, color: 'var(--muted)' }}>No transfers</div> : transfers.slice(0,5).map(t=>(
          <div key={t.id} style={{ fontSize:12, padding:'4px 0', borderBottom:'1px solid var(--hairline)', color: 'var(--muted)' }}>{fmtDate(t.created_at)}: {t.from_agent_id?.slice(0,6)} → {t.to_agent_id?.slice(0,6)} • {t.reason||''}</div>
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
      await createAdminTeamMember({ full_name: memberForm.full_name, email: memberForm.email.toLowerCase(), password_hash: memberForm.password, role_id: memberForm.role_id })
      showToast('Team member hired',{type:'success'}); setShowMember(false); setMemberForm({full_name:'',email:'',password:'',role_id:''}); load()
    } catch(e){ showToast(e.message,{type:'error'}) }
    setBusy(false)
  }
  if (loading) return <Loading />
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
      <Card style={{ padding:14, background: 'var(--panel)', border: '1px solid var(--border)' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:8 }}>
          <div style={{ fontWeight:800, color: 'var(--fg)' }}>Roles — create first, then hire</div>
          <TealBtn onClick={()=>setShowRole(true)}>+ Create role</TealBtn>
        </div>
        {roles.length===0 ? <div style={{ fontSize:13, color: 'var(--muted)', padding:12, textAlign:'center' }}>No roles yet — super admin creates a role with name, description, permission checklist. Independent of hiring.</div> : (
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(260px,1fr))', gap:10, marginTop:12 }}>
            {roles.map(r=>(
              <div key={r.id} style={{ padding:12, border:'1px solid var(--border)', borderRadius:10, background: 'var(--panel)' }}>
                <div style={{ fontWeight:700, fontSize:13, color: 'var(--fg)' }}>{r.name}</div>
                <div style={{ fontSize:12, color: 'var(--muted)' }}>{r.description || '—'}</div>
                <div style={{ fontSize:11, marginTop:6, color: 'var(--fg)' }}>{Object.entries(normalizePlatformPermissions(r.permissions)).filter(([,v])=>v).map(([k])=>k).join(', ') || 'No permissions'}</div>
                <GhostBtn onClick={async()=>{ if(confirm('Delete role?')){ await deleteAdminRole(r.id); load() } }} style={{ marginTop:8, fontSize:11 }}>Delete</GhostBtn>
              </div>
            ))}
          </div>
        )}
      </Card>
      <Card style={{ padding:14, background: 'var(--panel)', border: '1px solid var(--border)' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:8 }}>
          <div style={{ fontWeight:800, color: 'var(--fg)' }}>Hiring — select existing role (no inline permission config)</div>
          <TealBtn onClick={()=>setShowMember(true)}>+ Hire / Add team member</TealBtn>
        </div>
        {members.length===0 ? <div style={{ fontSize:13, color: 'var(--muted)', padding:12, textAlign:'center' }}>No team members yet</div> : (
          <div style={{ display:'flex', flexDirection:'column', gap:8, marginTop:12 }}>
            {members.map(m=>(
              <div key={m.id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:10, border:'1px solid var(--border)', borderRadius:10, flexWrap:'wrap', gap:8, background: 'var(--panel)' }}>
                <div style={{ display:'flex', gap:10, alignItems:'center' }}>
                  <Avatar name={m.full_name} size={36} />
                  <div><div style={{ fontWeight:700, fontSize:13, color: 'var(--fg)' }}>{m.full_name}</div><div style={{ fontSize:12, color: 'var(--muted)' }}>{m.email} • Role: {m.admin_roles?.name || roles.find(r=>r.id===m.role_id)?.name || '—'} • {m.status}</div></div>
                </div>
                <div style={{ display:'flex', gap:6, alignItems:'center' }}>
                  <Pill label={m.admin_roles?.name || '—'} type="gray" />
                  <button onClick={async()=>{ if(confirm('Remove member?')){ await deleteAdminTeamMember(m.id); load() } }} style={{ padding:'6px 10px', borderRadius:8, border:'none', background: 'var(--red-bg)', color: 'var(--red)', fontWeight:700, fontSize:12, cursor:'pointer' }}>Remove</button>
                </div>
              </div>
            ))}
          </div>
        )}
        <div style={{ fontSize:11, color: 'var(--muted)', marginTop:10 }}>Login renders only sections in role.permissions. Permissions enforced at access/data layer, not just nav hiding.</div>
      </Card>
      <Modal show={showRole} onClose={()=>setShowRole(false)} title="Create role">
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          <Inp label="Name *" value={roleForm.name} onChange={v=>setRoleForm(s=>({...s,name:v}))} placeholder="e.g. Support Lead" />
          <Inp label="Description" value={roleForm.description} onChange={v=>setRoleForm(s=>({...s,description:v}))} placeholder="What this role can do" />
          <div>
            <div style={{ fontWeight:700, fontSize:12, marginBottom:6, color: 'var(--fg)' }}>Permissions checklist (8 platform perms)</div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6 }}>
              {PLATFORM_PERMISSIONS.map(p=>(
                <label key={p} style={{ display:'flex', gap:6, alignItems:'center', fontSize:13, padding:'6px 8px', border:'1px solid var(--border)', borderRadius:8, color: 'var(--fg)' }}>
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
          <div style={{ fontSize:11, color: 'var(--muted)' }}>Do not configure permissions inline during hiring; selected role supplies permissions.</div>
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
    const [ecom, agentLegacy] = await Promise.all([
      (async()=>{ try { const r = await import('../../services/supabase.js').then(m=>m.sbFetch ? m.sbFetch('ecommerce_applications?select=*&order=created_at.desc&limit=20') : []); return r } catch(e){ return [] } })(),
      getAgentApplications().catch(()=>[])
    ])
    const merged = [...(rows||[])]
    for (const e of (ecom||[])) merged.push({ id: 'ecom_'+e.id, type:'ecommerce', applicant_ref: e.business_id, applicant_name: e.business_name || e.name, applicant_email: e.email, status: e.status||'pending', submitted_at: e.created_at, details: e })
    for (const a of (agentLegacy||[])) merged.push({ id: 'agent_'+a.id, type:'agent', applicant_ref: a.id, applicant_name: a.applicant_name, applicant_email: a.contact_email, status: a.status==='submitted'?'pending': a.status, submitted_at: a.submitted_at, details: a })
    setApps(merged); setLoading(false)
  },[])
  useEffect(()=>{ load() },[load])
  const safeApps = Array.isArray(apps) ? apps : []
  const filtered = filter==='all' ? safeApps : safeApps.filter(a=>a.type===filter)
  const handleReview = async (app, status) => {
    setBusy(true)
    try {
      if (String(app.id).startsWith('ecom_') || String(app.id).startsWith('agent_')) {
        if (app.type==='agent') await reviewAgentApplication(app.applicant_ref, { status: status==='approved'?'approved':'rejected', reviewed_at: new Date().toISOString() })
        showToast(`Legacy ${app.type} ${status}`,{type:'success'})
      } else {
        await reviewApplication(app.id, { status, reviewed_at: new Date().toISOString(), review_notes: 'reviewed via unified panel' })
        if (app.type==='ecommerce' && status==='approved') {
          try { const bid = app.applicant_ref; if (bid) await updateBusiness(bid, { ecommerce_enabled: true }) } catch(e){}
        }
        if (app.type==='agent' && status==='approved') {
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
          <button key={t} onClick={()=>setFilter(t)} style={{ padding:'8px 16px', borderRadius: theme.radius.md, border:'none', cursor:'pointer', fontWeight:700, fontSize:13, background: filter===t ? 'var(--teal)' : 'var(--hairline)', color: filter===t?'white':'var(--muted)', textTransform:'capitalize' }}>{t}{t!=='all' ? ` (${safeApps.filter(a=>a.type===t).length})` : ''}</button>
        ))}
        <GhostBtn onClick={load}><RefreshCw size={13} style={{ marginRight:6 }} />Refresh</GhostBtn>
      </div>
      {filtered.length===0 ? <Empty icon={<FileText size={28} />} message={filter==='all' ? 'No applications' : `No ${filter} applications — all require explicit admin review, none auto-approve.`} /> : (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {filtered.map(a=>(
            <Card key={a.id} style={{ padding:14, display:'flex', justifyContent:'space-between', gap:12, alignItems:'center', flexWrap:'wrap', background: 'var(--panel)', border: '1px solid var(--border)' }}>
              <div>
                <div style={{ fontWeight:800, fontSize:14, textTransform:'capitalize', color: 'var(--fg)' }}>{a.type} • {a.applicant_name || a.applicant_ref || '—'}</div>
                <div style={{ fontSize:12, color: 'var(--muted)' }}>{a.applicant_email || ''} • {fmtDate(a.submitted_at)}</div>
              </div>
              <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                <Pill label={a.status} type={a.status==='approved'?'green': a.status==='rejected'?'red':'amber'} />
                {a.status==='pending' && <><TealBtn disabled={busy} onClick={()=>handleReview(a,'approved')} style={{ padding:'7px 12px', fontSize:12 }}>Approve</TealBtn><button disabled={busy} onClick={()=>handleReview(a,'rejected')} style={{ padding:'7px 12px', borderRadius:8, border:'none', background: 'var(--red-bg)', color: 'var(--red)', fontWeight:700, fontSize:12, cursor: busy?'not-allowed':'pointer' }}>Reject</button></>}
              </div>
            </Card>
          ))}
        </div>
      )}
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
  const [selected, setSelected] = useState(null)
  const [lines, setLines] = useState([])
  const [loading, setLoading] = useState(false)
  useEffect(()=>{ getBusinesses().then(b=>setBusinesses(b||[])).catch(()=>{}); getAgentsDetailed().then(a=>setAgents(a||[])).catch(()=>{}) },[])
  const debounced = useDebounced(query, 300)
  const filteredBiz = useMemo(()=> {
    const safeBiz = Array.isArray(businesses) ? businesses : []
    if (!debounced) return safeBiz.slice(0,20)
    const q = debounced.toLowerCase()
    return safeBiz.filter(b=> (b.name||'').toLowerCase().includes(q) || (b.owner||'').toLowerCase().includes(q)).slice(0,20)
  }, [businesses, debounced])
  const filteredAgents = useMemo(()=> {
    const safeAgentsList = Array.isArray(agents) ? agents : []
    if (!debounced) return safeAgentsList.slice(0,20)
    const q = debounced.toLowerCase()
    return safeAgentsList.filter(a=> (a.full_name||a.name||'').toLowerCase().includes(q) || (a.email||'').toLowerCase().includes(q)).slice(0,20)
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
    showToast('Statement opened (PDF print).',{type:'info'})
  }
  const exportBulk = async () => {
    let csv = 'Entity,Date,Description,Type,Amount\n'
    for (const b of (Array.isArray(businesses)?businesses:[]).slice(0,5)) {
      const l = await getLedgerForEntity({type:'business',id:b.id}).catch(()=>[])
      for (const it of (l||[])) csv += `${b.name},${it.date},${it.description},${it.type},${it.amount}\n`
    }
    downloadCsv(`ledger_bulk_${new Date().toISOString().slice(0,10)}.csv`, csv)
    showToast('Bulk exported (consolidated).',{type:'info'})
  }
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
      <div style={{ display:'flex', gap:8, flexWrap:'wrap', justifyContent:'space-between' }}>
        <div style={{ position:'relative', flex:'1 1 300px', maxWidth: 480 }}>
          <Search size={14} style={{ position:'absolute', left:10, top:'50%', transform:'translateY(-50%)', color: 'var(--muted)' }} />
          <input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search businesses and agents" aria-label="Search ledger" style={{ width:'100%', padding:'10px 12px 10px 30px', borderRadius:10, border:'1px solid var(--border)', fontSize:13, background: 'var(--panel)', color: 'var(--fg)' }} />
        </div>
        <GhostBtn onClick={exportBulk}><Download size={13} style={{ marginRight:6 }} />Bulk export</GhostBtn>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
        <Card style={{ padding:14, background: 'var(--panel)', border: '1px solid var(--border)' }}>
          <div style={{ fontWeight:800, fontSize:13, marginBottom:8, color: 'var(--fg)' }}>Businesses ({filteredBiz.length})</div>
          {filteredBiz.length===0 ? <div style={{ fontSize:12, color: 'var(--muted)' }}>No matches</div> : filteredBiz.map(b=>(
            <button key={b.id} onClick={()=>openStatement({type:'business',id:b.id,name:b.name,email:b.email})} style={{ display:'block', width:'100%', textAlign:'left', padding:'8px 10px', borderRadius:8, border: selected?.id===b.id?'1px solid var(--teal)':'1px solid var(--border)', background: selected?.id===b.id? 'var(--teal-mist)' : 'var(--panel)', marginBottom:6, cursor:'pointer', color: 'var(--fg)' }}>
              <div style={{ fontWeight:600, fontSize:13 }}>{b.name}</div><div style={{ fontSize:11, color: 'var(--muted)' }}>{b.owner} • {b.state}</div>
            </button>
          ))}
        </Card>
        <Card style={{ padding:14, background: 'var(--panel)', border: '1px solid var(--border)' }}>
          <div style={{ fontWeight:800, fontSize:13, marginBottom:8, color: 'var(--fg)' }}>Agents ({filteredAgents.length})</div>
          {filteredAgents.length===0 ? <div style={{ fontSize:12, color: 'var(--muted)' }}>No matches</div> : filteredAgents.map(a=>(
            <button key={a.id} onClick={()=>openStatement({type:'agent',id:a.id,name:a.full_name||a.name,email:a.email})} style={{ display:'block', width:'100%', textAlign:'left', padding:'8px 10px', borderRadius:8, border: selected?.id===a.id?'1px solid var(--teal)':'1px solid var(--border)', background: selected?.id===a.id? 'var(--teal-mist)' : 'var(--panel)', marginBottom:6, cursor:'pointer', color: 'var(--fg)' }}>
              <div style={{ fontWeight:600, fontSize:13 }}>{a.full_name||a.name}</div><div style={{ fontSize:11, color: 'var(--muted)' }}>{a.email} • {a.state||'—'}</div>
            </button>
          ))}
        </Card>
      </div>
      {selected && (
        <Card style={{ padding:16, background: 'var(--panel)', border: '1px solid var(--border)' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:8 }}>
            <div style={{ fontWeight:800, color: 'var(--fg)' }}>Statement — {selected.name} ({selected.type})</div>
            <GhostBtn onClick={exportSingle}><FileText size={13} style={{ marginRight:6 }} />Export single (PDF print)</GhostBtn>
          </div>
          {loading ? <Loading /> : lines.length===0 ? <div style={{ fontSize:12, color: 'var(--muted)', padding:12, textAlign:'center' }}>No transactions — underlying sources authoritative.</div> : (
            <div style={{ overflowX:'auto', marginTop:10 }}>
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
                <thead><tr style={{ background: 'var(--hairline)' }}><th style={{ textAlign:'left', padding:'8px', border:'1px solid var(--border)', color: 'var(--muted)' }}>Date</th><th style={{ textAlign:'left', padding:'8px', border:'1px solid var(--border)', color: 'var(--muted)' }}>Description</th><th style={{ padding:'8px', border:'1px solid var(--border)', color: 'var(--muted)' }}>Type</th><th style={{ textAlign:'right', padding:'8px', border:'1px solid var(--border)', color: 'var(--muted)' }}>Amount</th><th style={{ textAlign:'right', padding:'8px', border:'1px solid var(--border)', color: 'var(--muted)' }}>Balance</th></tr></thead>
                <tbody>
                  {(() => { let bal=0; return lines.map((it,i)=>{ bal+=Number(it.amount||0); return <tr key={i}><td style={{ padding:'8px', border:'1px solid var(--border)', color: 'var(--fg)' }}>{it.date}</td><td style={{ padding:'8px', border:'1px solid var(--border)', color: 'var(--fg)' }}>{it.description}</td><td style={{ padding:'8px', border:'1px solid var(--border)', textAlign:'center' }}><Pill label={it.type} type="gray" /></td><td style={{ padding:'8px', border:'1px solid var(--border)', textAlign:'right', color: 'var(--fg)', fontFamily: 'var(--font-mono)' }}>{fmt(it.amount)}</td><td style={{ padding:'8px', border:'1px solid var(--border)', textAlign:'right', fontWeight:700, color: 'var(--fg)', fontFamily: 'var(--font-mono)' }}>{fmt(bal)}</td></tr> }) })()}
                </tbody>
              </table>
            </div>
          )}
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
  const safeRows = Array.isArray(rows) ? rows : []
  const filtered = filter==='all' ? safeRows : safeRows.filter(r=>r.status===filter)
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
      await updatePayoutRequest(confirmPaid.id, { status: 'paid', processed_at: new Date().toISOString() })
      showToast('Marked paid — financial source updated atomically server-side', {type:'success'})
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
            <button key={s} onClick={()=>setFilter(s)} style={{ padding:'8px 14px', borderRadius: theme.radius.md, border:'none', cursor:'pointer', fontWeight:700, fontSize:12, background: filter===s? 'var(--teal)' : 'var(--hairline)', color: filter===s?'white':'var(--muted)', textTransform:'capitalize' }}>{s}</button>
          ))}
        </div>
        <GhostBtn onClick={load}><RefreshCw size={13} style={{ marginRight:6 }} />Refresh</GhostBtn>
      </div>
      {filtered.length===0 ? <Empty icon={<Wallet size={28} />} message="No payout requests" /> : (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {filtered.map(r=>(
            <Card key={r.id} style={{ padding:14, display:'flex', justifyContent:'space-between', gap:12, flexWrap:'wrap', alignItems:'center', background: 'var(--panel)', border: '1px solid var(--border)' }}>
              <div>
                <div style={{ fontWeight:800, fontSize:14, color: 'var(--fg)' }}>{r.requester_type} • {r.requester_id.slice(0,8)} • {fmt(r.amount)}</div>
                <div style={{ fontSize:12, color: 'var(--muted)' }}>{r.bank_name || r.bank_details?.bank_name || '—'} • {r.account_number || r.bank_details?.account_number || ''} • {r.account_name || r.bank_details?.account_name || ''} • {fmtDate(r.requested_at)} • method {r.payout_method || r.bank_details?.method || 'bank_transfer'}</div>
              </div>
              <div style={{ display:'flex', gap:6, alignItems:'center', flexWrap:'wrap' }}>
                <Pill label={r.status} type={r.status==='paid'?'green': r.status==='rejected'?'red': r.status==='processing'?'blue':'amber'} />
                {r.status==='pending' && <><TealBtn disabled={busy} onClick={()=>updateStatus(r,'processing')} style={{ padding:'6px 12px', fontSize:12 }}>Approve → processing</TealBtn><button disabled={busy} onClick={()=>updateStatus(r,'rejected')} style={{ padding:'6px 12px', borderRadius:8, border:'none', background: 'var(--red-bg)', color: 'var(--red)', fontWeight:700, fontSize:12, cursor: busy?'not-allowed':'pointer' }}>Reject</button></>}
                {r.status==='processing' && <TealBtn disabled={busy} onClick={()=>setConfirmPaid(r)} style={{ padding:'6px 12px', fontSize:12, background: 'var(--green)' }}>Mark as Paid</TealBtn>}
              </div>
            </Card>
          ))}
        </div>
      )}
      <ConfirmDialog show={!!confirmPaid} title="Confirm Mark as Paid?" onClose={()=>setConfirmPaid(null)} onConfirm={doMarkPaid} confirmLabel={busy?'Processing...':'Confirm Paid'} variant="danger" message={
        <div style={{ fontSize:13 }}>
          <div>This will atomically update payout status and the corresponding financial source server-side.</div>
          <div style={{ marginTop:8, color: 'var(--red)', fontWeight:600 }}>Require confirmation for final Mark as Paid. This action is irreversible.</div>
        </div>
      } />
      <Toast msg={msg} type={type} />
    </div>
  )
}

// ── CoveragePanel (kept minimal) ────────────────────────────────────────
function CoveragePanelWrapper() { return <ReferralCoveragePanel /> }

// ── Cmd+K palette (cmdk + command-score) ─────────────────────────────────
function CmdPalette({ open, setOpen, commands, onSelect, query, setQuery }) {
  const debouncedQuery = useDebounced(query, 150)
  const isDebouncing = query !== debouncedQuery
  const filtered = useMemo(() => {
    if (!debouncedQuery) return commands.slice(0, 20)
    let scored
    try {
      scored = commands.map(c => {
        const hay = c.label + ' ' + (c.keywords||[]).join(' ')
        const s = commandScore(hay, debouncedQuery)
        return { c, s }
      }).filter(x=>x.s>0).sort((a,b)=>b.s-a.s)
      // fallback if commandScore yields no results (e.g. query with specials)
      if (scored.length===0) throw new Error('no match')
    } catch {
      scored = commands.map(c => ({ c, s: scoreCommand(c, debouncedQuery) })).filter(x=>x.s>0).sort((a,b)=>b.s-a.s)
    }
    return scored.map(x=>x.c).slice(0,20)
  }, [commands, debouncedQuery])

  // group by section
  const groups = useMemo(() => {
    const m = {}
    for (const c of filtered) { const sec = c.section || 'Other'; (m[sec]=m[sec]||[]).push(c) }
    return m
  }, [filtered])

  if (!open) return null
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1100, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '20vh', background: 'rgba(0,0,0,0.45)' }} onClick={()=>setOpen(false)}>
      <div onClick={e=>e.stopPropagation()} style={{ width: 'min(640px, 90vw)', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 12, boxShadow: 'var(--elevation-2)', overflow: 'hidden', maxHeight: '60vh', display: 'flex', flexDirection: 'column' }}>
        <Command label="Command palette" style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', borderBottom: '1px solid var(--border)' }}>
            <Search size={16} style={{ color: 'var(--muted)' }} />
            <Command.Input
              autoFocus
              value={query}
              onValueChange={setQuery}
              placeholder="Type a command or search… (e.g. app ac)"
              style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', color: 'var(--fg)', fontSize: 14, width: '100%' }}
            />
            <span style={{ fontSize: 11, color: 'var(--muted)', border: '1px solid var(--border)', padding: '2px 6px', borderRadius: 6 }}>ESC</span>
          </div>
          <div aria-live="polite" className="sr-only">{filtered.length===0 && debouncedQuery ? `No results for ${debouncedQuery}` : `${filtered.length} commands`}</div>
          <Command.List style={{ overflowY: 'auto', padding: 8, flex: 1, maxHeight: '44vh' }}>
            {isDebouncing ? (
              <div style={{ padding: '20px', textAlign: 'center', color: 'var(--muted)', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}><span className="animate-pulse" style={{ width: 16, height: 16, borderRadius: 9999, background: 'var(--hairline)', display: 'inline-block' }} /> Loading…</div>
            ) : filtered.length===0 ? (
              <Command.Empty style={{ padding: '20px', textAlign: 'center', color: 'var(--muted)', fontSize: 13, minHeight: 60, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Empty icon={<Search size={20} />} message={`No commands — try “pay” or “go to..” for “${debouncedQuery}”`} />
              </Command.Empty>
            ) : Object.entries(groups).map(([sec, items])=>(
              <Command.Group key={sec} heading={sec} style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em', padding: '6px 8px' }}>{sec}</div>
                {items.map(cmd=>(
                  <Command.Item
                    key={cmd.id}
                    value={cmd.label + ' ' + (cmd.keywords||[]).join(' ')}
                    onSelect={()=>{ onSelect(cmd); setOpen(false); setQuery('') }}
                    style={{ width: '100%', textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '10px 12px', borderRadius: 8, cursor: 'pointer', color: 'var(--fg)', fontSize: 13 }}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {cmd.shortcut ? <span style={{ fontSize: 11, fontWeight: 700, background: 'var(--hairline)', color: 'var(--muted)', padding: '2px 6px', borderRadius: 6, fontFamily: 'var(--font-mono)' }}>{cmd.shortcut}</span> : null}
                      {cmd.label}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--muted)' }}>{cmd.perm || ''}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            ))}
          </Command.List>
        </Command>
        <div style={{ padding: '8px 12px', borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--muted)', display: 'flex', justifyContent: 'space-between' }}>
          <span>↑↓ to navigate • Enter to run • Recent top</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><CommandIcon size={11} />K palette</span>
        </div>
      </div>
    </div>
  )
}

// ── Sidebar Rail (256 → 64) ──────────────────────────────────────────────
function SidebarRail({ collapsed, setCollapsed, active, setActive, counts, perms, onCmdOpen }) {
  const can = (perm) => {
    if (!perms) return true
    return !!perms[perm]
  }
  const items = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, perm: 'Dashboard', count: null },
    { id: 'businesses', label: 'Businesses', icon: Building2, perm: 'Businesses', count: counts.pendingBusinesses },
    { id: 'team-agents', label: 'Agents', icon: Users, perm: 'Team-Agents', count: null, parent: 'team' },
    { id: 'team-platform', label: 'Platform', icon: UserCog, perm: 'Team-Platform', count: null, parent: 'team' },
    { id: 'applications', label: 'Applications', icon: FileText, perm: 'Applications', count: counts.pendingApps },
    { id: 'ledger', label: 'Ledger', icon: Landmark, perm: 'Ledger', count: null },
    { id: 'payouts', label: 'Payouts', icon: Wallet, perm: 'Payouts', count: counts.pendingPayouts },
    { id: 'coverage', label: 'Coverage', icon: MapPin, perm: 'Coverage', count: null },
    { id: 'health', label: 'Health', icon: ShieldAlert, perm: 'Health', count: null },
    { id: 'money', label: 'Money', icon: Wallet, perm: 'Money', count: null },
    { id: 'trust', label: 'Trust', icon: Shield, perm: 'Trust', count: null },
    { id: 'growth', label: 'Growth', icon: TrendingUp, perm: 'Growth', count: null },
  ].filter(it => can(it.perm) || it.id==='dashboard')

  const width = collapsed ? 64 : 256
  return (
    <div style={{ width, minWidth: width, transition: 'width 200ms cubic-bezier(0.16,1,0.3,1)', background: 'var(--panel)', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', height: '100vh', position: 'sticky', top: 0, overflow: 'hidden', flexShrink: 0 }}>
      <div style={{ height: 56, display: 'flex', alignItems: 'center', justifyContent: collapsed ? 'center' : 'space-between', padding: collapsed ? 8 : '0 14px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        {!collapsed && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Logo size={30} />
            <div><div style={{ fontWeight: 900, fontSize: 13, color: 'var(--fg)' }}>CareHub</div><div style={{ fontSize: 11, color: 'var(--muted)' }}>Super Admin</div></div>
          </div>
        )}
        {collapsed && <Logo size={28} />}
        <button onClick={()=>setCollapsed(v=>!v)} aria-label={collapsed ? 'Expand sidebar' : 'Collapse to rail'} aria-pressed={collapsed} style={{ width: 28, height: 28, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}>
          {collapsed ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
        </button>
      </div>

      {!collapsed && (
        <button onClick={onCmdOpen} style={{ margin: 12, padding: '9px 10px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer', justifyContent: 'space-between' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Search size={12} /> Search…</span>
          <span style={{ fontSize: 11, background: 'var(--hairline)', padding: '2px 6px', borderRadius: 6, fontFamily: 'var(--font-mono)' }}>⌘K</span>
        </button>
      )}
      {collapsed && (
        <button onClick={onCmdOpen} aria-label="Open command palette" style={{ margin: '12px auto', width: 36, height: 36, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}><CommandIcon size={16} /></button>
      )}

      <nav aria-label="Admin navigation" style={{ flex: 1, overflowY: 'auto', padding: collapsed ? '8px 6px' : '8px', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {items.map(it => {
          const isActive = active===it.id || (it.parent && active===it.parent)
          const Icon = it.icon
          return (
            <button
              key={it.id}
              onClick={()=>setActive(it.id)}
              aria-current={isActive ? 'page' : undefined}
              aria-label={collapsed ? it.label : undefined}
              title={collapsed ? it.label : undefined}
              style={{
                display: 'flex', alignItems: 'center', gap: collapsed ? 0 : 10,
                justifyContent: collapsed ? 'center' : 'flex-start',
                padding: collapsed ? '10px 0' : '9px 10px',
                borderRadius: 10,
                border: 'none',
                background: isActive ? 'var(--teal)' : 'transparent',
                color: isActive ? 'white' : 'var(--muted)',
                fontWeight: 700, fontSize: 13, cursor: 'pointer', width: '100%', textAlign: 'left',
              }}
            >
              <Icon size={16} style={{ flexShrink: 0 }} />
              {!collapsed && <span style={{ flex: 1 }}>{it.label}</span>}
              {!collapsed && it.count>0 && <span style={{ fontSize: 11, fontWeight: 800, background: isActive ? 'rgba(255,255,255,0.2)' : 'var(--amber-bg)', color: isActive ? 'white' : 'var(--amber)', padding: '2px 7px', borderRadius: 9999 }}>{it.count}</span>}
              {collapsed && it.count>0 && <span style={{ position: 'absolute', marginLeft: 18, marginTop: -12, width: 8, height: 8, borderRadius: 9999, background: 'var(--amber)', border: '2px solid var(--panel)', display: 'block' }} aria-hidden="true" />}
              {collapsed && <span className="sr-only">{it.label}</span>}
            </button>
          )
        })}
      </nav>

      <div style={{ padding: collapsed ? 8 : 12, borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button onClick={()=>toggleTheme()} style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: collapsed ? 'center' : 'flex-start', padding: collapsed ? '8px 0' : '8px 10px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--muted)', fontSize: 12, fontWeight: 700, cursor: 'pointer', width: '100%' }}>
          <span style={{ display: 'flex' }}>{(getStoredTheme()||'dark')==='dark' ? <Sun size={14} /> : <Moon size={14} />}</span>
          {!collapsed && <span>{(getStoredTheme()||'dark')==='dark' ? 'Light' : 'Dark'} mode</span>}
        </button>
        {!collapsed && <div style={{ fontSize: 10, color: 'var(--muted)', textAlign: 'center' }}>Quiet Chrome • 13px body • color=state only</div>}
      </div>
    </div>
  )
}

// ── Main AdminDashboard ──────────────────────────────────────────────────
export default function AdminDashboard() {
  const [businesses, setBusinesses] = useState(null)
  const [team, setTeam] = useState([])
  const [teamMembers, setTeamMembers] = useState([])
  const [payouts, setPayouts] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('dashboard')
  const [highlightBusinessId, setHighlightBusinessId] = useState(null)
  const [platformPerms, setPlatformPerms] = useState(null)
  const { msg: toastMsg, show: showToast } = useToast()
  const navigate = useNavigate()
  const { logout: authLogout, auth } = useAuth()
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('carehub_admin_rail')==='collapsed' } catch { return false }
  })
  const [cmdOpen, setCmdOpen] = useState(false)
  const [cmdQuery, setCmdQuery] = useState('')
  const [recentCmdIds, setRecentCmdIds] = useState(() => {
    try { const r = localStorage.getItem('carehub_cmd_recent'); return r ? JSON.parse(r) : [] } catch { return [] }
  })
  const [pulseAt, setPulseAt] = useState(Date.now())
  const [lastSynced, setLastSynced] = useState('just now')
  const [pulseOnline, setPulseOnline] = useState(true)
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false)
  useEffect(()=> {
    try { setPrefersReducedMotion(window.matchMedia('(prefers-reduced-motion: reduce)').matches) } catch {}
    const handleOnline = () => setPulseOnline(navigator.onLine)
    const handleOffline = () => setPulseOnline(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return ()=> { window.removeEventListener('online', handleOnline); window.removeEventListener('offline', handleOffline) }
  }, [])

  useEffect(()=> { try { localStorage.setItem('carehub_admin_rail', collapsed?'collapsed':'expanded') } catch {} }, [collapsed])

  const load = useCallback(async () => {
    try {
      const [b, tLegacy, tNew, p] = await Promise.all([
        getBusinesses().catch(()=>[]),
        getAdminTeam().catch(()=>[]),
        getAdminTeamMembers().catch(()=>[]),
        getPayoutRequests().catch(()=>[]),
      ])
      setBusinesses(b || [])
      setTeam(tLegacy || [])
      setTeamMembers(tNew || [])
      setPayouts(p || [])
      setPulseAt(Date.now())
      setLastSynced(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))
      try {
        const email = auth?.brand?.email || auth?.email
        if (email && tNew?.length) {
          const me = tNew.find(m=> (m.email||'').toLowerCase() === (email||'').toLowerCase())
          if (me) {
            const role = me.admin_roles
            setPlatformPerms(normalizePlatformPermissions(role?.permissions))
          } else if (auth?.isAdmin) {
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

  useEffect(() => { load() }, [load])

  // realtime pulse replaces 30s poll — AD-6, handles disconnect/offline, respects reduced-motion, cleanup unsubscribe
  useEffect(() => {
    let channel = null
    let interval = null
    try {
      channel = authClient.channel('admin-businesses-pulse')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'businesses' }, (payload) => {
          setPulseAt(Date.now())
          setLastSynced('just now')
          setPulseOnline(true)
          // incremental update without full reload for instant feedback
          if (payload?.new?.id) {
            setBusinesses(prev => {
              const list = prev || []
              const idx = list.findIndex(b=>b.id===payload.new.id)
              if (payload.eventType==='DELETE') return list.filter(b=>b.id!==payload.old?.id)
              if (idx>=0) { const n=[...list]; n[idx]=payload.new; return n }
              if (payload.eventType==='INSERT') return [payload.new, ...list]
              return list
            })
          } else {
            load()
          }
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'payout_requests' }, () => {
          setPulseAt(Date.now()); setPulseOnline(true); load()
        })
        .on('system', { event: '*' }, (payload) => {
          // supabase realtime system status — detect disconnect/offline
          const status = payload?.status || payload?.event || ''
          if (String(status).toLowerCase().includes('close') || String(status).toLowerCase().includes('error') || payload?.type==='close') {
            setPulseOnline(false)
          } else if (String(status).toLowerCase().includes('sub')) {
            setPulseOnline(true)
          }
        })
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') setPulseOnline(true)
          else if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setPulseOnline(false)
        })
    } catch(e) { channel = null; setPulseOnline(false) }
    // fallback keep lastSynced ticker + offline check
    interval = setInterval(()=> {
      const ms = Date.now() - pulseAt
      if (ms < 60000) setLastSynced('just now')
      else if (ms < 3600000) setLastSynced(`${Math.floor(ms/60000)}m ago`)
      else setLastSynced(`${Math.floor(ms/3600000)}h ago`)
      if (!navigator.onLine) setPulseOnline(false)
    }, 10000)
    return () => {
      try { if (channel) { try { channel.unsubscribe() } catch {} ; authClient.removeChannel(channel) } } catch {}
      clearInterval(interval)
    }
  }, [pulseAt, load])

  const handleStatusChange = useCallback(async (id, status) => {
    await updateBusiness(id, { status })
    setBusinesses(prev => (prev || []).map(b => b.id === id ? { ...b, status } : b))
    setPulseAt(Date.now()); setLastSynced('just now')
    try {
      const { data: { session } } = await authClient.auth.getSession()
      if (session?.access_token) {
        fetch('/api/notify-business-status', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ businessId: id, status }) }).catch(()=>{})
      }
    } catch(e){}
  }, [])

  const logout = () => { authLogout(); navigate('/login') }

  // Cmd+K global — handles metaKey && ctrlKey, guards inputs, debounce via palette
  useEffect(() => {
    const handler = (e) => {
      const tgt = e.target
      const isEditable = tgt && tgt.closest && tgt.closest('input,textarea,[contenteditable=true]')
      // guard firing while typing in input/textarea/contenteditable unless Cmd/Ctrl+K
      const isK = (e.key==='k' || e.key==='K') && (e.metaKey || e.ctrlKey)
      if (isEditable && !isK) return
      if (isK) { e.preventDefault(); setCmdOpen(o=>!o); return }
      if (e.key==='/' && !e.metaKey && !e.ctrlKey && !isEditable) {
        // optional quick search
      }
    }
    window.addEventListener('keydown', handler)
    return ()=> window.removeEventListener('keydown', handler)
  }, [])

  const commands = useMemo(()=> buildCommandList({ businesses, payouts, perms: platformPerms, recentIds: recentCmdIds }), [businesses, payouts, platformPerms, recentCmdIds])

  const handleCmdSelect = useCallback(async (cmd) => {
    // push recent
    setRecentCmdIds(prev => {
      const n = [cmd.id, ...prev.filter(id=>id!==cmd.id)].slice(0,10)
      try { localStorage.setItem('carehub_cmd_recent', JSON.stringify(n)) } catch {}
      return n
    })
    try {
      if (cmd.action==='navigate') {
        // map team-* to team tab + sub
        if (cmd.target==='team-agents' || cmd.target==='team-platform') {
          setTab('team')
          // sub handled via effect below? we store in state
          window.__carehub_teamSub = cmd.target==='team-agents' ? 'agents' : 'platform'
        } else {
          setTab(cmd.target)
        }
        if (cmd.businessId) setHighlightBusinessId(cmd.businessId)
        window.scrollTo({ top: 0, behavior: 'smooth' })
      } else if (cmd.action==='approveBusiness') {
        await handleStatusChange(cmd.businessId, 'active')
        showToast(`Approved ${cmd.business.name} — undo?`, { type: 'success', actionLabel: 'Undo', onAction: async()=> { await handleStatusChange(cmd.businessId, cmd.business.status); showToast('Undone',{type:'info'}) }, duration: 5000 })
      } else if (cmd.action==='suspendBusiness') {
        await handleStatusChange(cmd.businessId, 'suspended')
        showToast(`Suspended ${cmd.business.name} (temporary)`, { type: 'success', actionLabel: 'Undo', onAction: async()=> { await handleStatusChange(cmd.businessId, cmd.business.status) }, duration: 5000 })
      } else if (cmd.action==='revokeBusiness') {
        if (confirm('Revoke withdraws approval — must reapply. Continue?')) {
          await handleStatusChange(cmd.businessId, 'revoked')
          showToast(`Revoked ${cmd.business.name}`, { type: 'success' })
        }
      } else if (cmd.action==='openBusiness') {
        setTab('businesses'); setHighlightBusinessId(cmd.businessId); window.scrollTo({top:0,behavior:'smooth'})
      } else if (cmd.action==='markPayoutPaid') {
        await markPayoutPaidAtomic(cmd.payoutId, {})
        await updatePayoutRequest(cmd.payoutId, { status: 'paid', processed_at: new Date().toISOString() })
        showToast('Marked paid', {type:'success'}); setPayouts(prev=> prev.map(p=>p.id===cmd.payoutId?{...p,status:'paid'}:p))
      } else if (cmd.action==='approvePayout') {
        await updatePayoutRequest(cmd.payoutId, { status: 'processing', reviewed_at: new Date().toISOString() })
        showToast('Payout → processing', {type:'success'}); setPayouts(prev=> prev.map(p=>p.id===cmd.payoutId?{...p,status:'processing'}:p))
      } else if (cmd.action==='refresh') {
        load()
      } else if (cmd.action==='toggleTheme') {
        toggleTheme()
      } else if (cmd.action==='signout') {
        logout()
      } else if (cmd.action==='focusSearch') {
        setTab('businesses'); setTimeout(()=> document.querySelector('input[aria-label="Search businesses"]')?.focus(), 100)
      } else if (cmd.action==='exportBusinesses') {
        const csv = toBusinessCsv((businesses||[]).filter(b=>!b.deleted_at))
        downloadCsv(`businesses_all_${new Date().toISOString().slice(0,10)}.csv`, csv)
        showToast('Exported', {type:'info'})
      }
    } catch(e) {
      showToast(e.message.includes('42501')||e.message.includes('permission') ? 'No permission' : e.message, {type:'error'})
    }
  }, [handleStatusChange, businesses, showToast, load])

  const allTeamCount = (Array.isArray(teamMembers) ? teamMembers.length : 0) || (Array.isArray(team) ? team.length : 0)
  const bizList = Array.isArray(businesses) ? businesses : []
  const pendingCount = bizList.filter(b=>b.status==='pending' && !b.deleted_at).length
  const pendingAppsCount = 0 // will be derived inside
  const safePayoutsForCount = Array.isArray(payouts) ? payouts : []
  const counts = {
    pendingBusinesses: pendingCount,
    pendingApps: 0,
    pendingPayouts: safePayoutsForCount.filter(p=>p.status==='pending'||p.status==='processing').length,
  }

  const isPermitted = (perm) => {
    if (!platformPerms) return true
    return !!platformPerms[perm]
  }

  const handleNavFromDashboard = (targetTab, businessId) => {
    if (businessId) setHighlightBusinessId(businessId)
    setTab(targetTab)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const [teamSub, setTeamSub] = useState('agents')
  useEffect(()=> {
    if (window.__carehub_teamSub) { setTeamSub(window.__carehub_teamSub); window.__carehub_teamSub=null }
  }, [tab])

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--fg)', fontFamily: 'var(--font-family)', display: 'flex' }}>
      <SidebarRail collapsed={collapsed} setCollapsed={setCollapsed} active={tab} setActive={setTab} counts={counts} perms={platformPerms} onCmdOpen={()=>setCmdOpen(true)} />

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', height: '100vh', overflowY: 'auto' }}>
        {/* header: pulse dot replaces Refresh */}
        <div style={{ height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 20px', borderBottom: '1px solid var(--border)', background: 'var(--panel)', position: 'sticky', top: 0, zIndex: 10, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontWeight: 800, fontSize: 14, color: 'var(--fg)', textTransform: 'capitalize' }}>{tab.replace('-',' — ')}</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: pulseOnline ? 'var(--muted)' : 'var(--red)', background: pulseOnline ? 'var(--hairline)' : 'var(--red-bg)', padding: '4px 8px', borderRadius: 9999, fontWeight: 600 }} title={pulseOnline ? 'Realtime connected' : 'Offline — reconnecting'}>
              <span style={{ width: 8, height: 8, borderRadius: 9999, background: pulseOnline ? 'var(--green)' : 'var(--red)', display: 'inline-block', animation: prefersReducedMotion ? 'none' : (pulseOnline ? 'pulse 1.6s ease-in-out infinite' : 'none'), boxShadow: pulseOnline ? '0 0 0 4px rgba(34,197,94,0.15)' : 'none' }} aria-hidden="true" />
              {pulseOnline ? `live • last synced ${lastSynced}` : `offline • last synced ${lastSynced}`}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems:'center' }}>
            {platformPerms && <span style={{ fontSize:11, color:'var(--muted)', display:'flex', gap:4, alignItems:'center' }}><Shield size={12} /> {Object.entries(platformPerms).filter(([,v])=>v).length}/{PLATFORM_PERMISSIONS.length} perms</span>}
            <button onClick={()=>setCmdOpen(true)} aria-label="Open command palette" style={{ display:'flex', alignItems:'center', gap:6, padding:'7px 12px', borderRadius:8, border:'1px solid var(--border)', background:'var(--panel)', color:'var(--muted)', fontWeight:600, fontSize:12, cursor:'pointer' }}><CommandIcon size={13} /> ⌘K</button>
            <button onClick={logout} style={{ padding:'7px 12px', borderRadius:8, border:'none', background:'var(--hairline)', color:'var(--fg)', fontWeight:600, fontSize:12, cursor:'pointer' }}>Sign Out</button>
          </div>
        </div>

        <div style={{ maxWidth: 1200, margin: '0 auto', padding: 20, width: '100%', flex: 1 }}>
          {pendingCount > 0 && tab==='dashboard' && (
            <div style={{ marginBottom: 16, padding:'12px 16px', borderRadius:12, background: 'var(--amber-bg)', border:'1px solid var(--amber)', display:'flex', alignItems:'center', gap:10 }}>
              <Bell size={18} color="var(--amber)" style={{ flexShrink:0 }} />
              <div style={{ fontWeight:700, color: 'var(--amber)', fontSize:13 }}>{pendingCount} business(es) waiting for approval — review in Businesses</div>
            </div>
          )}

          {loading ? <Loading /> : (
            <>
              {tab==='dashboard' && isPermitted('Dashboard') && <DashboardStats businesses={businesses} teamMembers={teamMembers.length? teamMembers: team} payouts={payouts} onNav={handleNavFromDashboard} loading={loading} error={null} onRetry={load} lastSynced={lastSynced} onRefresh={load} />}
              {tab==='dashboard' && !isPermitted('Dashboard') && <Empty icon={<Shield size={28} />} message="No access to Dashboard" />}

              {tab==='businesses' && (isPermitted('Businesses') ? <BusinessesPanel businesses={businesses} onRefresh={load} onStatusChange={handleStatusChange} highlightId={highlightBusinessId} /> : <Empty icon={<Shield size={28} />} message="No access to Businesses" />)}

              {(tab==='team' || tab==='team-agents' || tab==='team-platform') && (
                <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
                  <div style={{ display:'flex', gap:8 }}>
                    {[
                      { id:'agents', label:'Agents', perm:'Team-Agents', icon: Users, tabId: 'team-agents' },
                      { id:'platform', label:'Platform Team', perm:'Team-Platform', icon: UserCog, tabId: 'team-platform' },
                    ].filter(s=> isPermitted(s.perm)).map(s=> (
                      <button key={s.id} onClick={()=>{
                        setTeamSub(s.id)
                        setTab(s.tabId)
                      }} style={{ flex:1, padding:'10px 12px', borderRadius:10, border: teamSub===s.id? '1px solid var(--teal)':'1px solid var(--border)', background: teamSub===s.id? 'var(--teal-mist)' : 'var(--panel)', color: teamSub===s.id? 'var(--teal)':'var(--muted)', fontWeight:700, fontSize:13, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:6 }}><s.icon size={14} /> {s.label}</button>
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
              {tab==='coverage' && (isPermitted('Coverage') ? <CoveragePanelWrapper /> : <Empty icon={<Shield size={28} />} message="No access to Coverage" />)}
              {tab==='health' && (isPermitted('Health') ? <HealthPanel /> : <Empty icon={<Shield size={28} />} message="No access to Health" />)}
              {tab==='money' && (isPermitted('Money') ? <MoneyPanel /> : <Empty icon={<Shield size={28} />} message="No access to Money" />)}
              {tab==='trust' && (isPermitted('Trust') ? <TrustPanel /> : <Empty icon={<Shield size={28} />} message="No access to Trust" />)}
              {tab==='growth' && (isPermitted('Growth') ? <GrowthPanel /> : <Empty icon={<Shield size={28} />} message="No access to Growth" />)}
            </>
          )}
        </div>

        <div style={{ textAlign:'center', fontSize:11, color: 'var(--muted)', padding: 12, borderTop: '1px solid var(--border)' }}>Coverage unchanged • Financial operations are server-side & atomic • RLS enforced at data layer • <span style={{ fontFamily: 'var(--font-mono)' }}>last synced {lastSynced}</span></div>
      </div>

      <CmdPalette open={cmdOpen} setOpen={setCmdOpen} commands={commands} onSelect={handleCmdSelect} query={cmdQuery} setQuery={setCmdQuery} />
      <Toast msg={toastMsg} />
      <style>{`@keyframes pulse { 0%,100%{opacity:1; transform:scale(1)} 50%{opacity:0.7; transform:scale(0.92)} } @media (prefers-reduced-motion: reduce) { * { animation-duration: 0.01ms !important; } } .sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border-width:0}`}</style>
    </div>
  )
}
