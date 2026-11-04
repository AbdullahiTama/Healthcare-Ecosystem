// Reading barcodes, shared by the POS and Purchases: with the device camera
// (BarcodeDetector, mostly missing on desktop browsers), and from USB scanners
// in keyboard mode, which type the code into the focused field. Callers fall
// back to typing the number when neither is available.

// The product a scanned or typed barcode belongs to: exact match after
// trimming, the POS rule (docs/architecture/POS-Barcode-Scanning.md). A partial
// code never matches. Used by Purchases and Inventory.
export function findProductByBarcode(products, code) {
  const raw = String(code || '').trim()
  if (!raw) return null
  return (products || []).find(p => p.barcode && String(p.barcode).trim() === raw) || null
}

export const BARCODE_FORMATS = ['ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'upc_e']

export function canScanWithCamera() {
  return typeof window !== 'undefined' && 'BarcodeDetector' in window && !!navigator?.mediaDevices?.getUserMedia
}

// Opens the rear camera, shows it in the <video> `getVideo()` returns, and
// calls onCode(rawValue) with the first code read. Always ends exactly once
// (onEnd), after a code, a timeout, stop() or a failure (onError first, e.g.
// camera permission refused). Returns stop().
export function startCameraScan({ getVideo, onCode, onEnd, onError, timeoutMs = 15000, intervalMs = 300 }) {
  let stream = null
  let interval = null
  let timer = null
  let done = false
  const finish = () => {
    if (done) return
    done = true
    clearInterval(interval)
    clearTimeout(timer)
    stream?.getTracks().forEach((t) => t.stop())
    onEnd?.()
  }
  navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }).then((s) => {
    stream = s
    if (done) { finish(); s.getTracks().forEach((t) => t.stop()); return }
    const video = getVideo()
    if (video) { video.srcObject = s; video.play?.() }
    const detector = new window.BarcodeDetector({ formats: BARCODE_FORMATS })
    interval = setInterval(async () => {
      if (done || !video) return
      try {
        const codes = await detector.detect(video)
        if (codes.length > 0 && !done) {
          const code = codes[0].rawValue
          finish()
          onCode(code)
        }
      } catch {
        // A frame that cannot be read yet (camera still starting): try the next.
      }
    }, intervalMs)
    timer = setTimeout(finish, timeoutMs)
  }).catch((e) => {
    onError?.(e)
    finish()
  })
  return finish
}

// USB / Bluetooth scanners in keyboard mode ("keyboard wedge") type the code
// into whichever field has focus, one key every few milliseconds, usually
// followed by Enter (sometimes Tab, sometimes nothing). A person cannot keep
// that pace, so a fast burst of at least `minLength` characters is a scan.
// Auto-repeat (a held key) and shortcuts are never part of one.
export const SCAN_MIN_LENGTH = 6
export const SCAN_MAX_GAP_MS = 50
// A burst with no Enter/Tab is taken as finished once the keys stop this long.
export const SCAN_IDLE_MS = 100

// Pure: the caller passes each keydown and the time it happened (ms).
//   keydown(event, at) -> { type: 'start' }        this key began a new burst
//                         { type: 'scan', code }   Enter/Tab ended a scan
//                         null                     anything else
//   pending()  -> true when the burst so far is long enough to be a scan
//   idle()     -> the code when the keys stopped after a scan with no suffix
//                 (null otherwise); either way the burst is over.
export function createKeyboardScanDetector({ minLength = SCAN_MIN_LENGTH, maxGapMs = SCAN_MAX_GAP_MS } = {}) {
  let buffer = ''
  let lastAt = -Infinity
  const reset = () => { buffer = ''; lastAt = -Infinity }
  return {
    keydown({ key, repeat, ctrlKey, metaKey, altKey }, at) {
      // Shift comes before every capital letter a scanner types: not a break.
      if (key === 'Shift') return null
      if (key === 'Enter' || key === 'Tab') {
        const code = buffer.length >= minLength && at - lastAt <= maxGapMs ? buffer : null
        reset()
        return code ? { type: 'scan', code } : null
      }
      if (typeof key !== 'string' || key.length !== 1 || repeat || ctrlKey || metaKey || altKey) { reset(); return null }
      const start = !buffer || at - lastAt > maxGapMs
      buffer = start ? key : buffer + key
      lastAt = at
      return start ? { type: 'start' } : null
    },
    pending: () => buffer.length >= minLength,
    idle() {
      const code = buffer.length >= minLength ? buffer : null
      reset()
      return code
    },
  }
}
