import { useState, useEffect, useCallback, useMemo } from 'react'
import { Search, RefreshCw, Calendar, Download, ChevronRight, History, AlertTriangle } from 'lucide-react'
import { Card, GhostBtn, TealBtn, Sel, Inp, Textarea, Pill, Loading, Empty, ErrorState, ConfirmDialog, useToast, Toast } from '../../../components/ui'
import Sheet from '../../../components/ui/Sheet'
import { useBreakpoint } from '../../../hooks/useBreakpoint'
import { createMoneyRepository } from '../../../modules/money/repositories'
import {
  PLAN_OPTIONS, ACTIONS, GRANT_TYPES, DURATION_PRESETS, STATE_META, planLabel, stateLabel, accessLabel, paymentStatus,
  daysLeft, availableActions, emptyForm, validateForm, buildRequest, previewExpiry, readableError, summarize, filterRows,
  describeHistory, SUBSCRIPTION_EXPORT_COLUMNS, HISTORY_EXPORT_COLUMNS,
} from '../../../modules/money/services/subscriptionAdmin'
import { toCsv, downloadCsv, exportStamp, fileSlug } from '../../../lib/carefindhubExports'
import { fmt, fmtDate } from '../../../lib/utils'
import RecordFields from '../shared/RecordFields'
import { useAuditedExport } from '../shared/AuditedExport'

// Money > Subscriptions: every business's plan, payment status and dates, with the administrative controls
// (change plan, free/complimentary access, extend, set expiry, suspend, activate) and the full history.
// Reads and writes go through admin_subscription_overview / _history / admin_manage_subscription
// (carehub_20261230_admin_subscription_management), which are platform-admin only and audited. The automated
// Paystack/wallet renewals are not touched: an admin grant never records a payment.

const PAGE_SIZE = 20
const fmtDay = (d) => (d ? new Date(d).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' }) : 'No expiry')
const toneColor = { green: 'var(--green)', amber: 'var(--amber)', red: 'var(--red)', blue: 'var(--teal)', gray: 'var(--muted)' }

function StateBadge({ row }) {
  if (row.suspended) return <Pill label="Suspended" type="red" />
  const meta = STATE_META[row.plan_state] || { label: row.plan_state, tone: 'gray' }
  return <Pill label={meta.label} type={meta.tone} />
}

function DaysLeft({ row }) {
  const d = daysLeft(row.expires_at)
  if (d == null) return <span>No expiry</span>
  if (d < 0) return <span style={{ color: 'var(--red)' }}>{-d} day{d === -1 ? '' : 's'} ago</span>
  return <span style={{ color: d <= 14 ? 'var(--amber)' : undefined }}>{d} day{d === 1 ? '' : 's'} left</span>
}

function SummaryChip({ label, value, active, onClick, tone }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      style={{ textAlign: 'left', padding: '10px 12px', borderRadius: 10, border: active ? '1px solid var(--teal)' : '1px solid var(--border)', background: active ? 'var(--teal-mist)' : 'var(--panel)', cursor: 'pointer', minWidth: 0 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 900, color: tone ? toneColor[tone] : 'var(--fg)', marginTop: 2 }}>{value}</div>
    </button>
  )
}

