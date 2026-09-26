// Business export helpers — spec section 3 Export columns
// Columns: business name, owner name, owner email, category, state, plan, status, date onboarded
// Preferred XLSX, CSV acceptable as first pass. This module does CSV now and exposes
// the row mapper so an XLSX library can reuse it later without changing callers.

export const BUSINESS_EXPORT_COLUMNS = [
  { key: 'business_name', label: 'Business Name' },
  { key: 'owner_name', label: 'Owner Name' },
  { key: 'owner_email', label: 'Owner Email' },
  { key: 'category', label: 'Category' },
  { key: 'state', label: 'State' },
  { key: 'plan', label: 'Plan' },
  { key: 'status', label: 'Status' },
  { key: 'date_onboarded', label: 'Date Onboarded' },
]

export function toBusinessExportRow(b) {
  return {
    business_name: b.name || '',
    owner_name: b.owner_name || b.owner || '',
    owner_email: b.owner_email || b.email || '',
    category: b.category || b.business_type || '',
    state: b.state || '',
    plan: b.plan || 'basic',
    status: b.status || 'pending',
    date_onboarded: (b.created_at || '').slice(0, 10),
  }
}

function escapeCsvValue(v) {
  const s = String(v ?? '')
  if (s.includes('"') || s.includes(',') || s.includes('\n')) return '"' + s.replace(/"/g, '""') + '"'
  return s
}

export function toBusinessCsv(rows) {
  const headers = BUSINESS_EXPORT_COLUMNS.map(c => c.label)
  const lines = [headers.map(escapeCsvValue).join(',')]
  for (const r of rows) {
    const mapped = toBusinessExportRow(r)
    lines.push(BUSINESS_EXPORT_COLUMNS.map(c => escapeCsvValue(mapped[c.key])).join(','))
  }
  return lines.join('\n')
}

export function downloadCsv(filename, csv) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// Ledger statement CSV: line items with running balance
export function toLedgerCsv(entity, lineItems) {
  const headers = ['Date', 'Description', 'Type', 'Amount', 'Balance']
  const lines = [headers.map(escapeCsvValue).join(',')]
  let bal = 0
  for (const it of lineItems) {
    const amt = Number(it.amount || 0)
    bal += amt
    lines.push([it.date || '', it.description || '', it.type || '', amt.toFixed(2), bal.toFixed(2)].map(escapeCsvValue).join(','))
  }
  return lines.join('\n')
}

// Build a printable statement HTML for window.open + print (reuse CareHub pattern)
export function buildStatementHtml(entity, lineItems) {
  let bal = 0
  const rows = lineItems.map(it => {
    const amt = Number(it.amount || 0)
    bal += amt
    return `<tr><td>${escapeHtml(it.date || '')}</td><td>${escapeHtml(it.description || '')}</td><td>${escapeHtml(it.type || '')}</td><td style="text-align:right">${amt.toFixed(2)}</td><td style="text-align:right">${bal.toFixed(2)}</td></tr>`
  }).join('')
  return `<!doctype html><html><head><meta charset="utf-8"><title>Statement - ${escapeHtml(entity?.name || entity?.email || '')}</title><style>body{font-family:system-ui;padding:24px;color:#0f172a}table{width:100%;border-collapse:collapse;margin-top:16px}th,td{border:1px solid #e2e8f0;padding:8px 10px;font-size:13px}th{background:#f1f5f9;text-align:left}h1{font-size:18px;margin:0}p{color:#64748b;font-size:13px}</style></head><body><h1>Statement</h1><p>Entity: ${escapeHtml(entity?.name || entity?.email || entity?.full_name || '')} • Generated ${new Date().toLocaleString('en-NG')}</p><table><thead><tr><th>Date</th><th>Description</th><th>Type</th><th style="text-align:right">Amount</th><th style="text-align:right">Balance</th></tr></thead><tbody>${rows || '<tr><td colspan=5 style="text-align:center;color:#94a3b8">No transactions</td></tr>'}</tbody></table><script>window.print()</script></body></html>`
}

function escapeHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') }

export function openPrintWindow(html) {
  const w = window.open('', '_blank')
  if (!w) return false
  w.document.open()
  w.document.write(html)
  w.document.close()
  return true
}
