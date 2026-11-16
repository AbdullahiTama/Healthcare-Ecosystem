import { useMemo, useState } from 'react'
import { FileSpreadsheet, Printer, AlertTriangle } from 'lucide-react'
import { Loading, ErrorState, GhostBtn, Pill } from '../../../components/ui'
import { useClientAccount } from '../../../hooks/queries'
import { fmt, todayDate } from '../../../lib/utils'
import { theme } from '../../../styles/theme'
import { buildClientLedger, clientStatement, accountSummary, summaryLines } from '../clientLedger'
import { exportClientStatementXlsx, printClientStatement, periodText } from '../clientStatementExport'

const { navy, gray400, gray500, gray600, gray100, border, danger, dangerBg, success, tealDeep, tealMist, warning, warningBg, bg } = theme
const PAGE = 100

// Date presets for the statement, as inclusive business dates.
function presets(today) {
  const [y, m] = today.split('-').map(Number)
  const pad = (n) => String(n).padStart(2, '0')
  const lastDay = (yy, mm) => new Date(Date.UTC(yy, mm, 0)).getUTCDate()
  const pm = m === 1 ? 12 : m - 1
  const py = m === 1 ? y - 1 : y
  return [
    ['all', 'All dates', '', ''],
    ['month', 'This month', `${y}-${pad(m)}-01`, today],
    ['last', 'Last month', `${py}-${pad(pm)}-01`, `${py}-${pad(pm)}-${pad(lastDay(py, pm))}`],
    ['year', 'This year', `${y}-01-01`, today],
  ]
}

