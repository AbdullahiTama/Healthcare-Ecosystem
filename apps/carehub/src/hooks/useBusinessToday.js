import { useEffect, useState } from 'react'
import { businessDate, msUntilNextBusinessDay } from '../lib/businessDay'

// Today's business date ('YYYY-MM-DD'), re-rendering at business midnight.
// Screens put it in their period's dependencies so "Today" never keeps
// showing yesterday on a page left open overnight. A device that slept
// through midnight catches up when it becomes visible again.
export function useBusinessToday() {
  const [today, setToday] = useState(() => businessDate())
  useEffect(() => {
    const sync = () => setToday(businessDate())
    // +1s so the timer never fires a hair before midnight.
    const timer = setTimeout(sync, msUntilNextBusinessDay() + 1000)
    const onVisible = () => { if (document.visibilityState === 'visible') sync() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', onVisible) }
  }, [today])
  return today
}
