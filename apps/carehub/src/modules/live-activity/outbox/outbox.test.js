import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createOutbox } from './outbox'
import { createOutboxStore, createMemoryBackend } from './outboxStore'

const ME = { businessId: 'b1', staffId: 's1' }
let t, store, repo, scope, outbox

const activity = (id, over = {}) => ({ id, business_id: 'b1', staff_id: 's1', rep_name: 'Ada', voice_url: null, ...over })
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }

beforeEach(() => {
  t = 1_000_000
  store = createOutboxStore({ backend: createMemoryBackend() })
  repo = { logActivity: vi.fn().mockResolvedValue({ id: 'x', notification: 'sent' }), uploadActivityVoice: vi.fn().mockResolvedValue('https://v/b1/a-1.mp4') }
  scope = ME
  outbox = createOutbox({ store, repository: repo, now: () => t, getScope: () => scope, locks: null })
})

describe('enqueue', () => {
  it('stores a pending entry keyed by the report id, for the current person', async () => {
    const e = await outbox.enqueue({ activity: activity('r1'), viewers: [{ staff_id: 'v1' }] })
    expect(e).toMatchObject({ id: 'r1', ...ME, state: 'pending', attempts: 0, nextAttemptAt: 0, createdAt: t, voiceBlob: null, voiceUrl: null })
    expect((await outbox.list()).map((x) => x.id)).toEqual(['r1'])
  })
  it('enqueueing the same report twice keeps one entry', async () => {
    await outbox.enqueue({ activity: activity('r1'), viewers: [] })
    await outbox.enqueue({ activity: activity('r1'), viewers: [] })
    expect(await outbox.list()).toHaveLength(1)
  })
  it('rejects, and says why, when the report could not be kept', async () => {
    const down = createOutbox({ store: createOutboxStore({ backend: createMemoryBackend({ failWith: new Error('no storage') }) }), repository: repo, getScope: () => scope, locks: null })
    await expect(down.enqueue({ activity: activity('r1'), viewers: [] })).rejects.toMatchObject({ code: 'unavailable' })
  })
})

