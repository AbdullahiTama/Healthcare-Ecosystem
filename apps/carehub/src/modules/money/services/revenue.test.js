import { describe, it, expect } from 'vitest'
import { computeRevenue, lagosMonthKey, lastMonths, paymentPeriod, PAYMENT_EXPORT_COLUMNS } from './revenue'
import { toCsv } from '../../../lib/carefindhubExports'

const NOW = new Date('2026-11-02T10:00:00Z')
const pay = (over = {}) => ({ id: Math.random().toString(36), business_id: 'b1', status: 'success', months: 12, naira_amount: 60000, plan: 'basic', payment_method: 'paystack', paid_at: '2026-10-15T09:00:00Z', period_start: '2026-10-15T09:00:00Z', period_end: '2027-10-15T09:00:00Z', receipt_number: 'CH-2026-000001', ...over })
const sub = (over = {}) => ({ business_id: 'b1', name: 'Ada Pharmacy', plan: 'basic', plan_state: 'active', suspended: false, access_type: 'paid', expires_at: '2027-10-15T09:00:00Z', payment_count: 1, last_payment_amount: 60000, ...over })

describe('Lagos calendar', () => {
  it('puts a payment at 23:30 UTC on 31 Oct into November (UTC+1)', () => {
    expect(lagosMonthKey('2026-10-31T23:30:00Z')).toBe('2026-11')
    expect(lagosMonthKey('2026-10-31T22:30:00Z')).toBe('2026-10')
  })
  it('lists the last 12 months ending with the current one', () => {
    const keys = lastMonths(NOW)
    expect(keys).toHaveLength(12)
    expect(keys[0]).toBe('2025-12')
    expect(keys[11]).toBe('2026-11')
  })
  it('derives a missing period from the months bought', () => {
    const { start, end } = paymentPeriod({ paid_at: '2026-01-31T00:00:00Z', months: 1 })
    expect(start.toISOString().slice(0, 10)).toBe('2026-01-31')
    expect(end.getTime()).toBeGreaterThan(start.getTime())
  })
})

describe('computeRevenue', () => {
  const payments = [
    pay(),
    pay({ business_id: 'b2', naira_amount: 8333, months: 1, plan: 'growth', paid_at: '2026-11-01T08:00:00Z', period_start: '2026-11-01T08:00:00Z', period_end: '2026-12-01T08:00:00Z', payment_method: 'wallet' }),
    pay({ business_id: 'b3', naira_amount: 5000, months: 1, paid_at: '2026-03-01T08:00:00Z', period_start: '2026-03-01T08:00:00Z', period_end: '2026-04-01T08:00:00Z' }),
    pay({ business_id: 'b4', naira_amount: 999, status: 'failed' }),
  ]
  const subscriptions = [
    sub(),
    sub({ business_id: 'b2', name: 'Bola Clinic', plan: 'growth', plan_state: 'expiring', expires_at: '2026-12-01T08:00:00Z', last_payment_amount: 8333 }),
    sub({ business_id: 'b3', name: 'Chi Labs', plan_state: 'restricted', expires_at: '2026-04-01T08:00:00Z', last_payment_amount: 5000 }),
    sub({ business_id: 'b5', name: 'Dee Mart', access_type: 'trial', payment_count: 0, last_payment_amount: null, expires_at: '2026-11-20T00:00:00Z', plan_state: 'expiring' }),
    sub({ business_id: 'b6', name: 'Eko Spa', access_type: 'none', payment_count: 0, last_payment_amount: null, plan_state: 'grace', expires_at: '2026-10-30T00:00:00Z' }),
  ]
  const r = computeRevenue({ payments, subscriptions, now: NOW })

  it('counts only settled payments', () => {
    expect(r.paymentCount).toBe(3)
    expect(r.totalCollected).toBe(73333)
  })
  it('splits collected money by period', () => {
    expect(r.monthTotal).toBe(8333)
    expect(r.last30Total).toBe(68333)
    expect(r.months.find(m => m.key === '2026-10').total).toBe(60000)
    expect(r.months.find(m => m.key === '2026-03')).toMatchObject({ total: 5000, count: 1 })
  })
  it('earns each current payment over the months it bought; expired and free access add nothing', () => {
    expect(r.earningNow).toBe(Math.round(60000 / 12 + 8333))
    expect(r.payingCount).toBe(2)
    expect(r.arpu).toBe(Math.round(r.earningNow / 2))
  })
  it('summarises the plan mix from the live overview', () => {
    const basic = r.planMix.find(p => p.key === 'basic')
    expect(basic).toMatchObject({ businesses: 4, paying: 1, free: 1, overdue: 2, yearlyPrice: 60000 })
    expect(r.planMix.find(p => p.key === 'growth')).toMatchObject({ businesses: 1, paying: 1, yearlyPrice: 100000 })
    expect(r.freeCount).toBe(1)
    expect(r.neverPaidCount).toBe(2)
  })
  it('values renewals due and lapsed businesses at their last payment', () => {
    expect(r.renewalsDue).toMatchObject({ count: 1, value: 8333 })
    expect(r.lapsed).toMatchObject({ count: 1, value: 5000 })
    expect(r.overdueCount).toBe(2)
  })
  it('splits by method and lists recent payments with business names', () => {
    expect(r.byMethod).toEqual([{ method: 'paystack', total: 65000, count: 2 }, { method: 'wallet', total: 8333, count: 1 }])
    expect(r.recent[0]).toMatchObject({ business_name: 'Bola Clinic', naira_amount: 8333 })
  })
  it('handles no data', () => {
    const empty = computeRevenue({ now: NOW })
    expect(empty).toMatchObject({ totalCollected: 0, earningNow: 0, payingCount: 0, arpu: 0, recent: [] })
    expect(empty.months.every(m => m.total === 0)).toBe(true)
  })
  it('exports payments with receipts', () => {
    const csv = toCsv(PAYMENT_EXPORT_COLUMNS, [{ ...pay(), business_name: 'Ada Pharmacy' }])
    expect(csv.split('\n')[1]).toContain('CH-2026-000001')
    expect(csv.split('\n')[1]).toContain('Ada Pharmacy')
  })
})
