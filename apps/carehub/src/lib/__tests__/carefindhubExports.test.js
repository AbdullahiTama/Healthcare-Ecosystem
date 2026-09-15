import { describe, it, expect } from 'vitest'
import { toBusinessExportRow, toBusinessCsv, toLedgerCsv, BUSINESS_EXPORT_COLUMNS } from '../carefindhubExports.js'

describe('carefindhubExports', () => {
  it('maps business to export row with required columns', () => {
    const r = toBusinessExportRow({ name:'Acme', owner:'John Doe', owner_name:'John Doe', email:'owner@acme.ng', owner_email:'owner@acme.ng', category:'pharmacy', business_type:'pharmacy', state:'Lagos', plan:'growth', status:'active', created_at:'2026-01-15T10:00:00Z' })
    expect(r.business_name).toBe('Acme')
    expect(r.owner_name).toBe('John Doe')
    expect(r.owner_email).toBe('owner@acme.ng')
    expect(r.category).toBe('pharmacy')
    expect(r.state).toBe('Lagos')
    expect(r.plan).toBe('growth')
    expect(r.status).toBe('active')
    expect(r.date_onboarded).toBe('2026-01-15')
  })
  it('produces CSV with header', () => {
    const csv = toBusinessCsv([{ name:'A', owner:'O', email:'e@a', state:'Lagos', category:'pharmacy', plan:'basic', status:'pending', created_at:'2026-02-01T00:00:00Z' }])
    expect(csv.split('\n')[0]).toBe(BUSINESS_EXPORT_COLUMNS.map(c=>c.label).join(','))
    expect(csv).toContain('A')
  })
  it('escapes csv values', () => {
    const csv = toBusinessCsv([{ name:'A, B', owner:'O"Test', email:'e@a', state:'Lagos', category:'pharmacy', plan:'basic', status:'pending', created_at:'2026-02-01T00:00:00Z' }])
    expect(csv).toContain('"A, B"')
    expect(csv).toContain('"O""Test"')
  })
  it('ledger csv balances', () => {
    const lines = [{ date:'2026-01-01', description:'Sale', type:'wallet', amount: 100 }, { date:'2026-01-02', description:'Payout', type:'payout', amount: -30 }]
    const csv = toLedgerCsv({ name:'Test' }, lines)
    expect(csv).toContain('100.00')
    expect(csv).toContain('70.00')
  })
})
