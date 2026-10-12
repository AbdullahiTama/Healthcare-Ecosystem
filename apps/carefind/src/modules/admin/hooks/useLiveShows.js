import { useCallback, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { liveRepository } from '../repositories/liveRepository'
import { useRealtimeChannel } from './useRealtimeChannel'

// Live and scheduled shows. Each list settles on its own to
// { status: 'ok', data } or { status: 'error' }, so a failed read is shown as
// failed and never as an empty list. The key starts with 'admin', so
// invalidateAdmin() refreshes it; the channel and a 15s poll keep it current.

const settle = async (promise) => {
  try {
    const data = await promise
    if (!Array.isArray(data)) throw new Error('live shows returned no list')
    return { status: 'ok', data }
  } catch {
    return { status: 'error' }
  }
}

async function loadLiveShows() {
  const [active, scheduled] = await Promise.all([
    settle(liveRepository.getActiveShows()),
    settle(liveRepository.getScheduledShows()),
  ])
  return { active, scheduled }
}

export function useLiveShows(enabled = true) {
  const query = useQuery({ queryKey: ['admin', 'live', 'shows'], queryFn: loadLiveShows, enabled })

  // useRealtimeChannel resubscribes whenever a handler identity changes, so the
  // handler is stable and reaches the latest refetch through a ref.
  const refetchRef = useRef(query.refetch)
  useEffect(() => { refetchRef.current = query.refetch }, [query.refetch])
  // A disabled caller must not query: the channel and poll stay mounted, so the
  // handler itself checks the latest `enabled`.
  const enabledRef = useRef(enabled)
  useEffect(() => { enabledRef.current = enabled })
  const refetchStable = useCallback(() => {
    if (enabledRef.current) refetchRef.current()
  }, [])

  useRealtimeChannel({
    channelName: 'admin-live-shows',
    subscription: { schema: 'public', table: 'live_shows' },
    onAny: refetchStable,
    pollInterval: 15000,
    pollFn: refetchStable,
    pollAlways: true,
  })

  return query
}
