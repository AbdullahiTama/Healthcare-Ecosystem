// Pure, testable receipt HTML builder for the POS printer. The page opens a
// print window and calls buildReceiptHtml; all string assembly lives here so
// escaping, the 58/80mm @page sizing, the tax line and the payment rows are
// unit-testable without a browser.
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

// mm of printable width inside the paper. 58mm portable rolls keep ~48mm
// usable; 80mm counter rolls ~72mm. Matching the @page size keeps the whole
// layout inside the physical roll.
const CONTENT_MM = { '58': 48, '80': 72 }

export function buildReceiptHtml({ receipt = {}, business = {}, settings = {} }) {
  const r = receipt
  const biz = business
  const s = settings
  const width = s.receipt_width === '58' ? '58' : '80'
  const contentMm = CONTENT_MM[width] || 72
  const items = Array.isArray(r.items) ? r.items : []
  const tax = computeTax(r.total, s.tax_rate)
  const date = fmtReceiptDate(r.date)
  const rate = Number(s.tax_rate) || 0
  const total = Number(r.total) || 0

  const logo = s.logo_url
    ? '<img src="' + esc(s.logo_url) + '" style="width:60px;height:60px;border-radius:50%;object-fit:cover;margin-bottom:8px" />'
    : '<div class="logo">🏥</div>'

  const bizLines = [
    biz?.name && '<div class="b" style="font-size:16px">' + esc(biz.name) + '</div>',
    biz?.address && '<div style="font-size:11px;color:#666;margin-top:2px">' + esc(biz.address) + '</div>',
    biz?.phone && '<div style="font-size:11px;color:#666">' + esc(biz.phone) + '</div>',
    biz?.whatsapp && '<div style="font-size:11px;color:#666">WhatsApp: ' + esc(biz.whatsapp) + '</div>',
    s.receipt_header && '<div style="font-size:11px;margin-top:4px;font-style:italic">' + esc(s.receipt_header) + '</div>',
  ].filter(Boolean).join('')

  const itemRows = items.map(i =>
    '<div style="margin-bottom:6px"><div class="b" style="font-size:12px">' + (i.emoji ? esc(i.emoji) + ' ' : '') + esc(i.name) + '</div>' +
    '<div class="r" style="color:#666"><span>' + String(i.qty) + ' x ' + fmt(i.price) + '</span><span>' + fmt(i.price * i.qty) + '</span></div></div>'
  ).join('')

  const taxRows = tax > 0
    ? '<div class="r"><span>Tax (' + esc(String(rate)) + '%)</span><span>' + fmt(tax) + '</span></div>' +
      '<div class="r b"><span>Total incl. tax</span><span>' + fmt(total + tax) + '</span></div>'
    : ''

  const paymentRows = r.method === 'Cash' && Number(r.cashGiven) > 0
    ? '<div class="r"><span>Cash Given</span><span>' + fmt(r.cashGiven) + '</span></div>' +
      '<div class="r" style="color:green"><span>Change</span><span>' + fmt(Number(r.cashGiven) - total) + '</span></div>'
    : r.method === 'Credit'
      ? '<div class="r" style="color:orange"><span>Amount Paid</span><span>' + fmt(r.amtPaid) + '</span></div>' +
        '<div class="r" style="color:red"><span>Balance Owed</span><span>' + fmt(r.balance) + '</span></div>'
      : ''

  const splitLine = r.splitAmounts
    ? '<div style="font-size:11px;margin-top:4px">' + Object.entries(r.splitAmounts)
        .filter(([, v]) => parseFloat(v) > 0)
        .map(([k, v]) => esc(k) + ': ' + fmt(parseFloat(v)))
        .join(' | ') + '</div>'
    : ''

  return `<!DOCTYPE html><html><head><title>Receipt</title><style>
    *{margin:0;padding:0;box-sizing:border-box;font-family:'Courier New',monospace}
    @page { size: ${width}mm auto; margin: 0 }
    body{width:${contentMm}mm;margin:auto;padding:${width === '58' ? '3mm' : '5mm'};font-size:${width === '58' ? '11px' : '12px'}}
    .c{text-align:center}.b{font-weight:bold}
    hr{border:none;border-top:1px dashed #999;margin:8px 0}
    .r{display:flex;justify-content:space-between;margin:3px 0;font-size:12px}
    .logo{font-size:28px;margin-bottom:4px}
  </style></head><body>
    <div class="c">
      ${logo}
      ${bizLines}
    </div>
    <hr/>
    <div class="r"><span>Receipt:</span><span>${esc(r.id)}</span></div>
    <div class="r"><span>Date:</span><span>${esc(date)}</span></div>
    <div class="r"><span>Client:</span><span>${esc(r.client)}</span></div>
    <hr/>
    ${itemRows}
    <hr/>
    <div class="r"><span>Subtotal</span><span>${fmt(r.subtotal)}</span></div>
    ${Number(r.disc) > 0 ? '<div class="r" style="color:green"><span>Discount</span><span>-' + fmt(r.disc) + '</span></div>' : ''}
    <div class="r b" style="font-size:15px"><span>TOTAL</span><span>${fmt(r.total)}</span></div>
    ${taxRows}
    <div class="r"><span>Payment</span><span>${esc(r.method)}</span></div>
    ${paymentRows}
    ${splitLine}
    <hr/>
    ${s.refund_policy ? '<div style="font-size:10px;color:#666;margin-bottom:6px;text-align:center">' + esc(s.refund_policy) + '</div><hr/>' : ''}
    <div class="c" style="font-size:11px;color:#999;margin-top:8px">${esc(s.receipt_footer || 'Thank you for your patronage!')}</div>
  </body></html>`
}