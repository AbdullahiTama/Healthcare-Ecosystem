import { useState, useRef } from 'react'

// Mirrors apps/carehub/src/hooks/useToast.js for cross-app consistency.
// See docs/design/UX_PATTERNS.md → Notifications ("Toasts for transient,
// non-critical confirmation") and → "Reversible actions get undo, not a
// confirmation dialog" for what `type`/`actionLabel` exist to serve.
//
// `show(message, options)` — options is either a number (legacy shorthand,
// treated as duration) or { type, duration, actionLabel, onAction }. `type`
// drives Toast's color/icon: 'success' | 'error' | 'warning' | 'info'
// (default). `actionLabel`/`onAction` render one inline action, reserved
// for the Undo pattern, not arbitrary buttons.
export function useToast() {
  const [toast, setToast] = useState(null) // { msg, type, actionLabel, onAction } | null
  const timerRef = useRef(null)

  const show = (message, options = {}) => {
    const opts = typeof options === 'number' ? { duration: options } : options
    const { type = 'info', duration = 4000, actionLabel, onAction } = opts
    if (timerRef.current) clearTimeout(timerRef.current)
    setToast({ msg: message, type, actionLabel, onAction })
    timerRef.current = setTimeout(() => setToast(null), duration)
  }

  // `msg` stays a plain string so existing `<Toast msg={msg} />` call sites
  // that haven't been touched by this sweep keep rendering correctly.
  return { msg: toast?.msg || '', type: toast?.type || 'info', actionLabel: toast?.actionLabel, onAction: toast?.onAction, show }
}
