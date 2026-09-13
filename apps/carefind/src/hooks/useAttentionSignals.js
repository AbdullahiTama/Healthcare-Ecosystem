import { useEffect, useState } from 'react'
import { supabase } from '../config/supabaseClient'

export function useAttentionSignals(userIds, currentUserId) {
  const [signals, setSignals] = useState({})

  useEffect(() => {
    if (!userIds || userIds.length === 0) {
      setSignals({})
      return
    }

    let cancelled = false

    async function loadSignals() {
      const result = {}

      // Load active stories
      const { data: stories } = await supabase
        .from('stories')
        .select('user_id, expires_at')
        .in('user_id', userIds)
        .gt('expires_at', new Date().toISOString())

      if (stories) {
        stories.forEach(s => {
          if (!result[s.user_id]) result[s.user_id] = {}
          result[s.user_id].hasStory = true
        })
      }

      // Load active live shows
      const { data: liveShows } = await supabase
        .from('live_shows')
        .select('host_id, guest_id')
        .eq('status', 'live')
        .or(`host_id.in.(${userIds.join(',')}),guest_id.in.(${userIds.join(',')})`)

      if (liveShows) {
        liveShows.forEach(show => {
          if (userIds.includes(show.host_id)) {
            if (!result[show.host_id]) result[show.host_id] = {}
            result[show.host_id].isLive = true
          }
          if (show.guest_id && userIds.includes(show.guest_id)) {
            if (!result[show.guest_id]) result[show.guest_id] = {}
            result[show.guest_id].isLive = true
          }
        })
      }

      // Load last seen timestamps for posts (simplified - just check if there are recent posts)
      // This is a simplified version - a full implementation would track last visit per user
      const { data: recentPosts } = await supabase
        .from('posts')
        .select('user_id, created_at')
        .in('user_id', userIds)
        .gt('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .limit(100)

      if (recentPosts) {
        recentPosts.forEach(post => {
          if (!result[post.user_id]) result[post.user_id] = {}
          result[post.user_id].hasRecentPosts = true
        })
      }

      if (!cancelled) {
        setSignals(result)
      }
    }

    loadSignals()
    return () => { cancelled = true }
  }, [userIds?.join(','), currentUserId])

  return signals
}

export function getUserAttentionState(signals, userId) {
  const userSignals = signals?.[userId] || {}
  return {
    hasStory: userSignals.hasStory || false,
    isLive: userSignals.isLive || false,
    hasNewPosts: userSignals.hasRecentPosts || false,
  }
}
