import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EmailService } from '@care-ecosystem/shared-email'
import { enqueue } from '../_lib/emailService.js'

// Proves the CareFind handler → shared EmailService path preserves the
// deterministic idempotency key and source id that keep refresh/webhook/retry
// from enqueueing duplicates, and that failures cannot be confused for success.

describe('carefind emailService.enqueue', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('forwards idempotencyKey and sourceId to the outbox insert', async () => {
    const spy = vi.spyOn(EmailService.prototype, 'enqueue').mockResolvedValue({ id: 'x' })
    await enqueue({
      templateKey: 'booking_confirmed',
      toEmail: 'a@b.com',
      payload: { fullName: 'A' },
      subject: 'Hi',
      sourceId: 'appt-1',
      idempotencyKey: 'booking-confirmed:appt-1',
    })
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({
      templateKey: 'booking_confirmed',
      idempotencyKey: 'booking-confirmed:appt-1',
      sourceId: 'appt-1',
    }))
  })

  it('produces a different key per entity so unrelated events are not deduped away', async () => {
    const spy = vi.spyOn(EmailService.prototype, 'enqueue').mockResolvedValue({ id: 'x' })
    await enqueue({ templateKey: 'booking_confirmed', toEmail: 'a@b.com', payload: {}, subject: 's', idempotencyKey: 'booking-confirmed:a1' })
    await enqueue({ templateKey: 'booking_confirmed', toEmail: 'a@b.com', payload: {}, subject: 's', idempotencyKey: 'booking-confirmed:a2' })
    const keys = spy.mock.calls.map((c) => c[0].idempotencyKey)
    expect(keys).toEqual(['booking-confirmed:a1', 'booking-confirmed:a2'])
  })

  it('surfaces template render errors instead of pretending success', async () => {
    vi.spyOn(EmailService.prototype, 'enqueue').mockRejectedValue(new Error('EMAIL_FROM is not configured'))
    await expect(enqueue({ templateKey: 'booking_confirmed', toEmail: 'a@b.com', payload: {}, subject: 's' }))
      .rejects.toThrow('EMAIL_FROM is not configured')
  })
})
