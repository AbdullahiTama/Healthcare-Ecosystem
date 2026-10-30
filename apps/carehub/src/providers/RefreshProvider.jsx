import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { createRefreshCycle, watchForResume } from '../lib/resume'
import { renewSession } from '../lib/sessionFetch'

// Brings the dashboard up to date when staff come back to it (see
// lib/resume.js). Mounted once by the dashboard shell.
//
// React Query already refetches stale queries on window focus and on
// reconnect. What this adds: the session is renewed first (on a till whose
// clock is behind, supabase-js never does it itself); a device that slept with
// the tab visible, which fires no focus event, is caught too; work that is not
// a query (the offline sale queue) joins in through useRefreshOnResume; and
// RefreshIndicator says what is happening.
const RefreshContext = createContext(null)

const IDLE = { state: 'idle' }
const noop = () => () => {}

// Every query on screen, refetched together. cancelRefetch: false joins a
// fetch React Query already started for the same focus or reconnect instead
// of cancelling it and asking again; throwOnError lets the indicator say the
// screen is out of date. Queries keep their data while refetching, so nothing
// on screen blanks.
export function refetchActiveQueries(queryClient) {
  return queryClient.refetchQueries({ type: 'active' }, { cancelRefetch: false, throwOnError: true })
}

export default function RefreshProvider({ children }) {
  const queryClient = useQueryClient()
  const [cycle] = useState(() => createRefreshCycle({ renewSession }))
  useEffect(() => cycle.register(() => refetchActiveQueries(queryClient)), [cycle, queryClient])
  useEffect(() => watchForResume(() => { cycle.refresh() }), [cycle])
  return <RefreshContext.Provider value={cycle}>{children}</RefreshContext.Provider>
}

// Registers work that is not a React Query query (queries are refetched
// already) to run when the user comes back. The latest `refresh` is always the
// one called, so it can close over current props. It should throw on failure
// so the indicator can say so. Does nothing outside the provider.
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
