// A random (version 4) UUID made on the client. An id chosen before the first
// attempt is what makes a retried insert safe: the same id inserted twice is
// refused as a duplicate instead of becoming a second row (live activity
// reports, POS sales replayed from the offline queue).
//
// crypto.randomUUID needs a secure context; the fallback builds the same shape
// from crypto.getRandomValues (or Math.random where even that is missing).
export function newUuid() {
  const c = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  const b = c && c.getRandomValues ? c.getRandomValues(new Uint8Array(16)) : Uint8Array.from({ length: 16 }, function () { return Math.floor(Math.random() * 256) })
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = Array.from(b, function (x) { return x.toString(16).padStart(2, '0') }).join('')
  return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20)
}
