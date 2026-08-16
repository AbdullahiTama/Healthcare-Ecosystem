import { useState, useEffect } from 'react'
import { Check, X, Inbox, RefreshCw, Landmark, Wallet, AlertTriangle, MapPin, UserCheck, PlayCircle } from 'lucide-react'
import {
  getAgentApplications, reviewAgentApplication, getAgents, addAgentRow,
  updateAgentRow, getBusinessesByAgent, getCommissionsLedger, updateCommission,
  getCommissionReviewFlags, getPayouts, createPayout, updatePayout,
} from '../../../services/supabase'
import { emailAgentApproved, emailAgentRejected } from '../../../lib/email'
import { generateReferralCode } from '../../../lib/referral_program'
import { fmt, fmtDate } from '../../../lib/utils'
import { theme } from '../../../styles/theme'
import { Card, StatCard, Pill, Modal, Inp, Sel, TealBtn, GhostBtn, Loading, Empty, ErrorState, Toast, useToast } from '../../../components/ui'

const { tealDeep, navy, gray500, gray400, border, danger, dangerBg } = theme

// ── Shared fetch hook ────────────────────────────────────────────────────────
// One effect per panel: fetch, expose loading/error/data + a reload() that
// re-runs the same fetch. Keeps every panel's data-loading self-contained.
function useApi(fn) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let alive = true
    setLoading(true)
    Promise.resolve()
      .then(fn)
      .then(d => { if (!alive) return; setData(d); setError('') })
      .catch(e => { if (alive) setError(e.message || 'Failed to load') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [tick])

  return {
    data: data || [],
    error,
    loading,
    reload: () => setTick(t => t + 1),
  }
}

const STATUS_PILL = (s) => {
  if (s === 'active') return { label: s, type: 'green' }
  if (s === 'approved_pending_onboarding') return { label: 'pending onboarding', type: 'blue' }
  if (s === 'suspended') return { label: s, type: 'red' }
  return { label: s, type: 'gray' }
}

