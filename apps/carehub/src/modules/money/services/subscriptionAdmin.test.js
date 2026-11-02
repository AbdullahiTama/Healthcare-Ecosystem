import { describe, it, expect } from 'vitest'
import {
  paymentStatus, availableActions, validateForm, buildRequest, previewExpiry, readableError, summarize, filterRows,
  describeHistory, emptyForm, accessLabel, SUBSCRIPTION_EXPORT_COLUMNS,
} from './subscriptionAdmin'
import { toCsv } from '../../../lib/carefindhubExports'

const NOW = new Date('2026-11-02T10:00:00Z')
const row = (over = {}) => ({
  business_id: 'b1', name: 'Ada Pharmacy', owner_name: 'Ada', email: 'ada@x.com', phone: '0801', state: 'Lagos',
  plan: 'basic', plan_state: 'active', suspended: false, access_type: 'paid',
  expires_at: '2026-12-31T00:00:00Z', period_start: '2026-10-01T00:00:00Z', ...over,
})
const form = (over = {}) => ({ ...emptyForm('change_plan'), reason: 'Agreed upgrade', ...over })

describe('payment status', () => {
  it.each([
    [{ suspended: true }, 'Suspended'],
    [{ plan_state: 'restricted' }, 'Overdue — restricted'],
    [{ plan_state: 'grace' }, 'Overdue — in grace'],
    [{ plan_state: 'expiring' }, 'Paid — renewal due'],
    [{}, 'Paid'],
    [{ access_type: 'trial' }, 'Free trial'],
    [{ access_type: 'partnership' }, 'Partnership'],
    [{ access_type: 'admin' }, 'Set by admin'],
    [{ access_type: 'none' }, 'Not paid yet'],
  ])('%o → %s', (over, label) => {
    expect(paymentStatus(row(over)).label).toBe(label)
  })

  it('labels how access was obtained', () => {
    expect(accessLabel('none')).toBe('Signup period (never paid)')
    expect(accessLabel('promotion')).toBe('Promotion')
  })
})

describe('available actions', () => {
  it('offers activate (and plan change) only while suspended', () => {
    expect(availableActions(row({ suspended: true }))).toEqual(['activate', 'change_plan'])
  })
  it('hides time-based grants when the plan has no expiry', () => {
    expect(availableActions(row({ expires_at: null }))).toEqual(['change_plan', 'set_expiry', 'suspend'])
  })
  it('offers everything else normally', () => {
    expect(availableActions(row())).toEqual(['change_plan', 'grant', 'extend', 'set_expiry', 'suspend'])
  })
})

describe('validation mirrors the database', () => {
  it.each([
    [form({ reason: 'x' }), /reason/],
    [form({ reason: 'y'.repeat(501) }), /under 500/],
    [form({ plan: '' }), /Choose a plan/],
    [form({ plan: 'basic' }), /already on this plan/],
    [form({ action: 'grant', grantType: 'bribe' }), /kind of access/],
    [form({ action: 'extend', duration: 'days', days: '0' }), /between 1 and 3650/],
    [form({ action: 'extend', duration: 'days', days: '2.5' }), /between 1 and 3650/],
    [form({ action: 'set_expiry', expiresOn: '' }), /expiry date/],
    [form({ action: 'activate' }), /not available/],
  ])('refuses %#', (f, message) => {
    expect(validateForm(f, row())).toMatch(message)
  })

  it('accepts complete forms', () => {
    expect(validateForm(form({ plan: 'premium' }), row())).toBeNull()
    expect(validateForm(form({ action: 'grant', grantType: 'trial', duration: 'm6' }), row())).toBeNull()
    expect(validateForm(form({ action: 'extend', duration: 'days', days: '45' }), row())).toBeNull()
    expect(validateForm(form({ action: 'suspend' }), row())).toBeNull()
    expect(validateForm(form({ action: 'activate' }), row({ suspended: true }))).toBeNull()
  })
})

