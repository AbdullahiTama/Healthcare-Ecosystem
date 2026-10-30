import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createRefreshCycle, watchForResume } from '../lib/resume'
import { renewSession } from '../lib/sessionFetch'

// Brings the dashboard up to date when staff come back to it (see
// lib/resume.js). Mounted once by the dashboard shell; screens opt in with
// useRefreshOnResume, and RefreshIndicator shows what is happening.
const RefreshContext = createContext(null)

const IDLE = { state: 'idle' }
const noop = () => () => {}

export default function RefreshProvider({ children }) {
  const [cycle] = useState(() => createRefreshCycle({ renewSession }))
  useEffect(() => watchForResume(() => { cycle.refresh() }), [cycle])
  return <RefreshContext.Provider value={cycle}>{children}</RefreshContext.Provider>
}

// Registers what this screen refetches when the user comes back. The latest
// `refresh` is always the one called, so it can close over current props.
// It should keep the screen's current data if it fails, and throw, so the
// indicator can say the screen is out of date. Does nothing outside the
// provider (screens rendered on their own, e.g. in tests).
export function useRefreshOnResume(refresh) {
  const cycle = useContext(RefreshContext)
  const latest = useRef(refresh)
  latest.current = refresh
  useEffect(() => (cycle ? cycle.register(() => latest.current()) : undefined), [cycle])
}

export function useRefreshStatus() {
  const cycle = useContext(RefreshContext)
  const status = useSyncExternalStore(cycle ? cycle.subscribe : noop, cycle ? cycle.getStatus : () => IDLE)
  return {
    status,
    retry: () => cycle?.refresh({ force: true }),
    settle: () => cycle?.settle(),
  }
}
