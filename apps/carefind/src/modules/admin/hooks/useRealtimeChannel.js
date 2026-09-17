import { useEffect, useRef, useCallback } from 'react'
import { supabase } from '../../../config/supabaseClient'

export function useRealtimeChannel({
  channelName,
  subscription,
  onInsert,
  onUpdate,
  onDelete,
  onAny,
  onConnect,
  onError,
  pollInterval = 30000,
  pollFn,
}) {
  const channelRef = useRef(null)
  const pollRef = useRef(null)
  const pollFnRef = useRef(pollFn)
  const mountedRef = useRef(true)

  useEffect(() => {
    pollFnRef.current = pollFn
  }, [pollFn])

  const cleanup = useCallback(() => {
    mountedRef.current = false
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current)
      channelRef.current = null
    }
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  const startPolling = useCallback(() => {
    if (!pollFnRef.current || pollRef.current) return
    pollRef.current = setInterval(() => {
      if (mountedRef.current && pollFnRef.current) {
        pollFnRef.current()
      }
    }, pollInterval)
  }, [pollInterval])

  useEffect(() => {
    if (!channelName || !subscription?.table) return

    mountedRef.current = true
    const { schema = 'public', table, event, filter } = subscription

    const channel = supabase.channel(channelName)
    const eventFilter = event ? { event } : {}

    channel.on(
      'postgres_changes',
      { ...eventFilter, schema, table, ...(filter ? { filter } : {}) },
      (payload) => {
        if (!mountedRef.current) return
        if (payload.eventType === 'INSERT' && onInsert) onInsert(payload.new)
        if (payload.eventType === 'UPDATE' && onUpdate) onUpdate(payload.new)
        if (payload.eventType === 'DELETE' && onDelete) onDelete(payload.old)
        if (onAny) onAny(payload)
      }
    )

    channel.subscribe((status) => {
      if (!mountedRef.current) return
      if (status === 'SUBSCRIBED' && onConnect) onConnect()
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        if (onError) onError(status)
        startPolling()
      }
    })

    channelRef.current = channel

    return cleanup
  }, [channelName, subscription?.table, onInsert, onUpdate, onDelete, onAny, onConnect, onError, startPolling, cleanup])

  return { cleanup }
}
