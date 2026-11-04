import { useCallback, useEffect, useRef } from 'react'
import { createKeyboardScanDetector, SCAN_IDLE_MS } from '../lib/barcodeScanner'

// Catches USB / Bluetooth scanners in keyboard mode, which type the code (and
// usually Enter) into whichever field has focus. Shared by Purchases and the
// POS so both treat a scan the same way:
//
//   snapshot(event)       called on the first key of every fast burst, before
//                         that key reaches the field. Return what is needed to
//                         undo the burst (the state as it is now).
//   onScan(code, snap)    the burst was a scan: undo it with `snap` and send
//                         the code where it belongs. The scanner's Enter/Tab
//                         has been swallowed, so it moves no focus, adds no
//                         line and presses no button.
//   ignore(event)         optional: true leaves this key alone (e.g. free-text
//                         notes, an open dialog).
//
// Returns a keydown handler. Attach it in the capture phase, so it sees the
// keys before the field's own handlers do: React's onKeyDownCapture for one
// form, or window.addEventListener('keydown', h, true) for a whole screen
// (pass `{ window: true }` to have the hook do that while `enabled`).
export function useKeyboardScanner({ snapshot, onScan, ignore }, { window: onWindow = false, enabled = true } = {}) {
  const callbacks = useRef(null)
  callbacks.current = { snapshot, onScan, ignore }
  const detector = useRef(null)
  if (!detector.current) detector.current = createKeyboardScanDetector()
  const started = useRef(null)
  const idleTimer = useRef(null)

  const finish = useCallback((code) => {
    const snap = started.current
    started.current = null
    if (snap) callbacks.current.onScan(code, snap.value)
  }, [])

  const onKeyDown = useCallback((e) => {
    if (callbacks.current.ignore?.(e)) return
    const d = detector.current
    const result = d.keydown(e, Date.now())
    clearTimeout(idleTimer.current)
    if (result?.type === 'start') {
      started.current = { value: callbacks.current.snapshot(e) }
    } else if (result?.type === 'scan') {
      e.preventDefault()
      e.stopPropagation()
      finish(result.code)
      return
    }
    if (d.pending()) {
      idleTimer.current = setTimeout(() => {
        const code = d.idle()
        if (code) finish(code)
      }, SCAN_IDLE_MS)
    }
  }, [finish])

  useEffect(() => {
    if (!onWindow || !enabled) return undefined
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      // A burst cut off by leaving the screen is not finished later.
      clearTimeout(idleTimer.current)
      started.current = null
      detector.current.idle()
    }
  }, [onWindow, enabled, onKeyDown])

  useEffect(() => () => clearTimeout(idleTimer.current), [])

  return onKeyDown
}

// Scans while a dialog is open belong to that dialog: keys typed anywhere
// inside it (its footer buttons too) or with nothing focused. `area` is a ref
// to an element inside the dialog's content; `enabled` is whether the dialog
// is showing. Text areas are left alone.
export function useDialogKeyboardScanner(area, { snapshot, onScan, ignore }, { enabled = true } = {}) {
  return useKeyboardScanner({
    ignore: (e) => {
      const dialog = area.current?.closest('[role="dialog"]')
      const t = e.target
      if (!dialog || !t || t.tagName === 'TEXTAREA' || t.isContentEditable) return true
      if (!(dialog.contains(t) || t === document.body)) return true
      return !!ignore?.(e)
    },
    snapshot,
    onScan,
  }, { window: true, enabled })
}

