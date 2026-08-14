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
    expect(buildReceiptHtml({ ...base, settings: { ...base.settings, receipt_width: '58' } })).toContain('@page { size: 58mm auto')
    expect(buildReceiptHtml({ ...base, settings: { ...base.settings, receipt_width: '80' } })).toContain('@page { size: 80mm auto')
    expect(buildReceiptHtml({ ...base, settings: { ...base.settings } })).toContain('@page { size: 80mm auto')
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
    expect(html).toContain('Cash: ₦2,000')
    expect(html).toContain('POS: ₦1,800')
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
})