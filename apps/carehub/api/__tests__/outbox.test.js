// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// flushOutbox() is what every CareHub handler awaits where it used to say `emailService.processBatch().catch(...)`. That
// fire-and-forget form never ran on Vercel (the function is frozen once it has responded), so these tests pin the three things
// that matter: on Vercel the flush is handed to the platform and the response is not delayed; anywhere else the flush is waited
// for; and it never throws.
const h = vi.hoisted(() => ({ processBatch: vi.fn() }))
vi.mock('../../src/lib/emailService.js', () => ({ emailService: { enqueue: vi.fn(), processBatch: (...a) => h.processBatch(...a) } }))

import { flushOutbox } from '../_lib/outbox.js'

const REQUEST_CONTEXT = Symbol.for('@vercel/request-context')
const deferred = () => { let resolve; const promise = new Promise((a) => { resolve = a }); return { promise, resolve } }

beforeEach(() => {
  h.processBatch.mockReset().mockResolvedValue({ sent: 1 })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  delete globalThis[REQUEST_CONTEXT]
  vi.restoreAllMocks()
})

describe('flushOutbox (CareHub)', () => {
  it('outside Vercel it waits for the flush, so nothing is left running when the handler responds', async () => {
    let flushed = false
    h.processBatch.mockImplementation(async () => { await new Promise((r) => setTimeout(r, 20)); flushed = true })
    await flushOutbox()
    expect(flushed).toBe(true)
    expect(h.processBatch).toHaveBeenCalledTimes(1)
  })

  it('on Vercel it hands the flush to waitUntil (the real @vercel/functions one) and returns without waiting for the provider', async () => {
    const waitUntil = vi.fn()
    globalThis[REQUEST_CONTEXT] = { get: () => ({ waitUntil }) }
    const provider = deferred()
    h.processBatch.mockReturnValue(provider.promise)

    await flushOutbox() // would hang here if it waited for the provider

    expect(h.processBatch).toHaveBeenCalledTimes(1)
    expect(waitUntil).toHaveBeenCalledTimes(1)
    const handedOver = waitUntil.mock.calls[0][0]

    let settled = false
    handedOver.then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)
    provider.resolve({ sent: 1 })
    await handedOver
    expect(settled).toBe(true)
  })

  it('a provider failure never rejects, neither to the handler nor to the platform, and is logged', async () => {
    const waitUntil = vi.fn()
    globalThis[REQUEST_CONTEXT] = { get: () => ({ waitUntil }) }
    h.processBatch.mockRejectedValue(new Error('provider 500'))

    await expect(flushOutbox()).resolves.toBeUndefined()
    await expect(waitUntil.mock.calls[0][0]).resolves.toBeUndefined()
    expect(console.error).toHaveBeenCalledWith('[outbox] outbox.flush.failed', { message: 'provider 500' })

    delete globalThis[REQUEST_CONTEXT]
    await expect(flushOutbox()).resolves.toBeUndefined() // and the same off Vercel
  })
})
