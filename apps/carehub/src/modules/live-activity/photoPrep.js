// Gets a camera or gallery photo ready to attach to a report.
//
// The browser decodes it and draws it again as a JPEG with its long edge at most 1280 px. That makes it small
// enough to upload on a weak connection, and it also removes the original's EXIF block, which includes the GPS
// position the camera embedded: the report's own location evidence is the only position kept.
//
//   prepareProofPhoto(file, { maxEdge, quality, decode, encode })
//     -> { ok: true, blob } | { ok: false, reason: 'not_image' | 'too_large' | 'decode_failed' }
//
// 'not_image'     empty, not an image type, or the browser could not read it as one (a PDF renamed .jpg)
// 'too_large'     bigger than MAX_PHOTO_INPUT_BYTES before any work is done
// 'decode_failed' the image was read but the browser could not produce a JPEG from it
// It never throws. `decode` and `encode` are replaceable so the rules are tested without a canvas.

export const MAX_PHOTO_INPUT_BYTES = 15 * 1024 * 1024

async function defaultDecode(file) {
  return createImageBitmap(file)
}

function defaultEncode(image, quality) {
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const ctx = canvas.getContext('2d')
    if (!ctx) { resolve(null); return }
    ctx.drawImage(image.source, 0, 0, image.width, image.height)
    canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality)
  })
}

export async function prepareProofPhoto(file, { maxEdge = 1280, quality = 0.7, decode = defaultDecode, encode = defaultEncode } = {}) {
  if (!file || !file.size) return { ok: false, reason: 'not_image' }
  if (file.size > MAX_PHOTO_INPUT_BYTES) return { ok: false, reason: 'too_large' }
  if (file.type && !/^image\//i.test(file.type)) return { ok: false, reason: 'not_image' }

  let decoded
  try {
    decoded = await decode(file)
  } catch (e) {
    return { ok: false, reason: 'not_image' }
  }
  try {
    const { width, height } = decoded || {}
    if (!(width > 0) || !(height > 0)) return { ok: false, reason: 'not_image' }
    const scale = Math.min(1, maxEdge / Math.max(width, height))
    const out = { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), source: decoded }
    const blob = await encode(out, quality)
    if (!blob || blob.type !== 'image/jpeg') return { ok: false, reason: 'decode_failed' }
    return { ok: true, blob }
  } catch (e) {
    return { ok: false, reason: 'decode_failed' }
  } finally {
    try { if (decoded && typeof decoded.close === 'function') decoded.close() } catch (e) { /* nothing to release */ }
  }
}