describe('flush', () => {
  it('sends a queued report once and removes it', async () => {
    await outbox.enqueue({ activity: activity('r1'), viewers: [{ staff_id: 'v1' }] })
    const summary = await outbox.flush()
    expect(repo.logActivity).toHaveBeenCalledTimes(1)
    expect(repo.logActivity).toHaveBeenCalledWith(expect.objectContaining({ id: 'r1' }), [{ staff_id: 'v1' }])
    expect(await outbox.list()).toEqual([])
    expect(summary).toMatchObject({ sent: 1 })
  })

  it('sends oldest first', async () => {
    await outbox.enqueue({ activity: activity('first'), viewers: [] }); t += 10
    await outbox.enqueue({ activity: activity('second'), viewers: [] })
    await outbox.flush()
    expect(repo.logActivity.mock.calls.map((c) => c[0].id)).toEqual(['first', 'second'])
  })

  it('a network failure keeps the entry, counts the attempt, waits 2 s, then 4 s, and stops the round', async () => {
    repo.logActivity.mockRejectedValue(new TypeError('Failed to fetch'))
    await outbox.enqueue({ activity: activity('a'), viewers: [] }); t += 10
    await outbox.enqueue({ activity: activity('b'), viewers: [] })
    await outbox.flush()
    expect(repo.logActivity).toHaveBeenCalledTimes(1)                    // did not hammer the second one
    const [a] = await outbox.list()
    expect(a).toMatchObject({ id: 'a', state: 'pending', attempts: 1, nextAttemptAt: t + 2000 })
    expect(a.lastError).toMatch(/Failed to fetch/)
    t += 2000
    await outbox.flush()
    expect((await outbox.list())[0]).toMatchObject({ attempts: 2, nextAttemptAt: t + 4000 })
  })

  it('skips an entry whose wait has not passed', async () => {
    repo.logActivity.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await outbox.enqueue({ activity: activity('a'), viewers: [] })
    await outbox.flush()
    repo.logActivity.mockClear()
    t += 1999
    await outbox.flush()
    expect(repo.logActivity).not.toHaveBeenCalled()
    t += 1
    await outbox.flush()
    expect(repo.logActivity).toHaveBeenCalledTimes(1)
  })

  it('a refusal marks the entry failed_permanent with the reason, is never retried by later rounds, and does not block the next report', async () => {
    repo.logActivity
      .mockRejectedValueOnce(new Error('Supabase error (403): new row violates row-level security policy'))
      .mockResolvedValue({ id: 'x', notification: 'sent' })
    await outbox.enqueue({ activity: activity('bad'), viewers: [] }); t += 10
    await outbox.enqueue({ activity: activity('good'), viewers: [] })
    const summary = await outbox.flush()
    expect(summary).toMatchObject({ sent: 1, permanent: 1 })
    const left = await outbox.list()
    expect(left.map((e) => [e.id, e.state])).toEqual([['bad', 'failed_permanent']])
    expect(left[0].lastError).toMatch(/row-level security/)
    repo.logActivity.mockClear()
    await outbox.flush()
    expect(repo.logActivity).not.toHaveBeenCalled()
  })

  it('retry(id) re-arms a failed_permanent entry and sends it', async () => {
    repo.logActivity.mockRejectedValueOnce(new Error('Supabase error (403): denied'))
    await outbox.enqueue({ activity: activity('bad'), viewers: [] })
    await outbox.flush()
    await outbox.retry('bad')
    expect(repo.logActivity).toHaveBeenCalledTimes(2)
    expect(await outbox.list()).toEqual([])
  })

  it('discard(id) removes an entry', async () => {
    await outbox.enqueue({ activity: activity('r1'), viewers: [] })
    await outbox.discard('r1')
    expect(await outbox.list()).toEqual([])
  })

  it('two flushes at once send the report once', async () => {
    const gate = deferred()
    repo.logActivity.mockReturnValue(gate.promise)
    await outbox.enqueue({ activity: activity('r1'), viewers: [] })
    const p1 = outbox.flush(); const p2 = outbox.flush()
    gate.resolve({ id: 'x', notification: 'sent' })
    await Promise.all([p1, p2])
    expect(repo.logActivity).toHaveBeenCalledTimes(1)
  })

  it('when another tab holds the cross-tab lock, this one sends nothing', async () => {
    const locks = { request: vi.fn((_name, _opts, cb) => cb(null)) }
    const guarded = createOutbox({ store, repository: repo, now: () => t, getScope: () => scope, locks })
    await guarded.enqueue({ activity: activity('r1'), viewers: [] })
    await guarded.flush()
    expect(locks.request).toHaveBeenCalledWith('carehub-outbox-flush', { ifAvailable: true }, expect.any(Function))
    expect(repo.logActivity).not.toHaveBeenCalled()
    expect(await guarded.list()).toHaveLength(1)
  })

  it('when the lock is granted it sends', async () => {
    const locks = { request: vi.fn((_name, _opts, cb) => cb({})) }
    const guarded = createOutbox({ store, repository: repo, now: () => t, getScope: () => scope, locks })
    await guarded.enqueue({ activity: activity('r1'), viewers: [] })
    await guarded.flush()
    expect(repo.logActivity).toHaveBeenCalledTimes(1)
  })

  it('never sends or lists another person\'s reports, even on the same device', async () => {
    await outbox.enqueue({ activity: activity('mine'), viewers: [] })
    scope = { businessId: 'b1', staffId: 's2' }
    expect(await outbox.list()).toEqual([])
    await outbox.flush()
    expect(repo.logActivity).not.toHaveBeenCalled()
    scope = ME
    expect(await outbox.list()).toHaveLength(1)
  })

  it('does nothing when nobody is signed in', async () => {
    await outbox.enqueue({ activity: activity('mine'), viewers: [] })
    scope = null
    expect(await outbox.flush()).toMatchObject({ sent: 0 })
    expect(await outbox.list()).toEqual([])
    expect(repo.logActivity).not.toHaveBeenCalled()
  })
})