// ── Change form ──────────────────────────────────────────────────────────────
function ChangeForm({ row, repository, onSaved, showToast }) {
  const actions = availableActions(row)
  const [form, setForm] = useState(() => emptyForm(actions[0], row))
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const set = (patch) => { setForm(f => ({ ...f, ...patch })); setError('') }

  useEffect(() => { setForm(emptyForm(availableActions(row)[0], row)); setError('') }, [row.business_id, row.suspended])

  const preview = previewExpiry(form, row)
  const review = () => {
    const problem = validateForm(form, row)
    if (problem) { setError(problem); return }
    setConfirming(true)
  }
  const apply = async () => {
    setBusy(true)
    try {
      const result = await repository.manageSubscription(buildRequest(form, row))
      setConfirming(false)
      showToast(`${ACTIONS[form.action].label}: saved for ${row.name}.`, { type: 'success' })
      setForm(emptyForm(availableActions(row)[0], row))
      onSaved(result)
    } catch (e) {
      console.error('[admin-subscriptions] change refused', form.action, e)
      setConfirming(false)
      setError(readableError(e))
    }
    setBusy(false)
  }

  const summary = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div><b>{ACTIONS[form.action].label}</b> for <b>{row.name}</b>.</div>
      {form.action === 'change_plan' && <div>{planLabel(row.plan)} → {planLabel(form.plan)}. The expiry date stays {fmtDay(row.expires_at)}.</div>}
      {form.action === 'grant' && <div>{GRANT_TYPES.find(g => g.value === form.grantType)?.label} access{form.plan ? ` on ${planLabel(form.plan)}` : ''}. No payment or receipt is recorded.</div>}
      {preview && <div>New expiry: <b>{fmtDay(preview)}</b> (now {fmtDay(row.expires_at)}).</div>}
      {form.action === 'suspend' && <div>Restricted mode starts now. The time left is given back on activation.</div>}
      {form.action === 'activate' && <div>The time that was left when it was suspended is given back from today.</div>}
      <div style={{ color: 'var(--muted)' }}>Reason: “{form.reason.trim()}”. Recorded with your name in the subscription history and the audit log.</div>
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div role="radiogroup" aria-label="Change to make" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {actions.map(a => (
          <button key={a} type="button" role="radio" aria-checked={form.action === a} onClick={() => set(emptyForm(a, row))}
            style={{ padding: '7px 11px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', border: form.action === a ? '1px solid var(--teal)' : '1px solid var(--border)', background: form.action === a ? 'var(--teal-mist)' : 'var(--panel)', color: form.action === a ? 'var(--teal)' : 'var(--muted)' }}>
            {ACTIONS[a].label}
          </button>
        ))}
      </div>
      <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>{ACTIONS[form.action].help}</div>

      {(form.action === 'change_plan' || form.action === 'grant') && (
        <Sel id="sub-plan" label={form.action === 'grant' ? 'Plan (optional — keep current if empty)' : 'New plan'} value={form.plan} onChange={v => set({ plan: v })}
          placeholder={form.action === 'grant' ? `Keep ${planLabel(row.plan)}` : 'Choose a plan'}
          options={PLAN_OPTIONS.filter(p => form.action === 'grant' || p.value !== row.plan)} />
      )}
      {form.action === 'grant' && (
        <Sel id="sub-grant-type" label="Kind of access" value={form.grantType} onChange={v => set({ grantType: v })} options={GRANT_TYPES} placeholder="Choose" />
      )}
      {(form.action === 'grant' || form.action === 'extend') && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Sel id="sub-duration" label="How long" value={form.duration} onChange={v => set({ duration: v })} options={DURATION_PRESETS.map(p => ({ value: p.value, label: p.label }))} placeholder="Choose" style={{ flex: '1 1 160px' }} />
          {form.duration === 'days' && <Inp id="sub-days" label="Days" type="number" min="1" value={form.days} onChange={v => set({ days: v })} style={{ flex: '1 1 120px' }} />}
        </div>
      )}
      {form.action === 'set_expiry' && (
        <Inp id="sub-expires-on" label="New expiry date" type="date" value={form.expiresOn} onChange={v => set({ expiresOn: v })} helperText="Access runs to the end of this day (Lagos time)." />
      )}
      {preview && <div style={{ fontSize: 12, color: 'var(--fg)' }}>New expiry will be <b>{fmtDay(preview)}</b>.</div>}

      <Textarea id="sub-reason" label="Reason" required rows={2} value={form.reason} onChange={v => set({ reason: v })}
        placeholder="e.g. Partnership with Lagos State PHC board; 6-month promotion for early adopters" />
      {error && <div role="alert" style={{ display: 'flex', gap: 6, alignItems: 'flex-start', fontSize: 12, color: 'var(--red)', fontWeight: 600 }}><AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} aria-hidden="true" />{error}</div>}
      <TealBtn onClick={review} disabled={busy}>Review change</TealBtn>

      <ConfirmDialog show={confirming} title={`${ACTIONS[form.action].label}?`} onClose={() => !busy && setConfirming(false)} onConfirm={apply}
        danger={form.action === 'suspend'} confirmLabel={busy ? 'Saving…' : `Confirm ${ACTIONS[form.action].label.toLowerCase()}`} consequence={summary} />
    </div>
  )
}

