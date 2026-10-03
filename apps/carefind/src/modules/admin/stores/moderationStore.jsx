import { createContext, useContext, useState, useCallback, useMemo } from 'react'

const ModerationContext = createContext(null)

export function ModerationProvider({ children }) {
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [bulkActionLoading, setBulkActionLoading] = useState(false)
  const [filterPriority, setFilterPriority] = useState('all')
  const [filterSource, setFilterSource] = useState('all')

  const toggleSelect = useCallback((id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const selectAll = useCallback((ids) => {
    setSelectedIds(new Set(ids))
  }, [])

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set())
  }, [])

  const value = useMemo(() => ({
    selectedIds,
    bulkActionLoading,
    filterPriority,
    filterSource,
    toggleSelect,
    selectAll,
    clearSelection,
    setBulkActionLoading,
    setFilterPriority,
    setFilterSource,
  }), [selectedIds, bulkActionLoading, filterPriority, filterSource, toggleSelect, selectAll, clearSelection])

  return (
    <ModerationContext.Provider value={value}>
      {children}
    </ModerationContext.Provider>
  )
}

export function useModerationStore() {
  const ctx = useContext(ModerationContext)
  if (!ctx) throw new Error('useModerationStore must be used within ModerationProvider')
  return ctx
}