describe('voice notes', () => {
  const blob = { size: 10, type: 'audio/mp4' }
  it('uploads the voice note first and sends the report with its URL', async () => {
    await outbox.enqueue({ activity: activity('r1'), viewers: [], voiceBlob: blob })
    await outbox.flush()
    expect(repo.uploadActivityVoice).toHaveBeenCalledWith(blob, { businessId: 'b1', activityId: 'r1' })
    expect(repo.logActivity.mock.calls[0][0].voice_url).toBe('https://v/b1/a-1.mp4')
  })
  it('uploads once even when the report itself fails and is flushed again', async () => {
    repo.logActivity.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await outbox.enqueue({ activity: activity('r1'), viewers: [], voiceBlob: blob })
    await outbox.flush()
    t += 2000
    await outbox.flush()
    expect(repo.uploadActivityVoice).toHaveBeenCalledTimes(1)
    expect(repo.logActivity).toHaveBeenCalledTimes(2)
    expect(repo.logActivity.mock.calls[1][0].voice_url).toBe('https://v/b1/a-1.mp4')
  })
  it('a failed upload keeps the entry and does not send the report without its voice note', async () => {
    repo.uploadActivityVoice.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await outbox.enqueue({ activity: activity('r1'), viewers: [], voiceBlob: blob })
    await outbox.flush()
    expect(repo.logActivity).not.toHaveBeenCalled()
    expect((await outbox.list())[0]).toMatchObject({ state: 'pending', attempts: 1 })
  })
})

describe('purgeAll and subscribe', () => {
  it('purgeAll empties the queue for everyone on the device', async () => {
    await outbox.enqueue({ activity: activity('mine'), viewers: [] })
    scope = { businessId: 'b1', staffId: 's2' }
    await outbox.enqueue({ activity: activity('theirs', { staff_id: 's2' }), viewers: [] })
    await outbox.purgeAll()
    scope = ME
    expect(await outbox.list()).toEqual([])
    scope = { businessId: 'b1', staffId: 's2' }
    expect(await outbox.list()).toEqual([])
  })

  it('subscribers hear about changes and can stop listening', async () => {
    const seen = vi.fn()
    const stop = outbox.subscribe(seen)
    await outbox.enqueue({ activity: activity('r1'), viewers: [] })
    expect(seen).toHaveBeenCalled()
    seen.mockClear()
    stop()
    await outbox.discard('r1')
    expect(seen).not.toHaveBeenCalled()
  })
})

describe('start', () => {
  function fakeEnv() {
    const handlers = {}
    const docHandlers = {}
    return {
      handlers, docHandlers,
      window: { addEventListener: (n, f) => { handlers[n] = f }, removeEventListener: (n) => { delete handlers[n] } },
      document: { visibilityState: 'visible', addEventListener: (n, f) => { docHandlers[n] = f }, removeEventListener: (n) => { delete docHandlers[n] } },
      setInterval: vi.fn(() => 42), clearInterval: vi.fn(),
    }
  }
  it('flushes now, when the browser comes back online, when the tab becomes visible, and every 60 s; stop undoes it all', async () => {
    const env = fakeEnv()
    await outbox.enqueue({ activity: activity('r1'), viewers: [] })
    const flush = vi.spyOn(outbox, 'flush')
    const stop = outbox.start(env)
    expect(flush).toHaveBeenCalledTimes(1)
    env.handlers.online(); expect(flush).toHaveBeenCalledTimes(2)
    env.docHandlers.visibilitychange(); expect(flush).toHaveBeenCalledTimes(3)
    env.document.visibilityState = 'hidden'
    env.docHandlers.visibilitychange(); expect(flush).toHaveBeenCalledTimes(3)   // hidden is not a reason to send
    expect(env.setInterval).toHaveBeenCalledWith(expect.any(Function), 60000)
    stop()
    expect(env.clearInterval).toHaveBeenCalledWith(42)
    expect(env.handlers.online).toBeUndefined()
    expect(env.docHandlers.visibilitychange).toBeUndefined()
  })
})
