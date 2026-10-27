import { describe, it, expect } from 'vitest'
import { getTemplate } from '../templates/index.js'

// The CareHub plan reminder (cron/check-subscription-expiry.js): one template, a wording for each stage.
const render = (payload) => {
  const out = getTemplate('subscription_expiry', 'carehub')({ fullName: 'Ada', plan: 'Basic', businessName: 'Allen Pharmacy', expiryDate: '20 Oct 2026', ...payload })
  return typeof out === 'string' ? out : out.html || JSON.stringify(out)
}

describe('CareHub subscription_expiry', () => {
  it('before expiry: the countdown, as before', () => {
    const html = render({ daysLeft: 3 })
    expect(html).toContain('about to expire')
    expect(html).toContain('in 3 days')
  })

  it('during grace: when restrictions start and what they will pause', () => {
    const html = render({ stage: 'expired', graceEndDate: '27 Oct 2026' })
    expect(html).toContain('has expired')
    expect(html).toContain('27 Oct 2026')
    expect(html).toContain('Sales and your records are never affected')
    expect(render({ stage: 'grace_last', graceEndDate: '27 Oct 2026' })).toContain('Restrictions start tomorrow')
  })

  it('restricted: what is paused and what still works', () => {
    const html = render({ stage: 'restricted', graceEndDate: '27 Oct 2026' })
    expect(html).toContain('Some CareHub features are paused')
    expect(html).toContain('Still working: the POS and sales, and all your records')
  })

  it('links to Settings, where renewal is (there is no /billing page)', () => {
    for (const stage of [undefined, 'expired', 'restricted', 'lapsed']) {
      const html = render({ stage, daysLeft: 3, graceEndDate: '27 Oct 2026' })
      expect(html).toContain('/dashboard/settings')
      expect(html).not.toContain('/billing')
    }
  })
})
