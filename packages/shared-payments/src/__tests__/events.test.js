import { describe, it, expect } from 'vitest'
import { paystackEventId, recordProviderEvent, finishProviderEvent } from '../events.js'
import { createFakeSupabase } from '../testing.js'

// Provider events are stored BEFORE they are processed; the unique (provider, event_id) makes a replay detectable. A replay of an event
// already handled is acknowledged without reprocessing; one whose earlier attempt FAILED must be processed again (or its retry is lost).
const row = (over = {}) => ({ provider: 'paystack', eventId: 'charge.success:1', eventType: 'charge.success', reference: 'ref_00000001', payload: { a: 1 }, signatureOk: true, ...over })

describe('paystackEventId', () => {
  it('is stable per occurrence: event name + transaction id (or reference, or transfer code)', () => {
    expect(paystackEventId({ event: 'charge.success', data: { id: 99 } })).toBe('charge.success:99')
    expect(paystackEventId({ event: 'x', data: { reference: 'r1' } })).toBe('x:r1')
    expect(paystackEventId({ event: 'transfer.success', data: { transfer_code: 'TRF_1' } })).toBe('transfer.success:TRF_1')
  })
  it('is null when there is nothing to key on', () => {
    expect(paystackEventId({ event: 'x', data: {} })).toBeNull()
    expect(paystackEventId({ data: { id: 1 } })).toBeNull()
    expect(paystackEventId(null)).toBeNull()
  })
})

describe('recordProviderEvent', () => {
  it('stores a new event and says it is new', async () => {
    const sb = createFakeSupabase()
    const r = await recordProviderEvent(sb, row())
    expect(r).toMatchObject({ isNew: true, alreadyHandled: false })
    expect(sb.data.payment_provider_events).toHaveLength(1)
  })

  it.each(['processed', 'ignored', 'duplicate'])('a replay of an event whose outcome is %s is already handled (acknowledge, do not reprocess)', async (outcome) => {
    const sb = createFakeSupabase({ tables: { payment_provider_events: [{ provider: 'paystack', event_id: 'charge.success:1', processed_at: '2026-10-05T10:00:00Z', outcome }] } })
    const r = await recordProviderEvent(sb, row())
    expect(r).toMatchObject({ isNew: false, alreadyHandled: true })
    expect(sb.data.payment_provider_events).toHaveLength(1)
  })

  it('a replay of an event that FAILED (or never finished) is NOT handled: it must be processed again', async () => {
    const failed = createFakeSupabase({ tables: { payment_provider_events: [{ provider: 'paystack', event_id: 'charge.success:1', processed_at: null, outcome: 'failed', attempts: 2 }] } })
    expect((await recordProviderEvent(failed, row())).alreadyHandled).toBe(false)
    const crashed = createFakeSupabase({ tables: { payment_provider_events: [{ provider: 'paystack', event_id: 'charge.success:1', processed_at: null, outcome: null }] } })
    expect((await recordProviderEvent(crashed, row())).alreadyHandled).toBe(false)
  })

  it('a write error that is not a duplicate is an error (the webhook answers 500 and the provider retries)', async () => {
    const sb = { from: () => ({ insert: () => ({ select: () => ({ single: async () => ({ data: null, error: { code: '08006', message: 'db down' } }) }) }) }) }
    await expect(recordProviderEvent(sb, row())).rejects.toMatchObject({ code: 'event_insert_failed' })
  })
})

describe('finishProviderEvent', () => {
  it('stamps processed_at for a finished event and counts the attempt', async () => {
    const sb = createFakeSupabase({ tables: { payment_provider_events: [{ id: 'e1', attempts: 1 }] } })
    await finishProviderEvent(sb, { id: 'e1', attempts: 1 }, { outcome: 'processed' })
    expect(sb.data.payment_provider_events[0]).toMatchObject({ outcome: 'processed', attempts: 2, last_error: null })
    expect(sb.data.payment_provider_events[0].processed_at).toBeTruthy()
  })
  it('a FAILED attempt is recorded with its error but NOT stamped processed (processed_at is write-once and the retry must still be able to set it)', async () => {
    const sb = createFakeSupabase({ tables: { payment_provider_events: [{ id: 'e1', attempts: 0 }] } })
    await finishProviderEvent(sb, { id: 'e1', attempts: 0 }, { outcome: 'failed', error: 'x'.repeat(900) })
    const e = sb.data.payment_provider_events[0]
    expect(e).toMatchObject({ outcome: 'failed', attempts: 1 })
    expect(e.last_error).toHaveLength(500)
    expect(e.processed_at).toBeUndefined()
  })
})
