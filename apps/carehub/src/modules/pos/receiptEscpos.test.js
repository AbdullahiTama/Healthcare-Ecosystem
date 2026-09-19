import { describe, it, expect } from 'vitest'
import { buildReceiptEscpos } from './receiptEscpos.js'

const base = {
  receipt: {
    id: 'TXN-100001',
    client: 'Ayo Ade',
    items: [{ name: 'Amoxicillin 500mg', price: 1500, qty: 2 }, { name: 'Paracetamol', price: 800, qty: 1 }],
    subtotal: 3800,
    disc: 0,
    total: 3800,
    method: 'Cash',
    cashGiven: 4000,
    date: '2026-08-14T10:30:00',
  },
  business: { name: 'Health Plus Pharmacy', address: '12 Marina', phone: '0801', whatsapp: '0802' },
  settings: { receipt_header: 'NAFDAC: A1', refund_policy: 'No refund', receipt_footer: 'Thanks!', tax_rate: 0 },
}

// Decodes printable text from the byte stream by stripping known ESC/POS
// command sequences so no ESC/GS bytes leak into line-length assertions.
function textLines(bytes) {
  const lines = []
  let cur = ''
  for (let i = 0; i < bytes.length;) {
    const b = bytes[i]
    if (b === 0x1b) {
      const n = bytes[i + 1]
      if (n === 0x40) { i += 2; continue } // ESC @
      if (n === 0x61 || n === 0x45) { i += 3; continue } // ESC a n / ESC E n
      i += 1; continue
    }
    if (b === 0x1d) {
      const n = bytes[i + 1]
      if (n === 0x21) { i += 3; continue } // GS ! n
      if (n === 0x56) { i += bytes[i + 2] === 0x42 ? 4 : 3; continue } // GS V ...
      i += 1; continue
    }
    if (b === 0x0a) { lines.push(cur); cur = ''; i++; continue }
    if (b >= 0x20 && b <= 0x7e) { cur += String.fromCharCode(b); i++; continue }
    i++
  }
  return lines
}

const lines = (input) => textLines(buildReceiptEscpos(input))
const joined = (input) => lines(input).join('\n')

