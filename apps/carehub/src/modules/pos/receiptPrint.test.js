import { describe, it, expect } from 'vitest'
import { buildReceiptHtml, computeTax, fmtReceiptDate } from './receiptPrint.js'

const base = {
  receipt: {
    id: 'TXN-100001',
    client: 'Ayo Ade',
    items: [{ name: 'Amoxicillin 500mg', price: 1500, qty: 2, emoji: '💊' }, { name: 'Paracetamol', price: 800, qty: 1 }],
    subtotal: 3800,
    disc: 0,
    total: 3800,
    method: 'Cash',
    cashGiven: 4000,
    date: '2026-08-14T10:30:00',
  },
  business: { name: 'Health Plus Pharmacy', address: '12 Marina', phone: '0801', whatsapp: '0802' },
  settings: { logo_url: '', receipt_header: 'NAFDAC: A1', refund_policy: 'No refund', receipt_footer: 'Thanks!', tax_rate: 0 },
}

describe('computeTax', () => {
  it('returns 0 when there is no rate or no total', () => {
    expect(computeTax(0, 7.5)).toBe(0)
    expect(computeTax(3800, 0)).toBe(0)
    expect(computeTax(3800, '')).toBe(0)
  })

  it('computes total × rate / 100', () => {
    expect(computeTax(3800, 7.5)).toBe(285)
    expect(computeTax(1000, 10)).toBe(100)
  })
})

describe('fmtReceiptDate', () => {
  it('formats an ISO timestamp in en-NG medium/short style', () => {
    expect(fmtReceiptDate('2026-08-14T10:30:00')).toMatch(/2026/)
  })

  it('falls back to the current time when no date is given', () => {
    expect(fmtReceiptDate(null)).toMatch(/2026/)
  })
})

