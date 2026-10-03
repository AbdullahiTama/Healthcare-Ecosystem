import { useEffect, useState, useCallback } from 'react'

const STORAGE_KEY = 'carefind_video_progress'
const MAX_ITEMS = 10

export function useVideoProgress(userId) {
  const [progress, setProgress] = useState({})

  useEffect(() => {
    if (!userId) return
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        const parsed = JSON.parse(stored)
        setProgress(parsed[userId] || {})
      }
    } catch {}
  }, [userId])

  const updateProgress = useCallback((videoId, currentTime, duration) => {
    if (!userId || !videoId || !duration) return
    const percent = Math.min(95, Math.round((currentTime / duration) * 100))
    if (percent < 5) return

    setProgress(prev => {
      const next = { ...prev, [videoId]: { percent, updatedAt: Date.now() } }
      try {
        const stored = localStorage.getItem(STORAGE_KEY)
        const all = stored ? JSON.parse(stored) : {}
        all[userId] = next
        localStorage.setItem(STORAGE_KEY, JSON.stringify(all))
      } catch {}
      return next
    })
  }, [userId])

  const clearProgress = useCallback((videoId) => {
    if (!userId || !videoId) return
    setProgress(prev => {
      const next = { ...prev }
      delete next[videoId]
      try {
        const stored = localStorage.getItem(STORAGE_KEY)
        const all = stored ? JSON.parse(stored) : {}
        all[userId] = next
        localStorage.setItem(STORAGE_KEY, JSON.stringify(all))
      } catch {}
      return next
    })
  }, [userId])

  return { progress, updateProgress, clearProgress }
}

export function getContinueWatchingIds(progress) {
  return Object.entries(progress || {})
    .filter(([, data]) => data.percent >= 5 && data.percent < 95)
    .sort(([, a], [, b]) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_ITEMS)
    .map(([id]) => id)
}
