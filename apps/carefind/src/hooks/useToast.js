import { useState } from 'react'

// Mirrors apps/carehub/src/hooks/useToast.js for cross-app consistency.
// CareFind had no toast mechanism before this — see docs/design/UX_PATTERNS.md
// → Notifications ("Toasts for transient, non-critical confirmation").
export function useToast() {
  const [msg, setMsg] = useState('')
  const show = (message, duration = 4000) => {
    setMsg(message)
    setTimeout(() => setMsg(''), duration)
  }
  return { msg, show }
}
