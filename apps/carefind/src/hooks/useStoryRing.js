import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../config/supabaseClient'
import { fetchViewedStoryIds } from '../modules/social-feed/storyViews.js'

// Hook to compute Story ring state for a user's active stories.
// Batches fetchViewedStoryIds once per page, not per avatar, per spec.
export function useStoryRing(userId, stories = []) {
  const [viewedIds, setViewedIds] = useState(new Set())
  const hasStory = Array.isArray(stories) && stories.length > 0 && stories.some(s => s.expires_at ? new Date(s.expires_at) > new Date() : true)
  const activeStories = useMemo(() => (stories || []).filter(s => !s.expires_at || new Date(s.expires_at) > new Date()), [stories])

  useEffect(() => {
    if (!activeStories.length) {
      setViewedIds(new Set())
      return
    }
    const ids = activeStories.map(s => s.id)
    let cancelled = false
    fetchViewedStoryIds(supabase, ids).then(set => {
      if (!cancelled) setViewedIds(set)
    })
    return () => { cancelled = true }
  }, [activeStories.map(s => s.id).join(',')])

  const allSeen = hasStory && activeStories.length > 0 && activeStories.every(s => viewedIds.has(s.id))
  const unseenCount = activeStories.filter(s => !viewedIds.has(s.id)).length

  return { hasStory, allSeen, unseenCount, viewedIds, activeStories }
}
