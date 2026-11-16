// Client Account Statement: Excel and print/PDF builders over clientStatement()'s result. Pure builders: no figure is
// recomputed, so the file, the printout and the screen agree. PDF follows the repo's pattern (docs/architecture/
// ADR-Exports.md, as the representative statement): a print-ready HTML document saved as PDF by the browser.
//   view 'summary'   opening balance, purchases, payments, returns, refunds, adjustments, closing balance
//   view 'detailed'  the summary, then every entry with reference, debit, credit and running balance
import { neutraliseFormula, downloadBlob, printAsPdf } from '../business-directory/services/exportService'
import { businessDateTime } from '../../lib/businessDay'
import { summaryLines, balanceStatus } from './clientLedger'

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const MONEY_FMT = '#,##0.00'
const text = (v) => neutraliseFormula(String(v ?? ''))
const n2 = (n) => Number(n || 0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

/** "Client owes us ₦3,000.00" / "We owe client ₦500.00" / "Settled". */
export function positionLine(balance) {
  const s = balanceStatus(balance)
  return s.status === 'clear' ? 'Settled' : `${s.label} ₦${n2(s.amount)}`
}
export const periodText = (st) => (st.from || st.to) ? `${st.from || 'Start'} to ${st.to || 'today'}` : 'All dates'

function header(st, { business = {}, client = {}, generatedAt = new Date().toISOString() }) {
  return {
    business: business.name || '',
    businessLine: [business.address, business.city, business.state].filter(Boolean).join(', '),
    contact: [business.phone, business.email].filter(Boolean).join(' · '),
    client: client.full_name || '',
    clientLine: [client.phone, client.address].filter(Boolean).join(' · '),
    period: periodText(st),
    generated: businessDateTime(generatedAt) || '',
    position: positionLine(st.closing),
  }
}

export async function buildClientStatementXlsx(st, { view = 'detailed', ...who } = {}) {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = 'CareHub'
  wb.created = new Date()
  const h = header(st, who)
  const ws = wb.addWorksheet('Summary')
  ws.columns = [{ width: 40 }, { width: 22 }]
  ws.addRow([view === 'summary' ? 'Summary Account Statement' : 'Detailed Account Statement']).font = { bold: true, size: 14 }
  for (const [k, v] of [['Business', h.business], ['Address', h.businessLine], ['Contact', h.contact], ['Client', h.client], ['Client details', h.clientLine],
    ['Statement period', h.period], ['Currency', 'NGN'], ['Generated', h.generated], ['Position', h.position]]) ws.addRow([k, text(v)])
  ws.addRow([])
  for (const [label, value, kind] of summaryLines(st)) {
    const row = ws.addRow([label, Number(value || 0)])
    row.getCell(2).numFmt = MONEY_FMT
    if (kind === 'balance') row.font = { bold: true }
  }
  ws.addRow([])
  ws.addRow(['Balances: positive = owed by the client; negative = owed to the client.']).font = { italic: true, color: { argb: 'FF64748B' } }

  if (view === 'detailed') {
    const tx = wb.addWorksheet('Transactions', { views: [{ state: 'frozen', ySplit: 1 }] })
    tx.columns = [
      { key: 'date', width: 12 }, { key: 'ref', width: 16 }, { key: 'description', width: 52 },
      { key: 'debit', width: 15, style: { numFmt: MONEY_FMT } }, { key: 'credit', width: 15, style: { numFmt: MONEY_FMT } }, { key: 'balance', width: 16, style: { numFmt: MONEY_FMT } },
    ]
    tx.addRow(['Date', 'Reference', 'Description', 'Debit (NGN)', 'Credit (NGN)', 'Balance (NGN)']).font = { bold: true }
    tx.addRow(['', '', 'Opening balance brought forward', null, null, Number(st.opening || 0)]).font = { italic: true }
    for (const e of st.entries) {
      tx.addRow({ date: e.date, ref: text(e.ref), description: text(e.description), debit: e.debit || null, credit: e.credit || null, balance: Number(e.balance || 0) })
    }
    tx.addRow(['', '', 'Closing balance carried forward', null, null, Number(st.closing || 0)]).font = { bold: true }
  }
  const buf = await wb.xlsx.writeBuffer()
  return new Blob([buf], { type: XLSX_MIME })
}

export function buildClientStatementHtml(st, { view = 'detailed', ...who } = {}) {
  const h = header(st, who)
  const title = view === 'summary' ? 'Summary Account Statement' : 'Detailed Account Statement'
  const summary = summaryLines(st).map(([label, value, kind]) => `<tr class="${kind}"><td>${esc(label)}</td><td class="n">${esc(n2(value))}</td></tr>`).join('')
  const detail = view !== 'detailed' ? '' : `
<h2>Transactions</h2>
<table><thead><tr><th>Date</th><th>Reference</th><th>Description</th><th class="n">Debit</th><th class="n">Credit</th><th class="n">Balance</th></tr></thead>
<tbody><tr class="balance"><td colspan="5">Opening balance brought forward</td><td class="n">${esc(n2(st.opening))}</td></tr>
${st.entries.length ? st.entries.map((e) => `<tr><td>${esc(e.date)}</td><td>${esc(e.ref)}</td><td>${esc(e.description)}</td><td class="n">${e.debit ? esc(n2(e.debit)) : ''}</td><td class="n">${e.credit ? esc(n2(e.credit)) : ''}</td><td class="n">${esc(n2(e.balance))}</td></tr>`).join('')
    : '<tr><td colspan="6" class="empty">No transactions in this period.</td></tr>'}
<tr class="balance"><td colspan="5">Closing balance carried forward</td><td class="n">${esc(n2(st.closing))}</td></tr></tbody></table>`
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)} · ${esc(h.client)} · ${esc(h.period)}</title>
<style>
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a;margin:24px;font-size:12px}
  h1{font-size:18px;margin:0 0 4px} h2{font-size:14px;margin:20px 0 8px}
  .grid{display:flex;gap:32px;flex-wrap:wrap;margin-bottom:16px} .grid div{line-height:1.6}
  .pos{display:inline-block;padding:6px 10px;border-radius:6px;background:#f1f5f9;font-weight:700;margin-bottom:12px}
  table{border-collapse:collapse;width:100%} th,td{border:1px solid #e2e8f0;padding:6px 8px;text-align:left;vertical-align:top}
  th{background:#f1f5f9} .n{text-align:right;white-space:nowrap} .balance td{font-weight:700;background:#f8fafc}
  .summary{width:auto;min-width:380px} .empty{text-align:center;color:#94a3b8;padding:20px} .note{color:#64748b;font-size:10px;margin-top:6px}
  @media print{body{margin:10mm} tr{page-break-inside:avoid}}
</style></head><body>
<h1>${esc(title)}</h1>
<div class="grid">
  <div><strong>${esc(h.business)}</strong><br>${esc(h.businessLine)}<br>${esc(h.contact)}</div>
  <div>Client: <strong>${esc(h.client)}</strong><br>${esc(h.clientLine)}<br>Period: ${esc(h.period)}<br>Currency: NGN<br>Generated: ${esc(h.generated)}</div>
</div>
<div class="pos">${esc(h.position)}</div>
<table class="summary"><tbody>${summary}</tbody></table>
<div class="note">Balances: positive = owed by the client; negative = owed to the client.</div>
${detail}
</body></html>`
}

const stem = (st, client, view) => `${view === 'summary' ? 'Summary' : 'Detailed'}_Statement_${String(client?.full_name || 'Client').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '')}_${(st.from || 'start')}_${(st.to || 'today')}`

export async function exportClientStatementXlsx(st, opts) {
  downloadBlob(await buildClientStatementXlsx(st, opts), `${stem(st, opts.client, opts.view)}.xlsx`)
}

export function printClientStatement(st, opts) {
  printAsPdf(buildClientStatementHtml(st, opts))
}
