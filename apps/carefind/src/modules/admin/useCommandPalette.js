import { useState, useEffect, useCallback } from 'react'

const STORAGE_KEY = 'admin_recent_tabs'
const MAX_RECENT = 5

function readRecent() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function writeRecent(tabs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tabs))
  } catch {}
}

export default function useCommandPalette() {
  const [open, setOpen] = useState(false)
  const [recentTabs, setRecentTabs] = useState(readRecent)

  const addToRecent = useCallback((tabKey) => {
    setRecentTabs(prev => {
      const next = [tabKey, ...prev.filter(k => k !== tabKey)].slice(0, MAX_RECENT)
      writeRecent(next)
      return next
    })
  }, [])

  useEffect(() => {
    function onKeyDown(e) {
      const tag = document.activeElement?.tagName
      const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || document.activeElement?.isContentEditable

      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setOpen(prev => !prev)
        return
      }

      if (e.key === '/' && !isInput) {
        e.preventDefault()
        setOpen(true)
        return
      }

      if (e.key === 'Escape') {
        setOpen(false)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return { open, setOpen, recentTabs, addToRecent }
}
