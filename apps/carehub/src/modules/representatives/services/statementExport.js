// Representative Account Statement: Excel and print/PDF builders over rep_statement's result. Pure builders: no
// figure is recomputed, so the file, the printout and the screen always agree. PDF follows the repo's established
// pattern (docs/architecture/ADR-Exports.md): a print-ready HTML document, saved as PDF by the browser.
import { neutraliseFormula, downloadBlob, printAsPdf } from '../../business-directory/services/exportService'
import { businessDateTime } from '../../../lib/businessDay'
import { summaryRows, detailRows, positionText } from './ledger'

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const MONEY_FMT = '#,##0.00'
const text = (v) => neutraliseFormula(String(v ?? ''))

function header(st) {
  const c = st.company || {}
  const r = st.representative || {}
  return {
    company: c.name || '',
    companyLine: [c.address, c.city, c.state].filter(Boolean).join(', '),
    contact: [c.phone, c.email].filter(Boolean).join(' · '),
    rep: `${r.full_name || ''}${r.rep_code ? ` (${r.rep_code})` : ''}`,
    period: `${st.period?.from} to ${st.period?.to}`,
    generated: businessDateTime(st.generated_at) || '',
    position: positionText(st.closing_balance),
  }
}

export async function buildStatementXlsx(st, { view = 'detailed' } = {}) {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = 'CareHub'
  wb.created = new Date()
  const h = header(st)

  const ws = wb.addWorksheet('Summary')
  ws.columns = [{ width: 44 }, { width: 22 }]
  ws.addRow(['Representative Account Statement']).font = { bold: true, size: 14 }
  for (const [k, v] of [['Company', h.company], ['Address', h.companyLine], ['Contact', h.contact], ['Representative', h.rep],
    ['Statement period', h.period], ['Currency', st.currency || 'NGN'], ['Generated', h.generated], ['Position', h.position]]) {
    ws.addRow([k, text(v)])
  }
  ws.addRow([])
  for (const [label, value, kind] of summaryRows(st)) {
    const row = ws.addRow([label, Number(value || 0)])
    row.getCell(2).numFmt = MONEY_FMT
    if (kind === 'balance') row.font = { bold: true }
  }

  if (view === 'detailed') {
    const tx = wb.addWorksheet('Transactions', { views: [{ state: 'frozen', ySplit: 2 }] })
    tx.columns = [
      { key: 'date', width: 12 }, { key: 'entryNo', width: 18 }, { key: 'reference', width: 16 }, { key: 'description', width: 60 },
      { key: 'debit', width: 15, style: { numFmt: MONEY_FMT } }, { key: 'credit', width: 15, style: { numFmt: MONEY_FMT } },
      { key: 'balance', width: 16, style: { numFmt: MONEY_FMT } },
    ]
    tx.addRow(['Date', 'Entry', 'Reference', 'Description', 'Debit (NGN)', 'Credit (NGN)', 'Balance (NGN)']).font = { bold: true }
    const open = tx.addRow(['', '', '', 'Opening balance brought forward', null, null, Number(st.opening_balance || 0)])
    open.font = { italic: true }
    for (const r of detailRows(st)) {
      tx.addRow({ ...r, entryNo: text(r.entryNo), reference: text(r.reference), description: text(r.description),
        debit: r.debit || null, credit: r.credit || null })
    }
    tx.addRow(['', '', '', 'Closing balance carried forward', null, null, Number(st.closing_balance || 0)]).font = { bold: true }
  }

  const buf = await wb.xlsx.writeBuffer()
  return new Blob([buf], { type: XLSX_MIME })
}

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
const n2 = (n) => Number(n || 0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function buildStatementHtml(st, { view = 'detailed' } = {}) {
  const h = header(st)
  const summary = summaryRows(st).map(([label, value, kind]) =>
    `<tr class="${kind}"><td>${esc(label)}</td><td class="n">${esc(n2(value))}</td></tr>`).join('')
  const rows = detailRows(st)
  const detail = view !== 'detailed' ? '' : `
<h2>Transactions</h2>
<table><thead><tr><th>Date</th><th>Entry</th><th>Reference</th><th>Description</th><th class="n">Debit</th><th class="n">Credit</th><th class="n">Balance</th></tr></thead>
<tbody><tr class="balance"><td colspan="6">Opening balance brought forward</td><td class="n">${esc(n2(st.opening_balance))}</td></tr>
${rows.length ? rows.map((r) => `<tr><td>${esc(r.date)}</td><td>${esc(r.entryNo)}</td><td>${esc(r.reference)}</td><td>${esc(r.description)}</td>
<td class="n">${r.debit ? esc(n2(r.debit)) : ''}</td><td class="n">${r.credit ? esc(n2(r.credit)) : ''}</td><td class="n">${esc(n2(r.balance))}</td></tr>`).join('')
    : '<tr><td colspan="7" class="empty">No transactions in this period.</td></tr>'}
<tr class="balance"><td colspan="6">Closing balance carried forward</td><td class="n">${esc(n2(st.closing_balance))}</td></tr></tbody></table>`
  return `<!doctype html><html><head><meta charset="utf-8"><title>Statement · ${esc(h.rep)} · ${esc(h.period)}</title>
<style>
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a;margin:24px;font-size:12px}
  h1{font-size:18px;margin:0 0 4px} h2{font-size:14px;margin:20px 0 8px} .meta{color:#475569;margin:0 0 16px;line-height:1.6}
  .grid{display:flex;gap:32px;flex-wrap:wrap;margin-bottom:16px} .grid div{line-height:1.6}
  .pos{display:inline-block;padding:6px 10px;border-radius:6px;background:#f1f5f9;font-weight:700;margin-bottom:12px}
  table{border-collapse:collapse;width:100%} th,td{border:1px solid #e2e8f0;padding:6px 8px;text-align:left;vertical-align:top}
  th{background:#f1f5f9} .n{text-align:right;white-space:nowrap} .balance td{font-weight:700;background:#f8fafc}
  .summary{width:auto;min-width:380px} .empty{text-align:center;color:#94a3b8;padding:20px}
  @media print{body{margin:10mm} tr{page-break-inside:avoid}}
</style></head><body>
<h1>Representative Account Statement</h1>
<div class="grid">
  <div><strong>${esc(h.company)}</strong><br>${esc(h.companyLine)}<br>${esc(h.contact)}</div>
  <div>Representative: <strong>${esc(h.rep)}</strong><br>Period: ${esc(h.period)}<br>Currency: ${esc(st.currency || 'NGN')}<br>Generated: ${esc(h.generated)}</div>
</div>
<div class="pos">${esc(h.position)}</div>
<table class="summary"><tbody>${summary}</tbody></table>
${detail}
</body></html>`
}

const fileStem = (st) => `Statement_${String(st.representative?.rep_code || 'REP').replace(/[^A-Za-z0-9-]/g, '')}_${st.period?.from}_${st.period?.to}`

export async function exportStatementXlsx(st, opts) {
  downloadBlob(await buildStatementXlsx(st, opts), `${fileStem(st)}.xlsx`)
}

export function printStatement(st, opts) {
  printAsPdf(buildStatementHtml(st, opts))
}

// The consolidated summary across representatives, as a spreadsheet.
export async function exportSummaryXlsx(summary, companyName) {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = 'CareHub'
  const ws = wb.addWorksheet('Representatives', { views: [{ state: 'frozen', ySplit: 3 }] })
  ws.addRow([`Representative balances · ${text(companyName)} · ${summary.period?.from} to ${summary.period?.to}`]).font = { bold: true, size: 13 }
  ws.addRow([])
  const cols = [['Representative', 28], ['Code', 10], ['Status', 10], ['Opening', 15], ['Supplies', 15], ['Payments', 15], ['Returns', 15],
    ['Transfers (net)', 15], ['Adjustments (net)', 16], ['Closing', 15], ['Pending', 9]]
  ws.columns = cols.map(([, width], i) => ({ width, style: i >= 3 && i <= 9 ? { numFmt: MONEY_FMT } : {} }))
  ws.addRow(cols.map(([h]) => h)).font = { bold: true }
  for (const r of summary.representatives || []) {
    ws.addRow([text(r.full_name), text(r.rep_code), r.status, r.opening_balance, r.supplies, r.payments, r.returns, r.transfers_net,
      r.adjustments_net, r.closing_balance, r.pending_count])
  }
  const t = summary.totals || {}
  ws.addRow(['Total', '', '', t.opening_balance, t.supplies, t.payments, t.returns, t.transfers_net, t.adjustments_net, t.closing_balance, '']).font = { bold: true }
  const buf = await wb.xlsx.writeBuffer()
  downloadBlob(new Blob([buf], { type: XLSX_MIME }), `Representative_Balances_${summary.period?.from}_${summary.period?.to}.xlsx`)
}