// ── 1. APPLICATIONS (review queue) ───────────────────────────────────────────
export function ApplicationsPanel() {
  const { msg, type, show: showToast } = useToast()
  const apps = useApi(getAgentApplications)
  const allAgents = useApi(getAgents)
  const [selected, setSelected] = useState(null)
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)

  const agents = allAgents.data || []
  const city = (s) => (s || '').trim().toLowerCase()
  const sameArea = (app) => agents.filter(a =>
    city(a.city) === city(app.requested_city) && city(a.area) === city(app.requested_area))

  const approve = async () => {
    setBusy(true)
    try {
      // Guard: don't double-assign a live/pending agent to the same area.
      const existing = sameArea(selected).filter(a => a.status === 'active' || a.status === 'approved_pending_onboarding')
      if (existing.length) {
        showToast('That area already has a live agent — reject or reassign first.', { type: 'error' })
        setBusy(false); return
      }
      await reviewAgentApplication(selected.id, { status: 'approved', review_notes: notes || null, reviewed_at: new Date().toISOString() })
      const created = await addAgentRow({
        name: selected.applicant_name,
        contact_email: selected.contact_email,
        contact_phone: selected.contact_phone || '',
        city: selected.requested_city,
        area: selected.requested_area,
        status: 'approved_pending_onboarding',
        referral_code: generateReferralCode(),
      })
      const code = created?.referral_code || 'PENDING'
      try {
        await emailAgentApproved({ agentName: selected.applicant_name, agentEmail: selected.contact_email, city: selected.requested_city, area: selected.requested_area, referralCode: code })
      } catch (e) {}
      showToast('Approved — agent created, pending onboarding.', { type: 'success' })
      setSelected(null); setNotes(''); apps.reload(); allAgents.reload()
    } catch (e) {
      showToast('Approval failed: ' + e.message, { type: 'error' })
    }
    setBusy(false)
  }

  const reject = async (a) => {
    setBusy(true)
    try {
      await reviewAgentApplication(a.id, { status: 'rejected', review_notes: notes || null, reviewed_at: new Date().toISOString() })
      try {
        await emailAgentRejected({ agentName: a.applicant_name, agentEmail: a.contact_email, city: a.requested_city, area: a.requested_area, reason: notes || '' })
      } catch (e) {}
      showToast('Application rejected.', { type: 'success' })
      setSelected(null); setNotes(''); apps.reload()
    } catch (e) {
      showToast('Rejection failed: ' + e.message, { type: 'error' })
    }
    setBusy(false)
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '14px' }}>
        <GhostBtn onClick={() => { apps.reload(); allAgents.reload() }}><RefreshCw size={13} style={{ marginRight: 6 }} /> Refresh</GhostBtn>
      </div>

      {apps.loading ? <Loading /> : apps.error ? <ErrorState onRetry={apps.reload} message={apps.error} /> : !apps.data.length ? (
        <Empty icon={<Inbox size={28} />} message='No applications yet.' cause='positive' />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {(apps.data || []).map(a => {
            const clash = sameArea(a).some(x => x.status === 'active' || x.status === 'approved_pending_onboarding')
            return (
              <Card key={a.id} style={{ padding: '16px', cursor: 'pointer' }} onClick={() => { setSelected(a); setNotes('') }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: '800', fontSize: '15px', color: navy }}>{a.applicant_name}</div>
                    <div style={{ fontSize: '12px', color: gray500, marginTop: '2px' }}>{a.contact_email}{a.contact_phone ? ' · ' + a.contact_phone : ''}</div>
                    <div style={{ fontSize: '13px', color: tealDeep, fontWeight: '700', marginTop: '6px' }}>📍 {a.requested_area}, {a.requested_city}</div>
                    {a.applicant_details?.experience && <div style={{ fontSize: '12px', color: gray500, marginTop: '4px' }}>Experience: {a.applicant_details.experience}</div>}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    {clash && <Pill label='area taken' type='red' />}
                    <Pill label={a.status} type={a.status === 'approved' ? 'green' : a.status === 'rejected' ? 'red' : a.status === 'under_review' ? 'blue' : 'amber'} />
                    <span style={{ fontSize: '11px', color: gray400 }}>{fmtDate(a.submitted_at)}</span>
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {selected && (
        <Modal show onClose={() => setSelected(null)} sheet title={'Review — ' + selected.applicant_name}
          footer={
            <>
              <button onClick={() => reject(selected)} disabled={busy} style={{ flex: 1, padding: '13px', borderRadius: theme.radius.md, border: 'none', background: dangerBg, color: danger, fontWeight: 700, cursor: busy ? 'not-allowed' : 'pointer' }}><X size={14} style={{ marginRight: 4 }} /> Reject</button>
              <TealBtn onClick={() => approve(selected)} disabled={busy} style={{ flex: 1, padding: '13px' }}><Check size={14} style={{ marginRight: 4 }} /> Approve & onboard</TealBtn>
            </>
          }>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px' }}>
              {[['Area', selected.requested_area + ', ' + selected.requested_city], ['Email', selected.contact_email], ['Phone', selected.contact_phone || '—'], ['Submitted', fmtDate(selected.submitted_at)]].map(([l, v]) => (
                <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: `1px solid ${theme.border}` }}><span style={{ color: gray500, fontWeight: 600 }}>{l}</span><span style={{ color: navy, fontWeight: 700, textAlign: 'right' }}>{v}</span></div>
              ))}
              {selected.applicant_details?.experience && <div style={{ fontSize: '13px', color: gray500 }}><b>Experience</b>: {selected.applicant_details.experience}</div>}
              {selected.applicant_details?.motivation && <div style={{ fontSize: '13px', color: gray500 }}><b>Motivation</b>: {selected.applicant_details.motivation}</div>}
            </div>
            {sameArea(selected).length > 0 && (
              <div style={{ fontSize: '12px', color: theme.amberText, background: theme.warningBg, padding: '10px 12px', borderRadius: theme.radius.md }}>
                Same area also claimed by: {sameArea(selected).map(x => x.name + ' (' + x.status + ')').join(', ')}
              </div>
            )}
            <div>
              <div style={{ fontSize: '11px', fontWeight: '700', color: gray500, marginBottom: '6px' }}>Review note</div>
              <Inp value={notes} onChange={setNotes} placeholder='e.g. area verified free, strong retail pharma background' />
            </div>
          </div>
        </Modal>
      )}
      <Toast msg={msg} type={type} />
    </div>
  )
}

// ── 2. AGENTS (lifecycle: onboarding gate, suspend/reinstate) ────────────────
export function AgentsPanel() {
  const { msg, type, show: showToast } = useToast()
  const agents = useApi(getAgents)
  const [selected, setSelected] = useState(null)

  const agentName = a => a?.name || 'Agent'

  const act = async (ag, patch, ok) => {
    try {
      await updateAgentRow(ag.id, patch)
      showToast(ok, { type: 'success' })
    } catch (e) {
      showToast('Update failed: ' + e.message, { type: 'error' })
    }
    agents.reload(); setSelected(null)
  }

  const markTrained = (ag) => act(ag, { status: 'active', onboarding_completed_at: new Date().toISOString() }, agentName(ag) + ' is now live — code active.')
  const suspend = (ag) => act(ag, { status: 'suspended' }, agentName(ag) + ' suspended — commissions paused.')
  const reinstate = (ag) => act(ag, { status: 'active' }, agentName(ag) + ' reinstated.')

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '14px' }}>
        <GhostBtn onClick={agents.reload}><RefreshCw size={13} style={{ marginRight: 6 }} /> Refresh</GhostBtn>
      </div>

      {agents.loading ? <Loading /> : agents.error ? <ErrorState onRetry={agents.reload} message={agents.error} /> : !agents.data.length ? (
        <Empty icon={<UserCheck size={28} />} message='No agents yet — approve an application to create one.' />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {(agents.data || []).map(a => (
            <Card key={a.id} style={{ padding: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: '800', fontSize: '15px', color: navy }}>{a.name}</div>
                  <div style={{ fontSize: '12px', color: gray500, marginTop: '2px' }}>{a.contact_email} · 📍 {a.area}, {a.city}</div>
                  <div style={{ fontSize: '12px', color: gray500, marginTop: '2px' }}>Code: <b style={{ color: tealDeep }}>{a.referral_code || '—'}</b> · signed {fmtDate(a.created_at)}</div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px' }}>
                  <Pill {...STATUS_PILL(a.status)} />
                  <button onClick={() => setSelected(a)} style={{ fontSize: '12px', fontWeight: '700', color: tealDeep, background: 'none', border: 'none', cursor: 'pointer' }}>Manage →</button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {selected && (
        <Modal show onClose={() => setSelected(null)} sheet title={selected.name}
          footer={
            <div style={{ display: 'flex', gap: '8px', width: '100%', flexWrap: 'wrap' }}>
              {selected.status === 'approved_pending_onboarding' && <>
                <TealBtn onClick={() => markTrained(selected)} style={{ flex: 1, padding: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}><PlayCircle size={14} /> Mark trained → Active</TealBtn>
                <GhostBtn onClick={() => { suspend(selected) }} style={{ flex: 1, padding: '12px' }}>Suspend</GhostBtn>
              </>}
              {selected.status === 'active' && <GhostBtn onClick={() => suspend(selected)} style={{ flex: 1, padding: '12px' }}>Suspend</GhostBtn>}
              {selected.status === 'suspended' && <TealBtn onClick={() => reinstate(selected)} style={{ flex: 1, padding: '12px' }}>Reinstate</TealBtn>}
              <GhostBtn onClick={() => setSelected(null)} style={{ flex: 1, padding: '12px' }}>Close</GhostBtn>
            </div>
          }>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {[['Area', selected.city + ' / ' + selected.area], ['Email', selected.contact_email], ['Phone', selected.contact_phone || '—'], ['Status', selected.status], ['Referral code', selected.referral_code || '—']].map(([l, v]) => (
              <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: `1px solid ${theme.border}`, fontSize: '13px' }}><span style={{ color: gray500, fontWeight: 600 }}>{l}</span><span style={{ color: navy, fontWeight: 700, textAlign: 'right' }}>{v}</span></div>
            ))}
            <div style={{ fontSize: '12px', color: gray500 }}>
              <b style={{ color: gray600 }}>Referral link:</b><br />
              <code style={{ fontSize: '12px', color: tealDeep, wordBreak: 'break-all' }}>{selected.referral_code ? window.location.origin + '/register?ref=' + selected.referral_code : 'code not live yet'}</code>
            </div>
          </div>
        </Modal>
      )}
      <Toast msg={msg} type={type} />
    </div>
  )
}

// ── 3. LEDGER (commissions + review flags + totals) ──────────────────────────
export function LedgerPanel() {
  const { msg, type, show: showToast } = useToast()
  const commissions = useApi(getCommissionsLedger)
  const flags = useApi(getCommissionReviewFlags)
  const [filter, setFilter] = useState('all')

  const rows = filter === 'all' ? commissions.data : commissions.data.filter(c => c.status === filter)
  const owed = commissions.data.filter(c => c.status === 'accrued' || c.status === 'payable').reduce((s, c) => s + Number(c.amount || 0), 0)
  const paid = commissions.data.filter(c => c.status === 'paid').reduce((s, c) => s + Number(c.amount || 0), 0)

  const setStatus = async (c, status) => {
    try {
      await updateCommission(c.id, { status })
      showToast('Marked ' + status + '.', { type: 'success' })
    } catch (e) {
      showToast('Update failed: ' + e.message, { type: 'error' })
    }
    commissions.reload()
  }

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: '12px', marginBottom: '18px' }}>
        <StatCard icon={<Wallet size={14} />} label='Owed' value={fmt(owed)} tone='warning' />
        <StatCard icon={<Check size={14} />} label='Paid' value={fmt(paid)} />
        <StatCard icon={<AlertTriangle size={14} />} label='Review flags' value={flags.data.length} alert={(flags.data || []).length > 0} />
      </div>

      {flags.data.length > 0 && (
        <Card style={{ padding: '14px', marginBottom: '14px', background: theme.warningBg, border: '1px solid #fcd34d' }}>
          <div style={{ fontWeight: '800', color: theme.amberText, fontSize: '13px', marginBottom: '8px' }}>Payments that earned no commission (review needed)</div>
          {flags.data.slice(0, 8).map(f => (
            <div key={f.id} style={{ fontSize: '12px', color: theme.amberText, fontFamily: theme.fontMono, padding: '3px 0' }}>{f.reason}{f.created_at ? ' · ' + fmtDate(f.created_at) : ''}</div>
          ))}
        </Card>
      )}

      <div style={{ display: 'flex', gap: '8px', marginBottom: '14px', flexWrap: 'wrap' }}>
        {['all', 'accrued', 'payable', 'paid', 'void'].map(s => (
          <button key={s} onClick={() => setFilter(s)} style={{ padding: '8px 16px', borderRadius: theme.radius.full, border: 'none', cursor: 'pointer', fontWeight: '700', fontSize: '12px', background: filter === s ? tealDeep : theme.gray100, color: filter === s ? 'white' : gray500, textTransform: 'capitalize' }}>{s}</button>
        ))}
      </div>

      {commissions.loading ? <Loading /> : commissions.error ? <ErrorState onRetry={commissions.reload} message={commissions.error} /> : !commissions.data.length ? (
        <Empty icon={<Landmark size={28} />} message='No commissions yet — they appear once referred businesses pay.' />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {(rows || []).map(c => (
            <Card key={c.id} style={{ padding: '14px 16px', display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: '800', fontSize: '14px', color: navy }}>{c.type === 'referral_bonus' ? 'Referral bonus' : 'Residual'}</span>
                  <Pill label={c.status} type={c.status === 'paid' ? 'green' : c.status === 'void' ? 'red' : c.status === 'payable' ? 'amber' : 'blue'} />
                </div>
                <div style={{ fontSize: '12px', color: gray500, marginTop: '2px', fontFamily: theme.fontMono }}>{c.agent_id?.slice(0, 8)}·{c.business_id?.toString().slice(0, 8)} · {fmtDate(c.created_at)}</div>
              </div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <span style={{ fontWeight: '900', fontSize: '15px', color: navy }}>{fmt(c.amount)}</span>
                {c.status === 'accrued' && <>
                  <GhostBtn onClick={() => setStatus(c, 'payable')}>Make payable</GhostBtn>
                  <button onClick={() => setStatus(c, 'void')} style={{ padding: '7px 13px', borderRadius: theme.radius.md, border: 'none', background: dangerBg, color: danger, fontWeight: '700', fontSize: '12px', cursor: 'pointer' }}>Void</button>
                </>}
                {c.status === 'payable' && <TealBtn onClick={() => setStatus(c, 'paid')} style={{ minHeight: 40, padding: '7px 13px', fontSize: 12 }}>Mark paid</TealBtn>}
              </div>
            </Card>
          ))}
        </div>
      )}
      <Toast msg={msg} type={type} />
    </div>
  )
}

