import { describe, it, expect } from 'vitest'
import { PHOTO_BUCKET, MAX_PHOTOS, photoUploadInfo } from './photoUrl'

describe('photo storage rules', () => {
  it('uses the private bucket and allows three photos', () => {
    expect(PHOTO_BUCKET).toBe('activity-photos')
    expect(MAX_PHOTOS).toBe(3)
  })

  it('stores a photo under its company folder, named for the report, the position and a suffix', () => {
    expect(photoUploadInfo('biz-1', 'act-9', 2, 'k3j9x')).toEqual({ path: 'biz-1/act-9-2-k3j9x.jpg', contentType: 'image/jpeg' })
  })

  it('a photo needs a company and a report to be stored under', () => {
    expect(() => photoUploadInfo('', 'act', 0, 's')).toThrow(/company and a report/)
    expect(() => photoUploadInfo('biz', '', 0, 's')).toThrow(/company and a report/)
  })

  it('two photos of one report never share a path', () => {
    const a = photoUploadInfo('b', 'a', 0, 'x').path
    const b = photoUploadInfo('b', 'a', 1, 'x').path
    expect(a).not.toBe(b)
  })
})
