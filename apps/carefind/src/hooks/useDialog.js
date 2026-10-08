import { useEffect, useRef } from 'react'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

// Modal behaviour for a drawer or sheet: Escape closes it, page scroll is locked behind it, focus moves in on open,
// Tab is kept inside it, and focus returns to whatever opened it. Attach the returned ref to the dialog panel.
//
// `onClose` is read through a ref so callers can pass an inline function: depending on it directly would re-run
// the effect on every parent render and pull focus back to the first control.
export function useDialog({ open, onClose }) {
  const panelRef = useRef(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return undefined
    const opener = document.activeElement
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const focusables = () => Array.from(panelRef.current?.querySelectorAll(FOCUSABLE) || [])
    const [first] = focusables()
    ;(first || panelRef.current)?.focus()

    function onKeyDown(e) {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCloseRef.current?.()
        return
      }
      if (e.key !== 'Tab') return
      const items = focusables()
      if (items.length === 0) { e.preventDefault(); return }
      const firstItem = items[0]
      const lastItem = items[items.length - 1]
      if (e.shiftKey && (document.activeElement === firstItem || !panelRef.current?.contains(document.activeElement))) {
        e.preventDefault()
        lastItem.focus()
      } else if (!e.shiftKey && (document.activeElement === lastItem || !panelRef.current?.contains(document.activeElement))) {
        e.preventDefault()
        firstItem.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
      if (opener && typeof opener.focus === 'function') opener.focus()
    }
  }, [open])

  return panelRef
}
