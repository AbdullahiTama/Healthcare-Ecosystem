import { useState, useEffect } from 'react'

// Wraps the navigator.onLine + online/offline event-listener pattern that
// was previously duplicated inline in BusinessDashboard.jsx and (broken, via
// require()) in the dead OfflineBanner component.
export function useOnlineStatus() {
  const [online, setOnline] = useState(navigator.onLine)

  useEffect(() => {
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down) }
  }, [])

  return online
}
