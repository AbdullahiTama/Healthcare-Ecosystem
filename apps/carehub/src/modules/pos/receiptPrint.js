// Pure, testable receipt HTML builder for the POS printer. The page opens a
// print window and calls buildReceiptHtml; all string assembly lives here so
// escaping, the 58/80mm @page sizing, the tax line and the payment rows are
// unit-testable without a browser.
//
// Architecture: CSS Grid for all label/value rows. The grid's implicit
// `min-width: 0` on the left column prevents long product names from pushing
// the right-aligned price off the paper. The @page rule sets zero margins so
// the full paper width is available for content — matching thermal printer
// hardware which has no concept of print margins.
import { esc } from '../../lib/escape.js'
import { fmt, nowStr } from '../../lib/utils.js'

// Display-only tax. The tax line is a computed total × rate shown on the
// receipt for the customer's information; the stored sale total and the amount
// charged are deliberately unchanged. Returns 0 when there is nothing to show.
export const computeTax = (total, taxRate) => {
  const rate = Number(taxRate) || 0
  const t = Number(total) || 0
  if (!(rate > 0) || !(t > 0)) return 0
  return Math.round(t * rate) / 100
}

// Formatted for the same en-NG medium date + short time shape nowStr() uses,
// so a sale's created_at reprints identically to a freshly-printed receipt.
export const fmtReceiptDate = (d) => d
  ? new Date(d).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' })
  : nowStr()

// Paper width configuration. 58mm rolls keep ~48mm usable; 80mm rolls ~72mm.
// The @page rule uses the full paper width with zero margins, matching thermal
// printer hardware. Body padding is minimal (2mm) for edge-to-edge content.
const PAPER = { '58': { paper: '58mm', pad: '2mm', fontSize: '10.5px', nameSize: '11px', totalSize: '13px' }, '80': { paper: '80mm', pad: '3mm', fontSize: '11.5px', nameSize: '12px', totalSize: '14px' } }