// ── 4. PAYOUTS (manual batch runs) ───────────────────────────────────────────
export function PayoutsPanel() {
  const { msg, type, show: showToast } = useToast()
  const payouts = useApi(getPayouts)
  const commissions = useApi(getCommissionsLedger)
  const agents = useApi(getAgents)
  const [runFor, setRunFor] = useState('')
  const [method, setMethod] = useState('bank_transfer')
  const [makePayout, setMakePayout] = useState(false)

  const payable = (commissions.data || []).filter(c => c.status === 'payable' || c.status === 'accrued')
  const agentName = id => (agents.data || []).find(a => a.id === id)?.name || '—'
  const runAmount = payable.filter(c => c.agent_id === runFor).reduce((s, c) => s + Number(c.amount || 0), 0)

  const savePayout = async () => {
    if (!runFor) { showToast('Select an agent.', { type: 'warning' }); return }
    const ids = payable.filter(c => c.agent_id === runFor).map(c => c.id)
    if (!ids.length) { showToast('That agent has nothing payable.', { type: 'warning' }); return }
    try {
      const rows = await createPayout({ agent_id: runFor, commission_ids: ids, total_amount: runAmount, method, status: 'pending', notes: null })
      const payout = Array.isArray(rows) ? rows[0] : rows
      for (const id of ids) await updateCommission(id, { status: 'paid' })
      showToast(payout?.id ? 'Payout created — commissions marked paid.' : 'Payout created.', { type: 'success' })
      setMakePayout(false); setRunFor(''); commissions.reload(); payouts.reload()
    } catch (e) {
      showToast('Payout failed: ' + e.message, { type: 'error' })
    }
  }

  const setPayout = async (p, status) => {
    try {
      await updatePayout(p.id, { status, processed_at: status === 'processed' ? new Date().toISOString() : p.processed_at })
      showToast('Payout ' + status + '.', { type: 'success' })
    } catch (e) {
      showToast('Update failed: ' + e.message, { type: 'error' })
    }
    payouts.reload()
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '14px', gap: 8 }}>
        <GhostBtn onClick={() => { payouts.reload(); commissions.reload(); agents.reload() }}><RefreshCw size={13} style={{ marginRight: 6 }} /> Refresh</GhostBtn>
        <TealBtn onClick={() => setMakePayout(true)}>+ New payout run</TealBtn>
      </div>

      {payouts.loading ? <Loading /> : payouts.error ? <ErrorState onRetry={payouts.reload} message={payouts.error} /> : !payouts.data.length ? (
        <Empty icon={<Landmark size={28} />} message='No payout runs yet. Create one to batch an agent’s commissions.' />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {(payouts.data || []).map(p => (
            <Card key={p.id} style={{ padding: '14px 16px', display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: '800', fontSize: '14px', color: navy }}>Payout — {agentName(p.agent_id)}</div>
                <div style={{ fontSize: '12px', color: gray500, marginTop: '2px' }}>{fmtDate(p.created_at)} · {p.method || 'bank transfer'} · {(p.commission_ids || []).length} commissions</div>
              </div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <span style={{ fontWeight: '900', fontSize: '15px', color: navy }}>{fmt(p.total_amount)}</span>
                <Pill label={p.status} type={p.status === 'processed' ? 'green' : p.status === 'failed' ? 'red' : 'amber'} />
                {p.status === 'pending' && <TealBtn onClick={() => setPayout(p, 'processed')} style={{ minHeight: 40, padding: '7px 13px', fontSize: 12 }}>Mark processed</TealBtn>}
                {p.status === 'pending' && <GhostBtn onClick={() => setPayout(p, 'failed')}>Mark failed</GhostBtn>}
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal show={makePayout} onClose={() => setMakePayout(false)} sheet title='New payout run'
        footer={
          <>
            <GhostBtn onClick={() => setMakePayout(false)} style={{ flex: 1, padding: '13px' }}>Cancel</GhostBtn>
            <TealBtn onClick={savePayout} style={{ flex: 1, padding: '13px' }} disabled={!(runFor && runAmount > 0)}>Create {runFor ? fmt(runAmount) : ''}</TealBtn>
          </>
        }>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <Sel label='Agent' value={runFor} onChange={setRunFor} placeholder='Select an agent' options={(agents.data || []).map(a => ({ value: a.id, label: a.name + ' — ' + a.city + ' / ' + a.area }))} />
          <Sel label='Method' value={method} onChange={setMethod} options={['bank_transfer', 'mobile_money', 'wallet', 'other']} />
          <div>
            <div style={{ fontSize: '11px', fontWeight: '700', color: gray500, marginBottom: '6px' }}>Payable amount for this agent</div>
            <div style={{ fontSize: '20px', fontWeight: '900', color: tealDeep }}>{fmt(runAmount)}</div>
          </div>
        </div>
      </Modal>
      <Toast msg={msg} type={type} />
    </div>
  )
}

// ── 5. COVERAGE (area map: assigned agents + pending applications) ───────────
export function CoveragePanel() {
  const { msg, type, show: showToast } = useToast()
  const agents = useApi(getAgents)
  const apps = useApi(getAgentApplications)

  const all = (agents.data || []).filter(a => a.status === 'active' || a.status === 'approved_pending_onboarding' || a.status === 'suspended')
  const cities = {}
  all.forEach(a => {
    if (!cities[a.city]) cities[a.city] = {}
    cities[a.city][a.area] = a
  })
  const citiesList = Object.keys(cities).sort()

  const pendingAreas = (apps.data || []).filter(a => a.status === 'submitted' || a.status === 'under_review').map(a => ({ city: a.requested_city, area: a.requested_area }))

  const mark = async (a, patch, ok) => {
    try {
      await updateAgentRow(a.id, patch)
      showToast(ok, { type: 'success' })
    } catch (e) {
      showToast('Update failed: ' + e.message, { type: 'error' })
    }
    agents.reload()
  }

  return (
    <div>
      {agents.loading ? <Loading /> : agents.error ? <ErrorState onRetry={agents.reload} message={agents.error} /> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {citiesList.length === 0 && <Empty icon={<MapPin size={28} />} message='No agents yet — coverage opens once you approve applications.' />}

          {citiesList.map(city => (
            <Card key={city} style={{ padding: '16px' }}>
              <div style={{ fontWeight: '800', fontSize: '15px', color: navy, marginBottom: '10px' }}>📍 {city}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(230px,1fr))', gap: '10px' }}>
                {Object.keys(cities[city]).sort().map(area => {
                  const ag = cities[city][area]
                  const pending = pendingAreas.filter(p => p.area === area && p.city === city).length
                  return (
                    <div key={area} style={{ padding: '12px', borderRadius: theme.radius.md, border: `1px solid ${ag.status === 'suspended' ? theme.amberBorder : theme.border}`, background: ag.status === 'active' ? theme.successBg : theme.gray50 }}>
                      <div style={{ fontSize: '13px', fontWeight: '700', color: navy }}>{area}
                        {pending > 0 && <span style={{ marginLeft: 6, fontSize: '11px', fontWeight: '700', color: theme.amberText }}>· {pending} application{pending > 1 ? 's' : ''}</span>}
                      </div>
                      <div style={{ fontSize: '12px', color: gray500, marginTop: '2px' }}>{ag.name}</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '8px', flexWrap: 'wrap' }}>
                        <Pill {...STATUS_PILL(ag.status)} />
                        {ag.status === 'approved_pending_onboarding' && <GhostBtn onClick={() => mark(ag, { status: 'active', onboarding_completed_at: new Date().toISOString() }, 'Agent is now active.')} style={{ fontSize: 11, padding: '5px 10px' }}>Activate</GhostBtn>}
                        {ag.status === 'active' && <GhostBtn onClick={() => mark(ag, { status: 'suspended' }, 'Agent suspended.')} style={{ fontSize: 11, padding: '5px 10px' }}>Suspend</GhostBtn>}
                      </div>
                    </div>
                  )
                })}
              </div>
            </Card>
          ))}
        </div>
      )}
      <Toast msg={msg} type={type} />
    </div>
  )
}