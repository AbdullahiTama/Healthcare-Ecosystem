import { describe, it, expect } from 'vitest'
import { purgeUnsentReports } from './purge'
import { createOutboxStore, createMemoryBackend } from './outboxStore'

const entry = (id, staffId) => ({ id, businessId: 'b1', staffId, activity: { id }, viewers: [], state: 'pending', attempts: 0, nextAttemptAt: 0, createdAt: 1 })

describe('purgeUnsentReports', () => {
  it('removes every queued report on the device, whoever wrote it', async () => {
    const store = createOutboxStore({ backend: createMemoryBackend() })
    await store.put(entry('a', 's1')); await store.put(entry('b', 's2'))
    expect(await purgeUnsentReports(store)).toBe(true)
    expect(await store.list({ businessId: 'b1', staffId: 's1' })).toEqual([])
    expect(await store.list({ businessId: 'b1', staffId: 's2' })).toEqual([])
  })

  it('never throws: sign-out must go ahead even when the device storage is unusable', async () => {
    const broken = createOutboxStore({ backend: createMemoryBackend({ failWith: new Error('no storage') }) })
    await expect(purgeUnsentReports(broken)).resolves.toBe(false)
  })
})