describe('requests', () => {
  it('builds each action with only the fields it needs', () => {
    expect(buildRequest(form({ plan: 'premium', reason: '  Upgrade  ' }), row())).toEqual({ businessId: 'b1', action: 'change_plan', reason: 'Upgrade', plan: 'premium' })
    expect(buildRequest(form({ action: 'grant', grantType: 'partnership', duration: 'm12' }), row())).toEqual({ businessId: 'b1', action: 'grant', reason: 'Agreed upgrade', months: 12, days: null, grantType: 'partnership', plan: null })
    expect(buildRequest(form({ action: 'extend', duration: 'days', days: '10' }), row())).toEqual({ businessId: 'b1', action: 'extend', reason: 'Agreed upgrade', months: null, days: 10 })
    expect(buildRequest(form({ action: 'set_expiry', expiresOn: '2027-01-31' }), row())).toEqual({ businessId: 'b1', action: 'set_expiry', reason: 'Agreed upgrade', expiresAt: '2027-01-31T23:59:59+01:00' })
    expect(buildRequest(form({ action: 'suspend' }), row())).toEqual({ businessId: 'b1', action: 'suspend', reason: 'Agreed upgrade' })
  })

  it('previews the new expiry after paid time, or from today once expired', () => {
    const later = previewExpiry(form({ action: 'extend', duration: 'm1' }), row(), NOW)
    expect(later.toISOString().slice(0, 10)).toBe('2027-01-31')
    const fromToday = previewExpiry(form({ action: 'grant', duration: 'days', days: '30' }), row({ expires_at: '2026-10-01T00:00:00Z' }), NOW)
    expect(fromToday.toISOString().slice(0, 10)).toBe('2026-12-02')
    expect(previewExpiry(form({ action: 'suspend' }), row(), NOW)).toBeNull()
  })
})

describe('errors', () => {
  it('explains a missing database update instead of a raw 404', () => {
    expect(readableError(new Error('Supabase error (404): Could not find the function public.admin_subscription_overview'))).toMatch(/carehub_20261230/)
  })
  it('passes the database sentence through without the transport prefix', () => {
    expect(readableError(new Error('Supabase error (400): This subscription is already suspended'))).toBe('This subscription is already suspended')
  })
  it('names a permission refusal', () => {
    expect(readableError(new Error('Supabase error (403): Only a platform administrator can manage subscriptions'))).toMatch(/platform administrator/)
  })
})

describe('lists', () => {
  const rows = [
    row(),
    row({ business_id: 'b2', name: 'Bola Clinic', plan: 'growth', plan_state: 'expiring', expires_at: '2026-11-10T00:00:00Z' }),
    row({ business_id: 'b3', name: 'Chi Labs', plan_state: 'restricted', access_type: 'trial' }),
    row({ business_id: 'b4', name: 'Dee Mart', suspended: true, access_type: 'suspended', plan_state: 'restricted' }),
  ]
  it('summarises without double-counting suspended businesses', () => {
    expect(summarize(rows, NOW)).toMatchObject({ total: 4, active: 1, expiring: 1, overdue: 1, complimentary: 1, suspended: 1 })
  })
  it('filters by state, plan, access and text', () => {
    expect(filterRows(rows, { state: 'restricted' }).map(r => r.business_id)).toEqual(['b3'])
    expect(filterRows(rows, { state: 'suspended' }).map(r => r.business_id)).toEqual(['b4'])
    expect(filterRows(rows, { plan: 'growth' }).map(r => r.business_id)).toEqual(['b2'])
    expect(filterRows(rows, { access: 'complimentary' }).map(r => r.business_id)).toEqual(['b3'])
    expect(filterRows(rows, { search: 'bola' }).map(r => r.business_id)).toEqual(['b2'])
  })
  it('exports the columns admins asked for', () => {
    const csv = toCsv(SUBSCRIPTION_EXPORT_COLUMNS, [row({ last_payment_amount: 5000, total_paid: 5000, payment_count: 1 })])
    const [header, line] = csv.split('\n')
    expect(header).toContain('Payment status')
    expect(header).toContain('Current period start')
    expect(header).toContain('Expiry date')
    expect(line).toContain('2026-12-31')
    expect(line).toContain('Paid')
  })
})

describe('history lines', () => {
  it('describes payments and administrative changes', () => {
    expect(describeHistory({ kind: 'payment', payment_method: 'paystack', months: 12, plan_after: 'basic' })).toBe('Payment (paystack) for 12 months of Basic')
    expect(describeHistory({ kind: 'admin', action: 'change_plan', plan_before: 'basic', plan_after: 'premium' })).toBe('Plan changed from Basic to Premium')
    expect(describeHistory({ kind: 'admin', action: 'grant', grant_type: 'trial', days: 30, plan_before: 'basic', plan_after: 'basic' })).toBe('Free trial access granted: 30 days')
    expect(describeHistory({ kind: 'admin', action: 'extend', months: 1 })).toBe('Extended by 1 month')
    expect(describeHistory({ kind: 'admin', action: 'suspend' })).toBe('Suspend')
  })
})
