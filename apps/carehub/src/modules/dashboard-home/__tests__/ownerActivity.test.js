import { describe, it, expect } from 'vitest'
import {
  selectOwnerActivity, countByCategory, recordTarget, describeWhat, describeWhoWhen, isNew, followUps, toneOf, activityWindow,
} from '../ownerActivity'

// The Owner is told about money records staff enter, not about every sale.
const rows = [
  { kind: 'sale', ref: 'T1', amount: 500, summary: 'T1 · Walk-in · Cash', actor_name: 'Rep One', occurred_at: '2026-10-31T09:00:00Z' },
  { kind: 'held', ref: 'H1', amount: 700, summary: 'H1', actor_name: 'Rep One', occurred_at: '2026-10-31T09:01:00Z' },
  { kind: 'stock', amount: null, summary: 'adjustment · -3', actor_name: 'Rep One', occurred_at: '2026-10-31T09:02:00Z' },
  { kind: 'checkin', summary: 'check_in', actor_name: 'Rep One', occurred_at: '2026-10-31T09:03:00Z' },
  { kind: 'purchase', ref: 'p-1', amount: 50000, summary: 'Emzor · Paracetamol · ₦30,000 unpaid', actor_name: 'Rep One', actor_role: 'Cashier', occurred_at: '2026-10-31T10:00:00Z' },
  { kind: 'supplier_payment', ref: 'p-1', amount: 10000, summary: 'Emzor · Transfer', actor_name: 'Rep One', occurred_at: '2026-10-31T11:00:00Z' },
  { kind: 'expense', ref: 'e-1', amount: 2500, summary: 'Transport · Fuel', actor_name: 'Rep Two', occurred_at: '2026-10-31T12:00:00Z' },
  { kind: 'credit_sale', ref: 'T9', amount: 3000, summary: 'T9 · Bola · Credit · ₦2,000 still owed', actor_name: 'Rep One', occurred_at: '2026-10-31T12:30:00Z' },
  { kind: 'debt', ref: 'd-1', amount: 120000, summary: 'We owe · Landlord', actor_name: 'Ada Owner', occurred_at: '2026-10-31T13:00:00Z' },
  { kind: 'refund', ref: 'T1', amount: 100, summary: 'T1 · Cash · damaged', actor_name: 'Ada Owner', occurred_at: '2026-10-31T14:00:00Z' },
  { kind: 'sale_deleted', ref: 'T3', amount: 50, summary: 'T3 · mistake', actor_name: 'Owner or unlinked', occurred_at: '2026-10-31T15:00:00Z' },
  { kind: 'shift_close', amount: 0, summary: 'Counted 5000 of expected 5000', actor_name: 'Rep One', occurred_at: '2026-10-31T18:00:00Z' },
  { kind: 'shift_close', amount: -400, summary: 'Counted 4600 of expected 5000', actor_name: 'Rep Two', occurred_at: '2026-10-31T19:00:00Z' },
]

