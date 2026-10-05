import { supabase } from '../../config/supabaseClient'

export const SESSION_EXPIRED_EVENT = 'admin:session-expired'

function announceSessionExpired() {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT))
}

export async function getAdminAuthorizationHeader() {
  const { data: { session }, error } = await supabase.auth.getSession()
  if (error) throw error
  if (!session?.access_token) {
    announceSessionExpired()
    throw new Error('Your admin session has expired. Please sign in again.')
  }
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
    if (!res.ok) {
      // `verify` and `logout` failing is the gate's own business; every other
      // 401 means the session died under a screen that was already open.
      if (res.status === 401 && action !== 'verify' && action !== 'logout') announceSessionExpired()
      throw new Error(data.error || `Request failed (${res.status})`)
    }
    return data
  } catch (err) {
    console.error(`[callAdminAuth] ${action} failed:`, err.message)
    throw new Error(err.message || 'Network error — check if the admin API is reachable')
  }
}
