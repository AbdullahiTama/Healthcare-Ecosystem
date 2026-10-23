import { describe, it, expect, vi } from 'vitest'
import { createLiveActivityRepository } from './index.js'

const BLOB = { size: 1000, type: 'image/jpeg' }

function make(over = {}) {
  const upload = vi.fn(async (_bucket, path) => 'https://x.supabase.co/storage/v1/object/public/activity-photos/' + path)
  const signUrl = vi.fn(async (_bucket, path) => 'https://x.supabase.co/storage/v1/object/sign/activity-photos/' + path + '?token=t')
  let t = 1_000_000
  const clock = { now: () => t, advance: (ms) => { t += ms } }
  const repo = createLiveActivityRepository({ request: vi.fn(), upload, signUrl, now: clock.now, randomSuffix: () => 'sfx123', ...over })
  return { repo, upload, signUrl, clock }
}

describe('uploadActivityPhoto', () => {
  it('uploads to the private bucket under the company folder and returns the PATH, not a URL', async () => {
    const { repo, upload } = make()
    const path = await repo.uploadActivityPhoto(BLOB, { businessId: 'biz-1', activityId: 'act-1', index: 0 })
    expect(upload).toHaveBeenCalledWith('activity-photos', 'biz-1/act-1-0-sfx123.jpg', BLOB, 'image/jpeg', expect.any(String))
    expect(path).toBe('biz-1/act-1-0-sfx123.jpg')
  })

  it('refuses without a company or report instead of storing somewhere unguarded', async () => {
    const { repo, upload } = make()
    await expect(repo.uploadActivityPhoto(BLOB, { activityId: 'a', index: 0 })).rejects.toThrow(/company and a report/)
    await expect(repo.uploadActivityPhoto(BLOB)).rejects.toThrow()
    expect(upload).not.toHaveBeenCalled()
  })

  it('lets an upload failure through, so the page can keep the form and the person can retry', async () => {
    const { repo } = make({ upload: vi.fn().mockRejectedValue(new Error('Photo upload failed (413): too large')) })
    await expect(repo.uploadActivityPhoto(BLOB, { businessId: 'b', activityId: 'a', index: 1 })).rejects.toThrow('413')
  })
})

describe('signedPhotoUrl', () => {
  it('signs the stored path for an hour', async () => {
    const { repo, signUrl } = make()
    const link = await repo.signedPhotoUrl('biz-1/act-1-0-sfx123.jpg')
    expect(signUrl).toHaveBeenCalledWith('activity-photos', 'biz-1/act-1-0-sfx123.jpg', 3600)
    expect(link).toContain('token=t')
  })

  it('reuses a link for the same photo, and asks again after 50 minutes', async () => {
    const { repo, signUrl, clock } = make()
    await repo.signedPhotoUrl('p'); await repo.signedPhotoUrl('p')
    expect(signUrl).toHaveBeenCalledTimes(1)
    clock.advance(50 * 60 * 1000 + 1)
    await repo.signedPhotoUrl('p')
    expect(signUrl).toHaveBeenCalledTimes(2)
  })

  it('two requests at once share one signing call', async () => {
    const { repo, signUrl } = make()
    await Promise.all([repo.signedPhotoUrl('p'), repo.signedPhotoUrl('p')])
    expect(signUrl).toHaveBeenCalledTimes(1)
  })

  it('a failure gives null (never a public URL: there is none), is not remembered, and the next try asks again', async () => {
    const signUrl = vi.fn().mockRejectedValueOnce(new Error('Could not open the file (403)')).mockResolvedValue('https://signed')
    const { repo } = make({ signUrl })
    expect(await repo.signedPhotoUrl('p')).toBeNull()
    expect(await repo.signedPhotoUrl('p')).toBe('https://signed')
    expect(signUrl).toHaveBeenCalledTimes(2)
  })

  it('an empty path is null and signs nothing', async () => {
    const { repo, signUrl } = make()
    expect(await repo.signedPhotoUrl('')).toBeNull()
    expect(await repo.signedPhotoUrl(null)).toBeNull()
    expect(signUrl).not.toHaveBeenCalled()
  })
})