// The Client Account in a client's profile: (A) financial summary, (B) the ledger and (C) summary and detailed
// statements for a period, exported to Excel or printed / saved as PDF. Built from the client's sales, payments,
// returns and recorded debts (clientLedger.js); quotations are proposals and never appear here. `position` is the
// client's position from the open debts (clientPositions), used to check the account agrees with Debt Management.
// Docs: docs/architecture/Client-Account.md.
export default function ClientAccount({ brand, client, position, canExport, showToast }) {
  const q = useClientAccount(client?.id, brand?.id)
  const today = todayDate()
  const [range, setRange] = useState({ preset: 'all', from: '', to: '' })
  const [view, setView] = useState('detailed')
  const [limit, setLimit] = useState(PAGE)
  const ledger = useMemo(() => (q.data ? buildClientLedger(q.data) : []), [q.data])
  const summary = useMemo(() => accountSummary(ledger, {
    openSales: (q.data?.sales || []).filter((s) => Number(s.balance) > 0 && !s.is_on_hold && (s.status == null || s.status === 'completed')).length,
    openDebts: (q.data?.debts || []).filter((d) => (d.source || 'manual') === 'manual' && Number(d.balance) > 0).length,
  }), [ledger, q.data])
  const st = useMemo(() => clientStatement(ledger, { from: range.from, to: range.to }), [ledger, range.from, range.to])
  const rangeError = range.from && range.to && range.from > range.to ? 'The start date is after the end date.' : ''
  // What Debt Management says this client's position is, against the ledger's closing balance (all dates).
  const debtNet = position ? Number(position.net) || 0 : null
  const drift = debtNet == null ? 0 : Math.round((summary.balance - debtNet) * 100) / 100

  if (q.isLoading) return <Loading text='Loading the account…' />
  if (q.isError) return <ErrorState message="We couldn't load this client's account. Check your connection and try again." onRetry={() => q.refetch()} />

  const who = { business: brand || {}, client, view }
  async function exportXlsx() {
    try {
      await exportClientStatementXlsx(st, who)
      console.info('[clients] statement exported', { client: client.id, view, from: st.from, to: st.to, entries: st.entries.length })
    } catch (e) {
      console.error('[clients] statement export failed:', e)
      showToast?.('Could not create the Excel file. Please try again.', { type: 'error' })
    }
  }
  function print() {
    try { printClientStatement(st, who) } catch (e) { showToast?.(e?.message || 'Could not open the statement for printing.', { type: 'error' }) }
  }
  const setPreset = (key) => { const p = presets(today).find(([k]) => k === key); setRange({ preset: key, from: p[2], to: p[3] }); setLimit(PAGE) }
  const statusTone = summary.status.status === 'owes' ? { bg: dangerBg, fg: danger } : summary.status.status === 'credit' ? { bg: tealMist, fg: tealDeep } : { bg, fg: success }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* A. Financial summary */}
      <section aria-label='Financial summary'>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 150px), 1fr))', gap: 8 }}>
          <Figure label='Total purchases' value={fmt(summary.purchases)} />
          <Figure label='Payments received' value={fmt(summary.payments)} color={success} />
          <Figure label='Returns and credit notes' value={fmt(summary.returns)} />
          <Figure label='Outstanding balance' value={fmt(summary.outstanding)} color={summary.outstanding > 0 ? danger : navy} />
          <Figure label='Available credit' value={fmt(summary.availableCredit)} color={summary.availableCredit > 0 ? tealDeep : navy} />
          <div style={{ padding: '10px 12px', borderRadius: theme.radius.md, background: statusTone.bg }}>
            <div style={{ fontSize: 11, color: gray500, fontWeight: 700 }}>Account status</div>
            <div style={{ fontSize: 14, fontWeight: 900, color: statusTone.fg, marginTop: 2 }}>{summary.status.label}</div>
            {summary.openItems > 0 && <div style={{ fontSize: 11, color: gray600 }}>{summary.openItems} open item{summary.openItems === 1 ? '' : 's'}</div>}
          </div>
        </div>
        {summary.refunds > 0 && <div style={{ fontSize: 12, color: gray500, marginTop: 6 }}>Refunds paid back to the client: {fmt(summary.refunds)} (returns refunded in cash leave the balance unchanged).</div>}
      </section>

      {debtNet != null && Math.abs(drift) >= 0.01 && (
        <div role='status' style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '10px 12px', borderRadius: theme.radius.md, background: warningBg, border: `1px solid ${warning}`, fontSize: 12.5, color: navy, lineHeight: 1.5 }}>
          <AlertTriangle size={15} color={warning} style={{ flexShrink: 0, marginTop: 2 }} aria-hidden='true' />
          <span>This account and Debt Management differ by {fmt(Math.abs(drift))}. Usually a sale or a debt was recorded under this client's name without being linked to their record, so it counts in one place and not the other. Check the client's debts in Debt Management.</span>
        </div>
      )}

      {ledger.length === 0 ? (
        <div style={{ padding: '24px 14px', borderRadius: 10, background: bg, textAlign: 'center', fontSize: 12.5, color: gray500 }}>
          No transactions yet. Sales charged to this client at the POS, payments, returns and opening balances will appear here.
        </div>
      ) : (
        <section aria-label='Account statement' style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* C. Statement controls */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div role='group' aria-label='Statement period' style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {presets(today).map(([k, label]) => (
                <button key={k} type='button' aria-pressed={range.preset === k} onClick={() => setPreset(k)}
                  style={{ padding: '6px 11px', minHeight: 32, borderRadius: theme.radius.full, border: `1px solid ${range.preset === k ? tealDeep : border}`, background: range.preset === k ? tealDeep : 'white', color: range.preset === k ? 'white' : gray600, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                  {label}
                </button>
              ))}
            </div>
            <label style={{ fontSize: 11.5, color: gray600, fontWeight: 700, display: 'flex', flexDirection: 'column', gap: 3 }}>From
              <input type='date' value={range.from} max={today} onChange={(e) => { setRange((r) => ({ ...r, preset: 'custom', from: e.target.value })); setLimit(PAGE) }}
                style={{ padding: '6px 8px', borderRadius: theme.radius.md, border: `1px solid ${border}`, fontSize: 12, color: navy }} />
            </label>
            <label style={{ fontSize: 11.5, color: gray600, fontWeight: 700, display: 'flex', flexDirection: 'column', gap: 3 }}>To
              <input type='date' value={range.to} max={today} onChange={(e) => { setRange((r) => ({ ...r, preset: 'custom', to: e.target.value })); setLimit(PAGE) }}
                style={{ padding: '6px 8px', borderRadius: theme.radius.md, border: `1px solid ${border}`, fontSize: 12, color: navy }} />
            </label>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <div role='tablist' aria-label='Statement view' style={{ display: 'flex', gap: 16, borderBottom: `1px solid ${border}` }}>
              {[['summary', 'Summary statement'], ['detailed', 'Detailed statement']].map(([v, label]) => (
                <button key={v} type='button' role='tab' aria-selected={view === v} onClick={() => setView(v)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '8px 2px', marginBottom: -1, fontSize: 13, fontWeight: view === v ? 800 : 600, color: view === v ? tealDeep : gray600, borderBottom: view === v ? `2px solid ${tealDeep}` : '2px solid transparent' }}>
                  {label}
                </button>
              ))}
            </div>
            {canExport && !rangeError && (
              <div style={{ display: 'flex', gap: 6 }}>
                <GhostBtn onClick={exportXlsx} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 11px' }}><FileSpreadsheet size={13} aria-hidden='true' /> Excel</GhostBtn>
                <GhostBtn onClick={print} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 11px' }}><Printer size={13} aria-hidden='true' /> PDF / Print</GhostBtn>
              </div>
            )}
          </div>

          {rangeError ? <div role='alert' style={{ fontSize: 12.5, color: danger }}>{rangeError}</div> : (
            <>
              <div style={{ fontSize: 12, color: gray500 }}>{periodText(st)} · {st.entries.length} transaction{st.entries.length === 1 ? '' : 's'}</div>
              {view === 'summary' ? (
                <table style={{ borderCollapse: 'collapse', width: '100%', maxWidth: 460, fontSize: 13 }}>
                  <caption style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0,0,0,0)' }}>Summary account statement</caption>
                  <tbody>
                    {summaryLines(st).map(([label, value, kind]) => (
                      <tr key={label} style={{ borderBottom: `1px solid ${gray100}`, background: kind === 'balance' ? bg : 'transparent' }}>
                        <th scope='row' style={{ textAlign: 'left', padding: '8px 10px', fontWeight: kind === 'balance' ? 800 : 600, color: kind === 'balance' ? navy : gray600 }}>{label}</th>
                        <td style={{ textAlign: 'right', padding: '8px 10px', fontWeight: kind === 'balance' ? 900 : 700, color: navy, whiteSpace: 'nowrap' }}>
                          {kind === 'balance' ? <BalanceText value={value} /> : fmtSigned(value)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div style={{ overflowX: 'auto', border: `1px solid ${border}`, borderRadius: theme.radius.md }}>
                  <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 620, fontSize: 12.5 }}>
                    <caption style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0,0,0,0)' }}>Detailed account statement</caption>
                    <thead>
                      <tr style={{ background: bg }}>
                        {['Date', 'Reference', 'Description', 'Debit', 'Credit', 'Balance'].map((h, i) => (
                          <th key={h} scope='col' style={{ padding: '8px 10px', textAlign: i >= 3 ? 'right' : 'left', fontSize: 10.5, color: gray400, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <tr style={{ background: bg, borderTop: `1px solid ${gray100}` }}>
                        <td colSpan={5} style={{ padding: '8px 10px', fontStyle: 'italic', color: gray600 }}>Opening balance brought forward</td>
                        <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 800 }}><BalanceText value={st.opening} /></td>
                      </tr>
                      {st.entries.slice(0, limit).map((e) => (
                        <tr key={e.id} style={{ borderTop: `1px solid ${gray100}` }}>
                          <td style={{ padding: '8px 10px', whiteSpace: 'nowrap', color: gray600 }}>{e.date}</td>
                          <td style={{ padding: '8px 10px', whiteSpace: 'nowrap', color: navy, fontWeight: 700 }}>{e.ref}</td>
                          <td style={{ padding: '8px 10px', color: navy }}>
                            {e.description}
                            {e.kind === 'opening' && <> <Pill label='Opening' type='blue' style={{ fontSize: 9 }} /></>}
                          </td>
                          <td style={{ padding: '8px 10px', textAlign: 'right', whiteSpace: 'nowrap' }}>{e.debit ? fmt(e.debit) : ''}</td>
                          <td style={{ padding: '8px 10px', textAlign: 'right', whiteSpace: 'nowrap', color: success }}>{e.credit ? fmt(e.credit) : ''}</td>
                          <td style={{ padding: '8px 10px', textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 700 }}><BalanceText value={e.balance} /></td>
                        </tr>
                      ))}
                      {st.entries.length === 0 && (
                        <tr><td colSpan={6} style={{ padding: 18, textAlign: 'center', color: gray500 }}>No transactions in this period.</td></tr>
                      )}
                      <tr style={{ background: bg, borderTop: `1px solid ${border}` }}>
                        <td colSpan={5} style={{ padding: '8px 10px', fontWeight: 800, color: navy }}>Closing balance carried forward</td>
                        <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 900 }}><BalanceText value={st.closing} /></td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
              {view === 'detailed' && st.entries.length > limit && (
                <div style={{ textAlign: 'center' }}>
                  <GhostBtn onClick={() => setLimit((l) => l + PAGE)} style={{ padding: '6px 14px' }}>Show more ({st.entries.length - limit} more)</GhostBtn>
                  <div style={{ fontSize: 11, color: gray500, marginTop: 4 }}>The closing balance and the exports cover every transaction in the period.</div>
                </div>
              )}
              <div style={{ fontSize: 11.5, color: gray500 }}>Debit increases what the client owes; credit (payments, returns, credit notes) reduces it. The closing balance of a period is the opening balance of the next.</div>
            </>
          )}
        </section>
      )}
    </div>
  )
}

const fmtSigned = (v) => (v < 0 ? '−' + fmt(-v) : fmt(v))

// A balance as people read it: "₦3,000 owed" / "₦500 credit" / "₦0".
function BalanceText({ value }) {
  const v = Math.round((Number(value) || 0) * 100) / 100
  if (v > 0) return <span style={{ color: danger }}>{fmt(v)} <span style={{ fontSize: 10, fontWeight: 700 }}>owed</span></span>
  if (v < 0) return <span style={{ color: tealDeep }}>{fmt(-v)} <span style={{ fontSize: 10, fontWeight: 700 }}>credit</span></span>
  return <span style={{ color: gray500 }}>{fmt(0)}</span>
}

function Figure({ label, value, color = navy }) {
  return (
    <div style={{ padding: '10px 12px', borderRadius: theme.radius.md, background: gray100 }}>
      <div style={{ fontSize: 11, color: gray500, fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 900, color, marginTop: 2 }}>{value}</div>
    </div>
  )
}
