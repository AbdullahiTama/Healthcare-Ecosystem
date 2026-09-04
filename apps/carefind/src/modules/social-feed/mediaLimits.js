// Media limits and validation for post attachments (issue #7).
//
// Videos used to be capped at 12MB "about 15 seconds" — a size proxy that
// silently decided duration. The product requirement is at least one minute,
// so the cap is now explicit seconds with a size ceiling to match, and the
// real duration is read from the file's metadata before uploading. The
// storage bucket's file_size_limit is raised to the same ceiling by the
// accompanying migration — a client-side number alone would just move the
// failure server-side.

export const MAX_POST_IMAGES = 5

// Three minutes: comfortably above the required one minute, while keeping an
// uploaded clip small enough that a phone on mobile data survives it.
export const MAX_VIDEO_SECONDS = 180
// 2-minute upload cap — within the 180s/100MB bucket ceiling, no migration
// needed. Keep 180 as hard ceiling, 120 is the product-facing limit enforced
// in validateVideoFile and the feed composer.
export const MAX_VIDEO_SECONDS_120 = 120
export const MAX_VIDEO_MB = 100
export const MAX_VIDEO_BYTES = MAX_VIDEO_MB * 1024 * 1024

// Returns a human-readable reason the video should be rejected, or null when
// it passes. A duration of 0/NaN means metadata could not be read — the size
// ceiling still applies upstream, so this is not treated as an error here.
export function validateVideoFile({ size, duration } = {}) {
  if (size != null && size > MAX_VIDEO_BYTES) {
    return `That clip is too large. Please choose one under ${MAX_VIDEO_MB}MB.`
  }
  if (Number.isFinite(duration) && duration > MAX_VIDEO_SECONDS_120) {
    return `Video must be \u2264 2 minutes (120s). Please trim the clip and try again.`
  }
  return null
}

// Read a video file's real duration from its metadata. Resolves 0 when the
// browser cannot decode the metadata rather than rejecting — validateVideoFile
// treats unknown as pass-through to the size check.
export function probeVideoDuration(file) {
  return new Promise((resolve) => {
    if (!file || typeof document === 'undefined') { resolve(0); return }
    const url = URL.createObjectURL(file)
    const el = document.createElement('video')
    el.preload = 'metadata'
    const done = (value) => { URL.revokeObjectURL(url); resolve(value) }
    el.onloadedmetadata = () => done(Number.isFinite(el.duration) ? el.duration : 0)
    el.onerror = () => done(0)
    el.src = url
  })
}
