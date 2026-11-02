import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, FileSpreadsheet, Check, X } from 'lucide-react'
import { theme } from '../../styles/theme'
import { SectionHead, Card, Pill, Loading, Empty, ErrorState, Modal, Sel, Inp, GhostBtn, TealBtn, useToast, Toast } from '../../components/ui'
import { representativesRepository } from './repositories'
import { MODELS, defaultPeriod, validPeriod, money, positionText, entryTypeLabel, repLedgerError } from './services/ledger'
import { exportSummaryXlsx } from './services/statementExport'
import RecordEntryModal from './RecordEntryModal'
import RepStatement from './RepStatement'

const { navy, gray500, gray600, border, danger, tealDeep } = theme
const log = (what, e) => console.error(`[representatives] ${what}:`, e)
const TABS = [['reps', 'Representatives'], ['pending', 'Awaiting approval'], ['summary', 'Consolidated summary']]
const ACTIONS = [['supply', 'Supply'], ['payment', 'Payment'], ['return', 'Return'], ['transfer', 'Transfer'], ['adjustment', 'Adjustment']]

// The company's view of its representatives' accounts (Centralised and Decentralised alike). Who may open it is
// decided by permissions.js (Owner, or a role with "Manage" or "View representative accounts"); the database checks
// every read and write again.
export default function Representatives({ brand, role, perms, accountProfile }) {
  const { msg, type, actionLabel, onAction, show: showToast } = useToast()
  const companyId = brand?.id
  const canManage = role === 'Owner' || !!perms?.canManageRepLedger
  const model = accountProfile?.operating_model || 'centralised'

  const [tab, setTab] = useState('reps')
  const [state, setState] = useState({ status: 'loading', reps: [], available: true, balances: {} })
  const [statementRep, setStatementRep] = useState(null)
  const [entry, setEntry] = useState(null) // { kind, repId }
  const [adding, setAdding] = useState(false)

  const load = useCallback(async () => {
    if (!companyId) return
    setState((s) => ({ ...s, status: 'loading' }))
    try {
      const r = await representativesRepository.list(companyId)
      let balances = {}
      if (r.available && r.representatives.length) {
        const p = defaultPeriod()
        const s = await representativesRepository.summary(companyId, p.from, p.to)
        balances = Object.fromEntries((s?.representatives || []).map((x) => [x.id, x]))
      }
      setState({ status: 'ready', reps: r.representatives, available: r.available, balances })
    } catch (e) {
      log('load', e)
      setState((s) => ({ ...s, status: 'error' }))
    }
  }, [companyId])
  useEffect(() => { load() }, [load])

  if (statementRep) {
    return (
      <div>
        <RepStatement repId={statementRep.id} title={`${statementRep.full_name} · statement`} onBack={() => { setStatementRep(null); load() }}
          canManage={canManage} showToast={showToast} />
        <Toast msg={msg} type={type} actionLabel={actionLabel} onAction={onAction} />
      </div>
    )
  }

  const done = (r, label) => {
    setEntry(null)
    showToast(`${label} recorded${r?.entry_no ? ` (${r.entry_no})` : ''}${r?.status === 'pending' ? '. It is waiting for approval.' : '.'}`, { type: 'success' })
    load()
  }

  return (
    <div>
      <SectionHead title='Representatives' sub={`${MODELS[model].label} operation · ${MODELS[model].short}`}
        btn={canManage ? 'Add representative' : undefined} onBtn={() => setAdding(true)} />

      <div role='tablist' aria-label='Representative views' style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        {TABS.map(([id, label]) => (
          <button key={id} type='button' role='tab' aria-selected={tab === id} onClick={() => setTab(id)}
            style={{ padding: '8px 14px', minHeight: 40, borderRadius: theme.radius.full, border: `1px solid ${tab === id ? tealDeep : border}`,
              background: tab === id ? tealDeep : 'white', color: tab === id ? 'white' : navy, fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>{label}</button>
        ))}
      </div>

      {state.status === 'loading' && <Loading text='Loading representatives…' />}
      {state.status === 'error' && <ErrorState message="We couldn't load your representatives." onRetry={load} />}
      {state.status === 'ready' && !state.available && (
        <Empty title='Not available yet' description='Representative accounts need a database update that has not been applied yet.' />
      )}
      {state.status === 'ready' && state.available && tab === 'reps' && (
        state.reps.length === 0
          ? <Empty title='No representatives yet' description={canManage ? 'Invite your representatives on the Staff page, then add them here.' : 'Your company has not added any representatives.'}
              action={canManage ? 'Add representative' : undefined} onAction={() => setAdding(true)} />
          : (
            <div style={{ display: 'grid', gap: 12 }}>
              {state.reps.map((r) => {
                const b = state.balances[r.id]
                return (
                  <Card key={r.id} style={{ padding: 16 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                      <div>
                        <div style={{ fontWeight: 700, color: navy, fontSize: '15px' }}>{r.full_name} <span style={{ color: gray500, fontWeight: 500, fontSize: '12px' }}>{r.rep_code}</span></div>
                        <div style={{ fontSize: '12px', color: gray600, marginTop: 4, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <Pill label={r.status === 'active' ? 'Active' : 'Inactive'} type={r.status === 'active' ? 'green' : 'gray'} />
                          {model === 'decentralised' && r.rep_account_id && !r.account_dormant_since && <Pill label='Own account' type='teal' />}
                          {r.account_dormant_since && <Pill label='Account archived' type='gray' />}
                          {b?.pending_count > 0 && <Pill label={`${b.pending_count} awaiting approval`} type='amber' />}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '18px', fontWeight: 800, color: Number(b?.closing_balance) > 0 ? theme.warning : navy }}>{money(b?.closing_balance)}</div>
                        <div style={{ fontSize: '12px', color: gray500 }}>{positionText(b?.closing_balance)}</div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                      <GhostBtn onClick={() => setStatementRep(r)}>Statement</GhostBtn>
                      {canManage && r.status === 'active' && ACTIONS.map(([kind, label]) => (
                        <GhostBtn key={kind} onClick={() => setEntry({ kind, repId: r.id })}>{label}</GhostBtn>
                      ))}
                      {canManage && <StatusToggle rep={r} onChanged={load} showToast={showToast} />}
                    </div>
                  </Card>
                )
              })}
            </div>
          )
      )}
      {state.status === 'ready' && state.available && tab === 'pending' && (
        <PendingApprovals companyId={companyId} canManage={canManage} showToast={showToast} onChanged={load} />
      )}
      {state.status === 'ready' && state.available && tab === 'summary' && (
        <ConsolidatedSummary companyId={companyId} companyName={brand?.name} />
      )}

      <RecordEntryModal show={!!entry} kind={entry?.kind} company={brand} model={model} representatives={state.reps} defaultRepId={entry?.repId}
        canApprove={canManage} onClose={() => setEntry(null)}
        onDone={(r) => done(r, (ACTIONS.find(([k]) => k === entry?.kind) || [null, 'Entry'])[1])} />
      <AddRepresentativeModal show={adding} companyId={companyId} model={model} existing={state.reps} onClose={() => setAdding(false)}
        onDone={(r) => { setAdding(false); showToast(`Representative added (${r?.rep_code || ''}).${r?.rep_account_id ? ' Their own account is ready.' : ''}`, { type: 'success' }); load() }} />
      <Toast msg={msg} type={type} actionLabel={actionLabel} onAction={onAction} />
    </div>
  )
}

function StatusToggle({ rep, onChanged, showToast }) {
  const [busy, setBusy] = useState(false)
  const next = rep.status === 'active' ? 'inactive' : 'active'
  async function toggle() {
    setBusy(true)
    try { await representativesRepository.setStatus(rep.id, next); onChanged() } catch (e) { log('status', e); showToast(repLedgerError(e), { type: 'error' }) }
    setBusy(false)
  }
  return <GhostBtn onClick={toggle} disabled={busy}>{next === 'inactive' ? 'Make inactive' : 'Reactivate'}</GhostBtn>
}

function AddRepresentativeModal({ show, companyId, model, existing, onClose, onDone }) {
  const [staff, setStaff] = useState({ status: 'idle', rows: [] })
  const [staffId, setStaffId] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const existingIds = useMemo(() => (existing || []).map((r) => r.staff_id), [existing])

  useEffect(() => {
    if (!show || !companyId) return
    setStaffId(''); setError(''); setStaff({ status: 'loading', rows: [] })
    representativesRepository.candidateStaff(companyId, existingIds)
      .then((rows) => setStaff({ status: 'ready', rows }))
      .catch((e) => { log('staff', e); setStaff({ status: 'error', rows: [] }) })
  }, [show, companyId, existingIds])

  async function add() {
    if (!staffId) { setError('Choose a staff member.'); return }
    setBusy(true); setError('')
    try { onDone(await representativesRepository.add(companyId, staffId)) } catch (e) { log('add', e); setError(repLedgerError(e)) }
    setBusy(false)
  }

  return (
    <Modal show={show} onClose={onClose} title='Add a representative'
      footer={<><GhostBtn onClick={onClose} style={{ flex: 1, padding: '12px' }}>Cancel</GhostBtn>
        <TealBtn onClick={add} disabled={busy || staff.status !== 'ready'} style={{ flex: 1, padding: '12px' }}><Plus size={14} aria-hidden='true' /> {busy ? 'Adding…' : 'Add'}</TealBtn></>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: '13px', color: gray600 }}>
        <p style={{ margin: 0 }}>Representatives are people you have invited on the Staff page. {model === 'decentralised'
          ? 'Because your company runs Decentralised, they get their own private account (POS, stock, prices and records) as soon as they are added.'
          : 'They keep signing in as staff and sell through the company POS; their account statement starts empty.'}</p>
        {staff.status === 'loading' && <Loading text='Loading staff…' />}
        {staff.status === 'error' && <div role='alert' style={{ color: danger }}>We couldn't load your staff. Close this and try again.</div>}
        {staff.status === 'ready' && (staff.rows.length === 0
          ? <div>Everyone on your staff is already a representative, or you have no staff yet.</div>
          : <Sel id='add-rep-staff' label='Staff member' value={staffId} onChange={setStaffId} placeholder='Choose…'
              options={staff.rows.map((s) => ({ value: s.id, label: `${s.full_name} · ${s.role || 'Staff'}${s.status === 'invited' ? ' (invited)' : ''}` }))} />)}
        {error && <div role='alert' style={{ color: danger }}>{error}</div>}
      </div>
    </Modal>
  )
}

function PendingApprovals({ companyId, canManage, showToast, onChanged }) {
  const [state, setState] = useState({ status: 'loading', rows: [] })
  const [busyId, setBusyId] = useState(null)
  const load = useCallback(async () => {
    setState((s) => ({ ...s, status: 'loading' }))
    try { setState({ status: 'ready', rows: (await representativesRepository.pending(companyId)) || [] }) } catch (e) { log('pending', e); setState({ status: 'error', rows: [] }) }
  }, [companyId])
  useEffect(() => { load() }, [load])

  async function decide(e, decision) {
    setBusyId(e.id)
    try {
      await representativesRepository.decide(e.id, decision)
      showToast(decision === 'approve' ? `${entryTypeLabel(e.entry_type)} ${e.entry_no} approved.` : `${e.entry_no} rejected.`, { type: 'success' })
      load(); onChanged()
    } catch (err) { log('decide', err); showToast(repLedgerError(err), { type: 'error', duration: 8000 }) }
    setBusyId(null)
  }

  if (state.status === 'loading') return <Loading text='Loading…' />
  if (state.status === 'error') return <ErrorState message="We couldn't load the items awaiting approval." onRetry={load} />
  if (state.rows.length === 0) return <Empty title='Nothing awaiting approval' description='Returns and transfers recorded for later approval appear here.' />
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {state.rows.map((e) => {
        const value = (e.rep_ledger_lines || []).reduce((s, l) => s + Number(l.line_value || 0), 0)
        const rep = e.company_representatives
        return (
          <Card key={e.id} style={{ padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontWeight: 700, color: navy }}>{entryTypeLabel(e.entry_type)} · {rep?.full_name} <span style={{ color: gray500, fontWeight: 500, fontSize: '12px' }}>{e.entry_no}</span></div>
                <div style={{ fontSize: '12px', color: gray600, marginTop: 4 }}>{e.description} · {e.entry_date}{e.reason ? ` · ${e.reason}` : ''}</div>
                <div style={{ fontSize: '12px', color: gray600, marginTop: 4 }}>{(e.rep_ledger_lines || []).map((l) => `${l.quantity} × ${l.product_name}`).join(', ')}</div>
              </div>
              <div style={{ fontWeight: 800, color: navy }}>{money(value)}</div>
            </div>
            {canManage && (
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <TealBtn onClick={() => decide(e, 'approve')} disabled={busyId === e.id}><Check size={14} aria-hidden='true' /> Approve</TealBtn>
                <GhostBtn onClick={() => decide(e, 'reject')} disabled={busyId === e.id}><X size={14} aria-hidden='true' /> Reject</GhostBtn>
              </div>
            )}
          </Card>
        )
      })}
    </div>
  )
}

function ConsolidatedSummary({ companyId, companyName }) {
  const [period, setPeriod] = useState(defaultPeriod)
  const [state, setState] = useState({ status: 'loading', summary: null, error: '' })
  const load = useCallback(async () => {
    const problem = validPeriod(period)
    if (problem) { setState({ status: 'invalid', summary: null, error: problem }); return }
    setState((s) => ({ ...s, status: 'loading' }))
    try { setState({ status: 'ready', summary: await representativesRepository.summary(companyId, period.from, period.to), error: '' }) } catch (e) {
      log('summary', e); setState({ status: 'error', summary: null, error: repLedgerError(e, "We couldn't load the summary.") })
    }
  }, [companyId, period])
  useEffect(() => { load() }, [load])
  const s = state.summary
  const cols = [['Opening', 'opening_balance'], ['Supplies', 'supplies'], ['Payments', 'payments'], ['Returns', 'returns'], ['Transfers (net)', 'transfers_net'], ['Adjustments (net)', 'adjustments_net'], ['Closing', 'closing_balance']]

  return (
    <div>
      <Card style={{ padding: 16, marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Inp id='summary-from' label='From' type='date' value={period.from} onChange={(v) => setPeriod((p) => ({ ...p, from: v }))} style={{ width: 170 }} />
          <Inp id='summary-to' label='To' type='date' value={period.to} onChange={(v) => setPeriod((p) => ({ ...p, to: v }))} style={{ width: 170 }} />
          <GhostBtn onClick={() => exportSummaryXlsx(s, companyName).catch((e) => log('summary export', e))} disabled={!s}><FileSpreadsheet size={14} aria-hidden='true' /> Spreadsheet</GhostBtn>
        </div>
      </Card>
      {state.status === 'loading' && <Loading text='Loading summary…' />}
      {state.status === 'invalid' && <div role='alert' style={{ color: danger, fontSize: '13px' }}>{state.error}</div>}
      {state.status === 'error' && <ErrorState message={state.error} onRetry={load} />}
      {state.status === 'ready' && s && (s.representatives.length === 0
        ? <Empty title='No representatives yet' />
        : (
          <Card style={{ padding: 0, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', minWidth: 760 }}>
              <caption style={{ textAlign: 'left', padding: '12px 16px', fontWeight: 700, color: navy }}>Balances by representative, {s.period.from} to {s.period.to}</caption>
              <thead><tr style={{ background: theme.bg }}>
                <th scope='col' style={{ textAlign: 'left', padding: '10px 12px', color: gray600 }}>Representative</th>
                {cols.map(([h]) => <th key={h} scope='col' style={{ textAlign: 'right', padding: '10px 12px', color: gray600 }}>{h}</th>)}
              </tr></thead>
              <tbody>
                {s.representatives.map((r) => (
                  <tr key={r.id} style={{ borderTop: `1px solid ${border}` }}>
                    <th scope='row' style={{ textAlign: 'left', padding: '10px 12px', color: navy }}>{r.full_name} <span style={{ color: gray500, fontWeight: 500 }}>{r.rep_code}</span></th>
                    {cols.map(([h, k]) => <td key={h} style={{ textAlign: 'right', padding: '10px 12px', whiteSpace: 'nowrap', fontWeight: k === 'closing_balance' ? 700 : 400 }}>{money(r[k])}</td>)}
                  </tr>
                ))}
                <tr style={{ borderTop: `2px solid ${border}`, fontWeight: 700 }}>
                  <th scope='row' style={{ textAlign: 'left', padding: '10px 12px', color: navy }}>Total</th>
                  {cols.map(([h, k]) => <td key={h} style={{ textAlign: 'right', padding: '10px 12px', whiteSpace: 'nowrap' }}>{money(s.totals[k])}</td>)}
                </tr>
              </tbody>
            </table>
          </Card>
        ))}
    </div>
  )
}