describe('what the Owner is told about', () => {
  it('leaves out routine sales, holds, stock moves, attendance and a till that balanced', () => {
    const kinds = selectOwnerActivity(rows).map((r) => r.kind)
    expect(kinds).toEqual(['purchase', 'supplier_payment', 'expense', 'credit_sale', 'debt', 'refund', 'sale_deleted', 'shift_close'])
    expect(selectOwnerActivity(rows).find((r) => r.kind === 'shift_close').amount).toBe(-400)
  })

  it('groups into the tabs the dashboard shows, with counts', () => {
    expect(selectOwnerActivity(rows, { category: 'suppliers' }).map((r) => r.kind)).toEqual(['purchase', 'supplier_payment'])
    expect(selectOwnerActivity(rows, { category: 'credit' }).map((r) => r.kind)).toEqual(['credit_sale', 'debt'])
    expect(countByCategory(rows)).toEqual({ all: 8, suppliers: 2, expenses: 1, credit: 2, changes: 3 })
  })

  it('opens each record where it lives', () => {
    const t = (kind) => recordTarget(rows.find((r) => r.kind === kind && (kind !== 'shift_close' || r.amount)))
    expect(t('purchase')).toEqual({ path: '/dashboard/purchases?purchase=p-1' })
    expect(t('supplier_payment')).toEqual({ path: '/dashboard/purchases?purchase=p-1' })
    expect(t('expense')).toEqual({ path: '/dashboard/expenses?expense=e-1' })
    expect(t('debt')).toEqual({ path: '/dashboard/debts?debt=d-1' })
    expect(t('credit_sale')).toEqual({ sale: 'T9' })
    expect(t('refund')).toEqual({ sale: 'T1' })
    expect(t('shift_close')).toEqual({ path: '/dashboard/pos/report' })
    expect(recordTarget({ kind: 'stock' })).toBeNull()
  })

  it('says what, who and when, in Lagos time', () => {
    const p = rows.find((r) => r.kind === 'purchase')
    expect(describeWhat(p)).toBe('Purchase · Emzor · Paracetamol · ₦30,000 unpaid')
    const now = new Date('2026-10-31T16:00:00Z')
    expect(describeWhoWhen(p, { now })).toBe('Rep One (Cashier) · Today 11:00')
    expect(describeWhoWhen({ ...p, occurred_at: '2026-10-30T10:00:00Z' }, { now })).toBe('Rep One (Cashier) · Yesterday 11:00')
    expect(describeWhoWhen({ ...p, actor_role: null, occurred_at: '2026-10-27T10:00:00Z' }, { now })).toMatch(/^Rep One · 27 Oct 11:00$/)
  })

  it('marks rows after the last visit as new, and nothing on a first visit', () => {
    expect(isNew(rows[4], '2026-10-31T09:30:00Z')).toBe(true)
    expect(isNew(rows[4], '2026-10-31T10:30:00Z')).toBe(false)
    expect(isNew(rows[4], null)).toBe(false)
  })

  it('colours money going back and records being changed as warnings', () => {
    expect(toneOf({ kind: 'refund' })).toBe('warning')
    expect(toneOf({ kind: 'sale_deleted' })).toBe('warning')
    expect(toneOf({ kind: 'shift_close' })).toBe('danger')
    expect(toneOf({ kind: 'purchase' })).toBe('info')
  })

  it('covers the last seven business days, today included', () => {
    expect(activityWindow(new Date('2026-10-31T12:00:00Z'))).toEqual({ from: '2026-10-25', to: '2026-10-31' })
  })
})

describe('follow-ups', () => {
  const today = '2026-10-31'
  it('adds up what is owed to suppliers, largest first', () => {
    const f = followUps({ today, supplierBalances: [
      { supplier_name: 'Emzor', balance: 30000 }, { supplier_name: 'Fidson', balance: 45000 }, { supplier_name: 'Paid Up', balance: 0 },
    ] })
    expect(f.suppliers.count).toBe(2)
    expect(f.suppliers.amount).toBe(75000)
    expect(f.suppliers.top[0].supplier_name).toBe('Fidson')
  })

  it('finds bills past due and money owed past due, leaving credit sales to "Owed to you"', () => {
    const f = followUps({ today, debts: [
      { direction: 'we_owe', party_name: 'Landlord', balance: 120000, due_date: '2026-10-01', status: 'pending', source: 'manual' },
      { direction: 'we_owe', party_name: 'Emzor', balance: 30000, due_date: '2026-10-20', status: 'partial', source: 'purchase' },
      { direction: 'we_owe', party_name: 'Not yet', balance: 9000, due_date: '2026-11-20', status: 'pending', source: 'manual' },
      { direction: 'we_owe', party_name: 'No date', balance: 9000, due_date: '', status: 'pending', source: 'manual' },
      { direction: 'owes_us', party_name: 'Tunde', balance: 5000, due_date: '2026-10-15', status: 'pending', source: 'manual' },
      { direction: 'owes_us', party_name: 'Walk-in · T9', balance: 2000, due_date: '2026-10-15', status: 'pending', source: 'credit_sale' },
      { direction: 'we_owe', party_name: 'Settled', balance: 0, due_date: '2026-10-01', status: 'paid', source: 'manual' },
    ] })
    expect(f.overdueBills).toMatchObject({ count: 2, amount: 150000 })
    expect(f.overdueBills.top[0].party_name).toBe('Landlord')
    expect(f.overdueOwed).toMatchObject({ count: 1, amount: 5000 })
  })
})
