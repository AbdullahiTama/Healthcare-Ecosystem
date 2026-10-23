import { describe, it, expect, vi } from 'vitest'
import { prepareProofPhoto, MAX_PHOTO_INPUT_BYTES } from './photoPrep'

// The browser re-encodes every proof photo: smaller to upload on a poor connection, and the new JPEG carries
// none of the original's EXIF, which includes the GPS position the camera embedded.
const file = (size = 1000, type = 'image/jpeg') => ({ size, type })
const jpeg = () => new Blob(['x'], { type: 'image/jpeg' })

function fakes({ width = 4000, height = 2000, decodeError = null, encoded = jpeg() } = {}) {
  const close = vi.fn()
  return {
    close,
    decode: vi.fn(async () => { if (decodeError) throw decodeError; return { width, height, close } }),
    encode: vi.fn(async () => encoded),
  }
}

describe('prepareProofPhoto', () => {
  it('scales the long edge down to 1280 and keeps the proportions', async () => {
    const f = fakes({ width: 4000, height: 2000 })
    const out = await prepareProofPhoto(file(), f)
    expect(out.ok).toBe(true)
    expect(f.encode).toHaveBeenCalledWith(expect.objectContaining({ width: 1280, height: 640 }), 0.7)
  })

  it('handles a portrait photo the same way', async () => {
    const f = fakes({ width: 3000, height: 4000 })
    await prepareProofPhoto(file(), f)
    expect(f.encode).toHaveBeenCalledWith(expect.objectContaining({ width: 960, height: 1280 }), 0.7)
  })

  it('never enlarges a small photo', async () => {
    const f = fakes({ width: 800, height: 600 })
    await prepareProofPhoto(file(), f)
    expect(f.encode).toHaveBeenCalledWith(expect.objectContaining({ width: 800, height: 600 }), 0.7)
  })

  it('returns a JPEG blob and releases the decoded image', async () => {
    const f = fakes()
    const out = await prepareProofPhoto(file(), f)
    expect(out.blob.type).toBe('image/jpeg')
    expect(f.close).toHaveBeenCalled()
  })

  it('accepts custom edge and quality', async () => {
    const f = fakes({ width: 2000, height: 1000 })
    await prepareProofPhoto(file(), { ...f, maxEdge: 500, quality: 0.5 })
    expect(f.encode).toHaveBeenCalledWith(expect.objectContaining({ width: 500, height: 250 }), 0.5)
  })

  it('a file over the input limit is refused before it is decoded', async () => {
    const f = fakes()
    const out = await prepareProofPhoto(file(MAX_PHOTO_INPUT_BYTES + 1), f)
    expect(out).toEqual({ ok: false, reason: 'too_large' })
    expect(f.decode).not.toHaveBeenCalled()
    expect(MAX_PHOTO_INPUT_BYTES).toBe(15 * 1024 * 1024)
  })

  it('an empty file, or one that is plainly not an image, is not an image', async () => {
    const f = fakes()
    expect(await prepareProofPhoto(file(0), f)).toEqual({ ok: false, reason: 'not_image' })
    expect(await prepareProofPhoto(file(100, 'application/pdf'), f)).toEqual({ ok: false, reason: 'not_image' })
    expect(f.decode).not.toHaveBeenCalled()
  })

  it('a file that claims to be an image but cannot be decoded is not an image (a PDF renamed .jpg)', async () => {
    const f = fakes({ decodeError: new Error('The source image could not be decoded') })
    expect(await prepareProofPhoto(file(100, 'image/jpeg'), f)).toEqual({ ok: false, reason: 'not_image' })
  })

  it('a decoded image with no usable size is not an image', async () => {
    expect(await prepareProofPhoto(file(), fakes({ width: 0, height: 0 }))).toEqual({ ok: false, reason: 'not_image' })
  })

  it('when the browser cannot produce a JPEG, says so', async () => {
    const f = fakes({ encoded: null })
    expect(await prepareProofPhoto(file(), f)).toEqual({ ok: false, reason: 'decode_failed' })
    const g = fakes({ encoded: new Blob(['x'], { type: 'image/png' }) })
    expect(await prepareProofPhoto(file(), g)).toEqual({ ok: false, reason: 'decode_failed' })
  })

  it('a missing file is not an image and nothing throws', async () => {
    expect(await prepareProofPhoto(null, fakes())).toEqual({ ok: false, reason: 'not_image' })
  })
})
