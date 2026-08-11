import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { esc, t, row, section, sig, brandHeader, printConsultation, printPharmacyConsultation } from '../../modules/consultation/consultationPrint.js'
describe('esc — HTML escaping', () => {
  it('escapes markup that could be injected through user input', () => {
    expect(esc('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(esc('a & b')).toBe('a &amp; b')
    expect(esc('say "hi"')).toBe('say &quot;hi&quot;')
  })

  it('tolerates null and undefined', () => {
    expect(esc(null)).toBe('')
    expect(esc(undefined)).toBe('')
  })
})

describe('t — print value coercion', () => {
  it('renders empty/missing values as an em dash', () => {
    expect(t(null)).toBe('—')
    expect(t(undefined)).toBe('—')
    expect(t('')).toBe('—')
    expect(t(0)).toBe('—')
  })

  it('joins arrays and escapes each element', () => {
    expect(t(['oil', '<b>spa</b>'])).toBe('oil, &lt;b&gt;spa&lt;/b&gt;')
    expect(t(['', null, 'a'])).toBe('a')
  })

  it('returns a plain string escaped', () => {
    expect(t('<Good>')).toBe('&lt;Good&gt;')
  })
})

describe('row', () => {
  it('emits a table row for present values and nothing for missing ones', () => {
    expect(row('Name', 'Ayo')).toContain('<td class="k">Name</td>')
    expect(row('Name', 'Ayo')).toContain('>Ayo</td>')
    expect(row('Phone', null)).toBe('')
  })

  it('escapes the label as well as the value', () => {
    expect(row('<b>', 'v')).toContain('&lt;b&gt;')
  })
})

describe('section', () => {
  it('omits sections whose every value is missing', () => {
    expect(section('Empty', [['A', null], ['B', '']])).toBe('')
  })

  it('emits a heading and table for sections with any value', () => {
    const out = section('Vitals', [['BP', '120/80'], ['Temp', null]])
    expect(out).toContain('<div class="sec"><h3>Vitals</h3>')
    expect(out).toContain('BP')
    expect(out).toContain('120/80')
    expect(out).not.toContain('Temp')
  })

  it('escapes section titles', () => {
    expect(section('A<B', [['x', 'y']])).toContain('<h3>A&lt;B</h3>')
  })
})

describe('sig', () => {
  it('returns empty for a missing signature image', () => {
    expect(sig(null, 'Name', '2026-01-01')).toBe('')
  })

  it('renders a signature image with name and date', () => {
    const html = sig('data:image/png;base64,xyz', 'Ayo', '2026-01-01')
    expect(html).toContain('<img src="data:image/png;base64,xyz"')
    expect(html).toContain('Ayo')
    expect(html).toContain('2026-01-01')
  })
})

describe('brandHeader', () => {
  it('renders a logo, name, address and phone', () => {
    const html = brandHeader({
      logo_url: '/logo.png',
      name: 'Midtown Pharmacy',
      address: '12 Broad St',
      city: 'Lagos',
      state: 'Lagos',
      phone: '0801',
    })
    expect(html).toContain('<img src="/logo.png"')
    expect(html).toContain('Midtown Pharmacy')
    expect(html).toContain('12 Broad St')
    expect(html).toContain('Lagos, Lagos')
  })

  it('omits the logo and blank address parts when absent', () => {
    const html = brandHeader({ name: 'X', city: '', state: '', phone: '' })
    expect(html).not.toContain('<img')
    expect(html).toContain('X')
  })

  it('escapes injected business fields', () => {
    const html = brandHeader({ name: '<script>', city: '', state: '', phone: '' })
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })
})

describe('printConsultation / printPharmacyConsultation', () => {
  let written

  beforeEach(() => {
    written = null
    const fakeWindow = {
      document: {
        write: (html) => { written = html },
        close: vi.fn(),
      },
      focus: vi.fn(),
      print: vi.fn(),
    }
    vi.stubGlobal('open', vi.fn(() => fakeWindow))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders a complete pharmacy consultation document', () => {
    printPharmacyConsultation(
      {
        client_name: 'Jane',
        consultation_date: '2026-01-01',
        provider_name: 'Dr X',
        data: JSON.stringify({
          client_info: { full_name: 'Jane', dob: '1990-01-01' },
          typing: {},
        }),
      },
      { name: 'Pharm' }
    )
    expect(written).toContain('Pharmacy Consultation Form')
    expect(written).toContain('<html><head><title>Pharmacy Consultation')
    expect(written).toContain('Jane')
  })

  it('escapes a malicious client name in the skincare template', () => {
    printConsultation(
      { client_name: '<img src=x onerror=alert(1)>', consultation_date: '2026-01-01', data: 'not-json{' },
      { name: 'Pharm' }
    )
    expect(written).not.toContain('<img src=x onerror=alert(1)>')
  })

  it('renders a complete skincare consultation document', () => {
    printConsultation(
      {
        client_name: 'Ayo',
        consultation_date: '2026-01-01',
        provider_name: 'T',
        data: JSON.stringify({
          client_info: { full_name: 'Ayo' },
          skin_concerns: { selected: ['Acne', 'Melasma'] },
        }),
      },
      { name: 'Glow Clinic' }
    )
    expect(written).toContain('Skin &amp; Aesthetic Consultation Form')
    expect(written).toContain('Ayo')
    expect(written).toContain('Acne')
  })
})
