// Turn a photo the person just took into the small JPEG the identity check wants (base64, no data: prefix, about 1 MB
// at most). Browser only. The image is sent once and never kept by the apps.
const MAX_INPUT_BYTES = 12 * 1024 * 1024

export const stripDataUrl = (dataUrl) => String(dataUrl || '').replace(/^data:[^,]*,/, '')

export function checkSelfieFile(file) {
  if (!file) return 'Take or choose a photo of your face.'
  if (!/^image\//.test(file.type || '')) return 'That file is not a photo.'
  if (file.size > MAX_INPUT_BYTES) return 'That photo is too large. Try again.'
  return ''
}

/** -> base64 JPEG string. Throws Error with a user-readable message. */
export async function prepareSelfie(file, { maxSide = 800, quality = 0.8 } = {}) {
  const problem = checkSelfieFile(file)
  if (problem) throw new Error(problem)
  let bitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new Error('We could not read that photo. Try again.')
  }
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close?.()
  return stripDataUrl(canvas.toDataURL('image/jpeg', quality))
}

export const formatKobo = (kobo) => `₦${(Number(kobo || 0) / 100).toLocaleString('en-NG')}`
