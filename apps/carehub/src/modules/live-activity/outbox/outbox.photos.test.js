import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createOutbox } from './outbox'
import { createOutboxStore, createMemoryBackend } from './outboxStore'

const ME = { businessId: 'b1', staffId: 's1' }
let t, store, repo, outbox
const activity = (id, over = {}) => ({ id, business_id: 'b1', staff_id: 's1', rep_name: 'Ada', ...over })
const blob = (n) => ({ size: n, type: 'image/jpeg', tag: 'photo' + n })

beforeEach(() => {
  t = 1_000_000
  store = createOutboxStore({ backend: createMemoryBackend() })
  let n = 0
  repo = {
    logActivity: vi.fn().mockResolvedValue({ id: 'x', notification: 'sent' }),
    uploadActivityVoice: vi.fn(),
    uploadActivityPhoto: vi.fn(async (_b, { businessId, activityId, index }) => businessId + '/' + activityId + '-' + index + '-s' + (++n) + '.jpg'),
  }
  outbox = createOutbox({ store, repository: repo, now: () => t, getScope: () => ME, locks: null })
})

describe('queued reports with photos', () => {
  it('uploads each photo in order under its position, then sends the report with the paths', async () => {
    await outbox.enqueue({ activity: activity('r1'), viewers: [], photoBlobs: [blob(1), blob(2)] })
    await outbox.flush()
    expect(repo.uploadActivityPhoto.mock.calls.map((c) => [c[0].tag, c[1]])).toEqual([
      ['photo1', { businessId: 'b1', activityId: 'r1', index: 0 }],
      ['photo2', { businessId: 'b1', activityId: 'r1', index: 1 }],
    ])
    expect(repo.logActivity.mock.calls[0][0].photo_paths).toEqual(['b1/r1-0-s1.jpg', 'b1/r1-1-s2.jpg'])
    expect(await outbox.list()).toEqual([])
  })

  it('photos already uploaded by the page keep their place; the queue continues the numbering', async () => {
    await outbox.enqueue({ activity: activity('r1'), viewers: [], photoPaths: ['b1/r1-0-early.jpg'], photoBlobs: [blob(2)] })
    await outbox.flush()
    expect(repo.uploadActivityPhoto.mock.calls[0][1].index).toBe(1)
    expect(repo.logActivity.mock.calls[0][0].photo_paths).toEqual(['b1/r1-0-early.jpg', 'b1/r1-1-s1.jpg'])
  })

  it('each photo is uploaded once even when the report itself fails and is flushed again', async () => {
    repo.logActivity.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await outbox.enqueue({ activity: activity('r1'), viewers: [], photoBlobs: [blob(1), blob(2)] })
    await outbox.flush()
    t += 2000
    await outbox.flush()
    expect(repo.uploadActivityPhoto).toHaveBeenCalledTimes(2)
    expect(repo.logActivity).toHaveBeenCalledTimes(2)
    expect(repo.logActivity.mock.calls[1][0].photo_paths).toHaveLength(2)
  })

  it('a photo that fails to upload keeps it and the ones before it, waits, and does not send the report without it', async () => {
    repo.uploadActivityPhoto.mockResolvedValueOnce('b1/r1-0-ok.jpg').mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await outbox.enqueue({ activity: activity('r1'), viewers: [], photoBlobs: [blob(1), blob(2)] })
    await outbox.flush()
    expect(repo.logActivity).not.toHaveBeenCalled()
    const [e] = await outbox.list()
    expect(e).toMatchObject({ state: 'pending', attempts: 1, photoPaths: ['b1/r1-0-ok.jpg'] })
    expect(e.photoBlobs).toHaveLength(1)
    t += 2000
    await outbox.flush()
    expect(repo.uploadActivityPhoto.mock.calls.at(-1)[1].index).toBe(1)
    expect(repo.logActivity.mock.calls[0][0].photo_paths).toHaveLength(2)
  })

  it('a photo the bucket refuses (too large) is parked, not retried forever', async () => {
    repo.uploadActivityPhoto.mockRejectedValue(new Error('Photo upload failed (413): too large'))
    await outbox.enqueue({ activity: activity('r1'), viewers: [], photoBlobs: [blob(1)] })
    const summary = await outbox.flush()
    expect(summary).toMatchObject({ permanent: 1 })
    expect((await outbox.list())[0]).toMatchObject({ state: 'failed_permanent' })
  })

  it('a report without photos is sent exactly as before, with no photo_paths added', async () => {
    await outbox.enqueue({ activity: activity('r1'), viewers: [] })
    await outbox.flush()
    expect(repo.logActivity.mock.calls[0][0]).not.toHaveProperty('photo_paths')
    expect(repo.uploadActivityPhoto).not.toHaveBeenCalled()
  })

  it('an entry stored before photos existed (no photo fields) still sends', async () => {
    await store.put({ id: 'old', ...ME, activity: activity('old'), viewers: [], voiceBlob: null, voiceUrl: null, state: 'pending', attempts: 0, nextAttemptAt: 0, lastError: null, createdAt: 1 })
    await outbox.flush()
    expect(repo.logActivity).toHaveBeenCalledTimes(1)
  })
})
