// Reading a barcode with the device camera (BarcodeDetector), shared by the POS
// and Purchases. Desktop browsers mostly lack BarcodeDetector; there a USB
// scanner (which types into the focused field) or typing the number is the way
// in, and callers fall back accordingly.

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
