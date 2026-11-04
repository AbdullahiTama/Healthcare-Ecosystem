import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Info } from 'lucide-react'
import { theme } from '../../styles/theme'
import { Card, Loading, ErrorState, Modal, Inp, GhostBtn, TealBtn } from '../../components/ui'
import { representativesRepository } from './repositories'
import { MODELS, money, stockPlan, repLedgerError } from './services/ledger'
import { businessDateTime } from '../../lib/businessDay'

const { navy, gray500, gray600, border, danger, tealDeep, tealMist, warning } = theme
const log = (what, e) => console.error(`[operating-model] ${what}:`, e)

// Settings > Operating model (importers and manufacturers, the company's own account, Owner only). The change is a
// two-step: the database builds a migration summary (representatives, balances, stock, pending items, blockers);
// the owner reviews it and confirms; the database refuses the switch if anything changed since the summary, and runs
// it in one transaction. Every shared module stays available under both models: only the structure changes.
export default function OperatingModelSettings({ brand, onChanged }) {
  const [state, setState] = useState({ status: 'loading', profile: null, changes: [], available: true })
  const [target, setTarget] = useState(null)
  const [preview, setPreview] = useState({ status: 'idle', data: null, error: '' })
  const [edits, setEdits] = useState({})
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)

  const load = useCallback(async () => {
    if (!brand?.id) return
    setState((s) => ({ ...s, status: 'loading' }))
    try {
      const [p, h] = await Promise.all([representativesRepository.accountProfile(brand.id), representativesRepository.history(brand.id)])
      setState({ status: 'ready', profile: p.profile, changes: h.changes, available: p.available && !!p.profile?.operating_model })
    } catch (e) { log('load', e); setState((s) => ({ ...s, status: 'error' })) }
  }, [brand?.id])
  useEffect(() => { load() }, [load])

  async function openChange(next) {
    setTarget(next); setEdits({}); setNote(''); setError(''); setResult(null)
    setPreview({ status: 'loading', data: null, error: '' })
    try { setPreview({ status: 'ready', data: await representativesRepository.preview(brand.id, next), error: '' }) } catch (e) {
      log('preview', e); setPreview({ status: 'error', data: null, error: repLedgerError(e, "We couldn't prepare the summary. Please try again.") })
    }
  }

  async function confirm() {
    const p = preview.data
    const plan = target === 'decentralised' ? stockPlan(p, edits) : { plan: [] }
    if (plan.error) { setError(plan.error); return }
    setBusy(true); setError('')
    try {
      const r = await representativesRepository.switchModel(brand.id, target, p.token, { stockPlan: plan.plan.length ? plan.plan : null, note })
      setResult(r)
      load(); onChanged?.(r)
    } catch (e) {
      log('switch', e)
      setError(repLedgerError(e, 'The change could not be completed. Nothing was changed. Please try again.'))
      if (/changed since you reviewed/i.test(String(e?.message))) openChange(target)
    }
    setBusy(false)
  }

  if (state.status === 'loading') return <Card style={{ padding: 24, marginBottom: 20 }}><Loading text='Loading operating model…' /></Card>
  if (state.status === 'error') return <Card style={{ padding: 24, marginBottom: 20 }}><ErrorState message="We couldn't load the operating model." onRetry={load} /></Card>
  if (!state.available) return null

  const current = state.profile.operating_model
  const other = current === 'centralised' ? 'decentralised' : 'centralised'
  const p = preview.data

  return (
    <Card style={{ padding: '24px', marginBottom: '20px' }}>
      <h2 style={{ fontSize: '15px', fontWeight: 800, color: navy, margin: '0 0 4px' }}>Operating model</h2>
      <p style={{ fontSize: '13px', color: gray600, margin: '0 0 16px' }}>How your company and its representatives work. Every CareHub and CareFind feature stays available under both models.</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
        {['centralised', 'decentralised'].map((m) => (
          <div key={m} style={{ border: `2px solid ${m === current ? tealDeep : border}`, background: m === current ? tealMist : 'white', borderRadius: theme.radius.lg, padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
              <div style={{ fontWeight: 800, color: navy }}>{MODELS[m].label}</div>
              {m === current && <span style={{ fontSize: '12px', fontWeight: 700, color: tealDeep, display: 'flex', gap: 4, alignItems: 'center' }}><CheckCircle2 size={14} aria-hidden='true' /> Current</span>}
            </div>
            <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: '13px', color: gray600, lineHeight: 1.6 }}>
              {MODELS[m].points.map((t) => <li key={t}>{t}</li>)}
            </ul>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginTop: 16 }}>
        <TealBtn onClick={() => openChange(other)}>Switch to {MODELS[other].label}</TealBtn>
        {state.profile.operating_model_changed_at && <span style={{ fontSize: '12px', color: gray500 }}>Since {businessDateTime(state.profile.operating_model_changed_at)}</span>}
      </div>
      {state.changes.length > 0 && (
        <details style={{ marginTop: 16, fontSize: '13px', color: gray600 }}>
          <summary style={{ cursor: 'pointer', fontWeight: 700, color: navy, minHeight: 32 }}>History ({state.changes.length})</summary>
          <ul style={{ paddingLeft: 18, lineHeight: 1.7 }}>
            {state.changes.map((c) => (
              <li key={c.id}>{businessDateTime(c.effective_at)}: {c.from_model ? `${MODELS[c.from_model]?.label} → ` : ''}{MODELS[c.to_model]?.label} by {c.initiated_by_name || 'CareHub'}
                {c.note ? ` · ${c.note}` : ''}{c.exceptions?.length ? ` · ${c.exceptions.length} note(s)` : ''}</li>
            ))}
          </ul>
        </details>
      )}

      <Modal show={!!target} onClose={() => !busy && setTarget(null)} wide preventBackdropClose title={result ? 'Operating model changed' : `Switch to ${MODELS[target]?.label || ''}`}
        footer={result
          ? <TealBtn onClick={() => setTarget(null)} style={{ flex: 1, padding: '12px' }}>Done</TealBtn>
          : <><GhostBtn onClick={() => setTarget(null)} disabled={busy} style={{ flex: 1, padding: '12px' }}>Cancel</GhostBtn>
            <TealBtn onClick={confirm} disabled={busy || preview.status !== 'ready' || (p?.blockers?.length || 0) > 0} style={{ flex: 1, padding: '12px' }}>
              {busy ? 'Switching…' : `Confirm switch to ${MODELS[target]?.label || ''}`}</TealBtn></>}>
        {result ? (
          <div style={{ fontSize: '13px', color: gray600, lineHeight: 1.6 }}>
            <p style={{ marginTop: 0 }}>{result.converted} representative(s) moved to the {MODELS[result.to]?.label} structure. Balances and history are unchanged. Representatives have been notified; they should sign out and back in.</p>
            {result.reconciliation && <Reconciliation r={result.reconciliation} />}
            {result.exceptions?.length > 0 && (<><strong style={{ color: navy }}>Notes</strong><ul style={{ paddingLeft: 18 }}>{result.exceptions.map((x, i) => <li key={i}>{x.message}</li>)}</ul></>)}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, fontSize: '13px', color: gray600 }}>
            {preview.status === 'loading' && <Loading text='Preparing the migration summary…' />}
            {preview.status === 'error' && <div role='alert' style={{ color: danger }}>{preview.error}</div>}
            {preview.status === 'ready' && p && (
              <>
                <section aria-label='What changes'>
                  <strong style={{ color: navy }}>What changes</strong>
                  <ul style={{ paddingLeft: 18, margin: '6px 0 0', lineHeight: 1.6 }}>{(p.changes || []).map((t) => <li key={t}>{t}</li>)}</ul>
                </section>
                {p.blockers?.length > 0 && (
                  <section role='alert' style={{ border: `1px solid ${danger}`, borderRadius: theme.radius.md, padding: 12 }}>
                    <strong style={{ color: danger, display: 'flex', gap: 6, alignItems: 'center' }}><AlertTriangle size={14} aria-hidden='true' /> Resolve these first</strong>
                    <ul style={{ paddingLeft: 18, margin: '6px 0 0' }}>{p.blockers.map((b, i) => <li key={i}>{b.message}</li>)}</ul>
                  </section>
                )}
                {p.warnings?.length > 0 && (
                  <section style={{ border: `1px solid ${warning}`, borderRadius: theme.radius.md, padding: 12 }}>
                    <strong style={{ color: navy, display: 'flex', gap: 6, alignItems: 'center' }}><Info size={14} aria-hidden='true' /> Good to know</strong>
                    <ul style={{ paddingLeft: 18, margin: '6px 0 0' }}>{p.warnings.map((w, i) => <li key={i}>{w.message}</li>)}</ul>
                  </section>
                )}
                <section aria-label='Representatives'>
                  <strong style={{ color: navy }}>Representatives ({p.representatives.length}) · outstanding total {money(p.total_balance)}</strong>
                  {p.representatives.length === 0 && <div style={{ marginTop: 6 }}>No representatives yet. Only the company structure changes.</div>}
                  <div style={{ display: 'grid', gap: 10, marginTop: 8 }}>
                    {p.representatives.map((r) => (
                      <div key={r.id} style={{ border: `1px solid ${border}`, borderRadius: theme.radius.md, padding: 12 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: 700, color: navy }}>{r.full_name} <span style={{ fontWeight: 500, color: gray500 }}>{r.rep_code}</span></span>
                          <span>Balance {money(r.balance)}</span>
                        </div>
                        <div style={{ fontSize: '12px', marginTop: 4 }}>{r.converts
                          ? (target === 'decentralised' ? (r.reuses_account ? 'Gets their previous account back.' : 'Gets a new account of their own.') : 'Returns to the company account as staff.')
                          : 'Not moved (inactive or no login). Their ledger stays with the company.'}</div>
                        {(r.stock || []).length > 0 && (
                          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8, fontSize: '12px' }}>
                            <thead><tr>
                              <th scope='col' style={{ textAlign: 'left', padding: 4 }}>Product</th>
                              <th scope='col' style={{ textAlign: 'right', padding: 4 }}>{target === 'decentralised' ? 'In custody' : 'In their account'}</th>
                              <th scope='col' style={{ textAlign: 'right', padding: 4 }}>{target === 'decentralised' ? 'Move to their account' : 'Back to company'}</th>
                            </tr></thead>
                            <tbody>
                              {r.stock.map((s) => {
                                const k = `${r.id}:${s.company_product_id}`
                                return (
                                  <tr key={s.company_product_id || s.rep_product_id} style={{ borderTop: `1px solid ${border}` }}>
                                    <td style={{ padding: 4 }}>{s.product_name}</td>
                                    <td style={{ padding: 4, textAlign: 'right' }}>{target === 'decentralised' ? s.custody : s.stock}</td>
                                    <td style={{ padding: 4, textAlign: 'right' }}>
                                      {target === 'decentralised' && r.converts
                                        ? <Inp id={`plan-${k}`} label={`Quantity of ${s.product_name} to move`} type='number' min='0' value={edits[k] ?? String(s.carry)}
                                            onChange={(v) => setEdits((e) => ({ ...e, [k]: v }))} style={{ width: 120, marginLeft: 'auto' }} />
                                        : target === 'decentralised' ? 'Stays' : (s.returns_to_company ? s.stock : 'Stays in their account')}
                                    </td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
                <Inp id='switch-note' label='Note for the history (optional)' value={note} onChange={setNote} />
                <div style={{ fontSize: '12px', color: tealDeep }}>The switch runs as one step: if anything fails, nothing changes. You can switch back at any time the same way.</div>
              </>
            )}
            {error && <div role='alert' style={{ color: danger }}>{error}</div>}
          </div>
        )}
      </Modal>
    </Card>
  )
}

// The checks the database ran before and after the switch (it refuses to finish if any of them differ).
function Reconciliation({ r }) {
  const b = r.before || {}
  const a = r.after || {}
  const lines = [
    ['Outstanding balances (all representatives)', money(b.total_balance), money(a.total_balance)],
    ['Ledger entries', b.ledger_entries, a.ledger_entries],
    ['Stock units (company and representative accounts)', b.stock_units, a.stock_units],
    ['Stock value at company cost', money(b.stock_value), money(a.stock_value)],
    ['Goods held in representatives\' custody', b.custody_units, a.custody_units],
  ]
  return (
    <section aria-label='Reconciliation' style={{ margin: '0 0 12px' }}>
      <strong style={{ color: navy, display: 'flex', gap: 6, alignItems: 'center' }}><CheckCircle2 size={14} aria-hidden='true' /> Reconciled</strong>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 6, fontSize: '12px' }}>
          <thead><tr>
            <th scope='col' style={{ textAlign: 'left', padding: 4 }}>Checked</th>
            <th scope='col' style={{ textAlign: 'right', padding: 4 }}>Before</th>
            <th scope='col' style={{ textAlign: 'right', padding: 4 }}>After</th>
          </tr></thead>
          <tbody>{lines.map(([label, before, after]) => (
            <tr key={label} style={{ borderTop: `1px solid ${border}` }}>
              <th scope='row' style={{ textAlign: 'left', padding: 4, fontWeight: 500 }}>{label}</th>
              <td style={{ textAlign: 'right', padding: 4 }}>{before}</td>
              <td style={{ textAlign: 'right', padding: 4 }}>{after}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <div style={{ fontSize: '12px', color: gray500, marginTop: 4 }}>Custody changes by design: goods in custody become stock in each representative's account, and back.</div>
    </section>
  )
}
