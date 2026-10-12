import { useCallback, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { liveRepository } from '../repositories/liveRepository'
import { useRealtimeChannel } from './useRealtimeChannel'

// Control room data for one show: { items, comments, stats }. The key carries
// the show id and there is no placeholderData, so a different show never shows
// another show's data; the same show keeps its last good data across a failed
// refetch (react-query default) and the page shows it as stale via isError.
// A result without both lists is an error, never an empty control room.

async function loadControl(showId) {
  const data = await liveRepository.getLiveControl(showId)
  if (!Array.isArray(data?.items) || !Array.isArray(data?.comments)) {
    throw new Error('live control returned no items or comments')
  }
  return data
}

export function useLiveControl(showId, enabled = true) {
  const active = !!showId && enabled
  const query = useQuery({
    queryKey: ['admin', 'live', 'control', showId],
    queryFn: () => loadControl(showId),
    enabled: active,
  })

  // useRealtimeChannel resubscribes whenever a handler identity changes, so the
  // handler is stable and reads the latest refetch and `active` through refs.
  const refetchRef = useRef(query.refetch)
  const activeRef = useRef(active)
  useEffect(() => {
    refetchRef.current = query.refetch
    activeRef.current = active
  })
  const refetchStable = useCallback(() => {
    if (activeRef.current) refetchRef.current()
  }, [])

  // An empty channelName keeps the channel and its poll unmounted.
  useRealtimeChannel({
    channelName: active ? `admin-live-comments-${showId}` : '',
    subscription: { schema: 'public', table: 'live_comments', filter: `show_id=eq.${showId}` },
    onAny: refetchStable,
    pollInterval: 10000,
    pollFn: refetchStable,
    pollAlways: true,
  })
  useRealtimeChannel({
    channelName: active ? `admin-live-items-${showId}` : '',
    subscription: { schema: 'public', table: 'live_items', filter: `show_id=eq.${showId}` },
    onAny: refetchStable,
  })

  return query
}
