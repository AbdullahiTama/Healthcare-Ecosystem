// Professional-licence upload rules, in one place (issue #5).
//
// Three things were wrong and are fixed together here and in the migration
// apps/carefind/sql/20260822_credentials_bucket_hardening.sql:
//
//  * The `credentials` bucket had NO storage.objects INSERT policy, so RLS
//    rejected every upload 42501 no matter how small the file was. Proven:
//    the bucket contained zero objects and zero verification_requests rows
//    carried a credential_url — not one licence upload has ever succeeded.
//  * Only images were accepted; many licences are issued or scanned as PDF.
//  * No size limit was enforced anywhere — not in the bucket, not in the
//    client. The "3 MB" / "5 MB" figures shown to users were decoration, and
//    the failure they saw ("Try a smaller image") named the wrong cause.
//
// The limit and the accepted types below are the same values the bucket now
// enforces server-side, so the client can give a precise message *before* the
// round trip and the server still has the final say.

export const MAX_CREDENTIAL_BYTES = 5 * 1024 * 1024   // 5 MB, matches the bucket
export const MAX_CREDENTIAL_LABEL = '5MB'

// Keep in step with storage.buckets.allowed_mime_types for `credentials`.
export const ACCEPTED_CREDENTIAL_TYPES = [
  'image/jpeg', 'image/jpg', 'image/png', 'image/webp',
  'image/heic', 'image/heif',
  'application/pdf',
]

// What the file input advertises. Extensions are listed alongside the MIME
// types because Android pickers and some desktop browsers match on extension.
export const CREDENTIAL_ACCEPT_ATTR = 'image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,.pdf'

const EXTENSION_TYPES = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  heic: 'image/heic', heif: 'image/heif', pdf: 'application/pdf',
}

export function extensionOf(fileName) {
  const parts = String(fileName || '').split('.')
  return parts.length > 1 ? parts.pop().toLowerCase() : ''
}

// A browser does not always report a type — an iPhone HEIC and some Android
// pickers hand over an empty `file.type`. Falling back to the extension keeps
// a legitimate file from being rejected, and means we can always send an
// explicit contentType to Storage rather than letting it default to
// application/octet-stream (which the bucket's MIME whitelist would refuse —
// exactly the silent-rejection shape this issue is about).
export function resolveContentType(file) {
  const declared = (file?.type || '').toLowerCase()
  if (ACCEPTED_CREDENTIAL_TYPES.includes(declared)) return declared
  return EXTENSION_TYPES[extensionOf(file?.name)] || declared || ''
}

// Validate before uploading. Returns { ok: true, contentType } or
// { ok: false, reason, error } where `reason` is 'missing' | 'type' | 'size'
// so the caller can report the ACTUAL problem instead of guessing "too big".
export function validateCredentialFile(file) {
  if (!file) {
    return { ok: false, reason: 'missing', error: 'Please choose your licence, certificate or work ID first.' }
  }

  const contentType = resolveContentType(file)
  if (!ACCEPTED_CREDENTIAL_TYPES.includes(contentType)) {
    return {
      ok: false,
      reason: 'type',
      error: 'That file type is not supported. Upload a JPG, PNG, WEBP, HEIC or PDF.',
    }
  }

  if (file.size > MAX_CREDENTIAL_BYTES) {
    const mb = (file.size / (1024 * 1024)).toFixed(1)
    return {
      ok: false,
      reason: 'size',
      error: `That file is ${mb}MB. The limit is ${MAX_CREDENTIAL_LABEL} — please upload a smaller scan.`,
    }
  }

  return { ok: true, contentType }
}

// Storage key for a user's credential. The leading `<userId>/` folder is what
// the new RLS policies check ownership against, so this shape is load-bearing,
// not cosmetic — a flat filename would be rejected by the INSERT policy.
export function credentialStoragePath(userId, file, now = Date.now()) {
  const ext = extensionOf(file?.name) || (resolveContentType(file) === 'application/pdf' ? 'pdf' : 'jpg')
  return `${userId}/${now}.${ext}`
}

// Turn a Storage failure into something a user can act on. Storage answers a
// policy rejection with 403/"row-level security", an oversize file with 413,
// and a disallowed type with 415 — all of which used to surface as "Upload
// failed. Try a smaller image."
export function describeUploadError(error) {
  const status = error?.statusCode ?? error?.status
  const message = String(error?.message || '')

  if (String(status) === '413' || /exceeded the maximum allowed size|payload too large/i.test(message)) {
    return `That file is larger than the ${MAX_CREDENTIAL_LABEL} limit. Please upload a smaller scan.`
  }
  if (String(status) === '415' || /mime type|not supported/i.test(message)) {
    return 'That file type is not supported. Upload a JPG, PNG, WEBP, HEIC or PDF.'
  }
  if (String(status) === '403' || /row-level security|unauthorized|violates/i.test(message)) {
    return 'We could not accept that upload. Please sign out and back in, then try again.'
  }
  return `Upload failed: ${message || 'please check your connection and try again.'}`
}
