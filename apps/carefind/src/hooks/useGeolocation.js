import { useEffect, useState } from 'react'

// Browser geolocation for distance-based search. Permission is asked once;
// the result is cached in sessionStorage so repeat visits don't re-prompt.
// Errors (denied, unsupported, timeout) are surfaced so callers can degrade
// gracefully to the text-based location filter instead of crashing.
const CACHE_KEY = 'carefind_user_location'

export function useGeolocation() {
  const [coords, setCoords] = useState(null)
  const [error, setError] = useState(null)
  const [asking, setAsking] = useState(false)

  useEffect(() => {
    let active = true
    if (!navigator.geolocation) {
      setError('unsupported')
      return
    }
    try {
      const cached = JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null')
      if (cached && typeof cached.lat === 'number' && typeof cached.lng === 'number') {
        setCoords(cached)
        return
      }
    } catch (e) { /* corrupted cache, re-ask */ }

    setAsking(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (!active) return
        const c = { lat: pos.coords.latitude, lng: pos.coords.longitude }
        try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(c)) } catch (e) { /* private mode */ }
        setCoords(c)
        setAsking(false)
      },
      (err) => {
        if (!active) return
        setError(err.code === 1 ? 'denied' : 'unavailable')
        setAsking(false)
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 600000 }
    )
    return () => { active = false }
  }, [])

  return { coords, error, asking }
}
