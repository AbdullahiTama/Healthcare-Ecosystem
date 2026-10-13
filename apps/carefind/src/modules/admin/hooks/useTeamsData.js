import { useQuery, useQueryClient } from '@tanstack/react-query'
import { callAdminAuth } from '../adminApi'

// Teams, admin roles and staff for the Teams screen. Each source settles on
// its own to { status: 'ok', data } or { status: 'error' }, so a failed read is
// shown as failed and never as an empty list. A failed refresh of a source that
// last loaded keeps that data as { status: 'ok', data, stale: true }; a later
// success has no `stale`. Staff is `{ status: 'restricted' }` without a call
// when the admin may not see it. The key starts with 'admin', so
// invalidateAdmin() refreshes it.

const settle = async (promise, previous) => {
  try {
    const data = await promise
    if (!Array.isArray(data)) throw new Error('no list returned')
    return { status: 'ok', data }
  } catch {
    if (previous?.status === 'ok') return { status: 'ok', data: previous.data, stale: true }
    return { status: 'error' }
  }
}

const read = (action, pick) => callAdminAuth(action, {}).then(pick)

async function loadTeams(canSeeStaff, previous) {
  const [teams, roles, staff] = await Promise.all([
    settle(read('list_teams', res => res?.teams), previous?.teams),
    settle(read('list_admin_roles', res => res?.data), previous?.roles),
    canSeeStaff
      ? settle(read('list_staff', res => res?.staff), previous?.staff)
      : Promise.resolve({ status: 'restricted' }),
  ])
  return { teams, roles, staff }
}

export function useTeamsData({ canSeeStaff } = {}) {
  const queryClient = useQueryClient()
  const queryKey = ['admin', 'teams', !!canSeeStaff]
  return useQuery({ queryKey, queryFn: () => loadTeams(!!canSeeStaff, queryClient.getQueryData(queryKey)) })
}
