import { describe, it, expect, vi } from 'vitest'
import { sendSecurityAlert } from '../alerts.js'

const logger = () => ({ warn: vi.fn() })

describe('sendSecurityAlert', () => {
  it('returns true and logs nothing when the provider accepts', async () => {
    const l = logger()
    expect(await sendSecurityAlert('pin_changed', async () => ({ ok: true }), { logger: l })).toBe(true)
    expect(await sendSecurityAlert('pin_changed', async () => undefined, { logger: l })).toBe(true)
    expect(l.warn).not.toHaveBeenCalled()
  })

  it('a refusal is returned as false and logged as alert.failed (never thrown, never silent)', async () => {
    const l = logger()
    expect(await sendSecurityAlert('payout_account_added', async () => ({ ok: false, error: 'provider_down' }), { logger: l })).toBe(false)
    expect(l.warn).toHaveBeenCalledWith('alert.failed', { alert: 'payout_account_added', reason: 'provider_down' })
  })

  it('a thrown error is contained and logged too', async () => {
    const l = logger()
    expect(await sendSecurityAlert('pin_locked', async () => { throw new Error('socket hang up') }, { logger: l })).toBe(false)
    expect(l.warn).toHaveBeenCalledWith('alert.failed', { alert: 'pin_locked', reason: 'socket hang up' })
  })

  it('e-mail addresses in a provider message never reach the log', async () => {
    const l = logger()
    await sendSecurityAlert('pin_changed', async () => ({ ok: false, error: 'invalid recipient ada.obi@example.com' }), { logger: l })
    await sendSecurityAlert('pin_changed', async () => { throw new Error('bounce for ada.obi@example.com') }, { logger: l })
    expect(JSON.stringify(l.warn.mock.calls)).not.toContain('ada.obi@example.com')
  })
})
