import { useCallback, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { callAdminAuth } from '../adminApi'
import { dashboardRepository } from '../repositories'
import { useAdmin } from '../provider/AdminProvider.jsx'
import { bestEffort } from '../lib/bestEffort'
import { capped } from '../lib/capped'

// The task list. A failed read, or a result that is not a list, is an error and
// never an empty list. Key starts with 'admin', so invalidateAdmin() refreshes it.
export function useTasksData(enabled = true) {
  return useQuery({
    queryKey: ['admin', 'tasks'],
    queryFn: async () => {
      const data = await dashboardRepository.getTasks()
      if (!Array.isArray(data)) throw new Error('tasks returned no list')
      return data
    },
    enabled,
  })
}

const REFRESH_CAP_MS = 10000
const WHOLE_NUMBER = /^\d+$/

// Creates a task. Resolves { ok } or { ok: false, error }. Input is validated
// before any server call; the compensation must be a positive whole number. A
// repeat while a create is running is refused. Once the server has committed,
// the refresh and toast are best effort and never turn the result into a failure.
export function useTaskActions() {
  const { showToast, invalidateAdmin } = useAdmin()
  const running = useRef(false)
  const [busy, setBusy] = useState(false)

  const createTask = useCallback(async ({ title, description, compensation, specialty }) => {
    const cleanTitle = (title || '').trim()
    const cleanDescription = (description || '').trim()
    const cleanPay = String(compensation ?? '').trim()
    if (!cleanTitle) return { ok: false, error: 'Enter a task title' }
    if (!cleanDescription) return { ok: false, error: 'Enter a task description' }
    if (!WHOLE_NUMBER.test(cleanPay) || Number(cleanPay) <= 0) return { ok: false, error: 'Enter a positive whole-number compensation' }
    if (running.current) return { ok: false, error: 'Already running' }
    running.current = true
    setBusy(true)
    try {
      try {
        await callAdminAuth('create_task', {
          title: cleanTitle, description: cleanDescription, compensation: cleanPay, specialty: String(specialty ?? '').trim() || null,
        })
      } catch (err) {
        return { ok: false, error: err?.message || String(err) }
      }
      await capped(bestEffort('refreshing after createTask', invalidateAdmin), REFRESH_CAP_MS)
      bestEffort('toasting createTask', () => showToast('Task created', { type: 'success' }))
      return { ok: true }
    } finally {
      running.current = false
      setBusy(false)
    }
  }, [showToast, invalidateAdmin])

  return { createTask, busy }
}
