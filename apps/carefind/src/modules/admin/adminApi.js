import { supabase } from '../../config/supabaseClient'

export async function getAdminAuthorizationHeader() {
  const { data: { session }, error } = await supabase.auth.getSession()
  if (error) throw error
  if (!session?.access_token) throw new Error('Your admin session has expired. Please sign in again.')
  return { Authorization: `Bearer ${session.access_token}` }
}

export async function callAdminAuth(action, payload = {}) {
  try {
    const safePayload = { ...payload }
    delete safePayload.token
    const res = await fetch('/api/admin-auth', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...await getAdminAuthorizationHeader(),
      },
      body: JSON.stringify({ ...safePayload, action }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`)
    return data
  } catch (err) {
    console.error(`[callAdminAuth] ${action} failed:`, err.message)
    throw new Error(err.message || 'Network error — check if the admin API is reachable')
  }
}
