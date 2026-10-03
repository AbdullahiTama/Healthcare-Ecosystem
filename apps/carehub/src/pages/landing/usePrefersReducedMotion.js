import { useEffect, useState } from 'react'

const QUERY = '(prefers-reduced-motion: reduce)'

function read() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  try {
    return window.matchMedia(QUERY).matches
  } catch {
    return false
  }
}

// Live-updating prefers-reduced-motion. This is the convention already used in
// components/ui/Sheet.jsx, which reads the same query per open; the landing page
// had no guard at all, which is the gap this closes.
export function usePrefersReducedMotion() {
  const [prefers, setPrefers] = useState(read)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    let mq
    try {
      mq = window.matchMedia(QUERY)
    } catch {
      return
    }
    const onChange = (e) => setPrefers(e.matches)
    setPrefers(mq.matches)

    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', onChange)
      return () => mq.removeEventListener('change', onChange)
    }
    if (typeof mq.addListener === 'function') {
      mq.addListener(onChange)
      return () => mq.removeListener(onChange)
    }
  }, [])

  return prefers
}