export function buildReceiptHtml({ receipt = {}, business = {}, settings = {} }) {
  const r = receipt
  const biz = business
  const s = settings
  const width = s.receipt_width === '58' ? '58' : '80'
  const p = PAPER[width] || PAPER['80']
  const items = Array.isArray(r.items) ? r.items : []
  const tax = computeTax(r.total, s.tax_rate)
  const date = fmtReceiptDate(r.date)
  const rate = Number(s.tax_rate) || 0
  const total = Number(r.total) || 0

  const logo = s.logo_url
    ? '<div style="margin-bottom:4px"><img src="' + esc(s.logo_url) + '" style="width:40px;height:40px;border-radius:50%;object-fit:cover" /></div>'
    : ''

  const bizName = biz?.name
    ? '<div style="font-weight:bold;font-size:' + p.nameSize + '">' + esc(biz.name) + '</div>'
    : ''
  const bizAddr = biz?.address ? '<div>' + esc(biz.address) + '</div>' : ''
  const bizPhone = biz?.phone ? '<div>' + esc(biz.phone) + '</div>' : ''
  const bizWhatsapp = biz?.whatsapp ? '<div>WhatsApp: ' + esc(biz.whatsapp) + '</div>' : ''
  const headerLine = s.receipt_header ? '<div style="margin-top:2px;font-style:italic">' + esc(s.receipt_header) + '</div>' : ''

  // ── ITEM ROWS ───────────────────────────────────────────────────────────
  // Each item: name block (wraps) + qty×price line. Grid ensures the name
  // never pushes content off the right edge.
  const itemRows = items.map(i => {
    const nameBlock = (i.emoji ? esc(i.emoji) + ' ' : '') + esc(i.name)
    const qtyPrice = String(i.qty) + ' × ' + fmt(i.price)
    const lineTotal = fmt(i.price * i.qty)
    return '<div style="margin-bottom:6px">' +
      '<div style="word-break:break-word;overflow-wrap:anywhere">' + nameBlock + '</div>' +
      '<div style="display:grid;grid-template-columns:1fr auto;gap:0 6px;margin-top:1px">' +
        '<div>' + qtyPrice + '</div>' +
        '<div style="text-align:right;font-weight:bold">' + lineTotal + '</div>' +
      '</div></div>'
  }).join('')

  // ── TAX ROWS ────────────────────────────────────────────────────────────
  const taxRows = tax > 0
    ? '<div style="display:grid;grid-template-columns:1fr auto;gap:0 6px;margin-top:3px"><div>Tax (' + esc(String(rate)) + '%)</div><div style="text-align:right">' + fmt(tax) + '</div></div>' +
      '<div style="display:grid;grid-template-columns:1fr auto;gap:0 6px;margin-top:3px;font-weight:bold"><div>Total incl. tax</div><div style="text-align:right">' + fmt(total + tax) + '</div></div>'
    : ''

  // ── PAYMENT ROWS ────────────────────────────────────────────────────────
  const paymentRows = r.method === 'Cash' && Number(r.cashGiven) > 0
    ? '<div style="display:grid;grid-template-columns:1fr auto;gap:0 6px;margin-top:3px"><div>Cash Given</div><div style="text-align:right">' + fmt(r.cashGiven) + '</div></div>' +
      '<div style="display:grid;grid-template-columns:1fr auto;gap:0 6px;margin-top:3px"><div>Change</div><div style="text-align:right;font-weight:bold">' + fmt(Number(r.cashGiven) - total) + '</div></div>'
    : r.method === 'Credit'
      ? '<div style="display:grid;grid-template-columns:1fr auto;gap:0 6px;margin-top:3px"><div>Amount Paid</div><div style="text-align:right">' + fmt(r.amtPaid) + '</div></div>' +
        '<div style="display:grid;grid-template-columns:1fr auto;gap:0 6px;margin-top:3px"><div>Balance Owed</div><div style="text-align:right;font-weight:bold">' + fmt(r.balance) + '</div></div>'
      : ''

  // ── SPLIT PAYMENT ───────────────────────────────────────────────────────
  const splitLine = r.splitAmounts
    ? Object.entries(r.splitAmounts)
        .filter(([, v]) => parseFloat(v) > 0)
        .map(([k, v]) => '<div style="display:grid;grid-template-columns:1fr auto;gap:0 6px;margin-top:2px"><div>' + esc(k) + '</div><div style="text-align:right;font-weight:bold">' + fmt(parseFloat(v)) + '</div></div>')
        .join('')
    : ''

  // ── METADATA ROW ────────────────────────────────────────────────────────
  const metaRow = (label, value) =>
    '<div style="display:grid;grid-template-columns:1fr auto;gap:0 6px;margin-top:3px"><div>' + label + '</div><div style="text-align:right">' + value + '</div></div>'

  // ── QR CODE ──────────────────────────────────────────────────────────────
  // Generate a QR code data URL for the receipt URL. If no custom URL is
  // provided, use the receipt ID as a simple identifier. The QR code is
  // rendered as an image at the bottom of the receipt.
  const receiptUrl = s.qr_code_url || `${window.location.origin}/receipt/${r.id}`
  const qrData = 'https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=' + encodeURIComponent(receiptUrl)
  const qrCode = `<img src="${qrData}" alt="QR Code" style="width:40px;height:40px;border:1px solid ${border};margin:4px auto;display:block" />`

  return `<!DOCTYPE html><html><head><title>Receipt</title><style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:Arial,Helvetica,sans-serif;font-size:${p.fontSize};width:${p.paper};margin:0 auto;padding:${p.pad};-webkit-print-color-adjust:exact;print-color-adjust:exact}
    @page{size:${p.paper} auto;margin:0}
    @media print{body{padding:0}}
  </style></head><body>
    <div style="text-align:center">
      ${logo}
      ${bizName}
      ${bizAddr}
      ${bizPhone}
      ${bizWhatsapp}
      ${headerLine}
    </div>
    ${hr}
    ${metaRow('Receipt:', esc(r.id))}
    ${metaRow('Date:', esc(date))}
    ${metaRow('Client:', esc(r.client))}
    ${hr}
    ${itemRows}
    ${hr}
    ${metaRow('Subtotal', fmt(r.subtotal))}
    ${Number(r.disc) > 0 ? metaRow('Discount', '-' + fmt(r.disc)) : ''}
    <div style="display:grid;grid-template-columns:1fr auto;gap:0 6px;margin-top:4px;font-weight:bold;font-size:${p.totalSize}"><div>TOTAL</div><div style="text-align:right">${fmt(r.total)}</div></div>
    ${taxRows}
    ${hr}
    ${metaRow('Payment', esc(r.method))}
    ${paymentRows}
    ${splitLine}
    ${hr}
    ${s.refund_policy ? '<div style="text-align:center;margin-bottom:6px">' + esc(s.refund_policy) + '</div>' + hr : ''}
    <div style="text-align:center;margin-top:6px">${esc(s.receipt_footer || 'Thank you for your patronage!')}</div>
    <div style="text-align:center;margin-top:8px">${qrCode}</div>
</body></html>`
}