// ── Detail sheet ─────────────────────────────────────────────────────────────
function SubscriptionDetail({ row, repository, onClose, onChanged, requestExport, showToast }) {
  const [history, setHistory] = useState(null)
  const [historyError, setHistoryError] = useState('')

  const loadHistory = useCallback(async () => {
    if (!row) return
    setHistory(null); setHistoryError('')
    try { setHistory((await repository.getSubscriptionHistory(row.business_id)) || []) } catch (e) { setHistoryError(readableError(e)) }
  }, [repository, row?.business_id])
  useEffect(() => { loadHistory() }, [loadHistory])

  if (!row) return null
  const pay = paymentStatus(row)
  const sections = [
    { title: 'Subscription', fields: [
      ['Plan', planLabel(row.plan)],
      ['State', row.suspended ? 'Suspended' : stateLabel(row.plan_state)],
      ['Payment status', pay.label],
      ['How access was obtained', accessLabel(row.access_type)],
      ['Current period start', row.period_start],
      ['Expiry date', row.expires_at ? fmtDay(row.expires_at) : 'No expiry'],
      ['Days left', daysLeft(row.expires_at)],
      ['Grace period ends', row.grace_ends_at],
    ] },
    { title: 'Payments', fields: [
      ['Payments made', row.payment_count],
      ['Total paid', fmt(row.total_paid)],
      ['Last payment', row.last_payment_at],
      ['Last payment amount', row.last_payment_amount != null ? fmt(row.last_payment_amount) : null],
      ['Last payment method', row.last_payment_method],
      ['Months bought last time', row.last_payment_months],
    ] },
    { title: 'Business', fields: [
      ['Owner', row.owner_name], ['Email', row.email], ['Phone', row.phone],
      ['Location', [row.city, row.state].filter(Boolean).join(', ')], ['Type', row.business_type],
      ['Business status', row.status], ['Branches', row.branch_count], ['Customer since', row.created_at], ['Business ID', row.business_id],
    ] },
  ]

  const exportHistory = () => requestExport({
    exportType: 'admin.subscription_history.csv', label: `subscription history — ${row.name}`, rowCount: (history || []).length,
    run: () => downloadCsv(`subscription_history_${fileSlug(row.name)}_${exportStamp()}.csv`, toCsv(HISTORY_EXPORT_COLUMNS, history || [])),
  })

  return (
    <Sheet show onClose={onClose} title={row.name}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <StateBadge row={row} />
          <Pill label={planLabel(row.plan)} type="teal" />
          <Pill label={pay.label} type={pay.tone} />
        </div>
        <RecordFields sections={sections} />

        <section aria-label="Manage subscription" style={{ borderTop: '1px solid var(--hairline)', paddingTop: 16 }}>
          <h3 style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 800, color: 'var(--fg)' }}>Manage subscription</h3>
          <ChangeForm row={row} repository={repository} showToast={showToast} onSaved={() => { onChanged(); loadHistory() }} />
        </section>

        <section aria-label="Subscription history" style={{ borderTop: '1px solid var(--hairline)', paddingTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            <h3 style={{ margin: 0, fontSize: 13, fontWeight: 800, color: 'var(--fg)', display: 'flex', alignItems: 'center', gap: 6 }}><History size={14} aria-hidden="true" /> History</h3>
            <GhostBtn onClick={exportHistory} disabled={!history || history.length === 0}><Download size={12} style={{ marginRight: 6 }} aria-hidden="true" />Export history</GhostBtn>
          </div>
          {historyError ? <ErrorState message={historyError} onRetry={loadHistory} />
            : history == null ? <Loading text="Loading history…" />
            : history.length === 0 ? <div style={{ fontSize: 13, color: 'var(--muted)', padding: 12, textAlign: 'center', border: '1px dashed var(--border)', borderRadius: 10 }}>No payments or administrative changes yet.</div>
            : (
              <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {history.map((h, i) => (
                  <li key={`${h.kind}-${h.occurred_at}-${i}`} style={{ padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--panel)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--fg)' }}>{describeHistory(h)}</span>
                      {h.kind === 'payment' && h.amount != null && <span style={{ fontWeight: 800, fontSize: 13, color: 'var(--green)', fontFamily: 'var(--font-mono)' }}>{fmt(h.amount)}</span>}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, lineHeight: 1.5 }}>
                      {new Date(h.occurred_at).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' })}
                      {h.expires_after && ` · ${h.kind === 'payment' ? 'period to' : 'expiry'} ${fmtDay(h.expires_after)}`}
                      {h.receipt_number && ` · receipt ${h.receipt_number}`}
                      {h.actor_email && ` · by ${h.actor_email}`}
                    </div>
                    {h.reason && <div style={{ fontSize: 12, color: 'var(--fg)', marginTop: 4 }}>“{h.reason}”</div>}
                  </li>
                ))}
              </ol>
            )}
        </section>
      </div>
    </Sheet>
  )
}

