import { describe, it, expect } from 'vitest'
import { fromServer, estimateFromBrand, bannerText, wantsDailyNotice, seesPlanAlerts, restrictedMessage, isRestricted, daysUntil } from './planStatus.js'

const NOW = new Date('2026-10-27T10:00:00Z')
const inDays = (d) => new Date(NOW.getTime() + d * 86400000).toISOString()

describe('reading the database answer', () => {
  it('normalises business_plan_status and counts days', () => {
    const s = fromServer({ plan: 'growth', state: 'grace', expires_at: inDays(-3), grace_ends_at: inDays(4), limits: { locations: 5 } }, NOW)
    expect(s).toMatchObject({ plan: 'growth', state: 'grace', daysLeft: -3, graceDaysLeft: 4, enforced: true, limits: { locations: 5 } })
    expect(fromServer(null)).toBeNull()
  })

  it('before the database function exists, estimates from the expiry date and never restricts', () => {
    expect(estimateFromBrand({ plan_expires_at: inDays(30) }, NOW).state).toBe('active')
    expect(estimateFromBrand({ plan_expires_at: inDays(5) }, NOW).state).toBe('expiring')
    const lapsed = estimateFromBrand({ plan_expires_at: inDays(-90) }, NOW)
    expect(lapsed.state).toBe('grace')
    expect(lapsed.enforced).toBe(false)
    expect(isRestricted(lapsed)).toBe(false)
    expect(estimateFromBrand({}, NOW).state).toBe('active')
    expect(daysUntil(null)).toBeNull()
  })
})

describe('what people are told', () => {
  it('counts down before expiry, then the grace days, then explains what is paused', () => {
    expect(bannerText(fromServer({ state: 'expiring', expires_at: inDays(5) }, NOW))).toBe('Your plan expires in 5 days. Renew now to keep full access.')
    expect(bannerText(fromServer({ state: 'expiring', expires_at: inDays(1) }, NOW))).toContain('in 1 day.')
    expect(bannerText(fromServer({ state: 'grace', expires_at: inDays(-2), grace_ends_at: inDays(5) }, NOW))).toMatch(/expired 2 days ago\. Renew within 5 days \(by .+\) to avoid restrictions/)
    expect(bannerText(fromServer({ state: 'grace', expires_at: inDays(-6), grace_ends_at: inDays(1) }, NOW))).toBe('Your plan expired 6 days ago. Restrictions start tomorrow unless you renew.')
    expect(bannerText(fromServer({ state: 'restricted', expires_at: inDays(-20), grace_ends_at: inDays(-13) }, NOW))).toBe('Your plan has expired and some features are paused. Sales and your records are not affected.')
    expect(bannerText(estimateFromBrand({ plan_expires_at: inDays(-40) }, NOW))).toBe('Your plan expired 40 days ago. Renew now to avoid interruptions.')
    expect(bannerText(fromServer({ state: 'active', expires_at: inDays(90) }, NOW))).toBeNull()
  })

  it('pops up daily in the last week, during grace and while restricted', () => {
    expect(wantsDailyNotice(fromServer({ state: 'expiring', expires_at: inDays(10) }, NOW))).toBe(false)
    expect(wantsDailyNotice(fromServer({ state: 'expiring', expires_at: inDays(7) }, NOW))).toBe(true)
    expect(wantsDailyNotice(fromServer({ state: 'grace', expires_at: inDays(-1) }, NOW))).toBe(true)
    expect(wantsDailyNotice(fromServer({ state: 'restricted', expires_at: inDays(-30) }, NOW))).toBe(true)
    expect(wantsDailyNotice(null)).toBe(false)
  })

  it('alerts go to the owner and managers; paused actions say what is still working', () => {
    expect(seesPlanAlerts('Owner')).toBe(true)
    expect(seesPlanAlerts('Store Manager')).toBe(true)
    expect(seesPlanAlerts('Cashier')).toBe(false)
    expect(restrictedMessage('adding staff')).toBe('Your CareHub plan has expired, so adding staff is paused. Renew it in Settings to continue. Sales and your records are not affected.')
  })
})