describe('buildReceiptHtml', () => {
  it('escapes user-entered business, client, product and settings text', () => {
    const html = buildReceiptHtml({
      receipt: { ...base.receipt, client: 'Ayo <script>alert(1)</script>', items: [{ name: 'Goat <b>tea</b>', price: 100, qty: 1 }] },
      business: { name: 'Pharm & <Shop>', address: '1 "Main" St' },
      settings: { receipt_header: 'H&<H>', refund_policy: 'R&<R>', receipt_footer: 'F&<F>', tax_rate: 0, logo_url: 'x" onerror="alert(1)' },
    })
    expect(html).toContain('Pharm &amp; &lt;Shop&gt;')
    expect(html).toContain('1 &quot;Main&quot; St')
    expect(html).toContain('Ayo &lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).toContain('Goat &lt;b&gt;tea&lt;/b&gt;')
    expect(html).toContain('H&amp;&lt;H&gt;')
    expect(html).toContain('R&amp;&lt;R&gt;')
    expect(html).toContain('F&amp;&lt;F&gt;')
    expect(html).toContain('x&quot; onerror=&quot;alert(1)')
    expect(html).not.toContain('<script>')
  })

  it('sizes the page @page rule to the configured width', () => {
    expect(buildReceiptHtml({ ...base, settings: { ...base.settings, receipt_width: '58' } })).toContain('size:58mm')
    expect(buildReceiptHtml({ ...base, settings: { ...base.settings, receipt_width: '80' } })).toContain('size:80mm')
    expect(buildReceiptHtml({ ...base, settings: { ...base.settings } })).toContain('size:80mm')
  })

  it('shows a tax line and tax-inclusive total only when a rate is set', () => {
    const taxed = buildReceiptHtml({ ...base, settings: { ...base.settings, tax_rate: 7.5 } })
    expect(taxed).toContain('Tax (7.5%)')
    expect(taxed).toContain('₦285')
    expect(taxed).toContain('Total incl. tax')
    expect(taxed).toContain('₦4,085')

    const untaxed = buildReceiptHtml(base)
    expect(untaxed).not.toContain('Tax')
    expect(untaxed).not.toContain('Total incl. tax')
  })

  it('renders cash given and change for cash sales', () => {
    const html = buildReceiptHtml(base)
    expect(html).toContain('Cash Given')
    expect(html).toContain('₦4,000')
    expect(html).toContain('Change')
    expect(html).toContain('₦200')
  })

  it('renders amount paid and balance owed for credit sales', () => {
    const html = buildReceiptHtml({
      ...base,
      receipt: { ...base.receipt, method: 'Credit', amtPaid: 1000, balance: 2800, cashGiven: 0 },
    })
    expect(html).toContain('Amount Paid')
    expect(html).toContain('₦1,000')
    expect(html).toContain('Balance Owed')
    expect(html).toContain('₦2,800')
  })

  it('renders split payment amounts', () => {
    const html = buildReceiptHtml({
      ...base,
      receipt: { ...base.receipt, method: 'Split', splitAmounts: { Cash: '2000', POS: '1800', Transfer: '' }, cashGiven: 0 },
    })
    expect(html).toContain('Cash')
    expect(html).toContain('₦2,000')
    expect(html).toContain('POS')
    expect(html).toContain('₦1,800')
    expect(html).not.toContain('Transfer')
  })

  it('uses the receipt date instead of the print time', () => {
    const html = buildReceiptHtml(base)
    expect(html).toContain('14 Aug 2026, 10:30')
  })

  it('shows the logo when a logo_url is configured and omits it otherwise', () => {
    expect(buildReceiptHtml({ ...base, settings: { ...base.settings, logo_url: 'https://x/logo.png' } })).toContain('<img src="https://x/logo.png"')
    expect(buildReceiptHtml(base)).not.toContain('<img')
  })

  // ── EDGE CASES ──────────────────────────────────────────────────────────

  it('renders long product names without clipping the price', () => {
    const html = buildReceiptHtml({
      ...base,
      receipt: {
        ...base.receipt,
        items: [{ name: 'CARDIAC TROPONIN I RAPID DIAGNOSTIC TEST KIT', price: 11000, qty: 1 }],
        subtotal: 11000, total: 11000,
      },
    })
    expect(html).toContain('CARDIAC TROPONIN I RAPID DIAGNOSTIC TEST KIT')
    expect(html).toContain('₦11,000')
    // Name must use word-break CSS to prevent overflow
    expect(html).toContain('word-break:break-word')
  })

  it('renders large prices correctly (₦999,999 and ₦1,500,000)', () => {
    const html = buildReceiptHtml({
      ...base,
      receipt: {
        ...base.receipt,
        items: [{ name: 'Expensive Drug', price: 1500000, qty: 1 }],
        subtotal: 1500000, total: 1500000, cashGiven: 2000000,
      },
    })
    expect(html).toContain('₦1,500,000')
    expect(html).toContain('₦2,000,000')
    expect(html).toContain('₦500,000')
  })

  it('handles empty/optional client and business fields', () => {
    const html = buildReceiptHtml({
      ...base,
      receipt: { ...base.receipt, client: '' },
      business: { name: '', address: '', phone: '', whatsapp: '' },
      settings: { ...base.settings, receipt_header: '', refund_policy: '', receipt_footer: '' },
    })
    // Should not crash, should still render core receipt
    expect(html).toContain('TXN-100001')
    expect(html).toContain('Subtotal')
    expect(html).toContain('TOTAL')
  })

  it('uses 58mm body width when receipt_width is 58', () => {
    const html = buildReceiptHtml({ ...base, settings: { ...base.settings, receipt_width: '58' } })
    expect(html).toContain('width:58mm')
    expect(html).toContain('font-size:10.5px')
  })

  it('uses 80mm body width when receipt_width is 80', () => {
    const html = buildReceiptHtml({ ...base, settings: { ...base.settings, receipt_width: '80' } })
    expect(html).toContain('width:80mm')
    expect(html).toContain('font-size:11.5px')
  })

  it('renders 20+ items without layout breakage', () => {
    const items = Array.from({ length: 25 }, (_, i) => ({ name: 'Item ' + (i + 1), price: 100 * (i + 1), qty: 1 }))
    const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0)
    const html = buildReceiptHtml({
      ...base,
      receipt: { ...base.receipt, items, subtotal, total: subtotal },
    })
    expect(html).toContain('Item 1')
    expect(html).toContain('Item 25')
    expect(html).toContain('₦100')
    expect(html).toContain('₦2,500')
    // All items should be wrapped in grid containers
    const gridCount = (html.match(/grid-template-columns:1fr auto/g) || []).length
    expect(gridCount).toBeGreaterThanOrEqual(25)
  })

  it('uses CSS grid for label/value alignment (not flex)', () => {
    const html = buildReceiptHtml(base)
    // Should use grid for all label/value rows
    expect(html).toContain('display:grid;grid-template-columns:1fr auto')
    // Should NOT use the old flex layout
    expect(html).not.toContain('display:flex;justify-content:space-between')
  })

  it('sets @page margin to zero for thermal printers', () => {
    const html = buildReceiptHtml(base)
    expect(html).toContain('@page{size:80mm auto;margin:0}')
  })

  it('includes print media query to remove padding', () => {
    const html = buildReceiptHtml(base)
    expect(html).toContain('@media print{body{padding:0}}')
  })

  it('renders items with emoji prefix when provided', () => {
    const html = buildReceiptHtml({
      ...base,
      receipt: { ...base.receipt, items: [{ name: 'Paracetamol', price: 500, qty: 1, emoji: '💊' }] },
    })
    expect(html).toContain('💊 Paracetamol')
  })

  it('renders items without emoji when not provided', () => {
    const html = buildReceiptHtml({
      ...base,
      receipt: { ...base.receipt, items: [{ name: 'Paracetamol', price: 500, qty: 1 }] },
    })
    expect(html).toContain('Paracetamol')
    expect(html).not.toContain('undefined')
  })
})