// ── Screen ───────────────────────────────────────────────────────────────────
export default function Subscriptions({ repository: injected }) {
  const repository = useMemo(() => injected || createMoneyRepository(), [injected])
  const [rows, setRows] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filters, setFilters] = useState({ search: '', state: '', plan: '', access: '' })
  const [page, setPage] = useState(1)
  const [selectedId, setSelectedId] = useState(null)
  const { msg, type, show: showToast } = useToast()
  const { requestExport, exportDialog } = useAuditedExport({ onExported: (s) => showToast(`Exported ${s.rowCount} ${s.rowCount === 1 ? 'record' : 'records'}.`, { type: 'info' }) })
  const { isMobile } = useBreakpoint()

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const data = await repository.getSubscriptionOverview()
      setRows(Array.isArray(data) ? data : [])
    } catch (e) {
      console.error('[admin-subscriptions] overview failed', e)
      setError(readableError(e))
    }
    setLoading(false)
  }, [repository])
  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(1) }, [filters])

  const setFilter = (patch) => setFilters(f => ({ ...f, ...patch }))
  const filtered = useMemo(() => filterRows(rows, filters), [rows, filters])
  const totals = useMemo(() => summarize(rows), [rows])
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const selected = (rows || []).find(r => r.business_id === selectedId) || null

  const exportList = () => requestExport({
    exportType: 'admin.subscriptions.csv', label: 'subscriptions', rowCount: filtered.length,
    run: () => downloadCsv(`subscriptions_${exportStamp()}.csv`, toCsv(SUBSCRIPTION_EXPORT_COLUMNS, filtered)),
  })

  if (loading && rows == null) return <Loading text="Loading subscriptions…" />
  if (error && rows == null) return <ErrorState message={error} onRetry={load} />

  const stateFilterChip = (state) => () => setFilter({ state: filters.state === state ? '' : state, access: '' })
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8 }}>
        <SummaryChip label="All" value={totals.total} active={!filters.state && !filters.access} onClick={() => setFilter({ state: '', access: '' })} />
        <SummaryChip label="Active" value={totals.active} tone="green" active={filters.state === 'active'} onClick={stateFilterChip('active')} />
        <SummaryChip label="Expiring ≤14d" value={totals.expiring} tone="amber" active={filters.state === 'expiring'} onClick={stateFilterChip('expiring')} />
        <SummaryChip label="Grace" value={(rows || []).filter(r => r.plan_state === 'grace' && !r.suspended).length} tone="amber" active={filters.state === 'grace'} onClick={stateFilterChip('grace')} />
        <SummaryChip label="Restricted" value={(rows || []).filter(r => r.plan_state === 'restricted' && !r.suspended).length} tone="red" active={filters.state === 'restricted'} onClick={stateFilterChip('restricted')} />
        <SummaryChip label="Complimentary" value={totals.complimentary} tone="blue" active={filters.access === 'complimentary'} onClick={() => setFilter({ access: filters.access === 'complimentary' ? '' : 'complimentary', state: '' })} />
        <SummaryChip label="Suspended" value={totals.suspended} tone="red" active={filters.state === 'suspended'} onClick={stateFilterChip('suspended')} />
      </div>

      <Card style={{ padding: 12, background: 'var(--panel)', border: '1px solid var(--border)', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', flex: '1 1 480px' }}>
          <div style={{ position: 'relative', flex: '1 1 220px' }}>
            <Search size={14} aria-hidden="true" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }} />
            <input value={filters.search} onChange={e => setFilter({ search: e.target.value })} placeholder="Search business, owner, email, phone" aria-label="Search subscriptions"
              style={{ width: '100%', padding: '9px 12px 9px 30px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--panel)', color: 'var(--fg)', fontSize: 13, boxSizing: 'border-box' }} />
          </div>
          <Sel aria-label="Filter by plan" value={filters.plan} onChange={v => setFilter({ plan: v })} placeholder="All plans" options={[...PLAN_OPTIONS, { value: 'hospital', label: 'Hospital (legacy)' }]} style={{ flex: '1 1 140px' }} />
          <Sel aria-label="Filter by access" value={filters.access} onChange={v => setFilter({ access: v, state: v ? '' : filters.state })} placeholder="Any access" style={{ flex: '1 1 160px' }}
            options={[{ value: 'paid', label: 'Paid' }, { value: 'complimentary', label: 'Any free / complimentary' }, ...GRANT_TYPES, { value: 'admin', label: 'Set by admin' }, { value: 'none', label: 'Never paid' }]} />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <GhostBtn onClick={load} disabled={loading}><RefreshCw size={12} style={{ marginRight: 6 }} aria-hidden="true" />Refresh</GhostBtn>
          <GhostBtn onClick={exportList} disabled={filtered.length === 0}><Download size={12} style={{ marginRight: 6 }} aria-hidden="true" />Export</GhostBtn>
        </div>
      </Card>
      {error && <div role="alert" style={{ fontSize: 12, color: 'var(--red)' }}>{error}</div>}
      <div style={{ fontSize: 12, color: 'var(--muted)' }} aria-live="polite">{filtered.length} of {totals.total} businesses · page {page} of {totalPages}</div>

      {filtered.length === 0 ? (
        <Card style={{ padding: 32, background: 'var(--panel)', border: '1px solid var(--border)', textAlign: 'center' }}>
          <Empty icon={<Calendar size={24} />} message={rows.length ? 'No subscriptions match these filters.' : 'No businesses yet. Subscriptions appear here once businesses register.'} />
        </Card>
      ) : isMobile ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {pageRows.map(r => {
            const pay = paymentStatus(r)
            return (
              <button key={r.business_id} type="button" onClick={() => setSelectedId(r.business_id)} aria-label={`Open subscription for ${r.name}`}
                style={{ textAlign: 'left', padding: 14, borderRadius: 12, border: '1px solid var(--border)', background: 'var(--panel)', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 6, width: '100%' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontWeight: 800, fontSize: 14, color: 'var(--fg)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
                  <StateBadge row={r} />
                </div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>{planLabel(r.plan)} · <span style={{ color: toneColor[pay.tone] }}>{pay.label}</span></div>
                <div style={{ fontSize: 12, color: 'var(--muted)', display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span>Expires {fmtDay(r.expires_at)}</span><DaysLeft row={r} />
                </div>
              </button>
            )
          })}
        </div>
      ) : (
        <Card style={{ padding: 0, overflow: 'hidden', background: 'var(--panel)', border: '1px solid var(--border)' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <caption className="sr-only">Subscriptions. Select a business to see details, manage its subscription and view its history.</caption>
              <thead style={{ borderBottom: '1px solid var(--border)' }}>
                <tr style={{ height: 36 }}>
                  {['Business', 'Plan', 'State', 'Payment status', 'Period start', 'Expiry', ''].map(h => (
                    <th key={h || 'open'} scope="col" style={{ padding: '0 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h || <span className="sr-only">Open</span>}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pageRows.map(r => {
                  const pay = paymentStatus(r)
                  return (
                    <tr key={r.business_id} onClick={() => setSelectedId(r.business_id)} className="ds-data-row" style={{ borderBottom: '1px solid var(--hairline)', cursor: 'pointer' }}>
                      <td style={{ padding: '8px 12px' }}>
                        <button type="button" onClick={(e) => { e.stopPropagation(); setSelectedId(r.business_id) }} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', color: 'var(--fg)', fontWeight: 700, fontSize: 13 }}>{r.name}</button>
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>{r.owner_name || r.email || ''}</div>
                      </td>
                      <td style={{ padding: '0 12px', fontWeight: 700, whiteSpace: 'nowrap' }}>{planLabel(r.plan)}</td>
                      <td style={{ padding: '0 12px' }}><StateBadge row={r} /></td>
                      <td style={{ padding: '0 12px', fontSize: 12, fontWeight: 700, color: toneColor[pay.tone], whiteSpace: 'nowrap' }}>{pay.label}</td>
                      <td style={{ padding: '0 12px', fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{r.period_start ? fmtDate(r.period_start) : '—'}</td>
                      <td style={{ padding: '0 12px', fontSize: 12, whiteSpace: 'nowrap' }}><div>{fmtDay(r.expires_at)}</div><div style={{ fontSize: 11, color: 'var(--muted)' }}><DaysLeft row={r} /></div></td>
                      <td style={{ padding: '0 12px', color: 'var(--muted)' }} aria-hidden="true"><ChevronRight size={14} /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {filtered.length > PAGE_SIZE && (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', alignItems: 'center' }}>
          <GhostBtn onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}>Prev</GhostBtn>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>Page {page} of {totalPages}</span>
          <GhostBtn onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>Next</GhostBtn>
        </div>
      )}

      <div style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'center', lineHeight: 1.5 }}>
        Payments renew automatically through Paystack and the wallet. Changes made here are recorded with your name and reason, and never create a payment or receipt.
      </div>

      <SubscriptionDetail row={selected} repository={repository} onClose={() => setSelectedId(null)} onChanged={load} requestExport={requestExport} showToast={showToast} />
      {exportDialog}
      <Toast msg={msg} type={type} />
    </div>
  )
}
