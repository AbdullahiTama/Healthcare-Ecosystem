import { describe, it, expect, vi, afterEach } from 'vitest'
import { createOutboxFlusher, canRunInBackground } from '../outboxFlush.js'
import * as index from '../index.js'

// The outbox used to be flushed with `flush().catch(...)` inside request handlers. A serverless function is frozen once it
// responds, so those flushes mostly never ran and the email waited for the next cron. These pin the replacement.
const never = () => new Promise(() => {})
afterEach(() => vi.useRealTimers())

describe('createOutboxFlusher: on a platform with waitUntil (Vercel)', () => {
  it('hands the flush to waitUntil and returns at once, even when the flush is still running', async () => {
    const waitUntil = vi.fn()
    const flush = vi.fn(never)
    const flushOutbox = createOutboxFlusher({ flush, waitUntil, isBackgroundSupported: () => true })

    await flushOutbox() // resolves although flush never settles

    expect(flush).toHaveBeenCalledTimes(1)
    expect(waitUntil).toHaveBeenCalledTimes(1)
    expect(typeof waitUntil.mock.calls[0][0].then).toBe('function')
  })

  it('gives waitUntil a promise that settles when the flush does, and never rejects, so the platform stays happy', async () => {
    const waitUntil = vi.fn()
    const logger = { error: vi.fn() }
    const flushOutbox = createOutboxFlusher({ flush: async () => { throw new Error('resend down') }, waitUntil, logger, isBackgroundSupported: () => true })

    await flushOutbox()
    await expect(waitUntil.mock.calls[0][0]).resolves.toBeUndefined()
    expect(logger.error).toHaveBeenCalledWith('outbox.flush.failed', { message: 'resend down' })
  })

  it('falls back to waiting here if waitUntil itself throws', async () => {
    const logger = { error: vi.fn() }
    let flushed = false
    const flushOutbox = createOutboxFlusher({
      flush: async () => { flushed = true },
      waitUntil: () => { throw new Error('no context') },
      logger,
      isBackgroundSupported: () => true,
    })
    await flushOutbox()
    expect(flushed).toBe(true)
    expect(logger.error).toHaveBeenCalledWith('outbox.flush.waituntil_failed', { message: 'no context' })
  })
})

describe('createOutboxFlusher: with no background support (tests, local dev, other hosts)', () => {
  it('waits for the flush instead of dropping it (waitUntil is a silent no-op there, so it must not be trusted)', async () => {
    const waitUntil = vi.fn()
    let done = false
    const flushOutbox = createOutboxFlusher({ flush: async () => { await new Promise((r) => setTimeout(r, 10)); done = true }, waitUntil, isBackgroundSupported: () => false })
    await flushOutbox()
    expect(done).toBe(true)
    expect(waitUntil).not.toHaveBeenCalled()
  })

  it('waits when no waitUntil was given at all', async () => {
    let done = false
    await createOutboxFlusher({ flush: async () => { done = true }, isBackgroundSupported: () => true })()
    expect(done).toBe(true)
  })

  it('gives up on a hung flush after timeoutMs, so a slow provider cannot hold the response', async () => {
    vi.useFakeTimers()
    const flushOutbox = createOutboxFlusher({ flush: never, timeoutMs: 4000, isBackgroundSupported: () => false })
    let returned = false
    const p = flushOutbox().then(() => { returned = true })
    await vi.advanceTimersByTimeAsync(3999)
    expect(returned).toBe(false)
    await vi.advanceTimersByTimeAsync(2)
    await p
    expect(returned).toBe(true)
  })

  it('never rejects, whether the flush rejects or throws synchronously, and logs it', async () => {
    const logger = { error: vi.fn() }
    await expect(createOutboxFlusher({ flush: async () => { throw new Error('boom') }, logger, isBackgroundSupported: () => false })()).resolves.toBeUndefined()
    await expect(createOutboxFlusher({ flush: () => { throw new Error('sync boom') }, logger, isBackgroundSupported: () => false })()).resolves.toBeUndefined()
    expect(logger.error).toHaveBeenCalledTimes(2)
  })

  it('does not leave a timer behind when the flush finishes first', async () => {
    vi.useFakeTimers()
    await createOutboxFlusher({ flush: async () => {}, isBackgroundSupported: () => false })()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('refuses to be built without a flush function', () => {
    expect(() => createOutboxFlusher({})).toThrow(/flush function/)
    expect(() => createOutboxFlusher()).toThrow(/flush function/)
  })
})

describe('createOutboxFlusher: loadWaitUntil (the lazy way to get waitUntil)', () => {
  it('is never called when the platform has no background support, so @vercel/functions is not even imported there', async () => {
    const loadWaitUntil = vi.fn()
    let done = false
    await createOutboxFlusher({ flush: async () => { done = true }, loadWaitUntil, isBackgroundSupported: () => false })()
    expect(loadWaitUntil).not.toHaveBeenCalled()
    expect(done).toBe(true)
  })

  it('is called once, on the first background flush, and its waitUntil is reused', async () => {
    const waitUntil = vi.fn()
    const loadWaitUntil = vi.fn(async () => waitUntil)
    const flushOutbox = createOutboxFlusher({ flush: never, loadWaitUntil, isBackgroundSupported: () => true })
    await flushOutbox()
    await flushOutbox()
    expect(loadWaitUntil).toHaveBeenCalledTimes(1)
    expect(waitUntil).toHaveBeenCalledTimes(2)
  })

  it('falls back to waiting, and logs, when the loader fails or returns nothing usable', async () => {
    for (const loadWaitUntil of [async () => { throw new Error('cannot load') }, async () => undefined]) {
      const logger = { error: vi.fn() }
      let done = false
      await createOutboxFlusher({ flush: async () => { done = true }, loadWaitUntil, logger, isBackgroundSupported: () => true })()
      expect(done).toBe(true)
    }
  })

  it('starts the flush while the loader is still loading, so loading never delays the send', async () => {
    const order = []
    const flushOutbox = createOutboxFlusher({
      flush: async () => { order.push('flush started') },
      loadWaitUntil: async () => {
        order.push('loader called')
        await new Promise((resolve) => setTimeout(resolve, 20))
        order.push('loader finished')
        return () => {}
      },
      isBackgroundSupported: () => true,
    })
    await flushOutbox()
    expect(order).toEqual(['loader called', 'flush started', 'loader finished'])
  })
})

describe('canRunInBackground (the Vercel request context)', () => {
  const KEY = Symbol.for('@vercel/request-context')
  it('is true only when a request context with waitUntil is present', () => {
    expect(canRunInBackground({})).toBe(false)
    expect(canRunInBackground({ [KEY]: {} })).toBe(false)
    expect(canRunInBackground({ [KEY]: { get: () => ({}) } })).toBe(false)
    expect(canRunInBackground({ [KEY]: { get: () => ({ waitUntil: () => {} }) } })).toBe(true)
  })

  it('is false, not an exception, when reading the context throws', () => {
    expect(canRunInBackground({ [KEY]: { get: () => { throw new Error('x') } } })).toBe(false)
  })

  it('is false in a plain test process, so the real default falls back to waiting', () => {
    expect(canRunInBackground()).toBe(false)
  })
})

describe('public surface', () => {
  it('is exported from the package index (a missing export there takes down every route that imports the package)', () => {
    expect(typeof index.createOutboxFlusher).toBe('function')
    expect(typeof index.canRunInBackground).toBe('function')
  })
})
