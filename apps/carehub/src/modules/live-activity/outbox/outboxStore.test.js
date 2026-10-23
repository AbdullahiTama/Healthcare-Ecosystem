import { describe, it, expect } from 'vitest'
import { createOutboxStore, createMemoryBackend, OutboxStoreError } from './outboxStore'

const A = { businessId: 'b1', staffId: 's1' }
const entry = (id, over = {}) => ({
  id, ...A, activity: { id }, viewers: [], voiceBlob: null, voiceUrl: null,
  state: 'pending', attempts: 0, nextAttemptAt: 0, lastError: null, createdAt: 1000, ...over,
})

describe('outbox store', () => {
  it('puts and gets an entry, and returns a copy the caller cannot use to edit the stored one', async () => {
    const store = createOutboxStore({ backend: createMemoryBackend() })
    await store.put(entry('r1'))
    const got = await store.get('r1')
    expect(got.id).toBe('r1')
    got.state = 'tampered'
    expect((await store.get('r1')).state).toBe('pending')
  })

  it('lists only the current business and person, oldest first', async () => {
    const store = createOutboxStore({ backend: createMemoryBackend() })
    await store.put(entry('late', { createdAt: 3000 }))
    await store.put(entry('early', { createdAt: 1000 }))
    await store.put(entry('other-person', { staffId: 's2' }))
    await store.put(entry('other-company', { businessId: 'b2' }))
    expect((await store.list(A)).map((e) => e.id)).toEqual(['early', 'late'])
  })

  it('the owner (no staff id) is a scope of its own', async () => {
    const store = createOutboxStore({ backend: createMemoryBackend() })
    await store.put(entry('mine', { staffId: null }))
    await store.put(entry('staffs'))
    expect((await store.list({ businessId: 'b1', staffId: null })).map((e) => e.id)).toEqual(['mine'])
  })

  it('update merges fields and keeps the rest; updating a missing entry says so', async () => {
    const store = createOutboxStore({ backend: createMemoryBackend() })
    await store.put(entry('r1'))
    await store.update('r1', { attempts: 2, lastError: 'offline' })
    expect(await store.get('r1')).toMatchObject({ attempts: 2, lastError: 'offline', state: 'pending', activity: { id: 'r1' } })
    await expect(store.update('nope', { attempts: 1 })).rejects.toMatchObject({ code: 'missing' })
  })

  it('remove deletes one entry; clearAll empties everything for everyone', async () => {
    const store = createOutboxStore({ backend: createMemoryBackend() })
    await store.put(entry('r1')); await store.put(entry('r2', { staffId: 's2' }))
    await store.remove('r1')
    expect(await store.get('r1')).toBeNull()
    await store.clearAll()
    expect(await store.list({ ...A, staffId: 's2' })).toEqual([])
  })

  it('refuses an entry without an id or a business, so nothing is stored that could not be sent', async () => {
    const store = createOutboxStore({ backend: createMemoryBackend() })
    await expect(store.put({ ...entry('x'), id: '' })).rejects.toMatchObject({ code: 'invalid' })
    await expect(store.put({ ...entry('x'), businessId: undefined })).rejects.toMatchObject({ code: 'invalid' })
  })

  it('a backend that cannot be used rejects with code "unavailable"; a full disk with code "quota"', async () => {
    const down = createOutboxStore({ backend: createMemoryBackend({ failWith: new Error('no storage') }) })
    await expect(down.put(entry('r1'))).rejects.toBeInstanceOf(OutboxStoreError)
    await expect(down.put(entry('r1'))).rejects.toMatchObject({ code: 'unavailable' })
    await expect(down.list(A)).rejects.toMatchObject({ code: 'unavailable' })
    const full = Object.assign(new Error('full'), { name: 'QuotaExceededError' })
    const tight = createOutboxStore({ backend: createMemoryBackend({ failWith: full }) })
    await expect(tight.put(entry('r1'))).rejects.toMatchObject({ code: 'quota' })
  })

  it('a missing indexedDB makes the default store report "unavailable" instead of throwing at creation', async () => {
    const store = createOutboxStore({ indexedDB: undefined })
    await expect(store.list(A)).rejects.toMatchObject({ code: 'unavailable' })
  })
})
