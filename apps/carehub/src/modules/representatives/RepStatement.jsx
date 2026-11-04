import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, Printer, FileSpreadsheet, Undo2 } from 'lucide-react'
import { theme } from '../../styles/theme'
import { Card, Loading, Empty, ErrorState, Inp, GhostBtn, TealBtn, Modal, Pill } from '../../components/ui'
import { representativesRepository } from './repositories'
import { defaultPeriod, validPeriod, summaryRows, detailRows, positionText, money, entryTypeLabel, repLedgerError } from './services/ledger'
import { exportStatementXlsx, printStatement } from './services/statementExport'

const { navy, gray500, gray600, border, danger, tealDeep } = theme
const log = (what, e) => console.error(`[representatives] statement ${what}:`, e)

// The Representative Account Statement: opening balance brought forward, every posted entry in the period with a
// running balance, and the closing balance carried forward. Summary and Detailed are two views of the same result.
// A representative sees their own; ledger viewers see anyone's; managers may reverse an entry from here.
export default function RepStatement({ repId, title, onBack, canManage = false, showToast }) {
  const [period, setPeriod] = useState(defaultPeriod)
  const [view, setView] = useState('detailed')
  const [state, setState] = useState({ status: 'loading', statement: null, error: '' })
  const [reversing, setReversing] = useState(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState('')
  const reverseKey = useRef(null)

  const load = useCallback(async () => {
    const problem = validPeriod(period)
    if (problem) { setState({ status: 'invalid', statement: null, error: problem }); return }
    setState((s) => ({ ...s, status: 'loading' }))
    try {
      const st = await representativesRepository.statement(repId, period.from, period.to)
      setState({ status: 'ready', statement: st, error: '' })
    } catch (e) {
      log('load', e)
      setState({ status: 'error', statement: null, error: repLedgerError(e, "We couldn't load this statement. Please try again.") })
    }
  }, [repId, period])
  useEffect(() => { load() }, [load])

  const st = state.statement
  const rows = st ? detailRows(st) : []

  async function exportXlsx() {
    try { await exportStatementXlsx(st, { view }) } catch (e) { log('export', e); showToast?.('The spreadsheet could not be created. Please try again.', { type: 'error' }) }
  }
  function print() {
    try { printStatement(st, { view }) } catch (e) { log('print', e); showToast?.(e.message || 'Could not open the print view.', { type: 'error' }) }
  }
  function openReverse(entry) { setReversing(entry); setReason(''); setFormError(''); reverseKey.current = representativesRepository.newRequestKey() }
  async function reverse() {
    if (!reason.trim()) { setFormError('Give a reason for the reversal.'); return }
    setBusy(true)
    try {
      await representativesRepository.reverse(reversing.id, reason.trim(), reverseKey.current)
      showToast?.(`Entry ${reversing.entry_no} reversed.`, { type: 'success' })
      setReversing(null)
      load()
    } catch (e) { log('reverse', e); setFormError(repLedgerError(e)) }
    setBusy(false)
  }

  const tab = (id, label) => (
    <button type='button' role='tab' aria-selected={view === id} onClick={() => setView(id)}
      style={{ padding: '8px 14px', minHeight: 40, borderRadius: theme.radius.full, border: `1px solid ${view === id ? tealDeep : border}`,
        background: view === id ? tealDeep : 'white', color: view === id ? 'white' : navy, fontWeight: 700, fontSize: '13px', cursor: 'pointer' }}>{label}</button>
  )

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        {onBack && <GhostBtn onClick={onBack} aria-label='Back to representatives'><ArrowLeft size={14} aria-hidden='true' /> Back</GhostBtn>}
        <h2 style={{ margin: 0, fontSize: '18px', color: navy, flex: '1 1 auto' }}>{title || 'Account statement'}</h2>
        <GhostBtn onClick={print} disabled={!st}><Printer size={14} aria-hidden='true' /> Print / PDF</GhostBtn>
        <GhostBtn onClick={exportXlsx} disabled={!st}><FileSpreadsheet size={14} aria-hidden='true' /> Spreadsheet</GhostBtn>
      </div>

      <Card style={{ padding: 16, marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Inp id='statement-from' label='From' type='date' value={period.from} onChange={(v) => setPeriod((p) => ({ ...p, from: v }))} style={{ width: 170 }} />
          <Inp id='statement-to' label='To' type='date' value={period.to} onChange={(v) => setPeriod((p) => ({ ...p, to: v }))} style={{ width: 170 }} />
          <div role='tablist' aria-label='Statement view' style={{ display: 'flex', gap: 8, paddingBottom: 2 }}>{tab('summary', 'Summary')}{tab('detailed', 'Detailed')}</div>
        </div>
      </Card>

      {state.status === 'loading' && <Loading text='Loading statement…' />}
      {state.status === 'invalid' && <div role='alert' style={{ color: danger, fontSize: '13px' }}>{state.error}</div>}
      {state.status === 'error' && <ErrorState message={state.error} onRetry={load} />}
      {state.status === 'ready' && st && (
        <>
          <Card style={{ padding: 16, marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', fontSize: '13px', color: gray600, lineHeight: 1.7 }}>
              <div><strong style={{ color: navy }}>{st.company?.name}</strong><br />{[st.company?.address, st.company?.city, st.company?.state].filter(Boolean).join(', ')}</div>
              <div>Representative: <strong style={{ color: navy }}>{st.representative?.full_name}</strong> ({st.representative?.rep_code})<br />
                Period: {st.period?.from} to {st.period?.to} · {st.currency}</div>
            </div>
            <div style={{ marginTop: 10 }}>
              <Pill label={positionText(st.closing_balance)} type={st.position === 'owes' ? 'amber' : st.position === 'credit' ? 'teal' : 'green'} />
            </div>
          </Card>

          <Card style={{ padding: 0, marginBottom: 14, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <caption style={{ textAlign: 'left', padding: '12px 16px', fontWeight: 700, color: navy }}>Summary</caption>
              <tbody>
                {summaryRows(st).map(([label, value, kind]) => (
                  <tr key={label} style={{ borderTop: `1px solid ${border}`, fontWeight: kind === 'balance' ? 700 : 400 }}>
                    <th scope='row' style={{ textAlign: 'left', padding: '10px 16px', fontWeight: 'inherit', color: navy }}>{label}</th>
                    <td style={{ textAlign: 'right', padding: '10px 16px', whiteSpace: 'nowrap' }}>{money(value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {view === 'detailed' && (rows.length === 0
            ? <Empty title='No transactions in this period' description='The opening balance carries straight through to the closing balance.' />
            : (
              <Card style={{ padding: 0, overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', minWidth: 720 }}>
                  <caption style={{ textAlign: 'left', padding: '12px 16px', fontWeight: 700, color: navy }}>Transactions</caption>
                  <thead><tr style={{ background: theme.bg }}>
                    {['Date', 'Entry', 'Description', 'Debit', 'Credit', 'Balance', ''].map((h, i) => (
                      <th key={h || i} scope='col' style={{ textAlign: i >= 3 && i <= 5 ? 'right' : 'left', padding: '10px 12px', color: gray600, fontWeight: 700 }}>{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    <tr style={{ borderTop: `1px solid ${border}`, fontStyle: 'italic' }}>
                      <td colSpan={5} style={{ padding: '10px 12px' }}>Opening balance brought forward</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right' }}>{money(st.opening_balance)}</td><td />
                    </tr>
                    {st.entries.map((e, i) => (
                      <tr key={e.id} style={{ borderTop: `1px solid ${border}`, verticalAlign: 'top' }}>
                        <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>{rows[i].date}</td>
                        <td style={{ padding: '10px 12px' }}><div style={{ fontWeight: 600, color: navy }}>{entryTypeLabel(e.entry_type)}</div>
                          <div style={{ fontSize: '11px', color: gray500 }}>{e.entry_no}{e.reference ? ` · ${e.reference}` : ''}</div></td>
                        <td style={{ padding: '10px 12px', color: gray600 }}>{rows[i].description}
                          {rows[i].recordedBy && <div style={{ fontSize: '11px', color: gray500, marginTop: 2 }}>Recorded by {rows[i].recordedBy}{rows[i].approvedBy ? ` · approved by ${rows[i].approvedBy}` : ''}</div>}</td>
                        <td style={{ padding: '10px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>{rows[i].debit ? money(rows[i].debit) : ''}</td>
                        <td style={{ padding: '10px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>{rows[i].credit ? money(rows[i].credit) : ''}</td>
                        <td style={{ padding: '10px 12px', textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 600 }}>{money(rows[i].balance)}</td>
                        <td style={{ padding: '6px 8px' }}>
                          {canManage && e.entry_type !== 'reversal' && (
                            <button type='button' onClick={() => openReverse(e)} aria-label={`Reverse ${e.entry_no}`} title='Reverse'
                              style={{ width: 40, height: 40, border: `1px solid ${border}`, borderRadius: theme.radius.md, background: 'white', color: gray500, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <Undo2 size={15} aria-hidden='true' />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                    <tr style={{ borderTop: `2px solid ${border}`, fontWeight: 700 }}>
                      <td colSpan={5} style={{ padding: '10px 12px' }}>Closing balance carried forward</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right' }}>{money(st.closing_balance)}</td><td />
                    </tr>
                  </tbody>
                </table>
              </Card>
            ))}

          {st.pending?.length > 0 && (
            <div style={{ marginTop: 12, fontSize: '13px', color: gray600 }}>
              {st.pending.length} item(s) awaiting approval are not included: {st.pending.map((p) => `${entryTypeLabel(p.entry_type)} ${p.entry_no}`).join(', ')}.
            </div>
          )}
        </>
      )}

      <Modal show={!!reversing} onClose={() => setReversing(null)} title={reversing ? `Reverse ${reversing.entry_no}` : ''}
        footer={<><GhostBtn onClick={() => setReversing(null)} style={{ flex: 1, padding: '12px' }}>Cancel</GhostBtn>
          <TealBtn onClick={reverse} disabled={busy} style={{ flex: 1, padding: '12px' }}>{busy ? 'Reversing…' : 'Reverse entry'}</TealBtn></>}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: '13px', color: gray600 }}>
          <p style={{ margin: 0 }}>A reversal records the exact opposite of this entry{reversing?.entry_type?.startsWith('transfer') ? ' (both representatives of the transfer)' : ''}, and undoes any stock it moved. The original stays in the history.</p>
          <Inp id='reverse-reason' label='Reason' value={reason} onChange={setReason} required />
          {formError && <div role='alert' style={{ color: danger }}>{formError}</div>}
        </div>
      </Modal>
    </div>
  )
}