describe('buildReceiptEscpos', () => {
  it('starts with ESC @ init and ends with the partial-cut command', () => {
    const bytes = buildReceiptEscpos(base)
    expect([bytes[0], bytes[1]]).toEqual([0x1b, 0x40])
    const tail = Array.from(bytes.slice(-6))
    expect(tail).toEqual([0x0a, 0x0a, 0x1d, 0x56, 0x42, 0x00])
  })

  it('renders the business header, meta rows, items, totals and footer', () => {
    const out = joined(base)
    expect(out).toContain('Health Plus Pharmacy')
    expect(out).toContain('12 Marina')
    expect(out).toContain('WhatsApp: 0802')
    expect(out).toContain('NAFDAC: A1')
    expect(out).toContain('Receipt:')
    expect(out).toContain('TXN-100001')
    expect(out).toContain('Client:')
    expect(out).toContain('Ayo Ade')
    expect(out).toContain('Amoxicillin 500mg')
    expect(out).toContain('2 x N1,500')
    expect(out).toContain('N3,000')
    expect(out).toContain('Subtotal')
    expect(out).toContain('TOTAL')
    expect(out).toContain('Payment')
    expect(out).toContain('Cash')
    expect(out).toContain('No refund')
    expect(out).toContain('Thanks!')
  })

  it('uses the receipt date instead of the print time', () => {
    expect(joined(base)).toContain('14 Aug 2026, 10:30')
  })

  it('keeps every line inside the column budget for each roll width', () => {
    for (const [width, cols] of [['58', 32], ['80', 48], [undefined, 48]]) {
      const ls = lines({ ...base, settings: { ...base.settings, receipt_width: width } })
      expect(ls.every(l => l.length <= cols), `${width}: ${JSON.stringify(ls)} <= ${cols}`).toBe(true)
      expect(ls.some(l => l.length > 20)).toBe(true)
    }
  })

  it('wraps long item names onto continuation lines within budget', () => {
    const ls = lines({
      ...base,
      receipt: { ...base.receipt, items: [{ name: 'Amoxicillin Clavulanate Potassium Tablets 625mg', price: 1500, qty: 2 }] },
      settings: { ...base.settings, receipt_width: '58' },
    })
    expect(ls.filter(l => l.includes('Amoxicillin') || l.includes('Clavulanate') || l.includes('Potassium')).length).toBeGreaterThanOrEqual(2)
    expect(ls.every(l => l.length <= 32)).toBe(true)
    // The qty x price row still lands on its own aligned line.
    expect(ls.some(l => l.startsWith('2 x N1,500') && l.endsWith('N3,000'))).toBe(true)
  })

  it('shows tax lines only when a rate is configured', () => {
    const taxed = joined({ ...base, settings: { ...base.settings, tax_rate: 7.5 } })
    expect(taxed).toContain('Tax (7.5%)')
    expect(taxed).toContain('N285')
    expect(taxed).toContain('Total incl. tax')
    expect(taxed).toContain('N4,085')
    expect(joined(base)).not.toContain('Total incl. tax')
  })

  it('renders cash given and change for cash sales', () => {
    const out = joined(base)
    expect(out).toContain('Cash Given')
    expect(out).toContain('N4,000')
    expect(out).toContain('Change')
    expect(out).toContain('N200')
  })

  it('renders amount paid and balance owed for credit sales', () => {
    const out = joined({
      ...base,
      receipt: { ...base.receipt, method: 'Credit', amtPaid: 1000, balance: 2800, cashGiven: 0 },
    })
    expect(out).toContain('Amount Paid')
    expect(out).toContain('N1,000')
    expect(out).toContain('Balance Owed')
    expect(out).toContain('N2,800')
  })

  it('renders split payment amounts and drops empty entries', () => {
    const out = joined({
      ...base,
      receipt: { ...base.receipt, method: 'Split', splitAmounts: { Cash: '2000', POS: '1800', Transfer: '' }, cashGiven: 0 },
    })
    expect(out).toContain('Cash: N2,000')
    expect(out).toContain('POS: N1,800')
    expect(out).not.toContain('Transfer')
  })

  it('shows the discount row only when a discount was given', () => {
    const discounted = joined({ ...base, receipt: { ...base.receipt, disc: 300 } })
    expect(discounted).toContain('Discount')
    expect(discounted).toContain('-N300')
    expect(joined(base)).not.toContain('Discount')
  })

  it('folds accented characters to base ASCII and maps the naira sign', () => {
    const out = joined({
      ...base,
      business: { name: 'Café Pharmaï Nigéria' },
      receipt: { ...base.receipt, client: 'Adéyemitémi' },
    })
    expect(out).toContain('Cafe Pharmai Nigeria')
    expect(out).toContain('Adeyemitemi')
  })

  it('drops emoji glyphs instead of printing ? placeholders', () => {
    const out = joined({
      ...base,
      business: { name: '💊 Health Plus 🏥' },
    })
    expect(out).toContain('Health Plus')
    expect(out).not.toContain('?')
  })

  it('replaces unmappable CJK characters with ? so bytes stay CP437-safe', () => {
    const out = joined({ ...base, business: { name: '健康药房' } })
    expect(out).toContain('?')
    // Beyond text bytes the stream legitimately contains control command
    // bytes (ESC/GS); check only that no printable byte escaped the ASCII range.
    const bytes = buildReceiptEscpos({ ...base, business: { name: '健康药房' } })
    expect(bytes.filter(b => b >= 0x20).every(b => b <= 0x7e)).toBe(true)
  })

  it('uses double-size lettering only when the name fits the roll', () => {
    const shortBytes = buildReceiptEscpos(base)
    expect(Array.from(shortBytes.slice(2, 11))).toEqual([0x1b, 0x61, 0x00, 0x1d, 0x21, 0x11, 0x1b, 0x45, 0x01])

    const longName = { ...base, business: { name: 'Health Plus Pharmacy & Stores Unlimited Ventures' } }
    const longBytes = buildReceiptEscpos(longName)
    const seq = Array.from(longBytes)
    expect(seq.includes(0x11)).toBe(false)
    expect(joined(longName)).toContain('Health Plus Pharmacy')
  })

  it('encodes a reprint-shaped receipt object identically to a fresh sale', () => {
    // Reprint rebuilds the object from a DB row (Recent Sales view): parsed
    // items array, ISO created_at date, derived cashGiven.
    const reprintShape = {
      receipt: {
        id: 'TXN-100001',
        client: 'Ayo Ade',
        items: JSON.parse(JSON.stringify(base.receipt.items)),
        subtotal: 3800,
        disc: 0,
        total: 3800,
        method: 'Cash',
        cashGiven: 4000,
        amtPaid: 4000,
        balance: 0,
        splitAmounts: null,
        date: '2026-08-14T10:30:00',
      },
      business: base.business,
      settings: base.settings,
    }
    expect(buildReceiptEscpos(reprintShape)).toEqual(buildReceiptEscpos(base))
  })
})
