// The safety-report receipt e-mail: it exists for CareFind only, carries the reference and nothing clinical, escapes anything
// a reporter typed into their name, and links to the tracking page with the number.
import { describe, it, expect } from 'vitest'
import { getTemplate } from '../templates/index.js'

const render = (payload) => String(getTemplate('adr_report_received', 'carefind')(payload))

describe('adr_report_received', () => {
  it('is registered for CareFind and fails closed for CareHub (no mislabelled brand)', () => {
    expect(typeof getTemplate('adr_report_received', 'carefind')).toBe('function')
    expect(getTemplate('adr_report_received', 'carehub')).toBeNull()
  })

  it('states the report number, links to tracking with it, and greets by name', () => {
    const html = render({ recipient_name: 'Ada', report_number: 'ADR-2026-000123' })
    expect(html).toContain('We received your safety report')
    expect(html).toContain('Hi Ada,')
    expect(html).toContain('ADR-2026-000123')
    expect(html).toContain('/track-report?ref=ADR-2026-000123')
  })

  it('works without a name and accepts the camelCase shape too', () => {
    expect(render({ report_number: 'ADR-2026-000007' })).toContain('Hi there,')
    expect(render({ reportNumber: 'ADR-2026-000008', fullName: 'Bola' })).toContain('ADR-2026-000008')
  })

  it('escapes a hostile name and never lets it become markup', () => {
    const html = render({ recipient_name: '<script>alert(1)</script>', report_number: 'ADR-2026-000123' })
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('carries no clinical or personal detail beyond the reference, and says so', () => {
    const html = render({
      recipient_name: 'Ada', report_number: 'ADR-2026-000123',
      // fields a careless caller might add: they must not be printed
      patient_identifier: 'PATIENT-SECRET', product: 'Ampiclox', reaction: 'Anaphylaxis', company: 'Acme Pharma',
    })
    for (const secret of ['PATIENT-SECRET', 'Ampiclox', 'Anaphylaxis', 'Acme Pharma']) expect(html).not.toContain(secret)
    expect(html).toContain('does not include the details of your report')
  })

  it('does not break when the number is missing', () => {
    expect(() => render({})).not.toThrow()
  })
})
