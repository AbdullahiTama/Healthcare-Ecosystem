import { describe, it, expect, vi, beforeEach } from 'vitest'

// The wrapper hands the shared EmailService a service-role client of its own. Without one the shared package builds its
// client by resolving '@supabase/supabase-js' from ITS directory, which on Vercel has no node_modules, so the first
// purchase confirmation would throw "Cannot find package" and (being best effort) vanish without a trace.
const h = vi.hoisted(() => ({ client: { __sentinel: 'service-role-client' }, ctor: vi.fn(), enqueue: vi.fn(), processBatch: vi.fn(), createClient: vi.fn() }))

vi.mock('@supabase/supabase-js', () => ({ createClient: (...a) => { h.createClient(...a); return h.client } }))
vi.mock('@care-ecosystem/shared-email', () => ({
  EmailService: class {
    constructor(options) { h.ctor(options) }
    enqueue(message) { return h.enqueue(message) }
    processBatch() { return h.processBatch() }
  },
}))

const { enqueue, processBatch } = await import('../emailService.js')

beforeEach(() => {
  h.ctor.mockClear(); h.enqueue.mockReset().mockResolvedValue({ id: 'row-1' }); h.processBatch.mockReset().mockResolvedValue({ sent: 1 }); h.createClient.mockClear()
  process.env.SUPABASE_URL = 'https://project.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key'
})

describe('CareFind emailService wrapper', () => {
  it('gives the shared service the service-role client instead of letting it resolve its own', async () => {
    await enqueue({ templateKey: 'payment_success', toEmail: 'a@b.com', payload: {} })
    await processBatch()

    expect(h.ctor).toHaveBeenCalledTimes(2)
    for (const [options] of h.ctor.mock.calls) expect(options).toEqual({ supabase: h.client })
    expect(h.createClient).toHaveBeenCalledWith('https://project.supabase.co', 'service-key')
  })

  it('builds that client once and reuses it', async () => {
    await enqueue({ templateKey: 'payment_success', toEmail: 'a@b.com', payload: {} })
    await enqueue({ templateKey: 'order_confirmation', toEmail: 'a@b.com', payload: {} })
    await processBatch()
    expect(h.createClient.mock.calls.length).toBeLessThanOrEqual(1)
  })

  it('enqueues as the carefind app by default and passes everything the caller named through', async () => {
    await enqueue({
      templateKey: 'order_confirmation', toEmail: 'ada@example.com', payload: { orderRef: 'CF-1' }, subject: 'Order Confirmed - CF-1',
      idempotencyKey: 'order-confirmation:o1', sourceId: 's1', eventKey: 'order_confirmation', fromEmail: 'CareFind <x@y.z>',
    })
    expect(h.enqueue).toHaveBeenCalledWith({
      templateKey: 'order_confirmation', toEmail: 'ada@example.com', payload: { orderRef: 'CF-1' }, subject: 'Order Confirmed - CF-1',
      app: 'carefind', eventKey: 'order_confirmation', fromEmail: 'CareFind <x@y.z>', sourceId: 's1', idempotencyKey: 'order-confirmation:o1',
    })
  })
})
