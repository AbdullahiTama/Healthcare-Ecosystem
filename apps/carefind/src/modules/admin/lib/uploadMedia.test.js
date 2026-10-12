import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const storage = vi.hoisted(() => ({ upload: vi.fn(), getPublicUrl: vi.fn(), from: vi.fn() }))
vi.mock('../../../config/supabaseClient.js', () => ({ supabase: { storage: { from: storage.from } } }))

import { uploadToBucket } from './uploadMedia'

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-12T10:00:00Z'))
  storage.upload.mockReset().mockResolvedValue({ error: null })
  storage.getPublicUrl.mockReset().mockReturnValue({ data: { publicUrl: 'https://cdn.example/story-1.png' } })
  storage.from.mockReset().mockReturnValue({ upload: storage.upload, getPublicUrl: storage.getPublicUrl })
})
afterEach(() => { vi.useRealTimers() })

const file = (name = 'pic.png') => ({ name, type: 'image/png' })

describe('uploadToBucket', () => {
  it('resolves ok with a null url and touches nothing when there is no file', async () => {
    expect(await uploadToBucket('story-images', null, 'story')).toEqual({ ok: true, url: null })
    expect(storage.from).not.toHaveBeenCalled()
  })

  it('uploads to the bucket at prefix-timestamp.ext and returns the public url', async () => {
    const f = file('holiday.photo.JPG')
    const out = await uploadToBucket('story-images', f, 'story')
    expect(storage.from).toHaveBeenCalledWith('story-images')
    const ts = new Date('2026-10-12T10:00:00Z').getTime()
    expect(storage.upload).toHaveBeenCalledWith(`story-${ts}.JPG`, f)
    expect(storage.getPublicUrl).toHaveBeenCalledWith(`story-${ts}.JPG`)
    expect(out).toEqual({ ok: true, url: 'https://cdn.example/story-1.png' })
  })

  it('returns the upload error and never a url when the upload fails', async () => {
    storage.upload.mockResolvedValue({ error: { message: 'Bucket policy denied' } })
    const out = await uploadToBucket('promo-images', file(), 'promo')
    expect(out).toEqual({ ok: false, error: 'Bucket policy denied' })
    expect(storage.getPublicUrl).not.toHaveBeenCalled()
  })

  it('returns an error when the storage call throws', async () => {
    storage.upload.mockRejectedValue(new Error('network down'))
    expect(await uploadToBucket('promo-images', file(), 'promo')).toEqual({ ok: false, error: 'network down' })
  })
})
